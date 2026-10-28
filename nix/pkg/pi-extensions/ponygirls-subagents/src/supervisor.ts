/**
 * ponygirls-subagents — supervisor: tree, policy, scheduler, journal.
 *
 * One supervisor owns one root session UUID. All descendants share atomic
 * runnable leases, worker capacity, open-agent limits, and budgets.
 * Model tools (governing and child), UI actions, and gate controls call the
 * same methods here; they never touch processes or files directly.
 *
 * Controller state transitions and their durable publication are serialized
 * so async handlers cannot independently finalize the same run. Each task
 * run has exactly one terminal outcome, keyed by its task-run id; joins and
 * replays read that map, never a window of the journal.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ToolBroker, type BrokerCaller, type CallerSandbox, type ToolExecutors } from "./broker.ts";
import { err } from "./errors.ts";
import type { Api, Model } from "@earendil-works/pi-ai";
import { parseParentModel, parseProviderRequestAuth, type ParentModels } from "./parent-models.ts";
import { GateController, fingerprintSummary, restoreGateSpec, type CandidateRecord, type GateDecisionInput, type GateFinding, type GateHost, type GateSpecInput, type GateTerminalOutcome, type NormalizedGateCheck, type NormalizedGateSpec, type NormalizedReviewerSpec, type ReviewFeedback, type ReviewSpecInput, type WorkspaceFingerprint } from "./gate.ts";
import { EMPTY_INSTRUCTIONS, instructionHash, parseSelection, selectInstructions } from "./instructions.ts";
import { ISOLATION_LEVELS } from "./types.ts";
import { authorizeWorkspace, intersectGrants, pathWithin, resolveAllowedConcrete, rootGrants, type RegisteredRepo, type SupervisorPolicy } from "./policy.ts";
import { GoverningToolDispatcher, type GoverningRegistry } from "./external-dispatcher.ts";
import { snapshotGoverningHandles } from "./governing-runtime.ts";
import type { DelegatedCall } from "./delegated-call.ts";
import { killAndConfirm, readProcessIdentity, verifyOwnership, type OwnershipVerdict, type ProcessIdentity } from "./process-identity.ts";
import { AdmissionScheduler, PathRegistry, type AgentCreationReservation, type LeaseTicket } from "./scheduler.ts";
import { BwrapToolExecutor, HostToolExecutor, sandboxRuntimePath } from "./sandbox.ts";
import { InMemoryRunStore, RootLock, checkpointSha256, fsyncDir, fsyncFile, type JournalKind, type JournalRecord, type ResultRef, type RunStore } from "./store.ts";
import { CHILD_CONTROL_TOOLS, DELEGATION_TOOLS, FILE_TOOLS, GATE_DECISION_TOOL, RESULT_TEXT_HARD_MAX, RESULT_TEXT_MAX, SHELL_TOOL, WRITE_TOOLS } from "./tools.ts";
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
  OperationId,
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
import { WorkerHandle, newWorkerBinding, type ToolPrepareRequest, type ToolPrepareResponse, type ToolRequest, type ToolResponse } from "./worker-launch.ts";
import { validateToolArguments } from "@earendil-works/pi-ai";
import type { Tool as AiTool, ToolCall as AiToolCall } from "@earendil-works/pi-ai";
import type { IpcEnvelope, ProviderAdmissionPayload, ProviderAdmissionResponse, WorkerEvent } from "./protocol.ts";
import { MAX_PAYLOAD_BYTES } from "./protocol.ts";
import { GitWorkspaceManager, encodeWorktreeLeaf, fingerprintWorktree, realDirectory, type CheckoutInfo, type WorkspaceManager, type WorktreeAllocation } from "./workspace.ts";

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
  /** Characters of final text retained per task run; omitted or null: RESULT_TEXT_MAX. At most RESULT_TEXT_HARD_MAX. */
  resultLimit?: number | null;
  /** Owner skills / context files the child receives; omitted or null: none. */
  skills?: ResourceSelection | null;
  contextFiles?: ResourceSelection | null;
  /** Explicit override; must be in the root allowlist. */
  model?: { provider: string; id: string; thinkingLevel?: string } | null;
  shell?: boolean;
  gate?: GateSpecInput | null;
  review?: ReviewSpecInput | null;
}

export type GateSpec = GateSpecInput;

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
  /** Governing-session tools (MCP etc) this agent may call besides its file/shell/control tools. */
  externalTools: string[];
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
  result: {
    taskRunId: string;
    outcome: string | null;
    /** One page of the retained text, starting at `offset`. */
    text: string;
    detail: string;
    /** Characters of final text retained for this task run. */
    totalLength: number;
    offset: number;
    /** Where the next page starts; null when this page ends the retained text. */
    nextOffset: number | null;
    /** True when the retained text is shorter than what the agent wrote (cut at `resultLimit`, or not handed over whole). */
    truncated: boolean;
    /** The agent's retention limit in characters. */
    resultLimit: number;
    /** Completed reviewer reports available through view=reviews. */
    reviewCount: number;
  } | null;
  events: JournalEventView[];
  cursor: number;
}

/** Which part of a result's retained text to return (characters); a null length means as much as fits one reply. */
export interface ResultPage {
  offset: number;
  length: number | null;
}

/**
 * A settled generation's final text as retained: the inline prefix (at most
 * RESULT_TEXT_MAX characters, journaled), and the store reference of the
 * whole retained text when that is longer.
 */
interface RetainedText {
  text: string;
  stored: ResultRef | null;
  /** Characters the agent wrote before any cut; null in journals that predate the count. */
  fullLength: number | null;
}

/** A final text as a worker handed it over, with its length before any cut. */
interface FinalText {
  text: string;
  fullLength: number;
}

const NO_FINAL_TEXT: FinalText = { text: "", fullLength: 0 };

/** Minimal worker port (real WorkerHandle or test fake). */
export interface WorkerPort {
  readonly instanceId: string;
  /** OS pid of the worker process, when backed by a real process. */
  readonly pid: number | null;
  launch(): Promise<void>;
  request(operation: string, payload: unknown, opts?: { taskRunId?: string; generation?: number; timeoutMs?: number }): Promise<unknown>;
  kill(): void;
  setEventHandler(h: (event: WorkerEvent) => void): void;
  setToolRequestHandler(h: (payload: ToolRequest, envelope?: { taskRunId?: string | null; executionGeneration?: number | null }) => Promise<ToolResponse>): void;
  setPrepareRequestHandler?(h: (payload: ToolPrepareRequest, envelope?: { taskRunId?: string | null; executionGeneration?: number | null }) => Promise<ToolPrepareResponse>): void;
  setTicketReleaseHandler?(h: (payload: { tickets: string[] }, envelope?: { taskRunId?: string | null; executionGeneration?: number | null }) => void): void;
  setProviderAdmissionRequestHandler?(h: (payload: ProviderAdmissionPayload, envelope: IpcEnvelope) => Promise<ProviderAdmissionResponse>): void;
  /** Abrupt process exit (crash, kill): the run it carried is lost. */
  setExitHandler(h: (info: { code: number | null; signal: string | null }) => void): void;
}

export type WorkerFactory = (opts: {
  agentId: AgentId;
  instanceId: string;
  rootEpoch: string;
}) => WorkerPort;

/**
 * Single-use prepared-arguments ticket minted by tool.prepare.
 *
 * Besides the prepared args it binds the underlying implementation
 * references (execute/prepare) and schema snapshot observed at preparation:
 * a same-name handle replacement or in-place mutation before execution —
 * even with an identical schema — fails verification instead of executing
 * the new impl under the old ticket.
 */
interface PreparedTicket {
  ticket: string;
  agentId: AgentId;
  tool: string;
  preparedArgs: Record<string, unknown>;
  taskRunId: string;
  generation: number;
  executeRef: unknown;
  prepareRef: unknown;
  paramsJson: string | null;
  description: unknown;
}

interface ActiveRun {
  taskRunId: TaskRunId;
  generation: number;
  interruptRequested: boolean;
}

