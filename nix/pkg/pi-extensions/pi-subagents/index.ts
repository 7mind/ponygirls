/**
 * pi-subagents — governing pi extension entry.
 *
 * Thin registration over the Supervisor: seven core tools plus manage_gate,
 * one /agents command/inspector, and boundary event wiring. All policy,
 * scheduling, journaling, brokering, and gate logic lives in the supervisor
 * and its collaborators; this file holds no mutable agent state.
 */

import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { FileRunStore, InMemoryRunStore } from "./src/store.ts";
import { Supervisor, type CallerId } from "./src/supervisor.ts";
import { defaultSupervisorPolicy, type SupervisorPolicy } from "./src/policy.ts";
import { AgentInspector, renderHeadless, sanitizeDisplay, widgetLine } from "./src/ui.ts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CUSTOM_NOTICE = "pi-subagents-notice";

function agentBaseDir(): string {
  const override = process.env["PI_CODING_AGENT_DIR"];
  if (override) return override;
  return join(homedir(), ".pi", "agent");
}

function rootDirFor(sessionId: string): string {
  const dir = join(agentBaseDir(), "subagents", sessionId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function loadPolicy(): SupervisorPolicy {
  const policy = defaultSupervisorPolicy();
  const path = join(agentBaseDir(), "subagents-policy.json");
  try {
    if (!existsSync(path)) return policy;
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SupervisorPolicy>;
    if (Array.isArray(raw.repos)) {
      policy.repos = raw.repos.filter((r) => typeof r?.repoId === "string" && typeof r?.checkoutPath === "string").map((r) => ({
        repoId: r.repoId,
        checkoutPath: r.checkoutPath,
        readRoots: Array.isArray(r.readRoots) ? r.readRoots.filter((x): x is string => typeof x === "string") : [r.checkoutPath],
        allowWriters: r.allowWriters === true,
      }));
    }
    if (typeof raw.maxDepth === "number") policy.maxDepth = Math.min(2, Math.max(1, Math.floor(raw.maxDepth)));
    if (raw.nesting === true && policy.maxDepth >= 2) policy.nesting = true;
    if (typeof raw.gateBypassAllowed === "boolean") policy.gateBypassAllowed = raw.gateBypassAllowed;
    if (raw.gateMaxRoundsCeiling === null || typeof raw.gateMaxRoundsCeiling === "number") {
      policy.gateMaxRoundsCeiling = raw.gateMaxRoundsCeiling;
    }
    if (Array.isArray(raw.allowedModels)) {
      policy.allowedModels = raw.allowedModels.filter((m) => typeof m?.provider === "string" && typeof m?.id === "string");
    }
    policy.revision += 1;
  } catch {
    // Unparseable policy file: fail closed to defaults (writers unavailable
    // without registered repositories).
  }
  return policy;
}

function detectSdkRoot(): string | null {
  if (process.env["PI_SUBAGENTS_SDK_ROOT"]) return process.env["PI_SUBAGENTS_SDK_ROOT"];
  return null;
}

interface SessionBinding {
  sessionId: string;
  supervisor: Supervisor;
}

export default function (pi: ExtensionAPI): void {
  const bindings = new Map<string, SessionBinding>();

  function bindingFor(ctx: ExtensionContext): SessionBinding | null {
    let sessionId: string;
    try {
      sessionId = ctx.sessionManager.getSessionId() as string;
    } catch {
      return null;
    }
    if (!sessionId) return null;
    let binding = bindings.get(sessionId);
    if (!binding) {
      const rootDir = rootDirFor(sessionId);
      let store;
      try {
        store = new FileRunStore(rootDir, sessionId);
      } catch {
        store = new InMemoryRunStore(sessionId);
      }
      const workerPath = join(dirname(new URL(import.meta.url).pathname), "src", "worker.ts");
      const supervisor = new Supervisor({
        rootId: sessionId,
        rootDir,
        store,
        policy: loadPolicy(),
        workerPath: existsSync(workerPath) ? workerPath : join(process.cwd(), "src", "worker.ts"),
        sdkRoot: detectSdkRoot(),
        deterministic: false,
        hostAgentDir: agentBaseDir(),
      });
      binding = { sessionId, supervisor };
      bindings.set(sessionId, binding);
    }
    return binding;
  }

  function callerOf(ctx: ExtensionContext): CallerId {
    void ctx;
    return "governor";
  }

  function failText(e: unknown): string {
    const code = (e as { code?: string }).code ?? "INVALID";
    return `${code}: ${(e as Error).message}`;
  }

  pi.registerTool(
    defineTool({
      name: "spawn_agent",
      label: "Spawn subagent",
      description:
        "Reserve a subagent identity and start its first task. Returns immediately with agent id, path, task-run id, and generation; it does not wait for completion. profile is reader or writer. Writers require a registered repository (repo_id). Optional gate object enables validation review.",
      parameters: Type.Object({
        task_name: Type.String({ description: "Short task name; becomes part of the canonical path" }),
        message: Type.String({ description: "Initial task text" }),
        profile: Type.Union([Type.Literal("reader"), Type.Literal("writer")]),
        repo_id: Type.Optional(Type.String()),
        base_commit: Type.Optional(Type.String()),
        gate: Type.Optional(Type.Object({
          model: Type.Object({ provider: Type.String(), id: Type.String() }),
          thinkingLevel: Type.String(),
          prompt: Type.String(),
          maxRounds: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
        })),
      }),
      executionMode: "sequential",
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        void toolCallId;
        const binding = bindingFor(ctx);
        if (!binding) return { content: [{ type: "text" as const, text: "spawn_agent rejected: no saved session" }], details: {}, isError: true };
        try {
          const p = params as { task_name: string; message: string; profile: "reader" | "writer"; repo_id?: string; base_commit?: string; gate?: { model: { provider: string; id: string }; thinkingLevel: string; prompt: string; maxRounds?: number | null } };
          const res = await binding.supervisor.spawn(callerOf(ctx), {
            taskName: p.task_name,
            message: p.message,
            profile: p.profile,
            repoId: p.repo_id ?? null,
            baseCommit: p.base_commit ?? null,
            gate: p.gate ? {
            model: p.gate.model,
            thinkingLevel: p.gate.thinkingLevel,
            prompt: p.gate.prompt,
            maxRounds: p.gate.maxRounds ?? null,
          } : null,
          }, `tool:${toolCallId}`);
          return { content: [{ type: "text" as const, text: JSON.stringify(res) }], details: {} };
        } catch (e) {
          return { content: [{ type: "text" as const, text: failText(e) }], details: {}, isError: true };
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "send_message",
      label: "Message subagent",
      description: "Send a durable attributed message. mode note persists without starting work; steer affects the active generation (rejects idle agents); task schedules a new task run (queued behind unfinished work). request_reply creates a question; reply_to answers one (mutually exclusive).",
      parameters: Type.Object({
        target: Type.String({ description: "Agent id, or 'parent' from a child" }),
        message: Type.String(),
        mode: Type.Union([Type.Literal("note"), Type.Literal("steer"), Type.Literal("task")]),
        request_reply: Type.Optional(Type.Boolean()),
        reply_to: Type.Optional(Type.String()),
      }),
      executionMode: "sequential",
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        void toolCallId;
        const binding = bindingFor(ctx);
        if (!binding) return { content: [{ type: "text" as const, text: "send_message rejected: no saved session" }], details: {}, isError: true };
        try {
          const p = params as { target: string; message: string; mode: "note" | "steer" | "task"; request_reply?: boolean; reply_to?: string };
          const res = await binding.supervisor.sendMessage(callerOf(ctx), p.target, p.mode, p.message, { requestReply: p.request_reply, replyTo: p.reply_to }, `tool:${toolCallId}`);
          return { content: [{ type: "text" as const, text: JSON.stringify(res) }], details: {} };
        } catch (e) {
          return { content: [{ type: "text" as const, text: failText(e) }], details: {}, isError: true };
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "list_agents",
      label: "List subagents",
      description: "Return the caller-visible agent tree with generation, observed state, pending intent, profile, and usage.",
      parameters: Type.Object({}),
      async execute(toolCallId, _params, _signal, _onUpdate, ctx) {
        void toolCallId;
        const binding = bindingFor(ctx);
        if (!binding) return { content: [{ type: "text" as const, text: "[]" }], details: {} };
        const views = binding.supervisor.list(callerOf(ctx));
        return { content: [{ type: "text" as const, text: JSON.stringify(views) }], details: {} };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "read_agent",
      label: "Read subagent",
      description: "Read status, current/specified-task-run result, or bounded events. Transcript/diff access is paged and ownership-checked.",
      parameters: Type.Object({
        target: Type.String(),
        view: Type.Union([Type.Literal("status"), Type.Literal("result"), Type.Literal("events")]),
        cursor: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        void toolCallId;
        const binding = bindingFor(ctx);
        if (!binding) return { content: [{ type: "text" as const, text: "read_agent rejected: no saved session" }], details: {}, isError: true };
        try {
          const p = params as { target: string; view: "status" | "result" | "events"; cursor?: number; limit?: number };
          const res = binding.supervisor.read(callerOf(ctx), p.target, p.view, p.cursor ?? 0, p.limit ?? 20);
          return { content: [{ type: "text" as const, text: JSON.stringify(res).slice(0, 24000) }], details: {} };
        } catch (e) {
          return { content: [{ type: "text" as const, text: failText(e) }], details: {}, isError: true };
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "wait_agent",
      label: "Wait for subagents",
      description: "Wait for durable events after a cursor (bounded batch + new cursor). condition is activity, any_settled, or all_settled; settlement targets capture exact task-run ids. A child question preempts a settlement wait (needs_response) without reporting settlement. New user input cancels the wait without cancelling children.",
      parameters: Type.Object({
        cursor: Type.Optional(Type.Integer({ minimum: 0 })),
        timeout_ms: Type.Optional(Type.Integer({ minimum: 100, maximum: 300000 })),
        targets: Type.Optional(Type.Array(Type.Object({ agentId: Type.String(), taskRunId: Type.Union([Type.String(), Type.Null()]) }))),
        condition: Type.Optional(Type.Union([Type.Literal("activity"), Type.Literal("any_settled"), Type.Literal("all_settled")])),
      }),
      executionMode: "sequential",
      async execute(toolCallId, params, signal, _onUpdate, ctx) {
        void toolCallId;
        const binding = bindingFor(ctx);
        if (!binding) return { content: [{ type: "text" as const, text: "wait_agent rejected: no saved session" }], details: {}, isError: true };
        try {
          const p = params as { cursor?: number; timeout_ms?: number; targets?: Array<{ agentId: string; taskRunId: string | null }>; condition?: "activity" | "any_settled" | "all_settled" };
          const caller = callerOf(ctx);
          if (signal?.aborted) {
            binding.supervisor.cancelCallerWaits(caller);
            return { content: [{ type: "text" as const, text: JSON.stringify({ completed: false, reason: "cancelled" }) }], details: {} };
          }
          const res = await binding.supervisor.wait(caller, p.cursor ?? 0, p.timeout_ms ?? 30000, p.targets ?? null, p.condition ?? "activity");
          return { content: [{ type: "text" as const, text: JSON.stringify(res).slice(0, 24000) }], details: {} };
        } catch (e) {
          return { content: [{ type: "text" as const, text: failText(e) }], details: {}, isError: true };
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "interrupt_agent",
      label: "Interrupt subagent",
      description: "Request interruption of the target task run, its linked gate, and active descendants. Returns acceptance plus the previous observed snapshot; confirm stopped state separately. Preserves sessions and worktrees.",
      parameters: Type.Object({ target: Type.String() }),
      executionMode: "sequential",
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        void toolCallId;
        const binding = bindingFor(ctx);
        if (!binding) return { content: [{ type: "text" as const, text: "interrupt_agent rejected: no saved session" }], details: {}, isError: true };
        try {
          const p = params as { target: string };
          const res = await binding.supervisor.interrupt(callerOf(ctx), p.target, `tool:${toolCallId}`);
          return { content: [{ type: "text" as const, text: JSON.stringify(res) }], details: {} };
        } catch (e) {
          return { content: [{ type: "text" as const, text: failText(e) }], details: {}, isError: true };
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "close_agent",
      label: "Close subagent",
      description: "Permanently close a logical subtree and its managed gates after interruption/cleanup. Preserves sessions, results, and dirty worktrees. Retained-file cleanup is a separate explicit user action.",
      parameters: Type.Object({ target: Type.String() }),
      executionMode: "sequential",
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        void toolCallId;
        const binding = bindingFor(ctx);
        if (!binding) return { content: [{ type: "text" as const, text: "close_agent rejected: no saved session" }], details: {}, isError: true };
        try {
          const p = params as { target: string };
          await binding.supervisor.close(callerOf(ctx), p.target, `tool:${toolCallId}`);
          return { content: [{ type: "text" as const, text: JSON.stringify({ closed: p.target }) }], details: {} };
        } catch (e) {
          return { content: [{ type: "text" as const, text: failText(e) }], details: {}, isError: true };
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "manage_gate",
      label: "Manage validation gate",
      description: "Governor-only gate controls for gated tasks: resume_review (unfinished review, same run/counters), retry_review (terminal run, linked new run), bypass (explicit acceptance without validation; never approval), set_limits (agreement cap within root authority). The main actor and reviewer cannot control their own validation.",
      parameters: Type.Object({
        target: Type.String({ description: "Task-run id the action applies to" }),
        action: Type.Union([Type.Literal("resume_review"), Type.Literal("retry_review"), Type.Literal("bypass"), Type.Literal("set_limits")]),
        review_id: Type.Optional(Type.String()),
        candidate_id: Type.Optional(Type.String()),
        reason: Type.Optional(Type.String()),
        max_rounds: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
        gate: Type.Optional(Type.Object({
          model: Type.Object({ provider: Type.String(), id: Type.String() }),
          thinkingLevel: Type.String(),
          prompt: Type.String(),
        })),
      }),
      executionMode: "sequential",
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        void toolCallId;
        const binding = bindingFor(ctx);
        if (!binding) return { content: [{ type: "text" as const, text: "manage_gate rejected: no saved session" }], details: {}, isError: true };
        try {
          const p = params as {
            target: string; action: "resume_review" | "retry_review" | "bypass" | "set_limits";
            review_id?: string; candidate_id?: string; reason?: string; max_rounds?: number | null;
            gate?: { model: { provider: string; id: string }; thinkingLevel: string; prompt: string };
          };
          const gate = binding.supervisor.gateController;
          const commandId = `tool:${toolCallId}`;
          if (p.action === "resume_review") {
            if (!p.review_id) throw new Error("INVALID: resume_review requires review_id");
            gate.resumeReview(p.target, p.review_id, commandId);
            return { content: [{ type: "text" as const, text: JSON.stringify({ resumed: p.review_id }) }], details: {} };
          }
          if (p.action === "retry_review") {
            if (!p.candidate_id || !p.gate) throw new Error("INVALID: retry_review requires candidate_id and gate");
            const next = gate.retryReview(p.target, p.candidate_id, p.gate, commandId);
            return { content: [{ type: "text" as const, text: JSON.stringify({ taskRunId: next }) }], details: {} };
          }
          if (p.action === "bypass") {
            if (!p.candidate_id || !p.reason) throw new Error("INVALID: bypass requires candidate_id and reason");
            const next = gate.bypass(p.target, p.candidate_id, p.reason, commandId);
            return { content: [{ type: "text" as const, text: JSON.stringify({ taskRunId: next, outcome: "gate_bypassed" }) }], details: {} };
          }
          gate.setLimits(p.target, p.max_rounds ?? null, commandId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ limits: p.max_rounds ?? null }) }], details: {} };
        } catch (e) {
          return { content: [{ type: "text" as const, text: failText(e) }], details: {}, isError: true };
        }
      },
    }),
  );

  pi.registerCommand("agents", {
    description: "Inspect subagents: tree, status, results, questions, approvals",
    handler: async (args, ctx) => {
      const binding = bindingFor(ctx);
      if (!binding) {
        ctx.ui.notify("/agents: no saved session yet.", "warning");
        return;
      }
      const views = binding.supervisor.list("user");
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        ctx.ui.notify(`${widgetLine(views)}\n${renderHeadless(views)}`, "info");
        return;
      }
      const sub = binding.supervisor;
      await ctx.ui.custom<void>((tui, theme, _kb, done) => {
        void theme;
        let inspector: AgentInspector | null = null;
        const render = (): void => {
          try {
            tui.requestRender();
          } catch {
            // headless; ignore
          }
        };
        const afterAction = (note: string): void => {
          if (inspector) {
            inspector.refreshViews(sub.list("user"));
            inspector.notice(note);
          }
          render();
        };
        const handleAction = (action: { kind: string; agentId: string }): void => {
          const id = action.agentId;
          const short = id.slice(0, 8);
          if (action.kind === "interrupt") {
            void sub.interrupt("user", id, `ui:${Date.now()}`).then(
              () => afterAction(`interrupt accepted for ${short}; confirm stopped state separately`),
              (e: Error) => afterAction(`interrupt rejected: ${e.message}`),
            );
            return;
          }
          if (action.kind === "close") {
            void sub.close("user", id, `ui:${Date.now()}`).then(
              () => afterAction(`closed ${short}; sessions and dirty worktrees preserved`),
              (e: Error) => afterAction(`close rejected: ${e.message}`),
            );
            return;
          }
          // Editor-based flows dismiss the inspector first: the editor owns
          // the terminal while open. Every action records human origin.
          done();
          if (action.kind === "message" || action.kind === "task") {
            void (async () => {
              const text = await ctx.ui.editor(action.kind === "message" ? `Note to subagent ${short}` : `New task for subagent ${short}`, "");
              if (text === undefined || !text.trim()) {
                ctx.ui.notify(`${action.kind} cancelled.`, "info");
                return;
              }
              try {
                const res = await sub.sendMessage("user", id, action.kind === "message" ? "note" : "task", text, {}, `ui:${Date.now()}`);
                ctx.ui.notify(`${action.kind} accepted (message ${res.messageId.slice(0, 8)}).`, "info");
              } catch (e) {
                ctx.ui.notify(`${action.kind} rejected: ${(e as Error).message}`, "error");
              }
            })();
            return;
          }
          if (action.kind === "answer") {
            void (async () => {
              const open = sub.pendingQuestions("user").filter((q) => q.from === id || q.to === id);
              if (open.length === 0) {
                ctx.ui.notify(`No open questions for ${short}.`, "warning");
                return;
              }
              if (open.length > 1) ctx.ui.notify(`${open.length} open questions; answering the first.`, "warning");
              const text = await ctx.ui.editor(`Answer to ${short}`, "");
              if (text === undefined || !text.trim()) {
                ctx.ui.notify("Answer cancelled.", "info");
                return;
              }
              try {
                await sub.sendMessage("user", id, "note", text, { replyTo: open[0]!.messageId }, `ui:${Date.now()}`);
                ctx.ui.notify("Answer recorded; parked waiter resumes without a new root turn.", "info");
              } catch (e) {
                ctx.ui.notify(`Answer rejected: ${(e as Error).message}`, "error");
              }
            })();
            return;
          }
          if (action.kind === "retry_review") {
            void (async () => {
              try {
                const view = sub.list("user").find((v) => v.id === id);
                const taskRunId = view?.managedGateFor;
                if (!taskRunId) {
                  ctx.ui.notify(`No managed gate for ${short}.`, "warning");
                  return;
                }
                const gate = sub.gateController;
                const state = gate.inspect(taskRunId);
                if (!state) {
                  ctx.ui.notify(`Gate state for ${short} unknown.`, "warning");
                  return;
                }
                if (!state.terminal && state.review && state.review.status === "interrupted") {
                  gate.resumeReview(taskRunId, state.review.reviewId, `ui:${Date.now()}`);
                  ctx.ui.notify(`Review ${state.review.reviewId.slice(0, 8)} resumed with fresh context; counters kept.`, "info");
                  return;
                }
                if (state.terminal && state.candidate) {
                  const next = gate.retryReview(taskRunId, state.candidate.candidateId, {
                    model: state.spec.model,
                    thinkingLevel: state.spec.thinkingLevel,
                    prompt: state.spec.prompt,
                  }, `ui:${Date.now()}`);
                  ctx.ui.notify(`Linked review run ${next.slice(0, 8)} started; original outcome immutable.`, "info");
                  return;
                }
                ctx.ui.notify(`Nothing resumable for ${short} (review active or gate terminal without candidate).`, "warning");
              } catch (e) {
                ctx.ui.notify(`Gate retry rejected: ${(e as Error).message}`, "error");
              }
            })();
          }
        };
        inspector = new AgentInspector(views, {
          refresh: () => sub.list("user"),
          onClose: () => done(),
          onAction: handleAction,
          requestRender: render,
        });
        return inspector;
      });
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    bindingFor(ctx);
  });

  pi.on("input", async (_event, ctx) => {
    // New user input cancels waits without cancelling children.
    const binding = bindingFor(ctx);
    binding?.supervisor.cancelCallerWaits("governor");
  });

  pi.on("turn_end", async (_event, ctx) => {
    // Boundary drain: bounded mailbox batch into native entries for the
    // active governing run. Idle roots only update counts (no auto-wake).
    const binding = bindingFor(ctx);
    if (!binding) return;
    try {
      const entries = ctx.sessionManager.getEntries() as Array<{ id: string }>;
      void entries;
      const { events } = binding.supervisor.drainNotices(0, 5);
      const material = events.filter((e) => e.kind === "task.terminal" || e.kind === "generation.settled" || e.kind === "mailbox.accepted");
      if (material.length === 0) return;
      try {
        pi.sendMessage(
          {
            customType: CUSTOM_NOTICE,
            content: [{ type: "text", text: sanitizeDisplay(material.map((m) => m.summary).join("; "), 2000) }],
            display: false,
            details: { schemaVersion: 1, events: material.map((m) => m.seq) },
          },
          { triggerTurn: false },
        );
      } catch {
        // Journal receipts stay authoritative; notification is best effort.
      }
    } catch {
      // Observation must never break the governing run.
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    let sessionId: string | null = null;
    try {
      sessionId = ctx.sessionManager.getSessionId() as string;
    } catch {
      return;
    }
    const binding = sessionId ? bindings.get(sessionId) : undefined;
    if (!binding) return;
    bindings.delete(sessionId!);
    // Switching sessions cancels and joins the live subtree, closes owned
    // tool jobs, and preserves durable state.
    await binding.supervisor.shutdown();
  });
}
