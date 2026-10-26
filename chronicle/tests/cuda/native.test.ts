import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as A from '../../generated/typescript/chronicle/api/index.js';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.js';
import { parseTranscript } from '../../collector/src/parsers.ts';
import { privacyPolicy } from '../../collector/src/privacy.ts';
import { encodeSnapshot } from '../../collector/src/ingest.ts';
import { configuration } from './support.ts';
import { topics } from './fixtures.ts';

interface AuditedModelPayload { model: unknown; response_format: unknown; input: unknown }

const context = BaboonCodecContext.Default;
const startupMs = 90_000;
const indexingMs = 300_000;
const rpcMs = 120_000;
const shutdownMs = 40_000;
const longDocumentRepetitions = 35;
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
function run(command: string, args: string[], input: string | undefined): string {
  const result = spawnSync(command, args, { input, encoding: 'utf8', timeout: startupMs });
  assert.equal(result.status, 0, `${command}: ${result.stderr}`); return result.stdout;
}
async function freePort(): Promise<number> {
  const server = createServer(); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address !== null && typeof address !== 'string');
  await new Promise<void>((done, fail) => server.close(error => error === undefined ? done() : fail(error)));
  return address.port;
}
class Rpc {
  constructor(readonly socket: WebSocket) {
    socket.on('message', data => {
      const envelope = A.ServerEnvelope_JsonCodec.instance.decode(context, JSON.parse(data.toString()));
      if (envelope.result instanceof A.Result_Ping) socket.send(JSON.stringify(A.ClientEnvelope_JsonCodec.instance.encode(context, new A.ClientEnvelope(envelope.requestId, new A.Operation_Pong(envelope.result.nonce)))));
    });
  }
  async call(operation: A.Operation): Promise<A.Result> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.socket.off('message', receive); reject(new Error('CUDA workflow RPC timeout')); }, rpcMs);
      const receive = (data: WebSocket.RawData) => {
        const envelope = A.ServerEnvelope_JsonCodec.instance.decode(context, JSON.parse(data.toString()));
        if (envelope.result instanceof A.Result_Ping) return;
        if (envelope.requestId !== id) return;
        clearTimeout(timer); this.socket.off('message', receive); resolve(envelope.result);
      };
      this.socket.on('message', receive);
      this.socket.send(JSON.stringify(A.ClientEnvelope_JsonCodec.instance.encode(context, new A.ClientEnvelope(id, operation))));
    });
  }
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let forced = false;
  await new Promise<void>(done => {
    const timer = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, shutdownMs);
    child.once('exit', () => { clearTimeout(timer); done(); }); child.kill('SIGTERM');
  });
  assert.ok(!forced, 'native Chronicle required forced shutdown');
}

