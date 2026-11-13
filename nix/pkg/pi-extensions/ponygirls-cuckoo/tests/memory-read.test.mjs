import test from 'node:test';
import assert from 'node:assert/strict';
import { queryMemoryWith } from '../src/memory-read.ts';

// Frozen A/B stubs per the shared contract. The reader is read-only over these;
// the test proves it does not mutate them and exercises only their declared
// shapes, not A/B internals.

const B = Object.freeze({ branch: 'current', other: 'other' });

function digest(hex) {
  return `sha256-utf16le:${hex}`;
}

// Build a frozen record for a stored memory record. `branch` defaults to current.
function stored(entryId, timestamp, record, branch = 'current') {
  return Object.freeze({ entryId, timestamp, branch, record: Object.freeze(record) });
}

function viewFixture(entries = [], branchIds = []) {
  const branch = Object.freeze(branchIds.map(id => ({ type: 'custom', id })));
  return Object.freeze({ sessionId: 's1', entries: Object.freeze(entries), branch });
}

// A/B stubs. readMemory returns the given session/current split; resolveSource
// maps public-source digest to a status; projectStates maps snapshot source
// statuses to RecordStatus and yields one RecordState per current record.
function makeApis(overrides = {}) {
  const readMemory = (view, scope) => {
    if (overrides.readMemory) return overrides.readMemory(view, scope);
    if (scope === 'branch') return overrides.currentRecords ?? [];
    return overrides.sessionRecords ?? [];
  };
  const listSources = (view, scope) => overrides.sources ?? [];
  const readPublicSource = (view, selector, scope) => {
    if (overrides.readPublicSource) return overrides.readPublicSource(selector, scope);
    throw new Error('no source text');
  };
  const resolveSource = (view, source, scope) => {
    if (overrides.resolveSource) return overrides.resolveSource(source, scope);
    return { status: 'available', value: { source, text: 'src' } };
  };
  const projectStates = (records, sources) => {
    if (overrides.projectStates) return overrides.projectStates(records, sources);
    const byId = new Map(sources.map(s => [s.id, s.status]));
    return records.map(r => {
      const sourceStatus = byId.get(r.record.id);
      const status = sourceStatus === 'available' || sourceStatus === undefined ? 'active' : 'needs-recheck';
      return Object.freeze({ id: r.record.id, status, reasons: [], supersededBy: [], invalidatedBy: [] });
    });
  };
  return Object.freeze({ readMemory, listSources, readPublicSource, resolveSource, projectStates });
}

const task = id => ({ kind: 'task', id: `t-${id}`, taskId: `t-${id}`, label: `Task ${id}`, userEntryId: `u-${id}` });
const snapshot = (id, text, extra = {}) => ({
  kind: 'snapshot', id: `s-${id}`, taskId: extra.taskId ?? 'task-a', purpose: 'artifact', label: `Snap ${id}`,
  source: Object.freeze({ selector: Object.freeze({ entryId: `src-${id}`, part: 0, start: 0, end: text.length }), role: 'assistant', toolName: null, timestamp: 't1', digest: digest('aa') }),
  text, digest: digest('aa'), dependsOn: Object.freeze([]), ...extra,
});
const claim = (id, text) => ({ kind: 'claim', id: `c-${id}`, taskId: 'task-a', author: 'model', category: 'observation', text, evidenceIds: Object.freeze([]), dependsOn: Object.freeze([]) });

function entriesOf(...records) {
  return records.map((record, i) => ({ type: 'custom', id: records.length - i === 0 ? 'e0' : `e${i}`, customType: 'cuckoo.memory', data: { version: 1, record }, timestamp: 't' }));
}

test('metadata is versioned, typed, and enumerates records without any raw body', () => {
  const view = viewFixture();
  const apis = makeApis();
  const result = queryMemoryWith(apis, view, { kind: 'metadata' });
  assert.equal(result.kind, 'metadata');
  assert.equal(result.version, 1);
  assert.deepEqual(result.recordKinds, [...new Set(result.recordKinds)]); // no duplicate kinds
  assert.equal(result.recordKinds.length, 6);
  assert.ok(result.statuses.includes('active') && result.statuses.includes('superseded') && result.statuses.includes('needs-recheck'));
  assert.equal(result.limits.list.default, 10);
  assert.equal(result.limits.list.max, 20);
  assert.equal(result.limits.chars.default, 4000);
  assert.equal(result.limits.chars.max, 6000);
  assert.equal(result.limits.responseBytes, 50000);
});

