/**
 * pi-subagents — SDK worker process.
 *
 * One separate Node process (fresh V8 instance) per resident child. It owns
 * exactly one native pi session, created with explicit settings/resources:
 * private agentDir, no ambient extensions/skills/MCP/templates/themes/
 * context discovery, explicit sequential proxy/control tools, explicit model
 * runtime, and SDK cache warming forced off.
 *
 * Control transport is the single IPC channel to the supervisor (Node
 * fork). stdout/stderr are bounded diagnostics only. The worker validates
 * every inbound envelope against its channel binding and fences stale
 * generations.
 *
 * Launch: fork() this file with env PI_SUBAGENTS_WORKER=1 and
 * PI_SUBAGENTS_SDK_ROOT=<pi-monorepo dir>. Task text travels in the
 * `initialize` message, never argv.
 */

import { randomUUID } from "node:crypto";
import type { InitializePayload, IpcEnvelope, WorkerEvent } from "./protocol.ts";
import { bindChannel, validateEnvelope, validateInitializePayload } from "./protocol.ts";
import { PROTOCOL_VERSION } from "./types.ts";
import type { ChannelBinding } from "./protocol.ts";

const PI_VERSION = "1.0.0";
const CAPABILITIES = ["proxy-tools", "sequential", "checkpoint", "gate-decision"];

