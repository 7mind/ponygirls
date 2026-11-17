/**
 * ponygirls-bg-tasks: background shell tasks for Pi — the `bg_task` tool,
 * the `/bg` output inspector, and completion notices.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { BORDER_ORDER, compactChip, CustomViewToggle } from "@ponygirls/pi-ui";
import { Value } from "typebox/value";
import { Activation, readRuntimeConfig } from "./src/activation.ts";
import { NoticeDispatcher, SessionFileReceipts, connectBackend, systemTimers, type ReceiptSource } from "./src/delivery.ts";
import { BgTaskError, COMPLETION_CUSTOM_TYPE, CompletionDetailsSchema, MAX_LIST_ITEMS, SIGNAL_NAMES, STATUS_CUSTOM_TYPE, type SessionId, type SignalName, type TaskRecord } from "./src/protocol.ts";
import { BG_STATUS_KEY, bgStatusLine, countRunning } from "./src/status.ts";
import type { TaskBackend } from "./src/backend.ts";
import { createBgTaskTool, taskLine } from "./src/tool.ts";
import { OneLine, RECOVERED_TEXT, bgTaskRenderers, completionLine, isNoSessionNotice, statusLine, unavailableText, type StatusNoticeKind } from "./src/transcript.ts";
import { BgInspector, NO_TASKS_TEXT, renderCompletion } from "./src/ui.ts";

/** What the session has been told about its status backend. */
export interface StatusEpisode {
  /** Last status-backend error, or null when reachable (outage episode state). */
  statusError: string | null;
  /** An `unavailable` notice of the current episode started a turn, so its `recovered` notice does too. */
  statusTurn: boolean;
  /** The notice that this session has no file was shown; it is not repeated. */
  noSessionShown: boolean;
}

/** A failed status refresh. */
export interface StatusFailure {
  error: string;
  /** NO_PERSISTENT_SESSION: a property of the session, not an outage. */
  noSession: boolean;
  /** The last successful refresh saw an unfinished task: the model may be waiting for it. */
  taskRunning: boolean;
}

/** A status notice for the transcript, and whether the model is given a turn to act on it. */
export interface StatusNotice {
  status: StatusNoticeKind;
  text: string;
  triggerTurn: boolean;
}

interface Bound extends StatusEpisode {
  activation: Activation;
  dispatcher: NoticeDispatcher;
  ctx: ExtensionContext;
  view: CustomViewToggle;
  statusTimer: ReturnType<typeof setTimeout> | null;
  /** Retained records from the last status refresh, by id, for transcript lines. */
  tasks: ReadonlyMap<string, TaskRecord>;
  /** Show a status notice in the chat; it is in the model's context from the next turn on. */
  submitNotice: (notice: StatusNotice) => void;
}

/** Throttle for border badge refreshes on rapid task changes. */
const STATUS_THROTTLE_MS = 250;

/** Newest-first walk over retained tasks, counting unfinished ones for the badge. */
async function readStatusTasks(backend: TaskBackend): Promise<TaskRecord[]> {
  const seen: TaskRecord[] = [];
  let page = await backend.list(null, null, MAX_LIST_ITEMS);
  seen.push(...page.items);
  while (page.next !== null) {
    page = await backend.list(page.upper, page.next, MAX_LIST_ITEMS);
    seen.push(...page.items);
  }
  return seen;
}

/** Glyph of the short border form. */
const BADGE_GLYPH = "🛠️";

/** Publish (or clear) the bottom-left badge; a click opens the /bg inspector. */
function publishBadge(entry: Bound, tasks: readonly TaskRecord[]): void {
  const ui = entry.ctx.ui;
  const line = bgStatusLine(tasks);
  if (line === null) {
    ui.setWidget(BG_STATUS_KEY, undefined);
    return;
  }
  const label = ui.theme.bg("selectedBg", ` ${line} `);
  const running = countRunning(tasks);
  ui.setWidget(
    BG_STATUS_KEY,
    () => ({
      render: () => [label],
      renderCompact: () => compactChip(ui.theme, BADGE_GLYPH, "running", String(running)),
      invalidate: () => {},
      handleMouse: (event) => {
        if (event.type !== "click" || event.button !== "left") return undefined;
        void openBgInspector(entry.ctx, entry, "toggle").catch((error: unknown) => report(entry.ctx, errorText(error), "error"));
        return { handled: true };
      },
    }),
    { placement: "borderBottomLeft", order: BORDER_ORDER.tasks },
  );
}

/**
 * Advance a status-backend outage episode after a refresh (`failure` null:
 * it succeeded). Returns the notice to submit when an episode boundary is
 * crossed (first failure, recovery), or null when the state did not change.
 * A notice starts a turn only while a task is known to be running, and a
 * recovery only if a notice of its outage did. A session without a file is
 * told so once, outside any episode. Exported for unit tests.
 */