test('strictly rejects unknown fields, wrong types, and out-of-range limits', () => {
  const view = viewFixture();
  const apis = makeApis();
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'metadata', extra: 1 }), /Unknown field 'extra'/);
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'nope' }), /Unknown memory read request kind/);
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'list-records', limit: 21 }), /limit must be an integer from 1 to 20/);
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'list-records', limit: 0 }), /limit must be an integer from 1 to 20/);
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'list-records', limit: 1.5 }), /limit must be an integer/);
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'list-records', status: 'verified' }), /status must be one of/);
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'list-records', recordKind: 'foo' }), /recordKind must be one of/);
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'inspect' }), /id must be a nonempty string/);
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'snapshot-text', id: 'x', offset: -1 }), /offset must be a non-negative integer/);
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'source-text', selector: { entryId: 'e', part: 0, start: 5, end: 2 } }), /start must not exceed/);
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'list-records', scope: 'other' }), /scope must be/);
  assert.throws(() => queryMemoryWith(apis, view, null), /must be an object/);
});

test('list-records enumerates with task/kind/status filters, page controls, and exclusive cursor', () => {
  const r1 = stored('e0', 't0', task('a'));
  const r2 = stored('e1', 't1', snapshot('1', 'hello'));
  const r3 = stored('e2', 't2', claim('z', 'a claim'));
  const view = viewFixture(entriesOf(task('a'), snapshot('1', 'hello'), claim('z', 'a claim')), ['e0', 'e1', 'e2']);
  const apis = makeApis({
    sessionRecords: [r1, r2, r3],
    currentRecords: [r1, r2, r3],
  });
  const all = queryMemoryWith(apis, view, { kind: 'list-records' });
  assert.equal(all.scope, 'branch');
  assert.equal(all.total, 3);
  assert.deepEqual(all.records.map(p => p.entryId), ['e0', 'e1', 'e2']);
  assert.deepEqual(all.records.map(p => p.status), ['active', 'active', 'active']);

  const kinds = queryMemoryWith(apis, view, { kind: 'list-records', recordKind: 'snapshot' });
  assert.equal(kinds.total, 1);
  assert.equal(kinds.records[0].kind, 'snapshot');
  assert.equal(kinds.records[0].label, 'Snap 1');

  const byTask = queryMemoryWith(apis, view, { kind: 'list-records', taskId: 't-a' });
  assert.equal(byTask.total, 1);
  assert.equal(byTask.records[0].id, 't-a');

  const first = queryMemoryWith(apis, view, { kind: 'list-records', limit: 1 });
  assert.equal(first.records.length, 1);
  assert.equal(first.nextCursor, 'e0');
  const second = queryMemoryWith(apis, view, { kind: 'list-records', limit: 1, cursor: 'e0' });
  assert.equal(second.records[0].entryId, 'e1');
  assert.equal(second.nextCursor, 'e1');
});

test('cursor errors are explicit and appends stay behind the cursor (stable across appends)', () => {
  const a = stored('e0', 't0', task('a'));
  const b = stored('e1', 't1', snapshot('1', 'x'));
  const view = viewFixture(entriesOf(task('a'), snapshot('1', 'x')), ['e0', 'e1']);
  const apis = makeApis({ sessionRecords: [a, b], currentRecords: [a, b] });
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'list-records', cursor: 'missing' }), /Cursor not found/);
  // Appending a third record does not shift the cursor for earlier pages.
  const apis2 = makeApis({
    sessionRecords: [a, b, stored('e2', 't2', claim('c', 'new'))],
    currentRecords: [a, b, stored('e2', 't2', claim('c', 'new'))],
  });
  const page = queryMemoryWith(apis2, view, { kind: 'list-records', limit: 2 });
  assert.deepEqual(page.records.map(p => p.entryId), ['e0', 'e1']);
  assert.equal(page.nextCursor, 'e1');
  const after = queryMemoryWith(apis2, view, { kind: 'list-records', limit: 2, cursor: 'e1' });
  assert.deepEqual(after.records.map(p => p.entryId), ['e2']);
});

