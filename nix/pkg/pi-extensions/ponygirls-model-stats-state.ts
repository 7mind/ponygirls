/** Pure ponygirls-model-stats logic. No Pi runtime imports, so the tests can run under node; styling goes through the kit's UiTheme. */

import { countCell, GRID_SEPARATOR, gridRule, gridSeparator, type UiFg, type UiTheme } from "@ponygirls/pi-ui";
import {
	DEFAULT_VIEWPORT_BUDGET,
	MIN_VIEWPORT_BUDGET,
	MAX_VIEWPORT_BUDGET,
	WHEEL_LINES,
	VIEWPORT_BUDGET_STEP,
	clampViewportBudget,
	clampScrollTop,
	visibleRange,
} from "./scroll-state.ts";

export interface ResponseSample {
	type: "ok";
	/** Completion time, epoch milliseconds. */
	ts: number;
	/** Model identity in `provider/id` form. */
	key: string;
	/** Request dispatch to first provider stream event, milliseconds. */
	ttftMs: number;
	/** Request dispatch to finalized message, milliseconds. */
	totalMs: number;
	outputTokens: number;
}

export type FailureKind = "aborted" | "timeout" | "error";

export interface FailureRecord {
	type: "fail";
	ts: number;
	key: string;
	kind: FailureKind;
}

export type StatsRecord = ResponseSample | FailureRecord;

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** Longest reporting window; also the retention limit for stored records. */
export const WEEK_MS = 7 * DAY_MS;

export const WINDOWS = [
	{ label: "Last hour", ms: HOUR_MS },
	{ label: "Last 24 hours", ms: DAY_MS },
	{ label: "Last week", ms: WEEK_MS },
] as const;

const TIMEOUT_PATTERN = /\btimeout\b|\btimed out\b|deadline exceeded|etimedout/i;

/** Bucket a finalized message: "ok" messages are sampled; the rest only count. */
export function classifyOutcome(stopReason: string, errorMessage?: string): "ok" | FailureKind {
	if (stopReason === "aborted") return "aborted";
	if (stopReason === "error") return errorMessage && TIMEOUT_PATTERN.test(errorMessage) ? "timeout" : "error";
	return "ok";
}

/**
 * A decode window shorter than this is not a rate measurement. The first
 * provider stream event then arrived at completion — a buffered dump, not a
 * first content token — and dividing by that window produces multi-thousand
 * tok/s from a few milliseconds. Fall back to the full request span, the same
 * rule as a missing first-token mark.
 */
export const MIN_DECODE_MS = 100;

/** Output tokens per second over the decode span (first token → done). When that span is missing, the full request span is the rate. A positive span shorter than {@link MIN_DECODE_MS} is not a sample — see {@link isUsableRecord}. */
export function tokensPerSecond(sample: ResponseSample): number {
	const decodeMs = sample.totalMs - sample.ttftMs;
	const spanMs = decodeMs >= MIN_DECODE_MS ? decodeMs : Math.max(sample.totalMs, 1);
	return sample.outputTokens / (spanMs / 1000);
}

/**
 * A stored line is usable when it is a failure count, a measured decode
 * (span ≥ {@link MIN_DECODE_MS}), or a response with no first-token mark
 * (span 0; the full request is the rate). A positive span under the floor is
 * a stream event that arrived at completion, so neither ttft nor tok/s on
 * that line is a measurement.
 */
export function isUsableRecord(record: StatsRecord): boolean {
	if (record.type === "fail") return true;
	if (record.ttftMs < 0 || record.totalMs <= 0 || record.outputTokens < 0 || record.ttftMs > record.totalMs) return false;
	const decodeMs = record.totalMs - record.ttftMs;
	return decodeMs === 0 || decodeMs >= MIN_DECODE_MS;
}

/** Linear-interpolated percentile of an ascending-sorted list; NaN when empty. */
export function percentile(sorted: readonly number[], p: number): number {
	if (sorted.length === 0) return Number.NaN;
	const rank = (p / 100) * (sorted.length - 1);
	const lower = Math.floor(rank);
	const upper = Math.ceil(rank);
	const low = sorted[lower]!;
	const high = sorted[upper]!;
	return low + (high - low) * (rank - lower);
}

export interface MetricStats {
	mean: number;
	p50: number;
	p90: number;
	p99: number;
	p10: number;
	p1: number;
}

