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
test('BA regression: source highlighting preserves BOM scalars at body and segment starts without normalization', () => {
  for (const text of ['\uFEFFx', 'a\uFEFFx', '\uFEFF\uFEFF猫', '\uFEFF猫🦄', '\u0000\uFEFFz']) {
    const scalars = [...text], boundaries = [0];
    for (const scalar of scalars) boundaries.push(boundaries.at(-1)! + new TextEncoder().encode(scalar).length);
    for (let first = 0; first < boundaries.length; first++) for (let last = first; last < boundaries.length; last++) {
      const parts = highlightUtf8(text, [{ start: boundaries[first]!, end: boundaries[last]! }]);
      assert.equal(parts.map(part => part.text).join(''), text, `literal source changed at scalar range [${first},${last})`);
      assert.equal(parts.filter(part => part.highlighted).map(part => part.text).join(''), scalars.slice(first, last).join(''));
    }
    assert.equal(highlightUtf8(text, []).map(part => part.text).join(''), text);
  }
});
test('BA regression: BOM is a scalar, not a permission to accept split UTF-8 endpoints', () => {
  for (const range of [{ start: 1, end: 3 }, { start: 0, end: 2 }, { start: 2, end: 2 }]) assert.throws(() => highlightUtf8('\uFEFFx', [range]), /UTF-8 boundary/);
});
