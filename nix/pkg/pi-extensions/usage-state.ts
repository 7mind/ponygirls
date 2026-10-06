/** Pure /usage table logic. No Pi imports, so the tests can run under node. */

import type {
	BaseStats,
	InputSize,
	TabName,
	TimeFilteredStats,
	TotalStats,
} from "./usage-data.ts";

export const USAGE_TAB_LABELS: Record<TabName, string> = {
	today: "Today",
	thisWeek: "This Week",
	lastWeek: "Last Week",
	last30Days: "Last 30 Days",
	allTime: "All Time",
};

/** Table density: provider totals only, or totals plus their models. */
export type UsageTableMode = "aggregates" | "models";

/** Initial mode per tab: Today opens per-model, the rest open aggregated. */
export const USAGE_TAB_DEFAULT_MODE: Record<TabName, UsageTableMode> = {
	today: "models",
	thisWeek: "aggregates",
	lastWeek: "aggregates",
	last30Days: "aggregates",
	allTime: "aggregates",
};

export interface UsageTableRow {
	provider: string;
	/** Model name, or null for the provider total. Every row carries both columns so scrolled slices stay readable. */
	model: string | null;
	sessions: number;
	messages: number;
	cost: number;
	tokens: number;
	input: number;
	output: number;
	cache: number;
}

function toRow(provider: string, model: string | null, stats: BaseStats, sessions: number): UsageTableRow {
	// ↑In folds cacheWrite in (as of the upstream 0.2.0 formula); Tokens counts it too.
	const input = stats.tokens.input + stats.tokens.cacheWrite;
	return {
		provider,
		model,
		sessions,
		messages: stats.messages,
		cost: stats.cost,
		tokens: stats.tokens.total + stats.tokens.cacheWrite,
		input,
		output: stats.tokens.output,
		cache: stats.tokens.cacheRead + stats.tokens.cacheWrite,
	};
}

/**
 * Flat grouped rows: each provider total, then (in `models` mode) its models.
 * Providers sort by cost descending, models by cost descending within their
 * provider; ties break by name. No expand/collapse — every row is always
 * visible and scrollable.
 */
export function buildUsageRows(stats: TimeFilteredStats, mode: UsageTableMode): UsageTableRow[] {
	const providers = [...stats.providers.entries()].sort(
		(left, right) => right[1].cost - left[1].cost || left[0].localeCompare(right[0]),
	);
	const rows: UsageTableRow[] = [];
	for (const [name, provider] of providers) {
		rows.push(toRow(name, null, provider, provider.sessions.size));
		if (mode === "aggregates") continue;
		const models = [...provider.models.entries()].sort(
			(left, right) => right[1].cost - left[1].cost || left[0].localeCompare(right[0]),
		);
		for (const [model, modelStats] of models) {
			rows.push(toRow(name, model, modelStats, modelStats.sessions.size));
		}
	}
	return rows;
}

export function usageTotalsRow(totals: TotalStats): UsageTableRow {
	return toRow("Total", null, totals, totals.sessions);
}

function formatCost(cost: number): string {
	if (cost === 0) return "-";
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	if (cost < 1) return `$${cost.toFixed(2)}`;
	if (cost < 10) return `$${cost.toFixed(2)}`;
	if (cost < 100) return `$${cost.toFixed(1)}`;
	return `$${Math.round(cost)}`;
}

