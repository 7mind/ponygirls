import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { CASES, prompts, LONG_ROWS, SHORT_ROWS } from './corpus.mjs';
import { grade, recallCoverage } from './grade.mjs';
import { recordResponses, feasibilityMatches, exposure } from './support.mjs';

const [phase, outputArgument] = process.argv.slice(2);
if (!['feasibility', 'scored'].includes(phase) || outputArgument === undefined || process.env.PI_SDK_ROOT === undefined || process.env.PI_PILOT_AUTH_PATH === undefined) throw new Error('Usage: PI_SDK_ROOT=... PI_PILOT_AUTH_PATH=... node pilot.mjs feasibility|scored OUTPUT_DIR');
const sdk = await import(pathToFileURL(join(process.env.PI_SDK_ROOT, 'dist/index.js')).href);
const root = resolve(import.meta.dirname, '../..');
const output = resolve(outputArgument); mkdirSync(output, { recursive: true });
const config = { provider: 'openai-codex', model: 'gpt-6.1-sol', thinking: 'medium', policy: { kind: 'window', value: 15 }, repetitions: 1,
  longRows: LONG_ROWS, shortRows: SHORT_ROWS, maxRequestsPerSession: 12, maxResponseChars: 24000, maxPayloadChars: 4000000, requestDeadlineMs: 180000, sessionDeadlineMs: 900000, pilotDeadlineMs: 3600000,
  retries: 0, compaction: false, systemPrompt: 'You are an assistant performing a synthetic evaluation. Follow the user task. No external tools are available. Do not invent evidence.' };
