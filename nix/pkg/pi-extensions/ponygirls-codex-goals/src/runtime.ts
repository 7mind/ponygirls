/**
 * Admission, dispatch identity, and lifecycle orchestration.
 * No Pi value imports; define minimal ports so tests can drive with fakes.
 */
import { normalizeTokens, elapsedSeconds } from "./accounting.ts";
import {
  blockRecord,
  budgetLimitRecord,
  budgetPermits,
  completeFromBudgetLimited,
  isActiveRecord,
  usageLimitRecord,
  type DispatchId,
  type GoalId,
  type GoalRecord,
  type SessionId,
} from "./goal.ts";
import { renderBudgetWrapup, renderContinuation, renderResync, renderStaleCancellation } from "./prompts.ts";
import { makeDispatchId, type DispatchRecord, type GoalStore, type SidecarEnvelope } from "./store.ts";

export interface ClockPort {
  nowIso(): string;
  nowMs(): number;
}

export interface SessionView {
  sessionId: SessionId;
  sessionFile: string | undefined;
  entryCount(): number;
  entries(): Array<{
    id: string;
    type: string;
    message?: { role?: string; usage?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown } };
  }>;
  isIdle(): boolean;
  hasPendingMessages(): boolean;
}

export interface SenderPort {
  sendGoalInstruction(content: string, details: Record<string, unknown>): void;
  sendNotice(content: string): void;
  appendCommitMeta(meta: Record<string, unknown>): void;
}

export interface AdmissionCheck {
  sessionId: SessionId;
  goal: GoalRecord | null;
  revision: number;
  dispatch: DispatchRecord | null;
  isIdle: boolean;
  hasQueuedInput: boolean;
  admissionDisabled: boolean;
  needsRecovery: boolean;
}

export type ClassifyOutcome =
  | { kind: "empty_no_activity" }
  | { kind: "activity" }
  | { kind: "error_recovered" }
  | { kind: "error_exhausted"; errorText: string }
  | { kind: "quota"; errorText: string }
  | { kind: "aborted" };

export interface RunObservation {
  assistantTexts: string[];
  hadToolActivity: boolean;
  lastAssistant?: { stopReason?: string; errorMessage?: string };
  exhaustedError?: string;
  quotaSignal?: string;
  aborted?: boolean;
}

export class GoalController {
  generation = 0;
  queue: Promise<void> = Promise.resolve();
  admissionDisabled = false;
  needsRecovery = false;
  everCommitted = false;
  emptyStreak = 0;
  executionCount = 0;
  running: { dispatchId: DispatchId | null; goalId: GoalId; spanStartMs: number } | null = null;
  provisional: RunObservation = { assistantTexts: [], hadToolActivity: false };
  lastDispatchContent: { dispatchId: DispatchId; content: string } | null = null;
  store: GoalStore;
  clocks: ClockPort;
  sender: SenderPort;

  constructor(store: GoalStore, clocks: ClockPort, sender: SenderPort) {
    this.store = store;
    this.clocks = clocks;
    this.sender = sender;
  }

  get state(): { generation: number; admissionDisabled: boolean; needsRecovery: boolean; emptyStreak: number } {
    return {
      generation: this.generation,
      admissionDisabled: this.admissionDisabled,
      needsRecovery: this.needsRecovery,
      emptyStreak: this.emptyStreak,
    };
  }

  enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const next = this.queue.then(work);
    // Keep the chain alive across rejections; callers still observe theirs.
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  invalidate(reason: string): void {
    void reason;
    this.generation += 1;
    this.emptyStreak = 0;
  }

  /** Serialize admission-relevant mutations. */
  serialized<T>(work: () => Promise<T> | T): Promise<T> {
    return this.enqueue(work);
  }

