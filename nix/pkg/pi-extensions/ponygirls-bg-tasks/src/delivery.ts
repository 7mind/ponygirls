/**
 * Completion delivery: durable pending events (owned by the supervisor's
 * registry) are handed to Pi as one bounded custom follow-up batch at a time,
 * and acknowledged only when a matching complete entry is found in the native
 * session file. Guards are local to this activation.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { Value } from "typebox/value";
import type { TaskBackend } from "./backend.ts";
import {
  COMPLETION_CUSTOM_TYPE, COMPLETION_SCHEMA_VERSION, CompletionDetailsSchema, MAX_LIST_ITEMS, MAX_NOTICE_ATTEMPTS,
  MAX_NOTICE_BATCH, RECEIPT_CHECK_INTERVAL_MS, START_TIMEOUT_MS, type CompletionDetails, type CompletionEvent,
  type SessionId, type TaskRecord,
} from "./protocol.ts";
import { displayValue } from "./terminal-text.ts";
import { formatExit } from "./tool.ts";

export type AgentOutcome = "completed" | "aborted" | "error";

export interface CompletionMessage {
  customType: typeof COMPLETION_CUSTOM_TYPE;
  content: Array<{ type: "text"; text: string }>;
  display: true;
  details: CompletionDetails;
}

/** Finds event IDs that have a complete, validated completion entry in the native session history. */
export interface ReceiptSource {
  present(eventIds: Iterable<string>): Set<string>;
}

export interface NoticeSink {
  /** Hand a batch to Pi as a follow-up that requests a turn. Returning is not an acknowledgement. */
  submit(message: CompletionMessage): void;
}

export interface DeliveryReporter {
  unconfirmed(taskIds: string[], detail: string): void;
  error(error: unknown): void;
}

export interface DeliveryHost {
  /** This activation still owns the same session and is not tearing down. */
  isCurrent(): boolean;
  isIdle(): boolean;
}

export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemTimers: Timers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export type NoticeBackend = Pick<TaskBackend, "notices" | "setReceipts" | "logPath">;

type GuardState = "inflight" | "retry" | "deferred_after_abort" | "unconfirmed";
interface Guard { state: GuardState; attempts: number; taskId: string }
type Binding = { kind: "run"; generation: number } | { kind: "idle"; deadline: number };
interface InFlight { ids: Set<string>; binding: Binding }

const LOCAL_STATE_LABEL: Record<GuardState, string> = {
  inflight: "in flight",
  retry: "retrying",
  deferred_after_abort: "deferred after abort",
  unconfirmed: "unconfirmed",
};

export function completionText(tasks: readonly TaskRecord[], logPath: (task: TaskRecord) => string): string {
  const lines = tasks.map((task) => {
    const label = displayValue(task.label);
    const head = `${task.id} (${label})`;
    const where = `Read its output with bg_task read {id: "${task.id}"}; log ${displayValue(logPath(task))} (kept until explicitly cleared).`;
    if (task.state === "dead") {
      const root = task.exit ? `root ${formatExit(task.exit)} was observed` : "root exit is unknown";
      return `- ${head} is dead: supervision or group completion was interrupted (${task.reason}); ${root}. ${where}`;
    }
    return `- ${head} ${task.state}: ${formatExit(task.exit)} (${task.reason}). ${where}`;
  });
  return [`[bg-task] ${tasks.length === 1 ? "A background task finished" : `${tasks.length} background tasks finished`}:`, ...lines].join("\n");
}

export function buildCompletionMessage(sessionId: SessionId, tasks: readonly TaskRecord[], logPath: (task: TaskRecord) => string): CompletionMessage {
  const events: CompletionEvent[] = tasks.map((task) => {
    if (task.state === "running" || !task.event || !task.reason) throw new Error(`task ${task.id} has no terminal event`);
    return { taskId: task.id, eventId: task.event.id, state: task.state, reason: task.reason, logPath: logPath(task) };
  });
  return {
    customType: COMPLETION_CUSTOM_TYPE,
    content: [{ type: "text", text: completionText(tasks, logPath) }],
    display: true,
    details: { schemaVersion: COMPLETION_SCHEMA_VERSION, sessionId, events },
  };
}

