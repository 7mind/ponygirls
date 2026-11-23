import { lstatSync, readFileSync, realpathSync, rmdirSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { err } from "./errors.ts";
import { worktreeClaim, stagingReason, type WorktreeAllocation, type WorkspaceManager, type WriterDestination } from "./workspace.ts";

interface DirectoryIdentity { path: string; dev: string; ino: string; birth: string }
export interface PendingWorkspace {
  tmp: DirectoryIdentity;
  worktree: { tree: DirectoryIdentity; admin: DirectoryIdentity; checkout: DirectoryIdentity; allocation: WorktreeAllocation } | null;
}

function identity(path: string): DirectoryIdentity {
  const canonical = realpathSync(path), st = lstatSync(canonical, { bigint: true });
  if (!st.isDirectory()) throw err("WORKSPACE_UNAVAILABLE", `Pending workspace is not a directory: ${canonical}`);
  return { path: canonical, dev: String(st.dev), ino: String(st.ino), birth: String(st.birthtimeNs) };
}

function present(saved: DirectoryIdentity): boolean {
  if (!lstatSync(saved.path, { throwIfNoEntry: false })) return false;
  const found = identity(saved.path);
  if (saved.path !== found.path || saved.dev !== found.dev || saved.ino !== found.ino || saved.birth !== found.birth) throw err("WORKSPACE_UNAVAILABLE", `Pending workspace identity changed: ${saved.path}`);
  return true;
}

export interface AllocationIntent {
  tmp: DirectoryIdentity;
  checkout: DirectoryIdentity;
  common: DirectoryIdentity;
  pool: DirectoryIdentity;
  leaf: string;
  baseCommit: string;
}

export function allocationIntent(tmp: string, to: WriterDestination): AllocationIntent {
  if (lstatSync(to.worktreePath, { throwIfNoEntry: false })) throw err("CONFLICT", `Pending destination already exists: ${to.worktreePath}`);
  return { tmp: identity(tmp), checkout: identity(to.checkoutPath), common: identity(to.commonDir), pool: identity(dirname(to.worktreePath)), leaf: basename(to.worktreePath), baseCommit: to.baseCommit };
}

export function releaseAllocationIntent(manager: WorkspaceManager, intent: AllocationIntent, rootDir: string, agentId: string): void {
  if (basename(intent.leaf) !== intent.leaf || !present(intent.pool) || !present(intent.common) || !present(intent.checkout)) throw err("WORKSPACE_UNAVAILABLE", "Pending writer destination changed");
  const tree = join(intent.pool.path, intent.leaf);
  const dir = lstatSync(tree, { throwIfNoEntry: false });
  const staged: PendingWorkspace = { tmp: intent.tmp, worktree: null };
  if (dir) {
    const checkout = dir.isDirectory() && manager.describeCheckout(tree);
    if (!checkout || checkout.workTree !== tree || checkout.head !== intent.baseCommit || dirname(realpathSync(checkout.gitDir)) !== join(intent.common.path, "worktrees") || worktreeClaim(checkout.gitDir) !== stagingReason(agentId)) throw err("WORKSPACE_UNAVAILABLE", `Cannot verify unpublished worktree: ${tree}`);
    const allocation: WorktreeAllocation = { checkoutPath: intent.checkout.path, worktreePath: tree, gitDir: checkout.gitDir, baseCommit: intent.baseCommit, baseDirty: false, repoId: basename(intent.checkout.path), stagingId: agentId };
    staged.worktree = { checkout: intent.checkout, tree: identity(tree), admin: identity(checkout.gitDir), allocation };
  }
  releasePendingWorkspace(manager, staged, rootDir, agentId);
}

export function pendingWorkspace(tmpDir: string, allocation: WorktreeAllocation | null): PendingWorkspace {
  return { tmp: identity(tmpDir), worktree: allocation && { allocation, tree: identity(allocation.worktreePath), admin: identity(allocation.gitDir), checkout: identity(allocation.checkoutPath) } };
}

export function publicationCheck(staged: PendingWorkspace, cwd: string, agentId: string): () => void {
  const directory = identity(cwd);
  return () => {
    const wt = staged.worktree;
    if (realpathSync(cwd) !== directory.path || !present(directory) || !present(staged.tmp) ||
        (wt && (!present(wt.tree) || !present(wt.admin) || !present(wt.checkout) || worktreeClaim(wt.admin.path) !== stagingReason(agentId)))) {
      throw err("WORKSPACE_UNAVAILABLE", "Pending workspace changed before publication");
    }
  };
}

export function unlockPublishedWorkspace(staged: PendingWorkspace, agentId: string): void {
  const wt = staged.worktree;
  if (!wt || worktreeClaim(wt.admin.path) !== stagingReason(agentId)) return;
  if (!present(wt.admin)) throw err("WORKSPACE_UNAVAILABLE", "Published worktree administration changed");
  unlinkSync(join(wt.admin.path, "locked"));
}

export function releasePendingWorkspace(manager: WorkspaceManager, staged: PendingWorkspace, rootDir: string, agentId: string): void {
  if (basename(agentId) !== agentId || staged.tmp.path !== join(realpathSync(rootDir), "tmp", agentId)) throw err("RECOVERY_CORRUPT", "Pending workspace temporary directory is not owned by the spawn");
  const tmpExists = present(staged.tmp), wt = staged.worktree;
  if (wt) {
    const treeExists = present(wt.tree), adminExists = present(wt.admin);
    if (treeExists || adminExists) {
      if (!treeExists || !adminExists || !present(wt.checkout)) throw err("WORKSPACE_UNAVAILABLE", `Pending worktree is only partially present: ${wt.tree.path}`);
      const git = manager.describeCheckout(wt.tree.path);
      const backlink = readFileSync(join(wt.admin.path, "gitdir"), "utf8").trim();
      if (!git || realpathSync(git.gitDir) !== wt.admin.path || realpathSync(git.workTree) !== wt.tree.path || git.head !== wt.allocation.baseCommit || realpathSync(backlink) !== join(wt.tree.path, ".git")) throw err("WORKSPACE_UNAVAILABLE", `Pending worktree Git identity changed: ${wt.tree.path}`);
      manager.releaseAllocation({ ...wt.allocation, checkoutPath: wt.checkout.path, worktreePath: wt.tree.path, gitDir: wt.admin.path }, { prune: true, exact: true });
    }
  }
  if (tmpExists) rmdirSync(staged.tmp.path);
}
