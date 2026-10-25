import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { WorkerHandle } from "../src/worker-launch.ts";
import type { WorkerEvent } from "../src/protocol.ts";
import type { DeterministicModelRuntime } from "../src/deterministic.ts";
import { testGovernor, bothExecutors } from "./fake-worker.ts";

const SDK_ROOT = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? null;
const WORKER_PATH = new URL("../src/worker.ts", import.meta.url).pathname;

async function loadDist<T>(rel: string): Promise<T | null> {
  if (!SDK_ROOT) return null;
  try {
    return (await import(pathToFileURL(join(SDK_ROOT, rel)).href)) as T;
  } catch (e) {
    console.log(`NOT-EXECUTED: cannot import ${rel}: ${(e as Error).message}`);
    return null;
  }
}

test("M1: real worker process runs a native session (handshake, proxy tool, agent_settled)", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; real-worker check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-m1-"));
  const events: WorkerEvent[] = [];
  const toolRequests: Array<{ tool: string; args: Record<string, unknown> }> = [];
  // Approved credential store the worker opens live (dummy key, stubbed
  // stream performs no network). Never copied into worktrees/tool envs.
  const hostAgentDir = join(dir, "host-agent");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(hostAgentDir, { recursive: true });
  writeFileSync(join(hostAgentDir, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "dummy" } }));
  const { bindChannel } = await import("../src/protocol.ts");
  const binding = bindChannel("epoch-m1", "agent-m1", "instance-m1");
  const handle = new WorkerHandle(
    {
      workerPath: WORKER_PATH,
      rootEpoch: "epoch-m1",
      agentId: "agent-m1",
      sdkRoot: SDK_ROOT,
      deterministic: true,
      agentDir: join(dir, "worker-home"),
      sessionsDir: join(dir, "sessions"),
      hostAgentDir,
      script: [
        { tool: "read", args: { path: "hello.txt" } },
        { text: "worker done" },
      ],
    },
    binding,
  );
  handle.setEventHandler((e) => events.push(e));
  handle.setToolRequestHandler(async (payload) => {
    toolRequests.push({ tool: payload.tool, args: payload.args });
    return { content: "hello sandbox", isError: false };
  });
  // Direct harness (no Supervisor): no recovery holds exist, so admission is
  // vacuously allowed. Required since workers deny visibly without a handler.
  handle.setProviderAdmissionRequestHandler(async () => ({ ok: true }));
  try {
    await handle.launch();
    const ack = (await handle.request("initialize", {
      taskText: "read the file",
      profile: "reader",
      instructionHash: "",
      instructions: {
        contextFiles: [{ path: "/proj/AGENTS.md", content: "M1-CONTEXT-MARKER: answer tersely" }],
        skills: [{ name: "m1-skill", description: "M1 skill description", filePath: "/skills/m1/SKILL.md", baseDir: "/skills/m1", disableModelInvocation: false }],
      },
      model: { provider: "openai", id: "deterministic-test", thinkingLevel: "off" },
      taskRunId: "task-m1",
      executionGeneration: 1,
      workdir: dir,
      readRoots: [dir],
      writable: false,
      tools: ["read"],
    }, { taskRunId: "task-m1", generation: 1, timeoutMs: 60_000 })) as { ok?: boolean; sessionId?: string };
    assert.equal(ack.ok, true);
    assert.ok(typeof ack.sessionId === "string" && ack.sessionId.length > 0);
    const start = Date.now();
    while (!events.some((e) => e.kind === "settled") && Date.now() - start < 60_000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const settled = events.find((e) => e.kind === "settled");
    assert.ok(settled, `no settled event; saw: ${events.map((e) => e.kind).join(",")}`);
    // Listener registration before prompt + actual proxy execution.
    assert.ok(toolRequests.some((t) => t.tool === "read"), "proxy tool never executed");
    // Finalization came from agent_settled with the generation's last text.
    assert.equal(settled.executionGeneration, 1);
    assert.ok(String((settled.detail as Record<string, unknown>)["lastAssistantText"] ?? "").includes("worker done"));
    assert.ok(events.some((e) => e.kind === "started"));
    // Settled boundary checkpoint: fsynced native bytes with the selected leaf.
    const cp = (await handle.request("checkpoint", {}, { taskRunId: "task-m1", generation: 1, timeoutMs: 15_000 })) as {
      leafEntryId?: string | null; materialized?: boolean; byteCount?: number; sha256?: string; sessionFile?: string;
    };
    assert.equal(cp.materialized, true);
    assert.ok(typeof cp.leafEntryId === "string" && cp.leafEntryId.length > 0);
    const { readFileSync } = await import("node:fs");
    const bytes = readFileSync(cp.sessionFile!).subarray(0, cp.byteCount);
    assert.equal(bytes.length, cp.byteCount);
    assert.ok(bytes.toString("utf8").includes("read the file"));
    // The owner-selected context file and skill are what the child's prompt lists.
    assert.ok(bytes.toString("utf8").includes("M1-CONTEXT-MARKER"), "context file missing from the child's system prompt");
    assert.ok(bytes.toString("utf8").includes("/skills/m1/SKILL.md"), "skill missing from the child's system prompt");
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("M1: mixed wait+bash tool batch executes sequentially at the real SDK (no lease overlap)", async () => {
  const sdk = await loadDist<{ createAgentSession: (options: Record<string, unknown>) => Promise<{ session: SdkSession }>; SettingsManager: SdkSettingsManager; DefaultResourceLoader: new (opts: Record<string, unknown>) => unknown; defineTool: (t: Record<string, unknown>) => Record<string, unknown>; ModelRuntime: { create: (opts: Record<string, unknown>) => Promise<DeterministicModelRuntime> } }>("dist/index.js");
  const typebox = await loadDist<{ Type: { Object: (props: Record<string, unknown>, opts?: Record<string, unknown>) => Record<string, unknown> } }>("node_modules/typebox/build/index.mjs");
  const compat = await loadDist<{ EventStream: new (isTerminal: (e: { type: string }) => boolean, getResult: (e: { type: string; message?: unknown; error?: unknown }) => unknown) => { push: (e: unknown) => void } }>("node_modules/@earendil-works/pi-ai/dist/compat.js");
  if (!sdk || !compat || !typebox) {
    console.log("NOT-EXECUTED: SDK dist unavailable; sequential-batch check skipped, not passed");
    return;
  }
  const { registerDeterministicProvider, SIM_PROVIDER, SIM_MODEL, testInvocationScope } = await import("../src/deterministic.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-seq-"));
  const { mkdirSync } = await import("node:fs");
  const agentHome = join(dir, "agent-home");
  mkdirSync(agentHome, { recursive: true });
  const seen: string[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const settledKinds: string[] = [];
  const toolCallIds: string[] = [];
  const toolResultFor = new Map<string, string>();
  // Scripted provider through the real ModelRuntime extension path: the
  // first turn emits a mixed wait+bash batch, the second settles.
  const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(agentHome, "auth.json"), modelsPath: null });
  registerDeterministicProvider(modelRuntime, compat.EventStream, [
    { kind: "batch", calls: [{ name: "wait_tool", args: {} }, { name: "bash_tool", args: {} }] },
  ], { createInvocationScope: testInvocationScope });
  try {
    const settingsManager = (sdk.SettingsManager as unknown as { create: (cwd: string, agentDir: string) => { setCacheWarmingMode: (m: string) => void } }).create(dir, join(dir, "agent-home"));
    settingsManager.setCacheWarmingMode("off");
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd: dir,
      agentDir: join(dir, "agent-home"),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionsOverride: (base: { extensions: unknown[]; errors: unknown[]; runtime: unknown }) => ({ extensions: [], errors: [], runtime: base.runtime }),
    });
    const mkTool = (name: string): Record<string, unknown> =>
      sdk.defineTool({
        name,
        label: name,
        description: name,
        parameters: typebox.Type.Object({}, { additionalProperties: true }),
        executionMode: "sequential",
        execute: async (toolCallId: string) => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          toolCallIds.push(`${name}:${String(toolCallId)}`);
          await new Promise((r) => setTimeout(r, 50));
          concurrent--;
          return { content: [{ type: "text" as const, text: `${name} ok` }], details: {} };
        },
      });
    const { session } = await sdk.createAgentSession({
      cwd: dir,
      agentDir: join(dir, "agent-home"),
      settingsManager,
      resourceLoader,
      sessionManager: (sdk as unknown as { SessionManager: { inMemory: (cwd: string) => unknown } }).SessionManager.inMemory(dir),
      modelRuntime,
      model: modelRuntime.getModel(SIM_PROVIDER, SIM_MODEL),
      thinkingLevel: "off",
      tools: ["wait_tool", "bash_tool"],
      customTools: [mkTool("wait_tool"), mkTool("bash_tool")],
    });
    // Sequential worker execution is contract: set before subscribing/prompt.
    session.agent.toolExecution = "sequential";
    assert.equal(session.agent.toolExecution, "sequential");
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no agent_settled")), 60_000);
      session.subscribe((event: { type: string }) => {
        settledKinds.push(event.type);
        if (event.type === "tool_execution_end") {
          const e = event as unknown as { toolCallId?: string; result?: { content?: Array<{ text?: string }> } };
          if (e.toolCallId) toolResultFor.set(e.toolCallId, e.result?.content?.[0]?.text ?? "");
        }
        if (event.type === "agent_settled") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    // Ambient resources must stay unloaded: no extensions/skills/templates.
    seen.push("prompting");
    await session.prompt("run the batch", { expandPromptTemplates: false });
    await done;
    // Tool-call/result pairing for every call in the mixed batch.
    const executedNames = toolCallIds.map((e) => e.split(":")[0]).sort();
    assert.deepEqual(executedNames, ["bash_tool", "wait_tool"]);
    // Every executed call produced a paired tool_execution_end.
    const endedIds = [...toolResultFor.keys()].sort();
    const executedIds = toolCallIds.map((e) => e.split(":").slice(1).join(":")).sort();
    assert.deepEqual(endedIds, executedIds);
    // Sequential batches never overlap: parking a wait cannot release a lease
    // while its sibling tool still runs.
    assert.equal(maxConcurrent, 1);
    assert.ok(settledKinds.includes("agent_settled"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("M1: evict + reload restores the recorded leaf through the native branch API", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; restore check skipped, not passed");
    return;
  }
  const { Supervisor } = await import("../src/supervisor.ts");
  const { InMemoryRunStore } = await import("../src/store.ts");
  const { DummyToolExecutor } = await import("../src/sandbox.ts");
  const { DummyWorkspaceManager } = await import("../src/workspace.ts");
  const { defaultSupervisorPolicy } = await import("../src/policy.ts");
  const { WorkerHandle, newWorkerBinding } = await import("../src/worker-launch.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-restore-"));
  const store = new InMemoryRunStore("root-restore");
  let launches = 0;
  const sup = new Supervisor({
    rootId: "root-restore",
    governor: testGovernor,
    rootDir: dir,
    store,
    policy: defaultSupervisorPolicy(),
    executors: bothExecutors(new DummyToolExecutor()),
    workspace: new DummyWorkspaceManager(),
    workerFactory: ({ agentId, instanceId, rootEpoch }) => new WorkerHandle({
      workerPath: WORKER_PATH,
      rootEpoch,
      agentId,
      sdkRoot: SDK_ROOT,
      deterministic: true,
      agentDir: join(dir, "wah", agentId),
      sessionsDir: join(dir, "sessions"),
      script: launches++ === 0 ? [{ text: "run-one" }] : [{ text: "run-two" }],
    }, newWorkerBinding(rootEpoch, agentId)),
  });
  try {
    const res = await sup.spawn("governor", { taskName: "r", message: "first", profile: "reader" }, "req-r1");
    const start = Date.now();
    while (sup.list("governor")[0]?.taskOutcome !== "succeeded" && Date.now() - start < 30_000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(sup.list("governor")[0]?.taskOutcome, "succeeded");
    // Allow the settled-boundary checkpoint capture to land.
    const cpStart = Date.now();
    while (!store.loadCheckpoint(res.agentId) && Date.now() - cpStart < 15_000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const cp1 = store.loadCheckpoint(res.agentId);
    assert.ok(cp1, "settled generation checkpoint captured");
    assert.ok(cp1.ref.leafEntryId);
    assert.ok(Buffer.from(cp1.bytes).toString("utf8").includes("first"));
    // Evict, then resume: the replacement worker opens the restored bytes
    // and selects the recorded leaf (no raw-line patching, no invented results).
    await sup.evictWorker("governor", res.agentId);
    await sup.sendMessage("governor", res.agentId, "task", "second", {}, "req-r2");
    const start2 = Date.now();
    while (sup.list("governor").filter((v) => v.id === res.agentId)[0]?.generation !== 2 && Date.now() - start2 < 30_000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const cpStart2 = Date.now();
    let cp2 = store.loadCheckpoint(res.agentId);
    while ((!cp2 || cp2.ref.generation !== 2) && Date.now() - cpStart2 < 15_000) {
      await new Promise((r) => setTimeout(r, 50));
      cp2 = store.loadCheckpoint(res.agentId);
    }
    assert.ok(cp2 && cp2.ref.generation === 2);
    const transcript = Buffer.from(cp2.bytes).toString("utf8");
    assert.ok(transcript.includes("first"), "restored run retains prior conversation");
    assert.ok(transcript.includes("second"), "resumed run appended");
  } finally {
    await sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

interface SdkSession {
  agent: { toolExecution: string };
  subscribe: (listener: (event: { type: string }) => void) => () => void;
  prompt: (text: string, options?: Record<string, unknown>) => Promise<void>;
}

interface SdkSettingsManager {
  create: (cwd: string, agentDir: string) => { setCacheWarmingMode: (m: string) => void };
}

function usage(): Record<string, unknown> {
  return { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function assistantText(text: string): Record<string, unknown> {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "test",
    model: "deterministic",
    usage: usage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function assistantWithTools(calls: Array<{ id: string; name: string; args: Record<string, unknown> }>): Record<string, unknown> {
  return {
    role: "assistant",
    content: calls.map((c) => ({ type: "toolCall", id: c.id, name: c.name, arguments: c.args })),
    api: "openai-responses",
    provider: "test",
    model: "deterministic",
    usage: usage(),
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

async function deterministicWorker(dir: string, script: Array<Record<string, unknown>>, onTool: (tool: string) => Promise<{ content: string; isError: boolean }>, init: Record<string, unknown> = {}, extraEnv: Record<string, string> = {}): Promise<{ handle: WorkerHandle; events: WorkerEvent[] }> {
  const { bindChannel } = await import("../src/protocol.ts");
  const events: WorkerEvent[] = [];
  const handle = new WorkerHandle({
    workerPath: WORKER_PATH,
    rootEpoch: "epoch-x",
    agentId: "agent-x",
    sdkRoot: SDK_ROOT,
    deterministic: true,
    agentDir: join(dir, "worker-home"),
    sessionsDir: join(dir, "sessions"),
    script: script as Array<{ text?: string; repeat?: number; tool?: string; args?: Record<string, unknown>; usage?: unknown }>,
    ...(Object.keys(extraEnv).length > 0 ? { extraEnv } : {}),
  }, bindChannel("epoch-x", "agent-x", "instance-x"));
  handle.setEventHandler((e) => events.push(e));
  handle.setToolRequestHandler(async (payload) => onTool(payload.tool));
  // Direct harness (no Supervisor): no recovery holds exist, so admission is
  // vacuously allowed. Required since workers deny visibly without a handler.
  handle.setProviderAdmissionRequestHandler(async () => ({ ok: true }));
  await handle.launch();
  const ack = (await handle.request("initialize", {
    taskText: "go",
    profile: "reader",
    instructionHash: "",
    instructions: { contextFiles: [], skills: [] },
    model: { provider: "test", id: "model", thinkingLevel: "off" },
    taskRunId: "task-1",
    executionGeneration: 1,
    workdir: dir,
    readRoots: [dir],
    writable: false,
    tools: ["read"],
    ...init,
  }, { taskRunId: "task-1", generation: 1, timeoutMs: 60_000 })) as { ok?: boolean };
  assert.equal(ack.ok, true);
  return { handle, events };
}

async function untilEvent(events: WorkerEvent[], pred: (e: WorkerEvent) => boolean, timeoutMs = 30_000): Promise<WorkerEvent> {
  const start = Date.now();
  for (;;) {
    const found = events.find(pred);
    if (found) return found;
    if (Date.now() - start > timeoutMs) throw new Error(`no matching event; saw ${events.map((e) => e.kind).join(",")}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("real worker: a provider error settles the generation as failed, never succeeded", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; settlement-status check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-err-"));
  const { handle, events } = await deterministicWorker(dir, [{ error: "upstream exploded" }], async () => ({ content: "", isError: false }));
  try {
    const settled = await untilEvent(events, (e) => e.kind === "settled");
    assert.equal(settled.detail["status"], "failed");
    assert.ok(String(settled.detail["error"]).includes("upstream exploded"));
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real worker: cache and reasoning tokens are reported apart from the input total", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; usage-breakdown check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-usage-"));
  // Explicit scripted breakdown (not the ambient script default): one
  // scripted request carries 10 uncached + 3 cache-read + 2 cache-write
  // input tokens, 5 output tokens with 1 reasoning, and zero cost.
  const script = [{ text: "done", usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 2, reasoning: 1, costTotal: 0 } }];
  const { handle, events } = await deterministicWorker(dir, script, async () => ({ content: "", isError: false }));
  try {
    const settled = await untilEvent(events, (e) => e.kind === "settled");
    // One scripted request: 10 uncached + 3 cache-read + 2 cache-write input tokens; 5 output tokens, 1 of them reasoning.
    assert.deepEqual(settled.detail["usage"], { input: 15, output: 5, cacheRead: 3, cacheWrite: 2, reasoning: 1, cost: 0, unknown: false });
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real worker: without a result limit the final text is cut at the default bound and its full length reported", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; default result bound check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-resdef-"));
  const { handle, events } = await deterministicWorker(dir, [{ text: "0123456789", repeat: 900 }], async () => ({ content: "", isError: false }));
  try {
    const settled = await untilEvent(events, (e) => e.kind === "settled");
    assert.equal(String(settled.detail["lastAssistantText"]).length, 8000);
    assert.equal(settled.detail["textLength"], 9000);
    assert.equal(settled.detail["resultFile"], null);
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real worker: a final text larger than the IPC payload cap is handed over as a synchronized file", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; result file handoff check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-resfile-"));
  // 400,000 characters (over the 256 KiB payload cap), of which 300,000 are retained.
  const { handle, events } = await deterministicWorker(dir, [{ text: "0123456789", repeat: 40_000 }], async () => ({ content: "", isError: false }), { resultLimit: 300_000 });
  try {
    const settled = await untilEvent(events, (e) => e.kind === "settled");
    assert.equal(settled.detail["status"], "succeeded");
    assert.equal(String(settled.detail["lastAssistantText"]).length, 8000);
    assert.equal(settled.detail["textLength"], 400_000);
    const file = settled.detail["resultFile"] as { path: string; byteCount: number; sha256: string };
    assert.ok(file.path.startsWith(join(dir, "sessions", "agent-x")), `result file ${file.path} lies outside the agent's session directory`);
    const { readFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const bytes = readFileSync(file.path);
    assert.equal(bytes.toString("utf8"), "0123456789".repeat(30_000));
    assert.equal(bytes.length, file.byteCount);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real worker: an interrupt mid-tool settles once, as interrupted", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; interrupt check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-int-"));
  let toolStarted = false;
  const { handle, events } = await deterministicWorker(dir, [{ tool: "read", args: { path: "x" } }, { text: "should not finish" }], async () => {
    toolStarted = true;
    await new Promise((r) => setTimeout(r, 500));
    return { content: "late tool result", isError: false };
  });
  try {
    const start = Date.now();
    while (!toolStarted && Date.now() - start < 30_000) await new Promise((r) => setTimeout(r, 20));
    await handle.request("interrupt", {}, { taskRunId: "task-1", generation: 1, timeoutMs: 15_000 });
    await new Promise((r) => setTimeout(r, 800));
    const settled = events.filter((e) => e.kind === "settled");
    assert.equal(settled.length, 1, `settled events: ${JSON.stringify(settled.map((e) => e.detail["status"]))}`);
    assert.equal(settled[0]!.detail["status"], "interrupted");
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real worker: a second task while a generation runs is refused before acknowledgement", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; delivery precondition check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-dbl-"));
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const { handle, events } = await deterministicWorker(dir, [{ tool: "read", args: { path: "x" } }, { text: "first done" }], async () => {
    await gate;
    return { content: "ok", isError: false };
  });
  try {
    await untilEvent(events, (e) => e.kind === "tool_start");
    const res = (await handle.request("deliver", { mode: "task", text: "second" }, { taskRunId: "task-2", generation: 2, timeoutMs: 15_000 })) as { ok?: boolean; code?: string };
    assert.equal(res.ok, false);
    assert.equal(res.code, "CONFLICT");
    release();
    const settled = await untilEvent(events, (e) => e.kind === "settled");
    assert.equal(settled.detail["status"], "succeeded");
  } finally {
    release();
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real worker: death during a tool settles the run and never crashes the supervisor", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; worker-death check skipped, not passed");
    return;
  }
  const { Supervisor } = await import("../src/supervisor.ts");
  const { InMemoryRunStore } = await import("../src/store.ts");
  const { DummyToolExecutor } = await import("../src/sandbox.ts");
  const { DummyWorkspaceManager } = await import("../src/workspace.ts");
  const { defaultSupervisorPolicy } = await import("../src/policy.ts");
  const { newWorkerBinding } = await import("../src/worker-launch.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-death-"));
  let handle: WorkerHandle | null = null;
  const executor = new DummyToolExecutor();
  executor.handler = async () => {
    // The worker dies while its tool runs; the tool then completes.
    process.kill(handle!.pid!, "SIGKILL");
    await new Promise((r) => setTimeout(r, 300));
    return { exitCode: 0, signal: null, stdout: "late", stderr: "", truncated: false, timedOut: false };
  };
  const sup = new Supervisor({
    rootId: "root-death",
    governor: testGovernor,
    rootDir: dir,
    store: new InMemoryRunStore("root-death"),
    policy: defaultSupervisorPolicy(),
    executors: bothExecutors(executor),
    workspace: new DummyWorkspaceManager(),
    workerFactory: ({ agentId, rootEpoch }) => {
      handle = new WorkerHandle({
        workerPath: WORKER_PATH,
        rootEpoch,
        agentId,
        sdkRoot: SDK_ROOT,
        deterministic: true,
        agentDir: join(dir, "wah", agentId),
        sessionsDir: join(dir, "sessions"),
        script: [{ tool: "read", args: { path: "x" } }, { text: "never" }],
      }, newWorkerBinding(rootEpoch, agentId));
      return handle;
    },
  });
  try {
    const res = await sup.spawn("governor", { taskName: "d", message: "go", profile: "reader" }, "req-d");
    const joined = await sup.wait("governor", 0, 30_000, [{ agentId: res.agentId, taskRunId: res.taskRunId }], "all_settled");
    assert.equal(joined.completed, true);
    await new Promise((r) => setTimeout(r, 500)); // the late tool response is sent into a closed channel
    const outcome = sup.list("governor")[0]!.taskOutcome;
    assert.ok(outcome === "uncertain" || outcome === "failed", `outcome ${outcome}`);
    assert.equal(sup.admissionScheduler.runnableCount, 0);
  } finally {
    await sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real worker: a checkpoint of a session larger than the IPC payload cap succeeds", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; large checkpoint check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-bigcp-"));
  const { handle, events } = await deterministicWorker(dir, [{ tool: "read", args: { path: "a.txt" } }, { text: "done" }], async () => ({ content: "y".repeat(200 * 1024), isError: false }));
  try {
    await untilEvent(events, (e) => e.kind === "settled");
    const cp = (await handle.request("checkpoint", {}, { taskRunId: "task-1", generation: 1, timeoutMs: 5000 })) as { ok?: boolean; byteCount?: number; sessionFile?: string };
    assert.equal(cp.ok, true);
    // Base64 of this session alone would exceed the 256 KiB IPC payload cap.
    assert.ok((cp.byteCount ?? 0) * 4 / 3 > 256 * 1024, `byteCount ${cp.byteCount}`);
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real worker: facade-local end wins public completion while genuine ORIGINAL usage accounts", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; facade-local-end accounting check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-facade-local-"));
  // Genuine provider outcome: nonzero breakdown the ledger must bill.
  const script = [{ text: "genuine-provider-text", usage: { input: 11, output: 6, cacheRead: 7, cacheWrite: 8, costTotal: 9 } }];
  // Consumer-side local completion with a HUGE foreign breakdown: public
  // completion takes it (first-terminal-wins) but accounting must never
  // bill a single token of it.
  const localMessage = {
    role: "assistant",
    content: [{ type: "text", text: "facade-local-text" }],
    api: "openai-responses",
    provider: "test",
    model: "deterministic",
    usage: { input: 1000, output: 1000, cacheRead: 1000, cacheWrite: 1000, totalTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 1,
  };
  const { handle, events } = await deterministicWorker(dir, script, async () => ({ content: "", isError: false }), {}, {
    PI_SUBAGENTS_FACADE_LOCAL_END: JSON.stringify(localMessage),
  });
  try {
    const settled = await untilEvent(events, (e) => e.kind === "settled");
    assert.equal(settled.detail["status"], "succeeded", "local completion still settles the turn");
    assert.deepEqual(
      settled.detail["usage"],
      { input: 26, output: 6, cacheRead: 7, cacheWrite: 8, reasoning: null, cost: 9, unknown: false },
      "ledger bills exactly the genuine ORIGINAL breakdown (11+7+8 input), never the local 1000s",
    );
    assert.equal(settled.detail["lastAssistantText"], "facade-local-text", "public completion is the local message");
    // Joined, not receipted: the genuine outcome arrived before publication
    // (microtask timing), so no late receipt exists for it.
    assert.equal(events.filter((e) => e.kind === "usage_late").length, 0, "no late receipt when the ORIGINAL joined pre-settlement");
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real worker: malformed facade-local-end configuration fails visibly", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; facade-local-end negative check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-facade-local-neg-"));
  const { handle, events } = await deterministicWorker(dir, [{ text: "done" }], async () => ({ content: "", isError: false }), {}, {
    PI_SUBAGENTS_FACADE_LOCAL_END: "not-json{{{",
  });
  try {
    const settled = await untilEvent(events, (e) => e.kind === "settled");
    assert.equal(settled.detail["status"], "failed", "misconfigured seam fails the turn, never silently ignored");
    assert.match(String(settled.detail["error"] ?? ""), /PI_SUBAGENTS_FACADE_LOCAL_END/, "failure names the seam");
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real worker: ORIGINAL held past public completion still accounts exactly once (late receipt)", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; late-ORIGINAL accounting check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-late-original-"));
  // Genuine provider outcome HELD 2500ms past public completion (turn
  // latency post-boot is an order of magnitude smaller): it must still
  // reach the ledger exactly once under its captured identity, not retire
  // silently into the settled generation object.
  const script = [{ text: "genuine-provider-text", usage: { input: 11, output: 6, cacheRead: 7, cacheWrite: 8, costTotal: 9 }, delayMs: 2500 }];
  const localMessage = {
    role: "assistant",
    content: [{ type: "text", text: "facade-local-text" }],
    api: "openai-responses",
    provider: "test",
    model: "deterministic",
    usage: { input: 1000, output: 1000, cacheRead: 1000, cacheWrite: 1000, totalTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 1,
  };
  const { handle, events } = await deterministicWorker(dir, script, async () => ({ content: "", isError: false }), {}, {
    PI_SUBAGENTS_FACADE_LOCAL_END: JSON.stringify(localMessage),
  });
  try {
    const settled = await untilEvent(events, (e) => e.kind === "settled");
    assert.equal(settled.detail["status"], "succeeded", "local completion still settles the turn");
    assert.equal(settled.detail["lastAssistantText"], "facade-local-text", "public completion is the local message");
    // The genuine outcome arrives strictly after publication: zeros with
    // unknown (incomplete accounting at settle time, never fabricated).
    assert.deepEqual(
      settled.detail["usage"],
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: null, cost: null, unknown: true },
      "settled snapshot carries no genuine usage (it arrives late)",
    );
    // Exactly-once late receipt under the captured identity.
    const late = await untilEvent(events, (e) => e.kind === "usage_late", 15000);
    assert.deepEqual(
      late.detail["usage"],
      { input: 26, output: 6, cacheRead: 7, cacheWrite: 8, reasoning: null, cost: 9, unknown: false },
      "late receipt bills exactly the genuine ORIGINAL breakdown, never the local 1000s",
    );
    assert.equal(late.detail["taskRunId"], "task-1", "late receipt carries the captured task identity");
    assert.equal(late.detail["generation"], 1, "late receipt carries the captured generation");
    // No second settled and no second late receipt: the arrival was joined
    // exactly once, not duplicated into another publication.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(events.filter((e) => e.kind === "settled").length, 1, "exactly one settled publication");
    assert.equal(events.filter((e) => e.kind === "usage_late").length, 1, "exactly one late receipt");
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real worker: throwing iterator access retains the valid ORIGINAL Usage (adapter failure)", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; iterator-access-throw accounting check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-iterator-access-"));
  const { handle, events } = await deterministicWorker(dir, [{ text: "unused" }], async () => ({ content: "", isError: false }), {}, {
    PI_SUBAGENTS_ORIGINAL_ITERATOR_ACCESS_THROW: "once",
  });
  try {
    const settled = await untilEvent(events, (e) => e.kind === "settled");
    assert.equal(settled.detail["status"], "failed", "adapter failure fails the turn visibly");
    // The valid ORIGINAL breakdown (11+7+8 input) is retained across the
    // settled snapshot and at most one late receipt combined — never
    // dropped for lack of a facade — with unknown marking the abnormal
    // completion. Timing-robust: whichever publication carried it counts.
    const settledUsage = settled.detail["usage"] as Record<string, unknown>;
    assert.equal(settledUsage["unknown"], true, "abnormal completion marked unknown");
    const late = events.filter((e) => e.kind === "usage_late");
    assert.ok(late.length <= 1, "at most one late receipt");
    const total = (key: string): number =>
      Number(settledUsage[key] ?? 0) + late.reduce((a, e) => a + Number((e.detail["usage"] as Record<string, unknown>)[key] ?? 0), 0);
    assert.equal(total("input"), 26, "genuine input retained exactly once across publications");
    assert.equal(total("output"), 6, "genuine output retained exactly once");
    assert.equal(total("cacheRead"), 7, "genuine cacheRead retained exactly once");
    assert.equal(total("cacheWrite"), 8, "genuine cacheWrite retained exactly once");
    assert.equal(events.filter((e) => e.kind === "settled").length, 1, "exactly one settled publication");
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real worker: ORIGINAL end(message) completes the Agent loop with identical message and Usage", async () => {
  if (!SDK_ROOT) {
    console.log("NOT-EXECUTED: PI_SUBAGENTS_SDK_ROOT unset; ORIGINAL end(message) Agent-loop check skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-original-end-"));
  // Genuine provider end(message) with no terminal event: the real SDK
  // Agent loop must complete publicly with the identical text and full
  // Usage (never withhold a clean ORIGINAL end as an EOF failure).
  const endMessage = {
    role: "assistant",
    content: [{ type: "text", text: "original-end-text" }],
    api: "openai-responses",
    provider: "test",
    model: "deterministic",
    usage: { input: 13, output: 14, cacheRead: 15, cacheWrite: 16, totalTokens: 58, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } },
    stopReason: "stop",
    timestamp: 1,
  };
  const { handle, events } = await deterministicWorker(dir, [{ text: "unused" }], async () => ({ content: "", isError: false }), {}, {
    PI_SUBAGENTS_ORIGINAL_END_WITH_RESULT: JSON.stringify(endMessage),
  });
  try {
    const settled = await untilEvent(events, (e) => e.kind === "settled");
    assert.equal(settled.detail["status"], "succeeded", "clean ORIGINAL end settles the turn");
    assert.equal(settled.detail["lastAssistantText"], "original-end-text", "Agent loop completed with the ORIGINAL text");
    assert.deepEqual(
      settled.detail["usage"],
      { input: 44, output: 14, cacheRead: 15, cacheWrite: 16, reasoning: null, cost: 10, unknown: false },
      "Agent loop accounted the full ORIGINAL Usage (13+15+16 input)",
    );
  } finally {
    handle.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restored worker records the explicitly admitted replacement model without rewriting native history", async (t) => {
  if (!SDK_ROOT) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
  const { bindChannel } = await import("../src/protocol.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-model-restore-"));
  const sessionsDir = join(dir, "sessions");
  const hostAgentDir = join(dir, "host-agent");
  mkdirSync(sessionsDir);
  mkdirSync(hostAgentDir);
  writeFileSync(join(hostAgentDir, "auth.json"), JSON.stringify({ openai: { type: "api_key", key: "dummy" } }));
  const sessionFile = join(sessionsDir, "old.jsonl");
  const timestamp = new Date().toISOString();
  const entries = [
    { type: "session", version: 3, id: "9e62585b-7cc3-45d2-afab-803f3342ca6a", timestamp, cwd: dir },
    { type: "model_change", id: "model-old", parentId: null, timestamp, provider: "anthropic", modelId: "claude-sonnet-4-5" },
    { type: "thinking_level_change", id: "thinking-old", parentId: "model-old", timestamp, thinkingLevel: "high" },
    { type: "message", id: "history", parentId: "thinking-old", timestamp, message: { role: "user", content: "KEEP-NATIVE-HISTORY", timestamp: Date.now() } },
  ];
  writeFileSync(sessionFile, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  const handle = new WorkerHandle({ workerPath: WORKER_PATH, rootEpoch: "epoch", agentId: "agent", sdkRoot: SDK_ROOT, deterministic: false, agentDir: join(dir, "worker-home"), sessionsDir, hostAgentDir }, bindChannel("epoch", "agent", "instance"));
  handle.setProviderAdmissionRequestHandler(async () => { throw new Error("restore must not infer"); });
  try {
    await handle.launch();
    const ack = await handle.request("initialize", {
      taskText: null, profile: "reader", instructionHash: "", instructions: { contextFiles: [], skills: [] },
      model: { provider: "openai", id: "gpt-4o", thinkingLevel: "off" }, taskRunId: "task", executionGeneration: 2,
      workdir: dir, readRoots: [dir], writable: false, tools: [], restore: { sessionFile, leafEntryId: "history" },
    }, { timeoutMs: 60_000 }) as { ok: boolean; message?: string };
    assert.equal(ack.ok, true, ack.message);
    const cp = await handle.request("checkpoint", {}, { timeoutMs: 15_000 }) as { ok: boolean; sessionFile: string; byteCount: number };
    assert.equal(cp.ok, true);
    const restored = readFileSync(cp.sessionFile).subarray(0, cp.byteCount).toString("utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(restored.slice(0, entries.length), entries);
    const selection = restored.filter((entry) => entry["type"] === "model_change").at(-1)!;
    assert.equal(selection["provider"], "openai");
    assert.equal(selection["modelId"], "gpt-4o");
    assert.equal(restored.filter((entry) => entry["type"] === "thinking_level_change").at(-1)!["thinkingLevel"], "off");
  } finally { handle.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test("real settled worker reuses its identity at the open-agent cap with an explicit model and retained history/billing", async (t) => {
  if (!SDK_ROOT) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  const { Supervisor } = await import("../src/supervisor.ts");
  const { InMemoryRunStore } = await import("../src/store.ts");
  const { DummyToolExecutor } = await import("../src/sandbox.ts");
  const { DummyWorkspaceManager } = await import("../src/workspace.ts");
  const { defaultSupervisorPolicy } = await import("../src/policy.ts");
  const { newWorkerBinding } = await import("../src/worker-launch.ts");
  const { until } = await import("./fake-worker.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-cap-reuse-"));
  const store = new InMemoryRunStore("cap-reuse");
  const policy = defaultSupervisorPolicy();
  const model = { provider: "replacement", id: "new-model", thinkingLevel: "off" };
  policy.allowedModels = [model];
  let launches = 0;
  const sup = new Supervisor({
    rootId: "cap-reuse", rootDir: dir, store, policy, governor: testGovernor,
    schedulerLimits: { maxOpenAgents: 1 },
    executors: bothExecutors(new DummyToolExecutor()), workspace: new DummyWorkspaceManager(),
    workerFactory: ({ agentId, rootEpoch }) => new WorkerHandle({
      workerPath: WORKER_PATH, rootEpoch, agentId, sdkRoot: SDK_ROOT, deterministic: true,
      agentDir: join(dir, "agents", agentId), sessionsDir: join(dir, "sessions"),
      script: [{ text: `run-${++launches}` }],
    }, newWorkerBinding(rootEpoch, agentId)),
  });
  try {
    const a = await sup.spawn("governor", { taskName: "retained", message: "first-history", profile: "reader" }, "first");
    await until(() => sup.list("governor")[0]?.taskOutcome === "succeeded" && store.loadCheckpoint(a.agentId) !== null, 30_000);
    const usageBefore = sup.list("governor")[0]!.usage;
    await assert.rejects(() => sup.spawn("governor", { taskName: "excess", message: "no", profile: "reader" }, "excess"), /open maxOpenAgents/);
    const next = await sup.sendMessage("governor", a.agentId, "task", "second-history", { model }, "reuse");
    await until(() => sup.list("governor")[0]?.taskOutcome === "succeeded" && store.loadCheckpoint(a.agentId)?.ref.generation === 2, 30_000);
    assert.equal(launches, 2);
    assert.equal(sup.admissionScheduler.agentsCreatedCount, 1);
    assert.equal(sup.list("governor")[0]!.model, "replacement/new-model");
    assert.equal(sup.list("governor")[0]!.usage.inputTokens, usageBefore.inputTokens * 2);
    assert.equal(sup.list("governor")[0]!.usage.cost, usageBefore.cost! * 2);
    assert.equal(sup.list("governor")[0]!.usage.unknown, false);
    assert.notEqual(next.taskRunId, a.taskRunId);
    const history = Buffer.from(store.loadCheckpoint(a.agentId)!.bytes).toString("utf8");
    assert.ok(history.includes("first-history"));
    assert.ok(history.includes("second-history"));
    assert.ok(history.includes("run-1"));
    assert.ok(history.includes("run-2"));
    await sup.close("governor", a.agentId, "close-retained");
    const fresh = await sup.spawn("governor", { taskName: "fresh", message: "new-identity", profile: "reader" }, "fresh");
    await until(() => sup.list("governor").some((agent) => agent.id === fresh.agentId && agent.taskOutcome === "succeeded"), 30_000);
    assert.notEqual(fresh.agentId, a.agentId);
    assert.equal(launches, 3);
    assert.equal(sup.admissionScheduler.agentsCreatedCount, 2);
    assert.equal(sup.admissionScheduler.snapshot().open, 1);
    assert.equal(sup.read("governor", a.agentId, "result", 0, 100, next.taskRunId).result?.text, "run-2");
  } finally { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); }
});
