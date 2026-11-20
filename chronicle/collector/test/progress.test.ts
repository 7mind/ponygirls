import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Collector } from '../src/collector.ts';
import { loadConfig } from '../src/config.ts';
import { MemorySpool, SqliteSpool } from '../src/spool.ts';
import { HttpProgressReporter, type ProgressReporter } from '../src/progress.ts';
import { UploadError } from '../src/ingest.ts';
import { FileSecretReader } from '../src/runtime-privacy.ts';
import { formatCollectorStatus } from '../src/status.ts';
import { noGit } from './helpers.ts';
import { CollectorProgressUpdate, CollectorProgressUpdate_JsonCodec } from '../../generated/typescript/chronicle/api/CollectorProgressUpdate.js';
import { CollectorProgressAck, CollectorProgressAck_JsonCodec } from '../../generated/typescript/chronicle/api/CollectorProgressAck.js';
import { CollectorPhase } from '../../generated/typescript/chronicle/api/CollectorPhase.js';
import { CollectorCounters } from '../../generated/typescript/chronicle/api/CollectorCounters.js';
import { IngestReceipt } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

class ProgressSink {
  readonly reports: CollectorProgressUpdate[] = [];
  mode: 'accept' | 'reject' | 'fail' | 'mismatch' | 'oversized' | 'malformed' | 'timeout' | 'reset' = 'accept';
  accept(update: CollectorProgressUpdate): CollectorProgressAck {
    this.reports.push(update);
    if (this.mode === 'fail') throw new Error('private synthetic response must not escape');
    return new CollectorProgressAck(update.sequence + (this.mode === 'mismatch' ? 1n : 0n), this.mode !== 'reject');
  }
}
async function harness(adapter: string) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-progress-')); const sink = new ProgressSink();
  mkdirSync(join(dir, 'sessions')); writeFileSync(join(dir, 'token'), 'synthetic-token', { mode: 0o600 });
  const server = createServer(async (req, res) => {
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/api/collector/progress');
    assert.equal(req.headers.authorization, 'Bearer synthetic-token');
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    assert.equal(typeof value['sequence'], 'string');
    assert.equal(typeof value['uploadedBytes'], 'string');
    assert.equal(typeof value['totalUploadBytes'], 'string');
    const update = CollectorProgressUpdate_JsonCodec.instance.decode(BaboonCodecContext.Default, value);
    // The connection closes under the request: no answer at all.
    if (sink.mode === 'reset') { req.socket.destroy(); return; }
    if (sink.mode === 'timeout') return;
    if (sink.mode === 'oversized') { res.end('x'.repeat(65537)); return; }
    if (sink.mode === 'malformed') { res.end('{'); return; }
    try { res.end(JSON.stringify(CollectorProgressAck_JsonCodec.instance.encode(BaboonCodecContext.Default, sink.accept(update)))); }
    catch { res.writeHead(503); res.end('private synthetic response must not escape'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error();
  const config = loadConfig({ enabled: true, endpoint: `http://127.0.0.1:${address.port}`, tokenFile: join(dir, 'token'), stateDir: join(dir, 'state'), discoverNative: false, discoverYolo: false, roots: [{ id: 'test', format: 'pi', path: join(dir, 'sessions') }], quietMs: 0, uploadTimeoutMs: 1000, uploadProtocol: 'whole' });
  const reporter: ProgressReporter = adapter === 'dummy' ? { report: async update => sink.accept(update) } : new HttpProgressReporter(config);
  return { dir, sink, config, reporter, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true }); } };
}

