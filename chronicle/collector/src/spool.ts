import { decodeControls, decodeEvidence, pathAliases, type Controls, type AdmissionEvidence } from './controls.ts';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, constants, existsSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CollectorError, hash, type CollectorReport, type Diagnostic, type Format } from './domain.ts';
import { rejectSymlinks, type SourceStat } from './discovery.ts';
import { decodeOrigin, type CollectionOrigin } from './admission.ts';
import { object } from './domain.ts';
import type { PassReport, PassState } from './passes.ts';

export type EntryStatus = 'pending' | 'stopped' | 'conflict';
export interface Pending {
  requestId: string; sourceKey: string; sourceDigest: string; payload: string; payloadDigest: string;
  expectedRevision: number; policyDigest: string; attempts: number; nextAt: number;
  status: EntryStatus; error: string | null;
  /** What the head becomes on the acknowledgement; absent in entries of earlier releases. */
  base?: HeadBase;
  /** The Unicode normalization version the payload was built with; absent before version 2. */
  normalization?: number;
}
export interface QueuedOrigin { entry: Pending; origin: CollectionOrigin }
export interface QueuedAdmission extends QueuedOrigin { evidence: AdmissionEvidence | null }
interface BoundOrigin { requestId: string; payloadDigest: string; sourceKey: string; origin: CollectionOrigin }
/** What a head revision holds, so that the next upload can append to it: raw bytes (decimal), records, messages, chain. */
export interface HeadBase { rawBytes: string; recordCount: number; messageCount: number; messageChain: string }
/** The base fields are absent for heads written by earlier releases or by a downgraded collector. */
export interface Head extends Partial<HeadBase> { revision: number; digest: string | null; tombstone: boolean }
export const headBase = (head: Head): HeadBase | null => head.digest === null || head.rawBytes === undefined || head.recordCount === undefined || head.messageCount === undefined || head.messageChain === undefined
  ? null : { rawBytes: head.rawBytes, recordCount: head.recordCount, messageCount: head.messageCount, messageChain: head.messageChain };
/** A part upload (bucket `upload`, index `source-upload`). Written with its complete declaration before the open is
 * sent; parts are regenerated from the file, never spooled. */
export interface Upload {
  requestId: string; sourceKey: string; fileId: string;
  /** The UploadOpen JSON. */
  open: string; expectedRevision: number; sourceDigest: string; declared: HeadBase;
  uploadId: string | null; append: boolean;
  /** Where the parts start: the base's record count and file offset (decimal). */
  baseRecordCount: number; baseFileOffset: string;
  /** The file as pass 1 read it; it must stay so until the commit. */
  file: SourceStat;
  /** The packing budget of the attempt's parts (decimal), fixed before the first open. */
  partBudget: string | null; partsAcked: number; lastPartSha256: string | null;
  policyDigest: string; evidence: AdmissionEvidence | null; origin: CollectionOrigin;
  status: EntryStatus; attempts: number; nextAt: number; error: string | null;
  /** The size or count the server refused, with its limit (decimal), for `upload-too-large`. */
  refused?: { measured: string; limit: string; unit: 'bytes' | 'messages' };
}
/** Pass 1's end state, stored with the upload that declares it (bucket `upload-checkpoint`, key request ID) and promoted
 * at its acknowledgement to the file's checkpoint of the committed head (append-limits spec §2.2 item 2). */
export interface PendingCheckpoint { version: number; fileId: string; sourceKey: string; policyDigest: string; limitsDigest: string; state: PassState }
/** A file's append checkpoint (bucket `append-checkpoint`, key file ID): the state of its committed head `headRevision`
 * with digest `headDigest`. Self-contained: nothing else in the spool is needed to resume from it. */
export interface AppendCheckpoint extends PendingCheckpoint { headRevision: number; headDigest: string }
/** The latest pass 1 over a file (bucket `last-pass`, key file ID), for `--status`. Byte counts are decimal. */
export interface LastPass { fileId: string; rootId: string; pathId: string; sourceKey: string | null; kind: PassReport['kind']; reason: PassReport['reason']; parsedBytes: string; hashedBytes: string; at: number }
/** A source file with a record above the record limit: not read again until its stat or a limit changes. */
export interface RecordOverLimit {
  fileId: string; rootId: string; pathId: string; format: Format; stat: SourceStat;
  recordIndex: number; size: string; limit: number; limitSource: 'collector' | 'server';
  collectorLimit: number; serverLimit: string | null;
  /** As `SourceRead.racy`: the file is read once more although its stat is unchanged. */
  racy?: true;
}
/** A source whose latest upload had unpaired UTF-16 surrogates replaced with U+FFFD (message text, metadata). */
export interface UnicodeRepair { sourceKey: string; revision: number; replaced: number }
/** A file refused for an identifier with an unpaired surrogate: not read again until its stat or the policy changes
 * (`racy`: once more, as `SourceRead.racy`). */
