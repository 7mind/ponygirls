/**
 * pi-subagents — SDK worker process.
 *
 * One separate Node process (fresh V8 instance) per resident child. It owns
 * exactly one native pi session, created with explicit settings/resources:
 * private agentDir, no ambient extensions/skills/MCP/templates/themes/
 * context discovery, the exact tool allowlist the supervisor assigns (all
 * executed by the supervisor over IPC), explicit model runtime, and SDK
 * cache warming forced off.
 *
 * Control transport is the single IPC channel to the supervisor (Node
 * fork). stdout/stderr are bounded diagnostics only. The worker validates
 * every inbound envelope against its channel binding and fences stale
 * generations.
 *
 * A generation's outcome comes from `agent_settled` plus the last assistant
 * stop reason and the interrupt flag: an aborted or errored run is never
 * reported as success.
 *
 * Launch: fork() this file with env PI_SUBAGENTS_WORKER=1 and
 * PI_SUBAGENTS_SDK_ROOT=<pi-monorepo dir>. Task text travels in IPC
 * messages, never argv.
 */

import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { InitializePayload, IpcEnvelope, WorkerEvent } from "./protocol.ts";
import { bindChannel, taskHeader, validateEnvelope, validateInitializePayload } from "./protocol.ts";
import { CHILD_CONTROL_TOOLS, DELEGATION_TOOLS, childToolSpec, type TypeBuilder } from "./tools.ts";
import { MAX_PAYLOAD_BYTES } from "./protocol.ts";
import { PROTOCOL_VERSION, type InstructionSet } from "./types.ts";
import type { ChannelBinding } from "./protocol.ts";

const PI_VERSION = "1.0.0";
const CAPABILITIES = ["proxy-tools", "sequential", "checkpoint", "gate-decision", "control-tools"];
const TOOL_REQUEST_TIMEOUT_MS = 15 * 60_000;
const CHECKPOINT_MAX_BYTES = 16 * 1024 * 1024;
const PREVIEW_MAX = 2000;
/** In-flight assistant text is forwarded at most this often (the transcript view shows it live). */
const STREAM_PREVIEW_INTERVAL_MS = 300;
const RESULT_TEXT_MAX = 8000;

