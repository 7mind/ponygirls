export type CgCommand =
  | { name: "help" }
  | { name: "status" | "sync" | "reindex" | "cancel"; target: string | null; all: boolean }
  | { name: "discover"; target: string | null }
  | { name: "use" | "erase" | "init"; target: string };

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
  if (match === null) return { name: "help" };
  const name = match[1]!;
  const rest = match[2] === undefined ? "" : match[2].trim();
  if (name === "help" && rest === "") return { name: "help" };
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

const CG_COMMANDS = [
  { name: "status", syntax: "[PATH | --all]", description: "last-checked health and logical index bytes (including WAL/SHM)" },
  { name: "discover", syntax: "[PATH]", description: "list containing checkout or immediate child checkouts; no indexing" },
  { name: "use", syntax: "PATH", description: "select default query scope without indexing" },
  { name: "sync", syntax: "[PATH | --all]", description: "initialize or incrementally synchronize" },
  { name: "reindex", syntax: "[PATH]", description: "full rebuild" },
  { name: "cancel", syntax: "[PATH | --all]", description: "stop extension work only; MCP watcher unchanged" },
  { name: "init", syntax: "--workspace PATH", description: "opt in to one non-Git workspace-wide index" },
  { name: "erase", syntax: "PATH", description: "explain safe offline removal; online deletion is refused" },
  { name: "help", syntax: "", description: "show command syntax and path rules" },
] as const;

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

/**
 * Directory completions for an unquoted path argument: `head` is the already
 * typed command text kept in front of the path (pi replaces the whole argument).
 * Hidden directories appear only once their leading dot is typed.
 */
function directoryCompletions(head: string, path: string, directories: DirectoryLister): CommandCompletion[] {
  if (path.startsWith('"') || path.startsWith("'") || path.startsWith("-")) return [];
  const slash = path.lastIndexOf("/");
  const parent = path.slice(0, slash + 1);
  const base = path.slice(slash + 1);
  const names = directories(parent === "" ? "." : parent);
  if (names === null) return [];
  return names
    .filter((name) => name.startsWith(base) && (base.startsWith(".") || !name.startsWith(".")))
    .sort()
    .slice(0, MAX_DIRECTORY_COMPLETIONS)
    .map((name) => ({ value: `${head}${parent}${name}/`, label: `${name}/`, description: "directory" }));
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
