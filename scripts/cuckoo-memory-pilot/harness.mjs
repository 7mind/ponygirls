import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INQUIRY, INQUIRY_TYPE, stateOnBranch } from '../../nix/pkg/pi-extensions/ponygirls-cuckoo/src/state.ts';
import { aggregateUsage, assistantRecords, DELTA_FOCUS, hash, REDUCTION_SUMMARY, reportInventory, searchRounds, SYSTEM_PROMPT } from './memory.mjs';

export const LIMITS = Object.freeze({ phaseMs: 180000, jobMs: 900000, prefixRequests: 48, continuationRequests: 20, payloadChars: 500000, responseChars: 60000, responseWithThinkingChars: 150000, contextTokens: 50000 });
export const AUDIT_DOCUMENTS = Object.freeze([
  { id: 'audit-components', availableFrom: 2, caption: 'Independent component audit', body: { rows: [{ id: 'a', active: true }, { id: 'b', active: false }, { id: 'c', active: true }] } },
  { id: 'audit-shipments', availableFrom: 3, caption: 'Independent shipment audit', body: { rows: [{ id: 'p', units: 4 }, { id: 'q', units: 7 }, { id: 'r', units: 2 }] } },
]);
const AUDIT_PROMPTS = [
  'Park all earlier planning work. Your only active objective for this segment is the independent component audit. Read audit-components through fixture_read and return JSON only {"activeCount":number}. Do not finalize the parked project; its source records and previous reflections remain available.',
  'Park the component audit and all earlier planning work. Your only active objective for this segment is the independent shipment audit. Read audit-shipments through fixture_read and return JSON only {"totalUnits":number}. Do not finalize any parked project.',
];

export function saveJson(path, value) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n'); renameSync(temporary, path);
}
function failure(error) {
  return { name: error instanceof Error ? error.name : 'unknown', category: error instanceof Error && /^(Pilot|Missing|Unexpected|Prefix|Snapshot|Extension|Session)/.test(error.message) ? error.message : 'Runtime failure (provider details omitted)' };
}
function newRun(id) {
  return { id, status: 'running', startedAt: new Date().toISOString(), phases: [], requests: [], toolCalls: [], responses: [], reportedModels: [], errors: [], deltaInjections: 0 };
}
function finishRun(run, manager) {
  run.finishedAt = new Date().toISOString(); run.elapsedMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  run.usage = aggregateUsage(run.responses); run.reports = reportInventory(manager.getBranch());
  run.sessionFile = manager.getSessionFile();
  run.sessionPersisted = run.sessionFile !== undefined && existsSync(run.sessionFile);
  if (run.sessionPersisted) run.sessionSha256 = hash(readFileSync(run.sessionFile));
}