for (const adapter of ['dummy', 'http']) {
  test(`progress contract ${adapter}: phases, restart sequence, ACK bytes and old pending retry`, async () => {
    const h = await harness(adapter); let spool = new SqliteSpool(h.config.stateDir); let loseAck = true;
    try {
      writeFileSync(join(h.dir, 'sessions/s.jsonl'), readFileSync(new URL('fixtures/pi.jsonl', import.meta.url)));
      const ingester = { send: async (payload: string) => {
        if (loseAck) { loseAck = false; throw new UploadError('network-failed', true, false); }
        const request = JSON.parse(payload) as { requestId: string; expectedRevision: number };
        return new IngestReceipt(request.requestId, randomUUID(), request.expectedRevision + 1, randomUUID());
      } };
      await new Collector(h.config, spool, ingester, () => 0, noGit, h.reporter, new FileSecretReader()).runOnce(100);
      assert.equal(h.sink.reports.at(-1)!.phase, CollectorPhase.Failed);
      assert.ok(h.sink.reports.every(r => r.uploadedBytes === 0n));
      const bytes = BigInt(Buffer.byteLength(spool.queue()[0]!.payload));
      assert.ok(h.sink.reports.some(r => r.phase === CollectorPhase.Uploading && r.currentUploadTotalBytes === bytes));
      const prior = spool.reporting(); const namespace = spool.namespace; spool.close(); spool = new SqliteSpool(h.config.stateDir);
      const start = h.sink.reports.length;
      const result = await new Collector(h.config, spool, ingester, () => 0, noGit, h.reporter, new FileSecretReader()).runOnce(200);
      assert.equal(result.enqueued, 0); assert.equal(result.uploaded, 1);
      const reports = h.sink.reports.slice(start); const final = reports.at(-1)!;
      assert.ok(reports[0]!.sequence > BigInt(prior.sequence));
      assert.equal(final.collectorId, namespace); assert.equal(final.phase, CollectorPhase.Idle);
      assert.equal(final.totalUploadBytes, bytes); assert.equal(final.uploadedBytes, bytes);
      assert.equal(final.currentUploadTotalBytes, undefined); assert.equal(final.counters.pending, 0);
      assert.notEqual(final.runId, h.sink.reports[0]!.runId);
      assert.deepEqual([...new Set(reports.map(r => r.phase))], [CollectorPhase.Discovering, CollectorPhase.Scanning, CollectorPhase.Uploading, CollectorPhase.Idle]);
      assert.equal(spool.reporting().acceptedSequence, final.sequence.toString());
      assert.equal(spool.reporting().error, null);
    } finally { spool.close(); await h.close(); }
  });
  test(`progress contract ${adapter}: invalid ingest receipt never counts bytes; stopped and quarantine remain visible`, async () => {
    const h = await harness(adapter); const spool = new MemorySpool();
    try {
      writeFileSync(join(h.dir, 'sessions/s.jsonl'), readFileSync(new URL('fixtures/pi.jsonl', import.meta.url)));
      writeFileSync(join(h.dir, 'sessions/bad.jsonl'), '{malformed}\n');
      const result = await new Collector(h.config, spool, { send: async payload => {
        const request = JSON.parse(payload) as { requestId: string };
        return new IngestReceipt(request.requestId, randomUUID(), 99, randomUUID());
      } }, () => 0, noGit, h.reporter, new FileSecretReader()).runOnce(100);
      assert.equal(result.uploaded, 0); assert.equal(result.stopped, 1); assert.equal(result.quarantined, 1);
      assert.ok(h.sink.reports.every(r => r.uploadedBytes === 0n));
      const final = h.sink.reports.at(-1)!;
      assert.equal(final.phase, CollectorPhase.Failed); assert.equal(final.counters.stopped, 1); assert.equal(final.counters.quarantined, 1);
      assert.equal(spool.head(spool.queue()[0]!.sourceKey).revision, 0);
    } finally { spool.close(); await h.close(); }
  });
  for (const mode of ['reject', 'fail', 'mismatch'] as const) {
    test(`progress contract ${adapter}: ${mode} never claims fresh or changes ingest durability`, async () => {
      const h = await harness(adapter); const spool = new MemorySpool();
      try {
        h.sink.mode = mode;
        writeFileSync(join(h.dir, 'sessions/s.jsonl'), readFileSync(new URL('fixtures/pi.jsonl', import.meta.url)));
        const collector = new Collector(h.config, spool, { send: async payload => {
          const request = JSON.parse(payload) as { requestId: string; expectedRevision: number };
          return new IngestReceipt(request.requestId, randomUUID(), request.expectedRevision + 1, randomUUID());
        } }, () => 0, noGit, h.reporter, new FileSecretReader());
        assert.equal((await collector.runOnce(100)).uploaded, 1);
        assert.equal(spool.queue().length, 0); assert.equal(spool.reporting().acceptedAt, null);
        assert.equal(spool.reporting().acceptedSequence, null); assert.equal(spool.reporting().error, 'report-failed');
        assert.ok(collector.status().diagnostics.some(d => d.code === 'report-failed'));
        assert.equal(h.sink.reports.at(-1)!.phase, CollectorPhase.Failed);
        assert.ok(!JSON.stringify(collector.status()).includes('private synthetic'));
        h.sink.mode = 'accept'; await collector.runOnce(200);
        assert.equal(spool.reporting().error, null); assert.ok(spool.reporting().acceptedAt !== null);
      } finally { spool.close(); await h.close(); }
    });
  }
}
// The cause of a failed report is kept as a bounded class, never the server's text.
const CAUSES = { oversized: ['ack-too-large', 'acknowledgement over 64 KiB'], malformed: ['invalid-ack', 'invalid acknowledgement'],
  timeout: ['timeout:20', 'timed out after 20 ms'], fail: ['http:503', 'HTTP 503'], reject: ['not-accepted', 'not accepted by the server'],
  reset: ['connection-reset', 'connection closed by the server before an answer'] } as const;
