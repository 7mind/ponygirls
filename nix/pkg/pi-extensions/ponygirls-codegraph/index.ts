import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BORDER_ORDER, CustomViewToggle, ScopedSettingsView, borderBadge, borderBadgeCompact, type CustomViewFactory, type UiTheme } from "@ponygirls/pi-ui";
import type { ScopedToggleSnapshot } from "@ponygirls/pi-settings";
import { localBoundary } from "./runtime.ts";
import type { State } from "./runtime.ts";
import { localCatalog } from "./projects.ts";
import { CodegraphWorkspace, reportText, type StatusSnapshot } from "./workspace.ts";
import { CG_HELP, completeCommand, parseCommand, type DirectoryLister } from "./commands.ts";
import type { CgCommand, WorkspaceCommand } from "./commands.ts";
import { CodegraphStatusPane, codegraphBadge, stateNotice, type StatusPaneOptions } from "./presentation.ts";
import { codegraphSettings, codegraphSettingsController, policyText, SETTINGS_TITLE } from "./settings.ts";

const WIDGET = "ponygirls-codegraph";
/**
 * ponygirls-subagents delegated-call contract (its src/delegated-call.ts;
 * duplicated because the extensions are packaged separately). Subagent calls
 * of the session's MCP tools skip `tool_call`, so they are prepared here.
 */
const DELEGATED_CALL_CHANNEL = "ponygirls-subagents:prepare-delegated-call";
interface DelegatedCallEvent {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly cwd: string;
  waitUntil(work: Promise<void>): void;
}
const NOTICE_LIMIT = 16_384;
const AUTOMATIC_OFF = "Pi's automatic Codegraph preparation/routing is off. The separate MCP server receives calls without Pi verifying or adding a projectPath.";
/** What a `/cg` command has to show: a line of text, or the status of the scopes it named. */
type CommandOutcome = { text: string } | { status: StatusSnapshot };

