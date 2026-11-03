import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export function sessionSetting<T>(entries: readonly SessionEntry[], sessionId: string, customType: string, validate: (value: object) => T): T | null {
  // Session settings span branches; copied records must not configure a different session ID.
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || entry.customType !== customType) continue;
    const value: unknown = entry.data;
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        !("sessionId" in value) || typeof value.sessionId !== "string") {
      throw new Error("Invalid session setting: missing sessionId");
    }
    if (value.sessionId !== sessionId) continue;
    if (!("version" in value) || value.version !== 1) throw new Error("Invalid session setting: expected version 1");
    return validate(value);
  }
  return null;
}

export function sessionEnabled(entries: readonly SessionEntry[], sessionId: string, customType: string): boolean | null {
  return sessionSetting(entries, sessionId, customType, (value) => {
    if (!("enabled" in value) || (value.enabled !== null && typeof value.enabled !== "boolean")) {
      throw new Error("Invalid session setting: expected enabled:boolean|null");
    }
    return value.enabled;
  });
}

export function sessionEnabledData(sessionId: string, enabled: boolean | null): { version: 1; sessionId: string; enabled: boolean | null } {
  return { version: 1, sessionId, enabled };
}
