import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync,
  readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import registerHistorian from '../index.ts';
import {
  CONSENT_TYPE, ENABLED_TYPE, FOCUS_TYPE, PreferenceStore,
} from '../src/preferences.ts';
import { ProjectSettings } from '../src/project-settings.ts';
import {
  createHistorianSettingsController,
} from '../src/settings-view.ts';

const managedModel = Object.freeze({
  provider: 'fixture-a', id: 'managed', thinking: 'off',
});
const candidateModel = Object.freeze({
  provider: 'fixture-b', id: 'candidate', thinking: 'high',
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function eventually(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Fixture deadline');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function uiFixture() {
  const h = {
    panels: [], notices: [], inputs: [], inputValues: [],
    confirmations: [], answer: async () => true,
  };
  const theme = {
    fg: (_color, value) => value,
    bg: (_color, value) => value,
    bold: value => value,
  };
  const keys = {
    matches(data, action) {
      return data === {
        'tui.select.up': '\x1b[A',
        'tui.select.down': '\x1b[B',
        'tui.select.confirm': '\r',
        'tui.select.cancel': '\x1b',
      }[action];
    },
  };
  h.ui = {
    setWidget() {},
    notify(message, level) { h.notices.push({ message, level }); },
    async input(title, placeholder, options) {
      h.inputs.push({ title, placeholder, signal: options.signal });
      return h.inputValues.shift();
    },
    custom(factory, options) {
      return new Promise((resolve, reject) => {
        const record = { component: null, closed: false };
        const done = value => {
          if (record.closed) return;
          record.closed = true;
          record.component?.dispose?.();
          resolve(value);
        };
        try {
          record.component = factory(
            { terminal: { rows: 40 }, requestRender() {} },
            theme, keys, done,
          );
          h.panels.push(record);
          record.component.render(100);
          if (options !== undefined && options.blocked?.kind === 'permission') {
            const rendered = record.component.render(20000);
            const request = { title: options.blocked.message, prompt: JSON.parse(rendered[2]) };
            h.confirmations.push(request);
            void Promise.resolve().then(() => h.answer(request)).then(accepted => {
              if (record.closed) return;
              if (accepted) record.component.handleInput('\x1b[C');
              record.component.handleInput('\r');
            }, reject);
          }
        } catch (error) {
          reject(error);
        }
      });
    },
  };
  return h;
}

function adapterFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'historian-ui-'));
  const agentDir = join(directory, 'agent');
  const cwd = join(directory, 'project');
  mkdirSync(agentDir);
  mkdirSync(cwd);

  const managedPath = join(agentDir, 'historian-defaults.json');
  const journalRoot = join(agentDir, 'managed-journals');
  const managedBytes = JSON.stringify({
    version: 1, journalRoot, model: managedModel,
  });
  writeFileSync(managedPath, managedBytes);

  const preferences = new PreferenceStore(
    join(agentDir, 'historian.json'),
  );
  const manager = SessionManager.inMemory();
  const dialogs = uiFixture();
  const state = { current: true, trusted: true };
  const ctx = {
    cwd, mode: 'tui', hasUI: true,
    isProjectTrusted: () => state.trusted,
    sessionManager: manager,
    ui: dialogs.ui,
  };
  const owner = new ProjectSettings(
    {
      appendEntry(type, data) {
        manager.appendCustomEntry(type, data);
      },
    },
    preferences,
    cwd,
    () => state.current,
    { token: randomUUID },
  );
  const controllers = [];
  const applyRequests = [];
  const applied = [];
  const callbacks = {
    current: () => state.current,
    read: () => owner.settingsSnapshot(ctx),
    apply(scope, changes, signal, target, confirm) {
      applyRequests.push({ scope, changes, signal, target });
      return owner.applyScoped(
        ctx, scope, changes, signal, target, confirm,
      );
    },
    applied(snapshot, scope) { applied.push({ snapshot, scope }); },
  };
  const projectTarget = owner.read(ctx, null).projectSnapshot.target;

  t.after(() => {
    state.current = false;
    for (const controller of controllers) controller.dispose();
    owner.dispose();
    rmSync(directory, { recursive: true, force: true });
  });

  return {
    directory, preferences, manager, dialogs, state, ctx, owner,
    callbacks, applied, applyRequests, managedPath, managedBytes,
    journalRoot, projectTarget,
    make() {
      const controller = createHistorianSettingsController(callbacks, ctx);
      controllers.push(controller);
      return controller;
    },
  };
}

