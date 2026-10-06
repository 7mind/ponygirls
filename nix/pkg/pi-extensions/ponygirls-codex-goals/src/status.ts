/**
 * Footer status for session goals: a compact indicator shown when an
 * unfinished goal exists. Published through ctx.ui.setStatus under
 * GOAL_STATUS_KEY; the model-picker footer renders it inline at the end of
 * the first line's left part, and the native footer shows it on the status
 * line otherwise.
 */
import type { GoalRecord } from "./goal.ts";

/** Footer status key; sorts after "bg", before "tokemon". */
export const GOAL_STATUS_KEY = "goal";

/**
 * Compact footer status, or null when there is no goal to indicate (none or
 * complete — the status is cleared). Every other status (active, paused,
 * blocked, budget_limited, usage_limited) indicates the goal.
 */
export function goalStatusLine(goal: GoalRecord | null): string | null {
  if (!goal) return null;
  if (goal.status === "complete") return null;
  return `goal ${goal.status}`;
}
