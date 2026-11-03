import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { validateThresholds, type ArchiveThresholds } from "./preferences.ts";

export const SESSION_SETTING_TYPE = "ponygirls.context-archive.setting";
export const SESSION_THRESHOLDS_TYPE = "ponygirls.context-archive.thresholds";

export interface SessionOverrides {
  enabled: boolean | null;
  thresholds: ArchiveThresholds | null;
}

export function sessionOverrides(entries: SessionEntry[], sessionId: string): SessionOverrides {
  const overrides: SessionOverrides = { enabled: null, thresholds: null };
  let haveEnabled = false;
  let haveThresholds = false;
  // Session settings span branches; copied records must not configure a different session ID.
  for (let i = entries.length - 1; i >= 0 && !(haveEnabled && haveThresholds); i--) {
    const entry = entries[i];
    if (entry.type !== "custom") continue;
    const enabledSetting = entry.customType === SESSION_SETTING_TYPE && !haveEnabled;
    const thresholdSetting = entry.customType === SESSION_THRESHOLDS_TYPE && !haveThresholds;
    if (!enabledSetting && !thresholdSetting) continue;
    const value: unknown = entry.data;
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        !("sessionId" in value) || typeof value.sessionId !== "string") {
      throw new Error("Invalid context archive session setting: missing sessionId");
    }
    if (value.sessionId !== sessionId) continue;
    if (!("version" in value) || value.version !== 1) throw new Error("Invalid context archive session setting: expected version 1");
    if (enabledSetting) {
      if (!("enabled" in value) || (value.enabled !== null && typeof value.enabled !== "boolean")) {
        throw new Error("Invalid context archive session setting: expected enabled:boolean|null");
      }
      overrides.enabled = value.enabled;
      haveEnabled = true;
    } else {
      if (!("thresholds" in value)) throw new Error("Invalid context archive session setting: expected thresholds:pair|null");
      overrides.thresholds = value.thresholds === null ? null : validateThresholds(value.thresholds);
      haveThresholds = true;
    }
  }
  return overrides;
}
