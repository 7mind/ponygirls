/**
 * One spelling per key in every hint line: lower-case words for named keys,
 * `^X` for ctrl chords, symbols only for arrows and enter.
 */
import type { KeyHint } from "./frame.ts";

export const KEY = {
  esc: "esc",
  tab: "tab",
  enter: "⏎",
  space: "space",
  upDown: "↑↓",
  leftRight: "←→",
  page: "PgUp/PgDn",
} as const;

/** `ctrlKey("s")` → `^S`. */
export function ctrlKey(letter: string): string {
  return `^${letter.toUpperCase()}`;
}

/** Hints every pane words the same way. */
export const HINT = {
  close: { key: KEY.esc, action: "close" },
  back: { key: KEY.esc, action: "back" },
  select: { key: KEY.upDown, action: "select" },
  scroll: { key: KEY.upDown, action: "scroll" },
  page: { key: KEY.page, action: "page" },
} as const satisfies Record<string, KeyHint>;
