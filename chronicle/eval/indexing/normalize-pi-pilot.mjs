// Opt-in local-only pilot. No collector config, credentials, progress, upload, or Git enrichment.
import assert from 'node:assert/strict';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  opendirSync, readFileSync, readSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { parseTranscript } from '../../collector/src/parsers.ts';
import { privacyPolicy } from '../../collector/src/privacy.ts';

const day = 24 * 60 * 60 * 1000;
const rawMin = 256;
const rawMax = 256 * 1024;
const textMax = 96 * 1024;
const maxMessages = 256;
const maxEntries = 12000;
const maxExamined = 240;
const count = 5;
const uid = BigInt(process.getuid());
const policy = privacyPolicy({ fieldNames: [], textPatterns: [] });
const stat = path => lstatSync(path, { bigint: true });
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const owned = info => info.uid === uid;
const stable = (a, b) => sameFile(a, b) && owned(b) && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const under = (root, path) => path.startsWith(root + sep);
const eligible = (info, cutoff) => owned(info) && info.isFile() && info.nlink === 1n &&
  info.mtimeMs <= cutoff && info.size >= BigInt(rawMin) && info.size <= BigInt(rawMax);

function discover(root, excluded, cutoff) {
  const stack = [{ path: root, depth: 0 }];
  const candidates = [];
  let entries = 0;
  while (stack.length) {
    const { path, depth } = stack.pop();
    const info = stat(path);
    if (!owned(info) || !info.isDirectory() || realpathSync(path) !== path) continue;
    const dir = opendirSync(path);
    try {
      for (let entry; (entry = dir.readSync()) !== null;) {
        if (++entries > maxEntries) throw new Error(); // Never silently sample an arbitrary prefix.
        const child = join(path, entry.name);
        if (entry.isDirectory() && depth < 4) stack.push({ path: child, depth: depth + 1 });
        else if (entry.isFile() && entry.name.endsWith('.jsonl') && child !== excluded.path) {
          const file = stat(child);
          if (eligible(file, cutoff) && !sameFile(file, excluded.info)) candidates.push({ path: child, info: file });
        }
      }
    } finally { dir.closeSync(); }
  }
  // Interleave raw-size bands before reading any contents; take newest quiescent entries within each band.
  const bins = [[], [], []];
  for (const candidate of candidates) bins[band(Number(candidate.info.size))].push(candidate);
  for (const bin of bins) bin.sort((a, b) => Number(b.info.mtimeMs - a.info.mtimeMs) || (a.path < b.path ? -1 : 1));
  const ordered = [];
  for (let i = 0; ordered.length < maxExamined && bins.some(bin => i < bin.length); ++i) {
    for (const bin of bins) if (i < bin.length && ordered.length < maxExamined) ordered.push(bin[i]);
  }
  return ordered;
}

function readCandidate(root, candidate, excluded, cutoff) {
  const { path, info } = candidate;
  if (!under(root, path) || realpathSync(path) !== path) return null;
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    // Linux fd canonicalization verifies the actual opened object, not only the lookup before open.
    const fdPath = `/proc/self/fd/${fd}`;
    if (!eligible(before, cutoff) || !stable(info, before) || sameFile(before, excluded.info) ||
        realpathSync(fdPath) !== path) return null;
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const n = readSync(fd, bytes, length, bytes.length - length, null);
      if (!n) break;
      length += n;
    }
    if (length !== Number(before.size) || !stable(before, fstatSync(fd, { bigint: true })) ||
        realpathSync(fdPath) !== path || realpathSync(path) !== path || !stable(before, stat(path))) return null;
    const parsed = parseTranscript('pi', bytes.subarray(0, length), path, policy);
    if (parsed.subagentId !== null) return null;
    const terminal = parsed.records.findLast(row => row.value.type === 'message')?.value.message;
    // Pi has no durable harness-closed marker. The unchanged file and a normal assistant stop
    // are a conservative completed-turn proxy, not proof that no process can resume it.
    if (terminal?.role !== 'assistant' || terminal.stopReason !== 'stop') return null;
    const rows = parsed.messages.map(({ role, text }) => [role, text]);
    if (!rows.some(([role]) => role === 'user') || rows.length > maxMessages ||
        rows.some(([role, text]) => !role.length || role.length > 64 || role.includes('\0') || text.includes('\0'))) return null;
    const textBytes = rows.reduce((sum, [, text]) => sum + Buffer.byteLength(text), 0);
    if (textBytes < rawMin || textBytes > textMax) return null;
    return { project: dirname(path), textBytes, rows };
  } finally { closeSync(fd); }
}

