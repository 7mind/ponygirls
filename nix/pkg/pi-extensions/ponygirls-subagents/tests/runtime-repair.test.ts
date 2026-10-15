/**
 * Runtime repair regressions for review6 W1-W5 + review7 A-D + delayed prepare.
 *
 * Corrected premises (never weakened numeric/scope/effect assertions):
 * - W3 same-object swap denies AT PREPARE (no ticket minted), not at execute.
 * - B fenced: outer no-usage late event is truthfully null; filter nested op.
 * - D: no early pre-recover zero assert; live == ledger exact once.
 * - A: native public-validator parity ({n:null}->{n:0}); optional null normalizes.
 * - Race: tool-win + fence interleavings journal exactly one outcome; the
 *   durable canonical own receipt precedes the hook even when already fenced.
 * - Recover catch-up counts/dedupes AFTER the usage.reported append.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkerHandle } from "../src/worker-launch.ts";
import { bindChannel } from "../src/protocol.ts";
import { Supervisor } from "../src/supervisor.ts";
import { InMemoryRunStore, FileRunStore } from "../src/store.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { GoverningToolDispatcher } from "../src/external-dispatcher.ts";
import type { GoverningRegistry } from "../src/external-dispatcher.ts";
import { mkSup, tick } from "./ctl-worker.ts";

const SDK_ROOT = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? null;
const CG = "mcp__codegraph__codegraph_explore";

type AnyHandle = {
  name: string;
  description: string;
  parameters: unknown;
  prepareArguments?: (args: unknown) => unknown;
  execute: (...args: never[]) => Promise<unknown>;
};

function setRegistry(sup: Supervisor, reg: () => GoverningRegistry | null): void {
  (sup as unknown as { opts: { governingRegistry?: () => GoverningRegistry | null } }).opts.governingRegistry = reg;
}

function fakeHandle(name: string, impl: (...args: never[]) => Promise<unknown>): AnyHandle {
  return { name, description: `${name} d`, parameters: { type: "object" }, execute: impl };
}

const nativeOk = async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, truncated: false });

// ---------------------------------------------------------------- W1 ---
test("W1 oversize prepare settles promptly with error, zero effects (real worker)", async (t: TestContext) => {
  if (!SDK_ROOT) { t.skip("needs pinned SDK worker"); return; }
  let effects = 0;
  let resolutions = 0;
  const oversize: AnyHandle = {
    name: CG, description: "d", parameters: { type: "object" },
    prepareArguments: () => ({ data: "x".repeat(300_000) }),
    execute: (async () => { effects++; return { content: [{ type: "text", text: "must-not-run" }], details: {} }; }) as never,
  };
  const dir = mkdtempSync(join(tmpdir(), "subagents-w1r-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const policy = defaultSupervisorPolicy();
  policy.allowedModels = [{ provider: "p", id: "m" }];
  policy.allowedTools = [CG];
  const sup = new Supervisor({
    rootId: "root-w1r", rootDir: join(dir, "root"), store: new InMemoryRunStore("root-w1r"), policy,
    governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
    schedulerLimits: { maxRunnable: 2, maxResidentWorkers: 4, maxAgentsCreated: 8, maxDepth: 1 },
    executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() },
    workspace: new DummyWorkspaceManager(),
    workerFactory: (o) => {
      const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
      const hostAgentDir = join(dir, "host-agent");
      mkdirSync(hostAgentDir, { recursive: true });
      writeFileSync(join(hostAgentDir, "auth.json"), JSON.stringify({}));
      return new WorkerHandle({
        workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
        rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot: SDK_ROOT, deterministic: true,
        agentDir: join(dir, "worker-home", o.agentId), sessionsDir: join(dir, "sessions"), hostAgentDir,
        script: [{ tool: CG, args: { q: "x" } }, { text: "done" }],
      }, binding);
    },
    governingRegistry: () => ({
      isActive: () => true,
      listHandles: () => [oversize as never],
      getHandle: () => { resolutions++; return oversize as never; },
      baseCtx: () => ({}),
    }),
  });
  t.after(() => sup.shutdown().catch(() => {}));
  const g = await sup.spawn("governor", { taskName: "w1r", message: "go", profile: "reader" }, "w1r-1");
  let settled = false;
  const start = Date.now();
  while (Date.now() - start < 12000) {
    const recs = sup.runStore.readSince(0, 100000).records;
    if (recs.some((r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId)) { settled = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(settled, "oversize prepare hung");
  assert.equal(effects, 0, "oversize prepare executed");
  assert.ok(resolutions >= 1);
});

// ------------------------------------------------- W2 dispatcher ---
test("W2 same-object swap denies; stable and fresh wrapper allow", async () => {
  let newEffects = 0;
  const tool: AnyHandle = {
    name: CG, description: "same", parameters: { type: "object" },
    prepareArguments: () => {
      tool.execute = (async () => { newEffects++; return { content: [{ type: "text", text: "new" }], details: {} }; }) as never;
      return {};
    },
    execute: (async () => ({ content: [{ type: "text", text: "orig" }], details: {} })) as never,
  };
  const store = new InMemoryRunStore("w2r");
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }),
    nativeOk as never,
  );
  const res = await disp.execute(
    { agentId: "a", taskRunId: "t", generation: 1, grants: { tools: [], externalTools: [CG], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" }, workdir: "/tmp", writableRoot: null, sandbox: null } as never,
    { tool: CG, args: {} },
  );
  assert.equal(newEffects, 0);
  assert.equal(res.isError, true);

  let effects = 0;
  const stable: AnyHandle = {
    name: CG, description: "same", parameters: { type: "object" },
    prepareArguments: (a) => a,
    execute: (async () => { effects++; return { content: [{ type: "text", text: "ok" }], details: {} }; }) as never,
  };
  const disp2 = new GoverningToolDispatcher(
    new InMemoryRunStore("w2rb"),
    () => ({ isActive: () => true, listHandles: () => [stable as never], getHandle: () => stable as never, baseCtx: () => ({}) }),
    nativeOk as never,
  );
  const res2 = await disp2.execute(
    { agentId: "a", taskRunId: "t", generation: 1, grants: { tools: [], externalTools: [CG], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" }, workdir: "/tmp", writableRoot: null, sandbox: null } as never,
    { tool: CG, args: {} },
  );
  assert.equal(res2.isError, false);
  assert.equal(effects, 1);

  let freshEffects = 0;
  const impl = async () => { freshEffects++; return { content: [{ type: "text", text: "ok" }], details: {} }; };
  const prep = (a: unknown) => a;
  const first: AnyHandle = { name: CG, description: "same", parameters: { type: "object" }, prepareArguments: prep, execute: impl as never };
  const disp3 = new GoverningToolDispatcher(
    new InMemoryRunStore("w2rc"),
    () => ({ isActive: () => true, listHandles: () => [{ ...first } as never], getHandle: () => ({ ...first } as never), baseCtx: () => ({}) }),
    nativeOk as never,
  );
  const res3 = await disp3.execute(
    { agentId: "a", taskRunId: "t", generation: 1, grants: { tools: [], externalTools: [CG], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" }, workdir: "/tmp", writableRoot: null, sandbox: null } as never,
    { tool: CG, args: {} },
  );
  assert.equal(res3.isError, false);
  assert.equal(freshEffects, 1);
});

// --------------------------------- W3 ticket (corrected) ---
test("W3 same-object swap denies at prepare (no ticket, zero effects)", async () => {
  const tool: AnyHandle = {
    name: CG, description: "same", parameters: { type: "object" },
    prepareArguments: () => {
      tool.execute = (async () => ({ content: [{ type: "text", text: "new" }], details: {} })) as never;
      return {};
    },
    execute: (async () => ({ content: [{ type: "text", text: "orig" }], details: {} })) as never,
  };
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }));
  const g = await built.sup.spawn("governor", { taskName: "w3r", message: "m", profile: "reader" }, "w3r-1");
  await tick();
  const supAny = built.sup as unknown as {
    onPrepareRequest: (rt: unknown, worker: unknown, payload: unknown, env: unknown) => Promise<{ ok: boolean; error?: string }>;
  };
  const rtMap = (built.sup as unknown as { agents: Map<string, unknown> }).agents;
  const rt = rtMap.get(g.agentId);
  const worker = built.byAgent(g.agentId)[0];
  const env = { taskRunId: g.taskRunId, executionGeneration: g.generation };
  const prep = await supAny.onPrepareRequest(rt, worker, { tool: CG, args: {}, toolCallId: "tc-w3r" }, env);
  assert.equal(prep.ok, false, `swap must deny at prepare: ${JSON.stringify(prep)}`);
  assert.match(prep.error ?? "", /POLICY_DENIED|implementation changed/);
  await built.sup.shutdown();
});

test("W3 positive: stable handle mints single-use ticket (PrepOnce)", async () => {
  let effects = 0;
  const tool: AnyHandle = {
    name: CG, description: "same", parameters: { type: "object" },
    prepareArguments: (a) => a,
    execute: (async () => { effects++; return { content: [{ type: "text", text: "ok" }], details: {} }; }) as never,
  };
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }));
  const g = await built.sup.spawn("governor", { taskName: "w3pr", message: "m", profile: "reader" }, "w3pr-1");
  await tick();
  const rt = (built.sup as unknown as { agents: Map<string, unknown> }).agents.get(g.agentId);
  const worker = built.byAgent(g.agentId)[0];
  const env = { taskRunId: g.taskRunId, executionGeneration: g.generation };
  const supAny = built.sup as unknown as {
    onPrepareRequest: (rt: unknown, worker: unknown, payload: unknown, env: unknown) => Promise<{ ok: boolean; ticket?: string; error?: string }>;
    onToolRequest: (rt: unknown, worker: unknown, payload: unknown, env: unknown) => Promise<{ isError: boolean }>;
  };
  const prep = await supAny.onPrepareRequest(rt, worker, { tool: CG, args: {}, toolCallId: "tc-ok" }, env);
  assert.equal(prep.ok, true, prep.error);
  const first = await supAny.onToolRequest(rt, worker, { tool: CG, args: {}, ticket: prep.ticket, toolCallId: "tc-e1", usage: null }, env);
  assert.equal(first.isError, false);
  assert.equal(effects, 1);
  const replay = await supAny.onToolRequest(rt, worker, { tool: CG, args: {}, ticket: prep.ticket, toolCallId: "tc-e2", usage: null }, env);
  assert.equal(replay.isError, true);
  assert.equal(effects, 1);
  await built.sup.shutdown();
});

// ------------------------------------------------- W5 ---
test("W5 prepareOnly never quarantines (FileRunStore)", async () => {
  const T = "mcp__prep__tool";
  let effects = 0;
  const tool: AnyHandle = {
    name: T, description: "d", parameters: { type: "object" },
    prepareArguments: (a) => a,
    execute: (async () => { effects++; return { content: [{ type: "text", text: "x" }], details: {} }; }) as never,
  };
  const dir = mkdtempSync(join(tmpdir(), "subagents-w5r-"));
  const mkArgs = (store: FileRunStore) => ({ dir, store, policy: (p: { allowedTools: string[] }) => { p.allowedTools = [T]; } });
  const store1 = new FileRunStore(dir, "root-w5r");
  const first = mkSup(mkArgs(store1) as never);
  setRegistry(first.sup, () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }));
  const g = await first.sup.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "none" }, "w5r-1");
  await tick();
  const rt = (first.sup as unknown as { agents: Map<string, unknown> }).agents.get(g.agentId);
  const worker = first.byAgent(g.agentId)[0];
  const env = { taskRunId: g.taskRunId, executionGeneration: g.generation };
  const prep = await (first.sup as unknown as { onPrepareRequest: (rt: unknown, w: unknown, p: unknown, e: unknown) => Promise<{ ok: boolean }> }).onPrepareRequest(rt, worker, { tool: T, args: {}, toolCallId: "tc-w5r" }, env);
  assert.equal(prep.ok, true);
  const bash = await worker.call("bash", { command: "true" });
  assert.equal(bash.isError, false);
  await first.sup.shutdown();
  const store2 = new FileRunStore(dir, "root-w5r");
  const second = mkSup(mkArgs(store2) as never);
  setRegistry(second.sup, () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }));
  const report = await second.sup.recover();
  assert.deepEqual(report.quarantined, []);
  await second.sup.shutdown();
  rmSync(dir, { recursive: true, force: true });
  assert.equal(effects, 0);
});

// ------------------------------------------------- A ---
async function realPrepareHarness(t: TestContext, opts: { schema: unknown; prepare: (a: never) => unknown; scriptArgs: Record<string, unknown> }): Promise<{ prepareCalls: unknown[]; effects: unknown[] }> {
  const dir = mkdtempSync(join(tmpdir(), "subagents-ar-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const seen = { prepareCalls: [] as unknown[], effects: [] as unknown[] };
  const parent: AnyHandle = {
    name: CG, description: "preparable parent", parameters: opts.schema,
    prepareArguments: (a) => { seen.prepareCalls.push(a); return opts.prepare(a as never); },
    execute: (async (_id: unknown, params: unknown) => { seen.effects.push(params); return { content: [{ type: "text", text: "ok" }], details: {} }; }) as never,
  };
  const policy = defaultSupervisorPolicy();
  policy.allowedModels = [{ provider: "p", id: "m" }];
  policy.allowedTools = [CG];
  const sup = new Supervisor({
    rootId: "root-ar", rootDir: join(dir, "root"), store: new InMemoryRunStore("root-ar"), policy,
    governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
    schedulerLimits: { maxRunnable: 2, maxResidentWorkers: 4, maxAgentsCreated: 8, maxDepth: 1 },
    executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() },
    workspace: new DummyWorkspaceManager(),
    workerFactory: (o) => {
      const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
      const hostAgentDir = join(dir, "host-agent");
      mkdirSync(hostAgentDir, { recursive: true });
      writeFileSync(join(hostAgentDir, "auth.json"), JSON.stringify({}));
      return new WorkerHandle({
        workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
        rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot: SDK_ROOT, deterministic: true,
        agentDir: join(dir, "worker-home", o.agentId), sessionsDir: join(dir, "sessions"), hostAgentDir,
        script: [{ tool: CG, args: opts.scriptArgs }, { text: "done" }],
      }, binding);
    },
    governingRegistry: () => ({ isActive: () => true, listHandles: () => [parent as never], getHandle: () => parent as never, baseCtx: () => ({}) }),
  });
  t.after(() => sup.shutdown().catch(() => {}));
  const g = await sup.spawn("governor", { taskName: "ar", message: "go", profile: "reader" }, `ar-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const start = Date.now();
  while (Date.now() - start < 60000) {
    const recs = sup.runStore.readSince(0, 100000).records;
    if (recs.some((r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return seen;
}

test("A normalized numeric; required null native parity; optional null normalizes", async (t: TestContext) => {
  if (!SDK_ROOT) { t.skip("needs SDK worker"); return; }
  const schema = { type: "object", properties: { n: { type: "number" } }, required: ["n"] };
  const seen = await realPrepareHarness(t, { schema, prepare: (a: never) => a, scriptArgs: { n: "3" } });
  assert.equal(seen.effects.length, 1);
  assert.strictEqual((seen.effects[0] as Record<string, unknown>)["n"], 3);

  // Native public-validator parity: required number null coerces to 0
  // (exact MODEL schema, oneOf/anyOf via public validator only).
  const seenNull = await realPrepareHarness(t, { schema, prepare: (a: never) => a, scriptArgs: { n: null as never } });
  assert.equal(seenNull.effects.length, 1);
  assert.strictEqual((seenNull.effects[0] as Record<string, unknown>)["n"], 0);

  const optSchema = { type: "object", properties: { n: { type: "number" } } };
  const seenOpt = await realPrepareHarness(t, { schema: optSchema, prepare: (a: never) => a, scriptArgs: { n: null as never } });
  assert.equal(seenOpt.effects.length, 1);
  assert.deepEqual(seenOpt.effects[0], {});
});

// ------------------------------------------------- B ---
test("B nested late canonical unfenced + one hook", async () => {
  const INNER = "mcp__n__x";
  let release!: (v?: unknown) => void;
  const gate = new Promise((r) => { release = r as never; });
  const inner = fakeHandle(INNER, () => gate.then(() => ({ content: [{ type: "text", text: "late" }], details: {}, usage: { input: 7, output: 3, cost: 1 } })) as never);
  const outer = fakeHandle(CG, (async (_id: unknown, _p: unknown, _s: unknown, _u: unknown, ctx: { executeTool: (n: string, a: unknown) => Promise<unknown> }) => {
    await ctx.executeTool(INNER, {});
    return { content: [{ type: "text", text: "out" }], details: {} };
  }) as never);
  const store = new InMemoryRunStore("br");
  const reports: Array<{ usage: unknown }> = [];
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [outer as never, inner as never], getHandle: (n: string) => (n === CG ? outer : inner) as never, baseCtx: () => ({}) }),
    nativeOk as never,
    { onUsage: (info) => { reports.push(info as never); } },
  );
  const caller = { agentId: "a1", taskRunId: "t1", generation: 1, grants: { tools: [], externalTools: [CG, INNER], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" }, workdir: "/tmp", writableRoot: null, sandbox: null };
  const pending = disp.execute(caller as never, { tool: CG, args: {} });
  await new Promise((r) => setTimeout(r, 20));
  await disp.cancelJobs("a1");
  await pending;
  release();
  await new Promise((r) => setTimeout(r, 50));
  const recs = store.readSince(0, 100000).records;
  const nestedOutcome = recs.filter((r) => r.kind === "tool.outcome").find((r) => {
    const intent = recs.find((i) => i.kind === "tool.intent" && (i.body as Record<string, unknown>)["operationId"] === (r.body as Record<string, unknown>)["operationId"]);
    return intent && (intent.body as Record<string, unknown>)["parentOperationId"] != null;
  });
  assert.ok(nestedOutcome);
  assert.deepEqual((nestedOutcome!.body as Record<string, unknown>)["usage"], { input: 7, output: 3, cost: 1, unknown: true });
  const innerReports = reports.filter((r) => (r.usage as Record<string, unknown>)?.["input"] === 7);
  assert.equal(innerReports.length, 1);
  assert.deepEqual(innerReports[0].usage, { input: 7, output: 3, cost: 1, unknown: true });
});

test("B fenced nested receipt canonical + valid SDK 450k preserved", async () => {
  const INNER = "mcp__n__x";
  let release!: (v?: unknown) => void;
  const gate = new Promise((r) => { release = r as never; });
  const inner = fakeHandle(INNER, () => gate.then(() => ({ content: [{ type: "text", text: "late" }], details: {}, usage: { input: 7, output: 3, cost: 1 } })) as never);
  const outer = fakeHandle(CG, (async (_id: unknown, _p: unknown, _s: unknown, _u: unknown, ctx: { executeTool: (n: string, a: unknown) => Promise<unknown> }) => {
    await ctx.executeTool(INNER, {});
    return { content: [{ type: "text", text: "out" }], details: {} };
  }) as never);
  const store = new InMemoryRunStore("brf");
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [outer as never, inner as never], getHandle: (n: string) => (n === CG ? outer : inner) as never, baseCtx: () => ({}) }),
    nativeOk as never,
    { onUsage: () => {} },
  );
  const caller = { agentId: "a1", taskRunId: "t1", generation: 1, grants: { tools: [], externalTools: [CG, INNER], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" }, workdir: "/tmp", writableRoot: null, sandbox: null };
  const pending = disp.execute(caller as never, { tool: CG, args: {} });
  await new Promise((r) => setTimeout(r, 20));
  await disp.cancelJobs("a1");
  await pending;
  await disp.fenceAgent("a1", "test fence");
  release();
  await new Promise((r) => setTimeout(r, 50));
  const recs = store.readSince(0, 100000).records;
  const recoveries = recs.filter((r) => r.kind === "recovery.event" && (r.body as Record<string, unknown>)["phase"] === "external-late-settlement");
  const nested = recoveries.find((r) => ((r.body as Record<string, unknown>)["usage"] as Record<string, unknown> | null)?.["input"] === 7);
  assert.ok(nested, `no nested canonical event; got ${JSON.stringify(recoveries.map((r) => r.body))}`);
  assert.deepEqual((nested!.body as Record<string, unknown>)["usage"], { input: 7, output: 3, cost: 1, unknown: true });

  const { boundExternalResult } = await import("../src/governing-runtime.ts");
  const validUsage = { input: 11, output: 7, cacheRead: 1, cacheWrite: 2, totalTokens: 21, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 } };
  const big = boundExternalResult({ content: [{ type: "text", text: "x".repeat(450_000) }], details: {}, usage: validUsage });
  assert.deepEqual(big.usage, validUsage);
});

test("B fault then restart totals once (FileRunStore)", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => { unhandled.push(e); };
  process.on("unhandledRejection", onUnhandled);
  try {
    let faultArmed = false;
    class Flaky extends FileRunStore {
      override append(kind: never, body: never): never {
        if (faultArmed && kind === "usage.reported" && (body as unknown as Record<string, unknown>)?.["external"] === true) {
          faultArmed = false;
          throw Object.assign(new Error("injected fault"), { code: "STORE_FAILED" });
        }
        return super.append(kind as never, body as never) as never;
      }
    }
    const INNER = "mcp__n__x";
    let release!: (v?: unknown) => void;
    const gate = new Promise((r) => { release = r as never; });
    const inner = fakeHandle(INNER, () => gate.then(() => ({ content: [{ type: "text", text: "late" }], details: {}, usage: { input: 7, output: 3, cost: 1 } })) as never);
    const outer = fakeHandle(CG, (async (_id: unknown, _p: unknown, _s: unknown, _u: unknown, ctx: { executeTool: (n: string, a: unknown) => Promise<unknown> }) => {
      await ctx.executeTool(INNER, {});
      return { content: [{ type: "text", text: "out" }], details: {} };
    }) as never);
    const reg = () => ({ isActive: () => true, listHandles: () => [outer as never, inner as never], getHandle: (n: string) => (n === CG ? outer : inner) as never, baseCtx: () => ({}) });
    const dir = mkdtempSync(join(tmpdir(), "subagents-br-"));
    const store1 = new Flaky(dir, "root-br");
    const first = mkSup({ dir, store: store1 as never, policy: (p) => { p.allowedTools = [CG, INNER]; } });
    setRegistry(first.sup, reg as never);
    const g = await first.sup.spawn("governor", { taskName: "b", message: "m", profile: "reader" }, "br-1");
    await tick();
    const pending = first.byAgent(g.agentId)[0].call(CG, {});
    await new Promise((r) => setTimeout(r, 20));
    await first.sup.interrupt("governor", g.agentId, "int-br-1");
    await pending;
    faultArmed = true;
    release();
    await tick(150);
    faultArmed = false;
    await first.sup.shutdown();
    const store2 = new Flaky(dir, "root-br");
    const second = mkSup({ dir, store: store2 as never, policy: (p) => { p.allowedTools = [CG, INNER]; } });
    setRegistry(second.sup, reg as never);
    await second.sup.recover();
    const reported = store2.readSince(0, 100000).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["external"] === true);
    const partial = reported.filter((r) => (r.body as Record<string, unknown>)["input"] === 7);
    assert.equal(unhandled.length, 0);
    assert.equal(partial.length, 1);
    assert.deepEqual(
      { input: (partial[0].body as Record<string, unknown>)["input"], output: (partial[0].body as Record<string, unknown>)["output"], cost: (partial[0].body as Record<string, unknown>)["cost"], unknown: (partial[0].body as Record<string, unknown>)["unknown"] ?? false },
      { input: 7, output: 3, cost: 1, unknown: true },
    );
    await second.sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
  }
});

// ------------------------------------------------- C ---
test("C recover retires pending jobs; retained scope denies; late once", async () => {
  const INNER = "mcp__n__x";
  let release!: (v?: unknown) => void;
  const gate = new Promise((r) => { release = r as never; });
  let retainedCtx: { executeTool: (n: string, a: unknown) => Promise<{ isError: boolean }> } | null = null;
  const inner: AnyHandle = {
    name: INNER, description: "d", parameters: { type: "object" },
    execute: (async (_id: unknown, _p: unknown, _s: unknown, _u: unknown, ctx: unknown) => {
      retainedCtx = ctx as never;
      await gate;
      return { content: [{ type: "text", text: "late" }], details: {}, usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    }) as never,
  };
  const outer = fakeHandle(CG, (async (_id: unknown, _p: unknown, _s: unknown, _u: unknown, ctx: { executeTool: (n: string, a: unknown) => Promise<unknown> }) => {
    await ctx.executeTool(INNER, {});
    return { content: [{ type: "text", text: "out" }], details: {} };
  }) as never);
  const reg = () => ({ isActive: () => true, listHandles: () => [outer as never, inner as never], getHandle: (n: string) => (n === CG ? outer : inner) as never, baseCtx: () => ({}) });
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG, INNER]; } });
  setRegistry(built.sup, reg as never);
  const g = await built.sup.spawn("governor", { taskName: "c", message: "m", profile: "reader" }, "cr-1");
  await tick();
  const pending = built.byAgent(g.agentId)[0].call(CG, {});
  await new Promise((r) => setTimeout(r, 30));
  await built.sup.recover();
  assert.ok(retainedCtx, "inner never ran");
  release("go");
  const res = await pending;
  assert.equal(res.isError, true);
  const recs = built.sup.runStore.readSince(0, 100000).records;
  const oks = recs.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["status"] === "ok");
  assert.equal(oks.length, 0);
  const again = await (retainedCtx as unknown as { executeTool: (n: string, a: unknown) => Promise<{ isError: boolean }> }).executeTool(INNER, {});
  assert.equal(again.isError, true);
  await built.sup.shutdown();
});

test("C fresh restart with pending invocation: no new ok", async () => {
  const INNER = "mcp__n__x";
  const gateHolder: { release?: (v?: unknown) => void } = {};
  const gate = new Promise((r) => { gateHolder.release = r as never; });
  const inner: AnyHandle = {
    name: INNER, description: "d", parameters: { type: "object" },
    execute: (async () => {
      await gate;
      return { content: [{ type: "text", text: "in" }], details: {}, usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 6, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    }) as never,
  };
  const outer = fakeHandle(CG, (async (_id: unknown, _p: unknown, _s: unknown, _u: unknown, ctx: { executeTool: (n: string, a: unknown) => Promise<unknown> }) => {
    await ctx.executeTool(INNER, {});
    return { content: [{ type: "text", text: "out" }], details: {} };
  }) as never);
  const reg = () => ({ isActive: () => true, listHandles: () => [outer as never, inner as never], getHandle: (n: string) => (n === CG ? outer : inner) as never, baseCtx: () => ({}) });
  const dir = mkdtempSync(join(tmpdir(), "subagents-cr-"));
  const store1 = new FileRunStore(dir, "root-cr");
  const first = mkSup({ dir, store: store1 as never, policy: (p) => { p.allowedTools = [CG, INNER]; } });
  setRegistry(first.sup, reg as never);
  const g = await first.sup.spawn("governor", { taskName: "c", message: "m", profile: "reader" }, "crf-1");
  await tick();
  const pending = first.byAgent(g.agentId)[0].call(CG, {});
  await new Promise((r) => setTimeout(r, 20));
  await first.sup.interrupt("governor", g.agentId, "int-crf");
  await pending;
  await first.sup.shutdown();
  const store2 = new FileRunStore(dir, "root-cr");
  const second = mkSup({ dir, store: store2 as never, policy: (p) => { p.allowedTools = [CG, INNER]; } });
  setRegistry(second.sup, reg as never);
  await second.sup.recover();
  gateHolder.release!();
  await tick(100);
  const recs = store2.readSince(0, 100000).records;
  const oks = recs.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["status"] === "ok");
  assert.equal(oks.length, 0, `pending release created ok: ${JSON.stringify(oks.map((r) => r.body))}`);
  await second.sup.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------- D ---
test("D faulted accounting exact once: live == ledger", async () => {
  let faultArmed = false;
  class Flaky extends InMemoryRunStore {
    override append(kind: never, body: never): never {
      if (faultArmed && kind === "usage.reported") {
        faultArmed = false;
        throw Object.assign(new Error("injected fault"), { code: "STORE_FAILED" });
      }
      return super.append(kind as never, body as never) as never;
    }
  }
  const cg: AnyHandle = {
    name: CG, description: "d", parameters: { type: "object" },
    execute: (async () => ({
      content: [{ type: "text", text: "x" }], details: {},
      usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    })) as never,
  };
  const store = new Flaky("root-dr");
  const built = mkSup({ store: store as never, policy: (p) => { p.allowedTools = [CG]; } });
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [cg as never], getHandle: () => cg as never, baseCtx: () => ({}) }));
  const g = await built.sup.spawn("governor", { taskName: "d", message: "m", profile: "reader" }, "dr-1");
  await tick();
  faultArmed = true;
  const res = await built.byAgent(g.agentId)[0].call(CG, {});
  faultArmed = false;
  assert.equal(res.isError, false);
  const extReports = () => store.readSince(0, 100000).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["external"] === true);
  const liveView = () => {
    const v = built.sup.list("governor").find((x) => x.id === g.agentId)!;
    return { input: v.usage.inputTokens, output: v.usage.outputTokens };
  };
  assert.equal(extReports().length, 0);
  assert.deepEqual(liveView(), { input: 0, output: 0 });
  built.byAgent(g.agentId)[0].crash();
  await tick(100);
  await built.sup.recover();
  const after = extReports();
  assert.equal(after.length, 1);
  assert.deepEqual({ input: (after[0].body as Record<string, unknown>)["input"], output: (after[0].body as Record<string, unknown>)["output"] }, { input: 5, output: 7 });
  const ledger = store.readSince(0, 100000).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["agentId"] === g.agentId);
  const expected = ledger.reduce((sum, r) => ({ input: sum.input + Number((r.body as Record<string, unknown>)["input"] ?? 0), output: sum.output + Number((r.body as Record<string, unknown>)["output"] ?? 0) }), { input: 0, output: 0 });
  assert.deepEqual(liveView(), expected);
  const viewed = built.sup.read("governor", g.agentId, "status", 0, 20, null);
  assert.deepEqual({ input: viewed.status.usage.inputTokens, output: viewed.status.usage.outputTokens }, expected);
  const { boundExternalResult } = await import("../src/governing-runtime.ts");
  const wire = boundExternalResult({ content: [{ type: "text", text: "x" }], details: {}, usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  assert.deepEqual(wire.usage, { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  await built.sup.shutdown();
});

// --------------------------------- delayed prepare ---
test("delayed prepare errors once, no fallback; late ignored (real worker, delayed response)", async (t: TestContext) => {
  if (!SDK_ROOT) { t.skip("needs SDK worker"); return; }
  let prepareCalls = 0;
  let effects = 0;
  const prepareEntries: number[] = [];
  let responseArrivedAt: number | null = null;
  let arrivalResolve: (() => void) | null = null;
  const arrivalLatch = new Promise<void>((r) => { arrivalResolve = r; });
  // Sync parent preparation (public prepareArguments contract); the 12s
  // delay is in the SUPPORTED preparation RPC response (async transport
  // handler via non-blocking sleep), not an async parent function and not a
  // busy-loop. Worker 10s timeout hard-errors first. Handler entry and
  // ACTUAL response arrival are both recorded: cleanup is asserted only
  // after the late arrival latch fires, never from wallclock since spawn.
  const parent: AnyHandle = {
    name: CG, description: "d", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    prepareArguments: ((a: unknown) => { prepareCalls++; prepareEntries.push(Date.now()); return a; }) as never,
    execute: (async () => { effects++; return { content: [{ type: "text", text: "must-not-run" }], details: {} }; }) as never,
  };
  const dir = mkdtempSync(join(tmpdir(), "subagents-dr2-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sup = new Supervisor({
    rootId: "root-dr2", rootDir: join(dir, "root"), store: new InMemoryRunStore("root-dr2"),
    policy: (() => { const p = defaultSupervisorPolicy(); p.allowedModels = [{ provider: "p", id: "m" }]; p.allowedTools = [CG]; return p; })(),
    governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
    schedulerLimits: { maxRunnable: 2, maxResidentWorkers: 4, maxAgentsCreated: 8, maxDepth: 1 },
    executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() },
    workspace: new DummyWorkspaceManager(),
    workerFactory: (o) => {
      const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
      const hostAgentDir = join(dir, "host-agent");
      mkdirSync(hostAgentDir, { recursive: true });
      writeFileSync(join(hostAgentDir, "auth.json"), JSON.stringify({}));
      const handle = new WorkerHandle({
        workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
        rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot: SDK_ROOT, deterministic: true,
        agentDir: join(dir, "worker-home", o.agentId), sessionsDir: join(dir, "sessions"), hostAgentDir,
        script: [{ tool: CG, args: { q: "slow" } }, { text: "done" }],
      }, binding);
      // Delay the PREPARATION RESPONSE 12s (non-blocking) at the transport
      // handler; parent prepare itself stays sync and fast (called once
      // immediately, response held). Worker 10s timeout hard-errors first.
      const origSetPrepare = handle.setPrepareRequestHandler.bind(handle);
      handle.setPrepareRequestHandler = ((h: (payload: unknown, env: unknown) => Promise<unknown>) => {
        return origSetPrepare((async (payload: unknown, env: unknown) => {
          const res = await h(payload, env);
          await new Promise((r) => setTimeout(r, 12000));
          responseArrivedAt = Date.now();
          arrivalResolve?.();
          return res;
        }) as never);
      }) as typeof handle.setPrepareRequestHandler;
      return handle;
    },
    governingRegistry: () => ({ isActive: () => true, listHandles: () => [parent as never], getHandle: () => parent as never, baseCtx: () => ({}) }),
  });
  t.after(() => sup.shutdown().catch(() => {}));
  const g = await sup.spawn("governor", { taskName: "dr2", message: "go", profile: "reader" }, `dr2-${Date.now()}`);
  const recs = () => sup.runStore.readSince(0, 100000).records;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if (recs().some((r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  // Late cleanup is only verified after the ACTUAL late SUPPORTED response
  // arrival latch fires (12s): stopping at the 10s timeout would never
  // observe the late ignore or the ticket/lease cleanup. Checkpoint, effect,
  // and prepare assertions below all run past the late arrival.
  await Promise.race([
    arrivalLatch,
    new Promise((_, reject) => setTimeout(() => reject(new Error("late prepare response never arrived")), 25000)),
  ]);
  assert.ok(responseArrivedAt !== null && prepareEntries.length === 1, "handler entry and arrival both recorded");
  assert.ok(
    responseArrivedAt - prepareEntries[0]! > 10000,
    `late arrival must postdate the 10s worker timeout (entry=${prepareEntries[0]} arrival=${responseArrivedAt})`,
  );
  const walk = (d: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  };
  const sessionBytes = walk(join(dir, "sessions")).map((f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } }).join("\n");
  assert.equal(prepareCalls, 1, "delayed prepare repeated or fell back");
  assert.equal(effects, 0, "delayed prepare executed after timeout");
  assert.ok(sessionBytes.includes("timed out"), "no timeout error in transcript");
  // Ticket/lease/map cleanup after the NORMAL terminal with the late answer
  // already arrived-and-ignored: purge-on-settle drops the ticket the timed
  // out worker never learned, with no worker-knows-ticket assumption.
  const leftover = [...(sup as unknown as { preparedTickets: Map<string, { agentId: string }> }).preparedTickets.values()]
    .filter((tk) => tk.agentId === g.agentId);
  assert.equal(leftover.length, 0, `unreleased prepared tickets remain: ${leftover.length}`);
});

// --------------------------------- parallel overlap ---
test("parallel overlap scopes stay isolated", async () => {
  const A = "mcp__a__x", B = "mcp__b__y";
  const releaseA = { fn: null as null | (() => void) };
  const gateA = new Promise<void>((r) => { releaseA.fn = () => r(); });
  const toolA = fakeHandle(A, () => gateA.then(() => ({ content: [{ type: "text", text: "a" }], details: {}, usage: { input: 1, output: 1 } })) as never);
  const toolB = fakeHandle(B, async () => ({ content: [{ type: "text", text: "b" }], details: {}, usage: { input: 2, output: 2 } }));
  const store = new InMemoryRunStore("par");
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [toolA as never, toolB as never], getHandle: (n: string) => (n === A ? toolA : toolB) as never, baseCtx: () => ({}) }),
    nativeOk as never,
    { onUsage: () => {} },
  );
  const base = { agentId: "a1", generation: 1, grants: { tools: [], externalTools: [A, B], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" }, workdir: "/tmp", writableRoot: null, sandbox: null };
  const pA = disp.execute({ ...base, taskRunId: "t1" } as never, { tool: A, args: {}, operationId: "op-a" });
  await new Promise((r) => setTimeout(r, 10));
  const rB = await disp.execute({ ...base, taskRunId: "t2" } as never, { tool: B, args: {}, operationId: "op-b" });
  assert.equal(rB.isError, false);
  releaseA.fn!();
  const rA = await pA;
  assert.equal(rA.isError, false);
  const outcomes = store.readSince(0, 100000).records.filter((r) => r.kind === "tool.outcome");
  assert.equal(outcomes.length, 2);
});

// --------------------------------- race: tool-win + fence interleavings ---
test("race matrix: release-then-fence at microtask depths journals one outcome", async () => {
  // Regression for the top-level tool-win + fence race: the winner settles
  // while fenceAgentNow journals first; exactly one tool.outcome must exist
  // per invocation, with the durable canonical own receipt (40/20) and a
  // single ledger hook — at every interleaving depth.
  const T = "mcp__race__tool";
  const USAGE = {
    input: 40, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 60,
    cost: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, total: 6 },
  };
  const qtick = (): Promise<void> => new Promise((r) => queueMicrotask(r as never));
  for (let depth = 0; depth <= 10; depth++) {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const tool = fakeHandle(T, () => gate.then(() => ({
      content: [{ type: "text", text: "done" }], details: {}, usage: { ...USAGE },
    })) as never);
    const store = new InMemoryRunStore(`race-m-${depth}`);
    const reports: Array<{ operationId: string; usage: unknown }> = [];
    const disp = new GoverningToolDispatcher(
      store,
      () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }),
      nativeOk as never,
      { onUsage: (info) => { reports.push(info as never); } },
    );
    const op = `op-race-m-${depth}`;
    const caller = {
      agentId: "a1", taskRunId: `t-race-m-${depth}`, generation: 1,
      grants: { tools: [], externalTools: [T], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" },
      workdir: "/tmp", writableRoot: null, sandbox: null,
    };
    const pending = disp.execute(caller as never, { tool: T, args: {}, operationId: op });
    await new Promise((r) => setTimeout(r, 20));
    release();
    for (let i = 0; i < depth; i++) await qtick();
    const fenced = disp.fenceAgentNow("a1", "probe fence");
    const res = await pending;
    await new Promise((r) => setTimeout(r, 50));
    const recs = store.readSince(0, 100000).records;
    const outs = recs.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === op);
    assert.equal(outs.length, 1, `depth=${depth} fenced=[${fenced}] isError=${res.isError}: expected one outcome, got ${outs.length}`);
    const own = reports.filter((r) => r.operationId === op);
    assert.equal(own.length, 1, `depth=${depth}: hook must fire exactly once`);
    if (fenced.includes(op)) {
      // Fence won the journal: single uncertain outcome + durable late receipt.
      assert.equal(outs[0].body.status, "uncertain", `depth=${depth}`);
      const evts = recs.filter((r) => r.kind === "recovery.event" && (r.body as Record<string, unknown>)["phase"] === "external-late-settlement" && (r.body as Record<string, unknown>)["operationId"] === op);
      assert.equal(evts.length, 1, `depth=${depth}: fenced late receipt must be journaled before the hook`);
      assert.deepEqual((evts[0].body as Record<string, unknown>)["usage"], { input: 40, output: 20, cost: 6 });
      assert.deepEqual((own[0].usage as Record<string, unknown>)["input"], 40);
    } else {
      // Tool settled first: single ok with canonical usage, ledger once.
      assert.equal(outs[0].body.status, "ok", `depth=${depth}`);
      assert.deepEqual((outs[0].body as Record<string, unknown>)["usage"], { input: 40, output: 20, cost: 6 });
    }
  }
});

test("race nested: tool-win + top fence keeps one nested outcome + receipt", async () => {
  // Nested variant: the inner winner settles while a top fence already
  // journaled; exactly one nested outcome plus one durable late receipt.
  const INNER = "mcp__n__x";
  const USAGE = {
    input: 40, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 60,
    cost: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, total: 6 },
  };
  const qtick = (): Promise<void> => new Promise((r) => queueMicrotask(r as never));
  for (let depth = 0; depth <= 8; depth++) {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const inner = fakeHandle(INNER, () => gate.then(() => ({
      content: [{ type: "text", text: "late" }], details: {}, usage: { ...USAGE },
    })) as never);
    const outer = fakeHandle(CG, (async (_id: unknown, _p: unknown, _s: unknown, _u: unknown, ctx: { executeTool: (n: string, a: unknown) => Promise<unknown> }) => {
      await ctx.executeTool(INNER, {});
      return { content: [{ type: "text", text: "out" }], details: {} };
    }) as never);
    const store = new InMemoryRunStore(`race-n-${depth}`);
    const reports: Array<{ operationId: string; usage: unknown }> = [];
    const disp = new GoverningToolDispatcher(
      store,
      () => ({ isActive: () => true, listHandles: () => [outer as never, inner as never], getHandle: (n: string) => (n === CG ? outer : inner) as never, baseCtx: () => ({}) }),
      nativeOk as never,
      { onUsage: (info) => { reports.push(info as never); } },
    );
    const caller = {
      agentId: "a1", taskRunId: `t-race-n-${depth}`, generation: 1,
      grants: { tools: [], externalTools: [CG, INNER], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" },
      workdir: "/tmp", writableRoot: null, sandbox: null,
    };
    const pending = disp.execute(caller as never, { tool: CG, args: {} });
    await new Promise((r) => setTimeout(r, 20));
    release();
    for (let i = 0; i < depth; i++) await qtick();
    disp.fenceAgentNow("a1", "probe fence");
    await pending;
    await new Promise((r) => setTimeout(r, 50));
    const recs = store.readSince(0, 100000).records;
    const nestedOuts = recs.filter((r) => {
      if (r.kind !== "tool.outcome") return false;
      const intent = recs.find((i) => i.kind === "tool.intent" && (i.body as Record<string, unknown>)["operationId"] === (r.body as Record<string, unknown>)["operationId"]);
      return !!intent && (intent.body as Record<string, unknown>)["parentOperationId"] != null;
    });
    assert.equal(nestedOuts.length, 1, `depth=${depth}: exactly one nested outcome, got ${nestedOuts.length}`);
    const innerReports = reports.filter((r) => (r.usage as Record<string, unknown>)?.["input"] === 40);
    assert.equal(innerReports.length, 1, `depth=${depth}: nested ledger hook exactly once`);
  }
});

// --------------------------------- recover catch-up fault + retry ---
test("recover catch-up fault retries to exact ledger (same supervisor)", async () => {
  // Normal-hook fault orphans a canonical 5/7 outcome; then the RECOVERY
  // append itself faults once (observable STORE_FAILED, no phantom counters)
  // and the same-instance retry completes to the exact committed ledger.
  let armNormal = false;
  let armRecovery = false;
  class Flaky extends InMemoryRunStore {
    override append(kind: never, body: never): never {
      const b = body as unknown as Record<string, unknown>;
      if (kind === "usage.reported" && b?.["external"] === true) {
        if (armNormal && b?.["recovered"] !== true) {
          armNormal = false;
          throw Object.assign(new Error("injected STORE_FAILED (normal hook)"), { code: "STORE_FAILED" });
        }
        if (armRecovery && b?.["recovered"] === true) {
          armRecovery = false;
          throw Object.assign(new Error("injected STORE_FAILED (recovery catch-up)"), { code: "STORE_FAILED" });
        }
      }
      return super.append(kind as never, body as never) as never;
    }
  }
  const cg: AnyHandle = {
    name: CG, description: "d", parameters: { type: "object" },
    execute: (async () => ({
      content: [{ type: "text", text: "x" }], details: {},
      usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    })) as never,
  };
  const store = new Flaky("root-rcr");
  const built = mkSup({ store: store as never, policy: (p) => { p.allowedTools = [CG]; } });
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [cg as never], getHandle: () => cg as never, baseCtx: () => ({}) }));
  const g = await built.sup.spawn("governor", { taskName: "d", message: "m", profile: "reader" }, "rcr-1");
  await tick();
  armNormal = true;
  const res = await built.byAgent(g.agentId)[0].call(CG, {});
  assert.equal(res.isError, false);
  built.byAgent(g.agentId)[0].crash();
  await tick(100);
  armRecovery = true;
  let firstErr: unknown = null;
  try {
    await built.sup.recover();
  } catch (e) {
    firstErr = e;
  }
  assert.ok(firstErr, "faulted recovery append must surface (STORE_FAILED), never swallowed");
  assert.match(String((firstErr as { code?: string })?.code ?? firstErr), /STORE_FAILED/);
  const report = await built.sup.recover();
  assert.ok(report, "same-instance retry must succeed after the fault");
  // Post-retry logging precedes the equivalence asserts (no early phantom
  // assert decides the outcome).
  const liveNow = (() => {
    const v = built.sup.list("governor").find((x) => x.id === g.agentId)!;
    return { input: v.usage.inputTokens, output: v.usage.outputTokens };
  })();
  const cumNow = built.sup.rootUsage();
  const rows = store.readSince(0, 100000).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["agentId"] === g.agentId);
  const ledger = rows.reduce((sum, r) => ({ input: sum.input + Number((r.body as Record<string, unknown>)["input"] ?? 0), output: sum.output + Number((r.body as Record<string, unknown>)["output"] ?? 0) }), { input: 0, output: 0 });
  console.log(`recover-retry post-retry live=${JSON.stringify(liveNow)} cumulative={input:${cumNow.inputTokens},output:${cumNow.outputTokens}} ledger=${JSON.stringify(ledger)} rows=${rows.length}`);
  const ext = rows.filter((r) => (r.body as Record<string, unknown>)["external"] === true);
  assert.equal(ext.length, 1, "exactly one external receipt after retry");
  assert.deepEqual({ input: (ext[0].body as Record<string, unknown>)["input"], output: (ext[0].body as Record<string, unknown>)["output"] }, { input: 5, output: 7 });
  assert.deepEqual(liveNow, ledger, "live must equal committed ledger after retry");
  assert.deepEqual({ input: cumNow.inputTokens, output: cumNow.outputTokens }, ledger, "cumulative must equal committed ledger after retry");
  await built.sup.shutdown();
});

test("recover catch-up fault retries to exact ledger (fresh restart, same retry)", async () => {
  // Fresh-restarted supervisor over the same FileRunStore: recovery append
  // faults once (STORE_FAILED), the same instance retries once to the exact
  // committed ledger.
  let armNormal = false;
  let armRecovery = false;
  class FlakyFile extends FileRunStore {
    override append(kind: never, body: never): never {
      const b = body as unknown as Record<string, unknown>;
      if (kind === "usage.reported" && b?.["external"] === true) {
        if (armNormal && b?.["recovered"] !== true) {
          armNormal = false;
          throw Object.assign(new Error("injected STORE_FAILED (normal hook)"), { code: "STORE_FAILED" });
        }
        if (armRecovery && b?.["recovered"] === true) {
          armRecovery = false;
          throw Object.assign(new Error("injected STORE_FAILED (recovery catch-up)"), { code: "STORE_FAILED" });
        }
      }
      return super.append(kind as never, body as never) as never;
    }
  }
  const cg: AnyHandle = {
    name: CG, description: "d", parameters: { type: "object" },
    execute: (async () => ({
      content: [{ type: "text", text: "x" }], details: {},
      usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    })) as never,
  };
  const reg = () => ({ isActive: () => true, listHandles: () => [cg as never], getHandle: () => cg as never, baseCtx: () => ({}) });
  const { mkdtempSync: mkd } = await import("node:fs");
  const dir = mkd(join(tmpdir(), "subagents-rcrf-"));
  try {
    const store1 = new FlakyFile(dir, "root-rcrf");
    const first = mkSup({ dir, store: store1 as never, policy: (p) => { p.allowedTools = [CG]; } });
    setRegistry(first.sup, reg as never);
    const g = await first.sup.spawn("governor", { taskName: "d", message: "m", profile: "reader" }, "rcrf-1");
    await tick();
    armNormal = true;
    const res = await first.byAgent(g.agentId)[0].call(CG, {});
    assert.equal(res.isError, false);
    await first.sup.shutdown();
    // Fresh attach bills the orphan automatically via constructor
    // catch-up — but a fault there must surface, not silently attach
    // unbilled. Throwing out of the constructor would strand the
    // just-acquired root lock, so the fault flags explicit recovery instead:
    // needsRecovery turns true, and the next recover() throws STORE_FAILED
    // visibly (or bills, once healed).
    armRecovery = true;
    const store2 = new FlakyFile(dir, "root-rcrf");
    const second = mkSup({ dir, store: store2 as never, policy: (p) => { p.allowedTools = [CG]; } });
    setRegistry(second.sup, reg as never);
    assert.equal(second.sup.needsRecovery, true, "faulted attach catch-up must flag explicit recovery, never silently attach unbilled");
    // The constructor consumed the one-shot fault; re-arm so the flagged
    // recovery itself visibly throws on the same persistence fault.
    armRecovery = true;
    let firstErr: unknown = null;
    try {
      await second.sup.recover();
    } catch (e) {
      firstErr = e;
    }
    assert.ok(firstErr, "flagged recovery must throw the persistence fault visibly");
    assert.match(String((firstErr as { code?: string })?.code ?? firstErr), /STORE_FAILED/);
    armRecovery = false;
    await second.sup.recover();
    const liveNow = (() => {
      const v = second.sup.list("governor").find((x) => x.id === g.agentId)!;
      return { input: v.usage.inputTokens, output: v.usage.outputTokens };
    })();
    const cumNow = second.sup.rootUsage();
    const rows = store2.readSince(0, 100000).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["agentId"] === g.agentId);
    const ledger = rows.reduce((sum, r) => ({ input: sum.input + Number((r.body as Record<string, unknown>)["input"] ?? 0), output: sum.output + Number((r.body as Record<string, unknown>)["output"] ?? 0) }), { input: 0, output: 0 });
    console.log(`recover-restart-retry post-retry live=${JSON.stringify(liveNow)} cumulative={input:${cumNow.inputTokens},output:${cumNow.outputTokens}} ledger=${JSON.stringify(ledger)} rows=${rows.length}`);
    const ext = rows.filter((r) => (r.body as Record<string, unknown>)["external"] === true);
    assert.equal(ext.length, 1, "exactly one external receipt after restart retry");
    assert.deepEqual(liveNow, ledger, "restarted live must equal committed ledger");
    assert.deepEqual({ input: cumNow.inputTokens, output: cumNow.outputTokens }, ledger, "restarted cumulative must equal committed ledger");
    await second.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------- recover window: abort-resolved 5/7 ---
test("recover window: cooperative abort-resolved 5/7 stays durable (same + retry + restart)", async () => {
  // The abort-triggered 5/7 resolves while recover holds suspended=true: the
  // bounded canonical receipt must be journaled (root still owns the
  // journal) before the hook, so retry/restart bill it exactly once instead
  // of losing it. Effect admission stays fenced (uncertain, never ok).
  const USAGE = {
    input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const cooperative: AnyHandle = {
    name: CG, description: "d", parameters: { type: "object" },
    execute: ((_id: unknown, _p: unknown, signal: unknown) => new Promise((resolve) => {
      const fire = (): void => {
        resolve({ content: [{ type: "text", text: "late-but-billed" }], details: {}, usage: { ...USAGE } });
      };
      const s = signal as AbortSignal | undefined;
      if (s?.aborted === true) fire();
      else s?.addEventListener("abort", fire, { once: true });
    })) as never,
  };
  const reg = () => ({ isActive: () => true, listHandles: () => [cooperative as never], getHandle: () => cooperative as never, baseCtx: () => ({}) });
  const dir = mkdtempSync(join(tmpdir(), "subagents-rwin-"));
  try {
    const store = new FileRunStore(dir, "root-rwin");
    const built = mkSup({
      dir, store: store as never, policy: (p) => { p.allowedTools = [CG]; },
      limits: { maxRunnable: 64, maxResidentWorkers: 64, maxAgentsCreated: 128, maxDepth: 3 },
    });
    setRegistry(built.sup, reg as never);
    const g = await built.sup.spawn("governor", { taskName: "w", message: "m", profile: "reader" }, "rwin-1");
    await tick();
    // Fillers lengthen recover's post-fence tail so the abort-triggered
    // settlement lands mid-recover (suspended), not after unsuspend.
    for (let i = 0; i < 25; i++) {
      await built.sup.spawn("governor", { taskName: `fill-${i}`, message: "pad", profile: "reader" }, `rwfill-${i}`);
    }
    await tick(50);
    const pending = built.byAgent(g.agentId)[0].call(CG, {});
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      const recs = store.readSince(0, 100000).records;
      if (recs.some((r) => r.kind === "tool.intent" && (r.body as Record<string, unknown>)["tool"] === CG)) break;
      await tick(10);
    }
    const recRep = await built.sup.recover();
    const callRes = await pending;
    await tick(50);
    assert.equal(callRes.isError, true, "fenced call must not succeed");
    const op = store.readSince(0, 100000).records.find((r) => r.kind === "tool.intent" && (r.body as Record<string, unknown>)["tool"] === CG)?.body?.operationId as string;
    assert.ok(op, "intent missing");
    const snap = (): { outcomes: unknown[]; recoveries: unknown[]; reports: unknown[] } => {
      const recs = store.readSince(0, 100000).records;
      return {
        outcomes: recs.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === op).map((r) => r.body),
        recoveries: recs.filter((r) => r.kind === "recovery.event" && (r.body as Record<string, unknown>)["phase"] === "external-late-settlement" && (r.body as Record<string, unknown>)["operationId"] === op).map((r) => r.body),
        reports: recs.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["operationId"] === op).map((r) => r.body),
      };
    };
    // Post-recover logging precedes equivalence asserts.
    const s1 = snap();
    console.log(`recover-window post-recover outcomes=${s1.outcomes.length} recoveries=${s1.recoveries.length} reports=${s1.reports.length} settled=${recRep.settled.length}`);
    assert.equal(s1.outcomes.length, 1, "exactly one outcome after fenced recover");
    assert.equal((s1.outcomes[0] as Record<string, unknown>)["status"], "uncertain");
    assert.equal(s1.recoveries.length, 1, "durable late receipt must survive the suspended window");
    assert.deepEqual((s1.recoveries[0] as Record<string, unknown>)["usage"], { input: 5, output: 7, cost: 0 });
    // Retry on the same instance bills it exactly once (catch-up).
    await built.sup.recover();
    await tick(20);
    const s2 = snap();
    console.log(`recover-window post-retry reports=${s2.reports.length}`);
    const billed2 = s2.reports.filter((b) => (b as Record<string, unknown>)["input"] === 5);
    assert.equal(billed2.length, 1, "retry must bill the window receipt exactly once");
    await built.sup.shutdown();
    // Fresh restart over the same dir still bills exactly once (no double).
    const store2 = new FileRunStore(dir, "root-rwin");
    const second = mkSup({ dir, store: store2 as never, policy: (p) => { p.allowedTools = [CG]; } });
    setRegistry(second.sup, reg as never);
    await second.sup.recover();
    await tick(20);
    const recs3 = store2.readSince(0, 100000).records;
    const billed3 = recs3.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["operationId"] === op);
    console.log(`recover-window post-restart reports=${billed3.length}`);
    assert.equal(billed3.length, 1, "restart must not duplicate the window receipt");
    await second.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------- owner chain: revoke/restore/nested ---
test("owner chain: revoked owner denies grandchild; restore is sticky; nested same auth", async () => {
  const B = "mcp__owner__toolB";
  const O = "mcp__owner__outer";
  let bEffects = 0;
  let oEffects = 0;
  const toolB: AnyHandle = {
    name: B, description: "owned B", parameters: { type: "object" },
    execute: (async () => { bEffects++; return { content: [{ type: "text", text: "b-ok" }], details: {} }; }) as never,
  };
  const toolO: AnyHandle = {
    name: O, description: "outer", parameters: { type: "object" },
    execute: (async (_id: unknown, _p: unknown, _s: unknown, _u: unknown, ctx: { executeTool: (n: string, a: unknown) => Promise<{ isError: boolean }> }) => {
      oEffects++;
      const nested = await ctx.executeTool(B, {});
      return { content: [{ type: "text", text: `o-done:nestedIsError=${nested.isError}` }], details: {} };
    }) as never,
  };
  let registryHasB = true;
  const reg = (): { isActive: () => boolean; listHandles: () => unknown[]; getHandle: (n: string) => unknown; baseCtx: () => unknown } => ({
    isActive: () => true,
    listHandles: () => (registryHasB ? [toolO as never, toolB as never] : [toolO as never]),
    getHandle: (n: string) => (n === O ? toolO : registryHasB && n === B ? toolB : undefined) as never,
    baseCtx: () => ({}),
  });
  const { randomUUID: uuid } = await import("node:crypto");
  const built = mkSup({
    policy: (p) => { p.allowedTools = [B, O]; p.nesting = true; p.maxDepth = 3; },
    limits: { maxRunnable: 8, maxResidentWorkers: 8, maxAgentsCreated: 16, maxDepth: 3 },
  });
  setRegistry(built.sup, reg as never);
  const p = await built.sup.spawn("governor", { taskName: "parent", message: "own", profile: "reader" }, "own-p-1");
  await tick(50);
  const pWorker = built.byAgent(p.agentId)[0];
  const spawnRes = await pWorker.call("spawn_agent", { task_name: "grandchild", message: "hold", profile: "reader" });
  assert.equal(spawnRes.isError, false, `spawn_agent failed: ${JSON.stringify(spawnRes).slice(0, 200)}`);
  await tick(50);
  const gWorker = built.workers.find((w) => w.agentId !== p.agentId)!;
  const gid = gWorker.agentId;
  // Stable chain positive: top + nested both admitted.
  const preTop = await gWorker.call(B, {});
  assert.equal(preTop.isError, false);
  const preNest = await gWorker.call(O, {});
  assert.equal(preNest.isError, false, "outer itself stays admitted");
  assert.equal(bEffects, 2, `positive chain must run B twice (top+nested), got ${bEffects}`);
  // Settle grandchild first (no join kills its admission), then parent; evict.
  gWorker.settle("succeeded", "g done");
  await tick(100);
  pWorker.settle("succeeded", "p done");
  await tick(100);
  await built.sup.evictWorker("governor", p.agentId);
  // Remove B; reload parent via a new task (revocation actually verified).
  registryHasB = false;
  await built.sup.sendMessage("governor", p.agentId, "task", "second job, no B", {}, uuid());
  await tick(100);
  const pWorker2 = built.byAgent(p.agentId).find((w) => !w.killed)!;
  const pDeny = await pWorker2.call(B, {});
  assert.equal(pDeny.isError, true, "reloaded parent without B must deny B");
  assert.equal(bEffects, 2, "revoked parent must add no B effect");
  // Restore B at the root; the already-admitted grandchild takes a new task.
  registryHasB = true;
  await built.sup.sendMessage("governor", gid, "task", "grandchild second job", {}, uuid());
  await tick(100);
  const gWorker2 = built.byAgent(gid).find((w) => !w.killed) ?? gWorker;
  const gDeny = await gWorker2.call(B, {});
  assert.equal(gDeny.isError, true, "grandchild must deny B while its live owner lacks B");
  assert.equal(bEffects, 2, "revoked owner chain must add no B effect");
  // Nested invoke shares the same authority: outer admitted, inner B denied.
  const oAfter = await gWorker2.call(O, {});
  assert.equal(oAfter.isError, false, "outer itself remains admitted");
  assert.ok(JSON.stringify(oAfter.content).includes("nestedIsError=true"), `nested B must deny: ${JSON.stringify(oAfter.content).slice(0, 200)}`);
  assert.equal(bEffects, 2, "nested B must add no effect under revoked owner");
  // Restore does not silently restore the revoked owner: settle the parent's
  // second run, reload it now (registry HAS B) — it must stay revoked
  // (sticky narrow, never widen).
  pWorker2.settle("succeeded", "p2 done");
  await tick(100);
  await built.sup.evictWorker("governor", p.agentId);
  await built.sup.sendMessage("governor", p.agentId, "task", "third job", {}, uuid());
  await tick(100);
  const pWorker3 = built.byAgent(p.agentId).find((w) => !w.killed)!;
  const pStillDeny = await pWorker3.call(B, {});
  assert.equal(pStillDeny.isError, true, "owner revocation sticks across reloads despite restored root");
  assert.equal(bEffects, 2);
  await built.sup.shutdown();
});

// --------------------------------- native: op-specific abort ---
test("native op-specific abort cancels backend, releases caller, spares parallel", async () => {
  const OUTER = "mcp__sig__outer";
  const built = mkSup({ policy: (p) => { p.allowedTools = [OUTER]; } });
  // Backend honors per-operation cancel (records + releases the hung job).
  const cancelled: string[] = [];
  const gates = new Map<string, () => void>();
  const hang = (which: string) => async (spec: { operationId: string }): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean; truncated: boolean; signal: null }> => {
    await new Promise<void>((r) => { gates.set(spec.operationId, r); });
    return { stdout: `${which}-done`, stderr: "", exitCode: 0, timedOut: false, truncated: false, signal: null };
  };
  built.executors.host.handler = hang("host");
  built.executors.sandbox.handler = hang("sandbox");
  const seenSpecs = (): string[] => built.executors.host.specs.concat(built.executors.sandbox.specs).map((sp) => sp.operationId);
  const releaseOp = (op: string): void => {
    const rel = gates.get(op);
    if (rel) { gates.delete(op); rel(); }
  };
  const origHostCancel = built.executors.host.cancel.bind(built.executors.host);
  const origSandboxCancel = built.executors.sandbox.cancel.bind(built.executors.sandbox);
  built.executors.host.cancel = async (op: string): Promise<void> => {
    cancelled.push(`host:${op}`);
    releaseOp(op);
    await origHostCancel(op);
  };
  built.executors.sandbox.cancel = async (op: string): Promise<void> => {
    cancelled.push(`sandbox:${op}`);
    releaseOp(op);
    await origSandboxCancel(op);
  };
  const captured: { signal?: AbortController } = {};
  const outer: AnyHandle = {
    name: OUTER, description: "signal outer", parameters: { type: "object" },
    execute: (async (_id: unknown, params: unknown, _s: unknown, _u: unknown, ctx: { executeTool: (n: string, a: unknown, o?: unknown) => Promise<{ isError: boolean }> }) => {
      const which = (params as Record<string, unknown>)["which"] ?? "a";
      if (which === "a") {
        const c = new AbortController();
        captured.signal = c;
        const r = await ctx.executeTool("read", { path: "x" }, { signal: c.signal });
        return { content: [{ type: "text", text: `a-done:isError=${r.isError}` }], details: {} };
      }
      const r = await ctx.executeTool("read", { path: "y" });
      return { content: [{ type: "text", text: `q-done:isError=${r.isError}` }], details: {} };
    }) as never,
  };
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [outer as never], getHandle: () => outer as never, baseCtx: () => ({}) }));
  const g = await built.sup.spawn("governor", { taskName: "s", message: "m", profile: "reader" }, "nsig-1");
  await tick(50);
  const worker = built.byAgent(g.agentId)[0];
  // Parallel: abort ONLY the first invocation's signal after both entered.
  const p1 = worker.call(OUTER, { which: "a" });
  await tick(50);
  const opsAfterP1 = seenSpecs();
  assert.equal(opsAfterP1.length, 1, `p1 must own exactly one backend op, saw ${opsAfterP1.length}`);
  const p1op = opsAfterP1[0]!;
  const p2 = worker.call(OUTER, { which: "quick" });
  await tick(100);
  assert.ok(captured.signal, "outer never captured an explicit signal");
  // Release ONLY the parallel job's backend; p1 stays blocked behind its gate.
  const p2op = seenSpecs().find((op) => op !== p1op)!;
  assert.ok(p2op, "parallel backend op missing");
  releaseOp(p2op);
  const r2 = await p2;
  assert.equal(r2.isError, false, "parallel unrelated native job must complete");
  assert.ok(gates.has(p1op), "p1 backend must still be blocked before the abort");
  captured.signal!.abort();
  const t0 = Date.now();
  const r1 = await Promise.race([
    p1.then((v) => ({ settled: true as const, v })),
    new Promise<{ settled: false }>((r) => setTimeout(() => r({ settled: false as const }), 5000)),
  ]);
  const dt = Date.now() - t0;
  assert.equal(r1.settled, true, `explicit abort must release the caller promptly (hung ${dt}ms, no agent-wide cancel used)`);
  // The outer call completes (it handles the nested failure); the nested
  // cancel error is observable in its content.
  if (r1.settled) assert.ok(JSON.stringify(r1.v.content).includes("isError=true"), `aborted nested outcome must surface observably: ${JSON.stringify(r1.v.content).slice(0, 200)}`);
  await tick(100);
  // Backend observed the op-specific cancel (no unrelated op cancelled).
  const p1cancels = cancelled.filter((c) => c === `host:${p1op}` || c === `sandbox:${p1op}`);
  assert.ok(p1cancels.length >= 1, `backend must observe op-specific cancel for p1 op; saw ${JSON.stringify(cancelled)}`);
  const unrelated = cancelled.filter((c) => c !== `host:${p1op}` && c !== `sandbox:${p1op}`);
  assert.equal(unrelated.length, 0, `no unrelated backend job may be cancelled: ${JSON.stringify(unrelated)}`);
  await built.sup.shutdown();
});

test("native bash permissions unchanged; sandbox gains nothing", async () => {
  // Nested bash stays permission-gated (dispatcher tools list); sandbox
  // callers gain no new capability from signal plumbing.
  const { GoverningToolDispatcher } = await import("../src/external-dispatcher.ts");
  const store = new InMemoryRunStore("nsig-perm");
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
    nativeOk as never,
  );
  const sandboxCaller = {
    agentId: "s1", taskRunId: "t-s", generation: 1,
    grants: { tools: ["read"], externalTools: ["mcp__x__y"], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "sandbox" },
    workdir: "/tmp", writableRoot: null, sandbox: null,
  };
  let threw: unknown = null;
  try {
    await disp.execute(sandboxCaller as never, { tool: "mcp__x__y", args: {} });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, "sandbox external dispatch must still deny");
  assert.match(String((threw as { message?: string })?.message ?? threw), /POLICY_DENIED|sandbox/);
});

// --------------------------------- broker per-op cancel linearizes first ---
test("broker per-op abort marks before backend await (real host close order)", async () => {
  // Real HostToolExecutor: its cancel waits for close while runJob's earlier
  // close listener resolves exec first. Ownership must already be linearized
  // (single cancelled outcome + observable cancel marking), not an ordinary
  // ok/error journaled by the exec continuation winning the race.
  const { Supervisor: Sup } = await import("../src/supervisor.ts");
  const { HostToolExecutor } = await import("../src/sandbox.ts");
  const { CtlWorker } = await import("./ctl-worker.ts");
  const { testGovernor } = await import("./fake-worker.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-nclin-"));
  try {
    const ctlWorkers: Array<{ agentId: string }> = [];
    const policy = defaultSupervisorPolicy();
    policy.allowedModels = [{ provider: "p", id: "m" }];
    const sup = new Sup({
      rootId: "root-nclin",
      governor: testGovernor,
      rootDir: dir,
      store: new InMemoryRunStore("root-nclin"),
      policy,
      schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
      executors: { sandbox: new DummyToolExecutor(), host: new HostToolExecutor() },
      workspace: new DummyWorkspaceManager(),
      workerFactory: (o) => {
        const w = new CtlWorker(o.agentId);
        ctlWorkers.push(w);
        return w;
      },
    });
    const g = await sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", isolation: "none" }, "nclin-1");
    await tick(50);
    const rt = (sup as unknown as { agents: Map<string, { record: { grants: unknown; allocation: { workdir: string; writableRoot: string | null } } ; activeRun: { taskRunId: string; generation: number } }> }).agents.get(g.agentId)!;
    const caller = {
      agentId: g.agentId, taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation,
      grants: rt.record.grants, workdir: rt.record.allocation.workdir,
      writableRoot: rt.record.allocation.writableRoot, sandbox: null,
    };
    const marker = join(caller.workdir, "started.marker");
    const ctl = new AbortController();
    const pending = sup.toolBroker.execute(caller as never, {
      tool: "bash", args: { command: `echo started > "${marker}"; sleep 30` },
      operationId: "op-nclin-host", signal: ctl.signal,
    });
    pending.catch(() => {});
    const t0 = Date.now();
    while (!existsSync(marker) && Date.now() - t0 < 10000) await tick(10);
    assert.ok(existsSync(marker), "host backend never entered");
    ctl.abort();
    const res = await Promise.race([
      pending.then((v) => ({ settled: true as const, v })),
      new Promise<{ settled: false }>((r) => setTimeout(() => r({ settled: false as const }), 15000)),
    ]);
    assert.equal(res.settled, true, "aborted caller settles promptly");
    if (res.settled) {
      assert.equal(res.v.exitCode, -1, "cancel marking on exit code");
      assert.ok(String(res.v.stderr).includes("[cancelled]"), "cancel marking on stderr");
    }
    await tick(100);
    const outs = sup.runStore.readSince(0, 100000).records
      .filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === "op-nclin-host")
      .map((r) => (r.body as Record<string, unknown>)["status"]);
    assert.deepEqual(outs, ["cancelled"], `exactly one cancelled outcome, got ${JSON.stringify(outs)}`);
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("broker per-op + bulk + repeat abort races journal once", async () => {
  const mkHung = (): { gates: Map<string, () => void>; release: (op: string) => void } => {
    const gates = new Map<string, () => void>();
    return {
      gates,
      release: (op: string): void => {
        const rel = gates.get(op);
        if (rel) { gates.delete(op); rel(); }
      },
    };
  };
  const hungHandler = (gates: Map<string, () => void>) => async (spec: { operationId: string }): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean; truncated: boolean; signal: null }> => {
    await new Promise<void>((r) => { gates.set(spec.operationId, r); });
    return { stdout: "hung-done", stderr: "", exitCode: 0, timedOut: false, truncated: false, signal: null };
  };
  const mkCaller = (sup: Supervisor, agentId: string): Record<string, unknown> => {
    const rt = (sup as unknown as { agents: Map<string, { record: { grants: unknown }; activeRun: { taskRunId: string; generation: number } }> }).agents.get(agentId)!;
    return {
      agentId, taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation,
      grants: rt.record.grants, workdir: "/tmp", writableRoot: null, sandbox: null,
    };
  };
  const outcomes = (sup: Supervisor, op: string): unknown[] => sup.runStore.readSince(0, 100000).records
    .filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === op)
    .map((r) => (r.body as Record<string, unknown>)["status"]);

  // Per-op abort immediately followed by bulk cancelJobs (same tick).
  {
    const built = mkSup({ policy: () => {} });
    const { gates, release } = mkHung();
    built.executors.host.handler = hungHandler(gates);
    const g = await built.sup.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "none" }, "ncr-1");
    await tick(50);
    const caller = mkCaller(built.sup, g.agentId);
    const c1 = new AbortController();
    const pending = built.sup.toolBroker.execute(caller as never, { tool: "bash", args: { command: "sleep 30" }, operationId: "op-ncr-race", signal: c1.signal });
    pending.catch(() => {});
    const t0 = Date.now();
    while (!gates.has("op-ncr-race") && Date.now() - t0 < 5000) await tick(10);
    assert.ok(gates.has("op-ncr-race"), "backend never entered");
    c1.abort();
    await built.sup.toolBroker.cancelJobs(g.agentId);
    release("op-ncr-race");
    await pending.catch(() => {});
    await tick(100);
    assert.deepEqual(outcomes(built.sup, "op-ncr-race"), ["cancelled"], "per-op + bulk race journals once");
    await built.sup.shutdown();
  }

  // Bulk first, per-op abort while bulk is awaiting.
  {
    const built = mkSup({ policy: () => {} });
    const { gates, release } = mkHung();
    built.executors.host.handler = hungHandler(gates);
    const g = await built.sup.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "none" }, "ncr-2");
    await tick(50);
    const caller = mkCaller(built.sup, g.agentId);
    const c1 = new AbortController();
    const pending = built.sup.toolBroker.execute(caller as never, { tool: "bash", args: { command: "sleep 30" }, operationId: "op-ncr-bulkfirst", signal: c1.signal });
    pending.catch(() => {});
    const t0 = Date.now();
    while (!gates.has("op-ncr-bulkfirst") && Date.now() - t0 < 5000) await tick(10);
    const bulkP = built.sup.toolBroker.cancelJobs(g.agentId);
    c1.abort();
    release("op-ncr-bulkfirst");
    await Promise.all([bulkP, pending.catch(() => {})]);
    await tick(100);
    assert.deepEqual(outcomes(built.sup, "op-ncr-bulkfirst"), ["cancelled"], "bulk-first race journals once");
    await built.sup.shutdown();
  }

  // Multiple aborts collapse to one outcome.
  {
    const built = mkSup({ policy: () => {} });
    const { gates, release } = mkHung();
    built.executors.host.handler = hungHandler(gates);
    const g = await built.sup.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "none" }, "ncr-3");
    await tick(50);
    const caller = mkCaller(built.sup, g.agentId);
    const c1 = new AbortController();
    const pending = built.sup.toolBroker.execute(caller as never, { tool: "bash", args: { command: "sleep 30" }, operationId: "op-ncr-multi", signal: c1.signal });
    pending.catch(() => {});
    const t0 = Date.now();
    while (!gates.has("op-ncr-multi") && Date.now() - t0 < 5000) await tick(10);
    c1.abort();
    c1.abort();
    release("op-ncr-multi");
    await pending.catch(() => {});
    await tick(100);
    assert.deepEqual(outcomes(built.sup, "op-ncr-multi"), ["cancelled"], "repeat aborts journal once");
    await built.sup.shutdown();
  }

  // Aborted before start throws visibly with a single cancelled outcome.
  {
    const built = mkSup({ policy: () => {} });
    const g = await built.sup.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "none" }, "ncr-4");
    await tick(50);
    const caller = mkCaller(built.sup, g.agentId);
    const c1 = new AbortController();
    c1.abort();
    let threw: unknown = null;
    try {
      await built.sup.toolBroker.execute(caller as never, { tool: "bash", args: { command: "true" }, operationId: "op-ncr-prestart", signal: c1.signal });
    } catch (e) {
      threw = e;
    }
    assert.ok(threw, "pre-start abort must throw");
    assert.match(String((threw as { code?: string })?.code ?? threw), /NOT_RUNNING/);
    assert.deepEqual(outcomes(built.sup, "op-ncr-prestart"), ["cancelled"], "pre-start abort journals one cancelled");
    await built.sup.shutdown();
  }
});

test("broker cancel backend-throws (and backend-less) stays uncertain, single outcome", async () => {
  const mkCaller = (sup: Supervisor, agentId: string): Record<string, unknown> => {
    const rt = (sup as unknown as { agents: Map<string, { record: { grants: unknown }; activeRun: { taskRunId: string; generation: number } }> }).agents.get(agentId)!;
    return {
      agentId, taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation,
      grants: rt.record.grants, workdir: "/tmp", writableRoot: null, sandbox: null,
    };
  };
  const outcomes = (sup: Supervisor, op: string): unknown[] => sup.runStore.readSince(0, 100000).records
    .filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === op)
    .map((r) => (r.body as Record<string, unknown>)["status"]);

  // Throwing backend cancel: effect unconfirmed (uncertain), never
  // known-cancelled, exactly once. The gate is released by the test so the
  // caller still settles.
  {
    const built = mkSup({ policy: () => {} });
    const gates = new Map<string, () => void>();
    built.executors.host.handler = (async (spec: { operationId: string }) => {
      await new Promise<void>((r) => { gates.set(spec.operationId, r); });
      return { stdout: "hung-done", stderr: "", exitCode: 0, timedOut: false, truncated: false, signal: null };
    });
    const origCancel = built.executors.host.cancel.bind(built.executors.host);
    built.executors.host.cancel = async (op: string): Promise<void> => {
      const rel = gates.get(op);
      if (rel) { gates.delete(op); rel(); }
      await origCancel(op);
      throw Object.assign(new Error("injected backend cancel failure"), { code: "CANCEL_FAILED" });
    };
    const g = await built.sup.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "none" }, "ncu-1");
    await tick(50);
    const c1 = new AbortController();
    const pending = built.sup.toolBroker.execute(mkCaller(built.sup, g.agentId) as never, { tool: "bash", args: { command: "sleep 30" }, operationId: "op-ncu-throw", signal: c1.signal });
    pending.catch(() => {});
    const t0 = Date.now();
    while (!gates.has("op-ncu-throw") && Date.now() - t0 < 5000) await tick(10);
    c1.abort();
    await pending.catch(() => {});
    await tick(100);
    assert.deepEqual(outcomes(built.sup, "op-ncu-throw"), ["uncertain"], "throwing backend cancel journals uncertain once, never confirmed-cancelled");
    await built.sup.shutdown();
  }

  // Executor pair without any cancel hook: ignoring backend stays uncertain.
  {
    const { Supervisor: Sup } = await import("../src/supervisor.ts");
    const { testGovernor } = await import("./fake-worker.ts");
    const { CtlWorker: CtlWorkerClass } = await import("./ctl-worker.ts");
    const dir = mkdtempSync(join(tmpdir(), "subagents-ncu-"));
    try {
      const workers: Array<{ agentId: string }> = [];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      const noCancel = {
        backend: "nocancel",
        specs: [] as unknown[],
        probe: () => ({ ok: true as const }),
        exec: (spec: { operationId: string }): Promise<Record<string, unknown>> => new Promise((resolve) => {
          (noCancel as { gates?: Map<string, () => void> }).gates?.set(spec.operationId, () => resolve({ stdout: "x", stderr: "", exitCode: 0, timedOut: false, truncated: false, signal: null }));
        }),
      };
      (noCancel as { gates?: Map<string, () => void> }).gates = new Map<string, () => void>();
      const sup = new Sup({
        rootId: "root-ncu",
        governor: testGovernor,
        rootDir: dir,
        store: new InMemoryRunStore("root-ncu"),
        policy,
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
        executors: { sandbox: noCancel as never, host: noCancel as never },
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const w = new CtlWorkerClass(o.agentId);
          workers.push(w);
          return w;
        },
      });
      const g = await sup.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "none" }, "ncu-2");
      await tick(50);
      const c1 = new AbortController();
      const pending = sup.toolBroker.execute(mkCaller(sup, g.agentId) as never, { tool: "bash", args: { command: "sleep 30" }, operationId: "op-ncu-nocancel", signal: c1.signal });
      pending.catch(() => {});
      const t0 = Date.now();
      const gates = (noCancel as { gates?: Map<string, () => void> }).gates!;
      while (!gates.has("op-ncu-nocancel") && Date.now() - t0 < 5000) await tick(10);
      c1.abort();
      await tick(100);
      const outs = outcomes(sup, "op-ncu-nocancel");
      assert.deepEqual(outs, ["uncertain"], "hook-less backend journals uncertain once");
      gates.get("op-ncu-nocancel")!();
      await pending.catch(() => {});
      await sup.shutdown();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("broker cancelled-append fault is observable and restart-stable", async () => {
  // A STORE_FAILED inside the detached cancellation commit must surface as a
  // project-observable receipt (never an unhandled rejection, never
  // swallowed valid state), and a fresh instance over the same journal must
  // neither duplicate nor invent outcomes for the operation.
  const dir = mkdtempSync(join(tmpdir(), "subagents-ncf-"));
  try {
    const { FileRunStore } = await import("../src/store.ts");
    const backing = new FileRunStore(dir, "root-ncf");
    let faultArmed = true;
    // Proxy: full RunStore surface (serialized needs loadCommand, etc.),
    // faulting exactly the cancelled-outcome append.
    const store = new Proxy(backing, {
      get: (t, prop, recv) => {
        if (prop === "append") {
          return (kind: never, body: never): never => {
            const b = body as unknown as Record<string, unknown>;
            if (faultArmed && kind === "tool.outcome" && b?.["status"] === "cancelled") {
              faultArmed = false;
              throw Object.assign(new Error("injected STORE_FAILED (cancelled outcome)"), { code: "STORE_FAILED" });
            }
            return backing.append(kind as never, body as never) as never;
          };
        }
        const v = Reflect.get(t, prop, recv);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
    const built = mkSup({ dir, store: store as never, policy: () => {} });
    const gates = new Map<string, () => void>();
    built.executors.host.handler = (async (spec: { operationId: string }) => {
      // The flush-trigger op completes immediately; everything else hangs.
      if (spec.operationId === "op-ncf-flush") {
        return { stdout: "flush-ok", stderr: "", exitCode: 0, timedOut: false, truncated: false, signal: null };
      }
      await new Promise<void>((r) => { gates.set(spec.operationId, r); });
      return { stdout: "hung-done", stderr: "", exitCode: 0, timedOut: false, truncated: false, signal: null };
    });
    const origCancel = built.executors.host.cancel.bind(built.executors.host);
    built.executors.host.cancel = async (op: string): Promise<void> => {
      const rel = gates.get(op);
      if (rel) { gates.delete(op); rel(); }
      await origCancel(op);
    };
    const g = await built.sup.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "none" }, "ncf-1");
    await tick(50);
    const rt = (built.sup as unknown as { agents: Map<string, { record: { grants: unknown }; activeRun: { taskRunId: string; generation: number } }> }).agents.get(g.agentId)!;
    const caller = {
      agentId: g.agentId, taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation,
      grants: rt.record.grants, workdir: "/tmp", writableRoot: null, sandbox: null,
    };
    const c1 = new AbortController();
    const pending = built.sup.toolBroker.execute(caller as never, { tool: "bash", args: { command: "sleep 30" }, operationId: "op-ncf-1", signal: c1.signal });
    pending.catch(() => {});
    const t0 = Date.now();
    while (!gates.has("op-ncf-1") && Date.now() - t0 < 5000) await tick(10);
    assert.ok(gates.has("op-ncf-1"), "backend never entered");
    c1.abort();
    // Release the backend so the process can settle on its own terms.
    await tick(100);
    const rel = gates.get("op-ncf-1");
    if (rel) { gates.delete("op-ncf-1"); rel(); }
    await pending.catch(() => {});
    await tick(100);
    // Retention delivers on the NEXT store interaction (flush-on-access):
    // run an unrelated quick op first, then read. Silence would mean the
    // fault was dropped rather than retained.
    const flushTrigger = built.sup.toolBroker.execute(caller as never, { tool: "bash", args: { command: "true" }, operationId: "op-ncf-flush" });
    await flushTrigger;
    await tick(50);
    const recs = backing.readSince(0, 100000).records;
    const outs = recs.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === "op-ncf-1");
    const evts = recs.filter((r) => r.kind === "recovery.event" && (r.body as Record<string, unknown>)["phase"] === "broker-cancel-commit-failed" && (r.body as Record<string, unknown>)["operationId"] === "op-ncf-1");
    console.log(`cancel-commit-fault outcomes=${outs.length} commitFailedEvents=${evts.length}`);
    assert.equal(outs.length, 0, "faulted cancelled append leaves no half outcome");
    assert.equal(evts.length, 1, "fault surfaces as exactly one observable commit-failed receipt");
    await built.sup.shutdown();
    // Fresh instance over the same journal: stable, no duplication/invention.
    const store2 = new FileRunStore(dir, "root-ncf");
    const outs2 = store2.readSince(0, 100000).records.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === "op-ncf-1");
    const evts2 = store2.readSince(0, 100000).records.filter((r) => r.kind === "recovery.event" && (r.body as Record<string, unknown>)["phase"] === "broker-cancel-commit-failed" && (r.body as Record<string, unknown>)["operationId"] === "op-ncf-1");
    assert.deepEqual([outs2.length, evts2.length], [0, 1], "restart neither duplicates nor invents records");
    store2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------- global pause denies new admission ---
test("global pause: mid-recover NEW admissions denied before intent/effects", async () => {
  // During recover (suspended) every NEW external/direct/nested/native/prep
  // admission denies immediately with NOT_RUNNING, before intents or
  // effects — independent of per-agent fence iteration. Late receipts for
  // already-running work still persist (ownership, not validity).
  const OUTER = "mcp__pause__outer";
  const B2 = "mcp__pause__b2";
  let b2Effects = 0;
  const outerCap: AnyHandle = {
    name: OUTER, description: "o", parameters: { type: "object" },
    execute: (async () => {
      await new Promise(() => {});
      return { content: [{ type: "text", text: "never" }], details: {} };
    }) as never,
  };
  const toolB2: AnyHandle = {
    name: B2, description: "b", parameters: { type: "object" },
    execute: (async () => { b2Effects++; return { content: [{ type: "text", text: "b2" }], details: {} }; }) as never,
  };
  const built = mkSup({
    policy: (p) => { p.allowedTools = [OUTER, B2]; p.nesting = true; p.maxDepth = 3; },
    limits: { maxRunnable: 64, maxResidentWorkers: 64, maxAgentsCreated: 128, maxDepth: 3 },
  });
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [outerCap as never, toolB2 as never], getHandle: (n: string) => (n === OUTER ? outerCap : toolB2) as never, baseCtx: () => ({}) }));
  const a = await built.sup.spawn("governor", { taskName: "nativeA", message: "m", profile: "writer", isolation: "none" }, "rpg-a-1");
  await tick(50);
  for (let i = 0; i < 20; i++) {
    await built.sup.spawn("governor", { taskName: `fill-${i}`, message: "pad", profile: "reader" }, `rpgfill-${i}`);
  }
  const b = await built.sup.spawn("governor", { taskName: "govB", message: "m", profile: "reader" }, "rpg-b-1");
  await tick(50);
  const workerB = built.byAgent(b.agentId)[0];
  // Hung native backend for A's legitimate bash job.
  const gates = new Map<string, () => void>();
  for (const ex of [built.executors.host, built.executors.sandbox]) {
    ex.handler = (spec: { operationId: string }) => new Promise((resolve) => {
      gates.set(spec.operationId, () => resolve({ stdout: "hung", stderr: "", exitCode: 0, timedOut: false, truncated: false, signal: null }));
    });
  }
  const workerA = built.byAgent(a.agentId)[0];
  const nativeP = workerA.call("bash", { command: "sleep 60" });
  nativeP.catch(() => {});
  const tN = Date.now();
  while (!built.executors.host.specs.concat(built.executors.sandbox.specs).some((s) => (s as { tool?: string }).tool === "bash") && Date.now() - tN < 5000) await tick(10);
  // B's hung outer run captures the parent ctx for nested probes.
  type PauseCtx = { executeTool: (n: string, a: unknown, o?: unknown) => Promise<{ isError: boolean }> };
  let liveCtx: PauseCtx | null = null;
  (outerCap as { execute: unknown }).execute = (async (_id: unknown, _p: unknown, _s: unknown, _u: unknown, ctx: PauseCtx) => {
    liveCtx = ctx;
    await new Promise(() => {});
  }) as never;
  const outerP = workerB.call(OUTER, {});
  outerP.catch(() => {});
  const tC = Date.now();
  while (!liveCtx && Date.now() - tC < 5000) await tick(10);
  assert.ok(liveCtx, "parent ctx never captured");
  // Pre-recover positive: top B2 admitted.
  const pre = await workerB.call(B2, {});
  assert.equal(pre.isError, false);
  assert.equal(b2Effects, 1);
  const intentsBefore = built.sup.runStore.readSince(0, 100000).records.filter((r) => r.kind === "tool.intent").length;
  // Microtask-only observation keeps the invokes inside the pause window.
  const qtick = (): Promise<void> => new Promise((r) => queueMicrotask(r as never));
  const recP = built.sup.recover();
  let guard = 0;
  while (guard++ < 5000) {
    if (built.executors.host.cancelled.concat(built.executors.sandbox.cancelled).length > 0) break;
    await qtick();
  }
  const disp = (built.sup as unknown as { governingDispatcher: import("../src/external-dispatcher.ts").GoverningToolDispatcher }).governingDispatcher;
  assert.ok(disp.activeJobs(b.agentId).length > 0, "B fenced before invokes (window missed)");
  // NEW nested external: denied with no effect.
  const effBeforeNested = b2Effects;
  const nestedB2 = await (liveCtx as PauseCtx).executeTool(B2, {});
  assert.equal(nestedB2.isError, true, "mid-recover nested external must deny");
  assert.equal(b2Effects, effBeforeNested, "mid-recover nested external must add no effect");
  // NEW nested native: denied upfront, backend never entered.
  const gatesBefore = gates.size;
  const nnP = (liveCtx as PauseCtx).executeTool("read", { path: "x" });
  nnP.catch(() => {});
  for (let i = 0; i < 20; i++) await qtick();
  assert.equal(gates.size, gatesBefore, "mid-recover nested native must never reach the backend");
  // NEW top-level admission with B's live admitted state: denied, no effect.
  const bRt = (built.sup as unknown as { agents: Map<string, { record: { grants: unknown; allocation: { workdir: string; writableRoot: string | null } }; activeRun: { taskRunId: string; generation: number } }> }).agents.get(b.agentId)!;
  const callerB = {
    agentId: b.agentId, taskRunId: bRt.activeRun.taskRunId, generation: bRt.activeRun.generation,
    grants: bRt.record.grants, workdir: bRt.record.allocation.workdir,
    writableRoot: bRt.record.allocation.writableRoot, sandbox: null,
  };
  let threw: unknown = null;
  try {
    await disp.execute(callerB as never, { tool: B2, args: {}, operationId: "op-rpg-ipc" });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, "mid-recover top-level admission must deny");
  assert.match(String((threw as { code?: string })?.code ?? threw), /NOT_RUNNING|POLICY_DENIED/);
  // NEW worker IPC native call: denied (no broker intent/effect).
  const ipcNative = await workerB.call("read", { path: "x" });
  assert.equal(ipcNative.isError, true, "mid-recover worker native call must deny");
  // Release; finish recovery; count exactly zero new effects/intents.
  for (const [, rel] of [...gates]) rel();
  gates.clear();
  await nnPHeldCatch(nnP);
  const recRep = await recP;
  await outerP.catch(() => {});
  await nativeP.catch(() => {});
  await tick(100);
  assert.equal(b2Effects, 1, `no B2 effects across pause (was 1, got ${b2Effects})`);
  const intentsAfter = built.sup.runStore.readSince(0, 100000).records.filter((r) => r.kind === "tool.intent").length;
  assert.equal(intentsAfter, intentsBefore, `no new intents across pause (was ${intentsBefore}, got ${intentsAfter})`);
  void recRep;
  await built.sup.shutdown();

  async function nnPHeldCatch(p: Promise<unknown>): Promise<void> {
    await p.catch(() => {});
  }
});

// --------------------------------- tickets: fail-fast + settle purge ---
test("tickets: oversize prepare fails visibly without minting (real worker)", async (t: TestContext) => {
  if (!SDK_ROOT) { t.skip("needs pinned SDK worker"); return; }
  let effects = 0;
  const parent: AnyHandle = {
    name: CG, description: "d", parameters: { type: "object" },
    prepareArguments: ((a: unknown) => ({ ...(a as Record<string, unknown>), data: "x".repeat(300_000) })) as never,
    execute: (async () => { effects++; return { content: [{ type: "text", text: "must-not-run" }], details: {} }; }) as never,
  };
  const dir = mkdtempSync(join(tmpdir(), "subagents-tov-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const policy = defaultSupervisorPolicy();
  policy.allowedModels = [{ provider: "p", id: "m" }];
  policy.allowedTools = [CG];
  const sup = new Supervisor({
    rootId: "root-tov", rootDir: join(dir, "root"), store: new InMemoryRunStore("root-tov"), policy,
    governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
    schedulerLimits: { maxRunnable: 2, maxResidentWorkers: 4, maxAgentsCreated: 8, maxDepth: 1 },
    executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() },
    workspace: new DummyWorkspaceManager(),
    workerFactory: (o) => {
      const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
      const hostAgentDir = join(dir, "host-agent");
      mkdirSync(hostAgentDir, { recursive: true });
      writeFileSync(join(hostAgentDir, "auth.json"), JSON.stringify({}));
      return new WorkerHandle({
        workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
        rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot: SDK_ROOT, deterministic: true,
        agentDir: join(dir, "worker-home", o.agentId), sessionsDir: join(dir, "sessions"), hostAgentDir,
        script: [{ tool: CG, args: { q: "x" } }, { text: "done" }],
      }, binding);
    },
    governingRegistry: () => ({ isActive: () => true, listHandles: () => [parent as never], getHandle: () => parent as never, baseCtx: () => ({}) }),
  });
  t.after(() => sup.shutdown().catch(() => {}));
  const g = await sup.spawn("governor", { taskName: "tov", message: "go", profile: "reader" }, "tov-1");
  const start = Date.now();
  while (Date.now() - start < 20000) {
    if (sup.runStore.readSince(0, 100000).records.some((r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(effects, 0, "oversize prepare must not execute");
  const tickets = [...(sup as unknown as { preparedTickets: Map<string, { agentId: string }> }).preparedTickets.values()]
    .filter((tk) => tk.agentId === g.agentId);
  assert.equal(tickets.length, 0, "oversize prepare must not mint (fail before transport)");
  // Worker transcript shows the visible preparation error, not a hang.
  const walk = (d: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  };
  const sessionBytes = walk(join(dir, "sessions")).map((f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } }).join("\n");
  assert.ok(/PAYLOAD_TOO_LARGE|preparation failed|INVALID/i.test(sessionBytes), "oversize prepare must surface visibly in transcript");
});

test("tickets: oversize prepare mints nothing pre-terminal (no intent)", async () => {
  // Fail-before-mint must hold BEFORE any terminal purge could mask a doomed
  // ticket: immediately after the denied prepare, the map holds nothing for
  // the agent and no prepareOnly intent was journaled.
  const tool: AnyHandle = {
    name: CG, description: "same", parameters: { type: "object" },
    prepareArguments: (a) => ({ ...(a as Record<string, unknown>), data: "x".repeat(300_000) }),
    execute: (async () => ({ content: [{ type: "text", text: "must-not-run" }], details: {} })) as never,
  };
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }));
  const g = await built.sup.spawn("governor", { taskName: "tp", message: "m", profile: "reader" }, "tpp-1");
  await tick();
  const rt = (built.sup as unknown as { agents: Map<string, unknown> }).agents.get(g.agentId);
  const worker = built.byAgent(g.agentId)[0];
  const env = { taskRunId: g.taskRunId, executionGeneration: g.generation };
  const supAny = built.sup as unknown as {
    onPrepareRequest: (rt: unknown, worker: unknown, payload: unknown, env: unknown) => Promise<{ ok: boolean; ticket?: string; error?: string }>;
    preparedTickets: Map<string, { agentId: string }>;
  };
  const intentsBefore = built.sup.runStore.readSince(0, 100000).records.filter((r) => r.kind === "tool.intent").length;
  const prep = await supAny.onPrepareRequest(rt, worker, { tool: CG, args: { q: "x" }, toolCallId: "tc-tpp" }, env);
  assert.equal(prep.ok, false, "oversize prepare must deny");
  assert.match(prep.error ?? "", /PAYLOAD_TOO_LARGE/);
  assert.equal(prep.ticket, undefined, "denied prepare mints no ticket");
  assert.equal(supAny.preparedTickets.size, 0, "no ticket retained pre-terminal");
  const intentsAfter = built.sup.runStore.readSince(0, 100000).records.filter((r) => r.kind === "tool.intent").length;
  assert.equal(intentsAfter, intentsBefore, "denied prepare journals no intent");
  await built.sup.shutdown();
});

test("tickets: minted-but-unconsumed purge on normal terminal (no worker release needed)", async () => {
  const tool: AnyHandle = {
    name: CG, description: "same", parameters: { type: "object" },
    prepareArguments: (a) => a,
    execute: (async () => ({ content: [{ type: "text", text: "ok" }], details: {} })) as never,
  };
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }));
  const g = await built.sup.spawn("governor", { taskName: "tp", message: "m", profile: "reader" }, "tp-1");
  await tick();
  const rt = (built.sup as unknown as { agents: Map<string, unknown> }).agents.get(g.agentId);
  const worker = built.byAgent(g.agentId)[0];
  const env = { taskRunId: g.taskRunId, executionGeneration: g.generation };
  const supAny = built.sup as unknown as {
    onPrepareRequest: (rt: unknown, worker: unknown, payload: unknown, env: unknown) => Promise<{ ok: boolean; ticket?: string; error?: string }>;
    preparedTickets: Map<string, { agentId: string }>;
  };
  const prep = await supAny.onPrepareRequest(rt, worker, { tool: CG, args: {}, toolCallId: "tc-tp" }, env);
  assert.equal(prep.ok, true, prep.error);
  assert.equal(supAny.preparedTickets.size, 1, "minted ticket present before settle");
  // Settle the generation WITHOUT consuming the ticket and WITHOUT any
  // worker release notice: purge must not assume the worker knows the id.
  worker.settle("succeeded", "done");
  await tick(100);
  assert.equal(supAny.preparedTickets.size, 0, "normal terminal purges orphaned tickets");
  await built.sup.shutdown();
});

// --------------------------------- grants durable across restart ---
test("grants: narrowed authority survives FileRunStore restart (+fault visible)", async () => {
  const B = "mcp__owner__toolB";
  let bEffects = 0;
  const toolB: AnyHandle = {
    name: B, description: "owned B", parameters: { type: "object" },
    execute: (async () => { bEffects++; return { content: [{ type: "text", text: "b-ok" }], details: {} }; }) as never,
  };
  let registryHasB = true;
  const reg = (): { isActive: () => boolean; listHandles: () => unknown[]; getHandle: (n: string) => unknown; baseCtx: () => unknown } => ({
    isActive: () => true,
    listHandles: () => (registryHasB ? [toolB as never] : []),
    getHandle: (n: string) => (registryHasB && n === B ? toolB as never : undefined),
    baseCtx: () => ({}),
  });
  const { randomUUID: uuid } = await import("node:crypto");
  const dir = mkdtempSync(join(tmpdir(), "subagents-grpd-"));
  const mkArgs = (store: FileRunStore): Parameters<typeof mkSup>[0] => ({
    dir,
    store: store as unknown as Parameters<typeof mkSup>[0] extends { store?: infer S } ? S : never,
    policy: (p) => { p.allowedTools = [B]; p.nesting = true; p.maxDepth = 3; },
    limits: { maxRunnable: 8, maxResidentWorkers: 8, maxAgentsCreated: 16, maxDepth: 3 },
  });
  try {
    const store1 = new FileRunStore(dir, "root-grpd");
    const first = mkSup(mkArgs(store1));
    setRegistry(first.sup, reg as never);
    const p = await first.sup.spawn("governor", { taskName: "parent", message: "own", profile: "reader" }, "grpd-p-1");
    await tick(50);
    const pWorker = first.byAgent(p.agentId)[0];
    const spawnRes = await pWorker.call("spawn_agent", { task_name: "grandchild", message: "hold", profile: "reader" });
    assert.equal(spawnRes.isError, false, `spawn failed: ${JSON.stringify(spawnRes).slice(0, 200)}`);
    await tick(50);
    const gWorker = first.workers.find((w) => w.agentId !== p.agentId)!;
    const gid = gWorker.agentId;
    assert.equal((await gWorker.call(B, {})).isError, false);
    assert.equal(bEffects, 1);
    gWorker.settle("succeeded", "g done");
    await tick(100);
    pWorker.settle("succeeded", "p done");
    await tick(100);
    await first.sup.evictWorker("governor", p.agentId);
    registryHasB = false;
    await first.sup.sendMessage("governor", p.agentId, "task", "second job, no B", {}, uuid());
    await tick(100);
    const pWorker2 = first.byAgent(p.agentId).find((w) => !w.killed)!;
    assert.equal((await pWorker2.call(B, {})).isError, true, "reloaded parent without B denies");
    assert.equal(bEffects, 1);
    // The narrowing was journaled (typed event) before the live mutation.
    const grantEvents = store1.readSince(0, 100000).records.filter((r) => r.kind === "agent.grants");
    assert.ok(grantEvents.length >= 1, "narrowing must journal agent.grants");
    assert.deepEqual((grantEvents[grantEvents.length - 1]!.body as Record<string, unknown>)["agentId"], p.agentId);
    registryHasB = true;
    pWorker2.settle("succeeded", "p2 done");
    await tick(100);
    await first.sup.shutdown();
    // Restart over the same journal with root B restored: both still deny.
    const store2 = new FileRunStore(dir, "root-grpd");
    const second = mkSup(mkArgs(store2));
    setRegistry(second.sup, reg as never);
    await second.sup.recover();
    await tick(50);
    await second.sup.sendMessage("governor", p.agentId, "task", "post-restart parent", {}, uuid());
    await tick(100);
    await second.sup.sendMessage("governor", gid, "task", "post-restart grandchild", {}, uuid());
    await tick(100);
    const pW = second.byAgent(p.agentId).find((w) => !w.killed)!;
    const gW = second.byAgent(gid).find((w) => !w.killed)!;
    assert.equal((await pW.call(B, {})).isError, true, "replayed parent still denies B");
    assert.equal((await gW.call(B, {})).isError, true, "replayed grandchild still denies B");
    assert.equal(bEffects, 1, `no B effects after restart (got ${bEffects})`);
    await second.sup.shutdown();
  } finally {
    registryHasB = true;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("grants: narrowing persistence fault fails the reload visibly", async () => {
  const B = "mcp__owner__toolB2";
  const tool: AnyHandle = {
    name: B, description: "b", parameters: { type: "object" },
    prepareArguments: (a) => a,
    execute: (async () => ({ content: [{ type: "text", text: "ok" }], details: {} })) as never,
  };
  const dir = mkdtempSync(join(tmpdir(), "subagents-grpf-"));
  try {
    let faultArmed = false;
    class FlakyFile extends FileRunStore {
      override append(kind: never, body: never): never {
        if (faultArmed && kind === "agent.grants") {
          faultArmed = false;
          throw Object.assign(new Error("injected STORE_FAILED (agent.grants)"), { code: "STORE_FAILED" });
        }
        return super.append(kind as never, body as never) as never;
      }
    }
    const store1 = new FlakyFile(dir, "root-grpf");
    const first = mkSup({
      dir, store: store1 as never,
      policy: (p) => { p.allowedTools = [B]; p.nesting = true; p.maxDepth = 3; },
      limits: { maxRunnable: 8, maxResidentWorkers: 8, maxAgentsCreated: 16, maxDepth: 3 },
    });
    setRegistry(first.sup, () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }));
    const p = await first.sup.spawn("governor", { taskName: "parent", message: "own", profile: "reader" }, "grpf-p-1");
    await tick(50);
    const pWorker = first.byAgent(p.agentId)[0];
    pWorker.settle("succeeded", "p done");
    await tick(100);
    await first.sup.evictWorker("governor", p.agentId);
    // Narrow on reload (remove B from concrete first so grants change).
    (first.sup as unknown as { opts: { governingRegistry?: unknown } }).opts.governingRegistry = () => ({
      isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}),
    });
    faultArmed = true;
    const { randomUUID: uuid } = await import("node:crypto");
    await first.sup.sendMessage("governor", p.agentId, "task", "reload under fault", {}, uuid());
    await tick(200);
    faultArmed = false;
    const terms = store1.readSince(0, 100000).records.filter((r) => r.kind === "task.terminal");
    const failed = terms.filter((r) => (r.body as Record<string, unknown>)["outcome"] === "failed");
    console.log(`grants-fault terminals=${terms.length} failed=${failed.length} detail=${JSON.stringify(failed.map((r) => (r.body as Record<string, unknown>)["detail"])).slice(0, 200)}`);
    assert.ok(failed.length >= 1, "narrowing persistence fault must fail visibly, never silently narrow memory-only");
    assert.ok(failed.some((r) => String((r.body as Record<string, unknown>)["detail"] ?? "").includes("STORE_FAILED")), "failure names the persistence fault");
    await first.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------- catch-up: first recover exact ---
test("catch-up: post-snapshot receipt bills on FIRST recover (no second call)", async () => {
  // Cooperative abort-resolved 5/7 landing after the opening snapshot but
  // during reconciliation awaits: the end-of-recover catch-up on fresh
  // records bills it immediately — live, budget, and ledger exact, with no
  // manual second recover.
  const USAGE = {
    input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const cooperative: AnyHandle = {
    name: CG, description: "d", parameters: { type: "object" },
    execute: ((_id: unknown, _p: unknown, signal: unknown) => new Promise((resolve) => {
      const fire = (): void => {
        resolve({ content: [{ type: "text", text: "late-but-billed" }], details: {}, usage: { ...USAGE } });
      };
      const s = signal as AbortSignal | undefined;
      if (s?.aborted === true) fire();
      else s?.addEventListener("abort", fire, { once: true });
    })) as never,
  };
  const reg = () => ({ isActive: () => true, listHandles: () => [cooperative as never], getHandle: () => cooperative as never, baseCtx: () => ({}) });
  const dir = mkdtempSync(join(tmpdir(), "subagents-c1r-"));
  try {
    const store = new FileRunStore(dir, "root-c1r");
    const built = mkSup({
      dir, store: store as never, policy: (p) => { p.allowedTools = [CG]; },
      limits: { maxRunnable: 64, maxResidentWorkers: 64, maxAgentsCreated: 128, maxDepth: 3 },
    });
    setRegistry(built.sup, reg as never);
    for (let i = 0; i < 25; i++) {
      await built.sup.spawn("governor", { taskName: `fill-${i}`, message: "pad", profile: "reader" }, `c1rfill-${i}`);
    }
    const g = await built.sup.spawn("governor", { taskName: "w", message: "m", profile: "reader" }, "c1r-1");
    await tick(50);
    const pending = built.byAgent(g.agentId)[0].call(CG, {});
    await tick(50);
    await built.sup.recover();
    await pending.catch(() => {});
    await tick(100);
    // FIRST recover only: exact numbers, no second call.
    const recs = store.readSince(0, 100000).records;
    const op = recs.find((r) => r.kind === "tool.intent" && (r.body as Record<string, unknown>)["tool"] === CG)?.body?.operationId as string;
    assert.ok(op, "intent missing");
    const reports = recs.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["operationId"] === op);
    const live = (() => {
      const v = built.sup.list("governor").find((x) => x.id === g.agentId)!;
      return { input: v.usage.inputTokens, output: v.usage.outputTokens };
    })();
    const cum = built.sup.rootUsage();
    console.log(`first-recover reports=${reports.length} live=${JSON.stringify(live)} cumulative={input:${cum.inputTokens},output:${cum.outputTokens}}`);
    assert.equal(reports.filter((r) => (r.body as Record<string, unknown>)["input"] === 5).length, 1, "first recover bills 5/7 without a second call");
    assert.deepEqual(live, { input: 5, output: 7 }, "first-recover live exact");
    assert.deepEqual({ input: cum.inputTokens, output: cum.outputTokens }, { input: 5, output: 7 }, "first-recover budget exact");
    const ledger = recs
      .filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["agentId"] === g.agentId)
      .reduce((sum, r) => ({ input: sum.input + Number((r.body as Record<string, unknown>)["input"] ?? 0), output: sum.output + Number((r.body as Record<string, unknown>)["output"] ?? 0) }), { input: 0, output: 0 });
    assert.deepEqual(live, ledger, "live equals committed ledger after first recover");
    // Stability: repeated recoveries change nothing.
    await built.sup.recover();
    await tick(50);
    const reports2 = store.readSince(0, 100000).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["operationId"] === op);
    assert.equal(reports2.length, 1, "repeated recover stays exactly once");
    await built.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("catch-up: fresh attach bills known receipt with no recover call", async () => {
  // Hand-built journal: agent + intent + ok outcome carrying valid 5/7, but
  // NO usage.reported (crash window). A fresh supervisor attach (no recover
  // call at all) must account it exactly once via constructor catch-up.
  const USAGE = {
    input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const dir = mkdtempSync(join(tmpdir(), "subagents-caf-"));
  try {
    const agentId = "agent-handbuilt-1";
    const seed = new FileRunStore(dir, "root-1");
    seed.append("agent.spawned", {
      agentId, path: "/root/handbuilt", parentId: null, depth: 1, profile: "reader",
      grants: { tools: ["read"], externalTools: [CG], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" },
      allocation: { kind: "reader", workdir: "/tmp", readRoots: [], writableRoot: null, git: null, repoId: null, tmpDir: "/tmp" },
      instructions: { contextFiles: [], skills: [] }, model: null, taskRunId: "t-hand",
    });
    seed.append("tool.intent", { operationId: "op-hand-1", agentId, taskRunId: "t-hand", generation: 1, tool: CG, external: true, parentOperationId: null });
    seed.append("tool.outcome", { operationId: "op-hand-1", status: "ok", external: true, durationMs: 5, preview: "x", usage: { ...USAGE } });
    seed.close();
    const store2 = new FileRunStore(dir, "root-1");
    const sup = mkSup({ dir, store: store2 as never, policy: (p) => { p.allowedTools = [CG]; } }).sup;
    assert.equal(sup.needsRecovery, false, "hand-built journal has nothing pending");
    const v = sup.list("governor").find((x) => x.id === agentId)!;
    const live = { input: v.usage.inputTokens, output: v.usage.outputTokens };
    const rows = store2.readSince(0, 100000).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["operationId"] === "op-hand-1");
    console.log(`fresh-attach live=${JSON.stringify(live)} reports=${rows.length}`);
    assert.equal(rows.length, 1, "attach journals exactly one receipt without any recover call");
    assert.deepEqual({ input: (rows[0].body as Record<string, unknown>)["input"], output: (rows[0].body as Record<string, unknown>)["output"] }, { input: 5, output: 7 });
    assert.deepEqual(live, { input: 5, output: 7 }, "attach live exact");
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------- tickets: same-agent repeat tasks ---
test("tickets: resident agent repeat tasks retain nothing", async () => {
  // Same resident agent, two ordinary terminals: the ticket map must stay
  // empty across both (purge-on-settle, no worker release needed, no
  // growth) — stronger than single-shot or second-agent fixtures.
  const tool: AnyHandle = {
    name: CG, description: "same", parameters: { type: "object" },
    prepareArguments: (a) => a,
    execute: (async () => ({ content: [{ type: "text", text: "ok" }], details: {} })) as never,
  };
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }));
  const g = await built.sup.spawn("governor", { taskName: "tp", message: "m", profile: "reader" }, "tpr-1");
  await tick();
  const supAny = built.sup as unknown as {
    onPrepareRequest: (rt: unknown, worker: unknown, payload: unknown, env: unknown) => Promise<{ ok: boolean; ticket?: string; error?: string }>;
    preparedTickets: Map<string, { agentId: string }>;
  };
  const { randomUUID: uuid } = await import("node:crypto");
  for (let round = 0; round < 2; round++) {
    if (round > 0) {
      // Second task on the SAME resident agent: a fresh admitted run.
      await built.sup.sendMessage("governor", g.agentId, "task", `repeat job ${round}`, {}, uuid());
      await tick(100);
    }
    const rt = (built.sup as unknown as { agents: Map<string, unknown> }).agents.get(g.agentId);
    const worker = built.byAgent(g.agentId)[0];
    const live = (built.sup as unknown as { agents: Map<string, { activeRun: { taskRunId: string; generation: number } | null }> }).agents.get(g.agentId)!.activeRun;
    assert.ok(live, `round ${round}: no admitted run for repeat task`);
    const env = { taskRunId: live.taskRunId, executionGeneration: live.generation };
    const prep = await supAny.onPrepareRequest(rt, worker, { tool: CG, args: {}, toolCallId: `tc-tpr-${round}` }, env);
    assert.equal(prep.ok, true, prep.error);
    worker.settle("succeeded", "done");
    await tick(100);
    assert.equal(supAny.preparedTickets.size, 0, `round ${round}: tickets retained across terminal`);
  }
  await built.sup.shutdown();
});

// --------------------------------- disposal denies new admission ---
test("disposal: post-shutdown dispatcher admission denied (same boundary)", async () => {
  // Shutdown shares the pause boundary permanently: direct dispatcher
  // admission with a previously admitted caller record denies instead of
  // running effects on a disposed root.
  const tool: AnyHandle = {
    name: CG, description: "same", parameters: { type: "object" },
    prepareArguments: (a) => a,
    execute: (async () => ({ content: [{ type: "text", text: "must-not-run" }], details: {} })) as never,
  };
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }));
  const g = await built.sup.spawn("governor", { taskName: "d", message: "m", profile: "reader" }, "dsp-1");
  await tick();
  const rt = (built.sup as unknown as { agents: Map<string, { record: { grants: unknown; allocation: { workdir: string; writableRoot: string | null } } ; activeRun: { taskRunId: string; generation: number } }> }).agents.get(g.agentId)!;
  const caller = {
    agentId: g.agentId, taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation,
    grants: rt.record.grants, workdir: rt.record.allocation.workdir,
    writableRoot: rt.record.allocation.writableRoot, sandbox: null,
  };
  await built.sup.shutdown();
  let threw: unknown = null;
  try {
    await built.sup.governingDispatcher.execute(caller as never, { tool: CG, args: {}, operationId: "op-dsp-1" });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, "post-shutdown admission must deny");
  assert.match(
    `${String((threw as { code?: string })?.code ?? "")} ${String((threw as { message?: string })?.message ?? threw)}`,
    /NOT_RUNNING|suspended|disposed/i,
  );
});

// --------------------------------- broker exit honesty + idle health ---
test("broker cooperative cancel exit is observably non-success", async () => {
  // A cooperative backend reporting exit 0 after cancellation must not read
  // as clean success: the done-branch forces a non-success exit while the
  // journal holds exactly one cancelled outcome.
  const built = mkSup({ policy: () => {} });
  const gates = new Map<string, () => void>();
  built.executors.host.handler = (async (spec: { operationId: string }) => {
    await new Promise<void>((r) => { gates.set(spec.operationId, r); });
    return { stdout: "coop-ok", stderr: "", exitCode: 0, timedOut: false, truncated: false, signal: null };
  });
  const origCancel = built.executors.host.cancel.bind(built.executors.host);
  built.executors.host.cancel = async (op: string): Promise<void> => {
    const rel = gates.get(op);
    if (rel) { gates.delete(op); rel(); }
    await origCancel(op);
  };
  const g = await built.sup.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "none" }, "xc-1");
  await tick(50);
  const rt = (built.sup as unknown as { agents: Map<string, { record: { grants: unknown }; activeRun: { taskRunId: string; generation: number } }> }).agents.get(g.agentId)!;
  const caller = {
    agentId: g.agentId, taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation,
    grants: rt.record.grants, workdir: "/tmp", writableRoot: null, sandbox: null,
  };
  const c1 = new AbortController();
  const pending = built.sup.toolBroker.execute(caller as never, { tool: "bash", args: { command: "sleep 30" }, operationId: "op-xc-1", signal: c1.signal });
  pending.catch(() => {});
  const t0 = Date.now();
  while (!gates.has("op-xc-1") && Date.now() - t0 < 5000) await tick(10);
  assert.ok(gates.has("op-xc-1"), "backend never entered (actual op id)");
  c1.abort();
  const rel = gates.get("op-xc-1");
  if (rel) { gates.delete("op-xc-1"); rel(); }
  const res = await pending;
  assert.notEqual(res.exitCode, 0, `cancelled cooperative result must be non-success, got exit=${res.exitCode}`);
  const outs = built.sup.runStore.readSince(0, 100000).records
    .filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === "op-xc-1")
    .map((r) => (r.body as Record<string, unknown>)["status"]);
  assert.deepEqual(outs, ["cancelled"], `exactly one cancelled outcome, got ${JSON.stringify(outs)}`);
  await built.sup.shutdown();
});

test("broker retained fault observable idle + gates new effects", async () => {
  // While a fault receipt awaits delivery: public health observes it with NO
  // new tool call (idle), using a VALID admitted caller throughout (a stale
  // caller denied as NOT_FOUND would prove nothing about the gate). New
  // native effects then fail closed (STORE_FAILED) instead of running
  // healthy continuation; healing lets the next op flush + proceed.
  const backing = new InMemoryRunStore("root-xch");
  // Persistent fault on BOTH receipt kinds while armed: the cancelled outcome
  // cannot land, and neither can its retained retry (so flush keeps failing
  // and the gate must deny). Disarming heals the journal afterwards.
  let faultsArmed = true;
  const store = new Proxy(backing, {
    get: (t, prop, recv) => {
      if (prop === "append") {
        return (kind: never, body: never): never => {
          const b = body as unknown as Record<string, unknown>;
          if (faultsArmed && kind === "tool.outcome" && b?.["status"] === "cancelled") {
            throw Object.assign(new Error("injected STORE_FAILED (cancelled outcome)"), { code: "STORE_FAILED" });
          }
          if (faultsArmed && kind === "recovery.event" && b?.["phase"] === "broker-cancel-commit-failed") {
            throw Object.assign(new Error("injected STORE_FAILED (commit-failed receipt)"), { code: "STORE_FAILED" });
          }
          return backing.append(kind as never, body as never) as never;
        };
      }
      const v = Reflect.get(t, prop, recv);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const built = mkSup({ store: store as never, policy: () => {} });
  const gates = new Map<string, () => void>();
  built.executors.host.handler = (async (spec: { operationId: string }) => {
    // Only op-xch-1 hangs (the aborted job); every other op completes at
    // once so the heal step cannot stall behind the same gate.
    if (spec.operationId !== "op-xch-1") {
      return { stdout: "quick-ok", stderr: "", exitCode: 0, timedOut: false, truncated: false, signal: null };
    }
    await new Promise<void>((r) => { gates.set(spec.operationId, r); });
    return { stdout: "hung-done", stderr: "", exitCode: 0, timedOut: false, truncated: false, signal: null };
  });
  const g = await built.sup.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "none" }, "xch-1");
  await tick(50);
  const mkCaller = (): Record<string, unknown> => {
    const rt = (built.sup as unknown as { agents: Map<string, { record: { grants: unknown }; activeRun: { taskRunId: string; generation: number } }> }).agents.get(g.agentId)!;
    assert.ok(rt.activeRun, "no admitted run: caller would be STALE, proving nothing");
    return {
      agentId: g.agentId, taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation,
      grants: rt.record.grants, workdir: "/tmp", writableRoot: null, sandbox: null,
    };
  };
  const c1 = new AbortController();
  const pending = built.sup.toolBroker.execute(mkCaller() as never, { tool: "bash", args: { command: "sleep 30" }, operationId: "op-xch-1", signal: c1.signal });
  pending.catch(() => {});
  const t0 = Date.now();
  while (!gates.has("op-xch-1") && Date.now() - t0 < 5000) await tick(10);
  assert.ok(gates.has("op-xch-1"), "backend never entered (actual op id)");
  c1.abort();
  await tick(150);
  // Idle health with NO new tool call: broker flag + supervisor needsRecovery.
  assert.equal(built.sup.toolBroker.hasPendingReceipts(), true, "retained fault visible at broker while idle");
  assert.equal(built.sup.needsRecovery, true, "retained fault visible via needsRecovery while idle");
  // A fresh VALID admitted caller is still denied (fail-closed, STORE_FAILED).
  let threw: unknown = null;
  try {
    await built.sup.toolBroker.execute(mkCaller() as never, { tool: "bash", args: { command: "true" }, operationId: "op-xch-2" });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, "new effect while fault retained must deny");
  assert.match(String((threw as { code?: string })?.code ?? threw), /STORE_FAILED/);
  // No intent was journaled for the denied op (denial precedes effects).
  const deniedIntents = backing.readSince(0, 100000).records.filter(
    (r) => r.kind === "tool.intent" && (r.body as Record<string, unknown>)["operationId"] === "op-xch-2",
  );
  assert.equal(deniedIntents.length, 0, "denied admission journals no intent");
  // Heal: the next op flushes the retained receipt, then proceeds normally.
  faultsArmed = false;
  const rel = gates.get("op-xch-1");
  if (rel) { gates.delete("op-xch-1"); rel(); }
  await pending.catch(() => {});
  const healed = await built.sup.toolBroker.execute(mkCaller() as never, { tool: "bash", args: { command: "true" }, operationId: "op-xch-3" });
  assert.equal(healed.exitCode, 0, "healed store admits effects again");
  const evts = backing.readSince(0, 100000).records.filter(
    (r) => r.kind === "recovery.event" && (r.body as Record<string, unknown>)["phase"] === "broker-cancel-commit-failed",
  );
  assert.equal(evts.length, 1, "retained receipt delivered exactly once on heal");
  assert.equal(built.sup.toolBroker.hasPendingReceipts(), false, "buffer drained after delivery");
  assert.equal(built.sup.needsRecovery, false, "needsRecovery clears once retained faults deliver");
  await built.sup.shutdown();
});

// --------------------------------- gate-check single outcome ---
test("gate-check cancel journals once as cancelled, writer still quarantined", async () => {
  // runControllerCheck cancelled mid-flight (cooperative close returning
  // ordinary ok): exactly one uncertain/cancelled outcome — never an
  // ordinary-confirmed second record — so restart quarantine still holds.
  const dir = mkdtempSync(join(tmpdir(), "subagents-gcc-"));
  try {
    const store1 = new FileRunStore(dir, "root-gcc");
    const first = mkSup({ dir, store: store1 as never, policy: () => {} });
    const gates = new Map<string, () => void>();
    for (const ex of [first.executors.host, first.executors.sandbox]) {
      ex.handler = (spec: { operationId: string }) => new Promise((resolve) => {
        gates.set(spec.operationId, () => resolve({ stdout: "check-done", stderr: "", exitCode: 0, timedOut: false, truncated: false, signal: null }));
      });
    }
    const origCancel = first.executors.host.cancel.bind(first.executors.host);
    first.executors.host.cancel = async (op: string): Promise<void> => {
      const rel = gates.get(op);
      if (rel) { gates.delete(op); rel(); }
      await origCancel(op);
    };
    const g = await first.sup.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "none" }, "gcc-1");
    await tick(50);
    const pending = first.sup.runCheck(g.agentId, g.taskRunId, { id: "c1", command: "sleep 30", timeoutMs: 60000 });
    pending.catch(() => {});
    const t0 = Date.now();
    let op: string | null = null;
    while (!op && Date.now() - t0 < 5000) {
      await tick(10);
      op = [...gates.keys()][0] ?? null;
    }
    assert.ok(op, "gate check never entered backend");
    await first.sup.recover();
    const rel = gates.get(op!);
    if (rel) { gates.delete(op!); rel(); }
    await pending.catch(() => {});
    await tick(100);
    const outs = store1.readSince(0, 100000).records
      .filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === op)
      .map((r) => (r.body as Record<string, unknown>)["status"]);
    assert.equal(outs.length, 1, `exactly one gate-check outcome, got ${JSON.stringify(outs)}`);
    assert.ok(outs.every((s) => s === "cancelled" || s === "uncertain"), `no ordinary-confirmed outcome: ${JSON.stringify(outs)}`);
    await first.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Quarantine leg (separate journal): check still hung at shutdown, so the
  // restart reconciles a genuinely unconfirmed effect.
  const dir2 = mkdtempSync(join(tmpdir(), "subagents-gccq-"));
  try {
    const storeA = new FileRunStore(dir2, "root-gccq");
    const fa = mkSup({ dir: dir2, store: storeA as never, policy: () => {} });
    for (const ex of [fa.executors.host, fa.executors.sandbox]) {
      ex.handler = () => new Promise(() => {});
    }
    const ga = await fa.sup.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "none" }, "gccq-1");
    await tick(50);
    const pendingA = fa.sup.runCheck(ga.agentId, ga.taskRunId, { id: "c1", command: "sleep 30", timeoutMs: 60000 });
    pendingA.catch(() => {});
    const tA = Date.now();
    while (Date.now() - tA < 5000) {
      if (storeA.readSince(0, 100000).records.some((r) => r.kind === "tool.intent")) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await fa.sup.shutdown();
    const storeB = new FileRunStore(dir2, "root-gccq");
    const fb = mkSup({ dir: dir2, store: storeB as never, policy: () => {} });
    const report = await fb.sup.recover();
    assert.deepEqual(report.quarantined, [ga.agentId], "unconfirmed check effect quarantines writer");
    await fb.sup.shutdown();
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
});

// --------------------------------- attach hold blocks admission ---
test("attach flag holds tasks and spawn until billed", async () => {
  // Fresh attach with an unbilled known receipt (faulted constructor
  // catch-up): needsRecovery true, and NEW task dispatch + spawn stay held
  // until an explicit recover bills exactly once.
  const USAGE = {
    input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  const agentId = "agent-hold-1";
  const dir = mkdtempSync(join(tmpdir(), "subagents-hold-"));
  try {
    const seed = new FileRunStore(dir, "root-1");
    seed.append("agent.spawned", {
      agentId, path: "/root/held", parentId: null, depth: 1, profile: "reader",
      grants: { tools: ["read"], externalTools: [], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" },
      allocation: { kind: "reader", workdir: "/tmp", readRoots: [], writableRoot: null, git: null, repoId: null, tmpDir: "/tmp" },
      instructions: { contextFiles: [], skills: [] }, model: null, taskRunId: "t-hold",
    });
    seed.append("tool.intent", { operationId: "op-hold-1", agentId, taskRunId: "t-hold", generation: 1, tool: CG, external: true, parentOperationId: null });
    seed.append("tool.outcome", { operationId: "op-hold-1", status: "ok", external: true, durationMs: 5, preview: "x", usage: { ...USAGE } });
    seed.close();
    let faultArmed = true;
    class FlakyFile extends FileRunStore {
      override append(kind: never, body: never): never {
        if (faultArmed && kind === "usage.reported") {
          faultArmed = false;
          throw Object.assign(new Error("injected STORE_FAILED (attach)"), { code: "STORE_FAILED" });
        }
        return super.append(kind as never, body as never) as never;
      }
    }
    const { randomUUID: uuid } = await import("node:crypto");
    const store = new FlakyFile(dir, "root-1");
    const built = mkSup({ dir, store: store as never, policy: (p) => { p.allowedTools = [CG]; } });
    assert.equal(built.sup.needsRecovery, true, "flagged attach observable via needsRecovery");
    // New task stays queued/held: no worker dispatched.
    await built.sup.sendMessage("governor", agentId, "task", "job during hold", {}, uuid());
    await tick(100);
    assert.equal(built.byAgent(agentId).length, 0, "held task dispatches no worker");
    // New spawn stays denied while held.
    let spawnThrew: unknown = null;
    try {
      await built.sup.spawn("governor", { taskName: "x", message: "y", profile: "reader" }, uuid());
    } catch (e) {
      spawnThrew = e;
    }
    assert.ok(spawnThrew, "spawn denied while billing uncommitted");
    // Explicit recover bills once and releases the hold.
    faultArmed = false;
    await built.sup.recover();
    await tick(50);
    const rows = store.readSince(0, 100000).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["operationId"] === "op-hold-1");
    assert.equal(rows.length, 1, "recover bills exactly once after hold");
    assert.equal(built.sup.needsRecovery, false, "hold cleared after billing");
    await built.sup.sendMessage("governor", agentId, "task", "post-recovery job", {}, uuid());
    await tick(100);
    assert.equal(built.byAgent(agentId).length, 1, "task dispatches after billing committed");
    await built.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------- transfer: disposed broker drops late writes ---
test("transfer: old disposed owner cannot append behind the new owner", async () => {
  // Ownership transfer over one FileRunStore dir: the old broker is disposed
  // at shutdown while its detached backend cancel is still held. When the
  // hold releases, the late outcome must be dropped (never appended with a
  // stale seq behind the new owner). The new owner's journal stays
  // monotonic and reloads clean with its records intact.
  const { Supervisor: Sup } = await import("../src/supervisor.ts");
  const { defaultSupervisorPolicy } = await import("../src/policy.ts");
  const { DummyToolExecutor } = await import("../src/sandbox.ts");
  const { DummyWorkspaceManager } = await import("../src/workspace.ts");
  const { testGovernor } = await import("./fake-worker.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-txfer-"));
  try {
    const rootDir = join(dir, "root");
    const mkOwner = (store: FileRunStore, executor: never): InstanceType<typeof Sup> => new Sup({
      rootId: "root-txfer",
      governor: testGovernor,
      rootDir,
      store: store as never,
      policy: (() => { const p = defaultSupervisorPolicy(); p.allowedModels = [{ provider: "p", id: "m" }]; return p; })(),
      schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
      executors: { sandbox: new DummyToolExecutor(), host: executor as never },
      workspace: new DummyWorkspaceManager(),
    });
    const entered: string[] = [];
    const cancelSeen: string[] = [];
    let releaseCancel = (): void => {};
    const cancelHeld = new Promise<void>((r) => { releaseCancel = r; });
    const gating = {
      backend: "host",
      probe: () => ({ ok: true as const }),
      exec: (spec: { operationId: string }): Promise<Record<string, unknown>> => new Promise((resolve) => {
        entered.push(spec.operationId);
        void resolve; // never resolves: the old backend stays hung for the test
      }),
      cancel: async (op: string): Promise<void> => {
        // Held open across the transfer (ignoring/slow backend stand-in):
        // the detached cancelThis stays suspended here until the test ends.
        cancelSeen.push(op);
        await cancelHeld;
      },
    };
    const store1 = new FileRunStore(rootDir, "root-txfer");
    const sup1 = mkOwner(store1, gating as never);
    const caller = {
      agentId: "a-old", taskRunId: "t-old", generation: 1,
      grants: { tools: ["read"], externalTools: [], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "none" },
      workdir: dir, writableRoot: null, sandbox: null,
    };
    const c1 = new AbortController();
    const run = sup1.toolBroker.execute(caller as never, { tool: "read", args: { path: "x" }, operationId: "op-old-1", signal: c1.signal });
    run.catch(() => {});
    const t0 = Date.now();
    while (!entered.includes("op-old-1") && Date.now() - t0 < 5000) await tick(10);
    assert.ok(entered.includes("op-old-1"), "old backend never entered");
    c1.abort();
    const tC = Date.now();
    while (!cancelSeen.includes("op-old-1") && Date.now() - tC < 5000) await tick(10);
    assert.ok(cancelSeen.includes("op-old-1"), "old backend cancel never entered");
    // Shutdown completes while the old backend cancel is still held (no
    // unbounded await on the ignoring backend) and retires journal ownership.
    await sup1.shutdown();
    // Legitimate transfer: fresh store + supervisor over the same dir.
    const store2 = new FileRunStore(rootDir, "root-txfer");
    const sup2 = mkOwner(store2, new DummyToolExecutor() as never);
    const rn = await sup2.toolBroker.execute(
      { ...caller, agentId: "a-new", taskRunId: "t-new", operationId: undefined } as never,
      { tool: "read", args: { path: "x" }, operationId: "op-new-1" },
    );
    void rn;
    // Release the old hold now that the new owner has written: the detached
    // cancelThis resumes post-transfer and must drop its late outcome via
    // the disposed guard (never append with a stale seq behind the new
    // owner). The old execute itself stays hung (no timers leak from it).
    releaseCancel();
    await tick(100);
    const raw = store2.readSince(0, 100000).records;
    const late = raw.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === "op-old-1");
    assert.equal(late.length, 0, `old owner appended behind the new owner: ${JSON.stringify(late.map((r) => r.body))}`);
    const seqs = raw.map((r) => (r as unknown as { seq: number }).seq);
    assert.ok(seqs.every((s, i) => s === i + 1), `journal not monotonic: [${seqs}]`);
    assert.ok(raw.some((r) => r.kind === "tool.intent" && (r.body as Record<string, unknown>)["operationId"] === "op-new-1"), "new-owner intent missing");
    assert.ok(raw.some((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === "op-new-1"), "new-owner outcome missing");
    await sup2.shutdown().catch(() => {});
    // Fresh reopen still loads canonically.
    const store3 = new FileRunStore(rootDir, "root-txfer");
    const recs3 = store3.readSince(0, 100000).records;
    assert.ok(recs3.every((r, i) => (r as unknown as { seq: number }).seq === i + 1), "reopened journal not monotonic");
    store3.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --------------------------------- cross-route ID reservation ---
test("ids: native-external same explicit ID denies across routes (supervisor wiring)", async () => {
  // The supervisor wires ONE reservation set into broker and dispatcher:
  // native-first then external with the same explicit ID denies before any
  // second effect or intent, and vice versa. Distinct IDs proceed.
  const B = "mcp__xid__tool";
  const toolB: AnyHandle = {
    name: B, description: "b", parameters: { type: "object" },
    execute: (async () => ({ content: [{ type: "text", text: "b-ok" }], details: {} })) as never,
  };
  const built = mkSup({ policy: (p) => { p.allowedTools = [B]; } });
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [toolB as never], getHandle: () => toolB as never, baseCtx: () => ({}) }));
  const g = await built.sup.spawn("governor", { taskName: "x", message: "m", profile: "reader" }, "xid-1");
  await tick(50);
  const rt = (built.sup as unknown as { agents: Map<string, { record: { grants: unknown }; activeRun: { taskRunId: string; generation: number } }> }).agents.get(g.agentId)!;
  const caller = {
    agentId: g.agentId, taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation,
    grants: rt.record.grants, workdir: "/tmp", writableRoot: null, sandbox: null,
  };
  const intents = (op: string): number => built.sup.runStore.readSince(0, 100000).records
    .filter((r) => r.kind === "tool.intent" && (r.body as Record<string, unknown>)["operationId"] === op).length;
  // Native first (direct broker route), then external with the same ID.
  const rn = await built.sup.toolBroker.execute(caller as never, { tool: "read", args: { path: "x" }, operationId: "op-x-shared" });
  assert.equal(rn.exitCode, 0);
  let threw: unknown = null;
  try {
    await built.sup.governingDispatcher.execute(caller as never, { tool: B, args: {}, operationId: "op-x-shared" });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw, "external reuse of a native operation ID must deny");
  assert.match(String((threw as { code?: string })?.code ?? threw), /DUPLICATE_REQUEST/);
  assert.equal(intents("op-x-shared"), 1, "duplicate external claim journals no second intent");
  // Reverse with fresh IDs: external first, then native with the same ID.
  const re = await built.sup.governingDispatcher.execute(caller as never, { tool: B, args: {}, operationId: "op-x-shared-2" });
  assert.equal(re.isError, false);
  let threw2: unknown = null;
  try {
    await built.sup.toolBroker.execute(caller as never, { tool: "read", args: { path: "x" }, operationId: "op-x-shared-2" });
  } catch (e) {
    threw2 = e;
  }
  assert.ok(threw2, "native reuse of an external operation ID must deny");
  assert.match(String((threw2 as { code?: string })?.code ?? threw2), /DUPLICATE_REQUEST/);
  assert.equal(intents("op-x-shared-2"), 1, "duplicate native claim journals no second intent");
  await built.sup.shutdown();
});
