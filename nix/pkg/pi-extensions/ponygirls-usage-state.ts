/** Pure /usage pane logic. No Pi runtime imports, so the tests can run under node; styling goes through the kit's UiTheme. */

import {
	GRID_SEPARATOR,
	HINT,
	KEY,
	fit,
	fitRight,
	formatCompact,
	formatCount,
	frameRule,
	frameTitle,
	gridRule,
	gridSeparator,
	keyHints,
	type KeyHint,
	type UiTheme,
} from "@ponygirls/pi-ui";
import { TAB_ORDER } from "./ponygirls-usage-data.ts";
import type {
	BaseStats,
	InputSize,
	TabName,
	TimeFilteredStats,
	TotalStats,
} from "./ponygirls-usage-data.ts";
import { clampScrollTop, scrollPosition, visibleRange } from "./scroll-state.ts";

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
	/** Model name, or null for the provider total. */
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
	return `$${formatCount(Math.round(cost))}`;
}

function formatTokens(count: number): string {
	if (count === 0) return "-";
	return formatCompact(count);
}

function formatNumber(n: number): string {
	if (n === 0) return "-";
	return formatCount(n);
}

/**
 * Numeric columns in display order. `minWidth` holds the usual values, so the
 * columns keep their widths from tab to tab; a longer value widens its column.
 */
const NUMERIC_COLUMNS = [
	{ label: "Sessions", minWidth: 8, value: (row: UsageTableRow) => formatNumber(row.sessions) },
	{ label: "Msgs", minWidth: 8, value: (row: UsageTableRow) => formatNumber(row.messages) },
	{ label: "Cost", minWidth: 8, value: (row: UsageTableRow) => formatCost(row.cost) },
	{ label: "Tokens", minWidth: 7, value: (row: UsageTableRow) => formatTokens(row.tokens) },
	{ label: "↑In", minWidth: 7, value: (row: UsageTableRow) => formatTokens(row.input) },
	{ label: "↓Out", minWidth: 7, value: (row: UsageTableRow) => formatTokens(row.output) },
	{ label: "Cache", minWidth: 7, value: (row: UsageTableRow) => formatTokens(row.cache) },
] as const;

type NumericColumn = (typeof NUMERIC_COLUMNS)[number];

/** Columns given up when the terminal is narrower than the table, first to last. Msgs and Cost always stay. */
const DROP_ORDER: readonly NumericColumn["label"][] = ["Cache", "↓Out", "↑In", "Sessions", "Tokens"];

const HIDDEN_PREFIX = "hidden at this width: ";

const LABEL_HEADER: Record<UsageTableMode, string> = { models: "Provider / model", aggregates: "Provider" };
const MODEL_INDENT = "  ";
/** The first column is never narrower, however narrow the terminal. */
const MIN_LABEL_WIDTH = 12;
const ELLIPSIS = "…";

function padLeft(text: string, width: number): string {
	return text.length >= width ? text : `${" ".repeat(width - text.length)}${text}`;
}

