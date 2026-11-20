import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync, appendFileSync, ftruncateSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Collector, policyDigest, uploadsPausedText } from '../src/collector.ts';
import { loadConfig } from '../src/config.ts';
import { SqliteSpool, type Spool } from '../src/spool.ts';
import { encodeSnapshot, HttpIngester, sourceIdentity, sourceKey } from '../src/ingest.ts';
import { HttpUploader } from '../src/uploads.ts';
import { messageDigest, MessageChain, INITIAL_CHAIN } from '../src/chain.ts';
import { readerMemory, READ_BUFFER_BYTES } from '../src/lines.ts';
import { generateParts } from '../src/passes.ts';
import { parseTranscript } from '../src/parsers.ts';
import { resolveRuntimePrivacy } from '../src/runtime-privacy.ts';
import { formatCollectorStatus } from '../src/status.ts';
import { hash } from '../src/domain.ts';
import { noGit, syntheticSecrets } from './helpers.ts';
import { FakeChronicle } from './fake-server.ts';
import type { ProgressReporter } from '../src/progress.ts';
import { CollectorProgressAck } from '../../generated/typescript/chronicle/api/CollectorProgressAck.js';
import type { CollectorProgressUpdate } from '../../generated/typescript/chronicle/api/CollectorProgressUpdate.js';
import { UploadPhase } from '../../generated/typescript/chronicle/api/UploadPhase.js';

const MiB = 1_048_576;
const fixture = (name: string): string => readFileSync(new URL(`fixtures/${name}.jsonl`, import.meta.url), 'utf8');
const jsonl = (...records: unknown[]): string => records.map(record => JSON.stringify(record)).join('\n') + '\n';
const piHeader = (id: string, version = 3, cwd = '/synthetic/project') => ({ type: 'session', version, id, timestamp: '2026-01-01T00:00:00Z', cwd });
const piMessage = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ type: 'message', id, parentId: null, message: { role: 'user', content: [{ type: 'text', text }] }, ...extra });

async function harness(extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-parts-'));
  const roots = { pi: join(dir, 'pi'), claude: join(dir, 'claude'), codex: join(dir, 'codex') };
  for (const path of Object.values(roots)) mkdirSync(path);
  const token = join(dir, 'token'); writeFileSync(token, 'synthetic-parts-token', { mode: 0o600 });
  const server = new FakeChronicle(); await server.start();
  const input = (more: Record<string, unknown> = {}) => ({ enabled: true, endpoint: server.url, tokenFile: token, stateDir: join(dir, 'state'), homeDir: dir, discoverNative: false, discoverYolo: false, quietMs: 0,
    roots: Object.entries(roots).map(([format, path]) => ({ id: format, format, path })), ...extra, ...more });
  const settings = (more: Record<string, unknown> = {}) => loadConfig(input(more));
  const reports: CollectorProgressUpdate[] = [];
  const reporter: ProgressReporter = { async report(update) { reports.push(update); return new CollectorProgressAck(update.sequence, true); } };
  let spool: Spool = new SqliteSpool(join(dir, 'state'));
  // Every credential file reads as `secret.value`: changing it rotates the runtime privacy policy.
  const secret = { value: 'synthetic-default-credential' }; const secrets = { read: (_path: string) => secret.value };
  const collector = (more: Record<string, unknown> = {}) => { const config = settings(more); return new Collector(config, spool, new HttpIngester(config), () => 0, noGit, reporter, secrets, new HttpUploader(config)); };
  return {
    dir, roots, server, reports, input, settings, collector, secret,
    get spool() { return spool; },
    /** A restart: the spool reopened from disk. */
    reopen() { spool.close(); spool = new SqliteSpool(join(dir, 'state')); },
    run: (now: number, more: Record<string, unknown> = {}) => collector(more).runOnce(now),
    async close() { spool.close(); await server.close(); rmSync(dir, { recursive: true }); },
  };
}
const attemptsOf = (server: FakeChronicle, producer: string) => [...server.attempts.values()].filter(attempt => attempt.open.source.producerSessionId === producer);

