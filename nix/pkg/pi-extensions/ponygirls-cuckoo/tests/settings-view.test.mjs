import test from 'node:test';
import assert from 'node:assert/strict';
import { Key, matchesKey, visibleWidth } from '@earendil-works/pi-tui';
import { CuckooSettingsView, SettingsController, SettingsPanel } from '../src/settings-view.ts';
import { applyPreferenceChanges, resolvePreferences } from '../src/preferences.ts';

const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text };
const keys = { matches(data, action) {
  const key = { 'tui.select.up': Key.up, 'tui.select.down': Key.down, 'tui.select.confirm': Key.enter, 'tui.select.cancel': Key.escape }[action];
  return key !== undefined && matchesKey(data, key);
} };

function fixture() {
  let layers = { global: {}, project: {}, session: {} };
  let trusted = true; let failRead = false; let failWrite = false;
  const saves = []; const applied = [];
  const read = () => {
    if (failRead) throw new Error('unavailable fixture settings');
    const current = structuredClone(layers);
    if (!trusted) current.project = {};
    return { ...current, effective: resolvePreferences(current), projectTrusted: trusted,
      paths: { global: '/fixture/agent/cuckoo.json', project: '/fixture/project/.pi/cuckoo.json', session: 'synthetic-session' } };
  };
  const callbacks = { read,
    apply(scope, changes) {
      if (failWrite) throw new Error('owned write failure');
      if (scope === 'project' && !trusted) throw new Error('Project not trusted');
      saves.push({ scope, changes: structuredClone(changes) });
      layers[scope] = applyPreferenceChanges(layers[scope], changes);
    },
    applied: (snapshot, scope) => applied.push({ snapshot, scope }),
    async editPolicy() { assert.fail('No policy edit expected'); },
  };
  return { read, callbacks, saves, applied, setLayers: value => { layers = structuredClone(value); }, setTrusted: value => { trusted = value; },
    failRead: value => { failRead = value; }, failWrite: value => { failWrite = value; } };
}
function select(controller, name) {
  const index = controller.rows.findIndex(row => row.field === name || (row.field === 'feature' && row.id === name));
  assert.ok(index >= 0); controller.select(index);
}
function panel(controller, onCancel, onPolicy) {
  return new SettingsPanel({ controller, theme, keys, requestRender() {}, cancel: onCancel, editPolicy: onPolicy });
}
function mouse(x, y, height) {
  return { type: 'click', button: 'left', x, y, screenX: x, screenY: y, width: 100, height, modifiers: { shift: false, alt: false, ctrl: false } };
}
function uiFixture() {
  const panels = []; const notices = [];
  const ctx = { mode: 'tui', hasUI: true, ui: {
    notify: (...args) => notices.push(args),
    custom(factory) {
      return new Promise((resolve, reject) => {
        let component;
        try {
          component = factory({ terminal: { rows: 40 }, requestRender() {} }, theme, keys, value => {
            if (component !== undefined && typeof component.dispose === 'function') component.dispose();
            resolve(value);
          });
          panels.push(component);
        } catch (error) { reject(error); }
      });
    },
  } };
  return { ctx, panels, notices };
}

// Specified Behavioral-Active / Blackbox-Group: public controller, panel and callbacks.
test('all seven features and master render with local/effective sources and dependency reasons', () => {
  const f = fixture(); const c = new SettingsController(f.callbacks);
  assert.equal(c.rows.length, 9);
  select(c, 'vectors'); c.toggleSelected();
  const p = panel(c, () => {}, () => {});
  const text = p.render(120).join('\n');
  for (const row of c.rows) assert.ok(text.includes(row.label));
  assert.match(text, /\[x\].*Vector retrieval/);
  assert.match(text, /inactive: Cuckoo is off, reader is off/);
  assert.match(text, /Effective: on \(session\)/);
  assert.match(text, /settings, not permission to transmit data/);
  assert.equal(f.saves.length, 0);
});

test('drafts are scoped; selected scope alone is previewed/applied and close discards the rest', () => {
  const f = fixture(); const c = new SettingsController(f.callbacks);
  select(c, 'evidence'); c.toggleSelected();
  c.selectScope('global'); select(c, 'reader'); c.toggleSelected();
  assert.equal(c.preview().effective.features.evidence, false, 'other tab draft is not reported as persisted');
  assert.equal(c.preview().effective.features.reader, true);
  c.applySelected(); assert.equal(f.saves.length, 1); assert.equal(f.saves[0].scope, 'global');
  assert.equal(c.dirty('session'), true); assert.equal(c.dirty('global'), false);
  c.selectScope('session'); assert.equal(c.preview().effective.features.evidence, true);
  c.dispose(); c.applySelected();
  assert.equal(f.saves.length, 1); assert.equal(f.read().effective.features.evidence, false);
  assert.equal(f.read().effective.features.reader, true);
});

