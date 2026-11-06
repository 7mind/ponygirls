import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { evidenceFromEntry } from '../src/evidence.ts';
import { JournalStore } from '../src/store.ts';
import { validateProposals, MAX_BATCH_CHARS } from '../src/model.ts';

const entry = (id, text) => ({ type: 'message', id, parentId: null, timestamp: '2026-11-06T13:00:00Z', message: { role: 'user', content: text, timestamp: 1 } });
const evidence = (id, text) => evidenceFromEntry('native', 'root', entry(id, text));
const proposal = (ref) => ({ episodeId: null, expectedRevision: 0, title: 'Reproduce failure', kind: 'experiment', status: 'failed', claims: [{ section: 'objective', basis: 'reported', text: 'Reproduce the failure', evidence: [ref] }] });
function fixture(t, memory) {
  const dir = mkdtempSync(join(tmpdir(), 'historian-test-'));
  const path = memory ? ':memory:' : join(dir, 'journal.sqlite');
  const store = new JournalStore(path, '/repo/.git');
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, dir, path };
}

for (const memory of [true, false]) {
  test(`journal contract (${memory ? 'memory SQLite' : 'filesystem SQLite'}): atomic progress and idempotent commit`, t => {
    const { store } = fixture(t, memory); const e = evidence('e1', 'Reproduce the failure');
    store.capture('root', true, [{ sourceId: 'main', offset: 1 }], [e], []);
    const batch = store.batch('root'); assert.equal(batch.evidence.length, 1);
    const p = proposal(e.ref);
    const result = store.commit(batch, [p], { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v1', usage: null });
    assert.equal(result.length, 1); assert.equal(store.batch('root'), null);
    assert.deepEqual(store.commit(batch, [p], { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v1', usage: null }), result);
    assert.equal(store.recent(10).length, 1);
    assert.deepEqual(store.state('root').cursors, [{ sourceId: 'main', offset: 1 }]);
  });
  test(`journal contract (${memory}): OFF fences publication, preserves pending evidence`, t => {
    const { store } = fixture(t, memory); const e = evidence('e1', 'Attempt');
    store.capture('root', true, [], [e], []); const batch = store.batch('root');
    store.capture('root', false, [], [], ['disabled interval']);
    assert.throws(() => store.commit(batch, [proposal(e.ref)], { provider: 'f', model: 'm', thinking: 'off', objective: 'v1', usage: null }), /disabled|epoch/);
    store.capture('root', true, [], [], []); assert.equal(store.batch('root').evidence.length, 1);
  });
  test(`journal contract (${memory}): empty batch result is a committed receipt`, t => {
    const { store } = fixture(t, memory); store.capture('root', true, [], [evidence('e1', 'ls')], []);
    store.commit(store.batch('root'), [], { provider: 'f', model: 'm', thinking: 'off', objective: 'v1', usage: null });
    assert.equal(store.batch('root'), null); assert.deepEqual(store.recent(10), []);
  });
  test(`journal contract (${memory}): changed evidence and foreign references rejected`, t => {
    const { store } = fixture(t, memory); const e = evidence('e1', 'First');
    store.capture('root', true, [], [e], []);
    assert.throws(() => store.capture('root', true, [], [evidence('e1', 'Changed')], []), /integrity/);
    assert.throws(() => store.commit(store.batch('root'), [proposal('foreign')], { provider: 'f', model: 'm', thinking: 'off', objective: 'v1', usage: null }), /evidence/);
    assert.equal(store.batch('root').evidence.length, 1);
  });
}

test('shared project: concurrent sessions append and stale episode updates cannot overwrite', t => {
  const { store, path } = fixture(t, false); const second = new JournalStore(path, '/repo/.git'); t.after(() => second.close());
  const e1 = evidence('e1', 'First'); const e2 = evidence('e2', 'Second');
  store.capture('one', true, [], [e1], []); second.capture('two', true, [], [e2], []);
  const meta = { provider: 'f', model: 'm', thinking: 'off', objective: 'v1', usage: null };
  const [first] = store.commit(store.batch('one'), [proposal(e1.ref)], meta);
  const update = { ...proposal(e2.ref), episodeId: first.episodeId, expectedRevision: 1 };
  second.commit(second.batch('two'), [update], meta);
  store.capture('one', true, [], [evidence('e3', 'Third')], []);
  assert.throws(() => store.commit(store.batch('one'), [{ ...proposal(evidence('e3', 'Third').ref), episodeId: first.episodeId, expectedRevision: 1 }], meta), /revision/);
  assert.equal(store.recent(10)[0].revision, 2);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('capture coverage gaps accompany worker batches and the published journal even with no episodes', t => {
  const { store } = fixture(t, true); const e = evidence('e1', 'ls');
  store.capture('root', true, [], [e], ['Unobserved offline interval omitted']);
  const batch = store.batch('root'); assert.deepEqual(batch.gaps, ['Unobserved offline interval omitted']);
  store.commit(batch, [], { provider: 'f', model: 'm', thinking: 'off', objective: 'v1', usage: null });
  assert.match(store.render(), /Unobserved offline interval omitted/);
});

test('processed mechanical bodies are not retained in evidence or duplicated in receipts', t => {
  const { store, path } = fixture(t, false);
  const selected = evidence('selected', 'SELECTED_PROCEDURE'); const omitted = evidence('omitted', 'UNSELECTED_MECHANICAL_STDOUT');
  store.capture('root', true, [], [selected, omitted], []);
  store.commit(store.batch('root'), [proposal(selected.ref)], { provider: 'f', model: 'm', thinking: 'off', objective: 'v1', usage: null });
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT body FROM evidence WHERE ref=?').get(omitted.ref).body, null);
    assert.match(db.prepare('SELECT body FROM evidence WHERE ref=?').get(selected.ref).body, /SELECTED_PROCEDURE/);
    assert.doesNotMatch(db.prepare('SELECT body FROM commits').get().body, /SELECTED_PROCEDURE|UNSELECTED_MECHANICAL_STDOUT/);
  } finally { db.close(); }
  store.capture('root', true, [], [omitted], []); assert.equal(store.batch('root'), null, 'digest identity still deduplicates pruned entries');
  assert.throws(() => store.capture('root', true, [], [evidence('omitted', 'changed')], []), /integrity/);
  assert.match(store.render(), /Reproduce the failure/);
});

test('extraction excludes hidden reasoning/system/self activity and redacts before inference', () => {
  const e = entry('e', 'Authorization: Bearer abc-secret-token');
  assert.doesNotMatch(evidenceFromEntry('s', 'root', e).text, /abc-secret-token/);
  assert.equal(evidenceFromEntry('s', 'root', { ...e, message: { role: 'system', content: 'SECRET_SYSTEM' } }), null);
  assert.equal(evidenceFromEntry('s', 'root', { ...e, type: 'custom', customType: 'historian.state', data: {} }), null);
  const a = { ...e, message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE_REASONING' }, { type: 'text', text: 'Visible observation' }] } };
  assert.doesNotMatch(evidenceFromEntry('s', 'root', a).text, /PRIVATE_REASONING/);
});

test('redaction covers quoted credentials and structured tool arguments before serialization', () => {
  for (const secret of ['password="SENTINEL_SECRET"', "password='SENTINEL SECRET'", 'TOKEN="SENTINEL_SECRET"']) {
    assert.doesNotMatch(evidenceFromEntry('s', 'root', entry('e', secret)).text, /SENTINEL|SECRET/);
  }
  const e = entry('e', 'unused');
  e.message = { role: 'assistant', content: [{ type: 'toolCall', id: 'c', name: 'api', arguments: { password: 'SENTINEL SECRET', nested: { api_key: 'SENTINEL_KEY' } } }] };
  assert.doesNotMatch(evidenceFromEntry('s', 'root', e).text, /SENTINEL|SECRET/);
});

test('serialized evidence respects batch bounds even with quote-heavy content', t => {
  const { store } = fixture(t, true); const e = evidence('quotes', '"'.repeat(50000));
  store.capture('root', true, [], [e], []);
  assert.ok(store.batch('root').evidence.reduce((n, item) => n + JSON.stringify(item).length, 0) <= MAX_BATCH_CHARS);
});

test('proposal validation rejects unsupported shapes and evidence-free claims', () => {
  assert.deepEqual(validateProposals([], new Set()), []);
  assert.throws(() => validateProposals([{ ...proposal('e'), status: 'probably' }], new Set(['e'])), /status/);
  assert.throws(() => validateProposals([{ ...proposal('e'), claims: [{ section: 'outcome', basis: 'observed', text: 'All done', evidence: [] }] }], new Set()), /evidence/);
});
