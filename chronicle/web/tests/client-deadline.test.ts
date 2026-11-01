import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArchiveQuery, ArchiveResult, ArchiveSearchResult, ArchiveSort, ArchiveTextScope,
  BaboonCodecContext, ClientEnvelope, ClientEnvelope_JsonCodec,
  Operation_Archive, Operation_ArchiveSearch, Operation_Hello, Operation_ListTokens,
  Operation_MintToken, Operation_Ping, Operation_Pong,
  Result_ArchiveSearch, Result_Hello, Result_Pong, Scope,
  ServerEnvelope, ServerEnvelope_JsonCodec, SortDirection, UserInfo, VersionInfo,
  type Operation, type Result,
} from '../src/api.ts';
import { mutate, read } from '../src/client.ts';
import { baboonProtocol } from '../src/transport/baboon.ts';
import { ConnectionManager } from '../src/transport/manager.ts';
import { connectionConfig, RequestFailure } from '../src/transport/types.ts';
import { Clock, FakeSocket, Page } from './fakes.ts';

const ctx = BaboonCodecContext.Default;
const frame = (id: string, result: Result) => JSON.stringify(ServerEnvelope_JsonCodec.instance.encode(ctx, new ServerEnvelope(id, result)));
const decode = (data: string) => ClientEnvelope_JsonCodec.instance.decode(ctx, JSON.parse(data));
const query = () => new ArchiveQuery('controlled query', ArchiveSort.LastTimestamp, SortDirection.Desc, undefined, 20, true);
const searchResult = () => new ArchiveSearchResult(new ArchiveResult([], 0n, undefined, ArchiveTextScope.ExactLexical, undefined, true), []);
async function turn() { await new Promise<void>(resolve => setImmediate(resolve)); }

function fixture(t: TestContext) {
  const clock = new Clock(), page = new Page(), sockets: FakeSocket[] = [];
  let sequence = 0;
  const nonce = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const manager = new ConnectionManager<Operation, Result>({
    scheduler: clock, lifecycle: page, nonce, random: () => 0.5,
    config: connectionConfig, protocol: () => baboonProtocol(nonce),
    socket: () => {
      const socket = new FakeSocket(), send = socket.send.bind(socket);
      socket.send = data => {
        send(data);
        const { requestId, operation } = decode(data);
        if (operation instanceof Operation_Hello) socket.receive(frame(requestId, new Result_Hello(
          new VersionInfo(ClientEnvelope.BaboonDomainVersion, ClientEnvelope.BaboonDomainVersion, [ClientEnvelope.BaboonDomainVersion]),
          new UserInfo('controlled-user', 'controlled-user', [Scope.Read]),
        )));
        if (operation instanceof Operation_Ping) socket.receive(frame(requestId, new Result_Pong(operation.nonce)));
      };
      sockets.push(socket);
      return socket;
    },
  });
  t.after(() => manager.dispose());
  manager.start();
  const first = sockets[0]!;
  first.open();
  assert.equal(manager.stats().activeId, 1);
  const requests = () => sockets.flatMap(socket => socket.sent.map(decode)).filter(({ operation }) =>
    !(operation instanceof Operation_Hello || operation instanceof Operation_Ping || operation instanceof Operation_Pong));
  return { manager, clock, sockets, first, requests };
}

test('BG @regression: client.read accepts a valid ArchiveSearch response after the generic 20-second deadline', async t => {
  const { manager, clock, sockets, first, requests } = fixture(t);
  let settled = false;
  const request = read(manager, new Operation_ArchiveSearch(query()), reply => reply instanceof Result_ArchiveSearch ? reply.result : null);
  void request.then(() => { settled = true; }, () => { settled = true; });
  const id = requests()[0]!.requestId;
  clock.advance(20_001);
  await turn();
  assert.equal(settled, false, 'ArchiveSearch must not expire at the generic request deadline');
  clock.advance(24_999);
  assert.equal(manager.stats().activeId, 1);
  assert.equal(manager.stats().sentPings, 4, 'normal 15-second heartbeats continue during the read');
  assert.equal(manager.stats().lostPings, 0);
  assert.equal(sockets.length, 1);
  const expected = searchResult();
  first.receive(frame(id, new Result_ArchiveSearch(expected)));
  assert.deepEqual(await request, expected);
  clock.advance(15_001);
  assert.equal(manager.stats().activeId, 1, 'a completed request cancels its deadline');
  assert.equal(requests().length, 1, 'no fallback or replay is sent');
});