interface PendingToolCall {
  resolve: (result: { content: string; isError: boolean }) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** The execution generation currently owned by this worker. */
interface GenerationState {
  taskRunId: string | null;
  generation: number | null;
  interruptRequested: boolean;
  settled: boolean;
  lastText: string;
  stopReason: string | null;
  errorMessage: string | null;
  usage: { input: number; output: number; cost: number | null; unknown: boolean };
  /** When in-flight text was last forwarded. */
  previewAt: number;
}

interface SdkModules {
  createAgentSession: (options: Record<string, unknown>) => Promise<{ session: unknown }>;
  SessionManager: {
    create: (cwd: string, dir?: string) => SessionManagerLike;
    open: (p: string) => SessionManagerLike;
    inMemory: (cwd?: string) => SessionManagerLike;
  };
  SettingsManager: { create: (cwd: string, agentDir: string) => { setCacheWarmingMode: (m: string) => void } };
  DefaultResourceLoader: new (options: Record<string, unknown>) => ResourceLoaderLike;
  defineTool: (t: Record<string, unknown>) => Record<string, unknown>;
  ModelRuntime: { create: (options: Record<string, unknown>) => Promise<WorkerModelRuntime> };
}

/** pi's ResourceLoader contract (opaque results). */
interface ResourceLoaderLike {
  getExtensions(): unknown;
  getSkills(): unknown;
  getPrompts(): unknown;
  getThemes(): unknown;
  getAgentsFiles(): unknown;
  getSystemPrompt(): unknown;
  getSystemPromptSource(): unknown;
  getAppendSystemPrompt(): unknown;
  getAppendSystemPromptSources(): unknown;
  extendResources(paths: unknown): void;
  reload(options?: unknown): Promise<void>;
}

/**
 * The child's resources: its loader is never reloaded, so nothing (settings
 * packages, SYSTEM.md, AGENTS.md, skills) is discovered from the workdir;
 * it lists exactly the skills and context files its owner selected at spawn.
 */
function snapshotResourceLoader(base: ResourceLoaderLike, set: InstructionSet): ResourceLoaderLike {
  const skills = set.skills.map((s) => ({ ...s, sourceInfo: { path: s.filePath, source: "pi-subagents", scope: "temporary", origin: "top-level" } }));
  return {
    getExtensions: () => base.getExtensions(),
    getSkills: () => ({ skills, diagnostics: [] }),
    getPrompts: () => base.getPrompts(),
    getThemes: () => base.getThemes(),
    getAgentsFiles: () => ({ agentsFiles: set.contextFiles.map((f) => ({ ...f })) }),
    getSystemPrompt: () => base.getSystemPrompt(),
    getSystemPromptSource: () => base.getSystemPromptSource(),
    getAppendSystemPrompt: () => base.getAppendSystemPrompt(),
    getAppendSystemPromptSources: () => base.getAppendSystemPromptSources(),
    extendResources: (paths) => base.extendResources(paths),
    reload: () => Promise.reject(new Error("child resources are fixed at spawn; reload is unsupported")),
  };
}

interface WorkerModelRuntime {
  registerProvider: (id: string, config: Record<string, unknown>) => void;
  getModel: (provider: string, id: string) => Record<string, unknown> | undefined;
}

interface SessionManagerLike {
  getSessionFile: () => string | undefined;
  getLeafId: () => string | null;
  getBranch: () => Array<{ id: string; type: string; details?: unknown }>;
  branch: (branchFromId: string) => void;
}

interface WorkerSession {
  sessionId: string;
  agent: { toolExecution: string };
  subscribe: (listener: (event: { type: string } & Record<string, unknown>) => void) => () => void;
  prompt: (text: string, options?: Record<string, unknown>) => Promise<void>;
  abort: () => Promise<void>;
  sendCustomMessage: (message: Record<string, unknown>, options?: Record<string, unknown>) => Promise<void>;
  isIdle: boolean;
  isStreaming: boolean;
  sessionManager: SessionManagerLike;
}

const state: {
  binding: ChannelBinding | null;
  session: WorkerSession | null;
  sdk: SdkModules | null;
  seq: number;
  pendingTools: Map<string, PendingToolCall>;
  gen: GenerationState;
} = {
  binding: null,
  session: null,
  sdk: null,
  seq: 0,
  pendingTools: new Map(),
  gen: freshGeneration(null, null),
};

function freshGeneration(taskRunId: string | null, generation: number | null): GenerationState {
  return { taskRunId, generation, interruptRequested: false, settled: false, lastText: "", stopReason: null, errorMessage: null, usage: { input: 0, output: 0, cost: null, unknown: false }, previewAt: 0 };
}

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
    taskRunId: state.gen.taskRunId,
    executionGeneration: state.gen.generation,
    payload: null,
    ...envelope,
  };
  process.send?.(full);
}

function emitWorkerEvent(event: Omit<WorkerEvent, "taskRunId" | "executionGeneration">): void {
  send({ type: "event", operation: "event", payload: { ...event, taskRunId: state.gen.taskRunId, executionGeneration: state.gen.generation } });
}

function fail(requestId: string | null, code: string, message: string): void {
  send({ type: "response", operation: "event", requestId, payload: { ok: false, code, message } });
}

function ack(requestId: string | null, payload: Record<string, unknown> = {}): void {
  send({ type: "response", operation: "event", requestId, payload: { ok: true, ...payload } });
}

/** Publish the current generation's single outcome. */
function settleGeneration(failure: string | null): void {
  const gen = state.gen;
  if (gen.settled) return;
  gen.settled = true;
  const status = failure !== null
    ? "failed"
    : gen.interruptRequested || gen.stopReason === "aborted"
      ? "interrupted"
      : gen.stopReason === "error"
        ? "failed"
        : "succeeded";
  const error = failure ?? (status === "failed" ? gen.errorMessage ?? "provider error" : null);
  emitWorkerEvent({
    kind: "settled",
    detail: { status, error, lastAssistantText: gen.lastText.slice(0, RESULT_TEXT_MAX), usage: { ...gen.usage } },
  });
}

