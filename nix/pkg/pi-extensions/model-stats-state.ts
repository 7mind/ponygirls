/** Pure model-stats logic. No Pi imports, so the tests can run under node. */

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
/** Percentile columns per group: tok/s also shows the slow tail (p10, p1). */
const STANDARD_LABELS: readonly (keyof MetricStats)[] = ["mean", "p50", "p90", "p99"];
const TPS_LABELS: readonly (keyof MetricStats)[] = [...STANDARD_LABELS, "p10", "p1"];
/** Box-drawing bar, one terminal column, so string length is the display width. */
const COLUMN_GAP = " │ ";

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
	return widths.reduce((total, width) => total + width, 0) + COLUMN_GAP.length * (widths.length - 1);
}

/** Grow the last column so a group title cannot collide with the next group. */
function fitGroupTitle(title: string, widths: number[]): void {
	const deficit = title.length - blockWidth(widths);
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

function joinCells(cells: readonly string[]): string {
	return cells.join(COLUMN_GAP);
}

export interface RenderedWindow {
	/** Group titles, then the per-column header. No data rows. */
	header: string[];
	rows: string[];
}

export interface MetricGroup {
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
	const nWidth = Math.max("n".length, ...models.map((model) => String(model.responses).length));
	const failureWidths = FAILURE_KINDS.map((kind) =>
		Math.max(
			FAILURE_HEADERS[kind].length,
			...models.map((model) => (model.failures[kind] > 0 ? String(model.failures[kind]).length : 0)),
		),
	);
	const groups: MetricGroup[] = [
		{ title: "ttft s", labels: STANDARD_LABELS, widths: metricWidths(models, (model) => model.ttft, seconds, STANDARD_LABELS), pick: (model) => model.ttft, format: seconds },
		{ title: "total s", labels: STANDARD_LABELS, widths: metricWidths(models, (model) => model.total, seconds, STANDARD_LABELS), pick: (model) => model.total, format: seconds },
		{ title: "tok/s", labels: TPS_LABELS, widths: metricWidths(models, (model) => model.tps, rate, TPS_LABELS), pick: (model) => model.tps, format: rate },
	];
	for (const group of groups) fitGroupTitle(group.title, group.widths);
	return {
		nWidth,
		failureWidths,
		groups,
		modelWidth: Math.max("model".length, ...models.map((model) => model.key.length)),
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
/** View chrome around the scrollable content: top/bottom rules, blank, footer. */
export const STATS_CHROME_LINES = 4;

/** Half the terminal height for content, less the view chrome. Falls back to the default when the size is unknown (a stub TUI, no tty). */
export function defaultStatsBudget(rows: number | undefined): number {
	if (typeof rows !== "number" || !Number.isFinite(rows)) return STATS_DEFAULT_BUDGET;
	return clampStatsBudget(Math.floor(rows / 2) - STATS_CHROME_LINES);
}

/**
 * One window's table. Every column is as wide as its header or its widest
 * cell, and columns are separated by `│`. With a shared `layout` (see
 * {@link measureWindows}) columns keep the same width across windows; without
 * one the window is measured alone. When `width` is set and the natural table
 * is wider, the model column shrinks first; metric columns keep their content
 * width and the caller truncates the line.
 */
export function renderWindow(summary: WindowSummary, opts?: { layout?: WindowsLayout; width?: number }): RenderedWindow {
	if (summary.models.length === 0) return { header: ["(no samples)"], rows: [] };

	const layout = opts?.layout ?? measureWindows([summary]);
	const { nWidth, failureWidths, groups } = layout;
	const fixedWidth =
		nWidth +
		failureWidths.reduce((total, column) => total + column, 0) +
		groups.reduce((total, group) => total + blockWidth(group.widths), 0) +
		COLUMN_GAP.length * (1 + failureWidths.length + groups.length);
	const modelWidth = opts?.width === undefined
		? layout.modelWidth
		: Math.max(1, Math.min(layout.modelWidth, opts.width - fixedWidth));

	const header = joinCells([
		padRight("", modelWidth),
		padLeft("n", nWidth),
		...FAILURE_KINDS.map((kind, index) => padLeft(FAILURE_HEADERS[kind], failureWidths[index]!)),
		...groups.map((group) => padRight(group.title, blockWidth(group.widths))),
	]);
	const subHeader = joinCells([
		padRight("model", modelWidth),
		padLeft("", nWidth),
		...failureWidths.map((column) => padLeft("", column)),
		...groups.flatMap((group) => group.labels.map((label, index) => padLeft(label, group.widths[index]!))),
	]);
	const rows = summary.models.map((model) =>
		joinCells([
			padRight(ellipsize(model.key, modelWidth), modelWidth),
			padLeft(String(model.responses), nWidth),
			...FAILURE_KINDS.map((kind, index) => padLeft(model.failures[kind] > 0 ? String(model.failures[kind]) : "", failureWidths[index]!)),
			...groups.flatMap((group) => metricCells(group.pick(model), group.format, group.widths, group.labels)),
		]),
	);
	return { header: [header, subHeader], rows };
}