interface PendingToolCall {
  resolve: (result: { content: string; isError: boolean }) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerState {
  binding: ChannelBinding | null;
  session: unknown;
  sdk: SdkModules | null;
  taskRunId: string | null;
  generation: number | null;
  runActive: boolean;
  seq: number;
  pendingTools: Map<string, PendingToolCall>;
  // Disposable reviewer conversations (gate): reviewId -> submit handler.
  gateSubmissions: Map<string, (decision: unknown) => void>;
  disposed: boolean;
}

interface SdkModules {
  createAgentSession: (options: Record<string, unknown>) => Promise<{ session: unknown }>;
  SessionManager: {
    create: (cwd: string, dir?: string) => SessionManagerLike;
    open: (p: string) => SessionManagerLike;
    inMemory: (cwd?: string) => SessionManagerLike;
  };
  SettingsManager: { create: (cwd: string, agentDir: string) => { setCacheWarmingMode: (m: string) => void } & Record<string, unknown> };
  DefaultResourceLoader: new (options: Record<string, unknown>) => unknown;
  defineTool: (t: Record<string, unknown>) => Record<string, unknown>;
  ModelRuntime: { create: (options: Record<string, unknown>) => Promise<unknown> };
}

const state: WorkerState = {
  binding: null,
  session: null,
  sdk: null,
  taskRunId: null,
  generation: null,
  runActive: false,
  seq: 0,
  pendingTools: new Map(),
  gateSubmissions: new Map(),
  disposed: false,
};

function send(envelope: Partial<IpcEnvelope> & { operation: string }): void {
  if (!state.binding) return;
  const full: IpcEnvelope = {
    protocolVersion: PROTOCOL_VERSION,
    rootEpoch: state.binding.rootEpoch,
    agentId: state.binding.agentId,
    workerInstanceId: state.binding.workerInstanceId,
    requestId: null,
    seq: state.seq++,
    type: "event",
    taskRunId: state.taskRunId,
    executionGeneration: state.generation,
    payload: null,
    ...envelope,
  };
  process.send?.(full);
}

function emitWorkerEvent(event: WorkerEvent): void {
  send({ type: "event", operation: "event", payload: event });
}

function fail(requestId: string | null, code: string, message: string): void {
  send({ type: "response", operation: "event", requestId, payload: { ok: false, code, message } });
}

function ack(requestId: string | null, payload: Record<string, unknown> = {}): void {
  send({ type: "response", operation: "event", requestId, payload: { ok: true, ...payload } });
}

async function loadSdk(): Promise<SdkModules> {
  if (state.sdk) return state.sdk;
  // Import the built package tree (dist), never TS sources: the worker
  // runs under plain node without the extension host's loader.
  const root = process.env["PI_SUBAGENTS_SDK_ROOT"];
  const sdkPath = root ? `file://${root}/dist/index.js` : "@earendil-works/pi-coding-agent";
  const sdk = (await import(sdkPath)) as SdkModules & Record<string, unknown>;
  state.sdk = sdk as SdkModules;
  return state.sdk;
}

async function loadTypeBox(): Promise<{ Object: (props: Record<string, unknown>, opts?: Record<string, unknown>) => Record<string, unknown> }> {
  const root = process.env["PI_SUBAGENTS_SDK_ROOT"];
  if (root) {
    const m = (await import(`file://${root}/node_modules/typebox/build/index.mjs`)) as unknown as {
      Type: { Object: (props: Record<string, unknown>, opts?: Record<string, unknown>) => Record<string, unknown> };
    };
    return m.Type;
  }
  const m = (await import("typebox")) as unknown as {
    Type: { Object: (props: Record<string, unknown>, opts?: Record<string, unknown>) => Record<string, unknown> };
  };
  return m.Type;
}

async function loadCompat(): Promise<{ EventStream: new (isTerminal: (e: { type: string }) => boolean, getResult: (e: { type: string; message?: unknown; error?: unknown }) => unknown) => { push: (e: unknown) => void } }> {
  const root = process.env["PI_SUBAGENTS_SDK_ROOT"];
  if (root) {
    return (await import(`file://${root}/node_modules/@earendil-works/pi-ai/dist/compat.js`)) as unknown as {
      EventStream: new (isTerminal: (e: { type: string }) => boolean, getResult: (e: { type: string; message?: unknown; error?: unknown }) => unknown) => { push: (e: unknown) => void };
    };
  }
  return (await import("@earendil-works/pi-ai/compat")) as unknown as {
    EventStream: new (isTerminal: (e: { type: string }) => boolean, getResult: (e: { type: string; message?: unknown; error?: unknown }) => unknown) => { push: (e: unknown) => void };
  };
}

interface WorkerModelRuntime {
  registerProvider: (id: string, config: Record<string, unknown>) => void;
  getModel: (provider: string, id: string) => Record<string, unknown> | undefined;
}

function parseScriptSteps(): Array<{ kind: "text"; text: string } | { kind: "tool"; name: string; args: Record<string, unknown> } | { kind: "error"; message: string }> {
  try {
    const raw = process.env["PI_SUBAGENTS_SCRIPT"];
    if (!raw) return [{ kind: "text", text: "worker result" }];
    const steps = JSON.parse(raw) as Array<{ text?: string; tool?: string; args?: Record<string, unknown>; error?: string }>;
    return steps.map((step) => {
      if (step?.tool) return { kind: "tool" as const, name: step.tool, args: step.args ?? {} };
      if (step?.error) return { kind: "error" as const, message: step.error };
      return { kind: "text" as const, text: step?.text ?? "worker result" };
    });
  } catch {
    return [{ kind: "text", text: "worker result" }];
  }
}

function proxyToolNames(): string[] {
  return ["read", "grep", "find", "ls", "write", "edit", "bash", "submit_gate_decision"];
}

function describeProxyTool(name: string): string {
  switch (name) {
    case "read":
      return "Read a file or list a directory inside the assigned workspace view. Allowed for reader and writer.";
    case "grep":
      return "Search file contents inside the assigned workspace view.";
    case "find":
      return "Find files by pattern inside the assigned workspace view.";
    case "ls":
      return "List a directory inside the assigned workspace view.";
    case "write":
      return "Write a file inside the assigned worktree. Writer only.";
    case "edit":
      return "Edit a file inside the assigned worktree. Writer only.";
    case "bash":
      return "Run a shell command in the restricted sandbox. Writer with shell grant only; no network.";
    case "submit_gate_decision":
      return "Gate-only: submit the structured review decision. Managed reviewer only.";
    default:
      return name;
  }
}

/** Proxy tool execute: broker through the supervisor over IPC. */
function makeProxyExecute(toolName: string): (toolCallId: string, params: unknown) => Promise<unknown> {
  return async (toolCallId: string, params: unknown) => {
    const requestId = randomUUID();
    const payload = {
      tool: toolName,
      args: (params ?? {}) as Record<string, unknown>,
      toolCallId,
    };
    const result = await new Promise<{ content: string; isError: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pendingTools.delete(requestId);
        reject(new Error(`tool.execute timeout for ${toolName}`));
      }, 180_000);
      state.pendingTools.set(requestId, { resolve, reject, timer });
      send({ type: "request", operation: "tool.execute", requestId, payload });
    });
    if (result.isError) {
      return { content: [{ type: "text" as const, text: result.content }], details: {}, isError: true };
    }
    return { content: [{ type: "text" as const, text: result.content }], details: {} };
  };
}

