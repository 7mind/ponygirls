/**
 * pi-subagents — workspace manager.
 *
 * Readers inspect an explicitly selected workspace view (with dirty-state
 * reporting). Each writer starts from a recorded commit in a separate
 * worktree. Allocation grants confer no write access to the original
 * checkout, the parent worktree, or a sibling worktree: the supervisor
 * derives each writer's writable view from its own allocated worktree.
 *
 * Startup failure rolls back only artifacts created by that startup; it
 * never falls back to editing the parent directory. No merges, commits,
 * dirty-worktree removals, or hook executions happen implicitly.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { err } from "./errors.ts";

export interface WorktreeAllocation {
  repoId: string;
  checkoutPath: string;
  worktreePath: string;
  baseCommit: string;
  /** True when the base checkout had uncommitted changes at allocation. */
  baseDirty: boolean;
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
  allocateWriter(repoId: string, checkoutPath: string, baseCommit: string, destDir: string): WorktreeAllocation;
  releaseAllocation(allocation: WorktreeAllocation, opts?: { prune?: boolean }): void;
  workspaceStatus(path: string): { dirty: boolean; changedFiles: string[] };
  diff(allocation: WorktreeAllocation, maxBytes: number): WorkspaceDiff;
}

function git(checkoutPath: string, args: string[]): { ok: true; out: string } | { ok: false; message: string } {
  const r = spawnSync("git", ["-C", checkoutPath, ...args], { encoding: "utf8", timeout: 30_000 });
  if (r.error) return { ok: false, message: (r.error as Error).message };
  if (r.status !== 0) return { ok: false, message: (r.stderr ?? "").trim() || `git exited ${r.status}` };
  return { ok: true, out: (r.stdout ?? "").trim() };
}

export class GitWorkspaceManager implements WorkspaceManager {
  readonly backend = "git-worktree";

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
    return { repoId, checkoutPath, worktreePath, baseCommit: resolved, baseDirty };
  }

  releaseAllocation(allocation: WorktreeAllocation, opts?: { prune?: boolean }): void {
    if (!opts?.prune) return; // Retained files need an explicit user action.
    const st = this.workspaceStatus(allocation.worktreePath);
    if (st.dirty) {
      throw err("CONFLICT", "refusing to prune a dirty worktree without explicit user action");
    }
    const rm = git(allocation.checkoutPath, ["worktree", "remove", "--force", allocation.worktreePath]);
    if (!rm.ok) throw err("WORKSPACE_UNAVAILABLE", `worktree remove failed: ${rm.message}`);
    git(allocation.checkoutPath, ["worktree", "prune"]);
  }

  workspaceStatus(path: string): { dirty: boolean; changedFiles: string[] } {
    if (!existsSync(path)) throw err("NOT_FOUND", `workspace missing: ${path}`);
    const status = git(path, ["status", "--porcelain"]);
    if (!status.ok) throw err("WORKSPACE_UNAVAILABLE", status.message);
    const changedFiles = status.out.length > 0 ? status.out.split("\n").map((l) => l.slice(3)) : [];
    return { dirty: changedFiles.length > 0, changedFiles };
  }

  diff(allocation: WorktreeAllocation, maxBytes: number): WorkspaceDiff {
    const st = this.workspaceStatus(allocation.worktreePath);
    const d = git(allocation.worktreePath, ["diff", `HEAD`, "--", "."]);
    if (!d.ok) throw err("WORKSPACE_UNAVAILABLE", d.message);
    // Include untracked files in the changed list without dumping contents.
    const untracked = git(allocation.worktreePath, ["ls-files", "--others", "--exclude-standard"]);
    const changed = [...st.changedFiles, ...(untracked.ok && untracked.out ? untracked.out.split("\n") : [])];
    const diff = d.out.length > maxBytes ? `${d.out.slice(0, maxBytes)}\n…[truncated]` : d.out;
    return { baseCommit: allocation.baseCommit, changedFiles: changed, diff, truncated: d.out.length > maxBytes };
  }
}