function select(controller, id) {
  const index = controller.state().rows.findIndex(row => row.id === id);
  assert.ok(index >= 0, `Missing Historian field ${id}`);
  controller.select(index);
}

function row(controller, id) {
  const result = controller.state().rows.find(item => item.id === id);
  assert.ok(result, `Missing Historian field ${id}`);
  return result;
}

async function run(action) {
  assert.ok(action, 'Expected external settings action');
  await action.run(new AbortController().signal);
}

async function edit(controller, dialogs, field, value) {
  select(controller, field);
  dialogs.inputValues.push(value);
  await run(controller.beginEdit());
}

async function stageOn(f, scope) {
  const controller = f.make();
  controller.selectScope(scope);
  await edit(
    controller, f.dialogs, 'model',
    'fixture-b candidate high',
  );
  await edit(controller, f.dialogs, 'focus', 'Candidate-only focus');
  select(controller, 'enabled');
  controller.toggleSelected();
  return controller;
}

function assertUntouched(f) {
  assert.equal(existsSync(f.preferences.path), false);
  assert.deepEqual(f.preferences.readOverrides(), {});
  assert.equal(f.preferences.read().approvedModel, null);
  assert.equal(
    f.manager.getEntries().filter(entry => entry.type === 'custom').length,
    0,
  );
  assert.equal(existsSync(f.projectTarget), false);
  assert.equal(readFileSync(f.managedPath, 'utf8'), f.managedBytes);
}

test('managed model/root are truthful read-only UI metadata', async t => {
  const f = adapterFixture(t);
  const controller = f.make();

  assert.deepEqual(
    controller.state().rows.map(item => item.id),
    ['enabled', 'model', 'focus'],
  );
  assert.equal(row(controller, 'model').origin, 'managed');
  assert.equal(row(controller, 'model').localSet, false);
  assert.match(row(controller, 'model').description, /read-only/);
  assert.ok(
    row(controller, 'model').description.includes('fixture-a/managed'),
  );
  assert.ok(
    row(controller, 'enabled').description.includes(f.journalRoot),
  );
  assert.match(row(controller, 'enabled').description, /read-only/);
  assert.match(row(controller, 'enabled').inactive, /OFF/);
  assertUntouched(f);

  controller.selectScope('global');
  await edit(controller, f.dialogs, 'focus', 'Writable global focus');
  await run(controller.beginApply());

  assert.deepEqual(f.preferences.readOverrides(), {
    focus: 'Writable global focus',
  });
  assert.deepEqual(f.preferences.read().model, managedModel);
  assert.equal(f.preferences.read().approvedModel, null);
  assert.equal(f.preferences.journalRoot(), f.journalRoot);
  assert.equal(readFileSync(f.managedPath, 'utf8'), f.managedBytes);
  assert.equal(f.dialogs.confirmations.length, 0);
});