export function summarizeMetric(values: readonly number[]): MetricStats | undefined {
	if (values.length === 0) return undefined;
	const sorted = [...values].sort((left, right) => left - right);
	const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length;
	return {
		mean,
		p50: percentile(sorted, 50),
		p90: percentile(sorted, 90),
		p99: percentile(sorted, 99),
		p10: percentile(sorted, 10),
		p1: percentile(sorted, 1),
	};
}

export interface ModelWindowStats {
	key: string;
	responses: number;
	failures: Record<FailureKind, number>;
	ttft?: MetricStats;
	total?: MetricStats;
	tps?: MetricStats;
}

export interface WindowSummary {
	label: string;
	models: ModelWindowStats[];
}

/** Per-window, per-model aggregates over `records`, most active model first. */
export function summarize(records: readonly StatsRecord[], now: number): WindowSummary[] {
	return WINDOWS.map((window) => {
		const cutoff = now - window.ms;
		const byKey = new Map<string, { samples: ResponseSample[]; failures: Record<FailureKind, number> }>();
		for (const record of records) {
			if (record.ts < cutoff || !isUsableRecord(record)) continue;
			let bucket = byKey.get(record.key);
			if (!bucket) {
				bucket = { samples: [], failures: { aborted: 0, timeout: 0, error: 0 } };
				byKey.set(record.key, bucket);
			}
			if (record.type === "ok") bucket.samples.push(record);
			else bucket.failures[record.kind] += 1;
		}
		const models = [...byKey.entries()]
			.map(([key, bucket]): ModelWindowStats => {
				const sampled = bucket.samples;
				return {
					key,
					responses: sampled.length,
					failures: bucket.failures,
					ttft: summarizeMetric(sampled.map((sample) => sample.ttftMs)),
					total: summarizeMetric(sampled.map((sample) => sample.totalMs)),
					tps: summarizeMetric(sampled.map(tokensPerSecond)),
				};
			})
			.sort(
				(left, right) =>
					right.responses + failureTotal(right) - (left.responses + failureTotal(left)) ||
					left.key.localeCompare(right.key),
			);
		return { label: window.label, models };
	});
}

function failureTotal(model: ModelWindowStats): number {
	return model.failures.aborted + model.failures.timeout + model.failures.error;
}

/** View sort. `descending` is the direction used when the user has not reversed it. */
export const SORT_KEYS = [
	{ id: "tps-mean", label: "tok/s mean", descending: true },
	{ id: "tps-p50", label: "tok/s p50", descending: true },
	{ id: "ttft-mean", label: "ttft mean", descending: false },
	{ id: "total-mean", label: "total mean", descending: false },
	{ id: "n", label: "n", descending: true },
	{ id: "model", label: "model", descending: false },
] as const;

export type SortKeyId = (typeof SORT_KEYS)[number]["id"];

function sortValue(model: ModelWindowStats, id: SortKeyId): number | undefined {
	switch (id) {
		case "tps-mean":
			return model.tps?.mean;
		case "tps-p50":
			return model.tps?.p50;
		case "ttft-mean":
			return model.ttft?.mean;
		case "total-mean":
			return model.total?.mean;
		case "n":
			return model.responses;
		case "model":
			return undefined;
	}
}

/** Missing numeric values sort last. Ties break by model name, ascending. */
export function sortModels(models: readonly ModelWindowStats[], id: SortKeyId, descending: boolean): ModelWindowStats[] {
	return [...models].sort((left, right) => {
		if (id === "model") {
			const cmp = left.key.localeCompare(right.key);
			return descending ? -cmp : cmp;
		}
		const leftValue = sortValue(left, id);
		const rightValue = sortValue(right, id);
		if (leftValue === undefined && rightValue === undefined) return left.key.localeCompare(right.key);
		if (leftValue === undefined) return 1;
		if (rightValue === undefined) return -1;
		const diff = descending ? rightValue - leftValue : leftValue - rightValue;
		return diff || left.key.localeCompare(right.key);
	});
}

/** Drop records at or past the retention cutoff (epoch milliseconds). */
export function pruneRecords(records: readonly StatsRecord[], cutoff: number): StatsRecord[] {
	return records.filter((record) => record.ts >= cutoff);
}

