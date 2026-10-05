/**
 * pi-subagents — domain types.
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
export type CommandId = string;
export type ReviewId = string;
export type CandidateId = string;
export type OperationId = string;
export type WorkerInstanceId = string;
export type RootEpoch = string;
export type SessionId = string;

export const PROTOCOL_VERSION = 1;

/** Provisioned capability profile. Fixed and inspectable. */
export type AgentProfile = "reader" | "writer";

/** Commanded lifecycle (desired state). */
export type DesiredLifecycle = "open" | "closed";

/** Observed execution state. Command acceptance and observation are distinct. */
export type ObservedExecution =
  | "queued"
  | "starting"
  | "running"
  | "awaiting_parent"
  | "awaiting_approval"
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

/** How a sent message relates to a reply. */
export interface ReplyOptions {
  /** Create a question that parks the sender until answered/cancelled. */
  requestReply?: boolean;
  /** Answer a known outstanding question. Mutually exclusive with requestReply. */
  replyTo?: MessageId;
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
  allocation: WorkspaceAllocation | null;
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
}

/** Concrete filesystem views bound from grants by the supervisor. */
export interface WorkspaceAllocation {
  kind: "reader" | "writer";
  /** Read-only input roots approved for this agent. */
  readRoots: string[];
  /** Private worktree for writers; null for readers. */
  worktreePath: string | null;
  baseCommit: string | null;
  repoId: string | null;
  /** Private scratch directory for tool jobs. */
  tmpDir: string;
}

export interface ResolvedModel {
  provider: string;
  id: string;
  thinkingLevel: string;
}

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  /** True when provider accounting was missing (must not be treated as zero). */
  unknown: boolean;
}

export function emptyUsage(): UsageRecord {
  return { inputTokens: 0, outputTokens: 0, cost: null, unknown: false };
}

export interface MailboxMessage {
  id: MessageId;
  rootId: SessionId;
  from: AgentId | "governor";
  to: AgentId;
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

export interface WaitResult {
  completed: boolean;
  reason: WaitEndReason;
  events: JournalEventView[];
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
