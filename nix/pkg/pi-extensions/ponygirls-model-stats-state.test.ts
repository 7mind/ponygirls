import assert from "node:assert/strict";
import test from "node:test";

import { PLAIN_THEME, type UiTheme } from "@ponygirls/pi-ui";

import {
	classifyOutcome,
	clampStatsBudget,
	clampStatsScrollTop,
	DAY_MS,
	defaultStatsBudget,
	HOUR_MS,
	isUsableRecord,
	measureWindows,
	parseStatsLine,
	percentile,
	pruneRecords,
	renderWindow,
	serializeStatsRecord,
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
	windowTitle,
	type MetricStats,
	type ModelWindowStats,
	type ResponseSample,
	type SortOrder,
	type StatsRecord,
	type WindowSummary,
	UNRECORDED_EFFORT,
	compareEfforts,
} from "./ponygirls-model-stats-state.ts";
import { scrollPosition } from "./scroll-state.ts";

/** The view's default sort: mean tok/s, fastest first. */
const DEFAULT_SORT: SortOrder = { id: "tps-mean", descending: true };

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

test("sortModels defaults to mean tok/s and keeps models without a rate last", () => {
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
	const table = renderWindow(HOUR, PLAIN_THEME, DEFAULT_SORT);
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
	assert.match(lines[4]!, /^openai\/gpt-5 +│ +0 │ +1 │ +· │ +3 │/);
	assert.match(lines[4]!, /│ +-/);
	const rowBars = barsAt(lines[3]!);
	// One bar per top-level column boundary: model, n, abrt, tout, err, ttft, total | tok/s.
	assert.equal(rowBars.length, 7);
	assert.ok(barsAt(lines[0]!).every((index) => rowBars.includes(index)));
	assert.deepEqual(barsAt(lines[1]!), rowBars);
	assert.deepEqual(barsAt(lines[4]!), rowBars);
	assert.deepEqual(junctionsAt(lines[2]!), rowBars);
	assert.deepEqual(renderWindow({ label: "Last hour", breakdown: "model", models: [] }, PLAIN_THEME, DEFAULT_SORT), {
		header: ["(no samples)"],
		rows: [],
	});
});

test("renderWindow lines share one visible width", () => {
	const table = renderWindow(HOUR, PLAIN_THEME, DEFAULT_SORT);
	const widths = [...table.header, ...table.rows].map((line) => visibleWidth(line));
	assert.ok(widths.every((width) => width === widths[0]), `widths ${widths.join(",")}`);
	// A narrower width shrinks the model column only, down to the requested width.
	const narrow = renderWindow(HOUR, PLAIN_THEME, DEFAULT_SORT, { width: widths[0]! - 10 });
	for (const line of [...narrow.header, ...narrow.rows]) assert.equal(visibleWidth(line), widths[0]! - 10);
	assert.match(narrow.rows[0]!, /^anthropic\/cl… │/);
});

test("renderWindow styles the grid dim and failure counts by kind", () => {
	const table = renderWindow(HOUR, TAG_THEME, DEFAULT_SORT);
	for (const line of [...table.header, ...table.rows]) {
		assert.doesNotMatch(line.replaceAll("<dim> │ </dim>", ""), /│/, "every │ is dim");
	}
	assert.match(table.header[2]!, /^<dim>─+┼/);
	const [sonnet, gpt5] = table.rows as [string, string];
	// Zero is a dim dot; abrt/tout warn and err errors when positive.
	assert.match(sonnet, /<dim> │ <\/dim><dim> {3}·<\/dim><dim> │ <\/dim><warning> {3}1<\/warning><dim> │ <\/dim><dim> {2}·<\/dim>/);
	assert.match(gpt5, /<warning> {3}1<\/warning><dim> │ <\/dim><dim> {3}·<\/dim><dim> │ <\/dim><error> {2}3<\/error>/);
	// Header labels are dim.
	assert.match(table.header[0]!, /<dim>abrt<\/dim>/);
	assert.match(table.header[1]!, /<dim>model {2,}<\/dim>/);
});