test('UploadParts message chain v1 reproduces the golden vectors, U+0000 hashing as its stored six characters', () => {
  const vectors = JSON.parse(readFileSync(new URL('../../../../tests/message-chain-v1.json', import.meta.url), 'utf8')) as { initial: string; cases: { name: string; messages: { id: string; parentId: string | null; role: string; text: string; timestamp: string | null; recordIndex: number }[]; messageDigests: string[]; chains: string[] }[] };
  assert.equal(INITIAL_CHAIN, vectors.initial);
  for (const vector of vectors.cases) {
    const chain = new MessageChain();
    vector.messages.forEach((message, index) => {
      const digest = messageDigest(message); chain.extend(digest);
      assert.equal(digest.toString('hex'), vector.messageDigests[index], vector.name); assert.equal(chain.hex, vector.chains[index], vector.name);
    });
  }
});

test('UploadParts appends the delta to an unchanged prefix; a Pi v2→v3 rewrite, a Codex duplicate and a redaction change upload as replacements', async () => {
  const h = await harness();
  try {
    const a = join(h.roots.pi, 'a.jsonl'), b = join(h.roots.pi, 'b.jsonl'), c = join(h.roots.codex, 'c.jsonl');
    const aStart = jsonl(piHeader('pi-a'), piMessage('a1', 'alpha confidential phrase'), piMessage('a2', 'second'));
    writeFileSync(a, aStart);
    writeFileSync(b, jsonl(piHeader('pi-b', 2), piMessage('b1', 'bravo')));
    const codex = fixture('codex').trimEnd().split('\n'); writeFileSync(c, codex.slice(0, 9).join('\n') + '\n');
    const first = await h.run(1);
    assert.deepEqual([first.uploaded, first.replacements, first.uploadFailures, first.quarantined], [3, 3, 0, 0]);
    const aDelta = jsonl(piMessage('a3', 'third'), piMessage('a4', 'fourth'));
    appendFileSync(a, aDelta);
    writeFileSync(b, jsonl(piHeader('pi-b', 3), piMessage('b1', 'bravo'), piMessage('b2', 'rewritten by a newer Pi')));
    // A later response item makes the earlier event message a duplicate: the new prefix has one message less.
    appendFileSync(c, JSON.stringify({ timestamp: '2026-01-01T00:00:09Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'event-only unique' }] } }) + '\n');
    const second = await h.run(2);
    assert.deepEqual([second.uploaded, second.replacements, second.uploadFailures], [3, 2, 0]);
    const [, appended] = attemptsOf(h.server, 'pi-a');
    assert.ok(appended?.open.base !== undefined); assert.equal(appended.rawBytes, BigInt(Buffer.byteLength(aDelta)));
    assert.equal(attemptsOf(h.server, 'pi-b')[1]?.open.base, undefined);
    assert.equal(attemptsOf(h.server, 'codex-thread')[1]?.open.base, undefined);
    // Every upload committed the collector's declaration (the server's running digest equals it), and every open was
    // decided locally: none came back as a base mismatch.
    for (const attempt of h.server.attempts.values()) assert.equal(attempt.phase, UploadPhase.Committed);
    assert.equal(h.server.count('POST /api/ingest/uploads'), h.server.attempts.size);
    const third = await h.run(3, { redactions: { textPatterns: ['confidential phrase'] } });
    assert.deepEqual([third.uploaded, third.replacements, third.unchanged], [1, 1, 2]);
    assert.equal(attemptsOf(h.server, 'pi-a')[2]?.open.base, undefined);
  } finally { await h.close(); }
});

test('UploadParts preflight sends nothing for an excluded cwd or a mixed Claude identity in the last record', async () => {
  const h = await harness({ exclusions: { projects: ['/synthetic/excluded'] } });
  try {
    writeFileSync(join(h.roots.pi, 'p.jsonl'), jsonl(piHeader('pi-x'), piMessage('m1', 'one'), piMessage('m2', 'two', { cwd: '/synthetic/excluded/project' })));
    const claude = (sessionId: string, uuid: string) => ({ type: 'user', sessionId, uuid, message: { role: 'user', content: 'synthetic' } });
    writeFileSync(join(h.roots.claude, 'c.jsonl'), jsonl(claude('claude-1', 'u1'), claude('claude-1', 'u2'), claude('claude-2', 'u3')));
    const counters = await h.run(1);
    assert.deepEqual([counters.excluded, counters.quarantined, counters.enqueued], [1, 1, 0]);
    assert.ok(h.spool.diagnostics().some(diagnostic => diagnostic.code === 'mixed-session-identities'));
    assert.deepEqual([h.spool.uploads(), h.server.count('POST /api/ingest/uploads'), h.server.receivedParts.length], [[], 0, 0]);
  } finally { await h.close(); }
});

test('UploadParts recovers a lost commit acknowledgement from the stored declaration although the file changed since', async () => {
  const h = await harness();
  try {
    const path = join(h.roots.pi, 's.jsonl'); const content = jsonl(piHeader('pi-ack'), piMessage('m1', 'one'));
    writeFileSync(path, content);
    h.server.loseCommitAck = true;
    const lost = await h.run(1);
    assert.deepEqual([lost.uploaded, lost.uploadFailures, lost.pending], [0, 1, 1]);
    appendFileSync(path, jsonl(piMessage('m2', 'two')));
    // The attempt is gone from the server: only the open replay with the spooled declaration finds the receipt.
    h.server.forgetAttempts = true; h.reopen();
    const recovered = await h.run(2);
    assert.deepEqual([recovered.uploaded, recovered.waiting], [1, 1]);
    const key = [...h.server.heads.keys()][0]!;
    assert.deepEqual([h.spool.head(key).revision, h.spool.head(key).digest], [1, hash(content)]);
    h.server.forgetAttempts = false;
    assert.equal((await h.run(3)).uploaded, 1);
    assert.equal(h.spool.head(key).revision, 2); assert.ok(attemptsOf(h.server, 'pi-ack').at(-1)?.open.base !== undefined);
  } finally { await h.close(); }
});

test('UploadParts resumes after the last acknowledged part, and an expired attempt is replaced by a new one that receives every part again', async () => {
  const h = await harness();
  try {
    h.server.limits = h.server.limits.with({ maxPartBytes: 1024n });
    writeFileSync(join(h.roots.pi, 's.jsonl'), jsonl(piHeader('pi-resume'), ...Array.from({ length: 8 }, (_, index) => piMessage(`m${index}`, `synthetic message ${index} `.repeat(8)))));
    h.server.failPart = 1;
    const interrupted = await h.run(1);
    assert.deepEqual([interrupted.uploadFailures, interrupted.pending], [1, 1]);
    assert.equal(h.spool.uploads()[0]?.partsAcked, 1);
    h.reopen(); h.server.expirePart = 1;
    const before = h.server.count('POST /api/ingest/uploads/{id}/parts');
    assert.equal((await h.run(2)).uploaded, 1);
    const [expired, replacement] = attemptsOf(h.server, 'pi-resume');
    assert.deepEqual([expired?.phase, expired?.parts.length, replacement?.phase], [UploadPhase.Expired, 1, UploadPhase.Committed]);
    const resent = h.server.receivedParts.filter(part => part.uploadId === replacement!.uploadId).map(part => part.ordinal);
    assert.ok(resent.length > 2); assert.deepEqual(resent, [...resent.keys()]);
    // Part 0 of the first attempt was verified, not sent again: one request found it expired, then the new attempt's parts.
    assert.equal(h.server.count('POST /api/ingest/uploads/{id}/parts') - before, 1 + resent.length);
  } finally { await h.close(); }
});

test('UploadParts pauses at a server without the part-upload API with one actionable line, keeps entries unchanged and uploads after the upgrade', async () => {
  const h = await harness();
  try {
    writeFileSync(join(h.roots.pi, 's.jsonl'), jsonl(piHeader('pi-probe'), piMessage('m1', 'one')));
    h.server.failOpen = true;
    assert.equal((await h.run(1)).uploadFailures, 1);
    const entries = h.spool.uploads(); assert.equal(entries[0]?.attempts, 1);
    h.server.supportsUploads = false;
    const paused = await h.run(2);
    assert.deepEqual([paused.uploadFailures, paused.pending, paused.uploaded], [0, 1, 0]);
    assert.deepEqual(h.spool.uploads(), entries);
    assert.equal(h.reports.at(-1)?.error, 'server-upload-unsupported');
    const status = formatCollectorStatus(h.collector().status());
    assert.equal(status.split('\n')[0], uploadsPausedText(h.server.url));
    assert.match(status.split('\n')[0]!, /Uploads are paused: .* uploadProtocol = "whole" .*chronicle\.collector\.uploadProtocol/);
    h.server.supportsUploads = true;
    const resumed = await h.run(3);
    assert.deepEqual([resumed.uploaded, resumed.pending], [1, 0]);
    assert.equal(formatCollectorStatus(h.collector().status()).split('\n')[0], 'Chronicle collector: enabled (configuration)');
  } finally { await h.close(); }
});

test('UploadParts opens a spool of the current release: its queued whole payload drains through /api/ingest first, then parts replace and append', async () => {
  const h = await harness();
  try {
    const path = join(h.roots.pi, 's.jsonl'); const v1 = jsonl(piHeader('pi-drain'), piMessage('m1', 'one'));
    writeFileSync(path, v1);
    // Rows exactly as the current release writes them: no base fields, no upload buckets, a report without deferred counts.
    const config = h.settings(); const namespace = h.spool.namespace;
    const transcript = parseTranscript('pi', Buffer.from(v1), path, resolveRuntimePrivacy(config, syntheticSecrets).policy);
    const requestId = randomUUID(); const source = sourceIdentity(namespace, 'pi', 'pi', transcript, path); const key = sourceKey(source);
    const payload = encodeSnapshot(requestId, source, 0, transcript, 's.jsonl');
    const database = new DatabaseSync(join(h.dir, 'state', 'spool.sqlite'));
    try {
      const insert = database.prepare('INSERT INTO kv VALUES (?,?,?)');
      insert.run('pending', requestId, JSON.stringify({ requestId, sourceKey: key, sourceDigest: hash(transcript.raw), payload, payloadDigest: hash(payload), expectedRevision: 0, policyDigest: policyDigest(config, resolveRuntimePrivacy(config, syntheticSecrets).identity), attempts: 0, nextAt: 0, status: 'pending', error: null }));
      insert.run('pending-origin', requestId, JSON.stringify({ requestId, payloadDigest: hash(payload), sourceKey: key, origin: { kind: 'explicit' } }));
      insert.run('source-pending', key, JSON.stringify(requestId));
      insert.run('meta', 'last-report', JSON.stringify({ at: 0, counters: { enabled: true, discovered: 1, scanned: 1, scannedBytes: 1, waiting: 0, excluded: 0, unchanged: 0, enqueued: 1, uploaded: 0, uploadFailures: 0, quarantined: 0, pending: 1, stopped: 0, conflicts: 0 }, roots: [] }));
    } finally { database.close(); }
    h.reopen();
    assert.match(formatCollectorStatus(h.collector().status()), /Queue: 1 entries/);
    appendFileSync(path, jsonl(piMessage('m2', 'two')));
    const drained = await h.run(1);
    assert.deepEqual([drained.uploaded, drained.enqueued, drained.waiting], [1, 0, 1]);
    assert.deepEqual([h.server.ingested, h.server.count('POST /api/ingest/uploads')], [[requestId], 0]);
    assert.deepEqual(h.spool.head(key), { revision: 1, digest: hash(transcript.raw), tombstone: false });
    const replaced = await h.run(2);
    assert.deepEqual([replaced.uploaded, replaced.replacements], [1, 1]);
    appendFileSync(path, jsonl(piMessage('m3', 'three')));
    const appended = await h.run(3);
    assert.deepEqual([appended.uploaded, appended.replacements, h.spool.head(key).revision], [1, 0, 3]);
  } finally { await h.close(); }
});

test('UploadParts reads a 64 MiB session with a bounded line reader; a 2.5 MiB record travels in an ordinary part, a 9 MiB record alone in a large part', async () => {
  const h = await harness({ maxFileBytes: 80 * MiB, maxScanBytes: 80 * MiB, maxRecordBytes: 16 * MiB });
  try {
    const path = join(h.roots.pi, 'large.jsonl'); const descriptor = openSync(path, 'w');
    const text = (bytes: number, seed: number): string => `synthetic words ${seed} `.repeat(Math.ceil(bytes / 20)).slice(0, bytes);
    let written = 0; let index = 0;
    const write = (record: unknown): void => { const line = JSON.stringify(record) + '\n'; written += writeSync(descriptor, line); index++; };
    write(piHeader('pi-large'));
    write(piMessage('ordinary', text(2.5 * MiB, 0)));
    write(piMessage('large', text(9 * MiB, 1)));
    // The bulk is inline image data, which redaction drops without scanning: the reader still reads every byte twice.
    while (written < 64 * MiB) write({ type: 'message', id: `m${index}`, parentId: null, message: { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'A'.repeat(200_000 + (index % 7) * 50_000) }] } });
    closeSync(descriptor);
    readerMemory.highWater = 0;
    const counters = await h.run(1);
    assert.deepEqual([counters.uploaded, counters.quarantined, counters.uploadFailures], [1, 0, 0]);
    assert.ok(statSync(path).size >= 64 * MiB);
    // The reader held its buffer and the longest line, never the file.
    assert.ok(readerMemory.highWater >= 9 * MiB && readerMemory.highWater <= READ_BUFFER_BYTES + 16 * MiB, String(readerMemory.highWater));
    const parts = h.server.receivedParts;
    assert.deepEqual(parts.filter(part => part.large).map(part => [part.ordinal, part.records, part.announced]), [[1, 1, true]]);
    assert.ok(parts.every(part => part.large || part.bytes <= 8 * MiB));
    assert.ok(parts[0]!.bytes > 2.5 * MiB && !parts[0]!.large && parts[0]!.records === 2);
  } finally { await h.close(); }
});

test('UploadParts reports a record above maxRecordBytes once across three scans and uploads the session after the limit is raised', async () => {
  const h = await harness({ maxRecordBytes: MiB });
  try {
    const huge = piMessage('huge', 'x '.repeat(0.75 * MiB));
    writeFileSync(join(h.roots.pi, 's.jsonl'), jsonl(piHeader('pi-record'), piMessage('m1', 'one'), huge));
    const cycles = [await h.run(1), await h.run(2), await h.run(3)];
    assert.deepEqual(cycles.map(counters => [counters.quarantined, counters.scanned]), [[1, 0], [0, 0], [0, 0]]);
    assert.equal(h.reports.filter(report => report.error !== undefined).length, 1);
    assert.deepEqual([h.server.count('POST /api/ingest/uploads'), h.spool.uploads().length], [0, 0]);
    const status = formatCollectorStatus(h.collector().status());
    assert.ok(status.includes(`: record 2 is ${Buffer.byteLength(JSON.stringify(huge)).toLocaleString('en-US')} bytes, above the record limit of 1,048,576 bytes (collector maxRecordBytes). This session is not uploaded. Raise maxRecordBytes on the collector and on the server (both, at most 134,217,728) and it is uploaded at the next scan.`), status);
    const raised = await h.run(4, { maxRecordBytes: 2 * MiB });
    assert.deepEqual([raised.uploaded, h.spool.recordsOverLimit().length], [1, 0]);
  } finally { await h.close(); }
});

test('UploadParts refuses admission evidence over 1,024 distinct paths, over 1 MiB in total or with one path over 4,096 bytes, sending nothing', async () => {
  const h = await harness();
  try {
    const cwds = (prefix: string, count: number, width: number) => Array.from({ length: count }, (_, index) => piMessage(`m${index}`, 'synthetic', { cwd: `/${prefix}/${String(index).padStart(width, '0')}` }));
    writeFileSync(join(h.roots.pi, 'count.jsonl'), jsonl(piHeader('pi-count'), ...cwds('count', 1_025, 4)));
    writeFileSync(join(h.roots.pi, 'bytes.jsonl'), jsonl(piHeader('pi-bytes'), ...cwds('bytes', 300, 4_000)));
    writeFileSync(join(h.roots.pi, 'long.jsonl'), jsonl(piHeader('pi-long'), piMessage('m', 'synthetic', { cwd: '/long/' + 'x'.repeat(MiB) })));
    // Each value is under 4,096 bytes but normalizes to a short path: the retained values count, not only their aliases.
    writeFileSync(join(h.roots.pi, 'lexical.jsonl'), jsonl(piHeader('pi-lexical'), ...Array.from({ length: 300 }, (_, index) => piMessage(`m${index}`, 'synthetic', { cwd: `/lexical/${'./'.repeat(1_900)}p${index}` }))));
    const counters = await h.run(1);
    assert.deepEqual([counters.quarantined, counters.enqueued], [4, 0]);
    const refused = h.spool.diagnostics().filter(diagnostic => diagnostic.code === 'admission-evidence-limit');
    assert.equal(refused.length, 4);
    assert.ok(refused.some(diagnostic => diagnostic.values === 1_025 && diagnostic.measured! < MiB));
    assert.ok(refused.some(diagnostic => diagnostic.values! < 1_024 && diagnostic.measured! > MiB));
    assert.ok(refused.some(diagnostic => diagnostic.measured! > MiB && diagnostic.values! <= 3));
    assert.match(formatCollectorStatus(h.collector().status()), /admission-evidence-limit: .*of admission evidence over 1 MiB .* distinct paths \(limit 1,024\)/);
    assert.deepEqual([h.server.count('POST /api/ingest/uploads'), h.spool.uploads().length], [0, 0]);
  } finally { await h.close(); }
});

test('UploadParts regenerates parts at file offsets above 2^32 as bigint, in a sparse file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-sparse-'));
  try {
    const path = join(dir, 's.jsonl'); const offset = 2n ** 32n + 3n;
    const delta = jsonl(piMessage('m5', 'beyond four gibibytes'), piMessage('m6', 'still exact'));
    const descriptor = openSync(path, 'w'); ftruncateSync(descriptor, Number(offset)); writeSync(descriptor, delta, Number(offset)); closeSync(descriptor);
    const stat = statSync(path, { bigint: true });
    const file = { root: { id: 'sparse', format: 'pi' as const, path: dir, layout: 'transcripts' as const, profile: null, origin: { kind: 'explicit' as const } }, path, relativePath: 's.jsonl' };
    const parts = generateParts({ file, policy: resolveRuntimePrivacy(loadConfig({ enabled: false }), syntheticSecrets).policy, recordCap: MiB, maxMessages: 10,
      stat: { dev: String(stat.dev), ino: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) },
      startRecord: 5, startOffset: offset, baseChain: INITIAL_CHAIN, partBudget: 8 * MiB, maxLargePartBytes: 16 * MiB });
    const generated = [...{ [Symbol.iterator]: () => parts }];
    assert.equal(stat.size, offset + BigInt(Buffer.byteLength(delta)));
    assert.equal(generated.length, 1);
    const body = JSON.parse(generated[0]!.body) as { raw: string; messages: { id: string; recordIndex: number }[] };
    assert.deepEqual([body.raw, body.messages.map(message => [message.id, message.recordIndex])], [delta, [['m5', 5], ['m6', 6]]]);
  } finally { rmSync(dir, { recursive: true }); }
});

