import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { execFile, execFileSync } from 'node:child_process';
import { loadConfig, type Config } from '../src/config.ts';
import { admissionReason, decodeOrigin, holdReason, type CollectionOrigin } from '../src/admission.ts';
import { Collector, policyDigest } from '../src/collector.ts';
import { MemorySpool, SqliteSpool, SqliteStorage, type Pending, type Spool } from '../src/spool.ts';
import { hash } from '../src/domain.ts';
import { discoverRoots, scanRoots } from '../src/discovery.ts';
import { formatCollectorStatus } from '../src/status.ts';
import { parseTranscript } from '../src/parsers.ts';
import { encodeSnapshot, sourceIdentity, HttpIngester, UploadError, type Ingester } from '../src/ingest.ts';
import { resolveRuntimePrivacy, FileSecretReader } from '../src/runtime-privacy.ts';
import { acceptingProgress, noGit, syntheticSecrets } from './helpers.ts';
import { CollectorPhase } from '../../generated/typescript/chronicle/api/CollectorPhase.js';
import { IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { IngestRequest_JsonCodec } from '../../generated/typescript/chronicle/api/IngestRequest.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

const pi = readFileSync(new URL('fixtures/pi.jsonl', import.meta.url), 'utf8');
const decode = (body: string) => IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(body) as unknown);
function put(path: string, text: string): void { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text, { mode: 0o600 }); }
function config(home: string, extra: Record<string, unknown>): Config { return loadConfig({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(home, 'token'), stateDir: join(home, 'state'), homeDir: home, quietMs: 0, ...extra }); }
function pending(key: string, digest: string): Pending { return { requestId: randomUUID(), sourceKey: key, sourceDigest: hash(key), payload: 'synthetic', payloadDigest: hash('synthetic'), expectedRevision: 0, policyDigest: digest, attempts: 0, nextAt: 0, status: 'pending', error: null }; }
class Sink implements Ingester {
  readonly bodies: string[] = []; readonly receipts = new Map<string, IngestReceipt>(); unavailable = false;
  async send(body: string): Promise<IngestReceipt> {
    this.bodies.push(body); const request = decode(body);
    const receipt = this.receipts.get(request.requestId) ?? new IngestReceipt(request.requestId, randomUUID(), request.expectedRevision + 1, randomUUID());
    this.receipts.set(request.requestId, receipt);
    if (this.unavailable) throw new UploadError('network-failed', true, false);
    return receipt;
  }
}
function engine(c: Config, spool: Spool, sink: Ingester): Collector { return new Collector(c, spool, sink, () => 0, noGit, acceptingProgress, syntheticSecrets); }
function dbFor(home: string): DatabaseSync { return new DatabaseSync(join(home, 'state/spool.sqlite')); }

// Specified: policy identities are storage observations, never recorded source claims.
test('BA admission configuration is exact, normalized, validated and absent from the golden old policy document', () => {
  const input = { enabled: true, endpoint: 'https://synthetic.invalid', tokenFile: '/synthetic/token', stateDir: '/synthetic/state', homeDir: '/synthetic/home', roots: [{ id: 'fixture', format: 'pi', path: '/synthetic/sessions' }] };
  const original = config('/synthetic/home', input);
  assert.equal(original.excludeDefaultProfile, false); assert.deepEqual(original.excludedYoloProfiles, []);
  for (const extra of [{}, { excludeDefaultProfile: false, excludedYoloProfiles: [] }, { excludeDefaultProfile: true, excludedYoloProfiles: ['foo', 'Foo', 'foo', 'default'] }]) {
    const c = loadConfig({ ...input, ...extra });
    assert.equal(policyDigest(c, 'synthetic-runtime'), 'cb4c987e7a1b6fc14ce09772d01f75d1cc8ae2f83213882353513b034c24adfc');
    assert.equal(JSON.stringify(c.roots), '[{"id":"fixture","format":"pi","path":"/synthetic/sessions","profile":null,"layout":"transcripts"}]');
  }
  assert.deepEqual(loadConfig({ ...input, excludedYoloProfiles: ['foo', 'Foo', 'foo', 'default'] }).excludedYoloProfiles, ['Foo', 'default', 'foo']);
  for (const extra of [{ excludeDefaultProfile: null }, { excludedYoloProfiles: null }, { excludeDefaultProfile: 1 }, { excludedYoloProfiles: 'name' }, { excludedYoloProfiles: [1] }, ...['', '.', '..', 'a b', 'a/b', 'a:b', 'a\n', 'a\r\n', 'é'].map(name => ({ excludedYoloProfiles: [name] }))]) assert.throws(() => loadConfig({ ...input, ...extra }), /invalid-config/);
  for (const origin of [{ kind: ['native'] }, { kind: ['explicit'] }, { kind: {} }, { kind: null }]) assert.throws(() => decodeOrigin(origin), /invalid-pending-origin/);
  const restricted = loadConfig({ ...input, excludedYoloProfiles: ['Foo'] });
  assert.equal(admissionReason({ kind: 'native' }, restricted), null);
  assert.equal(admissionReason({ kind: 'named-yolo', name: 'foo' }, restricted), null);
  assert.equal(admissionReason({ kind: 'named-yolo', name: 'Foo' }, restricted), 'excluded-yolo-profile');
  for (const kind of ['explicit', 'unknown'] as const) assert.equal(admissionReason({ kind }, restricted), kind);
  assert.equal(admissionReason({ kind: 'named-yolo', name: 'default' }, { excludeDefaultProfile: true, excludedYoloProfiles: [] }), null);
});

