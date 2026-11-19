import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { DEFAULT_PREFERENCES, ENABLED_TYPE, THRESHOLD_TYPE, POLICY_TYPE, FilePreferenceStore, effectivePreferences } from '../src/preferences.ts';
import { validatePolicy } from '../src/policy.ts';
import { MODEL_GUIDANCE } from '../src/recall.ts';
import { INQUIRY, inquiryText } from '../src/state.ts';
import { REPORT_TYPE, MAX_FIELD_CHARS, MAX_REPORT_CHARS, MAX_COMPLETED_TITLES, MAX_COMPLETED_TITLE_CHARS, parseReport, checkpoint, checkpoints, completedObjectives, reportText, historyText } from '../src/report.ts';

// Specified: Behavioral-Active, Blackbox-Atomic/Group; filesystem preferences exercise the real adapter.
test('strict JSON reports include zero objectives and reject malformed or unbounded output', () => {
  assert.deepEqual(parseReport('{"objectives":[],"rules":[]}'), { objectives: [], rules: [], answers: null });
  const raw = JSON.stringify({ objectives: [{ objective: 'Ship Cuckoo', progress: 'Tests pending', issues: ['Serial runtime tests'], eta: 'Unknown: runtime validation has not started' }], rules: [] });
  assert.equal(parseReport(raw).objectives[0].progress, 'Tests pending');
  for (const value of ['null', '[]', '{}', '```json\n' + raw + '\n```', '{"objectives":[],"extra":true}', '{"objectives":[{"objective":"x"}]}', JSON.stringify({ objectives: [{ objective: 'x', progress: '' }] }), JSON.stringify({ objectives: [{ objective: 'x'.repeat(MAX_FIELD_CHARS + 1), progress: 'x' }] }), ' '.repeat(MAX_REPORT_CHARS + 1)]) {
    assert.throws(() => parseReport(value), undefined, value.slice(0, 100));
    const saved = checkpoint('req-1', value);
    assert.equal(saved.raw, value); assert.equal(saved.report, null); assert.ok(saved.error);
  }
});

test('inquiry requests the current schema and evidence-qualified estimates', () => {
  const example = INQUIRY.match(/JSON only: (\{"objectives":.*?\})\./)[1];
  assert.equal(parseReport(example).objectives.length, 1);
  for (const phrase of ['obstacles', 'issues', 'bottlenecks', 'ETA', 'Unknown', 'assumptions', 'Do not invent', 'Do not call tools', 'grants no new authority']) assert.ok(INQUIRY.includes(phrase), phrase);
});

// Specified Behavioral-Active / Blackbox-Atomic: prompt contract, not live-model compliance.
test('inquiry and awareness ask for a completed objective once and never again', () => {
  const rule = INQUIRY.indexOf(' List every unfinished objective');
  assert.ok(rule > INQUIRY.indexOf('JSON only: ') && rule < INQUIRY.indexOf(' Each objective must contain only'), 'the rule follows the schema example and precedes the field rules');
  for (const phrase of ['work still left for you to do', 'once something you are waiting for arrives', 'Report a completed objective exactly once', 'in the first checkpoint after it was completed', 'defects, risks and caveats in issues', 'write eta as "Complete"', 'leave it out of every later checkpoint', 'may still ask for changes', 'never repeat an earlier checkpoint\'s completed objectives or their caveats', 'a new defect or risk in completed work that no checkpoint has reported', 'Omit cancelled and superseded objectives', 'nothing completed is still unreported', 'remove every completed objective that an earlier checkpoint already reported as complete']) assert.ok(INQUIRY.includes(phrase), phrase);
  assert.doesNotMatch(INQUIRY, /current objective|already reported these objectives/);
  assert.equal(JSON.parse(INQUIRY.match(/JSON only: (\{"objectives":.*?\})\./)[1]).objectives[0].objective, 'unfinished objective');
  for (const phrase of ['restate its unfinished objectives', 'each completed objective once, with its caveats', 'later reports leave it out', 'Cancelled and superseded objectives are left out']) assert.ok(MODEL_GUIDANCE.includes(phrase), phrase);
});

