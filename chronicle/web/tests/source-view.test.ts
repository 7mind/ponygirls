import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContentView } from '../src/api.ts';
import { sameContentView, requireContentView, contentViewKey } from '../src/source-view.ts';
const GENERATION_ONE = '00000000-0000-4000-8000-000000000001';
const GENERATION_TWO = '00000000-0000-4000-8000-000000000002';
test('BA: source identity includes both immutable revision and annotation generation', () => {
  const view = new ContentView(1, GENERATION_ONE);
  assert.equal(sameContentView(view, new ContentView(1, GENERATION_ONE)), true);
  assert.equal(sameContentView(view, new ContentView(2, GENERATION_ONE)), false);
  assert.equal(sameContentView(view, new ContentView(1, GENERATION_TWO)), false);
});
test('BA: archive-only and published views at the same revision are not interchangeable', () => {
  const archive = new ContentView(2, undefined), published = new ContentView(2, GENERATION_TWO);
  assert.equal(sameContentView(archive, published), false);
  assert.notEqual(contentViewKey(archive), contentViewKey(published));
  assert.notEqual(contentViewKey(undefined), contentViewKey(archive));
});
test('BA: mismatched server response pins fail before source text can be attributed', () => {
  const expected = new ContentView(1, GENERATION_ONE);
  assert.doesNotThrow(() => requireContentView(expected, new ContentView(1, GENERATION_ONE)));
  assert.throws(() => requireContentView(expected, new ContentView(1, GENERATION_TWO)), /revision or annotation generation/);
  assert.throws(() => requireContentView(expected, new ContentView(2, GENERATION_ONE)), /revision or annotation generation/);
});