async function handleInitialize(env: IpcEnvelope): Promise<void> {  const checked = validateInitializePayload(env.payload);
  if (!checked.ok) {
    fail(env.requestId, checked.error.code, checked.error.message);
    return;
  }
  const init: InitializePayload = checked.value;
  try {
    const sdk = await loadSdk();
    const agentDir = process.env["PI_SUBAGENTS_AGENT_DIR"] ?? `${process.env["HOME"] ?? "/tmp"}/.pi-subagents-worker`;
    const { mkdirSync } = await import("node:fs");
    mkdirSync(agentDir, { recursive: true });
    const settingsManager = sdk.SettingsManager.create(init.workdir, agentDir) as unknown as {
      setCacheWarmingMode: (m: string) => void;
    };
    // Disable ambient cache warming: parked/idle workers must not create
    // ungoverned paid background requests.
    settingsManager.setCacheWarmingMode("off");
    const { DefaultResourceLoader } = state.sdk as unknown as {
      DefaultResourceLoader: SdkModules["DefaultResourceLoader"];
    };
    const resourceLoader = new DefaultResourceLoader({
      cwd: init.workdir,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionsOverride: (base: { extensions: unknown[]; errors: unknown[]; runtime: unknown }) => ({
        extensions: [],
        errors: [],
        runtime: base.runtime,
      }),
    });
    const Type = await loadTypeBox();
    const proxyParams = Type.Object({}, { additionalProperties: true });
    const customTools = proxyToolNames().map((name) =>
      sdk.defineTool({
        name,
        label: name,
        description: describeProxyTool(name),
        parameters: proxyParams,
        executionMode: "sequential",
        execute: makeProxyExecute(name),
      }),
    );
    // Subscribe BEFORE accepting work: create session, attach listener, then prompt.
    const deterministic = process.env["PI_SUBAGENTS_DETERMINISTIC"] === "1";
    // Provider credentials stay in the approved host store: the worker opens
    // that store live (no auth.json copies into worktrees or tool envs).
    // Concurrent cross-process refresh is best-effort; see limitations.
    const hostAgentDir = process.env["PI_SUBAGENTS_HOST_AGENT_DIR"];
    const { join } = await import("node:path");
    const { ModelRuntime } = sdk as unknown as {
      ModelRuntime: { create: (options: Record<string, unknown>) => Promise<WorkerModelRuntime> };
    };
    let modelRuntime: WorkerModelRuntime | undefined;
    let model: Record<string, unknown>;
    if (deterministic) {
      // Provider-free integration: scripted provider through the real
      // ModelRuntime extension path (no network, no credentials).
      modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
      const compat = await loadCompat();
      const { registerDeterministicProvider, SIM_PROVIDER, SIM_MODEL } = await import("./deterministic.ts");
      registerDeterministicProvider(modelRuntime, compat.EventStream, parseScriptSteps());
      const resolved = modelRuntime.getModel(SIM_PROVIDER, SIM_MODEL);
      if (!resolved) throw new Error("deterministic provider model unavailable");
      model = resolved as Record<string, unknown>;
    } else if (hostAgentDir) {
      modelRuntime = await ModelRuntime.create({
        authPath: join(hostAgentDir, "auth.json"),
        modelsPath: null,
      });
      const resolved = modelRuntime.getModel(init.model.provider, init.model.id);
      if (!resolved) {
        throw new Error(`MODEL_UNAVAILABLE: ${init.model.provider}/${init.model.id} not resolvable from the approved store`);
      }
      model = resolved as Record<string, unknown>;
    } else {
      model = { provider: init.model.provider, id: init.model.id };
    }
    // Native sessions are file-backed and supervisor-owned: the session
    // directory lives under the root store (outside tool views). Restore
    // selects the recorded leaf through the native branch API; unknown
    // leaves refuse resume instead of patching history.
    const sessionsRoot = process.env["PI_SUBAGENTS_SESSIONS_DIR"] ?? `${agentDir}/sessions`;
    const agentSessionDir = `${sessionsRoot}/${state.binding!.agentId}`;
    mkdirSync(agentSessionDir, { recursive: true });
    let sessionManager: SessionManagerLike;
    if (init.restore?.sessionFile) {
      try {
        sessionManager = sdk.SessionManager.open(init.restore.sessionFile);
      } catch (e) {
        throw new Error(`RECOVERY_CORRUPT: cannot open restored session: ${(e as Error).message}`);
      }
      if (init.restore.leafEntryId) {
        try {
          sessionManager.branch(init.restore.leafEntryId);
        } catch (e) {
          throw new Error(`RECOVERY_CORRUPT: recorded leaf not on restored branch: ${(e as Error).message}`);
        }
      }
    } else {
      sessionManager = sdk.SessionManager.create(init.workdir, agentSessionDir);
    }
    const { session } = (await sdk.createAgentSession({
      cwd: init.workdir,
      agentDir,
      modelRuntime,
      settingsManager,
      resourceLoader,
      sessionManager,
      model,
      thinkingLevel: init.model.thinkingLevel,
      // Exact allowlist of packaged proxy/control tools: only these are
      // enabled. An empty allowlist would exclude the custom tools too.
      tools: proxyToolNames(),
      customTools,
    })) as unknown as { session: WorkerSession };
    state.session = session;
    state.taskRunId = init.taskRunId;
    state.generation = init.executionGeneration;
    // Sequential worker tool execution is part of the contract: it prevents
    // a wait from releasing a lease while a sibling tool still runs.
    session.agent.toolExecution = "sequential";
    session.subscribe((event: { type: string }) => {
      onSessionEvent(event);
    });
    emitWorkerEvent({ kind: "started", taskRunId: state.taskRunId, executionGeneration: state.generation, detail: {} });
    ack(env.requestId, { sessionId: session.sessionId, sessionFile: session.sessionManager.getSessionFile() ?? null });
    state.runActive = true;
    const header = `[subagent ${state.binding!.agentId} task ${init.taskRunId}]\n${init.taskText}`;
    await session.prompt(header, { expandPromptTemplates: false });
  } catch (e) {
    state.runActive = false;
    emitWorkerEvent({
      kind: "settled",
      taskRunId: state.taskRunId,
      executionGeneration: state.generation,
      detail: { status: "failed", error: (e as Error).message },
    });
    fail(env.requestId, "INVALID", (e as Error).message);
  }
}

