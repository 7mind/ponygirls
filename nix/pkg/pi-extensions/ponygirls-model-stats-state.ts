/** Pure ponygirls-model-stats logic. No Pi runtime imports, so the tests can run under node; styling goes through the kit's UiTheme. */

import {
	countCell,
	fit,
	fitRight,
	formatCount,
	frameRule,
	frameTitle,
	GRID_SEPARATOR,
	gridRule,
	gridSeparator,
	HINT,
	KEY,
	keyHints,
	zebra,
	type KeyHint,
	type RenderedTitle,
	type Span,
	type UiFg,
	type UiTheme,
} from "@ponygirls/pi-ui";
import {
	DEFAULT_VIEWPORT_BUDGET,
	MIN_VIEWPORT_BUDGET,
	MAX_VIEWPORT_BUDGET,
	WHEEL_LINES,
	VIEWPORT_BUDGET_STEP,
	clampViewportBudget,
	clampScrollTop,
	scrollPosition,
	visibleRange,
} from "./scroll-state.ts";
import { THINKING_LEVELS } from "./ponygirls-model-picker-effort.ts";

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
	/** See {@link FailureRecord.effort}. */
	effort?: string;
}

export type FailureKind = "aborted" | "timeout" | "error";

export interface FailureRecord {
	type: "fail";
	ts: number;
	key: string;
	kind: FailureKind;
	/**
	 * Pi thinking level requested for the response (`AssistantMessage.thinkingLevel`,
	 * "off" included). Absent on records written before it was stored, or when
	 * Pi did not report one. Any non-empty string is kept, so a level a later Pi
	 * adds is not dropped from the file on load.
	 */
	effort?: string;
}

export type StatsRecord = ResponseSample | FailureRecord;

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** Longest reporting window; also the retention limit for stored records. */
export const WEEK_MS = 7 * DAY_MS;

