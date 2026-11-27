import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { REPORT_TYPE, MAX_OBJECTIVES, MAX_RULES, MAX_ISSUES, MAX_FIELD_CHARS, MAX_COMPLETED_TITLES, MAX_COMPLETED_TITLE_CHARS, capturedCheckpoint, checkpoint } from '../src/report.ts';
import { EDIT_TYPE, MAX_REASON_CHARS, currentSet, editRecord, inquiryRecord, knownIds, nextNumbers, previewEdit } from '../src/current.ts';

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
const change = (manager, entryId, via) => {
  const branch = manager.getBranch(); const position = branch.findIndex(entry => entry.id === entryId);
  const base = { entryId, timestamp: manager.getEntry(entryId).timestamp, via, position };
  // A checkpoint is numbered among the saved checkpoints of its branch, valid or not.
  return via === 'tool' ? base : { ...base, checkpoint: branch.slice(0, position + 1).filter(entry => entry.type === 'custom' && entry.customType === REPORT_TYPE).length };
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
    created: change(manager, first, 'checkpoint'), stated: change(manager, first, 'checkpoint') });
  assert.deepEqual(byId(set.rules, 'AR2'), { id: 'AR2', rule: 'Keep cadence', source: 'assistant', scope: 'This session', status: 'active', reason: null,
    created: change(manager, first, 'checkpoint'), stated: change(manager, first, 'checkpoint') });
  assert.equal(set.events, 1); assert.deepEqual(set.last, change(manager, first, 'checkpoint'));

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
    created: change(manager, a1, 'tool'), stated: change(manager, a1, 'tool') });
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
  const set = currentSet(manager.getBranch());
  const refused = [
    [{ action: 'update', id: 'AO9', fields: { progress: 'x' } }, /AO9 is not in the record/],
    [{ action: 'update', id: 'AR9', fields: { scope: 'x' } }, /AR9 is not in the record/],
    [{ action: 'complete', id: 'AO2', progress: 'Again', issues: [] }, /AO2 is already complete/],
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
    [{ action: 'add_objective', id: 'AO3', objective: 'Done already', progress: null, issues: null, eta: 'complete' }, /use the complete action/],
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
