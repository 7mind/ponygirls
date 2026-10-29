import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BaboonCodecContext, UserInfo, UserInfo_JsonCodec, Scope } from '../src/api.ts';
import { SessionRenewal, renewalDelay, type SessionScope } from '../src/session-renewal.ts';
import { Clock, Page } from './fakes.ts';

// Behavioral Blackbox Atomic: specified policy using a manual scheduler/lifecycle/HTTP adapter.
const alice: SessionScope = { accountId: 'alice', activeId: 1, generation: 1 };
function response(status: number, ttl: string | null, owner: string) {
  return new Response(JSON.stringify(UserInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, new UserInfo(owner, owner, [Scope.Read]))), { status, headers: ttl === null ? {} : { 'X-Chronicle-Session-Ttl-Seconds': ttl } });
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function rig() {
  const clock = new Clock(), page = new Page(), errors: (string | null)[] = [];
  const requests: { url: string; init: RequestInit; resolve: (value: Response) => void; reject: (cause: Error) => void }[] = [];
  let unauthorized = 0, changed = 0;
  const renewal = new SessionRenewal({
    fetch: ((url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => requests.push({ url, init, resolve, reject }))) as typeof fetch,
    scheduler: clock, lifecycle: page, error: error => errors.push(error),
    unauthorized: () => unauthorized++, accountChanged: () => changed++,
  });
  return { clock, page, errors, requests, renewal, unauthorized: () => unauthorized, changed: () => changed };
}
test('TTL validation is strict, positive, integer bounded; intervals never overflow or loop at zero', () => {
  assert.equal(renewalDelay('2592000'), 86400000); assert.equal(renewalDelay('1'), 500); assert.equal(renewalDelay('2147483647'), 86400000);
  for (const header of [null, '', '0', '-1', '1.5', 'Infinity', '2147483648', '1e3', ' 30', '30 ', '01']) assert.throws(() => renewalDelay(header), /invalid TTL/);
});
test('initial cookie-only renewal, half TTL cadence and no overlapping requests', async () => {
  const r = rig(); r.renewal.setScope(alice); assert.equal(r.requests.length, 1);
  assert.equal(r.requests[0]!.url, '/api/session/refresh'); assert.equal(r.requests[0]!.init.method, 'POST'); assert.equal(r.requests[0]!.init.credentials, 'same-origin'); assert.equal(r.requests[0]!.init.body, undefined);
  r.page.emit('focus'); r.renewal.retry(); assert.equal(r.requests.length, 1);
  r.requests[0]!.resolve(response(200, '2', 'alice')); await flush();
  r.clock.advance(999); assert.equal(r.requests.length, 1); r.clock.advance(1); assert.equal(r.requests.length, 2);
  r.requests[1]!.resolve(response(200, '2592000', 'alice')); await flush(); r.clock.advance(86400000 - 1); assert.equal(r.requests.length, 2);
  r.clock.advance(1); assert.equal(r.requests.length, 3); r.renewal.dispose(); await flush(); assert.equal(r.clock.timers.size, 0);
});
test('hidden/frozen/pagehide pause; return when overdue renews once, not catch-up bursts', async () => {
  for (const [pause, wake] of [['hidden', 'visible'], ['freeze', 'resume'], ['pagehide', 'pageshow']] as const) {
    const r = rig(); r.renewal.setScope(alice); r.requests[0]!.resolve(response(200, '2', 'alice')); await flush();
    r.page.emit(pause); r.clock.advance(10 * 86400000); assert.equal(r.requests.length, 1);
    r.page.emit(wake); assert.equal(r.requests.length, 2); r.page.emit('focus'); assert.equal(r.requests.length, 2);
    r.requests[1]!.resolve(response(200, '2', 'alice')); await flush(); assert.equal(r.requests.length, 2);
    r.renewal.dispose(); await flush(); assert.equal(r.page.listeners.size, 0); assert.equal(r.clock.timers.size, 0);
  }
});
test('HTTP 401 alone is terminal; HTTP 403/500/network/missing header are explicit failures with manual retry', async () => {
  for (const failure of [response(401, '2592000', 'alice'), response(403, '2592000', 'alice'), response(500, '2592000', 'alice'), response(200, null, 'alice'), new Error('Network unavailable')]) {
    const r = rig(); r.renewal.setScope(alice);
    if (failure instanceof Error) r.requests[0]!.reject(failure); else r.requests[0]!.resolve(failure);
    await flush(); const terminal = failure instanceof Response && failure.status === 401;
    assert.equal(r.unauthorized(), terminal ? 1 : 0); assert.equal(r.changed(), 0);
    if (!terminal) assert.ok(r.errors.at(-1));
    r.clock.advance(7 * 86400000); r.page.emit('focus'); assert.equal(r.requests.length, 1);
    r.renewal.retry(); assert.equal(r.requests.length, terminal ? 1 : 2);
    r.renewal.dispose(); await flush();
  }
});
test('both stalled headers and stalled response body time out visibly and permit one retry', async () => {
  for (const body of [false, true]) {
    const r = rig(); r.renewal.setScope(alice);
    if (body) r.requests[0]!.resolve({ ok: true, status: 200, headers: new Headers({ 'X-Chronicle-Session-Ttl-Seconds': '30' }), json: () => new Promise(() => {}) } as Response);
    await flush(); r.clock.advance(15000); await flush(); assert.match(r.errors.at(-1)!, /timed out/); assert.equal(r.unauthorized(), 0);
    r.renewal.retry(); assert.equal(r.requests.length, 2); r.renewal.dispose(); await flush();
  }
});
test('cookie account mismatch forces revalidation, never commits another owner', async () => {
  const r = rig(); r.renewal.setScope(alice); r.requests[0]!.resolve(response(200, '30', 'bob')); await flush();
  assert.equal(r.changed(), 1); assert.equal(r.unauthorized(), 0); r.renewal.retry(); r.clock.advance(86400000); assert.equal(r.requests.length, 1); r.renewal.dispose();
});
test('late success, unauthorized, mismatch and failures cannot cross credential/socket/account generations or disposal', async () => {
  for (const late of [response(200, '2592000', 'alice'), response(401, '2592000', 'alice'), response(200, '30', 'bob'), new Error('Late failure')]) {
    for (const replacement of [null, { ...alice, generation: 2, activeId: 2 }, { ...alice, accountId: 'bob', generation: 2 }, 'dispose'] as const) {
      const r = rig(); r.renewal.setScope(alice);
      if (replacement === 'dispose') r.renewal.dispose(); else r.renewal.setScope(replacement);
      await flush(); const errors = [...r.errors];
      if (late instanceof Error) r.requests[0]!.reject(late); else r.requests[0]!.resolve(late);
      await flush(); assert.deepEqual(r.errors, errors); assert.equal(r.unauthorized(), 0); assert.equal(r.changed(), 0);
      assert.equal(r.requests.length, replacement === null || replacement === 'dispose' ? 1 : 2);
      r.renewal.dispose(); await flush(); assert.equal(r.clock.timers.size, 0);
    }
  }
});

// Regression: availability warning must not survive a later definitive auth/account outcome.
test('old availability warning clears before unauthorized or account mismatch is published', async () => {
  for (const status of [401, 200]) {
    const errors: (string | null)[] = [], observed: (string | null | undefined)[] = [];
    let fail = true;
    const renewal = new SessionRenewal({
      fetch: (async () => fail ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(UserInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, new UserInfo('bob', 'bob', [Scope.Read]))), { status, headers: { 'X-Chronicle-Session-Ttl-Seconds': '30' } })) as typeof fetch,
      scheduler: new Clock(), lifecycle: new Page(), error: error => errors.push(error),
      unauthorized: () => observed.push(errors.at(-1)), accountChanged: () => observed.push(errors.at(-1)),
    });
    renewal.setScope({ accountId: 'alice', generation: 1, activeId: 1 });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.match(errors.at(-1)!, /HTTP 500/);
    fail = false; renewal.retry();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.deepEqual(observed, [null], 'clear stale availability warning before publishing definitive outcome');
    renewal.dispose();
  }
});
