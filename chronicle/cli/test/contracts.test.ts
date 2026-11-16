import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeOperation, decodeWire, encodeWire, operationNames, operationPolicy, schema } from '../src/wire.js';
import { parseArgs, makeOperation } from '../src/commands.js';
import { human, terminalSafe } from '../src/output.js';

// Specified: Behavioral-Active Blackbox-Group contracts; no service credentials.
test('sole-current schema covers every operation with an explicit effect policy', () => {
  const model = readFileSync(new URL('../../../../models/chronicle.baboon', import.meta.url), 'utf8');
  const match = /root adt Operation \{([\s\S]*?)\n\}/.exec(model);
  assert.ok(match);
  const names = [...match[1]!.matchAll(/data (\w+)/g)].map(m => m[1]);
  assert.deepEqual(operationNames, names);
  assert.deepEqual(Object.keys(operationPolicy).sort(), [...operationNames].sort());
  assert.equal(schema.version, '1.9.0');
});
test('generated codec i64 string output remains exact and unsafe numeric input is rejected', () => {
  const data = { ReindexStatus: { result: { requestId: '11111111-1111-4111-8111-111111111111', targetProfile: 'p', total: '9223372036854775807', complete: '0', superseded: '0', failed: '0', pending: '9223372036854775807' } } };
  assert.deepEqual(encodeWire('Result', decodeWire('Result', data)), data);
  assert.throws(() => decodeWire('Result', { ReindexStatus: { result: { ...data.ReindexStatus.result, total: 9223372036854775807 } } }));
  assert.throws(() => decodeWire('Result', { ReindexStatus: { result: { ...data.ReindexStatus.result, total: '9223372036854775808' } } }));
});
test('typed rpc rejects extra/missing fields, invalid UUIDs, primitives and unions before transport', () => {
  for (const input of [{ Whoami: { extra: true } }, { Whoami: {}, Logout: {} }, { GetSession: { sessionId: 'not-id', view: null } }, { ApplyOwnerReindex: { targetProfile: 'x', selectionHash: 'x', confirm: 'yes' } }]) assert.throws(() => decodeOperation(input));
  assert.throws(() => decodeOperation({ GetChunks: { sessionId: '11111111-1111-4111-8111-111111111111', offset: -1, limit: 20, view: null } }));
  assert.deepEqual(encodeWire('Operation', decodeOperation({ Whoami: {} })), { Whoami: {} });
});
test('--json is position independent and explicit content views are not lost', () => {
  assert.equal(parseArgs(['--json', 'whoami']).json, true);
  assert.equal(parseArgs(['whoami', '--json']).json, true);
  const args = parseArgs(['messages', '11111111-1111-4111-8111-111111111111', '--revision', '4', '--generation', '22222222-2222-4222-8222-222222222222']);
  const op = makeOperation(args);
  assert.deepEqual(encodeWire('Operation', op), { GetMessages: { sessionId: '11111111-1111-4111-8111-111111111111', offset: 0, limit: 20, view: { revision: 4, generationId: '22222222-2222-4222-8222-222222222222' } } });
  assert.throws(() => makeOperation(parseArgs(['find', '11111111-1111-4111-8111-111111111111', 'needle'])));
  assert.throws(() => parseArgs(['whoami', '--password', 'secret']));
});
test('terminal text is readable, escape safe and retains full identifiers/citations/provenance', () => {
  const text = terminalSafe('a\u001b]52;clipboard\u0007\u202ebé🙂\n\t');
  assert.equal(text, 'a\\u001b]52;clipboard\\u0007\\u202ebé🙂\n\t');
  const printed = human({ Session: { result: { session: { id: '11111111-1111-4111-8111-111111111111', view: { revision: 4, generationId: null }, source: { producerSessionId: 'producer' } }, chunks: [{ spans: [{ messageId: 'message-full-id', start: 3, end: 17 }], text: 'hello' }] } } });
  for (const term of ['11111111-1111-4111-8111-111111111111', 'revision', 'producer', 'message-full-id', '17', 'hello']) assert.ok(printed.includes(term));
  assert.ok(!printed.trimStart().startsWith('{'));
});
