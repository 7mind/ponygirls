// X2 workflow tests. The deterministic encoder fixtures below establish workflow,
// bounds, filtering and ranking mechanics only — NOT semantic relevance. A trusted live
// encoder (probe run by the parent) is required separately to assess semantic quality;
// if unavailable, that must be reported, never faked. No credential/endpoint values live here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createIndex, addRow as addRowRaw, query as queryRaw, textDigest, encoderIdentityKey, validateVector, cosineSimilarity,
  VectorMemoryError, MAX_INDEX_ROWS, MAX_TOP_K, MAX_VECTOR_DIMENSIONS, MAX_INDEX_TEXT_CHARS, MAX_QUERY_TEXT_CHARS,
} from '../src/experiments/vector-memory.ts';

const NO_CTX = Symbol('fresh fixture work context');
function workContext(value) {
  return value === NO_CTX ? { signal: undefined, deadlineMs: Date.now() + 5000 } : value;
}

// Unchanged synthetic cases supply a fixed host projection; changing-status
// regressions use an independent current projection in vector-regressions.test.mjs.
function fixtureAuthority(grant, index, pending, queryText) {
  return {
    current() {
      const records = index.rows.filter(row => row.projectId === grant.projectId &&
        row.sessionId === grant.sessionId && row.branch === grant.branch).map(row => ({
        recordId: row.recordId, taskId: row.taskId, digest: row.contentDigest, status: row.status,
      }));
      if (pending !== undefined) {
        const position = records.findIndex(record => record.recordId === pending.recordId);
        const record = { recordId: pending.recordId, taskId: pending.taskId, digest: pending.digest, status: pending.status };
        if (position === -1) records.push(record); else records[position] = record;
      }
      return { grant: { ...grant, queryDigests: queryText === undefined ? [] : [textDigest(queryText)] }, records };
    },
  };
}
async function addRow(index, selected, encoder, grant, context) {
  return await addRowRaw(index, selected, encoder, fixtureAuthority(grant, index, selected, undefined), workContext(context));
}
async function query(index, request, encoder, grant, context) {
  return await queryRaw(index, request, encoder, fixtureAuthority(grant, index, undefined, request.text), workContext(context));
}

function encIdentity(overrides) {
  return {
    identifier: 'fixture-vectors', model: 'fixture-model', version: '1',
    dimensions: 3, normalization: 'unit',
    implementationDigest: 'i'.repeat(64), configDigest: 'c'.repeat(64),
    ...(overrides === undefined ? {} : overrides),
  };
}

function makeEncoder(identity, fn) {
  const calls = [];
  const encoder = {
    identity,
    encode: async (text, ctx) => { calls.push({ text, ctx }); return fn(text, ctx); },
  };
  return { encoder, calls };
}

function makeEnv(overrides, map) {
  const identity = encIdentity(overrides);
  const key = encoderIdentityKey(identity);
  const config = { encoderKey: key, dimensions: identity.dimensions, normalization: identity.normalization, maxRows: 100, maxTopK: 20 };
  const grant = {
    projectId: 'proj', sessionId: 'sess', branch: 'b1', taskIds: ['t1'],
    recordApprovals: [], encoderKeys: [key], allowQueryText: true,
    revokedRecordIds: [], expiresAtMs: undefined, revoked: false,
  };
  if (map === undefined) throw new Error('makeEnv requires a text->vector map for the deterministic fixture encoder');
  const { encoder, calls } = makeEncoder(identity, text => { const v = map.get(text); if (v === undefined) throw new Error(`no fixture vector: ${text}`); return v.slice(); });
  return { encoder, calls, config, grant, identity, key };
}

function approve(grant, recordId, text) { grant.recordApprovals.push({ recordId, digest: textDigest(text) }); }

function input(overrides) {
  return {
    rowId: 'r1', recordId: 'rec1', taskId: 't1', projectId: 'proj', sessionId: 'sess',
    branch: 'b1', status: 'active', text: 'alpha', digest: textDigest('alpha'), indexedAt: '2026-01-01T00:00:00Z',
    ...(overrides === undefined ? {} : overrides),
  };
}

