import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalStore } from '../src/store.ts';
import { evidenceFromEntry } from '../src/evidence.ts';

const binding = { endpoint: 'https://chronicle.example/api/ingest', tokenFile: '/private/token', collectorNamespace: 'historian-fixture', tokenHash: 'a'.repeat(64) };
const meta = { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v2', usage: null };
function publish(store, id, upload, previous) {
  const evidence = evidenceFromEntry('native', 'root', { type: 'message', id, parentId: null, timestamp: '2026-11-16T12:00:00Z', message: { role: 'user', content: 'PRIVATE_RAW_EVIDENCE_BODY', timestamp: 1 } });
  store.capture('root', true, [], [evidence], ['Synthetic coverage gap']);
  const revisions = store.commit(store.batch('root'), [{ episodeId: previous === null ? null : previous.episodeId, expectedRevision: previous === null ? 0 : previous.revision, title: 'Synthetic discovery', kind: 'discovery', status: 'ongoing', claims: [{ section: 'observation', basis: 'reported', text: 'Summary-only claim', evidence: [evidence.ref] }] }], { ...meta, ...(upload === null ? {} : { chronicle: upload }) });
  return revisions[0];
}
for (const memory of [true, false]) test(`Chronicle outbox (${memory ? 'memory' : 'file'} SQLite): no backfill, atomic queue and immutable evidence references`, t => {
  const directory = mkdtempSync(join(tmpdir(), 'historian-outbox-'));
  const store = new JournalStore(memory ? ':memory:' : join(directory, 'journal.sqlite'), '/repo/.git');
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const historical = publish(store, 'old', null, null);
  assert.equal(store.chronicleStatus(binding).pending, 0);
  const current = publish(store, 'new', binding, historical);
  const item = store.nextChronicle(binding);
  assert.equal(item.document.episode.revision, 2);
  assert.equal(item.document.episode.episodeId, current.episodeId);
  assert.equal(item.expectedRevision, 0, 'Chronicle revisions are independent of skipped local revisions');
  assert.equal(item.document.episode.claims[0].basis, 'reported');
  assert.equal(item.document.evidence[0].nativeSessionId, 'native');
  assert.match(item.document.evidence[0].digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(item.document.coverage, ['Synthetic coverage gap']);
  assert.doesNotMatch(JSON.stringify(item.document), /PRIVATE_RAW_EVIDENCE_BODY|tokenFile|tokenHash/);
  assert.equal(store.chronicleStatus(binding).pending, 1);
  publish(store, 'off', null, current);
  assert.equal(store.chronicleStatus(binding).pending, 1, 'disabled updates never enter the outbox');
});

test('replaying a commit after enabling upload cannot mint eligibility for its old revisions', t => {
  const store = new JournalStore(':memory:', '/repo/.git'); t.after(() => store.close());
  const e = evidenceFromEntry('native', 'root', { type: 'message', id: 'old-batch', parentId: null, timestamp: '2026-11-16T12:00:00Z', message: { role: 'user', content: 'Synthetic old evidence', timestamp: 1 } });
  store.capture('root', true, [], [e], []); const batch = store.batch('root');
  const proposals = [{ episodeId: null, expectedRevision: 0, title: 'Old summary', kind: 'discovery', status: 'ongoing', claims: [{ section: 'observation', basis: 'reported', text: 'Old claim', evidence: [e.ref] }] }];
  const committed = store.commit(batch, proposals, meta);
  assert.deepEqual(store.commit(batch, proposals, { ...meta, chronicle: binding }), committed);
  assert.equal(store.nextChronicle(binding), null); assert.equal(store.chronicleStatus(binding).pending, 0);
});

test('outbox survives restart, reuses prepared payload/request, validates ACK and advances source CAS only after ACK', t => {
  const directory = mkdtempSync(join(tmpdir(), 'historian-outbox-restart-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'journal.sqlite'); let store = new JournalStore(path, '/repo/.git');
  t.after(() => store.close());
  const first = publish(store, 'first', binding, null); const queued = store.nextChronicle(binding);
  const payload = JSON.stringify({ immutable: queued.requestId });
  store.prepareChronicle(queued.requestId, payload, 0);
  store.attemptChronicle(queued.requestId);
  store.failChronicle(queued.requestId, 'network-failed');
  publish(store, 'second', binding, first);
  store.close(); store = new JournalStore(path, '/repo/.git');
  assert.equal(store.nextChronicle(binding).requestId, queued.requestId);
  assert.equal(store.nextChronicle(binding).payload, payload);
  assert.equal(store.nextChronicle(binding).attempts, 1);
  assert.throws(() => store.prepareChronicle(queued.requestId, 'changed', 0), /payload/);
  const receipt = { requestId: queued.requestId, sessionId: '00000000-0000-4000-8000-000000000001', revision: 1, jobId: '00000000-0000-4000-8000-000000000002' };
  assert.throws(() => store.ackChronicle(queued.requestId, { ...receipt, revision: 2 }), /receipt/);
  assert.equal(store.nextChronicle(binding).expectedRevision, 0);
  store.ackChronicle(queued.requestId, receipt); store.ackChronicle(queued.requestId, receipt);
  const next = store.nextChronicle(binding);
  assert.notEqual(next.requestId, queued.requestId); assert.equal(next.expectedRevision, 1);
  assert.equal(next.sessionId, receipt.sessionId);
  store.prepareChronicle(next.requestId, 'next payload', 1);
  assert.throws(() => store.ackChronicle(next.requestId, { ...receipt, requestId: next.requestId, revision: 2, sessionId: '00000000-0000-4000-8000-000000000003' }), /receipt/);
  assert.equal(store.chronicleStatus(binding).acknowledged, 1);
});

test('destination and credential bindings isolate pending work; exhausted attempts require explicit retry', t => {
  const store = new JournalStore(':memory:', '/repo/.git'); t.after(() => store.close());
  publish(store, 'one', binding, null);
  const changed = { ...binding, endpoint: 'https://other.example/api/ingest' };
  assert.equal(store.nextChronicle(changed), null);
  assert.equal(store.nextChronicle({ ...binding, tokenHash: 'b'.repeat(64) }), null);
  const item = store.nextChronicle(binding); store.prepareChronicle(item.requestId, 'payload', 0);
  for (let i = 0; i < 3; i++) { store.attemptChronicle(item.requestId); store.failChronicle(item.requestId, 'network-failed'); }
  assert.equal(store.nextChronicle(binding), null); assert.equal(store.chronicleStatus(binding).stopped, 1);
  store.retryChronicle(binding); assert.equal(store.nextChronicle(binding).requestId, item.requestId);
  assert.equal(store.nextChronicle(binding).payload, 'payload');
});

test('invalid summary publication rolls back both the revision and its outbox row', t => {
  const store = new JournalStore(':memory:', '/repo/.git'); t.after(() => store.close());
  const revision = publish(store, 'valid', binding, null);
  assert.throws(() => publish(store, 'stale', binding, { ...revision, revision: 0 }), /revision/);
  assert.equal(store.chronicleStatus(binding).pending, 1); assert.equal(store.recent(10)[0].revision, 1);
});
