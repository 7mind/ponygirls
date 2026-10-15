/**
 * ponygirls-subagents — private supervisor/worker IPC protocol.
 *
 * Versioned discriminated union with runtime validation. Every envelope is
 * checked against the authenticated channel binding (rootEpoch, agentId,
 * workerInstanceId), never against model-supplied fields alone. Unknown
 * operations, malformed fields, wrong ownership, stale instance/epoch/
 * execution IDs, and oversized payloads are rejected before performing work.
 *
 * Transport: Node fork() with one IPC channel; stdout/stderr are bounded
 * diagnostics only. task text travels in structured messages, never argv.
 */

import { err, type ErrorCode } from "./errors.ts";
import { parseInstructionSet } from "./instructions.ts";
import { RESULT_TEXT_HARD_MAX, RESULT_TEXT_MAX } from "./tools.ts";
import { PROTOCOL_VERSION, type InstructionSet } from "./types.ts";

export const MAX_PAYLOAD_BYTES = 256 * 1024;
export const MAX_TEXT_BYTES = 64 * 1024;

export type EnvelopeType = "request" | "response" | "event";

/** Supervisor -> worker operations. */
export type SupervisorOperation =
  | "initialize"
  | "deliver"
  | "interrupt"
  | "dispose"
  | "checkpoint"
  | "find_entry";

/** Worker -> supervisor operations. */
export type WorkerOperation =
  | "ready"
  | "event"
  | "tool.execute"
  | "tool.prepare"
  | "tool.ticket-release"
  | "provider.admission";

const SUPERVISOR_OPS: ReadonlySet<string> = new Set<SupervisorOperation>([
  "initialize",
  "deliver",
  "interrupt",
  "dispose",
  "checkpoint",
  "find_entry",
]);

const WORKER_OPS: ReadonlySet<string> = new Set<WorkerOperation>([
  "ready",
  "event",
  "tool.execute",
  "tool.prepare",
  "tool.ticket-release",
  "provider.admission",
]);

export interface IpcEnvelope {
  protocolVersion: number;
  rootEpoch: string;
  agentId: string;
  workerInstanceId: string;
  requestId: string | null;
  /** Monotonic sequence within the sending worker instance. */
  seq: number | null;
  type: EnvelopeType;
  operation: string;
  taskRunId: string | null;
  executionGeneration: number | null;
  payload: unknown;
}

/** Authenticated channel binding assigned at launch/reload. */
export interface ChannelBinding {
  rootEpoch: string;
  agentId: string;
  workerInstanceId: string;
  /** Highest worker seq observed; stale/duplicate worker events rejected. */
  lastWorkerSeq: number;
  /** Highest execution generation admitted for this worker. */
  admittedGeneration: number;
}

