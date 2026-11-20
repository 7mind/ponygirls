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

/** The file-wide multiset of Codex `response_item` messages whose `event_msg` duplicates are dropped, keyed by a
 * digest of role and text. Above `limit` entries it stops counting (`overflowed`): such a file is over maxMessages. */
export class CodexDuplicates {
  private readonly counts = new Map<string, number>();
  private entries = 0;
  overflowed = false;
  constructor(private readonly limit: number) {}
  private static key(message: ParsedMessage): string {
    // UTF-16 code units keep lone surrogates distinct, as the role/text strings themselves are.
    return createHash('sha256').update(message.role, 'utf16le').update('\0', 'utf16le').update(message.text, 'utf16le').digest('base64');
  }
  add(record: ParsedRecord): void {
    if (this.overflowed || record.value['type'] !== 'response_item') return;
    const message = normalize(record, 'codex'); if (message === null) return;
    if (++this.entries > this.limit) { this.overflowed = true; this.counts.clear(); return; }
    const key = CodexDuplicates.key(message); this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }
  consume(message: ParsedMessage): boolean {
    const key = CodexDuplicates.key(message); const count = this.counts.get(key) ?? 0;
    if (count > 0) this.counts.set(key, count - 1);
    return count > 0;
  }
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
/** Session identity and metadata accumulated record by record, so that a file need not be held. */
export class TranscriptState {
  private records = 0;
  private first: { type: Json | undefined; version: Json | undefined; id: string | null; parentSession: string | null; cwd: string | null; startedAt: string | null } | null = null;
  private claude: { sessionId: string | null; agentId: string | null; error: string | null } = { sessionId: null, agentId: null, error: null };
  private header: Pick<ParsedMetadata, 'workdir' | 'startedAt' | 'gitRemote' | 'gitBranch' | 'gitCommit'> & { producerId: string | null; parentId: string | null } | null = null;
  private headerSeen = false;
  private workdir: string | null = null; private gitBranch: string | null = null; private model: string | null = null;
  private firstTimestamp: string | null = null; private title: string | null = null; private firstUserText: string | null = null;
  private replacedInMessages = 0;
  constructor(private readonly format: Format, private readonly sourcePath: string) {}
  add(record: ParsedRecord): void {
    const value = record.value;
    if (this.records++ === 0) this.first = { type: value['type'], version: value['version'], id: string(value['id']), parentSession: string(value['parentSession']), cwd: string(value['cwd']), startedAt: timestamp(value['timestamp']) };
    if (this.format === 'claude' && this.claude.error === null) {
      const found = string(value['sessionId']);
      if (found !== null && this.claude.sessionId !== null && found !== this.claude.sessionId) this.claude.error = 'mixed-session-identities';
      else {
        this.claude.sessionId = found ?? this.claude.sessionId;
        const agent = string(value['agentId']);
        if (agent !== null && this.claude.agentId !== null && agent !== this.claude.agentId) this.claude.error = 'mixed-agent-identities';
        this.claude.agentId = agent ?? this.claude.agentId;
      }
    }
    if (this.format === 'codex' && !this.headerSeen && value['type'] === 'session_meta') {
      this.headerSeen = true;
      if (object(value['payload'])) {
        const meta = value['payload']; const git = object(meta['git']) ? meta['git'] : null;
        this.header = { producerId: string(meta['id']), parentId: string(meta['parent_thread_id']) ?? string(meta['forked_from_id']), workdir: string(meta['cwd']), startedAt: timestamp(meta['timestamp']) ?? timestamp(value['timestamp']),
          gitRemote: git === null ? null : string(git['repository_url']), gitBranch: git === null ? null : string(git['branch']), gitCommit: git === null ? null : string(git['commit_hash']) };
      }
    }
    const payload = object(value['payload']) ? value['payload'] : value;
    const message = object(value['message']) ? value['message'] : payload;
    this.workdir = string(payload['cwd']) ?? this.workdir;
    this.gitBranch = string(value['gitBranch']) ?? this.gitBranch;
    this.model = string(message['model']) ?? (value['type'] === 'model_change' ? string(value['modelId']) : null) ?? this.model;
    this.firstTimestamp ??= timestamp(value['timestamp']);
    if (value['type'] === 'session_info') this.title = string(value['name']) ?? this.title;
  }
  message(message: ParsedMessage, replaced: number): void {
    if (this.firstUserText === null && message.role === 'user') this.firstUserText = message.text;
    this.replacedInMessages += replaced;
  }
  get recordCount(): number { return this.records; }
  /** The session identity, or the error that refuses the file. */
  identity(): TranscriptIdentity {
    const first = this.first;
    if (first === null) throw new CollectorError('missing-session-identity');
    let producerId: string | null = null; let subagentId: string | null = null; let parentId: string | null = null;
    if (this.format === 'pi') {
      if (first.type !== 'session') throw new CollectorError('missing-session-identity');
      if (first.version !== 3 && first.version !== 2 && first.version !== 1 && first.version !== undefined) throw new CollectorError('unsupported-version');
      producerId = first.id; parentId = first.parentSession;
      const subagentPath = /\/subagents\/[^/]+\/sessions\/([^/]+)\/[^/]+\.jsonl$/.exec(this.sourcePath.replaceAll('\\', '/'));
      if (subagentPath !== null) subagentId = subagentPath[1] ?? null;
    } else if (this.format === 'claude') {
      if (this.claude.error !== null) throw new CollectorError(this.claude.error);
      producerId = this.claude.sessionId; subagentId = this.claude.agentId;
      if (subagentId === null && this.sourcePath.replaceAll('\\', '/').includes('/subagents/')) subagentId = basename(this.sourcePath, '.jsonl').replace(/^agent-/, '');
    } else if (this.header !== null) { producerId = this.header.producerId; parentId = this.header.parentId; }
    if (producerId === null || producerId.length === 0 || producerId === '[REDACTED]') throw new CollectorError('missing-session-identity');
    requireScalar(producerId, subagentId);
    return { producerId, subagentId, parentId };
  }
  /** Last-wins metadata, its readable strings well-formed; the title falls back to the first user message. `repairs`
   * counts the unpaired surrogates replaced in message text and metadata. */
  metadata(identity: TranscriptIdentity): { metadata: ParsedMetadata; repairs: number } {
    const header = this.format === 'pi' ? { workdir: this.first?.cwd ?? null, startedAt: this.first?.startedAt ?? null, gitRemote: null, gitBranch: null, gitCommit: null } : this.header;
    const workdir = this.workdir ?? header?.workdir ?? null;
    let title = this.title ?? '';
    if (title === '') {
      let text = this.firstUserText ?? undefined;
      if (this.format === 'pi' && identity.subagentId !== null && text !== undefined) {
        const harness = /^\[subagent (\S+) task \S+\]\n/.exec(text);
        if (harness !== null && harness[1] === identity.subagentId) text = text.slice(harness[0].length).trimStart() || 'pi session';
      }
      title = text === undefined ? `${this.format} session` : titlePreview(text);
    }
    let repairs = this.replacedInMessages;
    const readable = (value: string | null): string | null => { if (value === null) return null; const result = wellFormed(value); repairs += result.replaced; return result.value; };
    const metadata: ParsedMetadata = { title: readable(title)!, project: null, workdir: readable(workdir), gitRemote: readable(header?.gitRemote ?? null), gitBranch: readable(this.gitBranch ?? header?.gitBranch ?? null),
      gitCommit: readable(header?.gitCommit ?? null), model: readable(this.model), startedAt: header?.startedAt ?? this.firstTimestamp, gitRemoteObserved: false };
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
  return { ...identity, raw: rawLines.join('\n') + '\n', redacted, records, messages, ...state.metadata(identity) };
}
