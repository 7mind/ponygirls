/**
 * ponygirls-subagents — domain types.
 *
 * Identity model (kept distinct by construction):
 * - AgentId: logical agent identity (UUID, immutable, never reused).
 * - WorkerInstanceId: one loaded worker process incarnation (fresh per launch).
 * - RootEpoch: one supervisor ownership incarnation (new on every recovery).
 * - TaskRunId: one accepted task (UUID); a task run has one terminal outcome.
 * - ExecutionGeneration: one SDK inference execution within a task run.
 * - ReviewId / CandidateId: gate evaluation and frozen candidate identities.
 *
 * No pi imports here: this module is dependency-free (node builtins only).
 */

export type AgentId = string;
export type TaskRunId = string;
export type MessageId = string;
export type ReviewId = string;
export type CandidateId = string;
export type OperationId = string;
export type WorkerInstanceId = string;
export type RootEpoch = string;
export type SessionId = string;

export const PROTOCOL_VERSION = 1;

/** Provisioned capability profile. Fixed and inspectable. */
export type AgentProfile = "reader" | "writer";

/**
 * How far an agent's tool jobs are separated from the host, least first:
 * - none: host execution in the owner's working directory (writers edit it live);
 * - worktree: host execution; a writer edits its own git worktree;
 * - sandbox: bubblewrap view of a registered repository; a writer edits its own worktree.
 */
export type Isolation = "none" | "worktree" | "sandbox";
export const ISOLATION_LEVELS: readonly Isolation[] = ["none", "worktree", "sandbox"];

/** Commanded lifecycle (desired state). */
export type DesiredLifecycle = "open" | "closed";

/** Observed execution state. Command acceptance and observation are distinct. */
export type ObservedExecution =
  | "queued"
  | "starting"
  | "running"
  | "awaiting_parent"
  | "settled"
  | "lost";

/** Terminal outcome of one execution generation. Absent while unfinished. */
export type GenerationOutcome = "succeeded" | "interrupted" | "failed" | "uncertain";

/**
 * Task phase. A task has exactly one terminal outcome; gate-specific
 * terminal outcomes are defined in gate.ts.
 */
export type TaskPhase =
  | "working"
  | "candidate_recording"
  | "review_queued"
  | "reviewing"
  | "repair_queued"
  | "terminal";

/** Public terminal outcome of a task run (non-gated subset). */
export type TaskOutcome =
  | "succeeded"
  | "failed"
  | "interrupted"
  | "uncertain"
  | "budget_exceeded";

export type Residency = "loaded" | "unloaded";

/** Message delivery mode. */
export type MessageMode = "note" | "steer" | "task";

/**
 * Provider usage summed over reported generations. `inputTokens` is the
 * whole prompt: uncached, cache-read, and cache-write tokens together; the
 * two cache counters are its parts. `reasoningTokens` is the part of
 * `outputTokens` spent on reasoning, summed over the requests whose provider
 * reported that breakdown (null: none did). `cost` is null until a provider
 * reports one. Unknown usage is flagged, never treated as zero.
 */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number | null;
  cost: number | null;
  unknown: boolean;
}

export interface AgentRecord {
  id: AgentId;
  /** Canonical task path, e.g. "/root/builder". Immutable; never reused. */
  path: string;
  rootId: SessionId;
  parentId: AgentId | null;
  depth: number;
  profile: AgentProfile;
  createdEntryId: string;
  nativeSessionPath: string | null;
  grants: GrantSet;
  /** Concrete workspace allocation bound after grant intersection. */
  allocation: WorkspaceAllocation;
  /** Skills and context files snapshotted from the owner at spawn. */
  instructions: InstructionSet;
  instructionHash: string;
  policyRevision: number;
  model: ResolvedModel | null;
  currentTaskRunId: TaskRunId | null;
  executionGeneration: number;
  pendingTaskIds: TaskRunId[];
  pendingMessageIds: MessageId[];
  lastEventSeq: number;
  desiredLifecycle: DesiredLifecycle;
  observed: ObservedExecution;
  outcome: GenerationOutcome | null;
  taskPhase: TaskPhase;
  taskOutcome: string | null;
  residency: Residency;
  detail: string;
  lastActivityAt: string;
  activeDescendants: number;
}

