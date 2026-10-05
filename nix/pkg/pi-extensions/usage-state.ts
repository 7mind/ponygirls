/** Pure /usage table logic. No Pi imports, so the tests can run under node. */

import type {
	BaseStats,
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
