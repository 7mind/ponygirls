import assert from "node:assert/strict";
import test from "node:test";

import {
  blockRecord,
  budgetLimitRecord,
  budgetPermits,
  completeFromBudgetLimited,
  completeRecord,
  countScalars,
  createRecord,
  editObjective,
  isActiveRecord,
  isTerminalStatus,
  isUnfinished,
  modelCreate,
  pausePreservingBudgetLimit,
  pauseRecord,
  resumeRecord,
  usageLimitRecord,
  userCreate,
  validateObjective,
  validateTokenBudget,
} from "../src/goal.ts";

const clocks = { nowIso: () => "2026-10-05T00:00:00.000Z" };
let seq = 0;
const ids = { makeId: () => `goal-${++seq}` as never };

function fresh(overrides = {}) {
  const r = createRecord({ objective: "ship it" }, clocks, ids);
  assert.equal(r.ok, true);
  return { ...(r as { ok: true; value: never }).value, ...overrides } as never as import("../src/goal.ts").GoalRecord;
}

test("objective validation trims, rejects empty, counts Unicode scalars not UTF-16 units", () => {
  assert.equal(validateObjective("  hello  ").ok, true);
  assert.equal((validateObjective("  hello  ") as { ok: true; value: string }).value, "hello");
  assert.equal(validateObjective("   ").ok, false);
  assert.equal(validateObjective(123).ok, false);
  // Emoji is one scalar but two UTF-16 units.
  assert.equal(countScalars("😀"), 1);
  assert.equal("😀".length, 2);
  const max = "x".repeat(4000);
  assert.equal(validateObjective(max).ok, true);
  assert.equal(validateObjective(`${max}x`).ok, false);
});

test("budget validation accepts positive safe integers only", () => {
  assert.deepEqual(validateTokenBudget(null), { ok: true, value: null });
  assert.deepEqual(validateTokenBudget(undefined), { ok: true, value: null });
  assert.equal(validateTokenBudget(0).ok, false);
  assert.equal(validateTokenBudget(-5).ok, false);
  assert.equal(validateTokenBudget(1.5).ok, false);
  assert.equal(validateTokenBudget(Number.MAX_SAFE_INTEGER + 1).ok, false);
  assert.deepEqual(validateTokenBudget(40000), { ok: true, value: 40000 });
});

test("user creation refuses unfinished replacement headless with clear-first guidance", () => {
  seq = 0;
  const existing = fresh();
  const attempt = userCreate(existing, { objective: "new" }, clocks, ids, { confirmed: false, dialogCapable: false });
  assert.equal(attempt.ok, false);
  assert.match((attempt as { ok: false; error: { message: string } }).error.message, /Clear it first/);
});

test("user creation with confirmation replaces identity and resets usage", () => {
  seq = 0;
  const existing = { ...fresh(), tokensUsed: 500, timeUsedSeconds: 12 };
  const next = userCreate(existing, { objective: "new" }, clocks, ids, { confirmed: true, dialogCapable: true });
  assert.equal(next.ok, true);
  const v = (next as { ok: true; value: import("../src/goal.ts").GoalRecord }).value;
  assert.notEqual(v.id, existing.id);
  assert.equal(v.tokensUsed, 0);
  assert.equal(v.status, "active");
});

test("model creation replaces only complete goals", () => {
  seq = 100;
  const active = fresh();
  assert.equal(modelCreate(active, { objective: "x" }, clocks, ids).ok, false);
  const budgeted = { ...fresh(), status: "budget_limited" as const };
  assert.equal(modelCreate(budgeted, { objective: "x" }, clocks, ids).ok, false);
  const done = { ...fresh(), status: "complete" as const };
  const replaced = modelCreate(done, { objective: "x" }, clocks, ids);
  assert.equal(replaced.ok, true);
  assert.equal(modelCreate(null, { objective: "x" }, clocks, ids).ok, true);
});

test("edit preserves identity, status, budget, usage", () => {
  const g = { ...fresh(), tokensUsed: 42, tokenBudget: 100, status: "paused" as const };
  const next = editObjective(g, "revised objective", clocks);
  assert.equal(next.ok, true);
  const v = (next as { ok: true; value: import("../src/goal.ts").GoalRecord }).value;
  assert.equal(v.id, g.id);
  assert.equal(v.status, "paused");
  assert.equal(v.tokenBudget, 100);
  assert.equal(v.tokensUsed, 42);
  assert.equal(v.objective, "revised objective");
});

test("pause/resume/complete/block lifecycle with budget precedence", () => {
  const g = fresh();
  assert.equal(isActiveRecord(g), true);
  const paused = pauseRecord(g, clocks, "user");
  assert.equal((paused as { ok: true; value: import("../src/goal.ts").GoalRecord }).value.status, "paused");
  const resumed = resumeRecord((paused as { ok: true; value: import("../src/goal.ts").GoalRecord }).value, clocks, {});
  assert.equal((resumed as { ok: true; value: import("../src/goal.ts").GoalRecord }).value.status, "active");
  // Resume under exhausted unchanged cap is rejected.
  const exhausted = { ...fresh(), status: "paused" as const, tokenBudget: 100, tokensUsed: 100 };
  assert.equal(resumeRecord(exhausted, clocks, {}).ok, false);
  const raised = resumeRecord(exhausted, clocks, { tokenBudget: 200 });
  assert.equal(raised.ok, true);
  assert.equal((raised as { ok: true; value: import("../src/goal.ts").GoalRecord }).value.tokensUsed, 100);
  // Complete only from active.
  assert.equal(completeRecord(g, clocks).ok, true);
  assert.equal(completeRecord((paused as { ok: true; value: import("../src/goal.ts").GoalRecord }).value, clocks).ok, false);
  assert.equal(blockRecord(g, clocks).ok, true);
  // Budget-limited cannot resume without a raised cap; pause must not conceal it.
  const limited = budgetLimitRecord({ ...g, tokenBudget: 50, tokensUsed: 50 }, clocks);
  assert.equal((limited as { ok: true; value: import("../src/goal.ts").GoalRecord }).value.status, "budget_limited");
  assert.equal(resumeRecord((limited as { ok: true; value: import("../src/goal.ts").GoalRecord }).value, clocks, {}).ok, false);
  const preserved = pausePreservingBudgetLimit((limited as { ok: true; value: import("../src/goal.ts").GoalRecord }).value, clocks);
  assert.equal((preserved as { ok: true; value: import("../src/goal.ts").GoalRecord }).value.status, "budget_limited");
  // Verified completion from budget_limited is allowed.
  assert.equal(
    completeFromBudgetLimited((limited as { ok: true; value: import("../src/goal.ts").GoalRecord }).value, clocks).ok,
    true,
  );
  // Usage limit is a separate terminal state.
  assert.equal(usageLimitRecord(g, clocks).ok, true);
  assert.equal(isTerminalStatus("complete"), true);
  assert.equal(isTerminalStatus("active"), false);
  assert.equal(isUnfinished(g), true);
  assert.equal(budgetPermits({ ...g, tokenBudget: 10, tokensUsed: 10 }), false);
});
