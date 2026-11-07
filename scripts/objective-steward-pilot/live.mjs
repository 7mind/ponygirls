#!/usr/bin/env node
// Tool-less, one-turn SDK bridge. No AgentSession, resources, or persisted history.
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const PINNED_SDK = '/nix/store/z0whzcf3qadlbapf48whxgdq2p5l4aaw-pi-coding-agent-1.4.0/lib/node_modules/pi-monorepo';
export const INPUT_BYTES = 128 * 1024;
export const STREAM_CHARS = 128 * 1024;
export const TEXT_BYTES = 32 * 1024;
export const DEADLINE_MS = 180_000;
const levels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export class BridgeFailure extends Error {
  constructor(category) { super(category); this.category = category; }
}
const fail = category => { throw new BridgeFailure(category); };

export function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2);
    if (!args[i]?.startsWith('--') || !['sdk', 'provider', 'model', 'thinking'].includes(key)
      || Object.hasOwn(parsed, key) || !args[i + 1] || args[i + 1].startsWith('--')) fail('arguments');
    parsed[key] = args[i + 1];
  }
  if (Object.keys(parsed).length !== 4 || !levels.has(parsed.thinking)) fail('arguments');
  return parsed;
}

export async function readRequest(stdin, signal) {
  const chunks = [];
  let size = 0;
  const abort = () => stdin.destroy(new BridgeFailure('deadline'));
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) fail('deadline');
    for await (const chunk of stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > INPUT_BYTES) fail('input-limit');
      chunks.push(bytes);
    }
    let request;
    try { request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { fail('input-json'); }
    if (!request || Array.isArray(request) || typeof request !== 'object'
      || Object.keys(request).sort().join(',') !== 'input,system'
      || typeof request.system !== 'string' || !request.input
      || typeof request.input !== 'object' || Array.isArray(request.input)) fail('input-shape');
    return request;
  } finally { signal.removeEventListener('abort', abort); }
}

// Whitelist SDK numeric telemetry, including zero. The SDK may normalize absent
// provider counters; these values do not independently establish actual usage.
function usageOf(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const out = {};
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'reasoning', 'totalTokens']) {
    if (Number.isFinite(usage[key]) && usage[key] >= 0) out[key] = usage[key];
  }
  if (Object.keys(out).length === 0) return null;
  if (usage.cost && typeof usage.cost === 'object') {
    out.cost = {};
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total']) {
      if (Number.isFinite(usage.cost[key]) && usage.cost[key] >= 0) out.cost[key] = usage.cost[key];
    }
  }
  return out;
}

// Do not retain hidden reasoning, signatures, diagnostics, or provider errors in
// Agent state. The SDK's own live stream necessarily owns its provider partials.
function cleanMessage(message, failed) {
  return {
    role: 'assistant', api: message.api, provider: message.provider, model: message.model,
    content: failed ? [] : message.content.map(block => block.type === 'text'
      ? { type: 'text', text: block.text } : { type: 'thinking', thinking: '' }),
    usage: usageOf(message.usage), stopReason: failed ? 'aborted' : message.stopReason,
    timestamp: message.timestamp,
  };
}

function guardedStream(raw, stop, failed) {
  const deltas = new Map();
  const observed = new Map();
  const inspect = event => {
    const message = event.partial ?? event.message ?? event.error;
    if (!message || !Array.isArray(message.content)) { stop('stream-protocol'); return; }
    if (event.type.endsWith('_delta')) {
      if (typeof event.delta !== 'string') { stop('stream-protocol'); return; }
      deltas.set(event.contentIndex, (deltas.get(event.contentIndex) ?? 0) + event.delta.length);
    }
    let textBytes = 0;
    message.content.forEach((block, index) => {
      // Signatures are opaque but still contribute to the bound.
      const chars = block.type === 'text' ? block.text.length + (block.textSignature?.length ?? 0)
        : block.type === 'thinking' ? block.thinking.length + (block.thinkingSignature?.length ?? 0)
          : JSON.stringify(block).length;
      observed.set(index, Math.max(observed.get(index) ?? 0, chars, deltas.get(index) ?? 0));
      if (block.type === 'text') textBytes += Buffer.byteLength(block.text);
      else if (block.type !== 'thinking') stop('tool-call');
    });
    if ([...observed.values()].reduce((sum, value) => sum + value, 0) > STREAM_CHARS) stop('stream-limit');
    if (textBytes > TEXT_BYTES) stop('output-limit');
    if (event.type.startsWith('toolcall_')) stop('tool-call');
  };
  return {
    async *[Symbol.asyncIterator]() {
      // Continue consuming after abort: prompt settles only after the provider
      // drains. The caller may hard-kill this subprocess if the SDK will not drain.
      for await (const event of raw) {
        inspect(event);
        if (event.type === 'done') yield { type: 'done', reason: event.reason, message: cleanMessage(event.message, failed()) };
        else if (event.type === 'error') yield { type: 'error', reason: event.reason, error: cleanMessage(event.error, true) };
        else if (!failed()) {
          const clean = { ...event, partial: cleanMessage(event.partial, false) };
          if (event.type.startsWith('thinking_')) {
            if ('delta' in clean) clean.delta = '';
            if ('content' in clean) clean.content = '';
          }
          yield clean;
        }
      }
    },
    async result() {
      const message = await raw.result();
      inspect({ type: 'done', message });
      return cleanMessage(message, failed());
    },
  };
}

