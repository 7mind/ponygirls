/**
 * Completion delivery: durable pending events (owned by the supervisor's
 * registry) are handed to Pi as one bounded custom follow-up batch at a time,
 * and acknowledged only when the native session file holds a matching complete
 * entry that a successful assistant response descends from. Undelivered or
 * unanswered notices are re-submitted automatically with backoff; only a user
 * abort holds a notice until the next explicit input. Guards are local to this
 * activation.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { Value } from "typebox/value";
import type { TaskBackend } from "./backend.ts";
import {
  COMPLETION_CUSTOM_TYPE, COMPLETION_SCHEMA_VERSION, CompletionDetailsSchema, MAX_LIST_ITEMS, MAX_NOTICE_BATCH,
  RECEIPT_CHECK_INTERVAL_MS, START_TIMEOUT_MS, retryDelayMs, type CompletionDetails, type CompletionEvent,
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

export interface Receipts {
  /** Events with a complete, validated completion entry in the native session file. */
  present: Set<string>;
  /** Present events that a successful assistant response descends from (in the session tree). */
  answered: Set<string>;
}

/** Classifies event IDs against the native session history. */
export interface ReceiptSource {
  scan(eventIds: Iterable<string>): Receipts;
}

export interface NoticeSink {
  /** Hand a batch to Pi as a follow-up that requests a turn. Returning is not an acknowledgement. */
  submit(message: CompletionMessage): void;
}

export interface DeliveryReporter {
  /** A notice was not delivered or not answered; it is re-submitted automatically after `retryInMs`. */
  unconfirmed(taskIds: string[], detail: string, retryInMs: number): void;
  /** Reading or acknowledging notices failed; the next attempt is due after `retryInMs`. */
  error(error: unknown, retryInMs: number): void;
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

type GuardState = "inflight" | "retry" | "deferred_after_abort";
/** `attempts` counts submissions; a `retry` guard is due at `notBefore`. */
interface Guard { state: GuardState; attempts: number; taskId: string; notBefore: number }
type Binding = { kind: "run"; generation: number } | { kind: "idle"; deadline: number };
interface InFlight { ids: Set<string>; binding: Binding }

const LOCAL_STATE_LABEL: Record<GuardState, string> = {
  inflight: "in flight",
  retry: "retrying",
  deferred_after_abort: "deferred after abort",
};

/** Assistant stop reasons that do not count as a response to a notice. */
const UNANSWERED_STOP_REASONS: ReadonlySet<unknown> = new Set(["error", "aborted"]);

/** `resent`: the session already holds an earlier, unanswered notice for some of these events. */
export function completionText(tasks: readonly TaskRecord[], logPath: (task: TaskRecord) => string, resent: boolean): string {
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
  const head = tasks.length === 1 ? "A background task finished" : `${tasks.length} background tasks finished`;
  const repeat = resent ? " (re-sent: the earlier notice got no successful response)" : "";
  return [`[bg-task] ${head}${repeat}:`, ...lines].join("\n");
}

export function buildCompletionMessage(sessionId: SessionId, tasks: readonly TaskRecord[], logPath: (task: TaskRecord) => string, resent: boolean): CompletionMessage {
  const events: CompletionEvent[] = tasks.map((task) => {
    if (task.state === "running" || !task.event || !task.reason) throw new Error(`task ${task.id} has no terminal event`);
    return { taskId: task.id, eventId: task.event.id, state: task.state, reason: task.reason, logPath: logPath(task) };
  });
  return {
    customType: COMPLETION_CUSTOM_TYPE,
    content: [{ type: "text", text: completionText(tasks, logPath, resent) }],
    display: true,
    details: { schemaVersion: COMPLETION_SCHEMA_VERSION, sessionId, events },
  };
}

/**
 * Incremental scan of complete JSONL lines in the native session file. It keeps
 * the entry tree (id -> parentId) so that an answer is credited only to the
 * notices it descends from.
 */
export class SessionFileReceipts implements ReceiptSource {
  private readonly file: string;
  private readonly sessionId: SessionId;
  private offset = 0;
  private inode = -1;
  private readonly found = new Set<string>();
  private readonly answered = new Set<string>();
  private readonly parents = new Map<string, string | null>();
  /** Completion entries by entry ID: the event IDs each one carries. */
  private readonly notices = new Map<string, string[]>();
  /** Entries already known to be ancestors of a successful assistant response. */
  private readonly answeredAncestors = new Set<string>();

