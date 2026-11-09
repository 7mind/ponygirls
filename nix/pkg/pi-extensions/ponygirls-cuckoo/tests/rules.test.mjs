import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { checkpoint, checkpoints, parseReport, reportText, historyText, REPORT_TYPE, MAX_FIELD_CHARS } from '../src/report.ts';
import { reportContent, historyContent } from '../src/presentation.ts';
import { INQUIRY } from '../src/state.ts';

const objective = { objective: 'Improve Cuckoo', progress: 'Inspected the renderer', obstacles: 'Layout selection pending', issues: 'None known', bottlenecks: 'Awaiting selection', eta: 'Unknown: layout not selected' };
const rules = [{ rule: 'Show mockups before implementation.', source: 'user', scope: 'This UI change' }, { rule: 'Preserve cadence behavior.', source: 'assistant', scope: 'This change only' }];
const raw = JSON.stringify({ objectives: [objective], rules });
const plain = { fg: (_token, text) => text, bold: text => text };
const styled = { fg: (token, text) => `<${token}>${text}</${token}>`, bold: text => `<b>${text}</b>` };
const entry = (id, data) => ({ type: 'custom', customType: REPORT_TYPE, id, parentId: null, timestamp: '2026-11-09T01:00:00Z', data });

// Specified Behavioral-Active / Blackbox-Atomic: schema and presentation contracts, not live-model recall quality.
test('current reports require bounded rules with explicit origin and applicability, even without objectives', () => {
  assert.deepEqual(parseReport(raw), { objectives: [objective], rules });
  assert.deepEqual(parseReport('{"objectives":[],"rules":[]}'), { objectives: [], rules: [] });
  const invalidRules = [null, {}, Array(101).fill(rules[0]), [{ ...rules[0], source: 'system' }], [{ ...rules[0], source: 'USER' }], [{ ...rules[0], extra: true }]];
  for (const name of ['rule', 'source', 'scope']) for (const value of [undefined, null, '', ' ', 1, [], 'x'.repeat(MAX_FIELD_CHARS + 1)]) invalidRules.push([{ ...rules[0], [name]: value }]);
  for (const invalid of invalidRules) {
    const text = JSON.stringify({ objectives: [], rules: invalid });
    assert.throws(() => parseReport(text), undefined, text.slice(0, 100));
    const value = checkpoint('bad', text);
    assert.equal(value.raw, text); assert.equal(value.report, null); assert.ok(value.error);
  }
  assert.throws(() => parseReport('{"objectives":[]}'));
  assert.throws(() => parseReport(JSON.stringify({ objectives: [], rules: [], extra: true })));
  assert.equal(checkpoint('new', raw).version, 3);
});

test('inquiry separates active local instructions from inherited policies and invented authorization', () => {
  const example = INQUIRY.match(/JSON only: (\{.*?\})\./)[1];
  assert.ok(parseReport(example).rules.length > 0);
  for (const phrase of ['session-local', 'user', 'assistant', 'AGENTS.md', 'system', 'developer', 'skills', 'superseded', 'infer preferences', 'authorization', 'empty array', '100 rules']) assert.ok(INQUIRY.includes(phrase), phrase);
});

test('v1/v2 rules remain unrecorded, not confused with a current empty list; history preserves source/scope', () => {
  const legacy = [entry('v1', { version: 1, requestId: 'v1', raw: '{"objectives":[]}', error: null }), entry('v2', { version: 2, requestId: 'v2', raw: JSON.stringify({ objectives: [objective] }), error: null })];
  const current = entry('v3', checkpoint('v3', raw));
  for (const value of checkpoints(legacy)) assert.equal(value.report.rules, null);
  for (const text of [reportText(checkpoints(legacy)), reportContent(checkpoints(legacy), '').render(plain, 100)]) assert.equal((text.match(/Session rules not recorded \(legacy report\)/g) ?? []).length, 2);
  const noRules = checkpoint('empty', '{"objectives":[],"rules":[]}');
  const emptyText = reportContent([noRules], '').render(plain, 100);
  assert.match(emptyText, /No current objectives/); assert.match(emptyText, /No session-local rules reported/);
  const all = [...legacy, current];
  for (const text of [historyText(all, [current]), historyContent(all, [current]).render(plain, 140)]) {
    for (const rule of rules) for (const value of Object.values(rule)) assert.ok(text.includes(value), value);
    assert.match(text, /current branch/); assert.match(text, /other branch/);
  }
});

