import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { IngestRequest, IngestRequest_JsonCodec } from '@ponygirls/chronicle-api/chronicle/api/IngestRequest.js';
import { IngestReceipt_JsonCodec } from '@ponygirls/chronicle-api/chronicle/api/IngestReceipt.js';
import { SourceIdentity } from '@ponygirls/chronicle-api/chronicle/api/SourceIdentity.js';
import { SourceFormat } from '@ponygirls/chronicle-api/chronicle/api/SourceFormat.js';
import { Completion } from '@ponygirls/chronicle-api/chronicle/api/Completion.js';
import { Metadata } from '@ponygirls/chronicle-api/chronicle/api/Metadata.js';
import { Message } from '@ponygirls/chronicle-api/chronicle/api/Message.js';
import { RawFile } from '@ponygirls/chronicle-api/chronicle/api/RawFile.js';
import { BaboonCodecContext } from '@ponygirls/chronicle-api/BaboonSharedRuntime.js';
import { digest } from './evidence.ts';
import { chronicleTarget, summaryText, type ChronicleBinding, type ChroniclePending, type ChronicleReceipt } from './chronicle-model.ts';
import type { ChroniclePreferencesValue } from './chronicle-preferences.ts';
import type { JournalStore } from './store.ts';

const MAX_TOKEN_BYTES = 8192;
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 65536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CHRONICLE_TIMEOUT_MS = 15000;
export class ChronicleFailure extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function tokenFromFile(path: string): string {
  let fd: number | null = null;
  try {
    if (!isAbsolute(path)) throw new Error();
    const canonical = realpathSync(path);
    if (canonical === '/nix/store' || canonical.startsWith('/nix/store/')) throw new Error();
    fd = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_TOKEN_BYTES) || (before.mode & 0o077n) !== 0n) throw new Error();
    const buffer = Buffer.alloc(MAX_TOKEN_BYTES + 1); let size = 0;
    for (;;) {
      const count = readSync(fd, buffer, size, buffer.length - size, null); size += count;
      if (count === 0 || size === buffer.length) break;
    }
    const after = fstatSync(fd, { bigint: true });
    if (size > MAX_TOKEN_BYTES || size !== Number(before.size) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error();
    const token = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)).trim();
    if (!/^[!-~]+$/.test(token)) throw new Error();
    return token;
  } catch { throw new ChronicleFailure('token-file-unavailable'); }
  finally { if (fd !== null) closeSync(fd); }
}
function boundConfiguration(settings: ChroniclePreferencesValue, tokenHash: string): ChronicleBinding {
  return { endpoint: settings.endpoint, tokenFile: settings.tokenFile, collectorNamespace: settings.collectorNamespace, tokenHash };
}
export function resolveChronicleBinding(settings: ChroniclePreferencesValue): ChronicleBinding {
  return boundConfiguration(settings, digest(tokenFromFile(settings.tokenFile)));
}
export function configuredChronicleBinding(settings: ChroniclePreferencesValue): ChronicleBinding | null {
  return settings.tokenHash === null ? null : boundConfiguration(settings, settings.tokenHash);
}
export function approvedChronicleBinding(settings: ChroniclePreferencesValue): ChronicleBinding {
  const binding = configuredChronicleBinding(settings);
  if (!settings.enabled || binding === null) throw new ChronicleFailure('upload-approval-required');
  return binding;
}
export function encodeSummary(pending: ChroniclePending): string {
  const document = pending.document, episode = document.episode;
  const content = `${JSON.stringify(document)}\n`;
  const request = new IngestRequest(pending.requestId,
    new SourceIdentity(`historian-${chronicleTarget(pending.binding)}`, document.journalId, SourceFormat.Historian, episode.episodeId, undefined),
    pending.expectedRevision, digest(content), Completion.Quiescent, true,
    new Metadata(episode.title, document.project, undefined, undefined, undefined, undefined, 'Historian', `${document.generator.provider}/${document.generator.model}`, episode.recordedAt, episode.recordedAt, ['historian-summary']),
    [new Message('episode', undefined, 'historian', summaryText(document), episode.recordedAt, 0)],
    [new RawFile('episode.jsonl', digest(content), content)]);
  const payload = JSON.stringify(IngestRequest_JsonCodec.instance.encode(BaboonCodecContext.Default, request));
  if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) throw new ChronicleFailure('payload-too-large');
  return payload;
}
export interface ChronicleTransport { send(binding: ChronicleBinding, payload: string, signal: AbortSignal): Promise<ChronicleReceipt> }
export class HttpChronicleTransport implements ChronicleTransport {
  private readonly timeoutMs: number;
  constructor(timeoutMs: number) { this.timeoutMs = timeoutMs; }
  async send(binding: ChronicleBinding, payload: string, signal: AbortSignal): Promise<ChronicleReceipt> {
    const token = tokenFromFile(binding.tokenFile);
    if (digest(token) !== binding.tokenHash) throw new ChronicleFailure('credential-changed');
    try {
      const response = await fetch(binding.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: payload,
        redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]) });
      if (!response.ok) {
        if (response.body !== null) await response.body.cancel();
        throw new ChronicleFailure(response.status === 409 ? 'cas-conflict' : response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 408 || response.status === 429 || response.status >= 500 ? `http-${response.status}` : 'protocol-rejected');
      }
      if (response.body === null) throw new ChronicleFailure('invalid-receipt');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const result = await reader.read(); if (result.done) break;
        size += result.value.length;
        if (size > MAX_RECEIPT_BYTES) { await reader.cancel(); throw new ChronicleFailure('receipt-too-large'); }
        chunks.push(result.value);
      }
      try {
        const json: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        return IngestReceipt_JsonCodec.instance.decode(BaboonCodecContext.Default, json);
      } catch { throw new ChronicleFailure('invalid-receipt'); }
    } catch (error) { throw error instanceof ChronicleFailure ? error : new ChronicleFailure('network-failed'); }
  }
}
export type ChronicleAdmission = (binding: ChronicleBinding, admit: () => void) => boolean;
export interface ChronicleDelivery { state: 'empty' | 'paused' | 'acknowledged' | 'failed'; error: string | null }
export async function deliverChronicle(store: JournalStore, binding: ChronicleBinding, transport: ChronicleTransport, signal: AbortSignal, admission: ChronicleAdmission): Promise<ChronicleDelivery> {
  signal.throwIfAborted();
  const item = store.nextChronicle(binding);
  if (item === null) return { state: 'empty', error: null };
  let payload: string;
  try { payload = item.payload === null ? encodeSummary(item) : item.payload; }
  catch (error) {
    if (!(error instanceof ChronicleFailure)) throw error;
    store.failChronicle(item.requestId, error.code);
    return { state: 'failed', error: error.code };
  }
  let response: Promise<ChronicleReceipt> | null = null;
  const authorized = admission(binding, () => {
    if (response !== null) throw new Error('Chronicle admission already consumed');
    signal.throwIfAborted();
    store.prepareChronicle(item.requestId, payload, item.expectedRevision);
    store.attemptChronicle(item.requestId);
    response = transport.send(binding, payload, signal);
  });
  if (!authorized && response === null) return { state: 'paused', error: null };
  if (!authorized || response === null) throw new Error('Chronicle admission invariant violated');
  let receipt: ChronicleReceipt;
  try {
    receipt = await response;
    if (typeof receipt.requestId !== 'string' || !UUID.test(receipt.requestId) || receipt.requestId !== item.requestId ||
      typeof receipt.sessionId !== 'string' || !UUID.test(receipt.sessionId) || (item.sessionId !== null && receipt.sessionId !== item.sessionId) ||
      typeof receipt.jobId !== 'string' || !UUID.test(receipt.jobId) || !Number.isSafeInteger(receipt.revision) || receipt.revision !== item.expectedRevision + 1) throw new ChronicleFailure('invalid-receipt');
  } catch (error) {
    const code = error instanceof ChronicleFailure ? error.code : 'network-failed';
    store.failChronicle(item.requestId, code);
    return { state: 'failed', error: code };
  }
  store.ackChronicle(item.requestId, receipt);
  return { state: 'acknowledged', error: null };
}