// Behavioral-Active Effectual Good-Communication, specified: actual native server, PG and audited local CUDA models.
test('Chronicle ingestion → real annotation/embedding → PostgreSQL → semantic/hybrid retrieval with source coverage', { skip: process.env.CHRONICLE_CUDA !== '1', timeout: 480_000 }, async t => {
  const models = await configuration();
  for (const authorization of ['', 'Bearer deliberately-invalid-synthetic-key']) {
    const response = await fetch(models.annotation.endpoint, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 401, 'real annotation serving API must require its credential');
    await response.body?.cancel();
  }
  const pg = process.env.PG_BIN; assert.ok(pg !== undefined, 'PG_BIN is required; no simulated database fallback');
  const command: unknown = JSON.parse(process.env.CHRONICLE_SERVER_COMMAND ?? 'null');
  assert.ok(Array.isArray(command) && command.length > 0 && command.every(value => typeof value === 'string'), 'CHRONICLE_SERVER_COMMAND JSON array required');
  const cmd = command as string[];
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-cuda-'));
  const dbPort = await freePort(); const httpPort = await freePort(); const base = `http://127.0.0.1:${httpPort}`;
  const data = join(directory, 'data');
  let databaseStarted = false; let child: ChildProcess | undefined; let socket: WebSocket | undefined; let mcp: Client | undefined;
  let log = ''; let successful = false;
  t.after(async () => {
    if (mcp !== undefined) await mcp.close();
    if (socket !== undefined) socket.terminate();
    try { if (child !== undefined) await stop(child); }
    finally {
      if (databaseStarted) run(join(pg, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], undefined);
      if (successful) await rm(directory, { recursive: true, force: true });
      else { console.error(`CUDA synthetic failure artifacts: ${directory}`); console.error(log); }
    }
  });
  run(join(pg, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'chronicle_cuda', '--no-locale', '--encoding=UTF8'], undefined);
  run(join(pg, 'pg_ctl'), ['-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${dbPort} -k ${directory}`, '-w', 'start'], undefined); databaseStarted = true;
  run(join(pg, 'psql'), ['-h', '127.0.0.1', '-p', String(dbPort), '-U', 'chronicle_cuda', '-d', 'postgres', '-c', 'CREATE EXTENSION vector'], undefined);
  const password = 'synthetic CUDA acceptance password';
  const hash = run(cmd[0], [...cmd.slice(1), 'password-hash'], password + '\n').trim();
  assert.match(hash, /^pbkdf2-sha256\$/);
  await writeFile(join(directory, 'password'), hash, { mode: 0o600 });
  await writeFile(join(directory, 'db-password'), '', { mode: 0o600 });
  const calls = { annotation: 0, documents: 0, queries: 0 };
  const auditFailures: string[] = [];
  const credentials = {
    annotation: (await readFile(models.annotation.credentialFile, 'utf8')).trim(),
    embedding: (await readFile(models.embedding.credentialFile, 'utf8')).trim(),
  };
  const relay = httpServer(async (request, response) => {
    try {
      const buffers: Buffer[] = [];
      for await (const chunk of request) buffers.push(Buffer.from(chunk));
      const body = Buffer.concat(buffers).toString('utf8');
      const payload = JSON.parse(body) as AuditedModelPayload;
      const annotation = request.url === '/chat/completions';
      assert.ok(annotation || request.url === '/embeddings');
      const endpoint = annotation ? models.annotation : models.embedding;
      assert.ok(request.headers.authorization === `Bearer ${annotation ? credentials.annotation : credentials.embedding}`, 'native credential-file authentication');
      assert.equal(payload.model, endpoint.model);
      if (annotation) {
        assert.deepEqual(payload.response_format, { type: 'json_object' }); calls.annotation++;
      } else {
        assert.ok(!Object.hasOwn(payload, 'dimensions'), 'expected shape must not become a truncation request');
        assert.ok(Array.isArray(payload.input) && payload.input.length > 0 && payload.input.length <= 16);
        if (payload.input.every((text: unknown) => typeof text === 'string' && text.startsWith(models.embedding.queryPrefix))) calls.queries++;
        else { assert.ok(payload.input.every((text: unknown) => typeof text === 'string' && text.startsWith(models.embedding.documentPrefix))); calls.documents++; }
      }
      const upstream = await fetch(endpoint.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${annotation ? credentials.annotation : credentials.embedding}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(rpcMs) });
      response.writeHead(upstream.status, { 'Content-Type': 'application/json' }); response.end(await upstream.text());
    } catch (error) {
      auditFailures.push(String(error)); response.writeHead(502); response.end('{"error":"CUDA request audit failed"}');
    }
  });
  await new Promise<void>(done => relay.listen(0, '127.0.0.1', done));
  const relayAddress = relay.address(); assert.ok(relayAddress !== null && typeof relayAddress !== 'string');
  const relayBase = `http://127.0.0.1:${relayAddress.port}`;
  t.after(async () => { relay.closeAllConnections(); await new Promise<void>(done => relay.close(() => done())); });
  const config = {
    listenHost: '127.0.0.1', listenPort: httpPort, allowedOrigin: base, secureCookies: false,
    jdbcUrl: `jdbc:postgresql://127.0.0.1:${dbPort}/postgres`, databaseUser: 'chronicle_cuda', databasePasswordFile: join(directory, 'db-password'),
    users: [{ id: 'cuda', login: 'cuda', passwordHashFile: join(directory, 'password'), enabled: true }],
    maxBodyBytes: 8_388_608, maxFiles: 16, maxFileBytes: 4_194_304, maxMessages: 10_000, sessionTtlSeconds: 3600,
    annotation: { ...models.annotation, endpoint: relayBase + '/chat/completions', timeoutSeconds: 120, maxResponseBytes: 65_536 },
    embedding: { ...models.embedding, endpoint: relayBase + '/embeddings', timeoutSeconds: 120, maxResponseBytes: 1_048_576 },
  };
  const configFile = join(directory, 'server.json'); await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  child = spawn(cmd[0], [...cmd.slice(1), 'serve', configFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  assert.ok(child.stdout !== null && child.stderr !== null);
  child.stdout.on('data', value => { log += value.toString(); }); child.stderr.on('data', value => { log += value.toString(); });
  const startupDeadline = Date.now() + startupMs;
  let ready = false;
  while (Date.now() < startupDeadline) {
    assert.equal(child.exitCode, null, log);
    try { ready = (await fetch(base + '/api/versions', { signal: AbortSignal.timeout(2000) })).status === 200; } catch { ready = false; }
    if (ready) break; await pause(100);
  }
  assert.ok(ready, log);
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(A.LoginRequest_JsonCodec.instance.encode(context, new A.LoginRequest('cuda', password))), signal: AbortSignal.timeout(10_000) });
  assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie'); assert.ok(cookie !== null);
  socket = new WebSocket(base.replace('http:', 'ws:') + '/api/ws', { headers: { Origin: base, Cookie: cookie.split(';')[0] } });
  await new Promise<void>((done, fail) => { socket!.once('open', done); socket!.once('error', fail); });
  const rpc = new Rpc(socket);
  assert.ok(await rpc.call(new A.Operation_Hello(['1.2.0'])) instanceof A.Result_Hello);
  const minted = await rpc.call(new A.Operation_MintToken('synthetic CUDA fixtures', [A.Scope.Ingest, A.Scope.Read]));
  assert.ok(minted instanceof A.Result_Token && minted.result.secret !== undefined); const token = minted.result.secret;
  const sessions = new Map<string, string>();
  const expectedMessages = new Map<string, A.Message[]>();
  const indexingStarted = performance.now();
  for (const topic of topics) {
    const document = topic.id === 'astronomy' ? Array(longDocumentRepetitions).fill(topic.document + '\n').join('') : topic.document;
    const raw = [
      { type: 'session', version: 3, id: `cuda-${topic.id}`, timestamp: '2026-01-01T00:00:00Z', cwd: `/synthetic/cuda/${topic.id}` },
      { type: 'message', id: 'question', parentId: null, message: { role: 'user', content: document } },
      { type: 'message', id: 'answer', parentId: 'question', message: { role: 'assistant', content: topic.answer } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n';
    const transcript = parseTranscript('pi', Buffer.from(raw), `/synthetic/${topic.id}.jsonl`, privacyPolicy({ fieldNames: [], textPatterns: [] }));
    const source = new A.SourceIdentity('cuda-validation', 'synthetic-fixtures', A.SourceFormat.Pi, `cuda-${topic.id}`, undefined);
    const payload = encodeSnapshot(randomUUID(), source, 0, transcript, `${topic.id}.jsonl`);
    const request = A.IngestRequest_JsonCodec.instance.decode(context, JSON.parse(payload));
    const response = await fetch(base + '/api/ingest', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: payload, signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, await response.clone().text());
    const receipt = A.IngestReceipt_JsonCodec.instance.decode(context, await response.json());
    sessions.set(topic.id, receipt.sessionId); expectedMessages.set(receipt.sessionId, request.messages);
  }
  const indexingDeadline = Date.now() + indexingMs;
  let complete = false;
  let jobAttempts: number[] = [];
  while (Date.now() < indexingDeadline) {
    assert.deepEqual(auditFailures, [], 'native model request audit');
    const status = await rpc.call(new A.Operation_IngestStatus(0, 100)); assert.ok(status instanceof A.Result_Status);
    const failed = status.result.jobs.filter(job => job.state === A.JobState.Failed);
    assert.equal(failed.length, 0, `real model indexing failed: ${JSON.stringify(failed)}`);
    complete = status.result.jobs.length === topics.length && status.result.jobs.every(job => job.state === A.JobState.Complete);
    if (complete) { jobAttempts = status.result.jobs.map(job => job.attempts); break; } await pause(200);
  }
  assert.ok(complete, 'real-model indexing deadline exceeded');
  const indexingMilliseconds = performance.now() - indexingStarted;
  let chunkCount = 0;
  for (const topic of topics) {
    const id = sessions.get(topic.id); assert.ok(id !== undefined);
    const session = await rpc.call(new A.Operation_GetSession(id, undefined)); assert.ok(session instanceof A.Result_Session);
    assert.equal(session.result.session.source.producerSessionId, `cuda-${topic.id}`);
    assert.equal(session.result.session.indexedRevision, 1);
    const view = session.result.session.view; assert.ok(view.generationId !== undefined);
    const result = await rpc.call(new A.Operation_GetChunks(id, 0, 100, view)); assert.ok(result instanceof A.Result_Chunks);
    assert.equal(result.result.view.generationId, view.generationId); assert.ok(result.result.chunks.length > 0);
    const messages = expectedMessages.get(id); assert.ok(messages !== undefined);
    const coverage = new Map(messages.map(message => [message.id, 0]));
    for (const chunk of result.result.chunks) {
      chunkCount++;
      assert.ok(chunk.summary.trim().length > 0 && chunk.summary.length <= 1000);
      assert.ok(chunk.tags.length > 0 && chunk.tags.length <= 16 && chunk.tags.every(tag => tag.trim().length > 0 && tag.length <= 64));
      assert.ok(chunk.spans.length > 0);
      let reconstructed = ''; let previousMessage: string | undefined;
      for (const span of chunk.spans) {
        const message = messages.find(message => message.id === span.messageId); assert.ok(message !== undefined);
        assert.equal(span.start, coverage.get(span.messageId), 'spans must cover each source byte exactly once, in order');
        assert.ok(span.end > span.start && span.end <= Buffer.byteLength(message.text));
        if (previousMessage !== undefined && previousMessage !== span.messageId) reconstructed += '\n';
        reconstructed += Buffer.from(message.text).subarray(span.start, span.end).toString('utf8');
        coverage.set(span.messageId, span.end); previousMessage = span.messageId;
      }
      assert.equal(chunk.text, reconstructed, 'annotation must not rewrite source text');
    }
    for (const message of messages) assert.equal(coverage.get(message.id), Buffer.byteLength(message.text));
  }
  const retrieval: { topic: string; mode: string; rank: number; milliseconds: number }[] = [];
  mcp = new Client({ name: 'chronicle-cuda-validation', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  for (const topic of topics) for (const mode of ['semantic', 'hybrid']) {
    const started = performance.now();
    const result = await mcp.callTool({ name: 'search_sessions', arguments: { query: topic.query, mode, limit: topics.length, offset: 0 } });
    assert.notEqual(result.isError, true); assert.ok(Array.isArray(result.content));
    const first = result.content[0]; assert.ok(first.type === 'text' && typeof first.text === 'string');
    const decoded = A.Result_JsonCodec.instance.decode(context, JSON.parse(first.text)); assert.ok(decoded instanceof A.Result_Search);
    assert.equal(decoded.result.countScope, A.SearchCountScope.CandidateWindow, 'must exercise indexed 1.1 search, not legacy exact compatibility');
    assert.ok(decoded.result.rankingLimit !== undefined && Number.isSafeInteger(decoded.result.rankingLimit) && decoded.result.rankingLimit >= topics.length);
    const rank = decoded.result.hits.findIndex(hit => hit.session.id === sessions.get(topic.id)) + 1;
    assert.equal(rank, 1, `${mode} labeled topic ${topic.id} must rank first`);
    retrieval.push({ topic: topic.id, mode, rank, milliseconds: performance.now() - started });
  }
  assert.deepEqual(auditFailures, []);
  assert.ok(calls.annotation > 0 && calls.documents > 0 && calls.queries > 0, 'real upstream model calls observed, no simulator responses');
  console.log(JSON.stringify({ serverCommand: cmd, calls, models: { annotation: { model: models.annotation.model, revision: models.annotation.revision }, embedding: { model: models.embedding.model, revision: models.embedding.revision } }, sessions: topics.length, jobAttempts, chunkCount, sourceCoverage: 'all UTF-8 bytes exactly once', indexingMilliseconds, retrieval }));
  successful = true;
});
