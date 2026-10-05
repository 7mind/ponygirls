/**
 * pi-subagents — supervisor: tree, policy, scheduler, journal.
 *
 * One supervisor owns one root session UUID. All descendants share atomic
 * runnable leases, worker capacity, cumulative spawn limits, and budgets.
 * Model tools and UI actions call the same methods here; they never touch
 * processes or files directly.
 *
 * Controller state transitions and their durable publication are serialized
 * so async handlers cannot independently finalize the same run. Cancellation
 * durably accepted before finalization wins; after finalization it returns
 * the immutable outcome instead of rewriting it.
 */

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolBroker, type BrokerCaller } from "./broker.ts";
import { err } from "./errors.ts";
import { GateController, fingerprintSummary, type CandidateRecord, type GateFinding, type GateHost, type GateTerminalOutcome, type NormalizedGateSpec, type WorkspaceFingerprint } from "./gate.ts";
import { defaultSupervisorPolicy, intersectGrants, rootGrants, type SupervisorPolicy } from "./policy.ts";
import { AdmissionScheduler, PathRegistry, type LeaseTicket } from "./scheduler.ts";
import type { ToolExecutor } from "./sandbox.ts";
import { InMemoryRunStore, RootLock, checkpointSha256, fsyncDir, fsyncFile, type JournalKind, type JournalRecord, type RunStore } from "./store.ts";
import type {
  AgentId,
  AgentRecord,
  GrantSet,
  JournalEventView,
  MailboxMessage,
  MessageId,
  MessageMode,
  MessageReceipt,
  PendingQuestion,
  QueuedTask,
  TaskOutcome,
  TaskPhase,
  TaskRunId,
  WaitCondition,
  WaitEndReason,
  WaitResult,
  WorkspaceAllocation,
} from "./types.ts";
import { WorkerHandle, newWorkerBinding } from "./worker-launch.ts";
import type { WorkerEvent } from "./protocol.ts";
import { GitWorkspaceManager, fingerprintWorktree, type WorkspaceManager } from "./workspace.ts";
import { BwrapToolExecutor } from "./sandbox.ts";

export type CallerId = AgentId | "governor" | "user";

export interface SpawnParams {
  taskName: string;
  message: string;
  profile: "reader" | "writer";
  repoId?: string | null;
  baseCommit?: string | null;
  model?: { provider: string; id: string; thinkingLevel?: string } | null;
  shell?: boolean;
  gate?: GateSpec | null;
  budget?: { maxCost?: number; maxTokens?: number } | null;
}

export interface GateSpec {
  model: { provider: string; id: string };
  thinkingLevel: string;
  prompt: string;
  maxRounds: number | null;
  checks?: Array<{ id: string; command: string; timeoutMs?: number }>;
  promisedOutputs?: string[];
}

export interface SpawnResult {
  agentId: AgentId;
  path: string;
  taskRunId: TaskRunId;
  generation: number;
  profile: string;
  status: string;
}

export interface AgentView {
  id: AgentId;
  path: string;
  parentId: AgentId | null;
  depth: number;
  profile: string;
  model: string;
  observed: string;
  pendingIntent: string;
  generation: number;
  taskOutcome: string | null;
  usage: { inputTokens: number; outputTokens: number; cost: number | null; unknown: boolean };
  lastActivityAt: string;
  managedGateFor: TaskRunId | null;
}

export interface ReadResult {
  status: AgentView;
  result: { taskRunId: string; outcome: string | null; text: string } | null;
  events: JournalEventView[];
  cursor: number;
}

/** Minimal worker port (real WorkerHandle or test fake). */
export interface WorkerPort {
  readonly instanceId: string;
  /** OS pid of the worker process, when backed by a real process. */
  readonly pid: number | null;
  launch(): Promise<void>;
  request(operation: string, payload: unknown, opts?: { taskRunId?: string; generation?: number; timeoutMs?: number }): Promise<unknown>;
  kill(): void;
  setEventHandler(h: (event: WorkerEvent) => void): void;
  setToolRequestHandler(h: (payload: { tool: string; args: Record<string, unknown>; toolCallId: string }) => Promise<{ content: string; isError: boolean }>): void;
}

export type WorkerFactory = (opts: {
  agentId: AgentId;
  instanceId: string;
  rootEpoch: string;
}) => WorkerPort;

interface AgentRuntime {
  record: AgentRecord;
  worker: WorkerPort | null;
  runnableLease: LeaseTicket | null;
  residentLease: LeaseTicket | null;
  queue: QueuedTask[];
  activeRun: { taskRunId: TaskRunId; generation: number; interruptRequested: boolean } | null;
  lastResult: { taskRunId: TaskRunId; outcome: string; text: string } | null;
  usage: { inputTokens: number; outputTokens: number; cost: number | null; unknown: boolean };
  lastPreview: string;
  quarantined: string | null;
  gateTaskRunId: TaskRunId | null;
  pendingRepair: string | null;
  /** Startup parked for lack of a runnable lease (task text to launch). */
  parkedStartup: string | null;
  /** Validated restore for the next worker launch (bytes already placed). */
  pendingRestore: { sessionFile: string; leafEntryId: string | null } | null;
  /** Recorded worker pid + boot identity for recovery ownership checks. */
  workerPid: number | null;
  workerBoot: { bootId: string; starttime: string } | null;
}

interface WaiterReg {
  id: string;
  caller: CallerId;
  cursor: number;
  targets: Array<{ agentId: AgentId; taskRunId: TaskRunId | null }> | null;
  condition: WaitCondition;
  joinTaskRunIds: TaskRunId[];
  joinToken: string | null;
  timer: ReturnType<typeof setTimeout>;
  resolve: (r: WaitResult) => void;
}

export interface SupervisorOptions {
  rootId: string;
  rootDir: string;
  store?: RunStore;
  policy?: SupervisorPolicy;
  schedulerLimits?: { maxRunnable?: number; maxResidentWorkers?: number; maxAgentsCreated?: number; maxDepth?: number };
  executor?: ToolExecutor;
  workspace?: WorkspaceManager;
  workerPath?: string;
  sdkRoot?: string | null;
  deterministic?: boolean;
  /** Host agent dir whose credential store workers open live (no copies). */
  hostAgentDir?: string;
  workerFactory?: WorkerFactory;
  now?: () => string;
  questionTtlMs?: number;
}

const NOTICE_CAP = 200;
const WAIT_DEFAULT_MS = 30_000;

