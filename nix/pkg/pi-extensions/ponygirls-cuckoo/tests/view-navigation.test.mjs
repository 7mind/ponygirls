import test from 'node:test';
import assert from 'node:assert/strict';
import { ScrollView, TuiAltScreen, VStack, visibleWidth } from '@earendil-works/pi-tui';
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js';
import { CuckooView } from '../src/view.ts';
import { answeredCheckpoint, checkpoint, REPORT_TYPE } from '../src/report.ts';
import { EMPTY_SET } from '../src/current.ts';

/** A fixed clock: these panes show no current set, so no age is drawn from it. */
const clock = () => Date.parse('2026-11-27T12:00:00Z');

const theme = { fg: (_token, text) => text, bg: (_token, text) => text, bold: text => text };
const ENTER = '\r', ESCAPE = '\x1b', UP = '\x1b[A', DOWN = '\x1b[B', TAB = '\t', PAGE_DOWN = '\x1b[6~', HOME = '\x1b[H', END = '\x1b[F';
const tick = () => new Promise(setImmediate);
const keys = { matches: (key, action) => (key === ESCAPE && action === 'tui.select.cancel') || (key === ENTER && action === 'tui.select.confirm') };
const asked = [{ id: 'q-verify', question: 'What did you verify?', scope: 'global' }];
const report = answeredCheckpoint('req-1', JSON.stringify({
  objectives: [{ objective: 'Ship the panel', progress: 'Selection works', issues: ['Editor untested'], eta: 'Unknown: tests pending' }, { objective: 'Write docs', progress: 'Not started', issues: [], eta: 'Unknown' }],
  rules: [{ rule: 'Show mockups first', source: 'user', scope: 'This UI change' }],
  answers: [{ id: 'q-verify', answer: 'Only the decoder tests.' }],
}), asked);
const older = checkpoint('req-0', JSON.stringify({ objectives: [{ objective: 'Earlier goal', progress: 'Done', issues: [], eta: 'Complete' }], rules: [] }));
/**
 * Every rendered line of this report is distinct and short, so a walk can prove that no line was skipped.
 * `answerLines` > 0 adds one standing-question answer of that many lines under its section heading.
 */
function tallReport(id, issueCounts, answerLines = 0) {
  const body = {
    rules: [{ rule: 'R1', source: 'user', scope: 'S1' }, { rule: 'R2', source: 'assistant', scope: 'S2' }],
    objectives: issueCounts.map((count, index) => ({ objective: `Objective ${index + 1}`, progress: `P${index + 1}`, eta: `E${index + 1}`,
      issues: Array.from({ length: count }, (_, issue) => `I${index + 1}.${issue + 1}`) })),
  };
  if (answerLines === 0) return checkpoint(id, JSON.stringify(body));
  const answer = Array.from({ length: answerLines }, (_, line) => `A${line + 1}`).join('\n');
  return answeredCheckpoint(id, JSON.stringify({ ...body, answers: [{ id: 'q-verify', answer }] }), asked);
}
const STATUS = 'Cuckoo: ON (session)\nGrowth policy: G1\nPending checkpoint: none\nGlobal defaults: D1\nProject overrides: O1\nFeatures: F1\nHistory: H1';

function fixture(saved = []) {
  const notifications = []; const views = []; const savedCalls = []; let rows = 40; let frameRequests = 0;
  const ctx = { mode: 'tui', hasUI: true, ui: {
    setWidget() {}, notify: (...args) => notifications.push(args),
    custom: (factory, options) => new Promise(resolve => {
      const view = { options, closed: false }; views.push(view);
      view.component = factory({ terminal: { get rows() { return rows; } }, requestRender() { frameRequests += 1; } }, theme, keys, () => { view.closed = true; resolve(); });
    }),
  } };
  const host = { saved: () => saved, save: (_context, comments) => { savedCalls.push(comments.map(item => structuredClone(item))); } };
  return { ctx, host, views, notifications, savedCalls, resize: value => { rows = value; }, frameRequests: () => frameRequests };
}
async function open(f, reports, intro = 'Cuckoo: ON (session)') {
  const view = new CuckooView(() => assert.fail('no inquiry was requested'), f.host, clock);
  const showing = view.showReports(f.ctx, reports, intro, EMPTY_SET);
  await tick();
  return { view, showing, panel: f.views.at(-1).component };
}
async function close(f, opened) {
  for (let i = 0; i < 3 && !f.views.at(-1).closed; i++) opened.panel.handleInput(ESCAPE);
  await opened.showing; opened.view.dispose(f.ctx);
  assert.deepEqual(f.notifications, [], 'no fault was reported');
}
const type = (panel, text) => { for (const character of text) panel.handleInput(character); };
/** Lines of the selected item: the cursor bar in the gutter, outside the checkpoint table. */
const marked = lines => lines.filter(line => line.startsWith('▌ ') && !line.includes('│'));
const hints = lines => lines.filter(line => /\besc (close|back)\b/.test(line) || /^↑↓ /.test(line)).join('  ');
/**
 * Lay a component out with Pi's layout engine at a fixed size until neither the layout nor the pane asks for
 * another frame, as the terminal loop does.
 */
function settle(f, component, width, height) {
  for (let pass = 0; pass < 12; pass++) {
    let again = false;
    const asked = f.frameRequests();
    const frame = renderLayoutFrame(component, width, height, () => { again = true; });
    if (!again && f.frameRequests() === asked) return frame.lines.map(line => line.trimEnd());
  }
  assert.fail('the panel kept requesting frames');
}
/**
 * The pane under a transcript that takes the remaining rows: the host gives the pane the height of its content, as Pi
 * does. `rows` are the terminal's; Pi keeps two of them for itself.
 */
function contentSized(f, panel) {
  const transcript = new ScrollView({ render: () => ['chat'], invalidate() {} }, { follow: 'end', primary: true });
  const root = new VStack([{ component: transcript, grow: 1 }]);
  root.addChild(panel, { shrink: 0 });
  return { draw: (width, rows) => { f.resize(rows); const lines = settle(f, root, width, rows - 2); return lines.slice(lines.findIndex(line => line.startsWith('── '))); } };
}
/** The two ways the pane is drawn: without an allocated height (terminal rows bound it) and through Pi's layout engine. */
const LAYOUTS = [
  { name: 'unallocated', draw: (f, panel, width, rows) => { f.resize(rows + 2); return panel.render(width).map(line => line.trimEnd()); } },
  { name: 'allocated', draw: (f, panel, width, rows) => settle(f, panel, width, rows) },
];