function formatTokens(count: number): string {
	if (count === 0) return "-";
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatNumber(n: number): string {
	if (n === 0) return "-";
	return n.toLocaleString();
}

/** Fixed numeric widths, as in the upstream table. */
const NUMERIC_COLUMNS = [
	{ label: "Sessions", width: 9, value: (row: UsageTableRow) => formatNumber(row.sessions) },
	{ label: "Msgs", width: 9, value: (row: UsageTableRow) => formatNumber(row.messages) },
	{ label: "Cost", width: 9, value: (row: UsageTableRow) => formatCost(row.cost) },
	{ label: "Tokens", width: 9, value: (row: UsageTableRow) => formatTokens(row.tokens) },
	{ label: "↑In", width: 8, value: (row: UsageTableRow) => formatTokens(row.input) },
	{ label: "↓Out", width: 8, value: (row: UsageTableRow) => formatTokens(row.output) },
	{ label: "Cache", width: 8, value: (row: UsageTableRow) => formatTokens(row.cache) },
] as const;

const MAX_PROVIDER_WIDTH = 18;
const MAX_MODEL_WIDTH = 26;
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

/** Column widths measured across rows and totals, so the table never wobbles. */
export interface UsageTableLayout {
	providerWidth: number;
	modelWidth: number;
}

export function measureUsageTable(rows: readonly UsageTableRow[], totals: UsageTableRow): UsageTableLayout {
	const names = [...rows, totals];
	return {
		providerWidth: Math.min(
			MAX_PROVIDER_WIDTH,
			Math.max("Provider".length, ...names.map((row) => row.provider.length)),
		),
		modelWidth: Math.min(MAX_MODEL_WIDTH, Math.max("Model".length, ...names.map((row) => (row.model ?? "").length))),
	};
}

function joinCells(cells: readonly string[]): string {
	return cells.join(COLUMN_GAP);
}

function formatRow(row: UsageTableRow, layout: UsageTableLayout): string {
	return joinCells([
		padRight(ellipsize(row.provider, layout.providerWidth), layout.providerWidth),
		padRight(ellipsize(row.model ?? "", layout.modelWidth), layout.modelWidth),
		...NUMERIC_COLUMNS.map((column) => padLeft(column.value(row), column.width)),
	]);
}

export interface RenderedUsageTable {
	header: string[];
	rows: string[];
	totals: string[];
}

/**
 * One period's table: header, one line per row, and the totals block. Metric
 * columns keep fixed widths and the caller truncates overlong lines; without
 * rows the table is a note line and the caller skips totals.
 */
export function renderUsageTable(
	rows: readonly UsageTableRow[],
	totals: UsageTableRow,
	opts?: { layout?: UsageTableLayout },
): RenderedUsageTable {
	if (rows.length === 0) return { header: ["(no usage for this period)"], rows: [], totals: [] };
	const layout = opts?.layout ?? measureUsageTable(rows, totals);
	const header = joinCells([
		padRight("Provider", layout.providerWidth),
		padRight("Model", layout.modelWidth),
		...NUMERIC_COLUMNS.map((column) => padLeft(column.label, column.width)),
	]);
	return { header: [header], rows: rows.map((row) => formatRow(row, layout)), totals: [formatRow(totals, layout)] };
}

/** Top-level /usage view: the cost table, or the input-size distribution. */
export type UsageView = "table" | "dist";

/** Distribution rendering: ascii bar chart, or a plain count/share table. */
export type InputDistStyle = "chart" | "table";

/** One histogram bucket: [min, max) ctx tokens; the last bucket is unbounded. */
export interface InputDistBucketDef {
	label: string;
	min: number;
	max: number;
}

/** Bucket edges double as the ctx-tax landmarks (100k/150k) from usage-data.ts. */
export const INPUT_DIST_BUCKETS: readonly InputDistBucketDef[] = [
	{ label: "<10k", min: 0, max: 10_000 },
	{ label: "10-25k", min: 10_000, max: 25_000 },
	{ label: "25-50k", min: 25_000, max: 50_000 },
	{ label: "50-100k", min: 50_000, max: 100_000 },
	{ label: "100-150k", min: 100_000, max: 150_000 },
	{ label: "150-200k", min: 150_000, max: 200_000 },
	{ label: "200-500k", min: 200_000, max: 500_000 },
	{ label: ">=500k", min: 500_000, max: Number.POSITIVE_INFINITY },
];

export interface InputDistBin {
	label: string;
	count: number;
	/** Share of all messages in percent (0 when there are none). */
	pct: number;
	/** Token sums per component across the bucket's messages; the chart stacks them. */
	input: number;
	cacheRead: number;
	cacheWrite: number;
}

/**
 * Histogram of per-message input sizes, globally across providers/models.
 * Messages bucket by the component sum; each bucket also totals the three
 * components for the stacked chart. Sums below zero cannot occur; they fall
 * in the first bucket by construction.
 */
export function buildInputDistribution(sizes: readonly InputSize[]): InputDistBin[] {
	const bins = INPUT_DIST_BUCKETS.map(
		(bucket): InputDistBin => ({ label: bucket.label, count: 0, pct: 0, input: 0, cacheRead: 0, cacheWrite: 0 }),
	);
	for (const size of sizes) {
		const total = size.input + size.cacheRead + size.cacheWrite;
		const index = INPUT_DIST_BUCKETS.findIndex((bucket) => total < bucket.max);
		const bin = bins[index === -1 ? bins.length - 1 : index]!;
		bin.count += 1;
		bin.input += size.input;
		bin.cacheRead += size.cacheRead;
		bin.cacheWrite += size.cacheWrite;
	}
	for (const bin of bins) bin.pct = sizes.length === 0 ? 0 : (bin.count / sizes.length) * 100;
	return bins;
}

function formatShare(pct: number): string {
	if (pct === 0) return "-";
	return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

export interface RenderedInputDist {
	header: string[];
	rows: string[];
	totals: string[];
}

function distTotal(bins: readonly InputDistBin[]): number {
	return bins.reduce((total, bin) => total + bin.count, 0);
}

/**
 * Plain count/share table: one line per bucket plus the message total.
 * Without messages the table is a note line, mirroring renderUsageTable.
 */
export function renderInputDistTable(bins: readonly InputDistBin[]): RenderedInputDist {
	const total = distTotal(bins);
	if (total === 0) return { header: ["(no usage for this period)"], rows: [], totals: [] };
	const labelWidth = Math.max("Range".length, ...bins.map((bin) => bin.label.length));
	const countWidth = Math.max("Msgs".length, ...bins.map((bin) => String(bin.count).length));
	const shareWidth = Math.max("Share".length, ...bins.map((bin) => formatShare(bin.pct).length));
	const header = joinCells([
		padRight("Range", labelWidth),
		padLeft("Msgs", countWidth),
		padLeft("Share", shareWidth),
	]);
	const rows = bins.map((bin) =>
		joinCells([padRight(bin.label, labelWidth), padLeft(String(bin.count), countWidth), padLeft(formatShare(bin.pct), shareWidth)]),
	);
	return { header: [header], rows, totals: [`${total} message${total === 1 ? "" : "s"}`] };
}

/** Box-drawing bar would collide with the table separators; the chart uses full blocks. */
const DIST_BAR = "█";

/** Bar-segment order in every stacked bar; the legend follows the same order. */
export const INPUT_DIST_COMPONENTS = [
	{ key: "input", label: "input" },
	{ key: "cacheRead", label: "cacheRead" },
	{ key: "cacheWrite", label: "cacheWrite" },
] as const;

export type InputDistComponentKey = (typeof INPUT_DIST_COMPONENTS)[number]["key"];

/**
 * Segment stylers, applied per component. The pure chart code treats them as
 * opaque wrappers that preserve visible width (e.g. theme colors); padding
 * is appended unstyled afterwards, so alignment never depends on their output.
 */
export interface InputDistPalette {
	input: (bar: string) => string;
	cacheRead: (bar: string) => string;
	cacheWrite: (bar: string) => string;
}

const IDENTITY_PALETTE: InputDistPalette = {
	input: (bar) => bar,
	cacheRead: (bar) => bar,
	cacheWrite: (bar) => bar,
};

/** Split `blocks` over `parts` by largest remainder, so the segments sum exactly. */
function splitBlocks(blocks: number, parts: readonly number[]): number[] {
	const total = parts.reduce((sum, part) => sum + part, 0);
	if (blocks <= 0 || total <= 0) return parts.map(() => 0);
	const quotas = parts.map((part) => (blocks * part) / total);
	const base = quotas.map(Math.floor);
	let rest = blocks - base.reduce((sum, length) => sum + length, 0);
	const order = quotas
		.map((quota, index) => index)
		.sort((left, right) => quotas[right]! - quotas[left]! || left - right);
	for (const index of order) {
		if (rest <= 0) break;
		base[index]! += 1;
		rest -= 1;
	}
	return base;
}

/**
 * Ascii bar chart: bars scale to `width` so the fullest bucket fills it, and
 * each bar stacks its input/cacheRead/cacheWrite token shares (see `palette`).
 * Non-empty buckets always show at least one block. Lines never exceed `width`
 * in visible columns. A bucket with messages but zero tokens (degenerate —
 * every component is 0) renders its bar in the input style.
 */
export function renderInputDistChart(
	bins: readonly InputDistBin[],
	width: number,
	palette: InputDistPalette = IDENTITY_PALETTE,
): RenderedInputDist {
	const total = distTotal(bins);
	if (total === 0) return { header: ["(no usage for this period)"], rows: [], totals: [] };
	const labelWidth = Math.max(...bins.map((bin) => bin.label.length));
	const countWidth = Math.max(...bins.map((bin) => String(bin.count).length));
	const shareWidth = Math.max(...bins.map((bin) => formatShare(bin.pct).length));
	const maxBar = Math.max(1, Math.floor(width) - labelWidth - countWidth - shareWidth - 3);
	const peak = Math.max(...bins.map((bin) => bin.count));
	const rows = bins.map((bin) => {
		const barLen = bin.count === 0 ? 0 : Math.max(1, Math.round((bin.count / peak) * maxBar));
		const parts: readonly (readonly [InputDistComponentKey, number])[] = [
			["input", bin.input],
			["cacheRead", bin.cacheRead],
			["cacheWrite", bin.cacheWrite],
		];
		const tokens = parts.reduce((sum, [, part]) => sum + part, 0);
		// Degenerate buckets keep the count-proportional bar in the input style.
		const segments = tokens === 0 ? [barLen, 0, 0] : splitBlocks(barLen, parts.map(([, part]) => part));
		const bar =
			palette.input(DIST_BAR.repeat(segments[0]!)) +
			palette.cacheRead(DIST_BAR.repeat(segments[1]!)) +
			palette.cacheWrite(DIST_BAR.repeat(segments[2]!)) +
			" ".repeat(maxBar - barLen);
		return `${padRight(bin.label, labelWidth)} ${bar} ${padLeft(String(bin.count), countWidth)} ${padLeft(formatShare(bin.pct), shareWidth)}`;
	});
	return { header: [], rows, totals: [`${total} message${total === 1 ? "" : "s"}`] };
}
