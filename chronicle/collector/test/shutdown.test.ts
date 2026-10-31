import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DaemonLock, SqliteSpool } from '../src/spool.ts';
import { CollectorProgressUpdate_JsonCodec } from '../../generated/typescript/chronicle/api/CollectorProgressUpdate.js';
import { CollectorProgressAck, CollectorProgressAck_JsonCodec } from '../../generated/typescript/chronicle/api/CollectorProgressAck.js';
import { IngestRequest_JsonCodec } from '../../generated/typescript/chronicle/api/IngestRequest.js';
import { IngestReceipt, IngestReceipt_JsonCodec } from '../../generated/typescript/chronicle/api/IngestReceipt.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const READY_WAIT_MS = 10_000;
const STOP_WAIT_MS = 5_000;
const UPLOAD_TIMEOUT_MS = 300_000;
const POLL_MS = 60_000;
const CODEC = BaboonCodecContext.Default;
async function within<T>(work: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
async function reap(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
}
interface AcceptedUpload { payload: string; receipt: IngestReceipt }
for (const signal of ['SIGTERM', 'SIGINT'] as const) for (const phase of ['progress', 'upload', 'idle'] as const) {
  test(`GoodCommunication ${signal} terminates during ${phase} and preserves durable retry state`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'chronicle-shutdown-'));
    const state = join(directory, 'state'), source = join(directory, 'source'), config = join(directory, 'config.json');
    mkdirSync(source);
    writeFileSync(join(directory, 'token'), 'synthetic-shutdown-token', { mode: 0o600 });
    if (phase === 'upload') writeFileSync(join(source, 'session.jsonl'), '{"type":"session","version":3,"id":"synthetic-shutdown"}\n{"type":"message","id":"m","message":{"role":"user","content":"Synthetic durable shutdown source"}}\n');
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    let hold = true;
    const requests: string[] = [], accepted = new Map<string, AcceptedUpload>();
    const server = createServer((request, response) => {
      let body = ''; request.setEncoding('utf8'); request.on('data', (chunk: string) => { body += chunk; });
      request.on('end', () => {
        if (request.url === '/api/collector/progress') {
          const update = CollectorProgressUpdate_JsonCodec.instance.decode(CODEC, JSON.parse(body) as unknown);
          if (phase === 'progress' && hold) { entered(); return; }
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(CollectorProgressAck_JsonCodec.instance.encode(CODEC, new CollectorProgressAck(update.sequence, true))));
        } else if (request.url === '/api/ingest') {
          const upload = IngestRequest_JsonCodec.instance.decode(CODEC, JSON.parse(body) as unknown);
          requests.push(body);
          let entry = accepted.get(upload.requestId);
          if (entry === undefined) { entry = { payload: body, receipt: new IngestReceipt(upload.requestId, randomUUID(), 1, randomUUID()) }; accepted.set(upload.requestId, entry); }
          assert.equal(entry.payload, body, 'An ambiguous committed request must be retried byte-for-byte');
          if (hold) { entered(); return; }
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(IngestReceipt_JsonCodec.instance.encode(CODEC, entry.receipt)));
        } else { response.writeHead(404); response.end(); }
      });
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address !== null && typeof address === 'object');
    writeFileSync(config, JSON.stringify({ enabled: true, endpoint: `http://127.0.0.1:${address.port}`, tokenFile: join(directory, 'token'),
      stateDir: state, homeDir: directory, discoverNative: false, discoverYolo: false, roots: [{ id: 'fixture', format: 'pi', path: source }],
      quietMs: 0, pollMs: POLL_MS, uploadTimeoutMs: UPLOAD_TIMEOUT_MS }));
    const child = spawn(process.execPath, [CLI, '--config', config], { env: { ...process.env, HOME: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    let restart: ChildProcess | null = null;
    try {
      assert.ok(child.stdout !== null && child.stderr !== null); child.stderr.resume();
      await within(phase === 'idle' ? once(child.stdout, 'data').then(() => {}) : ready, READY_WAIT_MS, `Collector never reached ${phase}`);
      assert.throws(() => new DaemonLock(state), /collector-already-running/);
      const before = new SqliteSpool(state);
      const queued = before.queue(); before.close();
      assert.equal(queued.length, phase === 'upload' ? 1 : 0);
      if (phase === 'upload') { assert.equal(queued[0]!.attempts, 0); assert.equal(queued[0]!.payload, requests[0]); }
      const exited = once(child, 'exit'); child.kill(signal);
      const [code, receivedSignal] = await within(exited, STOP_WAIT_MS, `Collector ignored ${signal} during ${phase} while an uncancellable run was active`);
      assert.ok((code === null && receivedSignal === signal) || (code === 0 && receivedSignal === null), `Unexpected shutdown outcome: ${code}/${receivedSignal}`);
      const recoveredLock = new DaemonLock(state); recoveredLock.close();
      const recovered = new SqliteSpool(state);
      try { assert.deepEqual(recovered.queue(), queued); }
      finally { recovered.close(); }
      if (phase === 'upload') {
        hold = false;
        restart = spawn(process.execPath, [CLI, '--config', config, '--once'], { env: { ...process.env, HOME: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
        assert.ok(restart.stdout !== null && restart.stderr !== null); restart.stdout.resume(); restart.stderr.resume();
        const [code] = await within(once(restart, 'exit'), READY_WAIT_MS, 'Restart failed to retry the durable pending request');
        assert.equal(code, 0); assert.equal(requests.length, 2); assert.equal(accepted.size, 1); assert.equal(requests[1], requests[0]);
        const finished = new SqliteSpool(state);
        try { assert.deepEqual(finished.queue(), []); assert.equal(finished.head(queued[0]!.sourceKey).revision, 1); }
        finally { finished.close(); }
      }
    } finally {
      await reap(child); if (restart !== null) await reap(restart);
      server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)));
      rmSync(directory, { recursive: true });
    }
  });
}
