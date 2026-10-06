/**
 * Domain types, policy constants, and validated schemas shared by the tool,
 * the supervisor client, the completion sender, and the viewer. The Python
 * supervisor is the single state-transition authority; this module validates
 * and displays its snapshots.
 */
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

export const PROTOCOL_VERSION = 1;
export const START_TIMEOUT_MS = 3000;
export const TERM_GRACE_MS = 5000;
export const KILL_WAIT_MS = 2000;
export const OUTPUT_DRAIN_MS = 1000;
export const OWNER_HANDOFF_WAIT_MS = 10000;
export const RECEIPT_CHECK_INTERVAL_MS = 250;
export const MAX_READ_BYTES = 32768;
export const MAX_LIST_ITEMS = 50;
export const MAX_TOOL_RESPONSE_BYTES = 32768;
/** Supervisor teardown budget plus margin for its final commit and exit. */
export const SUPERVISOR_EXIT_MARGIN_MS = 3000;
export const SUPERVISOR_SHUTDOWN_WAIT_MS = TERM_GRACE_MS + KILL_WAIT_MS + OUTPUT_DRAIN_MS + SUPERVISOR_EXIT_MARGIN_MS;
/** Completion events per custom message; the rest wait for the next drain. */
export const MAX_NOTICE_BATCH = 10;
/** Initial submission plus one retry per event per explicit-input/resume opportunity. */
export const MAX_NOTICE_ATTEMPTS = 2;
export const MAX_LABEL_CHARS = 200;
/** Same bound as the supervisor's MAX_COMMAND_BYTES (UTF-8 bytes). */
export const MAX_COMMAND_BYTES = 65536;
/** Linux PATH_MAX; also keeps every request line far below the supervisor's 1 MiB line limit. */
export const MAX_CWD_CHARS = 4096;
export const LIST_LABEL_DISPLAY_CHARS = 80;
export const COMPLETION_CUSTOM_TYPE = "bg-task-completion";
export const COMPLETION_SCHEMA_VERSION = 1;
export const SIDECAR_SUFFIX = ".bg-tasks";

export const SIGNAL_NAMES = ["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP", "SIGUSR1", "SIGUSR2", "SIGSTOP", "SIGCONT"] as const;
export type SignalName = (typeof SIGNAL_NAMES)[number];

export type TaskId = string & { readonly __brand: "TaskId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type EventId = string & { readonly __brand: "EventId" };

export type ErrorCode =
  | "INVALID_REQUEST" | "NOT_FOUND" | "TASK_UNFINISHED" | "TASK_CLOSING" | "TASK_FINALIZED" | "SESSION_BUSY"
  | "SESSION_CLOSING_GROUP" | "STORAGE_FAILED" | "STORE_CORRUPT" | "UNSUPPORTED_SCHEMA" | "UNSUPPORTED_PROTOCOL"
  | "LAUNCH_FAILED" | "TERMINATION_UNCONFIRMED" | "ARTIFACT_MISSING" | "ARTIFACT_UNREADABLE" | "OFFSET_OUT_OF_RANGE"
  | "CLEAR_FAILED" | "SHUTTING_DOWN" | "PLATFORM_UNSUPPORTED" | "CONFIG_MISSING" | "CURSOR_INVALID"
  | "NO_PERSISTENT_SESSION" | "SUPERVISOR_LOST" | "SUPERVISOR_FAULT" | "ACTIVATION_DISPOSED" | "PROTOCOL_ERROR" | "DELIVERY_UNCONFIRMED";

/** A domain failure; tools throw it so Pi records a failed tool result. */
export class BgTaskError extends Error {
  readonly code: ErrorCode;
  readonly task: TaskRecord | null;
  constructor(code: ErrorCode, message: string, task: TaskRecord | null = null) {
    super(`${code}: ${message}`);
    this.name = "BgTaskError";
    this.code = code;
    this.task = task;
  }
}

const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

export const ExitEvidenceSchema = Type.Union([
  Type.Object({ kind: Type.Literal("code"), code: Type.Integer() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("signal"), signal: Type.String() }, { additionalProperties: false }),
]);
export type ExitEvidence = Static<typeof ExitEvidenceSchema>;

export const TASK_STATES = ["running", "completed", "failed", "dead"] as const;
export type TaskState = (typeof TASK_STATES)[number];
export const TASK_PHASES = ["starting", "running", "closing", "stopping"] as const;
export type TaskPhase = (typeof TASK_PHASES)[number];
export const TASK_REASONS = [
  "exit", "exit_nonzero", "signaled", "terminated", "launch_failed", "descendants_remaining", "output_failed",
  "output_drain_timeout", "session_shutdown", "owner_lost", "supervisor_lost", "cleanup_unconfirmed",
] as const;
export type TaskReason = (typeof TASK_REASONS)[number];
export const NOTICE_STATUSES = ["pending", "received", "inline"] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];


