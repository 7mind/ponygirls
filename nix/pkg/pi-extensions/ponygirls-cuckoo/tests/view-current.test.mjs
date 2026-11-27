import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js';
import { CuckooView } from '../src/view.ts';
import { REPORT_TYPE, capturedCheckpoint, checkpoint, checkpoints, reportText } from '../src/report.ts';
import { EDIT_TYPE, EMPTY_SET, MAX_CLOSED_SHOWN, currentSet, editRecord, knownIds, nextNumbers, previewEdit } from '../src/current.ts';
import { currentBlocks, currentSummary, reportContent } from '../src/presentation.ts';

const theme = { fg: (_token, text) => text, bg: (_token, text) => text, bold: text => text };
const styled = { fg: (token, text) => `<${token}>${text}</${token}>`, bg: (_token, text) => text, bold: text => `<b>${text}</b>` };
const ENTER = '\r', ESCAPE = '\x1b', DOWN = '\x1b[B', UP = '\x1b[A', TAB = '\t';
const keys = { matches: (key, action) => (key === ESCAPE && action === 'tui.select.cancel') || (key === ENTER && action === 'tui.select.confirm') };
const tick = () => new Promise(setImmediate);
const NOW = Date.parse('2026-11-27T12:30:00Z');
const clock = () => NOW;
const at = minutesAgo => new Date(NOW - minutesAgo * 60000).toISOString();

/** A branch built like the extension saves it, with chosen timestamps: numbered checkpoints and edits in order. */
function branchBuilder() {
  const entries = [];
  const push = (customType, data, minutesAgo) => { entries.push({ type: 'custom', customType, id: `e${entries.length + 1}`, parentId: entries.length === 0 ? null : `e${entries.length}`, timestamp: at(minutesAgo), data }); };
  return {
    entries,
    checkpoint(requestId, reply, minutesAgo) {
      const value = capturedCheckpoint(requestId, JSON.stringify(reply), [], knownIds(currentSet(entries)), nextNumbers(entries));
      assert.equal(value.error, null, String(value.error));
      push(REPORT_TYPE, { ...value, messageEntryId: `m-${requestId}`, content: [] }, minutesAgo);
    },
    legacy(requestId, reply, minutesAgo) { push(REPORT_TYPE, checkpoint(requestId, JSON.stringify(reply)), minutesAgo); },
    edit(value, minutesAgo) { previewEdit(currentSet(entries), value); push(EDIT_TYPE, editRecord(value), minutesAgo); },
  };
}
const objective = (id, title, progress = 'Stated', eta = 'Unknown: not measured') => ({ id, objective: title, progress, issues: [`${title}: a risk`], eta });
const rule = (id, text, source = 'user') => ({ id, rule: text, source, scope: 'This change' });
/** Three checkpoints and edits between them: every status and both writers occur. */
function scenario() {
  const b = branchBuilder();
  b.checkpoint('req-1', { objectives: [objective(null, 'Survey the reports'), objective(null, 'Number the entries')], rules: [rule(null, 'Rules get IDs too'), rule(null, 'Keep notes in scratch', 'assistant')] }, 85);
  b.edit({ action: 'add_objective', id: 'AO3', objective: 'Add the update tool', progress: null, issues: null, eta: null }, 70);
  b.edit({ action: 'complete', id: 'AO1', progress: 'Surveyed 591 reports', issues: ['One user only'] }, 48);
  b.checkpoint('req-2', { objectives: [objective('AO2', 'Number the entries', 'Tests pass'), objective('AO3', 'Add the update tool'), objective(null, 'Show the set in the panel')],
    rules: [rule('AR1', 'Rules get IDs too'), rule('AR2', 'Keep notes in scratch', 'assistant'), rule(null, 'British spelling', 'assistant')] }, 40);
  b.edit({ action: 'add_rule', id: 'AR4', rule: 'Mockup before the panel changes', source: 'user', scope: 'Interface changes' }, 25);
  b.edit({ action: 'add_objective', id: 'AO5', objective: 'Port the harness', progress: null, issues: null, eta: null }, 20);
  b.edit({ action: 'retire', id: 'AO5', reason: 'Superseded by the validation run' }, 12);
  b.checkpoint('req-3', { objectives: [objective('AO2', 'Number the entries', 'Request text done'), objective('AO3', 'Add the update tool', 'Wired'), objective('AO4', 'Show the set in the panel', 'Prototype works')],
    rules: [rule('AR1', 'Rules get IDs too'), rule('AR2', 'Keep notes in scratch', 'assistant'), rule('AR4', 'Mockup before the panel changes')] }, 10);
  b.edit({ action: 'update', id: 'AO4', fields: { progress: 'Mockup published', eta: 'Unknown: waits for the answer' } }, 4);
  b.edit({ action: 'add_objective', id: 'AO6', objective: 'Describe it in the README', progress: null, issues: null, eta: null }, 2);
  return b.entries;
}