// Injectable SDK boundary supports deterministic local scripted-stream tests;
// the CLI always supplies the pinned SDK's real Agent and ModelRegistry.
export async function runBridge(request, config, { Agent, registry }, signal) {
  let category = null;
  let agent;
  const controller = new AbortController();
  const stop = reason => {
    category ??= reason;
    controller.abort();
    agent?.abort();
  };
  const onAbort = () => stop('deadline');
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) fail('deadline');
    const model = registry.find(config.provider, config.model);
    if (!model || model.provider !== config.provider || model.id !== config.model) fail('model-unavailable');
    if (!registry.hasConfiguredAuth(model)) fail('not-authenticated');
    let requests = 0;
    agent = new Agent({
      initialState: { model, systemPrompt: request.system, tools: [], messages: [], thinkingLevel: config.thinking },
      identity: null,
      streamFn: (selected, context, options) => {
        if (++requests !== 1 || selected.provider !== config.provider || selected.id !== config.model) fail('model-change');
        const raw = registry.streamSimple(selected, context, {
          ...options, signal: AbortSignal.any([options.signal, controller.signal]),
          maxTokens: Math.min(8192, model.maxTokens), maxRetries: 0,
          ...(model.api === 'openai-codex-responses' || model.provider === 'openai-codex' ? { transport: 'sse' } : {}),
        });
        return guardedStream(raw, stop, () => category !== null);
      },
      beforeToolCall: async () => ({ block: true, terminate: true, reason: 'No tools available' }),
      finishTurn: () => ({ action: 'end' }),
    });
    await agent.prompt({ role: 'user', content: JSON.stringify(request.input), timestamp: Date.now() });
    if (category) fail(category);
    const response = agent.state.messages.findLast(message => message.role === 'assistant');
    if (!response) fail('incomplete-response');
    if (response.stopReason !== 'stop') fail(response.stopReason === 'error' ? 'provider-error' : 'incomplete-response');
    const text = response.content.filter(block => block.type === 'text').map(block => block.text).join('');
    if (Buffer.byteLength(text) > TEXT_BYTES) fail('output-limit');
    return { text, usage: usageOf(response.usage), provider: config.provider, model: config.model, thinking: config.thinking };
  } catch (error) {
    if (category) fail(category);
    if (error instanceof BridgeFailure) throw error;
    fail('runtime-error');
  } finally {
    signal.removeEventListener('abort', onAbort);
    agent?.abort();
    if (agent) { await agent.waitForIdle(); agent.reset(); }
  }
}

export async function loadPinnedSdk(sdk, signal, provider) {
  if (await realpath(sdk) !== await realpath(PINNED_SDK)) fail('sdk-pin');
  const pkg = JSON.parse(await readFile(`${sdk}/package.json`, 'utf8'));
  if (pkg.name !== '@earendil-works/pi-coding-agent' || pkg.version !== '1.4.0') fail('sdk-pin');
  const require = createRequire(`${sdk}/package.json`);
  const { Agent } = await import(pathToFileURL(`${require.resolve('@earendil-works/pi-agent-core/package.json').slice(0, -'package.json'.length)}dist/index.js`).href);
  const { AuthStorage } = await import(pathToFileURL(`${sdk}/dist/core/auth-storage.js`).href);
  const { ModelRuntime } = await import(pathToFileURL(`${sdk}/dist/core/model-runtime.js`).href);
  const { ModelRegistry } = await import(pathToFileURL(`${sdk}/dist/core/model-registry.js`).href);
  const runtime = await ModelRuntime.create({
    credentials: AuthStorage.create(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false, signal,
  });
  const registry = new ModelRegistry(runtime);
  // Restore/auth-check only the explicitly selected provider, without network
  // catalog discovery or reading user models.json configuration.
  await registry.refresh({ allowNetwork: false, providers: [provider], signal });
  return { Agent, registry };
}

async function main() {
  // Do not allow SDK console diagnostics (including provider error bodies) onto
  // either protocol channel. Only our fixed categories and result are emitted.
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  for (const key of ['log', 'info', 'debug', 'warn', 'error', 'trace', 'dir']) console[key] = () => {};
  // Also suppress SDK/library diagnostics that bypass console. Saved writers
  // above are used exclusively for the bounded result or fixed category.
  const discard = (_chunk, encoding, callback) => {
    const done = typeof encoding === 'function' ? encoding : callback;
    if (typeof done === 'function') queueMicrotask(done);
    return true;
  };
  process.stdout.write = discard;
  process.stderr.write = discard;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
  try {
    const config = parseArgs(process.argv.slice(2));
    const request = await readRequest(process.stdin, controller.signal);
    const sdk = await loadPinnedSdk(config.sdk, controller.signal, config.provider);
    const result = await runBridge(request, config, sdk, controller.signal);
    stdout(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const category = controller.signal.aborted ? 'deadline' : error instanceof BridgeFailure ? error.category : 'runtime-error';
    stderr(`${category}\n`);
    process.exitCode = 1;
  } finally { clearTimeout(timer); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
