import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { access, mkdtemp, open, writeFile, rm } from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import * as A from '../generated/typescript/chronicle/api/index.js';
import { BaboonCodecContext } from '../generated/typescript/BaboonSharedRuntime.js';

const context = BaboonCodecContext.Default;
const guardMs = 90_000;
const shutdownGraceMs = 40_000;
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function run(executable: string, args: string[], input: string | undefined): string {
  const result = spawnSync(executable, args, { input, encoding: 'utf8', timeout: guardMs });
  assert.equal(result.status, 0, `${executable} failed: ${result.stderr}`);
  return result.stdout;
}
async function port(): Promise<number> {
  const server = tcpServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address !== null && typeof address !== 'string');
  await new Promise<void>((done, fail) => server.close(error => error === undefined ? done() : fail(error)));
  return address.port;
}
async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const end = Date.now() + guardMs;
  while (Date.now() < end) { const value = await read(); if (accept(value)) return value; await pause(100); }
  throw new Error('native acceptance observation deadline exceeded');
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let forced = false;
  await new Promise<void>(done => {
    const timer = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, shutdownGraceMs);
    child.once('exit', () => { clearTimeout(timer); done(); }); child.kill('SIGTERM');
  });
  assert.equal(forced, false, 'owned native process required SIGKILL');
}
class Rpc {
  private readonly pending = new Map<string, { resolve: (value: A.Result) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  constructor(readonly socket: WebSocket) {
    socket.on('message', data => {
      const envelope = A.ServerEnvelope_JsonCodec.instance.decode(context, JSON.parse(data.toString()));
      if (envelope.result instanceof A.Result_Ping) { this.send(envelope.requestId, new A.Operation_Pong(envelope.result.nonce)); return; }
      const pending = this.pending.get(envelope.requestId);
      if (pending !== undefined) { clearTimeout(pending.timer); this.pending.delete(envelope.requestId); pending.resolve(envelope.result); }
    });
    socket.on('close', () => {
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('owned RPC socket closed')); }
      this.pending.clear();
    });
  }
  private send(id: string, operation: A.Operation): void {
    this.socket.send(JSON.stringify(A.ClientEnvelope_JsonCodec.instance.encode(context, new A.ClientEnvelope(id, operation))));
  }
  call(operation: A.Operation): Promise<A.Result> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('RPC deadline')); }, 15_000);
      this.pending.set(id, { resolve, reject, timer }); this.send(id, operation);
    });
  }
  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(done => {
      const timer = setTimeout(() => this.socket.terminate(), 5_000);
      this.socket.once('close', () => { clearTimeout(timer); done(); }); this.socket.close();
    });
  }
  static async connect(base: string, cookie: string): Promise<Rpc> {
    const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/ws', { headers: { Origin: base, Cookie: cookie }, handshakeTimeout: 15_000 });
    const client = new Rpc(socket);
    await new Promise<void>((done, fail) => { socket.once('open', done); socket.once('error', fail); });
    assert.ok(await client.call(new A.Operation_Hello([A.ClientEnvelope.BaboonDomainVersion])) instanceof A.Result_Hello);
    return client;
  }
}
function snapshot(name: string, count: number): A.IngestRequest {
  const messages = Array.from({ length: count }, (_, index) => new A.Message(`${name}-${index}`, undefined, 'user', `${name}-${index} synthetic source 😀`, undefined, index));
  const content = messages.map(message => JSON.stringify({ id: message.id, text: message.text })).join('\n') + '\n';
  const digest = createHash('sha256').update(content).digest('hex');
  return new A.IngestRequest(randomUUID(), new A.SourceIdentity('native-recovery', 'synthetic-root', A.SourceFormat.Pi, name, undefined), 0, digest, A.Completion.Closed, true,
    new A.Metadata(name, undefined, undefined, undefined, undefined, undefined, 'native-recovery-fixture', undefined, undefined, undefined, []), messages, [new A.RawFile('session.jsonl', digest, content)]);
}

