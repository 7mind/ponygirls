import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ReflectionCritic,
  DEFAULT_CRITIC_LIMITS,
  REFLECTION_NAMESPACE,
  REFLECTION_PROMPT,
  criticBundleDigest,
  reflectionTextDigest,
} from '../src/experiments/reflection-critic.ts';

// Specified Behavioral-Active / Blackbox-Atomic.
// Synthetic fixtures and handwritten ports test controller semantics, not model
// quality, physical weights, production transport, or OS/process isolation.

const EVENT = Object.freeze({
  kind: 'artifact-ready',
  origin: 'ordinary-work',
});

function goodText() {
  return JSON.stringify({
    version: 1,
    findings: [{
      severity: 'warning',
      message: 'The synthetic artifact needs an ordinary check.',
      refs: ['artifact', 'evidence'],
    }],
  });
}

function reply(publicText) {
  return {
    publicText,
    reportedModel: 'approved-test-model',
    usage: { inputTokens: 41, outputTokens: 23 },
  };
}

class ManualClock {
  monotonicTime;
  civilTime;
  timers;

  constructor() {
    this.monotonicTime = 50;
    this.civilTime = 1700000000000;
    this.timers = new Set();
  }

  monotonicNowMs() {
    return this.monotonicTime;
  }

  civilNowMs() {
    return this.civilTime;
  }

  schedule(delayMs, callback) {
    const timer = { at: this.monotonicTime + delayMs, callback };
    this.timers.add(timer);
    return () => this.timers.delete(timer);
  }

  advance(milliseconds) {
    this.monotonicTime += milliseconds;
    this.civilTime += milliseconds;
    for (const timer of [...this.timers]) {
      if (
        timer.at <= this.monotonicTime &&
        this.timers.delete(timer)
      ) {
        timer.callback();
      }
    }
  }
}

class Ids {
  count;

  constructor() {
    this.count = 0;
  }

  nextId() {
    this.count += 1;
    return `reflection-${this.count}`;
  }
}

class Journal {
  records;
  rejectKind;

  constructor() {
    this.records = [];
    this.rejectKind = null;
  }

  load(namespace) {
    assert.equal(namespace, REFLECTION_NAMESPACE);
    return structuredClone(this.records);
  }

  tryAppend(envelope) {
    assert.equal(envelope.namespace, REFLECTION_NAMESPACE);
    assert.equal(envelope.version, 1);
    const record = envelope.record;
    if (
      record.kind === this.rejectKind ||
      this.records.some(entry => entry.record.id === record.id)
    ) {
      return false;
    }
    if (
      record.kind === 'terminal' &&
      this.records.some(entry => (
        entry.record.kind === 'terminal' &&
        entry.record.startId === record.startId
      ))
    ) {
      return false;
    }
    if (
      record.kind === 'transport' &&
      this.records.some(entry => (
        entry.record.kind === 'transport' &&
        entry.record.startId === record.startId &&
        entry.record.observation === record.observation
      ))
    ) {
      return false;
    }
    if (
      record.kind === 'start' &&
      record.trigger === 'automatic' &&
      this.records.some(entry => (
        entry.record.kind === 'start' &&
        entry.record.identity === record.identity
      ))
    ) {
      return false;
    }
    this.records.push(structuredClone(envelope));
    return true;
  }
}

class DeterministicModel {
  calls;
  result;

  constructor(result) {
    this.calls = [];
    this.result = result;
  }

  complete(request, observer) {
    this.calls.push({ request, observer });
    return Promise.resolve(structuredClone(this.result));
  }
}

class DeferredModel {
  calls;

  constructor() {
    this.calls = [];
  }

  complete(request, observer) {
    return new Promise((resolve, reject) => {
      // Deliberately ignores signal.
      this.calls.push({ request, observer, resolve, reject });
    });
  }
}

class FailingModel {
  calls;

  constructor() {
    this.calls = [];
  }

  complete(request, observer) {
    this.calls.push({ request, observer });
    observer.onPublicText('{"version":1,');
    observer.onUsage({ inputTokens: 11, outputTokens: null });
    return Promise.reject(new Error('PRIVATE credential=must-not-be-retained'));
  }
}

class ThrowingModel {
  calls;

  constructor() {
    this.calls = [];
  }

  complete(request, observer) {
    this.calls.push({ request, observer });
    throw new Error('PRIVATE synchronous transport error');
  }
}

function makeBundle(scope, suffix) {
  const records = [
    ['contract', 'task-contract', `Synthetic contract ${suffix}.`],
    ['artifact', 'artifact', `Synthetic artifact ${suffix}.`],
    ['evidence', 'evidence', `Synthetic evidence ${suffix}.`],
    ['check', 'check', `Synthetic historical check ${suffix}: inconclusive.`],
  ].map(([id, kind, publicText]) => ({
    id,
    kind,
    publicText,
    digest: reflectionTextDigest(publicText),
  }));
  return { version: 1, scope: structuredClone(scope), records };
}

