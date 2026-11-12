import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { captureSourceId } from '../.cache/worker/src/capture.js';
import extension from '../.cache/worker/src/extension.js';
import * as C from '../.cache/generated/typescript/ontology/api/index.js';
import { BaboonCodecContext } from '../.cache/generated/typescript/BaboonSharedRuntime.js';

const root = process.env.ONTOLOGY_PI_SDK_ROOT;
if (typeof root !== 'string') throw Error('explicit SDK root required');
const sdk = await import(pathToFileURL(resolve(root, 'dist/index.js')).href);
const encode = (codec, value) => codec.encode(BaboonCodecContext.Default, value);
const decode = (codec, value) => codec.decode(BaboonCodecContext.Default, value);
const sha = value => createHash('sha256').update(value).digest('hex');

async function listen(handler) {
  const server = createServer((request, response) => { void handler(request, response).catch(() => {
    response.writeHead(500); response.end('controlled fixture failure');
  }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function json(response, codec, value) {
  response.writeHead(200, { 'Content-Type': 'application/json', 'X-Ontology-Version': '0.1.0' });
  response.end(JSON.stringify(encode(codec, value)));
}

test('actual SDK captures finalized native messages and injects only request-local derived context', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ontology-sdk-'));
  const order = []; const captures = []; const deliveries = []; const providerRequests = [];
  const agentToken = 'a'.repeat(43); const collectorToken = 'b'.repeat(43);
  const agent = new C.Actor('worker', C.ActorKind.Agent);
  const collector = new C.Actor('collector', C.ActorKind.Collector);
  let frontier = 0n; let session;
  const capsules = new Map();
  const cut = () => new C.CapsuleCut(frontier * 2n, frontier, frontier, frontier === 0n ? undefined : frontier * 2n, undefined);
  const trace = () => new C.RequestTrace(randomUUID(), 'controlled-sdk-fixture', C.RequestTransport.Bearer);
  const context = value => new C.ContextRecord(new C.OriginContext_ReportedNative(value.origin.context), []);
  const service = await listen(async (request, response) => {
    const operation = request.url.split('/').at(-1); order.push(operation);
    const isCollector = request.headers.authorization === 'Bearer ' + collectorToken;
    if (operation === 'whoami') return json(response, C.Identity.jsonCodec(),
      new C.Identity(isCollector ? collector : agent, ['scope'], isCollector ? [C.Capability.Capture] : [C.Capability.Read]));
    const raw = await body(request);
    if (operation === 'ingest') {
      assert(isCollector); const value = decode(C.IngestRequest.jsonCodec(), raw); captures.push(value); frontier++;
      return json(response, C.IngestResult.jsonCodec(), new C.IngestResult('scope', value.requestId, value.eventId, 'collector-credential', new C.Ref(captureSourceId('collector-credential', value.eventId), 1), [], frontier, false));
    }
    if (operation === 'status') return json(response, C.CurationStatus.jsonCodec(), new C.CurationStatus('scope', frontier * 2n, frontier, frontier, C.CurationState.Idle, undefined, frontier * 2n, undefined));
    if (operation === 'capsule') {
      const input = decode(C.CapsuleRequest.jsonCodec(), raw);
      const payload = new C.CapsulePayload('scope', 'work', context(input.reportedContext), cut(), input.previousCapsuleId,
        new C.CapsulePolicyIdentity('fixture-policy', sha('policy')), [], new C.CapsuleManifest([], [], []), 'controlled-derived-capsule');
      const value = new C.Capsule(randomUUID(), input.requestId, agent, payload, sha(JSON.stringify(encode(C.CapsulePayload.jsonCodec(), payload))),
        new C.CapsuleLimits(100, 8192), new Date().toISOString(), trace());
      capsules.set(value.id, value); return json(response, C.Capsule.jsonCodec(), value);
    }
    if (operation === 'delivery') {
      const input = decode(C.DeliveryRequest.jsonCodec(), raw); deliveries.push(input);
      return json(response, C.DeliveryReceipt.jsonCodec(), new C.DeliveryReceipt(randomUUID(), input.requestId, agent, input.scope, input.capsuleId,
        input.capsulePayloadDigest, input.workContext, context(input.reportedContext), input.boundary, input.reportedAt, input.reportedBoundaryPayload,
        new Date().toISOString(), trace(), capsules.get(input.capsuleId).payload.cut, C.DeliveryCutComparison.SameGraphAndCoverage));
    }
    throw Error('unexpected operation');
  });
  const provider = await listen(async (request, response) => {
    assert.equal(request.url, '/v1/chat/completions');
    providerRequests.push(await body(request)); order.push('provider');
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const first = providerRequests.length === 1;
    for (const chunk of [
      { choices: [{ index: 0, delta: first ? { role: 'assistant', tool_calls: [{ index: 0, id: 'controlled-call', type: 'function', function: { name: 'fixture_echo', arguments: '{}' } }] } : { role: 'assistant', content: 'original-worker-output' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: first ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    ]) response.write('data: ' + JSON.stringify({ id: 'fixture-completion', object: 'chat.completion.chunk', model: 'worker', ...chunk }) + '\n\n');
    response.end('data: [DONE]\n\n');
  });
  try {
    const agentDir = join(directory, 'agent'); const cwd = join(directory, 'workspace');
    await mkdir(agentDir); await mkdir(cwd);
    const workerTokenFile = join(directory, 'worker-token'); const collectorTokenFile = join(directory, 'collector-token');
    await writeFile(workerTokenFile, agentToken, { mode: 0o600 }); await writeFile(collectorTokenFile, collectorToken, { mode: 0o600 });
    const configPath = join(directory, 'config.json');
    await writeFile(configPath, JSON.stringify({ version: 1, captureAuthorization: 'current-session-from-attachment',
      http: { origin: service.origin, deadlineMs: 2000, maxRequestBytes: 8192, maxResponseBytes: 8192 },
      coordinator: { scope: 'scope', workContext: 'work', workerActorId: 'worker', collectorActorId: 'collector', collectorNamespace: 'collector-credential',
        boundaryDeadlineMs: 5000, pollEveryMs: 10, maxNewEntries: 100, maxTrackedEntries: 1000, maxCaptureTextBytes: 4096, maxCapsuleBytes: 8192 },
      workerTokenFile, collectorTokenFile }));
    const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null,
      modelsStorePath: join(agentDir, 'models-cache.json'), allowModelNetwork: false, refreshOnCreate: false });
    modelRuntime.registerProvider('ontology-fixture', { baseUrl: provider.origin + '/v1', apiKey: 'synthetic-provider-key', api: 'openai-completions',
      models: [{ id: 'worker', name: 'Controlled worker', reasoning: false, input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 }] });
    const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const errors = [];
    const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager,
      noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
      systemPrompt: 'Controlled ordinary system constraint.',
      extensionFactories: [extension, pi => {
        pi.registerTool({ name: 'fixture_echo', label: 'Controlled echo', description: 'Returns synthetic test data',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          execute: async () => ({ content: [{ type: 'text', text: 'controlled-tool-output' }], details: {} }) });
        pi.on('message_end', event => {
          if (event.message.role === 'assistant' && event.message.stopReason === 'stop') return { message: { ...event.message, content: [{ type: 'text', text: 'finalized-worker-output' }] } };
        });
      }] });
    await loader.reload();
    loader.getExtensions().runtime.flagValues.set('ontology-config', configPath);
    const manager = sdk.SessionManager.inMemory(cwd);
    manager.appendMessage({ role: 'user', content: 'copied historical input', timestamp: Date.now() });
    const model = modelRuntime.getModel('ontology-fixture', 'worker');
    assert(model !== undefined, 'controlled model must exist; no provider fallback is allowed');
    ({ session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime, model,
      thinkingLevel: 'off', tools: ['fixture_echo'], resourceLoader: loader, sessionManager: manager, settingsManager }));
    await session.bindExtensions({ mode: 'print', onError: error => errors.push(error) });
    await session.prompt('new native input');
    await session.waitForIdle();
    assert.deepEqual(errors, []);
    assert.equal(providerRequests.length, 2);
    assert.equal(deliveries.length, 2);
    assert(order.indexOf('ingest') < order.indexOf('capsule'));
    assert(order.indexOf('delivery') < order.indexOf('provider'));
    assert.equal(captures.length, 4);
    assert(captures[0].text.includes('new native input'));
    assert.equal(JSON.parse(captures[1].text).outcome.stopReason, 'toolUse');
    assert(captures[2].text.includes('controlled-tool-output'));
    assert(captures[3].text.includes('finalized-worker-output'));
    assert(!captures.some(value => value.text.includes('original-worker-output') || value.text.includes('copied historical input') || value.text.includes('controlled-derived-capsule')));
    assert.equal(captures[0].metadata.exposedDeliveries.length, 0);
    assert.equal(captures[1].metadata.exposedDeliveries.length, 1);
    assert.deepEqual(captures[2].metadata.exposedDeliveries, captures[1].metadata.exposedDeliveries);
    assert.equal(captures[3].metadata.exposedDeliveries.length, 1);
    assert.notDeepEqual(captures[3].metadata.exposedDeliveries, captures[1].metadata.exposedDeliveries);
    assert(JSON.stringify(providerRequests[0]).includes('controlled-derived-capsule'));
    assert(JSON.stringify(providerRequests[0]).includes('Controlled ordinary system constraint.'));
    assert(!manager.getBranch().some(entry => entry.type === 'custom_message' && entry.customType === 'ontology-derived-context'));
  } finally {
    if (session !== undefined) { await session.abort(); session.dispose(); }
    await provider.close(); await service.close(); await rm(directory, { recursive: true });
  }
});
