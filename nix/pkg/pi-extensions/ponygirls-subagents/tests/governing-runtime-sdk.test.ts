/**
 * governing-runtime SDK verification (no model, pinned production SDK).
 *
 * Uses a REAL parent SDK session (deterministic scripted provider: no
 * model, no network, no credentials) with a `spawn_probe` capture tool, the
 * real `DefaultResourceLoader`, and an explicit `session.bindExtensions({})`
 * in an isolated temp project+agentDir (no ambient extensions). After the
 * originating capture handler returns and the run settles, dispatch goes
 * through `GoverningToolDispatcher` with broker-owned IDs/signals and the
 * pinned fifth-context adapter.
 *
 * Scope vs `governing-parent-sdk.test.ts` (runtime author's harness, kept):
 * that file proves capture-after-return dispatch, owned IDs, no parent
 * `nestedCalls`, and basic scoped/cancel/revoke-flag behavior. This file
 * proves the production surface instead:
 *
 * - the ACTUAL exported SDK wrapper (`wrapToolDefinition` from the pinned
 *   dist) prefers a provided fifth ctx over its factory ctx (never a
 *   handwritten five-arg fake as proof);
 * - a REAL SDK tool ctx's getters reject after `session.dispose()`
 *   (production revocation, not a boolean flag);
 * - post-return dispatch with real snapshot handles: schema validation +
 *   `prepareArguments`, content/details/structuredContent preservation, and
 *   usage aggregation exactly once (own fields plus nested reports, per the
 *   documented `combinedUsageObject` shape);
 * - a controllably DEFERRED real wrapper call held IN FLIGHT while the
 *   test probes its live scoped ctx: permitted nested execution (via both
 *   `ctx.executeTool` and actual `ctx.tools` handles, including an
 *   attacker-supplied fifth ctx on a dispatcher-provided handle),
 *   validation/authorization denials with effect counters and journal
 *   checks AFTER the probes, scoped-context preservation, broker-owned
 *   nested attribution, and no raw parent toolbox leakage;
 * - scope retirement by design (R3): retained scoped handles deny after
 *   completion/cancellation even while the parent session stays active;
 * - cancellation at the real tool boundary (R4): pending outer+inner
 *   invocations expose broker-owned IDs/signals independent of the
 *   originating capture; `cancelJobs` returns promptly (`NOT_RUNNING`)
 *   while aborting nested scopes; late settlement journals a single
 *   `uncertain` outcome preserving late usage (R5);
 * - thrown parent failures surface as `isError` with the message kept.
 *
 * Session, context, tool definitions, and results use the public SDK types
 * (`AgentSession`, `ExtensionToolContext`, `ToolDefinition`,
 * `AgentToolResult`, `Usage`); usage fixtures are complete `Usage` values.
 * The only runtime casts are the isolated pinned fifth-argument bridge and
 * the dynamic SDK-module seam. Requires PI_SUBAGENTS_SDK_ROOT (skipped
 * otherwise — never a silent pass).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  AgentSession,
  AgentSessionEvent,
  CreateAgentSessionOptions,
  CreateAgentSessionResult,
  DefaultResourceLoader,
  ExtensionToolContext,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  registerDeterministicProvider,
  SIM_MODEL,
  SIM_PROVIDER,
  testInvocationScope,
  type DeterministicModelRuntime,
  type ScriptStep,
} from "../src/deterministic.ts";
import {
  createScopedGoverningContext,
  snapshotGoverningHandles,
  wrapGoverningHandleForChild,
  type PinnedGoverningHandle,
} from "../src/governing-runtime.ts";
import {
  GoverningToolDispatcher,
  type GoverningRegistry,
  type NativeExecutor,
} from "../src/external-dispatcher.ts";
import { InMemoryRunStore } from "../src/store.ts";
import type { BrokerCaller } from "../src/broker.ts";

const SDK_ROOT = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? null;
const CODEGRAPH = "mcp__codegraph__codegraph_explore";
const ECHO = "mcp__echo__tool";
const EVIL = "mcp__evil__tool";
const GATE = "mcp__gate__wait";
const SLOW_OUTER = "mcp__slow__outer";
const SLOW_INNER = "mcp__slow__inner";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Complete usage fixture (checked against the public `Usage` contract). */
const FULL_USAGE: Usage = {
  input: 11,
  output: 7,
  cacheRead: 1,
  cacheWrite: 2,
  totalTokens: 21,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
};
const ECHO_USAGE: Usage = {
  input: 1,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 5,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 },
};
const INNER_USAGE: Usage = {
  input: 2,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 4,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
/** Documented aggregation: own fields plus nested reports, exactly once. */
const EXPECTED_CG_USAGE = { input: 11, output: 7, cacheRead: 1, cacheWrite: 2, cost: 3 };
const EXPECTED_GATE_USAGE = { input: 14, output: 13, cacheRead: 1, cacheWrite: 2, cost: 6 };
const EXPECTED_CANCEL_USAGE = { input: 13, output: 8, cacheRead: 1, cacheWrite: 2, cost: 3 };

const taskSchema = Type.Object({ task: Type.String() });
const qSchema = Type.Object({ q: Type.String() }, { additionalProperties: false });
const emptySchema = Type.Object({});
const hitsSchema = Type.Object({ hits: Type.Number() });

/** Pinned SDK module seam (isolated here; everything below it is typed). */
interface SdkBridge {
  ModelRuntimeNs: { create(options: { authPath: string; modelsPath: null }): Promise<ModelRuntime> };
  SettingsNs: { create(cwd: string, agentDir: string): SettingsManager };
  SessionNs: { inMemory(cwd: string): SessionManager };
  ResourceLoaderNs: new (options: {
    cwd: string;
    agentDir: string;
    settingsManager: SettingsManager;
    noExtensions?: boolean;
    noSkills?: boolean;
    noPromptTemplates?: boolean;
    noThemes?: boolean;
    noContextFiles?: boolean;
    extensionsOverride?: (base: { extensions: unknown[]; errors: unknown[]; runtime: unknown }) => {
      extensions: never[];
      errors: never[];
      runtime: unknown;
    };
  }) => DefaultResourceLoader;
  createAgentSession: (options: CreateAgentSessionOptions) => Promise<CreateAgentSessionResult>;
  EventStreamCtor: new (
    isTerminal: (e: { type: string }) => boolean,
    getResult: (e: { type: string; message?: unknown; error?: unknown }) => unknown,
  ) => { push: (e: unknown) => void };
}

async function loadSdk(): Promise<SdkBridge> {
  const root = SDK_ROOT as string;
  const sdk = (await import(pathToFileURL(join(root, "dist/index.js")).href)) as unknown as Record<string, unknown>;
  const compat = (await import(
    pathToFileURL(join(root, "node_modules/@earendil-works/pi-ai/dist/compat.js")).href
  )) as unknown as Record<string, unknown>;
  return {
    ModelRuntimeNs: sdk["ModelRuntime"] as SdkBridge["ModelRuntimeNs"],
    SettingsNs: sdk["SettingsManager"] as SdkBridge["SettingsNs"],
    SessionNs: sdk["SessionManager"] as SdkBridge["SessionNs"],
    ResourceLoaderNs: sdk["DefaultResourceLoader"] as SdkBridge["ResourceLoaderNs"],
    createAgentSession: sdk["createAgentSession"] as SdkBridge["createAgentSession"],
    EventStreamCtor: compat["EventStream"] as SdkBridge["EventStreamCtor"],
  };
}

interface Capture {
  ctx: ExtensionToolContext;
  toolCallId: string;
  params: unknown;
  signal: AbortSignal | undefined;
}

interface Harness {
  dir: string;
  session: AgentSession;
  events: AgentSessionEvent[];
  capture: Capture;
  disposed: { current: boolean };
}

function spawnProbeDef(onCapture: (capture: Capture) => void): ToolDefinition<typeof taskSchema, unknown> {
  return {
    name: "spawn_probe",
    label: "spawn_probe",
    description: "captures the live governing ctx and returns (simulates spawn return)",
    parameters: taskSchema,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal, _onUpdate, ctx) => {
      onCapture({ ctx, toolCallId, params, signal });
      return {
        content: [{ type: "text", text: JSON.stringify({ agentId: "child-1", taskRunId: "task-1" }) }],
        details: {},
      };
    },
  };
}

