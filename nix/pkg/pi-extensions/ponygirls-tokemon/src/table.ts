/**
 * ponygirls-tokemon — the quota table (tokemon's layout): one row group per
 * account, its windows stacked inside the cells, sorted by (provider, login).
 * Rows without quota windows (other than rate-limited ones) are hidden
 * unless asked for and counted in the caption. On a narrow terminal the
 * provider's locations go first, then Status wraps (each window's cells stay
 * level with its status), then Plan, Provider, and Status are hidden, in
 * that order; the caption names what was hidden.
 */

import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { formatResets, formatUsedLimit, hiddenCaption, isShownByDefault, rateLimitedStatus, sortResults, usageBar, windowState, type WindowState } from "./format.ts";
import type { QuotaWindow } from "./quota.ts";
import type { QueryResult } from "./service.ts";

export interface TableStyle {
  /** A provider name in its brand colour. */
  provider(provider: string, text: string): string;
  bold(s: string): string;
  dim(s: string): string;
  success(s: string): string;
  warning(s: string): string;
  error(s: string): string;
}

const same = (s: string): string => s;
export const PLAIN_TABLE_STYLE: TableStyle = { provider: (_p, s) => s, bold: same, dim: same, success: same, warning: same, error: same };

export interface TableOptions {
  showInvalid: boolean;
  /** Terminal columns to fit, or null to keep every column. */
  width: number | null;
}

export interface RenderedTable {
  lines: string[];
  caption: string | null;
}

/** One line of a cell and how to style it. */
interface CellLine {
  text: string;
  style: (s: string) => string;
}

type Align = "left" | "right";
const COLUMNS: ReadonlyArray<{ header: string; align: Align }> = [
  { header: "Provider", align: "left" },
  { header: "Src", align: "left" },
  { header: "Login", align: "left" },
  { header: "Plan", align: "left" },
  { header: "Window", align: "left" },
  { header: "Used / limit", align: "right" },
  { header: "Usage", align: "left" },
  { header: "Resets", align: "right" },
  { header: "Status", align: "left" },
];
/** Optional columns in drop order: descriptive first; Status carries ok/low/EXHAUSTED and errors, so it goes last. */
const DROP_ORDER = ["Plan", "Provider", "Status"];
const STATUS_COLUMN = COLUMNS.length - 1;
/** Columns with one line per window, kept level with that window's (possibly wrapped) status. */
const WINDOW_COLUMNS = ["Window", "Used / limit", "Usage", "Resets"].map((header) => COLUMNS.findIndex((c) => c.header === header));
const BLANK: CellLine = { text: "", style: same };
const GAP = 2;
const MIN_STATUS_WIDTH = 12;
/** Status narrows to its longest word, so it wraps between words; only words longer than this are split. */
const MAX_STATUS_WORD = 24;

function stateStyle(style: TableStyle, state: WindowState): (s: string) => string {
  if (state === "EXHAUSTED") return (s) => style.error(style.bold(s));
  if (state === "unlimited") return style.dim;
  return state === "low" ? style.warning : style.success;
}

/** Per-window status lines; a row's note is shown once, on its first line. */
function statusLines(result: QueryResult, windows: Array<QuotaWindow | null>, now: Date, style: TableStyle): CellLine[] {
  if (result.rateLimited) return windows.map(() => ({ text: rateLimitedStatus(result.retryAt, now), style: style.warning }));
  if (result.error !== null) return windows.map(() => ({ text: result.error!, style: (s) => style.error(style.bold(s)) }));
  const note = result.snapshot?.note ?? null;
  return windows.map((window, index) => {
    if (window === null) return note !== null ? { text: index === 0 ? note : "—", style: style.dim } : { text: "ok", style: style.success };
    const state = windowState(window);
    return { text: index === 0 && note !== null ? `${state} · ${note}` : state, style: stateStyle(style, state) };
  });
}

function rowCells(result: QueryResult, now: Date, compact: boolean, style: TableStyle): CellLine[][] {
  const t = result.target;
  const windows: Array<QuotaWindow | null> = result.snapshot && result.snapshot.windows.length > 0 ? result.snapshot.windows : [null];
  const perWindow = (f: (w: QuotaWindow) => string): CellLine[] => windows.map((w) => ({ text: w ? f(w) : "—", style: same }));
  const provider: CellLine[] = [{ text: t.provider, style: (s) => style.provider(t.provider, s) }];
  if (!compact) provider.push(...t.label.split(", ").map((label) => ({ text: label, style: style.dim })));
  return [
    provider,
    [{ text: t.origin, style: same }],
    [{ text: result.snapshot?.identity ?? "", style: same }],
    [{ text: result.snapshot?.plan ?? "", style: same }],
    perWindow((w) => w.name),
    perWindow(formatUsedLimit),
    perWindow(usageBar),
    perWindow((w) => formatResets(w, now)),
    statusLines(result, windows, now, style),
  ];
}

