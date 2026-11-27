// Live-model pilot of Cuckoo's numbered record; see README.md for the protocol. One process runs one cell:
//   checkpoint-visible    a seeded record (8 objectives, 25 rules) and a seeded conversation that changes it; two real
//                         inquiries. Measures whether replies validate and whether each ID names the entry it was given to.
//   checkpoint-compacted  the same, with the seeded numbered exchange absent from model context (as after a compaction).
//   tools-only            live user turns, only Cuckoo's two tools declared; then one inquiry.
//   tools-builtins        the same with Pi's default built-in tools declared as in a working session; their execution
//                         is blocked and recorded, so nothing runs on the host.
// Usage: PI_SDK_ROOT=... GATEWAY_EXTENSION=.../index.ts node pilot.mjs LABEL EXTENSION_DIR OUTPUT_DIR REPS MODEL THINKING CELL
// Bounds are execution controls: 6 concurrent sessions; per session 3 (checkpoint) or 30 (tools) provider requests and 600 s.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHECKPOINT_SCENARIO, RECORD, TOOL_SCENARIOS } from './scenarios.mjs';

const [label, extensionArgument, outputArgument, repsArgument, modelArgument, thinkingArgument, cell] = process.argv.slice(2);
if ([label, extensionArgument, outputArgument, repsArgument, modelArgument, thinkingArgument, cell].includes(undefined) || process.env.PI_SDK_ROOT === undefined || process.env.GATEWAY_EXTENSION === undefined) {
  throw new Error('Usage: PI_SDK_ROOT=... GATEWAY_EXTENSION=... node pilot.mjs LABEL EXTENSION_DIR OUTPUT_DIR REPS MODEL THINKING CELL');
}
const CELLS = { 'checkpoint-visible': { kind: 'checkpoint', variant: 'visible', toolset: 'cuckoo' }, 'checkpoint-compacted': { kind: 'checkpoint', variant: 'compacted', toolset: 'cuckoo' },
  'tools-only': { kind: 'tools', variant: null, toolset: 'cuckoo' }, 'tools-builtins': { kind: 'tools', variant: null, toolset: 'builtins' } };
if (!Object.hasOwn(CELLS, cell)) throw new Error(`CELL is one of ${Object.keys(CELLS).join(', ')}`);
const { kind, variant, toolset } = CELLS[cell];
const BUILTIN_TOOLS = ['bash', 'edit', 'read', 'write'], CUCKOO_TOOLS = ['cuckoo_recall', 'cuckoo_update'];
const EXPECTED_TOOLS = (toolset === 'builtins' ? [...BUILTIN_TOOLS, ...CUCKOO_TOOLS] : CUCKOO_TOOLS).sort().join(',');
// DRY=1: build every session and stop each provider request before it is sent; the requests are checked and written
// like those of a real run. No model is called. This is the canary of the request shape.
const DRY = process.env.DRY === '1';
const PROVIDER = 'ai-gateway-anthropic', API = 'ai-gateway-anthropic-messages';
const MODEL = modelArgument, thinking = thinkingArgument;
const reps = Number(repsArgument); if (!Number.isSafeInteger(reps) || reps < 1) throw new Error('REPS must be a positive integer');
const CONCURRENCY = 6, SESSION_DEADLINE_MS = 600000;
const MAX_REQUESTS = { checkpoint: 3, tools: 30 };
const extensionDir = resolve(extensionArgument); const output = resolve(outputArgument, label); mkdirSync(output, { recursive: true });
const sdk = await import(pathToFileURL(join(process.env.PI_SDK_ROOT, 'dist/index.js')).href);
const ext = path => import(pathToFileURL(join(extensionDir, path)).href);
const { capturedCheckpoint, REPORT_TYPE } = await ext('src/report.ts');
const { currentSet, knownIds, nextNumbers, EDIT_TYPE } = await ext('src/current.ts');
const { inquiryText, EMPTY_RECORD, INQUIRY_TYPE, STATE_TYPE } = await ext('src/state.ts');
const hash = text => createHash('sha256').update(text).digest('hex');
const sources = Object.fromEntries(['src/state.ts', 'src/recall.ts', 'src/update.ts', 'src/current.ts', 'src/report.ts', 'index.ts'].map(path => [path, hash(readFileSync(join(extensionDir, path)))]));
// The subject's working directory is in its system prompt: a fresh directory whose path names neither the cell nor the pilot.
const workRoot = mkdtempSync(join(tmpdir(), 'w-'));
const DISCLOSING = /pilot|cuckoo-ledger|checkpoint|compacted|visible|tools-|fable|haiku|scenario/i;
/** The text blocks of the system prompt of a provider payload. */
const systemText = payload => typeof payload.system === 'string' ? payload.system : payload.system.map(block => block.text ?? '').join('\n');

