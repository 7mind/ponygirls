import { join } from "node:path";
import { getAgentDir, CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { completeArgument, ScopedSettingsView, type ArgumentChoice } from "@ponygirls/pi-ui";
import { readJsonPreferences, writeJsonPreferences, validateToggleOverrides, FileProjectTogglePreferenceStore, SharedScopedToggleConfiguration, ScopedSettingsController, scopedBooleanField, parseScopedToggleCommand, type ToggleOverrideStore, type ToggleOverrides, type ToggleDefaults } from "@ponygirls/pi-settings";

export const PREFERENCE_FILENAME = "openai-fast.json";
export const SESSION_SETTING_TYPE = "ponygirls.openai-fast.setting";
const DEFAULT_ENABLED = true;
type ServiceTier = "priority" | "default";
export interface FastPreferenceStore extends ToggleOverrideStore { read(): boolean; write(enabled: boolean): void }

export class FilePreferenceStore implements FastPreferenceStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  read(): boolean {
    const value = this.readOverrides();
    return value.enabled === undefined ? DEFAULT_ENABLED : value.enabled;
  }
  readOverrides(): ToggleOverrides {
    return readJsonPreferences(this.path, () => ({}), value => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error('Expected {"enabled": boolean}');
      if ("version" in value) {
        if (value.version !== 2) throw new Error("Expected OpenAI fast overrides version 2");
        const { version: _version, ...overrides } = value;
        return validateToggleOverrides(overrides);
      }
      if (!("enabled" in value) || typeof value.enabled !== "boolean") throw new Error('Expected {"enabled": boolean}');
      return { enabled: value.enabled };
    }, "OpenAI fast preference");
  }
  write(enabled: boolean): void { writeJsonPreferences(this.path, { enabled }); }
  writeOverrides(value: ToggleOverrides): void { writeJsonPreferences(this.path, { version: 2, ...validateToggleOverrides(value) }); }
}

interface RequestObservation {
  provider: string;
  model: string;
  requestedTier: ServiceTier;
  reportedTier: string | undefined;
  httpStatus: number | undefined;
}
const FAST_ACTIONS: readonly ArgumentChoice[] = [
  { token: "on", label: "on", description: "request priority processing for OpenAI models (saved globally)", continues: false },
  { token: "off", label: "off", description: "use the default tier (saved globally)", continues: false },
  { token: "status", label: "status", description: "show settings and the last observed tier", continues: false },
  { token: "settings", label: "settings", description: "open scoped checkbox settings", continues: false },
  ...["global", "project", "session"].map(token => ({ token, label: token, description: "on|off|inherit in this scope", continues: true })),
];
function isOpenAI(provider: string): boolean { return provider === "openai" || provider === "openai-codex"; }

