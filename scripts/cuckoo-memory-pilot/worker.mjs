import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getCase } from './cases.mjs';
import { runJob } from './harness.mjs';
import { assertAllowedModel, createRuntime, MODEL_SELECTION, readProviderConfig } from './runtime.mjs';
import { verifyProtocol } from './protocol.mjs';
import { hash } from './memory.mjs';

export async function main(args, env, emit) {
  const [jobPath, directory, protocolPath] = args;
  if (jobPath === undefined || directory === undefined || protocolPath === undefined || !env.PI_SDK_ROOT || !env.PI_PILOT_AUTH_PATH || !env.PI_CUCKOO_EXTENSION || !env.PI_PILOT_PROVIDER_CONFIG) throw new Error('Pilot missing worker arguments/environment');
  const job = JSON.parse(readFileSync(jobPath, 'utf8'));
  const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
  verifyProtocol(protocol, env.PI_SDK_ROOT, env.PI_CUCKOO_EXTENSION, env.PI_PILOT_PROVIDER_CONFIG);
  const registered = Object.values(protocol.plan).flat().find(item => item.id === job.id);
  if (registered === undefined || hash(registered) !== hash(job)) throw new Error('Pilot job is not in the frozen plan');
  assertAllowedModel(job.provider, job.model);
  const selection = MODEL_SELECTION.find(item => item.provider === job.provider && item.id === job.model);
  if (job.thinking !== selection.thinking || !['current', 'delta'].includes(job.writing) || !Array.isArray(job.continuations) || job.continuations.length === 0) throw new Error('Pilot invalid job specification');
  const sdk = await import(pathToFileURL(join(env.PI_SDK_ROOT, 'dist/index.js')).href);
  const require = createRequire(join(env.PI_SDK_ROOT, 'package.json'));
  const { Type } = await import(pathToFileURL(require.resolve('typebox')).href);
  const controller = new AbortController();
  const stop = () => controller.abort(); process.once('SIGTERM', stop); process.once('SIGINT', stop);
  const runtime = await createRuntime(sdk, env.PI_PILOT_AUTH_PATH, controller.signal, readProviderConfig(env.PI_PILOT_PROVIDER_CONFIG));
  try {
    const model = runtime.getModel(job.provider, job.model);
    if (model === undefined) throw new Error('Pilot selected model unavailable');
    const streamSimple = runtime.streamSimple.bind(runtime);
    runtime.streamSimple = (selected, context, options) => {
      if (selected.provider !== job.provider || selected.id !== job.model) throw new Error('Pilot unexpected model route');
      return streamSimple(selected, context, { ...options, signal: options.signal === undefined ? controller.signal : AbortSignal.any([options.signal, controller.signal]), maxTokens: 8192, maxRetries: 0, disableContinuation: true,
        ...(selected.api === 'openai-codex-responses' ? { transport: 'sse' } : {}) });
    };
    return await runJob({ job, caseData: getCase(job.caseId), directory: resolve(directory), sdk, Type, runtime, model,
      extension: env.PI_CUCKOO_EXTENSION, onProgress: event => emit({ at: new Date().toISOString(), ...event }), inferenceKind: 'live', signal: controller.signal });
  } finally {
    await runtime.settleCredentialWrites();
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const stdout = process.stdout.write.bind(process.stdout);
  const discard = (_chunk, encoding, callback) => { const done = typeof encoding === 'function' ? encoding : callback; if (typeof done === 'function') queueMicrotask(done); return true; };
  for (const key of ['log', 'info', 'debug', 'warn', 'error', 'trace', 'dir']) console[key] = () => {};
  process.stdout.write = discard; process.stderr.write = discard;
  try {
    const result = await main(process.argv.slice(2), process.env, event => stdout(JSON.stringify(event) + '\n'));
    process.exitCode = result.status === 'completed' ? 0 : 1;
  } catch (error) {
    stdout(JSON.stringify({ kind: 'worker-failure', at: new Date().toISOString(), category: error instanceof Error && error.message.startsWith('Pilot ') ? error.message : 'Runtime setup failure; diagnostics omitted' }) + '\n');
    process.exitCode = 1;
  }
}
