import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { collapsedCall, collapsedOutcome, expandedCall, renderUpdateCall, renderUpdateResult, resultText } from '../src/update-lines.ts';

const TAGS = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: text => `*${text}*` };
const PLAIN = { fg: (_color, text) => text, bold: text => text };
const WIDTHS = [30, 60, 80, 100, 170];
const whole = line => { assert.ok(line !== null); return line.tail === null ? line.head : `${line.head}${line.tail.joint}${line.tail.text}`; };
const details = (id, kind, status) => ({ id, kind, status, action: 'x', activeObjectives: 1, activeRules: 1, notice: 'n' });
/** The rows of one tool call as pi composes them: the call's part, then the result's. */
function rows(args, result, expanded, theme, width) {
  const context = { args, expanded, isPartial: result === null, isError: result !== null && result.isError === true };
  const call = renderUpdateCall(args, theme, context).render(width);
  if (result === null) return call;
  return [...call, ...renderUpdateResult({ content: [{ type: 'text', text: result.text }], details: result.details }, { expanded }, theme, context).render(width)];
}

// Specified Behavioral-Active / Blackbox-Atomic: drawing only; what the model receives is not touched.
test('a call in progress names the tool, the action, the entry and the text it is recognised by', () => {
  assert.equal(whole(collapsedCall({}, PLAIN)), 'cuckoo_update');
  assert.equal(whole(collapsedCall({ action: 'add_objective' }, PLAIN)), 'cuckoo_update add_objective', 'arguments may still be streaming');
  assert.equal(whole(collapsedCall({ action: 'add_objective', objective: 'Ship the\n parser' }, PLAIN)), 'cuckoo_update add_objective · Ship the parser');
  assert.equal(whole(collapsedCall({ action: 'add_rule', rule: 'Mockups first', source: 'user', scope: 'UI' }, PLAIN)), 'cuckoo_update add_rule · Mockups first');
  assert.equal(whole(collapsedCall({ action: 'update', id: 'AO4', eta: 'Tomorrow', progress: 'Half done' }, PLAIN)), 'cuckoo_update update AO4 · Half done');
  assert.equal(whole(collapsedCall({ action: 'complete', id: 'AO1', progress: 'Shipped', issues: [] }, PLAIN)), 'cuckoo_update complete AO1 · Shipped');
  assert.equal(whole(collapsedCall({ action: 'retire', id: 'AR2', reason: 'Dropped' }, PLAIN)), 'cuckoo_update retire AR2 · Dropped');
  assert.equal(whole(collapsedCall({ action: 'reopen', id: 'AO1' }, PLAIN)), 'cuckoo_update reopen AO1');
  assert.equal(whole(collapsedCall({ action: 'add_objective', objective: 'Bell\x07 and \x1b[31mred' }, PLAIN)), 'cuckoo_update add_objective · Bell\\x07 and \\x1b[31mred', 'control bytes are shown, not sent');
  assert.equal(collapsedCall({ action: 'retire', id: 'AO5', reason: 'x' }, TAGS).head, '<toolTitle>*cuckoo_update*</toolTitle> <toolOutput>retire</toolOutput> <toolOutput>AO5</toolOutput>');
});

test('a successful call and its outcome share one line', () => {
  const line = (args, id, kind, status) => whole(collapsedOutcome(args, details(id, kind, status), PLAIN));
  assert.equal(line({ action: 'add_objective', objective: 'Port the harness' }, 'AO5', 'objective', 'active'), 'cuckoo_update add_objective → AO5 · Port the harness');
  assert.equal(line({ action: 'add_rule', rule: 'Mockups first', source: 'user', scope: 'UI' }, 'AR4', 'rule', 'active'), 'cuckoo_update add_rule → AR4 user · Mockups first');
  assert.equal(line({ action: 'update', id: 'AO4', progress: 'Mockup published', eta: 'Unknown' }, 'AO4', 'objective', 'active'), 'cuckoo_update update AO4 → progress, eta · Mockup published');
  assert.equal(line({ action: 'update', id: 'AR1', scope: 'Everywhere' }, 'AR1', 'rule', 'active'), 'cuckoo_update update AR1 → scope · Everywhere');
  assert.equal(line({ action: 'update', id: 'AO4', issues: ['One', 'Two'] }, 'AO4', 'objective', 'active'), 'cuckoo_update update AO4 → issues');
  assert.equal(line({ action: 'complete', id: 'AO1', progress: 'Surveyed 591 reports', issues: [] }, 'AO1', 'objective', 'complete'), 'cuckoo_update complete AO1 → complete · Surveyed 591 reports');
  assert.equal(line({ action: 'retire', id: 'AO5', reason: 'Superseded' }, 'AO5', 'objective', 'retired'), 'cuckoo_update retire AO5 → retired · Superseded');
  assert.equal(line({ action: 'reopen', id: 'AO1' }, 'AO1', 'objective', 'active'), 'cuckoo_update reopen AO1 → active');
  const styled = collapsedOutcome({ action: 'complete', id: 'AO1', progress: 'Done', issues: [] }, details('AO1', 'objective', 'complete'), TAGS);
  assert.equal(styled.head, '<toolTitle>*cuckoo_update*</toolTitle> <toolOutput>complete</toolOutput> <toolOutput>AO1</toolOutput><toolOutput> → </toolOutput><success>complete</success>');
  assert.equal(collapsedOutcome({ action: 'add_objective', objective: 'New' }, details('AO9', 'objective', 'active'), TAGS).head.endsWith('<toolOutput> → </toolOutput>*<text>AO9</text>*'), true, 'the new ID stands out');
  for (const unknown of [undefined, null, {}, { id: 'AO1' }, { id: 'AO1', kind: 'goal', status: 'active' }, { id: 1, kind: 'rule', status: 'active' }, { id: 'AO1', kind: 'objective', status: 'paused' }]) {
    assert.equal(collapsedOutcome({ action: 'reopen', id: 'AO1' }, unknown, PLAIN), null, JSON.stringify(unknown));
  }
  assert.equal(collapsedOutcome({ action: 'delete', id: 'AO1' }, details('AO1', 'objective', 'active'), PLAIN), null, 'an action of another version has no short form');
});

