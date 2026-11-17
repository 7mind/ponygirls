import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { PLAIN_THEME, type UiTheme } from "@ponygirls/pi-ui";

import {
	buildInputDistribution,
	buildUsageRows,
	INPUT_DIST_BUCKETS,
	renderInputDistChart,
	renderInputDistTable,
	renderUsagePane,
	renderUsageTable,
	usageTotalsRow,
	USAGE_TAB_DEFAULT_MODE,
	USAGE_TAB_LABELS,
	type UsagePaneState,
	type UsageTableMode,
	type UsageTableRow,
} from "./ponygirls-usage-state.ts";
import type { ModelStats, ProviderStats, TimeFilteredStats, TotalStats } from "./ponygirls-usage-data.ts";

/** Wraps styled text in `<token>…</token>` (bold as `<b>`); for checking which style a cell got, not widths. */
const TAG_THEME: UiTheme = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
	bg: (color, text) => `<${color}>${text}</${color}>`,
	bold: (text) => `<b>${text}</b>`,
};

/**
 * Columns of a plain-theme line: every glyph the pane uses is one column wide.
 * The kit's truncation closes its cut with SGR resets, which take no column.
 */
function visibleWidth(line: string): number {
	return [...line.replace(/\x1b\[[0-9;]*m/g, "")].length;
}

function timeFilteredStats(overrides: Partial<TimeFilteredStats> = {}): TimeFilteredStats {
	return {
		providers: new Map(),
		totals: { messages: 0, cost: 0, tokens: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, sessions: 0 },
		insights: { insights: [] },
		inputSizes: [],
		...overrides,
	};
}

function modelStats(cost: number, sessions: string[], messages = 1): ModelStats {
	return {
		messages,
		cost,
		tokens: { total: 1200, input: 1000, output: 200, cacheRead: 100, cacheWrite: 100 },
		sessions: new Set(sessions),
	};
}

function providerStats(
	models: Record<string, ModelStats>,
	extra: Partial<ProviderStats> = {},
): ProviderStats {
	const entries = Object.entries(models);
	return {
		messages: entries.reduce((total, [, model]) => total + model.messages, 0),
		cost: entries.reduce((total, [, model]) => total + model.cost, 0),
		tokens: { total: 2400, input: 2000, output: 400, cacheRead: 200, cacheWrite: 200 },
		sessions: new Set(entries.flatMap(([, model]) => [...model.sessions])),
		models: new Map(entries),
		...extra,
	};
}

const totals: TotalStats = {
	messages: 5,
	cost: 18,
	tokens: { total: 3600, input: 3000, output: 600, cacheRead: 300, cacheWrite: 300 },
	sessions: 3,
};

const stats: TimeFilteredStats = {
	providers: new Map([
		["b", providerStats({ m1: modelStats(5, ["s1"], 2), m2: modelStats(3, ["s1", "s2"], 2) })],
		["a", providerStats({ m0: modelStats(10, ["s3"]) })],
	]),
	totals,
	insights: { insights: [] },
	inputSizes: [
		{ input: 5000, cacheRead: 0, cacheWrite: 0 },
		{ input: 9000, cacheRead: 2000, cacheWrite: 1000 },
		{ input: 40000, cacheRead: 20000, cacheWrite: 0 },
		{ input: 60000, cacheRead: 60000, cacheWrite: 0 },
		{ input: 90000, cacheRead: 90000, cacheWrite: 0 },
		{ input: 100000, cacheRead: 150000, cacheWrite: 0 },
	],
};

test("USAGE_TAB_LABELS covers every period tab", () => {
	assert.deepEqual(Object.keys(USAGE_TAB_LABELS).sort(), ["allTime", "last30Days", "lastWeek", "thisWeek", "today"]);
});

test("USAGE_TAB_DEFAULT_MODE opens Today per-model, the rest aggregated", () => {
	assert.deepEqual(USAGE_TAB_DEFAULT_MODE, {
		today: "models",
		thisWeek: "aggregates",
		lastWeek: "aggregates",
		last30Days: "aggregates",
		allTime: "aggregates",
	});
});

test("buildUsageRows groups provider totals before their models, by cost", () => {
	const rows = buildUsageRows(stats, "models");
	assert.deepEqual(
		rows.map((row) => [row.provider, row.model]),
		[
			["a", null],
			["a", "m0"],
			["b", null],
			["b", "m1"],
			["b", "m2"],
		],
	);
	const [aTotal, aModel, bTotal, bFirst] = [rows[0]!, rows[1]!, rows[2]!, rows[3]!];
	assert.equal(aTotal.cost, 10);
	assert.equal(aTotal.sessions, 1);
	assert.equal(aModel.sessions, 1);
	assert.equal(bTotal.cost, 8);
	assert.equal(bTotal.sessions, 2);
	assert.equal(bFirst.cost, 5);
	// ↑In folds cacheWrite in; Tokens counts it too.
	assert.equal(aModel.input, 1100);
	assert.equal(aModel.tokens, 1300);
	assert.equal(aModel.cache, 200);
});

test("buildUsageRows aggregates mode lists provider totals only", () => {
	const rows = buildUsageRows(stats, "aggregates");
	assert.deepEqual(
		rows.map((row) => [row.provider, row.model]),
		[
			["a", null],
			["b", null],
		],
	);
});

test("usageTotalsRow labels the totals", () => {
	const row = usageTotalsRow(totals);
	assert.equal(row.provider, "Total");
	assert.equal(row.model, null);
	assert.equal(row.sessions, 3);
	assert.equal(row.cost, 18);
});

function barsAt(line: string): number[] {
	const indexes: number[] = [];
	for (let index = 0; index < line.length; index++) if (line[index] === "│") indexes.push(index);
	return indexes;
}

function junctionsAt(line: string, junction: "┼" | "┴"): number[] {
	const indexes: number[] = [];
	for (let index = 0; index < line.length; index++) if (line[index] === junction) indexes.push(index);
	return indexes;
}

test("renderUsageTable aligns columns, rules the header, and closes before totals", () => {
	const rows = buildUsageRows(stats, "models");
	const table = renderUsageTable(rows, usageTotalsRow(totals), PLAIN_THEME, { width: 120, mode: "models" });
	assert.equal(table.header.length, 2);
	assert.match(table.header[0]!, /^Provider \/ model +│ Sessions.+Msgs.+Cost.+Tokens/);
	assert.match(table.header[1]!, /^─+┼─/);
	assert.equal(table.rows.length, 5);
	// A ┴ rule, then the totals row directly (no blank line).
	assert.equal(table.totals.length, 2);
	assert.match(table.totals[0]!, /^─+┴─/);
	assert.match(table.totals[1]!, /^Total/);
	const bars = barsAt(table.header[0]!);
	assert.equal(bars.length, 7);
	for (const line of [...table.rows, table.totals[1]!]) assert.deepEqual(barsAt(line), bars);
	assert.deepEqual(junctionsAt(table.header[1]!, "┼"), bars);
	assert.deepEqual(junctionsAt(table.totals[0]!, "┴"), bars);
	const width = visibleWidth(table.header[0]!);
	for (const line of [...table.header, ...table.rows, ...table.totals]) assert.equal(visibleWidth(line), width);
});

test("renderUsageTable styles: dim header and grid, bold provider totals and totals", () => {
	const rows = buildUsageRows(stats, "models");
	const table = renderUsageTable(rows, usageTotalsRow(totals), TAG_THEME, { width: 120, mode: "models" });
	assert.match(table.header[0]!, /^<dim>Provider.+Cache<\/dim>$/);
	assert.match(table.header[1]!, /^<dim>─+┼.+─<\/dim>$/);
	assert.match(table.totals[0]!, /^<dim>─+┴.+─<\/dim>$/);
	const [aggregate, model] = table.rows as [string, string];
	assert.match(aggregate, /^<b>a +<\/b><dim> │ <\/dim><b> +1<\/b><dim> │ <\/dim>/);
	assert.match(model, /^  m0 +<dim> │ <\/dim> +1<dim> │ <\/dim>/);
	assert.doesNotMatch(model, /<b>|<accent>/);
	assert.match(table.totals[1]!, /^<b>Total +<\/b><dim> │ <\/dim>/);
	for (const line of [...table.rows, table.totals[1]!]) {
		assert.doesNotMatch(line.replaceAll("<dim> │ </dim>", ""), /│/, "every │ is dim");
		assert.doesNotMatch(line, /<accent>/);
	}
});

test("renderUsageTable reports an empty period", () => {
	const empty = timeFilteredStats();
	const table = renderUsageTable([], usageTotalsRow(empty.totals), PLAIN_THEME, { width: 60, mode: "models" });
	assert.deepEqual(table, { header: ["(no usage for this period)"], rows: [], totals: [], hidden: [] });
});

const M = 1_000_000;

/** Stats whose table rows read `sessions`, `messages`, `cost`, `tokens`, `input`, `output`, `cache` (no cacheWrite). */
function usage(messages: number, cost: number, tokens: number, input: number, output: number, cache: number) {
	return { messages, cost, tokens: { total: tokens, input, output, cacheRead: cache, cacheWrite: 0 } };
}

function sessionSet(count: number): Set<string> {
	return new Set(Array.from({ length: count }, (_unused, index) => `s${index}`));
}

function modelEntry(name: string, sessions: number, stats: ReturnType<typeof usage>): [string, ModelStats] {
	return [name, { ...stats, sessions: sessionSet(sessions) }];
}

function providerEntry(name: string, sessions: number, stats: ReturnType<typeof usage>, models: [string, ModelStats][]): [string, ProviderStats] {
	return [name, { ...stats, sessions: sessionSet(sessions), models: new Map(models) }];
}

/**
 * The reported 120-column capture (All Time). The longest label, an indented
 * 25-character model id, makes the first column 27 cells and the table 100.
 */
const captureStats: TimeFilteredStats = timeFilteredStats({
	providers: new Map([
		providerEntry("openai-codex", 199, usage(115_173, 40_609, 1236 * M, 1120 * M, 115 * M, 37_516 * M), [
			modelEntry("gpt-6-astra", 21, usage(34_161, 32_491, 436 * M, 402 * M, 34 * M, 12_400 * M)),
			modelEntry("gpt-6.1-sol", 184, usage(80_896, 8112, 799 * M, 718 * M, 81 * M, 25_100 * M)),
		]),
		providerEntry("anthropic", 26, usage(19_790, 7552, 1546 * M, 764 * M, 18 * M, 10_200 * M), [
			modelEntry("claude-opus-5-5", 20, usage(14_292, 4140, 1060 * M, 525 * M, 11 * M, 6980 * M)),
			modelEntry("claude-haiku-5-0-20260514", 9, usage(5498, 3412, 486 * M, 239 * M, 7 * M, 3220 * M)),
		]),
		providerEntry("ai-gateway-anthropic", 6, usage(7182, 4881, 759 * M, 375 * M, 8_700_000, 4280 * M), [
			modelEntry("claude-fable-5-2", 6, usage(7182, 4881, 759 * M, 375 * M, 8_700_000, 4280 * M)),
		]),
		providerEntry("Tools", 0, usage(12, 3.17, 640_000, 598_000, 42_000, 0), [
			modelEntry("summaries", 0, usage(12, 3.17, 640_000, 598_000, 42_000, 0)),
		]),
	]),
	totals: { ...usage(142_157, 53_045.17, 3_541_640_000, 2_259_598_000, 141_742_000, 51_996 * M), sessions: 231 },
});

/** The target screen of the specification: per-model mode at 120 columns. */
const CAPTURE_TABLE_120 = [
	"Provider / model            │ Sessions │     Msgs │     Cost │  Tokens │     ↑In │    ↓Out │   Cache",
	"────────────────────────────┼──────────┼──────────┼──────────┼─────────┼─────────┼─────────┼────────",
	"openai-codex                │      199 │  115,173 │  $40,609 │   1.24B │   1.12B │    115M │   37.5B",
	"  gpt-6-astra               │       21 │   34,161 │  $32,491 │    436M │    402M │     34M │   12.4B",
	"  gpt-6.1-sol               │      184 │   80,896 │   $8,112 │    799M │    718M │     81M │   25.1B",
	"anthropic                   │       26 │   19,790 │   $7,552 │   1.55B │    764M │     18M │   10.2B",
	"  claude-opus-5-5           │       20 │   14,292 │   $4,140 │   1.06B │    525M │     11M │   6.98B",
	"  claude-haiku-5-0-20260514 │        9 │    5,498 │   $3,412 │    486M │    239M │      7M │   3.22B",
	"ai-gateway-anthropic        │        6 │    7,182 │   $4,881 │    759M │    375M │    8.7M │   4.28B",
	"  claude-fable-5-2          │        6 │    7,182 │   $4,881 │    759M │    375M │    8.7M │   4.28B",
	"Tools                       │        - │       12 │    $3.17 │    640k │    598k │     42k │       -",
	"  summaries                 │        - │       12 │    $3.17 │    640k │    598k │     42k │       -",
	"────────────────────────────┴──────────┴──────────┴──────────┴─────────┴─────────┴─────────┴────────",
	"Total                       │      231 │  142,157 │  $53,045 │   3.54B │   2.26B │    142M │     52B",
];

const NUMERIC_LABELS = ["Sessions", "Msgs", "Cost", "Tokens", "↑In", "↓Out", "Cache"];

function captureTable(width: number, mode: UsageTableMode) {
	return renderUsageTable(buildUsageRows(captureStats, mode), usageTotalsRow(captureStats.totals), PLAIN_THEME, { width, mode });
}

function tableLines(table: { header: string[]; rows: string[]; totals: string[] }): string[] {
	return [...table.header, ...table.rows, ...table.totals];
}

/** Trimmed cells of one plain table line. */
function cellsOf(line: string): string[] {
	return line.split(" │ ").map((cell) => cell.trim());
}

/** Width of the first column: everything before the first separator. */
function firstColumnWidth(line: string): number {
	return visibleWidth(line.slice(0, line.indexOf(" │ ")));
}

function usageRow(overrides: Partial<UsageTableRow>): UsageTableRow {
	return { provider: "p", model: null, sessions: 1, messages: 1, cost: 1, tokens: 1, input: 1, output: 1, cache: 1, ...overrides };
}

test("renderUsageTable renders the target screen at 120 columns", () => {
	const table = captureTable(120, "models");
	assert.deepEqual(tableLines(table), CAPTURE_TABLE_120);
	assert.deepEqual(table.hidden, []);
});

test("renderUsageTable has one first column: `Provider / model` with models, `Provider` without", () => {
	assert.deepEqual(cellsOf(captureTable(120, "models").header[0]!), ["Provider / model", ...NUMERIC_LABELS]);
	const aggregates = captureTable(120, "aggregates");
	assert.deepEqual(cellsOf(aggregates.header[0]!), ["Provider", ...NUMERIC_LABELS]);
	assert.deepEqual(
		aggregates.rows.map((line) => cellsOf(line)[0]),
		["openai-codex", "anthropic", "ai-gateway-anthropic", "Tools"],
	);
});

test("renderUsageTable indents model rows two spaces under their provider", () => {
	const table = captureTable(120, "models");
	assert.deepEqual(
		table.rows.map((line) => line.slice(0, line.indexOf(" │ ")).trimEnd()),
		[
			"openai-codex",
			"  gpt-6-astra",
			"  gpt-6.1-sol",
			"anthropic",
			"  claude-opus-5-5",
			"  claude-haiku-5-0-20260514",
			"ai-gateway-anthropic",
			"  claude-fable-5-2",
			"Tools",
			"  summaries",
		],
	);
	assert.match(table.totals[1]!, /^Total +│/);
});

test("renderUsageTable sizes the first column to the longest label of the tab, at least 12 cells", () => {
	// Per-model: the indented 25-character model id. Provider-only: the 20-character provider.
	assert.equal(firstColumnWidth(captureTable(170, "models").header[0]!), 27);
	assert.equal(firstColumnWidth(captureTable(170, "aggregates").header[0]!), 20);
	// Short names: the header label, then the minimum.
	const short = (mode: UsageTableMode) => renderUsageTable(buildUsageRows(stats, mode), usageTotalsRow(totals), PLAIN_THEME, { width: 170, mode });
	assert.equal(firstColumnWidth(short("models").header[0]!), "Provider / model".length);
	assert.equal(firstColumnWidth(short("aggregates").header[0]!), 12);
	for (const table of [short("models"), short("aggregates")]) {
		for (const line of [...table.rows, table.totals[1]!]) assert.equal(firstColumnWidth(line), firstColumnWidth(table.header[0]!));
	}
});

test("renderUsageTable fits every column in 100 columns with 20-character provider names", () => {
	const wide = timeFilteredStats({
		providers: new Map([
			providerEntry("ai-gateway-anthropic", 6, usage(7182, 4881, 759 * M, 375 * M, 8_700_000, 4280 * M), [
				modelEntry("claude-fable-5-2", 6, usage(7182, 4881, 759 * M, 375 * M, 8_700_000, 4280 * M)),
			]),
			providerEntry("twenty-characters-ab", 199, usage(115_173, 40_609, 1236 * M, 1120 * M, 115 * M, 37_516 * M), [
				modelEntry("gpt-6-astra", 21, usage(34_161, 32_491, 436 * M, 402 * M, 34 * M, 12_400 * M)),
			]),
		]),
		totals: { ...usage(122_355, 45_490, 1995 * M, 1495 * M, 123_700_000, 41_796 * M), sessions: 205 },
	});
	for (const mode of ["models", "aggregates"] as const) {
		const table = renderUsageTable(buildUsageRows(wide, mode), usageTotalsRow(wide.totals), PLAIN_THEME, { width: 100, mode });
		assert.deepEqual(cellsOf(table.header[0]!).slice(1), NUMERIC_LABELS, mode);
		assert.deepEqual(table.hidden, [], mode);
		for (const line of tableLines(table)) {
			assert.ok(visibleWidth(line) <= 100, `${mode}: ${visibleWidth(line)} cells: ${line}`);
			assert.doesNotMatch(line, /…|\.\.\./, mode);
		}
		assert.ok(table.rows.some((line) => line.startsWith("ai-gateway-anthropic ")), mode);
		assert.ok(table.rows.some((line) => line.startsWith("twenty-characters-ab ")), mode);
	}
});

test("renderUsageTable drops whole columns in the order Cache, ↓Out, ↑In, Sessions, Tokens and names them", () => {
	// Per-model capture: first column 27, so the whole table is 100 cells and each drop frees 10 or 11.
	const expected: [number, string[]][] = [
		[100, []],
		[99, ["Cache"]],
		[90, ["Cache"]],
		[89, ["Cache", "↓Out"]],
		[80, ["Cache", "↓Out"]],
		[79, ["Cache", "↓Out", "↑In"]],
		[70, ["Cache", "↓Out", "↑In"]],
		[69, ["Cache", "↓Out", "↑In", "Sessions"]],
		[59, ["Cache", "↓Out", "↑In", "Sessions"]],
		[58, ["Cache", "↓Out", "↑In", "Sessions", "Tokens"]],
		[49, ["Cache", "↓Out", "↑In", "Sessions", "Tokens"]],
	];
	for (const [width, dropped] of expected) {
		const table = captureTable(width, "models");
		const shown = NUMERIC_LABELS.filter((label) => !dropped.includes(label));
		assert.deepEqual(cellsOf(table.header[0]!), ["Provider / model", ...shown], `header at ${width}`);
		assert.deepEqual(table.hidden, dropped.length === 0 ? [] : [`hidden at this width: ${dropped.join(", ")}`], `note at ${width}`);
		const lines = tableLines(table);
		for (const line of lines) {
			assert.equal(visibleWidth(line), visibleWidth(lines[0]!), `aligned at ${width}`);
			assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} cells at ${width}: ${line}`);
			assert.doesNotMatch(line, /…|\.\.\./, `whole cells at ${width}`);
		}
		for (const line of [...table.rows, table.totals[1]!]) assert.equal(cellsOf(line).length, shown.length + 1, `row cells at ${width}`);
		// The first column keeps its full width while there are columns to drop.
		assert.equal(firstColumnWidth(table.header[0]!), 27, `first column at ${width}`);
	}
});

test("renderUsageTable never drops Msgs and Cost; below that it shortens labels in the middle, keeping 12 cells", () => {
	// 27 + Msgs + Cost is 49 cells: one cell less shortens the longest label by one.
	const narrow = captureTable(48, "models");
	assert.deepEqual(cellsOf(narrow.header[0]!), ["Provider / model", "Msgs", "Cost"]);
	assert.equal(firstColumnWidth(narrow.header[0]!), 26);
	assert.deepEqual(
		narrow.rows.map((line) => cellsOf(line)[0]),
		["openai-codex", "gpt-6-astra", "gpt-6.1-sol", "anthropic", "claude-opus-5-5", "claude-haik…5-0-20260514", "ai-gateway-anthropic", "claude-fable-5-2", "Tools", "summaries"],
	);
	// 26 cells: the indent and 11 characters, the ellipsis, the last 12 characters.
	assert.ok(narrow.rows[5]!.startsWith("  claude-haik…5-0-20260514 │"));
	for (const line of tableLines(narrow)) assert.equal(visibleWidth(line), 48);

	// The specification's example: 22 cells keep both ends of a 37-character name.
	const long = [usageRow({ provider: "ai-gateway-anthropic-claude-fable-5-2" })];
	const example = renderUsageTable(long, usageRow({ provider: "Total" }), PLAIN_THEME, { width: 22 + 22, mode: "aggregates" });
	assert.deepEqual(cellsOf(example.rows[0]!), ["ai-gateway-…-fable-5-2", "1", "$1.00"]);
	for (const line of tableLines(example)) assert.equal(visibleWidth(line), 44);

	// 12 cells is the floor, also when the terminal is narrower than 12 + Msgs + Cost (34).
	for (const width of [34, 30, 10]) {
		const table = captureTable(width, "models");
		assert.equal(firstColumnWidth(table.header[0]!), 12, `first column at ${width}`);
		assert.deepEqual(cellsOf(table.header[0]!), ["Provid…model", "Msgs", "Cost"], `header at ${width}`);
		assert.deepEqual(cellsOf(table.rows[6]!), ["ai-gat…ropic", "7,182", "$4,881"], `row at ${width}`);
		assert.deepEqual(table.hidden, ["hidden at this width: Cache, ↓Out, ↑In, Sessions, Tokens"]);
		for (const line of tableLines(table)) assert.equal(visibleWidth(line), 34, `table width at ${width}`);
	}
});

test("renderUsageTable formats counts, compact tokens and cost", () => {
	const cells = (row: Partial<UsageTableRow>): string[] =>
		cellsOf(renderUsageTable([usageRow(row)], usageRow({ provider: "Total" }), PLAIN_THEME, { width: 170, mode: "aggregates" }).rows[0]!).slice(1);
	// Sessions and Msgs: thousands separators.
	assert.deepEqual(cells({ sessions: 1234, messages: 115_173 }).slice(0, 2), ["1,234", "115,173"]);
	// Token columns: three significant digits with k/M/B.
	assert.deepEqual(cells({ tokens: 999, input: 1234, output: 96_000, cache: 8_700_000 }).slice(3), ["999", "1.23k", "96k", "8.7M"]);
	assert.deepEqual(cells({ tokens: 1236 * M, input: 1120 * M, output: 115 * M, cache: 37_516 * M }).slice(3), ["1.24B", "1.12B", "115M", "37.5B"]);
	// Cost: the precision rules below $100 are unchanged; thousands separators from $1,000.
	const cost = (value: number): string => cells({ cost: value })[2]!;
	assert.deepEqual(
		[0.0042, 0.42, 5.84, 61.3, 812.4, 8112, 40_609.3, 1_234_567.8].map(cost),
		["$0.0042", "$0.42", "$5.84", "$61.3", "$812", "$8,112", "$40,609", "$1,234,568"],
	);
	// Zero keeps its dash in every column.
	assert.deepEqual(cells({ sessions: 0, messages: 0, cost: 0, tokens: 0, input: 0, output: 0, cache: 0 }), ["-", "-", "-", "-", "-", "-", "-"]);
});

test("the number formats do not follow the process locale", () => {
	// German groups thousands with dots; a child process is the only way to start node in another locale.
	const script = `
		import { PLAIN_THEME } from "@ponygirls/pi-ui";
		import { buildInputDistribution, renderInputDistChart, renderUsageTable } from "./ponygirls-usage-state.ts";
		const row = { provider: "p", model: null, sessions: 1234, messages: 115173, cost: 40609.3, tokens: 1, input: 1, output: 1, cache: 1 };
		const table = renderUsageTable([row], row, PLAIN_THEME, { width: 170, mode: "aggregates" });
		const sizes = Array.from({ length: 1234 }, () => ({ input: 5000, cacheRead: 0, cacheWrite: 0 }));
		const chart = renderInputDistChart(buildInputDistribution(sizes), 120);
		console.log(JSON.stringify({ native: (115173).toLocaleString(), row: table.rows[0], bar: chart.rows[0], total: chart.totals[0] }));
	`;
	const output = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
		cwd: import.meta.dirname,
		env: { ...process.env, LC_ALL: "de_DE.UTF-8" },
		encoding: "utf8",
	});
	const rendered = JSON.parse(output) as { native: string; row: string; bar: string; total: string };
	assert.equal(rendered.native, "115.173", "the child process formats in German by default");
	assert.deepEqual(cellsOf(rendered.row).slice(0, 4), ["p", "1,234", "115,173", "$40,609"]);
	assert.match(rendered.bar, / 1,234 100%$/);
	assert.equal(rendered.total, "1,234 messages");
});

test("renderUsageTable widens a numeric column for a long value instead of clipping it", () => {
	const rows = [usageRow({ provider: "big", messages: 12_345_678, cost: 1_234_567.8, cache: 1.23e17 }), usageRow({ provider: "small" })];
	const table = renderUsageTable(rows, usageRow({ provider: "Total" }), PLAIN_THEME, { width: 170, mode: "aggregates" });
	assert.deepEqual(cellsOf(table.rows[0]!), ["big", "1", "12,345,678", "$1,234,568", "1", "1", "1", "123000000B"]);
	for (const line of tableLines(table)) {
		assert.equal(visibleWidth(line), visibleWidth(table.header[0]!));
		assert.doesNotMatch(line, /…|\.\.\./);
	}
	for (const line of [...table.rows, table.totals[1]!]) assert.deepEqual(barsAt(line), barsAt(table.header[0]!));
});

test("renderUsageTable styles the note dim and keeps model rows plain under bold providers", () => {
	const mode = "models";
	const table = renderUsageTable(buildUsageRows(captureStats, mode), usageTotalsRow(captureStats.totals), TAG_THEME, { width: 80, mode });
	assert.deepEqual(table.hidden, ["<dim>hidden at this width: Cache, ↓Out</dim>"]);
	assert.match(table.rows[0]!, /^<b>openai-codex +<\/b><dim> │ <\/dim><b> +199<\/b>/);
	assert.match(table.rows[1]!, /^  gpt-6-astra +<dim> │ <\/dim> +21<dim> │ <\/dim>/);
	assert.doesNotMatch(table.rows[1]!, /<b>/);
});

const WIDTHS = [60, 80, 100, 120, 170];

function paneState(overrides: Partial<UsagePaneState>): UsagePaneState {
	return { tab: "allTime", mode: "models", view: "table", distStyle: "chart", scrollTop: 0, budget: 40, ...overrides };
}

/** The capture with a few input sizes, so the distribution view has content. */
const paneStats: TimeFilteredStats = { ...captureStats, inputSizes: stats.inputSizes };

const PANE_VIEWS: [string, Partial<UsagePaneState>][] = [
	["table with models", { view: "table", mode: "models" }],
	["table without models", { view: "table", mode: "aggregates" }],
	["distribution chart", { view: "dist", distStyle: "chart" }],
	["distribution table", { view: "dist", distStyle: "table" }],
];

test("renderUsagePane keeps every line within 60, 80, 100, 120 and 170 columns without clipping a cell", () => {
	for (const width of WIDTHS) {
		for (const [name, view] of PANE_VIEWS) {
			for (const [period, periodStats] of [["usage", paneStats], ["empty", timeFilteredStats()]] as const) {
				const pane = renderUsagePane(PLAIN_THEME, width, periodStats, paneState(view));
				for (const line of pane.lines) {
					assert.ok(visibleWidth(line) <= width, `${name}, ${period}, ${width}: ${visibleWidth(line)} cells: ${line}`);
				}
				// The title rule may shorten its tabs; nothing below it is clipped.
				for (const line of pane.lines.slice(1)) assert.doesNotMatch(line, /…|\.\.\./, `${name}, ${period}, ${width}: ${line}`);
			}
		}
	}
});

test("renderUsagePane shows every numeric column or names it in the note", () => {
	for (const width of WIDTHS) {
		for (const mode of ["models", "aggregates"] as const) {
			const pane = renderUsagePane(PLAIN_THEME, width, paneStats, paneState({ mode }));
			const shown = cellsOf(pane.lines[1]!).slice(1);
			const note = pane.lines.find((line) => line.startsWith("hidden at this width: "));
			const hidden = note === undefined ? [] : note.trimEnd().slice("hidden at this width: ".length).split(", ");
			assert.deepEqual([...shown, ...hidden].sort(), [...NUMERIC_LABELS].sort(), `${mode} at ${width}`);
			assert.deepEqual(shown, NUMERIC_LABELS.filter((label) => shown.includes(label)), `column order, ${mode} at ${width}`);
			assert.ok(shown.includes("Msgs") && shown.includes("Cost"), `${mode} at ${width}`);
		}
	}
	// 100 columns hold the whole per-model table of the capture; 120 and 170 as well.
	for (const width of [100, 120, 170]) {
		const pane = renderUsagePane(PLAIN_THEME, width, paneStats, paneState({ mode: "models" }));
		assert.deepEqual(pane.lines.slice(1, 1 + CAPTURE_TABLE_120.length).map((line) => line.trimEnd()), CAPTURE_TABLE_120, `at ${width}`);
		assert.ok(pane.lines.every((line) => !line.startsWith("hidden at this width")), `at ${width}`);
	}
});

test("renderUsagePane frames the table: tabs, scroll position, rule and hints", () => {
	const pane = renderUsagePane(PLAIN_THEME, 120, paneStats, paneState({ budget: 10 }));
	assert.equal(pane.lineCount, CAPTURE_TABLE_120.length);
	assert.equal(pane.scrollTop, 0);
	assert.equal(pane.lines.length, 1 + 10 + 2);
	assert.match(pane.lines[0]!, /^── Usage   Today   This Week   Last Week   Last 30 Days   All Time  ─+ lines 1–10 of 14 ↓ ──$/);
	assert.equal(visibleWidth(pane.lines[0]!), 120);
	assert.deepEqual(pane.lines.slice(1, 11).map((line) => line.trimEnd()), CAPTURE_TABLE_120.slice(0, 10));
	assert.equal(pane.lines[11], "─".repeat(120));
	assert.equal(pane.lines[12], "tab period  m hide models  v input sizes  ↑↓ scroll  PgUp/PgDn page  + − height  esc close");
	// Scrolling past the end clamps to the last page.
	const end = renderUsagePane(PLAIN_THEME, 120, paneStats, paneState({ budget: 10, scrollTop: 99 }));
	assert.equal(end.scrollTop, 4);
	assert.match(end.lines[0]!, / ↑ lines 5–14 of 14 ──$/);
	assert.deepEqual(end.lines.slice(1, 11).map((line) => line.trimEnd()), CAPTURE_TABLE_120.slice(4));
});

test("renderUsagePane hints name what each key switches to", () => {
	const hints = (view: Partial<UsagePaneState>): string => renderUsagePane(PLAIN_THEME, 120, paneStats, paneState(view)).lines.at(-1)!;
	const scroll = "↑↓ scroll  PgUp/PgDn page  + − height  esc close";
	assert.equal(hints({ view: "table", mode: "models" }), `tab period  m hide models  v input sizes  ${scroll}`);
	assert.equal(hints({ view: "table", mode: "aggregates" }), `tab period  m show models  v input sizes  ${scroll}`);
	assert.equal(hints({ view: "dist", distStyle: "chart" }), `tab period  v usage table  c show table  ${scroll}`);
	assert.equal(hints({ view: "dist", distStyle: "table" }), `tab period  v usage table  c show chart  ${scroll}`);
});

test("renderUsagePane keeps the hidden-columns note under the table while it scrolls", () => {
	const table = tableLines(captureTable(80, "models"));
	for (const [scrollTop, first] of [[0, 0], [3, 3], [99, table.length - 5]] as const) {
		const pane = renderUsagePane(PLAIN_THEME, 80, paneStats, paneState({ budget: 5, scrollTop }));
		assert.equal(pane.lineCount, table.length, "the note is not a table line");
		// Title, five table lines, the note, the rule, two hint lines.
		assert.equal(pane.lines.length, 1 + 5 + 1 + 1 + 2);
		assert.deepEqual(pane.lines.slice(1, 6).map((line) => line.trimEnd()), table.slice(first, first + 5));
		assert.equal(pane.lines[6]!.trimEnd(), "hidden at this width: Cache, ↓Out");
		assert.equal(pane.lines[7], "─".repeat(80));
	}
	const whole = renderUsagePane(PLAIN_THEME, 80, paneStats, paneState({}));
	assert.match(whole.lines[CAPTURE_TABLE_120.length]!, /^Total +│ +231 │ +142,157 │ +\$53,045 │ +3\.54B │ +2\.26B *$/);
	assert.equal(whole.lines[CAPTURE_TABLE_120.length + 1]!.trimEnd(), "hidden at this width: Cache, ↓Out");
});

test("renderUsagePane reports an empty period without a table or a note", () => {
	for (const width of WIDTHS) {
		const pane = renderUsagePane(PLAIN_THEME, width, timeFilteredStats(), paneState({}));
		assert.equal(pane.lineCount, 1);
		assert.equal(pane.lines[1]!.trimEnd(), "(no usage for this period)");
		assert.equal(pane.lines[2], "─".repeat(width));
	}
});

/** Single-component size: the whole ctx is fresh input. */
const sz = (ctx: number) => ({ input: ctx, cacheRead: 0, cacheWrite: 0 });

test("buildInputDistribution buckets sizes by range, boundaries fall in the higher bucket", () => {
	const bins = buildInputDistribution([
		sz(0), sz(9999), sz(10_000), sz(24_999), sz(25_000), sz(49_999), sz(50_000), sz(99_999), sz(100_000),
		sz(149_999), sz(150_000), sz(199_999), sz(200_000), sz(499_999), sz(500_000), sz(1_500_000),
	]);
	assert.deepEqual(
		bins.map((bin) => [bin.label, bin.count]),
		[
			["<10k", 2],
			["10-25k", 2],
			["25-50k", 2],
			["50-100k", 2],
			["100-150k", 2],
			["150-200k", 2],
			["200-500k", 2],
			[">=500k", 2],
		],
	);
	assert.ok(bins.every((bin) => bin.pct === (2 / 16) * 100));
	assert.equal(INPUT_DIST_BUCKETS.length, bins.length);
});

test("buildInputDistribution buckets by the component sum and totals components per bucket", () => {
	const bins = buildInputDistribution([
		{ input: 5000, cacheRead: 3000, cacheWrite: 2000 }, // ctx 10000 -> 10-25k
		{ input: 90000, cacheRead: 60000, cacheWrite: 0 }, // ctx 150000 -> 150-200k
		{ input: 8000, cacheRead: 2000, cacheWrite: 500 }, // ctx 10500 -> 10-25k
	]);
	const bucket = bins.find((bin) => bin.label === "10-25k")!;
	assert.equal(bucket.count, 2);
	assert.deepEqual([bucket.input, bucket.cacheRead, bucket.cacheWrite], [13000, 5000, 2500]);
	assert.equal(bins.find((bin) => bin.label === "150-200k")!.input, 90000);
	assert.ok(bins.filter((bin) => bin.label !== "10-25k" && bin.label !== "150-200k").every((bin) => bin.count === 0));
});

test("buildInputDistribution reports an empty period", () => {
	const bins = buildInputDistribution([]);
	assert.ok(bins.every((bin) => bin.count === 0 && bin.pct === 0));
});

test("renderInputDistTable lists counts and shares, then the message total", () => {
	const table = renderInputDistTable(
		buildInputDistribution([sz(5000), sz(12000), sz(60000), sz(120000), sz(180000), sz(600000)]),
		PLAIN_THEME,
	);
	assert.match(table.header[0]!, /Range.+Msgs.+Share/);
	assert.deepEqual(junctionsAt(table.header[1]!, "┼"), barsAt(table.header[0]!));
	assert.equal(visibleWidth(table.header[1]!), visibleWidth(table.header[0]!));
	for (const line of table.rows) assert.deepEqual(barsAt(line), barsAt(table.header[0]!));
	assert.equal(table.rows.length, 8);
	assert.match(table.rows[0]!, /<10k.+1.+17%/);
	assert.match(table.rows[7]!, />=500k.+1.+17%/);
	assert.ok(table.rows[6]!.includes("200-500k") && table.rows[6]!.trimEnd().endsWith("-"));
	assert.deepEqual(table.totals, ["6 messages"]);
});

test("renderInputDistTable styles: dim header, rule, and grid; totals left unstyled", () => {
	const table = renderInputDistTable(buildInputDistribution([sz(5000), sz(60000)]), TAG_THEME);
	assert.match(table.header[0]!, /^<dim>Range.+Share<\/dim>$/);
	assert.match(table.header[1]!, /^<dim>─+┼.+─<\/dim>$/);
	for (const line of table.rows) assert.doesNotMatch(line.replaceAll("<dim> │ </dim>", ""), /│/, "every │ is dim");
	assert.deepEqual(table.totals, ["2 messages"]);
});

test("renderInputDistTable reports an empty period", () => {
	assert.deepEqual(renderInputDistTable(buildInputDistribution([]), PLAIN_THEME), {
		header: ["(no usage for this period)"],
		rows: [],
		totals: [],
	});
});

function barLength(line: string): number {
	return [...line].filter((ch) => ch === "█").length;
}

test("renderInputDistChart scales bars to the width, longest fills, zero stays empty", () => {
	const chart = renderInputDistChart(
		buildInputDistribution([sz(1000), sz(1000), sz(1000), sz(1000), sz(60_000), sz(60_000), sz(600_000)]),
		60,
	);
	assert.equal(chart.rows.length, 8);
	assert.deepEqual(chart.totals, ["7 messages"]);
	const lengths = chart.rows.map(barLength);
	assert.equal(lengths[0], Math.max(...lengths));
	assert.ok(lengths[3]! > 0 && lengths[3]! < lengths[0]!);
	assert.ok(lengths[7]! > 0);
	assert.equal(lengths[1], 0);
	assert.equal(lengths[2], 0);
	assert.ok(chart.rows.every((line) => line.length <= 60));
});

test("renderInputDistChart reports an empty period", () => {
	assert.deepEqual(renderInputDistChart(buildInputDistribution([]), 60), {
		header: ["(no usage for this period)"],
		rows: [],
		totals: [],
	});
});

test("renderInputDistChart stacks input/cacheRead/cacheWrite segments proportionally", () => {
	const segmentLengths = () => {
		const seen = { input: 0, cacheRead: 0, cacheWrite: 0 };
		return {
			seen,
			palette: {
				input: (s: string) => ((seen.input += s.length), s),
				cacheRead: (s: string) => ((seen.cacheRead += s.length), s),
				cacheWrite: (s: string) => ((seen.cacheWrite += s.length), s),
			},
		};
	};
	// Width 60 leaves a 44-block bar (labels 8, counts 1, shares 4, gaps 3).
	// Exact split: 22000/11000/11000 over 44 blocks.
	{
		const { seen, palette } = segmentLengths();
		const chart = renderInputDistChart(
			buildInputDistribution([{ input: 22000, cacheRead: 11000, cacheWrite: 11000 }]),
			60,
			palette,
		);
		assert.deepEqual([seen.input, seen.cacheRead, seen.cacheWrite], [22, 11, 11]);
		assert.equal(barLength(chart.rows[2]!), 44);
	}
	// Largest remainder: 6000/3000/1000 over 44 blocks is 26.4/13.2/4.4,
	// so the leftover block goes to the leading fractional part (input).
	{
		const { seen, palette } = segmentLengths();
		const chart = renderInputDistChart(
			buildInputDistribution([{ input: 6000, cacheRead: 3000, cacheWrite: 1000 }]),
			60,
			palette,
		);
		assert.deepEqual([seen.input, seen.cacheRead, seen.cacheWrite], [27, 13, 4]);
		assert.equal(barLength(chart.rows[1]!), 44);
	}
});

test("renderInputDistChart caps the bar area at 60 cells and keeps counts next to it", () => {
	const bins = buildInputDistribution([sz(1000), sz(1000), sz(1000), sz(1000), sz(60_000), sz(60_000), sz(600_000)]);
	for (const width of [100, 120, 170]) {
		const chart = renderInputDistChart(bins, width);
		assert.equal(Math.max(...chart.rows.map(barLength)), 60, `fullest bar at ${width}`);
		// label (8) + gap + bar area (60) + gap + count (1) + gap + share (3).
		for (const line of chart.rows) assert.equal(visibleWidth(line), 8 + 1 + 60 + 1 + 1 + 1 + 3, `row at ${width}: ${line}`);
		assert.equal(chart.rows[0], `<10k     ${"█".repeat(60)} 4 57%`);
		assert.equal(chart.rows[1], `10-25k   ${" ".repeat(60)} 0   -`);
	}
	// Narrower terminals still scale the bar area to what is left: the width less 8 + 1 + 3 and three gaps.
	assert.equal(Math.max(...renderInputDistChart(bins, 60).rows.map(barLength)), 45);
	assert.equal(Math.max(...renderInputDistChart(bins, 30).rows.map(barLength)), 15);
});

test("the distribution counts messages with thousands separators", () => {
	const sizes = [...Array.from({ length: 1234 }, () => sz(5000)), sz(60_000)];
	const bins = buildInputDistribution(sizes);
	const chart = renderInputDistChart(bins, 120);
	assert.match(chart.rows[0]!, /^<10k +█+ 1,234 100%$/);
	assert.match(chart.rows[3]!, /^50-100k +█ +1 0\.1%$/);
	assert.deepEqual(chart.totals, ["1,235 messages"]);
	const table = renderInputDistTable(bins, PLAIN_THEME);
	assert.deepEqual(cellsOf(table.rows[0]!), ["<10k", "1,234", "100%"]);
	assert.deepEqual(cellsOf(table.rows[1]!), ["10-25k", "0", "-"]);
	assert.deepEqual(table.totals, ["1,235 messages"]);
	for (const line of [...table.header, ...table.rows]) assert.equal(visibleWidth(line), visibleWidth(table.header[0]!));
	// The pane prints the same total under the chart.
	const pane = renderUsagePane(PLAIN_THEME, 120, timeFilteredStats({ inputSizes: sizes }), paneState({ view: "dist" }));
	assert.ok(pane.lines.some((line) => line.trimEnd() === "1,235 messages"));
});