const agentDir = mkdtempSync(join(tmpdir(), 'cuckoo-record-pilot-'));
// Automatic mode on, so that cuckoo_update is declared as in real use; the policy never comes due within a session.
writeFileSync(join(agentDir, 'cuckoo.json'), JSON.stringify({ version: 2, enabled: true, policy: { kind: 'tokens', value: 100000000 } }));
process.env.PI_CODING_AGENT_DIR = agentDir;
const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/**
 * A session as it stands after a first numbered checkpoint and the conversation that followed: Pi's own leading system
 * message (a real session records one in its first run, and a seeded one without it gets its prompt as a patch after
 * the inquiry), the record as one closed checkpoint written the way the extension writes it, then the conversation.
 */
function seedCheckpoint(manager, head) {
  let stamp = Date.now() - 7200000;
  manager.appendMessage({ ...head, timestamp: stamp });
  const assistant = text => manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text }], api: API, provider: PROVIDER, model: MODEL, usage: zero, stopReason: 'stop', timestamp: stamp += 60000 });
  const user = text => manager.appendMessage({ role: 'user', content: [{ type: 'text', text }], timestamp: stamp += 60000 });
  user('Here is the work for this session. I will add to it as we go.');
  assistant('Understood. I will keep track of the objectives and the rules you give me.');
  const requestId = 'seeded-record';
  const reply = { objectives: RECORD.objectives.map(item => ({ id: null, objective: item.title, progress: item.progress, issues: [], eta: item.eta })),
    rules: RECORD.rules.map(item => ({ id: null, rule: item.text, source: item.source, scope: item.scope })) };
  const raw = JSON.stringify(reply);
  const state = { version: 1, baseline: 1000, observed: 1000, model: 'seeded', resuming: false };
  manager.appendCustomEntry(STATE_TYPE, { ...state, pending: { requestId, resume: false, questions: [] } });
  let messageEntryId;
  if (variant === 'visible') {
    manager.appendCustomMessageEntry(INQUIRY_TYPE, inquiryText([], [], EMPTY_RECORD), false, { version: 1, requestId, tokens: 1000 });
    messageEntryId = assistant(raw);
  }
  const value = capturedCheckpoint(requestId, raw, [], knownIds(currentSet(manager.getBranch())), nextNumbers(manager.getEntries()));
  if (value.error !== null) throw new Error(`Seed checkpoint invalid: ${value.error}`);
  manager.appendCustomEntry(REPORT_TYPE, { ...value, ...(messageEntryId === undefined ? {} : { messageEntryId }), content: [{ type: 'text', text: raw }] });
  manager.appendCustomEntry(STATE_TYPE, { ...state, pending: null });
  for (const step of CHECKPOINT_SCENARIO.conversation) { if ('user' in step) user(step.user); else assistant(step.assistant); }
}