export function bindChannel(rootEpoch: string, agentId: string, workerInstanceId: string): ChannelBinding {
  return { rootEpoch, agentId, workerInstanceId, lastWorkerSeq: -1, admittedGeneration: 0 };
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function utf8Length(v: unknown): number {
  try {
    return Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export interface ValidationOk {
  ok: true;
  envelope: IpcEnvelope;
}
export interface ValidationFail {
  ok: false;
  code: ErrorCode;
  message: string;
}

/**
 * Validate a raw IPC frame. Direction selects which operation set is legal.
 * Binding checks ownership/fencing; generation checks apply to run/deliver.
 */
export function validateEnvelope(
  raw: unknown,
  binding: ChannelBinding,
  direction: "to-worker" | "from-worker",
): ValidationOk | ValidationFail {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, code: "INVALID", message: "envelope must be an object" };
  }
  const e = raw as Record<string, unknown>;
  if (e["protocolVersion"] !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "PROTOCOL_VERSION_MISMATCH",
      message: `protocolVersion must be ${PROTOCOL_VERSION}`,
    };
  }
  for (const field of ["rootEpoch", "agentId", "workerInstanceId"] as const) {
    if (!isNonEmptyString(e[field])) {
      return { ok: false, code: "INVALID", message: `envelope.${field} must be a nonempty string` };
    }
  }
  if (e["rootEpoch"] !== binding.rootEpoch) {
    return { ok: false, code: "STALE_EPOCH", message: "root epoch mismatch" };
  }
  if (e["agentId"] !== binding.agentId) {
    return { ok: false, code: "FORGED_AUTHOR", message: "agent identity mismatch" };
  }
  if (e["workerInstanceId"] !== binding.workerInstanceId) {
    return { ok: false, code: "STALE_INSTANCE", message: "worker instance mismatch" };
  }
  if (typeof e["operation"] !== "string" || e["operation"].length === 0) {
    return { ok: false, code: "UNKNOWN_OPERATION", message: "missing operation" };
  }
  const allowed = direction === "to-worker" ? SUPERVISOR_OPS : WORKER_OPS;
  const operation = e["operation"];
  // Supervisor answers to worker RPCs (tool execute/prepare, provider
  // admission) travel as responses; ticket-release is one-way and needs no
  // answer.
  const isToolAnswer = direction === "to-worker" && e["type"] === "response" && (operation === "tool.execute" || operation === "tool.prepare" || operation === "provider.admission");
  if (typeof operation !== "string" || (!allowed.has(operation) && !isToolAnswer)) {
    return { ok: false, code: "UNKNOWN_OPERATION", message: `unknown operation ${String(e["operation"])}` };
  }
  if (e["type"] !== "request" && e["type"] !== "response" && e["type"] !== "event") {
    return { ok: false, code: "INVALID", message: "envelope.type must be request/response/event" };
  }
  if (e["requestId"] !== null && e["requestId"] !== undefined && typeof e["requestId"] !== "string") {
    return { ok: false, code: "INVALID", message: "requestId must be string or null" };
  }
  if (e["seq"] !== null && e["seq"] !== undefined && (!Number.isInteger(e["seq"]) || (e["seq"] as number) < 0)) {
    return { ok: false, code: "INVALID", message: "seq must be a nonneg integer or null" };
  }
  if (
    e["executionGeneration"] !== null &&
    e["executionGeneration"] !== undefined &&
    (!Number.isInteger(e["executionGeneration"]) || (e["executionGeneration"] as number) < 0)
  ) {
    return { ok: false, code: "INVALID", message: "executionGeneration must be a nonneg integer or null" };
  }
  if (utf8Length(e["payload"]) > MAX_PAYLOAD_BYTES) {
    return { ok: false, code: "PAYLOAD_TOO_LARGE", message: "payload exceeds 256KiB" };
  }
  return {
    ok: true,
    envelope: {
      protocolVersion: PROTOCOL_VERSION,
      rootEpoch: e["rootEpoch"] as string,
      agentId: e["agentId"] as string,
      workerInstanceId: e["workerInstanceId"] as string,
      requestId: (e["requestId"] as string | null | undefined) ?? null,
      seq: (e["seq"] as number | null | undefined) ?? null,
      type: e["type"] as EnvelopeType,
      operation: e["operation"] as string,
      taskRunId: (e["taskRunId"] as string | null | undefined) ?? null,
      executionGeneration: (e["executionGeneration"] as number | null | undefined) ?? null,
      payload: e["payload"] ?? null,
    },
  };
}

/** The line a worker puts before an agent's first task text (identifies agent and task run to the model). */
export function taskHeader(agentId: string, taskRunId: string): string {
  return `[subagent ${agentId} task ${taskRunId}]\n`;
}

/** Matches taskHeader() at the start of a prompt. */
export const TASK_HEADER_PATTERN = /^\[subagent \S+ task \S+\]\n/;

/** Preserved external tool definition (actual parent schema/description). */
export interface ExternalToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
  /** Serializable parent output schema (structured results); absent when none. */
  outputSchema?: unknown;
}

/**
 * Narrow worker -> supervisor provider-admission query (one NEW provider
 * request). Public, channel-owned, fenced by envelope ids; carries the
 * operative selected original model identity and SDK request reason. Never
 * a generic capability: the supervisor answers allow/deny only.
 */
export interface ProviderAdmissionPayload {
  /** SDK request reason (user/continuation/retry/direct). */
  reason: string;
  /** Operative selected original physical model identity. */
  provider: string;
  modelId: string;
  thinkingLevel: string;
}

/** Supervisor answer to a `provider.admission` request. */
export interface ProviderAdmissionResponse {
  ok: boolean;
  /** Visible denial code on ok:false (hold/fence errors). */
  code?: string;
  /** Visible denial message on ok:false. */
  error?: string;
}

/** Initialize payload (supervisor -> worker). */
export interface InitializePayload {
  /** First task to prompt, or null to load the session without inference. */
  taskText: string | null;
  profile: "reader" | "writer";
  instructionHash: string;
  /** Skills and context files the child's session lists (its loader discovers none). */
  instructions: InstructionSet;
  model: { provider: string; id: string; thinkingLevel: string };
  taskRunId: string;
  executionGeneration: number;
  workdir: string;
  readRoots: string[];
  writable: boolean;
  /** Exact tool allowlist the worker registers (the supervisor re-checks every call). */
  tools: string[];
  /** Characters of final text the worker hands over per generation; omitted: RESULT_TEXT_MAX. */
  resultLimit?: number;
  /** Preserved schemas for external proxies (subset of tools; empty when none). */
  externalTools?: ExternalToolDefinition[];
  /**
   * Native-session restore: the supervisor wrote validated checkpoint bytes
   * to sessionFile before launch (single owner: no worker was running).
   * The worker opens it and selects leafEntryId through the native
   * branch API; unknown leaves refuse resume rather than patching history.
   */
  restore?: { sessionFile: string; leafEntryId: string | null } | null;
}

