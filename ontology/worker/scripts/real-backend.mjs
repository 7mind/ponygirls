import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { capsuleSlots } from './provider-observation.mjs';
const [configPath, sdkRoot, workerRoot, report] = process.argv.slice(2);
if (process.argv.length !== 6 || ![configPath, sdkRoot, workerRoot, report].every(value => typeof value === 'string' && isAbsolute(value))) throw Error('expected absolute worker config, SDK root, installed worker root and report directory');
const { loadConfig } = await import(pathToFileURL(resolve(workerRoot, 'worker/src/config.js')).href);
const config = await loadConfig(configPath, new AbortController().signal);
const sdk = await import(pathToFileURL(resolve(sdkRoot, 'dist/index.js')).href);
const requests = [];
const requestByEntry = new Map();
const server = createServer(async (request, response) => {
  try {
    assert.equal(request.url, '/v1/chat/completions');
    const parts = []; let size = 0;
    for await (const part of request) { size += part.length; assert(size <= 2 * 1024 * 1024); parts.push(part); }
    requests.push(JSON.parse(Buffer.concat(parts).toString('utf8')));
    assert(requests.length <= 2, 'unexpected autonomous continuation');
    const first = requests.length === 1;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const delta = first ? { role: 'assistant', tool_calls: [{ index: 0, id: 'controlled-worker-call', type: 'function', function: { name: 'fixture_echo', arguments: '{}' } }] }
      : { role: 'assistant', content: 'original-worker-output' };
    for (const chunk of [
      { choices: [{ index: 0, delta, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: first ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    ]) response.write('data: ' + JSON.stringify({ id: 'controlled-worker-completion', object: 'chat.completion.chunk', model: 'worker', ...chunk }) + '\n\n');
    response.end('data: [DONE]\n\n');
  } catch { response.writeHead(500); response.end('controlled provider failure'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let session;
let observations;
try {
  const agentDir = join(report, 'agent'); const cwd = join(report, 'workspace');
  await mkdir(agentDir); await mkdir(cwd);
  const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null,
    modelsStorePath: join(agentDir, 'models-cache.json'), allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerProvider('ontology-fixture', { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic-provider-key', api: 'openai-completions',
    models: [{ id: 'worker', name: 'Controlled worker', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 }] });
  const model = modelRuntime.getModel('ontology-fixture', 'worker');
  assert(model !== undefined, 'no fallback model is allowed');
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const errors = [];
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
    systemPrompt: 'Controlled ordinary system constraint.',
    additionalExtensionPaths: [workerRoot],
    extensionFactories: [pi => {
      pi.registerTool({ name: 'fixture_echo', label: 'Controlled echo', description: 'Returns synthetic test data',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => ({ content: [{ type: 'text', text: 'controlled-tool-output' }], details: {} }) });
      pi.on('message_end', event => {
        if (event.message.role === 'assistant' && event.message.stopReason === 'stop') return { message: { ...event.message, content: [{ type: 'text', text: 'finalized-worker-output' }] } };
      });
      pi.on('turn_end', event => {
        for (const id of [event.messageEntryId, ...event.toolResultEntryIds]) requestByEntry.set(id, requests.length);
      });
    }] });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, [], 'installed extension must load through package discovery');
  loader.getExtensions().runtime.flagValues.set('ontology-config', configPath);
  const manager = sdk.SessionManager.inMemory(cwd);
  const historicalId = manager.appendMessage({ role: 'user', content: 'copied historical input', timestamp: Date.now() });
  ({ session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime, model, thinkingLevel: 'off', tools: ['fixture_echo'],
    resourceLoader: loader, sessionManager: manager, settingsManager }));
  await session.bindExtensions({ mode: 'print', onError: error => errors.push(error) });
  await session.prompt('new native input');
  await session.waitForIdle();
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 2);
  await writeFile(join(report, 'request-shapes.json'), JSON.stringify(requests.map(request => request.messages.map(message => ({
    role: message.role, contentType: typeof message.content, array: Array.isArray(message.content),
    containsCapsule: JSON.stringify(message.content).includes('# Qualified ontology context'),
  }))), null, 2) + '\n');
  const slots = requests.map(capsuleSlots);
  assert(slots.every(values => values.length === 1), 'each actual provider request must contain its request-local capsule');
  assert(requests.every(request => JSON.stringify(request).includes('Controlled ordinary system constraint.')));
  assert(!manager.getBranch().some(entry => entry.type === 'custom_message' && entry.customType === 'ontology-derived-context'));
  const manifest = manager.getBranch().filter(entry => entry.type === 'message' && entry.id !== historicalId && ['user', 'assistant', 'toolResult'].includes(entry.message.role)).map(entry => {
    const message = entry.message;
    const content = typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => ({ type: 'text', text: block.text }));
    const outcome = message.role === 'assistant' ? { stopReason: message.stopReason } : message.role === 'toolResult' ? { isError: message.isError } : undefined;
    return { sourceId: entry.id, parentSourceId: entry.parentId,
      origin: { user: 'UserMessage', assistant: 'WorkerMessage', toolResult: 'ToolOutput' }[message.role],
      text: JSON.stringify({ role: message.role, content, ...(outcome === undefined ? {} : { outcome }) }),
      requestIndex: requestByEntry.get(entry.id) ?? 0 };
  });
  assert.equal(manifest.length, 4);
  assert.deepEqual(manifest.map(entry => entry.requestIndex), [0, 1, 1, 2]);
  observations = { scope: config.coordinator.scope, providerRequests: requests.length, slots: slots.map(values => values[0]), manifest,
    sessionId: manager.getSessionId(), sdkRoot, workerRoot, node: process.version, realBackend: true, semanticQuality: false };
} finally {
  if (session !== undefined) { await session.abort(); session.dispose(); }
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
await writeFile(join(report, 'worker-observations.json'), JSON.stringify(observations, null, 2) + '\n');
