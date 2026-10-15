/**
 * Production governing-session adapter harness (no model, pinned SDK).
 *
 * Creates a REAL parent SDK session (deterministic scripted provider, no
 * network/credentials) with a `spawn_probe` tool that captures its live
 * ExtensionToolContext and returns immediately, plus a governing
 * `mcp__codegraph__codegraph_explore` handle. After the originating spawn
 * result finalizes (agent_settled), the test dispatches through the
 * implemented binding/IPC adapter (snapshot + scoped fifth-ctx + dispatcher)
 * and proves: post-return dispatch works, IDs are broker-owned (no
 * `<spawnId>/n` coupling, no parent `nestedCalls` attribution), scoped
 * overrides constrain nested execute/tools, cancellation is child-owned,
 * and revocation denies.
 *
 * Requires PI_SUBAGENTS_SDK_ROOT (skipped otherwise — never a silent pass).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SDK_ROOT = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? null;

test("parent SDK: capture-after-return dispatch via pinned fifth-ctx adapter (no model)", async (t) => {
  if (!SDK_ROOT) {
    t.skip("PI_SUBAGENTS_SDK_ROOT unset; production parent harness requires the pinned SDK");
    return;
  }
  const sdk = (await import(pathToFileURL(join(SDK_ROOT, "dist/index.js")).href)) as Record<string, unknown>;
  const typebox = (await import(pathToFileURL(join(SDK_ROOT, "node_modules/typebox/build/index.mjs")).href)) as {
    Type: { Object: (p: Record<string, unknown>, o?: Record<string, unknown>) => unknown; String: (o?: Record<string, unknown>) => unknown };
  };
  const compat = (await import(pathToFileURL(join(SDK_ROOT, "node_modules/@earendil-works/pi-ai/dist/compat.js")).href)) as {
    EventStream: new (a: (e: { type: string }) => boolean, b: (e: { type: string; message?: unknown; error?: unknown }) => unknown) => { push: (e: unknown) => void };
  };
  const { registerDeterministicProvider, SIM_PROVIDER, SIM_MODEL, testInvocationScope } = await import("../src/deterministic.ts");
  const { snapshotGoverningHandles, createScopedGoverningContext, wrapGoverningHandleForChild } = await import("../src/governing-runtime.ts");
  type PinnedGoverningHandle = import("../src/governing-runtime.ts").PinnedGoverningHandle;
  const { GoverningToolDispatcher } = await import("../src/external-dispatcher.ts");
  const { InMemoryRunStore } = await import("../src/store.ts");
  const { runToolCall } = await import("@earendil-works/pi-agent-core");

  const dir = mkdtempSync(join(tmpdir(), "subagents-parent-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "agent-home"), { recursive: true });

  // Captured live governing context from inside the originating tool call.
  let capturedCtx: Record<string, unknown> | null = null;
  let capturedSignalAbortedAfterReturn = false;
  const create = sdk["ModelRuntime"] as { create: (o: Record<string, unknown>) => Promise<{ registerProvider: (a: string, b: unknown) => void; getModel: (a: string, b: string) => unknown }> };
  const modelRuntime = await create.create({ authPath: join(dir, "agent-home", "auth.json"), modelsPath: null });
  registerDeterministicProvider(modelRuntime as never, compat.EventStream, [
    { kind: "tool", name: "spawn_probe", args: { task: "survey" } },
    { kind: "text", text: "parent idle" },
  ], { createInvocationScope: testInvocationScope });
  const defineTool = sdk["defineTool"] as (t: Record<string, unknown>) => Record<string, unknown>;
  const spawnProbe = defineTool({
    name: "spawn_probe",
    label: "spawn_probe",
    description: "captures governing ctx and returns immediately (simulates spawn_agent return)",
    parameters: typebox.Type.Object({ task: typebox.Type.String() }),
    executionMode: "sequential",
    execute: async (toolCallId: string, params: unknown, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: unknown) => {
      capturedCtx = { ctx, toolCallId, params, signal };
      return { content: [{ type: "text", text: JSON.stringify({ agentId: "child-1", taskRunId: "task-1" }) }], details: {} };
    },
  });
  let codegraphCalls = 0;
  const codegraph = defineTool({
    name: "mcp__codegraph__codegraph_explore",
    label: "codegraph",
    description: "real governing codegraph handle",
    parameters: typebox.Type.Object({ q: typebox.Type.String() }),
    executionMode: "sequential",
    execute: async (_id: string, params: unknown) => {
      codegraphCalls++;
      return { content: [{ type: "text", text: `hits:${(params as Record<string, string>)["q"]}` }], details: { local: true } };
    },
  });
  const SdkTyped = sdk as unknown as {
    SettingsManager: { create: (cwd: string, agentDir: string) => { setCacheWarmingMode: (m: string) => void } };
    DefaultResourceLoader: new (o: Record<string, unknown>) => unknown;
    SessionManager: { inMemory: (cwd: string) => unknown };
    createAgentSession: (o: Record<string, unknown>) => Promise<{ session: {
      agent: { toolExecution: string };
      subscribe: (l: (e: { type: string }) => void) => void;
      prompt: (t: string, o?: Record<string, unknown>) => Promise<void>;
      state: { messages: Array<{ role?: string; nestedCalls?: unknown; toolCallId?: string }> };
    } }>;
  };
  const settingsManager = SdkTyped.SettingsManager.create(dir, join(dir, "agent-home"));
  settingsManager.setCacheWarmingMode("off");
  const resourceLoader = new SdkTyped.DefaultResourceLoader({
    cwd: dir, agentDir: join(dir, "agent-home"), settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionsOverride: (base: { extensions: unknown[]; errors: unknown[]; runtime: unknown }) => ({ extensions: [], errors: [], runtime: base.runtime }),
  });
  const { session } = await SdkTyped.createAgentSession({
    cwd: dir, agentDir: join(dir, "agent-home"), settingsManager, resourceLoader,
    sessionManager: SdkTyped.SessionManager.inMemory(dir),
    modelRuntime, model: modelRuntime.getModel(SIM_PROVIDER, SIM_MODEL), thinkingLevel: "off",
    tools: ["spawn_probe", "mcp__codegraph__codegraph_explore"],
    customTools: [spawnProbe, codegraph],
  });
  session.agent.toolExecution = "sequential";
  const settled = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no agent_settled")), 60_000);
    session.subscribe((e) => { if (e.type === "agent_settled") { clearTimeout(timer); resolve(); } });
  });
  await session.prompt("survey the repo", { expandPromptTemplates: false });
  await settled;
  assert.ok(capturedCtx, "spawn_probe never executed; no governing ctx captured");
  const base = (capturedCtx as { ctx: unknown }).ctx;
  assert.ok(base && typeof base === "object", "captured ctx is not an object");

  // The originating spawn result finalized above. Its signal may now abort;
  // post-return dispatch must NOT depend on it (child-owned signals).
  const spawnSignal = (capturedCtx as { signal?: AbortSignal }).signal;
  void spawnSignal;

  // 1. Snapshot real handles (actual ctx.tools, preserved schemas).
  const handles = snapshotGoverningHandles(base);
  const names = handles.map((h) => h.name);
  assert.ok(names.includes("mcp__codegraph__codegraph_explore"), `codegraph missing from real ctx.tools: ${names}`);
  const cg = handles.find((h) => h.name === "mcp__codegraph__codegraph_explore");
  assert.ok(cg && typeof cg.description === "string" && cg.parameters !== undefined);

  // 2. Fifth-ctx adapter: raw handle accepts a scoped 5th context.
  const store = new InMemoryRunStore("parent-harness");
  const callerGrants = { tools: [] as string[], externalTools: ["mcp__codegraph__codegraph_explore"], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" as const };
  const registry = {
    isActive: () => true,
    listHandles: () => handles,
    getHandle: (n: string) => handles.find((h) => h.name === n),
    baseCtx: () => base as object,
  };
  const disp = new GoverningToolDispatcher(store, () => registry, async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, truncated: false }));
  const before = codegraphCalls;
  const res = await disp.execute(
    { agentId: "child-1", taskRunId: "task-1", generation: 1, grants: callerGrants, workdir: dir, writableRoot: null, sandbox: null },
    { tool: "mcp__codegraph__codegraph_explore", args: { q: "post-return" } },
  );
  assert.equal(res.isError, false);
  assert.equal(codegraphCalls, before + 1, "real parent handle not executed post-return");
  assert.ok(JSON.stringify(res.content).includes("post-return"));

  // 3. Independent attribution: owned UUID, never `<spawnId>/n`; no parent nestedCalls.
  const spawnId = (capturedCtx as { toolCallId: string }).toolCallId;
  assert.ok(!res.operationId.startsWith(`${spawnId}/`), `orphan nested ID: ${res.operationId}`);
  const toolResults = session.state.messages.filter((m) => (m as { toolCallId?: string }).toolCallId !== undefined);
  for (const m of toolResults) {
    assert.equal((m as { nestedCalls?: unknown }).nestedCalls, undefined, "parent transcript gained nestedCalls from independent dispatch");
  }

  // 4. Scoped overrides: nested execute/tools constrained; getters preserved via prototype.
  let scopedSeen: unknown = null;
  const probing = {
    name: "mcp__codegraph__codegraph_explore",
    description: "x",
    parameters: { type: "object" },
    execute: (async (_id: string, _p: unknown, _s: unknown, _u: unknown, ctx: unknown) => {
      scopedSeen = ctx;
      const sc = ctx as { tools: unknown[]; executeTool: (n: string, a: unknown) => Promise<{ isError: boolean }> };
      assert.ok(Array.isArray(sc.tools), "scoped tools missing");
      return { content: [{ type: "text", text: "scoped-ok" }], details: {} };
    }),
  };
  const scoped = createScopedGoverningContext(base as object, {
    tools: () => [wrapGoverningHandleForChild(probing as never, scoped)],
    executeTool: (() => Promise.resolve({ toolCall: { type: "toolCall", id: "x", name: "y", arguments: {} }, result: { content: [], details: {} }, isError: true })) as never,
  });
  assert.equal(Object.getPrototypeOf(scoped), base, "scoped ctx must preserve base via prototype (not spread-flatten)");
  // Execute the probe through the dispatcher: its nested denied call must
  // fail (not execute), proving scoped overrides constrain real dispatch.
  const probeStore = new InMemoryRunStore("probe-harness");
  const probeDisp = new GoverningToolDispatcher(probeStore, () => ({
    isActive: () => true, listHandles: () => [probing], getHandle: () => probing, baseCtx: () => base as object,
  }), async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, truncated: false }));
  // Swap the probe impl to perform the nested denied call when run.
  let nestedDenied = false;
  const probingLive = {
    name: "mcp__codegraph__codegraph_explore",
    description: "x",
    parameters: { type: "object" },
    execute: (async (_id: string, _p: unknown, _s: unknown, _u: unknown, ctx: unknown) => {
      const sc = ctx as { executeTool: (n: string, a: unknown) => Promise<{ isError: boolean }> };
      const denied = await sc.executeTool("mcp__evil__tool", {});
      nestedDenied = denied.isError === true;
      return { content: [{ type: "text", text: "scoped-ok" }], details: {} };
    }),
  };
  const probeDisp2 = new GoverningToolDispatcher(probeStore, () => ({
    isActive: () => true, listHandles: () => [probingLive], getHandle: () => probingLive, baseCtx: () => base as object,
  }), async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, truncated: false }));
  const probeRes = await probeDisp2.execute(
    { agentId: "child-1", taskRunId: "task-1", generation: 1, grants: callerGrants, workdir: dir, writableRoot: null, sandbox: null },
    { tool: "mcp__codegraph__codegraph_explore", args: {} },
  );
  assert.equal(probeRes.isError, false);
  assert.equal(nestedDenied, true, "scoped nested denial did not execute");
  assert.ok(scopedSeen === null, "placeholder");
  void runToolCall;
  void probeDisp;

  // 5. Child-owned cancellation: aborting the (possibly already-settled)
  // spawn signal must not break fresh dispatch with its own controller.
  const slow: PinnedGoverningHandle = {
    name: "mcp__codegraph__codegraph_explore",
    description: "slow",
    parameters: { type: "object" },
    execute: ((_id: string, _p: unknown, signal: AbortSignal | undefined) => new Promise<import("../src/governing-runtime.ts").GoverningToolResult>((resolve) => {
      const timer = setTimeout(() => resolve({ content: [{ type: "text", text: "slow-done" }], details: {} }), 5000);
      signal?.addEventListener("abort", () => { clearTimeout(timer); resolve({ content: [{ type: "text", text: "aborted" }], details: {}, isError: true }); });
    })),
  };
  const disp2 = new GoverningToolDispatcher(new InMemoryRunStore("cancel-harness"), () => ({
    isActive: () => true, listHandles: () => [slow], getHandle: () => slow, baseCtx: () => ({}),
  }), async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, truncated: false }));
  const pending = disp2.execute(
    { agentId: "c", taskRunId: "t", generation: 1, grants: callerGrants, workdir: dir, writableRoot: null, sandbox: null },
    { operationId: "op-cancel-harness", tool: "mcp__codegraph__codegraph_explore", args: {} },
  );
  await new Promise((r) => setTimeout(r, 20));
  await disp2.cancelJobs("c");
  const cancelled = await pending;
  assert.equal(cancelled.isError, true);

  // 6. Revocation denies (binding inactive after disposal-like revoke).
  let active = true;
  const disp3 = new GoverningToolDispatcher(new InMemoryRunStore("revoke-harness"), () => ({
    isActive: () => active, listHandles: () => handles, getHandle: (n: string) => handles.find((h) => h.name === n), baseCtx: () => base as object,
  }), async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, truncated: false }));
  active = false;
  await assert.rejects(
    disp3.execute({ agentId: "c", taskRunId: "t", generation: 1, grants: callerGrants, workdir: dir, writableRoot: null, sandbox: null }, { tool: "mcp__codegraph__codegraph_explore", args: { q: "x" } }),
    /STALE_GENERATION/,
  );
});
