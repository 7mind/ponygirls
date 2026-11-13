import { join } from "node:path";
import { resolveScopedSetting, type ScopedSettingsOrigin } from "./scoped-settings.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  readJsonPreferences,
  writeJsonPreferences,
} from "./json-preferences.ts";
import {
  sessionEnabled,
  sessionEnabledData,
} from "./session-settings.ts";
import {
  validateToggleOverrides,
  type ToggleDefaults,
  type ToggleOverrides,
  type ToggleOverrideStore,
} from "./toggle.ts";

export type ScopedToggleScope =
  | "global"
  | "project"
  | "session";

export type ScopedToggleSource = ScopedSettingsOrigin;

export type ScopedToggleContext = Pick<
  ExtensionContext,
  "cwd" | "isProjectTrusted" | "sessionManager"
>;

export interface ScopedToggleSnapshot {
  readonly values: ToggleDefaults;
  readonly sources: Readonly<{
    enabled: ScopedToggleSource;
  }>;

  readonly defaults: ToggleDefaults;
  readonly managed: ToggleOverrides;
  readonly global: ToggleOverrides;
  readonly project: ToggleOverrides;
  readonly session: ToggleOverrides;

  readonly projectTrusted: boolean;
  readonly targets: Readonly<
    Record<ScopedToggleScope, string>
  >;
}

/**
 * Project files have their own version-1 sparse schema.
 * This is different from legacy global version-1 full defaults.
 */
export class FileProjectTogglePreferenceStore
implements ToggleOverrideStore {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  readOverrides(): ToggleOverrides {
    return readJsonPreferences(
      this.path,
      () => ({}),
      value => {
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value) ||
          !("version" in value) ||
          value.version !== 1
        ) {
          throw new Error("Expected project toggle version 1");
        }

        const { version: _version, ...overrides } = value;
        return validateToggleOverrides(overrides);
      },
      "project toggle preferences",
    );
  }

  writeOverrides(value: ToggleOverrides): void {
    writeJsonPreferences(this.path, {
      version: 1,
      ...validateToggleOverrides(value),
    });
  }
}

export interface ScopedToggleOptions {
  readonly defaultEnabled: boolean;
  readonly filename: string;
  readonly projectDirectory: string;
  readonly customType: string;
  readonly global: ToggleOverrideStore;
  readonly projectStore:
    (path: string) => ToggleOverrideStore;
}

export class SharedScopedToggleConfiguration {
  private readonly pi:
    Pick<ExtensionAPI, "appendEntry">;
  private readonly options: ScopedToggleOptions;

  constructor(
    pi: Pick<ExtensionAPI, "appendEntry">,
    options: ScopedToggleOptions,
  ) {
    this.pi = pi;
    this.options = options;
  }

  private projectPath(ctx: ScopedToggleContext): string {
    return join(
      ctx.cwd,
      this.options.projectDirectory,
      this.options.filename,
    );
  }

  read(ctx: ScopedToggleContext): ScopedToggleSnapshot {
    const defaults: ToggleDefaults = {
      enabled: this.options.defaultEnabled,
    };

    // Invalid global settings remain faults, even with session ON.
    const global = validateToggleOverrides(
      this.options.global.readOverrides(),
    );

    const path = this.projectPath(ctx);
    const projectTrusted = ctx.isProjectTrusted();

    // Never open an untrusted project settings file.
    const project: ToggleOverrides = projectTrusted
      ? validateToggleOverrides(
        this.options.projectStore(path).readOverrides(),
      )
      : {};

    const sessionId =
      ctx.sessionManager.getSessionId();

    const enabled = sessionEnabled(
      ctx.sessionManager.getEntries(),
      sessionId,
      this.options.customType,
    );

    const session: ToggleOverrides =
      enabled === null ? {} : { enabled };

    const snapshot = {
      defaults, managed: {}, global, project, session, projectTrusted,
      targets: { global: this.options.global.path, project: path, session: sessionId },
    };
    const resolved = resolveScopedSetting(snapshot, "enabled", "effective");
    return { ...snapshot, values: { enabled: resolved.value }, sources: { enabled: resolved.origin } };
  }

  apply(
    ctx: ScopedToggleContext,
    scope: ScopedToggleScope,
    value: boolean | null,
    signal: AbortSignal,
  ): void {
    const sessionId = ctx.sessionManager.getSessionId();
    const cwd = ctx.cwd;
    const current = (): void => {
      signal.throwIfAborted();
      if (ctx.sessionManager.getSessionId() !== sessionId || ctx.cwd !== cwd) throw new Error("Settings target changed");
    };
    current();
    if (
      scope !== "global" &&
      scope !== "project" &&
      scope !== "session"
    ) {
      throw new Error("Invalid toggle scope");
    }

    if (
      value !== null &&
      typeof value !== "boolean"
    ) {
      throw new Error("Expected boolean or inherit");
    }

    if (scope === "session") {
      current();
      this.pi.appendEntry(
        this.options.customType,
        sessionEnabledData(
          sessionId,
          value,
        ),
      );
      return;
    }

    if (
      scope === "project" &&
      !ctx.isProjectTrusted()
    ) {
      throw new Error(
        "Project settings require a trusted project",
      );
    }

    const store = scope === "global"
      ? this.options.global
      : this.options.projectStore(
        this.projectPath(ctx),
      );

    // Read fresh rather than modifying the dialog's old snapshot.
    const next = validateToggleOverrides(
      store.readOverrides(),
    );

    if (value === null) delete next.enabled;
    else next.enabled = value;

    // Keep authorization inside configuration, not inside the TUI.
    if (
      scope === "project" &&
      !ctx.isProjectTrusted()
    ) {
      throw new Error(
        "Project settings require a trusted project",
      );
    }

    current();
    store.writeOverrides(next);
  }
}

export interface ScopedToggleCommand {
  readonly scope: ScopedToggleScope;
  readonly enabled: boolean | null;
}

/**
 * Explicit scope grammar only. Existing unscoped commands remain
 * extension-owned so Fast can preserve its global on/off semantics.
 */
export function parseScopedToggleCommand(
  args: string,
): ScopedToggleCommand | null {
  const words = args.trim().toLowerCase().split(/\s+/);

  if (words.length !== 2) return null;

  const scope = words[0];
  if (
    scope !== "global" &&
    scope !== "project" &&
    scope !== "session"
  ) {
    return null;
  }

  const action = words[1];
  if (action === "on") {
    return { scope, enabled: true };
  }
  if (action === "off") {
    return { scope, enabled: false };
  }
  if (action === "inherit") {
    return { scope, enabled: null };
  }

  return null;
}
