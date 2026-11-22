import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync, appendFileSync, ftruncateSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Collector, COLLECTION_PAUSED_TEXT, policyDigest, uploadsPausedText } from '../src/collector.ts';
import { loadConfig } from '../src/config.ts';
import { SqliteSpool, type Spool } from '../src/spool.ts';
import { encodeSnapshot, HttpIngester, sourceIdentity, sourceKey } from '../src/ingest.ts';
import { HttpUploader } from '../src/uploads.ts';
import { messageDigest, MessageChain, INITIAL_CHAIN } from '../src/chain.ts';
import { lineReads, readerMemory, READ_BUFFER_BYTES } from '../src/lines.ts';
import { generateParts } from '../src/passes.ts';
import { parseTranscript } from '../src/parsers.ts';
import { resolveRuntimePrivacy } from '../src/runtime-privacy.ts';
import { formatCollectorStatus, PAUSE_NOTICE_INTERVAL_MS, PauseNotices } from '../src/status.ts';
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
  // The backoff jitter, in [0, 1).
  const jitter = { value: 0 };
  const collector = (more: Record<string, unknown> = {}) => { const config = settings(more); return new Collector(config, spool, new HttpIngester(config), () => jitter.value, noGit, reporter, secrets, new HttpUploader(config)); };
  return {
    dir, roots, server, reports, input, settings, collector, secret, jitter,
    get spool() { return spool; },
    /** A restart: the spool reopened from disk. */
    reopen() { spool.close(); spool = new SqliteSpool(join(dir, 'state')); },
    run: (now: number, more: Record<string, unknown> = {}) => collector(more).runOnce(now),
    async close() { spool.close(); await server.close(); rmSync(dir, { recursive: true }); },
  };
}
const attemptsOf = (server: FakeChronicle, producer: string) => [...server.attempts.values()].filter(attempt => attempt.open.source.producerSessionId === producer);
/** `--status --json`'s record of the latest pass 1 over the only discovered file. */
const lastPass = (h: { collector: () => Collector }) => { const sources = h.collector().status().sources; assert.equal(sources.length, 1); return sources[0]!.lastPass; };

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
    const passes = new Map(h.collector().status().sources.map(source => [source.pathId, source.lastPass]));
    assert.deepEqual([a, b, c].map(path => [passes.get(hash(path))?.kind, passes.get(hash(path))?.reason]), [['incremental', null], ['full', 'source-prefix-changed'], ['full', 'codex-full-pass']]);
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

test('UploadParts pauses at a server without the part-upload API with one actionable line, in the journal at most hourly, keeps entries unchanged and uploads after the upgrade', async () => {
  const h = await harness();
  try {
    writeFileSync(join(h.roots.pi, 's.jsonl'), jsonl(piHeader('pi-probe'), piMessage('m1', 'one')));
    h.server.failOpen = true;
    const notices = new PauseNotices(h.server.url);
    const failed = await h.run(1);
    assert.deepEqual([failed.uploadFailures, failed.paused, notices.next(failed.paused, 1)], [1, null, null]);
    const entries = h.spool.uploads(); assert.equal(entries[0]?.attempts, 1);
    h.server.supportsUploads = false;
    const paused = await h.run(2);
    assert.deepEqual([paused.uploadFailures, paused.pending, paused.uploaded, paused.paused], [0, 1, 0, 'server-upload-unsupported']);
    assert.equal(notices.next(paused.paused, 2), `server-upload-unsupported: ${uploadsPausedText(h.server.url)}`);
    for (const now of [3, 2 + PAUSE_NOTICE_INTERVAL_MS - 1]) assert.equal(notices.next((await h.run(now)).paused, now), null, String(now));
    const hour = 2 + PAUSE_NOTICE_INTERVAL_MS;
    assert.equal(notices.next((await h.run(hour)).paused, hour), `server-upload-unsupported since 1970-01-01T00:00:00.002Z: ${uploadsPausedText(h.server.url)}`);
    assert.deepEqual(h.spool.uploads(), entries);
    assert.equal(h.reports.at(-1)?.error, 'server-upload-unsupported');
    const status = formatCollectorStatus(h.collector().status());
    assert.equal(status.split('\n')[0], uploadsPausedText(h.server.url));
    assert.match(status.split('\n')[0]!, /Uploads are paused: .* uploadProtocol = "whole" .*chronicle\.collector\.uploadProtocol/);
    h.server.supportsUploads = true;
    const resumed = await h.run(hour + 1);
    assert.deepEqual([resumed.uploaded, resumed.pending, resumed.paused], [1, 0, null]);
    assert.equal(notices.next(resumed.paused, hour + 1), 'Uploads are no longer paused: server-upload-unsupported ended (since 1970-01-01T00:00:00.002Z).');
    assert.equal(formatCollectorStatus(h.collector().status()).split('\n')[0], 'Chronicle collector: enabled (configuration)');
    // --pause holds every upload back without a failure too: the same lines.
    h.spool.setPaused(true);
    const held = await h.run(hour + 2);
    assert.deepEqual([held.paused, notices.next(held.paused, hour + 2), notices.next(held.paused, hour + 3)], ['collection-paused', `collection-paused: ${COLLECTION_PAUSED_TEXT}`, null]);
    h.spool.setPaused(false);
    assert.equal(notices.next((await h.run(hour + 4)).paused, hour + 4), `Uploads are no longer paused: collection-paused ended (since ${new Date(hour + 2).toISOString()}).`);
  } finally { await h.close(); }
});

