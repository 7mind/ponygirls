import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { JournalStore } from '../src/store.ts';
import { digest, evidenceFromEntry } from '../src/evidence.ts';

const model = { provider: 'fixture', id: 'scripted', thinking: 'off' };
const context = digest('PRIVATE_FOCUS');
const completion = { outcome: 'failed', failure: 'invalid-json', endedAt: '2026-11-06T18:00:00Z', durationMs: 10, responseChars: 23, usage: null };
function fixture(t, memory) {
  const dir = mkdtempSync(join(tmpdir(), 'historian-attempts-'));
  const path = memory ? ':memory:' : join(dir, 'journal.sqlite');
  const store = new JournalStore(path, '/repo/.git');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const e = evidenceFromEntry('native', 'root', { type: 'message', id: 'e1', parentId: null, timestamp: '2026-11-06T17:59:00Z', message: { role: 'user', content: 'PRIVATE_EVIDENCE', timestamp: 1 } });
  store.capture('root', true, [], [e], []);
  return { store, path, batch: store.batch('root') };
}

for (const memory of [true, false]) {
  test(`attempt receipts (${memory ? 'memory' : 'file'}): failure, recovery and privacy`, t => {
    const { store, batch } = fixture(t, memory);
    const first = store.beginAttempt(batch, { ...model, privateExtra: 'PRIVATE_CONFIG' }, 'v1', context);
    assert.equal(store.attemptSummary('root').running, 1);
    assert.throws(() => store.beginAttempt(batch, model, 'v1', context), /UNIQUE/);
    store.finishAttempt(first.id, { ...completion, responseBody: 'PRIVATE_RESPONSE', error: 'PRIVATE_ERROR',
      usage: { input: 5, output: 6, cacheRead: 0, cacheWrite: 0, totalTokens: 11, extra: 'PRIVATE_USAGE' } });
    const second = store.beginAttempt(batch, model, 'v1', context);
    assert.notEqual(second.id, first.id);
    store.finishAttempt(second.id, { ...completion, outcome: 'validated', failure: null });
    assert.deepEqual(store.attemptSummary('root'), { total: 2, running: 0, failed: 1, validated: 1, recovered: 1, cancelled: 0, interrupted: 0 });
    assert.deepEqual(store.attemptSummary('other'), { total: 0, running: 0, failed: 0, validated: 0, recovered: 0, cancelled: 0, interrupted: 0 });
    const receipts = store.attempts('root', 10);
    assert.deepEqual(receipts.map(a => a.id), [second.id, first.id]);
    assert.equal(receipts[1].failure, 'invalid-json'); assert.equal(receipts[1].contextDigest, context);
    assert.equal(receipts[1].batchId, batch.id); assert.equal(receipts[1].durationMs, 10);
    assert.doesNotMatch(JSON.stringify(receipts), /PRIVATE_/);
    assert.equal(store.pending('root'), 1, 'validated response does not imply publication');
    assert.throws(() => store.finishAttempt(first.id, completion), /finalized/);
    assert.throws(() => store.attempts('root', 0), /limit/);
    assert.throws(() => store.attempts('root', 101), /limit/);
  });
  test(`attempt receipts (${memory}): interruption is unknown, not fabricated failure or duration`, t => {
    const { store, batch } = fixture(t, memory);
    const first = store.beginAttempt(batch, model, 'v1', context);
    store.interruptAttempts('other'); assert.equal(store.attemptSummary('root').running, 1);
    store.interruptAttempts('root'); store.interruptAttempts('root');
    assert.deepEqual(store.attemptSummary('root'), { total: 1, running: 0, failed: 0, validated: 0, recovered: 0, cancelled: 0, interrupted: 1 });
    const [receipt] = store.attempts('root', 10);
    assert.equal(receipt.id, first.id); assert.equal(receipt.durationMs, null); assert.equal(receipt.failure, null);
    assert.equal(receipt.usage, null); assert.equal(store.pending('root'), 1);
  });
}

test('file receipts persist across reopening and schema-1 migration preserves existing evidence', t => {
  const { store, path, batch } = fixture(t, false);
  store.close();
  const legacy = new DatabaseSync(path); legacy.exec('DROP TABLE attempts; PRAGMA user_version=1;'); legacy.close();
  const upgraded = new JournalStore(path, '/repo/.git'); t.after(() => upgraded.close());
  assert.deepEqual(upgraded.batch('root'), batch);
  const first = upgraded.beginAttempt(batch, model, 'v1', context);
  upgraded.finishAttempt(first.id, completion); upgraded.close();
  const reopened = new JournalStore(path, '/repo/.git'); t.after(() => reopened.close());
  assert.equal(reopened.attemptSummary('root').failed, 1);
  assert.equal(reopened.attempts('root', 1)[0].id, first.id);
  assert.deepEqual(reopened.batch('root'), batch);
});