// A producer cut a surrogate pair: the raw lines hold the JSON escapes \ud83e and \udc00 (valid UTF-8); JSON.parse yields
// lone UTF-16 code units in a tool result and in the session name.
const loneSurrogates = (id: string): string => `{"type":"session","version":3,"id":"${id}","cwd":"/synthetic/project"}\n`
  + '{"type":"message","id":"t","parentId":null,"message":{"role":"toolResult","content":[{"type":"text","text":"cut \\ud83e\\nend"}]}}\n'
  + '{"type":"session_info","name":"title \\udc00"}\n';
const insertPending = (dir: string, rows: [string, string, unknown][]): void => {
  const database = new DatabaseSync(join(dir, 'state', 'spool.sqlite'));
  try { const insert = database.prepare('INSERT INTO kv VALUES (?,?,?)'); for (const [bucket, key, value] of rows) insert.run(bucket, key, JSON.stringify(value)); }
  finally { database.close(); }
};

test('UploadNormalization replaces lone surrogates the server refuses with U+FFFD in message text and title, in both protocols, keeps the raw digest and counts them per source', async () => {
  const h = await harness();
  try {
    const whole = loneSurrogates('pi-whole'), parts = loneSurrogates('pi-parts');
    writeFileSync(join(h.roots.pi, 'whole.jsonl'), whole);
    assert.deepEqual(await h.run(1, { uploadProtocol: 'whole' }).then(counters => [counters.uploaded, counters.stopped]), [1, 0]);
    writeFileSync(join(h.roots.pi, 'parts.jsonl'), parts);
    assert.deepEqual(await h.run(2).then(counters => [counters.uploaded, counters.unchanged]), [1, 1]);
    assert.deepEqual([h.server.texts, h.server.titles], [['cut \uFFFD\nend', 'cut \uFFFD\nend'], ['title \uFFFD', 'title \uFFFD']]);
    // The raw is the file's: its digest is unchanged, the escapes stay escapes.
    assert.deepEqual([...h.server.heads.values()].map(head => head.digest).sort(), [hash(whole), hash(parts)].sort());
    const status = formatCollectorStatus(h.collector().status());
    for (const key of h.server.heads.keys()) assert.ok(status.includes(`  ${key} · revision 1 · 2 code units`), status);
  } finally { await h.close(); }
});

