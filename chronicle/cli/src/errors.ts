export type ErrorCode = 'usage' | 'invalid' | 'unauthorized' | 'forbidden' | 'not-found' | 'conflict' | 'gone' | 'indexed-view-retired' | 'version-mismatch' | 'protocol-error' | 'too-large' | 'unavailable' | 'deadline' | 'uncertain' | 'credentials' | 'state';
export class CliError extends Error {
  constructor(readonly code: ErrorCode, message: string) { super(message); }
  get exitCode(): number {
    if (this.code === 'usage' || this.code === 'invalid') return 2;
    if (this.code === 'unauthorized' || this.code === 'forbidden' || this.code === 'credentials') return 3;
    if (this.code === 'not-found' || this.code === 'gone' || this.code === 'indexed-view-retired') return 4;
    if (this.code === 'conflict') return 5;
    if (this.code === 'uncertain') return 7;
    return 6;
  }
}
export class RemoteError extends CliError { constructor(code: ErrorCode, message: string, readonly remoteCode: string | null = null) { super(code, message); } }
// Server codes for a failed query embedding on a semantic/hybrid search (ModelHttp/Models.scala), with CLI-owned texts for the fallback notice.
const EMBEDDING_FAILURES: Record<string, string> = { 'model-transport': 'embedding service unreachable', 'model-timeout': 'embedding service timed out', 'model-http': 'embedding service returned an HTTP error' };
export function embeddingFailure(error: unknown): string | null {
  if (!(error instanceof RemoteError) || error.remoteCode === null || !Object.hasOwn(EMBEDDING_FAILURES, error.remoteCode)) return null;
  return `${EMBEDDING_FAILURES[error.remoteCode]} [${error.remoteCode}]`;
}
const failures: Record<string, string> = {
  unauthorized: 'Authentication rejected; login again or check the selected bearer credential.',
  forbidden: 'The selected credential is not authorized for this operation.',
  'not-found': 'Resource not found or not accessible.',
  conflict: 'Selection, revision, or receipt conflicts; inspect current state before retrying.',
  gone: 'The source was purged.',
  'indexed-view-retired': 'The exact indexed generation was retired; choose another view explicitly.',
  'version-mismatch': 'Server does not support the sole current API 1.9.0.',
  'protocol-error': 'Server protocol response was rejected.',
  invalid: 'The server rejected the request parameters.',
  'too-large': 'Request or response exceeded the size bound.',
  unavailable: 'Service temporarily unavailable; no automatic mutation retry was attempted.',
};
const TERMINAL_UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/gu;
const HAS_TERMINAL_UNSAFE = new RegExp(TERMINAL_UNSAFE.source, 'u');
/** A long text is escaped slice by slice: one replacement over a text of many controls would hold a string per match at
  * once (4 GB for a 384 MiB answer of escaped U+007F). The class holds no surrogate, so a cut pair stays unchanged. */
const TERMINAL_SAFE_SLICE = 65536;
export function terminalSafe(text: string): string {
  const escape = (c: string): string => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
  if (text.length <= TERMINAL_SAFE_SLICE) return text.replace(TERMINAL_UNSAFE, escape);
  if (!HAS_TERMINAL_UNSAFE.test(text)) return text;
  const parts: string[] = []; for (let at = 0; at < text.length; at += TERMINAL_SAFE_SLICE) parts.push(text.slice(at, at + TERMINAL_SAFE_SLICE).replace(TERMINAL_UNSAFE, escape));
  return parts.join('');
}
/** The server's failure text as the CLI shows it after its own: the request's credential masked, one terminal-safe line of
  * at most this many characters. */
export const SERVER_TEXT_CHARACTERS = 512;
export interface ServerFailure { readonly message: unknown; readonly credential: string | null }
export function serverText(code: unknown, failure: ServerFailure | null): string {
  if (failure === null || typeof failure.message !== 'string' || failure.message === '') return '';
  let text = `${typeof code === 'string' || typeof code === 'number' ? code : '(no code)'}: ${failure.message}`;
  if (failure.credential !== null && failure.credential !== '') text = text.replaceAll(failure.credential, '[credential]');
  const head = Array.from(text.slice(0, 2 * SERVER_TEXT_CHARACTERS + 2)).slice(0, SERVER_TEXT_CHARACTERS + 1).join('');
  const safe = Array.from(terminalSafe(head).replaceAll('\t', '\\u0009').replaceAll('\n', '\\u000a'));
  return ` Server ${safe.length > SERVER_TEXT_CHARACTERS ? `${safe.slice(0, SERVER_TEXT_CHARACTERS).join('')}…` : safe.join('')}`;
}
export function remoteFailure(code: unknown, failure: ServerFailure | null = null): CliError {
  const remoteCode = typeof code === 'string' ? code : null; const shown = serverText(code, failure);
  if (typeof code === 'string' && Object.hasOwn(failures, code)) return new RemoteError(code as ErrorCode, failures[code]! + shown, remoteCode);
  return new RemoteError('unavailable', 'The service returned an unrecognized error.' + shown, remoteCode);
}
export function uncertain(requestId: string | null): CliError {
  return new CliError('uncertain', requestId === null
    ? 'Mutation acknowledgement lost. Inspect account token/session state before another action; do not automatically retry.'
    : `Mutation acknowledgement lost. Recover with: chronicle receipt ${requestId}. Do not blindly retry; token secrets cannot be recovered.`);
}
