// Specified Behavioral-Active / Blackbox-Group: every status entry point shows the same facts pane.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { homeRelative } from '@ponygirls/pi-ui';
import registerHistorian from '../index.ts';
import { HistorianController } from '../src/controller.ts';
import { digest } from '../src/evidence.ts';
import { DEFAULT_FOCUS, PreferenceStore } from '../src/preferences.ts';
import { HistorianWorker } from '../src/worker.ts';

const model = Object.freeze({ provider: 'fixture', id: 'scripted', thinking: 'off' });
const theme = { fg: (_color, value) => value, bg: (_color, value) => value, bold: value => value };
const keys = { matches: (data, action) => data === '\x1b' && action === 'tui.select.cancel' };
const click = { type: 'click', button: 'left', x: 0, y: 0 };

function uiFixture() {
  const h = { panels: [], notices: [], widgets: new Map() };
  h.ui = {
    setWidget(key, factory) { h.widgets.set(key, factory); },
    notify(message, level) { h.notices.push({ message, level }); },
    custom(factory) {
      return new Promise(resolve => {
        const record = { component: null, closed: false };
        h.panels.push(record);
        record.component = factory({ terminal: { rows: 40 }, requestRender() {} }, theme, keys, value => { record.closed = true; resolve(value); });
      });
    },
  };
  return h;
}

async function extensionFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'historian-status-view-'));
  const agentDir = join(directory, 'agent'), cwd = join(directory, 'project');
  mkdirSync(agentDir); mkdirSync(cwd);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const manager = SessionManager.inMemory();
  const handlers = new Map(), commands = new Map();
  const startUI = uiFixture(), commandUI = uiFixture();
  const ctxA = { cwd, mode: 'tui', hasUI: true, isProjectTrusted: () => true, sessionManager: manager,
    modelRegistry: { find: () => undefined, getAvailable: () => [] }, ui: startUI.ui };
  registerHistorian({
    on(name, handler) { handlers.set(name, handler); },
    registerCommand(name, command) { commands.set(name, command); },
    appendEntry(type, data) { manager.appendCustomEntry(type, data); },
    events: { emit() {} },
  });
  t.after(async () => {
    try { await handlers.get('session_shutdown')({ type: 'session_shutdown', reason: 'quit' }, ctxA); }
    finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(directory, { recursive: true, force: true });
    }
  });
  await handlers.get('session_start')({ type: 'session_start' }, ctxA);
  // Commands get a fresh context object, not the session_start object.
  return { agentDir, cwd, startUI, commandUI, ctxA, ctxB: { ...ctxA, ui: commandUI.ui }, command: commands.get('historian'),
    preferences: new PreferenceStore(join(agentDir, 'historian.json')) };
}

test('bare /historian and /historian status open the facts pane in the TUI; details keep the complete text', async t => {
  const f = await extensionFixture(t);
  for (const args of ['', 'status']) {
    const opened = f.commandUI.panels.length;
    const showing = f.command.handler(args, f.ctxB);
    await new Promise(setImmediate);
    assert.equal(f.commandUI.panels.length, opened + 1, `"/historian ${args}" opens a pane`);
    assert.deepEqual(f.commandUI.notices, [], 'the TUI shows the pane instead of printing the status');
    const pane = f.commandUI.panels.at(-1).component;
    for (const width of [60, 80, 100, 120, 170]) assert.ok(pane.render(width).every(line => visibleWidth(line) <= width), `width ${width}`);
    const facts = pane.render(120);
    assert.match(facts[0], /^── Historian ─+ off · global ──$/);
    assert.equal(facts[1], '  State      off (global setting) · not capturing this session');
    assert.equal(facts[2], '  Model      not configured · disclosure approval required');
    assert.equal(facts[3], `  Project    ${homeRelative(f.cwd, homedir())}`);
    assert.equal(facts[4], `  Journal    ${homeRelative(join(f.agentDir, 'historian', 'projects'), homedir())}/${digest(f.cwd).slice(0, 8)}…/journal.md`);
    assert.equal(facts.at(-1), '↑↓ scroll  d details  esc close');
    assert.doesNotMatch(facts.join('\n'), /Historian OFF|Disclosure approval:|Coverage:/);
    pane.handleInput('d');
    const details = pane.render(400).slice(1, -2).map(line => line.trimEnd()).filter(line => line !== '');
    // The same builder feeds print/RPC mode, so nothing shown before this pane existed is lost.
    await f.command.handler(args, { ...f.ctxB, mode: 'rpc' });
    assert.deepEqual(details, f.commandUI.notices.pop().message.split('\n'));
    assert.match(details[0], /^Historian OFF \(global\)$/);
    assert.ok(details.includes('Coverage: not capturing'));
    pane.handleInput('\x1b');
    await showing;
    assert.equal(f.commandUI.panels.at(-1).closed, true);
  }
});

