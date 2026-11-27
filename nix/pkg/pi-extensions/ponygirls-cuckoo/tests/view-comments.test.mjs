import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js';
import { CuckooView } from '../src/view.ts';
import { answeredCheckpoint, checkpoint, REPORT_TYPE } from '../src/report.ts';
import { EMPTY_SET } from '../src/current.ts';

/** A fixed clock: these panes show no current set, so no age is drawn from it. */
const clock = () => Date.parse('2026-11-27T12:00:00Z');

const theme = { fg: (_token, text) => text, bg: (_token, text) => text, bold: text => text };
const TAB = '\t', BACKTAB = '\x1b[Z', ENTER = '\r', SHIFT_ENTER = '\x1b[13;2u', ESCAPE = '\x1b', CTRL_D = '\x04', END = '\x1b[F';
const tick = () => new Promise(setImmediate);
const asked = [{ id: 'q-verify', question: 'What did you verify?', scope: 'global' }];
const report = answeredCheckpoint('req-1', JSON.stringify({
  objectives: [{ objective: 'Ship the panel', progress: 'Selection works', issues: ['Editor untested'], eta: 'Unknown: tests pending' }, { objective: 'Write docs', progress: 'Not started', issues: [], eta: 'Unknown' }],
  rules: [{ rule: 'Show mockups first', source: 'user', scope: 'This UI change' }],
  answers: [{ id: 'q-verify', answer: 'Only the decoder tests.' }],
}), asked);
const older = checkpoint('req-0', JSON.stringify({ objectives: [{ objective: 'Earlier goal', progress: 'Done', issues: [], eta: 'Complete' }], rules: [] }));

function fixture(saved, uiTheme = theme) {
  const widgets = []; const notifications = []; const views = []; const savedCalls = []; const reasons = []; const scopes = []; let rows = 40;
  const ctx = { mode: 'tui', hasUI: true, ui: {
    setWidget: (...args) => widgets.push(args), notify: (...args) => notifications.push(args),
    custom: (factory, options) => new Promise(resolve => {
      const view = { options, closed: false }; views.push(view);
      view.component = factory({ terminal: { get rows() { return rows; } }, requestRender() {} }, uiTheme,
        { matches: (key, action) => key === ESCAPE && action === 'tui.select.cancel' }, () => { view.closed = true; resolve(); });
    }),
  } };
  const host = {
    saved: (context, scope) => { assert.equal(context, ctx); scopes.push(scope); if (saved instanceof Error) throw saved; return saved; },
    save: (context, comments, reason) => { assert.equal(context, ctx); savedCalls.push(comments.map(item => structuredClone(item))); reasons.push(reason); },
  };
  return { ctx, host, views, widgets, notifications, savedCalls, reasons, scopes, resize: value => { rows = value; }, badge: () => widgets.at(-1)[1](null, theme) };
}
async function open(f, reports, inquire) {
  const view = new CuckooView(inquire, f.host, clock);
  const showing = view.showReports(f.ctx, reports, 'Cuckoo: ON (session)', EMPTY_SET);
  await tick();
  return { view, showing, panel: f.views.at(-1).component };
}
const type = (panel, text) => { for (const character of text) panel.handleInput(character); };
const marked = (panel, width) => panel.render(width).filter(line => line.startsWith('▌ ')).filter(line => !line.includes('│'));
const never = () => assert.fail('no inquiry was requested');
/** Lay the panel out with Pi's layout engine at a fixed size until it stops requesting frames, as the terminal loop does. */
function settle(panel, width, height) {
  for (let pass = 0; pass < 8; pass++) {
    let again = false;
    const frame = renderLayoutFrame(panel, width, height, () => { again = true; });
    if (!again) return frame.lines;
  }
  assert.fail('the panel kept requesting frames');
}

