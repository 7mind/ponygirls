import { CollectorProgressUpdate, CollectorProgressUpdate_JsonCodec } from '../../generated/typescript/chronicle/api/CollectorProgressUpdate.js';
import { CollectorProgressAck, CollectorProgressAck_JsonCodec } from '../../generated/typescript/chronicle/api/CollectorProgressAck.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';
import { CollectorError } from './domain.ts';
import { endpointURL, tokenFromFile } from './ingest.ts';
import { fetchOnNewConnection, requestFailure } from './requests.ts';
import type { Config } from './config.ts';

const MAX_REPORT_BYTES = 65_536;
/** A failed progress report. `reason` is a bounded class (see `requestFailure`, plus `http:<status>`, `ack-too-large`,
 * `invalid-ack`, `not-accepted`, `request-too-large`, `token-unavailable`): never remote content, paths or tokens. */
export class ReportError extends CollectorError {
  constructor(readonly reason: string) { super('report-failed'); }
}
export interface ProgressReporter { report(update: CollectorProgressUpdate): Promise<CollectorProgressAck> }
export class HttpProgressReporter implements ProgressReporter {
  private readonly url: URL;
  constructor(private readonly config: Config) {
    this.url = endpointURL(config.endpoint, config.trustedHTTP); this.url.pathname = '/api/collector/progress';
  }
  async report(update: CollectorProgressUpdate): Promise<CollectorProgressAck> {
    const payload = JSON.stringify(CollectorProgressUpdate_JsonCodec.instance.encode(BaboonCodecContext.Default, update));
    if (Buffer.byteLength(payload) > MAX_REPORT_BYTES) throw new ReportError('request-too-large');
    let token: string;
    try { token = tokenFromFile(this.config.tokenFile); } catch { throw new ReportError('token-unavailable'); }
    const timeoutMs = this.config.uploadTimeoutMs;
    try {
      const response = await fetchOnNewConnection(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: payload, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) { await response.body?.cancel(); throw new ReportError(`http:${response.status}`); }
      if (response.body === null) throw new ReportError('invalid-ack');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const value = await reader.read(); if (value.done) break;
        size += value.value.length;
        if (size > MAX_REPORT_BYTES) { await reader.cancel(); throw new ReportError('ack-too-large'); }
        chunks.push(value.value);
      }
      let ack: CollectorProgressAck;
      try { ack = CollectorProgressAck_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
      catch { throw new ReportError('invalid-ack'); }
      if (ack.sequence !== update.sequence || typeof ack.accepted !== 'boolean') throw new ReportError('invalid-ack');
      return ack;
    } catch (error) {
      // Never expose remote response bodies, paths, tokens or exception messages: only the class of the failure.
      throw error instanceof ReportError ? error : new ReportError(requestFailure(error, timeoutMs));
    }
  }
}
