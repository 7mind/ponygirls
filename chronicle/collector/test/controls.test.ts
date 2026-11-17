import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { MemorySpool, SqliteSpool, type Spool } from '../src/spool.ts';
import { Collector } from '../src/collector.ts';
import { loadConfig } from '../src/config.ts';
import { UploadError, type Ingester } from '../src/ingest.ts';
import { noGit, acceptingProgress, syntheticSecrets } from './helpers.ts';
import { CollectorPhase } from '../../generated/typescript/chronicle/api/CollectorPhase.js';
import { IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
const raw = readFileSync(new URL('fixtures/pi.jsonl', import.meta.url), 'utf8');
class Sink implements Ingester {
  payloads: string[] = []; fail = true;
  async send(payload: string) {
    this.payloads.push(payload);
    if (this.fail) throw new UploadError('network-failed', true, false);
    const value = JSON.parse(payload) as { requestId: string; expectedRevision: number };
    return new IngestReceipt(value.requestId, randomUUID(), value.expectedRevision + 1, randomUUID());
  }
}
function harness(adapter: string, extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-controls-')), source = join(dir, 'sessions'), state = join(dir, 'state');
  mkdirSync(source); const path = join(source, 's.jsonl'); writeFileSync(path, raw);
  const config = loadConfig({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'token'), stateDir: state, homeDir: dir, discoverNative: false, discoverYolo: false, quietMs: 0, roots: [{ id: 'fixture', format: 'pi', path: source }], ...extra });
  let spool: Spool = adapter === 'memory' ? new MemorySpool() : new SqliteSpool(state);
  const sink = new Sink();
  return { dir, source, path, config, sink, get spool() { return spool; }, restart() { if (adapter === 'sqlite') { spool.close(); spool = new SqliteSpool(state); } }, close() { spool.close(); rmSync(dir, { recursive: true }); } };
}
for (const adapter of ['memory', 'sqlite']) {
  test(`Behavioral Blackbox ${adapter}: controls retain exact queued requests, heads and reports across restart; release without re-admission`, async () => {
    const h = harness(adapter);
    try {
      let collector = new Collector(h.config, h.spool, h.sink, () => 0, noGit, acceptingProgress, syntheticSecrets);
      await collector.runOnce(100); const queued = h.spool.queue(), report = h.spool.report(), reporting = h.spool.reporting();
      assert.equal(queued.length, 1);
      h.spool.setPaused(true); h.restart();
      collector = new Collector(h.config, h.spool, h.sink, () => 0, { read: async () => { throw new Error('git must not run'); } }, { report: async () => { throw new Error('report must not run'); } }, { read: () => { throw new Error('secret must not be read'); } });
      rmSync(h.path);
      await collector.runOnce(200);
      assert.deepEqual(h.spool.queue(), queued); assert.deepEqual(h.spool.report(), report); assert.deepEqual(h.spool.reporting(), reporting);
      assert.equal(collector.status().controls.paused, true);
      h.spool.setPaused(false); h.spool.exclude('/synthetic/project'); h.restart();
      collector = new Collector(h.config, h.spool, h.sink, () => 0, noGit, acceptingProgress, syntheticSecrets);
      await collector.runOnce(300);
      assert.deepEqual(h.spool.queue(), queued); assert.deepEqual(collector.status().heldRequests, [queued[0]!.requestId]);
      assert.equal(h.sink.payloads.length, 1); assert.deepEqual(h.spool.dropped(), []); assert.equal(h.spool.head(queued[0]!.sourceKey).tombstone, false);
      h.spool.unexclude('/synthetic/project'); h.sink.fail = false;
      await collector.runOnce(400);
      assert.equal(h.sink.payloads.length, 2); assert.equal(h.sink.payloads[0], h.sink.payloads[1]); assert.equal(h.spool.queue().length, 0);
      assert.equal(h.spool.head(queued[0]!.sourceKey).revision, 1);
    } finally { h.close(); }
  });
  test(`Behavioral Blackbox ${adapter}: captures every original cwd and symlink alias before redaction, with private evidence`, async () => {
    const h = harness(adapter, { redactions: { textPatterns: ['/synthetic/project', '/synthetic/other'] } });
    try {
      const real = join(h.dir, 'project'); mkdirSync(real); const alias = join(h.dir, 'alias'); symlinkSync(real, alias);
      writeFileSync(h.path, raw + JSON.stringify({ type: 'other', cwd: '/synthetic/other' }) + '\n' + JSON.stringify({ type: 'other', payload: { cwd: alias } }) + '\n');
      const collector = new Collector(h.config, h.spool, h.sink, () => 0, noGit, acceptingProgress, syntheticSecrets);
      await collector.runOnce(100); const queue = h.spool.queue(); assert.equal(queue.length, 1);
      for (const path of ['/synthetic/project', '/synthetic/other', real, alias, h.source]) {
        h.spool.exclude(path); await collector.runOnce(200);
        assert.deepEqual(h.spool.queue(), queue); assert.equal(collector.status().heldRequests.length, 1);
        h.spool.unexclude(path);
      }
      const status = JSON.stringify(collector.status()); assert.ok(!status.includes(alias)); assert.ok(!status.includes('/synthetic/other'));
      h.sink.fail = false; await collector.runOnce(300); assert.equal(h.spool.queue().length, 0);
    } finally { h.close(); }
  });
  test(`Behavioral Blackbox ${adapter}: changes during awaited reporting prevent reads/git/uploads and keep exact work`, async () => {
    const h = harness(adapter); let mode = 'scan'; let gitReads = 0;
    try {
      const reporter = { async report(update: Parameters<typeof acceptingProgress.report>[0]) {
        await Promise.resolve();
        if (mode === 'scan' && update.phase === CollectorPhase.Scanning) h.spool.exclude(h.source);
        if (mode === 'upload' && update.currentUploadTotalBytes !== undefined) h.spool.setPaused(true);
        if (mode === 'exclude' && update.currentUploadTotalBytes !== undefined) h.spool.exclude('/synthetic/project');
        return acceptingProgress.report(update);
      } };
      const collector = new Collector(h.config, h.spool, h.sink, () => 0, { async read() { gitReads++; return { remote: null, diagnostic: null }; } }, reporter, syntheticSecrets);
      const first = await collector.runOnce(100); assert.equal(first.scanned, 0); assert.equal(gitReads, 0); assert.equal(h.sink.payloads.length, 0);
      h.spool.unexclude(h.source); mode = 'upload';
      await collector.runOnce(200); const queue = h.spool.queue(); assert.equal(queue.length, 1); assert.equal(h.sink.payloads.length, 0);
      mode = 'exclude'; h.spool.setPaused(false);
      await collector.runOnce(300); assert.equal(h.sink.payloads.length, 0); assert.deepEqual(h.spool.queue(), queue);
      mode = 'none'; h.spool.unexclude('/synthetic/project'); h.sink.fail = false;
      await collector.runOnce(400); assert.equal(h.sink.payloads[0], queue[0]!.payload);
    } finally { h.close(); }
  });
  test(`Behavioral Blackbox ${adapter}: equivalent redacted copies aggregate source paths and all original workdirs`, async () => {
    const h = harness(adapter, { redactions: { textPatterns: ['/synthetic/project', '/synthetic/other'] } });
    try {
      const other = join(h.source, 'z.jsonl'); writeFileSync(other, raw.replace('/synthetic/project', '/synthetic/other'));
      const collector = new Collector(h.config, h.spool, h.sink, () => 0, noGit, acceptingProgress, syntheticSecrets);
      await collector.runOnce(100); const queue = h.spool.queue(); assert.equal(queue.length, 1);
      for (const path of [h.path, other, '/synthetic/project', '/synthetic/other']) {
        h.spool.exclude(path); assert.deepEqual(collector.status().heldRequests, [queue[0]!.requestId]);
        await collector.runOnce(200); assert.deepEqual(h.spool.queue(), queue); h.spool.unexclude(path);
      }
    } finally { h.close(); }
  });
  test(`Behavioral Blackbox ${adapter}: changes during git await prevent enqueue and intentional stopped/conflict holds report Idle`, async () => {
    const h = harness(adapter);
    try {
      let exclude = true; const phases: CollectorPhase[] = [];
      const collector = new Collector(h.config, h.spool, h.sink, () => 0, { async read() { await Promise.resolve(); if (exclude) h.spool.exclude('/synthetic/project'); return { remote: null, diagnostic: null }; } }, { async report(update) { phases.push(update.phase); return acceptingProgress.report(update); } }, syntheticSecrets);
      await collector.runOnce(100); assert.equal(h.spool.queue().length, 0); assert.equal(h.sink.payloads.length, 0);
      exclude = false; h.spool.unexclude('/synthetic/project'); await collector.runOnce(200);
      const entry = h.spool.queue()[0]!;
      for (const conflict of [false, true]) {
        h.spool.fail(entry.requestId, conflict ? 'conflict' : 'stopped', 0, conflict, 1);
        const queue = h.spool.queue(); h.spool.exclude('/synthetic/project');
        await collector.runOnce(300); assert.equal(phases.at(-1), CollectorPhase.Idle); assert.deepEqual(h.spool.queue(), queue);
        h.spool.unexclude('/synthetic/project');
      }
    } finally { h.close(); }
  });
  test(`Behavioral Blackbox ${adapter}: current upload may finish but pause during send prevents the next upload`, async () => {
    const h = harness(adapter);
    try {
      writeFileSync(join(h.source, 'second.jsonl'), raw.replace('pi-synthetic', 'pi-second'));
      h.sink.fail = false;
      const ingester = { async send(payload: string) { const receipt = await h.sink.send(payload); h.spool.setPaused(true); return receipt; } };
      const collector = new Collector(h.config, h.spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets);
      assert.equal((await collector.runOnce(100)).uploaded, 1); assert.equal(h.sink.payloads.length, 1); assert.equal(h.spool.queue().length, 1);
      h.spool.setPaused(false);
      await collector.runOnce(200); assert.equal(h.sink.payloads.length, 2); assert.equal(h.spool.queue().length, 0);
    } finally { h.close(); }
  });
  test(`Behavioral Blackbox ${adapter}: unresolved recorded cwd does not quarantine unrestricted collection but holds with any exclusion`, async () => {
    const h = harness(adapter);
    try {
      writeFileSync(h.path, raw.replace('/synthetic/project', 'relative-recorded-cwd'));
      const collector = new Collector(h.config, h.spool, h.sink, () => 0, noGit, acceptingProgress, syntheticSecrets);
      assert.equal((await collector.runOnce(100)).quarantined, 0); const queue = h.spool.queue(); assert.equal(queue.length, 1);
      h.spool.exclude('/unrelated'); await collector.runOnce(200); assert.deepEqual(h.spool.queue(), queue); assert.deepEqual(collector.status().heldRequests, [queue[0]!.requestId]);
      h.spool.unexclude('/unrelated'); h.sink.fail = false; await collector.runOnce(300); assert.equal(h.spool.queue().length, 0);
    } finally { h.close(); }
  });
  test(`Behavioral Blackbox ${adapter}: dynamic controls cannot relax static exclusions`, async () => {
    const h = harness(adapter, { exclusions: { projects: ['/synthetic/project'] } });
    try {
      const collector = new Collector(h.config, h.spool, h.sink, () => 0, noGit, acceptingProgress, syntheticSecrets);
      h.spool.exclude('/synthetic'); h.spool.unexclude('/synthetic'); h.spool.setPaused(true); h.spool.setPaused(false);
      assert.equal((await collector.runOnce(100)).excluded, 1); assert.equal(h.sink.payloads.length, 0); assert.equal(h.spool.queue().length, 0);
    } finally { h.close(); }
  });
  test(`Behavioral Blackbox ${adapter}: unknown legacy evidence held only while exclusions active`, async () => {
    const h = harness(adapter);
    try {
      await new Collector(h.config, h.spool, h.sink, () => 0, noGit, acceptingProgress, syntheticSecrets).runOnce(100);
      const original = h.spool.queue()[0]!;
      // Migrate the same exact request through the public legacy enqueue contract.
      const legacy: Spool = adapter === 'memory' ? new MemorySpool() : new SqliteSpool(join(h.dir, 'legacy'));
      try {
        legacy.enqueue(original, { kind: 'explicit' }, null); legacy.exclude('/unrelated'); rmSync(h.path);
        const collector = new Collector(h.config, legacy, h.sink, () => 0, noGit, acceptingProgress, syntheticSecrets);
        await collector.runOnce(200); assert.deepEqual(legacy.queue(), [original]); assert.deepEqual(collector.status().heldRequests, [original.requestId]);
        legacy.unexclude('/unrelated'); h.sink.fail = false; await collector.runOnce(300); assert.equal(legacy.queue().length, 0); assert.equal(h.sink.payloads.at(-1), original.payload);
      } finally { legacy.close(); }
    } finally { h.close(); }
  });
}

