import { lstat, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONFIG = fileURLToPath(new URL("./builtin.yml", import.meta.url));
const MAX_THREADS = 16;
const SCAN_TIMEOUT_MS = 15_000;
const SCAN_DEADLINE = `${SCAN_TIMEOUT_MS / 1000} s`;
const WORKTREE_TIMEOUT_MS = 3_000;
const DIAGNOSTIC_TIMEOUT_MS = 2_000;
const MAX_RAW_BYTES = 1024 * 1024;
const MAX_HITS = 40;
const MAX_HIT_BYTES = 12 * 1024;
const MAX_SNIPPET_CHARS = 160;
const MAX_DIAGNOSTIC_CHARS = 800;
const EXCLUDED_DIRS = [".git", ".codegraph", ".worktrees"];
const UNREAD = "empty, unreadable, not UTF-8 or too large";
const NOT_A_ZERO = "This is not a zero-match result";
// A file named as the path is read whatever the ignore rules say, so its name alone decides.
const NAME_ONLY = ["hidden", "dot", "exclude", "global", "parent", "vcs"].map((rule) => `--no-ignore=${rule}`);
// scannedFileCount counts the files ast-grep selected, including the ones it then skipped unread.
const FILE_SUMMARY = /^sg: summary\|file: scannedFileCount=(\d+),skippedFileCount=(\d+)\r?$/gm;
// With --inspect=entity ast-grep adds one record per file, after the file's path: the language
// it took from the file name, or why it did not read the file. A name that maps to no language
// gets no record.
const FILE_TRACE = /^(language|skipped)=(\w+)\r?$/;
const PATTERN_PARSE_WARNING = /^Warning: Pattern contains an ERROR node[^\r\n]*/gm;

type Exec = ExtensionAPI["exec"];
interface Binaries { astGrep: string; git: string }
interface Query { lang: string; pattern: string; path?: string; selector?: string }
interface Scope { cwd: string; checkout: string | null; target: string; file: boolean }
interface FileSummary { scanned: number; skipped: number }
interface FileTrace { kind: string; value: string }
interface ParsedPattern { kind: string; error: boolean }
/** What an empty result leaves unsaid: nothing was searched, or a named file may not have been. */
interface EmptyResult { unsearched?: string; caveat?: string }
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
  return { cwd, checkout, target, file: type.isFile() };
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
  // Git may list the main tree by its metadata directory and retain old paths
  // for linked trees. The list only identifies other trees to exclude.
  const nested = new Set<string>();
  for (const path of worktrees) {
    signal?.throwIfAborted();
    if (!isAbsolute(path)) continue;
    let canonical: string;
    try {
      canonical = await realpath(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      throw error;
    }
    if (canonical !== root && inside(root, canonical)) nested.add(canonical);
  }
  signal?.throwIfAborted();
  const excluded = [...nested];
  if (excluded.some((path) => inside(path, scope.target))) throw new Error("Search path is in a separate linked worktree. Start Pi there to search it.");
  return excluded.filter((path) => inside(scope.target, path));
}

function excludeWorktree(root: string, path: string): string {
  // Anchor at the scan cwd. Escape names as literal gitignore patterns;
  // a final space would otherwise be trimmed by the glob parser.
  const pattern = relative(root, path).replace(/[\\*?{}\[\]]/g, "\\$&").replace(/ +$/, (spaces) => "[ ]".repeat(spaces.length));
  return `--globs=!/${pattern}`;
}

function clip(value: string, length: number): string {
  if (value.length <= length) return value;
  // Never keep the first half of a surrogate pair: the result must stay well-formed.
  const end = (value.charCodeAt(length - 2) & 0xfc00) === 0xd800 ? length - 2 : length - 1;
  return `${value.slice(0, end)}…`;
}

function oneLine(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, (char) => `\\u{${char.codePointAt(0)!.toString(16)}}`);
}

function diagnostic(stderr: string): string {
  return clip(oneLine(stderr.split("\n").filter((line) => !line.startsWith("sg: summary|")).join(" ").trim()), MAX_DIAGNOSTIC_CHARS);
}

/**
 * ast-grep's own line of a kind is the last one: it reports on the run after the run. An error
 * line printed during the run names a path raw, and a path may hold text that reads like one.
 */
function lastLine(stderr: string, line: RegExp): RegExpMatchArray | undefined {
  return [...stderr.matchAll(line)].at(-1);
}

function fileSummary(stderr: string): FileSummary | undefined {
  const summary = lastLine(stderr, FILE_SUMMARY);
  return summary === undefined ? undefined : { scanned: Number(summary[1]), skipped: Number(summary[2]) };
}

/**
 * ast-grep's record about the one file it was given, and its stderr without that record. The
 * record repeats the path as given, and a file name may hold line breaks and text that reads
 * like ast-grep's own lines, so it is cut out whole before anything else is read from stderr.
 */