/** Reporting periods, shortest first; the labels are the view's tabs. */
export const WINDOWS = [
	{ label: "Last hour", ms: HOUR_MS },
	{ label: "24 hours", ms: DAY_MS },
	{ label: "Week", ms: WEEK_MS },
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

/** Row grouping: one row per model, or one per model and effort. */
export type StatsBreakdown = "model" | "effort";

/** Effort cell of records that carry no effort (written before effort was stored). */
export const UNRECORDED_EFFORT = "?";

export interface ModelWindowStats {
	key: string;
	/** The row's effort (or {@link UNRECORDED_EFFORT}); set exactly when the window's breakdown is "effort". */
	effort?: string;
	responses: number;
	failures: Record<FailureKind, number>;
	ttft?: MetricStats;
	total?: MetricStats;
	tps?: MetricStats;
}

export interface WindowSummary {
	label: string;
	breakdown: StatsBreakdown;
	models: ModelWindowStats[];
}

interface RowBucket {
	key: string;
	effort: string | undefined;
	samples: ResponseSample[];
	failures: Record<FailureKind, number>;
}

/**
 * Per-window aggregates over `records`, most active row first: one row per
 * model, or with the "effort" breakdown one per model and effort.
 */
export function summarize(records: readonly StatsRecord[], now: number, breakdown: StatsBreakdown): WindowSummary[] {
	return WINDOWS.map((window) => {
		const cutoff = now - window.ms;
		const buckets = new Map<string, RowBucket>();
		for (const record of records) {
			if (record.ts < cutoff || !isUsableRecord(record)) continue;
			const effort = breakdown === "effort" ? (record.effort ?? UNRECORDED_EFFORT) : undefined;
			// JSON keeps the pair unambiguous whatever characters the key holds.
			const id = JSON.stringify([record.key, effort ?? null]);
			let bucket = buckets.get(id);
			if (!bucket) {
				bucket = { key: record.key, effort, samples: [], failures: { aborted: 0, timeout: 0, error: 0 } };
				buckets.set(id, bucket);
			}
			if (record.type === "ok") bucket.samples.push(record);
			else bucket.failures[record.kind] += 1;
		}
		const models = [...buckets.values()]
			.map((bucket): ModelWindowStats => {
				const sampled = bucket.samples;
				return {
					key: bucket.key,
					...(bucket.effort === undefined ? {} : { effort: bucket.effort }),
					responses: sampled.length,
					failures: bucket.failures,
					ttft: summarizeMetric(sampled.map((sample) => sample.ttftMs)),
					total: summarizeMetric(sampled.map((sample) => sample.totalMs)),
					tps: summarizeMetric(sampled.map(tokensPerSecond)),
				};
			})
			.sort(
				(left, right) =>
					right.responses + failureTotal(right) - (left.responses + failureTotal(left)) || compareRows(left, right),
			);
		return { label: window.label, breakdown, models };
	});
}

/** Pi's levels in ascending order, then unknown levels by name, then {@link UNRECORDED_EFFORT}. */
export function compareEfforts(left: string | undefined, right: string | undefined): number {
	const rank = (effort: string | undefined): number => {
		if (effort === undefined || effort === UNRECORDED_EFFORT) return THINKING_LEVELS.length + 1;
		const index = (THINKING_LEVELS as readonly string[]).indexOf(effort);
		return index >= 0 ? index : THINKING_LEVELS.length;
	};
	return rank(left) - rank(right) || (left ?? "").localeCompare(right ?? "");
}

/** Model name ascending, then effort ascending: the tie-break of every sort. */
function compareRows(left: ModelWindowStats, right: ModelWindowStats): number {
	return left.key.localeCompare(right.key) || compareEfforts(left.effort, right.effort);
}

function failureTotal(model: ModelWindowStats): number {
	return model.failures.aborted + model.failures.timeout + model.failures.error;
}

export type MetricGroupId = "ttft" | "total" | "tps";

/** Which columns the table shows: the compact default, or every statistic. */
export type ColumnSet = "compact" | "full";

/** A sortable column: the model name, a count column, or one statistic of a metric group. */
export type SortKeyId = "model" | "n" | "fail" | FailureKind | `${MetricGroupId}-${keyof MetricStats}`;

export interface SortKey {
	id: SortKeyId;
	label: string;
	/** The direction used when the user has not reversed it. */
	descending: boolean;
}

/** The active view sort, named in the title and marked in the table header. */
export interface SortOrder {
	id: SortKeyId;
	descending: boolean;
}

/** Median throughput, fastest first; both column sets show that column. */
export const DEFAULT_SORT: SortOrder = { id: "tps-p50", descending: true };

function metricSortId(group: MetricGroupId, stat: keyof MetricStats): SortKeyId {
	return `${group}-${stat}`;
}

/** What the sort picker offers: the columns of a column set, left to right. */
export function sortKeys(columns: ColumnSet): SortKey[] {
	const set = COLUMN_SETS[columns];
	return [
		{ id: "model", label: MODEL_HEADER, descending: false },
		{ id: "n", label: N_HEADER, descending: true },
		...set.failures.map((column): SortKey => ({ id: column.id, label: column.header, descending: true })),
		...METRIC_GROUPS.flatMap((group) =>
			set.stats[group.id].map((stat): SortKey => ({
				id: metricSortId(group.id, stat),
				label: `${group.name} ${stat}`,
				descending: group.descending,
			})),
		),
	];
}

/** The sort the table shows: the requested one, or the default when its column is not in the column set. */
export function shownSort(sort: SortOrder, columns: ColumnSet): SortOrder {
	return sortKeys(columns).some((key) => key.id === sort.id) ? sort : DEFAULT_SORT;
}

/** The metric group and statistic a sort key orders by; undefined for the model and count keys. */
function sortedMetric(id: SortKeyId): { group: MetricGroupSpec; stat: keyof MetricStats } | undefined {
	for (const group of METRIC_GROUPS) {
		const stat = TPS_LABELS.find((candidate) => metricSortId(group.id, candidate) === id);
		if (stat !== undefined) return { group, stat };
	}
	return undefined;
}

function sortValue(model: ModelWindowStats, id: SortKeyId): number | undefined {
	switch (id) {
		case "model":
			return undefined;
		case "n":
			return model.responses;
		case "fail":
			return failureTotal(model);
		case "aborted":
		case "timeout":
		case "error":
			return model.failures[id];
		default: {
			const metric = sortedMetric(id);
			if (metric === undefined) throw new Error(`model-stats: no column for sort key ${id}`);
			return metric.group.pick(model)?.[metric.stat];
		}
	}
}

/**
 * Missing numeric values sort last. Ties break by model name, then effort,
 * ascending. The model sort reverses the model order only: one model's
 * effort rows stay in ascending effort order.
 */
export function sortModels(models: readonly ModelWindowStats[], id: SortKeyId, descending: boolean): ModelWindowStats[] {
	return [...models].sort((left, right) => {
		if (id === "model") {
			const cmp = left.key.localeCompare(right.key);
			return (descending ? -cmp : cmp) || compareEfforts(left.effort, right.effort);
		}
		const leftValue = sortValue(left, id);
		const rightValue = sortValue(right, id);
		if (leftValue === undefined && rightValue === undefined) return compareRows(left, right);
		if (leftValue === undefined) return 1;
		if (rightValue === undefined) return -1;
		const diff = descending ? rightValue - leftValue : leftValue - rightValue;
		return diff || compareRows(left, right);
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
		effort?: unknown;
	};
	if (!isFiniteNumber(record.ts) || typeof record.key !== "string" || !record.key.includes("/")) return undefined;
	if (record.effort !== undefined && (typeof record.effort !== "string" || record.effort === "")) return undefined;
	const effort = record.effort === undefined ? {} : { effort: record.effort };
	if (record.type === "fail") {
		return record.kind === "aborted" || record.kind === "timeout" || record.kind === "error"
			? { type: "fail", ts: record.ts, key: record.key, kind: record.kind, ...effort }
			: undefined;
	}
	if (record.type === "ok") {
		if (!isFiniteNumber(record.ttftMs) || !isFiniteNumber(record.totalMs) || !isFiniteNumber(record.outputTokens))
			return undefined;
		return {
			type: "ok",
			ts: record.ts,
			key: record.key,
			ttftMs: record.ttftMs,
			totalMs: record.totalMs,
			outputTokens: record.outputTokens,
			...effort,
		};
	}
	return undefined;
}

export function serializeStatsRecord(record: StatsRecord): string {
	return JSON.stringify(record);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

const MODEL_HEADER = "model";
const EFFORT_HEADER = "effort";
const N_HEADER = "n";

function effortOf(model: ModelWindowStats): string {
	if (model.effort === undefined) throw new Error(`model-stats: effort row ${model.key} has no effort`);
	return model.effort;
}

const FAILURE_KINDS: readonly FailureKind[] = ["aborted", "timeout", "error"];
const FAILURE_HEADERS: Record<FailureKind, string> = { aborted: "abrt", timeout: "tout", error: "err" };
/** Positive failure counts: aborts and timeouts warn, errors are errors. */
const FAILURE_COLORS: Record<FailureKind, UiFg> = { aborted: "warning", timeout: "warning", error: "error" };
/** Percentile columns per group: tok/s also shows the slow tail (p10, p1). */
const STANDARD_LABELS: readonly (keyof MetricStats)[] = ["mean", "p50", "p90", "p99"];
const TPS_LABELS: readonly (keyof MetricStats)[] = [...STANDARD_LABELS, "p10", "p1"];
/** The compact set keeps the median and the tails: slow responses, and for tok/s slow decoding. */
const COMPACT_LABELS: readonly (keyof MetricStats)[] = ["p50", "p90", "p99"];
const COMPACT_TPS_LABELS: readonly (keyof MetricStats)[] = ["p50", "p90", "p10"];
/** Cells inside one metric group are space-separated; `│` marks group boundaries only. */
const GROUP_CELL_GAP = "  ";
/** Every sortable header reserves room for ` ↓`, so a sort change never moves columns. */
const SORT_ARROW_WIDTH = 2;
const ELLIPSIS = "…";

function sortArrow(descending: boolean): string {
	return descending ? "↓" : "↑";
}

function sortableHeaderWidth(header: string): number {
	return header.length + SORT_ARROW_WIDTH;
}

function seconds(ms: number): string {
	const value = ms / 1000;
	return value < 100 ? value.toFixed(1) : String(Math.round(value));
}

function rate(tokensPerSec: number): string {
	return tokensPerSec < 100 ? tokensPerSec.toFixed(1) : String(Math.round(tokensPerSec));
}

/** Zero stays quiet: the kit's dim `·`. Its colour argument is for positive counts, which are grouped here instead. */
function zeroCell(theme: UiTheme, width: number): string {
	return countCell(theme, 0, width, "dim");
}

/** A failure column: one kind's count in the full set, every kind in the compact `fail`. */
interface FailureColumn {
	id: SortKeyId;
	header: string;
	/** The unstyled cell, for measuring; empty when the row has no such failure. */
	text: (model: ModelWindowStats) => string;
	cell: (theme: UiTheme, model: ModelWindowStats, width: number) => string;
}

const KIND_COLUMNS: readonly FailureColumn[] = FAILURE_KINDS.map((kind) => ({
	id: kind,
	header: FAILURE_HEADERS[kind],
	text: (model) => (model.failures[kind] > 0 ? formatCount(model.failures[kind]) : ""),
	cell: (theme, model, width) =>
		model.failures[kind] > 0
			? theme.fg(FAILURE_COLORS[kind], fitRight(formatCount(model.failures[kind]), width))
			: zeroCell(theme, width),
}));

/** The compact `fail` cell names what failed, worst first. */
const FAIL_PARTS: readonly { kind: FailureKind; unit: string; color: UiFg }[] = [
	{ kind: "error", unit: "err", color: "error" },
	{ kind: "timeout", unit: "t/o", color: "warning" },
	{ kind: "aborted", unit: "abrt", color: "muted" },
];
const FAIL_PART_GAP = " ";

function failParts(model: ModelWindowStats): { text: string; color: UiFg }[] {
	return FAIL_PARTS.filter((part) => model.failures[part.kind] > 0).map((part) => ({
		text: `${formatCount(model.failures[part.kind])} ${part.unit}`,
		color: part.color,
	}));
}

const FAIL_COLUMN: FailureColumn = {
	id: "fail",
	header: "fail",
	text: (model) =>
		failParts(model)
			.map((part) => part.text)
			.join(FAIL_PART_GAP),
	cell: (theme, model, width) => {
		const parts = failParts(model);
		if (parts.length === 0) return zeroCell(theme, width);
		const used = parts.reduce((total, part) => total + part.text.length, 0) + FAIL_PART_GAP.length * (parts.length - 1);
		return " ".repeat(Math.max(0, width - used)) + parts.map((part) => theme.fg(part.color, part.text)).join(FAIL_PART_GAP);
	},
};

interface ColumnSetSpec {
	failures: readonly FailureColumn[];
	stats: Readonly<Record<MetricGroupId, readonly (keyof MetricStats)[]>>;
}

const COLUMN_SETS: Readonly<Record<ColumnSet, ColumnSetSpec>> = {
	compact: { failures: [FAIL_COLUMN], stats: { ttft: COMPACT_LABELS, total: COMPACT_LABELS, tps: COMPACT_TPS_LABELS } },
	full: { failures: KIND_COLUMNS, stats: { ttft: STANDARD_LABELS, total: STANDARD_LABELS, tps: TPS_LABELS } },
};

interface MetricGroupSpec {
	id: MetricGroupId;
	/** Table header, with the unit. */
	title: string;
	/** Name in sort labels. */
	name: string;
	pick: (model: ModelWindowStats) => MetricStats | undefined;
	format: (value: number) => string;
	/** The sort direction that puts the best value first. */
	descending: boolean;
}

const METRIC_GROUPS: readonly MetricGroupSpec[] = [
	{ id: "ttft", title: "ttft s", name: "ttft", pick: (model) => model.ttft, format: seconds, descending: false },
	{ id: "total", title: "total s", name: "total", pick: (model) => model.total, format: seconds, descending: false },
	{ id: "tps", title: "tok/s", name: "tok/s", pick: (model) => model.tps, format: rate, descending: true },
];

function blockWidth(widths: readonly number[]): number {
	return widths.reduce((total, width) => total + width, 0) + GROUP_CELL_GAP.length * (widths.length - 1);
}

/** Grow the last column so a group title (with its sort arrow) cannot collide with the next group. */
function fitGroupTitle(title: string, widths: number[]): void {
	const deficit = sortableHeaderWidth(title) - blockWidth(widths);
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
	return values.map((value, index) => fitRight(value, widths[index]!));
}

export interface RenderedWindow {
	/** Group titles, the per-column header, and the `─┼─` rule. No data rows. */
	header: string[];
	rows: string[];
}

/** A metric group as laid out: the statistics shown and the width of each. */
export interface MetricGroup extends MetricGroupSpec {
	labels: readonly (keyof MetricStats)[];
	widths: number[];
}

/** One window's table columns, left to right. */
export interface WindowLayout {
	columns: ColumnSet;
	modelWidth: number;
	/** The effort column, present exactly for the "effort" breakdown. */
	effortWidth: number | undefined;
	nWidth: number;
	/** One width per failure column of the column set. */
	failureWidths: number[];
	/** The metric groups shown. */
	groups: MetricGroup[];
	/** Titles of the metric groups dropped at this width. */
	hidden: string[];
}

/** The widths `│` separates: a metric group is one block. */
function blockWidths(layout: WindowLayout): number[] {
	return [
		layout.modelWidth,
		...(layout.effortWidth === undefined ? [] : [layout.effortWidth]),
		layout.nWidth,
		...layout.failureWidths,
		...layout.groups.map((group) => blockWidth(group.widths)),
	];
}

function layoutWidth(layout: WindowLayout): number {
	const widths = blockWidths(layout);
	return widths.reduce((total, width) => total + width, 0) + GRID_SEPARATOR.length * (widths.length - 1);
}

/** The natural layout: every column as wide as its header or its widest cell, the model column included. */
function measureWindow(summary: WindowSummary, columns: ColumnSet): WindowLayout {
	const { models } = summary;
	const set = COLUMN_SETS[columns];
	return {
		columns,
		modelWidth: Math.max(sortableHeaderWidth(MODEL_HEADER), ...models.map((model) => model.key.length)),
		effortWidth:
			summary.breakdown === "effort"
				? Math.max(EFFORT_HEADER.length, ...models.map((model) => effortOf(model).length))
				: undefined,
		nWidth: Math.max(sortableHeaderWidth(N_HEADER), ...models.map((model) => formatCount(model.responses).length)),
		failureWidths: set.failures.map((column) =>
			Math.max(sortableHeaderWidth(column.header), ...models.map((model) => column.text(model).length)),
		),
		groups: METRIC_GROUPS.map((group) => {
			const labels = set.stats[group.id];
			const widths = metricWidths(models, group.pick, group.format, labels);
			fitGroupTitle(group.title, widths);
			return { ...group, labels, widths };
		}),
		hidden: [],
	};
}

/**
 * The column set shown: the user's choice once made; until then every
 * statistic when that table fits `width` with the model column at its
 * natural width, the compact set otherwise. All of a breakdown's periods
 * have to fit, so switching tabs never changes the columns.
 */
export function shownColumns(choice: ColumnSet | undefined, periods: readonly WindowSummary[], width: number): ColumnSet {
	if (choice !== undefined) return choice;
	return periods.every((summary) => layoutWidth(measureWindow(summary, "full")) <= width) ? "full" : "compact";
}

/**
 * A model label in at most `width` columns, shortened in the middle. The
 * path segments between provider and model go first (`provider/…/model`).
 * A label still too long keeps its start and its end around the `…`: at
 * most half for the start, and no further than the provider's `/` when
 * there are middle segments to leave out; the end takes the rest.
 */
export function shortenModelLabel(key: string, width: number): string {
	if (key.length <= width) return key;
	const segments = key.split("/");
	const provider = `${segments[0]}/`;
	const hasMiddle = segments.length > 2;
	if (hasMiddle) {
		const outer = `${provider}${ELLIPSIS}/${segments[segments.length - 1]}`;
		if (outer.length <= width) return outer;
	}
	const kept = Math.max(0, width - ELLIPSIS.length);
	const head = Math.min(Math.floor(kept / 2), hasMiddle ? provider.length : kept);
	return `${key.slice(0, head)}${ELLIPSIS}${key.slice(key.length - (kept - head))}`;
}

/** Model labels keep this many columns for as long as a metric group can be dropped instead. */
export const MIN_MODEL_WIDTH = 24;
/** Metric groups dropped at narrow widths, first to last. n, the failure columns and tok/s always stay. */
const DROPPED_GROUPS: readonly MetricGroupId[] = ["total", "ttft"];

/** A window's table laid out for a width, or the least width that table can be shown in. */
export type WindowFit = { kind: "layout"; layout: WindowLayout } | { kind: "too-narrow"; needs: number };

/**
 * Fit a window's table into `width` columns without clipping a cell. The
 * model column is first in line: it keeps its natural width while the table
 * fits. A narrower pane shortens the model labels in the middle, down to
 * {@link MIN_MODEL_WIDTH}; past that `total s`, then `ttft s` are dropped,
 * each giving its columns back to the labels. With only the columns that
 * always stay, the labels take what is left, down to the column's header;
 * below that the table cannot be shown.
 */
export function layoutWindow(summary: WindowSummary, columns: ColumnSet, width: number): WindowFit {
	const natural = measureWindow(summary, columns);
	const comfortable = Math.min(natural.modelWidth, MIN_MODEL_WIDTH);
	let groups = natural.groups;
	const others = (): number => layoutWidth({ ...natural, groups }) - natural.modelWidth;
	for (const dropped of DROPPED_GROUPS) {
		if (width - others() >= comfortable) break;
		groups = groups.filter((group) => group.id !== dropped);
	}
	const headerWidth = sortableHeaderWidth(MODEL_HEADER);
	const room = Math.min(natural.modelWidth, width - others());
	if (room < headerWidth) return { kind: "too-narrow", needs: others() + headerWidth };
	return {
		kind: "layout",
		layout: {
			...natural,
			// Labels shortened by whole segments can leave part of the room unused.
			modelWidth: Math.max(headerWidth, ...summary.models.map((model) => shortenModelLabel(model.key, room).length)),
			groups,
			hidden: natural.groups.filter((group) => !groups.includes(group)).map((group) => group.title),
		},
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
export { TABLE_CHROME_LINES as STATS_CHROME_LINES, defaultTableBudget as defaultStatsBudget } from "./scroll-state.ts";

/**
 * One window's table in a layout from {@link layoutWindow}. Columns are
 * separated by a dim `│`, except the percentile cells inside one metric
 * group, which are separated by spaces; a `─┼─` rule closes the header. Group
 * titles are on the first header line, column labels on the second. The
 * sorted column's header is accent with the sort arrow (a metric group
 * carries the arrow, its sorted statistic the accent) and its values are
 * bold. A zero count is a dim `·`; failure counts are coloured.
 */
export function renderWindow(summary: WindowSummary, theme: UiTheme, sort: SortOrder, layout: WindowLayout): RenderedWindow {
	const { modelWidth, effortWidth, nWidth, failureWidths, groups } = layout;
	if ((effortWidth !== undefined) !== (summary.breakdown === "effort"))
		throw new Error(`renderWindow: a ${summary.breakdown} window needs a layout measured for it`);
	const failures = COLUMN_SETS[layout.columns].failures;
	/** The effort column, when present, as a prefix for every line's column list. */
	const effortColumn = <T>(cell: (width: number) => T): T[] => (effortWidth === undefined ? [] : [cell(effortWidth)]);

	const arrow = ` ${sortArrow(sort.descending)}`;
	const sorted = sortedMetric(sort.id);
	const groupSorted = (group: MetricGroup): boolean => sorted?.group.id === group.id;
	const labelSorted = (group: MetricGroup, label: keyof MetricStats): boolean => groupSorted(group) && sorted?.stat === label;
	const dim = (text: string): string => theme.fg("dim", text);
	const marked = (text: string): string => theme.bold(theme.fg("accent", text));
	const emphasize = (text: string, sorted: boolean): string => (sorted ? theme.bold(text) : text);
	const leftHeader = (label: string, width: number, sorted: boolean): string =>
		sorted ? marked(fit(`${label}${arrow}`, width)) : dim(fit(label, width));
	const rightHeader = (label: string, width: number, sorted: boolean): string =>
		sorted ? marked(fitRight(`${label}${arrow}`, width)) : dim(fitRight(label, width));
	const separator = gridSeparator(theme);

	const groupTitles = [
		" ".repeat(modelWidth),
		...effortColumn((width) => " ".repeat(width)),
		" ".repeat(nWidth),
		...failureWidths.map((width) => " ".repeat(width)),
		...groups.map((group) => leftHeader(group.title, blockWidth(group.widths), groupSorted(group))),
	].join(separator);
	const labels = [
		leftHeader(MODEL_HEADER, modelWidth, sort.id === "model"),
		...effortColumn((width) => dim(fit(EFFORT_HEADER, width))),
		rightHeader(N_HEADER, nWidth, sort.id === "n"),
		...failures.map((column, index) => rightHeader(column.header, failureWidths[index]!, sort.id === column.id)),
		...groups.map((group) =>
			group.labels
				.map((label, index) => {
					const text = fitRight(label, group.widths[index]!);
					return labelSorted(group, label) ? marked(text) : dim(text);
				})
				.join(GROUP_CELL_GAP),
		),
	].join(separator);
	const rule = gridRule(theme, blockWidths(layout), "┼");
	const rows = summary.models.map((model) =>
		[
			emphasize(fit(shortenModelLabel(model.key, modelWidth), modelWidth), sort.id === "model"),
			...effortColumn((width) => {
				const effort = effortOf(model);
				const cell = fit(effort, width);
				return effort === UNRECORDED_EFFORT ? dim(cell) : cell;
			}),
			// A zero stays quiet in the sorted column too.
			model.responses === 0 ? zeroCell(theme, nWidth) : emphasize(fitRight(formatCount(model.responses), nWidth), sort.id === "n"),
			...failures.map((column, index) =>
				emphasize(column.cell(theme, model, failureWidths[index]!), sort.id === column.id && column.text(model) !== ""),
			),
			...groups.map((group) =>
				metricCells(group.pick(model), group.format, group.widths, group.labels)
					.map((cell, index) => emphasize(cell, labelSorted(group, group.labels[index]!)))
					.join(GROUP_CELL_GAP),
			),
		].join(separator),
	);
	return { header: [groupTitles, labels, rule], rows };
}

const STATS_TITLE = "Model performance";
const EMPTY_PERIOD = "No requests in this period.";
const BREAKDOWN_HINTS: Readonly<Record<StatsBreakdown, KeyHint>> = {
	model: { key: "e", action: "split by effort" },
	effort: { key: "e", action: "merge efforts" },
};
const COLUMNS_HINTS: Readonly<Record<ColumnSet, KeyHint>> = {
	compact: { key: "a", action: "all columns" },
	full: { key: "a", action: "fewer columns" },
};

/** Both breakdowns of the same records, one summary per period. */
export type BreakdownSummaries = Readonly<Record<StatsBreakdown, readonly WindowSummary[]>>;

/** What the user has set in the view; the screen is a function of this, the summaries and the width. */
export interface StatsViewState {
	/** Index of the period tab. */
	period: number;
	breakdown: StatsBreakdown;
	/** The column set once the user has toggled it; until then it follows the width. */
	columnChoice: ColumnSet | undefined;
	sort: SortOrder;
	scrollTop: number;
	/** Content lines in the viewport. */
	budget: number;
}

export interface StatsScreen {
	lines: string[];
	/** Column spans of the period tabs on the first line, by period. */
	tabSpans: Span[];
	/** Scrollable content lines, and the offset clamped to them. */
	lineCount: number;
	scrollTop: number;
}

function plural(count: number, noun: string): string {
	return `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** Text that is not a table cell: cut with `…` only when the pane is narrower than the sentence. */
function sentence(text: string, width: number): string {
	return fit(text, width).trimEnd();
}

/** Distinct models and requests (responses plus failures); nothing for an empty period. */
function windowFacts(summary: WindowSummary): string[] {
	if (summary.models.length === 0) return [];
	const models = new Set(summary.models.map((model) => model.key)).size;
	const requests = summary.models.reduce((total, model) => total + model.responses + failureTotal(model), 0);
	return [plural(models, "model"), plural(requests, "request")];
}

function sortFact(sort: SortOrder, columns: ColumnSet): string {
	const key = sortKeys(columns).find((candidate) => candidate.id === sort.id);
	if (key === undefined) throw new Error(`model-stats: sort key ${sort.id} is not a ${columns} column`);
	return `sort ${key.label} ${sortArrow(sort.descending)}`;
}

/**
 * The title rule with the period tabs and, on the right, `facts`. The tabs
 * say which table this is, so they outlast the facts: while a tab would be
 * cut, the leftmost fact is dropped.
 */
function titleRule(theme: UiTheme, width: number, labels: readonly string[], active: number, facts: readonly string[]): RenderedTitle {
	for (let dropped = 0; ; dropped += 1) {
		const kept = facts.slice(dropped);
		const right = kept.length > 0 ? theme.fg("dim", kept.join(" · ")) : undefined;
		const title = frameTitle(theme, width, { title: STATS_TITLE, tabs: { labels, active }, right }, "none");
		if (title.tabSpans.length === labels.length || kept.length === 0) return title;
	}
}

/** The scrollable content for one period: its table, or one sentence when there is none to show. */
function windowContent(theme: UiTheme, width: number, summary: WindowSummary, columns: ColumnSet, sort: SortOrder): string[] {
	if (summary.models.length === 0) return [theme.fg("muted", sentence(EMPTY_PERIOD, width))];
	const fitted = layoutWindow(summary, columns, width);
	if (fitted.kind === "too-narrow")
		return [theme.fg("muted", sentence(`Too narrow: the table needs ${fitted.needs} columns.`, width))];
	const sorted = { ...summary, models: sortModels(summary.models, sort.id, sort.descending) };
	const table = renderWindow(sorted, theme, sort, fitted.layout);
	const { hidden } = fitted.layout;
	return [
		...table.header,
		...table.rows.map((row, index) => zebra(theme, row, index, width)),
		...(hidden.length > 0 ? [theme.fg("dim", sentence(`hidden at this width: ${hidden.join(", ")}`, width))] : []),
	];
}

/**
 * The whole /perf view: the title rule with the period tabs, the selected
 * period's content scrolled to the view's offset, a rule and the key hints.
 * The title's right side names the period's models and requests, the sort
 * shown, and the scroll position when the content exceeds the viewport.
 */
export function renderStatsScreen(theme: UiTheme, width: number, summaries: BreakdownSummaries, view: StatsViewState): StatsScreen {
	const periods = summaries[view.breakdown];
	const summary = periods[view.period];
	if (summary === undefined) throw new Error(`model-stats: no period ${view.period}`);
	const columns = shownColumns(view.columnChoice, periods, width);
	const sort = shownSort(view.sort, columns);
	const content = windowContent(theme, width, summary, columns, sort);
	const lineCount = content.length;
	const scrollTop = clampStatsScrollTop(view.scrollTop, lineCount, view.budget);
	const { start, end } = statsVisibleRange(lineCount, scrollTop, view.budget);
	const facts = [
		...windowFacts(summary),
		sortFact(sort, columns),
		...(lineCount > view.budget ? [scrollPosition(lineCount, start, end)] : []),
	];
	const title = titleRule(
		theme,
		width,
		periods.map((period) => period.label),
		view.period,
		facts,
	);
	const hints: readonly KeyHint[] = [
		{ key: KEY.tab, action: "period" },
		{ key: "s", action: "sort" },
		{ key: "r", action: "reverse" },
		BREAKDOWN_HINTS[view.breakdown],
		COLUMNS_HINTS[columns],
		HINT.scroll,
		HINT.page,
		{ key: "+ −", action: "height" },
		HINT.close,
	];
	return {
		lines: [title.line, ...content.slice(start, end), frameRule(theme, width), ...keyHints(theme, width, hints).lines],
		tabSpans: title.tabSpans,
		lineCount,
		scrollTop,
	};
}