test('Behavioral GoodCommunication: malformed controls/evidence fail closed; no send or destructive drops', async () => {
  const h = harness('sqlite');
  try {
    const collector = new Collector(h.config, h.spool, h.sink, () => 0, noGit, acceptingProgress, syntheticSecrets);
    await collector.runOnce(100); const queue = h.spool.queue();
    const db = new DatabaseSync(join(h.config.stateDir, 'spool.sqlite'));
    try {
      db.prepare('INSERT INTO kv VALUES (?,?,?)').run('meta', 'controls', 'null');
      await assert.rejects(collector.runOnce(200), /invalid-collector-controls/); assert.throws(() => collector.status(), /invalid-collector-controls/);
      db.prepare('DELETE FROM kv WHERE bucket=? AND key=?').run('meta', 'controls');
      db.prepare('UPDATE kv SET value=? WHERE bucket=? AND key=?').run('{"invalid":true}', 'pending-evidence', queue[0]!.requestId);
      h.spool.exclude('/unrelated');
      await assert.rejects(collector.runOnce(300), /invalid-admission-evidence/);
      assert.deepEqual(h.spool.queue(), queue); assert.equal(h.sink.payloads.length, 1); assert.deepEqual(h.spool.dropped(), []);
    } finally { db.close(); }
  } finally { h.close(); }
});

