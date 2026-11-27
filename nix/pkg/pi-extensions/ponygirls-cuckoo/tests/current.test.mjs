import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { REPORT_TYPE, MAX_OBJECTIVES, MAX_RULES, MAX_ISSUES, MAX_FIELD_CHARS, MAX_COMPLETED_TITLES, MAX_COMPLETED_TITLE_CHARS, capturedCheckpoint, checkpoint } from '../src/report.ts';
import { EDIT_TYPE, MAX_REASON_CHARS, closedEntries, currentSet, editRecord, inquiryRecord, knownIds, nextNumbers, previewEdit } from '../src/current.ts';

const objective = (id, title, eta = 'Unknown: not measured') => ({ id, objective: title, progress: `${title}: stated`, issues: [`${title}: a risk`], eta });
const rule = (id, text, source = 'user') => ({ id, rule: text, source, scope: 'This session' });
/** Capture `reply` against the session as it stands and save it, as the extension does at a checkpoint. */
function checkpointNow(manager, requestId, reply) {
  const value = capturedCheckpoint(requestId, JSON.stringify(reply), [], knownIds(currentSet(manager.getBranch())), nextNumbers(manager.getEntries()));
  assert.equal(value.error, null, String(value.error));
  return manager.appendCustomEntry(REPORT_TYPE, { ...value, messageEntryId: 'm', content: [] });
}
const edit = (manager, value) => manager.appendCustomEntry(EDIT_TYPE, editRecord(value));
const byId = (items, id) => items.find(item => item.id === id);
/** Where a saved event stands on the branch, as an entry's `created` and `stated` name it. */
const change = (manager, entryId, checkpoint) => {
  const base = { entryId, timestamp: manager.getEntry(entryId).timestamp, position: manager.getBranch().findIndex(entry => entry.id === entryId) };
  return checkpoint === null ? { ...base, via: 'tool' } : { ...base, via: 'checkpoint', checkpoint };
};
const brief = set => ({ objectives: set.objectives.map(item => [item.id, item.status]), rules: set.rules.map(item => [item.id, item.status]) });

// Specified Behavioral-Active / Blackbox-Group: the fold over a real session manager's branch.
test('a session without numbered reports or edits has no current set', () => {
  const manager = SessionManager.inMemory();
  manager.appendCustomEntry(REPORT_TYPE, checkpoint('legacy', JSON.stringify({ objectives: [{ objective: 'Legacy', progress: 'Stated', issues: [], eta: 'Complete' }], rules: [{ rule: 'Old', source: 'user', scope: 'Then' }] })));
  const set = currentSet(manager.getBranch());
  assert.deepEqual(set, { objectives: [], rules: [], events: 0, last: null });
  assert.deepEqual(nextNumbers(manager.getEntries()), { objective: 1, rule: 1 });
  assert.deepEqual(knownIds(set), { objectives: new Set(), rules: new Set() });
});