test('UploadParts does not read a source with a queued intent while uploads are paused: a file appended to, or rewritten in place by another session, is identified after the upgrade and its current bytes archived; a new file is read once', async () => {
  const h = await harness();
  try {
    const stale = join(h.roots.pi, 'stale.jsonl'), swapped = join(h.roots.pi, 'swapped.jsonl'), fresh = join(h.roots.pi, 'fresh.jsonl');
    const keyOf = (path: string) => sourceKey(sourceIdentity(h.spool.namespace, 'pi', 'pi', parseTranscript('pi', readFileSync(path), path, resolveRuntimePrivacy(h.settings(), syntheticSecrets).policy), path));
    h.server.supportsUploads = false;
    writeFileSync(stale, jsonl(piHeader('pi-stale'), piMessage('m1', 'planned during the pause')));
    writeFileSync(swapped, jsonl(piHeader('pi-swapped-old'), piMessage('m1', 'planned during the pause')));
    assert.deepEqual(await h.run(1).then(counters => [counters.scanned, counters.enqueued, counters.paused]), [2, 2, 'server-upload-unsupported']);
    appendFileSync(stale, jsonl(piMessage('m2', 'written during the pause')));
    // Another session written over the file in place: same inode, not shorter.
    const before = statSync(swapped); writeFileSync(swapped, jsonl(piHeader('pi-swapped-new'), piMessage('n1', 'another session, written in place during the pause')));
    assert.deepEqual([statSync(swapped).ino, statSync(swapped).size >= before.size], [before.ino, true]);
    writeFileSync(fresh, jsonl(piHeader('pi-fresh'), piMessage('f1', 'new during the pause')));
    lineReads.bytes = 0n;
    const paused = await h.run(2);
    // Only the new source is read (once) and planned; both changed files with a queued intent wait unread.
    assert.deepEqual([paused.scanned, paused.enqueued, paused.waiting, lineReads.bytes], [1, 1, 2, BigInt(statSync(fresh).size)]);
    h.server.supportsUploads = true;
    // Both changed files are read again and their intents aborted when sent; the other session is a new source, uploaded at once.
    const upgraded = await h.run(3);
    assert.deepEqual([upgraded.scanned, upgraded.uploaded, h.spool.dropped().map(entry => entry.reason)], [2, 2, ['source-changed', 'source-changed']]);
    assert.equal((await h.run(4)).uploaded, 1);
    assert.deepEqual([...h.server.heads.keys()].sort(), [stale, swapped, fresh].map(keyOf).sort());
    for (const path of [stale, swapped, fresh]) assert.equal(h.server.heads.get(keyOf(path))?.digest, hash(readFileSync(path)), path);
  } finally { await h.close(); }
});