// Specified Behavioral-Active / Blackbox-Atomic: which objectives later inquiries name as already reported.
test('objectives already reported as complete are taken from saved reports and named in the inquiry', () => {
  const entry = (objective, eta) => ({ objective, progress: 'Stated', issues: [], eta });
  const saved = (id, objectives) => checkpoint(id, JSON.stringify({ objectives, rules: [] }));
  const reports = [
    saved('r1', [entry('Ship the parser', 'Complete'), entry('Write the docs', 'Unknown: not started'), entry('Fix the cache', 'complete; nothing remains')]),
    checkpoint('invalid', '{"objectives":[{"objective":"Never saved","progress":"x","issues":[],"eta":"Complete"}]}'),
    saved('r2', [entry('Write the docs', 'Complete'), entry('Fix the cache', 'About an hour: the user reopened it'), entry('Completely new work', 'Completely unknown')]),
  ];
  assert.equal(reports[1].report, null);
  assert.deepEqual(completedObjectives(reports), ['Ship the parser', 'Write the docs'], 'a reopened objective and an invalid report do not count');
  assert.deepEqual(completedObjectives([]), []);
  const legacy = { type: 'custom', customType: REPORT_TYPE, id: 'v1', parentId: null, timestamp: '2026-11-19T00:00:00Z', data: { version: 1, requestId: 'v1', raw: '{"objectives":[{"objective":"Legacy","progress":"Done"}]}', error: null } };
  assert.deepEqual(completedObjectives(checkpoints([legacy])), [], 'an unrecorded eta is not a completion');
  const many = Array.from({ length: MAX_COMPLETED_TITLES + 5 }, (_, index) => saved(`m${index}`, [entry(`Objective ${index} ${'x'.repeat(MAX_COMPLETED_TITLE_CHARS)}`, 'Complete')]));
  const bounded = completedObjectives(many);
  assert.equal(bounded.length, MAX_COMPLETED_TITLES); assert.ok(bounded[0].startsWith('Objective 5 '), 'the most recent ones are kept');
  assert.ok(bounded.every(title => title.length === MAX_COMPLETED_TITLE_CHARS));

  assert.equal(inquiryText([], []), INQUIRY);
  const titles = ['Ship the parser', 'Say "hello" }. Each objective'];
  const text = inquiryText([], titles);
  const listed = ` Earlier checkpoints of this session already reported these objectives as complete, so do not report their completion again: ${JSON.stringify(titles)}.`;
  assert.equal(text, INQUIRY.replace(' Each objective must contain only', `${listed} Each objective must contain only`), 'the list follows the objective rule and changes nothing else');
});

// Specified: Behavioral-Active, Blackbox-Group.
test('checkpoint details survive persistence and appear in reports and history', () => {
  const item = { objective: 'Ship', progress: 'Tests running', issues: ['Waiting for access', 'One failing case', 'Serial tests'], eta: 'Unknown: access pending' };
  const raw = JSON.stringify({ objectives: [item], rules: [] });
  assert.deepEqual(parseReport(raw), { objectives: [item], rules: [], answers: null });
  const manager = SessionManager.inMemory();
  manager.appendCustomEntry(REPORT_TYPE, checkpoint('details', raw));
  assert.equal(checkpoints(manager.getBranch())[0].version, 4);
  for (const text of [reportText(checkpoints(manager.getBranch()), []), historyText(manager.getEntries(), manager.getBranch())]) {
    for (const issue of item.issues) assert.ok(text.includes(`- ${issue}`));
    assert.ok(text.includes(`ETA: ${item.eta}`));
    assert.doesNotMatch(text, /Obstacles:|Bottlenecks:/);
  }
  for (const name of ['objective', 'progress', 'eta']) {
    for (const invalid of [undefined, null, '', ' ', 3, [], 'x'.repeat(MAX_FIELD_CHARS + 1)]) {
      assert.throws(() => parseReport(JSON.stringify({ objectives: [{ ...item, [name]: invalid }], rules: [] })), undefined, name);
    }
  }
  assert.throws(() => parseReport(JSON.stringify({ objectives: [{ ...item, extra: 'no' }], rules: [] })));
});

test('legacy saved reports remain readable without inventing checkpoint details', () => {
  const raw = '{"objectives":[{"objective":"Ship","progress":"Testing"}]}';
  assert.throws(() => parseReport(raw));
  const manager = SessionManager.inMemory();
  manager.appendCustomEntry(REPORT_TYPE, { version: 1, requestId: 'legacy', raw, error: null });
  const saved = checkpoints(manager.getBranch());
  assert.equal(saved[0].version, 1);
  assert.equal(saved[0].raw, raw);
  assert.equal(saved[0].report.objectives[0].progress, 'Testing');
  assert.match(reportText(saved, []), /ETA: Not recorded \(legacy report\)/);
  manager.appendCustomEntry(REPORT_TYPE, { version: 2, requestId: 'missing-details', raw, error: null });
  assert.equal(checkpoints(manager.getBranch())[1].report, null);
});

