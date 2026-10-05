/** Pure goal domain: types, validation, and lifecycle transitions. No Pi imports. */

export type GoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usage_limited"
  | "budget_limited"
  | "complete";

export type GoalId = string & { readonly __brand: "GoalId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type DispatchId = string & { readonly __brand: "DispatchId" };

export interface GoalRecord {
  id: GoalId;
  objective: string;
  status: GoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export const GOAL_STATUSES: readonly GoalStatus[] = [
  "active",
  "paused",
  "blocked",
  "usage_limited",
  "budget_limited",
  "complete",
];

export const MAX_OBJECTIVE_SCALARS = 4000;

export type GoalAuthority = "user" | "model";

export interface TransitionError {
  code:
    | "invalid_objective"
    | "invalid_budget"
    | "invalid_record"
    | "no_goal"
    | "already_exists"
    | "needs_confirmation"
    | "not_active"
    | "not_resumable"
    | "budget_exhausted"
    | "already_complete"
    | "forbidden_for_authority";
  message: string;
}

export type TransitionResult<T> = { ok: true; value: T } | { ok: false; error: TransitionError };

function fail<T>(
  code: TransitionError["code"],
  message: string,
): TransitionResult<T> {
  return { ok: false, error: { code, message } };
}

/** Count Unicode scalar values (code points). Surrogate pairs count once. */
export function countScalars(text: string): number {
  return Array.from(text).length;
}

export function validateObjective(raw: unknown): TransitionResult<string> {
  if (typeof raw !== "string") {
    return fail("invalid_objective", "Objective must be a string.");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fail("invalid_objective", "Objective must be nonempty.");
  }
  if (countScalars(trimmed) > MAX_OBJECTIVE_SCALARS) {
    return fail(
      "invalid_objective",
      `Objective must be at most ${MAX_OBJECTIVE_SCALARS} Unicode characters.`,
    );
  }
  return { ok: true, value: trimmed };
}

export function validateTokenBudget(raw: unknown): TransitionResult<number | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) {
    return fail("invalid_budget", "Token budget must be a positive safe integer when present.");
  }
  return { ok: true, value: raw };
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function validateGoalRecord(raw: unknown): TransitionResult<GoalRecord> {
  if (typeof raw !== "object" || raw === null) {
    return fail("invalid_record", "Goal record must be an object.");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) {
    return fail("invalid_record", "Goal id must be a nonempty string.");
  }
  const obj = validateObjective(r.objective);
  if (!obj.ok) return fail("invalid_record", `Invalid objective: ${obj.error.message}`);
  if (!GOAL_STATUSES.includes(r.status as GoalStatus)) {
    return fail("invalid_record", `Invalid status: ${String(r.status)}.`);
  }
  const budget = validateTokenBudget(r.tokenBudget ?? null);
  if (!budget.ok) return fail("invalid_record", `Invalid tokenBudget: ${budget.error.message}`);
  if (typeof r.tokensUsed !== "number" || !Number.isSafeInteger(r.tokensUsed) || r.tokensUsed < 0) {
    return fail("invalid_record", "tokensUsed must be a nonnegative safe integer.");
  }
  if (typeof r.timeUsedSeconds !== "number" || !Number.isFinite(r.timeUsedSeconds) || r.timeUsedSeconds < 0) {
    return fail("invalid_record", "timeUsedSeconds must be a nonnegative finite number.");
  }
  if (!isValidTimestamp(r.createdAt)) {
    return fail("invalid_record", "createdAt must be a valid timestamp.");
  }
  if (!isValidTimestamp(r.updatedAt)) {
    return fail("invalid_record", "updatedAt must be a valid timestamp.");
  }
  return {
    ok: true,
    value: {
      id: r.id as GoalId,
      objective: obj.value,
      status: r.status as GoalStatus,
      tokenBudget: budget.value,
      tokensUsed: r.tokensUsed,
      timeUsedSeconds: r.timeUsedSeconds,
      createdAt: r.createdAt as string,
      updatedAt: r.updatedAt as string,
    },
  };
}

/** Terminal states authorize no further autonomous work. */
export function isTerminalStatus(status: GoalStatus): boolean {
  return status === "complete" || status === "blocked" || status === "budget_limited" || status === "usage_limited";
}

/** Unfinished states refuse model-tool replacement (including budget_limited). */
export function isUnfinished(record: GoalRecord): boolean {
  return record.status !== "complete";
}

/** Only an active goal authorizes autonomous admission. */
export function isActiveRecord(record: GoalRecord | null): boolean {
  return record !== null && record.status === "active";
}

export function budgetPermits(record: GoalRecord): boolean {
  if (record.tokenBudget === null) return true;
  return record.tokensUsed < record.tokenBudget;
}

export interface CreateInput {
  objective: string;
  tokenBudget?: number | null;
}

export function createRecord(
  input: CreateInput,
  clocks: { nowIso: () => string },
  ids: { makeId: () => GoalId },
): TransitionResult<GoalRecord> {
  const obj = validateObjective(input.objective);
  if (!obj.ok) return obj as TransitionResult<GoalRecord>;
  const budget = validateTokenBudget(input.tokenBudget ?? null);
  if (!budget.ok) return budget as TransitionResult<GoalRecord>;
  const now = clocks.nowIso();
  if (!isValidTimestamp(now)) {
    return fail("invalid_record", "Clock produced an invalid timestamp.");
  }
  return {
    ok: true,
    value: {
      id: ids.makeId(),
      objective: obj.value,
      status: "active",
      tokenBudget: budget.value,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * User creation via `/goal <objective>`.
 * Replacement of an unfinished goal requires explicit confirmation in a
 * dialog-capable UI; headless callers must clear first.
 */
export function userCreate(
  existing: GoalRecord | null,
  input: CreateInput,
  clocks: { nowIso: () => string },
  ids: { makeId: () => GoalId },
  opts: { confirmed: boolean; dialogCapable: boolean },
): TransitionResult<GoalRecord> {
  if (existing && isUnfinished(existing)) {
    if (!opts.confirmed) {
      if (!opts.dialogCapable) {
        return fail(
          "needs_confirmation",
          `A goal is already active (${existing.id}). Clear it first with /goal clear before creating a replacement.`,
        );
      }
      return fail(
        "needs_confirmation",
        `A goal is already active (${existing.id}). Confirm replacement before proceeding.`,
      );
    }
    // Confirmed replacement: new identity, reset usage.
    return createRecord(input, clocks, ids);
  }
  return createRecord(input, clocks, ids);
}

/**
 * Model-tool creation via `create_goal`.
 * May replace only a `complete` goal; refuses every unfinished state.
 */
export function modelCreate(
  existing: GoalRecord | null,
  input: CreateInput,
  clocks: { nowIso: () => string },
  ids: { makeId: () => GoalId },
): TransitionResult<GoalRecord> {
  if (existing && isUnfinished(existing)) {
    return fail(
      "already_exists",
      `A goal already exists with status ${existing.status}. The model cannot replace an unfinished goal.`,
    );
  }
  return createRecord(input, clocks, ids);
}

export function editObjective(
  existing: GoalRecord | null,
  rawObjective: unknown,
  clocks: { nowIso: () => string },
): TransitionResult<GoalRecord> {
  if (!existing) return fail("no_goal", "No goal to edit.");
  const obj = validateObjective(rawObjective);
  if (!obj.ok) return obj as TransitionResult<GoalRecord>;
  return {
    ok: true,
    value: { ...existing, objective: obj.value, updatedAt: clocks.nowIso() },
  };
}

export function pauseRecord(
  existing: GoalRecord | null,
  clocks: { nowIso: () => string },
  _authority: GoalAuthority,
): TransitionResult<GoalRecord> {
  if (!existing) return fail("no_goal", "No goal to pause.");
  if (existing.status !== "active") {
    return fail("not_active", `Only an active goal can pause (current: ${existing.status}).`);
  }
  // Authority note: model-initiated pause is allowed by code only when the
  // tool schema permits it; the "explicit user request" rule is a model
  // instruction carried in the tool description, not a host-enforced fact.
  return { ok: true, value: { ...existing, status: "paused", updatedAt: clocks.nowIso() } };
}

export function resumeRecord(
  existing: GoalRecord | null,
  clocks: { nowIso: () => string },
  opts: { tokenBudget?: number | null },
): TransitionResult<GoalRecord> {
  if (!existing) return fail("no_goal", "No goal to resume.");
  if (existing.status === "active") {
    return fail("not_resumable", "Goal is already active.");
  }
  if (existing.status === "complete") {
    return fail("already_complete", "A complete goal cannot resume. Create a new goal instead.");
  }
  let budget = existing.tokenBudget;
  if (opts.tokenBudget !== undefined) {
    const parsed = validateTokenBudget(opts.tokenBudget);
    if (!parsed.ok) return parsed as TransitionResult<GoalRecord>;
    budget = parsed.value;
  }
  const next: GoalRecord = {
    ...existing,
    status: "active",
    tokenBudget: budget,
    updatedAt: clocks.nowIso(),
  };
  if (!budgetPermits(next)) {
    return fail(
      "budget_exhausted",
      `Budget exhausted: used ${next.tokensUsed} of cap ${budget}. Raise the cap with /goal resume --tokens <n> to continue.`,
    );
  }
  return { ok: true, value: next };
}

export function completeRecord(
  existing: GoalRecord | null,
  clocks: { nowIso: () => string },
): TransitionResult<GoalRecord> {
  if (!existing) return fail("no_goal", "No goal to complete.");
  if (existing.status === "complete") {
    return fail("already_complete", "Goal is already complete.");
  }
  if (existing.status !== "active") {
    return fail("not_active", `Only an active goal can complete (current: ${existing.status}).`);
  }
  return { ok: true, value: { ...existing, status: "complete", updatedAt: clocks.nowIso() } };
}

/** Mark a complete goal from budget_limited (verified completion path). */
export function completeFromBudgetLimited(
  existing: GoalRecord | null,
  clocks: { nowIso: () => string },
): TransitionResult<GoalRecord> {
  if (!existing) return fail("no_goal", "No goal to complete.");
  if (existing.status === "complete") {
    return fail("already_complete", "Goal is already complete.");
  }
  if (existing.status !== "budget_limited" && existing.status !== "active") {
    return fail("not_active", `Cannot complete from status ${existing.status}.`);
  }
  return { ok: true, value: { ...existing, status: "complete", updatedAt: clocks.nowIso() } };
}

export function blockRecord(
  existing: GoalRecord | null,
  clocks: { nowIso: () => string },
): TransitionResult<GoalRecord> {
  if (!existing) return fail("no_goal", "No goal to block.");
  if (existing.status !== "active") {
    return fail("not_active", `Only an active goal can block (current: ${existing.status}).`);
  }
  // The "same blocker across three executions" rule is a model instruction
  // in the continuation prompt; code enforces only the active precondition.
  return { ok: true, value: { ...existing, status: "blocked", updatedAt: clocks.nowIso() } };
}

export function budgetLimitRecord(
  existing: GoalRecord | null,
  clocks: { nowIso: () => string },
): TransitionResult<GoalRecord> {
  if (!existing) return fail("no_goal", "No goal to limit.");
  if (existing.status === "complete") {
    return fail("already_complete", "A complete goal cannot become budget-limited.");
  }
  return { ok: true, value: { ...existing, status: "budget_limited", updatedAt: clocks.nowIso() } };
}

export function usageLimitRecord(
  existing: GoalRecord | null,
  clocks: { nowIso: () => string },
): TransitionResult<GoalRecord> {
  if (!existing) return fail("no_goal", "No goal to limit.");
  if (existing.status === "complete") {
    return fail("already_complete", "A complete goal cannot become usage-limited.");
  }
  // Callers must positively identify a typed quota-exhaustion signal before
  // invoking this transition; generic errors become `blocked`.
  return { ok: true, value: { ...existing, status: "usage_limited", updatedAt: clocks.nowIso() } };
}

/** A pause request must not conceal a budget-limited state. */
export function pausePreservingBudgetLimit(
  existing: GoalRecord | null,
  clocks: { nowIso: () => string },
): TransitionResult<GoalRecord> {
  if (!existing) return fail("no_goal", "No goal to pause.");
  if (existing.status === "budget_limited") return { ok: true, value: { ...existing } };
  return pauseRecord(existing, clocks, "user");
}
