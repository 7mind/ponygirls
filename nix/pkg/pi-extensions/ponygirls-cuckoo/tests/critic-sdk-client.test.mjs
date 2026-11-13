// tests/critic-sdk-client.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { gzipSync, gunzipSync } from 'node:zlib';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import {
  createCriticSdkClient,
  criticSdkConfigurationDigest,
  CriticSdkError,
} from '../src/experiments/critic-sdk-client.ts';
import {
  REFLECTION_PROMPT,
  REFLECTION_PROMPT_ID,
  REFLECTION_NAMESPACE,
  DEFAULT_CRITIC_LIMITS,
  ReflectionCritic,
  criticBundleDigest,
  reflectionTextDigest,
} from '../src/experiments/reflection-critic.ts';

// Specified Behavioral-Active / Effectual-GoodCommunication.
// Real pinned SDK + owned filesystem/loopback HTTP. The scripted peer supplies
// transport observations, not semantic-model or physical-model evidence.
// Handwritten deferred ports exercise uncooperative transport accounting.
// No production placeholder is replaced or skipped by this file.

const MODEL = 'synthetic-critic-model';
const PROVIDER = 'synthetic-critic-loopback';
const PRIVATE_HEADER = 'PRIVATE_RESPONSE_HEADER_SENTINEL_714';
const PRIVATE_ERROR = 'PRIVATE_PROVIDER_ERROR_SENTINEL_915';
const PRIVATE_THINKING = 'PRIVATE_THINKING_SENTINEL_842';
const AMBIENT = 'UNSUPPLIED_AMBIENT_SENTINEL_612';
const OPTIONS = Object.freeze({ timeout: 15000 });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class RealClock {
  monotonicNowMs() { return performance.now(); }
  civilNowMs() { return Date.now(); }
  schedule(delay, callback) {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  }
}

class ManualClock {
  monotonic;
  civil;
  timers;

  constructor() {
    this.monotonic = 100;
    this.civil = 1700000000000;
    this.timers = new Set();
  }

  monotonicNowMs() { return this.monotonic; }
  civilNowMs() { return this.civil; }

  schedule(delay, callback) {
    const timer = { at: this.monotonic + delay, callback };
    this.timers.add(timer);
    return () => this.timers.delete(timer);
  }

  advance(milliseconds) {
    this.monotonic += milliseconds;
    this.civil += milliseconds;
    for (const timer of [...this.timers]) {
      if (timer.at <= this.monotonic && this.timers.delete(timer)) {
        timer.callback();
      }
    }
  }
}

function adviceText() {
  return JSON.stringify({
    version: 1,
    findings: [{
      severity: 'warning',
      message: 'Synthetic advisory finding 🦄.',
      refs: ['artifact', 'evidence'],
    }],
  });
}

