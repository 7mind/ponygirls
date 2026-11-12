import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MODEL_SELECTION, assertAllowedModel, createRuntime, readProviderConfig } from './runtime.mjs';

const [outputArgument, provider, modelId] = process.argv.slice(2);
if (outputArgument === undefined) throw new Error('Expected output directory');
assertAllowedModel(provider, modelId);
const selection = MODEL_SELECTION.find(model => model.provider === provider && model.id === modelId);
for (const key of ['PI_SDK_ROOT', 'PI_PILOT_AUTH_PATH', 'PI_PILOT_PROVIDER_CONFIG']) if (!process.env[key]) throw new Error(`Missing ${key}`);
const sdk = await import(pathToFileURL(join(process.env.PI_SDK_ROOT, 'dist/index.js')).href);
const require = createRequire(join(process.env.PI_SDK_ROOT, 'package.json'));
const { Type } = await import(pathToFileURL(require.resolve('typebox')).href);
const directory = resolve(outputArgument); mkdirSync(directory, { recursive: false });
const agentDir = join(directory, 'agent'); const cwd = join(directory, 'work'); mkdirSync(agentDir); mkdirSync(cwd);
const nonce = randomUUID();
const result = { provider, modelId, startedAt: new Date().toISOString(), status: 'running', requests: 0, toolCalls: 0, response: null, errors: [] };
const save = () => writeFileSync(join(directory, 'probe.json'), JSON.stringify(result, null, 2) + '\n');
let session; let runtime; let timer;
try {
  const signal = AbortSignal.timeout(180000);
  runtime = await createRuntime(sdk, process.env.PI_PILOT_AUTH_PATH, signal, readProviderConfig(process.env.PI_PILOT_PROVIDER_CONFIG));
  const model = runtime.getModel(provider, modelId);
  if (model === undefined || model.provider !== provider || model.id !== modelId) throw new Error('Selected model unavailable');
  result.model = { provider: model.provider, id: model.id, api: model.api, contextWindow: model.contextWindow, maxTokens: model.maxTokens };
  const auth = await runtime.getAuth(model, { signal, minOAuthValidityMs: 70 * 60 * 1000 });
  if (auth === undefined) throw new Error('Selected model credentials unavailable');
  const credential = sdk.readStoredCredential(provider, process.env.PI_PILOT_AUTH_PATH);
  result.credential = credential?.type === 'oauth' ? { type: 'oauth', expiresAt: new Date(credential.expires).toISOString(), remainingSeconds: Math.floor((credential.expires - Date.now()) / 1000), refreshable: Boolean(credential.refresh) } : { type: 'api_key_or_configured', expiry: 'not advertised' };
  const guard = pi => {
    pi.on('before_provider_request', (_event, ctx) => {
      result.requests++; save();
      if (result.requests > 4) { ctx.abort(); throw new Error('Canary request limit'); }
    });
  };
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true, extensionFactories: [guard], systemPrompt: 'You are completing a synthetic tool-transport canary. Use only the provided tool; no other resources exist.' });
  await loader.reload();
  if (loader.getExtensions().errors.length !== 0) throw new Error('Canary extension load failed');
  const manager = sdk.SessionManager.create(cwd, directory);
  ({ session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime: runtime, model, thinkingLevel: selection.thinking, settingsManager: settings, resourceLoader: loader, sessionManager: manager, tools: ['fixture_echo'], customTools: [{ name: 'fixture_echo', label: 'Fixture echo', description: 'Return a run-specific synthetic marker.', parameters: Type.Object({ tag: Type.Literal('canary') }), async execute() { result.toolCalls++; return { content: [{ type: 'text', text: nonce }], details: { marker: nonce } }; } }] }));
  await session.bindExtensions({ mode: 'rpc', onError: error => result.errors.push({ kind: 'extension', name: error.name }) });
  result.activeTools = session.getActiveToolNames(); result.thinking = session.thinkingLevel;
  timer = setTimeout(() => { result.errors.push({ kind: 'deadline' }); void session.abort(); }, 150000);
  await session.prompt('Call fixture_echo with tag canary exactly once. Then reply with only the marker it returns.');
  const assistants = manager.getBranch().filter(entry => entry.type === 'message' && entry.message.role === 'assistant');
  result.responses = assistants.map(entry => ({ entryId: entry.id, provider: entry.message.provider, model: entry.message.model, stopReason: entry.message.stopReason, usage: entry.message.usage }));
  result.response = session.getLastAssistantText() ?? null; result.sessionFile = manager.getSessionFile();
  result.status = result.toolCalls === 1 && result.response?.trim() === nonce && assistants.every(entry => ['stop', 'toolUse'].includes(entry.message.stopReason)) && result.errors.length === 0 ? 'completed' : 'failed';
} catch (error) {
  result.status = 'failed';
  result.errors.push({ kind: 'runtime', name: error instanceof Error ? error.name : 'unknown', message: error instanceof Error && /^(Selected model|Canary)/.test(error.message) ? error.message : 'Runtime failure; credential-bearing diagnostics not retained' });
} finally {
  clearTimeout(timer);
  if (session !== undefined) { await session.abort(); session.dispose(); }
  if (runtime !== undefined) await runtime.settleCredentialWrites();
  result.finishedAt = new Date().toISOString(); save();
}
console.log(JSON.stringify(result));
process.exitCode = result.status === 'completed' ? 0 : 1;
