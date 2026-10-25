import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightUtf8 } from '../src/highlight.ts';
test('BA: chunk offsets highlight original UTF-8 bytes without splitting Unicode', () => {
  assert.deepEqual(highlightUtf8('a猫🦄z', [{ start: 1, end: 8 }]), [
    { text: 'a', highlighted: false }, { text: '猫🦄', highlighted: true }, { text: 'z', highlighted: false },
  ]);
});
test('BA: invalid/out-of-range byte spans fail visibly instead of pointing at unrelated source', () => {
  assert.throws(() => highlightUtf8('猫', [{ start: 1, end: 3 }]), /UTF-8/);
  assert.throws(() => highlightUtf8('a', [{ start: 0, end: 2 }]), /range/);
});
test('BA: overlapping spans merge and plain transcript remains literal text', () => {
  assert.deepEqual(highlightUtf8('<script>', [{ start: 0, end: 3 }, { start: 2, end: 8 }]), [{ text: '<script>', highlighted: true }]);
});
