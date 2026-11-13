import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { validateThresholds, type ArchiveThresholds, type ArchiveOverrides } from "./preferences.ts";

export const SESSION_SETTING_TYPE = "ponygirls.context-archive.setting";
export const SESSION_THRESHOLDS_TYPE = "ponygirls.context-archive.thresholds";
export const SESSION_PREFERENCES_TYPE = "ponygirls.context-archive.preferences";

export interface SessionOverrides { enabled: boolean | null; thresholds: ArchiveThresholds | null }
export type ArchiveSettingChange =
  | { readonly key: "enabled"; readonly op: "set"; readonly value: boolean }
  | { readonly key: "thresholds"; readonly op: "set"; readonly value: ArchiveThresholds }
  | { readonly key: "enabled" | "thresholds"; readonly op: "inherit" };

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid context archive session setting");
  return value as Record<string, unknown>;
}

export function validateArchiveChanges(value: unknown): readonly ArchiveSettingChange[] {
  if (!Array.isArray(value) || value.length > 2) throw new Error("Invalid archive changes");
  const seen = new Set<string>();
  return value.map(raw => {
    const change = object(raw);
    if ((change.key !== "enabled" && change.key !== "thresholds") || seen.has(change.key)) throw new Error("Invalid or duplicate archive setting");
    seen.add(change.key);
    const allowed = change.op === "inherit" ? ["key", "op"] : ["key", "op", "value"];
    for (const key of Object.keys(change)) if (!allowed.includes(key)) throw new Error(`Unknown archive change field: ${key}`);
    if (change.op === "inherit") return { key: change.key, op: "inherit" };
    if (change.op !== "set") throw new Error("Invalid archive setting operation");
    if (change.key === "thresholds") return { key: "thresholds", op: "set", value: validateThresholds(change.value) };
    if (typeof change.value !== "boolean") throw new Error("Invalid archive enabled value");
    return { key: "enabled", op: "set", value: change.value };
  });
}

export function applyArchiveChanges(before: ArchiveOverrides, changes: readonly ArchiveSettingChange[]): ArchiveOverrides {
  const result = { ...before };
  for (const change of validateArchiveChanges(changes)) {
    if (change.op === "inherit") delete result[change.key];
    else if (change.key === "enabled") result.enabled = change.value;
    else result.thresholds = change.value;
  }
  return result;
}

export function sessionOverrideFields(entries: readonly SessionEntry[], sessionId: string): ArchiveOverrides {
  const result: ArchiveOverrides = {}; const seen = new Set<string>();
  const accept = (key: "enabled" | "thresholds", value: unknown): void => {
    if (seen.has(key)) return;
    if (value !== null) {
      if (key === "enabled") {
        if (typeof value !== "boolean") throw new Error("Invalid context archive session setting: enabled must be boolean");
        result.enabled = value;
      } else result.thresholds = validateThresholds(value);
    }
    seen.add(key);
  };
  for (let i = entries.length - 1; i >= 0 && seen.size < 2; i--) {
    const entry = entries[i];
    if (entry.type !== "custom" || ![SESSION_SETTING_TYPE, SESSION_THRESHOLDS_TYPE, SESSION_PREFERENCES_TYPE].includes(entry.customType)) continue;
    const key = entry.customType === SESSION_SETTING_TYPE ? "enabled" : entry.customType === SESSION_THRESHOLDS_TYPE ? "thresholds" : null;
    if (key !== null && seen.has(key)) continue;
    const data = object(entry.data);
    if (typeof data.sessionId !== "string") throw new Error("Invalid archive session setting: missing sessionId");
    if (data.sessionId !== sessionId) continue;
    if (data.version !== 1) throw new Error("Invalid archive session setting: expected version 1");
    if (key !== null) { accept(key, data[key]); continue; }
    if (!Array.isArray(data.changes) || data.changes.length > 2) throw new Error("Invalid archive session changes");
    const batch = new Set<string>();
    for (const raw of data.changes) {
      const change = object(raw);
      if ((change.key !== "enabled" && change.key !== "thresholds") || batch.has(change.key)) throw new Error("Invalid or duplicate archive session field");
      batch.add(change.key);
      if (seen.has(change.key)) continue;
      const validated = validateArchiveChanges([change])[0];
      accept(validated.key, validated.op === "inherit" ? null : validated.value);
    }
  }
  return result;
}

export function sessionOverrides(entries: readonly SessionEntry[], sessionId: string): SessionOverrides {
  const result = sessionOverrideFields(entries, sessionId);
  return { enabled: result.enabled === undefined ? null : result.enabled, thresholds: result.thresholds === undefined ? null : result.thresholds };
}
