import { Key, Text, matchesKey, sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi, type TuiMouseEvent } from "@earendil-works/pi-tui";
import {
  HINT, MARKER_WIDTH, PanelLayout, columnCells, columnHeader, formatAgo, formatBytes, formatCount, frameRule, frameTitle, homeRelative,
  keyHints, listRow, stateColor,
  type BorderBadge, type Column, type FrameTitle, type KeyHint, type PanelParts, type UiFg, type UiState, type UiTheme,
} from "@ponygirls/pi-ui";
import type { State } from "./runtime.ts";
import { reportText, scopeState, type ScopeState, type ScopeStatus, type StatusSnapshot } from "./workspace.ts";

const DETAILS_HINT = "/cg status for details";
const EMPTY_NOTICE = `Codegraph: nothing indexed in this checkout yet · ${DETAILS_HINT}`;
const ERROR_PREFIX = /^(?:Error: )+/;
export const BADGE_GLYPH = "🕸️";

export interface StateNotice {
  text: string;
  level: "info" | "error";
}

/**
 * One line per state change that needs the user's attention; the full detail
 * (status JSON, CLI output) stays in the state and is shown by /cg status.
 */
export function stateNotice(state: State): StateNotice | null {
  if (state.phase === "empty") return { text: EMPTY_NOTICE, level: "info" };
  if (state.phase !== "error") return null;
  const first = state.detail.split("\n").map((line) => line.replace(ERROR_PREFIX, "").trim()).find((line) => line !== "");
  const summary = first === undefined ? "failed" : first.replace(/:$/, "");
  return { text: `Codegraph: ${summary} · ${DETAILS_HINT}`, level: "error" };
}

/**
 * Border badge: the glyph alone while the index needs nothing; a word only for
 * work in progress, a state the user chose, and failure. `queries` is the
 * number of codegraph tool calls running now.
 */
export function codegraphBadge(phase: State["phase"], queries: number): BorderBadge {
  const glyph = BADGE_GLYPH;
  if (queries > 0) return { glyph, state: "running", label: queries > 1 ? `querying ${queries}` : "querying", compact: "●" };
  switch (phase) {
    case "working": return { glyph, state: "running", label: "indexing", compact: "●" };
    case "error": return { glyph, state: "error", label: "error", compact: "✖" };
    case "cancelled": return { glyph, state: "attention", label: "cancelled", compact: "!" };
    case "skipped": return { glyph, state: "settled", label: "off", compact: "" };
    case "empty": return { glyph, state: "settled", label: "empty", compact: "" };
    case "idle":
    case "ready": return { glyph, state: "settled", label: "", compact: "" };
  }
}

// ---- /cg status pane ---------------------------------------------------------

const PANE_TITLE = "Codegraph";
/** Spaces between table columns. */
const COLUMN_GAP = 2;
/** A longer path is shortened to this before a column is hidden to make room for it. */
const SHORTENED_CHECKOUT_COLUMN = 32;
/** Narrowest the checkout column gets once only it and the state are left. */
const MIN_CHECKOUT_COLUMN = 8;
/** The list never takes more than this share of the terminal's rows, nor fewer than the minimum. */
const LIST_SHARE = 3;
const MIN_LIST_ROWS = 3;
const UNKNOWN = "—";
const ZERO = "·";
const EMPTY_TEXT = "No checkouts listed. /cg discover PATH finds them; /cg init --workspace PATH indexes a directory without Git.";
/** What a tab becomes before wrapping, as in pi-tui's Text. */
const TAB = "   ";
const DETAILS_KEY = "d";

interface StateLook {
  /** The word in the table and the title; the badge's word for work in progress. */
  word: string;
  state: UiState;
}

const STATE_LOOK: Readonly<Record<ScopeState, StateLook>> = {
  ready: { word: "ready", state: "ok" },
  working: { word: "indexing", state: "running" },
  error: { word: "error", state: "error" },
  cancelled: { word: "cancelled", state: "attention" },
  "busy elsewhere": { word: "busy elsewhere", state: "settled" },
  empty: { word: "empty", state: "settled" },
  skipped: { word: "skipped", state: "settled" },
  idle: { word: "idle", state: "settled" },
};
/** The states the title names instead of the index count: failures first, then work, then what is merely not prepared. */
const NOT_READY: readonly ScopeState[] = ["error", "cancelled", "working", "busy elsewhere", "empty", "skipped", "idle"];