/** Incremental scan of complete JSONL lines in the native session file. */
export class SessionFileReceipts implements ReceiptSource {
  private readonly file: string;
  private readonly sessionId: SessionId;
  private offset = 0;
  private inode = -1;
  private readonly found = new Set<string>();

  constructor(file: string, sessionId: SessionId) {
    this.file = file;
    this.sessionId = sessionId;
  }

  present(eventIds: Iterable<string>): Set<string> {
    this.scan();
    const out = new Set<string>();
    for (const id of eventIds) if (this.found.has(id)) out.add(id);
    return out;
  }

  private scan(): void {
    let fd: number;
    try {
      fd = openSync(this.file, "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    try {
      const st = fstatSync(fd);
      if (st.ino !== this.inode || st.size < this.offset) {
        this.inode = st.ino;
        this.offset = 0;
        this.found.clear();
      }
      if (st.size === this.offset) return;
      const buffer = Buffer.alloc(st.size - this.offset);
      let read = 0;
      while (read < buffer.length) {
        const n = readSync(fd, buffer, read, buffer.length - read, this.offset + read);
        if (n === 0) break;
        read += n;
      }
      const last = buffer.lastIndexOf(0x0a, read - 1);
      if (last < 0) return;
      const complete = buffer.subarray(0, last + 1).toString("utf8");
      this.offset += last + 1;
      for (const line of complete.split("\n")) {
        if (!line.includes(COMPLETION_CUSTOM_TYPE)) continue;
        let entry: { type?: unknown; customType?: unknown; details?: unknown };
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry.type !== "custom_message" || entry.customType !== COMPLETION_CUSTOM_TYPE) continue;
        if (!Value.Check(CompletionDetailsSchema, entry.details) || entry.details.sessionId !== this.sessionId) continue;
        for (const event of entry.details.events) this.found.add(event.eventId);
      }
    } finally {
      closeSync(fd);
    }
  }
}

/** Wire a newly started supervisor to the dispatcher: change hints and resume reconciliation. */
export function connectBackend(dispatcher: NoticeDispatcher, backend: NoticeBackend & Pick<TaskBackend, "onChanged">): void {
  // Any change can make an event eligible (a terminal commit, or re-enabling a muted task).
  backend.onChanged(() => dispatcher.terminal());
  void dispatcher.attach(backend);
}

export interface DispatcherDeps {
  sessionId: SessionId;
  receipts: ReceiptSource;
  sink: NoticeSink;
  reporter: DeliveryReporter;
  host: DeliveryHost;
  timers: Timers;
}

export class NoticeDispatcher {
  private readonly deps: DispatcherDeps;
  private backend: NoticeBackend | null = null;
  private readonly guards = new Map<string, Guard>();
  private inflight: InFlight | null = null;
  private running = false;
  private generation = 0;
  private outcome: AgentOutcome | undefined;
  private abortSeen = false;
  /** Explicit input was accepted; idle submissions wait for its run to start. */
  private inputRunDeadline: number | null = null;
  /** Deferred/unconfirmed events an explicit input will release when its run settles. */
  private opportunity: Set<string> | null = null;
  private readonly releasable = new Set<string>();
  private readonly pendingAcks = new Set<string>();
  private compacting = 0;
  /** Sendable events exist but the session was busy (e.g. branch summarization); poll until idle. */
  private waitingForIdle = false;
  private disposed = false;
  private draining = false;
  private drainAgain = false;
  private timer: unknown = null;

  constructor(deps: DispatcherDeps) {
    this.deps = deps;
  }

  /** Bind a ready supervisor: reconcile receipts against the session file, then drain. */
  async attach(backend: NoticeBackend): Promise<void> {
    this.backend = backend;
    try {
      let after: number | null = null;
      do {
        const page = await backend.notices("received", after, MAX_LIST_ITEMS);
        const ids = page.items.map((t) => t.event!.id);
        const present = this.deps.receipts.present(ids);
        const lost = ids.filter((id) => !present.has(id));
        // The receipt outlived its session entry (an unflushed suffix was lost): restore the notice.
        if (lost.length) await backend.setReceipts(lost, false);
        after = page.next;
      } while (after !== null && !this.disposed);
    } catch (error) {
      this.deps.reporter.error(error);
    }
    this.schedule();
  }

