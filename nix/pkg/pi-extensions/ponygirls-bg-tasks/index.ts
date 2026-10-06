/**
 * ponygirls-bg-tasks: background shell tasks for Pi — the `bg_task` tool,
 * the `/bg` output inspector, and completion notices.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { Activation, readRuntimeConfig } from "./src/activation.ts";
import { NoticeDispatcher, SessionFileReceipts, connectBackend, systemTimers, type ReceiptSource } from "./src/delivery.ts";
import { BgTaskError, COMPLETION_CUSTOM_TYPE, CompletionDetailsSchema, MAX_LIST_ITEMS, SIGNAL_NAMES, type SessionId, type SignalName } from "./src/protocol.ts";
import { createBgTaskTool, taskLine } from "./src/tool.ts";
import { BgInspector, renderCompletion, type ViewerStyle } from "./src/ui.ts";

interface Bound {
  activation: Activation;
  dispatcher: NoticeDispatcher;
  ctx: ExtensionContext;
  /** Open /bg views; closed when the activation ends. */
  views: Set<{ view: BgInspector; close: () => void }>;
}

function themeStyle(theme: Theme): ViewerStyle {
  return {
    accent: (s) => theme.fg("accent", s),
    dim: (s) => theme.fg("dim", s),
    error: (s) => theme.fg("error", s),
    warning: (s) => theme.fg("warning", s),
    success: (s) => theme.fg("success", s),
    bold: (s) => theme.bold(s),
    selected: (s) => theme.bg("selectedBg", s),
  };
}

const NO_RECEIPTS: ReceiptSource = { present: () => new Set() };

export default function bgTasks(pi: ExtensionAPI): void {
  const config = readRuntimeConfig(process.env);
  let bound: Bound | null = null;

  const current = (): Bound => {
    if (!bound || bound.activation.isDisposed) throw new BgTaskError("ACTIVATION_DISPOSED", "no active session owns background tasks");
    return bound;
  };

  pi.registerTool(createBgTaskTool({
    backend: () => current().activation.backend(),
    sessionId: () => current().activation.sessionId,
    noticeState: (task) => bound?.dispatcher.localState(task) ?? null,
    noticeForgotten: (task) => bound?.dispatcher.forget(task),
  }));

  pi.on("session_start", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId() as SessionId;
    const sessionFile = ctx.sessionManager.getSessionFile();
    const activation = new Activation({ sessionId, sessionFile, config });
    const self: { value: Bound | null } = { value: null };
    const dispatcher = new NoticeDispatcher({
      sessionId,
      receipts: sessionFile ? new SessionFileReceipts(sessionFile, sessionId) : NO_RECEIPTS,
      sink: { submit: (message) => pi.sendMessage(message, { deliverAs: "followUp", triggerTurn: true }) },
      reporter: {
        unconfirmed: (taskIds, detail) => report(ctx, `DELIVERY_UNCONFIRMED: completion notice for ${taskIds.join(", ")} could not be confirmed (${detail}); it stays pending and is retried after your next input or when the session resumes.`, "warning"),
        error: (error) => report(ctx, errorText(error), "error"),
      },
      host: {
        isCurrent: () => bound === self.value && !activation.isDisposed && ctx.sessionManager.getSessionId() === sessionId,
        isIdle: () => ctx.isIdle(),
      },
      timers: systemTimers,
    });
    activation.onBackend((backend) => connectBackend(dispatcher, backend));
    self.value = { activation, dispatcher, ctx, views: new Set() };
    bound = self.value;
    // Recover earlier activations' records and replay their notices without waiting for a tool call.
    if (activation.hasExistingState()) activation.backend().catch((error: unknown) => report(ctx, errorText(error), "error"));
  });

  pi.on("session_shutdown", async (event) => {
    const ending = bound;
    bound = null;
    if (!ending) return;
    ending.dispatcher.dispose();
    for (const { view, close } of ending.views) {
      view.dispose();
      close();
    }
    ending.views.clear();
    await ending.activation.shutdown(event.reason);
  });

  pi.registerMessageRenderer(COMPLETION_CUSTOM_TYPE, (message, _options, theme) => {
    const text = typeof message.content === "string" ? message.content : message.content.map((p) => (p.type === "text" ? p.text : "")).join("");
    const details = Value.Check(CompletionDetailsSchema, message.details) ? message.details : undefined;
    return new Text(renderCompletion(details, text, themeStyle(theme)).join("\n"), 1, 0);
  });

  pi.registerCommand("bg", {
    description: "Inspect background tasks: list, live/retained terminal output, terminate, signal, mute, clear",
    handler: async (_args, ctx) => {
      const b = current();
      if (ctx.mode !== "tui") {
        // RPC/print clients get a plain first page; the terminal viewer needs the TUI.
        const backend = await b.activation.backend();
        const page = await backend.list(null, null, MAX_LIST_ITEMS);
        const lines = page.items.map((t) => taskLine(t, b.dispatcher.localState(t), Date.now()));
        ctx.ui.notify(lines.length ? lines.join("\n") : "No retained background tasks in this session.", "info");
        return;
      }
      await ctx.ui.custom<void>((tui, theme, _kb, done) => {
        const entry = { view: null as unknown as BgInspector, close: () => done() };
        entry.view = new BgInspector({
          backend: () => b.activation.backend(),
          noticeState: (task) => b.dispatcher.localState(task),
          noticeForgotten: (task) => b.dispatcher.forget(task),
          confirm: (title, message) => ctx.ui.confirm(title, message),
          selectSignal: async () => {
            const choice = await ctx.ui.select("Signal to send", [...SIGNAL_NAMES]);
            return SIGNAL_NAMES.find((s) => s === choice) as SignalName | undefined;
          },
          requestRender: () => tui.requestRender(),
          rows: () => tui.terminal.rows,
          close: () => {
            b.views.delete(entry);
            done();
          },
          style: themeStyle(theme),
          now: () => Date.now(),
        });
        b.views.add(entry);
        return entry.view;
      });
    },
  });

  pi.on("agent_start", (_event, ctx) => {
    const b = bound;
    if (!b) return;
    b.dispatcher.agentStart();
    // An abort skips agent_before_settle, and may hit a tool rather than a model response.
    const signal = ctx.signal;
    if (signal?.aborted) b.dispatcher.aborted();
    else signal?.addEventListener("abort", () => b.dispatcher.aborted(), { once: true });
  });
  pi.on("agent_before_settle", (event) => {
    bound?.dispatcher.beforeSettle(event.outcome);
  });
  pi.on("agent_settled", () => bound?.dispatcher.settled());
  pi.on("input", (event) => {
    if (event.source !== "extension") bound?.dispatcher.input(event.streamingBehavior !== undefined);
  });
  pi.on("session_before_compact", () => { bound?.dispatcher.compactionStarted(); });
  pi.on("session_compact", () => bound?.dispatcher.compactionEnded());
  pi.on("session_compact_failed", () => bound?.dispatcher.compactionEnded());
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function report(ctx: ExtensionContext, message: string, level: "warning" | "error"): void {
  if (ctx.hasUI) ctx.ui.notify(`bg-tasks: ${message}`, level);
  else console.error(`bg-tasks: ${message}`);
}
