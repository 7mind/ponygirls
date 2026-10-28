import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentView, MessageSearchHit, SessionMessageSearchResult } from '../src/api.ts';
import { validateFindLiteral, validateFindPage, FIND_PAGE_SIZE, SessionFindReadGate } from '../src/session-find.ts';
const view = new ContentView(2, undefined);
test('BA specified: remount-shared Find permit has no queue and idempotent release', () => {
  const gate = new SessionFindReadGate(); let notices = 0; const unsubscribe = gate.subscribe(() => { notices++; });
  const release = gate.acquire(); assert.notEqual(release, null); assert.equal(gate.getSnapshot(), true); assert.equal(gate.acquire(), null);
  release!(); assert.equal(gate.getSnapshot(), false); const next = gate.acquire(); release!(); assert.equal(gate.getSnapshot(), true); next!(); assert.equal(notices, 4); unsubscribe();
});
test('BA specified: Find validates scalar UTF8 byte limits without trimming or interpreting literals', () => {
  for (const text of [' ', '\u0000', ' 猫🦄 %_\\ AND literal ', 'x'.repeat(2048), '\u0000'.repeat(2048), '🦄'.repeat(512)]) assert.doesNotThrow(() => validateFindLiteral(text));
  for (const text of ['', '\ud800', '\udc00', '\u0000'.repeat(2049), '🦄'.repeat(513)]) assert.throws(() => validateFindLiteral(text));
});
test('BA specified: Find accepts bounded immutable locator pages, including partial byte-budget pages', () => {
  const result = new SessionMessageSearchResult(view, [new MessageSearchHit('m1', 0)], 'signed-next');
  assert.equal(validateFindPage(result, view, undefined, -1, new Set(), new Set()), result);
  assert.doesNotThrow(() => validateFindPage(new SessionMessageSearchResult(view, [], undefined), view, undefined, -1, new Set(), new Set()));
});
test('BA specified: Find rejects pin mismatch, invalid locators, duplicate IDs, nonprogress and cursor cycles', () => {
  for (const result of [
    new SessionMessageSearchResult(new ContentView(3, undefined), [], undefined),
    new SessionMessageSearchResult(view, [new MessageSearchHit('', 1)], undefined),
    new SessionMessageSearchResult(view, [new MessageSearchHit('bad\u0000id', 1)], undefined),
    new SessionMessageSearchResult(view, [new MessageSearchHit('m1', 1)], 'bad\u0000cursor'),
    new SessionMessageSearchResult(view, [new MessageSearchHit('m1', -1)], undefined),
    new SessionMessageSearchResult(view, [new MessageSearchHit('m1', 1.5)], undefined),
    new SessionMessageSearchResult(view, [new MessageSearchHit('m1', 1), new MessageSearchHit('m1', 2)], undefined),
    new SessionMessageSearchResult(view, [new MessageSearchHit('m1', 2), new MessageSearchHit('m2', 1)], undefined),
    new SessionMessageSearchResult(view, Array.from({ length: FIND_PAGE_SIZE + 1 }, (_, index) => new MessageSearchHit(`m${index}`, index)), undefined),
    new SessionMessageSearchResult(view, [], 'next'),
    new SessionMessageSearchResult(view, [new MessageSearchHit('m1', 1)], ''),
    new SessionMessageSearchResult(view, [new MessageSearchHit('m1', 1)], 'sent'),
  ]) assert.throws(() => validateFindPage(result, view, 'sent', -1, new Set(), new Set()));
  assert.throws(() => validateFindPage(new SessionMessageSearchResult(view, [new MessageSearchHit('old', 8)], undefined), view, 'next', 7, new Set(['old']), new Set()));
  assert.throws(() => validateFindPage(new SessionMessageSearchResult(view, [new MessageSearchHit('new', 7)], undefined), view, 'next', 7, new Set(), new Set()));
  assert.throws(() => validateFindPage(new SessionMessageSearchResult(view, [new MessageSearchHit('new', 8)], 'old'), view, 'next', 7, new Set(), new Set(['old'])));
});
