/**
 * A caller-prepared workspace (spawn_agent workspace_path): denied unless
 * the policy lists a root containing it, verified as the top level of a git
 * work tree, bound to the git dir and HEAD recorded at spawn, and never
 * created, changed, or removed by the extension.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRunStore } from "../src/store.ts";
import type { SupervisorPolicy } from "../src/policy.ts";
import type { WorkerFactory } from "../src/supervisor.ts";
import { GitWorkspaceManager, type CheckoutInfo, type WorkspaceDiff, type WorkspaceManager, type WorktreeAllocation } from "../src/workspace.ts";
import { CtlWorker, gateSpec, mkSup, terminals, tick } from "./ctl-worker.ts";
import { testGovernor } from "./fake-worker.ts";

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

interface Fixture {
  dir: string;
  /** The governing session's checkout. */
  repo: string;
  /** The allowed root the caller keeps its worktrees under. */
  root: string;
  /** A worktree of `repo` the caller prepared under `root`. */
  wt: string;
  head: string;
  policy: (p: SupervisorPolicy) => void;
  cleanup: () => void;
}

function fixture(): Fixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "subagents-prepared-")));
  const repo = join(dir, "repo");
  const root = join(dir, "prepared");
  mkdirSync(join(repo, "pkg"), { recursive: true });
  mkdirSync(root);
  writeFileSync(join(repo, "pkg", "a.txt"), "a\n");
  spawnSync("git", ["init", "-q", repo]);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  const wt = join(root, "child-1");
  git(repo, "worktree", "add", "-q", "--detach", wt);
  return { dir, repo, root, wt, head: git(repo, "rev-parse", "HEAD"), policy: (p) => { p.workspaceRoots = [root]; }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A git workspace manager that records every allocation and release it is asked for. */
class RecordingWorkspace implements WorkspaceManager {
  readonly backend = "recording";
  readonly calls: string[] = [];
  private git = new GitWorkspaceManager();

  describeCheckout(dir: string): CheckoutInfo | null {
    return this.git.describeCheckout(dir);
  }

  allocateWriter(repoId: string, checkoutPath: string, baseCommit: string, destDir: string): WorktreeAllocation {
    this.calls.push(`allocate ${checkoutPath}`);
    return this.git.allocateWriter(repoId, checkoutPath, baseCommit, destDir);
  }

  releaseAllocation(allocation: WorktreeAllocation, opts?: { prune?: boolean }): void {
    this.calls.push(`release ${allocation.worktreePath}`);
    this.git.releaseAllocation(allocation, opts);
  }

  workspaceStatus(allocation: WorktreeAllocation): { dirty: boolean; changedFiles: string[] } {
    return this.git.workspaceStatus(allocation);
  }

  diff(allocation: WorktreeAllocation, maxBytes: number): WorkspaceDiff {
    return this.git.diff(allocation, maxBytes);
  }
}

function sup(f: Fixture, opts: { policy?: (p: SupervisorPolicy) => void; workspace?: WorkspaceManager; cwd?: string; factory?: WorkerFactory; store?: FileRunStore; nest?: boolean } = {}): ReturnType<typeof mkSup> {
  return mkSup({
    dir: join(f.dir, "root-store"),
    workspace: opts.workspace ?? new GitWorkspaceManager(),
    governor: () => ({ ...testGovernor(), cwd: opts.cwd ?? f.repo }),
    policy: (p) => {
      (opts.policy ?? f.policy)(p);
      if (opts.nest === true) {
        p.maxDepth = 2;
        p.nesting = true;
      }
    },
    limits: opts.nest === true ? { maxDepth: 2 } : {},
    factory: opts.factory,
    store: opts.store,
  });
}

test("workspace_path is denied unless the policy lists a root that contains it", async () => {
  const f = fixture();
  try {
    const denied = sup(f, { policy: () => {} });
    await assert.rejects(() => denied.sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", workspacePath: f.wt }, "r1"), /POLICY_DENIED: workspace_path is not permitted/);
    assert.equal(denied.sup.admissionScheduler.agentsCreatedCount, 0);
    await denied.sup.shutdown();

    const elsewhere = sup(f, { policy: (p) => { p.workspaceRoots = [join(f.dir, "other-root")]; } });
    await assert.rejects(() => elsewhere.sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", workspacePath: f.wt }, "r1"), /POLICY_DENIED: workspace .* lies outside/);
    await elsewhere.sup.shutdown();
    // A sibling directory sharing the root's name as a prefix is not inside it.
    const sibling = join(f.dir, "prepared-other");
    git(f.repo, "worktree", "add", "-q", "--detach", sibling);
    const prefix = sup(f);
    await assert.rejects(() => prefix.sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", workspacePath: sibling }, "r1"), /POLICY_DENIED: workspace .* lies outside/);
    assert.equal(prefix.sup.admissionScheduler.agentsCreatedCount, 0);
    await prefix.sup.shutdown();
  } finally {
    f.cleanup();
  }
});

test("a writer works in the caller's worktree: host jobs run there and the extension creates no worktree", async () => {
  const f = fixture();
  try {
    const workspace = new RecordingWorkspace();
    const { sup: s, byAgent, executors } = sup(f, { workspace });
    const before = git(f.repo, "worktree", "list", "--porcelain");
    const w = await s.spawn("governor", { taskName: "w", message: "m", profile: "writer", workspacePath: f.wt }, "rw");
    assert.deepEqual({ workdir: w.workdir, isolation: w.isolation }, { workdir: f.wt, isolation: "worktree" });
    const worker = byAgent(w.agentId)[0]!;
    assert.equal(worker.init!["workdir"], f.wt);
    assert.ok(worker.initTools.includes("write") && worker.initTools.includes("bash"));
    await worker.call("write", { path: "b.txt", content: "b\n" });
    assert.deepEqual(executors.host.specs.map((x) => ({ cwd: x.cwd, view: x.view })), [{ cwd: f.wt, view: null }]);
    assert.equal(executors.sandbox.specs.length, 0);
    const spawned = s.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((r) => r.kind === "agent.spawned")!;
    assert.deepEqual(spawned.body["allocation"], {
      kind: "writer",
      workdir: f.wt,
      readRoots: [],
      writableRoot: f.wt,
      git: { workTree: f.wt, gitDir: git(f.wt, "rev-parse", "--absolute-git-dir"), baseCommit: f.head },
      repoId: null,
      tmpDir: join(f.dir, "root-store", "tmp", w.agentId),
      external: true,
    });
    assert.deepEqual(workspace.calls, []);
    assert.equal(existsSync(join(f.dir, "root-store", "worktrees")), false);
    assert.equal(git(f.repo, "worktree", "list", "--porcelain"), before);
    await s.shutdown();
  } finally {
    f.cleanup();
  }
});

test("a reader runs in the prepared workspace without write tools", async () => {
  const f = fixture();
  try {
    const { sup: s, byAgent, executors } = sup(f);
    const r = await s.spawn("governor", { taskName: "r", message: "m", profile: "reader", workspacePath: f.wt }, "rr");
    const worker = byAgent(r.agentId)[0]!;
    assert.equal(worker.init!["workdir"], f.wt);
    assert.ok(!worker.initTools.includes("write") && !worker.initTools.includes("bash"));
    await worker.call("read", { path: "pkg/a.txt" });
    assert.deepEqual(executors.host.specs.map((x) => x.cwd), [f.wt]);
    const denied = await worker.call("write", { path: "b.txt", content: "b\n" });
    assert.match(denied.content, /POLICY_DENIED/);
    await s.shutdown();
  } finally {
    f.cleanup();
  }
});

test("the workspace is judged by its resolved path: a symlink out of the allowed root is denied, one into it is accepted", async () => {
  const f = fixture();
  try {
    const outside = join(f.dir, "outside");
    git(f.repo, "worktree", "add", "-q", "--detach", outside);
    symlinkSync(outside, join(f.root, "escape"));
    const linkDir = join(f.dir, "links");
    mkdirSync(linkDir);
    symlinkSync(f.wt, join(linkDir, "inward"));
    const { sup: s } = sup(f);
    await assert.rejects(() => s.spawn("governor", { taskName: "a", message: "m", profile: "writer", workspacePath: join(f.root, "escape") }, "ra"), /POLICY_DENIED: workspace .*outside lies outside/);
    const ok = await s.spawn("governor", { taskName: "b", message: "m", profile: "writer", workspacePath: join(linkDir, "inward") }, "rb");
    assert.equal(ok.workdir, f.wt);
    await s.shutdown();
  } finally {
    f.cleanup();
  }
});

test("workspace_path must be an absolute, existing top-level directory of a git work tree, under isolation worktree", async () => {
  const f = fixture();
  try {
    const plain = join(f.root, "plain");
    mkdirSync(plain);
    writeFileSync(join(f.root, "file.txt"), "x");
    const { sup: s } = sup(f);
    const spawn = (workspacePath: string, extra: Record<string, unknown> = {}): Promise<unknown> =>
      s.spawn("governor", { taskName: `t${Math.random()}`, message: "m", profile: "writer", workspacePath, ...extra }, `r${Math.random()}`);
    await assert.rejects(() => spawn("prepared/child-1"), /INVALID: workspace_path must be an absolute path/);
    await assert.rejects(() => spawn(join(f.root, "missing")), /WORKSPACE_UNAVAILABLE: workspace .* is not an existing directory/);
    await assert.rejects(() => spawn(join(f.root, "file.txt")), /WORKSPACE_UNAVAILABLE: workspace .* is not an existing directory/);
    await assert.rejects(() => spawn(plain), /WORKSPACE_UNAVAILABLE: workspace .* is not a git work tree with a commit/);
    await assert.rejects(() => spawn(join(f.wt, "pkg")), /WORKSPACE_UNAVAILABLE: workspace .* is not the top-level directory of its git work tree/);
    await assert.rejects(() => spawn(f.wt, { isolation: "none" }), /INVALID: workspace_path needs isolation worktree/);
    await assert.rejects(() => spawn(f.wt, { isolation: "sandbox" }), /INVALID: workspace_path needs isolation worktree/);
    await assert.rejects(() => spawn(f.wt, { baseCommit: "HEAD" }), /INVALID: base_commit applies to worktrees the extension creates/);
    assert.equal(s.admissionScheduler.agentsCreatedCount, 0);
    await s.shutdown();
  } finally {
    f.cleanup();
  }
});

test("the governing checkout itself is refused as a workspace unless the policy allows it", async () => {
  const f = fixture();
  try {
    const wide = (p: SupervisorPolicy): void => { p.workspaceRoots = [f.dir]; };
    const refused = sup(f, { policy: wide, cwd: join(f.repo, "pkg") });
    await assert.rejects(() => refused.sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", workspacePath: f.repo }, "r1"), /POLICY_DENIED: workspace .* is the governing session's own checkout/);
    await refused.sup.shutdown();
    const allowed = sup(f, { policy: (p) => { wide(p); p.workspaceOwnerCheckoutAllowed = true; }, cwd: join(f.repo, "pkg") });
    const w = await allowed.sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", workspacePath: f.repo }, "r1");
    assert.equal(w.workdir, f.repo);
    await allowed.sup.shutdown();
  } finally {
    f.cleanup();
  }
});

test("the supervisor's own storage is never accepted as a workspace", async () => {
  const f = fixture();
  try {
    const inside = join(f.dir, "root-store", "inside");
    mkdirSync(inside, { recursive: true });
    spawnSync("git", ["init", "-q", inside]);
    writeFileSync(join(inside, "x"), "x");
    git(inside, "add", ".");
    git(inside, "commit", "-qm", "base");
    const { sup: s } = sup(f, { policy: (p) => { p.workspaceRoots = [f.dir]; } });
    await assert.rejects(() => s.spawn("governor", { taskName: "w", message: "m", profile: "writer", workspacePath: inside }, "r1"), /POLICY_DENIED: workspace .* overlaps the supervisor's storage/);
    await s.shutdown();
  } finally {
    f.cleanup();
  }
});

test("only the governing session assigns a prepared workspace", async () => {
  const f = fixture();
  try {
    const { sup: s, byAgent } = sup(f, { nest: true });
    const parent = await s.spawn("governor", { taskName: "p", message: "m", profile: "writer", isolation: "none" }, "rp");
    await assert.rejects(() => s.spawn(parent.agentId, { taskName: "k", message: "m", profile: "writer", workspacePath: f.wt }, "rk"), /FORBIDDEN: only the governing session assigns a prepared workspace/);
    // A child's own spawn_agent tool does not offer the parameter; passing it anyway is refused, not dropped.
    const viaTool = await byAgent(parent.agentId)[0]!.call("spawn_agent", { task_name: "k2", message: "m", profile: "writer", workspace_path: f.wt });
    assert.equal(viaTool.isError, true);
    assert.match(viaTool.content, /FORBIDDEN: only the governing session assigns a prepared workspace/);
    assert.equal(s.list("governor").length, 1);
    await s.shutdown();
  } finally {
    f.cleanup();
  }
});

/** What the caller owns: the worktree's files, its `.git` pointer, its HEAD, and its registration. */
function ownership(f: Fixture): Record<string, unknown> {
  return {
    exists: existsSync(f.wt),
    pointer: readFileSync(join(f.wt, ".git"), "utf8"),
    head: git(f.wt, "rev-parse", "HEAD"),
    status: git(f.wt, "status", "--porcelain"),
    registered: git(f.repo, "worktree", "list", "--porcelain"),
  };
}

test("no lifecycle path creates, resets, removes, or releases a caller's workspace", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.wt, "caller-notes.txt"), "uncommitted work the caller owns\n");
    const owned = ownership(f);
    assert.equal(owned["status"], "?? caller-notes.txt");
    const workspace = new RecordingWorkspace();

    // Startup failure: nothing to roll back in a workspace the extension did not create.
    class FailingWorker extends CtlWorker {
      override async launch(): Promise<void> {
        throw new Error("launch refused");
      }
    }
    const failing = sup(f, { workspace, factory: (o) => new FailingWorker(o.agentId) });
    await assert.rejects(() => failing.sup.spawn("governor", { taskName: "f", message: "m", profile: "writer", workspacePath: f.wt }, "rf"), /launch refused/);
    assert.deepEqual(ownership(f), owned);
    await failing.sup.shutdown();
    rmSync(join(f.dir, "root-store"), { recursive: true, force: true });

    // Settle, interrupt, close, recover, shutdown.
    const store = new FileRunStore(join(f.dir, "root-store"), "root-1");
    const a = sup(f, { workspace, store });
    const done = await a.sup.spawn("governor", { taskName: "done", message: "m", profile: "writer", workspacePath: f.wt }, "r1");
    a.byAgent(done.agentId)[0]!.settle("succeeded", "done");
    await tick();
    await a.sup.close("governor", done.agentId, "c1");
    const stopped = await a.sup.spawn("governor", { taskName: "stopped", message: "m", profile: "writer", workspacePath: f.wt }, "r2");
    await a.sup.interrupt("governor", stopped.agentId, "i2");
    await tick();
    await a.sup.close("governor", stopped.agentId, "c2");
    const lost = await a.sup.spawn("governor", { taskName: "lost", message: "m", profile: "writer", workspacePath: f.wt }, "r3");
    await a.sup.recover();
    assert.deepEqual(terminals(a.sup, lost.taskRunId), ["interrupted"]);
    await a.sup.close("governor", lost.agentId, "c3");
    await a.sup.shutdown();

    assert.deepEqual(ownership(f), owned);
    assert.deepEqual(workspace.calls, []);
    assert.equal(existsSync(join(f.dir, "root-store", "worktrees")), false);
  } finally {
    f.cleanup();
  }
});

test("a gated writer's candidate is bound to the git dir and HEAD recorded at spawn", async () => {
  const f = fixture();
  try {
    const { sup: s, byAgent } = sup(f);
    const gitDir = git(f.wt, "rev-parse", "--absolute-git-dir");
    const g = await s.spawn("governor", { taskName: "g", message: "m", profile: "writer", workspacePath: f.wt, gate: gateSpec() }, "rg");
    writeFileSync(join(f.wt, "pkg", "a.txt"), "changed by the child\n");
    // The child rewrites the worktree's `.git` pointer: host git keeps the recorded git dir.
    const decoy = join(f.dir, "decoy");
    spawnSync("git", ["init", "-q", decoy]);
    writeFileSync(join(f.wt, ".git"), `gitdir: ${join(decoy, ".git")}\n`);
    byAgent(g.agentId)[0]!.settle("succeeded", "edited a.txt");
    await tick(80);
    const candidates = s.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((r) => r.kind === "gate.candidate");
    assert.equal(candidates.length, 1, JSON.stringify(s.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((r) => r.kind === "task.terminal").map((r) => r.body)));
    const candidate = candidates[0]!.body["candidate"] as { baseCommit: string; fingerprint: { files: Array<{ path: string; kind: string }> } };
    assert.equal(candidate.baseCommit, f.head);
    assert.deepEqual(candidate.fingerprint.files.map((x) => `${x.kind} ${x.path}`), ["modified pkg/a.txt"]);
    const spawned = s.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((r) => r.kind === "agent.spawned" && r.body["agentId"] === g.agentId)!;
    assert.equal((spawned.body["allocation"] as { git: { gitDir: string } }).git.gitDir, gitDir);
    await s.shutdown();
  } finally {
    f.cleanup();
  }
});

test("a workspace removed by its owner ends the lost run and fails later tasks clearly, without a crash", async () => {
  const f = fixture();
  try {
    const rootDir = join(f.dir, "root-store");
    const a = sup(f, { store: new FileRunStore(rootDir, "root-1") });
    const w = await a.sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", workspacePath: f.wt }, "rw");
    await tick();
    await a.sup.shutdown(); // The run is in flight.
    // The caller removes its own worktree while no supervisor is attached.
    git(f.repo, "worktree", "remove", "--force", f.wt);
    assert.equal(existsSync(f.wt), false);

    const b = sup(f, { store: new FileRunStore(rootDir, "root-1") });
    assert.equal(b.sup.needsRecovery, true);
    assert.equal(b.sup.list("governor")[0]!.workdir, f.wt);
    const report = await b.sup.recover();
    assert.deepEqual(report.settled, [w.taskRunId]);
    const terminal = b.sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((r) => r.kind === "task.terminal" && r.body["taskRunId"] === w.taskRunId)!;
    assert.equal(terminal.body["outcome"], "interrupted");
    assert.match(String(terminal.body["detail"]), new RegExp(`workspace ${f.wt} no longer exists`));
    // A later task cannot start there: it fails with the reason instead of running nowhere.
    const next = await b.sup.sendMessage("governor", w.agentId, "task", "continue", {}, "rn");
    await tick(50);
    const failed = b.sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((r) => r.kind === "task.terminal" && r.body["taskRunId"] === next.taskRunId)!;
    assert.equal(failed.body["outcome"], "failed");
    assert.match(String(failed.body["detail"]), /WORKSPACE_UNAVAILABLE: workspace .* no longer exists/);
    assert.equal(b.byAgent(w.agentId).length, 0, "no worker is launched into a missing workspace");
    await b.sup.shutdown();
  } finally {
    f.cleanup();
  }
});

test("a reload re-checks the policy: a workspace whose root is no longer allowed is refused", async () => {
  const f = fixture();
  try {
    const rootDir = join(f.dir, "root-store");
    const a = sup(f, { store: new FileRunStore(rootDir, "root-1") });
    const w = await a.sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", workspacePath: f.wt }, "rw");
    a.byAgent(w.agentId)[0]!.settle("succeeded", "done");
    await tick();
    await a.sup.shutdown();
    const b = sup(f, { policy: () => {}, store: new FileRunStore(rootDir, "root-1") });
    const next = await b.sup.sendMessage("governor", w.agentId, "task", "continue", {}, "rn");
    await tick(50);
    const failed = b.sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((r) => r.kind === "task.terminal" && r.body["taskRunId"] === next.taskRunId)!;
    assert.equal(failed.body["outcome"], "failed");
    assert.match(String(failed.body["detail"]), /POLICY_DENIED: workspace_path is not permitted/);
    await b.sup.shutdown();
  } finally {
    f.cleanup();
  }
});
