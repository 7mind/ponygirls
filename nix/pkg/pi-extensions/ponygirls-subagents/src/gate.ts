/**
 * ponygirls-subagents — optional validation gate controller.
 *
 * A controller-managed reviewer-panel/fixer loop, not a workflow engine. A gate
 * validates task output against a frozen rubric; it grants no permissions,
 * publication rights, or merge authority. Approval is a recorded model
 * judgment about the submitted evidence, not proof of correctness.
 *
 * Round semantics: one round = one candidate + one panel evaluation. The initial
 * candidate is round 1. maxRounds: 3 admits at most three candidates and at
 * most two automatic repairs. maxRounds: null disables the agreement limit
 * (other cost/time/resource budgets still apply; no hidden stagnation cap).
 */

import { createHash, randomUUID } from "node:crypto";
import { err } from "./errors.ts";
import { BASH_DEFAULT_TIMEOUT_MS, BASH_MAX_TIMEOUT_MS, MAX_COMMAND_BYTES } from "./tools.ts";
import type { RunStore } from "./store.ts";
import type { SupervisorPolicy } from "./policy.ts";
import type { AgentId, TaskPhase, TaskRunId } from "./types.ts";

export const DEFAULT_GATE_MAX_ROUNDS = 3;
const CHECK_EVIDENCE_HISTORY_MAX = 30;
/** First words of a repair request the gate sends its main agent (transcripts label it by them). */
export const REPAIR_PREFIX = "Reviewer requires changes to candidate";
export const GATE_SCHEMA_VERSION = 1;

export interface GateCheckSpec {
  id: string;
  command: string;
  timeoutMs?: number;
}

export interface NormalizedGateCheck {
  id: string;
  command: string;
  timeoutMs: number;
}

export interface ReviewerSpecInput {
  model: { provider: string; id: string };
  thinkingLevel?: string;
  prompt?: string;
}

export interface ReviewSpecInput {
  model?: { provider: string; id: string };
  thinkingLevel?: string;
  prompt?: string;
  reviewers?: ReviewerSpecInput[];
}

export interface GateSpecInput extends ReviewSpecInput {
  maxRounds?: number | null;
  checks?: GateCheckSpec[];
  promisedOutputs?: string[];
}

export interface NormalizedReviewerSpec {
  model: { provider: string; id: string };
  thinkingLevel: string;
  prompt: string;
}

export interface NormalizedGateSpec {
  mode: "gate" | "review";
  reviewers: NormalizedReviewerSpec[];
  maxRounds: number | null;
  checks: NormalizedGateCheck[];
  promisedOutputs: string[];
  rubricRevision: string;
}

/** Persisted before panels existed; replay preserves its frozen rubric. */
export function restoreGateSpec(spec: NormalizedGateSpec | (NormalizedReviewerSpec & Omit<NormalizedGateSpec, "mode" | "reviewers">)): NormalizedGateSpec {
  if ("reviewers" in spec) return spec;
  const { model, thinkingLevel, prompt, ...rest } = spec;
  return { ...rest, mode: "gate", reviewers: [{ model, thinkingLevel, prompt }] };
}

export interface WorkspaceFingerprint {
  baseCommit: string | null;
  textOnly: boolean;
  textHash: string | null;
  files: Array<{ path: string; kind: string; mode: string; hash: string }>;
}

export interface CandidateRecord {
  candidateId: string;
  taskRunId: TaskRunId;
  generation: number;
  baseCommit: string | null;
  rubricRevision: string;
  resultRef: string;
  fingerprint: WorkspaceFingerprint;
  createdAt: string;
}

export interface GateFinding {
  id: string;
  target: string;
  problem: string;
  requiredChange: string;
  evidenceRefs: string[];
}

export type GateDecisionInput =
  | { schemaVersion: 1; candidateId: string; decision: "approve"; advisories: GateFinding[] }
  | { schemaVersion: 1; candidateId: string; decision: "revise"; blockers: [GateFinding, ...GateFinding[]]; advisories: GateFinding[] }
  | { schemaVersion: 1; candidateId: string; decision: "blocked"; reason: string; missingPrerequisites: [string, ...string[]] };

export type GateTerminalOutcome =
  | "succeeded"
  | "interrupted"
  | "passed"
  | "review_limit_reached"
  | "gate_blocked"
  | "gate_error"
  | "candidate_superseded"
  | "gate_bypassed";

export interface ReviewFeedback {
  round: number;
  reviewerIndex: number;
  reviewerId: AgentId;
  reviewId: string;
  candidateId: string;
  verdict: GateDecisionInput | null;
  error: string | null;
}

interface ReviewMember {
  reviewerId: AgentId;
  reviewerIndex: number;
  status: "running" | "interrupted" | "decided" | "failed";
  decisionUsed: boolean;
  settled: boolean;
}

interface PanelReview {
  /** Invalidates approval-check continuations across recovery and explicit resumption. */
  application: number;
  reviewId: string;
  status: "running" | "interrupted" | "decided";
  candidateId: string;
  decisionUsed: boolean;
  members: ReviewMember[];
}

interface GateTaskState {
  agentId: AgentId;
  taskRunId: TaskRunId;
  taskText: string;
  spec: NormalizedGateSpec;
  roundsAdmitted: number;
  reviewerId: AgentId | null;
  reviewerIds: AgentId[];
  candidate: CandidateRecord | null;
  review: PanelReview | null;
  feedback: ReviewFeedback[];
  previousFindings: GateFinding[];
  lastResponse: string;
  repairReserved: boolean;
  repairCommandId: string | null;
  terminal: GateTerminalOutcome | null;
  linkedFrom: TaskRunId | null;
  /** Bounded trusted-check evidence per round (controller-executed). */
  evidence: Array<{ round: number; id: string; exitCode: number | null; output: string }>;
  /** Fingerprint summaries per round; repeats raise stagnation warnings. */
  fingerprintHistory: string[];
  stagnationWarning: string | null;
}

/** Supervisor services consumed by the gate (implemented in supervisor.ts). */
export interface GateHost {
  activePolicy: SupervisorPolicy;
  runStore: RunStore;
  startReviewerExecution(reviewerId: AgentId, input: { taskRunId: TaskRunId; reviewId: string; candidateId: string; prompt: string }): void;
  startRepairExecution(mainAgentId: AgentId, taskRunId: TaskRunId, criticism: string): void;
  createReviewerPanel(mainAgentId: AgentId, taskRunId: TaskRunId, spec: NormalizedGateSpec): AgentId[];
  cancelReviewer(reviewerId: AgentId): Promise<void>;
  fingerprintWorkspace(agentId: AgentId, promisedOutputs: string[]): WorkspaceFingerprint;
  /** Check execution carries the EXPECTED task run: admission verifies identity/nonterminal before intent/execution. */
  runCheck(agentId: AgentId, expectedTaskRunId: TaskRunId, check: NormalizedGateCheck): Promise<{ exitCode: number | null; output: string }>;
  settleGatedTask(agentId: AgentId, taskRunId: TaskRunId, outcome: string, detail: string): void;
  /** A linked retry/bypass run becomes the agent's current task run. */
  beginLinkedRun(agentId: AgentId, taskRunId: TaskRunId): void;
  /** Phase mutation carries the EXPECTED task run: mismatched current task rejects (STALE) instead of retargeting. */
  setTaskPhase(agentId: AgentId, expectedTaskRunId: TaskRunId, phase: TaskPhase): void;
  workspaceMatches(agentId: AgentId, candidate: CandidateRecord): boolean;
  quiescent(agentId: AgentId): boolean;
  nowIso(): string;
  feedbackRecorded(): void;
}