  loadState(): { envelope: SidecarEnvelope | null; error?: string } {
    const loaded = this.store.load();
    if (loaded.ok && loaded.value.revision === 0 && this.everCommitted) {
      this.admissionDisabled = true;
      return { envelope: null, error: "Sidecar disappeared after a committed goal: storage failure." };
    }
    if (!loaded.ok) {
      this.admissionDisabled = true;
      // Malformed/missing-when-expected disables admission until recovery.
      if (loaded.error.code === "malformed" || loaded.error.code === "session_mismatch") {
        this.admissionDisabled = true;
      }
      // Absent sidecar with commit evidence is a storage failure.
      if (this.everCommitted) {
        this.admissionDisabled = true;
        return { envelope: null, error: "Sidecar disappeared after a committed goal: storage failure." };
      }
      if (loaded.error.code === "malformed") return { envelope: null, error: loaded.error.message };
      return { envelope: null, error: loaded.error.message };
    }
    const env = loaded.value;
    if (env.revision > 0) this.everCommitted = true;
    if (env.dispatch && env.dispatch.sessionId !== this.store.sessionId) {
      this.admissionDisabled = true;
      return { envelope: env, error: "Dispatch session mismatch." };
    }
    if (env.dispatch) {
      // Unresolved dispatch from a previous process: require explicit resume.
      this.needsRecovery = true;
    }
    return { envelope: env };
  }

  checkAdmission(view: SessionView, envelope: SidecarEnvelope | null): AdmissionCheck {
    return {
      sessionId: view.sessionId,
      goal: envelope?.goal ?? null,
      revision: envelope?.revision ?? 0,
      dispatch: envelope?.dispatch ?? null,
      isIdle: view.isIdle(),
      hasQueuedInput: view.hasPendingMessages(),
      admissionDisabled: this.admissionDisabled,
      needsRecovery: this.needsRecovery,
    };
  }

  canAdmit(check: AdmissionCheck): { ok: boolean; reason: string } {
    if (check.admissionDisabled) return { ok: false, reason: "admission disabled pending recovery" };
    if (check.needsRecovery) return { ok: false, reason: "unresolved dispatch requires /goal resume" };
    if (!isActiveRecord(check.goal)) return { ok: false, reason: "no active goal" };
    if (check.dispatch) return { ok: false, reason: "dispatch already outstanding" };
    if (!check.isIdle) return { ok: false, reason: "agent not idle" };
    if (check.hasQueuedInput) return { ok: false, reason: "user input queued" };
    if (check.goal && !budgetPermits(check.goal)) return { ok: false, reason: "budget exhausted" };
    return { ok: true, reason: "admissible" };
  }

  /** Persist one dispatch admission; caller must recheck invalidation after. */
  admitDispatch(envelope: SidecarEnvelope, view: SessionView): { ok: true; value: SidecarEnvelope } | { ok: false; error: string } {
    if (!envelope.goal || !isActiveRecord(envelope.goal)) {
      return { ok: false, error: "no active goal" };
    }
    if (envelope.dispatch) return { ok: false, error: "dispatch already outstanding" };
    const dispatch: DispatchRecord = {
      dispatchId: makeDispatchId(),
      sessionId: view.sessionId,
      goalId: envelope.goal.id,
      revision: envelope.revision,
      phase: "admitted",
      admittedAt: this.clocks.nowIso(),
    };
    const committed = this.store.commit(envelope.revision, (current) => ({
      ...current,
      dispatch,
    }));
    if (!committed.ok) {
      if (committed.error.code === "storage_failure" || committed.error.code === "indeterminate") {
        this.admissionDisabled = true;
      }
      return { ok: false, error: committed.error.message };
    }
    this.everCommitted = true;
    return { ok: true, value: committed.value };
  }

