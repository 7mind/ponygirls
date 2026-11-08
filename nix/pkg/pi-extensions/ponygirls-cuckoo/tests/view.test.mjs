import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { CuckooView } from '../src/view.ts';
import { checkpoint } from '../src/report.ts';
import { reportContent } from '../src/presentation.ts';

const theme = { fg: (_token, text) => text, bg: (_token, text) => text, bold: text => text };
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
  return { ctx, widgets, notifications, views, resize: value => { rows = value; }, badge: () => widgets.at(-1)[1](null, theme) };
}
const click = { type: 'click', button: 'left' };
const tick = () => new Promise(setImmediate);
// Specified: Behavioral-Active, Blackbox-Group through the shared UI boundary.
test('objective badge preserves zero/unknown/failure distinctions and bounds width', () => {
  const f = fixture(theme); const view = new CuckooView(() => {});
  view.publish(f.ctx, [], false, null); assert.equal(f.widgets.at(-1)[1], undefined);
  view.publish(f.ctx, [], true, null); assert.match(f.badge().render(80)[0], /🐦 \?/);
  const valid = checkpoint('one', '{"objectives":[]}');
  view.publish(f.ctx, [valid], true, null); assert.match(f.badge().render(80)[0], /🐦 0/);
  view.publish(f.ctx, [valid, checkpoint('two', 'bad')], false, null);
  assert.match(f.badge().render(80)[0], /🐦 0 ! off/);
  assert.equal(f.badge().renderCompact(80), ' 🐦 0! ');
  for (const width of [0, 1, 2, 3, 4, 12]) {
    assert.ok(visibleWidth(f.badge().render(width)[0]) <= width);
    assert.ok(visibleWidth(f.badge().renderCompact(width)) <= width);
  }
});

test('badge repeat-click, command-style toggle, keyboard close and disposal share one view', async () => {
  const f = fixture(theme); const view = new CuckooView(() => {});
  view.publish(f.ctx, [], true, null);
  const oldBadge = f.badge();
  assert.equal(oldBadge.handleMouse({ type: 'click', button: 'right' }), undefined);
  assert.equal(oldBadge.handleMouse(click).handled, true); await tick();
  assert.equal(f.views.length, 1); assert.equal(f.views[0].options.retainEditorBorders, true);
  assert.match(f.views[0].component.render(80).join('\n'), /No Cuckoo reports/);
  oldBadge.handleMouse(click); await tick(); assert.equal(f.views[0].closed, true);
  const showing = view.show(f.ctx, { title: 'Fixture', plain: 'report', render: () => 'report' }); await tick();
  f.views[1].component.handleInput('\x1b'); await showing; assert.equal(f.views[1].closed, true);
  oldBadge.handleMouse(click); await tick(); view.dispose(f.ctx); await tick();
  assert.equal(f.views[2].closed, true); assert.equal(f.widgets.at(-1)[1], undefined);
  assert.equal(oldBadge.handleMouse(click), undefined); assert.equal(f.views.length, 3);
});

test('report panel uses themed checkpoint/objective hierarchy and labeled fields without guessing status', async () => {
  const styled = { fg: (token, text) => `<${token}>${text}</${token}>`, bg: (_token, text) => text, bold: text => `<b>${text}</b>` };
  const f = fixture(styled); f.resize(200); const view = new CuckooView(() => {});
  const report = checkpoint('request-one', JSON.stringify({ objectives: [{ objective: 'Audit UI', progress: 'Tests running; completion unknown',
    obstacles: 'None known', issues: 'Waiting for evidence', bottlenecks: 'None known', eta: 'Unknown' }] }));
  view.publish(f.ctx, [report], true, null); f.badge().handleMouse(click); await tick();
  const panel = f.views[0].component;
  const text = panel.render(300).join('\n');
  assert.match(text, /<accent><b>Checkpoint 1<\/b><\/accent>/);
  assert.match(text, /<accent><b>1\. Audit UI<\/b><\/accent>/);
  assert.match(text, /<accent><b>Progress<\/b><\/accent>/);
  assert.match(text, /<warning><b>Obstacles<\/b><\/warning>/);
  assert.match(text, /<warning><b>Issues<\/b><\/warning>/);
  assert.match(text, /<warning><b>Bottlenecks<\/b><\/warning>/);
  assert.match(text, /<accent><b>ETA<\/b><\/accent>/);
  assert.match(text, /<muted>request-one<\/muted>/);
  assert.match(text, /Tests running; completion unknown/);
  assert.match(text, /None known/);
  assert.doesNotMatch(text, /100%|completed|blocked/);
  view.dispose(f.ctx);
});

test('long Unicode reports wrap within width, scroll to the raw tail, and survive resize and theme invalidation', async () => {
  let color = '36';
  const ansi = { fg: (_token, text) => `\x1b[${color}m${text}\x1b[0m`, bg: (_token, text) => text, bold: text => `\x1b[1m${text}\x1b[22m` };
  const f = fixture(ansi); f.resize(12); const view = new CuckooView(() => {});
  const raw = checkpoint('old', 'invalid response\nRAW-END');
  const recent = checkpoint('latest', JSON.stringify({ objectives: [{ objective: 'Unicode 🐦 界 é', progress: 'Evidence 🐦 界 é '.repeat(80),
    obstacles: 'None known\nNo inferred status', issues: 'Awaiting verification', bottlenecks: 'Unknown', eta: 'Unknown' }] }));
  const shown = view.show(f.ctx, reportContent([raw, recent], 'Cuckoo: ON'));
  await tick(); const panel = f.views[0].component;
  for (const width of [12, 24, 40, 80]) {
    panel.handleInput('\x1b[H');
    const lines = panel.render(width);
    assert.ok(lines.length <= 12);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
  }
  panel.render(40); panel.handleInput('\x1b[F');
  assert.match(panel.render(40).join('\n'), /RAW-END/);
  f.resize(24); panel.render(24); panel.handleInput('\x1b[H');
  assert.match(panel.render(40).join('\n'), /Checkpoint 2/);
  color = '35'; panel.invalidate();
  assert.ok(panel.render(40).some(line => line.includes('\x1b[35m')));
  assert.ok(panel.render(40).every(line => !line.includes('\x1b[36m')));
  panel.handleInput('q'); await shown; assert.equal(f.views[0].closed, true);
  view.dispose(f.ctx);
});

test('non-terminal view notifies without opening a custom terminal screen', async () => {
  const f = fixture(theme); f.ctx.mode = 'rpc'; const view = new CuckooView(() => {});
  await view.show(f.ctx, { title: 'Fixture', plain: 'saved report\x1b\x07', render: () => { throw new Error('RPC must not render ANSI presentation'); } });
  assert.deepEqual(f.notifications, [['saved report', 'info']]); assert.equal(f.views.length, 0);
});

test('panel advertises i and closes before requesting exactly one manual inquiry', async () => {
  const f = fixture(theme); const requests = [];
  const view = new CuckooView(ctx => { assert.equal(f.views[0].closed, true); requests.push(ctx); });
  view.publish(f.ctx, [], true, null); f.badge().handleMouse(click); await tick();
  const panel = f.views[0].component;
  assert.match(panel.render(80).join('\n'), /i: inquire now/);
  panel.handleInput('i'); panel.handleInput('i'); await tick();
  assert.equal(f.views[0].closed, true); assert.deepEqual(requests, [f.ctx]);
  view.dispose(f.ctx); panel.handleInput('i'); await tick(); assert.equal(requests.length, 1);
});