function frame(delta, finish, model) {
  const chunk = {
    id: 'synthetic-completion-1',
    object: 'chat.completion.chunk',
    created: 1,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  if (model !== null) chunk.model = model;
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function usageFrame(usage, model) {
  const chunk = {
    id: 'synthetic-completion-1',
    object: 'chat.completion.chunk',
    created: 1,
    choices: [],
    usage,
  };
  if (model !== null) chunk.model = model;
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function goodWire(options) {
  const text = options.text;
  const parts = [text.slice(0, 17), text.slice(17, 49), text.slice(49)];
  let wire = frame({ role: 'assistant' }, null, options.model);
  for (const part of parts) wire += frame({ content: part }, null, options.model);
  wire += frame({}, options.finish, options.model);
  if (options.usage !== null) wire += usageFrame(options.usage, options.model);
  wire += 'data: [DONE]\n\n';
  return { wire, parts };
}

function normalWire() {
  return goodWire({
    text: adviceText(),
    model: MODEL,
    finish: 'stop',
    usage: { prompt_tokens: 19, completion_tokens: 7, total_tokens: 26 },
  });
}

function writeSse(response, wire, end) {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-private-sentinel': PRIVATE_HEADER,
  });
  if (end) response.end(wire);
  else response.write(wire);
}

function makeBundle() {
  const records = [
    ['artifact', 'artifact', 'Explicit synthetic public artifact.'],
    ['evidence', 'evidence', 'Explicit synthetic public evidence.'],
  ].map(([id, kind, publicText]) => ({
    id,
    kind,
    publicText,
    digest: reflectionTextDigest(publicText),
  }));
  return {
    version: 1,
    scope: {
      projectId: 'synthetic-project',
      sessionId: 'synthetic-session',
      branchId: 'synthetic-branch',
      taskId: 'synthetic-task',
      epoch: 1,
    },
    records,
  };
}

async function fixture(t, options) {
  const directory = mkdtempSync(join(tmpdir(), 'critic-sdk-owned-'));
  const sockets = new Set();
  const responses = new Set();
  const state = {
    allowed: true,
    posts: [],
    serverErrors: [],
    fetches: [],
    audits: [],
    authorizations: [],
    runs: [],
    callers: [],
    requestReceived: deferred(),
    responseClosed: deferred(),
    draining: deferred(),
    firstText: deferred(),
    auditHook: options.auditHook,
  };
  let runtime = null;
  const server = createServer((request, response) => {
    responses.add(response);
    response.once('close', () => {
      responses.delete(response);
      state.responseClosed.resolve();
    });
    void (async () => {
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        assert.ok(length <= 1000000, 'owned server request bound');
        chunks.push(chunk);
      }
      const post = {
        method: request.method,
        path: request.url,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      state.posts.push(post);
      state.requestReceived.resolve(post);
      if (options.plan === undefined) writeSse(response, normalWire().wire, true);
      else options.plan(response, post, state);
    })().catch(error => {
      if (!['ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE'].includes(error.code)) {
        state.serverErrors.push(error);
      }
      response.destroy();
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  t.after(async () => {
    for (const caller of state.callers) caller.abort();
    for (const response of responses) response.destroy();
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    for (const socket of sockets) socket.destroy();
    await closed;
    if (runtime !== null) await runtime.settleCredentialWrites();
    rmSync(directory, { recursive: true, force: true });
    assert.deepEqual(state.serverErrors, [], 'owned HTTP peer had no unexpected errors');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  const requestUrl = `${baseUrl}/chat/completions`;

  runtime = await ModelRuntime.create({
    authPath: join(directory, 'auth.json'),
    modelsPath: null,
    modelsStorePath: join(directory, 'models-store.json'),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  runtime.registerProvider(PROVIDER, {
    name: 'Owned synthetic loopback peer',
    baseUrl,
    api: 'openai-completions',
    apiKey: 'synthetic-loopback-key-not-a-real-credential',
    authHeader: true,
    models: [{
      id: MODEL,
      name: 'Synthetic nonreasoning fixture',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32000,
      maxTokens: 512,
      compat: {
        supportsDeveloperRole: false,
        supportsUsageInStreaming: true,
        supportsFinishReason: true,
        maxTokensField: 'max_tokens',
      },
      samplingParams: {
        previous_response_id: AMBIENT,
        metadata: { unsupplied: AMBIENT },
      },
    }],
  });
  const physicalModel = runtime.getPhysicalModel(PROVIDER, MODEL);
  assert.ok(physicalModel);
  const bounds = {
    maxPayloadBytes: 100000,
    maxTransportBytes: 1000000,
    maxOutputChars: 4000,
    maxOutputBytes: 16000,
    maxOutputTokens: 128,
    deadlineMs: 5000,
    maxEvents: 200,
    ...options.bounds,
  };
  const configuration = {
    physicalModel,
    transportConfigurationDigest: reflectionTextDigest('owned synthetic transport policy'),
    requestUrlDigest: reflectionTextDigest(requestUrl),
    bounds,
  };
  const identity = {
    id: MODEL,
    configurationDigest: criticSdkConfigurationDigest(configuration),
  };
  const request = {
    requestId: 'synthetic-request-1',
    model: identity,
    prompt: {
      id: REFLECTION_PROMPT_ID,
      text: REFLECTION_PROMPT,
      digest: reflectionTextDigest(REFLECTION_PROMPT),
    },
    bundle: makeBundle(),
    tools: [],
    ambientContext: 'none',
    thinking: 'disabled',
    delegation: 'disabled',
    actions: 'none',
    maxOutputTokens: 128,
    deadlineMs: 3000,
  };
  const expectedInput = criticBundleDigest(request.bundle);
  const dependencies = {
    ...configuration,
    identity,
    runtime: {
      lookupExact: (provider, id) => runtime.getPhysicalModel(provider, id),
      streamSimple: (model, context, options) => runtime.streamSimple(model, context, options),
    },
    clock: options.clock === undefined ? new RealClock() : options.clock,
    authorize: supplied => {
      const allowed = (
        state.allowed &&
        supplied.model.id === MODEL &&
        supplied.model.configurationDigest === identity.configurationDigest &&
        criticBundleDigest(supplied.bundle) === expectedInput &&
        supplied.prompt.digest === request.prompt.digest
      );
      state.authorizations.push({
        allowed,
        frozen: Object.isFrozen(supplied),
        inputDigest: criticBundleDigest(supplied.bundle),
      });
      return allowed;
    },
    audit: event => {
      state.audits.push(structuredClone(event));
      assert.equal(Object.isFrozen(event), true);
      assert.equal(Object.isFrozen(event.usage), true);
      if (event.stage === 'draining') state.draining.resolve(event);
      if (state.auditHook !== undefined) state.auditHook(event, state);
    },
    fetch: (input, init) => {
      const outgoing = new Request(input, init);
      // Even a broken adapter cannot make this test fixture contact another peer.
      assert.equal(outgoing.url, requestUrl);
      state.fetches.push({ url: outgoing.url, redirect: outgoing.redirect });
      if (options.fetch !== undefined) return options.fetch(outgoing);
      return globalThis.fetch(outgoing);
    },
  };
  const client = createCriticSdkClient(dependencies);

  function start(overrides) {
    const caller = new AbortController();
    state.callers.push(caller);
    const notes = { text: [], usage: [], models: [] };
    const observer = {
      signal: caller.signal,
      onPublicText: text => {
        notes.text.push(text);
        state.firstText.resolve(text);
      },
      onUsage: usage => notes.usage.push(structuredClone(usage)),
      onReportedModel: model => notes.models.push(model),
    };
    const supplied = overrides === undefined ? request : overrides;
    const run = { caller, notes, settled: false, done: null };
    run.done = client.complete(supplied, observer).then(
      value => { run.settled = true; return { ok: true, value }; },
      error => { run.settled = true; return { ok: false, error }; },
    );
    state.runs.push(run);
    return run;
  }

  return {
    client, request, dependencies, bounds, state, runtime, physicalModel, start,
  };
}

function controllerWithNativeJournal(f) {
  const manager = SessionManager.inMemory(); const settled = deferred(); const publicText = deferred();
  let sequence = 0;
  const snapshot = { scope: structuredClone(f.request.bundle.scope), inputDigest: criticBundleDigest(f.request.bundle), taskState: 'working', inquiryActive: false };
  const grant = { id: 'owned-transport-grant', scope: structuredClone(snapshot.scope), artifactId: 'artifact', inputDigest: snapshot.inputDigest, model: f.request.model, promptDigest: f.request.prompt.digest, privacyPolicyId: 'synthetic', privacyPolicyDigest: reflectionTextDigest('synthetic'), dataPolicy: 'synthetic-public-only', expiresAt: Date.now() + 60000, revoked: false, maxRequests: 2, deadlineMs: f.request.deadlineMs, maxOutputTokens: f.request.maxOutputTokens };
  const load = () => manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === REFLECTION_NAMESPACE).map(entry => structuredClone(entry.data));
  const ports = {
    model: { complete(request, observer) {
      const pending = f.client.complete(request, { ...observer, onPublicText: text => { observer.onPublicText(text); publicText.resolve(text); } });
      void pending.then(() => settled.resolve(), () => settled.resolve());
      return pending;
    } },
    clock: f.dependencies.clock,
    ids: { nextId: () => `native-controller-${++sequence}` },
    context: { snapshot: () => structuredClone(snapshot), grant: id => id === grant.id ? structuredClone(grant) : null, isApprovedModel: model => model.id === grant.model.id && model.configurationDigest === grant.model.configurationDigest },
    reconciliation: { evidence: () => null },
    storage: {
      load(namespace) { assert.equal(namespace, REFLECTION_NAMESPACE); return load(); },
      tryAppend(envelope) {
        const existing = load().map(value => value.record), record = envelope.record;
        if (existing.some(value => value.id === record.id)) return false;
        if (record.kind === 'terminal' && existing.some(value => value.kind === 'terminal' && value.startId === record.startId)) return false;
        if (record.kind === 'transport' && existing.some(value => value.kind === 'transport' && value.startId === record.startId && value.observation === record.observation)) return false;
        if (record.kind === 'start' && record.trigger === 'automatic' && existing.some(value => value.kind === 'start' && value.identity === record.identity)) return false;
        manager.appendCustomEntry(REFLECTION_NAMESPACE, structuredClone(envelope));
        return true;
      },
    },
  };
  const controller = new ReflectionCritic(ports, DEFAULT_CRITIC_LIMITS); controller.setEnabled(true);
  return { controller, ports, snapshot, grant, manager, settled, publicText, request: { grantId: grant.id, artifactId: 'artifact', bundle: f.request.bundle } };
}

test('controller contract over real SDK/HTTP/native journal: exact advice, safe delivery and replay', OPTIONS, async t => {
  const f = await fixture(t, {}); const c = controllerWithNativeJournal(f);
  const run = c.controller.trigger({ kind: 'artifact-ready', origin: 'ordinary-work' }, c.request);
  assert.equal(run.status, 'started');
  const result = await run.completion;
  assert.equal(result.persistence, 'stored'); assert.equal(result.terminal.outcome, 'accepted');
  assert.deepEqual(result.terminal.usage, { inputTokens: 19, outputTokens: 7, availability: 'measured' });
  assert.equal(result.terminal.providerWork, 'unknown');
  c.snapshot.inquiryActive = true; assert.equal(c.controller.consumeAtSafeBoundary(), null);
  c.snapshot.inquiryActive = false;
  const delivery = c.controller.consumeAtSafeBoundary();
  assert.equal(delivery.terminal.advice.authority, 'none');
  assert.equal(delivery.terminal.publicText, adviceText());
  assert.equal(c.controller.consumeAtSafeBoundary(), null);
  c.snapshot.taskState = 'finished';
  assert.equal(c.controller.trigger({ kind: 'artifact-ready', origin: 'ordinary-work' }, c.request).status, 'rejected');
  c.controller.setEnabled(false); c.snapshot.scope.epoch++;
  const reloaded = new ReflectionCritic(c.ports, DEFAULT_CRITIC_LIMITS);
  assert.deepEqual(reloaded.history(), c.controller.history());
  assert.equal(reloaded.consumeAtSafeBoundary(), null);
  assert.equal(f.state.fetches.length, 1);
});

test('controller contract over real SDK/HTTP: cancellation retains uncertainty until client settlement', OPTIONS, async t => {
  const f = await fixture(t, { plan: response => writeSse(response, frame({ role: 'assistant' }, null, MODEL) + frame({ content: '{"version":1,' }, null, MODEL), false) });
  const c = controllerWithNativeJournal(f);
  const run = c.controller.trigger({ kind: 'artifact-ready', origin: 'ordinary-work' }, c.request);
  assert.equal(run.status, 'started'); await c.publicText.promise;
  assert.equal(c.controller.abort(run.requestId), true);
  const result = await run.completion;
  assert.equal(result.terminal.outcome, 'cancelled');
  assert.equal(result.terminal.admissionAtCompletion, 'reserved');
  assert.equal(result.terminal.providerWork, 'unknown');
  await c.settled.promise; await f.state.responseClosed.promise;
  assert.deepEqual(c.controller.status().outstandingRequestIds, []);
  assert.equal(c.controller.consumeAtSafeBoundary(), null);
  assert.ok(c.controller.history().some(entry => entry.record.kind === 'transport' && entry.record.observation === 'client-rejected'));
  assert.equal(f.state.fetches.length, 1);
});

async function succeeded(run) {
  const result = await run.done;
  assert.equal(result.ok, true, result.ok ? undefined : result.error.message);
  return result.value;
}

async function rejected(run, codes) {
  const result = await run.done;
  assert.equal(result.ok, false, 'request must not produce accepted output');
  assert.ok(result.error instanceof CriticSdkError);
  assert.ok(codes.includes(result.error.code), `unexpected safe code: ${result.error.code}`);
  return result.error;
}

function sanitized(f, error) {
  assert.ok(f.state.audits.length <= 4, 'bounded audit count per invocation');
  const keys = [
    'version', 'stage', 'requestId', 'civilTime', 'elapsedMs',
    'configurationDigest', 'inputDigest', 'requestedModel', 'reportedModel',
    'usage', 'publicChars', 'transportBytes', 'fetchHandoffs', 'outcome',
    'providerWork',
  ].sort();
  for (const audit of f.state.audits) {
    assert.deepEqual(Object.keys(audit).sort(), keys);
    assert.equal(audit.providerWork, 'unknown');
    assert.ok(Number.isFinite(audit.elapsedMs));
  }
  const serialized = JSON.stringify({
    audits: f.state.audits,
    error: error === null ? null : {
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    },
  });
  for (const secret of [PRIVATE_HEADER, PRIVATE_ERROR, PRIVATE_THINKING, AMBIENT]) {
    assert.equal(serialized.includes(secret), false, 'private sentinel must not escape');
  }
}

test('SDK + loopback: exact public payload and successful HTTP EOF', OPTIONS, async t => {
  const expected = normalWire();
  const f = await fixture(t, {});
  const result = await succeeded(f.start());
  assert.equal(result.publicText, adviceText());
  assert.equal(result.reportedModel, MODEL);
  assert.deepEqual(result.usage, { inputTokens: 19, outputTokens: 7 });
  assert.equal(f.state.fetches.length, 1);
  assert.equal(f.state.posts.length, 1);
  assert.deepEqual(f.state.fetches.map(item => item.redirect), ['error']);
  const body = JSON.parse(f.state.posts[0].body);
  assert.deepEqual(body, {
    model: MODEL,
    stream: true,
    messages: [
      { role: 'system', content: REFLECTION_PROMPT },
      { role: 'user', content: JSON.stringify(f.request.bundle) },
    ],
    tools: [],
    tool_choice: 'none',
    max_tokens: 128,
    stream_options: { include_usage: true },
  });
  assert.equal(f.state.posts[0].method, 'POST');
  assert.equal(f.state.posts[0].path, '/v1/chat/completions');
  assert.equal(f.state.posts[0].body.includes(AMBIENT), false);
  const run = f.state.runs[0];
  assert.deepEqual(run.notes.text, expected.parts);
  assert.ok(run.notes.models.length > 0);
  assert.ok(run.notes.models.every(model => model === MODEL));
  assert.deepEqual(run.notes.usage.at(-1), { inputTokens: 19, outputTokens: 7 });
  assert.ok(f.state.authorizations.length >= 2);
  assert.ok(f.state.authorizations.every(entry => entry.allowed && entry.frozen));
  assert.equal(f.state.audits.at(-1).outcome, 'complete');
  sanitized(f, null);
});

test('SDK completion before HTTP EOF cancels owned body without masking success', OPTIONS, async t => {
  const f = await fixture(t, {
    plan: response => writeSse(response, normalWire().wire, false),
  });
  const result = await succeeded(f.start());
  assert.equal(result.publicText, adviceText());
  assert.deepEqual(result.usage, { inputTokens: 19, outputTokens: 7 });
  await f.state.responseClosed.promise;
  assert.equal(f.state.fetches.length, 1);
  assert.equal(f.state.audits.at(-1).outcome, 'complete');
  sanitized(f, null);
});

test('absent raw model/usage remain null despite SDK request echoes and default zeros', OPTIONS, async t => {
  const f = await fixture(t, {
    plan: response => writeSse(response, goodWire({
      text: adviceText(), model: null, finish: 'stop', usage: null,
    }).wire, true),
  });
  const run = f.start();
  const result = await succeeded(run);
  assert.equal(result.reportedModel, null);
  assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null });
  assert.deepEqual(run.notes.models, []);
  assert.deepEqual(run.notes.usage, []);
  assert.deepEqual(f.state.audits.at(-1).usage, {
    inputTokens: null, outputTokens: null,
  });
  sanitized(f, null);
});

test('explicit raw zero usage is observed zero, not fabricated unknown', OPTIONS, async t => {
  const f = await fixture(t, {
    plan: response => writeSse(response, goodWire({
      text: adviceText(),
      model: MODEL,
      finish: 'stop',
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }).wire, true),
  });
  const result = await succeeded(f.start());
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
});

test('fresh authorization after awaited onPayload denies actual fetch handoff', OPTIONS, async t => {
  const f = await fixture(t, {
    auditHook: (event, state) => {
      if (event.stage === 'handoff') state.allowed = false;
    },
  });
  const error = await rejected(f.start(), ['unauthorized', 'transport']);
  assert.ok(f.state.audits.some(event => event.stage === 'handoff'));
  assert.equal(f.state.authorizations.at(-1).allowed, false);
  assert.equal(f.state.fetches.length, 0);
  assert.equal(f.state.posts.length, 0);
  assert.equal(f.state.audits.at(-1).fetchHandoffs, 0);
  sanitized(f, error);
});

for (const [name, mutate] of [
  ['extra input', body => { body.messages.push({ role: 'user', content: 'UNAPPROVED_EXTRA_TEXT' }); }],
  ['different model', body => { body.model = 'unapproved-model'; }],
  ['missing token bound', body => { delete body.max_tokens; }],
  ['oversized input', body => { body.messages[1].content += 'x'.repeat(100000); }],
]) {
  test(`actual wire payload rejects ${name} added after onPayload`, OPTIONS, async t => {
    const f = await fixture(t, {});
    const stream = f.runtime.streamSimple.bind(f.runtime);
    f.runtime.streamSimple = (model, context, options) => stream(model, context, {
      ...options,
      onPayload: async (original, selected) => {
        const body = structuredClone(await options.onPayload(original, selected));
        mutate(body);
        return body;
      },
    });
    await rejected(f.start(), ['invalid-binding', 'payload-bound', 'transport']);
    assert.equal(f.state.fetches.length, 0);
    assert.equal(f.state.posts.length, 0);
  });
}

test('bounded gzip request encoding preserves the exact approved JSON body', OPTIONS, async t => {
  let decoded;
  const f = await fixture(t, {
    fetch: async outgoing => {
      assert.equal(outgoing.headers.get('content-encoding'), 'gzip');
      decoded = JSON.parse(gunzipSync(Buffer.from(await outgoing.arrayBuffer())).toString('utf8'));
      return new Response(normalWire().wire, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  const stream = f.runtime.streamSimple.bind(f.runtime);
  f.runtime.streamSimple = (model, context, options) => stream(model, context, {
    ...options,
    fetch: async (input, init) => {
      const incoming = new Request(input, init);
      const headers = new Headers(incoming.headers);
      headers.set('content-encoding', 'gzip'); headers.delete('content-length');
      return options.fetch(incoming.url, { method: incoming.method, headers, body: gzipSync(Buffer.from(await incoming.arrayBuffer())), signal: incoming.signal });
    },
  });
  assert.equal((await succeeded(f.start())).publicText, adviceText());
  assert.equal(decoded.model, MODEL); assert.equal(decoded.max_tokens, 128);
  assert.deepEqual(decoded.messages, [{ role: 'system', content: REFLECTION_PROMPT }, { role: 'user', content: JSON.stringify(f.request.bundle) }]);
});

test('payload bound prevents any fetch', OPTIONS, async t => {
  const f = await fixture(t, { bounds: { maxPayloadBytes: 128 } });
  const error = await rejected(f.start(), ['payload-bound', 'transport']);
  assert.equal(f.state.fetches.length, 0);
  assert.equal(f.state.posts.length, 0);
  sanitized(f, error);
});

test('aggregate transport bound counts response comments, not merely public text', OPTIONS, async t => {
  const f = await fixture(t, {
    bounds: { maxTransportBytes: 4096 },
    plan: response => writeSse(
      response, `:${'x'.repeat(8192)}\n\n${normalWire().wire}`, true,
    ),
  });
  const run = f.start();
  const error = await rejected(run, ['transport-bound']);
  assert.equal(f.state.fetches.length, 1);
  assert.ok(Buffer.byteLength(f.state.posts[0].body) < 4096);
  assert.ok(f.state.audits.at(-1).transportBytes > 4096);
  assert.equal(run.notes.text.join(''), '');
  sanitized(f, error);
});

for (const [name, bounds] of [
  ['characters', { maxOutputChars: 8 }],
  ['UTF-8 bytes', { maxOutputBytes: 8 }],
  ['events', { maxEvents: 1 }],
]) {
  test(`public ${name} bound rejects without excess public delivery`, OPTIONS, async t => {
    const f = await fixture(t, { bounds });
    const run = f.start();
    const error = await rejected(run, [name === 'events' ? 'event-bound' : 'output-bound']);
    assert.ok(run.notes.text.join('').length <= f.bounds.maxOutputChars);
    assert.ok(Buffer.byteLength(run.notes.text.join('')) <= f.bounds.maxOutputBytes);
    sanitized(f, error);
  });
}

test('raw output-token overrun is retained and rejects', OPTIONS, async t => {
  const f = await fixture(t, {
    plan: response => writeSse(response, goodWire({
      text: adviceText(), model: MODEL, finish: 'stop',
      usage: { prompt_tokens: 10, completion_tokens: 129, total_tokens: 139 },
    }).wire, true),
  });
  const run = f.start();
  const error = await rejected(run, ['output-bound']);
  assert.equal(run.notes.usage.at(-1).outputTokens, 129);
  sanitized(f, error);
});

for (const reported of ['synthetic-other-model', 'Claude-synthetic-response-label']) {
  test(`reported identity is not normalized into agreement: ${reported}`, OPTIONS, async t => {
    const f = await fixture(t, {
      plan: response => writeSse(response, goodWire({
        text: adviceText(), model: reported, finish: 'stop', usage: null,
      }).wire, true),
    });
    const run = f.start();
    const error = await rejected(run, ['model-mismatch']);
    assert.equal(run.notes.models[0], reported);
    assert.equal(f.state.audits.at(-1).requestedModel, MODEL);
    assert.equal(f.state.audits.at(-1).reportedModel, reported);
    assert.equal(f.state.fetches.length, 1);
    sanitized(f, error);
  });
}

for (const [name, wire, codes] of [
  [
    'truncated token completion',
    goodWire({ text: adviceText(), model: MODEL, finish: 'length', usage: null }).wire,
    ['incomplete'],
  ],
  [
    'missing terminal finish reason',
    frame({ role: 'assistant' }, null, MODEL) +
      frame({ content: '{"version":1,' }, null, MODEL),
    ['transport', 'incomplete'],
  ],
  [
    'tool output',
    frame({ role: 'assistant' }, null, MODEL) +
      frame({ tool_calls: [{
        index: 0, id: 'synthetic-tool-call', type: 'function',
        function: { name: 'forbidden_action', arguments: '{}' },
      }] }, null, MODEL) +
      frame({}, 'tool_calls', MODEL) + 'data: [DONE]\n\n',
    ['tools-forbidden'],
  ],
  [
    'thinking output',
    frame({ role: 'assistant' }, null, MODEL) +
      frame({ reasoning_content: PRIVATE_THINKING }, null, MODEL) +
      normalWire().wire,
    ['thinking-forbidden'],
  ],
  [
    'malformed public JSON',
    goodWire({ text: 'not JSON', model: MODEL, finish: 'stop', usage: null }).wire,
    ['invalid-output'],
  ],
]) {
  test(`real SDK rejects ${name}`, OPTIONS, async t => {
    const f = await fixture(t, {
      plan: response => writeSse(response, wire, true),
    });
    const run = f.start();
    const error = await rejected(run, codes);
    assert.equal(f.state.fetches.length, 1);
    assert.equal(run.notes.text.join('').includes(PRIVATE_THINKING), false);
    sanitized(f, error);
  });
}

test('HTTP error is sanitized, has no retry, and leaks no private headers/body', OPTIONS, async t => {
  const f = await fixture(t, {
    plan: response => {
      response.writeHead(503, {
        'content-type': 'application/json',
        'x-private-sentinel': PRIVATE_HEADER,
      });
      response.end(JSON.stringify({ error: { message: PRIVATE_ERROR } }));
    },
  });
  const run = f.start();
  const error = await rejected(run, ['transport']);
  assert.equal(f.state.posts.length, 1);
  assert.equal(f.state.fetches.length, 1);
  assert.deepEqual(run.notes.text, []);
  sanitized(f, error);
});

test('stream failure retains only prior public text and observed usage', OPTIONS, async t => {
  const partial = '{"version":1,';
  const f = await fixture(t, {
    plan: response => writeSse(response,
      frame({ role: 'assistant' }, null, MODEL) +
      usageFrame({ prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 }, MODEL) +
      frame({ content: partial }, null, MODEL) +
      `data: ${JSON.stringify({ error: { message: PRIVATE_ERROR } })}\n\n`,
      true),
  });
  const run = f.start();
  const error = await rejected(run, ['transport']);
  assert.equal(run.notes.text.join(''), partial);
  assert.deepEqual(run.notes.usage.at(-1), { inputTokens: 11, outputTokens: 2 });
  sanitized(f, error);
});

test('redirect is denied instead of replaying the public body at another URL', OPTIONS, async t => {
  const f = await fixture(t, {
    plan: (response, post) => {
      assert.equal(post.path, '/v1/chat/completions');
      response.writeHead(307, { location: '/owned-but-unapproved-target' });
      response.end();
    },
  });
  const error = await rejected(f.start(), ['transport']);
  assert.deepEqual(f.state.posts.map(post => post.path), ['/v1/chat/completions']);
  assert.equal(f.state.fetches.length, 1);
  assert.equal(f.state.fetches[0].redirect, 'error');
  sanitized(f, error);
});

test('caller abort cancels an owned live SSE body and preserves public partial text', OPTIONS, async t => {
  const partial = '{"version":1,';
  const f = await fixture(t, {
    plan: response => writeSse(response,
      frame({ role: 'assistant' }, null, MODEL) +
      frame({ content: partial }, null, MODEL), false),
  });
  const run = f.start();
  await f.state.firstText.promise;
  run.caller.abort();
  const error = await rejected(run, ['aborted']);
  await f.state.responseClosed.promise;
  assert.equal(run.notes.text.join(''), partial);
  assert.equal(f.state.fetches.length, 1);
  sanitized(f, error);
});

test('strict request/config binding rejects before transport', OPTIONS, async t => {
  const f = await fixture(t, {});
  for (const mutate of [
    request => { request.tools = [{ name: 'forbidden' }]; },
    request => { request.actions = 'allowed'; },
    request => { request.delegation = 'allowed'; },
    request => { request.ambientContext = 'inherit'; },
    request => { request.thinking = 'enabled'; },
    request => { request.model.configurationDigest = reflectionTextDigest('other'); },
    request => { request.prompt.text += '\nUnapproved prompt change.'; },
  ]) {
    const request = structuredClone(f.request);
    mutate(request);
    await rejected(f.start(request), ['invalid-request']);
  }
  assert.equal(f.state.fetches.length, 0);
  assert.equal(f.state.posts.length, 0);
});

test('ignored fetch abort retains pending completion/busy until actual fetch settles', OPTIONS, async t => {
  const clock = new ManualClock();
  const entered = deferred();
  const releaseFetch = deferred();
  const f = await fixture(t, {
    clock,
    fetch: outgoing => {
      entered.resolve(outgoing);
      return releaseFetch.promise;
    },
  });
  const run = f.start();
  try {
    const outgoing = await entered.promise;
    clock.advance(f.request.deadlineMs);
    await f.state.draining.promise;
    assert.equal(outgoing.signal.aborted, true);
    assert.equal(run.settled, false);
    await rejected(f.start(), ['busy']);
    assert.equal(f.state.fetches.length, 1);
    assert.equal(f.state.posts.length, 0);
  } finally {
    run.caller.abort();
    releaseFetch.resolve(new Response('late ignored public body', {
      headers: { 'content-type': 'text/event-stream' },
    }));
  }
  const error = await rejected(run, ['deadline']);
  assert.deepEqual(run.notes.text, []);
  // The rejected busy invocation emits no audit; only the original attempt does.
  sanitized(f, error);
});

// A deliberately noncooperating reader behind a Response subclass. This is a
// handwritten transport-boundary port, not a claim about native stream cancel
// semantics. The adapter/SDK still exchange their real normalized SSE stream.
class DeferredBodyResponse extends Response {
  controlledBody;

  constructor(port) {
    super(null, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
    this.controlledBody = {
      getReader: () => port.reader,
      cancel: () => port.reader.cancel(),
    };
  }

  get body() {
    return this.controlledBody;
  }
}

function deferredBodyPort() {
  const readEntered = deferred();
  const cancelEntered = deferred();
  const releaseRead = deferred();
  const releaseCancel = deferred();
  const reader = {
    read() {
      readEntered.resolve();
      return releaseRead.promise;
    },
    cancel() {
      cancelEntered.resolve();
      return releaseCancel.promise;
    },
    releaseLock() {},
  };
  return {
    reader, readEntered, cancelEntered, releaseRead, releaseCancel,
    release() {
      releaseRead.resolve({ done: true, value: undefined });
      releaseCancel.resolve();
    },
  };
}

test('ignored body read/cancel keeps completion busy until both owned operations settle', OPTIONS, async t => {
  const port = deferredBodyPort();
  const f = await fixture(t, {
    fetch: () => Promise.resolve(new DeferredBodyResponse(port)),
  });
  const run = f.start();
  try {
    await port.readEntered.promise;
    run.caller.abort();
    await port.cancelEntered.promise;
    await f.state.draining.promise;
    assert.equal(run.settled, false);
    await rejected(f.start(), ['busy']);

    port.releaseRead.resolve({ done: true, value: undefined });
    // A single microtask checkpoint, not a sleep or polling loop. The explicit
    // still-unresolved cancellation gate remains a tracked transport operation.
    await Promise.resolve();
    assert.equal(run.settled, false);
    await rejected(f.start(), ['busy']);
    assert.equal(f.state.fetches.length, 1);
  } finally {
    run.caller.abort();
    port.release();
  }
  const error = await rejected(run, ['aborted']);
  assert.deepEqual(run.notes.text, []);
  assert.equal(f.state.posts.length, 0);
  sanitized(f, error);
});