/** Hand-written dummy sharing the WorkspaceManager contract. */
export class DummyWorkspaceManager implements WorkspaceManager {
  readonly backend = "dummy";
  allocations: WorktreeAllocation[] = [];
  failAllocate = false;
  private seq = 0;

  allocateWriter(repoId: string, checkoutPath: string, baseCommit: string, destDir: string): WorktreeAllocation {
    if (this.failAllocate) throw err("WORKSPACE_UNAVAILABLE", "dummy allocation failure");
    const allocation: WorktreeAllocation = {
      repoId,
      checkoutPath,
      worktreePath: join(destDir, `dummy-${repoId}-${this.seq++}`),
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

  workspaceStatus(path: string): { dirty: boolean; changedFiles: string[] } {
    if (!existsSync(path)) throw err("NOT_FOUND", `workspace missing: ${path}`);
    return { dirty: false, changedFiles: [] };
  }

  diff(allocation: WorktreeAllocation, maxBytes: number): WorkspaceDiff {
    void maxBytes;
    return { baseCommit: allocation.baseCommit, changedFiles: [], diff: "", truncated: false };
  }
}

/** List directory entries for the read/grep/find/ls proxy tools (real FS read path). */
export function listDirectory(root: string, rel: string): string[] {
  const target = rel ? join(root, rel) : root;
  return readdirSync(target);
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
  worktreePath: string,
  baseCommit: string | null,
  promisedOutputs: string[],
  maxFiles = 2000,
): { baseCommit: string | null; textOnly: false; textHash: null; files: FingerprintFile[] } {
  const run = (args: string[]): string => {
    const r = spawnSync("git", ["-C", worktreePath, ...args], { encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    if (r.error) throw err("WORKSPACE_UNAVAILABLE", (r.error as Error).message);
    return (r.stdout ?? "").trim();
  };
  const status = run(["status", "--porcelain=v1", "-uall"]);
  const files: FingerprintFile[] = [];
  const hashObject = (revPath: string): string => {
    const r = spawnSync("git", ["-C", worktreePath, "hash-object", revPath], { encoding: "utf8", timeout: 30_000 });
    if (r.error ?? r.status !== 0) return "unreadable";
    return (r.stdout ?? "").trim() || "unreadable";
  };
  for (const line of status.split("\n")) {
    if (!line) continue;
    if (files.length >= maxFiles) break;
    const code = line.slice(0, 2);
    const rel = line.slice(3).replace(/^".*"$/, (m) => m);
    const kind = code.includes("D") ? "deleted" : code.includes("R") ? "renamed" : code === "??" ? "untracked" : "modified";
    if (kind === "deleted") {
      files.push({ path: rel, kind, mode: "gone", hash: "deleted" });
      continue;
    }
    const full = join(worktreePath, rel);
    let statKind = kind;
    let mode = "file";
    try {
      const st = spawnSync("sh", ["-c", `test -L ${JSON.stringify(full)} && echo link || test -d ${JSON.stringify(full)} && echo dir || echo file`], { encoding: "utf8" });
      const t = (st.stdout ?? "").trim();
      if (t === "link") {
        mode = "symlink";
        const target = spawnSync("sh", ["-c", `readlink ${JSON.stringify(full)}`], { encoding: "utf8" });
        files.push({ path: rel, kind: statKind, mode, hash: `link:${((target.stdout ?? "").trim())}` });
        continue;
      }
      if (t === "dir") {
        statKind = "dir";
        files.push({ path: rel, kind: statKind, mode: "dir", hash: "dir" });
        continue;
      }
    } catch {
      files.push({ path: rel, kind: statKind, mode, hash: "unreadable" });
      continue;
    }
    void statKind;
    files.push({ path: rel, kind, mode, hash: hashObject(full) });
  }
  for (const promised of promisedOutputs) {
    const full = join(worktreePath, promised);
    if (files.some((f) => f.path === promised)) continue;
    if (!existsSync(full)) {
      files.push({ path: promised, kind: "missing-promised", mode: "gone", hash: "missing" });
      continue;
    }
    files.push({ path: promised, kind: "promised", mode: "file", hash: hashObject(full) });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { baseCommit, textOnly: false as const, textHash: null, files };
}
