import assert from "node:assert/strict";
import test from "node:test";

import {
	buildInputDistribution,
	buildUsageRows,
	INPUT_DIST_BUCKETS,
	measureUsageTable,
	renderInputDistChart,
	renderInputDistTable,
	renderUsageTable,
	usageTotalsRow,
	USAGE_TAB_DEFAULT_MODE,
	USAGE_TAB_LABELS,
} from "./ponygirls-usage-state.ts";
import type { ModelStats, ProviderStats, TimeFilteredStats, TotalStats } from "./ponygirls-usage-data.ts";

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

test("renderUsageTable aligns columns and appends totals", () => {
	const rows = buildUsageRows(stats, "models");
	const table = renderUsageTable(rows, usageTotalsRow(totals));
	assert.match(table.header[0]!, /Provider.+Model.+Sessions.+Msgs.+Cost.+Tokens/);
	assert.equal(table.rows.length, 5);
	assert.equal(table.totals.length, 1);
	assert.match(table.totals[0]!, /^Total/);
	const bars = barsAt(table.header[0]!);
	assert.ok(bars.length > 0);
	for (const line of [...table.rows, ...table.totals]) assert.deepEqual(barsAt(line), bars);
	// A shared layout keeps columns aligned for every tab.
	const layout = measureUsageTable(rows, usageTotalsRow(totals));
	const again = renderUsageTable(rows, usageTotalsRow(totals), { layout });
	assert.deepEqual(barsAt(again.header[0]!), bars);
});

test("renderUsageTable reports an empty period", () => {
	const empty = timeFilteredStats();
	const table = renderUsageTable([], usageTotalsRow(empty.totals));
	assert.deepEqual(table, { header: ["(no usage for this period)"], rows: [], totals: [] });
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
	);
	assert.match(table.header[0]!, /Range.+Msgs.+Share/);
	assert.equal(table.rows.length, 8);
	assert.match(table.rows[0]!, /<10k.+1.+17%/);
	assert.match(table.rows[7]!, />=500k.+1.+17%/);
	assert.ok(table.rows[6]!.includes("200-500k") && table.rows[6]!.trimEnd().endsWith("-"));
	assert.deepEqual(table.totals, ["6 messages"]);
});

test("renderInputDistTable reports an empty period", () => {
	assert.deepEqual(renderInputDistTable(buildInputDistribution([])), {
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
