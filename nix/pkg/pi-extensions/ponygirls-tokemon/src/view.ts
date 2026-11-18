/**
 * ponygirls-tokemon — the /tokemon bottom panel: the quota table replacing
 * the editor (like /usage and /perf), scrollable, auto-refreshing on an
 * interval with a countdown (tokemon's TUI). `r` refreshes now, `i` shows
 * or hides rows without quota data, `m` lists each provider's available
 * models below the table.
 *
 * The panel is only as tall as its content (up to the terminal budget),
 * so short tables leave the transcript visible above it. Under the table
 * sit its notes (hidden rows and columns, the scroll position): on one
 * line, or one per line when that line would not fit.
 */

import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi, ScrollView, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { frameRule, frameTitle, HINT, keyHints, PanelLayout, type PanelParts, type UiTheme } from "@ponygirls/pi-ui";
import type { QuotaReport } from "./service.ts";
import { buildTable, NOTE_SEPARATOR, type TableStyle } from "./table.ts";
import type { ModelReport } from "./report.ts";

export interface TokemonViewDeps {
  /** The latest report if younger than `maxAgeMs`, else a fresh one. */
  report(maxAgeMs: number): Promise<QuotaReport>;
  /** Available models with effort levels, by provider. */
  models(): Map<string, ModelReport[]>;
  now(): Date;
  rows(): number;
  requestRender(): void;
  close(): void;
  style: TableStyle;
  /** Panel chrome: title rule, rule above the key hints, and the hints. */
  theme: UiTheme;
  refreshEveryMs: number;
}

const TITLE = "tokemon";
const TICK_MS = 1000;
/** The scrolled content keeps this many lines however short the terminal. */
const MIN_BODY_LINES = 3;
/** Laying out sets the scroll position, which is itself a note and can add a line under the table; the layout settles within this many passes. */
const LAYOUT_PASSES = 3;

