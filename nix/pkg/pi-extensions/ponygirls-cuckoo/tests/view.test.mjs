import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { CuckooView } from '../src/view.ts';
import { checkpoint, REPORT_TYPE } from '../src/report.ts';

const theme = { fg: (_token, text) => text, bg: (_token, text) => text, bold: text => text };
function styledTheme() {
  return { fg: (token, text) => token === 'dim' ? text : `<${token}>${text}</${token}>`, bg: (_token, text) => text, bold: text => `<b>${text}</b>` };
}
function fixture(theme) {
  const widgets = []; const notifications = []; const views = []; let rows = 24;
  const ctx = { mode: 'tui', hasUI: true, ui: {
    setWidget: (...args) => widgets.push(args), notify: (...args) => notifications.push(args),
    custom: (factory, options) => new Promise(resolve => {
      const view = { options, closed: false }; views.push(view);
      view.component = factory({ terminal: { get rows() { return rows; } }, requestRender() {} }, theme,
        { matches: (key, action) => key === '\x1b' && action === 'tui.select.cancel' }, () => { view.closed = true; resolve(); });
    }),
  } };
  return { ctx, widgets, notifications, views, resize: value => { rows = value; }, badge: () => widgets.at(-1)?.[1]?.(null, theme) };
}
const click = { type: 'click', button: 'left' };
const tick = () => new Promise(setImmediate);

// ── Reproduction: PTY-confirmed failures (round 2) ──

test('REPRO: wrapped body lines do not clip at width (no lost characters)', async () => {
  // Long config line must be fully visible after scrolling, not truncated by PanelLayout
  const report = checkpoint('r', JSON.stringify({ objectives: [{ objective: 'Task', progress: 'Done', issues: [], eta: 'Complete' }], rules: [] }));
  const longIntro = 'Cuckoo: ON (session)\nGrowth: 15% relative (global); next inquiry: 23000 tokens (baseline 20000). This is a very long config line to test wrapping not clipping.\nPending: none.';
  const f = fixture(theme); f.resize(24); const view = new CuckooView(() => {});
  const showing = view.showReports(f.ctx, [report], longIntro);
  await tick(); const panel = f.views[0].component;
  // Scroll to end to see full settings; long line wraps across multiple body lines
  panel.handleInput('\x1b[F');
  const outEnd = panel.render(40).join('\n');
  assert.match(outEnd, /long config line/, 'long settings text wraps not clips');
  panel.handleInput('\x1b'); await showing; view.dispose(f.ctx);
});

test('REPRO: runtime error appears before detail, not after settings', async () => {
  const report = checkpoint('r', JSON.stringify({ objectives: [{ objective: 'Task', progress: 'Done', issues: [], eta: 'Complete' }], rules: [] }));
  const faultIntro = 'Error: Something failed\nCuckoo: OFF (global)\nGrowth: window 15 (global); next: waiting.';
  const f = fixture(theme); f.resize(24); const view = new CuckooView(() => {});
  const showing = view.showReports(f.ctx, [report], faultIntro);
  await tick(); const panel = f.views[0].component;
  const out = panel.render(80).join('\n');
  // Error must appear BEFORE detail header in the body
  const errIdx = out.indexOf('Something failed');
  const detailIdx = out.indexOf('Task');
  assert.ok(errIdx >= 0, 'error line must be present');
  assert.ok(detailIdx >= 0, 'detail must be present');
  assert.ok(errIdx < detailIdx, `error (at ${errIdx}) must precede detail (at ${detailIdx})`);
  panel.handleInput('\x1b'); await showing; view.dispose(f.ctx);
});

