/**
 * Border badge for session goals: a compact indicator shown when an
 * unfinished goal exists. Published through ctx.ui.setWidget under
 * GOAL_STATUS_KEY as a borderBottomLeft badge on the editor's border
 * (styling is applied at publish time; a theme switch restyles at the next
 * goal change).
 */
import type { GoalRecord } from "./goal.ts";

/** Border widget key for the bottom-left badge. */
export const GOAL_STATUS_KEY = "goal";

/**
 * Compact badge text, or null when there is no goal to indicate (none or
 * complete — the badge is cleared). Every other status (active, paused,
 * blocked, budget_limited, usage_limited) indicates the goal.
 */
export function goalStatusLine(goal: GoalRecord | null): string | null {
  if (!goal) return null;
  if (goal.status === "complete") return null;
  return `goal ${goal.status}`;
}