test('UploadNormalization refuses a lone surrogate in an identifier locally, reports it once and reads the file again when it changes', async () => {
  const h = await harness();
  try {
    const a = join(h.roots.pi, 'a.jsonl'), b = join(h.roots.pi, 'b.jsonl');
    const session = (id: string, messageId: string, role: string) => `{"type":"session","version":3,"id":"${id}"}\n{"type":"message","id":"${messageId}","parentId":null,"message":{"role":"${role}","content":"synthetic"}}\n`;
    writeFileSync(a, session('pi-id', 'm\\ud800', 'user'));
    const cycles = [await h.run(1, { uploadProtocol: 'whole' }), await h.run(2, { uploadProtocol: 'whole' })];
    assert.deepEqual(cycles.map(counters => [counters.quarantined, counters.scanned, counters.uploadFailures]), [[1, 1, 0], [0, 0, 0]]);
    assert.equal(h.reports.filter(report => report.error !== undefined).length, 1);
    writeFileSync(b, session('pi-role', 'm', 'user\\udc01'));
    const third = await h.run(3);
    assert.deepEqual([third.quarantined, h.spool.diagnostics().map(diagnostic => diagnostic.code)], [1, ['invalid-identifier-unicode']]);
    assert.deepEqual([h.server.ingested.length, h.server.count('POST /api/ingest/uploads')], [0, 0]);
    assert.equal(formatCollectorStatus(h.collector().status()).match(/: an identifier holds an unpaired UTF-16 surrogate \(invalid-identifier-unicode\)/g)?.length, 2);
    writeFileSync(a, session('pi-id', 'm', 'user')); writeFileSync(b, session('pi-role', 'm', 'user'));
    assert.equal((await h.run(4)).uploaded, 2);
    assert.doesNotMatch(formatCollectorStatus(h.collector().status()), /invalid-identifier-unicode/);
  } finally { await h.close(); }
});

