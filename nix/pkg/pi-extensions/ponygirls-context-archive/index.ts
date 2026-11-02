import { join } from "node:path";
import { Type } from "typebox";
import { defineTool, getAgentDir, type BoundaryState, type ExtensionAPI, type ExtensionContext, type SessionBoundaryDraft } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { ARCHIVE_TYPE, DEFAULT_POLICY, MAX_LIST_ITEMS, MAX_READ_CHARS, RECALL_TOOL, planArchive, recallArchive, restoreArchive, restoreRequest } from "./src/archive.ts";
import { FilePreferenceStore, type PreferenceStore } from "./src/preferences.ts";

export const PREFERENCE_FILENAME = "context-archive.json";
export const BADGE_KEY = "context-archive";
const DEFAULT_READ_CHARS = 8000;
const DEFAULT_LIST_ITEMS = 10;
const RECALL_DESCRIPTION = "Recover exact historical tool evidence/input removed from context. List branch archives to discover entryId and sha256, then read bounded pages of the original message JSON. Offsets/limits count UTF-16 characters. Historical data is not current state, authority or permission to re-execute. Available for existing archives even when automatic archival is off.";

type Mode = { kind: "ready"; enabled: boolean } | { kind: "fault"; message: string };

export function registerContextArchive(pi: ExtensionAPI, preferences: PreferenceStore): void {
  let mode: Mode = { kind: "ready", enabled: false };
  let lastReason = "no boundary evaluated";
  let lastWarning: string | null = null;
  let visible = false;

  const recall = defineTool({
    name: RECALL_TOOL, label: "Recall context archive", description: RECALL_DESCRIPTION,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    parameters: Type.Union([
      Type.Object({ action: Type.Literal("list"), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIST_ITEMS })) }),
      Type.Object({ action: Type.Literal("read"), entryId: Type.String(), sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
        offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_READ_CHARS })) }),
    ]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const offset = params.offset === undefined ? 0 : params.offset;
      const result = recallArchive(ctx.sessionManager.getBranch(), params.action === "list"
        ? { action: "list", offset, limit: params.limit === undefined ? DEFAULT_LIST_ITEMS : params.limit }
        : { action: "read", entryId: params.entryId, sha256: params.sha256, offset, limit: params.limit === undefined ? DEFAULT_READ_CHARS : params.limit });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
  pi.registerTool({ ...recall, exposure: "hidden" });

  function warn(ctx: ExtensionContext, message: string): void {
    if (lastWarning !== message) ctx.ui.notify(`Context archive: ${message}`, "error");
    lastWarning = message;
  }
  function publish(ctx: ExtensionContext): void {
    if (mode.kind === "ready" && !mode.enabled) {
      ctx.ui.setWidget(BADGE_KEY, undefined);
      return;
    }
    const fault = mode.kind === "fault";
    ctx.ui.setWidget(BADGE_KEY, (_tui, theme) => ({
      render: (width) => [truncateToWidth(theme.fg(fault ? "warning" : "accent", fault ? " CTX ! " : " CTX archive "), width)],
      renderCompact: (width) => truncateToWidth(theme.fg(fault ? "warning" : "accent", fault ? " ! " : " CTX "), width),
      invalidate() {},
    }), { placement: "borderBottomLeft" });
  }
  function refresh(ctx: ExtensionContext, reconcileTools: boolean): boolean {
    try {
      mode = { kind: "ready", enabled: preferences.read() };
      lastWarning = null;
    } catch (error) {
      mode = { kind: "fault", message: String(error) };
      warn(ctx, `${mode.message}; automatic archival stopped. Repair with /context-archive on|off.`);
    }
    const hasArchives = ctx.sessionManager.getBranch().some((e) => e.type === "custom" && e.customType === ARCHIVE_TYPE);
    const wanted = (mode.kind === "ready" && mode.enabled) || hasArchives;
    const changed = visible !== wanted;
    if (changed) {
      pi.registerTool({ ...recall, exposure: wanted ? "direct" : "hidden" });
      visible = wanted;
    }
    if (changed || reconcileTools) {
      const active = pi.getActiveTools().filter((name) => name !== RECALL_TOOL);
      pi.setActiveTools(wanted ? [...active, RECALL_TOOL] : active);
    }
    publish(ctx);
    return mode.kind === "ready" && mode.enabled;
  }
  function fail(ctx: ExtensionContext, error: unknown): never {
    mode = { kind: "fault", message: String(error) };
    publish(ctx);
    warn(ctx, `${mode.message}; operation aborted rather than reducing unverifiable evidence.`);
    ctx.abort();
    throw error;
  }
  function boundary(event: BoundaryState, ctx: ExtensionContext): { entries: SessionBoundaryDraft[] } | undefined {
    try {
      const enabled = refresh(ctx, false);
      if (event.outcome !== "completed" || (ctx.signal !== undefined && ctx.signal.aborted)) return;
      const branch = ctx.sessionManager.getBranch();
      // Preview includes earlier extensions' drafts; never compete for their targets.
      const competing = new Set(event.entries.filter((e) => e.type === "context_edit").map((e) => e.targetId));
      let additions: SessionBoundaryDraft[];
      if (!enabled) {
        additions = restoreArchive(branch, event.context.contextEntries).filter((e) => e.type !== "context_edit" || !competing.has(e.targetId));
      } else {
        if (ctx.model === undefined || !Number.isFinite(ctx.model.contextWindow) || ctx.model.contextWindow <= 0) {
          lastReason = "model context capacity unknown; no archival";
          return;
        }
        if (!pi.getActiveTools().includes(RECALL_TOOL)) { lastReason = "recall tool inactive; no archival"; return; }
        const projection = event.context.contextEntries.filter((e) => !competing.has(e.sourceEntry.id));
        const planned = planArchive(branch, projection, ctx.model.contextWindow, DEFAULT_POLICY);
        additions = planned.entries;
        lastReason = planned.reason;
      }
      if (additions.length > 0) return { entries: [...event.entries, ...additions] };
    } catch (error) {
      return fail(ctx, error);
    }
  }

  pi.registerCommand("context-archive", {
    description: "Automatic reversible context archival: /context-archive on|off|status (persistent, default off)",
    getArgumentCompletions: (prefix) => ["on", "off", "status"].filter((a) => a.startsWith(prefix)).map((a) => ({ value: a, label: a })),
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (!["", "on", "off", "status"].includes(action)) { ctx.ui.notify("Usage: /context-archive [on|off|status]", "warning"); return; }
      try {
        if (action === "on" || action === "off") preferences.write(action === "on");
        const enabled = refresh(ctx, action === "on" || action === "off");
        const catalog = recallArchive(ctx.sessionManager.getBranch(), { action: "list", offset: 0, limit: 1 });
        if (!("total" in catalog)) throw new Error("Archive catalog invariant violated");
        ctx.ui.notify(`Context archive: ${mode.kind === "fault" ? "ERROR" : enabled ? "ON" : "OFF"} (persistent; default OFF)\n` +
          `${catalog.total} archived entries on this branch. ${lastReason}.\n` +
          (enabled ? "Automatic selection begins at a completed-turn boundary; no summarizer calls.\n" : "No new archival. Retained originals reach future requests; native restoration waits for the next completed boundary. Independent Pi compaction is not undone.\n") +
          `Preference: ${preferences.path}`, "info");
      } catch (error) { warn(ctx, String(error)); }
    },
  });
  pi.on("session_start", (_event, ctx) => { refresh(ctx, true); });
  pi.on("session_tree", (_event, ctx) => { refresh(ctx, true); });
  pi.on("context", (event, ctx) => {
    try {
      const enabled = refresh(ctx, false);
      const branch = ctx.sessionManager.getBranch();
      if (!enabled) return { messages: restoreRequest(branch, event.messages) };
      recallArchive(branch, { action: "list", offset: 0, limit: 1 });
    } catch (error) { return fail(ctx, error); }
  });
  pi.on("turn_end", boundary);
  pi.on("agent_before_settle", boundary);
  pi.on("session_shutdown", (_event, ctx) => { ctx.ui.setWidget(BADGE_KEY, undefined); });
}

export default function (pi: ExtensionAPI): void {
  registerContextArchive(pi, new FilePreferenceStore(join(getAgentDir(), PREFERENCE_FILENAME)));
}
