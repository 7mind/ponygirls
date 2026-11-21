import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { CollectorError, object, string, timestamp, type Format, type Json, type JsonObject, type ParsedMessage, type ParsedMetadata, type ParsedRecord, type ParsedTranscript } from './domain.ts';
import type { PrivacyPolicy } from './privacy.ts';
import { requireScalar, wellFormed } from './unicode.ts';

const TITLE_PREVIEW_UTF16_UNITS = 160;
function titlePreview(value: string): string {
  let units = 0;
  for (const point of value.split('\n')[0]!) { if (units + point.length > TITLE_PREVIEW_UTF16_UNITS) break; units += point.length; }
  return value.slice(0, units);
}

function text(value: Json | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('\n');
  if (!object(value)) return String(value);
  const type = string(value['type']);
  if (type === 'toolCall' || type === 'tool_use') return `${type} ${string(value['name']) ?? ''} ${JSON.stringify(value['arguments'] ?? value['input'] ?? {})}`;
  if (type === 'tool_result') return `tool_result ${string(value['tool_use_id']) ?? ''}\n${text(value['content'])}`;
  for (const key of ['text', 'thinking', 'content', 'summary']) {
    if (value[key] !== undefined) return text(value[key]);
  }
  return '';
}

function ensureDepth(value: Json, depth: number): void {
  if (depth > 64) throw new CollectorError('record-depth-limit');
  if (Array.isArray(value)) for (const child of value) ensureDepth(child, depth + 1);
  else if (object(value)) for (const child of Object.values(value)) ensureDepth(child, depth + 1);
}

function normalize(record: ParsedRecord, format: Format): ParsedMessage | null {
  const r = record.value;
  let body = r;
  let role = string(r['type']) ?? 'unknown';
  let content = '';
  let messageId = record.id;
  if (format === 'pi' || format === 'claude') {
    if (object(r['message'])) {
      body = r['message']; role = string(body['role']) ?? role;
      content = text(body['content']);
      if (role === 'bashExecution') content = [text(body['command']), text(body['output'])].filter(Boolean).join('\n');
      if (role === 'system' && object(body['sections'])) content += '\n' + Object.entries(body['sections']).map(([name, value]) => `${name}: ${text(value)}`).join('\n');
    } else if (r['type'] === 'custom_message') { role = 'custom'; content = text(r['content']); }
    else if (r['summary'] !== undefined) { role = 'summary'; content = text(r['summary']); }
    else return null;
  } else {
    if (!object(r['payload'])) return null;
    body = r['payload'];
    const kind = string(body['type']);
    if (r['type'] === 'response_item') {
      role = string(body['role']) ?? (kind === 'function_call_output' || kind === 'custom_tool_call_output' ? 'toolResult' : 'assistant');
      switch (kind) {
        case 'message': case 'agent_message': content = text(body['content']); break;
        case 'reasoning': role = 'reasoning'; content = text(body['summary']) + '\n' + text(body['content']); break;
        case 'function_call': case 'custom_tool_call': case 'tool_search_call':
          content = `${kind} ${string(body['name']) ?? ''} ${text(body['arguments'] ?? body['input'])}`; break;
        case 'local_shell_call': content = `local_shell_call ${JSON.stringify(body['action'] ?? {})}`; break;
        case 'function_call_output': case 'custom_tool_call_output': content = text(body['output']); break;
        case 'web_search_call': content = `web_search_call ${JSON.stringify(body['action'] ?? {})}`; break;
        default: return null;
      }
    } else if (r['type'] === 'event_msg' && kind === 'item_completed' && object(body['item'])) {
      body = body['item']; messageId = string(body['id']);
      switch (body['type']) {
        case 'UserMessage': role = 'user'; content = text(body['content']); break;
        case 'AgentMessage': role = 'assistant'; content = text(body['content']); break;
        case 'FunctionCallOutput': role = 'toolResult'; content = text(body['output']); break;
        case 'CommandExecution': role = 'toolResult'; content = `${text(body['command'])}\n${text(body['aggregated_output'])}`; break;
        case 'McpToolCall': case 'DynamicToolCall':
          role = 'toolResult'; content = `${string(body['tool']) ?? ''} ${JSON.stringify(body['arguments'] ?? {})}\n${text(body['result'] ?? body['content_items'])}`; break;
        case 'Reasoning': role = 'reasoning'; content = [text(body['summary_text']), text(body['raw_content'])].filter(Boolean).join('\n'); break;
        case 'Plan': role = 'assistant'; content = text(body['text']); break;
        case 'HookPrompt': role = 'custom'; content = text(body['fragments']); break;
        default: return null;
      }
    } else if (r['type'] === 'event_msg' && (kind === 'user_message' || kind === 'agent_message' || kind === 'agent_reasoning' || kind === 'agent_reasoning_raw_content')) {
      role = kind === 'user_message' ? 'user' : kind.startsWith('agent_reasoning') ? 'reasoning' : 'assistant';
      content = text(body['message'] ?? body['text']);
    } else if (r['type'] === 'compacted') { role = 'summary'; content = text(body['message']); }
    else if (r['type'] === 'inter_agent_communication') { role = 'custom'; content = text(body['content'] ?? body['message']); }
    else return null;
  }
  if (content.length === 0) return null;
  return { id: messageId ?? `record:${record.index}`, parentId: record.parentId, role, text: content, timestamp: timestamp(body['timestamp']) ?? timestamp(r['timestamp']), recordIndex: record.index };
}