test('a collapsed row is one line at every width: its text is cut, never wrapped', () => {
  const args = { action: 'retire', id: 'AO5', reason: `Superseded: ${'the harness run is part of validating AO2, not separate work. '.repeat(4)}` };
  for (const width of WIDTHS) {
    for (const result of [null, { text: '{}', details: details('AO5', 'objective', 'retired') }]) {
      const lines = rows(args, result, false, PLAIN, width);
      assert.equal(lines.length, 1, `width ${width}`);
      assert.ok(visibleWidth(lines[0]) <= width, `width ${width}: ${lines[0]}`);
      assert.ok(lines[0].startsWith('cuckoo_update retire AO5'.slice(0, width)));
      if (width >= 60) assert.ok(lines[0].endsWith('…'), 'the cut is marked');
    }
  }
  assert.deepEqual(rows({ action: 'reopen', id: 'AO1' }, { text: '{}', details: details('AO1', 'objective', 'active') }, false, PLAIN, 80), ['cuckoo_update reopen AO1 → active']);
  // Room for only a few columns of text: the row ends before it.
  const short = rows({ action: 'retire', id: 'AO5', reason: 'Superseded by the rewrite' }, { text: '{}', details: details('AO5', 'objective', 'retired') }, false, PLAIN, 38);
  assert.deepEqual(short, ['cuckoo_update retire AO5 → retired']);
});

test('an error keeps the call above the whole message, and unknown details keep the whole result', () => {
  const rejected = 'AO9 is not in the record of this branch; read the record with cuckoo_recall action current';
  const lines = rows({ action: 'retire', id: 'AO9', reason: 'Gone' }, { text: rejected, isError: true }, false, PLAIN, 200).map(line => line.trimEnd());
  assert.deepEqual(lines, ['cuckoo_update retire AO9 · Gone', rejected]);
  for (const width of WIDTHS) {
    const wrapped = rows({ action: 'retire', id: 'AO9', reason: 'Gone' }, { text: rejected, isError: true }, false, PLAIN, width);
    for (const line of wrapped) assert.ok(visibleWidth(line) <= width);
    assert.equal(wrapped.slice(1).map(line => line.trim()).join(' '), rejected, 'wrapped, not cut');
  }
  const unknown = rows({ action: 'reopen', id: 'AO1' }, { text: 'text from another version', details: undefined }, false, PLAIN, 80).map(line => line.trimEnd());
  assert.deepEqual(unknown, ['cuckoo_update reopen AO1', 'text from another version']);
});

test('expanded rows are the generic call header and the whole result text', () => {
  const text = JSON.stringify(details('AO5', 'objective', 'retired'));
  const lines = rows({ action: 'retire', id: 'AO5', reason: 'two\nlines' }, { text, details: details('AO5', 'objective', 'retired') }, true, PLAIN, 400).map(line => line.trimEnd());
  assert.deepEqual(lines, ['cuckoo_update', '  action: retire', '  id: AO5', '  reason: two', '    lines', text]);
  assert.equal(expandedCall({ action: 'update', id: 'AO1', issues: ['a\tb'] }, TAGS), '<toolTitle>*cuckoo_update*</toolTitle>\n<muted>  action: update\n  id: AO1\n  issues: [\n      "a\\tb"\n    ]</muted>');
  assert.equal(expandedCall({}, PLAIN), 'cuckoo_update'); assert.equal(expandedCall(null, PLAIN), 'cuckoo_update');
  const pending = rows({ action: 'reopen', id: 'AO1' }, null, true, PLAIN, 80).map(line => line.trimEnd());
  assert.deepEqual(pending, ['cuckoo_update', '  action: reopen', '  id: AO1']);
  assert.equal(resultText([{ type: 'text', text: 'a\x1b[31mb\r\n' }, { type: 'image' }, { type: 'text', text: 'c\x07' }]), 'ab\n\nc');
});
