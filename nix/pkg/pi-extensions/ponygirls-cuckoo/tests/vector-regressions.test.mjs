import test from 'node:test';
import assert from 'node:assert/strict';
import { createIndex, addRow, query, textDigest, encoderIdentityKey, validateVector, cosineSimilarity } from '../src/experiments/vector-memory.ts';

function context() {
  return { signal: undefined, deadlineMs: Date.now() + 5000 };
}
function fixture() {
  const identity = { identifier: 'fixture', model: 'fixture', version: '1', dimensions: 3, normalization: 'unit', implementationDigest: 'fixture-implementation', configDigest: 'fixture-config' };
  const key = encoderIdentityKey(identity);
  const input = { rowId: 'row', recordId: 'r', taskId: 't', projectId: 'p', sessionId: 's', branch: 'b', status: 'active', text: 'text', digest: textDigest('text'), indexedAt: '2026-11-12T00:00:00.000Z' };
  const request = { text: 'query', taskId: 't', projectId: 'p', sessionId: 's', branch: 'b', topK: 1, includeStatuses: ['active'] };
  const grant = { projectId: 'p', sessionId: 's', branch: 'b', taskIds: ['t'], recordApprovals: [{ recordId: 'r', digest: input.digest }], encoderKeys: [key], allowQueryText: true, queryDigests: [textDigest(request.text)], revokedRecordIds: [], expiresAtMs: undefined, revoked: false };
  const records = [{ recordId: 'r', taskId: 't', digest: input.digest, status: 'active' }];
  const live = { grant, records }; let reads = 0;
  const authority = { current() { reads++; return { grant: live.grant, records: live.records }; } };
  const encoder = { identity, async encode() { return [1, 0, 0]; } };
  const index = createIndex({ encoderKey: key, dimensions: 3, normalization: 'unit', maxRows: 10, maxTopK: 10 });
  return { identity, grant, input, request, encoder, index, records, live, authority, authorityReads: () => reads };
}

// Regression-origin Behavioral-Active / Blackbox-Group. Synthetic vectors only.
test('an approval with a new digest makes the old index explicitly stale', async () => {
  const f = fixture();
  const index = await addRow(f.index, f.input, f.encoder, f.authority, context());
  f.grant.recordApprovals = [{ recordId: 'r', digest: textDigest('changed') }];
  await assert.rejects(query(index, f.request, f.encoder, f.authority, context()), { code: 'DIGEST_MISMATCH' });
});

test('current projection supersedes cached active status without re-embedding', async () => {
  const f = fixture();
  const index = await addRow(f.index, f.input, f.encoder, f.authority, context());
  const current = { current: () => ({ grant: f.live.grant, records: [{ recordId: 'r', taskId: 't', digest: f.input.digest, status: 'superseded' }] }) };
  const result = await query(index, f.request, f.encoder, current, context());
  assert.deepEqual(result.candidates, []);
});

test('revocation during encoding prevents index publication', async () => {
  const f = fixture();
  const encoder = { identity: f.identity, async encode() { f.grant.revoked = true; return [1, 0, 0]; } };
  await assert.rejects(addRow(f.index, f.input, encoder, f.authority, context()), { code: 'GRANT_REVOKED' });
});

test('the deadline bounds waiting even when the encoder ignores cancellation', async () => {
  const f = fixture();
  const index = await addRow(f.index, f.input, f.encoder, f.authority, context());
  const encoder = { identity: f.identity, async encode() { return new Promise(() => {}); } };
  let timer;
  const guard = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('module deadline was not enforced')), 3000); });
  try {
    await assert.rejects(Promise.race([
      query(index, f.request, encoder, f.authority, { signal: undefined, deadlineMs: Date.now() + 50 }), guard,
    ]), { code: 'DEADLINE_EXCEEDED' });
  } finally { clearTimeout(timer); }
});

test('oversized result metadata is rejected before encoding', async () => {
  const f = fixture(); let calls = 0;
  const encoder = { identity: f.identity, async encode() { calls++; return [1, 0, 0]; } };
  await assert.rejects(addRow(f.index, { ...f.input, indexedAt: 'x'.repeat(1000000) }, encoder, f.authority, context()));
  assert.equal(calls, 0);
});