const queryRequest = (overrides) => ({
  text: 'alpha', taskId: 't1', projectId: 'proj', sessionId: 'sess', branch: 'b1',
  topK: 20, includeStatuses: ['active'],
  ...(overrides === undefined ? {} : overrides),
});

// Specified Behavioral-Active: textDigest matches the core TextDigest convention (sha256 over UTF-16LE).
test('textDigest is sha256 over utf16le with the core sha256-utf16le prefix', () => {
  assert.equal(textDigest('alpha'), `sha256-utf16le:${createHash('sha256').update('alpha', 'utf16le').digest('hex')}`);
  assert.equal(textDigest('α'), `sha256-utf16le:${createHash('sha256').update('α', 'utf16le').digest('hex')}`);
  assert.notEqual(textDigest('alpha'), textDigest('alphabet'));
});

// Specified Blackbox-Atomic: deterministic cosine ranking with exact-score ties broken by recordId then rowId.
test('ranks deterministically; ties break by recordId then rowId; no vector leaked to candidates', async () => {
  const map = new Map([['alpha', [1, 0, 0]], ['beta', [0, 1, 0]], ['gamma', [0, 0, 1]], ['diag', [1, 1, 0]]]);
  const env = makeEnv(undefined, map);
  let idx = createIndex(env.config);
  const rows = [
    { rowId: 'x2', recordId: 'rec-d', text: 'diag' },
    { rowId: 'x1', recordId: 'rec-a', text: 'alpha' },
    { rowId: 'x3', recordId: 'rec-b', text: 'beta' },
    { rowId: 'x4', recordId: 'rec-dup', text: 'alpha' }, // exact tie with rec-a at score 1.0
    { rowId: 'x5', recordId: 'rec-g', text: 'gamma' },
  ];
  for (const r of rows) {
    approve(env.grant, r.recordId, r.text);
    idx = await addRow(idx, { rowId: r.rowId, recordId: r.recordId, taskId: 't1', projectId: 'proj', sessionId: 'sess', branch: 'b1', status: 'active', text: r.text, digest: textDigest(r.text), indexedAt: '2026-01-01T00:00:00.000Z' }, env.encoder, env.grant, NO_CTX);
  }
  const res = await query(idx, queryRequest({ topK: 20 }), env.encoder, env.grant, NO_CTX);
  assert.equal(res.corpusSize, 5);
  assert.deepEqual(res.candidates.map(c => c.recordId), ['rec-a', 'rec-dup', 'rec-d', 'rec-b', 'rec-g']);
  assert.equal(res.candidates[0].score, 1);
  assert.equal(res.candidates[1].score, 1);
  assert.ok(Math.abs(res.candidates[2].score - Math.SQRT1_2) < 1e-9);
  assert.equal(res.candidates[3].score, 0);
  assert.equal(res.candidates[4].score, 0);
  for (const c of res.candidates) {
    assert.ok(!('vector' in c), 'candidate must not expose the stored vector');
    assert.equal(typeof c.recordId, 'string');
    assert.equal(typeof c.status, 'string');
    assert.equal(typeof c.contentDigest, 'string');
  }
  assert.match(res.notice, /not evidence of truth/i);
});

