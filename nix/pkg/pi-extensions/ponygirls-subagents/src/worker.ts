/**
 * ponygirls-subagents — SDK worker process.
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
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { InitializePayload, IpcEnvelope, ProviderAdmissionResponse, WorkerEvent } from "./protocol.ts";
import { bindChannel, taskHeader, validateEnvelope, validateInitializePayload } from "./protocol.ts";
import type { Api, AssistantMessage, AssistantMessageEventStream, CredentialStore, Model, Provider, ProviderStreams, SimpleStreamOptions, TranscriptContext, Usage } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { CHILD_CONTROL_TOOLS, DELEGATION_TOOLS, RESULT_TEXT_MAX, childToolGuidelines, childToolSpec, type TypeBuilder } from "./tools.ts";
import { MAX_PAYLOAD_BYTES } from "./protocol.ts";
import { PROTOCOL_VERSION, type InstructionSet } from "./types.ts";
import type { ChannelBinding } from "./protocol.ts";
import type { DeterministicEntryObserver, InvocationScope } from "./deterministic.ts";
import { adaptStream, isFacadeLocalCompletion } from "./stream-facade.ts";
import { parentModelProvider, parseParentModel, parseProviderRequestAuth, type ParentModelProvider } from "./parent-models.ts";

const PI_VERSION = "1.0.0";
const CAPABILITIES = ["proxy-tools", "sequential", "checkpoint", "gate-decision", "control-tools"];
const TOOL_REQUEST_TIMEOUT_MS = 15 * 60_000;
const CHECKPOINT_MAX_BYTES = 16 * 1024 * 1024;
const PREVIEW_MAX = 2000;
const TERMINAL_ERROR_MAX_BYTES = 8 * 1024;
/** In-flight assistant text is forwarded at most this often (the transcript view shows it live). */
const STREAM_PREVIEW_INTERVAL_MS = 300;

interface PendingToolCall {
  resolve: (result: {
    content: string | Array<Record<string, unknown>>;
    details?: unknown;
    structuredContent?: unknown;
    usage?: unknown;
    isError: boolean;
  }) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** The execution generation currently owned by this worker. */
interface GenerationState {
  taskRunId: string | null;
  generation: number | null;
  interruptRequested: boolean;
  settled: boolean;
  /**
   * Finalization started (settle entered) but the snapshot not yet
   * published. Distinguishes "settling, still joining" from "published":
   * usage arriving during the join belongs to the snapshot (no late
   * receipt); only post-publication arrivals bill late. Guards re-entry
   * alongside settled.
   */
  finalizing: boolean;
  lastText: string;
  stopReason: string | null;
  errorMessage: string | null;
  /** `input` includes the cache tokens; `reasoning` is part of `output`, null until a provider reports it. */
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number | null; cost: number | null; unknown: boolean };
  /** When in-flight text was last forwarded. */
  previewAt: number;
  /** Usage observations owed by admitted provider requests; joined before settled publication. */
  pendingUsage: Array<Promise<void>>;
  /** Invocation-owned observation scopes created at provider ENTRY for this
   * generation (fault transport injected BEFORE ORIGINAL, drained at settle).
   * Owned by this generation object — never a shared registry. */
  observation: Array<InvocationScope>;
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
  const skills = set.skills.map((s) => ({ ...s, sourceInfo: { path: s.filePath, source: "ponygirls-subagents", scope: "temporary", origin: "top-level" } }));
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
  registerNativeProvider: (provider: Provider) => void;
  registerProvider: (id: string, config: Record<string, unknown>) => void;
  getModel: (provider: string, id: string) => Record<string, unknown> | undefined;
}

interface SessionManagerLike {
  getSessionFile: () => string | undefined;
  getLeafId: () => string | null;
  getBranch: () => Array<{ id: string; type: string; details?: unknown; provider?: string; modelId?: string; thinkingLevel?: string }>;
  appendModelChange: (provider: string, modelId: string) => string;
  appendThinkingLevelChange: (thinkingLevel: string) => string;
  branch: (branchFromId: string) => void;
}

interface WorkerSession {
  sessionId: string;
  readonly model: { provider: string; id: string };
  readonly thinkingLevel: string;
  readonly isCompacting?: boolean;
  agent: {
    toolExecution: string;
    subscribe?: (listener: (event: { type: string } & Record<string, unknown>) => unknown) => () => void;
    streamFunction: StreamFn;
  };
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
  pendingPreps: Map<string, PendingPreparation>;
  pendingAdmission: Map<string, PendingAdmission>;
  /** Single-flight preparation lease (the worker runs sequentially). */
  prepLease: PreparationLease | null;
  /** Prepared ticket of the in-flight call (sent with tool.execute). */
  openTicket: { tool: string; ticket: string } | null;
  /** Tickets prepared but never executed (released on end/abort/settle). */
  unreleasedTickets: string[];
  /** Names of generic external proxies (only these are ever prepared). */
  externalProxyNames: ReadonlySet<string>;
  /** Last assistant stopReason was length-truncation (skip preparation). */
  truncatedTurn: boolean;
  /** Observable lease-conflict counter (parallel preparation attempts). */
  prepConflicts: number;
  gen: GenerationState;
  /** Characters of a generation's final text handed to the supervisor. */
  resultLimit: number;
  /** This agent's directory under the supervisor's sessions root. */
  sessionDir: string | null;
  /** Configured ENTRY collector readiness (test tracer); null when unconfigured (production). */
  collector: { name: string; ready: boolean } | null;
  /** Compaction lifecycle trace path (test tracer, alongside collector); null when unconfigured. */
  lifecyclePath: string | null;
  /** Lifecycle tracing fault joined at settle (test tracer only); consumed per generation. */
  instrumentError: string | null;
} = {
  binding: null,
  session: null,
  sdk: null,
  seq: 0,
  pendingTools: new Map(),
  pendingPreps: new Map(),
  pendingAdmission: new Map(),
  prepLease: null,
  openTicket: null,
  unreleasedTickets: [],
  externalProxyNames: new Set(),
  truncatedTurn: false,
  prepConflicts: 0,
  gen: freshGeneration(null, null),
  resultLimit: RESULT_TEXT_MAX,
  sessionDir: null,
  collector: null as { name: string; ready: boolean } | null,
  lifecyclePath: null as string | null,
  instrumentError: null as string | null,
};

interface PendingPreparation {
  resolve: (result: { ok: boolean; ticket?: string; preparedArgs?: unknown; error?: string; unsupported?: boolean }) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface PendingAdmission {
  resolve: (result: ProviderAdmissionResponse) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  onAbort?: () => void;
  signal?: AbortSignal | undefined;
}

interface PreparationLease {
  toolCallId: string;
  tool: string;
  rawArgs: unknown;
  ticket: string | null;
  preparedArgs: unknown;
  error: string | null;
  /** Transport failure (timeout/rejected envelope): peer predates the op. */
  unsupported: boolean;
  ready: boolean;
}

/** Test-driver request identity for the deterministic provider latch (own process, per generation). */
function setRequestIdentityEnv(taskRunId: string | null, generation: number | null): void {
  if (typeof taskRunId === "string" && taskRunId.length > 0) {
    process.env["PI_SUBAGENTS_TASK_RUN_ID"] = taskRunId;
  } else {
    delete process.env["PI_SUBAGENTS_TASK_RUN_ID"];
  }
  if (typeof generation === "number" && Number.isInteger(generation) && generation >= 0) {
    process.env["PI_SUBAGENTS_EXECUTION_GENERATION"] = String(generation);
  } else {
    delete process.env["PI_SUBAGENTS_EXECUTION_GENERATION"];
  }
  const agentId: unknown = state.binding === null ? null : state.binding.agentId;
  if (typeof agentId === "string" && agentId.length > 0) {
    process.env["PI_SUBAGENTS_AGENT_ID"] = agentId;
  } else {
    delete process.env["PI_SUBAGENTS_AGENT_ID"];
  }
}

function freshGeneration(taskRunId: string | null, generation: number | null): GenerationState {
  return { taskRunId, generation, interruptRequested: false, settled: false, finalizing: false, lastText: "", stopReason: null, errorMessage: null, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: null, cost: null, unknown: false }, previewAt: 0, pendingUsage: [], observation: [] };
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

/** Attribute one physically admitted provider result to its captured generation exactly once.
 * Every required Usage field must be present and finite; anything less marks
 * unknown with no partial fabrication (no invented zeros for absent fields). */
function isFullUsageShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const usage = value as Record<string, unknown>;
  const finite = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!finite(usage["input"]) || !finite(usage["output"]) || !finite(usage["cacheRead"]) || !finite(usage["cacheWrite"]) || !finite(usage["totalTokens"])) return false;
  const cost: unknown = usage["cost"];
  if (typeof cost !== "object" || cost === null) return false;
  const rec: Record<string, unknown> = cost as Record<string, unknown>;
  if (!finite(rec["input"]) || !finite(rec["output"]) || !finite(rec["cacheRead"]) || !finite(rec["cacheWrite"]) || !finite(rec["total"])) return false;
  const reasoning: unknown = usage["reasoning"];
  if (reasoning !== undefined && reasoning !== null && !finite(reasoning)) return false;
  return true;
}

function accountResultUsage(gen: GenerationState, message: AssistantMessage): { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number | null; cost: number | null; unknown: boolean } | null {
  if (accountedUsageMessages.has(message)) return null;
  const usage: Usage = message.usage;
  // Shared full-shape gate (also used by message_end): malformed usage marks
  // unknown without fabrication, and never joins the accounted set through
  // this path — but message_end applies the same gate, so malformed usage
  // stays unsummed everywhere.
  if (!isFullUsageShape(usage)) {
    gen.usage.unknown = true;
    return null;
  }
  const input = usage.input as number;
  const output = usage.output as number;
  const cacheRead = usage.cacheRead as number;
  const cacheWrite = usage.cacheWrite as number;
  const costTotal = (usage.cost as unknown as Record<string, unknown>)["total"] as number;
  const reasoning: unknown = (usage as unknown as Record<string, unknown>)["reasoning"];
  accountedUsageMessages.add(message);
  gen.usage.input += input + cacheRead + cacheWrite;
  gen.usage.cacheRead += cacheRead;
  gen.usage.cacheWrite += cacheWrite;
  gen.usage.output += output;
  gen.usage.cost = (gen.usage.cost ?? 0) + costTotal;
  // Reasoning is part of output, reported apart: absent stays null (never
  // zero), a reported breakdown accumulates like every other counter.
  if (typeof reasoning === "number") gen.usage.reasoning = (gen.usage.reasoning ?? 0) + reasoning;
  return { input: input + cacheRead + cacheWrite, output, cacheRead, cacheWrite, reasoning: typeof reasoning === "number" ? reasoning : null, cost: costTotal, unknown: false };
}