test('Behavioral GoodCommunication: aliases can be removed after the symlink and target disappear', () => {
  const h = harness('sqlite');
  try {
    const real = join(h.dir, 'real'), alias = join(h.dir, 'alias'); mkdirSync(real); symlinkSync(real, alias);
    h.spool.exclude(alias); h.restart(); assert.deepEqual(new Set(h.spool.controls().exclusions), new Set([real, alias]));
    rmSync(alias); rmSync(real, { recursive: true }); h.spool.unexclude(alias); assert.deepEqual(h.spool.controls().exclusions, []);
  } finally { h.close(); }
});


test('Behavioral GoodCommunication: damaged exclusion index cannot silently relax controls during a mutation', () => {
  const h = harness('sqlite');
  try {
    h.spool.exclude('/private');
    const db = new DatabaseSync(join(h.config.stateDir, 'spool.sqlite'));
    try {
      db.prepare('DELETE FROM kv WHERE bucket=?').run('control-exclusion');
      assert.throws(() => h.spool.controls(), /invalid-collector-controls/);
      assert.throws(() => h.spool.exclude('/public'), /invalid-collector-controls/);
      assert.throws(() => h.spool.setPaused(false), /invalid-collector-controls/);
      assert.deepEqual(JSON.parse(String(db.prepare('SELECT value FROM kv WHERE bucket=? AND key=?').get('meta', 'controls')!['value'])), { paused: false, exclusions: ['/private'] });
    } finally { db.close(); }
  } finally { h.close(); }
});

