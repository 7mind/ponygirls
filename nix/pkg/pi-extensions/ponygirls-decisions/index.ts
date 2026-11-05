import { join } from "node:path";
import { Type } from "typebox";
import { defineTool, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { FileTogglePreferenceStore, parseToggleCommand, sessionEnabled, sessionEnabledData, TOGGLE_ARGUMENTS, type TogglePreferenceStore } from "@ponygirls/pi-settings";
import { Box, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { compactChip } from "@ponygirls/pi-ui";
import { projectDisplayName, resolveProject } from "./src/project.ts";
import { DECISION_LIMITS, SqliteDecisionStore, type Decision, type DecisionStore } from "./src/store.ts";
import { DecisionsPane } from "./src/pane.ts";
import { CONTEXT_TYPE, contextLine, summarizeContext } from "./src/context.ts";
import { completeDecisionArguments } from "./src/complete.ts";

const POLL_MS = 1000;
const NOTICE_TYPE = "decisions-answer";
const STATUS_KEY = "decisions";
const PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const PANE_CHROME_ROWS = 4;
const INBOX_SHORTCUT = { key: "ctrl+alt+d", label: "Ctrl+Alt+D" } as const;
export const SESSION_SETTING_TYPE = "ponygirls.decisions.setting";
export const PREFERENCE_FILENAME = "decisions.json";

type SettingsMode = { kind: "ready"; enabled: boolean; defaultEnabled: boolean; override: boolean | null } | { kind: "fault"; message: string };

function plain(text: string): string {
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

function questionId(text: string): string {
  if (!/^q[1-9]\d*$/i.test(text)) throw new Error("Expected a question ID such as Q1");
  return text.toUpperCase();
}

function summary(q: Decision, sessionId: string): string {
  return `${q.id} [${q.status}]${q.sessionId === sessionId ? " [this session]" : ""} ${q.question}`;
}

function notice(q: Decision): string {
  return [
    `Decision ${q.id} in ${q.project} (revision ${q.revision}, ${q.status})`,
    `Question: ${q.question}`,
    q.status === "answered" ? `User answer: ${q.answer}` : q.status === "dismissed"
      ? "This question was dismissed without an answer. This is not approval."
      : "The user reopened this question. Any previous answer has been withdrawn; it is pending again.",
    "Apply this only to the question's scope. Do not treat an answer as broader authorization.",
  ].join("\n\n");
}

export interface DecisionsDependencies {
  databasePath: string;
  preferences: TogglePreferenceStore;
  openStore(path: string): DecisionStore;
  projectFor(cwd: string): string;
  watch(refresh: () => void): () => void;
}

interface Binding {
  ctx: ExtensionContext;
  project: string;
  sessionId: string;
  store: DecisionStore | null;
  delivered: Set<string>;
  stop: () => void;
  repaint: (() => void) | null;
  paneOpen: boolean;
  failure: string | null;
}

export function registerDecisions(pi: ExtensionAPI, deps: DecisionsDependencies): void {
  let binding: Binding | null = null;
  let settings: SettingsMode = { kind: "fault", message: "settings not loaded" };
  let visible = false;
  let settingsWarning: string | null = null;

  const refreshSettings = (ctx: ExtensionContext, reconcileTools: boolean): boolean => {
    try {
      const defaults = deps.preferences.read();
      const override = sessionEnabled(ctx.sessionManager.getEntries(), ctx.sessionManager.getSessionId(), SESSION_SETTING_TYPE);
      settings = { kind: "ready", enabled: override === null ? defaults.enabled : override, defaultEnabled: defaults.enabled, override };
      if (settingsWarning !== null) ctx.ui.notify("Decisions settings are available again.", "info");
      settingsWarning = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      settings = { kind: "fault", message };
      if (settingsWarning !== message) ctx.ui.notify(`Decisions settings unavailable: ${plain(message)}. Automation disabled; stored questions have not been cleared. Check ${deps.preferences.path} and session setting records.`, "error");
      settingsWarning = message;
    }
    const enabled = settings.kind === "ready" && settings.enabled;
    const changed = visible !== enabled;
    if (changed) {
      pi.registerTool({ ...tool, exposure: enabled ? "direct" : "hidden" });
      visible = enabled;
    }
    if (changed || reconcileTools) {
      const active = pi.getActiveTools().filter((name) => name !== "decisions");
      pi.setActiveTools(enabled ? [...active, "decisions"] : active);
    }
    if (!enabled) ctx.ui.setWidget(STATUS_KEY, undefined);
    return enabled;
  };

  const storeFor = (b: Binding): DecisionStore => {
    if (b.store === null) b.store = deps.openStore(deps.databasePath);
    return b.store;
  };

  const dispose = (b: Binding): void => {
    b.stop();
    if (b.store !== null) { b.store.close(); b.store = null; }
  };

  const report = (b: Binding, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    if (b.failure !== message) b.ctx.ui.notify(`Decisions unavailable: ${plain(message)}. Stored questions have not been cleared.`, "error");
    b.failure = message;
  };

  const refresh = (b: Binding): void => {
    if (binding !== b) return;
    try {
      if (!refreshSettings(b.ctx, false)) { b.repaint?.(); return; }
      const hasUI = b.ctx.hasUI;
      const questions = storeFor(b).list(b.project);
      if (hasUI) {
        const pending = questions.filter((q) => q.status === "pending").length;
        if (pending === 0) b.ctx.ui.setWidget(STATUS_KEY, undefined);
        else b.ctx.ui.setWidget(STATUS_KEY, (_tui, theme) => ({
          render: (width) => [truncateToWidth(theme.bg("customMessageBg", theme.fg("warning", ` ? ${pending} · ${INBOX_SHORTCUT.label} `)), width)],
          renderCompact: () => compactChip(theme, "?", "attention", String(pending)),
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
        }, { triggerTurn: true, deliverAs: "steer" });
        // Admission is remembered in memory; persisted messages are the receipt on reload.
        b.delivered.add(key);
      }
      b.repaint?.();
      if (b.failure !== null) b.ctx.ui.notify("Decisions storage is available again.", "info");
      b.failure = null;
    } catch (error) {
      if (error instanceof Error && error.message.includes("This extension ctx is stale")) {
        // SDK dispose invalidates contexts without emitting session_shutdown.
        dispose(b);
        if (binding === b) binding = null;
        return;
      }
      report(b, error);
    }
  };

  const current = (ctx: ExtensionContext): Binding | null =>
    binding !== null && binding.sessionId === ctx.sessionManager.getSessionId() && binding.ctx.cwd === ctx.cwd ? binding : null;

  const active = (ctx: ExtensionContext): Binding => {
    const b = current(ctx);
    if (b === null) throw new Error("Decisions is not initialized for this session; /reload and check storage errors");
    return b;
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
          load: () => storeFor(b).list(b.project),
          resolve: (q, status, answer) => {
            storeFor(b).resolve(b.project, q.id, q.revision, status, answer);
            refresh(b);
          },
          close: () => done(),
          requestRender: () => tui.requestRender(),
        }, projectDisplayName(b.project), id, () => Math.max(1, tui.terminal.rows - PANE_CHROME_ROWS), b.sessionId);
      });
    } finally {
      b.repaint = null;
      b.paneOpen = false;
    }
  };

  pi.on("session_start", (_event, ctx) => {
    if (binding !== null) { dispose(binding); binding = null; }
    ctx.ui.setWidget(STATUS_KEY, undefined);
    refreshSettings(ctx, true);
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
      const b: Binding = { ctx, project, sessionId: ctx.sessionManager.getSessionId(), store: null, delivered,
        stop: () => {}, repaint: null, paneOpen: false, failure: null };
      binding = b;
      refresh(b);
      b.stop = deps.watch(() => refresh(b));
    } catch (error) {
      if (binding !== null) { dispose(binding); binding = null; }
      throw error;
    }
  });

  pi.on("session_tree", (_event, ctx) => {
    refreshSettings(ctx, true);
    const b = current(ctx);
    if (b !== null) refresh(b);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setWidget(STATUS_KEY, undefined);
    const b = binding;
    binding = null;
    if (b === null) return;
    dispose(b);
  });

  pi.on("context", (event, ctx) => {
    // Pi forwards the original messages when a context handler throws, so an unbound session fails closed here.
    const enabled = refreshSettings(ctx, false);
    const b = current(ctx);
    const messages = enabled ? event.messages : event.messages.filter((message) =>
      message.role !== "custom" || (message.customType !== NOTICE_TYPE && message.customType !== CONTEXT_TYPE));
    return { messages: messages.map((message) => {
      if (message.role !== "custom" || message.customType !== NOTICE_TYPE) return message;
      const data = message.details as { project?: unknown; id?: unknown } | undefined;
      try {
        if (b === null || !data || data.project !== b.project || typeof data.id !== "string") throw new Error("Unbound decision notification");
        return { ...message, content: notice(storeFor(b).get(b.project, data.id)) };
      } catch {
        return { ...message, content: "Decision verification is unavailable. Historical answers in this notification are not current evidence. Do not act on them until decisions get succeeds." };
      }
    }) };
  });

  pi.on("before_agent_start", (_event, ctx) => {
    if (!refreshSettings(ctx, false)) return;
    const b = active(ctx);
    const questions = storeFor(b).list(b.project);
    if (questions.length === 0) return;
    const pending = questions.filter((q) => q.status === "pending");
    const recent = questions.filter((q) => q.status !== "pending").slice(-PAGE_SIZE);
    return { message: {
      customType: CONTEXT_TYPE, display: true,
      content: `Project decisions: ${pending.length} unanswered. Pending questions are not permission to proceed on their dependent work. Continue independent work; never poll in a loop waiting for the user. Use decisions list/get to read current answers before acting. If the user responds in chat, record their explicit answer or dismissal with decisions answer/dismiss using the current revision; clarify ambiguous replies rather than guessing.\n` +
        [...pending.slice(0, PAGE_SIZE), ...recent].map((q) => summary({ ...q, question: q.question.slice(0, 160) }, b.sessionId)).join("\n"),
      details: { project: b.project },
    } };
  });

  const tool = defineTool({
    name: "decisions", label: "Decisions",
    description: "Ask the user a persistent, asynchronous project-scoped question, list/get questions and answers, or record the user's explicit chat response with answer/dismiss. ask returns immediately with Q1, Q2, etc.; it never waits for user input. Include context, alternatives/tradeoffs and a recommendation when useful. list returns summaries; get retrieves full context and answer. answer requires id, revision and answer text; dismiss requires id and revision and is not approval. Read the current revision with list/get before saving; on conflict reread and reconcile, never blindly retry. Do not invent a user answer or treat an unanswered question as authorization.",
    promptGuidelines: [
      "Prefer decisions to a blocking ask-user dialog. When user input is needed, create a focused question with context and possible solutions, then continue only independent work. Read current decisions with list/get; do not repeatedly poll or assume an answer.",
      "When the user answers in chat instead of the inbox, record their explicit response yourself with decisions answer, or use dismiss when they explicitly dismiss the question or make it obsolete. Read the full question and current revision with get first; preserve the user's meaning and scope. Clarify ambiguous replies; never supply your own answer, infer approval from silence, dismiss an unresolved question for convenience, or overwrite a newer response without reconciling it with the user. Dismissal is not approval.",
    ],
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    parameters: Type.Object({
      action: Type.Union([Type.Literal("ask"), Type.Literal("list"), Type.Literal("get"), Type.Literal("answer"), Type.Literal("dismiss")]),
      question: Type.Optional(Type.String({ maxLength: 2000, description: "Focused question (ask)" })),
      context: Type.Optional(Type.String({ maxLength: 12000, description: "Background, constraints and tradeoffs; Markdown supported" })),
      options: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { maxItems: 9, description: "Potential answers/solutions" })),
      recommendation: Type.Optional(Type.String({ maxLength: 4000, description: "Recommended solution and rationale" })),
      id: Type.Optional(Type.String({ description: "Q number (get/answer/dismiss)" })),
      revision: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER - 1, description: "Current revision from list/get, required for answer/dismiss; stale writes fail" })),
      answer: Type.Optional(Type.String({ minLength: 1, maxLength: DECISION_LIMITS.answer, description: "The user's explicit chat answer (answer only); preserve their meaning and scope" })),
      status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("answered"), Type.Literal("dismissed"), Type.Literal("all")])),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_PAGE_SIZE })),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Question operation cancelled");
      if (!refreshSettings(ctx, false)) throw new Error("Decisions is disabled; the user can enable it with /decisions on or inspect /decisions status");
      const b = active(ctx);
      if (params.action === "ask") {
        if (params.question === undefined) throw new Error("question is required for ask");
        const q = storeFor(b).ask(b.project, {
          question: params.question, context: params.context ?? "", options: params.options ?? [],
          recommendation: params.recommendation ?? "", sessionId: b.sessionId, toolCallId,
        });
        refresh(b);
        return { content: [{ type: "text", text: `${q.id} created (${q.status}). The user can answer via /decisions or chat; record explicit chat responses with answer/dismiss. Continue independent work; this is not an answer or approval.` }], details: q };
      }
      if (params.action === "get") {
        if (params.id === undefined) throw new Error("id is required for get");
        const decision = storeFor(b).get(b.project, questionId(params.id));
        const q = { ...decision, isCurrentSession: decision.sessionId === b.sessionId };
        return { content: [{ type: "text", text: JSON.stringify(q, null, 2) }], details: q };
      }
      if (params.action === "answer" || params.action === "dismiss") {
        if (params.id === undefined) throw new Error(`id is required for ${params.action}`);
        if (params.revision === undefined) throw new Error(`revision is required for ${params.action}; read the current question with get first`);
        if (params.action === "answer" && params.answer === undefined) throw new Error("answer is required for answer");
        if (params.action === "dismiss" && params.answer !== undefined) throw new Error("answer is only allowed for answer; dismissal records no answer");
        const decision = storeFor(b).resolve(b.project, questionId(params.id), params.revision,
          params.action === "answer" ? "answered" : "dismissed", params.answer === undefined ? null : params.answer);
        refresh(b);
        const q = { ...decision, isCurrentSession: decision.sessionId === b.sessionId };
        return { content: [{ type: "text", text: JSON.stringify(q, null, 2) }], details: q };
      }
      const status = params.status ?? "pending";
      const offset = params.offset ?? 0;
      const limit = params.limit ?? PAGE_SIZE;
      const all = storeFor(b).list(b.project).filter((q) => status === "all" || q.status === status);
      const questions = all.slice(offset, offset + limit).map((q) => ({
        id: q.id, question: q.question, status: q.status, revision: q.revision,
        sessionId: q.sessionId, isCurrentSession: q.sessionId === b.sessionId,
      }));
      const result = { project: b.project, total: all.length, questions, nextOffset: offset + questions.length < all.length ? offset + questions.length : null };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
    },
    renderCall(args, theme) { return new Text(theme.fg("toolTitle", theme.bold("decisions ")) + plain(String(args.action ?? "")), 0, 0); },
    renderResult(result, _options, _theme) {
      return new Text(plain(result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")), 0, 0);
    },
  });

  pi.registerTool({ ...tool, exposure: "hidden" });

  pi.registerMessageRenderer(NOTICE_TYPE, (message) => new Text(plain(String(message.content)), 0, 0));
  pi.registerMessageRenderer(CONTEXT_TYPE, (message, options, theme) => {
    if (options.expanded || typeof message.content !== "string") return undefined;
    const line = contextLine(summarizeContext(message.content));
    const box = new Box(options.outputPad, 0, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(theme.fg("warning", line.lead) + theme.fg("muted", plain(line.detail)), 0, 0));
    return box;
  });
  pi.registerCommand("decisions", {
    description: "Decision inbox: [Qn] | answer Qn <text> | dismiss Qn | reopen Qn; automation: on|off|inherit|default on|default off|status",
    getArgumentCompletions: (prefix) => {
      const toggles = TOGGLE_ARGUMENTS.filter((value) => value.startsWith(prefix.toLowerCase())).map((value) => ({ value, label: value }));
      try {
        const questions = binding === null ? [] : storeFor(binding).list(binding.project);
        return [...toggles, ...(completeDecisionArguments(prefix, questions, plain) ?? [])];
      } catch (error) {
        if (binding !== null) report(binding, error);
        return toggles;
      }
    },
    handler: async (args, ctx) => {
      try {
        const text = args.trim();
        const control = text === "" ? null : parseToggleCommand(text);
        if (control !== null) {
          if (control.kind === "session") pi.appendEntry(SESSION_SETTING_TYPE, sessionEnabledData(ctx.sessionManager.getSessionId(), control.enabled));
          if (control.kind === "default") deps.preferences.write({ enabled: control.enabled });
          const enabled = refreshSettings(ctx, control.kind !== "status");
          if (binding !== null) refresh(binding);
          const source = settings.kind === "fault" ? `settings error: ${settings.message}` : settings.override === null
            ? "inherited global default" : `session override; global default ${settings.defaultEnabled ? "ON" : "OFF"}`;
          ctx.ui.notify(`Decisions: ${settings.kind === "fault" ? "ERROR" : enabled ? "ON" : "OFF"} (${source})\nGlobal defaults: ${deps.preferences.path}\nManual inbox remains available; stored questions are preserved.`, "info");
          return;
        }
        const b = active(ctx);
        const mutation = /^(answer|dismiss|reopen)\s+(q[1-9]\d*)(?:\s+([\s\S]+))?$/i.exec(text);
        if (mutation) {
          const action = mutation[1].toLowerCase();
          const q = storeFor(b).get(b.project, questionId(mutation[2]));
          if (action !== "answer" && mutation[3] !== undefined) throw new Error("dismiss/reopen take only a question ID");
          const saved = storeFor(b).resolve(b.project, q.id, q.revision,
            action === "answer" ? "answered" : action === "dismiss" ? "dismissed" : "pending",
            action === "answer" ? mutation[3] ?? "" : null);
          ctx.ui.notify(`${saved.id} ${saved.status}`, "info");
          refresh(b);
          return;
        }
        if (text !== "" && !/^q[1-9]\d*$/i.test(text)) throw new Error("Usage: /decisions [Qn] | answer Qn <text> | dismiss Qn | reopen Qn | on|off|inherit|default on|default off|status");
        const id = text === "" ? null : questionId(text);
        if (id !== null) storeFor(b).get(b.project, id);
        if (ctx.mode === "tui") await openPane(b, id);
        else ctx.ui.notify(plain(id === null ? storeFor(b).list(b.project).map((q) => summary(q, b.sessionId)).join("\n") || "No project questions" : JSON.stringify(storeFor(b).get(b.project, id), null, 2)), "info");
      } catch (error) {
        ctx.ui.notify(`Decisions: ${plain(error instanceof Error ? error.message : String(error))}`, "error");
      }
    },
  });
  pi.registerShortcut(INBOX_SHORTCUT.key, { description: "Open decisions inbox", handler: async (ctx) => { await openPane(active(ctx), null); } });
}

export default function decisionsExtension(pi: ExtensionAPI): void {
  registerDecisions(pi, {
    databasePath: join(getAgentDir(), "decisions", "questions.sqlite"),
    preferences: new FileTogglePreferenceStore(join(getAgentDir(), PREFERENCE_FILENAME), true),
    openStore: (path) => new SqliteDecisionStore(path), projectFor: resolveProject,
    watch: (refresh) => {
      const timer = setInterval(refresh, POLL_MS);
      timer.unref();
      return () => clearInterval(timer);
    },
  });
}
