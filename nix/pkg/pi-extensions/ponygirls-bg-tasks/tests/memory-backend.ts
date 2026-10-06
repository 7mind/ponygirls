/**
 * Hand-written in-memory TaskBackend. It interprets a tiny fixture command
 * language: `echo TEXT; exit N`, `echo TEXT`, `exit N` finish on the next tick;
 * anything else keeps running until terminated, finished by the test, or shut down.
 */
import {
  BgTaskError, MAX_LIST_ITEMS, type ClearResult, type NoticePage, type ReadWindow, type SessionId, type SignalName,
  type SignalResult, type SpawnRequest, type TaskId, type TaskPage, type TaskReason, type TaskRecord,
} from "../src/protocol.ts";
import type { ShutdownReason, TaskBackend } from "../src/backend.ts";

const FIXTURE = /^(?:echo (?<text>[^;]*?))?(?:;?\s*exit (?<code>\d+))?$/;

export class MemoryTaskBackend implements TaskBackend {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly logs = new Map<string, Uint8Array>();
  private readonly listeners = new Set<(terminal: boolean) => void>();
  private nextSeq = 1;
  readonly signals: Array<{ id: string; signal: SignalName }> = [];
  shutdownReason: ShutdownReason | null = null;

  readonly sessionId: SessionId;
  readonly root: string;

  constructor(sessionId: SessionId, root = "/memory/session.jsonl.bg-tasks") {
    this.sessionId = sessionId;
    this.root = root;
  }

  private emit(terminal: boolean): void {
    for (const l of this.listeners) l(terminal);
  }

  private must(id: string): TaskRecord {
    const t = this.tasks.get(id);
    if (!t || t.clearing) throw new BgTaskError("NOT_FOUND", `no task ${id} in this session`);
    return t;
  }