function fileTrace(stderr: string, path: string): { trace: FileTrace | undefined; rest: string } {
  const lead = `sg: entity|file|${path}: `;
  let start = stderr.indexOf(lead);
  while (start > 0 && stderr[start - 1] !== "\n") start = stderr.indexOf(lead, start + 1);
  if (start === -1) return { trace: undefined, rest: stderr };
  const lineEnd = stderr.indexOf("\n", start + lead.length);
  const end = lineEnd === -1 ? stderr.length : lineEnd;
  const report = FILE_TRACE.exec(stderr.slice(start + lead.length, end));
  return {
    trace: report === null ? undefined : { kind: report[1], value: report[2] },
    rest: stderr.slice(0, start) + stderr.slice(Math.min(end + 1, stderr.length)),
  };
}

/**
 * Whether ast-grep selects a file of this name for the language of `args`. Only ast-grep knows
 * its aliases and which languages a file can embed, so ask it about an empty file of that name
 * in a scratch directory outside the checkout. Undefined when it cannot be asked.
 */
async function nameSelected(exec: Exec, binary: string, args: string[], name: string, signal: AbortSignal | undefined): Promise<boolean | undefined> {
  let scratch: string | undefined;
  try {
    try {
      scratch = await mkdtemp(join(tmpdir(), "pi-ast-grep-"));
      await writeFile(join(scratch, name), "");
    } catch {
      return undefined; // No scratch file of that name: the caller reports what it knows, hedged.
    }
    const result = await exec(binary, [...args, "--inspect=summary", ...NAME_ONLY, "--", "."], {
      cwd: scratch, signal, timeout: DIAGNOSTIC_TIMEOUT_MS, maxBuffer: MAX_RAW_BYTES,
    });
    signal?.throwIfAborted();
    const summary = result.killed ? undefined : fileSummary(result.stderr);
    return summary === undefined ? undefined : summary.scanned !== 0;
  } finally {
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  }
}

