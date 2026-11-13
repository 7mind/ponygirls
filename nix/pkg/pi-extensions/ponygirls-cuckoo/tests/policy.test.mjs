import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { growthTokens, policyText } from '../src/policy.ts';
import { inquiryDue, observe } from '../src/state.ts';
import { FilePreferenceStore, POLICY_TYPE, THRESHOLD_TYPE, effectivePreferences } from '../src/preferences.ts';

// Specified Behavioral-Active / Blackbox-Atomic: policy formulas must distinguish relative from capacity-based growth.
for (const [policy, increment] of [[{ kind: 'relative', value: 15 }, 3000], [{ kind: 'window', value: 15 }, 30000], [{ kind: 'tokens', value: 10000 }, 10000]]) {
  test(`${policy.kind}: exact incremental trigger, no trigger one token below, reset after issuance`, () => {
    const baseline = observe(null, 20000, 'model:200000');
    assert.equal(growthTokens(policy, 20000, 200000), increment);
    assert.equal(inquiryDue(observe(baseline, 20000 + increment - 1, baseline.model), policy, 200000), false);
    assert.equal(inquiryDue(observe(baseline, 20000 + increment, baseline.model), policy, 200000), true);
    const issued = { ...baseline, baseline: 20000 + increment, observed: 20000 + increment };
    const next = growthTokens(policy, issued.baseline, 200000);
    assert.equal(inquiryDue(observe(issued, issued.baseline + next - 1, issued.model), policy, 200000), false);
    assert.equal(inquiryDue(observe(issued, issued.baseline + next, issued.model), policy, 200000), true);
    assert.match(policyText(policy), policy.kind === 'tokens' ? /10000 additional tokens/ : /15%/);
  });
}

test('fractional percentage increments round up; only window policy requires known positive capacity', () => {
  assert.equal(growthTokens({ kind: 'relative', value: 0.1 }, 1234, null), 2);
  assert.equal(growthTokens({ kind: 'window', value: 0.1 }, 1234, 12345), 13);
  const state = { ...observe(null, 20000, 'model'), observed: 100000 };
  for (const capacity of [null, 0, -1, NaN, Infinity]) {
    assert.equal(inquiryDue(state, { kind: 'window', value: 15 }, capacity), false);
    assert.equal(inquiryDue(state, { kind: 'relative', value: 15 }, capacity), true);
    assert.equal(inquiryDue(state, { kind: 'tokens', value: 10000 }, capacity), true);
  }
  assert.equal(growthTokens({ kind: 'window', value: 15 }, 20000, 1000000), 150000);
});

test('legacy global defaults migrate without writes on read; next write stores policy atomically', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cuckoo-policy-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'cuckoo.json'); const store = new FilePreferenceStore(path);
  const legacy = '{"version":1,"enabled":true,"thresholdPercent":17.5}\n'; writeFileSync(path, legacy);
  assert.deepEqual(store.read(), { enabled: true, policy: { kind: 'relative', value: 17.5 } });
  assert.equal(readFileSync(path, 'utf8'), legacy);
  store.write({ ...store.read(), policy: { kind: 'tokens', value: 12345 } });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { version: 3, enabled: true, policy: { kind: 'tokens', value: 12345 } });
  writeFileSync(path, '{"version":2,"enabled":true,"policy":{"kind":"unknown","value":15}}');
  assert.throws(() => store.read(), /policy/);
});

test('legacy and new session policies obey chronological overrides and inheritance across reload/branches', () => {
  const manager = SessionManager.inMemory(); const sessionId = manager.getSessionId();
  const defaults = { enabled: false, policy: { kind: 'window', value: 20 } };
  const effective = () => effectivePreferences(defaults, {}, manager.getEntries(), sessionId);
  const anchor = manager.appendCustomEntry('anchor', {});
  manager.appendCustomEntry(THRESHOLD_TYPE, { version: 1, sessionId, thresholdPercent: 5 });
  assert.deepEqual(effective().policy, { kind: 'relative', value: 5 });
  manager.appendCustomEntry(POLICY_TYPE, { version: 1, sessionId, policy: { kind: 'tokens', value: 5000 } });
  assert.deepEqual(effective().policy, { kind: 'tokens', value: 5000 });
  manager.appendCustomEntry(THRESHOLD_TYPE, { version: 1, sessionId, thresholdPercent: 7 });
  assert.deepEqual(effective().policy, { kind: 'relative', value: 7 });
  manager.appendCustomEntry(POLICY_TYPE, { version: 1, sessionId, policy: null });
  manager.branch(anchor);
  assert.deepEqual(effective().policy, defaults.policy, 'settings span branches, independently of branch-sensitive reports');
  assert.equal(effective().policySource, 'global');
  manager.appendCustomEntry(THRESHOLD_TYPE, { version: 1, sessionId: 'other-session', thresholdPercent: -99 });
  assert.deepEqual(effective().policy, defaults.policy);
  manager.appendCustomEntry(POLICY_TYPE, { version: 1, sessionId, policy: { kind: 'window', value: -1 } });
  assert.throws(effective, /policy/);
  manager.appendCustomEntry(POLICY_TYPE, { version: 1, sessionId, policy: { kind: 'relative', value: 15 } });
  assert.deepEqual(effective().policy, { kind: 'relative', value: 15 }, 'latest valid override repairs invalid earlier state');
});