  async spawn(request: Omit<SpawnRequest, "action">): Promise<TaskRecord> {
    if (!request.cwd.startsWith("/")) throw new BgTaskError("INVALID_REQUEST", "cwd must be an absolute path");
    if (this.shutdownReason) throw new BgTaskError("SHUTTING_DOWN", "the supervisor is shutting down");
    const id = `bgt-mem${String(this.nextSeq).padStart(4, "0")}` as TaskId;
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id, seq: this.nextSeq++, sessionId: this.sessionId, label: request.label, command: request.command, cwd: request.cwd,
      createdAt: now, startedAt: now, endedAt: null, activation: "memory", state: "running", phase: "running", revision: 2,
      exit: null, reason: null, reasonDetail: null, logPath: `tasks/${id}/terminal.log`, logBytes: 0, notify: request.notify,
      event: null, pid: null, pgid: null, interruptedActivation: null, clearing: false, cleanupUnconfirmed: false,
    };
    this.tasks.set(id, task);
    this.logs.set(id, new Uint8Array());
    const m = FIXTURE.exec(request.command.trim());
    if (m && (m.groups?.text !== undefined || m.groups?.code !== undefined)) {
      const output = m.groups?.text !== undefined ? `${m.groups.text}\r\n` : "";
      setImmediate(() => this.finish(id, Number(m.groups?.code ?? 0), output));
    }
    this.emit(false);
    return { ...task };
  }

  /** Test control: complete a running task with an exit code and output. */
  finish(id: string, code: number, output = ""): void {
    const t = this.tasks.get(id);
    if (!t || t.state !== "running") return;
    this.append(id, output);
    this.finalize(t, code === 0 ? "completed" : "failed", code === 0 ? "exit" : "exit_nonzero", { kind: "code", code });
  }

  append(id: string, output: string): void {
    const prev = this.logs.get(id)!;
    const add = new TextEncoder().encode(output);
    const next = new Uint8Array(prev.length + add.length);
    next.set(prev);
    next.set(add, prev.length);
    this.logs.set(id, next);
    this.tasks.get(id)!.logBytes = next.length;
  }

  private finalize(t: TaskRecord, state: "completed" | "failed" | "dead", reason: TaskReason, exit: TaskRecord["exit"], detail: string | null = null): void {
    t.revision += 1;
    t.state = state;
    t.phase = null;
    t.reason = reason;
    t.reasonDetail = detail;
    t.exit = exit;
    t.endedAt = new Date().toISOString();
    t.event = { id: `${t.id}:${t.revision}`, status: "pending" };
    this.emit(true);
  }

  async list(upper: number | null, after: number | null, limit: number): Promise<TaskPage> {
    if (limit < 1 || limit > MAX_LIST_ITEMS) throw new BgTaskError("INVALID_REQUEST", "limit out of range");
    const bound = upper ?? this.nextSeq - 1;
    const ordered = [...this.tasks.values()].filter((t) => t.seq <= bound && (after === null || t.seq < after)).sort((a, b) => b.seq - a.seq);
    const items = ordered.slice(0, limit).map((t) => ({ ...t }));
    return { items, upper: bound, next: ordered.length > limit && items.length ? items[items.length - 1]!.seq : null };
  }

  async get(id: TaskId): Promise<TaskRecord> {
    const t = this.tasks.get(id);
    if (!t) throw new BgTaskError("NOT_FOUND", `no task ${id} in this session`);
    return { ...t };
  }

  async read(id: TaskId, offset: number | "tail", limit: number): Promise<ReadWindow> {
    const t = this.must(id);
    const log = this.logs.get(id)!;
    const start = offset === "tail" ? Math.max(0, log.length - limit) : offset;
    if (start > log.length) throw new BgTaskError("OFFSET_OUT_OF_RANGE", `offset ${start} exceeds log size ${log.length}`);
    return { task: { ...t }, offset: start, bytes: log.slice(start, start + limit), size: log.length };
  }

  async signal(id: TaskId, signal: SignalName): Promise<SignalResult> {
    const t = this.must(id);
    if (t.state !== "running") throw new BgTaskError("TASK_FINALIZED", `task ${id} already finished`, { ...t });
    this.signals.push({ id, signal });
    return { task: { ...t }, signal, delivered: true };
  }

  async terminate(id: TaskId): Promise<TaskRecord> {
    const t = this.must(id);
    if (t.state === "running") this.finalize(t, "failed", "terminated", { kind: "signal", signal: "SIGTERM" });
    return { ...t };
  }

  async setNotify(id: TaskId, enabled: boolean): Promise<TaskRecord> {
    const t = this.must(id);
    t.notify = enabled;
    t.revision += 1;
    this.emit(false);
    return { ...t };
  }

  async clear(id: TaskId): Promise<ClearResult> {
    const t = this.must(id);
    if (t.state === "running") throw new BgTaskError("TASK_UNFINISHED", `task ${id} is ${t.phase}`, { ...t });
    this.tasks.delete(id);
    this.logs.delete(id);
    this.emit(false);
    return { id, removedBytes: t.logBytes };
  }

  async notices(status: "eligible" | "received", after: number | null, limit: number): Promise<NoticePage> {
    const match = (t: TaskRecord) => t.event !== null && (status === "eligible" ? t.event.status === "pending" && t.notify : t.event.status === "received");
    const ordered = [...this.tasks.values()].filter((t) => match(t) && (after === null || t.seq > after)).sort((a, b) => a.seq - b.seq);
    const items = ordered.slice(0, limit).map((t) => ({ ...t }));
    return { items, next: ordered.length > limit && items.length ? items[items.length - 1]!.seq : null };
  }

  async setReceipts(eventIds: readonly string[], received: boolean): Promise<string[]> {
    const from = received ? "pending" : "received";
    const changed: string[] = [];
    for (const t of this.tasks.values()) {
      if (t.event && eventIds.includes(t.event.id) && t.event.status === from) {
        t.event = { id: t.event.id, status: received ? "received" : "pending" };
        t.revision += 1;
        changed.push(t.event.id);
      }
    }
    return changed;
  }

  logPath(task: TaskRecord): string {
    return `${this.root}/${task.logPath}`;
  }

  onChanged(listener: (terminal: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async shutdown(reason: ShutdownReason): Promise<void> {
    this.shutdownReason = reason;
    for (const t of this.tasks.values()) if (t.state === "running") this.finalize(t, "failed", "session_shutdown", null, reason);
  }
}