/** Wrap each window's status to `width`, padding that window's other cells with blank lines. */
function wrapStatus(group: CellLine[][], width: number): CellLine[][] {
  const wrapped = group.map((cells) => [...cells]);
  for (const i of [...WINDOW_COLUMNS, STATUS_COLUMN]) wrapped[i] = [];
  for (const [w, status] of group[STATUS_COLUMN]!.entries()) {
    const lines = wrapTextWithAnsi(status.text, width);
    wrapped[STATUS_COLUMN]!.push(...lines.map((text) => ({ text, style: status.style })));
    for (const i of WINDOW_COLUMNS) wrapped[i]!.push(group[i]![w]!, ...lines.slice(1).map(() => BLANK));
  }
  return wrapped;
}

function pad(text: string, width: number, align: Align): string {
  const fill = " ".repeat(Math.max(0, width - visibleWidth(text)));
  return align === "right" ? fill + text : text + fill;
}

export function buildTable(results: QueryResult[], now: Date, options: TableOptions, style: TableStyle): RenderedTable {
  const shown = options.showInvalid ? results : results.filter(isShownByDefault);
  const hidden = options.showInvalid ? [] : results.filter((r) => !isShownByDefault(r));
  const ordered = sortResults(shown);
  let compact = false;
  let groups = ordered.map((r) => rowCells(r, now, compact, style));
  let visible = COLUMNS.map((_, i) => i);
  const dropped: string[] = [];
  const naturalWidths = (): number[] => COLUMNS.map((c, i) => Math.max(visibleWidth(c.header), ...groups.map((g) => Math.max(...g[i]!.map((l) => visibleWidth(l.text))))));
  let widths = naturalWidths();
  const total = (): number => visible.reduce((sum, i) => sum + widths[i]!, 0) + GAP * (visible.length - 1);
  while (options.width !== null && total() > options.width) {
    if (!compact) {
      compact = true;
      groups = ordered.map((r) => rowCells(r, now, compact, style));
      widths = naturalWidths();
      continue;
    }
    // Wrap Status into whatever width is left before hiding a column.
    if (visible.includes(STATUS_COLUMN)) {
      const statusWidth = options.width - (total() - widths[STATUS_COLUMN]!);
      const longestWord = Math.max(0, ...groups.flatMap((g) => g[STATUS_COLUMN]!.flatMap((l) => l.text.split(/\s+/).map(visibleWidth))));
      if (statusWidth >= Math.min(Math.max(longestWord, MIN_STATUS_WIDTH), MAX_STATUS_WORD)) {
        widths[STATUS_COLUMN] = statusWidth;
        groups = groups.map((g) => wrapStatus(g, statusWidth));
        break;
      }
    }
    const next = DROP_ORDER.find((name) => !dropped.includes(name) && visible.some((i) => COLUMNS[i]!.header === name));
    if (next === undefined) break;
    dropped.push(next);
    visible = visible.filter((i) => COLUMNS[i]!.header !== next);
  }

  const width = options.width ?? total();
  const line = (cells: string[]): string => truncateToWidth(cells.join(" ".repeat(GAP)).trimEnd(), width, "…");
  const rule = style.dim("─".repeat(Math.min(width, total())));
  const lines = [line(visible.map((i) => style.bold(pad(COLUMNS[i]!.header, widths[i]!, COLUMNS[i]!.align)))), rule];
  for (const [index, group] of groups.entries()) {
    if (index > 0) lines.push(rule);
    const height = Math.max(...visible.map((i) => group[i]!.length));
    for (let row = 0; row < height; row++) {
      lines.push(line(visible.map((i) => {
        const cell = group[i]![row];
        const text = cell ? truncateToWidth(cell.text, widths[i]!, "…") : "";
        return cell ? pad(cell.style(text), widths[i]!, COLUMNS[i]!.align) : pad("", widths[i]!, COLUMNS[i]!.align);
      })));
    }
  }
  const notes = [hiddenCaption(hidden)];
  if (compact && !dropped.includes("Provider")) notes.push("provider locations hidden");
  if (dropped.length > 0) notes.push(`columns hidden: ${dropped.join(", ")}`);
  const caption = notes.filter((n): n is string => n !== null).join(" · ") || null;
  return { lines, caption };
}
