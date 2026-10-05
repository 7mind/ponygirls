import assert from "node:assert/strict";
import test from "node:test";

import {
	buildUsageRows,
	measureUsageTable,
	renderUsageTable,
	usageTotalsRow,
	USAGE_TAB_DEFAULT_MODE,
	USAGE_TAB_LABELS,
} from "./usage-state.ts";
import type { ModelStats, ProviderStats, TimeFilteredStats, TotalStats } from "./usage-data.ts";

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
	const empty: TimeFilteredStats = {
		providers: new Map(),
		totals: { messages: 0, cost: 0, tokens: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, sessions: 0 },
		insights: { insights: [] },
	};
	const table = renderUsageTable([], usageTotalsRow(empty.totals));
	assert.deepEqual(table, { header: ["(no usage for this period)"], rows: [], totals: [] });
});