// Specified Behavioral-Active / Blackbox-Group: the panel through its public input and render boundary with a fake terminal.
test('tab and shift-tab move a node cursor over rules, objectives and answers; changing checkpoint clears it', async () => {
  const f = fixture([]); const { showing, panel, view } = await open(f, [older, report], never);
  assert.deepEqual(marked(panel, 100), [], 'no node is selected until the user selects one');
  assert.match(panel.render(100).join('\n'), /tab\/shift-tab item.*c comment/s);
  panel.handleInput(TAB);
  assert.equal(marked(panel, 100).length, 1); assert.match(marked(panel, 100)[0], /user:\s+Show mockups first/);
  panel.handleInput(TAB);
  assert.deepEqual(marked(panel, 100).map(line => line.trim().split(/\s+/).slice(1, 3).join(' ')), ['1. Ship', 'Progress: Selection', 'Issues: -', 'ETA: Unknown:']);
  panel.handleInput(TAB); panel.handleInput(TAB);
  assert.match(marked(panel, 100)[0], /Q1\. What did you verify\?/); assert.match(marked(panel, 100)[1], /Answer:\s+Only the decoder tests\./);
  panel.handleInput(TAB);
  assert.match(marked(panel, 100)[0], /Q1\./, 'the cursor stops at the last node');
  panel.handleInput(BACKTAB);
  assert.match(marked(panel, 100)[0], /2\. Write docs/);
  for (let i = 0; i < 5; i++) panel.handleInput(BACKTAB);
  assert.match(marked(panel, 100)[0], /Show mockups first/, 'the cursor stops at the first node');
  panel.handleInput('j');
  assert.deepEqual(marked(panel, 100), []); assert.match(panel.render(100).join('\n'), /Earlier goal/);
  panel.handleInput(TAB);
  assert.match(marked(panel, 100)[0], /1\. Earlier goal/);
  panel.handleInput(ESCAPE); await showing; view.dispose(f.ctx);
  assert.deepEqual(f.savedCalls, [], 'moving the cursor creates no comment');
  assert.deepEqual(f.scopes, ['branch']);
});

test('scenario: scroll, select a node, press c, write a comment; closing the panel hands every comment to the host once', async () => {
  const f = fixture([]); const { showing, panel, view } = await open(f, [older, report], never);
  panel.handleInput(TAB); panel.handleInput(TAB); panel.handleInput('c');
  let screen = panel.render(100).join('\n');
  assert.match(screen, /Comment on Objective 1: Ship the panel/);
  assert.match(screen, /⏎ add comment.*shift-⏎ newline.*esc discard draft/s);
  assert.doesNotMatch(screen, /inquire now/, 'panel keys are not offered while typing');
  // Panel keys are text while the editor is open: they neither close the panel nor request an inquiry.
  type(panel, 'quick fix: i j k q x c');
  panel.handleInput(SHIFT_ENTER); type(panel, 'second line');
  assert.equal(f.views[0].closed, false);
  assert.match(panel.render(100).join('\n'), /quick fix: i j k q x c/);
  panel.handleInput(ENTER);
  screen = panel.render(100).join('\n');
  assert.doesNotMatch(screen, /Comment on Objective 1/);
  assert.match(screen, /ETA:\s+Unknown: tests pending\n▌\s+Comment:\s+\[new\] quick fix: i j k q x c\n▌\s+second line/);
  assert.match(screen, /1 new comment: saved to history and sent to the model when this panel closes/);
  assert.match(screen, /2 objectives · saved self-report, not live verification · 1 comment/);
  assert.match(screen, /x remove new comment/);
  // A second comment on a standing-question answer, and one on a different checkpoint.
  panel.handleInput(TAB); panel.handleInput(TAB); panel.handleInput('c'); type(panel, 'Verify the renderer too'); panel.handleInput(ENTER);
  panel.handleInput('j'); panel.handleInput('c');
  assert.match(panel.render(100).join('\n'), /Comment on Objective 1: Earlier goal/, 'c without a cursor takes the first node on screen');
  type(panel, 'Was this verified?'); panel.handleInput(ENTER);
  assert.match(panel.render(100).join('\n'), /3 new comments/);
  assert.deepEqual(f.savedCalls, [], 'nothing is persisted while the panel is open');
  panel.handleInput(ESCAPE); await showing;
  assert.equal(f.views[0].closed, true);
  assert.deepEqual(f.savedCalls, [[
    { requestId: 'req-1', target: { kind: 'objective', index: 0 }, subject: 'Objective 1: Ship the panel', text: 'quick fix: i j k q x c\nsecond line' },
    { requestId: 'req-1', target: { kind: 'answer', index: 0 }, subject: 'Standing question q-verify: What did you verify? Answer: Only the decoder tests.', text: 'Verify the renderer too' },
    { requestId: 'req-0', target: { kind: 'objective', index: 0 }, subject: 'Objective 1: Earlier goal', text: 'Was this verified?' },
  ]]);
  view.dispose(f.ctx); await tick();
  assert.equal(f.savedCalls.length, 1, 'a later disposal does not save the same comments again');
});

