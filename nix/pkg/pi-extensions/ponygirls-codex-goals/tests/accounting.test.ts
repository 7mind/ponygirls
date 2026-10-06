import assert from "node:assert/strict";
import test from "node:test";

import { chargeTokens, elapsedSeconds, emptyCheckpoints, normalizeTokens } from "../src/accounting.ts";

test("normalizeTokens adds disjoint cacheWrite, never subtracts cacheRead or adds reasoning", () => {
  // input=100 (uncached), cacheRead=50 (subset of history, not subtracted), cacheWrite=20, output=30, reasoning=10 (subset of output)
  assert.equal(
    normalizeTokens({ input: 100, output: 30, cacheRead: 50, cacheWrite: 20, reasoning: 10 }),
    150,
  );
  // No cacheWrite.
  assert.equal(normalizeTokens({ input: 100, output: 30, cacheRead: 0, cacheWrite: 0 }), 130);
  // Missing required fields are unknown, not zero.
  assert.equal(normalizeTokens({ input: undefined, output: 10 }), undefined);
  assert.equal(normalizeTokens({ input: 10 }), undefined);
  assert.equal(normalizeTokens({}), undefined);
});

test("chargeTokens charges once per entry id", () => {
  const seen = new Set<string>();
  const first = chargeTokens(0, [{ input: 10, output: 5 }], seen, ["e1"]);
  assert.equal(first.tokensUsed, 15);
  assert.equal(first.unknownUsage, false);
  const replay = chargeTokens(first.tokensUsed, [{ input: 10, output: 5 }], seen, ["e1"]);
  assert.equal(replay.tokensUsed, 15);
  const second = chargeTokens(replay.tokensUsed, [{ input: 1, output: 1 }], seen, ["e2"]);
  assert.equal(second.tokensUsed, 17);
});

test("chargeTokens surfaces unknown usage without charging zero", () => {
  const seen = new Set<string>();
  const r = chargeTokens(5, [{}], seen, ["e9"]);
  assert.equal(r.tokensUsed, 5);
  assert.equal(r.unknownUsage, true);
});

test("elapsedSeconds preserves fractional remainders", () => {
  const a = elapsedSeconds(0, 1500, 0);
  assert.equal(a.seconds, 1);
  assert.equal(a.remainderMs, 500);
  const b = elapsedSeconds(1500, 2600, a.remainderMs);
  assert.equal(b.seconds, 1);
  assert.equal(b.remainderMs, 600);
});

test("empty checkpoints start clean", () => {
  const c = emptyCheckpoints();
  assert.equal(c.chargedEntryIds.size, 0);
  assert.equal(c.spanStartMs, null);
});
