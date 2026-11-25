import { lstat, realpath } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONFIG = fileURLToPath(new URL("./builtin.yml", import.meta.url));
const MAX_THREADS = 16;
const SCAN_TIMEOUT_MS = 15_000;
const WORKTREE_TIMEOUT_MS = 3_000;
const DIAGNOSTIC_TIMEOUT_MS = 2_000;
const MAX_RAW_BYTES = 1024 * 1024;
const MAX_HITS = 40;
const MAX_HIT_BYTES = 12 * 1024;
const MAX_SNIPPET_CHARS = 160;
const MAX_DIAGNOSTIC_CHARS = 800;
const EXCLUDED_DIRS = [".git", ".codegraph", ".worktrees"];
const FILE_SUMMARY = /^sg: summary\|file: scannedFileCount=(\d+),skippedFileCount=(\d+)\r?$/m;

type Exec = ExtensionAPI["exec"];
interface Binaries { astGrep: string; git: string }
interface Query { lang: string; pattern: string; path?: string; selector?: string }
interface Scope { cwd: string; checkout: string | null; target: string }
interface Match { file: string; text: string; range: { start: { line: number; column: number } } }

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

async function checkoutBoundary(cwd: string): Promise<string | null> {
  // A linked worktree's .git is a file. Only its location matters; never
  // resolve the metadata pointer, which can lead back to a different tree.
  for (let dir = cwd; ; dir = dirname(dir)) {
    try {
      await lstat(join(dir, ".git"));
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dir === dirname(dir)) return null;
  }
}

async function searchScope(caller: string, path: string | undefined): Promise<Scope> {
  const cwd = await realpath(caller);
  const checkout = await checkoutBoundary(cwd);
  const root = checkout ?? cwd;
  const exclude = (target: string) => {
    if (dirname(target) === target || relative(root, target).split(sep).some((part) => EXCLUDED_DIRS.includes(part))) {
      throw new Error("Cannot search filesystem root, Git or CodeGraph metadata, or the .worktrees directory.");
    }
  };
  const requested = resolve(cwd, path?.replace(/^@/, "") ?? ".");
  if (inside(root, requested)) exclude(requested);
  // Compare canonical paths so an absolute alias (e.g. /var on macOS) can
  // name files in this checkout, but a symlink to a sibling cannot escape it.
  const target = await realpath(requested);
  if (!inside(root, target)) throw new Error("Search path must stay inside the caller's checkout (or working directory outside Git).");
  exclude(target);
  const type = await lstat(target);
  if (!type.isDirectory() && !type.isFile()) throw new Error("Search path must be a regular file or directory.");
  return { cwd, checkout, target };
}

async function nestedWorktrees(exec: Exec, git: string, scope: Scope, signal: AbortSignal | undefined): Promise<string[]> {
  const root = scope.checkout;
  if (root === null) return [];
  const result = await exec(git, [`--git-dir=${join(root, ".git")}`, "worktree", "list", "--porcelain", "-z"], {
    cwd: root, signal, timeout: WORKTREE_TIMEOUT_MS, maxBuffer: MAX_RAW_BYTES,
  });
  signal?.throwIfAborted();
  if (result.code !== 0 || result.killed || result.truncated) throw new Error(`Cannot list Git worktrees: ${diagnostic(result.stderr) || "incomplete or failed Git command"}`);
  const worktrees = result.stdout.split("\0\0").filter((record) => record.startsWith("worktree "))
    .map((record) => record.slice("worktree ".length).split("\0", 1)[0]);
  if (!worktrees.includes(root)) throw new Error("Git worktree list did not identify the caller's checkout.");
  const nested = worktrees.filter((path) => path !== root && isAbsolute(path) && inside(root, path));
  if (nested.some((path) => inside(path, scope.target))) throw new Error("Search path is in a separate linked worktree. Start Pi there to search it.");
  return nested.filter((path) => inside(scope.target, path));
}

function excludeWorktree(root: string, path: string): string {
  // Anchor at the scan cwd. Escape names as literal gitignore patterns;
  // a final space would otherwise be trimmed by the glob parser.
  const pattern = relative(root, path).replace(/[\\*?{}\[\]]/g, "\\$&").replace(/ +$/, (spaces) => "[ ]".repeat(spaces.length));
  return `--globs=!/${pattern}`;
}

function clip(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function oneLine(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, (char) => `\\u{${char.codePointAt(0)!.toString(16)}}`);
}

function diagnostic(stderr: string): string {
  return clip(oneLine(stderr.split("\n").filter((line) => !line.startsWith("sg: summary|")).join(" ").trim()), MAX_DIAGNOSTIC_CHARS);
}

