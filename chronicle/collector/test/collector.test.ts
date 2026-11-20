import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Collector, policyDigest } from '../src/collector.ts';
import { noGit, acceptingProgress, syntheticSecrets } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { SqliteSpool, MemorySpool } from '../src/spool.ts';
import { UploadError, encodeSnapshot, sourceIdentity, sourceKey, type Ingester } from '../src/ingest.ts';
import { parseTranscript } from '../src/parsers.ts';
import { resolveRuntimePrivacy } from '../src/runtime-privacy.ts';
import { hash } from '../src/domain.ts';
import { formatCollectorStatus } from '../src/status.ts';
import { IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { IngestRequest_JsonCodec } from '../../generated/typescript/chronicle/api/IngestRequest.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}.jsonl`, import.meta.url), 'utf8');
class DummyIngester implements Ingester {
  readonly payloads: string[] = [];
  readonly receipts = new Map<string, IngestReceipt>();
  loseACK = false; conflict = false; tooLarge = false;
  async send(payload: string): Promise<IngestReceipt> {
    this.payloads.push(payload);
    const request = IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(payload) as unknown);
    if (this.conflict) throw new UploadError('cas-conflict', false, true);
    if (this.tooLarge) throw new UploadError('server-payload-too-large', false, false);
    const receipt = this.receipts.get(request.requestId) ?? new IngestReceipt(request.requestId, randomUUID(), request.expectedRevision + 1, randomUUID());
    this.receipts.set(request.requestId, receipt);
    if (this.loseACK) { this.loseACK = false; throw new UploadError('network-failed', true, false); }
    return receipt;
  }
}
function setup(extra: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-engine-'));
  const source = join(dir, 'sessions'); mkdirSync(source);
  const config = loadConfig({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'token'), stateDir: join(dir, 'state'), homeDir: dir, discoverNative: false, discoverYolo: false, quietMs: 10, uploadProtocol: 'whole', roots: [{ id: 'fixture', format: 'pi', path: source }], ...extra });
  return { dir, source, config };
}

