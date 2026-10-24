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

export const CG_HELP = [
  "/cg status [PATH | --all] — last-checked health and logical index bytes (including WAL/SHM)",
  "/cg discover [PATH] — list containing checkout or immediate child checkouts; no indexing",
  "/cg use PATH — select default query scope without indexing",
  "/cg sync [PATH | --all] — initialize or incrementally synchronize",
  "/cg reindex [PATH] — full rebuild",
  "/cg cancel [PATH | --all] — stop extension work only; MCP watcher unchanged",
  "/cg init --workspace PATH — opt in to one non-Git workspace-wide index",
  "/cg erase PATH — explain safe offline removal; online deletion is refused",
  "Paths are relative to Pi's cwd; quote paths or pass them literally, including spaces.",
  "The cg-status/sync/reindex/cancel aliases accept the same arguments.",
].join("\n");
