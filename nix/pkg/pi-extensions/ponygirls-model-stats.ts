/**
 * ponygirls-model-stats — per-model response-time distributions and a /perf command.
 *
 * Each provider request is anchored at before_provider_headers (fired per HTTP
 * call, so a retry re-anchors) and the first provider_stream_event after it is
 * the first-token mark. An assistant message_end finalizes the sample: ttft and
 * total span, plus output tokens for a decode-span tok/s rate. Aborted, timed
 * out, and errored responses are not sampled; they count in per-kind counters.
 * Pi's internal retries never reach message_end, so only the final attempt of
 * a request is measured; nested streamSimple calls run between turns and cannot
 * clobber an open anchor.
 *
 * Records persist as JSONL in $PI_CODING_AGENT_DIR/model-stats.jsonl (default
 * ~/.pi/agent/model-stats.jsonl). Lines that do not parse, and ok samples whose
 * decode span is not a measurement, are dropped from that file on load. Every
 * PRUNE_EVERY appends the file is also rewritten without records older than a
 * week (the longest window); a racing concurrent session can lose the records
 * it appended during the rewrite — accepted for stats. /perf replaces the
 * editor with one per-model table at a time — the same in-place custom view
 * as /usage, not an overlay — under period tabs in the title: last hour, 24
 * hours, week (tab, left/right, or a click on a tab). The compact column set
 * shows n, one `fail` cell and p50/p90/p99 per metric (tok/s: p50/p90 and
 * the slow tail, p10); the full set shows a column per failure kind and
 * mean/p50/p90/p99 (tok/s also p10/p1). Until `a` toggles it, the set
 * follows the width: full when that table fits, compact otherwise. The
 * model column keeps its width first: see `layoutWindow` for what gives way
 * in a narrow pane. `s` picks the sort among the columns of the set shown,
 * `r` reverses it. `e` toggles the effort breakdown: one row per model and
 * Pi thinking level (`AssistantMessage.thinkingLevel`, stored on each record
 * as `effort`); records written before effort was stored show as `?`. The
 * view is scrollable (up/down, j/k, pgup/pgdn, home/end, wheel) with an
 * adjustable viewport (+/-): `Component.render(width)` never sees the
 * allocated height, so the line budget is view state, not an estimate of
 * the dock. Untouched, the budget is half the terminal height; the first
 * manual resize makes it sticky.
 *
 * Wire-up: listed in nix/hm/pi.nix `programs.pi.settings.extensions`.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { readStatsRecords, registerStatsCollector } from "./ponygirls-model-stats-collector.ts";

import { getSelectListTheme, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import {
	matchesKey,
	parseKey,
	SelectList,
	truncateToWidth,
	visibleWidth,
	type Component,
	type OverlayHandle,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

import { frameTitle, hintAt, KEY, keyHints, type KeyHint, type Span } from "@ponygirls/pi-ui";

import {
	type BreakdownSummaries,
	clampStatsBudget,
	clampStatsScrollTop,
	type ColumnSet,
	DEFAULT_SORT,
	defaultStatsBudget,
	renderStatsScreen,
	shownColumns,
	shownSort,
	type SortOrder,
	sortKeys,
	type StatsBreakdown,
	STATS_BUDGET_STEP,
	STATS_DEFAULT_BUDGET,
	STATS_WHEEL_STEP,
	summarize,
	WINDOWS,
} from "./ponygirls-model-stats-state.ts";

const SORT_PICKER_TITLE = "Sort by";
const SORT_PICKER_HINTS: readonly KeyHint[] = [
	{ key: KEY.enter, action: "select" },
	{ key: KEY.esc, action: "cancel" },
];
/** Sort keys visible at once in the picker; the rest scroll. */
const SORT_PICKER_ROWS = 12;
/** Box sides plus one space of padding on each side. */
const BOX_SIDE_WIDTH = 2;

function statsPath(): string {
	const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(dir, "model-stats.jsonl");
}

class SortPicker implements Component {
	constructor(
		private readonly theme: Theme,
		private readonly list: SelectList,
	) {}

