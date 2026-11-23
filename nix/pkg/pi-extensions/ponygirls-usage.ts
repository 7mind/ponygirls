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
 * This file owns the pane's state, keys and loading; ./ponygirls-usage-state.ts
 * renders it, so the whole screen is testable without the Pi runtime.
 *
 * Wire-up: listed in nix/hm/pi.nix `programs.pi.settings.extensions`.
 */

import { CancellableLoader, matchesKey, parseKey, type Component, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { formatCount, type InlinePane } from "@ponygirls/pi-ui";

import { TableViewport } from "./table-viewport.ts";
import { collectUsageData, TAB_ORDER, type CollectProgress, type TabName, type UsageData } from "./ponygirls-usage-data.ts";
import { renderUsagePane, USAGE_TAB_DEFAULT_MODE, type InputDistStyle, type UsageTableMode, type UsageView } from "./ponygirls-usage-state.ts";

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

class UsageTableView implements Component {
	readonly capturesViewportInput = true;

	private tab: TabName = "allTime";
	private modes: Record<TabName, UsageTableMode> = { ...USAGE_TAB_DEFAULT_MODE };
	/** Table vs distribution; distribution style. Both global, sticky across tabs. */
	private view: UsageView = "table";
	private distStyle: InputDistStyle = "chart";
	private readonly viewport: TableViewport;

	constructor(
		private readonly theme: Theme,
		tui: TUI,
		private readonly data: UsageData,
		private readonly onClose: () => void,
		private readonly requestRender: () => void,
	) {
		this.viewport = new TableViewport(() => tui.terminal?.rows, requestRender);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const pane = renderUsagePane(
			this.theme,
			width,
			this.data[this.tab],
			{ tab: this.tab, mode: this.modes[this.tab], view: this.view, distStyle: this.distStyle, scrollTop: this.viewport.scrollTop, budget: this.viewport.budget },
		);
		this.viewport.reconcile(pane);
		return pane.lines;
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
			this.viewport.reset();
			this.requestRender();
			return;
		}
		if (matchesKey(data, "v")) {
			this.view = this.view === "table" ? "dist" : "table";
			this.viewport.reset();
			this.requestRender();
			return;
		}
		if (matchesKey(data, "c") && this.view === "dist") {
			this.distStyle = this.distStyle === "chart" ? "table" : "chart";
			this.viewport.reset();
			this.requestRender();
			return;
		}
		this.viewport.handleInput(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return this.viewport.handleMouse(event);
	}

	private switchTab(direction: 1 | -1): void {
		const index = TAB_ORDER.indexOf(this.tab);
		this.tab = TAB_ORDER[(index + direction + TAB_ORDER.length) % TAB_ORDER.length]!;
		this.viewport.reset();
		this.requestRender();
	}
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("usage", {
		description: "Usage and cost by provider and model",
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
					const files = `${formatCount(p.filesParsed)}/${formatCount(p.filesToParse)} files`;
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
			await ctx.ui.custom<void>((tui, theme, _kb, done): InlinePane => new UsageTableView(theme, tui, data, () => done(), () => tui.requestRender()));
		},
	});
}