test('UploadNormalization --retry rebuilds from its file a stopped payload that predates the normalization, without tombstoning the source', async () => {
  const h = await harness({ uploadProtocol: 'whole' });
  try {
    const path = join(h.roots.pi, 's.jsonl'); const raw = loneSurrogates('pi-stopped'); writeFileSync(path, raw);
    // The payload an earlier release built from this file, with the lone surrogates; the server refused it and it stopped.
    const config = h.settings(); const privacy = resolveRuntimePrivacy(config, syntheticSecrets);
    const transcript = parseTranscript('pi', Buffer.from(raw), path, privacy.policy);
    const earlier = { ...transcript, messages: transcript.messages.map(message => ({ ...message, text: 'cut \ud83e\nend' })), metadata: { ...transcript.metadata, title: 'title \udc00' } };
    const requestId = randomUUID(); const source = sourceIdentity(h.spool.namespace, 'pi', 'pi', transcript, path); const key = sourceKey(source);
    const payload = encodeSnapshot(requestId, source, 0, earlier, 's.jsonl');
    await assert.rejects(new HttpIngester(config).send(payload), /protocol-rejected/);
    insertPending(h.dir, [
      ['pending', requestId, { requestId, sourceKey: key, sourceDigest: hash(raw), payload, payloadDigest: hash(payload), expectedRevision: 0, policyDigest: policyDigest(config, privacy.identity), attempts: 1, nextAt: 0, status: 'stopped', error: 'protocol-rejected' }],
      ['pending-origin', requestId, { requestId, payloadDigest: hash(payload), sourceKey: key, origin: { kind: 'explicit' } }], ['source-pending', key, requestId]]);
    const configPath = join(h.dir, 'collector.json'); writeFileSync(configPath, JSON.stringify(h.input()));
    const retried = spawnSync(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)), '--config', configPath, '--retry', requestId], { encoding: 'utf8' });
    assert.equal(retried.status, 0, retried.stderr);
    assert.ok(retried.stdout.startsWith(`Rebuilding ${requestId} from its file at the next scan: its payload predates the collector's Unicode normalization.\n`), retried.stdout);
    assert.deepEqual([h.spool.queue(), h.spool.head(key).tombstone, h.spool.dropped().map(entry => entry.reason)], [[], false, ['retry-rebuild']]);
    assert.equal((await h.run(1)).uploaded, 1);
    assert.deepEqual([h.server.heads.get(key)?.digest, h.server.texts], [hash(raw), ['cut \uFFFD\nend']]);
  } finally { await h.close(); }
});

