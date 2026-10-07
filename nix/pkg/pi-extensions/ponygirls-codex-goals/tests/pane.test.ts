/** The /goal pane: content and close keys. */
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { GoalRecord } from "../src/goal.ts";
import { GoalPane } from "../src/pane.ts";

const theme = { bold: (s: string) => s, fg: (_color: string, s: string) => s } as never;

const goal: GoalRecord = {
  id: "goal-1" as GoalRecord["id"],
  objective: "ship it",
  status: "active",
  tokenBudget: 500_000,
  tokensUsed: 125_000,
  timeUsedSeconds: 3725,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T12:00:00.000Z",
};

test("the pane shows status, objective, budget, and timing", () => {
  const pane = new GoalPane(theme, () => goal, () => {});
  const text = pane.render(80).join("\n");
  assert.match(text, /Goal {2}active/);
  assert.match(text, /ship it/);
  assert.match(text, /tokens {3}125\.0k \/ 500\.0k \(25%\)/);
  assert.match(text, /time {5}1h02m/);
  assert.match(text, /updated {2}2026-10-06T12:00:00\.000Z/);
});

test("the pane notes a missing budget and a missing goal", () => {
  const bare = new GoalPane(theme, () => ({ ...goal, tokenBudget: null }), () => {});
  assert.match(bare.render(80).join("\n"), /tokens {3}125\.0k \(no budget\)/);
  const empty = new GoalPane(theme, () => null, () => {});
  assert.match(empty.render(80).join("\n"), /no goal/);
});

test("escape and ctrl+c close the pane", () => {
  let closed = 0;
  const pane = new GoalPane(theme, () => goal, () => {
    closed += 1;
  });
  pane.handleInput("\x1b");
  pane.handleInput("\x03");
  pane.handleInput("x");
  assert.equal(closed, 2);
});

test("every line fits the pane width", () => {
  const pane = new GoalPane(theme, () => ({ ...goal, objective: "x".repeat(200) }), () => {});
  for (const line of pane.render(40)) {
    // Measured in visible width: truncation may emit ANSI resets, so the raw
    // string length overstates the rendered width.
    assert.ok(visibleWidth(line) <= 40, `line too wide: ${line}`);
  }
});