// Behavioral-Active Effectual Good-Communication: actual ELF, owned PostgreSQL, controlled loopback provider; not semantic-quality evidence.
test('native annotation budgets survive claims/restart and owner retry retains checkpoint history', { timeout: 360_000 }, async t => {
  const parsed: unknown = JSON.parse(process.env.CHRONICLE_SERVER_COMMAND ?? 'null');
  assert.ok(Array.isArray(parsed) && parsed.length > 0 && parsed.every(value => typeof value === 'string'), 'CHRONICLE_SERVER_COMMAND must name an actual ELF as a JSON command array');
  const command = parsed as string[];
  await access(command[0], constants.X_OK);
  const executable = await open(command[0], 'r');
  try { const magic = Buffer.alloc(4); await executable.read(magic, 0, 4, 0); assert.equal(magic.toString('hex'), '7f454c46', 'native acceptance requires an ELF, never a JVM/script fallback'); } finally { await executable.close(); }
  const pg = process.env.PG_BIN; assert.ok(pg !== undefined, 'PG_BIN is required; no database skips');
  await access(join(pg, 'psql'), constants.X_OK);
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-native-recovery-'));
  const db = join(directory, 'postgres'); const dbPort = await port(); const base = `http://127.0.0.1:${await port()}`;
  const annotations = new Map<string, number>(); const embeddings = new Map<string, number>(); const inputHashes = new Map<string, string>();
  const audit: { source: string; call: number; status: number; outcome: string }[] = [];
  let rejected = 0, accepted = 0, outage = 0, persistentCalls = 0, repair = false, fixtureFailure: unknown;
  const model = createServer(async (request, response) => {
    try {
      let body = ''; for await (const chunk of request) { body += chunk.toString(); assert.ok(body.length <= 1_048_576); }
      const payload = record(JSON.parse(body)); response.setHeader('Content-Type', 'application/json');
      if (request.url === '/embeddings') {
        assert.ok(Array.isArray(payload.input)); assert.equal('dimensions' in payload, false);
        const data = payload.input.map((text: unknown, index: number) => { assert.equal(typeof text, 'string'); const key = String(text); embeddings.set(key, (embeddings.get(key) ?? 0) + 1); return { index, embedding: [1, 2, 3] }; });
        response.end(JSON.stringify({ data })); return;
      }
      assert.equal(request.url, '/chat/completions'); assert.equal(payload.max_tokens, 65536);
      assert.equal(record(payload.chat_template_kwargs).reasoning_effort, 'max');
      assert.ok(Array.isArray(payload.messages));
      const sourceContent = String(record(payload.messages[1]).content); const source = record(JSON.parse(sourceContent));
      assert.ok(Array.isArray(source.fragments) && source.fragments.length > 0);
      const fragments = source.fragments.map(record); const firstId = String(fragments[0].messageId);
      const inputHash = createHash('sha256').update(sourceContent).digest('hex');
      if (inputHashes.has(firstId)) assert.equal(inputHash, inputHashes.get(firstId), 'retry must retain the complete source/carry input'); else inputHashes.set(firstId, inputHash);
      const calls = (annotations.get(firstId) ?? 0) + 1; annotations.set(firstId, calls);
      const persistent = firstId.startsWith('persistent-');
      if (persistent) persistentCalls++;
      if (firstId === 'long-192' && calls === 1) { outage++; audit.push({ source: firstId, call: calls, status: 503, outcome: 'controlled-outage' }); response.statusCode = 503; response.end('{"error":"synthetic outage"}'); return; }
      const invalid = persistent ? !repair : calls === (firstId === 'long-192' ? 2 : 1);
      if (invalid) rejected++; else accepted++;
      audit.push({ source: firstId, call: calls, status: 200, outcome: invalid ? 'incomplete' : 'valid' });
      const end = invalid ? { fragmentIndex: fragments.length - 1, scalarOffset: 1 } : { fragmentIndex: fragments.length, scalarOffset: 0 };
      const content = JSON.stringify({ parts: [{ kind: 'Problem', start: { fragmentIndex: 0, scalarOffset: 0 }, end, continuePrevious: source.previous !== null, summary: 'Synthetic recovery goal', tags: ['synthetic'] }] });
      response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
    } catch (error) { fixtureFailure = error; response.statusCode = 500; response.end('{"error":"invalid controlled request"}'); }
  });
  let child: ChildProcess | undefined, rpc: Rpc | undefined, databaseStarted = false, successful = false;
  const log = createWriteStream(join(directory, 'native.log'), { mode: 0o600 });
  t.after(async () => {
    try { if (rpc !== undefined) await rpc.close(); if (child !== undefined) await stop(child); }
    finally {
      model.closeAllConnections(); await new Promise<void>(done => model.close(() => done())); log.end();
      if (databaseStarted) run(join(pg, 'pg_ctl'), ['-D', db, '-m', 'immediate', '-w', 'stop'], undefined);
      if (successful) await rm(directory, { recursive: true, force: true }); else console.error(`Synthetic native acceptance artifacts retained: ${directory}`);
    }
  });
  await new Promise<void>(done => model.listen(0, '127.0.0.1', done));
  const address = model.address(); assert.ok(address !== null && typeof address !== 'string');
  run(join(pg, 'initdb'), ['-D', db, '-A', 'trust', '-U', 'chronicle_test', '--no-locale', '--encoding=UTF8'], undefined);
  run(join(pg, 'pg_ctl'), ['-D', db, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${dbPort} -k ${directory}`, '-w', 'start'], undefined); databaseStarted = true;
  run(join(pg, 'createdb'), ['-h', '127.0.0.1', '-p', String(dbPort), '-U', 'chronicle_test', 'chronicle_test'], undefined);
  const sql = (query: string): string => run(join(pg, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(dbPort), '-U', 'chronicle_test', '-d', 'chronicle_test', '-At', '-c', query], undefined).trim();
  const password = randomBytes(32).toString('base64url'); const token = randomBytes(32).toString('base64url');
  const hash = run(command[0], [...command.slice(1), 'password-hash'], password + '\n').trim(); assert.match(hash, /^pbkdf2-sha256\$/);
  for (const [name, value] of [['password', hash], ['db-password', ''], ['model-key', ''], ['token', token]]) await writeFile(join(directory, name), value, { mode: 0o600 });
  const endpoint = { model: 'controlled-native-fixture', revision: 'v1', credentialFile: join(directory, 'model-key'), timeoutSeconds: 900, maxResponseBytes: 1_048_576 };
  const config = {
    listenHost: '127.0.0.1', listenPort: Number(new URL(base).port), allowedOrigin: base, secureCookies: false, allowInsecureHttp: false,
    jdbcUrl: `jdbc:postgresql://127.0.0.1:${dbPort}/chronicle_test`, databaseUser: 'chronicle_test', databasePasswordFile: join(directory, 'db-password'),
    users: [{ id: 'owner', login: 'owner', passwordHashFile: join(directory, 'password'), enabled: true }],
    staticTokens: [{ id: randomUUID(), userId: 'owner', name: 'synthetic-ingest', scopes: ['Ingest'], tokenFile: join(directory, 'token') }],
    maxBodyBytes: 8_388_608, maxFiles: 4, maxFileBytes: 4_194_304, maxMessages: 1000, sessionTtlSeconds: 3600,
    annotation: { ...endpoint, endpoint: `http://127.0.0.1:${address.port}/chat/completions`, requestPolicy: 'glm-max-reasoning' },
    embedding: { ...endpoint, endpoint: `http://127.0.0.1:${address.port}/embeddings`, dimensions: 3, queryPrefix: '', documentPrefix: '', sendDimensions: false },
    indexing: { annotationSessions: 1, embeddingRequests: 1, embeddingBatchSize: 16 },
  };
  const configFile = join(directory, 'config.json'); await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  const start = async (): Promise<Rpc> => {
    child = spawn(command[0], [...command.slice(1), 'serve', configFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.pipe(log, { end: false }); child.stderr!.pipe(log, { end: false });
    let spawnFailure: Error | undefined; child.once('error', error => { spawnFailure = error; });
    await eventually(async () => {
      if (spawnFailure !== undefined) throw spawnFailure;
      assert.equal(child!.exitCode, null, `native exited during startup; see ${directory}/native.log`);
      try { return (await fetch(base + '/api/versions', { signal: AbortSignal.timeout(2_000) })).status; } catch { return 0; }
    }, status => status === 200);
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(A.LoginRequest_JsonCodec.instance.encode(context, new A.LoginRequest('owner', password))), signal: AbortSignal.timeout(15_000) });
    assert.equal(login.status, 200); A.LoginResponse_JsonCodec.instance.decode(context, await login.json());
    const cookie = login.headers.get('set-cookie'); assert.ok(cookie !== null); return Rpc.connect(base, cookie.split(';')[0]);
  };
  const ingest = async (request: A.IngestRequest): Promise<A.IngestReceipt> => {
    const response = await fetch(base + '/api/ingest', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(A.IngestRequest_JsonCodec.instance.encode(context, request)), signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200); return A.IngestReceipt_JsonCodec.instance.decode(context, await response.json());
  };
  const job = async (id: string): Promise<A.JobInfo> => {
    if (fixtureFailure !== undefined) throw fixtureFailure;
    assert.ok(rpc !== undefined); const result = await rpc.call(new A.Operation_IngestStatus(0, 100)); assert.ok(result instanceof A.Result_Status);
    if (fixtureFailure !== undefined) throw fixtureFailure;
    const value = result.result.jobs.find(value => value.id === id); assert.ok(value !== undefined); return value;
  };
  const terminal = (id: string) => eventually(() => job(id), value => value.state === A.JobState.Complete || value.state === A.JobState.Failed);
  rpc = await start();
  const long = snapshot('long', 448); const receipt = await ingest(long); const complete = await terminal(receipt.jobId);
  assert.equal(fixtureFailure, undefined, 'controlled model fixture must not fail its own assertions');
  assert.equal(complete.state, A.JobState.Complete, `seven-window source must complete, not exhaust five job claims (attempts=${complete.attempts}, completedWindows=${complete.completedWindows}, error=${complete.error}); controlled audit=${JSON.stringify(audit)}`);
  assert.equal(complete.attempts, 2); assert.equal(complete.completedWindows, 7); assert.equal(complete.totalWindows, 7);
  assert.equal([...annotations.values()].reduce((sum, count) => sum + count, 0), 15); assert.equal(rejected, 7); assert.equal(accepted, 7); assert.equal(outage, 1);
  assert.deepEqual([...annotations.entries()], Array.from({ length: 7 }, (_, window) => [`long-${window * 64}`, window === 3 ? 3 : 2]));
  assert.equal(embeddings.size, 448); for (const message of long.messages) assert.equal(embeddings.get(message.text), 1, 'accepted prefix source must be embedded exactly once');
  assert.equal(sql(`SELECT count(*) FROM ch_index_checkpoints WHERE job_id='${receipt.jobId}' AND stage='Annotation'`), '7');
  assert.equal(sql(`SELECT count(*)||'|'||count(*) FILTER (WHERE rejection_reason='annotation-partition-incomplete') FROM ch_annotation_attempts WHERE job_id='${receipt.jobId}'`), '15|7');
  const failedReceipt = await ingest(snapshot('persistent', 1)); const failed = await terminal(failedReceipt.jobId);
  assert.equal(failed.state, A.JobState.Failed); assert.equal(failed.error, 'annotation-attempts-exhausted'); assert.equal(failed.attempts, 1); assert.equal(persistentCalls, 5);
  const binding = sql(`SELECT run_id||'|'||annotation_retry_epoch FROM ch_jobs WHERE id='${failed.id}'`); const [runId, epoch] = binding.split('|');
  assert.match(runId, /^[0-9a-f-]{36}$/); assert.equal(epoch, '0');
  const historyQuery = `SELECT row_to_json(a)::text FROM ch_annotation_attempts a WHERE job_id='${failed.id}' AND retry_epoch=0 ORDER BY window_ordinal,attempt`;
  const history = sql(historyQuery); assert.equal(history.split('\n').length, 5);
  assert.equal(sql(`SELECT count(*) FROM ch_annotation_attempts WHERE job_id='${failed.id}' AND rejection_reason='annotation-partition-incomplete'`), '5');
  assert.equal(sql(`SELECT string_agg(attempt::text,',' ORDER BY attempt)||'|'||min(window_ordinal)||'|'||max(window_ordinal) FROM ch_annotation_attempts WHERE job_id='${failed.id}' AND retry_epoch=0`), '1,2,3,4,5|0|0');
  assert.ok(rpc !== undefined && child !== undefined); await rpc.close(); rpc = undefined; await stop(child); child = undefined;
  rpc = await start(); await pause(3_000);
  assert.equal((await job(failed.id)).state, A.JobState.Failed); assert.equal(persistentCalls, 5, 'restart must not reset a terminal annotation budget');
  assert.equal(sql(`SELECT run_id||'|'||annotation_retry_epoch FROM ch_jobs WHERE id='${failed.id}'`), binding);
  repair = true; assert.ok(rpc !== undefined); assert.ok(await rpc.call(new A.Operation_RetryJob(failed.id)) instanceof A.Result_Mutation);
  const repaired = await terminal(failed.id); assert.equal(repaired.state, A.JobState.Complete); assert.equal(persistentCalls, 6);
  assert.equal(sql(`SELECT run_id||'|'||annotation_retry_epoch FROM ch_jobs WHERE id='${failed.id}'`), `${runId}|1`);
  assert.equal(sql(historyQuery), history);
  assert.equal(sql(`SELECT retry_epoch||'|'||count(*) FROM ch_annotation_attempts WHERE job_id='${failed.id}' GROUP BY retry_epoch ORDER BY retry_epoch`), '0|5\n1|1');
  assert.equal(sql(`SELECT count(DISTINCT run_id) FROM ch_annotation_attempts WHERE job_id='${failed.id}'`), '1');
  assert.equal(sql(`SELECT count(*) FROM ch_annotation_attempts WHERE job_id='${failed.id}' AND retry_epoch=1 AND rejection_reason IS NULL`), '1');
  assert.equal(embeddings.get('persistent-0 synthetic source 😀'), 1); assert.equal(embeddings.size, 449);
  for (const count of embeddings.values()) assert.equal(count, 1);
  assert.equal([...annotations.values()].reduce((sum, count) => sum + count, 0), 21);
  assert.equal(rejected, 12); assert.equal(accepted, 8); assert.equal(outage, 1); assert.equal(fixtureFailure, undefined); successful = true;
});
