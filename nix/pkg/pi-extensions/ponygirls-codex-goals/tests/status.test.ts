import assert from "node:assert/strict";
import test from "node:test";

import type { GoalRecord } from "../src/goal.ts";
import { GOAL_STATUS_KEY, goalStatusLine } from "../src/status.ts";

function goal(status: GoalRecord["status"]): GoalRecord {
  return {
    id: "goal-1" as GoalRecord["id"],
    objective: "ship it",
    status,
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
}

test("status key sorts after bg, before tokemon", () => {
  assert.equal(GOAL_STATUS_KEY, "goal");
});

test("no goal or a complete goal clears the status", () => {
  assert.equal(goalStatusLine(null), null);
  assert.equal(goalStatusLine(goal("complete")), null);
});

test("active and paused goals are indicated", () => {
  assert.equal(goalStatusLine(goal("active")), "goal active");
  assert.equal(goalStatusLine(goal("paused")), "goal paused");
});

test("other unfinished states are indicated too", () => {
  assert.equal(goalStatusLine(goal("blocked")), "goal blocked");
  assert.equal(goalStatusLine(goal("budget_limited")), "goal budget_limited");
  assert.equal(goalStatusLine(goal("usage_limited")), "goal usage_limited");
});
