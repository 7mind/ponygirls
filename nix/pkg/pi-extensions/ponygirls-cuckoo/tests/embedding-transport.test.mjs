import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createEmbeddingEncoder } from '../src/embedding-transport.ts';
import {
  textDigest, encoderIdentityKey,
} from '../src/experiments/vector-memory.ts';

// Specified Behavioral-Active / Blackbox-Group: manual fetch adapter.
// Owned local HTTP cases add real controllable transport; no external service.
const IDENTITY = Object.freeze({
  identifier: 'synthetic-encoder', model: 'synthetic-model', version: '1',
  dimensions: 2, normalization: 'raw',
  implementationDigest: 'synthetic-implementation',
  configDigest: 'synthetic-private-config-binding',
});
const SECRET = 'synthetic-token-do-not-log';
const INPUT = 'Synthetic controlled input 🐦\ud800';
function context() {
  return { deadlineMs: Date.now() + 5000, signal: undefined };
}
function payload() {
  return {
    model: IDENTITY.model,
    data: [{ index: 0, embedding: [0.314159265, 0.271828182] }],
    usage: { prompt_tokens: 7, total_tokens: 7 },
  };
}
function json(value) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}
function fixture(overrides) {
  const events = [];
  const calls = [];
  let allowed = true;
  const options = {
    url: 'https://synthetic.invalid/selected-json-route',
    credential: SECRET, identity: IDENTITY,
    transportPolicy: 'https',
    maxInputChars: 1000, maxRequestBytes: 10000, maxResponseBytes: 4096,
    authorize: () => allowed,
    audit: event => { events.push(event); },
    fetchImpl: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(json(payload()));
    },
    ...overrides,
  };
  return {
    port: createEmbeddingEncoder(options), events, calls, options,
    revoke() { allowed = false; },
  };
}

test('exact one-text payload, identity and actual usage are auditable without payload duplication', async () => {
  const f = fixture({});
  const result = await f.port.encode(INPUT, context());
  assert.deepEqual(result, payload().data[0].embedding);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(f.port));
  assert.equal(f.calls.length, 1);
  const init = f.calls[0].init;
  const exact = JSON.stringify({
    model: IDENTITY.model, input: INPUT, encoding_format: 'float',
  });
  assert.equal(init.body, exact);
  assert.equal(JSON.parse(init.body).input, INPUT);
  assert.equal(init.headers.authorization, `Bearer ${SECRET}`);
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal instanceof AbortSignal);
  const event = f.events.find(e => e.phase === 'validated');
  assert.equal(event.payloadHash,
    `sha256:${createHash('sha256').update(exact, 'utf8').digest('hex')}`);
  assert.equal(event.inputDigest, textDigest(INPUT));
  assert.equal(event.encoderKey, encoderIdentityKey(IDENTITY));
  assert.equal(event.requestedModel, IDENTITY.model);
  assert.equal(event.reportedModel, IDENTITY.model);
  assert.equal(event.reportedDimensions, 2);
  assert.deepEqual(event.usage, { promptTokens: 7, totalTokens: 7 });
  const audit = JSON.stringify(f.events);
  for (const forbidden of [SECRET, INPUT, '0.314159265', 'authorization', 'embedding']) {
    assert.ok(!audit.includes(forbidden));
  }
  assert.ok(f.events.every(Object.isFrozen));
});

test('missing usage remains unknown, not zero', async () => {
  const value = payload();
  delete value.usage;
  const f = fixture({ fetchImpl: async () => json(value) });
  await f.port.encode(INPUT, context());
  assert.equal(f.events.find(e => e.phase === 'validated').usage, 'unknown');
});

test('denial and revocation during prepared audit prevent handoff', async () => {
  const denied = fixture({ authorize: () => false });
  await assert.rejects(denied.port.encode(INPUT, context()), { code: 'GRANT_DENIED' });
  assert.equal(denied.calls.length, 0);
  let allowed = true;
  let calls = 0;
  const f = fixture({
    authorize: () => allowed,
    audit(event) { if (event.phase === 'prepared') allowed = false; },
    fetchImpl() { calls++; return Promise.resolve(json(payload())); },
  });
  await assert.rejects(f.port.encode(INPUT, context()), { code: 'GRANT_DENIED' });
  assert.equal(calls, 0);
});