test('outside the TUI the status stays the complete text notification', async t => {
  const f = await extensionFixture(t);
  for (const ctx of [{ ...f.ctxB, mode: 'rpc' }, { ...f.ctxB, mode: 'print' }, { ...f.ctxB, hasUI: false }]) {
    await f.command.handler('status', ctx);
    const notice = f.commandUI.notices.pop();
    assert.equal(notice.level, 'info');
    assert.match(notice.message, /^Historian OFF \(global\)\nProject: /);
    assert.match(notice.message, /\nError: none\nMarkdown projection error: none\nCoverage: not capturing\n/);
  }
  assert.equal(f.commandUI.panels.length, 0);
});

test('the badge click toggles the same facts pane', async t => {
  const f = await extensionFixture(t);
  f.preferences.update(() => ({ model }));
  await f.command.handler('on', { ...f.ctxB, mode: 'rpc' });
  const badge = () => f.startUI.widgets.get('historian')(null, theme);
  assert.equal(badge().handleMouse({ ...click, button: 'right' }), undefined);
  assert.equal(badge().handleMouse(click).handled, true);
  await new Promise(setImmediate);
  assert.equal(f.startUI.panels.length, 1);
  const facts = f.startUI.panels[0].component.render(120);
  assert.match(facts[0], /^── Historian ─+ on · session ──$/);
  // Two notices: no subagent history feed in this fixture, and the activation boundary.
  assert.equal(facts[1], '  State      on (session setting) · capturing this session · 2 coverage notices');
  assert.equal(facts[2], '  Model      fixture/scripted · off · disclosure approved');
  assert.equal(facts.at(-1), '↑↓ scroll  d details  esc close');
  f.startUI.panels[0].component.handleInput('d');
  assert.match(f.startUI.panels[0].component.render(120).join('\n'), /Historian ON \(session\)/);
  assert.equal(badge().handleMouse(click).handled, true);
  await new Promise(setImmediate);
  assert.equal(f.startUI.panels[0].closed, true, 'a second click closes the pane');
});

function controllerFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'historian-status-snapshot-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preferences = new PreferenceStore(join(dir, 'historian.json'));
  preferences.write({ enabled: true, model, approvedModel: model, focus: DEFAULT_FOCUS });
  const entries = [];
  const ctx = { cwd: dir, isProjectTrusted: () => false, sessionManager: { getSessionId: () => 'root', getEntries: () => entries },
    modelRegistry: { find: () => undefined }, ui: { notify() {} } };
  const pi = { events: { emit() {} }, appendEntry() {} };
  return { dir, entries, preferences, make: () => new HistorianController(pi, preferences, ctx, () => {}) };
}

