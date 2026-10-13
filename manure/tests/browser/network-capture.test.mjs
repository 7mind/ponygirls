import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { captureNetwork } from './network-capture.mjs';

const request = (id, url = 'http://dashboard/api/grants') => ({requestId: id,
  request: {url, method: 'POST', headers: {'Content-Type': 'text/plain'}}});
const reqExtra = id => ({requestId: id, headers: {Origin: 'http://hostile', Cookie: 'sent=SECRET'},
  associatedCookies: [{cookie: {name: 'sent'}, blockedReasons: []},
    {cookie: {name: 'withheld'}, blockedReasons: ['SameSiteStrict']}]});
const respExtra = id => ({requestId: id, statusCode: 403,
  headers: {'Set-Cookie': 'session=SECRET; HttpOnly'}});
const response = id => ({requestId: id, response: {url: 'http://dashboard/api/grants',
  status: 403, headers: {}}});
function run(events) {
  const cdp = new EventEmitter(), ctx = {requests: [], responses: []};
  captureNetwork(cdp, ctx);
  for (const [name, event] of events) cdp.emit(`Network.${name}`, event);
  return ctx;
}
for (const early of [false, true]) {
  for (const mainResponse of [false, true]) {
    test(`CORS capture extras ${early ? 'before' : 'after'} main; response=${mainResponse}`, () => {
      const events = early ? [['requestWillBeSentExtraInfo', reqExtra('1')],
        ['responseReceivedExtraInfo', respExtra('1')], ['requestWillBeSent', request('1')]] :
        [['requestWillBeSent', request('1')], ['requestWillBeSentExtraInfo', reqExtra('1')],
          ...(mainResponse ? [['responseReceived', response('1')]] : []),
          ['responseReceivedExtraInfo', respExtra('1')]];
      if (early && mainResponse) events.push(['responseReceived', response('1')]);
      events.push(['loadingFailed', {requestId: '1', errorText: 'net::ERR_FAILED'}]);
      const ctx = run(events);
      assert.equal(ctx.requests[0].origin, 'http://hostile');
      assert.deepEqual(ctx.requests[0].cookieNames, ['sent']);
      assert.deepEqual(ctx.requests[0].blockedCookieNames, ['withheld']);
      assert.equal(ctx.requests[0].loadFailed.errorText, 'net::ERR_FAILED');
      assert.equal(ctx.responses.length, 1);
      assert.equal(ctx.responses[0].url, 'http://dashboard/api/grants');
      assert.equal(ctx.responses[0].status, 403);
      assert.deepEqual(ctx.responses[0].setCookieNames, ['session']);
      assert.ok(!JSON.stringify(ctx).includes('SECRET'));
    });
  }
}
test('request IDs belong to a CDP session, not the whole browser', () => {
  const ctx = {requests: [], responses: []};
  const a = new EventEmitter(), b = new EventEmitter();
  captureNetwork(a, ctx); captureNetwork(b, ctx);
  a.emit('Network.requestWillBeSent', request('1', 'http://a'));
  b.emit('Network.requestWillBeSentExtraInfo', reqExtra('1'));
  b.emit('Network.responseReceivedExtraInfo', respExtra('1'));
  b.emit('Network.requestWillBeSent', request('1', 'http://b'));
  assert.equal(ctx.requests[0].origin, null);
  assert.equal(ctx.requests[1].origin, 'http://hostile');
  assert.equal(ctx.responses[0].url, 'http://b');
});
for (const extraFirst of [false, true]) {
  test(`redirect ID reuse preserves hops; next extras early=${extraFirst}`, () => {
    const cdp = new EventEmitter(), ctx = {requests: [], responses: []};
    captureNetwork(cdp, ctx);
    const emit = (name, value) => cdp.emit(`Network.${name}`, value);
    emit('requestWillBeSent', request('r', 'http://first'));
    emit('requestWillBeSentExtraInfo', {...reqExtra('r'), headers: {Origin: 'http://first-origin'}});
    emit('responseReceivedExtraInfo', {...respExtra('r'), statusCode: 302});
    if (extraFirst) {
      emit('requestWillBeSentExtraInfo', reqExtra('r'));
      emit('responseReceivedExtraInfo', respExtra('r'));
    }
    emit('requestWillBeSent', {...request('r', 'http://second'), redirectHasExtraInfo: true,
      redirectResponse: {url: 'http://first', status: 302, headers: {}}});
    if (!extraFirst) {
      emit('requestWillBeSentExtraInfo', reqExtra('r'));
      emit('responseReceivedExtraInfo', respExtra('r'));
    }
    emit('responseReceived', {requestId: 'r', hasExtraInfo: true,
      response: {url: 'http://second', status: 403, headers: {}}});
    assert.deepEqual(ctx.requests.map(r => [r.url, r.origin]),
      [['http://first', 'http://first-origin'], ['http://second', 'http://hostile']]);
    assert.deepEqual(ctx.responses.map(r => [r.url, r.status]),
      [['http://first', 302], ['http://second', 403]]);
  });
}
test('redirect without ExtraInfo does not consume next hop extras', () => {
  const ctx = run([
    ['requestWillBeSent', request('r', 'http://cached')],
    ['requestWillBeSentExtraInfo', reqExtra('r')],
    ['responseReceivedExtraInfo', respExtra('r')],
    ['requestWillBeSent', {...request('r', 'http://dashboard/api/grants'),
      redirectHasExtraInfo: false, redirectResponse: {url: 'http://cached', status: 302, headers: {}}}],
    ['responseReceived', {...response('r'), hasExtraInfo: true}],
  ]);
  assert.deepEqual(ctx.requests.map(r => r.origin), [null, 'http://hostile']);
  assert.deepEqual(ctx.responses.map(r => [r.url, r.status]),
    [['http://cached', 302], ['http://dashboard/api/grants', 403]]);
});
