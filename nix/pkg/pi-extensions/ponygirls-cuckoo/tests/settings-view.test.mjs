import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Key,
  matchesKey,
} from '@earendil-works/pi-tui';

import {
  CuckooSettingsView,
  bindSettingsCallbacks,
  createSettingsController,
} from '../src/settings-view.ts';

import {
  CuckooPreferences,
  PREFERENCES_TYPE,
  applyPreferenceChanges,
  resolvePreferences,
} from '../src/preferences.ts';

import {
  FEATURES,
} from '../src/features.ts';

import {
  DEFAULT_POLICY,
  policyText,
} from '../src/policy.ts';

function fixture() {
  const state = {
    layers: {
      global: {},
      project: {},
      session: {},
    },
    trusted: true,
    paths: {
      global: '/fixture/agent/cuckoo.json',
      project: '/fixture/project/.pi/cuckoo.json',
      session: 'session-A',
    },
  };

  const saves = [];
  const applied = [];

  function read() {
    const layers = structuredClone(state.layers);
    if (!state.trusted) layers.project = {};

    return {
      ...layers,
      effective: resolvePreferences(layers),
      projectTrusted: state.trusted,
      paths: { ...state.paths },
    };
  }

  const callbacks = {
    read,

    apply(scope, changes, signal, expectedTarget) {
      signal.throwIfAborted();

      const current = read();
      assert.equal(current.paths[scope], expectedTarget);

      if (scope === 'project' && !current.projectTrusted) {
        throw new Error('Project not trusted');
      }

      signal.throwIfAborted();

      saves.push({
        scope,
        changes: structuredClone(changes),
        signal,
        expectedTarget,
      });

      state.layers[scope] = applyPreferenceChanges(
        state.layers[scope],
        changes,
      );
    },

    applied(snapshot, scope) {
      applied.push({
        snapshot: structuredClone(snapshot),
        scope,
      });
    },

    async editPolicy() {
      return undefined;
    },
  };

  return {
    callbacks,
    saves,
    applied,

    setLayers(value) {
      state.layers = structuredClone(value);
    },

    setTrusted(value) {
      state.trusted = value;
    },

    setTarget(scope, target) {
      state.paths[scope] = target;
    },
  };
}

function select(controller, id) {
  const index = controller.state().rows.findIndex(row => row.id === id);
  assert.ok(index >= 0, `Missing row: ${id}`);
  controller.select(index);
}

function row(controller, id) {
  const found = controller.state().rows.find(item => item.id === id);
  assert.ok(found, `Missing row: ${id}`);
  return found;
}

async function run(action) {
  assert.ok(action, 'Expected an external settings action');
  await action.run(new AbortController().signal);
}

test('Cuckoo maps every owner field, source and dependency explanation', () => {
  const f = fixture();

  f.setLayers({
    global: {
      enabled: true,
      features: { evidence: true },
    },
    project: {
      features: { reader: true },
    },
    session: {
      features: { vectors: true },
    },
  });

  const controller = createSettingsController(f.callbacks);

  assert.deepEqual(
    controller.state().rows.map(item => item.id),
    [
      'enabled',
      ...FEATURES.map(feature => feature.id),
      'policy',
    ],
  );

  for (const feature of FEATURES) {
    const mapped = row(controller, feature.id);
    assert.equal(mapped.label, feature.label);
    assert.equal(mapped.description, feature.description);
    assert.equal(mapped.kind, 'boolean');
  }

  assert.equal(row(controller, 'enabled').origin, 'global');
  assert.equal(row(controller, 'reader').origin, 'project');
  assert.equal(row(controller, 'vectors').origin, 'session');
  assert.equal(row(controller, 'vectors').checked, true);
  assert.equal(
    row(controller, 'vectors').inactive,
    'ready by settings',
  );
  assert.equal(
    row(controller, 'policy').effectiveText,
    policyText(DEFAULT_POLICY),
  );
  assert.equal(row(controller, 'policy').checked, null);

  f.setTrusted(false);
  assert.equal(controller.reload(), true);

  assert.equal(row(controller, 'reader').origin, 'default');
  assert.match(
    row(controller, 'vectors').inactive,
    /reader is off/,
  );
  assert.equal(f.saves.length, 0);
});

