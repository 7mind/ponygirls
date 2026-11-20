import { randomUUID } from 'node:crypto';
import { CollectorError, hash } from './domain.ts';
import { sameStat, statSource, type SourceFile } from './discovery.ts';
import { UploadError } from './ingest.ts';
import { generateParts, type GeneratedPart, type PartsSummary } from './passes.ts';
import { INITIAL_CHAIN } from './chain.ts';
import { RecordOverLimitError } from './lines.ts';
import type { Uploader } from './uploads.ts';
import type { Config } from './config.ts';
import type { PrivacyPolicy } from './privacy.ts';
import type { EntryStatus, RecordOverLimit, Spool, Upload } from './spool.ts';
import { UploadOpen, UploadOpen_JsonCodec } from '../../generated/typescript/chronicle/api/UploadOpen.js';
import { UploadPhase } from '../../generated/typescript/chronicle/api/UploadPhase.js';
import type { UploadLimits } from '../../generated/typescript/chronicle/api/UploadLimits.js';
import { UploadState } from '../../generated/typescript/chronicle/api/UploadState.js';
import type { IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

const codec = BaboonCodecContext.Default;
export const decodeOpen = (json: string): UploadOpen => UploadOpen_JsonCodec.instance.decode(codec, JSON.parse(json) as unknown);
export const encodeOpen = (open: UploadOpen): string => JSON.stringify(UploadOpen_JsonCodec.instance.encode(codec, open));
/** `send`, wait (`held`: nothing aborted), or stop sending for the rest of the cycle (paused, privacy changed or unavailable). */
export type Gate = 'send' | 'held' | 'stop';
export type UploadOutcome =
  | { kind: 'committed'; replacement: boolean } | { kind: 'held' } | { kind: 'stop' } | { kind: 'discarded'; reason: string }
  | { kind: 'failed'; status: EntryStatus; code: string } | { kind: 'unsupported' } | { kind: 'over-limit'; row: RecordOverLimit };
export interface PartUploadContext {
  spool: Spool; uploader: Uploader; config: Config; limits: UploadLimits; policy: PrivacyPolicy; recordCap: number;
  file(fileId: string): SourceFile | undefined;
  gate(entry: Upload): Gate;
  sent(rawBytes: bigint): void;
  nextAt(attempts: number): number;
}
// The server's answer for an append whose base no longer matches: re-plan it once as a replacement.
class Replan extends Error {}
class Regeneration extends Error { constructor(readonly code: string) { super(code); } }
type Sent = { kind: 'sent'; state: UploadState } | { kind: 'expired' } | UploadOutcome;

/** One upload entry through recovery, open, parts and commit (spec §6). */
export class PartUploads {
  constructor(private readonly ctx: PartUploadContext) {}
  async run(entry: Upload): Promise<UploadOutcome> {
    let current = entry;
    for (let replanned = false; ; replanned = true) {
      try { return await this.attempt(current); }
      catch (error) {
        if (!(error instanceof Replan)) return this.fail(current, error);
        if (replanned || !current.append) return this.fail(current, new UploadError('upload-content-mismatch', false, false));
        current = this.replan(current);
      }
    }
  }
  /** An entry that must not continue (its head moved, or its policy changed): the server outcome is recovered, a live
   * attempt aborted. Kept when the server cannot be asked. Without `recover` (the head moved) a committed outcome cannot
   * become the head and the entry is discarded. */
  async retire(entry: Upload, reason: string, recover: boolean): Promise<UploadOutcome | null> {
    try {
      if (entry.uploadId !== null) {
        const state = await this.ctx.uploader.status(entry.uploadId);
        if (state?.phase === UploadPhase.Committed) return recover ? this.committed(entry, state) : this.discard(entry, reason);
        if (state?.phase === UploadPhase.Open) return await this.abandon(entry, state.uploadId, reason, recover);
      }
      return this.discard(entry, reason);
    } catch { return null; }
  }
  private async attempt(entry: Upload): Promise<UploadOutcome> {
    const { ctx } = this; const open = decodeOpen(entry.open);
    if (entry.partBudget === null) { entry = { ...entry, partBudget: String(ctx.limits.maxPartBytes) }; ctx.spool.updateUpload(entry.requestId, { partBudget: entry.partBudget }); }
    // Recover the outcome without the file first: a lost acknowledgement leaves a committed intent behind.
    let state: UploadState | null = entry.uploadId === null ? null : await ctx.uploader.status(entry.uploadId);
    if (state?.phase === UploadPhase.Failed && state.failure === 'content-mismatch') throw new Replan();
    if (state !== null && state.phase !== UploadPhase.Open && state.phase !== UploadPhase.Committed) state = null;
    if (state === null) {
      const opened = await this.open(entry, open); if (!(opened instanceof UploadState)) return opened;
      state = opened;
    }
    if (state.phase === UploadPhase.Committed) return this.committed(entry, state);
    const file = ctx.file(entry.fileId); const stat = file === undefined ? null : statSource(file);
    if (file === undefined || stat === null || !sameStat(stat, entry.file)) return this.abandon(entry, state.uploadId, 'source-changed');
    for (let reopened = false; ; reopened = true) {
      const sent = await this.send(entry, open, file, state);
      if (sent.kind === 'expired') {
        if (reopened) throw new UploadError('upload-expired', true, false);
        const opened = await this.open(entry, open); if (!(opened instanceof UploadState)) return opened;
        state = opened;
        if (state.phase === UploadPhase.Committed) return this.committed(entry, state);
        continue;
      }
      if (sent.kind !== 'sent') return sent;
      state = sent.state;
      const gate = ctx.gate(entry); if (gate !== 'send') return { kind: gate };
      let receipt: IngestReceipt;
      try { receipt = await ctx.uploader.commit(state.uploadId); }
      catch (error) {
        if (error instanceof UploadError && error.code === 'content-mismatch') throw new Replan();
        if (error instanceof UploadError && error.code === 'upload-expired' && !reopened) {
          const opened = await this.open(entry, open); if (!(opened instanceof UploadState)) return opened;
          state = opened;
          if (state.phase === UploadPhase.Committed) return this.committed(entry, state);
          continue;
        }
        throw error;
      }
      return this.acknowledged(entry, receipt);
    }
  }
  /** Every open — the first and those after an expiry — asks the live controls and the privacy policy first: an
   * expired answer can arrive after a pause, an exclusion or a policy change, and the open sends the declaration. */
  private async open(entry: Upload, open: UploadOpen): Promise<UploadState | { kind: 'held' } | { kind: 'stop' }> {
    const gate = this.ctx.gate(entry); if (gate !== 'send') return { kind: gate };
    let state: UploadState;
    try { state = await this.ctx.uploader.open(open); }
    catch (error) {
      if (error instanceof UploadError && error.code === 'base-mismatch') throw new Replan();
      throw error;
    }
    if (state.requestId !== entry.requestId || (state.phase !== UploadPhase.Open && state.phase !== UploadPhase.Committed)) throw new UploadError('invalid-upload-response', false, false);
    this.ctx.spool.updateUpload(entry.requestId, { uploadId: state.uploadId, partsAcked: state.receivedParts, lastPartSha256: state.lastPartSha256 ?? null });
    return state;
  }
  /** Regenerates the parts, skips those the attempt holds (checking the last one), sends the rest. */
  private async send(entry: Upload, open: UploadOpen, file: SourceFile, start: UploadState): Promise<Sent> {
    const { ctx } = this; let state = start;
    const parts = generateParts({ file, policy: ctx.policy, stat: entry.file, recordCap: ctx.recordCap, maxMessages: ctx.config.maxMessages,
      startRecord: entry.baseRecordCount, startOffset: BigInt(entry.baseFileOffset), baseChain: open.base?.messageChain ?? INITIAL_CHAIN,
      partBudget: Number(entry.partBudget), maxLargePartBytes: Number(ctx.limits.maxLargePartBytes) });
    const next = (): IteratorResult<GeneratedPart, PartsSummary> => {
      try { return parts.next(); }
      catch (error) { throw new Regeneration(error instanceof CollectorError ? error.code : 'snapshot-read-failed'); }
    };
    let count = 0;
    try {
      for (let step = next(); ; step = next()) {
        if (step.done === true) {
          const summary = step.value;
          // The parts must add up to the declaration: base ‖ delta (the base digest itself needs the prefix).
          if ((open.base?.rawBytes ?? 0n) + summary.rawBytes !== open.rawBytes || (open.base?.messageCount ?? 0) + summary.messages !== open.messageCount || summary.messageChain !== open.messageChain || state.receivedParts !== count) throw new Regeneration('source-changed');
          return { kind: 'sent', state };
        }
        const part = step.value; count++;
        if (part.ordinal < state.receivedParts) {
          if (part.ordinal === state.receivedParts - 1 && part.sha256 !== state.lastPartSha256) throw new Regeneration('upload-regeneration-mismatch');
          continue;
        }
        const gate = ctx.gate(entry); if (gate !== 'send') return { kind: gate };
        try { state = await ctx.uploader.part(state.uploadId, part.body, part.large); }
        catch (error) {
          if (!(error instanceof UploadError)) throw error;
          if (error.code === 'upload-expired') return { kind: 'expired' };
          if (error.code === 'upload-conflict') throw new UploadError('upload-part-conflict', true, false);
          if (error.code === 'record-too-large') return this.recordTooLarge(entry, file, part, state.uploadId);
          // Any other 413 (a proxy, another body limit) is an ordinary failure: retried, shown with its status.
          if (error.code === 'upload-too-large') throw new UploadError('http-413', true, false);
          throw error;
        }
        ctx.spool.updateUpload(entry.requestId, { partsAcked: state.receivedParts, lastPartSha256: state.lastPartSha256 ?? null });
        ctx.sent(part.rawBytes);
      }
    } catch (error) {
      if (!(error instanceof Regeneration)) throw error;
      if (error.code === 'upload-part-too-large') throw new UploadError(error.code, false, false);
      return this.abandon(entry, state.uploadId, error.code === 'record-over-limit' ? error.code : error.code === 'upload-regeneration-mismatch' ? error.code : 'source-changed');
    } finally { parts.return(undefined as unknown as PartsSummary); }
  }
  /** The server refused a record over its record cap (`record-too-large`). A part of one record puts the source in
   * `record-over-limit` with the server's limit; for a part of several the next scan applies the refreshed limit. */
  private async recordTooLarge(entry: Upload, file: SourceFile, part: GeneratedPart, uploadId: string): Promise<UploadOutcome> {
    const { ctx } = this;
    const abandoned = await this.abandon(entry, uploadId, 'record-over-limit');
    if (abandoned.kind !== 'discarded' || part.records !== 1) return abandoned;
    const row: RecordOverLimit = { fileId: entry.fileId, rootId: file.root.id, pathId: hash(file.path), format: file.root.format, stat: entry.file, recordIndex: part.firstRecord,
      size: String(part.rawBytes - 1n), limit: Number(ctx.limits.maxRecordBytes), limitSource: 'server', collectorLimit: ctx.config.maxRecordBytes, serverLimit: String(ctx.limits.maxRecordBytes) };
    ctx.spool.setRecordOverLimit(row);
    return { kind: 'over-limit', row };
  }
  private committed(entry: Upload, state: UploadState): UploadOutcome {
    if (state.receipt === undefined) throw new UploadError('invalid-upload-response', false, false);
    return this.acknowledged(entry, state.receipt);
  }
  private acknowledged(entry: Upload, receipt: IngestReceipt): UploadOutcome {
    if (receipt.requestId !== entry.requestId) throw new UploadError('receipt-request-mismatch', false, false);
    this.ctx.spool.ackUpload(entry.requestId, receipt.revision);
    return { kind: 'committed', replacement: !entry.append };
  }
  private discard(entry: Upload, reason: string): UploadOutcome { this.ctx.spool.discardUpload(entry.requestId, reason); return { kind: 'discarded', reason }; }
  /** Gives the intent up by aborting its live attempt. A commit that won the race (the abort answers Committed) is
   * acknowledged instead; an abort that cannot be confirmed keeps the entry, recovered at the next cycle. An attempt the
   * server does not know cannot have committed: committed attempts are kept. */
  private async abandon(entry: Upload, uploadId: string, reason: string, recover = true): Promise<UploadOutcome> {
    let state: UploadState;
    try { state = await this.ctx.uploader.abort(uploadId); }
    catch (error) {
      if (error instanceof UploadError && error.code === 'upload-not-found') return this.discard(entry, reason);
      return this.fail(entry, error);
    }
    return state.phase === UploadPhase.Committed && recover ? this.committed(entry, state) : this.discard(entry, reason);
  }
  /** A replacement under a new intent: no base, all content in parts from the start of the file. */
  private replan(entry: Upload): Upload {
    const requestId = randomUUID();
    const open = decodeOpen(entry.open).with({ requestId, base: undefined });
    const next: Upload = { ...entry, requestId, open: encodeOpen(open), uploadId: null, append: false, baseRecordCount: 0, baseFileOffset: '0', partBudget: null, partsAcked: 0, lastPartSha256: null, attempts: 0, nextAt: 0, status: 'pending', error: null };
    this.ctx.spool.replanUpload(entry.requestId, next);
    return next;
  }
  private fail(entry: Upload, error: unknown): UploadOutcome {
    const failure = error instanceof UploadError ? error : new UploadError(error instanceof RecordOverLimitError ? 'record-over-limit' : error instanceof CollectorError ? error.code : 'upload-failed', false, false);
    if (failure.code === 'server-upload-unsupported') return { kind: 'unsupported' };
    const code = failure.code === 'upload-conflict' ? 'cas-conflict' : failure.code;
    const status = this.ctx.spool.failUpload(entry.requestId, code, this.ctx.nextAt(entry.attempts), failure.conflict, failure.retryable ? this.ctx.config.maxAttempts : 1, code === 'upload-too-large' ? this.refused(entry) : undefined);
    return { kind: 'failed', status, code };
  }
  /** What the server refused at open: the declared raw bytes or messages, against its limit. */
  private refused(entry: Upload): Upload['refused'] {
    const open = decodeOpen(entry.open); const limits = this.ctx.limits;
    return open.rawBytes > limits.maxRawBytes ? { measured: String(open.rawBytes), limit: String(limits.maxRawBytes), unit: 'bytes' } : { measured: String(open.messageCount), limit: String(limits.maxMessages), unit: 'messages' };
  }
}