// Specified Behavioral-Active: cross-task and cross-branch rows cannot surface.
test('filters cross-task and cross-branch rows before ranking', async () => {
  const map = new Map([['t1-text', [1, 0, 0]], ['t2-text', [1, 0, 0]], ['b2-text', [1, 0, 0]]]);
  const identity = encIdentity();
  const key = encoderIdentityKey(identity);
  const config = { encoderKey: key, dimensions: 3, normalization: 'unit', maxRows: 100, maxTopK: 20 };
  const { encoder, calls } = makeEncoder(identity, text => map.get(text).slice());
  const grant = {
    projectId: 'proj', sessionId: 'sess', branch: 'b1', taskIds: ['t1', 't2'],
    recordApprovals: [], encoderKeys: [key], allowQueryText: true, revokedRecordIds: [], expiresAtMs: undefined, revoked: false,
  };
  let idx = createIndex(config);
  const specs = [
    { rowId: 'a', recordId: 'r-t1', taskId: 't1', branch: 'b1', text: 't1-text' },
    { rowId: 'b', recordId: 'r-t2', taskId: 't2', branch: 'b1', text: 't2-text' },
    { rowId: 'c', recordId: 'r-b2', taskId: 't1', branch: 'b2', text: 'b2-text' },
  ];
  for (const s of specs) {
    approve(grant, s.recordId, s.text);
    idx = await addRow(idx, { rowId: s.rowId, recordId: s.recordId, taskId: s.taskId, projectId: 'proj', sessionId: 'sess', branch: s.branch, status: 'active', text: s.text, digest: textDigest(s.text), indexedAt: '2026-01-01T00:00:00.000Z' }, encoder, { ...grant, branch: s.branch }, NO_CTX);
  }
  const overTask = await query(idx, queryRequest({ text: 't1-text', taskId: 't1' }), encoder, grant, NO_CTX);
  assert.deepEqual(overTask.candidates.map(c => c.recordId), ['r-t1'], 'cross-task row r-t2 must not surface in a t1 query');
  const crossBranch = await query(idx, queryRequest({ text: 't1-text', taskId: 't1', branch: 'b1' }), encoder, grant, NO_CTX);
  assert.deepEqual(crossBranch.candidates.map(c => c.recordId), ['r-t1'], 'cross-branch row r-b2 must not surface');
  assert.ok(calls.length >= 3);
});

// Specified Blackbox-Atomic: unapproved or revoked rows are excluded, never silently surfaced.
test('excludes unapproved and revoked records; empty corpus is distinct from unavailable', async () => {
  const map = new Map([['alpha', [1, 0, 0]]]);
  const env = makeEnv(undefined, map);
  let idx = createIndex(env.config);
  approve(env.grant, 'rec1', 'alpha');
  idx = await addRow(idx, input(), env.encoder, env.grant, NO_CTX);

  const noApproval = structuredClone(env.grant);
  noApproval.recordApprovals = [];
  const resUnapproved = await query(idx, queryRequest(), env.encoder, noApproval, NO_CTX);
  assert.equal(resUnapproved.corpusSize, 0);
  assert.deepEqual(resUnapproved.candidates, []);

  const revoked = structuredClone(env.grant);
  revoked.revokedRecordIds = ['rec1'];
  const resRevoked = await query(idx, queryRequest(), env.encoder, revoked, NO_CTX);
  assert.equal(resRevoked.corpusSize, 0);
  assert.deepEqual(resRevoked.candidates, []);

  const empty = createIndex(env.config);
  const resEmpty = await query(empty, queryRequest(), env.encoder, env.grant, NO_CTX);
  assert.equal(resEmpty.corpusSize, 0);
  assert.deepEqual(resEmpty.candidates, []);
});

// Specified Behavioral-Active: changed content requires a rebuild; a wrong digest fails loudly.
test('changed digest requires rebuild; mismatched digest fails and never reaches the encoder', async () => {
  const map = new Map([['alpha', [1, 0, 0]], ['beta', [0, 1, 0]]]);
  const env = makeEnv(undefined, map);
  let idx = createIndex(env.config);
  approve(env.grant, 'rec1', 'alpha');
  idx = await addRow(idx, input(), env.encoder, env.grant, NO_CTX);

  const wrongDigest = { ...input(), digest: `sha256-utf16le:${'0'.repeat(64)}` };
  const wrongGrant = { ...env.grant, recordApprovals: [{ recordId: 'rec1', digest: wrongDigest.digest }] };
  const before = env.calls.length;
  await assert.rejects(() => addRow(idx, wrongDigest, env.encoder, wrongGrant, NO_CTX), e => e instanceof VectorMemoryError && e.code === 'DIGEST_MISMATCH');
  assert.equal(env.calls.length, before);

  // Rebuild: same recordId, same task, new exact content already host-approved.
  env.grant.recordApprovals = [{ recordId: 'rec1', digest: textDigest('beta') }];
  const rebuild = { ...input(), rowId: 'r2', text: 'beta', digest: textDigest('beta'), indexedAt: '2026-01-02T00:00:00.000Z' };
  const idx2 = await addRow(idx, rebuild, env.encoder, env.grant, NO_CTX);
  assert.equal(idx2.rows.length, 1, 'rebuild replaces, does not append');
  assert.equal(idx2.rows[0].contentDigest, textDigest('beta'));
  assert.equal(idx2.rows[0].rowId, 'r2');
});

