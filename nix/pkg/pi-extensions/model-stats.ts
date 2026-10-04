/**
 * model-stats — per-model response-time distributions and a /perf command.
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
 * editor with mean/p50/p90/p99 tables (tok/s also shows the slow tail, p10/p1)
 * per model for the last hour, 24 hours, and week — the same in-place custom
 * view as /usage, not an overlay. All three sections share one column layout,
 * so columns stay aligned across windows.
 *
 * Wire-up: listed in nix/hm/pi.nix `programs.pi.settings.extensions`.
 */

import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
} from "@earendil-works/pi-tui";

import {
	classifyOutcome,
	isUsableRecord,
	measureWindows,
	parseStatsLine,
	pruneRecords,
	renderWindow,
	SORT_KEYS,
	serializeStatsRecord,
	sortModels,
	summarize,
	WEEK_MS,
	type StatsRecord,
} from "./model-stats-state.ts";

const PRUNE_EVERY = 64;

function statsPath(): string {
	const dir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(dir, "model-stats.jsonl");
}

function writeRecords(path: string, records: readonly StatsRecord[]): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, records.map((record) => serializeStatsRecord(record) + "\n").join(""), "utf-8");
	renameSync(temporary, path);
}

/** Parsed usable records. Non-blank lines that do not parse, or that are not a measurement, are removed from the file. */
function readRecords(): StatsRecord[] {
	const path = statsPath();
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		return [];
	}
	const kept: StatsRecord[] = [];
	let dropped = 0;
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		const record = parseStatsLine(line);
		if (!record || !isUsableRecord(record)) {
			dropped += 1;
			continue;
		}
		kept.push(record);
	}
	if (dropped > 0) {
		try {
			writeRecords(path, kept);
		} catch {
			// The in-memory view is still filtered; a rewrite failure must not hide stats.
		}
	}
	return kept;
}

function writePruned(path: string): void {
	writeRecords(path, pruneRecords(readRecords(), Date.now() - WEEK_MS));
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
		const rule = this.theme.fg("border", "─".repeat(Math.max(1, width)));
		return [rule, this.theme.fg("accent", "Sort by"), ...this.list.render(width), this.theme.fg("dim", "enter select · esc cancel"), rule];
	}

	handleInput(data: string): void {
		this.list.handleInput(data);
	}
}

class StatsView implements Component {
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly summaries: ReturnType<typeof summarize>;
	private readonly onClose: () => void;
	private readonly requestRender: () => void;
	private sortIndex = 0;
	private reversed = false;
	private picker: OverlayHandle | undefined;

	constructor(theme: Theme, tui: TUI, summaries: ReturnType<typeof summarize>, onClose: () => void, requestRender: () => void) {
		this.theme = theme;
		this.tui = tui;
		this.summaries = summaries;
		this.onClose = onClose;
		this.requestRender = requestRender;
	}

	private sortDirection(): { id: (typeof SORT_KEYS)[number]["id"]; label: string; descending: boolean } {
		const key = SORT_KEYS[this.sortIndex]!;
		return { id: key.id, label: key.label, descending: this.reversed ? !key.descending : key.descending };
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [];
		const sort = this.sortDirection();
		// One layout for all windows: columns keep the same width in every section.
		const layout = measureWindows(this.summaries);
		for (const windowSummary of this.summaries) {
			if (lines.length > 0) lines.push("");
			lines.push(this.theme.fg("accent", fitLine(windowSummary.label, width)));
			const table = renderWindow(
				{ ...windowSummary, models: sortModels(windowSummary.models, sort.id, sort.descending) },
				{ layout, width },
			);
			lines.push(...table.header.map((line) => this.theme.fg("dim", fitLine(line, width))));
			table.rows.forEach((row, index) => {
				const line = fitLine(row, width);
				// toolPendingBg is the theme's neutral panel, a stripe rather than a selection.
				lines.push(index % 2 === 1 ? this.theme.bg("toolPendingBg", line) : line);
			});
		}
		const rule = this.theme.fg("border", "─".repeat(Math.max(1, width)));
		const arrow = sort.descending ? "↓" : "↑";
		return [rule, ...lines, "", this.theme.fg("dim", `[s] sort: ${sort.label} ${arrow}  [r] reverse  [q] close`), rule];
	}

