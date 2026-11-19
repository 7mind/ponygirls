/**
 * `/bg`: one list/detail inspector over the session's retained tasks, and the
 * renderer for completion notices. Output is a read-only, sanitized line view
 * of the PTY transcript (not a terminal emulator), read in bounded windows.
 */
import { Key, matchesKey, sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import {
  HINT, KEY, PanelLayout, type PanelParts, MARKER_WIDTH, columnCells, columnHeader, frameRule, frameTitle, keyHints, listRow, stateColor,
  type Column, type FrameTitle, type KeyHint, type UiFg, type UiTheme,
} from "@ponygirls/pi-ui";
import type { TaskBackend } from "./backend.ts";
import {
  BgTaskError, MAX_LIST_ITEMS, MAX_READ_BYTES, isFinalized, type CompletionDetails, type SignalName, type TaskRecord,
} from "./protocol.ts";
import { consumableLength, decodeAndSanitize, displayValue, leadingContinuationBytes } from "./terminal-text.ts";
import { exitCode, exitFailed, formatSize, shortTaskId, shownReason, shownState, stateGlyph, taskStateColor } from "./present.ts";
import { elapsed, formatExit, noticeLabel, noticeStatus, stateLabel } from "./tool.ts";

/** Most log bytes held in memory by the detail view. */
export const VIEW_WINDOW_BYTES = 131072;
/** Bytes loaded per step when scrolling back past the window start. */
export const VIEW_SCROLL_CHUNK_BYTES = MAX_READ_BYTES;
export const VIEW_REFRESH_MS = 500;
/** Rows not available to list or log lines: the panel frame, hints, message, and pi's footer. */
const CHROME_ROWS = 9;
/** Spaces between list columns. */
const COLUMN_GAP = 2;
/** Reserve this much of a long label before spending width on secondary columns. */
const PREFERRED_LABEL_COLUMN = 32;
/** Let the label go shorter to keep a whole exit result visible. */
const LABEL_FLOOR_WITH_EXIT = 24;
const EXIT_DROP_RANK = 4;
const MAX_STATE_COLUMN = 32;
const MAX_EXIT_COLUMN = 28;
/** Narrowest a `shrink` column gets when even the columns that always stay do not fit. */
const MIN_SHRUNK_COLUMN = 8;

/** The empty list, also for clients without the pane. */
export const NO_TASKS_TEXT = "No background tasks in this session. The model starts them with bg_task.";

/**
 * Actions that apply to the task in its current state. Keys that do not apply
 * stay bound without being advertised, as do `r`, `q`, End and `j`/`k`.
 */
function taskHints(task: TaskRecord): KeyHint[] {
  if (isFinalized(task)) return [{ key: "c", action: "clear" }];
  return [{ key: "t", action: "terminate" }, { key: "s", action: "signal" }, { key: "m", action: task.notify ? "mute notice" : "unmute notice" }];
}

function listHints(selected: TaskRecord | null): KeyHint[] {
  if (!selected) return [HINT.close];
  return [HINT.select, { key: KEY.enter, action: "open" }, ...taskHints(selected), HINT.close];
}

function detailHints(task: TaskRecord, following: boolean): KeyHint[] {
  return [HINT.scroll, HINT.page, ...(following ? [] : [{ key: "f", action: "follow" }]), ...taskHints(task), HINT.back];
}

interface ListColumn {
  header: string;
  max: number;
  /**
   * What a list too wide for the pane does with the column: `stay` keeps it
   * whole (which task, how it is doing), a number hides it (lowest first),
   * `shrink` takes any remaining room, up to the cell's natural width.
   */
  narrow: "stay" | "shrink" | number;
}

const LIST_COLUMNS: readonly ListColumn[] = [
  { header: "TASK", max: Number.POSITIVE_INFINITY, narrow: "stay" },
  { header: "LABEL", max: Number.POSITIVE_INFINITY, narrow: "shrink" },
  { header: "STATE", max: MAX_STATE_COLUMN, narrow: "stay" },
  { header: "TIME", max: Number.POSITIVE_INFINITY, narrow: 3 },
  { header: "EXIT", max: MAX_EXIT_COLUMN, narrow: EXIT_DROP_RANK },
  { header: "NOTICE", max: Number.POSITIVE_INFINITY, narrow: 2 },
  { header: "LOG", max: Number.POSITIVE_INFINITY, narrow: 1 },
];

/** The list columns that fit a width, and the names of those that do not. */
interface ListLayout {
  /** Indices into LIST_COLUMNS, in table order. */
  shown: number[];
  columns: Column[];
  hidden: string[];
}

/** `TIME` → `Time`, for the note that names hidden columns. */
function columnName(header: string): string {
  return `${header.slice(0, 1)}${header.slice(1).toLowerCase()}`;
}

/** One list cell: plain text and its colour. */
interface Cell {
  text: string;
  color: UiFg;
}

/**
 * Plain text cut to `width` columns before styling: truncating styled text
 * appends a full SGR reset, which would end the selection background mid-row.
 */
function clip(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;
  return `${sliceByColumn(text, 0, Math.max(0, width - 1), true)}…`;
}

export interface ViewerDeps {
  backend(): Promise<TaskBackend>;
  noticeState(task: TaskRecord): string | null;
  noticeForgotten(task: TaskRecord): void;
  confirm(title: string, message: string): Promise<boolean>;
  selectSignal(): Promise<SignalName | undefined>;
  requestRender(): void;
  rows(): number;
  close(): void;
  theme: UiTheme;
  now(): number;
}

interface DetailState {
  task: TaskRecord;
  start: number;
  bytes: Uint8Array;
  size: number;
  follow: boolean;
  /** Lines hidden below the viewport while paused. */
  scroll: number;
  artifact: string | null;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export class BgInspector extends PanelLayout implements Component {
  private readonly deps: ViewerDeps;
  private items: TaskRecord[] = [];
  private upper: number | null = null;
  private nextAfter: number | null = null;
  private selected = 0;
  private detail: DetailState | null = null;
  private message: string | null = null;
  private busy: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(deps: ViewerDeps) {
    super((width) => this.renderParts(width));
    this.deps = deps;
    this.enqueue(async () => {
      const backend = await deps.backend();
      if (this.disposed) return;
      this.unsubscribe = backend.onChanged(() => void this.refresh());
      await this.loadList(true);
    });
    this.timer = setInterval(() => void this.refresh(), VIEW_REFRESH_MS);
  }

  get loadedBytes(): number {
    return this.detail?.bytes.length ?? 0;
  }

  /** Resolves when queued loads and actions have finished. */
  idle(): Promise<void> {
    return this.busy;
  }

  refresh(): Promise<void> {
    return this.enqueue(async () => {
      if (this.detail) await this.loadDetail();
      else await this.loadList(false);
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  invalidate(): void { super.invalidate(); }

  private enqueue(work: () => Promise<void>): Promise<void> {
    this.busy = this.busy.then(async () => {
      if (this.disposed) return;
      try {
        await work();
      } catch (error) {
        this.message = error instanceof BgTaskError ? `${error.code}: ${error.message.replace(/^[A-Z_]+: /, "")}` : String(error);
      }
      if (!this.disposed) this.deps.requestRender();
    });
    return this.busy;
  }

  // ---- data -------------------------------------------------------------------

  private async loadList(reset: boolean): Promise<void> {
    const backend = await this.deps.backend();
    const keep = reset ? MAX_LIST_ITEMS : Math.max(MAX_LIST_ITEMS, this.items.length);
    const items: TaskRecord[] = [];
    let page = await backend.list(null, null, MAX_LIST_ITEMS);
    items.push(...page.items);
    while (page.next !== null && items.length < keep) {
      page = await backend.list(page.upper, page.next, MAX_LIST_ITEMS);
      items.push(...page.items);
    }
    this.items = items;
    this.upper = page.upper;
    this.nextAfter = page.next;
    this.selected = Math.min(this.selected, Math.max(0, items.length - 1));
  }

  private async loadMore(): Promise<void> {
    if (this.nextAfter === null || this.upper === null) return;
    const backend = await this.deps.backend();
    const page = await backend.list(this.upper, this.nextAfter, MAX_LIST_ITEMS);
    this.items.push(...page.items);
    this.nextAfter = page.next;
  }

  private async readRange(backend: TaskBackend, task: TaskRecord, from: number, to: number): Promise<{ bytes: Uint8Array; size: number; task: TaskRecord }> {
    let bytes: Uint8Array = new Uint8Array();
    let size = from;
    let latest = task;
    let offset = from;
    while (offset < to) {
      const w = await backend.read(task.id, offset, Math.min(MAX_READ_BYTES, to - offset));
      latest = w.task;
      size = w.size;
      if (w.bytes.length === 0) break;
      bytes = concat(bytes, w.bytes);
      offset += w.bytes.length;
    }
    return { bytes, size, task: latest };
  }

  private async openDetail(task: TaskRecord): Promise<void> {
    this.detail = { task, start: 0, bytes: new Uint8Array(), size: 0, follow: true, scroll: 0, artifact: null };
    await this.loadDetail();
  }

  private async loadDetail(): Promise<void> {
    const d = this.detail;
    if (!d) return;
    const backend = await this.deps.backend();
    try {
      // Check current availability: the record may have been cleared.
      d.task = await backend.get(d.task.id);
    } catch (error) {
      if (error instanceof BgTaskError && error.code === "NOT_FOUND") {
        d.artifact = "this task was cleared; its record and log no longer exist";
        return;
      }
      throw error;
    }
    try {
      const probe = await backend.read(d.task.id, "tail", 1);
      d.size = probe.size;
      d.task = probe.task;
      d.artifact = null;
    } catch (error) {
      if (error instanceof BgTaskError && (error.code === "ARTIFACT_MISSING" || error.code === "ARTIFACT_UNREADABLE")) {
        d.artifact = `terminal log ${error.code === "ARTIFACT_MISSING" ? "is missing" : "cannot be read"}`;
        d.bytes = new Uint8Array();
        return;
      }
      throw error;
    }
    if (!d.follow) return;
    const end = d.start + d.bytes.length;
    if (d.bytes.length > 0 && d.size >= end && d.size - d.start <= VIEW_WINDOW_BYTES) {
      if (d.size > end) {
        const more = await this.readRange(backend, d.task, end, d.size);
        d.bytes = concat(d.bytes, more.bytes);
      }
      return;
    }
    const start = Math.max(0, d.size - VIEW_WINDOW_BYTES);
    const all = await this.readRange(backend, d.task, start, d.size);
    d.start = start;
    d.bytes = all.bytes;
  }

  private async scrollBack(): Promise<void> {
    const d = this.detail;
    if (!d || d.start === 0) return;
    const backend = await this.deps.backend();
    const from = Math.max(0, d.start - VIEW_SCROLL_CHUNK_BYTES);
    const earlier = await this.readRange(backend, d.task, from, d.start);
    let bytes = concat(earlier.bytes, d.bytes);
    if (bytes.length > VIEW_WINDOW_BYTES) {
      bytes = bytes.subarray(0, VIEW_WINDOW_BYTES);
      // The window no longer reaches the end: the hidden-lines offset restarts from the new end.
      d.scroll = 0;
    }
    // Hidden lines are counted from the window end, so prepending keeps the viewport in place.
    d.start = from;
    d.bytes = bytes;
  }

  // ---- rendering --------------------------------------------------------------

  private outputText(d: DetailState): string {
    const lead = d.start > 0 ? leadingContinuationBytes(d.bytes) : 0;
    const body = d.bytes.subarray(lead);
    const atEnd = isFinalized(d.task) && d.start + d.bytes.length >= d.size;
    return decodeAndSanitize(body.subarray(0, consumableLength(body, atEnd)));
  }

  private lines(width: number): string[] {
    const d = this.detail;
    if (!d) return [];
    const text = this.outputText(d);
    const raw = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
    return raw.flatMap((line) => (line === "" ? [""] : wrapTextWithAnsi(line, Math.max(10, width))));
  }

  private stateCell(task: TaskRecord): Cell {
    const state = shownState(task);
    return { text: `${stateGlyph(state)} ${state === "terminated" ? state : stateLabel(task)}`, color: taskStateColor(state) };
  }

  /** Exit evidence plus a reason only when it adds something (D5). */
  private exitCell(task: TaskRecord, secondary: UiFg): Cell {
    if (!task.exit && !isFinalized(task)) return { text: "—", color: secondary };
    const reason = shownReason(task);
    const text = `${exitCode(task.exit)}${reason ? ` ${reason}` : ""}`;
    if (!task.exit) return { text, color: "warning" };
    // The signal of a requested stop is its expected outcome, not an error.
    return { text, color: exitFailed(task.exit) && shownState(task) !== "terminated" ? "error" : "muted" };
  }

  private cells(task: TaskRecord, selected: boolean): Cell[] {
    // Dim falls below readable contrast on the selection background.
    const secondary: UiFg = selected ? "muted" : "dim";
    return [
      { text: shortTaskId(task.id), color: secondary },
      { text: displayValue(task.label), color: "text" },
      this.stateCell(task),
      { text: elapsed(task, this.deps.now()), color: "muted" },
      this.exitCell(task, secondary),
      { text: noticeStatus(task, this.deps.noticeState(task)), color: "muted" },
      { text: formatSize(task.logBytes), color: "muted" },
    ];
  }

  /**
   * Admit whole secondary columns against a readable label width, then give
   * the label the remaining space. A wide terminal can show the whole label.
   */
  private listLayout(width: number): ListLayout {
    const rows = this.items.map((task) => this.cells(task, false));
    const naturalWidths = LIST_COLUMNS.map((column, index) => Math.min(column.max, Math.max(visibleWidth(column.header), ...rows.map((row) => visibleWidth(row[index]!.text)))));
    const widths = naturalWidths.map((natural, index) => LIST_COLUMNS[index]!.narrow === "shrink" ? Math.min(natural, PREFERRED_LABEL_COLUMN) : natural);
    // Deleting from a set keeps the order of the rest: the shown columns stay in table order.
    const shown = new Set(LIST_COLUMNS.keys());
    const excess = (): number => MARKER_WIDTH + [...shown].reduce((sum, index) => sum + widths[index]!, 0) + COLUMN_GAP * (shown.size - 1) - width;
    const hideOrder = LIST_COLUMNS
      .flatMap((column, index) => (typeof column.narrow === "number" ? [{ index, rank: column.narrow }] : []))
      .sort((a, b) => a.rank - b.rank);
    const preferredLabel = widths[LIST_COLUMNS.findIndex((column) => column.narrow === "shrink")]!;
    for (const { index, rank } of hideOrder) {
      const labelGive = rank === EXIT_DROP_RANK ? Math.max(0, preferredLabel - LABEL_FLOOR_WITH_EXIT) : 0;
      if (excess() <= labelGive) break;
      shown.delete(index);
    }
    const spare = -excess();
    LIST_COLUMNS.forEach((column, index) => {
      if (column.narrow !== "shrink") return;
      widths[index] = Math.min(naturalWidths[index]!, Math.max(MIN_SHRUNK_COLUMN, widths[index]! + spare));
    });
    return {
      shown: [...shown],
      columns: [...shown].map((index) => ({ header: LIST_COLUMNS[index]!.header, width: widths[index]!, align: "left" })),
      hidden: LIST_COLUMNS.filter((_column, index) => !shown.has(index)).map((column) => columnName(column.header)),
    };
  }

  /** Dim text under the row gutter, wrapped between words. */
  private note(text: string, width: number): string[] {
    const gutter = " ".repeat(MARKER_WIDTH);
    return wrapTextWithAnsi(text, Math.max(1, width - MARKER_WIDTH)).map((line) => this.deps.theme.fg("dim", `${gutter}${line}`));
  }

  private renderList(width: number): PanelParts {
    const th = this.deps.theme;
    const running = this.items.filter((task) => !isFinalized(task)).length;
    const live = `${th.fg("success", "●")}${th.fg("dim", " live")}`;
    const title: FrameTitle = { title: "Background tasks", right: running > 0 ? `${th.fg(stateColor("running"), `${running} running`)}${th.fg("dim", " · ")}${live}` : live };
    if (this.items.length) title.meta = `${this.items.length}${this.nextAfter !== null ? "+" : ""}`;
    const header = [frameTitle(th, width, title, "none").line];
    const footer = (hints: readonly KeyHint[]): string[] => [frameRule(th, width), ...keyHints(th, width, hints).lines];
    if (!this.items.length) return { header, body: this.note(NO_TASKS_TEXT, width), footer: footer(listHints(null)) };
    const layout = this.listLayout(width);
    const body = [truncateToWidth(columnHeader(th, layout.columns, COLUMN_GAP), width)];
    const visible = Math.max(1, this.bodyHeight(this.deps.rows() - CHROME_ROWS) - body.length);
    const first = Math.max(0, Math.min(this.selected - Math.floor(visible / 2), this.items.length - visible));
    this.items.slice(first, first + visible).forEach((task, i) => {
      const selected = first + i === this.selected;
      const all = this.cells(task, selected);
      const cells = layout.shown.map((index, position) => th.fg(all[index]!.color, clip(all[index]!.text, layout.columns[position]!.width)));
      body.push(listRow(th, width, columnCells(layout.columns, cells, COLUMN_GAP), selected));
    });
    if (this.nextAfter !== null) body.push(th.fg("dim", `${" ".repeat(MARKER_WIDTH)}… more history below`));
    const hidden = layout.hidden.length ? this.note(`hidden at this width: ${layout.hidden.join(", ")}`, width) : [];
    return { header, body, footer: [...hidden, ...footer(listHints(this.items[this.selected] ?? null))] };
  }

  /** What the log view is doing: only an unfinished task can be followed live (D6). */
  private viewMode(d: DetailState): string {
    const th = this.deps.theme;
    if (isFinalized(d.task)) return th.fg("muted", d.follow ? "finished" : "scrolled back");
    return d.follow ? th.fg("accent", "following") : th.fg("warning", "paused");
  }

  /**
   * The detail title with as many leading facts as fit whole. The first fact
   * (the label) always stays; alone, it is the one the frame may shorten.
   */
  private detailTitle(width: number, id: string, facts: readonly string[], right: string): string {
    const th = this.deps.theme;
    for (let count = facts.length; count > 1; count--) {
      const meta = facts.slice(0, count).join(" · ");
      const line = frameTitle(th, width, { title: id, meta, right }, "none").line;
      // A title the frame had to shorten no longer holds its meta.
      if (line.includes(meta)) return line;
    }
    return frameTitle(th, width, { title: id, meta: facts[0]!, right }, "none").line;
  }

  private renderDetail(width: number, d: DetailState): PanelParts {
    const th = this.deps.theme;
    const t = d.task;
    const facts = [displayValue(t.label)];
    if (t.exit || isFinalized(t)) {
      const reason = shownReason(t);
      facts.push(`${formatExit(t.exit)}${reason ? ` (${reason})` : ""}`);
    }
    facts.push(noticeLabel(t, this.deps.noticeState(t)), formatSize(d.size));
    const state = this.stateCell(t);
    const right = `${th.fg(state.color, state.text)}${th.fg("dim", " · ")}${this.viewMode(d)}`;
    const out = [this.detailTitle(width, t.id, facts, right)];
    const fit = (line: string) => truncateToWidth(line, width);
    if (t.state === "dead") out.push(fit(th.fg("warning", `dead: supervision was interrupted (${t.reason}); the process outcome is unknown${t.exit ? `, root ${formatExit(t.exit)} was observed` : ""}.`)));
    const visible = Math.max(1, this.bodyHeight(this.deps.rows() - CHROME_ROWS) - (out.length - 1));
    if (d.artifact) out.push(th.fg("error", d.artifact));
    else {
      const lines = this.lines(width);
      if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) out.push(th.fg("dim", isFinalized(t) ? "(no output was produced)" : "(no output yet)"));
      else {
        const end = Math.max(0, lines.length - (d.follow ? 0 : d.scroll));
        out.push(...lines.slice(Math.max(0, end - visible), end).map(fit));
      }
    }
    return { header: out.slice(0, 1), body: out.slice(1), footer: [frameRule(th, width), ...keyHints(th, width, detailHints(t, d.follow)).lines] };
  }

  private renderParts(width: number): PanelParts {
    const out = this.detail ? this.renderDetail(width, this.detail) : this.renderList(width);
    if (this.message) out.footer.push(truncateToWidth(this.deps.theme.fg("warning", displayValue(this.message)), width));
    return out;
  }

  // ---- input -----------------------------------------------------------------------

  private current(): TaskRecord | null {
    return this.detail ? this.detail.task : (this.items[this.selected] ?? null);
  }

  handleInput(data: string): void {
    this.message = null;
    if (this.detail) {
      const d = this.detail;
      const page = Math.max(1, this.bodyHeight(this.deps.rows() - CHROME_ROWS));
      if (matchesKey(data, Key.escape) || data === "q") {
        this.detail = null;
        void this.refresh();
      } else if (matchesKey(data, Key.up) || matchesKey(data, Key.pageUp) || data === "k") {
        const step = matchesKey(data, Key.pageUp) ? page : 1;
        const total = this.lines(80).length;
        d.follow = false;
        d.scroll += step;
        if (d.scroll > Math.max(0, total - page)) {
          d.scroll = Math.max(0, total - page);
          this.enqueue(() => this.scrollBack());
        }
      } else if (matchesKey(data, Key.down) || matchesKey(data, Key.pageDown) || data === "j") {
        d.scroll = Math.max(0, d.scroll - (matchesKey(data, Key.pageDown) ? page : 1));
      } else if (matchesKey(data, Key.end) || data === "f") {
        d.follow = true;
        d.scroll = 0;
        void this.refresh();
      } else this.action(data);
      this.deps.requestRender();
      return;
    }
    if (matchesKey(data, Key.escape) || data === "q") {
      this.dispose();
      this.deps.close();
      return;
    }
    if (matchesKey(data, Key.up) || data === "k") this.selected = Math.max(0, this.selected - 1);
    else if (matchesKey(data, Key.down) || data === "j") {
      this.selected = Math.min(this.items.length - 1, this.selected + 1);
      if (this.selected >= this.items.length - 1) this.enqueue(() => this.loadMore());
    } else if (matchesKey(data, Key.enter)) {
      const task = this.current();
      if (task) this.enqueue(() => this.openDetail(task));
    } else if (data === "r") void this.refresh();
    else this.action(data);
    this.deps.requestRender();
  }

  private action(key: string): void {
    const task = this.current();
    if (!task) return;
    if (key === "t") {
      this.message = `terminating ${task.id}…`;
      this.enqueue(async () => {
        const done = await (await this.deps.backend()).terminate(task.id);
        const state = shownState(done);
        this.message = `${done.id}: ${state}${state === "terminated" ? "" : ` (${done.reason})`}, ${formatExit(done.exit)}`;
        await this.reload();
      });
    } else if (key === "s") {
      this.enqueue(async () => {
        const signal = await this.deps.selectSignal();
        if (!signal) return;
        const r = await (await this.deps.backend()).signal(task.id, signal);
        this.message = `${r.delivered ? "sent" : "could not deliver"} ${signal} to ${task.id}`;
        await this.reload();
      });
    } else if (key === "m") {
      this.enqueue(async () => {
        const updated = await (await this.deps.backend()).setNotify(task.id, !task.notify);
        if (!updated.notify) this.deps.noticeForgotten(updated);
        this.message = `completion notices ${updated.notify ? "on" : "off"} for ${task.id}`;
        await this.reload();
      });
    } else if (key === "c") {
      if (!isFinalized(task)) {
        this.message = `${task.id} is unfinished; only a finished task can be cleared (terminate it first)`;
        return;
      }
      this.enqueue(async () => {
        const ok = await this.deps.confirm("Clear background task?", `Delete ${task.id} (${displayValue(task.label)}) and its terminal log (${task.logBytes} B). This cannot be undone.`);
        if (!ok) return;
        const backend = await this.deps.backend();
        const r = await backend.clear(task.id);
        this.deps.noticeForgotten(task);
        this.message = `cleared ${r.id} (${r.removedBytes} B)`;
        this.detail = null;
        await this.loadList(false);
      });
    }
  }

  private async reload(): Promise<void> {
    if (this.detail) await this.loadDetail();
    else await this.loadList(false);
  }
}

/** Renderer for completion notices: escaped labels, states, and log availability qualifiers. */
export function renderCompletion(details: CompletionDetails | undefined, text: string, theme: UiTheme): string[] {
  if (!details) return [theme.fg("dim", displayValue(text))];
  const head = theme.bold(details.events.length === 1 ? "Background task finished" : `${details.events.length} background tasks finished`);
  const lines = details.events.map((e) => {
    const state = theme.fg(e.state === "completed" ? "success" : e.state === "failed" ? "error" : "warning", e.state);
    return `  ${displayValue(e.taskId)}  ${state}  ${displayValue(e.reason)}  ${theme.fg("dim", `log ${displayValue(e.logPath)} (until cleared)`)}`;
  });
  return [head, ...lines];
}
