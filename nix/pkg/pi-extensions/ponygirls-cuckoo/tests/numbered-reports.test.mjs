import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { REPORT_TYPE, MAX_OBJECTIVES, MAX_RULES, capturedCheckpoint, cancelledCheckpoint, checkpoint, checkpoints, reportText, historyText } from '../src/report.ts';
import { entryId, parseEntryId } from '../src/ids.ts';

const objective = (id, title, eta = 'Unknown: not measured') => ({ id, objective: title, progress: 'Stated', issues: ['One known risk'], eta });
const rule = (id, text, source = 'user') => ({ id, rule: text, source, scope: 'This session' });
const known = (objectives, rules) => ({ objectives: new Set(objectives), rules: new Set(rules) });
const NONE = known([], []);
const FIRST = { objective: 1, rule: 1 };
const asked = [{ id: 'q-verify', question: 'What did you verify?', scope: 'global' }];
const saved = (manager, value) => manager.appendCustomEntry(REPORT_TYPE, { ...value, messageEntryId: 'm1', content: [{ type: 'text', text: value.raw }] });

// Specified Behavioral-Active / Blackbox-Atomic: ID syntax.
test('entry IDs are AO or AR followed by a positive number without leading zeros', () => {
  assert.equal(entryId('objective', 1), 'AO1'); assert.equal(entryId('rule', 42), 'AR42');
  assert.deepEqual(parseEntryId('AO17'), { kind: 'objective', number: 17 });
  assert.deepEqual(parseEntryId('AR3'), { kind: 'rule', number: 3 });
  for (const value of ['AO0', 'AO01', 'ao1', 'AO', 'AO1 ', ' AO1', 'A01', 'AO1.5', 'AO-1', 'AX1', 'AO1234567890', '', null, undefined, 1, {}, ['AO1']]) assert.equal(parseEntryId(value), null, String(value));
  for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER, 1e9]) assert.throws(() => entryId('objective', value), /exhausted or invalid/, String(value));
});

// Specified Behavioral-Active / Blackbox-Atomic: what capture does with the ids of a reply.
test('capture keeps the ids of known entries and numbers the null ones in the order listed', () => {
  const raw = JSON.stringify({ objectives: [objective(null, 'New first'), objective('AO2', 'Continued'), objective(null, 'New second')], rules: [rule('AR1', 'Kept rule'), rule(null, 'New rule', 'assistant')] });
  const value = capturedCheckpoint('req', raw, [], known(['AO1', 'AO2'], ['AR1']), { objective: 7, rule: 4 });
  assert.equal(value.version, 6); assert.equal(value.error, null); assert.equal(value.raw, raw);
  assert.deepEqual(value.report.objectives.map(item => item.id), ['AO7', 'AO2', 'AO8']);
  assert.deepEqual(value.report.rules.map(item => item.id), ['AR1', 'AR4']);
  assert.deepEqual(value.assigned, { objectives: ['AO7', 'AO8'], rules: ['AR4'] });
  assert.equal(value.report.answers, null);
  assert.deepEqual(value.report.objectives[1], { id: 'AO2', objective: 'Continued', progress: 'Stated', issues: ['One known risk'], eta: 'Unknown: not measured' });
  const empty = capturedCheckpoint('empty', '{"objectives":[],"rules":[]}', [], NONE, FIRST);
  assert.deepEqual(empty.report, { objectives: [], rules: [], answers: null }); assert.deepEqual(empty.assigned, { objectives: [], rules: [] });
});

