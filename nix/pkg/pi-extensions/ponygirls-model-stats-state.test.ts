import assert from "node:assert/strict";
import test from "node:test";

import { PLAIN_THEME, fit, type UiTheme } from "@ponygirls/pi-ui";

import {
	classifyOutcome,
	clampStatsBudget,
	clampStatsScrollTop,
	DAY_MS,
	DEFAULT_SORT,
	defaultStatsBudget,
	HOUR_MS,
	isUsableRecord,
	layoutWindow,
	MIN_MODEL_WIDTH,
	parseStatsLine,
	percentile,
	pruneRecords,
	renderStatsScreen,
	renderWindow,
	serializeStatsRecord,
	shortenModelLabel,
	shownColumns,
	shownSort,
	sortKeys,
	sortModels,
	STATS_CHROME_LINES,
	STATS_DEFAULT_BUDGET,
	STATS_MAX_BUDGET,
	STATS_MIN_BUDGET,
	statsVisibleRange,
	summarize,
	summarizeMetric,
	tokensPerSecond,
	WEEK_MS,
	WINDOWS,
	type BreakdownSummaries,
	type ColumnSet,
	type MetricStats,
	type ModelWindowStats,
	type RenderedWindow,
	type ResponseSample,
	type SortOrder,
	type StatsRecord,
	type StatsScreen,
	type StatsViewState,
	type WindowLayout,
	type WindowSummary,
	UNRECORDED_EFFORT,
	compareEfforts,
} from "./ponygirls-model-stats-state.ts";
import { scrollPosition } from "./scroll-state.ts";

/** A sort only the full column set has: mean tok/s, fastest first. */
const BY_MEAN: SortOrder = { id: "tps-mean", descending: true };

/** Wraps styled text in `<token>…</token>` (bold as `<b>`); for checking which style a cell got, not widths. */
const TAG_THEME: UiTheme = {
	fg: (color, text) => `<${color}>${text}</${color}>`,
	bg: (color, text) => `<${color}>${text}</${color}>`,
	bold: (text) => `<b>${text}</b>`,
};

const NOW = 1_000_000_000_000;

function sample(overrides: Partial<ResponseSample> = {}): ResponseSample {
	return {
		type: "ok",
		ts: NOW,
		key: "anthropic/claude-sonnet",
		ttftMs: 500,
		totalMs: 10_000,
		outputTokens: 1_000,
		...overrides,
	};
}

test("classifyOutcome buckets stop reasons", () => {
	assert.equal(classifyOutcome("stop"), "ok");
	assert.equal(classifyOutcome("toolUse"), "ok");
	assert.equal(classifyOutcome("aborted"), "aborted");
	assert.equal(classifyOutcome("error", "429 overloaded"), "error");
	assert.equal(classifyOutcome("error", "request timed out after 60s"), "timeout");
	assert.equal(classifyOutcome("error", "connect ETIMEDOUT 10.0.0.1"), "timeout");
	assert.equal(classifyOutcome("error"), "error");
});

test("tokensPerSecond uses the decode span, falling back to the full span", () => {
	assert.equal(tokensPerSecond(sample({ ttftMs: 1_000, totalMs: 11_000, outputTokens: 500 })), 50);
	assert.equal(tokensPerSecond(sample({ ttftMs: 5_000, totalMs: 5_000, outputTokens: 500 })), 100);
});

test("a decode span under the floor is not a stored measurement", () => {
	const dumped = sample({ ttftMs: 7_332, totalMs: 7_334, outputTokens: 383 });
	assert.equal(isUsableRecord(dumped), false);
	assert.equal(isUsableRecord(sample({ ttftMs: 5_000, totalMs: 5_000, outputTokens: 500 })), true);
	assert.equal(isUsableRecord(sample({ ttftMs: 12_000, totalMs: 10_000 })), false);
	assert.equal(parseStatsLine(serializeStatsRecord(dumped)) !== undefined, true);
	const [hour] = summarize([dumped, sample()], NOW, "model");
	assert.equal(hour?.models[0]?.responses, 1);
	assert.ok((hour?.models[0]?.tps?.mean ?? 0) < 200);
});

test("percentile interpolates between ranks", () => {
	const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
	assert.equal(percentile(sorted, 0), 10);
	assert.equal(percentile(sorted, 50), 55);
	assert.equal(percentile(sorted, 90), 91);
	assert.equal(percentile(sorted, 99), 99.1);
	assert.equal(percentile(sorted, 100), 100);
	assert.ok(Number.isNaN(percentile([], 50)));
});