function fixture(model, limitOverrides) {
  const limits = { ...DEFAULT_CRITIC_LIMITS, ...limitOverrides };
  const clock = new ManualClock();
  const ids = new Ids();
  const journal = new Journal();
  const scope = {
    projectId: 'synthetic-project',
    sessionId: 'synthetic-session',
    branchId: 'synthetic-branch',
    taskId: 'synthetic-task',
    epoch: 1,
  };
  const bundle = makeBundle(scope, 'initial');
  const grant = {
    id: 'operator-grant',
    scope: structuredClone(scope),
    artifactId: 'artifact',
    inputDigest: criticBundleDigest(bundle),
    model: {
      id: 'approved-test-model',
      configurationDigest: reflectionTextDigest('synthetic-adapter-config'),
    },
    promptDigest: reflectionTextDigest(REFLECTION_PROMPT),
    privacyPolicyId: 'synthetic-public-policy',
    privacyPolicyDigest: reflectionTextDigest('public synthetic data only'),
    dataPolicy: 'synthetic-public-only',
    expiresAt: clock.civilNowMs() + 100000,
    revoked: false,
    maxRequests: limits.maxRequests,
    deadlineMs: Math.min(100, limits.deadlineMs),
    maxOutputTokens: Math.min(100, limits.maxOutputTokens),
  };
  const state = {
    snapshot: {
      scope: structuredClone(scope),
      inputDigest: criticBundleDigest(bundle),
      taskState: 'working',
      inquiryActive: false,
    },
    grant,
    allowed: true,
    reconciliations: new Map(),
  };
  const ports = {
    model,
    clock,
    ids,
    storage: journal,
    context: {
      snapshot: () => structuredClone(state.snapshot),
      grant: id => (
        state.grant !== null && id === state.grant.id
          ? structuredClone(state.grant)
          : null
      ),
      isApprovedModel: identity => (
        state.allowed &&
        state.grant !== null &&
        identity.id === state.grant.model.id &&
        identity.configurationDigest === state.grant.model.configurationDigest
      ),
    },
    reconciliation: {
      evidence: id => (
        state.reconciliations.has(id)
          ? structuredClone(state.reconciliations.get(id))
          : null
      ),
    },
  };
  const controller = new ReflectionCritic(ports, limits);
  const request = { grantId: grant.id, artifactId: 'artifact', bundle };
  return {
    controller, request, ports, limits, state, clock, journal, model,
  };
}

function launch(f) {
  f.controller.setEnabled(true);
  const result = f.controller.trigger(EVENT, f.request);
  assert.equal(result.status, 'started');
  return result;
}

function records(f, kind) {
  return f.controller.history()
    .map(envelope => envelope.record)
    .filter(record => record.kind === kind);
}

function changeTarget(f, suffix) {
  const scope = {
    ...f.state.snapshot.scope,
    epoch: f.state.snapshot.scope.epoch + 1,
  };
  const bundle = makeBundle(scope, suffix);
  f.request = {
    grantId: `operator-grant-${suffix}`,
    artifactId: 'artifact',
    bundle,
  };
  f.state.snapshot.scope = structuredClone(scope);
  f.state.snapshot.inputDigest = criticBundleDigest(bundle);
  f.state.grant = {
    ...f.state.grant,
    id: f.request.grantId,
    scope: structuredClone(scope),
    inputDigest: criticBundleDigest(bundle),
    revoked: false,
  };
}