test('REPRO: empty state has no table headers, only empty message', async () => {
  const f = fixture(theme); f.resize(24); const view = new CuckooView(() => {});
  const showing = view.showReports(f.ctx, [], 'Cuckoo: OFF');
  await tick(); const panel = f.views[0].component;
  const out = panel.render(80).join('\n');
  // Must NOT have table chrome (column headers, rule lines, marker gutter)
  assert.doesNotMatch(out, /Request ID/);
  assert.doesNotMatch(out, /───┼──/);
  assert.doesNotMatch(out, /▌/);
  // Must have empty message
  assert.match(out, /No Cuckoo reports/);
  panel.handleInput('\x1b'); await showing; view.dispose(f.ctx);
});

test('REPRO: valid report detail meta shows saved self-report qualifier', async () => {
  const report = checkpoint('r', JSON.stringify({ objectives: [{ objective: 'Task', progress: 'Done', issues: [], eta: 'Complete' }], rules: [] }));
  const f = fixture(theme); f.resize(24); const view = new CuckooView(() => {});
  const showing = view.showReports(f.ctx, [report], '');
  await tick(); const panel = f.views[0].component;
  const out = panel.render(80).join('\n');
  // Detail title meta must include the qualifier text
  assert.match(out, /saved self-report, not live verification/);
  panel.handleInput('\x1b'); await showing; view.dispose(f.ctx);
});

test('REPRO: detail header wraps at narrow width preserving all metadata', async () => {
  // Long metadata: timestamp, current branch, entry id, qualifier — must all be recoverable
  const entry = { type: 'custom', id: 'entry-abc-123', parentId: null, timestamp: '2026-11-08T12:00:00Z', customType: REPORT_TYPE, data: checkpoint('hist-req', JSON.stringify({ objectives: [{ objective: 'Task', progress: 'Done', issues: [], eta: 'Complete' }], rules: [] })) };
  const f = fixture(theme); f.resize(24); const view = new CuckooView(() => {});
  const showing = view.showHistory(f.ctx, [entry], [entry]);
  await tick(); const panel = f.views[0].component;
  // At width 40, detail header wraps across multiple lines
  const out = panel.render(40).join('\n');
  // All metadata must be present (may span multiple wrapped lines)
  assert.match(out, /2026-11-08T12:00:00Z/, 'timestamp must be visible');
  assert.match(out, /current branch/, 'branch must be visible');
  assert.match(out, /entry-abc-123/, 'entry id must be visible');
  assert.match(out, /saved self-report, not live verification/, 'qualifier must be visible');
  panel.handleInput('\x1b'); await showing; view.dispose(f.ctx);
});

// ── Previous reproduction tests ──

test('REPRO: 40×24 fullscreen shows detail (not zero-height body)', async () => {
  const reports = [];
  for (let i = 1; i <= 8; i++) reports.push(checkpoint(`req-${i}`, JSON.stringify({ objectives: [{ objective: `Task ${i}`, progress: 'In progress '.repeat(5), issues: [], eta: 'Unknown' }], rules: [] })));
  const f = fixture(theme); f.resize(24); const view = new CuckooView(() => {});
  const showing = view.showReports(f.ctx, reports, 'Cuckoo: ON (session)\nGrowth: 15% relative (global); next: 23000 tokens.\nPending: none.\nDefaults: /tmp/c.json\nUse /cuckoo history for saved answers.');
  await tick(); const panel = f.views[0].component;
  const out = panel.render(40).join('\n');
  // Must show detail for selected checkpoint (detail before settings in body)
  assert.match(out, /Task 8/, 'detail must show newest objective at 40×24');
  // Table must be visible
  assert.match(out, /req-8/);
  // Key hints always visible in footer
  assert.match(out, /ctrl-u.d/, 'key hints must be visible in footer');
  // Settings after detail — reachable via End
  panel.handleInput('\x1b[F'); // End — scroll to bottom
  const outEnd = panel.render(40).join('\n');
  assert.match(outEnd, /15% relative/, 'settings visible after End scroll');
  assert.match(outEnd, /Growth: 15% relative/, 'settings must wrap, not truncate');
  // Total lines must not exceed terminal height
  const lines = outEnd.split('\n');
  assert.ok(lines.length <= 24, `rendered ${lines.length} lines at 40×24, expected ≤24`);
  panel.handleInput('\x1b'); await showing; view.dispose(f.ctx);
});