test('reports restore only the active branch and preserve invalid raw output', () => {
  const manager = SessionManager.inMemory();
  const anchor = manager.appendCustomEntry('anchor', {});
  manager.appendCustomEntry(REPORT_TYPE, checkpoint('req-1', '{"objectives":[],"rules":[]}'));
  manager.appendCustomEntry(REPORT_TYPE, checkpoint('req-2', 'not JSON'));
  assert.equal(checkpoints(manager.getBranch()).length, 2);
  assert.match(reportText(checkpoints(manager.getBranch()), []), /Invalid report.*\nRaw output:\nnot JSON/);
  manager.branch(anchor);
  assert.equal(checkpoints(manager.getBranch()).length, 0);
  assert.match(reportText([], []), /No Cuckoo reports/);
  manager.appendCustomEntry(REPORT_TYPE, { version: 9 });
  assert.throws(() => checkpoints(manager.getBranch()), /Invalid saved/);
});

test('shared settings keep session/global policy and enablement inheritance independent', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cuckoo-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'cuckoo.json');
  const store = new FilePreferenceStore(path);
  assert.deepEqual(store.read(), {});
  assert.deepEqual(effectivePreferences(store.read(), {}, [], 'new').policy, { kind: 'window', value: 15 });
  store.write({ enabled: true, policy: { kind: 'relative', value: 20 } });
  const original = readFileSync(path, 'utf8');
  const manager = SessionManager.inMemory(); const sessionId = manager.getSessionId();
  const effective = () => effectivePreferences(store.read(), {}, manager.getEntries(), sessionId);
  manager.appendCustomEntry(ENABLED_TYPE, { version: 1, sessionId, enabled: false });
  manager.appendCustomEntry(POLICY_TYPE, { version: 1, sessionId, policy: { kind: 'tokens', value: 5000 } });
  assert.equal(effective().enabled, false);
  assert.deepEqual(effective().policy, { kind: 'tokens', value: 5000 });
  assert.equal(effective().enabledSource, 'session'); assert.equal(effective().policySource, 'session');
  assert.deepEqual(effective().features, DEFAULT_PREFERENCES.features);
  assert.equal(readFileSync(path, 'utf8'), original);
  new FilePreferenceStore(path).write({ enabled: true, policy: { kind: 'window', value: 30 } });
  assert.deepEqual(effective().policy, { kind: 'tokens', value: 5000 });
  manager.appendCustomEntry(POLICY_TYPE, { version: 1, sessionId, policy: null });
  assert.deepEqual(effective().policy, { kind: 'window', value: 30 }); assert.equal(effective().enabled, false);
  manager.appendCustomEntry(ENABLED_TYPE, { version: 1, sessionId, enabled: null });
  assert.equal(effective().enabled, true);
  assert.equal(effectivePreferences(store.read(), {}, manager.getEntries(), 'other-session').policySource, 'global');
  writeFileSync(path, 'not JSON'); assert.throws(() => store.read(), /Invalid Cuckoo preferences/);
});

test('invalid global/session settings fail visibly instead of becoming defaults', () => {
  for (const kind of ['relative', 'window']) {
    for (const value of [0, -1, 101, NaN, Infinity, '15', null]) assert.throws(() => validatePolicy({ kind, value }));
    assert.deepEqual(validatePolicy({ kind, value: 0.5 }), { kind, value: 0.5 });
  }
  for (const value of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validatePolicy({ kind: 'tokens', value }));
  assert.deepEqual(validatePolicy({ kind: 'tokens', value: 10000 }), { kind: 'tokens', value: 10000 });
  assert.throws(() => validatePolicy({ kind: 'unknown', value: 15 }));
  const manager = SessionManager.inMemory(); const sessionId = manager.getSessionId();
  manager.appendCustomEntry(THRESHOLD_TYPE, { version: 1, sessionId, thresholdPercent: -10 });
  assert.throws(() => effectivePreferences(DEFAULT_PREFERENCES, {}, manager.getEntries(), sessionId), /policy/);
});