function padRight(text: string, width: number): string {
	return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/**
 * Columns of text whose characters are all one column wide (provider and model
 * ids, digits, the table glyphs). The kit does not export pi-tui's
 * visibleWidth, and pi-tui is not resolvable from the tests.
 */
function cellWidth(text: string): number {
	return [...text].length;
}

/** Keep both ends of a label wider than `width`: `ai-gateway-…-fable-5-2`. */
function shortenMiddle(text: string, width: number): string {
	const chars = [...text];
	if (chars.length <= width) return text;
	const kept = width - ELLIPSIS.length;
	const head = Math.ceil(kept / 2);
	return `${chars.slice(0, head).join("")}${ELLIPSIS}${chars.slice(chars.length - (kept - head)).join("")}`;
}

/** First-column text: the provider, or its model indented under it. */
function rowLabel(row: UsageTableRow): string {
	return row.model === null ? row.provider : `${MODEL_INDENT}${row.model}`;
}

interface UsageTableLayout {
	labelWidth: number;
	/** Shown numeric columns in display order, with their widths. */
	columns: { column: NumericColumn; width: number }[];
	/** Labels of the dropped columns, in the order they were dropped. */
	hidden: string[];
}

/**
 * Fit the table to `width`. The first column takes its longest label and every
 * numeric column its longest value; numeric columns are then dropped whole, in
 * DROP_ORDER, until the rest fits. Only when Msgs and Cost alone are still too
 * wide does the first column shrink, down to MIN_LABEL_WIDTH.
 */
function layoutUsageTable(labels: readonly string[], rows: readonly UsageTableRow[], width: number): UsageTableLayout {
	const longestLabel = Math.max(MIN_LABEL_WIDTH, ...labels.map(cellWidth));
	let columns = NUMERIC_COLUMNS.map((column) => ({
		column,
		width: Math.max(column.minWidth, ...rows.map((row) => cellWidth(column.value(row)))),
	}));
	const numericWidth = (): number => columns.reduce((sum, placed) => sum + GRID_SEPARATOR.length + placed.width, 0);
	const hidden: string[] = [];
	for (const label of DROP_ORDER) {
		if (longestLabel + numericWidth() <= width) break;
		columns = columns.filter((placed) => placed.column.label !== label);
		hidden.push(label);
	}
	return { labelWidth: Math.max(MIN_LABEL_WIDTH, Math.min(longestLabel, width - numericWidth())), columns, hidden };
}

/** Plain header cells, dim as one line: separators and labels share the colour. */
function gridHeader(theme: UiTheme, cells: readonly string[]): string {
	return theme.fg("dim", cells.join(GRID_SEPARATOR));
}

/** Data cells joined by dim `│`; `bold` styles each cell, so the separators stay dim. */
function gridRow(theme: UiTheme, cells: readonly string[], bold: boolean): string {
	return cells.map((cell) => (bold ? theme.bold(cell) : cell)).join(gridSeparator(theme));
}

export interface RenderedUsageTable {
	/** The dim column header and its `─┼─` rule. */
	header: string[];
	rows: string[];
	/** The `─┴─` rule and the bold totals row. */
	totals: string[];
	/** One dim line naming the columns dropped at this width; empty when all are shown. */
	hidden: string[];
}

/**
 * One period's table: dim header and `─┼─` rule, one line per row (provider
 * totals bold, their models indented under them), then a `─┴─` rule and the
 * bold totals row. Every `│` is dim. The table is at most `width` columns
 * wide: a column is shown whole or dropped and named in `hidden` (see
 * layoutUsageTable). Only a `width` below MIN_LABEL_WIDTH plus Msgs and Cost
 * is exceeded; the caller clips. Without rows the table is a note line and
 * the caller skips totals.
 */
export function renderUsageTable(
	rows: readonly UsageTableRow[],
	totals: UsageTableRow,
	theme: UiTheme,
	opts: { width: number; mode: UsageTableMode },
): RenderedUsageTable {
	if (rows.length === 0) return { header: ["(no usage for this period)"], rows: [], totals: [], hidden: [] };
	const labelHeader = LABEL_HEADER[opts.mode];
	const measured = [...rows, totals];
	const layout = layoutUsageTable([labelHeader, ...measured.map(rowLabel)], measured, opts.width);
	const cells = (label: string, numeric: readonly string[]): string[] => [
		fit(shortenMiddle(label, layout.labelWidth), layout.labelWidth),
		...numeric.map((text, index) => fitRight(text, layout.columns[index]!.width)),
	];
	const rowCells = (row: UsageTableRow): string[] => cells(rowLabel(row), layout.columns.map((placed) => placed.column.value(row)));
	const widths = [layout.labelWidth, ...layout.columns.map((placed) => placed.width)];
	return {
		header: [gridHeader(theme, cells(labelHeader, layout.columns.map((placed) => placed.column.label))), gridRule(theme, widths, "┼")],
		rows: rows.map((row) => gridRow(theme, rowCells(row), row.model === null)),
		totals: [gridRule(theme, widths, "┴"), gridRow(theme, rowCells(totals), true)],
		hidden: layout.hidden.length === 0 ? [] : [theme.fg("dim", `${HIDDEN_PREFIX}${layout.hidden.join(", ")}`)],
	};
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

/** Bucket edges double as the ctx-tax landmarks (100k/150k) from ponygirls-usage-data.ts. */
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

function messageTotal(total: number): string {
	return `${formatCount(total)} message${total === 1 ? "" : "s"}`;
}

/**
 * Count/share table: dim header and `─┼─` rule, one line per bucket with dim
 * `│`, plus the message total (unstyled; the caller styles totals). Without
 * messages the table is a note line, mirroring renderUsageTable.
 */
export function renderInputDistTable(bins: readonly InputDistBin[], theme: UiTheme): RenderedInputDist {
	const total = distTotal(bins);
	if (total === 0) return { header: ["(no usage for this period)"], rows: [], totals: [] };
	const labelWidth = Math.max("Range".length, ...bins.map((bin) => bin.label.length));
	const countWidth = Math.max("Msgs".length, ...bins.map((bin) => formatCount(bin.count).length));
	const shareWidth = Math.max("Share".length, ...bins.map((bin) => formatShare(bin.pct).length));
	const header = gridHeader(theme, [padRight("Range", labelWidth), padLeft("Msgs", countWidth), padLeft("Share", shareWidth)]);
	const rows = bins.map((bin) =>
		gridRow(theme, [padRight(bin.label, labelWidth), padLeft(formatCount(bin.count), countWidth), padLeft(formatShare(bin.pct), shareWidth)], false),
	);
	return {
		header: [header, gridRule(theme, [labelWidth, countWidth, shareWidth], "┼")],
		rows,
		totals: [messageTotal(total)],
	};
}

/** Box-drawing bar would collide with the table separators; the chart uses full blocks. */
const DIST_BAR = "█";

/** Widest bar area: wider terminals leave the rest empty, so counts stay next to their bars. */
const MAX_DIST_BAR_WIDTH = 60;

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
 * Ascii bar chart: bars scale to `width`, up to MAX_DIST_BAR_WIDTH, so the
 * fullest bucket fills the bar area, with its count and share right after it;
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
	const countWidth = Math.max(...bins.map((bin) => formatCount(bin.count).length));
	const shareWidth = Math.max(...bins.map((bin) => formatShare(bin.pct).length));
	const maxBar = Math.max(1, Math.min(MAX_DIST_BAR_WIDTH, Math.floor(width) - labelWidth - countWidth - shareWidth - 3));
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
		return `${padRight(bin.label, labelWidth)} ${bar} ${padLeft(formatCount(bin.count), countWidth)} ${padLeft(formatShare(bin.pct), shareWidth)}`;
	});
	return { header: [], rows, totals: [messageTotal(total)] };
}