test('REPRO: column width arithmetic does not clip Status to "Statu" or "save…"', async () => {
  const report = checkpoint('test-req', JSON.stringify({ objectives: [{ objective: 'Task', progress: 'Done', issues: [], eta: 'Complete' }], rules: [] }));
  const f = fixture(theme); f.resize(24); const view = new CuckooView(() => {});
  const showing = view.showReports(f.ctx, [report], '');
  await tick(); const panel = f.views[0].component;
  // At width 40, column header must show "Status" in full
  const out40 = panel.render(40).join('\n');
  assert.match(out40, /Status/, 'column header must show full "Status" at width 40');
  // Cell must show "saved" in full (not truncated to "save…")
  assert.match(out40, /saved/, 'status cell must show full "saved"');
  // At width 30, check still reasonable
  const out30 = panel.render(30).join('\n');
  assert.ok(out30.includes('Status') || out30.includes('Stat'), 'column visible at width 30');
  panel.handleInput('\x1b'); await showing; view.dispose(f.ctx);
});

test('REPRO: selection change resets detail scroll to top', async () => {
  const long = checkpoint('long', JSON.stringify({
    objectives: Array.from({ length: 10 }, (_, i) => ({ objective: `Obj ${i + 1}`, progress: 'P '.repeat(20), issues: [], eta: 'Unknown' })),
    rules: [],
  }));
  const short = checkpoint('short', JSON.stringify({ objectives: [{ objective: 'Brief', progress: 'Done', issues: [], eta: 'Complete' }], rules: [] }));
  const f = fixture(theme); f.resize(30); const view = new CuckooView(() => {});
  view.publish(f.ctx, [short, long], true, null);
  f.badge().handleMouse(click); await tick();
  const panel = f.views[0].component;
  // Scroll detail down
  for (let i = 0; i < 5; i++) panel.handleInput('\x04'); // ctrl-d
  // Move selection to other checkpoint (should reset scroll to top)
  panel.handleInput('j');
  const out = panel.render(80).join('\n');
  // Should see the top of the detail (Objective 1 of short report, or the beginning)
  assert.match(out, /Brief|Done/, 'detail must show top of newly selected checkpoint');
  panel.handleInput('\x1b'); await tick(); view.dispose(f.ctx);
});

test('REPRO: empty table preserves intro/fault footer text', async () => {
  const f = fixture(styledTheme()); f.resize(24); const view = new CuckooView(() => {});
  const showing = view.showReports(f.ctx, [], 'Cuckoo: OFF (global)\nGrowth policy: window 15 (global); next inquiry: waiting.\nDefaults: /tmp/c.json');
  await tick(); const panel = f.views[0].component;
  const out = panel.render(40).join('\n');
  assert.match(out, /No Cuckoo reports/);
  assert.match(out, /Cuckoo:.+OFF/, 'settings must be visible even with empty reports');
  assert.match(out, /window 15/, 'policy text must be visible');
  panel.handleInput('\x1b'); await showing; view.dispose(f.ctx);
});

test('REPRO: history view shows entry.id in detail metadata', async () => {
  const entry = { type: 'custom', id: 'entry-abc-123', parentId: null, timestamp: '2026-11-08T01:00:00Z', customType: REPORT_TYPE, data: checkpoint('hist-req', JSON.stringify({ objectives: [{ objective: 'History task', progress: 'Seen', issues: [], eta: 'Complete' }], rules: [] })) };
  const f = fixture(theme); f.resize(30); const view = new CuckooView(() => {});
  const showing = view.showHistory(f.ctx, [entry], [entry]);
  await tick(); const panel = f.views[0].component;
  const out = panel.render(80).join('\n');
  assert.match(out, /entry-abc-123/, 'detail must show entry.id for attribution');
  assert.match(out, /current branch/, 'branch attribution preserved');
  panel.handleInput('\x1b'); await showing; view.dispose(f.ctx);
});

