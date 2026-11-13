import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStates, recordDependencies } from '../src/memory-projection.ts';

// Fixtures reflect the core contract: a task anchor and unique refs per task.
function store(record) {
  return { entryId: `entry-${record.id}`, timestamp: '2026-11-12T00:00:00.000Z', branch: 'current', record };
}
function sn(id, taskId, purpose, dependsOn) {
  return store({
    kind: 'snapshot', id, taskId, purpose, label: `label-${id}`,
    source: { selector: { entryId: `e-${id}`, part: 0, start: 0, end: 5 }, role: 'assistant', toolName: null, timestamp: '2026-11-12T00:00:00.000Z', digest: `sha256-utf16le:${id}` },
    text: `text-${id}`, digest: `sha256-utf16le:${id}`, dependsOn,
  });
}
function cl(id, taskId, evidenceIds, dependsOn, text) {
  return store({ kind: 'claim', id, taskId, author: 'model', category: 'observation', text, evidenceIds, dependsOn });
}
function cor(id, taskId, targetIds, replacementIds, evidenceIds) {
  return store({ kind: 'correction', id, taskId, author: 'model', targetIds, replacementIds, evidenceIds, reason: `reason ${id}` });
}
function start(id, taskId, artifactId, evidenceIds) {
  return store({
    kind: 'check-start', id, taskId, toolCallId: `tc-${id}`,
    checker: { id: 'json', version: '1', implementationDigest: 'sha256-utf16le:check', scope: 'syntax' },
    artifact: { id: artifactId, digest: `sha256-utf16le:${artifactId}` },
    evidence: evidenceIds.map((e) => ({ id: e, digest: `sha256-utf16le:${e}` })),
    startedAt: '2026-11-12T00:00:00.000Z',
  });
}
function result(id, taskId, startId, outcome) {
  return store({ kind: 'check-result', id, taskId, startId, outcome, findings: [], errorCode: null, finishedAt: '2026-11-12T00:00:00.000Z' });
}
function src(id, status) {
  return { id, status };
}
function of(states, id) {
  return states.find((s) => s.id === id);
}

test('recordDependencies per kind; correction targets excluded', () => {
  assert.deepEqual(recordDependencies({ kind: 'task', id: 't1', taskId: 't1', label: 'x', userEntryId: 'u' }), []);
  assert.deepEqual(recordDependencies(sn('s', 't1', 'artifact', ['c1', 'c2']).record), ['c1', 'c2']);
  assert.deepEqual(recordDependencies(cl('c', 't1', ['b'], ['a'], 't').record), ['a', 'b']);
  assert.throws(() => recordDependencies(cl('c', 't1', ['a'], ['a'], 't').record), /more than once/);
  assert.deepEqual(recordDependencies(cor('k', 't1', ['t'], ['r1'], ['e']).record), ['e', 'r1']);
  assert.deepEqual(recordDependencies(start('cs', 't1', 'art', ['e1']).record), ['art', 'e1']);
  assert.deepEqual(recordDependencies(result('cr', 't1', 'cs', 'pass').record), ['cs']);
});

test('multihop needs-recheck propagates transitively', () => {
  const states = projectStates([sn('s1', 't', 'evidence', []), cl('c1', 't', ['s1'], [], 't'), cl('c2', 't', [], ['c1'], 't')], [src('s1', 'changed')]);
  assert.equal(of(states, 's1').status, 'needs-recheck');
  assert.deepEqual(of(states, 's1').invalidatedBy, ['s1']);
  assert.equal(of(states, 'c1').status, 'needs-recheck');
  assert.deepEqual(of(states, 'c1').invalidatedBy, ['s1']);
  assert.equal(of(states, 'c2').status, 'needs-recheck');
  assert.deepEqual(of(states, 'c2').invalidatedBy, ['c1']);
});

test('same-keyword unrelated evidence unaffected; no semantic inference', () => {
  const states = projectStates([
    sn('s_a', 't', 'evidence', []), sn('s_b', 't', 'evidence', []),
    cl('ca', 't', ['s_a'], [], 'the sky is blue'), cl('cb', 't', ['s_b'], [], 'the sky is blue'),
  ], [src('s_a', 'changed')]);
  assert.equal(of(states, 'ca').status, 'needs-recheck');
  assert.equal(of(states, 'cb').status, 'active');
});

test('differing snapshots (same label/different digest) never auto-supersede', () => {
  const recs = [sn('a1', 't', 'artifact', []), sn('a2', 't', 'artifact', [])];
  const none = projectStates(recs, []);
  assert.equal(of(none, 'a1').status, 'active');
  assert.equal(of(none, 'a2').status, 'active');
  const changed = projectStates(recs, [src('a1', 'changed')]);
  assert.equal(of(changed, 'a1').status, 'needs-recheck');
  assert.equal(of(changed, 'a2').status, 'active');
});

test('correction evidence later stale: correction needs-recheck, target never resurrected', () => {
  const recs = [sn('e1', 't', 'evidence', []), sn('a1', 't', 'artifact', []), sn('a2', 't', 'artifact', []), cor('cor', 't', ['a1'], ['a2'], ['e1'])];
  const fresh = projectStates(recs, []);
  assert.equal(of(fresh, 'a1').status, 'superseded');
  assert.deepEqual(of(fresh, 'a1').supersededBy, ['cor']);
  assert.equal(of(fresh, 'cor').status, 'active');
  const stale = projectStates(recs, [src('e1', 'unavailable')]);
  assert.equal(of(stale, 'e1').status, 'needs-recheck');
  assert.equal(of(stale, 'cor').status, 'needs-recheck');
  assert.deepEqual(of(stale, 'cor').invalidatedBy, ['e1']);
  assert.equal(of(stale, 'a1').status, 'superseded');
  assert.deepEqual(of(stale, 'a1').supersededBy, ['cor']);
  assert.equal(of(stale, 'a2').status, 'active');
});