function sdkRoot(): string | null {
  return process.env["PI_SUBAGENTS_SDK_ROOT"] ?? null;
}

async function loadSdk(): Promise<SdkModules> {
  if (state.sdk) return state.sdk;
  // Import the built package tree (dist), never TS sources: the worker
  // runs under plain node without the extension host's loader.
  const root = sdkRoot();
  if (!root) throw new Error("PI_SUBAGENTS_SDK_ROOT is not set; the worker cannot locate the pi SDK");
  state.sdk = (await import(`file://${root}/dist/index.js`)) as SdkModules;
  return state.sdk;
}

async function loadTypeBox(): Promise<TypeBuilder<unknown>> {
  const m = (await import(`file://${sdkRoot()}/node_modules/typebox/build/index.mjs`)) as { Type: TypeBuilder<unknown> };
  return m.Type;
}

async function loadCompat(): Promise<{ EventStream: new (isTerminal: (e: { type: string }) => boolean, getResult: (e: { type: string; message?: unknown; error?: unknown }) => unknown) => { push: (e: unknown) => void } }> {
  return (await import(`file://${sdkRoot()}/node_modules/@earendil-works/pi-ai/dist/compat.js`)) as {
    EventStream: new (isTerminal: (e: { type: string }) => boolean, getResult: (e: { type: string; message?: unknown; error?: unknown }) => unknown) => { push: (e: unknown) => void };
  };
}

function parseScriptSteps(): Array<{ kind: "text"; text: string } | { kind: "tool"; name: string; args: Record<string, unknown> } | { kind: "error"; message: string }> {
  const raw = process.env["PI_SUBAGENTS_SCRIPT"];
  if (!raw) return [{ kind: "text", text: "worker result" }];
  const steps = JSON.parse(raw) as Array<{ text?: string; tool?: string; args?: Record<string, unknown>; error?: string }>;
  return steps.map((step) => {
    if (step.tool) return { kind: "tool" as const, name: step.tool, args: step.args ?? {} };
    if (step.error) return { kind: "error" as const, message: step.error };
    return { kind: "text" as const, text: step.text ?? "worker result" };
  });
}

/** Headroom for the envelope around tool arguments in one IPC frame. */
const ENVELOPE_HEADROOM_BYTES = 8 * 1024;
/** Control tools are bounded by the supervisor (wait timeouts, lease queues), not by a worker timer. */
const SUPERVISOR_BOUNDED_TOOLS: ReadonlySet<string> = new Set([...CHILD_CONTROL_TOOLS, ...DELEGATION_TOOLS]);

/** Every registered tool executes in the supervisor (broker or controller) over IPC. */
function makeProxyExecute(toolName: string): (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<unknown> {
  return async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
    const requestId = randomUUID();
    if (Buffer.byteLength(JSON.stringify(params ?? {}), "utf8") > MAX_PAYLOAD_BYTES - ENVELOPE_HEADROOM_BYTES) {
      return { content: [{ type: "text" as const, text: `PAYLOAD_TOO_LARGE: ${toolName} arguments exceed ${MAX_PAYLOAD_BYTES - ENVELOPE_HEADROOM_BYTES} bytes; split the content into smaller writes/edits` }], details: {}, isError: true };
    }
    const result = await new Promise<{ content: string; isError: boolean }>((resolve) => {
      const finish = (r: { content: string; isError: boolean }): void => {
        const pending = state.pendingTools.get(requestId);
        if (!pending) return;
        if (pending.timer) clearTimeout(pending.timer);
        state.pendingTools.delete(requestId);
        resolve(r);
      };
      const timer = SUPERVISOR_BOUNDED_TOOLS.has(toolName) ? undefined : setTimeout(() => finish({ content: `tool ${toolName} timed out waiting for the supervisor`, isError: true }), TOOL_REQUEST_TIMEOUT_MS);
      state.pendingTools.set(requestId, { resolve: finish, timer });
      // An abort ends the call here; the supervisor cancels the job itself.
      signal?.addEventListener("abort", () => finish({ content: `tool ${toolName} aborted`, isError: true }), { once: true });
      // The usage so far rides along, so a generation stopped mid-tool
      // (reviewer after its decision, crash) is still accounted for.
      send({ type: "request", operation: "tool.execute", requestId, payload: { tool: toolName, args: (params ?? {}) as Record<string, unknown>, toolCallId, usage: { ...state.gen.usage } } });
    });
    const content = [{ type: "text" as const, text: result.content }];
    return result.isError ? { content, details: {}, isError: true } : { content, details: {} };
  };
}

