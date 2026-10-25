import { randomUUID } from 'node:crypto';
import { CollectorError, hash, object, string, type CollectorReport, type Counters, type Diagnostic, type ParsedTranscript, type RootCoverage } from './domain.ts';
import { discoverRoots, excludedPath, readSnapshot, scanRoots, type SourceFile } from './discovery.ts';
import { parseTranscript } from './parsers.ts';
import { privacyPolicy } from './privacy.ts';
import { encodeSnapshot, sourceIdentity, sourceKey, UploadError, type Ingester } from './ingest.ts';
import type { Config } from './config.ts';
import type { GitMetadata, GitObservation } from './git.ts';
import type { Dropped, Spool } from './spool.ts';

export type { Counters } from './domain.ts';
interface Candidate { file: SourceFile; transcript: ParsedTranscript; key: string; digest: string }
export function policyDigest(config: Config): string {
  return hash(JSON.stringify({ endpoint: config.endpoint, roots: config.roots, homeDir: config.homeDir, yoloDir: config.yoloDir, discoverNative: config.discoverNative, discoverYolo: config.discoverYolo, exclusions: config.exclusions, redactions: config.redactions }));
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
const empty = (enabled: boolean): Counters => ({ enabled, discovered: 0, scanned: 0, scannedBytes: 0, waiting: 0, excluded: 0, unchanged: 0, enqueued: 0, uploaded: 0, uploadFailures: 0, quarantined: 0, pending: 0, stopped: 0, conflicts: 0 });
export class Collector {
  private readonly config: Config; private readonly spool: Spool; private readonly ingester: Ingester; private readonly random: () => number; private readonly git: GitMetadata;
  constructor(config: Config, spool: Spool, ingester: Ingester, random: () => number, git: GitMetadata) { this.config = config; this.spool = spool; this.ingester = ingester; this.random = random; this.git = git; }
  async runOnce(now: number): Promise<Counters> {
    const counters = empty(this.config.enabled);
    if (!this.config.enabled) return counters;
    this.spool.clearDiagnostics();
    const digest = policyDigest(this.config);
    for (const queued of this.spool.queue()) {
      if (queued.policyDigest !== digest) {
        this.spool.drop(queued.requestId, 'privacy-or-destination-changed');
        this.spool.diagnostic({ rootId: 'spool', pathId: queued.sourceKey, code: 'privacy-or-destination-changed' });
        counters.quarantined++;
      }
    }
    let scan; const coverage: RootCoverage[] = [];
    const finish = (): Counters => {
      const queue = this.spool.queue(); counters.pending = queue.filter(e => e.status === 'pending').length;
      counters.stopped = queue.filter(e => e.status === 'stopped').length; counters.conflicts = queue.filter(e => e.status === 'conflict').length;
      this.spool.saveReport({ at: now, counters, roots: coverage }); return counters;
    };
    try {
      const roots = discoverRoots(this.config, process.platform);
      for (const root of roots) coverage.push({ rootId: root.id, pathId: hash(root.path), format: root.format, discovered: 0, scanned: 0, bytes: 0, waiting: 0, excluded: 0, quarantined: 0 });
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
    const diagnose = (file: SourceFile, code: string): void => {
      this.spool.diagnostic({ rootId: file.root.id, pathId: hash(file.path), code }); counters.quarantined++; rootCoverage(file).quarantined++;
    };
    for (const diagnostic of scan.diagnostics) {
      this.spool.diagnostic(diagnostic);
      if (diagnostic.code !== 'root-missing') counters.quarantined++;
    }
    const candidates = new Map<string, Candidate[]>();
    const policy = privacyPolicy(this.config.redactions);
    for (const file of scan.files) {
      const piParts = file.relativePath.split('/');
      if (file.root.layout === 'pi-subagents' && [piParts[0], piParts[2]].some(id => id !== undefined && this.config.exclusions.sessions.includes(id))) {
        counters.excluded++; rootCoverage(file).excluded++; continue;
      }
      if (counters.scannedBytes >= this.config.maxScanBytes) { diagnose(file, 'scan-byte-limit'); break; }
      try {
        const remaining = this.config.maxScanBytes - counters.scannedBytes;
        const snapshot = readSnapshot(file, Math.min(this.config.maxFileBytes, remaining));
        counters.scanned++; counters.scannedBytes += snapshot.bytes.length;
        rootCoverage(file).scanned++; rootCoverage(file).bytes += snapshot.bytes.length;
        const pathId = hash(file.path);
        const since = this.spool.observe(pathId, `${snapshot.digest}:${snapshot.mtimeMs}`, now);
        if (excludedTranscript(snapshot.bytes, this.config)) { counters.excluded++; rootCoverage(file).excluded++; continue; }
        if (!snapshot.bytes.subarray(-1).equals(Buffer.from('\n'))) {
          if (now - since >= this.config.partialLineQuarantineMs) diagnose(file, 'partial-line-expired');
          else { counters.waiting++; rootCoverage(file).waiting++; }
          continue;
        }
        const transcript = parseTranscript(file.root.format, snapshot.bytes, file.path, policy);
        if (this.config.exclusions.sessions.includes(transcript.producerId) || (transcript.subagentId !== null && this.config.exclusions.sessions.includes(transcript.subagentId))) { counters.excluded++; continue; }
        if (transcript.messages.length > this.config.maxMessages) { diagnose(file, 'message-limit'); continue; }
        if (now - since < this.config.quietMs) { counters.waiting++; rootCoverage(file).waiting++; continue; }
        const key = sourceKey(sourceIdentity(this.spool.namespace, file.root.id, file.root.format, transcript));
        const candidate = { file, transcript, key, digest: hash(transcript.raw) };
        const existing = candidates.get(key) ?? []; existing.push(candidate); candidates.set(key, existing);
      } catch (error) { diagnose(file, error instanceof CollectorError ? error.code : 'parse-failed'); }
    }
    const queuedSources = new Set(this.spool.queue().map(entry => entry.sourceKey));
    const gitCache = new Map<string, Promise<GitObservation>>();
    for (const [key, copies] of candidates) {
      if (new Set(copies.map(copy => copy.digest)).size !== 1) { for (const copy of copies) diagnose(copy.file, 'source-identity-collision'); continue; }
      const candidate = copies[0]; if (candidate === undefined) throw new CollectorError('empty-candidate-group');
      const head = this.spool.head(key);
      if (head.tombstone) { counters.excluded++; continue; }
      if (head.digest === candidate.digest) { counters.unchanged++; continue; }
      if (queuedSources.has(key)) { counters.waiting++; continue; }
      const meta = candidate.transcript.metadata;
      if (meta.gitRemote === null && meta.workdir !== null) {
        let observation = gitCache.get(meta.workdir);
        if (observation === undefined) { observation = this.git.read(meta.workdir); gitCache.set(meta.workdir, observation); }
        const observed = await observation;
        if (observed.diagnostic !== null) this.spool.diagnostic({ rootId: candidate.file.root.id, pathId: hash(candidate.file.path), code: observed.diagnostic });
        if (observed.remote !== null) {
          const cleaned = policy.redact({ gitRemote: observed.remote });
          if (!object(cleaned.value)) throw new CollectorError('git-redaction-invariant');
          meta.gitRemote = string(cleaned.value['gitRemote']); meta.gitRemoteObserved = true;
          candidate.transcript.redacted ||= cleaned.changed;
        }
      }
      const source = sourceIdentity(this.spool.namespace, candidate.file.root.id, candidate.file.root.format, candidate.transcript);
      const requestId = randomUUID();
      const payload = encodeSnapshot(requestId, source, head.revision, candidate.transcript, candidate.file.relativePath);
      if (Buffer.byteLength(payload) > this.config.maxPayloadBytes) { diagnose(candidate.file, 'payload-too-large'); continue; }
      this.spool.enqueue({ requestId, sourceKey: key, sourceDigest: candidate.digest, payload, payloadDigest: hash(payload), expectedRevision: head.revision, policyDigest: digest, attempts: 0, nextAt: 0, status: 'pending', error: null });
      counters.enqueued++;
    }
    for (const entry of this.spool.queue()) {
      if (entry.status !== 'pending' || entry.nextAt > now) continue;
      try {
        if (hash(entry.payload) !== entry.payloadDigest) throw new UploadError('payload-digest-mismatch', false, false);
        const receipt = await this.ingester.send(entry.payload);
        if (receipt.requestId !== entry.requestId) throw new UploadError('receipt-request-mismatch', false, false);
        this.spool.ack(entry.requestId, receipt.revision); counters.uploaded++;
      } catch (error) {
        const failure = error instanceof UploadError ? error : new UploadError(error instanceof CollectorError ? error.code : 'upload-failed', false, false);
        const cap = Math.min(this.config.backoffCapMs, this.config.backoffBaseMs * 2 ** Math.min(entry.attempts, 30));
        const nextAt = now + Math.floor(this.random() * cap);
        this.spool.fail(entry.requestId, failure.code, nextAt, failure.conflict, failure.retryable ? this.config.maxAttempts : 1);
        counters.uploadFailures++;
      }
    }
    return finish();
  }
  status(): { namespace: string; queue: { requestId: string; sourceKey: string; attempts: number; nextAt: number; status: string; error: string | null }[]; diagnostics: Diagnostic[]; dropped: Dropped[]; lastRun: CollectorReport | null } {
    return { namespace: this.spool.namespace, queue: this.spool.queue().map(({ requestId, sourceKey, attempts, nextAt, status, error }) => ({ requestId, sourceKey, attempts, nextAt, status, error })), diagnostics: this.spool.diagnostics(), dropped: this.spool.dropped(), lastRun: this.spool.report() };
  }
}
