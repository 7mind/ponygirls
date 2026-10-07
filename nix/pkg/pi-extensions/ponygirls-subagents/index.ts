/**
 * ponygirls-subagents — governing pi extension entry.
 *
 * Thin registration over the Supervisor: seven core tools plus manage_gate,
 * one /agents command/inspector, and boundary event wiring. All policy,
 * scheduling, journaling, brokering, and gate logic lives in the supervisor
 * and its collaborators; this file only binds sessions to supervisors.
 */

import { Type, type TSchema } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { FileRunStore } from "./src/store.ts";
import { Supervisor, type CallerId } from "./src/supervisor.ts";
import type { GateSpecInput } from "./src/gate.ts";
import { instructionsFromPromptOptions, parseSelection } from "./src/instructions.ts";
import { defaultSupervisorPolicy, type SupervisorPolicy } from "./src/policy.ts";
import { gateParameters, readParameters, spawnParameters, waitParameters } from "./src/tools.ts";
import type { InstructionSet, Isolation, ResolvedModel } from "./src/types.ts";
import { AgentsScreen, fileSessionReader, renderHeadless, sanitizeDisplay, widgetLine, type InspectorAction } from "./src/ui.ts";
import { themeStyle } from "./src/display.ts";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CUSTOM_NOTICE = "pi-subagents-notice";
/** Footer statuses sort by key; this one sorts ahead of long ones such as "search". */
const STATUS_KEY = "agents";
/** How often an open /agents screen re-reads state and transcripts. */
const SCREEN_POLL_MS = 500;
const NOTICE_BATCH = 20;
const NOTICE_TEXT_MAX = 48_000;
const STATUS_THROTTLE_MS = 250;
const TOOL_RESULT_MAX = 24_000;
const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), "src", "worker.ts");

function agentBaseDir(): string {
  return process.env["PI_CODING_AGENT_DIR"] ?? join(homedir(), ".pi", "agent");
}

/**
 * Root authority from the user-owned policy file. A present but invalid
 * file is an error, never a silent fallback to defaults.
 */
function loadPolicy(): SupervisorPolicy {
  const policy = defaultSupervisorPolicy();
  const path = join(agentBaseDir(), "subagents-policy.json");
  if (!existsSync(path)) return policy;
  let raw: Partial<SupervisorPolicy>;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SupervisorPolicy>;
  } catch (e) {
    throw new Error(`POLICY_DENIED: ${path} is not valid JSON: ${(e as Error).message}`);
  }
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
  // Explicit null opts out of the model allowlist: every model may be
  // assigned (availability/credentials still fail naturally at launch).
  // Absent (or any other shape) keeps the default: explicit model overrides
  // are denied, children inherit their owner's model.
  if (raw.allowedModels === null) policy.allowedModels = null;
  else if (Array.isArray(raw.allowedModels)) {
    policy.allowedModels = raw.allowedModels.filter((m) => typeof m?.provider === "string" && typeof m?.id === "string");
  }
  policy.revision += 1;
  return policy;
}

interface SessionBinding {
  sessionId: string;
  supervisor: Supervisor;
  /** The governing session's model at its latest tool call (what children inherit). */
  model: ResolvedModel | null;
  /** The governing session's working directory (host-isolated children start here). */
  cwd: string;
  /** Skills and context files pi loaded for the current run (what children can receive). */
  instructions: InstructionSet | null;
  /** Notices already delivered to the governing conversation. */
  noticeCursor: number;
  ui: ExtensionContext["ui"] | null;
  statusTimer: ReturnType<typeof setTimeout> | null;
}

type ToolText = { content: Array<{ type: "text"; text: string }>; details: Record<string, never>; isError?: true };

function ok(value: unknown): ToolText {
  return { content: [{ type: "text", text: JSON.stringify(value).slice(0, TOOL_RESULT_MAX) }], details: {} };
}

function failed(e: unknown): ToolText {
  const code = (e as { code?: string }).code;
  const message = (e as Error).message ?? String(e);
  return { content: [{ type: "text", text: code && !message.startsWith(code) ? `${code}: ${message}` : message }], details: {}, isError: true };
}