function fixture() {
  const notifications = []; const views = []; const savedCalls = []; const widgets = []; let rows = 60; let frameRequests = 0;
  const ctx = { mode: 'tui', hasUI: true, ui: {
    setWidget: (...args) => widgets.push(args), notify: (...args) => notifications.push(args),
    custom: factory => new Promise(resolve => {
      const view = { closed: false }; views.push(view);
      view.component = factory({ terminal: { get rows() { return rows; } }, requestRender() { frameRequests += 1; } }, theme, keys, () => { view.closed = true; resolve(); });
    }),
  } };
  const host = { saved: () => [], save: (_context, comments) => { savedCalls.push(comments.map(item => structuredClone(item))); } };
  const badge = () => { const factory = widgets.at(-1)[1]; return factory({ invalidate() {} }, theme); };
  return { ctx, host, views, notifications, savedCalls, widgets, badge, resize: value => { rows = value; }, frameRequests: () => frameRequests };
}
async function open(f, entries, set = currentSet(entries)) {
  const view = new CuckooView(() => assert.fail('no inquiry was requested'), f.host, clock);
  const showing = view.showReports(f.ctx, checkpoints(entries), 'Cuckoo: ON (session)', set);
  await tick();
  return { view, showing, panel: f.views.at(-1).component };
}
async function close(f, opened) {
  for (let i = 0; i < 3 && !f.views.at(-1).closed; i++) opened.panel.handleInput(ESCAPE);
  await opened.showing; opened.view.dispose(f.ctx);
  assert.deepEqual(f.notifications, [], 'no fault was reported');
}
const clean = lines => lines.map(line => line.trimEnd());
const marked = lines => lines.filter(line => line.startsWith('▌ ') && !line.includes('│'));
const hints = lines => lines.filter(line => /\besc (close|back)\b/.test(line) || /^↑↓ /.test(line)).join('  ');
const order = (text, parts) => { let from = -1; for (const part of parts) { const found = text.indexOf(part, from + 1); assert.ok(found > from, `"${part}" follows what precedes it`); from = found; } };
/** Lay the pane out like Pi does until neither the layout nor the pane asks for another frame. */
function settle(f, component, width, height) {
  for (let pass = 0; pass < 12; pass++) {
    let again = false; const asked = f.frameRequests();
    const frame = renderLayoutFrame(component, width, height, () => { again = true; });
    if (!again && f.frameRequests() === asked) return clean(frame.lines);
  }
  assert.fail('the panel kept requesting frames');
}

