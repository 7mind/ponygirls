/** The `bg_task` agent tool: one discriminated request per call, bounded responses. */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import type { TaskBackend } from "./backend.ts";
import {
  BgTaskError, BgTaskParamsSchema, BgTaskRequestSchema, DEFAULT_LIST_LIMIT, LIST_LABEL_DISPLAY_CHARS, MAX_COMMAND_BYTES, MAX_TOOL_RESPONSE_BYTES, decodeCursor, encodeCursor,
  isFinalized, type BgTaskRequest, type ExitEvidence, type SessionId, type SignalName, type TaskId, type TaskRecord,
} from "./protocol.ts";
import { consumableLength, decodeAndSanitize, displayValue, leadingContinuationBytes, shorten } from "./terminal-text.ts";

export interface ToolHost {
  /** The current activation's task service; rejects when no persistent session owns one. */
  backend(): Promise<TaskBackend>;
  sessionId(): SessionId;
  /** Local delivery overlay for a task's completion notice (e.g. "deferred after abort"), if any. */
  noticeState(task: TaskRecord): string | null;
  /** A task's notice must no longer be submitted (muted or cleared). */
  noticeForgotten(task: TaskRecord): void;
}

export interface TaskSummary {
  id: string;
  seq: number;
  label: string;
  state: TaskRecord["state"];
  phase: TaskRecord["phase"];
  exit: ExitEvidence | null;
  reason: TaskRecord["reason"];
  notify: boolean;
  notice: string | null;
  logBytes: number;
  startedAt: string | null;
  endedAt: string | null;
  cleanupUnconfirmed: boolean;
}

export type BgTaskDetails =
  | { action: "spawn"; task: TaskSummary; logPath: string }
  | { action: "list"; items: TaskSummary[]; nextCursor: string | null }
  | { action: "read"; task: TaskSummary; offset: number; nextOffset: number; size: number; eof: boolean }
  | { action: "signal"; task: TaskSummary; signal: SignalName; delivered: boolean }
  | { action: "terminate"; task: TaskSummary }
  | { action: "notify"; task: TaskSummary }
  | { action: "clear"; id: string; removedBytes: number };

interface ToolOutput { text: string; details: BgTaskDetails }

export function formatExit(exit: ExitEvidence | null): string {
  if (!exit) return "exit unknown";
  return exit.kind === "code" ? `exit ${exit.code}` : `killed by ${exit.signal}`;
}

export function stateLabel(task: Pick<TaskRecord, "state" | "phase" | "cleanupUnconfirmed">): string {
  if (task.state !== "running") return task.state;
  return task.cleanupUnconfirmed ? `${task.phase}, cleanup unconfirmed` : (task.phase ?? "running");
}

export function noticeLabel(task: TaskRecord, local: string | null): string {
  if (!task.notify) return "notice off";
  if (local) return `notice ${local}`;
  if (!task.event) return "notice on";
  return task.event.status === "received" ? "notice delivered" : task.event.status === "inline" ? "reported inline" : "notice pending";
}

export function summarize(task: TaskRecord, notice: string | null): TaskSummary {
  return {
    id: task.id, seq: task.seq, label: shorten(task.label, LIST_LABEL_DISPLAY_CHARS), state: task.state, phase: task.phase,
    exit: task.exit, reason: task.reason, notify: task.notify, notice, logBytes: task.logBytes, startedAt: task.startedAt,
    endedAt: task.endedAt, cleanupUnconfirmed: task.cleanupUnconfirmed,
  };
}

