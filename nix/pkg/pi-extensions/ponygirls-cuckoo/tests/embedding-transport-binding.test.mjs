import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingEncoder } from '../src/embedding-transport.ts';
import {
  textDigest,
} from '../src/experiments/vector-memory.ts';

// Specified Behavioral-Active / Blackbox-Group.
// Handwritten fetch ports only; no external service or real credential.

const IDENTITY = Object.freeze({
  identifier: 'synthetic-encoder',
  model: 'synthetic-model',
  version: '1',
  dimensions: 2,
  normalization: 'raw',
  implementationDigest: 'synthetic-implementation',
  configDigest: 'synthetic-private-config-binding',
});
const SECRET = 'synthetic-token-do-not-log';

function payload() {
  return {
    model: IDENTITY.model,
    data: [{ index: 0, embedding: [1, 2] }],
    usage: { prompt_tokens: 1, total_tokens: 1 },
  };
}

function json(value) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });
}

function context() {
  return { deadlineMs: Date.now() + 5000, signal: undefined };
}

function fixture(overrides) {
  const calls = [];
  const events = [];
  const options = {
    url: 'https://synthetic.invalid/selected-json-route',
    credential: SECRET,
    identity: IDENTITY,
    fetchImpl: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(json(payload()));
    },
    authorize: () => true,
    audit: event => {
      events.push(event);
    },
    maxInputChars: 1000,
    maxRequestBytes: 10000,
    maxResponseBytes: 4096,
    transportPolicy: 'https',
    ...overrides,
  };
  return {
    calls,
    events,
    options,
    port: createEmbeddingEncoder(options),
  };
}

test('all three host ports are required; no implicit transport or approval', () => {
  for (const name of ['fetchImpl', 'authorize', 'audit']) {
    assert.throws(
      () => fixture({ [name]: undefined }),
      { code: 'INVALID_CONFIG' },
    );
  }
  assert.throws(
    () => createEmbeddingEncoder(undefined),
    { code: 'INVALID_CONFIG' },
  );
});

test('asynchronous host callbacks fail closed and consume native rejection', async () => {
  const denied = fixture({
    authorize: () => Promise.reject(new Error(SECRET)),
  });
  await assert.rejects(
    denied.port.encode('synthetic', context()),
    { code: 'GRANT_DENIED' },
  );
  assert.equal(denied.calls.length, 0);
  assert.equal(JSON.stringify(denied.events).includes(SECRET), false);

  const unauditable = fixture({
    audit: () => Promise.reject(new Error(SECRET)),
  });
  await assert.rejects(
    unauditable.port.encode('synthetic', context()),
    { code: 'AUDIT_UNAVAILABLE' },
  );
  assert.equal(unauditable.calls.length, 0);
  await Promise.resolve();
});

test('configuration values and callback references are captured at construction', async () => {
  const f = fixture({});
  f.options.url = 'https://different.invalid/must-not-use';
  f.options.credential = 'different-secret';
  f.options.authorize = () => false;
  f.options.fetchImpl = () => {
    throw new Error('must not use replaced fetch');
  };

  assert.deepEqual(
    await f.port.encode('synthetic', context()),
    [1, 2],
  );
  assert.equal(f.calls.length, 1);
  assert.equal(
    f.calls[0].url,
    'https://synthetic.invalid/selected-json-route',
  );
  assert.equal(
    f.calls[0].init.headers.authorization,
    `Bearer ${SECRET}`,
  );
});

test('operation snapshots its deadline and caller signal', async () => {
  const controller = new AbortController();
  const ctx = {
    deadlineMs: Date.now() + 1000,
    signal: controller.signal,
  };
  let finish;
  let lateCancelled = false;
  const f = fixture({
    fetchImpl: () => new Promise(resolve => {
      finish = resolve;
    }),
  });

  const pending = f.port.encode('synthetic', ctx);
  ctx.signal = undefined;
  ctx.deadlineMs = Date.now() + 60000;
  controller.abort(SECRET);

  await assert.rejects(pending, { code: 'CANCELLED' });
  finish(new Response(new ReadableStream({
    cancel() {
      lateCancelled = true;
    },
  })));
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(lateCancelled, true);
  const failed = f.events.find(event => event.phase === 'failed');
  assert.equal(failed.transmission, 'may-have-occurred');
  assert.equal(failed.serverStop, 'unknown');
  assert.equal(JSON.stringify(f.events).includes(SECRET), false);
});

test('UTF-8 text and escaped JSON payload each enforce request-byte bounds', async () => {
  const cases = [
    { text: '🐦'.repeat(8), maxRequestBytes: 31 },
    { text: '\ud800'.repeat(8), maxRequestBytes: 90 },
  ];

  for (const candidate of cases) {
    const f = fixture({ maxRequestBytes: candidate.maxRequestBytes });
    await assert.rejects(
      f.port.encode(candidate.text, context()),
      { code: 'TEXT_TOO_LONG' },
    );
    assert.equal(f.calls.length, 0);
  }
});

test('unrecognized reported labels are represented by digest, never raw text', async () => {
  const privateLabel = 'PRIVATE_PROVIDER_LABEL_DO_NOT_LOG';
  const value = payload();
  value.model = privateLabel;
  const f = fixture({
    fetchImpl: async () => json(value),
  });

  const error = await f.port.encode('synthetic', context()).then(
    () => assert.fail('wrong model must reject'),
    failure => failure,
  );

  assert.equal(error.code, 'ENCODER_MISMATCH');
  assert.equal(String(error).includes(privateLabel), false);
  const failed = f.events.find(event => event.phase === 'failed');
  assert.equal(failed.reportedModel, null);
  assert.equal(failed.reportedModelDigest, textDigest(privateLabel));
  assert.equal(JSON.stringify(f.events).includes(privateLabel), false);
});

test('partial usage preserves explicit zero and unknown missing count', async () => {
  const value = payload();
  value.usage = { prompt_tokens: 0 };
  const f = fixture({
    fetchImpl: async () => json(value),
  });

  await f.port.encode('synthetic', context());
  const validated = f.events.find(event => event.phase === 'validated');
  assert.deepEqual(validated.usage, {
    promptTokens: 0,
    totalTokens: null,
  });
  assert.equal(Object.isFrozen(validated.usage), true);
});
