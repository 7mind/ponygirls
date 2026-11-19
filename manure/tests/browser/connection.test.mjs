// The connection state of the dashboard (common.js createConnection) with a controlled clock and transport:
// what counts as an answer, the heartbeat schedule and its back-off, and what a hidden tab does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTION, createConnection } from '../../web/dashboard/common.js';

const json = { 'Content-Type': 'application/json' };

// A page with a fake clock whose timers fire in order, a visibility state, listeners, and a scripted network.
function harness() {
  let time = 0, nextId = 1;
  const timers = new Map(), listeners = { document: {}, window: {} }, sent = [];
  const target = (name) => ({ addEventListener: (type, listener) => { listeners[name][type] = listener; } });
  const document = { ...target('document'), visibilityState: 'visible' };
  const window = {
    ...target('window'), AbortController, DOMException,
    setTimeout: (callback, ms) => { const id = nextId++; timers.set(id, { callback, at: time + ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  let answer = () => Promise.resolve(new Response('{}', { headers: json }));
  const fetch = (url, init) => { sent.push(url); return answer(init); };
  // Heartbeats go through the fetch they are given, like the real probe.
  const probe = (observed, signal) => observed('/probe', { signal });
  const connection = createConnection({ fetch, document, window, now: () => time, probe });
  connection.start();
  return {
    connection, document, window, sent, listeners,
    respond: (next) => { answer = next; },
    due: () => connection.snapshot().nextCheckAt - time,
    // Advances the clock and lets the promises the fired timers started settle.
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const [id, timer] = [...timers].sort(([, a], [, b]) => a.at - b.at)[0] ?? [];
        if (timer === undefined || timer.at > end) { break; }
        timers.delete(id); time = timer.at; timer.callback();
        await new Promise((resolve) => setImmediate(resolve));
      }
      time = end;
    },
  };
}
const refused = () => Promise.reject(new TypeError('Failed to fetch'));

test('an answer of any kind is a connection, a refusal, a gateway page or a timeout is not, and a cancelled request is neither', async () => {
  const page = harness();
  const request = (answer) => { page.respond(answer); return page.connection.fetch('/api/current', {}).catch(() => {}); };
  assert.equal(page.connection.snapshot().phase, 'connecting', 'nothing is live before the first answer');
  await request(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
  assert.equal(page.connection.snapshot().phase, 'connecting', 'a cancelled request tells nothing');
  await request(() => Promise.resolve(new Response('{}', { status: 401, headers: json })));
  assert.equal(page.connection.snapshot().phase, 'live', 'a 401 is an answer');
  await request(() => Promise.resolve(new Response('{}', { status: 503, headers: json })));
  assert.equal(page.connection.snapshot().phase, 'live', 'an application error is an answer');
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
  await page.advance(CONNECTION.IDLE_CHECK_MS - 1);
  assert.equal(probes(), before, 'another request postponed the heartbeat');
  await page.advance(1);
  assert.equal(probes(), before + 1);
});

test('a hidden tab has no heartbeat; showing it, the browser coming online or Check now probes at once and replaces a stuck probe', async () => {
  const page = harness();
  await page.connection.fetch('/api/current', {});
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