for (const variant of ['privacy rotated during a part', 'paused during the commit', 'excluded during a part'] as const) {
  test(`UploadParts asks the policy and live controls again before reopening an expired attempt: ${variant}`, async () => {
    const h = await harness();
    try {
      h.server.limits = h.server.limits.with({ maxPartBytes: 1024n });
      writeFileSync(join(h.roots.pi, 's.jsonl'), jsonl(piHeader('pi-expiry'), ...Array.from({ length: 4 }, (_, index) => piMessage(`m${index}`, `synthetic message ${index} `.repeat(8)))));
      // The change happens while the request that finds the attempt expired awaits its answer.
      h.server.onExpire = () => {
        if (variant === 'privacy rotated during a part') h.secret.value = 'synthetic-rotated-credential';
        else if (variant === 'paused during the commit') h.spool.setPaused(true);
        else h.spool.exclude(h.roots.pi);
      };
      if (variant === 'paused during the commit') h.server.expireCommit = true; else h.server.expirePart = 1;
      const counters = await h.run(1);
      assert.deepEqual([counters.uploaded, h.server.count('POST /api/ingest/uploads'), h.server.attempts.size], [0, 1, 1]);
      assert.equal(h.spool.uploads().length, 1);
    } finally { await h.close(); }
  });
}