/** Parse one JSONL record, or undefined for blank/malformed lines. */
export function parseStatsLine(line: string): StatsRecord | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object") return undefined;
	const record = parsed as {
		type?: unknown;
		ts?: unknown;
		key?: unknown;
		kind?: unknown;
		ttftMs?: unknown;
		totalMs?: unknown;
		outputTokens?: unknown;
	};
	if (!isFiniteNumber(record.ts) || typeof record.key !== "string" || !record.key.includes("/")) return undefined;
	if (record.type === "fail") {
		return record.kind === "aborted" || record.kind === "timeout" || record.kind === "error"
			? { type: "fail", ts: record.ts, key: record.key, kind: record.kind }
			: undefined;
	}
	if (record.type === "ok") {
		if (!isFiniteNumber(record.ttftMs) || !isFiniteNumber(record.totalMs) || !isFiniteNumber(record.outputTokens))
			return undefined;
		return { type: "ok", ts: record.ts, key: record.key, ttftMs: record.ttftMs, totalMs: record.totalMs, outputTokens: record.outputTokens };
	}
	return undefined;
}

export function serializeStatsRecord(record: StatsRecord): string {
	return JSON.stringify(record);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

const FAILURE_KINDS: readonly FailureKind[] = ["aborted", "timeout", "error"];
const FAILURE_HEADERS: Record<FailureKind, string> = { aborted: "abrt", timeout: "tout", error: "err" };
/** Positive failure counts: aborts and timeouts warn, errors are errors. */
const FAILURE_COLORS: Record<FailureKind, UiFg> = { aborted: "warning", timeout: "warning", error: "error" };
/** Percentile columns per group: tok/s also shows the slow tail (p10, p1). */
const STANDARD_LABELS: readonly (keyof MetricStats)[] = ["mean", "p50", "p90", "p99"];
const TPS_LABELS: readonly (keyof MetricStats)[] = [...STANDARD_LABELS, "p10", "p1"];
/** Cells inside one metric group are space-separated; `│` marks group boundaries only. */
const GROUP_CELL_GAP = "  ";
/** Every sortable header reserves room for ` ↓`, so a sort change never moves columns. */
const SORT_ARROW_WIDTH = 2;

function sortArrow(descending: boolean): string {
	return descending ? "↓" : "↑";
}

function padLeft(text: string, width: number): string {
	return text.length >= width ? text : `${" ".repeat(width - text.length)}${text}`;
}

function padRight(text: string, width: number): string {
	return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function ellipsize(text: string, width: number): string {
	if (text.length <= width) return text;
	if (width <= 1) return text.slice(0, width);
	return `${text.slice(0, width - 1)}…`;
}

function seconds(ms: number): string {
	const value = ms / 1000;
	return value < 100 ? value.toFixed(1) : String(Math.round(value));
}

function rate(tokensPerSec: number): string {
	return tokensPerSec < 100 ? tokensPerSec.toFixed(1) : String(Math.round(tokensPerSec));
}

function blockWidth(widths: readonly number[]): number {
	return widths.reduce((total, width) => total + width, 0) + GROUP_CELL_GAP.length * (widths.length - 1);
}

/** Grow the last column so a group title (with its sort arrow) cannot collide with the next group. */
function fitGroupTitle(title: string, widths: number[]): void {
	const deficit = title.length + SORT_ARROW_WIDTH - blockWidth(widths);
	if (deficit > 0) widths[widths.length - 1] = widths[widths.length - 1]! + deficit;
}

function metricWidths(
	models: readonly ModelWindowStats[],
	pick: (model: ModelWindowStats) => MetricStats | undefined,
	format: (value: number) => string,
	labels: readonly (keyof MetricStats)[],
): number[] {
	const widths = labels.map((label) => label.length);
	for (const model of models) {
		const stats = pick(model);
		const values = stats ? labels.map((label) => format(stats[label])) : labels.map(() => "-");
		values.forEach((value, index) => {
			widths[index] = Math.max(widths[index]!, value.length);
		});
	}
	return widths;
}

function metricCells(
	stats: MetricStats | undefined,
	format: (value: number) => string,
	widths: readonly number[],
	labels: readonly (keyof MetricStats)[],
): string[] {
	const values = stats ? labels.map((label) => format(stats[label])) : labels.map(() => "-");
	return values.map((value, index) => padLeft(value, widths[index]!));
}

export interface RenderedWindow {
	/** Group titles, the per-column header, and the `─┼─` rule. No data rows. */
	header: string[];
	rows: string[];
}

export type MetricGroupId = "ttft" | "total" | "tps";

export interface MetricGroup {
	id: MetricGroupId;
	title: string;
	labels: readonly (keyof MetricStats)[];
	widths: number[];
	pick: (model: ModelWindowStats) => MetricStats | undefined;
	format: (value: number) => string;
}

/** Column widths shared by several windows, so stacked tables stay aligned. */
export interface WindowsLayout {
	nWidth: number;
	failureWidths: number[];
	groups: MetricGroup[];
	/** Widest model key across the measured windows, before `width` clamping. */
	modelWidth: number;
}

/** Measure every column across `summaries`: one layout keeps all tables aligned. */
export function measureWindows(summaries: readonly WindowSummary[]): WindowsLayout {
	const models = summaries.flatMap((summary) => summary.models);
	const nWidth = Math.max("n".length + SORT_ARROW_WIDTH, ...models.map((model) => String(model.responses).length));
	const failureWidths = FAILURE_KINDS.map((kind) =>
		Math.max(
			FAILURE_HEADERS[kind].length,
			...models.map((model) => (model.failures[kind] > 0 ? String(model.failures[kind]).length : 0)),
		),
	);
	const groups: MetricGroup[] = [
		{ id: "ttft", title: "ttft s", labels: STANDARD_LABELS, widths: metricWidths(models, (model) => model.ttft, seconds, STANDARD_LABELS), pick: (model) => model.ttft, format: seconds },
		{ id: "total", title: "total s", labels: STANDARD_LABELS, widths: metricWidths(models, (model) => model.total, seconds, STANDARD_LABELS), pick: (model) => model.total, format: seconds },
		{ id: "tps", title: "tok/s", labels: TPS_LABELS, widths: metricWidths(models, (model) => model.tps, rate, TPS_LABELS), pick: (model) => model.tps, format: rate },
	];
	for (const group of groups) fitGroupTitle(group.title, group.widths);
	return {
		nWidth,
		failureWidths,
		groups,
		modelWidth: Math.max("model".length + SORT_ARROW_WIDTH, ...models.map((model) => model.key.length)),
	};
}

/**
 * Scrollable /perf viewport. `Component.render(width)` never sees the
 * allocated height, so the view keeps its own line budget — the files-widget
 * `browserHeight` precedent — instead of estimating the dock. The math lives
 * in ./scroll-state.ts; the STATS_* names stay for existing importers.
 */
export const STATS_DEFAULT_BUDGET = DEFAULT_VIEWPORT_BUDGET;
export const STATS_MIN_BUDGET = MIN_VIEWPORT_BUDGET;
export const STATS_MAX_BUDGET = MAX_VIEWPORT_BUDGET;
/** Wheel lines per notch; a selection moves one row, a table moves a few lines. */
export const STATS_WHEEL_STEP = WHEEL_LINES;
/** Budget resize step for the `+`/`-` keys. */
export const STATS_BUDGET_STEP = VIEWPORT_BUDGET_STEP;
export const clampStatsBudget = clampViewportBudget;
export const clampStatsScrollTop = clampScrollTop;
export const statsVisibleRange = visibleRange;
/** View chrome around the scrollable content: frame title, rule, one key-hint line. */
export const STATS_CHROME_LINES = 3;

/** Half the terminal height for content, less the view chrome. Falls back to the default when the size is unknown (a stub TUI, no tty). */
export function defaultStatsBudget(rows: number | undefined): number {
	if (typeof rows !== "number" || !Number.isFinite(rows)) return STATS_DEFAULT_BUDGET;
	return clampStatsBudget(Math.floor(rows / 2) - STATS_CHROME_LINES);
}

/** The column a sort key orders by. */
type SortColumn =
	| { kind: "model" }
	| { kind: "n" }
	| { kind: "metric"; group: MetricGroupId; label: keyof MetricStats };

const SORT_COLUMNS: Record<SortKeyId, SortColumn> = {
	"tps-mean": { kind: "metric", group: "tps", label: "mean" },
	"tps-p50": { kind: "metric", group: "tps", label: "p50" },
	"ttft-mean": { kind: "metric", group: "ttft", label: "mean" },
	"total-mean": { kind: "metric", group: "total", label: "mean" },
	n: { kind: "n" },
	model: { kind: "model" },
};

/** The active view sort, marked in the table header. */
export interface SortOrder {
	id: SortKeyId;
	descending: boolean;
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Bold window label, then a dim summary: models and requests (responses plus failures). */
export function windowTitle(theme: UiTheme, summary: WindowSummary): string {
	const title = theme.bold(theme.fg("text", summary.label));
	if (summary.models.length === 0) return title;
	const requests = summary.models.reduce((total, model) => total + model.responses + failureTotal(model), 0);
	return title + theme.fg("dim", ` · ${plural(summary.models.length, "model")} · ${plural(requests, "request")}`);
}

/**
 * One window's table. Every column is as wide as its header or its widest
 * cell. Columns are separated by a dim `│`, except the percentile cells inside
 * one metric group, which are separated by spaces; a `─┼─` rule closes the
 * header. The sorted column's header is accent with the sort arrow and its
 * values are bold. Failure counts are coloured when positive, a dim `·` when
 * zero. With a shared `layout` (see {@link measureWindows}) columns keep the
 * same width across windows; without one the window is measured alone. When
 * `width` is set and the natural table is wider, the model column shrinks
 * first; metric columns keep their content width and the caller truncates the
 * line.
 */
export function renderWindow(
	summary: WindowSummary,
	theme: UiTheme,
	sort: SortOrder,
	opts?: { layout?: WindowsLayout; width?: number },
): RenderedWindow {
	if (summary.models.length === 0) return { header: [theme.fg("dim", "(no samples)")], rows: [] };

	const layout = opts?.layout ?? measureWindows([summary]);
	const { nWidth, failureWidths, groups } = layout;
	const fixedWidth =
		nWidth +
		failureWidths.reduce((total, column) => total + column, 0) +
		groups.reduce((total, group) => total + blockWidth(group.widths), 0) +
		GRID_SEPARATOR.length * (1 + failureWidths.length + groups.length);
	const modelWidth = opts?.width === undefined
		? layout.modelWidth
		: Math.max(1, Math.min(layout.modelWidth, opts.width - fixedWidth));

	const column = SORT_COLUMNS[sort.id];
	const arrow = ` ${sortArrow(sort.descending)}`;
	const groupSorted = (group: MetricGroup): boolean => column.kind === "metric" && column.group === group.id;
	const labelSorted = (group: MetricGroup, label: keyof MetricStats): boolean =>
		column.kind === "metric" && column.group === group.id && column.label === label;
	const dim = (text: string): string => theme.fg("dim", text);
	const marked = (text: string): string => theme.bold(theme.fg("accent", text));
	const emphasize = (text: string, sorted: boolean): string => (sorted ? theme.bold(text) : text);
	const separator = gridSeparator(theme);

	const header = [
		" ".repeat(modelWidth),
		column.kind === "n" ? marked(padLeft(`n${arrow}`, nWidth)) : dim(padLeft("n", nWidth)),
		...FAILURE_KINDS.map((kind, index) => dim(padLeft(FAILURE_HEADERS[kind], failureWidths[index]!))),
		...groups.map((group) =>
			groupSorted(group)
				? marked(padRight(`${group.title}${arrow}`, blockWidth(group.widths)))
				: dim(padRight(group.title, blockWidth(group.widths))),
		),
	].join(separator);
	const subHeader = [
		column.kind === "model"
			? marked(padRight(ellipsize(`model${arrow}`, modelWidth), modelWidth))
			: dim(padRight(ellipsize("model", modelWidth), modelWidth)),
		" ".repeat(nWidth),
		...failureWidths.map((width) => " ".repeat(width)),
		...groups.map((group) =>
			group.labels
				.map((label, index) => {
					const text = padLeft(label, group.widths[index]!);
					return labelSorted(group, label) ? marked(text) : dim(text);
				})
				.join(GROUP_CELL_GAP),
		),
	].join(separator);
	const rule = gridRule(theme, [modelWidth, nWidth, ...failureWidths, ...groups.map((group) => blockWidth(group.widths))], "┼");
	const rows = summary.models.map((model) =>
		[
			emphasize(padRight(ellipsize(model.key, modelWidth), modelWidth), column.kind === "model"),
			emphasize(padLeft(String(model.responses), nWidth), column.kind === "n"),
			...FAILURE_KINDS.map((kind, index) => countCell(theme, model.failures[kind], failureWidths[index]!, FAILURE_COLORS[kind])),
			...groups.map((group) =>
				metricCells(group.pick(model), group.format, group.widths, group.labels)
					.map((cell, index) => emphasize(cell, labelSorted(group, group.labels[index]!)))
					.join(GROUP_CELL_GAP),
			),
		].join(separator),
	);
	return { header: [header, subHeader, rule], rows };
}