async function resolveModel(sdk: SdkModules, init: InitializePayload, agentDir: string): Promise<{ modelRuntime: WorkerModelRuntime; model: Record<string, unknown> }> {
  if (process.env["PI_SUBAGENTS_DETERMINISTIC"] === "1") {
    // Provider-free integration: scripted provider through the real
    // ModelRuntime extension path (no network, no credentials).
    const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
    const compat = await loadCompat();
    const { registerDeterministicProvider, SIM_PROVIDER, SIM_MODEL } = await import("./deterministic.ts");
    registerDeterministicProvider(modelRuntime, compat.EventStream, parseScriptSteps());
    const model = modelRuntime.getModel(SIM_PROVIDER, SIM_MODEL);
    if (!model) throw new Error("MODEL_UNAVAILABLE: deterministic provider model unavailable");
    return { modelRuntime, model };
  }
  // Provider credentials stay in the approved host store, opened live (no
  // auth.json copies into worktrees or tool envs). Declarative custom
  // models come from the host models.json; extension-registered providers
  // cannot be serialized into a worker and are rejected as unavailable.
  const hostAgentDir = process.env["PI_SUBAGENTS_HOST_AGENT_DIR"];
  if (!hostAgentDir) throw new Error("MODEL_UNAVAILABLE: no approved credential store (PI_SUBAGENTS_HOST_AGENT_DIR unset)");
  const modelsPath = join(hostAgentDir, "models.json");
  const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(hostAgentDir, "auth.json"), modelsPath: existsSync(modelsPath) ? modelsPath : null });
  const model = modelRuntime.getModel(init.model.provider, init.model.id);
  if (!model) throw new Error(`MODEL_UNAVAILABLE: ${init.model.provider}/${init.model.id} is not resolvable from the approved store`);
  return { modelRuntime, model };
}