export const TaskRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  seq: Type.Integer({ minimum: 1 }),
  sessionId: Type.String(),
  label: Type.String(),
  command: Type.String(),
  cwd: Type.String(),
  createdAt: Type.String(),
  startedAt: Nullable(Type.String()),
  endedAt: Nullable(Type.String()),
  activation: Type.String(),
  state: Type.Enum(TASK_STATES),
  phase: Nullable(Type.Enum(TASK_PHASES)),
  revision: Type.Integer({ minimum: 1 }),
  exit: Nullable(ExitEvidenceSchema),
  reason: Nullable(Type.Enum(TASK_REASONS)),
  reasonDetail: Nullable(Type.String()),
  logPath: Type.String(),
  logBytes: Type.Integer({ minimum: 0 }),
  notify: Type.Boolean(),
  event: Nullable(Type.Object({ id: Type.String(), status: Type.Enum(NOTICE_STATUSES) }, { additionalProperties: false })),
  pid: Nullable(Type.Integer()),
  pgid: Nullable(Type.Integer()),
  interruptedActivation: Nullable(Type.String()),
  clearing: Type.Boolean(),
  cleanupUnconfirmed: Type.Boolean(),
}, { additionalProperties: false });
export type TaskRecord = Static<typeof TaskRecordSchema> & { id: TaskId; sessionId: SessionId };

export function isFinalized(task: TaskRecord): boolean {
  return task.state !== "running";
}