  constructor(file: string, sessionId: SessionId) {
    this.file = file;
    this.sessionId = sessionId;
  }

  scan(eventIds: Iterable<string>): Receipts {
    this.read();
    const out: Receipts = { present: new Set(), answered: new Set() };
    for (const id of eventIds) {
      if (this.found.has(id)) out.present.add(id);
      if (this.answered.has(id)) out.answered.add(id);
    }
    return out;
  }

  private reset(): void {
    this.offset = 0;
    this.found.clear();
    this.answered.clear();
    this.parents.clear();
    this.notices.clear();
    this.answeredAncestors.clear();
  }

  private read(): void {
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
        this.reset();
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
        if (line) this.entry(line);
      }
    } finally {
      closeSync(fd);
    }
  }

  private entry(line: string): void {
    let entry: { type?: unknown; id?: unknown; parentId?: unknown; customType?: unknown; details?: unknown; message?: { role?: unknown; stopReason?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof entry.id !== "string") return;
    const parent = typeof entry.parentId === "string" ? entry.parentId : null;
    this.parents.set(entry.id, parent);
    if (entry.type === "custom_message" && entry.customType === COMPLETION_CUSTOM_TYPE) {
      if (!Value.Check(CompletionDetailsSchema, entry.details) || entry.details.sessionId !== this.sessionId) return;
      const events = entry.details.events.map((event) => event.eventId);
      for (const id of events) this.found.add(id);
      this.notices.set(entry.id, events);
      return;
    }
    if (entry.type === "message" && entry.message?.role === "assistant" && !UNANSWERED_STOP_REASONS.has(entry.message.stopReason)) {
      // Each entry joins the ancestor set once, so the walks cost O(entries) in total.
      for (let id: string | null = parent; id !== null && !this.answeredAncestors.has(id); id = this.parents.get(id) ?? null) {
        this.answeredAncestors.add(id);
        for (const event of this.notices.get(id) ?? []) this.answered.add(event);
      }
    }
  }
}

