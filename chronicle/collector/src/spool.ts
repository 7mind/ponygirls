import { decodeControls, decodeEvidence, pathAliases, type Controls, type AdmissionEvidence } from './controls.ts';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, constants, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CollectorError, hash, type CollectorReport, type Diagnostic } from './domain.ts';
import { rejectSymlinks } from './discovery.ts';
import { decodeOrigin, type CollectionOrigin } from './admission.ts';
import { object } from './domain.ts';

export interface Pending {
  requestId: string; sourceKey: string; sourceDigest: string; payload: string; payloadDigest: string;
  expectedRevision: number; policyDigest: string; attempts: number; nextAt: number;
  status: 'pending' | 'stopped' | 'conflict'; error: string | null;
}
export interface QueuedOrigin { entry: Pending; origin: CollectionOrigin }
export interface QueuedAdmission extends QueuedOrigin { evidence: AdmissionEvidence | null }
interface BoundOrigin { requestId: string; payloadDigest: string; sourceKey: string; origin: CollectionOrigin }
export interface Head { revision: number; digest: string | null; tombstone: boolean }
export interface Dropped { requestId: string; sourceKey: string; reason: string }
export interface ReportingState { sequence: string; acceptedSequence: string | null; acceptedAt: number | null; error: string | null }
export interface Spool {
  readonly namespace: string;
  head(sourceKey: string): Head;
  observe(pathId: string, signature: string, now: number): number;
  controls(): Controls; setPaused(paused: boolean): void; exclude(path: string): void; unexclude(path: string): void;
  pendingEvidence(requestId: string): AdmissionEvidence | null;
  enqueue(entry: Pending, origin: CollectionOrigin, evidence: AdmissionEvidence | null): void; queue(): Pending[];
  pendingOrigin(requestId: string): CollectionOrigin; queueWithOrigins(): QueuedOrigin[]; queueWithAdmission(): QueuedAdmission[];
  ack(requestId: string, revision: number): void;
  fail(requestId: string, error: string, nextAt: number, conflict: boolean, maxAttempts: number): Pending['status'];
  retry(requestId: string): void; drop(requestId: string, reason: string): void;
  diagnostics(): Diagnostic[]; diagnostic(value: Diagnostic): void; clearDiagnostics(): void;
  dropped(): Dropped[];
  report(): CollectorReport | null; saveReport(report: CollectorReport): void;
  nextReportSequence(): bigint;
  reporting(): ReportingState;
  reportAccepted(sequence: bigint, at: number): void;
  reportFailed(code: string): void;
  close(): void;
}
interface Storage {
  get<T>(bucket: string, key: string): T | undefined;
  set<T>(bucket: string, key: string, value: T): void;
  remove(bucket: string, key: string): void;
  list<T>(bucket: string): T[];
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
export class SqliteStorage implements Storage {
  private readonly db: DatabaseSync;
  constructor(directory: string) {
    secureDirectory(directory);
    const path = join(directory, 'spool.sqlite');
    secureFile(path); this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=1000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS kv (bucket TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(bucket,key));');
  }
  get<T>(bucket: string, key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE bucket=? AND key=?').get(bucket, key);
    return row === undefined ? undefined : JSON.parse(String(row['value'])) as T;
  }
  set<T>(bucket: string, key: string, value: T): void { this.db.prepare('INSERT INTO kv VALUES (?,?,?) ON CONFLICT(bucket,key) DO UPDATE SET value=excluded.value').run(bucket, key, JSON.stringify(value)); }
  remove(bucket: string, key: string): void { this.db.prepare('DELETE FROM kv WHERE bucket=? AND key=?').run(bucket, key); }
  list<T>(bucket: string): T[] { return this.db.prepare('SELECT value FROM kv WHERE bucket=? ORDER BY key').all(bucket).map(row => JSON.parse(String(row['value'])) as T); }
  clear(bucket: string): void { this.db.prepare('DELETE FROM kv WHERE bucket=?').run(bucket); }
  transaction<T>(run: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = run(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  readTransaction<T>(read: () => T): T { this.db.exec('BEGIN'); try { const result = read(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  close(): void { this.db.close(); }
}
class DurableSpool implements Spool {
  readonly namespace: string;
  private readonly storage: Storage;
  constructor(storage: Storage) {
    this.storage = storage;
    this.namespace = storage.transaction(() => {
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
      this.storage.set<Head>('head', pending.sourceKey, { revision, digest: pending.sourceDigest, tombstone: false });
      this.storage.remove('pending', requestId); this.storage.remove('pending-origin', requestId); this.storage.remove('pending-evidence', requestId);
      this.storage.remove('source-pending', pending.sourceKey);
    });
  }
  fail(requestId: string, error: string, nextAt: number, conflict: boolean, maxAttempts: number): Pending['status'] {
    const entry = this.required(requestId); entry.attempts++; entry.error = error; entry.nextAt = nextAt;
    entry.status = conflict ? 'conflict' : entry.attempts >= maxAttempts ? 'stopped' : 'pending';
    this.storage.set('pending', requestId, entry); return entry.status;
  }
  retry(requestId: string): void {
    const entry = this.required(requestId); entry.attempts = 0; entry.nextAt = 0; entry.status = 'pending'; entry.error = null;
    this.storage.set('pending', requestId, entry);
  }
  drop(requestId: string, reason: string): void {
    this.storage.transaction(() => {
      const entry = this.required(requestId); const head = this.head(entry.sourceKey); head.tombstone = true;
      this.storage.set('head', entry.sourceKey, head); this.storage.remove('pending', requestId); this.storage.remove('pending-origin', requestId); this.storage.remove('pending-evidence', requestId);
      this.storage.remove('source-pending', entry.sourceKey);
      this.storage.set('audit', requestId, { requestId, sourceKey: entry.sourceKey, reason });
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
    state.acceptedSequence = sequence.toString(); state.acceptedAt = at; state.error = null; this.storage.set('meta', 'reporting', state);
  }
  reportFailed(code: string): void { const state = this.reporting(); state.error = code; this.storage.set('meta', 'reporting', state); }
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