test('explicit superseded wins over needs-recheck', () => {
  const states = projectStates([sn('e1', 't', 'evidence', []), sn('a1', 't', 'artifact', []), cor('cor', 't', ['a1'], [], ['e1'])], [src('a1', 'changed')]);
  assert.equal(of(states, 'a1').status, 'superseded');
  assert.deepEqual(of(states, 'a1').supersededBy, ['cor']);
});

test('source status distinctions: unavailable/changed/out-of-scope need recheck, available stays active', () => {
  const recs = [sn('s_ok', 't', 'evidence', []), sn('s_un', 't', 'evidence', []), sn('s_ch', 't', 'evidence', []), sn('s_oo', 't', 'evidence', [])];
  const states = projectStates(recs, [src('s_ok', 'available'), src('s_un', 'unavailable'), src('s_ch', 'changed'), src('s_oo', 'out-of-scope')]);
  assert.equal(of(states, 's_ok').status, 'active');
  assert.equal(of(states, 's_un').status, 'needs-recheck');
  assert.match(of(states, 's_un').reasons[0], /source unavailable/);
  assert.deepEqual(of(states, 's_un').invalidatedBy, ['s_un']);
  assert.equal(of(states, 's_ch').status, 'needs-recheck');
  assert.match(of(states, 's_ch').reasons[0], /source changed/);
  assert.equal(of(states, 's_oo').status, 'needs-recheck');
  assert.match(of(states, 's_oo').reasons[0], /source out-of-scope/);
});

test('check start/result propagate dependency staleness; fail outcome is orthogonal', () => {
  const recs = [sn('a1', 't', 'artifact', []), sn('e1', 't', 'evidence', []), start('cs', 't', 'a1', ['e1']), result('cr', 't', 'cs', 'fail')];
  const fresh = projectStates(recs, []);
  assert.equal(of(fresh, 'a1').status, 'active');
  assert.equal(of(fresh, 'cr').status, 'active', 'failed check does not invalidate artifact');
  const stale = projectStates(recs, [src('e1', 'changed')]);
  assert.equal(of(stale, 'e1').status, 'needs-recheck');
  assert.equal(of(stale, 'cs').status, 'needs-recheck');
  assert.deepEqual(of(stale, 'cs').invalidatedBy, ['e1']);
  assert.equal(of(stale, 'cr').status, 'needs-recheck');
  assert.deepEqual(of(stale, 'cr').invalidatedBy, ['cs']);
  assert.equal(of(stale, 'a1').status, 'active');
});

test('cycle rejected', () => {
  assert.throws(() => projectStates([cl('c1', 't', [], ['c2'], 'x'), cl('c2', 't', [], ['c1'], 'x')], []), /cycle/);
});

test('dangling/self/cross-task/duplicate refs rejected', () => {
  assert.throws(() => projectStates([cl('c1', 't', ['missing'], [], 'x')], []), /missing record/);
  assert.throws(() => projectStates([cl('c1', 't', [], ['c1'], 'x')], []), /itself/);
  assert.throws(() => projectStates([sn('s2', 'other', 'evidence', []), cl('c1', 't', ['s2'], [], 'x')], []), /cross-task/);
  assert.throws(() => projectStates([sn('s1', 't', 'evidence', []), sn('s1', 't', 'evidence', [])], []), /duplicate memory record id/);
  assert.throws(() => projectStates([sn('s1', 't', 'evidence', []), cl('c1', 't', ['s1', 's1'], [], 'x')], []), /more than once/);
});

test('branch alternative rejected as input', () => {
  const rec = { ...store({ kind: 'snapshot', id: 'a1', taskId: 't', purpose: 'artifact', label: 'x', source: { selector: { entryId: 'e', part: 0, start: 0, end: 1 }, role: 'assistant', toolName: null, timestamp: '2026-11-12T00:00:00.000Z', digest: 'sha256-utf16le:a1' }, text: 'x', digest: 'sha256-utf16le:a1', dependsOn: [] }), branch: 'other' };
  assert.throws(() => projectStates([rec], []), /current-branch/);
});

test('correction target must be claim or artifact snapshot', () => {
  assert.throws(() => projectStates([sn('ev', 't', 'evidence', []), sn('e2', 't', 'evidence', []), cor('cor', 't', ['ev'], [], ['e2'])], []), /ineligible/);
});

test('check-result must reference a check-start; source must reference a snapshot', () => {
  assert.throws(() => projectStates([cl('c1', 't', [], [], 'x'), result('cr', 't', 'c1', 'pass')], []), /not a check-start/);
  assert.throws(() => projectStates([sn('s1', 't', 'evidence', []), cl('c1', 't', ['s1'], [], 'x')], [src('c1', 'changed')]), /non-snapshot/);
  assert.throws(() => projectStates([sn('s1', 't', 'evidence', [])], [src('s1', 'bogus')]), /invalid source status/);
  assert.throws(() => projectStates([sn('s1', 't', 'evidence', [])], [src('nope', 'changed')]), /missing record/);
  assert.throws(() => projectStates([sn('s1', 't', 'evidence', [])], [src('s1', 'changed'), src('s1', 'changed')]), /duplicate source state/);
});
