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
export class RemoteError extends CliError {}
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
export function remoteFailure(code: unknown): CliError {
  if (typeof code === 'string' && Object.hasOwn(failures, code)) return new RemoteError(code as ErrorCode, failures[code]!);
  return new RemoteError('unavailable', 'The service returned an unrecognized error.');
}
export function uncertain(requestId: string | null): CliError {
  return new CliError('uncertain', requestId === null
    ? 'Mutation acknowledgement lost. Inspect account token/session state before another action; do not automatically retry.'
    : `Mutation acknowledgement lost. Recover with: chronicle receipt ${requestId}. Do not blindly retry; token secrets cannot be recovered.`);
}
