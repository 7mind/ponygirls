import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { FileProjectTogglePreferenceStore, FileTogglePreferenceStore, SharedScopedToggleConfiguration,
  ScopedSettingsController, scopedBooleanField, type ScopedToggleSnapshot, type ToggleDefaults } from "@ponygirls/pi-settings";

const FILENAME = "codegraph.json";
const DEFAULT_ENABLED = true;
export const SETTINGS_TITLE = "Codegraph settings";
const LAUNCH_DISABLED = "Automatic work is off for this launch (SMIND_CODEGRAPH_DISABLED=1).";

export function codegraphSettings(pi: ExtensionAPI): SharedScopedToggleConfiguration {
  return new SharedScopedToggleConfiguration(pi, {
    defaultEnabled: DEFAULT_ENABLED, filename: FILENAME, projectDirectory: CONFIG_DIR_NAME,
    customType: "ponygirls.codegraph.setting", global: new FileTogglePreferenceStore(join(getAgentDir(), FILENAME), DEFAULT_ENABLED),
    projectStore: path => new FileProjectTogglePreferenceStore(path),
  });
}

export function policyText(snapshot: ScopedToggleSnapshot, launchDisabled: boolean): string {
  const value = snapshot.values.enabled ? "ON" : "OFF";
  return `Codegraph automatic preparation and routing: ${launchDisabled ? "OFF" : value} · ${snapshot.sources.enabled}` +
    (launchDisabled ? ` preference ${value}. ${LAUNCH_DISABLED}` : ".");
}

export function codegraphSettingsController(configuration: SharedScopedToggleConfiguration, ctx: ExtensionContext,
  launchDisabled: boolean, applied: () => void): ScopedSettingsController<ToggleDefaults> {
  return new ScopedSettingsController<ToggleDefaults>({
    fields: { enabled: scopedBooleanField("Automatic prep & routing", "Prepare indexes automatically and route MCP calls to the right checkout. Manual /cg commands and the separate MCP server remain available.") },
    order: ["enabled"],
    inactive: () => launchDisabled ? LAUNCH_DISABLED : "",
    adapter: {
      read: () => configuration.read(ctx),
      apply(scope, changes, signal) {
        const [change] = changes;
        if (changes.length !== 1 || change === undefined) throw new Error("Expected one Codegraph setting change");
        configuration.apply(ctx, scope, change.op === "inherit" ? null : change.value, signal);
      },
      applied,
    },
  });
}