export function registerFastMode(pi: ExtensionAPI, preferences: FastPreferenceStore): void {
  const configuration = new SharedScopedToggleConfiguration(pi, {
    defaultEnabled: DEFAULT_ENABLED, filename: PREFERENCE_FILENAME, projectDirectory: CONFIG_DIR_NAME,
    customType: SESSION_SETTING_TYPE, global: preferences, projectStore: path => new FileProjectTogglePreferenceStore(path),
  });
  let settings = new ScopedSettingsView();
  let lastRequest: RequestObservation | undefined;
  pi.registerCommand("fast", {
    description: "OpenAI priority processing: on|off (global), settings, status, or global|project|session on|off|inherit",
    getArgumentCompletions: prefix => completeArgument(prefix, previous => {
      if (previous.length === 0) return FAST_ACTIONS;
      if (previous.length === 1 && ["global", "project", "session"].includes(previous[0].toLowerCase())) return ["on", "off", "inherit"].map(token => ({ token, label: token, description: "scoped preference", continues: false }));
      return null;
    }),
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === "settings") {
        await settings.show(ctx, () => new ScopedSettingsController<ToggleDefaults>({
          fields: { enabled: scopedBooleanField("Fast mode", "Request the priority tier for OpenAI providers. This is not proof that the provider used that tier.") },
          order: ["enabled"], inactive: () => "",
          adapter: {
            read: () => configuration.read(ctx),
            apply: (scope, changes, signal) => {
              if (changes.length !== 1) throw new Error("Expected one Fast setting change");
              const change = changes[0];
              configuration.apply(ctx, scope, change.op === "inherit" ? null : change.value, signal);
            },
            applied() {},
          },
        }), { title: "Fast mode settings" });
        return;
      }
      const scoped = parseScopedToggleCommand(args);
      if (scoped === null && action !== "" && action !== "status" && action !== "on" && action !== "off") {
        ctx.ui.notify("Usage: /fast [on|off|status|settings] or global|project|session on|off|inherit", "warning");
        return;
      }
      if (scoped !== null) configuration.apply(ctx, scoped.scope, scoped.enabled, ctx.signal === undefined ? new AbortController().signal : ctx.signal);
      else if (action === "on" || action === "off") preferences.write(action === "on");
      const snapshot = configuration.read(ctx);
      const enabled = snapshot.values.enabled;
      const model = ctx.model;
      const nextRequest = model && isOpenAI(model.provider)
        ? `${enabled ? "priority" : "default"} (${model.provider}/${model.id})`
        : `unchanged (${model ? `${model.provider}/${model.id}; not an OpenAI provider` : "no model selected"})`;
      const observation = lastRequest
        ? `Last OpenAI request (this runtime): ${lastRequest.provider}/${lastRequest.model}\n` +
          `Requested tier: ${lastRequest.requestedTier}\n` +
          `OpenAI-reported tier: ${lastRequest.reportedTier === undefined ? "not reported; unverified" : lastRequest.reportedTier}\n` +
          `HTTP status: ${lastRequest.httpStatus === undefined ? "not observed" : lastRequest.httpStatus}`
        : "OpenAI-reported tier: unverified; no OpenAI request observed in this runtime";
      ctx.ui.notify(`Fast mode: ${enabled ? "ON" : "OFF"} (persistent)\nEffective source: ${snapshot.sources.enabled}\nNext request: ${nextRequest}\n${observation}\nPreference file: ${preferences.path}\nProject file: ${snapshot.targets.project}${snapshot.projectTrusted ? "" : " (ignored: untrusted)"}`, "info");
    },
  });
  pi.on("session_start", () => { settings.dispose(); settings = new ScopedSettingsView(); });
  pi.on("session_tree", () => { settings.dispose(); settings = new ScopedSettingsView(); });
  pi.on("session_shutdown", () => settings.dispose());
  pi.on("before_provider_request", (event, ctx) => {
    const model = ctx.model;
    if (!model) throw new Error("OpenAI fast mode requires a selected model");
    if (!isOpenAI(model.provider)) return;
    lastRequest = undefined;
    if (typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) throw new Error("OpenAI fast mode requires an object request payload");
    const requestedTier: ServiceTier = configuration.read(ctx).values.enabled ? "priority" : "default";
    lastRequest = { provider: model.provider, model: model.id, requestedTier, reportedTier: undefined, httpStatus: undefined };
    return { ...event.payload, service_tier: requestedTier };
  });
  pi.on("after_provider_response", (event, ctx) => {
    const model = ctx.model;
    if (lastRequest && model && model.provider === lastRequest.provider && model.id === lastRequest.model) lastRequest.httpStatus = event.status;
  });
  pi.on("provider_stream_event", event => {
    if (!lastRequest || event.provider !== lastRequest.provider || event.model !== lastRequest.model) return;
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    if ("type" in data && (data.type === "response.completed" || data.type === "response.incomplete")) {
      const response = "response" in data ? data.response : undefined;
      lastRequest.reportedTier = typeof response === "object" && response !== null && "service_tier" in response && typeof response.service_tier === "string" ? response.service_tier : undefined;
    } else if ("object" in data && data.object === "chat.completion.chunk" && "service_tier" in data && typeof data.service_tier === "string") lastRequest.reportedTier = data.service_tier;
  });
}

export default function (pi: ExtensionAPI): void { registerFastMode(pi, new FilePreferenceStore(join(getAgentDir(), PREFERENCE_FILENAME))); }
