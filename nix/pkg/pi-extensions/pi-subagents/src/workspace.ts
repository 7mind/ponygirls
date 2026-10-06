/**
 * pi-subagents — workspace manager.
 *
 * Readers inspect an explicitly selected workspace view (with dirty-state
 * reporting). A writer with isolation "worktree" or "sandbox" starts from a
 * recorded commit in a separate worktree; allocation grants confer no write
 * access to the original checkout, the parent worktree, or a sibling
 * worktree. A writer with isolation "none" edits its owner's working
 * directory in place; only its git metadata is described here.
 *
 * Startup failure rolls back only artifacts created by that startup; it
 * never falls back to editing the parent directory. No merges, commits,
 * dirty-worktree removals, or hook executions happen implicitly.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readlinkSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { err } from "./errors.ts";

export interface WorktreeAllocation {
  repoId: string;
  checkoutPath: string;
  worktreePath: string;
  /**
   * The worktree's git dir, recorded at creation. Host git always targets
   * it explicitly: the worktree's own `.git` file is writable by the agent
   * and must never steer host git to another repository or config.
   */
  gitDir: string;
  baseCommit: string;
  /** True when the base checkout had uncommitted changes at allocation. */
  baseDirty: boolean;
}

/** A git checkout as found from a working directory. */
export interface CheckoutInfo {
  workTree: string;
  gitDir: string;
  head: string;
}

export interface WorkspaceDiff {
  baseCommit: string;
  changedFiles: string[];
  /** Bounded unified diff; truncated flag when capped. */
  diff: string;
  truncated: boolean;
}

export interface WorkspaceManager {
  readonly backend: string;
  /** The checkout containing `dir`, or null when it is not in a git checkout with a commit. */
  describeCheckout(dir: string): CheckoutInfo | null;
  allocateWriter(repoId: string, checkoutPath: string, baseCommit: string, destDir: string): WorktreeAllocation;
  releaseAllocation(allocation: WorktreeAllocation, opts?: { prune?: boolean }): void;
  workspaceStatus(allocation: WorktreeAllocation): { dirty: boolean; changedFiles: string[] };
  diff(allocation: WorktreeAllocation, maxBytes: number): WorkspaceDiff;
}

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
/** No hooks, fsmonitor commands, or untracked caches when the host runs git. */
const GIT_HARDENING = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"];

/** Host environment without inherited GIT_* overrides. */
function gitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
  }
  env["GIT_OPTIONAL_LOCKS"] = "0";
  return env;
}

function runGit(args: string[], cwd: string): { ok: true; out: string } | { ok: false; message: string } {
  const r = spawnSync("git", [...GIT_HARDENING, ...args], { cwd, env: gitEnv(), encoding: "utf8", timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER });
  if (r.error) return { ok: false, message: (r.error as Error).message };
  if (r.status !== 0) return { ok: false, message: (r.stderr ?? "").trim() || `git exited ${r.status}` };
  return { ok: true, out: r.stdout ?? "" };
}

/** Git against the registered (trusted) checkout. */
function git(checkoutPath: string, args: string[]): { ok: true; out: string } | { ok: false; message: string } {
  const r = runGit(["-C", checkoutPath, ...args], checkoutPath);
  return r.ok ? { ok: true, out: r.out.trim() } : r;
}

/** Git against an agent worktree, pinned to its recorded git dir. */
function worktreeGit(worktreePath: string, gitDir: string, args: string[]): { ok: true; out: string } | { ok: false; message: string } {
  return runGit(["--git-dir", gitDir, "--work-tree", worktreePath, ...args], worktreePath);
}

export class GitWorkspaceManager implements WorkspaceManager {
  readonly backend = "git-worktree";

  describeCheckout(dir: string): CheckoutInfo | null {
    const where = git(dir, ["rev-parse", "--show-toplevel", "--absolute-git-dir"]);
    if (!where.ok) return null;
    const [workTree, gitDir] = where.out.split("\n");
    const head = git(dir, ["rev-parse", "--verify", "HEAD^{commit}"]);
    if (!head.ok || !workTree || !gitDir) return null;
    return { workTree, gitDir, head: head.out };
  }