test('UploadParts reads the changed file of a stopped intent as before, and of a backed-off intent once its backoff ends: another session there is planned and uploaded, the stopped intent is not retried', async () => {
  const h = await harness();
  try {
    const backoff = join(h.roots.pi, 'backoff.jsonl'), renamed = join(h.roots.pi, 'renamed.jsonl'), shortened = join(h.roots.pi, 'shortened.jsonl'), rewritten = join(h.roots.pi, 'rewritten.jsonl');
    const passAt = (path: string) => h.collector().status().sources.find(source => source.pathId === hash(path))?.lastPass.at;
    // The open answers 503 and the jitter is at its maximum: the intent backs off until 1,000.
    writeFileSync(backoff, jsonl(piHeader('pi-backoff'), piMessage('b1', 'one')));
    h.server.failOpen = true; h.jitter.value = 0.999;
    assert.deepEqual(await h.run(1).then(counters => [counters.pending, counters.uploadFailures]), [1, 1]);
    assert.equal(h.spool.uploads()[0]?.nextAt, 1_000);
    // The server refuses declarations of three messages: these intents stop.
    h.server.limits = h.server.limits.with({ maxMessages: 2 });
    const three = (id: string) => jsonl(piHeader(id), piMessage('a', 'one'), piMessage('b', 'two'), piMessage('c', 'three'));
    writeFileSync(renamed, three('pi-old-renamed')); writeFileSync(shortened, three('pi-old-shortened')); writeFileSync(rewritten, three('pi-old-rewritten'));
    assert.deepEqual(await h.run(2).then(counters => [counters.stopped, counters.uploadFailures]), [3, 3]);
    const stopped = h.spool.uploads().filter(entry => entry.status === 'stopped');
    // Another session takes each path: renamed over it (another inode), rewritten in place shorter, rewritten in place not shorter.
    writeFileSync(`${renamed}.new`, jsonl(piHeader('pi-new-renamed'), piMessage('n1', 'another session'))); renameSync(`${renamed}.new`, renamed);
    writeFileSync(shortened, jsonl(piHeader('pi-new-shortened'), piMessage('n1', 'another')));
    const before = statSync(rewritten); writeFileSync(rewritten, jsonl(piHeader('pi-new-rewritten'), piMessage('n1', 'another session, written over the old one in place. '.repeat(8))));
    assert.deepEqual([statSync(rewritten).ino, statSync(rewritten).size >= before.size], [before.ino, true]);
    appendFileSync(backoff, jsonl(piMessage('b2', 'two')));
    const opens = h.server.count('POST /api/ingest/uploads');
    const flowing = await h.run(3);
    assert.deepEqual([flowing.scanned, flowing.enqueued, flowing.uploaded, flowing.waiting, h.server.count('POST /api/ingest/uploads') - opens], [3, 3, 3, 1, 3]);
    assert.deepEqual(h.spool.uploads().filter(entry => entry.status === 'stopped'), stopped);
    assert.deepEqual([...h.server.heads.values()].map(head => head.digest).sort(), [renamed, shortened, rewritten].map(path => hash(readFileSync(path))).sort());
    // Backed off, the grown file was not read; once the backoff is over it is read, and its intent aborted when sent.
    assert.equal(passAt(backoff), 1);
    await h.run(1_000);
    assert.deepEqual([passAt(backoff), h.spool.dropped().map(entry => entry.reason)], [1_000, ['source-changed']]);
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
    // /api/ingest, the probes and the part-upload requests each travel on their own connection.
    assert.equal(h.server.connections, h.server.requests.length);
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


test('UploadParts append parses only the addition; an in-place edit of an old line is detected at the next upload and becomes a replacement', async () => {
  const h = await harness();
  try {
    const path = join(h.roots.pi, 's.jsonl');
    writeFileSync(path, jsonl(piHeader('pi-edit'), piMessage('m1', 'original old line'), piMessage('m2', 'two')));
    assert.equal((await h.run(1)).uploaded, 1);
    const before = BigInt(statSync(path).size); const delta = jsonl(piMessage('m3', 'three')); appendFileSync(path, delta);
    const appended = await h.run(2);
    assert.deepEqual([appended.uploaded, appended.replacements], [1, 0]);
    assert.deepEqual(lastPass(h), { kind: 'incremental', reason: null, parsedBytes: String(Buffer.byteLength(delta)), hashedBytes: String(before), at: 2 });
    // The same number of bytes rewritten in place (same inode), then an append: only the prefix hash can tell.
    const checkpoint = BigInt(statSync(path).size); const offset = readFileSync(path).indexOf('original');
    const descriptor = openSync(path, 'r+'); writeSync(descriptor, 'REDACTED', offset); closeSync(descriptor);
    appendFileSync(path, jsonl(piMessage('m4', 'four')));
    const edited = await h.run(3);
    assert.deepEqual([edited.uploaded, edited.replacements, edited.quarantined], [1, 1, 0]);
    assert.deepEqual(h.spool.diagnostics().map(diagnostic => [diagnostic.code, diagnostic.pathId]), [['source-prefix-changed', hash(path)]]);
    assert.deepEqual(lastPass(h), { kind: 'full', reason: 'source-prefix-changed', parsedBytes: String(statSync(path).size), hashedBytes: String(checkpoint), at: 3 });
    const key = [...h.server.heads.keys()][0]!;
    assert.equal(h.server.heads.get(key)?.digest, hash(readFileSync(path)));
    const status = formatCollectorStatus(h.collector().status());
    assert.match(status, /source-prefix-changed: pi \[/); assert.match(status, /\nPass 1, latest per file: 0 incremental · 1 full \(source-prefix-changed 1\)\n/);
    appendFileSync(path, jsonl(piMessage('m5', 'five')));
    assert.deepEqual(await h.run(4).then(counters => [counters.uploaded, counters.replacements]), [1, 0]);
    assert.deepEqual([lastPass(h).kind, h.spool.diagnostics()], ['incremental', []]);
    assert.equal(h.server.heads.get(key)?.digest, hash(readFileSync(path)));
  } finally { await h.close(); }
});

test('UploadParts takes the full pass after a policy change, a record limit change, a head moved by another writer and a new inode', async () => {
  const h = await harness();
  try {
    const path = join(h.roots.pi, 's.jsonl'); writeFileSync(path, jsonl(piHeader('pi-invalidate'), piMessage('m0', 'zero')));
    assert.equal((await h.run(1)).uploaded, 1);
    let settings: Record<string, unknown> = {};
    const append = async (now: number, change: Record<string, unknown>): Promise<[string, string | null]> => {
      settings = { ...settings, ...change }; appendFileSync(path, jsonl(piMessage(`m${now}`, `message ${now}`)));
      const counters = await h.run(now, settings);
      assert.deepEqual([counters.uploaded, counters.replacements], [1, 0], String(now));
      return [lastPass(h).kind, lastPass(h).reason];
    };
    assert.deepEqual(await append(2, { redactions: { fieldNames: [], textPatterns: ['synthetic-absent'], secretFiles: [] } }), ['full', 'policy-changed']);
    assert.deepEqual(await append(3, {}), ['incremental', null]);
    assert.deepEqual(await append(4, { maxRecordBytes: 16 * MiB }), ['full', 'limits-changed']);
    // Another writer (here `whole`, as a downgraded collector) commits the next revision.
    appendFileSync(path, jsonl(piMessage('m5', 'whole'))); assert.equal((await h.run(5, { ...settings, uploadProtocol: 'whole' })).uploaded, 1);
    assert.deepEqual(await append(6, {}), ['full', 'head-moved']);
    const replaced = `${path}.new`; writeFileSync(replaced, readFileSync(path)); renameSync(replaced, path);
    assert.deepEqual(await append(7, {}), ['full', 'file-replaced']);
    assert.deepEqual(await append(8, {}), ['incremental', null]);
    assert.equal([...h.server.heads.values()][0]?.digest, hash(readFileSync(path)));
  } finally { await h.close(); }
});

test('UploadParts reads a file whose stat changes every cycle only once it is quiet', async () => {
  const h = await harness({ quietMs: 1_000 });
  try {
    const path = join(h.roots.pi, 's.jsonl'); writeFileSync(path, jsonl(piHeader('pi-active')));
    lineReads.bytes = 0n;
    for (const now of [0, 600, 1_200]) {
      appendFileSync(path, jsonl(piMessage(`m${now}`, 'still being written')));
      assert.deepEqual(await h.run(now).then(counters => [counters.waiting, counters.scanned, counters.enqueued]), [1, 0, 0], String(now));
    }
    assert.equal(lineReads.bytes, 0n);
    assert.deepEqual(await h.run(2_200).then(counters => [counters.scanned, counters.uploaded]), [1, 1]);
  } finally { await h.close(); }
});

test('UploadParts opens a spool written by the base release: the first append takes the full pass, the next one is incremental', async () => {
  const h = await harness();
  try {
    const path = join(h.roots.pi, 's.jsonl'); writeFileSync(path, jsonl(piHeader('pi-base'), piMessage('m1', 'one')));
    assert.equal((await h.run(1)).uploaded, 1);
    // What the base release writes: its buckets only, and observations signed by content digest and mtime.
    const database = new DatabaseSync(join(h.dir, 'state', 'spool.sqlite'));
    try {
      const buckets = database.prepare('SELECT DISTINCT bucket FROM kv ORDER BY bucket').all().map(row => String(row['bucket']));
      assert.deepEqual(buckets.filter(bucket => ['append-checkpoint', 'last-pass'].includes(bucket)), ['append-checkpoint', 'last-pass']);
      database.exec("DELETE FROM kv WHERE bucket IN ('append-checkpoint', 'upload-checkpoint', 'last-pass')");
      database.prepare("UPDATE kv SET value=? WHERE bucket='observation'").run(JSON.stringify({ signature: `${hash(readFileSync(path))}:${Math.floor(statSync(path).mtimeMs)}`, since: 1 }));
    } finally { database.close(); }
    h.reopen();
    appendFileSync(path, jsonl(piMessage('m2', 'two')));
    assert.deepEqual(await h.run(2).then(counters => [counters.uploaded, counters.replacements]), [1, 0]);
    assert.deepEqual([lastPass(h).kind, lastPass(h).reason], ['full', 'no-checkpoint']);
    appendFileSync(path, jsonl(piMessage('m3', 'three')));
    assert.deepEqual(await h.run(3).then(counters => [counters.uploaded, counters.replacements]), [1, 0]);
    assert.deepEqual([lastPass(h).kind, lastPass(h).reason], ['incremental', null]);
  } finally { await h.close(); }
});

test('UploadParts reads a Codex session whole at every upload: a lost acknowledgement, a temporary disappearance and a boundary duplicate leave the head equal to a whole read', async () => {
  const h = await harness();
  try {
    const path = join(h.roots.codex, 'c.jsonl'); const away = join(h.dir, 'away.jsonl');
    writeFileSync(path, fixture('codex').trimEnd().split('\n').slice(0, 9).join('\n') + '\n');
    assert.equal((await h.run(1)).uploaded, 1);
    const event = (text: string) => ({ timestamp: '2026-01-01T00:01:00Z', type: 'event_msg', payload: { type: 'agent_message', message: text } });
    // The acknowledgement of an append is lost, and the file is out of discovery when the commit is recovered.
    appendFileSync(path, jsonl(event('another event-only message'))); h.server.loseCommitAck = true;
    assert.deepEqual(await h.run(2).then(counters => [counters.uploaded, counters.uploadFailures]), [0, 1]);
    renameSync(path, away);
    assert.equal((await h.run(3)).uploaded, 1);
    renameSync(away, path);
    // An event message that duplicates a response item of the prefix (the exec_command call): a whole read drops it.
    appendFileSync(path, jsonl(event('function_call exec_command {"command":"synthetic-command"}')));
    assert.deepEqual(await h.run(4).then(counters => [counters.uploaded, counters.uploadFailures]), [1, 0]);
    const whole = parseTranscript('codex', readFileSync(path), path, resolveRuntimePrivacy(h.settings(), syntheticSecrets).policy);
    const chain = new MessageChain(); for (const message of whole.messages) chain.extend(messageDigest(message));
    const head = [...h.server.heads.values()][0]!;
    assert.deepEqual([head.revision, head.digest, head.messageCount, head.chain], [3, hash(whole.raw), whole.messages.length, chain.hex]);
    assert.deepEqual([lastPass(h).kind, lastPass(h).reason], ['full', 'codex-full-pass']);
  } finally { await h.close(); }
});