test('Behavioral GoodCommunication: status retains a coherent admission snapshot across a competing ACK', async () => {
  const h = harness('sqlite');
  const competitor = new SqliteSpool(h.config.stateDir);
  class SnapshotSpool extends SqliteSpool {
    afterSnapshot: (() => void) | null = null;
    override queueWithOrigins() { const result = super.queueWithOrigins(); this.afterSnapshot?.(); return result; }
    override queueWithAdmission() { const result = super.queueWithAdmission(); this.afterSnapshot?.(); return result; }
  }
  const reader = new SnapshotSpool(h.config.stateDir);
  try {
    const collector = new Collector(h.config, reader, h.sink, () => 0, noGit, acceptingProgress, syntheticSecrets);
    await collector.runOnce(100); const entry = reader.queue()[0]!;
    reader.afterSnapshot = () => { reader.afterSnapshot = null; competitor.ack(entry.requestId, 1); };
    const status = collector.status();
    assert.deepEqual(status.queue.map(row => row.requestId), [entry.requestId]);
    assert.deepEqual(status.heldRequests, []); assert.deepEqual(reader.queue(), []);
  } finally { reader.close(); competitor.close(); h.close(); }
});

test('Behavioral GoodCommunication: source alias failure after awaited scan report quarantines only that file', async () => {
  const h = harness('sqlite'); let swapped = false;
  try {
    writeFileSync(join(h.source, 'valid.jsonl'), raw.replace('pi-synthetic', 'pi-valid'));
    h.sink.fail = false;
    const reporter = { async report(update: Parameters<typeof acceptingProgress.report>[0]) {
      if (!swapped && update.phase === CollectorPhase.Scanning) {
        await Promise.resolve(); swapped = true;
        rmSync(h.path); symlinkSync(h.path, h.path);
      }
      return acceptingProgress.report(update);
    } };
    const collector = new Collector(h.config, h.spool, h.sink, () => 0, noGit, reporter, syntheticSecrets);
    const counters = await collector.runOnce(100);
    assert.equal(counters.quarantined, 1); assert.equal(counters.uploaded, 1);
    assert.equal(h.sink.payloads.length, 1);
    assert.ok(h.spool.diagnostics().some(value => value.code === 'control-path-unavailable' || value.code === 'symlink-forbidden'));
    assert.equal(h.spool.report()!.counters.quarantined, 1);
  } finally { h.close(); }
});

for (const adapter of ['memory', 'sqlite']) {
  test(`Behavioral Blackbox ${adapter}: removing a deleted alias preserves independently owned canonical and descendant exclusions`, () => {
    const h = harness(adapter);
    try {
      const real = join(h.dir, 'a-real'), alias = join(h.dir, 'z-alias'), other = join(h.dir, 'zz-alias'), child = join(real, 'child');
      mkdirSync(child, { recursive: true }); symlinkSync(real, alias); symlinkSync(real, other);
      h.spool.exclude(real); h.spool.exclude(alias); h.spool.exclude(other); h.spool.exclude(child);
      rmSync(alias); h.spool.unexclude(alias);
      assert.deepEqual(h.spool.controls().exclusions, [real, child, other].sort());
      // A canonical path still selects all groups currently observing that alias,
      // but does not remove a separately owned descendant exclusion.
      h.spool.unexclude(real);
      assert.deepEqual(h.spool.controls().exclusions, [child]);
      h.spool.setPaused(true); h.restart(); assert.deepEqual(h.spool.controls(), { paused: true, exclusions: [child] });
      h.spool.unexclude(child); assert.deepEqual(h.spool.controls(), { paused: true, exclusions: [] });
    } finally { h.close(); }
  });
}
