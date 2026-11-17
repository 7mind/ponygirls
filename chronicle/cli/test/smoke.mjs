// Installed-wrapper smoke: needs CHRONICLE_CLI_EXECUTABLE; the behavioural suites run once, in the package build.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const executable = process.env.CHRONICLE_CLI_EXECUTABLE;
assert.ok(executable, 'CHRONICLE_CLI_EXECUTABLE must name the installed wrapper');
const EXIT_USAGE = 2; const EXIT_UNCERTAIN = 7;
const TOKEN = 'synthetic-token-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEF';
const VERSION = { current: '1.9.0', minimum: '1.9.0', supported: ['1.9.0'] };
const USER = { id: 'alice', login: 'alice', displayName: 'Alice', actor: 'owner-binding' };
let root; let origin; let server; let bearerRequests; let mode = 'bearer';

const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
before(async () => {
  root = mkdtempSync(join(tmpdir(), 'chronicle-cli-smoke-')); bearerRequests = [];
  server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += String(chunk);
    if (mode === 'unavailable') return json(response, 503, { error: { code: 'unavailable', message: 'private-fault-canary' } });
    if (request.url === '/api/versions') return json(response, 200, VERSION);
    bearerRequests.push(request.headers.authorization);
    json(response, 200, { jsonrpc: '2.0', id: JSON.parse(body).id, result: { isError: false, content: [{ type: 'text', text: JSON.stringify({ Whoami: { user: { id: 'alice', login: 'alice', scopes: ['Read'] } } }) }] } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const state = join(root, 'state'); mkdirSync(state, { mode: 0o700 });
  writeFileSync(join(state, `${createHash('sha256').update(origin).digest('hex')}.json`), JSON.stringify({ origin, cookie: 'synthetic-cookie-0123456789012345', actor: USER.actor, user: USER }), { mode: 0o600 });
  writeFileSync(join(root, 'token'), TOKEN + '\n', { mode: 0o600 });
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true }); });

function run(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env: { PATH: process.env.PATH, HOME: root, CHRONICLE_STATE_DIR: join(root, 'state'), ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
const withOrigin = args => ['--url', origin, '--allow-insecure-http', ...args];

test('help is served locally', async () => {
  const result = await run(['messages', '--help'], {}); assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /Usage: chronicle messages UUID/);
});
test('bearer read authenticates with the configured token file', async () => {
  const result = await run(withOrigin(['whoami', '--json']), { CHRONICLE_TOKEN_FILE: join(root, 'token') });
  assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).Whoami.user.id, 'alice'); assert.deepEqual(bearerRequests, [`Bearer ${TOKEN}`]);
});
test('unavailable mutation acknowledgement exits uncertain', async () => {
  mode = 'unavailable'; const result = await run(withOrigin(['logout', '--yes', '--json']), {});
  assert.equal(result.code, EXIT_UNCERTAIN, result.stderr); assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes('private-fault-canary'));
});
test('unknown command is a usage error', async () => {
  const result = await run(['sarch', 'needle'], {}); assert.equal(result.code, EXIT_USAGE); assert.match(result.stderr, /Unknown command/);
});
test('explicit colour styles help output', async () => {
  const result = await run(['--color', 'always', 'messages', '--help'], { NO_COLOR: '1' }); assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /\u001b\[/);
});