test("summarizeMetric reports mean and percentiles, undefined when empty", () => {
	const stats = summarizeMetric([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
	assert.deepEqual(
		(( { p10, p1, ...rest } ) => rest)(stats!),
		{ mean: 55, p50: 55, p90: 91, p99: 99.1 },
	);
	assert.ok(Math.abs(stats!.p10 - 19) < 1e-9);
	assert.ok(Math.abs(stats!.p1 - 10.9) < 1e-9);
	assert.equal(summarizeMetric([]), undefined);
});

test("serialize/parse round-trips records", () => {
	const ok = sample();
	assert.deepEqual(parseStatsLine(serializeStatsRecord(ok)), ok);
	const fail: StatsRecord = { type: "fail", ts: NOW, key: "openai/gpt-5", kind: "timeout" };
	assert.deepEqual(parseStatsLine(serializeStatsRecord(fail)), fail);
});

test("parseStatsLine drops blank, malformed, and mistyped lines", () => {
	assert.equal(parseStatsLine(""), undefined);
	assert.equal(parseStatsLine("not json"), undefined);
	assert.equal(parseStatsLine('{"type":"ok"}'), undefined);
	assert.equal(parseStatsLine('{"type":"fail","ts":1,"key":"a/b","kind":"melted"}'), undefined);
	assert.equal(parseStatsLine('{"type":"ok","ts":1,"key":"ab","ttftMs":1,"totalMs":2,"outputTokens":3}'), undefined);
	assert.equal(
		parseStatsLine('{"type":"ok","ts":1,"key":"a/b","ttftMs":"1","totalMs":2,"outputTokens":3}'),
		undefined,
	);
});

test("pruneRecords keeps records at or after the cutoff", () => {
	const records = [sample({ ts: 100 }), sample({ ts: 200 }), sample({ ts: 300 })];
	assert.deepEqual(pruneRecords(records, 200).map((record) => record.ts), [200, 300]);
});

function metric(values: Partial<MetricStats> & { mean: number }): MetricStats {
	return { p50: 0, p90: 0, p99: 0, p10: 0, p1: 0, ...values };
}

test("sortModels by mean tok/s keeps models without a rate last", () => {
	const fast = {
		key: "zai/glm",
		responses: 2,
		failures: { aborted: 0, timeout: 0, error: 0 },
		tps: metric({ mean: 400, p50: 400, p90: 400, p99: 400 }),
	};
	const slow = {
		key: "xai/grok",
		responses: 90,
		failures: { aborted: 0, timeout: 0, error: 0 },
		tps: metric({ mean: 145, p50: 111, p90: 200, p99: 613 }),
	};
	const unmeasured = {
		key: "openai/gpt",
		responses: 0,
		failures: { aborted: 3, timeout: 0, error: 0 },
	};
	assert.deepEqual(
		sortModels([slow, unmeasured, fast], "tps-mean", true).map((model) => model.key),
		["zai/glm", "xai/grok", "openai/gpt"],
	);
	assert.deepEqual(
		sortModels([slow, fast], "n", true).map((model) => model.key),
		["xai/grok", "zai/glm"],
	);
	assert.deepEqual(
		sortModels([slow, fast], "model", false).map((model) => model.key),
		["xai/grok", "zai/glm"],
	);
});

test("summarize windows, groups, counts failures, and sorts by activity", () => {
	const records: StatsRecord[] = [
		sample({ ts: NOW - 30 * 60 * 1000, key: "anthropic/claude-sonnet" }),
		sample({ ts: NOW - 2 * HOUR_MS, key: "anthropic/claude-sonnet" }),
		sample({ ts: NOW - 2 * DAY_MS, key: "openai/gpt-5" }),
		{ type: "fail", ts: NOW - 10 * 60 * 1000, key: "openai/gpt-5", kind: "aborted" },
		{ type: "fail", ts: NOW - 10 * 60 * 1000, key: "openai/gpt-5", kind: "timeout" },
		sample({ ts: NOW - WEEK_MS - 1, key: "google/gemini" }),
	];
	const [hour, day, week] = summarize(records, NOW, "model") as [
		ReturnType<typeof summarize>[number],
		ReturnType<typeof summarize>[number],
		ReturnType<typeof summarize>[number],
	];

	assert.deepEqual(
		hour.models.map((model) => [model.key, model.responses]),
		[
			["openai/gpt-5", 0],
			["anthropic/claude-sonnet", 1],
		],
	);
	const gpt5 = hour.models[0]!;
	assert.deepEqual(gpt5.failures, { aborted: 1, timeout: 1, error: 0 });
	assert.equal(gpt5.ttft, undefined);

	assert.equal(day.models.find((model) => model.key === "anthropic/claude-sonnet")?.responses, 2);
	assert.equal(week.models.length, 2);
	assert.equal(
		week.models.every((model) => model.key !== "google/gemini"),
		true,
	);
});

function barsAt(line: string): number[] {
	const indexes: number[] = [];
	for (let index = 0; index < line.length; index++) if (line[index] === "│") indexes.push(index);
	return indexes;
}

/** Columns of a plain-theme line: every glyph the table uses is one column wide. */
function visibleWidth(line: string): number {
	return [...line].length;
}

function junctionsAt(line: string): number[] {
	const indexes: number[] = [];
	for (let index = 0; index < line.length; index++) if (line[index] === "┼") indexes.push(index);
	return indexes;
}

/** Wider than any table here: nothing is narrowed. */
const ROOMY = 1000;

function layoutAt(summary: WindowSummary, columns: ColumnSet, width: number): WindowLayout {
	const fitted = layoutWindow(summary, columns, width);
	assert.equal(fitted.kind, "layout", `${columns} table in ${width} columns`);
	return (fitted as Extract<typeof fitted, { kind: "layout" }>).layout;
}

/** Every statistic at the natural width. */
function fullTable(summary: WindowSummary, theme: UiTheme, sort: SortOrder): RenderedWindow {
	return renderWindow(summary, theme, sort, layoutAt(summary, "full", ROOMY));
}

const SONNET: ModelWindowStats = {
	key: "anthropic/claude-sonnet",
	responses: 2,
	failures: { aborted: 0, timeout: 1, error: 0 },
	ttft: metric({ mean: 500, p50: 500, p90: 500, p99: 500 }),
	total: metric({ mean: 10_000, p50: 10_000, p90: 10_000, p99: 10_000 }),
	tps: metric({ mean: 105.3, p50: 105.3, p90: 105.3, p99: 105.3, p10: 90.1, p1: 42.5 }),
};
const GPT5: ModelWindowStats = {
	key: "openai/gpt-5",
	responses: 0,
	failures: { aborted: 1, timeout: 0, error: 3 },
};
const HOUR: WindowSummary = { label: "Last hour", breakdown: "model", models: [SONNET, GPT5] };

test("renderWindow lays out group titles, column labels, a ┼ rule, and one row per model", () => {
	const table = fullTable(HOUR, PLAIN_THEME, BY_MEAN);
	const lines = [...table.header, ...table.rows];
	assert.equal(lines.length, 5);
	assert.match(lines[0]!, /ttft s.+total s.+tok\/s ↓/);
	assert.match(lines[1]!, /mean +p50 +p90 +p99/);
	// The tok/s group carries the slow-tail columns; ttft/total keep four each.
	assert.equal(lines[1]!.split("p10").length - 1, 1);
	assert.match(lines[1]!, /p99 +p10 +p1/);
	assert.match(lines[2]!, /^─+┼─+┼─/);
	assert.match(lines[3]!, /90\.1 +42\.5/);
	assert.match(lines[3]!, /^anthropic\/claude-sonnet │ +2 │ +· │ +1 │ +· │/);
	// Percentiles inside a group are space-separated; groups keep their │.
	assert.match(lines[3]!, /│ +0\.5 +0\.5 +0\.5 +0\.5 +│ +10\.0 +10\.0/);
	// No sampled response is a quiet zero, like the failure counts.
	assert.match(lines[4]!, /^openai\/gpt-5 +│ +· │ +1 │ +· │ +3 │/);
	assert.match(lines[4]!, /│ +-/);
	const rowBars = barsAt(lines[3]!);
	// One bar per top-level column boundary: model, n, abrt, tout, err, ttft, total | tok/s.
	assert.equal(rowBars.length, 7);
	assert.ok(barsAt(lines[0]!).every((index) => rowBars.includes(index)));
	assert.deepEqual(barsAt(lines[1]!), rowBars);
	assert.deepEqual(barsAt(lines[4]!), rowBars);
	assert.deepEqual(junctionsAt(lines[2]!), rowBars);
});

test("renderWindow lines share one visible width", () => {
	const table = fullTable(HOUR, PLAIN_THEME, BY_MEAN);
	const widths = [...table.header, ...table.rows].map((line) => visibleWidth(line));
	assert.ok(widths.every((width) => width === widths[0]), `widths ${widths.join(",")}`);
	// Ten columns short: the names are under the minimum the column keeps, so they stay whole and total s goes.
	const narrow = renderWindow(HOUR, PLAIN_THEME, BY_MEAN, layoutAt(HOUR, "full", widths[0]! - 10));
	const narrowWidths = [...narrow.header, ...narrow.rows].map((line) => visibleWidth(line));
	assert.ok(narrowWidths.every((width) => width === narrowWidths[0] && width <= widths[0]! - 10), `widths ${narrowWidths.join(",")}`);
	assert.match(narrow.rows[0]!, /^anthropic\/claude-sonnet │/);
	assert.match(narrow.header[0]!, /│ ttft s +│ tok\/s ↓/);
});

test("renderWindow styles the grid dim and failure counts by kind", () => {
	const table = fullTable(HOUR, TAG_THEME, BY_MEAN);
	for (const line of [...table.header, ...table.rows]) {
		assert.doesNotMatch(line.replaceAll("<dim> │ </dim>", ""), /│/, "every │ is dim");
	}
	assert.match(table.header[2]!, /^<dim>─+┼/);
	const [sonnet, gpt5] = table.rows as [string, string];
	// Zero is a dim dot; abrt/tout warn and err errors when positive. Each header keeps room for the sort arrow.
	assert.match(sonnet, /<dim> │ <\/dim><dim> {5}·<\/dim><dim> │ <\/dim><warning> {5}1<\/warning><dim> │ <\/dim><dim> {4}·<\/dim>/);
	assert.match(gpt5, /<warning> {5}1<\/warning><dim> │ <\/dim><dim> {5}·<\/dim><dim> │ <\/dim><error> {4}3<\/error>/);
	// Header labels are dim, on the line under the group titles.
	assert.match(table.header[1]!, /<dim> {2}abrt<\/dim>/);
	assert.match(table.header[1]!, /<dim>model {2,}<\/dim>/);
});

test("renderWindow marks the sorted column: accent header with arrow, bold values", () => {
	const byMean = fullTable(HOUR, TAG_THEME, BY_MEAN);
	assert.match(byMean.header[0]!, /<b><accent>tok\/s ↓ *<\/accent><\/b>/);
	assert.match(byMean.header[1]!, /<b><accent>mean<\/accent><\/b>/);
	assert.equal(byMean.header[1]!.split("<accent>").length - 1, 1, "only the sorted label is accent");
	assert.match(byMean.rows[0]!, /<b> *105<\/b>/);
	assert.equal(byMean.rows[0]!.split("<b>").length - 1, 1, "only the sorted cell is bold");

	const byTtft = fullTable(HOUR, TAG_THEME, { id: "ttft-mean", descending: false });
	assert.match(byTtft.header[0]!, /<b><accent>ttft s ↑ *<\/accent><\/b>/);
	assert.match(byTtft.header[0]!, /<dim>tok\/s *<\/dim>/);
	assert.match(byTtft.rows[0]!, /<b> *0\.5<\/b>/);

	const byN = fullTable(HOUR, TAG_THEME, { id: "n", descending: true });
	assert.match(byN.header[1]!, /<b><accent>n ↓<\/accent><\/b>/);
	assert.match(byN.rows[0]!, /<dim> │ <\/dim><b> +2<\/b><dim> │ <\/dim>/);

	const byModel = fullTable(HOUR, TAG_THEME, { id: "model", descending: false });
	assert.match(byModel.header[1]!, /^<b><accent>model ↑ *<\/accent><\/b>/);
	assert.match(byModel.rows[0]!, /^<b>anthropic\/claude-sonnet<\/b>/);

	// A failure column is sorted like n: arrow on its label, the cell bold.
	const byErrors = fullTable(HOUR, TAG_THEME, { id: "error", descending: true });
	assert.match(byErrors.header[1]!, /<b><accent>err ↓<\/accent><\/b>/);
	assert.match(byErrors.rows[1]!, /<b><error> {4}3<\/error><\/b>/);
	assert.doesNotMatch(byErrors.rows[0]!, /<b>/, "a zero stays quiet");

	// The arrow is reserved in every layout: a sort change never moves a column.
	const plainBars = (sort: SortOrder) => fullTable(HOUR, PLAIN_THEME, sort).rows.map(barsAt);
	assert.deepEqual(plainBars({ id: "n", descending: true }), plainBars(BY_MEAN));
	assert.deepEqual(plainBars({ id: "model", descending: false }), plainBars(BY_MEAN));
	assert.deepEqual(plainBars({ id: "error", descending: true }), plainBars(BY_MEAN));
});

test("renderWindow sizes each column to its content so percentiles stay separate", () => {
	const table = fullTable(
		{
			label: "Last hour",
			breakdown: "model",
			models: [
				{
					key: "xai/grok-4.7",
					responses: 64,
					failures: { aborted: 0, timeout: 0, error: 0 },
					ttft: metric({ mean: 3_300, p50: 2_900, p90: 4_500, p99: 9_400 }),
					total: metric({ mean: 16_000, p50: 7_300, p90: 36_600, p99: 92_300 }),
					tps: metric({ mean: 6_238, p50: 126, p90: 51_831, p99: 43_305, p10: 88, p1: 12 }),
				},
			],
		},
		PLAIN_THEME,
		BY_MEAN,
	);
	const row = table.rows[0]!;
	const sub = table.header[1]!;
	assert.match(row, /(^|\s)51831(\s|$)/);
	assert.match(row, /(^|\s)43305(\s|$)/);
	assert.doesNotMatch(row, /5183143305/);
	// The third metric group's p90/p99 headers end in the same column as the values.
	const p90Header = sub.lastIndexOf("p90");
	const p99Header = sub.lastIndexOf("p99");
	assert.equal(row.lastIndexOf("51831") + "51831".length, p90Header + "p90".length);
	assert.equal(row.lastIndexOf("43305") + "43305".length, p99Header + "p99".length);
});

test("each period's table is sized to its own rows", () => {
	const short = {
		key: "a/b",
		responses: 1,
		failures: { aborted: 0, timeout: 0, error: 0 },
		tps: metric({ mean: 100, p50: 100, p90: 100, p99: 100, p10: 50, p1: 10 }),
	};
	const long = {
		key: "a-much-longer-model-name/c",
		responses: 2000,
		failures: { aborted: 0, timeout: 3, error: 0 },
		tps: metric({ mean: 90 }),
	};
	const hour = layoutAt({ label: "Last hour", breakdown: "model", models: [short] }, "full", ROOMY);
	const week = layoutAt({ label: "Week", breakdown: "model", models: [short, long] }, "full", ROOMY);
	// A column is as wide as its header (with the sort arrow) or its widest cell on that tab.
	assert.equal(hour.modelWidth, "model ↓".length);
	assert.equal(week.modelWidth, long.key.length);
	assert.equal(hour.nWidth, "n ↓".length);
	assert.equal(week.nWidth, "2,000".length);
});

test("serialize/parse round-trips the effort; a mistyped effort is a malformed line", () => {
	const ok = sample({ effort: "high" });
	assert.deepEqual(parseStatsLine(serializeStatsRecord(ok)), ok);
	const fail: StatsRecord = { type: "fail", ts: NOW, key: "openai/gpt-5", kind: "error", effort: "off" };
	assert.deepEqual(parseStatsLine(serializeStatsRecord(fail)), fail);
	// A level this code does not know is kept, not dropped from the file.
	assert.deepEqual(parseStatsLine(serializeStatsRecord(sample({ effort: "ultra" }))), sample({ effort: "ultra" }));
	// Records written before effort was stored carry no effort key at all.
	assert.equal("effort" in parseStatsLine(serializeStatsRecord(sample()))!, false);
	assert.equal(parseStatsLine('{"type":"ok","ts":1,"key":"a/b","ttftMs":1,"totalMs":2,"outputTokens":3,"effort":7}'), undefined);
	assert.equal(parseStatsLine('{"type":"fail","ts":1,"key":"a/b","kind":"error","effort":""}'), undefined);
});

test("compareEfforts orders Pi levels, then unknown levels, then unrecorded", () => {
	const efforts = [UNRECORDED_EFFORT, "ultra", "high", "off", "max", "minimal", "medium", "low", "xhigh"];
	assert.deepEqual([...efforts].sort(compareEfforts), ["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", UNRECORDED_EFFORT]);
});

test("summarize by effort splits each model per effort; the model breakdown aggregates them", () => {
	const records: StatsRecord[] = [
		sample({ key: "openai/gpt-5", effort: "high", ttftMs: 2_000, totalMs: 12_000 }),
		sample({ key: "openai/gpt-5", effort: "high", ttftMs: 4_000, totalMs: 14_000 }),
		sample({ key: "openai/gpt-5", effort: "low", ttftMs: 500, totalMs: 5_500 }),
		{ type: "fail", ts: NOW, key: "openai/gpt-5", kind: "timeout", effort: "high" },
		sample({ key: "openai/gpt-5" }),
		sample({ key: "anthropic/claude-sonnet", effort: "off" }),
	];
	const [byEffort] = summarize(records, NOW, "effort");
	assert.equal(byEffort?.breakdown, "effort");
	// Most active row first; ties by model name, then effort.
	assert.deepEqual(
		byEffort?.models.map((row) => [row.key, row.effort, row.responses]),
		[
			["openai/gpt-5", "high", 2],
			["anthropic/claude-sonnet", "off", 1],
			["openai/gpt-5", "low", 1],
			["openai/gpt-5", UNRECORDED_EFFORT, 1],
		],
	);
	const high = byEffort!.models[0]!;
	assert.deepEqual(high.failures, { aborted: 0, timeout: 1, error: 0 });
	assert.equal(high.ttft?.mean, 3_000);

	const [byModel] = summarize(records, NOW, "model");
	assert.equal(byModel?.breakdown, "model");
	assert.deepEqual(
		byModel?.models.map((row) => [row.key, row.responses, "effort" in row]),
		[
			["openai/gpt-5", 4, false],
			["anthropic/claude-sonnet", 1, false],
		],
	);
	assert.equal(byModel!.models[0]!.failures.timeout, 1);
});

test("sortModels keeps one model's effort rows in effort order, whatever the model direction", () => {
	const row = (key: string, effort: string): ModelWindowStats => ({
		key,
		effort,
		responses: 1,
		failures: { aborted: 0, timeout: 0, error: 0 },
	});
	const rows = [row("b/m", "high"), row("a/m", UNRECORDED_EFFORT), row("b/m", "low"), row("a/m", "medium")];
	const order = (sorted: ModelWindowStats[]) => sorted.map((model) => `${model.key}@${model.effort}`);
	assert.deepEqual(order(sortModels(rows, "model", false)), ["a/m@medium", `a/m@${UNRECORDED_EFFORT}`, "b/m@low", "b/m@high"]);
	assert.deepEqual(order(sortModels(rows, "model", true)), ["b/m@low", "b/m@high", "a/m@medium", `a/m@${UNRECORDED_EFFORT}`]);
	// Equal values (none measured) fall back to model, then effort.
	assert.deepEqual(order(sortModels(rows, "tps-mean", true)), ["a/m@medium", `a/m@${UNRECORDED_EFFORT}`, "b/m@low", "b/m@high"]);
});

const HOUR_BY_EFFORT: WindowSummary = {
	label: "Last hour",
	breakdown: "effort",
	models: [
		{ ...SONNET, effort: "medium" },
		{ ...SONNET, effort: UNRECORDED_EFFORT, responses: 1 },
		{ ...GPT5, effort: "xhigh" },
	],
};

test("renderWindow by effort adds an effort column after the model, unrecorded effort dim", () => {
	const table = fullTable(HOUR_BY_EFFORT, PLAIN_THEME, BY_MEAN);
	const lines = [...table.header, ...table.rows];
	assert.equal(lines.length, 6);
	assert.match(lines[1]!, /^model +│ effort │ /);
	assert.match(lines[3]!, /^anthropic\/claude-sonnet │ medium │ +2 │/);
	assert.match(lines[4]!, /^anthropic\/claude-sonnet │ \? +│ +1 │/);
	assert.match(lines[5]!, /^openai\/gpt-5 +│ xhigh +│ +· │/);
	const rowBars = barsAt(lines[3]!);
	// The model-breakdown bars plus one for the effort column.
	assert.equal(rowBars.length, 8);
	assert.ok(barsAt(lines[0]!).every((index) => rowBars.includes(index)));
	assert.deepEqual(barsAt(lines[1]!), rowBars);
	assert.deepEqual(junctionsAt(lines[2]!), rowBars);
	const widths = lines.map(visibleWidth);
	assert.ok(widths.every((width) => width === widths[0]), `widths ${widths.join(",")}`);
	// A narrower pane leaves the model and effort columns whole.
	const narrow = renderWindow(HOUR_BY_EFFORT, PLAIN_THEME, BY_MEAN, layoutAt(HOUR_BY_EFFORT, "full", widths[0]! - 10));
	for (const line of [...narrow.header, ...narrow.rows]) assert.ok(visibleWidth(line) <= widths[0]! - 10);
	assert.match(narrow.rows[0]!, /^anthropic\/claude-sonnet │ medium │/);

	const tagged = fullTable(HOUR_BY_EFFORT, TAG_THEME, BY_MEAN);
	assert.match(tagged.header[1]!, /<dim>effort<\/dim>/);
	assert.match(tagged.rows[0]!, /<dim> │ <\/dim>medium<dim> │ <\/dim>/);
	assert.match(tagged.rows[1]!, /<dim> │ <\/dim><dim>\? +<\/dim><dim> │ <\/dim>/);
});

test("a layout belongs to its breakdown", () => {
	const byEffortLayout = layoutAt(HOUR_BY_EFFORT, "full", ROOMY);
	assert.equal(byEffortLayout.effortWidth, "medium".length);
	assert.equal(layoutAt(HOUR, "full", ROOMY).effortWidth, undefined);
	assert.throws(() => renderWindow(HOUR, PLAIN_THEME, BY_MEAN, byEffortLayout), /needs a layout/);
	assert.throws(() => layoutWindow({ ...HOUR, breakdown: "effort" }, "full", ROOMY), /has no effort/);
});

test("scrollPosition shows the visible range with arrows where lines are hidden", () => {
	assert.equal(scrollPosition(40, 0, 15), "lines 1–15 of 40 ↓");
	assert.equal(scrollPosition(40, 10, 25), "↑ lines 11–25 of 40 ↓");
	assert.equal(scrollPosition(40, 25, 40), "↑ lines 26–40 of 40");
});

test("stats scroll budget clamps to the adjustable range", () => {
	assert.equal(clampStatsBudget(15), 15);
	assert.equal(clampStatsBudget(0), STATS_MIN_BUDGET);
	assert.equal(clampStatsBudget(1000), STATS_MAX_BUDGET);
	assert.equal(clampStatsBudget(Number.NaN), STATS_DEFAULT_BUDGET);
});

test("clampStatsScrollTop keeps the window inside the content", () => {
	assert.equal(clampStatsScrollTop(0, 0, 15), 0);
	assert.equal(clampStatsScrollTop(99, 10, 15), 0);
	assert.equal(clampStatsScrollTop(-4, 37, 15), 0);
	assert.equal(clampStatsScrollTop(99, 37, 15), 22);
	assert.equal(clampStatsScrollTop(10, 37, 15), 10);
});

test("statsVisibleRange pages through content with no unreachable lines", () => {
	const total = 37;
	const budget = 15;
	assert.deepEqual(statsVisibleRange(total, 0, budget), { start: 0, end: 15 });
	assert.deepEqual(statsVisibleRange(total, 99, budget), { start: 22, end: 37 });
	// Paging down by a full budget from the top reaches the bottom with no gaps.
	let top = 0;
	const seen = new Set<number>();
	for (;;) {
		const { start, end } = statsVisibleRange(total, top, budget);
		for (let index = start; index < end; index++) seen.add(index);
		if (end >= total) break;
		top += budget;
	}
	assert.equal(seen.size, total);
	// Every line is visible at its own clamped offset.
	for (let index = 0; index < total; index++) {
		const { start, end } = statsVisibleRange(total, index, budget);
		assert.ok(start <= index && index < end, `line ${index} visible at offset ${index}`);
	}
});

test("defaultStatsBudget takes half the terminal, less the chrome", () => {
	assert.equal(defaultStatsBudget(undefined), STATS_DEFAULT_BUDGET);
	assert.equal(defaultStatsBudget(Number.NaN), STATS_DEFAULT_BUDGET);
	assert.equal(defaultStatsBudget(50), 25 - STATS_CHROME_LINES);
	assert.equal(defaultStatsBudget(24), 12 - STATS_CHROME_LINES);
	assert.equal(defaultStatsBudget(1000), STATS_MAX_BUDGET);
	assert.equal(defaultStatsBudget(6), STATS_MIN_BUDGET);
});

// ---- /perf screen: period tabs, column sets, narrowing ----

/** A row with every statistic: ttft and total as [mean, p50, p90, p99] seconds, tok/s as [mean, p50, p90, p99, p10, p1]. */
function row(
	key: string,
	responses: number,
	[aborted, timeout, error]: [number, number, number],
	ttft: [number, number, number, number],
	total: [number, number, number, number],
	tps: [number, number, number, number, number, number],
): ModelWindowStats {
	const timing = ([mean, p50, p90, p99]: [number, number, number, number]): MetricStats =>
		metric({ mean: mean * 1000, p50: p50 * 1000, p90: p90 * 1000, p99: p99 * 1000 });
	const [mean, p50, p90, p99, p10, p1] = tps;
	return { key, responses, failures: { aborted, timeout, error }, ttft: timing(ttft), total: timing(total), tps: { mean, p50, p90, p99, p10, p1 } };
}

const DEEPSEEK = "novita/deepseek-ai/DeepSeek-V4.1-Flash-1017";
const SONNET_5 = "ai-gateway-anthropic/claude-sonnet-5-5";

/** Eight models, 2,495 requests; the first four rows follow the capture the pane was reviewed on. */
const PERF_HOUR: WindowSummary = {
	label: "Last hour",
	breakdown: "model",
	models: [
		row(DEEPSEEK, 11, [0, 0, 0], [1.0, 0.9, 1.2, 1.8], [3.3, 2.4, 6.1, 7.5], [263, 236, 386, 447, 160, 109]),
		row(SONNET_5, 368, [0, 0, 0], [1.3, 1.2, 1.8, 3.3], [7.4, 4.3, 13.5, 56.3], [151, 145, 188, 251, 119, 103]),
		row("ai-gateway-anthropic/claude-fable-5-2", 331, [0, 0, 3], [1.9, 1.5, 2.6, 11.0], [14.6, 8.0, 31.0, 127], [123, 115, 151, 196, 95.3, 83.1]),
		row("openai-codex/gpt-6.1-sol", 1280, [0, 1, 2], [2.1, 1.7, 4.7, 6.8], [28.7, 18.1, 66.3, 149], [35.4, 35.4, 48.1, 67.4, 19.8, 9.4]),
		row("xai/grok-5-fast", 212, [0, 0, 0], [0.8, 0.7, 1.1, 2.4], [9.1, 6.9, 19.8, 41.4], [33.9, 31.0, 44.6, 58.2, 21.3, 14.2]),
		row("zai/glm-6", 143, [0, 0, 0], [2.6, 2.2, 4.1, 9.7], [17.2, 12.4, 38.6, 88.1], [27.5, 24.8, 39.9, 51.0, 15.4, 8.8]),
		row("google/gemini-3.5-pro", 98, [0, 0, 0], [3.4, 2.9, 6.2, 14.8], [22.9, 16.3, 51.7, 96.4], [20.1, 18.2, 30.7, 42.3, 11.6, 6.1]),
		row("moonshot/kimi-k3", 44, [2, 0, 0], [1.5, 1.4, 2.3, 5.2], [31.8, 24.6, 71.2, 133], [13.9, 12.5, 21.4, 29.8, 7.7, 4.3]),
	],
};
/** The same models over a day: 35,704 requests. */
const PERF_DAY_COUNTS: readonly [number, [number, number, number]][] = [
	[164, [0, 0, 0]],
	[5310, [0, 0, 0]],
	[4790, [0, 0, 41]],
	[18402, [0, 12, 27]],
	[3050, [0, 0, 0]],
	[2060, [3, 0, 0]],
	[1210, [0, 0, 0]],
	[630, [5, 0, 0]],
];
const PERF_DAY: WindowSummary = {
	label: "24 hours",
	breakdown: "model",
	models: PERF_HOUR.models.map((model, index) => {
		const [responses, [aborted, timeout, error]] = PERF_DAY_COUNTS[index]!;
		return { ...model, responses, failures: { aborted, timeout, error } };
	}),
};
const PERF_WEEK: WindowSummary = { label: "Week", breakdown: "model", models: [] };

/** Each model split over two efforts; the first keeps the failures. */
function byEffort(summary: WindowSummary): WindowSummary {
	return {
		...summary,
		breakdown: "effort",
		models: summary.models.flatMap((model) => [
			{ ...model, effort: "medium", responses: Math.ceil(model.responses / 2) },
			{ ...model, effort: UNRECORDED_EFFORT, responses: Math.floor(model.responses / 2), failures: { aborted: 0, timeout: 0, error: 0 } },
		]),
	};
}

const PERF: BreakdownSummaries = {
	model: [PERF_HOUR, PERF_DAY, PERF_WEEK],
	effort: [byEffort(PERF_HOUR), byEffort(PERF_DAY), byEffort(PERF_WEEK)],
};

/** The pane as opened: first period, by model, columns chosen by width, default sort, nothing scrolled. */
const OPENED: StatsViewState = { period: 0, breakdown: "model", columnChoice: undefined, sort: DEFAULT_SORT, scrollTop: 0, budget: 40 };

function screenAt(width: number, state: Partial<StatsViewState> = {}, theme: UiTheme = PLAIN_THEME): StatsScreen {
	return renderStatsScreen(theme, width, PERF, { ...OPENED, ...state });
}

/** Screen lines without the trailing padding of zebra stripes and header cells. */
function plainLines(width: number, state: Partial<StatsViewState> = {}): string[] {
	return screenAt(width, state).lines.map((line) => line.trimEnd());
}

/** The table's lines: everything between the title and the closing rule. */
function bodyLines(width: number, state: Partial<StatsViewState> = {}): string[] {
	const lines = plainLines(width, state);
	return lines.slice(1, lines.findIndex((line) => /^─+$/.test(line)));
}

/** The line fits `width` terminal cells: the kit's visibleWidth-based `fit` pads it and does not cut it. */
function fits(line: string, width: number): boolean {
	return fit(line, width).startsWith(line);
}

const SCREEN_WIDTHS = [60, 80, 100, 120, 170] as const;

test("the screen shows one period under tabs, the active one highlighted", () => {
	const title = plainLines(120)[0]!;
	assert.match(title, /^── Model performance {3}Last hour {3}24 hours {3}Week {2}─+ /);
	const body = bodyLines(120);
	// One table: one header rule, the eight models of the period, nothing of the other periods.
	assert.equal(body.filter((line) => line.includes("┼")).length, 1);
	assert.equal(body.length, 3 + 8);
	const screen = screenAt(120);
	assert.deepEqual(screen.tabSpans.map((span) => screen.lines[0]!.slice(span.start, span.end)), [" Last hour ", " 24 hours ", " Week "]);
	// The tag theme's markers take columns, so its title needs the room.
	assert.match(screenAt(ROOMY, {}, TAG_THEME).lines[0]!, /<selectedBg><text> Last hour <\/text><\/selectedBg> <muted> 24 hours <\/muted> <muted> Week <\/muted>/);
	assert.match(screenAt(ROOMY, { period: 1 }, TAG_THEME).lines[0]!, /<muted> Last hour <\/muted> <selectedBg><text> 24 hours <\/text><\/selectedBg>/);
	// The second tab shows the day's rows, not the hour's.
	assert.match(bodyLines(120, { period: 1 }).join("\n"), /18,402/);
	assert.doesNotMatch(body.join("\n"), /18,402/);
});

test("the title names models, grouped request counts and the sort, then the scroll position", () => {
	assert.match(plainLines(120)[0]!, /─ 8 models · 2,495 requests · sort tok\/s p50 ↓ ──$/);
	assert.match(plainLines(170, { period: 1 })[0]!, /─ 8 models · 35,704 requests · sort tok\/s p50 ↓ ──$/);
	assert.match(plainLines(120, { sort: { id: "ttft-p90", descending: false } })[0]!, / · sort ttft p90 ↑ ──$/);
	assert.match(plainLines(120, { sort: { id: "n", descending: true } })[0]!, / · sort n ↓ ──$/);
	// 3 header lines and 8 rows in a 5-line viewport.
	const scrolled = screenAt(170, { budget: 5 });
	assert.match(scrolled.lines[0]!, /─ 8 models · 2,495 requests · sort tok\/s p50 ↓ · lines 1–5 of 11 ↓ ──$/);
	assert.equal(scrolled.lineCount, 11);
	assert.equal(scrolled.lines.length, 1 + 5 + 2);
	const bottom = screenAt(170, { budget: 5, scrollTop: 99 });
	assert.equal(bottom.scrollTop, 6);
	assert.match(bottom.lines[0]!, / · ↑ lines 7–11 of 11 ──$/);
	const single: BreakdownSummaries = { ...PERF, model: [{ ...PERF_HOUR, models: [{ ...PERF_HOUR.models[0]!, responses: 1 }] }, PERF_DAY, PERF_WEEK] };
	assert.match(renderStatsScreen(PLAIN_THEME, 120, single, OPENED).lines[0]!, /─ 1 model · 1 request · sort /);
});

test("the title drops facts from the left before it cuts a tab; the scroll position goes last", () => {
	for (const width of SCREEN_WIDTHS) {
		for (const budget of [40, 5]) assert.equal(screenAt(width, { budget }).tabSpans.length, 3, `tabs whole at ${width}, budget ${budget}`);
	}
	assert.match(plainLines(100)[0]!, /Week {2}─+ 2,495 requests · sort tok\/s p50 ↓ ──$/);
	assert.match(plainLines(80)[0]!, /Week {2}─+ sort tok\/s p50 ↓ ──$/);
	assert.match(plainLines(80, { budget: 5 })[0]!, /Week {2}─+ lines 1–5 of \d+ ↓ ──$/);
	assert.match(plainLines(60)[0]!, /Week {2}─+$/);
});

test("default view at 120 columns: the compact columns, every model name whole", () => {
	assert.deepEqual(plainLines(120), [
		"── Model performance   Last hour   24 hours   Week  ──────────────────── 8 models · 2,495 requests · sort tok/s p50 ↓ ──",
		"                                            │       │             │ ttft s         │ total s          │ tok/s ↓",
		"model                                       │     n │        fail │ p50  p90   p99 │  p50   p90   p99 │  p50   p90   p10",
		"────────────────────────────────────────────┼───────┼─────────────┼────────────────┼──────────────────┼─────────────────",
		"novita/deepseek-ai/DeepSeek-V4.1-Flash-1017 │    11 │           · │ 0.9  1.2   1.8 │  2.4   6.1   7.5 │  236   386   160",
		"ai-gateway-anthropic/claude-sonnet-5-5      │   368 │           · │ 1.2  1.8   3.3 │  4.3  13.5  56.3 │  145   188   119",
		"ai-gateway-anthropic/claude-fable-5-2       │   331 │       3 err │ 1.5  2.6  11.0 │  8.0  31.0   127 │  115   151  95.3",
		"openai-codex/gpt-6.1-sol                    │ 1,280 │ 2 err 1 t/o │ 1.7  4.7   6.8 │ 18.1  66.3   149 │ 35.4  48.1  19.8",
		"xai/grok-5-fast                             │   212 │           · │ 0.7  1.1   2.4 │  6.9  19.8  41.4 │ 31.0  44.6  21.3",
		"zai/glm-6                                   │   143 │           · │ 2.2  4.1   9.7 │ 12.4  38.6  88.1 │ 24.8  39.9  15.4",
		"google/gemini-3.5-pro                       │    98 │           · │ 2.9  6.2  14.8 │ 16.3  51.7  96.4 │ 18.2  30.7  11.6",
		"moonshot/kimi-k3                            │    44 │      2 abrt │ 1.4  2.3   5.2 │ 24.6  71.2   133 │ 12.5  21.4   7.7",
		"─".repeat(120),
		"tab period  s sort  r reverse  e split by effort  a all columns  ↑↓ scroll  PgUp/PgDn page  + − height  esc close",
	]);
});

const COMPACT_LABELS = /^model +│ +n │ +fail │ p50 +p90 +p99 │ +p50 +p90 +p99 │ +p50 +p90 +p10$/;
const FULL_LABELS = /^model +│ +n │ +abrt │ +tout │ +err │ mean +p50 +p90 +p99 │ mean +p50 +p90 +p99 │ mean +p50 +p90 +p99 +p10 +p1$/;

test("two column sets: full when the full table fits at the natural model width, compact otherwise", () => {
	assert.match(bodyLines(170)[1]!, FULL_LABELS);
	assert.match(bodyLines(170)[3]!, new RegExp(`^${DEEPSEEK} │ +11 │ +· │ +· │ +· │ +1\\.0 +0\\.9 +1\\.2 +1\\.8 │ +3\\.3 +2\\.4 +6\\.1 +7\\.5 │ +263 +236 +386 +447 +160 +109$`));
	assert.match(plainLines(170).at(-1)!, / a fewer columns /);
	assert.match(bodyLines(120)[1]!, COMPACT_LABELS);
	assert.match(plainLines(120).at(-1)!, / a all columns /);
});

test("the user's column set holds at any width", () => {
	assert.match(bodyLines(120, { columnChoice: "full" })[1]!, /│ +abrt │ +tout │ +err │/);
	assert.match(plainLines(120, { columnChoice: "full" }).at(-1)!, / a fewer columns /);
	assert.match(bodyLines(170, { columnChoice: "compact" })[1]!, COMPACT_LABELS);
	assert.match(plainLines(170, { columnChoice: "compact" }).at(-1)!, / a all columns /);
});

test("fail column: a dim dot, or the non-zero err, t/o and abrt parts in that order and colour", () => {
	const tagged = screenAt(170, { columnChoice: "compact" }, TAG_THEME).lines;
	const failCell = (key: string): string => tagged.find((line) => line.includes(key))!.split("<dim> │ </dim>")[2]!;
	assert.match(failCell(DEEPSEEK), /^<dim> +·<\/dim>$/);
	assert.match(failCell("claude-fable"), /^ +<error>3 err<\/error>$/);
	assert.equal(failCell("gpt-6.1-sol"), "<error>2 err</error> <warning>1 t/o</warning>");
	assert.match(failCell("kimi-k3"), /^ +<muted>2 abrt<\/muted>$/);
	// All three kinds, counts grouped; the column is as wide as its widest cell.
	const day = bodyLines(120, { period: 1 });
	assert.match(day.find((line) => line.includes("gpt-6.1-sol"))!, /│ 18,402 │ 27 err 12 t\/o │/);
	assert.match(day.find((line) => line.includes("kimi-k3"))!, /│ +630 │ +5 abrt │/);
	const every: BreakdownSummaries = {
		...PERF,
		model: [{ ...PERF_HOUR, models: [{ ...PERF_HOUR.models[0]!, failures: { aborted: 4, timeout: 1, error: 1024 } }] }, PERF_DAY, PERF_WEEK],
	};
	assert.match(renderStatsScreen(PLAIN_THEME, 120, every, OPENED).lines[4]!, /│ 1,024 err 1 t\/o 4 abrt │/);
});

/** Table cells of a body line; the model cell first. */
function cellsOf(line: string): string[] {
	return line.split(" │ ");
}

test("the model column keeps its natural width, then shortens to 24 cells before a metric group is dropped", () => {
	// Natural: the longest name of the period, whole.
	assert.equal(cellsOf(bodyLines(120)[3]!)[0], DEEPSEEK);
	assert.ok(bodyLines(120).every((line) => !line.startsWith("hidden")));
	// 19 columns short: names shorten in the middle, every group stays.
	const shortened = bodyLines(101);
	assert.match(shortened[1]!, COMPACT_LABELS);
	assert.ok(shortened.every((line) => !line.startsWith("hidden")));
	assert.deepEqual(shortened.slice(3).map((line) => cellsOf(line)[0]), [
		"novita/…-V4.1-Flash-1017",
		"ai-gateway-…e-sonnet-5-5",
		"ai-gateway-…de-fable-5-2",
		"openai-codex/gpt-6.1-sol",
		"xai/grok-5-fast         ",
		"zai/glm-6               ",
		"google/gemini-3.5-pro   ",
		"moonshot/kimi-k3        ",
	]);
	// One column less: the name would fall under 24 cells, so total s goes and the name gets the room.
	const withoutTotal = bodyLines(100);
	assert.match(withoutTotal[1]!, /^model +│ +n │ +fail │ p50 +p90 +p99 │ +p50 +p90 +p10$/);
	assert.equal(withoutTotal.at(-1), "hidden at this width: total s");
	assert.equal(cellsOf(withoutTotal[3]!)[0], "novita/…/DeepSeek-V4.1-Flash-1017     ");
	assert.equal(cellsOf(withoutTotal[4]!)[0], SONNET_5);
	// Then ttft s; n, fail and tok/s stay.
	const withoutTimings = bodyLines(80);
	assert.match(withoutTimings[1]!, /^model +│ +n │ +fail │ +p50 +p90 +p10$/);
	assert.equal(withoutTimings.at(-1), "hidden at this width: ttft s, total s");
	assert.equal(cellsOf(withoutTimings[3]!)[0], "novita/…/DeepSeek-V4.1-Flash-1017     ");
	// Nothing left to drop: the name takes what remains.
	const narrowest = bodyLines(60);
	assert.match(narrowest[1]!, /^model +│ +n │ +fail │ +p50 +p90 +p10$/);
	assert.equal(cellsOf(narrowest[3]!)[0], "novita/…-Flash-1017");
	assert.equal(cellsOf(narrowest[4]!)[0], "ai-gatewa…onnet-5-5");
	assert.equal(screenAt(60, {}, TAG_THEME).lines.find((line) => line.includes("hidden")), "<dim>hidden at this width: ttft s, total s</dim>");
});

test("every screen line fits 60, 80, 100, 120 and 170 columns and no cell is clipped", () => {
	for (const width of SCREEN_WIDTHS) {
		for (const breakdown of ["model", "effort"] as const) {
			for (const columnChoice of [undefined, "compact", "full"] as const) {
				for (const period of [0, 1, 2]) {
					const state = { breakdown, columnChoice, period };
					const where = `${width} columns, by ${breakdown}, ${columnChoice ?? "automatic"} columns, period ${period}`;
					const screen = screenAt(width, state);
					for (const line of screen.lines) assert.ok(fits(line, width), `${where}: ${JSON.stringify(line)}`);
					for (const line of bodyLines(width, state).filter((bodyLine) => bodyLine.includes("│"))) {
						const [model, ...cells] = cellsOf(line) as [string, ...string[]];
						assert.ok(!model.trimEnd().endsWith("…"), `${where}: model clipped in ${JSON.stringify(line)}`);
						assert.ok(cells.every((cell) => !cell.includes("…")), `${where}: cell clipped in ${JSON.stringify(line)}`);
					}
				}
			}
		}
	}
});

test("the effort column keeps its natural width when the model column shortens", () => {
	const body = bodyLines(100, { breakdown: "effort" });
	assert.match(body[1]!, /^model +│ effort │ +n │ +fail │/);
	assert.match(body[3]!, /^novita\/…\/DeepSeek-V4\.1-Flash-1017 +│ medium │ +6 │/);
	assert.match(body[4]!, /^novita\/…\/DeepSeek-V4\.1-Flash-1017 +│ \? +│ +5 │/);
	assert.match(plainLines(100, { breakdown: "effort" })[0]!, / sort tok\/s p50 ↓ ──$/);
	// Models, not effort rows.
	assert.match(plainLines(170, { breakdown: "effort" })[0]!, / 8 models · 2,495 requests · /);
});

test("a sort outside the column set falls back to the default; the title names the sort shown", () => {
	const firstModel = (state: Partial<StatsViewState>): string => cellsOf(bodyLines(170, state)[3]!)[0]!.trimEnd();
	const fastestMean: SortOrder = { id: "tps-mean", descending: false };
	assert.match(plainLines(170, { sort: fastestMean })[0]!, / · sort tok\/s mean ↑ ──$/);
	assert.equal(firstModel({ sort: fastestMean }), "moonshot/kimi-k3");
	// Compact has no mean column: the default sort, direction included.
	assert.match(plainLines(170, { sort: fastestMean, columnChoice: "compact" })[0]!, / · sort tok\/s p50 ↓ ──$/);
	assert.equal(firstModel({ sort: fastestMean, columnChoice: "compact" }), DEEPSEEK);
	// A column both sets have survives the switch: slowest total p90 first.
	const byTotal: SortOrder = { id: "total-p90", descending: true };
	for (const columnChoice of ["compact", "full"] as const) {
		assert.match(plainLines(170, { sort: byTotal, columnChoice })[0]!, / · sort total p90 ↓ ──$/);
		assert.equal(firstModel({ sort: byTotal, columnChoice }), "moonshot/kimi-k3");
	}
	// The marker stays on the sorted group's header.
	assert.match(bodyLines(170, { sort: byTotal, columnChoice: "compact" })[0]!, /│ ttft s +│ total s ↓ +│ tok\/s$/);
});

test("key hints name what each key does next; q and j/k are not advertised", () => {
	const hints = (state: Partial<StatsViewState>): string => plainLines(170, state).at(-1)!;
	assert.equal(hints({ columnChoice: "compact" }), "tab period  s sort  r reverse  e split by effort  a all columns  ↑↓ scroll  PgUp/PgDn page  + − height  esc close");
	assert.equal(hints({ columnChoice: "full", breakdown: "effort" }), "tab period  s sort  r reverse  e merge efforts  a fewer columns  ↑↓ scroll  PgUp/PgDn page  + − height  esc close");
});

test("an empty period says so in place of the table", () => {
	assert.deepEqual(bodyLines(120, { period: 2 }), ["No requests in this period."]);
	assert.match(plainLines(120, { period: 2 })[0]!, /Week {2}─+ sort tok\/s p50 ↓ ──$/);
	assert.equal(screenAt(120, { period: 2 }, TAG_THEME).lines[1], "<muted>No requests in this period.</muted>");
	assert.deepEqual(bodyLines(60, { period: 2, breakdown: "effort" }), ["No requests in this period."]);
});

test("the default sort is median tok/s, fastest first; the sort keys are the column set's columns", () => {
	assert.deepEqual(DEFAULT_SORT, { id: "tps-p50", descending: true });
	assert.deepEqual(
		sortKeys("compact").map((key) => `${key.label} ${key.descending ? "↓" : "↑"}`),
		["model ↑", "n ↓", "fail ↓", "ttft p50 ↑", "ttft p90 ↑", "ttft p99 ↑", "total p50 ↑", "total p90 ↑", "total p99 ↑", "tok/s p50 ↓", "tok/s p90 ↓", "tok/s p10 ↓"],
	);
	assert.deepEqual(
		sortKeys("full").map((key) => key.id),
		[
			"model", "n", "aborted", "timeout", "error",
			"ttft-mean", "ttft-p50", "ttft-p90", "ttft-p99",
			"total-mean", "total-p50", "total-p90", "total-p99",
			"tps-mean", "tps-p50", "tps-p90", "tps-p99", "tps-p10", "tps-p1",
		],
	);
	assert.deepEqual(sortKeys("full").filter((key) => ["aborted", "timeout", "error"].includes(key.id)).map((key) => key.label), ["abrt", "tout", "err"]);
	for (const columns of ["compact", "full"] as const) {
		for (const key of sortKeys(columns)) assert.deepEqual(shownSort({ id: key.id, descending: false }, columns), { id: key.id, descending: false });
	}
	// Columns only one set has fall back to the default in the other.
	for (const id of ["tps-mean", "tps-p99", "tps-p1", "ttft-mean", "aborted"] as const) assert.deepEqual(shownSort({ id, descending: false }, "compact"), DEFAULT_SORT);
	assert.deepEqual(shownSort({ id: "fail", descending: true }, "full"), DEFAULT_SORT);
});

test("sortModels orders by any column: a percentile, total failures, one failure kind", () => {
	const keysBy = (id: SortOrder["id"], descending: boolean): string[] => sortModels(PERF_HOUR.models, id, descending).map((model) => model.key.split("/").at(-1)!);
	assert.deepEqual(keysBy("ttft-p99", false).slice(0, 3), ["DeepSeek-V4.1-Flash-1017", "grok-5-fast", "claude-sonnet-5-5"]);
	assert.deepEqual(keysBy("fail", true).slice(0, 3), ["claude-fable-5-2", "gpt-6.1-sol", "kimi-k3"]);
	assert.deepEqual(keysBy("timeout", true)[0], "gpt-6.1-sol");
	assert.deepEqual(keysBy("tps-p10", false)[0], "kimi-k3");
});

test("shortenModelLabel keeps the provider and the last path segment, then both ends of the label", () => {
	assert.equal(shortenModelLabel(DEEPSEEK, DEEPSEEK.length), DEEPSEEK);
	assert.equal(shortenModelLabel(DEEPSEEK, DEEPSEEK.length - 1), "novita/…/DeepSeek-V4.1-Flash-1017");
	assert.equal(shortenModelLabel(DEEPSEEK, 33), "novita/…/DeepSeek-V4.1-Flash-1017");
	// Tighter: the provider, then as much of the end as fits.
	assert.equal(shortenModelLabel(DEEPSEEK, 32), "novita/…DeepSeek-V4.1-Flash-1017");
	assert.equal(shortenModelLabel(DEEPSEEK, MIN_MODEL_WIDTH), "novita/…-V4.1-Flash-1017");
	assert.equal(shortenModelLabel(DEEPSEEK, 12), "novit…h-1017");
	// No middle segment to leave out: half each, the end keeps the odd column.
	assert.equal(shortenModelLabel(SONNET_5, SONNET_5.length), SONNET_5);
	assert.equal(shortenModelLabel(SONNET_5, MIN_MODEL_WIDTH), "ai-gateway-…e-sonnet-5-5");
	assert.equal(shortenModelLabel("ai-gateway-anthropic/us-east/claude-sonnet-5-5", MIN_MODEL_WIDTH), "ai-gateway-…e-sonnet-5-5");
	for (let width = 7; width < DEEPSEEK.length; width++) {
		for (const key of [DEEPSEEK, SONNET_5]) {
			const label = shortenModelLabel(key, width);
			assert.ok(visibleWidth(label) <= width, `${label} in ${width}`);
			assert.ok(key.length <= width || /^[^…]+…[^…]+$/.test(label), `${label}: the … is in the middle`);
		}
	}
});

test("layoutWindow narrows in order: model labels to 24, total s, ttft s, then the labels again", () => {
	const shape = (width: number): [number, string[], string[]] => {
		const layout = layoutAt(PERF_HOUR, "compact", width);
		return [layout.modelWidth, layout.groups.map((group) => group.title), layout.hidden];
	};
	const all = ["ttft s", "total s", "tok/s"];
	assert.deepEqual(shape(ROOMY), [DEEPSEEK.length, all, []]);
	assert.deepEqual(shape(120), [DEEPSEEK.length, all, []]);
	// Shortened by whole segments, the column is as wide as the longest label left.
	assert.deepEqual(shape(119), [SONNET_5.length, all, []]);
	assert.deepEqual(shape(101), [MIN_MODEL_WIDTH, all, []]);
	assert.deepEqual(shape(100), [SONNET_5.length, ["ttft s", "tok/s"], ["total s"]]);
	assert.deepEqual(shape(82), [MIN_MODEL_WIDTH, ["ttft s", "tok/s"], ["total s"]]);
	assert.deepEqual(shape(81), [SONNET_5.length, ["tok/s"], ["ttft s", "total s"]]);
	assert.deepEqual(shape(65), [MIN_MODEL_WIDTH, ["tok/s"], ["ttft s", "total s"]]);
	// n, fail and tok/s are never dropped: the labels give way, down to the column's header.
	assert.deepEqual(shape(64), [MIN_MODEL_WIDTH - 1, ["tok/s"], ["ttft s", "total s"]]);
	assert.deepEqual(shape(48), ["model ↓".length, ["tok/s"], ["ttft s", "total s"]]);
	assert.deepEqual(layoutWindow(PERF_HOUR, "compact", 47), { kind: "too-narrow", needs: 48 });
	// Names under the minimum are never shortened to keep a group.
	const short: WindowSummary = { ...PERF_HOUR, models: PERF_HOUR.models.filter((model) => model.key.length < MIN_MODEL_WIDTH) };
	const natural = layoutAt(short, "compact", ROOMY);
	const narrowed = layoutAt(short, "compact", 60);
	assert.equal(narrowed.modelWidth, natural.modelWidth);
	assert.deepEqual(narrowed.hidden, ["ttft s", "total s"]);
});

test("a pane too narrow for the columns that always stay says what the table needs", () => {
	assert.deepEqual(bodyLines(47), ["Too narrow: the table needs 48 columns."]);
	const full = layoutWindow(PERF_HOUR, "full", 60);
	assert.equal(full.kind, "too-narrow");
	assert.deepEqual(bodyLines(60, { columnChoice: "full" }), [`Too narrow: the table needs ${(full as Extract<typeof full, { kind: "too-narrow" }>).needs} columns.`]);
	for (const line of screenAt(30).lines) assert.ok(fits(line, 30), JSON.stringify(line));
});

test("shownColumns follows the width until the user chooses; every period has to fit", () => {
	const fullWidth = (summary: WindowSummary): number => visibleWidth(fullTable(summary, PLAIN_THEME, DEFAULT_SORT).header[2]!);
	assert.equal(shownColumns(undefined, [PERF_HOUR], fullWidth(PERF_HOUR)), "full");
	assert.equal(shownColumns(undefined, [PERF_HOUR], fullWidth(PERF_HOUR) - 1), "compact");
	assert.equal(shownColumns("full", [PERF_HOUR], 60), "full");
	assert.equal(shownColumns("compact", [PERF_HOUR], ROOMY), "compact");
	// The day's counts are a digit longer: its table decides, whichever tab is open.
	assert.equal(fullWidth(PERF_DAY), fullWidth(PERF_HOUR) + 1);
	assert.equal(shownColumns(undefined, [PERF_HOUR, PERF_DAY, PERF_WEEK], fullWidth(PERF_HOUR)), "compact");
	assert.equal(shownColumns(undefined, [PERF_HOUR, PERF_DAY, PERF_WEEK], fullWidth(PERF_DAY)), "full");
	for (const period of [0, 1, 2]) {
		assert.match(plainLines(fullWidth(PERF_HOUR), { period }).at(-1)!, / a all columns /);
		assert.match(plainLines(fullWidth(PERF_DAY), { period }).at(-1)!, / a fewer columns /);
	}
});

test("the period tabs are the reporting windows", () => {
	assert.deepEqual(WINDOWS.map((window) => window.label), ["Last hour", "24 hours", "Week"]);
	assert.deepEqual(summarize([], NOW, "model").map((summary) => summary.label), ["Last hour", "24 hours", "Week"]);
});
