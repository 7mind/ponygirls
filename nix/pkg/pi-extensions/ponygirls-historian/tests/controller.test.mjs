import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ModelRuntime, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { HistorianWorker } from '../src/worker.ts';
import { HistorianController } from '../src/controller.ts';
import { DEFAULT_FOCUS, ENABLED_TYPE, PreferenceStore } from '../src/preferences.ts';
import { JournalStore } from '../src/store.ts';
import { evidenceFromEntry } from '../src/evidence.ts';
import { MAX_BATCH_EVENTS, MAX_PENDING_EVENTS } from '../src/model.ts';
import tuiProvider from './fixtures/tui-provider.ts';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'historian-controller-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preferences = new PreferenceStore(join(dir, 'historian.json'));
  const model = { provider: 'fixture', id: 'scripted', thinking: 'off' };
  const defaults = { enabled: true, model, approvedModel: model, focus: DEFAULT_FOCUS };
  preferences.write(defaults);
  const entries = [];
  const ctx = { cwd: dir, sessionManager: { getSessionId: () => 'root', getEntries: () => entries },
    modelRegistry: { find: () => undefined }, ui: { notify() {} } };
  const events = { emit() {} };
  const make = () => new HistorianController({ events }, preferences, ctx, dir, () => {});
  return { make, preferences, entries, defaults, events, dir, ctx };
}

test('restart while OFF must not authorize the disabled interval when enabled later', async t => {
  const { make, preferences, entries, defaults } = fixture(t);
  const first = make(); await first.reconcile(); await first.dispose();
  preferences.write({ ...defaults, enabled: false });
  entries.push({ type: 'message', id: 'disabled', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'PRIVATE_DISABLED_INTERVAL', timestamp: 1 } });
  const second = make(); t.after(() => second.dispose()); await second.reconcile();
  preferences.write(defaults); await second.settingsChanged();
  assert.match(second.status(), /pending events: 0/);
});

test('a settled-event hint expedites an already scheduled reconciliation poll', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const { make, entries } = fixture(t); const controller = make(); t.after(() => controller.dispose());
  await controller.reconcile();
  entries.push({ type: 'message', id: 'hinted', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'NEW_SETTLED_EVENT', timestamp: 1 } });
  controller.schedule(0); t.mock.timers.tick(1);
  assert.match(controller.status(), /pending events: 1/);
});

