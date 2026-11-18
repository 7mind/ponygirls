/**
 * Border badge for session goals, shown while an unfinished goal exists.
 * Published through ctx.ui.setWidget under GOAL_STATUS_KEY as a
 * borderBottomLeft badge on the editor's border (styling is applied at
 * publish time; a theme switch restyles at the next goal change).
 */
import { type BorderBadge, fractionState } from "@ponygirls/pi-ui";
import type { GoalRecord } from "./goal.ts";
import { GOAL_STATUS_LOOK } from "./presentation.ts";

/** Border widget key for the bottom-left badge. */
export const GOAL_STATUS_KEY = "goal";

const GOAL_GLYPH = "🎯";
const PERCENT = 100;
/** One word for both limits: either way the goal waits for more allowance. */
const LIMIT_LABEL = "limit";

/**
 * What the badge reports, or null when there is no goal to indicate (none or
 * complete — the badge is cleared). A goal at work is the glyph alone, or the
 * used share of its token budget; a goal that stopped names why. Narrow
 * borders keep the percentage, or a non-colour status marker.
 */
export function goalBadge(goal: GoalRecord | null): BorderBadge | null {
  if (!goal) return null;
  switch (goal.status) {
    case "complete":
      return null;
    case "active": {
      if (goal.tokenBudget === null) return { glyph: GOAL_GLYPH, state: "running", label: "", compact: "" };
      const fraction = goal.tokensUsed / goal.tokenBudget;
      const percent = `${Math.round(fraction * PERCENT)}%`;
      return { glyph: GOAL_GLYPH, state: fractionState(fraction), label: percent, compact: percent };
    }
    case "paused":
      return { glyph: GOAL_GLYPH, state: "attention", label: goal.status, compact: GOAL_STATUS_LOOK.paused.glyph };
    case "blocked":
      return { glyph: GOAL_GLYPH, state: "error", label: goal.status, compact: GOAL_STATUS_LOOK.blocked.glyph };
    case "usage_limited":
    case "budget_limited":
      return { glyph: GOAL_GLYPH, state: "error", label: LIMIT_LABEL, compact: GOAL_STATUS_LOOK[goal.status].glyph };
  }
}