export const TaskPageSchema = Type.Object({ items: Type.Array(TaskRecordSchema), upper: Type.Integer({ minimum: 0 }), next: Nullable(Type.Integer()) }, { additionalProperties: false });
export type TaskPage = { items: TaskRecord[]; upper: number; next: number | null };
export const NoticePageSchema = Type.Object({ items: Type.Array(TaskRecordSchema), next: Nullable(Type.Integer()) }, { additionalProperties: false });
export type NoticePage = { items: TaskRecord[]; next: number | null };
export const ReadReplySchema = Type.Object({ task: TaskRecordSchema, offset: Type.Integer({ minimum: 0 }), data: Type.String(), size: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export interface ReadWindow { task: TaskRecord; offset: number; bytes: Uint8Array; size: number }
export const TaskReplySchema = Type.Object({ task: TaskRecordSchema }, { additionalProperties: false });
export const SignalReplySchema = Type.Object({ task: TaskRecordSchema, signal: Type.Enum(SIGNAL_NAMES), delivered: Type.Boolean() }, { additionalProperties: false });
export interface SignalResult { task: TaskRecord; signal: SignalName; delivered: boolean }
export const ClearReplySchema = Type.Object({ id: Type.String(), removedBytes: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export interface ClearResult { id: TaskId; removedBytes: number }
export const ReceiptsReplySchema = Type.Object({ changed: Type.Array(Type.String()) }, { additionalProperties: false });
export const ShutdownReplySchema = Type.Object({ storageFailed: Nullable(Type.String()) }, { additionalProperties: false });
export const ErrorBodySchema = Type.Object({ code: Type.String(), message: Type.String(), task: Type.Optional(TaskRecordSchema) }, { additionalProperties: false });
export const ReplySchema = Type.Union([
  Type.Object({ v: Type.Literal(PROTOCOL_VERSION), type: Type.Literal("reply"), id: Type.Integer(), ok: Type.Literal(true), result: Type.Unknown() }, { additionalProperties: false }),
  Type.Object({ v: Type.Literal(PROTOCOL_VERSION), type: Type.Literal("reply"), id: Type.Integer(), ok: Type.Literal(false), error: ErrorBodySchema }, { additionalProperties: false }),
]);
export const ChangedSchema = Type.Object({ v: Type.Literal(PROTOCOL_VERSION), type: Type.Literal("changed"), terminal: Type.Boolean() }, { additionalProperties: false });
export const ReadySchema = Type.Object({ v: Type.Literal(PROTOCOL_VERSION), type: Type.Literal("ready"), activation: Type.String(), pid: Type.Integer(), recovered: Type.Array(Type.String()) }, { additionalProperties: false });
export const FatalSchema = Type.Object({ v: Type.Literal(PROTOCOL_VERSION), type: Type.Literal("fatal"), error: Type.Object({ code: Type.String(), message: Type.String() }) }, { additionalProperties: false });

/** Validate an untrusted value against a schema or fail with PROTOCOL_ERROR. */
export function expect<T extends TSchema>(schema: T, value: unknown, what: string): Static<T> {
  if (!Value.Check(schema, value)) {
    const first = [...Value.Errors(schema, value)][0];
    throw new BgTaskError("PROTOCOL_ERROR", `${what} failed validation${first ? ` at ${first.instancePath || "/"}: ${first.message}` : ""}`);
  }
  return value as Static<T>;
}

// ---- tool schema --------------------------------------------------------------

const TaskIdParam = Type.String({ minLength: 1, description: "Exact task ID as returned by spawn or list (no prefixes)" });

export const SpawnRequestSchema = Type.Object({
  action: Type.Literal("spawn"),
  label: Type.String({ minLength: 1, maxLength: MAX_LABEL_CHARS, description: "Short human-readable label" }),
  command: Type.String({ minLength: 1, maxLength: MAX_COMMAND_BYTES, description: "Shell command run with bash --noprofile --norc -c in its own PTY and process group" }),
  cwd: Type.String({ minLength: 1, maxLength: MAX_CWD_CHARS, description: "Absolute working directory" }),
  notify: Type.Boolean({ description: "true: post a completion notice and wake the agent; false: no proactive notice, inspect later" }),
}, { additionalProperties: false });
export const ListRequestSchema = Type.Object({
  action: Type.Literal("list"),
  cursor: Type.Union([Type.String(), Type.Null()], { description: "null for the first (newest) page, else nextCursor from the previous page" }),
  limit: Type.Integer({ minimum: 1, maximum: MAX_LIST_ITEMS }),
}, { additionalProperties: false });
export const ReadRequestSchema = Type.Object({
  action: Type.Literal("read"),
  id: TaskIdParam,
  offset: Type.Union([Type.Integer({ minimum: 0 }), Type.Literal("tail")], { description: "Byte offset into the terminal log, or \"tail\" for the last `limit` bytes" }),
  limit: Type.Integer({ minimum: 1, maximum: MAX_READ_BYTES, description: "Maximum raw log bytes to read" }),
}, { additionalProperties: false });
export const SignalRequestSchema = Type.Object({
  action: Type.Literal("signal"),
  id: TaskIdParam,
  signal: Type.Enum(SIGNAL_NAMES),
}, { additionalProperties: false });
export const TerminateRequestSchema = Type.Object({ action: Type.Literal("terminate"), id: TaskIdParam }, { additionalProperties: false });
export const NotifyRequestSchema = Type.Object({ action: Type.Literal("notify"), id: TaskIdParam, enabled: Type.Boolean() }, { additionalProperties: false });
export const ClearRequestSchema = Type.Object({ action: Type.Literal("clear"), id: TaskIdParam }, { additionalProperties: false });

export const BgTaskRequestSchema = Type.Union([
  SpawnRequestSchema, ListRequestSchema, ReadRequestSchema, SignalRequestSchema, TerminateRequestSchema, NotifyRequestSchema, ClearRequestSchema,
]);
export type BgTaskRequest = Static<typeof BgTaskRequestSchema>;
export type SpawnRequest = Static<typeof SpawnRequestSchema>;

export const BG_TASK_ACTIONS = ["spawn", "list", "read", "signal", "terminate", "notify", "clear"] as const;

/**
 * Flat parameters as models see them; `execute` then checks the per-action
 * union above. A top-level union reaches Anthropic models as an empty object
 * (pi-ai anthropic-messages convertTools keeps only top-level properties), and
 * a nested `request` object was sent as a JSON string by mimo-v2.6-pro, so
 * every parameter is a top-level primitive.
 */
export const BgTaskParamsSchema = Type.Object({
  action: Type.Enum(BG_TASK_ACTIONS, { description: "spawn | list | read | signal | terminate | notify | clear" }),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_LABEL_CHARS, description: "spawn: short human-readable label" })),
  command: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_COMMAND_BYTES, description: "spawn: shell command, run with bash --noprofile --norc -c in its own PTY and process group" })),
  cwd: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_CWD_CHARS, description: "spawn: absolute working directory" })),
  notify: Type.Optional(Type.Boolean({ description: "spawn (required): true posts a completion notice and wakes you; false sends none" })),
  cursor: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "list: null for the newest page, else nextCursor from the previous page" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_READ_BYTES, description: `list: page size 1..${MAX_LIST_ITEMS}; read: raw log bytes 1..${MAX_READ_BYTES}` })),
  id: Type.Optional(Type.String({ minLength: 1, description: "read/signal/terminate/notify/clear: exact task ID" })),
  offset: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Literal("tail")], { description: "read: byte offset into the terminal log, or \"tail\"" })),
  signal: Type.Optional(Type.Enum(SIGNAL_NAMES, { description: "signal: POSIX signal for the task's process group" })),
  enabled: Type.Optional(Type.Boolean({ description: "notify: completion notices on or off" })),
}, { additionalProperties: false });
export type BgTaskParams = Static<typeof BgTaskParamsSchema>;

