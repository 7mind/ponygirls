import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const SESSION_SETTING_TYPE = "ponygirls.context-archive.setting";

export function sessionOverride(entries: SessionEntry[], sessionId: string): boolean | null {
  // Session settings span branches; copied records must not configure a different session ID.
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== SESSION_SETTING_TYPE) continue;
    const value: unknown = entry.data;
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        !("sessionId" in value) || typeof value.sessionId !== "string") {
      throw new Error("Invalid context archive session setting: missing sessionId");
    }
    if (value.sessionId !== sessionId) continue;
    if (!("version" in value) || value.version !== 1 || !("enabled" in value) ||
        (value.enabled !== null && typeof value.enabled !== "boolean")) {
      throw new Error("Invalid context archive session setting: expected version 1 and enabled:boolean|null");
    }
    return value.enabled;
  }
  return null;
}