const settle = async session => { for (let pass = 0; pass < 3; pass++) { await session.waitForIdle(); await new Promise(done => setTimeout(done, 50)); } };
const reportEntries = manager => manager.getBranch().filter(entry => entry.type === 'custom' && entry.customType === REPORT_TYPE);
/** The current set in a form small enough to save after every step. */
const snapshot = manager => {
  const set = currentSet(manager.getBranch());
  return { objectives: set.objectives.map(item => ({ id: item.id, status: item.status, objective: item.objective, progress: item.progress, issues: item.issues, eta: item.eta, reason: item.reason })),
    rules: set.rules.map(item => ({ id: item.id, status: item.status, rule: item.rule, source: item.source, scope: item.scope, reason: item.reason })) };
};

async function inquire(session, manager, result) {
  const before = reportEntries(manager).length;
  await session.prompt('/cuckoo inquire now'); await settle(session);
  const reports = reportEntries(manager);
  if (reports.length !== before + 1) throw new Error(`Expected one new report, found ${reports.length - before}`);
  const saved = reports.at(-1).data;
  const inquiry = manager.getBranch().findLast(entry => entry.type === 'custom_message' && entry.customType === INQUIRY_TYPE);
  result.rounds.push({ raw: saved.raw, error: saved.error, assigned: saved.assigned, inquiryChars: inquiry.content.length, inquirySha256: hash(inquiry.content), after: snapshot(manager) });
}

/** The text of a payload message: its text blocks joined. */
const messageText = message => typeof message.content === 'string' ? message.content : message.content.map(block => block.text ?? '').join('\n');
/**
 * What the subject was actually sent, checked on every request of a run and reduced to hashes that are equal across
 * the runs of a cell. Throws when a request is not shaped like a request of an ordinary session: the prompt as the
 * leading system prompt, no prompt patch inside the conversation, and each inquiry as the last message of its request.
 */
function payloadProfile(payloads, work) {
  if (DISCLOSING.test(work)) throw new Error(`Working directory discloses the experiment: ${work}`);
  let inquiries = 0;
  payloads.forEach((payload, index) => {
    if (payload.system === undefined) throw new Error(`Request ${index + 1} has no leading system prompt`);
    const patches = payload.messages.filter(message => message.role === 'system' && messageText(message).trim() !== '');
    if (patches.length > 0) throw new Error(`Request ${index + 1} carries a system message inside the conversation: ${messageText(patches[0]).slice(0, 80)}`);
    const spoken = payload.messages.filter(message => message.role !== 'system');
    const asked = spoken.map(messageText).filter(text => text.startsWith('Restate me your objectives'));
    if (asked.length > 1) throw new Error(`Request ${index + 1} carries ${asked.length} open inquiries`);
    if (asked.length === 1) { inquiries++; if (!messageText(spoken.at(-1)).startsWith('Restate me your objectives')) throw new Error(`Request ${index + 1}: the inquiry is not the last message`); }
  });
  const system = systemText(payloads[0]);
  const cwdSection = /<cwd>\n(.*)\n<\/cwd>/.exec(system);
  if (cwdSection === null || cwdSection[1] !== work) throw new Error('The working-directory section of the system prompt is not the directory this run chose');
  const tools = payloads[0].tools.filter(tool => tool.name !== '__pi_deferred_placeholder__');
  return { systemChars: system.length, systemSha256: hash(system.split(work).join('<CWD>')), toolNames: tools.map(tool => tool.name).sort(), toolsSha256: hash(JSON.stringify(tools.map(tool => JSON.stringify(tool)).sort())),
    inquiryRequests: inquiries, ...(kind === 'checkpoint' ? { seededReplyInContext: JSON.stringify(payloads[0].messages).includes('Migrate the billing exporter to the new job queue\\",\\"progress') } : {}) };
}