test('structured inspect returns exact fields once, and omits snapshot text explicitly', () => {
  const text = 'the full snapshot text';
  const snap = snapshot('1', text);
  const records = [stored('e0', 't0', task('a')), stored('e1', 't1', snap)];
  const apis = makeApis({ sessionRecords: records, currentRecords: records });
  const view = viewFixture(entriesOf(task('a'), snap), ['e0', 'e1']);
  const res = queryMemoryWith(apis, view, { kind: 'inspect', id: 's-1' });
  assert.equal(res.recordKind, 'snapshot');
  assert.equal(res.textOmitted, true);
  assert.equal(res.textLength, text.length);
  assert.equal(res.textAction.action, 'snapshot-text');
  assert.equal(res.textAction.id, 's-1');
  assert.equal(res.digest, 'sha256-utf16le:aa');
  assert.ok(!('text' in res)); // body is not duplicated
  assert.equal(JSON.stringify(res).includes('the full snapshot text'), false);
});

test('claim/correction/check records carry complete bounded fields with no verified flag', () => {
  const c = claim('z', 'a small observation');
  const checkStart = { kind: 'check-start', id: 'k-1', taskId: 'task-a', toolCallId: 'tc', checker: Object.freeze({ id: 'json', version: '1', implementationDigest: 'd', scope: 'json-syntax' }), artifact: Object.freeze({ id: 's-1', digest: digest('aa') }), evidence: Object.freeze([]), startedAt: 't0' };
  const checkResult = { kind: 'check-result', id: 'k-2', taskId: 'task-a', startId: 'k-1', outcome: 'fail', findings: Object.freeze([Object.freeze({ code: 'BAD', message: 'bad', evidenceIds: Object.freeze(['s-1']) })]), errorCode: null, finishedAt: 't1' };
  const records = [stored('e0', 't0', c), stored('e1', 't1', checkStart), stored('e2', 't2', checkResult)];
  const view = viewFixture(entriesOf(c, checkStart, checkResult), ['e0', 'e1', 'e2']);
  const apis = makeApis({ sessionRecords: records, currentRecords: records });

  const claimRes = queryMemoryWith(apis, view, { kind: 'inspect', id: 'c-z' });
  assert.equal(claimRes.recordKind, 'claim');
  assert.equal(claimRes.text, 'a small observation'); // small claim complete
  assert.equal(claimRes.author, 'model');

  const startRes = queryMemoryWith(apis, view, { kind: 'inspect', id: 'k-1' });
  assert.equal(startRes.recordKind, 'check-start');
  assert.equal(startRes.checker.scope, 'json-syntax');
  assert.equal(startRes.artifact.id, 's-1');
  assert.equal(startRes.artifact.digest, digest('aa'));

  const resultRes = queryMemoryWith(apis, view, { kind: 'inspect', id: 'k-2' });
  assert.equal(resultRes.recordKind, 'check-result');
  assert.equal(resultRes.outcome, 'fail');
  assert.equal(resultRes.startId, 'k-1'); // current-input binding by id
  assert.deepEqual(resultRes.findings[0].evidenceIds, ['s-1']);
  assert.ok(!('verified' in resultRes)); // scoped observation, no overall verified=true
});

test('snapshot text reconstructs exactly at UTF-16 edge, control, Unicode, and large bounds', () => {
  // Includes a lone surrogate pair split edge, control chars, astral Unicode,
  // and a > max-page length to exercise multi-page reconstruction.
  const astral = 'a'.repeat(3000) + '𝄞🎵\u00e9' + '\u0000\u001f' + '\ud83d\ude00' + 'Z'.repeat(3100);
  const snap = snapshot('big', astral);
  const records = [stored('e0', 't0', snap)];
  const view = viewFixture(entriesOf(snap), ['e0']);
  const apis = makeApis({ sessionRecords: records, currentRecords: records });

  const rebuilt = [];
  let offset = 0;
  for (;;) {
    const page = queryMemoryWith(apis, view, { kind: 'snapshot-text', id: 's-big', offset, limit: 4000 });
    assert.equal(page.offset, offset);
    rebuilt.push(page.text);
    offset = page.nextOffset;
    if (offset === null) break;
  }
  assert.equal(rebuilt.join(''), astral); // exact code-unit reconstruction
});