test('escape discards only the draft; empty input is refused; x removes a new comment but never a saved one', async () => {
  const saved = [{ commentId: 'c-0', requestId: 'req-1', target: { kind: 'rule', index: 0 }, subject: 'Rule (user): Show mockups first (scope: This UI change)', text: 'Saved earlier', createdAt: '2026-11-17T20:00:00.000Z' }];
  const f = fixture(saved); const { showing, panel, view } = await open(f, [report], never);
  assert.match(panel.render(100).join('\n'), /Show mockups first \(scope: This UI change\)\n\s+Comment:\s+\[2026-11-17T20:00:00.000Z\] Saved earlier/);
  panel.handleInput(TAB); panel.handleInput('c'); type(panel, 'abandoned'); panel.handleInput(ESCAPE);
  assert.equal(f.views[0].closed, false, 'escape leaves the editor, not the panel');
  let screen = panel.render(100).join('\n');
  assert.match(screen, /Comment draft discarded/); assert.doesNotMatch(screen, /abandoned/);
  panel.handleInput('c'); panel.handleInput(ENTER);
  assert.match(panel.render(100).join('\n'), /A comment cannot be empty/);
  assert.match(panel.render(100).join('\n'), /Comment on Rule \(user\)/, 'the editor stays open after an empty submit');
  type(panel, '   '); panel.handleInput(ENTER); panel.handleInput(ESCAPE);
  panel.handleInput('x');
  assert.match(panel.render(100).join('\n'), /no new comment to remove; saved comments are kept as history/);
  panel.handleInput('c'); type(panel, 'first new'); panel.handleInput(ENTER);
  panel.handleInput('c'); type(panel, 'second new'); panel.handleInput(ENTER);
  panel.handleInput('x');
  screen = panel.render(100).join('\n');
  assert.match(screen, /New comment removed/); assert.match(screen, /first new/); assert.doesNotMatch(screen, /second new/); assert.match(screen, /Saved earlier/);
  panel.handleInput(ESCAPE); await showing; view.dispose(f.ctx);
  assert.deepEqual(f.savedCalls.map(call => call.map(item => item.text)), [['first new']]);
});

test('every close path saves: inquiry key, badge toggle and disposal, including text still in the editor', async () => {
  const order = [];
  let f = fixture([]); f.host.save = (_ctx, comments) => order.push(`save:${comments.map(item => item.text).join('|')}`);
  let opened = await open(f, [report], () => order.push('inquire'));
  opened.panel.handleInput(TAB); opened.panel.handleInput('c'); type(opened.panel, 'before inquiry'); opened.panel.handleInput(ENTER);
  opened.panel.handleInput('i'); await opened.showing;
  assert.deepEqual(order, ['save:before inquiry', 'inquire'], 'comments are saved before the inquiry is requested');
  opened.view.dispose(f.ctx);

  f = fixture([]); let view = new CuckooView(never, f.host, clock);
  view.publish(f.ctx, [report], EMPTY_SET, true, null);
  f.badge().handleMouse({ type: 'click', button: 'left' }); await tick();
  let panel = f.views[0].component;
  panel.handleInput(TAB); panel.handleInput('c'); type(panel, 'closed by badge'); panel.handleInput(ENTER);
  panel.handleInput('c'); type(panel, 'still typing');
  f.badge().handleMouse({ type: 'click', button: 'left' }); await tick();
  assert.equal(f.views[0].closed, true);
  assert.deepEqual(f.savedCalls.map(call => call.map(item => item.text)), [['closed by badge', 'still typing']], 'unfinished text is kept, not dropped');
  view.dispose(f.ctx);

  f = fixture([]); opened = await open(f, [report], never);
  opened.panel.handleInput(TAB); opened.panel.handleInput(TAB); opened.panel.handleInput('c'); type(opened.panel, 'session ending');
  opened.view.dispose(f.ctx); await opened.showing;
  assert.deepEqual(f.savedCalls.map(call => call.map(item => [item.target.kind, item.text])), [[['objective', 'session ending']]]);

  f = fixture([]); opened = await open(f, [report], never);
  opened.panel.handleInput(TAB); opened.panel.handleInput('c'); type(opened.panel, '  ');
  opened.panel.handleInput(ESCAPE); opened.panel.handleInput(ESCAPE); await opened.showing; opened.view.dispose(f.ctx);
  assert.deepEqual(f.savedCalls, [], 'an empty draft is not a comment');
});

