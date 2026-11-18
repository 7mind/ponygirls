/**
 * ponygirls-tokemon — the quota table (tokemon's layout): a header line, then
 * one line per quota window, accounts sorted by (provider, login); an
 * account's further windows leave its first cells blank. Rows without quota
 * windows (other than rate-limited ones) are hidden unless asked for and
 * counted in the caption.
 *
 * On a narrow terminal the provider's locations go first, then Status
 * shortens to its state with one qualifier, then columns are hidden: Src,
 * Plan, Login, Resets, Usage. Provider, Window, Used / limit and Status say
 * which row this is and how it is doing: they are never hidden, only cut
 * cell by cell with an ellipsis when even they do not fit. The caption names
 * the hidden columns. The `tokemon` CLI (nix/pkg/tokemon, render.py) follows
 * the same rules.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { columnCells, type Column } from "@ponygirls/pi-ui";
import { formatResets, formatUsedLimit, hiddenCaption, isShownByDefault, rateLimitedStatus, retryQualifier, sortResults, usageBar, usedPercent, windowState, type WindowState } from "./format.ts";
import type { QuotaWindow } from "./quota.ts";
import { staleLabel } from "./freshness.ts";
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
  /** What the table leaves out: stale rows without their marker, hidden rows, hidden columns. */
  notes: string[];
  /** The notes on one line, or null without any. */
  caption: string | null;
}

/** Joins the notes under the table, and a state with its qualifiers. */
export const NOTE_SEPARATOR = " · ";

/** One line of a cell and how to style it. */
interface CellLine {
  text: string;
  style: (s: string) => string;
}

/** One wording of a status, and whether it shows the row's stale marker. */
interface StatusText {
  text: string;
  stale: boolean;
}

/** A row's status: one line, never wrapped. */
interface StatusLine {
  /** Fullest first; the first that fits the column is shown, the last is cut when none does. */
  forms: StatusText[];
  /** Cells the column must offer before another column is hidden for it. */
  need: number;
  /** Cells the column must offer before any cell is cut. */
  least: number;
  style: (s: string) => string;
}

/** The lines of one account: its cells by column, Status apart because its wording depends on the width left. */
interface RowGroup {
  cells: CellLine[][];
  status: StatusLine[];
  stale: boolean;
}