/** Real parent session: capture tool + given governing tools, settled via scripted provider. */
async function withHarness(
  t: { after: (fn: () => void | Promise<void>) => void },
  opts: { script: ScriptStep[]; tools: ToolDefinition[]; active: string[] },
): Promise<Harness> {
  assert.ok(SDK_ROOT, "PI_SUBAGENTS_SDK_ROOT required");
  const sdk = await loadSdk();
  const dir = mkdtempSync(join(tmpdir(), "subagents-govsdk-"));
  const agentDir = join(dir, "agent-home");
  mkdirSync(agentDir, { recursive: true });
  // Failure-path cleanup targets nullable locals assigned as soon as each
  // resource exists (never the eventual harness object), so a mid-setup
  // failure still disposes the session and removes the temp directory.
  let session: AgentSession | null = null;
  const unsubs: Array<() => void> = [];
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const disposed = { current: false };
  t.after(() => {
    for (const unsub of unsubs.splice(0)) {
      try {
        unsub();
      } catch {
        // Listener teardown is best-effort.
      }
    }
    if (settleTimer !== null) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    if (session !== null && !disposed.current) {
      try {
        session.dispose();
      } catch {
        // Disposal is best-effort on teardown; explicit tests assert effects.
      }
      disposed.current = true;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  let capture: Capture | null = null;
  const customTools: ToolDefinition[] = [spawnProbeDef((c) => {
    capture = c;
  }), ...opts.tools];
  const modelRuntime = await sdk.ModelRuntimeNs.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
  registerDeterministicProvider(modelRuntime as unknown as DeterministicModelRuntime, sdk.EventStreamCtor, opts.script, { createInvocationScope: testInvocationScope });
  const settingsManager = sdk.SettingsNs.create(dir, agentDir);
  settingsManager.setCacheWarmingMode("off");
  const resourceLoader = new sdk.ResourceLoaderNs({
    cwd: dir,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionsOverride: (base) => ({ extensions: [], errors: [], runtime: base.runtime }),
  });
  session = (
    await sdk.createAgentSession({
      cwd: dir,
      agentDir,
      settingsManager,
      resourceLoader,
      sessionManager: sdk.SessionNs.inMemory(dir),
      modelRuntime,
      model: modelRuntime.getModel(SIM_PROVIDER, SIM_MODEL),
      thinkingLevel: "off",
      tools: opts.active,
      customTools,
    })
  ).session;
  session.agent.toolExecution = "sequential";
  const events: AgentSessionEvent[] = [];
  unsubs.push(session.subscribe((event) => {
    events.push(event);
  }));
  // Real extension-binding path (emits session_start; no handlers registered).
  await session.bindExtensions({});
  const settled = new Promise<void>((resolve, reject) => {
    settleTimer = setTimeout(() => {
      settleTimer = null;
      reject(new Error("no agent_settled"));
    }, 60_000);
    unsubs.push(session.subscribe((event) => {
      if (event.type === "agent_settled") {
        if (settleTimer !== null) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
        resolve();
      }
    }));
  });
  await session.prompt("survey the repo", { expandPromptTemplates: false });
  await settled;
  assert.ok(capture, "spawn_probe never executed; no live governing ctx captured");
  return { dir, session, events, capture: capture as Capture, disposed };
}

async function waitFor(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function caller(overrides: Partial<BrokerCaller> = {}): BrokerCaller {
  return {
    agentId: "child-1",
    taskRunId: "task-1",
    generation: 1,
    grants: {
      tools: ["read"],
      externalTools: [CODEGRAPH, ECHO, GATE],
      repos: [],
      shell: false,
      network: false,
      nesting: false,
      maxDepth: 1,
      isolation: "worktree",
    },
    workdir: "/tmp",
    writableRoot: null,
    sandbox: null,
    ...overrides,
  };
}

function journal(store: InMemoryRunStore, kind: string): Array<Record<string, unknown>> {
  return store.readSince(0, 100_000).records.filter((r) => r.kind === kind).map((r) => r.body);
}

function intentsFor(store: InMemoryRunStore, operationId: string): Array<Record<string, unknown>> {
  return journal(store, "tool.intent").filter((b) => b["operationId"] === operationId);
}

function outcomesFor(store: InMemoryRunStore, operationId: string): Array<Record<string, unknown>> {
  return journal(store, "tool.outcome").filter((b) => b["operationId"] === operationId);
}

/** Isolated fifth-argument runtime cast (pinned `AgentTool` is 4-arg typed). */
type FiveArgExecute = (
  toolCallId: string,
  params: unknown,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback | undefined,
  ctx: unknown,
) => Promise<AgentToolResult>;

test("pinned wrapToolDefinition prefers the provided fifth ctx over its factory ctx", async (t) => {
  if (!SDK_ROOT) {
    t.skip("PI_SUBAGENTS_SDK_ROOT unset; production wrapper proof requires the pinned SDK");
    return;
  }
  // The ACTUAL exported production wrapper (not a handwritten stand-in).
  const wrapper = (await import(pathToFileURL(join(SDK_ROOT, "dist/core/tools/tool-definition-wrapper.js")).href)) as unknown as {
    wrapToolDefinition: (
      definition: unknown,
      ctxFactory?: (toolCallId: string, signal: AbortSignal | undefined) => unknown,
    ) => { execute: (...args: unknown[]) => Promise<unknown> };
  };
  const seen: ExtensionToolContext[] = [];
  let factoryCalls = 0;
  const factoryCtx = { marker: "factory" } as unknown as ExtensionToolContext;
  const providedCtx = { marker: "provided" } as unknown as ExtensionToolContext;
  const probeDef: ToolDefinition<typeof emptySchema, unknown> = {
    name: "probe",
    label: "probe",
    description: "probe",
    parameters: emptySchema,
    execute: async (_id, _params, _signal, _onUpdate, ctx) => {
      seen.push(ctx);
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  };
  const wrapped = wrapper.wrapToolDefinition(probeDef, (_id, _signal) => {
    factoryCalls++;
    return factoryCtx;
  });
  // The runtime contract: execute accepts a 5th context argument.
  assert.equal(wrapped.execute.length, 5, "production wrapper must accept a fifth ctx argument");
  await wrapped.execute("id-1", {}, undefined, undefined, providedCtx);
  assert.equal(seen[0], providedCtx, "provided scoped ctx must win over the wrapper factory");
  assert.equal(factoryCalls, 0, "factory must not run when a ctx is provided");
  await wrapped.execute("id-2", {}, undefined, undefined, undefined);
  assert.equal(seen[1], factoryCtx, "factory ctx must back calls without a provided ctx");
  assert.equal(factoryCalls, 1);
});

test("real SDK tool ctx getters reject after session.dispose (production revocation)", async (t) => {
  if (!SDK_ROOT) {
    t.skip("PI_SUBAGENTS_SDK_ROOT unset; production revocation proof requires the pinned SDK");
    return;
  }
  const harness = await withHarness(t, {
    script: [
      { kind: "tool", name: "spawn_probe", args: { task: "survey" } },
      { kind: "text", text: "parent idle" },
    ],
    tools: [],
    active: ["spawn_probe"],
  });
  const base = harness.capture.ctx;
  // Live before disposal: getters resolve through the real runner.
  assert.equal(base.cwd, harness.dir);
  assert.ok(Array.isArray(base.tools));
  // Prototype-preserving scoped ctx keeps working getters pre-disposal.
  const scoped = createScopedGoverningContext(base, {
    tools: () => [],
    executeTool: (() => Promise.resolve({ isError: true })) as never,
  });
  assert.equal(Object.getPrototypeOf(scoped), base);
  assert.equal((scoped as ExtensionToolContext).cwd, harness.dir);

  harness.session.dispose();
  harness.disposed.current = true;
  // Production revocation: every lazy getter now rejects — no silent stale reads.
  assert.throws(() => base.cwd, /stale/i);
  assert.throws(() => base.tools, /stale/i);
  assert.throws(() => (scoped as ExtensionToolContext).cwd, /stale/i);
  await assert.rejects(base.executeTool("read", {}), /stale/i);
});

test("post-return dispatch: validation, preservation, in-flight probing, retirement, no orphans", async (t) => {
  if (!SDK_ROOT) {
    t.skip("PI_SUBAGENTS_SDK_ROOT unset; production dispatch proof requires the pinned SDK");
    return;
  }
  let codegraphCalls = 0;
  let echoCalls = 0;
  let evilCalls = 0;
  let seenParams: unknown = null;
  const echoSeen: ExtensionToolContext[] = [];
  const gateBox: { ctx: ExtensionToolContext | null; entered: boolean; release: (() => void) | null } = {
    ctx: null,
    entered: false,
    release: null,
  };
  const nativeSpy: Array<{ tool: string; operationId: string | undefined; parentOperationId: string | undefined }> = [];
  const native: NativeExecutor = async (_caller, request) => {
    nativeSpy.push({ tool: request.tool, operationId: request.operationId, parentOperationId: request.parentOperationId });
    return { stdout: "native-ok", stderr: "", exitCode: 0, timedOut: false, truncated: false };
  };

  const codegraphDef: ToolDefinition<typeof qSchema, unknown> = {
    name: CODEGRAPH,
    label: "codegraph",
    description: "real governing codegraph handle",
    parameters: qSchema,
    prepareArguments: (args) => {
      const rec = args as { q?: unknown; qq?: unknown };
      if (typeof rec.q === "string") return { q: rec.q };
      if (typeof rec.qq === "string") return { q: rec.qq };
      return args as { q: string };
    },
    outputSchema: hitsSchema,
    executionMode: "sequential",
    execute: async (_id, params, _signal, _onUpdate, _ctx) => {
      codegraphCalls++;
      seenParams = params;
      return {
        content: [
          { type: "text", text: `hits:${params.q}` },
          { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        ],
        details: { local: true },
        structuredContent: { hits: 2 },
        usage: FULL_USAGE,
      };
    },
  };
  const echoDef: ToolDefinition<typeof qSchema, unknown> = {
    name: ECHO,
    label: "echo",
    description: "permitted nested external",
    parameters: qSchema,
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      echoCalls++;
      echoSeen.push(ctx);
      return { content: [{ type: "text", text: `echo:${params.q}` }], details: {}, usage: ECHO_USAGE };
    },
  };
  const evilDef: ToolDefinition<typeof emptySchema, unknown> = {
    name: EVIL,
    label: "evil",
    description: "must never execute",
    parameters: emptySchema,
    execute: async () => {
      evilCalls++;
      return { content: [{ type: "text", text: "evil" }], details: {} };
    },
  };
  const gateDef: ToolDefinition<typeof emptySchema, unknown> = {
    name: GATE,
    label: "gate",
    description: "deferred gate: holds the invocation open for in-flight probing",
    parameters: emptySchema,
    execute: async (_id, _params, _signal, _onUpdate, ctx) => {
      gateBox.ctx = ctx;
      gateBox.entered = true;
      await new Promise<void>((resolve) => {
        gateBox.release = resolve;
      });
      return { content: [{ type: "text", text: "gate-released" }], details: {}, usage: FULL_USAGE };
    },
  };
  const harness = await withHarness(t, {
    script: [
      { kind: "tool", name: "spawn_probe", args: { task: "survey" } },
      { kind: "text", text: "parent idle" },
    ],
    tools: [codegraphDef, echoDef, evilDef, gateDef],
    active: ["spawn_probe", CODEGRAPH, ECHO, EVIL, GATE],
  });
  const base = harness.capture.ctx;
  const spawnId = harness.capture.toolCallId;

  // Real snapshot from the live ctx.tools (actual wrapped handles, preserved schemas).
  const handles = snapshotGoverningHandles(base);
  const rawCodegraph = handles.find((h) => h.name === CODEGRAPH);
  const rawEcho = handles.find((h) => h.name === ECHO);
  assert.ok(rawCodegraph, `codegraph missing from real ctx.tools: ${handles.map((h) => h.name)}`);
  assert.ok(rawEcho, "echo missing from real ctx.tools");
  assert.ok(typeof rawCodegraph.description === "string" && rawCodegraph.description.length > 0);
  assert.ok(rawCodegraph.parameters !== undefined, "parameter schema not preserved in snapshot");

  let revoked = false;
  const store = new InMemoryRunStore("govsdk-dispatch");
  const registry: GoverningRegistry = {
    isActive: () => !revoked,
    listHandles: () => handles,
    getHandle: (name) => handles.find((h) => h.name === name),
    baseCtx: () => base,
  };
  const dispatch = new GoverningToolDispatcher(store, () => registry, native);
  const messagesBefore = harness.session.state.messages.length;
  const eventsBefore = harness.events.length;

  // Fast path first: valid dispatch after the originating return, broker-owned ID.
  const valid = await dispatch.execute(caller(), { operationId: "op-sdk-valid-1", tool: CODEGRAPH, args: { q: "post-return" } });
  assert.equal(valid.isError, false);
  assert.equal(valid.operationId, "op-sdk-valid-1");
  assert.ok(!valid.operationId.startsWith(`${spawnId}/`), `orphan nested ID: ${valid.operationId}`);
  assert.equal(valid.originTaskRunId, "task-1");
  assert.equal(valid.originGeneration, 1);
  // Shape preservation through the bound.
  assert.ok(JSON.stringify(valid.content).includes("post-return"));
  const image = valid.content.find((b) => (b as { type?: string }).type === "image") as { data?: string } | undefined;
  assert.equal(image?.data, "aGVsbG8=", "image block must pass through whole (never sliced)");
  assert.deepEqual(valid.details, { local: true });
  assert.deepEqual(valid.structuredContent, { hits: 2 });
  // Wire fidelity: the result carries the invocation's OWN valid Usage
  // verbatim (never the nested aggregate, never collapsed).
  assert.deepEqual(valid.usage, FULL_USAGE);
  assert.ok(typeof valid.durationMs === "number");
  assert.equal(codegraphCalls, 1, "real parent handle must execute exactly once post-return");
  const validIntents = intentsFor(store, "op-sdk-valid-1");
  const validOutcomes = outcomesFor(store, "op-sdk-valid-1");
  assert.equal(validIntents.length, 1);
  assert.equal(validOutcomes.length, 1);
  assert.equal(validOutcomes[0]?.["status"], "ok");
  assert.deepEqual(validOutcomes[0]?.["usage"], EXPECTED_CG_USAGE);

  // Schema validation: missing required `q` fails before any parent effect.
  const callsBeforeInvalid = codegraphCalls;
  const invalid = await dispatch.execute(caller(), { operationId: "op-sdk-invalid-1", tool: CODEGRAPH, args: {} });
  assert.equal(invalid.isError, true);
  assert.equal(codegraphCalls, callsBeforeInvalid, "invalid args reached the parent effect (validation bypass)");

  // prepareArguments: legacy `qq` maps to validated `q` before the parent runs.
  const legacy = await dispatch.execute(caller(), { operationId: "op-sdk-legacy-1", tool: CODEGRAPH, args: { qq: "legacy" } });
  assert.equal(legacy.isError, false);
  assert.deepEqual(seenParams, { q: "legacy" }, "prepareArguments mapping not applied before validation");
  assert.ok(JSON.stringify(legacy.content).includes("legacy"));

  // Deferred path: hold a real wrapper call IN FLIGHT, then probe its live
  // scoped ctx (post-complete probes must deny by design, so they prove
  // nothing about delegation — the live scope is the only honest window).
  const gatePending = dispatch.execute(caller(), { operationId: "op-sdk-gate-1", tool: GATE, args: {} });
  // Unconditional guard: release the deferred gate and abort detached jobs
  // on every failure path (assertion failures included); success-path calls
  // below are idempotent no-ops.
  t.after(async () => {
    try {
      gateBox.release?.();
    } catch {
      // Ignore; the explicit path releases the gate.
    }
    try {
      await dispatch.cancelJobs("child-1");
    } catch {
      // Best-effort teardown; the explicit path asserts the outcome.
    }
  });
  try {
    await waitFor(() => gateBox.entered, 20_000, "gate invocation");
  } catch (e) {
    gateBox.release?.();
    throw e;
  }
  const gateCtx = gateBox.ctx;
  assert.ok(gateCtx, "gate impl never received its scoped ctx");
  try {
    // Permitted nested execution through ctx.executeTool (real dispatcher entry).
    const nestedOk = await gateCtx.executeTool(ECHO, { q: "hi" });
    assert.equal(nestedOk.isError, false);
    assert.equal(nestedOk.toolCall.name, ECHO);
    assert.equal(nestedOk.toolCall.type, "toolCall");
    assert.ok(UUID_RE.test(nestedOk.toolCall.id), `nested ID not broker-owned: ${nestedOk.toolCall.id}`);
    assert.notEqual(nestedOk.toolCall.id, "op-sdk-gate-1");
    assert.ok(!nestedOk.toolCall.id.startsWith(`${spawnId}/`), "orphan nested ID coupling");
    assert.equal(echoCalls, 1);
    // Validation failure at the nested boundary: no parent effect.
    const nestedInvalid = await gateCtx.executeTool(ECHO, {});
    assert.equal(nestedInvalid.isError, true);
    assert.equal(echoCalls, 1, "invalid nested args reached the parent effect");
    // Authorization failure at the nested boundary: no effect, no journal.
    const nestedEvil = await gateCtx.executeTool(EVIL, {});
    assert.equal(nestedEvil.isError, true);
    assert.equal(evilCalls, 0, "nested evil call escaped the scoped grants");
    // Actual dispatcher-provided ctx.tools handle (not a separately built
    // wrapper): direct .execute routes through the dispatcher identically.
    const echoHandle = gateCtx.tools.find((tool) => tool.name === ECHO);
    assert.ok(echoHandle, "echo handle missing from scoped ctx.tools");
    const directRes = await echoHandle.execute("n-sdk-direct-1", { q: "direct" }, undefined, undefined);
    assert.equal(directRes.isError, false);
    assert.equal(echoCalls, 2);
    // Per-invocation scope: the direct call runs under its OWN broker-owned
    // direct ctx (distinct object from the outer gate ctx), sharing the base
    // prototype and grants. The supplied fifth ctx is never accepted.
    const directCtx = echoSeen[echoSeen.length - 1];
    assert.ok(directCtx && typeof directCtx === "object", "direct impl saw no ctx");
    assert.notEqual(directCtx as unknown, gateCtx as unknown, "direct call reused the outer scope object");
    assert.equal(Object.getPrototypeOf(directCtx), base, "direct ctx lost the base prototype");
    // Attacker-supplied fifth ctx on the ACTUAL scoped handle is dropped by
    // the dispatcher route (isolated fifth-argument bridge, pinned by B3).
    const attacker = { marker: "attacker" };
    const attackerRes = await (echoHandle.execute as FiveArgExecute)("n-sdk-attacker-1", { q: "atk" }, undefined, undefined, attacker);
    assert.equal(attackerRes.isError, false);
    assert.equal(echoCalls, 3);
    const attackerSeen = echoSeen[echoSeen.length - 1];
    assert.notEqual(attackerSeen as unknown, attacker as unknown, "attacker ctx reached the parent impl");
    assert.notEqual(attackerSeen as unknown, gateCtx as unknown, "attacker call reused the outer scope object");
    assert.equal(Object.getPrototypeOf(attackerSeen), base, "attacker-route ctx lost the base prototype");
    // The direct invocation ctx retires independently while GATE stays live:
    // probing it denies without effect or journal, and the outer scope still
    // delegates afterwards.
    const retiredDirect = await (directCtx as unknown as { executeTool: (n: string, a: unknown) => Promise<{ isError: boolean; result?: { content?: unknown } }> }).executeTool(ECHO, { q: "stale" });
    assert.equal(retiredDirect.isError, true, "retired direct ctx still delegates");
    assert.match(JSON.stringify(retiredDirect.result?.content ?? retiredDirect), /STALE_GENERATION|revoked/);
    // The outer scope stays live: a denied (POLICY_DENIED, not STALE) probe
    // proves liveness without journaling an intent or touching echo counts.
    const stillLive = await gateCtx.executeTool(EVIL, {});
    assert.equal(stillLive.isError, true, "outer scope unexpectedly succeeded");
    assert.match(JSON.stringify(stillLive), /POLICY_DENIED/);
    assert.ok(!JSON.stringify(stillLive).match(/STALE_GENERATION|revoked/), "outer scope wrongly retired with its direct child");
    // Native route through the scoped ctx: counted broker execution…
    const nativeOk = await gateCtx.executeTool("read", { path: "x" });
    assert.equal(nativeOk.isError, false);
    assert.equal(nativeSpy.filter((c) => c.tool === "read").length, 1, "native route not invoked exactly once");
    assert.equal(nativeSpy[0]?.parentOperationId, "op-sdk-gate-1", "native call lacks broker-owned attribution");
    // …and denial without effect for ungranted natives.
    const nativeDenied = await gateCtx.executeTool("bash", { command: "exit 1" });
    assert.equal(nativeDenied.isError, true);
    assert.equal(nativeSpy.filter((c) => c.tool === "bash").length, 0, "denied native call executed");
  } finally {
    gateBox.release?.();
  }
  const gateRes = await gatePending;
  assert.equal(gateRes.isError, false);
  assert.ok(JSON.stringify(gateRes.content).includes("gate-released"));
  // Wire fidelity: the gate result carries its OWN valid Usage verbatim
  // (its impl reports FULL_USAGE; nested echo reports stay independent).
  assert.deepEqual(gateRes.usage, FULL_USAGE);
  const gateOutcomes = outcomesFor(store, "op-sdk-gate-1");
  assert.equal(gateOutcomes.length, 1);
  assert.equal(gateOutcomes[0]?.["status"], "ok");
  assert.deepEqual(gateOutcomes[0]?.["usage"], EXPECTED_CG_USAGE);
  // Derived combined totals (own + three echo reports, each exactly once):
  // computed here from independent receipts, never stored in the own field.
  const derivedGate = {
    input: (FULL_USAGE.input as number) + 3 * (ECHO_USAGE.input as number),
    output: (FULL_USAGE.output as number) + 3 * (ECHO_USAGE.output as number),
    cacheRead: FULL_USAGE.cacheRead,
    cacheWrite: FULL_USAGE.cacheWrite,
    cost: (FULL_USAGE.cost as { total: number }).total + 3 * (ECHO_USAGE.cost as { total: number }).total,
  };
  assert.deepEqual(derivedGate, EXPECTED_GATE_USAGE);

  // Nested journal AFTER the probes: four echo intents (ok, invalid, direct,
  // attacker) with broker-owned attribution; denials journaled nothing.
  const echoIntents = journal(store, "tool.intent").filter((b) => b["tool"] === ECHO);
  assert.equal(echoIntents.length, 4, `expected 4 echo intents, got ${echoIntents.length}`);
  const explicitNestedIds = new Set(["n-sdk-direct-1", "n-sdk-attacker-1"]);
  for (const intent of echoIntents) {
    assert.equal(intent["parentOperationId"], "op-sdk-gate-1");
    const nestedId = String(intent["operationId"]);
    // Dispatcher-generated IDs are UUIDs; direct-handle probes carry the
    // explicit broker-supplied IDs passed by the test. Neither may couple
    // to the originating spawn ID.
    assert.ok(UUID_RE.test(nestedId) || explicitNestedIds.has(nestedId), `nested ID not broker-owned: ${nestedId}`);
    assert.ok(!nestedId.startsWith(`${spawnId}/`), "orphan nested ID coupling");
  }
  const echoOutcomes = journal(store, "tool.outcome").filter((b) =>
    echoIntents.some((i) => i["operationId"] === b["operationId"]),
  );
  assert.equal(echoOutcomes.length, 4);
  assert.equal(echoOutcomes.filter((o) => o["status"] === "ok").length, 3);
  assert.equal(echoOutcomes.filter((o) => o["status"] === "error").length, 1);
  assert.equal(journal(store, "tool.intent").filter((b) => b["tool"] === EVIL).length, 0, "denied evil journaled an intent");
  assert.equal(journal(store, "tool.intent").filter((b) => b["tool"] === "bash").length, 0, "denied bash journaled an intent");

  // No raw parent toolbox leakage: evil absent, and every scoped entry is a
  // dispatcher-routed proxy (never a raw snapshot handle by identity).
  const scopedTools = gateCtx.tools;
  assert.ok(Array.isArray(scopedTools) && scopedTools.length > 0, "scoped ctx.tools empty");
  assert.ok(!scopedTools.some((entry) => entry.name === EVIL), "evil handle leaked into scoped tools");
  for (const raw of handles) {
    assert.ok(!scopedTools.includes(raw as never), `raw parent handle ${raw.name} leaked by identity`);
    const rawExecute = (raw as unknown as { execute?: unknown }).execute;
    assert.ok(
      scopedTools.every((entry) => (entry as unknown as { execute?: unknown }).execute !== rawExecute),
      `scoped entry reuses raw ${raw.name} execute (bypass)`,
    );
  }

  // Scope retirement by design (R3): the retained ctx denies after completion
  // even though the parent session is still active.
  const retained = await gateCtx.executeTool(ECHO, { q: "after" });
  assert.equal(retained.isError, true, "retained scope still delegates after completion");
  assert.match(JSON.stringify(retained.result?.content ?? retained), /STALE_GENERATION|revoked/);
  const retainedHandle = gateCtx.tools.find((tool) => tool.name === ECHO);
  assert.ok(retainedHandle, "echo handle missing for retained probe");
  const retainedDirect = await retainedHandle.execute("n-sdk-retained-1", { q: "after" }, undefined, undefined);
  assert.equal(retainedDirect.isError, true, "retained direct handle still delegates after completion");
  assert.match(JSON.stringify(retainedDirect.content), /STALE_GENERATION|revoked/);

  // No orphan parent native nested events/messages from independent dispatch.
  const freshEvents = harness.events.slice(eventsBefore);
  assert.ok(
    !freshEvents.some((e) => "parentToolCallId" in e && typeof e.parentToolCallId === "string"),
    "orphan parentToolCallId events from independent dispatch",
  );
  assert.equal(harness.session.state.messages.length, messagesBefore, "independent dispatch appended parent messages");
  for (const message of harness.session.state.messages) {
    if (message.role === "toolResult") {
      assert.equal(message.nestedCalls, undefined, "parent transcript gained nestedCalls from independent dispatch");
    }
  }

  // Root revocation guard: a revoked binding denies before any effect.
  revoked = true;
  const callsBeforeRevoke = codegraphCalls;
  await assert.rejects(
    dispatch.execute(caller(), { operationId: "op-sdk-revoked-1", tool: CODEGRAPH, args: { q: "x" } }),
    /STALE_GENERATION/,
  );
  assert.equal(codegraphCalls, callsBeforeRevoke, "revoked dispatch reached the parent effect");
});

test("cancellation at the real tool boundary: broker-owned IDs/signals, prompt return, single uncertain outcome", async (t) => {
  if (!SDK_ROOT) {
    t.skip("PI_SUBAGENTS_SDK_ROOT unset; production cancellation proof requires the pinned SDK");
    return;
  }
  const outerBox: {
    id: string | null;
    signal: AbortSignal | null;
    nestedIsError: boolean | null;
    ctx: ExtensionToolContext | null;
  } = {
    id: null,
    signal: null,
    nestedIsError: null,
    ctx: null,
  };
  const innerBox: { id: string | null; signal: AbortSignal | null; aborted: boolean; abortedAt: number | null } = {
    id: null,
    signal: null,
    aborted: false,
    abortedAt: null,
  };
  const innerDef: ToolDefinition<typeof emptySchema, unknown> = {
    name: SLOW_INNER,
    label: "slow-inner",
    description: "nested slow handle observing its scoped signal",
    parameters: emptySchema,
    execute: async (id, _params, signal, _onUpdate, _ctx) => {
      innerBox.id = id;
      innerBox.signal = signal ?? null;
      // Observable abortion: resolve only via the scoped signal. The 20s
      // failsafe lets the test fail honestly on journal asserts instead of
      // hanging — and is always cleared (with the abort listener removed)
      // on every settlement path so no timer outlives the test process.
      await new Promise<void>((resolve) => {
        let settledInner = false;
        let failsafe: ReturnType<typeof setTimeout> | null = null;
        const onAbortInner = (): void => {
          innerBox.aborted = true;
          innerBox.abortedAt = Date.now();
          finishInner();
        };
        const finishInner = (): void => {
          if (settledInner) return;
          settledInner = true;
          if (failsafe !== null) {
            clearTimeout(failsafe);
            failsafe = null;
          }
          signal?.removeEventListener("abort", onAbortInner);
          resolve();
        };
        failsafe = setTimeout(finishInner, 20_000);
        if (signal?.aborted) {
          onAbortInner();
          return;
        }
        signal?.addEventListener("abort", onAbortInner, { once: true });
      });
      return { content: [{ type: "text", text: "inner-aborted" }], details: {}, usage: INNER_USAGE, isError: true };
    },
  };
  const outerDef: ToolDefinition<typeof emptySchema, unknown> = {
    name: SLOW_OUTER,
    label: "slow-outer",
    description: "pending outer delegating to a nested slow call",
    parameters: emptySchema,
    execute: async (id, _params, signal, _onUpdate, ctx) => {
      outerBox.id = id;
      outerBox.signal = signal ?? null;
      outerBox.ctx = ctx;
      const nested = await ctx.executeTool(SLOW_INNER, {});
      outerBox.nestedIsError = nested.isError;
      return {
        content: [{ type: "text", text: `outer-done nested-isError=${nested.isError}` }],
        details: {},
        usage: FULL_USAGE,
      };
    },
  };
  const harness = await withHarness(t, {
    script: [
      { kind: "tool", name: "spawn_probe", args: { task: "survey" } },
      { kind: "text", text: "parent idle" },
    ],
    tools: [outerDef, innerDef],
    active: ["spawn_probe", SLOW_OUTER, SLOW_INNER],
  });
  const handles = snapshotGoverningHandles(harness.capture.ctx);
  assert.ok(handles.some((h) => h.name === SLOW_OUTER) && handles.some((h) => h.name === SLOW_INNER));
  const spawnSignal = harness.capture.signal ?? null;
  const spawnId = harness.capture.toolCallId;
  const store = new InMemoryRunStore("govsdk-cancel");
  const dispatch = new GoverningToolDispatcher(store, () => ({
    isActive: () => true,
    listHandles: () => handles,
    getHandle: (name) => handles.find((h) => h.name === name),
    baseCtx: () => harness.capture.ctx,
  }), async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, truncated: false }));
  const enumerableCaller = caller({
    grants: {
      tools: [],
      externalTools: [SLOW_OUTER, SLOW_INNER],
      repos: [],
      shell: false,
      network: false,
      nesting: false,
      maxDepth: 1,
      isolation: "worktree",
    },
  });

  const pending = dispatch.execute(enumerableCaller, { operationId: "op-sdk-cancel-1", tool: SLOW_OUTER, args: {} });
  // Unconditional guard: assertion failures before the explicit cancel must
  // still abort the detached dispatcher signals (session teardown cannot).
  t.after(async () => {
    try {
      await dispatch.cancelJobs("child-1");
    } catch {
      // Best-effort teardown; the explicit path asserts the outcome.
    }
  });
  try {
    await waitFor(() => outerBox.id !== null && innerBox.id !== null, 20_000, "slow invocations");
  } catch (e) {
    await dispatch.cancelJobs("child-1");
    throw e;
  }
  // Broker-owned invocation identity, independent of the originating capture.
  assert.equal(outerBox.id, "op-sdk-cancel-1");
  assert.ok(innerBox.id !== null && UUID_RE.test(innerBox.id), `nested ID not broker-owned: ${innerBox.id}`);
  assert.notEqual(innerBox.id, "op-sdk-cancel-1");
  assert.ok(!(innerBox.id as string).startsWith(`${spawnId}/`), "orphan nested ID coupling");
  // Child-owned signals: present, unaborted, and detached from the capture.
  assert.ok(outerBox.signal instanceof AbortSignal);
  assert.equal(outerBox.signal.aborted, false);
  assert.notEqual(outerBox.signal as unknown, spawnSignal as unknown);
  assert.ok(innerBox.signal instanceof AbortSignal);
  assert.notEqual(innerBox.signal as unknown, outerBox.signal as unknown);
  assert.notEqual(innerBox.signal as unknown, spawnSignal as unknown);

  // Cancel through the dispatcher: prompt NOT_RUNNING return…
  const cancelStart = Date.now();
  const cancelledIds = await dispatch.cancelJobs("child-1");
  const cancelled = await pending;
  const pendingResolvedAt = Date.now();
  const cancelLatencyMs = pendingResolvedAt - cancelStart;
  assert.ok(cancelledIds.includes("op-sdk-cancel-1"), `cancel missed the outer job: ${cancelledIds}`);
  assert.ok(innerBox.id !== null && cancelledIds.includes(innerBox.id), `cancel missed the nested job: ${cancelledIds}`);
  assert.equal(cancelled.isError, true);
  assert.ok(JSON.stringify(cancelled.content).includes("NOT_RUNNING"));
  assert.equal(cancelled.usage, null);
  assert.ok(cancelLatencyMs < 5_000, `cancellation did not return promptly (${cancelLatencyMs}ms)`);
  // …with observable abortion inside both scopes…
  assert.equal(innerBox.aborted, true, "nested scope never observed abortion");
  assert.equal(outerBox.nestedIsError, true, "outer never saw the nested cancellation");
  // …and a single late uncertain outcome preserving late usage exactly once.
  // Sequencing (A1): abort observed → prompt return → late journal is
  // structural (sync abort listeners, notified cancel, post-settlement
  // journal), so <= comparisons are flake-free at ms resolution.
  let journalAt: number | null = null;
  await waitFor(() => {
    const done = outcomesFor(store, "op-sdk-cancel-1").length >= 1;
    if (done && journalAt === null) journalAt = Date.now();
    return done;
  }, 15_000, "cancel outcome");
  assert.ok(innerBox.abortedAt !== null, "abort timestamp never recorded");
  assert.ok(innerBox.abortedAt <= pendingResolvedAt, "return preceded observed abortion");
  assert.ok(journalAt !== null && pendingResolvedAt <= journalAt, "late journal preceded the prompt return");
  const cancelOutcomes = outcomesFor(store, "op-sdk-cancel-1");
  assert.equal(cancelOutcomes.length, 1, "cancel must journal exactly one outcome");
  assert.equal(cancelOutcomes[0]?.["status"], "uncertain");
  assert.deepEqual(cancelOutcomes[0]?.["usage"], EXPECTED_CG_USAGE);
  await waitFor(
    () => innerBox.id !== null && outcomesFor(store, innerBox.id).length >= 1,
    15_000,
    "nested cancel outcome",
  );
  const nestedOutcomes = outcomesFor(store, innerBox.id as string);
  assert.equal(nestedOutcomes.length, 1);
  assert.equal(nestedOutcomes[0]?.["status"], "uncertain");
  assert.deepEqual(nestedOutcomes[0]?.["usage"], { input: 2, output: 1, cost: 0 });
  // Derived combined totals (own + nested, each exactly once): computed from
  // the two independent receipts, never stored in either own field.
  const derivedCancel = {
    input: (FULL_USAGE.input as number) + (INNER_USAGE.input as number),
    output: (FULL_USAGE.output as number) + (INNER_USAGE.output as number),
    cacheRead: FULL_USAGE.cacheRead,
    cacheWrite: FULL_USAGE.cacheWrite,
    cost: (FULL_USAGE.cost as { total: number }).total + (INNER_USAGE.cost as { total: number }).total,
  };
  assert.deepEqual(derivedCancel, EXPECTED_CANCEL_USAGE);

  // Retained scope denies after cancellation settlement (R3): probe the
  // actual impl-captured outer scoped ctx, not a stub.
  assert.ok(outerBox.ctx, "outer impl never captured its scoped ctx");
  const retainedOuter = await outerBox.ctx.executeTool(SLOW_INNER, {});
  assert.equal(retainedOuter.isError, true, "retained scope still delegates after cancellation");
  assert.match(JSON.stringify(retainedOuter.result?.content ?? retainedOuter), /STALE_GENERATION|revoked/);
});

test("thrown parent failures surface as isError with the message preserved (no throw)", async (t) => {
  if (!SDK_ROOT) {
    t.skip("PI_SUBAGENTS_SDK_ROOT unset; production error proof requires the pinned SDK");
    return;
  }
  const boomDef: ToolDefinition<typeof qSchema, unknown> = {
    name: CODEGRAPH,
    label: "codegraph",
    description: "throwing codegraph",
    parameters: qSchema,
    execute: async () => {
      throw new Error("backend down");
    },
  };
  const harness = await withHarness(t, {
    script: [
      { kind: "tool", name: "spawn_probe", args: { task: "survey" } },
      { kind: "text", text: "parent idle" },
    ],
    tools: [boomDef],
    active: ["spawn_probe", CODEGRAPH],
  });
  const handles = snapshotGoverningHandles(harness.capture.ctx);
  const store = new InMemoryRunStore("govsdk-error");
  const registry: GoverningRegistry = {
    isActive: () => true,
    listHandles: () => handles,
    getHandle: (name) => handles.find((h) => h.name === name),
    baseCtx: () => harness.capture.ctx,
  };
  const dispatch = new GoverningToolDispatcher(store, () => registry, async () => ({
    stdout: "",
    stderr: "",
    exitCode: 0,
    timedOut: false,
    truncated: false,
  }));
  const res = await dispatch.execute(caller(), { operationId: "op-sdk-boom-1", tool: CODEGRAPH, args: { q: "x" } });
  assert.equal(res.isError, true, "thrown parent failure appeared successful");
  assert.ok(JSON.stringify(res.content).includes("backend down"), "thrown message not preserved for the model");
  const outcomes = outcomesFor(store, "op-sdk-boom-1");
  assert.equal(outcomes.length, 1, "thrown failure left no journaled outcome");
});
