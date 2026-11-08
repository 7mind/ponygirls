import test from 'node:test';
import assert from 'node:assert/strict';
import { recordResponses, feasibilityMatches, exposure } from './support.mjs';

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
// Regression: failed inference is still consumed work and must not vanish from pilot accounting.
test('failed responses retain text and observed usage before reporting failure; unavailable usage is explicit', () => {
  const result = { responses: [], usage: { ...zero } };
  assert.throws(() => recordResponses(result, [{ id: 'partial', message: { content: [{ type: 'text', text: 'partial output' }], usage: { ...zero, input: 100, output: 10, totalTokens: 110 }, stopReason: 'length' } }], new Set(), 2), /Provider/);
  assert.equal(result.responses.length, 1); assert.equal(result.usage.totalTokens, 110); assert.equal(result.responses[0].text, 'partial output');
  assert.throws(() => recordResponses(result, [{ id: 'no-usage', message: { content: [], usage: zero, stopReason: 'aborted' } }], new Set(), 3), /Provider/);
  assert.equal(result.responses[1].usageKnown, false);
});

test('feasibility must match complete config, source hashes and actual model identity', () => {
  const config = { provider: 'p', model: 'm', policy: { kind: 'window', value: 15 }, longRows: 2000, requestDeadlineMs: 180000 };
  const sourceHashes = { source: 'hash' }; const model = { provider: 'p', id: 'm', api: 'a', contextWindow: 500000 };
  const feasibility = { valid: true, config, sourceHashes, model };
  assert.equal(feasibilityMatches(feasibility, config, sourceHashes, model), true);
  for (const changed of [{ ...config, provider: 'other' }, { ...config, policy: { kind: 'window', value: 20 } }, { ...config, requestDeadlineMs: 1 }]) assert.equal(feasibilityMatches(feasibility, changed, sourceHashes, model), false);
  assert.equal(feasibilityMatches(feasibility, config, { source: 'different' }, model), false);
  assert.equal(feasibilityMatches(feasibility, config, sourceHashes, { ...model, contextWindow: 200000 }), false);
});

test('long treatment must expose a validated checkpoint before the graded response; all controls stay untreated', () => {
  const run = { enabled: true, length: 'long', reports: [], phases: [{ phase: 0, checkpointCount: 0 }, { phase: 3, checkpointCount: 0 }] };
  assert.equal(exposure(run).valid, false);
  run.reports = [{ error: null }]; run.phases[1].checkpointCount = 1;
  assert.equal(exposure(run).valid, false, 'post-deliverable checkpoint is not treatment');
  run.phases.push({ phase: 2, checkpointCount: 1 }); assert.equal(exposure(run).valid, true);
  run.reports[0].error = 'invalid JSON'; assert.equal(exposure(run).valid, false);
  run.reports[0].error = null; run.enabled = false; assert.equal(exposure(run).valid, false);
  run.enabled = true; run.length = 'short'; assert.equal(exposure(run).valid, false);
  run.reports = []; assert.equal(exposure(run).valid, true);
});