for (const mode of Object.keys(CAUSES) as (keyof typeof CAUSES)[]) {
  test(`GoodCommunication bounded progress ${mode} remains visible without fake ACK, with its cause`, async () => {
    const h = await harness('http'); const spool = new MemorySpool();
    try {
      h.sink.mode = mode;
      if (mode === 'timeout') h.config.uploadTimeoutMs = 20;
      const collector = new Collector(h.config, spool, { send: async () => { throw new Error('unused'); } }, () => 0, noGit, h.reporter, new FileSecretReader());
      await collector.runOnce(100);
      assert.equal(spool.reporting().error, 'report-failed'); assert.equal(spool.reporting().acceptedAt, null);
      const [cause, text] = CAUSES[mode];
      assert.equal(spool.reporting().cause, cause);
      assert.deepEqual(collector.status().diagnostics.filter(d => d.code === 'report-failed').map(d => d.cause), [cause]);
      const status = formatCollectorStatus(collector.status());
      assert.ok(status.includes(`  Error: report-failed · ${text}`) && status.includes(`report-failed: reporting [`), status);
      assert.ok(!status.includes('private synthetic'));
    } finally { spool.close(); await h.close(); }
  });
}

test('GoodCommunication every report travels on a new connection: a server closing idle connections as the event loop unblocks never drops one', async () => {
  // A minimal HTTP/1.1 server that closes an idle keep-alive connection exactly IDLE_MS after its answer, without the
  // grace period Node's own server adds: the race of finding 1 of the S2 acceptance, at its boundary.
  const IDLE_MS = 50; let connections = 0;
  const server = createNetServer(socket => {
    connections++; let buffer = ''; let idle: NodeJS.Timeout | undefined;
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      for (let end = buffer.indexOf('\r\n\r\n'); end >= 0; end = buffer.indexOf('\r\n\r\n')) {
        const head = buffer.slice(0, end); const length = Number(/content-length: *(\d+)/i.exec(head)?.[1] ?? 0);
        if (Buffer.byteLength(buffer.slice(end + 4)) < length) return;
        const update = CollectorProgressUpdate_JsonCodec.instance.decode(BaboonCodecContext.Default, JSON.parse(buffer.slice(end + 4, end + 4 + length)) as unknown);
        buffer = buffer.slice(end + 4 + length);
        const ack = JSON.stringify(CollectorProgressAck_JsonCodec.instance.encode(BaboonCodecContext.Default, new CollectorProgressAck(update.sequence, true)));
        const close = /^connection: *close$/im.test(head);
        socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(ack)}\r\n${close ? 'Connection: close\r\n' : ''}\r\n${ack}`);
        clearTimeout(idle);
        if (close) socket.end(); else idle = setTimeout(() => socket.destroy(), IDLE_MS);
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-progress-race-'));
  try {
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error();
    writeFileSync(join(dir, 'token'), 'synthetic-token', { mode: 0o600 });
    const reporter = new HttpProgressReporter(loadConfig({ enabled: true, endpoint: `http://127.0.0.1:${address.port}`, tokenFile: join(dir, 'token'), stateDir: join(dir, 'state') }));
    const update = (sequence: bigint) => new CollectorProgressUpdate('synthetic-collector', sequence, randomUUID(), CollectorPhase.Scanning, new Date(0).toISOString(),
      new CollectorCounters(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0n), 0n, 0n, undefined, undefined);
    // A synchronous preflight blocks the event loop around the server's idle close, as during run B.
    const block = (milliseconds: number): void => { const until = Date.now() + milliseconds; while (Date.now() < until) { /* synchronous work */ } };
    let sequence = 0n;
    for (const blocked of [IDLE_MS - 4, IDLE_MS - 2, IDLE_MS, IDLE_MS + 2, IDLE_MS + 4]) {
      assert.equal((await reporter.report(update(++sequence))).accepted, true);
      block(blocked);
      assert.equal((await reporter.report(update(++sequence))).accepted, true);
    }
    assert.equal(connections, Number(sequence));
  } finally { server.close(); rmSync(dir, { recursive: true }); }
});