function authorizeRelease(f, requestId) {
  f.state.reconciliations.set(requestId, {
    id: `receipt-${requestId}`,
    requestId,
    observedAt: f.clock.civilNowMs(),
    basisDigest: reflectionTextDigest('explicit trusted reconciliation'),
    admission: 'release-authorized',
  });
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

test('disabled, missing grant, host denial, and recognizable excluded models never send', () => {
  {
    const f = fixture(new DeterministicModel(reply(goodText())), {});
    assert.equal(f.controller.trigger(EVENT, f.request).code, 'disabled');
    assert.equal(f.model.calls.length, 0);
  }
  for (const mutate of [
    f => { f.state.grant = null; },
    f => { f.state.allowed = false; },
    f => { f.state.grant.model.id = 'Anthropic:test'; },
    f => { f.state.grant.model.id = 'unapproved-Claude-alias'; },
  ]) {
    const f = fixture(new DeterministicModel(reply(goodText())), {});
    f.controller.setEnabled(true);
    mutate(f);
    const result = f.controller.trigger(EVENT, f.request);
    assert.equal(result.status, 'rejected');
    assert.ok(['no-grant', 'forbidden-model'].includes(result.code));
    assert.equal(f.model.calls.length, 0);
    assert.equal(f.controller.history().length, 0);
  }
});

test('exact immutable public payload, fixed prompt, no tools or mutation authority', async () => {
  const f = fixture(new DeterministicModel(reply(goodText())), {});
  const expected = structuredClone(f.request.bundle);
  const run = launch(f);
  const request = f.model.calls[0].request;
  assert.deepEqual(request.bundle, expected);
  assert.deepEqual(Object.keys(request).sort(), [
    'requestId', 'model', 'prompt', 'bundle', 'tools', 'ambientContext',
    'thinking', 'delegation', 'actions', 'maxOutputTokens', 'deadlineMs',
  ].sort());
  assert.deepEqual(request.tools, []);
  assert.equal(request.ambientContext, 'none');
  assert.equal(request.thinking, 'disabled');
  assert.equal(request.delegation, 'disabled');
  assert.equal(request.actions, 'none');
  assert.equal(request.prompt.text, REFLECTION_PROMPT);
  assert.equal(Object.isFrozen(request.bundle.records[0]), true);
  assert.throws(() => { request.bundle.records[0].publicText = 'changed'; });

  f.request.bundle.records[0].publicText = 'caller mutation';
  const completed = await run.completion;
  assert.deepEqual(request.bundle, expected);
  assert.equal(completed.terminal.outcome, 'accepted');
  assert.equal(completed.terminal.advice.kind, 'model-authored-advice');
  assert.equal(completed.terminal.advice.authority, 'none');
  assert.equal(completed.terminal.providerWork, 'unknown');
  assert.equal(completed.terminal.admissionAtCompletion, 'released');
  assert.equal(f.controller.status().outstandingRequestIds.length, 0);

  assert.equal(f.controller.consumeAtSafeBoundary().terminal.outcome, 'accepted');
  assert.equal(f.controller.consumeAtSafeBoundary(), null);
  assert.ok(f.controller.history().every(entry => (
    entry.namespace === 'cuckoo.experimental.reflection'
  )));
});

test('automatic dedup persists; explicit retry has its own start and budget entry', async () => {
  const f = fixture(new DeterministicModel(reply(goodText())), { maxRequests: 2 });
  const first = launch(f);
  await first.completion;
  assert.equal(f.controller.trigger(EVENT, f.request).code, 'duplicate');
  assert.equal(f.controller.retry('absent', f.request).code, 'invalid-retry');

  const second = f.controller.retry(first.requestId, f.request);
  assert.equal(second.status, 'started');
  assert.notEqual(second.requestId, first.requestId);
  await second.completion;
  assert.equal(records(f, 'start')[1].retryOf, first.requestId);
  assert.equal(records(f, 'start')[1].trigger, 'retry');
  assert.equal(f.controller.retry(second.requestId, f.request).code, 'budget');
  assert.equal(f.model.calls.length, 2);

  f.state.snapshot.scope.epoch += 1;
  const reloaded = new ReflectionCritic(f.ports, f.limits);
  reloaded.setEnabled(true);
  assert.equal(reloaded.consumeAtSafeBoundary(), null);
  // Old bundle is no longer applicable, independently of deduplication.
  assert.equal(reloaded.trigger(EVENT, f.request).code, 'not-current');
  assert.equal(f.model.calls.length, 2);
});

test('critic/self/unrelated events do not create a recursive request', async () => {
  const f = fixture(new DeferredModel(), {});
  const run = launch(f);
  assert.equal(f.controller.trigger(EVENT, f.request).code, 'busy');
  for (const event of [
    { kind: 'critic-output', origin: 'critic' },
    { kind: 'input-updated', origin: 'critic' },
    { kind: 'other', origin: 'ordinary-work' },
  ]) {
    assert.equal(f.controller.trigger(event, f.request).code, 'ineligible-event');
  }
  f.model.calls[0].resolve(reply(goodText()));
  await run.completion;
  assert.equal(f.model.calls.length, 1);
});

test('exact grant, policy, model configuration, source digests and task scope are required', () => {
  for (const mutate of [
    f => { f.state.grant.revoked = true; },
    f => { f.state.grant.expiresAt = f.clock.civilNowMs(); },
    f => { f.state.grant.scope.taskId = 'different-task'; },
    f => { f.state.grant.scope.branchId = 'different-branch'; },
    f => { f.state.grant.scope.epoch += 1; },
    f => { f.state.grant.inputDigest = reflectionTextDigest('different'); },
    f => { f.state.grant.promptDigest = reflectionTextDigest('different'); },
    f => { f.state.grant.dataPolicy = 'private'; },
    f => { f.state.grant.privacyPolicyDigest = 'malformed'; },
    f => { f.request.artifactId = 'evidence'; },
    f => { f.request.bundle.records = []; },
    f => { f.request.bundle.records[0].digest = reflectionTextDigest('changed'); },
    f => { f.request.bundle.records[0].thinking = 'hidden'; },
    f => { f.state.snapshot.inputDigest = reflectionTextDigest('new-input'); },
    f => { f.state.snapshot.scope.sessionId = 'different-session'; },
    f => { f.state.snapshot.taskState = 'finished'; },
  ]) {
    const f = fixture(new DeterministicModel(reply(goodText())), {});
    f.controller.setEnabled(true);
    mutate(f);
    assert.equal(f.controller.trigger(EVENT, f.request).status, 'rejected');
    assert.equal(f.model.calls.length, 0);
  }
});

test('forged authority, extra fields, malformed output and out-of-bundle refs fail closed', async () => {
  const finding = { severity: 'info', message: 'Synthetic advice.', refs: ['artifact'] };
  for (const text of [
    'not JSON',
    JSON.stringify({ version: 1, findings: [finding], verified: true }),
    JSON.stringify({ version: 1, findings: [finding], approved: true }),
    JSON.stringify({ version: 1, findings: [finding], action: 'write artifact' }),
    JSON.stringify({
      version: 1, findings: [{ ...finding, correction: { target: 'artifact' } }],
    }),
    JSON.stringify({ version: 1, findings: [{ ...finding, refs: ['not-supplied'] }] }),
    JSON.stringify({
      version: 1, findings: [{ ...finding, refs: ['artifact', 'artifact'] }],
    }),
    JSON.stringify({ version: 1, findings: [{ ...finding, refs: [] }] }),
    JSON.stringify({ version: 1, findings: [{ ...finding, severity: 'verified' }] }),
  ]) {
    const f = fixture(new DeterministicModel(reply(text)), {});
    const completed = await launch(f).completion;
    assert.equal(completed.terminal.outcome, 'invalid-output');
    assert.equal(completed.terminal.advice, null);
    assert.equal(completed.terminal.publicText, text);
    assert.equal(f.controller.consumeAtSafeBoundary(), null);
  }
});

test('input/output/refs/findings/token/deadline execution bounds are enforced', async () => {
  for (const limits of [{ maxInputChars: 100 }, { maxInputBytes: 100 }]) {
    const f = fixture(new DeterministicModel(reply(goodText())), limits);
    f.controller.setEnabled(true);
    assert.equal(f.controller.trigger(EVENT, f.request).code, 'unauthorized');
    assert.equal(f.model.calls.length, 0);
  }
  for (const limits of [
    { maxOutputChars: 8 }, { maxOutputBytes: 8 },
    { maxFindingChars: 5 }, { maxRefs: 1 },
  ]) {
    const f = fixture(new DeterministicModel(reply(goodText())), limits);
    const completed = await launch(f).completion;
    assert.ok(['output-limit', 'invalid-output'].includes(completed.terminal.outcome));
    assert.ok(completed.terminal.publicText.length <= f.limits.maxOutputChars);
    assert.ok(Buffer.byteLength(completed.terminal.publicText) <= f.limits.maxOutputBytes);
    assert.equal(completed.terminal.advice, null);
  }
  {
    const text = JSON.stringify({
      version: 1,
      findings: [
        { severity: 'info', message: 'One.', refs: ['artifact'] },
        { severity: 'info', message: 'Two.', refs: ['evidence'] },
      ],
    });
    const f = fixture(new DeterministicModel(reply(text)), { maxFindings: 1 });
    assert.equal((await launch(f).completion).terminal.outcome, 'invalid-output');
  }
  {
    const response = reply(goodText());
    response.usage.outputTokens = 101;
    const f = fixture(new DeterministicModel(response), {});
    const completed = await launch(f).completion;
    assert.equal(completed.terminal.outcome, 'output-limit');
    assert.equal(completed.terminal.usage.outputTokens, 101);
  }
  for (const mutate of [
    f => { f.state.grant.deadlineMs = f.limits.deadlineMs + 1; },
    f => { f.state.grant.maxOutputTokens = f.limits.maxOutputTokens + 1; },
  ]) {
    const f = fixture(new DeterministicModel(reply(goodText())), {});
    f.controller.setEnabled(true);
    mutate(f);
    assert.equal(f.controller.trigger(EVENT, f.request).code, 'unauthorized');
    assert.equal(f.model.calls.length, 0);
  }
});

test('timeout ends local wait, not transport reservation; changing targets cannot accumulate sends', async () => {
  const f = fixture(new DeferredModel(), {});
  const run = launch(f);
  const call = f.model.calls[0];
  call.observer.onPublicText('{"version":1,');
  call.observer.onUsage({ inputTokens: 7, outputTokens: null });

  f.clock.advance(100);
  const completed = await run.completion;
  assert.equal(completed.terminal.outcome, 'timeout');
  assert.equal(completed.terminal.admissionAtCompletion, 'reserved');
  assert.equal(completed.terminal.providerWork, 'unknown');
  assert.equal(completed.terminal.usage.outputTokens, null);
  assert.equal(call.observer.signal.aborted, true);
  assert.equal(f.controller.status().localRequestId, null);
  assert.deepEqual(f.controller.status().outstandingRequestIds, [run.requestId]);

  for (const suffix of ['second', 'third', 'fourth']) {
    changeTarget(f, suffix);
    f.controller.reconcile();
    assert.equal(f.controller.trigger(EVENT, f.request).code, 'busy');
    assert.equal(f.model.calls.length, 1);
  }

  // Later measured usage is observation evidence, not a rewrite of the timeout.
  call.observer.onUsage({ inputTokens: 17, outputTokens: 3 });
  call.resolve({
    publicText: '{"version":1,"findings":[]}',
    reportedModel: 'approved-test-model',
    usage: { inputTokens: 19, outputTokens: 4 },
  });
  await flush();
  assert.equal(records(f, 'terminal').length, 1);
  assert.deepEqual(records(f, 'terminal')[0], completed.terminal);
  const observation = records(f, 'transport').find(record => (
    record.observation === 'client-fulfilled'
  ));
  assert.equal(observation.usage.inputTokens, 19);
  assert.equal(observation.usage.outputTokens, 4);
  assert.equal(observation.providerWork, 'unknown');
  assert.equal(f.controller.status().outstandingRequestIds.length, 0);
  assert.equal(f.controller.consumeAtSafeBoundary(), null);
  assert.equal(f.model.calls.length, 1);

  // No automatic replay. An explicit new eligible event can now dispatch.
  const next = f.controller.trigger(EVENT, f.request);
  assert.equal(next.status, 'started');
  assert.equal(f.model.calls.length, 2);
  f.model.calls[1].resolve(reply(goodText()));
  await next.completion;
});

test('abort, disable, and supersession retain admission until ignored transport actually settles', async () => {
  for (const mode of ['abort', 'disable', 'scope']) {
    const f = fixture(new DeferredModel(), {});
    const run = launch(f);
    if (mode === 'abort') {
      assert.equal(f.controller.abort(run.requestId), true);
    } else if (mode === 'disable') {
      f.controller.setEnabled(false);
    } else {
      f.state.snapshot.scope.epoch += 1;
      f.controller.reconcile();
    }
    const completed = await run.completion;
    assert.ok(['cancelled', 'stale'].includes(completed.terminal.outcome));
    assert.equal(completed.terminal.admissionAtCompletion, 'reserved');

    f.controller.setEnabled(true);
    changeTarget(f, mode);
    assert.equal(f.controller.trigger(EVENT, f.request).code, 'busy');
    f.model.calls[0].reject(new Error('PRIVATE late rejection'));
    await flush();
    assert.equal(f.controller.status().outstandingRequestIds.length, 0);
    assert.equal(records(f, 'terminal').length, 1);
    assert.equal(f.controller.consumeAtSafeBoundary(), null);
    assert.equal(f.model.calls.length, 1);
  }
});

test('restart retains uncertainty and never silently retries a timed-out request or new target', async () => {
  const f = fixture(new DeferredModel(), {});
  const run = launch(f);
  f.clock.advance(100);
  await run.completion;
  changeTarget(f, 'after-restart');

  const reloaded = new ReflectionCritic(f.ports, f.limits);
  assert.equal(reloaded.status().enabled, false);
  reloaded.setEnabled(true);
  assert.deepEqual(reloaded.status().outstandingRequestIds, [run.requestId]);
  assert.equal(reloaded.trigger(EVENT, f.request).code, 'busy');
  assert.equal(reloaded.reconcileOutstanding(run.requestId), false);
  assert.equal(f.model.calls.length, 1);

  // An explicit trusted receipt is necessary when this incarnation cannot
  // observe settlement of the old promise.
  authorizeRelease(f, run.requestId);
  assert.equal(reloaded.reconcileOutstanding(run.requestId), true);
  assert.equal(reloaded.status().outstandingRequestIds.length, 0);
  assert.equal(reloaded.consumeAtSafeBoundary(), null);
  assert.equal(f.model.calls.length, 1);
});

test('restart of a persisted handoff intent preserves may-have-sent uncertainty', async () => {
  const f = fixture(new DeferredModel(), {});
  const old = launch(f);
  const start = records(f, 'start')[0];

  // Synthetic crash window: durable intent exists; the following observation
  // write was lost. Recovery cannot infer that model.complete was never called.
  f.journal.records = f.journal.records.filter(entry => entry.record.kind === 'start');
  changeTarget(f, 'crash-window');
  const reloaded = new ReflectionCritic(f.ports, f.limits);
  const recovery = reloaded.history().find(entry => entry.record.kind === 'terminal').record;
  assert.equal(start.dispatchIntent, 'may-have-been-sent');
  assert.equal(recovery.outcome, 'interrupted');
  assert.equal(recovery.elapsedMs, null);
  assert.equal(recovery.admissionAtCompletion, 'reserved');
  assert.equal(recovery.usage.availability, 'unknown');
  reloaded.setEnabled(true);
  assert.equal(reloaded.trigger(EVENT, f.request).code, 'busy');
  assert.equal(f.model.calls.length, 1);

  // Stop the old local waiter without interpreting this as transport settlement.
  f.controller.reconcile();
  await old.completion;
});

test('explicit trusted reconciliation releases admission but late completion still cannot become advice', async () => {
  const f = fixture(new DeferredModel(), {});
  const run = launch(f);
  f.controller.abort(run.requestId);
  await run.completion;
  assert.equal(f.controller.reconcileOutstanding(run.requestId), false);

  authorizeRelease(f, run.requestId);
  assert.equal(f.controller.reconcileOutstanding(run.requestId), true);
  assert.equal(f.controller.reconcileOutstanding(run.requestId), false);
  const release = records(f, 'transport').find(record => (
    record.observation === 'trusted-reconciled'
  ));
  assert.equal(release.providerWork, 'unknown');

  changeTarget(f, 'new-target');
  const next = f.controller.trigger(EVENT, f.request);
  assert.equal(next.status, 'started');
  f.model.calls[0].resolve(reply(goodText()));
  await flush();
  assert.equal(f.controller.consumeAtSafeBoundary(), null);
  assert.deepEqual(f.controller.status().outstandingRequestIds, [next.requestId]);

  f.model.calls[1].resolve(reply(goodText()));
  await next.completion;
  assert.equal(f.controller.consumeAtSafeBoundary().start.id, next.requestId);
});

test('synchronous client throw retains dispatch uncertainty instead of assuming nothing was sent', async () => {
  const f = fixture(new ThrowingModel(), {});
  const run = launch(f);
  const completed = await run.completion;
  assert.equal(completed.terminal.outcome, 'error');
  assert.equal(completed.terminal.admissionAtCompletion, 'reserved');
  assert.equal(records(f, 'transport')[0].observation, 'client-threw');
  changeTarget(f, 'after-throw');
  assert.equal(f.controller.trigger(EVENT, f.request).code, 'busy');
  assert.equal(f.model.calls.length, 1);
});

test('civil clock jumps do not alter monotonic request deadline; audit times are civil', async () => {
  const f = fixture(new DeferredModel(), {});
  const civilStart = f.clock.civilNowMs();
  const run = launch(f);
  assert.equal(records(f, 'start')[0].startedAt, civilStart);
  f.clock.civilTime -= 50000;
  f.clock.advance(99);
  assert.equal(f.controller.status().localRequestId, run.requestId);
  f.clock.advance(1);
  const completed = await run.completion;
  assert.equal(completed.terminal.outcome, 'timeout');
  assert.equal(completed.terminal.elapsedMs, 100);
  assert.equal(completed.terminal.finishedAt, civilStart - 50000 + 100);
  assert.equal(completed.terminal.admissionAtCompletion, 'reserved');
});

test('invalid monotonic clock and oversized controller limits fail explicitly', () => {
  const f = fixture(new DeferredModel(), {});
  f.clock.monotonicTime = NaN;
  assert.throws(() => new ReflectionCritic(f.ports, f.limits));
  assert.throws(() => new ReflectionCritic(f.ports, {
    ...f.limits,
    deadlineMs: 60001,
  }));
});

test('revocation, input changes and scope changes fence late results without retracting sent data', async () => {
  for (const mutate of [
    f => { f.state.grant.revoked = true; },
    f => { f.state.allowed = false; },
    f => { f.state.snapshot.inputDigest = reflectionTextDigest('changed-input'); },
    f => { f.state.snapshot.scope.taskId = 'other-task'; },
    f => { f.state.snapshot.scope.sessionId = 'other-session'; },
    f => { f.state.snapshot.scope.branchId = 'other-branch'; },
    f => { f.state.snapshot.scope.epoch += 1; },
    f => { f.state.grant.privacyPolicyDigest = reflectionTextDigest('new-policy'); },
    f => { f.state.snapshot.taskState = 'finished'; },
  ]) {
    const f = fixture(new DeferredModel(), {});
    const run = launch(f);
    mutate(f);
    f.model.calls[0].resolve(reply(goodText()));
    const completed = await run.completion;
    assert.equal(completed.terminal.outcome, 'stale');
    assert.equal(completed.terminal.applicability, 'inapplicable');
    assert.equal(completed.terminal.advice, null);
    assert.equal(completed.terminal.providerWork, 'unknown');
    assert.equal(f.controller.consumeAtSafeBoundary(), null);
    assert.equal(f.model.calls.length, 1);
  }
});

test('inquiry defers explicit delivery; finishing a task never starts another turn or goal', async () => {
  const f = fixture(new DeferredModel(), {});
  const run = launch(f);
  f.state.snapshot.inquiryActive = true;
  f.model.calls[0].resolve(reply(goodText()));
  assert.equal((await run.completion).terminal.outcome, 'accepted');
  assert.equal(f.controller.consumeAtSafeBoundary(), null);
  assert.equal(f.model.calls.length, 1);
  f.state.snapshot.inquiryActive = false;
  assert.equal(f.controller.consumeAtSafeBoundary().start.id, run.requestId);

  const g = fixture(new DeterministicModel(reply(goodText())), {});
  const completed = launch(g);
  await completed.completion;
  g.state.snapshot.taskState = 'finished';
  assert.equal(g.controller.consumeAtSafeBoundary(), null);
  assert.equal(g.controller.trigger(EVENT, g.request).code, 'task-finished');
  assert.equal(g.controller.retry(completed.requestId, g.request).code, 'task-finished');
  assert.equal(g.model.calls.length, 1);
});

test('queued advice is recomputed for applicability before consumption', async () => {
  for (const mutate of [
    f => { f.state.grant.revoked = true; },
    f => { f.state.snapshot.scope.epoch += 1; },
    f => { f.state.snapshot.inputDigest = reflectionTextDigest('new-input'); },
  ]) {
    const f = fixture(new DeterministicModel(reply(goodText())), {});
    await launch(f).completion;
    mutate(f);
    assert.equal(f.controller.consumeAtSafeBoundary(), null);
    assert.equal(f.model.calls.length, 1);
  }
});

test('requested and observed model remain distinct; unknown usage is not zero', async () => {
  {
    const f = fixture(new DeterministicModel({
      publicText: goodText(),
      reportedModel: null,
      usage: null,
    }), {});
    const completed = await launch(f).completion;
    assert.equal(completed.terminal.outcome, 'accepted');
    assert.equal(completed.terminal.reportedModel, null);
    assert.deepEqual(completed.terminal.usage, {
      availability: 'unknown',
      inputTokens: null,
      outputTokens: null,
    });
    assert.equal(records(f, 'start')[0].request.model.id, 'approved-test-model');
  }
  for (const reportedModel of ['different-model', 'Claude-observed']) {
    const f = fixture(new DeterministicModel({
      publicText: goodText(),
      reportedModel,
      usage: null,
    }), {});
    const completed = await launch(f).completion;
    assert.equal(completed.terminal.outcome, 'model-mismatch');
    assert.equal(completed.terminal.reportedModel, reportedModel);
    assert.equal(completed.terminal.advice, null);
    assert.equal(f.model.calls.length, 1);
  }
});

test('failure preserves public partial text and measured/unknown usage, not private errors', async () => {
  const f = fixture(new FailingModel(), {});
  const completed = await launch(f).completion;
  assert.equal(completed.terminal.outcome, 'error');
  assert.equal(completed.terminal.diagnostic, 'client-failed');
  assert.equal(completed.terminal.publicText, '{"version":1,');
  assert.equal(completed.terminal.usage.availability, 'partial');
  assert.equal(completed.terminal.usage.inputTokens, 11);
  assert.equal(completed.terminal.usage.outputTokens, null);
  assert.equal(completed.terminal.providerWork, 'unknown');
  assert.equal(JSON.stringify(f.controller.history()).includes('must-not-be-retained'), false);
  assert.equal(f.controller.consumeAtSafeBoundary(), null);
});

test('unexpected hidden result fields are rejected and not retained', async () => {
  const f = fixture(new DeterministicModel({
    ...reply(goodText()),
    thinking: 'PRIVATE hidden reasoning',
  }), {});
  const completed = await launch(f).completion;
  assert.equal(completed.terminal.outcome, 'invalid-output');
  assert.equal(JSON.stringify(f.controller.history()).includes('PRIVATE hidden reasoning'), false);
});

test('stream overflow stops local waiting but retains the outstanding request', async () => {
  const f = fixture(new DeferredModel(), {
    maxOutputChars: 7,
    maxOutputBytes: 9,
  });
  const run = launch(f);
  f.model.calls[0].observer.onPublicText('🦄🦄🦄🦄');
  const completed = await run.completion;
  assert.equal(completed.terminal.outcome, 'output-limit');
  assert.ok(completed.terminal.publicText.length <= 7);
  assert.ok(Buffer.byteLength(completed.terminal.publicText, 'utf8') <= 9);
  assert.equal(completed.terminal.admissionAtCompletion, 'reserved');
  changeTarget(f, 'after-overflow');
  assert.equal(f.controller.trigger(EVENT, f.request).code, 'busy');
  assert.equal(f.model.calls.length, 1);
});

test('failed durable start prevents sending; failed settlement persistence keeps admission reserved', async () => {
  {
    const f = fixture(new DeterministicModel(reply(goodText())), {});
    f.journal.rejectKind = 'start';
    f.controller.setEnabled(true);
    assert.equal(f.controller.trigger(EVENT, f.request).code, 'storage-unavailable');
    assert.equal(f.model.calls.length, 0);
  }
  {
    const f = fixture(new DeferredModel(), {});
    const run = launch(f);
    f.journal.rejectKind = 'transport';
    f.model.calls[0].resolve(reply(goodText()));
    const completed = await run.completion;
    assert.equal(completed.terminal.outcome, 'error');
    assert.equal(completed.terminal.diagnostic, 'transport-journal-unavailable');
    assert.equal(completed.terminal.admissionAtCompletion, 'reserved');
    changeTarget(f, 'after-storage-failure');
    assert.equal(f.controller.trigger(EVENT, f.request).code, 'busy');
    assert.equal(f.controller.consumeAtSafeBoundary(), null);
  }
});

test('malformed persistence is explicit failure rather than an empty valid journal', () => {
  const f = fixture(new DeferredModel(), {});
  f.journal.records.push({
    namespace: REFLECTION_NAMESPACE,
    version: 99,
    record: { kind: 'unknown', id: 'bad-record' },
  });
  assert.throws(() => new ReflectionCritic(f.ports, f.limits));
});

test('text identity preserves Unicode and lone surrogates without normalization', () => {
  assert.notEqual(reflectionTextDigest('é'), reflectionTextDigest('e\u0301'));
  assert.notEqual(reflectionTextDigest('\ud800'), reflectionTextDigest('\ufffd'));
  const f = fixture(new DeferredModel(), {});
  f.request.bundle.records[0].publicText = '🦄\ud800e\u0301';
  f.request.bundle.records[0].digest = reflectionTextDigest('🦄\ud800e\u0301');
  assert.equal(
    criticBundleDigest(structuredClone(f.request.bundle)),
    criticBundleDigest(f.request.bundle),
  );
});

test('reentrant retry cannot bypass admission or maxRequests=2', async () => {
  const f = fixture(new DeterministicModel(reply(goodText())), { maxRequests: 2 });
  const first = launch(f); await first.completion;
  const append = f.journal.tryAppend.bind(f.journal);
  let observedRetry = false; let nested = null;
  f.journal.tryAppend = envelope => {
    const stored = append(envelope);
    if (stored && envelope.record.kind === 'start' && envelope.record.trigger === 'retry' && !observedRetry) {
      observedRetry = true;
      nested = f.controller.retry(first.requestId, f.request);
    }
    return stored;
  };
  let outer;
  try { outer = f.controller.retry(first.requestId, f.request); }
  finally { f.journal.tryAppend = append; }
  assert.equal(outer.status, 'started'); assert.equal(observedRetry, true); assert.ok(nested);
  const observed = {
    nestedStatus: nested.status, nestedCode: nested.status === 'rejected' ? nested.code : null,
    modelCalls: f.model.calls.length,
    durableStarts: f.journal.records.filter(envelope => envelope.record.kind === 'start').length,
    outstanding: f.controller.status().outstandingRequestIds.length,
  };
  await outer.completion; await flush(); f.clock.advance(100);
  assert.deepEqual(observed, { nestedStatus: 'rejected', nestedCode: 'busy', modelCalls: 2, durableStarts: 2, outstanding: 1 });
  assert.ok(f.model.calls.length <= 2);
});

test('epoch-only rebinding preserves automatic dedup with a fresh exact grant', async () => {
  const f = fixture(new DeterministicModel(reply(goodText())), {});
  await launch(f).completion;
  const originalRecords = structuredClone(f.request.bundle.records);
  const originalDigest = f.state.grant.inputDigest;
  const originalModel = structuredClone(f.state.grant.model);
  const originalPrompt = f.state.grant.promptDigest;
  f.controller.setEnabled(false);
  const scope = { ...f.state.snapshot.scope, epoch: f.state.snapshot.scope.epoch + 1 };
  const bundle = { version: 1, scope: structuredClone(scope), records: structuredClone(originalRecords) };
  const inputDigest = criticBundleDigest(bundle);
  f.request = { grantId: 'fresh-epoch-only-grant', artifactId: 'artifact', bundle };
  f.state.snapshot = { ...f.state.snapshot, scope: structuredClone(scope), inputDigest };
  f.state.grant = { ...f.state.grant, id: f.request.grantId, scope: structuredClone(scope), inputDigest, revoked: false, expiresAt: f.clock.civilNowMs() + 100000 };
  assert.notEqual(inputDigest, originalDigest);
  assert.equal(f.state.grant.inputDigest, criticBundleDigest(f.request.bundle));
  assert.deepEqual(f.request.bundle.records, originalRecords);
  assert.deepEqual(f.state.grant.model, originalModel); assert.equal(f.state.grant.promptDigest, originalPrompt);
  const reloaded = new ReflectionCritic(f.ports, f.limits); reloaded.setEnabled(true);
  const result = reloaded.trigger(EVENT, f.request);
  if (result.status === 'started') await result.completion;
  assert.deepEqual({ status: result.status, code: result.status === 'rejected' ? result.code : null, modelCalls: f.model.calls.length }, { status: 'rejected', code: 'duplicate', modelCalls: 1 });
});

test('accepted journal history must agree with its fulfilled transport', async t => {
  const cases = [
    ['terminal text and advice coherently replaced', ({ terminal }) => {
      const replacement = JSON.parse(goodText()); replacement.findings[0].message = 'Different advice never returned.';
      terminal.publicText = JSON.stringify(replacement); terminal.advice.findings = structuredClone(replacement.findings);
    }],
    ['fulfilled text contradicts accepted text', ({ fulfilled }) => {
      const replacement = JSON.parse(goodText()); replacement.findings[0].message = 'Different recorded transport text.';
      fulfilled.publicText = JSON.stringify(replacement);
    }],
    ['fulfilled transport reports another model', ({ fulfilled }) => { fulfilled.reportedModel = 'another-test-model'; }],
    ['terminal drops the observed model', ({ terminal }) => { terminal.reportedModel = null; }],
    ['terminal usage contradicts transport', ({ terminal }) => { terminal.usage.inputTokens++; terminal.usage.outputTokens++; }],
    ['transport usage contradicts terminal', ({ fulfilled }) => { fulfilled.usage.inputTokens--; fulfilled.usage.outputTokens--; }],
  ];
  for (const [name, corrupt] of cases) {
    await t.test(name, async () => {
      const f = fixture(new DeterministicModel(reply(goodText())), {});
      const run = launch(f); const completed = await run.completion;
      assert.equal(completed.persistence, 'stored'); assert.equal(completed.terminal.outcome, 'accepted');
      const terminal = f.journal.records.find(envelope => envelope.record.kind === 'terminal' && envelope.record.startId === run.requestId).record;
      const fulfilled = f.journal.records.find(envelope => envelope.record.kind === 'transport' && envelope.record.startId === run.requestId && envelope.record.observation === 'client-fulfilled').record;
      assert.equal(fulfilled.publicResult, 'valid'); assert.equal(fulfilled.publicTextComplete, true);
      assert.equal(terminal.publicText, fulfilled.publicText); assert.equal(terminal.reportedModel, fulfilled.reportedModel);
      assert.deepEqual(terminal.usage, fulfilled.usage);
      corrupt({ terminal, fulfilled });
      f.controller.setEnabled(false); f.state.snapshot.scope.epoch++;
      assert.throws(() => new ReflectionCritic(f.ports, f.limits), undefined, `must reject ${name}`);
      assert.equal(f.model.calls.length, 1);
    });
  }
});

test('dispatch snapshots reject revoked or expired authority, not later revocation', async t => {
  await t.test('valid later host revocation does not rewrite dispatch history', async () => {
    const f = fixture(new DeterministicModel(reply(goodText())), {});
    const run = launch(f); assert.equal((await run.completion).terminal.outcome, 'accepted');
    const storedStart = f.journal.records.find(envelope => envelope.record.kind === 'start' && envelope.record.id === run.requestId).record;
    const originalStart = structuredClone(storedStart);
    assert.equal(storedStart.grant.revoked, false); assert.ok(storedStart.grant.expiresAt > storedStart.startedAt);
    f.state.grant.revoked = true; f.controller.setEnabled(false); f.state.snapshot.scope.epoch++;
    let reloaded;
    assert.doesNotThrow(() => { reloaded = new ReflectionCritic(f.ports, f.limits); });
    assert.deepEqual(reloaded.history().find(envelope => envelope.record.kind === 'start' && envelope.record.id === run.requestId).record, originalStart);
    assert.equal(reloaded.history().find(envelope => envelope.record.kind === 'terminal' && envelope.record.startId === run.requestId).record.outcome, 'accepted');
    reloaded.setEnabled(true); assert.equal(reloaded.consumeAtSafeBoundary(), null);
    assert.equal(reloaded.trigger(EVENT, f.request).status, 'rejected'); assert.equal(f.model.calls.length, 1);
  });
  const cases = [
    ['already revoked', start => { start.grant.revoked = true; }],
    ['expires at dispatch', start => { start.grant.expiresAt = start.startedAt; }],
    ['expired before dispatch', start => { start.grant.expiresAt = start.startedAt - 1; }],
  ];
  for (const [name, corrupt] of cases) {
    await t.test(name, async () => {
      const f = fixture(new DeterministicModel(reply(goodText())), {});
      const run = launch(f); await run.completion;
      const start = f.journal.records.find(envelope => envelope.record.kind === 'start' && envelope.record.id === run.requestId).record;
      assert.equal(start.grant.revoked, false); assert.ok(start.grant.expiresAt > start.startedAt);
      corrupt(start);
      assert.equal(f.state.grant.revoked, false); assert.ok(f.state.grant.expiresAt > start.startedAt);
      f.controller.setEnabled(false); f.state.snapshot.scope.epoch++;
      assert.throws(() => new ReflectionCritic(f.ports, f.limits), undefined, `must reject ${name}`);
      assert.equal(f.model.calls.length, 1);
    });
  }
});

test('uncertain durable start retains admission until trusted journal inspection', () => {
  const f = fixture(new DeterministicModel(reply(goodText())), {});
  const append = f.journal.tryAppend.bind(f.journal);
  f.journal.tryAppend = envelope => {
    const stored = append(envelope);
    if (stored && envelope.record.kind === 'start') throw new Error('Synthetic observer failure after durable append');
    return stored;
  };
  f.controller.setEnabled(true);
  assert.equal(f.controller.trigger(EVENT, f.request).code, 'storage-unavailable');
  assert.equal(f.model.calls.length, 0);
  assert.equal(f.journal.records.filter(entry => entry.record.kind === 'start').length, 1);
  assert.equal(f.controller.status().outstandingRequestIds.length, 1);
  f.journal.tryAppend = append;
  changeTarget(f, 'after-uncertain-start');
  assert.equal(f.controller.trigger(EVENT, f.request).code, 'busy');
  f.controller.setEnabled(false); f.state.snapshot.scope.epoch++;
  const reloaded = new ReflectionCritic(f.ports, f.limits); reloaded.setEnabled(true);
  assert.equal(reloaded.status().outstandingRequestIds.length, 1);
  assert.equal(reloaded.trigger(EVENT, f.request).code, 'busy');
  assert.equal(f.model.calls.length, 0);
});

// The actual SDK/HTTP adapter and assembled controller contract run in
// critic-sdk-client.test.mjs. Its scripted peer is transport, not semantic evidence.
