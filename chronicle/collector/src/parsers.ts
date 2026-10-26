import { basename } from 'node:path';
import { CollectorError, object, string, timestamp, type Format, type Json, type JsonObject, type ParsedMessage, type ParsedMetadata, type ParsedRecord, type ParsedTranscript } from './domain.ts';
import type { PrivacyPolicy } from './privacy.ts';

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

export function parseTranscript(format: Format, bytes: Uint8Array, sourcePath: string, policy: PrivacyPolicy): ParsedTranscript {
  let input: string;
  try { input = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new CollectorError('invalid-utf8'); }
  if (!input.endsWith('\n')) throw new CollectorError('partial-line');
  const lines = input.slice(0, -1).split('\n');
  const records: ParsedRecord[] = [];
  const rawLines: string[] = [];
  let redacted = false;
  for (const [index, line] of lines.entries()) {
    let value: Json;
    try { value = JSON.parse(line) as Json; }
    catch { throw new CollectorError('invalid-json'); }
    if (!object(value)) throw new CollectorError('invalid-record');
    ensureDepth(value, 0);
    const cleaned = policy.redact(value);
    if (!object(cleaned.value)) throw new CollectorError('invalid-record');
    value = cleaned.value;
    redacted ||= cleaned.changed;
    rawLines.push(cleaned.changed ? JSON.stringify(value) : line);
    const payload = object(value['payload']) ? value['payload'] : value;
    records.push({ value, id: string(value[format === 'claude' ? 'uuid' : 'id']) ?? (format === 'codex' ? string(payload['id']) : null), parentId: string(value[format === 'claude' ? 'parentUuid' : 'parentId']), index });
  }
  const first = records[0];
  if (first === undefined) throw new CollectorError('missing-session-identity');
  let producerId: string | null = null;
  let subagentId: string | null = null;
  let parentId: string | null = null;
  const metadata: ParsedMetadata = { title: '', project: null, workdir: null, gitRemote: null, gitBranch: null, gitCommit: null, model: null, startedAt: null, gitRemoteObserved: false };
  if (format === 'pi') {
    if (first.value['type'] !== 'session') throw new CollectorError('missing-session-identity');
    if (first.value['version'] !== 3 && first.value['version'] !== 2 && first.value['version'] !== 1 && first.value['version'] !== undefined) throw new CollectorError('unsupported-version');
    producerId = string(first.value['id']); parentId = string(first.value['parentSession']);
    metadata.workdir = string(first.value['cwd']); metadata.startedAt = timestamp(first.value['timestamp']);
    const subagentPath = /\/subagents\/[^/]+\/sessions\/([^/]+)\/[^/]+\.jsonl$/.exec(sourcePath.replaceAll('\\', '/'));
    if (subagentPath !== null) subagentId = subagentPath[1] ?? null;
  } else if (format === 'claude') {
    for (const record of records) {
      const value = record.value;
      const found = string(value['sessionId']);
      if (found !== null && producerId !== null && found !== producerId) throw new CollectorError('mixed-session-identities');
      producerId = found ?? producerId;
      const agent = string(value['agentId']);
      if (agent !== null && subagentId !== null && agent !== subagentId) throw new CollectorError('mixed-agent-identities');
      subagentId = agent ?? subagentId;
    }
    if (subagentId === null && sourcePath.replaceAll('\\', '/').includes('/subagents/')) {
      subagentId = basename(sourcePath, '.jsonl').replace(/^agent-/, '');
    }
  } else {
    const header = records.find(record => record.value['type'] === 'session_meta');
    if (header !== undefined && object(header.value['payload'])) {
      const meta = header.value['payload'];
      producerId = string(meta['id']); parentId = string(meta['parent_thread_id']) ?? string(meta['forked_from_id']);
      metadata.workdir = string(meta['cwd']); metadata.startedAt = timestamp(meta['timestamp']) ?? timestamp(header.value['timestamp']);
      if (object(meta['git'])) {
        metadata.gitRemote = string(meta['git']['repository_url']); metadata.gitBranch = string(meta['git']['branch']); metadata.gitCommit = string(meta['git']['commit_hash']);
      }
    }
  }
  if (producerId === null || producerId.length === 0 || producerId === '[REDACTED]') throw new CollectorError('missing-session-identity');
  for (const record of records) {
    const value = record.value;
    const payload = object(value['payload']) ? value['payload'] : value;
    const message = object(value['message']) ? value['message'] : payload;
    metadata.workdir = string(payload['cwd']) ?? metadata.workdir;
    metadata.gitBranch = string(value['gitBranch']) ?? metadata.gitBranch;
    metadata.model = string(message['model']) ?? (value['type'] === 'model_change' ? string(value['modelId']) : null) ?? metadata.model;
    metadata.startedAt ??= timestamp(value['timestamp']);
    if (value['type'] === 'session_info') metadata.title = string(value['name']) ?? metadata.title;
  }
  const canonical = new Map<string, number>();
  if (format === 'codex') for (const record of records) {
    if (record.value['type'] !== 'response_item') continue;
    const msg = normalize(record, format);
    if (msg !== null) { const key = `${msg.role}\0${msg.text}`; canonical.set(key, (canonical.get(key) ?? 0) + 1); }
  }
  const messages: ParsedMessage[] = [];
  for (const record of records) {
    const message = normalize(record, format);
    if (message === null) continue;
    if (format === 'codex' && record.value['type'] === 'event_msg') {
      const key = `${message.role}\0${message.text}`;
      const count = canonical.get(key) ?? 0;
      if (count > 0) { canonical.set(key, count - 1); continue; }
    }
    // Normalization joins content blocks and can reconstruct a literal that was
    // not contiguous in any raw JSON string. Apply the same policy once more.
    const cleaned = policy.redact(message.text);
    if (typeof cleaned.value !== 'string') throw new CollectorError('message-redaction-invariant');
    redacted ||= cleaned.changed;
    messages.push({ ...message, text: cleaned.value });
  }
  metadata.title ||= messages.find(message => message.role === 'user')?.text.split('\n')[0]?.slice(0, 160) ?? `${format} session`;
  metadata.project = metadata.workdir;
  return { producerId, subagentId, parentId, raw: rawLines.join('\n') + '\n', redacted, records, messages, metadata };
}
