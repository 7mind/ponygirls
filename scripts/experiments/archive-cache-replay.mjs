#!/usr/bin/env node
/**
 * Offline, pre-results protocol. Run with Node 24.22+ (native TypeScript):
 *   PI_SDK_ROOT=/path/to/pi-monorepo node scripts/experiments/archive-cache-replay.mjs /path/to/ponygirls-context-archive/index.ts report
 * Substitute `csv` or `json` for `report` to emit EVERY aggregate row (no messages).
 * Works with the stock package or its identical source checkout, without linking node_modules.
 * See the parameters below. No Pi CLI, agent, provider, auth, resource loader, session files,
 * HTTP requests, installation, private history, tool execution or measured model outputs.
 *
 * Self-GC (arXiv:2607.00692, “Recoverability & Cache-Aware Commit”) frames a commit as
 * future savings minus the cache break. Break Later or Never (doi:10.6084/m9.figshare.34791231.v1)
 * batches stale observations. Test ONE operational implication: wait on a still-warm prefix;
 * accumulate more *stock-eligible* payloads, or avoid paying a break for a short continuation.
 * Not either paper's planner, a serving-stack/KV implementation or a reproduction of its results.
 *
 * On a completed boundary take the UNCHANGED native proposal, with fallback usage (tokens:null).
 * S = estimated tokens before minus after actually applying the drafts in a disposable Pi branch.
 * D = estimated full-message prefix hits on the most recent sent request without minus with edit.
 * If next input is warm, its cost without minus with edits is S − (1−r)D; each further warm
 * reuse, ignoring growth/other edits, saves rS. Commit iff S[1+(4−1)·.10] >= (1−.10)D, or at
 * >=90% window, or on known cache-off. Never shrink 4096, relax safety or promise to reach 50%.
 * Otherwise discard the preview and ask stock again next time. Neither oracle horizon, next gap,
 * revisit position nor eventual measured price is an input to this gate. No alternate sort order.
 *
 * Primary comparison: total incremental fresh + r·hits input, r=.10/.50, on the SAME number of
 * completed scripted user tasks. Always show completion; NEVER rank truncated runs by total cost.
 * Every fixture starts at an identical, single accepted cold prefill before any archive decision.
 * Its size is shown separately (sunk, NOT in the incremental price or request count). Earlier
 * history-building costs are not replayed. Both task horizons share a prefix of one trajectory.
 * One completed boundary per assistant response/tool result before the next send, not an extra
 * settle retry at the identical state. No lookahead, compaction, output reserve or overflow sends.
 * Identical synthetic, historical messages in all arms; no system/tool declarations, provider
 * serializer, partial-message hits, minimum cache block, cache-write/output charges or latency.
 * These are mechanistic fixture sensitivities, NOT provider tokens, bills, production-frequency
 * weights, model retrieval/correctness, noninferiority or a reason to turn the feature on.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = '141cfd7cb710b8e0d5d63f414e2421cd4d3e6b70';
const STOCK_SHA = '9fc2dd3fd67d7f7701085f2a8038f3648e1894afb9bb37b01ddf5120adb0ba0c';
const POLICY = { highWatermark: .7, lowWatermark: .5, keepRecentTurns: 6, keepRecentTokens: 16000,
  minPayloadChars: 4096, minBatchTokens: 4096, maxTargets: 16 };
const SEED = 0x71a9c34, T0 = Date.UTC(2024, 0, 1), HARD = .90;
const HORIZONS = [2, 14], CACHES = ['warm', 'ttl', 'off'], POSITIONS = ['none', 'early', 'mid', 'late'];
const PRICES = [.10, .50], TTL = 300, SHORT_GAP = 30, EXPIRED_GAP = 600, TOOL_GAP = 2;
// Body lengths in estimated text tokens (exactly 4 ASCII chars per nominal token, plus separately
// counted wrappers). All have old successful calls, a recent suffix and a final user prefill.
// Recent user/observation means seven user documents or six successful, newly ageing results.
// Both have assistant replies. No peeking at these labels, old-source addresses or read schedules
// in planArchive or the gate. The stream's large noneligible document follows the OLD calls.
const FIXTURES = [
  { id: 'low',     window: 65536,  prefix: 3000,  oldN: 3, oldSize: 2048,  afterOld: 0,     recent: 'user',   recentN: 7, recentSize: 2400, growth: 500 },
  { id: 'dense',   window: 131072, prefix: 46000, oldN: 3, oldSize: 15000, afterOld: 0,     recent: 'user',   recentN: 7, recentSize: 2400, growth: 800 },
  { id: 'partial', window: 65536,  prefix: 6000,  oldN: 7, oldSize: 4096,  afterOld: 0,     recent: 'user',   recentN: 7, recentSize: 2400, growth: 1200 },
  { id: 'stream',  window: 65536,  prefix: 2048,  oldN: 3, oldSize: 2048,  afterOld: 22000, recent: 'result', recentN: 6, recentSize: 3200, growth: 1400 },
  { id: 'blocked', window: 65536,  prefix: 40960, oldN: 3, oldSize: 1256,  afterOld: 0,     recent: 'user',   recentN: 7, recentSize: 2400, growth: 1536 },
];

const hash = (data) => createHash('sha256').update(data).digest('hex');
const fileHash = (f) => hash(readFileSync(f));
const [archiveArg, format = 'report', ...extra] = process.argv.slice(2);
if (!archiveArg || !['index.ts', 'archive.ts'].includes(basename(archiveArg)) || !process.env.PI_SDK_ROOT ||
    !['report', 'csv', 'json'].includes(format) || extra.length) {
  throw Error('Usage: PI_SDK_ROOT=/path/to/pi-monorepo node archive-cache-replay.mjs STOCK_INDEX.ts [report|csv|json] (pass ponygirls-context-archive/index.ts or src/archive.ts)');
}
const root = realpathSync(process.env.PI_SDK_ROOT), archivePath = realpathSync(basename(archiveArg) === 'index.ts'
  ? join(dirname(archiveArg), 'src/archive.ts') : archiveArg);
const sdkVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
assert.equal(sdkVersion, '1.5.2'); assert.equal(fileHash(archivePath), STOCK_SHA, 'stock planner identity');
const sessionFile = join(root, 'dist/core/session-manager.js'), costFile = join(root, 'dist/core/compaction/compaction.js');
const archiveURL = pathToFileURL(archivePath).href, costURL = pathToFileURL(costFile).href;
// Bind stock archive.ts's sole non-type Pi import (estimateTokens) to that EXACT Pi implementation;
// no CLI/extension loader or mock. This also works on an immutable Nix extension with no SDK peer link.
registerHooks({ resolve(specifier, ctx, next) {
  if (ctx.parentURL === archiveURL && specifier === '@earendil-works/pi-coding-agent') return { url: costURL, shortCircuit: true };
  return next(specifier, ctx);
} });
const [{ SessionManager }, { estimateTokens }, { DEFAULT_POLICY, planArchive, recallArchive, RECALL_TOOL, ARCHIVE_TYPE }] = await Promise.all([
  import(pathToFileURL(sessionFile).href), import(costURL), import(archiveURL),
]);
assert.deepEqual(DEFAULT_POLICY, POLICY);

// Dated, made-up finch inventory records. Seeded per tag so skipping a read never changes a later fixture.
function folio(tag, tokens) {
  let state = SEED;
  for (const c of tag) state = (Math.imul(state, 33) ^ c.charCodeAt(0)) >>> 0;
  const lines = []; let n = 0;
  while (n < tokens * 4) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const line = `${tag} row ${lines.length}: tray ${state % 233}, card ${state.toString(16)}, ${['ivory', 'plum', 'ochre', 'slate'][state >>> 30]} band. `;
    n += line.length; lines.push(line);
  }
  return lines.join('').slice(0, tokens * 4);
}
const textPart = (text) => ({ type: 'text', text });
const user = (content, timestamp) => ({ role: 'user', content, timestamp });
const call = (id, name, args) => ({ type: 'toolCall', id, name, arguments: args });
const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (part, timestamp) => ({ role: 'assistant', content: [part], api: 'openai-completions',
  provider: 'synthetic', model: 'offline', stopReason: part.type === 'toolCall' ? 'toolUse' : 'stop', usage: USAGE, timestamp });
const toolResult = (part, content, timestamp, details) => ({ role: 'toolResult', toolCallId: part.id,
  toolName: part.name, content: [textPart(content)], isError: false, timestamp, ...(details ? { details } : {}) });

function fixture(f) {
  const entries = [], sources = [], stamp = () => T0 + entries.length;
  function add(message) {
    const id = (entries.length + 1).toString(16).padStart(8, '0');
    entries.push({ type: 'message', id, parentId: entries.at(-1)?.id ?? null, timestamp: new Date(message.timestamp).toISOString(), message });
    return entries.at(-1);
  }
  function document(tag, size) { add(user(folio(tag, size), stamp())); add(assistant(textPart('Filed.'), stamp())); }
  function observe(tag, size) {
    add(user(`File the ${tag} observation.`, stamp()));
    const part = call(`file-${tag}`, 'observe_cards', { ledger: tag });
    add(assistant(part, stamp()));
    const entry = add(toolResult(part, folio(tag, size), stamp()));
    add(assistant(textPart('Filed.'), stamp()));
    return entry;
  }
  document(`${f.id}-charter`, f.prefix);
  for (let i = 0; i < f.oldN; ++i) sources.push(observe(`${f.id}-old-${i}`, f.oldSize));
  if (f.afterOld) document(`${f.id}-fixed`, f.afterOld);
  for (let i = 0; i < f.recentN; ++i) (f.recent === 'user' ? document : observe)(`${f.id}-recent-${i}`, f.recentSize);
  add(user('Confirm receipt of the finch registers.', stamp()));
  const growth = Array.from({ length: HORIZONS.at(-1) }, (_, t) => folio(`${f.id}-continuation-${t + 1}`, f.growth));
  return { ...f, entries, sources, growth, historyHash: hash(JSON.stringify(entries)) };
}

// Compare the complete serialized projected MESSAGE, not just text/ID or a hand-estimated suffix.
// All messages here are immutable JSON data; Pi can create fresh envelope objects around native edits.
const signatures = new WeakMap();
function signature(m) {
  if (!signatures.has(m)) signatures.set(m, { full: JSON.stringify(m), n: estimateTokens(m) });
  return signatures.get(m);
}
function view(p) {
  const sig = p.messages.map(signature);
  return { sig, size: sig.reduce((n, m) => n + m.n, 0) };
}
function prefix(a, b) {
  let n = 0;
  for (let i = 0; i < Math.min(a.sig.length, b.sig.length) && a.sig[i].full === b.sig[i].full; i++) n += a.sig[i].n;
  return n;
}
const CWD = '/synthetic-archive-cache-replay';
function preview(session, drafts) {
  const trial = SessionManager.inMemory(CWD, undefined, [session.getHeader(), ...session.getBranch()]);
  for (const d of drafts) {
    if (d.type === 'custom' && d.customType === ARCHIVE_TYPE) trial.appendCustomEntry(d.customType, d.data);
    else { assert.equal(d.type, 'context_edit'); trial.appendContextEdit(d.targetId, d.replacement); }
  }
  return trial;
}

// Simulate warm, ordinary idle-expiry (users 1,5,9,13 after 600 s), and KNOWN no-cache. On enabled
// runs a just-completed response is assumed fresh when deciding; the gate cannot foresee user idles.
// Append-only user growth and, on steps 1,4,7,10,13, an optional exact slice from one old source.
// An address oracle forces ONE 512-char native read per archived slice. Distinct, disjoint pages,
// not a gratuitous repeat fetch of a page already in context. No find/list, lookup mistakes or
// outside storage. Pay ALL subsequent input (including the second request, stub, real tool response
// and assistant slice). Fixed scripted reply content in every arm; not a measurement of recall skill.
function trajectory(f, position, cache, arm) {
  let session = SessionManager.inMemory(CWD, { id: 'offline' }, f.entries);
  const seed = view(session.buildSessionProjection()); assert(seed.size < f.window);
  let last = seed, overflowAt = '', overflowSize = 0;
  const rows = [], s = { done: 0, requests: 0, fresh: 0, hits: 0, warmBreaks: 0, lostPrefix: 0,
    expired: 0, probes: 0, reads: 0, batches: 0, targets: 0, released: 0, toLow: 0, deferred: 0,
    highNoPlan: 0, hardChecks: 0, hardNoPlan: 0, hardOverrides: 0, hardStill: 0, peakSent: 0 };
  const add = (msg) => session.appendMessage(msg);
  function send(task, kind) {
    const now = view(session.buildSessionProjection());
    if (now.size > f.window) { overflowAt = `${task}:${kind}`; overflowSize = now.size; return false; }
    const gap = kind === 'read' ? TOOL_GAP : cache === 'ttl' && (task - 1) % 4 === 0 ? EXPIRED_GAP : SHORT_GAP;
    const warm = cache !== 'off' && gap <= TTL, hit = warm ? prefix(last, now) : 0;
    s.requests++; s.fresh += now.size - hit; s.hits += hit; s.peakSent = Math.max(s.peakSent, now.size);
    if (warm && hit < last.size) { s.warmBreaks++; s.lostPrefix += last.size - hit; }
    if (!warm && cache !== 'off') s.expired++;
    last = now; return true;
  }
  function boundary() {
    if (arm === 'raw') return;
    const p = session.buildSessionProjection(), before = view(p);
    const hard = before.size >= HARD * f.window;
    if (hard) s.hardChecks++;
    const { entries } = planArchive(session.getBranch(), p.entries, f.window, DEFAULT_POLICY, { tokens: null, protectedTargets: new Set() });
    if (!entries.length) {
      if (before.size >= DEFAULT_POLICY.highWatermark * f.window) s.highNoPlan++;
      if (hard) { s.hardNoPlan++; s.hardStill++; }
      return;
    }
    const trial = preview(session, entries), after = view(trial.buildSessionProjection());
    const S = before.size - after.size, D = prefix(last, before) - prefix(last, after);
    const targets = entries.filter(d => d.type === 'context_edit').length;
    assert(S >= DEFAULT_POLICY.minBatchTokens && D >= 0 && targets >= 1 && targets <= DEFAULT_POLICY.maxTargets);
    const payback = cache === 'off' || 13 * S >= 9 * D;
    if (arm === 'gate' && !hard && !payback) { s.deferred++; return; }
    session = trial; s.batches++; s.targets += targets; s.released += S;
    if (after.size <= DEFAULT_POLICY.lowWatermark * f.window) s.toLow++;
    if (arm === 'gate' && hard && !payback) s.hardOverrides++;
    if (hard && after.size >= HARD * f.window) s.hardStill++;
  }
  add(assistant(textPart('Ready.'), T0 + 9000));
  const ix = { none: 0, early: 0, mid: Math.floor(f.oldN / 2), late: f.oldN - 1 }[position], source = f.sources[ix];
  function task(t) {
    // Boundaries here have a subsequent planned send (not counted gratuitously AFTER the final answer).
    boundary();
    const time = T0 + 10000 + t * 10, probe = position !== 'none' && (t - 1) % 3 === 0;
    const offsetInText = 256 + Math.floor((t - 1) / 3) * 768, limit = 512;
    const question = probe ? ` From the ${source.message.toolCallId} observation copy ${limit} chars at text offset ${offsetInText}.` : ' File these cards.';
    add(user(f.growth[t - 1] + question, time));
    if (!send(t, 'user')) return false;
    let answer = 'Filed.';
    if (probe) {
      s.probes++;
      const original = source.message.content[0].text, raw = JSON.stringify(source.message);
      const at = raw.indexOf(original); assert(at >= 0 && at === raw.lastIndexOf(original)); // ASCII fixture, no JSON escapes
      answer = original.slice(offsetInText, offsetInText + limit); assert.equal(answer.length, limit);
      const p = session.buildSessionProjection().entries.find(e => e.sourceEntry.id === source.id);
      assert.equal(p.messages.length, 1);
      if (p.messages[0].content[0].text !== original) {
        const digest = hash(raw); assert(p.messages[0].content[0].text.includes(`entryId=${source.id} sha256=${digest}`));
        const args = { action: 'read', entryId: source.id, sha256: digest, offset: at + offsetInText, limit };
        const part = call(`read-${t}`, RECALL_TOOL, args); add(assistant(part, time + 1));
        const result = recallArchive(session.getBranch(), args); assert.equal(result.payload, answer);
        add(toolResult(part, JSON.stringify(result), time + 2, result)); s.reads++;
        boundary();
        if (!send(t, 'read')) return false;
      }
    }
    add(assistant(textPart(answer), time + 3)); s.done++; return true;
  }
  function row(horizon) {
    return { fixture: f.id, position, cache, horizon, arm, window: f.window, seed: seed.size, ...s,
      eq10: (10 * s.fresh + s.hits) / 10, eq50: (2 * s.fresh + s.hits) / 2, overflowAt, overflowSize };
  }
  for (let t = 1; t <= HORIZONS.at(-1); ++t) {
    if (!task(t)) { for (const h of HORIZONS.filter(h => h >= t)) rows.push(row(h)); break; }
    if (HORIZONS.includes(t)) rows.push(row(t));
  }
  assert.deepEqual(rows.map(r => r.horizon), HORIZONS);
  return rows;
}

const fixtures = FIXTURES.map(fixture), rows = [];
for (const f of fixtures) for (const p of POSITIONS) for (const c of CACHES) for (const a of ['raw', 'stock', 'gate'])
  rows.push(...trajectory(f, p, c, a));
const metadata = { base: BASE, scriptSha256: fileHash(new URL(import.meta.url)), stockArchiveSha256: STOCK_SHA,
  sdkVersion, sessionManagerSha256: fileHash(sessionFile), compactionSha256: fileHash(costFile),
  seed: SEED, timestampStartMs: T0, policy: POLICY, gate: { forecastRequests: 4, cacheReadToFresh: .10, hardFraction: HARD },
  horizons: HORIZONS, cacheModes: CACHES, ttlSeconds: TTL, ordinaryGapSeconds: SHORT_GAP, idleGapSeconds: EXPIRED_GAP,
  idleEvery: 'users 1,5,9,13 in ttl', readGapSeconds: TOOL_GAP, readPriceRatios: PRICES, revisitSteps: [1,4,7,10,13],
  readChars: 512, textOffsets: '256 + 768*k, k=0..4', positions: POSITIONS, fixtures: FIXTURES.map((f,i) => ({ ...f, historySha256: fixtures[i].historyHash })),
  units: 'Per-arm incremental input for at most horizon tasks. Seed prefill estimated tokens excluded (add seed once for seed-inclusive cost). eq10/50=fresh+(.10/.50)*hits; reads=executed native read calls; requests=accepted follow-up inputs including read follow-ups. expired=TTL misses, not known cache-off. warmBreaks/lostPrefix=count/sum warm previous request tokens no longer reusable; lostPrefix includes removed tokens, not solely new prefill work. toLow=batches reaching <=50%; hardStill=hard boundaries ending >=90%, including hardNoPlan. RAW does not run boundaries. peakSent excludes seed; overflowAt=first blocked task:request kind and overflowSize=its estimated input, excluded from served costs. Do not compare incomplete totals as success.',
};

if (format === 'json') console.log(JSON.stringify({ metadata, rows }, null, 2));
else if (format === 'csv') {
  const keys = Object.keys(rows[0]); console.log(keys.join(','));
  for (const r of rows) console.log(keys.map(k => r[k]).join(','));
} else {
  console.log('Offline synthetic Pi 1.5.2 replay. No provider. Per-horizon input-equivalent estimated tokens; common cold seed excluded.');
  console.log('No-revisit, warm; each cell: tasks done / requested | edits(batches) | to <=50% | fresh + hits | eq10 | first blocked input.');
  console.log('fixture horizon seed arm: done batches low fresh hits eq10 overflow');
  for (const r of rows.filter(r => r.cache === 'warm' && r.position === 'none')) {
    console.log(`${r.fixture} ${r.horizon} ${r.seed} ${r.arm}: ${r.done} ${r.batches} ${r.toLow} ${r.fresh} ${r.hits} ${r.eq10} ${r.overflowAt ? `${r.overflowAt}=${r.overflowSize}` : '-'}`);
  }
  console.log('Gate vs stock across all 5 fixtures x 4 source positions per line (NOT samples of users). Compare only fully completed pairs.');
  console.log('cache horizon ratio cheaper/equal/dearer/incomplete');
  for (const c of CACHES) for (const h of HORIZONS) for (const price of PRICES) {
    const counts = [0,0,0,0], column = price === .1 ? 'eq10' : 'eq50';
    for (const g of rows.filter(r => r.arm === 'gate' && r.cache === c && r.horizon === h)) {
      const b = rows.find(r => r.fixture === g.fixture && r.position === g.position && r.cache === c && r.horizon === h && r.arm === 'stock');
      counts[g.done < h || b.done < h ? 3 : g[column] < b[column] ? 0 : g[column] > b[column] ? 2 : 1]++;
    }
    console.log(`${c} ${h} ${price.toFixed(2)} ${counts.join('/')}`);
  }
  console.log('Use csv/json for all rows, including TTL, forced reads, releases that miss 50%, and hard-pressure failures.');
}