test('a numbered report creates entries, restates them and closes what it leaves out', () => {
  const manager = SessionManager.inMemory();
  const first = checkpointNow(manager, 'r1', { objectives: [objective(null, 'Parser'), objective(null, 'Docs'), objective(null, 'Cache')], rules: [rule(null, 'Mockups first'), rule(null, 'Keep cadence', 'assistant')] });
  let set = currentSet(manager.getBranch());
  assert.deepEqual(brief(set), { objectives: [['AO1', 'active'], ['AO2', 'active'], ['AO3', 'active']], rules: [['AR1', 'active'], ['AR2', 'active']] });
  assert.deepEqual(byId(set.objectives, 'AO2'), { id: 'AO2', objective: 'Docs', progress: 'Docs: stated', issues: ['Docs: a risk'], eta: 'Unknown: not measured', status: 'active', reason: null,
    created: change(manager, first, 1), stated: change(manager, first, 1), closed: null });
  assert.deepEqual(byId(set.rules, 'AR2'), { id: 'AR2', rule: 'Keep cadence', source: 'assistant', scope: 'This session', status: 'active', reason: null,
    created: change(manager, first, 1), stated: change(manager, first, 1), closed: null });
  assert.equal(set.events, 1); assert.deepEqual(set.last, change(manager, first, 1));

  // AO1 is restated in other words, AO2 completed, AO3 left out; AR1 kept, AR2 left out, one rule added.
  const second = checkpointNow(manager, 'r2', { objectives: [objective('AO1', 'Parser, with recovery'), objective('AO2', 'Docs', 'Complete'), objective(null, 'Release')], rules: [rule('AR1', 'Mockups first'), rule(null, 'Ask before pushing')] });
  set = currentSet(manager.getBranch());
  assert.deepEqual(brief(set), { objectives: [['AO1', 'active'], ['AO2', 'complete'], ['AO3', 'retired'], ['AO4', 'active']], rules: [['AR1', 'active'], ['AR2', 'retired'], ['AR3', 'active']] });
  assert.equal(byId(set.objectives, 'AO1').objective, 'Parser, with recovery');
  assert.equal(byId(set.objectives, 'AO1').created.entryId, first); assert.equal(byId(set.objectives, 'AO1').stated.entryId, second);
  assert.equal(byId(set.objectives, 'AO3').stated.entryId, second, 'the checkpoint that left it out closed it');
  assert.equal(byId(set.objectives, 'AO3').reason, null, 'a restatement gives no reason');
  assert.equal(byId(set.objectives, 'AO3').objective, 'Cache', 'a closed entry keeps its last content');
  assert.equal(byId(set.rules, 'AR2').stated.entryId, second);

  // A later report leaves the completed objective out: it stays complete. Listing a closed entry again reopens it.
  checkpointNow(manager, 'r3', { objectives: [objective('AO1', 'Parser, with recovery'), objective('AO3', 'Cache'), objective('AO4', 'Release')], rules: [rule('AR1', 'Mockups first'), rule('AR2', 'Keep cadence', 'assistant'), rule('AR3', 'Ask before pushing')] });
  set = currentSet(manager.getBranch());
  assert.deepEqual(brief(set), { objectives: [['AO1', 'active'], ['AO2', 'complete'], ['AO3', 'active'], ['AO4', 'active']], rules: [['AR1', 'active'], ['AR2', 'active'], ['AR3', 'active']] });
  checkpointNow(manager, 'r4', { objectives: [objective('AO2', 'Docs', 'About an hour: the user asked for a change')], rules: [] });
  set = currentSet(manager.getBranch());
  assert.deepEqual(brief(set), { objectives: [['AO1', 'retired'], ['AO2', 'active'], ['AO3', 'retired'], ['AO4', 'retired']], rules: [['AR1', 'retired'], ['AR2', 'retired'], ['AR3', 'retired']] });
  assert.deepEqual(nextNumbers(manager.getEntries()), { objective: 5, rule: 4 });
  assert.deepEqual(knownIds(set), { objectives: new Set(['AO1', 'AO2', 'AO3', 'AO4']), rules: new Set(['AR1', 'AR2', 'AR3']) });
});

test('invalid and unnumbered reports change nothing', () => {
  const manager = SessionManager.inMemory();
  checkpointNow(manager, 'r1', { objectives: [objective(null, 'Parser')], rules: [rule(null, 'Mockups first')] });
  const before = currentSet(manager.getBranch());
  const invalid = capturedCheckpoint('bad', '{"objectives":[],"rules":[],"extra":1}', [], knownIds(before), nextNumbers(manager.getEntries()));
  assert.notEqual(invalid.error, null);
  manager.appendCustomEntry(REPORT_TYPE, invalid);
  manager.appendCustomEntry(REPORT_TYPE, checkpoint('legacy', '{"objectives":[],"rules":[]}'));
  manager.appendCustomEntry(REPORT_TYPE, { ...capturedCheckpoint('late', '{"objectives":[],"rules":[]}', [], knownIds(before), nextNumbers(manager.getEntries())), report: null, error: 'Checkpoint response interrupted' });
  assert.deepEqual(currentSet(manager.getBranch()), before);
  // Invalid and unnumbered reports still count as saved checkpoints: the next valid one is the fifth of this branch.
  checkpointNow(manager, 'r5', { objectives: [objective('AO1', 'Parser')], rules: [] });
  assert.equal(currentSet(manager.getBranch()).last.checkpoint, 5);
  assert.equal(byId(currentSet(manager.getBranch()).objectives, 'AO1').created.checkpoint, 1);
});

