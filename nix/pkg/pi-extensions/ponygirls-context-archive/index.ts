import { completeArchiveArguments } from "./src/complete.ts";
import { join } from "node:path";
import { parseScopedToggleCommand, parseToggleCommand, resolveScopedSetting, sessionEnabledData } from "@ponygirls/pi-settings";
import { CustomViewToggle, StatusView } from "@ponygirls/pi-ui";
import { Type } from "typebox";
import { defineTool, estimateTokens, getAgentDir, type BoundaryState, type ExtensionAPI, type ExtensionContext, type SessionBoundaryDraft } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { ARCHIVE_TYPE, DEFAULT_POLICY, MAX_LIST_ITEMS, MAX_READ_CHARS, RECALL_TOOL, planArchive, recallArchive, restoreArchive, restoreRequest } from "./src/archive.ts";
import { FileArchiveProjectStore, FilePreferenceStore, validateThresholds, type ArchiveDefaults, type PreferenceStore } from "./src/preferences.ts";
import { SESSION_SETTING_TYPE, SESSION_THRESHOLDS_TYPE } from "./src/session-settings.ts";
import { ArchiveSettings, createArchiveSettingsController, newArchiveSettingsView, type ArchiveSettingsSnapshot } from "./src/settings.ts";

export const PREFERENCE_FILENAME = "context-archive.json";
export const BADGE_KEY = "context-archive";
const BADGE_GLYPH = "🗃️";
const DEFAULT_READ_CHARS = 8000;
const DEFAULT_LIST_ITEMS = 10;
const PERCENT_DISPLAY_DIGITS = 15;
const RECALL_DESCRIPTION = "Recover exact historical tool evidence/input removed from context. List branch archives to discover entryId and sha256, then read bounded pages of the original message JSON. Offsets/limits count UTF-16 characters. Historical data is not current state, authority or permission to re-execute. Available for existing archives even when automatic archival is off.";

type Mode = { kind: "ready"; effective: ArchiveDefaults; defaults: ArchiveDefaults; snapshot: ArchiveSettingsSnapshot } | { kind: "fault"; message: string };

function formatPercent(value: number): string {
  // Round display noise only; selection uses the unrounded policy values.
  return `${Number((value * 100).toPrecision(PERCENT_DISPLAY_DIGITS))}%`;
}