/** Publish (or clear) the bottom-left badge; a click opens /agents. */
function publishBadge(ui: ExtensionContext["ui"] | null, line: string | null, open: () => void): void {
  if (!ui) return;
  if (line === null) {
    ui.setWidget(STATUS_KEY, undefined);
    return;
  }
  const label = ui.theme.bg("toolSuccessBg", ` ${line} `);
  ui.setWidget(
    STATUS_KEY,
    () => ({
      render: () => [label],
      invalidate: () => {},
      handleMouse: (event) => {
        if (event.type !== "click" || event.button !== "left") return undefined;
        open();
        return { handled: true };
      },
    }),
    { placement: "borderBottomLeft" },
  );
}

export default function (pi: ExtensionAPI): void {
  const bindings = new Map<string, SessionBinding>();

  function refreshStatus(binding: SessionBinding, ctx: ExtensionContext): void {
    if (binding.statusTimer) return;
    binding.statusTimer = setTimeout(() => {
      binding.statusTimer = null;
      const views = binding.supervisor.list("user");
      publishBadge(binding.ui, views.length > 0 ? widgetLine(views) : null, () => void openAgents("", ctx));
    }, STATUS_THROTTLE_MS);
  }

  /** The session's supervisor; throws (no fallback) when the root store cannot be opened. */
  function bindingFor(ctx: ExtensionContext): SessionBinding {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!sessionId) throw new Error("INVALID: subagents need a session id");
    const existing = bindings.get(sessionId);
    if (existing) {
      existing.ui = ctx.ui;
      return existing;
    }
    const sdkRoot = process.env["PI_SUBAGENTS_SDK_ROOT"];
    if (!sdkRoot) throw new Error("SANDBOX_UNAVAILABLE: PI_SUBAGENTS_SDK_ROOT is not set; workers cannot load the pi SDK");
    const rootDir = join(agentBaseDir(), "subagents", sessionId);
    const binding: SessionBinding = { sessionId, supervisor: null as unknown as Supervisor, model: null, cwd: ctx.cwd, instructions: null, noticeCursor: 0, ui: ctx.ui, statusTimer: null };
    const store = new FileRunStore(rootDir, sessionId);
    // Notices start at the current journal end: history is not redelivered.
    binding.noticeCursor = store.durableSeq();
    binding.supervisor = new Supervisor({
      rootId: sessionId,
      rootDir,
      store,
      policy: loadPolicy(),
      governor: () => ({ model: binding.model, cwd: binding.cwd, instructions: binding.instructions }),
      workerPath: WORKER_PATH,
      sdkRoot,
      deterministic: false,
      hostAgentDir: agentBaseDir(),
      onChange: () => refreshStatus(binding, ctx),
    });
    bindings.set(sessionId, binding);
    // Runs left unfinished by a previous process settle before any new
    // command is accepted (recover() holds the controller chain).
    if (binding.supervisor.needsRecovery) {
      void binding.supervisor.recover().then(
        (report) => ctx.ui.notify(`subagents: recovered root (settled ${report.settled.length}, quarantined ${report.quarantined.length}, queued ${report.requeued.length})`, "info"),
        (e: Error) => ctx.ui.notify(`subagents: recovery failed: ${e.message}`, "error"),
      );
    }
    return binding;
  }

  /** Bind and record the governing model children inherit at this call. */
  function governing(ctx: ExtensionContext): SessionBinding {
    const binding = bindingFor(ctx);
    binding.model = ctx.model ? { provider: ctx.model.provider, id: ctx.model.id, thinkingLevel: pi.getThinkingLevel() } : null;
    return binding;
  }

  const caller: CallerId = "governor";

  pi.registerTool(
    defineTool({
      name: "spawn_agent",
      label: "Spawn subagent",
      description:
        "Start a subagent on a task and return immediately with its agent id, path, task-run id, generation, and workdir (it does not wait for completion; use wait_agent). By default (isolation worktree) a writer edits its own git worktree of your checkout; its changes stay in workdir until you bring them over (e.g. git -C <workdir> diff). isolation none edits your working directory in place. The child sees only its task text plus the skills and context files you pass. It inherits your model unless `model` names an allowlisted one. Optional gate enables reviewer validation, with deterministic checks for writers.",
      parameters: spawnParameters<TSchema>(Type, {
        model: Type.Optional(Type.Object({ provider: Type.String(), id: Type.String(), thinkingLevel: Type.Optional(Type.String()) })),
        gate: Type.Optional(gateParameters<TSchema>(Type)),
      }),
      executionMode: "sequential",
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const p = params as { task_name: string; message: string; profile: "reader" | "writer"; isolation?: Isolation; repo_id?: string; base_commit?: string; model?: { provider: string; id: string; thinkingLevel?: string }; gate?: GateSpecInput };
          return ok(await governing(ctx).supervisor.spawn(caller, {
            taskName: p.task_name,
            message: p.message,
            profile: p.profile,
            isolation: p.isolation,
            repoId: p.repo_id ?? null,
            baseCommit: p.base_commit ?? null,
            skills: parseSelection(params as Record<string, unknown>, "skills"),
            contextFiles: parseSelection(params as Record<string, unknown>, "context_files"),
            model: p.model ?? null,
            gate: p.gate ?? null,
          }, `tool:${toolCallId}`));
        } catch (e) {
          return failed(e);
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "send_message",
      label: "Message subagent",
      description: "Send a durable attributed message to a subagent. mode note persists without starting work; steer affects the running generation (rejects idle agents); task starts a new task run (queued behind unfinished work; reloads an idle agent). reply_to answers a child's question (see openQuestion in list_agents or messages in wait_agent).",
      parameters: Type.Object({
        target: Type.String({ description: "Agent id" }),
        message: Type.String(),
        mode: Type.Union([Type.Literal("note"), Type.Literal("steer"), Type.Literal("task")]),
        request_reply: Type.Optional(Type.Boolean()),
        reply_to: Type.Optional(Type.String({ description: "Question message id being answered" })),
      }),
      executionMode: "sequential",
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const p = params as { target: string; message: string; mode: "note" | "steer" | "task"; request_reply?: boolean; reply_to?: string };
          return ok(await governing(ctx).supervisor.sendMessage(caller, p.target, p.mode, p.message, { requestReply: p.request_reply, replyTo: p.reply_to }, `tool:${toolCallId}`));
        } catch (e) {
          return failed(e);
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "list_agents",
      label: "List subagents",
      description: "Return the subagent tree: id, path, profile, model, observed state, pending intent, current task-run id, generation, outcome, usage, and any open question a child asked you.",
      parameters: Type.Object({}),
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        try {
          return ok(governing(ctx).supervisor.list(caller));
        } catch (e) {
          return failed(e);
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "read_agent",
      label: "Read subagent",
      description: "Read a subagent's status, a task result (deliverable text plus outcome detail; latest run unless task_run_id names an earlier one), or a bounded page of its events after a cursor.",
      parameters: readParameters<TSchema>(Type),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const p = params as { target: string; view: "status" | "result" | "events"; task_run_id?: string; cursor?: number; limit?: number };
          return ok(governing(ctx).supervisor.read(caller, p.target, p.view, p.cursor ?? 0, p.limit ?? 20, p.task_run_id ?? null));
        } catch (e) {
          return failed(e);
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "wait_agent",
      label: "Wait for subagents",
      description: "Wait for durable events after a cursor; returns a bounded event batch, messages addressed to you (with text), and a new cursor to pass next time. condition activity, any_settled, or all_settled; targets capture exact task-run ids (taskRunId null = the agent's current run; no targets = all unfinished runs). A child's question ends a settlement wait early with reason needs_response. New user input or Escape cancels the wait (children keep running).",
      parameters: waitParameters<TSchema>(Type),
      executionMode: "sequential",
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        try {
          const p = params as { cursor?: number; timeout_ms?: number; targets?: Array<{ agentId: string; taskRunId: string | null }>; condition?: "activity" | "any_settled" | "all_settled" };
          const supervisor = governing(ctx).supervisor;
          if (signal?.aborted) return ok({ completed: false, reason: "cancelled" });
          const onAbort = (): void => supervisor.cancelCallerWaits(caller);
          signal?.addEventListener("abort", onAbort, { once: true });
          try {
            return ok(await supervisor.wait(caller, p.cursor ?? 0, p.timeout_ms ?? 30_000, p.targets ?? null, p.condition ?? "activity"));
          } finally {
            signal?.removeEventListener("abort", onAbort);
          }
        } catch (e) {
          return failed(e);
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "interrupt_agent",
      label: "Interrupt subagent",
      description: "Request interruption of a subagent's task run, its linked gate, and active descendants. Returns acceptance plus the previous snapshot; confirm the stopped state separately. Sessions and worktrees are preserved.",
      parameters: Type.Object({ target: Type.String() }),
      executionMode: "sequential",
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          return ok(await governing(ctx).supervisor.interrupt(caller, (params as { target: string }).target, `tool:${toolCallId}`));
        } catch (e) {
          return failed(e);
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "close_agent",
      label: "Close subagent",
      description: "Permanently close a subagent subtree and its managed gates after interruption/cleanup. Sessions, results, and dirty worktrees are preserved; deleting retained files is a separate explicit user action.",
      parameters: Type.Object({ target: Type.String() }),
      executionMode: "sequential",
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const target = (params as { target: string }).target;
          await governing(ctx).supervisor.close(caller, target, `tool:${toolCallId}`);
          return ok({ closed: target });
        } catch (e) {
          return failed(e);
        }
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "manage_gate",
      label: "Manage validation gate",
      description: "Governor-only controls for gated tasks: resume_review (interrupted review, same run and counters; needs review_id), retry_review (terminal run: linked new run reviewing the same candidate; needs candidate_id; gate replaces the run's own specification when given), bypass (explicit acceptance without validation, recorded as gate_bypassed, never approval; needs candidate_id and reason), set_limits (agreement cap within root authority; max_rounds).",
      parameters: Type.Object({
        target: Type.String({ description: "Task-run id the action applies to" }),
        action: Type.Union([Type.Literal("resume_review"), Type.Literal("retry_review"), Type.Literal("bypass"), Type.Literal("set_limits")]),
        review_id: Type.Optional(Type.String()),
        candidate_id: Type.Optional(Type.String()),
        reason: Type.Optional(Type.String()),
        max_rounds: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
        gate: Type.Optional(gateParameters<TSchema>(Type)),
      }),
      executionMode: "sequential",
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        try {
          const p = params as {
            target: string; action: "resume_review" | "retry_review" | "bypass" | "set_limits";
            review_id?: string; candidate_id?: string; reason?: string; max_rounds?: number | null;
            gate?: GateSpecInput;
          };
          const supervisor = governing(ctx).supervisor;
          const commandId = `tool:${toolCallId}`;
          const need = (v: string | undefined, what: string): string => {
            if (!v) throw new Error(`INVALID: ${p.action} requires ${what}`);
            return v;
          };
          if (p.action === "resume_review") return ok(await supervisor.manageGate(caller, { kind: "resume_review", taskRunId: p.target, reviewId: need(p.review_id, "review_id") }, commandId));
          if (p.action === "retry_review") {
            return ok(await supervisor.manageGate(caller, { kind: "retry_review", taskRunId: p.target, candidateId: need(p.candidate_id, "candidate_id"), gate: p.gate ?? null }, commandId));
          }
          if (p.action === "bypass") return ok(await supervisor.manageGate(caller, { kind: "bypass", taskRunId: p.target, candidateId: need(p.candidate_id, "candidate_id"), reason: need(p.reason, "reason") }, commandId));
          if (p.max_rounds === undefined) throw new Error("INVALID: set_limits requires max_rounds (a positive integer or null)");
          return ok(await supervisor.manageGate(caller, { kind: "set_limits", taskRunId: p.target, maxRounds: p.max_rounds }, commandId));
        } catch (e) {
          return failed(e);
        }
      },
    }),
  );

  const openAgents = async (_args: string, ctx: ExtensionContext): Promise<void> => {
      let binding: SessionBinding;
      try {
        binding = bindingFor(ctx);
      } catch (e) {
        ctx.ui.notify(`/agents: ${(e as Error).message}`, "error");
        return;
      }
      const sub = binding.supervisor;
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        const views = sub.list("user");
        ctx.ui.notify(`${widgetLine(views)}\n${renderHeadless(views)}`, "info");
        return;
      }
      await ctx.ui.custom<void>((tui, theme, _kb, done) => {
        const style = themeStyle(theme);
        const render = (): void => tui.requestRender();
        const requestId = (): string => `ui:${randomUUID()}`;
        const questionOf = (agentId: string): { messageId: string; text: string } | null => {
          const q = sub.pendingQuestions("user").find((x) => x.from === agentId && x.to === "governor");
          return q ? { messageId: q.messageId, text: q.text } : null;
        };
        let poll: ReturnType<typeof setInterval> | null = null;
        const finish = (): void => {
          if (poll) clearInterval(poll);
          poll = null;
          done();
        };
        const afterAction = (note: string): void => {
          screen.inspector.notice(note);
          screen.refresh();
          render();
        };
        const handleAction = (action: InspectorAction): void => {
          const id = action.agentId;
          const short = id.slice(0, 8);
          if (action.kind === "interrupt") {
            void sub.interrupt("user", id, requestId()).then(
              () => afterAction(`interrupt accepted for ${short}; confirm stopped state separately`),
              (e: Error) => afterAction(`interrupt rejected: ${e.message}`),
            );
            return;
          }
          if (action.kind === "close") {
            void sub.close("user", id, requestId()).then(
              () => afterAction(`closed ${short}; sessions and dirty worktrees preserved`),
              (e: Error) => afterAction(`close rejected: ${e.message}`),
            );
            return;
          }
          if (action.kind === "retry_review") {
            const view = sub.list("user").find((v) => v.id === id);
            const taskRunId = view?.managedGateFor ?? view?.gateTaskRunId ?? null;
            const state = taskRunId ? sub.gateController.inspect(taskRunId) : null;
            if (!taskRunId || !state) {
              afterAction(`no gate for ${short}`);
              return;
            }
            if (!state.terminal && state.review?.status === "interrupted") {
              void sub.manageGate("user", { kind: "resume_review", taskRunId, reviewId: state.review.reviewId }, requestId()).then(
                () => afterAction(`review ${state.review?.reviewId} resumed with fresh context; counters kept`),
                (e: Error) => afterAction(`resume rejected: ${e.message}`),
              );
            } else if (state.terminal && state.candidate) {
              void sub.manageGate("user", { kind: "retry_review", taskRunId, candidateId: state.candidate.candidateId, gate: null }, requestId()).then(
                (next) => afterAction(`linked review run ${next.taskRunId.slice(0, 8)} started under the same gate; the original outcome stays`),
                (e: Error) => afterAction(`retry rejected: ${e.message}`),
              );
            } else {
              afterAction(`nothing to resume or retry for ${short} (review active, or no candidate)`);
            }
            return;
          }
          // Editor flows leave the screen: the editor owns the terminal while open.
          finish();
          void (async () => {
            try {
              if (action.kind === "message" || action.kind === "task") {
                const text = await ctx.ui.editor(action.kind === "message" ? `Note to subagent ${short}` : `New task for subagent ${short}`, "");
                if (text === undefined || !text.trim()) {
                  ctx.ui.notify(`${action.kind} cancelled.`, "info");
                  return;
                }
                const res = await sub.sendMessage("user", id, action.kind === "message" ? "note" : "task", text, {}, requestId());
                ctx.ui.notify(`${action.kind} accepted (message ${res.messageId.slice(0, 8)}).`, "info");
              } else if (action.kind === "answer") {
                const open = sub.pendingQuestions("user").filter((q) => q.from === id || q.to === id);
                if (open.length === 0) {
                  ctx.ui.notify(`No open questions for ${short}.`, "warning");
                  return;
                }
                if (open.length > 1) ctx.ui.notify(`${open.length} open questions; answering the first.`, "warning");
                const text = await ctx.ui.editor(`Answer to ${short}: ${sanitizeDisplay(open[0]!.text, 200)}`, "");
                if (text === undefined || !text.trim()) {
                  ctx.ui.notify("Answer cancelled.", "info");
                  return;
                }
                await sub.sendMessage("user", open[0]!.from, "note", text, { replyTo: open[0]!.messageId }, requestId());
                ctx.ui.notify("Answer recorded; the asker resumes without a new root turn.", "info");
              }
            } catch (e) {
              ctx.ui.notify(`${action.kind} rejected: ${(e as Error).message}`, "error");
            }
          })();
        };
        const screen = new AgentsScreen({
          list: () => sub.list("user"),
          describe: (agentId) => {
            const read = sub.read("user", agentId, "result", 0, 1, null);
            return { result: read.result?.text || null, question: read.status.openQuestion?.text ?? null };
          },
          transcript: (agentId, back) => ({
            view: () => sub.list("user").find((v) => v.id === agentId) ?? null,
            source: () => sub.transcript("user", agentId),
            question: () => questionOf(agentId),
            send: async (text, mode) => {
              if (mode.kind === "unavailable") throw new Error(mode.reason);
              const res = await sub.sendMessage("user", agentId, mode.kind === "task" ? "task" : mode.kind === "steer" ? "steer" : "note", text, mode.kind === "answer" ? { replyTo: mode.replyTo } : {}, requestId());
              return mode.kind === "answer" ? "answer delivered" : mode.kind === "steer" ? "steer delivered to the running task" : `new task ${res.taskRunId?.slice(0, 8) ?? ""} accepted`;
            },
            back,
            requestRender: render,
            rows: () => tui.terminal.rows,
            reader: fileSessionReader,
            style,
          }),
          onAction: handleAction,
          onClose: finish,
          requestRender: render,
          rows: () => tui.terminal.rows,
          style,
        });
        poll = setInterval(() => {
          screen.refresh();
          render();
        }, SCREEN_POLL_MS);
        return Object.assign(screen, { dispose: () => { if (poll) clearInterval(poll); poll = null; } });
      }, { overlay: true, overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 } });
  };

  pi.registerCommand("agents", {
    description: "Subagents: tree, details, transcripts with chat, and controls",
    handler: openAgents,
  });

  /**
   * Deliver child notices (terminal outcomes, messages addressed to the
   * governing session) into the governing conversation exactly once per
   * cursor position: appended at the turn boundary while a run is active,
   * queued for the next user turn while idle. No idle-root inference.
   */
  function drainNotices(binding: SessionBinding, whileRunning: boolean): void {
    const { lines, cursor } = binding.supervisor.noticesSince(binding.noticeCursor, NOTICE_BATCH);
    binding.noticeCursor = cursor;
    if (lines.length === 0) return;
    pi.sendMessage(
      {
        customType: CUSTOM_NOTICE,
        content: [{ type: "text", text: sanitizeDisplay(`[subagents]\n${lines.join("\n")}`, NOTICE_TEXT_MAX) }],
        display: true,
        details: { schemaVersion: 1, cursor },
      },
      whileRunning ? { triggerTurn: false } : { deliverAs: "nextTurn" },
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    try {
      bindingFor(ctx);
    } catch (e) {
      ctx.ui.notify(`subagents unavailable: ${(e as Error).message}`, "error");
    }
  });

  // What pi loaded for this run is what children can be handed.
  pi.on("before_agent_start", async (event, ctx) => {
    const binding = bindings.get(ctx.sessionManager.getSessionId());
    if (!binding) return;
    try {
      binding.instructions = instructionsFromPromptOptions(event.systemPromptOptions);
    } catch (e) {
      binding.instructions = null;
      ctx.ui.notify(`subagents: cannot snapshot skills/context files: ${(e as Error).message}`, "error");
    }
  });

  pi.on("input", async (_event, ctx) => {
    const binding = bindings.get(ctx.sessionManager.getSessionId());
    if (!binding) return;
    // New user input cancels waits without cancelling children.
    binding.supervisor.cancelCallerWaits(caller);
    drainNotices(binding, false);
  });

  pi.on("turn_end", async (_event, ctx) => {
    const binding = bindings.get(ctx.sessionManager.getSessionId());
    if (binding) drainNotices(binding, true);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const binding = bindings.get(sessionId);
    if (!binding) return;
    bindings.delete(sessionId);
    if (binding.statusTimer) clearTimeout(binding.statusTimer);
    publishBadge(binding.ui, null, () => {});
    // Switching sessions cancels and joins the live subtree, closes owned
    // tool jobs, and preserves durable state.
    await binding.supervisor.shutdown();
  });
}