test('BG admission fields preserve golden public payload/source/raw identity from the immutable prechange collector', () => {
  for (const extra of [{}, { excludeDefaultProfile: false, excludedYoloProfiles: [] }, { excludeDefaultProfile: true, excludedYoloProfiles: ['Foo'] }]) {
    const c = config('/synthetic/home', { endpoint: 'https://synthetic.invalid', ...extra });
    const parsed = parseTranscript('pi', Buffer.from(pi), '/synthetic/s.jsonl', resolveRuntimePrivacy(c, syntheticSecrets).policy);
    const source = sourceIdentity('synthetic-namespace', 'yolo:Foo', 'pi', parsed, '/synthetic/s.jsonl');
    assert.equal(hash(encodeSnapshot('00000000-0000-4000-8000-000000000001', source, 0, parsed, 'p/s.jsonl')), '5ac8e0d37287602b7d04dcceb7070e8647976220ccd813f43e2f568d541fc987');
    assert.equal(hash(parsed.raw), '0ffb2583ef2738e0938394608a2d9a5c9c62d4dbe9982bd4169206a8fb3559b9');
  }
});

test('BA malformed origin kind is rejected, not coerced to a valid discriminant', () => {
  assert.throws(() => decodeOrigin({ kind: ['native'] }), /invalid-pending-origin/);
});