test('UploadParts acknowledges a commit that wins against its abort, and keeps the intent while an abort is unconfirmed', async () => {
  const h = await harness();
  try {
    const path = join(h.roots.pi, 's.jsonl'); const content = jsonl(piHeader('pi-abort'), piMessage('m1', 'one'));
    writeFileSync(path, content);
    // The commit arrives but is not applied yet, and its answer is lost: the attempt still reads Open.
    h.server.delayCommit = true;
    assert.deepEqual(await h.run(1).then(counters => [counters.uploaded, counters.uploadFailures]), [0, 1]);
    appendFileSync(path, jsonl(piMessage('m2', 'two')));
    // The file changed, so the open attempt is aborted; an abort that fails leaves the intent unresolved, not given up.
    h.server.failAbort = true;
    assert.deepEqual(await h.run(2).then(counters => [counters.uploaded, counters.pending]), [0, 1]);
    const key = [...h.server.attempts.values()][0]!.key;
    assert.equal(h.spool.head(key).revision, 0);
    // The delayed commit wins against the next abort, which answers Committed with the receipt.
    assert.equal((await h.run(3)).uploaded, 1);
    assert.deepEqual([h.spool.head(key).revision, h.spool.head(key).digest], [1, hash(content)]);
    const appended = await h.run(4);
    assert.deepEqual([appended.uploaded, appended.conflicts, h.spool.head(key).revision], [1, 0, 2]);
  } finally { await h.close(); }
});

