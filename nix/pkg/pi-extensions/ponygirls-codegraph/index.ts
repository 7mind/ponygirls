import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { localBoundary } from "./runtime.ts";
import type { State } from "./runtime.ts";
import { localCatalog } from "./projects.ts";
import { CodegraphWorkspace } from "./workspace.ts";
import { CG_HELP, completeCommand, parseCommand } from "./commands.ts";
import type { CgCommand } from "./commands.ts";

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

export default function codegraphExtension(pi: ExtensionAPI): void {
  let workspace: CodegraphWorkspace | undefined;
  const toolCalls = new Set<string>();
  let currentContext: ExtensionContext | undefined;
  let lastError: string | null = null;

  const notify = (ctx: ExtensionContext, text: string, error: boolean) => {
    const bounded = text.length > NOTICE_LIMIT ? `${text.slice(0, NOTICE_LIMIT)}\n…truncated; target /cg status PATH for details` : text;
    if (ctx.hasUI) ctx.ui.notify(bounded, error ? "error" : "info");
    else console.error(bounded);
  };
  const render = (state: State) => {
    const ctx = currentContext;
    if (ctx === undefined || ctx.mode !== "tui") return;
    const label = toolCalls.size > 0 ? `querying (${toolCalls.size}) / ${state.phase}` : state.phase;
    const detail = state.phase === "working" ? ` ${state.detail.split(":")[0]}` : "";
    ctx.ui.setWidget(WIDGET, (_tui, theme) => ({
      render: () => [theme.bg("selectedBg", ` CG: ${label}${detail} `)],
      invalidate: () => {},
    }), { placement: "borderBottomLeft" });
  };
  const create = (ctx: ExtensionContext): CodegraphWorkspace => {
    currentContext = ctx;
    lastError = null;
    const runtime = new CodegraphWorkspace(localCatalog(process.env), localBoundary(
      process.env.PONYGIRLS_CODEGRAPH_BIN ?? "codegraph",
      process.env.PONYGIRLS_CODEGRAPH_FLOCK_BIN ?? "flock", process.env), ctx.cwd, (state) => {
      if (workspace !== runtime) return;
      render(state);
      if (state.phase === "error" && lastError !== state.detail) {
        lastError = state.detail;
        notify(ctx, `Codegraph: ${state.detail}`, true);
      } else if (state.phase !== "error") lastError = null;
    }, () => new Date().toISOString());
    workspace = runtime;
    return runtime;
  };
  pi.on("session_start", (_event, ctx) => {
    toolCalls.clear();
    const runtime = create(ctx);
    void runtime.start(process.env.SMIND_CODEGRAPH_DISABLED !== "1");
  });
  pi.on("session_shutdown", async () => {
    const previous = workspace;
    workspace = undefined;
    const ctx = currentContext;
    currentContext = undefined;
    toolCalls.clear();
    if (ctx !== undefined && ctx.mode === "tui") ctx.ui.setWidget(WIDGET, undefined);
    if (previous !== undefined) await previous.shutdown();
  });
  pi.on("before_agent_start", async () => {
    const runtime = workspace;
    if (runtime === undefined) return;
    const content = await runtime.inventory();
    if (workspace !== runtime) return;
    return { message: { customType: "codegraph-projects", content, display: false } };
  });
  pi.on("tool_call", async (event) => {
    if (!event.toolName.startsWith("mcp__codegraph__") || workspace === undefined || !workspace.routingEnabled) return;
    const runtime = workspace;
    const input = event.input as { projectPath?: string };
    try {
      const root = await runtime.query(input.projectPath);
      if (workspace !== runtime) return { block: true, reason: "Codegraph session was replaced" };
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
    if (!event.toolName.startsWith("mcp__codegraph__") || workspace === undefined || !workspace.routingEnabled) return;
    const runtime = workspace;
    const sessionCwd = currentContext === undefined ? null : resolve(currentContext.cwd);
    event.waitUntil((async () => {
      const requested = event.input.projectPath;
      if (requested !== undefined && typeof requested !== "string") throw new Error("projectPath must be a string");
      const target = requested !== undefined ? resolve(event.cwd, requested)
        : resolve(event.cwd) === sessionCwd ? undefined : event.cwd;
      const root = await runtime.query(target);
      if (workspace !== runtime) throw new Error("Codegraph session was replaced");
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

  const execute = async (command: CgCommand, runtime: CodegraphWorkspace): Promise<string> => {
    switch (command.name) {
      case "help": return CG_HELP;
      case "discover": await runtime.discover(command.target); return runtime.report(null);
      case "use": await runtime.use(command.target); return runtime.report(command.target);
      case "init": await runtime.initWorkspace(command.target); return runtime.report(command.target);
      case "erase": return runtime.erase(command.target);
      case "cancel":
        await runtime.cancel(command.target, command.all);
        return "Codegraph extension work stopped; MCP watcher unchanged";
      default:
        await runtime.perform(command.name, command.target, command.all);
        return runtime.report(command.target);
    }
  };
  const handle = async (args: string, ctx: ExtensionContext) => {
    const runtime = workspace ?? create(ctx);
    let command: CgCommand;
    try { command = parseCommand(args); }
    catch (error) { notify(ctx, String(error), true); return; }
    const work = execute(command, runtime).then((text) => {
      if (workspace === runtime) notify(ctx, text, false);
    }).catch((error: unknown) => {
      if (workspace === runtime) notify(ctx, String(error), true);
    });
    if (command.name !== "sync" && command.name !== "reindex" && command.name !== "init") await work;
  };
  pi.registerCommand("cg", {
    description: "Codegraph: status, discover, use, sync, reindex, cancel, init, erase, help",
    getArgumentCompletions: completeCommand,
    handler: handle,
  });
}