export interface IdentifierRefusal { fileId: string; rootId: string; pathId: string; format: Format; stat: SourceStat; policyDigest: string; racy?: true }
/** The latest probe of the part-upload API. */
export interface UploadProbe { outcome: 'supported' | 'unsupported' | 'failed'; code: string | null; at: number }
export interface Dropped { requestId: string; sourceKey: string; reason: string }
/** A tombstoned source with the distinct reasons of the drops recorded for it, sorted. */
export interface Tombstone { sourceKey: string; head: Head; reasons: string[] }
/** Every drop recorded for the source has `reason`: the tombstone can only come from such a drop. */
export const droppedOnlyFor = (tombstone: Tombstone, reason: string): boolean => tombstone.reasons.length === 1 && tombstone.reasons[0] === reason;
/** `cause` classifies the latest failure (see progress.ts); absent in states saved before it existed. */
export interface ReportingState { sequence: string; acceptedSequence: string | null; acceptedAt: number | null; error: string | null; cause?: string | null }
/** The stat of a file when it was last read and the settled content it had: `digest` at source `revision` (acknowledged or queued).
 * `racy`: the stat was taken so soon after the file's last change that a rewrite in the same timestamp tick could keep it
 * equal; the file is read once more (absent in records of earlier releases and when not racy). */
