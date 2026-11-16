import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
const executable = process.env['CHRONICLE_CLI_EXECUTABLE'];
const moduleUrl = executable === undefined ? new URL('../src/transport.js', import.meta.url) : pathToFileURL(resolve(dirname(executable), '../lib/chronicle-cli/dist/cli/src/transport.js'));
const transport: typeof import('../src/transport.js') = await import(moduleUrl.href);
const wire: typeof import('../src/wire.js') = await import(new URL('./wire.js', moduleUrl).href);
const errors: typeof import('../src/errors.js') = await import(new URL('./errors.js', moduleUrl).href);
const HEALTHY_BUDGET_MS = 1000; const OBSERVATION_MS = 150; const TEST_TIMEOUT_MS = 5000;
const REQUEST_ID = '0193e8d5-6f5c-7a1b-8c2d-000000000077';
const COOKIE = 'owned-transport-cookie-012345678901234567890123';
const USER = { id: 'alice', login: 'alice', displayName: 'Alice', actor: 'owned-binding' };
interface Adapter { origin: string; stats: { upgrades: number; requests: number }; live(): number; close(): Promise<void> }
async function adapter(): Promise<Adapter> {
  const sockets = new Set<Duplex>(); const stats = { upgrades: 0, requests: 0 }; const server = createServer(); let origin = '';
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket) => {
    stats.upgrades++; assert.equal(request.headers.origin, origin); assert.equal(request.headers.cookie, `chronicle_session=${COOKIE}`);
    const key = request.headers['sec-websocket-key']; assert.equal(typeof key, 'string');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash('sha1').update(String(key) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')}\r\n\r\n`);
    let buffer: Buffer = Buffer.alloc(0);
    socket.on('data', bytes => { buffer = Buffer.concat([buffer, bytes]); for (;;) {
      if (buffer.length < 2) return; const opcode = buffer[0]! & 15; let length = buffer[1]! & 127; let position = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); position = 4; }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); position = 10; }
      const maskLength = (buffer[1]! & 128) !== 0 ? 4 : 0; if (buffer.length < position + maskLength + length) return;
      const data = Buffer.from(buffer.subarray(position + maskLength, position + maskLength + length)); if (maskLength !== 0) for (let i = 0; i < data.length; i++) data[i] = data[i]! ^ buffer[position + i % 4]!;
      buffer = buffer.subarray(position + maskLength + length);
      if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      if (opcode !== 1) continue;
      const envelope = wire.decodeWire('ClientEnvelope', JSON.parse(data.toString('utf8')) as unknown); const operation = wire.encodeWire('Operation', envelope.operation); assert.ok(typeof operation === 'object' && operation !== null && !Array.isArray(operation)); stats.requests++;
      const user = { id: USER.id, login: USER.login, scopes: ['Read'] };
      const result = 'Hello' in operation ? { Hello: { versions: { current: '1.9.0', minimum: '1.9.0', supported: ['1.9.0'] }, user } } : { Whoami: { user } };
      const response = Buffer.from(JSON.stringify({ requestId: envelope.requestId, result })); const header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(response.length, 2); socket.write(Buffer.concat([header, response]));
    } });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); assert.ok(address !== null && typeof address !== 'string'); origin = `http://127.0.0.1:${address.port}`;
  return { origin, stats, live: () => sockets.size, async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>((done, reject) => server.close(error => error === undefined ? done() : reject(error))); } };
}
function hasCode(code: string): (error: unknown) => boolean { return error => error instanceof Error && 'code' in error && error.code === code; }
async function observed(f: Adapter, label: string): Promise<void> { await pause(OBSERVATION_MS); console.info(JSON.stringify({ label, ...f.stats, liveOwnedSockets: f.live() })); }
test('transport expired absolute budget rejects before acquiring an owned WebSocket', { timeout: TEST_TIMEOUT_MS }, async () => {
  const f = await adapter(); const deadline = new transport.Deadline(0);
  try { assert.throws(() => deadline.remaining(), hasCode('deadline')); await assert.rejects(transport.websocket(f.origin, { origin: f.origin, cookie: COOKIE, actor: USER.actor, user: USER }, wire.decodeOperation({ Whoami: {} }), REQUEST_ID, false, deadline), hasCode('deadline')); await observed(f, 'expired-before-acquisition'); assert.equal(f.stats.upgrades, 0); assert.equal(f.live(), 0); } finally { await f.close(); }
});
for (const setup of ['deadline', 'exception']) test(`transport ${setup} during post-acquisition setup releases the owned WebSocket`, { timeout: TEST_TIMEOUT_MS }, async () => {
  class SetupDeadline extends transport.Deadline {
    calls = 0;
    override remaining(): number { this.calls++; if (this.calls === 2) throw setup === 'deadline' ? new errors.CliError('deadline', 'Command deadline exceeded.') : new Error('owned-setup-canary'); return super.remaining(); }
  }
  const f = await adapter(); const deadline = new SetupDeadline(HEALTHY_BUDGET_MS);
  try { await assert.rejects(transport.websocket(f.origin, { origin: f.origin, cookie: COOKIE, actor: USER.actor, user: USER }, wire.decodeOperation({ Whoami: {} }), REQUEST_ID, false, deadline), hasCode(setup === 'deadline' ? 'deadline' : 'unavailable')); assert.equal(deadline.calls, 2); await observed(f, `post-acquisition-${setup}`); assert.equal(f.stats.upgrades, 0); assert.equal(f.live(), 0); } finally { await f.close(); }
});
test('transport healthy absolute budget retains negotiation and ordinary owned-socket close', { timeout: TEST_TIMEOUT_MS }, async () => {
  const f = await adapter();
  try { const result = await transport.websocket(f.origin, { origin: f.origin, cookie: COOKIE, actor: USER.actor, user: USER }, wire.decodeOperation({ Whoami: {} }), REQUEST_ID, false, new transport.Deadline(HEALTHY_BUDGET_MS)); assert.deepEqual(wire.encodeWire('Result', result), { Whoami: { user: { id: USER.id, login: USER.login, scopes: ['Read'] } } }); await observed(f, 'healthy'); assert.equal(f.stats.upgrades, 1); assert.equal(f.stats.requests, 2); assert.equal(f.live(), 0); } finally { await f.close(); }
});