export function validateInitializePayload(raw: unknown): { ok: true; value: InitializePayload } | { ok: false; error: ReturnType<typeof err> } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: err("INVALID", "initialize payload must be an object") };
  }
  const p = raw as Record<string, unknown>;
  if (p["taskText"] !== null && (typeof p["taskText"] !== "string" || p["taskText"].length === 0)) {
    return { ok: false, error: err("INVALID", "initialize.taskText must be nonempty or null") };
  }
  if (typeof p["taskText"] === "string" && Buffer.byteLength(p["taskText"], "utf8") > MAX_TEXT_BYTES) {
    return { ok: false, error: err("PAYLOAD_TOO_LARGE", "initialize.taskText exceeds 64KiB") };
  }
  if (!Array.isArray(p["tools"]) || !(p["tools"] as unknown[]).every(isNonEmptyString)) {
    return { ok: false, error: err("INVALID", "initialize.tools must be an array of tool names") };
  }
  if (p["externalTools"] !== undefined && p["externalTools"] !== null) {
    if (!Array.isArray(p["externalTools"])) {
      return { ok: false, error: err("INVALID", "initialize.externalTools must be an array") };
    }
    const seen = new Set<string>();
    for (const entry of p["externalTools"] as unknown[]) {
      if (typeof entry !== "object" || entry === null) {
        return { ok: false, error: err("INVALID", "initialize.externalTools entries must be objects") };
      }
      const rec = entry as Record<string, unknown>;
      if (!isNonEmptyString(rec["name"]) || typeof rec["description"] !== "string" || typeof rec["parameters"] !== "object" || rec["parameters"] === null) {
        return { ok: false, error: err("INVALID", "initialize.externalTools entries need name/description/parameters") };
      }
      if (rec["outputSchema"] !== undefined && (typeof rec["outputSchema"] !== "object" || rec["outputSchema"] === null)) {
        return { ok: false, error: err("INVALID", "initialize.externalTools outputSchema must be an object when present") };
      }
      try {
        if (rec["outputSchema"] !== undefined && Buffer.byteLength(JSON.stringify(rec["outputSchema"]), "utf8") > 32 * 1024) {
          return { ok: false, error: err("PAYLOAD_TOO_LARGE", `external tool ${rec["name"] as string} outputSchema exceeds 32KiB`) };
        }
      } catch {
        return { ok: false, error: err("INVALID", `external tool ${rec["name"] as string} outputSchema not serializable`) };
      }
      const name = rec["name"] as string;
      if (seen.has(name)) {
        return { ok: false, error: err("INVALID", `duplicate external tool ${name}`) };
      }
      seen.add(name);
      if (!(p["tools"] as string[]).includes(name)) {
        return { ok: false, error: err("INVALID", `external tool ${name} missing from initialize.tools`) };
      }
      try {
        if (Buffer.byteLength(JSON.stringify(rec["parameters"]), "utf8") > 64 * 1024) {
          return { ok: false, error: err("PAYLOAD_TOO_LARGE", `external tool ${name} schema exceeds 64KiB`) };
        }
      } catch {
        return { ok: false, error: err("INVALID", `external tool ${name} schema not serializable`) };
      }
    }
  }
  if (p["profile"] !== "reader" && p["profile"] !== "writer") {
    return { ok: false, error: err("INVALID", "initialize.profile must be reader/writer") };
  }
  const model = p["model"] as Record<string, unknown> | undefined;
  if (!model || !isNonEmptyString(model["provider"]) || !isNonEmptyString(model["id"])) {
    return { ok: false, error: err("INVALID", "initialize.model must carry provider/id") };
  }
  if (!isNonEmptyString(p["taskRunId"])) {
    return { ok: false, error: err("INVALID", "initialize.taskRunId required") };
  }
  if (!Number.isInteger(p["executionGeneration"])) {
    return { ok: false, error: err("INVALID", "initialize.executionGeneration required") };
  }
  const resultLimit = p["resultLimit"];
  if (resultLimit !== undefined && (!Number.isInteger(resultLimit) || (resultLimit as number) < RESULT_TEXT_MAX || (resultLimit as number) > RESULT_TEXT_HARD_MAX)) {
    return { ok: false, error: err("INVALID", `initialize.resultLimit must be an integer from ${RESULT_TEXT_MAX} to ${RESULT_TEXT_HARD_MAX}`) };
  }
  try {
    parseInstructionSet(p["instructions"]);
  } catch (e) {
    return { ok: false, error: err("INVALID", `initialize.instructions: ${(e as Error).message}`) };
  }
  return { ok: true, value: p as unknown as InitializePayload };
}

/** Worker lifecycle event kinds (worker -> supervisor `event` op). */
export type WorkerEventKind =
  | "started"
  | "settled"
  | "tool_start"
  | "tool_end"
  | "preview"
  | "usage_late";

export interface WorkerEvent {
  kind: WorkerEventKind;
  taskRunId: string | null;
  executionGeneration: number | null;
  detail: Record<string, unknown>;
}
