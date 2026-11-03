import { readJsonPreferences, writeJsonPreferences } from "@ponygirls/pi-settings";
import { DEFAULT_POLICY } from "./archive.ts";

export interface ArchiveThresholds {
  highWatermark: number;
  lowWatermark: number;
}
export interface ArchiveDefaults extends ArchiveThresholds {
  enabled: boolean;
}
export const DEFAULT_PREFERENCES: Readonly<ArchiveDefaults> = {
  enabled: false, highWatermark: DEFAULT_POLICY.highWatermark, lowWatermark: DEFAULT_POLICY.lowWatermark,
};

export function validateThresholds(value: unknown): ArchiveThresholds {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !("highWatermark" in value) || typeof value.highWatermark !== "number" || !Number.isFinite(value.highWatermark) ||
      !("lowWatermark" in value) || typeof value.lowWatermark !== "number" || !Number.isFinite(value.lowWatermark) ||
      value.lowWatermark < 0 || value.lowWatermark >= value.highWatermark || value.highWatermark > 1) {
    throw new Error("Expected finite watermarks 0 <= lowWatermark < highWatermark <= 1");
  }
  return { highWatermark: value.highWatermark, lowWatermark: value.lowWatermark };
}

export function validatePreferences(value: unknown): ArchiveDefaults {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !("enabled" in value) || typeof value.enabled !== "boolean") {
    throw new Error("Expected enabled:boolean in context archive defaults");
  }
  return { enabled: value.enabled, ...validateThresholds(value) };
}

export interface PreferenceStore {
  readonly path: string;
  read(): ArchiveDefaults;
  write(defaults: ArchiveDefaults): void;
}

export class FilePreferenceStore implements PreferenceStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }

  read(): ArchiveDefaults {
    return readJsonPreferences(this.path, () => ({ ...DEFAULT_PREFERENCES }), (value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value) || !("version" in value)) throw new Error("Missing defaults version");
      if (value.version === 1 && "enabled" in value && typeof value.enabled === "boolean") {
        return { ...DEFAULT_PREFERENCES, enabled: value.enabled };
      }
      if (value.version !== 2) throw new Error("Expected defaults version 1 or 2");
      return validatePreferences(value);
    }, "context archive defaults");
  }

  write(defaults: ArchiveDefaults): void {
    const validated = validatePreferences(defaults);
    writeJsonPreferences(this.path, { version: 2, ...validated });
  }
}
