import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient } from '../.cache/fixtures/web/src/client.js';
import * as C from '../.cache/fixtures/web/src/contracts.js';

const maximum = 9223372036854775807n;
const status = generation => `{"scope":"a","generation":${generation},"frontier":0,"coveredFrontier":0,"state":"Idle","failure":null}`;

test('requests preserve the generated decimal-string i64 representation exactly', async () => {
  let sent = false;
  const client = new ApiClient(async (_url, options) => {
    assert.equal(JSON.parse(options.body).expectedGeneration, maximum.toString());
    sent = true;
    return new Response('{"ok":true}', { status: 200 });
  });
  await client.post('present', new C.PresentRequest('a', [], maximum), C.PresentRequest.jsonCodec(), C.Ack.jsonCodec(), new AbortController().signal);
  assert.equal(sent, true);
});

test('numeric server i64 responses retain exact integers beyond Number.MAX_SAFE_INTEGER', async () => {
  const client = new ApiClient(async () => new Response(status(maximum), { status: 200 }));
  const result = await client.get('status', C.CurationStatus.jsonCodec(), new AbortController().signal);
  assert.equal(result.generation, maximum);
});

test('duplicate response fields fail rather than accepting the last scope', async () => {
  const client = new ApiClient(async () => new Response(status(1).replace('"scope":"a"', '"scope":"b","scope":"a"'), { status: 200 }));
  await assert.rejects(client.get('status', C.CurationStatus.jsonCodec(), new AbortController().signal), error => error.code === 'invalid-response');
});