test('a reply without ids, with a malformed, foreign, unknown or repeated id is invalid and keeps its raw text', () => {
  const reply = (objectives, rules) => JSON.stringify({ objectives, rules });
  const { id: _omitted, ...withoutId } = objective(null, 'No id key');
  const { id: _ruleId, ...ruleWithoutId } = rule(null, 'No id key');
  const cases = [
    [reply([withoutId], []), /Each objective must contain only id, objective, progress, issues, eta/],
    [reply([], [ruleWithoutId]), /Each rule must contain only id, rule, source, scope/],
    [reply([objective('AR1', 'Rule id')], []), /Expected objective id/],
    [reply([], [rule('AO1', 'Objective id')]), /Expected rule id/],
    [reply([objective('AO01', 'Leading zero')], []), /Expected objective id/],
    [reply([objective('null', 'The string null')], []), /Expected objective id/],
    [reply([objective(3, 'A number')], []), /Expected objective id/],
    [reply([objective('', 'Empty')], []), /Expected objective id/],
    [reply([objective('AO9', 'Never numbered')], []), /Unknown objective id AO9/],
    [reply([], [rule('AR9', 'Never numbered')]), /Unknown rule id AR9/],
    [reply([objective('AO1', 'Once'), objective('AO1', 'Twice')], []), /Duplicate objective id AO1/],
    [reply([], [rule('AR1', 'Once'), rule('AR1', 'Twice')]), /Duplicate rule id AR1/],
    [reply(Array.from({ length: MAX_OBJECTIVES + 1 }, (_, index) => objective(null, `Objective ${index}`)), []), /at most 100/],
    [reply([], Array.from({ length: MAX_RULES + 1 }, (_, index) => rule(null, `Rule ${index}`))), /at most 100/],
    [JSON.stringify({ objectives: [], rules: [], answers: [] }), /Expected only objectives, rules/],
    ['not JSON', /SyntaxError/],
  ];
  for (const [raw, expected] of cases) {
    const value = capturedCheckpoint('bad', raw, [], known(['AO1'], ['AR1']), FIRST);
    assert.equal(value.report, null, raw.slice(0, 80)); assert.match(value.error, expected); assert.equal(value.raw, raw);
    assert.equal(value.assigned, null); assert.equal(value.version, 6);
  }
});

test('a reply to an inquiry with standing questions carries ids and one answer per question', () => {
  const body = { objectives: [objective(null, 'Answer the question')], rules: [] };
  const value = capturedCheckpoint('q', JSON.stringify({ ...body, answers: [{ id: 'q-verify', answer: 'Only the decoder tests.' }] }), asked, NONE, FIRST);
  assert.equal(value.version, 6); assert.equal(value.error, null);
  assert.deepEqual(value.report.answers, [{ id: 'q-verify', question: 'What did you verify?', scope: 'global', answer: 'Only the decoder tests.' }]);
  assert.deepEqual(value.report.objectives.map(item => item.id), ['AO1']);
  assert.match(capturedCheckpoint('q', JSON.stringify(body), asked, NONE, FIRST).error, /Expected only objectives, rules, answers/);
  assert.match(capturedCheckpoint('q', JSON.stringify({ ...body, answers: [] }), asked, NONE, FIRST).error, /exactly one answer/);
});

// Specified Behavioral-Active / Blackbox-Group: the saved form, read back through a real session manager.
test('saved numbered reports restore their ids from the saved numbering, also after the record changed', () => {
  const manager = SessionManager.inMemory();
  const raw = JSON.stringify({ objectives: [objective(null, 'First'), objective('AO4', 'Fourth')], rules: [rule(null, 'Rule')] });
  saved(manager, capturedCheckpoint('one', raw, asked.slice(0, 0), known(['AO4'], []), { objective: 5, rule: 2 }));
  const [value] = checkpoints(manager.getBranch());
  assert.equal(value.version, 6); assert.equal(value.raw, raw); assert.equal(value.error, null);
  assert.deepEqual(value.report.objectives.map(item => item.id), ['AO5', 'AO4']);
  assert.deepEqual(value.report.rules.map(item => item.id), ['AR2']);
  assert.deepEqual(value.assigned, { objectives: ['AO5'], rules: ['AR2'] });
  for (const text of [reportText([value], []), historyText(manager.getEntries(), manager.getBranch())]) {
    assert.match(text, /^AO5\. First$/m); assert.match(text, /^AO4\. Fourth$/m); assert.match(text, /^ {2}AR2 user: Rule \(scope: This session\)$/m);
    assert.doesNotMatch(text, /^1\. /m);
  }
  const answered = capturedCheckpoint('two', JSON.stringify({ objectives: [], rules: [], answers: [{ id: 'q-verify', answer: 'Nothing yet.' }] }), asked, NONE, FIRST);
  saved(manager, answered);
  assert.deepEqual(checkpoints(manager.getBranch())[1].questions, asked);
  assert.equal(checkpoints(manager.getBranch())[1].report.answers[0].answer, 'Nothing yet.');
});