export function normalizeGateSpec(input: GateSpecInput, policy: SupervisorPolicy, mode: "gate" | "review" = "gate"): { ok: true; spec: NormalizedGateSpec } | { ok: false; error: ReturnType<typeof err> } {
  if (!input || typeof input !== "object") return { ok: false, error: err("INVALID", "review configuration must be an object") };
  if (mode === "review" && (input.maxRounds !== undefined || input.checks !== undefined || input.promisedOutputs !== undefined)) {
    return { ok: false, error: err("INVALID", "review does not accept gate rounds, checks, or promised outputs") };
  }
  if (input.model !== undefined && input.reviewers !== undefined) return { ok: false, error: err("INVALID", "pass model or reviewers, not both") };
  const slots = input.reviewers === undefined ? [{ model: input.model, thinkingLevel: input.thinkingLevel, prompt: input.prompt }] : input.reviewers;
  if (!Array.isArray(slots) || slots.length === 0) return { ok: false, error: err("INVALID", "reviewers must be a nonempty array") };
  const reviewers: NormalizedReviewerSpec[] = [];
  for (const slot of slots) {
    if (!slot || !slot.model || typeof slot.model.provider !== "string" || !slot.model.provider || typeof slot.model.id !== "string" || !slot.model.id) {
      return { ok: false, error: err("INVALID", "reviewer.model must carry nonempty provider/id") };
    }
    const thinkingLevel = slot.thinkingLevel ?? input.thinkingLevel;
    const prompt = slot.prompt ?? input.prompt;
    if (typeof thinkingLevel !== "string" || !thinkingLevel.trim()) return { ok: false, error: err("INVALID", "reviewer.thinkingLevel required (per reviewer or shared)") };
    if (typeof prompt !== "string" || !prompt.trim()) return { ok: false, error: err("INVALID", "reviewer.prompt required (per reviewer or shared)") };
    const model = slot.model;
    if (policy.allowedModels !== null && !policy.allowedModels.some((m) => m.provider === model.provider && m.id === model.id)) {
      return { ok: false, error: err("POLICY_DENIED", `reviewer model ${model.provider}/${model.id} not in root allowlist`) };
    }
    reviewers.push({ model: { ...model }, thinkingLevel, prompt });
  }
  let maxRounds: number | null = mode === "review" ? 1 : DEFAULT_GATE_MAX_ROUNDS;
  if (input.maxRounds === null) {
    if (policy.gateMaxRoundsCeiling !== null) {
      return { ok: false, error: err("POLICY_DENIED", "root policy forbids unlimited agreement rounds") };
    }
    maxRounds = null;
  } else if (input.maxRounds === undefined) {
    maxRounds = mode === "review" ? 1 : DEFAULT_GATE_MAX_ROUNDS;
  } else {
    if (!Number.isInteger(input.maxRounds) || (input.maxRounds as number) <= 0) {
      return { ok: false, error: err("INVALID", "gate.maxRounds must be a positive integer or null") };
    }
    maxRounds = input.maxRounds;
  }
  if (maxRounds !== null && policy.gateMaxRoundsCeiling !== null && maxRounds > policy.gateMaxRoundsCeiling) {
    return { ok: false, error: err("POLICY_DENIED", `gate.maxRounds exceeds root ceiling ${policy.gateMaxRoundsCeiling}`) };
  }
  const checks: NormalizedGateCheck[] = [];
  const seen = new Set<string>();
  for (const c of input.checks ?? []) {
    if (typeof c.id !== "string" || !c.id || seen.has(c.id)) return { ok: false, error: err("INVALID", "gate checks need unique ids") };
    seen.add(c.id);
    if (typeof c.command !== "string" || !c.command) return { ok: false, error: err("INVALID", `gate check ${c.id} needs a command`) };
    if (Buffer.byteLength(c.command, "utf8") > MAX_COMMAND_BYTES) return { ok: false, error: err("PAYLOAD_TOO_LARGE", `gate check ${c.id} command exceeds ${MAX_COMMAND_BYTES} bytes`) };
    if (c.timeoutMs !== undefined && (!Number.isInteger(c.timeoutMs) || c.timeoutMs < 1 || c.timeoutMs > BASH_MAX_TIMEOUT_MS)) {
      return { ok: false, error: err("INVALID", `gate check ${c.id} timeoutMs must be an integer in 1..${BASH_MAX_TIMEOUT_MS}`) };
    }
    checks.push({ id: c.id, command: c.command, timeoutMs: c.timeoutMs ?? BASH_DEFAULT_TIMEOUT_MS });
  }
  const promisedOutputs = input.promisedOutputs ?? [];
  if (!promisedOutputs.every((p) => typeof p === "string" && p.length > 0)) return { ok: false, error: err("INVALID", "gate promisedOutputs must be nonempty paths") };
  return {
    ok: true,
    spec: {
      mode,
      reviewers,
      maxRounds,
      checks,
      promisedOutputs,
      rubricRevision: `rubric-${hashString(JSON.stringify({ mode, reviewers }))}`,
    },
  };
}

