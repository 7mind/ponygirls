import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelRuntime, ModelRegistry, SessionManager } from '@earendil-works/pi-coding-agent';
import { CuckooCritic, CRITIC_ADVICE_TYPE } from '../src/critic-runtime.ts';
import { CriticNativeJournal } from '../src/critic-native-journal.ts';
import { REFLECTION_NAMESPACE, reflectionTextDigest } from '../src/experiments/reflection-critic.ts';
import { STATE_TYPE, INQUIRY_TYPE } from '../src/state.ts';
import { taskNetworkFixture, nativeTestClock, boundary } from './fixtures/task-network.mjs';

const PROVIDER = 'owned-critic-runtime'; const MODEL = 'owned-critic-model';
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function frame(delta, finish) {
  return `data: ${JSON.stringify({ id: 'owned-completion', object: 'chat.completion.chunk', created: 1, model: MODEL, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}
function wire(body) {
  const bundle = JSON.parse(body.messages[1].content);
  const text = JSON.stringify({ version: 1, findings: [{ severity: 'info', message: 'Synthetic advisory observation.', refs: [bundle.records[0].id] }] });
  return frame({ role: 'assistant' }, null) + frame({ content: text }, null) + frame({}, 'stop') +
    `data: ${JSON.stringify({ id: 'owned-completion', model: MODEL, choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\ndata: [DONE]\n\n`;
}

async function fixture(t) {
  const auth = mkdtempSync(join(tmpdir(), 'cuckoo-critic-auth-')); const sockets = new Set(); const posts = []; const errors = []; const entered = deferred();
  let plan = null; let runtime;
  const server = createServer((request, response) => {
    void (async () => {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); posts.push(body); entered.resolve(body);
      assert.equal(request.url, '/v1/chat/completions');
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (plan === null) response.end(wire(body)); else await plan(response, body);
    })().catch(error => { if (error.code !== 'ECONNRESET') errors.push(error); response.destroy(); });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  t.after(async () => { server.closeAllConnections(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); if (runtime !== undefined) await runtime.settleCredentialWrites(); rmSync(auth, { recursive: true, force: true }); assert.deepEqual(errors, []); });
  runtime = await ModelRuntime.create({ authPath: join(auth, 'auth.json'), modelsPath: null, modelsStorePath: join(auth, 'models-store.json'), refreshOnCreate: false, allowModelNetwork: false });
  function configure(name) {
    runtime.registerProvider(PROVIDER, { name: 'Owned test provider', api: 'openai-completions', apiKey: 'synthetic-test-only', baseUrl,
      models: [{ id: MODEL, name, reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 512, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsDeveloperRole: false, supportsUsageInStreaming: true, supportsFinishReason: true, maxTokensField: 'max_tokens' } }] });
  }
  configure('Owned test model');
  const model = runtime.getPhysicalModel(PROVIDER, MODEL); assert.ok(model);
  let sequence = 0;
  const services = { encoderProfiles: { path: '/unused/encoders', read: () => [] }, embeddingTransportPolicy: 'owned-loopback-http', credential() { assert.fail('Critic must use native registry auth, not encoder env'); },
    fetch(input, init) { const request = new Request(input, init); assert.equal(request.url, `${baseUrl}/chat/completions`); return globalThis.fetch(request); },
    clock: nativeTestClock(), ids: { nextId: () => `critic-host-${++sequence}` } };
  const f = taskNetworkFixture(t, services, new ModelRegistry(runtime), [{ model, thinkingLevel: 'off' }]);
  const critic = new CuckooCritic(f.pi, f.features, f.consents, services);
  const task = f.task('Synthetic critic task'), artifact = f.snapshot(task.id, 'Synthetic artifact for review', 'artifact');
  f.snapshot(task.id, 'Synthetic supporting evidence', 'evidence');
  const waiters = new Set();
  f.onAppend((type, data) => {
    if (type !== REFLECTION_NAMESPACE) return;
    for (const waiter of [...waiters]) if (waiter.predicate(data.record)) { waiters.delete(waiter); waiter.resolve(data.record); }
  });
  function records(kind) { return f.manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === REFLECTION_NAMESPACE).map(entry => entry.data.record).filter(record => record.kind === kind); }
  function waitRecord(kind, predicate) {
    const previous = records(kind).find(predicate); if (previous !== undefined) return Promise.resolve(previous);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(waiter); reject(new Error(`Timed out waiting for ${kind}`)); }, 5000);
      const waiter = { predicate: record => record.kind === kind && predicate(record), resolve: record => { clearTimeout(timer); resolve(record); } };
      waiters.add(waiter); t.after(() => clearTimeout(timer));
    });
  }
  async function status() {
    await critic.command('status', f.ctx);
    return JSON.parse(f.dialogs.at(-1).body);
  }
  return { ...f, critic, task, artifact, services, runtime, posts, entered, records, waitRecord, status,
    approve: () => critic.command('approve', f.ctx), configure,
    hold: value => { plan = value; }, start: () => critic.ordinaryRunStart(f.ctx), step: value => critic.ordinaryBoundary(value, f.ctx) };
}

// Real SDK SSE transport and owned HTTP/native journal; no live quality claim.
test('approved ongoing work starts once, journals exact advice, and proposes it only at an existing continuation', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.approve(); f.start();
  const first = boundary(true); assert.deepEqual(f.step(first), []); assert.equal(first.continue, true);
  const terminal = await f.waitRecord('terminal', record => record.outcome === 'accepted');
  assert.equal(terminal.advice.authority, 'none'); assert.equal(f.posts.length, 1);
  const sent = JSON.parse(f.posts[0].messages[1].content);
  assert.deepEqual(sent.records.map(record => record.kind), ['artifact', 'evidence']);
  assert.ok(!JSON.stringify(sent).includes('Synthetic critic task'));
  assert.deepEqual(f.posts[0].tools, []);
  const next = boundary(true); const drafts = f.step(next);
  assert.equal(next.continue, true); assert.equal(drafts.filter(draft => draft.type === 'custom_message' && draft.customType === CRITIC_ADVICE_TYPE).length, 1);
  assert.match(drafts[0].data.meaning, /not proof/);
  assert.deepEqual(f.step(boundary(true)), []); assert.equal(f.posts.length, 1, 'no automatic duplicate');
  f.step(boundary(false)); const status = await f.status(); assert.equal(status.ordinaryRunWorking, false);
  assert.equal(status.recentReviews.length, 1); assert.equal(status.recentReviews[0].advice.authority, 'none');
  assert.match(status.adviceNotice, /Not verification/); assert.equal(f.posts.length, 1);
});

test('an otherwise final ordinary turn does not launch because a checkpoint will continue later', async t => {
  const f = await fixture(t); await f.approve(); f.start();
  const event = boundary(false); event.context.canContinue = false;
  assert.deepEqual(f.step(event), []);
  event.entries.push({ type: 'custom_message', customType: INQUIRY_TYPE, content: 'Checkpoint only', display: true }); event.continue = true;
  assert.equal(f.posts.length, 0); assert.equal((await f.status()).ordinaryRunWorking, false);
});

test('transient inquiry defers advice while admitted review can finish', { timeout: 15000 }, async t => {
  const f = await fixture(t); const release = deferred();
  f.hold(async (reply, body) => { await release.promise; if (!reply.destroyed) reply.end(wire(body)); });
  await f.approve(); f.start(); f.step(boundary(true)); await f.entered.promise;
  f.manager.appendCustomEntry(STATE_TYPE, { version: 1, baseline: 100, observed: 100, model: 'fixture', pending: { requestId: 'checkpoint', resume: true }, resuming: false });
  assert.deepEqual(f.step(boundary(false)), []);
  release.resolve(); await f.waitRecord('terminal', record => record.outcome === 'accepted');
  assert.deepEqual(f.step(boundary(true)), []);
  f.manager.appendCustomEntry(STATE_TYPE, { version: 1, baseline: 100, observed: 100, model: 'fixture', pending: null, resuming: false });
  assert.ok(f.step(boundary(true)).some(draft => draft.customType === CRITIC_ADVICE_TYPE));
  assert.equal(f.posts.length, 1);
});

test('ordinary final completion cancels applicability and never appends a later proposal', { timeout: 15000 }, async t => {
  const f = await fixture(t); const release = deferred();
  f.hold(async (reply, body) => { await release.promise; if (!reply.destroyed) reply.end(wire(body)); });
  await f.approve(); f.start(); f.step(boundary(true)); await f.entered.promise;
  assert.deepEqual(f.step(boundary(false)), []); release.resolve();
  await f.waitRecord('terminal', () => true);
  assert.equal((await f.status()).ordinaryRunWorking, false);
  assert.deepEqual(f.step(boundary(true)), []);
  assert.equal(f.posts.length, 1);
});

test('observed model configuration drift revokes consent rather than reviving it after restoration', async t => {
  const f = await fixture(t); await f.approve(); f.start();
  f.configure('Changed catalog configuration'); f.step(boundary(true));
  assert.equal(f.consents.current(f.ctx, 'critic'), null);
  f.configure('Owned test model'); f.step(boundary(true)); assert.equal(f.posts.length, 0);
});

test('aborting a pending inquiry ends ordinary-run applicability', async t => {
  const f = await fixture(t); await f.approve(); f.start();
  f.manager.appendCustomEntry(STATE_TYPE, { version: 1, baseline: 100, observed: 100, model: 'fixture', pending: { requestId: 'checkpoint', resume: true }, resuming: false });
  const event = boundary(false); event.outcome = 'aborted'; event.message.stopReason = 'aborted';
  assert.deepEqual(f.step(event), []);
  assert.equal((await f.status()).ordinaryRunWorking, false);
});

test('disabled critic does not inspect malformed inactive history during ordinary work', async t => {
  const f = await fixture(t); f.setFeature('critic', false);
  f.manager.appendCustomEntry(REFLECTION_NAMESPACE, { malformed: 'inactive history' });
  assert.doesNotThrow(() => f.start());
  assert.doesNotThrow(() => f.step(boundary(true)));
  assert.doesNotThrow(() => f.step(boundary(false)));
  assert.equal(f.posts.length, 0);
});

test('enabling and approving during an existing ordinary run does not need a new prompt', { timeout: 15000 }, async t => {
  const f = await fixture(t); f.setFeature('critic', false); f.start();
  f.setFeature('critic', true); await f.approve(); f.step(boundary(true));
  await f.waitRecord('terminal', record => record.outcome === 'accepted'); assert.equal(f.posts.length, 1);
});

test('revoke interrupts an outstanding reconciliation dialog without releasing admission', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.approve(); f.start(); f.step(boundary(true));
  await f.waitRecord('terminal', record => record.outcome === 'accepted');
  const start = f.records('start')[0];
  const recovered = taskNetworkFixture(t, f.services, f.ctx.modelRegistry, f.ctx.scopedModels);
  recovered.manager.appendMessage({ role: 'user', content: 'Synthetic recovery', timestamp: 1 });
  recovered.manager.appendCustomEntry(REFLECTION_NAMESPACE, { namespace: REFLECTION_NAMESPACE, version: 1, record: structuredClone(start) });
  const critic = new CuckooCritic(recovered.pi, recovered.features, recovered.consents, f.services);
  let panel; const entered = deferred();
  recovered.ctx.ui.custom = (factory, options) => new Promise(resolve => {
    assert.equal(options.blocked.kind, 'permission');
    panel = factory({ terminal: { rows: 24 }, requestRender() {} }, { fg: (_c, text) => text, bg: (_c, text) => text, bold: text => text }, { matches: (data, name) => name === 'tui.select.cancel' ? data === '\x1b' : data === '\r' }, resolve);
    panel.render(80); entered.resolve();
  });
  let settled = false;
  const pending = critic.command('reconcile', recovered.ctx).then(() => { settled = true; }, () => { settled = true; });
  await entered.promise; await critic.command('revoke', recovered.ctx); await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(settled, true, 'revocation must close its pending operator dialog'); }
  finally { panel.handleInput('\x1b'); await pending; }
  assert.equal(recovered.manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === REFLECTION_NAMESPACE && entry.data.record.kind === 'transport' && entry.data.record.observation === 'trusted-reconciled').length, 0);
});

test('critic revoke removes parent consent before transport abort observers run', { timeout: 15000 }, async t => {
  const f = await fixture(t); const release = deferred(); let observed; let reserved = false;
  const originalFetch = f.services.fetch;
  f.services.fetch = (input, init) => {
    const request = new Request(input, init);
    request.signal.addEventListener('abort', () => {
      observed = f.consents.current(f.ctx, 'critic');
      if (observed !== null) { try { f.consents.reserve(f.ctx, 'critic', observed.binding); reserved = true; } catch {} }
    }, { once: true });
    return originalFetch(request);
  };
  f.hold(async (reply, body) => { await release.promise; if (!reply.destroyed) reply.end(wire(body)); });
  await f.approve(); f.start(); f.step(boundary(true)); await f.entered.promise;
  await f.critic.command('revoke', f.ctx); release.resolve();
  assert.equal(observed, null); assert.equal(reserved, false);
  await f.waitRecord('terminal', () => true);
});

test('OFF cancels applicability while genuine same-owner transport settlement remains journaled', { timeout: 15000 }, async t => {
  const f = await fixture(t); const release = deferred();
  f.hold(async (reply, body) => { await release.promise; if (!reply.destroyed) reply.end(wire(body)); });
  await f.approve(); f.start(); f.step(boundary(true)); await f.entered.promise;
  f.setFeature('critic', false); release.resolve();
  await f.waitRecord('transport', record => record.observation === 'client-rejected');
  const status = await f.status(); assert.deepEqual(status.controller.outstandingRequestIds, []);
  assert.equal(f.consents.remaining(f.ctx, 'vectors'), 0);
  f.setFeature('critic', true); assert.equal(f.consents.current(f.ctx, 'critic'), null);
  assert.deepEqual(f.step(boundary(true)), []); assert.equal(f.posts.length, 1);
});

test('owner replacement preserves uncertain admission and refuses release while a client is still owned', { timeout: 15000 }, async t => {
  const f = await fixture(t); const entered = deferred(), release = deferred(); let handoffs = 0;
  f.services.fetch = async (input, init) => {
    handoffs++; const body = JSON.parse(await new Request(input, init).text()); entered.resolve();
    await release.promise;
    return new Response(wire(body), { headers: { 'content-type': 'text/event-stream' } });
  };
  await f.approve(); f.start(); f.step(boundary(true)); await entered.promise;
  f.features.navigate(f.ctx); f.start();
  await assert.rejects(f.critic.command('reconcile', f.ctx), /still owns the client transport/);
  release.resolve();
  const deadline = Date.now() + 5000; let state;
  do { state = await f.status(); if (state.knownOwnedClientIds.length === 0) break; await new Promise(resolve => setImmediate(resolve)); } while (Date.now() < deadline);
  assert.deepEqual(state.knownOwnedClientIds, []); assert.equal(state.controller.outstandingRequestIds.length, 1);
  await f.critic.command('reconcile', f.ctx);
  state = await f.status(); assert.deepEqual(state.controller.outstandingRequestIds, []);
  assert.equal(f.records('transport').filter(record => record.observation === 'trusted-reconciled').length, 1);
  assert.equal(handoffs, 1); assert.equal(f.posts.length, 0);
  assert.deepEqual(f.step(boundary(true)), []);
});

test('native journal writes actual JSONL even before an assistant and rejects in-memory-only sessions', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cuckoo-journal-preflush-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const manager = SessionManager.create(dir, dir); manager.appendMessage({ role: 'user', content: 'User only', timestamp: 1 });
  const file = manager.getSessionFile(); assert.equal(typeof file, 'string'); assert.equal(existsSync(file), true);
  const journal = new CriticNativeJournal({ appendEntry: (type, data) => manager.appendCustomEntry(type, data) }, () => ({ sessionManager: manager }), () => {}, () => 'audit-1');
  const digest = reflectionTextDigest('synthetic');
  const event = { version: 1, stage: 'start', requestId: 'r', civilTime: 1, elapsedMs: 0, configurationDigest: digest, inputDigest: digest, requestedModel: MODEL, reportedModel: null, usage: { inputTokens: null, outputTokens: null }, publicChars: 0, transportBytes: 0, fetchHandoffs: 0, outcome: null, providerWork: 'unknown' };
  journal.audit(event);
  assert.match(readFileSync(file, 'utf8'), /cuckoo\.critic\.sdk-audit/);
  const reopened = SessionManager.open(file); assert.equal(reopened.getEntries().at(-1).data.id, 'audit-1');
  const memory = SessionManager.inMemory();
  const transient = new CriticNativeJournal({ appendEntry: (type, data) => memory.appendCustomEntry(type, data) }, () => ({ sessionManager: memory }), () => {}, () => 'audit-2');
  assert.throws(() => transient.audit(event), /persisted/);
});