/**
 * Direct ORIGINAL-only usage observation for paths where no facade
 * observation exists (adapter rejection): accounts a valid raw result
 * (or marks unknown), emitting the standard late receipt when the
 * generation already settled. Fire-and-forget by design (never joins
 * settle); exactly-once via the shared accounted set.
 */
function observeRawUsageOnly(gen: GenerationState, taskRunId: unknown, generation: unknown, raw: AssistantMessageEventStream): void {
  const capturedAgentId: unknown = state.binding === null ? null : state.binding.agentId;
  // Immutable per-invocation receipt ID: identifies this admitted result
  // through emission, retained obligations, durable records and dedupe —
  // generation identity alone cannot distinguish two late results in one
  // generation, nor keep a retry from overwriting a sibling payload.
  const receiptId: string = randomUUID();
  let src: Promise<AssistantMessage>;
  try {
    src = raw.result();
  } catch (resultError: unknown) {
    gen.usage.unknown = true;
    const detail = resultError instanceof Error ? resultError.message : String(resultError);
    process.stderr.write(`PROVIDER_USAGE_OBSERVATION_FAILED: taskRunId=${String(taskRunId)} generation=${String(generation)}: ${detail}\n`);
    return;
  }
  void src.then(
    (message: AssistantMessage | undefined) => {
      if (message === undefined || typeof message !== "object" || message === null) {
        gen.usage.unknown = true;
        process.stderr.write(`PROVIDER_USAGE_OBSERVATION_FAILED: taskRunId=${String(taskRunId)} generation=${String(generation)}: stream ended without an assistant message\n`);
        return;
      }
      const added = accountResultUsage(gen, message);
      if (added !== null && gen.settled) emitLateUsageReceipt(capturedAgentId, taskRunId, generation, receiptId, added);
    },
    (error: unknown) => {
      gen.usage.unknown = true;
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`PROVIDER_USAGE_OBSERVATION_FAILED: taskRunId=${String(taskRunId)} generation=${String(generation)}: ${detail}\n`);
    },
  );
}

/**
 * Exactly-once late usage receipt for a genuine ORIGINAL outcome that
 * arrives after its generation already settled: published as a
 * first-class `usage_late` worker event under the captured
 * (agent, task, generation) identity so the supervisor ledger bills it
 * instead of retiring it silently. Only the arrival that performs the
 * accounting emits (set-deduped, post-settle only).
 */
function emitLateUsageReceipt(agentId: unknown, taskRunId: unknown, generation: unknown, receiptId: string, added: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number | null; cost: number | null; unknown: boolean }): void {
  send({
    type: "event",
    operation: "event",
    payload: {
      kind: "usage_late",
      taskRunId: state.gen.taskRunId,
      executionGeneration: state.gen.generation,
      detail: { usage: { ...added }, taskRunId, generation, agentId, receiptId, late: true },
    },
  });
}

/**
 * Exactly-once worker-side usage accounting across the guard's stream-result
 * observation and the agent message_end event: both observe the same
 * provider-pushed terminal message object (the pump relays identical event
 * objects to iteration and result), so whichever accounts first wins and the
 * other skips. Unobserved paths still sum through message_end (never silently
 * dropped); multi-turn requests carry distinct message objects. Invalid
 * shapes still mark unknown through the observation without joining the set,
 * leaving the lenient message_end fallback intact.
 */
const accountedUsageMessages = new WeakSet<object>();

/** Observe one admitted stream's terminal result without consuming its events. */
/**
 * Observe one admitted provider invocation for usage accounting and public
 * completion, separating truthful once-owned ORIGINAL accounting from
 * consumer mutation/public completion:
 * - usage is accounted from the RAW provider result (the once-owned ORIGINAL
 *   outcome): a valid provider message is accounted exactly once however the
 *   public completion settles, and a consumer-side facade-local completion
 *   (push/end) can never be billed through this path;
 * - public completion is joined from the ADAPTED facade result: its
 *   rejection (joined pump/iteration failure) marks unknown and lets settle
 *   proceed without hanging on a never-reporting provider;
 * - when the facade completes first with the provider still silent, the raw
 *   observation gets one scheduling bound for a tardy provider, then retires
 *   to unknown (never an indefinite wait); a later-arriving genuine outcome
 *   still accounts into the generation (post-settle invisibility stated as
 *   residual).
 * Calling result() (shared promise) never competes with the single owned
 * pump iterator. Sync-throw containment keeps raw observation inert.
 */
function observeStreamResult(
  gen: GenerationState,
  taskRunId: unknown,
  generation: unknown,
  facade: AssistantMessageEventStream,
  raw?: AssistantMessageEventStream,
): void {
  if (raw === undefined) {
    // Local-only stream (admission-denial path): no provider ORIGINAL
    // exists, so the single adapted observation stands as before.
    const observation: Promise<void> = facade.result().then(
      (message: AssistantMessage | undefined) => {
        if (message === undefined || typeof message !== "object" || message === null) {
          gen.usage.unknown = true;
          process.stderr.write(`PROVIDER_USAGE_OBSERVATION_FAILED: taskRunId=${String(taskRunId)} generation=${String(generation)}: stream ended without an assistant message\n`);
          return;
        }
        accountResultUsage(gen, message);
      },
      (error: unknown) => {
        gen.usage.unknown = true;
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`PROVIDER_USAGE_OBSERVATION_FAILED: taskRunId=${String(taskRunId)} generation=${String(generation)}: ${detail}\n`);
      },
    );
    gen.pendingUsage.push(observation);
    return;
  }
  const capturedAgentId: unknown = state.binding === null ? null : state.binding.agentId;
  // Immutable per-invocation receipt ID (see observeRawUsageOnly): one ID
  // per observed admitted stream, carried into any late receipt.
  const receiptId: string = randomUUID();
  let rawSettled = false;
  const usageObservation: Promise<void> = ((): Promise<void> => {
    let src: Promise<AssistantMessage>;
    try {
      src = raw.result();
    } catch (resultError: unknown) {
      rawSettled = true;
      gen.usage.unknown = true;
      const detail = resultError instanceof Error ? resultError.message : String(resultError);
      process.stderr.write(`PROVIDER_USAGE_OBSERVATION_FAILED: taskRunId=${String(taskRunId)} generation=${String(generation)}: ${detail}\n`);
      return Promise.resolve();
    }
    return src.then(
      (message: AssistantMessage | undefined) => {
        rawSettled = true;
        if (message === undefined || typeof message !== "object" || message === null) {
          gen.usage.unknown = true;
          process.stderr.write(`PROVIDER_USAGE_OBSERVATION_FAILED: taskRunId=${String(taskRunId)} generation=${String(generation)}: stream ended without an assistant message\n`);
          return;
        }
        const added = accountResultUsage(gen, message);
        // Post-settlement arrival: the settled snapshot already published
        // without this outcome, so emit an exactly-once late receipt under
        // the captured identity instead of mutating the old generation
        // invisibly. The accounted set guarantees this arrival is the one
        // that billed (never a duplicate of the settled snapshot).
        if (added !== null && gen.settled) emitLateUsageReceipt(capturedAgentId, taskRunId, generation, receiptId, added);
      },
      (error: unknown) => {
        rawSettled = true;
        gen.usage.unknown = true;
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`PROVIDER_USAGE_OBSERVATION_FAILED: taskRunId=${String(taskRunId)} generation=${String(generation)}: ${detail}\n`);
      },
    );
  })();
  const completionObservation: Promise<void> = facade.result().then(
    () => {
      // Facade completed (possibly via consumer-local push/end) while the
      // provider stays silent: one scheduling bound for a tardy provider,
      // then retire to unknown instead of hanging settle.
      if (rawSettled) return Promise.resolve();
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!rawSettled) gen.usage.unknown = true;
          resolve();
        }, 0);
      });
    },
    (error: unknown) => {
      gen.usage.unknown = true;
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`PROVIDER_USAGE_OBSERVATION_FAILED: taskRunId=${String(taskRunId)} generation=${String(generation)}: ${detail}\n`);
    },
  );
  gen.pendingUsage.push(Promise.race([usageObservation, completionObservation]));
}

function boundedTerminalError(error: string | null): string | null {
  if (error === null || Buffer.byteLength(JSON.stringify(error), "utf8") <= TERMINAL_ERROR_MAX_BYTES) return error;
  const marker = `\n[truncated terminal error: ${Buffer.byteLength(error, "utf8")} UTF-8 bytes total]`;
  const budget = TERMINAL_ERROR_MAX_BYTES - Buffer.byteLength(JSON.stringify(marker), "utf8");
  let bytes = 0;
  let end = 0;
  // JSON escaping can expand one code point to six bytes; never split a surrogate pair.
  for (const point of error) {
    const size = Buffer.byteLength(JSON.stringify(point), "utf8") - 2;
    if (bytes + size > budget) break;
    bytes += size;
    end += point.length;
  }
  return error.slice(0, end) + marker;
}

