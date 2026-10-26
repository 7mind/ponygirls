import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Operation_ApplyRetryFailed, Operation_CreateGroup, Operation_MintToken, MutationReceipt, Result_Mutation, Result_RetryFailed, Result_RetryFailedPreview, Result_Token, RetryFailedCounts, RetryFailedPlan, RetryFailedResult, Scope, TokenInfo, TokenResult } from '../src/api.ts';
import { validateMutationResult } from '../src/mutations.ts';
import { RequestFailure } from '../src/transport/types.ts';

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_REQUEST_ID = '00000000-0000-4000-8000-000000000002';
const TARGET_PROFILE = 'synthetic-target-profile';
function fixture() {
  const counts = new RetryFailedCounts(9007199254740993n, 2n, 3n, 4n, 5n, 6n, 7n);
  const operation = new Operation_ApplyRetryFailed(TARGET_PROFILE, 'synthetic-selection-hash', true);
  const result = new RetryFailedResult(REQUEST_ID, TARGET_PROFILE, counts.eligibleCurrentFailed, counts);
  const generic = new Result_Mutation(new MutationReceipt(REQUEST_ID, 'ApplyRetryFailed', undefined));
  const token = new Result_Token(new TokenResult(new TokenInfo(OTHER_REQUEST_ID, 'Synthetic token', [Scope.Read], '2026-10-26T12:00:00Z', false), undefined));
  return { counts, operation, result, generic, token };
}

test('BA specified: bulk apply accepts only its typed result and preserves exact server counts', () => {
  const { operation, result } = fixture(), reply = new Result_RetryFailed(result);
  const accepted = validateMutationResult(operation, reply, REQUEST_ID);
  assert.equal(accepted, reply);
  assert.ok(accepted instanceof Result_RetryFailed);
  assert.equal(accepted.result.retried, 9007199254740993n);
  assert.equal(accepted.result.counts.unchangedComplete, 7n);
});

function assertUnverifiedReply(check: () => unknown, message: RegExp, requestId: string) {
  assert.throws(check, cause => {
    assert.ok(cause instanceof RequestFailure);
    assert.match(cause.message, message);
    assert.equal(cause.code, 'unverified-result');
    assert.equal(cause.outcome, 'uncertain');
    assert.equal(cause.receiptId, requestId);
    return true;
  });
}

test('BA regression: a delivered bulk reply with the wrong result type retains uncertain original identity', () => {
  const { operation, generic, token, counts } = fixture();
  for (const reply of [generic, token, new Result_RetryFailedPreview(new RetryFailedPlan(TARGET_PROFILE, 'synthetic-selection-hash', counts))]) {
    assertUnverifiedReply(() => validateMutationResult(operation, reply, REQUEST_ID), /Unexpected mutation response/, REQUEST_ID);
  }
});

test('BA regression: a bulk reply with the wrong request identity or profile retains uncertain original identity', () => {
  const { operation, result } = fixture();
  assertUnverifiedReply(() => validateMutationResult(operation, new Result_RetryFailed(result.with({ requestId: OTHER_REQUEST_ID })), REQUEST_ID), /Receipt identity mismatch/, REQUEST_ID);
  assertUnverifiedReply(() => validateMutationResult(operation, new Result_RetryFailed(result.with({ targetProfile: 'changed-target-profile' })), REQUEST_ID), /Receipt target profile mismatch/, REQUEST_ID);
});

test('BA specified: a bulk result cannot confirm another operation or a token mint', () => {
  const { result } = fixture();
  for (const operation of [new Operation_CreateGroup('Synthetic group'), new Operation_MintToken('Synthetic token', [Scope.Read])]) {
    assert.throws(() => validateMutationResult(operation, new Result_RetryFailed(result), REQUEST_ID), cause => {
      assert.ok(cause instanceof Error);
      assert.ok(!(cause instanceof RequestFailure));
      assert.match(cause.message, /Unexpected mutation response/);
      return true;
    });
  }
});

test('BA specified: existing group and token responses retain their accepted result types', () => {
  const { generic, token } = fixture();
  assert.equal(validateMutationResult(new Operation_CreateGroup('Synthetic group'), generic, REQUEST_ID), generic);
  assert.equal(validateMutationResult(new Operation_MintToken('Synthetic token', [Scope.Read]), token, REQUEST_ID), token);
});