/** Repository-scoped delegable grant (authority, not a path allowlist). */
export interface RepoGrant {
  repoId: string;
  read: boolean;
  write: boolean;
}

export interface GrantSet {
  tools: string[];
  repos: RepoGrant[];
  shell: boolean;
  network: boolean;
  nesting: boolean;
  maxDepth: number;
  /** The agent's own isolation: the least isolated mode it may delegate. */
  isolation: Isolation;
}

/** Concrete filesystem views bound from grants by the supervisor. */
export interface WorkspaceAllocation {
  kind: "reader" | "writer";
  /** Directory the agent's session and tool jobs start in. */
  workdir: string;
  /** Read-only roots of a sandboxed tool view (unused by host execution). */
  readRoots: string[];
  /**
   * Tree a writer modifies: its own worktree, or the owner's live working
   * directory under isolation "none". Null for readers.
   */
  writableRoot: string | null;
  /** Git tree the gate fingerprints a candidate over; null for readers and non-git directories. */
  git: GitTree | null;
  repoId: string | null;
  /** Private scratch directory for sandboxed tool jobs. */
  tmpDir: string;
}

export interface GitTree {
  workTree: string;
  /** Git dir recorded at allocation (host git targets it explicitly). */
  gitDir: string;
  baseCommit: string;
}

/** A context file (AGENTS.md and the like) as the owner's session loaded it. */
export interface ContextFile {
  path: string;
  content: string;
}

/** A skill as listed to the model; the child reads its file on demand. */
export interface SkillRef {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
}

export interface InstructionSet {
  contextFiles: ContextFile[];
  skills: SkillRef[];
}

/** Which of the owner's skills or context files a child receives. */
export type ResourceSelection = "all" | string[];

export interface ResolvedModel {
  provider: string;
  id: string;
  thinkingLevel: string;
}

export interface MailboxMessage {
  id: MessageId;
  rootId: SessionId;
  from: AgentId | "governor";
  to: AgentId | "governor";
  mode: MessageMode;
  text: string;
  taskRunId: TaskRunId | null;
  generation: number | null;
  requestReply: boolean;
  replyTo: MessageId | null;
  createdAt: string;
  /** Durable acceptance sequence; set when journaled. */
  seq: number | null;
  /** Native context receipt once verified at a session boundary. */
  receipt: MessageReceipt | null;
  replied: boolean;
}

export interface MessageReceipt {
  messageId: MessageId;
  nativeEntryId: string;
  leafId: string;
  checkpointSeq: number;
  byteOffset: number;
}

export interface QueuedTask {
  id: TaskRunId;
  agentId: AgentId;
  messageId: MessageId;
  text: string;
  createdAt: string;
  /** Replacement tasks link to the settled run they supersede. */
  replaces: TaskRunId | null;
  dispatched: boolean;
}

export interface PendingQuestion {
  messageId: MessageId;
  from: AgentId;
  to: AgentId | "governor";
  text: string;
  createdAt: string;
  deadlineAt: string;
  answered: boolean;
  cancelled: boolean;
}

/** Wait conditions for wait_agent. */
export type WaitCondition = "activity" | "any_settled" | "all_settled";

export type WaitEndReason =
  | "events"
  | "settled"
  | "timeout"
  | "needs_response"
  | "input"
  | "cancelled";

export interface WaitMessage {
  messageId: MessageId;
  from: string;
  mode: MessageMode;
  text: string;
  requestReply: boolean;
  replyTo: MessageId | null;
}

export interface WaitResult {
  completed: boolean;
  reason: WaitEndReason;
  events: JournalEventView[];
  /** Messages addressed to the waiting caller in the returned range (bounded text). */
  messages: WaitMessage[];
  cursor: number;
  /** Captured task-run IDs / join token preserved across preemption. */
  joinTaskRunIds: TaskRunId[];
  joinToken: string | null;
}

/** Bounded projection of a journal event for tools/UI. */
export interface JournalEventView {
  seq: number;
  kind: string;
  agentId: AgentId | null;
  taskRunId: TaskRunId | null;
  summary: string;
  at: string;
}