interface AgentRuntime {
  record: AgentRecord;
  parentModel: Model<Api> | null;
  worker: WorkerPort | null;
  runnableLease: LeaseTicket | null;
  residentLease: LeaseTicket | null;
  queue: QueuedTask[];
  activeRun: ActiveRun | null;
  /** Latest terminal result (deliverable text kept apart from outcome detail). */
  lastResult: ({ taskRunId: TaskRunId; outcome: string; detail: string } & RetainedText) | null;
  /** Deliverable text of the latest settled generation (its inline prefix is the gate's candidate answer). */
  lastText: ({ taskRunId: TaskRunId } & RetainedText) | null;
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
  parentModels?: ParentModels;
  schedulerLimits?: { maxRunnable?: number; maxResidentWorkers?: number; maxOpenAgents?: number; maxDepth?: number };
  executors?: ToolExecutors;
  workspace?: WorkspaceManager;
  workerPath?: string;
  sdkRoot?: string | null;
  deterministic?: boolean;
  /** Host agent dir whose credential store workers open live (no copies). */
  hostAgentDir?: string;
  /** Live governing-session tool registry (revoked on reload/replacement/disposal). */
  governingRegistry?: () => GoverningRegistry | null;
  /** Governing-session extension preparation of delegated calls (see delegated-call.ts). */
  prepareDelegatedCall?: (call: DelegatedCall) => Promise<Record<string, unknown>> | null;
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
const QUESTION_TTL_MS = 15 * 60_000;
const INTERRUPT_TIMEOUT_MS = 15_000;
const CLOSE_JOIN_TIMEOUT_MS = 15_000;
const CHECKPOINT_TIMEOUT_MS = 15_000;
const FIND_ENTRY_TIMEOUT_MS = 10_000;
const IDLE_POLL_MS = 25;
/** Events a settlement wait reports (tool-level progress stays in activity waits and read_agent). */
const MATERIAL_EVENTS: ReadonlySet<string> = new Set(["task.terminal", "generation.settled", "mailbox.accepted", "mailbox.answered", "mailbox.question_expired", "agent.closed", "agent.interrupted", "gate.decision", "gate.review_failed", "task.phase"]);

function newRuntime(record: AgentRecord): AgentRuntime {
  return {
    record,
    parentModel: null,
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

/** Escape a recorded repo ID for literal use inside a leaf-match pattern. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class Supervisor implements GateHost {
  readonly rootId: string;
  readonly rootDir: string;
  private store: RunStore;
  private lock: RootLock;
  private policy!: SupervisorPolicy;
  private scheduler!: AdmissionScheduler;
  private paths = new PathRegistry();
  private broker!: ToolBroker;
  private workspace!: WorkspaceManager;
  private agents = new Map<AgentId, AgentRuntime>();
  private messages = new Map<MessageId, MailboxMessage>();
  private questions = new Map<MessageId, PendingQuestion>();
  /** Exactly one terminal outcome per task run. */
  private terminalRuns = new Map<TaskRunId, { agentId: AgentId; outcome: string }>();
  /** External operation IDs whose usage was already accounted (exactly-once). */
  private accountedExternalOps = new Set<string>();
  /**
   * Operation IDs reserved exactly once across native (broker) and external
   * (dispatcher) routes. Shared by reference into both; rehydrated from
   * journaled intents on attach so restarts keep denying duplicates.
   */
  private sharedOpIds = new Set<OperationId>();
  /** Prepared-arg tickets: single-use, bound to agent/tool/task/generation. */
  private preparedTickets = new Map<string, PreparedTicket>();
  private waiters: WaiterReg[] = [];
  /** Unfinished runs restored from the journal (no live worker). */
  private pendingLost = new Map<AgentId, { taskRunId: TaskRunId; generation: number; workerPid: number | null; workerBoot: ProcessIdentity | null }>();
  /** Every gate evaluation's conversation file, in start order. */
  private reviewSessions: ReviewSession[] = [];
  /** Deferred owner outcomes and failed terminal commits retained until recovery. */
  private pendingSettle = new Map<TaskRunId, { agentId: AgentId; outcome: string; error: string }>();
  private epoch!: string;
  private suspended = false;
  /**
   * Fresh-attach catch-up hit a persistence fault: the receipt stays
   * unbilled until an explicit recover() completes it. Throwing out of the
   * constructor would strand the just-acquired root lock with no supervisor
   * to release it, so the fault surfaces here (needsRecovery) and at the
   * next recover() instead.
   */
  private attachCatchUpNeeded = false;
  /**
   * Normal external-usage publication faults: the known OWN receipt stays
   * unbilled until explicit reconciliation commits it exactly once. The
   * journal retains the durable canonical receipt; this set only signals
   * the debt for health (needsRecovery) and admission gating. Cleared
   * solely by a successful billing commit — never by store healing alone.
   */
  private pendingExternalBilling = new Set<string>();
  /**
   * Retained late ORIGINAL-usage commits that failed persistence, keyed by
   * captured identity. Retried by recover(); non-empty holds admission
   * (debt) exactly like uncommitted external billing.
   */
  private pendingLateBilling = new Map<string, { agentId: string; taskRunId: string; generation: number; receiptId: string; usage: UsageDetail }>();
  /**
   * True once the root is shut down: the journal is no longer owned (store
   * closed, lock released). Receipt ownership fails closed here, while mere
   * suspension (recovery in progress) keeps ownership with the root.
   */
  private disposed = false;
  private gate!: GateController;
  private externalDispatcher!: GoverningToolDispatcher;
  private chain: Promise<void> = Promise.resolve();
  private cumulativeUsage: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null, cost: 0, unknown: false };
  // Definite-assignment: the constructor assigns these exactly once through
  // constructOwned (post-lease construction); `!` carries that invariant.
  private opts!: SupervisorOptions;
  private questionTtlMs!: number;
  private now!: () => string;

  constructor(options: SupervisorOptions) {
    this.rootId = options.rootId;
    this.rootDir = options.rootDir;
    mkdirSync(this.rootDir, { recursive: true });
    this.store = options.store ?? new InMemoryRunStore(options.rootId);
    this.lock = new RootLock(this.rootDir);
    const lockRes = this.lock.acquire();
    if (!lockRes.ok) throw lockRes.error;
    try {
      this.constructOwned(options);
    } catch (e) {
      // Construction failed after acquiring the root lease: release it so a
      // healed successor can acquire instead of stranding on our PID. The
      // original error is preserved; a cleanup failure surfaces combined
      // with it (never discarded, never swallowed).
      let cleanupError: unknown = null;
      try {
        this.lock.release();
      } catch (ce) {
        cleanupError = ce;
      }
      if (cleanupError !== null) {
        throw err(
          "STORE_FAILED",
          `supervisor construction failed (${(e as Error)?.message ?? e}); lease release also failed (${(cleanupError as Error)?.message ?? cleanupError})`,
        );
      }
      throw e;
    }
  }


  /** Post-lease construction: everything that can fail after the root lock is acquired. */
  private constructOwned(options: SupervisorOptions): void {
      this.policy = options.policy;
      this.scheduler = new AdmissionScheduler(options.schedulerLimits);
      const executors = options.executors ?? { sandbox: new BwrapToolExecutor(), host: new HostToolExecutor() };
      // Sandboxed jobs see the host runtime PATH (read-only, minus home and
      // setuid wrapper directories) so generated commands find their tools;
      // host jobs get the governing process's whole environment.
      const runtimePath = sandboxRuntimePath(process.env["PATH"] ?? "", homedir());
      const hostEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) hostEnv[k] = v;
      this.broker = new ToolBroker(executors, this.store, runtimePath, { PATH: [...runtimePath, "/usr/bin", "/bin"].join(":") }, hostEnv, this.sharedOpIds);
      this.externalDispatcher = new GoverningToolDispatcher(
        this.store,
        () => this.opts.governingRegistry?.() ?? null,
        async (caller, request) => {
          const res = await this.broker.execute(caller, request);
          return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode, timedOut: res.timedOut, truncated: res.truncated };
        },
        {
          authorizeLive: (agentId, tool, scope) => this.authorizeExternalLive(agentId, tool, scope),
          // Same actual root hold contract as NEW-task/check/native routes:
          // genuinely NEW nested effects deny while billing debt/attach
          // catch-up holds, even inside an already-admitted outer. Preparation
          // never passes here, so it stays available; already-admitted outer
          // settlement truthfully completes elsewhere.
          admissionHold: () => {
            const e = this.admissionHoldError();
            if (!e) return null;
            return { code: String((e as { code?: unknown }).code ?? "RECOVERY_OWNER_UNCONFIRMED"), message: String((e as Error).message).replace(/^[A-Z_]+: /, "") };
          },
          isValid: () => !this.suspended,
          // Receipt ownership survives suspension (recovery still owns the
          // journal) and fails closed only on genuine disposal/transfer.
          ownsJournal: () => !this.disposed,
          onUsage: (info) => this.accountExternalUsage(info),
          sharedIds: this.sharedOpIds,
          ...(options.prepareDelegatedCall !== undefined ? { prepareCall: options.prepareDelegatedCall } : {}),
        },
      );
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
    const reviewerLinks: Array<{ reviewerId: AgentId; taskRunId: TaskRunId; mainAgentId: AgentId | null }> = [];
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
      reviewerIds: AgentId[];
      feedback: ReviewFeedback[];
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
          const replayGrants = b["grants"] as GrantSet;
          if (replayGrants && !Array.isArray((replayGrants as GrantSet).externalTools)) {
            (replayGrants as GrantSet).externalTools = [];
          }
          const record: AgentRecord = {
            id: agentId,
            path,
            rootId: this.rootId,
            parentId: (b["parentId"] as string | null) ?? null,
            depth: (b["depth"] as number | undefined) ?? path.split("/").length - 2,
            profile: (b["profile"] as "reader" | "writer") ?? "reader",
            createdEntryId: (b["requestId"] as string) ?? "",
            nativeSessionPath: null,
            grants: replayGrants,
            // Journals written before prepared workspaces carry no flag: extension-made.
            allocation: { ...(b["allocation"] as WorkspaceAllocation), external: (b["allocation"] as { external?: unknown } | undefined)?.external === true },
            instructions: b["instructions"] as InstructionSet,
            instructionHash: instructionHash(b["instructions"] as InstructionSet),
            policyRevision: this.policy.revision,
            model: (b["model"] as ResolvedModel | null) ?? null,
            // Journals written before result limits existed retain the default.
            resultLimit: typeof b["resultLimit"] === "number" ? b["resultLimit"] : RESULT_TEXT_MAX,
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
            reviewerLinks.push({ reviewerId: agentId, taskRunId: (b["taskRunId"] as string) ?? "", mainAgentId: typeof b["mainAgentId"] === "string" ? b["mainAgentId"] : null });
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
            if (typeof b["text"] === "string") rt.lastText = { taskRunId: b["taskRunId"] as string, ...retainedFromRecord(b) };
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
            const retained: RetainedText = rt.lastText?.taskRunId === taskRunId
              ? { text: rt.lastText.text, stored: rt.lastText.stored, fullLength: rt.lastText.fullLength }
              : { text: (b["preview"] as string) ?? "", stored: null, fullLength: null };
            rt.lastResult = { taskRunId, outcome, detail: (b["detail"] as string) ?? "", ...retained };
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
            if (rt.lastText) rt.lastText = { ...rt.lastText, taskRunId: b["taskRunId"] as string };
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
          if (rt) {
            rt.record.pendingMessageIds.push(messageId);
            if (b["model"]) rt.record.model = b["model"] as ResolvedModel;
            // Acceptance owns task intent; task.queued is only a projection.
            // A crash between these appends must not lose the accepted run.
            if (message.mode === "task" && message.taskRunId !== null && !rt.queue.some((q) => q.id === message.taskRunId)) {
              rt.queue.push({ id: message.taskRunId, agentId: rt.record.id, messageId, text: message.text, createdAt: r.at, replaces: null, dispatched: false });
              rt.record.pendingTaskIds.push(message.taskRunId);
            }
          }
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
        case "agent.quarantined": {
          const rt = this.agents.get(b["agentId"] as string);
          if (rt && typeof b["reason"] === "string") rt.quarantined = b["reason"];
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
            spec: restoreGateSpec(b["spec"] as Parameters<typeof restoreGateSpec>[0]),
            rounds: 0,
            candidates: [],
            findings: [],
            lastResponse: "",
            repairCommandId: null,
            repairCriticism: null,
            linkedFrom: (b["linkedFrom"] as string | null) ?? null,
            reviewerId: (b["reviewerId"] as string | null) ?? null,
            reviewerIds: (b["reviewerIds"] as string[] | undefined) ?? (typeof b["reviewerId"] === "string" ? [b["reviewerId"]] : []),
            feedback: [],
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
            if (rt) {
              // The candidate is this run's settled generation: what was retained of it stays.
              const settled = rt.lastText?.taskRunId === b["taskRunId"] ? rt.lastText : null;
              rt.lastText = { taskRunId: b["taskRunId"] as string, text: draft.lastResponse, stored: settled?.stored ?? null, fullLength: settled?.fullLength ?? null };
            }
          }
          break;
        }
        case "gate.decision":
        case "gate.review_failed": {
          const draft = gates.get(b["taskRunId"] as string);
          if (draft) {
            const legacy = {
              schemaVersion: 1, candidateId: b["candidateId"], decision: b["decision"],
              blockers: b["blockers"] ?? [], advisories: b["advisories"] ?? [],
              reason: "blocked (legacy journal did not retain the reason)", missingPrerequisites: ["not retained"],
            } as GateDecisionInput;
            draft.feedback.push({
              round: (b["round"] as number | undefined) ?? draft.rounds,
              reviewerIndex: (b["reviewerIndex"] as number | undefined) ?? 0,
              reviewerId: (b["reviewerId"] as string | undefined) ?? draft.reviewerId ?? "",
              reviewId: b["reviewId"] as string, candidateId: b["candidateId"] as string,
              verdict: r.kind === "gate.review_failed" ? null : (b["verdict"] as GateDecisionInput | undefined) ?? legacy,
              error: (b["error"] as string | null) ?? null,
            });
            draft.findings = draft.feedback.filter((f) => f.round === draft.rounds).flatMap((f) => f.verdict?.decision === "revise" ? [...f.verdict.blockers, ...f.verdict.advisories] : f.verdict?.decision === "approve" ? f.verdict.advisories : []);
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
        reviewerIds: draft.reviewerIds,
        feedback: draft.feedback,
        evidence: draft.evidence,
        fingerprintHistory: history,
        stagnationWarning: stagnation,
      });
      const state = this.gate.inspect(taskRunId);
      if (draft.reviewerIds.length > 0) this.gate.restoreReview(taskRunId);
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
    for (const link of reviewerLinks) {
      const mainAgentId = link.mainAgentId ?? this.gate.inspect(link.taskRunId)?.agentId
        ?? [...this.agents.values()].find((rt) => rt.gateTaskRunId === link.taskRunId)?.record.id ?? null;
      this.gate.linkReviewer(link.reviewerId, link.taskRunId, mainAgentId);
    }
    for (const [taskRunId, draft] of gates) if (draft.reviewerIds.length === 0) this.gate.restoreReview(taskRunId);
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
    // Recover deferred owner outcomes; a gate may keep waiting only if its
    // current generation reached a resumable review or committed repair.
    for (const rt of this.agents.values()) {
      const cur = rt.record.currentTaskRunId;
      if (!cur || this.terminalRuns.has(cur) || this.pendingLost.has(rt.record.id) || rt.record.desiredLifecycle === "closed") continue;
      const gated = rt.gateTaskRunId === cur;
      const gate = gated ? this.gate.inspect(cur) : null;
      if (gate !== null && gate.candidate !== null && gate.candidate.generation === rt.record.executionGeneration && (gate.review !== null || gate.repairReserved)) continue;
      const settled = settledRuns.get(cur);
      if (settled && settled.agentId === rt.record.id) {
        const outcome = gated && settled.outcome === "succeeded" ? "interrupted" : settled.outcome;
        const error = gated ? "PROCESS_LOST: gated execution stopped before resumable review admission; no review inferred" : settled.error;
        this.pendingSettle.set(cur, { agentId: rt.record.id, outcome, error });
      }
    }
    for (const [taskRunId, draft] of gates) {
      const gate = this.gate.inspect(taskRunId);
      if (gate !== null && !gate.terminal && gate.linkedFrom !== null && gate.candidate === null) {
        this.pendingSettle.set(taskRunId, { agentId: draft.agentId, outcome: "interrupted", error: "PROCESS_LOST: linked review stopped before candidate publication" });
      }
    }
    this.scheduler.restoreSnapshot({ created: spawned, openAgentIds: [...this.agents.values()].filter((rt) => rt.record.desiredLifecycle === "open").map((rt) => rt.record.id) });
    // A discarded uncommitted tail means a previous owner may have acted on
    // appends that never committed: require one explicit recover() before
    // healthy continuation, reusing the attach flag (cleared by a completed
    // recovery exactly like a faulted attach catch-up). Journals without
    // such a tail attach cleanly.
    {
      let discarded = false;
      for (const r of records) {
        if (r.kind !== "recovery.event") continue;
        const phase = (r.body as Record<string, unknown>)["phase"];
        if (phase === "uncommitted_tail_discarded") discarded = true;
        else if (phase === "completed") discarded = false;
      }
      if (discarded) this.attachCatchUpNeeded = true;
    }
    // Durable narrowed grants: reload-time narrowing journaled as
    // agent.grants replays here so a restart reconstructs narrowed authority
    // instead of reviving the original spawned grants. Journals predating
    // the event (or malformed events) keep spawned grants: valid under the
    // current policy with no migration guessed.
    {
      const narrowed = new Map<AgentId, GrantSet>();
      for (const r of records) {
        if (r.kind !== "agent.grants") continue;
        const b = r.body as Record<string, unknown>;
        const agentId = b["agentId"];
        const grants = b["grants"];
        if (typeof agentId !== "string" || typeof grants !== "object" || grants === null) continue;
        const g = grants as Record<string, unknown>;
        if (!Array.isArray(g["tools"]) || !Array.isArray(g["externalTools"])) continue;
        narrowed.set(agentId, grants as GrantSet);
      }
      for (const [agentId, grants] of narrowed) {
        const rt = this.agents.get(agentId);
        if (rt) rt.record.grants = grants;
      }
    }
    // Fresh-attach catch-up: known durable receipts (outcomes/late events
    // carrying own usage without a committed usage.reported) bill here, so
    // a fresh supervisor with nothing pending still accounts exactly once
    // with no manual recover required. No-op on fully-billed journals. A
    // persistence fault here must not throw out of the constructor (that
    // would strand the root lock): flag explicit recovery instead.
    try {
      this.catchUpExternalUsage(records);
    } catch {
      this.attachCatchUpNeeded = true;
    }
    // Exactly-once accounting across restarts: usage already journaled in
    // external tool outcomes must not be re-accounted on replay. Duplicate
    // fencing likewise rebuilds from journaled intents (memory-only otherwise).
    {
      const seen: string[] = [];
      for (const r of records) {
        if (r.kind !== "tool.intent") continue;
        const op = (r.body as Record<string, unknown>)["operationId"];
        if (typeof op === "string") seen.push(op);
      }
      this.externalDispatcher.rehydrateSeen(seen);
      for (const id of seen) this.sharedOpIds.add(id);
    }
    // NOTE: accountedExternalOps is intentionally NOT rebuilt from tool
    // outcomes here. Dedupe keys on committed usage.reported records only
    // (completed below by the recovery catch-up); an outcome carrying usage
    // without a usage.reported means accounting never committed and must
    // complete instead of zeroing.
    // Durable late-usage obligations (usage_late.pending without a matching
    // committed usage.reported) rebuild into memory here, so a restart
    // after a failed late commit restores both the payloads and the debt
    // hold. Pure read plus memory fill; cannot fail past a readable journal.
    this.rebuildLateObligations(records);
  }

  // -- lifecycle -----------------------------------------------------------

  /**
   * Root session shutdown: cancel owned tool jobs and stop workers. Durable
   * state is preserved; runs left active are reconciled by recover() on the
   * next attach, like any other lost run.
   */
  async shutdown(): Promise<void> {
    this.suspended = true;
    // Retire broker journal ownership up front: detached late paths from
    // this owner (abort settlements, receipt flushes) must not append
    // behind whoever acquires the root next. cancelJobs records below are
    // unaffected (direct, pre-close appends).
    this.toolBroker.dispose();
    return this.serialized(async () => {
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.resolve(this.waitResult(waiter, false, "cancelled", []));
      }
      for (const rt of this.agents.values()) {
        rt.leaseWaitCancel?.();
        rt.leaseWaitCancel = null;
        await this.broker.cancelJobs(rt.record.id);
        await this.externalDispatcher.fenceAgent(rt.record.id, "root shutdown; effect unconfirmed");
        this.purgePreparedTickets(rt.record.id);
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
      this.disposed = true;
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

  get governingDispatcher(): GoverningToolDispatcher {
    return this.externalDispatcher;
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

  /**
   * Why NEW model/task admission is currently held, or null when healthy.
   * Centralized fail-closed gate for EFFECT-time inference starts
   * (continueStartup, deliverRun); scheduling paths park instead of
   * throwing. Cancellation, recovery, control, reviewer, and gate-check
   * routes never consult it. A bare needsRecovery flag alone implies
   * nothing about health — only these concrete states gate admission.
   */
  private admissionHoldError(): ReturnType<typeof err> | null {
    if (this.suspended || this.disposed) {
      return err("NOT_RUNNING", "root suspended: no new model inference during recovery/shutdown");
    }
    if (this.attachCatchUpNeeded || this.pendingExternalBilling.size > 0 || this.pendingLateBilling.size > 0) {
      return err("RECOVERY_OWNER_UNCONFIRMED", "admission held: known billing not yet committed; explicit recovery required");
    }
    if (this.toolBroker.hasPendingReceipts()) {
      return err("STORE_FAILED", "journal holds uncommitted fault receipts; explicit recovery required");
    }
    return null;
  }

  /**
   * True when the journal holds runs that recover() must reconcile first,
   * a fresh-attach catch-up hit a persistence fault (explicit recovery
   * required instead of a silent unbilled attach), known external billing
   * is uncommitted (explicit reconciliation required instead of an
   * unbilled budget obligation), or the broker retains undelivered fault
   * receipts. Observable while idle, with no new tool call required.
   */
  get needsRecovery(): boolean {
    return this.pendingLost.size > 0 || this.pendingSettle.size > 0 || this.attachCatchUpNeeded || this.pendingExternalBilling.size > 0 || this.pendingLateBilling.size > 0 || this.toolBroker.hasPendingReceipts();
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
      this.evaluateWaiters();
      this.opts.onChange?.();
    } catch {
      // A failing store or observer cannot recursively report its own failure.
    }
  }

  private notifyChanged(): void {
    this.evaluateWaiters();
    try {
      this.opts.onChange?.();
    } catch (error) {
      this.reportFailure(error);
    }
  }

  private publish(kind: JournalKind, body: Record<string, unknown>): JournalRecord {
    const record = this.store.append(kind, body);
    this.notifyChanged();
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
    return rt.afterDescendants !== null || [...this.pendingSettle.values()].some((pending) => pending.agentId === rt.record.id) || p === "candidate_recording" || p === "review_queued" || p === "reviewing" || p === "repair_queued";
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
      // Admission hold: no new agents while held (billing uncommitted,
      // retained faults, or suspend/dispose) — before capacity or records.
      const spawnHold = this.admissionHoldError();
      if (spawnHold !== null) throw spawnHold;
      // Validate everything before charging capacity or creating anything.
      if (!params.taskName || !params.message) throw err("INVALID", "spawn requires taskName and message");
      if (params.profile !== "reader" && params.profile !== "writer") throw err("INVALID", "profile must be reader/writer");
      const parentRt = isGovernor(caller) ? null : this.agents.get(caller);
      if (!isGovernor(caller) && !parentRt) throw err("NOT_FOUND", `caller ${caller} unknown`);
      if (!isGovernor(caller) && this.gate.isReviewer(caller)) throw err("FORBIDDEN", "managed reviewer cannot delegate");
      if (parentRt && parentRt.record.desiredLifecycle === "closed") throw err("CLOSED", "caller is closed");
      if (params.gate && params.review) throw err("INVALID", "pass gate or review, not both");
      if (parentRt && (params.gate || params.review)) throw err("FORBIDDEN", "only the governing session configures reviews");
      const depth = parentRt ? parentRt.record.depth + 1 : 1;
      // Root-approved concrete external names at this edge (re-resolved live;
      // runtime updates never widen already-admitted children silently).
      const rootConcrete = this.governingExternalConcrete();
      const ownerGrants = parentRt ? parentRt.record.grants : rootGrants(this.policy, rootConcrete);
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
      const resultLimit = params.resultLimit ?? RESULT_TEXT_MAX;
      if (!Number.isInteger(resultLimit) || resultLimit < RESULT_TEXT_MAX || resultLimit > RESULT_TEXT_HARD_MAX) {
        throw err("INVALID", `result_limit must be an integer from ${RESULT_TEXT_MAX} to ${RESULT_TEXT_HARD_MAX} characters`);
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
      }, this.governingExternalConcrete());
      if (!granted.ok) throw granted.error;
      // The controller excludes its own writers during review.
      if (parentRt && this.isPhaseLocked(parentRt) && params.profile === "writer") {
        throw err("CONFLICT", "owner workspace is locked for review; writers excluded until review ends");
      }
      const model = this.resolveChildModel(parentRt, params.model ?? null);
      if (this.opts.parentModels !== undefined) this.opts.parentModels.describe(model);
      const gateSpec = params.gate ? this.gate.validateSpec(params.gate) : params.review ? this.gate.validateSpec(params.review, "review") : null;
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

      // Reserve the complete panel before creating any workspace or identity.
      const identities = 1 + (gateSpec ? gateSpec.reviewers.length : 0);
      const charged = this.scheduler.reserveAgentCreation(identities);
      if (!charged.ok) {
        const reusable = [...this.agents.values()].filter((rt) => (isGovernor(caller) || (rt.record.id !== caller && this.isDescendant(caller, rt.record.id))) && this.canReuseSettled(rt));
        const switchable = reusable.filter((rt) => this.hasCurrentCheckpoint(rt));
        const switchAdvice = switchable.length > 0
          ? `Explicit model switching requires root allowlist approval; checkpoint-ready ids: ${switchable.map((rt) => rt.record.id).join(", ")}.`
          : "No checkpoint-ready model switch is available; retain workers/history and resolve checkpoint recovery before switching.";
        const recovery = gateSpec
          ? "The requested gate/review requires fresh managed reviewer identities; ordinary settled-agent reuse cannot replace this panel. Review delegation unavailable; do not bypass the requested review."
          : reusable.length > 0
            ? `Reuse a settled open agent with send_message mode=task using the same retained model (ids: ${reusable.map((rt) => rt.record.id).join(", ")}). ${switchAdvice}`
            : "Delegation unavailable now: no safely reusable settled open agent; wait for owned work to settle and inspect list_agents, otherwise report delegation unavailable before solo fallback.";
        throw err(charged.code, `${charged.message}. ${recovery} close_agent releases open-agent capacity after subtree cleanup; the governor may close any descendant, including nested agents. Closed identities cannot resume; history, worktrees, and cumulative usage remain. Closing does not resolve uncertain or background-owned effects.`, { capacity: "open_agents", ...this.scheduler.snapshot(), reusableAgentIds: gateSpec ? [] : reusable.map((rt) => rt.record.id), modelSwitchAgentIds: gateSpec ? [] : switchable.map((rt) => rt.record.id) });
      }
      const agentId = randomUUID();
      let resident: LeaseTicket | null = null;
      try {
        resident = this.acquireResident(agentId);
        if (!resident) {
          throw err("CAPACITY_EXCEEDED", "resident worker capacity saturated (not open-agent exhaustion); wait for running workers/checkpoints to settle so idle workers can be evicted automatically; closing an agent also releases its capacity but does not resolve uncertain or background-owned effects");
        }
        // Bind the concrete workspace after grant intersection. A nested
        // writer gets its own worktree; parent mounts are never an allowlist.
        const allocation = this.bindWorkspace(agentId, params.profile, isolation, { ownerWorkdir, checkout, prepared, reg: reg ?? null, baseCommit: params.baseCommit ?? null, instructions });
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
          resultLimit,
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
          resultLimit,
          gated: gateSpec !== null,
        });
        this.scheduler.commitAgentCreation(charged.reservation, agentId);
        const rt = newRuntime(record);
        rt.residentLease = resident;
        this.agents.set(agentId, rt);
        if (parentRt) parentRt.record.activeDescendants++;
        this.store.recordCommand(requestId, spawnedRecord);
        record.lastEventSeq = spawnedRecord.seq;
        if (gateSpec) {
          // Every panel identity exists before the main agent is dispatched.
          rt.gateTaskRunId = taskRunId;
          const reviewerIds = gateSpec.reviewers.map((spec, index) => this.createManagedReviewer(agentId, taskRunId, spec, index, charged.reservation));
          this.gate.register(agentId, taskRunId, gateSpec, params.message, reviewerIds);
        }
        try {
          await this.startWorker(rt, params.message);
        } catch (e) {
          this.startupFailed(rt, taskRunId, e as Error);
          throw e;
        }
        return { agentId, path, taskRunId, generation: 1, profile: params.profile, isolation, workdir: allocation.workdir, status: record.observed };
      } finally {
        this.scheduler.cancelAgentCreation(charged.reservation);
        if (!this.scheduler.isAgentOpen(agentId)) {
          if (resident !== null) this.scheduler.release(resident);
          this.paths.release(path);
        }
      }
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
    // The pool namespace new worktree allocations land under, carried from
    // the allocator wrapper (present for pooled allocations only, keeping
    // default records byte-identical).
    const birthPool = (wt: WorktreeAllocation): { poolRoot: string } | Record<string, never> =>
      wt.poolRoot != null ? { poolRoot: wt.poolRoot } : {};
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
      return { kind: "writer", workdir: wt.worktreePath, readRoots, writableRoot: wt.worktreePath, git: { workTree: wt.worktreePath, gitDir: wt.gitDir, baseCommit: wt.baseCommit }, repoId: from.reg.repoId, tmpDir, external: false, ...birthPool(wt) };
    }
    const checkout = from.checkout!;
    const wt = this.allocateWorktree(basename(checkout.workTree), checkout.workTree, from.baseCommit, ", or use isolation none to edit the checkout in place");
    const workdir = join(wt.worktreePath, relative(checkout.workTree, from.ownerWorkdir));
    if (!existsSync(workdir)) {
      this.workspace.releaseAllocation(wt, { prune: true });
      throw err("CONFLICT", `working directory ${relative(checkout.workTree, from.ownerWorkdir)} does not exist at the worktree's base commit`);
    }
    return { kind: "writer", workdir, readRoots: [], writableRoot: wt.worktreePath, git: { workTree: wt.worktreePath, gitDir: wt.gitDir, baseCommit: wt.baseCommit }, repoId: null, tmpDir, external: false, ...birthPool(wt) };
  }

  /**
   * Writer-worktree destination: the default session home, or the pooled
   * `<worktreeRoot>/<sessionId>/worktrees` layout when configured.
   * Session/log/IPC/tmp dirs stay under rootDir; saved allocations keep
   * their recorded paths. An invalid or unwritable destination fails
   * visibly here (never a silent home fallback).
   */
  private worktreesDir(): string {
    const custom = this.policy.worktreeRoot;
    if (custom == null) return join(this.rootDir, "worktrees");
    if (!isAbsolute(custom) || custom.includes("\0")) {
      throw err("INVALID", "worktreeRoot must be null or an absolute path");
    }
    return join(custom, this.rootId, "worktrees");

  }

  /** A writer worktree from a committed base; a dirty checkout needs an explicit base. */
  private allocateWorktree(label: string, checkoutPath: string, baseCommit: string | null, alternative: string): WorktreeAllocation {
    const wt = this.workspace.allocateWriter(label, checkoutPath, baseCommit ?? "HEAD", this.worktreesDir());
    if (wt.baseDirty && !baseCommit) {
      // Actionable precondition: an agreed committed base is required.
      this.workspace.releaseAllocation(wt, { prune: true });
      throw err("CONFLICT", `checkout has uncommitted changes; supply an explicit base_commit, commit first${alternative}`);
    }
    // Pin the allocation-time physical namespace: the fresh worktree
    // exists, so canonicalize it once — later alias removal/retarget
    // cannot misdirect recorded paths — and derive the exact pool from
    // the canonical destination. Anything else fails visibly here.
    let canonical: string;
    try {
      canonical = realpathSync(wt.worktreePath);
    } catch (e) {
      // Rollback is load-bearing: a failed cleanup stays publicly
      // observable alongside the primary canonical error, never swallowed.
      throw err("WORKSPACE_UNAVAILABLE", `allocated worktree cannot be resolved: ${(e as Error).message}${this.releaseQuietly(wt)}`);
    }
    if (this.policy.worktreeRoot == null) return { ...wt, worktreePath: canonical };
    const canonicalDest = dirname(canonical);
    const tail = `${sep}${this.rootId}${sep}worktrees`;
    if (!canonicalDest.endsWith(tail) || canonicalDest.length <= tail.length) {
      throw err("WORKSPACE_UNAVAILABLE", `allocated worktree outside the session shard: ${canonical}${this.releaseQuietly({ ...wt, worktreePath: canonical })}`);
    }
    return { ...wt, worktreePath: canonical, poolRoot: canonicalDest.slice(0, canonicalDest.length - tail.length) };
  }

  /**
   * Best-effort startup rollback through the public release path (exactly
   * once, with pruning). Success contributes nothing; a cleanup failure
   * is returned as a joined suffix so it stays publicly observable next
   * to the primary error instead of being swallowed.
   */
  private releaseQuietly(allocation: WorktreeAllocation): string {
    try {
      this.workspace.releaseAllocation(allocation, { prune: true });
    } catch (cleanupError) {
      return `; workspace cleanup also failed: ${(cleanupError as Error).message}`;
    }
    return "";
  }

  /**
   * Root-approved concrete external names at this moment: the governing
   * registry's current callable names filtered by policy allowlist patterns.
   * Empty when unbound (deny-by-default); re-resolved at every edge and at
   * execution so runtime updates cannot widen admitted authority silently.
   */
  private governingExternalConcrete(): string[] {
    const registry = this.opts.governingRegistry?.() ?? null;
    if (!registry || !registry.isActive()) return [];
    const names = registry.listHandles().map((h) => h.name);
    return resolveAllowedConcrete(names, this.policy.allowedTools ?? []);
  }

  /**
   * Live external authorization immediately before effects: current binding,
   * worker identity, active task/generation, current root/owner grants.
   * Captured caller grants alone are never sufficient (policy may narrow,
   * generations supersede, bindings revoke).
   */
  private authorizeExternalLive(
    agentId: AgentId,
    tool: string,
    scope: { taskRunId: string | null; generation: number | null },
  ): { ok: true } | { ok: false; code: string; message: string } {
    // Global pause: while suspended (recovery) or disposed (shutdown), no
    // NEW external/direct/nested/native/prep admission — before intents and
    // effects, immediately, independent of per-agent fence iteration. A
    // retained broker fault receipt pauses admissions the same way until it
    // is delivered. Effect validity ends here; receipt ownership (durable
    // late billing while the journal is owned) is separate and stays open.
    // Cancel, fence, reconcile, reviewer-settle, control, and gate-check
    // routes never pass through this function, so recovery itself is never
    // blanket-stopped.
    if (this.suspended || this.disposed) {
      return { ok: false, code: "NOT_RUNNING", message: "root suspended: no new admissions during recovery/shutdown" };
    }
    if (this.toolBroker.hasPendingReceipts()) {
      return { ok: false, code: "STORE_FAILED", message: "journal holds uncommitted fault receipts; explicit recovery required" };
    }
    const rt = this.agents.get(agentId);
    if (!rt) return { ok: false, code: "NOT_FOUND", message: `agent ${agentId} unknown` };
    if (rt.record.desiredLifecycle === "closed") return { ok: false, code: "CLOSED", message: "agent is closed" };
    const run = rt.activeRun;
    if (!run) return { ok: false, code: "STALE_GENERATION", message: "no admitted execution" };
    if (scope.taskRunId === null || scope.taskRunId === undefined || scope.taskRunId !== run.taskRunId) {
      return { ok: false, code: "STALE_GENERATION", message: "task run superseded" };
    }
    if (scope.generation === null || scope.generation === undefined || scope.generation !== run.generation) {
      return { ok: false, code: "STALE_GENERATION", message: "execution generation superseded" };
    }
    if (run.interruptRequested) return { ok: false, code: "NOT_RUNNING", message: "the generation is being interrupted" };
    const registry = this.opts.governingRegistry?.() ?? null;
    if (!registry || !registry.isActive()) {
      return { ok: false, code: "STALE_GENERATION", message: "governing session binding revoked" };
    }
    if (this.gate.isReviewer(agentId)) {
      if (tool !== GATE_DECISION_TOOL && !(FILE_TOOLS as readonly string[]).includes(tool)) {
        return { ok: false, code: "POLICY_DENIED", message: `tool ${tool} is not available to a reviewer` };
      }
      return { ok: true };
    }
    // Live-owner chain: current root + caller + every live ancestor intersect
    // at EVERY edge, immediately before prep/effects. A reloaded owner that
    // lost the tool revokes already-admitted descendants too (no immutable
    // child grandfathering); restoring the root registry never silently
    // restores an already-revoked owner. Centralized here so preparation,
    // direct handles, and nested invocation share one authority.
    const ownerChain = this.checkLiveOwnerChain(rt, tool);
    if (!ownerChain.ok) return ownerChain;
    // Shared live identity/scope checks above; tool-specific authority below.
    // Native file/shell tools route to the child broker (child workdir and
    // isolation); they are authorized against CURRENT native grants here so
    // narrowing (reload) revokes nested/direct calls immediately.
    if (([...FILE_TOOLS, ...WRITE_TOOLS, SHELL_TOOL] as readonly string[]).includes(tool)) {
      if (!rt.record.grants.tools.includes(tool)) {
        return { ok: false, code: "POLICY_DENIED", message: `tool ${tool} not granted to caller` };
      }
      return { ok: true };
    }
    if (rt.record.grants.isolation === "sandbox") {
      return { ok: false, code: "POLICY_DENIED", message: `tool ${tool} unavailable in sandbox isolation` };
    }
    // Current root-concrete (not captured): narrowing revokes immediately.
    const current = new Set(this.governingExternalConcrete());
    if (!current.has(tool)) {
      return { ok: false, code: "POLICY_DENIED", message: `tool ${tool} is not currently available` };
    }
    if (!(rt.record.grants.externalTools ?? []).includes(tool)) {
      return { ok: false, code: "POLICY_DENIED", message: `tool ${tool} not granted to caller` };
    }
    return { ok: true };
  }

  /**
   * Walk the caller's live owner chain (parent links) and require every
   * ancestor to still hold the tool in its CURRENT grants: native names in
   * `grants.tools`, external names in `grants.externalTools`. The governor
   * (parentId null) ends the walk — root authority arrives via the
   * root-concrete check, not a record. Missing or closed ancestors fail
   * visible: a call must never execute on a severed chain. Deny-only: this
   * never grants sandbox or any other capability, it only revokes.
   */
  private checkLiveOwnerChain(
    callerRt: { record: { parentId: AgentId | null } },
    tool: string,
  ): { ok: true } | { ok: false; code: string; message: string } {
    const native = ([...FILE_TOOLS, ...WRITE_TOOLS, SHELL_TOOL] as readonly string[]).includes(tool);
    let parentId = callerRt.record.parentId;
    while (parentId !== null && parentId !== undefined) {
      const ancestor = this.agents.get(parentId);
      if (!ancestor) {
        return { ok: false, code: "POLICY_DENIED", message: `live owner ${parentId} unknown; authority for ${tool} cannot be verified` };
      }
      if (ancestor.record.desiredLifecycle === "closed") {
        return { ok: false, code: "POLICY_DENIED", message: `live owner ${parentId} is closed; authority for ${tool} retired` };
      }
      const held = native
        ? ancestor.record.grants.tools.includes(tool)
        : (ancestor.record.grants.externalTools ?? []).includes(tool);
      if (!held) {
        return { ok: false, code: "POLICY_DENIED", message: `live owner ${parentId} no longer grants ${tool}` };
      }
      parentId = ancestor.record.parentId;
    }
    return { ok: true };
  }

  /**
   * Per-invocation OWN external usage (normal and late completions alike).
   * Accounted exactly once per invocation under its immutable originating
   * identity — never under a newer task the agent may have started since.
   * Model-generation totals stay separate. Totals are derived by summing
   * these receipts, each once; no aggregate is ever stored as an own report.
   */
  private accountExternalUsage(info: {
    operationId: string;
    agentId: AgentId;
    usage: unknown;
    originTaskRunId: string | null;
    originGeneration: number | null;
    late: boolean;
  }): void {
    if (this.suspended) return;
    if (this.accountedExternalOps.has(info.operationId)) return;
    const usage = normalizeExternalUsage(info.usage);
    if (!usage) return;
    // Counters/dedupe follow the SUCCESSFUL usage.reported persistence commit
    // only: a genuine pre-append store fault must leave live totals and the
    // op unmarked so recovery catch-up retries exactly once. Compute the
    // commit payload without side effects, append, then increment. A
    // persistence fault surfaces through the observable project error
    // channel (recovery.event), never as a throw past the dispatcher
    // (which would be an unhandled rejection). The durable canonical receipt
    // (outcome/recovery.event usage from rawOwnUsage) enables the retry.
    // A PUBLIC observer exception AFTER the commit (evaluateWaiters/onChange)
    // must NOT strand debt or skip accounting: the report is already durable,
    // so counters/dedupe clear exactly once and only the notification fault
    // stays observable. Same-instance recovery must never leave live totals
    // missing an already-committed 5/7 or a false permanent hold.
    const accounted = {
      input: usage.input ?? 0,
      output: usage.output ?? 0,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      cost: typeof usage.cost === "number" ? usage.cost : null,
      unknown: usage.unknown === true,
    };
    try {
      this.store.append("usage.reported", {
        agentId: info.agentId,
        taskRunId: info.originTaskRunId,
        generation: info.originGeneration,
        ...accounted,
        external: true,
        operationId: info.operationId,
        late: info.late,
      });
    } catch (e) {
      // Genuine pre-append persistence failure: the known OWN receipt is
      // unbilled, so new effects must wait for explicit reconciliation (no
      // fail-open admission against the debt). Counters/dedupe stay untouched.
      this.pendingExternalBilling.add(info.operationId);
      this.reportFailure(e);
      return;
    }
    const rt = this.agents.get(info.agentId) ?? null;
    this.accountUsage(rt, usage);
    this.accountedExternalOps.add(info.operationId);
    this.pendingExternalBilling.delete(info.operationId);
    try {
      this.evaluateWaiters();
      this.opts.onChange?.();
    } catch (e) {
      // Observer-only fault after a durable commit: already accounted exactly
      // once above, so never re-add debt or undo counters. Stay observable.
      this.reportFailure(e);
    }
  }

  /** External definitions (preserved schemas/descriptions) for worker exposure. */
  private externalDefinitions(names: readonly string[]): Array<{ name: string; description: string; parameters: unknown; outputSchema?: unknown }> {
    const registry = this.opts.governingRegistry?.() ?? null;
    if (!registry || !registry.isActive()) return [];
    const out: Array<{ name: string; description: string; parameters: unknown; outputSchema?: unknown }> = [];
    for (const name of names) {
      const handle = registry.getHandle(name);
      if (!handle) continue;
      out.push({
        name: handle.name,
        description: handle.description,
        parameters: handle.parameters,
        ...((handle as { outputSchema?: unknown }).outputSchema !== undefined ? { outputSchema: (handle as { outputSchema?: unknown }).outputSchema } : {}),
      });
    }
    return out;
  }

  /** Cancel all in-flight external (governing-runtime) work. */
  private async cancelAllExternal(): Promise<void> {
    for (const rt of this.agents.values()) {
      try {
        await this.externalDispatcher.cancelJobs(rt.record.id);
      } catch {
        // best effort on teardown
      }
    }
  }

  /** Tool-call authority of an agent's active run, derived from the authenticated channel. */
  private brokerCaller(rt: AgentRuntime): BrokerCaller {
    const record = rt.record;
    const alloc = this.effectiveAllocation(record);
    return {
      agentId: record.id,
      taskRunId: rt.activeRun?.taskRunId ?? null,
      generation: rt.activeRun?.generation ?? null,
      grants: record.grants,
      workdir: alloc.workdir,
      writableRoot: alloc.writableRoot,
      sandbox: this.sandboxOf({ ...record, allocation: alloc }, alloc.readRoots, this.reviewerCandidateOf(record)),
    };
  }

  /**
   * Sandbox view inputs, or null for host isolation. The whole root store
   * (journal, sessions, sibling workspaces) and the host credential store
   * are absent from tool views as soft legacy hides; approved paths beneath
   * them are bound again. Pooled writer-worktree roots travel as hard
   * storage namespaces instead (see SandboxView.storageRoots): sibling and
   * other-session pooled worktrees stay masked even when an approved read
   * root equals the pool or nests under it, while the child's own writable
   * worktree is bound again afterwards (storage masks precede the
   * writableRoot bind). A supervisor-selected read-only exception
   * (readOnlyRoots) re-exposes exactly the candidate/own workspace for
   * managed reviewers and controller checks — never an arbitrary approved
   * read root, never writer permission. Retained allocations keep their
   * exclusion across reconfigures (see pooledHideRoots): changing the
   * option never unhides a recorded pool.
   */
  private sandboxOf(record: AgentRecord, readRoots: string[], readOnlyRoots: string[] = []): CallerSandbox | null {
    if (record.grants.isolation !== "sandbox") return null;
    return {
      readRoots,
      tmpDir: record.allocation.tmpDir,
      hidePaths: [this.rootDir, ...(this.opts.hostAgentDir ? [this.opts.hostAgentDir] : [])],
      ...(readOnlyRoots.length > 0 ? { readOnlyRoots } : {}),
      storageRoots: this.pooledHideRoots(),
    };
  }

  /**
   * The exact writer workspace a managed reviewer validates, if any: the
   * main agent owning this reviewer through the gate, narrowed to its
   * current writableRoot. Ordinary agents (including sandbox readers) get
   * no exception. The path is bound read-only after the storage masks; the
   * reviewer's tool grants stay read-only, so this confers no writer
   * permission — only visibility of the single candidate worktree.
   */
  private reviewerCandidateOf(record: AgentRecord): string[] {
    for (const rt of this.agents.values()) {
      if (rt.record.id === record.id) continue;
      if (this.gate.reviewersOf(rt.record.id).includes(record.id)) {
        const w = this.effectiveAllocation(rt.record).writableRoot;
        return typeof w === "string" && w.length > 0 ? [w] : [];
      }
    }
    return [];
  }

  /**
   * Pool namespaces to mask from sandbox tool views: the currently
   * configured root plus every pooled root represented by retained
   * allocations. Saved allocations keep their recorded absolute paths (no
   * migration, no relocation). Every record first passes through
   * effectiveAllocation: stable namespaces stand as recorded, while
   * alias-involved ones are proven to their physical target through the
   * persisted git administration identity (or fail visibly). Display
   * surfaces (AgentView) intentionally keep showing the recorded path.
   * Precedence per retained workspace:
   * 1. the recorded allocation-time pool namespace when present;
   * 2. the exact default namespace (`<rootDir>/worktrees`), still on the
   *    store hide;
   * 3. otherwise, the namespace anchored on the recorded repo ID: the
   *    terminal old-form `wt-<repoId>-<commit>-<unique>` leaf (repo IDs
   *    match literally, slashes and dots included) stripped off, with the
   *    remainder required to end in `/<sessionId>/worktrees`;
   * 4. otherwise, for repo ID-less records, ONLY actual host-worktree
   *    allocations prove a pool, distinguished by the persisted admission
   *    fact (grants isolation "worktree"): kind writer with git, a safe
   *    flat leaf, and a parent dir ending in `/<sessionId>/worktrees`.
   *    Isolation "none" in-place workdirs contribute NO mask even when
   *    namespace-looking. Anything else is an explicitly unknown retained
   *    shape, which fails visibly instead of guessing a broad parent or
   *    unhiding the pool.
   */
  private pooledHideRoots(): string[] {
    const roots = new Set<string>();
    const current = this.policy.worktreeRoot;
    if (current != null) {
      roots.add(current);
      const resolved = this.resolvePoolTarget(current, "worktreeRoot");
      if (resolved !== null && resolved !== current) roots.add(resolved);
    }
    const homeWorktrees = join(this.rootDir, "worktrees");
    const sessionTail = `${sep}${this.rootId}${sep}worktrees`;
    for (const rt of this.agents.values()) {
      // Ephemeral effective paths: alias-involved retained namespaces are
      // proven to their physical target (or fail visibly); everything
      // else passes through byte-identical. The journal is never rewritten.
      const alloc = this.effectiveAllocation(rt.record);
      const w = alloc?.writableRoot;
      if (alloc === null || alloc === undefined || typeof w !== "string" || w.length === 0) continue;
      // 1. Recorded or proven allocation-time namespace.
      if (alloc.poolRoot != null) {
        roots.add(alloc.poolRoot);
        const resolved = this.resolvePoolTarget(alloc.poolRoot, "retained worktree pool");
        if (resolved !== null && resolved !== alloc.poolRoot) roots.add(resolved);
        continue;
      }
      // 2. Exact default namespace: the store hide covers it.
      if (dirname(w) === homeWorktrees) continue;
      // 3. Old-form leaf anchored on the recorded repo ID.
      const repoId = alloc.repoId;
      if (repoId === null || repoId === undefined) {
        // 4. Repo ID-less records: ONLY actual host-worktree allocations
        // prove a pool, distinguished by the persisted admission fact
        // (grants isolation "worktree") — kind/git/basename merely look
        // physical, and isolation "none" can legitimately carry git with
        // a namespace-looking parent. Anything else is an in-place
        // workdir (owner working directory, never pooled storage) and
        // is skipped.
        if (rt.record.grants?.isolation !== "worktree") continue;
        if (alloc.kind !== "writer" || alloc.git === null || alloc.git === undefined) continue;
        const leafName = basename(w);
        if (leafName === "" || leafName === "." || leafName === "..") {
          throw err("WORKSPACE_UNAVAILABLE", `retained workspace has an unrecognized shape and cannot be masked safely: ${w}`);
        }
        const parentDir = dirname(w);
        if (parentDir === homeWorktrees) continue;
        if (!parentDir.endsWith(sessionTail) || parentDir.length <= sessionTail.length) continue;
        const hosted = parentDir.slice(0, parentDir.length - sessionTail.length);
        roots.add(hosted);
        const hostedResolved = this.resolvePoolTarget(hosted, "retained worktree pool");
        if (hostedResolved !== null && hostedResolved !== hosted) roots.add(hostedResolved);
        continue;
      }
      const leaf = new RegExp(`\/wt-${escapeRegExp(repoId)}-[0-9a-f]{12}-\\d+$`);
      const match = leaf.exec(w);
      if (match === null) {
        throw err("WORKSPACE_UNAVAILABLE", `retained workspace has an unrecognized shape and cannot be masked safely: ${w}`);
      }
      const destDir = w.slice(0, w.length - match[0].length);
      if (destDir === homeWorktrees) continue;
      if (!destDir.endsWith(sessionTail) || destDir.length <= sessionTail.length) {
        throw err("WORKSPACE_UNAVAILABLE", `retained workspace has an unrecognized shape and cannot be masked safely: ${w}`);
      }
      const lexical = destDir.slice(0, destDir.length - sessionTail.length);
      roots.add(lexical);
      const resolved = this.resolvePoolTarget(lexical, "retained worktree pool");
      if (resolved !== null && resolved !== lexical) roots.add(resolved);
    }
    return [...roots];
  }

  /**
   * Ephemeral effective allocation for confinement and tool-routing
   * decisions. The journal record is never rewritten or migrated. Retained
   * pooled namespaces carrying git administration identity ALWAYS prove
   * physical provenance through it (below) or fail visibly — never silently
   * unhide. Directory existence and stable resolution certify nothing by
   * themselves for worktree bindings: a recreated leaf under a replaced
   * alias both exists and resolves stably while addressing bytes the record
   * never owned. Rows without recorded git identity have no
   * out-of-namespace anchor to prove against; their containment rests on
   * the stable pool path itself (alias confusion without a worktree
   * binding cannot divert them elsewhere), so they keep the stable
   * existence behavior. Display surfaces (AgentView) intentionally keep
   * showing the recorded path; observe both sides, never assume they match.
   */
  private effectiveAllocation(record: AgentRecord): WorkspaceAllocation {
    const alloc = record.allocation;
    if (alloc === null || alloc === undefined) return alloc;
    const w = alloc.writableRoot;
    if (typeof w !== "string" || w.length === 0) return alloc;
    const pool = alloc.poolRoot != null ? alloc.poolRoot : this.deriveLexicalPool(record);
    if (pool === null) return alloc;
    if (this.isStablePath(pool)) {
      const g = alloc.git;
      const hasGitIdentity = g !== null && g !== undefined && typeof g.gitDir === "string" && g.gitDir.length > 0;
      // Existence-only certification is removed exactly where an identity
      // exists to check: a recorded git administration must prove, even
      // when the leaf exists and the namespace resolves stably.
      if (!hasGitIdentity && existsSync(w)) return alloc;
      return this.proveRetainedWorkspace(record, alloc);
    }
    return this.proveRetainedWorkspace(record, alloc);
  }

  /** True when a path resolves to itself (no alias involved, exists). */
  private isStablePath(p: string): boolean {
    try {
      return realpathSync(p) === p;
    } catch {
      return false;
    }
  }

  /**
   * Candidate pool namespace for a retained workspace, or null when no
   * pooled masking applies (exact default namespace, in-place workdir).
   * Throws visibly on malformed retained shapes. Pure string logic over
   * recorded fields; filesystem resolution happens in the caller.
   */
  private deriveLexicalPool(record: AgentRecord): string | null {
    const alloc = record.allocation;
    const w = alloc?.writableRoot;
    if (alloc === null || alloc === undefined || typeof w !== "string" || w.length === 0) return null;
    const homeWorktrees = join(this.rootDir, "worktrees");
    if (dirname(w) === homeWorktrees) return null;
    const sessionTail = `${sep}${this.rootId}${sep}worktrees`;
    const repoId = alloc.repoId;
    if (repoId === null || repoId === undefined) {
      if (record.grants?.isolation !== "worktree") return null;
      if (alloc.kind !== "writer" || alloc.git === null || alloc.git === undefined) return null;
      const leafName = basename(w);
      if (leafName === "" || leafName === "." || leafName === "..") {
        throw err("WORKSPACE_UNAVAILABLE", `retained workspace has an unrecognized shape and cannot be masked safely: ${w}`);
      }
      const parentDir = dirname(w);
      if (parentDir === homeWorktrees) return null;
      if (!parentDir.endsWith(sessionTail) || parentDir.length <= sessionTail.length) return null;
      return parentDir.slice(0, parentDir.length - sessionTail.length);
    }
    const leaf = new RegExp(`\/wt-${escapeRegExp(repoId)}-[0-9a-f]{12}-\\d+$`);
    const match = leaf.exec(w);
    if (match === null) {
      throw err("WORKSPACE_UNAVAILABLE", `retained workspace has an unrecognized shape and cannot be masked safely: ${w}`);
    }
    const destDir = w.slice(0, w.length - match[0].length);
    if (destDir === homeWorktrees) return null;
    if (!destDir.endsWith(sessionTail) || destDir.length <= sessionTail.length) {
      throw err("WORKSPACE_UNAVAILABLE", `retained workspace has an unrecognized shape and cannot be masked safely: ${w}`);
    }
    return destDir.slice(0, destDir.length - sessionTail.length);
  }

  /**
   * Prove the physical workspace behind a retained pooled namespace
   * through the persisted git administration identity, and return the
   * effective allocation naming the proven paths. The admin dir recorded
   * at creation names the worktree's gitfile; that file must point back
   * at the admin dir (bidirectional), name the recorded leaf, and sit in
   * a session shard. Any missing link or mismatch fails visibly - an
   * unprovable namespace never silently unhides.
   */
  private proveRetainedWorkspace(record: AgentRecord, alloc: WorkspaceAllocation): WorkspaceAllocation {
    const w = alloc.writableRoot as string;
    const fail = (why: string): Error =>
      err("WORKSPACE_UNAVAILABLE", `retained workspace identity unprovable and cannot be masked safely (${why}): ${w}`);
    const g = alloc.git;
    if (g === null || g === undefined || typeof g.gitDir !== "string" || g.gitDir.length === 0) throw fail("no git administration identity");
    const admin = g.gitDir;
    let backRaw: string;
    try {
      backRaw = readFileSync(join(admin, "gitdir"), "utf8");
    } catch {
      throw fail("administration backlink unreadable");
    }
    const back = backRaw.trim();
    // An emptied backlink names no worktree at all: reject here rather
    // than resolving an empty path against the process working directory.
    if (back.length === 0) throw fail("administration backlink empty");
    const gitSuffix = `${sep}.git`;
    const wt = back.endsWith(gitSuffix) ? back.slice(0, back.length - gitSuffix.length) : back;
    let fwdRaw: string;
    try {
      fwdRaw = readFileSync(join(wt, ".git"), "utf8");
    } catch {
      throw fail("worktree pointer unreadable");
    }
    const m = /^gitdir: (.+)$/m.exec(fwdRaw);
    if (m === null) throw fail("worktree pointer malformed");
    let fwdAdmin: string;
    let wtReal: string;
    let adminReal: string;
    try {
      fwdAdmin = realpathSync(m[1].trim());
      wtReal = realpathSync(wt);
      adminReal = realpathSync(admin);
    } catch {
      throw fail("pointer unresolvable");
    }
    if (fwdAdmin !== adminReal) throw fail("pointer mismatch");
    // Complete retained leaf (see provenRetainedLeaf): the recorded path
    // must name the identical full leaf, and the physical destination
    // behind it must sit in this session's shard. The immediate parent
    // alone would misread a mid-leaf directory as the pool namespace.
    const leaf = this.provenRetainedLeaf(record, w, wtReal, fail);
    const destDir = wtReal.slice(0, wtReal.length - leaf.length);
    const tail = `${sep}${this.rootId}${sep}worktrees`;
    if (!destDir.endsWith(tail) || destDir.length <= tail.length) throw fail("shard mismatch");
    const provenPool = destDir.slice(0, destDir.length - tail.length);
    // Persisted workspace identity: a resolvable recorded worktree must be
    // the proven workspace. A vanished namespace (removed alias) resolves
    // nothing and stays governed by the backlink-plus-leaf proof above;
    // any other resolution failure fails visibly instead of guessing.
    if (typeof g.workTree !== "string" || g.workTree.length === 0) throw fail("workspace mismatch");
    let recordedTree: string | null = null;
    try {
      recordedTree = realpathSync(g.workTree);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw fail("workspace unresolvable");
      // A vanished namespace (removed alias) resolves nothing: acceptable
      // only when the recorded worktree IS the original allocation path.
      // An unresolvable DIFFERENT path is a wrong identity, not a
      // removed namespace, and is rejected even though it is missing.
      if (g.workTree !== w) throw fail("workspace mismatch");
    }
    if (recordedTree !== null && recordedTree !== wtReal) throw fail("workspace mismatch");
    // Birth commit identity: pinned rows name the allocated leaf's commit
    // infix and it still resolves as a commit object in the proven
    // repository. A legitimately advanced HEAD keeps its unchanged birth
    // commit and passes. Unpinned ("HEAD") rows never recorded a hash:
    // birth is proven live (HEAD resolves now), not pinned. A forged or
    // missing commit fails visibly.
    if (g.baseCommit === "HEAD") {
      if (!this.birthCommitResolves(adminReal, "HEAD")) throw fail("commit unresolvable");
    } else {
      const infix = /-([0-9a-f]{12})-\d+$/.exec(leaf)?.[1] ?? "";
      if (infix === "" || g.baseCommit.slice(0, 12) !== infix) throw fail("commit mismatch");
      if (!this.birthCommitResolves(adminReal, g.baseCommit)) throw fail("commit unresolvable");
    }
    const rel = relative(w, alloc.workdir);
    if (rel === ".." || rel.startsWith(`..${sep}`)) throw fail("workdir outside workspace");
    return { ...alloc, workdir: join(wtReal, rel), writableRoot: wtReal, git: { ...g, workTree: wtReal }, poolRoot: provenPool };
  }

  /**
   * The complete allocation leaf of a proven physical worktree path.
   * Historical producers encoded slash repo IDs verbatim, so the leaf can
   * span several path components (`wt-<repoId>-<commit>-<unique>`, slashes
   * included): derive the full suffix from the recorded repo ID against
   * the proven path, and require the recorded path to name the identical
   * leaf. Repo ID-less legacy records only prove a single-component
   * current-form leaf. Anything else is unprovable, never guessed.
   */
  private provenRetainedLeaf(record: AgentRecord, w: string, wtReal: string, fail: (why: string) => Error): string {
    const repoId = record.allocation.repoId;
    if (typeof repoId === "string" && repoId.length > 0) {
      // Historical and unpinned forms share the shape; only the commit
      // infix differs (12-hex hash, or HEAD for allocations recorded
      // without a pinned base). The recorded and proven paths must name
      // the identical full leaf — never guessed, never migrated.
      const historical = new RegExp(`\/wt-${escapeRegExp(repoId)}-(?:[0-9a-f]{12}|HEAD)-\\d+$`);
      const physical = historical.exec(wtReal);
      const recorded = historical.exec(w);
      if (physical !== null && recorded !== null && physical[0] === recorded[0]) return physical[0];
      // Current-encoder single-component form (genuine a04-era hashed
      // unsafe IDs; identical to the historical form for safe IDs,
      // returned above): the basename must round-trip through the
      // supported encoder for the exact recorded ID — hash, commit
      // infix, and counter alike. Anything else is unprovable.
      const base = basename(wtReal);
      const current = /^wt-h-([0-9a-f]{32})-([0-9a-f]{12})-(\d+)$/.exec(base);
      if (current !== null && base === basename(w) && encodeWorktreeLeaf(repoId, current[2]!, current[3]!) === base) {
        return `${sep}${base}`;
      }
      throw fail("leaf mismatch");
    }
    const base = basename(wtReal);
    if (!/^wt-(?:(?!\.{1,2}-)[A-Za-z0-9._-]{1,64}|h-[0-9a-f]{32})-(?:[0-9a-f]{12}|HEAD)-\d+$/.test(base) || base !== basename(w)) {
      throw fail("leaf mismatch");
    }
    return `${sep}${base}`;
  }

  /**
   * The birth commit still resolves as a commit object through the proven
   * administration dir. Host git runs hardened (no hooks/fsmonitor, no
   * inherited GIT_* overrides, no object locks); any failure — missing
   * binary, unreadable repo, unknown object — is unprovable, not absent.
   */
  private birthCommitResolves(adminReal: string, baseCommit: string): boolean {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
    }
    env["GIT_OPTIONAL_LOCKS"] = "0";
    const r = spawnSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "--git-dir", adminReal, "cat-file", "-e", `${baseCommit}^{commit}`],
      { env, encoding: "utf8", timeout: 30_000 },
    );
    return r.error === undefined && r.status === 0;
  }

  /**
   * Canonical host target of a pool path, resolved before namespace
   * assembly. Returns null only when the path is genuinely gone (ENOENT /
   * ENOTDIR); any other resolution failure (permissions, loops) throws
   * visibly instead of silently unhiding. existsSync is deliberately not
   * used as a pre-check: it reports EACCES as absent, which would convert
   * an unsafe but valid scope into a silent skip.
   */
  private resolvePoolTarget(pool: string, what: string): string | null {
    try {
      return realpathSync(pool);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "ENOENT" || code === "ENOTDIR") return null;
      throw err("WORKSPACE_UNAVAILABLE", `${what} ${pool} cannot be resolved for sandbox masking: ${(e as Error).message}`);
    }
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
    const model = rt.record.model;
    rt.parentModel = null;
    if (this.opts.parentModels !== undefined && model !== null) {
      const descriptor = this.opts.parentModels.describe(model);
      if (descriptor !== null) rt.parentModel = parseParentModel(descriptor, model);
    }
    const worker = this.makeWorker(rt.record.id);
    rt.worker = worker;
    rt.record.residency = "loaded";
    worker.setEventHandler((event) => {
      this.detached(() => {
        if (rt.worker === worker) this.onWorkerEvent(rt, event);
      });
    });
    worker.setToolRequestHandler(async (payload, envelope) => this.onToolRequest(rt, worker, payload, envelope));
    worker.setPrepareRequestHandler?.(async (payload, envelope) => this.onPrepareRequest(rt, worker, payload, envelope));
    worker.setTicketReleaseHandler?.((payload, envelope) => this.onTicketRelease(rt, worker, payload, envelope));
    // Narrow per-request provider admission: available during hold so it can
    // return a denial (model inference itself is never exempt control).
    worker.setProviderAdmissionRequestHandler?.(async (payload, envelope) => this.onProviderAdmission(rt, worker, payload, envelope));
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
    // Reviewers hold only read tools + gate decision (never external).
    if (this.gate.isReviewer(rt.record.id)) return [...FILE_TOOLS, GATE_DECISION_TOOL];
    const tools: string[] = [...FILE_TOOLS];
    if (rt.record.profile === "writer" && rt.record.allocation.writableRoot) tools.push(...WRITE_TOOLS);
    if (rt.record.grants.shell) tools.push(SHELL_TOOL);
    tools.push(...CHILD_CONTROL_TOOLS);
    if (rt.record.grants.nesting && rt.record.depth < rt.record.grants.maxDepth) tools.push(...DELEGATION_TOOLS);
    // Host isolation only: sandbox never gains parent external capabilities.
    // Intersected at exposure AND re-checked at execution (no silent widening).
    if (rt.record.grants.isolation !== "sandbox") {
      const current = new Set(this.governingExternalConcrete());
      for (const name of rt.record.grants.externalTools ?? []) {
        if (current.has(name) && !tools.includes(name)) tools.push(name);
      }
    }
    return tools;
  }

  private initPayload(rt: AgentRuntime, taskText: string | null, workdir: string): Record<string, unknown> {
    const tools = this.childTools(rt);
    // Preserved parent schemas/descriptions for external proxies (no generic catchall).
    const externalDefs = this.externalDefinitions(
      tools.filter((name) => (rt.record.grants.externalTools ?? []).includes(name)),
    );
    return {
      taskText,
      profile: rt.record.profile,
      instructionHash: rt.record.instructionHash,
      instructions: rt.record.instructions,
      model: rt.record.model,
      ...(rt.parentModel !== null ? { providerModel: rt.parentModel } : {}),
      taskRunId: rt.record.currentTaskRunId,
      executionGeneration: rt.record.executionGeneration,
      workdir,
      readRoots: rt.record.allocation.readRoots,
      writable: rt.record.profile === "writer",
      tools,
      resultLimit: rt.record.resultLimit,
      externalTools: externalDefs,
      restore: rt.pendingRestore,
    };
  }

  private workdirOf(rt: AgentRuntime): string {
    return this.effectiveAllocation(rt.record).workdir;
  }

  /** Launch the worker process and accept initial input (runnable lease held). */
  private async continueStartup(rt: AgentRuntime, taskText: string): Promise<void> {
    const record = rt.record;
    // Effect-time admission gate: no new model inference while held
    // (suspended/disposed, uncommitted billing, or retained faults).
    // Throws into startupFailed: a visible failed terminal, never silent
    // inference and never an unowned run.
    const startupHold = this.admissionHoldError();
    if (startupHold) throw startupHold;
    record.observed = "starting";
    let worker: WorkerPort;
    try {
      worker = await this.launchWorker(rt);
    } catch (e) {
      this.releaseRunnable(rt);
      throw e;
    }
    // Effect-time re-check AFTER the launch await: a public shutdown or
    // recover that landed mid-launch holds the root now, so the worker
    // must not be prompted. A pre-call guard cannot cover a future async
    // send unconditionally; the boundary checked here is the actual
    // initialize send below. Cleanup touches only what this startup owns
    // (fresh worker, runnable lease); the queued task stays observable via
    // startupFailed, never silently dropped and never reported successful.
    const postLaunchHold = this.admissionHoldError();
    if (postLaunchHold) {
      this.releaseRunnable(rt);
      rt.worker = null;
      worker.kill();
      record.residency = "unloaded";
      throw postLaunchHold;
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
    // Late ORIGINAL-usage receipts bypass both the generation fence and
    // the reviewer early-return below: they carry their own captured
    // (agent, task, generation) identity, and losing them merely to a
    // current-generation transition (or reviewer status) would silently
    // drop recoverable billing. Ordinary and reviewer workers alike.
    if (event.kind === "usage_late") {
      const record = rt.record;
      record.lastActivityAt = this.now();
      this.intakeLateUsage(rt, event.detail as Record<string, unknown> | undefined);
      return;
    }
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
        this.finalizeGeneration(rt, String(event.detail["status"] ?? "failed"), this.finalText(rt, event.detail), String(event.detail["error"] ?? ""), event.detail["usage"] as UsageDetail | undefined);
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
      const cancelledExt = await this.externalDispatcher.cancelJobs(rt.record.id);
      this.purgePreparedTickets(rt.record.id);
      const totalCancelled = cancelled.length + cancelledExt.length;
      // Known usage up to the last tool call, plus an unknown remainder.
      // Fence remaining external work now (durable uncertainty + scope
      // retirement; control-quiescent afterwards, effects still unknown —
      // a later task may proceed after terminal UNCERTAIN in host scope).
      await this.externalDispatcher.fenceAgent(rt.record.id, "worker exited; effect unconfirmed");
      this.finalizeGeneration(rt, totalCancelled > 0 ? "uncertain" : "failed", NO_FINAL_TEXT, why, { ...(rt.usageSnapshot ?? {}), unknown: true });
    }
    rt.record.detail = why;
    this.releaseResident(rt);
  }

  /** Drop prepared tickets for an agent (interrupt/close/exit/reload/shutdown). */
  private purgePreparedTickets(agentId: AgentId): void {
    for (const [id, ticket] of this.preparedTickets) {
      if (ticket.agentId === agentId) this.preparedTickets.delete(id);
    }
  }

  /**
   * Preparation-only RPC: run the parent's prepareArguments + public schema
   * validation WITHOUT executing, and mint a single-use ticket binding the
   * prepared args to this caller/task/generation. Fenced exactly like
   * execution (binding, instance, task/generation, interrupt, allowlist,
   * live grants). Only successful preparations journal an intent
   * (prepareOnly); denials/failures record nothing and mint nothing.
   */
  private async onPrepareRequest(
    rt: AgentRuntime,
    worker: WorkerPort,
    payload: ToolPrepareRequest,
    envelope?: { taskRunId?: string | null; executionGeneration?: number | null },
  ): Promise<ToolPrepareResponse> {
    const record = rt.record;
    if (rt.worker !== worker || !rt.activeRun) return { ok: false, error: "STALE_INSTANCE: no admitted execution for this worker" };
    if (!envelope || envelope.taskRunId == null || envelope.executionGeneration == null) {
      return { ok: false, error: "STALE_GENERATION: preparation requires an authenticated task run and generation" };
    }
    if (envelope.taskRunId !== rt.activeRun.taskRunId || envelope.executionGeneration !== rt.activeRun.generation) {
      return { ok: false, error: "STALE_GENERATION: task run superseded" };
    }
    if (rt.activeRun.interruptRequested) return { ok: false, error: "NOT_RUNNING: the generation is being interrupted" };
    if (!this.childTools(rt).includes(payload.tool)) {
      return { ok: false, error: `POLICY_DENIED: tool ${payload.tool} is not available to this agent` };
    }
    if (this.gate.isReviewer(record.id)) {
      return { ok: false, error: `POLICY_DENIED: tool ${payload.tool} is not available to a reviewer` };
    }
    if (record.grants.isolation === "sandbox") {
      return { ok: false, error: `POLICY_DENIED: tool ${payload.tool} unavailable in sandbox isolation` };
    }
    const live = this.authorizeExternalLive(record.id, payload.tool, { taskRunId: rt.activeRun.taskRunId, generation: rt.activeRun.generation });
    if (!live.ok) return { ok: false, error: `${live.code}: ${live.message}` };
    const registry = this.opts.governingRegistry?.() ?? null;
    const parent = registry?.isActive() === true ? registry.getHandle(payload.tool) : undefined;
    if (!parent) return { ok: false, error: `POLICY_DENIED: tool ${payload.tool} unavailable in the governing session` };
    if (typeof payload.args !== "object" || payload.args === null || Array.isArray(payload.args)) {
      return { ok: false, error: "INVALID: tool args must be an object" };
    }
    // Admitted references captured BEFORE any preparation: a same-object
    // in-place execute/prepare swap during preparation must deny, while a
    // fresh stable SDK wrapper clone (same underlying refs + metadata/schema)
    // still mints normally. Re-authorized immediately before effects
    // (ticket verification + dispatcher wrapLive); never trust an arbitrary
    // fifth ctx or a post-preparation refetch alone.
    const admittedExecute = (parent as { execute?: unknown }).execute;
    const admittedPrepare = (parent as { prepareArguments?: unknown }).prepareArguments;
    let admittedParamsJson: string | null = null;
    try {
      admittedParamsJson = JSON.stringify(parent.parameters ?? null);
    } catch {
      return { ok: false, error: `POLICY_DENIED: tool ${parent.name} schema not serializable` };
    }
    const admittedDescription = parent.description;
    // Parent preparation (may be sync or async, may throw) then PUBLIC schema
    // validation — the same order the agent loop applies. Nothing executes
    // here. Validation RETURNS the normalized clone (coercions/optional-null
    // normalization applied); the ticket caches/sends that actual validated
    // value, never the raw original, with the MODEL schema intact.
    // Parent preparation is sync (public prepareArguments contract) then
    // PUBLIC schema validation — the same order the agent loop applies.
    // Validation RETURNS the normalized clone; the ticket caches/sends that
    // actual validated value with the MODEL schema intact (native parity:
    // {n:'3'}->{n:3}, {n:null}->{n:0} for required number; oneOf/anyOf
    // entirely via the public validator, no DIY parsing). Nothing executes.
    let prepared: unknown;
    try {
      prepared = parent.prepareArguments !== undefined ? parent.prepareArguments(payload.args) : payload.args;
    } catch (e) {
      return { ok: false, error: `INVALID: preparation failed: ${(e as Error).message}` };
    }
    try {
      const validated = validateToolArguments(
        { name: parent.name, description: parent.description, parameters: parent.parameters } as unknown as AiTool,
        { type: "toolCall", id: `prepare:${payload.toolCallId}`, name: parent.name, arguments: prepared } as unknown as AiToolCall,
      );
      prepared = validated;
    } catch (e) {
      return { ok: false, error: `INVALID: ${(e as Error).message}` };
    }
    // A prepared value that cannot cross the worker IPC channel must fail
    // HERE, visibly, before minting: the worker would reject the oversize
    // response without ever learning the ticket id, orphaning a full
    // args/refs entry no release can reference. No ticket, no intent.
    let preparedJson: string;
    try {
      preparedJson = JSON.stringify(prepared ?? {});
    } catch {
      return { ok: false, error: `INVALID: prepared arguments not serializable` };
    }
    if (Buffer.byteLength(preparedJson, "utf8") > MAX_PAYLOAD_BYTES - PREPARE_RESPONSE_HEADROOM_BYTES) {
      return { ok: false, error: `PAYLOAD_TOO_LARGE: prepared arguments exceed ${MAX_PAYLOAD_BYTES - PREPARE_RESPONSE_HEADROOM_BYTES} bytes; split the content into smaller writes/edits` };
    }
    // Re-resolve before minting and always compare underlying refs +
    // metadata/schema regardless of object identity: a preparation blocked
    // (or slow) across a revocation must not mint against a stale handle.
    const current = registry !== null && registry.isActive() ? registry.getHandle(parent.name) : undefined;
    if (
      !current ||
      (current as { execute?: unknown }).execute !== admittedExecute ||
      (current as { prepareArguments?: unknown }).prepareArguments !== admittedPrepare ||
      current.description !== admittedDescription
    ) {
      return { ok: false, error: `POLICY_DENIED: tool ${parent.name} implementation changed during preparation` };
    }
    let currentParamsJson: string | null = null;
    try {
      currentParamsJson = JSON.stringify(current.parameters ?? null);
    } catch {
      return { ok: false, error: `POLICY_DENIED: tool ${parent.name} schema not serializable` };
    }
    if (currentParamsJson !== admittedParamsJson) {
      return { ok: false, error: `POLICY_DENIED: tool ${parent.name} schema changed during preparation` };
    }
    const ticket = randomUUID();
    this.preparedTickets.set(ticket, {
      ticket,
      agentId: record.id,
      tool: parent.name,
      preparedArgs: (prepared ?? {}) as Record<string, unknown>,
      taskRunId: rt.activeRun.taskRunId,
      generation: rt.activeRun.generation,
      executeRef: admittedExecute,
      prepareRef: admittedPrepare,
      paramsJson: admittedParamsJson,
      description: admittedDescription,
    });
    this.store.append("tool.intent", {
      operationId: ticket,
      agentId: record.id,
      taskRunId: rt.activeRun.taskRunId,
      generation: rt.activeRun.generation,
      tool: parent.name,
      external: true,
      prepareOnly: true,
      parentOperationId: null,
    });
    return { ok: true, ticket, preparedArgs: (prepared ?? {}) as Record<string, unknown> };
  }

  /** Best-effort release of unconsumed prepared tickets. Never throws. */
  private onTicketRelease(
    rt: AgentRuntime,
    worker: WorkerPort,
    payload: { tickets: string[] },
    _envelope?: { taskRunId?: string | null; executionGeneration?: number | null },
  ): void {
    if (rt.worker !== worker) return;
    for (const id of payload.tickets) {
      const ticket = this.preparedTickets.get(id);
      if (ticket && ticket.agentId === rt.record.id) this.preparedTickets.delete(id);
    }
  }

  /**
   * Narrow per-request provider admission (fail-closed permission query).
   * Authoritative execution-time hold check: root debt/suspended/disposed/
   * retained-fault semantics match existing admissionHoldError (a bare
   * needsRecovery boolean alone is never authorization). Fences: channel
   * worker instance, live owner/current run, envelope task/generation,
   * operative selected original model identity (exact physical provider/id;
   * thinking level must match the admitted record — SDK normalization
   * applies after the route returns, never as substitution here).
   * Forged/stale/cross-task requests denied visibly. Available during hold
   * so it can return a denial; model inference itself is never exempt.
   * Denial surfaces as a visible typed SDK routing error (task failure);
   * retry/new prompt requires genuine successful recovery (no transparent
   * parking, no auto-resume on healed storage, nothing swallowed).
   */
  private async onProviderAdmission(rt: AgentRuntime, worker: WorkerPort, payload: ProviderAdmissionPayload, envelope: IpcEnvelope): Promise<ProviderAdmissionResponse> {
    const admission = this.checkProviderAdmission(rt, worker, payload, envelope);
    if (!admission.ok || rt.parentModel === null || payload.reason !== "auth") return admission;
    const source = this.opts.parentModels;
    if (source === undefined) return { ok: false, code: "MODEL_UNAVAILABLE", error: "parent model authentication source is unavailable" };
    try {
      const result = await source.resolveAuth(rt.parentModel);
      // Auth can refresh asynchronously; close/recovery/reuse must fence the reply too.
      const current = this.checkProviderAdmission(rt, worker, payload, envelope);
      if (!current.ok) return current;
      if (!result.ok) return { ok: false, code: "MODEL_UNAVAILABLE", error: "governing provider authentication is unavailable" };
      const { ok: _ok, ...auth } = result;
      return { ok: true, auth: parseProviderRequestAuth(auth) };
    } catch {
      const current = this.checkProviderAdmission(rt, worker, payload, envelope);
      return current.ok ? { ok: false, code: "MODEL_UNAVAILABLE", error: "governing provider authentication failed" } : current;
    }
  }

  private checkProviderAdmission(
    rt: AgentRuntime,
    worker: WorkerPort,
    payload: ProviderAdmissionPayload,
    envelope: IpcEnvelope,
  ): ProviderAdmissionResponse {
    const record = rt.record;
    if (rt.worker !== worker || !rt.activeRun) {
      return { ok: false, code: "STALE_INSTANCE", error: "STALE_INSTANCE: no admitted execution for this worker" };
    }
    const envTask: unknown = (envelope as { taskRunId?: unknown } | null | undefined)?.taskRunId;
    const envGen: unknown = (envelope as { executionGeneration?: unknown } | null | undefined)?.executionGeneration;
    if (typeof envTask !== "string" || envTask.length === 0) {
      return { ok: false, code: "INVALID", error: "INVALID: provider admission requires a nonempty taskRunId" };
    }
    if (typeof envGen !== "number" || !Number.isInteger(envGen) || envGen < 0) {
      return { ok: false, code: "INVALID", error: "INVALID: provider admission requires a nonneg integer executionGeneration" };
    }
    if (rt.activeRun.taskRunId !== envTask) {
      return { ok: false, code: "STALE_GENERATION", error: "STALE_GENERATION: task run superseded" };
    }
    if (rt.activeRun.generation !== envGen) {
      return { ok: false, code: "STALE_GENERATION", error: "STALE_GENERATION: execution generation superseded" };
    }
    if (rt.activeRun.interruptRequested) {
      return { ok: false, code: "NOT_RUNNING", error: "NOT_RUNNING: the generation is being interrupted" };
    }
    if (record.desiredLifecycle === "closed") {
      return { ok: false, code: "CLOSED", error: "CLOSED: agent is closed" };
    }
    if (!record.model) {
      return { ok: false, code: "NOT_FOUND", error: "NOT_FOUND: agent has no admitted model" };
    }
    // Operative selected original model identity: exact physical provider/id;
    // thinking level must match the admitted record (SDK clamps after route).
    if (payload.provider !== record.model.provider || payload.modelId !== record.model.id) {
      return { ok: false, code: "POLICY_DENIED", error: `POLICY_DENIED: provider model ${payload.provider}/${payload.modelId} is not the admitted ${record.model.provider}/${record.model.id}` };
    }
    const admittedThinking = record.model.thinkingLevel ?? "off";
    if (payload.thinkingLevel !== admittedThinking) {
      return { ok: false, code: "POLICY_DENIED", error: `POLICY_DENIED: thinking level ${payload.thinkingLevel} is not the admitted ${admittedThinking}` };
    }
    // Authoritative execution-time hold (same contract as NEW-task/check/native).
    const hold = this.admissionHoldError();
    if (hold) {
      return { ok: false, code: String((hold as { code?: unknown }).code ?? "RECOVERY_OWNER_UNCONFIRMED"), error: `${String((hold as { code?: unknown }).code ?? "RECOVERY_OWNER_UNCONFIRMED")}: ${String((hold as Error).message).replace(/^[A-Z_]+: /, "")}` };
    }
    return { ok: true };
  }

  private async onToolRequest(
    rt: AgentRuntime,
    worker: WorkerPort,
    payload: ToolRequest,
    envelope?: { taskRunId?: string | null; executionGeneration?: number | null },
  ): Promise<ToolResponse> {
    const record = rt.record;
    // Fencing: current binding, worker instance, taskRunId/generation,
    // interrupt state. A parent's spawn return is NOT inactivity.
    if (rt.worker !== worker || !rt.activeRun) return { content: "STALE_INSTANCE: no admitted execution for this worker", isError: true };
    if (envelope?.taskRunId != null && rt.activeRun.taskRunId !== envelope.taskRunId) {
      return { content: "STALE_GENERATION: task run superseded", isError: true };
    }
    if (envelope?.executionGeneration != null && rt.activeRun.generation !== envelope.executionGeneration) {
      return { content: "STALE_GENERATION: execution generation superseded", isError: true };
    }
    if (rt.activeRun.interruptRequested) return { content: "NOT_RUNNING: the generation is being interrupted", isError: true };
    if (payload.usage) rt.usageSnapshot = payload.usage;
    // Supervisor-side allowlist: the worker's registry is never trusted.
    // Re-checked at execution (not just exposure) with current root-concrete.
    if (!this.childTools(rt).includes(payload.tool)) {
      return { content: `POLICY_DENIED: tool ${payload.tool} is not available to this agent`, isError: true };
    }
    // Reviewers never receive external tools (defense in depth: exposure
    // already strips them, but a wildcard must not bypass here).
    if (this.gate.isReviewer(record.id) && !(FILE_TOOLS as readonly string[]).includes(payload.tool) && payload.tool !== GATE_DECISION_TOOL) {
      return { content: `POLICY_DENIED: tool ${payload.tool} is not available to a reviewer`, isError: true };
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
      // Native file/shell route (existing broker, child workdir/isolation).
      // Global pause: no NEW native effects while suspended/disposed or
      // while fault receipts await delivery (the broker journals intents on
      // entry, so the denial precedes it). Control, gate-decision, cancel,
      // fence, and reconcile routes above and elsewhere never pass here.
      if (this.suspended || this.disposed) {
        return { content: "NOT_RUNNING: root suspended: no new admissions during recovery/shutdown", isError: true };
      }
      if (this.toolBroker.hasPendingReceipts()) {
        return { content: "STORE_FAILED: journal holds uncommitted fault receipts; explicit recovery required", isError: true };
      }
      // Known-billing hold (attach catch-up or failed external usage
      // commit): no NEW native effects until explicit reconciliation.
      const billingHold = this.admissionHoldError();
      if (billingHold) return { content: `${billingHold.code}: ${billingHold.message}`, isError: true };
      if (([...FILE_TOOLS, ...WRITE_TOOLS, SHELL_TOOL] as readonly string[]).includes(payload.tool)) {
        const result = await this.broker.execute(caller, { tool: payload.tool, args: payload.args });
        const text = result.timedOut
          ? `tool timed out${result.stdout ? `\n${result.stdout.slice(0, 4000)}` : ""}`
          : `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr.slice(0, 2000)}` : ""}${result.truncated ? "\n[output truncated by the sandbox]" : ""}`;
        const exit = result.exitCode !== 0 ? `\n[exit ${result.exitCode ?? result.signal}]` : "";
        return { content: `${boundedText(text)}${exit}`, isError: result.exitCode !== 0 || result.timedOut };
      }
      // Generic external route: fail closed without an authenticated
      // envelope, then live re-authorization (current binding/identity/
      // grants/scope) inside the dispatcher. Sandbox/reviewers never pass.
      if (!envelope || envelope.taskRunId === null || envelope.taskRunId === undefined || envelope.executionGeneration === null || envelope.executionGeneration === undefined) {
        return { content: "STALE_GENERATION: external calls require an authenticated task run and generation", isError: true };
      }
      if (envelope.taskRunId !== rt.activeRun.taskRunId || envelope.executionGeneration !== rt.activeRun.generation) {
        return { content: "STALE_GENERATION: task run superseded", isError: true };
      }
      // Prepared-ticket verification: a ticket binds prepared args to this
      // exact caller/task/generation and is single-use. Verification consumes
      // it; any mismatch denies without effect. Calls without a ticket keep
      // the legacy path (prepare runs at execution via the dispatcher).
      let skipPrepare = false;
      if (payload.ticket !== undefined) {
        const ticket = typeof payload.ticket === "string" ? this.preparedTickets.get(payload.ticket) : undefined;
        // Consume-attempt-once: a failed verification still burns the ticket
        // so it cannot be probed or replayed.
        if (ticket) this.preparedTickets.delete(ticket.ticket);
        const registryNow = this.opts.governingRegistry?.() ?? null;
        const currentNow = registryNow !== null && registryNow.isActive() ? registryNow.getHandle(payload.tool) : undefined;
        let paramsJsonNow: string | null = null;
        try {
          paramsJsonNow = JSON.stringify((currentNow as { parameters?: unknown } | undefined)?.parameters ?? null);
        } catch {
          paramsJsonNow = null;
        }
        if (
          !ticket ||
          !currentNow ||
          ticket.agentId !== record.id ||
          ticket.tool !== payload.tool ||
          ticket.taskRunId !== rt.activeRun.taskRunId ||
          ticket.generation !== rt.activeRun.generation ||
          ticket.executeRef !== (currentNow as { execute?: unknown }).execute ||
          ticket.prepareRef !== (currentNow as { prepareArguments?: unknown }).prepareArguments ||
          ticket.paramsJson !== paramsJsonNow ||
          ticket.description !== (currentNow as { description?: unknown }).description ||
          JSON.stringify(ticket.preparedArgs ?? {}) !== JSON.stringify(payload.args ?? {})
        ) {
          return { content: "POLICY_DENIED: prepared ticket invalid, stale, mismatched, or rebound", isError: true };
        }
        skipPrepare = true;
      }
      const ext = await this.externalDispatcher.execute(caller, { tool: payload.tool, args: payload.args, skipPrepare });
      // Exactly-once accounting keyed by invocation, attributed to the
      // immutable originating task/generation (late completions during a new
      // task never misattribute). Model-generation totals stay separate:
      // the worker no longer folds external usage into gen.usage.
      // Dedupe on committed accounting (a usage.reported record), keyed by
      // invocation: an early-cancelled return carries no usage and must NOT
      // mark the op accounted, or late billing would be swallowed.
      // Accounting arrives via the dispatcher's per-op onUsage hook (normal
      // and late completions alike) under the originating identity; nothing
      // is accounted on return here, so an early-cancelled return (no usage)
      // can never swallow late billing.
      return {
        content: ext.content as Array<Record<string, unknown>>,
        details: ext.details,
        structuredContent: ext.structuredContent,
        usage: ext.usage,
        isError: ext.isError,
      };
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
          model: args["model"] as SpawnParams["model"],
        }, requestId);
      case "list_agents":
        return this.list(caller);
      case "read_agent":
        if (args["view"] === "result" || args["view"] === "reviews") {
          const read = args["view"] === "reviews" ? this.readReviews.bind(this) : this.readResult.bind(this);
          return read(caller, str("target"), typeof args["task_run_id"] === "string" ? args["task_run_id"] : null, { offset: typeof args["offset"] === "number" ? args["offset"] : 0, length: typeof args["length"] === "number" ? args["length"] : null }, typeof args["cursor"] === "number" ? args["cursor"] : 0);
        }
        return this.read(caller, str("target"), str("view") as "status" | "result" | "reviews" | "events", typeof args["cursor"] === "number" ? args["cursor"] : 0, typeof args["limit"] === "number" ? args["limit"] : 20, typeof args["task_run_id"] === "string" ? args["task_run_id"] : null);
      case "wait_agent":
        return this.childWait(rt, args);
      case "spawn_agent":
        // Not offered to children; an argument sent anyway is refused, not dropped.
        if (args["workspace_path"] !== undefined) throw err("FORBIDDEN", "only the governing session assigns a prepared workspace");
        if (args["gate"] !== undefined || args["review"] !== undefined) throw err("FORBIDDEN", "only the governing session configures reviews");
        return this.spawn(caller, {
          taskName: str("task_name"),
          message: str("message"),
          profile: str("profile") as "reader" | "writer",
          isolation: args["isolation"] === undefined ? undefined : str("isolation") as Isolation,
          repoId: typeof args["repo_id"] === "string" ? args["repo_id"] : null,
          baseCommit: typeof args["base_commit"] === "string" ? args["base_commit"] : null,
          resultLimit: typeof args["result_limit"] === "number" ? args["result_limit"] : null,
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
    this.externalDispatcher.assertQuiescent(rt.record.id);
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

  /**
   * The settled generation's final text as the worker handed it over:
   * inline, or (beyond the inline bound) a synchronized file in the root
   * store that must match the worker's digest. A handoff that fails keeps
   * the inline prefix; the shortfall against `fullLength` is reported as
   * truncation by every read.
   */
  private finalText(rt: AgentRuntime, detail: Record<string, unknown>): FinalText {
    const inline = String(detail["lastAssistantText"] ?? "");
    const fullLength = typeof detail["textLength"] === "number" ? detail["textLength"] : inline.length;
    const file = detail["resultFile"] as { path?: unknown; byteCount?: unknown; sha256?: unknown } | null | undefined;
    try {
      if (!file) {
        if (typeof detail["resultFileError"] === "string") throw new Error(detail["resultFileError"]);
        return { text: inline, fullLength };
      }
      if (typeof file.path !== "string" || typeof file.byteCount !== "number" || typeof file.sha256 !== "string") throw new Error("malformed result file reference");
      const sessionsDir = join(this.rootDir, "sessions");
      if (relative(sessionsDir, resolve(file.path)).startsWith("..")) throw new Error(`result file ${file.path} lies outside the root store`);
      const bytes = readFileSync(file.path);
      if (bytes.length !== file.byteCount || checkpointSha256(bytes) !== file.sha256) throw new Error("result file does not match the worker's digest");
      // The store keeps the durable copy; the handoff file has served.
      rmSync(file.path, { force: true });
      return { text: bytes.toString("utf8"), fullLength };
    } catch (e) {
      this.publish("recovery.event", { agentId: rt.record.id, phase: "result_handoff_failed", reason: (e as Error).message.slice(0, 200) });
      return { text: inline, fullLength };
    }
  }

  /** Keep a final text up to the agent's result limit: inline up to RESULT_TEXT_MAX, the whole retained text in the store beyond that. */
  private retainText(rt: AgentRuntime, run: ActiveRun, final: FinalText): RetainedText {
    const kept = final.text.slice(0, rt.record.resultLimit);
    const stored = kept.length > RESULT_TEXT_MAX ? this.store.saveResult(rt.record.id, run.taskRunId, run.generation, kept) : null;
    return { text: kept.slice(0, RESULT_TEXT_MAX), stored, fullLength: final.fullLength };
  }

  private finalizeGeneration(rt: AgentRuntime, status: string, final: FinalText, error: string, usage: UsageDetail | undefined): void {
    const record = rt.record;
    const run = rt.activeRun;
    if (!run) return; // Duplicate terminal outcome: ignore (exactly-once).
    const retained = this.retainText(rt, run, final);
    // Fence unconfirmed external effects first: a run settling while
    // abort-ignoring tools are still tracked ends uncertain (durable
    // uncertainty + scope retirement; terminal UNCERTAIN does not by itself
    // prohibit a later task — control-quiescent is distinct from
    // effects-stopped, with late billing preserved).
    const fenced = this.externalDispatcher.fenceAgentNow(record.id, "generation settled with unconfirmed external effects");
    const outcome: TaskOutcome = fenced.length > 0 || status === "uncertain"
      ? "uncertain"
      : run.interruptRequested
        ? "interrupted"
        : status === "succeeded" || status === "interrupted" ? status : "failed";
    const accounted = this.accountUsage(rt, usage ?? { unknown: true });
    this.publish("usage.reported", { agentId: record.id, taskRunId: run.taskRunId, generation: run.generation, ...accounted });
    this.store.append("generation.settled", {
      agentId: record.id,
      taskRunId: run.taskRunId,
      generation: run.generation,
      outcome,
      error: error ? error.slice(0, PREVIEW_MAX) : undefined,
      text: retained.text,
      textLength: retained.fullLength,
      result: retained.stored ?? undefined,
    });
    record.observed = "settled";
    record.outcome = outcome;
    // Guard admission: lock queued tasks before releasing capacity so a newer
    // task cannot start before the old gated candidate is captured. The
    // continuation re-asserts this phase (or overwrites it on interrupt/fail).
    if (rt.gateTaskRunId === run.taskRunId && outcome === "succeeded" && !this.terminalRuns.has(run.taskRunId)) {
      record.taskPhase = "candidate_recording";
    }
    rt.activeRun = null;
    // Prepared tickets die with their generation: single-use tickets bound
    // to this taskRunId+generation can never be consumed afterwards, and a
    // worker that never learned an id (oversize/expired response) cannot
    // release it. Purging here bounds the map without any worker-knows-ticket
    // assumption (interrupt/shutdown/exit/reload/recover already purge).
    this.purgePreparedTickets(record.id);
    rt.lastText = { taskRunId: run.taskRunId, ...retained };
    rt.usageSnapshot = null;
    this.notifyChanged();
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
        this.gate.candidateSettled(record.id, run.taskRunId, run.generation, retained.text);
        return;
      }
      if (rt.gateTaskRunId === run.taskRunId) this.gate.cancelTask(run.taskRunId, final);
      this.settleTaskTerminal(rt, run.taskRunId, final, detail);
    };
    // Releasing capacity synchronously pumps queued tasks, including this
    // owner's next task. Install its completion barrier before that pump.
    if (rt.afterDescendants) throw err("CONFLICT", `agent ${record.id} settled a generation while still joining descendants`);
    rt.afterDescendants = continuation;
    this.releaseRunnable(rt);
    // A child owner cancels and joins active descendants before publishing
    // its own outcome (structured ownership). New tasks queue meanwhile.
    const active = this.activeDescendants(record.id);
    if (active.length > 0) {
      record.detail = `joining ${active.length} active descendant(s) before settling`;
      for (const child of active) this.interruptSubtree(child).catch((e: unknown) => this.reportFailure(e));
      return;
    }
    rt.afterDescendants = null;
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

  /**
   * Consume one invocation-identified late ORIGINAL-usage receipt under
   * its captured identity, for ordinary and reviewer workers alike.
   * Discipline mirrors external billing commits: persist (durable
   * usage.reported with an explicit late marker) BEFORE live accounting
   * and notification, dedupe on committed records, retain failed commits
   * for recovery with a debt hold. Worker-side set-dedup guarantees the
   * settled snapshot and the late receipt never bill the same message.
   * The immutable per-invocation receiptId (not the generation triple)
   * identifies the receipt end to end: two distinct late results in one
   * generation carry distinct IDs and bill independently, duplicate
   * deliveries share one ID and bill once, and retained obligations keep
   * their own payloads across failure and retry.
   */
  private intakeLateUsage(rt: AgentRuntime, detail: Record<string, unknown> | undefined): void {
    const usage = detail?.["usage"];
    const lateAgentId = detail?.["agentId"];
    const lateTaskRunId = detail?.["taskRunId"];
    const lateGeneration = detail?.["generation"];
    const receiptId = detail?.["receiptId"];
    if (typeof usage !== "object" || usage === null || typeof lateAgentId !== "string" || typeof lateTaskRunId !== "string" || typeof lateGeneration !== "number" || typeof receiptId !== "string" || receiptId.length === 0) {
      throw err("INVALID", `malformed late usage receipt: ${JSON.stringify(detail ?? null).slice(0, 160)}`);
    }
    this.commitLateReceipt(rt, { agentId: lateAgentId, taskRunId: lateTaskRunId, generation: lateGeneration, receiptId, usage: usage as UsageDetail }, true);
  }

  /** Pure normalization for late receipts (mirrors accountUsage defaults
   * without side effects, so the durable commit precedes live mutation). */
  private normalizeLateUsage(usage: UsageDetail): { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number | null; cost: number | null; unknown: boolean } {
    return {
      input: usage.input ?? 0,
      output: usage.output ?? 0,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      reasoning: typeof usage.reasoning === "number" ? usage.reasoning : null,
      cost: typeof usage.cost === "number" ? usage.cost : null,
      unknown: usage.unknown === true,
    };
  }

  /** True when the durable ledger already holds this receipt ID (journal
   * scan; rare path only, never hot). Receipt identity — not the
   * generation triple — decides duplicates, so two distinct late results
   * in one generation never mask each other. */
  private hasCommittedLateReceipt(receiptId: string): boolean {
    const { records } = this.store.readSince(0, Number.MAX_SAFE_INTEGER);
    return records.some((r) => {
      if (r.kind !== "usage.reported") return false;
      const b = r.body as Record<string, unknown>;
      return b["late"] === true && b["receiptId"] === receiptId;
    });
  }

  /**
   * Rebuild memory-only late obligations from durable outbox records:
   * usage_late.pending entries WITHOUT a matching committed
   * usage.reported (by receipt ID) are still owed. Runs at fresh attach
   * (post-restart) and at recover start (fresh records), so a restart
   * after a failed commit restores both the payloads and the debt hold.
   * Pure read plus memory fill; never throws past a readable journal.
   */
  private rebuildLateObligations(records: JournalRecord[]): void {
    const committed = new Set<string>();
    for (const r of records) {
      if (r.kind !== "usage.reported") continue;
      const id = (r.body as Record<string, unknown>)["receiptId"];
      if (typeof id === "string") committed.add(id);
    }
    for (const r of records) {
      if (r.kind !== "usage_late.pending") continue;
      const b = r.body as Record<string, unknown>;
      const receiptId = b["receiptId"];
      const agentId = b["agentId"];
      const taskRunId = b["taskRunId"];
      const generation = b["generation"];
      const usage = b["usage"];
      if (typeof receiptId !== "string" || receiptId.length === 0) continue;
      if (committed.has(receiptId)) continue;
      if (typeof agentId !== "string" || typeof taskRunId !== "string" || typeof generation !== "number") continue;
      if (typeof usage !== "object" || usage === null) continue;
      if (!this.pendingLateBilling.has(receiptId)) {
        this.pendingLateBilling.set(receiptId, { agentId, taskRunId, generation, receiptId, usage: usage as UsageDetail });
      }
    }
  }

  /**
   * Commit one late receipt: dedupe, persist, then account live, clear any
   * retained retry, and notify. Returns true on commit. A persistence fault
   * retains the payload for recovery (debt hold) and stays observable;
   * live totals are untouched until the commit succeeds. A PUBLIC observer
   * exception after the commit never strands debt: counters already
   * cleared, only the notification fault stays observable.
   */
  private commitLateReceipt(rt: AgentRuntime | null, info: { agentId: string; taskRunId: string; generation: number; receiptId: string; usage: UsageDetail }, notify: boolean): boolean {
    if (this.hasCommittedLateReceipt(info.receiptId)) {
      this.pendingLateBilling.delete(info.receiptId);
      return true;
    }
    const accounted = this.normalizeLateUsage(info.usage);
    // Durable outbox first: this record is the cross-restart obligation.
    // A committed usage.reported for the same receipt ID implicitly
    // acknowledges it (dedupe above skips both); outbox twins never bill.
    try {
      this.store.append("usage_late.pending", { agentId: info.agentId, taskRunId: info.taskRunId, generation: info.generation, receiptId: info.receiptId, usage: info.usage });
    } catch (e) {
      // Store fully unavailable: memory-only retention (current-instance
      // hold) is all that remains; same residual as every journal write.
      this.pendingLateBilling.set(info.receiptId, { agentId: info.agentId, taskRunId: info.taskRunId, generation: info.generation, receiptId: info.receiptId, usage: info.usage });
      this.reportFailure(e);
      return false;
    }
    const body = { agentId: info.agentId, taskRunId: info.taskRunId, generation: info.generation, receiptId: info.receiptId, ...accounted, late: true };
    try {
      this.store.append("usage.reported", body);
    } catch (e) {
      // Genuine pre-append persistence failure: retain the full payload
      // under its own receipt ID for recovery retry and hold admission
      // (no fail-open billing against the debt). Distinct invocations keep
      // distinct payloads — a sibling failure never overwrites this one.
      // Counters stay untouched.
      this.pendingLateBilling.set(info.receiptId, { agentId: info.agentId, taskRunId: info.taskRunId, generation: info.generation, receiptId: info.receiptId, usage: info.usage });
      this.reportFailure(e);
      return false;
    }
    this.accountUsage(rt, info.usage);
    this.pendingLateBilling.delete(info.receiptId);
    if (notify) {
      try {
        this.evaluateWaiters();
        this.opts.onChange?.();
      } catch (e) {
        this.reportFailure(e);
      }
    }
    return true;
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
    const retained: RetainedText = rt.lastText?.taskRunId === taskRunId
      ? { text: rt.lastText.text, stored: rt.lastText.stored, fullLength: rt.lastText.fullLength }
      : { text: "", stored: null, fullLength: 0 };
    const text = retained.text;
    this.pendingSettle.set(taskRunId, { agentId: rt.record.id, outcome, error: detail });
    this.store.append("task.terminal", { agentId: rt.record.id, taskRunId, outcome, preview: text.slice(0, PREVIEW_MAX), detail: detail.slice(0, PREVIEW_MAX) });
    this.terminalRuns.set(taskRunId, { agentId: rt.record.id, outcome });
    this.pendingSettle.delete(taskRunId);
    if (taskRunId === rt.record.currentTaskRunId) {
      rt.record.taskPhase = "terminal";
      rt.record.taskOutcome = outcome;
      if (!rt.activeRun) rt.record.observed = "settled";
    }
    rt.queue = rt.queue.filter((q) => q.id !== taskRunId);
    rt.lastResult = { taskRunId, outcome, detail, ...retained };
    this.notifyChanged();
    this.pumpQueue(rt);
    this.resumeOwnerAfterDescendant(rt);
  }

  /** Dispatch the next queued task to a loaded idle worker (runnable lease required). */
  private pumpQueue(rt: AgentRuntime): void {
    if (rt.activeRun || rt.held || rt.record.desiredLifecycle === "closed" || rt.quarantined || this.isPhaseLocked(rt)) return;
    // Admission hold (billing uncommitted, retained faults, or
    // suspend/dispose): queued work waits; nothing dispatches.
    if (this.admissionHoldError() !== null) return;
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
    // Effect-time admission gate: a task admitted to the queue before the
    // hold must still not prompt inference while held; it settles failed
    // with the hold reason instead.
    const deliverHold = this.admissionHoldError();
    void (async () => {
      if (deliverHold !== null) {
        const heldFailure: string = `${deliverHold.code}: ${deliverHold.message}`;
        this.detached(() => {
          if (rt.activeRun !== run) return;
          if (rt.record.observed === "starting") rt.record.observed = "running";
          this.finalizeGeneration(rt, "failed", NO_FINAL_TEXT, heldFailure, { unknown: false });
        });
        return;
      }
      let failure: string | null = null;
      try {
        await rt.checkpointing;
        // Effect-time re-check AFTER the checkpoint await: a broker commit
        // fault (or any hold) that landed while parked must still deny the
        // prompt. Same visible failure shape as the entry-time denial.
        const postCheckpointHold = this.admissionHoldError();
        if (postCheckpointHold !== null) {
          failure = `${postCheckpointHold.code}: ${postCheckpointHold.message}`;
        } else {
          const res = (await worker.request("deliver", payload, { taskRunId: run.taskRunId, generation: run.generation })) as { ok?: boolean; code?: string; message?: string } | null;
          if (!res || res.ok !== true) failure = `delivery rejected: ${res?.code ?? "INVALID"}: ${res?.message ?? "no response"}`;
        }
      } catch (e) {
        failure = `delivery failed: ${(e as Error).message}`;
      }
      if (failure === null) return;
      this.detached(() => {
        if (rt.activeRun !== run) return;
        if (rt.record.observed === "starting") rt.record.observed = "running";
        this.finalizeGeneration(rt, "failed", NO_FINAL_TEXT, failure, { unknown: false });
      });
    })();
  }

  // -- messages ------------------------------------------------------------------

  async sendMessage(
    caller: CallerId,
    target: AgentId | "parent",
    mode: MessageMode,
    text: string,
    opts: { requestReply?: boolean; replyTo?: MessageId; model?: SpawnParams["model"] },
    requestId: string,
  ): Promise<{ messageId: MessageId; taskRunId: TaskRunId | null }> {
    return this.serialized(async () => {
      this.sweepExpiredQuestions();
      if (opts.model !== undefined && (mode !== "task" || opts.replyTo !== undefined)) {
        throw err("INVALID", "model override requires mode=task and cannot answer a question");
      }
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
      if (rt && opts.model !== undefined) this.checkControl(caller, rt.record);
      const model = opts.model === undefined ? null : this.validateReuseModel(rt, opts.model);
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
        fromTaskRunId: from === "governor" ? null : this.agents.get(from)!.record.currentTaskRunId,
        to,
        mode,
        text,
        taskRunId,
        requestReply: message.requestReply,
        model,
        deadlineAt,
        requestId,
        digest,
      });
      message.seq = accepted.seq;
      this.messages.set(messageId, message);
      if (rt && model) {
        rt.record.model = model;
        this.unloadWorker(rt);
      }
      rt?.record.pendingMessageIds.push(messageId);
      const queued: QueuedTask | null = rt && mode === "task"
        ? { id: taskRunId!, agentId: to, messageId, text, createdAt: this.now(), replaces: null, dispatched: false }
        : null;
      if (rt && queued) {
        rt.queue.push(queued);
        rt.record.pendingTaskIds.push(queued.id);
        rt.record.detail = "task queued: acceptance persistence interrupted; explicit recovery may be required";
      }

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

      this.store.recordCommand(requestId, accepted);
      if (!rt) return { messageId, taskRunId };
      if (queued) {
        this.publish("task.queued", { id: queued.id, agentId: to, messageId, text, replaces: null });
        // An explicit new task resumes an agent recovery held — unless
        // admission itself is held (billing uncommitted, retained faults,
        // or suspend/dispose): the task queues with a held detail and
        // nothing dispatches until explicit recovery.
        rt.held = false;
        const taskHold = this.admissionHoldError();
        if (taskHold !== null) {
          rt.record.detail = `task queued: ${taskHold.message}`;
        } else if (rt.activeRun || rt.parkedStartup !== null || this.isPhaseLocked(rt)) {
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

  private canReuseSettled(rt: AgentRuntime): boolean {
    return rt.record.desiredLifecycle === "open" && rt.record.taskPhase === "terminal" && rt.record.observed === "settled"
      && rt.activeRun === null && rt.parkedStartup === null && rt.checkpointing === null
      && !rt.queue.some((q) => !q.dispatched) && !this.isPhaseLocked(rt)
      && !this.gate.isReviewer(rt.record.id) && rt.gateTaskRunId === null
      && !rt.loading && !rt.usage.unknown && !rt.quarantined && !this.pendingLost.has(rt.record.id)
      && this.activeDescendants(rt.record.id).length === 0
      && this.broker.activeJobs(rt.record.id).length === 0 && this.externalDispatcher.activeJobs(rt.record.id).length === 0;
  }

  private hasCurrentCheckpoint(rt: AgentRuntime): boolean {
    const checkpoint = this.store.loadCheckpoint(rt.record.id);
    return checkpoint !== null && checkpoint.ref.generation === rt.record.executionGeneration && checkpoint.ref.taskRunId === rt.record.currentTaskRunId;
  }

  private validateReuseModel(rt: AgentRuntime | null, override: SpawnParams["model"]): ResolvedModel {
    if (!override || typeof override.provider !== "string" || !override.provider.trim() || typeof override.id !== "string" || !override.id.trim()
      || (override.thinkingLevel !== undefined && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(override.thinkingLevel))) {
      throw err("INVALID", "model requires nonempty provider/id and a valid thinkingLevel");
    }
    if (!rt || !this.canReuseSettled(rt)) throw err("CONFLICT", "model switch requires a settled open non-gated agent with no running, queued, checkpointing, descendant or owned work and no unknown usage");
    const hold = this.admissionHoldError();
    if (hold !== null) throw hold;
    if (this.policy.allowedModels !== null && !this.policy.allowedModels.some((m) => m.provider === override.provider && m.id === override.id)) {
      throw err("POLICY_DENIED", `model ${override.provider}/${override.id} not in root allowlist`);
    }
    if (!this.hasCurrentCheckpoint(rt)) {
      throw err("RECOVERY_OWNER_UNCONFIRMED", "model switch requires a validated checkpoint of the current settled generation; retain this worker/history and resolve checkpoint recovery first");
    }
    return { provider: override.provider, id: override.id, thinkingLevel: override.thinkingLevel ?? rt.record.model?.thinkingLevel ?? "medium" };
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
    const accepted = this.publish("mailbox.accepted", { messageId, agentId: question.from, from, fromTaskRunId: from === "governor" ? null : this.agents.get(from)!.record.currentTaskRunId, to: question.from, mode: "note", text, replyTo, taskRunId: null, requestId });
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

  read(caller: CallerId, target: AgentId, view: "status" | "result" | "reviews" | "events", cursor: number, limit: number, taskRunId: TaskRunId | null): ReadResult {
    const rt = this.agents.get(target);
    if (!rt) throw err("NOT_FOUND", `agent ${target} unknown`);
    if (!this.visibleTo(caller, rt.record)) throw err("FORBIDDEN", "agent not visible to caller");
    if (view === "status") return { status: this.viewOf(rt), result: null, events: [], cursor };
    if (view === "result") return this.readResult(caller, target, taskRunId, { offset: 0, length: RESULT_TEXT_MAX }, cursor);
    if (view === "reviews") return this.readReviews(caller, target, taskRunId, { offset: 0, length: RESULT_TEXT_MAX }, cursor);
    if (view !== "events") throw err("INVALID", "view must be status, result, reviews, or events");
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
      } else if (r.kind === "recovery.event" && r.body["phase"] === "controller_error" && typeof r.body["error"] === "string") {
        line = `controller failure: ${r.body["error"]}`;
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

  /**
   * One page of a task run's retained final text (the latest run, or the
   * one `taskRunId` names). The reply always fits one tool result: the page
   * is as long as asked for, or as fits, and `nextOffset` continues it.
   * `cursor` is echoed, as read() does.
   */
  readResult(caller: CallerId, target: AgentId, taskRunId: TaskRunId | null, page: ResultPage, cursor: number): ReadResult {
    const rt = this.agents.get(target);
    if (!rt) throw err("NOT_FOUND", `agent ${target} unknown`);
    if (!this.visibleTo(caller, rt.record)) throw err("FORBIDDEN", "agent not visible to caller");
    const status = this.viewOf(rt);
    const run = taskRunId !== null && taskRunId !== rt.lastResult?.taskRunId ? this.resultFromJournal(target, taskRunId) : rt.lastResult;
    if (!run) return { status, result: null, events: [], cursor };
    const whole = run.stored ? this.store.loadResult(target, run.stored) : run.text;
    const truncated = run.fullLength !== null ? run.fullLength > whole.length : whole.length >= rt.record.resultLimit;
    return this.pageText(status, run, whole, page, cursor, rt.record.resultLimit, truncated, this.gate.inspect(run.taskRunId)?.feedback.length ?? 0);
  }

  /** A stable, paged concatenation of every review, separate from the main deliverable. */
  readReviews(caller: CallerId, target: AgentId, taskRunId: TaskRunId | null, page: ResultPage, cursor: number): ReadResult {
    const rt = this.agents.get(target);
    if (!rt) throw err("NOT_FOUND", `agent ${target} unknown`);
    if (!this.visibleTo(caller, rt.record)) throw err("FORBIDDEN", "agent not visible to caller");
    const status = this.viewOf(rt);
    const runId = taskRunId ?? rt.record.currentTaskRunId;
    const state = runId === null ? null : this.gate.inspect(runId);
    if (!state || state.agentId !== target) return { status, result: null, events: [], cursor };
    if (!state.terminal) throw err("CONFLICT", "review report is available after the task settles; use events for progress");
    const report = this.gate.report(state.taskRunId);
    return this.pageText(status, { taskRunId: state.taskRunId, outcome: state.terminal, detail: "All reviewer feedback in candidate-round and reviewer declaration order." }, report.text, page, cursor, report.text.length, false, report.count);
  }

  private pageText(status: AgentView, run: { taskRunId: string; outcome: string | null; detail: string }, whole: string, page: ResultPage, cursor: number, resultLimit: number, truncated: boolean, reviewCount: number): ReadResult {
    const total = whole.length;
    if (!Number.isInteger(page.offset) || page.offset < 0 || page.offset > total) throw err("INVALID", `offset must be an integer from 0 to ${total} (the retained length)`);
    if (page.length !== null && (!Number.isInteger(page.length) || page.length < 1)) throw err("INVALID", "length must be a positive integer");
    const reply = (text: string, nextOffset: number | null): ReadResult => ({
      status,
      result: { taskRunId: run.taskRunId, outcome: run.outcome, text, detail: run.detail, totalLength: total, offset: page.offset, nextOffset, truncated, resultLimit, reviewCount },
      events: [],
      cursor,
    });
    // Everything but the text is measured first (with the widest next offset); the text gets the rest of one tool result.
    const room = TOOL_RESULT_MAX - Math.max(JSON.stringify(reply("", total)).length, JSON.stringify(reply("", null)).length);
    let size = Math.min(total - page.offset, page.length ?? total);
    for (let escaped = escapedLength(whole.slice(page.offset, page.offset + size)); size > 0 && escaped > room; escaped = escapedLength(whole.slice(page.offset, page.offset + size))) {
      size = Math.min(size - 1, Math.floor((size * room) / escaped));
    }
    if (size <= 0 && page.offset < total) throw err("PAYLOAD_TOO_LARGE", "agent status and outcome detail leave no room for result text in one reply");
    const end = page.offset + Math.max(size, 0);
    return reply(whole.slice(page.offset, end), end < total ? end : null);
  }

  /** An earlier run's result: its terminal record plus its last generation's text. */
  private resultFromJournal(agentId: AgentId, taskRunId: TaskRunId): { taskRunId: TaskRunId; outcome: string | null; detail: string } & RetainedText {
    let retained: RetainedText | null = null;
    let terminal: Record<string, unknown> | null = null;
    for (const r of this.store.readSince(0, Number.MAX_SAFE_INTEGER).records) {
      if (r.body["agentId"] !== agentId || r.body["taskRunId"] !== taskRunId) continue;
      if (r.kind === "generation.settled" && typeof r.body["text"] === "string") retained = retainedFromRecord(r.body);
      if (r.kind === "task.terminal") terminal = r.body;
    }
    if (!terminal && !retained?.text) throw err("NOT_FOUND", `no result for task run ${taskRunId} of ${agentId}`);
    return { taskRunId, outcome: (terminal?.["outcome"] as string | undefined) ?? null, detail: (terminal?.["detail"] as string | undefined) ?? "", ...(retained ?? { text: "", stored: null, fullLength: null }) };
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
      if (id !== null) {
        const gate = this.gate.inspect(id);
        const belongs = id === rt.record.currentTaskRunId || rt.queue.some((queued) => queued.id === id) || this.terminalRuns.get(id)?.agentId === rt.record.id || this.pendingSettle.get(id)?.agentId === rt.record.id || (gate !== null && (gate.agentId === rt.record.id || gate.reviewerIds.includes(rt.record.id)));
        if (!belongs) throw err("NOT_FOUND", `task run ${id} does not belong to agent ${t.agentId}`);
        joinTaskRunIds.push(id);
      }
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
    const addressee = this.authorOf(waiter.caller);
    const openQuestion = [...this.questions.values()].some((q) => !q.answered && !q.cancelled && q.to === addressee && Date.parse(q.deadlineAt) > Date.now());
    if (openQuestion) return this.waitResult(waiter, false, "needs_response", this.relevantRecords(waiter));
    const done = waiter.joinTaskRunIds.filter((id) => this.terminalRuns.has(id));
    const satisfied = waiter.joinTaskRunIds.length === 0 || (waiter.condition === "any_settled" ? done.length > 0 : done.length === waiter.joinTaskRunIds.length);
    return satisfied ? this.waitResult(waiter, true, "settled", this.relevantRecords(waiter)) : null;
  }

  /** Targeted waits follow their targets; untargeted waits see what the caller may see. */
  private eventRelevant(waiter: WaiterReg, r: JournalRecord): boolean {
    const b = r.body;
    if (waiter.targets) {
      return waiter.targets.some((t) => (t.taskRunId === null || t.taskRunId === b["taskRunId"] || (b["from"] === t.agentId && t.taskRunId === b["fromTaskRunId"])) && (b["agentId"] === t.agentId || b["from"] === t.agentId || b["to"] === t.agentId));
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
    await this.externalDispatcher.cancelJobs(record.id);
    this.purgePreparedTickets(record.id);
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

  /** Confirm stopped state: no active runs and no owned jobs (native or external). */
  private async awaitIdle(members: AgentRuntime[], timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!members.some((rt) => rt.activeRun !== null || this.broker.activeJobs(rt.record.id).length > 0 || this.externalDispatcher.activeJobs(rt.record.id).length > 0)) return;
      await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
    }
    // Fence leftovers so close never retires unconfirmed effects as clean.
    for (const rt of members) {
      await this.externalDispatcher.fenceAgent(rt.record.id, "close join timed out; effect unconfirmed");
    }
  }

  private retire(rt: AgentRuntime): void {
    if (!this.scheduler.isAgentOpen(rt.record.id)) return;
    this.purgePreparedTickets(rt.record.id);
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
      this.pendingSettle.set(run.taskRunId, { agentId: rt.record.id, outcome: "interrupted", error: "closed; the worker did not confirm its interrupt and was stopped" });
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
    // Sessions, results, and dirty worktrees are preserved; retained-file
    // cleanup is a separate explicit user action.
    this.publish("agent.closed", { agentId: rt.record.id, path: rt.record.path });
    this.scheduler.releaseAgent(rt.record.id);
    const parent = rt.record.parentId ? this.agents.get(rt.record.parentId) : undefined;
    if (parent) parent.record.activeDescendants = Math.max(0, parent.record.activeDescendants - 1);
  }

  // -- resume / reload -------------------------------------------------------------------

  /**
   * Load an unloaded agent's worker without starting inference: recalculate
   * authority, restore the latest validated checkpoint byte-for-byte into a
   * fresh session file, select its recorded leaf, and reconcile mailbox
   * entries. Work is dispatched separately (task or repair).
   */
  private async reloadAgent(rt: AgentRuntime): Promise<void> {
    this.purgePreparedTickets(rt.record.id);
    if (rt.record.desiredLifecycle === "closed") throw err("CLOSED", "closed agents cannot be resumed");
    if (rt.worker) return;
    if (rt.quarantined) throw err("RECOVERY_OWNER_UNCONFIRMED", rt.quarantined);
    if (this.pendingLost.has(rt.record.id)) throw err("RECOVERY_OWNER_UNCONFIRMED", "an unfinished run awaits recovery reconciliation");
    const parent = rt.record.parentId ? this.agents.get(rt.record.parentId) : undefined;
    const ownerGrants = parent ? parent.record.grants : rootGrants(this.policy, this.governingExternalConcrete());
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
    }, this.governingExternalConcrete());
    if (!granted.ok) throw granted.error;
    // Reload never widens external authority beyond the admitted grant.
    const previousExternal = rt.record.grants.externalTools ?? [];
    granted.grants.externalTools = granted.grants.externalTools.filter((tool) => previousExternal.includes(tool));
    // Durable narrowing BEFORE live mutation: a restart replaying this
    // journal must reconstruct the narrowed set, never revive the original
    // spawned grants. The append precedes the assignment, so a persistence
    // fault fails the reload visibly instead of leaving memory-only
    // authority. Unchanged grants journal nothing (no log spam).
    if (JSON.stringify(granted.grants) !== JSON.stringify(rt.record.grants)) {
      this.publish("agent.grants", { agentId: rt.record.id, grants: granted.grants, policyRevision: this.policy.revision, reason: "reload-narrow" });
    }
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

  /**
   * Catch-up accounting over a FRESH journal read: external outcomes and
   * late receipts carrying own usage without a committed usage.reported
   * are accounted once here under their originating identity. Runs at the
   * END of recover (after reconciliation awaits, so receipts that settled
   * after the opening snapshot are included) and at fresh attach (so known
   * durable receipts never require a manual second recover). Dedupe keys on
   * committed usage.reported records only — never on outcome existence — so
   * a fault in this window cannot zero the totals. Counters and dedupe
   * follow the SUCCESSFUL usage.reported append, exactly like the normal
   * hook path; faults propagate instead of being swallowed. Bills receipts
   * only — never admits effects.
   */
  private catchUpExternalUsage(records: JournalRecord[]): void {
    // Catch-up accounting: external outcomes carrying usage without a
    // committed usage.reported (crash between the two appends) are
    // accounted once here under their originating identity. Dedupe keys
    // on committed usage.reported records only — never on outcome
    // existence — so a fault in this window cannot zero the totals.
    {
      const intentByOp = new Map<string, { agentId: string; taskRunId: string | null; generation: number | null }>();
      const reportedOps = new Set<string>();
      const outcomeUsage = new Map<string, unknown>();
      for (const r of records) {
        const b = r.body as Record<string, unknown>;
        if (r.kind === "tool.intent" && typeof b["operationId"] === "string") {
          intentByOp.set(b["operationId"] as string, {
            agentId: typeof b["agentId"] === "string" ? (b["agentId"] as string) : "",
            taskRunId: typeof b["taskRunId"] === "string" ? (b["taskRunId"] as string) : null,
            generation: typeof b["generation"] === "number" ? (b["generation"] as number) : null,
          });
        }
        if (r.kind === "usage.reported" && typeof b["operationId"] === "string") {
          reportedOps.add(b["operationId"] as string);
        }
        if (r.kind === "tool.outcome" && typeof b["operationId"] === "string" && b["usage"] !== null && b["usage"] !== undefined) {
          outcomeUsage.set(b["operationId"] as string, b["usage"]);
        }
        // Late receipts journaled as recovery events (commit-failed hook
        // or fenced-while-running evidence) carry the same own-usage
        // shape as outcomes and complete identically.
        if (
          r.kind === "recovery.event" &&
          (b["phase"] === "external-late-settlement" || b["phase"] === "external-usage-commit-failed") &&
          typeof b["operationId"] === "string" &&
          b["usage"] !== null &&
          b["usage"] !== undefined
        ) {
          if (!outcomeUsage.has(b["operationId"] as string)) {
            outcomeUsage.set(b["operationId"] as string, b["usage"]);
          }
          if (typeof b["agentId"] === "string" && !intentByOp.has(b["operationId"] as string)) {
            intentByOp.set(b["operationId"] as string, {
              agentId: b["agentId"] as string,
              taskRunId: typeof b["taskRunId"] === "string" ? (b["taskRunId"] as string) : null,
              generation: typeof b["generation"] === "number" ? (b["generation"] as number) : null,
            });
          }
        }
      }
      for (const [op, usage] of outcomeUsage) {
        if (reportedOps.has(op) || this.accountedExternalOps.has(op)) continue;
        const normalized = normalizeExternalUsage(usage);
        if (!normalized) continue;
        const origin = intentByOp.get(op);
        // Counters and dedupe follow the SUCCESSFUL usage.reported
        // append, exactly like the normal hook path: a fault here must
        // leave live totals and the op unmarked so a retry completes
        // exactly once. The fault propagates (observable STORE_FAILED,
        // suspended state preserved) — never swallowed.
        const accounted = {
          input: normalized.input ?? 0,
          output: normalized.output ?? 0,
          cacheRead: normalized.cacheRead ?? 0,
          cacheWrite: normalized.cacheWrite ?? 0,
          cost: typeof normalized.cost === "number" ? normalized.cost : null,
          unknown: normalized.unknown === true,
        };
        this.store.append("usage.reported", {
          agentId: origin?.agentId ?? "",
          taskRunId: origin?.taskRunId ?? null,
          generation: origin?.generation ?? null,
          ...accounted,
          external: true,
          operationId: op,
          recovered: true,
        });
        const rt = (origin && origin.agentId ? this.agents.get(origin.agentId) : undefined) ?? null;
        this.accountUsage(rt, normalized);
        this.accountedExternalOps.add(op);
        this.pendingExternalBilling.delete(op);
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
      // Recovery cancels/fences existing dispatcher jobs/scopes FIRST and
      // synchronizes outcome ownership: a backend ignoring abort cannot
      // produce duplicate ok outcomes after recover (late settlements become
      // guarded recovery events, late billing stays durable/once). Authority
      // is retired regardless of backend cooperation; control-quiescence
      // (no owned jobs) is distinct from effects-stopped. Truthful
      // uncertainty and native workspace quarantine are preserved below.
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
        // Fencing retires authority before any fallible journal write
        // (fenceAgentNow marks + deletes with internal best-effort append;
        // broker cancel marks done). Invariant failures propagate: recover
        // fails through the project error channel and stays suspended rather
        // than unsuspending after uncertain ownership. Durable native
        // quarantine below is preserved.
        this.externalDispatcher.fenceAgentNow(rt.record.id, "recovery: retire live external scopes; effect unconfirmed");
        await this.broker.cancelJobs(rt.record.id);
        this.purgePreparedTickets(rt.record.id);
      }
      for (const waiter of [...this.waiters]) waiter.resolve(this.waitResult(waiter, false, "cancelled", []));
      // Gate recovery: running reviews become interrupted (resumable with
      // fresh context, counters kept); never infer approval from a crash.
      this.gate.markInterruptedForRecovery();
      this.publish("recovery.event", { epoch: this.epoch, phase: "started" });
      const { records } = this.store.readSince(0, Number.MAX_SAFE_INTEGER);
      // Rebuild durable late obligations from the fresh snapshot too:
      // entries committed by lives that ended without attach-rebuild
      // (or re-faulted since) must be retried by this recovery.
      this.rebuildLateObligations(records);
      // External intents without outcomes (crash between effect and
      // confirmation, or abort-ignoring tools): fence as uncertain now.
      // Durable uncertainty (not a global quarantine): replacement work may
      // proceed; late billing stays linked to the original identity. Never
      // auto-replayed.
      {
        const intentOps = new Set<string>();
        const outcomeOps = new Set<string>();
        for (const r of records) {
          const b = r.body as Record<string, unknown>;
          if (typeof b["operationId"] !== "string") continue;
          // Preparation-only intents never produce outcomes (no effect was
          // ever dispatched); fencing them as uncertain would invent effects.
          if (r.kind === "tool.intent" && b["external"] === true && b["prepareOnly"] !== true) intentOps.add(b["operationId"] as string);
          if (r.kind === "tool.outcome") outcomeOps.add(b["operationId"] as string);
        }
        for (const op of intentOps) {
          if (outcomeOps.has(op)) continue;
          this.store.append("tool.outcome", { operationId: op, status: "uncertain", external: true, error: "recovery: intent without outcome; effect unconfirmed" });
        }
        // Catch-up runs at the END of recover (fresh records) and at fresh
        // attach: see catchUpExternalUsage. Running it here on the opening
        // snapshot would miss receipts that settle during reconciliation.
      }
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
          this.pendingLost.set(rt.record.id, lost);
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
      for (const [taskRunId, pending] of this.pendingSettle) {
        const rt = this.agents.get(pending.agentId);
        if (rt && !this.terminalRuns.has(taskRunId)) {
          this.gate.cancelTask(taskRunId, pending.outcome);
          this.settleTaskTerminal(rt, taskRunId, pending.outcome, pending.outcome === "succeeded" ? "" : pending.error || pending.outcome);
          settled.push(taskRunId);
        }
      }
      this.pendingSettle.clear();
      // Automatic end-of-recovery catch-up on FRESH records: receipts that
      // settled after the opening snapshot (during reconciliation awaits)
      // bill here, with no manual second recover required. Success clears a
      // flagged fresh-attach catch-up fault (a fault here propagates with
      // suspended state preserved, as before).
      this.catchUpExternalUsage(this.store.readSince(0, Number.MAX_SAFE_INTEGER).records);
      // Retry retained late ORIGINAL-usage commits (failed persistence
      // held admission): each retry is persist-first and idempotent via
      // the committed-record dedupe, so successes clear debt exactly once
      // and surviving failures keep the hold for the next recovery.
      for (const info of [...this.pendingLateBilling.values()]) {
        const target = this.agents.get(info.agentId) ?? null;
        this.commitLateReceipt(target, info, false);
      }
      this.attachCatchUpNeeded = false;
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
    // Preparation-only intents never dispatched an effect (no outcome ever
    // follows): they must not quarantine the writer. The first recovery scan
    // already excludes them; this second scan must too. Genuinely unconfirmed
    // native effects stay quarantined (positive control).
    const intents = records.filter((r) => r.kind === "tool.intent" && r.body["agentId"] === rt.record.id && r.body["taskRunId"] === lost.taskRunId && r.body["prepareOnly"] !== true);
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
      // Quarantine (and its prohibition) applies to writer workspaces and
      // unverifiable ownership only — the preexisting native-workspace
      // policy. Other cases stay uncertain with effects unknown (see
      // journal), without claiming a prohibition that isn't enforced.
      const quarantinedHere = !!rt.record.allocation.writableRoot || !ownershipOk;
      detail = !ownershipOk
        ? `RECOVERY_OWNER_UNCONFIRMED: unverifiable worker ownership (${ownership}); replacement execution prohibited here`
        : quarantinedHere
          ? `${unconfirmed.length} unconfirmed tool effect(s); replacement execution prohibited here`
          : `${unconfirmed.length} unconfirmed tool effect(s); effects unknown, see journal`;
      if (quarantinedHere) {
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
    this.publish("recovery.event", { agentId: rt.record.id, phase: "evicted" });
    this.unloadWorker(rt);
  }

  private unloadWorker(rt: AgentRuntime): void {
    const worker = rt.worker;
    rt.worker = null;
    worker?.kill();
    // An evicted worker cannot release tickets it never learned; drop them
    // with the residency (no worker-knows-ticket assumption).
    this.purgePreparedTickets(rt.record.id);
    this.releaseRunnable(rt);
    this.releaseResident(rt);
    rt.record.residency = "unloaded";
    rt.record.detail = "evicted; native session retained for resume";
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
      const resumeHold = this.admissionHoldError();
      if (resumeHold !== null) throw resumeHold;
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
      if (main.record.desiredLifecycle === "closed") throw err("CLOSED", "gated agent is permanently closed");
      // The task's governor is whoever owns the main agent; the main actor
      // and its reviewer never control their own validation.
      if (!isGovernor(caller) && caller !== main.record.parentId) throw err("FORBIDDEN", "only the task's governor manages its gate");
      if (state.spec.mode === "review" && action.kind !== "resume_review") throw err("INVALID", "review-only dispatch has no gate limits, retry, or bypass");
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

  feedbackRecorded(): void {
    this.notifyChanged();
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
    if (rt.lastText) rt.lastText = { ...rt.lastText, taskRunId };
    rt.gateTaskRunId = taskRunId;
    rt.record.currentTaskRunId = taskRunId;
    rt.record.taskPhase = "working";
    rt.record.taskOutcome = null;
    rt.record.outcome = null;
    this.publish("task.phase", { agentId, taskRunId, phase: "working", linked: true });
  }

  quiescent(agentId: AgentId): boolean {
    const rt = this.agents.get(agentId);
    if (!rt || rt.activeRun || rt.pendingRepair || this.broker.activeJobs(agentId).length > 0 || this.externalDispatcher.activeJobs(agentId).length > 0) return false;
    if (rt.record.currentTaskRunId !== null && !this.terminalRuns.has(rt.record.currentTaskRunId)) return false;
    for (const reviewerId of this.gate.reviewersOf(agentId)) {
      if (this.agents.get(reviewerId)?.activeRun) return false;
    }
    return true;
  }

  /** A replacement gate specification gets fresh, correctly configured reviewer identities. */
  createReviewerPanel(mainAgentId: AgentId, taskRunId: TaskRunId, spec: NormalizedGateSpec): AgentId[] {
    const charged = this.scheduler.reserveAgentCreation(spec.reviewers.length);
    if (!charged.ok) throw err(charged.code, `${charged.message}. A replacement reviewer panel requires open-agent slots; settled ordinary-agent reuse cannot replace a managed panel. Close an unneeded subtree to reclaim capacity; do not bypass the requested review.`);
    try {
      return spec.reviewers.map((reviewer, index) => this.createManagedReviewer(mainAgentId, taskRunId, reviewer, index, charged.reservation));
    } finally {
      this.scheduler.cancelAgentCreation(charged.reservation);
    }
  }

  /** One protected sibling identity per panel slot, reused across candidate rounds. */
  private createManagedReviewer(mainAgentId: AgentId, taskRunId: TaskRunId, spec: NormalizedReviewerSpec, index: number, reservation: AgentCreationReservation): AgentId {
    const main = this.agents.get(mainAgentId)!;
    const reviewerId = randomUUID();
    const mainAlloc = main.record.allocation;
    const readRoots = mainAlloc.writableRoot ? [mainAlloc.writableRoot, ...mainAlloc.readRoots] : [...mainAlloc.readRoots];
    const basePath = `${main.record.path}/__gate${index === 0 ? "" : `-${index + 1}`}`;
    const path = this.paths.isTaken(basePath) ? `${basePath}-${taskRunId}` : basePath;
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
      grants: { tools: [...FILE_TOOLS], externalTools: [], repos: [], shell: false, network: false, nesting: false, maxDepth: main.record.depth, isolation: main.record.grants.isolation },
      allocation: { kind: "reader", workdir: mainAlloc.workdir, readRoots, writableRoot: null, git: null, repoId: mainAlloc.repoId, tmpDir: this.agentTmp(reviewerId), external: mainAlloc.external },
      instructions: EMPTY_INSTRUCTIONS,
      instructionHash: instructionHash(EMPTY_INSTRUCTIONS),
      policyRevision: this.policy.revision,
      model: { provider: spec.model.provider, id: spec.model.id, thinkingLevel: spec.thinkingLevel },
      resultLimit: RESULT_TEXT_MAX,
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
    try {
      this.store.append("agent.spawned", { agentId: reviewerId, path, parentId: record.parentId, depth: record.depth, profile: "reader", taskRunId, managedGate: true, mainAgentId, grants: record.grants, allocation: record.allocation, instructions: record.instructions, model: record.model });
    } catch (e) {
      this.paths.release(path);
      throw e;
    }
    this.scheduler.commitAgentCreation(reservation, reviewerId);
    this.agents.set(reviewerId, newRuntime(record));
    this.gate.linkReviewer(reviewerId, taskRunId, mainAgentId);
    return reviewerId;
  }

  /** Fresh in-memory reviewer conversation per evaluation, same identity. */
  startReviewerExecution(reviewerId: AgentId, input: ReviewInput): void {
    const rt = this.agents.get(reviewerId);
    if (!rt) throw err("NOT_FOUND", `reviewer ${reviewerId} unknown`);
    if (rt.record.desiredLifecycle === "closed") throw err("CLOSED", `reviewer ${reviewerId} is permanently closed`);
    // A crashed gate is rerun with fresh context, never resumed mid-evaluation.
    const old = rt.worker;
    rt.worker = null;
    old?.kill();
    this.releaseRunnable(rt);
    rt.pendingReview = input;
    rt.record.observed = "queued";
    rt.record.detail = "review queued: waiting for capacity";
    // NEW reviewer inference is not exempt from the admission hold: while
    // held, the review stays parked (no worker, no model cost) instead of
    // prompting. Settle/control/cancel routes are unaffected; the wake
    // paths re-enter launchReview, which re-checks before any new launch.
    const reviewHold = this.admissionHoldError();
    if (reviewHold) {
      rt.record.detail = `review queued: waiting for hold (${reviewHold.code})`;
    } else if (this.scheduler.hasRunnableCapacity()) {
      rt.pendingReview = null;
      this.launchReview(rt, input);
    }
  }

  private launchReview(rt: AgentRuntime, input: ReviewInput): void {
    // Admission hold applies to reviewer launches from every path (direct
    // start, capacity wake, parked retry): while held, park without new
    // inference cost instead of launching a worker.
    const launchHold = this.admissionHoldError();
    if (launchHold) {
      rt.pendingReview = input;
      rt.record.observed = "queued";
      rt.record.detail = `review queued: waiting for hold (${launchHold.code})`;
      return;
    }
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
        // Re-check AFTER the launch await at the actual send boundary: a
        // shutdown or recover that landed mid-launch holds the root now, so
        // the fresh worker must not be prompted. Park visibly without model
        // cost — but only while this run still owns the runtime; a newer
        // run or worker owns its own boundary and must not be disturbed.
        const postLaunchHold = this.admissionHoldError();
        if (postLaunchHold !== null) {
          if (rt.activeRun === run && rt.worker === worker) {
            rt.pendingReview = input;
            rt.record.observed = "queued";
            rt.record.detail = `review queued: waiting for hold (${postLaunchHold.code})`;
            rt.activeRun = null;
            rt.worker = null;
            worker.kill();
            rt.record.residency = "unloaded";
            this.releaseRunnable(rt);
            this.releaseResident(rt);
          } else if (rt.worker !== worker) {
            worker.kill();
          }
          return;
        }
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
          // Never settle into a retired journal: once shutdown closed the
          // store, usage/receipt appends would corrupt it. Live-store
          // cancel/settlement paths are unaffected.
          if (rt.activeRun === run && !this.disposed) this.reviewerSettled(rt, (e as Error).message, undefined);
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
    const git = (rt ? this.effectiveAllocation(rt.record) : null)?.git ?? null;
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
    // NEW native check effects are not CONTROL-route exempt: while the
    // admission hold is active no next declared check may start, even with
    // a valid binding. The gate loop reports this denial as visible paused
    // evidence per check; it never invents effects. Gate-control
    // availability is not new-execution privilege.
    const checkHold = this.admissionHoldError();
    if (checkHold) throw checkHold;
    const rt = this.agents.get(agentId);
    if (!rt) throw err("NOT_FOUND", `agent ${agentId} unknown`);
    const alloc = this.effectiveAllocation(rt.record);
    const writable = alloc.writableRoot;
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
      // The check reads the writer's own workspace: exact read-only
      // exception, never writer permission (the job's writableRoot is null).
      sandbox: this.sandboxOf({ ...rt.record, allocation: alloc }, [writable], [writable]),
      command: check.command,
      cwd: alloc.workdir,
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
      externalTools: [...(r.grants.externalTools ?? [])],
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
export const TOOL_RESULT_MAX = 24_000;
/** Headroom for the tool.prepare response envelope around prepared args. */
const PREPARE_RESPONSE_HEADROOM_BYTES = 8 * 1024;
function boundedText(text: string): string {
  return text.length <= TOOL_RESULT_MAX ? text : `${text.slice(0, TOOL_RESULT_MAX)}\n[output truncated: ${text.length - TOOL_RESULT_MAX} more characters]`;
}

/** Length of a string inside a JSON document, without its quotes. */
function escapedLength(text: string): number {
  return JSON.stringify(text).length - 2;
}

/** The retained text a generation.settled record describes (older records carry the inline text only). */
function retainedFromRecord(body: Record<string, unknown>): RetainedText {
  return {
    text: (body["text"] as string | undefined) ?? "",
    stored: (body["result"] as ResultRef | undefined) ?? null,
    fullLength: typeof body["textLength"] === "number" ? body["textLength"] : null,
  };
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

/**
 * Normalize parent-tool-reported usage to the supervisor's UsageDetail.
 * Returns null when no billable usage was reported (unknown stays unset;
 * callers decide whether to mark unknown). Never throws.
 */
function normalizeExternalUsage(raw: unknown): UsageDetail | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  // Validated finite non-negative domain: negatives, Infinity, and NaN are
  // dropped (never summed into totals); unrecognized shapes are null.
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
  const input = num(r["input"]) ?? num(r["inputTokens"]);
  const output = num(r["output"]) ?? num(r["outputTokens"]);
  const cacheRead = num(r["cacheRead"]);
  const cacheWrite = num(r["cacheWrite"]);
  let cost: number | null | undefined;
  const c = r["cost"];
  if (typeof c === "number" && Number.isFinite(c) && c >= 0) cost = c;
  else if (c !== null && typeof c === "object" && typeof (c as { total?: unknown }).total === "number" && Number.isFinite((c as { total: number }).total) && (c as { total: number }).total >= 0) cost = (c as { total: number }).total;
  const unknown = r["unknown"] === true;
  if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined && cost === undefined && !unknown) return null;
  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(unknown ? { unknown: true } : {}),
  };
}

function pendingIntentOf(rt: AgentRuntime): string {
  const r = rt.record;
  if (r.desiredLifecycle === "closed") return "closed";
  if (rt.quarantined) return "quarantined";
  if (rt.afterDescendants) return "joining descendants";
  if (r.taskPhase === "reviewing") return "reviewing";
  if (r.taskPhase === "review_queued") return "review queued";
  if (r.taskPhase === "repair_queued") return "repair queued";
  if (rt.parkedStartup !== null) return "queued: waiting for runnable capacity; wait for running work to settle";
  if (rt.queue.some((q) => !q.dispatched)) return r.detail.startsWith("task queued:") ? r.detail : "task queued";
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
