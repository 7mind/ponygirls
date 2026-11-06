import assert from 'node:assert/strict';
import test from 'node:test';
import { constrainOutput, OUTPUT_SCHEMA, validateOutput } from '../src/output.ts';

const claim = { section: 'observation', basis: 'observed', text: 'Synthetic observation', evidence: ['e'] };
const proposal = { episodeId: null, expectedRevision: 0, title: 'Synthetic test', kind: 'experiment', status: 'ongoing', claims: [claim] };
test('v2 output rejects old arrays, unknown nested keys and invalid references without salvage', () => {
  assert.deepEqual(validateOutput({ proposals: [] }, new Set()), []);
  assert.deepEqual(validateOutput({ proposals: [proposal] }, new Set(['e'])), [proposal]);
  for (const value of [[], { proposals: [], extra: true }, { proposals: [{ ...proposal, extra: true }] },
    { proposals: [{ ...proposal, claims: [{ ...claim, extra: true }] }] }]) {
    assert.throws(() => validateOutput(value, new Set(['e'])));
  }
  assert.throws(() => validateOutput({ proposals: [proposal] }, new Set()), /evidence/);
});
test('schema injection preserves request fields and rejects unexpected payload shapes', () => {
  const input = { model: 'gpt-6.1-sol', text: { verbosity: 'low' }, input: ['synthetic'], stream: true };
  const output = constrainOutput(input);
  assert.deepEqual(output, { ...input, text: { verbosity: 'low', format: { type: 'json_schema', name: 'historian_proposals_v2', strict: true, schema: OUTPUT_SCHEMA } } });
  assert.deepEqual(input.text, { verbosity: 'low' });
  assert.throws(() => constrainOutput(null)); assert.throws(() => constrainOutput({ text: [] }));
});