/** A JSON value, or `invalid-json`. */
export function parseJson(line: string): Json {
  try { return JSON.parse(line) as Json; } catch { throw new CollectorError('invalid-json'); }
}
/** One JSONL line as a record: depth-checked and redacted. `raw` is the line as uploaded. */
export interface RecordLine { record: ParsedRecord; raw: string; redacted: boolean }
export function recordOf(format: Format, parsed: Json, line: string, index: number, policy: PrivacyPolicy): RecordLine {
  if (!object(parsed)) throw new CollectorError('invalid-record');
  ensureDepth(parsed, 0);
  const cleaned = policy.redact(parsed);
  if (!object(cleaned.value)) throw new CollectorError('invalid-record');
  const value = cleaned.value;
  const payload = object(value['payload']) ? value['payload'] : value;
  return { record: { value, id: string(value[format === 'claude' ? 'uuid' : 'id']) ?? (format === 'codex' ? string(payload['id']) : null), parentId: string(value[format === 'claude' ? 'parentUuid' : 'parentId']), index }, raw: cleaned.changed ? JSON.stringify(value) : line, redacted: cleaned.changed };
}

/** Response items not yet matched by an event message (`credits`) and event messages of the key that were not dropped
 * (`kept`) — at most one of them is nonzero once every event message of the file was consumed. */
export interface CodexBalance { credits: number; kept: number }
/** The file-wide multiset of Codex `response_item` messages whose `event_msg` duplicates are dropped, keyed by a
 * digest of role and text, consumed in file order. Above `limit` response items it stops counting (`overflowed`): such
 * a file is over maxMessages. Resumed from a checkpoint, `stored` answers the balances of the prefix (append-limits spec
 * §2.2 item 4): the counted response items are those of the addition, and `prefixChanged` is set when one of them
 * matches an event message the prefix kept — the prefix would lose that message. */
export class CodexDuplicates {
  private readonly balances = new Map<string, CodexBalance>();
  private readonly stored: (key: string) => CodexBalance | undefined;
  /** The prefix's credits of the keys this pass met: what pass 2 of an append resumes from. */
  readonly seed = new Map<string, number>();
  private entries = 0;
  overflowed = false;
  prefixChanged = false;
  constructor(private readonly limit: number, stored?: (key: string) => CodexBalance | undefined) { this.stored = stored ?? (() => undefined); }
  private static key(message: ParsedMessage): string {
    // UTF-16 code units keep lone surrogates distinct, as the role/text strings themselves are.
    return createHash('sha256').update(message.role, 'utf16le').update('\0', 'utf16le').update(message.text, 'utf16le').digest('base64');
  }
  private balance(key: string): CodexBalance {
    let balance = this.balances.get(key);
    if (balance === undefined) {
      const stored = this.stored(key); balance = { credits: stored?.credits ?? 0, kept: stored?.kept ?? 0 };
      if (balance.credits > 0) this.seed.set(key, balance.credits);
      this.balances.set(key, balance);
    }
    return balance;
  }
  add(record: ParsedRecord): void {
    if (this.overflowed || record.value['type'] !== 'response_item') return;
    const message = normalize(record, 'codex'); if (message === null) return;
    if (++this.entries > this.limit) { this.overflowed = true; this.balances.clear(); this.seed.clear(); return; }
    const balance = this.balance(CodexDuplicates.key(message));
    if (balance.kept > 0) this.prefixChanged = true;
    balance.credits++;
  }
  consume(message: ParsedMessage): boolean {
    const balance = this.balance(CodexDuplicates.key(message));
    if (balance.credits > 0) { balance.credits--; return true; }
    balance.kept++; return false;
  }
  /** The balances of the keys this pass met, as `[key, credits, kept]`. */
  rows(): [string, number, number][] { return [...this.balances].map(([key, { credits, kept }]) => [key, credits, kept]); }
}
/** The normalized, redacted message of a record; null without one or for a Codex `event_msg` duplicate. `replaced`
 * counts the unpaired surrogates of its text that became U+FFFD; an identifier with one refuses the file. */
