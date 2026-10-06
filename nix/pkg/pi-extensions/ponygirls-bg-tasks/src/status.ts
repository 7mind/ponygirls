/**
 * Footer status for background tasks: a compact indicator shown when any
 * task is unfinished. Published through ctx.ui.setStatus under BG_STATUS_KEY;
 * the model-picker footer renders it inline at the end of the first line's
 * left part, and the native footer shows it on the status line otherwise.
 */
import { isFinalized, type TaskRecord } from "./protocol.ts";

/** Footer status key; sorts early alongside "agents". */
export const BG_STATUS_KEY = "bg";

/** Unfinished tasks (state == "running", any phase). */
export function countRunning(tasks: readonly TaskRecord[]): number {
  let running = 0;
  for (const task of tasks) {
    if (!isFinalized(task)) running += 1;
  }
  return running;
}

/** Compact footer status, or null when nothing is active (status cleared). */
export function bgStatusLine(tasks: readonly TaskRecord[]): string | null {
  const running = countRunning(tasks);
  if (running === 0) return null;
  return running === 1 ? "bg 1 running" : `bg ${running} running`;
}