  localState(task: TaskRecord): string | null {
    const id = task.event?.id;
    const guard = id ? this.guards.get(id) : undefined;
    return guard ? LOCAL_STATE_LABEL[guard.state] : null;
  }

  // ---- lifecycle observations -------------------------------------------------

  agentStart(): void {
    if (this.running) return;
    this.running = true;
    this.generation++;
    this.outcome = undefined;
    this.abortSeen = false;
    this.inputRunDeadline = null;
    if (this.inflight?.binding.kind === "idle") this.inflight.binding = { kind: "run", generation: this.generation };
    this.schedule();
  }

  /** The current run's abort signal fired. */
  aborted(): void {
    if (this.running) this.abortSeen = true;
  }

  beforeSettle(outcome: AgentOutcome): void {
    this.outcome = outcome;
  }

  settled(): void {
    this.running = false;
    const outcome = this.outcome ?? (this.abortSeen ? "aborted" : undefined);
    const flight = this.inflight;
    if (flight && flight.binding.kind === "run" && flight.binding.generation === this.generation) {
      this.inflight = null;
      const present = this.deps.receipts.present(flight.ids);
      const unconfirmed: string[] = [];
      for (const id of flight.ids) {
        const guard = this.guards.get(id);
        if (!guard) continue;
        if (present.has(id)) {
          this.guards.delete(id);
          this.pendingAcks.add(id);
        } else if (outcome === "completed") {
          guard.state = guard.attempts < MAX_NOTICE_ATTEMPTS ? "retry" : "unconfirmed";
          if (guard.state === "unconfirmed") unconfirmed.push(guard.taskId);
        } else if (outcome === "aborted") {
          guard.state = "deferred_after_abort";
        } else {
          guard.state = "unconfirmed";
          unconfirmed.push(guard.taskId);
        }
      }
      if (unconfirmed.length) this.deps.reporter.unconfirmed(unconfirmed, outcome === "completed" ? "the retry settled without a session entry" : `the notification run ended with outcome ${outcome ?? "unknown"}`);
    }
    if (this.opportunity && outcome !== "aborted") {
      for (const id of this.opportunity) this.releasable.add(id);
      this.opportunity = null;
    }
    this.schedule();
  }

  /** Explicit user input (not extension-originated). */
  input(streaming: boolean): void {
    const waiting = [...this.guards].filter(([, g]) => g.state === "deferred_after_abort" || g.state === "unconfirmed").map(([id]) => id);
    if (waiting.length) this.opportunity = new Set([...(this.opportunity ?? []), ...waiting]);
    if (!this.running && !streaming) this.inputRunDeadline = this.deps.timers.now() + START_TIMEOUT_MS;
    this.armTimer();
  }

  compactionStarted(): void {
    this.compacting++;
  }

  compactionEnded(): void {
    this.compacting = Math.max(0, this.compacting - 1);
    this.schedule();
  }

  terminal(): void {
    this.schedule();
  }

  /** Stop submitting a task's notice (muted or cleared) without recalling an accepted queue item. */
  forget(task: TaskRecord): void {
    const id = task.event?.id;
    if (!id) return;
    this.guards.delete(id);
    if (this.inflight) {
      this.inflight.ids.delete(id);
      if (this.inflight.ids.size === 0) this.inflight = null;
    }
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) this.deps.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  // ---- scheduling -----------------------------------------------------------------

  private schedule(): void {
    if (this.disposed) return;
    queueMicrotask(() => void this.drain());
  }

  private needsTimer(): boolean {
    if (this.inflight || this.inputRunDeadline !== null || this.pendingAcks.size || this.waitingForIdle) return true;
    for (const g of this.guards.values()) if (g.state !== "retry") return true;
    return false;
  }

  private armTimer(): void {
    if (this.disposed || this.timer !== null || !this.needsTimer()) return;
    this.timer = this.deps.timers.setTimeout(() => {
      this.timer = null;
      this.tick();
    }, RECEIPT_CHECK_INTERVAL_MS);
  }

