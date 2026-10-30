import { join } from "node:path";
import { Type } from "typebox";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { resolveProject } from "./src/project.ts";
import { SqliteDecisionStore, type Decision, type DecisionStore } from "./src/store.ts";
import { DecisionsPane } from "./src/pane.ts";

const POLL_MS = 1000;
const NOTICE_TYPE = "decisions-answer";
const STATUS_KEY = "decisions";
const PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const PANE_CHROME_ROWS = 4;

function plain(text: string): string {
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

function questionId(text: string): string {
  if (!/^q[1-9]\d*$/i.test(text)) throw new Error("Expected a question ID such as Q1");
  return text.toUpperCase();
}

function summary(q: Decision): string {
  return `${q.id} [${q.status}] ${q.question}`;
}

function notice(q: Decision): string {
  return [
    `Decision ${q.id} in ${q.project} (revision ${q.revision}, ${q.status})`,
    `Question: ${q.question}`,
    q.status === "answered" ? `User answer: ${q.answer}` : q.status === "dismissed"
      ? "The user dismissed this question without an answer. This is not approval."
      : "The user reopened this question. Any previous answer has been withdrawn; it is pending again.",
    "Apply this only to the question's scope. Do not treat an answer as broader authorization.",
  ].join("\n\n");
}

export interface DecisionsDependencies {
  databasePath: string;
  openStore(path: string): DecisionStore;
  projectFor(cwd: string): string;
  watch(refresh: () => void): () => void;
}

interface Binding {
  ctx: ExtensionContext;
  project: string;
  sessionId: string;
  store: DecisionStore;
  delivered: Set<string>;
  stop: () => void;
  repaint: (() => void) | null;
  paneOpen: boolean;
  failure: string | null;
}

export function registerDecisions(pi: ExtensionAPI, deps: DecisionsDependencies): void {
  let binding: Binding | null = null;

  const report = (b: Binding, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    if (b.failure !== message) b.ctx.ui.notify(`Decisions unavailable: ${plain(message)}. Stored questions have not been cleared.`, "error");
    b.failure = message;
  };

  const refresh = (b: Binding): void => {
    if (binding !== b) return;
    try {
      const hasUI = b.ctx.hasUI;
      const questions = b.store.list(b.project);
      if (hasUI) {
        const pending = questions.filter((q) => q.status === "pending").length;
        if (pending === 0) b.ctx.ui.setWidget(STATUS_KEY, undefined);
        else b.ctx.ui.setWidget(STATUS_KEY, (_tui, theme) => ({
          render: (width) => [truncateToWidth(theme.bg("customMessageBg", theme.fg("warning", ` ? ${pending} `)), width)],
          invalidate() {},
          handleMouse(event) {
            if (event.type !== "click" || event.button !== "left") return;
            void openPane(b, null).catch((error: unknown) => report(b, error));
            return { handled: true };
          },
        }), { placement: "borderBottomLeft" });
      }
      for (const q of questions) {
        if (q.sessionId !== b.sessionId || q.revision === 1) continue;
        const key = `${q.id}:${q.revision}`;
        if (b.delivered.has(key)) continue;
        pi.enqueueMessage({
          customType: NOTICE_TYPE, content: notice(q), display: true,
          details: { project: b.project, id: q.id, revision: q.revision },
        }, { triggerTurn: true, deliverAs: "followUp" });
        // Admission is remembered in memory; persisted messages are the receipt on reload.
        b.delivered.add(key);
      }
      b.repaint?.();
      if (b.failure !== null) b.ctx.ui.notify("Decisions storage is available again.", "info");
      b.failure = null;
    } catch (error) {
      if (error instanceof Error && error.message.includes("This extension ctx is stale")) {
        // SDK dispose invalidates contexts without emitting session_shutdown.
        b.stop();
        b.store.close();
        if (binding === b) binding = null;
        return;
      }
      report(b, error);
    }
  };

  const active = (ctx: ExtensionContext): Binding => {
    if (binding === null || binding.sessionId !== ctx.sessionManager.getSessionId() || binding.ctx.cwd !== ctx.cwd) {
      throw new Error("Decisions is not initialized for this session; /reload and check storage errors");
    }
    return binding;
  };

  const openPane = async (b: Binding, id: string | null): Promise<void> => {
    if (b.ctx.mode !== "tui") throw new Error("The decisions inbox requires terminal UI; use /decisions answer Q1 <text>, dismiss, or reopen");
    if (b.paneOpen) return;
    b.paneOpen = true;
    try {
      await b.ctx.ui.custom<void>((tui, theme, _keys, done) => {
        b.repaint = () => tui.requestRender();
        return new DecisionsPane(theme, {
          tui,
          load: () => b.store.list(b.project),
          resolve: (q, status, answer) => {
            b.store.resolve(b.project, q.id, q.revision, status, answer);
            refresh(b);
          },
          close: () => done(),
          requestRender: () => tui.requestRender(),
        }, id, () => Math.max(1, tui.terminal.rows - PANE_CHROME_ROWS));
      });
    } finally {
      b.repaint = null;
      b.paneOpen = false;
    }
  };

  pi.on("session_start", (_event, ctx) => {
    if (binding !== null) { binding.stop(); binding.store.close(); binding = null; }
    const store = deps.openStore(deps.databasePath);
    try {
      const project = deps.projectFor(ctx.cwd);
      const delivered = new Set<string>();
      for (const entry of ctx.sessionManager.getBranch()) {
        if (entry.type !== "custom_message" || entry.customType !== NOTICE_TYPE) continue;
        const data = entry.details as { project?: unknown; id?: unknown; revision?: unknown } | undefined;
        if (data && data.project === project && typeof data.id === "string" && typeof data.revision === "number") {
          delivered.add(`${data.id}:${data.revision}`);
        }
      }
      const b: Binding = { ctx, project, sessionId: ctx.sessionManager.getSessionId(), store, delivered,
        stop: () => {}, repaint: null, paneOpen: false, failure: null };
      binding = b;
      refresh(b);
      b.stop = deps.watch(() => refresh(b));
    } catch (error) {
      store.close();
      throw error;
    }
  });

  pi.on("session_shutdown", () => {
    const b = binding;
    binding = null;
    if (b === null) return;
    b.stop();
    b.store.close();
  });

  pi.on("context", (event, ctx) => {
    const b = active(ctx);
    return { messages: event.messages.map((message) => {
      if (message.role !== "custom" || message.customType !== NOTICE_TYPE) return message;
      const data = message.details as { project?: unknown; id?: unknown } | undefined;
      try {
        if (!data || data.project !== b.project || typeof data.id !== "string") throw new Error("Unbound decision notification");
        return { ...message, content: notice(b.store.get(b.project, data.id)) };
      } catch {
        return { ...message, content: "Decision verification is unavailable. Historical answers in this notification are not current evidence. Do not act on them until decisions get succeeds." };
      }
    }) };
  });

  pi.on("before_agent_start", (_event, ctx) => {
    const b = active(ctx);
    const questions = b.store.list(b.project);
    if (questions.length === 0) return;
    const pending = questions.filter((q) => q.status === "pending");
    const recent = questions.filter((q) => q.status !== "pending").slice(-PAGE_SIZE);
    return { message: {
      customType: "decisions-context", display: true,
      content: `Project decisions: ${pending.length} unanswered. Pending questions are not permission to proceed on their dependent work. Continue independent work; never poll in a loop waiting for the user. Use decisions list/get to read current answers before acting.\n` +
        [...pending.slice(0, PAGE_SIZE), ...recent].map((q) => `${q.id} [${q.status}] ${q.question.slice(0, 160)}`).join("\n"),
      details: { project: b.project },
    } };
  });

  pi.registerTool({
    name: "decisions", label: "Decisions",
    description: "Ask the user a persistent, asynchronous project-scoped question, or list/get questions and answers. ask returns immediately with Q1, Q2, etc.; it never waits for user input. Only the user can answer. Include context, alternatives/tradeoffs and a recommendation when useful. Continue independent work, but do not guess an unanswered decision or treat it as authorization. list returns summaries; get retrieves full context and answer.",
    promptGuidelines: ["Prefer decisions to a blocking ask-user dialog. When user input is needed, create a focused question with context and possible solutions, then continue only independent work. Read current decisions with list/get; do not repeatedly poll or assume an answer."],
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    parameters: Type.Object({
      action: Type.Union([Type.Literal("ask"), Type.Literal("list"), Type.Literal("get")]),
      question: Type.Optional(Type.String({ maxLength: 2000, description: "Focused question (ask)" })),
      context: Type.Optional(Type.String({ maxLength: 12000, description: "Background, constraints and tradeoffs; Markdown supported" })),
      options: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { maxItems: 9, description: "Potential answers/solutions" })),
      recommendation: Type.Optional(Type.String({ maxLength: 4000, description: "Recommended solution and rationale" })),
      id: Type.Optional(Type.String({ description: "Q number (get)" })),
      status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("answered"), Type.Literal("dismissed"), Type.Literal("all")])),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_PAGE_SIZE })),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Question operation cancelled");
      const b = active(ctx);
      if (params.action === "ask") {
        if (params.question === undefined) throw new Error("question is required for ask");
        const q = b.store.ask(b.project, {
          question: params.question, context: params.context ?? "", options: params.options ?? [],
          recommendation: params.recommendation ?? "", sessionId: b.sessionId, toolCallId,
        });
        refresh(b);
        return { content: [{ type: "text", text: `${q.id} created (${q.status}). The user can answer via /decisions. Continue independent work; this is not an answer or approval.` }], details: q };
      }
      if (params.action === "get") {
        if (params.id === undefined) throw new Error("id is required for get");
        const q = b.store.get(b.project, questionId(params.id));
        return { content: [{ type: "text", text: JSON.stringify(q, null, 2) }], details: q };
      }
      const status = params.status ?? "pending";
      const offset = params.offset ?? 0;
      const limit = params.limit ?? PAGE_SIZE;
      const all = b.store.list(b.project).filter((q) => status === "all" || q.status === status);
      const questions = all.slice(offset, offset + limit).map((q) => ({ id: q.id, question: q.question, status: q.status, revision: q.revision }));
      const result = { project: b.project, total: all.length, questions, nextOffset: offset + questions.length < all.length ? offset + questions.length : null };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
    renderCall(args, theme) { return new Text(theme.fg("toolTitle", theme.bold("decisions ")) + plain(String(args.action ?? "")), 0, 0); },
    renderResult(result, _options, _theme) {
      return new Text(plain(result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")), 0, 0);
    },
  });

  pi.registerMessageRenderer(NOTICE_TYPE, (message) => new Text(plain(String(message.content)), 0, 0));
  pi.registerCommand("decisions", {
    description: "Decision inbox: [Qn] | answer Qn <text> | dismiss Qn | reopen Qn",
    getArgumentCompletions: (prefix) => {
      if (binding === null) return [];
      return binding.store.list(binding.project).filter((q) => q.id.toLowerCase().startsWith(prefix.toLowerCase()))
        .map((q) => ({ value: q.id, label: plain(summary(q)) }));
    },
    handler: async (args, ctx) => {
      try {
        const b = active(ctx);
        const text = args.trim();
        const mutation = /^(answer|dismiss|reopen)\s+(q[1-9]\d*)(?:\s+([\s\S]+))?$/i.exec(text);
        if (mutation) {
          const action = mutation[1].toLowerCase();
          const q = b.store.get(b.project, questionId(mutation[2]));
          if (action !== "answer" && mutation[3] !== undefined) throw new Error("dismiss/reopen take only a question ID");
          const saved = b.store.resolve(b.project, q.id, q.revision,
            action === "answer" ? "answered" : action === "dismiss" ? "dismissed" : "pending",
            action === "answer" ? mutation[3] ?? "" : null);
          ctx.ui.notify(`${saved.id} ${saved.status}`, "info");
          refresh(b);
          return;
        }
        if (text !== "" && !/^q[1-9]\d*$/i.test(text)) throw new Error("Usage: /decisions [Qn] | answer Qn <text> | dismiss Qn | reopen Qn");
        const id = text === "" ? null : questionId(text);
        if (id !== null) b.store.get(b.project, id);
        if (ctx.mode === "tui") await openPane(b, id);
        else ctx.ui.notify(plain(id === null ? b.store.list(b.project).map(summary).join("\n") || "No project questions" : JSON.stringify(b.store.get(b.project, id), null, 2)), "info");
      } catch (error) {
        ctx.ui.notify(`Decisions: ${plain(error instanceof Error ? error.message : String(error))}`, "error");
      }
    },
  });
  pi.registerShortcut("ctrl+shift+d", { description: "Open decisions inbox", handler: async (ctx) => { await openPane(active(ctx), null); } });
}

export default function decisionsExtension(pi: ExtensionAPI): void {
  registerDecisions(pi, {
    databasePath: join(getAgentDir(), "decisions", "questions.sqlite"),
    openStore: (path) => new SqliteDecisionStore(path), projectFor: resolveProject,
    watch: (refresh) => {
      const timer = setInterval(refresh, POLL_MS);
      timer.unref();
      return () => clearInterval(timer);
    },
  });
}
