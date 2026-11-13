import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PREFERENCES, FilePreferenceStore, FileArchiveProjectStore } from '../src/preferences.ts';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { SESSION_PREFERENCES_TYPE, SESSION_SETTING_TYPE, SESSION_THRESHOLDS_TYPE, sessionOverrideFields } from '../src/session-settings.ts';

function directory(t) {
  const root = mkdtempSync(join(tmpdir(), 'archive-scoped-preferences-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('global sparse overrides distinguish inheritance without changing legacy full reads/writes', t => {
  const path = join(directory(t), 'archive.json'), store = new FilePreferenceStore(path);
  assert.deepEqual(store.readOverrides(), {}); assert.deepEqual(store.read(), DEFAULT_PREFERENCES);
  for (const legacy of ['{"version":1,"enabled":true}\n', '{"version":2,"enabled":false,"highWatermark":0.6,"lowWatermark":0.4}\n']) {
    writeFileSync(path, legacy); store.readOverrides(); store.read(); assert.equal(readFileSync(path, 'utf8'), legacy);
  }
  store.writeOverrides({ enabled: true });
  assert.deepEqual(store.read(), { ...DEFAULT_PREFERENCES, enabled: true });
  store.writeOverrides({ thresholds: { highWatermark: 0.8, lowWatermark: 0.3 } });
  assert.deepEqual(store.read(), { enabled: false, highWatermark: 0.8, lowWatermark: 0.3 });
  store.writeOverrides({}); assert.deepEqual(store.readOverrides(), {}); assert.deepEqual(store.read(), DEFAULT_PREFERENCES);
  store.write({ enabled: false, highWatermark: 0.9, lowWatermark: 0.7 });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { version: 2, enabled: false, highWatermark: 0.9, lowWatermark: 0.7 });
});

test('one native batch applies both settings and per-field reset never revives old records', () => {
  const manager = SessionManager.inMemory(); const sessionId = manager.getSessionId();
  manager.appendCustomEntry(SESSION_SETTING_TYPE, { version: 1, sessionId, enabled: true });
  manager.appendCustomEntry(SESSION_THRESHOLDS_TYPE, { version: 1, sessionId, thresholds: { highWatermark: 0, lowWatermark: 1 } });
  assert.throws(() => sessionOverrideFields(manager.getEntries(), sessionId));
  manager.appendCustomEntry(SESSION_PREFERENCES_TYPE, { version: 1, sessionId, changes: [
    { key: 'enabled', op: 'set', value: false }, { key: 'thresholds', op: 'set', value: { highWatermark: 0.8, lowWatermark: 0.2 } },
  ] });
  assert.deepEqual(sessionOverrideFields(manager.getEntries(), sessionId), { enabled: false, thresholds: { highWatermark: 0.8, lowWatermark: 0.2 } });
  manager.appendCustomEntry(SESSION_PREFERENCES_TYPE, { version: 1, sessionId, changes: [{ key: 'thresholds', op: 'inherit' }] });
  assert.deepEqual(sessionOverrideFields(manager.getEntries(), sessionId), { enabled: false });
  assert.deepEqual(sessionOverrideFields(manager.getEntries(), 'other-session'), {});
});

test('project pair is one validated sparse setting; malformed values never fall back', t => {
  const path = join(directory(t), 'project.json'), store = new FileArchiveProjectStore(path);
  assert.deepEqual(store.read(), {});
  store.write({ enabled: false, thresholds: { highWatermark: 0.75, lowWatermark: 0.5 } });
  assert.deepEqual(store.read(), { enabled: false, thresholds: { highWatermark: 0.75, lowWatermark: 0.5 } });
  for (const value of [{ thresholds: { highWatermark: 0.5, lowWatermark: 0.5 } }, { thresholds: { highWatermark: 0.7 } }, { enabled: null }, { unknown: true }]) assert.throws(() => store.write(value));
  store.write({}); assert.deepEqual(store.read(), {});
  writeFileSync(path, '{"version":1,"thresholds":{"highWatermark":2,"lowWatermark":0}}'); assert.throws(() => store.read());
  writeFileSync(path, 'not json'); assert.throws(() => store.read());
});
