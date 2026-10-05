/**
 * pi-subagents — optional validation gate controller.
 *
 * One controller-managed reviewer/fixer loop, not a workflow engine. A gate
 * validates task output against a frozen rubric; it grants no permissions,
 * publication rights, or merge authority. Approval is a recorded model
 * judgment about the submitted evidence, not proof of correctness.
 *
 * Round semantics: one round = one candidate + one evaluation. The initial
 * candidate is round 1. maxRounds: 3 admits at most three candidates and at
 * most two automatic repairs. maxRounds: null disables the agreement limit
 * (other cost/time/resource budgets still apply; no hidden stagnation cap).
 */

import { randomUUID } from "node:crypto";
import { err } from "./errors.ts";
import type { RunStore } from "./store.ts";
import type { SupervisorPolicy } from "./policy.ts";
import type { AgentId, TaskPhase, TaskRunId } from "./types.ts";

export const DEFAULT_GATE_MAX_ROUNDS = 3;
export const GATE_SCHEMA_VERSION = 1;

export interface GateCheckSpec {
  id: string;
  command: string;
  timeoutMs?: number;
}

export interface GateSpecInput {
  model: { provider: string; id: string };
  thinkingLevel: string;
  prompt: string;
  maxRounds?: number | null;
  checks?: GateCheckSpec[];
  promisedOutputs?: string[];
}

