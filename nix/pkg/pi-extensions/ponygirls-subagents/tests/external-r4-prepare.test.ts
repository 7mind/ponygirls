/**
 * R4 preparation-deferral regressions (real worker, deterministic provider,
 * no network): legacy args prepared supervisor-side while MODEL-declared
 * schemas stay intact, plus negative controls. No prepare-function
 * serialization, no schema swaps, no synthetic placeholder args.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkerHandle } from "../src/worker-launch.ts";
import { bindChannel } from "../src/protocol.ts";
import { Supervisor } from "../src/supervisor.ts";
import { InMemoryRunStore } from "../src/store.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { shouldSkipPreparation } from "../src/worker.ts";

const SDK_ROOT = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? null;
const CG = "mcp__codegraph__codegraph_explore";

interface Harness {
  sup: Supervisor;
  dir: string;
  events: Array<{ kind: string }>;
  done: Promise<void>;
}

interface HarnessT {
  skip: (message?: string) => void;
  after: (fn: () => void | Promise<void>) => void;
}

async function realWorkerHarness(
  t: HarnessT,
  opts: {
    parent: import("../src/governing-runtime.ts").PinnedGoverningHandle;
    script: Array<{ text?: string; tool?: string; args?: Record<string, unknown> }>;
  },
): Promise<Harness> {
  if (!SDK_ROOT) {
    t.skip("PI_SUBAGENTS_SDK_ROOT unset; R4 needs the pinned SDK worker");
    throw new Error("skipped");
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-r4-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const events: Array<{ kind: string }> = [];
  const policy = defaultSupervisorPolicy();
  policy.allowedModels = [{ provider: "p", id: "m" }];
  policy.allowedTools = [CG];
  const sup = new Supervisor({
    rootId: "root-r4",
    rootDir: join(dir, "root"),
    store: new InMemoryRunStore("root-r4"),
    policy,
    governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
    schedulerLimits: { maxRunnable: 2, maxResidentWorkers: 4, maxOpenAgents: 8 },
    executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() },
    workspace: new DummyWorkspaceManager() as never,
    workerFactory: (o) => {
      const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
      const hostAgentDir = join(dir, "host-agent");
      mkdirSync(hostAgentDir, { recursive: true });
      writeFileSync(join(hostAgentDir, "auth.json"), JSON.stringify({}));
      return new WorkerHandle(
        {
          workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
          rootEpoch: o.rootEpoch,
          agentId: o.agentId,
          sdkRoot: SDK_ROOT,
          deterministic: true,
          agentDir: join(dir, "worker-home", o.agentId),
          sessionsDir: join(dir, "sessions"),
          hostAgentDir,
          script: opts.script,
        },
        binding,
      );
    },
    governingRegistry: () => ({
      isActive: () => true,
      listHandles: () => [opts.parent],
      getHandle: () => opts.parent,
      baseCtx: () => ({}),
    }),
  });
  t.after(() => sup.shutdown().catch(() => {}));
  const g = await sup.spawn("governor", { taskName: "r4", message: "go", profile: "reader" }, `r4-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const done = (async () => {
    const start = Date.now();
    while (Date.now() - start < 60000) {
      const recs = sup.runStore.readSince(0, 100000).records;
      if (recs.some((r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("worker never settled");
  })();
  return { sup, dir, events, done };
}

function legacyParent(counters: { prepare: number; effects: number; seen: unknown[] }) {
  return {
    name: CG,
    description: "preparable parent",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    prepareArguments: (a: unknown) => {
      counters.prepare++;
      const rec = a as Record<string, unknown>;
      if (typeof rec["q"] === "string") return { q: rec.q };
      return { q: String(rec["legacy"] ?? "") };
    },
    execute: (async (_id: string, params: unknown) => {
      counters.effects++;
      counters.seen.push(params);
      return { content: [{ type: "text", text: "prepared-ok" }], details: {} };
    }),
  };
}

test("R4 legacy raw call succeeds prepared with declared schema intact", async (t) => {
  const counters = { prepare: 0, effects: 0, seen: [] as unknown[] };
  const h = await realWorkerHarness(t, {
    parent: legacyParent(counters),
    script: [{ tool: CG, args: { legacy: "x" } }, { text: "done" }],
  });
  await h.done;
  assert.equal(counters.effects, 1, "legacy call never reached the parent prepared");
  assert.deepEqual(counters.seen[0], { q: "x" });
  // Preparation runs exactly once per effect (no double-prepare at execute).
  assert.equal(counters.prepare, 1, `prepare ran ${counters.prepare}x per 1 effect`);
});

test("R4 malformed raw fails prepared with no effect", async (t) => {
  const counters = { prepare: 0, effects: 0, seen: [] as unknown[] };
  const strict = {
    name: CG,
    description: "strict parent",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    prepareArguments: (a: unknown) => {
      counters.prepare++;
      const rec = a as Record<string, unknown>;
      if (typeof rec["bad"] !== "undefined") throw new Error("bad raw shape");
      if (typeof rec["q"] === "string") return { q: rec.q };
      return { q: String(rec["legacy"] ?? "") };
    },
    execute: (async (_id: string, params: unknown) => {
      counters.effects++;
      counters.seen.push(params);
      return { content: [{ type: "text", text: "ok" }], details: {} };
    }),
  };
  const h = await realWorkerHarness(t, {
    parent: strict,
    script: [{ tool: CG, args: { bad: true } }, { text: "done" }],
  });
  await h.done;
  assert.equal(counters.effects, 0, "malformed raw produced a parent effect");
  assert.equal(counters.prepare, 1, "preparation never ran for malformed raw");
});

test("R4 parallel same-tool calls keep identities (no cross-wire)", async (t) => {
  const counters = { prepare: 0, effects: 0, seen: [] as unknown[] };
  const h = await realWorkerHarness(t, {
    parent: legacyParent(counters),
    script: [
      { tool: CG, args: { legacy: "one" } },
      { tool: CG, args: { legacy: "two" } },
      { text: "done" },
    ],
  });
  await h.done;
  assert.equal(counters.effects, 2, `expected 2 effects, got ${counters.effects}`);
  assert.deepEqual(counters.seen, [{ q: "one" }, { q: "two" }], `identity mix: ${JSON.stringify(counters.seen)}`);
  assert.equal(counters.prepare, 2, `prepare ran ${counters.prepare}x for 2 effects (must be exactly once each)`);
});

test("R4 truncated turns skip preparation (pure helper)", () => {
  assert.equal(shouldSkipPreparation("length"), true);
  assert.equal(shouldSkipPreparation("stop"), false);
  assert.equal(shouldSkipPreparation(null), false);
  assert.equal(shouldSkipPreparation(undefined), false);
});

async function ticketHarness(
  t: HarnessT,
  opts: { handles: () => import("../src/governing-runtime.ts").PinnedGoverningHandle[]; allowed: string[] },
): Promise<{
  sup: Supervisor;
  worker: { call: (tool: string, args: Record<string, unknown>) => Promise<{ content: string; isError: boolean }> };
  channel: unknown;
  agentId: string;
  taskRunId: string;
  generation: number;
  rt: unknown;
}> {
  const { mkSup, tick } = await import("./ctl-worker.ts");
  const built = mkSup({ policy: (p) => { p.allowedTools = opts.allowed; } });
  (built.sup as unknown as { opts: { governingRegistry?: unknown } }).opts.governingRegistry = () => ({
    isActive: () => true,
    listHandles: () => opts.handles(),
    getHandle: (n: string) => opts.handles().find((h) => (h as { name?: string }).name === n),
    baseCtx: () => ({}),
  });
  const g = await built.sup.spawn("governor", { taskName: "tick", message: "m", profile: "reader" }, `tick-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  await tick();
  const rt = (built.sup as unknown as { agents: Map<string, unknown> }).agents.get(g.agentId);
  return {
    sup: built.sup as unknown as Supervisor,
    worker: built.byAgent(g.agentId)[0],
    channel: built.byAgent(g.agentId)[0],
    agentId: g.agentId,
    taskRunId: g.taskRunId,
    generation: g.generation,
    rt,
  };
}


test("R4 ticket revoked between prepare and execute denies without effect", async (t) => {
  const tool = "mcp__codegraph__codegraph_explore";
  let prepareEffects = 0;
  const original = {
    name: tool, description: "orig", parameters: { type: "object" },
    // NOTE: parent preparation is specified SYNC (pinned agent-loop
    // prepare helper); a deferred async preparation cannot exist, so the
    // deterministic revocation window is prepare-return -> execute-call.
    prepareArguments: (_a: unknown) => ({ q: "x" }),
    execute: (async () => { prepareEffects++; return { content: [{ type: "text", text: "orig-ran" }], details: {} }; }),
  };
  let revoked = false;
  const h = await ticketHarness(t, {
    handles: () => (revoked ? [] : [original]),
    allowed: [tool],
  });
  const env = { taskRunId: h.taskRunId, executionGeneration: h.generation };
  const sup = h.sup as unknown as {
    onPrepareRequest: (rt: unknown, w: unknown, p: unknown, e: unknown) => Promise<{ ok: boolean; ticket?: string; preparedArgs?: unknown; error?: string }>;
    onToolRequest: (rt: unknown, w: unknown, p: unknown, e: unknown) => Promise<{ content: string; isError: boolean }>;
  };
  const prep = await sup.onPrepareRequest(h.rt, h.channel, { tool, args: {}, toolCallId: "tc-rev-1" }, env);
  assert.equal(prep.ok, true);
  revoked = true; // capability revoked after minting, before execution
  const res = await sup.onToolRequest(
    h.rt, h.channel,
    { tool, args: { q: "x" }, ticket: prep.ticket, toolCallId: "tc-rev-2", usage: null },
    env,
  );
  assert.equal(res.isError, true, "revoked ticket executed");
  assert.match(res.content, /POLICY_DENIED|STALE|unavailable/);
  assert.equal(prepareEffects, 0);
});

test("R4 same-schema swap while ticket pending denies at execute without effect", async (t) => {
  const tool = "mcp__codegraph__codegraph_explore";
  const schema = { type: "object", properties: { q: { type: "string" } }, required: ["q"] };
  let newImplEffects = 0;
  const original = {
    name: tool, description: "same", parameters: schema,
    prepareArguments: (a: unknown) => a,
    execute: (async () => ({ content: [{ type: "text", text: "orig" }], details: {} })),
  };
  const replacement = {
    name: tool, description: "same", parameters: schema,
    prepareArguments: (a: unknown) => a,
    execute: (async () => { newImplEffects++; return { content: [{ type: "text", text: "new" }], details: {} }; }),
  };
  let swapped = false;
  const h = await ticketHarness(t, {
    handles: () => [swapped ? replacement : original],
    allowed: [tool],
  });
  const env = { taskRunId: h.taskRunId, executionGeneration: h.generation };
  const sup = h.sup as unknown as {
    onPrepareRequest: (rt: unknown, w: unknown, p: unknown, e: unknown) => Promise<{ ok: boolean; ticket?: string; preparedArgs?: unknown; error?: string }>;
    onToolRequest: (rt: unknown, w: unknown, p: unknown, e: unknown) => Promise<{ content: string; isError: boolean }>;
  };
  const prep = await sup.onPrepareRequest(h.rt, h.channel, { tool, args: { q: "x" }, toolCallId: "tc-swap-1" }, env);
  assert.equal(prep.ok, true);
  swapped = true; // same-name, same-schema replacement with a new impl
  const res = await sup.onToolRequest(
    h.rt, h.channel,
    { tool, args: { q: "x" }, ticket: prep.ticket, toolCallId: "tc-swap-2", usage: null },
    env,
  );
  assert.equal(res.isError, true, "swapped impl executed under the old ticket");
  assert.match(res.content, /POLICY_DENIED|rebound|mismatch|changed/);
  assert.equal(newImplEffects, 0);
});

test("R4 cancelled ticket purges: execute after interrupt denies", async (t) => {
  const tool = "mcp__codegraph__codegraph_explore";
  const parent = {
    name: tool, description: "d", parameters: { type: "object" },
    prepareArguments: (a: unknown) => a,
    execute: (async () => ({ content: [{ type: "text", text: "ok" }], details: {} })),
  };
  const h = await ticketHarness(t, { handles: () => [parent], allowed: [tool] });
  const env = { taskRunId: h.taskRunId, executionGeneration: h.generation };
  const sup = h.sup as unknown as {
    onPrepareRequest: (rt: unknown, w: unknown, p: unknown, e: unknown) => Promise<{ ok: boolean; ticket?: string; preparedArgs?: unknown; error?: string }>;
    onToolRequest: (rt: unknown, w: unknown, p: unknown, e: unknown) => Promise<{ content: string; isError: boolean }>;
    interrupt: (c: string, t2: string, r: string) => Promise<unknown>;
  };
  const prep = await sup.onPrepareRequest(h.rt, h.channel, { tool, args: { q: "x" }, toolCallId: "tc-cancel-1" }, env);
  assert.equal(prep.ok, true);
  await sup.interrupt("governor", h.agentId, `int-${Date.now()}`);
  const { tick: tick2 } = await import("./ctl-worker.ts");
  await tick2(50);
  const res = await sup.onToolRequest(h.rt, h.channel, { tool, args: { q: "x" }, ticket: prep.ticket, toolCallId: "tc-cancel-2", usage: null }, env);
  assert.equal(res.isError, true, "purged ticket executed after interrupt");
  assert.match(res.content, /POLICY_DENIED|STALE|NOT_RUNNING/);
});

test("R4 bare peer without prepare support hard-errors UNSUPPORTED (no silent downgrade)", async (t) => {
  if (!SDK_ROOT) {
    t.skip("PI_SUBAGENTS_SDK_ROOT unset; R4 needs the pinned SDK worker");
    return;
  }
  // Bare transport answering ONLY tool.execute (predates tool.prepare):
  // explicit UNSUPPORTED is a hard preparation error with cleanup, never a
  // silent downgrade to unticketed execute. The worker settles without
  // invoking the tool.
  const dir = mkdtempSync(join(tmpdir(), "subagents-r4-bare-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const name = CG;
  const reported = { input: 11, output: 7, cacheRead: 1, cacheWrite: 2, totalTokens: 21, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 } };
  const events: Array<{ kind: string }> = [];
  let calls = 0;
  const worker = new WorkerHandle(
    {
      workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
      rootEpoch: "epoch-bare",
      agentId: "a-bare",
      sdkRoot: SDK_ROOT,
      deterministic: true,
      agentDir: join(dir, "worker-home"),
      sessionsDir: join(dir, "sessions"),
      script: [{ tool: name, args: { q: "hello" } }, { text: "done" }],
    },
    bindChannel("epoch-bare", "a-bare", "instance-bare"),
  );
  worker.setEventHandler((e) => events.push(e));
  worker.setToolRequestHandler(async () => {
    calls++;
    return { content: [{ type: "text", text: "legacy-ok" }], details: {}, usage: reported, isError: false };
  });
  t.after(() => worker.kill());
  await worker.launch();
  await worker.request("initialize", {
    taskText: "go", profile: "reader", instructionHash: "", instructions: { contextFiles: [], skills: [] },
    model: { provider: "openai", id: "deterministic-test", thinkingLevel: "off" },
    taskRunId: "t-bare", executionGeneration: 1, workdir: dir, readRoots: [dir], writable: false,
    tools: [name],
    externalTools: [{ name, description: "d", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } }],
  }, { taskRunId: "t-bare", generation: 1, timeoutMs: 60000 });
  const deadline = Date.now() + 20000;
  while (!events.some((e) => e.kind === "settled") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.ok(events.some((e) => e.kind === "settled"), "bare-peer worker never settled");
  assert.equal(calls, 0, "bare peer silently downgraded to unticketed execute; explicit UNSUPPORTED must hard-error");
});
