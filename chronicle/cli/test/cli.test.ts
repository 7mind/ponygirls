import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { decodeWire, encodeWire, operationPolicy } from '../src/wire.js';
import { parseJson, isObject } from '../src/json.js';
const CASE_CONCURRENCY = 16;
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
function frameHeader(length: number): Buffer {
  if (length < 126) return Buffer.from([0x81, length]);
  if (length < 65536) { const header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(length, 2); return header; }
  const header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); return header;
}
function send(socket: Duplex, requestId: string, result: unknown): void {
  const data = Buffer.from(JSON.stringify({ requestId, result }));
  socket.write(Buffer.concat([frameHeader(data.length), data]));
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
  const installed = process.env['CHRONICLE_CLI_EXECUTABLE'];
  const child = spawn(installed === undefined ? process.execPath : installed, [...(installed === undefined ? [CLI] : []), ...(f === null ? [] : ['--url', f.origin, '--allow-insecure-http']), ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', data => { stdout += String(data); }); child.stderr.on('data', data => { stderr += String(data); }); child.stdin.on('error', () => {}); child.stdin.end(stdin === null ? undefined : stdin);
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try { const code = await new Promise<number>((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => signal === null ? resolve(code!) : reject(new Error(`CLI terminated ${signal}`))); }); return { code, stdout, stderr }; } finally { clearTimeout(timer); }
}
describe('chronicle CLI', { concurrency: CASE_CONCURRENCY }, () => {
// Specified: actual CLI subprocesses against disposable owned HTTP/WS fixtures.
// Regression: command discovery and invalid invocations must not require a configured service.
test('command-specific help is local, concise and available through both help spellings', async () => {
  for (const args of [['messages', '--help'], ['help', 'messages']]) {
    const result = await cli(args, null, { CHRONICLE_TOKEN_FILE: '/unreadable' }, null);
    assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /Usage: chronicle messages UUID/); assert.match(result.stdout, /--generation/); assert.match(result.stdout, /Examples:/); assert.ok(!result.stdout.includes('tokens mint')); assert.ok(result.stdout.split('\n').length < 30);
  }
  const result = await cli(['groups', 'invite', '--help'], null, {}, null); assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /Usage: chronicle groups invite GROUP_UUID USER/); assert.match(result.stdout, /--yes/);
});
test('invalid commands, arity and unused flags are diagnosed before origin or credential acquisition', async () => {
  for (const [args, expected] of [
    [['sarch', 'needle'], /Unknown command/], [['help', 'search', 'ignored'], /help command/], [['messages'], /Usage: chronicle messages UUID/], [['versions', '--limit', '2'], /--limit/], [['search', 'x', '--limit', '0'], /--limit.*1\.\.100/], [['tags', '', '--limit', '0'], /--limit.*1\.\.100/], [['search', '--limit'], /--limit.*value/], [['search', 'x', '--limit', '2', '--limit', '3'], /--limit.*once/],
  ] as [string[], RegExp][]) {
    const result = await cli(args, null, { CHRONICLE_TOKEN: 'unrelated', CHRONICLE_TOKEN_FILE: '/unreadable' }, null); assert.equal(result.code, 2, result.stderr); assert.equal(result.stdout, ''); assert.match(result.stderr, expected); assert.ok(!result.stderr.includes('Set --url'));
  }
});
test('explicit ingestion documents are validated locally before origin configuration', async () => {
  for (const command of ['ingest', 'report-progress']) for (const url of [[], ['--url', 'https://example.org/path']]) { const result = await cli([command, '--file', '-', '--yes', ...url], null, {}, '{}'); assert.equal(result.code, 2); assert.equal(result.stdout, ''); assert.match(result.stderr, /typed API schema/); assert.ok(!result.stderr.includes('Set --url')); }
});
test('previously ignored control flags reject before sending even a public request', async () => {
  const f = await fixture((_q, r) => reply(r, 200, VERSION, {}), null);
  try {
    for (const args of [['versions', '--request-id', 'invalid'], ['versions', '--secret-out', '/nonexistent/unused'], ['versions', '--yes'], ['whoami', '--secret-out', '/nonexistent/unused'], ['settings', '--yes']]) {
      const result = await cli(args, f, {}, null); assert.equal(result.code, 2, result.stderr); assert.equal(result.stdout, ''); assert.match(result.stderr, /not valid|not used/);
    }
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
test('literal option-like search text survives -- without rewriting or dropping values', async () => {
  const seen: string[] = [];
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id, op) => { const search = op['Search'] as { query: { query: string } }; seen.push(search.query.query); send(socket, id, { Search: { result: { hits: [], total: 0, countScope: 'ExactMatches', rankingLimit: null } } }); }));
  try {
    state(f); for (const query of ['--', '-h', '--help']) { const result = await cli(['search', '--', query], f, {}, null); assert.equal(result.code, 0, result.stderr); }
    assert.deepEqual(seen, ['--', '-h', '--help']);
  } finally { await f.close(); }
});
// Specified: a defaulted hybrid search falls back visibly to lexical when the embedding provider fails (model-transport/-timeout/-http); explicit modes never do.
test('defaulted hybrid search retries lexically with one stderr notice; explicit and unrelated failures are not substituted', async () => {
  const seen: string[] = []; let hybridFailure: string | null = 'model-transport'; let lexicalFailure: string | null = null;
  const page = { Search: { result: { hits: [], total: 0, countScope: 'ExactMatches', rankingLimit: null } } };
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id, op) => { const mode = (op['Search'] as { query: { mode: string } }).query.mode; seen.push(mode); const failure = mode === 'Lexical' ? lexicalFailure : hybridFailure; send(socket, id, failure === null ? page : { Error: { failure: { code: failure, message: 'secret\u001b remote private body' } } }); }));
  try {
    state(f);
    for (const json of [false, true]) {
      seen.length = 0; const result = await cli(['search', 'x', ...(json ? ['--json'] : [])], f, {}, null);
      assert.equal(result.code, 0, result.stderr); assert.deepEqual(seen, ['Hybrid', 'Lexical']);
      assert.equal(result.stderr, 'chronicle: hybrid search unavailable (embedding service unreachable [model-transport]); showing lexical results\n');
      if (json) assert.deepEqual(JSON.parse(result.stdout), page); else { assert.ok(result.stdout.startsWith('mode: lexical\n')); assert.ok(!result.stdout.includes('model-transport')); }
    }
    seen.length = 0; lexicalFailure = 'forbidden'; const both = await cli(['search', 'x'], f, {}, null);
    assert.equal(both.code, 3); assert.deepEqual(seen, ['Hybrid', 'Lexical']); assert.equal(both.stdout, '');
    assert.match(both.stderr, /^chronicle: hybrid search unavailable \(embedding service unreachable \[model-transport\]\); showing lexical results\n.*forbidden/s);
    lexicalFailure = null; hybridFailure = null;
    seen.length = 0; const ok = await cli(['search', 'x'], f, {}, null);
    assert.equal(ok.code, 0, ok.stderr); assert.deepEqual(seen, ['Hybrid']); assert.ok(ok.stdout.startsWith('mode: hybrid\n')); assert.equal(ok.stderr, '');
    const okJson = await cli(['search', 'x', '--json'], f, {}, null); assert.deepEqual(JSON.parse(okJson.stdout), page); assert.equal(okJson.stderr, ''); hybridFailure = 'model-transport';
    for (const args of [['search', 'x', '--mode', 'hybrid'], ['search', 'x', '--mode', 'semantic']]) {
      seen.length = 0; const result = await cli(args, f, {}, null);
      assert.equal(result.code, 6); assert.deepEqual(seen, [args[3]![0]!.toUpperCase() + args[3]!.slice(1)]); assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes('lexical results'));
    }
    seen.length = 0; hybridFailure = 'unavailable'; const other = await cli(['search', 'x'], f, {}, null);
    assert.equal(other.code, 6); assert.deepEqual(seen, ['Hybrid']); assert.equal(other.stdout, ''); assert.ok(!other.stderr.includes('lexical results'));
  } finally { await f.close(); }
});
// Specified: automatic selection uses configured bearer authority only on supported read tools.
test('configured token file selects bearer for supported commands without a human session or fallback', async () => {
  const token = 'synthetic-token-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEF'; let calls = 0;
  const f = await fixture((q, r, body) => { if (q.url === '/api/versions') { reply(r, 200, VERSION, {}); return; } calls++; assert.equal(q.headers.authorization, `Bearer ${token}`); assert.equal(q.headers.cookie, undefined); const rpc = JSON.parse(body) as { id: string }; reply(r, 200, { jsonrpc: '2.0', id: rpc.id, result: { isError: false, content: [{ type: 'text', text: JSON.stringify({ Whoami: { user: { id: 'alice', login: 'alice', scopes: ['Read'] } } }) }] } }, {}); }, null);
  try {
    const file = join(f.root, 'token'); writeFileSync(file, token + '\n', { mode: 0o600 });
    for (const args of [['whoami'], ['whoami', '--auth', 'auto'], ['whoami', '--token-file', file]]) { const result = await cli([...args, '--json'], f, args.includes('--token-file') ? {} : { CHRONICLE_TOKEN_FILE: file }, null); assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).Whoami.user.id, 'alice'); }
    assert.equal(calls, 3); const session = await cli(['whoami', '--auth', 'session'], f, { CHRONICLE_TOKEN_FILE: '/unreadable' }, null); assert.equal(session.code, 3); assert.equal(calls, 3);
  } finally { await f.close(); }
});
test('unsupported explicit authentication families fail locally without reading unselected credentials', async () => {
  for (const args of [['settings', '--auth', 'bearer'], ['groups', '--auth', 'bearer'], ['ingest', '--file', '-', '--yes', '--auth', 'session'], ['tags', '', '--auth', 'session']]) { const result = await cli(args, null, { CHRONICLE_TOKEN_FILE: '/unreadable' }, null); assert.equal(result.code, 2, result.stderr); assert.match(result.stderr, /session|bearer/); assert.ok(!result.stderr.includes('Set --url')); }
});
test('colour is explicit in pipes, suppressed for JSON, and diagnostics never echo invalid values', async () => {
  const plain = await cli(['messages', '--help'], null, {}, null); assert.equal(plain.code, 0); assert.ok(!plain.stdout.includes('\u001b'));
  for (const args of [['--color', 'always', 'messages', '--help'], ['messages', '--help', '--color=always']]) { const result = await cli(args, null, { NO_COLOR: '1', TERM: 'dumb' }, null); assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /\u001b\[/); }
  for (const args of [['--color', 'never', '--help'], ['--color', 'always', '--help', '--json']]) { const result = await cli(args, null, {}, null); assert.equal(result.code, 0, result.stderr); assert.ok(!result.stdout.includes('\u001b')); if (args.includes('--json')) assert.ok(isObject(JSON.parse(result.stdout))); }
  for (const args of [['--color', 'always', 'messages'], ['--color', 'always', '--unknown']]) { const result = await cli(args, null, {}, null); assert.equal(result.code, 2); assert.match(result.stderr, /\u001b\[/); }
  const invalid = await cli(['search', 'x', '--limit', '\u001b]52;do-not-echo\u0007', '--color', 'always', '--json'], null, {}, null); assert.equal(invalid.code, 2); assert.ok(!invalid.stderr.includes('\u001b')); assert.ok(!invalid.stderr.includes('do-not-echo'));
});
test('auto authentication keeps account and WS-only operations independent of ambient bearer ambiguity', async () => {
  let wsCalls = 0;
  const f = await fixture((q, r) => { assert.equal(q.headers.authorization, undefined); assert.equal(q.headers.cookie, `chronicle_session=${COOKIE}`); reply(r, 200, { user: USER, tokens: [], scopes: ['Read'] }, {}); }, ws((socket, id, op) => { assert.deepEqual(op, { ListGroups: {} }); wsCalls++; send(socket, id, { Groups: { result: { groups: [], invitations: [] } } }); }));
  try {
    state(f); const unrelated = { CHRONICLE_TOKEN: 'unrelated', CHRONICLE_TOKEN_FILE: '/unreadable' };
    for (const command of ['settings', 'session-status', 'tokens', 'groups']) { const result = await cli(command === 'tokens' ? ['tokens', 'list', '--json'] : [command, '--json'], f, unrelated, null); assert.equal(result.code, 0, result.stderr); }
    assert.equal(wsCalls, 1);
  } finally { await f.close(); }
});
test('auto-selected bearer rejection never falls back to an available human session', async () => {
  let mcpCalls = 0; let wsCalls = 0;
  const f = await fixture((q, r) => { if (q.url === '/api/versions') { reply(r, 200, VERSION, {}); return; } mcpCalls++; reply(r, 401, { code: 'unauthorized', message: 'private-fixture-detail' }, {}); }, ws(() => { wsCalls++; }));
  try {
    state(f); const result = await cli(['whoami'], f, { CHRONICLE_TOKEN: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/.=-' }, null); assert.equal(result.code, 3, result.stderr); assert.equal(result.stdout, ''); assert.ok(result.stderr.includes('Server unauthorized: private-fixture-detail'), result.stderr); assert.equal(mcpCalls, 1); assert.equal(wsCalls, 0);
    const missing = await cli(['whoami'], f, { CHRONICLE_TOKEN_FILE: '/unreadable' }, null); assert.equal(missing.code, 3); assert.equal(mcpCalls, 1); assert.equal(wsCalls, 0);
    const ambiguous = await cli(['whoami'], null, { CHRONICLE_TOKEN: 'unrelated', CHRONICLE_TOKEN_FILE: '/unreadable' }, null); assert.equal(ambiguous.code, 3); assert.match(ambiguous.stderr, /Ambiguous bearer/);
  } finally { await f.close(); }
});
test('typed RPC automatically selects the same configured read tool and explicit session wins', async () => {
  let mcpCalls = 0; let wsCalls = 0; const user = { id: 'alice', login: 'alice', scopes: ['Read'] };
  const f = await fixture((q, r, body) => { if (q.url === '/api/versions') { reply(r, 200, VERSION, {}); return; } mcpCalls++; const rpc = JSON.parse(body) as { id: string; params: { name: string } }; assert.equal(rpc.params.name, 'whoami'); reply(r, 200, { jsonrpc: '2.0', id: rpc.id, result: { isError: false, content: [{ type: 'text', text: JSON.stringify({ Whoami: { user } }) }] } }, {}); }, ws((socket, id, op) => { wsCalls++; assert.deepEqual(op, { Whoami: {} }); send(socket, id, { Whoami: { user } }); }));
  try {
    state(f); const env = { CHRONICLE_TOKEN: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/.=-' }; const document = '{"Whoami":{}}';
    for (const args of [['rpc', '--file', '-'], ['whoami', '--auth', 'bearer']]) assert.equal((await cli(args, f, env, document)).code, 0);
    assert.equal((await cli(['rpc', '--file', '-', '--auth', 'session'], f, { CHRONICLE_TOKEN: 'unrelated', CHRONICLE_TOKEN_FILE: '/unreadable' }, document)).code, 0);
    assert.equal(mcpCalls, 2); assert.equal(wsCalls, 1);
  } finally { await f.close(); }
});
test('styled actual command data and JSON preserve controls and exact numeric fields', async () => {
  const expected = { ReindexStatus: { result: { requestId: ID, targetProfile: 'owned-source\u001b]52;attack\u0007', total: '9223372036854775807', complete: '0', superseded: '0', failed: '0', pending: '9223372036854775807' } } };
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id) => send(socket, id, expected)));
  try {
    state(f); for (const json of [false, true]) { const result = await cli(['reindex', 'status', ID, '--color', 'always', ...(json ? ['--json'] : [])], f, {}, null); assert.equal(result.code, 0, result.stderr); assert.ok(result.stdout.includes('9223372036854775807')); assert.ok(!result.stdout.includes('\u001b]52')); if (json) { assert.ok(!result.stdout.includes('\u001b')); assert.deepEqual(JSON.parse(result.stdout), expected); } else { assert.match(result.stdout, /\u001b\[/); assert.match(result.stdout, /owned-source\\u001b/); } }
  } finally { await f.close(); }
});
test('invalid colour selectors are safe usage failures and JSON suppresses parser diagnostic colour anywhere', async () => {
  for (const args of [['--color', 'invalid\u001b]52;private\u0007'], ['--color'], ['--color=always', '--color=never'], ['--unknown', '--color=always', '--json'], ['--json', '--color=always', '--unknown']]) { const result = await cli(args, null, {}, null); assert.equal(result.code, 2); assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes('private')); if (args.includes('--json')) assert.ok(!result.stderr.includes('\u001b')); }
});
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
// Regression: shown server failure text masks every secret the request carried, including a login password in its body.
test('a login failure echoing the submitted password shows the server text with the password masked', async () => {
  const password = 'synthetic-"login"-password';
  const f = await fixture((_q, r, body) => reply(r, 401, { error: { code: 'unauthorized', message: `rejected ${(JSON.parse(body) as { password: string }).password} in ${body}` } }, {}), null); try {
    const file = join(f.root, 'password'); writeFileSync(file, `${password}\n`, { mode: 0o600 });
    const result = await cli(['login', '--login', 'alice', '--password-file', file], f, {}, null);
    assert.equal(result.code, 3, result.stderr);
    assert.equal(result.stderr, 'chronicle: unauthorized: Authentication rejected; login again or check the selected bearer credential. Server unauthorized: rejected [credential] in {"login":"alice","password":"[credential]"}\n');
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
// Specified: a remote failure shows the server's code and text after the CLI's own, on one terminal-safe line of at most 512 characters.
test('server failure text is shown sanitized and bounded, and retired pins do not fall back to HEAD', async () => {
  const message = `remote detail\u001b]52;x\u0007\nnext line ${'x'.repeat(4096)}`;
  const f = await fixture((_q, r) => reply(r, 200, VERSION, {}), ws((socket, id) => send(socket, id, { Error: { failure: { code: 'indexed-view-retired', message } } }))); try { state(f); const result = await cli(['messages', ID, '--revision', '4', '--generation', GENERATION, '--json'], f, {}, null); assert.equal(result.code, 4); assert.equal(result.stdout, ''); assert.match(result.stderr, /^chronicle: indexed-view-retired: The exact indexed generation was retired; choose another view explicitly\. Server indexed-view-retired: remote detail\\u001b\]52;x\\u0007\\u000anext line x+…\n$/); assert.equal(result.stderr.length, 'chronicle: indexed-view-retired: The exact indexed generation was retired; choose another view explicitly. Server '.length + 512 + '…\n'.length); assert.equal(f.requests.length, 1); } finally { await f.close(); }
});
// Specified: an answer is bounded by the server's 64 MiB page bound with its worst JSON escaping (U+007F: one byte in the
// page measure, six on the wire, seven inside MCP text), not by the 8 MiB request bound; an answer announced above it fails at once.
// The text puts surrogate pairs across the slices the output is escaped and written in.
const WS_ANSWER_BOUND = 6 * 64 * 1024 * 1024 + 1024 * 1024; const MCP_ANSWER_BOUND = 7 * 64 * 1024 * 1024 + 1024 * 1024;
test('a messages page above 8 MiB is read whole over WS and MCP, and an answer announced above the CLI bound fails at once', async () => {
  const token = 'synthetic-token-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEF'; let oversized = false;
  const page = { Messages: { result: { messages: [{ id: 'large', parentId: null, role: 'user', text: `${'x\u{1f642}'.repeat(2 * 1024 * 1024)}"\u007f`, timestamp: null, recordIndex: 0 }], total: 1, offset: 0, view: { revision: 1, generationId: null } } } };
  const f = await fixture((q, r, body) => {
    if (q.url === '/api/versions') { reply(r, 200, VERSION, {}); return; }
    if (oversized) { r.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(MCP_ANSWER_BOUND + 1) }); r.end(); return; }
    reply(r, 200, { jsonrpc: '2.0', id: (JSON.parse(body) as { id: string }).id, result: { isError: false, content: [{ type: 'text', text: JSON.stringify(page) }] } }, {});
  }, ws((socket, id) => { if (oversized) socket.write(Buffer.concat([frameHeader(WS_ANSWER_BOUND + 1), Buffer.from('{')])); else send(socket, id, page); }));
  try {
    state(f);
    for (const [auth, bound] of [['session', WS_ANSWER_BOUND], ['bearer', MCP_ANSWER_BOUND]] as const) {
      const env = auth === 'bearer' ? { CHRONICLE_TOKEN: token } : {};
      oversized = false; const read = await cli(['messages', ID, '--auth', auth, '--json'], f, env, null);
      assert.equal(read.code, 0, read.stderr); assert.deepEqual(JSON.parse(read.stdout), page);
      oversized = true; const refused = await cli(['messages', ID, '--auth', auth, '--json'], f, env, null);
      assert.equal(refused.code, 6, refused.stderr); assert.equal(refused.stdout, ''); assert.ok(refused.stderr.includes(`${bound} bytes`), refused.stderr);
    }
  } finally { await f.close(); }
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
  const f = await fixture((_q, r) => reply(r, 400, { error: { code: 'invalid', message: 'definitive server detail' } }, {}), null); try { state(f); const result = await cli(['logout', '--yes', '--json'], f, {}, null); assert.equal(result.code, 2, result.stderr); assert.ok(result.stderr.includes('Server invalid: definitive server detail'), result.stderr); assert.equal(f.requests.length, 1); } finally { await f.close(); }
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
  try { state(f); const result = await cli(['groups', 'create', 'rejected-fixture', '--yes', '--request-id', GENERATION], f, {}, null); assert.equal(result.code, expected, result.stderr); assert.ok(!result.stderr.includes('chronicle receipt')); assert.ok(result.stderr.includes(`Server ${code}: private-rejection-canary`), result.stderr); assert.equal(result.stdout, ''); } finally { await f.close(); }
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
  try { state(f); const result = await cli(['logout', '--yes', '--json'], f, {}, null); assert.equal(result.code, expected, result.stderr); assert.equal(result.stdout, ''); assert.equal(result.stderr.includes(`Server ${code}: private-fault-canary`), expected !== 7, result.stderr); } finally { await f.close(); }
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
  try { const result = await cli(['report-progress', '--file', '-', '--yes', '--json'], f, { CHRONICLE_TOKEN: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/.=-' }, JSON.stringify(report)); assert.equal(result.code, expected, result.stderr); assert.equal(result.stderr.includes('Server invalid: private-domain-canary'), expected !== 7, result.stderr); assert.equal(result.stdout, ''); assert.equal(dispatched, 1); } finally { await f.close(); }
});
const ACK_REQUEST = '0193e8d5-6f5c-7a1b-8c2d-000000000077';
const ACK_OTHER = '0193e8d5-6f5c-7a1b-8c2d-000000000078';
const ACK_SECRET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/.=-';
interface AckProbe { code: number; stdout: string; stderr: string; requests: number; effects: number; secretSaved: boolean; sessionRetained: boolean }
async function acknowledgement(request: import('../src/json.js').JsonObject, response: import('../src/json.js').JsonObject, options: { requestId: string; secret: boolean }): Promise<AckProbe> {
  let requests = 0; let effects = 0;
  const mutation = operationPolicy[Object.keys(request)[0] as keyof typeof operationPolicy] !== 'read';
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id, operation) => { assert.deepEqual(operation, request); assert.equal(id, options.requestId); requests++; if (mutation) effects++; send(socket, id, response); }));
  try { state(f); const secret = join(f.root, 'issued-secret'); const result = await cli(['rpc', '--file', '-', ...(mutation ? ['--yes'] : []), '--json', '--request-id', options.requestId, ...(options.secret && mutation ? ['--secret-out', secret] : [])], f, {}, JSON.stringify(request)); return { ...result, requests, effects, secretSaved: existsSync(secret), sessionRetained: readdirSync(join(f.root, 'state')).length === 1 }; } finally { await f.close(); }
}
const MUTATION_RECEIPTS: readonly { name: string; input: import('../src/json.js').JsonObject; entityId: string | null }[] = [
  { name: 'RetryJob', input: { jobId: ID }, entityId: ID },
  { name: 'RevokeToken', input: { tokenId: ID }, entityId: ID },
  { name: 'CreateGroup', input: { name: 'owned-ack-fixture' }, entityId: GENERATION },
  { name: 'Invite', input: { groupId: ID, targetId: 'bob' }, entityId: GENERATION },
  { name: 'AcceptInvite', input: { invitationId: ID, confirmSharing: true }, entityId: GENERATION },
  { name: 'RemoveMember', input: { groupId: ID, userId: 'bob' }, entityId: ID },
  { name: 'LeaveGroup', input: { groupId: ID }, entityId: ID },
  { name: 'DeleteGroup', input: { groupId: ID }, entityId: ID },
  { name: 'Purge', input: { sessionId: ID }, entityId: ID },
  { name: 'Logout', input: {}, entityId: null },
];
for (const example of MUTATION_RECEIPTS) {
  test(`applicable ${example.name} acknowledgement binds its request, operation and entity domain`, async () => {
    const result = await acknowledgement({ [example.name]: example.input }, { Mutation: { receipt: { requestId: ACK_REQUEST, operation: example.name, entityId: example.entityId } } }, { requestId: ACK_REQUEST, secret: false });
    assert.equal(result.code, 0, result.stderr); assert.equal(result.effects, 1); assert.equal(result.requests, 1); assert.equal(result.sessionRetained, example.name !== 'Logout');
  });
  test(`inapplicable ${example.name} entity acknowledgement cannot establish a committed outcome`, async () => {
    const wrongEntity = example.entityId === ID || example.entityId === null ? ACK_OTHER : null;
    const result = await acknowledgement({ [example.name]: example.input }, { Mutation: { receipt: { requestId: ACK_REQUEST, operation: example.name, entityId: wrongEntity } } }, { requestId: ACK_REQUEST, secret: false });
    assert.equal(result.code, 7, result.stderr); assert.equal(result.stdout, ''); assert.match(result.stderr, new RegExp(`chronicle receipt ${ACK_REQUEST}`)); assert.equal(result.effects, 1); assert.equal(result.requests, 1); assert.equal(result.sessionRetained, true);
  });
}
for (const [name, receipt] of [
  ['wrong request ID', { requestId: ACK_OTHER, operation: 'CreateGroup', entityId: ID }],
  ['wrong operation', { requestId: ACK_REQUEST, operation: 'DeleteGroup', entityId: ID }],
] as const) test(`schema-valid Mutation with ${name} is uncertain, not a success receipt`, async () => {
  const result = await acknowledgement({ CreateGroup: { name: 'owned-ack-fixture' } }, { Mutation: { receipt } }, { requestId: ACK_REQUEST, secret: false });
  assert.equal(result.code, 7, result.stderr); assert.equal(result.stdout, ''); assert.match(result.stderr, new RegExp(`chronicle receipt ${ACK_REQUEST}`)); assert.equal(result.effects, 1); assert.equal(result.requests, 1);
});
const RETRY_COUNTS = { eligibleCurrentFailed: '1', supersededRevisionFailed: '0', obsoleteProfileFailed: '0', supersededRevisionAndProfileFailed: '0', unchangedQueued: '0', unchangedRunning: '0', unchangedComplete: '0' };
const APPLIED_RESULTS: readonly { operation: string; branch: string; result: import('../src/json.js').JsonObject }[] = [
  { operation: 'ApplyRetryFailed', branch: 'RetryFailed', result: { requestId: ACK_REQUEST, targetProfile: 'selected-profile', retried: '1', counts: RETRY_COUNTS } },
  { operation: 'ApplyOwnerReindex', branch: 'OwnerReindexed', result: { requestId: ACK_REQUEST, targetProfile: 'selected-profile', heads: '1', queued: '1', alreadyCurrent: '0', invalidatedClaims: '0' } },
];
for (const example of APPLIED_RESULTS) for (const field of ['valid', 'requestId', 'targetProfile']) test(`${example.operation} acknowledgement ${field} matches the admitted intent`, async () => {
  const value = field === 'valid' ? example.result : { ...example.result, [field]: field === 'requestId' ? ACK_OTHER : 'other-profile' };
  const result = await acknowledgement({ [example.operation]: { targetProfile: 'selected-profile', selectionHash: 'a'.repeat(64), confirm: true } }, { [example.branch]: { result: value } }, { requestId: ACK_REQUEST, secret: false });
  assert.equal(result.code, field === 'valid' ? 0 : 7, result.stderr); assert.equal(result.effects, 1); assert.equal(result.requests, 1); if (field !== 'valid') { assert.equal(result.stdout, ''); assert.match(result.stderr, new RegExp(`chronicle receipt ${ACK_REQUEST}`)); }
});
for (const name of ['CreateGroup', 'ApplyRetryFailed', 'ApplyOwnerReindex', 'MintToken']) test(`wrong result family after ${name} dispatch is uncertain`, async () => {
  const input = name === 'CreateGroup' ? { name: 'owned-ack-fixture' } : name === 'MintToken' ? { name: 'owned-token', scopes: ['Read'] } : { targetProfile: 'selected-profile', selectionHash: 'a'.repeat(64), confirm: true };
  const result = await acknowledgement({ [name]: input }, { Whoami: { user: { id: 'alice', login: 'alice', scopes: ['Read'] } } }, { requestId: ACK_REQUEST, secret: name === 'MintToken' });
  assert.equal(result.code, 7, result.stderr); assert.equal(result.stdout, ''); assert.match(result.stderr, new RegExp(`chronicle receipt ${ACK_REQUEST}`)); assert.equal(result.effects, 1); assert.equal(result.requests, 1); assert.equal(result.secretSaved, false);
});
for (const field of ['valid', 'name', 'scopes']) test(`MintToken acknowledgement ${field} binds requested metadata before saving its secret`, async () => {
  const token = { id: ID, name: field === 'name' ? 'unrelated-token' : 'owned-token', scopes: field === 'scopes' ? ['Read', 'Raw'] : ['Read'], createdAt: '2026-11-16T00:00:00Z', revoked: false };
  const result = await acknowledgement({ MintToken: { name: 'owned-token', scopes: ['Read'] } }, { Token: { result: { token, secret: ACK_SECRET } } }, { requestId: ACK_REQUEST, secret: true });
  assert.equal(result.code, field === 'valid' ? 0 : 7, result.stderr); assert.equal(result.secretSaved, field === 'valid'); assert.ok(!result.stdout.includes(ACK_SECRET)); assert.ok(!result.stderr.includes(ACK_SECRET)); if (field !== 'valid') assert.equal(result.stdout, '');
});
const STORED_RECEIPTS: readonly { branch: string; payload: import('../src/json.js').JsonObject }[] = [
  { branch: 'Mutation', payload: { receipt: { requestId: ACK_REQUEST, operation: 'DeleteGroup', entityId: ID } } },
  { branch: 'RetryFailed', payload: { result: APPLIED_RESULTS[0]!.result } },
  { branch: 'OwnerReindexed', payload: { result: APPLIED_RESULTS[1]!.result } },
  { branch: 'Token', payload: { result: { token: { id: ID, name: 'previous-token', scopes: ['Read'], createdAt: '2026-11-16T00:00:00Z', revoked: false }, secret: null } } },
];
for (const stored of STORED_RECEIPTS) test(`Receipt lookup accepts original ${stored.branch} identity distinct from its lookup envelope`, async () => {
  const result = await acknowledgement({ Receipt: { mutationId: ACK_REQUEST } }, { [stored.branch]: stored.payload }, { requestId: ACK_OTHER, secret: false });
  assert.equal(result.code, 0, result.stderr); assert.equal(result.effects, 0); assert.equal(result.requests, 1); assert.equal(result.secretSaved, false);
});
for (const stored of STORED_RECEIPTS.filter(s => s.branch !== 'Token')) test(`Receipt lookup rejects unrelated historical ${stored.branch} identity`, async () => {
  const original = stored.payload[stored.branch === 'Mutation' ? 'receipt' : 'result']; assert.ok(isObject(original));
  const result = await acknowledgement({ Receipt: { mutationId: ACK_REQUEST } }, { [stored.branch]: { [stored.branch === 'Mutation' ? 'receipt' : 'result']: { ...original, requestId: ID } } }, { requestId: ACK_OTHER, secret: false });
  assert.equal(result.code, 6, result.stderr); assert.equal(result.stdout, ''); assert.equal(result.effects, 0); assert.equal(result.requests, 1);
});
test('Receipt lookup cannot recover or save a one-time token secret', async () => {
  const stored = STORED_RECEIPTS[3]!.payload['result']; assert.ok(isObject(stored));
  const result = await acknowledgement({ Receipt: { mutationId: ACK_REQUEST } }, { Token: { result: { ...stored, secret: ACK_SECRET } } }, { requestId: ACK_OTHER, secret: true });
  assert.equal(result.code, 6, result.stderr); assert.equal(result.stdout, ''); assert.equal(result.secretSaved, false); assert.ok(!result.stderr.includes(ACK_SECRET));
});
for (const valid of [true, false]) test(`reindex status ${valid ? 'retains' : 'rejects a different'} captured request identity rather than its lookup envelope`, async () => {
  const result = await acknowledgement({ GetReindexStatus: { requestId: ACK_REQUEST } }, { ReindexStatus: { result: { requestId: valid ? ACK_REQUEST : ID, targetProfile: 'selected-profile', total: '1', complete: '0', superseded: '0', failed: '0', pending: '1' } } }, { requestId: ACK_OTHER, secret: false });
  assert.equal(result.code, valid ? 0 : 6, result.stderr); if (!valid) assert.equal(result.stdout, '');
});
test('MintToken acknowledgement preserves permission-set semantics without requiring incidental list order', async () => {
  const result = await acknowledgement({ MintToken: { name: 'owned-token', scopes: ['Read', 'Raw'] } }, { Token: { result: { token: { id: ID, name: 'owned-token', scopes: ['Raw', 'Read'], createdAt: '2026-11-16T00:00:00Z', revoked: false }, secret: ACK_SECRET } } }, { requestId: ACK_REQUEST, secret: true });
  assert.equal(result.code, 0, result.stderr); assert.equal(result.secretSaved, true); assert.ok(!result.stdout.includes(ACK_SECRET));
});
const UUID_SESSION = 'abcdef12-abcd-4abc-8def-123456789abc';
const UUID_GENERATION = 'ba987654-fedc-4abc-8def-123456789abc';
const UUID_DIFFERENT = 'cdef1234-fedc-4abc-8def-123456789abc';
function uuidSession(generationId: string | null): import('../src/json.js').JsonObject {
  return { id: UUID_SESSION, view: { revision: 4, generationId }, ownerId: 'alice', revision: 4, indexedRevision: 4, metadata: { title: 'UUID fixture', project: null, workdir: null, gitRemote: null, gitBranch: null, gitCommit: null, producer: 'pi', model: null, startedAt: null, endedAt: null, tags: [] }, source: { collectorNamespace: 'NamespaceCase', discoveryRootId: 'RootCase', format: 'Pi', producerSessionId: 'ProducerCase', subagentId: null }, completion: 'Quiescent', redacted: false };
}
test('UUID uppercase CLI request ID accepts the canonical server envelope and receipt without rewriting the request', async () => {
  let effects = 0;
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id, operation) => { assert.equal(id, ACK_REQUEST.toUpperCase()); assert.deepEqual(operation, { CreateGroup: { name: 'UUID-case' } }); effects++; send(socket, id.toLowerCase(), { Mutation: { receipt: { requestId: id.toLowerCase(), operation: 'CreateGroup', entityId: UUID_SESSION } } }); }));
  try { state(f); const result = await cli(['groups', 'create', 'UUID-case', '--yes', '--request-id', ACK_REQUEST.toUpperCase(), '--json'], f, {}, null); assert.equal(result.code, 0, result.stderr); assert.equal(effects, 1); assert.equal((JSON.parse(result.stdout) as { Mutation: { receipt: { requestId: string } } }).Mutation.receipt.requestId, ACK_REQUEST); } finally { await f.close(); }
});
test('UUID bearer read retains uppercase arguments and accepts canonical generation metadata', async () => {
  const f = await fixture((q, r, body) => { if (q.url === '/api/versions') { reply(r, 200, VERSION, {}); return; } const request = JSON.parse(body) as { id: string; params: { arguments: unknown } }; assert.deepEqual(request.params.arguments, { sessionId: UUID_SESSION.toUpperCase(), revision: 4, generationId: UUID_GENERATION.toUpperCase(), offset: 0, limit: 20 }); reply(r, 200, { jsonrpc: '2.0', id: request.id, result: { isError: false, content: [{ type: 'text', text: JSON.stringify({ Messages: { result: { messages: [], total: 0, offset: 0, view: { revision: 4, generationId: UUID_GENERATION } } } }) }] } }, {}); }, null);
  try { const result = await cli(['messages', UUID_SESSION.toUpperCase(), '--revision', '4', '--generation', UUID_GENERATION.toUpperCase(), '--auth', 'bearer', '--json'], f, { CHRONICLE_TOKEN: ACK_SECRET }, null); assert.equal(result.code, 0, result.stderr); } finally { await f.close(); }
});
for (const mismatch of ['none', 'instanceId', 'runId']) test(`UUID MCP run representation ${mismatch} retains semantic identity and original poll payload`, async () => {
  let requests = 0;
  const snapshot = (state: string) => ({ McpTestRun: { result: { instanceId: mismatch === 'instanceId' ? UUID_DIFFERENT : UUID_SESSION, runId: mismatch === 'runId' ? UUID_DIFFERENT : UUID_GENERATION, state, observedAt: '2026-11-16T00:00:00Z', events: state === 'Complete' ? [{ sequence: '1', observedAt: '2026-11-16T00:00:00Z', item: { Response: { partIndex: 0, partCount: 1, textPart: 'owned complete' } } }] : [], lastSequence: state === 'Complete' ? '1' : '0', hasMore: false, failure: null } } });
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id, operation) => { requests++; if ('StartMcpTest' in operation) { assert.deepEqual(operation['StartMcpTest'], { instanceId: UUID_SESSION.toUpperCase(), runId: UUID_GENERATION.toUpperCase(), prompt: 'owned UUID fixture' }); send(socket, id, snapshot(mismatch === 'none' ? 'Running' : 'Complete')); } else { assert.deepEqual(operation, { ReadMcpTest: { instanceId: UUID_SESSION.toUpperCase(), runId: UUID_GENERATION.toUpperCase(), afterSequence: '0', limit: 100 } }); send(socket, id, snapshot('Complete')); } }));
  try { state(f); const result = await cli(['rpc', '--file', '-', '--yes', '--json'], f, {}, JSON.stringify({ StartMcpTest: { instanceId: UUID_SESSION.toUpperCase(), runId: UUID_GENERATION.toUpperCase(), prompt: 'owned UUID fixture' } })); assert.equal(result.code, mismatch === 'none' ? 0 : 7, result.stderr); assert.equal(requests, mismatch === 'none' ? 2 : 1); if (mismatch !== 'none') { assert.equal(result.stdout, ''); assert.match(result.stderr, /^chronicle: uncertain: MCP test result incomplete;.* instanceId=ABCDEF12-ABCD-4ABC-8DEF-123456789ABC runId=BA987654-FEDC-4ABC-8DEF-123456789ABC; inspect ReadMcpTest explicitly, never restart blindly\.\n$/); } } finally { await f.close(); }
});
for (const same of [true, false]) test(`UUID HTTP ingest receipt ${same ? 'canonicalizes representation' : 'rejects a different identity'} without rewriting source identity`, async () => {
  const raw = '{"type":"session","id":"case","version":3}\n{"type":"message","id":"m1","message":{"role":"user","content":[{"type":"text","text":"Case-sensitive source"}]}}\n';
  const sha = createHash('sha256').update(raw).digest('hex');
  const request = { requestId: ACK_REQUEST.toUpperCase(), source: { collectorNamespace: 'NamespaceCase', discoveryRootId: 'RootCase', format: 'Pi', producerSessionId: 'ProducerCase', subagentId: null }, expectedRevision: 0, digest: sha, completion: 'Quiescent', redacted: false, metadata: uuidSession(null)['metadata'], messages: [{ id: 'm1', parentId: null, role: 'user', text: 'Case-sensitive source', timestamp: null, recordIndex: 1 }], files: [{ path: 'Case.jsonl', sha256: sha, content: raw }] };
  let posts = 0;
  const f = await fixture((q, r, body) => { if (q.url === '/api/versions') reply(r, 200, VERSION, {}); else { posts++; assert.deepEqual(JSON.parse(body), request); assert.equal(q.headers.authorization, `Bearer ${ACK_SECRET}`); reply(r, 200, { requestId: same ? ACK_REQUEST : ACK_OTHER, sessionId: UUID_SESSION, revision: 1, jobId: UUID_GENERATION }, {}); } }, null);
  try { const result = await cli(['ingest', '--file', '-', '--yes', '--json'], f, { CHRONICLE_TOKEN: ACK_SECRET }, JSON.stringify(request)); assert.equal(result.code, same ? 0 : 7, result.stderr); assert.equal(posts, 1); if (!same) { assert.equal(result.stdout, ''); assert.match(result.stderr, /^chronicle: uncertain: Ingestion acknowledgement lost\. Preserve requestId=0193E8D5-6F5C-7A1B-8C2D-000000000077 and its exact payload\/CAS revision; inspect progress before deliberately resending that identical request\. No automatic retry occurred\.\n$/); } } finally { await f.close(); }
});
test('UUID-looking account user IDs remain opaque case-sensitive strings', async () => {
  let dispatched = 0;
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), (socket, value) => { const envelope = decodeWire('ClientEnvelope', value); const operation = encodeWire('Operation', envelope.operation); assert.ok(isObject(operation)); if ('Hello' in operation) send(socket, envelope.requestId, { Hello: { versions: VERSION, user: { id: UUID_SESSION.toUpperCase(), login: 'alice', scopes: ['Read'] } } }); else dispatched++; });
  try { state(f); const directory = join(f.root, 'state'); const file = join(directory, readdirSync(directory)[0]!); const saved = JSON.parse(readFileSync(file, 'utf8')) as { user: { id: string } }; saved.user.id = UUID_SESSION; writeFileSync(file, JSON.stringify(saved)); const result = await cli(['whoami', '--json'], f, {}, null); assert.equal(result.code, 3, result.stderr); assert.equal(dispatched, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, 'chronicle: unauthorized: Session owner changed; login again.\n'); } finally { await f.close(); }
});
test('CLI input-budget boundary rejects held stdin without acquiring a WebSocket', { timeout: 10000 }, async () => {
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), () => assert.fail('No WebSocket may be acquired while RPC input is incomplete.'));
  try {
    state(f); const installed = process.env['CHRONICLE_CLI_EXECUTABLE']; const args = ['rpc', '--file', '-', '--timeout-ms', '100', '--url', f.origin, '--allow-insecure-http', '--json'];
    const child = installed === undefined ? spawn(process.execPath, [CLI, ...args], { env: { PATH: process.env['PATH']!, HOME: f.root, CHRONICLE_STATE_DIR: join(f.root, 'state') }, stdio: ['pipe', 'pipe', 'pipe'] }) : spawn(installed, args, { env: { PATH: process.env['PATH']!, HOME: f.root, CHRONICLE_STATE_DIR: join(f.root, 'state') }, stdio: ['pipe', 'pipe', 'pipe'] });
    const PROCESS_GUARD_MS = 9000; const guard = setTimeout(() => child.kill(), PROCESS_GUARD_MS);
    let stdout = ''; let stderr = ''; child.stdout.on('data', data => stdout += String(data)); child.stderr.on('data', data => stderr += String(data));
    try { const code = await new Promise<number | null>((done, reject) => { child.on('error', reject); child.on('close', done); }); assert.equal(code, 6, stderr); assert.equal(stdout, ''); assert.match(stderr, /^chronicle: deadline: Stdin deadline exceeded\.\n$/); assert.equal(f.requests.length, 0); }
    finally { clearTimeout(guard); child.stdin.destroy(); if (child.exitCode === null && child.signalCode === null) child.kill(); }
  } finally { await f.close(); }
});
// Specified (ingest-c spec §1.5): `raw ID` without --revision asks GetRaw for the archive head; the server's too-large
// answer names the ranged download.
test('raw without --revision reads the archive head, and a too-large answer points to --output FILE', async () => {
  const seen: unknown[] = []; let tooLarge = false; const content = '{"type":"session"}\n';
  const head = { Raw: { result: { files: [{ path: 'p/a.jsonl', sha256: createHash('sha256').update(content).digest('hex'), content }], revision: 7 } } };
  const f = await fixture((_q, r) => reply(r, 404, {}, {}), ws((socket, id, op) => { seen.push(op['GetRaw']); send(socket, id, tooLarge ? { Error: { failure: { code: 'too-large', message: 'raw files exceed the raw read bound' } } } : head); }));
  try {
    state(f); const read = await cli(['raw', ID, '--json'], f, {}, null); assert.equal(read.code, 0, read.stderr); assert.deepEqual(JSON.parse(read.stdout), head);
    tooLarge = true; const refused = await cli(['raw', ID], f, {}, null); assert.equal(refused.code, 6); assert.equal(refused.stdout, ''); assert.match(refused.stderr, /^chronicle: too-large: .*Server too-large: raw files exceed the raw read bound.*use --output FILE/);
    assert.deepEqual(seen, [{ sessionId: ID, revision: null }, { sessionId: ID, revision: null }]);
  } finally { await f.close(); }
});
// A raw download server as R1 built it (/api/raw manifest and single ranges with ETag and If-Range); `fault` breaks the bytes.
const RAW_RANGE_BYTES = 64 * 1024 * 1024;
interface RawFile { readonly path: string; readonly content: Buffer; announced?: string }
type RawFault = 'none' | 'short' | 'busy';
function sha256(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function rawServer(revision: number, files: readonly RawFile[], fault: () => RawFault): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    const [, , , , pinned, index] = request.url!.split('/'); const digest = (file: RawFile): string => file.announced ?? sha256(file.content);
    if (index === undefined) { reply(response, 200, { sessionId: ID, revision, files: files.map((file, i) => ({ index: i, path: file.path, sha256: digest(file), bytes: String(file.content.length) })) }, {}); return; }
    if (Number(pinned) !== revision || fault() === 'busy') { reply(response, 503, { code: 'unavailable', message: 'all raw downloads are in progress' }, { 'Retry-After': '5' }); return; }
    const file = files[Number(index)]!; const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(String(request.headers.range))!.map(Number) as [number, number, number];
    const body = file.content.subarray(first, last + 1);
    response.writeHead(206, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length), 'Content-Range': `bytes ${first}-${first + body.length - 1}/${file.content.length}`, 'ETag': `"sha256:${digest(file)}"` });
    if (fault() === 'short') response.write(body.subarray(0, body.length >> 1), () => response.destroy()); else response.end(body);
  };
}
// Specified (spec §1.5): the manifest pins the revision (head, or --revision); the file arrives in 64 MiB range requests, each
// with the manifest's ETag as If-Range, into a new 0600 file (never replacing one) or on stdout; several files need --file.
test('raw --output downloads a file in 64 MiB ranges to a new file or stdout and never replaces a file', async () => {
  const large = randomBytes(RAW_RANGE_BYTES + 5); const small = Buffer.from('{"type":"session"}\n{"text":"\u{1f642}"}\n');
  const f = await fixture(rawServer(3, [{ path: 'p/large.jsonl', content: large }, { path: 'p/small.jsonl', content: small }], () => 'none'), null);
  try {
    state(f); const out = join(f.root, 'out'); mkdirSync(out); const target = join(out, 'large.jsonl'); const etag = `"sha256:${sha256(large)}"`; const cookie = `chronicle_session=${COOKIE}`;
    const ambiguous = await cli(['raw', ID, '--output', target], f, {}, null);
    assert.equal(ambiguous.code, 2); assert.match(ambiguous.stderr, /--file.*0 "p\/large\.jsonl".*1 "p\/small\.jsonl"/s); assert.equal(f.requests.length, 1);
    f.requests.length = 0; const saved = await cli(['raw', ID, '--file', '0', '--output', target, '--json'], f, {}, null);
    assert.equal(saved.code, 0, saved.stderr); assert.deepEqual(JSON.parse(saved.stdout), { sessionId: ID, revision: 3, file: 0, path: target, bytes: String(large.length), sha256: sha256(large) });
    assert.equal(sha256(readFileSync(target)), sha256(large)); assert.equal(lstatSync(target).mode & 0o777, 0o600); assert.deepEqual(readdirSync(out), ['large.jsonl']);
    assert.deepEqual(f.requests.map(q => [q.path, q.headers.range, q.headers['if-range'], q.headers.cookie, q.headers.authorization]), [
      [`/api/raw/${ID}`, undefined, undefined, cookie, undefined],
      [`/api/raw/${ID}/3/0`, `bytes=0-${RAW_RANGE_BYTES - 1}`, etag, cookie, undefined],
      [`/api/raw/${ID}/3/0`, `bytes=${RAW_RANGE_BYTES}-${RAW_RANGE_BYTES + 4}`, etag, cookie, undefined]]);
    f.requests.length = 0; const again = await cli(['raw', ID, '--file', '1', '--output', target], f, {}, null);
    assert.equal(again.code, 6); assert.match(again.stderr, /^chronicle: state: .*exists/); assert.equal(f.requests.length, 0); assert.equal(sha256(readFileSync(target)), sha256(large));
    const piped = await cli(['raw', ID, '--revision', '3', '--file', '1', '--output', '-'], f, {}, null);
    assert.equal(piped.code, 0, piped.stderr); assert.equal(piped.stdout, small.toString('utf8')); assert.equal(piped.stderr, '');
    assert.deepEqual(f.requests.map(q => [q.path, q.headers.range]), [[`/api/raw/${ID}/3`, undefined], [`/api/raw/${ID}/3/1`, `bytes=0-${small.length - 1}`]]);
  } finally { await f.close(); }
});
// Specified (spec §1.5): any failure removes the partial file and names the bytes received; on stdout the digest is checked
// after the last byte, and a mismatch exits 6 after the bytes were written.
test('a failing raw download removes its partial file and names the bytes received; on stdout a digest mismatch exits 6', async () => {
  const file: RawFile = { path: 'p/a.jsonl', content: Buffer.from('{"line":1}\n{"line":2}\n') }; let fault: RawFault = 'none';
  const f = await fixture(rawServer(2, [file], () => fault), null);
  try {
    state(f); const out = join(f.root, 'out'); mkdirSync(out); const target = join(out, 'a.jsonl');
    file.announced = sha256('other bytes');
    const mismatch = await cli(['raw', ID, '--output', target], f, {}, null);
    assert.equal(mismatch.code, 6); assert.match(mismatch.stderr, /^chronicle: protocol-error: .*SHA-256.* 22 of 22 bytes were received; the partial file was removed\./); assert.deepEqual(readdirSync(out), []);
    const piped = await cli(['raw', ID, '--output', '-'], f, {}, null);
    assert.equal(piped.code, 6); assert.equal(piped.stdout, file.content.toString('utf8')); assert.match(piped.stderr, /^chronicle: protocol-error: .*SHA-256.*discard/);
    delete file.announced;
    for (const [selected, expected] of [['short', /^chronicle: unavailable: .* 11 of 22 bytes were received; the partial file was removed\./], ['busy', /^chronicle: unavailable: .*Server unavailable: all raw downloads are in progress.*Retry-After: 5 s.* 0 of 22 bytes were received; the partial file was removed\./]] as const) {
      fault = selected; const result = await cli(['raw', ID, '--output', target], f, {}, null);
      assert.equal(result.code, 6); assert.equal(result.stdout, ''); assert.match(result.stderr, expected); assert.deepEqual(readdirSync(out), []);
    }
  } finally { await f.close(); }
});
// Specified (spec §1.5, §8): a server without the raw download API answers 404 without a Failure body; the CLI names it and
// writes nothing (no fallback to GetRaw).
test('raw --output against a server without the raw download API names the missing API and writes nothing', async () => {
  const f = await fixture((_q, r) => { r.writeHead(404, { 'Content-Type': 'text/plain' }); r.end('Not found'); }, null);
  try {
    state(f); const out = join(f.root, 'out'); mkdirSync(out);
    for (const target of [join(out, 'a.jsonl'), '-']) {
      const result = await cli(['raw', ID, '--output', target], f, {}, null);
      assert.equal(result.code, 6); assert.equal(result.stdout, ''); assert.ok(result.stderr.includes(`The server at ${f.origin} has no raw download API (it predates it): upgrade the server;`), result.stderr);
    }
    assert.deepEqual(readdirSync(out), []); assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});
});