test('edits add, change, complete, retire and reopen entries; each keeps where it was last stated', () => {
  const manager = SessionManager.inMemory();
  const a1 = edit(manager, { action: 'add_objective', id: 'AO1', objective: 'Parser', progress: null, issues: null, eta: null });
  const a2 = edit(manager, { action: 'add_rule', id: 'AR1', rule: 'Mockups first', source: 'user', scope: 'This UI change' });
  let set = currentSet(manager.getBranch());
  assert.deepEqual(byId(set.objectives, 'AO1'), { id: 'AO1', objective: 'Parser', progress: null, issues: null, eta: null, status: 'active', reason: null,
    created: change(manager, a1, null), stated: change(manager, a1, null), closed: null });
  assert.equal(byId(set.rules, 'AR1').created.entryId, a2);
  const u1 = edit(manager, { action: 'update', id: 'AO1', fields: { progress: 'Grammar done', issues: ['Recovery missing'], eta: 'About a day' } });
  edit(manager, { action: 'update', id: 'AR1', fields: { scope: 'Every interface change' } });
  set = currentSet(manager.getBranch());
  assert.deepEqual([byId(set.objectives, 'AO1').objective, byId(set.objectives, 'AO1').progress, byId(set.objectives, 'AO1').issues, byId(set.objectives, 'AO1').eta], ['Parser', 'Grammar done', ['Recovery missing'], 'About a day']);
  assert.equal(byId(set.objectives, 'AO1').created.entryId, a1); assert.equal(byId(set.objectives, 'AO1').stated.entryId, u1);
  assert.deepEqual([byId(set.rules, 'AR1').rule, byId(set.rules, 'AR1').source, byId(set.rules, 'AR1').scope], ['Mockups first', 'user', 'Every interface change']);
  edit(manager, { action: 'complete', id: 'AO1', progress: 'Parser shipped', issues: ['No fuzzing yet'] });
  edit(manager, { action: 'retire', id: 'AR1', reason: 'The user dropped the rule' });
  set = currentSet(manager.getBranch());
  assert.deepEqual([byId(set.objectives, 'AO1').status, byId(set.objectives, 'AO1').progress, byId(set.objectives, 'AO1').issues, byId(set.objectives, 'AO1').eta], ['complete', 'Parser shipped', ['No fuzzing yet'], 'Complete']);
  assert.deepEqual([byId(set.rules, 'AR1').status, byId(set.rules, 'AR1').reason], ['retired', 'The user dropped the rule']);
  // Content of a closed entry can still be corrected; its status stays.
  edit(manager, { action: 'update', id: 'AO1', fields: { issues: ['No fuzzing yet', 'One flaky test'] } });
  assert.deepEqual([byId(currentSet(manager.getBranch()).objectives, 'AO1').status, byId(currentSet(manager.getBranch()).objectives, 'AO1').issues], ['complete', ['No fuzzing yet', 'One flaky test']]);
  edit(manager, { action: 'reopen', id: 'AO1' }); edit(manager, { action: 'reopen', id: 'AR1' });
  set = currentSet(manager.getBranch());
  assert.deepEqual([byId(set.objectives, 'AO1').status, byId(set.objectives, 'AO1').eta, byId(set.objectives, 'AO1').progress], ['active', null, 'Parser shipped'], 'a reopened objective is no longer complete and has no estimate yet');
  assert.deepEqual([byId(set.rules, 'AR1').status, byId(set.rules, 'AR1').reason], ['active', null]);
  edit(manager, { action: 'retire', id: 'AO1', reason: 'Superseded by a rewrite' });
  set = currentSet(manager.getBranch());
  assert.deepEqual([byId(set.objectives, 'AO1').status, byId(set.objectives, 'AO1').reason], ['retired', 'Superseded by a rewrite']);
  assert.equal(set.events, 10); assert.equal(set.last.via, 'tool');
});

test('a checkpoint restates entries the tool created, and the tool edits entries a checkpoint created', () => {
  const manager = SessionManager.inMemory();
  edit(manager, { action: 'add_objective', id: 'AO1', objective: 'Parser', progress: null, issues: null, eta: null });
  edit(manager, { action: 'add_objective', id: 'AO2', objective: 'Docs', progress: null, issues: null, eta: null });
  edit(manager, { action: 'complete', id: 'AO2', progress: 'Docs written', issues: [] });
  checkpointNow(manager, 'r1', { objectives: [objective('AO1', 'Parser'), objective(null, 'Release')], rules: [rule(null, 'Ask before pushing')] });
  let set = currentSet(manager.getBranch());
  assert.deepEqual(brief(set), { objectives: [['AO1', 'active'], ['AO2', 'complete'], ['AO3', 'active']], rules: [['AR1', 'active']] });
  assert.equal(byId(set.objectives, 'AO1').progress, 'Parser: stated'); assert.equal(byId(set.objectives, 'AO1').stated.via, 'checkpoint');
  assert.equal(byId(set.objectives, 'AO1').created.via, 'tool');
  edit(manager, { action: 'retire', id: 'AO3', reason: 'Cancelled by the user' });
  edit(manager, { action: 'update', id: 'AR1', fields: { rule: 'Ask before pushing or force-pushing' } });
  set = currentSet(manager.getBranch());
  assert.deepEqual([byId(set.objectives, 'AO3').status, byId(set.objectives, 'AO3').reason, byId(set.rules, 'AR1').rule], ['retired', 'Cancelled by the user', 'Ask before pushing or force-pushing']);
});