test('lower scope toggles its own resolved value despite higher-scope shadowing', () => {
  const f = fixture(); f.setLayers({ global: { features: { reader: false } }, project: {}, session: { features: { reader: true } } });
  const c = new SettingsController(f.callbacks); c.selectScope('global'); select(c, 'reader');
  c.toggleSelected(); assert.deepEqual(c.pending('global'), [{ field: 'feature', id: 'reader', value: true }]);
  c.toggleSelected(); assert.equal(c.dirty('global'), false, 'second toggle returns to saved global false');
  const text = panel(c, () => {}, () => {}).render(100).join('\n');
  assert.match(text, /\[ \].*Scoped memory reader/);
  assert.match(text, /Effective: on \(session\)/);
  assert.match(text, /Local global: off; through this scope: off/);
});

test('inherit removes one override without changing adjacent draft or complete policy', () => {
  const f = fixture(); f.setLayers({ global: { enabled: true, features: { reader: true } }, project: {}, session: { features: { reader: false }, policy: { kind: 'tokens', value: 10 } } });
  const c = new SettingsController(f.callbacks); select(c, 'reader'); c.resetSelected();
  select(c, 'vectors'); c.toggleSelected(); c.applySelected();
  assert.equal(f.read().effective.features.reader, true);
  assert.equal(f.read().effective.featureSources.reader, 'global');
  assert.equal(f.read().effective.features.vectors, true);
  assert.deepEqual(f.read().effective.policy, { kind: 'tokens', value: 10 });
});

test('save rereads current state, preserves unrelated changes and rechecks trust', () => {
  const f = fixture(); const c = new SettingsController(f.callbacks);
  c.selectScope('project'); select(c, 'reader'); c.toggleSelected();
  f.setLayers({ global: {}, project: { enabled: true }, session: {} });
  c.applySelected(); assert.equal(f.read().effective.enabled, true);
  select(c, 'vectors'); c.toggleSelected(); f.setTrusted(false); c.applySelected();
  assert.equal(f.saves.length, 1); assert.equal(c.dirty('project'), true);
  assert.match(c.notice, /trusted/);
});

test('save failures keep drafts and do not report success or refresh runtime', () => {
  const f = fixture(); const c = new SettingsController(f.callbacks);
  c.toggleSelected(); f.failWrite(true); c.applySelected();
  assert.equal(f.saves.length, 0); assert.equal(f.applied.length, 0);
  assert.equal(c.dirty('session'), true); assert.match(c.notice, /Save failed/);
  f.failWrite(false); f.failRead(true); c.applySelected();
  assert.equal(f.saves.length, 0); assert.match(c.notice, /Reload failed/);
  f.failRead(false); c.applySelected();
  assert.equal(f.saves.length, 1); assert.equal(f.applied.length, 1); assert.equal(c.dirty('session'), false);
});

test('keyboard applies explicitly; reset, scope, policy and cancellation have separate actions', () => {
  const f = fixture(); const c = new SettingsController(f.callbacks); let cancelled = 0; const policy = [];
  const p = panel(c, () => { cancelled++; c.dispose(); p.dispose(); }, value => policy.push(value));
  p.handleInput(' '); assert.equal(c.preview().effective.enabled, true); assert.equal(f.saves.length, 0);
  p.handleInput('\x13'); assert.equal(f.saves.length, 1);
  p.handleInput('r'); assert.equal(c.preview().effective.enabled, false);
  p.handleInput('\t'); assert.equal(c.scope, 'project');
  p.handleInput('p'); assert.equal(policy.length, 1); assert.equal(policy[0].scope, 'project');
  p.handleInput('\x1b'); assert.equal(cancelled, 1);
  p.handleInput(' '); p.handleInput('\x13'); assert.equal(f.saves.length, 1);
});

test('mouse row and tab actions use fresh rendered geometry and disposed callbacks cannot save', () => {
  const f = fixture(); const c = new SettingsController(f.callbacks); const p = panel(c, () => {}, () => {});
  let lines = p.render(100);
  const rowY = lines.findIndex(line => line.includes('Evidence & work products'));
  assert.equal(p.handleMouse(mouse(4, rowY, lines.length)).handled, true);
  assert.equal(c.preview().effective.features.evidence, true); assert.equal(f.saves.length, 0);
  lines = p.render(100); const tabX = lines[0].indexOf('global');
  assert.ok(tabX > 0); p.handleMouse(mouse(tabX + 1, 0, lines.length));
  assert.equal(c.scope, 'global');
  lines = p.render(100); const footerY = lines.findIndex(line => line.includes('Ctrl-S'));
  p.handleMouse(mouse(lines[footerY].indexOf('Ctrl-S') + 1, footerY, lines.length));
  assert.equal(f.saves.length, 0, 'global has no draft; session remains unsaved');
  p.dispose(); p.handleInput('\x13'); p.handleMouse(mouse(4, rowY, lines.length));
  assert.equal(f.saves.length, 0);
});

