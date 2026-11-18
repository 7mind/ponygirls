// Specified contracts. Behavioral-Active Blackbox / Atomic; the links on rendered results are checked in search-serp.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InvalidSessionAddress, formatRoute, parseFragment, sessionPlaceOf, sessionPlaceRoute, type SessionPin } from '../src/router.ts';
function place(link: string) {
  const fragment = parseFragment(link);
  if (fragment.kind !== 'route') throw new Error('not a route');
  return sessionPlaceOf(fragment.route);
}
const link = (pin: SessionPin, at: string | null, find: string | null) => formatRoute(sessionPlaceRoute('s1', { pin, at, find, pane: null, passage: null }));
test('BA: a session link keeps the complete source pin; archive-only and published views of one revision differ', () => {
  const published = link({ revision: 3, generationId: 'generation-a' }, 'm9', 'a b'), archiveOnly = link({ revision: 3, generationId: null }, 'm9', 'a b');
  assert.notEqual(published, archiveOnly);
  assert.deepEqual(place(published), { pin: { revision: 3, generationId: 'generation-a' }, at: 'm9', find: 'a b', pane: null, passage: null });
  assert.deepEqual(place(archiveOnly).pin, { revision: 3, generationId: null });
  assert.deepEqual(place(link({ revision: 1, generationId: null }, null, null)), { pin: { revision: 1, generationId: null }, at: null, find: null, pane: null, passage: null });
});
test('BA: a malformed session pin is an error, a missing pin is none', () => {
  for (const address of ['#/session/s1?gen=g', '#/session/s1?rev=0', '#/session/s1?rev=x', '#/session/s1?rev=1.5', '#/session/s1?rev=', '#/session/s1?gen=&rev=1']) assert.throws(() => place(address), InvalidSessionAddress);
  assert.equal(place('#/session/s1').pin, null);
});
