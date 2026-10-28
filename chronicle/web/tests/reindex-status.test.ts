import test from 'node:test';
import assert from 'node:assert/strict';
import { ReindexStatusResult } from '../src/api.ts';
import { ReindexStatusReadPermit, rebuildConclusion, validateReindexStatus } from '../src/reindex-status.ts';
const cohort = { requestId: 'accepted-id', targetProfile: 'current-profile', total: 9007199254740995n };
test('BA specified: status is a correlated fixed-cohort observation, not Apply-time acceptance', () => {
  const result = new ReindexStatusResult(cohort.requestId, cohort.targetProfile, cohort.total, 1n, 2n, 3n, cohort.total - 6n);
  assert.equal(validateReindexStatus(result, cohort), result);
  for (const invalid of [result.with({ requestId: 'other' }), result.with({ targetProfile: 'other' }), result.with({ total: cohort.total + 1n }), result.with({ failed: -1n }), result.with({ pending: cohort.total }), result.with({ complete: cohort.total + 1n })]) assert.throws(() => validateReindexStatus(invalid, cohort));
});
test('BA specified: complete, failed, superseded and empty observations have distinct conclusions', () => {
  const status = new ReindexStatusResult('id', 'target', 2n, 0n, 0n, 0n, 2n);
  assert.match(rebuildConclusion(status), /acceptance is not completion/);
  assert.equal(rebuildConclusion(status.with({ complete: 2n, pending: 0n })), 'All captured HEADs complete.');
  for (const terminal of [status.with({ failed: 2n, pending: 0n }), status.with({ superseded: 2n, pending: 0n })]) assert.equal(rebuildConclusion(terminal), 'Cohort settled with failures or superseded HEADs.');
  assert.equal(rebuildConclusion(status.with({ total: 0n, pending: 0n })), 'No eligible HEADs were captured.');
});
test('BA specified: physical status permit has no logical cancellation, queue or early release', () => {
  const permit = new ReindexStatusReadPermit(), events: boolean[] = [], unsubscribe = permit.subscribe(() => events.push(permit.getSnapshot()));
  const release = permit.acquire(); assert.notEqual(release, null); assert.equal(permit.acquire(), null);
  // A different logical scope still sees the same unsettled physical read.
  assert.equal(permit.getSnapshot(), true); release!(); const next = permit.acquire(); release!(); assert.equal(permit.getSnapshot(), true); next!(); unsubscribe(); assert.deepEqual(events, [true, false, true, false]);
});