// Specified Behavioral-Active / Blackbox-Atomic: what an edit may do, checked before it is saved.
test('an edit that does not fit the record is refused with a reason the model can act on', () => {
  const manager = SessionManager.inMemory();
  edit(manager, { action: 'add_objective', id: 'AO1', objective: 'Parser', progress: null, issues: null, eta: null });
  edit(manager, { action: 'add_objective', id: 'AO2', objective: 'Docs', progress: null, issues: null, eta: null });
  edit(manager, { action: 'complete', id: 'AO2', progress: 'Docs written', issues: [] });
  edit(manager, { action: 'add_rule', id: 'AR1', rule: 'Mockups first', source: 'user', scope: 'This UI change' });
  edit(manager, { action: 'add_rule', id: 'AR2', rule: 'Old convention', source: 'assistant', scope: 'Earlier' });
  edit(manager, { action: 'retire', id: 'AR2', reason: 'No longer applies' });
  edit(manager, { action: 'add_objective', id: 'AO3', objective: 'Cache', progress: null, issues: null, eta: null });
  edit(manager, { action: 'retire', id: 'AO3', reason: 'Cancelled' });
  const set = currentSet(manager.getBranch());
  const refused = [
    [{ action: 'update', id: 'AO9', fields: { progress: 'x' } }, /AO9 is not in the record/],
    [{ action: 'update', id: 'AR9', fields: { scope: 'x' } }, /AR9 is not in the record/],
    [{ action: 'complete', id: 'AO2', progress: 'Again', issues: [] }, /AO2 is already complete/],
    [{ action: 'complete', id: 'AO3', progress: 'After retirement', issues: [] }, /AO3 is retired, not active; reopen it first/],
    [{ action: 'complete', id: 'AR1', progress: 'x', issues: [] }, /only an objective can be completed/],
    [{ action: 'retire', id: 'AO2', reason: 'x' }, /AO2 is complete, not active/],
    [{ action: 'retire', id: 'AR2', reason: 'x' }, /AR2 is already retired/],
    [{ action: 'reopen', id: 'AO1' }, /AO1 is active/],
    [{ action: 'reopen', id: 'AR1' }, /AR1 is active/],
    [{ action: 'update', id: 'AO2', fields: { eta: 'Two hours' } }, /AO2 is complete; reopen it/],
    [{ action: 'update', id: 'AR2', fields: { scope: 'Later' } }, /AR2 is retired; reopen it before changing it/],
    [{ action: 'update', id: 'AO1', fields: { eta: 'Complete' } }, /use the complete action/],
    [{ action: 'add_objective', id: 'AO1', objective: 'Clash', progress: null, issues: null, eta: null }, /AO1 is already in the record/],
    [{ action: 'add_rule', id: 'AR2', rule: 'Clash', source: 'user', scope: 'x' }, /AR2 is already in the record/],
    [{ action: 'add_objective', id: 'AO4', objective: 'Done already', progress: null, issues: null, eta: 'complete' }, /use the complete action/],
  ];
  for (const [value, expected] of refused) assert.throws(() => previewEdit(set, value), expected, JSON.stringify(value));
  assert.equal(previewEdit(set, { action: 'retire', id: 'AO1', reason: 'Cancelled' }).status, 'retired');
  assert.equal(previewEdit(set, { action: 'update', id: 'AO2', fields: { issues: ['A caveat found later'] } }).status, 'complete', 'what a completed objective says can still be corrected');
  assert.equal(previewEdit(set, { action: 'reopen', id: 'AO2' }).status, 'active');
  assert.equal(previewEdit(set, { action: 'add_rule', id: 'AR3', rule: 'New', source: 'assistant', scope: 'Now' }).id, 'AR3');
  assert.deepEqual(currentSet(manager.getBranch()), set, 'a preview saves nothing');
});

