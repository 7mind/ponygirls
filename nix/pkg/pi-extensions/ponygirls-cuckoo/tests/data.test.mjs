import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { DEFAULT_PREFERENCES, ENABLED_TYPE, THRESHOLD_TYPE, POLICY_TYPE, FilePreferenceStore, effectivePreferences } from '../src/preferences.ts';
import { validatePolicy } from '../src/policy.ts';
import { REPORT_TYPE, MAX_FIELD_CHARS, MAX_REPORT_CHARS, parseReport, checkpoint, checkpoints, reportText } from '../src/report.ts';

// Specified: Behavioral-Active, Blackbox-Atomic/Group; filesystem preferences exercise the real adapter.
test('strict JSON reports include zero objectives and reject malformed or unbounded output', () => {
  assert.deepEqual(parseReport('{"objectives":[]}'), { objectives: [] });
  const raw = JSON.stringify({ objectives: [{ objective: 'Ship Cuckoo', progress: 'Tests pending' }] });
  assert.equal(parseReport(raw).objectives[0].progress, 'Tests pending');
  for (const value of ['null', '[]', '{}', '```json\n' + raw + '\n```', '{"objectives":[],"extra":true}', '{"objectives":[{"objective":"x"}]}', JSON.stringify({ objectives: [{ objective: 'x', progress: '' }] }), JSON.stringify({ objectives: [{ objective: 'x'.repeat(MAX_FIELD_CHARS + 1), progress: 'x' }] }), ' '.repeat(MAX_REPORT_CHARS + 1)]) {
    assert.throws(() => parseReport(value), undefined, value.slice(0, 100));
    const saved = checkpoint('req-1', value);
    assert.equal(saved.raw, value); assert.equal(saved.report, null); assert.ok(saved.error);
  }
});

test('reports restore only the active branch and preserve invalid raw output', () => {
  const manager = SessionManager.inMemory();
  const anchor = manager.appendCustomEntry('anchor', {});
  manager.appendCustomEntry(REPORT_TYPE, checkpoint('req-1', '{"objectives":[]}'));
  manager.appendCustomEntry(REPORT_TYPE, checkpoint('req-2', 'not JSON'));
  assert.equal(checkpoints(manager.getBranch()).length, 2);
  assert.match(reportText(checkpoints(manager.getBranch())), /Invalid report.*\nRaw output:\nnot JSON/);
  manager.branch(anchor);
  assert.equal(checkpoints(manager.getBranch()).length, 0);
  assert.match(reportText([]), /No Cuckoo reports/);
  manager.appendCustomEntry(REPORT_TYPE, { version: 9 });
  assert.throws(() => checkpoints(manager.getBranch()), /Invalid saved/);
});

test('shared settings keep session/global policy and enablement inheritance independent', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cuckoo-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'cuckoo.json');
  const store = new FilePreferenceStore(path);
  assert.deepEqual(store.read(), DEFAULT_PREFERENCES);
  assert.deepEqual(store.read().policy, { kind: 'window', value: 15 });
  store.write({ enabled: true, policy: { kind: 'relative', value: 20 } });
  const original = readFileSync(path, 'utf8');
  const manager = SessionManager.inMemory(); const sessionId = manager.getSessionId();
  const effective = () => effectivePreferences(store.read(), manager.getEntries(), sessionId);
  manager.appendCustomEntry(ENABLED_TYPE, { version: 1, sessionId, enabled: false });
  manager.appendCustomEntry(POLICY_TYPE, { version: 1, sessionId, policy: { kind: 'tokens', value: 5000 } });
  assert.deepEqual(effective(), { enabled: false, policy: { kind: 'tokens', value: 5000 }, enabledSource: 'session', policySource: 'session' });
  assert.equal(readFileSync(path, 'utf8'), original);
  new FilePreferenceStore(path).write({ enabled: true, policy: { kind: 'window', value: 30 } });
  assert.deepEqual(effective().policy, { kind: 'tokens', value: 5000 });
  manager.appendCustomEntry(POLICY_TYPE, { version: 1, sessionId, policy: null });
  assert.deepEqual(effective().policy, { kind: 'window', value: 30 }); assert.equal(effective().enabled, false);
  manager.appendCustomEntry(ENABLED_TYPE, { version: 1, sessionId, enabled: null });
  assert.equal(effective().enabled, true);
  assert.equal(effectivePreferences(store.read(), manager.getEntries(), 'other-session').policySource, 'global');
  writeFileSync(path, 'not JSON'); assert.throws(() => store.read(), /Invalid Cuckoo defaults/);
});

test('invalid global/session settings fail visibly instead of becoming defaults', () => {
  for (const kind of ['relative', 'window']) {
    for (const value of [0, -1, 101, NaN, Infinity, '15', null]) assert.throws(() => validatePolicy({ kind, value }));
    assert.deepEqual(validatePolicy({ kind, value: 0.5 }), { kind, value: 0.5 });
  }
  for (const value of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validatePolicy({ kind: 'tokens', value }));
  assert.deepEqual(validatePolicy({ kind: 'tokens', value: 10000 }), { kind: 'tokens', value: 10000 });
  assert.throws(() => validatePolicy({ kind: 'unknown', value: 15 }));
  const manager = SessionManager.inMemory(); const sessionId = manager.getSessionId();
  manager.appendCustomEntry(THRESHOLD_TYPE, { version: 1, sessionId, thresholdPercent: -10 });
  assert.throws(() => effectivePreferences(DEFAULT_PREFERENCES, manager.getEntries(), sessionId), /policy/);
});