test('a host failure while saving is reported and does not break closing', async () => {
  const f = fixture([]); f.host.save = () => { throw new Error('session is read-only\x1b[31m'); };
  const { showing, panel, view } = await open(f, [report], never);
  panel.handleInput(TAB); panel.handleInput('c'); type(panel, 'lost?'); panel.handleInput(ENTER);
  panel.handleInput(ESCAPE); await showing; view.dispose(f.ctx);
  assert.equal(f.views[0].closed, true);
  assert.deepEqual(f.notifications.map(args => args[1]), ['error']);
  assert.match(f.notifications[0][0], /comments were not saved: Error: session is read-only/);
  assert.doesNotMatch(f.notifications[0][0], /\x1b/);
});

test('pasted text is never interpreted as panel keys, even when split across packets or containing escape bytes', async () => {
  const f = fixture([]); const { showing, panel, view } = await open(f, [report], never);
  panel.handleInput(TAB); panel.handleInput('c');
  panel.handleInput('\x1b[200~pasted q i'); panel.handleInput(ESCAPE); panel.handleInput(' tail\x1b[201~');
  assert.equal(f.views[0].closed, false);
  assert.match(panel.render(100).join('\n'), /Comment on Rule/, 'an escape byte inside a paste does not discard the draft');
  panel.handleInput(ENTER); panel.handleInput(ESCAPE); await showing; view.dispose(f.ctx);
  assert.equal(f.savedCalls.length, 1);
  assert.match(f.savedCalls[0][0].text, /^pasted q i.* tail$/s);
  assert.doesNotMatch(f.savedCalls[0][0].text, /[\x00-\x09\x0b-\x1f]/);
});

test('after scrolling, tab and c act on a node that is on screen, and the commented node stays visible while typing', async () => {
  const many = checkpoint('many', JSON.stringify({ rules: [], objectives: Array.from({ length: 12 }, (_, i) => ({ objective: `Objective number ${i + 1}`, progress: 'Working', issues: ['One issue'], eta: 'Unknown' })) }));
  const f = fixture([]); f.resize(24); const { showing, panel, view } = await open(f, [many], never);
  panel.render(80);
  for (let i = 0; i < 30; i++) panel.handleInput(CTRL_D);
  const before = panel.render(80).join('\n');
  assert.doesNotMatch(before, /Objective number 1\b/, 'the first objective is scrolled away');
  panel.handleInput(TAB);
  const selected = marked(panel, 80)[0];
  assert.ok(selected !== undefined && !/Objective number 1\b/.test(selected), `tab selected an on-screen node, got ${selected}`);
  const number = Number(selected.match(/(\d+)\. Objective number/)[1]);
  panel.handleInput('c');
  const editing = panel.render(80);
  assert.ok(editing.length <= 24, `rendered ${editing.length} rows in a 24-row terminal`);
  assert.match(editing.join('\n'), new RegExp(`Comment on Objective ${number}: Objective number ${number}`));
  assert.ok(editing.some(line => line.startsWith('▌ ') && line.includes(`${number}. Objective number ${number}`)), 'the commented node is visible above the editor');
  type(panel, 'visible'); panel.handleInput(ENTER); panel.handleInput(END);
  panel.handleInput(BACKTAB);
  assert.match(marked(panel, 80)[0], /Objective number 1[012]/, 'shift-tab from an off-screen cursor takes the last node on screen');
  panel.handleInput(ESCAPE); await showing; view.dispose(f.ctx);
  assert.deepEqual(f.savedCalls[0].map(item => item.target), [{ kind: 'objective', index: number - 1 }]);
});