// Specified Behavioral-Active: encoder identity/dimension/normalization must bind exactly; mixed encoders fail.
test('encoder mismatch (dims, normalization, key), malformed vectors, NaN/Inf/zero/overflow all fail', async () => {
  const map = new Map([['alpha', [1, 0, 0]]]);
  const base = makeEnv(undefined, map);
  let idx = createIndex(base.config);
  approve(base.grant, 'rec1', 'alpha');
  idx = await addRow(idx, input(), base.encoder, base.grant, NO_CTX);

  // Wrong dimensions in encoder identity vs bound config.
  const wrongDims = makeEnv({ dimensions: 4 }, map);
  await assert.rejects(() => addRow(idx, input(), wrongDims.encoder, wrongDims.grant, NO_CTX), e => e.code === 'ENCODER_MISMATCH');

  // Wrong normalization.
  const wrongNorm = makeEnv({ normalization: 'raw' }, map);
  await assert.rejects(() => addRow(idx, input(), wrongNorm.encoder, wrongNorm.grant, NO_CTX), e => e.code === 'ENCODER_MISMATCH');

  // Different encoder key (different implementation digest).
  const diffKey = makeEnv({ implementationDigest: 'd'.repeat(64) }, map);
  await assert.rejects(() => addRow(idx, input(), diffKey.encoder, diffKey.grant, NO_CTX), e => e.code === 'ENCODER_MISMATCH');

  // Vector payload failures via validateVector / addRow.
  assert.throws(() => validateVector([1, 2], 3), e => e.code === 'DIMENSION_MISMATCH');
  assert.throws(() => validateVector([1, NaN, 0], 3), e => e.code === 'NONFINITE_VECTOR');
  assert.throws(() => validateVector([1, Infinity, 0], 3), e => e.code === 'NONFINITE_VECTOR');
  assert.throws(() => validateVector([0, 0, 0], 3), e => e.code === 'ZERO_NORM');
  assert.deepEqual(validateVector([1e200, 0, 0], 3), [1e200, 0, 0]);
  assert.throws(() => validateVector([Number.MAX_VALUE, Number.MAX_VALUE, 0], 3), e => e.code === 'VECTOR_OVERFLOW');
  assert.throws(() => validateVector('nope', 3), e => e.code === 'MALFORMED_OUTPUT');
  assert.throws(() => validateVector([1, 'x', 0], 3), e => e.code === 'MALFORMED_OUTPUT');

  const bad = makeEnv(undefined, new Map([['beta', null]]));
  approve(bad.grant, 'rec2', 'beta');
  await assert.rejects(() => addRow(idx, { ...input(), recordId: 'rec2', text: 'beta', digest: textDigest('beta') }, bad.encoder, bad.grant, NO_CTX), e => e instanceof VectorMemoryError);
});

// Specified Behavioral-Active: only host-approved records enter the index; encode is not called for denied content.
test('only host-approved exact snapshots enter the index; denied content never reaches the encoder', async () => {
  const map = new Map([['alpha', [1, 0, 0]]]);
  const env = makeEnv(undefined, map);
  const idx = createIndex(env.config);
  const unapproved = { ...input(), recordId: 'rec-unknown', digest: textDigest('alpha') };
  await assert.rejects(() => addRow(idx, unapproved, env.encoder, env.grant, NO_CTX), e => e.code === 'GRANT_DENIED');
  assert.equal(env.calls.length, 0, 'grant denial must occur before any encode');
});