const USAGE_TITLE = "Usage";
/** The hint shows a typographic minus; the keys are `+`/`=` and `-`/`_`. */
const HEIGHT_HINT: KeyHint = { key: "+ −", action: "height" };
const PERIOD_HINT: KeyHint = { key: KEY.tab, action: "period" };

/** What the pane shows: the view owns it and changes it on key presses. */
export interface UsagePaneState {
	tab: TabName;
	/** Table density of the current tab. */
	mode: UsageTableMode;
	view: UsageView;
	distStyle: InputDistStyle;
	scrollTop: number;
	/** Content lines shown at once. */
	budget: number;
}

export interface RenderedUsagePane {
	lines: string[];
	/** Scrollable content lines, and the offset clamped to them. */
	lineCount: number;
	scrollTop: number;
}

/** Each toggle names the view its key switches to. */
function usageHints(pane: UsagePaneState): KeyHint[] {
	const toggles: KeyHint[] =
		pane.view === "table"
			? [
					{ key: "m", action: pane.mode === "models" ? "hide models" : "show models" },
					{ key: "v", action: "input sizes" },
				]
			: [
					{ key: "v", action: "usage table" },
					{ key: "c", action: pane.distStyle === "chart" ? "show table" : "show chart" },
				];
	return [PERIOD_HINT, ...toggles, HINT.scroll, HINT.page, HEIGHT_HINT, HINT.close];
}