for (const scope of ['global', 'session', 'project']) {
  test(`${scope}: staged model/focus/ON confirms only the candidate on Apply`, async t => {
    const f = adapterFixture(t);
    const controller = await stageOn(f, scope);

    assert.equal(controller.pending(scope).length, 3);
    assert.equal(f.dialogs.confirmations.length, 0);
    assert.equal(f.applyRequests.length, 0);
    assertUntouched(f);

    f.dialogs.answer = async request => {
      assert.match(request.prompt, /fixture-b\/candidate/);
      assert.match(request.prompt, /Thinking: high/);
      assert.doesNotMatch(request.prompt, /fixture-a\/managed/);
      assert.ok(f.applyRequests.at(-1).signal instanceof AbortSignal);
      assertUntouched(f);
      return true;
    };

    await run(controller.beginApply());

    assert.equal(f.dialogs.confirmations.length, 1);
    assert.equal(f.applyRequests.length, 1);
    assert.equal(f.applyRequests[0].scope, scope);
    assert.equal(f.applied.length, 1);
    assert.deepEqual(controller.pending(scope), []);

    const actual = f.owner.read(f.ctx, null);
    assert.equal(actual.enabled, true);
    assert.deepEqual(actual.model, candidateModel);
    assert.equal(actual.focus, 'Candidate-only focus');
    assert.equal(actual.disclosureApproved, true);

    if (scope === 'global') {
      assert.deepEqual(
        f.preferences.read().approvedModel,
        candidateModel,
      );
    } else {
      assert.equal(f.preferences.read().approvedModel, null);
    }

    if (scope === 'project') {
      const document = JSON.parse(
        readFileSync(f.projectTarget, 'utf8'),
      );
      assert.equal(Object.hasOwn(document, 'approvedModel'), false);
      assert.equal(Object.hasOwn(document, 'disclosureApproved'), false);
    }

    assert.equal(readFileSync(f.managedPath, 'utf8'), f.managedBytes);
  });

  for (const outcome of ['decline', 'abort']) {
    test(`${scope}: ${outcome} keeps the mixed draft without issuing approval`, async t => {
      const f = adapterFixture(t);
      const controller = await stageOn(f, scope);
      const pending = structuredClone(controller.pending(scope));
      const answer = deferred();
      f.dialogs.answer = () => outcome === 'decline'
        ? Promise.resolve(false)
        : answer.promise;

      const action = controller.beginApply();
      assert.ok(action);
      const abort = new AbortController();
      const running = action.run(abort.signal);
      t.after(() => {
        abort.abort();
        answer.resolve(false);
      });

      await eventually(() => f.dialogs.confirmations.length === 1);
      if (outcome === 'abort') {
        assert.equal(
          f.applyRequests[0].signal,
          abort.signal,
        );
        abort.abort();
        answer.resolve(true);
      }
      await running;

      assert.deepEqual(controller.pending(scope), pending);
      assert.equal(f.applied.length, 0);
      assert.equal(f.owner.read(f.ctx, null).disclosureApproved, false);
      assert.match(
        controller.state().notice,
        /cancel|abort|did not complete/i,
      );
      assertUntouched(f);
    });
  }
}

test('cancelled owner editors preserve existing drafts, not inheritance', async t => {
  const f = adapterFixture(t);
  const controller = f.make();

  await edit(controller, f.dialogs, 'focus', 'Retained draft');
  const before = structuredClone(controller.pending('session'));

  await edit(controller, f.dialogs, 'model', undefined);
  await edit(controller, f.dialogs, 'focus', undefined);

  assert.deepEqual(controller.pending('session'), before);
  assert.equal(f.dialogs.confirmations.length, 0);
  assert.equal(f.applyRequests.length, 0);
  assertUntouched(f);
});

test('project draft is pinned to its target and cannot move with cwd', async t => {
  const f = adapterFixture(t);
  const controller = f.make();
  controller.selectScope('project');
  await edit(controller, f.dialogs, 'focus', 'Old target draft');

  const nextCwd = join(f.directory, 'other-project');
  mkdirSync(nextCwd);
  f.ctx.cwd = nextCwd;

  assert.equal(controller.reload(), true);
  const project = controller.state().scopes.find(
    item => item.scope === 'project',
  );
  assert.equal(project.editable, false);
  assert.match(project.reason, /another target/i);
  assert.equal(controller.beginApply(), null);
  assert.equal(controller.pending('project').length, 1);
  assert.equal(f.applyRequests.length, 0);
  assert.equal(f.dialogs.confirmations.length, 0);
  assert.equal(existsSync(f.projectTarget), false);
  assert.equal(
    existsSync(f.owner.read(f.ctx, null).projectSnapshot.target),
    false,
  );
});