  private tick(): void {
    const now = this.deps.timers.now();
    if (this.inputRunDeadline !== null && now >= this.inputRunDeadline) this.inputRunDeadline = null;
    const flight = this.inflight;
    if (flight && flight.binding.kind === "idle" && now >= flight.binding.deadline) {
      const present = this.deps.receipts.present(flight.ids);
      const missing: string[] = [];
      for (const id of flight.ids) {
        const guard = this.guards.get(id);
        if (!guard) continue;
        if (present.has(id)) {
          this.guards.delete(id);
          this.pendingAcks.add(id);
        } else {
          guard.state = "unconfirmed";
          missing.push(guard.taskId);
        }
      }
      this.inflight = null;
      if (missing.length) this.deps.reporter.unconfirmed(missing, `no run started within ${START_TIMEOUT_MS} ms of submission`);
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      this.drainAgain = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.drainAgain = false;
        await this.drainOnce();
      } while (this.drainAgain && !this.disposed);
    } catch (error) {
      this.deps.reporter.error(error);
    } finally {
      this.draining = false;
      this.armTimer();
    }
  }

  private async drainOnce(): Promise<void> {
    const backend = this.backend;
    if (!backend || this.disposed || !this.deps.host.isCurrent()) return;
    // Every pending eligible event: guarded ones must not hide independent later completions.
    const eligible: TaskRecord[] = [];
    let after: number | null = null;
    do {
      const page = await backend.notices("eligible", after, MAX_LIST_ITEMS);
      eligible.push(...page.items.filter((t) => t.event !== null));
      after = page.next;
    } while (after !== null && !this.disposed);
    const candidates = new Set<string>([...this.guards.keys(), ...this.pendingAcks, ...eligible.map((t) => t.event!.id)]);
    const present = this.deps.receipts.present(candidates);
    for (const id of present) {
      this.guards.delete(id);
      this.inflight?.ids.delete(id);
      this.pendingAcks.delete(id);
    }
    if (this.inflight && this.inflight.ids.size === 0) this.inflight = null;
    const acks = [...present];
    for (let i = 0; i < acks.length; i += MAX_LIST_ITEMS) await backend.setReceipts(acks.slice(i, i + MAX_LIST_ITEMS), true);
    // An explicit input's run settled: release its deferred/unconfirmed events after this receipt check.
    for (const id of this.releasable) {
      const guard = this.guards.get(id);
      if (guard && (guard.state === "deferred_after_abort" || guard.state === "unconfirmed")) this.guards.delete(id);
    }
    this.releasable.clear();
    const eligibleIds = new Set(eligible.map((t) => t.event!.id));
    for (const [id, guard] of this.guards) if (guard.state !== "inflight" && !eligibleIds.has(id)) this.guards.delete(id);
    this.waitingForIdle = false;
    if (this.inflight || this.disposed) return;
    const sendable = eligible.filter((t) => {
      const guard = this.guards.get(t.event!.id);
      return !present.has(t.event!.id) && (!guard || guard.state === "retry");
    }).slice(0, MAX_NOTICE_BATCH);
    if (!sendable.length) return;
    if (this.compacting > 0) return;
    if (!this.running) {
      if (this.inputRunDeadline !== null && this.deps.timers.now() < this.inputRunDeadline) return;
      if (!this.deps.host.isIdle()) {
        this.waitingForIdle = true;
        return;
      }
    }
    // Fresh ownership check immediately before calling Pi.
    if (this.disposed || !this.deps.host.isCurrent() || this.inflight) return;
    for (const task of sendable) {
      const previous = this.guards.get(task.event!.id);
      this.guards.set(task.event!.id, { state: "inflight", attempts: (previous?.attempts ?? 0) + 1, taskId: task.id });
    }
    this.inflight = {
      ids: new Set(sendable.map((t) => t.event!.id)),
      binding: this.running ? { kind: "run", generation: this.generation } : { kind: "idle", deadline: this.deps.timers.now() + START_TIMEOUT_MS },
    };
    this.deps.sink.submit(buildCompletionMessage(this.deps.sessionId, sendable, (t) => backend.logPath(t)));
  }
}
