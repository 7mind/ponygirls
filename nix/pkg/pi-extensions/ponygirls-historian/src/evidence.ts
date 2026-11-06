import { createHash } from 'node:crypto';
import { MAX_BATCH_CHARS, MAX_EVENT_CHARS, object, text, type Evidence } from './model.ts';

export function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function redact(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+_\/.=:-]+/gi, '$1 [REDACTED]')
    .replace(/(\b(?:[\w-]*[_-])?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,"'\n}]+)/gi, '$1[REDACTED]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@');
}
function redactedTree(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactedTree);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /(?:^|[_-])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization)$/i.test(key) ? '[REDACTED]' : redactedTree(item)]));
  return value;
}
function content(value: unknown, gaps: string[]): unknown {
  if (!Array.isArray(value)) return value;
  return value.flatMap<unknown>(part => {
    const block = object(part);
    if (block.type === 'thinking') return [];
    if (block.type === 'image') { gaps.push('Image content omitted'); return []; }
    if (block.type === 'text') return [{ type: 'text', text: block.text }];
    if (block.type === 'toolCall') return [{ type: 'toolCall', id: block.id, name: block.name, arguments: block.arguments }];
    gaps.push(`Unsupported content block: ${String(block.type)}`); return [];
  });
}
export function evidenceFromEntry(nativeSessionId: string, actor: string, raw: unknown): Evidence | null {
  const entry = object(raw);
  if (entry.type !== 'message' && entry.type !== 'custom_message') return null;
  const id = text(entry.id, 'entry ID', 200); const at = text(entry.timestamp, 'timestamp', 100);
  if (!Number.isFinite(Date.parse(at))) throw new Error('Invalid evidence timestamp');
  const gaps: string[] = [];
  let body: unknown;
  if (entry.type === 'custom_message') {
    if (typeof entry.customType !== 'string' || entry.customType.startsWith('historian.')) return null;
    body = { role: 'custom', customType: entry.customType, content: content(entry.content, gaps) };
  } else {
    const message = object(entry.message);
    if (message.role === 'system') return null;
    if (message.role === 'custom' && typeof message.customType === 'string' && message.customType.startsWith('historian.')) return null;
    if (!['user', 'assistant', 'toolResult', 'bashExecution', 'custom'].includes(String(message.role))) return null;
    if (message.nestedCalls !== undefined) gaps.push('Nested calls contain bounded metadata, not complete nested results');
    body = { role: message.role, content: content(message.content, gaps), toolCallId: message.toolCallId, toolName: message.toolName,
      isError: message.isError, stopReason: message.stopReason, errorMessage: message.errorMessage,
      command: message.command, output: message.output, exitCode: message.exitCode, cancelled: message.cancelled,
      truncated: message.truncated, nestedCalls: message.nestedCalls };
  }
  let rendered = JSON.stringify(redactedTree(body));
  if (rendered.length > MAX_EVENT_CHARS) {
    rendered = rendered.slice(0, MAX_EVENT_CHARS);
    gaps.push(`Evidence clipped at ${MAX_EVENT_CHARS} characters; reproduction may be incomplete`);
  }
  const evidence: Evidence = { ref: digest(JSON.stringify(['pi', nativeSessionId, id])), digest: digest(JSON.stringify(raw)),
    nativeSessionId: text(nativeSessionId, 'native session ID', 200), entryId: id,
    parentId: typeof entry.parentId === 'string' ? text(entry.parentId, 'parent entry ID', 200) : null,
    actor: text(actor, 'actor', 2000), at, text: rendered, gaps };
  if (JSON.stringify(evidence).length > MAX_BATCH_CHARS) {
    gaps.push('Evidence clipped to serialized batch bound; reproduction may be incomplete');
    let low = 0; let high = rendered.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2); evidence.text = rendered.slice(0, middle);
      if (JSON.stringify(evidence).length <= MAX_BATCH_CHARS) low = middle; else high = middle - 1;
    }
    evidence.text = rendered.slice(0, low);
    if (JSON.stringify(evidence).length > MAX_BATCH_CHARS) throw new Error('Evidence metadata exceeds batch bound');
  }
  return evidence;
}
