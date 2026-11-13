import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import * as sdk from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { Key, matchesKey } from '@earendil-works/pi-tui';
import { NativeMemoryPort, nativeMemoryRuntime } from '../src/memory-runtime.ts';
import { appendMemory, makeTask, makeSnapshot } from '../src/memory-core.ts';
import { REFLECTION_NAMESPACE } from '../src/experiments/reflection-critic.ts';
import { CRITIC_ADVICE_TYPE } from '../src/critic-runtime.ts';

const usage = { input: 20000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 20000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: text => text };
const keys = { matches: (data, name) => matchesKey(data, name === 'tui.select.cancel' ? Key.escape : Key.enter) };
function criticWire(body) {
  const bundle = JSON.parse(body.messages[1].content);
  const text = JSON.stringify({ version: 1, findings: [{ severity: 'info', message: 'Owned runtime advice', refs: [bundle.records[0].id] }] });
  const chunk = (delta, finish_reason) => `data: ${JSON.stringify({ id: 'owned', model: 'owned-critic', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  return chunk({ role: 'assistant' }, null) + chunk({ content: text }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n';
}

// Actual Pi entry-point composition with explicit owned-loopback test services.
// Synthetic primary provider and UI are workflow controls, not model-quality or
// real-human-consent evidence. Auxiliary API and native session are real.
test('real Pi composition runs consented vectors and critic without ambient disclosure or extra turns', { timeout: 20000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cuckoo-network-host-'));
  const old = new Map(['PI_CODING_AGENT_DIR', 'PI_CUCKOO_OWNED_NETWORK_TEST', 'PI_CUCKOO_TEST_ENCODER_URL'].map(key => [key, process.env[key]]));
  const posts = []; const serverErrors = []; const sockets = new Set(); let session; let runtime;
  const server = createServer((request, reply) => {
    void (async () => {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); posts.push({ path: request.url, body });
      if (request.url === '/embeddings') {
        reply.writeHead(200, { 'content-type': 'application/json' });
        reply.end(JSON.stringify({ model: 'owned-http-embeddings', data: [{ index: 0, embedding: body.input.includes('needle') ? [1, 0] : [0, 1] }] }));
      } else {
        assert.equal(request.url, '/v1/chat/completions');
        reply.writeHead(200, { 'content-type': 'text/event-stream' }); reply.end(criticWire(body));
      }
    })().catch(error => { serverErrors.push(error); reply.destroy(); });
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    if (session !== undefined) { await session.abort(); session.dispose(); }
    server.closeAllConnections(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
    if (runtime !== undefined) await runtime.settleCredentialWrites();
    for (const [key, value] of old) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(dir, { recursive: true, force: true }); assert.deepEqual(serverErrors, []);
  });
  process.env.PI_CODING_AGENT_DIR = dir; process.env.PI_CUCKOO_OWNED_NETWORK_TEST = 'synthetic-owned-test'; process.env.PI_CUCKOO_TEST_ENCODER_URL = `${base}/embeddings`;
  runtime = await sdk.ModelRuntime.create({ authPath: join(dir, 'auth.json'), modelsPath: null, modelsStorePath: join(dir, 'models-store.json'), allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerProvider('owned-auxiliary', { api: 'openai-completions', baseUrl: `${base}/v1`, apiKey: 'synthetic-auxiliary-only',
    models: [{ id: 'owned-critic', name: 'Owned critic', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 512, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, compat: { supportsDeveloperRole: false, supportsUsageInStreaming: true, supportsFinishReason: true, maxTokensField: 'max_tokens' } }] });
  const manager = sdk.SessionManager.create(dir, dir); const script = []; const contexts = []; const errors = []; const notices = [];
  async function waitForCritic() {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const terminals = manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType === REFLECTION_NAMESPACE && entry.data.record.kind === 'terminal');
      if (terminals.length > 0) { assert.equal(terminals.at(-1).data.record.outcome, 'accepted'); return; }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`No critic terminal: ${JSON.stringify(manager.getEntries().filter(entry => entry.type === 'custom' && entry.customType.startsWith('cuckoo.experimental')))}`);
  }
  runtime.registerProvider('owned-primary', { api: 'openai-completions', baseUrl: 'http://fixture.invalid', apiKey: 'synthetic-primary-only',
    models: [{ id: 'scripted', name: 'Owned scripted primary', reasoning: false, input: ['text'], contextWindow: 200000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }],
    streamSimple(model, context) {
      contexts.push(structuredClone(context)); const next = script.shift(); assert.ok(next, 'unexpected extra primary turn');
      const stream = createAssistantMessageEventStream();
      void (async () => {
        try {
          if (next.waitForCritic) await waitForCritic();
          const content = next.tool === undefined ? [{ type: 'text', text: next.text }] : [next.tool];
          const stopReason = next.tool === undefined ? 'stop' : 'toolUse';
          const message = { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, usage, stopReason, timestamp: Date.now() };
          stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: stopReason, message }); stream.end();
        } catch (error) {
          errors.push(error);
          stream.push({ type: 'error', reason: 'error', error: { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'error', errorMessage: String(error), timestamp: Date.now() } });
          stream.end();
        }
      })();
      return stream;
    },
  });
  const entry = process.env.PI_CUCKOO_EXTENSION === undefined ? resolve(import.meta.dirname, '../index.ts') : process.env.PI_CUCKOO_EXTENSION;
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' });
  const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings, additionalExtensionPaths: [join(dirname(entry), 'tests/fixtures/network-cuckoo.ts')], noSkills: true, noContextFiles: true, noThemes: true, noPromptTemplates: true });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  ({ session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime, model: runtime.getModel('owned-primary', 'scripted'), scopedModels: [{ model: runtime.getModel('owned-auxiliary', 'owned-critic'), thinkingLevel: 'off' }], thinkingLevel: 'off', sessionManager: manager, settingsManager: settings, resourceLoader: loader }));
  await session.bindExtensions({ mode: 'tui', onError: error => errors.push(error), uiContext: {
    notify: (...args) => notices.push(args), setWidget() {},
    async select(_title, choices) { assert.ok(choices.length > 0); return choices[0]; },
    custom(factory, options) { return new Promise(resolve => {
      const panel = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, keys, resolve);
      panel.render(100); if (options.blocked.kind === 'permission') panel.handleInput('\x1b[C'); panel.handleInput('\r');
    }); },
  } });
  await session.prompt('/cuckoo on');
  for (const feature of ['evidence', 'reader', 'vectors']) await session.prompt(`/cuckoo feature ${feature} on`);
  const native = new NativeMemoryPort({ appendEntry: (type, data) => manager.appendCustomEntry(type, data) }, manager), memory = nativeMemoryRuntime();
  manager.appendMessage({ role: 'user', content: 'Synthetic task seed', timestamp: 1 });
  const task = appendMemory(native, makeTask(native.view(), 'Selected task', memory)).record;
  for (const [text, purpose] of [['needle selected artifact', 'artifact'], ['selected supporting evidence', 'evidence']]) {
    const source = manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text }], api: 'openai-completions', provider: 'owned-primary', model: 'scripted', usage, stopReason: 'stop', timestamp: 2 });
    appendMemory(native, makeSnapshot(native.view(), task.id, purpose, 'Explicit synthetic snapshot', { entryId: source, part: 0, start: 0, end: text.length }, [], memory));
  }
  await session.prompt('/cuckoo vectors approve');
  script.push({ tool: { type: 'toolCall', id: 'search-approved', name: 'cuckoo_search', arguments: { taskId: task.id, query: 'needle', topK: 1 } } }, { text: 'Vector workflow finished' });
  await session.prompt('Search the approved task');
  const search = manager.getEntries().find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolCallId === 'search-approved');
  assert.ok(search); assert.equal(search.message.isError, false); assert.equal(search.message.details.corpusSize, 2);
  assert.equal(posts.filter(post => post.path === '/embeddings').length, 3);
  await session.prompt('/cuckoo feature critic on'); await session.prompt('/cuckoo critic approve');
  const prior = contexts.length;
  script.push({ tool: { type: 'toolCall', id: 'ordinary-one', name: 'cuckoo_memory', arguments: { action: 'metadata' } } },
    { waitForCritic: true, tool: { type: 'toolCall', id: 'ordinary-two', name: 'cuckoo_memory', arguments: { action: 'metadata' } } },
    { text: 'Primary task is complete' });
  await session.prompt('Continue selected task. PRIMARY_CONTEXT_NOT_APPROVED');
  assert.equal(contexts.length - prior, 3);
  const criticPosts = posts.filter(post => post.path === '/v1/chat/completions'); assert.equal(criticPosts.length, 1);
  assert.ok(!JSON.stringify(criticPosts).includes('PRIMARY_CONTEXT_NOT_APPROVED'));
  assert.ok(JSON.stringify(contexts.at(-1).messages).includes('Untrusted model-authored advice'));
  assert.equal(manager.getEntries().filter(entry => entry.type === 'custom_message' && entry.customType === CRITIC_ADVICE_TYPE).length, 1);
  assert.equal(script.length, 0); assert.deepEqual(errors, []);
  assert.ok(!notices.some(([text]) => String(text).includes('unavailable')));
});
