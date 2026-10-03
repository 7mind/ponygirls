import assert from "node:assert/strict";
import test from "node:test";

import {
	classifyOutcome,
	DAY_MS,
	HOUR_MS,
	parseStatsLine,
	percentile,
	pruneRecords,
	renderWindow,
	serializeStatsRecord,
	summarize,
	summarizeMetric,
	tokensPerSecond,
	WEEK_MS,
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
	assert.deepEqual(stats, { mean: 55, p50: 55, p90: 91, p99: 99.1 });
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

test("renderWindow lays out header, sub-header, and one row per model", () => {
	const lines = renderWindow({
		label: "Last hour",
		models: [
			{
				key: "anthropic/claude-sonnet",
				responses: 2,
				failures: { aborted: 0, timeout: 1, error: 0 },
				ttft: { mean: 500, p50: 500, p90: 500, p99: 500 },
				total: { mean: 10_000, p50: 10_000, p90: 10_000, p99: 10_000 },
				tps: { mean: 105.3, p50: 105.3, p90: 105.3, p99: 105.3 },
			},
			{
				key: "openai/gpt-5",
				responses: 0,
				failures: { aborted: 1, timeout: 0, error: 0 },
			},
		],
	});
	assert.equal(lines.length, 4);
	assert.match(lines[0]!, /ttft s\s+total s\s+tok\/s/);
	assert.match(lines[1]!, /mean\s+p50\s+p90\s+p99/);
	assert.match(lines[2]!, /^anthropic\/claude-sonnet\s+2\s+1\s+0\.5\s+0\.5\s+0\.5\s+0\.5\s+10\.0\s+10\.0\s+10\.0\s+10\.0\s+105\s+105\s+105\s+105/);
	assert.match(lines[3]!, /^openai\/gpt-5\s+0\s+1\s+-\s+-\s+-/);
	assert.deepEqual(renderWindow({ label: "Last hour", models: [] }), ["(no samples)"]);
});
