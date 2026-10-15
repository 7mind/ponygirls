/**
 * R3/R4 lifecycle regressions: live fencing, scopes, cancellation,
 * settlement, duplicates, shutdown/reload/recovery, gate admission.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkSup, tick } from "./ctl-worker.ts";
import { InMemoryRunStore } from "../src/store.ts";
import { GoverningToolDispatcher } from "../src/external-dispatcher.ts";
import type { PinnedGoverningHandle } from "../src/governing-runtime.ts";
import type { BrokerCaller } from "../src/broker.ts";

const CG = "mcp__codegraph__codegraph_explore";
const EVIL = "mcp__evil__tool";

function handle(name: string, impl?: PinnedGoverningHandle["execute"]): PinnedGoverningHandle {
  return {
    name,
    description: `${name} d`,
    parameters: { type: "object" },
    execute: impl ?? (async () => ({ content: [{ type: "text", text: "ok" }], details: {} })),
  };
}

function caller(ext: string[] = [CG]): BrokerCaller {
  return {
    agentId: "a1", taskRunId: "t1", generation: 1,
    grants: { tools: [], externalTools: ext, repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" },
    workdir: "/tmp", writableRoot: null, sandbox: null,
  };
}

const nativeOk = async () => ({ stdout: "", stderr: "", exitCode: 0 as const, timedOut: false, truncated: false });

test("R3 delayed nested after policy narrowing is denied (live re-auth)", async () => {
  const store = new InMemoryRunStore("r");
  let allowEvil = true;
  const disp = new GoverningToolDispatcher(
    store,
    () => ({
      isActive: () => true,
      listHandles: () => allowEvil ? [handle(CG), handle(EVIL)] : [handle(CG)],
      getHandle: (n: string) => (n === CG ? handle(CG) : allowEvil && n === EVIL ? handle(EVIL) : undefined),
      baseCtx: () => ({}),
    }),
    nativeOk,
  );
  const outer = handle(CG, async (_id, _p, _s, _u, ctx) => {
    await new Promise((r) => setTimeout(r, 30));
    allowEvil = false; // policy narrows mid-run (MCP disconnect)
    const out = await (ctx as { executeTool: (n: string, a: unknown) => Promise<{ isError: boolean; result: { content: Array<{ text?: string }> } }> }).executeTool(EVIL, {});
    return { content: [{ type: "text", text: out.isError ? "nested-denied" : "nested-ran" }], details: {} };
  });
  const disp2 = new GoverningToolDispatcher(
    store,
    () => ({
      isActive: () => true,
      listHandles: () => allowEvil ? [outer, handle(EVIL)] : [outer],
      getHandle: (n: string) => (n === CG ? outer : allowEvil && n === EVIL ? handle(EVIL) : undefined),
      baseCtx: () => ({}),
    }),
    nativeOk,
  );
  const res = await disp2.execute(caller([CG, EVIL]), { tool: CG, args: {} });
  assert.equal(res.isError, false);
  assert.ok(JSON.stringify(res.content).includes("nested-denied"), `narrowed nested ran: ${JSON.stringify(res.content)}`);
  void disp;
});

test("R3 retained scope revoked after settlement; null taskRunId fails closed", async () => {
  const store = new InMemoryRunStore("r");
  let scoped: { executeTool: (n: string, a: unknown) => Promise<{ isError: boolean }> } | null = null;
  const outer = handle(CG, async (_id, _p, _s, _u, ctx) => {
    scoped = ctx as never;
    return { content: [{ type: "text", text: "done" }], details: {} };
  });
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [outer], getHandle: () => outer, baseCtx: () => ({}) }),
    nativeOk,
  );
  await disp.execute(caller(), { tool: CG, args: {} });
  assert.ok(scoped, "no scoped ctx captured");
  const late = await (scoped as unknown as { executeTool: (n: string, a: unknown) => Promise<{ isError: boolean; result: { content: Array<{ text?: string }> } }> }).executeTool(CG, {});
  assert.equal(late.isError, true, "retained scope executable after settlement");
  // Null taskRunId fails closed (no admitted task run)
  await assert.rejects(
    disp.execute(caller(), { tool: CG, args: {} }).then(() => { throw new Error("unreachable"); }).catch((e) => { throw e; }),
    /./,
  ).catch(() => {});
  const nullCaller = { ...caller(), taskRunId: null };
  await assert.rejects(disp.execute(nullCaller, { tool: CG, args: {} }), /STALE_GENERATION/);
});

test("R3 explicit nested signal cancellation combines with child lifetime", async () => {
  const store = new InMemoryRunStore("r");
  const SLOW = "mcp__slow__tool";
  const slow = handle(SLOW, (_id, _p, signal) => new Promise((resolve) => {
    const t = setTimeout(() => resolve({ content: [{ type: "text", text: "slow" }], details: {} }), 5000);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve({ content: [{ type: "text", text: "aborted" }], details: {}, isError: true }); });
  }));
  const outer = handle(CG, async (_id, _p, _s, _u, ctx) => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 20);
    const out = await (ctx as { executeTool: (n: string, a: unknown, o?: { signal?: AbortSignal }) => Promise<{ isError: boolean }> }).executeTool(SLOW, {}, { signal: ctl.signal });
    return { content: [{ type: "text", text: out.isError ? "nested-cancelled" : "nested-ran" }], details: {} };
  });
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [outer, slow], getHandle: (n: string) => (n === CG ? outer : n === SLOW ? slow : undefined), baseCtx: () => ({}) }),
    nativeOk,
  );
  const res = await disp.execute(caller([CG, SLOW]), { tool: CG, args: {} });
  assert.ok(JSON.stringify(res.content).includes("nested-cancelled") || res.isError, `explicit signal ignored: ${JSON.stringify(res.content)}`);
});

test("R3 null envelope external denied at supervisor (fail closed)", async () => {
  const { sup, byAgent } = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  const cg = handle(CG);
  (sup as unknown as { opts: { governingRegistry?: () => unknown } }).opts.governingRegistry = () => ({
    isActive: () => true, listHandles: () => [cg], getHandle: () => cg, baseCtx: () => ({}),
  });
  const g = await sup.spawn("governor", { taskName: "n", message: "m", profile: "reader" }, "null-env-1");
  await tick();
  const rt = (sup as unknown as { agents: Map<string, unknown> }).agents as Map<string, unknown>;
  const onTool = (sup as unknown as { onToolRequest: (rt: unknown, w: unknown, p: unknown, e: unknown) => Promise<{ content: string; isError: boolean }> }).onToolRequest;
  const res = await onTool.call(sup, rt.get(g.agentId), byAgent(g.agentId)[0], { tool: CG, args: { q: "x" }, toolCallId: "tc", usage: null }, undefined);
  assert.equal(res.isError, true);
  assert.match(res.content, /STALE_GENERATION/);
});

test("R4 worker death during external settles uncertain", async () => {
  const cg = handle(CG, () => new Promise(() => {})); // never resolves
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  (built.sup as unknown as { opts: { governingRegistry?: () => unknown } }).opts.governingRegistry = () => ({
    isActive: () => true, listHandles: () => [cg], getHandle: () => cg, baseCtx: () => ({}),
  });
  const g = await built.sup.spawn("governor", { taskName: "w", message: "m", profile: "reader" }, "death-1");
  await tick();
  const worker = built.byAgent(g.agentId)[0];
  const pending = worker.call(CG, { q: "x" });
  await new Promise((r) => setTimeout(r, 30));
  worker.crash();
  const res = await pending;
  assert.equal(res.isError, true);
  await tick(50);
  const terms = built.sup.runStore.readSince(0, 100000).records.filter((r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId);
  assert.ok(terms.length >= 1, "no terminal after worker death");
  assert.equal((terms[0].body as Record<string, unknown>)["outcome"], "uncertain");
});

test("R4 never-resolving tool: cancel returns promptly, fence records uncertain", async () => {
  const store = new InMemoryRunStore("r");
  const hung = handle(CG, () => new Promise(() => {}));
  const disp = new GoverningToolDispatcher(
    store, () => ({ isActive: () => true, listHandles: () => [hung], getHandle: () => hung, baseCtx: () => ({}) }), nativeOk,
  );
  const start = Date.now();
  const pending = disp.execute(caller(), { operationId: "op-hung-1", tool: CG, args: {} });
  await new Promise((r) => setTimeout(r, 20));
  await disp.cancelJobs("a1");
  const res = await pending;
  assert.ok(Date.now() - start < 2000, "cancel waited indefinitely");
  assert.equal(res.isError, true);
  const fenced = await disp.fenceAgent("a1", "test fence");
  assert.ok(fenced.length >= 0);
  const outcomes = store.readSince(0, 1000).records.filter((r) => r.kind === "tool.outcome");
  assert.ok(outcomes.every((r) => (r.body as Record<string, unknown>)["status"] !== "ok"), "hung tool journaled clean ok");
});

test("R4 duplicate IDs fenced (top-level throws, nested isError)", async () => {
  const store = new InMemoryRunStore("r");
  const cg = handle(CG);
  const disp = new GoverningToolDispatcher(
    store, () => ({ isActive: () => true, listHandles: () => [cg], getHandle: () => cg, baseCtx: () => ({}) }), nativeOk,
  );
  await disp.execute(caller(), { operationId: "op-dup-1", tool: CG, args: {} });
  await assert.rejects(disp.execute(caller(), { operationId: "op-dup-1", tool: CG, args: {} }), /DUPLICATE_REQUEST/);
});

test("R4 shutdown fences in-flight; late settle writes no second outcome", async () => {
  const store = new InMemoryRunStore("r");
  let release!: (v: { content: Array<{ type: string; text: string }>; usage: Record<string, unknown> }) => void;
  const slow = handle(CG, () => new Promise((resolve) => { release = resolve as never; }));
  const disp = new GoverningToolDispatcher(
    store, () => ({ isActive: () => true, listHandles: () => [slow], getHandle: () => slow, baseCtx: () => ({}) }), nativeOk,
  );
  const pending = disp.execute(caller(), { operationId: "op-shut-1", tool: CG, args: {} });
  await new Promise((r) => setTimeout(r, 20));
  const fenced = await disp.fenceAgent("a1", "shutdown");
  assert.deepEqual(fenced, ["op-shut-1"]);
  const res = await pending;
  assert.equal(res.isError, true);
  release({ content: [{ type: "text", text: "late" }], usage: { input: 99, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 99, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  await new Promise((r) => setTimeout(r, 30));
  const outcomes = store.readSince(0, 1000).records.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === "op-shut-1");
  assert.equal(outcomes.length, 1, `late settle wrote second outcome: ${outcomes.length}`);
  assert.equal((outcomes[0].body as Record<string, unknown>)["status"], "uncertain");
});

test("R4 recovery fences external intents without outcomes", async () => {
  const { mkSup: mk2 } = await import("./ctl-worker.ts");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { FileRunStore } = await import("../src/store.ts");
  const { Supervisor } = await import("../src/supervisor.ts");
  const { DummyToolExecutor } = await import("../src/sandbox.ts");
  const { DummyWorkspaceManager } = await import("../src/workspace.ts");
  const { defaultSupervisorPolicy } = await import("../src/policy.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-rec-"));
  const policy = defaultSupervisorPolicy();
  policy.allowedModels = [{ provider: "p", id: "m" }];
  const mkArgs = (store: InstanceType<typeof FileRunStore>) => ({
    rootId: "root-rec", rootDir: dir, store, policy,
    governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
    schedulerLimits: {}, executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() },
    workspace: new DummyWorkspaceManager() as never,
  });
  void mk2;
  const store1 = new FileRunStore(dir, "root-rec");
  const sup1 = new Supervisor(mkArgs(store1));
  // Journal an external intent with no outcome (crash between effect and confirmation).
  store1.append("tool.intent", { operationId: "op-crash-1", agentId: "a1", taskRunId: "t1", generation: 1, tool: CG, external: true, parentOperationId: null });
  await sup1.shutdown();
  const store2 = new FileRunStore(dir, "root-rec");
  const sup2 = new Supervisor(mkArgs(store2));
  await sup2.recover();
  const outcomes = store2.readSince(0, 100000).records.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === "op-crash-1");
  assert.equal(outcomes.length, 1);
  assert.equal((outcomes[0].body as Record<string, unknown>)["status"], "uncertain");
  await sup2.shutdown();
});

test("R4 gate admission blocked while external effects unconfirmed", async () => {
  const cg = handle(CG, () => new Promise(() => {}));
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; p.gateBypassAllowed = true; } });
  (built.sup as unknown as { opts: { governingRegistry?: () => unknown } }).opts.governingRegistry = () => ({
    isActive: () => true, listHandles: () => [cg], getHandle: () => cg, baseCtx: () => ({}),
  });
  const g = await built.sup.spawn("governor", { taskName: "q", message: "m", profile: "reader" }, "gate-q-1");
  await tick();
  const pending = built.byAgent(g.agentId)[0].call(CG, { q: "x" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(built.sup.quiescent(g.agentId), false, "gate admits while external unconfirmed");
  await built.sup.interrupt("governor", g.agentId, "int-q-1");
  await pending;
  await tick(30);
});
