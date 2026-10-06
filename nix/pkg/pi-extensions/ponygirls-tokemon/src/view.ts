/**
 * ponygirls-tokemon — the /tokemon pane: the quota table full-screen,
 * scrollable, auto-refreshing on an interval with a countdown (tokemon's
 * TUI). `r` refreshes now, `i` shows or hides rows without quota data, `m`
 * lists each provider's available models below the table.
 */

import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { QuotaReport } from "./service.ts";
import { buildTable, type TableStyle } from "./table.ts";

export interface TokemonViewDeps {
  /** The latest report if younger than `maxAgeMs`, else a fresh one. */
  report(maxAgeMs: number): Promise<QuotaReport>;
  /** Available model ids by provider. */
  models(): Map<string, string[]>;
  now(): Date;
  rows(): number;
  requestRender(): void;
  close(): void;
  style: TableStyle;
  refreshEveryMs: number;
}

/** Title, blank, caption, and key lines around the scrolled content. */
const CHROME_LINES = 4;
const TICK_MS = 1000;

function clock(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export class TokemonView implements Component {
  private readonly deps: TokemonViewDeps;
  private report: QuotaReport | null = null;
  private error: string | null = null;
  private loading = false;
  private showInvalid = false;
  private showModels = false;
  private scrollTop = 0;
  private nextRefreshAt: Date;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(deps: TokemonViewDeps) {
    this.deps = deps;
    this.nextRefreshAt = deps.now();
    this.load(deps.refreshEveryMs);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  invalidate(): void {}

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
    return Math.max(3, this.deps.rows() - CHROME_LINES);
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
      for (const [provider, ids] of [...models.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        lines.push(...wrapTextWithAnsi(`${s.provider(provider, provider)} ${s.dim(`(${ids.length})`)}  ${ids.join(", ")}`, width - 2).map((l, i) => (i === 0 ? `  ${l}` : `    ${l}`)));
      }
    }
    return { lines, caption: table.caption };
  }

  render(width: number): string[] {
    const s = this.deps.style;
    const w = Math.max(40, width);
    const now = this.deps.now();
    const status = this.loading ? "querying…" : this.report ? `updated ${clock(this.report.refreshedAt)} · next refresh in ${countdown(this.nextRefreshAt.getTime() - now.getTime())}` : "";
    const { lines, caption } = this.content(w);
    const height = this.viewportHeight();
    this.scrollTop = Math.min(this.scrollTop, Math.max(0, lines.length - height));
    const visible = lines.slice(this.scrollTop, this.scrollTop + height);
    while (visible.length < height) visible.push("");
    const below = lines.length - this.scrollTop - height;
    const position = this.scrollTop > 0 || below > 0 ? ` · lines ${this.scrollTop + 1}-${Math.min(lines.length, this.scrollTop + height)} of ${lines.length}` : "";
    return [
      truncateToWidth(`${s.bold("tokemon — token quotas")}  ${s.dim(status)}`, w, "…"),
      ...visible.map((l) => truncateToWidth(l, w, "…")),
      "",
      truncateToWidth(s.dim(`${caption ?? ""}${position}`), w, "…"),
      truncateToWidth(s.dim(`r refresh · i ${this.showInvalid ? "hide" : "show"} invalid · m ${this.showModels ? "hide" : "show"} models · ↑↓ PgUp PgDn scroll · esc close`), w, "…"),
    ];
  }

  handleInput(data: string): void {
    const page = Math.max(1, this.viewportHeight() - 1);
    if (matchesKey(data, Key.escape) || data === "q") this.deps.close();
    else if (matchesKey(data, Key.up) || data === "k") this.scrollTop = Math.max(0, this.scrollTop - 1);
    else if (matchesKey(data, Key.down) || data === "j") this.scrollTop += 1;
    else if (matchesKey(data, Key.pageUp)) this.scrollTop = Math.max(0, this.scrollTop - page);
    else if (matchesKey(data, Key.pageDown)) this.scrollTop += page;
    else if (matchesKey(data, Key.home) || data === "g") this.scrollTop = 0;
    else if (matchesKey(data, Key.end) || data === "G") this.scrollTop = Number.MAX_SAFE_INTEGER;
    else if (data === "r" && !this.loading) this.load(0);
    else if (data === "i") this.showInvalid = !this.showInvalid;
    else if (data === "m") this.showModels = !this.showModels;
    this.deps.requestRender();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "wheel" || !event.wheelDelta) return undefined;
    this.scrollTop = Math.max(0, this.scrollTop + event.wheelDelta);
    return { handled: true };
  }
}