export function messageOf(format: Format, record: ParsedRecord, duplicates: CodexDuplicates | null, policy: PrivacyPolicy): { message: ParsedMessage; redacted: boolean; replaced: number } | null {
  const message = normalize(record, format);
  if (message === null) return null;
  if (duplicates !== null && record.value['type'] === 'event_msg' && duplicates.consume(message)) return null;
  requireScalar(message.id, message.parentId, message.role);
  // Normalization joins content blocks and can reconstruct a literal that was
  // not contiguous in any raw JSON string. Apply the same policy once more.
  const cleaned = policy.redact(message.text);
  if (typeof cleaned.value !== 'string') throw new CollectorError('message-redaction-invariant');
  const text = wellFormed(cleaned.value);
  return { message: { ...message, text: text.value }, redacted: cleaned.changed, replaced: text.replaced };
}

export interface TranscriptIdentity { producerId: string; subagentId: string | null; parentId: string | null }
type FirstRecord = { piHeader: boolean; supportedVersion: boolean; id: string | null; parentSession: string | null; cwd: string | null; startedAt: string | null };
type Header = Pick<ParsedMetadata, 'workdir' | 'startedAt' | 'gitRemote' | 'gitBranch' | 'gitCommit'> & { producerId: string | null; parentId: string | null };
/** Everything `TranscriptState` holds after some records, as JSON: a checkpoint resumes from it. */
export interface TranscriptSnapshot {
  records: number; first: FirstRecord | null; claude: { sessionId: string | null; agentId: string | null; error: string | null };
  header: Header | null; headerSeen: boolean; workdir: string | null; gitBranch: string | null; model: string | null;
  firstTimestamp: string | null; title: string | null; firstUserTitle: string | null; replacedInMessages: number;
}
const PI_SUBAGENT_PATH = /\/subagents\/[^/]+\/sessions\/([^/]+)\/[^/]+\.jsonl$/;
/** Session identity and metadata accumulated record by record, so that a file need not be held. */
export class TranscriptState {
  private value: TranscriptSnapshot = { records: 0, first: null, claude: { sessionId: null, agentId: null, error: null }, header: null, headerSeen: false,
    workdir: null, gitBranch: null, model: null, firstTimestamp: null, title: null, firstUserTitle: null, replacedInMessages: 0 };
  /** A Pi subagent transcript's agent ID, from its path. */
  private readonly piSubagent: string | null;
  constructor(private readonly format: Format, private readonly sourcePath: string, snapshot?: TranscriptSnapshot) {
    this.piSubagent = format === 'pi' ? PI_SUBAGENT_PATH.exec(sourcePath.replaceAll('\\', '/'))?.[1] ?? null : null;
    if (snapshot !== undefined) this.value = structuredClone(snapshot);
  }
  get snapshot(): TranscriptSnapshot { return structuredClone(this.value); }
  add(record: ParsedRecord): void {
    const value = record.value; const state = this.value;
    if (state.records++ === 0) {
      const version = value['version'];
      state.first = { piHeader: value['type'] === 'session', supportedVersion: version === 3 || version === 2 || version === 1 || version === undefined, id: string(value['id']), parentSession: string(value['parentSession']), cwd: string(value['cwd']), startedAt: timestamp(value['timestamp']) };
    }
    if (this.format === 'claude' && state.claude.error === null) {
      const found = string(value['sessionId']);
      if (found !== null && state.claude.sessionId !== null && found !== state.claude.sessionId) state.claude.error = 'mixed-session-identities';
      else {
        state.claude.sessionId = found ?? state.claude.sessionId;
        const agent = string(value['agentId']);
        if (agent !== null && state.claude.agentId !== null && agent !== state.claude.agentId) state.claude.error = 'mixed-agent-identities';
        state.claude.agentId = agent ?? state.claude.agentId;
      }
    }
    if (this.format === 'codex' && !state.headerSeen && value['type'] === 'session_meta') {
      state.headerSeen = true;
      if (object(value['payload'])) {
        const meta = value['payload']; const git = object(meta['git']) ? meta['git'] : null;
        state.header = { producerId: string(meta['id']), parentId: string(meta['parent_thread_id']) ?? string(meta['forked_from_id']), workdir: string(meta['cwd']), startedAt: timestamp(meta['timestamp']) ?? timestamp(value['timestamp']),
          gitRemote: git === null ? null : string(git['repository_url']), gitBranch: git === null ? null : string(git['branch']), gitCommit: git === null ? null : string(git['commit_hash']) };
      }
    }
    const payload = object(value['payload']) ? value['payload'] : value;
    const message = object(value['message']) ? value['message'] : payload;
    state.workdir = string(payload['cwd']) ?? state.workdir;
    state.gitBranch = string(value['gitBranch']) ?? state.gitBranch;
    state.model = string(message['model']) ?? (value['type'] === 'model_change' ? string(value['modelId']) : null) ?? state.model;
    state.firstTimestamp ??= timestamp(value['timestamp']);
    if (value['type'] === 'session_info') state.title = string(value['name']) ?? state.title;
  }
  /** The first user message is kept only as the title it yields when the session has no name. */
  message(message: ParsedMessage, replaced: number): void {
    if (this.value.firstUserTitle === null && message.role === 'user') {
      let text = message.text;
      if (this.piSubagent !== null) {
        const harness = /^\[subagent (\S+) task \S+\]\n/.exec(text);
        if (harness !== null && harness[1] === this.piSubagent) text = text.slice(harness[0].length).trimStart() || 'pi session';
      }
      this.value.firstUserTitle = titlePreview(text);
    }
    this.value.replacedInMessages += replaced;
  }
  get recordCount(): number { return this.value.records; }
  /** The session identity, or the error that refuses the file. */
  identity(): TranscriptIdentity {
    const { first, claude, header } = this.value;
    if (first === null) throw new CollectorError('missing-session-identity');
    let producerId: string | null = null; let subagentId: string | null = null; let parentId: string | null = null;
    if (this.format === 'pi') {
      if (!first.piHeader) throw new CollectorError('missing-session-identity');
      if (!first.supportedVersion) throw new CollectorError('unsupported-version');
      producerId = first.id; parentId = first.parentSession; subagentId = this.piSubagent;
    } else if (this.format === 'claude') {
      if (claude.error !== null) throw new CollectorError(claude.error);
      producerId = claude.sessionId; subagentId = claude.agentId;
      if (subagentId === null && this.sourcePath.replaceAll('\\', '/').includes('/subagents/')) subagentId = basename(this.sourcePath, '.jsonl').replace(/^agent-/, '');
    } else if (header !== null) { producerId = header.producerId; parentId = header.parentId; }
    if (producerId === null || producerId.length === 0 || producerId === '[REDACTED]') throw new CollectorError('missing-session-identity');
    requireScalar(producerId, subagentId);
    return { producerId, subagentId, parentId };
  }
  /** Last-wins metadata, its readable strings well-formed; the title falls back to the first user message. `repairs`
   * counts the unpaired surrogates replaced in message text and metadata. */
  metadata(): { metadata: ParsedMetadata; repairs: number } {
    const state = this.value;
    const header = this.format === 'pi' ? { workdir: state.first?.cwd ?? null, startedAt: state.first?.startedAt ?? null, gitRemote: null, gitBranch: null, gitCommit: null } : state.header;
    const workdir = state.workdir ?? header?.workdir ?? null;
    let title = state.title ?? '';
    if (title === '') title = state.firstUserTitle ?? `${this.format} session`;
    let repairs = state.replacedInMessages;
    const readable = (value: string | null): string | null => { if (value === null) return null; const result = wellFormed(value); repairs += result.replaced; return result.value; };
    const metadata: ParsedMetadata = { title: readable(title)!, project: null, workdir: readable(workdir), gitRemote: readable(header?.gitRemote ?? null), gitBranch: readable(state.gitBranch ?? header?.gitBranch ?? null),
      gitCommit: readable(header?.gitCommit ?? null), model: readable(state.model), startedAt: header?.startedAt ?? state.firstTimestamp, gitRemoteObserved: false };
    metadata.project = metadata.workdir;
    return { metadata, repairs };
  }
}

