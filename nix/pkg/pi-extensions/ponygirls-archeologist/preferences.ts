import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { CONFIG_DIR_NAME, ProjectTrustStore, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ScopedSettingsController, applyScopedSettingsChanges, readJsonPreferences, resolveScopedSettingsValues, scopedBooleanField, writeJsonPreferences, type ScopedSettingChange, type ScopedSettingsScope, type ScopedSettingsSnapshot } from "@ponygirls/pi-settings";
import { DISCOVERY_KEYS, DISCOVERY_OFF, type Discovery } from "../context-rules/rules.ts";

const KEYS = ["mainNested", ...DISCOVERY_KEYS] as const;
type Preferences = Discovery & { mainNested: boolean };
export const ALL_OFF: Readonly<Preferences> = Object.freeze({ mainNested: false, ...DISCOVERY_OFF });
const FILE = "archeologist.json";
const ENTRY = "archeologist.preferences";
export const discoveryFields = {
  mainNested: scopedBooleanField("Main: auto-discover nested AGENTS.md", "Discover instructions after successful file access below the main working directory."),
  nested: scopedBooleanField("Subagents: auto-discover nested AGENTS.md", "Discover rules when a subagent accesses a path below its working directory."),
  worktree: scopedBooleanField("Subagents: worktree AGENTS.md", "Load rules from the subagent checkout and allow explicitly named local instruction files."),
  parent: scopedBooleanField("Subagents: project AGENTS.md", "Use the direct parent's loaded project rules."),
  global: scopedBooleanField("Subagents: global AGENTS.md", "Use the Pi agent directory's instruction file."),
};

type Context = Pick<ExtensionContext, "cwd" | "sessionManager" | "isProjectTrusted">;
function decode(raw: unknown): Partial<Preferences> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || !("version" in raw) || raw.version !== 1) throw new Error("Invalid Archeologist preferences version");
  const values: Partial<Preferences> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "version") continue;
    if (!KEYS.some(k => k === key) || typeof value !== "boolean") throw new Error(`Invalid Archeologist preference: ${key}`);
    values[key as keyof Preferences] = value;
  }
  return values;
}
function read(path: string): Partial<Preferences> {
  return readJsonPreferences(path, () => ({}), decode, "Archeologist preferences");
}
function projectScope(cwd: string, agentDir: string) {
  const dir = join(realpathSync(cwd), CONFIG_DIR_NAME), path = join(dir, FILE);
  const project = lstatSync(dir, { bigint: true, throwIfNoEntry: false });
  const user = statSync(agentDir, { bigint: true });
  if (project && (!project.isDirectory() || (project.dev === user.dev && project.ino === user.ino))) return null;
  const file = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (file && (!file.isFile() || file.nlink !== 1n)) return null;
  const globalPath = join(agentDir, FILE);
  const global = statSync(globalPath, { bigint: true, throwIfNoEntry: false });
  if (global && file && global.dev === file.dev && global.ino === file.ino) return null;
  if (!global && lstatSync(globalPath, { throwIfNoEntry: false })?.isSymbolicLink()) return null;
  return { dir, path, project, file };
}

function projectOverrides(cwd: string, agentDir: string): Partial<Preferences> {
  const target = projectScope(cwd, agentDir);
  if (!target?.file) return {};
  const fd = openSync(target.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const current = fstatSync(fd, { bigint: true });
    if (current.dev !== target.file.dev || current.ino !== target.file.ino || current.nlink !== 1n || !projectScope(cwd, agentDir)) return {};
    try { return decode(JSON.parse(readFileSync(fd, "utf8"))); }
    catch (cause) { throw new Error(`Invalid Archeologist preferences in ${target.path}`, { cause }); }
  } finally { closeSync(fd); }
}

export class InstructionPreferences {
  private readonly agentDir: string;
  constructor(agentDir: string) { this.agentDir = resolve(agentDir); }

  snapshot(ctx: Context): ScopedSettingsSnapshot<Preferences> {
    const targets = { global: join(this.agentDir, FILE), project: join(ctx.cwd, CONFIG_DIR_NAME, FILE), session: ctx.sessionManager.getSessionId() };
    const projectTrusted = ctx.isProjectTrusted() === true && new ProjectTrustStore(this.agentDir).get(ctx.cwd) === true;
    let session: Partial<Preferences> = {};
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
      const data = entry.data as { sessionId?: unknown; values?: unknown } | null;
      if (!data || typeof data.sessionId !== "string") throw new Error("Invalid Archeologist session preference");
      if (data.sessionId === targets.session) session = decode(data.values);
    }
    return { targets, defaults: ALL_OFF, managed: read(join(this.agentDir, "archeologist-defaults.json")), global: read(targets.global), project: projectTrusted ? projectOverrides(ctx.cwd, this.agentDir) : {}, projectTrusted, session };
  }

  effective(ctx: Context): Preferences {
    return resolveScopedSettingsValues(discoveryFields, KEYS, this.snapshot(ctx), "session");
  }

  controller(pi: Pick<ExtensionAPI, "appendEntry">, ctx: Context, available: () => boolean): ScopedSettingsController<Preferences> {
    return new ScopedSettingsController({
      fields: discoveryFields, order: KEYS,
      inactive: () => "",
      adapter: {
        read: () => this.snapshot(ctx),
        apply: (scope, changes, signal) => {
          signal.throwIfAborted();
          if (changes.some(c => c.key !== "mainNested") && !available()) throw new Error("ponygirls-subagents unavailable");
          this.apply(pi, ctx, scope, changes);
        },
        applied: () => {},
      },
    });
  }

  apply(pi: Pick<ExtensionAPI, "appendEntry">, ctx: Context, scope: ScopedSettingsScope, changes: readonly ScopedSettingChange<Preferences>[]): void {
    const snapshot = this.snapshot(ctx);
    if (scope === "project" && !snapshot.projectTrusted) throw new Error("Project settings require a trusted project");
    const values = { version: 1, ...applyScopedSettingsChanges(discoveryFields, KEYS, snapshot[scope], changes) };
    if (scope === "session") pi.appendEntry(ENTRY, { sessionId: snapshot.targets.session, values });
    else if (scope === "global") writeJsonPreferences(snapshot.targets.global, values);
    else {
      const target = projectScope(ctx.cwd, this.agentDir);
      if (!target) throw new Error("Project settings must be a distinct file in a real project .pi directory");
      if (!target.project) mkdirSync(target.dir, { mode: 0o700 });
      const current = projectScope(ctx.cwd, this.agentDir);
      if (!current?.project || current.dir !== target.dir || !ctx.isProjectTrusted() || new ProjectTrustStore(this.agentDir).get(ctx.cwd) !== true) throw new Error("Project settings target changed before saving");
      execFileSync(process.execPath, [fileURLToPath(new URL("./project-preference-write.mjs", import.meta.url)), this.agentDir, FILE, String(current.project.dev), String(current.project.ino)], {
        cwd: current.dir, env: {}, input: JSON.stringify(values), stdio: ["pipe", "pipe", "pipe"], timeout: 5000,
      });
    }
  }
}