export function elapsed(task: Pick<TaskRecord, "startedAt" | "createdAt" | "endedAt">, now: number): string {
  const start = Date.parse(task.startedAt ?? task.createdAt);
  const end = task.endedAt ? Date.parse(task.endedAt) : now;
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`;
}

export function taskLine(task: TaskRecord, local: string | null, now: number): string {
  const parts = [`${task.id} [${stateLabel(task)}] ${displayValue(shorten(task.label, LIST_LABEL_DISPLAY_CHARS))}`, elapsed(task, now)];
  if (task.exit || isFinalized(task)) parts.push(formatExit(task.exit));
  if (task.reason) parts.push(task.reason);
  parts.push(noticeLabel(task, local), `${task.logBytes} B`);
  return parts.join(" · ");
}

function encodedSize(output: ToolOutput): number {
  return Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text: output.text }], details: output.details }));
}

/** Longest prefix of `items` whose rendering fits `budget` bytes (at least one item when any exist and it fits). */
export function fitListItems<T>(items: T[], size: (subset: T[]) => number, budget: number): T[] {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(items.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return items.slice(0, lo);
}

const ACTION_SCHEMAS = new Map(BgTaskRequestSchema.anyOf.map((s) => [s.properties.action.const as string, s]));

function validate(params: unknown): BgTaskRequest {
  if (!Value.Check(BgTaskParamsSchema, params)) {
    const first = [...Value.Errors(BgTaskParamsSchema, params)][0];
    throw new BgTaskError("INVALID_REQUEST", `invalid bg_task arguments${first ? ` at ${first.instancePath || "/"}: ${first.message}` : ""}`);
  }
  const schema = ACTION_SCHEMAS.get(params.action)!;
  if (!Value.Check(schema, params)) {
    const fields = Object.keys(schema.properties).filter((k) => k !== "action");
    const first = [...Value.Errors(schema, params)][0];
    throw new BgTaskError("INVALID_REQUEST", `${params.action} takes exactly {${fields.join(", ")}}${first ? `; ${first.instancePath || "/"}: ${first.message}` : ""}`);
  }
  const request = params as BgTaskRequest;
  if (request.action === "spawn" && !request.cwd.startsWith("/")) throw new BgTaskError("INVALID_REQUEST", "cwd must be an absolute path");
  if (request.action === "spawn" && Buffer.byteLength(request.command) > MAX_COMMAND_BYTES) throw new BgTaskError("INVALID_REQUEST", `command exceeds ${MAX_COMMAND_BYTES} bytes`);
  return request;
}

export async function runBgTask(host: ToolHost, request: BgTaskRequest, signal: AbortSignal | undefined): Promise<ToolOutput> {
  const now = Date.now();
  if (request.action === "spawn") {
    // Cancellation before admission prevents the launch. Once the request is
    // sent, admission resolves and the task stays owned regardless of the turn.
    if (signal?.aborted) throw new BgTaskError("INVALID_REQUEST", "the tool call was aborted before the task was launched");
    const backend = await host.backend();
    if (signal?.aborted) throw new BgTaskError("INVALID_REQUEST", "the tool call was aborted before the task was launched");
    const task = await backend.spawn({ label: request.label, command: request.command, cwd: request.cwd, notify: request.notify });
    const logPath = backend.logPath(task);
    const guidance = request.notify
      ? "A completion notice will arrive when it finishes. Continue independent work, then end your turn when appropriate; do not sleep or poll for it."
      : "No completion notice will be sent (notify: false); inspect it later with list/read.";
    return {
      text: `Started ${task.id} (${displayValue(task.label)}): ${stateLabel(task)}. Log: ${logPath}. ${guidance}`,
      details: { action: "spawn", task: summarize(task, null), logPath },
    };
  }
  const backend = await host.backend();
  switch (request.action) {
    case "list": {
      const cursor = decodeCursor(request.cursor ?? null, host.sessionId());
      const page = await backend.list(cursor?.upper ?? null, cursor?.after ?? null, request.limit ?? DEFAULT_LIST_LIMIT);
      const render = (items: TaskRecord[], more: boolean): ToolOutput => {
        const last = items[items.length - 1];
        const nextCursor = more && last ? encodeCursor({ sessionId: host.sessionId(), upper: page.upper, after: last.seq }) : null;
        const lines = items.map((t) => taskLine(t, host.noticeState(t), now));
        const tail = nextCursor ? `More history: call list with cursor "${nextCursor}".` : "End of retained history.";
        return {
          text: [items.length ? `${items.length} task(s), newest first:` : "No retained tasks in this range.", ...lines, tail].join("\n"),
          details: { action: "list", items: items.map((t) => summarize(t, host.noticeState(t))), nextCursor },
        };
      };
      const fitted = fitListItems(page.items, (subset) => encodedSize(render(subset, true)), MAX_TOOL_RESPONSE_BYTES);
      return render(fitted, fitted.length < page.items.length || page.next !== null);
    }
    case "read": {
      const window = await backend.read(request.id as TaskId, request.offset, request.limit);
      const lead = request.offset === "tail" ? leadingContinuationBytes(window.bytes) : 0;
      const start = window.offset + lead;
      const bytes = window.bytes.subarray(lead);
      const finalized = isFinalized(window.task);
      const render = (take: number, atFinalEnd: boolean): ToolOutput => {
        const slice = bytes.subarray(0, take);
        let n = consumableLength(slice, atFinalEnd);
        if (n === 0 && slice.length > 0 && take === bytes.length) n = slice.length;
        const next = start + n;
        const eof = finalized && next >= window.size;
        const header = `${window.task.id} [${stateLabel(window.task)}] bytes ${start}–${next} of ${window.size}${eof ? " (end of log)" : `; next offset ${next}`}`;
        return {
          text: `${header}\n${decodeAndSanitize(slice.subarray(0, n))}`,
          details: { action: "read", task: summarize(window.task, host.noticeState(window.task)), offset: start, nextOffset: next, size: window.size, eof },
        };
      };
      let take = bytes.length;
      let output = render(take, finalized && start + take >= window.size);
      while (encodedSize(output) > MAX_TOOL_RESPONSE_BYTES && take > 1) {
        take = Math.floor(take / 2);
        output = render(take, false);
      }
      return output;
    }
    case "signal": {
      const r = await backend.signal(request.id as TaskId, request.signal);
      return {
        text: `${r.delivered ? "Sent" : "Could not deliver"} ${r.signal} to ${r.task.id}'s process group. Its state is observation-based and still ${stateLabel(r.task)}.`,
        details: { action: "signal", task: summarize(r.task, host.noticeState(r.task)), signal: r.signal, delivered: r.delivered },
      };
    }
    case "terminate": {
      const task = await backend.terminate(request.id as TaskId);
      return {
        text: `${task.id} finished: ${task.state} (${task.reason}), ${formatExit(task.exit)}. Its log is retained until cleared.`,
        details: { action: "terminate", task: summarize(task, host.noticeState(task)) },
      };
    }
    case "notify": {
      const task = await backend.setNotify(request.id as TaskId, request.enabled);
      if (!request.enabled) host.noticeForgotten(task);
      const note = request.enabled ? "on" : "off (a notice already handed to Pi cannot be recalled)";
      return {
        text: `Completion notices for ${task.id} are ${note}.`,
        details: { action: "notify", task: summarize(task, host.noticeState(task)) },
      };
    }
    case "clear": {
      const before = await backend.get(request.id as TaskId);
      const r = await backend.clear(request.id as TaskId);
      host.noticeForgotten(before);
      return {
        text: `Cleared ${r.id}: its record and terminal log (${r.removedBytes} B) were removed.`,
        details: { action: "clear", id: r.id, removedBytes: r.removedBytes },
      };
    }
  }
}