	invalidate(): void {
		this.list.invalidate();
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 2 * BOX_SIDE_WIDTH);
		const body = [...this.list.render(innerWidth), ...keyHints(this.theme, innerWidth, SORT_PICKER_HINTS).lines];
		const side = this.theme.fg("border", "│");
		return [
			frameTitle(this.theme, width, { title: SORT_PICKER_TITLE }, "box").line,
			...body.map((line) => `${side} ${fitLine(line, innerWidth)} ${side}`),
			this.theme.fg("border", `└${"─".repeat(Math.max(0, width - 2))}┘`),
		];
	}

	handleInput(data: string): void {
		this.list.handleInput(data);
	}
}

class StatsView implements Component {
	private readonly theme: Theme;
	private readonly tui: TUI;
	/** Fixed for the view lifetime. */
	private readonly summaries: BreakdownSummaries;
	private readonly onClose: () => void;
	private readonly requestRender: () => void;
	private period = 0;
	private breakdown: StatsBreakdown = "model";
	/** Set by `a`; until then the column set follows the width. */
	private columnChoice: ColumnSet | undefined;
	private sort: SortOrder = DEFAULT_SORT;
	private picker: OverlayHandle | undefined;
	private scrollTop = 0;
	private budget = STATS_DEFAULT_BUDGET;
	private budgetTouched = false;
	/** From the last render: the pane width, the content lines and the title's tab spans. */
	private width = 0;
	private lineCount = 0;
	private tabSpans: Span[] = [];

	constructor(theme: Theme, tui: TUI, summaries: BreakdownSummaries, onClose: () => void, requestRender: () => void) {
		this.theme = theme;
		this.tui = tui;
		this.summaries = summaries;
		this.onClose = onClose;
		this.requestRender = requestRender;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const screen = renderStatsScreen(this.theme, width, this.summaries, {
			period: this.period,
			breakdown: this.breakdown,
			columnChoice: this.columnChoice,
			sort: this.sort,
			scrollTop: this.scrollTop,
			budget: this.effectiveBudget(),
		});
		this.width = width;
		this.lineCount = screen.lineCount;
		this.tabSpans = screen.tabSpans;
		this.scrollTop = screen.scrollTop;
		return screen.lines;
	}

	/** The column set on screen: it follows the pane width until `a` chooses one. */
	private shownColumns(): ColumnSet {
		return shownColumns(this.columnChoice, this.summaries[this.breakdown], this.width);
	}

	/** The sort on screen: the default while the chosen column is not in the column set. */
	private shownSort(): SortOrder {
		return shownSort(this.sort, this.shownColumns());
	}