interface TableColumn {
  header: string;
  align: Column["align"];
  /** `stay`: which checkout and how it is doing; a number: the order a narrow pane hides it in, lowest first. */
  narrow: "stay" | number;
}

const CHECKOUT_COLUMN = 0;
const TABLE_COLUMNS: readonly TableColumn[] = [
  { header: "CHECKOUT", align: "left", narrow: "stay" },
  { header: "STATE", align: "left", narrow: "stay" },
  { header: "FILES", align: "right", narrow: 2 },
  { header: "SYMBOLS", align: "right", narrow: 1 },
  { header: "SIZE", align: "right", narrow: 3 },
  { header: "CHECKED", align: "left", narrow: 4 },
];

/** Parts of one cell, each plain text with its colour; `secondary` is dim, or muted on the selection band. */
type Cell = readonly { text: string; color: UiFg | "secondary" }[];

interface TableLayout {
  /** Indices into TABLE_COLUMNS, in table order. */
  shown: number[];
  columns: Column[];
  hidden: string[];
}

/** One scope with its check time parsed. */
interface PaneRow {
  scope: ScopeStatus;
  path: string;
  state: ScopeState;
  checkedMs: number | null;
}

/** `SYMBOLS` → `Symbols`, for the note that names hidden columns. */
function columnName(header: string): string {
  return `${header.slice(0, 1)}${header.slice(1).toLowerCase()}`;
}

function instant(at: string): number {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new Error(`Invalid Codegraph check time: ${at}`);
  return ms;
}

