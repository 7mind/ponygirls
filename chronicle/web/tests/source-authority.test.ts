// Specified contract of the source-authority notice. Behavioral-Active Blackbox / Atomic; Search's reactions are checked in search-serp.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContentView } from '../src/api.ts';
import { listenSourceUnavailable, readSourceUnavailable, reportSourceUnavailable, sourceFailureAffectsView, sourcePin, SOURCE_UNAVAILABLE_EVENT, type SourceUnavailable } from '../src/source-authority.ts';
const published = new ContentView(2, 'generation-a'), archiveOnly = new ContentView(2, undefined);
test('BA: a notice carries session, the pin of the failed read and its code, and is delivered unchanged', () => {
  const target = new EventTarget(), received: SourceUnavailable[] = [], stop = listenSourceUnavailable(target, detail => received.push(detail));
  const notice: SourceUnavailable = { origin: 'session', sessionId: 's1', view: sourcePin(published), code: 'forbidden', message: 'denied' };
  reportSourceUnavailable(target, notice); reportSourceUnavailable(target, { ...notice, view: sourcePin(archiveOnly), code: null }); reportSourceUnavailable(target, { ...notice, view: null });
  stop(); reportSourceUnavailable(target, notice);
  assert.deepEqual(received.map(item => [item.view, item.code]), [[{ revision: 2, generationId: 'generation-a' }, 'forbidden'], [{ revision: 2, generationId: null }, null], [null, 'forbidden']]);
});
test('BA: a malformed notice is rejected at the listener, not interpreted', () => {
  for (const detail of [null, {}, { origin: 'other', sessionId: 's', view: { revision: 1, generationId: null }, code: null, message: 'm' }, { origin: 'search', sessionId: '', view: { revision: 1, generationId: null }, code: null, message: 'm' },
    { origin: 'search', sessionId: 's', view: { revision: 1.5, generationId: null }, code: null, message: 'm' }, { origin: 'search', sessionId: 's', view: { revision: 1, generationId: 7 }, code: null, message: 'm' }])
    assert.throws(() => readSourceUnavailable(new CustomEvent(SOURCE_UNAVAILABLE_EVENT, { detail })), /source-unavailable notice/);
});
test('BA: authority codes concern every pin of the session, other failures only the pin that failed', () => {
  for (const code of ['forbidden', 'not-found', 'unauthorized', 'authorization-changed']) for (const failed of [new ContentView(9, 'x'), null]) assert.equal(sourceFailureAffectsView(failed, published, code), true);
  assert.equal(sourceFailureAffectsView(null, published, 'indexed-view-retired'), false, 'a failure of the default view names no pin');
  for (const code of ['indexed-view-retired', null]) {
    assert.equal(sourceFailureAffectsView(published, new ContentView(2, 'generation-a'), code), true);
    assert.equal(sourceFailureAffectsView(archiveOnly, published, code), false, 'same revision, archive-only versus published');
    assert.equal(sourceFailureAffectsView(new ContentView(3, 'generation-a'), published, code), false);
  }
});
