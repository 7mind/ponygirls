import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from '../src/uuid.ts';

// Regression: private HTTP origins expose getRandomValues but not crypto.randomUUID.
test('BA: UUIDv4 uses only the injected cryptographic random source and preserves entropy outside version/variant bits', () => {
  for (const byte of [0x00, 0xff, 0x55, 0xaa]) {
    let calls = 0;
    const source: Pick<Crypto, 'getRandomValues'> = {
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        assert.ok(array instanceof Uint8Array);
        assert.equal(array.length, 16);
        array.fill(byte); calls++;
        return array;
      },
    };
    const expected = new Uint8Array(16).fill(byte);
    expected[6] = (byte & 0x0f) | 0x40;
    expected[8] = (byte & 0x3f) | 0x80;
    const hex = Array.from(expected, n => n.toString(16).padStart(2, '0')).join('');
    assert.equal(randomUUID(source), `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
    assert.equal(calls, 1);
  }
});
test('BA: unavailable cryptographic entropy fails closed', () => {
  const failure = new Error('entropy unavailable');
  assert.throws(() => randomUUID({ getRandomValues() { throw failure; } }), error => error === failure);
});