/** Column widths in cells, and the widths Status can settle for. */
interface Measured {
  groups: RowGroup[];
  natural: number[];
  status: { full: number; need: number; least: number };
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
/** Columns hidden on a narrow terminal, first to last. The others say which row this is and how it is doing. */
const HIDE_ORDER = ["Src", "Plan", "Login", "Resets", "Usage"];
/** Which quota and its numbers: cut before who it is and how it is doing. */
const CUT_FIRST = ["Window", "Used / limit"];
const STATUS_COLUMN = COLUMNS.length - 1;
const HEADER_WIDTHS = COLUMNS.map((column) => visibleWidth(column.header));
const GAP = 2;

function stateStyle(style: TableStyle, state: WindowState): (s: string) => string {
  if (state === "EXHAUSTED") return (s) => style.error(style.bold(s));
  if (state === "unlimited") return style.dim;
  return state === "low" ? style.warning : style.success;
}

/** A usage bar with its filled run in the window state's colour (the Status thresholds) and its empty run dim. */
export function styleBar(style: TableStyle, state: WindowState, bar: string): string {
  if (state === "unlimited") return bar;
  const fill = state === "EXHAUSTED" ? style.error : state === "low" ? style.warning : style.success;
  return bar.replace(/█+/g, (run) => fill(run)).replace(/░+/g, (run) => style.dim(run));
}

/**
 * A status from its parts. `states` are the state's own wordings, fullest
 * first (`low 98%`, `low`). `firm` qualifiers say when to look again or how
 * far to trust the row (the retry time, the stale marker): a column is hidden
 * to keep the first of them. `loose` ones (a provider's note) show only in
 * spare width. `full` is everything known, shown where it fits whole.
 */
function statusLine(states: StatusText[], firm: StatusText[], loose: StatusText[], full: StatusText, style: (s: string) => string): StatusLine {
  const state = states[0]!;
  const qualify = (qualifier: StatusText): StatusText => ({ text: `${state.text}${NOTE_SEPARATOR}${qualifier.text}`, stale: state.stale || qualifier.stale });
  const forms = [full, ...firm.map(qualify), ...loose.map(qualify), ...states].filter((form, index, all) => all.findIndex((other) => other.text === form.text) === index);
  return { forms, need: visibleWidth(firm.length > 0 ? qualify(firm[0]!).text : state.text), least: visibleWidth(states.at(-1)!.text), style };
}

const plain = (text: string): StatusText => ({ text, stale: false });

/** An error, or a provider's note standing for the state, claims no width: it takes the cells left over and is cut where they end. */
const unclaimed = (line: StatusLine): StatusLine => ({ ...line, need: 0, least: 0 });

/** Per-window status lines; a row's qualifiers are shown once, on its first line. */
function statusLines(result: QueryResult, windows: Array<QuotaWindow | null>, now: Date, style: TableStyle): StatusLine[] {
  if (result.rateLimited) {
    const retry = retryQualifier(result.retryAt, now);
    return windows.map(() => statusLine([plain("rate limited")], retry === null ? [] : [plain(retry)], [], plain(rateLimitedStatus(result.retryAt, now)), style.warning));
  }
  if (result.error !== null) return windows.map(() => unclaimed(statusLine([plain(result.error!)], [], [], plain(result.error!), (s) => style.error(style.bold(s)))));
  const stale = staleLabel(result, now);
  const note = result.snapshot?.note ?? null;
  const staleText: StatusText[] = stale === null ? [] : [{ text: stale, stale: true }];
  const noteText: StatusText[] = note === null ? [] : [plain(note)];
  const everything = (parts: StatusText[]): StatusText => ({ text: parts.map((part) => part.text).join(NOTE_SEPARATOR), stale: stale !== null });
  return windows.map((window, index) => {
    if (window === null) {
      // No quota windows: the provider's note, else the stale marker, stands for the state.
      const [state, ...rest] = [...noteText, ...staleText];
      if (state === undefined) return statusLine([plain("ok")], [], [], plain("ok"), style.success);
      return unclaimed(statusLine([state], rest, [], everything([state, ...rest]), style.dim));
    }
    const state = windowState(window);
    const percent = usedPercent(window);
    const states = percent === null ? [plain(state)] : [plain(`${state} ${percent}%`), plain(state)];
    const lineStyle = stale === null ? stateStyle(style, state) : style.warning;
    if (index > 0) return statusLine(states, [], [], states[0]!, lineStyle);
    return statusLine(states, staleText, noteText, everything([states[0]!, ...noteText, ...staleText]), lineStyle);
  });
}

function rowGroup(result: QueryResult, now: Date, compact: boolean, style: TableStyle): RowGroup {
  const t = result.target;
  const windows: Array<QuotaWindow | null> = result.snapshot && result.snapshot.windows.length > 0 ? result.snapshot.windows : [null];
  const perWindow = (f: (w: QuotaWindow) => string): CellLine[] => windows.map((w) => ({ text: w ? f(w) : "—", style: same }));
  const provider: CellLine[] = [{ text: t.provider, style: (s) => style.provider(t.provider, s) }];
  if (!compact) provider.push(...t.label.split(", ").map((label) => ({ text: label, style: style.dim })));
  return {
    cells: [
      provider,
      [{ text: t.origin, style: same }],
      [{ text: result.snapshot?.identity ?? "", style: same }],
      [{ text: result.snapshot?.plan ?? "", style: same }],
      perWindow((w) => w.name),
      perWindow(formatUsedLimit),
      windows.map((w) => (w ? { text: usageBar(w), style: (bar: string) => styleBar(style, windowState(w), bar) } : { text: "—", style: same })),
      perWindow((w) => formatResets(w, now)),
    ],
    status: statusLines(result, windows, now, style),
    stale: staleLabel(result, now) !== null,
  };
}

/** With `wholeStatus` (the view of invalid rows, read for its errors) columns are hidden for the full wording of each status, not for its short one. */
function measure(groups: RowGroup[], wholeStatus: boolean): Measured {
  const statuses = groups.flatMap((group) => group.status);
  const widest = (pick: (line: StatusLine) => number): number => Math.max(HEADER_WIDTHS[STATUS_COLUMN]!, ...statuses.map(pick));
  const full = widest((line) => visibleWidth(line.forms[0]!.text));
  return {
    groups,
    natural: HEADER_WIDTHS.slice(0, STATUS_COLUMN).map((header, i) => Math.max(header, ...groups.flatMap((group) => group.cells[i]!.map((line) => visibleWidth(line.text))))),
    status: { full, need: wholeStatus ? full : widest((line) => line.need), least: widest((line) => line.least) },
  };
}

function tableWidth(visible: number[], widths: number[]): number {
  return visible.reduce((sum, i) => sum + widths[i]!, 0) + GAP * (visible.length - 1);
}

/** Take cells from the widest of `columns` still above its floor (the leftmost of equals) until the visible columns fit. */
function shrink(columns: number[], visible: number[], widths: number[], floors: number[], width: number): void {
  for (let excess = tableWidth(visible, widths) - width; excess > 0; excess--) {
    const candidates = columns.filter((i) => widths[i]! > floors[i]!);
    if (candidates.length === 0) return;
    const widest = candidates.reduce((a, b) => (widths[b]! > widths[a]! ? b : a));
    widths[widest]!--;
  }
}

/** The visible columns and every column's width for `width` terminal cells (null: no limit). */
function arrange(measured: Measured, width: number | null): { visible: number[]; widths: number[] } {
  const { natural, status } = measured;
  let visible = COLUMNS.map((_, i) => i);
  const withStatus = (statusWidth: number): number[] => [...natural, statusWidth];
  if (width === null || tableWidth(visible, withStatus(status.full)) <= width) return { visible, widths: withStatus(status.full) };
  for (const name of HIDE_ORDER) {
    if (tableWidth(visible, withStatus(status.need)) <= width) break;
    visible = visible.filter((i) => COLUMNS[i]!.header !== name);
  }
  // Status takes the cells left over; each line shows its fullest wording that fits them.
  const spare = width - tableWidth(visible, withStatus(0));
  if (spare >= status.least) return { visible, widths: withStatus(Math.min(spare, status.full)) };
  // Nothing left to hide: cut the quota's details first, then names and states, and headers last.
  const widths = withStatus(status.least);
  shrink(visible.filter((i) => CUT_FIRST.includes(COLUMNS[i]!.header)), visible, widths, HEADER_WIDTHS, width);
  shrink(visible, visible, widths, HEADER_WIDTHS, width);
  shrink(visible, visible, widths, widths.map(() => 1), width);
  return { visible, widths };
}

export function buildTable(results: QueryResult[], now: Date, options: TableOptions, style: TableStyle): RenderedTable {
  const shown = options.showInvalid ? results : results.filter(isShownByDefault);
  const hidden = options.showInvalid ? [] : results.filter((r) => !isShownByDefault(r));
  const ordered = sortResults(shown);
  const all = COLUMNS.map((_, i) => i);
  let measured = measure(ordered.map((r) => rowGroup(r, now, false, style)), options.showInvalid);
  // The provider's locations go first: anything else that does not fit hides them.
  if (options.width !== null && tableWidth(all, [...measured.natural, measured.status.full]) > options.width) measured = measure(ordered.map((r) => rowGroup(r, now, true, style)), options.showInvalid);
  const { visible, widths } = arrange(measured, options.width);

  const columns: Column[] = visible.map((i) => ({ header: COLUMNS[i]!.header, width: widths[i]!, align: COLUMNS[i]!.align }));
  const line = (cells: string[]): string => (options.width === null ? columnCells(columns, cells, GAP) : truncateToWidth(columnCells(columns, cells, GAP), options.width, "…"));
  const lines = [style.dim(line(columns.map((column) => column.header)))];
  let staleUnmarked = 0;
  for (const group of measured.groups) {
    const statusWidth = widths[STATUS_COLUMN]!;
    const status = group.status.map((s) => ({ shown: s.forms.find((form) => visibleWidth(form.text) <= statusWidth) ?? s.forms.at(-1)!, style: s.style }));
    if (group.stale && !status[0]!.shown.stale) staleUnmarked++;
    const cells: CellLine[][] = [...group.cells, status.map((s) => ({ text: s.shown.text, style: s.style }))];
    const height = Math.max(...visible.map((i) => cells[i]!.length));
    for (let row = 0; row < height; row++) {
      lines.push(line(visible.map((i) => {
        const cell = cells[i]![row];
        return cell ? cell.style(truncateToWidth(cell.text, widths[i]!, "…")) : "";
      })));
    }
  }
  const dropped = COLUMNS.filter((_, i) => !visible.includes(i)).map((column) => column.header);
  const notes = [
    staleUnmarked > 0 ? `⚠ ${staleUnmarked} stale quota row(s)` : null,
    hiddenCaption(hidden),
    dropped.length > 0 ? `hidden at this width: ${dropped.join(", ")}` : null,
  ].filter((note): note is string => note !== null);
  return { lines, notes, caption: notes.join(NOTE_SEPARATOR) || null };
}
