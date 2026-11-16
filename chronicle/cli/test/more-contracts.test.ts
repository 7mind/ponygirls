import { test } from 'node:test';
import assert from 'node:assert/strict';
import { output } from '../src/output.js';
import { parseJson } from '../src/json.js';
import { validateResponse } from '../src/wire.js';
import { decodeOperation, decodeWire } from '../src/wire.js';
const ID = '11111111-1111-4111-8111-111111111111';
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
test('current MCP run read event pages permit all 256 events, and tag cursor preserves an empty exact value', async () => {
  const { parseArgs } = await import('../src/commands.js');
  decodeOperation({ ReadMcpTest: { instanceId: ID, runId: ID, afterSequence: '0', limit: 256 } });
  assert.equal(parseArgs(['tags', '', '--cursor', '']).options.get('cursor')![0], '');
});
test('archive defaults and maximum match current source-evidence ArchiveSearch page bound10', async () => {
  const { makeOperation, parseArgs } = await import('../src/commands.js');
  const { encodeWire } = await import('../src/wire.js');
  assert.deepEqual(encodeWire('Operation', makeOperation(parseArgs(['archive']))), { ArchiveSearch: { query: { expression: '', sort: 'LastTimestamp', direction: 'Desc', cursor: null, limit: 10, preferRelevance: true } } });
  assert.throws(() => makeOperation(parseArgs(['archive', '--limit', '11'])));
});
test('Chronicle bearer validation accepts its full configured alphabet/length, not an exact43 base64url codec', async () => {
  const { bearer } = await import('../src/files.js');
  const valid = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/.=-';
  assert.equal(bearer({ CHRONICLE_TOKEN: valid }, null), valid);
  assert.throws(() => bearer({ CHRONICLE_TOKEN: 'too-short' }, null));
  assert.throws(() => bearer({ CHRONICLE_TOKEN: valid + ':' }, null));
  assert.throws(() => bearer({ CHRONICLE_TOKEN: valid.repeat(16) }, null));
});
test('Chronicle trailing-whitespace token normalization applies to literal and protected-file inputs without narrowing static tokens', async () => {
  const { bearer } = await import('../src/files.js');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'chronicle-token-contract-'));
  const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+/.=-';
  try { const file = join(root, 'token'); writeFileSync(file, `${token}\r\n\n\t `, { mode: 0o600 }); assert.equal(bearer({ CHRONICLE_TOKEN_FILE: file }, null), token); assert.equal(bearer({ CHRONICLE_TOKEN: `${token}\r\n\n\t ` }, null), token); assert.throws(() => bearer({ CHRONICLE_TOKEN: ` ${token}` }, null)); } finally { rmSync(root, { recursive: true }); }
});