const DESCRIPTION = [
  "Run and manage local background shell commands in this session. Each task gets its own PTY and process group;",
  "output is kept on disk until explicitly cleared. Pass `action` plus that action's fields:",
  "spawn {label, command, cwd (absolute), notify} returns immediately after launch;",
  "list {cursor (default null = newest page), limit (default 50)} pages through all retained tasks;",
  "read {id, offset (byte offset or \"tail\"), limit} returns sanitized output and the next offset;",
  "signal {id, signal} sends one POSIX signal to the task's group; terminate {id} sends TERM, escalates to KILL, and reports the observed outcome;",
  "notify {id, enabled} changes the completion-notice policy; clear {id} deletes a finished task's record and log.",
  "With notify: true you will receive a completion message and a new turn: continue independent work and end your turn instead of sleeping or polling.",
  "notify: false sends no notice; inspect such tasks explicitly. Finished tasks are completed, failed, or dead (supervision interrupted).",
].join(" ");

export function createBgTaskTool(host: ToolHost): ToolDefinition<typeof BgTaskParamsSchema, BgTaskDetails> {
  return {
    name: "bg_task",
    label: "Background task",
    description: DESCRIPTION,
    promptSnippet: "bg_task: launch, inspect, signal, terminate, mute, and clear background shell tasks with completion notices",
    parameters: BgTaskParamsSchema,
    async execute(_toolCallId, params, signal) {
      const request = validate(params);
      const output = await runBgTask(host, request, signal);
      return { content: [{ type: "text", text: output.text }], details: output.details };
    },
  };
}