function parseMatches(stdout: string, incomplete: boolean, scope: Scope, nested: readonly string[]) {
  const records = stdout.split("\n");
  if (incomplete) records.pop(); // A capped stream may end mid-record.
  const hits: string[] = [];
  let count = 0;
  let bytes = 0;
  for (const record of records) {
    if (!record.trim()) continue;
    const match = JSON.parse(record) as Match | null;
    const start = match?.range?.start;
    if (typeof match?.file !== "string" || typeof match.text !== "string" || !start ||
        !Number.isSafeInteger(start.line) || start.line < 0 || !Number.isSafeInteger(start.column) || start.column < 0) {
      throw new Error("Unexpected ast-grep match record.");
    }
    const file = resolve(scope.checkout ?? scope.cwd, match.file);
    if (!inside(scope.target, file) || nested.some((path) => inside(path, file))) {
      throw new Error("ast-grep reported a match outside the requested scope.");
    }
    count++;
    if (hits.length < MAX_HITS) {
      const text = clip(oneLine(match.text), MAX_SNIPPET_CHARS);
      const line = `${oneLine(relative(scope.cwd, file))}:${start.line + 1}:${start.column + 1}: ${text}`;
      bytes += Buffer.byteLength(line, "utf8") + 1;
      if (bytes <= MAX_HIT_BYTES) hits.push(line);
    }
  }
  return { hits, count };
}

async function explainPattern(exec: Exec, binary: string, args: string[], cwd: string, signal: AbortSignal | undefined) {
  // Pi's exec closes stdin, so this parses the pattern without scanning twice.
  const result = await exec(binary, [...args, "--stdin", "--debug-query=pattern"], {
    cwd, signal, timeout: DIAGNOSTIC_TIMEOUT_MS, maxBuffer: MAX_RAW_BYTES,
  });
  signal?.throwIfAborted();
  return !result.killed && result.code === 1 ? /^Debug Pattern:\r?\n([^\r\n]+)/m.exec(result.stderr)?.[1] : undefined;
}

export async function search(exec: Exec, binaries: Binaries, caller: string, query: Query, signal: AbortSignal | undefined): Promise<string> {
  if (!query.pattern.trim()) throw new Error("Search pattern cannot be blank.");
  signal?.throwIfAborted();
  const scope = await searchScope(caller, query.path);
  signal?.throwIfAborted();
  const nested = await nestedWorktrees(exec, binaries.git, scope, signal);
  const root = scope.checkout ?? scope.cwd;
  const args = ["run", `--config=${CONFIG}`, "--custom-languages=ignore", "--color=never",
    `--threads=${Math.min(MAX_THREADS, availableParallelism())}`, `--lang=${query.lang}`, `--pattern=${query.pattern}`];
  if (query.selector !== undefined) args.push(`--selector=${query.selector}`);
  const result = await exec(binaries.astGrep, [
    ...args, "--json=stream", "--inspect=summary", ...EXCLUDED_DIRS.map((dir) => `--globs=!${dir}`),
    ...nested.map((path) => excludeWorktree(root, path)), "--", relative(root, scope.target) || ".",
  ], { cwd: root, signal, timeout: SCAN_TIMEOUT_MS, maxBuffer: MAX_RAW_BYTES });
  signal?.throwIfAborted();
  if (result.killed && !result.truncated) throw new Error("ast-grep timed out; narrow the search path.");
  const summary = FILE_SUMMARY.exec(result.stderr);
  const warning = diagnostic(result.stderr);
  if (!result.truncated && ((result.code !== 0 && result.code !== 1) || summary === null)) {
    throw new Error(`ast-grep failed (exit ${result.code}): ${warning || "missing scan summary"}`);
  }
  const { hits, count } = parseMatches(result.stdout, result.truncated, scope, nested);
  if (result.truncated && hits.length === 0) throw new Error("ast-grep reached its output limit before a complete hit; narrow the pattern or path.");
  if (!result.truncated && (result.code === 0) !== (count > 0)) throw new Error("ast-grep exit status and match records disagree.");

  const coverage = summary === null ? "file counts unavailable" : `CLI reports ${summary[1]} file(s) scanned, ${summary[2]} skipped`;
  const header = `${query.lang} in ${oneLine(scope.target)} — ${coverage}`;
  const warnings = warning ? [`ast-grep diagnostic: ${warning}`] : [];
  if (count > 0) {
    const shown = result.truncated ? `Output limit reached; scan incomplete. Showing ${hits.length} hits.`
      : hits.length < count ? `Showing ${hits.length} of ${count} matches; narrow the pattern or path for more.` : `${count} match(es).`;
    return [header, shown, ...hits, ...warnings].join("\n");
  }

  const kind = await explainPattern(exec, binaries.astGrep, args, root, signal);
  const hints = ["Check language and ignore rules; scan counts do not prove files parsed successfully. Cross-check with grep before concluding there are no usages."];
  if (/^(go|golang)$/i.test(query.lang) && kind === "type_conversion_expression") {
    hints.unshift("Go parsed the pattern as a type conversion. For a call, try a pattern such as func t() { pkg.Name($$$ARGS) } with selector call_expression.");
  }
  const parsed = kind === undefined ? "Parsed pattern unavailable." : `Parsed pattern: ${clip(oneLine(kind), MAX_DIAGNOSTIC_CHARS)}.`;
  return [header, "No syntactic matches.", parsed, ...hints, ...warnings].join("\n");
}
