import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baboonProtocol } from '../src/transport/baboon.ts';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.ts';
import { ClientEnvelope_JsonCodec } from '../../generated/typescript/chronicle/api/ClientEnvelope.ts';
import { ServerEnvelope, ServerEnvelope_JsonCodec } from '../../generated/typescript/chronicle/api/ServerEnvelope.ts';
import { Result_Hello, Result_Pong, Result_Ping, Result_Search, Result_Archive } from '../../generated/typescript/chronicle/api/Result.ts';
import { Operation_Hello, Operation_Pong } from '../../generated/typescript/chronicle/api/Operation.ts';
import { VersionInfo } from '../../generated/typescript/chronicle/api/VersionInfo.ts';
import { UserInfo } from '../../generated/typescript/chronicle/api/UserInfo.ts';
import { Scope } from '../../generated/typescript/chronicle/api/Scope.ts';
import { SearchResult } from '../../generated/typescript/chronicle/api/SearchResult.ts';
import { SearchCountScope } from '../../generated/typescript/chronicle/api/SearchCountScope.ts';
import { ArchiveResult } from '../../generated/typescript/chronicle/api/ArchiveResult.ts';
import { ArchiveTextScope } from '../../generated/typescript/chronicle/api/ArchiveTextScope.ts';
const ctx = BaboonCodecContext.Default;
const frame = (id: string, result: ConstructorParameters<typeof ServerEnvelope>[1]) => JSON.stringify(ServerEnvelope_JsonCodec.instance.encode(ctx, new ServerEnvelope(id, result)));
test('BG: actual generated Hello negotiation, per-request client nonce matching, server Ping correlation', () => {
  const adapter = baboonProtocol(() => '00000000-0000-4000-8000-000000000001');
  const hello = ClientEnvelope_JsonCodec.instance.decode(ctx, JSON.parse(adapter.hello()));
  assert.ok(hello.operation instanceof Operation_Hello); assert.deepEqual(hello.operation.versions, ['1.5.0']);
  assert.deepEqual(adapter.decode(frame(hello.requestId, new Result_Hello(new VersionInfo('1.5.0', '1.0.0', ['1.5.0', '1.4.0', '1.3.0', '1.2.0', '1.1.0', '1.0.0']), new UserInfo('a', 'alice', [Scope.Read])))), { kind: 'negotiated' });
  const ping = ClientEnvelope_JsonCodec.instance.decode(ctx, JSON.parse(adapter.ping('nonce', 123)));
  assert.deepEqual(adapter.decode(frame(ping.requestId, new Result_Pong('nonce'))), { kind: 'pong', nonce: 'nonce', at: 123 });
  const serverId = '00000000-0000-4000-8000-000000000003';
  const event = adapter.decode(frame(serverId, new Result_Ping('server-nonce')));
  assert.equal(event.kind, 'ping');
  const pong = ClientEnvelope_JsonCodec.instance.decode(ctx, JSON.parse(adapter.pong(serverId, 'server-nonce', 0)));
  assert.equal(pong.requestId, serverId); assert.ok(pong.operation instanceof Operation_Pong); assert.equal(pong.operation.nonce, 'server-nonce');
});
test('BG: candidate-window count metadata is validated before a search response can render', () => {
  const adapter = baboonProtocol(() => '00000000-0000-4000-8000-000000000001');
  const id = '00000000-0000-4000-8000-000000000002';
  for (const result of [
    new SearchResult([], 1, SearchCountScope.CandidateWindow, undefined),
    new SearchResult([], 1, SearchCountScope.CandidateWindow, 0),
    new SearchResult([], 1001, SearchCountScope.CandidateWindow, 1000),
    new SearchResult([], 1, SearchCountScope.ExactMatches, 1000),
  ]) assert.throws(() => adapter.decode(frame(id, new Result_Search(result))), /search count metadata/i);
  assert.equal(adapter.decode(frame(id, new Result_Search(new SearchResult([], 1, SearchCountScope.CandidateWindow, 1000)))).kind, 'reply');
  assert.equal(adapter.decode(frame(id, new Result_Search(new SearchResult([], 1, SearchCountScope.ExactMatches, undefined)))).kind, 'reply');
});
test('BG: a 1.5 dashboard requires a server that supports its exact contract', () => {
  const adapter = baboonProtocol(() => '00000000-0000-4000-8000-000000000001');
  const hello = ClientEnvelope_JsonCodec.instance.decode(ctx, JSON.parse(adapter.hello()));
  assert.deepEqual(adapter.decode(frame(hello.requestId, new Result_Hello(new VersionInfo('1.4.0', '1.0.0', ['1.4.0', '1.3.0', '1.2.0', '1.1.0', '1.0.0']), new UserInfo('a', 'alice', [Scope.Read])))), { kind: 'stop', reason: 'update-required', message: 'The server no longer supports this dashboard. Reload to update.' });
});
test('BG: version rejection is terminal and generated ADT payloads are never flattened', () => {
  const adapter = baboonProtocol(() => '00000000-0000-4000-8000-000000000001');
  const hello = ClientEnvelope_JsonCodec.instance.decode(ctx, JSON.parse(adapter.hello()));
  const event = adapter.decode(frame(hello.requestId, new Result_Hello(new VersionInfo('2.0.0', '2.0.0', ['2.0.0']), new UserInfo('a', 'alice', [Scope.Read]))));
  assert.equal(event.kind, 'stop'); if (event.kind === 'stop') assert.equal(event.reason, 'update-required');
  assert.throws(() => adapter.decode(JSON.stringify({ requestId: hello.requestId, result: { kind: 'Search', result: {} } })));
});
test('BG specified: Archive ANN chunks-per-operand metadata never caps total rows or loses i64 precision', () => {
  const adapter = baboonProtocol(() => '00000000-0000-4000-8000-000000000001'), id = '00000000-0000-4000-8000-000000000002';
  for (const result of [
    new ArchiveResult([], 1n, undefined, ArchiveTextScope.BoundedCandidateSets, undefined),
    new ArchiveResult([], 1n, undefined, ArchiveTextScope.BoundedCandidateSets, 0),
    new ArchiveResult([], 1n, undefined, ArchiveTextScope.ExactLexical, 1000),
  ]) assert.throws(() => adapter.decode(frame(id, new Result_Archive(result))), /candidate-set metadata/);
  const event = adapter.decode(frame(id, new Result_Archive(new ArchiveResult([], 9007199254740993n, undefined, ArchiveTextScope.BoundedCandidateSets, 1000))));
  assert.equal(event.kind, 'reply');
  if (event.kind !== 'reply' || !(event.result instanceof Result_Archive)) throw new Error('Expected typed Archive reply');
  assert.equal(event.result.result.total, 9007199254740993n);
  assert.equal(event.result.result.annChunkLimitPerOperand, 1000);
});