// Specified Behavioral-Active / Blackbox-Group: the pane through its public input and render boundary with a fake terminal.
test('enter focuses the report: the table folds away, the arrows act on the report, and escape returns to the list', async () => {
  const f = fixture(); const opened = await open(f, [older, report]); const { panel } = opened;
  let lines = panel.render(100);
  assert.match(lines.join('\n'), /Request ID/);
  assert.equal(hints(lines), '↑↓ select  ⏎ detail  PgUp/PgDn scroll detail  tab/shift-tab item  c comment  i inquire now  esc close');
  assert.deepEqual(marked(lines), [], 'no item is selected in the list');

  panel.handleInput(ENTER);
  lines = panel.render(100);
  assert.doesNotMatch(lines.join('\n'), /Request ID|─┼─|req-0/, 'the table is hidden while the report is focused');
  assert.match(lines[0], /^── Cuckoo checkpoint 2 of 2 ─+$/);
  assert.equal(hints(lines), '↑↓ item  PgUp/PgDn page  c comment  i inquire now  esc back');
  assert.match(marked(lines)[0], /user:\s+Show mockups first/, 'the cursor starts on the first item on screen');

  panel.handleInput(DOWN);
  assert.match(marked(panel.render(100))[0], /1\. Ship the panel/, 'the arrows move the item cursor');
  panel.handleInput('j');
  assert.match(marked(panel.render(100))[0], /2\. Write docs/);
  panel.handleInput(DOWN); panel.handleInput(DOWN); panel.handleInput(DOWN);
  lines = panel.render(100);
  assert.match(marked(lines)[0], /Q1\. What did you verify\?/, 'the cursor stops at the last item');
  assert.match(lines.join('\n'), /Ship the panel/, 'the arrows did not change the checkpoint');
  panel.handleInput('k'); panel.handleInput(UP);
  assert.match(marked(panel.render(100))[0], /1\. Ship the panel/);

  panel.handleInput(ESCAPE);
  assert.equal(f.views[0].closed, false, 'escape leaves the report, not the pane');
  lines = panel.render(100);
  assert.match(lines.join('\n'), /Request ID/);
  assert.match(hints(lines), /^↑↓ select .* esc close$/);
  assert.match(marked(lines)[0], /1\. Ship the panel/, 'the item cursor is kept');
  panel.handleInput(DOWN);
  lines = panel.render(100);
  assert.match(lines.join('\n'), /▌.*req-0/); assert.match(lines.join('\n'), /Earlier goal/, 'in the list the arrows select checkpoints again');
  assert.deepEqual(marked(lines), [], 'changing the checkpoint clears the item cursor');

  panel.handleInput(ENTER);
  assert.match(panel.render(100)[0], /^── Cuckoo checkpoint 1 of 2 ─/);
  panel.handleInput('q');
  assert.equal(f.views[0].closed, false, 'q leaves the report like escape');
  assert.match(panel.render(100).join('\n'), /Request ID/);
  panel.handleInput('q'); await opened.showing;
  assert.equal(f.views[0].closed, true);
  opened.view.dispose(f.ctx);
  assert.deepEqual(f.savedCalls, [], 'navigation creates no comment');
});