function anonTmp(rootDir: string, agentId: string): string {
  const dir = join(rootDir, "tmp", agentId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export class Supervisor implements GateHost {
  readonly rootId: string;
  readonly rootDir: string;
  private store: RunStore;
  private lock: RootLock;
  private policy: SupervisorPolicy;
  private scheduler: AdmissionScheduler;
  private paths = new PathRegistry();
  private broker: ToolBroker;
  private workspace: WorkspaceManager;
  private agents = new Map<AgentId, AgentRuntime>();
  private messages = new Map<MessageId, MailboxMessage>();
  private questions = new Map<MessageId, PendingQuestion>();
  private waiters: WaiterReg[] = [];
  private notices: JournalEventView[] = [];
  /** Unfinished runs restored from the journal (no live worker). */
  private pendingLost = new Map<AgentId, { taskRunId: TaskRunId; generation: number; workerPid: number | null; workerBoot: { bootId: string; starttime: string } | null }>();
  private epoch: string;
  private suspended = false;
  private gate: GateController;
  private chain: Promise<void> = Promise.resolve();
  private closed = false;
  private cumulativeUsage = { inputTokens: 0, outputTokens: 0, cost: 0 as number | null, unknown: false };
  private opts: Required<Pick<SupervisorOptions, "workerPath" | "questionTtlMs">> & SupervisorOptions;
  private now: () => string;

  constructor(options: SupervisorOptions) {
    this.rootId = options.rootId;
    this.rootDir = options.rootDir;
    mkdirSync(this.rootDir, { recursive: true });
    this.store = options.store ?? new InMemoryRunStore(options.rootId);
    this.lock = new RootLock(this.rootDir);
    const lockRes = this.lock.acquire();
    if (!lockRes.ok) throw lockRes.error;
    this.policy = options.policy ?? defaultSupervisorPolicy();
    this.scheduler = new AdmissionScheduler(options.schedulerLimits);
    const executor = options.executor ?? new BwrapToolExecutor();
    this.broker = new ToolBroker(executor, this.store, [], { PATH: "/usr/bin:/bin" });
    this.workspace = options.workspace ?? new GitWorkspaceManager();
    this.epoch = randomUUID();
    this.gate = new GateController(this);
    this.opts = { workerPath: "", questionTtlMs: 15 * 60_000, ...options };
    this.now = options.now ?? (() => new Date().toISOString());
    this.replayJournal();
    this.store.append("root.init", { rootId: this.rootId, epoch: this.epoch, at: this.now() });
  }

  /**
   * Rebuild durable state from the journal: identities, tree, authority,
   * mailboxes, queues, outcomes, usage, gate rounds/candidates/decisions,
   * and unfinished runs. Schema/version and live checkpoint references are
   * validated by the store on open; malformed committed records fail here
   * rather than reconstructing a half state. No inference is started.
   */
  private replayJournal(): void {
    const { records } = this.store.readSince(0, 1_000_000);
    let spawned = 0;
    const started = new Map<TaskRunId, { agentId: AgentId; generation: number; workerPid: number | null; workerBoot: { bootId: string; starttime: string } | null }>();
    const settledGen = new Set<string>();
    const terminal = new Map<TaskRunId, string>();
    const decidedReviews = new Set<string>();
    interface GateDraft {
      agentId: AgentId;
      taskText: string;
      spec: NormalizedGateSpec;
      rounds: number;
      candidates: CandidateRecord[];
      findings: GateFinding[];
      lastResponse: string;
      repairCommandId: string | null;
      repairCriticism: string | null;
      terminal: GateTerminalOutcome | null;
      linkedFrom: TaskRunId | null;
      evidence: Array<{ round: number; id: string; exitCode: number | null; output: string }>;
    }
    const gates = new Map<TaskRunId, GateDraft>();
    const gateOf = (taskRunId: TaskRunId): GateDraft | null => gates.get(taskRunId) ?? null;

    for (const r of records) {
      const b = r.body as Record<string, unknown>;
      switch (r.kind) {
        case "agent.spawned": {
          const agentId = b["agentId"] as string;
          if (!agentId || this.agents.has(agentId)) break;
          const path = b["path"] as string;
          if (!path || this.paths.isTaken(path)) break;
          this.paths.reserve(path);
          const record: AgentRecord = {
            id: agentId,
            path,
            rootId: this.rootId,
            parentId: (b["parentId"] as string | null) ?? null,
            depth: path.split("/").length - 2,
            profile: (b["profile"] as "reader" | "writer") ?? "reader",
            createdEntryId: (b["requestId"] as string) ?? "",
            nativeSessionPath: null,
            grants: (b["grants"] as GrantSet) ?? { tools: [], repos: [], shell: false, network: false, nesting: false, maxDepth: 0 },
            allocation: (b["allocation"] as WorkspaceAllocation | null) ?? null,
            instructionHash: "",
            policyRevision: this.policy.revision,
            model: (b["model"] as AgentRecord["model"]) ?? null,
            currentTaskRunId: (b["taskRunId"] as string) ?? null,
            executionGeneration: 1,
            pendingTaskIds: [],
            pendingMessageIds: [],
            lastEventSeq: r.seq,
            desiredLifecycle: "open",
            observed: "queued",
            outcome: null,
            taskPhase: "working",
            taskOutcome: null,
            residency: "unloaded",
            detail: "restored from journal",
            lastActivityAt: r.at,
            activeDescendants: 0,
          };
          this.agents.set(agentId, {
            record,
            worker: null,
            runnableLease: null,
            residentLease: null,
            queue: [],
            activeRun: null,
            lastResult: null,
            usage: { inputTokens: 0, outputTokens: 0, cost: null, unknown: false },
            lastPreview: "",
            quarantined: null,
            gateTaskRunId: null,
            pendingRepair: null,
            parkedStartup: null,
            pendingRestore: null,
            workerPid: null,
            workerBoot: null,
          });
          const parent = record.parentId ? this.agents.get(record.parentId) : undefined;
          if (parent) parent.record.activeDescendants++;
          if (b["managedGate"] === true) {
            this.gate.linkReviewer(agentId, (b["taskRunId"] as string) ?? "");
          }
          spawned++;
          break;
        }
        case "generation.started": {
          const agentId = b["agentId"] as string;
          const taskRunId = b["taskRunId"] as string;
          const rt = this.agents.get(agentId);
          if (!rt || !taskRunId) break;
          rt.record.currentTaskRunId = taskRunId;
          rt.record.executionGeneration = (b["generation"] as number) ?? rt.record.executionGeneration;
          rt.record.observed = "running";
          rt.record.lastEventSeq = r.seq;
          for (const q of rt.queue) {
            if (q.id === taskRunId) q.dispatched = true;
          }
          started.set(taskRunId, {
            agentId,
            generation: rt.record.executionGeneration,
            workerPid: (b["workerPid"] as number | null) ?? null,
            workerBoot: (b["workerBoot"] as { bootId: string; starttime: string } | null) ?? null,
          });
          break;
        }
        case "generation.settled": {
          const agentId = b["agentId"] as string;
          const rt = this.agents.get(agentId);
          if (rt) {
            rt.record.observed = "settled";
            rt.record.outcome = (b["outcome"] as AgentRecord["outcome"]) ?? "failed";
            rt.record.lastEventSeq = r.seq;
          }
          settledGen.add(`${agentId}:${b["generation"] as number}`);
          break;
        }
        case "task.terminal": {
          const agentId = b["agentId"] as string;
          const taskRunId = b["taskRunId"] as string;
          const rt = this.agents.get(agentId);
          if (rt) {
            rt.record.taskPhase = "terminal";
            rt.record.taskOutcome = (b["outcome"] as string) ?? "failed";
            rt.record.observed = "settled";
            rt.lastResult = { taskRunId, outcome: rt.record.taskOutcome, text: (b["preview"] as string) ?? "" };
          }
          if (taskRunId) terminal.set(taskRunId, (b["outcome"] as string) ?? "failed");
          break;
        }
        case "task.queued": {
          const agentId = b["agentId"] as string;
          const rt = this.agents.get(agentId);
          if (!rt) break;
          const id = b["id"] as string;
          if (!id || rt.queue.some((q) => q.id === id)) break;
          rt.queue.push({
            id,
            agentId,
            messageId: (b["messageId"] as string) ?? "",
            text: (b["text"] as string) ?? "",
            createdAt: r.at,
            replaces: (b["replaces"] as string | null) ?? null,
            dispatched: false,
          });
          rt.record.pendingTaskIds.push(id);
          break;
        }
        case "task.phase": {
          const rt = this.agents.get(b["agentId"] as string);
          if (rt && typeof b["phase"] === "string") rt.record.taskPhase = b["phase"] as TaskPhase;
          break;
        }
        case "mailbox.accepted": {
          const agentId = b["to"] as string;
          const rt = this.agents.get(agentId);
          const messageId = b["messageId"] as string;
          if (!messageId) break;
          const message: MailboxMessage = {
            id: messageId,
            rootId: this.rootId,
            from: (b["from"] as MailboxMessage["from"]) ?? "governor",
            to: agentId,
            mode: (b["mode"] as MessageMode) ?? "note",
            text: (b["text"] as string) ?? "",
            taskRunId: (b["taskRunId"] as string | null) ?? null,
            generation: null,
            requestReply: b["requestReply"] === true,
            replyTo: (b["replyTo"] as string | null) ?? null,
            createdAt: r.at,
            seq: r.seq,
            receipt: null,
            replied: false,
          };
          this.messages.set(messageId, message);
          if (rt) rt.record.pendingMessageIds.push(messageId);
          if (message.requestReply && !b["questionExpired"]) {
            this.questions.set(messageId, {
              messageId,
              from: message.from,
              to: message.to,
              text: message.text,
              createdAt: r.at,
              deadlineAt: (b["deadlineAt"] as string) ?? new Date(Date.parse(r.at) + this.opts.questionTtlMs).toISOString(),
              answered: false,
              cancelled: false,
            });
          }
          break;
        }
        case "mailbox.answered": {
          const q = this.questions.get(b["replyTo"] as string);
          if (q) q.answered = true;
          break;
        }
        case "mailbox.receipt": {
          const message = this.messages.get(b["messageId"] as string);
          if (message) {
            message.receipt = {
              messageId: message.id,
              nativeEntryId: (b["leafEntryId"] as string) ?? "",
              leafId: (b["leafEntryId"] as string) ?? "",
              checkpointSeq: r.seq,
              byteOffset: -1,
            };
          }
          break;
        }
        case "usage.reported": {
          const rt = this.agents.get(b["agentId"] as string);
          const input = (b["input"] as number) ?? 0;
          const output = (b["output"] as number) ?? 0;
          if (rt) {
            rt.usage.inputTokens += input;
            rt.usage.outputTokens += output;
          }
          this.cumulativeUsage.inputTokens += input;
          this.cumulativeUsage.outputTokens += output;
          break;
        }
        case "agent.closed": {
          const rt = this.agents.get(b["agentId"] as string);
          if (rt) {
            rt.record.desiredLifecycle = "closed";
            rt.record.observed = "settled";
          }
          break;
        }
        case "gate.registered": {
          const taskRunId = b["taskRunId"] as string;
          if (!taskRunId || gates.has(taskRunId)) break;
          gates.set(taskRunId, {
            agentId: (b["agentId"] as string) ?? "",
            taskText: (b["taskText"] as string) ?? "",
            spec: b["spec"] as NormalizedGateSpec,
            rounds: 0,
            candidates: [],
            findings: [],
            lastResponse: "",
            repairCommandId: null,
            repairCriticism: null,
            terminal: null,
            linkedFrom: (b["linkedFrom"] as string | null) ?? null,
            evidence: [],
          });
          break;
        }
        case "gate.round_admitted": {
          const draft = gateOf(b["taskRunId"] as string);
          if (draft) draft.rounds = Math.max(draft.rounds, (b["round"] as number) ?? draft.rounds);
          break;
        }
        case "gate.candidate": {
          const draft = gateOf(b["taskRunId"] as string);
          const candidate = b["candidate"] as CandidateRecord | undefined;
          if (draft && candidate) {
            draft.candidates.push(candidate);
            draft.lastResponse = (b["resultText"] as string) ?? draft.lastResponse;
          }
          break;
        }
        case "gate.decision": {
          const draft = gateOf(b["taskRunId"] as string);
          if (draft) {
            const blockers = ((b["blockers"] as GateFinding[]) ?? []) as GateFinding[];
            const advisories = ((b["advisories"] as GateFinding[]) ?? []) as GateFinding[];
            draft.findings.push(...blockers, ...advisories);
            decidedReviews.add(`${b["taskRunId"] as string}:${b["reviewId"] as string}`);
          }
          break;
        }
        case "gate.evidence": {
          const draft = gateOf(b["taskRunId"] as string);
          const rows = (b["evidence"] as Array<{ id: string; exitCode: number | null; output: string }>) ?? [];
          if (draft) {
            for (const row of rows) {
              draft.evidence.push({ round: (b["round"] as number) ?? draft.rounds, id: row.id, exitCode: row.exitCode, output: row.output });
            }
          }
          break;
        }
        case "gate.repair_command": {
          const draft = gateOf(b["taskRunId"] as string);
          if (draft) {
            draft.repairCommandId = (b["commandId"] as string) ?? draft.repairCommandId;
            draft.repairCriticism = (b["criticism"] as string) ?? null;
          }
          break;
        }
        default:
          break;
      }
    }
    // Link restored gate tasks (counters, candidates, findings preserved;
    // nothing re-admitted). Undecided latest rounds become interrupted
    // reviews, resumable with fresh context.
    for (const [taskRunId, draft] of gates) {
      const terminalOutcome = terminal.get(taskRunId) as GateDraft["terminal"];
      const candidates = draft.candidates;
      const history = candidates.map((c) => fingerprintSummary(c.fingerprint));
      let stagnation: string | null = null;
      for (let i = 1; i < history.length; i++) {
        if (history[i] === history[i - 1]) {
          stagnation = `round ${i + 1}: candidate unchanged since previous round; no implicit stop applied`;
        }
      }
      this.gate.importTask({
        agentId: draft.agentId,
        taskRunId,
        taskText: draft.taskText,
        spec: draft.spec,
        roundsAdmitted: draft.rounds,
        candidate: candidates.length > 0 ? candidates[candidates.length - 1]! : null,
        previousFindings: draft.findings,
        lastResponse: draft.lastResponse,
        repairCommandId: draft.repairCommandId,
        terminal: terminalOutcome ?? null,
        linkedFrom: draft.linkedFrom,
        evidence: draft.evidence,
        fingerprintHistory: history,
        stagnationWarning: stagnation,
      });
      const state = this.gate.inspect(taskRunId);
      if (state && !state.terminal && draft.rounds > 0 && candidates.length > 0) {
        const reviewId = `review-${draft.rounds}`;
        if (!decidedReviews.has(`${taskRunId}:${reviewId}`)) {
          state.review = { reviewId, status: "interrupted", candidateId: candidates[candidates.length - 1]!.candidateId, decisionUsed: false };
        }
      }
      // A reserved repair never dispatched before the crash stays reserved
      // with its criticism; the pump redispatches it after recovery.
      if (state && !state.terminal && draft.repairCommandId && draft.repairCriticism) {
        const repaired = records.some(
          (x) => x.kind === "generation.started" && (x.body as Record<string, unknown>)["taskRunId"] === taskRunId && (x.body as Record<string, unknown>)["repair"] === true,
        );
        if (!repaired) {
          state.repairReserved = true;
          const rt = this.agents.get(draft.agentId);
          if (rt) {
            rt.record.taskPhase = "repair_queued";
            rt.pendingRepair = draft.repairCriticism;
          }
        }
      }
    }
    // Reviewer runs are intentionally unjournaled executions: after a
    // restart their records settle as interrupted (their gate task carries
    // the resumable state, never the reviewer row).
    for (const rt of this.agents.values()) {
      if (this.gate.isReviewer(rt.record.id) && rt.record.taskPhase !== "terminal") {
        rt.record.observed = "settled";
        rt.record.taskPhase = "terminal";
        rt.record.taskOutcome = "interrupted";
      }
    }
    // Unfinished runs (started, never settled/terminal, agent open) become
    // pending-lost for recover(): old joins settle, replacements wait.
    for (const [taskRunId, info] of started) {
      if (terminal.has(taskRunId)) continue;
      const rt = this.agents.get(info.agentId);
      if (!rt || rt.record.desiredLifecycle === "closed") continue;
      if (settledGen.has(`${info.agentId}:${info.generation}`)) continue;
      rt.record.observed = "lost";
      this.pendingLost.set(info.agentId, { taskRunId, generation: info.generation, workerPid: info.workerPid, workerBoot: info.workerBoot });
    }
    this.scheduler.restoreSnapshot({ created: spawned });
  }

  // -- lifecycle -----------------------------------------------------------

  async shutdown(): Promise<void> {
    this.suspended = true;
    return this.serialized(async () => {
      this.closed = true;
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve({ completed: false, reason: "cancelled", events: [], cursor: waiter.cursor, joinTaskRunIds: waiter.joinTaskRunIds, joinToken: waiter.joinToken });
      }
      for (const rt of this.agents.values()) {
        try {
          rt.worker?.kill();
        } catch {
          // best effort
        }
        // Suspended: release without pumping parked startups.
        if (rt.runnableLease) this.scheduler.release(rt.runnableLease);
        if (rt.residentLease) this.scheduler.release(rt.residentLease);
        rt.runnableLease = null;
        rt.residentLease = null;
      }
      this.store.close();
      this.lock.release();
    });
  }

  get currentEpoch(): string {
    return this.epoch;
  }

  get runStore(): RunStore {
    return this.store;
  }

  get toolBroker(): ToolBroker {
    return this.broker;
  }

  get activePolicy(): SupervisorPolicy {
    return this.policy;
  }

  get admissionScheduler(): AdmissionScheduler {
    return this.scheduler;
  }

  get gateController(): GateController {
    return this.gate;
  }

  // -- serialized controller transitions ------------------------------------

  async serialized<T>(fn: () => Promise<T> | T): Promise<T> {
    const prev = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private publish(kind: JournalKind, body: Record<string, unknown>): JournalRecord {    const record = this.store.append(kind, body);
    const view: JournalEventView = {
      seq: record.seq,
      kind,
      agentId: (body["agentId"] as AgentId | undefined) ?? null,
      taskRunId: (body["taskRunId"] as TaskRunId | undefined) ?? null,
      summary: summarize(kind, body),
      at: record.at,
    };
    this.notices.push(view);
    if (this.notices.length > NOTICE_CAP) this.notices.splice(0, this.notices.length - NOTICE_CAP);
    this.evaluateWaiters(view);
    return record;
  }

  // -- lease release + parked-startup pump --------------------------------------

  /** Release a lease; freed runnable capacity starts parked agents. */
  private releaseTicket(ticket: LeaseTicket | null): void {
    if (!ticket) return;
    this.scheduler.release(ticket);
    if (!this.suspended) {
      this.pumpParked();
      this.pumpPendingRepair();
    }
  }

  private releaseRunnable(rt: AgentRuntime): void {
    const ticket = rt.runnableLease;
    rt.runnableLease = null;
    this.releaseTicket(ticket);
  }

  private releaseResident(rt: AgentRuntime): void {
    const ticket = rt.residentLease;
    rt.residentLease = null;
    this.releaseTicket(ticket);
  }

  /**
   * Start parked startups when a runnable lease frees. A parked agent holds
   * its resident lease and identity; it launches only when it can run.
   */
  private pumpParked(): void {
    for (const rt of this.agents.values()) {
      if (this.suspended) return;
      if (!rt.parkedStartup || rt.activeRun || rt.worker) continue;
      if (rt.record.desiredLifecycle === "closed" || rt.quarantined) continue;
      const runnable = this.scheduler.tryAcquireRunnable(rt.record.id);
      if (!runnable) continue;
      const text = rt.parkedStartup;
      rt.parkedStartup = null;
      rt.runnableLease = runnable;
      void this.serialized(async () => {
        try {
          await this.continueStartup(rt, text);
        } catch (e) {
          // Parked startup failed like any other startup: terminal record,
          // no ghost identity, leases released.
          this.releaseResident(rt);
          rt.record.observed = "settled";
          rt.record.outcome = "failed";
          rt.record.taskPhase = "terminal";
          rt.record.taskOutcome = "failed";
          rt.record.residency = "unloaded";
          rt.record.detail = `startup failed: ${(e as Error).message}`;
          this.publish("task.terminal", { agentId: rt.record.id, taskRunId: rt.record.currentTaskRunId, outcome: "failed", reason: (e as Error).message });
        }
      }).catch(() => {});
    }
  }

  // -- spawn -----------------------------------------------------------------

  async spawn(caller: CallerId, params: SpawnParams, requestId: string): Promise<SpawnResult> {
    return this.serialized(async () => {
      const prior = this.store.loadCommand(requestId);
      if (prior) {
        const body = prior.body as { agentId?: string };
        if (typeof body["agentId"] === "string" && this.agents.has(body["agentId"])) {
          const rt = this.agents.get(body["agentId"])!;
          return {
            agentId: rt.record.id,
            path: rt.record.path,
            taskRunId: rt.record.currentTaskRunId ?? "",
            generation: rt.record.executionGeneration,
            profile: rt.record.profile,
            status: rt.record.observed,
          };
        }
        throw err("DUPLICATE_REQUEST", `conflicting reuse of requestId ${requestId}`);
      }
      if (!params.taskName || !params.message) throw err("INVALID", "spawn requires taskName and message");
      if (params.profile !== "reader" && params.profile !== "writer") throw err("INVALID", "profile must be reader/writer");

      const parentRt = caller === "governor" || caller === "user" ? null : this.agents.get(caller);
      if ((caller !== "governor" && caller !== "user") && !parentRt) throw err("NOT_FOUND", `caller ${caller} unknown`);
      if (parentRt && parentRt.record.desiredLifecycle === "closed") throw err("CLOSED", "caller is closed");
      const parentPath = parentRt ? parentRt.record.path : "/root";
      const depth = parentRt ? parentRt.record.depth + 1 : 1;
      const ownerGrants = parentRt ? parentRt.record.grants : rootGrants(this.policy);

      const charged = this.scheduler.chargeAgentCreation();
      if (!charged.ok) throw err(charged.code, charged.message);

      const granted = intersectGrants(this.policy, ownerGrants, {
        profile: params.profile,
        repoId: params.repoId ?? null,
        shell: params.shell ?? (params.profile === "writer"),
        network: false,
        model: params.model ? { provider: params.model.provider, id: params.model.id } : null,
        depth,
      });
      if (!granted.ok) throw granted.error;

      const path = PathRegistry.childPath(parentPath, params.taskName);
      // The controller excludes its own writers during review: a writer may
      // not be delegated under an owner with an active review lock. Checked
      // before binding any workspace so rejection allocates nothing.
      if (parentRt && (parentRt.record.taskPhase === "reviewing" || parentRt.record.taskPhase === "review_queued") && params.profile === "writer") {
        throw err("CONFLICT", "owner workspace is locked for review; writers excluded until review ends");
      }
      // The managed reviewer owns no subtree and controls nothing.
      if ((caller !== "governor" && caller !== "user") && this.gate.isReviewer(caller)) {
        throw err("FORBIDDEN", "managed reviewer cannot delegate");
      }
      const reserved = this.paths.reserve(path);
      if (!reserved.ok) throw err(reserved.code, reserved.message);

      // Bind the concrete workspace AFTER grant intersection. A nested writer
      // gets its own worktree; parent mounts are never an allowlist.
      let allocation: WorkspaceAllocation | null = null;
      const repoId = params.repoId ?? null;
      if (params.profile === "writer" && repoId) {
        const reg = this.policy.repos.find((r) => r.repoId === repoId);
        if (!reg) throw err("POLICY_DENIED", `repository ${repoId} not registered`);
        const baseCommit = params.baseCommit ?? "HEAD";
        try {
          const wt = this.workspace.allocateWriter(repoId, reg.checkoutPath, baseCommit, join(this.rootDir, "worktrees"));
          allocation = {
            kind: "writer",
            readRoots: [...reg.readRoots],
            worktreePath: wt.worktreePath,
            baseCommit: wt.baseCommit,
            repoId,
            tmpDir: anonTmp(this.rootDir, "pending"),
          };
          if (wt.baseDirty && !params.baseCommit) {
            // Actionable precondition: agreed committed base required.
            throw err("CONFLICT", "checkout has uncommitted changes; supply an explicit baseCommit or commit first");
          }
        } catch (e) {
          this.paths.retire(path);
          throw e;
        }
      } else if (repoId) {
        const reg = this.policy.repos.find((r) => r.repoId === repoId);
        if (!reg) throw err("POLICY_DENIED", `repository ${repoId} not registered`);
        allocation = { kind: "reader", readRoots: [...reg.readRoots], worktreePath: null, baseCommit: null, repoId, tmpDir: anonTmp(this.rootDir, "pending") };
      }

      // Resident capacity is acquired before the identity exists: a task
      // needing a new resident worker behind a full house gets an explicit
      // capacity error, never an indefinite queue behind its own parent.
      const agentId = randomUUID();
      const resident = this.scheduler.tryAcquireResident(agentId);
      if (!resident) {
        this.paths.release(path);
        throw err("CAPACITY_EXCEEDED", "no resident worker capacity; try again after settled workers are evicted");
      }
      if (allocation) allocation.tmpDir = anonTmp(this.rootDir, agentId);
      const taskRunId = randomUUID();
      const model = params.model
        ? { provider: params.model.provider, id: params.model.id, thinkingLevel: params.model.thinkingLevel ?? "medium" }
        : { ...this.policy.defaultModel };
      const record: AgentRecord = {
        id: agentId,
        path,
        rootId: this.rootId,
        parentId: parentRt ? parentRt.record.id : null,
        depth,
        profile: params.profile,
        createdEntryId: requestId,
        nativeSessionPath: null,
        grants: granted.grants,
        allocation,
        instructionHash: "",
        policyRevision: this.policy.revision,
        model,
        currentTaskRunId: taskRunId,
        executionGeneration: 1,
        pendingTaskIds: [],
        pendingMessageIds: [],
        lastEventSeq: 0,
        desiredLifecycle: "open",
        observed: "queued",
        outcome: null,
        taskPhase: "working",
        taskOutcome: null,
        residency: "unloaded",
        detail: "spawn accepted",
        lastActivityAt: this.now(),
        activeDescendants: 0,
      };
      const rt: AgentRuntime = {
        record,
        worker: null,
        runnableLease: null,
        residentLease: resident,
        queue: [],
        activeRun: null,
        lastResult: null,
        usage: { inputTokens: 0, outputTokens: 0, cost: null, unknown: false },
        lastPreview: "",
        quarantined: null,
        gateTaskRunId: null,
        pendingRepair: null,
        parkedStartup: null,
        pendingRestore: null,
        workerPid: null,
        workerBoot: null,
      };
      this.agents.set(agentId, rt);
      if (parentRt) parentRt.record.activeDescendants++;

      const spawned = this.store.append("agent.spawned", {
        agentId,
        path,
        parentId: record.parentId,
        profile: params.profile,
        taskRunId,
        requestId,
        grants: granted.grants,
        allocation,
        model,
      });
      this.store.recordCommand(requestId, spawned);
      record.lastEventSeq = spawned.seq;

      // Gate preflight before dispatching the main agent.
      if (params.gate) {
        this.gate.preflight(agentId, taskRunId, params.gate, params.message);
        rt.gateTaskRunId = taskRunId;
        record.taskPhase = "working";
      }

      try {
        await this.startWorker(rt, params.message, params.gate ? { gate: true } : {});
      } catch (e) {
        // Startup rollback owns the child until initial input is accepted:
        // failed startup keeps a terminal record (no ghost identity), keeps
        // the path taken, releases leases.
        this.releaseResident(rt);
        record.observed = "settled";
        record.outcome = "failed";
        record.taskPhase = "terminal";
        record.taskOutcome = "failed";
        record.residency = "unloaded";
        record.detail = `startup failed: ${(e as Error).message}`;
        this.publish("task.terminal", { agentId, taskRunId, outcome: "failed", reason: (e as Error).message });
        throw e;
      }
      return { agentId, path, taskRunId, generation: 1, profile: params.profile, status: record.observed };
    });
  }

  private async startWorker(rt: AgentRuntime, taskText: string, opts: { gate?: boolean } = {}): Promise<void> {
    const record = rt.record;
    // Runnable capacity gates process launch: a parked agent holds its
    // resident lease and identity, and launches only when it can run.
    const runnable = this.scheduler.tryAcquireRunnable(record.id);
    if (!runnable) {
      rt.parkedStartup = taskText;
      record.observed = "queued";
      record.detail = "parked: waiting for runnable lease";
      return;
    }
    rt.runnableLease = runnable;
    await this.continueStartup(rt, taskText, opts);
  }

  /** Launch the worker process and accept initial input (lease held). */
  private async continueStartup(rt: AgentRuntime, taskText: string, opts: { gate?: boolean } = {}): Promise<void> {
    const record = rt.record;
    const instanceId = randomUUID();
    const factory = this.opts.workerFactory ?? ((o) => new WorkerHandle({
      workerPath: this.opts.workerPath || join(this.rootDir, "..", "worker.js"),
      rootEpoch: o.rootEpoch,
      agentId: o.agentId,
      sdkRoot: this.opts.sdkRoot ?? null,
      deterministic: this.opts.deterministic ?? false,
      agentDir: join(this.rootDir, "worker-agent-dirs", o.agentId),
      sessionsDir: join(this.rootDir, "sessions"),
      hostAgentDir: this.opts.hostAgentDir,
    }, newWorkerBinding(o.rootEpoch, o.agentId)));
    const worker = factory({ agentId: record.id, instanceId, rootEpoch: this.epoch });
    rt.worker = worker;
    record.residency = "loaded";
    record.observed = "starting";
    worker.setEventHandler((event) => {
      void this.serialized(async () => {
        this.onWorkerEvent(rt, event);
      });
    });
    worker.setToolRequestHandler(async (payload) => this.onToolRequest(rt, payload));
    try {
      await worker.launch();
    } catch (e) {
      rt.worker = null;
      record.residency = "unloaded";
      this.releaseRunnable(rt);
      throw e;
    }
    // Record process ownership for recovery verification (never kill by
    // guessed PIDs: boot identity must match before signalling). 
    rt.workerPid = worker.pid;
    rt.workerBoot = worker.pid !== null ? readProcessIdentity(worker.pid) : null;
    const init = {
      taskText,
      profile: record.profile,
      instructionHash: record.instructionHash,
      model: record.model,
      taskRunId: record.currentTaskRunId,
      executionGeneration: record.executionGeneration,
      workdir: record.allocation?.worktreePath ?? record.allocation?.readRoots[0] ?? this.rootDir,
      readRoots: record.allocation?.readRoots ?? [],
      writable: record.profile === "writer",
      restore: rt.pendingRestore,
    };
    rt.pendingRestore = null;
    try {
      const res = (await worker.request("initialize", init, {
        taskRunId: record.currentTaskRunId ?? undefined,
        generation: record.executionGeneration,
      })) as { ok?: boolean; sessionId?: string; sessionFile?: string | null; code?: string; message?: string };
      if (!res || res.ok !== true) {
        throw err("INVALID", `worker initialize rejected: ${(res as { message?: string })?.message ?? "unknown"}`);
      }
      // Prefer the native session file path; pre-materialization sessions
      // report only their session ID until the first persisted entry.
      record.nativeSessionPath = typeof res.sessionFile === "string" ? res.sessionFile : (typeof res.sessionId === "string" ? res.sessionId : record.nativeSessionPath);
      record.observed = "running";
      record.detail = "main execution running";
      record.lastActivityAt = this.now();
      rt.activeRun = { taskRunId: record.currentTaskRunId!, generation: record.executionGeneration, interruptRequested: false };
      const started = this.publishGenerationStarted(record.id, record.currentTaskRunId, record.executionGeneration, {});
      record.lastEventSeq = started.seq;
    } catch (e) {
      this.releaseRunnable(rt);
      worker.kill();
      rt.worker = null;
      record.residency = "unloaded";
      throw e;
    }
    void opts;
  }

  // -- worker event intake -----------------------------------------------------

  private onWorkerEvent(rt: AgentRuntime, event: WorkerEvent): void {
    const record = rt.record;
    if (event.executionGeneration !== null && event.executionGeneration !== record.executionGeneration) {
      return; // Fence stale generations.
    }
    record.lastActivityAt = this.now();
    // Reviewer executions never produce task outcomes of their own. A worker
    // settling without a committed decision is an explicit gate error;
    // a decided review settles its record quietly.
    if (this.gate.isReviewer(record.id)) {
      if (event.kind === "settled") {
        const reviewState = this.gate.inspectFor(record.id);
        if (reviewState === "undecided") {
          const detail = event.detail as Record<string, unknown>;
          this.gate.executionFailed(record.id, String(detail["error"] ?? detail["status"] ?? "no decision submitted"));
        }
        record.observed = "settled";
        this.releaseRunnable(rt);
        rt.activeRun = null;
        this.pumpPendingRepair();
      }
      return;
    }
    switch (event.kind) {
      case "started":
        record.observed = "running";
        break;
      case "tool_start":
        record.detail = `tool ${(event.detail["tool"] as string) ?? "unknown"} running`;
        break;
      case "tool_end":
        record.detail = "main execution running";
        break;
      case "preview":
        rt.lastPreview = String(event.detail["text"] ?? "").slice(0, 2000);
        break;
      case "usage": {
        const d = event.detail as { input?: number; output?: number; cost?: number | null; unknown?: boolean };
        rt.usage.inputTokens += d.input ?? 0;
        rt.usage.outputTokens += d.output ?? 0;
        if (typeof d.cost === "number") rt.usage.cost = (rt.usage.cost ?? 0) + d.cost;
        if (d.unknown === true) rt.usage.unknown = true;
        this.cumulativeUsage.inputTokens += d.input ?? 0;
        this.cumulativeUsage.outputTokens += d.output ?? 0;
        if (typeof d.cost === "number") this.cumulativeUsage.cost = (this.cumulativeUsage.cost ?? 0) + d.cost;
        break;
      }
      case "question": {
        const text = String(event.detail["text"] ?? "");
        const to = (event.detail["to"] as string) ?? "parent";
        this.raiseQuestion(rt, text, to === "parent" ? (record.parentId ?? "governor") : to);
        break;
      }
      case "settled": {
        const status = String(event.detail["status"] ?? "failed");
        const text = String(event.detail["lastAssistantText"] ?? rt.lastPreview ?? "");
        const usage = event.detail["usage"] as { input?: number; output?: number } | undefined;
        this.finalizeGeneration(rt, status, text, usage);
        break;
      }
      default:
        break;
    }
  }

  private async onToolRequest(
    rt: AgentRuntime,
    payload: { tool: string; args: Record<string, unknown>; toolCallId: string },
  ): Promise<{ content: string; isError: boolean }> {
    const record = rt.record;
    if (payload.tool === "submit_gate_decision") {
      const res = this.gate.submitDecision(record.id, payload.args);
      return res.ok
        ? { content: JSON.stringify({ accepted: true }), isError: false }
        : { content: `${res.error.code}: ${res.error.message}`, isError: true };
    }
    // Supervisor-derived caller authority from the authenticated channel.
    const caller: BrokerCaller = {
      agentId: record.id,
      taskRunId: record.currentTaskRunId,
      generation: record.executionGeneration,
      grants: record.grants,
      worktreePath: record.allocation?.worktreePath ?? null,
      readRoots: record.allocation?.readRoots ?? [],
      tmpDir: record.allocation?.tmpDir ?? this.rootDir,
      sandboxProbed: true,
      // The whole root store (journal, sessions, sibling workspaces) is
      // absent from tool views; approved paths rebind over the cover.
      hidePaths: [this.rootDir],
    };
    try {
      const result = await this.broker.execute(caller, { tool: payload.tool, args: payload.args });
      const text = result.timedOut
        ? `tool timed out (exit ${result.exitCode})${result.stdout ? `\n${result.stdout.slice(0, 4000)}` : ""}`
        : `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr.slice(0, 2000)}` : ""}`.slice(0, 8000);
      return { content: text, isError: result.exitCode !== 0 || result.timedOut };
    } catch (e) {
      const code = (e as { code?: string }).code ?? "INVALID";
      return { content: `${code}: ${(e as Error).message}`, isError: true };
    }
  }

  // -- generation finalization ---------------------------------------------------

  private finalizeGeneration(rt: AgentRuntime, status: string, text: string, usage?: { input?: number; output?: number }): void {
    const record = rt.record;
    const run = rt.activeRun;
    if (!run) return; // Duplicate terminal outcome: ignore (exactly-once).
    // Usage accounting: provider deltas summed by the worker; unknown cost
    // stays explicit and is never treated as zero.
    const input = usage?.input ?? 0;
    const output = usage?.output ?? 0;
    rt.usage.inputTokens += input;
    rt.usage.outputTokens += output;
    this.cumulativeUsage.inputTokens += input;
    this.cumulativeUsage.outputTokens += output;
    this.publish("usage.reported", { agentId: record.id, taskRunId: run.taskRunId, generation: run.generation, input, output });
    const outcome: TaskOutcome =
      status === "succeeded" ? "succeeded" : status === "interrupted" ? "interrupted" : status === "uncertain" ? "uncertain" : "failed";
    record.observed = "settled";
    record.outcome = outcome === "succeeded" ? "succeeded" : outcome === "interrupted" ? "interrupted" : outcome === "uncertain" ? "uncertain" : "failed";
    this.publish("generation.settled", {
      agentId: record.id,
      taskRunId: run.taskRunId,
      generation: run.generation,
      outcome: record.outcome,
    });
    rt.activeRun = null;
    // Never hold a main runnable lease while waiting for review.
    this.releaseRunnable(rt);
    rt.lastResult = { taskRunId: run.taskRunId, outcome: record.outcome, text };
    // Capture the settled generation's native checkpoint at this safe
    // boundary (worker idle by definition of settled).
    void this.captureCheckpoint(rt, run.taskRunId, run.generation);

    // A gated task does not settle on a candidate's SDK settlement.
    if (rt.gateTaskRunId === run.taskRunId && (outcome === "succeeded" || outcome === "failed")) {
      if (outcome === "succeeded") {
        record.taskPhase = "candidate_recording";
        this.gate.candidateSettled(record.id, run.taskRunId, run.generation, text);
      } else {
        this.settleTaskTerminal(rt, run.taskRunId, "failed", text);
      }
      return;
    }
    if (rt.gateTaskRunId === run.taskRunId) {
      this.settleTaskTerminal(rt, run.taskRunId, outcome, text);
      this.pumpPendingRepair();
      return;
    }
    this.settleTaskTerminal(rt, run.taskRunId, outcome, text);
    this.pumpPendingRepair();
  }

  /**
   * Immutable validated checkpoint of the settled generation: session
   * UUID, leaf entry ID, byte boundary, content checksum. Only the latest
   * committed checkpoint plus the staged predecessor are retained.
   */
  private async captureCheckpoint(rt: AgentRuntime, taskRunId: TaskRunId, generation: number): Promise<void> {
    const worker = rt.worker;
    if (!worker) return;
    try {
      const res = (await worker.request("checkpoint", {}, { taskRunId, generation, timeoutMs: 15_000 })) as {
        leafEntryId?: string | null;
        materialized?: boolean;
        byteCount?: number;
        sha256?: string;
        bytesBase64?: string;
      };
      if (!res || res.materialized !== true || typeof res.bytesBase64 !== "string") {
        this.publish("recovery.event", { agentId: rt.record.id, phase: "checkpoint_skipped", reason: "unmaterialized" });
        return;
      }
      const bytes = Buffer.from(res.bytesBase64, "base64");
      if (bytes.length !== res.byteCount || checkpointSha256(bytes) !== res.sha256) {
        this.publish("recovery.event", { agentId: rt.record.id, phase: "checkpoint_skipped", reason: "transport integrity mismatch" });
        return;
      }
      this.store.saveCheckpoint({
        agentId: rt.record.id,
        taskRunId,
        generation,
        leafEntryId: res.leafEntryId ?? null,
        sha256: res.sha256 ?? checkpointSha256(bytes),
        bytes: bytes.length,
        createdAt: this.now(),
        superseded: false,
      }, bytes);
    } catch (e) {
      this.publish("recovery.event", { agentId: rt.record.id, phase: "checkpoint_skipped", reason: (e as Error).message.slice(0, 200) });
    }
  }

  /** generation.started carries the worker ownership binding for recovery. */
  private publishGenerationStarted(agentId: AgentId, taskRunId: TaskRunId | null, generation: number, extra: Record<string, unknown>): JournalRecord {
    const rt = this.agents.get(agentId);
    return this.publish("generation.started", {
      agentId,
      taskRunId,
      generation,
      workerPid: rt?.workerPid ?? null,
      workerBoot: rt?.workerBoot ?? null,
      ...extra,
    });
  }

  /** Publish each terminal outcome once and durably. */
  settleTaskTerminal(rt: AgentRuntime, taskRunId: TaskRunId, outcome: string, text: string): void {    const record = rt.record;
    if (record.taskPhase === "terminal" && record.taskOutcome !== null) return;
    record.taskPhase = "terminal";
    record.taskOutcome = outcome;
    record.observed = "settled";
    this.publish("task.terminal", { agentId: record.id, taskRunId, outcome, preview: text.slice(0, 2000) });
    rt.lastResult = { taskRunId, outcome, text };
    this.pumpQueue(rt);
  }

  private pumpQueue(rt: AgentRuntime): void {
    if (rt.activeRun || rt.record.desiredLifecycle === "closed") return;
    // No phantom runs: without a loaded worker the queued task waits for
    // explicit resume, which reloads under current authority first.
    if (!rt.worker) return;
    const next = rt.queue.find((q) => !q.dispatched);
    if (!next) return;
    next.dispatched = true;
    rt.record.currentTaskRunId = next.id;
    rt.record.executionGeneration += 1;
    rt.record.taskPhase = "working";
    rt.record.taskOutcome = null;
    rt.record.outcome = null;
    rt.record.observed = "running";
    rt.activeRun = { taskRunId: next.id, generation: rt.record.executionGeneration, interruptRequested: false };
    this.publishGenerationStarted(rt.record.id, next.id, rt.record.executionGeneration, {});
    // Dispatch through the worker when loaded; otherwise mark queued for resume.
    if (rt.worker) {
      void rt.worker
        .request("deliver", { mode: "task", text: next.text, messageId: next.messageId }, { taskRunId: next.id, generation: rt.record.executionGeneration })
        .catch((e: Error) => {
          this.publish("generation.settled", {
            agentId: rt.record.id,
            taskRunId: next.id,
            generation: rt.record.executionGeneration,
            outcome: "failed",
            error: e.message,
          });
          this.settleTaskTerminal(rt, next.id, "failed", e.message);
        });
    }
  }

  // -- messages ------------------------------------------------------------------

  async sendMessage(
    caller: CallerId,
    target: AgentId | "parent",
    mode: MessageMode,
    text: string,
    opts: { requestReply?: boolean; replyTo?: MessageId } = {},
    requestId: string = randomUUID(),
  ): Promise<{ messageId: MessageId; taskRunId: TaskRunId | null }> {
    return this.serialized(async () => {
      this.sweepExpiredQuestions();
      if (opts.requestReply === true && opts.replyTo !== undefined) {
        throw err("INVALID", "request_reply and reply_to are mutually exclusive");
      }
      if (!text) throw err("INVALID", "message text required");
      const from = this.authorOf(caller);
      const to = this.resolveTarget(caller, target);
      const rt = this.agents.get(to);
      if (!rt) throw err("NOT_FOUND", `target ${to} unknown`);
      this.checkRoute(caller, from, to, rt.record);

      if (opts.replyTo !== undefined) {
        return this.answerQuestion(caller, from, opts.replyTo, text, requestId);
      }

      const prior = this.store.loadCommand(requestId);
      if (prior) {
        const body = prior.body as { messageId?: string };
        if (typeof body["messageId"] === "string" && this.messages.has(body["messageId"])) {
          return { messageId: body["messageId"], taskRunId: this.messages.get(body["messageId"])?.taskRunId ?? null };
        }
        throw err("DUPLICATE_REQUEST", `conflicting reuse of requestId ${requestId}`);
      }

      if (mode === "steer" && (!rt.activeRun || rt.record.observed === "settled" || rt.record.observed === "lost")) {
        throw err("NOT_RUNNING", "cannot steer an idle agent; use task to start work");
      }
      if (rt.record.desiredLifecycle === "closed") throw err("CLOSED", "target is closed");

      const messageId = randomUUID();
      const taskRunId = mode === "task" ? randomUUID() : (rt.record.currentTaskRunId ?? null);
      const message: MailboxMessage = {
        id: messageId,
        rootId: this.rootId,
        from,
        to,
        mode,
        text,
        taskRunId,
        generation: mode === "task" ? null : (rt.activeRun?.generation ?? null),
        requestReply: opts.requestReply ?? false,
        replyTo: null,
        createdAt: this.now(),
        seq: null,
        receipt: null,
        replied: false,
      };
      const accepted = this.publish("mailbox.accepted", {
        messageId,
        from,
        to,
        mode,
        text: text.slice(0, 65536),
        taskRunId,
        requestReply: message.requestReply,
        requestId,
      });
      message.seq = accepted.seq;
      this.messages.set(messageId, message);
      rt.record.pendingMessageIds.push(messageId);
      this.store.recordCommand(requestId, accepted);
      // Record the durable command->message binding explicitly.
      this.store.append("command.accepted", { requestId, messageId, kind: "mailbox.accepted" });

      if (opts.requestReply === true) {
        const deadlineAt = new Date(Date.now() + this.opts.questionTtlMs).toISOString();
        this.questions.set(messageId, { messageId, from, to, text, createdAt: this.now(), deadlineAt, answered: false, cancelled: false });
        this.publish("mailbox.accepted", { messageId, question: true, deadlineAt });
        // Any question addressed to a waiter preempts its settlement join;
        // ordinary informational notes never do.
        this.preemptForQuestion(message);
        // The asker parks awaiting the reply (governor never parks).
        if (from !== "governor" && from !== "user") {
          const asker = this.agents.get(from);
          if (asker) {
            asker.record.observed = "awaiting_parent";
            asker.record.detail = "awaiting parent reply";
          }
        }
      }

      if (mode === "task") {
        const queued: QueuedTask = { id: taskRunId!, agentId: to, messageId, text, createdAt: this.now(), replaces: null, dispatched: false };
        if (rt.activeRun || rt.record.taskPhase === "reviewing" || rt.record.taskPhase === "review_queued" || rt.record.taskPhase === "repair_queued") {
          rt.queue.push(queued);
          rt.record.pendingTaskIds.push(queued.id);
          rt.record.detail = "task queued behind active run";
          this.publish("task.queued", { id: queued.id, agentId: to, messageId, text: text.slice(0, 65536), replaces: null });
        } else if (rt.worker) {
          queued.dispatched = true;
          rt.record.currentTaskRunId = queued.id;
          rt.record.executionGeneration += 1;
          rt.record.taskPhase = "working";
          rt.record.taskOutcome = null;
          rt.record.outcome = null;
          rt.record.observed = "starting";
          message.generation = rt.record.executionGeneration;
          rt.activeRun = { taskRunId: queued.id, generation: rt.record.executionGeneration, interruptRequested: false };
          if (!rt.runnableLease) rt.runnableLease = this.scheduler.tryAcquireRunnable(to);
          const gen = this.publishGenerationStarted(to, queued.id, rt.record.executionGeneration, {});
          rt.record.lastEventSeq = gen.seq;
          const worker = rt.worker;
          const generation = rt.record.executionGeneration;
          void worker
            .request("deliver", { mode: "task", text, messageId }, { taskRunId: queued.id, generation })
            .catch((e: Error) => {
              void this.serialized(async () => {
                this.publish("generation.settled", { agentId: to, taskRunId: queued.id, generation, outcome: "failed", error: e.message });
                this.settleTaskTerminal(rt, queued.id, "failed", e.message);
              });
            });
        } else {
          // Unloaded: reload under current authority, then dispatch.
          rt.queue.push(queued);
          rt.record.pendingTaskIds.push(queued.id);
          await this.reloadAgent(rt, "task message");
        }
      } else {
        // note: insert at a safe SDK boundary when loaded (no inference
        // when idle), retain when unloaded. steer: worker enforces
        // NOT_RUNNING for idle agents; the supervisor pre-check rejects
        // idle steering with a clear error before dispatch.
        if (rt.worker && (mode === "note" || rt.activeRun)) {
          const worker = rt.worker;
          const generation = rt.activeRun?.generation ?? rt.record.executionGeneration;
          const taskRun = rt.activeRun?.taskRunId ?? rt.record.currentTaskRunId;
          void worker
            .request("deliver", { mode, text, messageId }, { taskRunId: taskRun ?? undefined, generation })
            .then((res) => {
              void this.serialized(async () => {
                if ((res as { inserted?: boolean })?.inserted === true) {
                  this.bindReceipt(rt, message);
                }
              });
            })
            .catch(() => {
              // Delivery failure keeps the accepted message queued; the next
              // load reconciles it against the restored branch.
            });
        }
      }
      return { messageId, taskRunId };
    });
  }

  private answerQuestion(
    caller: CallerId,
    from: AgentId | "governor",
    replyTo: MessageId,
    text: string,
    requestId: string,
  ): { messageId: MessageId; taskRunId: null } {
    const question = this.questions.get(replyTo);
    if (!question || question.answered || question.cancelled) throw err("NOT_FOUND", `question ${replyTo} not open`);
    if (question.to !== from && !(caller === "governor" || caller === "user")) {
      throw err("FORBIDDEN", "only the addressed recipient (or governor) may answer");
    }
    const prior = this.store.loadCommand(requestId);
    if (prior) throw err("DUPLICATE_REQUEST", `requestId ${requestId} already used`);
    question.answered = true;
    const messageId = randomUUID();
    const accepted = this.publish("mailbox.accepted", { messageId, from, to: question.from, mode: "note", text: text.slice(0, 65536), replyTo, taskRunId: null, requestId });
    this.publish("mailbox.answered", { messageId, replyTo });
    this.store.recordCommand(requestId, accepted);
    const asker = this.agents.get(question.from);
    if (asker) {
      asker.record.pendingMessageIds.push(messageId);
      if (asker.record.observed === "awaiting_parent") {
        asker.record.observed = asker.activeRun ? "running" : "queued";
        asker.record.detail = "question answered; resuming";
        // A reply satisfies a parked waiter without starting an idle root turn.
        if (asker.worker && asker.activeRun) {
          const worker = asker.worker;
          const run = asker.activeRun;
          void worker.request("deliver", { mode: "note", text, messageId }, { taskRunId: run.taskRunId, generation: run.generation }).catch(() => {});
        }
      }
    }
    // Resolve parked waiters blocked on this question.
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.caller === question.from || waiter.caller === question.to) {
        clearTimeout(waiter.timer);
        waiter.resolve({ completed: false, reason: "events", events: [], cursor: waiter.cursor, joinTaskRunIds: waiter.joinTaskRunIds, joinToken: waiter.joinToken });
      } else {
        this.waiters.push(waiter);
      }
    }
    return { messageId, taskRunId: null };
  }

  private raiseQuestion(rt: AgentRuntime, text: string, to: AgentId | "governor"): void {
    const messageId = randomUUID();
    const accepted = this.publish("mailbox.accepted", { messageId, from: rt.record.id, to, mode: "note", requestReply: true });
    const message: MailboxMessage = {
      id: messageId,
      rootId: this.rootId,
      from: rt.record.id,
      to,
      mode: "note",
      text,
      taskRunId: rt.record.currentTaskRunId,
      generation: rt.activeRun?.generation ?? null,
      requestReply: true,
      replyTo: null,
      createdAt: this.now(),
      seq: accepted.seq,
      receipt: null,
      replied: false,
    };
    this.messages.set(messageId, message);
    const deadlineAt = new Date(Date.now() + this.opts.questionTtlMs).toISOString();
    this.questions.set(messageId, { messageId, from: rt.record.id, to, text, createdAt: this.now(), deadlineAt, answered: false, cancelled: false });
    rt.record.observed = "awaiting_parent";
    this.preemptForQuestion(message);
  }

  /** A child question preempts its parent's settlement wait (never reports settlement). */
  private preemptForQuestion(message: MailboxMessage): void {
    const remaining: WaiterReg[] = [];
    for (const waiter of this.waiters) {
      const isParentWaiter =
        waiter.caller === message.to ||
        (message.to === "governor" && (waiter.caller === "governor" || waiter.caller === "user"));
      const waitsSettlement = waiter.condition !== "activity";
      if (isParentWaiter && waitsSettlement) {
        clearTimeout(waiter.timer);
        waiter.resolve({
          completed: false,
          reason: "needs_response",
          events: [],
          cursor: waiter.cursor,
          joinTaskRunIds: waiter.joinTaskRunIds,
          joinToken: waiter.joinToken,
        });
      } else {
        remaining.push(waiter);
      }
    }
    this.waiters = remaining;
  }

  /** Bind a receipt only after verifying the native entry + checkpoint. */
  private bindReceipt(rt: AgentRuntime, message: MailboxMessage): void {
    const worker = rt.worker;
    if (!worker) return;
    void worker
      .request("checkpoint", {}, { taskRunId: rt.activeRun?.taskRunId, generation: rt.activeRun?.generation })
      .then((res) => {
        const leaf = (res as { leafEntryId?: string })?.leafEntryId;
        if (typeof leaf !== "string" || !leaf) return;
        const receipt: MessageReceipt = {
          messageId: message.id,
          nativeEntryId: leaf,
          leafId: leaf,
          checkpointSeq: this.store.durableSeq(),
          byteOffset: -1,
        };
        message.receipt = receipt;
        this.publish("mailbox.receipt", { messageId: message.id, leafEntryId: leaf });
      })
      .catch(() => {});
  }

  /** Cancel expired unanswered questions (deadlines are explicit). */
  private sweepExpiredQuestions(): void {
    const now = Date.now();
    for (const q of this.questions.values()) {
      if (q.answered || q.cancelled) continue;
      if (Date.parse(q.deadlineAt) > now) continue;
      q.cancelled = true;
      this.publish("mailbox.accepted", { messageId: q.messageId, questionExpired: true, to: q.to });
      const asker = this.agents.get(q.from);
      if (asker && asker.record.observed === "awaiting_parent") {
        asker.record.observed = asker.activeRun ? "running" : "queued";
        asker.record.detail = "question expired without reply; continuing";
      }
    }
  }

  // -- observation -----------------------------------------------------------------

  list(caller: CallerId): AgentView[] {
    const out: AgentView[] = [];
    for (const rt of this.agents.values()) {
      if (!this.visibleTo(caller, rt.record)) continue;
      out.push(this.viewOf(rt));
    }
    out.sort((a, b) => (a.path < b.path ? -1 : 1));
    return out;
  }

  read(caller: CallerId, target: AgentId, view: "status" | "result" | "events", cursor: number, limit: number): ReadResult {
    const rt = this.agents.get(target);
    if (!rt) throw err("NOT_FOUND", `agent ${target} unknown`);
    if (!this.visibleTo(caller, rt.record)) throw err("FORBIDDEN", "agent not visible to caller");
    const bounded = Math.min(Math.max(1, limit), 100);
    if (view === "status") {
      return { status: this.viewOf(rt), result: null, events: [], cursor };
    }
    if (view === "result") {
      const last = rt.lastResult;
      return {
        status: this.viewOf(rt),
        result: last ? { taskRunId: last.taskRunId, outcome: last.outcome, text: last.text.slice(0, 8000) } : null,
        events: [],
        cursor,
      };
    }
    const { records, cursor: next } = this.store.readSince(cursor, bounded);
    return {
      status: this.viewOf(rt),
      result: null,
      events: records
        .filter((r) => (r.body as { agentId?: string })["agentId"] === target || (r.body as { agentId?: string })["agentId"] === undefined)
        .map((r) => ({
          seq: r.seq,
          kind: r.kind,
          agentId: (r.body as { agentId?: AgentId })["agentId"] ?? null,
          taskRunId: (r.body as { taskRunId?: TaskRunId })["taskRunId"] ?? null,
          summary: summarize(r.kind, r.body as Record<string, unknown>),
          at: r.at,
        })),
      cursor: next,
    };
  }

  /** Notices for the governing run boundary drain (bounded, cursor-based). */
  drainNotices(cursor: number, limit = 20): { events: JournalEventView[]; cursor: number } {
    const events = this.notices.filter((n) => n.seq > cursor).slice(0, limit);
    return { events, cursor: events.length > 0 ? events[events.length - 1]!.seq : cursor };
  }

  /** Open questions visible to the caller (human governor sees all). */
  pendingQuestions(caller: CallerId): Array<{ messageId: MessageId; from: string; to: string; text: string; deadlineAt: string }> {
    const out: Array<{ messageId: MessageId; from: string; to: string; text: string; deadlineAt: string }> = [];
    for (const q of this.questions.values()) {
      if (q.answered || q.cancelled) continue;
      if (caller !== "governor" && caller !== "user" && q.from !== caller && q.to !== caller) continue;
      out.push({ messageId: q.messageId, from: String(q.from), to: String(q.to), text: q.text, deadlineAt: q.deadlineAt });
    }
    return out;
  }

  // -- waits -------------------------------------------------------------------------

  async wait(
    caller: CallerId,
    cursor: number,
    timeoutMs: number,
    targets: Array<{ agentId: AgentId; taskRunId: TaskRunId | null }> | null,
    condition: WaitCondition,
  ): Promise<WaitResult> {
    // Subscribe and capture the sequence boundary atomically (single-threaded:
    // register first, then inspect — arrivals in between are not lost).
    // Settlement targets capture exact task-run IDs when registered;
    // unknown agents are caller bugs, rejected rather than silently ignored.
    if (targets) {
      for (const t of targets) {
        if (!this.agents.has(t.agentId)) throw err("NOT_FOUND", `wait target ${t.agentId} unknown`);
      }
    }
    const joinTaskRunIds: TaskRunId[] = [];
    const joinToken = randomUUID();
    if (targets) {
      for (const t of targets) {
        const rt = this.agents.get(t.agentId);
        if (rt && t.taskRunId) joinTaskRunIds.push(t.taskRunId);
        else if (rt && rt.record.currentTaskRunId) joinTaskRunIds.push(rt.record.currentTaskRunId);
      }
    }
    this.sweepExpiredQuestions();
    return new Promise<WaitResult>((resolve) => {
      const waiter: WaiterReg = {
        id: randomUUID(),
        caller,
        cursor,
        targets,
        condition,
        joinTaskRunIds,
        joinToken,
        timer: setTimeout(() => {
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          const { records, cursor: next } = this.store.readSince(cursor, 50);
          resolve({ completed: false, reason: "timeout", events: projectViews(records), cursor: next, joinTaskRunIds, joinToken });
        }, Math.min(Math.max(1, timeoutMs || WAIT_DEFAULT_MS), 300_000)),
        resolve: (r) => {
          clearTimeout(waiter.timer);
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          resolve(r);
        },
      };
      this.waiters.push(waiter);
      // Immediate satisfaction check (already-settled captured runs satisfy joins).
      const immediate = this.checkWaitSatisfied(waiter);
      if (immediate) waiter.resolve(immediate);
    });
  }

  private checkWaitSatisfied(waiter: WaiterReg): WaitResult | null {
    const { records, cursor } = this.store.readSince(waiter.cursor, 50);
    const relevant = records.filter((r) => this.eventRelevant(waiter, r.body as Record<string, unknown>));
    if (waiter.condition === "activity") {
      if (relevant.length > 0) {
        return { completed: true, reason: "events", events: projectViews(relevant), cursor, joinTaskRunIds: waiter.joinTaskRunIds, joinToken: waiter.joinToken };
      }
      return null;
    }
    const settledRuns = new Set<TaskRunId>();
    for (const r of relevant) {
      if (r.kind === "task.terminal") settledRuns.add((r.body as { taskRunId: TaskRunId })["taskRunId"]);
    }
    if (waiter.joinTaskRunIds.length > 0) {
      const wanted = waiter.joinTaskRunIds;
      const done = wanted.filter((id) => settledRuns.has(id));
      // A new task run never changes what an older join waited for.
      if (waiter.condition === "any_settled" && done.length > 0) {
        return { completed: true, reason: "settled", events: projectViews(relevant), cursor, joinTaskRunIds: waiter.joinTaskRunIds, joinToken: waiter.joinToken };
      }
      if (waiter.condition === "all_settled" && done.length === wanted.length) {
        return { completed: true, reason: "settled", events: projectViews(relevant), cursor, joinTaskRunIds: waiter.joinTaskRunIds, joinToken: waiter.joinToken };
      }
      return null;
    }
    if (settledRuns.size > 0 && (waiter.condition === "any_settled" || waiter.condition === "all_settled")) {
      return { completed: true, reason: "settled", events: projectViews(relevant), cursor, joinTaskRunIds: waiter.joinTaskRunIds, joinToken: waiter.joinToken };
    }
    return null;
  }

  private eventRelevant(waiter: WaiterReg, body: Record<string, unknown>): boolean {
    if (!waiter.targets || waiter.targets.length === 0) return true;
    const agentId = body["agentId"] as string | undefined;
    const taskRunId = body["taskRunId"] as string | undefined;
    return waiter.targets.some((t) => t.agentId === agentId && (t.taskRunId === null || t.taskRunId === taskRunId));
  }

  private evaluateWaiters(view: JournalEventView): void {
    const body = { agentId: view.agentId, taskRunId: view.taskRunId, kind: view.kind };
    for (const waiter of [...this.waiters]) {
      if (!this.eventRelevant(waiter, body as unknown as Record<string, unknown>)) continue;
      const satisfied = this.checkWaitSatisfied({ ...waiter, cursor: waiter.cursor });
      if (satisfied) waiter.resolve(satisfied);
    }
  }

  /** New user input cancels waits without cancelling children. */
  cancelCallerWaits(caller: CallerId): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.caller === caller) {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.resolve({ completed: false, reason: "input", events: [], cursor: waiter.cursor, joinTaskRunIds: waiter.joinTaskRunIds, joinToken: waiter.joinToken });
      }
    }
  }

  // -- interruption & close ------------------------------------------------------------

  async interrupt(caller: CallerId, target: AgentId, requestId: string): Promise<{ accepted: true; previous: AgentView }> {
    return this.serialized(async () => {
      const rt = this.agents.get(target);
      if (!rt) throw err("NOT_FOUND", `agent ${target} unknown`);
      this.checkControl(caller, rt.record);
      const previous = this.viewOf(rt);
      const prior = this.store.loadCommand(requestId);
      if (prior) throw err("DUPLICATE_REQUEST", `requestId ${requestId} already used`);
      const accepted = this.publish("command.accepted", { requestId, action: "interrupt", agentId: target });
      this.store.recordCommand(requestId, accepted);
      // Interrupt the target run, its linked gate, and active descendants.
      await this.interruptSubtree(rt);
      return { accepted: true as const, previous };
    });
  }

  private async interruptSubtree(rt: AgentRuntime): Promise<void> {
    if (rt.activeRun) rt.activeRun.interruptRequested = true;
    this.publish("agent.interrupted", { agentId: rt.record.id, taskRunId: rt.activeRun?.taskRunId ?? null });
    this.gate.cancelForAgent(rt.record.id, "interrupted");
    await this.broker.cancelJobs(rt.record.id);
    if (rt.worker && rt.activeRun) {
      try {
        await rt.worker.request("interrupt", {}, { taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation, timeoutMs: 15_000 });
      } catch {
        // Acceptance does not imply termination; the settled event (or
        // recovery reconciliation) confirms the stopped state separately.
      }
    }
    for (const child of this.childrenOf(rt.record.id)) {
      if (child.activeRun) await this.interruptSubtree(child);
    }
  }

  async close(caller: CallerId, target: AgentId, requestId: string): Promise<void> {
    // Section 1 (serialized): validate, dedup, accept, interrupt the subtree.
    await this.serialized(async () => {
      const rt = this.agents.get(target);
      if (!rt) throw err("NOT_FOUND", `agent ${target} unknown`);
      this.checkControl(caller, rt.record);
      const prior = this.store.loadCommand(requestId);
      if (prior) throw err("DUPLICATE_REQUEST", `requestId ${requestId} already used`);
      const accepted = this.publish("command.accepted", { requestId, action: "close", agentId: target });
      this.store.recordCommand(requestId, accepted);
      // Mark closed before interrupting so post-settlement autodispatch
      // (pumpQueue) cannot start queued work during teardown.
      const markClosed = (id: AgentId): void => {
        const r = this.agents.get(id);
        if (!r || r.record.desiredLifecycle === "closed") return;
        r.record.desiredLifecycle = "closed";
        for (const child of this.childrenOf(id)) markClosed(child.record.id);
      };
      markClosed(target);
      for (const child of [...this.childrenOf(target)]) {
        await this.interruptSubtree(child);
      }
      await this.interruptSubtree(rt);
    });
    // Section 2 (outside the chain): confirm stopped state while settled
    // events can still be processed. Holding the mutex here would deadlock
    // finalization behind the waiter.
    await this.awaitSubtreeIdle(target, 15_000);
    // Section 3 (serialized): retire the logical subtree.
    await this.serialized(async () => {
      const rt = this.agents.get(target);
      if (!rt) throw err("NOT_FOUND", `agent ${target} unknown`);
      for (const child of [...this.childrenOf(target)]) {
        this.retireSubtree(child);
      }
      this.retireSubtree(rt);
    });
  }

  /** Confirm stopped state: no active runs and no owned jobs in the subtree. */
  private async awaitSubtreeIdle(rootId: AgentId, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const subtree = (): AgentRuntime[] => {
      const out: AgentRuntime[] = [];
      const visit = (id: AgentId): void => {
        const rt = this.agents.get(id);
        if (!rt) return;
        out.push(rt);
        for (const child of this.childrenOf(id)) visit(child.record.id);
      };
      visit(rootId);
      return out;
    };
    while (Date.now() - start < timeoutMs) {
      const busy = subtree().some((rt) => rt.activeRun !== null || this.broker.activeJobs(rt.record.id).length > 0);
      if (!busy) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  private async closeSubtree(rt: AgentRuntime): Promise<void> {
    if (rt.activeRun) await this.interruptSubtree(rt);
    this.retireSubtree(rt);
  }

  private retireSubtree(rt: AgentRuntime): void {
    rt.record.desiredLifecycle = "closed";
    rt.record.observed = rt.activeRun ? rt.record.observed : "settled";
    this.paths.retire(rt.record.path);
    this.releaseRunnable(rt);
    this.releaseResident(rt);
    rt.runnableLease = null;
    rt.residentLease = null;
    rt.worker?.kill();
    rt.worker = null;
    rt.record.residency = "unloaded";
    const parent = rt.record.parentId ? this.agents.get(rt.record.parentId) : undefined;
    if (parent) parent.record.activeDescendants = Math.max(0, parent.record.activeDescendants - 1);
    // Sessions, results, and dirty worktrees are preserved; retained-file
    // cleanup is a separate explicit user action.
    this.publish("agent.closed", { agentId: rt.record.id, path: rt.record.path });
  }

  // -- resume / reload -------------------------------------------------------------------

  /** Ordinary resumption uses send_message task; this reloads an unloaded agent. */
  private async reloadAgent(rt: AgentRuntime, reason: string): Promise<void> {
    if (rt.record.desiredLifecycle === "closed") throw err("CLOSED", "closed agents cannot be resumed");
    if (rt.worker) return;
    if (rt.quarantined) throw err("RECOVERY_OWNER_UNCONFIRMED", rt.quarantined);
    // Recalculate against current root authority before opening.
    const parent = rt.record.parentId ? this.agents.get(rt.record.parentId) : undefined;
    const ownerGrants = parent ? parent.record.grants : rootGrants(this.policy);
    const granted = intersectGrants(this.policy, ownerGrants, {
      profile: rt.record.profile,
      repoId: rt.record.allocation?.repoId ?? null,
      shell: rt.record.grants.shell,
      network: rt.record.grants.network,
      // Keep the resolved identity: the override allowlist governs changes,
      // not inherited sessions. Unavailable models fail at worker launch.
      model: null,
      depth: rt.record.depth,
    });
    if (!granted.ok) throw granted.error;
    rt.record.grants = granted.grants;
    rt.record.policyRevision = this.policy.revision;
    // Restore the latest validated live checkpoint byte-for-byte into a
    // new working session file and open it through the SDK. Never adopt a
    // newer uncommitted tail, edit transcript entries, or invent results.
    // A missing/corrupt live checkpoint refuses resume explicitly.
    const checkpoint = this.store.loadCheckpoint(rt.record.id);
    if (checkpoint) {
      const sessionFile = join(this.rootDir, "sessions", rt.record.id, "session.jsonl");
      mkdirSync(join(this.rootDir, "sessions", rt.record.id), { recursive: true });
      writeFileSync(sessionFile, checkpoint.bytes);
      fsyncFile(sessionFile);
      fsyncDir(join(this.rootDir, "sessions", rt.record.id));
      rt.pendingRestore = { sessionFile, leafEntryId: checkpoint.ref.leafEntryId };
    }
    const resident = this.scheduler.tryAcquireResident(rt.record.id);
    if (!resident) throw err("CAPACITY_EXCEEDED", "no resident capacity for reload");
    rt.residentLease = resident;
    const next = rt.queue.find((q) => !q.dispatched);
    const text = next ? next.text : `Resume: continue task ${rt.record.currentTaskRunId ?? "(none)"}. (${reason})`;
    if (next) {
      next.dispatched = true;
      rt.record.currentTaskRunId = next.id;
      rt.record.executionGeneration += 1;
    }
    await this.startWorker(rt, text);
    // Reconcile accepted notes against the restored branch: reinsert any
    // accepted message whose native entry is absent (same message ID).
    await this.reconcileMailbox(rt);
  }

  private async reconcileMailbox(rt: AgentRuntime): Promise<void> {
    const worker = rt.worker;
    if (!worker) return;
    for (const messageId of rt.record.pendingMessageIds) {
      const message = this.messages.get(messageId);
      if (!message || message.receipt || message.mode === "task") continue;
      try {
        // Check the restored active branch first: entries retained there
        // (even if compacted out of model context) must not be reinserted.
        const found = (await worker.request("find_entry", { messageId: message.id }, { timeoutMs: 10_000 })) as {
          found?: string | null;
          entryId?: string | null;
        };
        if (found?.found) {
          message.receipt = {
            messageId: message.id,
            nativeEntryId: String(found.entryId ?? found.found),
            leafId: String(found.entryId ?? found.found),
            checkpointSeq: this.store.durableSeq(),
            byteOffset: -1,
          };
          this.publish("mailbox.receipt", { messageId: message.id, leafEntryId: message.receipt.nativeEntryId, reconciled: true });
          continue;
        }
        // Absent from the restored branch despite any old receipt: reinsert
        // with the original message ID (worker dedups by messageId).
        await worker.request("deliver", { mode: "note", text: message.text, messageId: message.id }, {}).catch(() => {});
      } catch {
        // Remains pending; a later boundary retries.
      }
    }
  }

  // -- recovery ----------------------------------------------------------------------------

  async recover(): Promise<{ epoch: string; settled: string[]; quarantined: string[]; requeued: string[] }> {
    return this.serialized(async () => {
      const settled: string[] = [];
      const quarantined: string[] = [];
      const requeued: string[] = [];
      this.epoch = randomUUID();
      // Fence old connections; owned handles die here. Suspended throughout
      // recovery: no parked startups or repairs dispatch mid-recovery.
      this.suspended = true;
      for (const rt of this.agents.values()) {
        try {
          rt.worker?.kill();
        } catch {
          // gone
        }
        rt.worker = null;
        if (rt.runnableLease) this.scheduler.release(rt.runnableLease);
        if (rt.residentLease) this.scheduler.release(rt.residentLease);
        rt.runnableLease = null;
        rt.residentLease = null;
      }
      this.broker.revokeApprovals("*" as AgentId);
      // Gate recovery: running reviews become interrupted (resumable with
      // fresh context, counters kept); never infer approval from a crash.
      this.gate.markInterruptedForRecovery();
      this.publish("recovery.event", { epoch: this.epoch, phase: "started" });
      const { records } = this.store.readSince(0, 1_000_000);
      for (const rt of this.agents.values()) {
        if (rt.record.desiredLifecycle === "closed") continue;
        // A live run and a journal-restored unfinished run reconcile alike:
        // durably settle the old run before any replacement is scheduled.
        const lost = rt.activeRun
          ? { taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation, workerPid: rt.workerPid, workerBoot: rt.workerBoot }
          : (this.pendingLost.get(rt.record.id) ?? null);
        if (!lost) {
          if (rt.record.taskPhase === "terminal") continue;
          // Accepted but never dispatched: keep the original task ID, mark
          // for explicit resume (no automatic inference after restart).
          for (const q of rt.queue) {
            if (!q.dispatched) requeued.push(q.id);
          }
          continue;
        }
        await this.reconcileLostRun(rt, lost, records, settled, quarantined, requeued);
        this.pendingLost.delete(rt.record.id);
      }
      this.publish("recovery.event", { epoch: this.epoch, phase: "completed", settled: settled.length, quarantined: quarantined.length });
      this.suspended = false;
      // Parked startups and repairs resume under the new epoch.
      this.pumpParked();
      this.pumpPendingRepair();
      return { epoch: this.epoch, settled, quarantined, requeued };
    });
  }

  /**
   * Durably settle a lost main/repair run before scheduling replacements.
   * Confirms old-job termination (verified process identity, never
   * guessed PIDs); unverifiable ownership quarantines the workspace.
   * Preserves uncertain effects and immutable old outcomes. Old joins
   * settle on the old task ID; replacements always take new IDs.
   */
  private async reconcileLostRun(
    rt: AgentRuntime,
    lost: { taskRunId: TaskRunId; generation: number; workerPid: number | null; workerBoot: { bootId: string; starttime: string } | null },
    records: Array<{ kind: string; body: Record<string, unknown> }>,
    settled: string[],
    quarantined: string[],
    requeued: string[],
  ): Promise<void> {
    // Confirm owned-job termination before replacement leases. Broker jobs
    // are supervisor-side; after a restart none are live in this process.
    const intents = records.filter(
      (r) =>
        r.kind === "tool.intent" &&
        (r.body as { agentId?: string })["agentId"] === rt.record.id &&
        (r.body as { taskRunId?: string })["taskRunId"] === lost.taskRunId,
    );
    const outcomes = new Set(
      records
        .filter((r) => r.kind === "tool.outcome")
        .map((r) => (r.body as { operationId?: string })["operationId"]),
    );
    const unconfirmed = intents.filter((i) => !outcomes.has((i.body as { operationId?: string })["operationId"]));
    let ownership: OwnershipVerdict = "dead";
    if (lost.workerPid !== null) {
      ownership = verifyOwnership(lost.workerPid, lost.workerBoot);
      if (ownership === "live-match") {
        ownership = (await killAndConfirm(lost.workerPid)) ? "dead" : "live-mismatch";
      }
    }
    rt.workerPid = null;
    rt.workerBoot = null;
    rt.activeRun = null;
    rt.record.observed = "lost";
    const ownershipOk = ownership === "dead";
    if ((unconfirmed.length > 0 || !ownershipOk) && rt.record.allocation?.worktreePath) {
      const why = !ownershipOk
        ? `unverifiable worker ownership (${ownership}); replacement execution prohibited here`
        : `${unconfirmed.length} unconfirmed tool effect(s); replacement execution prohibited here`;
      rt.quarantined = `RECOVERY_OWNER_UNCONFIRMED: ${why}`;
      quarantined.push(rt.record.id);
      this.settleTaskTerminal(rt, lost.taskRunId, "uncertain", `lost: ${why}`);
    } else if (unconfirmed.length > 0 || !ownershipOk) {
      this.settleTaskTerminal(rt, lost.taskRunId, "uncertain", `lost with ${unconfirmed.length} unconfirmed effect(s); ownership ${ownership}`);
    } else {
      this.settleTaskTerminal(rt, lost.taskRunId, "interrupted", "process lost; owned-job termination confirmed; effects accounted");
    }
    settled.push(lost.taskRunId);
    for (const q of rt.queue) {
      if (!q.dispatched) requeued.push(q.id);
    }
  }

  /**
   * Evict an idle settled worker: kill the process, release leases, keep
   * the record, native session, and identity for later resume. Never
   * evicts a running generation.
   */
  async evictWorker(caller: CallerId, agentId: AgentId): Promise<void> {
    return this.serialized(async () => {
      const rt = this.agents.get(agentId);
      if (!rt) throw err("NOT_FOUND", `agent ${agentId} unknown`);
      this.checkControl(caller, rt.record);
      if (rt.activeRun) throw err("CONFLICT", "cannot evict a running generation");
      try {
        rt.worker?.kill();
      } catch {
        // gone
      }
      rt.worker = null;
      this.releaseRunnable(rt);
      this.releaseResident(rt);
      rt.record.residency = "unloaded";
      rt.record.detail = "evicted; native session retained for resume";
      this.publish("recovery.event", { agentId, phase: "evicted" });
    });
  }

  /** Explicit resume of an accepted-undispatched queued task (keeps its ID). */
  async dispatchPending(caller: CallerId, agentId: AgentId, taskRunId: TaskRunId): Promise<void> {    return this.serialized(async () => {
      const rt = this.agents.get(agentId);
      if (!rt) throw err("NOT_FOUND", `agent ${agentId} unknown`);
      this.checkControl(caller, rt.record);
      const queued = rt.queue.find((q) => q.id === taskRunId && !q.dispatched);
      if (!queued) throw err("NOT_FOUND", `pending task ${taskRunId} unknown`);
      if (rt.activeRun) throw err("CONFLICT", "agent has an unfinished run");
      if (rt.quarantined) throw err("RECOVERY_OWNER_UNCONFIRMED", rt.quarantined);
      await this.reloadAgent(rt, "explicit resume");
    });
  }

  // -- GateHost: managed reviewer, fingerprints, checks, repair ---------------------

  nowIso(): string {
    return this.now();
  }

  setTaskPhase(agentId: AgentId, phase: TaskPhase): void {
    const rt = this.agents.get(agentId);
    if (!rt) return;
    rt.record.taskPhase = phase;
    this.publish("task.phase", { agentId, taskRunId: rt.record.currentTaskRunId, phase });
  }

  settleGatedTask(agentId: AgentId, taskRunId: TaskRunId, outcome: string, detail: string): void {
    const rt = this.agents.get(agentId);
    if (!rt) return;
    this.settleTaskTerminal(rt, taskRunId, outcome, detail.slice(0, 2000));
  }

  quiescent(agentId: AgentId): boolean {
    const rt = this.agents.get(agentId);
    if (!rt) return false;
    if (rt.activeRun) return false;
    if (this.broker.activeJobs(agentId).length > 0) return false;
    const gateTask = this.gate.inspect(rt.record.currentTaskRunId ?? "");
    if (gateTask?.reviewerId) {
      const reviewer = this.agents.get(gateTask.reviewerId);
      if (reviewer?.activeRun) return false;
    }
    return true;
  }

  /** Create (or reuse) the protected reviewer sibling for a gated task. */
  createManagedReviewer(mainAgentId: AgentId, taskRunId: TaskRunId, spec: NormalizedGateSpec): AgentId {
    const main = this.agents.get(mainAgentId);
    if (!main) throw err("NOT_FOUND", `main agent ${mainAgentId} unknown`);
    const existing = this.gate.inspect(taskRunId);
    if (existing?.reviewerId && this.agents.has(existing.reviewerId)) return existing.reviewerId;
    // Repeated rounds create executions, not agents: charge one identity.
    const charged = this.scheduler.chargeAgentCreation();
    if (!charged.ok) throw err(charged.code, charged.message);
    const reviewerId = randomUUID();
    const mainAlloc = main.record.allocation;
    const readRoots = mainAlloc?.worktreePath ? [mainAlloc.worktreePath, ...(mainAlloc.readRoots ?? [])] : [...(mainAlloc?.readRoots ?? [])];
    const record: AgentRecord = {
      id: reviewerId,
      path: `${main.record.path}/__gate`,
      rootId: this.rootId,
      parentId: main.record.parentId,
      depth: main.record.depth,
      profile: "reader",
      createdEntryId: `gate:${taskRunId}`,
      nativeSessionPath: null,
      grants: { tools: ["read", "grep", "find", "ls"], repos: [], shell: false, network: false, nesting: false, maxDepth: main.record.depth },
      allocation: { kind: "reader", readRoots, worktreePath: null, baseCommit: mainAlloc?.baseCommit ?? null, repoId: mainAlloc?.repoId ?? null, tmpDir: anonTmp(this.rootDir, reviewerId) },
      instructionHash: main.record.instructionHash,
      policyRevision: this.policy.revision,
      model: { provider: spec.model.provider, id: spec.model.id, thinkingLevel: spec.thinkingLevel },
      currentTaskRunId: taskRunId,
      executionGeneration: 0,
      pendingTaskIds: [],
      pendingMessageIds: [],
      lastEventSeq: 0,
      desiredLifecycle: "open",
      observed: "queued",
      outcome: null,
      taskPhase: "working",
      taskOutcome: null,
      residency: "unloaded",
      detail: "managed gate reviewer",
      lastActivityAt: this.now(),
      activeDescendants: 0,
    };
    this.agents.set(reviewerId, {
      record,
      worker: null,
      runnableLease: null,
      residentLease: null,
      queue: [],
      activeRun: null,
      lastResult: null,
      usage: { inputTokens: 0, outputTokens: 0, cost: null, unknown: false },
      lastPreview: "",
      quarantined: null,
      gateTaskRunId: null,
      pendingRepair: null,
      parkedStartup: null,
      pendingRestore: null,
      workerPid: null,
      workerBoot: null,
    });
    this.store.append("agent.spawned", { agentId: reviewerId, path: record.path, parentId: record.parentId, profile: "reader", taskRunId, managedGate: true, grants: record.grants, allocation: record.allocation, model: record.model });
    return reviewerId;
  }

  /** Evict one idle settled worker to make room; false when none exists. */
  private evictOneIdle(): boolean {
    for (const rt of this.agents.values()) {
      if (rt.worker && !rt.activeRun && rt.record.taskPhase === "terminal" && !this.gate.isReviewer(rt.record.id)) {
        try {
          rt.worker.kill();
        } catch {
          // gone
        }
        rt.worker = null;
        this.releaseRunnable(rt);
        this.releaseResident(rt);
        rt.record.residency = "unloaded";
        rt.record.detail = "evicted; native session retained for resume";
        return true;
      }
    }
    return false;
  }

  /** Fresh in-memory reviewer conversation per evaluation, same identity. */
  startReviewerExecution(reviewerId: AgentId, input: { reviewId: string; candidateId: string; prompt: string }): void {
    const rt = this.agents.get(reviewerId);
    if (!rt) throw err("NOT_FOUND", `reviewer ${reviewerId} unknown`);
    // A crashed gate is rerun with fresh context, never resumed mid-evaluation.
    try {
      rt.worker?.kill();
    } catch {
      // gone
    }
    rt.worker = null;
    this.releaseRunnable(rt);
    this.releaseResident(rt);
    rt.runnableLease = null;
    rt.residentLease = null;
    const resident = this.scheduler.tryAcquireResident(reviewerId);
    if (!resident) {
      // Evict one idle settled worker before failing: repeated rounds
      // create executions, not an unbounded number of residents.
      if (!this.evictOneIdle()) throw err("CAPACITY_EXCEEDED", "no resident capacity for reviewer");
      const retry = this.scheduler.tryAcquireResident(reviewerId);
      if (!retry) throw err("CAPACITY_EXCEEDED", "no resident capacity for reviewer");
      rt.residentLease = retry;
    } else {
      rt.residentLease = resident;
    }
    const runnable = this.scheduler.tryAcquireRunnable(reviewerId);
    if (!runnable) {
      rt.record.observed = "queued";
      rt.record.detail = "reviewer parked: waiting for runnable lease";
      rt.pendingRepair = `__review:${input.reviewId}:${input.candidateId}:${input.prompt}`;
      return;
    }
    rt.runnableLease = runnable;
    rt.record.executionGeneration += 1;
    rt.record.observed = "starting";
    rt.record.taskPhase = "working";
    const generation = rt.record.executionGeneration;
    const factory = this.opts.workerFactory ?? ((o) => new WorkerHandle({
      workerPath: this.opts.workerPath || join(this.rootDir, "..", "worker.js"),
      rootEpoch: o.rootEpoch,
      agentId: o.agentId,
      sdkRoot: this.opts.sdkRoot ?? null,
      deterministic: this.opts.deterministic ?? false,
      agentDir: join(this.rootDir, "worker-agent-dirs", o.agentId),
      sessionsDir: join(this.rootDir, "sessions"),
      hostAgentDir: this.opts.hostAgentDir,
    }, newWorkerBinding(o.rootEpoch, o.agentId)));
    const worker = factory({ agentId: reviewerId, instanceId: randomUUID(), rootEpoch: this.epoch });
    rt.worker = worker;
    rt.record.residency = "loaded";
    worker.setEventHandler((event) => {
      void this.serialized(async () => {
        this.onWorkerEvent(rt, event);
      });
    });
    worker.setToolRequestHandler(async (payload) => this.onToolRequest(rt, payload));
    void worker.launch().then(async () => {
      try {
        await worker.request("initialize", {
          taskText: input.prompt,
          profile: "reader",
          instructionHash: rt.record.instructionHash,
          model: rt.record.model,
          taskRunId: rt.record.currentTaskRunId,
          executionGeneration: generation,
          workdir: rt.record.allocation?.readRoots[0] ?? this.rootDir,
          readRoots: rt.record.allocation?.readRoots ?? [],
          writable: false,
        }, { taskRunId: rt.record.currentTaskRunId ?? undefined, generation });
        await this.serialized(async () => {
          rt.record.observed = "running";
          rt.activeRun = { taskRunId: rt.record.currentTaskRunId!, generation, interruptRequested: false };
        });
      } catch (e) {
        await this.serialized(async () => {
          this.gate.executionFailed(reviewerId, (e as Error).message);
        });
      }
    }).catch((e: Error) => {
      void this.serialized(async () => {
        this.gate.executionFailed(reviewerId, e.message);
      });
    });
  }

  async cancelReviewer(reviewerId: AgentId): Promise<void> {
    const rt = this.agents.get(reviewerId);
    if (!rt) return;
    try {
      rt.worker?.kill();
    } catch {
      // gone
    }
    rt.worker = null;
    this.releaseRunnable(rt);
    this.releaseResident(rt);
    rt.runnableLease = null;
    rt.residentLease = null;
    rt.activeRun = null;
    rt.record.observed = "settled";
    rt.record.residency = "unloaded";
  }

  /** Repair runs as a new execution generation in the same task run. */
  startRepairExecution(mainAgentId: AgentId, taskRunId: TaskRunId, criticism: string): void {
    const rt = this.agents.get(mainAgentId);
    if (!rt) throw err("NOT_FOUND", `main agent ${mainAgentId} unknown`);
    if (rt.record.currentTaskRunId !== taskRunId) throw err("STALE_GENERATION", "repair targets a superseded task run");
    if (rt.activeRun) throw err("CONFLICT", "main execution still active");
    const runnable = this.scheduler.tryAcquireRunnable(mainAgentId);
    if (!runnable) {
      rt.record.taskPhase = "repair_queued";
      rt.pendingRepair = criticism;
      return;
    }
    rt.runnableLease = runnable;
    if (!rt.worker) {
      // Reload under current authority, then repair.
      rt.record.taskPhase = "repair_queued";
      rt.pendingRepair = criticism;
      void this.serialized(async () => {
        try {
          await this.reloadAgent(rt, "repair");
          this.pumpPendingRepair();
        } catch (e) {
          this.settleTaskTerminal(rt, taskRunId, "failed", `repair reload failed: ${(e as Error).message}`);
        }
      });
      return;
    }
    rt.record.executionGeneration += 1;
    const generation = rt.record.executionGeneration;
    rt.record.taskPhase = "working";
    rt.record.outcome = null;
    rt.record.observed = "running";
    rt.record.detail = `repair generation ${generation}`;
    rt.activeRun = { taskRunId, generation, interruptRequested: false };
    this.publishGenerationStarted(mainAgentId, taskRunId, generation, { repair: true });
    this.gate.noteRepairDispatched(taskRunId);
    const worker = rt.worker;
    void worker.request("deliver", { mode: "repair", text: criticism }, { taskRunId, generation }).catch((e: Error) => {
      void this.serialized(async () => {
        this.publish("generation.settled", { agentId: mainAgentId, taskRunId, generation, outcome: "failed", error: e.message });
        this.settleTaskTerminal(rt, taskRunId, "failed", e.message);
      });
    });
  }

  private pumpPendingRepair(): void {
    for (const rt of this.agents.values()) {
      if (!rt.pendingRepair || rt.activeRun) continue;
      // Parked reviewer evaluations resume first.
      if (rt.pendingRepair.startsWith("__review:")) {
        const parts = rt.pendingRepair.split(":");
        const reviewId = parts[1];
        const candidateId = parts[2];
        const prompt = parts.slice(3).join(":");
        const runnable = this.scheduler.tryAcquireRunnable(rt.record.id);
        if (!runnable) continue;
        rt.pendingRepair = null;
        rt.runnableLease = runnable;
        this.startReviewerExecution(rt.record.id, { reviewId: reviewId ?? "", candidateId: candidateId ?? "", prompt });
        continue;
      }
      if (rt.record.taskPhase !== "repair_queued") continue;
      const criticism = rt.pendingRepair;
      const taskRunId = rt.record.currentTaskRunId;
      if (!taskRunId) continue;
      rt.pendingRepair = null;
      try {
        this.startRepairExecution(rt.record.id, taskRunId, criticism);
      } catch {
        rt.pendingRepair = criticism;
      }
    }
  }

  fingerprintWorkspace(agentId: AgentId, promisedOutputs: string[]): WorkspaceFingerprint {
    const rt = this.agents.get(agentId);
    const worktree = rt?.record.allocation?.worktreePath ?? null;
    const baseCommit = rt?.record.allocation?.baseCommit ?? null;
    if (!worktree) {
      const text = rt?.lastResult?.text ?? "";
      return { baseCommit, textOnly: true, textHash: createHash("sha256").update(text, "utf8").digest("hex"), files: [] };
    }
    const fp = fingerprintWorktree(worktree, baseCommit, promisedOutputs);
    return { baseCommit: fp.baseCommit, textOnly: false, textHash: null, files: fp.files };
  }

  workspaceMatches(agentId: AgentId, candidate: CandidateRecord): boolean {
    const current = this.fingerprintWorkspace(agentId, []);
    const a = candidate.fingerprint;
    if (a.textOnly !== current.textOnly) return false;
    if (a.textOnly) return a.textHash === current.textHash;
    if (a.baseCommit !== current.baseCommit) return false;
    if (a.files.length !== current.files.length) return false;
    const prev = new Map(a.files.map((f) => [f.path, f.hash]));
    for (const f of current.files) {
      if (prev.get(f.path) !== f.hash) return false;
    }
    return true;
  }

  async runCheck(agentId: AgentId, check: { id: string; command: string }): Promise<{ exitCode: number | null; output: string }> {
    const rt = this.agents.get(agentId);
    if (!rt) throw err("NOT_FOUND", `agent ${agentId} unknown`);
    const worktree = rt.record.allocation?.worktreePath;
    if (!worktree) throw err("INVALID", "checks require a writer worktree");
    const result = await this.broker.runControllerCheck({
      agentId,
      taskRunId: rt.record.currentTaskRunId,
      generation: rt.record.executionGeneration,
      readRoots: [worktree],
      tmpDir: rt.record.allocation?.tmpDir ?? this.rootDir,
      hidePaths: [this.rootDir],
      command: check.command,
      cwd: worktree,
    });
    return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`.slice(0, 8000) };
  }

  // -- helpers -------------------------------------------------------------------------------

  private authorOf(caller: CallerId): AgentId | "governor" {
    return caller === "user" ? "governor" : caller;
  }

  private resolveTarget(caller: CallerId, target: AgentId | "parent"): AgentId {
    if (target !== "parent") return target;
    if (caller === "governor" || caller === "user") throw err("INVALID", "governor has no parent address");
    const rt = this.agents.get(caller);
    if (!rt) throw err("NOT_FOUND", `caller ${caller} unknown`);
    return rt.record.parentId ?? "governor";
  }

  private checkRoute(caller: CallerId, from: AgentId | "governor", to: AgentId, rt: AgentRecord): void {
    // Generic main-agent messaging cannot target the protected reviewer;
    // the reviewer decides only through submit_gate_decision.
    if (this.gate.isReviewer(to) && caller !== "governor" && caller !== "user") {
      throw err("FORBIDDEN", "managed reviewer is not messageable");
    }
    // The reviewer decides only through submit_gate_decision; it raises
    // questions to its governor through worker question events, never by
    // direct messaging.
    if (from !== "governor" && this.gate.isReviewer(from)) {
      const home = this.agents.get(from)?.record.parentId ?? "governor";
      if (to !== home) throw err("FORBIDDEN", "managed reviewer cannot message this target");
    }
    if (caller === "governor" || caller === "user") return; // owner may reach descendants
    if (from === to) throw err("FORBIDDEN", "cannot message self as task target");
    const fromRt = this.agents.get(from as AgentId);
    if (!fromRt) throw err("NOT_FOUND", `sender ${from} unknown`);
    // Initially: child-to-parent and owner-to-descendant; siblings via owner.
    const toRt = this.agents.get(to);
    if (!toRt) throw err("NOT_FOUND", `target ${to} unknown`);
    const isParent = toRt.record.parentId === from;
    const isChild = fromRt.record.parentId === to;
    const isDescendant = this.isDescendant(from, to);
    if (!isParent && !isChild && !isDescendant) {
      throw err("FORBIDDEN", "sibling contact goes through the shared owner");
    }
  }

  private isDescendant(ancestor: AgentId, target: AgentId): boolean {
    let cur: AgentId | null = target;
    while (cur) {
      if (cur === ancestor) return true;
      cur = this.agents.get(cur)?.record.parentId ?? null;
    }
    return false;
  }

  private checkControl(caller: CallerId, record: AgentRecord): void {
    // The protected reviewer has no independent lifecycle that callers can
    // drive; only its governor (via gate controls/close of the main task)
    // affects it.
    if (this.gate.isReviewer(record.id) && caller !== "governor" && caller !== "user") {
      throw err("FORBIDDEN", "managed reviewer is controlled by the gate only");
    }
    if (this.gate.isReviewer(caller)) {
      throw err("FORBIDDEN", "managed reviewer cannot control agents");
    }
    if (caller === "governor" || caller === "user") return;
    if (caller !== record.parentId && !this.isDescendant(caller, record.id)) {
      throw err("FORBIDDEN", "only the owner/governor controls this agent");
    }
  }

  private visibleTo(caller: CallerId, record: AgentRecord): boolean {
    if (caller === "governor" || caller === "user") return true;
    if (caller === record.id) return true;
    const self = this.agents.get(caller);
    if (!self) return false;
    if (record.id === self.record.parentId) return true; // parent visible
    return this.isDescendant(caller, record.id); // owned subtree visible
  }

  private childrenOf(parentId: AgentId): AgentRuntime[] {
    return [...this.agents.values()].filter((rt) => rt.record.parentId === parentId);
  }

  private viewOf(rt: AgentRuntime): AgentView {
    const r = rt.record;
    return {
      id: r.id,
      path: r.path,
      parentId: r.parentId,
      depth: r.depth,
      profile: r.profile,
      model: r.model ? `${r.model.provider}/${r.model.id}` : "unresolved",
      observed: r.observed,
      pendingIntent: rt.activeRun?.interruptRequested === true ? "interrupt pending" : pendingIntentOf(rt),
      generation: r.executionGeneration,
      taskOutcome: r.taskOutcome,
      usage: { ...rt.usage },
      lastActivityAt: r.lastActivityAt,
      managedGateFor: this.gate.managedTaskFor(r.id),
    };
  }

  /** GateHost: usage snapshot for budget admission. */
  rootUsage(): { inputTokens: number; outputTokens: number; cost: number | null; unknown: boolean } {
    return { ...this.cumulativeUsage };
  }
  /** GateHost: fetch latest candidate text for a task run. */
  candidateText(agentId: AgentId, taskRunId: TaskRunId): string | null {
    const rt = this.agents.get(agentId);
    if (!rt || rt.lastResult?.taskRunId !== taskRunId) return null;
    return rt.lastResult.text;
  }
}

/**
 * Process ownership for recovery: never signal a guessed PID. The recorded
 * boot identity (boot id + process start time) must match the live process
 * before SIGKILL; otherwise the workspace is quarantined.
 */
export function readBootIdLocal(): string {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return "unknown";
  }
}

