import { DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, constants, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CollectorError, hash, type CollectorReport, type Diagnostic } from './domain.ts';
import { rejectSymlinks } from './discovery.ts';

export interface Pending {
  requestId: string; sourceKey: string; sourceDigest: string; payload: string; payloadDigest: string;
  expectedRevision: number; policyDigest: string; attempts: number; nextAt: number;
  status: 'pending' | 'stopped' | 'conflict'; error: string | null;
}
export interface Head { revision: number; digest: string | null; tombstone: boolean }
export interface Dropped { requestId: string; sourceKey: string; reason: string }
export interface ReportingState { sequence: string; acceptedSequence: string | null; acceptedAt: number | null; error: string | null }
export interface Spool {
  readonly namespace: string;
  head(sourceKey: string): Head;
  observe(pathId: string, signature: string, now: number): number;
  enqueue(entry: Pending): void; queue(): Pending[];
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
  close(): void {}
}
function secureDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 }); rejectSymlinks(path); chmodSync(path, 0o700);
}
function secureFile(path: string): void {
  const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  closeSync(fd); rejectSymlinks(path); chmodSync(path, 0o600);
}
class SqliteStorage implements Storage {
  private readonly db: DatabaseSync;
  constructor(directory: string) {
    secureDirectory(directory);
    const path = join(directory, 'spool.sqlite');
    secureFile(path); this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS kv (bucket TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(bucket,key));');
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
  enqueue(entry: Pending): void {
    this.storage.transaction(() => {
      if (hash(entry.payload) !== entry.payloadDigest) throw new CollectorError('payload-digest-mismatch');
      if (this.storage.get<string>('source-pending', entry.sourceKey) !== undefined) throw new CollectorError('source-already-pending');
      const head = this.head(entry.sourceKey);
      if (head.tombstone || head.revision !== entry.expectedRevision) throw new CollectorError('source-head-mismatch');
      this.storage.set('pending', entry.requestId, entry);
      this.storage.set('source-pending', entry.sourceKey, entry.requestId);
    });
  }
  queue(): Pending[] { return this.storage.list<Pending>('pending'); }
  private required(requestId: string): Pending { const pending = this.storage.get<Pending>('pending', requestId); if (pending === undefined) throw new CollectorError('request-not-found'); return pending; }
  ack(requestId: string, revision: number): void {
    this.storage.transaction(() => {
      const pending = this.required(requestId);
      if (revision !== pending.expectedRevision + 1) throw new CollectorError('receipt-revision-mismatch');
      if (this.head(pending.sourceKey).revision !== pending.expectedRevision) throw new CollectorError('source-head-mismatch');
      this.storage.set<Head>('head', pending.sourceKey, { revision, digest: pending.sourceDigest, tombstone: false });
      this.storage.remove('pending', requestId);
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
      this.storage.set('head', entry.sourceKey, head); this.storage.remove('pending', requestId);
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