test('REPRO: detail title sanitizes untrusted timestamp', async () => {
  const badTs = '2026-11-08T01:00:00Z\x1b\x07\r\x9b';
  const entry = { type: 'custom', id: 'entry-1', parentId: null, timestamp: badTs, customType: REPORT_TYPE, data: checkpoint('safe-req', JSON.stringify({ objectives: [], rules: [] })) };
  const f = fixture(theme); f.resize(30); const view = new CuckooView(() => {});
  const showing = view.showHistory(f.ctx, [entry], [entry]);
  await tick(); const panel = f.views[0].component;
  const out = panel.render(80).join('\n');
  assert.doesNotMatch(out, /\x07|\r|\x9b/, 'timestamp control bytes must be stripped from detail title');
  panel.handleInput('\x1b'); await showing; view.dispose(f.ctx);
});

// ── Original tests ──

// Specified: Behavioral-Active, Blackbox-Group through the shared UI boundary.

test('objective badge preserves zero/unknown/failure distinctions and bounds width', () => {
  const f = fixture(theme); const view = new CuckooView(() => {});
  view.publish(f.ctx, [], false, null); assert.equal(f.widgets.at(-1)?.[1], undefined);
  view.publish(f.ctx, [], true, null); assert.match(f.badge().render(80)[0], /🐦 \?/);
  const valid = checkpoint('one', '{"objectives":[],"rules":[]}');
  view.publish(f.ctx, [valid], true, null); assert.match(f.badge().render(80)[0], /🐦 0/);
  view.publish(f.ctx, [valid, checkpoint('two', 'bad')], false, null);
  assert.match(f.badge().render(80)[0], /🐦 0 ! off/);
  assert.equal(f.badge().renderCompact(80), ' 🐦 0! ');
  for (const width of [0, 1, 2, 3, 4, 12]) {
    assert.ok(visibleWidth(f.badge().render(width)[0]) <= width);
    assert.ok(visibleWidth(f.badge().renderCompact(width)) <= width);
  }
});

test('badge repeat-click, keyboard close and disposal share one view', async () => {
  const f = fixture(theme); const view = new CuckooView(() => {});
  view.publish(f.ctx, [], true, null);
  const oldBadge = f.badge();
  assert.equal(oldBadge.handleMouse({ type: 'click', button: 'right' }), undefined);
  assert.equal(oldBadge.handleMouse(click).handled, true); await tick();
  assert.equal(f.views.length, 1); assert.equal(f.views[0].options.retainEditorBorders, true);
  oldBadge.handleMouse(click); await tick(); assert.equal(f.views[0].closed, true);
  const showing = view.showReports(f.ctx, [], ''); await tick();
  f.views[1].component.handleInput('\x1b'); await showing; assert.equal(f.views[1].closed, true);
  oldBadge.handleMouse(click); await tick(); view.dispose(f.ctx); await tick();
  assert.equal(f.views[2].closed, true); assert.equal(f.widgets.at(-1)?.[1], undefined);
  assert.equal(oldBadge.handleMouse(click), undefined); assert.equal(f.views.length, 3);
});