test('the structured status agrees with the status text through failure, retry and recovery', async t => {
  const { make, entries, dir } = controllerFixture(t); let calls = 0;
  t.mock.method(HistorianWorker.prototype, 'run', async () => {
    if (++calls === 1) throw new SyntaxError('Synthetic malformed JSON');
    return { proposals: [], metrics: { responseChars: 2, usage: null }, meta: { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v1', usage: null } };
  });
  const controller = make(); t.after(() => controller.dispose());
  const before = controller.statusSnapshot();
  assert.equal(before.kind, 'ready');
  assert.deepEqual({ enabled: before.enabled, source: before.enabledSource, approved: before.disclosureApproved, model: before.model },
    { enabled: true, source: 'global', approved: true, model });
  assert.equal(before.project, dir);
  assert.equal(before.projectDigest, digest(dir));
  assert.equal(before.journal, join(controller.directory, 'journal.md'));
  assert.ok(controller.status().includes(`Journal: ${before.journal}\n`));
  assert.deepEqual({ capturing: before.capturing, attempts: before.attempts, queue: before.chronicle.queue }, { capturing: false, attempts: null, queue: null },
    'before the journal opens nothing is counted');
  assert.match(controller.status(), /Attempt diagnostics: no journal open/);
  await controller.reconcile();
  entries.push({ type: 'message', id: 'retry-accounting', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Synthetic experiment', timestamp: 1 } });
  await controller.reconcile(); await new Promise(resolve => setImmediate(resolve));
  const failed = controller.statusSnapshot();
  assert.match(controller.status(), /pending events: 1\n.*failed attempts: 1\/3/);
  // Two coverage notices: no subagent history feed in this fixture, and the activation boundary.
  assert.match(controller.status(), /\nCoverage: Subagent history feed unavailable; main-session evidence only; \S+ Activation\/attachment boundary: [^\n]*\n/);
  assert.deepEqual({ pending: failed.pendingEvents, failures: failed.failures, max: failed.maxFailures, capturing: failed.capturing, notices: failed.coverageNotices },
    { pending: 1, failures: 1, max: 3, capturing: true, notices: 2 });
  assert.ok(controller.status().includes(`\nError: ${failed.error}\n`));
  assert.notEqual(failed.error, null);
  assert.equal(failed.lastCommit, null);
  const later = performance.now() + 11000; t.mock.method(performance, 'now', () => later);
  await controller.reconcile(); await new Promise(resolve => setImmediate(resolve));
  const recovered = controller.statusSnapshot();
  assert.match(controller.status(), /Attempt totals: 2; validated: 1; failed: 1; recovered: 1; cancelled: 0; interrupted: 0; running: 0/);
  assert.deepEqual(recovered.attempts, { total: 2, running: 0, validated: 1, failed: 1, cancelled: 0, interrupted: 0, recovered: 1 });
  assert.deepEqual({ pending: recovered.pendingEvents, failures: recovered.failures, error: recovered.error, projection: recovered.projectionError, activity: recovered.activity },
    { pending: 0, failures: 0, error: null, projection: null, activity: 'idle' });
  assert.ok(controller.status().includes(`Last commit this runtime: ${recovered.lastCommit};`));
  assert.deepEqual(recovered.chronicle, { kind: 'ready', enabled: false, endpoint: '', uploading: false,
    queue: { pending: 0, stopped: 0, acknowledged: 0, otherDestinations: 0 }, error: null });
});

test('unusable upload settings and unreadable settings are reported by both the structured status and the text', async t => {
  const { make, preferences } = controllerFixture(t);
  const controller = make(); t.after(() => controller.dispose());
  writeFileSync(join(preferences.path, '..', 'historian-chronicle.json'), '{');
  assert.deepEqual(controller.statusSnapshot().chronicle, { kind: 'unavailable' });
  assert.match(controller.status(), /\nChronicle upload: unavailable \(invalid settings; no new upload authority\)\n/);
  writeFileSync(preferences.path, '{');
  const status = controller.statusSnapshot();
  assert.equal(status.kind, 'fault');
  assert.match(status.message, /^Invalid Historian defaults/);
  assert.equal(controller.status(), `Historian ERROR: Error: ${status.message}`);
});
