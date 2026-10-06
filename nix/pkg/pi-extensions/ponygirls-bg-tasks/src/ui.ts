/**
 * `/bg`: one list/detail inspector over the session's retained tasks, and the
 * renderer for completion notices. Output is a read-only, sanitized line view
 * of the PTY transcript (not a terminal emulator), read in bounded windows.
 */
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import type { TaskBackend } from "./backend.ts";
import {
  BgTaskError, MAX_LIST_ITEMS, MAX_READ_BYTES, isFinalized, type CompletionDetails, type SignalName, type TaskRecord,
} from "./protocol.ts";
import { consumableLength, decodeAndSanitize, displayValue, leadingContinuationBytes } from "./terminal-text.ts";
import { elapsed, formatExit, noticeLabel, stateLabel } from "./tool.ts";

/** Most log bytes held in memory by the detail view. */
export const VIEW_WINDOW_BYTES = 131072;
/** Bytes loaded per step when scrolling back past the window start. */
export const VIEW_SCROLL_CHUNK_BYTES = MAX_READ_BYTES;
export const VIEW_REFRESH_MS = 500;
const CHROME_ROWS = 6;

export interface ViewerStyle {
  accent(s: string): string;
  dim(s: string): string;
  error(s: string): string;
  warning(s: string): string;
  success(s: string): string;
  bold(s: string): string;
  selected(s: string): string;
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
  style: ViewerStyle;
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

export class BgInspector implements Component {
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

  invalidate(): void {}

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

  private stateText(task: TaskRecord): string {
    const s = this.deps.style;
    const label = stateLabel(task);
    if (task.state === "completed") return s.success(label);
    if (task.state === "failed") return s.error(label);
    if (task.state === "dead") return s.warning(label);
    return s.accent(label);
  }

  private row(task: TaskRecord): string {
    const now = this.deps.now();
    const parts = [task.id, displayValue(task.label), this.stateText(task), elapsed(task, now)];
    if (task.exit || isFinalized(task)) parts.push(formatExit(task.exit));
    if (task.reason) parts.push(task.reason);
    parts.push(noticeLabel(task, this.deps.noticeState(task)), `${task.logBytes} B`);
    return parts.join("  ");
  }

  render(width: number): string[] {
    const s = this.deps.style;
    const out: string[] = [];
    const fit = (line: string) => truncateToWidth(line, width);
    if (!this.detail) {
      out.push(fit(s.bold("Background tasks") + s.dim("  ↑/↓ select · enter open · t terminate · s signal · m mute · c clear · r refresh · q close")));
      if (!this.items.length) out.push(s.dim("No retained tasks in this session."));
      const visible = Math.max(1, this.deps.rows() - CHROME_ROWS);
      const first = Math.max(0, Math.min(this.selected - Math.floor(visible / 2), this.items.length - visible));
      this.items.slice(first, first + visible).forEach((task, i) => {
        const line = this.row(task);
        out.push(fit(first + i === this.selected ? s.selected(line) : line));
      });
      if (this.nextAfter !== null) out.push(s.dim("… more history below"));
    } else {
      const d = this.detail;
      const t = d.task;
      out.push(fit(`${s.bold(t.id)}  ${displayValue(t.label)}  ${this.stateText(t)}  ${formatExit(t.exit)}${t.reason ? `  ${t.reason}` : ""}  ${noticeLabel(t, this.deps.noticeState(t))}  ${d.size} B`));
      if (t.state === "dead") out.push(fit(s.warning(`dead: supervision was interrupted (${t.reason}); the process outcome is unknown${t.exit ? `, root ${formatExit(t.exit)} was observed` : ""}.`)));
      out.push(fit(s.dim(`${d.follow ? "following live output" : "paused (scrolled back)"} · ↑/PgUp scroll · f/End follow · t terminate · s signal · m mute · c clear · esc back`)));
      const visible = Math.max(1, this.deps.rows() - CHROME_ROWS);
      if (d.artifact) out.push(s.error(d.artifact));
      else {
        const lines = this.lines(width);
        if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) out.push(s.dim(isFinalized(t) ? "(no output was produced)" : "(no output yet)"));
        else {
          const end = Math.max(0, lines.length - (d.follow ? 0 : d.scroll));
          out.push(...lines.slice(Math.max(0, end - visible), end).map(fit));
        }
      }
    }
    if (this.message) out.push(fit(s.warning(displayValue(this.message))));
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
      const page = Math.max(1, this.deps.rows() - CHROME_ROWS);
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
        this.message = `${done.id}: ${done.state} (${done.reason}), ${formatExit(done.exit)}`;
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
export function renderCompletion(details: CompletionDetails | undefined, text: string, style: ViewerStyle): string[] {
  if (!details) return [style.dim(displayValue(text))];
  const head = style.bold(details.events.length === 1 ? "Background task finished" : `${details.events.length} background tasks finished`);
  const lines = details.events.map((e) => {
    const state = e.state === "completed" ? style.success(e.state) : e.state === "failed" ? style.error(e.state) : style.warning(e.state);
    return `  ${displayValue(e.taskId)}  ${state}  ${displayValue(e.reason)}  ${style.dim(`log ${displayValue(e.logPath)} (until cleared)`)}`;
  });
  return [head, ...lines];
}
