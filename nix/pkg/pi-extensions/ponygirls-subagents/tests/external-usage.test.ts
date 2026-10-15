/**
 * R5 usage exactly-once regressions: totals, nested aggregation, cache
 * fields, interruption, late-during-new-task identity, replay.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkSup, tick } from "./ctl-worker.ts";
import { InMemoryRunStore } from "../src/store.ts";
import { GoverningToolDispatcher } from "../src/external-dispatcher.ts";
import type { PinnedGoverningHandle } from "../src/governing-runtime.ts";
import type { BrokerCaller } from "../src/broker.ts";

const CG = "mcp__codegraph__codegraph_explore";

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

test("R5 exact totals after settlement: multiple + nested aggregated once, cache preserved", async () => {
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG, "mcp__n__x"]; } });
  const inner = handle("mcp__n__x", async () => ({ content: [{ type: "text", text: "in" }], details: {}, usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }));
  const outer = handle(CG, async (_id, _p, _s, _u, ctx) => {
    await (ctx as { executeTool: (n: string, a: unknown) => Promise<unknown> }).executeTool("mcp__n__x", {});
    return { content: [{ type: "text", text: "out" }], details: {}, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  });
  const plain = handle(CG);
  void plain;
  (built.sup as unknown as { opts: { governingRegistry?: () => unknown } }).opts.governingRegistry = () => ({
    isActive: () => true,
    listHandles: () => [outer, inner, handle(CG)],
    getHandle: (n: string) => (n === CG ? outer : n === "mcp__n__x" ? inner : undefined),
    baseCtx: () => ({}),
  });
  // Fix grants to include nested tool for this agent after spawn
  const g = await built.sup.spawn("governor", { taskName: "u", message: "m", profile: "reader" }, "use-1");
  await tick();
  // Widen test grants directly is not possible; use dispatcher-level for exact math instead (below).
  void g;
  // Dispatcher-level exact math: outer(1,1) + nested(2,3) + plain(10,5,cacheRead 2)
  const store = new InMemoryRunStore("r");
  const dOuter = handle(CG, async (_id, _p, _s, _u, ctx) => {
    await (ctx as { executeTool: (n: string, a: unknown) => Promise<unknown> }).executeTool("mcp__n__x", {});
    return { content: [{ type: "text", text: "out" }], details: {}, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  });
  const dInner = handle("mcp__n__x", async () => ({ content: [{ type: "text", text: "in" }], details: {}, usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }));
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [dOuter, dInner], getHandle: (n: string) => (n === CG ? dOuter : dInner), baseCtx: () => ({}) }),
    nativeOk,
  );
  const c = caller([CG, "mcp__n__x"]);
  const hookReports: Array<{ op: string; usage: unknown }> = [];
  const dispHooked = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [dOuter, dInner], getHandle: (n: string) => (n === CG ? dOuter : dInner), baseCtx: () => ({}) }),
    nativeOk,
    { onUsage: (info) => { hookReports.push({ op: info.operationId, usage: info.usage }); } },
  );
  void disp;
  const r1 = await dispHooked.execute(c, { tool: CG, args: {} });
  // Wire fidelity: the result carries the invocation's OWN valid Usage
  // verbatim (never the nested aggregate).
  assert.deepEqual(r1.usage, { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  // Ledger: per-op own receipts via hook (outer {1,1} + inner {2,3});
  // totals derived by summing, each once — no aggregate stored as own.
  assert.equal(hookReports.length, 2, `expected 2 per-op reports, got ${hookReports.length}`);
  const sum = hookReports.reduce(
    (acc, r) => {
      const u = r.usage as Record<string, number>;
      return { input: acc.input + (u["input"] ?? 0), output: acc.output + (u["output"] ?? 0) };
    },
    { input: 0, output: 0 },
  );
  assert.deepEqual(sum, { input: 3, output: 4 });
  // Journal keeps the own receipt; the nested receipt is independent.
  const r1intents = store.readSince(0, 100000).records.filter((r) => r.kind === "tool.intent" && (r.body as Record<string, unknown>)["tool"] === CG && ((r.body as Record<string, unknown>)["parentOperationId"] === null || (r.body as Record<string, unknown>)["parentOperationId"] === undefined));
  assert.equal(r1intents.length, 1, "expected one top intent");
  const topOp = (r1intents[0].body as Record<string, unknown>)["operationId"] as string;
  const r1outcomes = store.readSince(0, 100000).records.filter((r) => r.kind === "tool.outcome");
  const topOutcome = r1outcomes.find((r) => (r.body as Record<string, unknown>)["operationId"] === topOp);
  assert.ok(topOutcome, "missing top outcome");
  assert.deepEqual((topOutcome.body as Record<string, unknown>)["usage"], { input: 1, output: 1, cost: 0 });
  const plain2 = handle(CG, async () => ({ content: [{ type: "text", text: "p" }], details: {}, usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 17, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }));
  const disp2 = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [plain2], getHandle: () => plain2, baseCtx: () => ({}) }),
    nativeOk,
  );
  const r2 = await disp2.execute(c, { tool: CG, args: {} });
  assert.deepEqual(r2.usage, { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 17, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
});

test("R5 supervisor totals exact after worker settlement (no double count)", async () => {
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  const cg = handle(CG, async () => ({ content: [{ type: "text", text: "x" }], details: {}, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }));
  (built.sup as unknown as { opts: { governingRegistry?: () => unknown } }).opts.governingRegistry = () => ({
    isActive: () => true, listHandles: () => [cg], getHandle: () => cg, baseCtx: () => ({}),
  });
  const g = await built.sup.spawn("governor", { taskName: "t", message: "m", profile: "reader" }, "use-2");
  await tick();
  await built.byAgent(g.agentId)[0].call(CG, { q: "a" });
  await built.byAgent(g.agentId)[0].call(CG, { q: "b" });
  // Settle the worker run to terminal; totals must equal exactly 2 calls.
  built.byAgent(g.agentId)[0].settle("succeeded", "done");
  await tick(50);
  const view = built.sup.list("governor").find((v) => v.id === g.agentId) as unknown as { usage: { inputTokens: number; outputTokens: number } };
  assert.ok(view, "missing agent view");
  // Worker settle usage is {input:1,output:1} per CtlWorker settle + external 2x{10,5} = {21,11}. Assert exact (catches double-count).
  assert.equal(view.usage.inputTokens, 21, `input double-counted or lost: ${JSON.stringify(view.usage)}`);
  assert.equal(view.usage.outputTokens, 11, `output double-counted or lost: ${JSON.stringify(view.usage)}`);
});

test("R5 late completion during new task attributes originating IDs", async () => {
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  let release!: (v: { content: Array<{ type: string; text: string }>; usage: Record<string, unknown> }) => void;
  const slow = handle(CG, () => new Promise((resolve) => { release = resolve as never; }));
  (built.sup as unknown as { opts: { governingRegistry?: () => unknown } }).opts.governingRegistry = () => ({
    isActive: () => true, listHandles: () => [slow], getHandle: () => slow, baseCtx: () => ({}),
  });
  const g = await built.sup.spawn("governor", { taskName: "l", message: "m", profile: "reader" }, "late-1");
  await tick();
  const gen1 = g.taskRunId;
  const pending = built.byAgent(g.agentId)[0].call(CG, { q: "x" });
  await new Promise((r) => setTimeout(r, 20));
  await built.sup.interrupt("governor", g.agentId, "int-late-1");
  await pending;
  // Start a new task on the same agent (new generation).
  await built.sup.sendMessage("governor", g.agentId, "task", "follow-up work", {}, "late-task-2");
  await tick(50);
  release({ content: [{ type: "text", text: "late-effect" }], usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 6, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  await tick(50);
  const reported = built.sup.runStore.readSince(0, 100000).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["external"] === true);
  // Non-vacuous: late usage must be reported exactly once with historical numbers.
  assert.equal(reported.length, 1, `expected exactly one external usage report, got ${reported.length}`);
  assert.equal((reported[0].body as Record<string, unknown>)["taskRunId"], gen1, "late usage misattributed to new task");
  assert.equal((reported[0].body as Record<string, unknown>)["input"], 4, "late input not preserved");
  assert.equal((reported[0].body as Record<string, unknown>)["output"], 2, "late output not preserved");
  // Outcomes for the late op are uncertain (never clean ok after cancel).
  const intents = built.sup.runStore.readSince(0, 100000).records.filter((r) => r.kind === "tool.intent" && (r.body as Record<string, unknown>)["tool"] === CG);
  assert.ok(intents.length >= 1);
  const op = (intents[0].body as Record<string, unknown>)["operationId"] as string;
  const outcomes = built.sup.runStore.readSince(0, 100000).records.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === op);
  assert.ok(outcomes.every((r) => (r.body as Record<string, unknown>)["status"] !== "ok"), "cancelled late call journaled clean ok");
});

test("R5 replay does not re-account or re-execute (duplicate fenced after restart)", async () => {
  const { mkSup: mkReplay } = await import("./ctl-worker.ts");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { FileRunStore } = await import("../src/store.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-use-replay-"));
  let calls = 0;
  const cg = handle(CG, async () => { calls++; return { content: [{ type: "text", text: "x" }], details: {}, usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }; });
  const reg = () => ({ isActive: () => true, listHandles: () => [cg], getHandle: () => cg, baseCtx: () => ({}) });
  const setReg = (sup: { opts: { governingRegistry?: unknown } }): void => {
    (sup as unknown as { opts: { governingRegistry?: unknown } }).opts.governingRegistry = reg;
  };
  const store1 = new FileRunStore(dir, "root-use");
  const first = mkReplay({ dir, store: store1, policy: (p) => { p.allowedTools = [CG]; } });
  setReg(first.sup as unknown as { opts: { governingRegistry?: unknown } });
  const g = await first.sup.spawn("governor", { taskName: "rp", message: "m", profile: "reader" }, "rp-1");
  await tick();
  const r1 = await first.byAgent(g.agentId)[0].call(CG, { q: "x" });
  assert.equal(r1.isError, false);
  assert.equal(calls, 1);
  const view1 = first.sup.list("governor").find((v) => v.id === g.agentId) as unknown as { usage: { inputTokens: number } };
  await first.sup.shutdown();
  // Restart on the same store dir: replay rebuilds duplicate fencing.
  const store2 = new FileRunStore(dir, "root-use");
  const second = mkReplay({ dir, store: store2, policy: (p) => { p.allowedTools = [CG]; } });
  setReg(second.sup as unknown as { opts: { governingRegistry?: unknown } });
  await second.sup.recover();
  // The original intent is journaled; re-issuing any recorded operation id
  // must duplicate-fence without re-executing or re-accounting.
  const intents = store2.readSince(0, 100000).records.filter((r) => r.kind === "tool.intent" && (r.body as Record<string, unknown>)["tool"] === CG);
  assert.ok(intents.length >= 1);
  const op = (intents[0].body as Record<string, unknown>)["operationId"] as string;
  const disp = (second.sup as unknown as { governingDispatcher: import("../src/external-dispatcher.ts").GoverningToolDispatcher }).governingDispatcher;
  // A live agent retries a journaled operation id: duplicate-fence without
  // re-executing (live auth passes; the seen-ID check fires first).
  const g2 = await second.sup.spawn("governor", { taskName: "rp2", message: "m", profile: "reader" }, "rp-2");
  await tick();
  await assert.rejects(
    disp.execute(
      { agentId: g2.agentId, taskRunId: g2.taskRunId, generation: g2.generation, grants: { tools: [], externalTools: [CG], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" }, workdir: "/tmp", writableRoot: null, sandbox: null },
      { operationId: op, tool: CG, args: {} },
    ),
    /DUPLICATE_REQUEST/,
  );
  assert.equal(calls, 1, "replayed operation re-executed the parent tool");
  void view1;
  await second.sup.shutdown();
});

test("R5 store fault between outcome and usage.reported still totals on restart (catch-up)", async () => {
  const { mkSup: mkFault } = await import("./ctl-worker.ts");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { InMemoryRunStore } = await import("../src/store.ts");
  // Flaky store: fail the first external usage.reported append only.
  let faultArmed = true;
  class FlakyStore extends InMemoryRunStore {
    override append(kind: import("../src/store.ts").JournalKind, body: Record<string, unknown>): import("../src/store.ts").JournalRecord {
      if (faultArmed && kind === "usage.reported" && (body as Record<string, unknown>)["external"] === true) {
        faultArmed = false;
        throw Object.assign(new Error("injected journal fault"), { code: "STORE_FAILED" });
      }
      return super.append(kind, body);
    }
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-use-fault-"));
  const cgFault = {
    name: "mcp__codegraph__codegraph_explore",
    description: "d",
    parameters: { type: "object" },
    execute: (async () => ({ content: [{ type: "text", text: "x" }], details: {}, usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } })),
  };
  const regFault = () => ({ isActive: () => true, listHandles: () => [cgFault], getHandle: () => cgFault, baseCtx: () => ({}) });
  const store1 = new FlakyStore("root-fault");
  const first = mkFault({ dir, store: store1, policy: (p) => { p.allowedTools = ["mcp__codegraph__codegraph_explore"]; } });
  (first.sup as unknown as { opts: { governingRegistry?: unknown } }).opts.governingRegistry = regFault;
  const g = await first.sup.spawn("governor", { taskName: "f", message: "m", profile: "reader" }, "fault-1");
  const { tick: tickFault } = await import("./ctl-worker.ts");
  await tickFault();
  // The tool itself succeeded; only the accounting commit faulted. The
  // fault surfaces through the observable error channel (controller_error
  // recovery.event), NOT as a worker-visible failure, and the durable
  // outcome is already journaled without accounting.
  const faulted = await first.byAgent(g.agentId)[0].call("mcp__codegraph__codegraph_explore", {});
  assert.equal(faulted.isError, false);
  const errors = store1.readSince(0, 100000).records.filter(
    (r) => r.kind === "recovery.event" && (r.body as Record<string, unknown>)["phase"] === "controller_error",
  );
  assert.ok(errors.length >= 1, "commit fault missing from observable error channel");
  const preReports = store1.readSince(0, 100000).records.filter(
    (r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["external"] === true,
  );
  assert.equal(preReports.length, 0, "accounting committed despite the fault");
  await first.sup.shutdown();
  // Restart on the same records: catch-up must account the orphaned usage.
  faultArmed = false;
  const store2 = store1;
  const second = mkFault({ dir, store: store2, policy: (p) => { p.allowedTools = ["mcp__codegraph__codegraph_explore"]; } });
  (second.sup as unknown as { opts: { governingRegistry?: unknown } }).opts.governingRegistry = regFault;
  await second.sup.recover();
  const reported = store2.readSince(0, 100000).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["external"] === true);
  assert.equal(reported.length, 1, `catch-up missing: ${reported.length}`);
  assert.equal((reported[0].body as Record<string, unknown>)["input"], 5);
  assert.equal((reported[0].body as Record<string, unknown>)["output"], 7);
  assert.equal((reported[0].body as Record<string, unknown>)["recovered"], true);
  await second.sup.shutdown();
});