test('authorization is fresh after handoff and after validated audit', async () => {
  let allowed = true;
  const first = fixture({
    authorize: () => allowed,
    fetchImpl() { allowed = false; return Promise.resolve(json(payload())); },
  });
  await assert.rejects(first.port.encode(INPUT, context()), { code: 'GRANT_DENIED' });

  allowed = true;
  const second = fixture({
    authorize: () => allowed,
    audit(event) { if (event.phase === 'validated') allowed = false; },
  });
  await assert.rejects(second.port.encode(INPUT, context()), { code: 'GRANT_DENIED' });
});

for (const [name, change, code] of [
  ['wrong model', x => { x.model = 'different-synthetic-model'; }, 'ENCODER_MISMATCH'],
  ['wrong dimensions', x => { x.data[0].embedding = [1]; }, 'DIMENSION_MISMATCH'],
  ['zero norm', x => { x.data[0].embedding = [0, 0]; }, 'ZERO_NORM'],
  ['null component', x => { x.data[0].embedding = [null, 1]; }, 'MALFORMED_OUTPUT'],
  ['second row', x => { x.data.push({ index: 1, embedding: [1, 1] }); }, 'MALFORMED_OUTPUT'],
  ['wrong row index', x => { x.data[0].index = 1; }, 'MALFORMED_OUTPUT'],
  ['bad usage', x => { x.usage.prompt_tokens = -1; }, 'MALFORMED_OUTPUT'],
]) {
  test(`rejects ${name} without empty fallback`, async () => {
    const value = payload();
    change(value);
    const f = fixture({ fetchImpl: async () => json(value) });
    await assert.rejects(f.port.encode(INPUT, context()), { code });
  });
}

test('nonfinite JSON number is rejected by shared vector validation', async () => {
  const body = `{"model":"${IDENTITY.model}","data":[{"index":0,"embedding":[1e400,1]}]}`;
  const f = fixture({ fetchImpl: async () => new Response(body, {
    headers: { 'content-type': 'application/json' },
  }) });
  await assert.rejects(f.port.encode(INPUT, context()), { code: 'NONFINITE_VECTOR' });
});

test('errors, malformed JSON and oversized responses are sanitized', async () => {
  for (const [fetchImpl, code] of [
    [async () => { throw new Error(`${SECRET}: raw transport failure`); }, 'ENCODER_UNAVAILABLE'],
    [async () => new Response(SECRET, { status: 503 }), 'HTTP_ERROR'],
    [async () => new Response(SECRET, {
      headers: { 'content-type': 'application/json' },
    }), 'MALFORMED_OUTPUT'],
    [async () => new Response('x'.repeat(5000), {
      headers: { 'content-type': 'application/json' },
    }), 'OUTPUT_TOO_LARGE'],
    [async () => new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-length': '99999' },
    }), 'OUTPUT_TOO_LARGE'],
  ]) {
    const f = fixture({ fetchImpl });
    const error = await f.port.encode(INPUT, context()).then(
      () => assert.fail('must reject'), value => value,
    );
    assert.equal(error.code, code);
    assert.ok(!String(error).includes(SECRET));
    assert.ok(!JSON.stringify(f.events).includes(SECRET));
    assert.ok(!JSON.stringify(f.events).includes(INPUT));
  }
});

