import { basename } from 'node:path';
import { FileSecretReader } from './runtime-privacy.ts';
import { IngestRequest, IngestRequest_JsonCodec } from '../../generated/typescript/chronicle/api/IngestRequest.js';
import { IngestReceipt, IngestReceipt_JsonCodec } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { SourceIdentity } from '../../generated/typescript/chronicle/api/SourceIdentity.js';
import { SourceFormat } from '../../generated/typescript/chronicle/api/SourceFormat.js';
import { Completion } from '../../generated/typescript/chronicle/api/Completion.js';
import { Metadata } from '../../generated/typescript/chronicle/api/Metadata.js';
import { Message } from '../../generated/typescript/chronicle/api/Message.js';
import { RawFile } from '../../generated/typescript/chronicle/api/RawFile.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';
import { CollectorError, hash, type Format, type ParsedTranscript } from './domain.ts';
import type { Config } from './config.ts';

export interface Ingester { send(payload: string): Promise<IngestReceipt> }
export class UploadError extends CollectorError {
  readonly retryable: boolean; readonly conflict: boolean;
  constructor(code: string, retryable: boolean, conflict: boolean) { super(code); this.retryable = retryable; this.conflict = conflict; }
}
const FORMATS: Record<Format, SourceFormat> = { pi: SourceFormat.Pi, claude: SourceFormat.Claude, codex: SourceFormat.Codex };
const PI_RESTORATION_FILE = /^restored-[0-9a-f]{8}-[0-9a-f]{8}\.jsonl$/;
export function sourceIdentity(namespace: string, rootId: string, format: Format, transcript: ParsedTranscript, sourcePath: string): SourceIdentity {
  const filename = basename(sourcePath.replaceAll('\\', '/'));
  const episodeNamespace = format === 'pi' && PI_RESTORATION_FILE.test(filename)
    ? `${namespace}/pi-restored/${hash(filename.slice(0, -'.jsonl'.length))}` : namespace;
  return new SourceIdentity(episodeNamespace, rootId, FORMATS[format], transcript.producerId, transcript.subagentId ?? undefined);
}
export function sourceKey(source: SourceIdentity): string {
  return hash(JSON.stringify([source.collectorNamespace, source.discoveryRootId, source.format, source.producerSessionId, source.subagentId ?? null]));
}
export function encodeSnapshot(requestId: string, source: SourceIdentity, revision: number, transcript: ParsedTranscript, logicalPath: string): string {
  const meta = transcript.metadata;
  const request = new IngestRequest(requestId, source, revision, hash(transcript.raw), Completion.Quiescent, transcript.redacted,
    new Metadata(meta.title, meta.project ?? undefined, meta.workdir ?? undefined, meta.gitRemote ?? undefined, meta.gitBranch ?? undefined, meta.gitCommit ?? undefined, source.format, meta.model ?? undefined, meta.startedAt ?? undefined, undefined, meta.gitRemoteObserved ? ['collector-observed-current-git-remote'] : []),
    transcript.messages.map(message => new Message(message.id, message.parentId ?? undefined, message.role, message.text, message.timestamp ?? undefined, message.recordIndex)),
    [new RawFile(logicalPath, hash(transcript.raw), transcript.raw)]);
  return JSON.stringify(IngestRequest_JsonCodec.instance.encode(BaboonCodecContext.Default, request));
}

export function endpointURL(endpoint: string, trustedHTTP: boolean): URL {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new CollectorError('invalid-endpoint'); }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') throw new CollectorError('endpoint-credentials-forbidden');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (trustedHTTP || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new CollectorError('insecure-endpoint');
  if (url.pathname !== '/' && url.pathname !== '/api/ingest') throw new CollectorError('invalid-endpoint-path');
  url.pathname = '/api/ingest'; return url;
}
export function tokenFromFile(path: string): string {
  try {
    const token = new FileSecretReader().read(path).trim();
    if (token.length === 0 || /\s/.test(token)) throw new CollectorError('invalid-token-file');
    return token;
  } catch { throw new UploadError('token-file-unavailable', false, false); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class HttpIngester implements Ingester {
  private readonly url: URL; private readonly config: Config;
  constructor(config: Config) { this.config = config; this.url = endpointURL(config.endpoint, config.trustedHTTP); }
  async send(payload: string): Promise<IngestReceipt> {
    const token = tokenFromFile(this.config.tokenFile);
    try {
      const response = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: payload, redirect: 'manual', signal: AbortSignal.timeout(this.config.uploadTimeoutMs) });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 409) throw new UploadError('cas-conflict', false, true);
        if (response.status === 401 || response.status === 403) throw new UploadError('unauthorized', false, false);
        if (response.status === 408 || response.status === 429 || response.status >= 500) throw new UploadError(`http-${response.status}`, true, false);
        throw new UploadError('protocol-rejected', false, false);
      }
      if (response.body === null) throw new UploadError('invalid-receipt', false, false);
      const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
      for (;;) {
        const result = await reader.read(); if (result.done) break;
        size += result.value.length;
        if (size > 65_536) { await reader.cancel(); throw new UploadError('receipt-too-large', false, false); }
        chunks.push(result.value);
      }
      let receipt: IngestReceipt;
      try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        receipt = IngestReceipt_JsonCodec.instance.decode(BaboonCodecContext.Default, value);
        if (typeof receipt.requestId !== 'string' || !UUID.test(receipt.requestId) || typeof receipt.sessionId !== 'string' || !UUID.test(receipt.sessionId) || typeof receipt.jobId !== 'string' || !UUID.test(receipt.jobId) || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1) throw new Error();
      } catch { throw new UploadError('invalid-receipt', false, false); }
      return receipt;
    } catch (error) { throw error instanceof UploadError ? error : new UploadError('network-failed', true, false); }
  }
}
