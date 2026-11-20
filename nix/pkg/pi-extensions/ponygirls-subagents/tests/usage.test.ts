/**
 * Usage accounting: cache and reasoning tokens are reported apart from the
 * input/output totals, per agent, cumulatively, and in the journal; journals
 * written before those counters replay them as zero.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRunStore } from "../src/store.ts";
import type { ParentModels } from "../src/parent-models.ts";
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

function testParentModels(contextWindow: number): ParentModels {
  return {
    describe: () => ({
      id: "model", provider: "test", name: "Test model", api: "openai-completions", baseUrl: "https://example.invalid/v1",
      input: ["text"], reasoning: false, contextWindow, maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }),
    resolveAuth: async () => ({ ok: false, error: "no auth in this test" }),
  };
}

test("the context fill gauge follows the latest provider report against the admitted model's window", async () => {
  const { sup, byAgent } = mkSup({ parentModels: testParentModels(200_000) });
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  await tick();
  const worker = byAgent(a.agentId)[0]!;
  worker.fire("settled", { status: "succeeded", lastAssistantText: "done", usage: { input: 100, output: 40, cacheRead: 60, cacheWrite: 10, reasoning: null, cost: null, unknown: false, contextTokens: 24_000 } });
  await tick();
  assert.deepEqual(sup.list("governor")[0]!.contextFill, { tokens: 24_000, window: 200_000 });
  assert.equal(reported(sup)[0]!["contextTokens"], 24_000);
  await sup.sendMessage("governor", a.agentId, "task", "again", {}, "rb");
  await tick();
  worker.fire("settled", { status: "succeeded", lastAssistantText: "two", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: null, cost: null, unknown: false, contextTokens: 50_000 } });
  await tick();
  assert.deepEqual(sup.list("governor")[0]!.contextFill, { tokens: 50_000, window: 200_000 }, "the latest report wins");
  await sup.sendMessage("governor", a.agentId, "task", "third", {}, "rc");
  await tick();
  worker.fire("settled", { status: "succeeded", lastAssistantText: "three", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: null, cost: null, unknown: false } });
  await tick();
  assert.deepEqual(sup.list("governor")[0]!.contextFill, { tokens: 50_000, window: 200_000 }, "a report without context tokens leaves the gauge alone");
  await sup.shutdown();
});

test("a tool request reports the context fill live during a running generation", async () => {
  const { sup, byAgent } = mkSup({ parentModels: testParentModels(200_000) });
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  await tick();
  assert.equal(sup.list("governor")[0]!.contextFill, null, "no provider request yet");
  await byAgent(a.agentId)[0]!.call("send_message", { target: "parent", message: "hi", mode: "note" }, { input: 3, output: 2, cost: 0.01, unknown: false, contextTokens: 33_000 });
  await tick();
  assert.deepEqual(sup.list("governor")[0]!.contextFill, { tokens: 33_000, window: 200_000 }, "the running generation's fill is visible before it settles");
  await sup.shutdown();
});

test("a malformed context fill is dropped, never fabricated", async () => {
  const { sup, byAgent } = mkSup({ parentModels: testParentModels(200_000) });
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  await tick();
  const worker = byAgent(a.agentId)[0]!;
  worker.fire("settled", { status: "succeeded", lastAssistantText: "done", usage: { input: 1, output: 1, cost: null, unknown: false, contextTokens: -5 } });
  await tick();
  assert.equal(sup.list("governor")[0]!.contextFill, null, "a negative gauge is not a gauge");
  await sup.sendMessage("governor", a.agentId, "task", "again", {}, "rb");
  await tick();
  worker.fire("settled", { status: "succeeded", lastAssistantText: "two", usage: { input: 1, output: 1, cost: null, unknown: false, contextTokens: 24_000 } });
  await tick();
  await sup.sendMessage("governor", a.agentId, "task", "third", {}, "rc");
  await tick();
  worker.fire("settled", { status: "succeeded", lastAssistantText: "three", usage: { input: 1, output: 1, cost: null, unknown: false, contextTokens: "24000" } });
  await tick();
  assert.deepEqual(sup.list("governor")[0]!.contextFill, { tokens: 24_000, window: 200_000 }, "a non-number never overwrites the gauge");
  await sup.shutdown();
});

test("a restored journal keeps the context fill and resolves its window", async () => {
  const store = new InMemoryRunStore("root-1");
  const agentId = "00000000-0000-4000-8000-000000000011";
  const taskRunId = "00000000-0000-4000-8000-000000000012";
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
  store.append("usage.reported", { agentId, taskRunId, generation: 1, input: 100, output: 40, cacheRead: 0, cacheWrite: 0, reasoning: null, cost: null, unknown: false, contextTokens: 24_000 });
  store.append("generation.settled", { agentId, taskRunId, generation: 1, outcome: "succeeded", text: "old result" });
  store.append("task.terminal", { agentId, taskRunId, outcome: "succeeded", preview: "old result", detail: "" });
  const { sup } = mkSup({ store, parentModels: testParentModels(200_000) });
  assert.deepEqual(sup.list("governor")[0]!.contextFill, { tokens: 24_000, window: 200_000 });
  await sup.shutdown();
});
