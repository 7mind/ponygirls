/**
 * The task-service boundary used by the tool, the viewer, and the completion
 * sender, and its production adapter: a private-pipe client of the Python
 * supervisor (one per activation).
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import type { TSchema, Static } from "typebox";
import {
  BgTaskError, ChangedSchema, ClearReplySchema, FatalSchema, NoticePageSchema, PROTOCOL_VERSION, ReadReplySchema,
  ReadySchema, ReceiptsReplySchema, ReplySchema, ShutdownReplySchema, SignalReplySchema, SUPERVISOR_SHUTDOWN_WAIT_MS,
  TaskPageSchema, TaskReplySchema, expect, type ClearResult, type ErrorCode, type NoticePage, type ReadWindow,
  type SignalName, type SignalResult, type SpawnRequest, type TaskId, type TaskPage, type TaskRecord,
} from "./protocol.ts";

export type ShutdownReason = "quit" | "reload" | "new" | "resume" | "fork";

export interface TaskBackend {
  spawn(request: Omit<SpawnRequest, "action">): Promise<TaskRecord>;
  list(upper: number | null, after: number | null, limit: number): Promise<TaskPage>;
  get(id: TaskId): Promise<TaskRecord>;
  read(id: TaskId, offset: number | "tail", limit: number): Promise<ReadWindow>;
  signal(id: TaskId, signal: SignalName): Promise<SignalResult>;
  terminate(id: TaskId): Promise<TaskRecord>;
  setNotify(id: TaskId, enabled: boolean): Promise<TaskRecord>;
  clear(id: TaskId): Promise<ClearResult>;
  notices(status: "eligible" | "received", after: number | null, limit: number): Promise<NoticePage>;
  setReceipts(eventIds: readonly string[], received: boolean): Promise<string[]>;
  /** Absolute path of a task's terminal log. */
  logPath(task: TaskRecord): string;
  /** Subscribe to coalesced change hints; `terminal` marks a newly committed outcome. */
  onChanged(listener: (terminal: boolean) => void): () => void;
  shutdown(reason: ShutdownReason): Promise<void>;
}

export interface SupervisorLaunch {
  python: string;
  script: string;
  shell: string;
  sidecar: string;
  sessionId: string;
  handoffWaitMs: number;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
const STDERR_LINES_KEPT = 20;

const ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "INVALID_REQUEST", "NOT_FOUND", "TASK_UNFINISHED", "TASK_CLOSING", "TASK_FINALIZED", "SESSION_BUSY",
  "SESSION_CLOSING_GROUP", "STORAGE_FAILED", "STORE_CORRUPT", "UNSUPPORTED_SCHEMA", "UNSUPPORTED_PROTOCOL",
  "LAUNCH_FAILED", "TERMINATION_UNCONFIRMED", "ARTIFACT_MISSING", "ARTIFACT_UNREADABLE", "OFFSET_OUT_OF_RANGE",
  "CLEAR_FAILED", "SHUTTING_DOWN", "PLATFORM_UNSUPPORTED", "CONFIG_MISSING", "SUPERVISOR_FAULT",
]);

function toError(code: string, message: string, task: TaskRecord | null): BgTaskError {
  if (!ERROR_CODES.has(code)) return new BgTaskError("PROTOCOL_ERROR", `unknown supervisor error ${code}: ${message}`);
  return new BgTaskError(code as ErrorCode, message, task);
}

export class SupervisorBackend implements TaskBackend {
  private readonly child: ChildProcessByStdio<Writable, Readable, Readable>;
  private readonly launch: SupervisorLaunch;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(terminal: boolean) => void>();
  private readonly stderrTail: string[] = [];
  private nextId = 1;
  private buffer = "";
  private lost: BgTaskError | null = null;
  private greeting: { resolve: (line: string) => void; reject: (error: Error) => void } | null = null;
  private readonly exited: Promise<void>;
  readonly activationId: string;
  private recoveredIds: readonly string[] = [];

