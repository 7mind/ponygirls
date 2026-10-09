/**
 * ponygirls-subagents — supervisor: tree, policy, scheduler, journal.
 *
 * One supervisor owns one root session UUID. All descendants share atomic
 * runnable leases, worker capacity, cumulative spawn limits, and budgets.
 * Model tools (governing and child), UI actions, and gate controls call the
 * same methods here; they never touch processes or files directly.
 *
 * Controller state transitions and their durable publication are serialized
 * so async handlers cannot independently finalize the same run. Each task
 * run has exactly one terminal outcome, keyed by its task-run id; joins and
 * replays read that map, never a window of the journal.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { ToolBroker, type BrokerCaller, type CallerSandbox, type ToolExecutors } from "./broker.ts";
import { err } from "./errors.ts";
import { GateController, fingerprintSummary, type CandidateRecord, type GateFinding, type GateHost, type GateSpecInput, type GateTerminalOutcome, type NormalizedGateCheck, type NormalizedGateSpec, type WorkspaceFingerprint } from "./gate.ts";
import { EMPTY_INSTRUCTIONS, instructionHash, parseSelection, selectInstructions } from "./instructions.ts";
import { ISOLATION_LEVELS } from "./types.ts";
import { authorizeWorkspace, intersectGrants, pathWithin, rootGrants, type RegisteredRepo, type SupervisorPolicy } from "./policy.ts";
import { killAndConfirm, readProcessIdentity, verifyOwnership, type OwnershipVerdict, type ProcessIdentity } from "./process-identity.ts";
import { AdmissionScheduler, PathRegistry, type LeaseTicket } from "./scheduler.ts";
import { BwrapToolExecutor, HostToolExecutor, sandboxRuntimePath } from "./sandbox.ts";
import { InMemoryRunStore, RootLock, checkpointSha256, fsyncDir, fsyncFile, type JournalKind, type JournalRecord, type RunStore } from "./store.ts";
import { CHILD_CONTROL_TOOLS, DELEGATION_TOOLS, FILE_TOOLS, GATE_DECISION_TOOL, SHELL_TOOL, WRITE_TOOLS } from "./tools.ts";
import type {
  AgentId,
  AgentRecord,
  GrantSet,
  InstructionSet,
  Isolation,
  JournalEventView,
  MailboxMessage,
  MessageId,
  MessageMode,
  PendingQuestion,
  QueuedTask,
  ResolvedModel,
  ResourceSelection,
  TaskOutcome,
  TaskPhase,
  TaskRunId,
  UsageTotals,
  WaitCondition,
  WaitMessage,
  WaitResult,
  WorkspaceAllocation,
} from "./types.ts";
import { WorkerHandle, newWorkerBinding, type ToolRequest } from "./worker-launch.ts";
import type { WorkerEvent } from "./protocol.ts";
import { GitWorkspaceManager, fingerprintWorktree, realDirectory, type CheckoutInfo, type WorkspaceManager, type WorktreeAllocation } from "./workspace.ts";

export type CallerId = AgentId | "governor" | "user";

export interface SpawnParams {
  taskName: string;
  message: string;
  profile: "reader" | "writer";
  /** Omitted: DEFAULT_ISOLATION. */
  isolation?: Isolation;
  repoId?: string | null;
  baseCommit?: string | null;
  /**
   * A directory the caller prepared and owns (the top level of a git work
   * tree, inside a policy workspaceRoots entry) for the child to work in,
   * instead of a worktree the extension makes. Governing session only.
   */
  workspacePath?: string | null;
  /** Owner skills / context files the child receives; omitted or null: none. */
  skills?: ResourceSelection | null;
  contextFiles?: ResourceSelection | null;
  /** Explicit override; must be in the root allowlist. */
  model?: { provider: string; id: string; thinkingLevel?: string } | null;
  shell?: boolean;
  gate?: GateSpec | null;
}

export interface GateSpec {
  model: { provider: string; id: string };
  thinkingLevel: string;
  prompt: string;
  /** Omitted: the named default; null: explicitly unlimited (policy permitting). */
  maxRounds?: number | null;
  checks?: Array<{ id: string; command: string; timeoutMs?: number }>;
  promisedOutputs?: string[];
}

export interface SpawnResult {
  agentId: AgentId;
  path: string;
  taskRunId: TaskRunId;
  generation: number;
  profile: string;
  isolation: Isolation;
  /** Where the child works: its own worktree (extension-made or caller-prepared), or the owner's directory under isolation none. */
  workdir: string;
  status: string;
}

export interface AgentView {
  id: AgentId;
  path: string;
  parentId: AgentId | null;
  depth: number;
  profile: string;
  isolation: Isolation;
  /** Where the agent works (its worktree keeps its changes; nothing is merged back). */
  workdir: string;
  model: string;
  observed: string;
  pendingIntent: string;
  currentTaskRunId: TaskRunId | null;
  generation: number;
  taskOutcome: string | null;
  usage: UsageTotals;
  lastActivityAt: string;
  /** For a gate reviewer: the gated task run it reviews. Null for every other agent. */
  managedGateFor: TaskRunId | null;
  /** The gated task run this agent works on (its gate is resumed or retried through it). */
  gateTaskRunId: TaskRunId | null;
  /** Open question this agent asked (bounded text), for its addressee to answer. */
  openQuestion: { messageId: MessageId; to: string; text: string; deadlineAt: string } | null;
}

/** A gate evaluation shown in a transcript. */
export interface ReviewTranscript {
  reviewId: string;
  taskRunId: TaskRunId;
  candidateId: string;
  model: string;
  sessionFile: string;
  /** When the evaluation started (orders it among the gated agent's conversation). */
  at: string;
  /** True while the reviewer is executing this evaluation. */
  active: boolean;
  /** Text the reviewer is generating for it right now. */
  streaming: string | null;
}

/** What the transcript view reads for one agent. */
export interface TranscriptSource {
  /** The agent's native session file; null before its first worker start, and for a gate reviewer. */
  sessionFile: string | null;
  /** Gate evaluations of this agent's candidates (or, for a reviewer, the ones it ran), oldest first. */
  reviews: ReviewTranscript[];
  /** Assistant text still being generated by the running generation. */
  streaming: string | null;
  /** Mailbox messages delivered to the agent, by id: sender ("governor" or its path) and whether it answers a question. */
  messages: Map<MessageId, { from: string; reply: boolean }>;
}

export interface ReadResult {
  status: AgentView;
  result: { taskRunId: string; outcome: string | null; text: string; detail: string } | null;
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
  setToolRequestHandler(h: (payload: ToolRequest) => Promise<{ content: string; isError: boolean }>): void;
  /** Abrupt process exit (crash, kill): the run it carried is lost. */
  setExitHandler(h: (info: { code: number | null; signal: string | null }) => void): void;
}

export type WorkerFactory = (opts: {
  agentId: AgentId;
  instanceId: string;
  rootEpoch: string;
}) => WorkerPort;

interface ActiveRun {
  taskRunId: TaskRunId;
  generation: number;
  interruptRequested: boolean;
}

interface AgentRuntime {
  record: AgentRecord;
  worker: WorkerPort | null;
  runnableLease: LeaseTicket | null;
  residentLease: LeaseTicket | null;
  queue: QueuedTask[];
  activeRun: ActiveRun | null;
  /** Latest terminal result (deliverable text kept apart from outcome detail). */
  lastResult: { taskRunId: TaskRunId; outcome: string; text: string; detail: string } | null;
  /** Deliverable text of the latest settled generation (the gate's candidate answer). */
  lastText: { taskRunId: TaskRunId; text: string } | null;
  usage: UsageTotals;
  lastPreview: string;
  /** Assistant text still being generated (cleared when the message completes). */
  streaming: string | null;
  quarantined: string | null;
  gateTaskRunId: TaskRunId | null;
  pendingRepair: string | null;
  /** Reviewer evaluation parked for lack of capacity. */
  pendingReview: ReviewInput | null;
  /** Spawn startup parked for lack of a runnable lease (task text to launch). */
  parkedStartup: string | null;
  /** Validated restore for the next worker launch (bytes already placed). */
  pendingRestore: { sessionFile: string; leafEntryId: string | null } | null;
  /** Recorded worker pid + boot identity for recovery ownership checks. */
  workerPid: number | null;
  workerBoot: ProcessIdentity | null;
  /** In-flight settled-boundary checkpoint; dispatch waits for it. */
  checkpointing: Promise<void> | null;
  /** Child wait in progress: cancels its queued lease reacquisition. */
  leaseWaitCancel: (() => void) | null;
  /** Post-generation continuation deferred until active descendants stop. */
  afterDescendants: (() => void) | null;
  /** Provider usage of the active generation as of its latest tool call. */
  usageSnapshot: UsageDetail | null;
  /** An interrupt arrived while the owner was joining its descendants. */
  joinInterrupted: boolean;
  /** A reload for queued work is in flight. */
  loading: boolean;
  /** Recovery kept accepted tasks for explicit resume (no automatic dispatch). */
  held: boolean;
}

interface ReviewInput {
  taskRunId: TaskRunId;
  reviewId: string;
  candidateId: string;
  prompt: string;
}

/** One gate evaluation's conversation file. */
interface ReviewSession {
  reviewerId: AgentId;
  /** The gated agent whose candidate was reviewed. */
  agentId: AgentId;
  taskRunId: TaskRunId;
  reviewId: string;
  candidateId: string;
  model: string;
  sessionFile: string;
  at: string;
}

interface WaiterReg {
  caller: CallerId;
  cursor: number;
  targets: Array<{ agentId: AgentId; taskRunId: TaskRunId | null }> | null;
  condition: WaitCondition;
  joinTaskRunIds: TaskRunId[];
  joinToken: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (r: WaitResult) => void;
}

export interface SupervisorOptions {
  rootId: string;
  rootDir: string;
  store?: RunStore;
  policy: SupervisorPolicy;
  /** The governing session at the current call: what top-level children start from. */
  governor: () => GovernorContext;
  schedulerLimits?: { maxRunnable?: number; maxResidentWorkers?: number; maxAgentsCreated?: number; maxDepth?: number };
  executors?: ToolExecutors;
  workspace?: WorkspaceManager;
  workerPath?: string;
  sdkRoot?: string | null;
  deterministic?: boolean;
  /** Host agent dir whose credential store workers open live (no copies). */
  hostAgentDir?: string;
  workerFactory?: WorkerFactory;
  now?: () => string;
  questionTtlMs?: number;
  /** Called (synchronously) after every published event; for coalesced UI refresh. */
  onChange?: () => void;
}

export interface GovernorContext {
  /** Current model: what top-level children inherit. */
  model: ResolvedModel | null;
  /** Working directory top-level children with isolation none/worktree start from. */
  cwd: string;
  /** Skills and context files pi loaded for the current run; null when unavailable. */
  instructions: InstructionSet | null;
}

export const DEFAULT_ISOLATION: Isolation = "worktree";

/** A caller-prepared workspace as verified at spawn: its resolved path and the git identity found there. */
interface PreparedWorkspace {
  path: string;
  checkout: CheckoutInfo;
}

const WAIT_DEFAULT_MS = 30_000;
const WAIT_MAX_MS = 300_000;
const WAIT_EVENT_LIMIT = 50;
const WAIT_MESSAGE_LIMIT = 20;
const MESSAGE_TEXT_MAX = 65_536;
const PREVIEW_MAX = 2000;
const RESULT_TEXT_MAX = 8000;
const QUESTION_TTL_MS = 15 * 60_000;
const INTERRUPT_TIMEOUT_MS = 15_000;
const CLOSE_JOIN_TIMEOUT_MS = 15_000;
const CHECKPOINT_TIMEOUT_MS = 15_000;
const FIND_ENTRY_TIMEOUT_MS = 10_000;
const IDLE_POLL_MS = 25;
/** Events a settlement wait reports (tool-level progress stays in activity waits and read_agent). */
const MATERIAL_EVENTS: ReadonlySet<string> = new Set(["task.terminal", "generation.settled", "mailbox.accepted", "mailbox.answered", "mailbox.question_expired", "agent.closed", "agent.interrupted", "gate.decision", "task.phase"]);

function newRuntime(record: AgentRecord): AgentRuntime {
  return {
    record,
    worker: null,
    runnableLease: null,
    residentLease: null,
    queue: [],
    activeRun: null,
    lastResult: null,
    lastText: null,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null, cost: null, unknown: false },
    lastPreview: "",
    streaming: null,
    quarantined: null,
    gateTaskRunId: null,
    pendingRepair: null,
    pendingReview: null,
    parkedStartup: null,
    pendingRestore: null,
    workerPid: null,
    workerBoot: null,
    checkpointing: null,
    leaseWaitCancel: null,
    afterDescendants: null,
    usageSnapshot: null,
    joinInterrupted: false,
    loading: false,
    held: false,
  };
}

/** Canonical digest of a command payload: request ids cannot be reused for different work. */
function payloadDigest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