test('untrusted project data is ignored and cannot launch an editor', t => {
  const f = adapterFixture(t);
  mkdirSync(join(f.ctx.cwd, '.pi'), { recursive: true });
  writeFileSync(f.projectTarget, '{malformed project document');
  f.state.trusted = false;

  const controller = f.make();
  const project = controller.state().scopes.find(
    item => item.scope === 'project',
  );
  assert.equal(project.editable, false);
  assert.match(project.reason, /trusted/i);

  controller.selectScope('project');
  select(controller, 'focus');
  assert.equal(controller.beginEdit(), null);
  assert.deepEqual(controller.pending('project'), []);
  assert.equal(f.dialogs.inputs.length, 0);
  assert.equal(f.dialogs.confirmations.length, 0);
  assert.equal(
    readFileSync(f.projectTarget, 'utf8'),
    '{malformed project document',
  );
});

test('authoritative read failures block Apply and preserve owner drafts', async t => {
  const f = adapterFixture(t);
  const controller = f.make();
  await edit(controller, f.dialogs, 'focus', 'Unsaved focus');
  const pending = structuredClone(controller.pending('session'));

  writeFileSync(f.preferences.path, '{');
  assert.equal(controller.reload(), false);
  assert.match(controller.state().notice, /reload failed/i);

  await run(controller.beginApply());

  assert.deepEqual(controller.pending('session'), pending);
  assert.equal(f.applyRequests.length, 0);
  assert.equal(f.dialogs.confirmations.length, 0);
  assert.equal(f.applied.length, 0);
  assert.equal(readFileSync(f.preferences.path, 'utf8'), '{');
  assert.match(controller.state().notice, /refresh failed/i);
  assert.throws(() => f.make(), /Invalid Historian defaults/);
});

