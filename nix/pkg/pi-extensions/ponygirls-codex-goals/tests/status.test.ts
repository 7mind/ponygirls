import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";
import { borderBadge, borderBadgeCompact, PLAIN_THEME, type UiTheme } from "@ponygirls/pi-ui";
import type { GoalRecord } from "../src/goal.ts";
import { GOAL_STATUS_KEY, goalBadge } from "../src/status.ts";

function goal(status: GoalRecord["status"], tokens: { used: number; budget: number | null }): GoalRecord {
  return {
    id: "goal-1" as GoalRecord["id"],
    objective: "ship it",
    status,
    tokenBudget: tokens.budget,
    tokensUsed: tokens.used,
    timeUsedSeconds: 0,
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
}

const UNCAPPED = { used: 1200, budget: null };
const TAGS: UiTheme = {
  fg: (color, text) => `<${color}>${text}</${color}>`,
  bg: (color, text) => `[${color}]${text}[/${color}]`,
  bold: (text) => text,
};

test("status key sorts after bg, before tokemon", () => {
  assert.equal(GOAL_STATUS_KEY, "goal");
});

test("no goal or a complete goal clears the badge", () => {
  assert.equal(goalBadge(null), null);
  assert.equal(goalBadge(goal("complete", UNCAPPED)), null);
  assert.equal(goalBadge(goal("complete", { used: 10, budget: 100 })), null);
});

test("an active goal without a token budget is the glyph alone, running", () => {
  const badge = goalBadge(goal("active", UNCAPPED))!;
  assert.deepEqual(badge, { glyph: "🎯", state: "running", label: "", compact: "" });
  assert.equal(borderBadge(TAGS, badge, 40), " 🎯 ");
  assert.equal(borderBadgeCompact(TAGS, badge, 40), "🎯");
});

test("an active goal with a token budget reports the used share, coloured by how close the cap is", () => {
  const share = (used: number) => goalBadge(goal("active", { used, budget: 500_000 }))!;
  assert.deepEqual(share(205_000), { glyph: "🎯", state: "ok", label: "41%", compact: "41%" });
  assert.deepEqual(share(0), { glyph: "🎯", state: "ok", label: "0%", compact: "0%" });
  assert.deepEqual(share(450_000), { glyph: "🎯", state: "attention", label: "90%", compact: "90%" });
  assert.deepEqual(share(510_000), { glyph: "🎯", state: "error", label: "102%", compact: "102%" });
  assert.equal(borderBadge(TAGS, share(205_000), 40), " 🎯 <success>41%</success> ");
  assert.equal(borderBadgeCompact(TAGS, share(205_000), 40), "🎯<success>41%</success>");
});

test("a goal that stopped names why; narrow borders keep a non-colour marker", () => {
  for (const tokens of [UNCAPPED, { used: 205_000, budget: 500_000 }]) {
    assert.deepEqual(goalBadge(goal("paused", tokens)), { glyph: "🎯", state: "attention", label: "paused", compact: "◉" });
    assert.deepEqual(goalBadge(goal("blocked", tokens)), { glyph: "🎯", state: "error", label: "blocked", compact: "✖" });
    for (const status of ["usage_limited", "budget_limited"] as const) {
      assert.deepEqual(goalBadge(goal(status, tokens)), { glyph: "🎯", state: "error", label: "limit", compact: "✖" });
    }
  }
  const paused = goalBadge(goal("paused", UNCAPPED))!;
  assert.equal(borderBadge(TAGS, paused, 40), " 🎯 <warning>paused</warning> ");
  assert.equal(borderBadgeCompact(TAGS, paused, 40), "🎯<warning>◉</warning>");
  const limited = goalBadge(goal("budget_limited", { used: 510_000, budget: 500_000 }))!;
  assert.equal(borderBadge(TAGS, limited, 40), " 🎯 <error>limit</error> ");
  assert.equal(borderBadgeCompact(TAGS, limited, 40), "🎯<error>✖</error>");
});

test("the badge has no background chip and fits the border width it is given", () => {
  const badges = [
    goalBadge(goal("active", UNCAPPED))!,
    goalBadge(goal("active", { used: 205_000, budget: 500_000 }))!,
    goalBadge(goal("paused", UNCAPPED))!,
    goalBadge(goal("budget_limited", { used: 510_000, budget: 500_000 }))!,
  ];
  for (const badge of badges) {
    assert.doesNotMatch(borderBadge(TAGS, badge, 40) + borderBadgeCompact(TAGS, badge, 40), /\[\w+Bg\]/);
    for (const width of [170, 120, 100, 80, 60, 6, 2]) {
      assert.ok(visibleWidth(borderBadge(PLAIN_THEME, badge, width)) <= width);
      assert.ok(visibleWidth(borderBadgeCompact(PLAIN_THEME, badge, width)) <= width);
    }
  }
});