  allocateWriter(repoId: string, checkoutPath: string, baseCommit: string, destDir: string): WorktreeAllocation {
    if (!existsSync(join(checkoutPath, ".git")) && !existsSync(checkoutPath)) {
      throw err("WORKSPACE_UNAVAILABLE", `checkout missing: ${checkoutPath}`);
    }
    const rev = git(checkoutPath, ["rev-parse", "--verify", `${baseCommit}^{commit}`]);
    if (!rev.ok) throw err("WORKSPACE_UNAVAILABLE", `unresolvable base commit: ${rev.message}`);
    const resolved = rev.out;
    const status = git(checkoutPath, ["status", "--porcelain"]);
    const baseDirty = status.ok && status.out.length > 0;
    mkdirSync(destDir, { recursive: true });
    const worktreePath = join(destDir, `wt-${repoId}-${resolved.slice(0, 12)}-${Date.now()}`);
    const add = git(checkoutPath, ["worktree", "add", "--detach", worktreePath, resolved]);
    if (!add.ok) {
      // Roll back only artifacts created by this startup.
      rmSync(worktreePath, { recursive: true, force: true });
      throw err("WORKSPACE_UNAVAILABLE", `worktree creation failed: ${add.message}`);
    }
    // Record the git dir now, before any agent can rewrite the .git file.
    const commonDir = git(checkoutPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const pointer = /^gitdir: (.+)$/m.exec(readFileSync(join(worktreePath, ".git"), "utf8"));
    const gitDir = pointer?.[1]?.trim() ?? "";
    if (!commonDir.ok || !isAbsolute(gitDir) || relative(commonDir.out, gitDir).startsWith("..")) {
      git(checkoutPath, ["worktree", "remove", "--force", worktreePath]);
      rmSync(worktreePath, { recursive: true, force: true });
      throw err("WORKSPACE_UNAVAILABLE", `cannot determine the git dir of ${worktreePath}`);
    }
    return { repoId, checkoutPath, worktreePath, gitDir, baseCommit: resolved, baseDirty };
  }

  releaseAllocation(allocation: WorktreeAllocation, opts?: { prune?: boolean }): void {
    if (!opts?.prune) return; // Retained files need an explicit user action.
    const st = this.workspaceStatus(allocation);
    if (st.dirty) {
      throw err("CONFLICT", "refusing to prune a dirty worktree without explicit user action");
    }
    const rm = git(allocation.checkoutPath, ["worktree", "remove", "--force", allocation.worktreePath]);
    if (!rm.ok) throw err("WORKSPACE_UNAVAILABLE", `worktree remove failed: ${rm.message}`);
    git(allocation.checkoutPath, ["worktree", "prune"]);
  }

  workspaceStatus(allocation: WorktreeAllocation): { dirty: boolean; changedFiles: string[] } {
    if (!existsSync(allocation.worktreePath)) throw err("NOT_FOUND", `workspace missing: ${allocation.worktreePath}`);
    const status = worktreeGit(allocation.worktreePath, allocation.gitDir, ["status", "--porcelain=v1", "-z", "--no-renames"]);
    if (!status.ok) throw err("WORKSPACE_UNAVAILABLE", status.message);
    const changedFiles = parsePorcelainZ(status.out).map((e) => e.path);
    return { dirty: changedFiles.length > 0, changedFiles };
  }

  diff(allocation: WorktreeAllocation, maxBytes: number): WorkspaceDiff {
    const st = this.workspaceStatus(allocation);
    const d = worktreeGit(allocation.worktreePath, allocation.gitDir, ["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", "."]);
    if (!d.ok) throw err("WORKSPACE_UNAVAILABLE", d.message);
    const diff = d.out.length > maxBytes ? `${d.out.slice(0, maxBytes)}\n…[truncated]` : d.out;
    return { baseCommit: allocation.baseCommit, changedFiles: st.changedFiles, diff, truncated: d.out.length > maxBytes };
  }
}

/** Parse `git status --porcelain=v1 -z --no-renames` (NUL-separated, unquoted). */
function parsePorcelainZ(out: string): Array<{ code: string; path: string }> {
  const entries: Array<{ code: string; path: string }> = [];
  for (const raw of out.split("\0")) {
    if (raw.length < 4) continue;
    entries.push({ code: raw.slice(0, 2), path: raw.slice(3) });
  }
  return entries;
}

/** Hand-written dummy sharing the WorkspaceManager contract. */
export class DummyWorkspaceManager implements WorkspaceManager {
  readonly backend = "dummy";
  allocations: WorktreeAllocation[] = [];
  failAllocate = false;
  /** What describeCheckout reports for every directory. */
  checkout: CheckoutInfo | null = null;
  private seq = 0;

  describeCheckout(_dir: string): CheckoutInfo | null {
    return this.checkout;
  }