async function emptyResult(
  exec: Exec, binary: string, args: string[], scope: Scope, lang: string,
  { scanned, skipped }: FileSummary, trace: FileTrace | undefined, signal: AbortSignal | undefined,
): Promise<EmptyResult> {
  if (!scope.file) {
    if (scanned === 0) return { unsearched: `No files searched: no file under this path is selected for ${lang} by its name after ignore rules. Recursive scans skip hidden directories unless one is named as the path. ${NOT_A_ZERO}.` };
    return skipped === scanned ? { unsearched: `No files searched: ast-grep skipped every selected file unread (${UNREAD}). ${NOT_A_ZERO}.` } : {};
  }
  // One named file is always counted as scanned, whatever its name: only the trace says what happened.
  if (skipped > 0) return { unsearched: `File not searched: ast-grep skipped it${trace?.kind === "skipped" ? ` (${trace.value})` : ""}. ${NOT_A_ZERO}.` };
  const read = trace?.kind === "language" ? trace.value : undefined;
  if (read?.toLowerCase() === lang.toLowerCase()) return {};
  const selected = await nameSelected(exec, binary, args, basename(scope.target), signal);
  if (selected === true) return {};
  if (selected === false) {
    return { unsearched: read === undefined
      ? `File not searched as ${lang}: its name maps to no built-in language. ${NOT_A_ZERO}; use grep for this file.`
      : `File not searched as ${lang}: ast-grep reads it as ${read}, from its name. ${NOT_A_ZERO}.` };
  }
  return read === undefined
    ? { unsearched: `File probably not searched: ast-grep reported no language for it, as it does when a file name maps to no built-in language. ${NOT_A_ZERO}; use grep for this file.` }
    : { caveat: `ast-grep reads this file as ${read} (from its name). If ${read} is not the language ${lang} names, the file was not searched: only ${lang} code embedded in it is.` };
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

async function explainPattern(exec: Exec, binary: string, args: string[], pattern: string, cwd: string, signal: AbortSignal | undefined): Promise<ParsedPattern | undefined> {
  // Pi's exec closes stdin, so this parses the pattern without scanning twice.
  const result = await exec(binary, [...args, "--stdin", "--debug-query=pattern"], {
    cwd, signal, timeout: DIAGNOSTIC_TIMEOUT_MS, maxBuffer: MAX_RAW_BYTES,
  });
  signal?.throwIfAborted();
  if (result.killed || result.code !== 1) return undefined;
  // This view is the tree ast-grep matches with: the root kind, then its indented children.
  const dump = /^Debug Pattern:\r?\n([^\r\n]+)((?:\r?\n[ \t]+[^\r\n]*)*)/m.exec(result.stderr);
  if (dump === null) return undefined;
  // The text of a token is printed raw. Only a one-line pattern is sure to give one line per
  // node; a line of a longer token, such as a multi-line string, could read like a node.
  const oneLinePerNode = !/[\r\n\u2028\u2029]/.test(pattern);
  return { kind: dump[1], error: oneLinePerNode && /^[ \t]+ERROR(?:[ \t]|\r?$)/m.test(dump[2]) };
}

function header(lang: string, scope: Scope, summary: FileSummary | undefined): string {
  // One named file is always counted, so its counts say nothing; the result says what happened to it.
  const coverage = summary === undefined ? " — file counts unavailable" : scope.file ? ""
    : ` — ${summary.scanned} file(s) selected${summary.skipped > 0 ? `, ${summary.skipped} of them skipped unread (${UNREAD})` : ""}`;
  return `${lang} in ${oneLine(scope.target)}${coverage}`;
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
  const target = relative(root, scope.target) || ".";
  const result = await exec(binaries.astGrep, [
    ...args, "--json=stream", `--inspect=${scope.file ? "entity" : "summary"}`, ...EXCLUDED_DIRS.map((dir) => `--globs=!${dir}`),
    ...nested.map((path) => excludeWorktree(root, path)), "--", target,
  ], { cwd: root, signal, timeout: SCAN_TIMEOUT_MS, maxBuffer: MAX_RAW_BYTES });
  signal?.throwIfAborted();
  const timedOut = result.killed && !result.truncated;
  const incomplete = result.truncated || timedOut;
  const { trace, rest: stderr } = scope.file ? fileTrace(result.stderr, target) : { trace: undefined, rest: result.stderr };
  const warning = diagnostic(stderr);
  const warnings = warning ? [`ast-grep diagnostic: ${warning}`] : [];
  if (incomplete) {
    // ast-grep prints each match as it finds it, so a stopped scan still holds complete records.
    // It has not printed its summary: a line that reads like one would come from a path it named.
    const { hits } = parseMatches(result.stdout, true, scope, nested);
    if (hits.length > 0) {
      const shown = result.truncated ? `Output limit reached; scan incomplete. Showing ${hits.length} hits.`
        : `Deadline of ${SCAN_DEADLINE} reached; scan incomplete. Showing ${hits.length} hit(s) found before it.`;
      return [header(query.lang, scope, undefined), shown, ...hits, ...warnings].join("\n");
    }
    if (result.truncated) throw new Error("ast-grep reached its output limit before a complete hit; narrow the pattern or path.");
    throw new Error(scope.file
      ? `ast-grep timed out after ${SCAN_DEADLINE} on this file, so it was not searched. Some grammars are very slow on unusual input, such as thousands of consecutive comment lines in Python. Use grep for this file.`
      : `ast-grep timed out after ${SCAN_DEADLINE} before reporting a match; narrow the search path. A single slow file can cause this.`);
  }
  const summary = fileSummary(stderr);
  if ((result.code !== 0 && result.code !== 1) || summary === undefined) {
    throw new Error(`ast-grep failed (exit ${result.code}): ${warning || "missing scan summary"}`);
  }
  const { hits, count } = parseMatches(result.stdout, false, scope, nested);
  if ((count > 0) !== (result.code === 0)) {
    // Success without a match is how ast-grep ends when the whole pattern is a syntax error.
    const parseWarning = count === 0 ? lastLine(stderr, PATTERN_PARSE_WARNING) : undefined;
    if (parseWarning !== undefined) throw new Error(`Cannot parse ast-grep pattern: ${diagnostic(parseWarning[0])}`);
    throw new Error("ast-grep exit status and match records disagree.");
  }
  if (count > 0) {
    const shown = hits.length < count ? `Showing ${hits.length} of ${count} matches; narrow the pattern or path for more.` : `${count} match(es).`;
    return [header(query.lang, scope, summary), shown, ...hits, ...warnings].join("\n");
  }

  const head = header(query.lang, scope, summary);
  const empty = await emptyResult(exec, binaries.astGrep, args, scope, query.lang, summary, trace, signal);
  if (empty.unsearched !== undefined) return [head, empty.unsearched, ...warnings].join("\n");
  const pattern = await explainPattern(exec, binaries.astGrep, args, query.pattern, root, signal);
  const conversion = /^(go|golang)$/i.test(query.lang) && pattern?.kind === "type_conversion_expression";
  const parsed = pattern === undefined ? "Parsed pattern unavailable."
    : `Parsed pattern: ${clip(oneLine(pattern.kind), MAX_DIAGNOSTIC_CHARS)}${pattern.error ? `, containing an ERROR node: part of it is not valid ${query.lang} syntax` : ""}.`
      + (conversion ? "" : " If that is not the node kind you meant, give the fragment valid enclosing syntax and choose the node with selector.");
  const hints = ["Check language and ignore rules; file counts do not prove files parsed successfully. Cross-check with grep before concluding there are no usages."];
  if (conversion) hints.unshift("Go parsed the pattern as a type conversion. For a call, try a pattern such as func t() { pkg.Name($$$ARGS) } with selector call_expression.");
  return [head, ...(empty.caveat === undefined ? [] : [empty.caveat]), "No syntactic matches.", parsed, ...hints, ...warnings].join("\n");
}