for (const adapter of ['memory', 'sqlite']) {
  function store(home: string): Spool { return adapter === 'memory' ? new MemorySpool() : new SqliteSpool(join(home, 'state')); }
  test(`BG/GoodCommunication admission contract ${adapter}: privacy invalidation still drops held requests, origin flags never exempt them`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = store(home); const sink = new Sink(); sink.unavailable = true;
    try {
      put(join(home, '.pi/agent/sessions/p/s.jsonl'), pi); const base = config(home, {});
      await engine(base, spool, sink).runOnce(1); const entry = spool.queue()[0]!;
      const restricted = { ...base, excludeDefaultProfile: true }; await engine(restricted, spool, sink).runOnce(2); assert.deepEqual(spool.queue(), [entry]);
      const changed = { ...restricted, redactions: { ...restricted.redactions, textPatterns: ['additional-policy'] } };
      await engine(changed, spool, sink).runOnce(3); assert.equal(sink.bodies.length, 1); assert.deepEqual(spool.queue(), []);
      assert.equal(spool.head(entry.sourceKey).tombstone, true); assert.equal(spool.dropped()[0]!.reason, 'privacy-or-destination-changed');
      assert.throws(() => spool.pendingOrigin(entry.requestId), /request-not-found/);
    } finally { spool.close(); rmSync(home, { recursive: true }); }
  });
  test(`BG/GoodCommunication admission contract ${adapter}: unknown origins are held by either restriction without reattribution`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = store(home); const sink = new Sink(); sink.unavailable = true;
    try {
      put(join(home, 'explicit/s.jsonl'), pi); const base = config(home, { discoverNative: false, discoverYolo: false, roots: [{ id: 'yolo:Allowed', format: 'pi', path: join(home, 'explicit') }] });
      await engine(base, spool, sink).runOnce(1); const original = spool.queue()[0]!;
      assert.deepEqual(spool.pendingOrigin(original.requestId), { kind: 'explicit' });
      for (const policy of [{ excludeDefaultProfile: true, excludedYoloProfiles: [] }, { excludeDefaultProfile: false, excludedYoloProfiles: ['Other'] }]) {
        await engine({ ...base, ...policy }, spool, sink).runOnce(2); assert.deepEqual(spool.queue(), [original]); assert.equal(sink.bodies.length, 1);
      }
    } finally { spool.close(); rmSync(home, { recursive: true }); }
  });
  test(`BG/GoodCommunication origin contract ${adapter}: binding lifecycle, failed enqueue rollback and existing duplicate priority`, () => {
    const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = store(home);
    try {
      const entry = pending('source', 'policy'); const origin: CollectionOrigin = { kind: 'named-yolo', name: 'Foo' };
      spool.enqueue(entry, origin); assert.deepEqual(spool.pendingOrigin(entry.requestId), origin);
      assert.throws(() => spool.enqueue({ ...entry, requestId: randomUUID() }, origin), /source-already-pending/);
      assert.throws(() => spool.enqueue({ ...entry, sourceKey: 'other' }, origin), /request-already-pending/);
      assert.deepEqual(spool.queue(), [entry]);
      const invalid = pending('invalid', 'policy');
      assert.throws(() => spool.enqueue(invalid, { kind: 'named-yolo', name: '..' }), /invalid-pending-origin/);
      assert.throws(() => spool.pendingOrigin(invalid.requestId), /request-not-found/);
      spool.enqueue(invalid, { kind: 'explicit' }); spool.drop(invalid.requestId, 'operator-drop');
      spool.fail(entry.requestId, 'network-failed', 99, false, 8); spool.retry(entry.requestId);
      assert.deepEqual(spool.pendingOrigin(entry.requestId), origin);
      assert.throws(() => spool.ack(entry.requestId, 2), /receipt-revision-mismatch/);
      assert.deepEqual(spool.pendingOrigin(entry.requestId), origin);
      spool.ack(entry.requestId, 1); assert.throws(() => spool.pendingOrigin(entry.requestId), /request-not-found/);
      assert.deepEqual(spool.queueWithOrigins(), []);
    } finally { spool.close(); rmSync(home, { recursive: true }); }
  });
  test(`BG/GoodCommunication admission contract ${adapter}: held backoff/stopped/conflict entries retain exact envelopes and reservations`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = store(home); const sink = new Sink();
    try {
      const base = config(home, { discoverNative: false, discoverYolo: false }); const digest = policyDigest(base, resolveRuntimePrivacy(base, syntheticSecrets).identity);
      const entries = ['backoff', 'stopped', 'conflict'].map(key => pending(key, digest));
      for (const entry of entries) spool.enqueue(entry, { kind: 'native' });
      spool.fail(entries[0]!.requestId, 'network-failed', 9999, false, 8);
      spool.fail(entries[1]!.requestId, 'unauthorized', 0, false, 1);
      spool.fail(entries[2]!.requestId, 'cas-conflict', 0, true, 8);
      const before = spool.queue(); const heads = before.map(entry => spool.head(entry.sourceKey));
      const restricted = { ...base, excludeDefaultProfile: true }; const phases: CollectorPhase[] = [];
      const reporter = { report: async (update: Parameters<typeof acceptingProgress.report>[0]) => { phases.push(update.phase); if (update.phase === CollectorPhase.Idle) assert.equal(update.error, undefined); return acceptingProgress.report(update); } };
      const collector = new Collector(restricted, spool, sink, () => 0, noGit, reporter, syntheticSecrets);
      const result = await collector.runOnce(1);
      assert.equal(phases.at(-1), CollectorPhase.Idle);
      assert.equal(result.pending, 1); assert.equal(result.stopped, 1); assert.equal(result.conflicts, 1); assert.equal(result.uploadFailures, 0);
      assert.deepEqual(spool.queue(), before); assert.deepEqual(before.map(entry => spool.head(entry.sourceKey)), heads);
      assert.equal(sink.bodies.length, 0); assert.equal(collector.status().diagnostics.filter(d => holdReason(d) !== null).length, 3);
      assert.match(formatCollectorStatus(collector.status()), /Profile admission: 3 queued requests held/);
      assert.equal(engine(base, spool, sink).status().diagnostics.filter(d => holdReason(d) !== null).length, 0);
      for (const entry of before) assert.throws(() => spool.enqueue({ ...entry, requestId: randomUUID() }, { kind: 'native' }), /source-already-pending/);
      spool.retry(entries[1]!.requestId); const retried = spool.queue(); await collector.runOnce(2); assert.deepEqual(spool.queue(), retried); assert.equal(sink.bodies.length, 0);
      for (const entry of spool.queue()) spool.drop(entry.requestId, 'operator-drop');
      assert.equal(collector.status().diagnostics.filter(d => holdReason(d) !== null).length, 0);
    } finally { spool.close(); rmSync(home, { recursive: true }); }
  });
  test(`BG/GoodCommunication admission contract ${adapter}: default opt-out holds lost ACK request, reenables exact replay without tags or policy changes`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = store(home); const sink = new Sink(); sink.unavailable = true;
    try {
      put(join(home, '.pi/agent/sessions/p/s.jsonl'), pi);
      const base = config(home, {}); await engine(base, spool, sink).runOnce(1); const entry = spool.queue()[0]!;
      assert.deepEqual(spool.pendingOrigin(entry.requestId), { kind: 'native' });
      const restricted = { ...base, excludeDefaultProfile: true }; const collector = engine(restricted, spool, sink);
      const result = await collector.runOnce(2); assert.equal(result.discovered, 0); assert.equal(result.scannedBytes, 0); assert.equal(result.uploaded, 0); assert.equal(result.uploadFailures, 0); assert.equal(result.quarantined, 0); assert.equal(result.pending, 1);
      assert.deepEqual(spool.queue(), [entry]); assert.equal(spool.head(entry.sourceKey).revision, 0); assert.deepEqual(spool.dropped(), []);
      const reports: CollectorPhase[] = []; const reporting = { report: async (value: Parameters<typeof acceptingProgress.report>[0]) => { reports.push(value.phase); assert.equal(value.error, undefined); return acceptingProgress.report(value); } };
      await new Collector(restricted, spool, sink, () => 0, noGit, reporting, syntheticSecrets).runOnce(3); assert.equal(reports.at(-1), CollectorPhase.Idle);
      assert.equal(sink.bodies.length, 1); sink.unavailable = false;
      await engine(base, spool, sink).runOnce(4); assert.deepEqual(sink.bodies, [entry.payload, entry.payload]); assert.equal(spool.head(entry.sourceKey).revision, 1);
      assert.equal(collector.status().diagnostics.filter(d => holdReason(d) !== null).length, 0); assert.deepEqual(spool.dropped(), []);
    } finally { spool.close(); rmSync(home, { recursive: true }); }
  });
  test(`BG/GoodCommunication admission contract ${adapter}: excluded named profiles match case, native stays allowed, explicit claims never authorize`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = store(home); const sink = new Sink(); sink.unavailable = true;
    try {
      for (const name of ['Foo', 'foo', 'default']) put(join(home, '.config/yolo', name, 'pi/home/agent/sessions/p/s.jsonl'), pi);
      put(join(home, '.pi/agent/sessions/p/s.jsonl'), pi); put(join(home, 'explicit/s.jsonl'), pi);
      const base = config(home, { roots: [{ id: 'yolo:TrustMe', format: 'pi', path: join(home, 'explicit') }] }); await engine(base, spool, sink).runOnce(1);
      const before = spool.queue(); assert.equal(before.length, 5); sink.unavailable = false;
      const restricted = { ...base, excludedYoloProfiles: ['Foo'] }; const result = await engine(restricted, spool, sink).runOnce(2);
      assert.equal(result.uploaded, 3); assert.equal(result.pending, 2);
      for (const entry of spool.queue()) { assert.deepEqual(entry, before.find(old => old.requestId === entry.requestId)); assert.ok(['yolo:Foo', 'yolo:TrustMe'].includes(decode(entry.payload).source.discoveryRootId)); }
      const strict = { ...restricted, excludeDefaultProfile: true }; assert.equal((await engine(strict, spool, sink).runOnce(3)).uploaded, 0);
      await engine(base, spool, sink).runOnce(4); assert.equal(spool.queue().length, 0); assert.deepEqual(spool.dropped(), []);
    } finally { spool.close(); rmSync(home, { recursive: true }); }
  });
}