interface SessionManagerLike {
  getSessionId: () => string;
  getSessionFile: () => string | undefined;
  getLeafId: () => string | null;
  getBranch: () => Array<{ id: string; type: string }>;
  getEntries: () => Array<{ id: string; type: string }>;
  branch: (branchFromId: string) => void;
}

interface WorkerSession {
  sessionId: string;
  agent: { toolExecution: string; abort: () => void };
  subscribe: (listener: (event: { type: string } & Record<string, unknown>) => void) => () => void;
  prompt: (text: string, options?: Record<string, unknown>) => Promise<void>;
  abort: () => Promise<void>;
  sendCustomMessage: (message: Record<string, unknown>, options?: Record<string, unknown>) => Promise<void>;
  isIdle: boolean;
  isStreaming: boolean;
  sessionManager: SessionManagerLike;
}

let lastAssistantText = "";
let runUsage = { input: 0, output: 0 };

function onSessionEvent(event: { type: string } & Record<string, unknown>): void {
  if (!state.binding) return;
  switch (event["type"]) {
    case "message_end": {
      const message = event["message"] as {
        role?: string;
        content?: Array<{ type: string; text?: string }>;
        usage?: { input?: number; output?: number };
      } | undefined;
      if (message?.role === "assistant") {
        // Cumulative usage accounting (per-request deltas summed here;
        // provider accounting may still arrive late or not at all).
        runUsage.input += message.usage?.input ?? 0;
        runUsage.output += message.usage?.output ?? 0;
      }
      if (message?.role === "assistant" && Array.isArray(message.content)) {
        const text = message.content
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("");
        if (text) {
          lastAssistantText = text;
          emitWorkerEvent({
            kind: "preview",
            taskRunId: state.taskRunId,
            executionGeneration: state.generation,
            detail: { text: text.slice(0, 2000) },
          });
        }
      }
      break;
    }
    case "tool_execution_start": {
      const toolName = (event as Record<string, unknown>)["toolName"];
      emitWorkerEvent({
        kind: "tool_start",
        taskRunId: state.taskRunId,
        executionGeneration: state.generation,
        detail: { tool: typeof toolName === "string" ? toolName : "unknown" },
      });
      break;
    }
    case "tool_execution_end": {
      emitWorkerEvent({
        kind: "tool_end",
        taskRunId: state.taskRunId,
        executionGeneration: state.generation,
        detail: {},
      });
      break;
    }
    case "agent_settled": {
      // The correct completion boundary (after retries, compaction, and
      // queued continuation). agent_end alone cannot finalize success.
      state.runActive = false;
      emitWorkerEvent({
        kind: "settled",
        taskRunId: state.taskRunId,
        executionGeneration: state.generation,
        detail: { status: "succeeded", lastAssistantText: lastAssistantText.slice(0, 8000), usage: { ...runUsage } },
      });
      break;
    }
    default:
      break;
  }
}