test('Cuckoo translates one heterogeneous draft into its native atomic batch', async () => {
  const f = fixture();
  const edited = { kind: 'tokens', value: 4321 };
  let editorRequest;

  f.callbacks.editPolicy = async request => {
    editorRequest = request;
    return edited;
  };

  const controller = createSettingsController(f.callbacks);

  for (const feature of FEATURES) {
    select(controller, feature.id);
    controller.toggleSelected();
  }

  select(controller, 'enabled');
  controller.toggleSelected();

  select(controller, 'policy');
  await run(controller.beginEdit());

  assert.equal(editorRequest.scope, 'session');
  assert.deepEqual(editorRequest.value, DEFAULT_POLICY);
  assert.ok(editorRequest.signal instanceof AbortSignal);
  assert.equal(f.saves.length, 0);

  await run(controller.beginApply());

  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].scope, 'session');
  assert.equal(f.saves[0].expectedTarget, 'session-A');
  assert.ok(f.saves[0].signal instanceof AbortSignal);

  assert.deepEqual(
    f.saves[0].changes,
    [
      ...FEATURES.map(feature => ({
        field: 'feature',
        id: feature.id,
        value: true,
      })),
      { field: 'enabled', value: true },
      { field: 'policy', value: edited },
    ],
  );

  assert.equal(f.applied.length, 1);
  assert.equal(f.applied[0].scope, 'session');
  assert.deepEqual(
    f.applied[0].snapshot.effective.policy,
    edited,
  );
  assert.equal(
    f.applied[0].snapshot.effective.features.critic,
    true,
  );
});

test('Cuckoo translates inheritance to native null tombstones for every field', async () => {
  const f = fixture();

  f.setLayers({
    global: {},
    project: {},
    session: {
      enabled: true,
      policy: { kind: 'tokens', value: 9000 },
      features: {
        evidence: true,
        corrections: true,
        verifiers: true,
        reader: true,
        transfer: true,
        vectors: true,
        critic: true,
      },
    },
  });

  const controller = createSettingsController(f.callbacks);

  for (const item of controller.state().rows) {
    select(controller, item.id);
    controller.inheritSelected();
  }

  await run(controller.beginApply());

  assert.deepEqual(
    f.saves[0].changes,
    [
      { field: 'enabled', value: null },
      ...FEATURES.map(feature => ({
        field: 'feature',
        id: feature.id,
        value: null,
      })),
      { field: 'policy', value: null },
    ],
  );

  assert.deepEqual(f.callbacks.read().session, {});
});

test('policy cancellation is distinct from invalid/null policy results', async () => {
  for (const result of [
    undefined,
    null,
    { kind: 'tokens', value: 0 },
  ]) {
    const f = fixture();

    f.setLayers({
      global: {},
      project: {},
      session: {
        policy: { kind: 'tokens', value: 111 },
      },
    });

    f.callbacks.editPolicy = async () => result;

    const controller = createSettingsController(f.callbacks);
    select(controller, 'policy');
    await run(controller.beginEdit());

    assert.deepEqual(controller.pending('session'), []);
    assert.deepEqual(
      f.callbacks.read().session.policy,
      { kind: 'tokens', value: 111 },
    );
    assert.equal(f.saves.length, 0);

    assert.match(
      controller.state().notice,
      result === undefined ? /cancelled/i : /edit failed/i,
    );
  }
});

test('policy bridge rejects target changes and trust loss after awaiting', async () => {
  for (const change of ['target', 'trust']) {
    const f = fixture();
    let finish;
    let request;

    const edited = new Promise(resolve => {
      finish = resolve;
    });

    f.callbacks.editPolicy = value => {
      request = value;
      return edited;
    };

    const controller = createSettingsController(f.callbacks);
    controller.selectScope('project');
    select(controller, 'policy');

    const action = controller.beginEdit();
    assert.ok(action);

    const running = action.run(new AbortController().signal);
    assert.equal(request.scope, 'project');

    if (change === 'target') {
      f.setTarget(
        'project',
        '/fixture/other-project/.pi/cuckoo.json',
      );
    } else {
      f.setTrusted(false);
    }

    finish({ kind: 'tokens', value: 222 });
    await running;

    assert.deepEqual(controller.pending('project'), []);
    assert.equal(f.saves.length, 0);
    assert.match(
      controller.state().notice,
      change === 'target' ? /target changed/i : /trusted/i,
    );
  }
});

test('Cuckoo adapter forwards and awaits an asynchronous apply callback', async () => {
  const f = fixture();
  const originalApply = f.callbacks.apply;
  let finish;
  let forwarded;

  const permitted = new Promise(resolve => {
    finish = resolve;
  });

  f.callbacks.apply = async (
    scope,
    changes,
    signal,
    expectedTarget,
  ) => {
    forwarded = { scope, signal, expectedTarget };
    await permitted;

    // A callback that awaits owns these final checks.
    signal.throwIfAborted();
    originalApply(scope, changes, signal, expectedTarget);
  };

  const controller = createSettingsController(f.callbacks);
  controller.toggleSelected();

  const action = controller.beginApply();
  assert.ok(action);

  const abort = new AbortController();
  const running = action.run(abort.signal);

  assert.equal(controller.busy, true);
  assert.equal(forwarded.scope, 'session');
  assert.equal(forwarded.signal, abort.signal);
  assert.equal(forwarded.expectedTarget, 'session-A');
  assert.equal(f.saves.length, 0);
  assert.equal(f.applied.length, 0);

  finish();
  await running;

  assert.equal(controller.busy, false);
  assert.equal(f.saves.length, 1);
  assert.equal(f.applied.length, 1);
  assert.equal(controller.dirty('session'), false);
});