test('the record holds at most as many active entries as a report may list', () => {
  const manager = SessionManager.inMemory();
  for (let index = 1; index <= MAX_OBJECTIVES; index++) edit(manager, { action: 'add_objective', id: `AO${index}`, objective: `Objective ${index}`, progress: null, issues: null, eta: null });
  for (let index = 1; index <= MAX_RULES; index++) edit(manager, { action: 'add_rule', id: `AR${index}`, rule: `Rule ${index}`, source: 'user', scope: 'x' });
  let set = currentSet(manager.getBranch());
  assert.throws(() => previewEdit(set, { action: 'add_objective', id: `AO${MAX_OBJECTIVES + 1}`, objective: 'One more', progress: null, issues: null, eta: null }), /at most 100 active objectives/);
  assert.throws(() => previewEdit(set, { action: 'add_rule', id: `AR${MAX_RULES + 1}`, rule: 'One more', source: 'user', scope: 'x' }), /at most 100 active rules/);
  edit(manager, { action: 'retire', id: 'AO1', reason: 'Room' }); edit(manager, { action: 'retire', id: 'AR1', reason: 'Room' });
  set = currentSet(manager.getBranch());
  assert.equal(previewEdit(set, { action: 'add_objective', id: `AO${MAX_OBJECTIVES + 1}`, objective: 'One more', progress: null, issues: null, eta: null }).status, 'active');
  assert.equal(previewEdit(set, { action: 'reopen', id: 'AO1' }).status, 'active');
  edit(manager, { action: 'add_objective', id: `AO${MAX_OBJECTIVES + 1}`, objective: 'One more', progress: null, issues: null, eta: null });
  assert.throws(() => previewEdit(currentSet(manager.getBranch()), { action: 'reopen', id: 'AO1' }), /at most 100 active objectives/, 'reopening adds to the active entries');
  assert.equal(previewEdit(currentSet(manager.getBranch()), { action: 'reopen', id: 'AR1' }).status, 'active');
  edit(manager, { action: 'add_rule', id: `AR${MAX_RULES + 1}`, rule: 'One more', source: 'assistant', scope: 'x' });
  assert.throws(() => previewEdit(currentSet(manager.getBranch()), { action: 'reopen', id: 'AR1' }), /at most 100 active rules/);
});

test('saved edits are decoded strictly', () => {
  const add = { action: 'add_objective', id: 'AO1', objective: 'Parser', progress: null, issues: null, eta: null };
  assert.deepEqual(editRecord(add), { version: 1, edit: add });
  const invalid = [
    { ...add, extra: true }, { ...add, id: 'AR1' }, { ...add, id: 'AO01' }, { ...add, objective: '' }, { ...add, objective: 'x'.repeat(MAX_FIELD_CHARS + 1) }, { ...add, progress: '' }, { ...add, issues: [''] },
    { ...add, issues: Array(MAX_ISSUES + 1).fill('x') }, { ...add, issues: 'x' }, { action: 'add_objective', id: 'AO1', objective: 'No optional keys' },
    { action: 'add_rule', id: 'AR1', rule: 'x', source: 'system', scope: 'x' }, { action: 'add_rule', id: 'AO1', rule: 'x', source: 'user', scope: 'x' }, { action: 'add_rule', id: 'AR1', rule: 'x', source: 'user' },
    { action: 'update', id: 'AO1', fields: {} }, { action: 'update', id: 'AO1', fields: { rule: 'x' } }, { action: 'update', id: 'AR1', fields: { progress: 'x' } }, { action: 'update', id: 'AR1', fields: { source: 'system' } },
    { action: 'update', id: 'AO1', fields: { progress: null } }, { action: 'update', id: 'AO1' }, { action: 'update', id: 'X1', fields: { progress: 'x' } },
    { action: 'complete', id: 'AO1', progress: 'x' }, { action: 'complete', id: 'AO1', progress: 'x', issues: null }, { action: 'complete', id: 'AO1', progress: '', issues: [] },
    { action: 'retire', id: 'AO1' }, { action: 'retire', id: 'AO1', reason: '' }, { action: 'retire', id: 'AO1', reason: 'x'.repeat(MAX_REASON_CHARS + 1) },
    { action: 'reopen' }, { action: 'reopen', id: 'AO1', reason: 'x' }, { action: 'delete', id: 'AO1' }, null, 'add', [],
  ];
  for (const value of invalid) assert.throws(() => editRecord(value), /Invalid Cuckoo edit/, JSON.stringify(value));
  const manager = SessionManager.inMemory();
  manager.appendCustomEntry(EDIT_TYPE, { version: 2, edit: add });
  assert.throws(() => currentSet(manager.getBranch()), /Invalid saved Cuckoo edit/);
  const other = SessionManager.inMemory();
  other.appendCustomEntry(EDIT_TYPE, editRecord({ action: 'retire', id: 'AO7', reason: 'Never added' }));
  assert.throws(() => currentSet(other.getBranch()), /Invalid saved Cuckoo edit.*AO7 is not in the record/);
});