function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function validateGateDecision(
  raw: unknown,
  assignedCandidateId: string,
  manifestPaths: Set<string>,
  checkIds: Set<string>,
): { ok: true; decision: GateDecisionInput } | { ok: false; error: ReturnType<typeof err> } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: err("GATE_PROTOCOL_ERROR", "decision must be an object") };
  }
  const d = raw as Record<string, unknown>;
  const allowedKeys = new Set(["schemaVersion", "candidateId", "decision", "advisories", "blockers", "reason", "missingPrerequisites"]);
  for (const k of Object.keys(d)) {
    if (!allowedKeys.has(k)) return { ok: false, error: err("GATE_PROTOCOL_ERROR", `unknown decision key ${k}`) };
  }
  if (d["schemaVersion"] !== GATE_SCHEMA_VERSION) {
    return { ok: false, error: err("GATE_PROTOCOL_ERROR", "decision.schemaVersion must be 1") };
  }
  if (d["candidateId"] !== assignedCandidateId) {
    return { ok: false, error: err("GATE_PROTOCOL_ERROR", "decision names a different candidate") };
  }
  if (d["decision"] !== "approve" && d["decision"] !== "revise" && d["decision"] !== "blocked") {
    return { ok: false, error: err("GATE_PROTOCOL_ERROR", "decision must be approve/revise/blocked") };
  }
  const checkFindings = (list: unknown, what: string): { ok: true; findings: GateFinding[] } | { ok: false; error: ReturnType<typeof err> } => {
    if (!Array.isArray(list)) return { ok: false, error: err("GATE_PROTOCOL_ERROR", `${what} must be an array`) };
    const ids = new Set<string>();
    for (const f of list) {
      if (typeof f !== "object" || f === null) return { ok: false, error: err("GATE_PROTOCOL_ERROR", `${what} entries must be objects`) };
      const finding = f as Record<string, unknown>;
      for (const field of ["id", "target", "problem", "requiredChange"] as const) {
        if (typeof finding[field] !== "string" || (finding[field] as string).length === 0) {
          return { ok: false, error: err("GATE_PROTOCOL_ERROR", `finding.${field} must be nonempty`) };
        }
      }
      if (ids.has(finding["id"] as string)) return { ok: false, error: err("GATE_PROTOCOL_ERROR", "finding ids must be unique") };
      ids.add(finding["id"] as string);
      if (!Array.isArray(finding["evidenceRefs"])) {
        return { ok: false, error: err("GATE_PROTOCOL_ERROR", "finding.evidenceRefs must be an array") };
      }
      for (const ref of finding["evidenceRefs"] as unknown[]) {
        if (typeof ref !== "string" || !ref) {
          return { ok: false, error: err("GATE_PROTOCOL_ERROR", "evidenceRefs must be nonempty strings") };
        }
        if (!evidenceResolves(ref, assignedCandidateId, manifestPaths, checkIds)) {
          return { ok: false, error: err("GATE_PROTOCOL_ERROR", `evidence ref ${ref} does not resolve to the candidate view`) };
        }
      }
    }
    return { ok: true, findings: list as GateFinding[] };
  };
  if (d["decision"] === "approve") {
    if (d["blockers"] !== undefined) return { ok: false, error: err("GATE_PROTOCOL_ERROR", "approve must not carry blockers") };
    const advisories = checkFindings(d["advisories"] ?? [], "advisories");
    if (!advisories.ok) return advisories;
    return { ok: true, decision: { schemaVersion: 1, candidateId: assignedCandidateId, decision: "approve", advisories: advisories.findings } };
  }
  if (d["decision"] === "revise") {
    const blockers = checkFindings(d["blockers"] ?? [], "blockers");
    if (!blockers.ok) return blockers;
    if (blockers.findings.length === 0) {
      return { ok: false, error: err("GATE_PROTOCOL_ERROR", "revise requires at least one blocker") };
    }
    const advisories = checkFindings(d["advisories"] ?? [], "advisories");
    if (!advisories.ok) return advisories;
    return {
      ok: true,
      decision: { schemaVersion: 1, candidateId: assignedCandidateId, decision: "revise", blockers: blockers.findings as [GateFinding, ...GateFinding[]], advisories: advisories.findings },
    };
  }
  if (typeof d["reason"] !== "string" || !d["reason"]) {
    return { ok: false, error: err("GATE_PROTOCOL_ERROR", "blocked requires a nonempty reason") };
  }
  if (!Array.isArray(d["missingPrerequisites"]) || (d["missingPrerequisites"] as unknown[]).length === 0) {
    return { ok: false, error: err("GATE_PROTOCOL_ERROR", "blocked requires missingPrerequisites") };
  }
  for (const p of d["missingPrerequisites"] as unknown[]) {
    if (typeof p !== "string" || !p) return { ok: false, error: err("GATE_PROTOCOL_ERROR", "missingPrerequisites must be nonempty strings") };
  }
  return {
    ok: true,
    decision: {
      schemaVersion: 1,
      candidateId: assignedCandidateId,
      decision: "blocked",
      reason: d["reason"] as string,
      missingPrerequisites: d["missingPrerequisites"] as [string, ...string[]],
    },
  };
}

function evidenceResolves(ref: string, candidateId: string, manifestPaths: Set<string>, checkIds: Set<string>): boolean {
  // The recorded answer/result text is always in scope, including for
  // text-only tasks without a filesystem view.
  if (ref === `${candidateId}:answer`) return true;
  if (ref.startsWith(`${candidateId}:`)) {
    return manifestPaths.has(ref.slice(candidateId.length + 1));
  }
  const checkId = ref.split(":")[0]!;
  return checkIds.has(checkId);
}

export class GateController {
  private host: GateHost;
  private tasks = new Map<TaskRunId, GateTaskState>();
  /** Every protected reviewer identity (a reviewer stays one after its tasks end). */
  private reviewers = new Set<AgentId>();
  /** Reviewer -> the newest gated task run it reviews for. */
  private reviewerToTask = new Map<AgentId, TaskRunId>();
  private reviewerOwners = new Map<AgentId, AgentId>();
  private commandIds = new Map<string, { action: string; taskRunId: TaskRunId }>();

  constructor(host: GateHost) {
    this.host = host;
  }

  /** Task runs with an active gate (for tree association display). */
  managedTaskFor(agentId: AgentId): TaskRunId | null {
    const taskRunId = this.reviewerToTask.get(agentId);
    if (taskRunId) return taskRunId;
    for (const t of this.tasks.values()) {
      if (t.agentId === agentId && !t.terminal) return t.taskRunId;
    }
    return null;
  }

  isReviewer(agentId: AgentId): boolean {
    return this.reviewers.has(agentId);
  }

  /** Preflight validation of a gate specification (no side effects). */
  validateSpec(input: GateSpecInput, mode: "gate" | "review" = "gate"): NormalizedGateSpec {
    const normalized = normalizeGateSpec(input, this.host.activePolicy, mode);
    if (!normalized.ok) throw normalized.error;
    return normalized.spec;
  }

  /** Register a task with its complete protected reviewer panel before dispatch. */
  register(agentId: AgentId, taskRunId: TaskRunId, spec: NormalizedGateSpec, taskText: string, reviewerIds: AgentId[]): void {
    if (this.tasks.has(taskRunId)) throw err("CONFLICT", `gate already registered for ${taskRunId}`);
    if (reviewerIds.length !== spec.reviewers.length) throw err("INVALID", "reviewer identities do not match the panel");
    const reviewerId = reviewerIds[0]!;
    this.host.runStore.append("gate.registered", { agentId, taskRunId, spec, taskText: taskText.slice(0, 65536), reviewerId, reviewerIds });
    this.tasks.set(taskRunId, {
      agentId,
      taskRunId,
      taskText,
      spec,
      roundsAdmitted: 0,
      reviewerId,
      reviewerIds,
      candidate: null,
      review: null,
      feedback: [],
      previousFindings: [],
      lastResponse: "",
      repairReserved: false,
      repairCommandId: null,
      terminal: null,
      evidence: [],
      fingerprintHistory: [],
      stagnationWarning: null,
      linkedFrom: null,
    });
    for (const id of reviewerIds) this.linkReviewer(id, taskRunId, agentId);
  }

