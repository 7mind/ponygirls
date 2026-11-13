import { createServer } from 'node:http';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { registerCuckoo } from '../../index.ts';
import { FilePreferenceStore } from '../../src/preferences.ts';
import { nativeNetworkServices, type EncoderProfile } from '../../src/network-services.ts';
import { NativeMemoryPort, nativeMemoryRuntime } from '../../src/memory-runtime.ts';
import { appendMemory, makeTask, makeSnapshot, listSources } from '../../src/memory-core.ts';

export default async function (pi: ExtensionAPI): Promise<void> {
  if (process.env.PI_CUCKOO_OWNED_NETWORK_TEST !== 'synthetic-owned-test') throw new Error('Owned synthetic UI fixture only');
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end('{"error":"UI fixture does not serve inference"}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Owned HTTP address unavailable');
  const base = `http://127.0.0.1:${address.port}`;
  const agentDir = getAgentDir(), native = nativeNetworkServices(agentDir);
  const profile: EncoderProfile = Object.freeze({ id: 'owned-ui-encoder', label: 'Owned encoder for UI selection', url: `${base}/embeddings`, model: 'owned-ui-embedding', version: '1', dimensions: 2, normalization: 'unit', credentialEnv: 'FIXTURE_ONLY' });
  registerCuckoo(pi, new FilePreferenceStore(join(agentDir, 'cuckoo.json')), {
    ...native, embeddingTransportPolicy: 'owned-loopback-http', encoderProfiles: { path: 'injected:owned-ui', read: () => [profile] },
    credential: name => { if (name !== 'FIXTURE_ONLY') throw new Error('Unexpected fixture credential'); return 'synthetic-fixture-only'; },
    fetch(input, init) {
      const request = new Request(input, init); const target = new URL(request.url);
      if (target.origin !== base) throw new Error('Fixture refuses non-owned HTTP traffic');
      return globalThis.fetch(request);
    },
  });
  pi.registerProvider('owned-ui-critic', { api: 'openai-completions', baseUrl: `${base}/v1`, apiKey: 'synthetic-fixture-only',
    models: [{ id: 'owned-advisor', name: 'Owned UI advisory model', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 512, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  pi.registerCommand('owned-network-stats', { description: 'Synthetic UI fixture only', handler: async (_args, ctx) => { ctx.ui.notify(`Owned fixture HTTP requests: ${requests}`, 'info'); } });
  let seeded = false;
  pi.on('agent_settled', (_event, ctx) => {
    if (seeded) return;
    const port = new NativeMemoryPort(pi, ctx.sessionManager), runtime = nativeMemoryRuntime();
    const sources = listSources(port.view(), 'branch');
    const source = sources.findLast(item => item.role === 'assistant');
    if (source === undefined || source.parts.length === 0) throw new Error('Synthetic assistant source absent');
    seeded = true;
    const task = appendMemory(port, makeTask(port.view(), 'Owned synthetic UI task', runtime));
    const part = source.parts[0];
    appendMemory(port, makeSnapshot(port.view(), task.record.id, 'artifact', 'Owned UI artifact', { entryId: source.entryId, part: part.part, start: 0, end: part.chars }, [], runtime));
    ctx.ui.notify('Owned fixture task and artifact ready', 'info');
  });
  pi.on('session_shutdown', async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
}