  allocateWriter(repoId: string, checkoutPath: string, baseCommit: string, destDir: string): WorktreeAllocation {
    if (this.failAllocate) throw err("WORKSPACE_UNAVAILABLE", "dummy allocation failure");
    const allocation: WorktreeAllocation = {
      repoId,
      checkoutPath,
      worktreePath: join(destDir, `dummy-${repoId}-${this.seq}`),
      gitDir: join(destDir, `dummy-${repoId}-${this.seq++}.git`),
      baseCommit,
      baseDirty: false,
    };
    mkdirSync(allocation.worktreePath, { recursive: true });
    this.allocations.push(allocation);
    return allocation;
  }

  releaseAllocation(allocation: WorktreeAllocation, opts?: { prune?: boolean }): void {
    if (!opts?.prune) return;
    rmSync(allocation.worktreePath, { recursive: true, force: true });
  }

  workspaceStatus(allocation: WorktreeAllocation): { dirty: boolean; changedFiles: string[] } {
    if (!existsSync(allocation.worktreePath)) throw err("NOT_FOUND", `workspace missing: ${allocation.worktreePath}`);
    return { dirty: false, changedFiles: [] };
  }

  diff(allocation: WorktreeAllocation, maxBytes: number): WorkspaceDiff {
    void maxBytes;
    return { baseCommit: allocation.baseCommit, changedFiles: [], diff: "", truncated: false };
  }
}

/**
 * Metadata-only candidate fingerprint: path, change kind, mode, content hash
 * for the review scope (tracked changes, untracked files, deletions,
 * symlink targets, promised git-ignored outputs). No per-round file-content
 * archive: unchanged tracked content is identified by the fixed Git base.
 */
export interface FingerprintFile {
  path: string;
  kind: string;
  mode: string;
  hash: string;
}

export function fingerprintWorktree(
  worktree: { worktreePath: string; gitDir: string },
  baseCommit: string | null,
  promisedOutputs: string[],
  maxFiles = 2000,
): { baseCommit: string | null; textOnly: false; textHash: null; files: FingerprintFile[] } {
  const status = worktreeGit(worktree.worktreePath, worktree.gitDir, ["status", "--porcelain=v1", "-z", "-uall", "--no-renames"]);
  if (!status.ok) throw err("WORKSPACE_UNAVAILABLE", status.message);
  const files: FingerprintFile[] = [];
  for (const entry of parsePorcelainZ(status.out)) {
    if (files.length >= maxFiles) break;
    const kind = entry.code.includes("D") ? "deleted" : entry.code === "??" ? "untracked" : "modified";
    files.push(kind === "deleted" ? { path: entry.path, kind, mode: "gone", hash: "deleted" } : describeEntry(worktree.worktreePath, entry.path, kind));
  }
  for (const promised of promisedOutputs) {
    const full = resolve(worktree.worktreePath, promised);
    const rel = relative(worktree.worktreePath, full);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
      throw err("INVALID", `promised output ${promised} lies outside the worktree`);
    }
    if (files.some((f) => f.path === promised)) continue;
    if (!existsSync(full)) {
      files.push({ path: promised, kind: "missing-promised", mode: "gone", hash: "missing" });
      continue;
    }
    files.push(describeEntry(worktree.worktreePath, promised, "promised"));
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { baseCommit, textOnly: false as const, textHash: null, files };
}

const HASH_CHUNK_BYTES = 1024 * 1024;

/**
 * Metadata + content hash of one entry, read directly (no shell, no git
 * filters). Only regular files are read, through a non-blocking,
 * no-follow descriptor that is re-checked after opening: a FIFO, device,
 * or socket planted by the agent can never block the supervisor.
 */
function describeEntry(worktreePath: string, rel: string, kind: string): FingerprintFile {
  const full = join(worktreePath, rel);
  try {
    const st = lstatSync(full);
    if (st.isSymbolicLink()) return { path: rel, kind, mode: "symlink", hash: `link:${readlinkSync(full)}` };
    if (st.isDirectory()) return { path: rel, kind: "dir", mode: "dir", hash: "dir" };
    if (!st.isFile()) return { path: rel, kind, mode: "special", hash: `special:${st.mode & 0o170000}` };
    const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile()) return { path: rel, kind, mode: "special", hash: `special:${opened.mode & 0o170000}` };
      const hash = createHash("sha256");
      const chunk = Buffer.alloc(HASH_CHUNK_BYTES);
      for (let n = readSync(fd, chunk); n > 0; n = readSync(fd, chunk)) hash.update(chunk.subarray(0, n));
      return { path: rel, kind, mode: (opened.mode & 0o111) !== 0 ? "executable" : "file", hash: hash.digest("hex") };
    } finally {
      closeSync(fd);
    }
  } catch {
    return { path: rel, kind, mode: "file", hash: "unreadable" };
  }
}