test("renderWindow marks the sorted column: accent header with arrow, bold values", () => {
	const byMean = renderWindow(HOUR, TAG_THEME, DEFAULT_SORT);
	assert.match(byMean.header[0]!, /<b><accent>tok\/s ↓ *<\/accent><\/b>/);
	assert.match(byMean.header[1]!, /<b><accent>mean<\/accent><\/b>/);
	assert.equal(byMean.header[1]!.split("<accent>").length - 1, 1, "only the sorted label is accent");
	assert.match(byMean.rows[0]!, /<b> *105<\/b>/);
	assert.equal(byMean.rows[0]!.split("<b>").length - 1, 1, "only the sorted cell is bold");

	const byTtft = renderWindow(HOUR, TAG_THEME, { id: "ttft-mean", descending: false });
	assert.match(byTtft.header[0]!, /<b><accent>ttft s ↑ *<\/accent><\/b>/);
	assert.match(byTtft.header[0]!, /<dim>tok\/s *<\/dim>/);
	assert.match(byTtft.rows[0]!, /<b> *0\.5<\/b>/);

	const byN = renderWindow(HOUR, TAG_THEME, { id: "n", descending: true });
	assert.match(byN.header[0]!, /<b><accent>n ↓<\/accent><\/b>/);
	assert.match(byN.rows[0]!, /<dim> │ <\/dim><b> +2<\/b><dim> │ <\/dim>/);

	const byModel = renderWindow(HOUR, TAG_THEME, { id: "model", descending: false });
	assert.match(byModel.header[1]!, /^<b><accent>model ↑ *<\/accent><\/b>/);
	assert.match(byModel.rows[0]!, /^<b>anthropic\/claude-sonnet<\/b>/);

	// The arrow is reserved in every layout: a sort change never moves a column.
	const plainBars = (sort: SortOrder) => renderWindow(HOUR, PLAIN_THEME, sort).rows.map(barsAt);
	assert.deepEqual(plainBars({ id: "n", descending: true }), plainBars(DEFAULT_SORT));
	assert.deepEqual(plainBars({ id: "model", descending: false }), plainBars(DEFAULT_SORT));
});

test("windowTitle is the bold label with a dim model and request summary", () => {
	assert.equal(windowTitle(TAG_THEME, HOUR), "<b><text>Last hour</text></b><dim> · 2 models · 7 requests</dim>");
	assert.equal(windowTitle(PLAIN_THEME, { label: "Last week", breakdown: "model", models: [SONNET] }), "Last week · 1 model · 3 requests");
	assert.equal(windowTitle(PLAIN_THEME, { label: "Last week", breakdown: "model", models: [] }), "Last week");
});

