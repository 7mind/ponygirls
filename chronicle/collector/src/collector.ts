import { evidenceFor, heldByControls, pathAliases, type AdmissionEvidence, type Controls } from './controls.ts';
import { randomUUID } from 'node:crypto';
import { admissionReason, holdDiagnostic, isQueueHoldDiagnostic, ROOT_DENIED } from './admission.ts';
import { CollectorError, hash, object, string, type CollectorReport, type Counters, type Diagnostic, type Format, type ParsedTranscript, type RootCoverage } from './domain.ts';
import { discoverRoots, excludedPath, readSnapshot, sameStat, scanRoots, SCAN_BUDGET_DEFERRED, SizeLimitError, statSource, type SourceFile, type SourceStat } from './discovery.ts';
import { parseTranscript } from './parsers.ts';
import { resolveRuntimePrivacy, type RuntimePrivacy, type SecretReader } from './runtime-privacy.ts';
import { encodeSnapshot, revisionMetadata, sourceIdentity, sourceKey, UploadError, type Ingester } from './ingest.ts';
import { CHECKPOINT_VERSION, CODEX_FULL_PASS, EVIDENCE_LIMITS, EvidenceLimitError, MAX_RECORD_INDEX, preflight, SOURCE_PREFIX_CHANGED, type PassStart, type PassState, type StreamedTranscript, type TranscriptPrefix } from './passes.ts';
import { Sha256 } from './sha256.ts';
import { RecordOverLimitError } from './lines.ts';
import { IDENTIFIER_UNICODE, NORMALIZATION_VERSION, payloadPredatesNormalization } from './unicode.ts';
import { MessageChain, messageDigest } from './chain.ts';
import { decodeLimits, SERVER_UPLOAD_UNSUPPORTED, type Uploader } from './uploads.ts';
import { decodeOpen, encodeOpen, PartUploads, type Gate } from './part-uploads.ts';
import { UploadOpen } from '../../generated/typescript/chronicle/api/UploadOpen.js';
import { UploadBase } from '../../generated/typescript/chronicle/api/UploadBase.js';
import { Completion } from '../../generated/typescript/chronicle/api/Completion.js';
import { UploadLimits_JsonCodec, type UploadLimits } from '../../generated/typescript/chronicle/api/UploadLimits.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';
import { CollectorPhase } from '../../generated/typescript/chronicle/api/CollectorPhase.js';
import { CollectorCounters } from '../../generated/typescript/chronicle/api/CollectorCounters.js';
import { CollectorProgressUpdate } from '../../generated/typescript/chronicle/api/CollectorProgressUpdate.js';
import { ReportError, type ProgressReporter } from './progress.ts';
import type { Config } from './config.ts';
import type { GitMetadata, GitObservation } from './git.ts';
import { headBase, type AppendCheckpoint, type Head, type Dropped, type EntryStatus, type HeadBase, type IdentifierRefusal, type LastPass, type RecordOverLimit, type Spool, type Pending, type SourceRead, type UnicodeRepair, type Upload, type UploadProbe } from './spool.ts';
import type { CollectionOrigin } from './admission.ts';

export type { Counters } from './domain.ts';
// `read` is null for a file not read again because its stat is unchanged since a settled read. A whole read holds the
// transcript; a preflight (parts) holds what pass 1 declared and the checkpoint state it ended with.
type CandidateRead = { transcript: ParsedTranscript; stat: SourceStat } | { streamed: StreamedTranscript; stat: SourceStat; end: PassState | null };
interface Candidate { file: SourceFile; read: CandidateRead | null; key: string; digest: string; evidence: AdmissionEvidence }
const controlsDigest = (controls: Controls): string => hash(JSON.stringify(controls.exclusions));
// Overlapping roots can discover one path twice, as different sources.
const fileId = (file: SourceFile): string => hash(JSON.stringify([file.root.id, file.root.format, file.path]));
/** The observation signature: a file is read once its stat has not changed for `quietMs` (append-limits spec §2.2 item 1). */
const statSignature = (stat: SourceStat): string => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
/** The same file as at `before`, only grown or unchanged in size: same device and inode, not shorter. A file replaced
 * (another inode) or shortened can hold another session and is read again to identify it. */
