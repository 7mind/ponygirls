// Specified contracts. Behavioral-Active Blackbox / Atomic; the links on rendered results are checked in search-serp.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContentView } from '../src/api.ts';
import { parseFragment } from '../src/router.ts';
import { sessionLanding, sessionLink, sessionPin } from '../src/session-link.ts';
function params(link: string) {
  const fragment = parseFragment(link);
  if (fragment.kind !== 'route') throw new Error('not a route');
  return fragment.route.params;
}
test('BA: a session link keeps the complete source pin; archive-only and published views of one revision differ', () => {
  const published = sessionLink('s1', new ContentView(3, 'generation-a'), { messageId: 'm9', find: 'a b' }), archiveOnly = sessionLink('s1', new ContentView(3, undefined), { messageId: 'm9', find: 'a b' });
  assert.notEqual(published, archiveOnly);
  assert.deepEqual(sessionPin(params(published)), new ContentView(3, 'generation-a')); assert.deepEqual(sessionPin(params(archiveOnly)), new ContentView(3, undefined));
  assert.deepEqual(sessionLanding(params(published)), { messageId: 'm9', find: 'a b' });
  assert.equal(sessionPin(params(sessionLink('s1', new ContentView(1, undefined), undefined))) !== null, true); assert.equal(sessionLanding(params(sessionLink('s1', new ContentView(1, undefined), undefined))), null);
});
test('BA: a malformed session pin is an error, a missing pin is none', () => {
  for (const link of ['#/session/s1?gen=g', '#/session/s1?rev=0', '#/session/s1?rev=x', '#/session/s1?rev=1.5', '#/session/s1?gen=&rev=1']) assert.throws(() => sessionPin(params(link)), /session link/);
  assert.equal(sessionPin(params('#/session/s1')), null);
});
