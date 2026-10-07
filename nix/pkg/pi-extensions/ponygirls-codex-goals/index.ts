/**
 * ponygirls-codex-goals — Codex-style goals for Pi with full transcript visibility.
 *
 * Every model-facing goal instruction is a persisted custom message with
 * display:true and its full text in content. Continuations run in the same
 * session via agent_settled + admitted visible custom messages.
 */
import { Type } from "typebox";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { defineTool, SessionManager } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import {
  blockRecord,
  budgetPermits,
  pauseRecord,
  resumeRecord,
  editObjective,
  usageLimitRecord,
  userCreate,
  validateTokenBudget,
  type GoalRecord,
  type SessionId,
} from "./src/goal.ts";
import { parseGoalCommand } from "./src/commands.ts";
import { GoalPane } from "./src/pane.ts";
import {
  CUSTOM_TYPE as GOAL_CUSTOM_TYPE,
  NOTICE_TYPE as GOAL_NOTICE_TYPE,
  renderBudgetWrapup,
  renderContinuation,
  renderKickoff,
  renderObjectiveUpdate,
  renderResync,
  renderStaleCancellation,
} from "./src/prompts.ts";
import { GoalController, type ClockPort, type SenderPort, type SessionView } from "./src/runtime.ts";
import {
  FileGoalStore,
  type GoalStore,
  type SidecarEnvelope,
} from "./src/store.ts";
import { handleCreateGoal, handleGetGoal, handleUpdateGoal } from "./src/tools.ts";
import { GOAL_STATUS_KEY, goalStatusLine } from "./src/status.ts";

const COMMIT_META_TYPE = "codex-goal-commit";
const TOOL_CREATE = "create_goal";
const TOOL_GET = "get_goal";
const TOOL_UPDATE = "update_goal";
const COMMAND_GOAL = "goal";

const CREATE_DESCRIPTION = [
  "Create a goal the user explicitly requested. Create only after an explicit user, system, or developer request; do not infer goal creation from an ordinary task.",
  "Set token_budget only when the user requested a spending cap.",
  "Creation can replace a complete goal but refuses every unfinished state, including budget_limited.",
].join(" ");

const GET_DESCRIPTION =
  "Read the current session goal state. State observations cannot declare completion without a successful lifecycle mutation. Call before acting on a goal instruction to verify session, goal id, revision, and active status.";

const UPDATE_DESCRIPTION = [
  "Update the current goal status. Allowed statuses: complete, blocked, paused.",
  "Complete only when the actual objective is fully achieved and no required work remains, verified against observable evidence.",
  "Block only after the same genuine blocker recurs across at least three consecutive goal executions; the first and second occurrences are continued audit, not a blocked state.",
  "Pause only at the user's explicit request; never choose to pause autonomously.",
  "Resume, clear, objective edits, and budget or system-limit transitions are outside this tool.",
].join(" ");

interface SessionBinding {
  sessionId: SessionId;
  sessionFile: string | undefined;
  store: GoalStore;
  controller: GoalController;
  pendingKickoff: { purpose: "kickoff" | "resync"; revision: number } | null;
  parentGoal: GoalRecord | null;
}

function clocks(): ClockPort {
  return {
    nowIso: () => new Date().toISOString(),
    nowMs: () => performance.now(),
  };
}

function newGoalId(): GoalRecord["id"] {
  return globalThis.crypto.randomUUID() as GoalRecord["id"];
}

type NotifyLevel = "info" | "warning" | "error";

function safeNotify(ctx: { ui: { notify(m: string, t?: NotifyLevel): void } }, message: string, type: NotifyLevel): void {
  try {
    ctx.ui.notify(message, type);
  } catch {
    // Stale runtime after session replacement/reload: nothing to do.
  }
}

/**
 * Publish (or clear) the bottom-left goal badge from the persisted sidecar;
 * a click opens the /goal pane.
 */
function refreshGoalStatus(binding: { store: GoalStore }, ui: ExtensionContext["ui"]): void {
  try {
    const loaded = binding.store.load();
    const line = loaded.ok ? goalStatusLine(loaded.value.goal) : null;
    if (line === null) {
      ui.setWidget(GOAL_STATUS_KEY, undefined);
      return;
    }
    const label = ui.theme.bg("customMessageBg", ` ${line} `);
    ui.setWidget(
      GOAL_STATUS_KEY,
      () => ({
        render: () => [label],
        invalidate: () => {},
        handleMouse: (event) => {
          if (event.type !== "click" || event.button !== "left") return undefined;
          void openGoalPane(ui, binding);
          return { handled: true };
        },
      }),
      { placement: "borderBottomLeft" },
    );
  } catch {
    try {
      ui.setWidget(GOAL_STATUS_KEY, undefined);
    } catch {
      // Stale runtime after session replacement/reload: nothing to do.
    }
  }
}

/** The /goal pane (TUI): the persisted goal at a glance. */
async function openGoalPane(ui: ExtensionContext["ui"], binding: { store: GoalStore }): Promise<void> {
  await ui.custom<void>((_tui, theme, _kb, done) =>
    new GoalPane(
      theme,
      () => {
        const loaded = binding.store.load();
        return loaded.ok ? loaded.value.goal : null;
      },
      () => done(),
    ),
  );
}