  /** Called by the supervisor when an eligible gated main execution settles. */
  candidateSettled(agentId: AgentId, taskRunId: TaskRunId, generation: number, resultText: string): void {
    const task = this.tasks.get(taskRunId);
    if (!task || task.terminal || task.agentId !== agentId) return;
    try {
      // Freeze the candidate: fingerprint the paused workspace now.
      const fingerprint = this.host.fingerprintWorkspace(agentId, task.spec.promisedOutputs);
      const candidate: CandidateRecord = {
        candidateId: `candidate-${task.roundsAdmitted + 1}`,
        taskRunId,
        generation,
        baseCommit: fingerprint.baseCommit,
        rubricRevision: task.spec.rubricRevision,
        resultRef: `task:${taskRunId}:gen:${generation}`,
        fingerprint,
        createdAt: this.host.nowIso(),
      };
      task.candidate = candidate;
      task.lastResponse = resultText.slice(0, 4000);
      task.repairReserved = false;
      this.host.runStore.append("gate.candidate", { agentId, taskRunId, candidate, resultText: resultText.slice(0, 8000) });
      // Stagnation is an observation, never an implicit stop.
      const summary = fingerprintSummary(fingerprint);
      const prev = task.fingerprintHistory[task.fingerprintHistory.length - 1];
      task.fingerprintHistory.push(summary);
      if (prev !== undefined && prev === summary) {
        task.stagnationWarning = `round ${task.roundsAdmitted + 1}: candidate unchanged since previous round; no implicit stop applied`;
      }
      // Durably charge the round at admission, before dispatch.
      task.roundsAdmitted += 1;
      const round = task.roundsAdmitted;
      this.host.runStore.append("gate.round_admitted", { agentId, taskRunId, round, candidateId: candidate.candidateId, fingerprint: summary });
      if (task.spec.maxRounds !== null && round > task.spec.maxRounds) {
        this.terminate(task, "review_limit_reached", `round ${round} exceeds maxRounds ${task.spec.maxRounds}`);
        return;
      }
      this.host.setTaskPhase(agentId, taskRunId, "review_queued");
    } catch (e) {
      this.terminate(task, "gate_error", `candidate recording failed: ${(e as Error).message}`);
      return;
    }
    // Run required checks against the paused candidate view first.
    void this.runChecksAndReview(task);
  }

  private async runChecksAndReview(task: GateTaskState): Promise<void> {
    try {
      if (task.terminal) return;
      const evidence: Array<{ id: string; exitCode: number | null; output: string }> = [];
      for (const check of task.spec.checks) {
        // Revalidate termination between awaits so an obsolete check never executes on (or phases) a newer run.
        if (task.terminal) return;
        try {
          const res = await this.host.runCheck(task.agentId, task.taskRunId, check);
          evidence.push({ id: check.id, exitCode: res.exitCode, output: res.output.slice(0, 4000) });
        } catch (e) {
          evidence.push({ id: check.id, exitCode: null, output: `check failed to run: ${(e as Error).message}` });
        }
      }
      // Retained per round (bounded): bypass and inspectors reference the
      // failed/unperformed check evidence of terminal runs.
      this.host.runStore.append("gate.evidence", {
        agentId: task.agentId,
        taskRunId: task.taskRunId,
        round: task.roundsAdmitted,
        evidence: evidence.map((e) => ({ id: e.id, exitCode: e.exitCode, output: e.output.slice(0, 2000) })),
      });
      for (const e of evidence) {
        task.evidence.push({ round: task.roundsAdmitted, id: e.id, exitCode: e.exitCode, output: e.output.slice(0, 2000) });
      }
      // Historical retention must never discard a check from the current candidate.
      while (task.evidence.length > Math.max(CHECK_EVIDENCE_HISTORY_MAX, evidence.length)) task.evidence.shift();
      if (task.terminal) return;
      task.review = this.newReview(task);
      this.host.setTaskPhase(task.agentId, task.taskRunId, "reviewing");
      this.startMembers(task, task.reviewerIds, evidence);
    } catch (e) {
      // Admission failures end the run explicitly; they never escape as
      // unhandled rejections.
      this.terminateQuietly(task, "gate_error", `reviewer admission failed: ${(e as Error).message}`);
    }
  }

  private buildReviewPrompt(
    task: GateTaskState,
    evidence: Array<{ id: string; exitCode: number | null; output: string }>,
    hasFailures: boolean,
    reviewerIndex: number,
  ): string {
    const candidate = task.candidate!;
    const lines = [
      `You are reviewer ${reviewerIndex + 1} for task ${task.taskRunId}.`,
      task.spec.mode === "review" ? "This is a one-shot advisory review. Your verdict is returned to the caller; it cannot gate or trigger repairs." : "This is a validation gate; all reviewers must approve the same candidate.",
      ``,
      `Rubric (frozen revision ${task.spec.rubricRevision}):`,
      task.spec.reviewers[reviewerIndex]!.prompt,
      ``,
      `Original task:`,
      task.taskText,
      ``,
      `Candidate ${candidate.candidateId} (base ${candidate.baseCommit ?? "text-only"}, fingerprint ${fingerprintSummary(candidate.fingerprint)}):`,
      task.lastResponse,
      ``,
    ];
    if (evidence.length > 0) {
      lines.push(`Trusted check evidence (controller-executed; model assertions are not evidence):`);
      for (const e of evidence) {
        lines.push(`- ${e.id}: exit=${e.exitCode}\n${e.output}`);
      }
      lines.push(``);
    }
    if (task.previousFindings.length > 0) {
      lines.push(`Previous findings and the main agent's bounded response:`);
      for (const f of task.previousFindings.slice(-10)) {
        lines.push(`- ${f.id} ${f.target}: ${f.problem} => ${f.requiredChange}`);
      }
      lines.push(``);
    }
    if (hasFailures) {
      lines.push(`Required checks failed or are missing. A syntactically valid approve contradicting this evidence is invalid. Use "blocked" when a prerequisite is unavailable, otherwise "revise".`);
      lines.push(``);
    }
    const files = candidate.fingerprint.files.map((f) => `${candidate.candidateId}:${f.path}`).slice(0, 20);
    lines.push(
      `Return your verdict ONLY through submit_gate_decision with schemaVersion 1, candidateId "${candidate.candidateId}", and one of: approve (advisories only); revise (at least one blocker); blocked (reason + missingPrerequisites). Advisory improvements alone must not force another round.`,
      `Every finding's evidenceRefs entries must be exactly one of: "${candidate.candidateId}:answer" (the recorded answer text)${files.length > 0 ? `, a changed file such as ${files.map((f) => `"${f}"`).join(", ")}` : ""}${task.spec.checks.length > 0 ? `, or a check output such as "${task.spec.checks[0]!.id}:output"` : ""}.`,
    );
    return lines.join("\n");
  }

  private newReview(task: GateTaskState): PanelReview {
    if (!task.candidate || task.reviewerIds.length !== task.spec.reviewers.length) throw err("INVALID", "candidate and complete reviewer panel required");
    return {
      application: 0, reviewId: `review-${task.roundsAdmitted}`, status: "running", candidateId: task.candidate.candidateId, decisionUsed: false,
      members: task.reviewerIds.map((reviewerId, reviewerIndex) => ({ reviewerId, reviewerIndex, status: "running", decisionUsed: false, settled: false })),
    };
  }

