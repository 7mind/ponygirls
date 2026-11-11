import { BaboonCodecContext } from './contracts.js';
import { parseJson } from './json.js';
import { WireValidation, type WireCodecIdentity } from './wire-validation.js';

export interface Codec<T> extends WireCodecIdentity {
  encode(context: BaboonCodecContext, value: T): unknown;
  decode(context: BaboonCodecContext, value: unknown): T;
}
export class ApiFailure extends Error {
  constructor(readonly code: string) { super(code.replaceAll('-', ' ')); }
}
export type OperationName = 'login' | 'logout' | 'whoami' | 'scopes' | 'find' | 'read' | 'sources' | 'status' | 'present' | 'judge' | 'judgments' | 'apply' | 'ingest';
const API_VERSION = '0.1.0';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const REQUEST_DEADLINE_MS = 30_000;

async function responseJson(response: Response): Promise<unknown> {
  if (response.body === null) throw new ApiFailure('empty-response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ApiFailure('response-too-large');
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return parseJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ApiFailure('invalid-response'); }
}
function errorCode(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('code' in value) || typeof value.code !== 'string') return 'request-failed';
  return /^[a-z][a-z0-9-]{0,63}$/.test(value.code) ? value.code : 'request-failed';
}
export class ApiClient {
  private actor: string | null = null;
  constructor(private readonly fetcher: typeof fetch, private readonly validation: WireValidation) {}
  setActor(actor: string | null): void { this.actor = actor; }
  async get<T>(operation: OperationName, codec: Codec<T>, signal: AbortSignal): Promise<T> {
    return this.request(operation, undefined, codec, signal);
  }
  async post<I, O>(operation: OperationName, value: I, input: Codec<I>, output: Codec<O>, signal: AbortSignal): Promise<O> {
    let body: unknown;
    try { body = this.validation.normalize(input, input.encode(BaboonCodecContext.Default, value)); }
    catch { throw new ApiFailure('invalid-request'); }
    return this.request(operation, body, output, signal);
  }
  private async request<T>(operation: OperationName, body: unknown, codec: Codec<T>, signal: AbortSignal): Promise<T> {
    const options: RequestInit = {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ontology-Version': API_VERSION },
      credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_DEADLINE_MS)]),
    };
    if (this.actor !== null) {
      const headers = new Headers(options.headers);
      headers.set('X-Ontology-Actor', this.actor);
      options.headers = headers;
    }
    if (body !== undefined) options.body = JSON.stringify(body);
    const response = await this.fetcher(`/api/v1/${operation}`, options);
    const json = await responseJson(response);
    if (!response.ok) throw new ApiFailure(errorCode(json));
    try { return codec.decode(BaboonCodecContext.Default, this.validation.normalize(codec, json)); }
    catch { throw new ApiFailure('invalid-response'); }
  }
}