test('query validates stored vector dimensions and finite nonzero norms', async () => {
  const f = fixture();
  const index = await addRow(f.index, f.input, f.encoder, f.authority, context());
  for (const vector of [[1, 0], [NaN, 0, 0], [0, 0, 0]]) {
    const invalid = { ...index, rows: [{ ...index.rows[0], vector }] };
    await assert.rejects(query(invalid, f.request, f.encoder, f.authority, context()));
  }
});

test('fresh authority getter observes a replacement grant during encoding', async () => {
  const f = fixture();
  const index = await addRow(f.index, f.input, f.encoder, f.authority, context());
  const original = f.live.grant; const readsBefore = f.authorityReads();
  let release; const pending = new Promise(resolve => { release = resolve; });
  let started; const entered = new Promise(resolve => { started = resolve; });
  const encoder = { identity: f.identity, async encode() { started(); return await pending; } };
  const rejected = assert.rejects(query(index, f.request, encoder, f.authority, context()), { code: 'GRANT_REVOKED' });
  await entered;
  f.live.grant = { ...original, revoked: true };
  assert.equal(original.revoked, false);
  release([1, 0, 0]);
  await rejected;
  assert.ok(f.authorityReads() >= readsBefore + 2);
});

test('encoder identity drift during encoding rejects publication', async () => {
  const f = fixture();
  const encoder = { identity: { ...f.identity }, async encode() { encoder.identity = { ...encoder.identity, configDigest: 'changed-config' }; return [1, 0, 0]; } };
  await assert.rejects(addRow(f.index, f.input, encoder, f.authority, context()), { code: 'ENCODER_MISMATCH' });
});

test('exact query approval is required before transmission', async () => {
  const f = fixture(); let calls = 0;
  const index = await addRow(f.index, f.input, f.encoder, f.authority, context());
  const encoder = { identity: f.identity, async encode() { calls++; return [1, 0, 0]; } };
  await assert.rejects(query(index, { ...f.request, text: 'not granted' }, encoder, f.authority, context()), { code: 'QUERY_TEXT_DENIED' });
  assert.equal(calls, 0);
});

for (const operation of ['index', 'query']) {
  test(`${operation}: no transmission occurs under a grant revoked before client handoff`, async () => {
    const f = fixture();
    const index = await addRow(f.index, f.input, f.encoder, f.authority, context());
    const transmissions = [];
    const encoder = { identity: f.identity, async encode(text) { transmissions.push({ text, revoked: f.live.grant.revoked }); return [1, 0, 0]; } };
    const pending = operation === 'index'
      ? addRow(f.index, f.input, encoder, f.authority, context())
      : query(index, f.request, encoder, f.authority, context());
    const rejected = assert.rejects(pending, { code: 'GRANT_REVOKED' });
    f.live.grant = { ...f.live.grant, revoked: true };
    await rejected;
    assert.ok(transmissions.every(item => !item.revoked), 'all client handoffs must still be authorized');
  });
}

test('subnormal squared magnitudes do not corrupt cosine similarity', () => {
  assert.deepEqual(validateVector([2e-162], 1), [2e-162]);
  assert.ok(Math.abs(cosineSimilarity([2e-162], [2e-162]) - 1) < 1e-12);
});

test('representable finite norms remain usable across the numeric range', () => {
  for (const vector of [[1e-200], [Number.MIN_VALUE], [Number.MIN_VALUE, Number.MIN_VALUE], [1e200]]) {
    assert.deepEqual(validateVector(vector, vector.length), vector);
    assert.ok(Math.abs(cosineSimilarity(vector, vector) - 1) < 1e-12);
  }
  assert.throws(() => validateVector([Number.MAX_VALUE, Number.MAX_VALUE], 2), { code: 'VECTOR_OVERFLOW' });
});

test('successful tiny-vector indexing produces a queryable unit-space index', async () => {
  const f = fixture(); const identity = { ...f.identity, dimensions: 1 };
  const key = encoderIdentityKey(identity); f.grant.encoderKeys = [key];
  const encoder = { identity, async encode() { return [2e-162]; } };
  const empty = createIndex({ ...f.index.config, encoderKey: key, dimensions: 1 });
  const index = await addRow(empty, f.input, encoder, f.authority, context());
  const result = await query(index, f.request, encoder, f.authority, context());
  assert.equal(result.candidates[0].recordId, 'r');
  assert.ok(Math.abs(result.candidates[0].score - 1) < 1e-12);
});
