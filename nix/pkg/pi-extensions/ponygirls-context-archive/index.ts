import { completeArchiveArguments } from "./src/complete.ts";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { parseScopedToggleCommand, parseToggleCommand, resolveScopedSetting, sessionEnabledData, type ScopedSettingsOrigin } from "@ponygirls/pi-settings";
import { BORDER_ORDER, CustomViewToggle, FactsView, borderBadge, borderBadgeCompact, formatCompact, formatCount, homeRelative, type BorderBadge, type FactGroup, type FactSegment, type FactsState, type FactsViewOptions } from "@ponygirls/pi-ui";
import { Type } from "typebox";
import { defineTool, estimateTokens, getAgentDir, type BoundaryState, type ExtensionAPI, type ExtensionContext, type SessionBoundaryDraft } from "@earendil-works/pi-coding-agent";
import { ARCHIVE_TYPE, DEFAULT_POLICY, MAX_FIND_ITEMS, MAX_FIND_QUERY_CHARS, MAX_LIST_ITEMS, MAX_READ_CHARS, RECALL_TOOL, planArchive, recallArchive, restoreArchive, restoreRequest } from "./src/archive.ts";
import { FileArchiveProjectStore, FilePreferenceStore, validateThresholds, type ArchiveDefaults, type ArchiveThresholds, type PreferenceStore } from "./src/preferences.ts";
import { SESSION_SETTING_TYPE, SESSION_THRESHOLDS_TYPE } from "./src/session-settings.ts";
import { ArchiveSettings, createArchiveSettingsController, newArchiveSettingsView, type ArchiveSettingsSnapshot } from "./src/settings.ts";

export const PREFERENCE_FILENAME = "context-archive.json";
export const BADGE_KEY = "context-archive";
const BADGE_GLYPH = "🗃️";
const DEFAULT_READ_CHARS = 8000;
const DEFAULT_LIST_ITEMS = 10;
const DEFAULT_FIND_ITEMS = 4;
const PERCENT_DISPLAY_DIGITS = 15;
const RECALL_DESCRIPTION = "Recover historical tool evidence on this branch. Use find with a case-sensitive literal to get exact excerpts across archived output/input; follow nextOffset for more matches. Use list to browse entries, or read with entryId and sha256 for original message JSON. A hit's readOffset/readLimit are UTF-16 coordinates for read. No match means absent from archived text, not from the project. History is not current state or permission to act.";

type Mode = { kind: "ready"; effective: ArchiveDefaults; defaults: ArchiveDefaults; snapshot: ArchiveSettingsSnapshot } | { kind: "fault"; message: string };

function formatPercent(value: number): string {
  // Round display noise only; selection uses the unrounded policy values.
  return `${Number((value * 100).toPrecision(PERCENT_DISPLAY_DIGITS))}%`;
}

/** The values behind the status text, for the status pane. `contextWindow` is null when the model's capacity is unknown. */
export type ArchiveStatus =
  | { kind: "fault"; message: string; globalPath: string }
  | {
    kind: "ready";
    enabled: boolean; enabledSource: ScopedSettingsOrigin; thresholds: ArchiveThresholds; thresholdsSource: ScopedSettingsOrigin;
    archived: number; tokens: number | null; contextWindow: number | null;
    globalPath: string; cwd: string; projectPath: string; projectTrusted: boolean;
  };

/** Session and project scopes override; everything below them is the global default. */
function scopeLabel(origin: ScopedSettingsOrigin, inherited: string): string {
  return origin === "project" ? "project override" : origin === "session" ? "session override" : inherited;
}