for (const layout of LAYOUTS) {
  test(`${layout.name}: the arrows show every line of the report, top to bottom and back, also through items taller than the view`, async () => {
    // Objective 2 is 15 lines, objective 4 is 31 and the answer 21: taller than most of the views below. A tall item
    // that follows a section heading is where a step of more than one view would skip the heading.
    const value = tallReport('tall', [1, 12, 0, 28, 2], 20);
    // The last two leave the report one and two rows: less than the lines between two items.
    for (const [width, rows] of [[60, 14], [60, 22], [60, 40], [34, 16], [60, 3], [60, 4]]) {
      const f = fixture(); const opened = await open(f, [value], STATUS); const { panel } = opened;
      // What the report consists of: its lines in a pane tall enough to show all of it.
      panel.handleInput(ENTER);
      const all = layout.draw(f, panel, width, 200).filter(line => line !== '' && !/^(── |↑↓ )/.test(line)).map(line => line.replace(/^▌ /, '  '));
      // Lines that occur once identify their place; at narrow widths the field labels stand alone and repeat.
      const body = all.filter(line => all.indexOf(line) === all.lastIndexOf(line));
      assert.ok(body.length > 60, `${body.length} distinct lines`);
      const seen = new Set();
      const cursors = [];
      const look = () => {
        const lines = layout.draw(f, panel, width, rows);
        assert.ok(lines.length <= rows, `${lines.length} lines in ${rows} rows`);
        // The report does not fit, so its title has the position wherever the width leaves room for it.
        const position = lines[0].match(/lines (\d+)–(\d+) of \d+/);
        assert.equal(position !== null, width >= 60, lines[0]);
        const footerRows = lines.length - lines.findIndex(line => line.startsWith('↑↓ '));
        if (position !== null) assert.equal(Number(position[2]) - Number(position[1]) + 1, lines.length - 1 - footerRows, `the position counts the report rows on screen:\n${lines.join('\n')}`);
        for (const line of lines) seen.add(line.replace(/^▌ /, '  '));
        const head = marked(lines).map(line => line.replace(/^▌\s+/, ''))[0];
        if (head !== undefined && cursors.at(-1) !== head) cursors.push(head);
        return lines.join('\n');
      };
      const walk = key => {
        let frame = look();
        for (let presses = 0; presses < 400; presses++) {
          panel.handleInput(key);
          const next = look();
          if (next === frame) return presses;
          frame = next;
        }
        assert.fail(`${width}x${rows}: the walk did not end`);
      };
      const down = walk(DOWN);
      assert.deepEqual(body.filter(line => !seen.has(line)), [], `${width}x${rows}: lines never shown on the way down`);
      assert.ok(down < 2 * body.length, `${width}x${rows}: ${down} presses for ${body.length} lines`);
      // The cursor bar marks whole items, so their first lines appear in report order, none skipped.
      assert.deepEqual(cursors.filter(line => /^(user:|assistant:|Q?\d+\. )/.test(line)).map(line => line.split(/\s+/).slice(0, /^Q?\d/.test(line) ? 3 : 1).join(' ')),
        ['user:', 'assistant:', '1. Objective 1', '2. Objective 2', '3. Objective 3', '4. Objective 4', '5. Objective 5', 'Q1. What did'], `${width}x${rows}`);
      seen.clear();
      const up = walk(UP);
      assert.deepEqual(body.filter(line => !seen.has(line)), [], `${width}x${rows}: lines never shown on the way up`);
      assert.ok(up < 2 * body.length, `${width}x${rows}: ${up} presses for ${body.length} lines`);
      await close(f, opened);
    }
  });

  test(`${layout.name}: an item taller than the view is read line by line and the next press takes the next item whole`, async () => {
    const f = fixture(); const opened = await open(f, [tallReport('tall', [0, 12, 0])], STATUS); const { panel } = opened;
    const draw = () => layout.draw(f, panel, 60, 14);
    panel.handleInput(ENTER);
    panel.handleInput(DOWN); panel.handleInput(DOWN);
    let lines = draw();
    assert.match(marked(lines)[0], /1\. Objective 1/);
    panel.handleInput(DOWN);
    lines = draw();
    // 12 body rows: objective 2 has 15 lines, so it starts at the top of the view and its last three lines are below it.
    assert.match(lines[1], /^▌ 2\. Objective 2$/, lines.join('\n'));
    assert.equal(marked(lines).length, 12);
    assert.match(marked(lines).at(-1), /I2\.10$/);
    assert.match(lines[0], /↑ lines \d+–\d+ of \d+ ↓ ──$/);
    for (const last of ['I2.11', 'I2.12', 'E2']) {
      panel.handleInput(DOWN);
      lines = draw();
      assert.ok(marked(lines).at(-1).endsWith(last), `one more line per press, expected ${last}:\n${lines.join('\n')}`);
      assert.equal(marked(lines).length, 12, 'the cursor stays on the tall item');
    }
    panel.handleInput(DOWN);
    lines = draw();
    assert.deepEqual(marked(lines).map(line => line.replace(/^▌\s+/, '')), ['3. Objective 3', 'Progress:    P3', 'Issues:      None known', 'ETA:         E3'], 'the next item is shown whole');
    assert.match(lines.join('\n'), /ETA:\s+E2/, 'just enough is scrolled: the end of the previous item stays');
    // Back up: the tall item is entered at its end and read upwards by line.
    panel.handleInput(UP);
    lines = draw();
    assert.match(marked(lines).at(-1), /ETA:\s+E2$/);
    assert.equal(marked(lines).length, 12);
    assert.ok(!lines.some(line => line.includes('2. Objective 2')), 'its first lines are above the view');
    panel.handleInput(UP); panel.handleInput(UP); panel.handleInput(UP);
    lines = draw();
    assert.match(lines[1], /^▌ 2\. Objective 2$/);
    panel.handleInput(UP);
    assert.match(marked(draw())[0], /1\. Objective 1/);
    await close(f, opened);
  });

  test(`${layout.name}: a cursor item the view cuts off is completed in one press when it fits`, async () => {
    const f = fixture(); const opened = await open(f, [tallReport('tall', [2, 2, 2, 2])], STATUS); const { panel } = opened;
    const draw = () => layout.draw(f, panel, 60, 14);
    const wheel = delta => panel.handleMouse({ type: 'wheel', button: 'none', wheelDelta: delta, x: 5, y: 5, screenX: 5, screenY: 5, width: 60, height: 14 });
    const click = text => {
      const lines = draw();
      const row = lines.findIndex(line => line.includes(text));
      assert.ok(row > 0, `${text} is on screen:\n${lines.join('\n')}`);
      for (const kind of ['press', 'click']) assert.equal(panel.handleMouse({ type: kind, button: 'left', x: 8, y: row, screenX: 8, screenY: row, width: 60, height: lines.length }).handled, true);
    };
    const item = lines => marked(lines).map(line => line.replace(/^▌\s+/, ''));
    panel.handleInput(ENTER);
    let lines = draw();
    // Twelve report rows: objective 1 ends with the view and objective 2 is below it.
    assert.match(lines.at(-2), /ETA:\s+E1$/);
    wheel(3);
    lines = draw();
    assert.ok(lines.some(line => line.includes('Progress:    P2')) && !lines.some(line => line.includes('I2.2')), `objective 2 is cut off below:\n${lines.join('\n')}`);
    click('2. Objective 2');
    assert.deepEqual(item(draw()), ['2. Objective 2', 'Progress:    P2']);
    panel.handleInput(DOWN);
    assert.deepEqual(item(draw()), ['2. Objective 2', 'Progress:    P2', 'Issues:      - I2.1', '- I2.2', 'ETA:         E2'], 'one press shows the rest of it');
    // The same upwards: objective 2 with its first three lines above the view.
    wheel(draw().findIndex(line => line.includes('2. Objective 2')) - 1 + 3);
    lines = draw();
    assert.deepEqual(item(lines), ['- I2.2', 'ETA:         E2'], lines.join('\n'));
    click('ETA:         E2');
    panel.handleInput(UP);
    assert.deepEqual(item(draw()), ['2. Objective 2', 'Progress:    P2', 'Issues:      - I2.1', '- I2.2', 'ETA:         E2']);
    assert.match(draw()[1], /^▌ 2\. Objective 2$/, 'no further than its first line');
    await close(f, opened);
  });

  test(`${layout.name}: after scrolling away, the next arrow takes an item on screen; where none is on screen it scrolls`, async () => {
    const tail = Array.from({ length: 24 }, (_, i) => `Tail ${i + 1}: T${i + 1}`).join('\n');
    const f = fixture(); const opened = await open(f, [tallReport('tall', [2, 2, 2, 2, 2, 2])], `${STATUS}\n${tail}`); const { panel } = opened;
    const draw = () => layout.draw(f, panel, 60, 14);
    const ofItem = line => /^(▌ |  )\s*(\d+\. Objective|Progress:|Issues:|- I\d|ETA:|(user|assistant):)/.test(line);
    const top = lines => Number(lines[0].match(/lines (\d+)–/)[1]);
    const unmarked = lines => lines.map(line => line.replace(/^▌ /, '  '));
    // A page is half the view, or one line without an allocated height: page until the cursor has left the screen.
    const pageAway = () => { let lines = draw(); for (let i = 0; i < 60 && marked(lines).length > 0; i++) { panel.handleInput(PAGE_DOWN); lines = draw(); } return lines; };
    panel.handleInput(ENTER);
    assert.match(marked(draw())[0], /user:\s+R1/);
    let before = pageAway();
    assert.deepEqual(marked(before), [], 'the cursor is off screen');
    assert.ok(before.some(ofItem), 'other items are on screen');
    panel.handleInput(DOWN);
    let lines = draw();
    assert.equal(marked(lines)[0].slice(2), before.find(ofItem).slice(2), `down takes the first item on screen:\n${lines.join('\n')}`);
    assert.deepEqual(unmarked(lines), before, 'taking it does not scroll');
    before = pageAway();
    assert.deepEqual(marked(before), []);
    panel.handleInput(UP);
    lines = draw();
    assert.equal(marked(lines).at(-1).slice(2), before.findLast(ofItem).slice(2), `up takes the last item on screen:\n${lines.join('\n')}`);
    assert.deepEqual(unmarked(lines), before);
    // At the end only status lines are on screen: an arrow moves the view by one line, there and back.
    panel.handleInput(END);
    before = draw();
    assert.ok(!before.some(ofItem), `no item is on screen at the end:\n${before.join('\n')}`);
    panel.handleInput(UP);
    lines = draw();
    assert.equal(top(lines), top(before) - 1, 'no dead key press');
    assert.deepEqual(marked(lines), []);
    panel.handleInput(DOWN);
    assert.deepEqual(draw(), before);
    await close(f, opened);
  });

  test(`${layout.name}: a focus change does not move the report, so enter then escape returns to the same view`, async () => {
    const f = fixture(); const opened = await open(f, [older, tallReport('tall', [3, 3, 3, 3])], STATUS); const { panel } = opened;
    const draw = () => layout.draw(f, panel, 60, 18);
    // Entering the report places the item cursor; only its bar may differ afterwards, not the table's.
    const unmarked = lines => lines.map(line => line.includes('│') ? line : line.replace(/^▌ /, '  '));
    draw();
    panel.handleInput(PAGE_DOWN); panel.handleInput(PAGE_DOWN);
    const list = draw();
    const rule = list.findIndex(line => line.startsWith('── Checkpoint 2 '));
    assert.ok(rule > 0, list.join('\n'));
    panel.handleInput(ENTER);
    const focused = draw();
    assert.equal(focused[1].replace(/^▌ /, '  '), list[rule + 1], 'the first visible line stays first');
    assert.ok(focused.filter(line => !/^(── |↑↓ )/.test(line)).length > list.slice(rule + 1).filter(line => !/^(── |↑↓ |i inquire)/.test(line)).length, 'the report gained the rows of the table');
    panel.handleInput(ESCAPE);
    assert.deepEqual(unmarked(draw()), list, 'the list view is as it was');
    await close(f, opened);
  });

  test(`${layout.name}: from the end of the report, enter shows more of what precedes it and escape returns to the view before`, async () => {
    const f = fixture(); const opened = await open(f, [older, tallReport('tall', [3, 3, 3, 3])], STATUS); const { panel } = opened;
    const draw = () => layout.draw(f, panel, 60, 18);
    draw();
    panel.handleInput(END);
    const list = draw();
    assert.match(list.find(line => line.startsWith('── Checkpoint 2 ')), /↑ lines \d+–(\d+) of \1 ──$/, 'the list view is at the end of the report');
    panel.handleInput(ENTER);
    const focused = draw();
    assert.match(focused[0], /↑ lines \d+–(\d+) of \1 ──$/, 'the taller view still ends with the report');
    assert.equal(focused.at(-2), list.at(-3), 'its last line is the same');
    // The end of objective 3 came on screen with the taller view, but the cursor takes an item that was on screen when enter was pressed.
    const third = line => /ETA:\s+E3$/.test(line);
    assert.ok(focused.some(third) && !list.some(third), focused.join('\n'));
    assert.match(marked(focused)[0], /^▌ 4\. Objective 4$/);
    panel.handleInput(ESCAPE);
    // Enter placed the item cursor; apart from its bar the frame is the one enter was pressed in.
    assert.deepEqual(draw().map(line => line.includes('│') ? line : line.replace(/^▌ /, '  ')), list, 'escape returns to the view enter was pressed in');
    await close(f, opened);
  });

  test(`${layout.name}: an arrow at the end of the report changes nothing, also not where the view is after escape`, async () => {
    const raw = Array.from({ length: 40 }, (_, index) => `raw line ${index + 1}`).join('\n');
    const f = fixture(); const opened = await open(f, [older, checkpoint('bad', raw)], STATUS); const { panel } = opened;
    const draw = () => layout.draw(f, panel, 60, 18);
    draw();
    panel.handleInput(END); draw();
    panel.handleInput(ENTER);
    const focused = draw();
    assert.match(focused[0], /↑ lines \d+–(\d+) of \1 ──$/);
    panel.handleInput(DOWN); panel.handleInput('j');
    assert.deepEqual(draw(), focused, 'there is nothing below the end');
    panel.handleInput(ESCAPE);
    const list = draw();
    assert.equal(list[list.findIndex(line => line.startsWith('── Checkpoint 2 ')) + 1], focused[1], 'the first visible line stays first');
    await close(f, opened);
  });

  test(`${layout.name}: leaving the report keeps the selected item on screen, so c still comments on it`, async () => {
    const f = fixture(); const opened = await open(f, [older, tallReport('tall', [1, 1, 1, 1, 1, 1])], STATUS); const { panel } = opened;
    const draw = () => layout.draw(f, panel, 60, 18);
    draw();
    panel.handleInput(ENTER);
    let lines = draw();
    // Walk to an item in the lower rows of the focused view: below the rows the list view has.
    for (let i = 0; i < 20 && lines.indexOf(marked(lines)[0]) <= 11; i++) { panel.handleInput(DOWN); lines = draw(); }
    const item = marked(lines).map(line => line.replace(/^▌\s+/, ''));
    assert.match(item[0], /^\d\. Objective \d$/);
    assert.ok(lines.indexOf(marked(lines)[0]) > 11, `the selected item is in the lower rows of the focused view:\n${lines.join('\n')}`);
    panel.handleInput(ESCAPE);
    lines = draw();
    assert.match(lines.join('\n'), /Request ID/);
    assert.deepEqual(marked(lines).map(line => line.replace(/^▌\s+/, '')), item, `the selected item is whole in the list view:\n${lines.join('\n')}`);
    panel.handleInput('c');
    assert.match(draw().join('\n'), new RegExp(`Comment on Objective ${item[0][0]}: Objective ${item[0][0]}`));
    await close(f, opened);
  });

  test(`${layout.name}: an item clicked in the report is the one kept on screen after escape, not the view enter was pressed in`, async () => {
    const f = fixture(); const opened = await open(f, [older, tallReport('tall', [1, 1, 1, 1, 1, 1])], STATUS); const { panel } = opened;
    const draw = () => layout.draw(f, panel, 60, 18);
    draw();
    panel.handleInput(ENTER);
    let lines = draw();
    const row = lines.findIndex(line => line.includes('2. Objective 2'));
    assert.ok(row > 11, `objective 2 is in the lower rows of the focused view:\n${lines.join('\n')}`);
    for (const kind of ['press', 'click']) panel.handleMouse({ type: kind, button: 'left', x: 8, y: row, screenX: 8, screenY: row, width: 60, height: lines.length });
    assert.match(marked(draw())[0], /2\. Objective 2/);
    panel.handleInput(ESCAPE);
    lines = draw();
    assert.match(lines.join('\n'), /Request ID/);
    assert.deepEqual(marked(lines).map(line => line.replace(/^▌\s+/, '')), ['2. Objective 2', 'Progress:    P2', 'Issues:      - I2.1', 'ETA:         E2'], lines.join('\n'));
    await close(f, opened);
  });

  test(`${layout.name}: after a change of width escape keeps the first visible line and does not return to a line of the old wrapping`, async () => {
    const f = fixture(); const opened = await open(f, [older, tallReport('tall', [3, 3, 3, 3])], STATUS); const { panel } = opened;
    const draw = width => layout.draw(f, panel, width, 18);
    draw(60);
    panel.handleInput(END); draw(60);
    panel.handleInput(ENTER);
    draw(60);
    // Narrower: the labels of the fields stand on lines of their own, so the same offset is another place of a longer report.
    const focused = draw(30);
    assert.match(focused[0], /^── Checkpoint 2 of 2 ─/);
    panel.handleInput(ESCAPE);
    const list = draw(30);
    assert.equal(list[list.findIndex(line => line.startsWith('── Checkpoint 2 ')) + 1], focused[1], `the first visible line stays first:\n${list.join('\n')}`);
    await close(f, opened);
  });

  test(`${layout.name}: leaving the report does not bring back a selected item that was scrolled out of view there`, async () => {
    const f = fixture(); const opened = await open(f, [older, tallReport('tall', [1, 1, 1, 1, 1, 1])], STATUS); const { panel } = opened;
    const draw = () => layout.draw(f, panel, 60, 18);
    draw();
    panel.handleInput(ENTER);
    assert.match(marked(draw())[0], /user:\s+R1/);
    panel.handleInput(END);
    const focused = draw();
    assert.deepEqual(marked(focused), [], 'the selected rule is out of view in the report');
    panel.handleInput(ESCAPE);
    const list = draw();
    assert.deepEqual(marked(list), [], 'and stays out of view in the list');
    assert.equal(list[list.findIndex(line => line.startsWith('── Checkpoint 2 ')) + 1], focused[1], 'the first visible line stays first');
    await close(f, opened);
  });

  test(`${layout.name}: the selected item is held on screen only until the next input: keys and the wheel scroll it away`, async () => {
    const f = fixture(); const opened = await open(f, [older, tallReport('tall', [1, 1, 1, 1, 1, 1])], STATUS); const { panel } = opened;
    const draw = () => layout.draw(f, panel, 60, 18);
    const atEnd = lines => /↑ lines \d+–(\d+) of \1 ──$/.test(lines.find(line => line.startsWith('── Checkpoint 2 ')));
    const leaveReport = () => { panel.handleInput(HOME); draw(); panel.handleInput(ENTER); draw(); panel.handleInput(ESCAPE); return draw(); };
    draw();
    assert.match(marked(leaveReport())[0], /user:\s+R1/, 'back in the list, the selected rule is on screen');
    panel.handleInput(END);
    let lines = draw();
    assert.ok(atEnd(lines), `end shows the end of the report:\n${lines.join('\n')}`);
    assert.deepEqual(marked(lines), [], 'the selected rule is out of view');
    assert.match(marked(leaveReport())[0], /user:\s+R1/);
    panel.handleMouse({ type: 'wheel', button: 'none', wheelDelta: 200, x: 5, y: 9, screenX: 5, screenY: 9, width: 60, height: 18 });
    lines = draw();
    assert.ok(atEnd(lines), `the wheel scrolls to the end of the report:\n${lines.join('\n')}`);
    assert.deepEqual(marked(lines), []);
    await close(f, opened);
  });

  test(`${layout.name}: in a one-row view the cursor does not run ahead of the view, so turning back shows it at once`, async () => {
    const f = fixture(); const opened = await open(f, [tallReport('tall', [1, 1, 1])], STATUS); const { panel } = opened;
    const draw = () => layout.draw(f, panel, 60, 3);
    panel.handleInput(ENTER);
    let lines = draw();
    for (let i = 0; i < 40 && !/▌\s+ETA:\s+E1$/.test(lines[1]); i++) { panel.handleInput(DOWN); lines = draw(); }
    assert.match(lines[1], /^▌\s+ETA:\s+E1$/, 'the one row shows the last line of objective 1, selected');
    const before = lines;
    panel.handleInput(DOWN);
    lines = draw();
    assert.equal(lines[1], '', 'the blank line between two items');
    panel.handleInput(UP);
    assert.deepEqual(draw(), before, 'one press back shows objective 1 with its cursor');
    await close(f, opened);
  });

  test(`${layout.name}: a click selects the item under the pointer while the report is focused`, async () => {
    const f = fixture(); const opened = await open(f, [older, report]); const { panel } = opened;
    panel.handleInput(ENTER);
    const draw = () => layout.draw(f, panel, 100, 30);
    const lines = draw();
    assert.match(lines[0], /^── Cuckoo checkpoint 2 of 2 /, 'the report is focused: its header is one row');
    const click = row => { for (const kind of ['press', 'click']) panel.handleMouse({ type: kind, button: 'left', x: 10, y: row, screenX: 10, screenY: row, width: 100, height: lines.length }); };
    const selected = () => marked(draw()).map(line => line.trim().split(/\s+/).slice(1, 3).join(' '))[0];
    // The first and the last row of an item select it; the rows around it do not.
    const first = lines.findIndex(line => line.includes('2. Write docs'));
    const last = lines.findIndex(line => /ETA:\s+Unknown$/.test(line));
    assert.ok(first > 0 && last === first + 3, lines.join('\n'));
    click(first);
    assert.equal(selected(), '2. Write');
    click(first - 2);
    assert.equal(selected(), '1. Ship', 'the row above the blank line belongs to the previous item');
    click(last);
    assert.equal(selected(), '2. Write');
    click(first - 2); click(last + 1);
    assert.equal(selected(), '1. Ship', 'the blank line under an item selects nothing');
    await close(f, opened);
  });
}

