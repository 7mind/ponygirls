/**
 * Panel chrome: a title rule (`── Title · meta  tabs ───── right ──`), a plain
 * rule, and one key-hint style (key in text, action muted). Hint and tab spans
 * are reported in visible columns so callers can keep them clickable.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { UiTheme } from "./theme.ts";

/** A clickable column span on one rendered line. */
export interface Span {
  start: number;
  end: number;
  index: number;
}

export interface FrameTitle {
  title: string;
  /** Short facts after the title, plain text (rendered dim). */
  meta?: string;
  /** Tabs after the meta; the active one is highlighted. */
  tabs?: { labels: readonly string[]; active: number };
  /** Right-aligned, already styled (status, scroll position). */
  right?: string;
}

export interface RenderedTitle {
  line: string;
  /** Column spans of the tab labels, by tab index. */
  tabSpans: Span[];
}

const DASH = "─";

/** Box corners for popups; `none` draws an open rule for panels that replace the editor. */
export type TitleCorners = "none" | "box";

/**
 * Title rule exactly `width` columns wide. The left part truncates before the
 * right part disappears; tabs keep their spans only while fully visible.
 */
export function frameTitle(theme: UiTheme, width: number, title: FrameTitle, corners: TitleCorners): RenderedTitle {
  const w = Math.max(1, Math.floor(width));
  const lead = corners === "box" ? "┌─ " : "── ";
  const tail = corners === "box" ? "┐" : "──";
  const parts: string[] = [theme.bold(theme.fg("text", title.title))];
  let plainWidth = visibleWidth(lead) + visibleWidth(title.title);
  if (title.meta) {
    const meta = ` · ${title.meta}`;
    parts.push(theme.fg("dim", meta));
    plainWidth += visibleWidth(meta);
  }
  const tabSpans: Span[] = [];
  if (title.tabs) {
    parts.push("  ");
    plainWidth += 2;
    title.tabs.labels.forEach((label, index) => {
      if (index > 0) {
        parts.push(" ");
        plainWidth += 1;
      }
      const cell = ` ${label} `;
      const start = plainWidth;
      parts.push(index === title.tabs!.active ? theme.bg("selectedBg", theme.fg("text", cell)) : theme.fg("muted", cell));
      plainWidth += visibleWidth(cell);
      tabSpans.push({ start, end: plainWidth, index });
    });
  }
  const right = title.right ? ` ${title.right} ` : "";
  const rightWidth = visibleWidth(right);
  const tailWidth = visibleWidth(tail);
  const leftBudget = Math.max(0, w - tailWidth - rightWidth - 2);
  let left = theme.fg("border", lead) + parts.join("");
  if (plainWidth + 1 > leftBudget) {
    left = truncateToWidth(left, leftBudget, "…");
  }
  const leftWidth = visibleWidth(left);
  const visibleSpans = tabSpans.filter((span) => span.end <= leftWidth);
  const fill = Math.max(2, w - leftWidth - rightWidth - tailWidth);
  const line = `${left}${theme.fg("border", ` ${DASH.repeat(fill - 1)}`)}${right}${theme.fg("border", tail)}`;
  return { line: truncateToWidth(line, w, ""), tabSpans: visibleSpans };
}

/** A plain rule, `width` columns wide. */
export function frameRule(theme: UiTheme, width: number): string {
  return theme.fg("border", DASH.repeat(Math.max(1, Math.floor(width))));
}

export interface KeyHint {
  key: string;
  action: string;
}

export interface RenderedHints {
  lines: string[];
  /** Hint spans per line, by hint index. */
  spans: Span[][];
}

const HINT_GAP = "  ";

/** One hint style everywhere: key in text, action muted, two spaces apart; wraps to `width`. */
export function keyHints(theme: UiTheme, width: number, hints: readonly KeyHint[]): RenderedHints {
  const w = Math.max(1, Math.floor(width));
  const lines: string[] = [];
  const spans: Span[][] = [];
  let parts: string[] = [];
  let lineSpans: Span[] = [];
  let column = 0;
  hints.forEach((hint, index) => {
    const plain = `${hint.key} ${hint.action}`;
    const size = visibleWidth(plain);
    const gap = parts.length > 0 ? HINT_GAP.length : 0;
    if (parts.length > 0 && column + gap + size > w) {
      lines.push(parts.join(""));
      spans.push(lineSpans);
      parts = [];
      lineSpans = [];
      column = 0;
    }
    if (parts.length > 0) {
      parts.push(HINT_GAP);
      column += HINT_GAP.length;
    }
    parts.push(`${theme.fg("text", hint.key)} ${theme.fg("muted", hint.action)}`);
    lineSpans.push({ start: column, end: column + size, index });
    column += size;
  });
  if (parts.length > 0) {
    lines.push(parts.join(""));
    spans.push(lineSpans);
  }
  return { lines: lines.map((line) => truncateToWidth(line, w, "…")), spans };
}

/** The hint at a column on a rendered hint line, if any. */
export function hintAt(spans: readonly Span[] | undefined, column: number): number | undefined {
  return spans?.find((span) => column >= span.start && column < span.end)?.index;
}
