// The connection state of the dashboard (common.js createConnection) with a controlled clock and transport:
// what counts as an answer (judged when the response body is complete, a gateway's JSON error page told from Manure's
// own error), the heartbeat schedule and its back-off, and what a hidden tab does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTION, createConnection } from '../../web/dashboard/common.js';
import { answeredByManure } from '../../web/dashboard/current-protocol.js';

const json = { 'Content-Type': 'application/json' };

// A page with a fake clock whose timers fire in order, a visibility state, listeners, and a scripted network.
function harness() {
  let time = 0, nextId = 1;
  const timers = new Map(), listeners = { document: {}, window: {} }, sent = [];
  const target = (name) => ({ addEventListener: (type, listener) => { listeners[name][type] = listener; } });
  const document = { ...target('document'), visibilityState: 'visible' };
  const window = {
    ...target('window'), AbortController, DOMException, URL,
    setTimeout: (callback, ms) => { const id = nextId++; timers.set(id, { callback, at: time + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  let answer = () => Promise.resolve(new Response('{}', { headers: json }));
  const fetch = (url, init) => { sent.push(url); return answer(init); };
  // Heartbeats go through the fetch they are given and, like the real probe, read the whole answer: the promise settles
  // when the body is complete or has failed.
  const probe = async (observed, signal) => { const response = await observed('/probe', { signal }); await response.text(); return response; };
  const connection = createConnection({ fetch, document, window, now: () => time, probe, answeredByManure });
  const phases = ['connecting'];
  connection.subscribe((snapshot) => { if (phases.at(-1) !== snapshot.phase) { phases.push(snapshot.phase); } });
  connection.start();
  const page = {
    connection, document, window, sent, listeners, phases,
    respond: (next) => { answer = next; },
    due: () => connection.snapshot().nextCheckAt - time,
    // Lets the promises started so far (response bodies are judged on their own) settle.
    settle: async () => { for (let turn = 0; turn < 5; turn++) { await new Promise((resolve) => setImmediate(resolve)); } },
    // Advances the clock and lets the promises the fired timers started settle.
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const [id, timer] = [...timers].sort(([, a], [, b]) => a.at - b.at)[0] ?? [];
        if (timer === undefined || timer.at > end) { break; }
        timers.delete(id); time = timer.at; timer.callback();
        await page.settle();
      }
      time = end;
    },
  };
  return page;
}
const refused = () => Promise.reject(new TypeError('Failed to fetch'));
// What Manure answers on the API path: an error envelope for the request, and a request that carries its id.
const envelope = (requestId) => JSON.stringify({ requestId, result: { Error: { failure: { code: 'Unavailable', message: 'controlled', retryAfterSeconds: 1 } } } });
const post = (requestId) => ({ method: 'POST', body: JSON.stringify({ requestId, apiVersion: '1.0.0', command: { Whoami: {} } }) });
const mine = '0f4c5b1e-6a3d-4c52-8c1b-2d9e7a6b5c41', other = '9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d', nil = '00000000-0000-0000-0000-000000000000';

test('an answer of any kind is a connection, a refusal, a gateway page or a timeout is not, and a cancelled request is neither', async () => {
  const page = harness();
  const request = async (answer) => { page.respond(answer); await page.connection.fetch('/api/current', {}).catch(() => {}); await page.settle(); };
  assert.equal(page.connection.snapshot().phase, 'connecting', 'nothing is live before the first answer');
  await request(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
  assert.equal(page.connection.snapshot().phase, 'connecting', 'a cancelled request tells nothing');
  await request(() => Promise.resolve(new Response('{}', { status: 401, headers: json })));
  assert.equal(page.connection.snapshot().phase, 'live', 'a 401 is an answer');
  page.respond(() => Promise.resolve(new Response(envelope(mine), { status: 503, headers: json })));
  await page.connection.fetch('/api/current', post(mine));
  await page.settle();
  assert.equal(page.connection.snapshot().phase, 'live', "Manure's own 503 error is an answer");
  await request(() => Promise.resolve(new Response('<h1>Bad Gateway</h1>', { status: 502, headers: { 'Content-Type': 'text/html' } })));
  assert.equal(page.connection.snapshot().phase, 'offline', 'a gateway error page is not');
  await request(() => Promise.resolve(new Response('{}', { headers: json })));
  await request(refused);
  assert.equal(page.connection.snapshot().phase, 'offline');
  await request(() => Promise.resolve(new Response('{}', { headers: json })));
  await request(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
  assert.equal(page.connection.snapshot().lastFailure.reason, 'No answer in time');
  await request(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
  assert.equal(page.connection.snapshot().phase, 'offline', 'a cancelled request does not restore it');
});

test('heartbeats: idle interval while live, doubling retries up to the ceiling while not, reset by an answer, postponed by other traffic', async () => {
  const page = harness();
  assert.equal(page.due(), CONNECTION.RETRY_FIRST_MS, 'before the first answer the checks are soon');
  page.respond(refused);
  const delays = [];
  for (let attempt = 0; attempt < 7; attempt++) {
    await page.advance(page.due());
    delays.push(page.due());
  }
  assert.deepEqual(delays, [5000, 10000, 20000, 40000, 60000, 60000, 60000]);
  assert.equal(CONNECTION.RETRY_MAX_MS, 60000);
  page.respond(() => Promise.resolve(new Response('{}', { headers: json })));
  await page.advance(page.due());
  assert.equal(page.connection.snapshot().phase, 'live');
  assert.equal(page.due(), CONNECTION.IDLE_CHECK_MS);
  const probes = () => page.sent.filter((url) => url === '/probe').length, before = probes();
  await page.advance(CONNECTION.IDLE_CHECK_MS - 1);
  await page.connection.fetch('/api/current', {});
  await page.settle();
  await page.advance(CONNECTION.IDLE_CHECK_MS - 1);
  assert.equal(probes(), before, 'another request postponed the heartbeat');
  await page.advance(1);
  assert.equal(probes(), before + 1);
});

test('a hidden tab has no heartbeat; showing it, the browser coming online or Check now probes at once and replaces a stuck probe', async () => {
  const page = harness();
  await page.connection.fetch('/api/current', {});
  await page.settle();
  const probes = () => page.sent.filter((url) => url === '/probe').length;
  page.document.visibilityState = 'hidden';
  page.listeners.document.visibilitychange();
  assert.equal(page.connection.snapshot().nextCheckAt, null);
  await page.advance(10 * CONNECTION.IDLE_CHECK_MS);
  assert.equal(probes(), 0);
  page.listeners.window.online();
  assert.equal(probes(), 0, 'online while hidden waits for the tab to be shown');
  page.document.visibilityState = 'visible';
  const stuck = [];
  page.respond((init) => new Promise((_, reject) => { stuck.push(init.signal); init.signal.addEventListener('abort', () => reject(init.signal.reason)); }));
  page.listeners.document.visibilitychange();
  assert.equal(probes(), 1);
  page.listeners.window.online();
  assert.equal(probes(), 2, 'a forced check replaces the probe in flight');
  assert.equal(stuck[0].aborted && stuck[0].reason.name, 'AbortError');
  assert.equal(page.connection.snapshot().phase, 'live', 'replacing a probe is not a failure');
  await page.advance(CONNECTION.PROBE_TIMEOUT_MS);
  assert.equal(page.connection.snapshot().phase, 'offline', 'a probe nobody answers fails after the timeout');
});

// A response whose headers arrive and whose body then fails (a connection that drops mid-answer).
const brokenBody = () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('network error')); } }), { headers: json });
// A response whose headers arrive and whose body never does, until the request's signal aborts.
const stalledBody = (init) => new Response(new ReadableStream({ start(controller) {
  init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
} }), { headers: json });

