// Specified-origin BG tests: real pinned Agent + hand-scripted SDK registry.
// No authentication, provider transport, live model, or quality/oracle claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import {
  PINNED_SDK, INPUT_BYTES, STREAM_CHARS, TEXT_BYTES, parseArgs, readRequest, runBridge,
} from './live.mjs';
const require = createRequire(`${PINNED_SDK}/package.json`);
const { Agent } = await import(pathToFileURL(`${require.resolve('@earendil-works/pi-agent-core/package.json').slice(0, -'package.json'.length)}dist/index.js`).href);
const model = { provider: 'openai-codex', id: 'synthetic', api: 'openai-codex-responses', maxTokens: 16384 };
const config = { sdk: PINNED_SDK, provider: model.provider, model: model.id, thinking: 'high' };
const request = { system: 'Only synthetic instructions.', input: { synthetic: 'Only supplied evidence.' } };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function message(content, extra = {}) {
  return { role: 'assistant', api: model.api, provider: model.provider, model: model.id,
    content, usage, stopReason: 'stop', timestamp: 0, ...extra };
}
function scripted(events, final, observe = () => {}) {
  let calls = 0;
  let drained = false;
  const registry = {
    find: (provider, id) => provider === model.provider && id === model.id ? model : undefined,
    hasConfiguredAuth: () => true,
    streamSimple(selected, context, options) {
      calls++;
      observe(selected, context, options);
      return { async *[Symbol.asyncIterator]() {
        try { yield* events; } finally { drained = true; }
      }, result: async () => final };
    },
  };
  return { Agent, registry, get calls() { return calls; }, get drained() { return drained; } };
}
function reply(final, observe) { return scripted([{ type: 'start', partial: final }, { type: 'done', reason: 'stop', message: final }], final, observe); }
const run = (sdk, selected = config, signal = new AbortController().signal) => runBridge(request, selected, sdk, signal);
const rejects = (promise, category) => assert.rejects(promise, error => error.category === category);

test('BG: supplied synthetic context only, SSE, exact selection, one turn, unchanged text', async () => {
  const text = 'not repaired JSON: ```{broken';
  const sdk = reply(message([{ type: 'text', text }]), (selected, context, options) => {
    assert.equal(selected, model);
    assert.deepEqual(context.messages.map(m => [m.role, m.content]), [
      ['system', request.system], ['user', JSON.stringify(request.input)],
    ]);
    assert.equal(context.messages[0].toolsAdded?.length ?? 0, 0);
    assert.equal(options.transport, 'sse');
    assert.equal(options.maxTokens, 8192);
    assert.equal(options.maxRetries, 0);
    assert.equal(options.reasoning, 'high');
  });
  assert.deepEqual(await run(sdk), { text, usage, provider: model.provider, model: model.id, thinking: 'high' });
  assert.equal(sdk.calls, 1);
  assert.equal(sdk.drained, true);
});

test('BG: absent/unusable usage remains null', async () => {
  for (const absent of [undefined, null, {}, { input: NaN, output: -1 }]) {
    assert.equal((await run(reply(message([{ type: 'text', text: 'ok' }], { usage: absent })))).usage, null);
  }
});

test('BG: structurally present zero SDK telemetry is preserved, not inferred missing', async () => {
  assert.deepEqual((await run(reply(message([{ type: 'text', text: 'ok' }])))).usage, usage);
});

test('BG: hidden reasoning and opaque signatures never enter Agent state', async () => {
  let recorded;
  class ObservedAgent extends Agent {
    reset() { recorded = JSON.stringify(this.state.messages); super.reset(); }
  }
  const final = message([{ type: 'thinking', thinking: 'HIDDEN_REASONING', thinkingSignature: 'SECRET_SIGNATURE' },
    { type: 'text', text: 'visible', textSignature: 'OPAQUE_SIGNATURE' }]);
  const sdk = reply(final);
  sdk.Agent = ObservedAgent;
  assert.equal((await run(sdk)).text, 'visible');
  assert.ok(!/HIDDEN_REASONING|SECRET_SIGNATURE|OPAQUE_SIGNATURE/.test(recorded));
});

test('BG: streaming thinking is counted even if final response drops it; abort drains', async () => {
  const final = message([{ type: 'text', text: 'short' }]);
  let signal;
  const sdk = scripted([
    { type: 'start', partial: message([]) },
    { type: 'thinking_delta', contentIndex: 0, delta: 'x'.repeat(STREAM_CHARS + 1), partial: message([{ type: 'thinking', thinking: '' }]) },
    { type: 'done', reason: 'stop', message: final },
  ], final, (_m, _c, options) => { signal = options.signal; });
  await rejects(run(sdk), 'stream-limit');
  assert.equal(signal.aborted, true);
  assert.equal(sdk.drained, true);
});

test('BG: aggregate text/thinking/signature snapshot cap', async () => {
  const final = message([{ type: 'thinking', thinking: 'x'.repeat(STREAM_CHARS - 4) }, { type: 'text', text: '12345' }]);
  await rejects(run(reply(final)), 'stream-limit');
  await rejects(run(reply(message([{ type: 'thinking', thinking: '', thinkingSignature: 'x'.repeat(STREAM_CHARS + 1) }]))), 'stream-limit');
});

