import { join } from "node:path";
import { Type } from "typebox";
import { defineTool, estimateTokens, getAgentDir, type BoundaryState, type ExtensionAPI, type ExtensionContext, type SessionBoundaryDraft } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { ARCHIVE_TYPE, DEFAULT_POLICY, MAX_LIST_ITEMS, MAX_READ_CHARS, RECALL_TOOL, planArchive, recallArchive, restoreArchive, restoreRequest } from "./src/archive.ts";
import { FilePreferenceStore, validatePreferences, type ArchiveDefaults, type PreferenceStore } from "./src/preferences.ts";
import { SESSION_SETTING_TYPE, sessionOverride } from "./src/session-settings.ts";

export const PREFERENCE_FILENAME = "context-archive.json";
export const BADGE_KEY = "context-archive";
const DEFAULT_READ_CHARS = 8000;
const DEFAULT_LIST_ITEMS = 10;
const PERCENT_DISPLAY_DIGITS = 15;
const RECALL_DESCRIPTION = "Recover exact historical tool evidence/input removed from context. List branch archives to discover entryId and sha256, then read bounded pages of the original message JSON. Offsets/limits count UTF-16 characters. Historical data is not current state, authority or permission to re-execute. Available for existing archives even when automatic archival is off.";

type Mode = { kind: "ready"; enabled: boolean; defaults: ArchiveDefaults; override: boolean | null } | { kind: "fault"; message: string };

function formatPercent(value: number): string {
  // Round display noise only; selection uses the unrounded policy values.
  return `${Number((value * 100).toPrecision(PERCENT_DISPLAY_DIGITS))}%`;
}