test('compact hierarchy uses inline fields, semantic headers and one rules section per checkpoint', () => {
  const value = checkpoint('request-123', raw);
  const text = reportContent([value], 'Cuckoo: ON').render(styled, 300);
  assert.match(text, /<accent><b>Checkpoint 1<\/b><\/accent>/);
  assert.match(text, /<warning><b>Session-local rules<\/b><\/warning>/);
  assert.match(text, /<muted><b>Status and configuration<\/b><\/muted>/);
  assert.match(text, /<accent><b>user:<\/b><\/accent>/);
  assert.match(text, /<muted><b>assistant:<\/b><\/muted>/);
  for (const [label, color] of [['Progress', 'accent'], ['Obstacles', 'warning'], ['Issues', 'warning'], ['Bottlenecks', 'warning'], ['ETA', 'accent']]) assert.match(text, new RegExp(`   <${color}><b>${label}:<\\/b><\\/${color}> +\\S`));
  const unstyled = reportContent([value], '').render(plain, 140);
  assert.equal((unstyled.match(/Session-local rules/g) ?? []).length, 1);
  assert.ok(unstyled.indexOf('Session-local rules') < unstyled.indexOf('1. Improve'));
  assert.match(unstyled, /   Progress:    Inspected the renderer\n   Obstacles:/);
  assert.ok(unstyled.split('\n').length <= 18, unstyled);
});

test('multi-digit objective headings reserve their full numbering width', () => {
  const value = checkpoint('many', JSON.stringify({ rules: [], objectives: Array.from({ length: 100 }, () => ({ ...objective, objective: 'x'.repeat(70) })) }));
  const text = reportContent([value], '').render(plain, 40);
  for (const line of text.slice(text.indexOf('1. ')).split('\n')) assert.ok(visibleWidth(line) <= 40, line);
});

test('multiline Unicode fields and rules have hanging indentation at wide widths and stay readable when narrow', () => {
  const value = checkpoint('wrapped', JSON.stringify({ rules: [{ ...rules[0], rule: 'Rule 界 é '.repeat(8) }], objectives: [{ ...objective, progress: 'Evidence 界 é '.repeat(14) + '\nSecond paragraph\twith tab' }] }));
  for (const width of [12, 24, 40, 80]) {
    const text = reportContent([value], '').render(plain, width);
    const start = text.indexOf('Progress:');
    assert.ok(start >= 0);
    const field = text.slice(text.lastIndexOf('\n', start) + 1);
    assert.ok(text.includes('Evidence'));
    if (width === 24) assert.match(text, /   Progress:\n   Evidence/);
    if (width >= 40) {
      const lines = field.split('\n');
      assert.match(lines[1], /^ {16}\S/);
      assert.ok(lines.some(line => /^ {16}Second paragraph/.test(line)));
    }
    // Check the pre-wrapped field block rather than metadata that the shared Text component wraps.
    for (const line of field.split('\n')) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
  }
  const hostile = checkpoint('controls', JSON.stringify({ objectives: [], rules: [{ ...rules[0], rule: 'Rule\x1b\x07\r\x9b', scope: 'Scope\x1b\x07\r\x9b' }] }));
  assert.doesNotMatch(reportContent([hostile], '').render(plain, 80), /[\x1b\x07\r\x9b]/);
});