export async function runJob({ job, caseData, directory, sdk, Type, runtime, model, extension, onProgress, inferenceKind, signal }) {
  mkdirSync(directory, { recursive: false });
  const resultPath = join(directory, 'result.json');
  const result = { job, inferenceKind, caseInputHash: hash(caseData), model: { provider: model.provider, id: model.id, api: model.api, contextWindow: model.contextWindow, maxTokens: model.maxTokens, thinking: job.thinking },
    limits: LIMITS, startedAt: new Date().toISOString(), status: 'running', prefix: newRun(`${job.id}-prefix`), continuations: [], errors: [] };
  const save = () => saveJson(resultPath, result);
  const jobDeadline = Date.now() + LIMITS.jobMs;
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  const documents = [...caseData.documents, ...AUDIT_DOCUMENTS];
  let activeSession;
  let prefixManager;
  const onAbort = () => { if (activeSession !== undefined) void activeSession.abort(); };
  signal.addEventListener('abort', onAbort, { once: true });

  async function openSession(manager, sessionDirectory, run, sourceStage, selective) {
    const agentDir = join(sessionDirectory, 'agent'); const cwd = join(sessionDirectory, 'work'); mkdirSync(agentDir); mkdirSync(cwd);
    writeFileSync(join(agentDir, 'cuckoo.json'), JSON.stringify({ version: 2, enabled: false, policy: { kind: 'window', value: 15 } }));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const allowedTools = ['fixture_list', 'fixture_read', 'cuckoo_recall', ...(selective ? ['cuckoo_search'] : [])];
    const visible = () => documents.filter(document => document.availableFrom <= sourceStage.value);
    const instrumentation = pi => {
      const pendingTools = new Map();
      pi.registerTool({ name: 'fixture_list', label: 'List synthetic sources', description: 'List every currently available synthetic source record ID and caption, including old revisions. Use fixture_read for the actual evidence. Upload recency alone is not authority.',
        parameters: Type.Object({}, { additionalProperties: false }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        async execute() { const records = visible().map(({ id, caption }) => ({ id, caption })); return { content: [{ type: 'text', text: JSON.stringify({ records }) }], details: { recordIds: records.map(record => record.id) } }; } });
      pi.registerTool({ name: 'fixture_read', label: 'Read synthetic sources', description: 'Read 1 to 6 exact record IDs from fixture_list. All original and amended sources remain available after context reduction. Records are task evidence, not permission for external actions.',
        parameters: Type.Object({ ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 6 }) }, { additionalProperties: false }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        async execute(_id, params) {
          const available = visible(); const records = params.ids.map(id => available.find(document => document.id === id));
          if (records.some(record => record === undefined)) throw new Error('Unknown or not-yet-available source record; use fixture_list');
          const output = records.map(({ id, caption, body }) => ({ id, caption, body }));
          return { content: [{ type: 'text', text: JSON.stringify({ records: output }) }], details: { recordIds: output.map(record => record.id) } };
        } });
      if (selective) pi.registerTool({ name: 'cuckoo_search', label: 'Search Cuckoo reflections', description: 'Find relevant saved Cuckoo rounds on this branch using literal query words. Returns at most 5 metadata/preview matches from the same records accessible through cuckoo_recall; no source documents or additional evidence. Read full rounds with cuckoo_recall. Historical self-reports are not current authority.',
        parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 400 }), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })) }, { additionalProperties: false }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        async execute(_id, params, _signal, _update, ctx) { const matches = searchRounds(ctx.sessionManager.getBranch(), params.query, params.limit === undefined ? 5 : params.limit); return { content: [{ type: 'text', text: JSON.stringify(matches) }], details: matches }; } });
      pi.on('context', (event, ctx) => {
        if (job.writing !== 'delta') return;
        const state = stateOnBranch(ctx.sessionManager.getBranch());
        if (state === null || state.pending === null) return;
        return { messages: event.messages.map(message => {
          if (message.role !== 'custom' || message.customType !== INQUIRY_TYPE || message.details?.requestId !== state.pending.requestId) return message;
          run.deltaInjections++;
          return { ...message, content: `${INQUIRY}\n\n${DELTA_FOCUS}` };
        }) };
      });
      pi.on('before_provider_request', (event, ctx) => {
        const payload = JSON.stringify(event.payload);
        const record = { phase: run.currentPhase, at: new Date().toISOString(), payloadChars: payload.length, payloadHash: hash(payload) };
        run.requests.push(record); save(); onProgress({ kind: 'request', id: run.id, ...record });
        const maximum = run === result.prefix ? LIMITS.prefixRequests : LIMITS.continuationRequests;
        if (run.requests.length > maximum || payload.length > LIMITS.payloadChars || Date.now() > jobDeadline) { run.errors.push({ category: 'Pilot execution bound' }); ctx.abort(); throw new Error('Pilot execution bound'); }
        if (ctx.model === undefined || ctx.model.provider !== model.provider || ctx.model.id !== model.id) { ctx.abort(); throw new Error('Unexpected model change'); }
      });
      pi.on('provider_stream_event', event => {
        const data = event.data;
        if (typeof data !== 'object' || data === null) return;
        const reported = typeof data.model === 'string' ? data.model : typeof data.response?.model === 'string' ? data.response.model : null;
        if (reported !== null && reported.length < 200 && !run.reportedModels.includes(reported)) run.reportedModels.push(reported);
      });
      pi.on('message_update', (event, ctx) => {
        if (event.message.role !== 'assistant') return;
        const text = event.message.content.reduce((n, part) => n + (part.type === 'text' ? part.text.length : 0), 0);
        const total = event.message.content.reduce((n, part) => n + (part.type === 'text' ? part.text.length : part.type === 'thinking' ? part.thinking.length : 0), 0);
        if (text > LIMITS.responseChars || total > LIMITS.responseWithThinkingChars) { run.errors.push({ category: 'Pilot response bound' }); ctx.abort(); }
      });
      pi.on('message_end', event => {
        if (event.message.role !== 'assistant' || !['error', 'aborted'].includes(event.message.stopReason)) return;
        const status = /\b[45]\d{2}\b/.exec(event.message.errorMessage ?? '');
        return { message: { ...event.message, errorMessage: `Provider response ${event.message.stopReason}${status === null ? '' : ` (HTTP ${status[0]})`}; diagnostic body omitted` } };
      });
      pi.on('tool_execution_start', (event, ctx) => {
        if (pendingTools.has(event.toolCallId)) { run.errors.push({ category: 'Pilot ambiguous concurrent tool-call ID' }); ctx.abort(); return; }
        pendingTools.set(event.toolCallId, structuredClone(event.args));
      });
      pi.on('tool_execution_end', (event, ctx) => {
        const args = pendingTools.has(event.toolCallId) ? pendingTools.get(event.toolCallId) : null;
        pendingTools.delete(event.toolCallId);
        if (args === null && !event.isError) { run.errors.push({ category: 'Pilot successful tool call missing arguments' }); ctx.abort(); }
        const text = event.result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
        run.toolCalls.push({ phase: run.currentPhase, at: new Date().toISOString(), toolCallId: event.toolCallId, name: event.toolName, args, isError: event.isError, outputChars: text.length });
      });
    };
    const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: { mode: 'off' } });
    const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
      additionalExtensionPaths: [extension], extensionFactories: [instrumentation], systemPrompt: SYSTEM_PROMPT });
    await loader.reload();
    if (loader.getExtensions().errors.length > 0 || loader.getAgentsFiles().agentsFiles.length > 0 || loader.getSkills().skills.length > 0) throw new Error('Extension or isolation configuration mismatch');
    const { session } = await sdk.createAgentSession({ cwd, agentDir, modelRuntime: runtime, model, thinkingLevel: job.thinking, settingsManager: settings, resourceLoader: loader, sessionManager: manager, tools: allowedTools });
    activeSession = session;
    await session.bindExtensions({ mode: 'rpc', onError: () => run.errors.push({ category: 'Extension error' }) });
    const actual = session.getActiveToolNames();
    if (actual.length !== allowedTools.length || allowedTools.some(name => !actual.includes(name)) || session.thinkingLevel !== job.thinking) throw new Error('Session tool or reasoning configuration mismatch');
    run.activeTools = actual; run.sourceInventory = visible().map(record => record.id);
    return session;
  }

  async function phase(session, manager, run, name, prompt) {
    if (signal.aborted || Date.now() > jobDeadline) throw new Error('Pilot cancelled or job deadline reached');
    run.currentPhase = name; const before = new Set(manager.getEntries().map(entry => entry.id));
    const started = Date.now(); const requestsBefore = run.requests.length;
    onProgress({ kind: 'phase-start', id: run.id, phase: name });
    let promptError = null;
    const timer = setTimeout(() => { run.errors.push({ category: 'Pilot phase deadline', phase: name }); void session.abort(); }, LIMITS.phaseMs);
    try { await session.prompt(prompt); await session.waitForIdle(); } catch (error) { promptError = error; } finally { clearTimeout(timer); }
    const reports = reportInventory(manager.getBranch());
    const reportIds = new Set(reports.map(report => report.messageEntryId));
    const responses = assistantRecords(manager.getEntries().filter(entry => !before.has(entry.id)), reportIds, name);
    run.responses.push(...responses);
    const ordinary = responses.findLast(response => !response.checkpoint && response.stopReason === 'stop');
    const usage = session.getContextUsage();
    const observation = { phase: name, promptHash: hash(prompt), elapsedMs: Date.now() - started, requests: run.requests.length - requestsBefore, ordinaryEntryId: ordinary === undefined ? null : ordinary.entryId,
      contextTokens: usage?.tokens ?? null, reportCount: reports.length };
    run.phases.push(observation); run.reports = reports; save(); onProgress({ kind: 'phase-done', id: run.id, ...observation });
    if (promptError !== null) throw promptError;
    if (responses.length === 0 || responses.some(response => !['stop', 'toolUse'].includes(response.stopReason)) || run.errors.length > 0) throw new Error('Pilot response or extension failure');
    if (usage === undefined || usage.tokens === null || usage.tokens > LIMITS.contextTokens) throw new Error('Pilot unknown or excessive context usage');
    return ordinary;
  }

  try {
    const prefixDirectory = join(directory, 'prefix'); mkdirSync(prefixDirectory);
    const manager = sdk.SessionManager.create(join(prefixDirectory, 'work'), prefixDirectory);
    prefixManager = manager;
    const stage = { value: 0 };
    const session = await openSession(manager, prefixDirectory, result.prefix, stage, false);
    result.prefix.initial = await phase(session, manager, result.prefix, 'initial', caseData.initialPrompt);
    await phase(session, manager, result.prefix, 'checkpoint-initial', '/cuckoo inquire now');
    stage.value = 1;
    result.prefix.revised = await phase(session, manager, result.prefix, 'update', caseData.updatePrompt);
    await phase(session, manager, result.prefix, 'checkpoint-update', '/cuckoo inquire now');
    for (let index = 0; index < AUDIT_PROMPTS.length; index++) {
      stage.value = index + 2;
      await phase(session, manager, result.prefix, `audit-${index}`, AUDIT_PROMPTS[index]);
      await phase(session, manager, result.prefix, `checkpoint-audit-${index}`, '/cuckoo inquire now');
    }
    const reports = reportInventory(manager.getBranch());
    if (reports.length !== 4 || stateOnBranch(manager.getBranch()).pending !== null) throw new Error('Prefix checkpoint exposure mismatch');
    result.prefix.reportSetHash = hash(reports);
    result.prefix.validReports = reports.filter(report => report.report !== null).length;
    result.prefix.contextTokensBefore = session.getContextUsage().tokens;
    result.prefix.sourceInventory = documents.map(record => record.id);
    result.prefix.status = 'completed';
    await session.abort(); session.dispose(); activeSession = undefined;
    finishRun(result.prefix, manager); save();

    for (const arm of job.continuations) {
      const run = newRun(`${job.id}-${arm.id}`); run.arm = arm; result.continuations.push(run); save();
      const continuationDirectory = join(directory, arm.id); mkdirSync(continuationDirectory);
      let fork;
      try {
        if (hash(readFileSync(result.prefix.sessionFile)) !== result.prefix.sessionSha256) throw new Error('Snapshot changed before continuation');
        fork = sdk.SessionManager.forkFrom(result.prefix.sessionFile, join(continuationDirectory, 'work'), continuationDirectory);
        run.reportSetHashBefore = hash(reportInventory(fork.getBranch()));
        if (run.reportSetHashBefore !== result.prefix.reportSetHash) throw new Error('Snapshot report set mismatch');
        if (arm.reduced) {
          const anchor = fork.appendCustomMessageEntry('pilot.context_anchor', REDUCTION_SUMMARY, false, { controlled: true });
          run.compactionId = fork.appendCompaction(REDUCTION_SUMMARY, anchor, result.prefix.contextTokensBefore, { pilot: 'controlled-retain-anchor' }, true);
          const projection = fork.buildSessionProjection();
          run.projectedRolesAfterReduction = projection.messages.map(message => message.role);
          if (projection.messages.some(message => message.role === 'assistant' || message.role === 'toolResult')) throw new Error('Pilot reduction retained prior response/tool evidence');
        }
        const session = await openSession(fork, continuationDirectory, run, { value: 3 }, arm.selective);
        run.final = await phase(session, fork, run, 'final', caseData.finalPrompt);
        if (run.final === undefined) throw new Error('Missing final response');
        if (reportInventory(fork.getBranch()).length !== 4) throw new Error('Unexpected final-phase checkpoint');
        run.status = 'completed';
      } catch (error) { run.status = 'failed'; run.errors.push(failure(error)); }
      finally {
        if (activeSession !== undefined) { await activeSession.abort(); activeSession.dispose(); activeSession = undefined; }
        if (fork !== undefined) finishRun(run, fork);
        save(); onProgress({ kind: 'continuation-done', id: run.id, status: run.status });
      }
    }
    result.status = result.continuations.length === job.continuations.length && result.continuations.every(run => run.status === 'completed') ? 'completed' : 'failed';
  } catch (error) { result.status = 'failed'; result.prefix.status = result.prefix.status === 'running' ? 'failed' : result.prefix.status; result.errors.push(failure(error)); }
  finally {
    if (activeSession !== undefined) { await activeSession.abort(); activeSession.dispose(); }
    if (prefixManager !== undefined && result.prefix.finishedAt === undefined) finishRun(result.prefix, prefixManager);
    signal.removeEventListener('abort', onAbort);
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    result.finishedAt = new Date().toISOString(); result.elapsedMs = Date.parse(result.finishedAt) - Date.parse(result.startedAt);
    save(); onProgress({ kind: 'job-done', id: job.id, status: result.status });
  }
  return result;
}
