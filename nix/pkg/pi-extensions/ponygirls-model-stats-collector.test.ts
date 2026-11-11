import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readStatsRecords, registerStatsCollector } from "./ponygirls-model-stats-collector.ts";
import { summarize } from "./ponygirls-model-stats-state.ts";

function session(dir: string): (name: string, event: unknown) => void {
	const handlers = new Map<string, (event: unknown) => void>();
	registerStatsCollector({ on: (name: string, handler: (event: unknown) => void) => { handlers.set(name, handler); } } as ExtensionAPI, dir);
	return (name, event) => {
		const handler = handlers.get(name);
		assert.ok(handler, `missing handler: ${name}`);
		handler(event);
	};
}

// Behavioral / Effectual / Group: independent session collectors, real shared file.
test("parent and worker collectors keep independent anchors and aggregate the same file", (ctx) => {
	const dir = mkdtempSync(join(tmpdir(), "perf-collectors-"));
	ctx.after(() => rmSync(dir, { recursive: true, force: true }));
	ctx.mock.timers.enable({ apis: ["Date"], now: 1_000 });
	const parent = session(dir);
	const worker = session(dir);
	parent("before_provider_headers", {});
	ctx.mock.timers.tick(100);
	parent("provider_stream_event", {});
	worker("before_provider_headers", {});
	ctx.mock.timers.tick(100);
	worker("provider_stream_event", {});
	ctx.mock.timers.tick(200);
	const message = { role: "assistant", provider: "provider", model: "model", thinkingLevel: "high", stopReason: "stop", usage: { output: 10 } };
	worker("message_end", { message });
	ctx.mock.timers.tick(100);
	parent("message_end", { message });
	parent("message_end", { message });
	for (const [stopReason, errorMessage] of [["aborted", ""], ["error", "timed out"], ["error", "invalid"]]) {
		worker("before_provider_headers", {});
		worker("message_end", { message: { ...message, stopReason, errorMessage } });
	}
	const records = readStatsRecords(join(dir, "model-stats.jsonl"));
	assert.deepEqual(records.slice(0, 2), [
		{ type: "ok", ts: 1400, key: "provider/model", ttftMs: 100, totalMs: 300, outputTokens: 10, effort: "high" },
		{ type: "ok", ts: 1500, key: "provider/model", ttftMs: 100, totalMs: 500, outputTokens: 10, effort: "high" },
	]);
	const row = summarize(records, Date.now(), "effort")[0]!.models[0]!;
	assert.equal(row.responses, 2);
	assert.equal(row.effort, "high");
	assert.deepEqual(row.failures, { aborted: 1, timeout: 1, error: 1 });
});
