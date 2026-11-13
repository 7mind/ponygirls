import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PreferenceStore, effectivePreferences, DEFAULT_FOCUS, MODEL_TYPE, CONSENT_TYPE, ENABLED_TYPE } from '../src/preferences.ts';
const a = { provider: 'a', id: 'a', thinking: 'off' };
const b = { provider: 'b', id: 'b', thinking: 'high' };
const defaults = { enabled: true, enabledGeneration: 1, model: a, approvedModel: a, focus: DEFAULT_FOCUS };
const setting = (id, customType, data) => ({ type: 'custom', id, parentId: null, timestamp: '2026-11-06T13:00:00Z', customType, data: { version: 1, sessionId: 'root', ...data } });
test('managed defaults remain read-only, OFF and unapproved, with explicit writable model overrides', t => {
  const dir = mkdtempSync(join(tmpdir(), 'historian-managed-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agentDir = join(dir, 'agent'); mkdirSync(agentDir);
  const managedPath = join(dir, 'managed.json'); const link = join(agentDir, 'historian-defaults.json');
  const managed = { version: 1, journalRoot: join(dir, 'journals'), model: a };
  writeFileSync(managedPath, JSON.stringify(managed)); symlinkSync(managedPath, link);
  const preferences = new PreferenceStore(join(agentDir, 'historian.json'));
  assert.deepEqual(preferences.read().model, a);
  assert.equal(preferences.read().enabled, false); assert.equal(preferences.read().approvedModel, null);
  assert.equal(preferences.journalRoot(), managed.journalRoot);
  preferences.update(() => ({ enabled: true, approvedModel: a }));
  assert.equal(Object.hasOwn(JSON.parse(readFileSync(preferences.path, 'utf8')), 'model'), false, 'enablement must not materialize an inherited model');
  assert.equal(lstatSync(link).isSymbolicLink(), true); assert.deepEqual(JSON.parse(readFileSync(link, 'utf8')), managed);
  writeFileSync(managedPath, JSON.stringify({ ...managed, model: b }));
  assert.deepEqual(preferences.read().model, b); assert.deepEqual(preferences.read().approvedModel, a, 'declarative model changes cannot grant consent');
  preferences.update(() => ({ model: a })); assert.deepEqual(preferences.read().model, a);
  preferences.update(() => ({ model: null })); assert.deepEqual(preferences.read().model, b);
  assert.equal(preferences.read().enabledGeneration, 1);
  assert.deepEqual(effectivePreferences(preferences.read(), [setting('m', MODEL_TYPE, { model: a })], 'root').model, a);
  writeFileSync(managedPath, JSON.stringify({ ...managed, journalRoot: 'relative/path' }));
  assert.throws(() => preferences.read(), /absolute/);
});

test('session model consent has independent precedence from enabled inheritance', () => {
  const entries = [setting('m', MODEL_TYPE, { model: b }), setting('c', CONSENT_TYPE, { model: b })];
  const effective = effectivePreferences(defaults, entries, 'root');
  assert.deepEqual(effective.model, b); assert.deepEqual(effective.approvedModel, b);
  entries.push(setting('clear', CONSENT_TYPE, { model: null }));
  assert.equal(effectivePreferences(defaults, entries, 'root').approvedModel, null);
});
test('forked session overrides do not authorize a new session', () => {
  const effective = effectivePreferences({ ...defaults, enabled: false }, [setting('e', ENABLED_TYPE, { enabled: true }), setting('m', MODEL_TYPE, { model: b }), setting('c', CONSENT_TYPE, { model: b })], 'fork');
  assert.equal(effective.enabled, false); assert.deepEqual(effective.model, a);
});