// Specified Behavioral-Active: query text is never sent without an explicit grant allowance.
test('query text is not sent to the encoder without allowQueryText', async () => {
  const map = new Map([['alpha', [1, 0, 0]]]);
  const env = makeEnv(undefined, map);
  let idx = createIndex(env.config);
  approve(env.grant, 'rec1', 'alpha');
  idx = await addRow(idx, input(), env.encoder, env.grant, NO_CTX);
  const before = env.calls.length;
  const noText = structuredClone(env.grant);
  noText.allowQueryText = false;
  await assert.rejects(() => query(idx, queryRequest(), env.encoder, noText, NO_CTX), e => e.code === 'QUERY_TEXT_DENIED');
  assert.equal(env.calls.length, before, 'denied query must not encode text');
});

// Specified Behavioral-Active: encoding payload is auditable (exact text only, scoped).
test('encoder receives only the exact approved source and query text (payload capture)', async () => {
  const map = new Map([['alpha', [1, 0, 0]]]);
  const env = makeEnv(undefined, map);
  let idx = createIndex(env.config);
  approve(env.grant, 'rec1', 'alpha');
  idx = await addRow(idx, input(), env.encoder, env.grant, NO_CTX);
  await query(idx, queryRequest({ text: 'alpha', topK: 1 }), env.encoder, env.grant, NO_CTX);
  assert.deepEqual(env.calls.map(c => c.text), ['alpha', 'alpha']);
});

// Specified Behavioral-Group: cancellation and deadline throw before encoding; late abort is fenced after encoding.
test('cooperative cancellation and deadline semantics', async () => {
  const map = new Map([['alpha', [1, 0, 0]]]);
  const env = makeEnv(undefined, map);
  let idx = createIndex(env.config);
  approve(env.grant, 'rec1', 'alpha');
  idx = await addRow(idx, input(), env.encoder, env.grant, NO_CTX);

  const aborted = new AbortController();
  aborted.abort();
  const callsBefore = env.calls.length;
  await assert.rejects(() => addRow(idx, { ...input(), recordId: 'rec9', digest: textDigest('alpha') }, env.encoder, env.grant, { signal: aborted.signal, deadlineMs: Date.now() + 5000 }), e => e.code === 'CANCELLED');
  await assert.rejects(() => query(idx, queryRequest(), env.encoder, env.grant, { signal: undefined, deadlineMs: 1 }), e => e.code === 'DEADLINE_EXCEEDED');
  assert.equal(env.calls.length, callsBefore, 'aborted/deadline-exceeded ops must not call the encoder');
});

// Specified Behavioral-Active: a live encoder availability failure stays unavailable, never a fake empty result.
test('encoder unavailability is a thrown failure, never a fake empty result', async () => {
  const map = new Map([['alpha', [1, 0, 0]]]);
  const env = makeEnv(undefined, map);
  let idx = createIndex(env.config);
  approve(env.grant, 'rec1', 'alpha');
  idx = await addRow(idx, input(), env.encoder, env.grant, NO_CTX);
  const down = makeEncoder(env.identity, () => { throw new Error('network down'); });
  down.calls = env.calls;
  await assert.rejects(() => query(idx, queryRequest(), down.encoder, env.grant, NO_CTX), e => e instanceof VectorMemoryError && e.code === 'ENCODER_UNAVAILABLE');
});