test("renderWindow sizes each column to its content so percentiles stay separate", () => {
	const table = renderWindow(
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
		DEFAULT_SORT,
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

test("renderWindow with a shared layout aligns columns across windows", () => {
	const short = {
		key: "a/b",
		responses: 1,
		failures: { aborted: 0, timeout: 0, error: 0 },
		tps: metric({ mean: 100, p50: 100, p90: 100, p99: 100, p10: 50, p1: 10 }),
	};
	const long = {
		key: "a-much-longer-model-name/c",
		responses: 200,
		failures: { aborted: 0, timeout: 3, error: 0 },
		tps: metric({ mean: 90 }),
	};
	const hour: WindowSummary = { label: "Last hour", breakdown: "model", models: [short] };
	const week: WindowSummary = { label: "Last week", breakdown: "model", models: [short, long] };
	const layout = measureWindows([hour, week]);
	const hourTable = renderWindow(hour, PLAIN_THEME, DEFAULT_SORT, { layout });
	const weekTable = renderWindow(week, PLAIN_THEME, DEFAULT_SORT, { layout });
	// Same column boundaries in both sections ...
	assert.deepEqual(barsAt(hourTable.rows[0]!), barsAt(weekTable.rows[0]!));
	assert.deepEqual(barsAt(hourTable.header[0]!), barsAt(weekTable.header[0]!));
	assert.equal(hourTable.header[2], weekTable.header[2]);
	// ... and the hour's short name is padded to the shared model width.
	assert.match(hourTable.rows[0]!, /^a\/b +│/);
	// Measured alone, the hour table would be narrower.
	assert.notDeepEqual(barsAt(renderWindow(hour, PLAIN_THEME, DEFAULT_SORT).rows[0]!), barsAt(hourTable.rows[0]!));
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
	const table = renderWindow(HOUR_BY_EFFORT, PLAIN_THEME, DEFAULT_SORT);
	const lines = [...table.header, ...table.rows];
	assert.equal(lines.length, 6);
	assert.match(lines[1]!, /^model +│ effort │ /);
	assert.match(lines[3]!, /^anthropic\/claude-sonnet │ medium │ +2 │/);
	assert.match(lines[4]!, /^anthropic\/claude-sonnet │ \? +│ +1 │/);
	assert.match(lines[5]!, /^openai\/gpt-5 +│ xhigh +│ +0 │/);
	const rowBars = barsAt(lines[3]!);
	// The model-breakdown bars plus one for the effort column.
	assert.equal(rowBars.length, 8);
	assert.ok(barsAt(lines[0]!).every((index) => rowBars.includes(index)));
	assert.deepEqual(barsAt(lines[1]!), rowBars);
	assert.deepEqual(junctionsAt(lines[2]!), rowBars);
	const widths = lines.map(visibleWidth);
	assert.ok(widths.every((width) => width === widths[0]), `widths ${widths.join(",")}`);
	// A narrower width still shrinks only the model column.
	const narrow = renderWindow(HOUR_BY_EFFORT, PLAIN_THEME, DEFAULT_SORT, { width: widths[0]! - 10 });
	for (const line of [...narrow.header, ...narrow.rows]) assert.equal(visibleWidth(line), widths[0]! - 10);
	assert.match(narrow.rows[0]!, /^anthropic\/cl… │ medium │/);

	const tagged = renderWindow(HOUR_BY_EFFORT, TAG_THEME, DEFAULT_SORT);
	assert.match(tagged.header[1]!, /<dim>effort<\/dim>/);
	assert.match(tagged.rows[0]!, /<dim> │ <\/dim>medium<dim> │ <\/dim>/);
	assert.match(tagged.rows[1]!, /<dim> │ <\/dim><dim>\? +<\/dim><dim> │ <\/dim>/);
});

test("windows by effort share a layout; breakdowns never mix", () => {
	const week: WindowSummary = { ...HOUR_BY_EFFORT, label: "Last week", models: [{ ...GPT5, key: "a/b", effort: "minimal" }] };
	const layout = measureWindows([HOUR_BY_EFFORT, week]);
	assert.equal(layout.effortWidth, "minimal".length);
	assert.deepEqual(
		barsAt(renderWindow(HOUR_BY_EFFORT, PLAIN_THEME, DEFAULT_SORT, { layout }).rows[0]!),
		barsAt(renderWindow(week, PLAIN_THEME, DEFAULT_SORT, { layout }).rows[0]!),
	);
	assert.equal(measureWindows([HOUR]).effortWidth, undefined);
	assert.throws(() => measureWindows([HOUR, HOUR_BY_EFFORT]), /different breakdowns/);
	assert.throws(() => renderWindow(HOUR, PLAIN_THEME, DEFAULT_SORT, { layout }), /needs a layout/);
	assert.throws(() => renderWindow({ ...HOUR, breakdown: "effort" }, PLAIN_THEME, DEFAULT_SORT), /has no effort/);
});

test("windowTitle counts distinct models, not effort rows", () => {
	assert.equal(windowTitle(PLAIN_THEME, HOUR_BY_EFFORT), "Last hour · 2 models · 9 requests");
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