const extension = join(root, 'nix/pkg/pi-extensions/ponygirls-cuckoo/index.ts');
const hash = text => createHash('sha256').update(text).digest('hex');
const sourcePaths = ['scripts/cuckoo-pilot/pilot.mjs', 'scripts/cuckoo-pilot/corpus.mjs', 'scripts/cuckoo-pilot/grade.mjs', 'scripts/cuckoo-pilot/grade.test.mjs', 'scripts/cuckoo-pilot/support.mjs', 'scripts/cuckoo-pilot/support.test.mjs', 'scripts/cuckoo-pilot/analyze.mjs', 'scripts/cuckoo-pilot/analyze.test.mjs', 'scripts/cuckoo-pilot/run.sh', 'scripts/cuckoo-pilot/README.md', 'nix/pkg/pi-extensions/ponygirls-cuckoo/index.ts', ...['policy', 'preferences', 'state', 'report', 'view'].map(name => `nix/pkg/pi-extensions/ponygirls-cuckoo/src/${name}.ts`)];
const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, hash(readFileSync(join(root, path)))]));
const runtime = await sdk.ModelRuntime.create({ authPath: process.env.PI_PILOT_AUTH_PATH, modelsPath: null, refreshOnCreate: false });
const model = runtime.getModel(config.provider, config.model);
if (model === undefined || model.contextWindow !== 500000) throw new Error('Pilot requires the observed unmodified 500000-token model capacity');
const startedAt = new Date().toISOString(); const pilotDeadline = Date.now() + config.pilotDeadlineMs;
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
function save(path, value) { const temporary = `${path}.tmp`; writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n'); renameSync(temporary, path); }
const log = value => console.log(JSON.stringify({ at: new Date().toISOString(), ...value }));

async function run(task, length, enabled, id) {
  const directory = join(output, id); mkdirSync(directory, { recursive: false });
  const agentDir = join(directory, 'agent'); const cwd = join(directory, 'work'); mkdirSync(agentDir); mkdirSync(cwd);
  writeFileSync(join(agentDir, 'cuckoo.json'), JSON.stringify({ version: 2, enabled, policy: config.policy }));
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = agentDir;
  const result = { id, task: task.id, heldOut: task.heldOut, length, enabled, startedAt: new Date().toISOString(), status: 'running', primaryStatus: 'unavailable', secondaryStatus: 'unavailable', requestCount: 0, phases: [], reports: [], errors: [], responses: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } };
  const inputPrompts = prompts(task, length); result.promptHashes = inputPrompts.map(hash);
  const sessionDeadline = Date.now() + config.sessionDeadlineMs;
  let session;
  const guard = pi => {
    pi.on('before_provider_request', (event, ctx) => {
      result.requestCount++;
      const payloadChars = JSON.stringify(event.payload).length;
      if (result.requestCount > config.maxRequestsPerSession || payloadChars > config.maxPayloadChars || Date.now() > sessionDeadline || Date.now() > pilotDeadline) {
        result.errors.push({ kind: 'execution-bound', payloadChars }); ctx.abort(); throw new Error('Pilot execution bound');
      }
      log({ kind: 'request', id, request: result.requestCount, payloadChars });
    });
    pi.on('message_update', (event, ctx) => {
      if (event.message.role !== 'assistant') return;
      const chars = event.message.content.reduce((count, part) => count + (part.type === 'text' ? part.text.length : part.type === 'thinking' ? part.thinking.length : 0), 0);
      if (chars > config.maxResponseChars) { result.errors.push({ kind: 'response-bound', chars }); ctx.abort(); }
    });
  };
  try {
    const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager: settings, noExtensions: true, disabledBuiltinExtensions: ['mcp'], noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
      additionalExtensionPaths: [extension], extensionFactories: [guard], systemPrompt: config.systemPrompt });
    await loader.reload(); if (loader.getExtensions().errors.length > 0) throw new Error('Extension load failed');
    const manager = sdk.SessionManager.create(cwd, directory);
    ({ session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime: runtime, model, thinkingLevel: config.thinking, settingsManager: settings, resourceLoader: loader, sessionManager: manager, tools: [] }));
    await session.bindExtensions({ mode: 'rpc', onError: () => result.errors.push({ kind: 'extension-error' }) });
    if (session.model === undefined || session.model.contextWindow !== model.contextWindow || session.thinkingLevel !== config.thinking || session.getActiveToolNames().length !== 0) throw new Error('Session configuration mismatch');
    for (let i = 0; i < inputPrompts.length; i++) {
      log({ kind: 'phase-start', id, phase: i, inputChars: inputPrompts[i].length });
      const before = new Set(manager.getBranch().map(entry => entry.id));
      const timer = setTimeout(() => { result.errors.push({ kind: 'request-deadline', phase: i }); void session.abort(); }, config.requestDeadlineMs);
      let promptError = null;
      try { await session.prompt(inputPrompts[i]); } catch (error) { promptError = error; } finally { clearTimeout(timer); }
      const branch = manager.getBranch();
      const reports = branch.filter(entry => entry.type === 'custom' && entry.customType === 'cuckoo.report').map(entry => entry.data);
      const checkpointIds = new Set(reports.map(report => report.messageEntryId));
      const assistants = branch.filter(entry => !before.has(entry.id) && entry.type === 'message' && entry.message.role === 'assistant');
      result.reports = reports;
      recordResponses(result, assistants, checkpointIds, i);
      if (promptError !== null) throw promptError;
      const ordinary = result.responses.filter(response => response.phase === i && !response.checkpoint).at(-1);
      if (ordinary === undefined) throw new Error('Missing ordinary task response');
      if (task.id !== 'feasibility' && i === 3) { result.grade = grade(task, ordinary.text); result.primaryStatus = 'completed'; }
      if (task.id !== 'feasibility' && i === 4) { result.recall = recallCoverage(task.id, ordinary.text); result.secondaryStatus = 'completed'; }
      const usage = session.getContextUsage();
      if (usage === undefined || usage.tokens === null || !Number.isFinite(usage.tokens)) throw new Error('Missing observed context usage');
      result.phases.push({ phase: i, contextTokens: usage.tokens, contextWindow: usage.contextWindow, checkpointCount: reports.length, ordinaryEntryId: ordinary.entryId });
      result.reports = reports;
      log({ kind: 'phase-done', id, phase: i, contextTokens: usage.tokens, checkpoints: reports.length });
      save(join(directory, 'result.json'), result);
      if (usage.contextWindow !== model.contextWindow || usage.tokens > model.contextWindow * 0.8 || branch.some(entry => entry.type === 'compaction') || result.errors.length > 0) throw new Error('Invalid exposure or execution fault');
    }
    result.exposure = exposure(result);
    if (!result.exposure.valid) throw new Error('Invalid treatment exposure');
    result.status = 'completed';
  } catch (error) {
    const primary = result.responses.findLast(response => response.phase === 3 && !response.checkpoint && response.stopReason === 'stop');
    if (task.id !== 'feasibility' && primary !== undefined) { result.grade = grade(task, primary.text); result.primaryStatus = 'completed'; }
    result.status = 'failed'; result.errors.push({ kind: 'run-failure', name: error instanceof Error ? error.name : 'unknown', message: error instanceof Error && /^(Pilot|Session|Provider|Missing|Invalid|Control|Extension)/.test(error.message) ? error.message : 'Runtime failure (details omitted to avoid credential-bearing diagnostics)' });
    save(join(directory, 'result.json'), result);
  } finally {
    if (session !== undefined) { await session.abort(); session.dispose(); }
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    result.finishedAt = new Date().toISOString(); result.elapsedMs = Date.parse(result.finishedAt) - Date.parse(result.startedAt);
    save(join(directory, 'result.json'), result); log({ kind: 'run-done', id, status: result.status, requests: result.requestCount, checkpoints: result.reports.length, grade: result.grade });
  }
  return result;
}