for (const platform of ['linux', 'darwin']) test(`GoodCommunication ${platform}: admission filters actual named/native/harness layouts before transcript traversal and does not mutate config roots`, () => {
  const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-'));
  try {
    const layouts = platform === 'linux' ? ['claude/home/projects/p/main.jsonl', 'codex/home/sessions/p/main.jsonl', 'codex/home/archived_sessions/p/old.jsonl', 'pi/home/agent/sessions/p/main.jsonl', 'pi/home/agent/subagents/root/sessions/child/session.jsonl'] : ['claude/projects/p/main.jsonl', 'codex/sessions/p/main.jsonl', 'codex/archived_sessions/p/old.jsonl', 'pi/sessions/p/main.jsonl', 'pi/subagents/root/sessions/child/session.jsonl'];
    for (const name of ['Allowed', 'Denied', 'default', 'not valid']) for (const layout of layouts) put(join(home, '.config/yolo', name, layout), '{}\n');
    for (const path of ['.claude/projects/p/main.jsonl', '.codex/sessions/p/main.jsonl', '.codex/archived_sessions/p/old.jsonl', '.pi/agent/sessions/p/native.jsonl', '.pi/agent/subagents/root/sessions/child/session.jsonl']) put(join(home, path), '{}\n');
    symlinkSync(join(home, '.config/yolo/Allowed'), join(home, '.config/yolo/Linked'));
    const c = config(home, { excludeDefaultProfile: true, excludedYoloProfiles: ['Denied'], roots: [{ id: 'yolo:Allowed', format: 'pi', path: join(home, '.config/yolo/Allowed', platform === 'linux' ? 'pi/home/agent/sessions' : 'pi/sessions') }] });
    const rootsBefore = JSON.stringify(c.roots); const digest = policyDigest(c, 'runtime');
    const admitted = discoverRoots(c, platform).filter(root => admissionReason(root.origin, c) === null);
    const scan = scanRoots(admitted, c); assert.equal(scan.files.length, 10);
    assert.deepEqual(new Set(scan.files.map(file => file.root.profile)), new Set(['Allowed', 'default']));
    assert.equal(JSON.stringify(c.roots), rootsBefore); assert.equal(policyDigest(c, 'runtime'), digest); assert.deepEqual(scan.diagnostics, []);
  } finally { rmSync(home, { recursive: true }); }
});

