#!/usr/bin/env node
/** Quarantined, opt-in comparative live SDK experiment, never a CI gate. Provider/auth, real POST
 * observation, bounded literal-span verifier and loop safeguards adapted from context-archive-find.mjs.
 *   node scripts/experiments/archive-policy-live.mjs preflight NEW_OUT STOCK_INDEX CANDIDATE_INDEX sol
 *   node scripts/experiments/archive-policy-live.mjs run NEW_OUT STOCK_INDEX CANDIDATE_INDEX deepseek
 * Cohorts: deepseek | kimi | sol; use a new process and private, nonexisting output dir per cohort.
 * PI_SDK_ROOT (or PI_SUBAGENTS_SDK_ROOT) = Pi 1.5.2. Token Factory needs PI_TOKEN_FACTORY_PACKAGE
 * pointing at configured tokenfactory-pi@0.3.0 and its normal auth. Sol uses native Pi OAuth + offline
 * models-store (overrides PI_PILOT_AUTH_PATH, PI_PILOT_MODELS_STORE). Preflight loads/binds 10 cells;
 * it discovers catalog/auth but NEVER prompts. Only synthetic fixture messages; no ambient tools/files.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';
import { zstdDecompressSync } from 'node:zlib';
import { WARM, SYSTEM, SCENARIOS, grade, seed } from './archive-policy-fixtures.mjs';

const MODELS = { deepseek: 'deepseek-ai/DeepSeek-V4.1-Flash-1017', kimi: 'moonshotai/Kimi-K3.1-Pro', sol: 'gpt-6.2-sol' };
const CODEX = 'https://chatgpt.com/backend-api';
const TOOL = 'context_recall', ARCHIVE = 'ponygirls.context-archive';
const STOCK_ID = '9d1d433fd6832e773871586a419abc91f1a0fd10c96b4b8cbd9fc3f4eb22e054'; // shipped 42fbbe8a archive, unchanged at base 141cfd7c
const LIMITS = { catalogMs: 30000, bindMs: 30000, warmMs: 180000, probeMs: 180000,
  maxProbeRequests: 12, maxProbeToolAttempts: 24, outputTokens: 4096, streamEventBytes: 4 * 1024 * 1024, abortGraceMs: 5000 };
const PARKED = { highWatermark: 1, lowWatermark: 0.99 }, RELEASE = 5000;
const ARMS = ['raw', 'fifo-stub', 'late-stub', 'fifo-edges', 'late-edges'];
const usesStock = arm => arm === 'raw' || arm === 'fifo-stub';
const tag = salt => `Filing reference: ${salt}.\n`;
const saltHash = (value, salt) => hash(JSON.stringify(value).replaceAll(salt, '0'.repeat(salt.length)));
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
function seedSession(sdk, cwd, model, scenario, salt) {
  const messages = structuredClone(seed(scenario, model));
  check(messages[0]?.role === 'user' && !JSON.stringify(messages).includes(salt), 'wrong-seed-prefix');
  const unsalted = jsonHash(messages); messages[0].content = tag(salt) + text(messages[0].content);
  const entries = messages.map((message, i) => ({ type: 'message', message, timestamp: new Date(message.timestamp).toISOString(),
    id: (i + 1).toString(16).padStart(8, '0'), parentId: i ? i.toString(16).padStart(8, '0') : null }));
  const sources = entries.filter(e => e.message.role === 'toolResult').map((e, slot) => ({ ...e, slot, raw: JSON.stringify(e.message),
    digest: jsonHash(e.message), text: text(e.message.content), callId: e.message.toolCallId }));
  check(sources.length === 4 && same(sources.map(s => s.text), scenario.records) && sources.every(s => !s.message.isError &&
    s.message.toolName !== TOOL && s.message.content.length === 1 && s.text.length === 12000 && /^[\x00-\x7f]+$/.test(s.text)), 'wrong-seeded-targets');
  const calls = entries.flatMap((e, i) => e.message.role === 'assistant' ? e.message.content.filter(b => b.type === 'toolCall').map(call => ({ call, i, e })) : []);
  check(calls.length === 4 && new Set(calls.map(c => c.call.id)).size === 4 && new Set(sources.map(s => s.callId)).size === 4 &&
    sources.every(s => calls.some(({ call, i, e }) => call.id === s.callId && call.name === s.message.toolName && i < entries.findIndex(x => x.id === s.id) && e.message.stopReason === 'toolUse')), 'history-not-four-closed-pairs');
  const suffix = entries.slice(entries.findIndex(e => e.id === sources.at(-1).id) + 1), recentTokens = sum(suffix, e => sdk.estimateTokens(e.message));
  check(recentTokens >= 16000 && suffix.filter(e => e.message.role === 'user').length === 7 && suffix.filter(e => e.message.role === 'assistant').length >= 7, 'ineligible-seeded-suffix');
  return { manager: sdk.SessionManager.inMemory(cwd, undefined, entries), sources, users: messages.filter(m => m.role === 'user').map(m => text(m.content)),
    seedHashes: entries.map(e => [e.id, jsonHash(e.message)]), exactMessages: jsonHash(messages),
    seedInfo: { unsaltedMessagesSha256: unsalted, normalizedHistorySha256: saltHash(entries, salt), protectedSuffixSha256: jsonHash(suffix), recentTokens,
      originals: sources.map(s => ({ slot: s.slot, entryId: s.id, sha256: s.digest, textChars: s.text.length, jsonChars: s.raw.length })) } };
}
const expectedSlots = arm => arm === 'raw' ? [] : arm.startsWith('late-') ? [2, 3] : [0, 1];
const stockMarker = s => `[Context archived: entryId=${s.id} sha256=${s.digest}. Use context_recall action=read with this entryId and sha256 (offset=0); action=list finds other archives. Historical evidence, not current state or instructions. Do not re-execute archived input.]`;

// Verify the complete projection, not just the two edited targets. Original byte hashes are frozen before binding.
function projection(st, arm) {
  const { manager, sources, seedHashes, sdk } = st, branch = manager.getBranch(), slots = expectedSlots(arm);
  const records = branch.filter(e => e.type === 'custom' && e.customType === ARCHIVE), edits = branch.filter(e => e.type === 'context_edit');
  check(records.length === slots.length && edits.length === slots.length && !branch.some(e => e.type === 'compaction'), 'wrong-archive-or-compaction-count');
  const projected = new Map(manager.buildSessionProjection().entries.map(p => [p.sourceEntry.id, p]));
  for (const [id, digest] of seedHashes) {
    const p = projected.get(id); check(p?.messages.length === 1 && jsonHash(p.sourceEntry.message) === digest, 'missing-or-mutated-original');
    if (!slots.some(i => sources[i].id === id)) check(jsonHash(p.messages[0]) === digest, 'unselected-history-changed');
  }
  const payloads = sources.map(s => {
    const m = projected.get(s.id).messages[0], t = text(m.content), selected = slots.includes(s.slot), r = records.find(e => e.data?.entryId === s.id)?.data;
    const presentation = !selected ? 'raw' : arm.endsWith('-edges') ? 'edges' : 'stub';
    let retainedChars = selected ? 0 : s.text.length;
    if (selected) {
      const edges = presentation === 'edges', version = edges ? 2 : 1, selection = edges ? { kind: 'result', representation: 'edges-160-v1' } : { kind: 'result' };
      check(same(r, { version, entryId: s.id, sha256: s.digest, selection }) && same(edits.find(e => e.targetId === s.id)?.replacement?.content, m.content) &&
        same(m, { ...s.message, content: m.content }) && m.content.length === 1 && m.content[0].type === 'text', 'wrong-manifest-or-edit');
      if (edges) {
        const marker = `${stockMarker(s)}\n[Verbatim result head]\n${s.text.slice(0, 160)}\n` +
          `[${s.text.length - 320} UTF-16 units omitted]\n[Verbatim result tail]\n${s.text.slice(-160)}`;
        check(t === marker, 'wrong-edge-presentation');
        retainedChars = 320;
      } else check(t === stockMarker(s), 'not-exact-stock-v1-marker');
    } else check(!r && jsonHash(m) === s.digest, 'raw-not-exact-original');
    return { slot: s.slot, entryId: s.id, sha256: s.digest, presentation, version: r?.version ?? null, manifestSha256: r ? jsonHash(r) : null,
      projectedSha256: jsonHash(m), textSha256: hash(t), chars: t.length, retainedChars, releasedEstimate: sdk.estimateTokens(s.message) - sdk.estimateTokens(m) };
  });
  const releasedEstimate = sum(payloads, p => p.releasedEstimate);
  check(!slots.length || releasedEstimate >= RELEASE && payloads.filter(p => p.version).every(p => p.releasedEstimate < 4096), 'batch-outside-prespecified-release-band');
  return { archiveOrder: records.map(e => e.data.entryId), selectedSlots: slots, releasedEstimate, payloads };
}

// Known literal verifier for the actually archived single-text records in manifest order (possibly none), independent of candidate code.
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
    Object.assign(call, { entryId: s.id, slot: s.slot, sha256: s.digest, payloadSha256: hash(value.payload), readChars: value.payload.length, evidenceChars: value.payload.length });
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
          spans.push({ entryId: s.id, slot: s.slot, sha256: s.digest, excerptSha256: hash(hit.excerpt), readOffset: hit.readOffset, readLimit: hit.readLimit, excerptChars: hit.excerpt.length });
        }
        total++;
      }
    }
    const next = offset + spans.length;
    check(value.matches.length === spans.length && value.nextOffset === (next < total ? next : null), 'wrong-find-page-or-false-miss');
    Object.assign(call, { matches: spans, matchCount: spans.length, totalLiteralOccurrences: total, evidenceChars: sum(spans, s => s.excerptChars) });
  }
}

const archiveSources = st => (st.projected?.archiveOrder ?? []).map(id => st.sources.find(s => s.id === id));

// This observer NEVER drafts an edit or mutates a message. Pulse the real extension's global file only
// between WARM's completed assistant and its native turn_end. agent_end parks it before agent_before_settle.
function installObserver(pi, st) {
  const { row, sources, calls, scenario, settings, prefPath, model, sdk } = st;
  pi.on('before_agent_start', () => ({ systemPrompt: st.system })); // exclude SDK date/cwd and other ambient additions
  const on = (name, f) => pi.on(name, (e, ctx) => { try { if (!st.error) f(e, ctx); } catch (error) { st.fail(fault(error)); } });
  on('message_end', (e, ctx) => {
    if (st.phase?.id !== 'warm' || e.message.role !== 'assistant' || ['error', 'aborted', 'length'].includes(e.message.stopReason)) return;
    const r = row.requests[0], window = model.contextWindow, used = sdk.calculateContextTokens(e.message.usage);
    check(!row.admission && row.requests.length === 1 && r.posts === 1 && r.httpStatus >= 200 && r.httpStatus < 300 && r.payload.sources.every(p => p.presentation === 'raw'), 'pulse-before-first-successful-raw-post');
    check(e.message.stopReason === 'stop' && !e.message.content.some(b => b.type === 'toolCall'), 'warm-attempted-tool', 'protocol-deviation');
    check(ctx.getContextUsage()?.contextWindow === window && uint(used) && used > RELEASE && used < window, 'invalid-native-warm-usage-or-capacity');
    const thresholds = row.arm === 'raw' ? PARKED : { highWatermark: (used - 64) / window, lowWatermark: (used - RELEASE) / window };
    row.admission = { openedAt: now(), trigger: 'message_end:assistant', usageSource: 'Pi.calculateContextTokens(final WARM assistant.usage)', used,
      contextWindow: window, thresholds, requestedRelease: row.arm === 'raw' ? 0 : RELEASE };
    save(prefPath, { ...settings, thresholds }); // includes enabled:true even for raw
  });
  on('turn_end', (e, ctx) => {
    if (e.outcome !== 'completed') return;
    if (st.phase?.id !== 'warm') { check(!e.entries.length, 'later-turn-proposed-edits'); return; }
    const a = row.admission, slots = expectedSlots(row.arm), usage = ctx.getContextUsage();
    check(a && !a.turnEnd && usage?.contextWindow === a.contextWindow && usage.tokens === a.used, 'finalized-usage-mismatch-at-native-boundary');
    const ids = e.entries.filter(x => x.type === 'context_edit').map(x => x.targetId);
    a.turnEnd = { at: now(), outcome: e.outcome, tokens: usage.tokens, proposedEntryTypes: e.entries.map(x => x.type), proposedTargets: ids };
    check(e.entries.length === 2 * slots.length && same(ids.toSorted(), slots.map(i => sources[i].id).sort()), 'native-warm-selection-mismatch');
  });
  on('agent_end', () => {
    if (st.phase?.id !== 'warm') return;
    save(prefPath, settings);
    check(row.admission?.turnEnd && !row.admission.parkedAt, 'missing-native-warm-turn');
    row.admission.parkedAt = now(); row.afterWarm = st.projected = projection(st, row.arm);
  });
  on('agent_before_settle', e => {
    if (e.outcome !== 'completed') return;
    check(!e.entries.length && row.admission?.parkedAt && same(readJson(prefPath), settings), 'unparked-or-extra-settlement-edits');
    if (st.phase.id === 'warm') row.admission.settleAt = now();
  });
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
    check(phase.id !== 'warm', 'warm-attempted-tool', 'protocol-deviation');
    check(row.calls.filter(c => c.phase === phase.id).length <= LIMITS.maxProbeToolAttempts, 'tool-attempt-limit', 'stopped');
  });
  on('tool_call', e => {
    // Only fires after SDK argument validation/coercion, before the real extension's execute(). Unknown tools never get here.
    check(e.toolName === TOOL, 'unexpected-callable-tool');
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
      const p = c.args, offset = p?.offset ?? 0, archived = archiveSources(st), s = archived.find(s => s.id === p?.entryId && s.digest === p?.sha256);
      a.unexpectedError = !!p && (p.action === 'list' && offset <= archived.length || p.action === 'read' && s && offset < s.raw.length ||
        p.action === 'find' && typeof p.query === 'string' && !!p.query.trim() && p.query.length <= 128);
      return;
    }
    check(a.tool === TOOL && !!c.args && ['list', 'read', 'find'].includes(c.args.action), 'undeclared-action-succeeded');
    let value; try { value = JSON.parse(output); } catch { throw new Fault('non-json-recall-success'); }
    verifyResult(a, c.args, value, archiveSources(st));
  });
}

function validateTools(tools) {
  const defs = tools.map(t => t.function ?? t);
  check(defs.length === 1 && defs[0].name === TOOL && typeof defs[0].description === 'string', 'wrong-declared-tools');
  const actions = (defs[0].parameters?.anyOf ?? []).map(s => s.properties?.action?.const).sort();
  check(same(actions, ['find', 'list', 'read']), 'wrong-recall-schema');
  return { actions, definitionSha256: jsonHash(defs.map(({ name, description, parameters }) => ({ name, description, parameters }))) };
}

// Structural prefix of actual array items. Include their entire serialized contents (including roles/call IDs),
// exclude top-level routing, tools and instructions. This is not the provider's cache key or tokenizer.
function messagePrefix(prev, next) {
  let i = 0, commonItemBytes = 0;
  while (i < prev.length && i < next.length && prev[i].json === next[i].json) commonItemBytes += prev[i++].bytes;
  const at = (xs, i) => xs[i] ? { roleOrType: xs[i].roleOrType, sourceSlot: xs[i].slot, bytes: xs[i].bytes } : null;
  return { identicalItems: i, identicalItemJsonBytes: commonItemBytes, warmItems: prev.length, controlItems: next.length,
    warmItemJsonBytes: sum(prev, x => x.bytes), controlItemJsonBytes: sum(next, x => x.bytes),
    firstUnequalWarm: at(prev, i), firstUnequalControl: at(next, i) };
}

// Inspect the actual POST body after the adapter built it (including Codex SSE zstd). Never persist that body.
function wireReceipt(body, model, st) {
  const { sources, row, calls } = st, msgs = body.messages ?? body.input;
  check(body.model === model.id && Array.isArray(msgs) && !body.previous_response_id, 'wrong-wire-model-or-continuation');
  const inline = msgs.flatMap(m => ['additional_tools', 'tool_search_output'].includes(m.type) || m.role === 'system' ? m.tools ?? [] : []);
  const tools = [...(body.tools ?? []), ...inline], declared = validateTools(tools), toolHash = jsonHash(tools);
  if (!row.wireToolsSha256) row.wireToolsSha256 = toolHash;
  check(row.wireToolsSha256 === toolHash, 'changed-wire-tool-definition');
  const systems = msgs.filter(m => ['system', 'developer'].includes(m.role) && m.content !== undefined).map(m => text(m.content));
  if (body.instructions !== undefined) systems.unshift(body.instructions);
  const users = msgs.filter(m => m.role === 'user').map(m => text(m.content));
  check(same(systems, [st.system]) && systems[0].startsWith(tag(st.salt)) && same(users, st.users) && users[0].startsWith(tag(st.salt)), 'wire-private-or-unplanned-prompt');
  const isResult = m => m.type === 'function_call_output' || m.role === 'tool';
  const outputs = msgs.flatMap((m, wireIndex) => isResult(m) ? [[m.call_id ?? m.tool_call_id, { value: text(m.output ?? m.content), wireIndex }]] : []);
  const byId = new Map(outputs);
  check(byId.size === outputs.length && byId.size === sources.length + calls.size, 'wire-missing-or-extra-tool-results');
  const idOnWire = id => model.provider === 'openai-codex' ? id.split('|')[0] : id;
  const payloads = sources.map((s, i) => {
    const result = byId.get(idOnWire(s.callId)), p = st.projected.payloads[i];
    check(result && hash(result.value) === p.textSha256, 'wire-original-or-edit-mismatch');
    return { slot: i, entryId: s.id, presentation: p.presentation, textSha256: p.textSha256, chars: p.chars, retainedChars: p.retainedChars, wireIndex: result.wireIndex };
  });
  const firstUser = msgs.findIndex(m => m.role === 'user');
  check(firstUser >= 0 && firstUser < Math.min(...payloads.map(p => p.wireIndex)), 'session-salt-not-before-shared-observations');
  const stream = msgs.map((m, i) => { const json = JSON.stringify(m); return { json, bytes: Buffer.byteLength(json), roleOrType: m.type ?? m.role,
    slot: payloads.find(p => p.wireIndex === i)?.slot ?? null }; });
  let prefix = null;
  if (st.phase.id === 'warm') st.warmStream = stream;
  else if (st.phase.id === 'control' && row.requests.length === 2) prefix = messagePrefix(st.warmStream, stream);
  const deliveries = [];
  for (const [id, { attempt: a }] of calls) {
    const t = byId.get(idOnWire(id))?.value;
    check(typeof t === 'string' && hash(t) === a.resultSha256 && t.length === a.resultChars, 'tool-text-changed-before-wire');
    if (a.tool === TOOL) deliveries.push({ call: a.n, chars: t.length, first: !a.wireDeliveries, priorPhase: a.phase !== st.phase.id });
    a.wireDeliveries++;
  }
  const transcript = { msgs, instructions: body.instructions, tools: body.tools };
  return { ...declared, bodyModel: body.model, toolsSha256: toolHash, wireSha256: jsonHash(transcript), normalizedTranscriptSha256: saltHash(transcript, st.salt),
    wireMaxTokens: body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens ?? null,
    firstUserWireIndex: firstUser, saltAtSystemStart: true, saltAtFirstUserStart: true, sources: payloads,
    sourcePayloadChars: sum(payloads, p => p.chars), cacheKeySha256: typeof body.prompt_cache_key === 'string' ? hash(body.prompt_cache_key) : null,
    warmToFirstControlPrefix: prefix, deliveries };
}

// A missing provider cache field is unknown, not a measured zero, even if Pi sets cacheRead=0.
function providerUsage(u) {
  const nat = n => uint(n) ? n : null;
  const prompt = nat(u.prompt_tokens ?? u.input_tokens), output = nat(u.completion_tokens ?? u.output_tokens);
  const details = u.prompt_tokens_details ?? u.input_tokens_details;
  const cacheRead = nat(details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? u.cached_tokens), cacheWrite = nat(details?.cache_write_tokens);
  return { prompt, output, cacheRead, cacheWrite, promptCacheMiss: nat(u.prompt_cache_miss_tokens), total: nat(u.total_tokens),
    reasoning: nat((u.completion_tokens_details ?? u.output_tokens_details)?.reasoning_tokens),
    nonCacheReadPrompt: prompt !== null && cacheRead !== null ? prompt - cacheRead : null };
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
    demand(count < (phase.id === 'warm' ? 1 : LIMITS.maxProbeRequests), 'request-limit', 'stopped');
    demand(count === 0 || row.requests.at(-1)?.toolCalls > 0, 'unrequested-continuation');
    if (phase.id === 'warm') {
      const msgs = context.messages.filter(m => m.role !== 'system');
      demand(msgs.at(-1)?.role === 'user' && text(msgs.at(-1).content) === WARM && jsonHash(msgs.slice(0, -1)) === st.exactMessages, 'sdk-did-not-receive-exact-seed');
    }
    demand(selected.contextWindow === row.contextWindow && model.maxTokens >= LIMITS.outputTokens, 'changed-capacity-or-insufficient-output-limit');
    const r = { n: row.requests.length + 1, phase: phase.id, startedAt: now(), posts: 0, httpStatus: null, usage: null, providerUsage: null, streamEventBytes: 0, reportedModels: [] };
    row.requests.push(r); const start = performance.now(); let postStart;
    const stream = original.call(this, selected, context, { ...options,
      signal: AbortSignal.any([st.controller.signal, ...(options.signal ? [options.signal] : [])]),
      transport: 'sse', disableContinuation: true, maxRetries: 0, maxTokens: LIMITS.outputTokens,
      fetch: async (input, init) => {
        const req = new Request(input, init), endpoint = model.provider === 'openai-codex' ? `${CODEX}/codex/responses` : `${model.baseUrl}/chat/completions`;
        demand(!st.error && req.url === endpoint && req.method === 'POST' && r.posts === 0, 'unexpected-http-request');
        try {
          const bytes = Buffer.from(await req.clone().arrayBuffer()), data = req.headers.get('content-encoding') === 'zstd' ? zstdDecompressSync(bytes) : bytes;
          r.payload = wireReceipt(JSON.parse(data.toString('utf8')), model, st); r.httpBodyBytes = bytes.length;
          if (model.api === 'openai-completions') check(r.payload.wireMaxTokens === LIMITS.outputTokens, 'missing-wire-output-cap');
        } catch (e) { const f = e instanceof Fault ? e : new Fault('unverifiable-http-body'); st.fail(f); throw f; }
        r.endpoint = req.url; r.posts++; r.postedAt = now(); postStart = performance.now();
        const res = await fetch(req, { redirect: 'error' }); r.httpStatus = res.status; r.postToHeadersMs = ms(postStart); return res;
      },
      onProviderStreamEvent: async (data, m) => {
        r.postToFirstEventMs ??= ms(postStart);
        if (data?.choices?.some(c => c.delta?.content || c.delta?.tool_calls?.length) ||
            ['response.output_text.delta', 'response.function_call_arguments.delta'].includes(data?.type)) r.postToFirstTextOrToolMs ??= ms(postStart);
        const u = data?.response?.usage ?? data?.usage; if (u) r.providerUsage = providerUsage(u);
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
      r.durationMs = ms(start); r.completedAt = now(); if (postStart !== undefined) r.postToResultMs = ms(postStart); r.stopReason = m.stopReason; r.sdkModelMatched = m.provider === model.provider && m.model === model.id;
      r.toolCalls = m.content.filter(b => b.type === 'toolCall').length;
      const u = m.usage;
      if (u && TOKENS.every(k => uint(u[k])) && u.totalTokens > 0) r.usage = { ...Object.fromEntries(TOKENS.map(k => [k, u[k]])),
        reasoning: u.reasoning ?? null, sdkCostUsd: Number.isFinite(u.cost?.total) ? u.cost.total : null };
      if (r.n === 2 && phase.id === 'control' && r.payload?.warmToFirstControlPrefix) row.warmToControl = contrast(row.requests[0], r);
      if (m.stopReason === 'error') st.fail(new Fault('provider-error', 'error'));
      else if (['aborted', 'length'].includes(m.stopReason)) st.fail(new Fault(`provider-${m.stopReason}`, 'stopped'));
      else if (r.usage?.output > LIMITS.outputTokens) st.fail(new Fault('output-token-limit', 'stopped')); // Codex omits the server-side cap
      else if (!['stop', 'toolUse'].includes(m.stopReason) || !r.usage || !r.sdkModelMatched || r.posts !== 1 || !(r.httpStatus >= 200 && r.httpStatus < 300)) st.fail(new Fault('incomplete-provider-receipt'));
    }).catch(() => st.fail(new Fault('unobserved-stream', 'error'))));
    return stream;
  };
  return () => { runtime.streamSimple = original; };
}

function metrics(requests, calls) {
  const recalls = calls.filter(c => c.tool === TOOL), delivered = requests.flatMap(r => r.payload?.deliveries ?? []), first = delivered.filter(d => d.first);
  return { requests: requests.length, sdkRequestMs: sum(requests, r => r.durationMs ?? 0), httpToResultMs: sum(requests, r => r.postToResultMs ?? 0), posts: sum(requests, r => r.posts),
    usage: requests.length && requests.every(r => r.usage) ? Object.fromEntries([...TOKENS, 'reasoning', 'sdkCostUsd'].map(k => [k,
      requests.every(r => r.usage[k] !== null) ? sum(requests, r => r.usage[k]) : null])) : null,
    measuredCacheRead: requests.length && requests.every(r => uint(r.providerUsage?.cacheRead)) ? sum(requests, r => r.providerUsage.cacheRead) : null,
    attempts: recalls.length, results: recalls.filter(c => c.resultChars !== null).length, errors: recalls.filter(c => c.status === 'error').length,
    undeclaredAttempts: calls.filter(c => c.tool !== TOOL).length, resultChars: sum(recalls, c => c.resultChars ?? 0), evidenceChars: sum(recalls, c => c.evidenceChars),
    wireFirstDeliveries: first.length, wireFirstChars: sum(first, d => d.chars), wireReplays: delivered.length - first.length,
    wireReplayChars: sum(delivered.filter(d => !d.first), d => d.chars), wirePriorPhaseChars: sum(delivered.filter(d => d.priorPhase), d => d.chars),
    wireAllRecallResultChars: sum(delivered, d => d.chars) };
}

// Separate local verifier, not an agent tool call. Run only after *all* timed prompts, so it neither
// prewarms the first control request nor feeds evidence to the model. Uses the actual registered tool.
async function auditRecall(session, st) {
  const addresses = archiveSources(st), def = session.getToolDefinition(TOOL), ctx = session.extensionRunner.createContext();
  const before = jsonHash(st.manager.getBranch()), audit = [];
  async function invoke(args) {
    const result = await def.execute('local-audit', args, st.controller.signal, undefined, ctx);
    return JSON.parse(text(result.content));
  }
  async function ok(args) {
    const value = await invoke(args), rec = { action: args.action }; verifyResult(rec, args, value, addresses); audit.push(rec); return value;
  }
  await ok({ action: 'list' });
  for (const s of st.sources) {
    // Natural literal from *interior*, not an edge that could be served from a preview. Verify all returned spans.
    const q = s.text.slice(6000, 6056), page = await ok({ action: 'find', query: q });
    if (!addresses.includes(s)) {
      let rejected = false; try { await def.execute('local-audit', { action: 'read', entryId: s.id, sha256: s.digest }, st.controller.signal, undefined, ctx); } catch { rejected = true; }
      check(rejected, 'read-disclosed-an-unarchived-original'); audit.push({ action: 'read-unarchived', entryId: s.id, rejected }); continue;
    }
    for (const hit of page.matches) await ok({ action: 'read', entryId: hit.entryId, sha256: hit.sha256, offset: hit.readOffset, limit: hit.readLimit });
    let offset = 0, full = '';
    do { const v = await ok({ action: 'read', entryId: s.id, sha256: s.digest, offset, limit: 12000 }); full += v.payload; offset = v.nextOffset; } while (offset !== null);
    check(hash(full) === s.digest, 'read-reassembly-digest-mismatch');
  }
  check(before === jsonHash(st.manager.getBranch()), 'audit-changed-history'); return audit;
}

function contrast(warm, control) {
  const take = r => ({ request: r.n, endpoint: r.endpoint, durationMs: r.durationMs, postToHeadersMs: r.postToHeadersMs,
    postToFirstEventMs: r.postToFirstEventMs ?? null, postToFirstTextOrToolMs: r.postToFirstTextOrToolMs ?? null, postToResultMs: r.postToResultMs,
    usage: r.usage, providerUsage: r.providerUsage });
  return { warm: take(warm), firstControl: take(control), structuralPrefix: control.payload.warmToFirstControlPrefix };
}
async function runSession({ sdk, action, out, scratch, ext, cohort, model, runtime, scenario, arm, salts }) {
  const label = `${cohort}-${scenario.id}-${arm}`, dir = mkdtempSync(join(scratch, 'cell-')), cwd = join(dir, 'empty'), prefPath = join(dir, 'context-archive.json');
  mkdirSync(cwd); process.env.PI_CODING_AGENT_DIR = dir;
  const settings = { version: 3, enabled: true, thresholds: PARKED, ...(!usesStock(arm) && { researchPolicy: arm }) }; save(prefPath, settings);
  const salt = randomBytes(16).toString('hex'); check(!salts.has(salt), 'session-salt-collision'); salts.add(salt);
  const seeded = seedSession(sdk, cwd, model, scenario, salt), prompts = [{ id: 'warm', question: WARM }, ...scenario.probes], started = performance.now();
  const row = { label, cohort, provider: model.provider, model: model.id, contextWindow: model.contextWindow, scenario: scenario.id, arm,
    settings, nonceSha256: hash(salt), startedAt: now(), status: 'running', seed: seeded.seedInfo,
    phases: prompts.map(p => ({ id: p.id, questionSha256: hash(p.question), status: 'not-run' })), requests: [], calls: [] };
  let session, deadline, hardStop, phaseStart, interrupted;
  const persist = () => save(join(out, label + '.json'), row);
  const st = { ...seeded, row, action, scenario, sdk, model, settings, prefPath, salt, system: tag(salt) + SYSTEM,
    calls: new Map(), observations: [], controller: new AbortController(),
    fail(f) { if (!st.error) {
      st.error = f; row.status = f.kind; row.error = f.message;
      if (st.phase) { st.phase.status = f.kind; st.phase.durationMs = ms(phaseStart); }
      persist(); st.controller.abort(); void session?.abort().catch(() => {});
      hardStop = setTimeout(() => { row.hardStop = true; row.metrics = metrics(row.requests, row.calls); persist(); process.exit(2); }, LIMITS.abortGraceMs);
    } }, healthy() { if (st.error) throw st.error; },
  };
  const timeout = (millis, name) => { clearTimeout(deadline); deadline = setTimeout(() => st.fail(new Fault(name, 'stopped')), millis); };
  const onSignal = () => { interrupted = true; st.fail(new Fault('interrupted', 'stopped')); };
  process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal);
  const undo = observe(runtime, model, st); persist(); timeout(LIMITS.bindMs, 'bind-deadline');
  try {
    const sm = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, cacheWarming: 'off' });
    const loader = new sdk.DefaultResourceLoader({ ...ISOLATED, systemPrompt: st.system, cwd, agentDir: dir, settingsManager: sm,
      additionalExtensionPaths: [ext], extensionFactories: [pi => installObserver(pi, st)] });
    await loader.reload(); const loaded = loader.getExtensions();
    check(!loaded.errors.length && loaded.extensions.length === 2 && !loader.getAgentsFiles().agentsFiles.length, 'isolated-extension-load', 'error');
    const created = await sdk.createAgentSession({ cwd, agentDir: dir, modelRuntime: runtime, model, thinkingLevel: 'off',
      sessionManager: st.manager, resourceLoader: loader, settingsManager: sm, tools: [TOOL] });
    session = created.session; check(!created.modelFallbackMessage && session.model?.id === model.id && session.model.provider === model.provider &&
      session.model.contextWindow === model.contextWindow, 'sdk-model-fallback');
    await session.bindExtensions({ mode: 'rpc', onError: () => st.fail(new Fault('extension-error', 'error')) }); st.healthy();
    const active = session.getActiveToolNames(); check(same(active, [TOOL]) && same(session.getCallableToolNames(), active), 'unexpected-active-or-callable-tool');
    row.declared = validateTools(session.getAllTools().filter(t => active.includes(t.name))); row.thinkingLevel = session.thinkingLevel;
    st.projected = row.beforeWarm = projection(st, 'raw'); row.bindMs = ms(started); st.healthy();
    if (action === 'preflight') { row.status = 'preflight-only'; return row; }
    for (const [i, { question }] of prompts.entries()) {
      const phase = row.phases[i]; st.phase = phase; phaseStart = performance.now(); phase.status = 'running'; phase.startedAt = now(); st.users.push(question);
      timeout(i ? LIMITS.probeMs : LIMITS.warmMs, i ? 'probe-deadline' : 'warm-deadline'); persist();
      await session.prompt(question); phase.promptWallMs = ms(phaseStart); await Promise.all(st.observations); st.healthy();
      const reqs = row.requests.filter(r => r.phase === phase.id), calls = row.calls.filter(c => c.phase === phase.id);
      check(reqs.at(-1)?.stopReason === 'stop' && calls.length === sum(reqs, r => r.toolCalls) && calls.every(c => c.status !== 'started' && c.wireDeliveries > 0), 'incomplete-phase');
      const answer = session.getLastAssistantText() ?? ''; phase.answerSha256 = hash(answer);
      check(row.admission?.settleAt && row.afterWarm && same(projection(st, arm), row.afterWarm), 'unstable-or-no-native-archive');
      if (!i) check(answer.trim() === 'READY' && !calls.length && reqs.length === 1, 'nonneutral-warm', 'protocol-deviation');
      else {
        if (phase.id === 'control') {
          check(!!row.warmToControl, 'missing-warm-control-contrast');
        }
        phase.score = grade(scenario.id, phase.id, answer); // no branching, re-prompts or exclusions on score
      }
      phase.status = 'completed'; phase.metrics = metrics(reqs, calls); phase.cumulative = metrics(row.requests, row.calls);
      phase.durationMs = ms(phaseStart); phase.cumulativeWallMs = ms(started); persist();
    }
    st.phase = null; row.promptRunMs = ms(started); timeout(LIMITS.bindMs, 'local-audit-deadline');
    row.localRecallAudit = await auditRecall(session, st); st.healthy();
    check(!row.calls.some(a => a.unexpectedError), 'known-valid-recall-returned-error'); row.status = 'completed';
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

// Six prespecified blocks: every arm at every position once or twice, and 19 of 20 possible directed
// neighbors within a block (each present neighbor once or twice). One independent session per arm/block.
const ORDERS = [[0,1,2,3,4], [3,2,1,4,0], [1,4,3,0,2], [0,3,1,2,4], [2,0,4,1,3], [4,2,0,3,1]];
function schedule(cohort) {
  const c = Object.keys(MODELS).indexOf(cohort), scenarioOrder = c === 1 ? [1, 0] : [0, 1];
  return scenarioOrder.flatMap(i => ORDERS[2 * c + i].map((a, j) => ({ scenario: SCENARIOS[i].id, arm: ARMS[a], block: 2 * c + i + 1, position: j + 1 })));
}
function compare(action, scenario, rows) {
  const cells = rows.filter(r => r.scenario === scenario.id), allSame = f => cells.length === 5 && f(cells[0]) != null && cells.every(r => same(f(r), f(cells[0])));
  const sameSeedExceptNonce = allSame(r => r.seed), sameTools = allSame(r => r.declared), sameCapacity = allSame(r => r.contextWindow),
    sameThinking = allSame(r => r.thinkingLevel), distinctNonces = new Set(cells.map(r => r.nonceSha256)).size === 5;
  const live = action === 'run', sameWireTools = live ? allSame(r => r.wireToolsSha256) : null;
  const sameWarmRequestExceptNonce = live ? allSame(r => r.requests[0]?.payload?.normalizedTranscriptSha256) : null;
  const status = cells.map(r => ({ arm: r.arm, status: r.status, error: r.error ?? null }));
  const comparable = sameSeedExceptNonce && sameTools && sameCapacity && sameThinking && distinctNonces &&
    (live ? !!sameWarmRequestExceptNonce && !!sameWireTools && cells.every(r => r.status === 'completed') : status.every(r => r.status === 'preflight-only'));
  return { scenario: scenario.id, comparable, sameSeedExceptNonce, sameTools, sameCapacity, sameThinking, distinctNonces, sameWireTools, sameWarmRequestExceptNonce, status };
}

async function main() {
  const [action, outputArg, stockArg, candidateArg, cohort, ...rest] = process.argv.slice(2);
  check(['preflight', 'run'].includes(action) && outputArg && stockArg && candidateArg && Object.hasOwn(MODELS, cohort) && !rest.length,
    'usage: preflight|run NEW_DIR PACKAGED_STOCK_INDEX PACKAGED_CANDIDATE_INDEX deepseek|kimi|sol', 'error');
  const root = process.env.PI_SDK_ROOT ?? process.env.PI_SUBAGENTS_SDK_ROOT;
  check(root && readJson(join(root, 'package.json')).name === '@earendil-works/pi-coding-agent' && readJson(join(root, 'package.json')).version === '1.5.2', 'set-PI_SDK_ROOT-to-Pi-1.5.2', 'error');
  const sdk = await import(pathToFileURL(join(root, 'dist/index.js')).href), stock = realpathSync(stockArg), candidate = realpathSync(candidateArg);
  const stockId = sourceId(stock), candidateId = sourceId(candidate); check(stockId === STOCK_ID && candidateId !== stockId, 'need-stock-42fbbe8a-and-distinct-packaged-candidate');
  check(SCENARIOS.length === 2 && SCENARIOS.every(s => /^[a-z0-9-]+$/.test(s.id) && same(s.probes.map(p => p.id).toSorted(), ['control', 'edge', 'middle']) && s.probes[0].id === 'control') && new Set(SCENARIOS.map(s => s.id)).size === 2, 'wrong-scenario-shape');
  const fixtureAndGraderSha256 = hash(readFileSync(new URL('./archive-policy-fixtures.mjs', import.meta.url)));
  check(fixtureAndGraderSha256 === 'e167599c518ca1982c638fa4b1113a02cd43e701fb2525d3c523bac306198a90', 'need-frozen-fixtures-and-grader');
  const out = resolve(outputArg); mkdirSync(out, { mode: 0o700 }); // do not overwrite, append or resume
  const plan = schedule(cohort), manifest = { schema: 1, action, cohort, startedAt: now(), sdk: '1.5.2', node: process.version, catalog: {},
    stockSourceSha256: stockId, candidateSourceSha256: candidateId, runnerSha256: hash(readFileSync(new URL(import.meta.url))), fixtureAndGraderSha256,
    plan, design: Object.fromEntries(Object.keys(MODELS).map(c => [c, schedule(c)])), arms: ARMS, parked: PARKED, releaseEstimate: RELEASE, limits: LIMITS,
    accounting: {
      design: 'One independent session per model/scenario/arm. Two scenarios per model, longitudinal probes, not independent replications. All conditions enable the real context_recall tool. Stock package for raw and fifo-stub. Park 100/99; for edited arms pulse native watermarks once from measured WARM usage without changing model capacity. No retries. Salt (16 fresh random bytes in fixed hex) precedes the system AND first user text. This reduces cross-arm prefix reuse; it cannot guarantee cold provider caches.',
      prefix: 'warmToControl compares the first actual control POST to the WARM POST in the same session. Identical full JSON messages/input items in order, bytes=sum UTF-8 byte lengths of their JSON encodings, without array separators. Routing, top-level instructions and tool declarations excluded (checked independently). Structural only; provider tokenization, placement, routing and observed hits can differ.',
      tokens: 'Pi usage.input excludes cacheRead/cacheWrite. Output includes reasoning. providerUsage is allowlisted numeric fields from raw SSE (null when missing); nonCacheReadPrompt includes any cache-write prompt tokens. Pi default zero is not evidence of a reported cache hit or miss. SDK USD estimates are not bills. All arms request SDK maxTokens=4096. Native Codex can omit a wire max_output_tokens; record null and stop on measured overrun rather than invent a cap.',
      calls: 'One actual allowed POST per SDK call, full history/no continuation IDs, all natural tool continuations counted. resultChars counts complete recall text once (UTF-16); evidenceChars counts payloads and excerpts. wireFirstChars and wireReplayChars count delivered model-facing recall text. localRecallAudit occurs after the final prompt and is excluded.',
      time: 'Request durationMs = SDK call to result incl local adaptation. postTo*Ms starts at fetch dispatch and separates first headers, parsed event, visible text/tool delta, result. Per-phase promptWallMs includes all continuations. cumulativeWallMs includes bind + WARM + all prior prompts; promptRunMs excludes the post-run local verification. Wall times reflect provider load, not only prefill.' } };
  save(join(out, 'manifest.json'), manifest);
  const configuredDir = sdk.getAgentDir(), scratch = mkdtempSync(join(tmpdir(), 'archive-policy-'));
  let runtime;
  try {
    process.env.PI_CODING_AGENT_DIR = scratch; process.env.PI_OFFLINE = '1'; process.env.PI_TELEMETRY = '0'; process.chdir(scratch);
    const real = await provider(sdk, cohort, configuredDir, scratch, manifest.catalog); runtime = real.runtime;
    save(join(out, 'manifest.json'), manifest); const rows = [], salts = new Set();
    for (const { scenario, arm } of plan) {
      const ext = usesStock(arm) ? stock : candidate; check(sourceId(ext) === (usesStock(arm) ? stockId : candidateId), 'extension-changed');
      rows.push(await runSession({ sdk, runtime, model: real.model, action, out, scratch, ext, cohort, arm, salts, scenario: SCENARIOS.find(s => s.id === scenario) }));
    }
    check(sourceId(stock) === stockId && sourceId(candidate) === candidateId, 'extension-changed');
    const comparisons = SCENARIOS.map(s => compare(action, s, rows)); save(join(out, 'comparisons.json'), comparisons);
    if (comparisons.some(c => !c.comparable)) process.exitCode = 1;
  } catch (e) { save(join(out, 'failure.json'), { at: now(), kind: fault(e).kind, code: fault(e).message }); throw e; }
  finally { manifest.finishedAt = now(); save(join(out, 'manifest.json'), manifest); await runtime?.settleCredentialWrites(); process.chdir(tmpdir()); rmSync(scratch, { recursive: true, force: true }); }
}
main().catch(e => { console.error(fault(e).message); process.exitCode = 2; });
