import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createServer } from 'node:https';
import { createServer as tcpServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { chromium, type Browser } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as A from '../generated/typescript/chronicle/api/index.js';
import { BaboonCodecContext } from '../generated/typescript/BaboonSharedRuntime.js';

const context = BaboonCodecContext.Default;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const deadlineMs = 90_000;
const shutdownGraceMs = 40_000;
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function command(): string[] {
  const value: unknown = JSON.parse(process.env.CHRONICLE_SERVER_COMMAND ?? 'null');
  assert.ok(Array.isArray(value) && value.length > 0 && value.every(v => typeof v === 'string'), 'CHRONICLE_SERVER_COMMAND must be a JSON command array');
  return value as string[];
}
function run(executable: string, args: string[], input: string | undefined): string {
  const result = spawnSync(executable, args, { input, encoding: 'utf8', timeout: deadlineMs });
  assert.equal(result.status, 0, `${executable} failed: ${result.stderr}`);
  return result.stdout;
}
async function stopProcess(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  let forced = false;
  await new Promise<void>(done => {
    const timer = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, shutdownGraceMs);
    child.once('exit', () => { clearTimeout(timer); done(); });
    child.kill('SIGTERM');
  });
  return !forced;
}
async function port(): Promise<number> {
  const server = tcpServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address !== null && typeof address !== 'string');
  const value = address.port;
  await new Promise<void>((done, fail) => server.close(error => error === undefined ? done() : fail(error)));
  return value;
}
async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const end = Date.now() + deadlineMs;
  let last: T | undefined;
  while (Date.now() < end) {
    last = await read();
    if (accept(last)) return last;
    await pause(100);
  }
  throw new Error(`deadline exceeded; last observation: ${JSON.stringify(last)}`);
}
class Rpc {
  private readonly pending = new Map<string, { resolve: (result: A.Result) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  constructor(readonly socket: WebSocket) {
    socket.on('message', data => {
      const envelope = A.ServerEnvelope_JsonCodec.instance.decode(context, JSON.parse(data.toString()));
      if (envelope.result instanceof A.Result_Ping) {
        this.send(envelope.requestId, new A.Operation_Pong(envelope.result.nonce));
        return;
      }
      const pending = this.pending.get(envelope.requestId);
      if (pending !== undefined) {
        clearTimeout(pending.timer); this.pending.delete(envelope.requestId); pending.resolve(envelope.result);
      }
    });
    socket.on('close', () => {
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('socket closed during request')); }
      this.pending.clear();
    });
  }
  private send(id: string, operation: A.Operation): void {
    this.socket.send(JSON.stringify(A.ClientEnvelope_JsonCodec.instance.encode(context, new A.ClientEnvelope(id, operation))));
  }
  call(operation: A.Operation, id: string): Promise<A.Result> {
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('RPC deadline')); }, 15_000);
      this.pending.set(id, { resolve: resolveResult, reject, timer }); this.send(id, operation);
    });
  }
  static async connect(base: string, cookie: string): Promise<Rpc> {
    const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/ws', { headers: { Origin: base, Cookie: cookie } });
    const client = new Rpc(socket);
    await new Promise<void>((done, fail) => { socket.once('open', done); socket.once('error', fail); });
    assert.ok(await client.call(new A.Operation_Hello([A.ClientEnvelope.BaboonDomainVersion]), randomUUID()) instanceof A.Result_Hello);
    return client;
  }
}
interface ModelFixture {
  server: Server;
  endpoint: string;
  counts: { annotation: number; embedding: number; rejected: number };
  control: { available: boolean };
}
async function modelFixture(key: Buffer, certificate: Buffer): Promise<ModelFixture> {
  const counts = { annotation: 0, embedding: 0, rejected: 0 };
  const control = { available: true };
  const server = createServer({ key, cert: certificate }, async (request, response) => {
    try {
      let body = ''; for await (const chunk of request) body += chunk.toString();
      const payload = record(JSON.parse(body));
      response.setHeader('Content-Type', 'application/json');
      if (!control.available) { counts.rejected++; response.statusCode = 503; response.end('{"error":"synthetic model outage"}'); return; }
      if (request.url === '/v1/chat/completions') {
        counts.annotation++;
        assert.ok(Array.isArray(payload.messages));
        const source = record(JSON.parse(String(record(payload.messages[1]).content)));
        assert.ok(Array.isArray(source.fragments) && source.fragments.length > 0);
        const content = JSON.stringify({ chunks: [{ first: 0, last: source.fragments.length - 1, summary: 'Synthetic source-backed annotation', tags: ['synthetic', 'verification'] }] });
        response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
      } else if (request.url === '/v1/embeddings') {
        counts.embedding++; assert.ok(Array.isArray(payload.input));
        assert.equal('dimensions' in payload, false, 'natural-dimensional models do not require a truncation request');
        const data = payload.input.map((text: unknown, index: number) => ({ index, embedding: [1 + Number(String(text).includes('tool')), 1 + Number(String(text).includes('branch')), 1 + Number(String(text).includes('你好'))] }));
        response.end(JSON.stringify({ data }));
      } else { response.statusCode = 404; response.end('{}'); }
    } catch { response.statusCode = 500; response.end('{"error":"invalid synthetic model request"}'); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); assert.ok(address !== null && typeof address !== 'string');
  return { server, endpoint: `https://127.0.0.1:${address.port}/v1`, counts, control };
}

// Behavioral-Active Blackbox Good-Communication: real processes/DB; models are a controlled HTTP fixture.
test('collector → durable archive → annotation/pgvector → generated WS and official MCP; live group ACLs and restart', { timeout: 240_000 }, async t => {
  const cmd = command();
  assert.ok(process.env.PLAYWRIGHT_BROWSERS_PATH !== undefined, 'Provisioned Playwright browsers are required for the live dashboard acceptance gate');
  const pg = process.env.PG_BIN; assert.ok(pg !== undefined, 'PG_BIN is required; this acceptance gate never silently skips the real database');
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-workflow-'));
  const dbPort = await port(); const httpPort = await port(); const base = `http://127.0.0.1:${httpPort}`;
  const db = join(directory, 'postgres');
  const javaHome = process.env.JAVA_HOME; assert.ok(javaHome !== undefined, 'JAVA_HOME with keytool is required for the native HTTPS acceptance probe');
  const key = join(directory, 'model-key.pem'); const certificate = join(directory, 'model-certificate.pem'); const trustStore = join(directory, 'trust.p12');
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', certificate], undefined);
  run(join(javaHome, 'bin', 'keytool'), ['-importcert', '-noprompt', '-storetype', 'PKCS12', '-alias', 'synthetic-model', '-file', certificate, '-keystore', trustStore, '-storepass', 'synthetic-test-only'], undefined);
  const serverCommand = [cmd[0], `-Djavax.net.ssl.trustStore=${trustStore}`, '-Djavax.net.ssl.trustStorePassword=synthetic-test-only', ...cmd.slice(1)];
  const model = await modelFixture(await readFile(key), await readFile(certificate));
  let child: ChildProcess | undefined; let serverLog = ''; let successful = false; const sockets: Rpc[] = []; const mcp: Client[] = [];
  let databaseStarted = false;
  let browser: Browser | undefined;
  const browserErrors: string[] = [];
  t.after(async () => {
    if (browser !== undefined) await browser.close();
    for (const client of mcp) await client.close().catch(() => undefined);
    for (const rpc of sockets) rpc.socket.terminate();
    const graceful = child === undefined || await stopProcess(child);
    model.server.closeAllConnections(); await new Promise<void>(done => model.server.close(() => done()));
    if (databaseStarted) run(join(pg, 'pg_ctl'), ['-D', db, '-m', 'immediate', '-w', 'stop'], undefined);
    if (successful) await rm(directory, { recursive: true, force: true });
    else { console.error(`Synthetic failure artifacts retained: ${directory}`); console.error(serverLog); }
    assert.ok(graceful, 'server shutdown required SIGKILL');
  });
  run(join(pg, 'initdb'), ['-D', db, '-A', 'trust', '-U', 'chronicle_test', '--no-locale', '--encoding=UTF8'], undefined);
  run(join(pg, 'pg_ctl'), ['-D', db, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${dbPort} -k ${directory}`, '-w', 'start'], undefined); databaseStarted = true;
  run(join(pg, 'createdb'), ['-h', '127.0.0.1', '-p', String(dbPort), '-U', 'chronicle_test', 'chronicle_test'], undefined);
  run(join(pg, 'psql'), ['-h', '127.0.0.1', '-p', String(dbPort), '-U', 'chronicle_test', '-d', 'chronicle_test', '-c', 'CREATE EXTENSION vector'], undefined);
  const password = 'synthetic acceptance password';
  const passwordHash = run(cmd[0], [...cmd.slice(1), 'password-hash'], password + '\n').trim();
  assert.match(passwordHash, /^pbkdf2-sha256\$/);
  await writeFile(join(directory, 'password'), passwordHash, { mode: 0o600 });
  await writeFile(join(directory, 'db-password'), '', { mode: 0o600 });
  await writeFile(join(directory, 'model-key'), '', { mode: 0o600 });
  const endpointConfig = { model: 'synthetic-model', revision: 'synthetic-v1', credentialFile: join(directory, 'model-key'), timeoutSeconds: 5, maxResponseBytes: 1_048_576 };
  const config = {
    listenHost: '127.0.0.1', listenPort: httpPort, allowedOrigin: base, secureCookies: false,
    jdbcUrl: `jdbc:postgresql://127.0.0.1:${dbPort}/chronicle_test`, databaseUser: 'chronicle_test', databasePasswordFile: join(directory, 'db-password'),
    users: ['alice', 'bob', 'carol'].map(id => ({ id, login: id, passwordHashFile: join(directory, 'password'), enabled: true })),
    maxBodyBytes: 8_388_608, maxFiles: 16, maxFileBytes: 4_194_304, maxMessages: 10_000, sessionTtlSeconds: 3600,
    annotation: { ...endpointConfig, endpoint: model.endpoint + '/chat/completions' },
    embedding: { ...endpointConfig, endpoint: model.endpoint + '/embeddings', dimensions: 3, queryPrefix: 'query: ', documentPrefix: 'document: ', sendDimensions: false },
  };
  const configFile = join(directory, 'server.json'); await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  const start = async () => {
    child = spawn(serverCommand[0], [...serverCommand.slice(1), 'serve', configFile], { env: { ...process.env, CHRONICLE_WEB_ROOT: join(root, 'web', 'dist') }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', value => { serverLog += value.toString(); }); child.stderr!.on('data', value => { serverLog += value.toString(); });
    await eventually(async () => {
      if (child!.exitCode !== null) throw new Error(`server exited ${child!.exitCode}: ${serverLog}`);
      try { return (await fetch(base + '/api/versions')).status; } catch { return 0; }
    }, status => status === 200);
  };
  await start();
  async function login(user: string): Promise<{ cookie: string; rpc: Rpc }> {
    const response = await fetch(base + '/api/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(A.LoginRequest_JsonCodec.instance.encode(context, new A.LoginRequest(user, password))) });
    assert.equal(response.status, 200);
    A.LoginResponse_JsonCodec.instance.decode(context, await response.json());
    const header = response.headers.get('set-cookie'); assert.ok(header !== null); const cookie = header.split(';')[0];
    const rpc = await Rpc.connect(base, cookie); sockets.push(rpc); return { cookie, rpc };
  }
  const alice = await login('alice'); const bob = await login('bob'); const carol = await login('carol');
  const minted = await alice.rpc.call(new A.Operation_MintToken('fixture collector', [A.Scope.Ingest, A.Scope.Read]), randomUUID());
  assert.ok(minted instanceof A.Result_Token); assert.ok(minted.result.secret !== undefined);
  const token = minted.result.secret;
  await writeFile(join(directory, 'agent-token'), token, { mode: 0o600 });
  const fixtures = join(directory, 'fixtures'); await mkdir(fixtures);
  const roots = [];
  for (const format of ['pi', 'claude', 'codex']) {
    const path = join(fixtures, format); await mkdir(path);
    await copyFile(join(root, 'collector', 'test', 'fixtures', format + '.jsonl'), join(path, 'session.jsonl'));
    roots.push({ id: 'acceptance:' + format, format, path });
  }
  const collectorConfig = join(directory, 'collector.json');
  await writeFile(collectorConfig, JSON.stringify({ enabled: true, endpoint: base, tokenFile: join(directory, 'agent-token'), stateDir: join(directory, 'spool'), discoverNative: false, discoverYolo: false, roots, homeDir: directory, quietMs: 1 }), { mode: 0o600 });
  const cli = join(root, 'collector', 'dist', 'collector', 'src', 'cli.js');
  run(process.execPath, [cli, '--config', collectorConfig, '--once'], undefined); await pause(20);
  run(process.execPath, [cli, '--config', collectorConfig, '--once'], undefined);
  const status = await eventually(async () => {
    const result = await alice.rpc.call(new A.Operation_IngestStatus(0, 100), randomUUID()); assert.ok(result instanceof A.Result_Status); return result.result;
  }, value => value.jobs.length === 3 && value.jobs.every(job => job.state === A.JobState.Complete));
  assert.equal(status.total, 3); assert.ok(model.counts.annotation > 0 && model.counts.embedding > 0);
  const mcpClient = new Client({ name: 'chronicle-acceptance', version: '1.0.0' });
  await mcpClient.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })); mcp.push(mcpClient);
  const tools = await mcpClient.listTools(); assert.equal(tools.tools.length, 8);
  const lexical = await mcpClient.callTool({ name: 'search_sessions', arguments: { query: 'synthetic', mode: 'lexical', limit: 100, offset: 0 } });
  assert.notEqual(lexical.isError, true); assert.ok(Array.isArray(lexical.content));
  const firstContent = record(lexical.content[0]); assert.equal(firstContent.type, 'text');
  const parsedSearch = A.Result_JsonCodec.instance.decode(context, JSON.parse(String(firstContent.text)));
  assert.ok(parsedSearch instanceof A.Result_Search); assert.equal(parsedSearch.result.total, 3);
  assert.equal(parsedSearch.result.countScope, A.SearchCountScope.ExactMatches); assert.equal(parsedSearch.result.rankingLimit, undefined);
  const sessionId = status.jobs[0].sessionId;
  let piSession: A.SessionInfo | undefined;
  for (const job of status.jobs) {
    const session = await alice.rpc.call(new A.Operation_GetSession(job.sessionId, undefined), randomUUID()); assert.ok(session instanceof A.Result_Session);
    if (session.result.session.source.format === A.SourceFormat.Pi) piSession = session.result.session;
    const view = session.result.session.view;
    const chunks = await alice.rpc.call(new A.Operation_GetChunks(job.sessionId, 0, 100, view), randomUUID()); assert.ok(chunks instanceof A.Result_Chunks); assert.equal(chunks.result.view.revision, view.revision);
    const messages = await alice.rpc.call(new A.Operation_GetMessages(job.sessionId, 0, 100, view), randomUUID()); assert.ok(messages instanceof A.Result_Messages); assert.equal(messages.result.view.revision, view.revision);
    const raw = await alice.rpc.call(new A.Operation_GetRaw(job.sessionId, view.revision), randomUUID()); assert.ok(raw instanceof A.Result_Raw); assert.equal(raw.result.revision, view.revision);
    const rawText = raw.result.files.map(file => file.content).join('');
    assert.ok(!rawText.includes('BINARY_PAYLOAD') && !rawText.includes('SYNTHETIC_SECRET') && !rawText.includes('credential@'));
  }
  const denied = await bob.rpc.call(new A.Operation_GetSession(sessionId, undefined), randomUUID()); assert.ok(denied instanceof A.Result_Error); assert.equal(denied.failure.code, 'not-found');
  async function share(owner: Rpc, member: Rpc, target: string): Promise<string> {
    const made = await owner.call(new A.Operation_CreateGroup('synthetic group ' + target), randomUUID()); assert.ok(made instanceof A.Result_Mutation); assert.ok(made.receipt.entityId !== undefined);
    const invitation = await owner.call(new A.Operation_Invite(made.receipt.entityId, target), randomUUID()); assert.ok(invitation instanceof A.Result_Mutation); assert.ok(invitation.receipt.entityId !== undefined);
    assert.ok(await member.call(new A.Operation_AcceptInvite(invitation.receipt.entityId, true), randomUUID()) instanceof A.Result_Mutation);
    return made.receipt.entityId;
  }
  const group = await share(alice.rpc, bob.rpc, 'bob');
  assert.ok(await bob.rpc.call(new A.Operation_GetSession(sessionId, undefined), randomUUID()) instanceof A.Result_Session);
  await share(bob.rpc, carol.rpc, 'carol');
  const transitive = await carol.rpc.call(new A.Operation_GetSession(sessionId, undefined), randomUUID()); assert.ok(transitive instanceof A.Result_Error); assert.equal(transitive.failure.code, 'not-found');
  assert.ok(await bob.rpc.call(new A.Operation_LeaveGroup(group), randomUUID()) instanceof A.Result_Mutation);
  assert.ok(await bob.rpc.call(new A.Operation_GetSession(sessionId, undefined), randomUUID()) instanceof A.Result_Error);
  for (const mode of [A.SearchMode.Semantic, A.SearchMode.Hybrid]) {
    const result = await alice.rpc.call(new A.Operation_Search(new A.SearchQuery('tool', mode, new A.SearchFilter(undefined, undefined, undefined, undefined, []), 20, 0)), randomUUID());
    assert.ok(result instanceof A.Result_Search && result.result.hits.length > 0);
    assert.equal(result.result.countScope, A.SearchCountScope.CandidateWindow);
    assert.ok(result.result.rankingLimit !== undefined && result.result.rankingLimit >= result.result.total);
  }
  const tagged = await alice.rpc.call(new A.Operation_Search(new A.SearchQuery('', A.SearchMode.Lexical, new A.SearchFilter(undefined, undefined, undefined, undefined, ['verification']), 20, 0)), randomUUID());
  assert.ok(tagged instanceof A.Result_Search); assert.equal(tagged.result.total, 3);
  const facets = await alice.rpc.call(new A.Operation_Facets(new A.SearchFilter(undefined, undefined, undefined, undefined, [])), randomUUID());
  assert.ok(facets instanceof A.Result_Facets); assert.equal(facets.result.tags.find(tag => tag.value === 'verification')?.count, 3);
  assert.ok(piSession !== undefined);
  const pinned = piSession.view;
  const chunkTool = await mcpClient.callTool({ name: 'get_chunks', arguments: { sessionId: piSession.id, revision: pinned.revision, generationId: pinned.generationId, offset: 0, limit: 100 } });
  assert.notEqual(chunkTool.isError, true); assert.ok(Array.isArray(chunkTool.content));
  const toolChunks = A.Result_JsonCodec.instance.decode(context, JSON.parse(String(record(chunkTool.content[0]).text)));
  assert.ok(toolChunks instanceof A.Result_Chunks); assert.equal(toolChunks.result.view.generationId, pinned.generationId);
  for (const [name, args, expected] of [
    ['get_session', { sessionId: piSession.id, revision: pinned.revision, generationId: pinned.generationId }, A.Result_Session],
    ['get_messages', { sessionId: piSession.id, revision: pinned.revision, generationId: pinned.generationId, offset: 0, limit: 100 }, A.Result_Messages],
    ['related_sessions', { sessionId: piSession.id, limit: 10 }, A.Result_Related],
    ['list_facets', { tags: ['verification'] }, A.Result_Facets],
    ['ingest_status', { offset: 0, limit: 100 }, A.Result_Status],
    ['whoami', {}, A.Result_Whoami],
  ] as const) {
    const response = await mcpClient.callTool({ name, arguments: args }); assert.notEqual(response.isError, true); assert.ok(Array.isArray(response.content));
    const decoded = A.Result_JsonCodec.instance.decode(context, JSON.parse(String(record(response.content[0]).text))); assert.ok(decoded instanceof expected, name);
  }
  browser = await chromium.launch({ headless: true });
  const browserContext = await browser.newContext({ viewport: { width: 1440, height: 1060 } });
  const page = await browserContext.newPage(); page.on('pageerror', error => browserErrors.push(error.message));
  let dropMintResponse = false, lostMintId: string | undefined, recoveredMintId: string | undefined;
  let withholdNextServerPong = false, withheldServerPongs = 0;
  await page.routeWebSocket('**/api/ws', socket => {
    const upstream = socket.connectToServer();
    socket.onMessage(message => {
      const envelope = A.ClientEnvelope_JsonCodec.instance.decode(context, JSON.parse(message.toString()));
      if (withholdNextServerPong && envelope.operation instanceof A.Operation_Pong) {
        withholdNextServerPong = false; withheldServerPongs++; return;
      }
      upstream.send(message);
    });
    upstream.onMessage(message => {
      const envelope = A.ServerEnvelope_JsonCodec.instance.decode(context, JSON.parse(message.toString()));
      if (dropMintResponse && envelope.result instanceof A.Result_Token && envelope.result.result.secret !== undefined) {
        dropMintResponse = false; lostMintId = envelope.result.result.token.id;
        socket.close({ code: 1012, reason: 'Synthetic lost committed mint response' }); return;
      }
      if (envelope.result instanceof A.Result_Token && envelope.result.result.secret === undefined) recoveredMintId = envelope.result.result.token.id;
      socket.send(message);
    });
  });
  await page.goto(base);
  await page.getByLabel('Login', { exact: true }).fill('alice'); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in →', exact: true }).click();
  await page.getByRole('button', { name: 'access', exact: true }).click();
  await page.getByRole('textbox', { name: 'Token name' }).fill('lost-response-token'); dropMintResponse = true;
  await page.getByRole('button', { name: 'Mint token ↗', exact: true }).click();
  await page.getByRole('heading', { name: 'Confirm before repeating', exact: true }).waitFor();
  await page.locator('.connection-widget[data-state="live"]').waitFor();
  await page.getByRole('button', { name: 'Look up receipt', exact: true }).click();
  const recoveredHeading = page.getByRole('heading', { name: 'Token committed; secret unavailable', exact: true });
  const unexpectedReceipt = page.getByRole('alert').filter({ hasText: 'unexpected result type' });
  await recoveredHeading.or(unexpectedReceipt).waitFor({ timeout: 5000 });
  assert.equal(recoveredMintId, lostMintId, 'actual server receipt returns secretless token metadata');
  assert.equal(await unexpectedReceipt.count(), 0, 'production Result_Token receipt must reconcile rather than block every mutation');
  await recoveredHeading.waitFor();
  assert.ok(lostMintId !== undefined); assert.equal(await page.locator('.token-secret').count(), 0);
  const committedMint = await alice.rpc.call(new A.Operation_ListTokens(), randomUUID()); assert.ok(committedMint instanceof A.Result_Tokens);
  assert.equal(committedMint.result.tokens.filter(token => token.info.name === 'lost-response-token').length, 1, 'lost mint must not replay');
  await page.getByRole('button', { name: 'Revoke unrecoverable token', exact: true }).click();
  await page.getByText('Revoke unrecoverable token completed.', { exact: true }).waitFor();
  const revokedMint = await alice.rpc.call(new A.Operation_ListTokens(), randomUUID()); assert.ok(revokedMint instanceof A.Result_Tokens);
  assert.equal(revokedMint.result.tokens.find(token => token.info.id === lostMintId)?.info.revoked, true);
  await page.getByRole('textbox', { name: 'Token name' }).fill('replacement-token');
  await page.getByRole('button', { name: 'Mint token ↗', exact: true }).click();
  await page.getByRole('heading', { name: 'Save your token now.', exact: true }).waitFor();
  await page.getByRole('button', { name: 'I have saved it · dismiss', exact: true }).click();
  await page.getByRole('button', { name: 'archive', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search conversations' }).fill('synthetic'); await page.getByRole('radio', { name: 'Lexical', exact: true }).check();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('.search-hit').filter({ hasText: /\bPi\b/ }).click();
  await page.getByRole('heading', { name: 'Source conversation', exact: true }).waitFor();
  await page.locator('.original-message pre').filter({ hasText: '你好 🦄' }).first().waitFor();
  await page.locator('.passage-list .passage').first().click(); await page.locator('.original-message mark').first().waitFor();
  const artifacts = join(root, 'tests', 'artifacts'); await mkdir(artifacts, { recursive: true });
  const runtime = cmd.includes('-jar') ? 'jvm' : 'native';
  await page.screenshot({ path: join(artifacts, `${runtime}-desktop.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.original-message').first().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const pre = document.querySelector<HTMLElement>('.original-message pre'), transcript = document.querySelector<HTMLElement>('.transcript');
    if (!pre || !transcript || !pre.checkVisibility({ contentVisibilityAuto: true }) || !pre.innerText.trim()) return false;
    const rect = pre.getBoundingClientRect(), clip = transcript.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > Math.max(0, clip.top) && rect.top < Math.min(innerHeight, clip.bottom);
  }, undefined, { timeout: 3000 });
  await page.evaluate(async () => {
    const pre = document.querySelector<HTMLElement>('.original-message pre')!, transcript = document.querySelector<HTMLElement>('.transcript')!;
    const deadline = performance.now() + 3000;
    let previous = '', stable = 0;
    while (performance.now() < deadline) {
      await new Promise<void>(done => requestAnimationFrame(() => done()));
      const rect = pre.getBoundingClientRect(), current = JSON.stringify([rect.x, rect.y, rect.width, rect.height, scrollY, transcript.scrollTop]);
      stable = pre.checkVisibility({ contentVisibilityAuto: true }) && current === previous ? stable + 1 : 0;
      if (stable >= 3) return;
      previous = current;
    }
    throw new Error('Mobile transcript paint did not settle within its capture deadline');
  });
  await page.screenshot({ path: join(artifacts, `${runtime}-mobile.png`) });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'live dashboard must fit a mobile viewport');
  const previousSocket = await page.locator('.active-socket strong').textContent();
  withholdNextServerPong = true;
  await eventually(async () => withheldServerPongs, count => count === 1);
  const resumedConnection = await eventually(async () => ({
    state: await page.locator('.connection-widget').getAttribute('data-state'),
    socket: await page.locator('.active-socket strong').textContent({ timeout: 1000 }).catch(() => null),
    details: await page.locator('.connection-widget').textContent(),
  }), value => ['protocol-error', 'unauthorized', 'update-required', 'stopped'].includes(value.state ?? '') || (value.state === 'live' && value.socket !== previousSocket));
  assert.equal(resumedConnection.state, 'live', `server liveness expiry must trigger bounded replacement without manual retry: ${JSON.stringify(resumedConnection)}`);
  await page.locator('.identity').getByText('alice', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(await page.getByRole('textbox', { name: 'Search conversations' }).inputValue(), 'synthetic');
  assert.equal(await page.getByRole('button', { name: 'Try again manually', exact: true }).count(), 0);
  model.control.available = false;
  const piFile = join(fixtures, 'pi', 'session.jsonl');
  const previous = await readFile(piFile, 'utf8');
  await writeFile(piFile, previous.replace('你好 🦄', 'x').replaceAll('/synthetic/project', '/synthetic/new-project'));
  run(process.execPath, [cli, '--config', collectorConfig, '--once'], undefined); await pause(20);
  run(process.execPath, [cli, '--config', collectorConfig, '--once'], undefined);
  const pending = await eventually(async () => {
    const result = await alice.rpc.call(new A.Operation_GetSession(piSession!.id, undefined), randomUUID()); assert.ok(result instanceof A.Result_Session); return result.result.session;
  }, value => value.revision === 2);
  assert.equal(pending.indexedRevision, 1); assert.equal(pending.view.generationId, pinned.generationId); assert.equal(pending.metadata.workdir, piSession.metadata.workdir);
  const oldMessages = await alice.rpc.call(new A.Operation_GetMessages(piSession.id, 0, 100, pinned), randomUUID());
  assert.ok(oldMessages instanceof A.Result_Messages); assert.ok(oldMessages.result.messages.some(message => message.text.includes('你好 🦄')));
  const latestView = new A.ContentView(2, undefined);
  const latestMessages = await alice.rpc.call(new A.Operation_GetMessages(piSession.id, 0, 100, latestView), randomUUID());
  assert.ok(latestMessages instanceof A.Result_Messages); assert.ok(!latestMessages.result.messages.some(message => message.text.includes('你好 🦄')));
  const unindexed = await alice.rpc.call(new A.Operation_GetChunks(piSession.id, 0, 100, latestView), randomUUID()); assert.ok(unindexed instanceof A.Result_Chunks); assert.equal(unindexed.result.total, 0);
  await eventually(async () => model.counts.rejected, value => value > 0);
  const unavailable = await alice.rpc.call(new A.Operation_Search(new A.SearchQuery('tool', A.SearchMode.Semantic, new A.SearchFilter(undefined, undefined, undefined, undefined, []), 20, 0)), randomUUID());
  assert.ok(unavailable instanceof A.Result_Error); assert.equal(unavailable.failure.code, 'model-http');
  const stillLexical = await alice.rpc.call(new A.Operation_Search(new A.SearchQuery('synthetic', A.SearchMode.Lexical, new A.SearchFilter(undefined, undefined, undefined, undefined, []), 20, 0)), randomUUID());
  assert.ok(stillLexical instanceof A.Result_Search); assert.equal(stillLexical.result.total, 3);
  model.control.available = true;
  const newJobs = await alice.rpc.call(new A.Operation_IngestStatus(0, 100), randomUUID()); assert.ok(newJobs instanceof A.Result_Status);
  const secondJob = newJobs.result.jobs.find(job => job.sessionId === piSession!.id && job.revision === 2); assert.ok(secondJob !== undefined);
  assert.ok(await alice.rpc.call(new A.Operation_RetryJob(secondJob.id), randomUUID()) instanceof A.Result_Mutation);
  await eventually(async () => {
    const result = await alice.rpc.call(new A.Operation_GetSession(piSession!.id, undefined), randomUUID()); assert.ok(result instanceof A.Result_Session); return result.result.session;
  }, value => value.indexedRevision === 2);
  const retained = await alice.rpc.call(new A.Operation_GetMessages(piSession.id, 0, 100, pinned), randomUUID()); assert.ok(retained instanceof A.Result_Messages);
  assert.ok(retained.result.messages.some(message => message.text.includes('你好 🦄')));
  assert.ok(await bob.rpc.call(new A.Operation_GetSession(piSession.id, pinned), randomUUID()) instanceof A.Result_Error);
  await page.getByText('Head r2 / index r2', { exact: true }).waitFor();
  await page.locator('.original-message pre').filter({ hasText: '你好 🦄' }).first().waitFor();
  await page.getByRole('button', { name: 'View latest archived revision', exact: true }).click();
  await page.getByText('Viewing source r2', { exact: true }).waitFor();
  await page.getByText('Unindexed archive view · no annotations', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Request raw records', exact: true }).click();
  await page.locator('.raw-source details').first().waitFor();
  await page.locator('.raw-source details summary').first().click();
  assert.ok(!(await page.locator('.raw-source pre').first().innerText()).includes('你好 🦄'));
  assert.deepEqual(browserErrors, []);
  assert.equal((await fetch(base + '/api/ingest', { method: 'POST', headers: { Cookie: alice.cookie, Origin: base, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const urlCredential = await fetch(base + '/mcp?token=' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
  assert.ok([400, 401, 403].includes(urlCredential.status), 'a valid token in a URL must never authenticate a protected endpoint');
  for (const client of mcp) await client.close(); mcp.length = 0;
  for (const rpc of sockets) rpc.socket.terminate(); sockets.length = 0;
  assert.ok(await stopProcess(child!), 'server shutdown must be graceful');
  await start();
  const restored = await login('alice'); assert.ok(await restored.rpc.call(new A.Operation_GetSession(sessionId, undefined), randomUUID()) instanceof A.Result_Session);
  await page.getByText('Viewing source r2', { exact: true }).waitFor();
  await page.locator('.passage-list .passage').first().waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Search conversations' }).inputValue(), 'synthetic');
  const dumpFile = join(directory, 'synthetic-backup.sql');
  const dump = run(join(pg, 'pg_dump'), ['-h', '127.0.0.1', '-p', String(dbPort), '-U', 'chronicle_test', '-d', 'chronicle_test', '--no-owner'], undefined);
  await writeFile(dumpFile, dump); assert.ok((await readFile(dumpFile, 'utf8')).includes('ch_sources'));
  run(join(pg, 'createdb'), ['-h', '127.0.0.1', '-p', String(dbPort), '-U', 'chronicle_test', 'chronicle_restored'], undefined);
  run(join(pg, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(dbPort), '-U', 'chronicle_test', '-d', 'chronicle_restored'], dump);
  const restoredCount = run(join(pg, 'psql'), ['-X', '-tAc', 'SELECT count(*) FROM ch_sources', '-h', '127.0.0.1', '-p', String(dbPort), '-U', 'chronicle_test', '-d', 'chronicle_restored'], undefined).trim();
  assert.equal(restoredCount, '3');
  assert.ok(await stopProcess(child!), 'server shutdown must be graceful');
  await writeFile(configFile, JSON.stringify({ ...config, jdbcUrl: `jdbc:postgresql://127.0.0.1:${dbPort}/chronicle_restored` }), { mode: 0o600 });
  await start();
  const backupReader = await login('alice');
  assert.ok(await backupReader.rpc.call(new A.Operation_GetSession(sessionId, undefined), randomUUID()) instanceof A.Result_Session);
  await page.getByText('Viewing source r2', { exact: true }).waitFor();
  assert.deepEqual(browserErrors, []);
  await browser.close(); browser = undefined;
  successful = true;
  console.log(JSON.stringify({ kind: 'chronicle-workflow', command: cmd[0], sessions: 3, annotationCalls: model.counts.annotation, embeddingCalls: model.counts.embedding, officialMcpClient: '1.32.2', liveDashboard: 'passed', liveDashboardRestart: 'passed', serverLivenessRecovery: 'passed', immutableSourceViews: 'passed', modelOutage: 'passed', restart: 'passed', backupRestore: 'passed', httpsModels: 'passed' }));
});
