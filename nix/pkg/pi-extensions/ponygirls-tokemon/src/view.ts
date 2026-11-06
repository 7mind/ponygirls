/**
 * ponygirls-tokemon — the /tokemon bottom panel: the quota table replacing
 * the editor (like /usage and /perf), scrollable, auto-refreshing on an
 * interval with a countdown (tokemon's TUI). `r` refreshes now, `i` shows
 * or hides rows without quota data, `m` lists each provider's available
 * models below the table.
 *
 * The panel is only as tall as its content (up to the terminal budget),
 * so short tables leave the transcript visible above it.
 */

import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi, ScrollView, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { frameRule, frameTitle, keyHints, PanelLayout, type PanelParts, type UiTheme } from "@ponygirls/pi-ui";
import type { QuotaReport } from "./service.ts";
import { buildTable, type TableStyle } from "./table.ts";
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

/** Title, caption, and rule lines around the scrolled content and the key hints. */
const CHROME_LINES = 3;
const TITLE = "tokemon — token quotas";
const TICK_MS = 1000;

function clock(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour12: false });
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
  /** Key hint lines at the last rendered width (they wrap on narrow terminals). */
  private hintLines = 1;
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

  private viewportHeight(): number {
    return Math.max(3, this.deps.rows() - CHROME_LINES - this.hintLines);
  }

  private content(width: number): { lines: string[]; caption: string | null } {
    const s = this.deps.style;
    if (this.error !== null) return { lines: [s.error(`quota refresh failed: ${this.error}`)], caption: null };
    if (this.report === null) return { lines: [s.dim("querying providers…")], caption: null };
    if (this.report.results.length === 0) return { lines: [s.dim("No configured providers found (pi auth.json, API-key environment variables, models.json).")], caption: null };
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
    return { lines, caption: table.caption };
  }

  private renderParts(width: number): PanelParts {
    this.lastWidth = width;
    const s = this.deps.style;
    const w = Math.max(40, width);
    const status = this.loading ? "querying…" : this.report ? `updated ${clock(this.report.refreshedAt)} · next refresh in ${countdown(this.nextRefreshAt.getTime() - this.deps.now().getTime())}` : "";
    const t = this.deps.theme;
    const hints = keyHints(t, w, [
      { key: "r", action: "refresh" },
      { key: "i", action: `${this.showInvalid ? "hide" : "show"} invalid` },
      { key: "m", action: `${this.showModels ? "hide" : "show"} models` },
      { key: "↑↓ PgUp PgDn", action: "scroll" },
      { key: "esc", action: "close" },
    ]);
    this.hintLines = hints.lines.length;
    const { lines, caption } = this.content(w);
    const scroll = this.scroll;
    const end = Math.min(lines.length, scroll.scrollTop + scroll.viewportHeight);
    const position = scroll.scrollTop > 0 || end < lines.length ? ` · lines ${scroll.scrollTop + 1}-${end} of ${lines.length}` : "";
    return {
      header: [frameTitle(t, w, { title: TITLE, right: status === "" ? undefined : t.fg("dim", status) }, "none").line],
      body: lines.map((line) => truncateToWidth(line, w, "…")),
      footer: [truncateToWidth(s.dim(`${caption ?? ""}${position}`), w, "…"), frameRule(t, w), ...hints.lines],
    };
  }

  override render(width: number): string[] {
    const { body } = this.renderParts(width);
    const height = Math.min(this.viewportHeight(), body.length);
    // Keep regular-mode paging separate: intrinsic measurement must not clamp the allocated viewport's scroll position.
    this.regularScroll.updateLayout(body.length, height, this.deps.requestRender);
    const start = Math.min(this.scroll.scrollTop, Math.max(0, body.length - height));
    const { header, footer } = this.renderParts(width);
    return [...header, ...body.slice(start, start + height), ...footer];
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