/** One agent session over `manager` in `work`, with the gateway, the extension under test and `guard`, set to the subject model. */
async function openSession(manager, work, guard, onError, notify) {
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd: work, agentDir, settingsManager: settings, noExtensions: true, disabledBuiltinExtensions: ['mcp'], noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: [process.env.GATEWAY_EXTENSION, join(extensionDir, 'index.ts')], extensionFactories: [guard] });
  await loader.reload();
  if (loader.getExtensions().errors.length > 0) throw new Error(`Extension load failed: ${loader.getExtensions().errors.map(item => String(item.error)).join('; ').slice(0, 400)}`);
  const runtime = await sdk.ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false });
  // `cuckoo`: only Cuckoo's own tools are declared. `builtins`: Pi's default selection (its built-in tools and the extension's).
  const { session } = await sdk.createAgentSession({ cwd: work, agentDir, modelRuntime: runtime, thinkingLevel: thinking, settingsManager: settings, resourceLoader: loader, sessionManager: manager, ...(toolset === 'cuckoo' ? { tools: ['cuckoo_*'] } : {}) });
  await session.bindExtensions({ mode: 'rpc', onError, uiContext: { notify, setWidget() {}, setStatus() {} } });
  const model = runtime.getModel(PROVIDER, MODEL);
  if (model === undefined) throw new Error('Model unavailable');
  if (model.api !== API) throw new Error(`Unexpected model API ${model.api}`);
  await session.setModel(model); session.setThinkingLevel(thinking);
  return session;
}

/**
 * The leading system message Pi records for this configuration and working directory, taken from a throwaway session
 * whose only request is stopped before it is sent. No model is called.
 */
async function leadingSystemMessage(work) {
  const manager = sdk.SessionManager.inMemory();
  const stop = pi => pi.on('before_provider_request', (_event, ctx) => { ctx.abort(); throw new Error('Probe: request not sent'); });
  const session = await openSession(manager, work, stop, () => {}, () => {});
  try { await session.prompt('Probe.'); await settle(session); } finally { await session.abort(); session.dispose(); }
  const entry = manager.getBranch().find(item => item.type === 'message' && item.message.role === 'system');
  if (entry === undefined) throw new Error('Pi recorded no system message for the probe run');
  return structuredClone(entry.message);
}

