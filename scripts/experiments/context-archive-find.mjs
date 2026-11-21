#!/usr/bin/env node
/** Opt-in live SDK experiment. preflight discovers the real catalog/auth and binds all six sessions;
 * it does not prompt a model. Run each cohort in its own process and NEW output directory:
 *   export PI_SDK_ROOT=/path/to/pi-monorepo PI_TOKEN_FACTORY_PACKAGE=/path/to/tokenfactory-pi-0.3.0
 *   node scripts/experiments/context-archive-find.mjs preflight NEW_DIR STOCK_INDEX CANDIDATE_INDEX sol
 *   printf '%s\n' deepseek kimi sol | xargs -P3 -I% node scripts/experiments/context-archive-find.mjs run "$OUT/%" "$STOCK" "$CANDIDATE" %
 * STOCK and CANDIDATE are packaged ponygirls-context-archive/index.ts files. $OUT exists; $OUT/% must not.
 * Token Factory: the configured package and its normal API key; Sol: native Pi OAuth + cached models-store
 * (optional PI_PILOT_AUTH_PATH and PI_PILOT_MODELS_STORE). No other extensions, private history or workspace.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';
import { zstdDecompressSync } from 'node:zlib';
import { PREFILL, SYSTEM, SCENARIOS, grade, seed } from './context-archive-find-fixtures.mjs';

const MODELS = { deepseek: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', kimi: 'moonshotai/Kimi-K3.1-Pro', sol: 'gpt-6.2-sol' };
const CODEX = 'https://chatgpt.com/backend-api';
const TOOL = 'context_recall', ARCHIVE = 'ponygirls.context-archive';
const STOCK_ID = 'de18034f52698989d9ee1e3d9c1474bf3446e1e916cef4e5515dfa6ee8adb231'; // 62714e81 index, package.json and src/*.ts
const LIMITS = { catalogMs: 30000, bindMs: 30000, acknowledgementMs: 90000, probeMs: 180000,
  maxProbeRequests: 12, maxProbeToolAttempts: 24, outputTokens: 4096, streamEventBytes: 4 * 1024 * 1024, abortGraceMs: 5000 };
const THRESHOLDS = { highWatermark: 0.001, lowWatermark: 0.0005 }; // force eligibility, not smaller model capacity
const ISOLATED = { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
  systemPrompt: SYSTEM, appendSystemPrompt: [] };
const TOKENS = ['input', 'cacheRead', 'cacheWrite', 'output', 'totalTokens'];
const hash = data => createHash('sha256').update(data).digest('hex');
const jsonHash = obj => hash(JSON.stringify(obj));
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const now = () => new Date().toISOString();
const ms = start => Math.round(performance.now() - start);
const sum = (xs, get) => xs.reduce((n, x) => n + get(x), 0);
const uint = n => Number.isSafeInteger(n) && n >= 0;
function save(file, obj) { writeFileSync(file + '.tmp', JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 }); renameSync(file + '.tmp', file); }
// Never serialize exceptions/headers/reasoning. Fault contains only a fixed diagnostic.
class Fault extends Error { constructor(code, kind = 'invalid') { super(code); this.kind = kind; } }
function check(ok, code, kind) { if (!ok) throw new Fault(code, kind); }
const fault = e => e instanceof Fault ? e : new Fault('runtime-exception', 'error');
function sourceId(index) {
  check(basename(index) === 'index.ts', 'expected-packaged-index.ts');
  const dir = dirname(index), paths = ['index.ts', 'package.json', ...readdirSync(join(dir, 'src')).filter(f => f.endsWith('.ts')).sort().map(f => `src/${f}`)];
  return jsonHash(Object.fromEntries(paths.map(p => [p, hash(readFileSync(join(dir, p)))])));
}

// Use Pi's own native auth/catalog for Sol; load ONLY the configured Token Factory provider factory
// under Pi's peer resolver. Its UI/hooks and ambient models.json never enter the sessions.
async function provider(sdk, cohort, configuredDir, scratch, catalog) {
  const sol = cohort === 'sol', id = MODELS[cohort]; let name = 'openai-codex', base = CODEX;
  const signal = AbortSignal.timeout(LIMITS.catalogMs);
  const opts = sol ? { authPath: process.env.PI_PILOT_AUTH_PATH ?? join(configuredDir, 'auth.json'),
    modelsStorePath: process.env.PI_PILOT_MODELS_STORE ?? join(configuredDir, 'models-store.json') } : { authPath: join(scratch, 'auth.json') };
  const runtime = await sdk.ModelRuntime.create({ ...opts, modelsPath: join(scratch, 'models.json'), allowModelNetwork: false, refreshOnCreate: false, signal });
  if (sol) {
    const cached = readJson(opts.modelsStorePath)[name]?.models?.find(m => m.id === id);
    check(cached?.contextWindow > 0, 'sol-missing-from-cached-catalog', 'error');
    await runtime.refresh({ allowNetwork: false, providers: [name], signal });
    catalog.source = 'configured Pi offline models-store';
  } else {
    const dir = process.env.PI_TOKEN_FACTORY_PACKAGE, pkg = dir && readJson(join(dir, 'package.json'));
    check(pkg?.name === 'tokenfactory-pi' && pkg.version === '0.3.0', 'set-configured-PI_TOKEN_FACTORY_PACKAGE-0.3.0', 'error');
    const packageHash = jsonHash(['package.json', 'dist/index.js', 'dist/model-overrides.js'].map(f => hash(readFileSync(join(dir, f)))));
    check(packageHash === '844d65e7ce5fdffee367a3919ba2b4d7e7e29d13185677772743e3ac94a16891', 'unexpected-provider-package-code', 'error');
    const loader = new sdk.DefaultResourceLoader({ ...ISOLATED, cwd: scratch, agentDir: scratch, settingsManager: sdk.SettingsManager.inMemory(),
      additionalExtensionPaths: [join(dir, 'dist/index.js')] });
    const fetchOriginal = globalThis.fetch, warn = console.warn;
    globalThis.fetch = async (url, init) => {
      const u = new URL(url); check(u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash && u.pathname === '/v1/models' &&
        u.search === '?verbose=true' && (init?.method ?? 'GET') === 'GET', 'unexpected-catalog-request');
      base = `${u.origin}/v1`; const res = await fetchOriginal(url, { ...init, signal, redirect: 'error' }); catalog.httpStatus = res.status; return res;
    };
    console.warn = () => {}; // discovery may warn with a raw provider error body; report only the status below
    try { await loader.reload(); } finally { globalThis.fetch = fetchOriginal; console.warn = warn; }
    const { errors, runtime: registrations } = loader.getExtensions();
    const [r] = registrations.pendingProviderRegistrations;
    check(!errors.length && registrations.pendingProviderRegistrations.length === 1 && typeof r.name === 'string' && r.name.length > 0 &&
      r.config.api === 'openai-completions' && r.config.baseUrl === base && catalog.httpStatus === 200, 'tokenfactory-discovery-unavailable', 'error');
    name = r.name;
    const model = r.config.models.find(m => m.id === id); check(model, 'non-dedicated-model-not-found', 'error');
    runtime.registerProvider(name, { ...r.config, models: [model] });
    catalog.source = 'tokenfactory-pi@0.3.0 live /models?verbose=true';
  }
  const model = runtime.getModel(name, id), auth = await runtime.checkAuth(name, { signal });
  check(model?.provider === name && model.id === id && model.api === (sol ? 'openai-codex-responses' : 'openai-completions') &&
    model.baseUrl === base && model.contextWindow > 0, 'model-or-endpoint-mismatch', 'error');
  check(auth?.type === (sol ? 'oauth' : 'api_key'), 'required-auth-unavailable', 'error');
  Object.assign(catalog, { at: now(), provider: name, id, api: model.api, baseUrl: model.baseUrl, authType: auth.type,
    contextWindow: model.contextWindow, maxTokens: model.maxTokens, costPerMillion: model.cost });
  return { runtime, model };
}

function text(content) {
  if (typeof content === 'string') return content;
  check(Array.isArray(content) && content.every(b => ['text', 'input_text'].includes(b.type) && typeof b.text === 'string'), 'non-text-input');
  return content.map(b => b.text).join('\n');
}
function seedSession(sdk, cwd, model, scenario) {
  const messages = seed(scenario, model), entries = messages.map((message, i) => ({ type: 'message', message,
    timestamp: new Date(message.timestamp).toISOString(), id: (i + 1).toString(16).padStart(8, '0'), parentId: i ? i.toString(16).padStart(8, '0') : null }));
  const sources = entries.filter(e => e.message.role === 'toolResult').map(e => ({ ...e, raw: JSON.stringify(e.message),
    digest: jsonHash(e.message), text: text(e.message.content), callId: e.message.toolCallId }));
  check(sources.length === 3 && same(sources.map(s => s.text), scenario.records) && sources.every(s => !s.message.isError && s.text.length >= 4096 && s.message.toolName !== TOOL), 'wrong-seeded-targets');
  const recent = messages.slice(messages.indexOf(sources.at(-1).message) + 1), recentTokens = sum(recent, m => sdk.estimateTokens(m));
  check(recentTokens >= 16000 && recent.filter(m => m.role === 'assistant').length >= 6, 'ineligible-seeded-suffix');
  return { manager: sdk.SessionManager.inMemory(cwd, undefined, entries), sources, users: messages.filter(m => m.role === 'user').map(m => text(m.content)),
    seedInfo: { historySha256: jsonHash(entries), messagesSha256: jsonHash(messages), recentTokens, originals: sources.map(s => ({ entryId: s.id, sha256: s.digest, textChars: s.text.length, jsonChars: s.raw.length })) } };
}

// Hash the complete persisted record and projected message; compare both to stock across sessions.
// Before prefill (all arms) and throughout OFF there must be neither a record nor an edit.
function projection(manager, sources, archived) {
  const branch = manager.getBranch(), records = branch.filter(e => e.type === 'custom' && e.customType === ARCHIVE), edits = branch.filter(e => e.type === 'context_edit');
  const count = archived ? 3 : 0, projected = manager.buildSessionProjection().entries;
  check(records.length === count && edits.length === count && !branch.some(e => e.type === 'compaction'), 'wrong-archive-or-compaction-count');
  return sources.map(s => {
    const p = projected.find(e => e.sourceEntry.id === s.id), r = records.find(e => e.data?.entryId === s.id)?.data;
    check(p?.messages.length === 1 && jsonHash(p.sourceEntry.message) === s.digest, 'missing-or-mutated-original');
    const m = p.messages[0], t = text(m.content);
    if (archived) {
      const edit = edits.find(e => e.targetId === s.id);
      check(r?.version === 1 && r.sha256 === s.digest && r.selection?.kind === 'result' && same(edit?.replacement?.content, m.content) &&
        same(m, { ...s.message, content: m.content }) && t.startsWith(`[Context archived: entryId=${s.id} sha256=${s.digest}.`) && t.includes('action=read') && !t.includes(s.text), 'wrong-v1-stub');
    } else check(jsonHash(m) === s.digest, 'off-not-full-original');
    return { entryId: s.id, sha256: s.digest, manifestSha256: r ? jsonHash(r) : null, projectedSha256: jsonHash(m), textSha256: hash(t), chars: t.length };
  });
}

// Known literal verifier for these three single-text synthetic records, independent of candidate code.
// Check the requested occurrence, exact escaped JSON address, cursor and no-hit result, not merely the substring.
function verifyResult(call, args, value, sources) {
  const { action, offset = 0, limit = { list: 10, read: 8000, find: 4 }[action] } = args;
  check(uint(offset) && uint(limit) && limit >= 1 && limit <= ({ list: 20, read: 12000, find: 8 })[action] && typeof value.warning === 'string' && value.warning.length > 0, 'success-on-invalid-range-or-missing-warning');
  const address = (s, hit) => s && s.id === hit.entryId && s.digest === hit.sha256;
  check(value.nextOffset === null || uint(value.nextOffset), 'invalid-result-cursor');
  Object.assign(call, { offset, limit, nextOffset: value.nextOffset });
  if (action === 'read') {
    const s = sources.find(s => s.id === args.entryId), end = Math.min(offset + limit, s?.raw.length);
    check(address(s, args) && address(s, value) && offset < end && value.totalChars === s.raw.length &&
      value.nextOffset === (end < s.raw.length ? end : null) && value.payload === s.raw.slice(offset, end), 'non-original-read-page');
    Object.assign(call, { entryId: s.id, readChars: value.payload.length, evidenceChars: value.payload.length });
  } else if (action === 'list') {
    const page = sources.slice(offset, offset + limit), next = offset + page.length;
    check(offset <= sources.length && value.total === sources.length && value.nextOffset === (next < sources.length ? next : null) && value.items?.length === page.length &&
      page.every((s, i) => { const item = value.items[i]; return address(s, item) && item.active === true && item.kind === 'result' && item.timestamp === s.timestamp; }), 'wrong-list-page');
    call.items = page.map(s => s.id);
  } else {
    const q = args.query; check(action === 'find' && typeof q === 'string' && q.trim() && q.length <= 128 && Array.isArray(value.matches), 'invalid-find-success');
    let total = 0; const spans = [];
    for (const s of sources) {
      for (let i = s.text.indexOf(q); i >= 0; i = s.text.indexOf(q, i + q.length)) {
        if (total >= offset && total < offset + limit) {
          const hit = value.matches[spans.length];
          check(hit && address(s, hit) && uint(hit.readOffset) && uint(hit.readLimit) && hit.readLimit > 0 && hit.readLimit <= 12000 &&
            hit.readOffset + hit.readLimit <= s.raw.length && typeof hit.excerpt === 'string' && hit.excerpt.includes(q), 'invalid-find-hit');
          const fragment = s.raw.slice(hit.readOffset, hit.readOffset + hit.readLimit);
          const rawStart = s.raw.indexOf(JSON.stringify(s.text)) + 1 + JSON.stringify(s.text.slice(0, i)).length - 2;
          check(JSON.stringify(hit.excerpt).slice(1, -1) === fragment && hit.readOffset <= rawStart && rawStart + JSON.stringify(q).length - 2 <= hit.readOffset + hit.readLimit, 'wrong-find-span');
          spans.push({ entryId: s.id, sha256: s.digest, readOffset: hit.readOffset, readLimit: hit.readLimit, excerptChars: hit.excerpt.length });
        }
        total++;
      }
    }
    const next = offset + spans.length;
    check(value.matches.length === spans.length && value.nextOffset === (next < total ? next : null), 'wrong-find-page-or-false-miss');
    Object.assign(call, { matches: spans, matchCount: spans.length, totalLiteralOccurrences: total, evidenceChars: sum(spans, s => s.excerptChars) });
  }
}

function toolObserver(pi, st) {
  const { row, sources, calls, scenario } = st;
  pi.on('before_agent_start', () => ({ systemPrompt: SYSTEM })); // exclude even SDK date/cwd sections
  const on = (name, f) => pi.on(name, e => { try { f(e); } catch (error) { st.fail(fault(error)); } });
  on('tool_execution_start', e => {
    const phase = st.phase, a = e.args ?? {}, q = a.query;
    check(phase && !calls.has(e.toolCallId), 'unexpected-or-duplicate-call');
    const attempt = { n: row.calls.length + 1, phase: phase.id, request: row.requests.at(-1)?.n, tool: e.toolName === TOOL ? TOOL : 'undeclared',
      action: ['find', 'read', 'list'].includes(a.action) ? a.action : 'unknown', startedAt: now(), status: 'started',
      offset: uint(a.offset) ? a.offset : null, limit: uint(a.limit) ? a.limit : null,
      entryId: sources.find(s => s.id === a.entryId)?.id ?? null, requestedDigestMatched: sources.some(s => s.id === a.entryId && s.digest === a.sha256),
      resultChars: null, evidenceChars: 0, wireDeliveries: 0 };
    if (typeof q === 'string') {
      // Release only short literal substrings of the public fixture or prompt; keep hashes/lengths for other queries.
      const publicText = [...scenario.records, ...scenario.probes.map(p => p.question), SYSTEM];
      Object.assign(attempt, { query: q.length <= 128 && publicText.some(t => t.includes(q)) ? q : null, querySha256: hash(q), queryChars: q.length });
    }
    calls.set(e.toolCallId, { attempt, started: performance.now() }); row.calls.push(attempt);
    check(phase.id !== 'ack', 'ack-attempted-tool');
    check(row.calls.filter(c => c.phase === phase.id).length <= LIMITS.maxProbeToolAttempts, 'tool-attempt-limit', 'stopped');
  });
  on('tool_call', e => {
    // Only fires after SDK argument validation/coercion, before the real extension's execute(). Unknown tools never get here.
    check(e.toolName === TOOL && row.arm !== 'off', 'unexpected-callable-tool');
    calls.get(e.toolCallId).args = e.input;
  });
  on('tool_execution_end', e => {
    const c = calls.get(e.toolCallId), a = c?.attempt;
    check(a?.status === 'started', 'orphan-tool-result');
    const output = text(e.result.content); // model-facing text, NOT details or just the evidence fields
    Object.assign(a, { status: e.isError ? 'error' : 'ok', validatedArgs: !!c.args, durationMs: ms(c.started),
      resultChars: output.length, resultSha256: hash(output) });
    if (e.isError) {
      // Invalid arguments/ranges and guessed digests are genuine model mistakes. A known-valid call that fails isn't a saving.
      const p = c.args, offset = p?.offset ?? 0, s = sources.find(s => s.id === p?.entryId && s.digest === p?.sha256);
      a.unexpectedError = !!p && (p.action === 'list' && offset <= sources.length || p.action === 'read' && s && offset < s.raw.length ||
        p.action === 'find' && typeof p.query === 'string' && !!p.query.trim() && p.query.length <= 128);
      return;
    }
    check(a.tool === TOOL && !!c.args && ['list', 'read', ...(row.arm === 'find' ? ['find'] : [])].includes(c.args.action), 'undeclared-action-succeeded');
    let value; try { value = JSON.parse(output); } catch { throw new Fault('non-json-recall-success'); }
    verifyResult(a, c.args, value, sources);
  });
}

function validateTools(tools, arm) {
  const defs = tools.map(t => t.function ?? t);
  check(arm === 'off' ? defs.length === 0 : defs.length === 1 && defs[0].name === TOOL, 'wrong-declared-tools');
  const actions = (defs[0]?.parameters?.anyOf ?? []).map(s => s.properties?.action?.const).sort();
  check(same(actions, arm === 'off' ? [] : arm === 'stub' ? ['list', 'read'] : ['find', 'list', 'read']), 'wrong-recall-schema');
  return actions;
}

// Inspect the *actual POST body* after the real adapter built it, including Codex SSE zstd. Never save the body.
function wireReceipt(body, model, st) {
  const { sources, row, calls } = st, msgs = body.messages ?? body.input;
  check(body.model === model.id && Array.isArray(msgs) && !body.previous_response_id, 'wrong-wire-model-or-continuation');
  const inline = msgs.flatMap(m => ['additional_tools', 'tool_search_output'].includes(m.type) || m.role === 'system' ? m.tools ?? [] : []);
  const actions = validateTools([...(body.tools ?? []), ...inline], row.arm);
  const systems = msgs.filter(m => ['system', 'developer'].includes(m.role) && m.content !== undefined).map(m => text(m.content));
  if (body.instructions !== undefined) systems.unshift(body.instructions);
  check(same(systems, [SYSTEM]) && same(msgs.filter(m => m.role === 'user').map(m => text(m.content)), st.users), 'wire-private-or-unplanned-prompt');
  const outputs = msgs.filter(m => m.type === 'function_call_output' || m.role === 'tool').map(m => [m.call_id ?? m.tool_call_id, text(m.output ?? m.content)]);
  const byId = new Map(outputs);
  check(byId.size === outputs.length && byId.size === sources.length + calls.size, 'wire-missing-or-extra-tool-results');
  const idOnWire = id => model.provider === 'openai-codex' ? id.split('|')[0] : id;
  for (const [i, s] of sources.entries()) {
    const value = byId.get(idOnWire(s.callId));
    check(typeof value === 'string' && hash(value) === st.projected[i].textSha256, 'wire-original-or-stub-mismatch');
  }
  const deliveries = [];
  for (const [id, { attempt: a }] of calls) {
    const t = byId.get(idOnWire(id));
    check(typeof t === 'string' && hash(t) === a.resultSha256 && t.length === a.resultChars, 'tool-text-changed-before-wire');
    if (a.tool === TOOL) deliveries.push({ call: a.n, chars: t.length, first: !a.wireDeliveries, priorPhase: a.phase !== st.phase.id });
    a.wireDeliveries++;
  }
  return { actions, bodyModel: body.model, wireSha256: jsonHash({ msgs, instructions: body.instructions, tools: body.tools }),
    wireMaxTokens: body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens ?? null,
    sourcePayloadChars: sum(st.projected, p => p.chars), deliveries };
}

// Forward to ModelRuntime.streamSimple; observe its shared .result() promise, never compete for its iterator.
function observe(runtime, model, st) {
  const original = runtime.streamSimple, { row } = st;
  const demand = (ok, code, kind) => { if (!ok) { const f = new Fault(code, kind); st.fail(f); throw f; } };
  runtime.streamSimple = function (selected, context, options = {}) {
    const phase = st.phase;
    demand(!st.error && st.action === 'run' && !!phase, 'unplanned-inference');
    demand(selected.provider === model.provider && selected.id === model.id && selected.baseUrl === model.baseUrl, 'model-changed');
    const count = row.requests.filter(r => r.phase === phase.id).length;
    demand(count < (phase.id === 'ack' ? 1 : LIMITS.maxProbeRequests), 'request-limit', 'stopped');
    demand(count === 0 || row.requests.at(-1)?.toolCalls > 0, 'unrequested-continuation');
    if (phase.id === 'ack') {
      const msgs = context.messages.filter(m => m.role !== 'system');
      demand(msgs.at(-1)?.role === 'user' && text(msgs.at(-1).content) === PREFILL && jsonHash(msgs.slice(0, -1)) === row.seed.messagesSha256, 'sdk-did-not-receive-exact-seed');
    }
    const r = { n: row.requests.length + 1, phase: phase.id, startedAt: now(), posts: 0, httpStatus: null, usage: null, streamEventBytes: 0, reportedModels: [] };
    row.requests.push(r); const start = performance.now();
    const stream = original.call(this, selected, context, { ...options,
      signal: AbortSignal.any([st.controller.signal, ...(options.signal ? [options.signal] : [])]),
      transport: 'sse', disableContinuation: true, maxRetries: 0, maxTokens: Math.min(options.maxTokens ?? Infinity, LIMITS.outputTokens),
      fetch: async (input, init) => {
        const req = new Request(input, init), endpoint = model.provider === 'openai-codex' ? `${CODEX}/codex/responses` : `${model.baseUrl}/chat/completions`;
        demand(!st.error && req.url === endpoint && req.method === 'POST' && r.posts === 0, 'unexpected-http-request');
        try {
          const bytes = Buffer.from(await req.clone().arrayBuffer()), data = req.headers.get('content-encoding') === 'zstd' ? zstdDecompressSync(bytes) : bytes;
          r.payload = wireReceipt(JSON.parse(data.toString('utf8')), model, st); r.httpBodyBytes = bytes.length;
          if (model.api === 'openai-completions') check(r.payload.wireMaxTokens > 0 && r.payload.wireMaxTokens <= LIMITS.outputTokens, 'missing-wire-output-cap');
        } catch (e) { const f = e instanceof Fault ? e : new Fault('unverifiable-http-body'); st.fail(f); throw f; }
        r.posts++; const res = await fetch(req, { redirect: 'error' }); r.httpStatus = res.status; return res;
      },
      onProviderStreamEvent: async (data, m) => {
        r.streamEventBytes += Buffer.byteLength(JSON.stringify(data));
        demand(r.streamEventBytes <= LIMITS.streamEventBytes, 'response-stream-limit', 'stopped');
        const id = data?.response?.model ?? data?.model;
        if (typeof id === 'string' && id && !r.reportedModels.includes(id)) {
          // A dated snapshot of the named model is not a different model. Do not credit an explicit substitution.
          const match = id === model.id || (id.startsWith(model.id + '-') && /^\d{4}-\d\d-\d\d$/.test(id.slice(model.id.length + 1)));
          r.reportedModels.push(match ? id : `unexpected-sha256:${hash(id)}`); demand(match, 'different-upstream-model');
        }
        await options.onProviderStreamEvent?.(data, m);
      },
    });
    st.observations.push(stream.result().then(m => {
      r.durationMs = ms(start); r.stopReason = m.stopReason; r.sdkModelMatched = m.provider === model.provider && m.model === model.id;
      r.toolCalls = m.content.filter(b => b.type === 'toolCall').length;
      const u = m.usage;
      if (u && TOKENS.every(k => uint(u[k])) && u.totalTokens > 0) r.usage = { ...Object.fromEntries(TOKENS.map(k => [k, u[k]])),
        reasoning: u.reasoning ?? null, sdkCostUsd: Number.isFinite(u.cost?.total) ? u.cost.total : null };
      if (m.stopReason === 'error') st.fail(new Fault('provider-error', 'error'));
      else if (['aborted', 'length'].includes(m.stopReason)) st.fail(new Fault(`provider-${m.stopReason}`, 'stopped'));
      else if (!['stop', 'toolUse'].includes(m.stopReason) || !r.usage || !r.sdkModelMatched || r.posts !== 1 || !(r.httpStatus >= 200 && r.httpStatus < 300)) st.fail(new Fault('incomplete-provider-receipt'));
    }).catch(() => st.fail(new Fault('unobserved-stream', 'error'))));
    return stream;
  };
  return () => { runtime.streamSimple = original; };
}

function metrics(requests, calls) {
  const recalls = calls.filter(c => c.tool === TOOL), delivered = requests.flatMap(r => r.payload?.deliveries ?? []), first = delivered.filter(d => d.first);
  return { requests: requests.length, posts: sum(requests, r => r.posts),
    usage: requests.length && requests.every(r => r.usage) ? Object.fromEntries([...TOKENS, 'reasoning', 'sdkCostUsd'].map(k => [k,
      requests.every(r => r.usage[k] !== null) ? sum(requests, r => r.usage[k]) : null])) : null,
    attempts: recalls.length, results: recalls.filter(c => c.resultChars !== null).length, errors: recalls.filter(c => c.status === 'error').length,
    undeclaredAttempts: calls.filter(c => c.tool !== TOOL).length, resultChars: sum(recalls, c => c.resultChars ?? 0), evidenceChars: sum(recalls, c => c.evidenceChars),
    wireFirstDeliveries: first.length, wireFirstChars: sum(first, d => d.chars), wireReplays: delivered.length - first.length,
    wireReplayChars: sum(delivered.filter(d => !d.first), d => d.chars), wirePriorPhaseChars: sum(delivered.filter(d => d.priorPhase), d => d.chars),
    wireAllRecallResultChars: sum(delivered, d => d.chars) };
}

async function runSession({ sdk, action, out, scratch, ext, cohort, model, runtime, scenario, arm }) {
  const label = `${cohort}-${scenario.id}-${arm}`, dir = join(scratch, label), cwd = join(dir, 'empty');
  mkdirSync(cwd, { recursive: true }); process.env.PI_CODING_AGENT_DIR = dir;
  const settings = { version: 3, enabled: arm !== 'off', thresholds: THRESHOLDS }; save(join(dir, 'context-archive.json'), settings);
  const { manager, sources, users, seedInfo } = seedSession(sdk, cwd, model, scenario);
  const prompts = [{ id: 'ack', question: PREFILL }, ...scenario.probes], started = performance.now();
  const row = { label, cohort, provider: model.provider, model: model.id, scenario: scenario.id, arm, settings, startedAt: now(), status: 'running',
    seed: seedInfo, phases: prompts.map(p => ({ id: p.id, questionSha256: hash(p.question), status: 'not-run' })), requests: [], calls: [] };
  let session, deadline, hardStop, phaseStart, interrupted;
  const persist = () => save(join(out, label + '.json'), row);
  const st = { row, action, scenario, sources, users, calls: new Map(), observations: [], controller: new AbortController(),
    fail(f) { if (!st.error) {
      st.error = f; row.status = f.kind; row.error = f.message;
      if (st.phase) { st.phase.status = f.kind; st.phase.durationMs = ms(phaseStart); }
      persist(); st.controller.abort(); void session?.abort().catch(() => {});
      hardStop = setTimeout(() => { row.hardStop = true; persist(); process.exit(2); }, LIMITS.abortGraceMs);
    } },
    healthy() { if (st.error) throw st.error; },
  };
  const timeout = (millis, name) => { clearTimeout(deadline); deadline = setTimeout(() => st.fail(new Fault(name, 'stopped')), millis); };
  const onSignal = () => { interrupted = true; st.fail(new Fault('interrupted', 'stopped')); };
  process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal);
  const undo = observe(runtime, model, st); persist(); timeout(LIMITS.bindMs, 'bind-deadline');
  try {
    const sm = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, cacheWarming: 'off' });
    const loader = new sdk.DefaultResourceLoader({ ...ISOLATED, cwd, agentDir: dir, settingsManager: sm, additionalExtensionPaths: [ext], extensionFactories: [pi => toolObserver(pi, st)] });
    await loader.reload(); const loaded = loader.getExtensions();
    check(!loaded.errors.length && loaded.extensions.length === 2 && !loader.getAgentsFiles().agentsFiles.length, 'isolated-extension-load', 'error');
    // Give the real stock extension the same allowlist in OFF. Its disabled setting must hide the tool itself.
    const created = await sdk.createAgentSession({ cwd, agentDir: dir, modelRuntime: runtime, model, thinkingLevel: 'off',
      sessionManager: manager, resourceLoader: loader, settingsManager: sm, tools: [TOOL] });
    session = created.session; check(!created.modelFallbackMessage && session.model?.id === model.id && session.model.provider === model.provider, 'sdk-model-fallback');
    await session.bindExtensions({ mode: 'rpc', onError: () => st.fail(new Fault('extension-error', 'error')) }); st.healthy();
    const active = session.getActiveToolNames(); check(same(active, arm === 'off' ? [] : [TOOL]) && same(session.getCallableToolNames(), active), 'unexpected-active-or-callable-tool');
    const defs = session.getAllTools().filter(t => active.includes(t.name));
    row.actions = validateTools(defs, arm); row.thinkingLevel = session.thinkingLevel;
    if (defs.length) row.listReadSchemaSha256 = jsonHash(defs[0].parameters.anyOf.filter(s => s.properties.action.const !== 'find'));
    st.projected = projection(manager, sources, false); row.bindMs = ms(started); st.healthy();
    if (action === 'preflight') { row.status = 'preflight-only'; return row; }
    for (const [i, { question }] of prompts.entries()) {
      const phase = row.phases[i]; st.phase = phase; phaseStart = performance.now(); phase.status = 'running'; phase.startedAt = now(); st.users.push(question);
      timeout(i ? LIMITS.probeMs : LIMITS.acknowledgementMs, i ? 'probe-deadline' : 'acknowledgement-deadline'); persist();
      await session.prompt(question); phase.promptWallMs = ms(phaseStart); await Promise.all(st.observations); st.healthy();
      const reqs = row.requests.filter(r => r.phase === phase.id), calls = row.calls.filter(c => c.phase === phase.id);
      check(reqs.at(-1)?.stopReason === 'stop' && calls.length === sum(reqs, r => r.toolCalls) && calls.every(c => c.status !== 'started' && c.wireDeliveries > 0), 'incomplete-phase');
      const answer = session.getLastAssistantText() ?? ''; phase.answerSha256 = hash(answer);
      const after = projection(manager, sources, arm !== 'off');
      if (!i) {
        check(answer.trim() === 'READY' && !calls.length, 'nonneutral-acknowledgement');
        st.projected = after; row.afterAck = after;
      } else {
        check(same(after, row.afterAck), 'unstable-archive');
        phase.score = grade(scenario.id, phase.id, answer); // never branch on correctness
      }
      phase.status = 'completed'; phase.metrics = metrics(reqs, calls); phase.cumulative = metrics(row.requests, row.calls);
      phase.durationMs = ms(phaseStart); phase.cumulativeWallMs = ms(started); persist();
    }
    st.phase = null; check(!row.calls.some(a => a.unexpectedError), 'known-valid-recall-returned-error');
    row.status = 'completed';
  } catch (e) { st.fail(fault(e)); }
  finally {
    if (session) { await session.abort(); session.dispose(); }
    undo(); clearTimeout(deadline); clearTimeout(hardStop); process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal);
    row.finishedAt = now(); row.durationMs = ms(started); row.metrics = metrics(row.requests, row.calls);
    if (st.error && st.phase) st.phase.partialMetrics = metrics(row.requests.filter(r => r.phase === st.phase.id), row.calls.filter(c => c.phase === st.phase.id));
    persist(); console.log(JSON.stringify({ label, status: row.status, error: row.error ?? null, posts: row.metrics.posts }));
    if (interrupted) throw st.error;
  }
  return row;
}

function schedule(cohort) {
  // All six permutations, each arm in each position twice across the 3 cohorts x 2 scenarios.
  const arms = ['off', 'stub', 'find'], start = Object.keys(MODELS).indexOf(cohort);
  return SCENARIOS.flatMap((s, i) => [0, 1, 2].map(j => ({ scenario: s.id, arm: arms[(start + (i ? 2 - j : j)) % 3] })));
}
async function main() {
  const [action, outputArg, stockArg, candidateArg, cohort, ...rest] = process.argv.slice(2);
  check(['preflight', 'run'].includes(action) && outputArg && stockArg && candidateArg && Object.hasOwn(MODELS, cohort) && !rest.length,
    'usage: preflight|run NEW_DIR PACKAGED_STOCK_INDEX PACKAGED_CANDIDATE_INDEX deepseek|kimi|sol', 'error');
  const root = process.env.PI_SDK_ROOT ?? process.env.PI_SUBAGENTS_SDK_ROOT;
  check(root && readJson(join(root, 'package.json')).name === '@earendil-works/pi-coding-agent' && readJson(join(root, 'package.json')).version === '1.5.2', 'set-PI_SDK_ROOT-to-Pi-1.5.2', 'error');
  const sdk = await import(pathToFileURL(join(root, 'dist/index.js')).href), stock = realpathSync(stockArg), candidate = realpathSync(candidateArg);
  const stockId = sourceId(stock), candidateId = sourceId(candidate); check(stockId === STOCK_ID && candidateId !== stockId, 'need-stock-62714e81-and-distinct-candidate');
  check(SCENARIOS.length === 2 && SCENARIOS.every(s => s.probes.length === 4 && new Set(['ack', ...s.probes.map(p => p.id)]).size === 5) && new Set(SCENARIOS.map(s => s.id)).size === 2, 'wrong-scenario-shape');
  const fixtureAndGraderSha256 = hash(readFileSync(new URL('./context-archive-find-fixtures.mjs', import.meta.url)));
  check(fixtureAndGraderSha256 === '237879bee8c163baf6c244cb4e91f2461fb2bac57b2ba4c2cac1b6b95b1502d7', 'need-frozen-fixtures-and-grader');
  const out = resolve(outputArg); mkdirSync(out, { mode: 0o700 }); // refuse overlaps/resumes
  const plan = schedule(cohort), manifest = { schema: 1, action, cohort, startedAt: now(), sdk: '1.5.2', node: process.version, catalog: {},
    stockSourceSha256: stockId, candidateSourceSha256: candidateId, runnerSha256: hash(readFileSync(new URL(import.meta.url))),
    fixtureAndGraderSha256, plan, thresholds: THRESHOLDS, limits: LIMITS,
    accounting: 'Live, nondeterministic; one independent session per cell. No retries. Pi input excludes cacheRead/cacheWrite; output includes reasoning. SDK USD estimates are not bills. resultChars counts complete serialized tool response text once (UTF-16), evidenceChars counts read.payload and find excerpts only. wireFirstChars and wireReplayChars partition full recall-result text on actual POSTs, excluding HTTP/JSON envelope and encoding overhead. wirePriorPhaseChars is the subset from earlier probes. cumulativeWallMs includes local bind, real acknowledgement and all requests to date.' };
  save(join(out, 'manifest.json'), manifest);
  const configuredDir = sdk.getAgentDir(), scratch = mkdtempSync(join(tmpdir(), 'context-archive-find-'));
  let runtime;
  try {
    process.env.PI_CODING_AGENT_DIR = scratch; process.env.PI_OFFLINE = '1'; process.env.PI_TELEMETRY = '0'; process.chdir(scratch);
    const real = await provider(sdk, cohort, configuredDir, scratch, manifest.catalog); runtime = real.runtime;
    save(join(out, 'manifest.json'), manifest); const rows = [];
    for (const { scenario, arm } of plan) {
      const ext = arm === 'find' ? candidate : stock; check(sourceId(ext) === (arm === 'find' ? candidateId : stockId), 'extension-changed');
      rows.push(await runSession({ sdk, runtime, model: real.model, action, out, scratch, ext, cohort, arm, scenario: SCENARIOS.find(s => s.id === scenario) }));
    }
    check(sourceId(stock) === stockId && sourceId(candidate) === candidateId, 'extension-changed');
    const comparisons = SCENARIOS.map(s => {
      const [off, stub, find] = ['off', 'stub', 'find'].map(a => rows.find(r => r.arm === a && r.scenario === s.id));
      const identicalSeed = same(off.seed, stub.seed) && same(off.seed, find.seed);
      const sameListReadSchema = !!stub.listReadSchemaSha256 && stub.listReadSchemaSha256 === find.listReadSchemaSha256;
      const identicalV1Stubs = action === 'run' && !!stub.afterAck && same(stub.afterAck, find.afterAck);
      return { scenario: s.id, identicalSeed, sameListReadSchema, identicalV1Stubs: action === 'run' ? identicalV1Stubs : null,
        status: [off, stub, find].map(r => ({ arm: r.arm, status: r.status, error: r.error ?? null })),
        valid: action === 'run' ? identicalSeed && sameListReadSchema && identicalV1Stubs && [off, stub, find].every(r => r.status === 'completed') : null };
    });
    save(join(out, 'comparisons.json'), comparisons);
    if (comparisons.some(c => !c.identicalSeed || !c.sameListReadSchema || (action === 'run' ? !c.valid : c.status.some(r => r.status !== 'preflight-only')))) process.exitCode = 1;
  } catch (e) { save(join(out, 'failure.json'), { at: now(), kind: fault(e).kind, code: fault(e).message }); throw e; }
  finally { manifest.finishedAt = now(); save(join(out, 'manifest.json'), manifest); await runtime?.settleCredentialWrites(); process.chdir(tmpdir()); rmSync(scratch, { recursive: true, force: true }); }
}
main().catch(e => { console.error(fault(e).message); process.exitCode = 2; });
