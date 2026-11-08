import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { DEFAULT_PREFERENCES, ENABLED_TYPE, THRESHOLD_TYPE, FilePreferenceStore, effectivePreferences, validateThresholdPercent } from '../src/preferences.ts';
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

test('shared settings keep session/global threshold and enablement inheritance independent', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cuckoo-settings-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'cuckoo.json');
  const store = new FilePreferenceStore(path);
  assert.deepEqual(store.read(), DEFAULT_PREFERENCES);
  store.write({ enabled: true, thresholdPercent: 20 });
  const original = readFileSync(path, 'utf8');
  const manager = SessionManager.inMemory(); const sessionId = manager.getSessionId();
  const effective = () => effectivePreferences(store.read(), manager.getEntries(), sessionId);
  manager.appendCustomEntry(ENABLED_TYPE, { version: 1, sessionId, enabled: false });
  manager.appendCustomEntry(THRESHOLD_TYPE, { version: 1, sessionId, thresholdPercent: 5 });
  assert.deepEqual(effective(), { enabled: false, thresholdPercent: 5, enabledSource: 'session', thresholdSource: 'session' });
  assert.equal(readFileSync(path, 'utf8'), original);
  new FilePreferenceStore(path).write({ enabled: true, thresholdPercent: 30 });
  assert.equal(effective().thresholdPercent, 5);
  manager.appendCustomEntry(THRESHOLD_TYPE, { version: 1, sessionId, thresholdPercent: null });
  assert.equal(effective().thresholdPercent, 30); assert.equal(effective().enabled, false);
  manager.appendCustomEntry(ENABLED_TYPE, { version: 1, sessionId, enabled: null });
  assert.equal(effective().enabled, true);
  assert.equal(effectivePreferences(store.read(), manager.getEntries(), 'other-session').thresholdSource, 'global');
  writeFileSync(path, 'not JSON'); assert.throws(() => store.read(), /Invalid Cuckoo defaults/);
});

test('invalid global/session settings fail visibly instead of becoming defaults', () => {
  for (const value of [0, -1, 101, NaN, Infinity, '15', null]) assert.throws(() => validateThresholdPercent(value));
  assert.equal(validateThresholdPercent(0.5), 0.5);
  const manager = SessionManager.inMemory(); const sessionId = manager.getSessionId();
  manager.appendCustomEntry(THRESHOLD_TYPE, { version: 1, sessionId, thresholdPercent: -10 });
  assert.throws(() => effectivePreferences(DEFAULT_PREFERENCES, manager.getEntries(), sessionId), /threshold/);
});
