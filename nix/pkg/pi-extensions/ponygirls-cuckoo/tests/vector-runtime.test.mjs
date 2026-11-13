import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CuckooVectors, VECTOR_TOOL, VECTOR_ENCODER_MS } from '../src/vector-runtime.ts';
import { TASK_OPERATION_LIMITS } from '../src/task-consent.ts';
import { encoderBinding } from '../src/network-services.ts';
import { taskNetworkFixture, nativeTestClock } from './fixtures/task-network.mjs';

function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
const SECRET = 'owned-synthetic-credential-not-a-real-secret';
const MODEL = 'owned-synthetic-encoder';
function response(text) { return { model: MODEL, data: [{ index: 0, embedding: text.includes('needle') ? [1, 0] : [0, 1] }], usage: { prompt_tokens: 4, total_tokens: 4 } }; }
function json(value) { return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }); }

async function fixture(t, transport) {
  const calls = []; const posts = []; const serverErrors = []; let resolveCredential = () => SECRET; let credentials = 0; let plan = null;
  let url = 'https://synthetic.invalid/embeddings';
  if (transport === 'http') {
    const server = createServer((request, reply) => {
      void (async () => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString()); posts.push(body);
        assert.equal(request.headers.authorization, `Bearer ${SECRET}`);
        reply.writeHead(200, { 'content-type': 'application/json' }); reply.end(JSON.stringify(response(body.input)));
      })().catch(error => { serverErrors.push(error); reply.destroy(); });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/embeddings`;
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(serverErrors, []); });
  }
  let profile = Object.freeze({ id: 'owned-profile', label: 'Private profile label', url, model: MODEL, version: '1', dimensions: 2, normalization: 'unit', credentialEnv: 'PRIVATE_SYNTHETIC_ENV' });
  let sequence = 0;
  const services = {
    encoderProfiles: { path: '/private/profile/location', read: () => [profile] },
    embeddingTransportPolicy: transport === 'http' ? 'owned-loopback-http' : 'https',
    credential() { credentials++; return resolveCredential(); },
    fetch(input, init) {
      assert.equal(String(input), url); const body = JSON.parse(init.body); calls.push(body);
      if (plan !== null) return plan(body, init);
      return transport === 'http' ? globalThis.fetch(input, init) : Promise.resolve(json(response(body.input)));
    },
    clock: nativeTestClock(), ids: { nextId: () => `network-${++sequence}` },
  };
  const registry = { getAvailable() { assert.fail('Vectors must not discover LLM models'); }, find() { assert.fail('Vectors must not resolve LLM models'); } };
  const f = taskNetworkFixture(t, services, registry, []);
  const vectors = new CuckooVectors(f.features, f.consents, services); f.features.refresh(f.ctx);
  const task = f.task('Approved synthetic task');
  const needle = f.snapshot(task.id, 'needle artifact', 'artifact');
  const other = f.snapshot(task.id, 'other evidence', 'evidence');
  return { ...f, vectors, services, task, needle, other, calls, posts,
    approve: () => vectors.command('approve', f.ctx), query: (text, signal) => f.call(VECTOR_TOOL, { taskId: task.id, query: text, topK: 2 }, signal),
    credentials: () => credentials, credentialHook: callback => { resolveCredential = callback; },
    fetchPlan: callback => { plan = callback; }, changeProfile: () => { profile = Object.freeze({ ...profile, version: '2' }); },
    binding: () => encoderBinding(profile, services.embeddingTransportPolicy),
  };
}

// Same public workflow over manual fetch and an owned real HTTP encoder.
for (const transport of ['manual', 'http']) {
  test(`${transport}: task consent admits exact initial/future snapshots and queries, then revokes`, async t => {
    const f = await fixture(t, transport);
    await assert.rejects(f.query('needle', undefined), /TASK_APPROVAL_REQUIRED/);
    assert.equal(f.credentials(), 0); assert.equal(f.calls.length, 0);
    await f.approve(); const consentId = f.consents.current(f.ctx, 'vectors').id;
    const first = await f.query('needle', undefined);
    assert.equal(first.candidates[0].recordId, f.needle.id); assert.equal(first.corpusSize, 2);
    assert.equal(first.encoderOperationsReserved, 3); assert.equal(first.clientHandoffs, 3);
    assert.deepEqual(f.calls.map(value => value.input), ['needle artifact', 'other evidence', 'needle']);
    await f.query('needle again', undefined); assert.equal(f.calls.length, 4);
    const future = f.snapshot(f.task.id, 'needle later artifact', 'artifact');
    const next = await f.query('needle later', undefined);
    assert.equal(next.consentId, consentId); assert.equal(next.coverage.taskSnapshots, 3);
    assert.equal(next.coverage.indexedSourceAvailableSnapshots, 3); assert.equal(f.calls.length, 6);
    f.correct(f.task.id, [f.needle.id], [f.other.id]);
    const corrected = await f.query('needle', undefined);
    assert.equal(corrected.corpusSize, 2); assert.ok(!corrected.candidates.some(candidate => candidate.recordId === f.needle.id));
    assert.equal(corrected.candidates[0].recordId, future.id); assert.equal(f.calls.length, 7, 'status changes do not re-embed');
    const text = JSON.stringify(corrected);
    for (const privateValue of [SECRET, 'PRIVATE_SYNTHETIC_ENV', '/private/profile/location', 'Private profile label', urlFor(f)]) assert.ok(!text.includes(privateValue));
    await f.vectors.command('revoke', f.ctx);
    await assert.rejects(f.query('needle', undefined), /TASK_APPROVAL_REQUIRED/); assert.equal(f.calls.length, 7);
    if (transport === 'http') assert.equal(f.posts.length, 7);
  });
}
function urlFor(f) { return f.services.encoderProfiles.read()[0].url; }

test('wrong tasks and model-written authority/configuration fields never reach encoder', async t => {
  const f = await fixture(t, 'manual'); await f.approve();
  await assert.rejects(f.call(VECTOR_TOOL, { taskId: 'not-approved', query: 'needle' }, undefined), /TASK_NOT_APPROVED/);
  for (const field of ['approved', 'url', 'credential', 'manifest', 'consentId']) {
    await assert.rejects(f.call(VECTOR_TOOL, { taskId: f.task.id, query: 'needle', [field]: 'forged' }, undefined), /INVALID_ARGUMENTS/);
  }
  assert.equal(f.calls.length, 0); assert.equal(f.credentials(), 0);
});

test('profile drift revokes consent; credential-time revocation prevents handoff', async t => {
  const changed = await fixture(t, 'manual'); await changed.approve(); changed.changeProfile();
  await assert.rejects(changed.query('needle', undefined), /ENCODER_CONFIGURATION_CHANGED/);
  assert.equal(changed.consents.current(changed.ctx, 'vectors'), null); assert.equal(changed.calls.length, 0);
  const f = await fixture(t, 'manual'); await f.approve();
  f.credentialHook(() => { f.consents.revoke(f.ctx, 'vectors'); return SECRET; });
  await assert.rejects(f.query('needle', undefined));
  assert.equal(f.calls.length, 0); assert.equal(f.credentials(), 1);
});

test('inventory changes during an awaited encode do not return partial retrieval', async t => {
  const f = await fixture(t, 'manual'); await f.approve();
  const entered = deferred(), release = deferred();
  f.fetchPlan(body => { entered.resolve(); return release.promise.then(() => json(response(body.input))); });
  const pending = f.query('needle', undefined); await entered.promise;
  f.snapshot(f.task.id, 'new task snapshot during encode', 'artifact');
  release.resolve();
  const error = await pending.then(() => assert.fail('must reject changed inventory'), value => value);
  const details = JSON.parse(error.message); assert.equal(details.error, 'CUCKOO_VECTOR_ERROR');
  assert.equal(details.clientHandoffs, 1); assert.equal(details.transmission, 'may-have-occurred');
  f.fetchPlan(null);
  const next = await f.query('needle', undefined); assert.equal(next.coverage.taskSnapshots, 3);
});

test('concurrent searches serialize index mutation and reuse completed rows', async t => {
  const f = await fixture(t, 'manual'); await f.approve();
  const entered = deferred(), release = deferred(); let first = true;
  f.fetchPlan(body => {
    if (!first) return Promise.resolve(json(response(body.input)));
    first = false; entered.resolve(); return release.promise.then(() => json(response(body.input)));
  });
  const one = f.query('needle one', undefined); await entered.promise;
  const two = f.query('needle two', undefined); release.resolve();
  const [a, b] = await Promise.all([one, two]);
  assert.equal(a.corpusSize, 2); assert.equal(b.corpusSize, 2); assert.equal(f.calls.length, 4);
});

test('disable/re-enable fences ignored-abort work and does not resurrect authority or index', async t => {
  const f = await fixture(t, 'manual'); await f.approve();
  const entered = deferred(), release = deferred();
  f.fetchPlan(body => { entered.resolve(); return release.promise.then(() => json(response(body.input))); });
  const pending = f.query('needle', undefined); await entered.promise;
  f.setEnabled(false); f.setEnabled(true);
  const error = await pending.then(() => assert.fail('old work must reject'), value => value);
  const details = JSON.parse(error.message); assert.equal(details.clientHandoffs, 1); assert.equal(details.serverStop, 'unknown');
  release.resolve(); await Promise.resolve(); await Promise.resolve();
  f.fetchPlan(null); await assert.rejects(f.query('needle', undefined), /TASK_APPROVAL_REQUIRED/);
  assert.equal(f.calls.length, 1);
});

test('a deadline crossed inside final synchronous authorization prevents the actual handoff', async t => {
  const baseline = await fixture(t, 'manual'); let readCount = 0; let finalReadCount = null;
  const read = baseline.services.encoderProfiles.read, fetch = baseline.services.fetch;
  baseline.services.encoderProfiles.read = () => { readCount++; return read(); };
  baseline.services.fetch = (input, init) => { if (finalReadCount === null) finalReadCount = readCount; return fetch(input, init); };
  await baseline.approve(); await baseline.query('needle', undefined); assert.ok(finalReadCount > 0);

  const f = await fixture(t, 'manual'); let reads = 0; let advanced = false; let offset = 0;
  const currentProfiles = f.services.encoderProfiles.read; const originalNow = Date.now;
  f.services.encoderProfiles.read = () => {
    reads++;
    if (reads === finalReadCount) { offset = VECTOR_ENCODER_MS + 1000; advanced = true; }
    return currentProfiles();
  };
  Date.now = () => originalNow() + offset;
  try {
    await f.approve(); await assert.rejects(f.query('needle', undefined));
    assert.equal(advanced, true); assert.equal(f.calls.length, 0, 'the synchronous final check must not overrun the handoff deadline');
  } finally { Date.now = originalNow; }
});

test('budget preflight avoids a knowingly incomplete build and counts no credential access', async t => {
  const f = await fixture(t, 'manual'); await f.approve();
  for (let i = 0; i < TASK_OPERATION_LIMITS.vectors - 2; i++) f.consents.reserve(f.ctx, 'vectors', f.binding());
  await assert.rejects(f.query('needle', undefined), /ENCODER_OPERATION_BUDGET/);
  assert.equal(f.calls.length, 0); assert.equal(f.credentials(), 0);
});