test('pre-abort, ignored-signal fetch and finite deadlines fence results', async () => {
  const before = new AbortController();
  before.abort(SECRET);
  const first = fixture({});
  await assert.rejects(first.port.encode(INPUT, {
    deadlineMs: Date.now() + 1000, signal: before.signal,
  }), { code: 'CANCELLED' });
  assert.equal(first.calls.length, 0);

  let signal;
  const hung = fixture({
    fetchImpl(_url, init) {
      signal = init.signal;
      return new Promise(() => {});
    },
  });
  const controller = new AbortController();
  const pending = hung.port.encode(INPUT, {
    deadlineMs: Date.now() + 1000, signal: controller.signal,
  });
  controller.abort(SECRET);
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(signal.aborted, true);
  const failed = hung.events.find(e => e.phase === 'failed');
  assert.equal(failed.transmission, 'may-have-occurred');
  assert.equal(failed.serverStop, 'unknown');

  const deadline = fixture({ fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(deadline.port.encode(INPUT, {
    deadlineMs: Date.now() + 30, signal: undefined,
  }), { code: 'DEADLINE_EXCEEDED' });

  for (const deadlineMs of [undefined, NaN, Infinity, Date.now() + 61000]) {
    await assert.rejects(first.port.encode(INPUT, {
      deadlineMs, signal: undefined,
    }), { code: 'INVALID_CONTEXT' });
  }
});

test('body reads are cancellable and late fetch completion is discarded', async () => {
  let cancelled = false;
  const controller = new AbortController();
  const f = fixture({ fetchImpl: async () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode('{"model":')); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'application/json' } }) });
  const pending = f.port.encode(INPUT, {
    deadlineMs: Date.now() + 1000, signal: controller.signal,
  });
  const timer = setTimeout(() => controller.abort(), 10);
  try { await assert.rejects(pending, { code: 'CANCELLED' }); }
  finally { clearTimeout(timer); }
  assert.equal(cancelled, true);

  let finish;
  let lateCancelled = false;
  const lateController = new AbortController();
  const late = fixture({
    fetchImpl: () => new Promise(resolve => { finish = resolve; }),
  });
  const latePending = late.port.encode(INPUT, {
    deadlineMs: Date.now() + 1000, signal: lateController.signal,
  });
  lateController.abort();
  await assert.rejects(latePending, { code: 'CANCELLED' });
  finish(new Response(new ReadableStream({
    cancel() { lateCancelled = true; },
  })));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(lateCancelled, true);
});

test('input and transport policy bounds reject before transmission', async () => {
  const f = fixture({ maxInputChars: 2 });
  await assert.rejects(f.port.encode(INPUT, context()), { code: 'TEXT_TOO_LONG' });
  assert.equal(f.calls.length, 0);
  for (const patch of [
    { url: 'http://127.0.0.1:12345/selected' },
    { url: 'http://localhost:12345/selected', transportPolicy: 'owned-loopback-http' },
    { url: 'http://192.0.2.1/selected', transportPolicy: 'owned-loopback-http' },
    { identity: { ...IDENTITY } },
  ]) assert.throws(() => fixture(patch), { code: 'INVALID_CONFIG' });
});

async function ownedServer(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('owned real HTTP JSON transport preserves request bytes and rejects redirects', async t => {
  const requests = [];
  const base = await ownedServer(t, (request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        path: request.url,
        body: Buffer.concat(chunks).toString('utf8'),
        authorization: request.headers.authorization,
      });
      if (request.url === '/redirect') {
        response.writeHead(302, { location: '/must-not-follow' });
        response.end();
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload()));
      }
    });
  });
  const f = fixture({
    url: `${base}/selected`,
    transportPolicy: 'owned-loopback-http',
    fetchImpl: globalThis.fetch,
  });
  assert.deepEqual(await f.port.encode(INPUT, context()), payload().data[0].embedding);
  assert.equal(requests[0].authorization, `Bearer ${SECRET}`);
  assert.equal(requests[0].body, JSON.stringify({
    model: IDENTITY.model, input: INPUT, encoding_format: 'float',
  }));
  const redirect = fixture({
    url: `${base}/redirect`,
    transportPolicy: 'owned-loopback-http',
    fetchImpl: globalThis.fetch,
  });
  await assert.rejects(redirect.port.encode(INPUT, context()), {
    code: 'ENCODER_UNAVAILABLE',
  });
  assert.deepEqual(requests.map(x => x.path), ['/selected', '/redirect']);
});
