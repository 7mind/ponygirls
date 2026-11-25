import { SCOPED_SETTINGS_SCOPES, parseScopedToggleCommand, parseToggleCommand, type ScopedToggleCommand } from "@ponygirls/pi-settings";

export type WorkspaceCommand =
  | { name: "status" | "sync" | "reindex" | "cancel"; target: string | null; all: boolean }
  | { name: "discover"; target: string | null }
  | { name: "use" | "erase" | "init"; target: string };

export type CgCommand = WorkspaceCommand | { name: "help" } | { name: "settings" } | ({ name: "toggle" } & ScopedToggleCommand);

function pathArgument(text: string): string {
  let path = text.trim();
  if (path.startsWith("-- ")) path = path.slice(3).trim();
  else if (path.startsWith("--")) throw new Error(`Unexpected option: ${path}`);
  if (path.startsWith('"')) path = JSON.parse(path) as string;
  else if (path.startsWith("'")) {
    if (!path.endsWith("'") || path.length < 2) throw new Error("Unterminated quoted path");
    path = path.slice(1, -1);
  }
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) throw new Error("A nonempty path is required");
  return path;
}

export function parseCommand(args: string): CgCommand {
  const match = args.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  // Bare `/cg` shows the status; `/cg help` prints the reference.
  if (match === null) return { name: "status", target: null, all: false };
  const name = match[1]!;
  const rest = match[2] === undefined ? "" : match[2].trim();
  if ((name === "help" || name === "settings") && rest === "") return { name };
  const scoped = parseScopedToggleCommand(args);
  if (scoped !== null) return { name: "toggle", ...scoped };
  const toggle = parseToggleCommand(args);
  if (toggle?.kind === "session") return { name: "toggle", scope: "session", enabled: toggle.enabled };
  if (name === "status" || name === "sync" || name === "reindex" || name === "cancel") {
    if (rest === "--all" && name !== "reindex") return { name, target: null, all: true };
    return { name, target: rest === "" ? null : pathArgument(rest), all: false };
  }
  if (name === "discover") return { name, target: rest === "" ? null : pathArgument(rest) };
  if (name === "use" || name === "erase") return { name, target: pathArgument(rest) };
  if (name === "init" && rest.startsWith("--workspace ")) {
    return { name, target: pathArgument(rest.slice("--workspace ".length)) };
  }
  throw new Error("Usage: /cg help — workspace creation requires /cg init --workspace PATH");
}

const TOGGLE_ACTIONS = [
  { name: "on", syntax: "", description: "enable automatic preparation and routing" },
  { name: "off", syntax: "", description: "disable automatic preparation and routing" },
  { name: "inherit", syntax: "", description: "remove the override in this scope" },
];

const CG_COMMANDS = [
  { name: "status", syntax: "[PATH | --all]", description: "last-checked health and logical index bytes (including WAL/SHM)" },
  { name: "discover", syntax: "[PATH]", description: "list containing checkout or immediate child checkouts; no indexing" },
  { name: "use", syntax: "PATH", description: "select default query scope without indexing" },
  { name: "sync", syntax: "[PATH | --all]", description: "initialize or incrementally synchronize" },
  { name: "reindex", syntax: "[PATH]", description: "full rebuild" },
  { name: "cancel", syntax: "[PATH | --all]", description: "stop extension work only; MCP watcher unchanged" },
  { name: "init", syntax: "--workspace PATH", description: "opt in to one non-Git workspace-wide index" },
  { name: "erase", syntax: "PATH", description: "explain safe offline removal; online deletion is refused" },
  { name: "settings", syntax: "", description: "open scoped settings for automatic preparation and routing" },
  ...TOGGLE_ACTIONS.map(action => ({ ...action, description: `${action.description} (session)` })),
  ...SCOPED_SETTINGS_SCOPES.map(name => ({ name, syntax: "on|off|inherit", description: `set or clear the ${name} preference` })),
  { name: "help", syntax: "", description: "show command syntax and path rules" },
];

interface CommandCompletion {
  value: string;
  label: string;
  description: string;
}