async function handleInitialize(env: IpcEnvelope): Promise<void> {
  const checked = validateInitializePayload(env.payload);
  if (!checked.ok) {
    fail(env.requestId, checked.error.code, checked.error.message);
    return;
  }
  if (state.session) {
    fail(env.requestId, "CONFLICT", "worker already initialized; use deliver");
    return;
  }
  const init: InitializePayload = checked.value;
  state.gen = freshGeneration(init.taskRunId, init.executionGeneration);
  let session: WorkerSession;
  try {
    const sdk = await loadSdk();
    const agentDir = process.env["PI_SUBAGENTS_AGENT_DIR"];
    if (!agentDir) throw new Error("PI_SUBAGENTS_AGENT_DIR is not set");
    mkdirSync(agentDir, { recursive: true });
    const settingsManager = sdk.SettingsManager.create(init.workdir, agentDir);
    // Parked/idle workers must not create ungoverned paid background requests.
    settingsManager.setCacheWarmingMode("off");
    const baseLoader = new sdk.DefaultResourceLoader({
      cwd: init.workdir,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionsOverride: (base: { runtime: unknown }) => ({ extensions: [], errors: [], runtime: base.runtime }),
    });
    const resourceLoader = snapshotResourceLoader(baseLoader, init.instructions);
    const Type = await loadTypeBox();
    const customTools = init.tools.map((name) => {
      const spec = childToolSpec(Type, name);
      return sdk.defineTool({ name, label: name, description: spec.description, parameters: spec.parameters, executionMode: "sequential", execute: makeProxyExecute(name) });
    });
    const { modelRuntime, model } = await resolveModel(sdk, init, agentDir);
    // Native sessions are file-backed and supervisor-owned (under the root
    // store, outside tool views). A gate reviewer gets a fresh file for each
    // evaluation (it is never restored), kept for its transcript.
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
      const sessionsRoot = process.env["PI_SUBAGENTS_SESSIONS_DIR"] ?? join(agentDir, "sessions");
      const dir = join(sessionsRoot, state.binding!.agentId);
      mkdirSync(dir, { recursive: true });
      sessionManager = sdk.SessionManager.create(init.workdir, dir);
    }
    ({ session } = (await sdk.createAgentSession({
      cwd: init.workdir,
      agentDir,
      modelRuntime,
      settingsManager,
      resourceLoader,
      sessionManager,
      model,
      thinkingLevel: init.model.thinkingLevel,
      // Exact allowlist: only the assigned tools are active. An empty
      // allowlist would exclude the custom tools too.
      tools: init.tools,
      customTools,
    })) as { session: WorkerSession });
  } catch (e) {
    fail(env.requestId, "INVALID", (e as Error).message);
    return;
  }
  state.session = session;
  // Sequential worker tool execution is part of the contract: it prevents
  // a wait from releasing a lease while a sibling tool still runs.
  session.agent.toolExecution = "sequential";
  // Subscribe BEFORE accepting work.
  session.subscribe((event) => onSessionEvent(event));
  ack(env.requestId, { sessionId: session.sessionId, sessionFile: session.sessionManager.getSessionFile() ?? null });
  if (init.taskText === null) {
    state.gen.settled = true; // Loaded only: no generation runs until a task arrives.
    return;
  }
  emitWorkerEvent({ kind: "started", detail: {} });
  await runPrompt(`${taskHeader(state.binding!.agentId, init.taskRunId)}${init.taskText}`);
}

/** Prompt the current generation; a prompt that throws still settles it. */
async function runPrompt(text: string): Promise<void> {
  try {
    await state.session!.prompt(text, { expandPromptTemplates: false });
  } catch (e) {
    settleGeneration((e as Error).message);
  }
}

function onSessionEvent(event: { type: string } & Record<string, unknown>): void {
  if (!state.binding) return;
  const gen = state.gen;
  switch (event["type"]) {
    case "message_end": {
      const message = event["message"] as {
        role?: string;
        content?: Array<{ type: string; text?: string }>;
        usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
        stopReason?: string;
        errorMessage?: string;
      } | undefined;
      if (message?.role !== "assistant") break;
      // Per-request deltas summed here; missing provider accounting is
      // reported as unknown, never as zero.
      if (message.usage) {
        gen.usage.input += (message.usage.input ?? 0) + (message.usage.cacheRead ?? 0) + (message.usage.cacheWrite ?? 0);
        gen.usage.output += message.usage.output ?? 0;
        if (typeof message.usage.cost?.total === "number") gen.usage.cost = (gen.usage.cost ?? 0) + message.usage.cost.total;
      } else {
        gen.usage.unknown = true;
      }
      gen.stopReason = message.stopReason ?? null;
      gen.errorMessage = message.errorMessage ?? null;
      const text = (message.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text).join("");
      if (text) {
        gen.lastText = text;
        emitWorkerEvent({ kind: "preview", detail: { text: text.slice(0, PREVIEW_MAX), partial: false } });
      }
      break;
    }
    case "message_update": {
      const message = event["message"] as { role?: string; content?: Array<{ type: string; text?: string }> } | undefined;
      if (message?.role !== "assistant" || Date.now() - gen.previewAt < STREAM_PREVIEW_INTERVAL_MS) break;
      const text = (message.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text).join("");
      if (!text) break;
      gen.previewAt = Date.now();
      // The tail is what is being written; message_end delivers the whole text.
      emitWorkerEvent({ kind: "preview", detail: { text: text.slice(-PREVIEW_MAX), partial: true } });
      break;
    }
    case "tool_execution_start": {
      const toolName = event["toolName"];
      emitWorkerEvent({ kind: "tool_start", detail: { tool: typeof toolName === "string" ? toolName : "unknown" } });
      break;
    }
    case "tool_execution_end":
      emitWorkerEvent({ kind: "tool_end", detail: {} });
      break;
    case "turn_start":
      // An interrupt accepted before the SDK run became active still stops it.
      if (gen.interruptRequested) void state.session?.abort();
      break;
    case "agent_settled":
      // The completion boundary (after retries, compaction, and queued
      // continuation); the stop reason decides success.
      settleGeneration(null);
      break;
    default:
      break;
  }
}