export interface NormalizedGateSpec {
  model: { provider: string; id: string };
  thinkingLevel: string;
  prompt: string;
  maxRounds: number | null;
  checks: GateCheckSpec[];
  promisedOutputs: string[];
  rubricRevision: string;
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
  | "passed"
  | "review_limit_reached"
  | "gate_blocked"
  | "gate_error"
  | "candidate_superseded"
  | "gate_bypassed";

interface GateTaskState {
  agentId: AgentId;
  taskRunId: TaskRunId;
  taskText: string;
  spec: NormalizedGateSpec;
  roundsAdmitted: number;
  reviewerId: AgentId | null;
  candidate: CandidateRecord | null;
  review: {
    reviewId: string;
    status: "running" | "interrupted" | "decided" | "failed";
    candidateId: string;
    decisionUsed: boolean;
  } | null;
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
  createManagedReviewer(mainAgentId: AgentId, taskRunId: TaskRunId, spec: NormalizedGateSpec): AgentId;
  startReviewerExecution(reviewerId: AgentId, input: { reviewId: string; candidateId: string; prompt: string }): void;
  startRepairExecution(mainAgentId: AgentId, taskRunId: TaskRunId, criticism: string): void;
  cancelReviewer(reviewerId: AgentId): Promise<void>;
  fingerprintWorkspace(agentId: AgentId, promisedOutputs: string[]): WorkspaceFingerprint;
  runCheck(agentId: AgentId, check: GateCheckSpec): Promise<{ exitCode: number | null; output: string }>;
  settleGatedTask(agentId: AgentId, taskRunId: TaskRunId, outcome: string, detail: string): void;
  setTaskPhase(agentId: AgentId, phase: TaskPhase): void;
  workspaceMatches(agentId: AgentId, candidate: CandidateRecord): boolean;
  quiescent(agentId: AgentId): boolean;
  nowIso(): string;
}

export function normalizeGateSpec(input: GateSpecInput, policy: SupervisorPolicy): { ok: true; spec: NormalizedGateSpec } | { ok: false; error: ReturnType<typeof err> } {
  if (!input.model || typeof input.model.provider !== "string" || typeof input.model.id !== "string") {
    return { ok: false, error: err("INVALID", "gate.model must carry provider/id") };
  }
  if (typeof input.thinkingLevel !== "string" || !input.thinkingLevel) {
    return { ok: false, error: err("INVALID", "gate.thinkingLevel required") };
  }
  if (typeof input.prompt !== "string" || !input.prompt) {
    return { ok: false, error: err("INVALID", "gate.prompt required") };
  }
  const allowed = policy.allowedModels.some((m) => m.provider === input.model.provider && m.id === input.model.id);
  if (!allowed) {
    return { ok: false, error: err("POLICY_DENIED", `gate model ${input.model.provider}/${input.model.id} not in root allowlist`) };
  }
  let maxRounds: number | null = DEFAULT_GATE_MAX_ROUNDS;
  if (input.maxRounds === null) {
    if (policy.gateMaxRoundsCeiling !== null) {
      return { ok: false, error: err("POLICY_DENIED", "root policy forbids unlimited agreement rounds") };
    }
    maxRounds = null;
  } else if (input.maxRounds === undefined) {
    maxRounds = DEFAULT_GATE_MAX_ROUNDS;
  } else {
    if (!Number.isInteger(input.maxRounds) || (input.maxRounds as number) <= 0) {
      return { ok: false, error: err("INVALID", "gate.maxRounds must be a positive integer or null") };
    }
    maxRounds = input.maxRounds;
  }
  if (maxRounds !== null && policy.gateMaxRoundsCeiling !== null && maxRounds > policy.gateMaxRoundsCeiling) {
    return { ok: false, error: err("POLICY_DENIED", `gate.maxRounds exceeds root ceiling ${policy.gateMaxRoundsCeiling}`) };
  }
  const checks = input.checks ?? [];
  const seen = new Set<string>();
  for (const c of checks) {
    if (!c.id || seen.has(c.id)) return { ok: false, error: err("INVALID", "gate checks need unique ids") };
    seen.add(c.id);
    if (!c.command) return { ok: false, error: err("INVALID", `gate check ${c.id} needs a command`) };
  }
  return {
    ok: true,
    spec: {
      model: { provider: input.model.provider, id: input.model.id },
      thinkingLevel: input.thinkingLevel,
      prompt: input.prompt,
      maxRounds,
      checks,
      promisedOutputs: input.promisedOutputs ?? [],
      rubricRevision: `rubric-${hashString(input.prompt)}`,
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
  private reviewerToTask = new Map<AgentId, TaskRunId>();
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
    return this.reviewerToTask.has(agentId);
  }

  /** Preflight before dispatching the main agent: model, policy, identities. */
  preflight(agentId: AgentId, taskRunId: TaskRunId, input: GateSpecInput, taskText: string): void {
    const normalized = normalizeGateSpec(input, this.host.activePolicy);
    if (!normalized.ok) throw normalized.error;
    if (this.tasks.has(taskRunId)) throw err("CONFLICT", `gate already registered for ${taskRunId}`);
    this.host.runStore.append("gate.registered", {
      agentId,
      taskRunId,
      spec: normalized.spec,
      taskText: taskText.slice(0, 65536),
    });
    this.tasks.set(taskRunId, {
      agentId,
      taskRunId,
      taskText,
      spec: normalized.spec,
      roundsAdmitted: 0,
      reviewerId: null,
      candidate: null,
      review: null,
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
  }

  /** Called by the supervisor when an eligible gated main execution settles. */
  candidateSettled(agentId: AgentId, taskRunId: TaskRunId, generation: number, resultText: string): void {
    const task = this.tasks.get(taskRunId);
    if (!task || task.terminal || task.agentId !== agentId) return;
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
    this.host.runStore.append("gate.candidate", {
      agentId,
      taskRunId,
      candidate,
      resultText: resultText.slice(0, 8000),
    });
    // Stagnation is an observation, never an implicit stop: warn when the
    // candidate or blockers repeat without progress.
    const summary = fingerprintSummary(fingerprint);
    const prev = task.fingerprintHistory[task.fingerprintHistory.length - 1];
    task.fingerprintHistory.push(summary);
    if (prev !== undefined && prev === summary) {
      task.stagnationWarning = `round ${task.roundsAdmitted + 1}: candidate unchanged since previous round; no implicit stop applied`;
    }
    // Durably charge the round at admission, before dispatch.
    task.roundsAdmitted += 1;
    const round = task.roundsAdmitted;
    this.host.runStore.append("gate.round_admitted", {
      agentId,
      taskRunId,
      round,
      candidateId: candidate.candidateId,
      fingerprint: fingerprintSummary(fingerprint),
    });
    if (task.spec.maxRounds !== null && round > task.spec.maxRounds) {
      this.terminate(task, "review_limit_reached", `round ${round} exceeds maxRounds ${task.spec.maxRounds}`);
      return;
    }
    this.host.setTaskPhase(agentId, "review_queued");
    // Run required checks against the paused candidate view first.
    void this.runChecksAndReview(task);
  }

  private async runChecksAndReview(task: GateTaskState): Promise<void> {
    if (task.terminal) return;
    const evidence: Array<{ id: string; exitCode: number | null; output: string }> = [];
    for (const check of task.spec.checks) {
      try {
        const res = await this.host.runCheck(task.agentId, check);
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
    while (task.evidence.length > 30) task.evidence.shift();
    if (task.terminal) return;
    const failedRequired = evidence.filter((e) => e.exitCode !== 0);
    task.review = {
      reviewId: `review-${task.roundsAdmitted}`,
      status: "running",
      candidateId: task.candidate!.candidateId,
      decisionUsed: false,
    };
    if (!task.reviewerId) {
      task.reviewerId = this.host.createManagedReviewer(task.agentId, task.taskRunId, task.spec);
      this.reviewerToTask.set(task.reviewerId, task.taskRunId);
    }
    this.host.setTaskPhase(task.agentId, "reviewing");
    const prompt = this.buildReviewPrompt(task, evidence, failedRequired.length > 0);
    this.host.startReviewerExecution(task.reviewerId, {
      reviewId: task.review.reviewId,
      candidateId: task.candidate!.candidateId,
      prompt,
    });
  }

  private buildReviewPrompt(
    task: GateTaskState,
    evidence: Array<{ id: string; exitCode: number | null; output: string }>,
    hasFailures: boolean,
  ): string {
    const candidate = task.candidate!;
    const lines = [
      `You are the validation reviewer for task ${task.taskRunId}.`,
      ``,
      `Rubric (frozen revision ${task.spec.rubricRevision}):`,
      task.spec.prompt,
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
    lines.push(
      `Return your verdict ONLY through submit_gate_decision with schemaVersion 1, this candidateId, and one of approve (advisories only), revise (at least one blocker with evidenceRefs resolving to candidate:<path>, candidate:answer for the recorded answer text, or <checkId>:output), or blocked (reason + missingPrerequisites). Advisory improvements alone must not force another round.`,
    );
    return lines.join("\n");
  }

  /** Gate-only decision tool intake (reviewer channel only). */
  submitDecision(reviewerId: AgentId, rawArgs: unknown): { ok: true } | { ok: false; error: ReturnType<typeof err> } {
    const taskRunId = this.reviewerToTask.get(reviewerId);
    if (!taskRunId) return { ok: false, error: err("FORBIDDEN", "submit_gate_decision is gate-only") };
    const task = this.tasks.get(taskRunId);
    if (!task || task.terminal || !task.review || !task.candidate) {
      return { ok: false, error: err("STALE_GENERATION", "no active review for this reviewer") };
    }
    if (task.review.status !== "running" || task.review.decisionUsed) {
      return { ok: false, error: err("DUPLICATE_REQUEST", "one decision submission per review execution") };
    }
    const manifestPaths = new Set(task.candidate.fingerprint.files.map((f) => f.path));
    const checkIds = new Set(task.spec.checks.map((c) => c.id));
    const checked = validateGateDecision(rawArgs, task.candidate.candidateId, manifestPaths, checkIds);
    if (!checked.ok) {
      task.review.status = "failed";
      this.terminate(task, "gate_error", `GATE_PROTOCOL_ERROR: ${checked.error.message}`);
      return { ok: false, error: checked.error };
    }
    task.review.decisionUsed = true;
    task.review.status = "decided";
    this.host.runStore.append("gate.decision", {
      agentId: task.agentId,
      taskRunId: task.taskRunId,
      reviewId: task.review.reviewId,
      candidateId: task.candidate.candidateId,
      decision: (checked.decision as { decision: string }).decision,
      blockers: (checked.decision as { blockers?: GateFinding[] }).blockers ?? [],
      advisories: (checked.decision as { advisories?: GateFinding[] }).advisories ?? [],
    });
    // A valid submission closes further gate tool/inference admission; the
    // controller stops/joins the reviewer before committing the outcome so
    // a sequential repair can reuse the lease. Tagged separately from user
    // interruption, timeout, or worker failure.
    void this.host.cancelReviewer(reviewerId).catch(() => {}).then(() => this.applyDecision(task, checked.decision));
    return { ok: true };
  }

  /** Reviewer worker died without a committed verdict. */
  executionFailed(reviewerId: AgentId, diagnostics: string): void {
    const taskRunId = this.reviewerToTask.get(reviewerId);
    if (!taskRunId) return;
    const task = this.tasks.get(taskRunId);
    if (!task || task.terminal || !task.review || task.review.decisionUsed) return;
    task.review.status = "failed";
    this.terminate(task, "gate_error", `reviewer execution failed: ${diagnostics.slice(0, 1000)}`);
  }

  private async applyDecision(task: GateTaskState, decision: GateDecisionInput): Promise<void> {
    if (task.terminal || !task.candidate) return;
    // Verify the verdict still names the current candidate and the workspace
    // still matches its recorded fingerprint before accepting approval.
    if (decision.decision === "approve") {
      if (!this.host.workspaceMatches(task.agentId, task.candidate)) {
        this.terminate(task, "candidate_superseded", "workspace changed during review; verdict not retargeted");
        return;
      }
      const evidenceOk = await this.verifyRequiredEvidence(task);
      if (!evidenceOk.ok) {
        this.terminate(task, "gate_error", `GATE_INVALID_APPROVAL: ${evidenceOk.message}`);
        return;
      }
      this.host.setTaskPhase(task.agentId, "terminal");
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
      `Reviewer requires changes to candidate ${task.candidate.candidateId} (round ${task.roundsAdmitted}):`,
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
    this.host.setTaskPhase(task.agentId, "repair_queued");
    // Reservation clears only when the host confirms dispatch
    // (noteRepairDispatched); a parked repair keeps it, so a cap decrease
    // that would orphan it is rejected with RESERVED_ROUND_CONFLICT.
    this.host.startRepairExecution(task.agentId, task.taskRunId, criticism);
  }

  private async verifyRequiredEvidence(task: GateTaskState): Promise<{ ok: true } | { ok: false; message: string }> {
    for (const check of task.spec.checks) {
      try {
        const res = await this.host.runCheck(task.agentId, check);
        if (res.exitCode !== 0) {
          return { ok: false, message: `required check ${check.id} failed (exit ${res.exitCode})` };
        }
      } catch (e) {
        return { ok: false, message: `required check ${check.id} unavailable: ${(e as Error).message}` };
      }
    }
    return { ok: true };
  }

  private terminate(task: GateTaskState, outcome: GateTerminalOutcome, detail: string): void {
    if (task.terminal) return;
    task.terminal = outcome;
    task.review = null;
    this.host.setTaskPhase(task.agentId, "terminal");
    this.host.settleGatedTask(task.agentId, task.taskRunId, outcome, detail);
  }

  noteRepairDispatched(taskRunId: TaskRunId): void {
    const task = this.tasks.get(taskRunId);
    if (task) task.repairReserved = false;
  }

  /** Recovery: running reviews become interrupted (resumable), never inferred. */
  markInterruptedForRecovery(): void {
    for (const task of this.tasks.values()) {
      if (task.terminal) continue;
      if (task.review && task.review.status === "running") {
        task.review.status = "interrupted";
      }
    }
  }
  cancelForAgent(agentId: AgentId, reason: string): void {
    for (const task of this.tasks.values()) {
      if (task.terminal) continue;
      if (task.agentId !== agentId && task.reviewerId !== agentId) continue;
      if (task.reviewerId) {
        void this.host.cancelReviewer(task.reviewerId).catch(() => {});
      }
      this.terminate(task, reason === "closed" ? "gate_error" : "gate_error", `gate cancelled: ${reason}`);
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
    if (!task.review || task.review.reviewId !== reviewId || task.review.status !== "interrupted") {
      throw err("NOT_FOUND", `no interrupted review ${reviewId} to resume`);
    }
    if (!task.candidate || !this.host.workspaceMatches(task.agentId, task.candidate)) {
      throw err("CONFLICT", "recorded candidate no longer matches; cannot resume");
    }
    task.review.status = "running";
    task.review.decisionUsed = false;
    this.host.setTaskPhase(task.agentId, "reviewing");
    this.host.startReviewerExecution(task.reviewerId!, { reviewId: task.review.reviewId, candidateId: task.candidate.candidateId, prompt: this.buildReviewPrompt(task, [], false) });
  }

  retryReview(priorTaskRunId: TaskRunId, candidateId: string, spec: GateSpecInput, commandId: string): TaskRunId {
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
    const normalized = normalizeGateSpec(spec, this.host.activePolicy);
    if (!normalized.ok) throw normalized.error;
    const taskRunId = randomUUID();
    this.host.runStore.append("gate.registered", {
      agentId: prior.agentId,
      taskRunId,
      spec: normalized.spec,
      taskText: prior.taskText.slice(0, 65536),
      linkedFrom: priorTaskRunId,
    });
    this.tasks.set(taskRunId, {
      agentId: prior.agentId,
      taskRunId,
      taskText: prior.taskText,
      spec: normalized.spec,
      roundsAdmitted: 0,
      reviewerId: prior.reviewerId,
      candidate: null,
      review: null,
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
    if (prior.reviewerId) this.reviewerToTask.set(prior.reviewerId, taskRunId);
    // Assign the verified content as the new run's candidate without rerunning main work.
    const task = this.tasks.get(taskRunId)!;
    task.candidate = { ...prior.candidate, taskRunId };
    task.lastResponse = prior.lastResponse;
    task.previousFindings = [...prior.previousFindings];
    task.roundsAdmitted = 1;
    this.host.runStore.append("gate.round_admitted", { agentId: prior.agentId, taskRunId, round: 1, candidateId: task.candidate.candidateId, retryOf: priorTaskRunId });
    this.host.runStore.append("gate.candidate", { agentId: prior.agentId, taskRunId, candidate: task.candidate, resultText: prior.lastResponse.slice(0, 8000) });
    this.host.setTaskPhase(prior.agentId, "review_queued");
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
      candidate: prior.candidate,
      review: null,
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
    evidence: GateTaskState["evidence"];
    fingerprintHistory: string[];
    stagnationWarning: string | null;
  }): void {
    if (this.tasks.has(restored.taskRunId)) return;
    this.tasks.set(restored.taskRunId, {
      ...restored,
      reviewerId: null,
      review: null,
      repairReserved: false,
    });
  }

  /** Link a restored reviewer identity to its task (recovery only). */
  linkReviewer(reviewerId: AgentId, taskRunId: TaskRunId): void {
    const task = this.tasks.get(taskRunId);
    if (!task || task.terminal) return;
    task.reviewerId = reviewerId;
    this.reviewerToTask.set(reviewerId, taskRunId);
  }

  /** Review state for a reviewer identity: undecided / decided / none. */
  inspectFor(reviewerId: AgentId): "undecided" | "decided" | "none" {
    const taskRunId = this.reviewerToTask.get(reviewerId);
    if (!taskRunId) return "none";
    const task = this.tasks.get(taskRunId);
    if (!task || task.terminal || !task.review) return "none";
    return task.review.decisionUsed ? "decided" : "undecided";
  }
}

export function fingerprintSummary(f: WorkspaceFingerprint): string {
  if (f.textOnly) return `text:${f.textHash}`;
  return `${f.files.length} files @${f.baseCommit?.slice(0, 12) ?? "none"}`;
}

function bypassDetail(reason: string, evidence: Array<{ round: number; id: string; exitCode: number | null; output: string }>): string {
  const failed = evidence.filter((e) => e.exitCode !== 0).slice(-5);
  const lines = [`bypass: ${reason}`];
  for (const e of failed) {
    lines.push(`unperformed/failed check ${e.id} (round ${e.round}, exit ${e.exitCode}): ${e.output.slice(0, 300)}`);
  }
  return lines.join("\n").slice(0, 2000);
}