async function run(scenario, rep) {
  const id = `${cell}-${scenario.id}-${rep}`; const directory = join(output, id); mkdirSync(directory, { recursive: true });
  const work = join(mkdtempSync(join(workRoot, 's-')), 'project'); mkdirSync(work);
  const result = { id, label, cell, kind, scenario: scenario.id, rep, model: MODEL, thinking, variant, toolset, status: 'running', requests: 0, errors: [], notifications: [], rounds: [], turns: [], blockedCalls: [] };
  let session; const payloads = [];
  const guard = pi => {
    pi.on('before_provider_request', (event, ctx) => {
      result.requests++;
      if (DRY) { payloads.push(event.payload); ctx.abort(); throw new Error('Dry run: request not sent'); }
      if (result.requests > MAX_REQUESTS[kind]) { result.errors.push('request bound exceeded'); ctx.abort(); throw new Error('Request bound exceeded'); }
      payloads.push(event.payload);
    });
    // Nothing but Cuckoo's tools runs: a built-in tool is declared for the prompt's sake only.
    pi.on('tool_call', event => {
      if (CUCKOO_TOOLS.includes(event.toolName)) return undefined;
      result.blockedCalls.push({ name: event.toolName, input: event.input });
      return { block: true, reason: 'This tool is not available in this session.' };
    });
  };
  const timer = setTimeout(() => { result.errors.push('session deadline'); if (session !== undefined) void session.abort(); }, SESSION_DEADLINE_MS);
  try {
    const manager = sdk.SessionManager.inMemory();
    if (kind === 'checkpoint') seedCheckpoint(manager, await leadingSystemMessage(work));
    session = await openSession(manager, work, guard, error => result.errors.push(`extension: ${String(error.error ?? error).slice(0, 300)}`), (text, level) => result.notifications.push([level, String(text).slice(0, 300)]));
    result.activeTools = session.getActiveToolNames().sort();
    if (session.model.id !== MODEL || session.thinkingLevel !== thinking || result.activeTools.join(',') !== EXPECTED_TOOLS) throw new Error(`Session configuration mismatch: ${session.model.id} ${session.thinkingLevel} [${result.activeTools}]`);
    if (kind === 'checkpoint') {
      result.seeded = snapshot(manager);
      await inquire(session, manager, result);
      if (result.rounds[0].error === null) await inquire(session, manager, result);
    } else {
      for (const text of scenario.turns) {
        const seen = manager.getBranch().length;
        await session.prompt(text); await settle(session);
        const added = manager.getBranch().slice(seen);
        const calls = added.flatMap(entry => entry.type === 'message' && entry.message.role === 'assistant' ? entry.message.content.filter(part => part.type === 'toolCall').map(part => ({ id: part.id, name: part.name, arguments: part.arguments })) : []);
        const results = new Map(added.flatMap(entry => entry.type === 'message' && entry.message.role === 'toolResult' ? [[entry.message.toolCallId, { isError: entry.message.isError, text: entry.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n').slice(0, 400) }]] : []));
        const answer = added.findLast(entry => entry.type === 'message' && entry.message.role === 'assistant');
        result.turns.push({ user: text, calls: calls.map(call => ({ ...call, result: results.get(call.id) ?? null })), edits: added.filter(entry => entry.type === 'custom' && entry.customType === EDIT_TYPE).length,
          answer: answer === undefined ? null : answer.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n').slice(0, 1200), stopReason: answer === undefined ? null : answer.message.stopReason, after: snapshot(manager) });
      }
      await inquire(session, manager, result);
    }
    // What the subject was actually sent: the system text (its working directory normalised, the only part that differs
    // between runs of a cell) and the tool definitions, hashed so that every run of a cell can be compared with its canary.
    result.profile = payloadProfile(payloads, work);
    if (kind === 'checkpoint' && result.profile.seededReplyInContext !== (variant === 'visible')) throw new Error(`The seeded numbered reply is ${result.profile.seededReplyInContext ? 'in' : 'not in'} model context in the ${variant} variant`);
    writeFileSync(join(directory, 'first-request.json'), JSON.stringify(payloads[0], null, 1));
    writeFileSync(join(directory, 'last-request.json'), JSON.stringify(payloads.at(-1), null, 1));
    result.status = result.rounds.length > 0 && result.rounds.every(round => round.error === null) && (kind !== 'checkpoint' || result.rounds.length === 2) ? 'completed' : 'invalid-report';
  } catch (error) {
    result.status = 'failed'; result.errors.push(error instanceof Error ? error.message.slice(0, 400) : 'unknown failure');
  } finally {
    clearTimeout(timer);
    if (session !== undefined) { await session.abort(); session.dispose(); }
    writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 1));
    console.log(JSON.stringify({ at: new Date().toISOString(), id, status: result.status, requests: result.requests, errors: result.errors }));
  }
  return result;
}

const only = process.env.ONLY === undefined ? null : process.env.ONLY.split(',');
const plan = (kind === 'checkpoint' ? [CHECKPOINT_SCENARIO] : TOOL_SCENARIOS).filter(scenario => only === null || only.includes(scenario.id))
  .flatMap(scenario => Array.from({ length: reps }, (_, rep) => ({ scenario, rep })));
if (plan.length === 0) throw new Error('Nothing selected');
const results = []; let next = 0;
try {
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (next < plan.length) { const item = plan[next++]; results.push(await run(item.scenario, item.rep)); } }));
} finally { rmSync(agentDir, { recursive: true, force: true }); rmSync(workRoot, { recursive: true, force: true }); }
writeFileSync(join(output, 'summary.json'), JSON.stringify({ label, cell, extensionDir, sources, provider: PROVIDER, model: MODEL, thinking, reps, finishedAt: new Date().toISOString(), results }, null, 1));
process.exitCode = results.every(item => item.status === 'completed') ? 0 : 1;