/** Subdirectory names of a cwd-relative or absolute directory, or null when it cannot be listed. */
export type DirectoryLister = (directory: string) => readonly string[] | null;

/** Most directory suggestions offered at once. */
const MAX_DIRECTORY_COMPLETIONS = 50;

const PATH_TAKING = new Set(["status", "discover", "use", "sync", "reindex", "cancel", "erase"]);
const ALL_FLAG = new Set(["status", "sync", "cancel"]);
const ALL_COMPLETION = { label: "--all", description: "target all discovered projects" };
const WORKSPACE_FLAG = "--workspace";

/** Pi replaces the whole argument; preserve quoting and any explicit option terminator. */
function directoryCompletions(head: string, path: string, directories: DirectoryLister): CommandCompletion[] {
  const literal = path.startsWith("-- ");
  if (literal) { head += "-- "; path = path.slice(3).trimStart(); }
  const quote = path.startsWith('"') ? '"' : path.startsWith("'") ? "'" : null;
  if (quote === '"') {
    try { path = JSON.parse(path.endsWith('"') && path.length > 1 ? path : `${path}"`) as string; }
    catch { return []; }
  } else if (quote === "'") {
    path = path.slice(1);
    if (path.endsWith("'")) path = path.slice(0, -1);
  } else if (!literal && path.startsWith("-")) return [];
  const slash = path.lastIndexOf("/");
  const parent = path.slice(0, slash + 1);
  const base = path.slice(slash + 1);
  const names = directories(parent === "" ? "." : parent);
  if (names === null) return [];
  return names
    .filter((name) => name.startsWith(base) && (base.startsWith(".") || !name.startsWith(".")))
    .sort()
    .slice(0, MAX_DIRECTORY_COMPLETIONS)
    .map((name) => {
      const target = `${parent}${name}/`;
      const encoded = quote === "'" && !target.includes("'") ? `'${target}'` :
        quote !== null || /^[\s"']/.test(target) || (!literal && target.startsWith("-")) ? JSON.stringify(target) : target;
      return { value: `${head}${encoded}`, label: `${name}/`, description: "directory" };
    });
}

export function completeCommand(prefix: string, directories: DirectoryLister): CommandCompletion[] | null {
  const text = prefix.trimStart();
  const separator = text.search(/\s/);
  if (separator === -1) {
    const items = CG_COMMANDS.filter((command) => command.name.startsWith(text)).map((command) => ({
      value: `${command.name} `,
      label: `${command.name} ${command.syntax}`.trimEnd(),
      description: command.description,
    }));
    return items.length === 0 ? null : items;
  }
  const name = text.slice(0, separator);
  const argument = text.slice(separator).trimStart();
  const items: CommandCompletion[] = [];
  if (name === "init") {
    if (argument.startsWith(`${WORKSPACE_FLAG} `)) {
      const path = argument.slice(WORKSPACE_FLAG.length + 1).trimStart();
      items.push(...directoryCompletions(`init ${WORKSPACE_FLAG} `, path, directories));
    } else if (WORKSPACE_FLAG.startsWith(argument)) {
      items.push({ value: `init ${WORKSPACE_FLAG} `, label: `${WORKSPACE_FLAG} PATH`, description: "explicitly opt in to a non-Git workspace" });
    }
  } else if (SCOPED_SETTINGS_SCOPES.some(scope => scope === name)) {
    items.push(...TOGGLE_ACTIONS.filter(action => action.name.startsWith(argument)).map(action => ({
      value: `${name} ${action.name}`, label: action.name, description: action.description,
    })));
  } else if (PATH_TAKING.has(name)) {
    if (ALL_FLAG.has(name) && "--all".startsWith(argument)) items.push({ value: `${name} --all`, ...ALL_COMPLETION });
    items.push(...directoryCompletions(`${name} `, argument, directories));
  }
  return items.length === 0 ? null : items;
}

export const CG_HELP = [
  ...CG_COMMANDS.map((command) => `/cg ${command.name} ${command.syntax}`.trimEnd() + ` — ${command.description}`),
  "Paths are relative to Pi's cwd; quote paths or pass them literally, including spaces.",
].join("\n");
