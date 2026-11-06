import { constants, existsSync, closeSync, openSync, fchmodSync, fstatSync, mkdirSync, lstatSync, chmodSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { digest, redact } from './evidence.ts';
import { FAILURE_MESSAGES, type Attempt, type AttemptFinish, type AttemptSummary } from './attempt.ts';
import type { WorkerModel } from './worker.ts';
import { text, MAX_BATCH_CHARS, MAX_BATCH_EVENTS, MAX_PENDING_EVENTS, validateProposals, type Batch, type CaptureState, type Evidence, type Proposal, type ReceiptMeta, type Revision, type SourceCursor } from './model.ts';

function privatePath(path: string): string {
  if (path === ':memory:') return path;
  const absolute = resolve(path); const dir = dirname(absolute);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!lstatSync(dir).isDirectory()) throw new Error('Historian directory must not be a symlink');
  chmodSync(dir, 0o700);
  const fd = openSync(absolute, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try { if (!fstatSync(fd).isFile()) throw new Error('Historian database must be a regular file'); fchmodSync(fd, 0o600); }
  finally { closeSync(fd); }
  return absolute;
}

/** A separate SQLite transaction holds an OS-backed per-session lock; process death releases it. */
export function acquireSessionLock(directory: string, sessionId: string): () => void {
  const db = new DatabaseSync(privatePath(join(directory, `session-${digest(sessionId)}.lock.sqlite`)));
  try { db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;'); }
  catch (cause) { db.close(); throw new Error('Historian session is already owned by another process', { cause }); }
  let held = true;
  return () => { if (held) { held = false; db.exec('ROLLBACK'); db.close(); } };
}

export class JournalStore {
  private readonly db: DatabaseSync;
  private readonly path: string;
  private closed = false;
  constructor(path: string, project: string) {
    this.path = privatePath(path); this.db = new DatabaseSync(this.path);
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
      this.transaction(() => {
        const version = this.db.prepare('PRAGMA user_version').get()!.user_version;
        if (version !== 0 && version !== 1 && version !== 2) throw new Error(`Unsupported Historian schema ${version}`);
        if (version === 0) {
          if (this.db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all().length) throw new Error('Unversioned nonempty Historian database');
          this.db.exec(`
            CREATE TABLE identity(project TEXT NOT NULL) STRICT;
            CREATE TABLE projection(id INTEGER PRIMARY KEY CHECK(id=1), dirty INTEGER NOT NULL) STRICT;
            INSERT INTO projection VALUES(1,1);
            CREATE TABLE owners(owner TEXT PRIMARY KEY, state TEXT NOT NULL) STRICT;
            CREATE TABLE evidence(ref TEXT PRIMARY KEY, digest TEXT NOT NULL, body TEXT) STRICT;
            CREATE TABLE queue(seq INTEGER PRIMARY KEY, owner TEXT NOT NULL, ref TEXT NOT NULL UNIQUE REFERENCES evidence(ref), processed INTEGER NOT NULL DEFAULT 0) STRICT;
            CREATE TABLE commits(id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
            CREATE TABLE revisions(seq INTEGER PRIMARY KEY, episode TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, UNIQUE(episode, revision)) STRICT;
            PRAGMA user_version=1;
          `);
          this.db.prepare('INSERT INTO identity VALUES(?)').run(project);
        }
        if (this.db.prepare('SELECT project FROM identity').get()!.project !== project) throw new Error('Historian project identity mismatch');
        if (version !== 2) this.db.exec(`
          CREATE TABLE attempts(seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, batch TEXT NOT NULL, outcome TEXT NOT NULL, body TEXT NOT NULL) STRICT;
          CREATE INDEX attempts_owner ON attempts(owner,seq);
          CREATE UNIQUE INDEX attempts_running ON attempts(owner) WHERE outcome='running';
          PRAGMA user_version=2;
        `);
        this.db.exec('UPDATE projection SET dirty=1');
        const checks = this.db.prepare('PRAGMA quick_check').all();
        if (checks.length !== 1 || checks[0].quick_check !== 'ok') throw new Error('Historian integrity check failed');
      });
    } catch (cause) { this.db.close(); throw cause; }
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  state(owner: string): CaptureState | null {
    const row = this.db.prepare('SELECT state FROM owners WHERE owner=?').get(owner);
    return row === undefined ? null : JSON.parse(String(row.state)) as CaptureState;
  }
  capture(owner: string, enabled: boolean, cursors: SourceCursor[], evidence: Evidence[], gaps: string[]): void {
    this.transaction(() => {
      const previous = this.state(owner);
      if (!enabled && evidence.length) throw new Error('Cannot capture disabled history');
      const state: CaptureState = { enabled, epoch: previous === null ? 1 : previous.epoch + (previous.enabled === enabled ? 0 : 1),
        cursors, gaps: [...new Set([...(previous === null ? [] : previous.gaps), ...gaps])].slice(-100) };
      const pending = Number(this.db.prepare('SELECT count(*) AS n FROM queue WHERE owner=? AND processed=0').get(owner)!.n);
      let added = 0;
      for (const e of evidence) {
        const old = this.db.prepare('SELECT digest FROM evidence WHERE ref=?').get(e.ref);
        if (old !== undefined) { if (old.digest !== e.digest) throw new Error('Evidence integrity mismatch'); continue; }
        if (pending + ++added > MAX_PENDING_EVENTS) throw new Error('Historian backlog full; capture cursor has not advanced');
        this.db.prepare('INSERT INTO evidence VALUES(?,?,?)').run(e.ref, e.digest, JSON.stringify(e));
        this.db.prepare('INSERT INTO queue(owner,ref) VALUES(?,?)').run(owner, e.ref);
      }
      this.db.prepare('INSERT INTO owners VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET state=excluded.state').run(owner, JSON.stringify(state));
      if (previous === null || JSON.stringify(previous.gaps) !== JSON.stringify(state.gaps)) this.db.exec('UPDATE projection SET dirty=1');
    });
  }
  batch(owner: string): Batch | null {
    const state = this.state(owner);
    if (state === null || !state.enabled) return null;
    const rows = this.db.prepare('SELECT e.body FROM queue q JOIN evidence e ON e.ref=q.ref WHERE q.owner=? AND q.processed=0 ORDER BY q.seq LIMIT ?').all(owner, MAX_BATCH_EVENTS);
    const evidence: Evidence[] = []; let chars = 0;
    for (const row of rows) {
      const e = JSON.parse(String(row.body)) as Evidence;
      const size = JSON.stringify(e).length;
      if (evidence.length && chars + size > MAX_BATCH_CHARS) break;
      evidence.push(e); chars += size;
    }
    if (!evidence.length) return null;
    return { id: digest(JSON.stringify([owner, state.epoch, evidence.map(e => [e.ref, e.digest]), state.gaps])), owner, epoch: state.epoch, evidence, gaps: state.gaps };
  }
  beginAttempt(batch: Batch, model: WorkerModel, objective: string, contextDigest: string): Attempt {
    const state = this.state(batch.owner);
    if (state === null || !state.enabled || state.epoch !== batch.epoch) throw new Error('Cannot admit attempt outside enabled capture epoch');
    if (!/^[a-f0-9]{64}$/.test(contextDigest)) throw new Error('Invalid attempt context digest');
    const attempt: Attempt = { id: randomUUID(), owner: batch.owner, batchId: batch.id, contextDigest,
      provider: text(model.provider, 'provider', 200), model: text(model.id, 'model', 300), thinking: model.thinking,
      objective: text(objective, 'objective', 100), startedAt: new Date().toISOString(), endedAt: null,
      outcome: 'running', failure: null, durationMs: null, responseChars: null, usage: null };
    this.db.prepare('INSERT INTO attempts(id,owner,batch,outcome,body) VALUES(?,?,?,?,?)').run(attempt.id, attempt.owner, attempt.batchId, attempt.outcome, JSON.stringify(attempt));
    return attempt;
  }
  finishAttempt(id: string, finish: AttemptFinish): void {
    if (!['validated', 'failed', 'cancelled', 'interrupted'].includes(finish.outcome) ||
      (finish.failure !== null && !Object.hasOwn(FAILURE_MESSAGES, finish.failure)) ||
      (finish.durationMs !== null && (!Number.isFinite(finish.durationMs) || finish.durationMs < 0)) ||
      (finish.responseChars !== null && (!Number.isSafeInteger(finish.responseChars) || finish.responseChars < 0)) ||
      !Number.isFinite(Date.parse(finish.endedAt))) throw new Error('Invalid attempt completion');
    const usage = finish.usage === null ? null : { input: finish.usage.input, output: finish.usage.output,
      cacheRead: finish.usage.cacheRead, cacheWrite: finish.usage.cacheWrite, totalTokens: finish.usage.totalTokens };
    if (usage !== null && !Object.values(usage).every(value => Number.isFinite(value) && value >= 0)) throw new Error('Invalid attempt usage');
    this.transaction(() => {
      const row = this.db.prepare("SELECT body FROM attempts WHERE id=? AND outcome='running'").get(id);
      if (row === undefined) throw new Error('Attempt missing or already finalized');
      const attempt = JSON.parse(String(row.body)) as Attempt;
      const completed: Attempt = { ...attempt, outcome: finish.outcome, endedAt: finish.endedAt, durationMs: finish.durationMs,
        failure: finish.failure, responseChars: finish.responseChars, usage };
      this.db.prepare('UPDATE attempts SET outcome=?,body=? WHERE id=?').run(completed.outcome, JSON.stringify(completed), id);
    });
  }
  interruptAttempts(owner: string): void {
    // The caller must hold the session lease: a surviving process may still be draining.
    const endedAt = new Date().toISOString();
    for (const row of this.db.prepare("SELECT id FROM attempts WHERE owner=? AND outcome='running'").all(owner)) {
      this.finishAttempt(String(row.id), { outcome: 'interrupted', endedAt, durationMs: null, failure: null, responseChars: null, usage: null });
    }
  }
  attempts(owner: string, limit: number): Attempt[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid attempt limit');
    return this.db.prepare('SELECT body FROM attempts WHERE owner=? ORDER BY seq DESC LIMIT ?').all(owner, limit).map(row => JSON.parse(String(row.body)) as Attempt);
  }
  attemptSummary(owner: string): AttemptSummary {
    const result: AttemptSummary = { total: 0, running: 0, validated: 0, failed: 0, cancelled: 0, interrupted: 0, recovered: 0 };
    for (const row of this.db.prepare('SELECT outcome,count(*) AS n FROM attempts WHERE owner=? GROUP BY outcome').all(owner)) {
      const outcome = String(row.outcome);
      if (outcome !== 'running' && outcome !== 'validated' && outcome !== 'failed' && outcome !== 'cancelled' && outcome !== 'interrupted') throw new Error('Invalid retained attempt outcome');
      result[outcome] = Number(row.n); result.total += Number(row.n);
    }
    result.recovered = Number(this.db.prepare("SELECT count(*) AS n FROM attempts a WHERE owner=? AND outcome='failed' AND EXISTS (SELECT 1 FROM attempts b WHERE b.owner=a.owner AND b.batch=a.batch AND b.seq>a.seq AND b.outcome='validated')").get(owner)!.n);
    return result;
  }
  pending(owner: string): number { return Number(this.db.prepare('SELECT count(*) AS n FROM queue WHERE owner=? AND processed=0').get(owner)!.n); }
  recent(limit: number): Revision[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid episode limit');
    return this.db.prepare('SELECT body FROM revisions r WHERE revision=(SELECT max(revision) FROM revisions x WHERE x.episode=r.episode) ORDER BY seq DESC LIMIT ?').all(limit).map(row => JSON.parse(String(row.body)) as Revision);
  }
  commit(batch: Batch, proposals: Proposal[], meta: ReceiptMeta): Revision[] {
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT body FROM commits WHERE id=?').get(batch.id);
      if (prior !== undefined) return (JSON.parse(String(prior.body)) as { revisions: Revision[] }).revisions;
      const state = this.state(batch.owner);
      if (state === null || !state.enabled || state.epoch !== batch.epoch) throw new Error('Historian disabled or capture epoch changed');
      for (const e of batch.evidence) {
        const row = this.db.prepare('SELECT e.digest,q.processed FROM queue q JOIN evidence e ON e.ref=q.ref WHERE q.owner=? AND q.ref=?').get(batch.owner, e.ref);
        if (row === undefined || row.digest !== e.digest || row.processed !== 0) throw new Error('Batch evidence changed or already consumed');
      }
      const allowed = new Set(batch.evidence.map(e => e.ref));
      for (const row of this.db.prepare('SELECT body FROM revisions').all()) {
        const revision = JSON.parse(String(row.body)) as Revision;
        for (const claim of revision.claims) for (const ref of claim.evidence) allowed.add(ref);
      }
      const validated = validateProposals(proposals, allowed);
      const revisions = validated.map(p => {
        const episodeId = p.episodeId === null ? randomUUID() : p.episodeId;
        const current = this.db.prepare('SELECT max(revision) AS n FROM revisions WHERE episode=?').get(episodeId)!.n;
        if ((current === null ? 0 : Number(current)) !== p.expectedRevision || (p.episodeId !== null && current === null)) throw new Error('Episode revision conflict; retry with current journal');
        const revision: Revision = { episodeId, revision: p.expectedRevision + 1, owner: batch.owner, recordedAt: new Date().toISOString(),
          title: redact(p.title), kind: p.kind, status: p.status, claims: p.claims.map(c => ({ ...c, text: redact(c.text) })) };
        this.db.prepare('INSERT INTO revisions(episode,revision,body) VALUES(?,?,?)').run(episodeId, revision.revision, JSON.stringify(revision));
        return revision;
      });
      const retained = new Set(validated.flatMap(p => p.claims.flatMap(c => c.evidence)));
      for (const e of batch.evidence) {
        this.db.prepare('UPDATE queue SET processed=1 WHERE owner=? AND ref=?').run(batch.owner, e.ref);
        if (!retained.has(e.ref)) this.db.prepare('UPDATE evidence SET body=NULL WHERE ref=?').run(e.ref);
      }
      const identity = { ...batch, evidence: batch.evidence.map(e => ({ ref: e.ref, digest: e.digest })) };
      this.db.prepare('INSERT INTO commits VALUES(?,?)').run(batch.id, JSON.stringify({ batch: identity, revisions, meta, recordedAt: new Date().toISOString() }));
      this.db.exec('UPDATE projection SET dirty=1');
      return revisions;
    });
  }
  render(): string {
    const lines = ['# Historian project journal', '', 'Historical observations, not current external state. All revisions retained.', ''];
    lines.push('## Capture coverage', '', 'Most recent 100 distinct coverage notices per session; older notices may be omitted.', '');
    for (const row of this.db.prepare('SELECT owner,state FROM owners ORDER BY owner').all()) {
      const state = JSON.parse(String(row.state)) as CaptureState;
      for (const gap of state.gaps) lines.push(`- Session ${row.owner}: ${gap}`);
    }
    lines.push('');
    for (const row of this.db.prepare('SELECT body FROM revisions ORDER BY seq').all()) {
      const r = JSON.parse(String(row.body)) as Revision;
      lines.push(`## ${r.title} — ${r.status}`, '', `Episode ${r.episodeId}, revision ${r.revision}; recorded ${r.recordedAt}; session ${r.owner}`, '');
      for (const claim of r.claims) {
        lines.push(`### ${claim.section} (${claim.basis})`, '', claim.text, '');
        for (const ref of claim.evidence) {
          const source = this.db.prepare('SELECT body FROM evidence WHERE ref=?').get(ref);
          if (source === undefined || source.body === null) throw new Error('Journal evidence unavailable');
          const e = JSON.parse(String(source.body)) as Evidence;
          lines.push(`- Evidence ${ref}: ${e.at}, ${e.actor}, session ${e.nativeSessionId}, entry ${e.entryId}, SHA-256 ${e.digest}`);
          for (const gap of e.gaps) lines.push(`  - Coverage: ${gap}`);
        }
        lines.push('');
      }
    }
    return lines.join('\n');
  }
  publishMarkdown(): void {
    if (this.path === ':memory:') return;
    // Serialize projection generation/publication with commits from other processes.
    this.transaction(() => {
      const path = join(dirname(this.path), 'journal.md');
      if (this.db.prepare('SELECT dirty FROM projection WHERE id=1').get()!.dirty === 0 && existsSync(path)) return;
      const temporary = `${path}.${randomUUID()}.tmp`;
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        try { writeFileSync(fd, this.render()); } finally { closeSync(fd); }
        renameSync(temporary, path);
      } catch (error) {
        try { unlinkSync(temporary); }
        catch (cleanup) { throw new AggregateError([error, cleanup], `Historian projection failed; cleanup failed for ${temporary}`); }
        throw error;
      }
      this.db.exec('UPDATE projection SET dirty=0');
    });
  }
  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}