/** Publish the current generation's single outcome after joining usage observations. */
async function settleGeneration(failure: string | null): Promise<void> {
  const gen = state.gen;
  if (gen.settled || gen.finalizing) return;
  gen.finalizing = true;
  const pending = gen.pendingUsage.splice(0);
  let observationError: string | null = null;
  for (const observation of pending) {
    try {
      await observation;
    } catch (joinError: unknown) {
      gen.usage.unknown = true;
      const detail = joinError instanceof Error ? joinError.message : String(joinError);
      const entry = `usage observation join failed: ${detail}`;
      observationError = observationError === null ? entry : `${observationError}; ${entry}`;
    }
  }
  let driverError: string | null = null;
  if (typeof gen.taskRunId === "string" && typeof gen.generation === "number") {
    try {
      // Drain this generation's OWN invocation scopes (injected at provider
      // ENTRY, owned by this generation object). Every primary/secondary
      // cause is preserved with explicit String() presence — truthiness must
      // never drop empty/false/null/undefined details, and no first-only
      // drain may drop later matching faults. Drained scopes are retired so
      // no fault survives into a later request.
      const parts: string[] = [];
      for (const scope of gen.observation.splice(0)) {
        for (const fault of scope.faults.splice(0)) {
          parts.push(
            `summary usage observation failed at turn ${String(fault.turn)} (${String(fault.kind)}): ${String(fault.error)}`,
          );
        }
      }
      if (parts.length > 0) driverError = parts.join("; ");
    } catch (drainError: unknown) {
      const detail = drainError instanceof Error ? drainError.message : String(drainError);
      driverError = `observation channel unreadable: ${detail}`;
    }
  }
  const instrumentError: string | null = state.instrumentError;
  state.instrumentError = null;
  // Usage-observation join failures are public causes like any other
  // secondary fault: they join the combined failure instead of being
  // collected and dropped.
  const secondary = [observationError, driverError, instrumentError].filter((part): part is string => part !== null).join("; ");
  const combinedFailure: string | null =
    failure !== null && secondary.length > 0
      ? `${failure}; ${secondary}`
      : failure ?? (secondary.length > 0 ? secondary : null);
  const status = combinedFailure !== null
    ? "failed"
    : gen.interruptRequested || gen.stopReason === "aborted"
      ? "interrupted"
      : gen.stopReason === "error"
        ? "failed"
        : "succeeded";
  const error = boundedTerminalError(combinedFailure ?? (status === "failed" ? gen.errorMessage ?? "provider error" : null));
  // Text beyond the inline bound travels as a file; `textLength` lets the
  // supervisor state any cut (at the limit, or after a failed handoff).
  const retained = gen.lastText.slice(0, state.resultLimit);
  let resultFile: ResultFile | null = null;
  let resultFileError: string | null = null;
  if (retained.length > RESULT_TEXT_MAX) {
    try {
      resultFile = writeResultFile(gen, retained);
    } catch (e) {
      resultFileError = (e as Error).message;
    }
  }
  // Snapshot publication is atomic with the settled mark (single
  // thread): arrivals before this point joined the snapshot above and
  // emit no receipt; arrivals after it bill late. Never split them.
  gen.settled = true;
  emitWorkerEvent({
    kind: "settled",
    detail: { status, error, lastAssistantText: retained.slice(0, RESULT_TEXT_MAX), textLength: gen.lastText.length, resultFile, resultFileError, usage: { ...gen.usage } },
  });
}

interface ResultFile {
  path: string;
  byteCount: number;
  sha256: string;
}

/**
 * The retained final text as a synchronized file in this agent's session
 * directory: it never crosses the IPC channel (its payload cap is far
 * smaller); the supervisor reads the file and checks the digest.
 */
function writeResultFile(gen: GenerationState, text: string): ResultFile {
  if (state.sessionDir === null) throw new Error("no session directory for the result file");
  mkdirSync(state.sessionDir, { recursive: true });
  const path = join(state.sessionDir, `result-${gen.taskRunId}-${gen.generation}.txt`);
  const bytes = Buffer.from(text, "utf8");
  writeFileSync(path, bytes);
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return { path, byteCount: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
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

async function loadCompat(): Promise<{
  InMemoryCredentialStore: new () => CredentialStore;
  getApiProvider: (api: string) => ProviderStreams | undefined;
  EventStream: new (isTerminal: (e: { type: string }) => boolean, getResult: (e: { type: string; message?: unknown; error?: unknown }) => unknown) => { push: (e: unknown) => void };
  createAssistantMessageEventStream: () => import("@earendil-works/pi-ai").AssistantMessageEventStream;
}> {
  return (await import(`file://${sdkRoot()}/node_modules/@earendil-works/pi-ai/dist/compat.js`)) as {
    InMemoryCredentialStore: new () => CredentialStore;
    getApiProvider: (api: string) => ProviderStreams | undefined;
    EventStream: new (isTerminal: (e: { type: string }) => boolean, getResult: (e: { type: string; message?: unknown; error?: unknown }) => unknown) => { push: (e: unknown) => void };
    createAssistantMessageEventStream: () => import("@earendil-works/pi-ai").AssistantMessageEventStream;
  };
}

function parseScriptSteps(): Array<{ kind: "text"; text: string; usage?: unknown; delayMs?: unknown } | { kind: "tool"; name: string; args: Record<string, unknown>; usage?: unknown; delayMs?: unknown } | { kind: "error"; message: string }> {
  const raw = process.env["PI_SUBAGENTS_SCRIPT"];
  if (!raw) return [{ kind: "text", text: "worker result" }];
  const steps = JSON.parse(raw) as Array<{ text?: string; repeat?: number; tool?: string; args?: Record<string, unknown>; error?: string; usage?: unknown; delayMs?: unknown }>;
  return steps.map((step) => {
    if (step.tool) return { kind: "tool" as const, name: step.tool, args: step.args ?? {}, ...(step.usage !== undefined ? { usage: step.usage } : {}), ...(step.delayMs !== undefined ? { delayMs: step.delayMs } : {}) };
    if (step.error) return { kind: "error" as const, message: step.error };
    // `repeat` scripts a text larger than an environment variable can carry.
    return { kind: "text" as const, text: (step.text ?? "worker result").repeat(step.repeat ?? 1), ...(step.usage !== undefined ? { usage: step.usage } : {}), ...(step.delayMs !== undefined ? { delayMs: step.delayMs } : {}) };
  });
}

/** Headroom for the envelope around tool arguments in one IPC frame. */
const ENVELOPE_HEADROOM_BYTES = 8 * 1024;
/** Preparation-only RPC must stay fast (no execution happens server-side).
 * Sync CPU-only work supervisor-side; execution keeps its own budgets. */
const PREPARE_TIMEOUT_MS = 10_000;
/** Provider-admission query must never hang a provider request: fail closed
 * with a visible routing error on timeout (never an indefinitely unresolved
 * RPC, never silent allow). Parent credential resolution stays outside the controller chain. */
const ADMISSION_TIMEOUT_MS = 10_000;

/**
 * Whether a tool_execution_start event must skip supervisor preparation:
 * length-truncated turns fail every call before execution anyway, so no
 * preparation lease is opened for them (the sync prepare then fails open to
 * the raw args and normal validation decides).
 */
export function shouldSkipPreparation(stopReason: string | null | undefined): boolean {
  return stopReason === "length";
}
/** Control tools are bounded by the supervisor (wait timeouts, lease queues), not by a worker timer. */
const SUPERVISOR_BOUNDED_TOOLS: ReadonlySet<string> = new Set([...CHILD_CONTROL_TOOLS, ...DELEGATION_TOOLS]);

/**
 * Ask the supervisor to prepare (parent prepareArguments + public schema
 * validation, no execution) and cache the actual prepared value for the sync
 * proxy prepareArguments below. Never throws: failures become cached errors
 * that the sync prepare rethrows as normal SDK validation errors.
 */
function requestPreparation(toolName: string, toolCallId: string, args: unknown): Promise<{ ok: boolean; ticket?: string; preparedArgs?: unknown; error?: string; unsupported?: boolean }> {
  return new Promise((resolve) => {
    const requestId = randomUUID();
    const finish = (result: { ok: boolean; ticket?: string; preparedArgs?: unknown; error?: string; unsupported?: boolean }): void => {
      const pending = state.pendingPreps.get(requestId);
      if (!pending) return;
      if (pending.timer) clearTimeout(pending.timer);
      state.pendingPreps.delete(requestId);
      resolve(result);
    };
    // A timeout is a hard preparation failure (invalid/stale): it must not
    // silently downgrade to the legacy unticketed path (which would reprepare
    // and execute). Only an explicit peer UNSUPPORTED (predating tool.prepare)
    // ever downgrades; explicit ok:false denials stay hard and never downgrade.
    const timer = setTimeout(() => finish({ ok: false, error: `tool ${toolName} preparation timed out` }), PREPARE_TIMEOUT_MS);
    state.pendingPreps.set(requestId, { resolve: finish as PendingPreparation["resolve"], timer });
    send({
      type: "request",
      operation: "tool.prepare",
      requestId,
      payload: { tool: toolName, args: (args ?? {}) as Record<string, unknown>, toolCallId },
    });
  });
}

/**
 * Narrow per-request provider admission query (fail-closed permission).
 * Sends the admitted original model identity + SDK reason; envelope carries
 * channel-owned taskRun/generation fences automatically via send().
 * Timeout denies visibly (never hangs, never silent allow); signal abort
 * denies with abort error and joins cleanup (listener removed on settle).
 */
function requestProviderAdmission(
  reason: string,
  provider: string,
  modelId: string,
  thinkingLevel: string,
  signal?: AbortSignal,
): Promise<ProviderAdmissionResponse> {
  return new Promise((resolve) => {
    const requestId = randomUUID();
    const finish = (result: ProviderAdmissionResponse): void => {
      const pending = state.pendingAdmission.get(requestId);
      if (!pending) return;
      if (pending.timer) clearTimeout(pending.timer);
      if (pending.onAbort && pending.signal) pending.signal.removeEventListener("abort", pending.onAbort);
      state.pendingAdmission.delete(requestId);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, code: "TIMEOUT", error: `TIMEOUT: provider admission timed out waiting for the supervisor` }), ADMISSION_TIMEOUT_MS);
    let onAbort: (() => void) | undefined;
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        resolve({ ok: false, code: "NOT_RUNNING", error: "NOT_RUNNING: provider admission aborted" });
        return;
      }
      onAbort = (): void => finish({ ok: false, code: "NOT_RUNNING", error: "NOT_RUNNING: provider admission aborted" });
      signal.addEventListener("abort", onAbort, { once: true });
    }
    state.pendingAdmission.set(requestId, { resolve: finish, timer, onAbort, signal });
    send({
      type: "request",
      operation: "provider.admission",
      requestId,
      payload: { reason, provider, modelId, thinkingLevel },
    });
  });
}

/**
 * PUBLIC sync prepareArguments for a generic external proxy: consumes the
 * ACTUAL cached prepared value populated by the awaited agent-subscriber
 * listener (never a dummy), or throws the ACTUAL cached error. Both surface
 * as normal SDK validation results downstream — never as unhandled throws.
 * A missed lease (truncated turns, races) fails open to the raw args so
 * normal validation decides; it never invents prepared values.
 */