export function advanceStatusEpisode(episode: StatusEpisode, failure: StatusFailure | null): StatusNotice | null {
  if (failure === null) {
    if (episode.statusError === null) return null;
    const triggerTurn = episode.statusTurn;
    episode.statusError = null;
    episode.statusTurn = false;
    return { status: "recovered", text: RECOVERED_TEXT, triggerTurn };
  }
  if (failure.noSession) {
    if (episode.noSessionShown) return null;
    episode.noSessionShown = true;
    return { status: "unavailable", text: unavailableText(failure.error), triggerTurn: false };
  }
  if (episode.statusError === failure.error) return null;
  episode.statusError = failure.error;
  episode.statusTurn ||= failure.taskRunning;
  return { status: "unavailable", text: unavailableText(failure.error), triggerTurn: failure.taskRunning };
}

async function refreshStatus(entry: Bound, isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) return;
  let tasks: TaskRecord[];
  try {
    const backend = await entry.activation.backend();
    if (!isCurrent()) return;
    tasks = await readStatusTasks(backend);
  } catch (error) {
    // The backend is unreachable (no persistent session, missing executables,
    // disposed activation, lost supervisor): keep the last known badge — the
    // error is reported once per episode instead, since a clear here could
    // never be repaired by a later refresh until something else changes.
    if (!isCurrent()) return;
    try {
      const notice = advanceStatusEpisode(entry, {
        error: errorText(error),
        noSession: error instanceof BgTaskError && error.code === "NO_PERSISTENT_SESSION",
        taskRunning: countRunning([...entry.tasks.values()]) > 0,
      });
      if (notice) entry.submitNotice(notice);
    } catch {
      // Stale UI after session replacement/reload: nothing to do.
    }
    return;
  }
  if (!isCurrent()) return;
  const notice = advanceStatusEpisode(entry, null);
  if (notice && isCurrent()) entry.submitNotice(notice);
  entry.tasks = new Map(tasks.map((task) => [task.id, task]));
  try {
    publishBadge(entry, tasks);
  } catch {
    // Badge rendering failed (e.g. the theme is not initialized in a headless
    // runtime): not a backend outage, so outside the episode above — a later
    // refresh retries.
  }
}

function scheduleStatus(entry: Bound, isCurrent: () => boolean): void {
  if (entry.statusTimer) return;
  entry.statusTimer = setTimeout(() => {
    entry.statusTimer = null;
    void refreshStatus(entry, isCurrent);
  }, STATUS_THROTTLE_MS);
}

const NO_RECEIPTS: ReceiptSource = { scan: () => ({ present: new Set(), answered: new Set() }) };

/** Open the /bg inspector in the TUI (or dump a first page for RPC/print clients). */
const openBgInspector = async (ctx: ExtensionContext, b: Bound, action: "open" | "toggle"): Promise<void> => {
  if (b.view.isDisposed) return;
  if (ctx.mode !== "tui") {
    // RPC/print clients get a plain first page; the terminal viewer needs the TUI.
    const backend = await b.activation.backend();
    const page = await backend.list(null, null, MAX_LIST_ITEMS);
    const lines = page.items.map((t) => taskLine(t, b.dispatcher.localState(t), Date.now()));
    ctx.ui.notify(lines.length ? lines.join("\n") : NO_TASKS_TEXT, "info");
    return;
  }
  await b.view[action](ctx.ui, (tui, theme, _kb, done) => {
    return new BgInspector({
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
      close: done,
      theme,
      now: () => Date.now(),
    });
  });
};