// SQLite format controls use synthetic KV data only, never a live user spool.
test('GoodCommunication SQLite legacy missing origins stay unknown across rediscovery/restart, false resumes exact envelope', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); let spool = new SqliteSpool(join(home, 'state')); const sink = new Sink(); sink.unavailable = true;
  try {
    put(join(home, '.config/yolo/Allowed/pi/home/agent/sessions/p/s.jsonl'), pi); const base = config(home, {});
    await engine(base, spool, sink).runOnce(1); const entry = spool.queue()[0]!;
    const db = dbFor(home); db.prepare("DELETE FROM kv WHERE bucket='pending-origin'").run(); db.close(); spool.close(); spool = new SqliteSpool(join(home, 'state'));
    const restricted = { ...base, excludeDefaultProfile: true }; await engine(restricted, spool, sink).runOnce(2);
    assert.deepEqual(spool.pendingOrigin(entry.requestId), { kind: 'unknown' }); assert.deepEqual(spool.queue(), [entry]); assert.equal(sink.bodies.length, 1);
    const verify = dbFor(home); assert.equal(verify.prepare("SELECT count(*) AS n FROM kv WHERE bucket='pending-origin'").get()!['n'], 0); verify.close();
    spool.close(); spool = new SqliteSpool(join(home, 'state')); await engine(restricted, spool, sink).runOnce(3); assert.deepEqual(spool.queue(), [entry]);
    sink.unavailable = false; await engine(base, spool, sink).runOnce(4); assert.deepEqual(sink.bodies, [entry.payload, entry.payload]);
  } finally { spool.close(); rmSync(home, { recursive: true }); }
});