// Specified Behavioral-Active / Blackbox-Group: numbering is per session, not per branch.
test('numbers continue after every branch of the session, so an ID never names two entries', () => {
  const manager = SessionManager.inMemory();
  const anchor = manager.appendCustomEntry('anchor', {});
  edit(manager, { action: 'add_objective', id: 'AO1', objective: 'On the first branch', progress: null, issues: null, eta: null });
  checkpointNow(manager, 'r1', { objectives: [objective('AO1', 'On the first branch'), objective(null, 'Also there')], rules: [rule(null, 'A rule there')] });
  assert.deepEqual(nextNumbers(manager.getEntries()), { objective: 3, rule: 2 });
  manager.branch(anchor);
  assert.deepEqual(currentSet(manager.getBranch()), { objectives: [], rules: [], events: 0, last: null }, 'the other branch has its own set');
  assert.deepEqual(nextNumbers(manager.getEntries()), { objective: 3, rule: 2 }, 'but not its own numbers');
  const unknown = capturedCheckpoint('r2', JSON.stringify({ objectives: [objective('AO1', 'Named from the other branch')], rules: [] }), [], knownIds(currentSet(manager.getBranch())), nextNumbers(manager.getEntries()));
  assert.match(unknown.error, /Unknown objective id AO1/);
  checkpointNow(manager, 'r3', { objectives: [objective(null, 'On the second branch')], rules: [rule(null, 'A rule here')] });
  assert.deepEqual(brief(currentSet(manager.getBranch())), { objectives: [['AO3', 'active']], rules: [['AR2', 'active']] });
  assert.deepEqual(nextNumbers(manager.getEntries()), { objective: 4, rule: 3 });
  // A saved report that introduces an ID the record already holds would make that ID name two entries.
  const repeated = capturedCheckpoint('r4', JSON.stringify({ objectives: [objective(null, 'Would be a second AO3')], rules: [] }), [], knownIds(currentSet(manager.getBranch())), { objective: 3, rule: 9 });
  assert.deepEqual(repeated.assigned, { objectives: ['AO3'], rules: [] });
  const clash = SessionManager.inMemory();
  for (const entry of manager.getBranch()) clash.appendCustomEntry(entry.customType, entry.data);
  clash.appendCustomEntry(REPORT_TYPE, repeated);
  assert.throws(() => currentSet(clash.getBranch()), /Invalid saved Cuckoo checkpoint numbering at entry .*: AO3 is already in the record/);
  manager.appendCustomEntry(REPORT_TYPE, { version: 6, requestId: 'broken', raw: '{}', error: null, questions: [], assigned: { objectives: ['AO-1'], rules: [] } });
  assert.throws(() => nextNumbers(manager.getEntries()), /Invalid saved Cuckoo/);
});

// Specified Behavioral-Active / Blackbox-Atomic: what an inquiry tells the model about the record.
test('the record given to an inquiry lists active entries, completed objectives and nothing retired', () => {
  const manager = SessionManager.inMemory();
  checkpointNow(manager, 'r1', { objectives: [objective(null, 'Parser'), objective(null, 'Docs', 'Complete'), objective(null, 'Cache')], rules: [rule(null, 'Mockups first'), rule(null, 'Keep cadence', 'assistant')] });
  edit(manager, { action: 'retire', id: 'AO3', reason: 'Cancelled' }); edit(manager, { action: 'retire', id: 'AR2', reason: 'Dropped' });
  edit(manager, { action: 'add_objective', id: 'AO4', objective: 'Release', progress: null, issues: null, eta: null });
  assert.deepEqual(inquiryRecord(currentSet(manager.getBranch())), {
    objectives: [{ id: 'AO1', objective: 'Parser' }, { id: 'AO4', objective: 'Release' }],
    completed: [{ id: 'AO2', objective: 'Docs' }],
    rules: [{ id: 'AR1', rule: 'Mockups first', source: 'user', scope: 'This session' }],
  });
  assert.deepEqual(inquiryRecord(currentSet([])), { objectives: [], completed: [], rules: [] });
  const many = SessionManager.inMemory();
  for (let index = 1; index <= MAX_COMPLETED_TITLES + 5; index++) {
    edit(many, { action: 'add_objective', id: `AO${index}`, objective: `Objective ${index} ${'x'.repeat(MAX_COMPLETED_TITLE_CHARS)}`, progress: null, issues: null, eta: null });
    edit(many, { action: 'complete', id: `AO${index}`, progress: 'Done', issues: [] });
  }
  const bounded = inquiryRecord(currentSet(many.getBranch())).completed;
  assert.equal(bounded.length, MAX_COMPLETED_TITLES); assert.equal(bounded[0].id, 'AO6', 'the most recently completed ones are kept');
  assert.ok(bounded.every(item => item.objective.length === MAX_COMPLETED_TITLE_CHARS));
});