test('the list header is compact and the report has a fixed title with its scroll position', async () => {
  const reports = Array.from({ length: 8 }, (_, index) => tallReport(`req-${index + 1}`, [4, 4, 4]));
  const f = fixture(); const opened = await open(f, reports, STATUS); const { panel } = opened;
  const draw = () => settle(f, panel, 80, 22);
  let lines = draw();
  assert.match(lines[0], /^── Cuckoo objectives and progress · 1–3 of 8 ─+$/, 'the list position is in the pane title');
  assert.match(lines[1], /^\s+# │ Request ID/, 'no blank row under the title');
  assert.match(lines[3], /^▌\s+8 │ req-8/);
  assert.match(lines[5], /^\s+6 │ req-6/);
  assert.match(lines[6], /^── Checkpoint 8 ─+ lines 1–\d+ of \d+ ↓ ──$/, 'the report title follows the table');
  assert.match(lines[7], /^req-8 · 3 objectives · saved self-report, not live verification$/, 'the report starts with its metadata line');
  assert.equal(lines[8], '');
  assert.match(lines[9], /Session-local rules/);
  assert.ok(lines.every(line => visibleWidth(line) <= 80));
  // The position counts the report rows on screen: all rows but the 7 of the header and the hint lines.
  const shown = 22 - 7 - (lines.length - lines.findIndex(line => line.startsWith('↑↓ ')));
  const total = Number(lines[6].match(/of (\d+)/)[1]);
  assert.ok(shown >= 10 && total > 2 * shown, `${shown} of ${total} rows`);
  assert.match(lines[6], new RegExp(` lines 1–${shown} of ${total} ↓ ──$`));

  panel.handleInput(PAGE_DOWN);
  const half = Math.floor(shown / 2);
  assert.match(draw()[6], new RegExp(`^── Checkpoint 8 ─+ ↑ lines ${half + 1}–${half + shown} of ${total} ↓ ──$`));
  panel.handleInput(END);
  assert.match(draw()[6], new RegExp(`^── Checkpoint 8 ─+ ↑ lines ${total - shown + 1}–${total} of ${total} ──$`), 'no arrow where nothing is hidden');
  panel.handleInput(HOME);
  assert.match(draw()[6], new RegExp(` lines 1–${shown} of ${total} ↓ ──$`));

  for (let i = 0; i < 4; i++) panel.handleInput(DOWN);
  lines = draw();
  assert.match(lines[0], /· 3–5 of 8 ─/, 'the title follows the table window');
  assert.match(lines[5], /^▌\s+4 │ req-4/);
  assert.match(lines[6], /^── Checkpoint 4 ─/);
  panel.handleInput(ENTER);
  lines = draw();
  // The table's 6 rows go to the report, and the hints of the focused report fit one line.
  assert.match(lines[0], new RegExp(`^── Cuckoo checkpoint 4 of 8 ─+ lines 1–${22 - 2} of ${total} ↓ ──$`));
  assert.match(lines[1], /^req-4 · 3 objectives/);
  assert.equal(hints(lines), '↑↓ item  PgUp/PgDn page  c comment  i inquire now  esc back');
  await close(f, opened);

  // A report that fits shows no position, and a table that fits shows none either.
  const short = fixture(); short.resize(60); const fits = await open(short, [older, report]);
  lines = fits.panel.render(100);
  assert.match(lines[0], /^── Cuckoo objectives and progress ─+$/);
  assert.match(lines[5], /^── Checkpoint 2 ─+$/);
  fits.panel.handleInput(ENTER);
  assert.match(fits.panel.render(100)[0], /^── Cuckoo checkpoint 2 of 2 ─+$/);
  await close(short, fits);
});

// The layout engine clamps the scroll position after the header was drawn; the title must not show the stale one.
test('the position in the title stays within the report when the report gets shorter at its end', async () => {
  const f = fixture(); const opened = await open(f, [tallReport('tall', [3, 3, 3])], STATUS); const { panel } = opened;
  const draw = () => settle(f, panel, 100, 12);
  const position = lines => lines[0].match(/(↑ )?lines (\d+)–(\d+) of (\d+)( ↓)?/).slice(1).map(part => part === undefined ? '' : part.trim());
  const reportRows = lines => lines.findIndex(line => /\d new comments?:|New comment removed/.test(line)) - 1;
  panel.handleInput(ENTER); draw();
  for (let i = 0; i < 4; i++) { panel.handleInput(DOWN); draw(); }
  panel.handleInput('c'); type(panel, 'first'); panel.handleInput(ENTER);
  panel.handleInput('c'); type(panel, 'second'); panel.handleInput(ENTER);
  draw();
  panel.handleInput(END);
  let lines = draw();
  const rows = reportRows(lines);
  const total = Number(position(lines)[3]);
  assert.deepEqual(position(lines), ['↑', String(total - rows + 1), String(total), String(total), ''], 'the view is at the end');
  panel.handleInput('x');
  lines = draw();
  assert.match(lines.join('\n'), /New comment removed/);
  assert.equal(reportRows(lines), rows, 'the view kept its height, so the layout engine asks for no second frame');
  assert.deepEqual(position(lines), ['↑', String(total - rows), String(total - 1), String(total - 1), ''], lines[0]);
  await close(f, opened);
});

// A host that sizes the pane to its content makes the pane shorter while the table is hidden; that height must not decide the table's rows.
test('content-sized pane: after enter and escape on a short report the table has its rows and its window back', async () => {
  const empty = index => checkpoint(`req-${index}`, '{"objectives":[],"rules":[]}');
  const f = fixture(); const opened = await open(f, [1, 2, 3, 4, 5].map(empty)); const { panel } = opened;
  const host = contentSized(f, panel);
  host.draw(80, 42);
  panel.handleInput(DOWN);
  const list = host.draw(80, 42);
  assert.match(list[0], /^── Cuckoo objectives and progress · 1–3 of 5 ─+$/);
  assert.deepEqual(list.slice(3, 6).map(line => line.replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ')), ['5 │', '▌ 4', '3 │']);
  panel.handleInput(ENTER);
  const focused = host.draw(80, 42);
  assert.match(focused[0], /^── Cuckoo checkpoint 4 of 5 ─+$/);
  assert.ok(focused.length < list.length - 4, 'the pane is shorter without its table: the report fits');
  panel.handleInput(ESCAPE);
  assert.deepEqual(host.draw(80, 42), list, 'the list frame is as it was');
  await close(f, opened);
});

// The count kept while the table is hidden is from the terminal as it was then.
test('content-sized pane: a table that returns after the terminal grew gets the rows that fit now', async () => {
  const empty = index => checkpoint(`req-${index}`, '{"objectives":[],"rules":[]}');
  const f = fixture(); const opened = await open(f, [1, 2, 3, 4, 5].map(empty)); const { panel } = opened;
  const host = contentSized(f, panel);
  let lines = host.draw(80, 13);
  assert.match(lines[0], /^── Cuckoo objectives and progress · 1–1 of 5 ─+$/, `eleven rows leave the table one row:\n${lines.join('\n')}`);
  panel.handleInput(ENTER);
  host.draw(80, 13);
  lines = host.draw(80, 42);
  assert.match(lines[0], /^── Cuckoo checkpoint 5 of 5 ─+$/, 'the report fits the taller terminal');
  panel.handleInput(ESCAPE);
  lines = host.draw(80, 42);
  assert.match(lines[0], /^── Cuckoo objectives and progress · 1–3 of 5 ─+$/, lines.join('\n'));
  assert.match(lines[5], /^\s+3 │ req-3/);
  await close(f, opened);
});

// Pi scrolls a scroll view itself in some cases (a wheel that reaches no component, a selection dragged past the edge).
test('allocated layout: once the list view has its place after escape, scrolling the report directly is not undone', async () => {
  const f = fixture(); const opened = await open(f, [older, tallReport('tall', [1, 1, 1, 1, 1, 1])], STATUS); const { panel } = opened;
  const draw = () => settle(f, panel, 60, 18);
  const title = lines => lines.find(line => line.startsWith('── Checkpoint 2 '));
  draw();
  // The selected item was brought back into the shorter view.
  panel.handleInput(ENTER);
  let lines = draw();
  for (let i = 0; i < 20 && lines.indexOf(marked(lines)[0]) <= 11; i++) { panel.handleInput(DOWN); lines = draw(); }
  panel.handleInput(ESCAPE);
  lines = draw();
  assert.ok(marked(lines).length > 0 && / ↑ lines /.test(title(lines)), lines.join('\n'));
  panel.bodyScroll.scrollToStart();
  lines = draw();
  assert.match(title(lines), / lines 1–\d+ of /, 'the report stays where it was scrolled to');
  assert.deepEqual(marked(lines), [], 'the selected item is not brought back a second time');
  // The view returned to where enter was pressed.
  panel.handleInput(END); draw();
  panel.handleInput(ENTER); draw();
  panel.handleInput(ESCAPE);
  lines = draw();
  assert.match(title(lines), /↑ lines \d+–(\d+) of \1 ──$/, 'back at the end');
  panel.bodyScroll.scrollBy(-5);
  const moved = draw();
  assert.doesNotMatch(title(moved), /lines \d+–(\d+) of \1 ──$/, 'the report stays where it was scrolled to');
  assert.deepEqual(draw(), moved);
  await close(f, opened);
});

// A report that fits both views leaves the height as it is, so nothing is due after escape; what was pending must not act later.
for (const [name, input] of [
  ['a key', panel => panel.handleInput(HOME)],
  ['the wheel', panel => panel.handleMouse({ type: 'wheel', button: 'none', wheelDelta: -3, x: 5, y: 9, screenX: 5, screenY: 9, width: 60, height: 30 })],
]) {
  test(`content-sized pane: ${name} after escape ends what escape left pending, also when the view gets shorter only later`, async () => {
    const f = fixture(); const opened = await open(f, [older, tallReport('tall', [0, 0, 0])]); const { panel } = opened;
    const host = contentSized(f, panel);
    host.draw(60, 60);
    panel.handleInput(ENTER);
    let lines = host.draw(60, 60);
    for (let i = 0; i < 10 && !/3\. Objective 3/.test(marked(lines)[0] ?? ''); i++) { panel.handleInput(DOWN); lines = host.draw(60, 60); }
    assert.match(marked(lines)[0], /3\. Objective 3/);
    assert.doesNotMatch(lines[0], /lines \d+–/, 'the report fits');
    panel.handleInput(ESCAPE);
    lines = host.draw(60, 60);
    assert.match(lines.join('\n'), /Request ID/);
    assert.doesNotMatch(lines.find(line => line.startsWith('── Checkpoint 2 ')), /lines \d+–/, 'the report fits the list view too');
    input(panel);
    // Now the terminal gets shorter: the view stays at the top, although that hides the selected item.
    lines = host.draw(60, 20);
    assert.match(lines.find(line => line.startsWith('── Checkpoint 2 ')), / lines 1–\d+ of \d+ ↓ ──$/, lines.join('\n'));
    assert.deepEqual(marked(lines), []);
    await close(f, opened);
  });
}

// A notice stands where the count of new comments was. Clearing it with the key that also moves the view must not take a row from the view.
test('allocated layout: an arrow pressed while a notice is shown skips no line', async () => {
  const f = fixture(); const opened = await open(f, [tallReport('tall', [0, 9], 2)], STATUS); const { panel } = opened;
  const draw = () => settle(f, panel, 60, 16);
  const reportRows = lines => lines.findIndex(line => /new comments?:|New comment removed/.test(line)) - 1;
  panel.handleInput(ENTER); draw();
  // Put the answer under the cursor at the top of the view, with two new comments on it.
  for (let i = 0; i < 40 && !/^▌ Q1\. /.test(draw()[1] ?? ''); i++) panel.handleInput(DOWN);
  for (const text of ['first', 'second']) { panel.handleInput('c'); draw(); type(panel, text); panel.handleInput(ENTER); draw(); }
  let lines = draw();
  assert.match(lines[1], /^▌ Q1\. What did you verify\?/, lines.join('\n'));
  assert.match(lines.join('\n'), /\n2 new comments: [^\n]+\n[^\n]*panel closes\n/, 'at this width the count takes two rows');
  const rows = reportRows(lines);
  panel.handleInput('x');
  lines = draw();
  assert.match(lines.join('\n'), /New comment removed\./);
  assert.equal(reportRows(lines), rows, 'the notice keeps the rows of the line it stands in for');
  panel.handleInput(UP);
  lines = draw();
  assert.equal(reportRows(lines), rows);
  // The previous item is taller than the view and two lines lie in between: the step is one whole view, which must still show them.
  assert.match(lines.at(reportRows(lines)), /Standing questions/, `the heading above the answer is the last row of the view:\n${lines.join('\n')}`);
  await close(f, opened);
});

test('at narrow widths the report title keeps the checkpoint and gives up the pane name, then the position', async () => {
  const reports = [older, older, older, tallReport('tall', [6, 6])];
  const f = fixture(); f.resize(20); const opened = await open(f, reports, STATUS); const { panel } = opened;
  // The pane title likewise drops the list position whole instead of cutting it.
  assert.match(panel.render(60)[0], /^── Cuckoo objectives and progress · 1–3 of 4 ─+$/);
  assert.match(panel.render(40)[0], /^── Cuckoo objectives and progress ─+$/);
  assert.doesNotMatch(panel.render(40).join('\n'), /·…|of 4/);
  panel.handleInput(ENTER); panel.handleInput(PAGE_DOWN);
  const title = width => { const line = panel.render(width)[0]; assert.ok(visibleWidth(line) <= width, `${width}: ${line}`); return line; };
  assert.match(title(70), /^── Cuckoo checkpoint 4 of 4 ─+ ↑ lines \d+–\d+ of \d+ ↓ ──$/);
  assert.match(title(50), /^── Checkpoint 4 of 4 ─+ ↑ lines \d+–\d+ of \d+ ↓ ──$/, 'the pane name goes first');
  assert.match(title(40), /^── Cuckoo checkpoint 4 of 4 ─+$/, 'then the position, and the full title returns');
  assert.match(title(30), /^── Checkpoint 4 of 4 ─+$/);
  panel.handleInput(ESCAPE);
  assert.match(panel.render(30).find(line => line.startsWith('── Checkpoint')), /^── Checkpoint 4 ─+$/);
  await close(f, opened);
});

test('the table folds away while a comment is written from the list and returns afterwards', async () => {
  const f = fixture(); f.resize(24); const opened = await open(f, [older, tallReport('tall', [4, 4])], STATUS); const { panel } = opened;
  const rowsOfReport = lines => lines.filter(line => /^(▌ |  )\s*(\d+\. Objective|Progress:|Issues:|ETA:|- I\d|(user|assistant):)/.test(line)).length;
  panel.handleInput(TAB); panel.handleInput(TAB); panel.handleInput(TAB);
  const before = panel.render(80);
  assert.match(before.join('\n'), /Request ID/);
  panel.handleInput('c'); type(panel, 'a note');
  let lines = panel.render(80);
  assert.ok(lines.length <= 24);
  assert.doesNotMatch(lines.join('\n'), /Request ID|─┼─/, 'the table is hidden while writing');
  assert.match(lines[0], /^── Cuckoo checkpoint 2 of 2 ─/);
  assert.match(lines[1], /^▌ 1\. Objective 1$/, 'the commented item is at the top of the view');
  assert.match(lines.join('\n'), /Comment on Objective 1: Objective 1/);
  assert.ok(rowsOfReport(lines) >= rowsOfReport(before), `the report keeps its rows while writing: ${rowsOfReport(lines)} after ${rowsOfReport(before)}`);
  panel.handleInput(ENTER);
  lines = panel.render(80);
  assert.match(lines.join('\n'), /Request ID/, 'the list is back: it was focused when the comment was started');
  assert.match(hints(lines), /^↑↓ select .*x remove new comment.* esc close$/);
  // From the focused report the pane stays in the report after the comment.
  panel.handleInput(ENTER); panel.handleInput('c'); type(panel, 'another'); panel.handleInput(ENTER);
  lines = panel.render(80);
  assert.doesNotMatch(lines.join('\n'), /Request ID/);
  assert.match(hints(lines), /^↑↓ item .* esc back$/);
  panel.handleInput('c'); panel.handleInput(ESCAPE);
  assert.equal(f.views[0].closed, false);
  assert.match(hints(panel.render(80)), /esc back$/, 'escape discards the draft first, then leaves the report, then closes');
  panel.handleInput(ESCAPE);
  assert.match(hints(panel.render(80)), /esc close$/);
  panel.handleInput(ESCAPE); await opened.showing; opened.view.dispose(f.ctx);
  assert.deepEqual(f.savedCalls.map(call => call.map(item => item.text)), [['a note', 'another']]);
});

test('a checkpoint without items offers no item keys; in its focused report the arrows scroll by line', async () => {
  const raw = Array.from({ length: 40 }, (_, index) => `raw line ${index + 1}`).join('\n');
  const f = fixture(); f.resize(20); const opened = await open(f, [report, checkpoint('bad', raw)]); const { panel } = opened;
  let lines = panel.render(80);
  assert.equal(hints(lines), '↑↓ select  ⏎ detail  PgUp/PgDn scroll detail  i inquire now  esc close');
  panel.handleInput(ENTER);
  lines = panel.render(80);
  assert.equal(hints(lines), '↑↓ scroll  PgUp/PgDn page  i inquire now  esc back');
  assert.match(lines[0], /^── Cuckoo checkpoint 2 of 2 ─+ lines 1–\d+ of \d+ ↓ ──$/);
  const top = () => Number(panel.render(80)[0].match(/lines (\d+)–/)[1]);
  panel.handleInput(DOWN); panel.handleInput(DOWN); panel.handleInput('j');
  assert.equal(top(), 4);
  panel.handleInput(UP); panel.handleInput('k');
  assert.equal(top(), 2);
  assert.deepEqual(marked(panel.render(80)), []);
  panel.handleInput(ESCAPE); panel.handleInput(DOWN);
  assert.match(hints(panel.render(80)), /tab\/shift-tab item  c comment/, 'the checkpoint with items offers them again');
  await close(f, opened);

  const empty = fixture(); const none = await open(empty, []);
  assert.equal(hints(none.panel.render(80)), 'i inquire now  esc close');
  none.panel.handleInput(ENTER); none.panel.handleInput(DOWN);
  lines = none.panel.render(80);
  assert.match(lines.join('\n'), /No Cuckoo reports/); assert.equal(hints(lines), 'i inquire now  esc close', 'there is no report to focus');
  none.panel.handleInput(ESCAPE); await none.showing; none.view.dispose(empty.ctx);
  assert.equal(empty.views[0].closed, true);
});

test('history uses the same navigation and names its answers', async () => {
  const entry = (id, timestamp, data) => ({ type: 'custom', id, parentId: null, timestamp, customType: REPORT_TYPE, data });
  const entries = [entry('entry-1', '2026-11-20T10:00:00Z', structuredClone(older)), entry('entry-2', '2026-11-21T10:00:00Z', structuredClone(report))];
  const f = fixture(); const view = new CuckooView(() => assert.fail('no inquiry was requested'), f.host, clock);
  const showing = view.showHistory(f.ctx, entries, [entries[1]]); await tick();
  const panel = f.views[0].component;
  let lines = panel.render(140);
  assert.match(lines[0], /^── Cuckoo answer history ─+$/);
  assert.match(lines.find(line => line.startsWith('── Answer')), /^── Answer 2 ─+$/);
  assert.match(lines.join('\n'), /\nreq-1 · 2026-11-21T10:00:00Z · current branch · entry entry-2 · 2 objectives · saved self-report, not live verification\n/);
  panel.handleInput(ENTER);
  lines = panel.render(140);
  assert.match(lines[0], /^── Cuckoo answer 2 of 2 ─+$/);
  assert.match(marked(lines)[0], /Show mockups first/);
  panel.handleInput(ESCAPE); panel.handleInput(DOWN); panel.handleInput(ENTER);
  lines = panel.render(140);
  assert.match(lines[0], /^── Cuckoo answer 1 of 2 ─+$/);
  assert.match(lines[1], /^req-0 · 2026-11-20T10:00:00Z · other branch · entry entry-1 · 1 objective · /);
  panel.handleInput(ESCAPE); panel.handleInput(ESCAPE); await showing; view.dispose(f.ctx);
  assert.equal(f.views[0].closed, true);
});

// The real key path and layout engine of Pi's fullscreen mode: the focused pane takes Enter, the arrows and Escape.
test('fullscreen: enter folds the table, the arrows walk the report instead of the chat, escape brings the table back', async () => {
  let sendKey;
  const terminal = { columns: 80, rows: 24, kittyProtocolActive: false, start(onInput) { sendKey = onInput; }, stop() {}, write() {}, hideCursor() {}, showCursor() {} };
  const tui = new TuiAltScreen(terminal);
  const transcript = new ScrollView({ render: () => Array.from({ length: 100 }, (_, i) => `Chat row ${i + 1}`), invalidate() {} }, { follow: 'end', primary: true });
  const layout = new VStack([{ component: transcript, grow: 1 }]);
  const f = fixture();
  let closed = false;
  f.ctx.ui.custom = factory => new Promise(resolve => {
    const panel = factory(tui, theme, keys, () => { closed = true; layout.removeChild(panel); tui.setFocus(transcript); resolve(); });
    layout.addChild(panel, { shrink: 0 });
    tui.setFocus(panel);
  });
  const view = new CuckooView(() => assert.fail('no inquiry was requested'), f.host, clock);
  const screen = () => { tui.renderNow(); tui.renderNow(); return tui.getScreenLines().map(line => line.replace(/\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g, '').trimEnd()); };
  const press = data => { sendKey(data); return screen(); };
  tui.setLayoutRoot(layout);
  tui.start();
  try {
    const showing = view.showReports(f.ctx, [older, tallReport('tall', [0, 12, 0])], STATUS, EMPTY_SET);
    const list = screen();
    const tableRow = list.findIndex(line => /Request ID/.test(line));
    assert.ok(tableRow > 0, list.join('\n'));
    let lines = press(ENTER);
    assert.ok(!lines.some(line => /Request ID/.test(line)), lines.join('\n'));
    const title = lines.findIndex(line => line.startsWith('── Cuckoo checkpoint 2 of 2 '));
    assert.equal(title, tableRow - 1, 'the pane keeps its place on the screen; its title replaces the pane title');
    assert.match(lines[title], / lines 1–\d+ of \d+ ↓ ──$/);
    assert.match(lines.find(line => line.startsWith('▌ ')), /user:\s+R1/);
    lines = press(DOWN); lines = press(DOWN); lines = press(DOWN);
    assert.match(lines.find(line => line.startsWith('▌ ')), /^▌ 2\. Objective 2$/);
    assert.ok(lines.slice(0, title).every(line => line === list[0] || /^Chat row \d+$/.test(line) || line === ''), 'the chat above the pane did not scroll');
    assert.deepEqual(lines.slice(0, title), list.slice(0, title));
    lines = press(ESCAPE);
    assert.equal(closed, false, 'escape left the report, not the pane');
    assert.ok(lines.some(line => /Request ID/.test(line)), 'the table is back');
    assert.ok(lines.some(line => line.startsWith('── Checkpoint 2 ')));
    lines = press(ESCAPE);
    await showing;
    assert.equal(closed, true);
    assert.match(lines.join('\n'), /Chat row 100\b/);
    assert.ok(!lines.some(line => /Cuckoo/.test(line)), 'the pane is closed');
  } finally {
    view.dispose(f.ctx);
    tui.stop();
  }
});