test('saved numbering that does not fit its reply is a visible fault, not a guess', () => {
  const raw = JSON.stringify({ objectives: [objective(null, 'First'), objective(null, 'Second')], rules: [rule(null, 'Rule')] });
  const good = capturedCheckpoint('one', raw, [], NONE, FIRST);
  const entry = data => [{ type: 'custom', customType: REPORT_TYPE, id: 'e1', parentId: null, timestamp: '2026-11-27T10:00:00Z', data }];
  assert.equal(checkpoints(entry(good))[0].error, null);
  for (const assigned of [undefined, null, {}, { objectives: ['AO1'], rules: ['AR1'] }, { objectives: ['AO1', 'AO2', 'AO3'], rules: ['AR1'] }, { objectives: ['AO1', 'AO2'], rules: [] },
    { objectives: ['AO1', 'AR2'], rules: ['AR1'] }, { objectives: ['AO1', 'AO1'], rules: ['AR1'] }, { objectives: ['AO1', 'AO2'], rules: ['AR1'], extra: [] }, { objectives: 'AO1', rules: ['AR1'] }]) {
    assert.throws(() => checkpoints(entry({ ...good, assigned })), /Invalid saved Cuckoo checkpoint numbering/, JSON.stringify(assigned));
  }
  const clash = capturedCheckpoint('clash', JSON.stringify({ objectives: [objective('AO1', 'Known'), objective(null, 'New')], rules: [] }), [], known(['AO1'], []), { objective: 2, rule: 1 });
  assert.deepEqual(clash.assigned, { objectives: ['AO2'], rules: [] });
  assert.throws(() => checkpoints(entry({ ...clash, assigned: { objectives: ['AO1'], rules: [] } })), /Invalid saved Cuckoo checkpoint numbering/, 'a saved number that repeats an id of the reply');
});

test('invalid and cancelled numbered checkpoints stay readable with their error', () => {
  const manager = SessionManager.inMemory();
  saved(manager, capturedCheckpoint('bad', '{"objectives":[{"id":"AO3"}],"rules":[]}', [], NONE, FIRST));
  manager.appendCustomEntry(REPORT_TYPE, cancelledCheckpoint('gone', asked, 'Checkpoint superseded by a new user prompt'));
  const [bad, gone] = checkpoints(manager.getBranch());
  assert.equal(bad.report, null); assert.match(bad.error, /Each objective must contain only/); assert.equal(bad.assigned, null);
  assert.equal(gone.report, null); assert.equal(gone.error, 'Checkpoint superseded by a new user prompt'); assert.equal(gone.raw, '');
  assert.equal(gone.version, 6); assert.deepEqual(gone.questions, asked);
  assert.match(reportText([bad, gone], []), /Invalid report: Checkpoint superseded by a new user prompt/);
});

test('reports saved before numbering have no ids and keep their ordinal presentation', () => {
  const legacy = checkpoint('old', JSON.stringify({ objectives: [{ objective: 'Legacy', progress: 'Stated', issues: [], eta: 'Unknown' }], rules: [{ rule: 'Old rule', source: 'assistant', scope: 'Then' }] }));
  assert.equal(legacy.version, 4); assert.equal(legacy.assigned, null);
  assert.equal(legacy.report.objectives[0].id, null); assert.equal(legacy.report.rules[0].id, null);
  const text = reportText([legacy], []);
  assert.match(text, /^1\. Legacy$/m); assert.match(text, /^ {2}assistant: Old rule \(scope: Then\)$/m);
});