test('BG @regression: a hung client.read ArchiveSearch expires at exactly 60 seconds despite live heartbeats', async t => {
  const { manager, clock, first, sockets, requests } = fixture(t);
  let settledAt: number | null = null, extractions = 0;
  const request = read(manager, new Operation_ArchiveSearch(query()), reply => {
    extractions++;
    return reply instanceof Result_ArchiveSearch ? reply.result : null;
  });
  void request.then(() => { settledAt = clock.now(); }, () => { settledAt = clock.now(); });
  const failure = assert.rejects(request, cause => cause instanceof RequestFailure && cause.code === 'timeout' && cause.outcome === 'failed' && cause.receiptId === null);
  const id = requests()[0]!.requestId;
  clock.advance(59_999);
  await turn();
  assert.equal(settledAt, null, 'ArchiveSearch retains its entire finite deadline');
  assert.equal(manager.stats().activeId, 1);
  assert.equal(manager.stats().sentPings, 4);
  assert.equal(manager.stats().lostPings, 0);
  assert.equal(sockets.length, 1);
  clock.advance(1);
  await failure;
  assert.equal(settledAt, 60_000);
  first.receive(frame(id, new Result_ArchiveSearch(searchResult())));
  clock.advance(30_000);
  assert.equal(extractions, 0, 'late replies cannot revive an expired read');
  assert.equal(requests().length, 1, 'timeout does not send a fallback or replay');
});

for (const operation of [new Operation_Archive(query()), new Operation_ListTokens()]) {
  test(`BG: client.read ${operation.constructor.name} keeps the 20-second default deadline`, async t => {
    const { manager, clock, requests } = fixture(t);
    let settledAt: number | null = null;
    const request = read(manager, operation, result => result);
    void request.then(() => { settledAt = clock.now(); }, () => { settledAt = clock.now(); });
    const failure = assert.rejects(request, cause => cause instanceof RequestFailure && cause.code === 'timeout' && cause.outcome === 'failed');
    clock.advance(19_999);
    await turn();
    assert.equal(settledAt, null);
    assert.equal(manager.stats().activeId, 1);
    assert.equal(manager.stats().sentPings, 2);
    clock.advance(1);
    await failure;
    assert.equal(settledAt, 20_000);
    assert.equal(requests().length, 1);
  });
}

test('BG: client mutations retain a 20-second uncertain deadline and durable receipt identity', async t => {
  const { manager, clock, requests } = fixture(t);
  const receiptId = '00000000-0000-4000-8000-999999999999';
  const request = mutate(manager, new Operation_MintToken('controlled-token', [Scope.Read]), receiptId);
  let settled = false;
  void request.then(() => { settled = true; }, () => { settled = true; });
  const failure = assert.rejects(request, cause => cause instanceof RequestFailure && cause.code === 'timeout' && cause.outcome === 'uncertain' && cause.receiptId === receiptId);
  clock.advance(19_999);
  await turn();
  assert.equal(settled, false);
  clock.advance(1);
  await failure;
  assert.equal(requests().length, 1);
  assert.equal(requests()[0]!.requestId, receiptId);
});

test('BG: one-shot requests retain their 20-second uncertain deadline without receipt recovery or replay', async t => {
  const { manager, clock, requests } = fixture(t);
  const request = manager.request(new Operation_ListTokens(), { mutation: false, receiptId: null, delivery: 'once' });
  let settled = false;
  void request.then(() => { settled = true; }, () => { settled = true; });
  const failure = assert.rejects(request, cause => cause instanceof RequestFailure && cause.code === 'timeout' && cause.outcome === 'uncertain' && cause.receiptId === null && !cause.message.includes('receipt'));
  clock.advance(19_999);
  await turn();
  assert.equal(settled, false);
  clock.advance(1);
  await failure;
  assert.equal(requests().length, 1);
});