  private startMembers(task: GateTaskState, reviewerIds: AgentId[], evidence: Array<{ id: string; exitCode: number | null; output: string }>): void {
    const review = task.review!;
    for (const member of review.members) {
      if (task.terminal || task.review !== review || review.status !== "running") return;
      if (member.settled || !reviewerIds.includes(member.reviewerId)) continue;
      try {
        this.host.startReviewerExecution(member.reviewerId, {
          taskRunId: task.taskRunId,
          reviewId: task.reviewerIds.length === 1 ? review.reviewId : `${review.reviewId}/reviewer-${member.reviewerIndex + 1}`,
          candidateId: review.candidateId,
          prompt: this.buildReviewPrompt(task, evidence, evidence.some((e) => e.exitCode !== 0), member.reviewerIndex),
        });
      } catch (e) {
        this.executionFailed(member.reviewerId, (e as Error).message);
      }
    }
    this.finishPanel(task, review);
  }

  /** Reviewer channel only; one independently attributed verdict per panel member. */
  submitDecision(reviewerId: AgentId, rawArgs: unknown): { ok: true } | { ok: false; error: ReturnType<typeof err> } {
    const taskRunId = this.reviewerToTask.get(reviewerId);
    if (!taskRunId) return { ok: false, error: err("FORBIDDEN", "submit_gate_decision is reviewer-only") };
    const task = this.tasks.get(taskRunId);
    const member = task?.review?.members.find((m) => m.reviewerId === reviewerId);
    if (!task || task.terminal || !task.review || !task.candidate || !member) {
      return { ok: false, error: err("STALE_GENERATION", "no active review for this reviewer") };
    }
    if (member.status !== "running" || member.decisionUsed || member.settled) {
      return { ok: false, error: err("DUPLICATE_REQUEST", "one decision submission per review execution") };
    }
    const checked = validateGateDecision(rawArgs, task.candidate.candidateId, new Set(task.candidate.fingerprint.files.map((f) => f.path)), new Set(task.spec.checks.map((c) => c.id)));
    this.recordFeedback(task, member, checked.ok ? checked.decision : null, checked.ok ? null : checked.error.message);
    return checked.ok ? { ok: true } : { ok: false, error: checked.error };
  }

  /** A missing verdict is feedback too; peers still get to finish their reviews. */
  executionFailed(reviewerId: AgentId, diagnostics: string): void {
    const taskRunId = this.reviewerToTask.get(reviewerId);
    const task = taskRunId ? this.tasks.get(taskRunId) : undefined;
    const member = task?.review?.members.find((m) => m.reviewerId === reviewerId);
    if (!task || task.terminal || !member || member.status !== "running" || member.decisionUsed) return;
    this.recordFeedback(task, member, null, `reviewer execution failed: ${diagnostics.slice(0, 1000)}`);
  }

  private recordFeedback(task: GateTaskState, member: ReviewMember, verdict: GateDecisionInput | null, error: string | null): void {
    const review = task.review!;
    const feedback: ReviewFeedback = {
      round: task.roundsAdmitted, reviewerIndex: member.reviewerIndex, reviewerId: member.reviewerId,
      reviewId: review.reviewId, candidateId: review.candidateId, verdict, error,
    };
    this.host.runStore.append(verdict ? "gate.decision" : "gate.review_failed", {
      agentId: task.agentId, taskRunId: task.taskRunId, ...feedback,
      decision: verdict ? verdict.decision : null,
      blockers: verdict?.decision === "revise" ? verdict.blockers : [],
      advisories: verdict && verdict.decision !== "blocked" ? verdict.advisories : [],
    });
    task.feedback.push(feedback);
    member.decisionUsed = verdict !== null;
    member.status = verdict ? "decided" : "failed";
    this.host.feedbackRecorded();
    // Release each worker before the barrier: a one-slot scheduler can drain a panel.
    void this.host.cancelReviewer(member.reviewerId).then(() => {
      if (task.review !== review || task.terminal) return;
      member.settled = true;
      this.finishPanel(task, review);
    }).catch((e: unknown) => this.terminateQuietly(task, "gate_error", `review cleanup failed: ${(e as Error).message}`));
  }

  private finishPanel(task: GateTaskState, review: PanelReview): void {
    if (task.terminal || task.review !== review || review.status !== "running" || review.decisionUsed || !review.members.every((m) => m.settled)) return;
    review.decisionUsed = true;
    review.status = "decided";
    const feedback = this.orderedFeedback(task, task.roundsAdmitted);
    if (feedback.length !== review.members.length) throw err("GATE_PROTOCOL_ERROR", "panel completed without exactly one report per reviewer");
    if (task.spec.mode === "review") {
      this.terminate(task, "succeeded", `review-only: ${feedback.length} reviews returned; no acceptance verdict or automatic repairs`);
      return;
    }
    const errors = feedback.filter((f) => f.error !== null);
    if (errors.length > 0) {
      this.terminate(task, "gate_error", errors.map((f) => `reviewer ${f.reviewerIndex + 1}: ${f.error}`).join("\n"));
      return;
    }
    const blockers: GateFinding[] = [];
    const advisories: GateFinding[] = [];
    const blockedReasons: string[] = [];
    const prerequisites: string[] = [];
    for (const f of feedback) {
      const d = f.verdict!;
      const attribute = (finding: GateFinding): GateFinding => ({ ...finding, id: feedback.length === 1 ? finding.id : `reviewer-${f.reviewerIndex + 1}/${finding.id}` });
      if (d.decision === "blocked") {
        blockedReasons.push(`reviewer ${f.reviewerIndex + 1}: ${d.reason}`);
        prerequisites.push(...d.missingPrerequisites);
      } else {
        advisories.push(...d.advisories.map(attribute));
        if (d.decision === "revise") blockers.push(...d.blockers.map(attribute));
      }
    }
    const candidateId = review.candidateId;
    const decision: GateDecisionInput = blockedReasons.length > 0
      ? { schemaVersion: 1, candidateId, decision: "blocked", reason: blockedReasons.join("\n"), missingPrerequisites: prerequisites as [string, ...string[]] }
      : blockers.length > 0
        ? { schemaVersion: 1, candidateId, decision: "revise", blockers: blockers as [GateFinding, ...GateFinding[]], advisories }
        : { schemaVersion: 1, candidateId, decision: "approve", advisories };
    const application = ++review.application;
    void this.applyDecision(task, review, application, decision).catch((e: unknown) => {
      if (this.applying(task, review, application)) this.terminateQuietly(task, "gate_error", `decision application failed: ${(e as Error).message}`);
    });
  }

  private orderedFeedback(task: GateTaskState, round: number | null): ReviewFeedback[] {
    return task.feedback.filter((f) => round === null || f.round === round).sort((a, b) => a.round - b.round || a.reviewerIndex - b.reviewerIndex);
  }

