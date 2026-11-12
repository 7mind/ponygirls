import test from 'node:test';
import assert from 'node:assert/strict';
import { ExposureLedger } from '../.cache/worker/src/exposures.js';

test('ordinary turns without a delivery allocate no exposure state', () => {
  const ledger = new ExposureLedger(2);
  for (let index = 0; index < 100; index++) ledger.record([String(index)], []);
  assert.equal(ledger.size, 0);
});
test('exposure capacity rejects an entire tranche without a partial update', () => {
  const ledger = new ExposureLedger(2);
  ledger.record(['a'], ['receipt']);
  assert.throws(() => ledger.record(['b', 'c'], ['next']), /exposure-capacity/);
  assert.equal(ledger.size, 1);
  assert.deepEqual(ledger.get('b'), []);
});
test('exposure receipts are copied and incompatible reassociation is rejected', () => {
  const ledger = new ExposureLedger(2); const receipts = ['receipt'];
  ledger.record(['a'], receipts); receipts.push('not-observed');
  assert.deepEqual(ledger.get('a'), ['receipt']);
  ledger.record(['a'], ['receipt']);
  assert.throws(() => ledger.record(['a'], ['other']), /exposure-conflict/);
});
