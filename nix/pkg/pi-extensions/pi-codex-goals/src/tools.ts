/** Model-tool handlers. Pure logic; Pi ToolDefinition wiring lives in index.ts. */
import {
  completeRecord,
  blockRecord,
  pauseRecord,
  modelCreate,
  validateObjective,
  validateTokenBudget,
  type GoalId,
  type GoalRecord,
} from "./goal.ts";
import { makeGoalId, type GoalStore, type SidecarEnvelope } from "./store.ts";

export interface ToolOutcome {
  state: GoalRecord | null;
  revision: number;
  remainingTokens: number | null;
  content: string;
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

function remainingTokens(record: GoalRecord | null): number | null {
  if (!record || record.tokenBudget === null) return null;
  return Math.max(0, record.tokenBudget - record.tokensUsed);
}

function statePayload(record: GoalRecord | null, revision: number): Record<string, unknown> {
  if (!record) {
    return { status: "none", revision };
  }
  return {
    id: record.id,
    objective: record.objective,
    status: record.status,
    tokenBudget: record.tokenBudget,
    tokensUsed: record.tokensUsed,
    timeUsedSeconds: record.timeUsedSeconds,
    remainingTokens: remainingTokens(record),
    revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function handleCreateGoal(
  store: GoalStore,
  envelope: SidecarEnvelope,
  args: unknown,
  clocks: { nowIso(): string },
): ToolOutcome {
  const params = (args ?? {}) as { objective?: unknown; token_budget?: unknown };
  const obj = validateObjective(params.objective);
  if (!obj.ok) {
    return {
      state: envelope.goal,
      revision: envelope.revision,
      remainingTokens: remainingTokens(envelope.goal),
      content: `create_goal rejected: ${obj.error.message} Create only after an explicit user, system, or developer request; do not infer goal creation from an ordinary task.`,
      structuredContent: { ...statePayload(envelope.goal, envelope.revision), error: obj.error.message },
      isError: true,
    };
  }
  const budget = validateTokenBudget(params.token_budget ?? null);
  if (!budget.ok) {
    return {
      state: envelope.goal,
      revision: envelope.revision,
      remainingTokens: remainingTokens(envelope.goal),
      content: `create_goal rejected: ${budget.error.message} Set a token budget only when requested.`,
      structuredContent: { ...statePayload(envelope.goal, envelope.revision), error: budget.error.message },
      isError: true,
    };
  }
  const created = modelCreate(
    envelope.goal,
    { objective: obj.value, tokenBudget: budget.value },
    clocks,
    { makeId: () => makeGoalId() },
  );
  if (!created.ok) {
    return {
      state: envelope.goal,
      revision: envelope.revision,
      remainingTokens: remainingTokens(envelope.goal),
      content: `create_goal rejected: ${created.error.message}`,
      structuredContent: { ...statePayload(envelope.goal, envelope.revision), error: created.error.message },
      isError: true,
    };
  }
  const committed = store.commit(envelope.revision, (current) => ({
    ...current,
    goal: created.value,
    cleared: false,
    clearedAt: null,
    chargedEntryIds: [],
    baselineEntryCount: null,
    remainderMs: 0,
    dispatch: current.dispatch,
  }));
  if (!committed.ok) {
    return {
      state: envelope.goal,
      revision: envelope.revision,
      remainingTokens: remainingTokens(envelope.goal),
      content: `create_goal failed: ${committed.error.message}. No state was changed.`,
      structuredContent: { ...statePayload(envelope.goal, envelope.revision), error: committed.error.message },
      isError: true,
    };
  }
  const record = committed.value.goal!;
  return {
    state: record,
    revision: committed.value.revision,
    remainingTokens: remainingTokens(record),
    content: `Goal created (${record.id}). Objective: ${record.objective}. Status: active.${record.tokenBudget !== null ? ` Budget: ${record.tokenBudget} tokens.` : ""}`,
    structuredContent: statePayload(record, committed.value.revision),
    isError: false,
  };
}

export function handleGetGoal(envelope: SidecarEnvelope): ToolOutcome {
  const record = envelope.goal;
  if (!record) {
    return {
      state: null,
      revision: envelope.revision,
      remainingTokens: null,
      content: "No current goal. State observations cannot declare completion.",
      structuredContent: statePayload(null, envelope.revision),
      isError: false,
    };
  }
  return {
    state: record,
    revision: envelope.revision,
    remainingTokens: remainingTokens(record),
    content: `Goal ${record.id}: status ${record.status}. Objective: ${record.objective}. Used ${record.tokensUsed}${record.tokenBudget !== null ? ` of ${record.tokenBudget}` : ""} tokens in ${record.timeUsedSeconds.toFixed(1)}s.`,
    structuredContent: statePayload(record, envelope.revision),
    isError: false,
  };
}

export function handleUpdateGoal(
  store: GoalStore,
  envelope: SidecarEnvelope,
  args: unknown,
  clocks: { nowIso(): string },
): ToolOutcome {
  const params = (args ?? {}) as { status?: unknown };
  if (params.status !== "complete" && params.status !== "blocked" && params.status !== "paused") {
    return {
      state: envelope.goal,
      revision: envelope.revision,
      remainingTokens: remainingTokens(envelope.goal),
      content: "update_goal rejected: status must be one of complete, blocked, paused. Resume, clear, objective edits, and budget transitions are outside the model tool schema.",
      structuredContent: { ...statePayload(envelope.goal, envelope.revision), error: "invalid status" },
      isError: true,
    };
  }
  const goal = envelope.goal;
  if (!goal) {
    return {
      state: null,
      revision: envelope.revision,
      remainingTokens: null,
      content: "update_goal rejected: no current goal.",
      structuredContent: { ...statePayload(null, envelope.revision), error: "no goal" },
      isError: true,
    };
  }
  const now = { nowIso: () => clocks.nowIso() };
  const next =
    params.status === "complete"
      ? completeRecord(goal, now)
      : params.status === "blocked"
        ? blockRecord(goal, now)
        : pauseRecord(goal, now, "model");
  if (!next.ok) {
    return {
      state: goal,
      revision: envelope.revision,
      remainingTokens: remainingTokens(goal),
      content: `update_goal rejected: ${next.error.message}`,
      structuredContent: { ...statePayload(goal, envelope.revision), error: next.error.message },
      isError: true,
    };
  }
  const committed = store.commit(envelope.revision, (current) => ({
    ...current,
    goal: (next as { ok: true; value: GoalRecord }).value,
    dispatch: null,
  }));
  if (!committed.ok) {
    return {
      state: goal,
      revision: envelope.revision,
      remainingTokens: remainingTokens(goal),
      content: `update_goal failed: ${committed.error.message}. No state was changed.`,
      structuredContent: { ...statePayload(goal, envelope.revision), error: committed.error.message },
      isError: true,
    };
  }
  const record = committed.value.goal!;
  const remaining = remainingTokens(record);
  const consumption =
    record.tokenBudget !== null && params.status === "complete"
      ? ` Final consumption: ${record.tokensUsed} of ${record.tokenBudget} tokens in ${record.timeUsedSeconds.toFixed(1)}s.`
      : "";
  const guidance =
    params.status === "complete"
      ? " Report the successful result and final usage in your visible follow-up reply; it remains in the transcript."
      : params.status === "blocked"
        ? " Autonomous continuation stops. State the blocking cause and evidence in your visible reply."
        : " Paused at the recorded request. Autonomous continuation stops.";
  return {
    state: record,
    revision: committed.value.revision,
    remainingTokens: remaining,
    content: `Goal ${record.id} is now ${record.status}.${consumption}${guidance}`,
    structuredContent: statePayload(record, committed.value.revision),
    isError: false,
  };
}

export const MODEL_TOOL_NAMES = ["create_goal", "get_goal", "update_goal"] as const;

export function validateGoalId(value: unknown): value is GoalId {
  return typeof value === "string" && value.length > 0;
}