async function handleDeliver(env: IpcEnvelope): Promise<void> {
  const session = state.session as WorkerSession | null;
  if (!session) {
    fail(env.requestId, "NOT_RUNNING", "no active session");
    return;
  }
  if (env.executionGeneration !== null && env.executionGeneration !== state.generation && (env.payload as { mode?: string }).mode !== "task" && (env.payload as { mode?: string }).mode !== "repair") {
    fail(env.requestId, "STALE_GENERATION", "deliver targets a superseded generation");
    return;
  }
  const payload = env.payload as { mode?: string; text?: string; messageId?: string };
  try {
    if (payload.mode === "note") {
      await session.sendCustomMessage(
        {
          customType: "pi-subagents-note",
          content: [{ type: "text", text: String(payload.text ?? "") }],
          display: false,
          details: { messageId: payload.messageId ?? null },
        },
        { triggerTurn: false },
      );
      ack(env.requestId, { inserted: true });
    } else if (payload.mode === "steer") {
      if (session.isIdle) {
        fail(env.requestId, "NOT_RUNNING", "cannot steer an idle agent; use task to start work");
        return;
      }
      await session.sendCustomMessage(
        {
          customType: "pi-subagents-steer",
          content: [{ type: "text", text: String(payload.text ?? "") }],
          display: false,
          details: { messageId: payload.messageId ?? null },
        },
        { triggerTurn: true, deliverAs: "steer" },
      );
      ack(env.requestId, { inserted: true });
    } else if (payload.mode === "task" || payload.mode === "repair") {
      // Adopt the supervisor-admitted generation when supplied (fenced
      // above against moving backwards); otherwise advance locally.
      if (env.executionGeneration !== null && env.executionGeneration !== undefined) {
        state.generation = env.executionGeneration;
      } else {
        state.generation = (state.generation ?? 0) + 1;
      }
      state.taskRunId = (env.taskRunId ?? state.taskRunId) as string | null;
      lastAssistantText = "";
      runUsage = { input: 0, output: 0 };
      state.runActive = true;
      emitWorkerEvent({ kind: "started", taskRunId: state.taskRunId, executionGeneration: state.generation, detail: {} });
      ack(env.requestId, { generation: state.generation });
      await session.prompt(String(payload.text ?? ""), { expandPromptTemplates: false });
    } else {
      fail(env.requestId, "INVALID", `unknown deliver mode ${String(payload.mode)}`);
    }
  } catch (e) {
    fail(env.requestId, "INVALID", (e as Error).message);
  }
}

