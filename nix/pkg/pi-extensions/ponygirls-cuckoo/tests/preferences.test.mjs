import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager, CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent';
import { CuckooPreferences, FilePreferenceStore, DEFAULT_PREFERENCES, ENABLED_TYPE, POLICY_TYPE, THRESHOLD_TYPE, PREFERENCES_TYPE, FEATURE_TYPE_PREFIX, resolvePreferences, throughScope, sessionPreferences, applyPreferenceChanges, validateOverrides, validateChanges } from '../src/preferences.ts';
import { FEATURES, DEFAULT_FEATURES, featureActivation } from '../src/features.ts';

function fixture(t, storage) {
  const cwd = mkdtempSync(join(tmpdir(), 'cuckoo-controls-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const stores = new Map();
  function store(path) {
    if (!stores.has(path)) {
      if (storage === 'filesystem') stores.set(path, new FilePreferenceStore(path));
      else {
        let value = {};
        stores.set(path, { path, read: () => structuredClone(value), write: next => { value = validateOverrides(next); } });
      }
    }
    return stores.get(path);
  }
  const global = store(join(cwd, 'agent', 'cuckoo.json'));
  const project = store(join(cwd, CONFIG_DIR_NAME, 'cuckoo.json'));
  const manager = SessionManager.inMemory();
  const ctx = { cwd, sessionManager: manager, isProjectTrusted: () => true };
  const append = (type, data) => manager.appendCustomEntry(type, data);
  const preferences = new CuckooPreferences({ appendEntry: append }, global, store);
  return { cwd, global, project, manager, ctx, preferences, append, read: () => preferences.read(ctx), apply: (scope, changes) => preferences.apply(ctx, scope, changes, new AbortController().signal) };
}

// Specified BG contract, run against both the dummy and production file adapter.
for (const storage of ['memory', 'filesystem']) {
  test(`${storage}: each field resolves independently and false is an explicit override`, t => {
    const f = fixture(t, storage);
    assert.deepEqual(f.read().effective.features, DEFAULT_FEATURES);
    assert.equal(f.read().effective.enabled, false);
    assert.equal(f.read().effective.enabledSource, 'default');
    f.apply('global', [{ field: 'enabled', value: true }, { field: 'feature', id: 'evidence', value: true }, { field: 'policy', value: { kind: 'window', value: 20 } }]);
    f.apply('project', [{ field: 'feature', id: 'reader', value: true }, { field: 'feature', id: 'evidence', value: false }]);
    f.apply('session', [{ field: 'enabled', value: false }, { field: 'feature', id: 'vectors', value: true }]);
    const effective = f.read().effective;
    assert.equal(effective.enabled, false); assert.equal(effective.enabledSource, 'session');
    assert.equal(effective.features.evidence, false); assert.equal(effective.featureSources.evidence, 'project');
    assert.equal(effective.features.reader, true); assert.equal(effective.featureSources.reader, 'project');
    assert.equal(effective.features.vectors, true); assert.equal(effective.featureSources.vectors, 'session');
    assert.deepEqual(effective.policy, { kind: 'window', value: 20 }); assert.equal(effective.policySource, 'global');
    assert.equal(throughScope(f.read(), 'global').features.evidence, true);
    assert.equal(throughScope(f.read(), 'project').enabled, true);
    assert.equal(throughScope(f.read(), 'session').enabled, false);
  });

  test(`${storage}: resets remove only selected overrides and session apply is one native entry`, t => {
    const f = fixture(t, storage);
    f.apply('global', [{ field: 'enabled', value: true }, { field: 'feature', id: 'reader', value: true }]);
    const before = f.manager.getEntries().length;
    f.apply('session', [{ field: 'feature', id: 'reader', value: false }, { field: 'policy', value: { kind: 'tokens', value: 7000 } }]);
    assert.equal(f.manager.getEntries().length, before + 1);
    assert.equal(f.manager.getLeafEntry().customType, PREFERENCES_TYPE);
    f.apply('session', [{ field: 'feature', id: 'reader', value: null }]);
    assert.equal(f.read().effective.features.reader, true);
    assert.equal(f.read().effective.featureSources.reader, 'global');
    assert.deepEqual(f.read().effective.policy, { kind: 'tokens', value: 7000 });
    f.apply('global', [{ field: 'enabled', value: null }]);
    assert.deepEqual(f.global.read(), { features: { reader: true } });
    assert.equal(f.read().effective.enabled, false);
    f.apply('project', [{ field: 'feature', id: 'reader', value: false }]);
    f.apply('project', [{ field: 'feature', id: 'reader', value: null }]);
    assert.deepEqual(f.project.read(), {});
  });

  test(`${storage}: applying a stale dialog's selected fields preserves other current overrides`, t => {
    const f = fixture(t, storage);
    f.apply('project', [{ field: 'enabled', value: true }]);
    const opened = f.read();
    f.apply('project', [{ field: 'feature', id: 'reader', value: true }]);
    f.apply('project', [{ field: 'policy', value: { kind: 'tokens', value: 6000 } }]);
    assert.equal(opened.project.features, undefined);
    assert.deepEqual(f.project.read(), { enabled: true, features: { reader: true }, policy: { kind: 'tokens', value: 6000 } });
  });

  test(`${storage}: session overrides span branches but never configure a copied session`, t => {
    const f = fixture(t, storage);
    const root = f.append('anchor', {});
    f.apply('session', [{ field: 'feature', id: 'reader', value: true }]);
    f.manager.branch(root);
    assert.equal(f.read().effective.features.reader, true);
    assert.deepEqual(sessionPreferences(f.manager.getEntries(), 'another-session'), {});
    f.append(`${FEATURE_TYPE_PREFIX}retired-feature`, { version: 9, sessionId: 'another-session', enabled: 'invalid' });
    assert.equal(f.read().effective.features.reader, true, 'foreign configuration is not decoded as current preferences');
    f.apply('session', [{ field: 'feature', id: 'reader', value: null }]);
    assert.equal(f.read().effective.features.reader, false);
  });
}

test('untrusted project state is neither read nor written; trust is checked again at apply', t => {
  const f = fixture(t, 'memory');
  let accesses = 0;
  const preferences = new CuckooPreferences({ appendEntry: f.append }, f.global, () => { accesses++; throw new Error('project must not be opened'); });
  f.ctx.isProjectTrusted = () => false;
  assert.equal(preferences.read(f.ctx).projectTrusted, false);
  assert.equal(accesses, 0);
  assert.throws(() => preferences.apply(f.ctx, 'project', [{ field: 'enabled', value: true }], new AbortController().signal), /trusted/);
  assert.equal(accesses, 0);
  f.ctx.isProjectTrusted = () => true; f.read();
  f.ctx.isProjectTrusted = () => false;
  assert.throws(() => f.apply('project', [{ field: 'enabled', value: true }]), /trusted/);
  assert.deepEqual(f.project.read(), {});
});

test('legacy global formats preserve meaning, do not rewrite on read, and write sparse v3 explicitly', t => {
  const f = fixture(t, 'filesystem'); mkdirSync(join(f.cwd, 'agent'));
  for (const [document, expected] of [
    [{ version: 1, enabled: true, thresholdPercent: 12 }, { kind: 'relative', value: 12 }],
    [{ version: 2, enabled: false, policy: { kind: 'window', value: 16 } }, { kind: 'window', value: 16 }],
    [{ version: 2, enabled: true, policy: { kind: 'tokens', value: 3200 } }, { kind: 'tokens', value: 3200 }],
  ]) {
    const original = JSON.stringify(document, null, 2);
    writeFileSync(f.global.path, original);
    assert.deepEqual(f.read().effective.policy, expected);
    assert.deepEqual(f.read().effective.features, DEFAULT_FEATURES);
    assert.equal(readFileSync(f.global.path, 'utf8'), original);
    f.apply('global', [{ field: 'feature', id: 'reader', value: true }]);
    const saved = JSON.parse(readFileSync(f.global.path, 'utf8'));
    assert.equal(saved.version, 3); assert.deepEqual(saved.policy, expected);
    assert.deepEqual(saved.features, { reader: true });
  }
});

test('legacy session entries and batched changes follow one chronological per-field override order', () => {
  const manager = SessionManager.inMemory(); const sessionId = manager.getSessionId();
  manager.appendCustomEntry(ENABLED_TYPE, { version: 1, sessionId, enabled: true });
  manager.appendCustomEntry(THRESHOLD_TYPE, { version: 1, sessionId, thresholdPercent: 10 });
  manager.appendCustomEntry(`${FEATURE_TYPE_PREFIX}reader`, { version: 1, sessionId, enabled: true });
  manager.appendCustomEntry(PREFERENCES_TYPE, { version: 1, sessionId, changes: [{ field: 'enabled', value: null }, { field: 'feature', id: 'reader', value: false }] });
  manager.appendCustomEntry(POLICY_TYPE, { version: 1, sessionId, policy: { kind: 'tokens', value: 12 } });
  assert.deepEqual(sessionPreferences(manager.getEntries(), sessionId), { policy: { kind: 'tokens', value: 12 }, features: { reader: false } });
});

test('a later valid field override repairs an older invalid value without reviving it on reset', () => {
  const manager = SessionManager.inMemory(); const sessionId = manager.getSessionId();
  manager.appendCustomEntry(POLICY_TYPE, { version: 1, sessionId, policy: { kind: 'tokens', value: -1 } });
  assert.throws(() => sessionPreferences(manager.getEntries(), sessionId), /policy|growth/);
  manager.appendCustomEntry(POLICY_TYPE, { version: 1, sessionId, policy: { kind: 'window', value: 15 } });
  assert.deepEqual(sessionPreferences(manager.getEntries(), sessionId), { policy: { kind: 'window', value: 15 } });
  manager.appendCustomEntry(PREFERENCES_TYPE, { version: 1, sessionId, changes: [{ field: 'policy', value: null }] });
  assert.deepEqual(sessionPreferences(manager.getEntries(), sessionId), {});
});

test('invalid file and session values fail without repair, coercion or silent fallback', t => {
  const f = fixture(t, 'filesystem'); mkdirSync(join(f.cwd, 'agent'));
  for (const document of [[], null, { version: 4 }, { version: 3, enabled: 'false' }, { version: 3, features: { reader: 1 } },
    { version: 3, features: { typo: true } }, { version: 3, credentials: 'not-an-actual-secret' }, { version: 3, policy: { kind: 'tokens', value: 1, extra: true } },
    { version: 2, enabled: true }, { version: 1, enabled: true, thresholdPercent: 0 }]) {
    const raw = JSON.stringify(document); writeFileSync(f.global.path, raw);
    assert.throws(() => f.read());
    assert.throws(() => f.apply('global', [{ field: 'enabled', value: false }]));
    assert.equal(readFileSync(f.global.path, 'utf8'), raw);
  }
  for (const changes of [[{ field: 'feature', id: 'reader', value: 'true' }], [{ field: 'feature', id: 'unknown', value: false }],
    [{ field: 'enabled', value: true, approval: true }], [{ field: 'enabled', value: false }, { field: 'enabled', value: true }]]) {
    assert.throws(() => validateChanges(changes));
  }
  assert.equal(existsSync(f.project.path), false);
});

test('feature intent is preserved while master/dependencies are off and activation is not authorization', () => {
  const enabled = { ...DEFAULT_FEATURES, corrections: true, verifiers: true, vectors: true, critic: true };
  for (const id of ['corrections', 'verifiers', 'critic']) {
    assert.deepEqual(featureActivation(true, enabled, id), { activeBySettings: false, reasons: ['evidence is off'] });
  }
  assert.deepEqual(featureActivation(true, enabled, 'vectors'), { activeBySettings: false, reasons: ['reader is off'] });
  assert.equal(enabled.vectors, true);
  for (const { id } of FEATURES) assert.equal(featureActivation(false, { ...enabled, [id]: true }, id).activeBySettings, false);
  assert.equal(featureActivation(true, { ...enabled, reader: true }, 'vectors').activeBySettings, true);
  assert.deepEqual(DEFAULT_PREFERENCES.features, DEFAULT_FEATURES);
  assert.deepEqual(resolvePreferences({ global: {}, project: {}, session: {} }).policy, DEFAULT_PREFERENCES.policy);
  assert.deepEqual(applyPreferenceChanges({ features: { reader: true } }, [{ field: 'feature', id: 'reader', value: null }]), {});
});
