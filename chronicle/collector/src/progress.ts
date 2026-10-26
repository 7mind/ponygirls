import { CollectorProgressUpdate, CollectorProgressUpdate_JsonCodec } from '../../generated/typescript/chronicle/api/CollectorProgressUpdate.js';
import { CollectorProgressAck, CollectorProgressAck_JsonCodec } from '../../generated/typescript/chronicle/api/CollectorProgressAck.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';
import { CollectorError } from './domain.ts';
import { endpointURL, tokenFromFile } from './ingest.ts';
import type { Config } from './config.ts';

const MAX_REPORT_BYTES = 65_536;
export interface ProgressReporter { report(update: CollectorProgressUpdate): Promise<CollectorProgressAck> }
export class HttpProgressReporter implements ProgressReporter {
  private readonly url: URL;
  constructor(private readonly config: Config) {
    this.url = endpointURL(config.endpoint, config.trustedHTTP); this.url.pathname = '/api/collector/progress';
  }
  async report(update: CollectorProgressUpdate): Promise<CollectorProgressAck> {
    try {
      const payload = JSON.stringify(CollectorProgressUpdate_JsonCodec.instance.encode(BaboonCodecContext.Default, update));
      if (Buffer.byteLength(payload) > MAX_REPORT_BYTES) throw new CollectorError('report-too-large');
      const token = tokenFromFile(this.config.tokenFile);
      const response = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: payload, redirect: 'manual', signal: AbortSignal.timeout(this.config.uploadTimeoutMs) });
      if (!response.ok) { await response.body?.cancel(); throw new CollectorError('report-http-rejected'); }
      if (response.body === null) throw new CollectorError('report-invalid-ack');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const value = await reader.read(); if (value.done) break;
        size += value.value.length;
        if (size > MAX_REPORT_BYTES) { await reader.cancel(); throw new CollectorError('report-ack-too-large'); }
        chunks.push(value.value);
      }
      let ack: CollectorProgressAck;
      try { ack = CollectorProgressAck_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
      catch { throw new CollectorError('report-invalid-ack'); }
      if (ack.sequence !== update.sequence || typeof ack.accepted !== 'boolean') throw new CollectorError('report-invalid-ack');
      return ack;
    } catch (error) {
      // Never expose remote response bodies, paths, tokens or exception messages.
      throw new CollectorError(error instanceof CollectorError && /^report-[a-z-]+$/.test(error.code) ? error.code : 'report-failed');
    }
  }
}