/** State first, then where it comes from; the complete text stays behind the pane's details key. */
export function archiveStatusFacts(status: ArchiveStatus, home: string): { state: FactsState; groups: FactGroup[] } {
  const globalSettings: FactSegment = { text: homeRelative(status.globalPath, home) };
  if (status.kind === "fault") {
    return { state: { text: "attention", state: "attention" }, groups: [[
      { label: "State", value: [{ text: "archival stopped", state: "attention" }, { text: status.message, state: "attention" }] },
      { label: "Settings", value: [globalSettings] },
    ]] };
  }
  const { contextWindow, thresholds } = status;
  const enabled = status.enabled ? "on" : "off";
  const enabledState = status.enabled ? "ok" : "settled";
  const source = scopeLabel(status.enabledSource, "global default");
  const archived = status.archived === 0 ? `nothing archived on this branch${status.enabled ? " yet" : ""}`
    : `${formatCount(status.archived)} archived ${status.archived === 1 ? "entry" : "entries"} on this branch`;
  const amount = (watermark: number): string => contextWindow === null ? "" : ` (${formatCompact(Math.ceil(contextWindow * watermark))})`;
  const inProject = relative(status.cwd, status.projectPath);
  const projectSettings = inProject.startsWith("..") || isAbsolute(inProject) ? homeRelative(status.projectPath, home) : inProject;
  return { state: { text: `${enabled} · ${source}`, state: enabledState }, groups: [[
    { label: "State", value: [{ text: `${enabled} (${source})`, state: enabledState }, { text: archived }] },
    { label: "Context", value: [{ text: contextWindow === null ? "model context capacity unknown"
      : `${status.tokens === null ? "unknown" : formatCompact(status.tokens)} / ${formatCompact(contextWindow)} tokens` }] },
    { label: "Thresholds", value: [
      { text: `archive at ${formatPercent(thresholds.highWatermark)}${amount(thresholds.highWatermark)} → release to ${formatPercent(thresholds.lowWatermark)}${amount(thresholds.lowWatermark)}` },
      { text: scopeLabel(status.thresholdsSource, "defaults") },
    ] },
    { label: "Settings", value: [globalSettings, { text: `project ${projectSettings}${status.projectTrusted ? "" : " (ignored: untrusted)"}` }] },
  ]] };
}

/** What the status pane shows: the structured status and the complete text it summarises. */
export interface ArchiveStatusContent { status: ArchiveStatus; text: string; home: string }
export type ArchiveStatusHost = Pick<FactsViewOptions, "theme" | "keys" | "rows" | "requestRender" | "close">;