// Regression (review): a saved report could create an entry under an ID nobody numbered, which numbering then gave out again.
test('a saved report that names an entry the record never held is a fault, not a new entry', () => {
  const phantom = (objectives, rules) => {
    const manager = SessionManager.inMemory();
    manager.appendCustomEntry(REPORT_TYPE, { version: 6, requestId: 'phantom', raw: JSON.stringify({ objectives, rules }), error: null, questions: [], assigned: { objectives: [], rules: [] } });
    return manager;
  };
  assert.throws(() => currentSet(phantom([objective('AO1', 'Never numbered')], []).getBranch()), /Invalid saved Cuckoo checkpoint numbering at entry .*: AO1 is not in the record and this checkpoint did not number it/);
  assert.throws(() => currentSet(phantom([], [rule('AR1', 'Never numbered')]).getBranch()), /Invalid saved Cuckoo checkpoint numbering at entry .*: AR1 is not in the record and this checkpoint did not number it/);
  // The same reply is sound when the record holds the entry.
  const sound = SessionManager.inMemory();
  edit(sound, { action: 'add_objective', id: 'AO1', objective: 'Numbered by the tool', progress: null, issues: null, eta: null });
  checkpointNow(sound, 'r1', { objectives: [objective('AO1', 'Numbered by the tool')], rules: [] });
  assert.deepEqual(brief(currentSet(sound.getBranch())).objectives, [['AO1', 'active']]);
});

// Regression (review): "Complete by Friday" was read as a completion and the objective left the active set.
test('an estimate is a completion only when nothing but punctuation follows the word Complete', () => {
  const statusOf = eta => {
    const manager = SessionManager.inMemory();
    checkpointNow(manager, 'r1', { objectives: [objective(null, 'Ship', eta)], rules: [] });
    return currentSet(manager.getBranch()).objectives[0].status;
  };
  for (const eta of ['Complete', 'complete', ' Complete ', 'Complete.', 'complete; nothing remains', 'Complete: delivered in the last commit', 'Complete - merged', 'Complete (no remaining work)', 'COMPLETE!']) assert.equal(statusOf(eta), 'complete', eta);
  for (const eta of ['Complete by Friday', 'Complete once CI passes', 'complete in about an hour', 'Completely unknown', 'Completed', 'Completion expected tomorrow', 'Unknown: complete after review', 'Not complete']) assert.equal(statusOf(eta), 'active', eta);
  // The tool reads an estimate the same way: what it stores as an estimate is never taken for a completion.
  const manager = SessionManager.inMemory();
  edit(manager, { action: 'add_objective', id: 'AO1', objective: 'Ship', progress: null, issues: null, eta: 'Complete by Friday' });
  assert.equal(currentSet(manager.getBranch()).objectives[0].status, 'active');
  assert.equal(previewEdit(currentSet(manager.getBranch()), { action: 'update', id: 'AO1', fields: { eta: 'Complete once CI passes' } }).status, 'active');
  for (const eta of ['Complete', 'Complete.', 'complete: done']) assert.throws(() => previewEdit(currentSet(manager.getBranch()), { action: 'update', id: 'AO1', fields: { eta } }), /use the complete action/, eta);
});

// Regression (review): edits could build an active record that no checkpoint reply (100000 characters) could restate.
test('the tool cannot grow the active record beyond what one checkpoint reply can restate', () => {
  const long = (label, length) => `${label} ${'x'.repeat(length - label.length - 1)}`;
  // Half of what a reply may hold: the other half is left for progress, issues and estimates.
  const MAX_ACTIVE_RECORD_CHARS = 50000;
  const manager = SessionManager.inMemory();
  const titles = Math.floor(MAX_ACTIVE_RECORD_CHARS / MAX_FIELD_CHARS);
  for (let index = 1; index <= titles; index++) edit(manager, { action: 'add_objective', id: `AO${index}`, objective: long(`Objective ${index}`, MAX_FIELD_CHARS), progress: null, issues: null, eta: null });
  let set = currentSet(manager.getBranch());
  const room = MAX_ACTIVE_RECORD_CHARS - titles * MAX_FIELD_CHARS;
  assert.throws(() => previewEdit(set, { action: 'add_objective', id: `AO${titles + 1}`, objective: long('One more', room + 1), progress: null, issues: null, eta: null }), /active entries would hold \d+ characters of objectives, rules and scopes; at most 50000/);
  assert.throws(() => previewEdit(set, { action: 'add_rule', id: 'AR1', rule: long('Rule', room), source: 'user', scope: 'x' }), /at most 50000/, 'a rule counts with its scope');
  assert.equal(previewEdit(set, { action: 'add_rule', id: 'AR1', rule: long('Rule', room - 1), source: 'user', scope: 'x' }).status, 'active', 'exactly the limit fits');
  // Progress, issues and estimates are not what a request quotes: they do not count.
  assert.equal(previewEdit(set, { action: 'update', id: 'AO1', fields: { progress: long('Progress', MAX_FIELD_CHARS), issues: [long('Issue', MAX_FIELD_CHARS)] } }).status, 'active');
  // Closing an entry makes room; reopening it needs the room back.
  edit(manager, { action: 'retire', id: 'AO1', reason: 'Room' });
  edit(manager, { action: 'add_objective', id: `AO${titles + 1}`, objective: long('Replacement', MAX_FIELD_CHARS), progress: null, issues: null, eta: null });
  set = currentSet(manager.getBranch());
  assert.throws(() => previewEdit(set, { action: 'reopen', id: 'AO1' }), /at most 50000/);
  // A checkpoint reply may itself state more than the tool may build; the tool then only accepts what does not add to it.
  const big = SessionManager.inMemory();
  checkpointNow(big, 'r1', { objectives: [...Array.from({ length: 8 }, (_, index) => ({ id: null, objective: long(`Stated ${index + 1}`, MAX_FIELD_CHARS), progress: 'p', issues: [], eta: 'Unknown' })),
    { id: null, objective: long('Short one', 100), progress: 'p', issues: [], eta: 'Unknown' }], rules: [] });
  set = currentSet(big.getBranch());
  assert.equal(set.objectives.filter(item => item.status === 'active').length, 9);
  assert.throws(() => previewEdit(set, { action: 'add_objective', id: 'AO10', objective: 'Short', progress: null, issues: null, eta: null }), /at most 50000/);
  assert.throws(() => previewEdit(set, { action: 'update', id: 'AO9', fields: { objective: long('Longer', 200) } }), /at most 50000/, 'an edit that lengthens an oversized record is refused');
  assert.equal(previewEdit(set, { action: 'update', id: 'AO9', fields: { objective: long('Reworded', 100) } }).status, 'active', 'rewording at the same length is accepted');
  assert.equal(previewEdit(set, { action: 'update', id: 'AO1', fields: { objective: 'Shorter' } }).status, 'active', 'an edit that shortens the record is accepted');
  assert.equal(previewEdit(set, { action: 'update', id: 'AO1', fields: { progress: 'Only progress' } }).status, 'active');
  assert.equal(previewEdit(set, { action: 'retire', id: 'AO1', reason: 'Room' }).status, 'retired');
});