/** Wire a newly started supervisor to the dispatcher: change hints and resume reconciliation. */
export function connectBackend(dispatcher: NoticeDispatcher, backend: NoticeBackend & Pick<TaskBackend, "onChanged">): void {
  // Any change can make an event eligible (a terminal commit, or re-enabling a muted task).
  backend.onChanged(() => dispatcher.terminal());
  dispatcher.attach(backend);
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
  /** The attached supervisor's received marks still need checking against the session file. */
  private reconcilePending = false;
  private readonly guards = new Map<string, Guard>();
  private inflight: InFlight | null = null;
  private running = false;
  private generation = 0;
  private outcome: AgentOutcome | undefined;
  private abortSeen = false;
  /** Explicit input was accepted; idle submissions wait for its run to start. */
  private inputRunDeadline: number | null = null;
  /** Held or backing-off events an explicit input will release when its run settles. */
  private opportunity: Set<string> | null = null;
  private readonly releasable = new Set<string>();
  private readonly pendingAcks = new Set<string>();
  private compacting = 0;
  /** Sendable events exist but the session was busy (e.g. branch summarization); poll until idle. */
  private waitingForIdle = false;
  /** Consecutive failed drains, and when the next timer-driven drain is due. */
  private drainFailures = 0;
  private drainRetryAt: number | null = null;
  private disposed = false;
  private draining = false;
  private drainAgain = false;
  private timer: unknown = null;
  private timerDue = 0;

  constructor(deps: DispatcherDeps) {
    this.deps = deps;
  }

  /** Bind a ready supervisor: reconcile receipts against the session file, then drain. */
  attach(backend: NoticeBackend): void {
    this.backend = backend;
    this.reconcilePending = true;
    this.drainFailures = 0;
    this.drainRetryAt = null;
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
      const receipts = this.deps.receipts.scan(flight.ids);
      const failed: Guard[] = [];
      for (const id of flight.ids) {
        const guard = this.guards.get(id);
        if (!guard) continue;
        if (receipts.answered.has(id)) {
          this.guards.delete(id);
          this.pendingAcks.add(id);
        } else if (outcome === "aborted") {
          // The user stopped this run: hold the notice until explicit input.
          guard.state = "deferred_after_abort";
        } else {
          this.backOff(guard);
          // A follow-up dropped once before a successful settle is retried quietly.
          if (outcome !== "completed" || guard.attempts > 1 || receipts.present.has(id)) failed.push(guard);
        }
      }
      if (failed.length) this.report(failed, outcome === "completed" ? "the run settled without a response to it" : `the notification run ended with outcome ${outcome ?? "unknown"}`);
    }
    if (this.opportunity && outcome !== "aborted") {
      for (const id of this.opportunity) this.releasable.add(id);
      this.opportunity = null;
    }
    this.schedule();
  }

  /** Explicit user input (not extension-originated). */
  input(streaming: boolean): void {
    const waiting = [...this.guards].filter(([, g]) => g.state !== "inflight").map(([id]) => id);
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

  private backOff(guard: Guard): void {
    guard.state = "retry";
    guard.notBefore = this.deps.timers.now() + retryDelayMs(guard.attempts);
  }

  private report(guards: readonly Guard[], detail: string): void {
    const now = this.deps.timers.now();
    this.deps.reporter.unconfirmed(guards.map((g) => g.taskId), detail, Math.min(...guards.map((g) => g.notBefore - now)));
  }

  private schedule(): void {
    if (this.disposed) return;
    queueMicrotask(() => void this.drain());
  }

  /** Earliest time a timer-driven check is needed, or null when only lifecycle events can change anything. */
  private nextWake(now: number): number | null {
    const due: number[] = [];
    if (this.inflight || this.inputRunDeadline !== null || this.pendingAcks.size || this.waitingForIdle) due.push(now + RECEIPT_CHECK_INTERVAL_MS);
    for (const g of this.guards.values()) due.push(g.state === "retry" ? g.notBefore : now + RECEIPT_CHECK_INTERVAL_MS);
    if (this.drainRetryAt !== null) due.push(this.drainRetryAt);
    return due.length ? Math.min(...due) : null;
  }

  private armTimer(): void {
    if (this.disposed) return;
    const now = this.deps.timers.now();
    const due = this.nextWake(now);
    if (due === null) return;
    // Something already due could not go out (busy session): poll instead of spinning.
    const at = due > now ? due : now + RECEIPT_CHECK_INTERVAL_MS;
    if (this.timer !== null) {
      if (this.timerDue <= at) return;
      this.deps.timers.clearTimeout(this.timer);
    }
    this.timerDue = at;
    this.timer = this.deps.timers.setTimeout(() => {
      this.timer = null;
      this.tick();
    }, at - now);
  }

  private tick(): void {
    const now = this.deps.timers.now();
    if (this.inputRunDeadline !== null && now >= this.inputRunDeadline) this.inputRunDeadline = null;
    if (this.drainRetryAt !== null && now >= this.drainRetryAt) this.drainRetryAt = null;
    const flight = this.inflight;
    if (flight && flight.binding.kind === "idle" && now >= flight.binding.deadline) {
      const receipts = this.deps.receipts.scan(flight.ids);
      const failed: Guard[] = [];
      for (const id of flight.ids) {
        const guard = this.guards.get(id);
        if (!guard) continue;
        if (receipts.answered.has(id)) {
          this.guards.delete(id);
          this.pendingAcks.add(id);
        } else {
          this.backOff(guard);
          failed.push(guard);
        }
      }
      this.inflight = null;
      if (failed.length) this.report(failed, `no run started within ${START_TIMEOUT_MS} ms of submission`);
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
      this.drainFailures = 0;
      this.drainRetryAt = null;
    } catch (error) {
      this.drainFailures++;
      const delay = retryDelayMs(this.drainFailures);
      this.drainRetryAt = this.deps.timers.now() + delay;
      this.deps.reporter.error(error, delay);
    } finally {
      this.draining = false;
      this.armTimer();
    }
  }

  /** Restore received marks whose answer is not in the session file (a lost unflushed suffix, or never answered). */
  private async reconcile(backend: NoticeBackend): Promise<void> {
    let after: number | null = null;
    do {
      const page = await backend.notices("received", after, MAX_LIST_ITEMS);
      const ids = page.items.map((t) => t.event!.id);
      const { answered } = this.deps.receipts.scan(ids);
      const lost = ids.filter((id) => !answered.has(id));
      if (lost.length) await backend.setReceipts(lost, false);
      after = page.next;
    } while (after !== null && !this.disposed);
  }

  private async drainOnce(): Promise<void> {
    const backend = this.backend;
    if (!backend || this.disposed || !this.deps.host.isCurrent()) return;
    if (this.reconcilePending) {
      await this.reconcile(backend);
      if (this.backend === backend) this.reconcilePending = false;
    }
    // Every pending eligible event: guarded ones must not hide independent later completions.
    const eligible: TaskRecord[] = [];
    let after: number | null = null;
    do {
      const page = await backend.notices("eligible", after, MAX_LIST_ITEMS);
      eligible.push(...page.items.filter((t) => t.event !== null));
      after = page.next;
    } while (after !== null && !this.disposed);
    const candidates = new Set<string>([...this.guards.keys(), ...this.pendingAcks, ...eligible.map((t) => t.event!.id)]);
    const receipts = this.deps.receipts.scan(candidates);
    for (const id of receipts.answered) {
      this.guards.delete(id);
      this.inflight?.ids.delete(id);
      this.pendingAcks.delete(id);
    }
    if (this.inflight && this.inflight.ids.size === 0) this.inflight = null;
    const acks = [...receipts.answered];
    for (let i = 0; i < acks.length; i += MAX_LIST_ITEMS) await backend.setReceipts(acks.slice(i, i + MAX_LIST_ITEMS), true);
    // An explicit input's run settled: release its held/backing-off events after this receipt check.
    for (const id of this.releasable) {
      const guard = this.guards.get(id);
      if (guard && guard.state !== "inflight") this.guards.delete(id);
    }
    this.releasable.clear();
    const eligibleIds = new Set(eligible.map((t) => t.event!.id));
    for (const [id, guard] of this.guards) if (guard.state !== "inflight" && !eligibleIds.has(id)) this.guards.delete(id);
    this.waitingForIdle = false;
    if (this.inflight || this.disposed) return;
    const now = this.deps.timers.now();
    const sendable = eligible.filter((t) => {
      const id = t.event!.id;
      if (receipts.answered.has(id)) return false;
      // Already in the session but unanswered: an active run may still answer it.
      if (this.running && receipts.present.has(id)) return false;
      const guard = this.guards.get(id);
      return !guard || (guard.state === "retry" && now >= guard.notBefore);
    }).slice(0, MAX_NOTICE_BATCH);
    if (!sendable.length) return;
    if (this.compacting > 0) return;
    if (!this.running) {
      if (this.inputRunDeadline !== null && now < this.inputRunDeadline) return;
      if (!this.deps.host.isIdle()) {
        this.waitingForIdle = true;
        return;
      }
    }
    // Fresh ownership check immediately before calling Pi.
    if (this.disposed || !this.deps.host.isCurrent() || this.inflight) return;
    for (const task of sendable) {
      const previous = this.guards.get(task.event!.id);
      this.guards.set(task.event!.id, { state: "inflight", attempts: (previous?.attempts ?? 0) + 1, taskId: task.id, notBefore: 0 });
    }
    this.inflight = {
      ids: new Set(sendable.map((t) => t.event!.id)),
      binding: this.running ? { kind: "run", generation: this.generation } : { kind: "idle", deadline: now + START_TIMEOUT_MS },
    };
    const resent = sendable.some((t) => receipts.present.has(t.event!.id));
    this.deps.sink.submit(buildCompletionMessage(this.deps.sessionId, sendable, (t) => backend.logPath(t), resent));
  }
}
