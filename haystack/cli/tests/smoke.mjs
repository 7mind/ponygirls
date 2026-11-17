// Installed-wrapper smoke: needs HAYSTACK_CLI_EXECUTABLE; the behavioural suites run once, in the package build.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const executable = process.env.HAYSTACK_CLI_EXECUTABLE;
assert.ok(executable, 'HAYSTACK_CLI_EXECUTABLE must name the installed wrapper');
const EXIT_USAGE = 2; const EXIT_UNCERTAIN = 7;
const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const REQUEST_ID = '0193e8d5-6f5c-7a1b-8c2d-000000000002';
const DOCUMENT = '{"title":"t","description":"d","fields":{},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[]}';
let root; let origin; let server; const whoamiAuthorization = [];

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'haystack-cli-smoke-'));
  server = createServer((request, response) => {
    request.resume();
    if (request.url === '/api/v1/put') { request.socket.destroy(); return; }
    if (request.url === '/api/v1/whoami') whoamiAuthorization.push(request.headers.authorization);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(request.url === '/api/versions' ? { current: '1.0.0', minimum: '1.0.0', supported: ['1.0.0'] } : { userId: 'bot', userType: 'agent', tokenId: 'worker', activityProjectId: 'corporate-activity' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true }); });

function run(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env: { PATH: process.env.PATH, HOME: root, HAYSTACK_STATE_DIR: join(root, 'state'), HAYSTACK_URL: origin, HAYSTACK_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr })); child.stdin.end(input);
  });
}

test('help is served locally', async () => {
  const result = await run(['--help'], ''); assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /Examples:/);
});
test('bearer read authenticates with the configured token', async () => {
  const result = await run(['whoami', '--allow-http', '--json'], ''); assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).result.userId, 'bot'); assert.deepEqual(whoamiAuthorization, [`Bearer ${TOKEN}`]);
});
test('lost write acknowledgement exits uncertain', async () => {
  const result = await run(['put', 'p:lost', '--file', '-', '--expected-revision', '0', '--request-id', REQUEST_ID, '--json', '--allow-http'], DOCUMENT);
  assert.equal(result.code, EXIT_UNCERTAIN, result.stderr); assert.equal(result.stdout, ''); assert.equal(JSON.parse(result.stderr).error.code, 'uncertain-write');
});
test('unknown option is a usage error', async () => {
  const result = await run(['--json', '--unknown'], ''); assert.equal(result.code, EXIT_USAGE); assert.equal(JSON.parse(result.stderr).error.code, 'usage');
});
test('human output labels domain fields', async () => {
  const result = await run(['whoami', '--allow-http'], ''); assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /^User: bot\nType: agent\n/); assert.ok(!result.stdout.includes('"userId"'));
});