async function handleDeliver(env: IpcEnvelope): Promise<void> {
  const session = state.session;
  if (!session) {
    fail(env.requestId, "NOT_RUNNING", "no active session");
    return;
  }
  const payload = env.payload as { mode?: string; text?: string; messageId?: string };
  const text = String(payload.text ?? "");
  try {
    if (payload.mode === "note" || payload.mode === "steer") {
      if (payload.mode === "steer" && (session.isIdle || state.gen.settled)) {
        fail(env.requestId, "NOT_RUNNING", "cannot steer an idle agent; use task to start work");
        return;
      }
      if (payload.mode === "steer" && env.executionGeneration !== state.gen.generation) {
        fail(env.requestId, "STALE_GENERATION", "steer targets a superseded generation");
        return;
      }
      if (payload.mode === "note" && payload.messageId && findMessageEntry(session, payload.messageId)) {
        ack(env.requestId, { inserted: true, duplicate: true });
        return;
      }
      await session.sendCustomMessage(
        { customType: `pi-subagents-${payload.mode}`, content: [{ type: "text", text }], display: false, details: { messageId: payload.messageId ?? null } },
        payload.mode === "note" ? { triggerTurn: false } : { triggerTurn: true, deliverAs: "steer" },
      );
      ack(env.requestId, { inserted: true });
      return;
    }
    if (payload.mode === "task" || payload.mode === "repair") {
      // One outstanding generation per worker: refuse before acknowledging.
      if (!session.isIdle || !state.gen.settled) {
        fail(env.requestId, "CONFLICT", "a generation is still active in this worker");
        return;
      }
      if (env.executionGeneration === null || env.taskRunId === null || (state.gen.generation !== null && env.executionGeneration <= state.gen.generation)) {
        fail(env.requestId, "STALE_GENERATION", "task delivery must carry a newer admitted generation");
        return;
      }
      state.gen = freshGeneration(env.taskRunId, env.executionGeneration);
      emitWorkerEvent({ kind: "started", detail: {} });
      ack(env.requestId, { generation: state.gen.generation });
      await runPrompt(text);
      return;
    }
    fail(env.requestId, "INVALID", `unknown deliver mode ${String(payload.mode)}`);
  } catch (e) {
    fail(env.requestId, "INVALID", (e as Error).message);
  }
}

async function handleInterrupt(env: IpcEnvelope): Promise<void> {
  const session = state.session;
  if (!session || state.gen.settled) {
    ack(env.requestId, { idle: true });
    return;
  }
  state.gen.interruptRequested = true;
  try {
    // agent_settled fires before abort() resolves and reports `interrupted`.
    await session.abort();
    settleGeneration(null);
    ack(env.requestId, {});
  } catch (e) {
    fail(env.requestId, "INVALID", (e as Error).message);
  }
}

/**
 * Native-branch entry search for mailbox reconciliation. Checks the active
 * branch (not the compacted LLM projection): an entry retained in the
 * branch but summarized out of model context counts as present.
 */
function findMessageEntry(session: WorkerSession, messageId: string): string | null {
  for (const entry of session.sessionManager.getBranch()) {
    if (entry.type !== "custom_message") continue;
    if ((entry.details as { messageId?: unknown } | undefined)?.messageId === messageId) return entry.id;
  }
  return null;
}

function handleFindEntry(env: IpcEnvelope): void {
  const session = state.session;
  if (!session) {
    fail(env.requestId, "NOT_RUNNING", "no active session");
    return;
  }
  const messageId = (env.payload as { messageId?: unknown })?.messageId;
  if (typeof messageId !== "string" || !messageId) {
    fail(env.requestId, "INVALID", "find_entry requires messageId");
    return;
  }
  const entryId = findMessageEntry(session, messageId);
  ack(env.requestId, { found: entryId !== null, entryId });
}

