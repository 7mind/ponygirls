import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { checkpoint, checkpoints, parseReport, reportText, historyText, REPORT_TYPE, MAX_FIELD_CHARS, MAX_REPORT_CHARS } from '../src/report.ts';
import { checkpointDetail } from '../src/presentation.ts';
import { INQUIRY } from '../src/state.ts';
import { MODEL_GUIDANCE } from '../src/recall.ts';

const objective = { objective: 'Ship', progress: 'Validation underway', issues: ['A failing decoder case needs correction', 'Waiting for access approval', 'Serial test execution limits progress'], eta: 'Unknown: approval pending' };
const raw = JSON.stringify({ objectives: [objective], rules: [] });
const theme = { fg: (_token, text) => text, bold: text => text };
const entry = (version, text) => ({ type: 'custom', customType: REPORT_TYPE, id: `v${version}`, parentId: null, timestamp: '2026-11-12T17:36:00Z', data: { version, requestId: `v${version}`, raw: text, error: null } });

// Specified Behavioral-Active / Blackbox-Group: versioned contract and all projections, not semantic model quality.
test('v4 consolidates three conceptual categories into one bounded issues list', () => {
  assert.deepEqual(parseReport(raw), { objectives: [objective], rules: [] });
  assert.equal(checkpoint('current', raw).version, 4);
  const parse = value => parseReport(JSON.stringify({ objectives: [{ ...objective, issues: value }], rules: [] }));
  assert.deepEqual(parse([]).objectives[0].issues, []);
  assert.equal(parse(Array(100).fill('Known risk')).objectives[0].issues.length, 100);
  for (const value of [undefined, null, 'None known', {}, [null], [''], [' '], [2], [{}], [['nested']], Array(101).fill('Risk'), ['x'.repeat(MAX_FIELD_CHARS + 1)]]) {
    assert.throws(() => parse(value), /issues|issue|objective/);
  }
  assert.throws(() => parse(Array(100).fill('x'.repeat(MAX_FIELD_CHARS))), /Report exceeds/);
  assert.throws(() => parseReport(' '.repeat(MAX_REPORT_CHARS + 1)), /Report exceeds/);
  for (const extra of [{ obstacles: 'No' }, { bottlenecks: 'No' }]) assert.throws(() => parseReport(JSON.stringify({ objectives: [{ ...objective, ...extra }], rules: [] })), /only/);
});

test('inquiry and awareness consider obstacles and bottlenecks but request only an issues array', () => {
  const example = JSON.parse(INQUIRY.match(/JSON only: (\{"objectives":.*?\})\./)[1]);
  assert.deepEqual(Object.keys(example.objectives[0]).sort(), ['eta', 'issues', 'objective', 'progress']);
  assert.ok(Array.isArray(example.objectives[0].issues));
  for (const text of [INQUIRY, MODEL_GUIDANCE]) {
    assert.match(text, /obstacles/); assert.match(text, /bottlenecks/); assert.match(text, /issues (?:array|list)/);
  }
  assert.match(INQUIRY, /empty.*issues|issues.*empty/);
  assert.match(INQUIRY, /independently ruled out/);
});

test('v1 unknowns and v2/v3 statements survive normalization without rewriting raw history', () => {
  const old = { objective: 'Ship', progress: 'Testing', obstacles: 'None known', issues: 'A defect', bottlenecks: 'Serial tests', eta: 'Unknown' };
  const entries = [entry(1, '{"objectives":[{"objective":"Ship","progress":"Testing"}]}'), entry(2, JSON.stringify({ objectives: [old] })), entry(3, JSON.stringify({ objectives: [old], rules: [] }))];
  const before = structuredClone(entries);
  const saved = checkpoints(entries);
  assert.equal(saved[0].report.objectives[0].issues, null);
  for (const value of saved.slice(1)) {
    assert.deepEqual(value.report.objectives[0].issues, ['Obstacles (legacy): None known', 'Issues (legacy): A defect', 'Bottlenecks (legacy): Serial tests']);
    assert.equal(value.report.objectives[0].eta, old.eta);
  }
  assert.deepEqual(entries, before);
  for (let i = 0; i < entries.length; i++) assert.equal(saved[i].raw, before[i].data.raw);
  assert.throws(() => parseReport(entries[2].data.raw), /only/);
  assert.equal(checkpoint('old-shaped-new-response', entries[2].data.raw).report, null);
});

test('plain, history and themed details show one Issues list and distinguish empty from unrecorded', () => {
  const value = checkpoint('current', raw); const record = { ...entry(4, raw), data: value };
  const outputs = [reportText([value]), historyText([record], [record]), checkpointDetail(theme, value, 160)];
  for (const text of outputs) {
    assert.equal((text.match(/Issues:/g) ?? []).length, 1);
    assert.doesNotMatch(text, /Obstacles:|Bottlenecks:/);
    for (const issue of objective.issues) assert.ok(text.includes(`- ${issue}`));
  }
  const empty = checkpoint('empty', JSON.stringify({ objectives: [{ ...objective, issues: [] }], rules: [] }));
  assert.match(reportText([empty]), /Issues: None known/);
  const legacy = checkpoints([entry(1, '{"objectives":[{"objective":"Ship","progress":"Testing"}]}')])[0];
  assert.match(reportText([legacy]), /Issues: Not recorded \(legacy report\)/);
});

test('multiline Unicode issue items wrap at narrow widths and presentation removes terminal controls only', () => {
  const issues = ['Risk 界 é '.repeat(8) + '\nContinuation\twith tab', 'Blocker\x1b\x07'];
  const value = checkpoint('wrapped', JSON.stringify({ objectives: [{ ...objective, issues }], rules: [] }));
  for (const width of [12, 24, 40, 80]) {
    const text = checkpointDetail(theme, value, width);
    const body = text.slice(text.indexOf('1. Ship'));
    assert.ok(body.includes('Risk')); assert.ok(body.includes('Blocker'));
    assert.doesNotMatch(body, /[\x1b\x07]/);
    for (const line of body.split('\n')) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
  }
  assert.deepEqual(value.report.objectives[0].issues, issues);
});