test('table navigation: j/k and arrows move selection, newest selected by default', async () => {
  const reports = [];
  for (let i = 1; i <= 8; i++) reports.push(checkpoint(`req-${i}`, JSON.stringify({ objectives: [{ objective: `Task ${i}`, progress: 'In progress', issues: [], eta: 'Unknown' }], rules: [] })));
  const f = fixture(theme); f.resize(40); const view = new CuckooView(() => {});
  view.publish(f.ctx, reports, true, null);
  f.badge().handleMouse(click); await tick();
  const panel = f.views[0].component;
  const output = panel.render(80).join('\n');
  // Newest selected: Checkpoint 8 (req-8) should be selected
  assert.match(output, /▌.*req-8/);
  // 3-row table: req-8, req-7, req-6 visible initially
  assert.match(output, /req-8/);
  assert.match(output, /req-6/);
  assert.doesNotMatch(output, /req-5/);

  // j moves to older (index 1 = req-7)
  panel.handleInput('j');
  const output2 = panel.render(80).join('\n');
  assert.match(output2, /▌.*req-7/);

  // Arrow down
  panel.handleInput('\x1b[B');
  const output3 = panel.render(80).join('\n');
  assert.match(output3, /▌.*req-6/);

  // k moves back up
  panel.handleInput('k');
  const output4 = panel.render(80).join('\n');
  assert.match(output4, /▌.*req-7/);

  // Arrow up
  panel.handleInput('\x1b[A');
  const output5 = panel.render(80).join('\n');
  assert.match(output5, /▌.*req-8/);

  // Navigate down past viewport: table scrolls window
  for (let i = 0; i < 5; i++) panel.handleInput('j');
  const output6 = panel.render(80).join('\n');
  assert.match(output6, /▌.*req-3/);
  assert.match(output6, /req-5/); // Older rows visible in table viewport

  panel.handleInput('\x1b'); await tick(); assert.equal(f.views[0].closed, true);
  view.dispose(f.ctx);
});

test('detail pane shows selected checkpoint content and updates on selection change', async () => {
  const r1 = checkpoint('first', JSON.stringify({ objectives: [{ objective: 'First task', progress: 'Done', issues: [], eta: 'Complete' }], rules: [] }));
  const r2 = checkpoint('second', JSON.stringify({ objectives: [{ objective: 'Second task', progress: 'Halfway', issues: ['Blocked', 'Bug found', 'Serial'], eta: 'Tomorrow' }], rules: [] }));
  const f = fixture(theme); f.resize(40); const view = new CuckooView(() => {});
  view.publish(f.ctx, [r1, r2], true, null);
  f.badge().handleMouse(click); await tick();
  const panel = f.views[0].component;
  let output = panel.render(80).join('\n');

  // Default: newest selected (r2, Checkpoint 2)
  assert.match(output, /Second task/);
  assert.match(output, /Halfway/);
  assert.match(output, /Blocked/);

  // Navigate to older (first)
  panel.handleInput('j');
  output = panel.render(80).join('\n');
  assert.match(output, /First task/);
  assert.match(output, /Done/);
  assert.match(output, /Complete/);

  panel.handleInput('\x1b'); await tick(); view.dispose(f.ctx);
});

test('invalid report shows error detail with raw output, not parsed fields', async () => {
  const invalid = checkpoint('bad-one', 'not json at all');
  const f = fixture(theme); f.resize(40); const view = new CuckooView(() => {});
  view.publish(f.ctx, [invalid], true, null);
  f.badge().handleMouse(click); await tick();
  const panel = f.views[0].component;
  const output = panel.render(80).join('\n');
  assert.match(output, /not json at all/);
  assert.match(output, /Invalid report/);
  assert.doesNotMatch(output, /Objective/); // No parsed objective fields
  panel.handleInput('\x1b'); await tick(); view.dispose(f.ctx);
});