// Specified Behavioral-Active / Blackbox-Group: the pane over the real fold and presentation; no terminal.
test('the current set is the first row of the list and is shown when the pane opens', async () => {
  const f = fixture(); const opened = await open(f, scenario());
  const lines = clean(opened.panel.render(120)); const text = lines.join('\n');
  const rows = lines.filter(line => line.includes('│') && !/Request ID|──/.test(line));
  assert.match(rows[0], /^▌ now │ objectives and rules as the model last stated them +│ +4 │ current$/, 'the row of the set, selected, with its active objectives');
  assert.deepEqual(rows.slice(1).map(row => row.trim().split(' ')[0]), ['3', '2'], 'saved checkpoints keep their numbers');
  assert.match(text, /^── Cuckoo objectives and progress · 1–3 of 4 ─/m);
  assert.match(text, /^── Current set ─/m);
  assert.match(text, /^4 active objectives · 3 active rules · last change: cuckoo_update · 2m ago · the model's own account, not live\nverification$/m);
  assert.doesNotMatch(text, /req-3 · 3 objectives/, 'the newest checkpoint is not what is shown');
  assert.equal(hints(lines), '↑↓ select  ⏎ detail  PgUp/PgDn scroll detail  tab/shift-tab item  i inquire now  esc close', 'no comment key for the current set');
  await close(f, opened);
});

test('the current set lists active objectives, then active rules, then closed entries newest first with how they were closed', async () => {
  const f = fixture(); const opened = await open(f, scenario());
  const text = clean(opened.panel.render(120)).join('\n');
  order(text, ['AO2. Number the entries', 'AO3. Add the update tool', 'AO4. Show the set in the panel', 'AO6. Describe it in the README', 'Session-local rules',
    'AR1 user:', 'AR2 assistant:', 'AR4 user:', 'Closed · newest first', 'AR3 assistant:', 'AO5. Port the harness', 'AO1. Survey the reports', 'Cuckoo: ON (session)']);
  // Each active objective says where its present text comes from.
  assert.match(text, /AO2\. Number the entries\n {5}Progress: {4}Request text done\n {5}Issues: {6}- Number the entries: a risk\n {5}ETA: {9}Unknown: not measured\n {5}As of: {7}checkpoint 3 · 10m ago/);
  assert.match(text, /AO4\. Show the set in the panel\n {5}Progress: {4}Mockup published\n {5}Issues: {6}- Show the set in the panel: a risk\n {5}ETA: {9}Unknown: waits for the answer\n {5}As of: {7}cuckoo_update · 4m ago/);
  // An objective added with a title only: nothing is invented for what was not stated.
  assert.match(text, /AO6\. Describe it in the README\n {5}Progress: {4}Not stated yet\n {5}As of: {7}cuckoo_update · 2m ago\n\n {2}Session-local rules/);
  assert.match(text, /AR4 user: {8}Mockup before the panel changes \(scope: This change\)/, 'as checkpoint 3 restated it');
  // Closed: a rule a checkpoint left out, an objective the model retired, an objective it completed.
  assert.match(text, /AR3 assistant: {3}British spelling \(scope: This change\)\n {9}Retired: {5}checkpoint 3 · 10m ago\n {9}Reason: {6}Left out of that checkpoint; no reason was given/);
  assert.match(text, /AO5\. Port the harness\n {5}Retired: {5}cuckoo_update · 12m ago\n {5}Reason: {6}Superseded by the validation run/);
  assert.match(text, /AO1\. Survey the reports\n {5}Complete: {4}cuckoo_update · 48m ago\n {5}Delivered: {3}Surveyed 591 reports\n {5}Caveats: {5}- One user only/);
  assert.doesNotMatch(text, /older not shown/);
  await close(f, opened);
});

test('enter focuses the current set, the arrows and tab walk its entries in the order shown, escape returns to the list', async () => {
  const f = fixture(); const opened = await open(f, scenario()); const { panel } = opened;
  panel.handleInput(ENTER);
  let lines = clean(panel.render(100));
  assert.match(lines[0], /^── Cuckoo current set ─/); assert.ok(!lines.some(line => line.includes('Request ID')), 'the table folds away');
  assert.equal(hints(lines), '↑↓ item  PgUp/PgDn page  i inquire now  esc back');
  const walked = [];
  for (let step = 0; step < 10; step++) { walked.push(marked(clean(panel.render(100)))[0].slice(2).trim().split(/[ .]/)[0]); panel.handleInput(DOWN); }
  assert.deepEqual(walked, ['AO2', 'AO3', 'AO4', 'AO6', 'AR1', 'AR2', 'AR4', 'AR3', 'AO5', 'AO1'], 'active objectives, active rules, then closed entries');
  // The loop pressed once more at the last entry, which only scrolls; one step back is the entry before it.
  assert.match(marked(clean(panel.render(100)))[0], /AO1\. Survey the reports/);
  panel.handleInput(UP);
  assert.match(marked(clean(panel.render(100)))[0], /AO5\. Port the harness/);
  panel.handleInput(ESCAPE);
  lines = clean(panel.render(100));
  assert.ok(lines.some(line => /^▌ now │/.test(line)), 'back in the list, the current set still selected');
  assert.equal(f.views.at(-1).closed, false);
  panel.handleInput(TAB);
  assert.equal(marked(clean(panel.render(100))).length > 0, true, 'tab selects an entry in list focus too');
  await close(f, opened);
});

test('the current set takes no comments; a saved report still does and names its items by ID', async () => {
  const f = fixture(); const opened = await open(f, scenario()); const { panel } = opened;
  panel.handleInput(TAB); panel.handleInput('c');
  let lines = clean(panel.render(100));
  assert.ok(lines.includes('Comments are made on a saved checkpoint: select one in the list.'), 'the key says where comments go');
  assert.ok(!lines.some(line => line.startsWith('Comment on')), 'no editor opens');
  panel.handleInput('x');
  assert.ok(clean(panel.render(100)).includes('Comments are made on a saved checkpoint: select one in the list.'));
  // One row down: checkpoint 3, where the comment keys work as before.
  panel.handleInput(DOWN);
  lines = clean(panel.render(100));
  assert.match(lines.join('\n'), /^── Checkpoint 3 ─/m); assert.match(lines.join('\n'), /^req-3 · 3 objectives · saved self-report, not live verification$/m);
  assert.match(hints(lines), /tab\/shift-tab item {2}c comment/);
  for (let i = 0; i < 4; i++) panel.handleInput(TAB);
  panel.handleInput('c');
  assert.ok(clean(panel.render(100)).includes('Comment on Objective AO2: Number the entries'));
  for (const character of 'Why not done?') panel.handleInput(character);
  panel.handleInput(ENTER);
  assert.match(hints(clean(panel.render(100))), /c comment {2}x remove new comment/);
  // Back on the current set the new comment is still counted, but its keys are not offered there.
  panel.handleInput(UP);
  lines = clean(panel.render(100));
  assert.ok(lines.some(line => line.startsWith('1 new comment: saved to history and sent to the model when this panel closes')));
  assert.equal(hints(lines), '↑↓ select  ⏎ detail  PgUp/PgDn scroll detail  tab/shift-tab item  i inquire now  esc close');
  await close(f, opened);
  assert.deepEqual(f.savedCalls.map(call => call.map(item => [item.requestId, item.target, item.subject, item.text])), [[['req-3', { kind: 'objective', index: 0 }, 'Objective AO2: Number the entries', 'Why not done?']]]);
});

test('saved reports show IDs where they have them and positions where they were saved before numbering', async () => {
  const b = branchBuilder();
  b.legacy('old', { objectives: [{ objective: 'Legacy objective', progress: 'Stated', issues: [], eta: 'Unknown' }], rules: [{ rule: 'Legacy rule', source: 'user', scope: 'Then' }] }, 60);
  b.checkpoint('new', { objectives: [objective(null, 'Numbered objective')], rules: [rule(null, 'Numbered rule')] }, 30);
  const f = fixture(); const opened = await open(f, b.entries); const { panel } = opened;
  panel.handleInput(DOWN);
  let text = clean(panel.render(100)).join('\n');
  assert.match(text, /^── Checkpoint 2 ─/m); assert.match(text, /^ {5}AR1 user: {8}Numbered rule \(scope: This change\)$/m); assert.match(text, /^ {2}AO1\. Numbered objective$/m);
  panel.handleInput(DOWN);
  text = clean(panel.render(100)).join('\n');
  assert.match(text, /^── Checkpoint 1 ─/m); assert.match(text, /^ {5}user: {8}Legacy rule \(scope: Then\)$/m); assert.match(text, /^ {2}1\. Legacy objective$/m);
  // The focused title counts saved checkpoints, not the row of the current set.
  panel.handleInput(ENTER);
  assert.match(clean(panel.render(100))[0], /^── Cuckoo checkpoint 1 of 2 ─/);
  await close(f, opened);
});

test('a branch without numbered reports or edits has no row for a current set', async () => {
  const b = branchBuilder();
  b.legacy('old', { objectives: [{ objective: 'Legacy objective', progress: 'Stated', issues: [], eta: 'Unknown' }], rules: [] }, 60);
  const f = fixture(); const opened = await open(f, b.entries);
  const lines = clean(opened.panel.render(100));
  assert.ok(!lines.some(line => /\bnow │/.test(line))); assert.match(lines.join('\n'), /^── Checkpoint 1 ─/m);
  assert.ok(lines.some(line => /^▌ +1 │ old/.test(line)), 'the newest checkpoint is selected, as before');
  await close(f, opened);
  const history = new CuckooView(() => {}, f.host, clock);
  const showing = history.showHistory(f.ctx, scenario(), scenario()); await tick();
  assert.ok(!clean(f.views.at(-1).component.render(120)).some(line => /\bnow │/.test(line)), 'history lists saved answers only');
  f.views.at(-1).component.handleInput(ESCAPE); await showing; history.dispose(f.ctx);
});

test('a set whose entries are all closed says so, and older closed entries are counted, not listed', async () => {
  const b = branchBuilder();
  for (let index = 1; index <= MAX_CLOSED_SHOWN + 3; index++) {
    b.edit({ action: 'add_rule', id: `AR${index}`, rule: `Rule ${index}`, source: 'assistant', scope: 'x' }, 200 - index);
    b.edit({ action: 'retire', id: `AR${index}`, reason: `Reason ${index}` }, 100 - index);
  }
  const f = fixture(); f.resize(200); const opened = await open(f, b.entries);
  const text = clean(opened.panel.render(100)).join('\n');
  assert.match(text, /^0 active objectives · 0 active rules · last change: cuckoo_update · 1h 17m ago/m);
  assert.match(text, /^ {2}No active objectives\.$/m); assert.match(text, /^ {4}No active session-local rules\.$/m);
  assert.match(text, /^ {2}Closed · newest first · 3 older not shown$/m);
  assert.equal((text.match(/Retired: /g) ?? []).length, MAX_CLOSED_SHOWN);
  order(text, [`AR${MAX_CLOSED_SHOWN + 3} assistant:`, `AR${MAX_CLOSED_SHOWN + 2} assistant:`, 'AR4  assistant:']);
  assert.doesNotMatch(text, /AR3 +assistant:/, 'the oldest closed entries are not listed');
  await close(f, opened);
});

test('the badge counts the active objectives of the current set, and a click opens the pane on it', async () => {
  const entries = scenario(); const reports = checkpoints(entries); const set = currentSet(entries);
  const f = fixture(); const view = new CuckooView(() => {}, f.host, clock);
  view.publish(f.ctx, reports, set, true, null);
  assert.equal(f.badge().render(80)[0], ' 🐦 4 ', 'four active objectives; the last report lists three');
  assert.equal(f.badge().renderCompact(10), '🐦4');
  view.publish(f.ctx, reports, EMPTY_SET, true, null);
  assert.equal(f.badge().render(80)[0], ' 🐦 3 ', 'without a current set: the objectives of the last valid report');
  const b = branchBuilder(); b.edit({ action: 'add_objective', id: 'AO1', objective: 'Only one', progress: null, issues: null, eta: null }, 5); b.edit({ action: 'retire', id: 'AO1', reason: 'Dropped' }, 4);
  view.publish(f.ctx, [], currentSet(b.entries), false, null);
  assert.equal(f.badge().render(80)[0], ' 🐦 0 off ', 'a set without active objectives counts zero, also before any checkpoint');
  view.publish(f.ctx, [...reports, checkpoint('bad', 'not JSON')], set, true, null);
  assert.equal(f.badge().render(80)[0], ' 🐦 4 ! ', 'an invalid latest report still warns');
  view.publish(f.ctx, reports, set, true, null);
  f.badge().handleMouse({ type: 'click', button: 'left' }); await tick();
  const lines = clean(f.views.at(-1).component.render(100));
  assert.ok(lines.some(line => /^▌ now │/.test(line)), 'the pane opened from the badge shows the published set');
  f.views.at(-1).component.handleInput(ESCAPE); await tick(); view.dispose(f.ctx);
});

test('without a terminal the status text states the current set before the saved checkpoints', async () => {
  const entries = scenario(); const reports = checkpoints(entries); const set = currentSet(entries);
  const f = fixture(); f.ctx.mode = 'rpc';
  const view = new CuckooView(() => {}, f.host, clock);
  await view.showReports(f.ctx, reports, 'Cuckoo: ON (session)', set);
  const [text, level] = f.notifications.at(-1);
  assert.equal(level, 'info');
  order(text, ['Cuckoo: ON (session)', 'Current set · 4 active objectives · 3 active rules · last change: cuckoo_update · 2m ago · the model\'s own account, not live verification',
    'AO2. Number the entries', 'Session-local rules', 'AR1 user:', 'Closed · newest first', 'AO1. Survey the reports', 'Checkpoint 3 (req-3)', 'Checkpoint 1 (req-1)']);
  assert.equal(text, reportContent(reports, 'Cuckoo: ON (session)', [], set, NOW).plain);
  assert.ok(text.endsWith(reportText(reports, [])), 'the checkpoints follow unchanged');
  assert.equal(reportContent(reports, 'Cuckoo: ON (session)', [], EMPTY_SET, NOW).plain, `Cuckoo: ON (session)\n\n${reportText(reports, [])}`, 'no section without a set');
  f.notifications.length = 0; view.dispose(f.ctx);
});

// Specified Behavioral-Active / Blackbox-Atomic: presentation of the set.
test('the themed status text puts the current set first, and its summary counts active entries', () => {
  const entries = scenario(); const set = currentSet(entries);
  const rendered = reportContent(checkpoints(entries), 'Cuckoo: ON', [], set, NOW).render(styled, 200);
  order(rendered, ['<accent><b>Current set</b></accent>', '<accent><b>AO2. Number the entries</b></accent>', '<warning><b>Session-local rules</b></warning>', '<muted><b>Closed</b></muted>',
    '<muted><b>AO1. Survey the reports</b></muted>', '<accent><b>Checkpoint 3</b></accent>', 'Status and configuration']);
  assert.match(rendered, /<success><b>Complete:<\/b><\/success>/); assert.match(rendered, /<muted>Not stated yet<\/muted>/);
  assert.equal(currentSummary(set, NOW), '4 active objectives · 3 active rules · last change: cuckoo_update · 2m ago');
  assert.deepEqual(currentBlocks(styled, set, 100, NOW).flatMap(block => block.entry === null ? [] : [block.entry]), ['AO2', 'AO3', 'AO4', 'AO6', 'AR1', 'AR2', 'AR4', 'AR3', 'AO5', 'AO1'],
    'one block per entry: active objectives, active rules, then closed entries newest first');
  assert.equal(currentSummary(EMPTY_SET, NOW), '0 active objectives · 0 active rules');
  const one = branchBuilder(); one.edit({ action: 'add_objective', id: 'AO1', objective: 'Only one', progress: null, issues: null, eta: null }, 90); one.edit({ action: 'add_rule', id: 'AR1', rule: 'One rule', source: 'user', scope: 'x' }, 61);
  assert.equal(currentSummary(currentSet(one.entries), NOW), '1 active objective · 1 active rule · last change: cuckoo_update · 1h 1m ago');
});

test('the current set stays within narrow widths and never passes terminal controls through', async () => {
  const b = branchBuilder();
  b.checkpoint('req', { objectives: [objective(null, `Title\x1b[31m with\x07 controls ${'long '.repeat(30)}`, 'Progress\x9b\r here')], rules: [rule(null, `Rule\x1b]0;x\x07 ${'wide '.repeat(30)}`), rule(null, 'Second rule')] }, 30);
  b.edit({ action: 'retire', id: 'AR1', reason: `Reason\x1b[2J ${'because '.repeat(20)}` }, 5);
  b.edit({ action: 'retire', id: 'AO1', reason: 'Dropped' }, 4);
  b.edit({ action: 'retire', id: 'AR2', reason: 'Dropped' }, 3);
  const f = fixture(); f.resize(400); const opened = await open(f, b.entries);
  // With the set focused the table, whose columns have minimum widths, is folded away: every line is the set's.
  opened.panel.handleInput(ENTER);
  for (const width of [24, 40, 60, 120]) {
    const lines = opened.panel.render(width);
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
      // The pane's own colour resets apart, no control byte of an entry reaches the terminal.
      assert.doesNotMatch(line.replace(/\x1b\[[0-9;]*m/g, ''), /[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
    }
    const text = lines.join(' ').replace(/\s+/g, ' ');
    for (const part of ['Title[31m with controls', 'Rule]0;x wide', 'Reason[2J because', 'No active objectives.', 'No active session-local rules.', 'Closed · newest first']) assert.ok(text.includes(part), `width ${width}: ${part}`);
  }
  await close(f, opened);
});

// Specified Behavioral-Active / Blackbox-Group: the pane sized by Pi's layout engine.
test('in a pane sized by the layout engine the current set scrolls under its own title', async () => {
  const f = fixture(); const opened = await open(f, scenario()); const { panel } = opened;
  let lines = settle(f, panel, 80, 20);
  assert.equal(lines.length, 20);
  assert.match(lines.find(line => line.startsWith('── Current set')), /^── Current set ─+ lines 1–11 of \d+ ↓ ──$/);
  panel.handleInput(ENTER);
  lines = settle(f, panel, 80, 20);
  assert.match(lines[0], /^── Cuckoo current set ─+ lines 1–18 of \d+ ↓ ──$/);
  for (const line of lines) assert.ok(visibleWidth(line) <= 80, line);
  for (let step = 0; step < 3; step++) panel.handleInput(DOWN);
  lines = settle(f, panel, 80, 20);
  assert.match(marked(lines)[0], /AO6\. Describe it in the README/); assert.match(lines[0], /↑ lines \d+–\d+ of \d+ ↓/);
  await close(f, opened);
});