test('BG observed quiet evidence, same-size/mtime rewrite, resumption, truncation and digest dedupe', async () => {
  const { dir, source, config } = setup({}); const spool = new MemorySpool(); const ingester = new DummyIngester();
  try {
    const path = join(source, 's.jsonl'); const raw = fixture('pi'); writeFileSync(path, raw);
    const collector = new Collector(config, spool, ingester, () => 0.5, noGit, acceptingProgress, syntheticSecrets);
    assert.equal((await collector.runOnce(100)).waiting, 1);
    assert.equal((await collector.runOnce(110)).uploaded, 1);
    assert.equal((await collector.runOnce(120)).unchanged, 1);
    const originalTime = new Date('2026-01-01T00:00:00Z'); utimesSync(path, originalTime, originalTime);
    await collector.runOnce(130);
    writeFileSync(path, raw.replace('left branch', 'next branch')); utimesSync(path, originalTime, originalTime);
    assert.equal((await collector.runOnce(140)).waiting, 1);
    assert.equal((await collector.runOnce(150)).uploaded, 1);
    const second = IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(ingester.payloads[1]!) as unknown);
    assert.equal(second.expectedRevision, 1); assert.equal(second.completion, 'Quiescent'); assert.equal(second.metadata.endedAt, undefined);
    writeFileSync(path, raw.split('\n').slice(0, 2).join('\n') + '\n');
    await collector.runOnce(160); assert.equal((await collector.runOnce(170)).uploaded, 1);
    assert.equal(ingester.payloads.length, 3);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG lost ACK survives SQLite restart and retries exact payload/request ID; conflicts never advance CAS', async () => {
  const { dir, source, config } = setup({ quietMs: 0 }); let spool = new SqliteSpool(config.stateDir); const ingester = new DummyIngester(); ingester.loseACK = true;
  try {
    writeFileSync(join(source, 's.jsonl'), fixture('pi'));
    const first = await new Collector(config, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets).runOnce(100);
    assert.equal(first.uploadFailures, 1); assert.equal(first.pending, 1);
    const queued = spool.queue()[0]!; const namespace = spool.namespace; spool.close(); spool = new SqliteSpool(config.stateDir);
    assert.equal(spool.namespace, namespace);
    assert.equal((await new Collector(config, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets).runOnce(101)).uploaded, 1);
    assert.equal(ingester.payloads[0], ingester.payloads[1]);
    writeFileSync(join(source, 's.jsonl'), fixture('pi').replace('left branch', 'resumed branch'));
    ingester.conflict = true;
    const failed = await new Collector(config, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets).runOnce(102);
    assert.equal(failed.conflicts, 1); assert.equal(spool.head(queued.sourceKey).revision, 1);
    await new Collector(config, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets).runOnce(103);
    assert.equal(ingester.payloads.length, 3);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG Pi subagent projection preserves pre-upgrade pending bytes and acknowledged raw dedupe across SQLite restart', async () => {
  const { dir, config } = setup({ quietMs: 0, discoverNative: true, roots: [] }); let spool = new SqliteSpool(config.stateDir); const ingester = new DummyIngester();
  const agent = 'synthetic-agent', header = `[subagent ${agent} task synthetic-task]\n`;
  const directory = join(dir, '.pi/agent/subagents/root/sessions', agent); mkdirSync(directory, { recursive: true }); const path = join(directory, 'session.jsonl');
  const raw = '{"type":"session","version":3,"id":"child-producer"}\n' + JSON.stringify({ type: 'message', id: 'u', message: { role: 'user', content: header + 'Task title' } }) + '\n';
  const decode = (payload: string) => IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(payload) as unknown);
  const collect = (now: number) => new Collector(config, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets).runOnce(now);
  try {
    writeFileSync(path, raw); const runtime = resolveRuntimePrivacy(config, syntheticSecrets), parsed = parseTranscript('pi', Buffer.from(raw), path, runtime.policy);
    const identity = sourceIdentity(spool.namespace, 'native', 'pi', parsed, path), key = sourceKey(identity), requestId = randomUUID();
    const legacy = JSON.parse(encodeSnapshot(requestId, identity, 0, parsed, 'session.jsonl')) as { metadata: { title: string; tags: string[] } };
    legacy.metadata.title = header.trimEnd(); legacy.metadata.tags = [];
    const payload = JSON.stringify(legacy), digest = policyDigest(config, runtime.identity);
    spool.enqueue({ requestId, sourceKey: key, sourceDigest: hash(raw), payload, payloadDigest: hash(payload), expectedRevision: 0, policyDigest: digest, attempts: 0, nextAt: 0, status: 'pending', error: null }, { kind: 'unknown' }, null);
    spool.close(); spool = new SqliteSpool(config.stateDir);
    const resumed = await collect(100); assert.equal(resumed.uploaded, 1); assert.equal(resumed.enqueued, 0);
    assert.deepEqual(ingester.payloads, [payload]); assert.equal(decode(ingester.payloads[0]!).metadata.title, header.trimEnd()); assert.deepEqual(decode(ingester.payloads[0]!).metadata.tags, []);
    assert.equal(spool.head(key).revision, 1); assert.equal(spool.dropped().length, 0);
    spool.close(); spool = new SqliteSpool(config.stateDir);
    assert.equal((await collect(101)).unchanged, 1); assert.deepEqual(ingester.payloads, [payload]);
    writeFileSync(path, raw.replace('Task title', 'Changed task title'));
    assert.equal((await collect(102)).uploaded, 1);
    const changed = decode(ingester.payloads[1]!);
    assert.notEqual(changed.requestId, requestId); assert.deepEqual(changed.source, identity); assert.equal(changed.expectedRevision, 1);
    assert.equal(changed.metadata.title, 'Changed task title'); assert.deepEqual(changed.metadata.tags, ['subagent']);
    assert.equal(changed.files[0]!.content, raw.replace('Task title', 'Changed task title')); assert.equal(spool.dropped().length, 0);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG partial line waits then visible quarantine, exclusions and binary policy precede spool', async () => {
  const { dir, source, config } = setup({ quietMs: 0, partialLineQuarantineMs: 10, exclusions: { projects: ['/excluded'] }, redactions: { textPatterns: ['SYNTHETIC_SECRET'] } });
  const spool = new MemorySpool(); const ingester = new DummyIngester();
  try {
    writeFileSync(join(source, 'partial.jsonl'), '{"type":"session"');
    writeFileSync(join(source, 'excluded.jsonl'), fixture('pi').replace('/synthetic/project', '/excluded/project'));
    writeFileSync(join(source, 'allowed.jsonl'), fixture('pi'));
    const collector = new Collector(config, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets);
    const initial = await collector.runOnce(1); assert.equal(initial.waiting, 1); assert.equal(initial.excluded, 1); assert.equal(initial.uploaded, 1);
    assert.equal((await collector.runOnce(11)).quarantined, 1);
    assert.ok(collector.status().diagnostics.some(d => d.code === 'partial-line-expired'));
    assert.doesNotMatch(ingester.payloads.join(''), /SYNTHETIC_SECRET|BINARY_PAYLOAD|excluded\/project/);
    assert.equal((JSON.parse(ingester.payloads[0]!) as { redacted: boolean }).redacted, true);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG copied IDs across profiles stay independent; new profiles discovered after start', async () => {
  const { dir, config } = setup({ quietMs: 0, discoverYolo: true, roots: [] }); const spool = new MemorySpool(); const ingester = new DummyIngester();
  try {
    const make = (profile: string, value: string) => { const path = join(dir, '.config/yolo', profile, 'pi/home/agent/sessions/project'); mkdirSync(path, { recursive: true }); writeFileSync(join(path, 's.jsonl'), value); };
    make('one', fixture('pi')); const collector = new Collector(config, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets);
    assert.equal((await collector.runOnce(1)).uploaded, 1);
    make('two', fixture('pi').replace('left branch', 'other branch'));
    assert.equal((await collector.runOnce(2)).uploaded, 1);
    const requests = ingester.payloads.map(p => IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(p) as unknown));
    assert.equal(requests[0]!.source.producerSessionId, requests[1]!.source.producerSessionId);
    assert.notEqual(requests[0]!.source.discoveryRootId, requests[1]!.source.discoveryRootId);
    assert.equal(requests[1]!.expectedRevision, 0);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG privacy change discards pending bytes without tombstoning: the next scan queues the source under the new policy; limits quarantine without truncation', async () => {
  const { dir, source, config } = setup({ quietMs: 0 }); const spool = new MemorySpool(); const ingester = new DummyIngester(); ingester.loseACK = true;
  try {
    writeFileSync(join(source, 's.jsonl'), fixture('pi'));
    await new Collector(config, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets).runOnce(1);
    const [old] = spool.queue(); assert.ok(old !== undefined); assert.equal(ingester.payloads.length, 1);
    const altered = { ...config, redactions: { fieldNames: ['content'], textPatterns: [], secretFiles: [] } };
    const result = await new Collector(altered, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets).runOnce(2);
    assert.equal(result.quarantined, 1); assert.equal(result.enqueued, 1); assert.equal(result.uploaded, 1); assert.equal(spool.queue().length, 0);
    assert.deepEqual(spool.dropped(), [{ requestId: old.requestId, sourceKey: old.sourceKey, reason: 'privacy-or-destination-changed' }]);
    assert.equal(spool.head(old.sourceKey).tombstone, false); assert.equal(spool.head(old.sourceKey).revision, 1);
    const [before, ...after] = ingester.payloads.map(payload => IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(payload) as unknown));
    // The one upload after the change is a new request with the content re-read and redacted under the new policy.
    assert.deepEqual(after.map(request => [request.requestId === old.requestId, request.files[0]!.content === before!.files[0]!.content, request.expectedRevision]), [[false, false, 0]]);
    const limited = new Collector({ ...config, maxFileBytes: 1 }, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets);
    assert.equal((await limited.runOnce(3)).quarantined, 1);
    const size = Buffer.byteLength(fixture('pi'));
    assert.deepEqual(limited.status().diagnostics.find(d => d.code === 'snapshot-too-large'), { rootId: 'fixture', pathId: hash(join(source, 's.jsonl')), code: 'snapshot-too-large', measured: size, limit: 1 });
    assert.match(formatCollectorStatus(limited.status()), new RegExp(`snapshot-too-large: fixture \\[[0-9a-f]{12}\\] · file .* \\(${size.toLocaleString('en-US')} bytes\\) over maxFileBytes 1 B`));
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG session exclusions match producer/subagent identity, not an arbitrary message ID', async () => {
  const { dir, source, config } = setup({ quietMs: 0, exclusions: { sessions: ['u'] } }); const spool = new MemorySpool(); const ingester = new DummyIngester();
  try {
    writeFileSync(join(source, 's.jsonl'), fixture('pi'));
    assert.equal((await new Collector(config, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets).runOnce(1)).uploaded, 1);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG Pi restoration episodes preserve divergent histories and stable CAS across restart', async () => {
  const { dir, config } = setup({ quietMs: 0, discoverNative: true, roots: [] });
  let spool = new SqliteSpool(config.stateDir); const ingester = new DummyIngester();
  const agent = '11111111-1111-4111-8111-111111111111';
  const path = join(dir, '.pi/agent/subagents/root/sessions', agent); mkdirSync(path, { recursive: true });
  const restoredName = 'restored-12345678-abcdef01.jsonl';
  const decode = (payload: string) => IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(payload) as unknown);
  const collect = (now: number) => new Collector(config, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets).runOnce(now);
  try {
    const raw = fixture('pi'); writeFileSync(join(path, '2026-01-01_original.jsonl'), raw);
    assert.equal((await collect(1)).uploaded, 1);
    const canonical = decode(ingester.payloads[0]!);
    assert.equal(canonical.source.collectorNamespace, spool.namespace);
    writeFileSync(join(path, restoredName), raw.replace('left branch', 'restored divergent branch'));
    writeFileSync(join(path, 'restored-87654321-abcdef02.jsonl'), raw.replace('left branch', 'second restored branch'));
    const result = await collect(2);
    assert.deepEqual(spool.diagnostics().filter(d => d.code !== 'root-missing'), []);
    assert.equal(result.quarantined, 0);
    assert.equal(result.unchanged, 1);
    assert.equal(result.enqueued, 2); assert.equal(result.uploaded, 2);
    const requests = ingester.payloads.map(decode);
    assert.equal(new Set(requests.map(r => r.source.collectorNamespace)).size, 3);
    for (const request of requests) {
      assert.equal(request.source.producerSessionId, canonical.source.producerSessionId);
      assert.equal(request.source.subagentId, agent); assert.equal(request.expectedRevision, 0);
    }
    const sanitized = canonical.files[0]!.content;
    assert.deepEqual(new Set(requests.map(r => r.files[0]!.content)), new Set([sanitized, sanitized.replace('left branch', 'restored divergent branch'), sanitized.replace('left branch', 'second restored branch')]));
    assert.doesNotMatch(ingester.payloads.join(''), /SYNTHETIC_SECRET|BINARY_PAYLOAD/);
    const restored = requests.find(r => r.files[0]!.path.endsWith(restoredName))!;
    spool.close(); spool = new SqliteSpool(config.stateDir);
    assert.equal((await collect(3)).unchanged, 3);
    writeFileSync(join(path, restoredName), raw.replace('left branch', 'edited restored branch'));
    const changed = await collect(4); assert.equal(changed.uploaded, 1); assert.equal(changed.unchanged, 2);
    const revision = decode(ingester.payloads.at(-1)!);
    assert.deepEqual(revision.source, restored.source); assert.equal(revision.expectedRevision, 1);
    assert.equal(spool.dropped().length, 0); assert.equal(spool.queue().length, 0);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG a file whose stat is unchanged since an acknowledged read is not read again until its stat or the policy changes', async () => {
  const { dir, source, config } = setup({ quietMs: 0 }); let spool = new SqliteSpool(config.stateDir); const ingester = new DummyIngester();
  const collect = (now: number, c = config) => new Collector(c, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets).runOnce(now);
  try {
    const path = join(source, 's.jsonl'); writeFileSync(path, fixture('pi'));
    const first = await collect(1); assert.equal(first.scanned, 1); assert.equal(first.uploaded, 1);
    spool.close(); spool = new SqliteSpool(config.stateDir);
    const unread = await collect(2); assert.equal(unread.unchanged, 1); assert.equal(unread.scanned, 0); assert.equal(unread.scannedBytes, 0);
    const time = new Date('2026-01-01T00:00:00Z'); utimesSync(path, time, time);
    const touched = await collect(3); assert.equal(touched.scanned, 1); assert.equal(touched.unchanged, 1);
    assert.equal((await collect(4)).scanned, 0);
    const policy = { ...config, redactions: { ...config.redactions, textPatterns: ['UNUSED_SYNTHETIC_PATTERN'] } };
    const reread = await collect(5, policy); assert.equal(reread.scanned, 1); assert.equal(reread.unchanged, 1);
    assert.equal(ingester.payloads.length, 1);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG files beyond the scan budget are deferred, not too large, and read first in later cycles while others keep changing', async () => {
  const session = (id: string, text: string) => fixture('pi').replace('pi-synthetic', id).replace('left branch', text);
  const size = Buffer.byteLength(session('pi-synthetic-a', 'left branch'));
  const { dir, source, config } = setup({ quietMs: 0, maxFileBytes: 2 * size, maxScanBytes: 2 * size }); const spool = new MemorySpool(); const ingester = new DummyIngester();
  const collector = new Collector(config, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets);
  const uploadedSessions = () => ingester.payloads.splice(0).map(p => IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(p) as unknown).source.producerSessionId).sort();
  const ids = ['pi-synthetic-a', 'pi-synthetic-b', 'pi-synthetic-c'];
  try {
    for (const id of ids) writeFileSync(join(source, `${id}.jsonl`), session(id, 'left branch'));
    const first = await collector.runOnce(1);
    assert.equal(first.scanned, 2); assert.equal(first.deferred, 1); assert.equal(first.quarantined, 0); assert.equal(first.uploaded, 2);
    assert.deepEqual(collector.status().diagnostics, []);
    assert.match(formatCollectorStatus(collector.status()), /Deferred by scan budget: 1\b/);
    const read = uploadedSessions(); const [deferred] = ids.filter(id => !read.includes(id));
    for (const id of read) writeFileSync(join(source, `${id}.jsonl`), session(id, 'next branch'));
    const second = await collector.runOnce(2);
    assert.equal(second.deferred, 1); assert.equal(second.uploaded, 2);
    const secondRead = uploadedSessions(); assert.ok(secondRead.includes(deferred!));
    const third = await collector.runOnce(3);
    assert.equal(third.deferred, 0); assert.equal(third.uploaded, 1); assert.equal(third.unchanged, 2);
    assert.deepEqual([...secondRead, ...uploadedSessions()].sort(), ids);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG a payload the server refuses as too large stops after one attempt and is reported with its size', async () => {
  const { dir, source, config } = setup({ quietMs: 0 }); const spool = new MemorySpool(); const ingester = new DummyIngester(); ingester.tooLarge = true;
  const collector = new Collector(config, spool, ingester, () => 0, noGit, acceptingProgress, syntheticSecrets);
  try {
    writeFileSync(join(source, 's.jsonl'), fixture('pi'));
    const first = await collector.runOnce(1); assert.equal(first.uploadFailures, 1); assert.equal(first.stopped, 1);
    const payloadBytes = Buffer.byteLength(ingester.payloads[0]!);
    assert.deepEqual(collector.status().queue.map(({ status, attempts, error, payloadBytes }) => ({ status, attempts, error, payloadBytes })), [{ status: 'stopped', attempts: 1, error: 'server-payload-too-large', payloadBytes }]);
    assert.match(formatCollectorStatus(collector.status()), new RegExp(`Error: refused by the server as too large \\(server-payload-too-large\\) · payload .* \\(${payloadBytes.toLocaleString('en-US')} bytes\\)`));
    const second = await collector.runOnce(2); assert.equal(second.scanned, 0); assert.equal(second.waiting, 1); assert.equal(ingester.payloads.length, 1);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});
