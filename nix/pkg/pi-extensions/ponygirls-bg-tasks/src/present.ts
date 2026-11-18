/**
 * Shared presentation of task facts for the /bg panel and transcript lines:
 * short ids, state glyphs, exit evidence without redundant reasons, log sizes.
 */
import { stateColor, type UiFg, type UiState } from "@ponygirls/pi-ui";
import type { ExitEvidence, TaskRecord, TaskReason, TaskState } from "./protocol.ts";
import { displayValue } from "./terminal-text.ts";

const TASK_ID_PREFIX = "bgt-";
/** Characters of a task id kept in its short form. */
export const SHORT_ID_CHARS = 4;

/** `bgt-c7c6d1bd…` → `c7c6…`; ids are escaped first since notices may come from a session file. */
export function shortTaskId(id: string): string {
  const safe = displayValue(id);
  const core = safe.startsWith(TASK_ID_PREFIX) ? safe.slice(TASK_ID_PREFIX.length) : safe;
  const chars = [...core];
  return chars.length > SHORT_ID_CHARS ? `${chars.slice(0, SHORT_ID_CHARS).join("")}…` : core;
}

/** A task state as the /bg pane and the transcript lines show it: a task stopped on request is `terminated`, not a failure. */
export type ShownState = TaskState | "terminated";

const STATE_GLYPH: Readonly<Record<ShownState, string>> = { completed: "✓", failed: "✖", dead: "⚠", running: "●", terminated: "■" };
const STATE_UI: Readonly<Record<ShownState, UiState>> = { completed: "ok", failed: "error", dead: "attention", running: "running", terminated: "settled" };

export function stateGlyph(state: ShownState): string {
  return STATE_GLYPH[state];
}

export function taskStateColor(state: ShownState): UiFg {
  return stateColor(STATE_UI[state]);
}

/**
 * Reason `terminated` is the supervisor's record of a stop it carried out on
 * request: its terminate operation (the pane's `t`, the tool's `terminate`),
 * or its own stop of a task whose start it could not commit. A signal sent
 * with `s`/`signal` is recorded like any other death and stays failed.
 */
export function shownState(task: Pick<TaskRecord, "state" | "reason">): ShownState {
  return task.state === "failed" && task.reason === "terminated" ? "terminated" : task.state;
}

/** Reasons that only restate the exit evidence when that evidence exists. */
const EXIT_REASONS: ReadonlySet<TaskReason> = new Set<TaskReason>(["exit", "exit_nonzero", "signaled"]);

/** The reason, unless the exit evidence already says it (D5: `exit 0  exit`). */
export function informativeReason(reason: TaskReason | null, exit: ExitEvidence | null): TaskReason | null {
  if (reason === null) return null;
  return exit !== null && EXIT_REASONS.has(reason) ? null : reason;
}

/** The reason, unless the exit evidence (D5) or the shown state already says it. */
export function shownReason(task: Pick<TaskRecord, "state" | "reason" | "exit">): TaskReason | null {
  return shownState(task) === "terminated" ? null : informativeReason(task.reason, task.exit);
}

/** Whether the exit evidence reports a failure (non-zero code or a signal). */
export function exitFailed(exit: ExitEvidence): boolean {
  return exit.kind === "signal" || exit.code !== 0;
}

/** Bare exit evidence for a table cell: `0`, `3`, `SIGKILL`, or `?` when unknown. */
export function exitCode(exit: ExitEvidence | null): string {
  if (!exit) return "?";
  return exit.kind === "code" ? String(exit.code) : exit.signal;
}

const BYTES_PER_UNIT = 1024;
const SIZE_UNITS = ["KiB", "MiB", "GiB", "TiB"] as const;

/** `9 B`, `1.3 KiB`, `2.0 MiB`. */
export function formatSize(bytes: number): string {
  if (bytes < BYTES_PER_UNIT) return `${bytes} B`;
  let value = bytes / BYTES_PER_UNIT;
  let unit = 0;
  while (value >= BYTES_PER_UNIT && unit < SIZE_UNITS.length - 1) {
    value /= BYTES_PER_UNIT;
    unit += 1;
  }
  return `${value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}