  report(taskRunId: TaskRunId): { text: string; count: number } {
    const task = this.tasks.get(taskRunId);
    if (!task) return { text: "", count: 0 };
    const feedback = this.orderedFeedback(task, null);
    return { count: feedback.length, text: feedback.map((f) => {
      const model = task.spec.reviewers[f.reviewerIndex]!.model;
      return `## Round ${f.round} · reviewer ${f.reviewerIndex + 1} · ${model.provider}/${model.id} · ${f.reviewerId}\nCandidate ${f.candidateId}\n${f.verdict ? JSON.stringify(f.verdict, null, 2) : `Review failed: ${f.error}`}`;
    }).join("\n\n") };
  }

  private applying(task: GateTaskState, review: PanelReview, application: number): boolean {
    return !task.terminal && task.review === review && review.status === "decided" && review.application === application;
  }

  private async applyDecision(task: GateTaskState, review: PanelReview, application: number, decision: GateDecisionInput): Promise<void> {
    if (!this.applying(task, review, application) || !task.candidate) return;
    // Verify the verdict still names the current candidate and the workspace
    // still matches its recorded fingerprint before accepting approval.
    if (decision.decision === "approve") {
      if (!this.host.workspaceMatches(task.agentId, task.candidate)) {
        this.terminate(task, "candidate_superseded", "workspace changed during review; verdict not retargeted");
        return;
      }
      const evidenceOk = await this.verifyRequiredEvidence(task, review, application);
      if (!this.applying(task, review, application)) return;
      if (!evidenceOk.ok) {
        this.terminate(task, "gate_error", `GATE_INVALID_APPROVAL: ${evidenceOk.message}`);
        return;
      }
      this.terminate(task, "passed", `approved candidate ${task.candidate.candidateId}`);
      return;
    }
    if (decision.decision === "blocked") {
      this.terminate(task, "gate_blocked", decision.reason);
      return;
    }
    // revise
    task.previousFindings = [...decision.blockers, ...decision.advisories];
    if (task.spec.maxRounds !== null && task.roundsAdmitted >= task.spec.maxRounds) {
      this.terminate(task, "review_limit_reached", `valid revise at round ${task.roundsAdmitted}; no repair dispatched`);
      return;
    }
    // Commit the decision and one deduplicated repair command before dispatch.
    const commandId = `repair:${task.review!.reviewId}`;
    if (task.repairCommandId === commandId) return; // deduplicated
    task.repairCommandId = commandId;
    task.repairReserved = true;
    const criticism = [
      `${REPAIR_PREFIX} ${task.candidate.candidateId} (round ${task.roundsAdmitted}):`,
      ...decision.blockers.map((b) => `- [${b.id}] ${b.target}: ${b.problem} Required: ${b.requiredChange} (evidence: ${b.evidenceRefs.join(", ")})`),
      ...(decision.advisories.length > 0
        ? [`Advisories (do not block):`, ...decision.advisories.map((a) => `- [${a.id}] ${a.target}: ${a.problem}`)]
        : []),
    ].join("\n");
    this.host.runStore.append("gate.repair_command", {
      agentId: task.agentId,
      taskRunId: task.taskRunId,
      reviewId: task.review!.reviewId,
      commandId,
      blockers: decision.blockers.length,
      criticism: criticism.slice(0, 8000),
    });
    // Phase ownership stays in the supervisor: startRepairExecution verifies
    // task identity (STALE_GENERATION) before mutating phase, so an obsolete
    // repair never retargets a newer taskphase. Do not set phase here.
    // The reservation holds until the repaired candidate is admitted, so a
    // cap decrease that would orphan a queued or running repair is rejected
    // with RESERVED_ROUND_CONFLICT.
    this.host.startRepairExecution(task.agentId, task.taskRunId, criticism);
  }

  private async verifyRequiredEvidence(task: GateTaskState, review: PanelReview, application: number): Promise<{ ok: true } | { ok: false; message: string }> {
    // Approval-time rechecks carry the same binding policy as admission checks.
    // Reachability note: post-H1, a newer run cannot start during live review,
    // so rechecks normally still target the reviewed run; terminal/interrupt
    // between awaits aborts via the per-iteration check below.
    for (const check of task.spec.checks) {
      if (!this.applying(task, review, application)) return { ok: false, message: "review interrupted during approval recheck" };
      try {
        const res = await this.host.runCheck(task.agentId, task.taskRunId, check);
        if (res.exitCode !== 0) {
          return { ok: false, message: `required check ${check.id} failed (exit ${res.exitCode})` };
        }
      } catch (e) {
        return { ok: false, message: `required check ${check.id} unavailable: ${(e as Error).message}` };
      }
    }
    return { ok: true };
  }

  /** terminate() from an async path: a failing store must not become an unhandled rejection. */
  private terminateQuietly(task: GateTaskState, outcome: GateTerminalOutcome, detail: string): void {
    try {
      this.terminate(task, outcome, detail);
    } catch {
      // The store refused the write; it already reports its failure.
    }
  }

  private terminate(task: GateTaskState, outcome: GateTerminalOutcome, detail: string): void {
    if (task.terminal) return;
    task.terminal = outcome;
    task.review = null;
    // A terminal gate admits no further reviewer inference.
    for (const reviewerId of task.reviewerIds) void this.host.cancelReviewer(reviewerId);
    this.host.settleGatedTask(task.agentId, task.taskRunId, outcome, detail);
  }

  /** The supervisor settled the gated run itself (main failed/interrupted/lost). */
  cancelTask(taskRunId: TaskRunId, outcome: string): void {
    const task = this.tasks.get(taskRunId);
    if (!task || task.terminal) return;
    task.terminal = outcome as GateTerminalOutcome;
    task.review = null;
    for (const reviewerId of task.reviewerIds) void this.host.cancelReviewer(reviewerId);
  }

  /**
   * Interrupt the gated work of an agent. A running main generation settles
   * itself as interrupted; a task paused in review or repair stops here.
   * Interrupting the reviewer itself leaves an interrupted, resumable review.
   */
  interruptForAgent(agentId: AgentId, mainActive: boolean): void {
    for (const task of this.tasks.values()) {
      if (task.terminal) continue;
      if (task.reviewerIds.includes(agentId)) {
        const member = task.review?.members.find((m) => m.reviewerId === agentId);
        if (member?.status === "running") {
          member.status = "interrupted";
          task.review!.status = "interrupted";
        }
        void this.host.cancelReviewer(agentId);
        continue;
      }
      if (task.agentId !== agentId) continue;
      // The outcome is decided before the reviewer stops, so its stop cannot
      // be mistaken for a failed review.
      if (!mainActive) this.terminate(task, "interrupted", "gated task interrupted during review/repair");
      else for (const reviewerId of task.reviewerIds) void this.host.cancelReviewer(reviewerId);
    }
  }

  /** Reviewer identities owned by gated tasks of a main agent. */
  reviewersOf(agentId: AgentId): AgentId[] {
    const out = new Set<AgentId>();
    for (const [reviewerId, owner] of this.reviewerOwners) if (owner === agentId) out.add(reviewerId);
    for (const task of this.tasks.values()) {
      if (task.agentId === agentId) for (const reviewerId of task.reviewerIds) out.add(reviewerId);
    }
    return [...out];
  }