interface PaneBody {
	/** Lines the viewport scrolls over. */
	content: string[];
	/** Lines kept under the viewport at every scroll position. */
	pinned: string[];
}

function tableBody(theme: UiTheme, width: number, stats: TimeFilteredStats, mode: UsageTableMode): PaneBody {
	const table = renderUsageTable(buildUsageRows(stats, mode), usageTotalsRow(stats.totals), theme, { width, mode });
	return { content: [...table.header, ...table.rows, ...table.totals], pinned: table.hidden };
}

/** Stacked-segment colors; empty segments stay empty (no stray escapes). */
function distPalette(theme: UiTheme): InputDistPalette {
	const paint = (color: "accent" | "success" | "warning", bar: string): string => (bar === "" ? "" : theme.fg(color, bar));
	return {
		input: (bar) => paint("accent", bar),
		cacheRead: (bar) => paint("success", bar),
		cacheWrite: (bar) => paint("warning", bar),
	};
}

function distLegend(theme: UiTheme): string {
	const palette = distPalette(theme);
	const swatch: Record<InputDistComponentKey, string> = {
		input: palette.input(DIST_BAR),
		cacheRead: palette.cacheRead(DIST_BAR),
		cacheWrite: palette.cacheWrite(DIST_BAR),
	};
	return INPUT_DIST_COMPONENTS.map((component) => `${swatch[component.key]} ${theme.fg("dim", component.label)}`).join("  ");
}

function distBody(theme: UiTheme, width: number, stats: TimeFilteredStats, style: InputDistStyle): PaneBody {
	const bins = buildInputDistribution(stats.inputSizes);
	const subtitle = theme.fg("dim", "Input size per assistant message (ctx tokens, all models)");
	if (style === "table") {
		const rendered = renderInputDistTable(bins, theme);
		const content: string[] = [subtitle, "", ...rendered.header, ...rendered.rows];
		if (rendered.totals.length > 0) content.push("", ...rendered.totals.map((line) => theme.bold(line)));
		return { content, pinned: [] };
	}
	const rendered = renderInputDistChart(bins, width, distPalette(theme));
	if (rendered.totals.length === 0) return { content: [subtitle, "", ...rendered.header], pinned: [] };
	const content: string[] = [subtitle, "", distLegend(theme), ...rendered.rows];
	content.push("", ...rendered.totals.map((line) => theme.bold(line)));
	return { content, pinned: [] };
}

/**
 * The whole pane for one period: title rule with the period tabs and the scroll
 * position, `budget` content lines from `scrollTop`, the hidden-columns note
 * (kept in view while the table scrolls), a rule and the key hints. Every line
 * is at most `width` columns.
 */
export function renderUsagePane(theme: UiTheme, width: number, stats: TimeFilteredStats, pane: UsagePaneState): RenderedUsagePane {
	const { content, pinned } =
		pane.view === "table" ? tableBody(theme, width, stats, pane.mode) : distBody(theme, width, stats, pane.distStyle);
	const scrollTop = clampScrollTop(pane.scrollTop, content.length, pane.budget);
	const { start, end } = visibleRange(content.length, scrollTop, pane.budget);
	const right = content.length > pane.budget ? theme.fg("dim", scrollPosition(content.length, start, end)) : undefined;
	const tabs = { labels: TAB_ORDER.map((name) => USAGE_TAB_LABELS[name]), active: TAB_ORDER.indexOf(pane.tab) };
	return {
		lines: [
			frameTitle(theme, width, { title: USAGE_TITLE, tabs, right }, "none").line,
			...[...content.slice(start, end), ...pinned].map((line) => fit(line, width)),
			frameRule(theme, width),
			...keyHints(theme, width, usageHints(pane)).lines,
		],
		lineCount: content.length,
		scrollTop,
	};
}