export default function bgTasks(pi: ExtensionAPI): void {
  const config = readRuntimeConfig(process.env);
  let bound: Bound | null = null;

  const current = (): Bound => {
    if (!bound || bound.activation.isDisposed) throw new BgTaskError("ACTIVATION_DISPOSED", "no active session owns background tasks");
    return bound;
  };

  pi.registerTool({
    ...createBgTaskTool({
      backend: () => current().activation.backend(),
      sessionId: () => current().activation.sessionId,
      noticeState: (task) => bound?.dispatcher.localState(task) ?? null,
      noticeForgotten: (task) => bound?.dispatcher.forget(task),
    }),
    ...bgTaskRenderers,
  });

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
        unconfirmed: (taskIds, detail, retryInMs) => report(ctx, `DELIVERY_UNCONFIRMED: completion notice for ${taskIds.join(", ")} could not be confirmed (${detail}); it stays pending and is re-sent automatically in ${seconds(retryInMs)}.`, "warning"),
        error: (error, retryInMs) => report(ctx, `${errorText(error)}; notice delivery retries in ${seconds(retryInMs)}`, "error"),
      },
      host: {
        isCurrent: () => bound === self.value && !activation.isDisposed && ctx.sessionManager.getSessionId() === sessionId,
        isIdle: () => ctx.isIdle(),
      },
      timers: systemTimers,
    });
    activation.onRestartFailed((error, retryInMs) => report(ctx, `${errorText(error)}; restarting the task supervisor again in ${seconds(retryInMs)}`, "error"));
    activation.onBackend((backend) => {
      connectBackend(dispatcher, backend);
      backend.onChanged(() => {
        if (self.value) scheduleStatus(self.value, () => bound === self.value);
      });
      if (self.value) scheduleStatus(self.value, () => bound === self.value);
    });
    // After a reload, a session without a file finds its notice in its own transcript.
    const noSessionShown = !sessionFile && ctx.sessionManager.getEntries().some((entry) =>
      entry.type === "custom_message" && entry.customType === STATUS_CUSTOM_TYPE && isNoSessionNotice(messageText(entry.content)));
    self.value = {
      activation, dispatcher, ctx, view: new CustomViewToggle(), statusTimer: null, statusError: null, statusTurn: false, noSessionShown, tasks: new Map(),
      // Without a turn pi appends the notice to the transcript: at once when idle, after the current turn otherwise.
      submitNotice: (notice) =>
        pi.sendMessage(
          { customType: STATUS_CUSTOM_TYPE, content: notice.text, display: true, details: { status: notice.status } },
          { deliverAs: "followUp", triggerTurn: notice.triggerTurn },
        ),
    };
    bound = self.value;
    // Recover earlier activations' records and replay their notices without waiting for a tool call.
    if (activation.hasExistingState()) activation.backend().catch((error: unknown) => {
      if (bound === self.value && !activation.isDisposed) report(ctx, errorText(error), "error");
    });
    else scheduleStatus(self.value, () => bound === self.value);
  });

  pi.on("session_shutdown", async (event) => {
    const ending = bound;
    bound = null;
    if (!ending) return;
    ending.dispatcher.dispose();
    if (ending.statusTimer) clearTimeout(ending.statusTimer);
    ending.statusTimer = null;
    try {
      publishBadge(ending, []);
    } catch {
      // Stale UI after replacement/reload: nothing to do.
    }
    ending.view.dispose();
    await ending.activation.shutdown(event.reason);
  });

  pi.registerMessageRenderer(COMPLETION_CUSTOM_TYPE, (message, options, theme) => {
    const text = messageText(message.content);
    const details = Value.Check(CompletionDetailsSchema, message.details) ? message.details : undefined;
    if (options.expanded || !details) return new Text(renderCompletion(details, text, theme).join("\n"), 1, 0);
    return new OneLine(() => completionLine(details, (id) => bound?.tasks.get(id), Date.now(), theme), 1);
  });
  // Collapsed only: expanded, pi's default rendering of the notice stays as it was.
  pi.registerMessageRenderer(STATUS_CUSTOM_TYPE, (message, options, theme) => {
    const status = statusKind(message.details);
    if (options.expanded || status === null) return undefined;
    const text = messageText(message.content);
    return new OneLine((width) => statusLine(status, text, theme, width), 1);
  });

  pi.registerCommand("bg", {
    description: "Background tasks: output, terminate, signal",
    handler: (_args, ctx) => openBgInspector(ctx, current(), "open"),
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
  pi.on("agent_settled", () => {
    const entry = bound;
    entry?.dispatcher.settled();
    if (entry) scheduleStatus(entry, () => bound === entry);
  });
  pi.on("turn_end", () => {
    const entry = bound;
    if (entry) scheduleStatus(entry, () => bound === entry);
  });
  pi.on("input", (event) => {
    if (event.source !== "extension") bound?.dispatcher.input(event.streamingBehavior !== undefined);
  });
  pi.on("session_before_compact", () => { bound?.dispatcher.compactionStarted(); });
  pi.on("session_compact", () => bound?.dispatcher.compactionEnded());
  pi.on("session_compact_failed", () => bound?.dispatcher.compactionEnded());
}

function messageText(content: string | ReadonlyArray<{ type: string; text?: string }>): string {
  return typeof content === "string" ? content : content.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("");
}

const STATUS_KINDS: readonly StatusNoticeKind[] = ["unavailable", "recovered"];

function statusKind(details: unknown): StatusNoticeKind | null {
  if (typeof details !== "object" || details === null || !("status" in details)) return null;
  return STATUS_KINDS.find((kind) => kind === details.status) ?? null;
}

function seconds(ms: number): string {
  return `${Math.ceil(ms / 1000)} s`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function report(ctx: ExtensionContext, message: string, level: "warning" | "error"): void {
  if (ctx.hasUI) ctx.ui.notify(`bg-tasks: ${message}`, level);
  else console.error(`bg-tasks: ${message}`);
}
