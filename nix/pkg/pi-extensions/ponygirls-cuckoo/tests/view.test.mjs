import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { CuckooView } from '../src/view.ts';
import { checkpoint } from '../src/report.ts';

const theme = { fg: (_token, text) => text, bg: (_token, text) => text, bold: text => text };
function fixture() {
  const widgets = []; const notifications = []; const views = [];
  const ctx = { mode: 'tui', hasUI: true, ui: {
    setWidget: (...args) => widgets.push(args), notify: (...args) => notifications.push(args),
    custom: (factory, options) => new Promise(resolve => {
      const view = { options, closed: false }; views.push(view);
      view.component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme,
        { matches: (key, action) => key === '\x1b' && action === 'tui.select.cancel' }, () => { view.closed = true; resolve(); });
    }),
  } };
  return { ctx, widgets, notifications, views, badge: () => widgets.at(-1)[1](null, theme) };
}
const click = { type: 'click', button: 'left' };
const tick = () => new Promise(setImmediate);
// Specified: Behavioral-Active, Blackbox-Group through the shared UI boundary.
test('objective badge preserves zero/unknown/failure distinctions and bounds width', () => {
  const f = fixture(); const view = new CuckooView();
  view.publish(f.ctx, [], false, null); assert.equal(f.widgets.at(-1)[1], undefined);
  view.publish(f.ctx, [], true, null); assert.match(f.badge().render(80)[0], /Cuckoo \?/);
  const valid = checkpoint('one', '{"objectives":[]}');
  view.publish(f.ctx, [valid], true, null); assert.match(f.badge().render(80)[0], /Cuckoo 0/);
  view.publish(f.ctx, [valid, checkpoint('two', 'bad')], false, null);
  assert.match(f.badge().render(80)[0], /Cuckoo 0 ! off/);
  for (const width of [1, 4, 12]) {
    assert.ok(visibleWidth(f.badge().render(width)[0]) <= width);
    assert.ok(visibleWidth(f.badge().renderCompact(width)) <= width);
  }
});

test('badge repeat-click, command-style toggle, keyboard close and disposal share one view', async () => {
  const f = fixture(); const view = new CuckooView();
  view.publish(f.ctx, [], true, null);
  const oldBadge = f.badge();
  assert.equal(oldBadge.handleMouse({ type: 'click', button: 'right' }), undefined);
  assert.equal(oldBadge.handleMouse(click).handled, true); await tick();
  assert.equal(f.views.length, 1); assert.equal(f.views[0].options.retainEditorBorders, true);
  assert.match(f.views[0].component.render(80).join('\n'), /No Cuckoo reports/);
  oldBadge.handleMouse(click); await tick(); assert.equal(f.views[0].closed, true);
  const showing = view.show(f.ctx, 'report'); await tick();
  f.views[1].component.handleInput('\x1b'); await showing; assert.equal(f.views[1].closed, true);
  oldBadge.handleMouse(click); await tick(); view.dispose(f.ctx); await tick();
  assert.equal(f.views[2].closed, true); assert.equal(f.widgets.at(-1)[1], undefined);
  assert.equal(oldBadge.handleMouse(click), undefined); assert.equal(f.views.length, 3);
});

test('non-terminal view notifies without opening a custom terminal screen', async () => {
  const f = fixture(); f.ctx.mode = 'rpc'; const view = new CuckooView();
  await view.show(f.ctx, 'saved report\x1b\x07');
  assert.deepEqual(f.notifications, [['saved report', 'info']]); assert.equal(f.views.length, 0);
});