const band = size => size <= 8 * 1024 ? 0 : size <= 32 * 1024 ? 1 : 2;
function select(root, active, now) {
  if (!isAbsolute(active) || realpathSync(root) !== root || !owned(stat(root)) || !stat(root).isDirectory()) throw new Error();
  const activePath = resolve(active);
  const activeInfo = stat(activePath);
  if (!activeInfo.isFile() || !owned(activeInfo) || realpathSync(activePath) !== activePath) throw new Error();
  const excluded = { path: activePath, info: activeInfo };
  const cutoff = BigInt(now - day);
  const bins = [[], [], []];
  // Keep at most five distinct projects plus same-band fallback rows. All other normalized text is discarded.
  for (const file of discover(root, excluded, cutoff)) {
    if (bins.every(bin => new Set(bin.map(row => row.project)).size >= count)) break;
    let item;
    try { item = readCandidate(root, file, excluded, cutoff); } catch { continue; }
    if (item === null) continue;
    const bin = bins[band(item.textBytes)];
    if (bin.length < count || (bin.length < count * 2 && !bin.some(other => other.project === item.project))) bin.push(item);
  }
  const chosen = [];
  // First make a pass over the available size bands, preferring a fresh project. Then fill remaining slots.
  for (const i of [0, 1, 2]) {
    const bin = bins[i];
    const fresh = bin.findIndex(row => !chosen.some(other => other.project === row.project));
    if (bin.length) chosen.push(...bin.splice(Math.max(0, fresh), 1));
  }
  while (chosen.length < count) {
    const all = bins.flat();
    const item = all.find(row => !chosen.some(other => other.project === row.project)) ?? all[0];
    if (item === undefined) throw new Error();
    const bin = bins[band(item.textBytes)];
    bin.splice(bin.indexOf(item), 1);
    chosen.push(item);
  }
  return { schema: 'local-pi-pilot-v1', sessions: chosen.map(item => item.rows) };
}

function output(out, result) {
  if (!isAbsolute(out)) throw new Error();
  const parent = dirname(out);
  const info = stat(parent);
  if (!info.isDirectory() || !owned(info) || (info.mode & 0o077n) !== 0n || realpathSync(parent) !== parent) throw new Error();
  writeFileSync(out, JSON.stringify(result) + '\n', { flag: 'wx', mode: 0o600 });
}

// Specified-origin fixture only: never resolve the real session root on this branch.
function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'local-pi-pilot-fixture-'));
  try {
    const root = join(tmp, 'sessions');
    mkdirSync(root);
    const now = Date.now();
    function session(i, n, stop = 'stop', time = now - 2 * day) {
      const dir = join(root, 'synthetic-project-' + i);
      mkdirSync(dir);
      const path = join(dir, 'synthetic.jsonl');
      const records = [{ type: 'session', id: `fixture-${i}`, version: 3 },
        { type: 'message', message: { role: 'user', content: [{ type: 'text', text: `Synthetic queue validation ${i}: café 🐎. ` },
          { type: 'toolCall', name: 'fixture', arguments: { password: 'synthetic-private-literal' } }] } },
        { type: 'message', message: { role: 'assistant', stopReason: stop, content: 'Fixture reply. '.repeat(n) } }];
      writeFileSync(path, records.map(x => JSON.stringify(x)).join('\n') + '\n');
      utimesSync(path, time / 1000, time / 1000);
      return path;
    }
    const active = session(0, 100);
    session(1, 100); session(2, 700); session(3, 2500); session(4, 100); session(5, 100);
    session(6, 100, 'error'); session(7, 100, 'stop', now);
    const outside = join(tmp, 'outside.jsonl');
    writeFileSync(outside, readFileSync(active, 'utf8').replace('validation 0:', 'validation 8:'));
    utimesSync(outside, (now - 2 * day) / 1000, (now - 2 * day) / 1000);
    symlinkSync(outside, join(root, 'linked.jsonl'));
    assert(!discover(root, { path: active, info: stat(active) }, BigInt(now - day)).some(row => row.path.endsWith('/linked.jsonl')));
    const result = select(root, active, now);
    assert.equal(result.sessions.length, count);
    assert.deepEqual(new Set(result.sessions.map(rows => band(rows.reduce((n, [, text]) => n + Buffer.byteLength(text), 0)))), new Set([0, 1, 2]));
    const serialized = JSON.stringify(result);
    assert(serialized.includes('café 🐎') && serialized.includes('[REDACTED]') && !serialized.includes('synthetic-private-literal'));
    for (const i of [0, 6, 7, 8]) assert(!serialized.includes(`validation ${i}:`));
    const out = join(tmp, 'normalized.json');
    output(out, result);
    assert.equal(stat(out).mode & 0o777n, 0o600n);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), result);
    assert.throws(() => output(out, result));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') {
    selfTest();
    console.log('Local Pi pilot normalization self-test passed');
  } else if (args.length === 2) {
    output(args[1], select(join(homedir(), '.pi', 'agent', 'sessions'), args[0], Date.now()));
  } else throw new Error();
} catch {
  // Parser/filesystem/lookup diagnostics may contain input or paths; never print them.
  console.error('Local Pi pilot normalization failed (invalid setup or fewer than five eligible files)');
  process.exitCode = 1;
}