test('GoodCommunication SQLite present malformed/stale origin bindings are corruption, never permissive legacy cache misses', () => {
  const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = new SqliteSpool(join(home, 'state')); const db = dbFor(home);
  try {
    const entry = pending('source', 'policy'); spool.enqueue(entry, { kind: 'named-yolo', name: 'Allowed' });
    const original = { requestId: entry.requestId, payloadDigest: entry.payloadDigest, sourceKey: entry.sourceKey, origin: { kind: 'named-yolo', name: 'Allowed' } };
    for (const value of ['{', JSON.stringify({ ...original, requestId: randomUUID() }), JSON.stringify({ ...original, payloadDigest: hash('different') }), JSON.stringify({ ...original, sourceKey: 'other' }), JSON.stringify({ ...original, origin: { kind: 'named-yolo', name: '..' } }), JSON.stringify({ ...original, origin: { kind: 'named-yolo', name: 'Allowed', extra: true } })]) {
      db.prepare("UPDATE kv SET value=? WHERE bucket='pending-origin' AND key=?").run(value, entry.requestId);
      assert.throws(() => spool.pendingOrigin(entry.requestId), /invalid-pending-origin/); assert.throws(() => spool.queueWithOrigins(), /invalid-pending-origin/); assert.deepEqual(spool.queue(), [entry]);
    }
    db.prepare("UPDATE kv SET value=? WHERE bucket='pending-origin' AND key=?").run(JSON.stringify(original), entry.requestId);
    spool.ack(entry.requestId, 1); assert.equal(db.prepare("SELECT count(*) AS n FROM kv WHERE bucket='pending-origin'").get()!['n'], 0);
    const orphan = pending('new', 'policy'); db.prepare('INSERT INTO kv VALUES(?,?,?)').run('pending-origin', orphan.requestId, JSON.stringify({ ...original, requestId: orphan.requestId }));
    assert.throws(() => spool.enqueue(orphan, { kind: 'native' }), /orphaned-pending-origin/); assert.deepEqual(spool.queue(), []);
    db.prepare("UPDATE kv SET value='{' WHERE bucket='pending-origin'").run();
    assert.throws(() => spool.enqueue(orphan, { kind: 'native' }), /invalid-pending-origin/); assert.deepEqual(spool.queue(), []);
  } finally { db.close(); spool.close(); rmSync(home, { recursive: true }); }
});

test('GoodCommunication SQLite origin write abort rolls back pending/reservation; consistent reads hide uncommitted partial retirement', () => {
  const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = new SqliteSpool(join(home, 'state')); const db = dbFor(home);
  try {
    const entry = pending('source', 'policy');
    db.exec("CREATE TRIGGER abort_origin BEFORE INSERT ON kv WHEN NEW.bucket='pending-origin' BEGIN SELECT RAISE(ABORT,'synthetic-abort'); END");
    assert.throws(() => spool.enqueue(entry, { kind: 'native' }), /synthetic-abort/); assert.deepEqual(spool.queue(), []);
    assert.equal(db.prepare("SELECT count(*) AS n FROM kv WHERE bucket IN ('pending','source-pending','pending-origin')").get()!['n'], 0);
    db.exec('DROP TRIGGER abort_origin'); spool.enqueue(entry, { kind: 'native' });
    db.exec('BEGIN IMMEDIATE'); db.prepare("DELETE FROM kv WHERE bucket='pending-origin'").run();
    assert.deepEqual(spool.queueWithOrigins(), [{ entry, origin: { kind: 'native' } }]);
    db.prepare("DELETE FROM kv WHERE bucket IN ('pending','source-pending')").run(); db.exec('COMMIT'); assert.deepEqual(spool.queueWithOrigins(), []);
    const next = pending('second', 'policy'); spool.enqueue(next, { kind: 'explicit' }); spool.drop(next.requestId, 'operator-drop');
    assert.equal(db.prepare("SELECT count(*) AS n FROM kv WHERE bucket='pending-origin'").get()!['n'], 0);
  } finally { db.close(); spool.close(); rmSync(home, { recursive: true }); }
});