test('an answer counts when its body is complete: headers followed by a failing or stalled body are not an answer, and neither flaps the state', async () => {
  const page = harness();
  const request = async (answer) => { page.respond(answer); const response = await page.connection.fetch('/api/current', {}); await response.text().catch(() => {}); await page.settle(); };
  await request(() => Promise.resolve(brokenBody()));
  assert.equal(page.connection.snapshot().phase, 'offline', 'a body that fails after good headers is no answer, not even the first');
  assert.equal(page.connection.snapshot().lastFailure.reason, 'Network error');
  await request(() => Promise.resolve(brokenBody()));
  await request(() => Promise.resolve(brokenBody()));
  assert.deepEqual(page.phases, ['connecting', 'offline'], 'repeated incomplete answers never show Live in between');
  await request(() => Promise.resolve(new Response('{}', { headers: json })));
  assert.equal(page.connection.snapshot().phase, 'live', 'a complete answer restores it');
  // A heartbeat that gets its headers and then stalls: no verdict until the probe timeout, then a failure.
  page.respond((init) => Promise.resolve(stalledBody(init)));
  await page.advance(CONNECTION.IDLE_CHECK_MS);
  assert.equal(page.sent.at(-1), '/probe');
  await page.advance(CONNECTION.PROBE_TIMEOUT_MS - 1);
  assert.equal(page.connection.snapshot().phase, 'live', 'no verdict before the timeout');
  await page.advance(1);
  assert.equal(page.connection.snapshot().phase, 'offline');
  assert.equal(page.connection.snapshot().lastFailure.reason, 'No answer in time');
  assert.equal(page.due(), CONNECTION.RETRY_FIRST_MS, 'and it is retried');
  page.respond(() => Promise.resolve(new Response('{}', { headers: json })));
  await page.advance(CONNECTION.RETRY_FIRST_MS);
  assert.equal(page.connection.snapshot().phase, 'live', 'the next complete answer restores it');
  // Cancelling while the body is read says nothing about the server.
  page.respond((init) => Promise.resolve(stalledBody(init)));
  const controller = new AbortController();
  const response = await page.connection.fetch('/api/current', { signal: controller.signal });
  controller.abort();
  await response.text().catch(() => {});
  await page.settle();
  assert.equal(page.connection.snapshot().phase, 'live');
});

