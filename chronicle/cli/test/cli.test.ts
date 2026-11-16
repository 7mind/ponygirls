import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { decodeWire, encodeWire } from '../src/wire.js';
import { parseJson, isObject } from '../src/json.js';
const CLI = fileURLToPath(new URL('../src/main.js', import.meta.url));
const ID = '11111111-1111-4111-8111-111111111111'; const GENERATION = '22222222-2222-4222-8222-222222222222';
const USER = { id: 'alice', login: 'alice', displayName: 'Alice', actor: 'owner-binding' };
const VERSION = { current: '1.9.0', minimum: '1.9.0', supported: ['1.9.0'] };
const COOKIE = 'synthetic-cookie-0123456789012345';
interface Fixture { origin: string; root: string; requests: { path: string; headers: IncomingMessage['headers']; body: string }[]; close(): Promise<void> }
function reply(response: ServerResponse, status: number, value: unknown, headers: Record<string, string>): void { response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(JSON.stringify(value)); }
async function fixture(handler: (request: IncomingMessage, response: ServerResponse, body: string) => void, wsHandler: ((socket: Duplex, value: unknown) => void) | null): Promise<Fixture> {
  const requests: Fixture['requests'] = []; const root = mkdtempSync(join(tmpdir(), 'chronicle-cli-')); const sockets = new Set<Duplex>();
  const server = createServer(async (request, response) => { let body = ''; for await (const chunk of request) body += String(chunk); requests.push({ path: request.url!, headers: request.headers, body }); handler(request, response, body); });
  server.on('connection', socket => { socket.on('error', () => {}); sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket) => {
    requests.push({ path: request.url!, headers: request.headers, body: '' });
    if (wsHandler === null) { socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return; }
    const key = request.headers['sec-websocket-key']; assert.equal(typeof key, 'string');
    const accept = createHash('sha1').update(String(key) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buffer: Buffer = Buffer.alloc(0);
    socket.on('data', bytes => { buffer = Buffer.concat([buffer, bytes]); for (;;) {
      if (buffer.length < 2) return; const opcode = buffer[0]! & 15; let length = buffer[1]! & 127; let position = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); position = 4; }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); position = 10; }
      const masked = (buffer[1]! & 128) !== 0; const maskLength = masked ? 4 : 0; if (buffer.length < position + maskLength + length) return;
      const data = Buffer.from(buffer.subarray(position + maskLength, position + maskLength + length)); if (masked) for (let i = 0; i < data.length; i++) data[i] = data[i]! ^ buffer[position + i % 4]!;
      buffer = buffer.subarray(position + maskLength + length);
      if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      if (opcode === 1) wsHandler(socket, JSON.parse(data.toString('utf8')) as unknown);
    } });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address !== null && typeof address !== 'string');
  return { root, origin: `http://127.0.0.1:${address.port}`, requests, async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))); rmSync(root, { recursive: true }); } };
}
function send(socket: Duplex, requestId: string, result: unknown): void {
  const data = Buffer.from(JSON.stringify({ requestId, result })); let header: Buffer;
  if (data.length < 126) header = Buffer.from([0x81, data.length]); else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2); }
  socket.write(Buffer.concat([header, data]));
}
function ws(operation: (socket: Duplex, id: string, op: Record<string, unknown>) => void): (socket: Duplex, value: unknown) => void {
  return (socket, value) => { const envelope = decodeWire('ClientEnvelope', value); const encoded = encodeWire('Operation', envelope.operation); assert.ok(isObject(encoded)); if ('Hello' in encoded) send(socket, envelope.requestId, { Hello: { versions: VERSION, user: { id: 'alice', login: 'alice', scopes: ['Ingest', 'Read', 'Raw'] } } }); else operation(socket, envelope.requestId, encoded); };
}
function state(f: Fixture): void {
  const directory = join(f.root, 'state'); mkdirSync(directory, { mode: 0o700 }); const name = createHash('sha256').update(f.origin).digest('hex');
  writeFileSync(join(directory, `${name}.json`), JSON.stringify({ origin: f.origin, cookie: COOKIE, actor: USER.actor, user: USER }), { mode: 0o600 });
}
async function cli(args: string[], f: Fixture | null, environment: Record<string, string>, stdin: string | null): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], HOME: f === null ? '/nonexistent' : f.root, ...(f === null ? {} : { CHRONICLE_STATE_DIR: join(f.root, 'state') }), ...environment };
  const child = spawn(process.execPath, [CLI, ...(f === null ? [] : ['--url', f.origin, '--allow-insecure-http']), ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); }); child.stdin.on('error', () => {}); child.stdin.end(stdin === null ? undefined : stdin);
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try { const code = await new Promise<number>((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => signal === null ? resolve(code!) : reject(new Error(`CLI terminated ${signal}`))); }); return { code, stdout, stderr }; } finally { clearTimeout(timer); }
}
// Specified: actual CLI subprocesses against disposable owned HTTP/WS fixtures.
test('help/catalog are lazy and --json help remains one machine-readable document', async () => {
  for (const args of [['--help'], ['rpc', 'help'], ['rpc', 'help', 'ReadMcpTest']]) { const result = await cli(args, null, { CHRONICLE_TOKEN_FILE: '/unreadable', CHRONICLE_TOKEN: 'ambiguous' }, null); assert.equal(result.code, 0, result.stderr); assert.equal(result.stderr, ''); }
  const result = await cli(['--json', '--help'], null, {}, null); assert.equal(result.code, 0); assert.ok(isObject(parseJson(result.stdout)));
});
test('public versions and default human output do not read ambient bearer files', async () => {
  const f = await fixture((_q, r) => reply(r, 200, VERSION, {}), null); try {
    const human = await cli(['versions'], f, { CHRONICLE_TOKEN_FILE: '/absent' }, null); assert.equal(human.code, 0, human.stderr); assert.match(human.stdout, /current: 1.9.0/); assert.equal(human.stderr, '');
    for (const args of [['--json', 'versions'], ['versions', '--json']]) { const result = await cli(args, f, {}, null); assert.equal(result.code, 0); assert.deepEqual(JSON.parse(result.stdout), VERSION); assert.equal(result.stderr, ''); }
  } finally { await f.close(); }
});
test('selected bearer ambiguity, unsafe origins, invalid typed rpc and missing confirmation send no requests', async () => {
  const f = await fixture((_q, r) => reply(r, 200, VERSION, {}), null); try {
    for (const [args, env, stdin] of [
      [['whoami', '--auth', 'bearer'], { CHRONICLE_TOKEN: 'secret', CHRONICLE_TOKEN_FILE: '/absent' }, null],
      [['rpc', '--file', '-'], {}, '{"Purge":{"sessionId":"bad"}}'],
      [['purge', ID], {}, null],
      [['groups', 'create', 'a'], {}, null],
    ] as [string[], Record<string, string>, string | null][]) { const result = await cli(args, f, env, stdin); assert.notEqual(result.code, 0); assert.equal(result.stdout, ''); }
    for (const url of ['https://u:password@example.org', 'https://example.org/path', 'https://example.org?token=secret', 'http://example.org']) { const result = await cli(['--url', url, 'versions'], null, {}, null); assert.equal(result.code, 2); assert.ok(!result.stderr.includes('password')); }
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
test('human login stores private exact-origin session without reading bearer, and actor-bound logout deletes only that state', async () => {
  const f = await fixture((q, r, body) => {
    if (q.url!.endsWith('/login')) { assert.deepEqual(JSON.parse(body), { login: 'alice', password: 'synthetic' }); assert.equal(q.headers.authorization, undefined); reply(r, 200, { user: USER }, { 'Set-Cookie': `chronicle_session=${COOKIE}; Path=/; HttpOnly; SameSite=Strict; Max-Age=34560000` }); }
    else { assert.equal(q.headers.cookie, `chronicle_session=${COOKIE}`); assert.equal(q.headers['x-account-actor'], USER.actor); assert.equal(q.headers.origin, f.origin); reply(r, 200, { ok: true }, {}); }
  }, null); try {
    const password = join(f.root, 'password'); writeFileSync(password, 'synthetic\n', { mode: 0o600 });
    const logged = await cli(['login', '--login', 'alice', '--password-file', password, '--json'], f, { CHRONICLE_TOKEN: 'unrelated', CHRONICLE_TOKEN_FILE: '/absent' }, null); assert.equal(logged.code, 0, logged.stderr); assert.deepEqual(JSON.parse(logged.stdout), { user: USER }); assert.ok(!logged.stdout.includes(COOKIE));
    const directory = join(f.root, 'state'); assert.equal(lstatSync(directory).mode & 0o777, 0o700); const file = join(directory, readdirSync(directory)[0]!); assert.equal(lstatSync(file).mode & 0o777, 0o600);
    const result = await cli(['logout', '--yes', '--json'], f, {}, null); assert.equal(result.code, 0, result.stderr); assert.ok(!existsSync(file));
  } finally { await f.close(); }
});
test('state wrong origin/permissions/symlinks and public password files are rejected before network', async () => {
  const f = await fixture((_q, r) => reply(r, 200, VERSION, {}), null); try {
    state(f); const directory = join(f.root, 'state'); const file = join(directory, readdirSync(directory)[0]!); chmodSync(file, 0o644); assert.equal((await cli(['whoami'], f, {}, null)).code, 3); chmodSync(file, 0o600);
    const value = JSON.parse(readFileSync(file, 'utf8')) as { origin: string }; value.origin = 'https://different.example'; writeFileSync(file, JSON.stringify(value)); assert.equal((await cli(['whoami'], f, {}, null)).code, 3);
    rmSync(directory, { recursive: true }); mkdirSync(join(f.root, 'other'), { mode: 0o700 }); symlinkSync(join(f.root, 'other'), directory); assert.equal((await cli(['whoami'], f, {}, null)).code, 3);
    const password = join(f.root, 'public-password'); writeFileSync(password, 'do-not-print', { mode: 0o644 }); const result = await cli(['login', '--login', 'alice', '--password-file', password], f, {}, null); assert.equal(result.code, 3); assert.ok(!result.stderr.includes('do-not-print')); assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
test('actual WS negotiates current version, preserves exact view/page and answers correlated server heartbeat', async () => {
  let receivedPong = false;
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id, op) => {
    if ('GetMessages' in op) { assert.deepEqual(op['GetMessages'], { sessionId: ID, offset: 20, limit: 2, view: { revision: 4, generationId: GENERATION } }); send(socket, ID, { Ping: { nonce: 'heartbeat-nonce' } }); }
    else if ('Pong' in op) { assert.equal(id, ID); assert.deepEqual(op['Pong'], { nonce: 'heartbeat-nonce' }); receivedPong = true; const req = f.requests.find(q => q.path === '/api/ws')!; assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.origin, f.origin); send(socket, pendingId!, { Messages: { result: { messages: [{ id: 'message-full-id', parentId: null, role: 'user', text: 'hé🙂\u001b]52;attack\u0007', timestamp: null, recordIndex: 9 }], total: 42, offset: 20, view: { revision: 4, generationId: GENERATION } } } }); }
    if ('GetMessages' in op) pendingId = id;
  })); let pendingId: string | null = null;
  try { state(f); const result = await cli(['messages', ID, '--revision', '4', '--generation', GENERATION, '--offset', '20', '--limit', '2'], f, {}, null); assert.equal(result.code, 0, result.stderr); assert.equal(receivedPong, true); assert.match(result.stdout, /message-full-id/); assert.match(result.stdout, /hé🙂\\u001b/); assert.ok(!result.stdout.includes('\u001b')); assert.equal(result.stderr, ''); } finally { await f.close(); }
});
test('server errors are sanitized and retired pins do not fall back to HEAD', async () => {
  const f = await fixture((_q, r) => reply(r, 200, VERSION, {}), ws((socket, id) => send(socket, id, { Error: { failure: { code: 'indexed-view-retired', message: 'secret\u001b remote private body' } } }))); try { state(f); const result = await cli(['messages', ID, '--revision', '4', '--generation', GENERATION, '--json'], f, {}, null); assert.equal(result.code, 4); assert.equal(result.stdout, ''); assert.match(result.stderr, /indexed-view-retired/); assert.ok(!result.stderr.includes('secret')); assert.equal(f.requests.length, 1); } finally { await f.close(); }
});
test('lost WS mutation acknowledgement is uncertain with its recoverable request UUID and no retry', async () => {
  let calls = 0; const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, _id, op) => { if ('Purge' in op) { calls++; socket.destroy(); } })); try { state(f); const result = await cli(['purge', ID, '--yes', '--request-id', GENERATION, '--timeout-ms', '1000', '--json'], f, {}, null); assert.equal(result.code, 7, result.stderr); assert.equal(result.stdout, ''); assert.match(result.stderr, new RegExp(`receipt ${GENERATION}`)); assert.equal(calls, 1); } finally { await f.close(); }
});
test('lost read deadline is bounded and protocol negotiation rejects removed/future-only versions', async () => {
  const f = await fixture((_q, r) => reply(r, 200, VERSION, {}), ws(() => {})); try { state(f); const start = performance.now(); const result = await cli(['whoami', '--timeout-ms', '150'], f, {}, null); assert.equal(result.code, 6); assert.match(result.stderr, /deadline/); assert.ok(performance.now() - start < 2500); } finally { await f.close(); }
  for (const version of ['1.8.0', '2.0.0']) {
    const f = await fixture((_q, r) => reply(r, 200, VERSION, {}), (socket, value) => { assert.ok(isObject(value)); send(socket, String(value['requestId']), { Hello: { versions: { current: version, minimum: version, supported: [version] }, user: { id: 'alice', login: 'alice', scopes: ['Read'] } } }); });
    try { state(f); const result = await cli(['whoami'], f, {}, null); assert.equal(result.code, 6); assert.match(result.stderr, /version-mismatch/); assert.equal(f.requests.length, 1); } finally { await f.close(); }
  }
});
test('bearer MCP uses generated results, exact pinned parameters and no cookie; revocation is not retried', async () => {
  let calls = 0; const f = await fixture((q, r, body) => {
    if (q.url === '/api/versions') { assert.equal(q.headers.authorization, undefined); reply(r, 200, VERSION, {}); return; }
    calls++; assert.equal(q.headers.authorization, 'Bearer synthetic-token-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEF'); assert.equal(q.headers.cookie, undefined); const rpc = JSON.parse(body) as { id: string; params: { name: string; arguments: unknown } }; assert.equal(rpc.params.name, 'get_messages'); assert.deepEqual(rpc.params.arguments, { sessionId: ID, revision: 4, generationId: GENERATION, offset: 0, limit: 20 });
    reply(r, 401, { code: 'unauthorized', message: 'synthetic-token-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEF remote secrets' }, {});
  }, null); try { const result = await cli(['messages', ID, '--revision', '4', '--generation', GENERATION, '--auth', 'bearer', '--json'], f, { CHRONICLE_TOKEN: 'synthetic-token-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEF' }, null); assert.equal(result.code, 3, result.stderr); assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes('synthetic-token-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEF')); assert.equal(calls, 1); } finally { await f.close(); }
});
test('HTTP mutations distinguish definitive invalid from uncertain acknowledgement loss', async () => {
  const f = await fixture((_q, r) => reply(r, 400, { error: { code: 'invalid', message: 'secret never print' } }, {}), null); try { state(f); const result = await cli(['logout', '--yes', '--json'], f, {}, null); assert.equal(result.code, 2, result.stderr); assert.ok(!result.stderr.includes('secret')); assert.equal(f.requests.length, 1); } finally { await f.close(); }
});
test('StartMcpTest keeps its owning socket until terminal state and returns complete bounded trace once', async () => {
  let starts = 0; let reads = 0;
  const snapshot = (state: string, sequence: string, events: unknown[]) => ({ McpTestRun: { result: { instanceId: ID, runId: GENERATION, state, observedAt: '2026-11-16T00:00:00Z', events, lastSequence: sequence, hasMore: false, failure: null } } });
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id, operation) => {
    if ('StartMcpTest' in operation) { starts++; send(socket, id, snapshot('Running', '1', [{ sequence: '1', observedAt: '2026-11-16T00:00:00Z', item: { Response: { partIndex: 0, partCount: 2, textPart: 'part one' } } }])); }
    if ('ReadMcpTest' in operation) { reads++; assert.deepEqual(operation['ReadMcpTest'], { instanceId: ID, runId: GENERATION, afterSequence: '1', limit: 100 }); send(socket, id, snapshot('Complete', '2', [{ sequence: '2', observedAt: '2026-11-16T00:00:00Z', item: { Response: { partIndex: 1, partCount: 2, textPart: 'part two' } } }])); }
  })); try { state(f); const result = await cli(['rpc', '--file', '-', '--yes', '--json'], f, {}, JSON.stringify({ StartMcpTest: { instanceId: ID, runId: GENERATION, prompt: 'synthetic task' } })); assert.equal(result.code, 0, result.stderr); const data = JSON.parse(result.stdout) as { McpTestRun: { result: { state: string; events: unknown[] } } }; assert.equal(data.McpTestRun.result.state, 'Complete'); assert.equal(data.McpTestRun.result.events.length, 2); assert.equal(starts, 1); assert.equal(reads, 1); assert.equal(f.requests.length, 1); assert.equal(result.stderr, ''); } finally { await f.close(); }
});
test('mint fails before network when secret output already exists', async () => {
  const f = await fixture((_q, r) => reply(r, 503, { error: { code: 'unavailable', message: 'not relevant' } }, {}), null); try { state(f); const path = join(f.root, 'existing'); writeFileSync(path, 'keep me', { mode: 0o600 }); const result = await cli(['tokens', 'mint', '--name', 'fixture', '--scopes', 'Read', '--secret-out', path, '--yes'], f, {}, null); assert.notEqual(result.code, 0); assert.equal(f.requests.length, 0); assert.equal(readFileSync(path, 'utf8'), 'keep me'); } finally { await f.close(); }
});
test('managed credential symlink resolves once to a bounded private regular token file', async () => {
  const token = 'synthetic-long-bearer-token-012345678901234567890123456789';
  const f = await fixture((q, r, body) => { if (q.url === '/api/versions') { reply(r, 200, VERSION, {}); return; } assert.equal(q.headers.authorization, `Bearer ${token}`); const rpc = JSON.parse(body) as { id: string }; reply(r, 200, { jsonrpc: '2.0', id: rpc.id, result: { isError: false, content: [{ type: 'text', text: JSON.stringify({ Whoami: { user: { id: 'alice', login: 'alice', scopes: ['Read'] } } }) }] } }, {}); }, null);
  try { const file = join(f.root, 'managed-secret'); writeFileSync(file, token + '\n', { mode: 0o600 }); const link = join(f.root, 'configured-secret'); symlinkSync(file, link); const result = await cli(['whoami', '--auth', 'bearer', '--json'], f, { CHRONICLE_TOKEN_FILE: link }, null); assert.equal(result.code, 0, result.stderr); assert.ok(!result.stdout.includes(token)); } finally { await f.close(); }
});
test('post-StartMcpTest polling rejection reports incomplete provider execution, not an ordinary definitive read error', async () => {
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id, operation) => {
    if ('StartMcpTest' in operation) send(socket, id, { McpTestRun: { result: { instanceId: ID, runId: GENERATION, state: 'Running', observedAt: '2026-11-16T00:00:00Z', events: [], lastSequence: '0', hasMore: false, failure: null } } });
    if ('ReadMcpTest' in operation) send(socket, id, { Error: { failure: { code: 'unavailable', message: 'private data must not appear' } } });
  })); try { state(f); const result = await cli(['rpc', '--file', '-', '--yes', '--json'], f, {}, JSON.stringify({ StartMcpTest: { instanceId: ID, runId: GENERATION, prompt: 'synthetic' } })); assert.equal(result.code, 7, result.stderr); assert.match(result.stderr, /Original provider execution is unknown/); assert.ok(!result.stderr.includes('private data')); assert.equal(result.stdout, ''); } finally { await f.close(); }
});
test('lost CancelMcpTest acknowledgement refers to original run identity, not a nonexistent durable receipt', async () => {
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, _id, operation) => { if ('CancelMcpTest' in operation) socket.destroy(); })); try { state(f); const result = await cli(['rpc', '--file', '-', '--yes', '--timeout-ms', '1000'], f, {}, JSON.stringify({ CancelMcpTest: { instanceId: ID, runId: GENERATION } })); assert.equal(result.code, 7, result.stderr); assert.match(result.stderr, /ReadMcpTest/); assert.match(result.stderr, new RegExp(ID)); assert.ok(!result.stderr.includes('chronicle receipt')); } finally { await f.close(); }
});
test('malformed account success cannot echo a session secret or acknowledge an unconfirmed logout', async () => {
  const f = await fixture((q, r) => { if (q.method === 'GET') reply(r, 200, { user: USER, tokens: [], scopes: ['Read'], unexpectedSecret: COOKIE }, {}); else reply(r, 200, { ok: false }, {}); }, null);
  try { state(f); const result = await cli(['settings', '--json'], f, {}, null); assert.equal(result.code, 6); assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes(COOKIE)); const logged = await cli(['logout', '--yes', '--json'], f, {}, null); assert.equal(logged.code, 7); assert.equal(logged.stdout, ''); assert.equal(readdirSync(join(f.root, 'state')).length, 1); } finally { await f.close(); }
});
test('HTTP responses are bounded and never follow redirects with cookie or bearer credentials', async () => {
  const downstream = await fixture((_q, r) => reply(r, 200, VERSION, {}), null);
  const f = await fixture((q, r) => { if (q.url === '/api/versions') reply(r, 200, VERSION, {}); else { r.writeHead(307, { Location: `${downstream.origin}/stolen` }); r.end(); } }, null);
  try { state(f); const result = await cli(['settings', '--json'], f, {}, null); assert.equal(result.code, 6); assert.equal(result.stdout, ''); const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/.=-'; const read = await cli(['whoami', '--auth', 'bearer', '--json'], f, { CHRONICLE_TOKEN: token }, null); assert.equal(read.code, 6); assert.equal(downstream.requests.length, 0); } finally { await f.close(); await downstream.close(); }
  const big = await fixture((_q, r) => { r.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(8 * 1024 * 1024 + 1) }); r.end(); }, null);
  try { const result = await cli(['versions', '--json'], big, {}, null); assert.equal(result.code, 6); assert.match(result.stderr, /too-large/); assert.equal(result.stdout, ''); } finally { await big.close(); }
});
test('special credential files fail promptly without attempting network', async () => {
  const f = await fixture((_q, r) => reply(r, 200, VERSION, {}), null);
  try { const fifo = join(f.root, 'credential-fifo'); assert.equal(spawnSync('mkfifo', [fifo]).status, 0); for (const file of ['/dev/null', fifo]) { const result = await cli(['whoami', '--auth', 'bearer'], f, { CHRONICLE_TOKEN_FILE: file }, null); assert.equal(result.code, 3); } assert.equal(f.requests.length, 0); } finally { await f.close(); }
});
test('initial StartMcpTest acknowledgement error after possible admission retains run uncertainty identifiers', async () => {
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id) => send(socket, id, { Error: { failure: { code: 'mcp-run-changed', message: 'private diagnostic' } } }))); try { state(f); const result = await cli(['rpc', '--file', '-', '--yes'], f, {}, JSON.stringify({ StartMcpTest: { instanceId: ID, runId: GENERATION, prompt: 'synthetic' } })); assert.equal(result.code, 7, result.stderr); assert.match(result.stderr, new RegExp(ID)); assert.match(result.stderr, new RegExp(GENERATION)); assert.ok(!result.stderr.includes('private diagnostic')); assert.equal(result.stdout, ''); } finally { await f.close(); }
});
test('lost ingest/progress acknowledgements retain their own recovery identity, not account-token guidance', async () => {
  const f = await fixture((q, r) => { if (q.url === '/api/versions') reply(r, 200, VERSION, {}); else q.socket.destroy(); }, null);
  const ingest = { requestId: ID, source: { collectorNamespace: 'owned-test', discoveryRootId: 'root', format: 'Pi', producerSessionId: 'producer', subagentId: null }, expectedRevision: 0, digest: 'a'.repeat(64), completion: 'Quiescent', redacted: false, metadata: { title: 'synthetic', project: null, workdir: null, gitRemote: null, gitBranch: null, gitCommit: null, producer: 'pi', model: null, startedAt: null, endedAt: null, tags: [] }, messages: [], files: [] };
  const progress = { collectorId: 'owned-test', sequence: '19', runId: ID, phase: 'Idle', startedAt: '2026-11-16T00:00:00Z', counters: { discovered: 0, scanned: 0, waiting: 0, excluded: 0, unchanged: 0, enqueued: 0, uploaded: 0, uploadFailures: 0, quarantined: 0, pending: 0, stopped: 0, conflicts: 0, scannedBytes: '0' }, totalUploadBytes: '0', uploadedBytes: '0', currentUploadTotalBytes: null, error: null };
  try { for (const [command, document] of [['ingest', ingest], ['report-progress', progress]] as const) { const result = await cli([command, '--file', '-', '--yes', '--json'], f, { CHRONICLE_TOKEN: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/.=-' }, JSON.stringify(document)); assert.equal(result.code, 7); assert.match(result.stderr, new RegExp(ID)); assert.ok(!result.stderr.includes('account token/session')); assert.equal(result.stdout, ''); } } finally { await f.close(); }
});
test('empty tag pagination cursor is sent exactly, and full tag values survive JSON', async () => {
  const value = 'tag-full-id-hé🙂\u202e';
  const f = await fixture((q, r, body) => { if (q.url === '/api/versions') { reply(r, 200, VERSION, {}); return; } const request = JSON.parse(body) as { id: string; params: { name: string; arguments: Record<string, unknown> } }; assert.equal(request.params.name, 'search_tags'); assert.equal(request.params.arguments['afterTag'], ''); reply(r, 200, { jsonrpc: '2.0', id: request.id, result: { isError: false, content: [{ type: 'text', text: JSON.stringify({ Facets: { result: { projects: [], branches: [], tags: [{ value, count: 1 }] } } }) }] } }, {}); }, null);
  try { const result = await cli(['tags', '', '--auth', 'bearer', '--cursor', '', '--json'], f, { CHRONICLE_TOKEN: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/.=-' }, null); assert.equal(result.code, 0, result.stderr); assert.equal((JSON.parse(result.stdout) as { Facets: { result: { tags: { value: string }[] } } }).Facets.result.tags[0]!.value, value); assert.ok(!result.stdout.includes('\u202e')); } finally { await f.close(); }
});
test('logout of a captured owner does not erase a concurrently replaced independent account session', async () => {
  const f = await fixture((_q, r) => {
    const directory = join(f.root, 'state'); const file = join(directory, readdirSync(directory)[0]!);
    writeFileSync(file, JSON.stringify({ origin: f.origin, cookie: 'bob-cookie-0123456789012345678901234567890', actor: 'bob-binding', user: { id: 'bob', login: 'bob', displayName: 'Bob', actor: 'bob-binding' } }));
    reply(r, 200, { ok: true }, {});
  }, null);
  try { state(f); const result = await cli(['logout', '--yes', '--json'], f, {}, null); assert.equal(result.code, 0, result.stderr); const files = readdirSync(join(f.root, 'state')); assert.equal(files.length, 1); assert.equal((JSON.parse(readFileSync(join(f.root, 'state', files[0]!), 'utf8')) as { user: { id: string } }).user.id, 'bob'); } finally { await f.close(); }
});
test('typed post-effect cancellation error is uncertain with its original run key', async () => {
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id) => send(socket, id, { Error: { failure: { code: 'mcp-run-changed', message: 'private detail' } } }))); try { state(f); const result = await cli(['rpc', '--file', '-', '--yes'], f, {}, JSON.stringify({ CancelMcpTest: { instanceId: ID, runId: GENERATION } })); assert.equal(result.code, 7, result.stderr); assert.match(result.stderr, /ReadMcpTest/); assert.ok(!result.stderr.includes('private detail')); assert.equal(result.stdout, ''); } finally { await f.close(); }
});
test('MCP terminal Complete cannot silently omit events advertised by lastSequence', async () => {
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id) => send(socket, id, { McpTestRun: { result: { instanceId: ID, runId: GENERATION, state: 'Complete', observedAt: '2026-11-16T00:00:00Z', events: [], lastSequence: '1', hasMore: false, failure: null } } }))); try { state(f); const result = await cli(['rpc', '--file', '-', '--yes', '--json'], f, {}, JSON.stringify({ StartMcpTest: { instanceId: ID, runId: GENERATION, prompt: 'synthetic' } })); assert.equal(result.code, 7, result.stderr); assert.equal(result.stdout, ''); } finally { await f.close(); }
});
for (const code of ['unauthorized', 'unavailable', 'protocol-error', 'unknown-after-delivery']) test(`post-commit WS mutation ${code} remains uncertain with its original receipt identity`, async () => {
  let committed = 0;
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id, operation) => {
    assert.ok('CreateGroup' in operation); committed++;
    send(socket, id, { Error: { failure: { code, message: 'private-delivery-canary' } } });
    if (code === 'unauthorized') socket.end(Buffer.from([0x88, 2, 0x11, 0x31]));
  }));
  try { state(f); const result = await cli(['groups', 'create', 'owned-fixture', '--yes', '--request-id', GENERATION, '--json'], f, {}, null); assert.equal(result.code, 7, result.stderr); assert.match(result.stderr, new RegExp(`chronicle receipt ${GENERATION}`)); assert.ok(!result.stderr.includes('private-delivery-canary')); assert.equal(result.stdout, ''); assert.equal(committed, 1); } finally { await f.close(); }
});
for (const [code, expected] of [['invalid', 2], ['conflict', 5], ['not-found', 4], ['forbidden', 3]] as const) test(`proven WS business rejection ${code} remains definitive`, async () => {
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id) => send(socket, id, { Error: { failure: { code, message: 'private-rejection-canary' } } })));
  try { state(f); const result = await cli(['groups', 'create', 'rejected-fixture', '--yes', '--request-id', GENERATION], f, {}, null); assert.equal(result.code, expected, result.stderr); assert.ok(!result.stderr.includes('chronicle receipt')); assert.ok(!result.stderr.includes('private-rejection-canary')); assert.equal(result.stdout, ''); } finally { await f.close(); }
});
for (const [name, fault] of [
  ['code-only', { error: { code: 'invalid' } }],
  ['wrong-family', { code: 'invalid', message: 'private-fault-canary' }],
  ['outer-extra', { error: { code: 'invalid', message: 'private-fault-canary' }, extra: true }],
  ['inner-extra', { error: { code: 'invalid', message: 'private-fault-canary', extra: true } }],
  ['unrecognized', { error: { code: 'unknown-fault', message: 'private-fault-canary' } }],
] as const) test(`post-dispatch account ${name} fault lookalike is not an acknowledged rejection`, async () => {
  let committed = 0;
  const f = await fixture((_q, r) => { committed++; reply(r, 400, fault, {}); }, null);
  try { state(f); const result = await cli(['logout', '--yes', '--json'], f, {}, null); assert.equal(result.code, 7, result.stderr); assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes('private-fault-canary')); assert.equal(committed, 1); assert.equal(readdirSync(join(f.root, 'state')).length, 1); } finally { await f.close(); }
});
for (const [status, code, expected] of [[400, 'invalid', 2], [409, 'conflict', 5], [401, 'unauthorized', 3], [503, 'unavailable', 7], [500, 'invalid', 7]] as const) test(`account current fault ${code}/${status} uses route-specific outcome semantics`, async () => {
  const f = await fixture((_q, r) => reply(r, status, { error: { code, message: 'private-fault-canary' } }, {}), null);
  try { state(f); const result = await cli(['logout', '--yes', '--json'], f, {}, null); assert.equal(result.code, expected, result.stderr); assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes('private-fault-canary')); } finally { await f.close(); }
});
for (const [name, fault, expected] of [
  ['code-only', { code: 'invalid' }, 7],
  ['wrong-family', { error: { code: 'invalid', message: 'private-domain-canary' } }, 7],
  ['extra-field', { code: 'invalid', message: 'private-domain-canary', extra: true }, 7],
  ['unrecognized', { code: 'unknown-fault', message: 'private-domain-canary' }, 7],
  ['current-generated', { code: 'invalid', message: 'private-domain-canary' }, 2],
] as const) test(`ordinary HTTP ${name} failure is validated separately from account faults`, async () => {
  let dispatched = 0;
  const report = { collectorId: 'owned-test', sequence: '19', runId: ID, phase: 'Idle', startedAt: '2026-11-16T00:00:00Z', counters: { discovered: 0, scanned: 0, waiting: 0, excluded: 0, unchanged: 0, enqueued: 0, uploaded: 0, uploadFailures: 0, quarantined: 0, pending: 0, stopped: 0, conflicts: 0, scannedBytes: '0' }, totalUploadBytes: '0', uploadedBytes: '0', currentUploadTotalBytes: null, error: null };
  const f = await fixture((q, r) => { if (q.url === '/api/versions') reply(r, 200, VERSION, {}); else { dispatched++; reply(r, 400, fault, {}); } }, null);
  try { const result = await cli(['report-progress', '--file', '-', '--yes', '--json'], f, { CHRONICLE_TOKEN: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/.=-' }, JSON.stringify(report)); assert.equal(result.code, expected, result.stderr); assert.ok(!result.stderr.includes('private-domain-canary')); assert.equal(result.stdout, ''); assert.equal(dispatched, 1); } finally { await f.close(); }
});