async function handleInterrupt(env: IpcEnvelope): Promise<void> {
  const session = state.session as WorkerSession | null;
  if (!session) {
    fail(env.requestId, "NOT_RUNNING", "no active session");
    return;
  }
  try {
    await session.abort();
    state.runActive = false;
    emitWorkerEvent({
      kind: "settled",
      taskRunId: state.taskRunId,
      executionGeneration: state.generation,
      detail: { status: "interrupted", usage: { ...runUsage } },
    });
    ack(env.requestId, {});
  } catch (e) {
    fail(env.requestId, "INVALID", (e as Error).message);
  }
}

/**
 * Native-branch entry search for mailbox reconciliation. Checks the
 * restored active branch (not the compacted LLM projection): an entry
 * retained in the branch but summarized out of model context counts as
 * present and must not be reinserted. Same message ID preserved.
 */
async function handleFindEntry(env: IpcEnvelope): Promise<void> {
  const session = state.session as WorkerSession | null;
  if (!session) {
    fail(env.requestId, "NOT_RUNNING", "no active session");
    return;
  }
  const messageId = (env.payload as { messageId?: string })?.messageId;
  if (typeof messageId !== "string" || !messageId) {
    fail(env.requestId, "INVALID", "find_entry requires messageId");
    return;
  }
  try {
    const branch = session.sessionManager.getBranch();
    let found: string | null = null;
    for (const entry of branch) {
      try {
        if (JSON.stringify(entry).includes(messageId)) {
          found = entry.id;
          break;
        }
      } catch {
        continue;
      }
    }
    ack(env.requestId, { found, entryId: found });
  } catch (e) {
    fail(env.requestId, "INVALID", (e as Error).message);
  }
}

