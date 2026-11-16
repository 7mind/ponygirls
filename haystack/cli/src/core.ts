import {randomBytes} from 'node:crypto';
import {parseRaw, isLosslessNumber, type JsonValue} from '../../web/src/lossless-json.ts';
import {stringify} from 'lossless-json';
export const VERSION = '0.1.0';
export const PROTOCOL = '1.0.0';
export const DOCUMENT_BYTES = 1024 * 1024;
export const RESPONSE_BYTES = 32 * 1024 * 1024;
export const INPUT_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 30_000;
export class CliError extends Error {
  readonly code: string; readonly exit: number; readonly details: Record<string, unknown>;
  constructor(code: string, message: string, exit: number, details: Record<string, unknown>) {
    super(message); this.code = code; this.exit = exit; this.details = details;
  }
}
export function fail(code: string, message: string, exit: number): never { throw new CliError(code, message, exit, {}); }
export function usage(message: string): never { return fail('usage', message, 2); }
export function uuidv7(): string {
  const bytes = randomBytes(16); let stamp = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) { bytes[i] = Number(stamp & 255n); stamp >>= 8n; }
  bytes[6] = (bytes[6]! & 15) | 112; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function requestId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) usage('request-id must be a canonical UUIDv7');
  return value;
}
function component(value: string): string { return encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`); }
export function key(value: string): string {
  try {
    const parts = value.split(':'); if (parts.length !== 2) throw new Error();
    for (const part of parts) {
      const raw = decodeURIComponent(part);
      if (raw.length === 0 || raw.includes('\0') || raw.length > 256 || Buffer.byteLength(raw) > 1024 || component(raw) !== part) throw new Error();
    }
    return value;
  } catch { return fail('invalid-id', 'use a canonical fully qualified project:item ID (RFC3986 uppercase percent escapes)', 2); }
}
export function integer(value: string, min: number, max: number, label: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) usage(`${label} must be a decimal integer`);
  const number = Number(value); if (!Number.isSafeInteger(number) || number < min || number > max) usage(`${label} is outside its supported range`);
  return number;
}
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function safe(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, c => `\\u{${c.codePointAt(0)!.toString(16)}}`);
}
export function exact(value: unknown, pretty: boolean): string {
  const text = stringify(value, undefined, pretty ? 2 : undefined); if (text === undefined) throw new Error('unserializable result'); return text;
}
export function parseDocument(text: string): JsonValue { return parseDocumentBound(text, DOCUMENT_BYTES); }
export function parseStoredDocument(text: string): JsonValue { return parseDocumentBound(text, 16 * DOCUMENT_BYTES); }
function parseDocumentBound(text: string, maxBytes: number): JsonValue {
  try {
    if (Buffer.byteLength(text) > maxBytes) throw new Error();
    const value = parseRaw(text);
    const stack: JsonValue[] = [value];
    while (stack.length) {
      const entry = stack.pop()!;
      if (typeof entry === 'string' && (entry.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(entry))) throw new Error();
      if (Array.isArray(entry)) { for (const child of entry) stack.push(child); }
      else if (object(entry) && !isLosslessNumber(entry)) { for (const [name, child] of Object.entries(entry)) { stack.push(name, child as JsonValue); } }
    }
    if (!object(value) || isLosslessNumber(value)) throw new Error();
    for (const name of ['title','description','type','status','importance']) if (typeof value[name] !== 'string' || value[name] === '') throw new Error();
    if (!Object.hasOwn(value,'fields') || !['required','cleared'].includes(String(value['human-attention'])) || (Object.hasOwn(value,'links') && !Array.isArray(value.links))) throw new Error();
    return value;
  } catch { return fail('invalid-document', 'document must be bounded, valid lossless Haystack JSON; duplicate keys, invalid Unicode and unsupported exponents are rejected', 2); }
}
export function envelope(text: string): unknown { return parseRaw(text); }
export const serverMessages: Readonly<Record<string,string>> = {
  'invalid-id':'invalid qualified ID', 'invalid-document':'document rejected', 'invalid-query':'query rejected',
  'invalid-cursor':'cursor rejected; retain the original query, sort, scope and limit', 'bad-envelope':'request envelope rejected',
  'not-found':'item or revision not found', 'conflict':'revision or account owner changed; re-read and deliberately edit',
  'replay-conflict':'request ID already identifies another operation; do not replace an uncertain operation',
  'unauthorized':'authentication required', 'forbidden':'operation forbidden', 'ambiguous-credentials':'ambiguous credentials',
  'too-large':'request or response exceeds a bound', 'rate-limited':'server rate limit reached',
  'version-mismatch':'server does not support the sole current API 1.0.0', 'unavailable':'service unavailable', 'invalid':'account request rejected',
};
export function serverFault(code: string, status: number, details: Record<string,unknown>): CliError {
  const recognized = Object.hasOwn(serverMessages, code); const category = recognized ? code : 'remote-error';
  return new CliError(category, recognized ? serverMessages[code]! : 'server rejected the operation', status === 401 || status === 403 ? 3 : status === 404 ? 4 : status === 409 ? 5 : status >= 500 ? 6 : 2, {status,...details});
}
