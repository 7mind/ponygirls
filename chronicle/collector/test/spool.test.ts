import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash } from '../src/domain.ts';
import { MemorySpool, SqliteSpool, DaemonLock, type Spool, type Pending } from '../src/spool.ts';

const pending = (): Pending => ({ requestId: randomUUID(), sourceKey: 'source', sourceDigest: hash('source-content'), payload: 'synthetic-payload', payloadDigest: hash('synthetic-payload'), expectedRevision: 0, policyDigest: 'policy', attempts: 0, nextAt: 0, status: 'pending', error: null });
for (const adapter of ['memory', 'sqlite']) {
  test(`spool contract ${adapter}: source CAS, exact retry, observations, safe tombstones`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'chronicle-spool-'));
    const store: Spool = adapter === 'memory' ? new MemorySpool() : new SqliteSpool(dir);
    try {
      const entry = pending();
      assert.equal(store.nextReportSequence(), 1n);
      store.reportAccepted(1n, 10);
      assert.equal(store.nextReportSequence(), 2n);
      store.reportFailed('report-failed');
      assert.deepEqual(store.reporting(), { sequence: '2', acceptedSequence: '1', acceptedAt: 10, error: 'report-failed' });
      assert.throws(() => store.reportAccepted(3n, 20), /invalid-report-ack/);
      assert.throws(() => store.reportAccepted(1n, 20), /invalid-report-ack/);
      store.reportAccepted(2n, 30);
      assert.deepEqual(store.reporting(), { sequence: '2', acceptedSequence: '2', acceptedAt: 30, error: null });
      assert.equal(store.head('source').revision, 0);
      assert.equal(store.observe('path', 'a', 10), 10);
      assert.equal(store.observe('path', 'a', 20), 10);
      assert.equal(store.observe('path', 'b', 20), 20);
      store.enqueue(entry);
      assert.throws(() => store.enqueue(pending()), /source-already-pending/);
      store.fail(entry.requestId, 'network', 50, false, 8);
      assert.equal(store.queue()[0]!.payload, entry.payload);
      assert.equal(store.queue()[0]!.requestId, entry.requestId);
      assert.equal(store.queue()[0]!.attempts, 1);
      assert.throws(() => store.ack(entry.requestId, 3), /receipt-revision-mismatch/);
      assert.equal(store.head('source').revision, 0);
      store.ack(entry.requestId, 1);
      assert.equal(store.queue().length, 0);
      assert.equal(store.head('source').revision, 1);
      assert.equal(store.head('source').digest, entry.sourceDigest);
      const next = { ...pending(), expectedRevision: 1 };
      store.enqueue(next);
      store.fail(next.requestId, 'cas-conflict', 100, true, 8);
      assert.equal(store.queue()[0]!.status, 'conflict');
      assert.equal(store.head('source').revision, 1);
      store.retry(next.requestId);
      assert.equal(store.queue()[0]!.requestId, next.requestId);
      assert.equal(store.queue()[0]!.payload, next.payload);
      store.drop(next.requestId, 'operator-drop');
      assert.equal(store.head('source').tombstone, true);
      assert.equal(store.queue().length, 0);
    } finally { store.close(); rmSync(dir, { recursive: true }); }
  });
}

test('SQLite restart preserves namespace, pending exact bytes, attempts and exclusive crash-safe daemon lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-spool-'));
  try {
    let store = new SqliteSpool(dir); const namespace = store.namespace;
    const entry = pending(); store.enqueue(entry);
    assert.equal(store.nextReportSequence(), 1n); store.reportAccepted(1n, 10);
    assert.equal(store.nextReportSequence(), 2n); store.reportFailed('report-failed'); store.close();
    store = new SqliteSpool(dir);
    assert.equal(store.namespace, namespace);
    assert.deepEqual(store.queue(), [entry]);
    assert.deepEqual(store.reporting(), { sequence: '2', acceptedSequence: '1', acceptedAt: 10, error: 'report-failed' });
    assert.equal(store.nextReportSequence(), 3n);
    store.close();
    const lock = new DaemonLock(dir);
    assert.throws(() => new DaemonLock(dir), /collector-already-running/);
    lock.close();
    const recovered = new DaemonLock(dir); recovered.close();
  } finally { rmSync(dir, { recursive: true }); }
});
