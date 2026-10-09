/**
 * Usage accounting: cache and reasoning tokens are reported apart from the
 * input/output totals, per agent, cumulatively, and in the journal; journals
 * written before those counters replay them as zero.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRunStore } from "../src/store.ts";
import { mkSup, tick } from "./ctl-worker.ts";
import { TEST_MODEL } from "./fake-worker.ts";

function reported(sup: ReturnType<typeof mkSup>["sup"]): Array<Record<string, unknown>> {
  return sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((r) => r.kind === "usage.reported").map((r) => r.body);
}

test("cache and reasoning tokens are reported apart from the input and output totals", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  await tick();
  byAgent(a.agentId)[0]!.fire("settled", { status: "succeeded", lastAssistantText: "done", usage: { input: 100, output: 40, cacheRead: 60, cacheWrite: 10, reasoning: 7, cost: 0.5, unknown: false } });
  await tick();
  const totals = { inputTokens: 100, outputTokens: 40, cacheReadTokens: 60, cacheWriteTokens: 10, reasoningTokens: 7, cost: 0.5, unknown: false };
  assert.deepEqual(sup.list("governor")[0]!.usage, totals);
  assert.deepEqual(sup.rootUsage(), totals);
  const record = reported(sup)[0]!;
  assert.deepEqual(
    { input: record["input"], output: record["output"], cacheRead: record["cacheRead"], cacheWrite: record["cacheWrite"], reasoning: record["reasoning"], cost: record["cost"], unknown: record["unknown"] },
    { input: 100, output: 40, cacheRead: 60, cacheWrite: 10, reasoning: 7, cost: 0.5, unknown: false },
  );
  await sup.shutdown();
});

test("reasoning tokens stay null until a provider reports them, and then sum", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  await tick();
  const worker = byAgent(a.agentId)[0]!;
  worker.fire("settled", { status: "succeeded", lastAssistantText: "one", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: null, cost: null, unknown: false } });
  await tick();
  assert.equal(sup.list("governor")[0]!.usage.reasoningTokens, null, "an unreported breakdown is not zero");
  assert.equal(reported(sup)[0]!["reasoning"], null);
  await sup.sendMessage("governor", a.agentId, "task", "again", {}, "rb");
  await tick();
  worker.fire("settled", { status: "succeeded", lastAssistantText: "two", usage: { input: 10, output: 5, cacheRead: 4, cacheWrite: 0, reasoning: 3, cost: null, unknown: false } });
  await tick();
  const usage = sup.list("governor")[0]!.usage;
  assert.equal(usage.reasoningTokens, 3);
  assert.equal(usage.cacheReadTokens, 4);
  assert.equal(usage.unknown, false);
  await sup.shutdown();
});

test("a generation lost without a report flags usage unknown and adds no cache tokens", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  await tick();
  byAgent(a.agentId)[0]!.crash();
  await tick();
  const usage = sup.list("governor")[0]!.usage;
  assert.equal(usage.unknown, true);
  assert.deepEqual([usage.cacheReadTokens, usage.cacheWriteTokens, usage.reasoningTokens], [0, 0, null]);
  await sup.shutdown();
});

test("a journal written before the cache counters replays them as zero without marking usage unknown", async () => {
  const store = new InMemoryRunStore("root-1");
  const agentId = "00000000-0000-4000-8000-000000000001";
  const taskRunId = "00000000-0000-4000-8000-000000000002";
  store.append("agent.spawned", {
    agentId,
    path: "/root/old",
    parentId: null,
    depth: 1,
    profile: "reader",
    taskRunId,
    requestId: "r-old",
    grants: { tools: ["read", "grep", "find", "ls"], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" },
    allocation: { kind: "reader", workdir: "/proj", readRoots: [], writableRoot: null, git: null, repoId: null, tmpDir: "/tmp/old" },
    instructions: { contextFiles: [], skills: [] },
    model: TEST_MODEL,
    gated: false,
  });
  store.append("generation.started", { agentId, taskRunId, generation: 1, workerPid: null, workerBoot: null });
  // The record shape before cache and reasoning counters existed.
  store.append("usage.reported", { agentId, taskRunId, generation: 1, input: 100, output: 40, cost: 0.5, unknown: false });
  store.append("generation.settled", { agentId, taskRunId, generation: 1, outcome: "succeeded", text: "old result" });
  store.append("task.terminal", { agentId, taskRunId, outcome: "succeeded", preview: "old result", detail: "" });
  const { sup } = mkSup({ store });
  const totals = { inputTokens: 100, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null, cost: 0.5, unknown: false };
  assert.deepEqual(sup.list("governor")[0]!.usage, totals);
  assert.deepEqual(sup.rootUsage(), totals);
  await sup.shutdown();
});