function makeProxyPrepare(toolName: string): (args: unknown) => unknown {
  return (args: unknown) => {
    const lease = state.prepLease;
    if (!lease || lease.tool !== toolName || lease.rawArgs !== args) {
      return args;
    }
    state.prepLease = null;
    // Explicit tool.prepare UNSUPPORTED is a hard error with cleanup (never
    // a silent legacy downgrade to unticketed execute). A missed lease
    // (truncated turns, races, no preparation attempted) still fails open to
    // raw args above; an attempted preparation that did not succeed throws.
    if (lease.unsupported) throw new Error(lease.error ?? `tool ${toolName} preparation unsupported`);
    if (lease.error !== null) throw new Error(lease.error);
    // The open ticket travels with this exact invocation to tool.execute;
    // validation/hook blocks, aborts, and settlement release it (below).
    if (lease.ticket !== null) {
      state.openTicket = { tool: toolName, ticket: lease.ticket };
      state.unreleasedTickets.push(lease.ticket);
    }
    return lease.preparedArgs;
  };
}

/** Release prepared tickets the worker dropped (blocks, aborts, settlement). */
function releaseUnreleasedTickets(): void {
  const tickets = state.unreleasedTickets.splice(0);
  state.openTicket = null;
  if (tickets.length === 0) return;
  send({ type: "request", operation: "tool.ticket-release", requestId: randomUUID(), payload: { tickets } });
}

/**
 * Agent-level subscription (NOT session.subscribe): AgentCore emits AND
 * awaits tool_execution_start BEFORE sync prepareToolCallArguments and
 * schema validation, which is the only supported seam to defer proxy
 * execution validation to parent preparation while preserving the actual
 * MODEL-declared schemas. The listener prepares ONLY generic external
 * proxies (never native/control tools) via a preparation-only RPC; the sync
 * proxy prepareArguments above then consumes the cached actual value.
 */
function subscribeAgentPreparations(
  agent: { subscribe?: (listener: (event: { type: string } & Record<string, unknown>) => unknown) => () => void },
  externalNames: ReadonlySet<string>,
): void {
  if (typeof agent.subscribe !== "function") return;
  agent.subscribe((event: { type: string } & Record<string, unknown>) => {
    if (event["type"] === "turn_start") {
      state.truncatedTurn = false;
      return undefined;
    }
    if (event["type"] === "message_end") {
      const message = event["message"] as { role?: string; stopReason?: string } | undefined;
      if (message?.role === "assistant" && typeof message.stopReason === "string") {
        state.truncatedTurn = shouldSkipPreparation(message.stopReason);
      }
      return undefined;
    }
    if (event["type"] === "tool_execution_end" || event["type"] === "agent_settled") {
      // Validation/hook blocks, aborts, and settlement drop prepared tickets
      // the worker never executed (released best-effort; supervisor purges).
      state.prepLease = null;
      releaseUnreleasedTickets();
      if (event["type"] === "agent_settled") state.truncatedTurn = false;
      return undefined;
    }
    if (event["type"] !== "tool_execution_start") return undefined;
    const toolName = event["toolName"];
    if (typeof toolName !== "string" || !externalNames.has(toolName)) return undefined;
    if (state.truncatedTurn || shouldSkipPreparation((event as { stopReason?: string })["stopReason"])) return undefined;
    const toolCallId = typeof event["toolCallId"] === "string" ? (event["toolCallId"] as string) : randomUUID();
    const rawArgs = (event as { args?: unknown })["args"] ?? {};
    // Single-flight lease: the worker runs sequentially, so at most one
    // preparation is outstanding. A second overlapping start cannot safely
    // share the lease (same-tool parallel calls with shared raw-arg refs
    // would cross-wire identities), so it is counted and skipped — that
    // call fails open to normal validation, never to another call's values.
    if (state.prepLease !== null) {
      state.prepConflicts++;
      return undefined;
    }
    const lease: PreparationLease = { toolCallId, tool: toolName, rawArgs, ticket: null, preparedArgs: null, error: null, unsupported: false, ready: false };
    state.prepLease = lease;
    return (async () => {
      try {
        const res = await requestPreparation(toolName, toolCallId, rawArgs);
        // Stale lease (cleaned by end/abort/settle while awaiting): drop.
        if (state.prepLease !== lease) return;
        if ("unsupported" in res && (res as { unsupported?: boolean }).unsupported === true) {
          lease.unsupported = true;
        } else if ("error" in res) {
          lease.error = String((res as { error: unknown }).error ?? "preparation failed");
        } else {
          lease.ticket = (res as { ticket: string }).ticket;
          lease.preparedArgs = (res as { preparedArgs: unknown }).preparedArgs;
        }
      } catch (e) {
        if (state.prepLease === lease) lease.error = (e as Error).message ?? "preparation failed";
      } finally {
        lease.ready = true;
      }
    })();
  });
}

/**
 * PUBLIC streamFunction guard (fail-closed per-request provider admission).
 * Decorates the session agent's PUBLIC mutable `streamFunction` field (no
 * private `_stream*`, no provider-registry replacement, no model
 * substitution): captures the original, awaits a narrow Supervisor admission
 * query immediately BEFORE invoking the original with the same
 * model/context/options (receiver preserved). Covers every worker-supported
 * path the agent routes through this function (main loop, continuations,
 * retries, both compaction halves, direct helpers using streamFn).
 * Denial returns a contract-compliant error stream (stopReason error +
 * visible hold code, zeroed usage) — never throws/rejects (StreamFn must
 * return a stream), never hangs (timeout fail-closed), never silent.
 * Already-admitted inflight settles truthfully (its admission passed
 * pre-hold). Missing field fails loudly (never optional skip).
 */
/**
 * Test-only ORIGINAL-result-mutation seam (narrow, env-gated). Delegates to
 * the captured pre-guard original with identical receiver/arguments, then
 * maps the single armed result() to a malformed Usage (negative input or
 * dropped totalTokens) to prove malformed-usage handling end to end.
 * Async iteration, events, auth, discovery and all other calls pass through
 * a transparent Proxy untouched.
 */