const sameFileGrown = (before: SourceStat, now: SourceStat): boolean => before.dev === now.dev && before.ino === now.ino && BigInt(now.size) >= BigInt(before.size);
/** A checkpoint read back from the spool has the fields an incremental pass resumes from. */
const resumable = (checkpoint: AppendCheckpoint): boolean => {
  const state = object(checkpoint.state) ? checkpoint.state : null;
  return state !== null && object(state.transcript) && object(state.evidence) && Array.isArray(state.evidence.values) && typeof state.rawState === 'string' && typeof state.fileOffset === 'string'
    && typeof state.filePrefixSha256 === 'string' && typeof state.dev === 'string' && typeof state.ino === 'string';
};
// Queued uploads built under another privacy/destination policy are discarded with this reason.
export const POLICY_CHANGED = 'privacy-or-destination-changed';
/** `--retry` removed a payload built before the Unicode normalization; the next scan rebuilds it from its file. */
export const RETRY_REBUILD = 'retry-rebuild';
/** A file's latest pass 1 as `--status --json` shows it, under `sources`. */
export interface SourceStatus { sourceKey: string | null; rootId: string; pathId: string; lastPass: Pick<LastPass, 'kind' | 'reason' | 'parsedBytes' | 'hashedBytes' | 'at'> }
/** A discovered file of a source and its size. */
export interface SourceLocation { path: string; bytes: number }
/** What the head becomes when a whole-file upload of `transcript` is acknowledged. */
function wholeBase(transcript: ParsedTranscript): HeadBase {
  const chain = new MessageChain(); for (const message of transcript.messages) chain.extend(messageDigest(message));
  return { rawBytes: String(Buffer.byteLength(transcript.raw)), recordCount: transcript.records.length, messageCount: transcript.messages.length, messageChain: chain.hex };
}
/** The head's prefix when the file still begins with exactly it: raw bytes, digest, messages and chain. */
function appendable(head: Head, prefix: TranscriptPrefix | null): TranscriptPrefix | null {
  const base = headBase(head);
  return base !== null && prefix !== null && prefix.recordCount === base.recordCount && prefix.digest === head.digest && String(prefix.rawBytes) === base.rawBytes
    && prefix.messageCount === base.messageCount && prefix.messageChain === base.messageChain ? prefix : null;
}
/** `--pause` holds every upload back: the code of the counters line and the text of `--pause` and the journal. */
export const COLLECTION_PAUSED = 'collection-paused';
export const COLLECTION_PAUSED_TEXT = 'Collection paused. Queued uploads are kept; --resume continues.';
/** The collector-level line of `--status` while the server has no part-upload API. */
export function uploadsPausedText(endpoint: string): string {
  return `Uploads are paused: the Chronicle server at ${endpoint} has no part-upload API (it predates S2). Nothing is lost — changed sessions are uploaded once this is fixed. Fix: upgrade the server, or set uploadProtocol = "whole" in the collector configuration (Home Manager chronicle.collector.uploadProtocol) to upload through /api/ingest.`;
}
export function policyDigest(config: Config, runtimePrivacyIdentity: string): string {
  return hash(JSON.stringify({ endpoint: config.endpoint, roots: config.roots, homeDir: config.homeDir, yoloDir: config.yoloDir, discoverNative: config.discoverNative, discoverYolo: config.discoverYolo, exclusions: config.exclusions, redactions: config.redactions, runtimePrivacyIdentity }));
}
function excludedTranscript(bytes: Buffer, config: Config): boolean {
  for (const line of bytes.toString('utf8').split('\n')) {
    if (line.length === 0) continue;
    let value: unknown; try { value = JSON.parse(line); } catch { return false; }
    if (!object(value)) continue;
    const payload = object(value['payload']) ? value['payload'] : value;
    const workdir = string(payload['cwd']);
    if (workdir !== null && excludedPath(workdir, config.exclusions.projects)) return true;
    const identityKeys = value['type'] === 'session' || value['type'] === 'session_meta' ? ['id', 'session_id'] : ['sessionId', 'agentId'];
    for (const key of identityKeys) {
      const id = string(payload[key]);
      if (id !== null && config.exclusions.sessions.includes(id)) return true;
    }
  }
  return false;
}
const SCAN_REPORT_INTERVAL_MS = 5000;
/** A queued entry is sent in a cycle at `now` only while it is pending and its backoff has passed. */
const due = (entry: { status: EntryStatus; nextAt: number }, now: number): boolean => entry.status === 'pending' && entry.nextAt <= now;
const empty = (enabled: boolean): Counters => ({ enabled, discovered: 0, scanned: 0, scannedBytes: 0, waiting: 0, excluded: 0, unchanged: 0, enqueued: 0, uploaded: 0, uploadFailures: 0, quarantined: 0, pending: 0, stopped: 0, conflicts: 0, deferred: 0, replacements: 0, paused: null });
/** A part upload as `--status` shows it; sizes are decimal byte counts. */
export interface UploadStatus { requestId: string; sourceKey: string; attempts: number; nextAt: number; status: EntryStatus; error: string | null; append: boolean; partsAcked: number; rawBytes: string; newRawBytes: string; refused?: Upload['refused'] }
/** Old-format whole payloads and part uploads, as the queue. */
interface Queued { requestId: string; sourceKey: string; status: EntryStatus; origin: CollectionOrigin; evidence: AdmissionEvidence | null }
export class Collector {
  private readonly config: Config; private readonly spool: Spool; private readonly ingester: Ingester; private readonly random: () => number; private readonly git: GitMetadata;
  /** `uploader` is required for `uploadProtocol: "parts"`. */
  constructor(config: Config, spool: Spool, ingester: Ingester, random: () => number, git: GitMetadata, private readonly reporter: ProgressReporter, private readonly secrets: SecretReader, private readonly uploader?: Uploader) {
    this.config = config; this.spool = spool; this.ingester = ingester; this.random = random; this.git = git;
    if (config.uploadProtocol === 'parts' && uploader === undefined) throw new CollectorError('uploader-required');
  }
  /** Part uploads; `whole` ignores them, as a downgraded collector does. */
  private uploads(): Upload[] { return this.config.uploadProtocol === 'parts' ? this.spool.uploads() : []; }
  private queued(): Queued[] {
    return [...this.spool.queueWithAdmission().map(({ entry, origin, evidence }) => ({ requestId: entry.requestId, sourceKey: entry.sourceKey, status: entry.status, origin, evidence })),
      ...this.uploads().map(({ requestId, sourceKey, status, origin, evidence }) => ({ requestId, sourceKey, status, origin, evidence }))];
  }
  /** The record cap of both passes: the collector's, or the server's from its latest answer when smaller. */
  private recordCap(): { cap: number; source: RecordOverLimit['limitSource']; server: string | null } {
    const stored = this.spool.serverLimits(); const server = stored === null ? null : decodeLimits(stored).maxRecordBytes;
    return server !== null && server < BigInt(this.config.maxRecordBytes) ? { cap: Number(server), source: 'server', server: String(server) } : { cap: this.config.maxRecordBytes, source: 'collector', server: server === null ? null : String(server) };
  }
  /** Where pass 1 starts for a file: its checkpoint, when that describes the committed head of its source with nothing
   * queued for it, under the current policy and limits (append-limits spec §2.2 item 3); otherwise the whole file.
   * Codex files are always read whole. */
  private passStart(id: string, format: Format, policy: string, limits: string, queued: ReadonlySet<string>): PassStart {
    if (format === 'codex') return { reason: CODEX_FULL_PASS };
    const checkpoint = this.spool.appendCheckpoint(id);
    if (checkpoint === undefined) return { reason: 'no-checkpoint' };
    if (checkpoint.version !== CHECKPOINT_VERSION) return { reason: 'checkpoint-version' };
    if (!resumable(checkpoint)) return { reason: 'checkpoint-invalid' };
    const head = this.spool.head(checkpoint.sourceKey); const base = headBase(head); const state = checkpoint.state;
    if (head.tombstone || head.revision !== checkpoint.headRevision || head.digest !== checkpoint.headDigest || base === null || base.rawBytes !== state.rawBytes
      || base.recordCount !== state.recordCount || base.messageCount !== state.messageCount || base.messageChain !== state.messageChain) return { reason: 'head-moved' };
    if (queued.has(checkpoint.sourceKey)) return { reason: 'upload-queued' };
    if (checkpoint.policyDigest !== policy) return { reason: 'policy-changed' };
    if (checkpoint.limitsDigest !== limits) return { reason: 'limits-changed' };
    let digest: string | null; try { digest = Sha256.resume(state.rawState).digest(); } catch { digest = null; }
    if (digest !== checkpoint.headDigest) return { reason: 'checkpoint-invalid' };
    return { checkpoint: state };
  }
  async runOnce(now: number): Promise<Counters> {
    const counters = empty(this.config.enabled);
    if (!this.config.enabled) return counters;
    const initiallyPaused = this.spool.controls().paused;
    if (initiallyPaused) {
      counters.paused = COLLECTION_PAUSED;
      const queue = this.queued();
      counters.pending = queue.filter(e => e.status === 'pending').length;
      counters.stopped = queue.filter(e => e.status === 'stopped').length;
      counters.conflicts = queue.filter(e => e.status === 'conflict').length;
      return counters;
    }
    this.spool.clearDiagnostics();
    // Keep only queue metadata for reporting; reloading all encoded payloads at
    // every progress checkpoint would multiply memory/IO for large backlogs.
    const queueState = new Map<string, { sourceKey: string; status: EntryStatus }>();
    for (const queued of this.queued()) queueState.set(queued.requestId, { sourceKey: queued.sourceKey, status: queued.status });
    const parts = this.config.uploadProtocol === 'parts';
    let serverUnsupported = false;
    const heldSources = new Set<string>();
    const runId = randomUUID(); const startedAt = new Date(now).toISOString();
    let totalUploadBytes = 0n; let uploadedBytes = 0n; let reportFailure = false; let lastReportAt = 0;
    const queueCounters = (): void => {
      const queue = [...queueState.values()]; counters.pending = queue.filter(e => e.status === 'pending').length;
      counters.stopped = queue.filter(e => e.status === 'stopped').length; counters.conflicts = queue.filter(e => e.status === 'conflict').length;
    };
    const publish = async (phase: CollectorPhase, current: bigint | undefined, error: string | undefined, force: boolean): Promise<void> => {
      if (!force && Date.now() - lastReportAt < SCAN_REPORT_INTERVAL_MS) return;
      lastReportAt = Date.now(); queueCounters();
      try {
        const sequence = this.spool.nextReportSequence();
        const c = counters;
        const update = new CollectorProgressUpdate(this.spool.namespace, sequence, runId, phase, startedAt,
          new CollectorCounters(c.discovered, c.scanned, c.waiting, c.excluded, c.unchanged, c.enqueued, c.uploaded, c.uploadFailures, c.quarantined, c.pending, c.stopped, c.conflicts, BigInt(c.scannedBytes)),
          totalUploadBytes, uploadedBytes, current, error);
        const ack = await this.reporter.report(update);
        if (ack.sequence !== sequence || ack.accepted !== true) throw new ReportError('not-accepted');
        this.spool.reportAccepted(sequence, Date.now());
      } catch (error) {
        // The failure's class, never its text: a reporter's bounded reason, or a local error code.
        const cause = error instanceof ReportError ? error.reason : error instanceof CollectorError ? error.code : 'unknown';
        reportFailure = true; this.spool.reportFailed('report-failed', cause);
        this.spool.diagnostic({ rootId: 'reporting', pathId: hash('reporting'), code: 'report-failed', cause });
      }
    };
    let scan; const coverage: RootCoverage[] = [];
    const finish = async (): Promise<Counters> => {
      queueCounters();
      heldSources.clear();
      const controls = this.spool.controls();
      counters.paused = controls.paused ? COLLECTION_PAUSED : serverUnsupported ? SERVER_UPLOAD_UNSUPPORTED : null;
      for (const { sourceKey, origin, evidence } of this.queued()) if (admissionReason(origin, this.config) !== null || heldByControls(controls, evidence)) heldSources.add(sourceKey);
      const admittedFailure = [...queueState.values()].some(entry => !heldSources.has(entry.sourceKey) && (entry.status === 'stopped' || entry.status === 'conflict'));
      const failed = counters.quarantined + counters.uploadFailures > 0 || admittedFailure || reportFailure || serverUnsupported;
      await publish(failed ? CollectorPhase.Failed : CollectorPhase.Idle, undefined, serverUnsupported ? SERVER_UPLOAD_UNSUPPORTED : failed ? 'collection-incomplete' : undefined, true);
      this.spool.saveReport({ at: now, counters, roots: coverage }); return counters;
    };
    const privacyUnavailable = (): void => {
      counters.quarantined++;
      this.spool.diagnostic({ rootId: 'privacy', pathId: hash('privacy'), code: 'privacy-secret-unavailable' });
    };
    let runtimePrivacy: RuntimePrivacy;
    try { runtimePrivacy = resolveRuntimePrivacy(this.config, this.secrets); }
    catch { privacyUnavailable(); return finish(); }
    const digest = policyDigest(this.config, runtimePrivacy.identity);
    // Uploads queued under another policy are never sent: discarded, their sources stay collectable and are read again under the current one.
    const discardStale = (current: string): Pending[] => {
      const kept: Pending[] = [];
      for (const queued of this.spool.queue()) {
        if (queued.policyDigest === current) { kept.push(queued); continue; }
        this.spool.discard(queued.requestId, POLICY_CHANGED); queueState.delete(queued.requestId);
        this.spool.diagnostic({ rootId: 'spool', pathId: queued.sourceKey, code: POLICY_CHANGED });
        counters.quarantined++;
      }
      return kept;
    };
    // The content each queued source will have at its next revision.
    const queuedContent = new Map<string, { digest: string; revision: number }>();
    for (const queued of discardStale(digest)) queuedContent.set(queued.sourceKey, { digest: queued.sourceDigest, revision: queued.expectedRevision + 1 });
    const intents = this.uploads();
    for (const upload of intents) queuedContent.set(upload.sourceKey, { digest: upload.sourceDigest, revision: upload.expectedRevision + 1 });
    for (const { sourceKey, origin, evidence } of this.queued()) {
      const reason = admissionReason(origin, this.config);
      if (heldByControls(this.spool.controls(), evidence)) heldSources.add(sourceKey);
      if (reason !== null) { heldSources.add(sourceKey); this.spool.diagnostic(holdDiagnostic(sourceKey, reason)); }
    }
    await publish(CollectorPhase.Discovering, undefined, undefined, true);
    if (this.spool.controls().paused) return finish();
    // Probed every cycle: the answer pauses or resumes part uploads and sets the limits both passes use.
    let limits: UploadLimits | null = null;
    if (parts && this.uploader !== undefined) {
      try {
        limits = await this.uploader.probe();
        this.spool.saveProbe({ outcome: 'supported', code: null, at: now }, UploadLimits_JsonCodec.instance.encode(BaboonCodecContext.Default, limits));
      } catch (error) {
        const code = error instanceof CollectorError ? error.code : 'upload-probe-failed';
        serverUnsupported = code === SERVER_UPLOAD_UNSUPPORTED;
        this.spool.saveProbe({ outcome: serverUnsupported ? 'unsupported' : 'failed', code, at: now }, null);
        if (!serverUnsupported) { counters.uploadFailures++; this.spool.diagnostic({ rootId: 'server', pathId: hash('server'), code }); }
      }
    }
    // A file of a source whose part intent cannot be sent this cycle is not read again while it is the same file, grown:
    // without the server's limits nothing is sent, and a stopped, conflicting or backed-off intent waits. When the intent
    // is sent, the changed file aborts it and is read again.
    const unsendable = new Set(intents.filter(entry => limits === null || !due(entry, now)).map(entry => entry.sourceKey));
    const recordCap = this.recordCap();
    // Everything besides the lines, the policy and the head that pass 1's result depends on.
    const limitsDigest = (format: Format): string => hash(JSON.stringify({ format, collectorRecordBytes: this.config.maxRecordBytes, serverRecordBytes: recordCap.server,
      maxMessages: this.config.maxMessages, maxRecordIndex: MAX_RECORD_INDEX, normalization: NORMALIZATION_VERSION }));
    try {
      const roots = discoverRoots(this.config, process.platform).filter(root => {
        if (admissionReason(root.origin, this.config) === null) return true;
        this.spool.diagnostic({ rootId: root.id, pathId: hash(root.path), code: ROOT_DENIED }); return false;
      });
      for (const root of roots) coverage.push({ rootId: root.id, pathId: hash(root.path), format: root.format, discovered: 0, scanned: 0, bytes: 0, waiting: 0, excluded: 0, quarantined: 0, deferred: 0 });
      scan = scanRoots(roots, this.config);
    }
    catch (error) {
      this.spool.diagnostic({ rootId: 'discovery', pathId: hash('discovery'), code: error instanceof CollectorError ? error.code : 'discovery-failed' });
      counters.quarantined++; return finish();
    }
    counters.discovered = scan.files.length;
    const rootCoverage = (file: SourceFile): RootCoverage => {
      const row = coverage.find(root => root.rootId === file.root.id && root.pathId === hash(file.root.path) && root.format === file.root.format);
      if (row === undefined) throw new CollectorError('root-coverage-missing'); return row;
    };
    for (const file of scan.files) rootCoverage(file).discovered++;
    const diagnose = (file: SourceFile, code: string, size?: { measured: number; limit: number; values?: number }): void => {
      this.spool.diagnostic({ rootId: file.root.id, pathId: hash(file.path), code, ...size }); counters.quarantined++; rootCoverage(file).quarantined++;
    };
    // Its content is still what the head or the queued upload holds, under the same policy and controls.
    const settled = (read: SourceRead, stat: SourceStat | null, controls: Controls): boolean => {
      if (stat === null || !sameStat(stat, read.stat) || read.policyDigest !== digest || read.controlsDigest !== controlsDigest(controls)) return false;
      const head = this.spool.head(read.sourceKey); const queued = queuedContent.get(read.sourceKey);
      return !head.tombstone && ((head.digest === read.digest && head.revision === read.revision) || (queued?.digest === read.digest && queued.revision === read.revision));
    };
    for (const diagnostic of scan.diagnostics) {
      this.spool.diagnostic(diagnostic);
      if (diagnostic.code !== 'root-missing') counters.quarantined++;
    }
    await publish(CollectorPhase.Scanning, undefined, undefined, true);
    const candidates = new Map<string, Candidate[]>();
    const policy = runtimePrivacy.policy;
    const addCandidate = (candidate: Candidate): void => { const existing = candidates.get(candidate.key) ?? []; existing.push(candidate); candidates.set(candidate.key, existing); };
    // Files the budget deferred go first, oldest deferral first, so later changes cannot starve them.
    const deferredSince = this.spool.deferredScans(); const deferred = new Map<string, number>();
    const deferredAt = (file: SourceFile): number | undefined => deferredSince.get(fileId(file));
    const files = [...scan.files.filter(file => deferredAt(file) !== undefined).sort((a, b) => deferredAt(a)! - deferredAt(b)!), ...scan.files.filter(file => deferredAt(file) === undefined)];
    const queuedKeys = new Set(queuedContent.keys());
    for (const file of files) {
      await publish(CollectorPhase.Scanning, undefined, undefined, false);
      const controls = this.spool.controls();
      if (controls.paused) return finish();
      // A source can disappear or change while an awaited report yields. Keep
      // alias resolution failures inside the per-source quarantine boundary;
      // durable control-state validation above must still fail closed globally.
      let aliases: string[];
      try { aliases = pathAliases(file.path); }
      catch (error) { diagnose(file, error instanceof CollectorError ? error.code : 'source-path-unavailable'); continue; }
      if (heldByControls(controls, { paths: aliases })) { counters.excluded++; rootCoverage(file).excluded++; continue; }
      const piParts = file.relativePath.split('/');
      if (file.root.layout === 'pi-subagents' && [piParts[0], piParts[2]].some(id => id !== undefined && this.config.exclusions.sessions.includes(id))) {
        counters.excluded++; rootCoverage(file).excluded++; continue;
      }
      const pathId = hash(file.path); const id = fileId(file); const known = this.spool.sourceRead(id);
      if (known !== undefined && settled(known, statSource(file), controls)) { addCandidate({ file, read: null, key: known.sourceKey, digest: known.digest, evidence: { paths: aliases } }); continue; }
      // An identifier with an unpaired surrogate is reported once: the file is not read again until its stat or the policy changes.
      const refused = this.spool.identifierRefusal(id);
      if (refused !== undefined) {
        const stat = statSource(file);
        if (stat !== null && sameStat(stat, refused.stat) && refused.policyDigest === digest) continue;
        this.spool.clearIdentifierRefusal(id);
      }
      const refuse = (stat: SourceStat | null): void => {
        if (stat !== null) this.spool.setIdentifierRefusal({ fileId: id, rootId: file.root.id, pathId, format: file.root.format, stat, policyDigest: digest });
        diagnose(file, IDENTIFIER_UNICODE);
      };
      // A record above the record limit is reported once: the file is not read again until its stat or a limit changes.
      const over = parts ? this.spool.recordOverLimit(id) : undefined;
      if (over !== undefined) {
        const stat = statSource(file);
        if (stat !== null && sameStat(stat, over.stat) && over.collectorLimit === this.config.maxRecordBytes && over.serverLimit === recordCap.server) continue;
        this.spool.clearRecordOverLimit(id);
      }
      // Quiet by stat: nothing is read while the file's stat keeps changing. A file that changed between this stat and
      // the read starts its quiet period again (the observation of the read's stat below).
      const observed = statSource(file);
      if (observed !== null && now - this.spool.observe(pathId, statSignature(observed), now) < this.config.quietMs) { counters.waiting++; rootCoverage(file).waiting++; continue; }
      if (known !== undefined && observed !== null && unsendable.has(known.sourceKey) && sameFileGrown(known.stat, observed)) { counters.waiting++; rootCoverage(file).waiting++; continue; }
      try {
        if (parts) {
          // The head this file had at its last read: pass 1 records the prefix an append would extend.
          const hint = known === undefined ? null : headBase(this.spool.head(known.sourceKey));
          const result = preflight({ file, policy, exclusions: this.config.exclusions, maxFileBytes: this.config.maxFileBytes, scanBudget: this.config.maxScanBytes - counters.scannedBytes,
            recordCap: recordCap.cap, maxMessages: this.config.maxMessages, prefixRecords: hint?.recordCount ?? null, start: this.passStart(id, file.root.format, digest, limitsDigest(file.root.format), queuedKeys) });
          const size = Number(result.size);
          counters.scanned++; counters.scannedBytes += size; rootCoverage(file).scanned++; rootCoverage(file).bytes += size;
          const read = result.transcript === null ? null : { streamed: result.transcript, key: sourceKey(sourceIdentity(this.spool.namespace, file.root.id, file.root.format, result.transcript, file.path)) };
          const { kind, reason, parsedBytes, hashedBytes } = result.pass;
          this.spool.setLastPass({ fileId: id, rootId: file.root.id, pathId, sourceKey: read?.key ?? null, kind, reason, parsedBytes: String(parsedBytes), hashedBytes: String(hashedBytes), at: now });
          // An edited prefix is shown once: the replacement's checkpoint takes the place of the one it contradicts.
          if (reason === SOURCE_PREFIX_CHANGED) this.spool.diagnostic({ rootId: file.root.id, pathId, code: SOURCE_PREFIX_CHANGED });
          const since = this.spool.observe(pathId, statSignature(result.stat), now);
          if (heldByControls(this.spool.controls(), result.evidence) || result.excluded) { counters.excluded++; rootCoverage(file).excluded++; continue; }
          if (result.partial) {
            if (now - since >= this.config.partialLineQuarantineMs) diagnose(file, 'partial-line-expired');
            else { counters.waiting++; rootCoverage(file).waiting++; }
            continue;
          }
          if (result.error === IDENTIFIER_UNICODE) { refuse(result.stat); continue; }
          if (result.error !== null || read === null) { diagnose(file, result.error ?? 'parse-failed'); continue; }
          const { streamed, key } = read;
          if (this.config.exclusions.sessions.includes(streamed.producerId) || (streamed.subagentId !== null && this.config.exclusions.sessions.includes(streamed.subagentId))) { counters.excluded++; continue; }
          if (streamed.messageCount > this.config.maxMessages) { diagnose(file, 'message-limit', { measured: streamed.messageCount, limit: this.config.maxMessages }); continue; }
          if (now - since < this.config.quietMs) { counters.waiting++; rootCoverage(file).waiting++; continue; }
          addCandidate({ file, read: { streamed, stat: result.stat, end: result.end }, key, digest: streamed.digest, evidence: result.evidence });
          continue;
        }
        const snapshot = readSnapshot(file, this.config.maxFileBytes, this.config.maxScanBytes - counters.scannedBytes);
        const evidence = evidenceFor(snapshot.bytes, file.path);
        counters.scanned++; counters.scannedBytes += snapshot.bytes.length;
        rootCoverage(file).scanned++; rootCoverage(file).bytes += snapshot.bytes.length;
        const since = this.spool.observe(pathId, statSignature(snapshot.stat), now);
        if (heldByControls(this.spool.controls(), evidence) || excludedTranscript(snapshot.bytes, this.config)) { counters.excluded++; rootCoverage(file).excluded++; continue; }
        if (!snapshot.bytes.subarray(-1).equals(Buffer.from('\n'))) {
          if (now - since >= this.config.partialLineQuarantineMs) diagnose(file, 'partial-line-expired');
          else { counters.waiting++; rootCoverage(file).waiting++; }
          continue;
        }
        const transcript = parseTranscript(file.root.format, snapshot.bytes, file.path, policy);
        if (this.config.exclusions.sessions.includes(transcript.producerId) || (transcript.subagentId !== null && this.config.exclusions.sessions.includes(transcript.subagentId))) { counters.excluded++; continue; }
        if (transcript.messages.length > this.config.maxMessages) { diagnose(file, 'message-limit', { measured: transcript.messages.length, limit: this.config.maxMessages }); continue; }
        if (now - since < this.config.quietMs) { counters.waiting++; rootCoverage(file).waiting++; continue; }
        const key = sourceKey(sourceIdentity(this.spool.namespace, file.root.id, file.root.format, transcript, file.path));
        addCandidate({ file, read: { transcript, stat: snapshot.stat }, key, digest: hash(transcript.raw), evidence });
      } catch (error) {
        const stat = error instanceof RecordOverLimitError || error instanceof EvidenceLimitError ? statSource(file) : null;
        // A pass stopped by a cap has read up to the whole file: it spends that much of the scan budget.
        if (stat !== null) counters.scannedBytes += Number(stat.size);
        if (error instanceof RecordOverLimitError && stat !== null) {
          this.spool.setRecordOverLimit({ fileId: id, rootId: file.root.id, pathId, format: file.root.format, stat, recordIndex: error.recordIndex, size: String(error.size),
            limit: error.limit, limitSource: recordCap.source, collectorLimit: this.config.maxRecordBytes, serverLimit: recordCap.server });
          diagnose(file, error.code, { measured: Number(error.size), limit: error.limit });
        }
        else if (error instanceof CollectorError && error.code === IDENTIFIER_UNICODE) refuse(statSource(file));
        else if (error instanceof EvidenceLimitError) diagnose(file, error.code, { measured: error.bytes, limit: EVIDENCE_LIMITS.bytes, values: error.values });
        else if (error instanceof SizeLimitError && error.code === SCAN_BUDGET_DEFERRED) { deferred.set(id, deferredSince.get(id) ?? now); counters.deferred++; rootCoverage(file).deferred++; }
        else diagnose(file, error instanceof CollectorError ? error.code : 'parse-failed', error instanceof SizeLimitError ? { measured: error.size, limit: error.limit } : undefined);
      }
    }
    const queuedSources = new Set([...queueState.values()].map(entry => entry.sourceKey));
    const gitCache = new Map<string, Promise<GitObservation>>();
    const reads: SourceRead[] = [];
    for (const [key, copies] of candidates) {
      await publish(CollectorPhase.Scanning, undefined, undefined, false);
      if (new Set(copies.map(copy => copy.digest)).size !== 1) { for (const copy of copies) diagnose(copy.file, 'source-identity-collision'); continue; }
      const candidate = copies[0]; if (candidate === undefined) throw new CollectorError('empty-candidate-group');
      const evidence: AdmissionEvidence = { paths: [...new Set(copies.flatMap(copy => copy.evidence.paths))], ...(copies.some(copy => copy.evidence.uncertain) ? { uncertain: true as const } : {}) };
      let controls = this.spool.controls();
      if (controls.paused) return finish();
      if (heldByControls(controls, evidence)) { counters.excluded++; continue; }
      const head = this.spool.head(key);
      if (head.tombstone) { counters.excluded++; continue; }
      const settle = (revision: number): void => {
        for (const copy of copies) if (copy.read !== null) reads.push({ fileId: fileId(copy.file), stat: copy.read.stat, sourceKey: key, digest: candidate.digest, revision, policyDigest: digest, controlsDigest: controlsDigest(controls) });
      };
      if (head.digest === candidate.digest) { counters.unchanged++; settle(head.revision); continue; }
      if (queuedSources.has(key)) {
        counters.waiting++;
        const queued = queuedContent.get(key); if (queued?.digest === candidate.digest) settle(queued.revision);
        continue;
      }
      // A file not read again holds acknowledged or queued content, so it never reaches an upload.
      const { read } = candidate; if (read === null) throw new CollectorError('stat-skip-invariant');
      const transcript = 'transcript' in read ? read.transcript : read.streamed;
      const meta = transcript.metadata;
      if (meta.gitRemote === null && meta.workdir !== null) {
        let observation = gitCache.get(meta.workdir);
        if (observation === undefined) { observation = this.git.read(meta.workdir); gitCache.set(meta.workdir, observation); }
        const observed = await observation;
        if (observed.diagnostic !== null) this.spool.diagnostic({ rootId: candidate.file.root.id, pathId: hash(candidate.file.path), code: observed.diagnostic });
        if (observed.remote !== null) {
          const cleaned = policy.redact({ gitRemote: observed.remote });
          if (!object(cleaned.value)) throw new CollectorError('git-redaction-invariant');
          meta.gitRemote = string(cleaned.value['gitRemote']); meta.gitRemoteObserved = true;
          transcript.redacted ||= cleaned.changed;
        }
      }
      controls = this.spool.controls();
      if (controls.paused) return finish();
      if (heldByControls(controls, evidence)) { counters.excluded++; continue; }
      const source = sourceIdentity(this.spool.namespace, candidate.file.root.id, candidate.file.root.format, transcript, candidate.file.path);
      const requestId = randomUUID();
      if ('streamed' in read) {
        // The declaration is spooled before anything is sent; an append extends the head's base, a replacement starts over.
        const { streamed, end } = read; const prefix = appendable(head, streamed.prefix); const base = prefix === null ? undefined : new UploadBase(prefix.digest, prefix.rawBytes, prefix.messageCount, prefix.messageChain);
        const id = fileId(candidate.file);
        const checkpoint = end === null ? null : { version: CHECKPOINT_VERSION, fileId: id, sourceKey: key, policyDigest: digest, limitsDigest: limitsDigest(candidate.file.root.format), state: end };
        const open = new UploadOpen(requestId, source, head.revision, candidate.file.relativePath, base, streamed.digest, streamed.rawBytes, streamed.messageCount, streamed.messageChain, Completion.Quiescent, streamed.redacted, revisionMetadata(source, meta));
        this.spool.planUpload({ requestId, sourceKey: key, fileId: id, open: encodeOpen(open), expectedRevision: head.revision, sourceDigest: streamed.digest,
          declared: { rawBytes: String(streamed.rawBytes), recordCount: streamed.recordCount, messageCount: streamed.messageCount, messageChain: streamed.messageChain },
          uploadId: null, append: prefix !== null, baseRecordCount: prefix?.recordCount ?? 0, baseFileOffset: String(prefix?.fileOffset ?? 0n), file: read.stat,
          partBudget: null, partsAcked: 0, lastPartSha256: null, policyDigest: digest, evidence, origin: candidate.file.root.origin, status: 'pending', attempts: 0, nextAt: 0, error: null }, checkpoint);
        this.spool.setUnicodeRepair(key, head.revision + 1, streamed.repairs);
      } else {
        const payload = encodeSnapshot(requestId, source, head.revision, read.transcript, candidate.file.relativePath);
        const payloadBytes = Buffer.byteLength(payload);
        if (payloadBytes > this.config.maxPayloadBytes) { diagnose(candidate.file, 'payload-too-large', { measured: payloadBytes, limit: this.config.maxPayloadBytes }); continue; }
        this.spool.enqueue({ requestId, sourceKey: key, sourceDigest: candidate.digest, payload, payloadDigest: hash(payload), expectedRevision: head.revision, policyDigest: digest, attempts: 0, nextAt: 0, status: 'pending', error: null, base: wholeBase(read.transcript), normalization: NORMALIZATION_VERSION }, candidate.file.root.origin, evidence);
        this.spool.setUnicodeRepair(key, head.revision + 1, read.transcript.repairs);
      }
      queueState.set(requestId, { sourceKey: key, status: 'pending' }); counters.enqueued++; settle(head.revision + 1);
    }
    this.spool.saveScan(new Set(scan.files.map(fileId)), reads, deferred);
    const uploads = this.spool.queueWithOrigins().filter(({ entry, origin }) => due(entry, now) && admissionReason(origin, this.config) === null).map(({ entry }) => entry);
    // Part uploads need the server's limits from this cycle's probe; `uploadedBytes` counts their acknowledged raw bytes.
    const partUploads = limits === null ? [] : this.uploads();
    const delta = (entry: Upload): bigint => BigInt(entry.declared.rawBytes) - (decodeOpen(entry.open).base?.rawBytes ?? 0n);
    const backoff = (attempts: number): number => now + Math.floor(this.random() * Math.min(this.config.backoffCapMs, this.config.backoffBaseMs * 2 ** Math.min(attempts, 30)));
    totalUploadBytes = uploads.reduce((sum, entry) => sum + BigInt(Buffer.byteLength(entry.payload)), 0n)
      + partUploads.filter(entry => due(entry, now)).reduce((sum, entry) => sum + delta(entry), 0n);
    await publish(CollectorPhase.Uploading, undefined, undefined, true);
    let sending = true;
    for (const entry of uploads) {
      const bytes = BigInt(Buffer.byteLength(entry.payload));
      await publish(CollectorPhase.Uploading, bytes, undefined, true);
      const controls = this.spool.controls();
      if (controls.paused) return finish();
      if (heldByControls(controls, this.spool.pendingEvidence(entry.requestId))) { heldSources.add(entry.sourceKey); continue; }
      const reason = admissionReason(this.spool.pendingOrigin(entry.requestId), this.config);
      if (reason !== null) { heldSources.add(entry.sourceKey); this.spool.diagnostic(holdDiagnostic(entry.sourceKey, reason)); continue; }
      // A secret can rotate while an earlier upload awaits its response: resolve the policy again before every send.
      // Unresolvable, nothing more is sent this cycle and the queue stays; changed, the old policy's uploads are discarded.
      let current: string;
      try { current = policyDigest(this.config, resolveRuntimePrivacy(this.config, this.secrets).identity); }
      catch { privacyUnavailable(); sending = false; break; }
      if (current !== entry.policyDigest) { discardStale(current); sending = false; break; }
      try {
        if (hash(entry.payload) !== entry.payloadDigest) throw new UploadError('payload-digest-mismatch', false, false);
        const receipt = await this.ingester.send(entry.payload);
        if (receipt.requestId !== entry.requestId) throw new UploadError('receipt-request-mismatch', false, false);
        this.spool.ack(entry.requestId, receipt.revision); queueState.delete(entry.requestId); counters.uploaded++; uploadedBytes += bytes;
      } catch (error) {
        const failure = error instanceof UploadError ? error : new UploadError(error instanceof CollectorError ? error.code : 'upload-failed', false, false);
        const status = this.spool.fail(entry.requestId, failure.code, backoff(entry.attempts), failure.conflict, failure.retryable ? this.config.maxAttempts : 1);
        queueState.set(entry.requestId, { sourceKey: entry.sourceKey, status });
        counters.uploadFailures++;
      }
      await publish(CollectorPhase.Uploading, undefined, undefined, true);
    }
    if (limits === null || !sending || this.uploader === undefined) return finish();
    // Old-format entries drain first: a source with one is not uploaded in parts until it is acknowledged or dropped.
    const draining = new Set(this.spool.queue().map(entry => entry.sourceKey));
    const discovered = new Map(scan.files.map(file => [fileId(file), file]));
    const gate = (entry: Upload): Gate => {
      const controls = this.spool.controls();
      if (controls.paused) return 'stop';
      const reason = admissionReason(entry.origin, this.config);
      if (reason !== null) this.spool.diagnostic(holdDiagnostic(entry.sourceKey, reason));
      if (reason !== null || heldByControls(controls, entry.evidence)) { heldSources.add(entry.sourceKey); return 'held'; }
      // As for whole payloads: the policy is resolved again before every request that sends content.
      let current: string;
      try { current = policyDigest(this.config, resolveRuntimePrivacy(this.config, this.secrets).identity); }
      catch { privacyUnavailable(); return 'stop'; }
      return current === entry.policyDigest ? 'send' : 'stop';
    };
    const engine = new PartUploads({ spool: this.spool, uploader: this.uploader, config: this.config, limits, policy, recordCap: recordCap.cap,
      file: id => discovered.get(id), gate, sent: bytes => { uploadedBytes += bytes; }, nextAt: backoff });
    const requeue = (entry: Upload): void => {
      queueState.delete(entry.requestId);
      const current = this.spool.uploads().find(upload => upload.sourceKey === entry.sourceKey);
      if (current !== undefined) queueState.set(current.requestId, { sourceKey: current.sourceKey, status: current.status });
    };
    for (const entry of partUploads) {
      if (draining.has(entry.sourceKey)) continue;
      const head = this.spool.head(entry.sourceKey);
      // Another revision was acknowledged (by a whole upload or a downgraded collector): this intent can no longer commit.
      if (head.tombstone || head.revision !== entry.expectedRevision) { await engine.retire(entry, 'upload-superseded', false); requeue(entry); continue; }
      // Declared under another privacy or destination policy: never sent; a committed outcome is still recorded.
      if (entry.policyDigest !== digest) {
        const outcome = await engine.retire(entry, POLICY_CHANGED, true);
        if (outcome?.kind === 'discarded') { this.spool.diagnostic({ rootId: 'spool', pathId: entry.sourceKey, code: POLICY_CHANGED }); counters.quarantined++; }
        requeue(entry); continue;
      }
      if (!due(entry, now)) continue;
      const admitted = gate(entry); if (admitted === 'held') continue; if (admitted === 'stop') break;
      await publish(CollectorPhase.Uploading, delta(entry), undefined, true);
      const outcome = await engine.run(entry);
      requeue(entry);
      if (outcome.kind === 'committed') { counters.uploaded++; if (outcome.replacement) counters.replacements++; }
      else if (outcome.kind === 'failed') counters.uploadFailures++;
      else if (outcome.kind === 'over-limit') { counters.quarantined++; this.spool.diagnostic({ rootId: outcome.row.rootId, pathId: outcome.row.pathId, code: 'record-over-limit', measured: Number(outcome.row.size), limit: outcome.row.limit }); }
      else if (outcome.kind === 'unsupported') { serverUnsupported = true; break; }
      else if (outcome.kind === 'stop') break;
      await publish(CollectorPhase.Uploading, undefined, undefined, true);
    }
    return finish();
  }
  /** `--retry`: a stopped request is retried with its exact bytes, unless it is a whole payload built before the
   * Unicode normalization that the server refuses: that one is removed, its source not tombstoned, and the next scan
   * rebuilds it from its file (the server never committed it). */
  retry(requestId: string): 'retried' | 'rebuild' {
    const entry = this.spool.queue().find(queued => queued.requestId === requestId);
    if (entry !== undefined && payloadPredatesNormalization(entry.payload, entry.normalization)) { this.spool.discard(requestId, RETRY_REBUILD); return 'rebuild'; }
    this.spool.retry(requestId); return 'retried';
  }
  /** The discovered files of the given sources, identified by reading them as a scan does; `unidentified` counts files that cannot be (over maxFileBytes, unreadable, incomplete). */
  locate(sourceKeys: ReadonlySet<string>): { files: Map<string, SourceLocation[]>; unidentified: number } {
    const files = new Map<string, SourceLocation[]>(); let unidentified = 0;
    if (sourceKeys.size === 0) return { files, unidentified };
    const { policy } = resolveRuntimePrivacy(this.config, this.secrets);
    for (const file of scanRoots(discoverRoots(this.config, process.platform), this.config).files) {
      try {
        let identity: Pick<ParsedTranscript, 'producerId' | 'subagentId'>; let bytes: number;
        // With parts, maxFileBytes is a session bound, not a memory bound: identify the file in a preflight pass.
        if (this.config.uploadProtocol === 'parts') {
          const result = preflight({ file, policy, exclusions: this.config.exclusions, maxFileBytes: this.config.maxFileBytes, scanBudget: this.config.maxFileBytes, recordCap: this.recordCap().cap, maxMessages: this.config.maxMessages, prefixRecords: null, start: { reason: 'no-checkpoint' } });
          if (result.transcript === null) throw new CollectorError(result.error ?? 'partial-line');
          identity = result.transcript; bytes = Number(result.size);
        } else {
          const snapshot = readSnapshot(file, this.config.maxFileBytes, this.config.maxFileBytes);
          identity = parseTranscript(file.root.format, snapshot.bytes, file.path, policy); bytes = snapshot.bytes.length;
        }
        const key = sourceKey(sourceIdentity(this.spool.namespace, file.root.id, file.root.format, identity, file.path));
        if (sourceKeys.has(key)) files.set(key, [...files.get(key) ?? [], { path: file.path, bytes }]);
      } catch { unidentified++; }
    }
    return { files, unidentified };
  }
  status(): { namespace: string; uploadProtocol: Config['uploadProtocol']; server: { endpoint: string; probe: UploadProbe | null }; queue: { requestId: string; sourceKey: string; attempts: number; nextAt: number; status: string; error: string | null; payloadBytes: number }[]; uploads: UploadStatus[]; recordsOverLimit: RecordOverLimit[]; identifierRefusals: IdentifierRefusal[]; unicodeRepairs: UnicodeRepair[]; diagnostics: Diagnostic[]; dropped: Dropped[]; lastRun: CollectorReport | null; reporting: ReturnType<Spool['reporting']>; controls: Controls; heldRequests: string[]; sources: SourceStatus[] } {
    const queued = this.spool.queueWithAdmission(); const uploads = this.spool.uploads();
    const restricted = this.config.excludeDefaultProfile || this.config.excludedYoloProfiles.length > 0;
    const diagnostics = this.spool.diagnostics().filter(value => !isQueueHoldDiagnostic(value) && (value.code !== ROOT_DENIED || restricted));
    for (const { sourceKey, origin } of [...queued.map(({ entry, origin }) => ({ sourceKey: entry.sourceKey, origin })), ...uploads]) {
      const reason = admissionReason(origin, this.config);
      if (reason !== null) diagnostics.push(holdDiagnostic(sourceKey, reason));
    }
    const controls = this.spool.controls();
    const held = (origin: CollectionOrigin, evidence: AdmissionEvidence | null): boolean => admissionReason(origin, this.config) !== null || heldByControls(controls, evidence);
    const heldRequests = [...queued.filter(({ origin, evidence }) => held(origin, evidence)).map(({ entry }) => entry.requestId), ...uploads.filter(entry => held(entry.origin, entry.evidence)).map(entry => entry.requestId)];
    const sources = this.spool.lastPasses().map(({ sourceKey, rootId, pathId, kind, reason, parsedBytes, hashedBytes, at }) => ({ sourceKey, rootId, pathId, lastPass: { kind, reason, parsedBytes, hashedBytes, at } }));
    return { sources, controls, heldRequests, namespace: this.spool.namespace, uploadProtocol: this.config.uploadProtocol, server: { endpoint: this.config.endpoint, probe: this.spool.probe() },
      queue: queued.map(({ entry: { requestId, sourceKey, attempts, nextAt, status, error, payload } }) => ({ requestId, sourceKey, attempts, nextAt, status, error, payloadBytes: Buffer.byteLength(payload) })),
      uploads: uploads.map(entry => {
        const open = decodeOpen(entry.open);
        return { requestId: entry.requestId, sourceKey: entry.sourceKey, attempts: entry.attempts, nextAt: entry.nextAt, status: entry.status, error: entry.error, append: entry.append, partsAcked: entry.partsAcked,
          rawBytes: entry.declared.rawBytes, newRawBytes: String(open.rawBytes - (open.base?.rawBytes ?? 0n)), ...(entry.refused === undefined ? {} : { refused: entry.refused }) };
      }),
      recordsOverLimit: this.spool.recordsOverLimit(), identifierRefusals: this.spool.identifierRefusals(), unicodeRepairs: this.spool.unicodeRepairs(), diagnostics, dropped: this.spool.dropped(), lastRun: this.spool.report(), reporting: this.spool.reporting() };
  }
}