test('GoodCommunication restrictive status is collection-read-only and keeps human/JSON shape while removing stale holds', () => {
  const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = new SqliteSpool(join(home, 'state'));
  try {
    const base = config(home, {}); const entry = pending('source', 'policy'); spool.enqueue(entry, { kind: 'unknown' });
    const path = join(home, 'config.json'); put(path, JSON.stringify({ ...base, roots: [], excludeDefaultProfile: true, tokenFile: join(home, 'does-not-exist') }));
    const before = spool.queue(); const output = execFileSync(process.execPath, [new URL('../src/cli.js', import.meta.url).pathname, '--config', path, '--status', '--json'], { encoding: 'utf8' });
    const status = JSON.parse(output) as { diagnostics: { code: string }[]; queue: unknown[] };
    assert.ok(status.diagnostics.some(d => d.code === 'profile-admission-held-unknown')); assert.equal(status.queue.length, 1); assert.deepEqual(spool.queue(), before);
    assert.match(execFileSync(process.execPath, [new URL('../src/cli.js', import.meta.url).pathname, '--config', path, '--status'], { encoding: 'utf8' }), /Profile admission: 1 queued requests held/);
  } finally { spool.close(); rmSync(home, { recursive: true }); }
});

test('GoodCommunication HTTP admission sends zero snapshot POSTs while held, then replays the exact original body', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const bodies: string[] = []; let unavailable = true;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks).toString();
    if (request.url === '/api/collector/progress') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ sequence: (JSON.parse(body) as { sequence: string }).sequence, accepted: true })); return; }
    assert.equal(request.url, '/api/ingest'); bodies.push(body);
    if (unavailable) { response.writeHead(500); response.end(); return; }
    const value = decode(body); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ requestId: value.requestId, sessionId: randomUUID(), revision: value.expectedRevision + 1, jobId: randomUUID() }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address !== null && typeof address !== 'string');
  const base = config(home, { endpoint: `http://127.0.0.1:${address.port}` }); const spool = new SqliteSpool(base.stateDir);
  try {
    put(base.tokenFile, 'synthetic-private-token'); put(join(home, '.pi/agent/sessions/p/s.jsonl'), pi);
    const run = (c: Config, now: number) => new Collector(c, spool, new HttpIngester(c), () => 0, noGit, acceptingProgress, new FileSecretReader()).runOnce(now);
    await run(base, 1); const entry = spool.queue()[0]!; await run({ ...base, excludeDefaultProfile: true }, 2); assert.equal(bodies.length, 1); assert.deepEqual(spool.queue(), [entry]);
    const path = join(home, 'once.json'); put(path, JSON.stringify({ ...base, excludeDefaultProfile: true }));
    await new Promise<void>((resolve, reject) => execFile(process.execPath, [new URL('../src/cli.js', import.meta.url).pathname, '--config', path, '--once'], (error, stdout) => {
      try { assert.equal(error === null ? 0 : error.code, 1); const result = JSON.parse(stdout) as { pending: number; uploadFailures: number }; assert.equal(result.pending, 1); assert.equal(result.uploadFailures, 0); resolve(); } catch (cause) { reject(cause); }
    }));
    assert.equal(bodies.length, 1); assert.deepEqual(spool.queue(), [entry]);
    unavailable = false; await run(base, 3); assert.deepEqual(bodies, [entry.payload, entry.payload]); assert.equal(spool.head(entry.sourceKey).revision, 1); assert.deepEqual(spool.dropped(), []);
  } finally { spool.close(); await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))); rmSync(home, { recursive: true }); }
});