function clock(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export class TokemonView extends PanelLayout {
  private readonly deps: TokemonViewDeps;
  private report: QuotaReport | null = null;
  private error: string | null = null;
  private loading = false;
  private showInvalid = false;
  private showModels = false;
  private readonly regularScroll: ScrollView;
  private lastWidth: number | null = null;
  private nextRefreshAt: Date;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(deps: TokemonViewDeps) {
    super((width) => this.renderParts(width));
    this.deps = deps;
    this.regularScroll = new ScrollView({ render: (width) => this.content(width).lines, invalidate() {} });
    this.nextRefreshAt = deps.now();
    this.load(deps.refreshEveryMs);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  override invalidate(): void {}

  private get scroll(): ScrollView { return this.hasAllocatedHeight ? this.bodyScroll : this.regularScroll; }

  private load(maxAgeMs: number): void {
    this.loading = true;
    this.deps.report(maxAgeMs).then(
      (report) => {
        this.report = report;
        this.error = null;
        this.nextRefreshAt = new Date(report.refreshedAt.getTime() + this.deps.refreshEveryMs);
      },
      (e: Error) => {
        this.error = e.message;
        this.nextRefreshAt = new Date(this.deps.now().getTime() + this.deps.refreshEveryMs);
      },
    ).finally(() => {
      this.loading = false;
      this.deps.requestRender();
    });
  }

  private tick(): void {
    if (!this.loading && this.deps.now() >= this.nextRefreshAt) this.load(0);
    this.deps.requestRender();
  }

  private content(width: number): { lines: string[]; notes: string[] } {
    const s = this.deps.style;
    if (this.error !== null) return { lines: [s.error(`quota refresh failed: ${this.error}`)], notes: [] };
    if (this.report === null) return { lines: [s.dim("querying providers…")], notes: [] };
    if (this.report.results.length === 0) return { lines: [s.dim("No configured providers found (pi auth.json, API-key environment variables, models.json).")], notes: [] };
    const table = buildTable(this.report.results, this.deps.now(), { showInvalid: this.showInvalid, width }, s);
    const lines = [...table.lines];
    if (this.showModels) {
      lines.push("", s.bold("Available models"));
      const models = this.deps.models();
      if (models.size === 0) lines.push(s.dim("  none"));
      for (const [provider, entries] of [...models.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        // Effort levels worth showing: anything beyond a bare ["off"] (no thinking).
        const ids = entries.map(({ id, efforts }) => (efforts.length === 1 && efforts[0] === "off" ? id : `${id} [${efforts.join(", ")}]`));
        lines.push(...wrapTextWithAnsi(`${s.provider(provider, provider)} ${s.dim(`(${entries.length})`)}  ${ids.join(", ")}`, width - 2).map((l, i) => (i === 0 ? `  ${l}` : `    ${l}`)));
      }
    }
    return { lines, notes: table.notes };
  }

  private renderParts(width: number): PanelParts {
    this.lastWidth = width;
    const s = this.deps.style;
    const w = Math.max(40, width);
    const status = this.loading ? "querying…" : this.report ? `updated ${clock(this.report.refreshedAt)} · refresh in ${countdown(this.nextRefreshAt.getTime() - this.deps.now().getTime())}` : "";
    const t = this.deps.theme;
    const hints = keyHints(t, w, [
      { key: "r", action: "refresh" },
      { key: "i", action: `${this.showInvalid ? "hide" : "show"} invalid` },
      { key: "m", action: `${this.showModels ? "hide" : "show"} models` },
      HINT.scroll,
      HINT.close,
    ]);
    const content = this.content(w);
    const lines = content.lines;
    const scroll = this.scroll;
    const end = Math.min(lines.length, scroll.scrollTop + scroll.viewportHeight);
    const notes = scroll.scrollTop > 0 || end < lines.length ? [...content.notes, `lines ${scroll.scrollTop + 1}-${end} of ${lines.length}`] : content.notes;
    const oneLine = notes.join(NOTE_SEPARATOR);
    const noteLines = visibleWidth(oneLine) <= w ? [oneLine] : notes.flatMap((note) => wrapTextWithAnsi(note, w));
    return {
      header: [frameTitle(t, w, { title: TITLE, right: status === "" ? undefined : t.fg("dim", status) }, "none").line],
      body: lines.map((line) => truncateToWidth(line, w, "…")),
      footer: [...noteLines.map((line) => s.dim(line)), frameRule(t, w), ...hints.lines],
    };
  }

  /** Body lines the terminal has room for around the title, notes, rule, and key hints. */
  private bodyBudget(parts: PanelParts): number {
    return Math.min(Math.max(MIN_BODY_LINES, this.deps.rows() - parts.header.length - parts.footer.length), parts.body.length);
  }

  override render(width: number): string[] {
    let parts = this.renderParts(width);
    for (let pass = 0; pass < LAYOUT_PASSES; pass++) {
      const footerLines = parts.footer.length;
      // Keep regular-mode paging separate: intrinsic measurement must not clamp the allocated viewport's scroll position.
      this.regularScroll.updateLayout(parts.body.length, this.bodyBudget(parts), this.deps.requestRender);
      parts = this.renderParts(width);
      if (parts.footer.length === footerLines) break;
    }
    const height = this.bodyBudget(parts);
    const start = Math.min(this.scroll.scrollTop, Math.max(0, parts.body.length - height));
    return [...parts.header, ...parts.body.slice(start, start + height), ...parts.footer];
  }

  handleInput(data: string): void {
    if (this.lastWidth !== null) {
      const scroll = this.scroll;
      scroll.updateLayout(this.content(this.lastWidth).lines.length, scroll.viewportHeight, this.deps.requestRender);
    }
    const page = Math.max(1, this.scroll.viewportHeight - 1);
    if (matchesKey(data, Key.escape) || data === "q") this.deps.close();
    else if (matchesKey(data, Key.up) || data === "k") this.scroll.scrollBy(-1);
    else if (matchesKey(data, Key.down) || data === "j") this.scroll.scrollBy(1);
    else if (matchesKey(data, Key.pageUp)) this.scroll.scrollBy(-page);
    else if (matchesKey(data, Key.pageDown)) this.scroll.scrollBy(page);
    else if (matchesKey(data, Key.home) || data === "g") this.scroll.scrollToStart();
    else if (matchesKey(data, Key.end) || data === "G") this.scroll.scrollToEnd();
    else if (data === "r" && !this.loading) this.load(0);
    else if (data === "i") this.showInvalid = !this.showInvalid;
    else if (data === "m") this.showModels = !this.showModels;
    this.deps.requestRender();
  }

  handleMouse(event: TuiMouseEvent): ReturnType<PanelLayout["handleMouse"]> {
    if (event.type !== "wheel" || !event.wheelDelta) return undefined;
    this.scroll.scrollBy(event.wheelDelta);
    return { handled: true, target: { component: this, originX: event.screenX - event.x, originY: event.screenY - event.y, width: event.width, height: event.height } };
  }
}
