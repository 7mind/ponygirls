import assert from 'node:assert/strict';
import test from 'node:test';
import { Key, matchesKey, type TUI, type TuiMouseEvent } from '@earendil-works/pi-tui';
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js';
import { ScopedSettingsController, scopedBooleanField, applyScopedSettingsChanges, type ScopedSettingFields, type ScopedSettingsSnapshot, type ScopedSettingsAction, type ScopedSettingsKeybindings, type ScopedSettingChange, type ScopedSettingsScope } from '@ponygirls/pi-settings';
import { ScopedSettingsPanel, ScopedSettingsView, type ScopedSettingsViewContext } from '../src/scoped-settings.ts';
import { PLAIN_THEME } from '../src/theme.ts';

const names = ['f00', 'f01', 'f02', 'f03', 'f04', 'f05', 'f06', 'f07', 'f08', 'f09', 'f10', 'f11', 'f12', 'f13', 'f14', 'f15', 'f16', 'f17', 'f18', 'f19', 'f20', 'f21', 'f22', 'f23', 'f24'] as const;
type Values = Record<typeof names[number], boolean>;
const keys: ScopedSettingsKeybindings = { matches(data, action) {
  return action === 'tui.select.cancel' ? matchesKey(data, Key.escape) : action === 'tui.select.confirm' ? matchesKey(data, Key.enter) : action === 'tui.select.up' ? matchesKey(data, Key.up) : matchesKey(data, Key.down);
} };
function fixture() {
  const fields = Object.fromEntries(names.map(name => [name, scopedBooleanField(name, `Description ${name}`)])) as ScopedSettingFields<Values>;
  let snapshot: ScopedSettingsSnapshot<Values> = { defaults: Object.fromEntries(names.map(name => [name, false])) as Values, managed: {}, global: {}, project: {}, session: {}, projectTrusted: true, targets: { global: '/global', project: '/project', session: 'session' } };
  let writes = 0;
  let apply = async (scope: ScopedSettingsScope, changes: readonly ScopedSettingChange<Values>[], signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted(); writes++; snapshot = { ...snapshot, [scope]: applyScopedSettingsChanges(fields, names, snapshot[scope], changes) };
  };
  const controller = new ScopedSettingsController<Values>({ fields, order: names, inactive: () => '', adapter: { read: () => snapshot, apply: (scope, changes, signal) => apply(scope, changes, signal), applied() {} } });
  const panels: ScopedSettingsPanel[] = [];
  const context: ScopedSettingsViewContext = { mode: 'tui', hasUI: true, ui: {
    notify() {},
    custom(factory) { return new Promise((resolve, reject) => {
      const component = factory({ requestRender() {} } as unknown as TUI, PLAIN_THEME, keys, resolve);
      if (component instanceof Promise) { reject(new Error('Unexpected async panel factory')); return; }
      assert.ok(component instanceof ScopedSettingsPanel); panels.push(component);
    }); },
  } };
  return { controller, context, panels, writes: () => writes, setApply: (value: typeof apply) => { apply = value; }, read: () => snapshot };
}
function panel(f: ReturnType<typeof fixture>, actions: ScopedSettingsAction[]): ScopedSettingsPanel {
  return new ScopedSettingsPanel({ title: 'Scoped settings', controller: f.controller, theme: PLAIN_THEME, keys, requestRender() {}, runAction: action => { actions.push(action); }, cancel() {} });
}
function click(x: number, y: number, height: number): TuiMouseEvent {
  return { type: 'click', button: 'left', x, y, screenX: x, screenY: y, width: 120, height, shift: false, alt: false, ctrl: false };
}

test('closing revokes controller before synchronous external abort observers', async () => {
  const f = fixture(); const view = new ScopedSettingsView(); let observed: boolean | undefined;
  let started: () => void = () => {}; const entered = new Promise<void>(resolve => { started = resolve; });
  f.setApply((_scope, _changes, signal) => new Promise<void>(resolve => {
    signal.addEventListener('abort', () => { observed = f.controller.active; resolve(); }, { once: true }); started();
  }));
  const showing = view.show(f.context, () => f.controller, { title: 'Scoped settings' });
  f.panels[0].handleInput(' '); f.panels[0].handleInput('\x13');
  await entered; view.dispose(); await showing;
  assert.equal(observed, false); assert.equal(f.writes(), 0);
});

test('controller returned after reentrant factory disposal is also revoked', async () => {
  const f = fixture(); const view = new ScopedSettingsView();
  await view.show(f.context, () => { view.dispose(); return f.controller; }, { title: 'Scoped settings' });
  assert.equal(f.controller.active, false); assert.equal(f.controller.beginApply(), null); assert.equal(f.panels.length, 0);
});

test('first allocated frame routes visible Apply hint, not a hidden row', () => {
  const f = fixture(); const actions: ScopedSettingsAction[] = []; f.controller.toggleSelected(); const p = panel(f, actions);
  const frame = renderLayoutFrame(p, 120, 14, () => {});
  const row = frame.lines.findIndex(line => line.includes('Ctrl-S')); assert.ok(row >= 0);
  p.handleMouse(click(frame.lines[row].indexOf('Ctrl-S') + 2, row, 14));
  assert.equal(actions.length, 1); assert.equal(actions[0].kind, 'apply');
});

test('a resized frame never applies from coordinates now occupied by a setting row', () => {
  const f = fixture(); const actions: ScopedSettingsAction[] = []; const p = panel(f, actions);
  renderLayoutFrame(p, 120, 14, () => {}); const small = renderLayoutFrame(p, 120, 14, () => {});
  const row = small.lines.findIndex(line => line.includes('Ctrl-S')); const x = small.lines[row].indexOf('Ctrl-S') + 2;
  f.controller.toggleSelected(); const large = renderLayoutFrame(p, 120, 40, () => {});
  assert.match(large.lines[row], /f\d\d/);
  p.handleMouse(click(x, row, 40)); assert.equal(actions.length, 0);
});

test('press is neutral and preserves the target before click changes a field', () => {
  const f = fixture(); const actions: ScopedSettingsAction[] = []; const p = panel(f, actions);
  renderLayoutFrame(p, 120, 40, () => {}); const frame = renderLayoutFrame(p, 120, 40, () => {});
  const row = frame.lines.findIndex(line => line.includes('f00') && line.includes('[ ]'));
  const event = click(4, row, 40); const press = p.handleMouse({ ...event, type: 'press' });
  assert.equal(press?.handled, true); assert.equal(press?.render, false);
  assert.equal(f.controller.state().rows[0].checked, false); p.handleMouse(event); assert.equal(f.controller.state().rows[0].checked, true);
});
