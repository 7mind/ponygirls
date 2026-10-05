import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { WorkerHandle } from "../src/worker-launch.ts";
import type { WorkerEvent } from "../src/protocol.ts";
import type { DeterministicModelRuntime } from "../src/deterministic.ts";

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
  try {
    await handle.launch();
    const ack = (await handle.request("initialize", {
      taskText: "read the file",
      profile: "reader",
      instructionHash: "",
      model: { provider: "openai", id: "deterministic-test", thinkingLevel: "off" },
      taskRunId: "task-m1",
      executionGeneration: 1,
      workdir: dir,
      readRoots: [dir],
      writable: false,
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
      leafEntryId?: string | null; materialized?: boolean; byteCount?: number; sha256?: string; bytesBase64?: string;
    };
    assert.equal(cp.materialized, true);
    assert.ok(typeof cp.leafEntryId === "string" && cp.leafEntryId.length > 0);
    const bytes = Buffer.from(cp.bytesBase64 ?? "", "base64");
    assert.equal(bytes.length, cp.byteCount);
    assert.ok(bytes.toString("utf8").includes("read the file"));
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
  const { registerDeterministicProvider, SIM_PROVIDER, SIM_MODEL } = await import("../src/deterministic.ts");
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
  ]);
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
    rootDir: dir,
    store,
    policy: defaultSupervisorPolicy(),
    executor: new DummyToolExecutor(),
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