/** `2026-11-17 20:58 UTC`. */
function utcMinute(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, "YYYY-MM-DDTHH:MM".length).replace("T", " ")} UTC`;
}

/** Text of a failure without JavaScript's `Error: ` prefixes and trailing blank lines. */
function failureText(detail: string): string {
  return detail.replace(ERROR_PREFIX, "").trimEnd();
}

const HEALTH_RECORD_NOTE = "health record in details";

/** A line that is one complete JSON object: the CLI's health record the runtime appends to a failure. */
function isHealthRecord(line: string): boolean {
  if (!line.startsWith("{") || !line.endsWith("}")) return false;
  try { JSON.parse(line); return true; }
  catch { return false; }
}

/** A failure for the pane: its text, with a health record named instead of printed (the details show it whole). */
function failureSummary(detail: string): { text: string; healthRecord: boolean } {
  const lines = failureText(detail).split("\n");
  const kept = lines.filter((line) => !isHealthRecord(line.trim()));
  return { text: kept.join("\n").trimEnd(), healthRecord: kept.length < lines.length };
}

/** A path cut to `width` columns in its middle; the end, which names the checkout, keeps the larger share. */
function shortenMiddle(text: string, width: number): string {
  const full = visibleWidth(text);
  if (full <= width) return text;
  const head = Math.floor((width - 1) / 3);
  const tail = Math.max(0, width - 1 - head);
  return `${sliceByColumn(text, 0, head, true)}…${sliceByColumn(text, full - tail, tail, true)}`;
}

function cellWidth(cell: Cell): number {
  return cell.reduce((sum, part) => sum + visibleWidth(part.text), 0);
}

export interface StatusPaneOptions {
  /** What `/cg status` reports for the chosen scopes; the pane shows this snapshot until it closes. */
  status: StatusSnapshot;
  /** The user's home directory, shown as `~`. */
  home: string;
  theme: UiTheme;
  keys: { matches(data: string, action: "tui.select.cancel"): boolean };
  now(): number;
  rows(): number;
  requestRender(): void;
  close(): void;
}

/**
 * `/cg status` and the badge click: one row per indexed scope, the selected
 * row's last check under the list, and the complete text report behind `d`.
 */
export class CodegraphStatusPane extends PanelLayout {
  readonly capturesViewportInput = true;

  private readonly options: StatusPaneOptions;
  private readonly rows: readonly PaneRow[];
  /** The complete text report, wrapped as the read-only status view wraps it. */
  private readonly report: Text;
  private selected: number;
  private details = false;
  /** First body line shown in the open view; rendering bounds it to the lines there are. */
  private top = 0;
  /** Greatest useful `top`, unknown until the open view has been laid out. */
  private lastTop = Number.POSITIVE_INFINITY;
  /** Body rows at the last layout: the page size. */
  private viewport = 1;

  constructor(options: StatusPaneOptions) {
    super((width) => this.renderParts(width));
    this.options = options;
    this.rows = options.status.scopes.map((scope) => ({
      scope, path: homeRelative(scope.root, options.home), state: scopeState(scope),
      checkedMs: scope.lastCheck === null ? null : instant(scope.lastCheck.at),
    }));
    this.report = new Text(reportText(options.status), 0, 0);
    this.selected = Math.max(0, options.status.scopes.findIndex((scope) => scope.isDefault));
  }

  // ---- rendering --------------------------------------------------------------

  private paint(cell: Cell, selected: boolean): string {
    // Dim falls below readable contrast on the selection background.
    const secondary: UiFg = selected ? "muted" : "dim";
    return cell.map((part) => this.options.theme.fg(part.color === "secondary" ? secondary : part.color, part.text)).join("");
  }

  private count(value: number | null): Cell {
    if (value === null) return [{ text: UNKNOWN, color: "secondary" }];
    return value === 0 ? [{ text: ZERO, color: "secondary" }] : [{ text: formatCount(value), color: "text" }];
  }

  private cells(row: PaneRow, checkoutWidth: number): Cell[] {
    const { scope } = row;
    const look = STATE_LOOK[row.state];
    const state: Cell = [{ text: look.word, color: stateColor(look.state) }];
    return [
      [{ text: shortenMiddle(row.path, checkoutWidth), color: "text" }],
      scope.isDefault && this.rows.length > 1 ? [...state, { text: " · default", color: "muted" }] : state,
      this.count(scope.counts === null ? null : scope.counts.files),
      this.count(scope.counts === null ? null : scope.counts.symbols),
      !scope.size.ok ? [{ text: UNKNOWN, color: "secondary" }]
        : scope.size.value.totalBytes === 0 ? [{ text: ZERO, color: "secondary" }]
        : [{ text: formatBytes(scope.size.value.totalBytes), color: "text" }],
      [{ text: row.checkedMs === null ? "never" : formatAgo(row.checkedMs, this.options.now()), color: "muted" }],
    ];
  }

  /**
   * Columns are shown whole or not at all. A long path first gives up width in
   * its middle; then columns are hidden, least important first; a path alone
   * with the state takes what is left.
   */
  private layout(width: number): TableLayout {
    const natural = this.rows.map((row) => this.cells(row, Number.POSITIVE_INFINITY));
    const widths = TABLE_COLUMNS.map((column, index) => Math.max(visibleWidth(column.header), ...natural.map((cells) => cellWidth(cells[index]!))));
    // Deleting from a set keeps the order of the rest: the shown columns stay in table order.
    const shown = new Set(TABLE_COLUMNS.keys());
    const room = (): number => width - MARKER_WIDTH - COLUMN_GAP * (shown.size - 1)
      - [...shown].reduce((sum, index) => sum + (index === CHECKOUT_COLUMN ? 0 : widths[index]!), 0);
    const wanted = Math.min(widths[CHECKOUT_COLUMN]!, SHORTENED_CHECKOUT_COLUMN);
    const hideOrder = TABLE_COLUMNS
      .flatMap((column, index) => (typeof column.narrow === "number" ? [{ index, rank: column.narrow }] : []))
      .sort((a, b) => a.rank - b.rank);
    for (const { index } of hideOrder) {
      if (room() >= wanted) break;
      shown.delete(index);
    }
    widths[CHECKOUT_COLUMN] = Math.max(Math.min(MIN_CHECKOUT_COLUMN, widths[CHECKOUT_COLUMN]!), Math.min(widths[CHECKOUT_COLUMN]!, room()));
    return {
      shown: [...shown],
      columns: [...shown].map((index) => ({ header: TABLE_COLUMNS[index]!.header, width: widths[index]!, align: TABLE_COLUMNS[index]!.align })),
      hidden: TABLE_COLUMNS.filter((_column, index) => !shown.has(index)).map((column) => columnName(column.header)),
    };
  }

  /** `1 index`, or what is not ready: `1 error · 2 indexing`. */
  private summary(): string | undefined {
    const th = this.options.theme;
    const parts: string[] = [];
    if (this.options.status.discoveryError !== null) parts.push(th.fg(stateColor("error"), "discovery failed"));
    for (const state of NOT_READY) {
      const count = this.rows.filter((row) => row.state === state).length;
      if (count > 0) parts.push(th.fg(stateColor(STATE_LOOK[state].state), `${count} ${STATE_LOOK[state].word}`));
    }
    if (parts.length > 0) return parts.join(th.fg("dim", " · "));
    return this.rows.length === 0 ? undefined : th.fg("muted", `${this.rows.length} ${this.rows.length === 1 ? "index" : "indexes"}`);
  }

  private wrap(text: string, width: number): string[] {
    return wrapTextWithAnsi(text.replaceAll("\t", TAB), Math.max(1, width));
  }

  private discoveryFailure(width: number): string[] {
    const { discoveryError } = this.options.status;
    if (discoveryError === null) return [];
    return this.wrap(`discovery failed: ${failureText(discoveryError)}`, width).map((line) => this.options.theme.fg(stateColor("error"), line));
  }

  /** The selected scope: its last check, where it lives, and what went wrong. */
  private detail(row: PaneRow, width: number): string[] {
    const th = this.options.theme;
    const { scope } = row;
    const label = (text: string): string => th.fg("muted", text);
    const value = (text: string): string => th.fg("text", text);
    const separator = th.fg("dim", " · ");
    const error = (text: string): string[] => this.wrap(failureText(text), width).map((line) => th.fg(stateColor("error"), line));

    const checked = scope.lastCheck === null ? null : STATE_LOOK[scope.lastCheck.state.phase];
    const check = [`${label("last check")} ${checked === null ? value("never") : th.fg(stateColor(checked.state), checked.word)}`];
    if (row.checkedMs !== null) check.push(value(utcMinute(row.checkedMs)));
    check.push(scope.size.ok
      ? value(`database ${formatBytes(scope.size.value.databaseBytes)}, total ${formatBytes(scope.size.value.totalBytes)}`)
      : label(`size unavailable: ${failureText(scope.size.error)}`));
    const lines = this.wrap(check.join(separator), width);
    lines.push(...this.wrap(scope.commonDir === null ? label("workspace index, not a Git checkout")
      : `${label("common dir")} ${value(homeRelative(scope.commonDir, this.options.home))}`, width));
    if (scope.busyElsewhere !== null) {
      // A scope that was not prepared yet is prepared by the next query; otherwise what was known before the attempt stands.
      const next = row.state === "busy elsewhere" ? "the next query or /cg sync tries again" : "the last check stands; /cg sync tries again";
      lines.push(...this.wrap([label("busy elsewhere"), value(utcMinute(instant(scope.busyElsewhere.at))),
        label(`another process held the index lock; ${next}`)].join(separator), width));
    }
    if (scope.lastFailure !== null) {
      // The failure of the last check needs no second timestamp.
      if (scope.lastCheck === null || scope.lastCheck.state.phase !== "error") {
        lines.push(...this.wrap(`${label("last failure")} ${value(utcMinute(instant(scope.lastFailure.at)))}`, width));
      }
      const failure = failureSummary(scope.lastFailure.detail);
      lines.push(...error(failure.text));
      if (failure.healthRecord) lines.push(...this.wrap(label(HEALTH_RECORD_NOTE), width));
    }
    if (scope.size.ok && scope.size.value.partial) lines.push(...this.wrap(label(`size is partial: ${scope.size.value.detail}`), width));
    return lines;
  }

  /** Dim text under the row gutter, wrapped between words. */
  private note(text: string, width: number): string[] {
    const gutter = " ".repeat(MARKER_WIDTH);
    return wrapTextWithAnsi(text, Math.max(1, width - MARKER_WIDTH)).map((line) => this.options.theme.fg("dim", `${gutter}${line}`));
  }

  private tableView(width: number): { header: string[]; body: string[]; hints(overflows: boolean): KeyHint[] } {
    const th = this.options.theme;
    const title: FrameTitle = { title: PANE_TITLE, right: this.summary() };
    const details: KeyHint = { key: DETAILS_KEY, action: "details" };
    if (this.rows.length === 0) {
      return {
        header: [frameTitle(th, width, title, "none").line],
        body: [...this.discoveryFailure(width), ...this.wrap(th.fg("muted", EMPTY_TEXT), width)],
        hints: () => [details, HINT.close],
      };
    }
    const layout = this.layout(width);
    const capacity = Math.min(this.rows.length, Math.max(MIN_LIST_ROWS, Math.floor(this.options.rows() / LIST_SHARE)));
    const first = Math.max(0, Math.min(this.selected - Math.floor(capacity / 2), this.rows.length - capacity));
    if (capacity < this.rows.length) title.meta = `${first + 1}–${first + capacity} of ${this.rows.length}`;
    const header = [frameTitle(th, width, title, "none").line, truncateToWidth(columnHeader(th, layout.columns, COLUMN_GAP), width, "…")];
    this.rows.slice(first, first + capacity).forEach((row, offset) => {
      const selected = first + offset === this.selected;
      const cells = this.cells(row, layout.columns[CHECKOUT_COLUMN]!.width);
      header.push(listRow(th, width, columnCells(layout.columns, layout.shown.map((index) => this.paint(cells[index]!, selected)), COLUMN_GAP), selected));
    });
    if (layout.hidden.length > 0) header.push(...this.note(`hidden at this width: ${layout.hidden.join(", ")}`, width));
    header.push(frameRule(th, width));
    return {
      header,
      body: [...this.discoveryFailure(width), ...this.detail(this.rows[this.selected]!, width)],
      hints: (overflows) => [HINT.select, ...(overflows ? [HINT.page] : []), details, HINT.close],
    };
  }

  private detailsView(width: number): { header: string[]; body: string[]; hints(overflows: boolean): KeyHint[] } {
    const th = this.options.theme;
    return {
      header: [frameTitle(th, width, { title: PANE_TITLE, meta: "details", right: this.summary() }, "none").line],
      body: this.report.render(width),
      hints: () => [HINT.scroll, HINT.page, { key: DETAILS_KEY, action: "table" }, HINT.close],
    };
  }

  private renderParts(width: number): PanelParts {
    const th = this.options.theme;
    const view = this.details ? this.detailsView(width) : this.tableView(width);
    const footer = (overflows: boolean): string[] => [frameRule(th, width), ...keyHints(th, width, view.hints(overflows)).lines];
    const viewport = (chrome: string[]): number => Math.max(1, this.bodyHeight(this.options.rows() - view.header.length - chrome.length));
    let chrome = footer(false);
    if (view.body.length > viewport(chrome)) chrome = footer(true);
    const visible = viewport(chrome);
    const lastTop = Math.max(0, view.body.length - visible);
    // Sizing renders use the natural height, not the rows the pane has: they must not bound scrolling.
    if (!this.isMeasuring) { this.lastTop = lastTop; this.viewport = visible; }
    const start = Math.min(this.top, lastTop);
    return { header: view.header, body: view.body.slice(start, start + visible), footer: chrome };
  }

  // ---- input -----------------------------------------------------------------------

  private scrollBy(lines: number): void {
    this.top = Math.max(0, Math.min(this.top, this.lastTop) + lines);
  }

  /** A different body starts at its first line. */
  private restart(): void {
    this.top = 0;
    this.lastTop = Number.POSITIVE_INFINITY;
  }

  handleInput(data: string): void {
    if (this.options.keys.matches(data, "tui.select.cancel") || data === "q") { this.options.close(); return; }
    const page = Math.max(1, this.viewport - 1);
    if (data === DETAILS_KEY) { this.details = !this.details; this.restart(); }
    else if (matchesKey(data, Key.pageUp)) this.scrollBy(-page);
    else if (matchesKey(data, Key.pageDown)) this.scrollBy(page);
    else if (matchesKey(data, Key.home)) this.scrollBy(Number.NEGATIVE_INFINITY);
    else if (matchesKey(data, Key.end)) this.scrollBy(Number.POSITIVE_INFINITY);
    else if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
      const step = matchesKey(data, Key.up) ? -1 : 1;
      if (this.details) this.scrollBy(step);
      else {
        const next = Math.max(0, Math.min(this.rows.length - 1, this.selected + step));
        if (next !== this.selected) { this.selected = next; this.restart(); }
      }
    } else return;
    this.options.requestRender();
  }

  override handleMouse(event: TuiMouseEvent): ReturnType<PanelLayout["handleMouse"]> {
    if (event.type === "wheel" && event.wheelDelta) this.scrollBy(event.wheelDelta);
    return super.handleMouse(event);
  }
}
