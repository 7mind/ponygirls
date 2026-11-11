import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJson } from '../.cache/fixtures/web/src/json.js';

test('ordinary, exact large, and signed numeric tokens retain their types and values', () => {
  assert.deepEqual(parseJson('[0,1,-1,1.5,1e3,9007199254740991,9007199254740993,-9223372036854775808]'), [0, 1, -1, 1.5, 1000, 9007199254740991, 9007199254740993n, -9223372036854775808n]);
});
for (const text of ['{"a":1,"a":1}', '{"a":[],"a":[]}', '{"a":null,"\\u0061":null}', '{"a":{"b":1,"b":1}}', '[{"a":"x","a":"x"}]', '{"__proto__":1,"__proto__":1}']) {
  test(`reject all duplicate keys: ${text}`, () => assert.throws(() => parseJson(text)));
}
test('nested arrays, object keys, escaped strings and punctuation do not confuse key detection', () => {
  assert.deepEqual(parseJson('{"a":["x",{"a":"quote\\\" and slash\\\\},:"}],"b":{"a":1}}'), { a: ['x', { a: 'quote" and slash\\},:' }], b: { a: 1 } });
});
test('prototype-named keys stay ordinary own data and never mutate prototypes', () => {
  const result = parseJson('{"__proto__":{"x":1},"constructor":{"prototype":{"y":2}}}');
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(result.x, undefined);
  assert.equal({}.y, undefined);
});
for (const text of ['[1,]', '{"a":}', '{1:2}', '{"a" 1}', '{"a":"unterminated}', '01', 'NaN', '1e9999', '9223372036854775808', '-9223372036854775809', '9007199254740993.0', '"bad\\escape"']) {
  test(`reject invalid or unsafe JSON: ${text}`, () => assert.throws(() => parseJson(text)));
}
test('depth is bounded without rejecting the documented boundary', () => {
  assert.doesNotThrow(() => parseJson('['.repeat(96) + '0' + ']'.repeat(96)));
  assert.throws(() => parseJson('['.repeat(97) + '0' + ']'.repeat(97)));
});