function installOriginalMutateWrapper(session: WorkerSession, mutateRaw: unknown): void {
  if (mutateRaw !== "negative-input" && mutateRaw !== "drop-totaltokens") {
    throw new Error(`INVALID: PI_SUBAGENTS_ORIGINAL_MUTATE_RESULT must be "negative-input" or "drop-totaltokens" (got ${String(mutateRaw)})`);
  }
  const mode: "negative-input" | "drop-totaltokens" = mutateRaw;
  const agent = session.agent;
  if (typeof agent.streamFunction !== "function") {
    throw new Error("MODEL_UNAVAILABLE: session agent has no supported streamFunction (pinned SDK 1.1.0 required)");
  }
  const preGuardOriginal: StreamFn = agent.streamFunction;
  let armed = true;
  const mutateWrapper: StreamFn = async function (
    this: unknown,
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): Promise<AssistantMessageEventStream> {
    const stream: AssistantMessageEventStream = await (Reflect.apply(preGuardOriginal, this, [model, context, options]) as ReturnType<StreamFn>);
    if (!armed) return stream;
    armed = false;
    return new Proxy(stream, {
      get(target: AssistantMessageEventStream, property: string | symbol, _receiver: unknown): unknown {
        if (property === "result") {
          return async (): Promise<AssistantMessage> => {
            const message: AssistantMessage = await target.result();
            if (mode === "negative-input") {
              return { ...message, usage: { ...message.usage, input: -5 } };
            }
            // Intentionally malformed test payload (dropped required field);
            // the guard must mark unknown, never fabricate.
            const usage: Record<string, unknown> = { ...message.usage };
            delete usage["totalTokens"];
            return { ...message, usage: usage as unknown as Usage };
          };
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  agent.streamFunction = mutateWrapper;
}

/**
 * Test-only ORIGINAL end-without-result seam (narrow, env-gated). Returns a
 * real public AssistantMessageEventStream (same constructor the guard uses)
 * ended bare with no terminal event and no result, mirroring a producer that
 * finishes iteration without ever settling a message. The returned result()
 * races the request AbortSignal so an OWNED abort (test-driven public
 * interrupt) joins it visibly; without an abort nothing settles, which the
 * owned test proves as RED before asserting the joined abort outcome.
 * Iteration, auth, discovery and all non-result paths stay native: the agent
 * loop iterates the real stream to EOF by itself.
 */
async function installOriginalEndBareWrapper(session: WorkerSession): Promise<void> {
  const agent = session.agent;
  if (typeof agent.streamFunction !== "function") {
    throw new Error("MODEL_UNAVAILABLE: session agent has no supported streamFunction (pinned SDK 1.1.0 required)");
  }
  const compat = await loadCompat();
  if (typeof compat.createAssistantMessageEventStream !== "function") {
    throw new Error("MODEL_UNAVAILABLE: pinned SDK has no supported createAssistantMessageEventStream (pinned SDK 1.1.0 required)");
  }
  const createStream = compat.createAssistantMessageEventStream;
  const endBareWrapper: StreamFn = function (
    this: unknown,
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): ReturnType<StreamFn> {
    void model;
    void context;
    const signal: AbortSignal | undefined = options?.signal;
    const stream: AssistantMessageEventStream = createStream();
    stream.end();
    const abortPromise = new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => {
        reject(new Error("WORKER_ORIGINAL_END_BARE_ABORT_JOIN"));
      };
      if (signal === undefined) return;
      if (signal.aborted === true) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return new Proxy(stream, {
      get(target: AssistantMessageEventStream, property: string | symbol, _receiver: unknown): unknown {
        if (property === "result") {
          return (): Promise<AssistantMessage> => Promise.race([target.result(), abortPromise]);
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  agent.streamFunction = endBareWrapper;
}

/**
 * Test-only ORIGINAL-fault seam (narrow, env-gated, off unless requested).
 * Wraps the PUBLIC `session.agent.subscribe` with a transparent delegate
 * (receiver, arguments and return value unchanged) and instruments the PUBLIC
 * `session.agent.streamFunction` data field immediately — synchronously here,
 * before the guard captures it — because the SDK calls agent.subscribe only
 * once, inside the AgentSession constructor, before the worker ever sees the
 * session. The fault wrapper delegates every call to the captured pre-guard
 * original with identical receiver/arguments; only the single armed call
 * throws synchronously or rejects asynchronously. The guard therefore
 * observes a genuine ORIGINAL failure through its normal path (marks
 * captured-generation unknown, rethrows for visible settlement).
 */
/**
 * Test-only ORIGINAL iterator-access-throw seam (narrow, env-gated, off
 * unless requested). The single armed streamFunction call returns a stream
 * whose result() resolves a VALID nonzero message while its
 * Symbol.asyncIterator property getter throws synchronously. The adapter
 * therefore rejects before any pump exists, while the ORIGINAL result stays
 * valid: the guard must fail the turn visibly yet retain the genuine
 * Usage through direct raw observation (settled snapshot and/or exactly one
 * late receipt), never silently dropping it for lack of a facade.
 */
function installOriginalIteratorAccessThrowWrapper(session: WorkerSession): void {
  const agent = session.agent;
  if (typeof agent.streamFunction !== "function") {
    throw new Error("MODEL_UNAVAILABLE: session agent has no supported streamFunction (pinned SDK 1.1.0 required)");
  }
  const preGuardOriginal: StreamFn = agent.streamFunction;
  let armed = true;
  const accessThrowWrapper: StreamFn = function (
    this: unknown,
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): ReturnType<StreamFn> {
    if (!armed) return Reflect.apply(preGuardOriginal, this, [model, context, options]) as ReturnType<StreamFn>;
    armed = false;
    void model;
    void context;
    void options;
    const validMessage: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "original-access-throw-text" }],
      api: "openai-responses",
      // Test seam literals matching SIM_PROVIDER/SIM_MODEL (no import
      // graph change for a test-only path).
      provider: "test-sim",
      model: "sim-1",
      usage: { input: 11, output: 6, cacheRead: 7, cacheWrite: 8, totalTokens: 32, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 5 } },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    return {
      result: () => Promise.resolve(validMessage),
      get [Symbol.asyncIterator]() {
        throw new Error("WORKER_ORIGINAL_ITERATOR_ACCESS_THROW at Symbol.asyncIterator");
      },
    } as unknown as AssistantMessageEventStream;
  };
  agent.streamFunction = accessThrowWrapper;
}

/**
 * Test-only ORIGINAL end-with-result seam (narrow, env-gated, off unless
 * requested): the single armed streamFunction call returns a REAL public
 * SDK stream ended with the caller-supplied message and no terminal event
 * — exactly what a provider end(message) completion produces. The guard
 * adapts it normally; the turn must complete publicly with the identical
 * message and full Usage (never withhold a clean ORIGINAL end).
 * Malformed configuration fails loudly here, never silently ignored.
 */
async function installOriginalEndWithResultWrapper(session: WorkerSession, raw: unknown): Promise<void> {
  let message: AssistantMessage;
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (typeof parsed !== "object" || parsed === null) throw new Error("must be a JSON assistant message object");
    message = parsed as AssistantMessage;
  } catch (seamError: unknown) {
    const detail = seamError instanceof Error ? seamError.message : String(seamError);
    throw new Error(`INVALID: PI_SUBAGENTS_ORIGINAL_END_WITH_RESULT must be a JSON assistant message (got ${String(raw).slice(0, 120)}): ${detail}`);
  }
  const agent = session.agent;
  if (typeof agent.streamFunction !== "function") {
    throw new Error("MODEL_UNAVAILABLE: session agent has no supported streamFunction (pinned SDK 1.1.0 required)");
  }
  const compat = await loadCompat();
  if (typeof compat.createAssistantMessageEventStream !== "function") {
    throw new Error("MODEL_UNAVAILABLE: pinned SDK has no supported createAssistantMessageEventStream (pinned SDK 1.1.0 required)");
  }
  const preGuardOriginal: StreamFn = agent.streamFunction;
  let armed = true;
  const endWithResultWrapper: StreamFn = function (
    this: unknown,
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): ReturnType<StreamFn> {
    if (!armed) return Reflect.apply(preGuardOriginal, this, [model, context, options]) as ReturnType<StreamFn>;
    armed = false;
    const stream: AssistantMessageEventStream = compat.createAssistantMessageEventStream();
    stream.end(message);
    return stream as ReturnType<StreamFn>;
  };
  agent.streamFunction = endWithResultWrapper;
}

async function installOriginalFaultWrapper(session: WorkerSession): Promise<void> {
  const raw: unknown = process.env["PI_SUBAGENTS_ORIGINAL_FAULT"];
  const mutateRaw: unknown = process.env["PI_SUBAGENTS_ORIGINAL_MUTATE_RESULT"];
  const bareRaw: unknown = process.env["PI_SUBAGENTS_ORIGINAL_END_BARE"];
  const accessRaw: unknown = process.env["PI_SUBAGENTS_ORIGINAL_ITERATOR_ACCESS_THROW"];
  const endWithResultRaw: unknown = process.env["PI_SUBAGENTS_ORIGINAL_END_WITH_RESULT"];
  const bareSet: boolean = bareRaw !== undefined && bareRaw !== "" && bareRaw !== "off";
  if (bareSet && bareRaw !== "once") {
    throw new Error(`INVALID: PI_SUBAGENTS_ORIGINAL_END_BARE must be "off" or "once" (got ${String(bareRaw)})`);
  }
  const accessSet: boolean = accessRaw !== undefined && accessRaw !== "" && accessRaw !== "off";
  if (accessSet && accessRaw !== "once") {
    throw new Error(`INVALID: PI_SUBAGENTS_ORIGINAL_ITERATOR_ACCESS_THROW must be "off" or "once" (got ${String(accessRaw)})`);
  }
  const endWithResultSet: boolean = endWithResultRaw !== undefined && endWithResultRaw !== "" && endWithResultRaw !== "off";
  const faultSet: boolean = raw !== undefined && raw !== "" && raw !== "off";
  const mutateSet: boolean = mutateRaw !== undefined && mutateRaw !== "";
  if (!faultSet && !mutateSet && !bareSet && !accessSet && !endWithResultSet) return;
  if ((faultSet && mutateSet) || (faultSet && bareSet) || (mutateSet && bareSet) || (accessSet && (faultSet || mutateSet || bareSet)) || (endWithResultSet && (faultSet || mutateSet || bareSet || accessSet))) {
    throw new Error("INVALID: PI_SUBAGENTS_ORIGINAL_FAULT, PI_SUBAGENTS_ORIGINAL_MUTATE_RESULT, PI_SUBAGENTS_ORIGINAL_END_BARE, PI_SUBAGENTS_ORIGINAL_ITERATOR_ACCESS_THROW and PI_SUBAGENTS_ORIGINAL_END_WITH_RESULT are mutually exclusive");
  }
  if (accessSet) {
    installOriginalIteratorAccessThrowWrapper(session);
    return;
  }
  if (endWithResultSet) {
    await installOriginalEndWithResultWrapper(session, endWithResultRaw);
    return;
  }
  if (bareSet) {
    await installOriginalEndBareWrapper(session);
    return;
  }
  if (mutateSet) {
    installOriginalMutateWrapper(session, mutateRaw);
    return;
  }
  if (raw !== "throw-once" && raw !== "reject-once") {
    throw new Error(`INVALID: PI_SUBAGENTS_ORIGINAL_FAULT must be "off", "throw-once" or "reject-once" (got ${String(raw)})`);
  }
  const mode: "throw-once" | "reject-once" = raw;
  const agent = session.agent;
  if (typeof agent.subscribe !== "function") {
    throw new Error("MODEL_UNAVAILABLE: session agent has no supported subscribe (pinned SDK 1.1.0 required)");
  }
  if (typeof agent.streamFunction !== "function") {
    throw new Error("MODEL_UNAVAILABLE: session agent has no supported streamFunction (pinned SDK 1.1.0 required)");
  }
  const preGuardOriginal: StreamFn = agent.streamFunction;
  const originalSubscribe = agent.subscribe;
  let armed = true;
  const faultWrapper: StreamFn = function (
    this: unknown,
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): ReturnType<StreamFn> {
    if (armed) {
      armed = false;
      if (mode === "throw-once") throw new Error("WORKER_ORIGINAL_FAULT_SYNC_THROW at streamFunction");
      return Promise.reject(new Error("WORKER_ORIGINAL_FAULT_ASYNC_REJECT at streamFunction"));
    }
    return Reflect.apply(preGuardOriginal, this, [model, context, options]) as ReturnType<StreamFn>;
  };
  agent.streamFunction = faultWrapper;
  agent.subscribe = function (
    this: unknown,
    listener: (event: { type: string } & Record<string, unknown>) => unknown,
  ): () => void {
    return Reflect.apply(originalSubscribe, this, [listener]) as () => void;
  };
}

async function decorateProviderGuard(
  session: WorkerSession,
  admitted: { provider: string; id: string; thinkingLevel: string },
  parentProvider: ParentModelProvider | null,
): Promise<void> {
  const original: StreamFn = session.agent.streamFunction;
  if (typeof original !== "function") {
    throw new Error("MODEL_UNAVAILABLE: session agent has no supported streamFunction (pinned SDK 1.1.0 required)");
  }
  const compat = await loadCompat();
  const createStream = compat.createAssistantMessageEventStream;
  if (typeof createStream !== "function") {
    throw new Error("MODEL_UNAVAILABLE: pinned SDK has no supported createAssistantMessageEventStream (pinned SDK 1.1.0 required)");
  }
  const guard: StreamFn = async function (
    this: unknown,
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): Promise<AssistantMessageEventStream> {
    const signal: AbortSignal | undefined = options?.signal;
    let admission: ProviderAdmissionResponse;
    try {
      if (parentProvider !== null && !parentProvider.matchesRequest(model)) {
        admission = { ok: false, code: "POLICY_DENIED", error: "provider request does not match the approved parent model" };
      } else {
        admission = await requestProviderAdmission("stream", admitted.provider, admitted.id, admitted.thinkingLevel, signal);
      }
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      admission = { ok: false, code: "INVALID", error: `INVALID: ${detail}` };
    }
    if (admission.ok) {
      const capturedGen = state.gen;
      const capturedTaskRunId: unknown = capturedGen.taskRunId;
      const capturedGeneration: unknown = capturedGen.generation;
      let raw: AssistantMessageEventStream;
      try {
        const request = parentProvider === null ? { model, options } : parentProvider.prepareRequest(model, options);
        const streamOrPromise: ReturnType<StreamFn> = Reflect.apply(original, this, [request.model, context, request.options]) as ReturnType<StreamFn>;
        raw = await streamOrPromise;
      } catch (invokeError: unknown) {
        capturedGen.usage.unknown = true;
        const detail = invokeError instanceof Error ? invokeError.message : String(invokeError);
        process.stderr.write(`PROVIDER_USAGE_OBSERVATION_FAILED: taskRunId=${String(capturedTaskRunId)} generation=${String(capturedGeneration)}: original stream invocation failed before any result: ${detail}\n`);
        throw invokeError;
      }
      let stream: AssistantMessageEventStream;
      try {
        stream = adaptStream(raw, { signal }, { taskRunId: capturedTaskRunId, generation: capturedGeneration });
      } catch (adaptError: unknown) {
        capturedGen.usage.unknown = true;
        const detail = adaptError instanceof Error ? adaptError.message : String(adaptError);
        process.stderr.write(`PROVIDER_USAGE_OBSERVATION_FAILED: taskRunId=${String(capturedTaskRunId)} generation=${String(capturedGeneration)}: stream adapter rejected producer stream: ${detail}\n`);
        // The adapter never saw this invocation, so no facade observation
        // exists: still retain an otherwise-valid ORIGINAL result through
        // a direct raw observation (fire-and-forget — the turn already
        // fails, and a hanging raw must not stall it; a post-settle
        // arrival emits the standard late receipt).
        observeRawUsageOnly(capturedGen, capturedTaskRunId, capturedGeneration, raw);
        throw adaptError;
      }
      // Test-only facade-local-completion seam (narrow, env-gated, off
      // unless requested): ends the ADAPTED facade with a caller-supplied
      // message while the provider stays pending, modelling a consumer-side
      // mutation racing a genuine provider outcome. Public completion takes
      // the local message (first-terminal-wins); usage accounting must still
      // bill only the genuine ORIGINAL outcome, never the local message.
      // Malformed configuration fails loudly here, never silently ignored.
      const localEndRaw: unknown = process.env["PI_SUBAGENTS_FACADE_LOCAL_END"];
      if (localEndRaw !== undefined && localEndRaw !== "") {
        let localEndMessage: AssistantMessage;
        try {
          const parsed: unknown = JSON.parse(String(localEndRaw));
          if (typeof parsed !== "object" || parsed === null) throw new Error("must be a JSON assistant message object");
          localEndMessage = parsed as AssistantMessage;
        } catch (seamError: unknown) {
          const detail = seamError instanceof Error ? seamError.message : String(seamError);
          throw new Error(`INVALID: PI_SUBAGENTS_FACADE_LOCAL_END must be a JSON assistant message (got ${String(localEndRaw).slice(0, 120)}): ${detail}`);
        }
        stream.end(localEndMessage);
      }
      // Usage from the RAW ORIGINAL, public completion from the facade:
      // a consumer-local end() can win public completion while the genuine
      // provider Usage still accounts exactly once through raw.
      observeStreamResult(capturedGen, capturedTaskRunId, capturedGeneration, stream, raw);
      return stream;
    }
    // Every required-admission fault denies visibly (hold/fence/timeout/
    // unsupported peer): NEVER a legacy bypass. Direct harnesses without a
    // Supervisor must set an explicit admission handler; absent support is
    // itself a visible failure, not silent allow.
    const code = typeof admission.code === "string" && admission.code.length > 0 ? admission.code : "DENIED";
    const message = typeof admission.error === "string" && admission.error.length > 0 ? admission.error : `${code}: provider admission denied`;
    // Real required request-model identity: api/provider/id must be present
    // on the actual request model. No invented fallback to admitted identity
    // or hardcoded api; malformed models fail loudly as unsupported seam.
    if (typeof model !== "object" || model === null) {
      throw new Error("MODEL_UNAVAILABLE: provider request model is missing (pinned SDK StreamFn requires Model<Api>)");
    }
    const api: unknown = model.api;
    const provider: unknown = model.provider;
    const id: unknown = model.id;
    if (typeof api !== "string" || api.length === 0) {
      throw new Error("MODEL_UNAVAILABLE: provider request model.api is missing (pinned SDK Model<Api> requires api)");
    }
    if (typeof provider !== "string" || provider.length === 0) {
      throw new Error("MODEL_UNAVAILABLE: provider request model.provider is missing (pinned SDK Model<Api> requires provider)");
    }
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("MODEL_UNAVAILABLE: provider request model.id is missing (pinned SDK Model<Api> requires id)");
    }
    const stream = createStream();
    const denial: AssistantMessage = {
      role: "assistant",
      content: [],
      api: api as Api,
      provider,
      model: id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "error",
      errorMessage: message.startsWith(`${code}:`) ? message : `${code}: ${message}`,
      timestamp: Date.now(),
    };
    const capturedGen = state.gen;
    const adapted = adaptStream(stream, { signal }, { taskRunId: capturedGen.taskRunId, generation: capturedGen.generation });
    observeStreamResult(capturedGen, capturedGen.taskRunId, capturedGen.generation, adapted);
    queueMicrotask(() => {
      stream.push({ type: "error", reason: "error", error: denial });
    });
    return adapted;
  };
  session.agent.streamFunction = guard;
}

/** Every registered tool executes in the supervisor (broker or controller) over IPC. */
function makeProxyExecute(toolName: string): (toolCallId: string, params: unknown, signal?: AbortSignal) => Promise<unknown> {
  return async (toolCallId: string, params: unknown, signal?: AbortSignal) => {
    const requestId = randomUUID();
    if (Buffer.byteLength(JSON.stringify(params ?? {}), "utf8") > MAX_PAYLOAD_BYTES - ENVELOPE_HEADROOM_BYTES) {
      return { content: [{ type: "text" as const, text: `PAYLOAD_TOO_LARGE: ${toolName} arguments exceed ${MAX_PAYLOAD_BYTES - ENVELOPE_HEADROOM_BYTES} bytes; split the content into smaller writes/edits` }], details: {}, isError: true };
    }
    type ProxyResult = {
      content: string | Array<Record<string, unknown>>;
      details?: unknown;
      structuredContent?: unknown;
      usage?: unknown;
      isError: boolean;
    };
    const result = await new Promise<ProxyResult>((resolve) => {
      const finish = (r: ProxyResult): void => {
        const pending = state.pendingTools.get(requestId);
        if (!pending) return;
        if (pending.timer) clearTimeout(pending.timer);
        state.pendingTools.delete(requestId);
        resolve(r);
      };
      const timer = SUPERVISOR_BOUNDED_TOOLS.has(toolName) ? undefined : setTimeout(() => finish({ content: `tool ${toolName} timed out waiting for the supervisor`, isError: true }), TOOL_REQUEST_TIMEOUT_MS);
      state.pendingTools.set(requestId, { resolve: finish, timer });
      // An abort ends the call here; the supervisor cancels the job itself.
      // Child-owned cancellation: the supervisor aborts the governing call;
      // a late supervisor answer after local abort is ignored (finish guards).
      const onAbort = (): void => finish({ content: `tool ${toolName} aborted`, isError: true });
      signal?.addEventListener("abort", onAbort, { once: true });
      // The usage so far rides along, so a generation stopped mid-tool
      // (reviewer after its decision, crash) is still accounted for.
      // A prepared ticket travels with its exact invocation (consumed here;
      // validation/hook blocks, aborts, and settlement release leftovers).
      const ticket = state.openTicket !== null && state.openTicket.tool === toolName ? state.openTicket.ticket : null;
      state.openTicket = null;
      if (ticket !== null) {
        const at = state.unreleasedTickets.indexOf(ticket);
        if (at >= 0) state.unreleasedTickets.splice(at, 1);
      }
      send({ type: "request", operation: "tool.execute", requestId, payload: { tool: toolName, args: (params ?? {}) as Record<string, unknown>, toolCallId, ...(ticket !== null ? { ticket } : {}), usage: { ...state.gen.usage } } });
    });
    // External billed usage is accounted exactly once by the supervisor
    // journal (originating invocation); the worker counts assistant usage
    // only and passes tool usage through untouched (never folded, never dropped).
    // Validated public result usage rides through untouched (never folded
    // into assistant generation totals, never dropped): the supervisor
    // accounts it exactly once under the originating invocation.
    const passthroughUsage = result.usage !== undefined && result.usage !== null && typeof result.usage === "object" ? result.usage : undefined;
    if (typeof result.content === "string") {
      const content = [{ type: "text" as const, text: result.content }];
      return result.isError
        ? { content, details: result.details ?? {}, ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}), ...(passthroughUsage !== undefined ? { usage: passthroughUsage } : {}), isError: true }
        : { content, details: result.details ?? {}, ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}), ...(passthroughUsage !== undefined ? { usage: passthroughUsage } : {}) };
    }
    // Preserved parent blocks (text/image/...), already bounded by the
    // supervisor (which appends explicit drop markers). Never re-slice here:
    // a second slice would silently remove the supervisor's loss markers.
    const blocks = (result.content as Array<Record<string, unknown>>).map((b) => {
      if (typeof b !== "object" || b === null) return { type: "text" as const, text: "[invalid content block]" };
      return b;
    });
    const out: Record<string, unknown> = { content: blocks, details: result.details ?? {} };
    if (result.structuredContent !== undefined) out["structuredContent"] = result.structuredContent;
    if (passthroughUsage !== undefined) out["usage"] = passthroughUsage;
    if (result.isError) out["isError"] = true;
    return out;

  };
}

async function resolveModel(sdk: SdkModules, init: InitializePayload, agentDir: string): Promise<{ modelRuntime: WorkerModelRuntime; model: Record<string, unknown>; parentProvider: ParentModelProvider | null }> {
  if (process.env["PI_SUBAGENTS_DETERMINISTIC"] === "1") {
    // Provider-free integration: scripted provider through the real
    // ModelRuntime extension path (no network, no credentials).
    const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
    const compat = await loadCompat();
    const { registerDeterministicProvider, SIM_PROVIDER, SIM_MODEL, EntryTraceError } = await import("./deterministic.ts");
    // Narrow test-only ENTRY trace (authorized fixture seam): when the test
    // scaffold sets PI_SUBAGENTS_PROVIDER_ENTRY_LOG to a filename, append one
    // typed JSON line per provider-callback ENTRY (before step/response) to
    // that file confined inside the worker's own agentDir. Absent/unset (all
    // production paths) registers without observer (behavior unchanged). No
    // new writable path (agentDir already worker-owned), no grants change.
    const entryLogName: unknown = process.env["PI_SUBAGENTS_PROVIDER_ENTRY_LOG"];
    state.collector = null;
    state.lifecyclePath = null;
    // Mandatory invocation-owned fault transport: ALWAYS injected (never
    // optional), capturing the ENTRY-time owner synchronously. The scope is
    // owned by the ENTRY-time generation object, so a later generation
    // switch or environment mutation cannot divert or orphan faults.
    // Unset identity fails loudly here —
    // never a silent null, never a late environment read.
    const createInvocationScope: DeterministicEntryObserver["createInvocationScope"] = (info) => {
      const gen = state.gen;
      const taskRunId: unknown = gen.taskRunId;
      const generation: unknown = gen.generation;
      const agentId: unknown = state.binding === null ? null : state.binding.agentId;
      if (typeof taskRunId !== "string" || taskRunId.length === 0 || typeof generation !== "number" || !Number.isInteger(generation) || generation < 0 || typeof agentId !== "string" || agentId.length === 0) {
        throw new Error(
          `DRIVER_INFRA: invocation scope identity must be set at ENTRY (taskRunId=${String(taskRunId)} generation=${String(generation)} agentId=${String(agentId)})`,
        );
      }
      const scope: InvocationScope = {
        owner: {
          taskRunId,
          generation,
          agentId,
          provider: info.provider,
          model: info.model,
          summaryKind: info.kind,
          turn: info.turn,
        },
        faults: [],
      };
      gen.observation.push(scope);
      return scope;
    };
    let observer: DeterministicEntryObserver = { createInvocationScope };
    if (entryLogName !== undefined) {
      if (typeof entryLogName !== "string" || entryLogName.length === 0) {
        throw new Error(`INVALID: PI_SUBAGENTS_PROVIDER_ENTRY_LOG explicitly configured but empty (got ${String(entryLogName)}); unset it for production tracing`);
      }
      if (entryLogName.includes("\0")) {
        throw new Error("INVALID: PI_SUBAGENTS_PROVIDER_ENTRY_LOG must not contain NUL");
      }
      const target = resolve(agentDir, entryLogName);
      const rel = relative(agentDir, target);
      if (rel === "" || rel.startsWith("..") || rel.startsWith(sep) || target.includes(`..${sep}`)) {
        throw new Error(`INVALID: PI_SUBAGENTS_PROVIDER_ENTRY_LOG must stay confined in the worker agentDir (got ${entryLogName})`);
      }
      try {
        const fd: number = openSync(target, "a");
        closeSync(fd);
      } catch (readyError: unknown) {
        const detail = readyError instanceof Error ? readyError.message : String(readyError);
        throw new Error(`INVALID: PI_SUBAGENTS_PROVIDER_ENTRY_LOG collector not ready at ${target}: ${detail}`);
      }
      state.collector = { name: entryLogName, ready: true };
      state.lifecyclePath = join(agentDir, "compaction-lifecycle.jsonl");
      observer.onEntry = (info) => {
            const taskRunId: unknown = state.gen.taskRunId;
            const generation: unknown = state.gen.generation;
            const agentId: unknown = state.binding === null ? null : state.binding.agentId;
            if (typeof info.turn !== "number" || !Number.isInteger(info.turn) || info.turn <= 0) {
              throw new EntryTraceError(`ENTRY_TRACE_IDENTITY_FAILED: turn must be a positive integer (got ${String(info.turn)})`);
            }
            if (typeof info.provider !== "string" || info.provider.length === 0 || typeof info.model !== "string" || info.model.length === 0) {
              throw new EntryTraceError("ENTRY_TRACE_IDENTITY_FAILED: provider/model must be nonempty strings");
            }
            const kind: unknown = info.kind;
            if (kind !== "main" && kind !== "history" && kind !== "prefix") {
              throw new EntryTraceError(`ENTRY_TRACE_IDENTITY_FAILED: kind must be main/history/prefix (got ${String(kind)})`);
            }
            if (typeof taskRunId !== "string" || taskRunId.length === 0 || typeof generation !== "number" || !Number.isInteger(generation) || generation < 0 || typeof agentId !== "string" || agentId.length === 0) {
              throw new EntryTraceError(`ENTRY_TRACE_IDENTITY_FAILED: taskRun/generation/agent must be set at ENTRY (taskRunId=${String(taskRunId)} generation=${String(generation)} agentId=${String(agentId)})`);
            }
            try {
              appendFileSync(target, JSON.stringify({
                turn: info.turn,
                provider: info.provider,
                model: info.model,
                kind,
                taskRunId,
                generation,
                agentId,
                at: Date.now(),
              }) + "\n");
            } catch (writeError: unknown) {
              const detail = writeError instanceof Error ? writeError.message : String(writeError);
              throw new EntryTraceError(`ENTRY_TRACE_WRITE_FAILED at ${target}: ${detail}`);
            }
          };
    }
    registerDeterministicProvider(modelRuntime, compat.EventStream, parseScriptSteps(), observer);
    const model = modelRuntime.getModel(SIM_PROVIDER, SIM_MODEL);
    if (!model) throw new Error("MODEL_UNAVAILABLE: deterministic provider model unavailable");
    return { modelRuntime, model, parentProvider: null };
  }
  // Provider credentials stay in the approved host store, opened live (no
  // auth.json copies into worktrees or tool envs). Declarative custom
  // models come from the host models.json or a public parent descriptor.
  // Parent-only credentials are resolved privately for each provider request.
  const hostAgentDir = process.env["PI_SUBAGENTS_HOST_AGENT_DIR"];
  if (!hostAgentDir) throw new Error("MODEL_UNAVAILABLE: no approved credential store (PI_SUBAGENTS_HOST_AGENT_DIR unset)");
  const modelsPath = join(hostAgentDir, "models.json");
  let parentProvider: ParentModelProvider | null = null;
  const parentCredentials = init.providerModel === undefined ? null : new (await loadCompat()).InMemoryCredentialStore();
  const modelRuntime = await sdk.ModelRuntime.create(parentCredentials === null
    ? { authPath: join(hostAgentDir, "auth.json"), modelsPath: existsSync(modelsPath) ? modelsPath : null }
    : { credentials: parentCredentials, modelsPath: null });
  if (init.providerModel !== undefined) {
    const descriptor = parseParentModel(init.providerModel, init.model);
    const compat = await loadCompat();
    const api = compat.getApiProvider(descriptor.api);
    if (api === undefined) throw new Error("MODEL_UNAVAILABLE: parent model uses an API unavailable in the worker");
    parentProvider = parentModelProvider(descriptor, api, async (signal) => {
      const admission = await requestProviderAdmission("auth", init.model.provider, init.model.id, init.model.thinkingLevel, signal);
      if (!admission.ok) throw new Error(`${admission.code ?? "MODEL_UNAVAILABLE"}: ${admission.error ?? "parent provider authentication denied"}`);
      if (admission.auth === undefined) throw new Error("MODEL_UNAVAILABLE: parent provider authentication was not supplied");
      return admission.auth;
    });
    modelRuntime.registerNativeProvider(parentProvider);
  }
  const model = modelRuntime.getModel(init.model.provider, init.model.id);
  if (!model) throw new Error(`MODEL_UNAVAILABLE: ${init.model.provider}/${init.model.id} is not resolvable from the approved store`);
  return { modelRuntime, model, parentProvider };
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
  state.resultLimit = init.resultLimit ?? RESULT_TEXT_MAX;
  setRequestIdentityEnv(init.taskRunId, init.executionGeneration);

  let session: WorkerSession;
  let parentProvider: ParentModelProvider | null = null;
  try {
    const sdk = await loadSdk();
    const agentDir = process.env["PI_SUBAGENTS_AGENT_DIR"];
    if (!agentDir) throw new Error("PI_SUBAGENTS_AGENT_DIR is not set");
    mkdirSync(agentDir, { recursive: true });
    state.sessionDir = join(process.env["PI_SUBAGENTS_SESSIONS_DIR"] ?? join(agentDir, "sessions"), state.binding!.agentId);
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
    // Preserved parent schemas/descriptions for external proxies (no generic
    // catchall); native tools keep pi-shaped child specs. Unknown names fail
    // visibly here, never as silent untyped tools.
    const externalByName = new Map((init.externalTools ?? []).map((d) => [d.name, d]));
    state.externalProxyNames = new Set(externalByName.keys());
    const customTools = init.tools.map((name) => {
      const external = externalByName.get(name);
      if (external) {
        if (typeof external.description !== "string" || typeof external.parameters !== "object" || external.parameters === null) {
          throw new Error(`INVALID: external tool ${name} has no preserved schema`);
        }
        return sdk.defineTool({
          name,
          label: name,
          description: external.description,
          parameters: external.parameters,
          ...((external as { outputSchema?: unknown }).outputSchema !== undefined ? { outputSchema: (external as { outputSchema?: unknown }).outputSchema } : {}),
          executionMode: "sequential",
          // PUBLIC sync preparation hook: consumes the actual supervisor-
          // prepared value cached by the awaited agent subscriber (never a
          // dummy), or throws the actual preparation error. Declared schemas
          // are untouched — preparation only maps values into them.
          prepareArguments: makeProxyPrepare(name),
          execute: makeProxyExecute(name),
        });
      }
      const spec = childToolSpec(Type, name);
      return sdk.defineTool({ name, label: name, description: spec.description, promptGuidelines: childToolGuidelines(name), parameters: spec.parameters, executionMode: "sequential", execute: makeProxyExecute(name) });
    });
    const resolved = await resolveModel(sdk, init, agentDir);
    const { modelRuntime, model } = resolved;
    parentProvider = resolved.parentProvider;
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
      mkdirSync(state.sessionDir, { recursive: true });
      sessionManager = sdk.SessionManager.create(init.workdir, state.sessionDir);
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
    if (session.model.provider !== model["provider"] || session.model.id !== model["id"]) {
      throw new Error("MODEL_UNAVAILABLE: restored worker did not select the admitted model");
    }
    // The SDK honors explicit selection on restore but only records initial
    // selection for new sessions. Persist changed selection on the native
    // branch too, without rewriting any historical assistant attribution.
    if (init.restore) {
      const branch = sessionManager.getBranch();
      const selected = branch.filter((entry) => entry.type === "model_change").at(-1);
      if (!selected || selected.provider !== session.model.provider || selected.modelId !== session.model.id) {
        sessionManager.appendModelChange(session.model.provider, session.model.id);
      }
      const thinking = branch.filter((entry) => entry.type === "thinking_level_change").at(-1);
      if (!thinking || thinking.thinkingLevel !== session.thinkingLevel) sessionManager.appendThinkingLevelChange(session.thinkingLevel);
    }
  } catch (e) {
    fail(env.requestId, "INVALID", (e as Error).message);
    return;
  }
  state.session = session;
  await installOriginalFaultWrapper(session);
  // Sequential worker tool execution is part of the contract: it prevents
  // a wait from releasing a lease while a sibling tool still runs (and keeps
  // the single-flight preparation lease sound).
  session.agent.toolExecution = "sequential";
  // Agent-level preparation seam (NOT session.subscribe): observes
  // model-issued tool_execution_start events the agent awaits before sync
  // preparation, so generic proxies defer validation to parent preparation.
  subscribeAgentPreparations(session.agent, state.externalProxyNames);
  // Subscribe BEFORE accepting work.
  session.subscribe((event) => onSessionEvent(event));
  // Per-request provider admission (fail-closed): decorates the PUBLIC
  // session agent streamFunction BEFORE accepting work, so the first
  // provider request already traverses the guard. Missing field fails
  // loudly via the initialize failure path below (never optional skip).
  await decorateProviderGuard(session, { provider: init.model.provider, id: init.model.id, thinkingLevel: init.model.thinkingLevel }, parentProvider);
  ack(env.requestId, {
    sessionId: session.sessionId,
    sessionFile: session.sessionManager.getSessionFile() ?? null,
    ...(state.collector !== null ? { collector: { name: state.collector.name, ready: state.collector.ready } } : {}),
  });
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
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    await settleGeneration(detail);
  }
}

