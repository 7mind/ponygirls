/**
 * Border badge for background tasks: a compact indicator shown when any
 * task is unfinished. Published through ctx.ui.setWidget under BG_STATUS_KEY
 * as a borderBottomLeft badge on the editor's border (styling is applied at
 * publish time; a theme switch restyles at the next task change).
 */
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

/** Compact border badge text, or null when nothing is active (badge cleared). */
export function bgStatusLine(tasks: readonly TaskRecord[]): string | null {
  const running = countRunning(tasks);
  if (running === 0) return null;
  return running === 1 ? "bg 1 running" : `bg ${running} running`;
}