// This adapter-level control proves a read transaction spans both queries in DELETE journal mode.
test('GoodCommunication SQLite spanning read snapshot prevents a competing ACK commit between pending and origin reads', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = new SqliteSpool(join(home, 'state')); const storage = new SqliteStorage(join(home, 'state'));
  const entry = pending('source', 'policy'); spool.enqueue(entry, { kind: 'native' }); const shared = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT); const control = new Int32Array(shared);
  const worker = new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    (async()=>{
      const {SqliteSpool}=await import(workerData.module);
      const spool=new SqliteSpool(workerData.directory),control=new Int32Array(workerData.shared);
      parentPort.postMessage('ready');
      Atomics.wait(control,0,0,10000);
      try {spool.ack(workerData.requestId,1);Atomics.store(control,1,1);}
      catch(error){Atomics.store(control,1,error.errcode===5?2:3);}
      finally {spool.close();Atomics.store(control,2,1);Atomics.notify(control,2);}
    })().catch(error=>{throw error});
  `, { eval: true, workerData: { module: new URL('../src/spool.js', import.meta.url).href, directory: join(home, 'state'), requestId: entry.requestId, shared } });
  try {
    await once(worker, 'message');
    storage.readTransaction(() => {
      assert.deepEqual(storage.get<Pending>('pending', entry.requestId), entry);
      Atomics.store(control, 0, 1); Atomics.notify(control, 0);
      assert.notEqual(Atomics.wait(control, 2, 0, 5000), 'timed-out');
      assert.equal(Atomics.load(control, 1), 2, 'competing ACK must roll back SQLITE_BUSY while the read snapshot spans both queries');
      const origin = storage.get<{ origin: CollectionOrigin }>('pending-origin', entry.requestId)!;
      assert.deepEqual(origin.origin, { kind: 'native' });
    });
    await once(worker, 'exit'); assert.deepEqual(spool.queue(), [entry]); assert.equal(spool.head(entry.sourceKey).revision, 0);
    spool.ack(entry.requestId, 1); assert.deepEqual(spool.queueWithOrigins(), []);
  } finally { await worker.terminate(); storage.close(); spool.close(); rmSync(home, { recursive: true }); }
});

test('GoodCommunication corrupt origins prevent ingestion even without restrictions, and DB locks remain DB errors', async () => {
  const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = new SqliteSpool(join(home, 'state')); const db = dbFor(home); const sink = new Sink();
  try {
    const c = config(home, { discoverNative: false, discoverYolo: false }); const entry = pending('source', policyDigest(c, resolveRuntimePrivacy(c, syntheticSecrets).identity));
    spool.enqueue(entry, { kind: 'named-yolo', name: 'Allowed' });
    db.prepare("UPDATE kv SET value='{' WHERE bucket='pending-origin'").run();
    await assert.rejects(() => engine(c, spool, sink).runOnce(1), /invalid-pending-origin/); assert.equal(sink.bodies.length, 0); assert.deepEqual(spool.queue(), [entry]);
    db.prepare("UPDATE kv SET value=? WHERE bucket='pending-origin'").run(JSON.stringify({ requestId: entry.requestId, payloadDigest: entry.payloadDigest, sourceKey: entry.sourceKey, origin: { kind: 'native' } }));
    db.exec('BEGIN EXCLUSIVE'); assert.throws(() => spool.pendingOrigin(entry.requestId), error => error instanceof Error && !error.message.includes('invalid-pending-origin') && error.message.includes('locked')); db.exec('ROLLBACK');
    assert.deepEqual(spool.queue(), [entry]);
  } finally { db.close(); spool.close(); rmSync(home, { recursive: true }); }
});

test('BG status replaces every reserved historical hold code, retaining unrelated diagnostics from a same-named custom root', () => {
  const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = new MemorySpool();
  try {
    spool.diagnostic({ rootId: 'admission-queue', pathId: 'historical-source', code: 'profile-admission-held-old-reason' });
    spool.diagnostic({ rootId: 'admission-queue', pathId: 'parse-source', code: 'parse-failed' });
    const status = engine(config(home, {}), spool, new Sink()).status();
    assert.deepEqual(status.diagnostics, [{ rootId: 'admission-queue', pathId: 'parse-source', code: 'parse-failed' }]);
  } finally { spool.close(); rmSync(home, { recursive: true }); }
});

test('GoodCommunication present bound-origin fields require strings even when corrupted pending fields compare equal', () => {
  const home = mkdtempSync(join(tmpdir(), 'chronicle-admission-')); const spool = new SqliteSpool(join(home, 'state')); const db = dbFor(home);
  try {
    const entry = pending('source', 'policy'); spool.enqueue(entry, { kind: 'native' });
    for (const field of ['requestId', 'payloadDigest', 'sourceKey']) {
      const corrupt = { ...entry, [field]: 7 };
      const origin = { requestId: corrupt.requestId, payloadDigest: corrupt.payloadDigest, sourceKey: corrupt.sourceKey, origin: { kind: 'native' } };
      db.prepare("UPDATE kv SET value=? WHERE bucket='pending' AND key=?").run(JSON.stringify(corrupt), entry.requestId);
      db.prepare("INSERT INTO kv VALUES('pending-origin',?,?) ON CONFLICT(bucket,key) DO UPDATE SET value=excluded.value").run(String(corrupt.requestId), JSON.stringify(origin));
      assert.throws(() => spool.queueWithOrigins(), /invalid-pending-origin/, field);
    }
  } finally { db.close(); spool.close(); rmSync(home, { recursive: true }); }
});