export function parseTranscript(format: Format, bytes: Uint8Array, sourcePath: string, policy: PrivacyPolicy): ParsedTranscript {
  let input: string;
  try { input = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new CollectorError('invalid-utf8'); }
  if (!input.endsWith('\n')) throw new CollectorError('partial-line');
  const records: ParsedRecord[] = [];
  const rawLines: string[] = [];
  let redacted = false;
  for (const [index, line] of input.slice(0, -1).split('\n').entries()) {
    const parsed = recordOf(format, parseJson(line), line, index, policy);
    records.push(parsed.record); rawLines.push(parsed.raw); redacted ||= parsed.redacted;
  }
  const state = new TranscriptState(format, sourcePath);
  for (const record of records) state.add(record);
  const identity = state.identity();
  const duplicates = format === 'codex' ? new CodexDuplicates(Infinity) : null;
  if (duplicates !== null) for (const record of records) duplicates.add(record);
  const messages: ParsedMessage[] = [];
  for (const record of records) {
    const parsed = messageOf(format, record, duplicates, policy);
    if (parsed === null) continue;
    redacted ||= parsed.redacted; messages.push(parsed.message); state.message(parsed.message, parsed.replaced);
  }
  return { ...identity, raw: rawLines.join('\n') + '\n', redacted, records, messages, ...state.metadata() };
}