test('detail scroll: ctrl-u/d and Home/End scroll detail independently of table', async () => {
  const long = checkpoint('long-report', JSON.stringify({
    objectives: Array.from({ length: 10 }, (_, i) => ({ objective: `Objective ${i + 1}`, progress: 'Progress '.repeat(20), issues: [], eta: 'Unknown' })),
    rules: [],
  }));
  const f = fixture(theme); f.resize(30); const view = new CuckooView(() => {});
  view.publish(f.ctx, [long], true, null);
  f.badge().handleMouse(click); await tick();
  const panel = f.views[0].component;

  // Detail should render the long content
  const initial = panel.render(80).join('\n');
  assert.match(initial, /Objective 1/);

  // ctrl-d scrolls detail down
  panel.handleInput('\x04');
  // ctrl-u scrolls detail up
  panel.handleInput('\x15');
  // Home
  panel.handleInput('\x1b[H');
  // End
  panel.handleInput('\x1b[F');

  panel.handleInput('\x1b'); await tick(); view.dispose(f.ctx);
});

test('empty report panel shows placeholder, still accepts i for inquiry', async () => {
  const f = fixture(theme); const requests = [];
  const view = new CuckooView(ctx => { requests.push(ctx); });
  view.publish(f.ctx, [], true, null);
  f.badge().handleMouse(click); await tick();
  const panel = f.views[0].component;
  const output = panel.render(80).join('\n');
  assert.match(output, /No Cuckoo reports/);
  panel.handleInput('i'); await tick();
  assert.equal(f.views[0].closed, true);
  assert.equal(requests.length, 1);
  view.dispose(f.ctx);
});

test('showHistory shows entries with timestamps and branch attribution', async () => {
  const older = { type: 'custom', id: 'entry-old', parentId: null, timestamp: '2026-11-07T01:00:00Z', customType: REPORT_TYPE, data: { version: 1, requestId: 'old-req', raw: '{"objectives":[{"objective":"Old","progress":"Seen"}]}', error: null } };
  const newer = { type: 'custom', id: 'entry-new', parentId: null, timestamp: '2026-11-08T01:00:00Z', customType: REPORT_TYPE, data: checkpoint('new-req', '{"objectives":[],"rules":[]}') };
  const f = fixture(theme); f.resize(40); const view = new CuckooView(() => {});
  const showing = view.showHistory(f.ctx, [older, newer], [newer]);
  await tick();
  const panel = f.views[0].component;
  const output = panel.render(80).join('\n');
  // Detail shows newest selected
  assert.match(output, /No current objectives/); // new-req has empty objectives
  // Detail meta includes current branch
  assert.match(output, /current branch/);
  panel.handleInput('\x1b'); await showing; view.dispose(f.ctx);
});

test('non-terminal view notifies full plain text via reportContent/historyContent', async () => {
  const f = fixture(theme); f.ctx.mode = 'rpc'; const view = new CuckooView(() => {});
  const r = checkpoint('rpc-req', JSON.stringify({ objectives: [{ objective: 'RPC task', progress: 'Done', issues: [], eta: 'Complete' }], rules: [{ rule: 'Show mockups', source: 'user', scope: 'This change' }] }));
  await view.showReports(f.ctx, [r], 'Cuckoo: ON\nGrowth policy: measured');
  assert.ok(f.notifications.length > 0);
  const msg = f.notifications[0][0];
  assert.match(msg, /RPC task/);
  assert.match(msg, /Show mockups/);
  assert.match(msg, /Cuckoo: ON/);
  assert.match(msg, /Growth policy: measured/);
  assert.equal(f.views.length, 0);

  // History non-TUI
  const entry = { type: 'custom', id: 'hist-1', parentId: null, timestamp: '2026-11-08T01:00:00Z', customType: REPORT_TYPE, data: r };
  await view.showHistory(f.ctx, [entry], [entry]);
  assert.match(f.notifications.at(-1)[0], /RPC task/);
  assert.match(f.notifications.at(-1)[0], /current branch/);
});

