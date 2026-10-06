/**
 * ponygirls-usage — period tabs with a flat per-provider/per-model table, scrollable,
 * plus a global input-size distribution view (ascii chart/table, switchable).
 *
 * A replacement for the pinned tmustier usage-extension table tab: the same
 * period tabs (Today / This Week / Last 30 Days / All Time), each a flat
 * grouped table (provider total, then its models, by cost) instead of the
 * expandable tree. Insights, graphs, and export are out of scope. Data
 * collection and caching are vendored in ./ponygirls-usage-data.ts and run unchanged,
 * so the on-disk cache stays compatible; see that file's header for the pin.
 * The distribution view histograms per-assistant-message ctx tokens
 * (input + cacheRead + cacheWrite) globally across providers/models per
 * period; see ./ponygirls-usage-state.ts. [v] switches table/distribution, [c] switches
 * the distribution between chart and table. The chart stacks each bucket's
 * input/cacheRead/cacheWrite token shares: accent input, warning cacheWrite
 * (newly written cache, billed at a premium), success cacheRead (cheap reread).
 *
 * Wire-up: listed in nix/hm/pi.nix `programs.pi.settings.extensions`.
 */

import { CancellableLoader, matchesKey, parseKey, truncateToWidth, visibleWidth, type Component, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";

import { DEFAULT_VIEWPORT_BUDGET, WHEEL_LINES, VIEWPORT_BUDGET_STEP, clampScrollTop, clampViewportBudget, visibleRange } from "./scroll-state.ts";
import { collectUsageData, TAB_ORDER, type CollectProgress, type TabName, type UsageData } from "./ponygirls-usage-data.ts";
import { buildInputDistribution, buildUsageRows, INPUT_DIST_COMPONENTS, measureUsageTable, renderInputDistChart, renderInputDistTable, renderUsageTable, usageTotalsRow, USAGE_TAB_DEFAULT_MODE, USAGE_TAB_LABELS, type InputDistComponentKey, type InputDistPalette, type InputDistStyle, type UsageTableLayout, type UsageTableMode, type UsageView } from "./ponygirls-usage-state.ts";

/** View chrome around the scrollable content: rule, tabs, blank, footer, rule. */
const USAGE_CHROME_LINES = 5;

/** Half the terminal height for content, less the view chrome. */
function defaultBudget(rows: number | undefined): number {
	if (typeof rows !== "number" || !Number.isFinite(rows)) return DEFAULT_VIEWPORT_BUDGET;
	return clampViewportBudget(Math.floor(rows / 2) - USAGE_CHROME_LINES);
}

/** "14:32" if the timestamp is today, otherwise "16 Jul" (with year if not this year). */
function formatSinceDate(ms: number): string {
	const d = new Date(ms);
	const now = new Date();
	if (d.toDateString() === now.toDateString()) {
		return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	}
	const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
	if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
	return d.toLocaleDateString(undefined, opts);
}

function fitLine(line: string, width: number): string {
	const clipped = truncateToWidth(line, width);
	const gap = width - visibleWidth(clipped);
	return gap > 0 ? clipped + " ".repeat(gap) : clipped;
}

class UsageTableView implements Component {
	private tab: TabName = "allTime";
	private modes: Record<TabName, UsageTableMode> = { ...USAGE_TAB_DEFAULT_MODE };
	/** Table vs distribution; distribution style. Both global, sticky across tabs. */
	private view: UsageView = "table";
	private distStyle: InputDistStyle = "chart";
	private scrollTop = 0;
	private budget = DEFAULT_VIEWPORT_BUDGET;
	private budgetTouched = false;
	/** Content lines from the last render; the data is fixed for the view lifetime. */
	private lineCount = 0;
	private readonly layout: UsageTableLayout;

	constructor(
		private readonly theme: Theme,
		private readonly tui: TUI,
		private readonly data: UsageData,
		private readonly onClose: () => void,
		private readonly requestRender: () => void,
	) {
		// One layout for all tabs and both modes: columns keep the same width
		// when switching. Measured over the widest shape (per-model rows).
		const tabs = TAB_ORDER.map((name) => data[name]);
		this.layout = measureUsageTable(
			tabs.flatMap((stats) => buildUsageRows(stats, "models")),
			usageTotalsRow(data.allTime.totals),
		);
	}

	private effectiveBudget(): number {
		return this.budgetTouched ? this.budget : defaultBudget(this.tui.terminal?.rows);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const content: string[] = this.view === "table" ? this.tableContent(width) : this.distContent(width);
		this.lineCount = content.length;
		const budget = this.effectiveBudget();
		this.scrollTop = clampScrollTop(this.scrollTop, this.lineCount, budget);
		const { start, end } = visibleRange(this.lineCount, this.scrollTop, budget);
		const tabs = TAB_ORDER.map((name) =>
			name === this.tab ? this.theme.fg("accent", `[${USAGE_TAB_LABELS[name]}]`) : this.theme.fg("dim", ` ${USAGE_TAB_LABELS[name]} `),
		).join("  ");
		const rule = this.theme.fg("border", "─".repeat(Math.max(1, width)));
		const lines = [rule, fitLine(tabs, width), "", ...content.slice(start, end).map((line) => fitLine(line, width))];
		if (this.lineCount > budget) {
			const moreAbove = start > 0 ? "↑ " : "";
			const moreBelow = end < this.lineCount ? " ↓" : "";
			lines.push(this.theme.fg("dim", `${moreAbove}lines ${start + 1}–${end} of ${this.lineCount}${moreBelow}`));
		}
		return [...lines, "", this.theme.fg("dim", this.footerHint()), rule];
	}

	private footerHint(): string {
		const period = "[tab/←→] period";
		const scroll = "[↑↓/j/k] scroll  [pgup/pgdn] page  [+-] size  [q] close";
		if (this.view === "dist") return `${period}  [v] table  [c] ${this.distStyle === "chart" ? "chart" : "table"}  ${scroll}`;
		return `${period}  [m] ${this.modes[this.tab] === "models" ? "per-model" : "aggregates"}  [v] distribution  ${scroll}`;
	}

	private tableContent(width: number): string[] {
		const stats = this.data[this.tab];
		const rows = buildUsageRows(stats, this.modes[this.tab]!);
		const table = renderUsageTable(rows, usageTotalsRow(stats.totals), { layout: this.layout });
		const aggregate = new Set(rows.flatMap((row, index) => (row.model === null ? [index] : [])));
		const content: string[] = [...table.header];
		table.rows.forEach((line, index) => {
			const fitted = fitLine(line, width);
			content.push(aggregate.has(index) ? this.theme.fg("accent", fitted) : fitted);
		});
		if (table.totals.length > 0) content.push("", ...table.totals.map((line) => this.theme.fg("accent", fitLine(line, width))));
		return content;
	}

	private distContent(width: number): string[] {
		const bins = buildInputDistribution(this.data[this.tab].inputSizes);
		const subtitle = this.theme.fg("dim", "Input size per assistant message (ctx tokens, all models)");
		if (this.distStyle === "table") {
			const rendered = renderInputDistTable(bins);
			const content: string[] = [subtitle, "", ...rendered.header, ...rendered.rows];
			if (rendered.totals.length > 0) content.push("", ...rendered.totals.map((line) => this.theme.fg("accent", line)));
			return content;
	}
		const rendered = renderInputDistChart(bins, width, this.distPalette());
		if (rendered.totals.length === 0) return [subtitle, "", ...rendered.header];
		const content: string[] = [subtitle, "", this.distLegend(), ...rendered.rows];
		content.push("", ...rendered.totals.map((line) => this.theme.fg("accent", line)));
		return content;
	}

	/** Stacked-segment colors; empty segments stay empty (no stray escapes). */
	private distPalette(): InputDistPalette {
		const paint = (color: "accent" | "success" | "warning", bar: string): string =>
			bar === "" ? "" : this.theme.fg(color, bar);
		return {
			input: (bar) => paint("accent", bar),
			cacheRead: (bar) => paint("success", bar),
			cacheWrite: (bar) => paint("warning", bar),
		};
	}

	private distLegend(): string {
		const palette = this.distPalette();
		const swatch: Record<InputDistComponentKey, string> = {
			input: palette.input("█"),
			cacheRead: palette.cacheRead("█"),
			cacheWrite: palette.cacheWrite("█"),
		};
		return INPUT_DIST_COMPONENTS.map((component) => `${swatch[component.key]} ${this.theme.fg("dim", component.label)}`).join("  ");
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || parseKey(data) === "q") {
			this.onClose();
			return;
		}
		if (matchesKey(data, "tab") || matchesKey(data, "right")) {
			this.switchTab(1);
			return;
		}
		if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
			this.switchTab(-1);
			return;
		}
		if (matchesKey(data, "m") && this.view === "table") {
			this.modes[this.tab] = this.modes[this.tab] === "models" ? "aggregates" : "models";
			this.scrollTop = 0;
			this.requestRender();
			return;
		}
		if (matchesKey(data, "v")) {
			this.view = this.view === "table" ? "dist" : "table";
			this.scrollTop = 0;
			this.requestRender();
			return;
		}
		if (matchesKey(data, "c") && this.view === "dist") {
			this.distStyle = this.distStyle === "chart" ? "table" : "chart";
			this.scrollTop = 0;
			this.requestRender();
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "down") || parseKey(data) === "k" || parseKey(data) === "j") {
			const delta = matchesKey(data, "up") || parseKey(data) === "k" ? -1 : 1;
			this.scrollTo(this.scrollTop + delta);
			return;
		}
		if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
			this.scrollTo(this.scrollTop + (matchesKey(data, "pageUp") ? -this.effectiveBudget() : this.effectiveBudget()));
			return;
		}
		if (matchesKey(data, "home") || matchesKey(data, "end")) {
			this.scrollTo(matchesKey(data, "home") ? 0 : Number.MAX_SAFE_INTEGER);
			return;
		}
		const typed = parseKey(data);
		if (typed === "+" || typed === "=") {
			this.growBudget(VIEWPORT_BUDGET_STEP);
			return;
		}
		if (typed === "-" || typed === "_") {
			this.growBudget(-VIEWPORT_BUDGET_STEP);
			return;
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel" && event.wheelDelta) {
			this.scrollTo(this.scrollTop + (event.wheelDelta < 0 ? -WHEEL_LINES : WHEEL_LINES));
			return { handled: true };
		}
		return undefined;
	}

	private switchTab(direction: 1 | -1): void {
		const index = TAB_ORDER.indexOf(this.tab);
		this.tab = TAB_ORDER[(index + direction + TAB_ORDER.length) % TAB_ORDER.length]!;
		this.scrollTop = 0;
		this.requestRender();
	}

	private scrollTo(target: number): void {
		const next = clampScrollTop(target, this.lineCount, this.effectiveBudget());
		if (next === this.scrollTop) return;
		this.scrollTop = next;
		this.requestRender();
	}

	private growBudget(delta: number): void {
		const next = clampViewportBudget(this.effectiveBudget() + delta);
		if (next === this.effectiveBudget()) return;
		this.budget = next;
		this.budgetTouched = true;
		this.scrollTop = clampScrollTop(this.scrollTop, this.lineCount, next);
		this.requestRender();
	}
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("usage", {
		description: "Usage by provider and model per period, plus input-size distribution (scrollable)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/usage needs the interactive UI", "warning");
				return;
			}
			const data = await ctx.ui.custom<UsageData | null>((tui, theme, _kb, done) => {
				const loader = new CancellableLoader(
					tui,
					(s: string) => theme.fg("accent", s),
					(s: string) => theme.fg("muted", s),
					"Loading Usage...",
				);
				let finished = false;
				const finish = (value: UsageData | null) => {
					if (finished) return;
					finished = true;
					loader.dispose();
					done(value);
				};
				loader.onAbort = () => finish(null);
				const onProgress = (p: CollectProgress): void => {
					if (finished || p.filesToParse === 0) return;
					const files = `${p.filesParsed.toLocaleString()}/${p.filesToParse.toLocaleString()} files`;
					if (p.mode === "update") {
						const since = p.sinceMs !== null ? ` since ${formatSinceDate(p.sinceMs)}` : "";
						loader.setMessage(`Updating your usage history${since}… (${files})`);
					} else if (p.mode === "rebuild") {
						loader.setMessage(`Rebuilding your usage history — the cache format changed… (${files})`);
					} else {
						loader.setMessage(`Building your usage history for the first time… (${files})`);
					}
				};
				collectUsageData({ signal: loader.signal, onProgress })
					.then(finish)
					.catch(() => finish(null));
				return loader;
			});
			if (!data) return;
			// In place, replacing the editor, as /perf does. An overlay is a popup.
			await ctx.ui.custom<void>((tui, theme, _kb, done) => new UsageTableView(theme, tui, data, () => done(), () => tui.requestRender()));
		},
	});
}