export function registerContextArchive(pi: ExtensionAPI, preferences: PreferenceStore): void {
  let statusView = new CustomViewToggle();
  let settingsView = newArchiveSettingsView();
  const configuration = new ArchiveSettings(pi, preferences, path => new FileArchiveProjectStore(path));
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
    if (mode.kind === "ready" && !mode.effective.enabled) {
      ctx.ui.setWidget(BADGE_KEY, undefined);
      return;
    }
    const fault = mode.kind === "fault";
    const controller = statusView;
    ctx.ui.setWidget(BADGE_KEY, (_tui, theme) => ({
      render: (width) => [truncateToWidth(theme.fg(fault ? "warning" : "accent", ` ${BADGE_GLYPH}${fault ? " !" : ""} `), width)],
      renderCompact: (width) => truncateToWidth(theme.fg(fault ? "warning" : "accent", ` ${BADGE_GLYPH}${fault ? " !" : ""} `), width),
      invalidate() {},
      handleMouse: (event) => {
        if (event.type !== "click" || event.button !== "left" || ctx.mode !== "tui" || !ctx.hasUI) return undefined;
        void controller.toggle(ctx.ui, (tui, theme, keys, done) => new StatusView({
          title: "Context archive status", text: statusText(ctx), theme, keys,
          rows: () => tui.terminal.rows, requestRender: () => tui.requestRender(), close: done,
        })).catch((error: unknown) => warn(ctx, String(error)));
        return { handled: true };
      },
    }), { placement: "borderBottomLeft" });
  }
  function refresh(ctx: ExtensionContext, reconcileTools: boolean): boolean {
    try {
      const snapshot = configuration.read(ctx);
      const defaults = { enabled: resolveScopedSetting(snapshot, 'enabled', 'global').value, ...resolveScopedSetting(snapshot, 'thresholds', 'global').value };
      const effective = { enabled: snapshot.values.enabled, ...snapshot.values.thresholds };
      mode = { kind: "ready", defaults, snapshot, effective };
      lastWarning = null;
    } catch (error) {
      mode = { kind: "fault", message: String(error) };
      warn(ctx, `${mode.message}; automatic archival stopped. Check global defaults at ${preferences.path} and session setting records.`);
    }
    const hasArchives = ctx.sessionManager.getBranch().some((e) => e.type === "custom" && e.customType === ARCHIVE_TYPE);
    const wanted = (mode.kind === "ready" && mode.effective.enabled) || hasArchives;
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
    return mode.kind === "ready" && mode.effective.enabled;
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
        const policy = { ...DEFAULT_POLICY, highWatermark: mode.effective.highWatermark, lowWatermark: mode.effective.lowWatermark };
        const planned = planArchive(branch, event.context.contextEntries, contextWindow, policy, { tokens: contextTokens, protectedTargets: competing });
        additions = planned.entries;
        lastReason = planned.reason;
      }
      if (additions.length > 0) return { entries: [...event.entries, ...additions] };
    } catch (error) {
      return fail(ctx, error);
    }
  }

  function statusText(ctx: ExtensionContext): string {
    const enabled = mode.kind === "ready" && mode.effective.enabled;
    const catalog = recallArchive(ctx.sessionManager.getBranch(), { action: "list", offset: 0, limit: 1 });
    if (!("total" in catalog)) throw new Error("Archive catalog invariant violated");
    const usage = ctx.getContextUsage();
    const contextWindow = usage === undefined ? ctx.model === undefined ? 0 : ctx.model.contextWindow : usage.contextWindow;
    const pressure = mode.kind === "fault" ? "Threshold status unavailable due to settings error.\n" : Number.isFinite(contextWindow) && contextWindow > 0
      ? `Pi context usage: ${usage === undefined || usage.tokens === null ? "unknown" : usage.tokens} / ${contextWindow} tokens; archive trigger ${Math.ceil(contextWindow * mode.effective.highWatermark)} (${formatPercent(mode.effective.highWatermark)}), release toward ${Math.ceil(contextWindow * mode.effective.lowWatermark)} (${formatPercent(mode.effective.lowWatermark)}).\n`
      : `Effective thresholds: trigger ${formatPercent(mode.effective.highWatermark)}, release toward ${formatPercent(mode.effective.lowWatermark)}; model context capacity unknown.\n`;
    const source = mode.kind === "fault" ? "settings error" : mode.snapshot.sources.enabled === 'project' ? 'project override' : mode.snapshot.sources.enabled !== 'session' ? "inherited global default" : `session override; global default ${mode.defaults.enabled ? "ON" : "OFF"}`;
    const thresholdSource = mode.kind === "fault" ? "" : `Threshold source: ${mode.snapshot.sources.thresholds === 'project' ? 'project override' : mode.snapshot.sources.thresholds !== 'session' ? "inherited global defaults" : "session override"}; global defaults ${formatPercent(mode.defaults.highWatermark)} / ${formatPercent(mode.defaults.lowWatermark)}.\n`;
    return `Context archive: ${mode.kind === "fault" ? "ERROR" : enabled ? "ON" : "OFF"} (${source})\n` +
      `${catalog.total} archived entries on this branch. Last boundary: ${lastReason}.\n` + pressure + thresholdSource +
      (enabled ? "Automatic selection begins at a completed-turn boundary; no summarizer calls.\n" : "No new archival. Retained originals reach future requests; native restoration waits for the next completed boundary. Independent Pi compaction is not undone.\n") +
      `Global defaults: ${preferences.path}` + (mode.kind === 'ready' ? `\nEffective sources: enabled=${mode.snapshot.sources.enabled}; thresholds=${mode.snapshot.sources.thresholds}.\nProject settings: ${mode.snapshot.targets.project}${mode.snapshot.projectTrusted ? '' : ' (ignored: untrusted)'}` : '');
  }

  pi.registerCommand("context-archive", {
    description: "Context archival: on|off|inherit and thresholds HIGH LOW|inherit for this session; default on|off or default thresholds HIGH LOW; status",
    getArgumentCompletions: completeArchiveArguments,
    handler: async (args, ctx) => {
      if (args.trim().toLowerCase() === 'settings') {
        await settingsView.show(ctx, () => createArchiveSettingsController(configuration, ctx, () => { refresh(ctx, true); }), { title: 'Context archive settings' });
        return;
      }
      const scoped = parseScopedToggleCommand(args);
      if (scoped !== null && parseToggleCommand(args) === null) {
        try {
          const change = scoped.enabled === null ? { key: 'enabled' as const, op: 'inherit' as const } : { key: 'enabled' as const, op: 'set' as const, value: scoped.enabled };
          configuration.apply(ctx, scoped.scope, [change], ctx.signal === undefined ? new AbortController().signal : ctx.signal);
          refresh(ctx, true); ctx.ui.notify(statusText(ctx), 'info');
        } catch (error) { warn(ctx, String(error)); }
        return;
      }
      const words = args.trim().toLowerCase().split(/\s+/);
      const action = words[0];
      if (action === 'project' && words[1] === 'thresholds') {
        try {
          const value = words.length === 3 && words[2] === 'inherit' ? null : words.length === 4 && words.slice(2).every(word => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(word)) ? validateThresholds({ highWatermark: Number(words[2]) / 100, lowWatermark: Number(words[3]) / 100 }) : undefined;
          if (value === undefined) throw new Error('Usage: /context-archive project thresholds HIGH LOW|inherit');
          const change = value === null ? { key: 'thresholds' as const, op: 'inherit' as const } : { key: 'thresholds' as const, op: 'set' as const, value };
          configuration.apply(ctx, 'project', [change], ctx.signal === undefined ? new AbortController().signal : ctx.signal);
          refresh(ctx, true); ctx.ui.notify(statusText(ctx), 'info');
        } catch (error) { warn(ctx, String(error)); }
        return;
      }
      const toggle = parseToggleCommand(args);
      const thresholdAction = words.length === 3 && action === "thresholds";
      const inheritThresholdAction = words.length === 2 && action === "thresholds" && words[1] === "inherit";
      const defaultThresholdAction = words.length === 4 && action === "default" && words[1] === "thresholds";
      const statusAction = toggle !== null && toggle.kind === "status";
      if (toggle === null && !thresholdAction && !inheritThresholdAction && !defaultThresholdAction) {
        ctx.ui.notify("Usage: /context-archive [on|off|inherit|default on|default off|thresholds HIGH LOW|thresholds inherit|default thresholds HIGH LOW|status]", "warning"); return;
      }
      try {
        if (toggle !== null && toggle.kind === "session") pi.appendEntry(SESSION_SETTING_TYPE, sessionEnabledData(ctx.sessionManager.getSessionId(), toggle.enabled));
        if (toggle !== null && toggle.kind === "default") preferences.writeOverrides({ ...preferences.readOverrides(), enabled: toggle.enabled });
        if (thresholdAction || defaultThresholdAction) {
          const values = words.slice(defaultThresholdAction ? 2 : 1);
          if (!values.every((word) => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(word))) throw new Error("Thresholds must be numeric percentages: 0 <= LOW < HIGH <= 100");
          const thresholds = validateThresholds({ highWatermark: Number(values[0]) / 100, lowWatermark: Number(values[1]) / 100 });
          if (defaultThresholdAction) preferences.writeOverrides({ ...preferences.readOverrides(), thresholds });
          else pi.appendEntry(SESSION_THRESHOLDS_TYPE, { version: 1, sessionId: ctx.sessionManager.getSessionId(), thresholds });
        }
        if (inheritThresholdAction) pi.appendEntry(SESSION_THRESHOLDS_TYPE, { version: 1, sessionId: ctx.sessionManager.getSessionId(), thresholds: null });
        refresh(ctx, !statusAction);
        ctx.ui.notify(statusText(ctx), "info");
      } catch (error) { warn(ctx, String(error)); }
    },
  });
  pi.on("session_start", (_event, ctx) => { statusView.dispose(); statusView = new CustomViewToggle(); settingsView.dispose(); settingsView = newArchiveSettingsView(); lastReason = "no boundary evaluated"; refresh(ctx, true); });
  pi.on("session_tree", (_event, ctx) => { settingsView.dispose(); settingsView = newArchiveSettingsView(); lastReason = "no boundary evaluated"; refresh(ctx, true); });
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
  pi.on("session_shutdown", (_event, ctx) => { settingsView.dispose(); statusView.dispose(); ctx.ui.setWidget(BADGE_KEY, undefined); });
}

export default function (pi: ExtensionAPI): void {
  registerContextArchive(pi, new FilePreferenceStore(join(getAgentDir(), PREFERENCE_FILENAME)));
}