  /** Enqueue the visible continuation instruction in the same sync segment as the final check. */
  deliverContinuation(
    envelope: SidecarEnvelope,
    view: SessionView,
    generationAtCheck: number,
  ): { ok: true; dispatchId: DispatchId } | { ok: false; error: string } {
    const authoritative = this.store.load();
    if (!authoritative.ok || authoritative.value.revision !== envelope.revision || authoritative.value.goal?.status !== "active") {
      return { ok: false, error: "stale authoritative state before delivery" };
    }
    if (generationAtCheck !== this.generation) {
      return { ok: false, error: "invalidated before delivery" };
    }
    if (view.hasPendingMessages()) {
      return { ok: false, error: "user input queued before delivery" };
    }
    const goal = envelope.goal;
    const dispatch = envelope.dispatch;
    if (!goal || !dispatch) return { ok: false, error: "no admitted dispatch" };
    if (dispatch.sessionId !== view.sessionId || dispatch.goalId !== goal.id) {
      return { ok: false, error: "stale dispatch identity" };
    }
    this.executionCount += 1;
    const content = renderContinuation(goal, envelope.revision, this.executionCount);
    try {
      this.sender.sendGoalInstruction(content, {
        schemaVersion: 1,
        sessionId: view.sessionId,
        goalId: goal.id,
        revision: envelope.revision,
        purpose: "continuation",
        dispatchId: dispatch.dispatchId,
      });
    } catch (err) {
      this.admissionDisabled = true;
      return { ok: false, error: `Transcript write failed after state commit: ${(err as Error).message}. Admission disabled pending recovery.` };
    }
    this.lastDispatchContent = { dispatchId: dispatch.dispatchId, content };
    // Mark running only after delivery is observed via message events
    // (confirmDelivery below); keep admitted until then.
    return { ok: true, dispatchId: dispatch.dispatchId };
  }

  /** Confirm delivery through native message events + metadata. */
  confirmDelivery(dispatchId: DispatchId, envelope: SidecarEnvelope): void {
    if (envelope.dispatch?.dispatchId !== dispatchId) return;
    const committed = this.store.commit(envelope.revision, (current) => ({
      ...current,
      dispatch: current.dispatch ? { ...current.dispatch, phase: "running" as const } : current.dispatch,
    }));
    if (committed.ok) {
      this.running = {
        dispatchId,
        goalId: committed.value.goal!.id,
        spanStartMs: this.clocks.nowMs(),
      };
    }
  }

  cancelStaleDispatch(envelope: SidecarEnvelope, view: SessionView, reason: string): void {
    const dispatch = envelope.dispatch;
    if (!dispatch) return;
    // Preserve the attempted instruction in the log; append cancellation.
    this.sender.sendNotice(
      renderStaleCancellation({
        sessionId: view.sessionId,
        goalId: dispatch.goalId,
        revision: dispatch.revision,
        dispatchId: dispatch.dispatchId,
        reason,
      }),
    );
    const committed = this.store.commit(envelope.revision, (current) => ({ ...current, dispatch: null }));
    if (committed.ok) {
      this.invalidate("stale-cancel");
    } else {
      this.admissionDisabled = true;
    }
  }

  beginRun(goalId: GoalId): void {
    this.running = { goalId, dispatchId: null, spanStartMs: this.clocks.nowMs() };
  }

  settleAccounting(envelope: SidecarEnvelope, view: SessionView) {
    return this.account(envelope, view, true);
  }

  checkpointAccounting(envelope: SidecarEnvelope, view: SessionView) {
    return this.account(envelope, view, false);
  }