  private constructor(launch: SupervisorLaunch) {
    this.launch = launch;
    this.activationId = randomUUID();
    // Own session/process group, private pipes, explicit interpreter. Not unref'd:
    // the pipes are the owner-liveness channel.
    this.child = spawn(launch.python, [launch.script, "--sidecar", launch.sidecar, "--session-id", launch.sessionId,
      "--activation", this.activationId, "--shell", launch.shell, "--handoff-wait-ms", String(launch.handoffWaitMs)],
      { detached: true, stdio: ["pipe", "pipe", "pipe"] });
    // One permanent listener per stream; setEncoding keeps multibyte characters intact across chunks.
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (text: string) => this.onData(text));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (text: string) => {
      for (const line of text.split("\n").filter(Boolean)) this.remember(line);
    });
    this.child.stdin.on("error", () => {});
    this.exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    void this.exited.then(() => this.markLost(new BgTaskError("SUPERVISOR_LOST", `the task supervisor exited${this.stderrTail.length ? `: ${this.stderrTail.join(" | ")}` : ""}`)));
  }

  static async start(launch: SupervisorLaunch): Promise<SupervisorBackend> {
    const backend = new SupervisorBackend(launch);
    const line = await new Promise<string>((resolve, reject) => {
      backend.greeting = { resolve, reject };
      backend.child.once("error", (e) => reject(new BgTaskError("CONFIG_MISSING", `cannot start supervisor: ${e.message}`)));
      if (backend.lost) reject(backend.lost);
    });
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      throw new BgTaskError("PROTOCOL_ERROR", `unparsable supervisor greeting: ${line.slice(0, 200)}`);
    }
    if ((message as { type?: unknown }).type === "fatal") {
      const fatal = expect(FatalSchema, message, "supervisor fatal message");
      await backend.exited;
      throw toError(fatal.error.code, fatal.error.message, null);
    }
    backend.recoveredIds = expect(ReadySchema, message, "supervisor greeting").recovered;
    return backend;
  }

  get recovered(): readonly string[] {
    return this.recoveredIds;
  }

  get diagnostics(): string {
    return this.stderrTail.join("\n");
  }

  get isLost(): boolean {
    return this.lost !== null;
  }

  private remember(line: string): void {
    this.stderrTail.push(line);
    if (this.stderrTail.length > STDERR_LINES_KEPT) this.stderrTail.shift();
  }

  private markLost(error: BgTaskError): void {
    if (this.lost) return;
    this.lost = error;
    this.greeting?.reject(error);
    this.greeting = null;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  private onData(text: string): void {
    this.buffer += text;
    for (;;) {
      const nl = this.buffer.indexOf("\n");
      if (nl < 0) return;
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.trim()) continue;
      if (this.greeting) {
        const greeting = this.greeting;
        this.greeting = null;
        greeting.resolve(line);
        continue;
      }
      try {
        this.onLine(line);
      } catch (error) {
        // A protocol violation is an invariant failure: stop trusting this supervisor.
        this.remember(`protocol violation: ${error instanceof Error ? error.message : String(error)}`);
        this.markLost(error instanceof BgTaskError ? error : new BgTaskError("PROTOCOL_ERROR", String(error)));
        this.child.stdin.end();
      }
    }
  }

  private onLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      throw new BgTaskError("PROTOCOL_ERROR", `unparsable protocol line: ${line.slice(0, 200)}`);
    }
    const type = (message as { type?: unknown }).type;
    if (type === "changed") {
      const changed = expect(ChangedSchema, message, "change hint");
      for (const listener of this.listeners) listener(changed.terminal);
      return;
    }
    const reply = expect(ReplySchema, message, "supervisor reply");
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    this.pending.delete(reply.id);
    if (reply.ok) pending.resolve(reply.result);
    else pending.reject(toError(reply.error.code, reply.error.message, (reply.error.task as TaskRecord | undefined) ?? null));
  }

  private request<T extends TSchema>(op: string, args: Record<string, unknown>, schema: T): Promise<Static<T>> {
    if (this.lost) return Promise.reject(this.lost);
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ v: PROTOCOL_VERSION, id, op, args })}\n`);
    }).then((result) => expect(schema, result, `${op} result`));
  }

  async spawn(request: Omit<SpawnRequest, "action">): Promise<TaskRecord> {
    const r = await this.request("spawn", { label: request.label, command: request.command, cwd: request.cwd, notify: request.notify }, TaskReplySchema);
    return r.task as TaskRecord;
  }

  async list(upper: number | null, after: number | null, limit: number): Promise<TaskPage> {
    return (await this.request("list", { upper, after, limit }, TaskPageSchema)) as TaskPage;
  }

  async get(id: TaskId): Promise<TaskRecord> {
    return (await this.request("get", { id }, TaskReplySchema)).task as TaskRecord;
  }

  async read(id: TaskId, offset: number | "tail", limit: number): Promise<ReadWindow> {
    const r = await this.request("read", { id, offset, limit }, ReadReplySchema);
    return { task: r.task as TaskRecord, offset: r.offset, bytes: new Uint8Array(Buffer.from(r.data, "base64")), size: r.size };
  }

  async signal(id: TaskId, signal: SignalName): Promise<SignalResult> {
    const r = await this.request("signal", { id, signal }, SignalReplySchema);
    return { task: r.task as TaskRecord, signal: r.signal, delivered: r.delivered };
  }

  async terminate(id: TaskId): Promise<TaskRecord> {
    return (await this.request("terminate", { id }, TaskReplySchema)).task as TaskRecord;
  }

  async setNotify(id: TaskId, enabled: boolean): Promise<TaskRecord> {
    return (await this.request("notify", { id, enabled }, TaskReplySchema)).task as TaskRecord;
  }

  async clear(id: TaskId): Promise<ClearResult> {
    const r = await this.request("clear", { id }, ClearReplySchema);
    return { id: r.id as TaskId, removedBytes: r.removedBytes };
  }

  async notices(status: "eligible" | "received", after: number | null, limit: number): Promise<NoticePage> {
    return (await this.request("notices", { status, after, limit }, NoticePageSchema)) as NoticePage;
  }

  async setReceipts(eventIds: readonly string[], received: boolean): Promise<string[]> {
    return (await this.request("receipts", { eventIds: [...eventIds], received }, ReceiptsReplySchema)).changed;
  }

  logPath(task: TaskRecord): string {
    return `${this.launch.sidecar}/${task.logPath}`;
  }

  onChanged(listener: (terminal: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Graceful teardown: the supervisor stops owned tasks, commits outcomes, releases its lock, exits. */
  async shutdown(reason: ShutdownReason): Promise<void> {
    if (!this.lost) {
      try {
        await this.request("shutdown", { reason }, ShutdownReplySchema);
      } catch (error) {
        if (!(error instanceof BgTaskError && error.code === "SUPERVISOR_LOST")) throw error;
      }
    }
    this.child.stdin.end();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      this.exited.then(() => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), SUPERVISOR_SHUTDOWN_WAIT_MS); }),
    ]);
    clearTimeout(timer);
    if (timedOut) throw new BgTaskError("SUPERVISOR_LOST", `supervisor did not exit within ${SUPERVISOR_SHUTDOWN_WAIT_MS} ms; its stdin is closed so it will finish owner-loss cleanup`);
  }
}
