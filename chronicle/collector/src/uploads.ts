import { CollectorError, object } from './domain.ts';
import { decodeReceipt, endpointURL, tokenFromFile, UploadError } from './ingest.ts';
import type { Config } from './config.ts';
import { UploadOpen, UploadOpen_JsonCodec } from '../../generated/typescript/chronicle/api/UploadOpen.js';
import { UploadState, UploadState_JsonCodec } from '../../generated/typescript/chronicle/api/UploadState.js';
import { UploadLimits, UploadLimits_JsonCodec } from '../../generated/typescript/chronicle/api/UploadLimits.js';
import { UploadPhase_values } from '../../generated/typescript/chronicle/api/UploadPhase.js';
import type { IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

/** The server answers the probe with 404 and no `Failure` body: it predates the part-upload API. */
export const SERVER_UPLOAD_UNSUPPORTED = 'server-upload-unsupported';
/** The part-upload API (append-only ingest spec §4.2): probe, open, status, part, commit, abort. */
export interface Uploader {
  probe(): Promise<UploadLimits>;
  open(open: UploadOpen): Promise<UploadState>;
  /** null when the server does not know the attempt. */
  status(uploadId: string): Promise<UploadState | null>;
  part(uploadId: string, body: string, large: boolean): Promise<UploadState>;
  commit(uploadId: string): Promise<IngestReceipt>;
  abort(uploadId: string): Promise<UploadState>;
}
const MAX_RESPONSE_BYTES = 65_536;
/** The server holds a large part for up to this long while it waits for the admission permit (spec §4.4). */
export const LARGE_PART_ADMISSION_WAIT_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SHA256 = /^[0-9a-f]{64}$/;
const codec = BaboonCodecContext.Default;
const count = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;
const validLimits = (limits: UploadLimits): boolean => [limits.maxPartBytes, limits.maxLargePartBytes, limits.maxRecordBytes, limits.maxRawBytes].every(size => size >= 1n) && count(limits.maxMessages);
export function decodeLimits(value: unknown): UploadLimits {
  let limits: UploadLimits;
  try { limits = UploadLimits_JsonCodec.instance.decode(codec, value); } catch { throw new UploadError('invalid-upload-response', false, false); }
  if (!validLimits(limits)) throw new UploadError('invalid-upload-response', false, false);
  return limits;
}
function decodeState(value: unknown): UploadState {
  let state: UploadState;
  try { state = UploadState_JsonCodec.instance.decode(codec, value); } catch { throw new UploadError('invalid-upload-response', false, false); }
  if (typeof state.uploadId !== 'string' || !UUID.test(state.uploadId) || typeof state.requestId !== 'string' || !UPLOAD_PHASES.has(state.phase) || typeof state.append !== 'boolean'
    || !count(state.receivedParts) || state.receivedRawBytes < 0n || !count(state.receivedMessages) || (state.lastPartSha256 !== undefined && !HEX_SHA256.test(state.lastPartSha256))
    || !Number.isSafeInteger(state.expiresInSeconds) || (state.failure !== undefined && typeof state.failure !== 'string') || !validLimits(state.limits)) throw new UploadError('invalid-upload-response', false, false);
  if (state.receipt !== undefined) decodeReceipt(value !== null && typeof value === 'object' ? (value as Record<string, unknown>)['receipt'] : undefined);
  return state;
}
const UPLOAD_PHASES = new Set<string>(UploadPhase_values);
/** Server failure codes the collector acts on (spec §4.3); others are rejections. */
const CONFLICT_CODES: Record<string, string> = { conflict: 'upload-conflict', 'base-mismatch': 'base-mismatch', 'upload-busy': 'upload-busy', 'content-mismatch': 'content-mismatch', 'upload-expired': 'upload-expired' };
function failure(status: number, body: unknown): UploadError {
  const code = object(body) && typeof body['code'] === 'string' && typeof body['message'] === 'string' ? body['code'] : null;
  if (status === 404) return code === null ? new UploadError(SERVER_UPLOAD_UNSUPPORTED, false, false) : new UploadError('upload-not-found', false, false);
  if (status === 401 || status === 403) return new UploadError('unauthorized', false, false);
  if (status === 409 && code !== null && Object.hasOwn(CONFLICT_CODES, code)) return new UploadError(CONFLICT_CODES[code]!, code === 'upload-busy', code === 'conflict');
  if (status === 410) return new UploadError('upload-gone', false, false);
  if (status === 413) return new UploadError('upload-too-large', false, false);
  if (status === 408 || status === 429 || status >= 500) return new UploadError(`http-${status}`, true, false);
  return new UploadError('protocol-rejected', false, false);
}
export class HttpUploader implements Uploader {
  private readonly base: URL;
  constructor(private readonly config: Config) { this.base = endpointURL(config.endpoint, config.trustedHTTP); this.base.pathname = '/api/ingest/uploads'; }
  private url(...segments: string[]): URL { const url = new URL(this.base); url.pathname = [url.pathname, ...segments.map(encodeURIComponent)].join('/'); return url; }
  private async request(method: 'GET' | 'POST', url: URL, body: string | null, timeoutMs: number): Promise<unknown> {
    const token = tokenFromFile(this.config.tokenFile);
    try {
      const response = await fetch(url, { method, headers: { ...(body === null || body === '' ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token}` }, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      const chunks: Uint8Array[] = []; let size = 0;
      if (response.body !== null) {
        const reader = response.body.getReader();
        for (;;) {
          const result = await reader.read(); if (result.done) break;
          size += result.value.length;
          if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new UploadError('upload-response-too-large', false, false); }
          chunks.push(result.value);
        }
      }
      // Never keep a response body's text: only its decoded failure code.
      let value: unknown; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { value = undefined; }
      if (!response.ok) throw failure(response.status, value);
      if (value === undefined) throw new UploadError('invalid-upload-response', false, false);
      return value;
    } catch (error) { throw error instanceof UploadError ? error : new UploadError('network-failed', true, false); }
  }
  async probe(): Promise<UploadLimits> { return decodeLimits(await this.request('GET', this.base, null, this.config.uploadTimeoutMs)); }
  async open(open: UploadOpen): Promise<UploadState> {
    return decodeState(await this.request('POST', this.base, JSON.stringify(UploadOpen_JsonCodec.instance.encode(codec, open)), this.config.uploadTimeoutMs));
  }
  async status(uploadId: string): Promise<UploadState | null> {
    try { return decodeState(await this.request('GET', this.url(uploadId), null, this.config.uploadTimeoutMs)); }
    catch (error) { if (error instanceof CollectorError && error.code === 'upload-not-found') return null; throw error; }
  }
  async part(uploadId: string, body: string, large: boolean): Promise<UploadState> {
    return decodeState(await this.request('POST', this.url(uploadId, 'parts'), body, this.config.uploadTimeoutMs + (large ? LARGE_PART_ADMISSION_WAIT_MS : 0)));
  }
  async commit(uploadId: string): Promise<IngestReceipt> { return decodeReceipt(await this.request('POST', this.url(uploadId, 'commit'), '', this.config.uploadTimeoutMs)); }
  async abort(uploadId: string): Promise<UploadState> { return decodeState(await this.request('POST', this.url(uploadId, 'abort'), '', this.config.uploadTimeoutMs)); }
}
