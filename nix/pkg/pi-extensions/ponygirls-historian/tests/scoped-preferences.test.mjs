import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PreferenceStore, DEFAULT_FOCUS } from '../src/preferences.ts';
import { acquireSessionLock } from '../src/store.ts';
const a = { provider: 'a', id: 'a', thinking: 'off' };
const b = { provider: 'b', id: 'b', thinking: 'high' };
function sparseFixture(t, managedModel) {
  const dir = mkdtempSync(join(tmpdir(), 'historian-sparse-global-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const agentDir = join(dir, 'agent');
  mkdirSync(agentDir);

  const managedPath = join(agentDir, 'historian-defaults.json');
  writeFileSync(managedPath, JSON.stringify({
    version: 1,
    journalRoot: null,
    model: managedModel,
  }));

  const preferences = new PreferenceStore(
    join(agentDir, 'historian.json'),
  );

  return {
    dir,
    agentDir,
    managedPath,
    preferences,
    document() {
      return JSON.parse(readFileSync(preferences.path, 'utf8'));
    },
  };
}

test('legacy global reads remain byte unchanged and expose semantic presence', t => {
  for (const model of [null, b]) {
    const f = sparseFixture(t, a);
    const document = {
      version: 1,
      enabled: false,
      enabledGeneration: 7,
      model,
      focus: 'Legacy focus',
      approvedModel: a,
    };
    const bytes = `${JSON.stringify(document, null, 2)}\n`;
    writeFileSync(f.preferences.path, bytes);

    const managedBytes = readFileSync(f.managedPath, 'utf8');

    assert.deepEqual(f.preferences.read(), {
      enabled: false,
      enabledGeneration: 7,
      model: model === null ? a : b,
      focus: 'Legacy focus',
      approvedModel: a,
    });

    const expectedOverrides = {
      enabled: false,
      focus: 'Legacy focus',
    };
    if (model !== null) expectedOverrides.model = b;

    assert.deepEqual(
      f.preferences.readOverrides(),
      expectedOverrides,
    );

    assert.deepEqual(
      f.preferences.unmergedSnapshot().local,
      {
        ...expectedOverrides,
        enabledGeneration: 7,
        approvedModel: a,
      },
    );

    assert.equal(readFileSync(f.preferences.path, 'utf8'), bytes);
    assert.equal(readFileSync(f.managedPath, 'utf8'), managedBytes);
  }
});

test('sparse settings remain independent across generic and legacy domain updates', t => {
  const f = sparseFixture(t, a);

  assert.deepEqual(f.preferences.readOverrides(), {});
  assert.equal(f.preferences.unmergedSnapshot().local, null);

  f.preferences.updateOverrides(() => ({
    set: { focus: 'Only this focus' },
  }));

  assert.deepEqual(f.document(), {
    version: 2,
    focus: 'Only this focus',
    enabledGeneration: 0,
    approvedModel: null,
  });

  f.preferences.update(() => ({ enabled: true }));

  assert.deepEqual(f.document(), {
    version: 2,
    enabled: true,
    focus: 'Only this focus',
    enabledGeneration: 1,
    approvedModel: null,
  });

  f.preferences.update(() => ({ approvedModel: a }));
  f.preferences.updateOverrides(() => ({
    set: { model: b },
  }));

  assert.deepEqual(f.preferences.readOverrides(), {
    enabled: true,
    model: b,
    focus: 'Only this focus',
  });
  assert.deepEqual(f.preferences.read().approvedModel, a);
  assert.equal(f.preferences.read().enabledGeneration, 1);

  f.preferences.updateOverrides(() => ({
    unset: ['focus'],
  }));

  assert.deepEqual(f.preferences.readOverrides(), {
    enabled: true,
    model: b,
  });
  assert.equal(f.preferences.read().focus, DEFAULT_FOCUS);
  assert.deepEqual(f.preferences.read().approvedModel, a);
});

test('model reset follows managed defaults without materializing them', t => {
  const f = sparseFixture(t, a);
  const managedBytes = readFileSync(f.managedPath, 'utf8');

  f.preferences.writeOverrides({
    model: b,
    focus: 'Retained focus',
  });
  assert.deepEqual(f.preferences.read().model, b);

  f.preferences.updateOverrides(() => ({
    unset: ['model'],
  }));

  assert.equal(Object.hasOwn(f.document(), 'model'), false);
  assert.deepEqual(f.preferences.read().model, a);
  assert.equal(f.preferences.read().focus, 'Retained focus');

  f.preferences.update(() => ({ model: b }));
  f.preferences.update(() => ({ model: null }));

  assert.equal(Object.hasOwn(f.document(), 'model'), false);
  assert.deepEqual(f.preferences.read().model, a);
  assert.equal(readFileSync(f.managedPath, 'utf8'), managedBytes);

  // Preserve the historical null-as-inherit interpretation on input.
  writeFileSync(f.preferences.path, JSON.stringify({
    version: 2,
    enabledGeneration: 0,
    approvedModel: null,
    model: null,
  }));

  assert.deepEqual(f.preferences.readOverrides(), {});
  assert.deepEqual(f.preferences.read().model, a);
  assert.equal(
    Object.hasOwn(f.preferences.unmergedSnapshot().local, 'model'),
    false,
  );
});

test('generations track enablement while approval changes remain domain-owned', t => {
  const f = sparseFixture(t, a);

  f.preferences.updateOverrides(() => ({
    set: { enabled: true },
  }));
  assert.equal(f.preferences.read().enabledGeneration, 1);
  assert.equal(f.preferences.read().approvedModel, null);

  f.preferences.withDomainTransaction((_current, _overrides, commit) => {
    commit({
      set: {
        enabled: true,
        model: b,
        focus: 'Approved domain transaction',
      },
      approvedModel: b,
    });
  });

  assert.equal(f.preferences.read().enabledGeneration, 1);
  assert.deepEqual(f.preferences.read().approvedModel, b);

  f.preferences.updateOverrides(current => {
    // Mutating a detached callback snapshot cannot change stored approval.
    current.approvedModel = a;
    return { set: { focus: 'Generic focus edit' } };
  });

  assert.deepEqual(f.preferences.read().approvedModel, b);
  assert.equal(f.preferences.read().enabledGeneration, 1);

  f.preferences.updateOverrides(() => ({
    set: { enabled: false },
  }));
  assert.equal(f.preferences.read().enabledGeneration, 2);
  assert.deepEqual(f.preferences.read().approvedModel, b);

  f.preferences.updateOverrides(() => ({
    unset: ['enabled'],
  }));
  assert.equal(f.preferences.read().enabledGeneration, 2);
  assert.deepEqual(f.preferences.read().approvedModel, b);

  f.preferences.update(() => ({ approvedModel: null }));
  assert.equal(f.preferences.read().approvedModel, null);
  assert.equal(f.preferences.read().enabledGeneration, 2);

  f.preferences.updateScoped(() => ({
    settings: {
      set: { enabled: true, focus: 'Domain enabled again' },
    },
    approvedModel: b,
  }));

  assert.equal(f.preferences.read().enabledGeneration, 3);
  assert.deepEqual(f.preferences.read().approvedModel, b);
});

test('complete write/read and partial update preserve inherited model semantics', t => {
  const f = sparseFixture(t, a);

  f.preferences.write({
    enabled: true,
    model: null,
    focus: 'Complete write',
    approvedModel: a,
  });

  assert.deepEqual(f.preferences.read(), {
    enabled: true,
    enabledGeneration: 1,
    model: a,
    focus: 'Complete write',
    approvedModel: a,
  });
  assert.equal(Object.hasOwn(f.document(), 'model'), false);

  f.preferences.update(current => {
    assert.deepEqual(current.model, a);
    assert.equal(current.focus, 'Complete write');
    return { focus: 'Partial update' };
  });

  assert.equal(Object.hasOwn(f.document(), 'model'), false);
  assert.equal(f.preferences.read().focus, 'Partial update');
  assert.deepEqual(f.preferences.read().approvedModel, a);

  // Full sparse replacement changes only settings, not approval metadata.
  f.preferences.writeOverrides({ model: b });

  assert.deepEqual(f.preferences.readOverrides(), { model: b });
  assert.deepEqual(f.preferences.read().approvedModel, a);
  assert.equal(f.preferences.read().enabled, false);
  assert.equal(f.preferences.read().enabledGeneration, 2);
});

test('generic mutation schemas reject metadata and conflicting operations', t => {
  const f = sparseFixture(t, a);
  f.preferences.writeOverrides({ focus: 'Unchanged' });

  const before = readFileSync(f.preferences.path, 'utf8');

  for (const mutation of [
    { approvedModel: b },
    { set: { approvedModel: b } },
    { set: { enabledGeneration: 99 } },
    { unset: ['approvedModel'] },
    { unset: ['model', 'model'] },
    { set: { model: b }, unset: ['model'] },
    { set: { model: null } },
  ]) {
    assert.throws(() => {
      f.preferences.updateOverrides(() => mutation);
    });
    assert.equal(readFileSync(f.preferences.path, 'utf8'), before);
  }

  assert.throws(() => {
    f.preferences.writeOverrides({ approvedModel: b });
  });

  assert.throws(() => {
    f.preferences.withDomainTransaction((_current, _overrides, commit) => {
      commit({ enabledGeneration: 99 });
    });
  });

  assert.equal(readFileSync(f.preferences.path, 'utf8'), before);
});

test('domain commit writes while global and nested project locks remain held', t => {
  const f = sparseFixture(t, a);
  const globalDirectory = join(f.agentDir, 'historian');
  const projectDirectory = join(f.dir, 'project-authority');

  const result = f.preferences.withDomainTransaction(
    (current, overrides, commit) => {
      assert.equal(current.enabled, false);
      assert.deepEqual(overrides, {});

      assert.throws(
        () => acquireSessionLock(globalDirectory, 'global-preferences'),
        /already owned/,
      );

      const releaseProject = acquireSessionLock(
        projectDirectory,
        'project-settings',
      );

      try {
        commit({
          set: {
            enabled: true,
            model: b,
            focus: 'One mixed domain commit',
          },
          approvedModel: b,
        });

        // The authoritative write already happened inside both lock scopes.
        assert.deepEqual(f.document(), {
          version: 2,
          enabled: true,
          model: b,
          focus: 'One mixed domain commit',
          enabledGeneration: 1,
          approvedModel: b,
        });

        assert.throws(
          () => acquireSessionLock(globalDirectory, 'global-preferences'),
          /already owned/,
        );
        assert.throws(
          () => acquireSessionLock(projectDirectory, 'project-settings'),
          /already owned/,
        );
      } finally {
        releaseProject();
      }

      return 'committed';
    },
  );

  assert.equal(result, 'committed');

  const release = acquireSessionLock(
    globalDirectory,
    'global-preferences',
  );
  release();
});

test('commit is one-shot and cannot escape its synchronous callback', async t => {
  const f = sparseFixture(t, a);
  f.preferences.writeOverrides({ focus: 'Before' });

  let retained;

  f.preferences.withDomainTransaction((_current, _overrides, commit) => {
    retained = commit;
    commit({ set: { focus: 'Committed' } });

    assert.throws(
      () => commit({ set: { focus: 'Second' } }),
      /already used/,
    );
  });

  const committed = readFileSync(f.preferences.path, 'utf8');

  assert.throws(
    () => retained({ set: { focus: 'Too late' } }),
    /no longer active/,
  );
  assert.equal(readFileSync(f.preferences.path, 'utf8'), committed);

  assert.throws(
    () => f.preferences.withDomainTransaction(
      async (_current, _overrides, commit) => {
        await Promise.resolve();
        commit({ set: { enabled: true } });
      },
    ),
    /synchronous callbacks/,
  );

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readFileSync(f.preferences.path, 'utf8'), committed);

  assert.throws(
    () => f.preferences.withDomainTransaction(
      (_current, _overrides, commit) => {
        commit({ set: { focus: 'Committed before failure' } });
        throw new Error('Failure after commit');
      },
    ),
    /Failure after commit/,
  );

  // A callback failure is not a rollback guarantee.
  assert.equal(
    f.preferences.read().focus,
    'Committed before failure',
  );
});

test('generation overflow and invalid reads never silently fall back', t => {
  const f = sparseFixture(t, a);

  writeFileSync(f.preferences.path, JSON.stringify({
    version: 2,
    enabled: true,
    enabledGeneration: Number.MAX_SAFE_INTEGER,
    approvedModel: a,
  }));

  f.preferences.updateOverrides(() => ({
    set: { focus: 'No generation change' },
  }));

  const before = readFileSync(f.preferences.path, 'utf8');

  assert.throws(
    () => f.preferences.updateOverrides(() => ({
      unset: ['enabled'],
    })),
    /generation overflow/,
  );
  assert.equal(readFileSync(f.preferences.path, 'utf8'), before);

  for (const document of [
    {
      version: 2,
      enabledGeneration: 0,
      approvedModel: null,
      unknown: true,
    },
    {
      version: 2,
      enabledGeneration: -1,
      approvedModel: null,
    },
    {
      version: 2,
      enabledGeneration: 0,
    },
    {
      version: 2,
      enabledGeneration: 0,
      approvedModel: null,
      enabled: 'false',
    },
  ]) {
    writeFileSync(f.preferences.path, JSON.stringify(document));
    assert.throws(() => f.preferences.read());
    assert.throws(() => f.preferences.readOverrides());
    assert.throws(() => f.preferences.unmergedSnapshot());
  }

  rmSync(f.preferences.path);
  mkdirSync(f.preferences.path);

  assert.throws(
    () => f.preferences.readOverrides(),
    error => error instanceof Error &&
      'code' in error &&
      error.code === 'EISDIR',
  );
});