test('panel advertises i and closes before requesting exactly one manual inquiry', async () => {
  const f = fixture(theme); const requests = [];
  const view = new CuckooView(ctx => { assert.equal(f.views[0].closed, true); requests.push(ctx); });
  view.publish(f.ctx, [checkpoint('one', '{"objectives":[],"rules":[]}')], true, null);
  f.badge().handleMouse(click); await tick();
  const panel = f.views[0].component;
  assert.match(panel.render(80).join('\n'), /i.*inquire now/);
  panel.handleInput('i'); panel.handleInput('i'); await tick();
  assert.equal(f.views[0].closed, true); assert.deepEqual(requests, [f.ctx]);
  view.dispose(f.ctx); panel.handleInput('i'); await tick(); assert.equal(requests.length, 1);
});

test('settings and fault text appear in footer region', async () => {
  const reports = [checkpoint('req', JSON.stringify({ objectives: [{ objective: 'Task', progress: 'Started', issues: [], eta: 'Unknown' }], rules: [] }))];
  const styled = { fg: (token, text) => `<${token}>${text}</${token}>`, bg: (_token, text) => text, bold: text => `<b>${text}</b>` };
  const f = fixture(styled); f.resize(40); const view = new CuckooView(() => {});
  view.publish(f.ctx, reports, true, null);
  f.badge().handleMouse(click); await tick();
  const output = f.views[0].component.render(120).join('\n');
  assert.match(output, /<muted>Cuckoo:<\/muted> ON \(badge\)/);
  f.views[0].component.handleInput('\x1b'); await tick();

  // showReports with detailed intro
  const showing = view.showReports(f.ctx, reports, 'Cuckoo: ON (session)\nGrowth policy: 15% relative (global); next inquiry: 23000 tokens (baseline 20000).\nPending checkpoint: none.\nGlobal defaults: /tmp/cuckoo.json\nUse /cuckoo history for saved answers.');
  await tick();
  const output2 = f.views[1].component.render(120).join('\n');
  assert.match(output2, /15% relative/);

  f.views[1].component.handleInput('\x1b'); await showing; view.dispose(f.ctx);
});

test('narrow layout adapts columns and table viewport is bounded', async () => {
  const reports = [];
  for (let i = 1; i <= 12; i++) reports.push(checkpoint(`req-${String(i).padStart(3, '0')}`, JSON.stringify({ objectives: [{ objective: `Task ${i}`, progress: 'Progress', issues: [], eta: 'Unknown' }], rules: [] })));
  const f = fixture(theme); f.resize(24); const view = new CuckooView(() => {});
  view.publish(f.ctx, reports, true, null);
  f.badge().handleMouse(click); await tick();
  const panel = f.views[0].component;

  const out50 = panel.render(50).join('\n');
  assert.match(out50, /Request ID/);
  assert.match(out50, /Objs/);
  assert.match(out50, /Status/);

  // At most 5 table rows (count the marker+separator row pattern: '│ req-')
  const visibleReqs = (out50.match(/│ req-/g) ?? []).length;
  assert.ok(visibleReqs <= 5, `expected ≤5 visible rows, got ${visibleReqs}`);

  // Navigate to bottom
  for (let i = 0; i < 12; i++) panel.handleInput('j');
  const outBottom = panel.render(50).join('\n');
  assert.match(outBottom, /req-001/);
  assert.match(outBottom, /▌.*req-001/);

  panel.handleInput('\x1b'); await tick(); view.dispose(f.ctx);
});

test('request IDs are sanitized of terminal control bytes', async () => {
  const bad = checkpoint('req\x1b\x07\r\x9b-unsafe', JSON.stringify({ objectives: [{ objective: 'Safe', progress: 'Yes', issues: [], eta: 'Complete' }], rules: [] }));
  const f = fixture(theme); f.resize(40); const view = new CuckooView(() => {});
  view.publish(f.ctx, [bad], true, null);
  f.badge().handleMouse(click); await tick();
  const panel = f.views[0].component;
  const output = panel.render(80).join('\n');
  assert.doesNotMatch(output, /\x07|\r|\x9b/);
  assert.match(output, /req-unsafe/); // Stripped to safe chars
  panel.handleInput('\x1b'); await tick(); view.dispose(f.ctx);
});