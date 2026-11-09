import assert from 'node:assert/strict';
import test from 'node:test';
import { checkpoint, checkpoints, historyText, reportText, REPORT_TYPE } from '../src/report.ts';
import { historyContent, reportContent, terminalText } from '../src/presentation.ts';

const theme = { fg: (token, text) => `<${token}>${text}</${token}>`, bold: text => `<b>${text}</b>`, bg: (_token, text) => text };
const objective = { objective: 'Check identity', progress: 'Unknown completion', obstacles: 'None known', issues: 'Needs verification', bottlenecks: 'No measured bottleneck', eta: 'Unknown ETA' };
const entry = (id, timestamp, value) => ({ type: 'custom', id, parentId: null, timestamp, customType: REPORT_TYPE, data: value });

// Specified Behavioral-Active / Blackbox-Atomic: structured presentation, no terminal or inference.
test('plain reports stay unchanged; checkpoints are newest-first with original numbering and all values', () => {
  const older = checkpoint('old', JSON.stringify({ objectives: [objective], rules: [] }));
  const latest = checkpoint('new', JSON.stringify({ objectives: [{ ...objective, objective: 'Newest objective' }], rules: [] }));
  const content = reportContent([older, latest], 'Cuckoo: ON\nGrowth policy: measured');
  assert.equal(content.plain, `Cuckoo: ON\nGrowth policy: measured\n\n${reportText([older, latest])}`);
  const rendered = content.render(theme, 300);
  assert.ok(rendered.indexOf('Checkpoint 2') < rendered.indexOf('Checkpoint 1'));
  assert.ok(rendered.indexOf('Newest objective') < rendered.indexOf('Status and configuration'));
  for (const value of Object.values(objective)) assert.ok(rendered.includes(value), value);
  assert.doesNotMatch(rendered, /100%|completed|blocked/);
});

test('history keeps all branches, request/entry/timestamp attribution, and legacy missing values', () => {
  const old = entry('entry-old', '2026-11-07T01:00:00Z', { version: 1, requestId: 'request-old', raw: '{"objectives":[{"objective":"Legacy task","progress":"Unverified"}]}', error: null });
  const recent = entry('entry-new', '2026-11-08T01:00:00Z', checkpoint('request-new', '{"objectives":[],"rules":[]}'));
  const content = historyContent([old, recent], [old]);
  assert.equal(content.plain, historyText([old, recent], [old]));
  const rendered = content.render(theme, 300);
  assert.ok(rendered.indexOf(recent.timestamp) < rendered.indexOf(old.timestamp));
  assert.match(rendered, /Entry entry-old \(current branch\)/);
  assert.match(rendered, /Entry entry-new \(other branch\)/);
  assert.match(rendered, /request-old/); assert.match(rendered, /request-new/);
  assert.equal((rendered.match(/Not recorded \(legacy report\)/g) ?? []).length, 4);
  assert.equal(checkpoints([old])[0].report.objectives[0].obstacles, null);
  assert.match(rendered, /No current objectives/);
  assert.match(rendered, /saved answers, not live verification/);
});

test('invalid classification wins over parseable raw; error, literal raw and controls are handled separately from theme ANSI', () => {
  const value = checkpoint('request\x1b\x07\r\x9b', JSON.stringify({ objectives: [objective], rules: [] }));
  value.report = null; value.error = 'Interrupted\x1b\x07\r\x9b';
  const invalid = reportContent([value], 'Error: runtime fault\x1b\x07\r\x9b').render(theme, 300);
  assert.match(invalid, /<error><b>Invalid report<\/b><\/error>/);
  assert.match(invalid, /Interrupted/);
  assert.match(invalid, /Raw output \(unvalidated/);
  assert.ok(invalid.includes(value.raw));
  assert.doesNotMatch(invalid, /<b>1\. Check identity/);
  assert.ok(invalid.indexOf('Error: runtime fault') < invalid.indexOf('Checkpoint 1'));
  const raw = checkpoint('raw', '# heading\n```json\n[link](https://example.test)\n\x1b[31mred\x07\r\x9b');
  const literal = reportContent([raw], '').render(theme, 300);
  assert.ok(literal.includes('# heading\n```json\n[link](https://example.test)'));
  assert.doesNotMatch(invalid + literal, /[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
  const valid = checkpoint('ok', JSON.stringify({ objectives: [{ ...objective, objective: 'Title\x1b\x07\r\x9b', progress: 'Progress\x1b\x07\r\x9b' }], rules: [] }));
  const ansiTheme = { ...theme, fg: (_token, text) => `\x1b[36m${text}\x1b[0m` };
  const ansi = reportContent([valid], '').render(ansiTheme, 300);
  assert.ok(ansi.includes('\x1b[36m'));
  assert.ok(terminalText(ansi).includes('Title'));
  assert.doesNotMatch(ansi, /\x07|\r|\x9b/);
});

test('empty reports and empty history remain distinct', () => {
  assert.equal(reportContent([], '').plain, 'No Cuckoo reports on this branch yet.');
  assert.match(reportContent([], '').render(theme, 80), /No Cuckoo reports on this branch yet/);
  assert.equal(historyContent([], []).plain, 'No Cuckoo answers in this session yet.');
  assert.match(historyContent([], []).render(theme, 80), /No Cuckoo answers in this session yet/);
});
