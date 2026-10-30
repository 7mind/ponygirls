/**
 * Shared presentation of task facts for the /bg panel and transcript lines:
 * short ids, state glyphs, exit evidence without redundant reasons, log sizes.
 */
import { stateColor, type UiFg, type UiState } from "@ponygirls/pi-ui";
import type { ExitEvidence, TaskReason, TaskState } from "./protocol.ts";
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

const STATE_GLYPH: Readonly<Record<TaskState, string>> = { completed: "✓", failed: "✖", dead: "⚠", running: "●" };
const STATE_UI: Readonly<Record<TaskState, UiState>> = { completed: "ok", failed: "error", dead: "attention", running: "running" };

export function stateGlyph(state: TaskState): string {
  return STATE_GLYPH[state];
}

export function taskStateColor(state: TaskState): UiFg {
  return stateColor(STATE_UI[state]);
}

/** Reasons that only restate the exit evidence when that evidence exists. */
const EXIT_REASONS: ReadonlySet<TaskReason> = new Set<TaskReason>(["exit", "exit_nonzero", "signaled"]);

/** The reason, unless the exit evidence already says it (D5: `exit 0  exit`). */
export function informativeReason(reason: TaskReason | null, exit: ExitEvidence | null): TaskReason | null {
  if (reason === null) return null;
  return exit !== null && EXIT_REASONS.has(reason) ? null : reason;
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
