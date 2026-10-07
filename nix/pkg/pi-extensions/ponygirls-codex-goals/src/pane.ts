/** The /goal pane: the current goal at a glance. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { GoalRecord, GoalStatus } from "./goal.ts";

function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(total % 60).padStart(2, "0")}s`;
  return `${total}s`;
}

const STATUS_COLOR: Record<GoalStatus, "success" | "warning" | "error" | "dim"> = {
  active: "success",
  paused: "warning",
  blocked: "error",
  usage_limited: "error",
  budget_limited: "error",
  complete: "dim",
};

function budgetLine(goal: GoalRecord): string {
  if (goal.tokenBudget === null) return `tokens   ${formatTokens(goal.tokensUsed)} (no budget)`;
  const percent = goal.tokenBudget > 0 ? Math.round((goal.tokensUsed / goal.tokenBudget) * 100) : 0;
  return `tokens   ${formatTokens(goal.tokensUsed)} / ${formatTokens(goal.tokenBudget)} (${percent}%)`;
}

/** The goal pane shown by `/goal` and by clicking the goal badge. */
export class GoalPane implements Component {
  private readonly theme: Theme;
  private readonly load: () => GoalRecord | null;
  private readonly close: () => void;

  constructor(theme: Theme, load: () => GoalRecord | null, close: () => void) {
    this.theme = theme;
    this.load = load;
    this.close = close;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const goal = this.load();
    const s = this.theme;
    const rows = goal
      ? [
          `${s.bold("Goal")}  ${s.fg(STATUS_COLOR[goal.status], goal.status)}`,
          goal.objective,
          "",
          budgetLine(goal),
          `time     ${formatDuration(goal.timeUsedSeconds)}`,
          `created  ${goal.createdAt}`,
          `updated  ${goal.updatedAt}`,
          "",
          s.fg("dim", "esc close"),
        ]
      : [s.fg("dim", "no goal — /goal <objective> sets one"), "", s.fg("dim", "esc close")];
    return rows.map((line) => truncateToWidth(line, width, "…"));
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) this.close();
  }
}