async function handleCheckpoint(env: IpcEnvelope): Promise<void> {
  const session = state.session as WorkerSession | null;
  if (!session) {
    fail(env.requestId, "NOT_RUNNING", "no active session");
    return;
  }
  // Capture at safe boundaries only: quiesce the native writer, fsync the
  // session file (the SDK persists without a barrier), then hand durable
  // bytes to the supervisor. A completed append alone is not durability.
  if (session.isStreaming) {
    fail(env.requestId, "CONFLICT", "session streaming; checkpoint at the next settled boundary");
    return;
  }
  try {
    const leaf = session.sessionManager.getLeafId();
    const file = session.sessionManager.getSessionFile();
    if (!file) {
      // Setup-only session pi has not materialized: reconstructible from
      // the durable bootstrap record; no file to checkpoint.
      ack(env.requestId, { leafEntryId: leaf, materialized: false });
      return;
    }
    const { readFileSync, openSync, closeSync, fsyncSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const fd = openSync(file, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const bytes = readFileSync(file);
    if (bytes.length > 16 * 1024 * 1024) {
      fail(env.requestId, "PAYLOAD_TOO_LARGE", "session file exceeds checkpoint cap");
      return;
    }
    ack(env.requestId, {
      leafEntryId: leaf,
      materialized: true,
      byteCount: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytesBase64: bytes.toString("base64"),
    });
  } catch (e) {
    fail(env.requestId, "INVALID", (e as Error).message);
  }
}

function handleToolResponse(envelope: IpcEnvelope): void {
  // Supervisor answers to our tool.execute requests.
  const pending = envelope.requestId ? state.pendingTools.get(envelope.requestId) : undefined;
  if (!pending) return;
  state.pendingTools.delete(envelope.requestId!);
  clearTimeout(pending.timer);
  const payload = envelope.payload as { ok?: boolean; content?: string; code?: string; message?: string };
  if (payload?.ok === true) {
    pending.resolve({ content: String(payload.content ?? ""), isError: false });
  } else {
    pending.resolve({ content: `${payload?.code ?? "INVALID"}: ${payload?.message ?? "tool failed"}`, isError: true });
  }
}

async function onMessage(raw: unknown): Promise<void> {
  if (!state.binding) {
    // First message must be the supervisor handshake carrying the binding.
    const e = raw as Record<string, unknown>;
    if (e?.["operation"] !== "__hello") return;
    const rootEpoch = e["rootEpoch"];
    const agentId = e["agentId"];
    const workerInstanceId = e["workerInstanceId"];
    if (typeof rootEpoch !== "string" || typeof agentId !== "string" || typeof workerInstanceId !== "string") {
      process.send?.({ error: "INVALID_HELLO" });
      process.exit(2);
    }
    state.binding = bindChannel(rootEpoch, agentId, workerInstanceId);
    process.send?.({
      protocolVersion: PROTOCOL_VERSION,
      rootEpoch,
      agentId,
      workerInstanceId,
      requestId: null,
      seq: 0,
      type: "event",
      operation: "ready",
      taskRunId: null,
      executionGeneration: null,
      payload: { piVersion: PI_VERSION, capabilities: CAPABILITIES },
    });
    return;
  }
  // Tool responses arrive as responses to our requests.
  const asRecord = raw as Record<string, unknown>;
  if (asRecord["type"] === "response" && typeof asRecord["requestId"] === "string" && state.pendingTools.has(asRecord["requestId"] as string)) {
    const checked = validateEnvelope(raw, state.binding, "to-worker");
    if (checked.ok) handleToolResponse(checked.envelope);
    return;
  }
  const checked = validateEnvelope(raw, state.binding, "to-worker");
  if (!checked.ok) {
    const rid = (raw as Record<string, unknown>)?.["requestId"];
    fail(typeof rid === "string" ? rid : null, checked.code, checked.message);
    return;
  }
  const env = checked.envelope;
  switch (env.operation) {
    case "initialize":
      await handleInitialize(env);
      break;
    case "run":
      // Alias for initialize when a session already exists is rejected:
      // one outstanding run per worker; use deliver/task for new work.
      fail(env.requestId, "CONFLICT", "worker already initialized; use deliver");
      break;
    case "deliver":
      await handleDeliver(env);
      break;
    case "interrupt":
      await handleInterrupt(env);
      break;
    case "checkpoint":
      await handleCheckpoint(env);
      break;
    case "find_entry":
      await handleFindEntry(env);
      break;
    case "dispose":
      state.disposed = true;
      ack(env.requestId, {});
      process.exit(0);
      break;
    default:
      fail(env.requestId, "UNKNOWN_OPERATION", `unsupported supervisor op ${env.operation}`);
  }
}

if (process.env["PI_SUBAGENTS_WORKER"] === "1") {
  process.on("message", (raw: unknown) => {
    void onMessage(raw);
  });
  process.on("disconnect", () => {
    // Workers abort on IPC disconnect (no detached survival in v1).
    process.exit(0);
  });
}
