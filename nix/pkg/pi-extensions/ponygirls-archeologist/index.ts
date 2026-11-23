import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ADMISSION_CHANNEL, requestInventory, type Admission, type BridgeRequest } from "../context-rules/bridge.ts";
import { nestedRuleText, type ContextFile } from "../context-rules/rules.ts";
import { MainTurn, nestedFiles, SNAPSHOTS } from "./main.ts";
import { InstructionPreferences } from "./preferences.ts";

export default function archeologist(pi: ExtensionAPI): void {
  const prefs = new InstructionPreferences(getAgentDir());
  let current: ExtensionContext | undefined;
  let id: string | undefined;
  let base: ContextFile[] = [];
  let presented: ContextFile[] = [];
  let turn: MainTurn | undefined;
  let pane: AbortController | undefined;

  function clearTurn() { turn?.abort.abort(); turn = undefined; }
  function reset() { clearTurn(); pane?.abort(); pane = undefined; presented = []; }
  function matches(ctx: ExtensionContext) { return id === ctx.sessionManager.getSessionId() && current?.cwd === ctx.cwd; }

  pi.on("session_start", (_event, ctx) => { reset(); current = ctx; id = ctx.sessionManager.getSessionId(); base = []; });
  pi.on("session_shutdown", () => { reset(); current = undefined; id = undefined; base = []; });
  pi.on("session_compact", reset);
  pi.on("session_tree", reset);
  pi.on("before_agent_start", (event, ctx) => {
    if (!matches(ctx)) return;
    current = ctx;
    clearTurn(); presented = [];
    base = event.systemPromptOptions.contextFiles.map(f => ({ ...f }));
  });
  pi.on("turn_start", (_event, ctx) => {
    clearTurn();
    if (matches(ctx) && prefs.effective(ctx).mainNested) turn = new MainTurn();
  });
  pi.on("tool_execution_start", (event, ctx) => { if (matches(ctx)) turn?.start(event, pi); });
  pi.on("tool_result", (event, ctx) => { if (matches(ctx)) turn?.stage(event, ctx); });
  pi.on("tool_execution_end", (event, ctx) => { if (matches(ctx)) turn?.finish(event); });
  pi.on("turn_end", async (event, ctx) => {
    const batch = turn;
    if (!batch || !matches(ctx) || ctx.signal?.aborted || event.outcome !== "completed" || !prefs.effective(ctx).mainNested) return;
    const leaf = ctx.sessionManager.getLeafId();
    const known = new Set([...base, ...nestedFiles(ctx, base)].map(f => f.path));
    const files = await batch.flush(ctx, known);
    if (files.length && turn === batch && matches(ctx) && ctx.sessionManager.getLeafId() === leaf && !ctx.signal?.aborted && prefs.effective(ctx).mainNested) {
      pi.appendEntry(SNAPSHOTS, { sessionId: id, cwd: ctx.cwd, files });
    }
  });
  pi.on("agent_settled", () => { clearTurn(); presented = []; });
  pi.on("context", (event, ctx) => {
    presented = matches(ctx) && prefs.effective(ctx).mainNested ? nestedFiles(ctx, base) : [];
    if (presented.length) return { messages: [...event.messages, {
      role: "custom", customType: SNAPSHOTS, content: presented.map(nestedRuleText).join("\n"), display: false, timestamp: Date.now(),
    }] };
  });
  pi.events.on(ADMISSION_CHANNEL, value => {
    const req = value as Partial<BridgeRequest<Admission>> | null;
    if (!current || !matches(current) || !req || req.rootSessionId !== id || req.cwd !== current.cwd || typeof req.respond !== "function") return;
    const { mainNested, ...grants } = prefs.effective(current);
    req.respond({ grants, mainFiles: mainNested ? presented.map(f => ({ ...f })) : [] });
  });
  pi.registerCommand("archeologist", {
    description: "Configure instruction discovery and inspect loaded context file paths",
    handler: async (_args, ctx) => {
      if (!matches(ctx) || ctx.mode !== "tui") return;
      if (pane) { pane.abort(); return; }
      const dialog = pane = new AbortController();
      const rows = () => requestInventory(pi.events, { rootSessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd });
      const controller = prefs.controller(pi, ctx, () => rows() !== undefined);
      try {
        const { openArcheologist } = await import("./view.ts");
        await openArcheologist(ctx, controller, () => {
          const native = ctx.getSystemPromptOptions().contextFiles ?? [];
          const nested = prefs.effective(ctx).mainNested ? nestedFiles(ctx, native) : [];
          return { mainPaths: [...new Set([...native, ...nested].map(f => f.path))], subagents: rows() };
        }, dialog.signal);
      } finally {
        controller.dispose();
        if (pane === dialog) pane = undefined;
      }
    },
  });
}
