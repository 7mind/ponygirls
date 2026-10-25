import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Collector } from '../src/collector.ts';
import { noGit } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { SqliteSpool, MemorySpool } from '../src/spool.ts';
import { UploadError, type Ingester } from '../src/ingest.ts';
import { IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { IngestRequest_JsonCodec } from '../../generated/typescript/chronicle/api/IngestRequest.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}.jsonl`, import.meta.url), 'utf8');
class DummyIngester implements Ingester {
  readonly payloads: string[] = [];
  readonly receipts = new Map<string, IngestReceipt>();
  loseACK = false; conflict = false;
  async send(payload: string): Promise<IngestReceipt> {
    this.payloads.push(payload);
    const request = IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(payload) as unknown);
    if (this.conflict) throw new UploadError('cas-conflict', false, true);
    const receipt = this.receipts.get(request.requestId) ?? new IngestReceipt(request.requestId, randomUUID(), request.expectedRevision + 1, randomUUID());
    this.receipts.set(request.requestId, receipt);
    if (this.loseACK) { this.loseACK = false; throw new UploadError('network-failed', true, false); }
    return receipt;
  }
}
function setup(extra: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-engine-'));
  const source = join(dir, 'sessions'); mkdirSync(source);
  const config = loadConfig({ enabled: true, endpoint: 'http://127.0.0.1:9', tokenFile: join(dir, 'token'), stateDir: join(dir, 'state'), homeDir: dir, discoverNative: false, discoverYolo: false, quietMs: 10, roots: [{ id: 'fixture', format: 'pi', path: source }], ...extra });
  return { dir, source, config };
}

test('BG observed quiet evidence, same-size/mtime rewrite, resumption, truncation and digest dedupe', async () => {
  const { dir, source, config } = setup({}); const spool = new MemorySpool(); const ingester = new DummyIngester();
  try {
    const path = join(source, 's.jsonl'); const raw = fixture('pi'); writeFileSync(path, raw);
    const collector = new Collector(config, spool, ingester, () => 0.5, noGit);
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
    const first = await new Collector(config, spool, ingester, () => 0, noGit).runOnce(100);
    assert.equal(first.uploadFailures, 1); assert.equal(first.pending, 1);
    const queued = spool.queue()[0]!; const namespace = spool.namespace; spool.close(); spool = new SqliteSpool(config.stateDir);
    assert.equal(spool.namespace, namespace);
    assert.equal((await new Collector(config, spool, ingester, () => 0, noGit).runOnce(101)).uploaded, 1);
    assert.equal(ingester.payloads[0], ingester.payloads[1]);
    writeFileSync(join(source, 's.jsonl'), fixture('pi').replace('left branch', 'resumed branch'));
    ingester.conflict = true;
    const failed = await new Collector(config, spool, ingester, () => 0, noGit).runOnce(102);
    assert.equal(failed.conflicts, 1); assert.equal(spool.head(queued.sourceKey).revision, 1);
    await new Collector(config, spool, ingester, () => 0, noGit).runOnce(103);
    assert.equal(ingester.payloads.length, 3);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG partial line waits then visible quarantine, exclusions and binary policy precede spool', async () => {
  const { dir, source, config } = setup({ quietMs: 0, partialLineQuarantineMs: 10, exclusions: { projects: ['/excluded'] }, redactions: { textPatterns: ['SYNTHETIC_SECRET'] } });
  const spool = new MemorySpool(); const ingester = new DummyIngester();
  try {
    writeFileSync(join(source, 'partial.jsonl'), '{"type":"session"');
    writeFileSync(join(source, 'excluded.jsonl'), fixture('pi').replace('/synthetic/project', '/excluded/project'));
    writeFileSync(join(source, 'allowed.jsonl'), fixture('pi'));
    const collector = new Collector(config, spool, ingester, () => 0, noGit);
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
    make('one', fixture('pi')); const collector = new Collector(config, spool, ingester, () => 0, noGit);
    assert.equal((await collector.runOnce(1)).uploaded, 1);
    make('two', fixture('pi').replace('left branch', 'other branch'));
    assert.equal((await collector.runOnce(2)).uploaded, 1);
    const requests = ingester.payloads.map(p => IngestRequest_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(p) as unknown));
    assert.equal(requests[0]!.source.producerSessionId, requests[1]!.source.producerSessionId);
    assert.notEqual(requests[0]!.source.discoveryRootId, requests[1]!.source.discoveryRootId);
    assert.equal(requests[1]!.expectedRevision, 0);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG privacy change cancels pending bytes and tombstones source; limits quarantine without truncation', async () => {
  const { dir, source, config } = setup({ quietMs: 0 }); const spool = new MemorySpool(); const ingester = new DummyIngester(); ingester.loseACK = true;
  try {
    writeFileSync(join(source, 's.jsonl'), fixture('pi'));
    await new Collector(config, spool, ingester, () => 0, noGit).runOnce(1);
    const altered = { ...config, redactions: { fieldNames: ['content'], textPatterns: [] } };
    const result = await new Collector(altered, spool, ingester, () => 0, noGit).runOnce(2);
    assert.equal(result.quarantined, 1); assert.equal(spool.queue().length, 0); assert.equal(ingester.payloads.length, 1);
    const limited = { ...config, maxFileBytes: 1 };
    assert.equal((await new Collector(limited, spool, ingester, () => 0, noGit).runOnce(3)).quarantined, 1);
    assert.ok(spool.diagnostics().some(d => d.code === 'snapshot-too-large'));
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});

test('BG session exclusions match producer/subagent identity, not an arbitrary message ID', async () => {
  const { dir, source, config } = setup({ quietMs: 0, exclusions: { sessions: ['u'] } }); const spool = new MemorySpool(); const ingester = new DummyIngester();
  try {
    writeFileSync(join(source, 's.jsonl'), fixture('pi'));
    assert.equal((await new Collector(config, spool, ingester, () => 0, noGit).runOnce(1)).uploaded, 1);
  } finally { spool.close(); rmSync(dir, { recursive: true }); }
});