	handleInput(data: string): void {
		if (this.picker) return;
		if (matchesKey(data, "escape") || matchesKey(data, "q") || parseKey(data) === "q") {
			this.onClose();
			return;
		}
		if (matchesKey(data, "tab") || matchesKey(data, "right")) {
			this.selectPeriod((this.period + 1) % WINDOWS.length);
			return;
		}
		if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
			this.selectPeriod((this.period + WINDOWS.length - 1) % WINDOWS.length);
			return;
		}
		if (matchesKey(data, "s")) {
			this.openSortPicker();
			return;
		}
		if (matchesKey(data, "e")) {
			this.breakdown = this.breakdown === "model" ? "effort" : "model";
			this.scrollTop = 0;
			this.requestRender();
			return;
		}
		if (matchesKey(data, "a")) {
			this.columnChoice = this.shownColumns() === "compact" ? "full" : "compact";
			this.requestRender();
			return;
		}
		if (matchesKey(data, "r")) {
			const shown = this.shownSort();
			this.sort = { id: shown.id, descending: !shown.descending };
			this.scrollTop = 0;
			this.requestRender();
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "down") || parseKey(data) === "k" || parseKey(data) === "j") {
			const delta = matchesKey(data, "up") || parseKey(data) === "k" ? -1 : 1;
			this.scrollBy(delta);
			return;
		}
		if (matchesKey(data, "pageUp") || matchesKey(data, "pageDown")) {
			this.scrollBy(matchesKey(data, "pageUp") ? -this.effectiveBudget() : this.effectiveBudget());
			return;
		}
		if (matchesKey(data, "home") || matchesKey(data, "end")) {
			this.scrollTo(matchesKey(data, "home") ? 0 : Number.MAX_SAFE_INTEGER);
			return;
		}
		const typed = parseKey(data);
		if (typed === "+" || typed === "=") {
			this.growBudget(STATS_BUDGET_STEP);
			return;
		}
		if (typed === "-" || typed === "_") {
			this.growBudget(-STATS_BUDGET_STEP);
			return;
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.picker) return undefined;
		if (event.type === "wheel" && event.wheelDelta) {
			this.scrollBy(event.wheelDelta < 0 ? -STATS_WHEEL_STEP : STATS_WHEEL_STEP);
			return { handled: true };
		}
		// The title is the first line. The dispatcher sends the click only to a component that took the press.
		if (event.y === 0 && event.button === "left" && (event.type === "press" || event.type === "click")) {
			const tab = hintAt(this.tabSpans, event.x);
			if (tab === undefined) return undefined;
			if (event.type === "press") return { handled: true, render: false };
			this.selectPeriod(tab);
			return { handled: true };
		}
		return undefined;
	}

	private selectPeriod(period: number): void {
		if (period === this.period) return;
		this.period = period;
		this.scrollTop = 0;
		this.requestRender();
	}

	private scrollBy(delta: number): void {
		this.scrollTo(this.scrollTop + delta);
	}

	private scrollTo(target: number): void {
		const next = clampStatsScrollTop(target, this.lineCount, this.effectiveBudget());
		if (next === this.scrollTop) return;
		this.scrollTop = next;
		this.requestRender();
	}

	private growBudget(delta: number): void {
		const next = clampStatsBudget(this.effectiveBudget() + delta);
		if (next === this.effectiveBudget()) return;
		this.budget = next;
		this.budgetTouched = true;
		this.scrollTop = clampStatsScrollTop(this.scrollTop, this.lineCount, next);
		this.requestRender();
	}

	/** Half the terminal height until the first manual resize, then the sticky budget. */
	private effectiveBudget(): number {
		return this.budgetTouched ? this.budget : defaultStatsBudget(this.tui.terminal?.rows);
	}

	private openSortPicker(): void {
		if (this.picker) return;
		const current = this.shownSort();
		// Each column of the set shown, in its natural direction, then reversed.
		const choices = sortKeys(this.shownColumns()).flatMap((key) =>
			[key.descending, !key.descending].map((descending): { order: SortOrder; label: string } => ({
				order: { id: key.id, descending },
				label: `${key.label} ${descending ? "↓" : "↑"}`,
			})),
		);
		const items = choices.map((choice, index) => ({ value: String(index), label: choice.label }));
		const list = new SelectList(items, SORT_PICKER_ROWS, getSelectListTheme());
		const selected = choices.findIndex((choice) => choice.order.id === current.id && choice.order.descending === current.descending);
		if (selected >= 0) list.setSelectedIndex(selected);
		const close = () => {
			this.picker?.hide();
			this.picker = undefined;
			this.tui.setFocus(this);
			this.requestRender();
		};
		list.onSelect = (item) => {
			const choice = choices[Number(item.value)];
			if (choice !== undefined) {
				this.sort = choice.order;
				this.scrollTop = 0;
			}
			close();
		};
		list.onCancel = close;
		this.picker = this.tui.showOverlay(new SortPicker(this.theme, list), {
			anchor: "center",
			width: 32,
			maxHeight: 18,
			margin: 2,
		});
	}
}

function fitLine(line: string, width: number): string {
	const clipped = truncateToWidth(line, width);
	const gap = width - visibleWidth(clipped);
	return gap > 0 ? clipped + " ".repeat(gap) : clipped;
}

export default function (pi: ExtensionAPI): void {
	registerStatsCollector(pi, process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));

	pi.registerCommand("perf", {
		description: "Per-model response time and throughput",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/perf needs the interactive UI", "warning");
				return;
			}
			const records = readStatsRecords(statsPath());
			const now = Date.now();
			const summaries: BreakdownSummaries = { model: summarize(records, now, "model"), effort: summarize(records, now, "effort") };
			// In place, replacing the editor, as /usage does. An overlay is a popup.
			await ctx.ui.custom<void>((tui, theme, _kb, done) => new StatsView(theme, tui, summaries, () => done(), () => tui.requestRender()));
		},
	});
}