function isGovernor(caller: CallerId): caller is "governor" | "user" {
  return caller === "governor" || caller === "user";
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
  /** Exactly one terminal outcome per task run. */
  private terminalRuns = new Map<TaskRunId, { agentId: AgentId; outcome: string }>();
  private waiters: WaiterReg[] = [];
  /** Unfinished runs restored from the journal (no live worker). */
  private pendingLost = new Map<AgentId, { taskRunId: TaskRunId; generation: number; workerPid: number | null; workerBoot: ProcessIdentity | null }>();
  /** Every gate evaluation's conversation file, in start order. */
  private reviewSessions: ReviewSession[] = [];
  /** Runs whose generation settled but whose outcome was deferred (owner joining descendants) at a crash. */
  private pendingSettle = new Map<AgentId, { taskRunId: TaskRunId; outcome: string; error: string }>();
  private epoch: string;
  private suspended = false;
  private gate: GateController;
  private chain: Promise<void> = Promise.resolve();
  private cumulativeUsage: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null, cost: 0, unknown: false };
  private opts: SupervisorOptions;
  private questionTtlMs: number;
  private now: () => string;

  constructor(options: SupervisorOptions) {
    this.rootId = options.rootId;
    this.rootDir = options.rootDir;
    mkdirSync(this.rootDir, { recursive: true });
    this.store = options.store ?? new InMemoryRunStore(options.rootId);
    this.lock = new RootLock(this.rootDir);
    const lockRes = this.lock.acquire();
    if (!lockRes.ok) throw lockRes.error;
    this.policy = options.policy;
    this.scheduler = new AdmissionScheduler(options.schedulerLimits);
    const executors = options.executors ?? { sandbox: new BwrapToolExecutor(), host: new HostToolExecutor() };
    // Sandboxed jobs see the host runtime PATH (read-only, minus home and
    // setuid wrapper directories) so generated commands find their tools;
    // host jobs get the governing process's whole environment.
    const runtimePath = sandboxRuntimePath(process.env["PATH"] ?? "", homedir());
    const hostEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) hostEnv[k] = v;
    this.broker = new ToolBroker(executors, this.store, runtimePath, { PATH: [...runtimePath, "/usr/bin", "/bin"].join(":") }, hostEnv);
    this.workspace = options.workspace ?? new GitWorkspaceManager();
    this.epoch = randomUUID();
    this.gate = new GateController(this);
    this.opts = options;
    this.questionTtlMs = options.questionTtlMs ?? QUESTION_TTL_MS;
    this.now = options.now ?? (() => new Date().toISOString());
    this.replayJournal();
    this.store.append("root.init", { rootId: this.rootId, epoch: this.epoch, at: this.now() });
  }

  /**
   * Rebuild durable state from the journal: identities, tree, authority,
   * mailboxes, queues, outcomes, usage, gate rounds/candidates/decisions,
   * and unfinished runs. The store validated the committed journal on open.
   * No inference is started; unfinished runs wait for recover().
   */
  private replayJournal(): void {
    const { records } = this.store.readSince(0, Number.MAX_SAFE_INTEGER);
    let spawned = 0;
    const started = new Map<TaskRunId, { agentId: AgentId; generation: number; workerPid: number | null; workerBoot: ProcessIdentity | null }>();
    const settledGen = new Set<string>();
    const decidedReviews = new Set<string>();
    const reviewerLinks: Array<{ reviewerId: AgentId; taskRunId: TaskRunId }> = [];
    const settledRuns = new Map<TaskRunId, { agentId: AgentId; outcome: string; error: string }>();
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
      linkedFrom: TaskRunId | null;
      reviewerId: AgentId | null;
      evidence: Array<{ round: number; id: string; exitCode: number | null; output: string }>;
    }
    const gates = new Map<TaskRunId, GateDraft>();

    for (const r of records) {
      const b = r.body as Record<string, unknown>;
      switch (r.kind) {
        case "agent.spawned": {
          const agentId = b["agentId"] as string;
          const path = b["path"] as string;
          if (!agentId || this.agents.has(agentId) || !path) break;
          this.paths.reserve(path);
          const record: AgentRecord = {
            id: agentId,
            path,
            rootId: this.rootId,
            parentId: (b["parentId"] as string | null) ?? null,
            depth: (b["depth"] as number | undefined) ?? path.split("/").length - 2,
            profile: (b["profile"] as "reader" | "writer") ?? "reader",
            createdEntryId: (b["requestId"] as string) ?? "",
            nativeSessionPath: null,
            grants: b["grants"] as GrantSet,
            // Journals written before prepared workspaces carry no flag: extension-made.
            allocation: { ...(b["allocation"] as WorkspaceAllocation), external: (b["allocation"] as { external?: unknown } | undefined)?.external === true },
            instructions: b["instructions"] as InstructionSet,
            instructionHash: instructionHash(b["instructions"] as InstructionSet),
            policyRevision: this.policy.revision,
            model: (b["model"] as ResolvedModel | null) ?? null,
            currentTaskRunId: (b["taskRunId"] as string) ?? null,
            executionGeneration: b["managedGate"] === true ? 0 : 1,
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
          this.agents.set(agentId, newRuntime(record));
          const parent = record.parentId ? this.agents.get(record.parentId) : undefined;
          if (parent) parent.record.activeDescendants++;
          if (b["managedGate"] === true) {
            // Reviewer executions are not journaled as generations: a restored
            // reviewer is idle, exactly as createManagedReviewer makes it.
            record.taskPhase = "terminal";
            record.observed = "settled";
            record.detail = "managed gate reviewer (idle)";
            reviewerLinks.push({ reviewerId: agentId, taskRunId: (b["taskRunId"] as string) ?? "" });
          }
          if (b["gated"] === true) this.agents.get(agentId)!.gateTaskRunId = record.currentTaskRunId;
          spawned++;
          break;
        }
        case "gate.review_session":
          this.reviewSessions.push({
            reviewerId: b["reviewerId"] as AgentId,
            agentId: b["agentId"] as AgentId,
            taskRunId: b["taskRunId"] as TaskRunId,
            reviewId: b["reviewId"] as string,
            candidateId: b["candidateId"] as string,
            model: b["model"] as string,
            sessionFile: b["sessionFile"] as string,
            at: b["at"] as string,
          });
          break;
        case "generation.started": {
          const rt = this.agents.get(b["agentId"] as string);
          const taskRunId = b["taskRunId"] as string;
          if (!rt || !taskRunId) break;
          rt.record.currentTaskRunId = taskRunId;
          rt.record.executionGeneration = (b["generation"] as number) ?? rt.record.executionGeneration;
          rt.record.observed = "running";
          rt.record.lastEventSeq = r.seq;
          if (b["repair"] !== true) {
            rt.record.taskPhase = "working";
            rt.record.taskOutcome = null;
            rt.record.outcome = null;
          }
          for (const q of rt.queue) {
            if (q.id === taskRunId) q.dispatched = true;
          }
          started.set(taskRunId, {
            agentId: rt.record.id,
            generation: rt.record.executionGeneration,
            workerPid: (b["workerPid"] as number | null) ?? null,
            workerBoot: (b["workerBoot"] as ProcessIdentity | null) ?? null,
          });
          break;
        }
        case "generation.settled": {
          const rt = this.agents.get(b["agentId"] as string);
          if (rt) {
            rt.record.observed = "settled";
            rt.record.outcome = (b["outcome"] as AgentRecord["outcome"]) ?? "failed";
            rt.record.lastEventSeq = r.seq;
            if (typeof b["text"] === "string") rt.lastText = { taskRunId: b["taskRunId"] as string, text: b["text"] as string };
          }
          settledGen.add(`${b["agentId"] as string}:${b["generation"] as number}`);
          settledRuns.set(b["taskRunId"] as string, { agentId: b["agentId"] as string, outcome: (b["outcome"] as string) ?? "failed", error: (b["error"] as string) ?? "" });
          break;
        }
        case "task.terminal": {
          const agentId = b["agentId"] as string;
          const taskRunId = b["taskRunId"] as string;
          const outcome = (b["outcome"] as string) ?? "failed";
          if (taskRunId) this.terminalRuns.set(taskRunId, { agentId, outcome });
          const rt = this.agents.get(agentId);
          if (rt && taskRunId) {
            rt.queue = rt.queue.filter((q) => q.id !== taskRunId);
            if (taskRunId === rt.record.currentTaskRunId) {
              rt.record.taskPhase = "terminal";
              rt.record.taskOutcome = outcome;
              rt.record.observed = "settled";
            }
            const text = rt.lastText?.taskRunId === taskRunId ? rt.lastText.text : ((b["preview"] as string) ?? "");
            rt.lastResult = { taskRunId, outcome, text, detail: (b["detail"] as string) ?? "" };
          }
          break;
        }
        case "task.queued": {
          const rt = this.agents.get(b["agentId"] as string);
          const id = b["id"] as string;
          if (!rt || !id || rt.queue.some((q) => q.id === id)) break;
          rt.queue.push({
            id,
            agentId: rt.record.id,
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
          if (rt && b["linked"] === true) {
            // A linked retry/bypass run became the agent's current gated run.
            if (rt.lastText) rt.lastText = { taskRunId: b["taskRunId"] as string, text: rt.lastText.text };
            rt.gateTaskRunId = b["taskRunId"] as string;
            rt.record.currentTaskRunId = b["taskRunId"] as string;
            rt.record.taskOutcome = null;
          }
          if (rt && typeof b["phase"] === "string" && b["taskRunId"] === rt.record.currentTaskRunId) rt.record.taskPhase = b["phase"] as TaskPhase;
          break;
        }
        case "mailbox.accepted": {
          const messageId = b["messageId"] as string;
          if (!messageId || this.messages.has(messageId)) break;
          const to = b["to"] as AgentId | "governor";
          const message: MailboxMessage = {
            id: messageId,
            rootId: this.rootId,
            from: (b["from"] as MailboxMessage["from"]) ?? "governor",
            to,
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
          const rt = to !== "governor" ? this.agents.get(to) : undefined;
          if (rt) rt.record.pendingMessageIds.push(messageId);
          if (message.requestReply && typeof b["deadlineAt"] === "string") {
            this.questions.set(messageId, { messageId, from: message.from as AgentId, to, text: message.text, createdAt: r.at, deadlineAt: b["deadlineAt"] as string, answered: false, cancelled: false });
          }
          break;
        }
        case "mailbox.answered": {
          const q = this.questions.get(b["replyTo"] as string);
          if (q) q.answered = true;
          break;
        }
        case "mailbox.question_expired": {
          const q = this.questions.get(b["messageId"] as string);
          if (q) q.cancelled = true;
          break;
        }
        case "mailbox.receipt": {
          const message = this.messages.get(b["messageId"] as string);
          if (message) {
            message.receipt = { messageId: message.id, nativeEntryId: (b["leafEntryId"] as string) ?? "", leafId: (b["leafEntryId"] as string) ?? "", checkpointSeq: r.seq, byteOffset: -1 };
          }
          break;
        }
        case "usage.reported": {
          const rt = this.agents.get(b["agentId"] as string);
          // Records written before the cache and reasoning counters lack them: zero and null.
          this.accountUsage(rt ?? null, b as UsageDetail);
          break;
        }
        case "agent.closed": {
          const rt = this.agents.get(b["agentId"] as string);
          if (rt) {
            rt.record.desiredLifecycle = "closed";
            rt.record.observed = "settled";
            this.paths.retire(rt.record.path);
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
            linkedFrom: (b["linkedFrom"] as string | null) ?? null,
            reviewerId: (b["reviewerId"] as string | null) ?? null,
            evidence: [],
          });
          break;
        }
        case "gate.limits": {
          const draft = gates.get(b["taskRunId"] as string);
          if (draft) draft.spec = { ...draft.spec, maxRounds: (b["maxRounds"] as number | null) ?? null };
          break;
        }
        case "gate.round_admitted": {
          const draft = gates.get(b["taskRunId"] as string);
          if (draft) draft.rounds = Math.max(draft.rounds, (b["round"] as number) ?? draft.rounds);
          break;
        }
        case "gate.candidate": {
          const draft = gates.get(b["taskRunId"] as string);
          const candidate = b["candidate"] as CandidateRecord | undefined;
          if (draft && candidate) {
            draft.candidates.push(candidate);
            draft.lastResponse = (b["resultText"] as string) ?? draft.lastResponse;
            const rt = this.agents.get(draft.agentId);
            if (rt) rt.lastText = { taskRunId: b["taskRunId"] as string, text: draft.lastResponse };
          }
          break;
        }
        case "gate.decision": {
          const draft = gates.get(b["taskRunId"] as string);
          if (draft) {
            draft.findings = [...((b["blockers"] as GateFinding[]) ?? []), ...((b["advisories"] as GateFinding[]) ?? [])];
            decidedReviews.add(`${b["taskRunId"] as string}:${b["reviewId"] as string}`);
          }
          break;
        }
        case "gate.evidence": {
          const draft = gates.get(b["taskRunId"] as string);
          if (draft) {
            for (const row of (b["evidence"] as Array<{ id: string; exitCode: number | null; output: string }>) ?? []) {
              draft.evidence.push({ round: (b["round"] as number) ?? draft.rounds, id: row.id, exitCode: row.exitCode, output: row.output });
            }
          }
          break;
        }
        case "gate.repair_command": {
          const draft = gates.get(b["taskRunId"] as string);
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
    // Restore gate tasks (counters, candidates, findings preserved; nothing
    // re-admitted). Undecided latest rounds become interrupted reviews,
    // resumable with fresh context.
    for (const [taskRunId, draft] of gates) {
      const history = draft.candidates.map((c) => fingerprintSummary(c.fingerprint));
      const stagnation = history.length > 1 && history[history.length - 1] === history[history.length - 2]
        ? `round ${history.length}: candidate unchanged since previous round; no implicit stop applied`
        : null;
      const terminal = this.terminalRuns.get(taskRunId)?.outcome ?? null;
      this.gate.importTask({
        agentId: draft.agentId,
        taskRunId,
        taskText: draft.taskText,
        spec: draft.spec,
        roundsAdmitted: draft.rounds,
        candidate: draft.candidates.length > 0 ? draft.candidates[draft.candidates.length - 1]! : null,
        previousFindings: draft.findings,
        lastResponse: draft.lastResponse,
        repairCommandId: draft.repairCommandId,
        terminal: terminal as GateTerminalOutcome | null,
        linkedFrom: draft.linkedFrom,
        reviewerId: draft.reviewerId,
        evidence: draft.evidence,
        fingerprintHistory: history,
        stagnationWarning: stagnation,
      });
      const state = this.gate.inspect(taskRunId);
      if (state && !state.terminal && draft.rounds > 0 && draft.candidates.length > 0) {
        const reviewId = `review-${draft.rounds}`;
        if (!decidedReviews.has(`${taskRunId}:${reviewId}`)) {
          state.review = { reviewId, status: "interrupted", candidateId: draft.candidates[draft.candidates.length - 1]!.candidateId, decisionUsed: false };
        }
      }
      // A reserved repair never dispatched before the crash stays reserved
      // with its criticism; recovery dispatches it.
      if (state && !state.terminal && draft.repairCommandId && draft.repairCriticism) {
        const repaired = records.some((x) => x.kind === "generation.started" && x.body["taskRunId"] === taskRunId && x.body["repair"] === true && x.body["commandId"] === draft.repairCommandId);
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
    // Journals that predate reviewer ids in gate.registered link reviewers
    // through their spawn record.
    for (const link of reviewerLinks) this.gate.linkReviewer(link.reviewerId, link.taskRunId);
    // Unfinished runs (started, never settled/terminal, agent open) become
    // pending-lost for recover(): old joins settle, replacements wait.
    for (const [taskRunId, info] of started) {
      if (this.terminalRuns.has(taskRunId)) continue;
      const rt = this.agents.get(info.agentId);
      if (!rt || rt.record.desiredLifecycle === "closed") continue;
      if (settledGen.has(`${info.agentId}:${info.generation}`)) continue;
      rt.record.observed = "lost";
      this.pendingLost.set(info.agentId, { taskRunId, generation: info.generation, workerPid: info.workerPid, workerBoot: info.workerBoot });
    }
    // A settled generation without a terminal outcome (and no gate owning
    // it) was an owner joining descendants: recovery settles it.
    for (const rt of this.agents.values()) {
      const cur = rt.record.currentTaskRunId;
      if (!cur || this.terminalRuns.has(cur) || this.pendingLost.has(rt.record.id) || rt.gateTaskRunId === cur || rt.record.desiredLifecycle === "closed") continue;
      const settled = settledRuns.get(cur);
      if (settled && settled.agentId === rt.record.id) this.pendingSettle.set(rt.record.id, { taskRunId: cur, outcome: settled.outcome, error: settled.error });
    }
    this.scheduler.restoreSnapshot({ created: spawned });
  }

  // -- lifecycle -----------------------------------------------------------

  /**
   * Root session shutdown: cancel owned tool jobs and stop workers. Durable
   * state is preserved; runs left active are reconciled by recover() on the
   * next attach, like any other lost run.
   */
  async shutdown(): Promise<void> {
    this.suspended = true;
    return this.serialized(async () => {
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve(this.waitResult(waiter, false, "cancelled", []));
      }
      for (const rt of this.agents.values()) {
        rt.leaseWaitCancel?.();
        rt.leaseWaitCancel = null;
        await this.broker.cancelJobs(rt.record.id);
        const worker = rt.worker;
        rt.worker = null;
        worker?.kill();
        rt.record.residency = "unloaded";
        // Suspended: release without pumping parked work.
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

  /** True when the journal holds runs that recover() must reconcile first. */
  get needsRecovery(): boolean {
    return this.pendingLost.size > 0 || this.pendingSettle.size > 0;
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

  /** Run a controller transition from a callback; failures are journaled, never unhandled. */
  private detached(fn: () => Promise<void> | void): void {
    void this.serialized(fn).catch((e: unknown) => this.reportFailure(e));
  }

  private reportFailure(e: unknown): void {
    try {
      this.store.append("recovery.event", { phase: "controller_error", error: String((e as Error)?.message ?? e).slice(0, 500) });
    } catch {
      // The store itself failed; its own error already refuses further writes.
    }
  }

  private publish(kind: JournalKind, body: Record<string, unknown>): JournalRecord {
    const record = this.store.append(kind, body);
    this.evaluateWaiters();
    this.opts.onChange?.();
    return record;
  }

  // -- leases and capacity ---------------------------------------------------

  /** Release a lease; freed capacity starts parked work. */
  private releaseTicket(ticket: LeaseTicket | null): void {
    if (!ticket) return;
    this.scheduler.release(ticket);
    if (!this.suspended) this.pumpRunnable();
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

  /** Resident capacity, evicting one idle worker when the house is full. */
  private acquireResident(agentId: AgentId): LeaseTicket | null {
    return this.scheduler.tryAcquireResident(agentId) ?? (this.evictOneIdle(agentId) ? this.scheduler.tryAcquireResident(agentId) : null);
  }

  /**
   * Freed runnable capacity starts parked work in a fixed order: parked
   * startups, queued tasks on loaded idle agents, parked reviews, repairs.
   * Lease waiters inside wait_agent are served first by the scheduler.
   */
  private pumpRunnable(): void {
    for (const rt of this.agents.values()) {
      if (this.suspended) return;
      if (rt.record.desiredLifecycle === "closed" || rt.quarantined) continue;
      if (rt.parkedStartup !== null && !rt.activeRun && !rt.worker && !rt.runnableLease) {
        const runnable = this.scheduler.tryAcquireRunnable(rt.record.id);
        if (!runnable) return;
        rt.runnableLease = runnable;
        // The parked marker stays until the launch step runs, so an
        // interrupt or close queued in between still finds (and ends) it.
        this.detached(async () => {
          const text = rt.parkedStartup;
          if (text === null || rt.record.desiredLifecycle === "closed") {
            this.releaseRunnable(rt);
            return;
          }
          rt.parkedStartup = null;
          try {
            await this.continueStartup(rt, text);
          } catch (e) {
            this.startupFailed(rt, rt.record.currentTaskRunId, e as Error);
          }
        });
      } else if (!rt.activeRun && !rt.held && rt.queue.some((q) => !q.dispatched) && !this.isPhaseLocked(rt)) {
        if (!this.scheduler.hasRunnableCapacity()) return;
        this.pumpQueue(rt);
      } else if (rt.pendingReview && !rt.activeRun) {
        if (!this.scheduler.hasRunnableCapacity()) return;
        const review = rt.pendingReview;
        rt.pendingReview = null;
        this.launchReview(rt, review);
      } else if (rt.pendingRepair && !rt.activeRun && rt.record.taskPhase === "repair_queued") {
        if (!this.scheduler.hasRunnableCapacity()) return;
        const criticism = rt.pendingRepair;
        rt.pendingRepair = null;
        this.startRepairExecution(rt.record.id, rt.record.currentTaskRunId!, criticism);
      }
    }
  }

  /** Review/repair phases, and an owner still joining its descendants, keep new tasks queued. */
  private isPhaseLocked(rt: AgentRuntime): boolean {
    const p = rt.record.taskPhase;
    return rt.afterDescendants !== null || p === "candidate_recording" || p === "review_queued" || p === "reviewing" || p === "repair_queued";
  }

  // -- spawn -----------------------------------------------------------------

  async spawn(caller: CallerId, params: SpawnParams, requestId: string): Promise<SpawnResult> {
    return this.serialized(async () => {
      const digest = payloadDigest({ caller, params });
      const prior = this.store.loadCommand(requestId);
      if (prior) {
        const b = prior.body as { agentId?: string; path?: string; taskRunId?: string; profile?: string; digest?: string };
        if (prior.kind === "agent.spawned" && b.digest === digest && typeof b.agentId === "string" && this.agents.has(b.agentId)) {
          const prev = this.agents.get(b.agentId)!.record;
          return { agentId: b.agentId, path: b.path ?? "", taskRunId: b.taskRunId ?? "", generation: 1, profile: b.profile ?? "", isolation: prev.grants.isolation, workdir: prev.allocation.workdir, status: prev.observed };
        }
        throw err("DUPLICATE_REQUEST", `conflicting reuse of requestId ${requestId}`);
      }
      // Validate everything before charging capacity or creating anything.
      if (!params.taskName || !params.message) throw err("INVALID", "spawn requires taskName and message");
      if (params.profile !== "reader" && params.profile !== "writer") throw err("INVALID", "profile must be reader/writer");
      const parentRt = isGovernor(caller) ? null : this.agents.get(caller);
      if (!isGovernor(caller) && !parentRt) throw err("NOT_FOUND", `caller ${caller} unknown`);
      if (!isGovernor(caller) && this.gate.isReviewer(caller)) throw err("FORBIDDEN", "managed reviewer cannot delegate");
      if (parentRt && parentRt.record.desiredLifecycle === "closed") throw err("CLOSED", "caller is closed");
      if (parentRt && params.gate) throw err("FORBIDDEN", "only the governing session configures validation gates");
      const depth = parentRt ? parentRt.record.depth + 1 : 1;
      const ownerGrants = parentRt ? parentRt.record.grants : rootGrants(this.policy);
      // Omitted: the default, or the owner's isolation where that is stricter.
      const isolation = params.isolation ?? (ISOLATION_LEVELS.indexOf(ownerGrants.isolation) > ISOLATION_LEVELS.indexOf(DEFAULT_ISOLATION) ? ownerGrants.isolation : DEFAULT_ISOLATION);
      if (!ISOLATION_LEVELS.includes(isolation)) throw err("INVALID", "isolation must be none/worktree/sandbox");
      if (params.baseCommit && (isolation === "none" || params.profile === "reader")) throw err("INVALID", "base_commit applies to worktree and sandbox writers");
      const workspacePath = params.workspacePath ?? null;
      if (workspacePath !== null) {
        if (parentRt) throw err("FORBIDDEN", "only the governing session assigns a prepared workspace");
        if (isolation !== "worktree") throw err("INVALID", "workspace_path needs isolation worktree: the prepared directory is the child's worktree, not the owner's directory or a sandbox view");
        if (params.baseCommit) throw err("INVALID", "base_commit applies to worktrees the extension creates, not to workspace_path");
      }
      const governor = parentRt ? null : this.opts.governor();
      const granted = intersectGrants(this.policy, ownerGrants, {
        profile: params.profile,
        isolation,
        repoId: params.repoId ?? null,
        shell: params.shell ?? params.profile === "writer",
        network: false,
        model: params.model ? { provider: params.model.provider, id: params.model.id } : null,
        depth,
      });
      if (!granted.ok) throw granted.error;
      // The controller excludes its own writers during review.
      if (parentRt && this.isPhaseLocked(parentRt) && params.profile === "writer") {
        throw err("CONFLICT", "owner workspace is locked for review; writers excluded until review ends");
      }
      const model = this.resolveChildModel(parentRt, params.model ?? null);
      const gateSpec = params.gate ? this.gate.validateSpec({ ...params.gate }) : null;
      if (gateSpec) assertGateFits(gateSpec, params.profile === "writer");
      const path = PathRegistry.childPath(parentRt ? parentRt.record.path : "/root", params.taskName);
      if (this.paths.isTaken(path)) throw err("CONFLICT", `task path ${path} already used`);
      const reg = params.repoId ? this.policy.repos.find((r) => r.repoId === params.repoId) : undefined;
      if (params.repoId && !reg) throw err("POLICY_DENIED", `repository ${params.repoId} not registered`);
      const instructions = selectInstructions(parentRt ? parentRt.record.instructions : governor!.instructions, params.skills ?? null, params.contextFiles ?? null);
      // Host-isolated children start from their owner's working directory.
      const ownerWorkdir = parentRt ? parentRt.record.allocation.workdir : governor!.cwd;
      const prepared = workspacePath !== null ? this.prepareWorkspace(workspacePath, ownerWorkdir) : null;
      const checkout = prepared === null && isolation !== "sandbox" && params.profile === "writer" ? this.workspace.describeCheckout(ownerWorkdir) : null;
      if (prepared === null && isolation === "worktree" && params.profile === "writer" && !checkout) {
        throw err("WORKSPACE_UNAVAILABLE", `worktree isolation needs a git checkout with a commit at ${ownerWorkdir}`);
      }
      if (gateSpec && params.profile === "writer" && isolation === "none" && !checkout) {
        throw err("INVALID", `a gated writer needs a git checkout to fingerprint; ${ownerWorkdir} is not one`);
      }

      // Capacity: one identity (two with a managed reviewer) and a resident
      // worker, acquired before any workspace exists.
      const charged = this.scheduler.chargeAgentCreation(gateSpec ? 2 : 1);
      if (!charged.ok) throw err(charged.code, charged.message);
      const agentId = randomUUID();
      const resident = this.acquireResident(agentId);
      if (!resident) {
        this.scheduler.refundAgentCreation(gateSpec ? 2 : 1);
        throw err("CAPACITY_EXCEEDED", "no resident worker capacity; close or wait for settled agents");
      }
      const rollbackCapacity = (): void => {
        this.scheduler.release(resident);
        this.scheduler.refundAgentCreation(gateSpec ? 2 : 1);
      };

      // Bind the concrete workspace after grant intersection. A nested
      // writer gets its own worktree; parent mounts are never an allowlist.
      let allocation: WorkspaceAllocation;
      try {
        allocation = this.bindWorkspace(agentId, params.profile, isolation, { ownerWorkdir, checkout, prepared, reg: reg ?? null, baseCommit: params.baseCommit ?? null, instructions });
      } catch (e) {
        rollbackCapacity();
        throw e;
      }

      this.paths.reserve(path);
      const taskRunId = randomUUID();
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
        instructions,
        instructionHash: instructionHash(instructions),
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
      const rt = newRuntime(record);
      rt.residentLease = resident;
      this.agents.set(agentId, rt);
      if (parentRt) parentRt.record.activeDescendants++;
      const spawnedRecord = this.store.append("agent.spawned", {
        agentId,
        path,
        parentId: record.parentId,
        depth,
        profile: params.profile,
        taskRunId,
        requestId,
        digest,
        grants: granted.grants,
        allocation,
        instructions,
        model,
        gated: gateSpec !== null,
      });
      this.store.recordCommand(requestId, spawnedRecord);
      record.lastEventSeq = spawnedRecord.seq;
      if (gateSpec) {
        // Both logical identities exist before the main agent is dispatched.
        rt.gateTaskRunId = taskRunId;
        this.gate.register(agentId, taskRunId, gateSpec, params.message, this.createManagedReviewer(agentId, taskRunId, gateSpec));
      }
      try {
        await this.startWorker(rt, params.message);
      } catch (e) {
        this.startupFailed(rt, taskRunId, e as Error);
        throw e;
      }
      return { agentId, path, taskRunId, generation: 1, profile: params.profile, isolation, workdir: allocation.workdir, status: record.observed };
    });
  }

  /** Explicit override, else the owner's resolved model (never an informal alias). */
  private resolveChildModel(parentRt: AgentRuntime | null | undefined, override: SpawnParams["model"]): ResolvedModel {
    if (override) return { provider: override.provider, id: override.id, thinkingLevel: override.thinkingLevel ?? parentRt?.record.model?.thinkingLevel ?? this.opts.governor().model?.thinkingLevel ?? "medium" };
    const inherited = parentRt ? parentRt.record.model : this.opts.governor().model;
    if (!inherited) throw err("MODEL_UNAVAILABLE", "no resolved model to inherit; pass an explicit model");
    return { ...inherited };
  }

  private agentTmp(agentId: AgentId): string {
    const dir = join(this.rootDir, "tmp", agentId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Verify a caller-prepared workspace before anything is charged or
   * created. Denied unless the policy lists a root containing its resolved
   * path; it must be the top level of a git work tree with a commit, apart
   * from the supervisor's own storage and (unless the policy allows it) the
   * governing checkout. Nothing here writes to it.
   */
  private prepareWorkspace(path: string, ownerWorkdir: string): PreparedWorkspace {
    // Deny by default, before the filesystem is consulted.
    if (this.policy.workspaceRoots.length === 0) throw err("POLICY_DENIED", "workspace_path is not permitted: the policy lists no workspaceRoots");
    if (!isAbsolute(path)) throw err("INVALID", "workspace_path must be an absolute path");
    const resolved = realDirectory(path);
    if (resolved === null) throw err("WORKSPACE_UNAVAILABLE", `workspace ${path} is not an existing directory`);
    const allowed = authorizeWorkspace(this.policy.workspaceRoots.map(realDirectory).filter((root): root is string => root !== null), resolved);
    if (!allowed.ok) throw allowed.error;
    for (const kept of [this.rootDir, ...(this.opts.hostAgentDir ? [this.opts.hostAgentDir] : [])]) {
      const storage = realDirectory(kept);
      if (storage !== null && (pathWithin(resolved, storage) || pathWithin(storage, resolved))) throw err("POLICY_DENIED", `workspace ${resolved} overlaps the supervisor's storage`);
    }
    const owner = realDirectory(ownerWorkdir);
    if (owner !== null && pathWithin(owner, resolved) && !this.policy.workspaceOwnerCheckoutAllowed) {
      throw err("POLICY_DENIED", `workspace ${resolved} is the governing session's own checkout; the policy must set workspaceOwnerCheckoutAllowed to assign it`);
    }
    const checkout = this.workspace.describeCheckout(resolved);
    if (!checkout) throw err("WORKSPACE_UNAVAILABLE", `workspace ${resolved} is not a git work tree with a commit`);
    if (realDirectory(checkout.workTree) !== resolved) throw err("WORKSPACE_UNAVAILABLE", `workspace ${resolved} is not the top-level directory of its git work tree (${checkout.workTree})`);
    return { path: resolved, checkout };
  }

  /** A prepared workspace must still be allowed and present when a worker is loaded into it again. */
  private assertPreparedWorkspace(allocation: WorkspaceAllocation): void {
    if (this.policy.workspaceRoots.length === 0) throw err("POLICY_DENIED", "workspace_path is not permitted: the policy lists no workspaceRoots");
    const resolved = realDirectory(allocation.workdir);
    if (resolved === null) throw err("WORKSPACE_UNAVAILABLE", `workspace ${allocation.workdir} no longer exists; its owner removed it`);
    const allowed = authorizeWorkspace(this.policy.workspaceRoots.map(realDirectory).filter((root): root is string => root !== null), resolved);
    if (!allowed.ok) throw allowed.error;
  }

  /**
   * The concrete workspace of a new agent:
   * - a prepared workspace: the caller's directory as verified, edited in
   *   place by writers; nothing is allocated;
   * - none: the owner's working directory, edited in place by writers;
   * - worktree: a writer gets its own worktree of the owner's checkout (the
   *   project-relative directory is kept); readers read in place;
   * - sandbox: the registered repository's read roots, plus a worktree for
   *   writers; selected skills' directories are readable in the view.
   */
  private bindWorkspace(
    agentId: AgentId,
    profile: "reader" | "writer",
    isolation: Isolation,
    from: { ownerWorkdir: string; checkout: CheckoutInfo | null; prepared: PreparedWorkspace | null; reg: RegisteredRepo | null; baseCommit: string | null; instructions: InstructionSet },
  ): WorkspaceAllocation {
    const tmpDir = this.agentTmp(agentId);
    if (from.prepared) {
      // The git dir and HEAD are recorded now, before the agent can touch the directory.
      const writer = profile === "writer";
      const git = writer ? { workTree: from.prepared.path, gitDir: from.prepared.checkout.gitDir, baseCommit: from.prepared.checkout.head } : null;
      return { kind: profile, workdir: from.prepared.path, readRoots: [], writableRoot: writer ? from.prepared.path : null, git, repoId: null, tmpDir, external: true };
    }
    if (isolation === "none" || profile === "reader" && isolation === "worktree") {
      const writer = profile === "writer";
      const git = writer && from.checkout ? { workTree: from.checkout.workTree, gitDir: from.checkout.gitDir, baseCommit: from.checkout.head } : null;
      return { kind: profile, workdir: from.ownerWorkdir, readRoots: [], writableRoot: writer ? from.ownerWorkdir : null, git, repoId: null, tmpDir, external: false };
    }
    const skillDirs = from.instructions.skills.map((s) => s.baseDir);
    if (isolation === "sandbox") {
      if (!from.reg) return { kind: profile, workdir: tmpDir, readRoots: skillDirs, writableRoot: null, git: null, repoId: null, tmpDir, external: false };
      const readRoots = [...from.reg.readRoots, ...skillDirs];
      if (profile === "reader") return { kind: "reader", workdir: from.reg.readRoots[0] ?? tmpDir, readRoots, writableRoot: null, git: null, repoId: from.reg.repoId, tmpDir, external: false };
      const wt = this.allocateWorktree(from.reg.repoId, from.reg.checkoutPath, from.baseCommit, "");
      return { kind: "writer", workdir: wt.worktreePath, readRoots, writableRoot: wt.worktreePath, git: { workTree: wt.worktreePath, gitDir: wt.gitDir, baseCommit: wt.baseCommit }, repoId: from.reg.repoId, tmpDir, external: false };
    }
    const checkout = from.checkout!;
    const wt = this.allocateWorktree(basename(checkout.workTree), checkout.workTree, from.baseCommit, ", or use isolation none to edit the checkout in place");
    const workdir = join(wt.worktreePath, relative(checkout.workTree, from.ownerWorkdir));
    if (!existsSync(workdir)) {
      this.workspace.releaseAllocation(wt, { prune: true });
      throw err("CONFLICT", `working directory ${relative(checkout.workTree, from.ownerWorkdir)} does not exist at the worktree's base commit`);
    }
    return { kind: "writer", workdir, readRoots: [], writableRoot: wt.worktreePath, git: { workTree: wt.worktreePath, gitDir: wt.gitDir, baseCommit: wt.baseCommit }, repoId: null, tmpDir, external: false };
  }

  /** A writer worktree from a committed base; a dirty checkout needs an explicit base. */
  private allocateWorktree(label: string, checkoutPath: string, baseCommit: string | null, alternative: string): WorktreeAllocation {
    const wt = this.workspace.allocateWriter(label, checkoutPath, baseCommit ?? "HEAD", join(this.rootDir, "worktrees"));
    if (wt.baseDirty && !baseCommit) {
      // Actionable precondition: an agreed committed base is required.
      this.workspace.releaseAllocation(wt, { prune: true });
      throw err("CONFLICT", `checkout has uncommitted changes; supply an explicit base_commit, commit first${alternative}`);
    }
    return wt;
  }

  /** Tool-call authority of an agent's active run, derived from the authenticated channel. */
  private brokerCaller(rt: AgentRuntime): BrokerCaller {
    const record = rt.record;
    return {
      agentId: record.id,
      taskRunId: rt.activeRun?.taskRunId ?? null,
      generation: rt.activeRun?.generation ?? null,
      grants: record.grants,
      workdir: record.allocation.workdir,
      writableRoot: record.allocation.writableRoot,
      sandbox: this.sandboxOf(record, record.allocation.readRoots),
    };
  }

  /**
   * Sandbox view inputs, or null for host isolation. The whole root store
   * (journal, sessions, sibling workspaces) and the host credential store
   * are absent from tool views; approved paths beneath them are bound again.
   */
  private sandboxOf(record: AgentRecord, readRoots: string[]): CallerSandbox | null {
    if (record.grants.isolation !== "sandbox") return null;
    return { readRoots, tmpDir: record.allocation.tmpDir, hidePaths: [this.rootDir, ...(this.opts.hostAgentDir ? [this.opts.hostAgentDir] : [])] };
  }

  /** Failed startup keeps a terminal record (no ghost identity) and frees capacity. */
  private startupFailed(rt: AgentRuntime, taskRunId: TaskRunId | null, e: Error): void {
    this.releaseRunnable(rt);
    this.releaseResident(rt);
    rt.activeRun = null;
    rt.record.residency = "unloaded";
    rt.record.outcome = "failed";
    rt.record.detail = `startup failed: ${e.message}`;
    if (taskRunId) this.settleTaskTerminal(rt, taskRunId, "failed", e.message);
    if (rt.gateTaskRunId === taskRunId && taskRunId) this.gate.cancelTask(taskRunId, "failed");
  }

  private async startWorker(rt: AgentRuntime, taskText: string): Promise<void> {
    // Runnable capacity gates process launch: a parked agent holds its
    // resident lease and identity, and launches only when it can run.
    const runnable = this.scheduler.tryAcquireRunnable(rt.record.id);
    if (!runnable) {
      rt.parkedStartup = taskText;
      rt.record.observed = "queued";
      rt.record.detail = "parked: waiting for runnable lease";
      // Durable like any accepted task: a restart keeps it for explicit resume.
      this.publish("task.queued", { id: rt.record.currentTaskRunId, agentId: rt.record.id, messageId: "", text: taskText, replaces: null, initial: true });
      return;
    }
    rt.runnableLease = runnable;
    await this.continueStartup(rt, taskText);
  }

  private makeWorker(agentId: AgentId): WorkerPort {
    if (this.opts.workerFactory) return this.opts.workerFactory({ agentId, instanceId: randomUUID(), rootEpoch: this.epoch });
    return new WorkerHandle({
      workerPath: this.opts.workerPath ?? join(this.rootDir, "..", "worker.js"),
      rootEpoch: this.epoch,
      agentId,
      sdkRoot: this.opts.sdkRoot ?? null,
      deterministic: this.opts.deterministic ?? false,
      agentDir: join(this.rootDir, "worker-agent-dirs", agentId),
      sessionsDir: join(this.rootDir, "sessions"),
      hostAgentDir: this.opts.hostAgentDir,
    }, newWorkerBinding(this.epoch, agentId));
  }

  /** Launch a worker process bound to this runtime (no work accepted yet). */
  private async launchWorker(rt: AgentRuntime): Promise<WorkerPort> {
    const worker = this.makeWorker(rt.record.id);
    rt.worker = worker;
    rt.record.residency = "loaded";
    worker.setEventHandler((event) => {
      this.detached(() => {
        if (rt.worker === worker) this.onWorkerEvent(rt, event);
      });
    });
    worker.setToolRequestHandler(async (payload) => this.onToolRequest(rt, worker, payload));
    worker.setExitHandler((info) => {
      this.detached(() => this.onWorkerExit(rt, worker, info));
    });
    try {
      await worker.launch();
    } catch (e) {
      if (rt.worker === worker) {
        rt.worker = null;
        rt.record.residency = "unloaded";
      }
      throw e;
    }
    // Record process ownership for recovery verification (never kill by
    // guessed PIDs: boot identity must match before signalling).
    rt.workerPid = worker.pid;
    rt.workerBoot = worker.pid !== null ? readProcessIdentity(worker.pid) : null;
    return worker;
  }

  /** The exact tool allowlist a child's worker registers (the supervisor re-checks every call). */
  private childTools(rt: AgentRuntime): string[] {
    if (this.gate.isReviewer(rt.record.id)) return [...FILE_TOOLS, GATE_DECISION_TOOL];
    const tools: string[] = [...FILE_TOOLS];
    if (rt.record.profile === "writer" && rt.record.allocation.writableRoot) tools.push(...WRITE_TOOLS);
    if (rt.record.grants.shell) tools.push(SHELL_TOOL);
    tools.push(...CHILD_CONTROL_TOOLS);
    if (rt.record.grants.nesting && rt.record.depth < rt.record.grants.maxDepth) tools.push(...DELEGATION_TOOLS);
    return tools;
  }

  private initPayload(rt: AgentRuntime, taskText: string | null, workdir: string): Record<string, unknown> {
    return {
      taskText,
      profile: rt.record.profile,
      instructionHash: rt.record.instructionHash,
      instructions: rt.record.instructions,
      model: rt.record.model,
      taskRunId: rt.record.currentTaskRunId,
      executionGeneration: rt.record.executionGeneration,
      workdir,
      readRoots: rt.record.allocation.readRoots,
      writable: rt.record.profile === "writer",
      tools: this.childTools(rt),
      restore: rt.pendingRestore,
    };
  }

  private workdirOf(rt: AgentRuntime): string {
    return rt.record.allocation.workdir;
  }

  /** Launch the worker process and accept initial input (runnable lease held). */
  private async continueStartup(rt: AgentRuntime, taskText: string): Promise<void> {
    const record = rt.record;
    record.observed = "starting";
    let worker: WorkerPort;
    try {
      worker = await this.launchWorker(rt);
    } catch (e) {
      this.releaseRunnable(rt);
      throw e;
    }
    const init = this.initPayload(rt, taskText, this.workdirOf(rt));
    rt.pendingRestore = null;
    // The run is active from the moment the worker may prompt.
    rt.activeRun = { taskRunId: record.currentTaskRunId!, generation: record.executionGeneration, interruptRequested: false };
    try {
      const res = (await worker.request("initialize", init, { taskRunId: record.currentTaskRunId ?? undefined, generation: record.executionGeneration })) as { ok?: boolean; sessionFile?: string | null; message?: string };
      if (!res || res.ok !== true) throw err("INVALID", `worker initialize rejected: ${res?.message ?? "unknown"}`);
      record.nativeSessionPath = typeof res.sessionFile === "string" ? res.sessionFile : record.nativeSessionPath;
    } catch (e) {
      rt.activeRun = null;
      this.releaseRunnable(rt);
      rt.worker = null;
      worker.kill();
      record.residency = "unloaded";
      throw e;
    }
    if (rt.activeRun && record.observed === "starting") record.observed = "running";
    record.detail = "running";
    record.lastActivityAt = this.now();
    const started = this.publishGenerationStarted(rt, record.currentTaskRunId!, record.executionGeneration, {});
    record.lastEventSeq = started.seq;
  }

  // -- worker event intake -----------------------------------------------------

  private onWorkerEvent(rt: AgentRuntime, event: WorkerEvent): void {
    const record = rt.record;
    if (event.executionGeneration !== null && event.executionGeneration !== record.executionGeneration) {
      return; // Fence stale generations.
    }
    record.lastActivityAt = this.now();
    if (this.gate.isReviewer(record.id)) {
      if (event.kind === "preview") rt.streaming = event.detail["partial"] === true ? String(event.detail["text"] ?? "").slice(-PREVIEW_MAX) : null;
      else if (event.kind === "tool_start") rt.streaming = null;
      else if (event.kind === "settled") {
        this.reviewerSettled(rt, String(event.detail["error"] ?? event.detail["status"] ?? "settled"), event.detail["usage"] as UsageDetail | undefined);
      }
      return;
    }
    switch (event.kind) {
      case "started":
        rt.streaming = null;
        if (rt.activeRun) {
          record.observed = "running";
          record.detail = "running";
        }
        break;
      case "tool_start":
        rt.streaming = null;
        record.detail = `tool ${(event.detail["tool"] as string) ?? "unknown"} running`;
        break;
      case "tool_end":
        record.detail = "running";
        break;
      case "preview":
        if (event.detail["partial"] === true) {
          rt.streaming = String(event.detail["text"] ?? "").slice(-PREVIEW_MAX);
        } else {
          rt.lastPreview = String(event.detail["text"] ?? "").slice(0, PREVIEW_MAX);
          rt.streaming = null;
        }
        break;
      case "settled":
        rt.streaming = null;
        this.finalizeGeneration(rt, String(event.detail["status"] ?? "failed"), String(event.detail["lastAssistantText"] ?? ""), String(event.detail["error"] ?? ""), event.detail["usage"] as UsageDetail | undefined);
        break;
      default:
        break;
    }
  }

  /** A worker process exited on its own (crash, OOM, external kill). */
  private async onWorkerExit(rt: AgentRuntime, worker: WorkerPort, info: { code: number | null; signal: string | null }): Promise<void> {
    if (rt.worker !== worker) return; // Planned stop (evict/close/reload): already detached.
    rt.worker = null;
    rt.record.residency = "unloaded";
    rt.leaseWaitCancel?.();
    rt.leaseWaitCancel = null;
    this.cancelCallerWaits(rt.record.id);
    const why = `worker exited (code ${info.code ?? "-"}, signal ${info.signal ?? "-"})`;
    const run = rt.activeRun;
    if (this.gate.isReviewer(rt.record.id)) {
      this.reviewerSettled(rt, why, undefined);
      this.releaseResident(rt);
      return;
    }
    if (run) {
      // Effects of jobs still running at exit are unknown: cancel them and
      // keep the outcome uncertain rather than inventing success or failure.
      const cancelled = await this.broker.cancelJobs(rt.record.id);
      // Known usage up to the last tool call, plus an unknown remainder.
      this.finalizeGeneration(rt, cancelled.length > 0 ? "uncertain" : "failed", "", why, { ...(rt.usageSnapshot ?? {}), unknown: true });
    }
    rt.record.detail = why;
    this.releaseResident(rt);
  }

  private async onToolRequest(
    rt: AgentRuntime,
    worker: WorkerPort,
    payload: ToolRequest,
  ): Promise<{ content: string; isError: boolean }> {
    const record = rt.record;
    if (rt.worker !== worker || !rt.activeRun) return { content: "STALE_INSTANCE: no admitted execution for this worker", isError: true };
    if (rt.activeRun.interruptRequested) return { content: "NOT_RUNNING: the generation is being interrupted", isError: true };
    if (payload.usage) rt.usageSnapshot = payload.usage;
    // Supervisor-side allowlist: the worker's registry is never trusted.
    if (!this.childTools(rt).includes(payload.tool)) {
      return { content: `POLICY_DENIED: tool ${payload.tool} is not available to this agent`, isError: true };
    }
    try {
      if (payload.tool === GATE_DECISION_TOOL) {
        const res = this.gate.submitDecision(record.id, payload.args);
        return res.ok ? { content: JSON.stringify({ accepted: true }), isError: false } : { content: `${res.error.code}: ${res.error.message}`, isError: true };
      }
      if ((CHILD_CONTROL_TOOLS as readonly string[]).includes(payload.tool) || (DELEGATION_TOOLS as readonly string[]).includes(payload.tool)) {
        return { content: boundedText(JSON.stringify(await this.childControl(rt, payload.tool, payload.args, payload.toolCallId))), isError: false };
      }
      const caller = this.brokerCaller(rt);
      const result = await this.broker.execute(caller, { tool: payload.tool, args: payload.args });
      const text = result.timedOut
        ? `tool timed out${result.stdout ? `\n${result.stdout.slice(0, 4000)}` : ""}`
        : `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr.slice(0, 2000)}` : ""}${result.truncated ? "\n[output truncated by the sandbox]" : ""}`;
      const exit = result.exitCode !== 0 ? `\n[exit ${result.exitCode ?? result.signal}]` : "";
      return { content: `${boundedText(text)}${exit}`, isError: result.exitCode !== 0 || result.timedOut };
    } catch (e) {
      const code = (e as { code?: string }).code ?? "INVALID";
      return { content: `${code}: ${(e as Error).message.replace(/^[A-Z_]+: /, "")}`, isError: true };
    }
  }

  /** Child control tools: the same supervisor methods, caller from the channel. */
  private async childControl(rt: AgentRuntime, tool: string, args: Record<string, unknown>, toolCallId: string): Promise<unknown> {
    const caller = rt.record.id;
    const requestId = `child:${caller}:${toolCallId || randomUUID()}`;
    const str = (k: string): string => {
      const v = args[k];
      if (typeof v !== "string" || !v) throw err("INVALID", `${k} must be a nonempty string`);
      return v;
    };
    switch (tool) {
      case "send_message":
        return this.sendMessage(caller, str("target"), str("mode") as MessageMode, str("message"), {
          requestReply: args["request_reply"] === true ? true : undefined,
          replyTo: typeof args["reply_to"] === "string" ? args["reply_to"] : undefined,
        }, requestId);
      case "list_agents":
        return this.list(caller);
      case "read_agent":
        return this.read(caller, str("target"), str("view") as "status" | "result" | "events", typeof args["cursor"] === "number" ? args["cursor"] : 0, typeof args["limit"] === "number" ? args["limit"] : 20, typeof args["task_run_id"] === "string" ? args["task_run_id"] : null);
      case "wait_agent":
        return this.childWait(rt, args);
      case "spawn_agent":
        // Not offered to children; an argument sent anyway is refused, not dropped.
        if (args["workspace_path"] !== undefined) throw err("FORBIDDEN", "only the governing session assigns a prepared workspace");
        return this.spawn(caller, {
          taskName: str("task_name"),
          message: str("message"),
          profile: str("profile") as "reader" | "writer",
          isolation: args["isolation"] === undefined ? undefined : str("isolation") as Isolation,
          repoId: typeof args["repo_id"] === "string" ? args["repo_id"] : null,
          baseCommit: typeof args["base_commit"] === "string" ? args["base_commit"] : null,
          skills: parseSelection(args, "skills"),
          contextFiles: parseSelection(args, "context_files"),
        }, requestId);
      case "interrupt_agent":
        return this.interrupt(caller, str("target"), requestId);
      case "close_agent":
        await this.close(caller, str("target"), requestId);
        return { closed: args["target"] };
      default:
        throw err("UNKNOWN_OPERATION", `no control tool ${tool}`);
    }
  }

  /**
   * A child's wait parks it: the runnable lease is released while waiting
   * and reacquired (fair queue) before the result returns to its model.
   */
  private async childWait(rt: AgentRuntime, args: Record<string, unknown>): Promise<WaitResult> {
    this.broker.assertQuiescent(rt.record.id);
    const targets = Array.isArray(args["targets"]) ? (args["targets"] as Array<{ agentId: string; taskRunId: string | null }>) : null;
    const condition = (typeof args["condition"] === "string" ? args["condition"] : "activity") as WaitCondition;
    const pending = this.wait(rt.record.id, typeof args["cursor"] === "number" ? args["cursor"] : 0, typeof args["timeout_ms"] === "number" ? args["timeout_ms"] : WAIT_DEFAULT_MS, targets, condition);
    rt.record.detail = "waiting (runnable slot released)";
    this.releaseRunnable(rt);
    let result: WaitResult;
    try {
      result = await pending;
    } finally {
      const { ticket, cancel } = this.scheduler.acquireRunnableQueued(rt.record.id);
      rt.leaseWaitCancel = cancel;
      const lease = await ticket;
      rt.leaseWaitCancel = null;
      if (lease && rt.activeRun && rt.record.desiredLifecycle === "open") {
        rt.runnableLease = lease;
        rt.record.detail = "running";
      } else if (lease) {
        this.releaseTicket(lease);
      }
    }
    return result;
  }

  // -- generation finalization ---------------------------------------------------

  private finalizeGeneration(rt: AgentRuntime, status: string, text: string, error: string, usage: UsageDetail | undefined): void {
    const record = rt.record;
    const run = rt.activeRun;
    if (!run) return; // Duplicate terminal outcome: ignore (exactly-once).
    const outcome: TaskOutcome = run.interruptRequested && status !== "uncertain"
      ? "interrupted"
      : status === "succeeded" || status === "interrupted" || status === "uncertain" ? status : "failed";
    const accounted = this.accountUsage(rt, usage ?? { unknown: true });
    this.publish("usage.reported", { agentId: record.id, taskRunId: run.taskRunId, generation: run.generation, ...accounted });
    record.observed = "settled";
    record.outcome = outcome;
    // Guard admission: lock queued tasks before releasing capacity so a newer
    // task cannot start before the old gated candidate is captured. The
    // continuation re-asserts this phase (or overwrites it on interrupt/fail).
    if (rt.gateTaskRunId === run.taskRunId && outcome === "succeeded" && !this.terminalRuns.has(run.taskRunId)) {
      record.taskPhase = "candidate_recording";
    }
    rt.activeRun = null;
    rt.lastText = { taskRunId: run.taskRunId, text: text.slice(0, RESULT_TEXT_MAX) };
    rt.usageSnapshot = null;
    this.publish("generation.settled", {
      agentId: record.id,
      taskRunId: run.taskRunId,
      generation: run.generation,
      outcome,
      error: error ? error.slice(0, PREVIEW_MAX) : undefined,
      text: text.slice(0, RESULT_TEXT_MAX),
    });
    // Never hold a main runnable lease while waiting for review.
    this.releaseRunnable(rt);
    // Capture the settled generation's native checkpoint at this safe
    // boundary; the next dispatch to this worker waits for it.
    if (rt.worker) {
      const worker = rt.worker;
      rt.checkpointing = this.captureCheckpoint(rt, worker, run.taskRunId, run.generation).catch((e: unknown) => this.reportFailure(e)).finally(() => {
        rt.checkpointing = null;
        // A worker mid-checkpoint is not evictable; work parked on its
        // capacity retries now.
        this.detached(() => this.pumpRunnable());
      });
    }
    const continuation = (): void => {
      // An interrupt accepted before the outcome is published wins.
      const final: TaskOutcome = rt.joinInterrupted && outcome === "succeeded" ? "interrupted" : outcome;
      rt.joinInterrupted = false;
      const detail = final === "succeeded" ? "" : error || final;
      // A gated task does not settle on a candidate's SDK settlement.
      if (rt.gateTaskRunId === run.taskRunId && final === "succeeded" && !this.terminalRuns.has(run.taskRunId)) {
        record.taskPhase = "candidate_recording";
        this.gate.candidateSettled(record.id, run.taskRunId, run.generation, text);
        return;
      }
      if (rt.gateTaskRunId === run.taskRunId) this.gate.cancelTask(run.taskRunId, final);
      this.settleTaskTerminal(rt, run.taskRunId, final, detail);
    };
    // A child owner cancels and joins active descendants before publishing
    // its own outcome (structured ownership). New tasks queue meanwhile.
    const active = this.activeDescendants(record.id);
    if (active.length > 0) {
      if (rt.afterDescendants) throw err("CONFLICT", `agent ${record.id} settled a generation while still joining descendants`);
      rt.afterDescendants = continuation;
      record.detail = `joining ${active.length} active descendant(s) before settling`;
      for (const child of active) this.interruptSubtree(child).catch((e: unknown) => this.reportFailure(e));
      return;
    }
    continuation();
  }

  private activeDescendants(agentId: AgentId): AgentRuntime[] {
    const out: AgentRuntime[] = [];
    for (const child of this.childrenOf(agentId)) {
      if (child.activeRun || child.parkedStartup !== null || child.afterDescendants) out.push(child);
      out.push(...this.activeDescendants(child.record.id).filter((d) => !out.includes(d)));
    }
    return out;
  }

  /** Resume an owner whose settlement waited for its descendants. */
  private resumeOwnerAfterDescendant(rt: AgentRuntime): void {
    let parentId = rt.record.parentId;
    while (parentId) {
      const parent = this.agents.get(parentId);
      if (!parent) return;
      if (parent.afterDescendants && this.activeDescendants(parentId).length === 0) {
        const next = parent.afterDescendants;
        parent.afterDescendants = null;
        next();
      }
      parentId = parent.record.parentId;
    }
  }

  private accountUsage(rt: AgentRuntime | null, usage: UsageDetail): { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number | null; cost: number | null; unknown: boolean } {
    const input = usage.input ?? 0;
    const output = usage.output ?? 0;
    const cacheRead = usage.cacheRead ?? 0;
    const cacheWrite = usage.cacheWrite ?? 0;
    const reasoning = typeof usage.reasoning === "number" ? usage.reasoning : null;
    const cost = typeof usage.cost === "number" ? usage.cost : null;
    const unknown = usage.unknown === true;
    for (const target of rt ? [rt.usage, this.cumulativeUsage] : [this.cumulativeUsage]) {
      target.inputTokens += input;
      target.outputTokens += output;
      target.cacheReadTokens += cacheRead;
      target.cacheWriteTokens += cacheWrite;
      if (reasoning !== null) target.reasoningTokens = (target.reasoningTokens ?? 0) + reasoning;
      if (cost !== null) target.cost = (target.cost ?? 0) + cost;
      if (unknown) target.unknown = true;
    }
    return { input, output, cacheRead, cacheWrite, reasoning, cost, unknown };
  }

  /**
   * Immutable validated checkpoint of the settled generation: session
   * UUID, leaf entry ID, byte boundary, content checksum.
   */
  private async captureCheckpoint(rt: AgentRuntime, worker: WorkerPort, taskRunId: TaskRunId, generation: number): Promise<void> {
    try {
      const res = (await worker.request("checkpoint", {}, { taskRunId, generation, timeoutMs: CHECKPOINT_TIMEOUT_MS })) as {
        ok?: boolean;
        message?: string;
        leafEntryId?: string | null;
        materialized?: boolean;
        sessionFile?: string;
        byteCount?: number;
        sha256?: string;
      };
      if (!res || res.ok !== true) throw new Error(res?.message ?? "checkpoint rejected");
      if (res.materialized !== true || typeof res.sessionFile !== "string" || typeof res.byteCount !== "number") {
        this.publish("recovery.event", { agentId: rt.record.id, phase: "checkpoint_skipped", reason: "unmaterialized" });
        return;
      }
      // The worker synchronized its session file; read it from the root
      // store (never a path outside it) and require the worker's digest.
      const sessionsDir = join(this.rootDir, "sessions");
      if (relative(sessionsDir, resolve(res.sessionFile)).startsWith("..")) throw new Error(`session file ${res.sessionFile} lies outside the root store`);
      const bytes = readFileSync(res.sessionFile).subarray(0, res.byteCount);
      if (bytes.length !== res.byteCount || checkpointSha256(bytes) !== res.sha256) {
        this.publish("recovery.event", { agentId: rt.record.id, phase: "checkpoint_skipped", reason: "session file does not match the worker's digest" });
        return;
      }
      this.store.saveCheckpoint({ agentId: rt.record.id, taskRunId, generation, leafEntryId: res.leafEntryId ?? null, sha256: res.sha256 ?? checkpointSha256(bytes), bytes: bytes.length, createdAt: this.now(), superseded: false }, bytes);
    } catch (e) {
      this.publish("recovery.event", { agentId: rt.record.id, phase: "checkpoint_skipped", reason: (e as Error).message.slice(0, 200) });
    }
  }

  /** generation.started carries the worker ownership binding for recovery. */
  private publishGenerationStarted(rt: AgentRuntime, taskRunId: TaskRunId, generation: number, extra: Record<string, unknown>): JournalRecord {
    return this.publish("generation.started", { agentId: rt.record.id, taskRunId, generation, workerPid: rt.workerPid, workerBoot: rt.workerBoot, ...extra });
  }

  /** Publish each task run's terminal outcome exactly once and durably. */
  settleTaskTerminal(rt: AgentRuntime, taskRunId: TaskRunId, outcome: string, detail: string): void {
    if (this.terminalRuns.has(taskRunId)) return;
    this.terminalRuns.set(taskRunId, { agentId: rt.record.id, outcome });
    const text = rt.lastText?.taskRunId === taskRunId ? rt.lastText.text : "";
    if (taskRunId === rt.record.currentTaskRunId) {
      rt.record.taskPhase = "terminal";
      rt.record.taskOutcome = outcome;
      if (!rt.activeRun) rt.record.observed = "settled";
    }
    rt.queue = rt.queue.filter((q) => q.id !== taskRunId);
    rt.lastResult = { taskRunId, outcome, text, detail };
    this.publish("task.terminal", { agentId: rt.record.id, taskRunId, outcome, preview: text.slice(0, PREVIEW_MAX), detail: detail.slice(0, PREVIEW_MAX) });
    this.pumpQueue(rt);
    this.resumeOwnerAfterDescendant(rt);
  }

  /** Dispatch the next queued task to a loaded idle worker (runnable lease required). */
  private pumpQueue(rt: AgentRuntime): void {
    if (rt.activeRun || rt.held || rt.record.desiredLifecycle === "closed" || rt.quarantined || this.isPhaseLocked(rt)) return;
    if (this.pendingLost.has(rt.record.id) || rt.parkedStartup !== null) return;
    const next = rt.queue.find((q) => !q.dispatched);
    if (!next) return;
    if (!rt.worker) {
      if (!rt.loading) this.detached(() => this.loadForQueue(rt));
      return;
    }
    const lease = rt.runnableLease ?? this.scheduler.tryAcquireRunnable(rt.record.id);
    if (!lease) {
      rt.record.detail = "task queued: waiting for runnable lease";
      return;
    }
    rt.runnableLease = lease;
    next.dispatched = true;
    const record = rt.record;
    record.currentTaskRunId = next.id;
    record.executionGeneration += 1;
    record.taskPhase = "working";
    record.taskOutcome = null;
    record.outcome = null;
    record.observed = "starting";
    record.detail = "task dispatched";
    const run: ActiveRun = { taskRunId: next.id, generation: record.executionGeneration, interruptRequested: false };
    rt.activeRun = run;
    const message = this.messages.get(next.messageId);
    if (message) message.generation = run.generation;
    record.lastEventSeq = this.publishGenerationStarted(rt, next.id, run.generation, {}).seq;
    this.deliverRun(rt, run, { mode: "task", text: next.text, messageId: next.messageId });
  }

  /**
   * Load an unloaded agent that has queued work, then dispatch. Without
   * resident capacity the work stays queued (retried when capacity frees);
   * any other reload failure ends the queued tasks explicitly.
   */
  private async loadForQueue(rt: AgentRuntime): Promise<void> {
    if (rt.worker || rt.loading || !rt.queue.some((q) => !q.dispatched)) {
      this.pumpQueue(rt);
      return;
    }
    rt.loading = true;
    try {
      await this.reloadAgent(rt);
    } catch (e) {
      if ((e as { code?: string }).code === "CAPACITY_EXCEEDED") {
        rt.record.detail = "task queued: waiting for resident capacity";
        return;
      }
      for (const q of rt.queue.filter((x) => !x.dispatched)) this.settleTaskTerminal(rt, q.id, "failed", `reload failed: ${(e as Error).message}`);
      return;
    } finally {
      rt.loading = false;
    }
    this.pumpQueue(rt);
  }

  /** Send a task/repair to the worker; a rejected or failed delivery settles the run. */
  private deliverRun(rt: AgentRuntime, run: ActiveRun, payload: { mode: "task" | "repair"; text: string; messageId?: string }): void {
    const worker = rt.worker!;
    void (async () => {
      let failure: string | null = null;
      try {
        await rt.checkpointing;
        const res = (await worker.request("deliver", payload, { taskRunId: run.taskRunId, generation: run.generation })) as { ok?: boolean; code?: string; message?: string } | null;
        if (!res || res.ok !== true) failure = `delivery rejected: ${res?.code ?? "INVALID"}: ${res?.message ?? "no response"}`;
      } catch (e) {
        failure = `delivery failed: ${(e as Error).message}`;
      }
      if (failure === null) return;
      this.detached(() => {
        if (rt.activeRun !== run) return;
        if (rt.record.observed === "starting") rt.record.observed = "running";
        this.finalizeGeneration(rt, "failed", "", failure, { unknown: false });
      });
    })();
  }

  // -- messages ------------------------------------------------------------------

  async sendMessage(
    caller: CallerId,
    target: AgentId | "parent",
    mode: MessageMode,
    text: string,
    opts: { requestReply?: boolean; replyTo?: MessageId },
    requestId: string,
  ): Promise<{ messageId: MessageId; taskRunId: TaskRunId | null }> {
    return this.serialized(async () => {
      this.sweepExpiredQuestions();
      if (opts.requestReply === true && opts.replyTo !== undefined) {
        throw err("INVALID", "request_reply and reply_to are mutually exclusive");
      }
      if (mode !== "note" && mode !== "steer" && mode !== "task") throw err("INVALID", "mode must be note, steer, or task");
      if (!text) throw err("INVALID", "message text required");
      if (Buffer.byteLength(text, "utf8") > MESSAGE_TEXT_MAX) throw err("PAYLOAD_TOO_LARGE", "message exceeds 64KiB");
      const from = this.authorOf(caller);
      const to = this.resolveTarget(caller, target);
      this.checkRoute(caller, from, to);
      if (opts.replyTo !== undefined) {
        return this.answerQuestion(caller, from, opts.replyTo, text, requestId);
      }
      const digest = payloadDigest({ caller, to, mode, text, opts });
      const prior = this.store.loadCommand(requestId);
      if (prior) {
        const b = prior.body as { messageId?: string; digest?: string; taskRunId?: string | null };
        if (prior.kind === "mailbox.accepted" && b.digest === digest && typeof b.messageId === "string") return { messageId: b.messageId, taskRunId: b.taskRunId ?? null };
        throw err("DUPLICATE_REQUEST", `conflicting reuse of requestId ${requestId}`);
      }
      const rt = to === "governor" ? null : this.agents.get(to)!;
      if (to === "governor" && mode !== "note") throw err("INVALID", "messages to the governing session are notes (optionally questions)");
      if (rt && rt.record.desiredLifecycle === "closed") throw err("CLOSED", "target is closed");
      if (rt && mode === "steer" && (!rt.activeRun || rt.record.observed !== "running")) {
        throw err("NOT_RUNNING", rt?.activeRun ? "the generation is still starting; retry the steer" : "cannot steer an idle agent; use task to start work");
      }
      if (rt && mode === "task" && (this.pendingLost.has(rt.record.id) || rt.quarantined)) {
        throw err("RECOVERY_OWNER_UNCONFIRMED", rt.quarantined ?? "an unfinished run awaits recovery reconciliation");
      }
      const messageId = randomUUID();
      const taskRunId = mode === "task" ? randomUUID() : (rt?.record.currentTaskRunId ?? null);
      const deadlineAt = opts.requestReply === true ? new Date(Date.now() + this.questionTtlMs).toISOString() : undefined;
      const message: MailboxMessage = {
        id: messageId,
        rootId: this.rootId,
        from,
        to,
        mode,
        text,
        taskRunId,
        generation: mode === "task" ? null : (rt?.activeRun?.generation ?? null),
        requestReply: opts.requestReply === true,
        replyTo: null,
        createdAt: this.now(),
        seq: null,
        receipt: null,
        replied: false,
      };
      const accepted = this.publish("mailbox.accepted", {
        messageId,
        agentId: from === "governor" ? to : from,
        from,
        to,
        mode,
        text,
        taskRunId,
        requestReply: message.requestReply,
        deadlineAt,
        requestId,
        digest,
      });
      message.seq = accepted.seq;
      this.messages.set(messageId, message);
      this.store.recordCommand(requestId, accepted);
      rt?.record.pendingMessageIds.push(messageId);

      if (deadlineAt) {
        this.questions.set(messageId, { messageId, from: from as AgentId, to, text, createdAt: this.now(), deadlineAt, answered: false, cancelled: false });
        if (from !== "governor") {
          const asker = this.agents.get(from);
          if (asker) {
            asker.record.observed = "awaiting_parent";
            asker.record.detail = "awaiting parent reply";
          }
        }
        // A question preempts its addressee's settlement joins; ordinary
        // informational notes never do.
        this.preemptForQuestion(message);
      }

      if (!rt) return { messageId, taskRunId };
      if (mode === "task") {
        const queued: QueuedTask = { id: taskRunId!, agentId: to, messageId, text, createdAt: this.now(), replaces: null, dispatched: false };
        rt.queue.push(queued);
        rt.record.pendingTaskIds.push(queued.id);
        this.publish("task.queued", { id: queued.id, agentId: to, messageId, text, replaces: null });
        // An explicit new task resumes an agent recovery held.
        rt.held = false;
        if (rt.activeRun || rt.parkedStartup !== null || this.isPhaseLocked(rt)) {
          rt.record.detail = "task queued behind the unfinished run";
        } else if (rt.worker) {
          this.pumpQueue(rt);
        } else {
          // Unloaded: reload under current authority (or wait for capacity).
          await this.loadForQueue(rt);
        }
      } else if (rt.worker && (mode === "note" || rt.activeRun)) {
        // note: inserted at a safe SDK boundary, no inference when idle;
        // retained for reconciliation when unloaded. steer: next boundary.
        this.deliverMessage(rt, message);
      }
      return { messageId, taskRunId };
    });
  }

  private deliverMessage(rt: AgentRuntime, message: MailboxMessage): void {
    const worker = rt.worker;
    if (!worker) return;
    const generation = rt.activeRun?.generation ?? rt.record.executionGeneration;
    const taskRunId = rt.activeRun?.taskRunId ?? rt.record.currentTaskRunId ?? undefined;
    void worker
      .request("deliver", { mode: message.mode, text: message.text, messageId: message.id }, { taskRunId, generation })
      .then((res) => {
        if ((res as { ok?: boolean; inserted?: boolean } | null)?.inserted !== true) return;
        this.detached(async () => {
          if (rt.worker === worker) await this.bindReceipt(rt, worker, message);
        });
      })
      .catch(() => {
        // Delivery failure keeps the accepted message pending; the next
        // load reconciles it against the restored branch.
      });
  }

  private answerQuestion(caller: CallerId, from: AgentId | "governor", replyTo: MessageId, text: string, requestId: string): { messageId: MessageId; taskRunId: null } {
    const question = this.questions.get(replyTo);
    if (!question || question.answered || question.cancelled) throw err("NOT_FOUND", `question ${replyTo} not open`);
    if (question.to !== from && !isGovernor(caller)) {
      throw err("FORBIDDEN", "only the addressed recipient (or governor) may answer");
    }
    if (this.store.loadCommand(requestId)) throw err("DUPLICATE_REQUEST", `requestId ${requestId} already used`);
    question.answered = true;
    const messageId = randomUUID();
    const message: MailboxMessage = {
      id: messageId,
      rootId: this.rootId,
      from,
      to: question.from,
      mode: "note",
      text,
      taskRunId: null,
      generation: null,
      requestReply: false,
      replyTo,
      createdAt: this.now(),
      seq: null,
      receipt: null,
      replied: false,
    };
    const accepted = this.publish("mailbox.accepted", { messageId, agentId: question.from, from, to: question.from, mode: "note", text, replyTo, taskRunId: null, requestId });
    message.seq = accepted.seq;
    this.messages.set(messageId, message);
    const original = this.messages.get(replyTo);
    if (original) original.replied = true;
    this.publish("mailbox.answered", { messageId, replyTo, agentId: question.from });
    this.store.recordCommand(requestId, accepted);
    const asker = this.agents.get(question.from);
    if (asker) {
      asker.record.pendingMessageIds.push(messageId);
      if (asker.record.observed === "awaiting_parent") {
        asker.record.observed = asker.activeRun ? "running" : "settled";
        asker.record.detail = "question answered";
      }
      // A reply reaches a parked asker without starting an idle turn.
      if (asker.worker) this.deliverMessage(asker, message);
    }
    return { messageId, taskRunId: null };
  }

  /** A question preempts its addressee's settlement joins (never reports settlement). */
  private preemptForQuestion(message: MailboxMessage): void {
    for (const waiter of [...this.waiters]) {
      const addressee = waiter.caller === message.to || (message.to === "governor" && isGovernor(waiter.caller));
      if (addressee && waiter.condition !== "activity") {
        waiter.resolve(this.waitResult(waiter, false, "needs_response", this.relevantRecords(waiter)));
      }
    }
  }

  /** Bind a receipt only after the native entry is found on the active branch. */
  private async bindReceipt(rt: AgentRuntime, worker: WorkerPort, message: MailboxMessage): Promise<void> {
    try {
      const found = (await worker.request("find_entry", { messageId: message.id }, { timeoutMs: FIND_ENTRY_TIMEOUT_MS })) as { ok?: boolean; entryId?: string | null };
      if (found?.ok !== true || typeof found.entryId !== "string") return;
      message.receipt = { messageId: message.id, nativeEntryId: found.entryId, leafId: found.entryId, checkpointSeq: this.store.durableSeq(), byteOffset: -1 };
      this.publish("mailbox.receipt", { messageId: message.id, agentId: rt.record.id, leafEntryId: found.entryId });
    } catch {
      // Remains unreceipted; reconciliation on the next load checks again.
    }
  }

  /** Cancel expired unanswered questions (deadlines are explicit). */
  private sweepExpiredQuestions(): void {
    const now = Date.now();
    for (const q of this.questions.values()) {
      if (q.answered || q.cancelled || Date.parse(q.deadlineAt) > now) continue;
      q.cancelled = true;
      this.publish("mailbox.question_expired", { messageId: q.messageId, agentId: q.from, to: q.to });
      const asker = this.agents.get(q.from);
      if (asker && asker.record.observed === "awaiting_parent") {
        asker.record.observed = asker.activeRun ? "running" : "settled";
        asker.record.detail = "question expired without reply; continuing";
      }
    }
  }

  // -- observation -----------------------------------------------------------------

  list(caller: CallerId): AgentView[] {
    this.sweepExpiredQuestions();
    const out: AgentView[] = [];
    for (const rt of this.agents.values()) {
      if (this.visibleTo(caller, rt.record)) out.push(this.viewOf(rt));
    }
    out.sort((a, b) => (a.path < b.path ? -1 : 1));
    return out;
  }

  read(caller: CallerId, target: AgentId, view: "status" | "result" | "events", cursor: number, limit: number, taskRunId: TaskRunId | null): ReadResult {
    const rt = this.agents.get(target);
    if (!rt) throw err("NOT_FOUND", `agent ${target} unknown`);
    if (!this.visibleTo(caller, rt.record)) throw err("FORBIDDEN", "agent not visible to caller");
    if (view === "status") return { status: this.viewOf(rt), result: null, events: [], cursor };
    if (view === "result" && taskRunId !== null && taskRunId !== rt.lastResult?.taskRunId) {
      return { status: this.viewOf(rt), result: this.resultFromJournal(target, taskRunId), events: [], cursor };
    }
    if (view === "result") {
      const last = rt.lastResult;
      return {
        status: this.viewOf(rt),
        result: last ? { taskRunId: last.taskRunId, outcome: last.outcome, text: last.text.slice(0, RESULT_TEXT_MAX), detail: last.detail } : null,
        events: [],
        cursor,
      };
    }
    if (view !== "events") throw err("INVALID", "view must be status, result, or events");
    const bounded = Math.min(Math.max(1, limit), 100);
    const { records } = this.store.readSince(cursor, Number.MAX_SAFE_INTEGER);
    const mine = records.filter((r) => this.recordConcerns(r, target));
    const page = mine.slice(0, bounded);
    return {
      status: this.viewOf(rt),
      result: null,
      events: page.map((r) => this.viewOfRecord(r)),
      cursor: mine.length > bounded ? page[page.length - 1]!.seq : this.store.durableSeq(),
    };
  }

  /**
   * Notices for the governing conversation after a journal cursor: terminal
   * outcomes and messages addressed to the governing session. At most
   * `limit` lines; the returned cursor never passes an undelivered line.
   */
  noticesSince(cursor: number, limit: number): { lines: string[]; cursor: number } {
    const lines: string[] = [];
    let last = cursor;
    for (const r of this.store.readSince(cursor, Number.MAX_SAFE_INTEGER).records) {
      let line: string | null = null;
      if (r.kind === "task.terminal") {
        const path = this.agents.get(r.body["agentId"] as AgentId)?.record.path ?? String(r.body["agentId"]);
        const detail = typeof r.body["detail"] === "string" ? r.body["detail"].trim() : "";
        line = `${path} task ${String(r.body["taskRunId"])} ended ${String(r.body["outcome"])}${detail === "" ? "" : `: ${detail}`}`;
      } else if (r.kind === "agent.quarantined" && typeof r.body["reason"] === "string") {
        const path = this.agents.get(r.body["agentId"] as AgentId)?.record.path ?? String(r.body["agentId"]);
        line = `${path} quarantined: ${r.body["reason"]}`;
      } else if (r.kind === "mailbox.accepted" && r.body["to"] === "governor" && typeof r.body["text"] === "string") {
        const from = this.agents.get(r.body["from"] as AgentId)?.record.path ?? String(r.body["from"]);
        line = `${r.body["requestReply"] === true ? `question ${String(r.body["messageId"])}` : "message"} from ${from} (${String(r.body["from"])}): ${(r.body["text"] as string).slice(0, 2000)}`;
      }
      if (line === null) {
        last = r.seq;
        continue;
      }
      if (lines.length >= limit) return { lines, cursor: last };
      lines.push(line);
      last = r.seq;
    }
    return { lines, cursor: last };
  }

  /** An earlier run's result: its terminal record plus its last generation's text. */
  private resultFromJournal(agentId: AgentId, taskRunId: TaskRunId): ReadResult["result"] {
    let text = "";
    let terminal: Record<string, unknown> | null = null;
    for (const r of this.store.readSince(0, Number.MAX_SAFE_INTEGER).records) {
      if (r.body["agentId"] !== agentId || r.body["taskRunId"] !== taskRunId) continue;
      if (r.kind === "generation.settled" && typeof r.body["text"] === "string") text = r.body["text"] as string;
      if (r.kind === "task.terminal") terminal = r.body;
    }
    if (!terminal && !text) throw err("NOT_FOUND", `no result for task run ${taskRunId} of ${agentId}`);
    return { taskRunId, outcome: (terminal?.["outcome"] as string | undefined) ?? null, text: text.slice(0, RESULT_TEXT_MAX), detail: (terminal?.["detail"] as string | undefined) ?? "" };
  }

  /**
   * Where the agent's conversation lives. The current worker's session file
   * when known; otherwise (an agent restored from the journal and not
   * reloaded yet) its most recently written session file.
   */
  transcript(caller: CallerId, target: AgentId): TranscriptSource {
    const rt = this.agents.get(target);
    if (!rt) throw err("NOT_FOUND", `agent ${target} unknown`);
    if (!isGovernor(caller)) throw err("FORBIDDEN", "transcripts are for the governing session");
    const reviewer = this.gate.isReviewer(target);
    const messages = new Map<MessageId, { from: string; reply: boolean }>();
    for (const m of this.messages.values()) {
      if (m.to === target) messages.set(m.id, { from: m.from === "governor" ? "governor" : (this.agents.get(m.from)?.record.path ?? m.from), reply: m.replyTo !== null });
    }
    const sessions = this.reviewSessions.filter((r) => (reviewer ? r.reviewerId === target : r.agentId === target));
    const reviews = sessions.map((r, i): ReviewTranscript => {
      const reviewerRt = this.agents.get(r.reviewerId);
      // Only a reviewer's latest evaluation can be the one it is executing.
      const latest = !sessions.slice(i + 1).some((later) => later.reviewerId === r.reviewerId);
      const active = latest && reviewerRt?.activeRun?.taskRunId === r.taskRunId;
      return { reviewId: r.reviewId, taskRunId: r.taskRunId, candidateId: r.candidateId, model: r.model, sessionFile: r.sessionFile, at: r.at, active, streaming: active ? reviewerRt!.streaming : null };
    });
    // A reviewer's in-flight text belongs to the review it is executing.
    return { sessionFile: reviewer ? null : (rt.record.nativeSessionPath ?? this.newestSessionFile(target)), reviews, streaming: !reviewer && rt.activeRun ? rt.streaming : null, messages };
  }

  private newestSessionFile(agentId: AgentId): string | null {
    const dir = join(this.rootDir, "sessions", agentId);
    if (!existsSync(dir)) return null;
    let newest: { path: string; mtime: number } | null = null;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(dir, name);
      const mtime = statSync(path).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { path, mtime };
    }
    return newest?.path ?? null;
  }

  /** Open questions visible to the caller (human governor sees all). */
  pendingQuestions(caller: CallerId): Array<{ messageId: MessageId; from: string; to: string; text: string; deadlineAt: string }> {
    this.sweepExpiredQuestions();
    const out: Array<{ messageId: MessageId; from: string; to: string; text: string; deadlineAt: string }> = [];
    for (const q of this.questions.values()) {
      if (q.answered || q.cancelled) continue;
      if (!isGovernor(caller) && q.from !== caller && q.to !== caller) continue;
      out.push({ messageId: q.messageId, from: q.from, to: q.to, text: q.text, deadlineAt: q.deadlineAt });
    }
    return out;
  }

  // -- waits -------------------------------------------------------------------------

  /**
   * Wait for durable events after a cursor. Joins capture exact task-run
   * ids at registration and are satisfied from the terminal-outcome map,
   * so an already-settled run satisfies its join regardless of the cursor.
   * Single-threaded registration: nothing published in between is lost.
   */
  async wait(
    caller: CallerId,
    cursor: number,
    timeoutMs: number,
    targets: Array<{ agentId: AgentId; taskRunId: TaskRunId | null }> | null,
    condition: WaitCondition,
  ): Promise<WaitResult> {
    if (condition !== "activity" && condition !== "any_settled" && condition !== "all_settled") throw err("INVALID", "condition must be activity, any_settled, or all_settled");
    if (targets && targets.length === 0) targets = null;
    const joinTaskRunIds: TaskRunId[] = [];
    for (const t of targets ?? []) {
      const rt = this.agents.get(t.agentId);
      if (!rt) throw err("NOT_FOUND", `wait target ${t.agentId} unknown`);
      if (!this.visibleTo(caller, rt.record)) throw err("FORBIDDEN", `wait target ${t.agentId} not visible to caller`);
      const id = t.taskRunId ?? rt.record.currentTaskRunId;
      if (id) joinTaskRunIds.push(id);
    }
    if (!targets && condition !== "activity") {
      // No explicit targets: join every unfinished run the caller can see.
      for (const rt of this.agents.values()) {
        if (rt.record.id === caller || this.gate.isReviewer(rt.record.id) || !this.visibleTo(caller, rt.record)) continue;
        const id = rt.record.currentTaskRunId;
        if (id && !this.terminalRuns.has(id) && rt.record.desiredLifecycle === "open") joinTaskRunIds.push(id);
      }
    }
    this.sweepExpiredQuestions();
    return new Promise<WaitResult>((resolve) => {
      const waiter: WaiterReg = {
        caller,
        cursor,
        targets,
        condition,
        joinTaskRunIds,
        joinToken: randomUUID(),
        timer: setTimeout(() => waiter.resolve(this.waitResult(waiter, false, "timeout", this.relevantRecords(waiter))), Math.min(Math.max(1, timeoutMs || WAIT_DEFAULT_MS), WAIT_MAX_MS)),
        resolve: (r) => {
          clearTimeout(waiter.timer);
          const i = this.waiters.indexOf(waiter);
          if (i >= 0) this.waiters.splice(i, 1);
          resolve(r);
        },
      };
      this.waiters.push(waiter);
      const immediate = this.checkWaitSatisfied(waiter);
      if (immediate) waiter.resolve(immediate);
    });
  }

  private waitResult(waiter: WaiterReg, completed: boolean, reason: WaitResult["reason"], relevant: JournalRecord[]): WaitResult {
    const reported = waiter.condition === "activity" ? relevant : relevant.filter((r) => MATERIAL_EVENTS.has(r.kind));
    let cursor = reported.length > WAIT_EVENT_LIMIT ? reported[WAIT_EVENT_LIMIT - 1]!.seq : Math.max(waiter.cursor, this.store.durableSeq());
    // Never advance past messages this result did not return.
    const inbox = this.inbox(waiter.caller, waiter.cursor, cursor);
    if (inbox.truncated) cursor = inbox.lastSeq;
    const page = reported.filter((r) => r.seq <= cursor).slice(0, WAIT_EVENT_LIMIT);
    return { completed, reason, events: page.map((r) => this.viewOfRecord(r)), messages: inbox.messages, cursor, joinTaskRunIds: waiter.joinTaskRunIds, joinToken: waiter.joinToken };
  }

  /**
   * Messages addressed to a caller with journal seq in (afterSeq, uptoSeq],
   * read from the journal; at most WAIT_MESSAGE_LIMIT, with the seq of the
   * last one returned when more remain.
   */
  inbox(caller: CallerId, afterSeq: number, uptoSeq: number): { messages: WaitMessage[]; truncated: boolean; lastSeq: number } {
    const addressee = isGovernor(caller) ? "governor" : caller;
    const out: WaitMessage[] = [];
    let lastSeq = afterSeq;
    for (const r of this.store.readSince(afterSeq, Number.MAX_SAFE_INTEGER).records) {
      if (r.seq > uptoSeq) break;
      const b = r.body;
      if (r.kind !== "mailbox.accepted" || b["to"] !== addressee || typeof b["text"] !== "string") continue;
      if (out.length >= WAIT_MESSAGE_LIMIT) return { messages: out, truncated: true, lastSeq };
      lastSeq = r.seq;
      out.push({
        messageId: b["messageId"] as string,
        from: b["from"] as string,
        mode: b["mode"] as MessageMode,
        text: (b["text"] as string).slice(0, 4000),
        requestReply: b["requestReply"] === true,
        replyTo: (b["replyTo"] as string | null) ?? null,
      });
    }
    return { messages: out, truncated: false, lastSeq };
  }

  private relevantRecords(waiter: WaiterReg): JournalRecord[] {
    return this.store.readSince(waiter.cursor, Number.MAX_SAFE_INTEGER).records.filter((r) => this.eventRelevant(waiter, r));
  }

  private checkWaitSatisfied(waiter: WaiterReg): WaitResult | null {
    if (waiter.condition === "activity") {
      const relevant = this.relevantRecords(waiter);
      return relevant.length > 0 ? this.waitResult(waiter, true, "events", relevant) : null;
    }
    const done = waiter.joinTaskRunIds.filter((id) => this.terminalRuns.has(id));
    const satisfied = waiter.joinTaskRunIds.length === 0 || (waiter.condition === "any_settled" ? done.length > 0 : done.length === waiter.joinTaskRunIds.length);
    return satisfied ? this.waitResult(waiter, true, "settled", this.relevantRecords(waiter)) : null;
  }

  /** Targeted waits follow their targets; untargeted waits see what the caller may see. */
  private eventRelevant(waiter: WaiterReg, r: JournalRecord): boolean {
    const b = r.body;
    if (waiter.targets) {
      return waiter.targets.some((t) => (t.taskRunId === null || t.taskRunId === b["taskRunId"]) && (b["agentId"] === t.agentId || b["from"] === t.agentId || b["to"] === t.agentId));
    }
    if (isGovernor(waiter.caller)) return true;
    if (b["to"] === waiter.caller) return true;
    const agentId = b["agentId"] as string | undefined;
    return agentId !== undefined && agentId !== waiter.caller && this.agents.has(agentId) && this.visibleTo(waiter.caller, this.agents.get(agentId)!.record);
  }

  private evaluateWaiters(): void {
    for (const waiter of [...this.waiters]) {
      const satisfied = this.checkWaitSatisfied(waiter);
      if (satisfied) waiter.resolve(satisfied);
    }
  }

  /** New user input (or an interrupt) cancels a caller's waits without cancelling children. */
  cancelCallerWaits(caller: CallerId): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.caller === caller) waiter.resolve(this.waitResult(waiter, false, "input", this.relevantRecords(waiter)));
    }
  }

  // -- interruption & close ------------------------------------------------------------

  async interrupt(caller: CallerId, target: AgentId, requestId: string): Promise<{ accepted: true; previous: AgentView }> {
    return this.serialized(async () => {
      const rt = this.agents.get(target);
      if (!rt) throw err("NOT_FOUND", `agent ${target} unknown`);
      this.checkControl(caller, rt.record);
      const previous = this.viewOf(rt);
      if (this.store.loadCommand(requestId)) throw err("DUPLICATE_REQUEST", `requestId ${requestId} already used`);
      const accepted = this.publish("command.accepted", { requestId, action: "interrupt", agentId: target });
      this.store.recordCommand(requestId, accepted);
      // Interrupt the target run, its linked gate, and active descendants.
      await this.interruptSubtree(rt);
      return { accepted: true as const, previous };
    });
  }

  private async interruptSubtree(rt: AgentRuntime): Promise<void> {
    const record = rt.record;
    if (rt.activeRun) rt.activeRun.interruptRequested = true;
    this.publish("agent.interrupted", { agentId: record.id, taskRunId: rt.activeRun?.taskRunId ?? record.currentTaskRunId });
    this.cancelCallerWaits(record.id);
    rt.leaseWaitCancel?.();
    // An owner joining descendants settles (interrupted) once they stop.
    if (rt.afterDescendants) rt.joinInterrupted = true;
    // A gated task in review/repair stops with its reviewer; a running or
    // joining main settles itself as interrupted.
    this.gate.interruptForAgent(record.id, rt.activeRun !== null || rt.afterDescendants !== null);
    if (rt.parkedStartup !== null) {
      // Never launched: nothing to stop. The accepted task ends interrupted.
      rt.parkedStartup = null;
      this.releaseResident(rt);
      record.observed = "settled";
      this.settleTaskTerminal(rt, record.currentTaskRunId!, "interrupted", "interrupted before launch");
    }
    if (rt.pendingRepair && !rt.activeRun && record.currentTaskRunId) {
      rt.pendingRepair = null;
      this.settleTaskTerminal(rt, record.currentTaskRunId, "interrupted", "interrupted before repair dispatch");
    }
    await this.broker.cancelJobs(record.id);
    if (rt.worker && rt.activeRun) {
      try {
        await rt.worker.request("interrupt", {}, { taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation, timeoutMs: INTERRUPT_TIMEOUT_MS });
      } catch {
        // Acceptance does not imply termination; the settled event (or
        // recovery reconciliation) confirms the stopped state separately.
      }
    }
    for (const child of this.childrenOf(record.id)) {
      if (child.activeRun || child.parkedStartup !== null) await this.interruptSubtree(child);
    }
  }

  async close(caller: CallerId, target: AgentId, requestId: string): Promise<void> {
    let subtree: AgentRuntime[] = [];
    // Section 1 (serialized): validate, dedup, accept, interrupt the subtree.
    await this.serialized(async () => {
      const rt = this.agents.get(target);
      if (!rt) throw err("NOT_FOUND", `agent ${target} unknown`);
      this.checkControl(caller, rt.record);
      if (this.store.loadCommand(requestId)) throw err("DUPLICATE_REQUEST", `requestId ${requestId} already used`);
      const accepted = this.publish("command.accepted", { requestId, action: "close", agentId: target });
      this.store.recordCommand(requestId, accepted);
      // The subtree plus the protected reviewers of its gated tasks (siblings
      // by tree position, owned by the gated task).
      subtree = this.subtreeOf(target);
      for (const member of [...subtree]) {
        for (const reviewerId of this.gate.reviewersOf(member.record.id)) {
          const reviewer = this.agents.get(reviewerId);
          if (reviewer && !subtree.includes(reviewer)) subtree.push(reviewer);
        }
      }
      // Mark closed before interrupting so post-settlement dispatch cannot
      // start queued work during teardown.
      for (const member of subtree) member.record.desiredLifecycle = "closed";
      for (const member of subtree) await this.interruptSubtree(member);
    });
    // Section 2 (outside the chain): confirm stopped state while settled
    // events can still be processed.
    await this.awaitIdle(subtree, CLOSE_JOIN_TIMEOUT_MS);
    // Section 3 (serialized): retire the logical subtree.
    await this.serialized(async () => {
      for (const member of subtree) this.retire(member);
    });
  }

  private subtreeOf(rootId: AgentId): AgentRuntime[] {
    const out: AgentRuntime[] = [];
    const visit = (id: AgentId): void => {
      const rt = this.agents.get(id);
      if (!rt) return;
      out.push(rt);
      for (const child of this.childrenOf(id)) visit(child.record.id);
    };
    visit(rootId);
    return out;
  }

  /** Confirm stopped state: no active runs and no owned jobs. */
  private async awaitIdle(members: AgentRuntime[], timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!members.some((rt) => rt.activeRun !== null || this.broker.activeJobs(rt.record.id).length > 0)) return;
      await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
    }
  }

  private retire(rt: AgentRuntime): void {
    rt.record.desiredLifecycle = "closed";
    rt.pendingReview = null;
    rt.pendingRepair = null;
    rt.parkedStartup = null;
    this.paths.retire(rt.record.path);
    const worker = rt.worker;
    rt.worker = null;
    worker?.kill();
    // A worker that never confirmed its interrupt is stopped here; its jobs
    // were cancelled by the interrupt, so the run ends interrupted.
    if (rt.activeRun && this.gate.isReviewer(rt.record.id)) {
      this.reviewerSettled(rt, "closed", undefined);
    } else if (rt.activeRun) {
      const run = rt.activeRun;
      rt.activeRun = null;
      const accounted = this.accountUsage(rt, { ...(rt.usageSnapshot ?? {}), unknown: true });
      rt.usageSnapshot = null;
      this.publish("usage.reported", { agentId: rt.record.id, taskRunId: run.taskRunId, generation: run.generation, ...accounted });
      this.publish("generation.settled", { agentId: rt.record.id, taskRunId: run.taskRunId, generation: run.generation, outcome: "interrupted", cause: "CLOSED" });
      if (rt.gateTaskRunId === run.taskRunId) this.gate.cancelTask(run.taskRunId, "interrupted");
      this.settleTaskTerminal(rt, run.taskRunId, "interrupted", "closed; the worker did not confirm its interrupt and was stopped");
    }
    for (const q of rt.queue.filter((x) => !x.dispatched)) this.settleTaskTerminal(rt, q.id, "interrupted", "closed before dispatch");
    rt.record.observed = "settled";
    this.releaseRunnable(rt);
    this.releaseResident(rt);
    rt.record.residency = "unloaded";
    const parent = rt.record.parentId ? this.agents.get(rt.record.parentId) : undefined;
    if (parent) parent.record.activeDescendants = Math.max(0, parent.record.activeDescendants - 1);
    // Sessions, results, and dirty worktrees are preserved; retained-file
    // cleanup is a separate explicit user action.
    this.publish("agent.closed", { agentId: rt.record.id, path: rt.record.path });
  }

  // -- resume / reload -------------------------------------------------------------------

  /**
   * Load an unloaded agent's worker without starting inference: recalculate
   * authority, restore the latest validated checkpoint byte-for-byte into a
   * fresh session file, select its recorded leaf, and reconcile mailbox
   * entries. Work is dispatched separately (task or repair).
   */
  private async reloadAgent(rt: AgentRuntime): Promise<void> {
    if (rt.record.desiredLifecycle === "closed") throw err("CLOSED", "closed agents cannot be resumed");
    if (rt.worker) return;
    if (rt.quarantined) throw err("RECOVERY_OWNER_UNCONFIRMED", rt.quarantined);
    if (this.pendingLost.has(rt.record.id)) throw err("RECOVERY_OWNER_UNCONFIRMED", "an unfinished run awaits recovery reconciliation");
    const parent = rt.record.parentId ? this.agents.get(rt.record.parentId) : undefined;
    const ownerGrants = parent ? parent.record.grants : rootGrants(this.policy);
    const granted = intersectGrants(this.policy, ownerGrants, {
      profile: rt.record.profile,
      isolation: rt.record.grants.isolation,
      repoId: rt.record.grants.isolation === "sandbox" ? rt.record.allocation.repoId : null,
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
    if (rt.record.allocation.external) this.assertPreparedWorkspace(rt.record.allocation);
    const checkpoint = this.store.loadCheckpoint(rt.record.id);
    if (checkpoint) {
      // Each incarnation gets its own working file; earlier ones (including
      // a crashed one) are preserved for diagnosis.
      const dir = join(this.rootDir, "sessions", rt.record.id);
      mkdirSync(dir, { recursive: true });
      const sessionFile = join(dir, `restored-${this.epoch.slice(0, 8)}-${randomUUID().slice(0, 8)}.jsonl`);
      writeFileSync(sessionFile, checkpoint.bytes);
      fsyncFile(sessionFile);
      fsyncDir(dir);
      rt.pendingRestore = { sessionFile, leafEntryId: checkpoint.ref.leafEntryId };
      if (checkpoint.ref.generation < rt.record.executionGeneration) {
        // Newer uncommitted progress is lost; say so rather than hide it.
        this.publish("recovery.event", { agentId: rt.record.id, phase: "restored_older_checkpoint", checkpointGeneration: checkpoint.ref.generation, lastGeneration: rt.record.executionGeneration });
      }
    }
    const resident = this.acquireResident(rt.record.id);
    if (!resident) throw err("CAPACITY_EXCEEDED", "no resident capacity for reload");
    rt.residentLease = resident;
    let worker: WorkerPort;
    try {
      worker = await this.launchWorker(rt);
      const res = (await worker.request("initialize", this.initPayload(rt, null, this.workdirOf(rt)), {})) as { ok?: boolean; message?: string; sessionFile?: string | null };
      if (!res || res.ok !== true) throw err("INVALID", `worker initialize rejected: ${res?.message ?? "unknown"}`);
      rt.record.nativeSessionPath = typeof res.sessionFile === "string" ? res.sessionFile : rt.record.nativeSessionPath;
    } catch (e) {
      const loaded = rt.worker as WorkerPort | null;
      rt.worker = null;
      loaded?.kill();
      rt.record.residency = "unloaded";
      this.releaseResident(rt);
      throw e;
    } finally {
      rt.pendingRestore = null;
    }
    rt.record.detail = "reloaded";
    await this.reconcileMailbox(rt, worker);
  }

  /**
   * Reinsert accepted notes absent from the restored active branch (same
   * message id), regardless of older receipts; entries retained in the
   * branch (even if compacted out of model context) are not duplicated.
   */
  private async reconcileMailbox(rt: AgentRuntime, worker: WorkerPort): Promise<void> {
    for (const messageId of rt.record.pendingMessageIds) {
      const message = this.messages.get(messageId);
      if (!message || message.mode === "task") continue;
      try {
        const found = (await worker.request("find_entry", { messageId: message.id }, { timeoutMs: FIND_ENTRY_TIMEOUT_MS })) as { ok?: boolean; entryId?: string | null };
        if (found?.ok === true && typeof found.entryId === "string") {
          message.receipt = { messageId: message.id, nativeEntryId: found.entryId, leafId: found.entryId, checkpointSeq: this.store.durableSeq(), byteOffset: -1 };
          this.publish("mailbox.receipt", { messageId: message.id, agentId: rt.record.id, leafEntryId: found.entryId, reconciled: true });
          continue;
        }
        message.receipt = null;
        await worker.request("deliver", { mode: "note", text: message.text, messageId: message.id }, {});
      } catch {
        // Remains pending; a later load retries.
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
        const worker = rt.worker;
        rt.worker = null;
        worker?.kill();
        rt.record.residency = "unloaded";
        rt.leaseWaitCancel?.();
        if (rt.runnableLease) this.scheduler.release(rt.runnableLease);
        if (rt.residentLease) this.scheduler.release(rt.residentLease);
        rt.runnableLease = null;
        rt.residentLease = null;
      }
      for (const waiter of [...this.waiters]) waiter.resolve(this.waitResult(waiter, false, "cancelled", []));
      // Gate recovery: running reviews become interrupted (resumable with
      // fresh context, counters kept); never infer approval from a crash.
      this.gate.markInterruptedForRecovery();
      this.publish("recovery.event", { epoch: this.epoch, phase: "started" });
      const { records } = this.store.readSince(0, Number.MAX_SAFE_INTEGER);
      for (const rt of this.agents.values()) {
        if (rt.record.desiredLifecycle === "closed") continue;
        if (this.gate.isReviewer(rt.record.id)) {
          rt.activeRun = null;
          rt.pendingReview = null;
          rt.record.observed = "settled";
          continue;
        }
        // A live run and a journal-restored unfinished run reconcile alike:
        // durably settle the old run before any replacement is scheduled.
        const lost = rt.activeRun
          ? { taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation, workerPid: rt.workerPid, workerBoot: rt.workerBoot }
          : (this.pendingLost.get(rt.record.id) ?? null);
        if (lost) {
          await this.reconcileLostRun(rt, lost, records, settled, quarantined);
          this.pendingLost.delete(rt.record.id);
        } else if (rt.parkedStartup !== null) {
          // Accepted, never launched: its task id stays, as a queued task.
          const id = rt.record.currentTaskRunId!;
          if (!rt.queue.some((q) => q.id === id)) rt.queue.unshift({ id, agentId: rt.record.id, messageId: "", text: rt.parkedStartup, createdAt: this.now(), replaces: null, dispatched: false });
          rt.parkedStartup = null;
        }
        // Accepted but never dispatched: keep the original task ids, held
        // for explicit resume (no automatic inference after restart).
        for (const q of rt.queue) {
          if (!q.dispatched) {
            requeued.push(q.id);
            rt.held = true;
          }
        }
      }
      // Owners that were joining descendants settle now that the
      // descendants' lost runs are settled.
      for (const [agentId, pending] of this.pendingSettle) {
        const rt = this.agents.get(agentId);
        if (rt && !this.terminalRuns.has(pending.taskRunId)) {
          this.settleTaskTerminal(rt, pending.taskRunId, pending.outcome, pending.outcome === "succeeded" ? "" : pending.error || pending.outcome);
          settled.push(pending.taskRunId);
        }
      }
      this.pendingSettle.clear();
      this.publish("recovery.event", { epoch: this.epoch, phase: "completed", settled: settled.length, quarantined: quarantined.length });
      this.suspended = false;
      // Committed gate work (a reserved repair, a parked review) resumes;
      // held ordinary tasks wait for an explicit resume.
      this.pumpRunnable();
      return { epoch: this.epoch, settled, quarantined, requeued };
    });
  }

  /**
   * Durably settle a lost main/repair run before scheduling replacements.
   * Confirms old-job termination (verified process identity, never
   * guessed PIDs); unverifiable ownership quarantines the workspace.
   */
  private async reconcileLostRun(
    rt: AgentRuntime,
    lost: { taskRunId: TaskRunId; generation: number; workerPid: number | null; workerBoot: ProcessIdentity | null },
    records: JournalRecord[],
    settled: string[],
    quarantined: string[],
  ): Promise<void> {
    const intents = records.filter((r) => r.kind === "tool.intent" && r.body["agentId"] === rt.record.id && r.body["taskRunId"] === lost.taskRunId);
    // A cancelled or uncertain job may have left partial effects: only
    // completed outcomes (ok/error) account for an intent.
    const accounted = new Set(records.filter((r) => r.kind === "tool.outcome" && (r.body["status"] === "ok" || r.body["status"] === "error")).map((r) => r.body["operationId"]));
    const unconfirmed = intents.filter((i) => !accounted.has(i.body["operationId"]));
    let ownership: OwnershipVerdict = "dead";
    if (lost.workerPid !== null) {
      ownership = verifyOwnership(lost.workerPid, lost.workerBoot);
      if (ownership === "live-match") ownership = (await killAndConfirm(lost.workerPid)) ? "dead" : "live-mismatch";
    }
    rt.workerPid = null;
    rt.workerBoot = null;
    rt.activeRun = null;
    rt.record.observed = "lost";
    // Usage not durably reported before the loss is unknown, never zero.
    this.accountUsage(rt, { unknown: true });
    this.publish("usage.reported", { agentId: rt.record.id, taskRunId: lost.taskRunId, generation: lost.generation, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: null, cost: null, unknown: true });
    const ownershipOk = ownership === "dead";
    let outcome = "interrupted";
    let detail = "PROCESS_LOST: owned-job termination confirmed; effects accounted";
    if (unconfirmed.length > 0 || !ownershipOk) {
      outcome = "uncertain";
      detail = !ownershipOk
        ? `RECOVERY_OWNER_UNCONFIRMED: unverifiable worker ownership (${ownership}); replacement execution prohibited here`
        : `${unconfirmed.length} unconfirmed tool effect(s); replacement execution prohibited here`;
      if (rt.record.allocation.writableRoot || !ownershipOk) {
        rt.quarantined = detail;
        quarantined.push(rt.record.id);
        this.publish("agent.quarantined", { agentId: rt.record.id, reason: detail });
      }
    }
    // A prepared workspace belongs to its caller, who may have removed it meanwhile.
    if (rt.record.allocation.external && realDirectory(rt.record.allocation.workdir) === null) detail += `; workspace ${rt.record.allocation.workdir} no longer exists`;
    this.publish("generation.settled", { agentId: rt.record.id, taskRunId: lost.taskRunId, generation: lost.generation, outcome, cause: "PROCESS_LOST" });
    if (rt.gateTaskRunId === lost.taskRunId) this.gate.cancelTask(lost.taskRunId, outcome);
    this.settleTaskTerminal(rt, lost.taskRunId, outcome, detail);
    settled.push(lost.taskRunId);
  }

  /**
   * Evict an idle settled worker: kill the process, release leases, keep
   * the record, native session, and identity for later resume.
   */
  async evictWorker(caller: CallerId, agentId: AgentId): Promise<void> {
    return this.serialized(async () => {
      const rt = this.agents.get(agentId);
      if (!rt) throw err("NOT_FOUND", `agent ${agentId} unknown`);
      this.checkControl(caller, rt.record);
      if (rt.activeRun) throw err("CONFLICT", "cannot evict a running generation");
      this.evict(rt);
    });
  }

  private evict(rt: AgentRuntime): void {
    const worker = rt.worker;
    rt.worker = null;
    worker?.kill();
    this.releaseRunnable(rt);
    this.releaseResident(rt);
    rt.record.residency = "unloaded";
    rt.record.detail = "evicted; native session retained for resume";
    this.publish("recovery.event", { agentId: rt.record.id, phase: "evicted" });
  }

  /** Evict one idle loaded worker to make room; false when none exists. */
  private evictOneIdle(exclude: AgentId): boolean {
    const idle = [...this.agents.values()].filter((rt) =>
      rt.record.id !== exclude && rt.worker !== null && !rt.activeRun && rt.residentLease !== null && rt.parkedStartup === null && !rt.checkpointing && !rt.queue.some((q) => !q.dispatched),
    );
    // Settled agents first; a main paused for review is next (repair reloads it).
    const victim = idle.find((rt) => rt.record.taskPhase === "terminal") ?? idle[0];
    if (!victim) return false;
    this.evict(victim);
    return true;
  }

  /** Explicit resume of an accepted-undispatched queued task (keeps its id). */
  async dispatchPending(caller: CallerId, agentId: AgentId, taskRunId: TaskRunId): Promise<void> {
    return this.serialized(async () => {
      const rt = this.agents.get(agentId);
      if (!rt) throw err("NOT_FOUND", `agent ${agentId} unknown`);
      this.checkControl(caller, rt.record);
      const queued = rt.queue.find((q) => q.id === taskRunId && !q.dispatched);
      if (!queued) throw err("NOT_FOUND", `pending task ${taskRunId} unknown`);
      if (rt.activeRun) throw err("CONFLICT", "agent has an unfinished run");
      rt.held = false;
      // Move it to the front: the explicit choice dispatches first.
      rt.queue = [queued, ...rt.queue.filter((q) => q !== queued)];
      if (!rt.worker) await this.reloadAgent(rt);
      this.pumpQueue(rt);
    });
  }

  // -- gate controls (governor only) ---------------------------------------------------

  async manageGate(
    caller: CallerId,
    action: { kind: "resume_review"; taskRunId: TaskRunId; reviewId: string }
      | { kind: "retry_review"; taskRunId: TaskRunId; candidateId: string; gate: GateSpecInput | null }
      | { kind: "bypass"; taskRunId: TaskRunId; candidateId: string; reason: string }
      | { kind: "set_limits"; taskRunId: TaskRunId; maxRounds: number | null },
    commandId: string,
  ): Promise<{ taskRunId: TaskRunId }> {
    return this.serialized(async () => {
      const state = this.gate.inspect(action.taskRunId);
      if (!state) throw err("NOT_FOUND", `no gated task ${action.taskRunId}`);
      const main = this.agents.get(state.agentId);
      if (!main) throw err("NOT_FOUND", `gated agent ${state.agentId} unknown`);
      // The task's governor is whoever owns the main agent; the main actor
      // and its reviewer never control their own validation.
      if (!isGovernor(caller) && caller !== main.record.parentId) throw err("FORBIDDEN", "only the task's governor manages its gate");
      switch (action.kind) {
        case "resume_review":
          this.gate.resumeReview(action.taskRunId, action.reviewId, commandId);
          return { taskRunId: action.taskRunId };
        case "retry_review":
          assertGateFits(this.gate.validateSpec(action.gate ?? state.spec), main.record.allocation.writableRoot !== null);
          return { taskRunId: this.gate.retryReview(action.taskRunId, action.candidateId, action.gate, commandId) };
        case "bypass":
          return { taskRunId: this.gate.bypass(action.taskRunId, action.candidateId, action.reason, commandId) };
        case "set_limits":
          this.gate.setLimits(action.taskRunId, action.maxRounds, commandId);
          return { taskRunId: action.taskRunId };
      }
    });
  }

  // -- GateHost: managed reviewer, fingerprints, checks, repair ---------------------

  nowIso(): string {
    return this.now();
  }

  setTaskPhase(agentId: AgentId, expectedTaskRunId: TaskRunId, phase: TaskPhase): void {
    const rt = this.agents.get(agentId);
    if (!rt) return;
    // Ownership fence: a stale gate path must not retarget a newer taskphase.
    // Valid STALE guard is preserved (throw, never silent retarget).
    if (rt.record.currentTaskRunId !== expectedTaskRunId) throw err("STALE_GENERATION", "phase targets a superseded task run");
    rt.record.taskPhase = phase;
    this.publish("task.phase", { agentId, taskRunId: expectedTaskRunId, phase });
  }

  settleGatedTask(agentId: AgentId, taskRunId: TaskRunId, outcome: string, detail: string): void {
    const rt = this.agents.get(agentId);
    if (!rt) return;
    rt.pendingRepair = null;
    this.settleTaskTerminal(rt, taskRunId, outcome, detail);
  }

  /** A linked retry/bypass run reviews the existing candidate: same deliverable, new task run. */
  beginLinkedRun(agentId: AgentId, taskRunId: TaskRunId): void {
    const rt = this.agents.get(agentId);
    if (!rt) return;
    if (rt.lastText) rt.lastText = { taskRunId, text: rt.lastText.text };
    rt.gateTaskRunId = taskRunId;
    rt.record.currentTaskRunId = taskRunId;
    rt.record.taskPhase = "working";
    rt.record.taskOutcome = null;
    rt.record.outcome = null;
    this.publish("task.phase", { agentId, taskRunId, phase: "working", linked: true });
  }

  quiescent(agentId: AgentId): boolean {
    const rt = this.agents.get(agentId);
    if (!rt || rt.activeRun || rt.pendingRepair || this.broker.activeJobs(agentId).length > 0) return false;
    for (const reviewerId of this.gate.reviewersOf(agentId)) {
      if (this.agents.get(reviewerId)?.activeRun) return false;
    }
    return true;
  }

  /** The protected reviewer sibling of a gated task (one identity, many executions). */
  createManagedReviewer(mainAgentId: AgentId, taskRunId: TaskRunId, spec: NormalizedGateSpec): AgentId {
    const main = this.agents.get(mainAgentId)!;
    const reviewerId = randomUUID();
    const mainAlloc = main.record.allocation;
    const readRoots = mainAlloc.writableRoot ? [mainAlloc.writableRoot, ...mainAlloc.readRoots] : [...mainAlloc.readRoots];
    const path = `${main.record.path}/__gate`;
    this.paths.reserve(path);
    const record: AgentRecord = {
      id: reviewerId,
      path,
      rootId: this.rootId,
      parentId: main.record.parentId,
      depth: main.record.depth,
      profile: "reader",
      createdEntryId: `gate:${taskRunId}`,
      nativeSessionPath: null,
      grants: { tools: [...FILE_TOOLS], repos: [], shell: false, network: false, nesting: false, maxDepth: main.record.depth, isolation: main.record.grants.isolation },
      allocation: { kind: "reader", workdir: mainAlloc.workdir, readRoots, writableRoot: null, git: null, repoId: mainAlloc.repoId, tmpDir: this.agentTmp(reviewerId), external: mainAlloc.external },
      instructions: EMPTY_INSTRUCTIONS,
      instructionHash: instructionHash(EMPTY_INSTRUCTIONS),
      policyRevision: this.policy.revision,
      model: { provider: spec.model.provider, id: spec.model.id, thinkingLevel: spec.thinkingLevel },
      currentTaskRunId: taskRunId,
      executionGeneration: 0,
      pendingTaskIds: [],
      pendingMessageIds: [],
      lastEventSeq: 0,
      desiredLifecycle: "open",
      observed: "settled",
      outcome: null,
      taskPhase: "terminal",
      taskOutcome: null,
      residency: "unloaded",
      detail: "managed gate reviewer (idle)",
      lastActivityAt: this.now(),
      activeDescendants: 0,
    };
    this.agents.set(reviewerId, newRuntime(record));
    this.store.append("agent.spawned", { agentId: reviewerId, path, parentId: record.parentId, depth: record.depth, profile: "reader", taskRunId, managedGate: true, grants: record.grants, allocation: record.allocation, instructions: record.instructions, model: record.model });
    return reviewerId;
  }

  /** Fresh in-memory reviewer conversation per evaluation, same identity. */
  startReviewerExecution(reviewerId: AgentId, input: ReviewInput): void {
    const rt = this.agents.get(reviewerId);
    if (!rt) throw err("NOT_FOUND", `reviewer ${reviewerId} unknown`);
    // A crashed gate is rerun with fresh context, never resumed mid-evaluation.
    const old = rt.worker;
    rt.worker = null;
    old?.kill();
    this.releaseRunnable(rt);
    rt.pendingReview = input;
    rt.record.observed = "queued";
    rt.record.detail = "review queued: waiting for capacity";
    if (this.scheduler.hasRunnableCapacity()) {
      rt.pendingReview = null;
      this.launchReview(rt, input);
    }
  }

  private launchReview(rt: AgentRuntime, input: ReviewInput): void {
    if (!rt.residentLease) {
      const resident = this.acquireResident(rt.record.id);
      if (!resident) {
        rt.pendingReview = input;
        return;
      }
      rt.residentLease = resident;
    }
    const runnable = this.scheduler.tryAcquireRunnable(rt.record.id);
    if (!runnable) {
      rt.pendingReview = input;
      return;
    }
    rt.runnableLease = runnable;
    rt.record.currentTaskRunId = input.taskRunId;
    rt.record.executionGeneration += 1;
    rt.record.observed = "starting";
    rt.record.detail = `reviewing ${input.candidateId}`;
    const generation = rt.record.executionGeneration;
    const run: ActiveRun = { taskRunId: rt.record.currentTaskRunId!, generation, interruptRequested: false };
    rt.activeRun = run;
    void (async () => {
      try {
        const worker = await this.launchWorker(rt);
        const res = (await worker.request("initialize", { ...this.initPayload(rt, input.prompt, this.workdirOf(rt)), restore: null }, { taskRunId: run.taskRunId, generation })) as { ok?: boolean; message?: string; sessionFile?: string | null };
        if (!res || res.ok !== true) throw new Error(`reviewer initialize rejected: ${res?.message ?? "unknown"}`);
        this.detached(() => {
          if (rt.activeRun === run) rt.record.observed = "running";
          const agentId = this.gate.inspect(input.taskRunId)?.agentId;
          if (typeof res.sessionFile === "string" && agentId) {
            const session: ReviewSession = {
              reviewerId: rt.record.id,
              agentId,
              taskRunId: input.taskRunId,
              reviewId: input.reviewId,
              candidateId: input.candidateId,
              model: rt.record.model ? `${rt.record.model.provider}/${rt.record.model.id}` : "unresolved",
              sessionFile: res.sessionFile,
              at: this.now(),
            };
            this.reviewSessions.push(session);
            this.publish("gate.review_session", { ...session });
          }
        });
      } catch (e) {
        this.detached(() => {
          if (rt.activeRun === run) this.reviewerSettled(rt, (e as Error).message, undefined);
        });
      }
    })();
  }

  /** A reviewer execution ended: a missing committed decision is a gate error. */
  private reviewerSettled(rt: AgentRuntime, why: string, usage: UsageDetail | undefined): void {
    if (!rt.activeRun) return;
    const run = rt.activeRun;
    rt.activeRun = null;
    rt.streaming = null;
    // A reviewer stopped right after its decision reported its usage with
    // that tool call; anything else unreported is unknown.
    const decided = this.gate.inspectFor(rt.record.id) === "decided";
    const accounted = this.accountUsage(rt, usage ?? (rt.usageSnapshot && decided ? rt.usageSnapshot : { ...(rt.usageSnapshot ?? {}), unknown: true }));
    rt.usageSnapshot = null;
    this.publish("usage.reported", { agentId: rt.record.id, taskRunId: run.taskRunId, generation: run.generation, ...accounted });
    if (!decided && this.gate.inspectFor(rt.record.id) === "undecided") this.gate.executionFailed(rt.record.id, why);
    rt.record.observed = "settled";
    rt.record.detail = "managed gate reviewer (idle)";
    // Disposable conversation: the worker goes with its evaluation.
    const worker = rt.worker;
    rt.worker = null;
    worker?.kill();
    rt.record.residency = "unloaded";
    this.releaseRunnable(rt);
    this.releaseResident(rt);
  }

  /** Stop a reviewer (never rejects: callers fire and forget). */
  async cancelReviewer(reviewerId: AgentId): Promise<void> {
    const rt = this.agents.get(reviewerId);
    if (!rt) return;
    try {
      rt.pendingReview = null;
      if (rt.activeRun) {
        this.reviewerSettled(rt, "review stopped by the controller", undefined);
        return;
      }
      const worker = rt.worker;
      rt.worker = null;
      worker?.kill();
      this.releaseRunnable(rt);
      this.releaseResident(rt);
      rt.record.observed = "settled";
      rt.record.residency = "unloaded";
    } catch (e) {
      this.reportFailure(e);
    }
  }

  /** Repair runs as a new execution generation in the same task run. */
  startRepairExecution(mainAgentId: AgentId, taskRunId: TaskRunId, criticism: string): void {
    const rt = this.agents.get(mainAgentId);
    if (!rt) throw err("NOT_FOUND", `main agent ${mainAgentId} unknown`);
    if (rt.record.currentTaskRunId !== taskRunId) throw err("STALE_GENERATION", "repair targets a superseded task run");
    if (rt.activeRun) throw err("CONFLICT", "main execution still active");
    rt.record.taskPhase = "repair_queued";
    rt.pendingRepair = criticism;
    if (rt.record.desiredLifecycle === "closed") return;
    if (!rt.worker) {
      // Reload under current authority (no inference), then repair.
      this.detached(async () => {
        try {
          await this.reloadAgent(rt);
          this.dispatchRepair(rt);
        } catch (e) {
          rt.pendingRepair = null;
          this.gate.cancelTask(taskRunId, "failed");
          this.settleTaskTerminal(rt, taskRunId, "failed", `repair reload failed: ${(e as Error).message}`);
        }
      });
      return;
    }
    this.dispatchRepair(rt);
  }

  private dispatchRepair(rt: AgentRuntime): void {
    const criticism = rt.pendingRepair;
    const taskRunId = rt.record.currentTaskRunId;
    if (criticism === null || !taskRunId || !rt.worker || rt.activeRun) return;
    const lease = this.scheduler.tryAcquireRunnable(rt.record.id);
    if (!lease) {
      rt.record.detail = "repair queued: waiting for runnable lease";
      return;
    }
    rt.runnableLease = lease;
    rt.pendingRepair = null;
    rt.record.executionGeneration += 1;
    const generation = rt.record.executionGeneration;
    rt.record.taskPhase = "working";
    rt.record.outcome = null;
    rt.record.observed = "running";
    rt.record.detail = `repair generation ${generation}`;
    const run: ActiveRun = { taskRunId, generation, interruptRequested: false };
    rt.activeRun = run;
    this.publishGenerationStarted(rt, taskRunId, generation, { repair: true, commandId: this.gate.inspect(taskRunId)?.repairCommandId ?? null });
    this.deliverRun(rt, run, { mode: "repair", text: criticism });
  }

  fingerprintWorkspace(agentId: AgentId, promisedOutputs: string[]): WorkspaceFingerprint {
    const rt = this.agents.get(agentId);
    const git = rt?.record.allocation.git ?? null;
    if (!git) {
      const text = rt?.lastText?.text ?? "";
      return { baseCommit: null, textOnly: true, textHash: createHash("sha256").update(text, "utf8").digest("hex"), files: [] };
    }
    const fp = fingerprintWorktree({ worktreePath: git.workTree, gitDir: git.gitDir }, git.baseCommit, promisedOutputs);
    return { baseCommit: fp.baseCommit, textOnly: false, textHash: null, files: fp.files };
  }

  workspaceMatches(agentId: AgentId, candidate: CandidateRecord): boolean {
    const a = candidate.fingerprint;
    // Re-fingerprint with the candidate's promised set so promised content/mode drift is detected.
    const promisedPaths = a.textOnly ? [] : a.files.filter((f) => f.kind === "promised" || f.kind === "missing-promised").map((f) => f.path);
    const current = this.fingerprintWorkspace(agentId, promisedPaths);
    if (a.textOnly !== current.textOnly) return false;
    if (a.textOnly) return a.textHash === current.textHash;
    if (a.baseCommit !== current.baseCommit) return false;
    if (a.files.length !== current.files.length) return false;
    const prev = new Map(a.files.map((f) => [f.path, `${f.mode}\0${f.hash}`]));
    return current.files.every((f) => prev.get(f.path) === `${f.mode}\0${f.hash}`);
  }

  async runCheck(agentId: AgentId, expectedTaskRunId: TaskRunId, check: NormalizedGateCheck): Promise<{ exitCode: number | null; output: string }> {
    const rt = this.agents.get(agentId);
    if (!rt) throw err("NOT_FOUND", `agent ${agentId} unknown`);
    const writable = rt.record.allocation.writableRoot;
    if (!writable) throw err("INVALID", "checks require a writer workspace");
    // Admission fence (before intent): expected run must still be current and nonterminal.
    // Already-dispatched checks keep their OLD binding (no logical cancellation of effects
    // without executor abort proof); NEW obsolete checks are prohibited here.
    // Valid STALE guard is preserved (throw, caught per-check as evidence, never silent execution on N).
    if (rt.record.currentTaskRunId !== expectedTaskRunId) throw err("STALE_GENERATION", "check targets a superseded task run");
    if (this.terminalRuns.has(expectedTaskRunId)) throw err("STALE_GENERATION", "check targets a terminal task run");
    if (this.gate.inspect(expectedTaskRunId)?.terminal) throw err("STALE_GENERATION", "check targets a terminal gated run");
    const result = await this.broker.runControllerCheck({
      agentId,
      taskRunId: expectedTaskRunId,
      generation: rt.record.executionGeneration,
      sandbox: this.sandboxOf(rt.record, [writable]),
      command: check.command,
      cwd: rt.record.allocation.workdir,
      timeoutMs: check.timeoutMs,
    });
    return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`.slice(0, RESULT_TEXT_MAX) };
  }

  // -- helpers -------------------------------------------------------------------------------

  private authorOf(caller: CallerId): AgentId | "governor" {
    return isGovernor(caller) ? "governor" : caller;
  }

  private resolveTarget(caller: CallerId, target: AgentId | "parent"): AgentId | "governor" {
    if (target !== "parent") return target;
    if (isGovernor(caller)) throw err("INVALID", "governor has no parent address");
    const rt = this.agents.get(caller);
    if (!rt) throw err("NOT_FOUND", `caller ${caller} unknown`);
    return rt.record.parentId ?? "governor";
  }

  /** Child-to-parent and owner-to-descendant only; siblings go through their owner. */
  private checkRoute(caller: CallerId, from: AgentId | "governor", to: AgentId | "governor"): void {
    if (to === "governor") {
      const sender = from === "governor" ? null : this.agents.get(from);
      if (!sender || sender.record.parentId !== null) throw err("FORBIDDEN", "only top-level agents address the governing session");
      return;
    }
    const toRt = this.agents.get(to);
    if (!toRt) throw err("NOT_FOUND", `target ${to} unknown`);
    // The protected reviewer is not messageable and messages no one.
    if (this.gate.isReviewer(to)) throw err("FORBIDDEN", "managed reviewer is not messageable");
    if (from !== "governor" && this.gate.isReviewer(from)) throw err("FORBIDDEN", "managed reviewer decides only through submit_gate_decision");
    if (isGovernor(caller)) return;
    if (from === to) throw err("FORBIDDEN", "cannot message self");
    const fromRt = this.agents.get(from as AgentId);
    if (!fromRt) throw err("NOT_FOUND", `sender ${from} unknown`);
    const isParent = fromRt.record.parentId === to;
    if (!isParent && !this.isDescendant(from as AgentId, to)) {
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
    // The protected reviewer has no independent lifecycle callers can drive.
    if (this.gate.isReviewer(record.id) && !isGovernor(caller)) throw err("FORBIDDEN", "managed reviewer is controlled by the gate only");
    if (isGovernor(caller)) return;
    if (this.gate.isReviewer(caller)) throw err("FORBIDDEN", "managed reviewer cannot control agents");
    if (caller === record.id || !this.isDescendant(caller, record.id)) {
      throw err("FORBIDDEN", "only the owner/governor controls this agent");
    }
  }

  private visibleTo(caller: CallerId, record: AgentRecord): boolean {
    if (isGovernor(caller)) return true;
    if (caller === record.id) return true;
    const self = this.agents.get(caller);
    if (!self) return false;
    if (record.id === self.record.parentId) return true; // parent visible
    return this.isDescendant(caller, record.id); // owned subtree visible
  }

  private childrenOf(parentId: AgentId): AgentRuntime[] {
    return [...this.agents.values()].filter((rt) => rt.record.parentId === parentId);
  }

  private recordConcerns(r: JournalRecord, agentId: AgentId): boolean {
    return r.body["agentId"] === agentId || r.body["from"] === agentId || r.body["to"] === agentId;
  }

  private viewOfRecord(r: JournalRecord): JournalEventView {
    return {
      seq: r.seq,
      kind: r.kind,
      agentId: (r.body["agentId"] as AgentId | undefined) ?? null,
      taskRunId: (r.body["taskRunId"] as TaskRunId | undefined) ?? null,
      summary: summarize(r.kind, r.body),
      at: r.at,
    };
  }

  private viewOf(rt: AgentRuntime): AgentView {
    const r = rt.record;
    let openQuestion: AgentView["openQuestion"] = null;
    for (const q of this.questions.values()) {
      if (q.from === r.id && !q.answered && !q.cancelled) openQuestion = { messageId: q.messageId, to: q.to, text: q.text.slice(0, 2000), deadlineAt: q.deadlineAt };
    }
    return {
      id: r.id,
      path: r.path,
      parentId: r.parentId,
      depth: r.depth,
      profile: r.profile,
      isolation: r.grants.isolation,
      workdir: r.allocation.workdir,
      model: r.model ? `${r.model.provider}/${r.model.id}` : "unresolved",
      observed: r.observed,
      pendingIntent: rt.activeRun?.interruptRequested === true ? "interrupt pending" : pendingIntentOf(rt),
      currentTaskRunId: r.currentTaskRunId,
      generation: r.executionGeneration,
      taskOutcome: r.taskOutcome,
      usage: { ...rt.usage },
      lastActivityAt: r.lastActivityAt,
      managedGateFor: this.gate.isReviewer(r.id) ? this.gate.managedTaskFor(r.id) : null,
      gateTaskRunId: rt.gateTaskRunId,
      openQuestion,
    };
  }

  /** GateHost: usage snapshot for budget admission. */
  rootUsage(): UsageTotals {
    return { ...this.cumulativeUsage };
  }
}

/** Checks run in, and promised outputs belong to, a writer workspace; text-only candidates have neither. */
function assertGateFits(spec: NormalizedGateSpec, writer: boolean): void {
  if (!writer && (spec.checks.length > 0 || spec.promisedOutputs.length > 0)) {
    throw err("INVALID", "gate checks and promised outputs need a writer workspace");
  }
}

/** Tool results returned to a child are bounded; a cut is always marked. */
const TOOL_RESULT_MAX = 24_000;
function boundedText(text: string): string {
  return text.length <= TOOL_RESULT_MAX ? text : `${text.slice(0, TOOL_RESULT_MAX)}\n[output truncated: ${text.length - TOOL_RESULT_MAX} more characters]`;
}

/** Usage as a worker reports it, or as the journal recorded it; `input` includes the cache tokens. */
interface UsageDetail {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number | null;
  cost?: number | null;
  unknown?: boolean;
}

function pendingIntentOf(rt: AgentRuntime): string {
  const r = rt.record;
  if (r.desiredLifecycle === "closed") return "closed";
  if (rt.quarantined) return "quarantined";
  if (rt.afterDescendants) return "joining descendants";
  if (r.taskPhase === "reviewing") return "reviewing";
  if (r.taskPhase === "review_queued") return "review queued";
  if (r.taskPhase === "repair_queued") return "repair queued";
  if (rt.queue.some((q) => !q.dispatched)) return "task queued";
  if (r.observed === "awaiting_parent") return "awaiting parent reply";
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
      return `${body["requestReply"] === true ? "question" : body["replyTo"] ? "reply" : `message ${String(body["mode"] ?? "")}`} ${String(body["from"] ?? "").slice(0, 8)}→${String(body["to"] ?? "").slice(0, 8)}`;
    case "tool.intent":
      return `tool ${String(body["tool"] ?? "")}${agent}`;
    case "agent.closed":
      return `closed${agent}`;
    default:
      return kind;
  }
}

export type { TaskOutcome };
