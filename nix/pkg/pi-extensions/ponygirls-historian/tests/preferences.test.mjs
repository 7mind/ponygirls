import assert from 'node:assert/strict';
import test from 'node:test';
import { effectivePreferences, DEFAULT_FOCUS, MODEL_TYPE, CONSENT_TYPE, ENABLED_TYPE } from '../src/preferences.ts';
const a = { provider: 'a', id: 'a', thinking: 'off' };
const b = { provider: 'b', id: 'b', thinking: 'high' };
const defaults = { enabled: true, enabledGeneration: 1, model: a, approvedModel: a, focus: DEFAULT_FOCUS };
const setting = (id, customType, data) => ({ type: 'custom', id, parentId: null, timestamp: '2026-11-06T13:00:00Z', customType, data: { version: 1, sessionId: 'root', ...data } });
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