function nativeBinding() {
  const state = {
    global: {},
    project: {},
    trusted: true,
    sessionId: 'session-A',
    appends: [],
    writes: [],
  };

  const context = {
    cwd: '/fixture/project',
    isProjectTrusted: () => state.trusted,
    sessionManager: {
      getEntries: () => state.appends,
      getSessionId: () => state.sessionId,
    },
  };

  const preferences = new CuckooPreferences(
    {
      appendEntry(customType, data) {
        state.appends.push({
          type: 'custom',
          customType,
          data: structuredClone(data),
        });
      },
    },
    {
      path: '/fixture/agent/cuckoo.json',

      read() {
        return structuredClone(state.global);
      },

      write(value) {
        state.writes.push({
          scope: 'global',
          value: structuredClone(value),
        });
        state.global = structuredClone(value);
      },
    },
    path => ({
      path,

      read() {
        return structuredClone(state.project);
      },

      write(value) {
        state.writes.push({
          scope: 'project',
          path,
          value: structuredClone(value),
        });
        state.project = structuredClone(value);
      },
    }),
  );

  return {
    state,
    context,
    callbacks: bindSettingsCallbacks(
      preferences,
      context,
      async () => undefined,
      () => {},
    ),
  };
}

test('native binding checks cancellation, destination and trust before storage', () => {
  const f = nativeBinding();
  const changes = [
    { field: 'feature', id: 'reader', value: true },
  ];

  const sessionTarget = f.callbacks.read().paths.session;

  f.callbacks.apply(
    'session',
    changes,
    new AbortController().signal,
    sessionTarget,
  );

  assert.equal(f.state.appends.length, 1);
  assert.equal(
    f.state.appends[0].customType,
    PREFERENCES_TYPE,
  );
  assert.deepEqual(f.state.appends[0].data, {
    version: 1,
    sessionId: 'session-A',
    changes,
  });

  const aborted = new AbortController();
  aborted.abort();

  assert.throws(() => {
    f.callbacks.apply(
      'session',
      changes,
      aborted.signal,
      sessionTarget,
    );
  });

  f.state.sessionId = 'session-B';

  assert.throws(
    () => f.callbacks.apply(
      'session',
      changes,
      new AbortController().signal,
      sessionTarget,
    ),
    /target changed/i,
  );

  const projectTarget = f.callbacks.read().paths.project;
  f.context.cwd = '/fixture/other-project';

  assert.throws(
    () => f.callbacks.apply(
      'project',
      changes,
      new AbortController().signal,
      projectTarget,
    ),
    /target changed/i,
  );

  const currentProjectTarget = f.callbacks.read().paths.project;
  f.state.trusted = false;

  assert.throws(
    () => f.callbacks.apply(
      'project',
      changes,
      new AbortController().signal,
      currentProjectTarget,
    ),
    /trusted/i,
  );

  assert.equal(f.state.appends.length, 1);
  assert.equal(f.state.writes.length, 0);
});

function uiFixture() {
  const panels = [];
  const notices = [];

  const theme = {
    fg: (_color, text) => text,
    bg: (_color, text) => text,
    bold: text => text,
  };

  const keys = {
    matches(data, action) {
      const key = {
        'tui.select.up': Key.up,
        'tui.select.down': Key.down,
        'tui.select.confirm': Key.enter,
        'tui.select.cancel': Key.escape,
      }[action];

      return key !== undefined && matchesKey(data, key);
    },
  };

  const context = {
    mode: 'tui',
    hasUI: true,
    ui: {
      notify(...args) {
        notices.push(args);
      },

      custom(factory) {
        return new Promise((resolve, reject) => {
          let component;

          try {
            component = factory(
              { requestRender() {} },
              theme,
              keys,
              value => {
                component?.dispose?.();
                resolve(value);
              },
            );
            panels.push(component);
          } catch (error) {
            reject(error);
          }
        });
      },
    },
  };

  return { context, panels, notices };
}

test('Cuckoo view delegates disposal and rejects a late owner policy result', async () => {
  const f = fixture();
  const ui = uiFixture();
  const view = new CuckooSettingsView();

  let entered;
  let finish;
  let request;

  const editorEntered = new Promise(resolve => {
    entered = resolve;
  });

  const edited = new Promise(resolve => {
    finish = resolve;
  });

  f.callbacks.editPolicy = value => {
    request = value;
    entered();
    return edited;
  };

  const showing = view.show(ui.context, f.callbacks);
  assert.equal(ui.panels.length, 1);

  ui.panels[0].handleInput('\x1b[F');
  ui.panels[0].handleInput('\r');
  await editorEntered;

  view.dispose();
  await showing;

  assert.equal(request.signal.aborted, true);

  finish({ kind: 'tokens', value: 999 });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(ui.panels.length, 1);
  assert.equal(f.saves.length, 0);
  assert.equal(f.applied.length, 0);

  await view.show(ui.context, f.callbacks);
  assert.equal(ui.panels.length, 1);
});