if (phase === 'feasibility') {
  const task = { id: 'feasibility', heldOut: false, initial: 'Your ongoing objective is a workflow feasibility check using synthetic material. After two historical archive inspections, return JSON only {"marker":"FEASIBILITY_DONE"}. For now acknowledge readiness in at most 12 words.', records: [{ marker: 'FEASIBILITY_DONE' }] };
  const result = await run(task, 'long', true, 'feasibility');
  const valid = result.status === 'completed' && result.reports.length >= 1 && result.reports.every(report => report.error === null) && result.phases.every(stage => stage.contextWindow === 500000);
  save(join(output, 'feasibility.json'), { valid, config, sourceHashes, model: { provider: model.provider, id: model.id, api: model.api, contextWindow: model.contextWindow }, result });
  process.exitCode = valid ? 0 : 1;
} else {
  const feasibility = JSON.parse(readFileSync(join(output, 'feasibility.json'), 'utf8'));
  if (!feasibilityMatches(feasibility, config, sourceHashes, model)) throw new Error('A matching successful feasibility pass is required');
  const plan = CASES.flatMap(task => ['short', 'long'].map(length => ({ task, length, arms: parseInt(hash(`${task.id}:${length}`).slice(0, 2), 16) % 2 === 0 ? [false, true] : [true, false] })));
  writeFileSync(join(output, 'protocol.json'), JSON.stringify({ startedAt, sourceCommit, sourceHashes, config, model: { provider: model.provider, id: model.id, api: model.api, contextWindow: model.contextWindow }, plan: plan.map(item => ({ task: item.task.id, heldOut: item.task.heldOut, length: item.length, arms: item.arms })) }, null, 2) + '\n', { flag: 'wx' });
  const results = [];
  for (const item of plan) for (const enabled of item.arms) {
    if (Date.now() > pilotDeadline) throw new Error('Pilot wallclock deadline; partial results retained');
    results.push(await run(item.task, item.length, enabled, `${item.task.id}-${item.length}-${enabled ? 'on' : 'off'}`));
    save(join(output, 'summary.json'), { startedAt, updatedAt: new Date().toISOString(), config, completedRuns: results.length, plannedRuns: plan.length * 2, results });
  }
  process.exitCode = results.some(result => result.status !== 'completed') ? 1 : 0;
}