export interface SourceRead { fileId: string; stat: SourceStat; sourceKey: string; digest: string; revision: number; policyDigest: string; controlsDigest: string; racy?: true }
export interface Spool {
  readonly namespace: string;
  head(sourceKey: string): Head;
  observe(pathId: string, signature: string, now: number): number;
  sourceRead(fileId: string): SourceRead | undefined;
  /** Files deferred by the scan budget and when they were first deferred. */
  deferredScans(): Map<string, number>;
  /** After a complete scan: keeps read records of discovered files only, adds new ones and replaces the deferred files. */
  saveScan(discovered: ReadonlySet<string>, reads: SourceRead[], deferred: ReadonlyMap<string, number>): void;
  controls(): Controls; setPaused(paused: boolean): void; exclude(path: string): void; unexclude(path: string): void;
  pendingEvidence(requestId: string): AdmissionEvidence | null;
  enqueue(entry: Pending, origin: CollectionOrigin, evidence: AdmissionEvidence | null): void; queue(): Pending[];
  pendingOrigin(requestId: string): CollectionOrigin; queueWithOrigins(): QueuedOrigin[]; queueWithAdmission(): QueuedAdmission[];
  ack(requestId: string, revision: number): void;
  fail(requestId: string, error: string, nextAt: number, conflict: boolean, maxAttempts: number): EntryStatus;
  uploads(): Upload[];
  /** Refuses a source that already has a queued request or upload, or whose head moved. The checkpoint becomes the
   * file's append checkpoint when the upload is acknowledged. */
  planUpload(entry: Upload, checkpoint: PendingCheckpoint | null): void;
  updateUpload(requestId: string, change: Partial<Pick<Upload, 'uploadId' | 'partBudget' | 'partsAcked' | 'lastPartSha256'>>): void;
  /** In one transaction: replaces the upload by `next`, a new intent for the same source. */
  replanUpload(requestId: string, next: Upload): void;
  failUpload(requestId: string, error: string, nextAt: number, conflict: boolean, maxAttempts: number, refused?: Upload['refused']): EntryStatus;
  /** The receipt's revision becomes the head, with the declared base fields; the upload's checkpoint describes it. */
  ackUpload(requestId: string, revision: number): void;
  appendCheckpoint(fileId: string): AppendCheckpoint | undefined;
  lastPasses(): LastPass[];
  setLastPass(value: LastPass): void;
  /** Removes the upload; its source stays collectable. */
  discardUpload(requestId: string, reason: string): void;
  recordOverLimit(fileId: string): RecordOverLimit | undefined;
  recordsOverLimit(): RecordOverLimit[];
  setRecordOverLimit(value: RecordOverLimit): void;
  clearRecordOverLimit(fileId: string): void;
  /** The server's UploadLimits JSON from its latest answer, and the latest probe. */
  serverLimits(): unknown;
  saveProbe(probe: UploadProbe, limits: unknown): void;
  probe(): UploadProbe | null;
  /** Records the repairs of the upload of `revision`; none removes the record. */
  setUnicodeRepair(sourceKey: string, revision: number, replaced: number): void;
  unicodeRepairs(): UnicodeRepair[];
  identifierRefusal(fileId: string): IdentifierRefusal | undefined;
  identifierRefusals(): IdentifierRefusal[];
  setIdentifierRefusal(value: IdentifierRefusal): void;
  clearIdentifierRefusal(fileId: string): void;
  retry(requestId: string): void;
  /** Removes the request and tombstones its source: it is not collected again. */
  drop(requestId: string, reason: string): void;
  /** Removes the request; its source stays collectable. */
  discard(requestId: string, reason: string): void;
  tombstones(): Tombstone[];
  /** In one transaction: lifts the tombstones `droppedOnlyFor` `reason`, keeping revision and digest, and returns them. */
  clearTombstones(reason: string): Tombstone[];
  diagnostics(): Diagnostic[]; diagnostic(value: Diagnostic): void; clearDiagnostics(): void;
  dropped(): Dropped[];
  report(): CollectorReport | null; saveReport(report: CollectorReport): void;
  nextReportSequence(): bigint;
  reporting(): ReportingState;
  reportAccepted(sequence: bigint, at: number): void;
  /** `cause` classifies the failure (progress.ts `ReportError`). */
  reportFailed(code: string, cause: string): void;
  close(): void;
}
interface Storage {
  get<T>(bucket: string, key: string): T | undefined;
  set<T>(bucket: string, key: string, value: T): void;
  remove(bucket: string, key: string): void;
  list<T>(bucket: string): T[];
  entries<T>(bucket: string): [string, T][];
  keys(bucket: string): string[];
  clear(bucket: string): void;
  transaction<T>(run: () => T): T;
  readTransaction<T>(read: () => T): T;
  close(): void;
}
class InMemoryStorage implements Storage {
  private rows = new Map<string, string>();
  get<T>(bucket: string, key: string): T | undefined { const value = this.rows.get(`${bucket}\0${key}`); return value === undefined ? undefined : JSON.parse(value) as T; }
  set<T>(bucket: string, key: string, value: T): void { this.rows.set(`${bucket}\0${key}`, JSON.stringify(value)); }
  remove(bucket: string, key: string): void { this.rows.delete(`${bucket}\0${key}`); }
  list<T>(bucket: string): T[] { return [...this.rows].filter(([key]) => key.startsWith(`${bucket}\0`)).map(([, value]) => JSON.parse(value) as T); }
  entries<T>(bucket: string): [string, T][] { return [...this.rows].filter(([key]) => key.startsWith(`${bucket}\0`)).map(([key, value]) => [key.slice(bucket.length + 1), JSON.parse(value) as T]); }
  keys(bucket: string): string[] { return [...this.rows.keys()].filter(key => key.startsWith(`${bucket}\0`)).map(key => key.slice(bucket.length + 1)); }
  clear(bucket: string): void { for (const key of this.rows.keys()) if (key.startsWith(`${bucket}\0`)) this.rows.delete(key); }
  transaction<T>(run: () => T): T { const before = new Map(this.rows); try { return run(); } catch (error) { this.rows = before; throw error; } }
  readTransaction<T>(read: () => T): T { return read(); }
  close(): void {}
}
function secureDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 }); rejectSymlinks(path); chmodSync(path, 0o700);
}
function secureFile(path: string): void {
  const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  closeSync(fd); rejectSymlinks(path); chmodSync(path, 0o600);
}
const SPOOL_FILE = 'spool.sqlite';
export class SqliteStorage implements Storage {
  private readonly db: DatabaseSync;
  /** `create` makes and secures the directory, database and table when absent; `read-only` opens an existing database and changes nothing. */
  constructor(directory: string, access: 'create' | 'read-only' = 'create') {
    const path = join(directory, SPOOL_FILE);
    if (access === 'read-only') { rejectSymlinks(path); this.db = new DatabaseSync(path, { readOnly: true }); this.db.exec('PRAGMA busy_timeout=1000;'); return; }
    secureDirectory(directory);
    secureFile(path); this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS kv (bucket TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(bucket,key));');
  }
  initialized(): boolean { return this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kv'").get() !== undefined; }
  get<T>(bucket: string, key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE bucket=? AND key=?').get(bucket, key);
    return row === undefined ? undefined : JSON.parse(String(row['value'])) as T;
  }
  set<T>(bucket: string, key: string, value: T): void { this.db.prepare('INSERT INTO kv VALUES (?,?,?) ON CONFLICT(bucket,key) DO UPDATE SET value=excluded.value').run(bucket, key, JSON.stringify(value)); }
  remove(bucket: string, key: string): void { this.db.prepare('DELETE FROM kv WHERE bucket=? AND key=?').run(bucket, key); }
  list<T>(bucket: string): T[] { return this.db.prepare('SELECT value FROM kv WHERE bucket=? ORDER BY key').all(bucket).map(row => JSON.parse(String(row['value'])) as T); }
  entries<T>(bucket: string): [string, T][] { return this.db.prepare('SELECT key, value FROM kv WHERE bucket=? ORDER BY key').all(bucket).map(row => [String(row['key']), JSON.parse(String(row['value'])) as T]); }
  keys(bucket: string): string[] { return this.db.prepare('SELECT key FROM kv WHERE bucket=? ORDER BY key').all(bucket).map(row => String(row['key'])); }
  clear(bucket: string): void { this.db.prepare('DELETE FROM kv WHERE bucket=?').run(bucket); }
  transaction<T>(run: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = run(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  readTransaction<T>(read: () => T): T { this.db.exec('BEGIN'); try { const result = read(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  close(): void { this.db.close(); }
}
class DurableSpool implements Spool {
  readonly namespace: string;
  private readonly storage: Storage;
  /** Without `namespace` it is read from the storage, or created there on first use. */
  constructor(storage: Storage, namespace?: string) {
    this.storage = storage;
    this.namespace = namespace ?? storage.transaction(() => {
      const existing = storage.get<string>('meta', 'namespace');
      if (existing !== undefined) return existing;
      const namespace = randomUUID(); storage.set('meta', 'namespace', namespace); return namespace;
    });
  }
  head(sourceKey: string): Head { return this.storage.get<Head>('head', sourceKey) ?? { revision: 0, digest: null, tombstone: false }; }
  observe(pathId: string, signature: string, now: number): number {
    const previous = this.storage.get<{ signature: string; since: number }>('observation', pathId);
    if (previous !== undefined && previous.signature === signature && previous.since <= now) return previous.since;
    this.storage.set('observation', pathId, { signature, since: now }); return now;
  }
  sourceRead(fileId: string): SourceRead | undefined { return this.storage.get<SourceRead>('source-read', fileId); }
  deferredScans(): Map<string, number> { return new Map(this.storage.list<{ fileId: string; since: number }>('scan-deferred').map(({ fileId, since }) => [fileId, since])); }
  saveScan(discovered: ReadonlySet<string>, reads: SourceRead[], deferred: ReadonlyMap<string, number>): void {
    this.storage.transaction(() => {
      for (const { fileId } of this.storage.list<SourceRead>('source-read')) if (!discovered.has(fileId)) this.storage.remove('source-read', fileId);
      for (const { fileId } of this.recordsOverLimit()) if (!discovered.has(fileId)) this.storage.remove('record-over-limit', fileId);
      for (const { fileId } of this.identifierRefusals()) if (!discovered.has(fileId)) this.storage.remove('identifier-refusal', fileId);
      for (const fileId of this.storage.keys('append-checkpoint')) if (!discovered.has(fileId)) this.storage.remove('append-checkpoint', fileId);
      for (const fileId of this.storage.keys('last-pass')) if (!discovered.has(fileId)) this.storage.remove('last-pass', fileId);
      // Left behind when an older collector acknowledged or dropped the upload.
      for (const requestId of this.storage.keys('upload-checkpoint')) if (this.storage.get<Upload>('upload', requestId) === undefined) this.storage.remove('upload-checkpoint', requestId);
      for (const read of reads) this.storage.set('source-read', read.fileId, read);
      this.storage.clear('scan-deferred');
      for (const [fileId, since] of deferred) this.storage.set('scan-deferred', fileId, { fileId, since });
    });
  }
  private readControls(): Controls {
    try {
      const value = this.storage.get<unknown>('meta', 'controls');
      const controls = decodeControls(value === undefined ? { paused: false, exclusions: [] } : value);
      const groups = this.storage.list<unknown>('control-exclusion').map(group => {
        const evidence = decodeEvidence(group);
        if (evidence.uncertain !== undefined) throw new CollectorError('invalid-collector-controls');
        return evidence;
      });
      const expected = [...new Set(groups.flatMap(group => group.paths))].sort();
      if (JSON.stringify(expected) !== JSON.stringify(controls.exclusions)) throw new CollectorError('invalid-collector-controls');
      return controls;
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof CollectorError) throw new CollectorError('invalid-collector-controls');
      throw error;
    }
  }
  controls(): Controls { return this.storage.readTransaction(() => this.readControls()); }
  setPaused(paused: boolean): void { this.storage.transaction(() => { const controls = this.readControls(); controls.paused = paused; this.storage.set('meta', 'controls', controls); }); }
  exclude(path: string): void {
    const aliases = pathAliases(path);
    this.storage.transaction(() => {
      const controls = this.readControls();
      const groups = this.storage.list<{ paths: string[] }>('control-exclusion');
      // Validate groups before modifying, failing closed on damaged state.
      for (const group of groups) decodeEvidence(group);
      this.storage.set('control-exclusion', aliases[0]!, { paths: aliases });
      controls.exclusions = [...new Set([...groups.filter(group => group.paths[0] !== aliases[0]).flatMap(group => group.paths), ...aliases])].sort();
      this.storage.set('meta', 'controls', controls);
    });
  }
  unexclude(path: string): void {
    const aliases = pathAliases(path);
    this.storage.transaction(() => {
      const controls = this.readControls();
      const groups = this.storage.list<{ paths: string[] }>('control-exclusion').map(decodeEvidence);
      // Match ownership groups against only the operator's observed aliases.
      // Expanding this set while iterating would conflate independently added
      // exclusions and make removal depend on storage iteration order.
      const selectedAliases = new Set(aliases);
      const selected = groups.filter(group => group.paths.some(p => selectedAliases.has(p)));
      for (const group of selected) this.storage.remove('control-exclusion', group.paths[0]!);
      const retained = groups.filter(group => !selected.includes(group));
      controls.exclusions = [...new Set(retained.flatMap(group => group.paths))].sort();
      this.storage.set('meta', 'controls', controls);
    });
  }
  private evidence(entry: Pending): AdmissionEvidence | null {
    if (typeof entry.requestId !== 'string' || typeof entry.payloadDigest !== 'string' || typeof entry.sourceKey !== 'string') throw new CollectorError('invalid-admission-evidence');
    let value: unknown;
    try { value = this.storage.get<unknown>('pending-evidence', entry.requestId); }
    catch (error) { if (error instanceof SyntaxError) throw new CollectorError('invalid-admission-evidence'); throw error; }
    if (value === undefined) return null;
    if (!object(value) || Object.keys(value).length !== 4 || value['requestId'] !== entry.requestId || value['payloadDigest'] !== entry.payloadDigest || value['sourceKey'] !== entry.sourceKey) throw new CollectorError('invalid-admission-evidence');
    return decodeEvidence(value['evidence']);
  }
  pendingEvidence(requestId: string): AdmissionEvidence | null {
    return this.storage.readTransaction(() => {
      const entry = this.required(requestId);
      if (entry.requestId !== requestId) throw new CollectorError('invalid-admission-evidence');
      return this.evidence(entry);
    });
  }
  queueWithAdmission(): QueuedAdmission[] { return this.storage.readTransaction(() => this.queue().map(entry => ({ entry, origin: this.origin(entry), evidence: this.evidence(entry) }))); }
  enqueue(entry: Pending, origin: CollectionOrigin, evidence: AdmissionEvidence | null): void {
    this.storage.transaction(() => {
      if (hash(entry.payload) !== entry.payloadDigest) throw new CollectorError('payload-digest-mismatch');
      if (this.storage.get<string>('source-pending', entry.sourceKey) !== undefined) throw new CollectorError('source-already-pending');
      if (this.storage.get<Pending>('pending', entry.requestId) !== undefined) throw new CollectorError('request-already-pending');
      if (this.storedOrigin(entry.requestId) !== undefined) throw new CollectorError('orphaned-pending-origin');
      if (this.storage.get<unknown>('pending-evidence', entry.requestId) !== undefined) throw new CollectorError('invalid-admission-evidence');
      const validatedOrigin = decodeOrigin(origin);
      const validatedEvidence = evidence === null ? null : decodeEvidence(evidence);
      const head = this.head(entry.sourceKey);
      if (head.tombstone || head.revision !== entry.expectedRevision) throw new CollectorError('source-head-mismatch');
      this.storage.set('pending', entry.requestId, entry);
      if (validatedEvidence !== null) this.storage.set('pending-evidence', entry.requestId, { requestId: entry.requestId, sourceKey: entry.sourceKey, payloadDigest: entry.payloadDigest, evidence: validatedEvidence });
      this.storage.set('source-pending', entry.sourceKey, entry.requestId);
      this.storage.set<BoundOrigin>('pending-origin', entry.requestId, { requestId: entry.requestId, payloadDigest: entry.payloadDigest, sourceKey: entry.sourceKey, origin: validatedOrigin });
    });
  }
  queue(): Pending[] { return this.storage.list<Pending>('pending'); }
  private storedOrigin(requestId: string): unknown {
    try { return this.storage.get<unknown>('pending-origin', requestId); }
    catch (error) { if (error instanceof SyntaxError) throw new CollectorError('invalid-pending-origin'); throw error; }
  }
  private origin(entry: Pending): CollectionOrigin {
    if (typeof entry.requestId !== 'string' || typeof entry.payloadDigest !== 'string' || typeof entry.sourceKey !== 'string') throw new CollectorError('invalid-pending-origin');
    const value = this.storedOrigin(entry.requestId);
    if (value === undefined) return { kind: 'unknown' };
    if (!object(value) || Object.keys(value).length !== 4 || typeof value['requestId'] !== 'string' || typeof value['payloadDigest'] !== 'string' || typeof value['sourceKey'] !== 'string' || value['requestId'] !== entry.requestId || value['payloadDigest'] !== entry.payloadDigest || value['sourceKey'] !== entry.sourceKey) throw new CollectorError('invalid-pending-origin');
    return decodeOrigin(value['origin']);
  }
  pendingOrigin(requestId: string): CollectionOrigin { return this.storage.readTransaction(() => { const entry = this.required(requestId); if (entry.requestId !== requestId) throw new CollectorError('invalid-pending-origin'); return this.origin(entry); }); }
  queueWithOrigins(): QueuedOrigin[] { return this.storage.readTransaction(() => this.queue().map(entry => ({ entry, origin: this.origin(entry) }))); }
  private required(requestId: string): Pending { const pending = this.storage.get<Pending>('pending', requestId); if (pending === undefined) throw new CollectorError('request-not-found'); return pending; }
  ack(requestId: string, revision: number): void {
    this.storage.transaction(() => {
      const pending = this.required(requestId);
      if (revision !== pending.expectedRevision + 1) throw new CollectorError('receipt-revision-mismatch');
      if (this.head(pending.sourceKey).revision !== pending.expectedRevision) throw new CollectorError('source-head-mismatch');
      this.storage.set<Head>('head', pending.sourceKey, { revision, digest: pending.sourceDigest, tombstone: false, ...pending.base });
      this.storage.remove('pending', requestId); this.storage.remove('pending-origin', requestId); this.storage.remove('pending-evidence', requestId);
      this.storage.remove('source-pending', pending.sourceKey);
    });
  }
  fail(requestId: string, error: string, nextAt: number, conflict: boolean, maxAttempts: number): EntryStatus {
    const entry = this.required(requestId); entry.attempts++; entry.error = error; entry.nextAt = nextAt;
    entry.status = conflict ? 'conflict' : entry.attempts >= maxAttempts ? 'stopped' : 'pending';
    this.storage.set('pending', requestId, entry); return entry.status;
  }
  retry(requestId: string): void {
    const upload = this.storage.get<Upload>('upload', requestId);
    if (upload !== undefined) { const { refused: _, ...entry } = upload; this.storage.set<Upload>('upload', requestId, { ...entry, attempts: 0, nextAt: 0, status: 'pending', error: null }); return; }
    const entry = this.required(requestId); entry.attempts = 0; entry.nextAt = 0; entry.status = 'pending'; entry.error = null;
    this.storage.set('pending', requestId, entry);
  }
  uploads(): Upload[] {
    return this.storage.readTransaction(() => this.storage.list<Upload>('upload').map(entry => {
      if (!object(entry) || typeof entry.requestId !== 'string' || typeof entry.sourceKey !== 'string' || this.storage.get<string>('source-upload', entry.sourceKey) !== entry.requestId) throw new CollectorError('invalid-upload-entry');
      return { ...entry, origin: decodeOrigin(entry.origin), evidence: entry.evidence === null ? null : decodeEvidence(entry.evidence) };
    }));
  }
  private requiredUpload(requestId: string): Upload { const entry = this.storage.get<Upload>('upload', requestId); if (entry === undefined) throw new CollectorError('request-not-found'); return entry; }
  private insertUpload(entry: Upload): void {
    if (this.storage.get<string>('source-pending', entry.sourceKey) !== undefined || this.storage.get<string>('source-upload', entry.sourceKey) !== undefined) throw new CollectorError('source-already-pending');
    if (this.storage.get<Upload>('upload', entry.requestId) !== undefined || this.storage.get<Pending>('pending', entry.requestId) !== undefined) throw new CollectorError('request-already-pending');
    const head = this.head(entry.sourceKey);
    if (head.tombstone || head.revision !== entry.expectedRevision) throw new CollectorError('source-head-mismatch');
    this.storage.set<Upload>('upload', entry.requestId, { ...entry, origin: decodeOrigin(entry.origin), evidence: entry.evidence === null ? null : decodeEvidence(entry.evidence) });
    this.storage.set('source-upload', entry.sourceKey, entry.requestId);
  }
  private removeUpload(entry: Upload): void { this.storage.remove('upload', entry.requestId); this.storage.remove('source-upload', entry.sourceKey); this.storage.remove('upload-checkpoint', entry.requestId); }
  planUpload(entry: Upload, checkpoint: PendingCheckpoint | null): void {
    this.storage.transaction(() => {
      this.insertUpload(entry);
      if (checkpoint === null) return;
      if (checkpoint.sourceKey !== entry.sourceKey || checkpoint.fileId !== entry.fileId) throw new CollectorError('checkpoint-upload-mismatch');
      this.storage.set<PendingCheckpoint>('upload-checkpoint', entry.requestId, checkpoint);
    });
  }
  updateUpload(requestId: string, change: Partial<Pick<Upload, 'uploadId' | 'partBudget' | 'partsAcked' | 'lastPartSha256'>>): void {
    this.storage.transaction(() => this.storage.set<Upload>('upload', requestId, { ...this.requiredUpload(requestId), ...change }));
  }
  replanUpload(requestId: string, next: Upload): void {
    this.storage.transaction(() => {
      const entry = this.requiredUpload(requestId);
      if (entry.sourceKey !== next.sourceKey) throw new CollectorError('source-head-mismatch');
      // The checkpoint describes the file the intent declares, whatever the head it becomes.
      const checkpoint = this.storage.get<PendingCheckpoint>('upload-checkpoint', requestId);
      this.removeUpload(entry); this.insertUpload(next);
      if (checkpoint !== undefined) this.storage.set<PendingCheckpoint>('upload-checkpoint', next.requestId, checkpoint);
      this.storage.set('audit', requestId, { requestId, sourceKey: entry.sourceKey, reason: 'upload-replanned' });
    });
  }
  failUpload(requestId: string, error: string, nextAt: number, conflict: boolean, maxAttempts: number, refused?: Upload['refused']): EntryStatus {
    return this.storage.transaction(() => {
      const { refused: _, ...entry } = this.requiredUpload(requestId); const attempts = entry.attempts + 1;
      const status: EntryStatus = conflict ? 'conflict' : attempts >= maxAttempts ? 'stopped' : 'pending';
      this.storage.set<Upload>('upload', requestId, { ...entry, attempts, error, nextAt, status, ...(refused === undefined ? {} : { refused }) });
      return status;
    });
  }
  ackUpload(requestId: string, revision: number): void {
    this.storage.transaction(() => {
      const entry = this.requiredUpload(requestId);
      if (revision !== entry.expectedRevision + 1) throw new CollectorError('receipt-revision-mismatch');
      if (this.head(entry.sourceKey).revision !== entry.expectedRevision) throw new CollectorError('source-head-mismatch');
      this.storage.set<Head>('head', entry.sourceKey, { revision, digest: entry.sourceDigest, tombstone: false, ...entry.declared });
      const pending = this.storage.get<PendingCheckpoint>('upload-checkpoint', requestId);
      if (pending !== undefined) this.storage.set<AppendCheckpoint>('append-checkpoint', pending.fileId, { ...pending, headRevision: revision, headDigest: entry.sourceDigest });
      this.removeUpload(entry);
    });
  }
  appendCheckpoint(fileId: string): AppendCheckpoint | undefined { return this.storage.get<AppendCheckpoint>('append-checkpoint', fileId); }
  lastPasses(): LastPass[] { return this.storage.list<LastPass>('last-pass'); }
  setLastPass(value: LastPass): void { this.storage.set<LastPass>('last-pass', value.fileId, value); }
  discardUpload(requestId: string, reason: string): void {
    this.storage.transaction(() => {
      const entry = this.requiredUpload(requestId); this.removeUpload(entry);
      this.storage.set('audit', requestId, { requestId, sourceKey: entry.sourceKey, reason });
    });
  }
  recordOverLimit(fileId: string): RecordOverLimit | undefined { return this.storage.get<RecordOverLimit>('record-over-limit', fileId); }
  recordsOverLimit(): RecordOverLimit[] { return this.storage.list<RecordOverLimit>('record-over-limit'); }
  setRecordOverLimit(value: RecordOverLimit): void { this.storage.set('record-over-limit', value.fileId, value); }
  clearRecordOverLimit(fileId: string): void { this.storage.remove('record-over-limit', fileId); }
  serverLimits(): unknown { return this.storage.get<unknown>('upload-server', 'limits') ?? null; }
  saveProbe(probe: UploadProbe, limits: unknown): void {
    this.storage.transaction(() => { this.storage.set('upload-server', 'probe', probe); if (limits !== null) this.storage.set('upload-server', 'limits', limits); });
  }
  probe(): UploadProbe | null { return this.storage.get<UploadProbe>('upload-server', 'probe') ?? null; }
  setUnicodeRepair(sourceKey: string, revision: number, replaced: number): void {
    if (replaced === 0) this.storage.remove('unicode-repair', sourceKey);
    else this.storage.set<UnicodeRepair>('unicode-repair', sourceKey, { sourceKey, revision, replaced });
  }
  unicodeRepairs(): UnicodeRepair[] { return this.storage.list<UnicodeRepair>('unicode-repair'); }
  identifierRefusal(fileId: string): IdentifierRefusal | undefined { return this.storage.get<IdentifierRefusal>('identifier-refusal', fileId); }
  identifierRefusals(): IdentifierRefusal[] { return this.storage.list<IdentifierRefusal>('identifier-refusal'); }
  setIdentifierRefusal(value: IdentifierRefusal): void { this.storage.set('identifier-refusal', value.fileId, value); }
  clearIdentifierRefusal(fileId: string): void { this.storage.remove('identifier-refusal', fileId); }
  drop(requestId: string, reason: string): void {
    const upload = this.storage.get<Upload>('upload', requestId);
    if (upload === undefined) { this.removeRequest(requestId, reason, true); return; }
    this.storage.transaction(() => {
      const head = this.head(upload.sourceKey); head.tombstone = true; this.storage.set('head', upload.sourceKey, head);
      this.removeUpload(upload); this.storage.set('audit', requestId, { requestId, sourceKey: upload.sourceKey, reason });
    });
  }
  discard(requestId: string, reason: string): void { this.removeRequest(requestId, reason, false); }
  private removeRequest(requestId: string, reason: string, tombstone: boolean): void {
    this.storage.transaction(() => {
      const entry = this.required(requestId);
      if (tombstone) { const head = this.head(entry.sourceKey); head.tombstone = true; this.storage.set('head', entry.sourceKey, head); }
      this.storage.remove('pending', requestId); this.storage.remove('pending-origin', requestId); this.storage.remove('pending-evidence', requestId);
      this.storage.remove('source-pending', entry.sourceKey);
      this.storage.set('audit', requestId, { requestId, sourceKey: entry.sourceKey, reason });
    });
  }
  private recordedTombstones(): Tombstone[] {
    const reasons = new Map<string, Set<string>>();
    for (const { sourceKey, reason } of this.dropped()) reasons.set(sourceKey, (reasons.get(sourceKey) ?? new Set()).add(reason));
    return this.storage.entries<Head>('head').filter(([, head]) => head.tombstone).map(([sourceKey, head]) => ({ sourceKey, head, reasons: [...reasons.get(sourceKey) ?? []].sort() }));
  }
  tombstones(): Tombstone[] { return this.storage.readTransaction(() => this.recordedTombstones()); }
  clearTombstones(reason: string): Tombstone[] {
    return this.storage.transaction(() => {
      const cleared = this.recordedTombstones().filter(tombstone => droppedOnlyFor(tombstone, reason));
      for (const { sourceKey, head } of cleared) this.storage.set<Head>('head', sourceKey, { ...head, tombstone: false });
      return cleared;
    });
  }
  reporting(): ReportingState { return this.storage.get<ReportingState>('meta', 'reporting') ?? { sequence: '0', acceptedSequence: null, acceptedAt: null, error: null }; }
  nextReportSequence(): bigint {
    return this.storage.transaction(() => {
      const state = this.reporting(); const next = BigInt(state.sequence) + 1n;
      if (next > 9223372036854775807n) throw new CollectorError('report-sequence-exhausted');
      state.sequence = next.toString(); this.storage.set('meta', 'reporting', state); return next;
    });
  }
  reportAccepted(sequence: bigint, at: number): void {
    const state = this.reporting();
    if (sequence > BigInt(state.sequence) || sequence <= BigInt(state.acceptedSequence ?? '0')) throw new CollectorError('invalid-report-ack');
    state.acceptedSequence = sequence.toString(); state.acceptedAt = at; state.error = null; state.cause = null; this.storage.set('meta', 'reporting', state);
  }
  reportFailed(code: string, cause: string): void { const state = this.reporting(); state.error = code; state.cause = cause; this.storage.set('meta', 'reporting', state); }
  report(): CollectorReport | null { return this.storage.get<CollectorReport>('meta', 'last-report') ?? null; }
  saveReport(report: CollectorReport): void { this.storage.set('meta', 'last-report', report); }
  dropped(): Dropped[] { return this.storage.list<Dropped>('audit'); }
  diagnostics(): Diagnostic[] { return this.storage.list<Diagnostic>('diagnostic'); }
  diagnostic(value: Diagnostic): void { this.storage.set('diagnostic', `${value.rootId}\0${value.pathId}\0${value.code}`, value); }
  clearDiagnostics(): void { this.storage.clear('diagnostic'); }
  close(): void { this.storage.close(); }
}
export class MemorySpool extends DurableSpool { constructor() { super(new InMemoryStorage()); } }
export class SqliteSpool extends DurableSpool { constructor(directory: string) { super(new SqliteStorage(directory)); } }
/** The spool in `directory` opened read-only: nothing is created, initialised or chmod-ed and writes fail; null when there is no initialised spool. */
export function readOnlySpool(directory: string): Spool | null {
  if (!existsSync(join(directory, SPOOL_FILE))) return null;
  const storage = new SqliteStorage(directory, 'read-only');
  const namespace = storage.initialized() ? storage.get<string>('meta', 'namespace') : undefined;
  if (namespace === undefined) { storage.close(); return null; }
  return new DurableSpool(storage, namespace);
}

export class DaemonLock {
  private readonly db: DatabaseSync;
  constructor(directory: string) {
    secureDirectory(directory);
    const path = join(directory, 'daemon-lock.sqlite'); secureFile(path); this.db = new DatabaseSync(path);
    try { this.db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;'); }
    catch { this.db.close(); throw new CollectorError('collector-already-running'); }
  }
  close(): void { this.db.exec('ROLLBACK'); this.db.close(); }
}