test('a click selects the node under the pointer; clicks outside nodes and while typing are ignored', async () => {
  const f = fixture([]); const { showing, panel, view } = await open(f, [report], never);
  const lines = panel.render(100);
  const row = lines.findIndex(line => line.includes('2. Write docs'));
  const event = (type, y) => ({ type, button: 'left', x: 10, y, screenX: 10, screenY: y + 3, width: 100, height: lines.length });
  assert.equal(panel.handleMouse(event('press', row)).handled, true);
  assert.deepEqual(marked(panel, 100), [], 'a press alone selects nothing');
  assert.equal(panel.handleMouse(event('click', row + 1)).handled, true);
  assert.match(marked(panel, 100)[0], /2\. Write docs/);
  assert.equal(panel.handleMouse(event('click', 0)), undefined);
  assert.equal(panel.handleMouse(event('click', lines.length - 1)), undefined);
  assert.equal(panel.handleMouse({ ...event('click', row), button: 'right' }), undefined);
  panel.handleInput('c');
  const ruleRow = panel.render(100).findIndex(line => line.includes('Show mockups first'));
  assert.equal(panel.handleMouse(event('click', ruleRow)), undefined);
  type(panel, 'clicked'); panel.handleInput(ENTER); panel.handleInput(ESCAPE); await showing; view.dispose(f.ctx);
  assert.deepEqual(f.savedCalls[0].map(item => item.subject), ['Objective 2: Write docs']);
});

test('invalid and empty reports have nothing to comment on; unreadable saved comments are reported without hiding the report', async () => {
  let f = fixture([]); let opened = await open(f, [checkpoint('bad', 'not JSON')], never);
  opened.panel.handleInput(TAB);
  assert.match(opened.panel.render(100).join('\n'), /no rule, objective or answer to select/);
  opened.panel.handleInput('c');
  const screen = opened.panel.render(100).join('\n');
  assert.match(screen, /no rule, objective or answer to comment on/); assert.doesNotMatch(screen, /Comment on/);
  opened.panel.handleInput('q'); await opened.showing; opened.view.dispose(f.ctx);
  assert.equal(f.views[0].closed, true, 'q still closes because no editor was opened');

  f = fixture([]); opened = await open(f, [], never);
  opened.panel.handleInput(TAB); opened.panel.handleInput('c'); opened.panel.handleInput('x');
  assert.match(opened.panel.render(100).join('\n'), /No Cuckoo reports/);
  opened.panel.handleInput(ESCAPE); await opened.showing; opened.view.dispose(f.ctx);
  assert.deepEqual(f.savedCalls, []);

  f = fixture(new Error('Invalid saved Cuckoo comment')); opened = await open(f, [report], never);
  const faulted = opened.panel.render(100).join('\n');
  assert.match(faulted, /Error: saved comments are unreadable: Error: Invalid saved Cuckoo comment/); assert.match(faulted, /Ship the panel/);
  assert.ok(faulted.indexOf('saved comments are unreadable') < faulted.indexOf('Ship the panel'));
  opened.panel.handleInput(TAB); opened.panel.handleInput('c'); type(opened.panel, 'still possible'); opened.panel.handleInput(ENTER);
  opened.panel.handleInput(ESCAPE); await opened.showing; opened.view.dispose(f.ctx);
  assert.deepEqual(f.savedCalls.map(call => call.map(item => item.text)), [['still possible']]);
});

