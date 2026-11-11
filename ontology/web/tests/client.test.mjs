import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient } from '../.cache/fixtures/web/src/client.js';
import * as C from '../.cache/fixtures/web/src/contracts.js';
import { WireValidation } from '../.cache/fixtures/web/src/wire-validation.js';
import { wirePlan } from '../.cache/fixtures/generated/typescript/GeneratedWirePlan.js';
const validation = new WireValidation(wirePlan);

const maximum = 9223372036854775807n;
const validIdentity = { actor: { id: 'fixture-human', kind: 'Human' }, scopes: ['a'], capabilities: ['Read'] };
for (const [name, value] of [
  ['numeric actor identifier', { ...validIdentity, actor: { ...validIdentity.actor, id: 42 } }],
  ['string in place of scope array', { ...validIdentity, scopes: 'a' }],
  ['unknown nested member', { ...validIdentity, actor: { ...validIdentity.actor, injected: true } }],
  ['unknown root member', { ...validIdentity, injected: true }],
]) {
  test(`typed response boundary rejects ${name}`, async () => {
    const client = new ApiClient(async () => new Response(JSON.stringify(value), { status: 200 }), validation);
    await assert.rejects(() => client.get('whoami', C.Identity.jsonCodec(), new AbortController().signal), /invalid response/);
  });
}
const status = generation => `{"scope":"a","generation":${generation},"frontier":0,"coveredFrontier":0,"state":"Idle","failure":null}`;

test('requests preserve the generated decimal-string i64 representation exactly', async () => {
  let sent = false;
  const client = new ApiClient(async (_url, options) => {
    assert.equal(JSON.parse(options.body).expectedGeneration, maximum.toString());
    sent = true;
    return new Response('{"ok":true}', { status: 200 });
  }, validation);
  await client.post('present', new C.PresentRequest('a', [], maximum), C.PresentRequest.jsonCodec(), C.Ack.jsonCodec(), new AbortController().signal);
  assert.equal(sent, true);
});

test('numeric server i64 responses retain exact integers beyond Number.MAX_SAFE_INTEGER', async () => {
  const client = new ApiClient(async () => new Response(status(maximum), { status: 200 }), validation);
  const result = await client.get('status', C.CurationStatus.jsonCodec(), new AbortController().signal);
  assert.equal(result.generation, maximum);
});

for (const token of ['1.00000000000000001', '1e-999', '-1e-999', '2147483647.0000000001']) {
  test(`fractional raw JSON cannot round into an i32: ${token}`, async () => {
    const record = new C.GraphRecord_Person(new C.ActorRecord(new C.Ref('00000000-0000-4000-8000-000000000001', 1), new C.Actor('fixture', C.ActorKind.Agent)));
    const wire = C.ReadResult.jsonCodec().encode(C.BaboonCodecContext.Default, new C.ReadResult('a', 0n, [record], undefined));
    const text = JSON.stringify(wire).replace('"revision":1', `"revision":${token}`);
    const client = new ApiClient(async () => new Response(text, { status: 200 }), validation);
    await assert.rejects(() => client.get('read', C.ReadResult.jsonCodec(), new AbortController().signal), /invalid response/);
  });
  test(`fractional raw JSON cannot round into an i64: ${token}`, async () => {
    const client = new ApiClient(async () => new Response(status(token), { status: 200 }), validation);
    await assert.rejects(() => client.get('status', C.CurationStatus.jsonCodec(), new AbortController().signal), /invalid response/);
  });
}

test('invalid request primitives reject before the fetch boundary', async () => {
  let dispatched = false;
  const client = new ApiClient(async () => { dispatched = true; throw new Error('must not dispatch'); }, validation);
  const request = new C.ReadRequest('a', C.ReadView.History, [new C.Ref('00000000-0000-4000-8000-000000000001', 2147483648)], undefined, 100);
  await assert.rejects(() => client.post('read', request, C.ReadRequest.jsonCodec(), C.ReadResult.jsonCodec(), new AbortController().signal), /invalid request/);
  assert.equal(dispatched, false);
});

test('lossless numeric values are not promoted into string fields', async () => {
  const body = '{"actor":{"id":9007199254740993,"kind":"Human"},"scopes":["a"],"capabilities":["Read"]}';
  const client = new ApiClient(async () => new Response(body, { status: 200 }), validation);
  await assert.rejects(() => client.get('whoami', C.Identity.jsonCodec(), new AbortController().signal), /invalid response/);
});

test('missing nullable fields are rejected rather than decoded as absence', async () => {
  const client = new ApiClient(async () => new Response(status(1).replace(',"failure":null', ''), { status: 200 }), validation);
  await assert.rejects(() => client.get('status', C.CurationStatus.jsonCodec(), new AbortController().signal), /invalid response/);
});

test('duplicate response fields fail rather than accepting the last scope', async () => {
  const client = new ApiClient(async () => new Response(status(1).replace('"scope":"a"', '"scope":"b","scope":"a"'), { status: 200 }), validation);
  await assert.rejects(client.get('status', C.CurationStatus.jsonCodec(), new AbortController().signal), error => error.code === 'invalid-response');
});
