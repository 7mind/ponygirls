import { sessionEnabled, sessionSetting } from "@ponygirls/pi-settings";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { validateThresholds, type ArchiveThresholds } from "./preferences.ts";

export const SESSION_SETTING_TYPE = "ponygirls.context-archive.setting";
export const SESSION_THRESHOLDS_TYPE = "ponygirls.context-archive.thresholds";

export interface SessionOverrides {
  enabled: boolean | null;
  thresholds: ArchiveThresholds | null;
}

export function sessionOverrides(entries: readonly SessionEntry[], sessionId: string): SessionOverrides {
  return {
    enabled: sessionEnabled(entries, sessionId, SESSION_SETTING_TYPE),
    thresholds: sessionSetting(entries, sessionId, SESSION_THRESHOLDS_TYPE, (value) => {
      if (!("thresholds" in value)) throw new Error("Invalid context archive session setting: expected thresholds:pair|null");
      return value.thresholds === null ? null : validateThresholds(value.thresholds);
    }),
  };
}