function safeSendUser(
  pi: { sendUserMessage(c: string, o?: Record<string, unknown>): void },
  ctx: { isIdle(): boolean },
  content: string,
): { ok: true } | { ok: false; error: string } {
  try {
    const idle = (() => {
      try {
        return ctx.isIdle();
      } catch {
        return true;
      }
    })();
    if (idle) {
      pi.sendUserMessage(content, { expandPromptTemplates: false });
    } else {
      pi.sendUserMessage(content, { deliverAs: "followUp", expandPromptTemplates: false });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function safeSendCustom(
  pi: { sendMessage(m: Record<string, unknown>, o?: Record<string, unknown>): void },
  message: Record<string, unknown>,
  options: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  try {
    pi.sendMessage(message, options);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** True for Pi's stale-runtime invalidation (expected during shutdown/reload/replacement). */
function isStaleError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("stale after session");
}

/** Run an event handler body, swallowing stale-runtime errors from disposal/reload. */
async function swallowStale(work: () => void | Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    if (!isStaleError(err)) throw err;
  }
}

function assistantTextOf(message: unknown): string {
  const m = message as { role?: string; content?: unknown };
  if (m.role !== "assistant") return "";
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return (m.content as Array<{ type?: string; text?: unknown }>)
      .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
      .join("");
  }
  return "";
}

export default function (pi: ExtensionAPI): void {
  // Note: Pi forbids querying tools/commands during extension loading
  // ("Extension runtime not initialized"). Collision detection therefore
  // runs at session_start, where the runtime is bound; registration below
  // still fails visibly if Pi itself rejects a duplicate name.

  const bindings = new Map<string, SessionBinding>();
  const clk = clocks();

  function sessionKey(ctx: ExtensionContext): string {
    return ctx.sessionManager.getSessionId();
  }

  function appendEvidence(binding: SessionBinding, customType: string, data: unknown): void {
    try {
      pi.appendEntry(customType, data);
    } catch (err) {
      binding.controller.disableAdmission();
      throw new Error(`Sidecar state may already be committed, but transcript evidence failed: ${(err as Error).message}. Admission disabled pending recovery.`);
    }
  }

  function viewOf(ctx: ExtensionContext): SessionView {
    const sm = ctx.sessionManager;
    return {
      sessionId: sm.getSessionId() as SessionId,
      sessionFile: (() => {
        try {
          return sm.getSessionFile();
        } catch {
          return undefined;
        }
      })(),
      entryCount: () => {
        try {
          return sm.getEntries().length;
        } catch {
          return 0;
        }
      },
      entries: () => {
        try {
          const raw = sm.getEntries() as Array<{
            id: string;
            type: string;
            message?: { role?: string; usage?: Record<string, unknown> };
          }>;
          return raw.map((e) => ({ id: e.id, type: e.type, message: e.message }));
        } catch {
          return [];
        }
      },
      isIdle: () => {
        try {
          return ctx.isIdle();
        } catch {
          return true;
        }
      },
      hasPendingMessages: () => {
        try {
          return ctx.hasPendingMessages();
        } catch {
          return false;
        }
      },
    };
  }

  function getOrCreateBinding(ctx: ExtensionContext): SessionBinding | null {
    const key = sessionKey(ctx);
    const hit = bindings.get(key);
    if (hit) return hit;
    let sessionId: SessionId;
    let sessionFile: string | undefined;
    try {
      sessionId = ctx.sessionManager.getSessionId() as SessionId;
    } catch {
      return null;
    }
    try {
      sessionFile = ctx.sessionManager.getSessionFile();
    } catch {
      sessionFile = undefined;
    }
    if (!sessionFile) return null;
    let store: GoalStore;
    try {
      store = new FileGoalStore(sessionId, sessionFile);
    } catch {
      return null;
    }
    const sender: SenderPort = {
      sendGoalInstruction: (content, details) => {
        pi.sendMessage(
          { customType: GOAL_CUSTOM_TYPE, content, display: true, details },
          { triggerTurn: true, deliverAs: "followUp" },
        );
      },
      sendNotice: (content) => {
        pi.appendEntry(GOAL_NOTICE_TYPE, { text: content, at: clk.nowIso() });
      },
      appendCommitMeta: (meta) => {
        pi.appendEntry(COMMIT_META_TYPE, meta);
      },
    };
    const controller = new GoalController(store, clk, sender);
    controller.everCommitted = ctx.sessionManager.getEntries().some((e) => e.type === "custom" && e.customType === COMMIT_META_TYPE && (e.data as { sessionId?: unknown }).sessionId === sessionId);
    const binding: SessionBinding = {
      sessionId,
      sessionFile,
      store,
      controller,
      pendingKickoff: null,
      parentGoal: null,
    };
    bindings.set(key, binding);
    return binding;
  }

  function bindingFor(ctx: ExtensionContext): SessionBinding | null {
    const key = sessionKey(ctx);
    const direct = bindings.get(key);
    if (direct) return direct;
    try {
      const sid = ctx.sessionManager.getSessionId();
      for (const b of bindings.values()) {
        if (b.sessionId === sid) return b;
      }
    } catch {
      // no session
    }
    return null;
  }

  function loadEnvelope(binding: SessionBinding): SidecarEnvelope {
    const loaded = binding.store.load();
    if (!loaded.ok) {
      binding.controller.disableAdmission();
      throw new Error(loaded.error.message);
    }
    if (loaded.value.revision === 0 && binding.controller.everCommitted) {
      binding.controller.disableAdmission();
      throw new Error("Sidecar disappeared after a committed goal: storage failure.");
    }
    if (loaded.value.revision > 0) binding.controller.everCommitted = true;
    return loaded.value;
  }

  /** Tool-safe checkpoint: settle attributable usage and enforce the cap mid-run. */
  function settleForTool(
    binding: SessionBinding,
    ctx: { sessionManager: ExtensionContext["sessionManager"] },
    triggerWrapup: boolean,
  ): { envelope: SidecarEnvelope; budgetHit: boolean; unknownUsage: boolean } {
    const sm = ctx.sessionManager;
    const live: SessionView = {
      sessionId: binding.sessionId,
      sessionFile: binding.sessionFile,
      entryCount: () => {
        try {
          return sm.getEntries().length;
        } catch {
          return 0;
        }
      },
      entries: () => {
        try {
          const raw = sm.getEntries() as Array<{
            id: string;
            type: string;
            message?: { role?: string; usage?: Record<string, unknown> };
          }>;
          return raw.map((e) => ({ id: e.id, type: e.type, message: e.message }));
        } catch {
          return [];
        }
      },
      isIdle: () => false,
      hasPendingMessages: () => false,
    };
    const envelope = loadEnvelope(binding);
    const settled = binding.controller.checkpointAccounting(envelope, live);
    if (settled.budgetHit && settled.envelope.goal) {
      const goal = settled.envelope.goal;
      const sent = safeSendCustom(
        pi,
        {
          customType: GOAL_CUSTOM_TYPE,
          content: renderBudgetWrapup(goal, settled.envelope.revision),
          display: true,
          details: {
            schemaVersion: 1,
            sessionId: binding.sessionId,
            goalId: goal.id,
            revision: settled.envelope.revision,
            purpose: "budget_wrapup",
          },
        },
        { triggerTurn: triggerWrapup, deliverAs: "followUp" },
      );
      if (!sent.ok) binding.controller.disableAdmission();
    }
    return settled;
  }

  function formatStatus(record: GoalRecord | null, revision: number): string {
    if (!record) return `No current goal (rev ${revision}).`;
    const budget =
      record.tokenBudget === null
        ? "uncapped"
        : `${record.tokensUsed}/${record.tokenBudget} tokens (remaining ${Math.max(0, record.tokenBudget - record.tokensUsed)})`;
    return [
      `Goal ${record.id}:`,
      `  status: ${record.status}`,
      `  objective: ${record.objective}`,
      `  usage: ${budget}; time ${record.timeUsedSeconds.toFixed(1)}s`,
      `  revision: ${revision}`,
      `  updated: ${record.updatedAt}`,
    ].join("\n");
  }

  pi.registerTool(
    defineTool({
      name: TOOL_CREATE,
      label: "Create goal",
      description: CREATE_DESCRIPTION,
      parameters: Type.Object({
        objective: Type.String({ description: "User's stated objective verbatim" }),
        token_budget: Type.Optional(Type.Integer({ minimum: 1, description: "Spending cap, only when requested" })),
      }),
      executionMode: "sequential",
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const binding = bindingFor(ctx);
        if (!binding) {
          return {
            content: [{ type: "text" as const, text: "create_goal rejected: no saved session. A saved Pi session is required." }],
            details: undefined,
            isError: true,
          };
        }
        const outcome = await binding.controller.serialized(() => {
          const envelope = loadEnvelope(binding);
          const outcome = handleCreateGoal(binding.store, envelope, params as unknown, clk, ctx.sessionManager.getEntries().length);
          if (!outcome.isError && outcome.state) {
            binding.controller.invalidate("tool:create");
            binding.controller.beginRun(outcome.state.id);
            appendEvidence(binding, COMMIT_META_TYPE, { sessionId: binding.sessionId, goalId: outcome.state.id, revision: outcome.revision });
          }
          return outcome;
        });
        refreshGoalStatus(binding, ctx.ui);
        return {
          content: [{ type: "text" as const, text: outcome.content }],
          details: undefined,
          structuredContent: outcome.structuredContent as never,
          isError: outcome.isError,
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: TOOL_GET,
      label: "Get goal",
      description: GET_DESCRIPTION,
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        const binding = bindingFor(ctx);
        if (!binding) {
          return {
            content: [{ type: "text" as const, text: "No current goal (no saved session)." }],
            details: undefined,
            structuredContent: { status: "none" } as never,
          };
        }
        const envelope = loadEnvelope(binding);
        const outcome = handleGetGoal(envelope);
        return {
          content: [{ type: "text" as const, text: outcome.content }],
          details: undefined,
          structuredContent: outcome.structuredContent as never,
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: TOOL_UPDATE,
      label: "Update goal",
      description: UPDATE_DESCRIPTION,
      parameters: Type.Object({
        status: Type.Union([Type.Literal("complete"), Type.Literal("blocked"), Type.Literal("paused")]),
      }),
      executionMode: "sequential",
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const binding = bindingFor(ctx);
        if (!binding) {
          return {
            content: [{ type: "text" as const, text: "update_goal rejected: no saved session." }],
            details: undefined,
            isError: true,
          };
        }
        const outcome = await binding.controller.serialized(() => {
          // Tool-safe checkpoint: attribute finalized usage and enforce the
          // cap before applying the requested transition, so a run that
          // already overspent cannot complete as if within budget.
          const settled = settleForTool(binding, ctx, true);
          if (settled.budgetHit && params.status !== "complete") {
            const g = settled.envelope.goal!;
            const remaining = g.tokenBudget !== null ? Math.max(0, g.tokenBudget - g.tokensUsed) : null;
            return {
              state: g,
              revision: settled.envelope.revision,
              remainingTokens: remaining,
              content: `update_goal rejected: token budget exhausted (used ${g.tokensUsed}${g.tokenBudget !== null ? ` of ${g.tokenBudget}` : ""}). The goal is now budget_limited; this is not completion.`,
              structuredContent: {
                id: g.id,
                objective: g.objective,
                status: g.status,
                tokenBudget: g.tokenBudget,
                tokensUsed: g.tokensUsed,
                timeUsedSeconds: g.timeUsedSeconds,
                remainingTokens: remaining,
                revision: settled.envelope.revision,
                createdAt: g.createdAt,
                updatedAt: g.updatedAt,
                error: "budget exhausted",
              },
              isError: true,
            };
          }
          const envelope = settled.envelope;
          return handleUpdateGoal(binding.store, envelope, params as unknown, clk);
        });
        if (!outcome.isError) {
          binding.controller.invalidate("tool:update");
          appendEvidence(binding, COMMIT_META_TYPE, { sessionId: binding.sessionId, goalId: outcome.state!.id, revision: outcome.revision });
        }
        refreshGoalStatus(binding, ctx.ui);
        return {
          content: [{ type: "text" as const, text: outcome.content }],
          details: undefined,
          structuredContent: outcome.structuredContent as never,
          isError: outcome.isError,
        };
      },
    }),
  );

  pi.registerCommand(COMMAND_GOAL, {
    description: "Manage the session goal: /goal, /goal <objective>, /goal edit|pause|resume|clear",
    handler: async (args: string, ctx) => {
      const parsed = parseGoalCommand(args);
      if (!parsed.ok) {
        ctx.ui.notify(`/goal: ${parsed.error.message}`, "warning");
        return;
      }
      const cmd = parsed.value;
      if (cmd.kind === "show") {
        const binding = getOrCreateBinding(ctx);
        if (!binding) {
          ctx.ui.notify("/goal: no saved session yet. Send a message first so Pi materializes the session file.", "warning");
          return;
        }
        const envelope = loadEnvelope(binding);
        try {
          pi.appendEntry(GOAL_NOTICE_TYPE, { text: formatStatus(envelope.goal, envelope.revision), at: clk.nowIso() });
        } catch {
          // non-fatal
        }
        if (ctx.mode === "tui" && ctx.hasUI) {
          await openGoalPane(ctx.ui, binding);
        } else {
          ctx.ui.notify(formatStatus(envelope.goal, envelope.revision), "info");
        }
        return;
      }

      const binding = getOrCreateBinding(ctx);
      if (!binding) {
        ctx.ui.notify("/goal: a saved Pi session is required. Send a message first; ephemeral sessions cannot host a goal.", "warning");
        return;
      }

      if (cmd.kind === "clear") {
        // Synchronous: no await before pi/ctx use (stale-runtime guard).
        try {
          const envelope = loadEnvelope(binding);
          const committed = binding.store.commit(envelope.revision, (current) => ({
            ...current,
            goal: null,
            dispatch: null,
            cleared: true,
            clearedAt: clk.nowIso(),
            chargedEntryIds: [],
            baselineEntryCount: null,
            remainderMs: 0,
          }));
          if (!committed.ok) {
            safeNotify(ctx, `/goal clear failed: ${committed.error.message}`, "error");
            return;
          }
          binding.controller.invalidate("clear");
          try {
            ctx.abort();
          } catch {
            // Idle when no run is active; stopping is best-effort.
          }
          appendEvidence(binding, COMMIT_META_TYPE, {
            sessionId: binding.sessionId,
            goalId: null,
            revision: committed.value.revision,
            tombstone: true,
          });
          appendEvidence(binding, GOAL_NOTICE_TYPE, { text: "Goal cleared. Transcript entries retained.", at: clk.nowIso() });
          safeNotify(ctx, "Goal cleared. Transcript entries retained.", "info");
          refreshGoalStatus(binding, ctx.ui);
        } catch (err) {
          safeNotify(ctx, `/goal clear failed: ${(err as Error).message}`, "error");
        }
        return;
      }

      if (cmd.kind === "pause") {
        try {
          const envelope = loadEnvelope(binding);
          if (!envelope.goal) {
            safeNotify(ctx, "/goal pause: no current goal.", "warning");
            return;
          }
          if (envelope.goal.status === "budget_limited") {
            safeNotify(ctx, "/goal pause: goal is budget-limited (not paused). Raise the cap and resume to continue.", "warning");
            return;
          }
          const next = pauseRecord(envelope.goal, clk, "user");
          if (!next.ok) {
            safeNotify(ctx, `/goal pause rejected: ${next.error.message}`, "warning");
            return;
          }
          const committed = binding.store.commit(envelope.revision, (current) => ({
            ...current,
            goal: next.value,
            dispatch: null,
          }));
          if (!committed.ok) {
            safeNotify(ctx, `/goal pause failed: ${committed.error.message}`, "error");
            return;
          }
          binding.controller.invalidate("pause");
          try {
            ctx.abort();
          } catch {
            // Idle when no run is active; stopping is best-effort.
          }
          appendEvidence(binding, COMMIT_META_TYPE, {
            sessionId: binding.sessionId,
            goalId: committed.value.goal!.id,
            revision: committed.value.revision,
          });
          appendEvidence(binding, GOAL_NOTICE_TYPE, { text: `Goal paused (${committed.value.goal!.id}).`, at: clk.nowIso() });
          safeNotify(ctx, "Goal paused.", "info");
          refreshGoalStatus(binding, ctx.ui);
        } catch (err) {
          safeNotify(ctx, `/goal pause failed: ${(err as Error).message}`, "error");
        }
        return;
      }

      if (cmd.kind === "resume") {
        // Synchronous commit first; only the kickoff send follows.
        let resumed: { ok: true; record: GoalRecord; revision: number } | { ok: false; message: string };
        try {
          let envelope = loadEnvelope(binding);
          if (envelope.goal?.status === "active" && (envelope.dispatch !== null || binding.controller.state.admissionDisabled || binding.controller.state.needsRecovery)) {
            const reconciled = binding.controller.checkpointAccounting(envelope, viewOf(ctx));
            envelope = reconciled.envelope;
            if (reconciled.unknownUsage && envelope.goal!.tokenBudget !== null) {
              binding.controller.disableAdmission();
              resumed = { ok: false, message: "Cannot resume under a spending cap: persisted usage is unknown." };
              return;
            }
          }
          if (!envelope.goal) {
            resumed = { ok: false, message: "No goal to resume." };
          } else {
            const recovering = envelope.dispatch !== null || binding.controller.state.needsRecovery || binding.controller.state.admissionDisabled;
            const resumable = recovering && envelope.goal.status === "active" ? { ...envelope.goal, status: "paused" as const } : envelope.goal;
            const next = resumeRecord(resumable, clk, { tokenBudget: cmd.tokenBudget });
            if (!next.ok) {
              resumed = { ok: false, message: next.error.message };
            } else {
              const committed = binding.store.commit(envelope.revision, (current) => ({
                ...current,
                goal: next.value,
                dispatch: null,
                baselineEntryCount: ctx.sessionManager.getEntries().length,
              }));
              if (!committed.ok) {
                resumed = { ok: false, message: committed.error.message };
              } else {
                binding.controller.invalidate("resume");
                binding.controller.markRecoveryComplete();
                appendEvidence(binding, COMMIT_META_TYPE, {
                  sessionId: binding.sessionId,
                  goalId: committed.value.goal!.id,
                  revision: committed.value.revision,
                });
                resumed = { ok: true, record: committed.value.goal!, revision: committed.value.revision };
              }
            }
          }
        } catch (err) {
          resumed = { ok: false, message: (err as Error).message };
        }
        refreshGoalStatus(binding, ctx.ui);
        if (!resumed.ok) {
          safeNotify(ctx, `/goal resume rejected: ${resumed.message}`, "warning");
          return;
        }
        binding.pendingKickoff = { purpose: "kickoff", revision: resumed.revision };
        if (ctx.hasUI) {
          const sent = safeSendUser(pi, ctx, resumed.record.objective);
          if (!sent.ok) safeNotify(ctx, `/goal resume: state saved but kickoff failed: ${sent.error}`, "error");
        } else {
          safeNotify(ctx, `Goal resumed (${resumed.record.id}). Continue the session to start work.`, "info");
        }
        return;
      }

      if (cmd.kind === "edit") {
        let objective = cmd.objective;
        if (objective === null) {
          if (!ctx.hasUI) {
            ctx.ui.notify("/goal edit needs an explicit objective in headless mode: /goal edit <objective>.", "warning");
            return;
          }
          const envelope = loadEnvelope(binding);
          if (!envelope.goal) {
            ctx.ui.notify("/goal edit: no current goal.", "warning");
            return;
          }
          const edited = await ctx.ui.editor("Edit goal objective", envelope.goal.objective);
          if (edited === undefined) return;
          objective = edited.trim();
          if (!objective) {
            ctx.ui.notify("/goal edit: objective must be nonempty.", "warning");
            return;
          }
        }
        const finalObjective = objective;
        // Commit synchronously; the only await above was the editor dialog.
        try {
          const envelope = loadEnvelope(binding);
          if (!envelope.goal) {
            safeNotify(ctx, "/goal edit: no current goal.", "warning");
            return;
          }
          const next = editObjective(envelope.goal, finalObjective, clk);
          if (!next.ok) {
            safeNotify(ctx, `/goal edit rejected: ${next.error.message}`, "warning");
            return;
          }
          const committed = binding.store.commit(envelope.revision, (c) => ({ ...c, goal: next.value, dispatch: null }));
          if (!committed.ok) {
            safeNotify(ctx, `/goal edit failed: ${committed.error.message}`, "error");
            return;
          }
          appendEvidence(binding, COMMIT_META_TYPE, {
            sessionId: binding.sessionId,
            goalId: committed.value.goal!.id,
            revision: committed.value.revision,
          });
          binding.controller.invalidate("edit");
          binding.controller.resetStreakOnUserWork();
          refreshGoalStatus(binding, ctx.ui);
          if (ctx.hasUI && committed.value.goal!.status === "active") {
            const sent = safeSendCustom(
              pi,
              {
                customType: GOAL_CUSTOM_TYPE,
                content: renderObjectiveUpdate(committed.value.goal!, committed.value.revision),
                display: true,
                details: {
                  schemaVersion: 1,
                  sessionId: binding.sessionId,
                  goalId: committed.value.goal!.id,
                  revision: committed.value.revision,
                  purpose: "objective_update",
                },
              },
              { triggerTurn: true, deliverAs: "followUp" },
            );
            if (!sent.ok) safeNotify(ctx, `/goal edit: state saved but instruction delivery failed: ${sent.error}`, "error");
          } else {
            safeNotify(ctx, `Goal objective updated (${committed.value.goal!.id}). Continue the session to continue work.`, "info");
          }
        } catch (err) {
          safeNotify(ctx, `/goal edit failed: ${(err as Error).message}`, "error");
        }
        return;
      }

      // create
      if (cmd.kind === "create") {
        if (cmd.tokenBudget !== null) {
          const check = validateTokenBudget(cmd.tokenBudget);
          if (!check.ok) {
            safeNotify(ctx, `/goal rejected: ${check.error.message}`, "warning");
            return;
          }
        }
        // Headless replacement of an unfinished goal fails with instructions.
        const pre = loadEnvelope(binding);
        if (pre.goal && !ctx.hasUI) {
          const attempt = userCreate(
            pre.goal,
            { objective: cmd.objective, tokenBudget: cmd.tokenBudget },
            clk,
            { makeId: newGoalId },
            { confirmed: false, dialogCapable: false },
          );
          if (!attempt.ok) {
            safeNotify(ctx, `/goal rejected: ${attempt.error.message}`, "warning");
            return;
          }
        }
        const doCreate = (confirmed: boolean): { ok: true; record: GoalRecord; revision: number } | { ok: false; message: string } => {
          try {
            const current = loadEnvelope(binding);
            const next = userCreate(
              current.goal,
              { objective: (cmd as { objective: string }).objective, tokenBudget: (cmd as { tokenBudget: number | null }).tokenBudget },
              clk,
              { makeId: newGoalId },
              { confirmed, dialogCapable: ctx.hasUI },
            );
            if (!next.ok) return { ok: false, message: next.error.message };
            const committed = binding.store.commit(current.revision, (c) => ({
              ...c,
              goal: next.value,
              cleared: false,
              clearedAt: null,
              chargedEntryIds: [],
              baselineEntryCount: ctx.sessionManager.getEntries().length,
              remainderMs: 0,
              dispatch: null,
            }));
            if (!committed.ok) return { ok: false, message: committed.error.message };
            binding.controller.invalidate("create");
            appendEvidence(binding, COMMIT_META_TYPE, {
              sessionId: binding.sessionId,
              goalId: committed.value.goal!.id,
              revision: committed.value.revision,
            });
            return { ok: true, record: committed.value.goal!, revision: committed.value.revision };
          } catch (err) {
            return { ok: false, message: (err as Error).message };
          }
        };
        if (pre.goal && ctx.hasUI && ctx.mode === "tui") {
          const confirmed = await ctx.ui.confirm(
            "Replace current goal?",
            `Goal ${pre.goal.id} (${pre.goal.status}) will be replaced. Transcript entries are retained.`,
          );
          if (!confirmed) {
            safeNotify(ctx, "Goal creation cancelled; existing goal unchanged.", "info");
            return;
          }
          const second = doCreate(true);
          if (!second.ok) {
            safeNotify(ctx, `/goal rejected: ${second.message}`, "warning");
            return;
          }
          binding.pendingKickoff = { purpose: "kickoff", revision: second.revision };
          refreshGoalStatus(binding, ctx.ui);
          // Print/json modes are single-turn: persist and let the next run
          // pick the goal up via before_agent_start instead of queuing here.
          if (ctx.hasUI) {
            const sent2 = safeSendUser(pi, ctx, second.record.objective);
            if (!sent2.ok) safeNotify(ctx, `/goal: state saved but kickoff failed: ${sent2.error}`, "error");
          } else {
            safeNotify(ctx, `Goal created (${second.record.id}). Continue the session to start work.`, "info");
          }
          return;
        }
        const created = doCreate(false);
        if (!created.ok) {
          safeNotify(ctx, `/goal rejected: ${created.message}`, "warning");
          return;
        }
        binding.pendingKickoff = { purpose: "kickoff", revision: created.revision };
        refreshGoalStatus(binding, ctx.ui);
        if (ctx.hasUI) {
          const sent = safeSendUser(pi, ctx, created.record.objective);
          if (!sent.ok) safeNotify(ctx, `/goal: state saved but kickoff failed: ${sent.error}`, "error");
        } else {
          safeNotify(ctx, `Goal created (${created.record.id}). Continue the session to start work.`, "info");
        }
      }
    },
  });

  let collisionChecked = false;
  pi.on("session_start", async (event, ctx) => {
    try {
      await sessionStartInner(event, ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
    }
    try {
      const binding = bindingFor(ctx);
      if (binding) refreshGoalStatus(binding, ctx.ui);
    } catch (err) {
      if (!isStaleError(err)) throw err;
    }
  });

  async function sessionStartInner(event: { reason: string; previousSessionFile?: string }, ctx: ExtensionContext): Promise<void> {
    if (!collisionChecked) {
      collisionChecked = true;
      try {
        // Pi rejects duplicate tool/command registration at load time; this
        // advisory check only covers a competing `/goal` command owner.
        const commands = pi.getCommands().map((c) => c.name);
        if (commands.filter((n) => n === COMMAND_GOAL).length > 1) {
          safeNotify(ctx, `ponygirls-codex-goals: command "/${COMMAND_GOAL}" is owned by another extension; refusing to compete silently.`, "error");
        }
      } catch {
        // Query APIs may be unavailable in some modes; registration-time
        // duplicate rejection remains the authoritative guard.
      }
    }
    const binding = getOrCreateBinding(ctx);
    if (!binding) return;
    const lock = binding.store.acquireLock();
    if (!lock.ok) {
      safeNotify(ctx, `ponygirls-codex-goals: ${lock.error.message}`, "error");
      binding.controller.disableAdmission();
      return;
    }
    const loaded = binding.store.load();
    if (!loaded.ok) {
      if (loaded.error.code === "malformed" || loaded.error.code === "session_mismatch") {
        safeNotify(ctx, `ponygirls-codex-goals: stored state needs attention: ${loaded.error.message}`, "warning");
        binding.controller.disableAdmission();
      }
      return;
    }
    if (loaded.value.dispatch) {
      binding.controller.loadState();
      try {
        pi.appendEntry(GOAL_NOTICE_TYPE, {
          text: `Goal ${loaded.value.goal?.id ?? "(unknown)"} has an unresolved dispatch from an interrupted process. Run /goal resume to invalidate it before automatic work continues.`,
          at: clk.nowIso(),
        });
      } catch {
        // non-fatal
      }
      safeNotify(ctx, "ponygirls-codex-goals: unresolved dispatch found; run /goal resume to recover.", "warning");
      return;
    }
    if (event.reason === "fork" && event.previousSessionFile) {
      const parentManager = SessionManager.open(event.previousSessionFile);
      const parentStore = new FileGoalStore(parentManager.getSessionId() as SessionId, event.previousSessionFile);
      const parent = parentStore.load();
      if (!parent.ok) throw new Error(`Cannot inherit parent goal: ${parent.error.message}`);
      binding.parentGoal = parent.value.goal;
    }
    if (event.reason === "fork" && binding.parentGoal) {
      const current = binding.store.load();
      if (current.ok && !current.value.goal) {
        const now = clk.nowIso();
        const inherited = binding.store.commit(current.value.revision, (c) => ({
          ...c,
          goal: { ...binding.parentGoal!, updatedAt: now },
          cleared: false,
          clearedAt: null,
          chargedEntryIds: [],
          baselineEntryCount: ctx.sessionManager.getEntries().length,
          remainderMs: 0,
          dispatch: null,
        }));
        if (!inherited.ok) throw new Error(`Cannot persist inherited goal: ${inherited.error.message}`);
        appendEvidence(binding, COMMIT_META_TYPE, { sessionId: binding.sessionId, goalId: inherited.value.goal!.id, revision: inherited.value.revision });
      }
      binding.parentGoal = null;
    }
    if (loadEnvelope(binding).goal?.status === "active") {
      const reconciled = settleForTool(binding, ctx, false);
      if (reconciled.unknownUsage && reconciled.envelope.goal!.tokenBudget !== null) {
        binding.controller.disableAdmission();
        throw new Error("Cannot admit budgeted goal work after restart: persisted usage is unknown.");
      }
    }
    if (ctx.mode === "tui" || ctx.mode === "rpc") {
      admitIfIdle(binding, viewOf(ctx));
    }
  }

  function admitIfIdle(binding: SessionBinding, view: SessionView): void {
    const envelope = loadEnvelope(binding);
    if (!binding.controller.canAdmit(binding.controller.checkAdmission(view, envelope)).ok) return;
    const generation = binding.controller.state.generation;
    const admitted = binding.controller.admitDispatch(envelope, view);
    if (!admitted.ok) throw new Error(admitted.error);
    const delivered = binding.controller.deliverContinuation(admitted.value, view, generation);
    if (!delivered.ok) binding.controller.cancelStaleDispatch(admitted.value, view, delivered.error);
  }

  pi.on("session_before_fork", async (_event, ctx) => {
    let binding: SessionBinding | null;
    try {
      binding = bindingFor(ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
      return;
    }
    if (!binding) return;
    const envelope = loadEnvelope(binding);
    binding.parentGoal = envelope.goal ? { ...envelope.goal } : null;
    binding.controller.invalidate("fork");
  });

  pi.on("session_before_switch", async (_event, ctx) => {
    try {
      bindingFor(ctx)?.controller.invalidate("switch");
    } catch (err) {
      if (!isStaleError(err)) throw err;
    }
  });

  pi.on("session_before_tree", async (_event, ctx) => {
    try {
      bindingFor(ctx)?.controller.invalidate("tree");
    } catch (err) {
      if (!isStaleError(err)) throw err;
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    try {
      bindingFor(ctx)?.controller.invalidate("tree-done");
    } catch (err) {
      if (!isStaleError(err)) throw err;
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    let binding: SessionBinding | null;
    try {
      binding = bindingFor(ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
      return;
    }
    if (!binding) return;
    binding.controller.invalidate("shutdown");
    try {
      ctx.ui.setWidget(GOAL_STATUS_KEY, undefined);
    } catch {
      // Stale runtime after replacement/reload: nothing to do.
    }
    try {
      binding.store.releaseLock();
    } catch {
      // idempotent
    }
  });

  pi.on("input", async (_event, ctx) => {
    let binding: SessionBinding | null;
    try {
      binding = bindingFor(ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
      return;
    }
    if (!binding) return;
    binding.controller.resetStreakOnUserWork();
    await binding.controller
      .serialized(() => {
        const envelope = loadEnvelope(binding);
        if (envelope.dispatch?.phase === "admitted") {
          const content = renderStaleCancellation({
            sessionId: binding.sessionId,
            goalId: envelope.dispatch.goalId,
            revision: envelope.dispatch.revision,
            dispatchId: envelope.dispatch.dispatchId,
            reason: "queued user input",
          });
          appendEvidence(binding, GOAL_NOTICE_TYPE, { text: content, at: clk.nowIso() });
          const committed = binding.store.commit(envelope.revision, (c) => ({ ...c, dispatch: null }));
          if (committed.ok) binding.controller.invalidate("input");
        } else {
          binding.controller.invalidate("input-activity");
        }
      })
      .catch((err) => {
        if (!isStaleError(err)) throw err;
      });
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    let binding: SessionBinding | null;
    try {
      binding = bindingFor(ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
      return undefined;
    }
    if (!binding) return undefined;
    let envelope: SidecarEnvelope;
    try {
      envelope = loadEnvelope(binding);
    } catch {
      // Fail-closed store already disabled admission; attach no context
      // rather than surfacing an extension error on every turn.
      return undefined;
    }
    const goal = envelope.goal;
    if (!goal || goal.status !== "active" || binding.controller.state.admissionDisabled || binding.controller.state.needsRecovery) return undefined;
    binding.controller.beginRun(goal.id);
    if (binding.pendingKickoff) {
      binding.pendingKickoff = null;
      return {
        message: {
          customType: GOAL_CUSTOM_TYPE,
          content: renderKickoff(goal, envelope.revision),
          display: true,
          details: {
            schemaVersion: 1,
            sessionId: binding.sessionId,
            goalId: goal.id,
            revision: envelope.revision,
            purpose: "kickoff",
          },
        },
      };
    }
    return {
      message: {
        customType: GOAL_CUSTOM_TYPE,
        content: renderContinuation(goal, envelope.revision, 1),
        display: true,
        details: {
          schemaVersion: 1,
          sessionId: binding.sessionId,
          goalId: goal.id,
          revision: envelope.revision,
          purpose: "continuation",
        },
      },
    };
  });

  pi.on("message_start", (event, ctx) => {
    let binding: SessionBinding | null;
    try {
      binding = bindingFor(ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
      return;
    }
    if (!binding) return;
    const message = event.message as {
      role?: string;
      customType?: string;
      details?: { dispatchId?: unknown };
    };
    if (message.role === "custom" && message.customType === GOAL_CUSTOM_TYPE) {
      const details = message.details as { dispatchId?: unknown; sessionId?: unknown; goalId?: unknown; revision?: unknown; purpose?: unknown } | undefined;
      let envelope: SidecarEnvelope;
      try {
        envelope = loadEnvelope(binding);
      } catch (err) {
        ctx.abort();
        throw err;
      }
      const dispatchId = details === undefined ? undefined : details.dispatchId;
      const valid = details !== undefined && details.sessionId === binding.sessionId && details.goalId === envelope.goal?.id && details.revision === envelope.revision &&
        (details.purpose === "budget_wrapup" ? envelope.goal?.status === "budget_limited" || envelope.goal?.status === "complete" : envelope.goal?.status === "active") &&
        (dispatchId === undefined || envelope.dispatch?.dispatchId === dispatchId);
      if (!valid) {
        ctx.abort();
        appendEvidence(binding, GOAL_NOTICE_TYPE, { text: renderStaleCancellation({ sessionId: binding.sessionId,
          goalId: String(details?.goalId), revision: Number(details?.revision), dispatchId: String(dispatchId), reason: "stale delivered goal identity or revision" }), at: clk.nowIso() });
        return;
      }
      if (typeof dispatchId === "string") {
        binding.controller.confirmDelivery(dispatchId as Parameters<GoalController["confirmDelivery"]>[0], envelope);
        if (!binding.controller.running) ctx.abort();
      } else if (!binding.controller.running && envelope.goal) {
        binding.controller.beginRun(envelope.goal.id);
      }
    }
  });

  pi.on("message_end", (event, ctx) => {
    let binding: SessionBinding | null;
    try {
      binding = bindingFor(ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
      return;
    }
    if (!binding) return;
    if ((event.message as { role?: string }).role === "assistant" && ctx.signal !== undefined && ctx.signal.aborted) {
      binding.controller.provisional.aborted = true;
    }
    const text = assistantTextOf(event.message);
    if (text) binding.controller.observeAssistantText(text);
  });

  pi.on("tool_execution_end", (event, ctx) => {
    let binding: SessionBinding | null;
    try {
      binding = bindingFor(ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
      return;
    }
    if (!binding) return;
    const nested = event.parentToolCallId !== undefined && event.parentToolCallId !== null;
    binding.controller.observeToolActivity(nested);
  });

  pi.on("turn_end", () => {
    // Safe accounting boundary only; never schedule here.
  });

  pi.on("agent_end", (event, ctx) => {
    let binding: SessionBinding | null;
    try {
      binding = bindingFor(ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
      return;
    }
    if (!binding) return;
    binding.controller.observeAgentEnd(
      (event.messages ?? []) as Array<{ role?: string; stopReason?: string; errorMessage?: string }>,
    );
  });

  pi.on("agent_settled", async (_event, ctx) => {
    let binding: SessionBinding | null;
    let view: SessionView;
    try {
      binding = bindingFor(ctx);
      if (!binding) return;
      view = viewOf(ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
      return;
    }
    await binding.controller.serialized(async () => {
      const genAtEntry = binding.controller.state.generation;
      let envelope = loadEnvelope(binding);
      const automatic = binding.controller.running !== null && binding.controller.running.dispatchId !== null;
      if (envelope.goal !== null && envelope.goal.status !== "active" && binding.controller.running === null) {
        const advanced = binding.store.commit(envelope.revision, (c) => ({ ...c, baselineEntryCount: view.entryCount() }));
        if (!advanced.ok) binding.controller.disableAdmission();
        binding.controller.noteSettledOutcome({ kind: "activity" });
        return;
      }
      const settled = binding.controller.settleAccounting(envelope, view);
      envelope = settled.envelope;
      if (settled.budgetHit && envelope.goal) {
        try {
          pi.sendMessage(
            {
              customType: GOAL_CUSTOM_TYPE,
              content: renderBudgetWrapup(envelope.goal, envelope.revision),
              display: true,
              details: {
                schemaVersion: 1,
                sessionId: binding.sessionId,
                goalId: envelope.goal.id,
                revision: envelope.revision,
                purpose: "budget_wrapup",
              },
            },
            { triggerTurn: true, deliverAs: "followUp" },
          );
        } catch {
          binding.controller.disableAdmission();
        }
        safeNotify(
          ctx,
          `Goal budget exhausted: used ${envelope.goal.tokensUsed}${envelope.goal.tokenBudget !== null ? ` of ${envelope.goal.tokenBudget}` : ""} tokens. Not complete.`,
          "warning",
        );
        return;
      }
      if (settled.unknownUsage && envelope.goal?.tokenBudget !== null && envelope.goal) {
        binding.controller.disableAdmission();
        safeNotify(ctx, "ponygirls-codex-goals: provider usage missing; cannot enforce spending cap. Admission stopped.", "warning");
        return;
      }

      const outcome = binding.controller.classifyPreviousExecution();
      if (outcome.kind === "aborted") {
        const current = loadEnvelope(binding);
        if (current.goal?.status === "active") {
          const next = pauseRecord(current.goal, clk, "user");
          if (next.ok) {
            binding.store.commit(current.revision, (c) => ({ ...c, goal: next.value, dispatch: null }));
            binding.controller.invalidate("abort");
          }
        }
        return;
      }
      if (outcome.kind === "quota") {
        const current = loadEnvelope(binding);
        if (current.goal?.status === "active") {
          const next = usageLimitRecord(current.goal, clk);
          if (next.ok) {
            binding.store.commit(current.revision, (c) => ({ ...c, goal: next.value, dispatch: null }));
            binding.controller.invalidate("quota");
            safeNotify(ctx, "Goal usage-limited by provider quota signal.", "warning");
          }
        }
        return;
      }
      if (outcome.kind === "error_exhausted") {
        const current = loadEnvelope(binding);
        if (current.goal?.status === "active") {
          const next = blockRecord(current.goal, clk);
          if (next.ok) {
            binding.store.commit(current.revision, (c) => ({ ...c, goal: next.value, dispatch: null }));
            binding.controller.invalidate("error-exhausted");
            safeNotify(ctx, `Goal blocked: exhausted provider failure: ${outcome.errorText.slice(0, 200)}`, "warning");
          }
        }
        return;
      }

      const guard = binding.controller.noteSettledOutcome(automatic ? outcome : { kind: "activity" });
      if (guard.blocked) {
        const current = loadEnvelope(binding);
        if (current.goal?.status === "active") {
          const next = blockRecord(current.goal, clk);
          if (next.ok) {
            binding.store.commit(current.revision, (c) => ({ ...c, goal: next.value, dispatch: null }));
            binding.controller.invalidate("empty-guard");
            safeNotify(ctx, "Goal blocked: three consecutive automatic executions produced no output or activity.", "warning");
          }
        }
        return;
      }

      envelope = loadEnvelope(binding);
      if (!envelope.goal || envelope.goal.status !== "active") return;
      if (!budgetPermits(envelope.goal)) {
        const limited = binding.controller.applyTerminalTransition(envelope, "budget");
        if (limited.ok && limited.value.goal) {
          try {
            pi.sendMessage(
              {
                customType: GOAL_CUSTOM_TYPE,
                content: renderBudgetWrapup(limited.value.goal, limited.value.revision),
                display: true,
                details: {
                  schemaVersion: 1,
                  sessionId: binding.sessionId,
                  goalId: limited.value.goal.id,
                  revision: limited.value.revision,
                  purpose: "budget_wrapup",
                },
              },
              { triggerTurn: true, deliverAs: "followUp" },
            );
          } catch {
            binding.controller.disableAdmission();
          }
        }
        return;
      }

      const check = binding.controller.checkAdmission(view, envelope);
      if (!binding.controller.canAdmit(check).ok) return;
      if (genAtEntry !== binding.controller.state.generation) return;
      const admitted = binding.controller.admitDispatch(envelope, view);
      if (!admitted.ok) return;
      if (genAtEntry !== binding.controller.state.generation) {
        binding.controller.cancelStaleDispatch(admitted.value, view, "superseded after admission");
        return;
      }
      if (view.hasPendingMessages()) {
        binding.controller.cancelStaleDispatch(admitted.value, view, "queued user input");
        return;
      }
      if (!view.isIdle()) return;
      const delivered = binding.controller.deliverContinuation(admitted.value, view, genAtEntry);
      if (!delivered.ok) {
        binding.controller.cancelStaleDispatch(admitted.value, view, delivered.error);
      }
    }).catch((err) => {
      if (!isStaleError(err)) throw err;
    });
    try {
      refreshGoalStatus(binding, ctx.ui);
    } catch (err) {
      if (!isStaleError(err)) throw err;
    }
  });

  pi.on("session_before_compact", async (_event, ctx) => {
    let binding: SessionBinding | null;
    try {
      binding = bindingFor(ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
      return;
    }
    if (!binding) return;
    let live: SessionView;
    try {
      live = viewOf(ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
      return;
    }
    await binding.controller
      .serialized(() => {
        const envelope = loadEnvelope(binding);
        binding.controller.settleAccounting(envelope, live);
      })
      .catch((err) => {
        if (!isStaleError(err)) throw err;
      });
    try {
      refreshGoalStatus(binding, ctx.ui);
    } catch (err) {
      if (!isStaleError(err)) throw err;
    }
  });

  pi.on("session_compact", async (_event, ctx) => {
    let binding: SessionBinding | null;
    try {
      binding = bindingFor(ctx);
    } catch (err) {
      if (!isStaleError(err)) throw err;
      return;
    }
    if (!binding) return;
    const envelope = loadEnvelope(binding);
    if (envelope.goal?.status === "paused") {
      // Informative only: a paused goal stays paused across compaction
      // (including compaction-aborted runs, which pause like Escape).
      // No autonomous work follows; resume explicitly to continue.
      appendEvidence(binding, GOAL_NOTICE_TYPE, {
        text: `Session compacted while goal ${envelope.goal.id} is paused. Run /goal resume to continue under the fresh context.`,
        at: clk.nowIso(),
      });
    }
    if (envelope.goal?.status === "active") {
      binding.pendingKickoff = { purpose: "resync", revision: envelope.revision };
      try {
        pi.sendMessage(
          {
            customType: GOAL_CUSTOM_TYPE,
            content: renderResync(envelope.goal, envelope.revision),
            display: true,
            details: {
              schemaVersion: 1,
              sessionId: binding.sessionId,
              goalId: envelope.goal.id,
              revision: envelope.revision,
              purpose: "resync",
            },
          },
          { triggerTurn: false, deliverAs: "followUp" },
        );
      } catch {
        // before_agent_start still carries pending resync
      }
    }
  });

  pi.on("session_compact_failed", async (_event, ctx) => {
    try {
      bindingFor(ctx)?.controller.invalidate("compact-failed");
    } catch (err) {
      if (!isStaleError(err)) throw err;
    }
  });

  pi.registerMessageRenderer(GOAL_CUSTOM_TYPE, () => undefined);
  pi.registerEntryRenderer(GOAL_NOTICE_TYPE, (entry) => new Text((entry.data as { text: string }).text, 0, 0));
  pi.registerEntryRenderer(COMMIT_META_TYPE, (entry) => new Text(`[codex-goal-commit] ${JSON.stringify(entry.data)}`, 0, 0));
}