test('a gateway status is an answer only when Manure produced it: JSON error pages of a gateway are not, its own error envelope and unavailable body are', async () => {
  const page = harness();
  const answerTo = async (path, status, body, init) => {
    page.respond(() => Promise.resolve(new Response(body, { status, headers: json })));
    const response = await page.connection.fetch(path, init);
    await response.text();
    await page.settle();
    return page.connection.snapshot().phase;
  };
  for (const status of [502, 503, 504]) {
    const fresh = harness();
    fresh.respond(() => Promise.resolve(new Response('{"error":"bad gateway","detail":"upstream"}', { status, headers: json })));
    await (await fresh.connection.fetch('/api/current', post(mine))).text();
    await fresh.settle();
    assert.equal(fresh.connection.snapshot().phase, 'offline', `a JSON ${status} page is Offline, even before any answer`);
  }
  assert.equal(await answerTo('/api/current', 503, envelope(mine), post(mine)), 'live', "Manure's own error envelope for this request");
  assert.equal(await answerTo('/api/current', 503, envelope(other), post(mine)), 'offline', 'an envelope for another request');
  assert.equal(await answerTo('/api/current', 503, envelope(nil), post(mine)), 'live', "Manure's unattributed overload answer");
  for (const status of [502, 504]) {
    assert.equal(await answerTo('/api/current', status, envelope(mine), post(mine)), 'offline', `Manure never answers ${status}`);
    await answerTo('/api/current', 200, '{}', undefined);
  }
  assert.equal(await answerTo('/api/current', 503, '{"requestId":"' + mine + '","result":{"Error":{"failure":{"code":"Nope"}}}}', post(mine)), 'offline', 'an envelope the codec rejects');
  const unavailable = '{"error":{"code":"unavailable","message":"unavailable"}}';
  assert.equal(await answerTo('/api/account/v1/login', 503, unavailable, { method: 'POST', body: '{}' }), 'live', "the account plane's unavailable answer");
  assert.equal(await answerTo('/api/account/v1/login', 503, envelope(nil), { method: 'POST', body: '{}' }), 'live', 'the overload answer on the account API');
  assert.equal(await answerTo('/api/account/v1/login', 503, envelope(other), { method: 'POST', body: '{}' }), 'offline');
  assert.equal(await answerTo('/api/account/v1/login', 503, '{"error":{"code":"upstream","message":"x"}}', { method: 'POST', body: '{}' }), 'offline');
  assert.equal(await answerTo('/api/account/v1/login', 502, unavailable, { method: 'POST', body: '{}' }), 'offline');
});
