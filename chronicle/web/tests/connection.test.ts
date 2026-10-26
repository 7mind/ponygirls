import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionManager } from '../src/transport/manager.ts';
import { RequestFailure } from '../src/transport/types.ts';
import { Clock, Page, FakeSocket, protocol, config } from './fakes.ts';
function fixture() {
  const clock = new Clock(), page = new Page(), sockets: FakeSocket[] = [];
  let nonce = 0;
  const manager = new ConnectionManager({ scheduler: clock, lifecycle: page,
    socket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    nonce: () => `n${++nonce}`, random: () => 0.5, protocol: () => protocol, config });
  manager.start();
  return { manager, clock, page, sockets, first: sockets[0]! };
}
test('BA: only negotiated version plus a nonce AND timestamp matched pong establishes ALIVE', () => {
  const { manager, first } = fixture(); first.open();
  assert.equal(manager.stats().activeId, null);
  first.receive('negotiated'); first.receive('pong unrelated 0');
  assert.equal(manager.stats().activeId, null);
  first.receive(first.ping().replace('ping ', 'pong ').replace(/ 0$/, ' 9'));
  assert.equal(manager.stats().activeId, null);
  first.receive(first.ping().replace('ping ', 'pong '));
  assert.equal(manager.stats().sockets[0]?.state, 'ALIVE'); manager.dispose();
});
test('BA: silent blackhole starts overlapping replacement, old socket can recover, pool stays bounded', () => {
  const { manager, first, clock, sockets } = fixture(); first.alive();
  clock.advance(90);
  assert.equal(manager.stats().sockets[0]?.state, 'STALE'); assert.equal(sockets.length, 2);
  first.receive(first.ping().replace('ping ', 'pong '));
  assert.equal(manager.stats().activeId, 1);
  assert.ok(manager.stats().sockets.filter(s => s.state !== 'DEAD').length <= config.maxPool);
  clock.advance(1000); assert.ok(manager.stats().sockets.length <= config.maxPool); manager.dispose();
});
test('BA: connecting blackhole exhausts bounded full-jitter retry budget and manual retry resets it', () => {
  const { manager, clock, sockets } = fixture(); clock.advance(2000);
  assert.equal(manager.stats().terminal, 'stopped'); const count = sockets.length;
  clock.advance(2000); assert.equal(sockets.length, count);
  manager.retry(); assert.equal(sockets.length, count + 1); sockets.at(-1)!.alive();
  assert.equal(manager.stats().attempts, 0); manager.dispose();
});
test('BA: connect timeout checks native readyState before closing a just-open socket', () => {
  const { manager, first, clock } = fixture(); first.readyState = 1;
  clock.advance(100); assert.notEqual(first.readyState, 3);
  clock.advance(100); assert.equal(first.readyState, 3); manager.dispose();
});
for (const code of [1002, 1003, 1007, 1009, 1010, 1015]) test(`BA: permanent close ${code} stops without reconnect`, () => {
  const { manager, first, clock, sockets } = fixture(); first.close(code, 'permanent'); clock.advance(2000);
  assert.equal(manager.stats().terminal, 'protocol-error'); assert.equal(sockets.length, 1); manager.dispose();
});
for (const reason of ['unauthorized', 'update-required'] as const) test(`BA: ${reason} negotiation failure stops`, () => {
  const { manager, first, clock, sockets } = fixture(); first.open(); first.receive(reason); clock.advance(2000);
  assert.equal(manager.stats().terminal, reason); assert.equal(sockets.length, 1); manager.dispose();
});
test('BA: disposal guards synchronous close reentry, clears timers and lifecycle listeners', () => {
  const { manager, clock, sockets, page } = fixture(); manager.dispose(); page.emit('resume'); manager.retry(); clock.advance(3000);
  assert.equal(sockets.length, 1); assert.equal(clock.timers.size, 0); assert.equal(page.listeners.size, 0);
});
test('BA: hidden retries defer without spending budget and resume immediately', () => {
  const { manager, first, clock, page, sockets } = fixture(); page.emit('hidden'); first.close(1006, 'lost'); clock.advance(500);
  assert.equal(manager.stats().deferred, true); assert.equal(manager.stats().attempts, 0);
  page.emit('visible'); assert.equal(sockets.length, 2); manager.dispose();
});
test('BA: long timer pause proactively replaces; BFCache closes and restores', () => {
  const { manager, first, clock, page, sockets } = fixture(); first.alive(); clock.pause(100); clock.advance(0);
  assert.equal(sockets.length, 2); page.emit('pagehide'); assert.ok(sockets.every(s => s.readyState === 3));
  page.emit('pageshow'); assert.equal(sockets.length, 3); manager.dispose();
});
test('BA: server application ping is answered without satisfying client heartbeat', () => {
  const { manager, first } = fixture(); first.open(); first.receive('negotiated'); first.receive('ping server 2');
  assert.ok(first.sent.includes('pong server 2')); assert.equal(manager.stats().activeId, null); manager.dispose();
});
test('BA: timeout produces uncertain mutation, never replayed, late replies from replaced generation ignored', async () => {
  const { manager, first, clock, sockets } = fixture(); first.alive();
  const mutation = manager.request('mint', { mutation: true, receiptId: 'receipt' }).catch(e => e);
  const read = manager.request('search', { mutation: false, receiptId: null }).catch(e => e);
  clock.advance(90); sockets[1]!.alive();
  const failure = await mutation; assert.ok(failure instanceof RequestFailure); assert.equal(failure.outcome, 'uncertain'); assert.equal(failure.receiptId, 'receipt');
  assert.equal((await read).outcome, 'failed');
  assert.ok(!sockets[1]!.sent.some(s => s.includes('mint'))); manager.dispose();
});
test('BA: each new ALIVE generation invalidates snapshots and forbidden read clears protected state', async () => {
  const { manager, first, page, sockets } = fixture(); let invalidations = 0;
  manager.onInvalidate(() => invalidations++); first.alive(); const before = invalidations;
  const read = manager.request('raw', { mutation: false, receiptId: null }).catch(e => e);
  const id = first.sent.at(-1)!.split(' ')[1]!; first.receive(`forbidden ${id}`); await read;
  assert.ok(invalidations > before); page.emit('resume'); sockets[1]!.alive();
  assert.ok(manager.stats().generation >= 2); manager.dispose();
});
test('BA @regression: heartbeat continues after a late pong past the next scheduled heartbeat', () => {
  const { manager, first, clock } = fixture(); first.alive(); clock.advance(110);
  first.receive(first.ping().replace('ping ', 'pong ')); const pings = first.sent.filter(s => s.startsWith('ping ')).length;
  clock.advance(config.heartbeatInterval); assert.ok(first.sent.filter(s => s.startsWith('ping ')).length > pings);
  manager.dispose();
});
test('BA @regression: previous stale grace deadline cannot terminate a later stale period', () => {
  const { manager, first, clock } = fixture(); first.alive(); clock.advance(91);
  first.receive(first.ping().replace('ping ', 'pong ')); clock.advance(90);
  assert.equal(manager.stats().sockets[0]?.state, 'STALE'); clock.advance(9);
  assert.equal(first.readyState, 1); manager.dispose();
});
for (const [code, reason] of [[4400, 'protocol-error'], [4401, 'unauthorized'], [4406, 'update-required']] as const) test(`BA: observable application close ${code} is terminal`, () => {
  const { manager, first, clock, sockets } = fixture(); first.close(code, 'application stop'); clock.advance(2000);
  assert.equal(manager.stats().terminal, reason); assert.equal(sockets.length, 1); manager.dispose();
});
test('BA @regression: retriable server liveness expiry cannot kill the bounded replacement after resume', () => {
  const { manager, first, page, sockets } = fixture(); first.alive();
  page.emit('resume'); assert.equal(sockets.length, 2);
  assert.equal(manager.stats().sockets[0]?.state, 'STALE');
  first.close(1013, 'server liveness deadline');
  assert.equal(manager.stats().terminal, null); assert.equal(sockets[1]!.readyState, 0);
  sockets[1]!.alive();
  assert.equal(manager.stats().activeId, 2); assert.equal(manager.stats().attempts, 0);
  assert.ok(manager.stats().sockets.filter(socket => socket.state !== 'DEAD').length <= config.maxPool);
  manager.dispose();
});
test('BA: a late read response from the superseded socket cannot fulfill a new-generation read', async () => {
  const { manager, first, sockets, page } = fixture(); first.alive();
  const old = manager.request('old', { mutation: false, receiptId: null }).catch(e => e);
  const oldId = first.sent.at(-1)!.split(' ')[1]!;
  page.emit('resume'); sockets[1]!.alive();
  const next = manager.request('new', { mutation: false, receiptId: null });
  const nextId = sockets[1]!.sent.at(-1)!.split(' ')[1]!;
  first.receive(`reply ${nextId} wrong-socket`); sockets[1]!.receive(`reply ${oldId} old-generation`);
  sockets[1]!.receive(`reply ${nextId} correct`);
  assert.equal(await next, 'correct'); assert.equal((await old).outcome, 'failed'); manager.dispose();
});
test('BA @regression: lifecycle verification does not fork periodic heartbeat chains', () => {
  const { manager, first, clock, page } = fixture(); first.alive();
  const send = first.send.bind(first);
  first.send = data => { send(data); if (data.startsWith('ping ')) first.receive(data.replace('ping ', 'pong ')); };
  clock.advance(10); page.emit('online'); clock.advance(100);
  assert.equal(first.sent.filter(s => s.startsWith('ping ')).length, 4); manager.dispose();
});
test('BA @regression: heartbeat activity cannot cancel the request-timeout stale grace deadline', async () => {
  const { manager, first, clock } = fixture(); first.alive();
  const send = first.send.bind(first); let echo = true;
  first.send = data => { send(data); if (echo && data.startsWith('ping ')) first.receive(data.replace('ping ', 'pong ')); };
  clock.advance(25); const read = manager.request('hung-read', { mutation: false, receiptId: null }).catch(e => e);
  clock.advance(config.requestTimeout); echo = false;
  assert.equal(manager.stats().sockets[0]?.state, 'STALE');
  clock.advance(config.staleGrace); assert.equal(first.readyState, 3);
  assert.equal((await read).outcome, 'failed'); manager.dispose();
});

test('BA specified: transient one-shot delivery becomes uncertain without a durable receipt or replay', async () => {
  const { manager, first, clock, sockets } = fixture(); first.alive();
  const options = { mutation: false, receiptId: null, delivery: 'once' } as const;
  const request = manager.request('cost-bearing-start', options);
  const failure = assert.rejects(request, cause => cause instanceof RequestFailure && cause.outcome === 'uncertain' && cause.receiptId === null);
  first.close(1012, 'restart'); await failure; clock.advance(100); sockets.at(-1)!.alive();
  assert.equal(sockets.flatMap(socket => socket.sent).filter(value => value.includes('cost-bearing-start')).length, 1);
  manager.dispose();
});
test('BA specified: one-shot deadline uncertainty never directs transient work to durable receipt recovery', async () => {
  const { manager, first, clock } = fixture(); first.alive();
  const request = manager.request('transient-start', { mutation: false, receiptId: null, delivery: 'once' });
  const failure = assert.rejects(request, cause => cause instanceof RequestFailure && cause.outcome === 'uncertain' && cause.receiptId === null && !cause.message.includes('receipt'));
  clock.advance(config.requestTimeout); await failure; manager.dispose();
});