// Regression (review): the panel showed the last change of a completed objective as the time it was completed.
test('a closed entry keeps the event that closed it while what it says changes later', () => {
  const manager = SessionManager.inMemory();
  checkpointNow(manager, 'r1', { objectives: [objective(null, 'Parser'), objective(null, 'Docs'), objective(null, 'Cache')], rules: [rule(null, 'Mockups first')] });
  const completed = edit(manager, { action: 'complete', id: 'AO1', progress: 'Parser shipped', issues: [] });
  let set = currentSet(manager.getBranch());
  assert.deepEqual(byId(set.objectives, 'AO1').closed, change(manager, completed, null)); assert.equal(byId(set.objectives, 'AO2').closed, null);
  // A later checkpoint reports a new defect in the completed objective, completes the docs and leaves the cache and the rule out.
  const second = checkpointNow(manager, 'r2', { objectives: [{ ...objective('AO1', 'Parser', 'Complete'), issues: ['A defect found later'] }, objective('AO2', 'Docs', 'Complete')], rules: [] });
  set = currentSet(manager.getBranch());
  assert.deepEqual(byId(set.objectives, 'AO1').closed, change(manager, completed, null), 'still completed by the earlier edit');
  assert.deepEqual(byId(set.objectives, 'AO1').stated, change(manager, second, 2), 'what it says is as of the checkpoint');
  assert.deepEqual(byId(set.objectives, 'AO2').closed, change(manager, second, 2));
  assert.deepEqual(byId(set.objectives, 'AO3').closed, change(manager, second, 2), 'the checkpoint that left it out retired it');
  assert.deepEqual(byId(set.rules, 'AR1').closed, change(manager, second, 2));
  const corrected = edit(manager, { action: 'update', id: 'AO2', fields: { issues: ['No index yet'] } });
  set = currentSet(manager.getBranch());
  assert.deepEqual(byId(set.objectives, 'AO2').closed, change(manager, second, 2)); assert.deepEqual(byId(set.objectives, 'AO2').stated, change(manager, corrected, null));
  // Closed entries are listed by their last statement, so one that got a new caveat is seen first.
  assert.deepEqual(closedEntries(set).shown.map(item => item.id), ['AO2', 'AO1', 'AO3', 'AR1']);
  // Reopening clears it; closing again records the new event.
  edit(manager, { action: 'reopen', id: 'AO1' }); edit(manager, { action: 'reopen', id: 'AR1' });
  set = currentSet(manager.getBranch());
  assert.equal(byId(set.objectives, 'AO1').closed, null); assert.equal(byId(set.rules, 'AR1').closed, null);
  const retired = edit(manager, { action: 'retire', id: 'AR1', reason: 'Dropped again' });
  assert.deepEqual(byId(currentSet(manager.getBranch()).rules, 'AR1').closed, change(manager, retired, null));
});
