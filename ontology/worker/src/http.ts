import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';
import { parseJson } from '../../web/src/json.js';
import { WireValidation, type WireCodecIdentity } from '../../web/src/wire-validation.js';

export interface Codec<T> extends WireCodecIdentity {
  encode(context: BaboonCodecContext, value: T): unknown;
  decode(context: BaboonCodecContext, value: unknown): T;
}
export type Operation = 'whoami' | 'scopes' | 'find' | 'read' | 'status' | 'apply' | 'ingest' | 'capsule' | 'delivery';
export type RequestOutcome = 'not-sent' | 'rejected' | 'unknown';
export class WorkerFailure extends Error {
  constructor(readonly code: string, readonly outcome: RequestOutcome) { super(code); }
}
export interface HttpSettings {
  readonly origin: string;
  readonly deadlineMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
}
export interface Credentials { token(signal: AbortSignal): Promise<string> }
const API_VERSION = '0.1.0';
const MAX_WIRE_BYTES = 4 * 1024 * 1024;

export function validateHttp(settings: HttpSettings): void {
  const url = new URL(settings.origin);
  if (url.origin !== settings.origin || url.username !== '' || url.password !== '' ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new WorkerFailure('invalid-service-origin', 'not-sent');
  }
  for (const value of [settings.deadlineMs, settings.maxRequestBytes, settings.maxResponseBytes]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new WorkerFailure('invalid-http-bound', 'not-sent');
  }
  if (settings.deadlineMs > 60_000 || settings.maxRequestBytes > MAX_WIRE_BYTES || settings.maxResponseBytes > MAX_WIRE_BYTES) {
    throw new WorkerFailure('invalid-http-bound', 'not-sent');
  }
}
async function bounded<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new WorkerFailure('request-cancelled', 'unknown'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([operation(), cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}
async function responseJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  if (response.body === null) throw new WorkerFailure('empty-response', 'unknown');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await bounded(() => reader.read(), signal);
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) throw new WorkerFailure('response-capacity', 'unknown');
      chunks.push(part.value);
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    cancel();
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
export class OntologyHttp {
  constructor(private readonly settings: HttpSettings, private readonly credentials: Credentials,
    private readonly fetcher: typeof fetch, private readonly validation: WireValidation) { validateHttp(settings); }
  get<T>(operation: 'whoami' | 'scopes', output: Codec<T>, signal: AbortSignal): Promise<T> {
    return this.request(operation, undefined, output, signal);
  }
  post<I, O>(operation: Exclude<Operation, 'whoami' | 'scopes'>, value: I, input: Codec<I>, output: Codec<O>, signal: AbortSignal): Promise<O> {
    let body: string;
    try { body = JSON.stringify(this.validation.normalize(input, input.encode(BaboonCodecContext.Default, value))); }
    catch { throw new WorkerFailure('invalid-request', 'not-sent'); }
    if (Buffer.byteLength(body, 'utf8') > this.settings.maxRequestBytes) throw new WorkerFailure('request-capacity', 'not-sent');
    return this.request(operation, body, output, signal);
  }
  private async request<T>(operation: Operation, body: string | undefined, output: Codec<T>, caller: AbortSignal): Promise<T> {
    const signal = AbortSignal.any([caller, AbortSignal.timeout(this.settings.deadlineMs)]);
    let dispatched = false;
    try {
      const token = await bounded(() => this.credentials.token(signal), signal);
      if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new WorkerFailure('invalid-credential', 'not-sent');
      signal.throwIfAborted();
      dispatched = true;
      const response = await bounded(() => this.fetcher(this.settings.origin + '/api/v1/' + operation, {
        method: body === undefined ? 'GET' : 'POST', body,
        headers: { 'Content-Type': 'application/json', 'X-Ontology-Version': API_VERSION,
          Origin: this.settings.origin, Authorization: 'Bearer ' + token },
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
      }), signal);
      if (response.headers.get('X-Ontology-Version') !== API_VERSION ||
          !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')) {
        void response.body?.cancel().catch(() => {});
        throw new WorkerFailure('invalid-response-envelope', 'unknown');
      }
      const json = await responseJson(response, this.settings.maxResponseBytes, signal);
      if (!response.ok) {
        const code = typeof json === 'object' && json !== null && 'code' in json && typeof json.code === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(json.code)
          ? json.code : 'request-rejected';
        const readOnly = ['whoami', 'scopes', 'find', 'read', 'status'].includes(operation);
        const beforeCapsuleWrite = operation === 'capsule' && code === 'stale-frontier';
        throw new WorkerFailure(code, readOnly || beforeCapsuleWrite ? 'rejected' : 'unknown');
      }
      return output.decode(BaboonCodecContext.Default, this.validation.normalize(output, json));
    } catch (error) {
      if (error instanceof WorkerFailure && (dispatched || error.outcome === 'not-sent')) throw error;
      throw new WorkerFailure(dispatched ? 'transport-outcome-unknown' : 'request-unavailable', dispatched ? 'unknown' : 'not-sent');
    }
  }
}