test('lone surrogates round-trip through JSON escaping across page boundaries', () => {
  const lone = 'ab' + '\ud800' + 'cd' + '\udfff' + 'ef';
  const snap = snapshot('lone', lone);
  const records = [stored('e0', 't0', snap)];
  const view = viewFixture(entriesOf(snap), ['e0']);
  const apis = makeApis({ sessionRecords: records, currentRecords: records });

  // Force a page split right between the lone surrogates to exercise escaping.
  const first = queryMemoryWith(apis, view, { kind: 'snapshot-text', id: 's-lone', offset: 2, limit: 2 });
  const pageText = JSON.stringify(first.text);
  assert.ok(pageText.includes('\\ud800'));
  const decoded = JSON.parse(pageText);
  assert.equal(decoded, lone.slice(2, 4));
});

test('snapshot text offset/limit are validated against the code-unit total', () => {
  const snap = snapshot('x', 'hello');
  const records = [stored('e0', 't0', snap)];
  const view = viewFixture(entriesOf(snap), ['e0']);
  const apis = makeApis({ sessionRecords: records, currentRecords: records });
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'snapshot-text', id: 's-x', offset: 6 }), /exceeds/);
  const empty = queryMemoryWith(apis, view, { kind: 'snapshot-text', id: 's-x', offset: 5 });
  assert.equal(empty.text, '');
  assert.equal(empty.nextOffset, null);
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'snapshot-text', id: 's-x', limit: 6001 }), /limit must be an integer/);
});

test('snapshot-text rejects non-snapshot ids and inspect rejects missing ids', () => {
  const t = task('a');
  const records = [stored('e0', 't0', t)];
  const view = viewFixture(entriesOf(t), ['e0']);
  const apis = makeApis({ sessionRecords: records, currentRecords: records });
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'snapshot-text', id: 't-a' }), /requires a snapshot/);
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'inspect', id: 'nope' }), /Record not found/);
});

test('status filters reflect projected current-branch state; none admitted for other branches', () => {
  const active = stored('e0', 't0', snapshot('ok', 'x'));
  const changed = stored('e1', 't1', snapshot('chg', 'y'));
  const other = stored('eO', 'tO', snapshot('other', 'z'), 'other');
  const view = viewFixture(entriesOf(snapshot('ok', 'x'), snapshot('chg', 'y'), snapshot('other', 'z')), ['e0', 'e1']);
  // resolveSource: snapshot 'chg' is 'changed' -> projectStates yields 'needs-recheck'.
  const apis = makeApis({
    sessionRecords: [active, changed, other],
    currentRecords: [active, changed],
    resolveSource: (source) => source.selector.entryId === 'src-chg' ? { status: 'changed', reason: 'digest differs' } : { status: 'available', value: { source, text: 'src' } },
  });
  const all = queryMemoryWith(apis, view, { kind: 'list-records', scope: 'session' });
  const otherLabeled = all.records.find(r => r.id === 's-other');
  assert.equal(otherLabeled.branch, 'other');
  assert.equal(otherLabeled.status, null); // explicitly not projected as current

  const needs = queryMemoryWith(apis, view, { kind: 'list-records', status: 'needs-recheck' });
  assert.deepEqual(needs.records.map(r => r.id), ['s-chg']);
  const actives = queryMemoryWith(apis, view, { kind: 'list-records', status: 'active' });
  assert.deepEqual(actives.records.map(r => r.id), ['s-ok']);
});

test('a source becoming unavailable does not make the captured snapshot unreadable', () => {
  const text = 'captured history';
  const snap = snapshot('gone', text);
  const records = [stored('e0', 't0', snap)];
  const view = viewFixture(entriesOf(snap), ['e0']);
  const apis = makeApis({
    sessionRecords: records,
    currentRecords: records,
    resolveSource: () => ({ status: 'unavailable', reason: 'source entry missing' }),
  });
  const inspect = queryMemoryWith(apis, view, { kind: 'inspect', id: 's-gone' });
  assert.equal(inspect.status, 'needs-recheck'); // source unavailable -> recheck
  const page = queryMemoryWith(apis, view, { kind: 'snapshot-text', id: 's-gone' });
  assert.equal(page.text, text); // recorded text still readable verbatim
});

