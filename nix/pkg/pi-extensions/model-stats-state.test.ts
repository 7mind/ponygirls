import assert from "node:assert/strict";
import test from "node:test";

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
	type MetricStats,
	type ResponseSample,
	type StatsRecord,
} from "./model-stats-state.ts";

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
	const [hour] = summarize([dumped, sample()], NOW);
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
	const [hour, day, week] = summarize(records, NOW) as [
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

test("renderWindow lays out header, sub-header, and one row per model", () => {
	const table = renderWindow({
		label: "Last hour",
		models: [
			{
				key: "anthropic/claude-sonnet",
				responses: 2,
				failures: { aborted: 0, timeout: 1, error: 0 },
				ttft: metric({ mean: 500, p50: 500, p90: 500, p99: 500 }),
				total: metric({ mean: 10_000, p50: 10_000, p90: 10_000, p99: 10_000 }),
				tps: metric({ mean: 105.3, p50: 105.3, p90: 105.3, p99: 105.3, p10: 90.1, p1: 42.5 }),
			},
			{
				key: "openai/gpt-5",
				responses: 0,
				failures: { aborted: 1, timeout: 0, error: 0 },
			},
		],
	});
	const lines = [...table.header, ...table.rows];
	assert.equal(lines.length, 4);
	assert.match(lines[0]!, /ttft s.+total s.+tok\/s/);
	assert.match(lines[1]!, /mean.+p50.+p90.+p99/);
	// The tok/s group carries the slow-tail columns; ttft/total keep four each.
	assert.equal(lines[1]!.split("p10").length - 1, 1);
	assert.match(lines[1]!, /p99.+p10.+p1/);
	assert.match(lines[2]!, /90\.1.+42\.5/);
	assert.match(lines[2]!, /^anthropic\/claude-sonnet │ +2 │ +│ +1 │/);
	assert.match(lines[2]!, /│ +0\.5 │ +0\.5 │ +0\.5 │ +0\.5 │ +10\.0 │/);
	assert.match(lines[3]!, /^openai\/gpt-5 +│ +0 │ +1 │/);
	assert.match(lines[3]!, /│ +-/);
	const headerBars = barsAt(lines[0]!);
	const rowBars = barsAt(lines[2]!);
	assert.ok(headerBars.length > 0);
	assert.ok(headerBars.every((index) => rowBars.includes(index)));
	assert.deepEqual(barsAt(lines[1]!), rowBars);
	assert.deepEqual(renderWindow({ label: "Last hour", models: [] }), { header: ["(no samples)"], rows: [] });
});

test("renderWindow sizes each column to its content so percentiles stay separate", () => {
	const table = renderWindow({
		label: "Last hour",
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
	});
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
	const hour = { label: "Last hour", models: [short] };
	const week = { label: "Last week", models: [short, long] };
	const layout = measureWindows([hour, week]);
	const hourTable = renderWindow(hour, { layout });
	const weekTable = renderWindow(week, { layout });
	// Same column boundaries in both sections ...
	assert.deepEqual(barsAt(hourTable.rows[0]!), barsAt(weekTable.rows[0]!));
	assert.deepEqual(barsAt(hourTable.header[0]!), barsAt(weekTable.header[0]!));
	// ... and the hour's short name is padded to the shared model width.
	assert.match(hourTable.rows[0]!, /^a\/b +│/);
	// Measured alone, the hour table would be narrower.
	assert.notDeepEqual(barsAt(renderWindow(hour).rows[0]!), barsAt(hourTable.rows[0]!));
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
