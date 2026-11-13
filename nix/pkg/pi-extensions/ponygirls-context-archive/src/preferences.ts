import { readJsonPreferences, writeJsonPreferences } from "@ponygirls/pi-settings";
import { DEFAULT_POLICY } from "./archive.ts";

export interface ArchiveThresholds {
  highWatermark: number;
  lowWatermark: number;
}
export interface ArchiveDefaults extends ArchiveThresholds {
  enabled: boolean;
}
export interface ArchiveValues { enabled: boolean; thresholds: ArchiveThresholds }
export interface ArchiveOverrides { enabled?: boolean; thresholds?: ArchiveThresholds }

export function validateOverrides(value: unknown): ArchiveOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected context archive override object");
  const result: ArchiveOverrides = {};
  for (const key of Object.keys(value)) if (key !== "enabled" && key !== "thresholds") throw new Error(`Unknown archive setting: ${key}`);
  if ("enabled" in value) {
    if (typeof value.enabled !== "boolean") throw new Error("Expected enabled:boolean");
    result.enabled = value.enabled;
  }
  if ("thresholds" in value) result.thresholds = validateThresholds(value.thresholds);
  return result;
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
  readOverrides(): ArchiveOverrides;
  writeOverrides(overrides: ArchiveOverrides): void;
}

export class FilePreferenceStore implements PreferenceStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }

  read(): ArchiveDefaults {
    const overrides = this.readOverrides();
    return { enabled: overrides.enabled === undefined ? DEFAULT_PREFERENCES.enabled : overrides.enabled,
      ...(overrides.thresholds === undefined ? validateThresholds(DEFAULT_PREFERENCES) : overrides.thresholds) };
  }

  readOverrides(): ArchiveOverrides {
    return readJsonPreferences(this.path, () => ({}), (value) => {
      if (typeof value !== "object" || value === null || Array.isArray(value) || !("version" in value)) throw new Error("Missing defaults version");
      if (value.version === 1 && "enabled" in value && typeof value.enabled === "boolean") {
        return { enabled: value.enabled };
      }
      if (value.version === 2) {
        const old = validatePreferences(value);
        return { enabled: old.enabled, thresholds: validateThresholds(old) };
      }
      if (value.version !== 3) throw new Error("Expected defaults version 1, 2 or 3");
      const { version: _version, ...overrides } = value;
      return validateOverrides(overrides);
    }, "context archive defaults");
  }

  write(defaults: ArchiveDefaults): void {
    const validated = validatePreferences(defaults);
    writeJsonPreferences(this.path, { version: 2, ...validated });
  }

  writeOverrides(overrides: ArchiveOverrides): void {
    writeJsonPreferences(this.path, { version: 3, ...validateOverrides(overrides) });
  }
}

export interface ArchiveProjectStore {
  readonly path: string;
  read(): ArchiveOverrides;
  write(value: ArchiveOverrides): void;
}

export class FileArchiveProjectStore implements ArchiveProjectStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }
  read(): ArchiveOverrides {
    return readJsonPreferences(this.path, () => ({}), value => {
      if (typeof value !== "object" || value === null || Array.isArray(value) || !("version" in value) || value.version !== 1) throw new Error("Invalid archive project settings version");
      const { version: _version, ...overrides } = value;
      return validateOverrides(overrides);
    }, "context archive project settings");
  }
  write(value: ArchiveOverrides): void { writeJsonPreferences(this.path, { version: 1, ...validateOverrides(value) }); }
}
