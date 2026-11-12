import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { OntologyHttp, WorkerFailure } from '../.cache/worker/src/http.js';
import { WireValidation } from '../.cache/web/src/wire-validation.js';
import { wirePlan } from '../.cache/generated/typescript/GeneratedWirePlan.js';
import { Capsule, CapsuleRequest, ScopesResult } from '../.cache/generated/typescript/ontology/api/index.js';

const token = 'a'.repeat(43);
const settings = origin => ({ origin, deadlineMs: 1000, maxRequestBytes: 4096, maxResponseBytes: 4096 });
const credentials = { token: async () => token };
const validation = new WireValidation(wirePlan);
const json = text => new Response(text, { headers: { 'Content-Type': 'application/json', 'X-Ontology-Version': '0.1.0' } });
const signal = () => new AbortController().signal;

for (const adapter of ['dummy', 'http']) test(`bounded authenticated transport contract: ${adapter}`, async () => {
  let observed;
  let close = async () => {};
  let origin = 'http://127.0.0.1:12345';
  let fetcher = async (url, options) => { observed = { url, headers: new Headers(options.headers), options }; return json('{"items":[]}'); };
  if (adapter === 'http') {
    const server = createServer((request, response) => {
      observed = { url: request.url, headers: new Headers(request.headers) };
      response.writeHead(200, { 'Content-Type': 'application/json', 'X-Ontology-Version': '0.1.0' });
      response.end('{"items":[]}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    close = () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fetcher = fetch;
  }
  try {
    const client = new OntologyHttp(settings(origin), credentials, fetcher, validation);
    const value = await client.get('scopes', ScopesResult.jsonCodec(), signal());
    assert.deepEqual(value.items, []);
    assert.equal(observed.headers.get('Authorization'), 'Bearer ' + token);
    assert.equal(observed.headers.get('Origin'), origin);
    assert.equal(observed.headers.get('Cookie'), null);
    assert.equal(observed.headers.get('X-Ontology-Version'), '0.1.0');
  } finally { await close(); }
});

test('ambiguous JSON and unexpected response fields are rejected', async () => {
  for (const text of ['{"items":[],"items":[]}', '{"items":[],"extra":true}']) {
    const client = new OntologyHttp(settings('http://127.0.0.1:12345'), credentials, async () => json(text), validation);
    await assert.rejects(client.get('scopes', ScopesResult.jsonCodec(), signal()), error => error instanceof WorkerFailure && error.outcome === 'unknown');
  }
});
test('body capacity is enforced without partial decoding', async () => {
  const client = new OntologyHttp({ ...settings('http://127.0.0.1:12345'), maxResponseBytes: 2 }, credentials, async () => json('{"items":[]}'), validation);
  await assert.rejects(client.get('scopes', ScopesResult.jsonCodec(), signal()), /response-capacity/);
});
test('abort before credential acquisition cannot dispatch', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0; let credentialCalls = 0;
  const client = new OntologyHttp(settings('http://127.0.0.1:12345'), { token: async () => { credentialCalls++; return token; } }, async () => { calls++; return json('{"items":[]}'); }, validation);
  await assert.rejects(client.get('scopes', ScopesResult.jsonCodec(), controller.signal), error => error.outcome === 'not-sent');
  assert.equal(calls, 0);
  assert.equal(credentialCalls, 0);
});
test('noncooperative fetch is bounded without claiming rollback', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const client = new OntologyHttp({ ...settings('http://127.0.0.1:12345'), deadlineMs: 20 }, credentials, () => new Promise(() => {}), validation);
    await assert.rejects(client.get('scopes', ScopesResult.jsonCodec(), signal()), error => error.outcome === 'unknown');
  } finally { clearTimeout(keepAlive); }
});
test('response body deadline cancels the stream and preserves uncertainty', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const client = new OntologyHttp({ ...settings('http://127.0.0.1:12345'), deadlineMs: 20 }, credentials,
      async () => new Response(body, { headers: { 'Content-Type': 'application/json', 'X-Ontology-Version': '0.1.0' } }), validation);
    await assert.rejects(client.get('scopes', ScopesResult.jsonCodec(), signal()), error => error.outcome === 'unknown');
    assert.equal(cancelled, true);
  } finally { clearTimeout(keepAlive); }
});
test('a mutation error response after commit preserves an uncertain outcome', async () => {
  let committed = false;
  const client = new OntologyHttp(settings('http://127.0.0.1:12345'), credentials, async () => {
    committed = true;
    return new Response('{"code":"unauthorized","message":"response-time credential changed"}', { status: 401,
      headers: { 'Content-Type': 'application/json', 'X-Ontology-Version': '0.1.0' } });
  }, validation);
  const request = new CapsuleRequest('scope', '00000000-0000-4000-8000-000000000001', 'work', undefined, 0n, undefined);
  await assert.rejects(client.post('capsule', request, CapsuleRequest.jsonCodec(), Capsule.jsonCodec(), signal()),
    error => error.code === 'unauthorized' && error.outcome === 'unknown');
  assert.equal(committed, true);
});
test('explicit rejection exposes only sanitized code, not server details', async () => {
  const client = new OntologyHttp(settings('http://127.0.0.1:12345'), credentials,
    async () => new Response('{"code":"forbidden","message":"private server detail"}', { status: 403,
      headers: { 'Content-Type': 'application/json', 'X-Ontology-Version': '0.1.0' } }), validation);
  await assert.rejects(client.get('scopes', ScopesResult.jsonCodec(), signal()), error => error.message === 'forbidden' && error.outcome === 'rejected');
});
test('noncanonical origin and nonloopback plain HTTP are rejected before effects', () => {
  for (const origin of ['http://example.com', 'https://example.com/', 'https://user@example.com', 'https://example.com:443']) {
    assert.throws(() => new OntologyHttp(settings(origin), credentials, fetch, validation), /invalid-service-origin/);
  }
});
test('credential errors are sanitized and no request is sent', async () => {
  const client = new OntologyHttp(settings('http://127.0.0.1:12345'), { token: async () => { throw Error('private value'); } }, fetch, validation);
  await assert.rejects(client.get('scopes', ScopesResult.jsonCodec(), signal()), error => error.message === 'request-unavailable' && error.outcome === 'not-sent');
});
