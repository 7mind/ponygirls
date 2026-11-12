import { readFileSync } from 'node:fs';

export const MODEL_SELECTION = Object.freeze([
  { provider: 'openai-codex', id: 'gpt-6.1-sol', thinking: 'high' },
  { provider: 'compatible', id: 'deepseek-ai/DeepSeek-V4-Pro-0813', thinking: 'high' },
  { provider: 'compatible', id: 'Qwen/Qwen3-30B-A3B-Instruct-2507', thinking: 'off' },
]);
export const CLIENT_CONTEXT_BOUND = 65536;
export const CLIENT_OUTPUT_BOUND = 8192;

export function readProviderConfig(path) {
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error('Pilot private provider configuration is unavailable or invalid JSON'); }
  if (value === null || typeof value !== 'object' || Object.keys(value).length !== 2 || typeof value.baseUrl !== 'string' || typeof value.apiKeyEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(value.apiKeyEnv)) throw new Error('Pilot invalid private provider configuration');
  let url;
  try { url = new URL(value.baseUrl); }
  catch { throw new Error('Pilot invalid private provider URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Pilot requires a credential-free HTTPS provider URL');
  return { baseUrl: value.baseUrl, apiKeyEnv: value.apiKeyEnv };
}

export function assertAllowedModel(provider, id) {
  if (!MODEL_SELECTION.some(model => model.provider === provider && model.id === id)) throw new Error('Model outside frozen non-Anthropic allowlist');
}

export async function createRuntime(sdk, authPath, signal, providerConfig) {
  const runtime = await sdk.ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false, signal });
  // These are client execution bounds, not verified physical capacity.
  runtime.registerProvider('compatible', {
    api: 'openai-completions', apiKey: `$${providerConfig.apiKeyEnv}`, baseUrl: providerConfig.baseUrl,
    models: MODEL_SELECTION.filter(model => model.provider === 'compatible').map(model => ({
      id: model.id, name: `${model.id} (pilot)`, reasoning: model.thinking !== 'off', input: ['text'],
      contextWindow: CLIENT_CONTEXT_BOUND, maxTokens: CLIENT_OUTPUT_BOUND, compat: { supportsDeveloperRole: false },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
  });
  return runtime;
}