test('mouse press retains a target so the terminal dispatcher can synthesize a later click', () => {
  const f = fixture(); const c = new SettingsController(f.callbacks); const p = panel(c, () => {}, () => {});
  const lines = p.render(100); const x = lines[0].indexOf('global') + 1;
  const event = mouse(x, 0, lines.length);
  const press = p.handleMouse({ ...event, type: 'press' });
  assert.equal(press?.handled, true, 'regular-mode dispatcher needs a press target before delivering release/click');
  assert.equal(press.target.component, p); assert.equal(press.render, false, 'neutral press must not invalidate its own gesture target');
  assert.equal(c.scope, 'session', 'press does not activate the checkbox or tab');
  p.handleMouse({ ...event, type: 'release' }); assert.equal(c.scope, 'session');
  p.handleMouse(event); assert.equal(c.scope, 'global');
});

test('rendered rows fit narrow widths; selection and drafts survive resize', () => {
  const f = fixture(); const c = new SettingsController(f.callbacks); select(c, 'critic'); c.toggleSelected();
  const p = panel(c, () => {}, () => {});
  for (const width of [120, 80, 40, 20, 120]) {
    for (const line of p.render(width)) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}`);
    assert.equal(c.currentRow().id, 'critic'); assert.equal(c.preview().effective.features.critic, true);
  }
});

test('view repeat-open closes one interaction and revokes its retained input callbacks', async () => {
  const f = fixture(); const ui = uiFixture(); const view = new CuckooSettingsView();
  const opened = view.show(ui.ctx, f.callbacks); assert.equal(ui.panels.length, 1);
  const old = ui.panels[0]; old.handleInput(' ');
  await view.show(ui.ctx, f.callbacks); await opened;
  old.handleInput('\x13'); assert.equal(f.saves.length, 0);
  const next = view.show(ui.ctx, f.callbacks); assert.equal(ui.panels.length, 2);
  ui.panels[1].handleInput('\x1b'); await next; assert.equal(f.saves.length, 0);
});

test('policy editor stages a complete value; disposal cancels it without a later save or reopen', async () => {
  const f = fixture(); const ui = uiFixture(); const view = new CuckooSettingsView();
  let enter; const entered = new Promise(resolve => { enter = resolve; }); let request;
  f.callbacks.editPolicy = value => {
    request = value; enter();
    return new Promise(resolve => value.signal.addEventListener('abort', () => resolve({ kind: 'tokens', value: 9000 }), { once: true }));
  };
  const opened = view.show(ui.ctx, f.callbacks); ui.panels[0].handleInput('p'); await entered;
  view.dispose(); await opened;
  assert.equal(request.signal.aborted, true); assert.equal(ui.panels.length, 1); assert.equal(f.saves.length, 0);
  await view.show(ui.ctx, f.callbacks); assert.equal(ui.panels.length, 1);
});

test('policy editing returns to same scope and remains unsaved until explicit apply', async () => {
  const f = fixture(); const ui = uiFixture(); const view = new CuckooSettingsView();
  f.callbacks.editPolicy = async request => { assert.equal(request.scope, 'project'); return { kind: 'tokens', value: 4321 }; };
  const opened = view.show(ui.ctx, f.callbacks); ui.panels[0].handleInput('\t'); ui.panels[0].handleInput('p');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.panels.length, 2); assert.equal(f.saves.length, 0);
  assert.match(ui.panels[1].render(100).join('\n'), /4321 additional tokens/);
  ui.panels[1].handleInput('\x13'); assert.equal(f.saves[0].scope, 'project');
  assert.deepEqual(f.read().effective.policy, { kind: 'tokens', value: 4321 });
  ui.panels[1].handleInput('\x1b'); await opened;
});

test('noninteractive settings never open custom UI or write preferences', async () => {
  const f = fixture(); const ui = uiFixture(); ui.ctx.mode = 'rpc';
  await new CuckooSettingsView().show(ui.ctx, f.callbacks);
  assert.equal(ui.panels.length, 0); assert.equal(f.saves.length, 0); assert.match(ui.notices[0][0], /TUI/);
});