test('wall-clock adjustments cannot bypass the monotonic retry backoff', async t => {
  const { make, entries, ctx } = fixture(t); let lookups = 0;
  ctx.modelRegistry.find = () => { lookups++; return undefined; };
  const controller = make(); t.after(() => controller.dispose()); await controller.reconcile();
  entries.push({ type: 'message', id: 'retry', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Authorized pending evidence', timestamp: 1 } });
  await controller.reconcile(); assert.equal(lookups, 1);
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000; t.mock.method(Date, 'now', () => tomorrow);
  await controller.reconcile(); assert.equal(lookups, 1, 'wall time changed but the 10-second retry interval has not elapsed');
});

function disableGlobally(preferences) {
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { PreferenceStore } from ${JSON.stringify(new URL('../src/preferences.ts', import.meta.url).href)}; new PreferenceStore(process.argv[1]).update(p => ({ ...p, enabled: false }));`, preferences.path],
    { encoding: 'utf8', timeout: 10000 });
}

for (const stage of ['capture', 'commit']) test(`global OFF cannot complete between authorization and ${stage}`, async t => {
  const { make, entries, preferences } = fixture(t); const controller = make(); t.after(() => controller.dispose());
  await controller.reconcile();
  let calls = 0;
  t.mock.method(HistorianWorker.prototype, 'run', async batch => { calls++; return {
    proposals: [{ episodeId: null, expectedRevision: 0, title: 'Authorized experiment', kind: 'experiment', status: 'ongoing',
      claims: [{ section: 'objective', basis: 'reported', text: 'Synthetic result', evidence: [batch.evidence[0].ref] }] }],
    meta: { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v1', usage: null },
  }; });
  let attempted;
  const operation = JournalStore.prototype[stage];
  t.mock.method(JournalStore.prototype, stage, function (...args) {
    if (stage === 'commit' || args[1] === true) attempted = disableGlobally(preferences);
    return operation.apply(this, args);
  });
  entries.push({ type: 'message', id: 'race', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Authorized experiment', timestamp: 1 } });
  await controller.reconcile(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(attempted.status, 1, 'OFF must report contention rather than complete ahead of an already-authorized operation');
  assert.match(controller.journal(), /Authorized experiment/); assert.match(controller.status(), /pending events: 0/);
  assert.match(attempted.stderr, /already owned/); assert.equal(preferences.read().enabled, true);
  const retry = disableGlobally(preferences); assert.equal(retry.status, 0, retry.stderr); assert.equal(preferences.read().enabled, false);
  entries.push({ type: 'message', id: 'after-off', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'PRIVATE_AFTER_OFF', timestamp: 1 } });
  await controller.reconcile(); assert.match(controller.status(), /pending events: 0/); assert.doesNotMatch(controller.journal(), /PRIVATE_AFTER_OFF/);
});

test('global OFF is available during inference and fences its late result without discarding pending evidence', async t => {
  const { make, entries, preferences } = fixture(t); const controller = make(); t.after(() => controller.dispose());
  let finish; const result = new Promise(resolve => { finish = resolve; });
  t.mock.method(HistorianWorker.prototype, 'run', () => result);
  await controller.reconcile();
  entries.push({ type: 'message', id: 'pending-global-off', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Authorized pending evidence', timestamp: 1 } });
  await controller.reconcile(); assert.match(controller.status(), /Activity: journaling/);
  const off = disableGlobally(preferences); assert.equal(off.status, 0, off.stderr);
  finish({ proposals: [], meta: { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v1', usage: null } });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(controller.status(), /OFF/); assert.match(controller.status(), /pending events: 1/);
});

test('global OFF fences publication, not a provider submission already admitted before OFF', async t => {
  const { make, entries, preferences, ctx, dir } = fixture(t);
  const runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
  const calls = [];
  runtime.registerProvider('fixture', { api: 'openai-completions', apiKey: 'synthetic-only', baseUrl: 'http://fixture.invalid',
    models: [{ id: 'scripted', name: 'Scripted', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 8192 }],
    streamSimple(model, context) {
      calls.push(context); assert.equal(preferences.read().enabled, false);
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const message = { role: 'assistant', content: [{ type: 'text', text: '[]' }], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
        stream.push({ type: 'done', reason: 'stop', message }); stream.end();
      });
      return stream;
    } });
  ctx.modelRegistry = new ModelRegistry(runtime);
  const controller = make(); t.after(() => controller.dispose()); await controller.reconcile();
  const projection = JournalStore.prototype.publishMarkdown; let disabled = false;
  t.mock.method(JournalStore.prototype, 'publishMarkdown', function () {
    if (!disabled) {
      assert.match(controller.status(), /Activity: journaling/); assert.equal(calls.length, 0);
      const off = disableGlobally(preferences); assert.equal(off.status, 0, off.stderr); disabled = true;
      entries.push({ type: 'message', id: 'after-admission-off', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'PRIVATE_AFTER_OFF', timestamp: 1 } });
    }
    return projection.call(this);
  });
  entries.push({ type: 'message', id: 'before-admission-off', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'AUTHORIZED_BEFORE_OFF', timestamp: 1 } });
  await controller.reconcile();
  const deadline = performance.now() + 5000;
  while (!controller.status().includes('Activity: idle') && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls.length, 1); assert.match(JSON.stringify(calls), /AUTHORIZED_BEFORE_OFF/); assert.doesNotMatch(JSON.stringify(calls), /PRIVATE_AFTER_OFF/);
  await controller.reconcile(); assert.match(controller.status(), /Activity: idle; pending events: 1/);
  assert.match(controller.status(), /Last commit this runtime: none/);
});

test('a new attachment does not backfill an unobserved offline interval', async t => {
  const { make, entries } = fixture(t);
  const first = make(); await first.reconcile(); await first.dispose();
  entries.push({ type: 'message', id: 'offline', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'UNOBSERVED_OFFLINE_INTERVAL', timestamp: 1 } });
  const second = make(); t.after(() => second.dispose()); await second.reconcile();
  assert.match(second.status(), /pending events: 0/);
  assert.match(second.status(), /attachment|offline/i);
});

test('a missed global OFF/ON cycle cannot authorize the disabled interval', async t => {
  const { make, preferences, defaults, entries } = fixture(t); const controller = make(); t.after(() => controller.dispose());
  await controller.reconcile();
  preferences.write({ ...defaults, enabled: false });
  entries.push({ type: 'message', id: 'missed-off', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'PRIVATE_OFF_BETWEEN_POLLS', timestamp: 1 } });
  preferences.write(defaults); await controller.reconcile();
  assert.match(controller.status(), /pending events: 0/);
});

for (const localBeforeOff of [false, true]) test(`local ON ${localBeforeOff ? 'already active ignores' : 'newly enabled fences'} a global OFF interval`, async t => {
  const { make, entries, preferences, defaults } = fixture(t);
  const local = { type: 'custom', id: 'local-enable', parentId: null, timestamp: new Date().toISOString(), customType: ENABLED_TYPE, data: { version: 1, sessionId: 'root', enabled: true } };
  if (localBeforeOff) entries.push(local);
  const controller = make(); t.after(() => controller.dispose()); await controller.reconcile();
  preferences.write({ ...defaults, enabled: false });
  entries.push({ type: 'message', id: 'off-period', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'PRIVATE_OFF_WITHOUT_OVERRIDE', timestamp: 1 } });
  if (!localBeforeOff) entries.push(local);
  await controller.settingsChanged(); assert.match(controller.status(), localBeforeOff ? /pending events: 1/ : /pending events: 0/);
});

test('rapid local OFF/ON commands cannot lose their boundary while a feed read is pending', async t => {
  const { make, entries, events } = fixture(t);
  const toggle = (id, enabled) => ({ type: 'custom', id, parentId: null, timestamp: new Date().toISOString(), customType: ENABLED_TYPE, data: { version: 1, sessionId: 'root', enabled } });
  entries.push(toggle('initial-on', true));
  let pause = false; let release;
  const barrier = new Promise(resolve => { release = resolve; });
  events.emit = (_channel, request) => request.respond({
    sources: () => [{ sourceId: 'slow', rootSessionId: 'root', sessionId: 'child', agentPath: '/root/child', copiedFrom: null, reconstructedPrefixBytes: 0 }],
    subscribe: () => () => {},
    read: async () => { if (pause) await barrier; return { entries: [], nextOffset: 100, eof: true, ready: true, gaps: [] }; },
  });
  const controller = make(); t.after(() => controller.dispose()); await controller.reconcile();
  pause = true; const collecting = controller.reconcile();
  entries.push(toggle('off', false)); const off = controller.settingsChanged();
  entries.push({ type: 'message', id: 'off-interval', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'PRIVATE_RAPID_OFF', timestamp: 1 } });
  entries.push(toggle('on', true)); const on = controller.settingsChanged();
  pause = false; release(); await Promise.all([collecting, off, on]);
  assert.match(controller.status(), /pending events: 0/);
});

for (const previousOffset of [false, true]) test(`an unavailable source retains its activation boundary until readable (previous cursor: ${previousOffset})`, async t => {
  const { make, events, preferences, defaults } = fixture(t); const controller = make(); t.after(() => controller.dispose());
  let ready = previousOffset; let count = 1;
  const entry = n => ({ type: 'message', id: `entry-${n}`, parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'PRIVATE_UNAVAILABLE_HISTORY', timestamp: 1 } });
  events.emit = (_channel, request) => request.respond({
    sources: () => [{ sourceId: 'unavailable', rootSessionId: 'root', sessionId: 'native', agentPath: '/root/child', copiedFrom: null, reconstructedPrefixBytes: 0 }],
    subscribe: () => () => {},
    read: async (_id, offset) => ({ entries: ready ? Array.from({ length: count - offset / 100 }, (_, n) => entry(n + offset / 100)) : [], nextOffset: ready ? count * 100 : offset, eof: true, ready, gaps: ready ? [] : ['Native source unavailable'] }),
  });
  await controller.reconcile();
  if (previousOffset) {
    preferences.write({ ...defaults, enabled: false }); await controller.settingsChanged();
    count++; ready = false; preferences.write(defaults); await controller.settingsChanged();
  }
  ready = true; await controller.reconcile(); assert.match(controller.status(), /pending events: 0/);
  count++; await controller.reconcile(); assert.match(controller.status(), /pending events: 1/);
});

test('a restored native source cannot reauthorize its copied preactivation prefix', async t => {
  const { make, events } = fixture(t); const controller = make(); t.after(() => controller.dispose());
  const old = { type: 'message', id: 'old', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'PRIVATE_PREACTIVATION_COPY', timestamp: 1 } };
  const sources = [{ sourceId: 'original', rootSessionId: 'root', sessionId: 'native', agentPath: '/root/child', copiedFrom: null, reconstructedPrefixBytes: 0 }];
  let appended = false;
  events.emit = (_channel, request) => request.respond({ sources: () => sources, subscribe: () => () => {},
    read: async (id, offset) => ({ entries: [...(offset === 0 ? [old] : []), ...(id === 'restored' && appended && offset < 200 ? [{ ...old, id: 'new', message: { role: 'user', content: 'AUTHORIZED_AFTER_RESTORE', timestamp: 2 } }] : [])],
      nextOffset: id === 'restored' && appended ? 200 : 100, eof: true, ready: true, gaps: [] }),
  });
  await controller.reconcile(); sources.push({ ...sources[0], sourceId: 'restored', copiedFrom: 'original', reconstructedPrefixBytes: 100 });
  await controller.reconcile(); assert.match(controller.status(), /pending events: 0/);
  appended = true; await controller.reconcile(); assert.match(controller.status(), /pending events: 1/);
});

for (const renameFailure of [false, true]) test(`a committed projection recovers after crash (with rename failure: ${renameFailure})`, async t => {
  const { make, dir, ctx } = fixture(t); let lookups = 0;
  ctx.modelRegistry.find = () => { lookups++; return undefined; };
  const controller = make(); t.after(() => controller.dispose());
  const store = new JournalStore(join(controller.directory, 'journal.sqlite'), dir);
  const e = evidenceFromEntry('root', 'root', { type: 'message', id: 'e', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Recover projection', timestamp: 1 } });
  store.capture('root', true, [], [e], []);
  store.commit(store.batch('root'), [{ episodeId: null, expectedRevision: 0, title: 'RECOVERED_EPISODE', kind: 'experiment', status: 'ongoing', claims: [{ section: 'objective', basis: 'reported', text: 'Recover projection', evidence: [e.ref] }] }],
    { provider: 'fixture', model: 'scripted', thinking: 'off', objective: 'v1', usage: null });
  store.close(); const journal = join(controller.directory, 'journal.md'); assert.equal(existsSync(journal), false);
  if (renameFailure) {
    mkdirSync(journal); await controller.reconcile();
    assert.doesNotMatch(controller.status(), /Markdown projection error: none/);
    assert.deepEqual(readdirSync(controller.directory).filter(name => name.endsWith('.tmp')), [], 'failed publication must clean up only its owned temporary file');
    rmdirSync(journal);
  }
  await controller.reconcile();
  assert.match(readFileSync(journal, 'utf8'), /RECOVERED_EPISODE/);
  assert.match(controller.status(), /Markdown projection error: none/); assert.equal(lookups, 0);
});

test('a full backlog drains pending work without advancing the uncaptured main cursor', async t => {
  const { make, dir, entries, ctx } = fixture(t); let lookups = 0;
  ctx.modelRegistry.find = () => { lookups++; return undefined; };
  const controller = make(); t.after(() => controller.dispose()); await controller.reconcile();
  const store = new JournalStore(join(controller.directory, 'journal.sqlite'), dir); t.after(() => store.close());
  const retained = Array.from({ length: MAX_PENDING_EVENTS }, (_, n) => evidenceFromEntry('root', 'root', { type: 'message', id: `queued-${n}`, parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Pending', timestamp: 1 } }));
  store.capture('root', true, store.state('root').cursors, retained, []);
  entries.push({ type: 'message', id: 'overflow', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Waiting for capacity', timestamp: 1 } });
  await controller.reconcile();
  assert.equal(lookups, 1, 'pending worker must be attempted even while capture waits for capacity');
  assert.equal(store.state('root').cursors.find(c => c.sourceId === 'main').offset, 0);
});

test('real scripted provider drains the full 10000-event capacity and captures overflow exactly once', async t => {
  const { make, dir, entries, ctx, preferences, defaults } = fixture(t);
  const runtime = await ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
  const seen = new Set(); let calls = 0;
  tuiProvider({ registerProvider(provider, definition) {
    runtime.registerProvider(provider, { ...definition, streamSimple(model, context, options) {
      const payload = JSON.parse(context.messages.find(message => message.role === 'user').content);
      assert.ok(payload.evidence.length > 0 && payload.evidence.length <= MAX_BATCH_EVENTS);
      for (const evidence of payload.evidence) { assert.equal(seen.has(evidence.ref), false); seen.add(evidence.ref); }
      calls++; return definition.streamSimple(model, context, options);
    } });
  } });
  const model = { provider: 'historian-fixture', id: 'journal', thinking: 'off' };
  preferences.write({ ...defaults, model, approvedModel: model }); ctx.modelRegistry = new ModelRegistry(runtime);
  const controller = make(); t.after(() => controller.dispose()); await controller.reconcile();
  const store = new JournalStore(join(controller.directory, 'journal.sqlite'), dir); t.after(() => store.close());
  const retained = Array.from({ length: MAX_PENDING_EVENTS }, (_, n) => evidenceFromEntry('root', 'root', { type: 'message', id: `stress-${n}`, parentId: null,
    timestamp: new Date().toISOString(), message: { role: 'user', content: 'Synthetic mechanical evidence', timestamp: 1 } }));
  store.capture('root', true, store.state('root').cursors, retained, []);
  entries.push({ type: 'message', id: 'stress-overflow', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Synthetic overflow', timestamp: 1 } });
  const deadline = performance.now() + 120000;
  while ((seen.size < MAX_PENDING_EVENTS + 1 || store.pending('root') > 0) && performance.now() < deadline) {
    await controller.reconcile(); await new Promise(resolve => setImmediate(resolve));
    assert.match(controller.status(), /Error: none/);
  }
  assert.equal(seen.size, MAX_PENDING_EVENTS + 1); assert.equal(store.pending('root'), 0);
  assert.equal(store.state('root').cursors.find(cursor => cursor.sourceId === 'main').offset, 1);
  assert.equal(calls, Math.ceil((MAX_PENDING_EVENTS + 1) / MAX_BATCH_EVENTS));
});

test('late history service attachment establishes a boundary instead of backfilling', async t => {
  const { make, events } = fixture(t); const controller = make(); t.after(() => controller.dispose());
  await controller.reconcile();
  events.emit = (_channel, request) => request.respond({
    sources: () => [{ sourceId: 'old', rootSessionId: 'root', sessionId: 'child', agentPath: '/root/child', copiedFrom: null, reconstructedPrefixBytes: 0 }],
    subscribe: () => () => {},
    read: async (_id, offset) => ({ entries: offset === 0 ? [{ type: 'message', id: 'old', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content: 'PRE_ACTIVATION', timestamp: 1 } }] : [], nextOffset: 100, eof: true, ready: true, gaps: [] }),
  });
  await controller.reconcile();
  assert.match(controller.status(), /pending events: 0/);
});