async function extensionFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'historian-command-ui-'));
  const agentDir = join(directory, 'agent');
  const cwd = join(directory, 'project');
  mkdirSync(agentDir);
  mkdirSync(cwd);

  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const manager = SessionManager.inMemory();
  const handlers = new Map();
  const commands = new Map();
  const startUI = uiFixture();
  const commandUI = uiFixture();
  const ctxA = {
    cwd, mode: 'tui', hasUI: true,
    isProjectTrusted: () => true,
    sessionManager: manager,
    modelRegistry: {
      find: () => undefined,
      getAvailable: () => [],
    },
    ui: startUI.ui,
  };
  // Commands get a fresh context object, not the session_start object.
  const ctxB = { ...ctxA, ui: commandUI.ui };
  const preferences = new PreferenceStore(
    join(agentDir, 'historian.json'),
  );

  let appendHook = () => {};
  registerHistorian({
    on(name, handler) { handlers.set(name, handler); },
    registerCommand(name, command) { commands.set(name, command); },
    appendEntry(type, data) { manager.appendCustomEntry(type, data); appendHook(type, data); },
    events: { emit() {} },
  });

  t.after(async () => {
    try {
      await handlers.get('session_shutdown')(
        { type: 'session_shutdown', reason: 'quit' }, ctxA,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previous;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  await handlers.get('session_start')(
    { type: 'session_start' }, ctxA,
  );
  return {
    ctxA, ctxB, manager, preferences, startUI, commandUI, handlers,
    setAppendHook(value) { appendHook = value; },
    command: commands.get('historian'),
  };
}

test('legacy session ON cannot append enablement after consent callback retires its owner', async t => {
  const f = await extensionFixture(t); let shutdown;
  f.preferences.update(() => ({ model: managedModel }));
  f.setAppendHook(type => {
    if (type === CONSENT_TYPE) shutdown = f.handlers.get('session_shutdown')({ type: 'session_shutdown', reason: 'quit' }, f.ctxA);
  });
  await f.command.handler('on', f.ctxB); await shutdown;
  assert.equal(f.manager.getEntries().some(entry => entry.type === 'custom' && entry.customType === CONSENT_TYPE), true);
  assert.equal(f.manager.getEntries().some(entry => entry.type === 'custom' && entry.customType === ENABLED_TYPE), false);
});

test('real extension factory: bare status and functional fresh-context settings', {
  timeout: 15000,
}, async t => {
  const f = await extensionFixture(t);
  assert.notEqual(f.ctxA, f.ctxB);
  assert.equal(f.ctxA.cwd, f.ctxB.cwd);
  assert.equal(
    f.ctxA.sessionManager.getSessionId(),
    f.ctxB.sessionManager.getSessionId(),
  );

  await f.command.handler('', { ...f.ctxB, mode: 'rpc' });
  assert.match(f.commandUI.notices.at(-1).message, /^Historian OFF/);
  assert.equal(f.commandUI.panels.length, 0);
  assert.equal(existsSync(f.preferences.path), false);
  assert.equal(
    f.manager.getEntries().filter(entry => entry.type === 'custom').length,
    0,
  );

  f.commandUI.inputValues.push('Fresh command-context focus');
  const showing = f.command.handler('settings', f.ctxB);
  const errors = () => f.commandUI.notices.some(
    notice => notice.level === 'error',
  );

  await eventually(() => f.commandUI.panels.length >= 1 || errors());
  assert.equal(
    f.commandUI.panels.length, 1,
    JSON.stringify(f.commandUI.notices),
  );
  assert.equal(f.startUI.panels.length, 0);

  const first = f.commandUI.panels[0].component;
  assert.match(first.render(100).join('\n'), /Historian settings/);
  first.handleInput('\x1b[B');
  first.handleInput('\x1b[B');
  first.handleInput('\r');

  await eventually(() => f.commandUI.panels.length >= 2 || errors());
  assert.equal(
    f.commandUI.panels.length, 2,
    JSON.stringify(f.commandUI.notices),
  );
  assert.equal(f.commandUI.inputs.length, 1);
  assert.equal(f.startUI.inputs.length, 0);
  assert.equal(
    f.manager.getEntries().some(entry => entry.customType === FOCUS_TYPE),
    false,
    'Editing must only stage the focus',
  );

  f.commandUI.panels[1].component.handleInput('\x13');
  await eventually(() => f.commandUI.panels.length >= 3 || errors());
  assert.equal(
    f.commandUI.panels.length, 3,
    JSON.stringify(f.commandUI.notices),
  );

  const focus = f.manager.getEntries().filter(
    entry => entry.type === 'custom' && entry.customType === FOCUS_TYPE,
  );
  assert.equal(focus.length, 1);
  assert.equal(focus[0].data.focus, 'Fresh command-context focus');
  assert.equal(
    f.manager.getEntries().some(entry => entry.customType === CONSENT_TYPE),
    false,
  );
  assert.equal(f.commandUI.confirmations.length, 0);
  assert.equal(errors(), false);

  f.commandUI.panels[2].component.handleInput('\x1b');
  await showing;

  // Initial read failure must notify instead of mounting an unusable pane.
  writeFileSync(f.preferences.path, '{');
  const openings = f.commandUI.panels.length;
  await f.command.handler('settings', { ...f.ctxB });
  assert.equal(f.commandUI.panels.length, openings);
  assert.ok(f.commandUI.notices.some(
    notice => notice.level === 'error' &&
      /Invalid Historian defaults/.test(notice.message),
  ));
  assert.equal(readFileSync(f.preferences.path, 'utf8'), '{');
});
