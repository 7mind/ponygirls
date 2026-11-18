import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeOperation, decodeWire, encodeWire, operationNames, operationPolicy, schema, validateResponse } from '../src/wire.js';
import { parseArgs, makeOperation } from '../src/commands.js';
import { bearer } from '../src/files.js';
import { parseJson } from '../src/json.js';
import { human, output, terminalSafe } from '../src/output.js';

const ID = '11111111-1111-4111-8111-111111111111';

// Specified: Behavioral-Active Blackbox-Group contracts; no service credentials.
test('sole-current schema covers every operation with an explicit effect policy', () => {
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
// Specified: safe machine output preserves parsed strings, not terminal effects.
test('JSON escapes bidi and C1 controls while retaining exact parsed Unicode', () => {
  const data = { text: 'hé🙂\u202e\u009b31m' }; const text = output(data, true);
  assert.ok(!text.includes('\u202e')); assert.ok(!text.includes('\u009b')); assert.deepEqual(JSON.parse(text), data);
});
test('strict JSON rejects duplicate keys, deep nesting, trailing data and nonfinite numbers', () => {
  for (const text of ['{"a":1,"a":2}', '['.repeat(66) + '0' + ']'.repeat(66), '1 2', '1e9999', '{"a":NaN}']) assert.throws(() => parseJson(text));
});
test('responses reject wrong branch and any silently retargeted exact content pin', () => {
  const op = decodeOperation({ GetMessages: { sessionId: ID, offset: 0, limit: 20, view: { revision: 4, generationId: null } } });
  assert.throws(() => validateResponse(op, decodeWire('Result', { Whoami: { user: { id: 'a', login: 'a', scopes: ['Read'] } } }), null));
  assert.throws(() => validateResponse(op, decodeWire('Result', { Messages: { result: { messages: [], total: 0, offset: 0, view: { revision: 5, generationId: null } } } }), null));
  validateResponse(op, decodeWire('Result', { Messages: { result: { messages: [], total: 0, offset: 0, view: { revision: 4, generationId: null } } } }), null);
});
test('current MCP run read event pages permit all 256 events, and tag cursor preserves an empty exact value', () => {
  decodeOperation({ ReadMcpTest: { instanceId: ID, runId: ID, afterSequence: '0', limit: 256 } });
  assert.equal(parseArgs(['tags', '', '--cursor', '']).options.get('cursor')![0], '');
});
test('archive defaults and maximum match current source-evidence ArchiveSearch page bound10', () => {
  assert.deepEqual(encodeWire('Operation', makeOperation(parseArgs(['archive']))), { ArchiveSearch: { query: { expression: '', sort: 'LastTimestamp', direction: 'Desc', cursor: null, limit: 10, preferRelevance: true } } });
  assert.throws(() => makeOperation(parseArgs(['archive', '--limit', '11'])));
});
test('Chronicle bearer validation accepts its full configured alphabet/length, not an exact43 base64url codec', () => {
  const valid = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/.=-';
  assert.equal(bearer({ CHRONICLE_TOKEN: valid }, null), valid);
  assert.throws(() => bearer({ CHRONICLE_TOKEN: 'too-short' }, null));
  assert.throws(() => bearer({ CHRONICLE_TOKEN: valid + ':' }, null));
  assert.throws(() => bearer({ CHRONICLE_TOKEN: valid.repeat(16) }, null));
});
test('Chronicle trailing-whitespace token normalization applies to literal and protected-file inputs without narrowing static tokens', () => {
  const root = mkdtempSync(join(tmpdir(), 'chronicle-token-contract-'));
  const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/.=-';
  try { const file = join(root, 'token'); writeFileSync(file, `${token}\r\n\n\t `, { mode: 0o600 }); assert.equal(bearer({ CHRONICLE_TOKEN_FILE: file }, null), token); assert.equal(bearer({ CHRONICLE_TOKEN: `${token}\r\n\n\t ` }, null), token); assert.throws(() => bearer({ CHRONICLE_TOKEN: ` ${token}` }, null)); } finally { rmSync(root, { recursive: true }); }
});