	handleInput(data: string): void {
		if (this.picker) return;
		if (matchesKey(data, "escape") || matchesKey(data, "q") || parseKey(data) === "q") {
			this.picker?.hide();
			this.picker = undefined;
			this.onClose();
			return;
		}
		if (matchesKey(data, "s")) {
			this.openSortPicker();
			return;
		}
		if (matchesKey(data, "r")) {
			this.reversed = !this.reversed;
			this.requestRender();
		}
	}

	private openSortPicker(): void {
		if (this.picker) return;
		const current = this.sortDirection();
		const items = SORT_KEYS.flatMap((key) => {
			const natural = key.descending;
			return [natural, !natural].map((descending) => ({
				value: `${key.id}:${descending ? "desc" : "asc"}`,
				label: `${key.label} ${descending ? "↓" : "↑"}`,
			}));
		});
		const list = new SelectList(items, items.length, getSelectListTheme());
		const selected = items.findIndex((item) => item.value === `${current.id}:${current.descending ? "desc" : "asc"}`);
		if (selected >= 0) list.setSelectedIndex(selected);
		const close = () => {
			this.picker?.hide();
			this.picker = undefined;
			this.tui.setFocus(this);
			this.requestRender();
		};
		list.onSelect = (item) => {
			const [id, direction] = item.value.split(":");
			const index = SORT_KEYS.findIndex((key) => key.id === id);
			if (index >= 0) {
				const key = SORT_KEYS[index]!;
				this.sortIndex = index;
				this.reversed = (direction === "desc") !== key.descending;
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
	/** Open request attempt; before_provider_headers is the dispatch anchor. */
	let attempt: { startedAt: number; firstTokenAt?: number } | undefined;
	let writesSincePrune = 0;

	pi.on("before_provider_headers", () => {
		attempt = { startedAt: Date.now() };
	});

	pi.on("provider_stream_event", () => {
		if (attempt && attempt.firstTokenAt === undefined) attempt.firstTokenAt = Date.now();
	});

	pi.on("message_end", (event) => {
		const open = attempt;
		attempt = undefined;
		if (!open || event.message.role !== "assistant") return;
		const message = event.message;
		const finishedAt = Date.now();
		const key = `${message.provider}/${message.model}`;
		const outcome = classifyOutcome(message.stopReason, message.errorMessage);
		const record: StatsRecord =
			outcome === "ok"
				? {
						type: "ok",
						ts: finishedAt,
						key,
						ttftMs: (open.firstTokenAt ?? finishedAt) - open.startedAt,
						totalMs: finishedAt - open.startedAt,
						outputTokens: message.usage.output,
					}
				: { type: "fail", ts: finishedAt, key, kind: outcome };
		if (!isUsableRecord(record)) return;
		try {
			const path = statsPath();
			mkdirSync(dirname(path), { recursive: true });
			appendFileSync(path, `${serializeStatsRecord(record)}\n`, "utf-8");
			writesSincePrune += 1;
			if (writesSincePrune >= PRUNE_EVERY) {
				writesSincePrune = 0;
				writePruned(path);
			}
		} catch {
			// Stats are best-effort; a storage failure must not disturb the turn.
		}
	});

	pi.registerCommand("perf", {
		description: "Per-model response-time distributions (last hour / 24h / week)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/perf needs the interactive UI", "warning");
				return;
			}
			const summaries = summarize(readRecords(), Date.now());
			// In place, replacing the editor, as /usage does. An overlay is a popup.
			await ctx.ui.custom<void>((tui, theme, _kb, done) => new StatsView(theme, tui, summaries, () => done(), () => tui.requestRender()));
		},
	});
}