  /** Recovery: running reviews become interrupted (resumable), never inferred. */
  markInterruptedForRecovery(): void {
    for (const task of this.tasks.values()) {
      if (task.terminal) continue;
      if (task.review && task.repairCommandId !== `repair:${task.review.reviewId}`) {
        task.review.application++;
        task.review.status = "interrupted";
        task.review.decisionUsed = false;
        for (const member of task.review.members) {
          if (member.status === "running") member.status = "interrupted";
          if (member.status === "decided" || member.status === "failed") member.settled = true;
        }
      }
    }
  }

  // -- typed governor controls -----------------------------------------------------

  private dedupCommand(commandId: string, action: string, taskRunId: TaskRunId): void {
    const prior = this.commandIds.get(commandId);
    if (prior) {
      if (prior.action === action && prior.taskRunId === taskRunId) {
        throw err("DUPLICATE_REQUEST", `command ${commandId} already applied`);
      }
      throw err("DUPLICATE_REQUEST", `conflicting reuse of command ${commandId}`);
    }
    this.commandIds.set(commandId, { action, taskRunId });
  }

  resumeReview(taskRunId: TaskRunId, reviewId: string, commandId: string): void {
    this.dedupCommand(commandId, "resume_review", taskRunId);
    const task = this.tasks.get(taskRunId);
    if (!task || task.terminal) throw err("NOT_FOUND", `no nonterminal gated task ${taskRunId}`);
    if (!task.review || task.review.reviewId !== reviewId || task.review.status !== "interrupted" || task.repairCommandId === `repair:${reviewId}`) {
      throw err("NOT_FOUND", `no interrupted review ${reviewId} to resume`);
    }
    if (!task.candidate || !this.host.workspaceMatches(task.agentId, task.candidate)) {
      throw err("CONFLICT", "recorded candidate no longer matches; cannot resume");
    }
    task.review.status = "running";
    task.review.decisionUsed = false;
    const pending = task.review.members.filter((m) => m.status === "interrupted");
    for (const member of pending) member.status = "running";
    this.host.setTaskPhase(task.agentId, taskRunId, "reviewing");
    this.startMembers(task, pending.map((m) => m.reviewerId), task.evidence.filter((e) => e.round === task.roundsAdmitted));
  }

  /** `spec` null reviews under the prior run's own specification (revalidated against current policy). */
  retryReview(priorTaskRunId: TaskRunId, candidateId: string, spec: GateSpecInput | null, commandId: string): TaskRunId {
    this.dedupCommand(commandId, "retry_review", priorTaskRunId);
    const prior = this.tasks.get(priorTaskRunId);
    if (!prior || !prior.terminal) throw err("NOT_FOUND", `no terminal run ${priorTaskRunId}`);
    if (!prior.candidate || prior.candidate.candidateId !== candidateId) {
      throw err("NOT_FOUND", `candidate ${candidateId} not recorded for ${priorTaskRunId}`);
    }
    if (!this.host.quiescent(prior.agentId)) throw err("CONFLICT", "actor/workspace not quiescent");
    if (!this.host.workspaceMatches(prior.agentId, prior.candidate)) {
      throw err("CONFLICT", "candidate no longer matches current workspace; submit current work as a new task");
    }
    const normalized = normalizeGateSpec(spec ?? prior.spec, this.host.activePolicy);
    if (!normalized.ok) throw normalized.error;
    const taskRunId = randomUUID();
    const sameReviewers = JSON.stringify(normalized.spec.reviewers) === JSON.stringify(prior.spec.reviewers);
    const reviewerIds = sameReviewers ? [...prior.reviewerIds] : this.host.createReviewerPanel(prior.agentId, taskRunId, normalized.spec);
    this.host.runStore.append("gate.registered", {
      agentId: prior.agentId,
      taskRunId,
      spec: normalized.spec,
      taskText: prior.taskText.slice(0, 65536),
      linkedFrom: priorTaskRunId,
      reviewerId: reviewerIds[0]!,
      reviewerIds,
    });
    this.tasks.set(taskRunId, {
      agentId: prior.agentId,
      taskRunId,
      taskText: prior.taskText,
      spec: normalized.spec,
      roundsAdmitted: 0,
      reviewerId: reviewerIds[0]!,
      reviewerIds,
      candidate: null,
      review: null,
      feedback: [],
      previousFindings: [],
      lastResponse: prior.lastResponse,
      repairReserved: false,
      repairCommandId: null,
      terminal: null,
      evidence: [],
      fingerprintHistory: [],
      stagnationWarning: null,
      linkedFrom: priorTaskRunId,
    });
    for (const reviewerId of reviewerIds) this.linkReviewer(reviewerId, taskRunId, prior.agentId);
    this.host.beginLinkedRun(prior.agentId, taskRunId);
    // Assign the verified content as the new run's candidate without rerunning main work.
    const task = this.tasks.get(taskRunId)!;
    task.candidate = { ...prior.candidate, taskRunId };
    task.lastResponse = prior.lastResponse;
    task.previousFindings = [...prior.previousFindings];
    task.roundsAdmitted = 1;
    this.host.runStore.append("gate.round_admitted", { agentId: prior.agentId, taskRunId, round: 1, candidateId: task.candidate.candidateId, retryOf: priorTaskRunId });
    this.host.runStore.append("gate.candidate", { agentId: prior.agentId, taskRunId, candidate: task.candidate, resultText: prior.lastResponse.slice(0, 8000) });
    this.host.setTaskPhase(prior.agentId, taskRunId, "review_queued");
    void this.runChecksAndReview(task);
    return taskRunId;
  }

  bypass(priorTaskRunId: TaskRunId, candidateId: string, reason: string, commandId: string): TaskRunId {
    this.dedupCommand(commandId, "bypass", priorTaskRunId);
    if (!this.host.activePolicy.gateBypassAllowed) throw err("FORBIDDEN", "root policy forbids gate bypass");
    if (!reason) throw err("INVALID", "bypass requires a reason");
    const prior = this.tasks.get(priorTaskRunId);
    if (!prior || !prior.terminal) throw err("NOT_FOUND", `no terminal run ${priorTaskRunId}`);
    if (!prior.candidate || prior.candidate.candidateId !== candidateId) throw err("NOT_FOUND", `candidate ${candidateId} not recorded`);
    if (!this.host.quiescent(prior.agentId)) throw err("CONFLICT", "actor/workspace not quiescent");
    if (!this.host.workspaceMatches(prior.agentId, prior.candidate)) {
      throw err("CONFLICT", "candidate no longer matches the current workspace; reconcile and submit current work as a new task");
    }
    const taskRunId = randomUUID();
    this.host.runStore.append("gate.registered", {
      agentId: prior.agentId,
      taskRunId,
      spec: prior.spec,
      taskText: prior.taskText.slice(0, 65536),
      linkedFrom: priorTaskRunId,
    });
    this.tasks.set(taskRunId, {
      agentId: prior.agentId,
      taskRunId,
      taskText: prior.taskText,
      spec: prior.spec,
      roundsAdmitted: prior.roundsAdmitted,
      reviewerId: null,
      reviewerIds: [],
      candidate: prior.candidate,
      review: null,
      feedback: [],
      previousFindings: [],
      lastResponse: prior.lastResponse,
      repairReserved: false,
      repairCommandId: null,
      terminal: "gate_bypassed",
      linkedFrom: priorTaskRunId,
      evidence: [...prior.evidence],
      fingerprintHistory: [...prior.fingerprintHistory],
      stagnationWarning: prior.stagnationWarning,
    });
    this.host.beginLinkedRun(prior.agentId, taskRunId);
    this.host.settleGatedTask(prior.agentId, taskRunId, "gate_bypassed", bypassDetail(reason, prior.evidence));
    return taskRunId;
  }