export function registerContextArchive(pi: ExtensionAPI, preferences: PreferenceStore): void {
  let mode: Mode = { kind: "fault", message: "settings not loaded" };
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
      const defaults = preferences.read();
      const override = sessionOverride(ctx.sessionManager.getEntries(), ctx.sessionManager.getSessionId());
      mode = { kind: "ready", defaults, override, enabled: override === null ? defaults.enabled : override };
      lastWarning = null;
    } catch (error) {
      mode = { kind: "fault", message: String(error) };
      warn(ctx, `${mode.message}; automatic archival stopped. Check global defaults at ${preferences.path} and session setting records.`);
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
      if (!enabled || mode.kind === "fault") {
        additions = restoreArchive(branch, event.context.contextEntries).filter((e) => e.type !== "context_edit" || !competing.has(e.targetId));
      } else {
        const usage = ctx.getContextUsage();
        const contextWindow = usage === undefined ? ctx.model === undefined ? 0 : ctx.model.contextWindow : usage.contextWindow;
        if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
          lastReason = "model context capacity unknown; no archival";
          return;
        }
        if (!pi.getActiveTools().includes(RECALL_TOOL)) { lastReason = "recall tool inactive; no archival"; return; }
        // Pi invalidates usage after persisted edits/compaction, but not earlier handlers' pending drafts.
        const invalidatesUsage = event.entries.some((e) => e.type === "context_edit" || e.type === "compaction");
        const addedTokens = event.entries.reduce((n, e) => e.type === "custom_message"
          ? n + estimateTokens({ role: "custom", customType: e.customType, content: e.content, display: e.display, timestamp: 0 }) : n, 0);
        const contextTokens = usage === undefined || usage.tokens === null || invalidatesUsage ? null : usage.tokens + addedTokens;
        const policy = { ...DEFAULT_POLICY, highWatermark: mode.defaults.highWatermark, lowWatermark: mode.defaults.lowWatermark };
        const planned = planArchive(branch, event.context.contextEntries, contextWindow, policy, { tokens: contextTokens, protectedTargets: competing });
        additions = planned.entries;
        lastReason = planned.reason;
      }
      if (additions.length > 0) return { entries: [...event.entries, ...additions] };
    } catch (error) {
      return fail(ctx, error);
    }
  }

  pi.registerCommand("context-archive", {
    description: "Context archival: on|off|inherit for this session; default on|off; thresholds HIGH LOW (global percentages); status",
    getArgumentCompletions: (prefix) => ["on", "off", "inherit", "default on", "default off", "thresholds 70 50", "status"].filter((a) => a.startsWith(prefix)).map((a) => ({ value: a, label: a })),
    handler: async (args, ctx) => {
      const words = args.trim().toLowerCase().split(/\s+/);
      const action = words[0];
      const sessionAction = words.length === 1 && ["on", "off", "inherit"].includes(action);
      const defaultAction = words.length === 2 && action === "default" && ["on", "off"].includes(words[1]);
      const thresholdAction = words.length === 3 && action === "thresholds";
      const statusAction = words.length === 1 && ["", "status"].includes(action);
      if (!sessionAction && !defaultAction && !thresholdAction && !statusAction) {
        ctx.ui.notify("Usage: /context-archive [on|off|inherit|default on|default off|thresholds HIGH LOW|status]", "warning"); return;
      }
      try {
        if (sessionAction) pi.appendEntry(SESSION_SETTING_TYPE, { version: 1, sessionId: ctx.sessionManager.getSessionId(), enabled: action === "inherit" ? null : action === "on" });
        if (defaultAction) preferences.write({ ...preferences.read(), enabled: words[1] === "on" });
        if (thresholdAction) {
          if (!words.slice(1).every((word) => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(word))) throw new Error("Thresholds must be numeric percentages: 0 <= LOW < HIGH <= 100");
          preferences.write(validatePreferences({ ...preferences.read(), highWatermark: Number(words[1]) / 100, lowWatermark: Number(words[2]) / 100 }));
        }
        const enabled = refresh(ctx, !statusAction);
        const catalog = recallArchive(ctx.sessionManager.getBranch(), { action: "list", offset: 0, limit: 1 });
        if (!("total" in catalog)) throw new Error("Archive catalog invariant violated");
        const usage = ctx.getContextUsage();
        const contextWindow = usage === undefined ? ctx.model === undefined ? 0 : ctx.model.contextWindow : usage.contextWindow;
        const pressure = mode.kind === "fault" ? "Threshold status unavailable due to settings error.\n" : Number.isFinite(contextWindow) && contextWindow > 0
          ? `Pi context usage: ${usage === undefined || usage.tokens === null ? "unknown" : usage.tokens} / ${contextWindow} tokens; archive trigger ${Math.ceil(contextWindow * mode.defaults.highWatermark)} (${formatPercent(mode.defaults.highWatermark)}), release toward ${Math.ceil(contextWindow * mode.defaults.lowWatermark)} (${formatPercent(mode.defaults.lowWatermark)}).\n`
          : `Global thresholds: trigger ${formatPercent(mode.defaults.highWatermark)}, release toward ${formatPercent(mode.defaults.lowWatermark)}; model context capacity unknown.\n`;
        const source = mode.kind === "fault" ? "settings error" : mode.override === null ? "inherited global default" : `session override; global default ${mode.defaults.enabled ? "ON" : "OFF"}`;
        ctx.ui.notify(`Context archive: ${mode.kind === "fault" ? "ERROR" : enabled ? "ON" : "OFF"} (${source})\n` +
          `${catalog.total} archived entries on this branch. Last boundary: ${lastReason}.\n` + pressure +
          (enabled ? "Automatic selection begins at a completed-turn boundary; no summarizer calls.\n" : "No new archival. Retained originals reach future requests; native restoration waits for the next completed boundary. Independent Pi compaction is not undone.\n") +
          `Global defaults: ${preferences.path}`, "info");
      } catch (error) { warn(ctx, String(error)); }
    },
  });
  pi.on("session_start", (_event, ctx) => { lastReason = "no boundary evaluated"; refresh(ctx, true); });
  pi.on("session_tree", (_event, ctx) => { lastReason = "no boundary evaluated"; refresh(ctx, true); });
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