// Specified Behavioral-Group: top-k and input bounds are enforced.
test('enforces top-k, text-length, row and config bounds', async () => {
  const map = new Map([['alpha', [1, 0, 0]]]);
  const env = makeEnv(undefined, map);
  let idx = createIndex(env.config);
  approve(env.grant, 'rec1', 'alpha');
  idx = await addRow(idx, input(), env.encoder, env.grant, NO_CTX);

  await assert.rejects(() => query(idx, queryRequest({ topK: 0 }), env.encoder, env.grant, NO_CTX), e => e.code === 'TOPK_OUT_OF_RANGE');
  await assert.rejects(() => query(idx, queryRequest({ topK: 9999 }), env.encoder, env.grant, NO_CTX), e => e.code === 'TOPK_OUT_OF_RANGE');

  await assert.rejects(() => query(idx, queryRequest({ text: 'a'.repeat(MAX_QUERY_TEXT_CHARS + 1) }), env.encoder, env.grant, NO_CTX), e => e.code === 'TEXT_TOO_LONG');
  const longText = 'a'.repeat(MAX_INDEX_TEXT_CHARS + 1);
  approve(env.grant, 'rec-long', longText);
  await assert.rejects(() => addRow(idx, { ...input(), recordId: 'rec-long', text: longText, digest: textDigest(longText) }, env.encoder, env.grant, NO_CTX), e => e.code === 'TEXT_TOO_LONG');

  assert.throws(() => createIndex({ ...env.config, maxRows: 0 }), e => e.code === 'INVALID_CONFIG');
  assert.throws(() => createIndex({ ...env.config, maxTopK: MAX_TOP_K + 1 }), e => e.code === 'INVALID_CONFIG');
  assert.throws(() => createIndex({ ...env.config, dimensions: MAX_VECTOR_DIMENSIONS + 1 }), e => e.code === 'INVALID_CONFIG');
});

// Specified Behavioral-Active: addRow returns immutable snapshots; the prior index is unchanged.
test('snapshots are mutation-safe; prior index is unchanged after addRow', async () => {
  const map = new Map([['alpha', [1, 0, 0]], ['beta', [0, 1, 0]]]);
  const env = makeEnv(undefined, map);
  const idx0 = createIndex(env.config);
  approve(env.grant, 'rec1', 'alpha');
  const idx1 = await addRow(idx0, input(), env.encoder, env.grant, NO_CTX);
  assert.equal(idx0.rows.length, 0, 'base snapshot must not be mutated');
  assert.equal(idx1.rows.length, 1);
  assert.ok(Object.isFrozen(idx1));
  assert.ok(Object.isFrozen(idx1.rows[0]));
  approve(env.grant, 'rec2', 'beta');
  const idx2 = await addRow(idx1, { ...input(), rowId: 'r2', recordId: 'rec2', text: 'beta', digest: textDigest('beta') }, env.encoder, env.grant, NO_CTX);
  assert.equal(idx1.rows.length, 1, 'intermediate snapshot must not be mutated');
  assert.equal(idx2.rows.length, 2);
});

// Specified Behavioral-Active: raw normalization still yields correct cosine; binding is preserved.
test('raw normalization vectors rank by cosine deterministically', async () => {
  const map = new Map([['alpha', [2, 0, 0]], ['beta', [0, 3, 0]]]);
  const env = makeEnv({ normalization: 'raw' }, map);
  let idx = createIndex(env.config);
  approve(env.grant, 'rec-a', 'alpha');
  approve(env.grant, 'rec-b', 'beta');
  idx = await addRow(idx, { ...input(), recordId: 'rec-a', text: 'alpha', digest: textDigest('alpha') }, env.encoder, env.grant, NO_CTX);
  idx = await addRow(idx, { ...input(), rowId: 'r2', recordId: 'rec-b', text: 'beta', digest: textDigest('beta') }, env.encoder, env.grant, NO_CTX);
  const queryVec = [5, 0, 0];
  const { encoder } = makeEncoder(env.identity, () => queryVec.slice());
  const res = await query(idx, queryRequest({ text: 'q' }), encoder, env.grant, NO_CTX);
  assert.equal(res.candidates[0].recordId, 'rec-a');
  assert.equal(res.candidates[0].score, 1);
  assert.equal(res.candidates[1].score, 0);
});

test('cosineSimilarity is symmetric and bounded', () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
  assert.equal(cosineSimilarity([0, 1, 0], [1, 0, 0]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 1, 0], [1, 0, 0]) - Math.SQRT1_2) < 1e-9);
  assert.throws(() => cosineSimilarity([1, 0], [1, 0, 0]), e => e.code === 'DIMENSION_MISMATCH');
});