test('history reads session-wide comments, plain output includes saved comments, and no frame exceeds the panel width', async () => {
  const saved = [{ commentId: 'c-0', requestId: 'req-1', target: { kind: 'objective', index: 1 }, subject: 'Objective 2: Write docs', text: 'Start with the README\x1b[31m', createdAt: '2026-11-17T20:00:00.000Z' }];
  const entry = { type: 'custom', id: 'entry-1', parentId: null, timestamp: '2026-11-17T19:00:00Z', customType: REPORT_TYPE, data: structuredClone(report) };
  const f = fixture(saved); const view = new CuckooView(never, f.host, clock);
  const showing = view.showHistory(f.ctx, [entry], []); await tick();
  const panel = f.views[0].component;
  assert.deepEqual(f.scopes, ['session']);
  assert.match(panel.render(100).join('\n'), /Comment:\s+\[2026-11-17T20:00:00.000Z\] Start with the README/);
  assert.doesNotMatch(panel.render(100).join('\n'), /\x1b\[31m/, 'comment text cannot inject terminal controls');
  panel.handleInput(TAB); panel.handleInput(TAB); panel.handleInput('c');
  type(panel, 'A long comment that needs wrapping at narrow widths, 界 é and more words to wrap');
  // The checkpoint table's own header and rule rows have a fixed minimum width and are outside this check.
  const bounded = width => { for (const line of panel.render(width)) if (!/Request ID|─┼─/.test(line)) assert.ok(visibleWidth(line) <= width, `${width}: ${JSON.stringify(line)}`); };
  for (const width of [24, 40, 80]) bounded(width);
  panel.handleInput(ENTER);
  for (const width of [24, 40, 80]) bounded(width);
  panel.handleInput(ESCAPE); await showing; view.dispose(f.ctx);
  assert.equal(f.savedCalls[0][0].requestId, 'req-1');

  const rpc = fixture(saved); rpc.ctx.mode = 'rpc'; const plain = new CuckooView(never, rpc.host, clock);
  await plain.showReports(rpc.ctx, [report], 'Cuckoo: ON', EMPTY_SET);
  assert.match(rpc.notifications[0][0], /ETA: Unknown\n   Comment \(2026-11-17T20:00:00.000Z\): Start with the README/);
  assert.deepEqual(rpc.scopes, ['branch']); assert.equal(rpc.views.length, 0);
});

// The cases above render without an allocated height; these use Pi's layout engine, which owns the body scroll position.
test('allocated layout: tab scrolls the selected node into view and a click maps to the node under the pointer', async () => {
  const many = checkpoint('many', JSON.stringify({ rules: [], objectives: Array.from({ length: 12 }, (_, i) => ({ objective: `Objective number ${i + 1}`, progress: 'Working', issues: ['One issue'], eta: 'Unknown' })) }));
  const f = fixture([]); f.resize(24); const { showing, panel, view } = await open(f, [many], never);
  let lines = settle(panel, 80, 22);
  assert.equal(lines.length, 22); assert.equal(panel.hasAllocatedHeight, true);
  assert.ok(!lines.some(line => line.includes('Objective number 9')), 'the ninth objective starts below the viewport');
  for (let i = 0; i < 9; i++) { panel.handleInput(TAB); lines = settle(panel, 80, 22); }
  assert.ok(lines.some(line => line.startsWith('▌ ') && line.includes('9. Objective number 9')), lines.join('\n'));
  assert.ok(lines.some(line => line.startsWith('▌ ') && line.includes('ETA:')), 'the whole selected node is in view');
  const row = lines.findIndex(line => line.includes('8. Objective number 8'));
  assert.ok(row > 0, 'a neighbouring node is on screen');
  const event = type => ({ type, button: 'left', x: 6, y: row, screenX: 6, screenY: row, width: 80, height: 22 });
  assert.equal(panel.handleMouse(event('press')).handled, true); assert.equal(panel.handleMouse(event('click')).handled, true);
  lines = settle(panel, 80, 22);
  assert.ok(lines.some(line => line.startsWith('▌ ') && line.includes('8. Objective number 8')));
  assert.ok(!lines.some(line => line.startsWith('▌ ') && line.includes('9. Objective number 9')));
  panel.handleInput(ESCAPE); await showing; view.dispose(f.ctx);
});

test('allocated layout: the commented node stays in view when the terminal shrinks while typing', async () => {
  const f = fixture([]); const { showing, panel, view } = await open(f, [report], never);
  settle(panel, 120, 38);
  for (let i = 0; i < 4; i++) panel.handleInput(TAB);
  panel.handleInput('c'); type(panel, 'Say what was run');
  let lines = settle(panel, 120, 38);
  assert.ok(lines.some(line => line.startsWith('▌ ') && line.includes('Q1. What did you verify?')));
  lines = settle(panel, 80, 22);
  assert.equal(lines.length, 22);
  assert.ok(lines.some(line => line.includes('Comment on Standing question q-verify')), 'the editor is still open');
  assert.ok(lines.some(line => line.startsWith('▌ ') && line.includes('Q1. What did you verify?')), `the commented node left the viewport:\n${lines.join('\n')}`);
  lines = settle(panel, 120, 38);
  assert.ok(lines.some(line => line.startsWith('▌ ') && line.includes('Q1. What did you verify?')));
  panel.handleInput(ENTER); panel.handleInput(ESCAPE); await showing; view.dispose(f.ctx);
  assert.deepEqual(f.savedCalls[0].map(item => item.text), ['Say what was run']);
});

// Keys can arrive in one input chunk (tmux send-keys, SSH coalescing), so no frame is rendered between them.
test('keys handled without a frame in between act on the newly selected checkpoint', async () => {
  const empty = checkpoint('empty', '{"objectives":[],"rules":[]}');
  const f = fixture([]); const { showing, panel, view } = await open(f, [empty, checkpoint('bad', 'not JSON'), report], never);
  panel.render(100);
  panel.handleInput('j'); panel.handleInput('c');
  let screen = panel.render(100).join('\n');
  assert.match(screen, /▌.*bad/, 'the invalid checkpoint is selected');
  assert.match(screen, /no rule, objective or answer to comment on/); assert.doesNotMatch(screen, /Comment on/);
  panel.handleInput('j'); panel.handleInput('\t');
  assert.match(panel.render(100).join('\n'), /no rule, objective or answer to select/);
  panel.handleInput('k'); panel.handleInput('k'); panel.handleInput('c');
  screen = panel.render(100).join('\n');
  assert.match(screen, /Comment on Rule \(user\): Show mockups first/, 'back on the checkpoint with items, c opens the editor at once');
  type(panel, 'kept'); panel.handleInput(ENTER);
  // A comment added just before Tab moves the items below it; the cursor must use the current layout.
  panel.handleInput('\t'); panel.handleInput('\t');
  assert.match(marked(panel, 100)[0], /2\. Write docs/);
  panel.handleInput(ESCAPE); await showing; view.dispose(f.ctx);
  assert.deepEqual(f.savedCalls.map(call => call.map(item => item.text)), [['kept']]);
});

// Pi does not catch exceptions from a focused component's input handler: one would end the process with the panel still open.
test('a fault while handling a key is reported and leaves the panel usable, so comments made in it are still saved', async () => {
  let broken = false;
  const faulty = { ...theme, fg: (_token, text) => { if (broken) throw new Error('theme fault\x1b[31m'); return text; } };
  const f = fixture([], faulty); const { showing, panel, view } = await open(f, [report], never);
  panel.render(100);
  panel.handleInput(TAB); panel.handleInput('c'); type(panel, 'made before the fault'); panel.handleInput(ENTER);
  broken = true;
  assert.doesNotThrow(() => panel.handleInput(TAB));
  broken = false;
  assert.deepEqual(f.notifications.map(args => args[1]), ['error']);
  assert.match(f.notifications[0][0], /^Cuckoo panel error: Error: theme fault/); assert.doesNotMatch(f.notifications[0][0], /\x1b/);
  assert.match(panel.render(100).join('\n'), /\[new\] made before the fault/);
  panel.handleInput(ESCAPE); await showing; view.dispose(f.ctx);
  assert.deepEqual(f.savedCalls.map(call => call.map(item => item.text)), [['made before the fault']]);
});

// The host decides what follows a save from why the panel closed: only a plain user close asks the model to respond.
test('the host is told why the panel closed: by the user, for an inquiry, or with the session', async () => {
  const one = async (close, inquire) => {
    const f = fixture([]); const view = new CuckooView(inquire, f.host, clock);
    view.publish(f.ctx, [report], EMPTY_SET, true, null);
    const showing = view.showReports(f.ctx, [report], 'Cuckoo: ON', EMPTY_SET); await tick();
    const panel = f.views[0].component; panel.render(100);
    panel.handleInput(TAB); panel.handleInput('c'); type(panel, 'a comment'); panel.handleInput(ENTER);
    await close({ f, view, panel }); await showing; view.dispose(f.ctx);
    assert.equal(f.savedCalls.length, 1);
    return f.reasons;
  };
  assert.deepEqual(await one(({ panel }) => panel.handleInput(ESCAPE), never), ['close']);
  assert.deepEqual(await one(({ panel }) => panel.handleInput('q'), never), ['close']);
  assert.deepEqual(await one(({ f }) => f.badge().handleMouse({ type: 'click', button: 'left' }), never), ['close']);
  assert.deepEqual(await one(({ panel }) => panel.handleInput('i'), () => {}), ['inquire']);
  assert.deepEqual(await one(({ f, view }) => view.dispose(f.ctx), never), ['shutdown']);
});
