/**
 * Table grid primitives: dim `│` separators on every row, a `─┼─` rule under the
 * header and a `─┴─` rule above totals, zero shown as a dim `·`, zebra stripes.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import type { UiFg, UiTheme } from "./theme.ts";

/** Plain separator between grid cells; its width is fixed. */
export const GRID_SEPARATOR = " │ ";

export function gridSeparator(theme: UiTheme): string {
  return theme.fg("dim", GRID_SEPARATOR);
}

export type RuleJunction = "┼" | "┴" | "┬";

/** A dim rule matching cells of `widths` joined with GRID_SEPARATOR. */
export function gridRule(theme: UiTheme, widths: readonly number[], junction: RuleJunction): string {
  return theme.fg("dim", widths.map((width) => "─".repeat(Math.max(0, width))).join(`─${junction}─`));
}

/** A count right-aligned in `width`: coloured when positive, a dim `·` when zero. */
export function countCell(theme: UiTheme, value: number, width: number, positive: UiFg): string {
  const text = value === 0 ? "·" : String(value);
  const padded = " ".repeat(Math.max(0, width - visibleWidth(text))) + text;
  return value === 0 ? theme.fg("dim", padded) : theme.fg(positive, padded);
}

/** Odd data rows get the neutral panel background, padded to `width`. */
export function zebra(theme: UiTheme, line: string, index: number, width: number): string {
  if (index % 2 === 0) return line;
  return theme.bg("toolPendingBg", line + " ".repeat(Math.max(0, width - visibleWidth(line))));
}