test('BG: visible output byte bound (including Unicode), with exact boundary accepted', async () => {
  assert.equal((await run(reply(message([{ type: 'text', text: 'x'.repeat(TEXT_BYTES) }])))).text.length, TEXT_BYTES);
  await rejects(run(reply(message([{ type: 'text', text: 'x'.repeat(TEXT_BYTES + 1) }]))), 'output-limit');
  await rejects(run(reply(message([{ type: 'text', text: '😀'.repeat(TEXT_BYTES / 4 + 1) }]))), 'output-limit');
});

test('BG: tool output never executes or causes another request', async () => {
  const sdk = reply(message([{ type: 'toolCall', id: 'evil', name: 'bash', arguments: { command: 'do not execute' } }], { stopReason: 'toolUse' }));
  await rejects(run(sdk), 'tool-call');
  assert.equal(sdk.calls, 1);
  assert.equal(sdk.drained, true);
});

test('BG: no model fallback or unauthenticated request', async () => {
  const sdk = reply(message([]));
  await rejects(run(sdk, { ...config, model: 'missing' }), 'model-unavailable');
  sdk.registry.hasConfiguredAuth = () => false;
  await rejects(run(sdk), 'not-authenticated');
  assert.equal(sdk.calls, 0);
});

test('BG: incomplete provider stop rejected without repair', async () => {
  await rejects(run(reply(message([{ type: 'text', text: 'partial' }], { stopReason: 'length' }))), 'incomplete-response');
});

test('BG: provider error is a safe category, never error body', async () => {
  const error = message([], { stopReason: 'error', errorMessage: 'PRIVATE_PROVIDER_BODY' });
  await rejects(run(scripted([{ type: 'error', reason: 'error', error }], error)), 'provider-error');
});

test('BG: external deadline aborts and drains cooperative SDK stream', async () => {
  const controller = new AbortController();
  let observed;
  const sdk = reply(message([]));
  sdk.registry.streamSimple = (_model, _context, options) => {
    observed = options.signal;
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'start', partial: message([]) };
        controller.abort();
        yield { type: 'error', reason: 'aborted', error: message([], { stopReason: 'aborted' }) };
      },
      result: async () => message([], { stopReason: 'aborted' }),
    };
  };
  await rejects(run(sdk, config, controller.signal), 'deadline');
  assert.equal(observed.aborted, true);
});

test('BA: strict required args, duplicate/unknown flags and thinking rejected', () => {
  assert.deepEqual(parseArgs(['--sdk', PINNED_SDK, '--provider', model.provider, '--model', model.id, '--thinking', 'high']), config);
  for (const args of [[], ['--sdk', PINNED_SDK], ['--foo', 'x'], ['--sdk', 'x', '--sdk', 'y'],
    ['--sdk', PINNED_SDK, '--provider', model.provider, '--model', model.id, '--thinking', 'bogus']]) {
    assert.throws(() => parseArgs(args), error => error.category === 'arguments');
  }
});

test('BA: stdin exact shape, UTF-8, JSON, and input-byte cap', async () => {
  const parse = input => readRequest(Readable.from([input]), new AbortController().signal);
  assert.deepEqual(await parse(Buffer.from(JSON.stringify(request))), request);
  const overhead = Buffer.byteLength(JSON.stringify({ system: '', input: {} }));
  const boundary = JSON.stringify({ system: 'x'.repeat(INPUT_BYTES - overhead), input: {} });
  assert.equal(Buffer.byteLength(boundary), INPUT_BYTES);
  await parse(Buffer.from(boundary));
  await rejects(parse(Buffer.from(boundary + ' ')), 'input-limit');
  for (const input of ['{}', '{"system":"x","input":[]}', '{"system":"x","input":{},"extra":1}']) await rejects(parse(Buffer.from(input)), 'input-shape');
  for (const input of [Buffer.from('{'), Buffer.from([0xff])]) await rejects(parse(input), 'input-json');
});

test('local subprocess: invalid stdin prints category only, no SDK/auth/provider call', () => {
  const result = spawnSync(process.execPath, [new URL('./live.mjs', import.meta.url).pathname,
    '--sdk', PINNED_SDK, '--provider', model.provider, '--model', model.id, '--thinking', 'high'],
  { input: '{PRIVATE_ERROR_BODY', encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'input-json\n');
});

test('BG: pinned SDK ModelRuntime/ModelRegistry/AuthStorage composition, no credentials or network', async () => {
  const { AuthStorage } = await import(pathToFileURL(`${PINNED_SDK}/dist/core/auth-storage.js`).href);
  const { ModelRuntime } = await import(pathToFileURL(`${PINNED_SDK}/dist/core/model-runtime.js`).href);
  const { ModelRegistry } = await import(pathToFileURL(`${PINNED_SDK}/dist/core/model-registry.js`).href);
  const runtime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null,
    allowModelNetwork: false, refreshOnCreate: false });
  const registry = new ModelRegistry(runtime);
  assert.ok(registry.getAll().length > 0);
  assert.equal(registry.find('synthetic-missing-provider', 'synthetic'), undefined);
});

test.skip('EvilCommunication provider contract leg: prohibited until source/oracle freeze; no live calls made', () => {});
