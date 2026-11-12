import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtocol, makeJobs, verifyProtocol } from './protocol.mjs';
import { hash } from './memory.mjs';
import { getCase } from './cases.mjs';

function fixture() { return createProtocol(process.env.PI_SDK_ROOT, process.env.PI_CUCKOO_EXTENSION, process.env.PI_PILOT_PROVIDER_CONFIG); }

test('registered plan is deterministic, balanced and excludes development cases from scoring', () => {
  const a = makeJobs('scored', 2); const b = makeJobs('scored', 2); assert.deepEqual(a, b); assert.equal(a.length, 48);
  assert.equal(new Set(a.map(job => job.id)).size, a.length);
  for (const job of a) {
    assert.ok(getCase(job.caseId).heldOut); assert.equal(job.caseInputHash, hash(getCase(job.caseId)));
    assert.equal(job.continuations.length, 2); assert.ok(job.continuations.every(arm => arm.reduced));
    assert.deepEqual(job.continuations.map(arm => arm.selective).sort(), [false, true]);
  }
  assert.equal(makeJobs('development', 1).length, 12);
  assert.ok(makeJobs('development', 1).every(job => job.continuations.length === 3 && !getCase(job.caseId).heldOut));
});

test('protocol binds source/runtime/plan and all execution-selection fields', () => {
  const protocol = fixture(); assert.equal(verifyProtocol(protocol, process.env.PI_SDK_ROOT, process.env.PI_CUCKOO_EXTENSION, process.env.PI_PILOT_PROVIDER_CONFIG), true);
  const changes = [
    p => { p.sourceHashes[Object.keys(p.sourceHashes)[0]] = 'changed'; },
    p => { p.plan.scored[0].caseInputHash = 'changed'; },
    p => { p.models = [{ provider: 'anthropic', id: 'forbidden' }]; },
    p => { p.sdkVersion = 'other'; },
    p => { p.providerConfigHash = 'other'; },
    p => { p.concurrency = 10000; },
    p => { p.batchDeadlineMs = 0; },
    p => { p.jobTimeoutMs = 0; },
  ];
  for (const change of changes) { const altered = structuredClone(protocol); change(altered); assert.throws(() => verifyProtocol(altered, process.env.PI_SDK_ROOT, process.env.PI_CUCKOO_EXTENSION, process.env.PI_PILOT_PROVIDER_CONFIG), /binding/); }
});

test('launch script is part of source identity', () => {
  assert.ok(Object.hasOwn(fixture().sourceHashes, 'scripts/cuckoo-memory-pilot/run.sh'));
});