// ---- cursors ------------------------------------------------------------------

export interface ListCursor { sessionId: SessionId; upper: number; after: number }

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, s: cursor.sessionId, u: cursor.upper, a: cursor.after })).toString("base64url");
}

const CursorSchema = Type.Object({ v: Type.Literal(1), s: Type.String(), u: Type.Integer({ minimum: 0 }), a: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });

export function decodeCursor(raw: string, sessionId: SessionId): ListCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new BgTaskError("CURSOR_INVALID", "cursor is not a list cursor; pass null for the first page");
  }
  if (!Value.Check(CursorSchema, parsed)) throw new BgTaskError("CURSOR_INVALID", "cursor is not a list cursor; pass null for the first page");
  if (parsed.s !== sessionId) throw new BgTaskError("CURSOR_INVALID", "cursor belongs to another session");
  return { sessionId, upper: parsed.u, after: parsed.a };
}

// ---- completion notices --------------------------------------------------------

export const CompletionEventSchema = Type.Object({
  taskId: Type.String(),
  eventId: Type.String(),
  state: Type.Enum(["completed", "failed", "dead"] as const),
  reason: Type.Enum(TASK_REASONS),
  logPath: Type.String(),
}, { additionalProperties: false });
export type CompletionEvent = Static<typeof CompletionEventSchema>;
export const CompletionDetailsSchema = Type.Object({
  schemaVersion: Type.Literal(COMPLETION_SCHEMA_VERSION),
  sessionId: Type.String(),
  events: Type.Array(CompletionEventSchema, { minItems: 1 }),
}, { additionalProperties: false });
export type CompletionDetails = Static<typeof CompletionDetailsSchema>;