/** The one status pane: facts first, the complete status text behind `d`. */
export function archiveStatusView(content: ArchiveStatusContent, host: ArchiveStatusHost): FactsView {
  const facts = archiveStatusFacts(content.status, content.home);
  return new FactsView({ ...host, title: "Context archive", state: facts.state, facts: () => facts.groups, details: () => content.text });
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
      Type.Object({ action: Type.Literal("find"), query: Type.String({ minLength: 1, maxLength: MAX_FIND_QUERY_CHARS }),
        offset: Type.Optional(Type.Integer({ minimum: 0, description: "Matches to skip" })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_FIND_ITEMS })) }, { additionalProperties: false }),
    ]),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const offset = params.offset === undefined ? 0 : params.offset;
      const limit = params.limit ?? (params.action === "find" ? DEFAULT_FIND_ITEMS : params.action === "list" ? DEFAULT_LIST_ITEMS : DEFAULT_READ_CHARS);
      const result = recallArchive(ctx.sessionManager.getBranch(), { ...params, offset, limit });
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
    const badge: BorderBadge = { glyph: BADGE_GLYPH, state: fault ? "attention" : "settled", label: fault ? "!" : "", compact: fault ? "!" : "" };
    ctx.ui.setWidget(BADGE_KEY, (_tui, theme) => ({
      render: (width) => [borderBadge(theme, badge, width)],
      renderCompact: (width) => borderBadgeCompact(theme, badge, width),
      invalidate() {},
      handleMouse: (event) => {
        if (event.type !== "click" || event.button !== "left" || ctx.mode !== "tui" || !ctx.hasUI) return undefined;
        void showStatus(ctx, controller).catch((error: unknown) => warn(ctx, String(error)));
        return { handled: true };
      },
    }), { placement: "borderBottomLeft", order: BORDER_ORDER.archive });
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

  /** What both status presentations read from the session: branch archive count and Pi's context usage. */
  function observe(ctx: ExtensionContext): { archived: number; tokens: number | null; contextWindow: number } {
    const catalog = recallArchive(ctx.sessionManager.getBranch(), { action: "list", offset: 0, limit: 1 });
    if (!("total" in catalog)) throw new Error("Archive catalog invariant violated");
    const usage = ctx.getContextUsage();
    const contextWindow = usage === undefined ? ctx.model === undefined ? 0 : ctx.model.contextWindow : usage.contextWindow;
    return { archived: catalog.total, tokens: usage === undefined ? null : usage.tokens, contextWindow };
  }
  function status(ctx: ExtensionContext): ArchiveStatus {
    if (mode.kind === "fault") return { kind: "fault", message: mode.message, globalPath: preferences.path };
    const { archived, tokens, contextWindow } = observe(ctx);
    const { snapshot } = mode;
    return { kind: "ready", enabled: mode.effective.enabled, enabledSource: snapshot.sources.enabled,
      thresholds: { highWatermark: mode.effective.highWatermark, lowWatermark: mode.effective.lowWatermark }, thresholdsSource: snapshot.sources.thresholds,
      archived, tokens, contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null,
      globalPath: preferences.path, cwd: ctx.cwd, projectPath: snapshot.targets.project, projectTrusted: snapshot.projectTrusted };
  }
  /** Command and badge open the same pane; its content is read when it opens, not when it closes. */
  function showStatus(ctx: ExtensionContext, view: CustomViewToggle): Promise<void> {
    return view.toggle(ctx.ui, (tui, theme, keys, done) => archiveStatusView({ status: status(ctx), text: statusText(ctx), home: homedir() },
      { theme, keys, rows: () => tui.terminal.rows, requestRender: () => tui.requestRender(), close: done }));
  }
  function statusText(ctx: ExtensionContext): string {
    const enabled = mode.kind === "ready" && mode.effective.enabled;
    const { archived, tokens, contextWindow } = observe(ctx);
    const pressure = mode.kind === "fault" ? "Threshold status unavailable due to settings error.\n" : Number.isFinite(contextWindow) && contextWindow > 0
      ? `Pi context usage: ${tokens === null ? "unknown" : tokens} / ${contextWindow} tokens; archive trigger ${Math.ceil(contextWindow * mode.effective.highWatermark)} (${formatPercent(mode.effective.highWatermark)}), release toward ${Math.ceil(contextWindow * mode.effective.lowWatermark)} (${formatPercent(mode.effective.lowWatermark)}).\n`
      : `Effective thresholds: trigger ${formatPercent(mode.effective.highWatermark)}, release toward ${formatPercent(mode.effective.lowWatermark)}; model context capacity unknown.\n`;
    const source = mode.kind === "fault" ? "settings error" : mode.snapshot.sources.enabled === 'project' ? 'project override' : mode.snapshot.sources.enabled !== 'session' ? "inherited global default" : `session override; global default ${mode.defaults.enabled ? "ON" : "OFF"}`;
    const thresholdSource = mode.kind === "fault" ? "" : `Threshold source: ${mode.snapshot.sources.thresholds === 'project' ? 'project override' : mode.snapshot.sources.thresholds !== 'session' ? "inherited global defaults" : "session override"}; global defaults ${formatPercent(mode.defaults.highWatermark)} / ${formatPercent(mode.defaults.lowWatermark)}.\n`;
    return `Context archive: ${mode.kind === "fault" ? "ERROR" : enabled ? "ON" : "OFF"} (${source})\n` +
      `${archived} archived entries on this branch. Last boundary: ${lastReason}.\n` + pressure + thresholdSource +
      (enabled ? "Automatic selection begins at a completed-turn boundary; no summarizer calls.\n" : "No new archival. Retained originals reach future requests; native restoration waits for the next completed boundary. Independent Pi compaction is not undone.\n") +
      `Global defaults: ${preferences.path}` + (mode.kind === 'ready' ? `\nEffective sources: enabled=${mode.snapshot.sources.enabled}; thresholds=${mode.snapshot.sources.thresholds}.\nProject settings: ${mode.snapshot.targets.project}${mode.snapshot.projectTrusted ? '' : ' (ignored: untrusted)'}` : '');
  }

  pi.registerCommand("context-archive", {
    description: "Move old tool output out of context: on/off, thresholds",
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
        if (statusAction && ctx.mode === "tui" && ctx.hasUI) await showStatus(ctx, statusView);
        else ctx.ui.notify(statusText(ctx), "info");
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