test('UploadParts enters record-over-limit only on the server code record-too-large; another 413 is an ordinary failure', async () => {
  const h = await harness();
  try {
    h.server.limits = h.server.limits.with({ maxPartBytes: 1024n });
    writeFileSync(join(h.roots.pi, 'a.jsonl'), jsonl(piHeader('pi-ingress'), ...Array.from({ length: 4 }, (_, index) => piMessage(`m${index}`, `synthetic message ${index} `.repeat(8)))));
    // A proxy in front of the server refuses one single-record part, far below every record limit.
    h.server.rawTooLarge = 1;
    const refused = await h.run(1);
    assert.deepEqual([refused.uploadFailures, refused.quarantined, refused.pending, h.spool.recordsOverLimit().length], [1, 0, 1, 0]);
    assert.equal(h.spool.uploads()[0]?.error, 'http-413');
    assert.equal((await h.run(2)).uploaded, 1);
    h.server.partRecordCap = 1_500n;
    writeFileSync(join(h.roots.pi, 'b.jsonl'), jsonl(piHeader('pi-record-cap'), piMessage('long', 'synthetic '.repeat(200))));
    const capped = await h.run(3);
    assert.deepEqual([capped.quarantined, capped.uploadFailures, h.spool.recordsOverLimit().map(row => [row.limitSource, row.recordIndex])], [1, 0, [['server', 1]]]);
    const opens = h.server.count('POST /api/ingest/uploads');
    assert.deepEqual([(await h.run(4)).quarantined, h.server.count('POST /api/ingest/uploads')], [0, opens]);
  } finally { await h.close(); }
});

test('UploadParts sends a part again once when the server closed the pooled connection under it', async () => {
  const h = await harness();
  try {
    h.server.limits = h.server.limits.with({ maxPartBytes: 1024n });
    writeFileSync(join(h.roots.pi, 's.jsonl'), jsonl(piHeader('pi-reset'), ...Array.from({ length: 4 }, (_, index) => piMessage(`m${index}`, `synthetic message ${index} `.repeat(8)))));
    h.server.resetNext = 'POST /api/ingest/uploads/{id}/parts';
    const counters = await h.run(1);
    assert.deepEqual([counters.uploaded, counters.uploadFailures, h.server.resetNext], [1, 0, null]);
  } finally { await h.close(); }
});
