/**
 * Round-4 regressions (failing first): per-op usage accounting (U1/U2),
 * cancel scope retirement (C1), preparation-time handle swap (A1).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRunStore } from "../src/store.ts";
import { GoverningToolDispatcher } from "../src/external-dispatcher.ts";
import type { PinnedGoverningHandle } from "../src/governing-runtime.ts";
import type { BrokerCaller } from "../src/broker.ts";

const CG = "mcp__codegraph__codegraph_explore";

function fullUsage(input: number, output: number): Record<string, unknown> {
  return {
    input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function handle(name: string, impl?: PinnedGoverningHandle["execute"]): PinnedGoverningHandle {
  return { name, description: `${name} d`, parameters: { type: "object" }, execute: impl ?? (async () => ({ content: [{ type: "text", text: "ok" }], details: {} })) };
}

function caller(ext: string[] = [CG]): BrokerCaller {
  return {
    agentId: "a1", taskRunId: "t1", generation: 1,
    grants: { tools: [], externalTools: ext, repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" },
    workdir: "/tmp", writableRoot: null, sandbox: null,
  };
}

const nativeOk = async () => ({ stdout: "", stderr: "", exitCode: 0 as const, timedOut: false, truncated: false });

function sumReported(store: import("../src/store.ts").RunStore): { input: number; output: number } {
  let input = 0;
  let output = 0;
  for (const r of store.readSince(0, 100000).records) {
    if (r.kind !== "usage.reported") continue;
    const b = r.body as Record<string, unknown>;
    if (typeof b["input"] === "number") input += b["input"] as number;
    if (typeof b["output"] === "number") output += b["output"] as number;
  }
  return { input, output };
}

test("U1 restart totals keep each op own receipt (no aggregate re-account)", async () => {
  const { mkSup } = await import("./ctl-worker.ts");
  const { tick } = await import("./ctl-worker.ts");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { FileRunStore } = await import("../src/store.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-u1-"));
  const outer = handle(CG, async (_id, _p, _s, _u, ctx) => {
    await (ctx as { executeTool: (n: string, a: unknown) => Promise<unknown> }).executeTool("mcp__n__x", {});
    return { content: [{ type: "text", text: "out" }], details: {}, usage: fullUsage(1, 1) };
  });
  const inner = handle("mcp__n__x", async () => ({ content: [{ type: "text", text: "in" }], details: {}, usage: fullUsage(2, 3) }));
  const reg = () => ({ isActive: () => true, listHandles: () => [outer, inner], getHandle: (n: string) => (n === CG ? outer : inner), baseCtx: () => ({}) });
  const policyOf = (p: { allowedTools: string[] }): void => { p.allowedTools = [CG, "mcp__n__x"]; };
  const store1 = new FileRunStore(dir, "root-u1");
  const first = mkSup({ dir, store: store1, policy: policyOf });
  (first.sup as unknown as { opts: { governingRegistry?: unknown } }).opts.governingRegistry = reg;
  const g = await first.sup.spawn("governor", { taskName: "u", message: "m", profile: "reader" }, "u1-1");
  await tick();
  // Assistant-side usage so totals include it: settle the worker run.
  await first.byAgent(g.agentId)[0].call(CG, {});
  first.byAgent(g.agentId)[0].settle("succeeded", "done");
  await tick(50);
  // External own reports: outer {1,1} + inner {2,3} (+ assistant {1,1}).
  assert.deepEqual(sumReported(store1), { input: 4, output: 5 });
  await first.sup.shutdown();
  const store2 = new FileRunStore(dir, "root-u1");
  const second = mkSup({ dir, store: store2, policy: policyOf });
  (second.sup as unknown as { opts: { governingRegistry?: unknown } }).opts.governingRegistry = reg;
  await second.sup.recover();
  assert.deepEqual(sumReported(store2), { input: 4, output: 5 }, "restart re-accounted aggregate");
  await second.sup.shutdown();
});

test("U2 three-depth chain totals include grandchild exactly once", async () => {
  const store = new InMemoryRunStore("r");
  const reported: Array<{ op: string; usage: unknown }> = [];
  const grand = handle("mcp__g__x", async () => ({ content: [{ type: "text", text: "g" }], details: {}, usage: fullUsage(4, 5) }));
  const mid = handle("mcp__m__x", async (_id, _p, _s, _u, ctx) => {
    await (ctx as { executeTool: (n: string, a: unknown) => Promise<unknown> }).executeTool("mcp__g__x", {});
    return { content: [{ type: "text", text: "m" }], details: {}, usage: fullUsage(2, 3) };
  });
  const top = handle(CG, async (_id, _p, _s, _u, ctx) => {
    await (ctx as { executeTool: (n: string, a: unknown) => Promise<unknown> }).executeTool("mcp__m__x", {});
    return { content: [{ type: "text", text: "t" }], details: {}, usage: fullUsage(1, 1) };
  });
  const hookReports: Array<{ op: string; usage: unknown }> = [];
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [top, mid, grand], getHandle: (n: string) => (n === CG ? top : n === "mcp__m__x" ? mid : grand), baseCtx: () => ({}) }),
    nativeOk,
    { onUsage: (info) => { hookReports.push({ op: info.operationId, usage: info.usage }); } },
  );
  const ext = [CG, "mcp__m__x", "mcp__g__x"];
  const res = await disp.execute(caller(ext), { tool: CG, args: {} });
  assert.equal(res.isError, false);
  // Per-op own receipts via hook (top/mid/grand each once): 1+2+4, 1+3+5.
  // Journal outcomes carry the same canonical receipts; totals derive by sum.
  assert.equal(hookReports.length, 3, `grandchild report lost: ${JSON.stringify(hookReports.map((r) => r.usage))}`);
  const total = hookReports.reduce(
    (acc, r) => {
      const u = r.usage as Record<string, number>;
      return { input: acc.input + (u["input"] ?? 0), output: acc.output + (u["output"] ?? 0) };
    },
    { input: 0, output: 0 },
  );
  assert.deepEqual(total, { input: 7, output: 9 }, `grandchild lost: ${JSON.stringify(hookReports.map((r) => r.usage))}`);
  void reported;
});

test("C1 cancelled nested scope retires: signal aborted, retained re-call denied pre-effect", async () => {
  const store = new InMemoryRunStore("r");
  const INNER = "mcp__slow__inner";
  let innerEffects = 0;
  let retainedCtx: {
    signal?: AbortSignal;
    executeTool: (n: string, a: unknown) => Promise<{ isError: boolean }>;
  } | null = null;
  const inner = handle(INNER, async (_id, _p, _s, _u, ctx) => {
    innerEffects++;
    retainedCtx = ctx as never;
    await new Promise(() => {}); // abort-ignoring callee
    return { content: [{ type: "text", text: "never" }], details: {} };
  });
  const outer = handle(CG, async (_id, _p, _s, _u, ctx) => {
    const ctl = new AbortController();
    const sc = ctx as { executeTool: (n: string, a: unknown, o?: { signal?: AbortSignal }) => Promise<{ isError: boolean }> };
    const p = sc.executeTool(INNER, {}, { signal: ctl.signal });
    await new Promise((r) => setTimeout(r, 20));
    ctl.abort();
    return { content: [{ type: "text", text: "outer-cancelled" }], details: {}, isError: true };
    void p;
  });
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [outer, inner], getHandle: (n: string) => (n === CG ? outer : inner), baseCtx: () => ({}) }),
    nativeOk,
  );
  // Outer completes (cancelled) while inner still pending; scope must retire.
  const res = await disp.execute(caller([CG, INNER]), { tool: CG, args: {} });
  assert.equal(res.isError, true);
  assert.ok(retainedCtx, "inner impl never ran");
  const retained = retainedCtx as { signal?: AbortSignal | undefined; executeTool: (n: string, a: unknown) => Promise<{ isError: boolean }> };
  // Exposed scoped signal must reflect the combined (aborted) signal.
  assert.equal(retained.signal?.aborted, true, "nested ctx.signal not aborted after explicit cancel");
  // Retained abort-ignoring callee re-calling must deny BEFORE any effect.
  const before = innerEffects;
  const again = await retained.executeTool(INNER, {});
  assert.equal(again.isError, true, "retired scope executed an effect");
  assert.equal(innerEffects, before, "INNER effect ran once before final isError");
  await disp.fenceAgent("a1", "test teardown");
});

test("A1 handle swap during prepareArguments denies before effect", async () => {
  const store = new InMemoryRunStore("r");
  let swapped = false;
  let newImplEffects = 0;
  const original: PinnedGoverningHandle = {
    name: CG, description: "orig", parameters: { type: "object" },
    prepareArguments: () => { swapped = true; return {}; },
    execute: (async () => ({ content: [{ type: "text", text: "orig-ran" }], details: {} })),
  };
  const replacement: PinnedGoverningHandle = {
    name: CG, description: "changed", parameters: { type: "object", properties: { required: { type: "string" } }, required: ["required"] },
    execute: (async () => { newImplEffects++; return { content: [{ type: "text", text: "new-ran" }], details: {} }; }),
  };
  const disp = new GoverningToolDispatcher(
    store,
    () => ({
      isActive: () => true,
      listHandles: () => [swapped ? replacement : original],
      getHandle: () => (swapped ? replacement : original),
      baseCtx: () => ({}),
    }),
    nativeOk,
  );
  const res = await disp.execute(caller(), { tool: CG, args: {} });
  assert.equal(swapped, true, "preparation never ran");
  assert.equal(newImplEffects, 0, "swapped impl executed once without new-schema validation");
  assert.equal(res.isError, true);
});