  /** Settle attributable accounting for new entries since baseline; enforce budget. */
  private account(
    envelope: SidecarEnvelope,
    view: SessionView,
    finished: boolean,
  ): { envelope: SidecarEnvelope; budgetHit: boolean; unknownUsage: boolean } {
    const goal = envelope.goal;
    if (!goal) return { envelope, budgetHit: false, unknownUsage: false };
    const charged = new Set(envelope.chargedEntryIds);
    let tokens = goal.tokensUsed;
    let unknown = false;
    const baseline = envelope.baselineEntryCount === null ? 0 : envelope.baselineEntryCount;
    const all = view.entries();
    for (const entry of all.slice(baseline)) {
      if (entry.type !== "message" || !entry.message) continue;
      if (charged.has(entry.id)) continue;
      const role = entry.message.role;
      if (role !== "assistant" && role !== "toolResult") continue;
      const usage = entry.message.usage;
      if (!usage) {
        if (role === "assistant") unknown = true;
        continue;
      }
      const normalized = normalizeTokens(usage as Record<string, unknown>);
      if (normalized === undefined) {
        unknown = true;
        continue;
      }
      tokens += normalized;
      charged.add(entry.id);
    }
    // Active time span.
    let timeUsed = goal.timeUsedSeconds;
    let remainder = envelope.remainderMs;
    if (this.running && this.running.goalId === goal.id) {
      const { seconds, remainderMs } = elapsedSeconds(this.running.spanStartMs, this.clocks.nowMs(), envelope.remainderMs);
      timeUsed += seconds;
      remainder = remainderMs;
    }
    const nextGoal: GoalRecord = { ...goal, tokensUsed: tokens, timeUsedSeconds: timeUsed, updatedAt: this.clocks.nowIso() };
    const budgetHit = nextGoal.tokenBudget !== null && nextGoal.tokensUsed >= nextGoal.tokenBudget && nextGoal.status === "active";
    const finalGoal = budgetHit ? { ...nextGoal, status: "budget_limited" as const, updatedAt: this.clocks.nowIso() } : nextGoal;
    const committed = this.store.commit(envelope.revision, (current) => ({
      ...current,
      goal: current.goal ? finalGoal : current.goal,
      chargedEntryIds: [...charged],
      baselineEntryCount: baseline,
      remainderMs: remainder,
      dispatch: finished && current.dispatch !== null && current.dispatch.phase === "running" ? null : current.dispatch,
    }));
    if (!committed.ok) {
      this.admissionDisabled = true;
      this.needsRecovery = true;
      throw new Error(`Goal accounting commit failed: ${committed.error.message}. Admission disabled pending recovery.`);
    }
    this.everCommitted = true;
    if (finished) this.running = null;
    else if (this.running) this.running.spanStartMs = this.clocks.nowMs();
    try {
      this.sender.appendCommitMeta({
        sessionId: view.sessionId,
        goalId: finalGoal.id,
        revision: committed.value.revision,
      });
    } catch (err) {
      this.admissionDisabled = true;
      this.needsRecovery = true;
      throw new Error(`Accounting sidecar committed, but transcript evidence failed: ${(err as Error).message}. Admission disabled pending recovery.`);
    }
    return { envelope: committed.value, budgetHit, unknownUsage: unknown };
  }

  observeAssistantText(text: string): void {
    this.provisional.assistantTexts.push(text);
  }

  observeToolActivity(nested: boolean): void {
    if (!nested) this.provisional.hadToolActivity = true;
  }

  observeAgentEnd(messages: Array<{ role?: string; stopReason?: string; errorMessage?: string; text?: unknown; content?: unknown }>): void {
    // Merge: preserve texts already collected via message_end during the run
    // and supplement with any text carried in the finalized messages array.
    for (const m of messages) {
      if (m.role === "assistant") {
        if (typeof m.text === "string" && m.text.length > 0) {
          this.provisional.assistantTexts.push(m.text);
        } else if (typeof m.content === "string" && m.content.length > 0) {
          this.provisional.assistantTexts.push(m.content);
        } else if (Array.isArray(m.content)) {
          const text = (m.content as Array<{ type?: string; text?: unknown }>)
            .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
            .join("");
          if (text.length > 0) this.provisional.assistantTexts.push(text);
        }
        this.provisional.lastAssistant = { stopReason: m.stopReason, errorMessage: m.errorMessage };
      }
    }
  }