export function readProcessIdentity(pid: number): { bootId: string; starttime: string } | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return null;
    const rest = stat.slice(close + 2).split(" ");
    // starttime is field 22 overall, i.e. index 20 after comm.
    const starttime = rest[20] ?? "";
    if (!starttime) return null;
    return { bootId: readBootIdLocal(), starttime };
  } catch {
    return null;
  }
}

export type OwnershipVerdict = "dead" | "live-match" | "live-mismatch" | "unknown";

export function verifyOwnership(pid: number, recorded: { bootId: string; starttime: string } | null): OwnershipVerdict {
  try {
    process.kill(pid, 0);
  } catch {
    return "dead";
  }
  if (!recorded || recorded.bootId === "unknown") return "unknown";
  const live = readProcessIdentity(pid);
  if (!live) return "unknown";
  if (live.bootId !== recorded.bootId || live.starttime !== recorded.starttime) return "live-mismatch";
  return "live-match";
}

export async function killAndConfirm(pid: number, timeoutMs = 5000): Promise<boolean> {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return true; // already gone
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function pendingIntentOf(rt: AgentRuntime): string {
  const r = rt.record;
  if (r.desiredLifecycle === "closed") return "closed";  if (rt.quarantined) return "quarantined";
  if (r.taskPhase === "reviewing") return "reviewing";
  if (r.taskPhase === "review_queued") return "review queued";
  if (r.taskPhase === "repair_queued") return "repair queued";
  if (rt.queue.some((q) => !q.dispatched)) return "task queued";
  if (r.observed === "awaiting_parent") return "awaiting parent reply";
  if (r.observed === "awaiting_approval") return "awaiting approval";
  if (r.observed === "running") return r.detail || "running";
  return r.observed;
}

function summarize(kind: JournalKind, body: Record<string, unknown>): string {
  const agent = body["agentId"] ? ` ${String(body["agentId"]).slice(0, 8)}` : "";
  switch (kind) {
    case "agent.spawned":
      return `spawned${agent} ${String(body["path"] ?? "")}`;
    case "generation.started":
      return `gen ${String(body["generation"] ?? "")} started${agent}`;
    case "generation.settled":
      return `gen ${String(body["generation"] ?? "")} ${String(body["outcome"] ?? "")}${agent}`;
    case "task.terminal":
      return `task ${String(body["outcome"] ?? "")}${agent}`;
    case "mailbox.accepted":
      return `message ${String(body["mode"] ?? "")}${agent}`;
    case "tool.intent":
      return `tool ${String(body["tool"] ?? "")}${agent}`;
    case "agent.closed":
      return `closed${agent}`;
    default:
      return kind;
  }
}

function projectViews(records: Array<{ seq: number; kind: string; at: string; body: Record<string, unknown> }>): JournalEventView[] {
  return records.map((r) => ({
    seq: r.seq,
    kind: r.kind,
    agentId: (r.body["agentId"] as AgentId | undefined) ?? null,
    taskRunId: (r.body["taskRunId"] as TaskRunId | undefined) ?? null,
    summary: summarize(r.kind as JournalKind, r.body),
    at: r.at,
  }));
}

// Re-export for GateHost conformance checks.
export type { TaskOutcome };