test('invalid stored records surface as explicit errors, never empty lists', () => {
  const view = viewFixture();
  const apis = makeApis({
    readMemory: (view, scope) => { throw new Error('Malformed memory at entry e-bad'); },
  });
  assert.throws(() => queryMemoryWith(apis, view, { kind: 'list-records' }), /Malformed memory at entry e-bad/);
});

test('task filters do not select another task or branch (scope guard)', () => {
  const sameTaskCurrent = stored('e0', 't0', snapshot('a1', 'one', { taskId: 'task-x' }));
  const sameTaskOther = stored('eO', 'tO', snapshot('a2', 'two', { taskId: 'task-x' }), 'other');
  const otherTask = stored('e1', 't1', snapshot('b', 'three', { taskId: 'task-y' }));
  const view = viewFixture(entriesOf(snapshot('a1', 'one', { taskId: 'task-x' }), snapshot('b', 'three', { taskId: 'task-y' })), ['e0', 'e1']);
  const apis = makeApis({ sessionRecords: [sameTaskCurrent, sameTaskOther, otherTask], currentRecords: [sameTaskCurrent, otherTask] });
  // branch scope never surfaces the other-branch record even with a matching taskId.
  const branch = queryMemoryWith(apis, view, { kind: 'list-records', taskId: 'task-x' });
  assert.deepEqual(branch.records.map(r => r.id), ['s-a1']);
  assert.equal(branch.records[0].branch, 'current');
  // session scope labels the alternative branch explicitly and does not merge status.
  const session = queryMemoryWith(apis, view, { kind: 'list-records', scope: 'session', taskId: 'task-x' });
  assert.equal(session.total, 2);
  assert.deepEqual(session.records.map(r => [r.id, r.branch]), [['s-a1', 'current'], ['s-a2', 'other']]);
  assert.equal(session.records[1].status, null);
});

test('an alternative-history (other-branch) record has a null projected state', () => {
  const other = stored('eO', 'tO', claim('hist', 'old interpretation'), 'other');
  const view = viewFixture([]);
  const apis = makeApis({ sessionRecords: [other], currentRecords: [] });
  const res = queryMemoryWith(apis, view, { kind: 'inspect', id: 'c-hist', scope: 'session' });
  assert.equal(res.branch, 'other');
  assert.equal(res.status, null);
  assert.deepEqual(res.supersededBy, []);
  assert.deepEqual(res.invalidatedBy, []);
});

test('source-text returns bounded exact pages with provenance and branch labeling', () => {
  const source = Object.freeze({
    selector: Object.freeze({ entryId: 'src-1', part: 0, start: 0, end: 10 }),
    role: 'assistant', toolName: 'bash', timestamp: 't1', digest: digest('bb'),
  });
  const long = 'abcdefghij'.repeat(700); // 7000 code units > default page
  const view = viewFixture([], ['src-1']);
  const apis = makeApis({
    readPublicSource: (selector, scope) => Object.freeze({ source, text: long }),
  });
  const page = queryMemoryWith(apis, view, { kind: 'source-text', selector: source.selector });
  assert.equal(page.total, long.length);
  assert.equal(page.text, long.slice(0, 4000));
  assert.equal(page.nextOffset, 4000);
  assert.equal(page.branch, 'current');

  const next = queryMemoryWith(apis, view, { kind: 'source-text', selector: source.selector, offset: 4000, limit: 4000 });
  assert.equal(next.offset, 4000);
});

test('list-sources is paginated and cursor-scoped', () => {
  const summaries = [
    Object.freeze({ entryId: 'src-a', role: 'user', toolName: null, timestamp: 't0', branch: 'current', parts: Object.freeze([{ part: 0, chars: 3 }]) }),
    Object.freeze({ entryId: 'src-b', role: 'assistant', toolName: 'bash', timestamp: 't1', branch: 'current', parts: Object.freeze([{ part: 0, chars: 5 }]) }),
  ];
  const view = viewFixture([]);
  const apis = makeApis({ sources: summaries });
  const page = queryMemoryWith(apis, view, { kind: 'list-sources', limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.sources.length, 1);
  assert.equal(page.sources[0].entryId, 'src-a');
  assert.equal(page.nextCursor, 'src-a');
});