function onSessionEvent(event: { type: string } & Record<string, unknown>): void {
  if (!state.binding) return;
  const gen = state.gen;
  switch (event["type"]) {
    case "message_end": {
      // Usage is accounted exactly once per physical request by the guard's
      // stream-result observation (joined before settled publication); this
      // handler owns only completion metadata, never usage deltas.
      const message = event["message"] as {
        role?: string;
        content?: Array<{ type: string; text?: string }>;
        usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; cost?: { total?: number } };

        stopReason?: string;
        errorMessage?: string;
      } | undefined;
      if (message?.role !== "assistant") break;
      // Per-request deltas summed here unless the guard's stream-result
      // observation already accounted this exact message object (same
      // provider-pushed identity through iteration and result), or the
      // message is a facade-local consumer completion (push/end): local
      // completions are public-completion artifacts, never provider usage,
      // and the genuine provider outcome accounts separately through the
      // ORIGINAL. The sum applies the shared full-shape gate: malformed
      // usage (e.g. an injected negative breakdown) marks unknown without
      // fabrication instead of leniently summing corrupt counters. Missing
      // provider accounting is reported as unknown, never as zero.
      if (message.usage) {
        if (!accountedUsageMessages.has(message) && !isFacadeLocalCompletion(message)) {
          if (!isFullUsageShape(message.usage)) {
            gen.usage.unknown = true;
          } else {
            accountedUsageMessages.add(message);
            const usage = message.usage as unknown as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number | null; cost?: { total?: number } };
            const cacheRead = usage.cacheRead ?? 0;
            const cacheWrite = usage.cacheWrite ?? 0;
            gen.usage.input += (usage.input ?? 0) + cacheRead + cacheWrite;
            gen.usage.output += usage.output ?? 0;
            gen.usage.cacheRead += cacheRead;
            gen.usage.cacheWrite += cacheWrite;
            // Providers without a reasoning breakdown leave it undefined: not zero.
            if (typeof usage.reasoning === "number") gen.usage.reasoning = (gen.usage.reasoning ?? 0) + usage.reasoning;
            if (typeof usage.cost?.total === "number") gen.usage.cost = (gen.usage.cost ?? 0) + usage.cost.total;
          }
        }
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
    case "compaction_start":
    case "compaction_end": {
      // Test-tracer compaction lifecycle (only when ENTRY collection is
      // configured; production paths never write this file). Records the
      // supported public isCompacting value alongside the SDK event so tests
      // can bracket summary ENTRYs with actual SDK lifecycle, same clock.
      if (state.lifecyclePath === null) break;
      const reason: unknown = event["reason"];
      const compacting: unknown = state.session === null ? null : state.session.isCompacting;
      const record: Record<string, unknown> = {
        phase: event["type"] === "compaction_start" ? "start" : "end",
        reason: typeof reason === "string" ? reason : null,
        isCompacting: typeof compacting === "boolean" ? compacting : null,
        at: Date.now(),
      };
      if (event["type"] === "compaction_end") {
        const result: unknown = event["result"];
        const errorMessage: unknown = event["errorMessage"];
        record["completed"] = typeof result === "object" && result !== null;
        record["errorMessage"] = typeof errorMessage === "string" ? errorMessage : null;
      }
      try {
        appendFileSync(state.lifecyclePath, JSON.stringify(record) + "\n");
      } catch (lifecycleError: unknown) {
        const detail = lifecycleError instanceof Error ? lifecycleError.message : String(lifecycleError);
        const entry = `compaction lifecycle trace failed: ${detail}`;
        state.instrumentError = state.instrumentError === null ? entry : `${state.instrumentError}; ${entry}`;
        process.stderr.write(`COMPACTION_LIFECYCLE_TRACE_FAILED: ${detail}\n`);
      }
      break;
    }
    case "agent_settled":
      // The completion boundary (after retries, compaction, and queued
      // continuation); usage observations join before settled publication.
      void settleGeneration(null);
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
      setRequestIdentityEnv(env.taskRunId, env.executionGeneration);
      state.prepLease = null;
      releaseUnreleasedTickets();
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
  // A finalizing generation already completed its turn: interrupting it
  // would rewrite history (interruptRequested feeds the status the
  // snapshot is about to publish), so it acks idle like a settled one.
  if (!session || state.gen.settled || state.gen.finalizing) {
    ack(env.requestId, { idle: true });
    return;
  }
  state.gen.interruptRequested = true;
  try {
    // agent_settled fires before abort() resolves and reports `interrupted`.
    await session.abort();
    await settleGeneration(null);
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

function handlePrepareResponse(envelope: IpcEnvelope): void {
  const pending = envelope.requestId ? state.pendingPreps.get(envelope.requestId) : undefined;
  if (!pending) return;
  const payload = envelope.payload as { ok?: boolean; ticket?: string; preparedArgs?: unknown; error?: string };
  if (payload?.ok === true && typeof payload.ticket === "string") {
    pending.resolve({ ok: true, ticket: payload.ticket, preparedArgs: payload.preparedArgs ?? {} });
  } else {
    // Explicit UNSUPPORTED included: hard error with cleanup, never a
    // silent downgrade to unticketed execute.
    pending.resolve({ ok: false, error: typeof payload?.error === "string" ? payload.error : "preparation failed" });
  }
}

function handleAdmissionResponse(envelope: IpcEnvelope): void {
  const pending = envelope.requestId ? state.pendingAdmission.get(envelope.requestId) : undefined;
  if (!pending) return;
  const payload = envelope.payload as { ok?: boolean; code?: string; error?: string; auth?: unknown };
  if (payload?.ok === true) {
    try {
      pending.resolve({ ok: true, ...(payload.auth === undefined ? {} : { auth: parseProviderRequestAuth(payload.auth) }) });
    } catch {
      pending.resolve({ ok: false, code: "INVALID", error: "invalid parent provider authentication response" });
    }
  } else {
    // Explicit denials (hold/fence/timeout/unsupported) stay hard and never
    // downgrade to an unticketed allow; failures are visible routing errors.
    pending.resolve({
      ok: false,
      code: typeof payload?.code === "string" ? payload.code : "DENIED",
      error: typeof payload?.error === "string" ? payload.error : "provider admission denied",
    });
  }
}

function handleToolResponse(envelope: IpcEnvelope): void {
  const pending = envelope.requestId ? state.pendingTools.get(envelope.requestId) : undefined;
  if (!pending) return;
  const payload = envelope.payload as {
    ok?: boolean;
    content?: string | Array<Record<string, unknown>>;
    details?: unknown;
    structuredContent?: unknown;
    usage?: unknown;
  };
  const content = Array.isArray(payload?.content) ? payload.content : String(payload?.content ?? "");
  pending.resolve({
    content,
    details: payload?.details,
    structuredContent: payload?.structuredContent,
    usage: payload?.usage,
    isError: payload?.ok !== true,
  });
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
  if (asRecord["type"] === "response" && asRecord["operation"] === "tool.prepare") {
    const checked = validateEnvelope(raw, state.binding, "to-worker");
    if (checked.ok) {
      handlePrepareResponse(checked.envelope);
    } else if (typeof asRecord["requestId"] === "string") {
      // Invalid/oversize/stale preparation answers settle promptly as hard
      // errors (never a silent legacy downgrade, never a hang). The pending
      // entry is owned by finish(): resolving here lets it clear the timer
      // and delete exactly once; a later timeout/late reply finds nothing
      // and is ignored. Abort releases via the same once-settlement.
      const pending = state.pendingPreps.get(asRecord["requestId"]);
      if (pending) {
        pending.resolve({ ok: false, error: `${checked.code}: ${checked.message}` });
      }
    }
    return;
  }
  if (asRecord["type"] === "response" && asRecord["operation"] === "provider.admission") {
    const checked = validateEnvelope(raw, state.binding, "to-worker");
    if (checked.ok) {
      handleAdmissionResponse(checked.envelope);
    } else if (typeof asRecord["requestId"] === "string") {
      // Unusable admission answers deny fail-closed (never hang, never allow).
      const pending = state.pendingAdmission.get(asRecord["requestId"]);
      if (pending) {
        pending.resolve({ ok: false, code: checked.code, error: `${checked.code}: ${checked.message}` });
      }
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