  setLimits(taskRunId: TaskRunId, maxRounds: number | null, commandId: string): void {
    this.dedupCommand(commandId, "set_limits", taskRunId);
    const task = this.tasks.get(taskRunId);
    if (!task || task.terminal) throw err("NOT_FOUND", `no nonterminal gated task ${taskRunId}`);
    if (maxRounds !== null && (!Number.isInteger(maxRounds) || maxRounds <= 0)) {
      throw err("INVALID", "maxRounds must be a positive integer or null");
    }
    const ceiling = this.host.activePolicy.gateMaxRoundsCeiling;
    if (maxRounds === null && ceiling !== null) throw err("POLICY_DENIED", "root policy forbids unlimited rounds");
    if (maxRounds !== null && ceiling !== null && maxRounds > ceiling) {
      throw err("POLICY_DENIED", `maxRounds exceeds root ceiling ${ceiling}`);
    }
    if (maxRounds !== null && maxRounds < task.roundsAdmitted) {
      throw err("INVALID", `cannot cap below admitted rounds (${task.roundsAdmitted})`);
    }
    // A decrease is allowed only between evaluations/repairs and must not
    // orphan durably reserved next-round work.
    if (maxRounds !== null && task.repairReserved) {
      const needed = task.roundsAdmitted + 1;
      if (maxRounds < needed) {
        throw err("RESERVED_ROUND_CONFLICT", `repair for round ${needed} already reserved; new cap ${maxRounds} excludes it`);
      }
    }
    if (maxRounds !== null && task.review && task.review.status === "running") {
      if (maxRounds < task.roundsAdmitted) {
        throw err("RESERVED_ROUND_CONFLICT", "cannot decrease below the admitted round mid-evaluation");
      }
    }
    task.spec = { ...task.spec, maxRounds };
    this.host.runStore.append("gate.limits", { agentId: task.agentId, taskRunId, maxRounds, commandId });
  }

  inspect(taskRunId: TaskRunId): GateTaskState | null {
    return this.tasks.get(taskRunId) ?? null;
  }

  /**
   * Restore a gate task from the journal (recovery only). Counters,
   * candidates, findings, and terminal outcomes are preserved exactly;
   * nothing is re-admitted or re-applied.
   */
  importTask(restored: {
    agentId: AgentId;
    taskRunId: TaskRunId;
    taskText: string;
    spec: NormalizedGateSpec;
    roundsAdmitted: number;
    candidate: CandidateRecord | null;
    previousFindings: GateFinding[];
    lastResponse: string;
    repairCommandId: string | null;
    terminal: GateTerminalOutcome | null;
    linkedFrom: TaskRunId | null;
    reviewerId: AgentId | null;
    reviewerIds: AgentId[];
    feedback: ReviewFeedback[];
    evidence: GateTaskState["evidence"];
    fingerprintHistory: string[];
    stagnationWarning: string | null;
  }): void {
    if (this.tasks.has(restored.taskRunId)) return;
    this.tasks.set(restored.taskRunId, { ...restored, review: null, repairReserved: false });
    // Imported in journal order: a later (linked) run takes the reviewer.
    for (const reviewerId of restored.reviewerIds) this.linkReviewer(reviewerId, restored.taskRunId, restored.agentId);
  }

  /** Retain ownership even if panel creation fails before gate registration. */
  linkReviewer(reviewerId: AgentId, taskRunId: TaskRunId, mainAgentId: AgentId | null): void {
    this.reviewers.add(reviewerId);
    if (mainAgentId !== null) this.reviewerOwners.set(reviewerId, mainAgentId);
    const task = this.tasks.get(taskRunId);
    if (!task) {
      this.reviewerToTask.set(reviewerId, taskRunId);
      return;
    }
    task.reviewerId ??= reviewerId;
    if (!task.reviewerIds.includes(reviewerId)) task.reviewerIds.push(reviewerId);
    if (!task.terminal || !this.reviewerToTask.has(reviewerId)) this.reviewerToTask.set(reviewerId, taskRunId);
  }

  /** Rebuild an interrupted panel, including a fully reported but unapplied barrier. */
  restoreReview(taskRunId: TaskRunId): void {
    const task = this.tasks.get(taskRunId)!;
    if (task.terminal || !task.candidate || task.roundsAdmitted === 0 || task.repairCommandId === `repair:review-${task.roundsAdmitted}`) return;
    const review = this.newReview(task);
    review.status = "interrupted";
    for (const member of review.members) {
      const feedback = task.feedback.find((f) => f.round === task.roundsAdmitted && f.reviewerId === member.reviewerId);
      member.status = feedback ? (feedback.verdict ? "decided" : "failed") : "interrupted";
      member.decisionUsed = feedback !== undefined && feedback.verdict !== null;
      member.settled = feedback !== undefined;
    }
    task.review = review;
  }

  /** Review state for a reviewer identity: undecided / decided / none. */
  inspectFor(reviewerId: AgentId): "undecided" | "decided" | "none" {
    const taskRunId = this.reviewerToTask.get(reviewerId);
    if (!taskRunId) return "none";
    const task = this.tasks.get(taskRunId);
    if (!task || task.terminal || !task.review) return "none";
    const member = task.review.members.find((m) => m.reviewerId === reviewerId);
    if (!member) return "none";
    if (member.decisionUsed) return "decided";
    return member.status === "running" ? "undecided" : "none";
  }
}

/** Content-addressed summary: equal summaries mean equal manifests (paths, kinds, modes, hashes). */
export function fingerprintSummary(f: WorkspaceFingerprint): string {
  if (f.textOnly) return `text:${f.textHash}`;
  const digest = createHash("sha256").update(JSON.stringify(f.files)).digest("hex").slice(0, 16);
  return `${f.files.length} files @${f.baseCommit?.slice(0, 12) ?? "none"} #${digest}`;
}

function bypassDetail(reason: string, evidence: Array<{ round: number; id: string; exitCode: number | null; output: string }>): string {
  const failed = evidence.filter((e) => e.exitCode !== 0).slice(-5);
  const lines = [`bypass: ${reason}`];
  for (const e of failed) {
    lines.push(`unperformed/failed check ${e.id} (round ${e.round}, exit ${e.exitCode}): ${e.output.slice(0, 300)}`);
  }
  return lines.join("\n").slice(0, 2000);
}