function handleCheckpoint(env: IpcEnvelope): void {
  const session = state.session;
  if (!session) {
    fail(env.requestId, "NOT_RUNNING", "no active session");
    return;
  }
  // Capture at safe boundaries only. The leaf and the bytes are read in one
  // synchronous step, so no append can land between them; the SDK persists
  // without a barrier, so fsync before reading.
  if (session.isStreaming) {
    fail(env.requestId, "CONFLICT", "session streaming; checkpoint at the next settled boundary");
    return;
  }
  try {
    const leaf = session.sessionManager.getLeafId();
    const file = session.sessionManager.getSessionFile();
    if (!file || !existsSync(file)) {
      // Setup-only session pi has not materialized: reconstructible from
      // the durable bootstrap record; no file to checkpoint.
      ack(env.requestId, { leafEntryId: leaf, materialized: false });
      return;
    }
    const fd = openSync(file, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const bytes = readFileSync(file);
    if (bytes.length > CHECKPOINT_MAX_BYTES) {
      fail(env.requestId, "PAYLOAD_TOO_LARGE", "session file exceeds checkpoint cap");
      return;
    }
    // Bytes never cross the IPC channel (its payload cap is far smaller):
    // the supervisor reads the synchronized file and checks the digest.
    ack(env.requestId, { leafEntryId: leaf, materialized: true, sessionFile: file, byteCount: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  } catch (e) {
    fail(env.requestId, "INVALID", (e as Error).message);
  }
}

function handleToolResponse(envelope: IpcEnvelope): void {
  const pending = envelope.requestId ? state.pendingTools.get(envelope.requestId) : undefined;
  if (!pending) return;
  const payload = envelope.payload as { ok?: boolean; content?: string };
  pending.resolve({ content: String(payload?.content ?? ""), isError: payload?.ok !== true });
}

async function onMessage(raw: unknown): Promise<void> {
  if (!state.binding) {
    // First message must be the supervisor handshake carrying the binding.
    const e = raw as Record<string, unknown>;
    if (e?.["operation"] !== "__hello") return;
    const { rootEpoch, agentId, workerInstanceId } = e as { rootEpoch?: unknown; agentId?: unknown; workerInstanceId?: unknown };
    if (typeof rootEpoch !== "string" || typeof agentId !== "string" || typeof workerInstanceId !== "string") {
      process.exit(2);
    }
    state.binding = bindChannel(rootEpoch, agentId, workerInstanceId);
    send({ type: "event", operation: "ready", taskRunId: null, executionGeneration: null, payload: { piVersion: PI_VERSION, capabilities: CAPABILITIES } });
    return;
  }
  const asRecord = raw as Record<string, unknown>;
  if (asRecord["type"] === "response" && asRecord["operation"] === "tool.execute") {
    const checked = validateEnvelope(raw, state.binding, "to-worker");
    if (checked.ok) {
      handleToolResponse(checked.envelope);
    } else if (typeof asRecord["requestId"] === "string") {
      // An unusable answer still ends the call; it never waits for a timer.
      state.pendingTools.get(asRecord["requestId"])?.resolve({ content: `${checked.code}: ${checked.message}`, isError: true });
    }
    return;
  }
  const checked = validateEnvelope(raw, state.binding, "to-worker");
  if (!checked.ok) {
    const rid = asRecord?.["requestId"];
    fail(typeof rid === "string" ? rid : null, checked.code, checked.message);
    return;
  }
  const env = checked.envelope;
  switch (env.operation) {
    case "initialize":
      await handleInitialize(env);
      break;
    case "deliver":
      await handleDeliver(env);
      break;
    case "interrupt":
      await handleInterrupt(env);
      break;
    case "checkpoint":
      handleCheckpoint(env);
      break;
    case "find_entry":
      handleFindEntry(env);
      break;
    case "dispose":
      ack(env.requestId, {});
      process.disconnect?.();
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
