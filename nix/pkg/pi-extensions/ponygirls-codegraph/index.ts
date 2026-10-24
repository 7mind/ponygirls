import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CodegraphSession, localBoundary } from "./runtime.ts";
import type { Action, State } from "./runtime.ts";

const WIDGET = "ponygirls-codegraph";

export default function codegraphExtension(pi: ExtensionAPI): void {
  let session: CodegraphSession | undefined;
  const toolCalls = new Set<string>();
  let currentContext: ExtensionContext | undefined;

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
  const create = (ctx: ExtensionContext): CodegraphSession => {
    currentContext = ctx;
    const runtime = new CodegraphSession(localBoundary(
      process.env.PONYGIRLS_CODEGRAPH_BIN ?? "codegraph",
      process.env.PONYGIRLS_CODEGRAPH_FLOCK_BIN ?? "flock", process.env), ctx.cwd, (state) => {
      if (session !== runtime) return;
      render(state);
      if (state.phase === "error") {
        const message = `Codegraph: ${state.detail.slice(-4000)}`;
        if (ctx.hasUI) ctx.ui.notify(message, "error");
        else console.error(message);
      }
    });
    session = runtime;
    return runtime;
  };
  pi.on("session_start", (_event, ctx) => {
    toolCalls.clear();
    const runtime = create(ctx);
    if (process.env.SMIND_CODEGRAPH_DISABLED === "1") {
      runtime.skip("automatic setup disabled");
      return;
    }
    void runtime.start("sync");
  });
  pi.on("session_shutdown", async () => {
    const previous = session;
    session = undefined;
    const ctx = currentContext;
    currentContext = undefined;
    toolCalls.clear();
    if (ctx !== undefined && ctx.mode === "tui") ctx.ui.setWidget(WIDGET, undefined);
    if (previous !== undefined) await previous.shutdown();
  });
  pi.on("tool_call", async (event, ctx) => {
    if (!event.toolName.startsWith("mcp__codegraph__") || session === undefined) return;
    const runtime = session;
    await runtime.wait();
    if (session !== runtime) return { block: true, reason: "Codegraph session was replaced" };
    if (runtime.state.phase === "error" || runtime.state.phase === "cancelled") {
      return { block: true, reason: `Local Codegraph index unavailable; run /cg-sync or /cg-reindex. ${runtime.state.detail.slice(-4000)}` };
    }
    if (runtime.state.phase === "ready" && event.toolName === "mcp__codegraph__codegraph_explore") {
      const input = event.input as { projectPath?: string };
      if (input.projectPath === undefined) input.projectPath = ctx.cwd;
    }
  });
  pi.on("tool_execution_start", (event) => {
    if (!event.toolName.startsWith("mcp__codegraph__")) return;
    toolCalls.add(event.toolCallId);
    if (session !== undefined) render(session.state);
  });
  pi.on("tool_execution_end", (event) => {
    if (!event.toolName.startsWith("mcp__codegraph__")) return;
    toolCalls.delete(event.toolCallId);
    if (session !== undefined) render(session.state);
  });
  for (const [name, action, description] of [
    ["cg-status", "status", "Check the local Codegraph index health and show bounded diagnostics"],
    ["cg-sync", "sync", "Prepare or sync the local Git checkout's Codegraph index"],
    ["cg-reindex", "reindex", "Rebuild the local Git checkout's Codegraph index"],
  ] as const satisfies readonly (readonly [string, Action, string])[]) {
    pi.registerCommand(name, {
      description,
      handler: async (_args, ctx) => {
        const runtime = session ?? create(ctx);
        if (runtime.state.phase === "working") {
          if (ctx.hasUI) ctx.ui.notify(`Codegraph busy: ${runtime.state.detail}; /cg-cancel to stop`, "info");
          return;
        }
        const work = runtime.start(action);
        if (action === "status") {
          await work;
          if (session === runtime && ctx.hasUI) ctx.ui.notify(
            `Codegraph ${runtime.state.phase}: ${runtime.state.detail.slice(-4000)}`,
            runtime.state.phase === "error" ? "error" : "info");
        }
      },
    });
  }
  pi.registerCommand("cg-cancel", {
    description: "Cancel extension-owned Codegraph work (not the independently managed MCP watcher)",
    handler: async (_args, ctx) => {
      if (session !== undefined) await session.cancel();
      if (ctx.hasUI) ctx.ui.notify("Codegraph extension work stopped; MCP watcher unchanged", "info");
    },
  });
}
