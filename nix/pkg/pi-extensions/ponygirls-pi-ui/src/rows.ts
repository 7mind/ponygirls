/**
 * List rows and selection: a two-column marker gutter; the selected row is a
 * full-width selectedBg band with an accent ▌ and bold text. Callers keep their
 * own state colours inside the row and use `muted` (not `dim`) for secondary
 * text, since dim on selectedBg falls below 3.5:1 in both built-in themes.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { UiTheme } from "./theme.ts";

/** Columns taken by the selection marker before row content. */
export const MARKER_WIDTH = 2;

export function listRow(theme: UiTheme, width: number, content: string, selected: boolean): string {
  const w = Math.max(MARKER_WIDTH, Math.floor(width));
  const body = truncateToWidth(content, w - MARKER_WIDTH, "…");
  if (!selected) return `${" ".repeat(MARKER_WIDTH)}${body}`;
  const fill = " ".repeat(Math.max(0, w - MARKER_WIDTH - visibleWidth(body)));
  return theme.bg("selectedBg", `${theme.fg("accent", "▌")} ${theme.bold(body)}${fill}`);
}

/** Pad or truncate styled text to exactly `width` visible columns. */
export function fit(text: string, width: number): string {
  const w = Math.max(0, Math.floor(width));
  const clipped = truncateToWidth(text, w, "…");
  return clipped + " ".repeat(Math.max(0, w - visibleWidth(clipped)));
}

/** Right-align styled text in `width` visible columns. */
export function fitRight(text: string, width: number): string {
  const w = Math.max(0, Math.floor(width));
  const clipped = truncateToWidth(text, w, "…");
  return " ".repeat(Math.max(0, w - visibleWidth(clipped))) + clipped;
}

export interface Column {
  header: string;
  width: number;
  align: "left" | "right";
}

/** Dim column header line, aligned to the row gutter. */
export function columnHeader(theme: UiTheme, columns: readonly Column[], gap: number): string {
  const cells = columns.map((column) => (column.align === "right" ? fitRight(column.header, column.width) : fit(column.header, column.width)));
  return theme.fg("dim", `${" ".repeat(MARKER_WIDTH)}${cells.join(" ".repeat(gap))}`.trimEnd());
}

/** Join already-styled cells to their column widths. */
export function columnCells(columns: readonly Column[], cells: readonly string[], gap: number): string {
  return columns
    .map((column, index) => (column.align === "right" ? fitRight(cells[index] ?? "", column.width) : fit(cells[index] ?? "", column.width)))
    .join(" ".repeat(gap))
    .trimEnd();
}
