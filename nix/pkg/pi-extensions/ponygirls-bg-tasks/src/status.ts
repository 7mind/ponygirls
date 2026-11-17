/**
 * Border badge for background tasks: a compact indicator shown when any
 * task is unfinished. Published through ctx.ui.setWidget under BG_STATUS_KEY
 * as a borderBottomLeft badge on the editor's border, in the look every
 * border badge shares (styling is applied when the badge is drawn).
 */
import type { BorderBadge } from "@ponygirls/pi-ui";
import { isFinalized, type TaskRecord } from "./protocol.ts";

/** Border widget key for the bottom-left badge. */
export const BG_STATUS_KEY = "bg";

/** Unfinished tasks (state == "running", any phase). */
export function countRunning(tasks: readonly TaskRecord[]): number {
  let running = 0;
  for (const task of tasks) {
    if (!isFinalized(task)) running += 1;
  }
  return running;
}

/** Identity glyph of the badge. */
const BADGE_GLYPH = "🛠️";

/** The badge: the number of running tasks; null when nothing runs (badge cleared). */
export function bgBadge(tasks: readonly TaskRecord[]): BorderBadge | null {
  const running = countRunning(tasks);
  if (running === 0) return null;
  const count = String(running);
  return { glyph: BADGE_GLYPH, state: "running", label: count, compact: count };
}
