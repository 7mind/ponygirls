import { readJsonPreferences, writeJsonPreferences } from "./json-preferences.ts";

export interface ToggleDefaults {
  enabled: boolean;
}

export type ToggleOverrides = Partial<ToggleDefaults>;
export interface ToggleOverrideStore {
  readonly path: string;
  readOverrides(): ToggleOverrides;
  writeOverrides(value: ToggleOverrides): void;
}

export interface TogglePreferenceStore extends ToggleOverrideStore {
  read(): ToggleDefaults;
  write(defaults: ToggleDefaults): void;
}

function validateDefaults(value: unknown): ToggleDefaults {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !("enabled" in value) || typeof value.enabled !== "boolean") {
    throw new Error("Expected enabled:boolean in toggle defaults");
  }
  return { enabled: value.enabled };
}

export function validateToggleOverrides(value: unknown): ToggleOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected toggle overrides object");
  for (const key of Object.keys(value)) if (key !== "enabled") throw new Error(`Unknown toggle override: ${key}`);
  if (!("enabled" in value)) return {};
  if (typeof value.enabled !== "boolean") throw new Error("Expected enabled:boolean in toggle overrides");
  return { enabled: value.enabled };
}

export class FileTogglePreferenceStore implements TogglePreferenceStore {
  readonly path: string;
  private readonly defaultEnabled: boolean;

  constructor(path: string, defaultEnabled: boolean) {
    this.path = path;
    this.defaultEnabled = defaultEnabled;
  }

  read(): ToggleDefaults {
    const overrides = this.readOverrides();
    return { enabled: overrides.enabled === undefined ? this.defaultEnabled : overrides.enabled };
  }

  readOverrides(): ToggleOverrides {
    return readJsonPreferences(this.path, () => ({}), value => {
      if (typeof value !== "object" || value === null || Array.isArray(value) || !("version" in value)) throw new Error("Expected defaults version 1 or 2");
      if (value.version === 1) return validateDefaults(value);
      if (value.version !== 2) throw new Error("Expected defaults version 1 or 2");
      const { version: _version, ...overrides } = value;
      return validateToggleOverrides(overrides);
    }, "toggle defaults");
  }

  writeOverrides(overrides: ToggleOverrides): void {
    writeJsonPreferences(this.path, { version: 2, ...validateToggleOverrides(overrides) });
  }

  write(defaults: ToggleDefaults): void {
    const validated = validateDefaults(defaults);
    writeJsonPreferences(this.path, { version: 1, ...validated });
  }
}

export const TOGGLE_ARGUMENTS = ["on", "off", "inherit", "default on", "default off", "status"] as const;

export type ToggleCommand = { kind: "session"; enabled: boolean | null } | { kind: "default"; enabled: boolean } | { kind: "status" };

export function parseToggleCommand(args: string): ToggleCommand | null {
  const words = args.trim().toLowerCase().split(/\s+/);
  if (words.length === 1) {
    switch (words[0]) {
      case "on": return { kind: "session", enabled: true };
      case "off": return { kind: "session", enabled: false };
      case "inherit": return { kind: "session", enabled: null };
      case "": case "status": return { kind: "status" };
    }
  }
  if (words.length === 2 && words[0] === "default" && (words[1] === "on" || words[1] === "off")) {
    return { kind: "default", enabled: words[1] === "on" };
  }
  return null;
}