/** The status pane over one snapshot; it shows that snapshot until it closes. */
function statusPane(status: StatusSnapshot): CustomViewFactory<UiTheme, StatusPaneOptions["keys"]> {
  return (tui, theme, keys, done) => new CodegraphStatusPane({
    status, home: homedir(), theme, keys, now: () => Date.now(),
    rows: () => tui.terminal.rows, requestRender: () => tui.requestRender(), close: done,
  });
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export default function codegraphExtension(pi: ExtensionAPI): void {
  const configuration = codegraphSettings(pi);
  let statusView = new CustomViewToggle();
  let settingsView = new ScopedSettingsView();
  let showingSettings: ScopedSettingsView | undefined;
  let launchDisabled = false;
  let settingsError: string | null = null;
  let workspace: CodegraphWorkspace | undefined;
  const toolCalls = new Set<string>();
  let currentContext: ExtensionContext | undefined;
  let lastNotice: string | null = null;

  const notify = (ctx: ExtensionContext, text: string, error: boolean) => {
    const bounded = text.length > NOTICE_LIMIT ? `${text.slice(0, NOTICE_LIMIT)}\n…truncated; target /cg status PATH for details` : text;
    if (ctx.hasUI) ctx.ui.notify(bounded, error ? "error" : "info");
    else console.error(bounded);
  };
  const render = (state: State) => {
    const ctx = currentContext;
    const runtime = workspace;
    if (ctx === undefined || ctx.mode !== "tui" || runtime === undefined) return;
    const phase = runtime.routingSignal === null && state.phase !== "working" ? "skipped" : state.phase;
    const badge = codegraphBadge(phase, toolCalls.size);
    ctx.ui.setWidget(WIDGET, (_tui, theme) => ({
      render: (width) => [borderBadge(theme, badge, width)],
      renderCompact: (width) => borderBadgeCompact(theme, badge, width),
      invalidate: () => {},
      handleMouse: (event) => {
        if (event.type !== "click" || event.button !== "left" || workspace !== runtime || !ctx.hasUI || showingSettings === settingsView) return undefined;
        void statusView.toggle(ctx.ui, async (tui, theme, keys, done) => statusPane(await runtime.snapshot(null))(tui, theme, keys, done))
          .catch((error: unknown) => { if (workspace === runtime) notify(ctx, String(error), true); });
        return { handled: true };
      },
    }), { placement: "borderBottomLeft", order: BORDER_ORDER.codegraph });
  };
  const create = (ctx: ExtensionContext): CodegraphWorkspace => {
    currentContext = ctx;
    lastNotice = null;
    const runtime = new CodegraphWorkspace(localCatalog(process.env), localBoundary(
      process.env.PONYGIRLS_CODEGRAPH_BIN ?? "codegraph",
      process.env.PONYGIRLS_CODEGRAPH_FLOCK_BIN ?? "flock", process.env), ctx.cwd, (state) => {
      if (workspace !== runtime) return;
      render(state);
      const notice = stateNotice(state);
      if (notice === null) lastNotice = null;
      else if (lastNotice !== `${state.phase}:${state.detail}`) {
        lastNotice = `${state.phase}:${state.detail}`;
        notify(ctx, notice.text, notice.level === "error");
      }
    }, () => new Date().toISOString());
    workspace = runtime;
    return runtime;
  };
  const refreshPolicy = (ctx: ExtensionContext): ScopedToggleSnapshot | null => {
    const runtime = workspace;
    if (runtime === undefined) return null;
    let snapshot: ScopedToggleSnapshot | null = null;
    try {
      snapshot = configuration.read(ctx);
      settingsError = null;
    } catch (error) {
      const detail = String(error);
      if (settingsError !== detail) notify(ctx, `Codegraph automatic preparation/routing is off: ${detail}`, true);
      settingsError = detail;
    }
    void runtime.start(snapshot !== null && snapshot.values.enabled && !launchDisabled).catch((error: unknown) => {
      if (workspace === runtime) notify(ctx, String(error), true);
    });
    return snapshot;
  };
  const resetSettingsView = () => {
    settingsView.dispose();
    settingsView = new ScopedSettingsView();
  };
  pi.on("session_start", (_event, ctx) => {
    statusView.dispose();
    statusView = new CustomViewToggle();
    resetSettingsView();
    settingsError = null;
    launchDisabled = process.env.SMIND_CODEGRAPH_DISABLED === "1";
    toolCalls.clear();
    create(ctx);
    refreshPolicy(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    resetSettingsView();
    refreshPolicy(ctx);
  });
  pi.on("session_shutdown", async () => {
    settingsView.dispose();
    statusView.dispose();
    const previous = workspace;
    workspace = undefined;
    const ctx = currentContext;
    currentContext = undefined;
    toolCalls.clear();
    if (ctx !== undefined && ctx.mode === "tui") ctx.ui.setWidget(WIDGET, undefined);
    if (previous !== undefined) await previous.shutdown();
  });
  pi.on("before_agent_start", async (_event, ctx) => {
    const runtime = workspace;
    if (runtime === undefined) return;
    refreshPolicy(ctx);
    const routing = runtime.routingSignal;
    const content = routing === null ? AUTOMATIC_OFF : await runtime.inventory();
    if (workspace !== runtime || (routing !== null && routing.aborted)) return;
    return { message: { customType: "codegraph-projects", content, display: false } };
  });
  pi.on("tool_call", async (event) => {
    const runtime = workspace;
    if (!event.toolName.startsWith("mcp__codegraph__") || runtime === undefined) return;
    const routing = runtime.routingSignal;
    if (routing === null) return;
    const input = event.input as { projectPath?: string };
    try {
      const root = await runtime.query(input.projectPath);
      if (routing.aborted) return { block: true, reason: "Codegraph routing was cancelled" };
      input.projectPath = root;
    } catch (error) {
      return { block: true, reason: String(error) };
    }
  });
  // A subagent's omitted projectPath means its own working directory (its
  // worktree) unless it works in the session's cwd, where the session
  // default applies; relative paths resolve against the subagent's cwd.
  pi.events.on(DELEGATED_CALL_CHANNEL, (data) => {
    const event = data as DelegatedCallEvent;
    const runtime = workspace;
    if (!event.toolName.startsWith("mcp__codegraph__") || runtime === undefined) return;
    const routing = runtime.routingSignal;
    if (routing === null) return;
    const sessionCwd = currentContext === undefined ? null : resolve(currentContext.cwd);
    event.waitUntil((async () => {
      const requested = event.input.projectPath;
      if (requested !== undefined && typeof requested !== "string") throw new Error("projectPath must be a string");
      const target = requested !== undefined ? resolve(event.cwd, requested)
        : resolve(event.cwd) === sessionCwd ? undefined : event.cwd;
      const root = await runtime.query(target);
      if (routing.aborted) throw new Error("Codegraph routing was cancelled");
      event.input.projectPath = root;
    })());
  });
  pi.on("tool_execution_start", (event) => {
    if (!event.toolName.startsWith("mcp__codegraph__")) return;
    toolCalls.add(event.toolCallId);
    if (workspace !== undefined) render(workspace.state);
  });
  pi.on("tool_execution_end", (event) => {
    if (!event.toolName.startsWith("mcp__codegraph__")) return;
    toolCalls.delete(event.toolCallId);
    if (workspace !== undefined) render(workspace.state);
  });

  const execute = async (command: WorkspaceCommand, runtime: CodegraphWorkspace): Promise<CommandOutcome> => {
    switch (command.name) {
      case "discover": await runtime.discover(command.target); return { text: await runtime.report(null) };
      case "use": await runtime.use(command.target); return { text: await runtime.report(command.target) };
      case "init": await runtime.initWorkspace(command.target); return { text: await runtime.report(command.target) };
      case "erase": return runtime.erase(command.target);
      case "cancel":
        await runtime.cancel(command.target, command.all);
        return { text: "Codegraph extension work stopped; MCP watcher unchanged" };
      case "status":
        await runtime.perform(command.name, command.target, command.all);
        return { status: await runtime.snapshot(command.target) };
      default:
        await runtime.perform(command.name, command.target, command.all);
        return { text: await runtime.report(command.target) };
    }
  };
  /** Status is a pane in the TUI; every other client reads the text report. */
  const show = async (outcome: CommandOutcome, ctx: ExtensionContext): Promise<void> => {
    if ("text" in outcome) notify(ctx, outcome.text, false);
    else if (ctx.mode === "tui" && ctx.hasUI) await statusView.open(ctx.ui, statusPane(outcome.status));
    else notify(ctx, reportText(outcome.status), false);
  };
  const showSettings = async (ctx: ExtensionContext) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) {
      const snapshot = refreshPolicy(ctx);
      if (snapshot !== null) notify(ctx, `${policyText(snapshot, launchDisabled)}\nSet with /cg [session|project|global] on|off|inherit.`, false);
      return;
    }
    statusView.dispose();
    statusView = new CustomViewToggle();
    const view = settingsView;
    showingSettings = view;
    try {
      await view.show(ctx, () => codegraphSettingsController(configuration, ctx, launchDisabled, () => refreshPolicy(ctx)), { title: SETTINGS_TITLE });
    } finally {
      if (showingSettings === view) showingSettings = undefined;
    }
  };
  const handle = async (args: string, ctx: ExtensionContext) => {
    const runtime = workspace;
    let command: CgCommand;
    try {
      command = parseCommand(args);
      if (command.name === "help") { notify(ctx, CG_HELP, false); return; }
      if (runtime === undefined) throw new Error("No active Codegraph session");
      if (command.name === "settings") { await showSettings(ctx); return; }
      if (command.name === "toggle") {
        // The operator command is independent of the current model run's abort signal.
        configuration.apply(ctx, command.scope, command.enabled, new AbortController().signal);
        const snapshot = refreshPolicy(ctx);
        if (snapshot !== null) notify(ctx, policyText(snapshot, launchDisabled), false);
        return;
      }
    } catch (error) { notify(ctx, String(error), true); return; }
    const work = execute(command, runtime).then(async (outcome) => {
      if (workspace === runtime) await show(outcome, ctx);
    }).catch((error: unknown) => {
      if (workspace === runtime) notify(ctx, String(error), true);
    });
    if (command.name !== "sync" && command.name !== "reindex" && command.name !== "init") await work;
  };
  /** Paths resolve against Pi's cwd, as the command handler does. Unreadable directories offer nothing. */
  const listDirectories: DirectoryLister = (directory) => {
    if (currentContext === undefined) return null;
    const base = resolve(currentContext.cwd, directory);
    try {
      return readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(join(base, entry.name))))
        .map((entry) => entry.name);
    } catch {
      return null;
    }
  };
  pi.registerCommand("cg", {
    description: "Code index: status, settings, sync, choose project",
    getArgumentCompletions: (prefix) => completeCommand(prefix, listDirectories),
    handler: handle,
  });
}
