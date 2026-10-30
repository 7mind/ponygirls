/** How goal facts read to the user: status glyph/state and compact numbers, shared by the badge, pane, and transcript. */
import type { UiState } from "@ponygirls/pi-ui";
import type { GoalStatus } from "./goal.ts";

export interface StatusLook {
  glyph: string;
  state: UiState;
}

export const GOAL_STATUS_LOOK: Readonly<Record<GoalStatus, StatusLook>> = {
  active: { glyph: "◎", state: "ok" },
  paused: { glyph: "◉", state: "attention" },
  blocked: { glyph: "✖", state: "error" },
  usage_limited: { glyph: "✖", state: "error" },
  budget_limited: { glyph: "✖", state: "error" },
  complete: { glyph: "◈", state: "settled" },
};

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(total % 60).padStart(2, "0")}s`;
  return `${total}s`;
}