  classifyPreviousExecution(): ClassifyOutcome {
    const texts = this.provisional.assistantTexts.join("").trim();
    if (this.provisional.aborted) return { kind: "aborted" };
    if (this.provisional.lastAssistant?.stopReason === "aborted") {
      return { kind: "error_exhausted", errorText: "Provider aborted without a host abort signal." };
    }
    if (this.provisional.quotaSignal) return { kind: "quota", errorText: this.provisional.quotaSignal };
    if (this.provisional.exhaustedError) {
      return { kind: "error_exhausted", errorText: this.provisional.exhaustedError };
    }
    // At agent_settled, host recovery (retries, compaction, queued work) has
    // already run: a finalized error means exhausted failure. Generic
    // provider errors — including an unclassified HTTP 429 — become blocked.
    // English error prose is never parsed as a quota classifier, and Pi
    // 1.0.0 exposes no typed UsageLimitExceeded equivalent, so the quota
    // branch above is unreachable until the host provides such a signal.
    if (this.provisional.lastAssistant?.stopReason === "error") {
      return {
        kind: "error_exhausted",
        errorText: this.provisional.lastAssistant.errorMessage ?? "provider error",
      };
    }
    if (this.provisional.hadToolActivity) return { kind: "activity" };
    if (texts.length > 0) return { kind: "activity" };
    return { kind: "empty_no_activity" };
  }

  /** Empty-response guard: three consecutive automatic executions with empty answer + no activity. */
  noteSettledOutcome(outcome: ClassifyOutcome): { blocked: boolean } {
    if (outcome.kind === "empty_no_activity") {
      this.emptyStreak += 1;
    } else {
      this.emptyStreak = 0;
    }
    // Reset per-run observation so the next execution starts clean. The
    // extension's own continuation message must never count as activity.
    this.provisional = { assistantTexts: [], hadToolActivity: false };
    return { blocked: this.emptyStreak >= 3 };
  }

  resetStreakOnUserWork(): void {
    this.emptyStreak = 0;
  }

  markRecoveryComplete(): void {
    this.needsRecovery = false;
    this.admissionDisabled = false;
  }

  disableAdmission(): void {
    this.admissionDisabled = true;
  }

  // -- Terminal transitions applied through the store (serialized by callers) --

  applyTerminalTransition(
    envelope: SidecarEnvelope,
    kind: "complete" | "blocked" | "budget" | "usage" | "complete_from_budget",
  ): { ok: true; value: SidecarEnvelope } | { ok: false; error: string } {
    const goal = envelope.goal;
    if (!goal) return { ok: false, error: "No goal." };
    const now = { nowIso: () => this.clocks.nowIso() };
    const next =
      kind === "blocked"
        ? blockRecord(goal, now)
        : kind === "budget"
          ? budgetLimitRecord(goal, now)
          : kind === "usage"
            ? usageLimitRecord(goal, now)
            : kind === "complete_from_budget"
              ? completeFromBudgetLimited(goal, now)
              : { ok: true as const, value: { ...goal, status: "complete" as const, updatedAt: this.clocks.nowIso() } };
    if (!next.ok) return { ok: false, error: (next as { ok: false; error: { message: string } }).error.message };
    const committed = this.store.commit(envelope.revision, (current) => ({
      ...current,
      goal: next.value as GoalRecord,
      dispatch: null,
    }));
    if (!committed.ok) {
      this.admissionDisabled = true;
      return { ok: false, error: committed.error.message };
    }
    this.everCommitted = true;
    this.invalidate(`terminal:${kind}`);
    return { ok: true, value: committed.value };
  }

  emitBudgetWrapup(envelope: SidecarEnvelope): void {
    const goal = envelope.goal;
    if (!goal) return;
    try {
      this.sender.sendGoalInstruction(renderBudgetWrapup(goal, envelope.revision), {
        schemaVersion: 1,
        sessionId: envelope.sessionId,
        goalId: goal.id,
        revision: envelope.revision,
        purpose: "budget_wrapup",
      });
    } catch {
      this.admissionDisabled = true;
    }
  }

  emitResync(envelope: SidecarEnvelope, view: SessionView): void {
    const goal = envelope.goal;
    if (!goal || !isActiveRecord(goal)) return;
    try {
      this.sender.sendGoalInstruction(renderResync(goal, envelope.revision), {
        schemaVersion: 1,
        sessionId: view.sessionId,
        goalId: goal.id,
        revision: envelope.revision,
        purpose: "resync",
      });
    } catch {
      this.admissionDisabled = true;
    }
  }
}
