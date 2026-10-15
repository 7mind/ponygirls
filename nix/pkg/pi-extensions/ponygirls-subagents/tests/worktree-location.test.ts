/**
 * Worktree location: configurable pooled root, home layout as default.
 *
 * Specified-origin Behavioral-Active suite (taxonomy: BA/BG + one
 * Good-Communication leg):
 * - BA: default null, validateWorktreeRoot accepts/rejects visibly.
 * - BG: Supervisor with DummyWorkspaceManager — default unchanged path,
 *   custom pooled root session separation, both writer isolation modes,
 *   session/log/tmp dirs untouched, pooled-root sandbox exclusion.
 * - Good-Communication: real git allocation through the Supervisor under a
 *   custom root — diff and retention; direct-manager pinning; bwrap
 *   sibling-mask semantics (skipped visibly where bwrap is unavailable).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSupervisorPolicy, validateWorktreeRoot, type SupervisorPolicy } from "../src/policy.ts";
import { Supervisor, type GovernorContext } from "../src/supervisor.ts";
import { BwrapToolExecutor, DummyToolExecutor, HostToolExecutor, type ToolJobResult, type ToolJobSpec } from "../src/sandbox.ts";
import { InMemoryRunStore, FileRunStore, type RunStore } from "../src/store.ts";
import { DummyWorkspaceManager, GitWorkspaceManager, encodeWorktreeLeaf, fingerprintWorktree, type WorkspaceManager } from "../src/workspace.ts";
import { CtlWorker, gateSpec, mkSup, tick } from "./ctl-worker.ts";
import { testGovernor, until } from "./fake-worker.ts";

function gitCheckout(dir: string): string {
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "pkg"), { recursive: true });
  writeFileSync(join(repo, "pkg", "a.txt"), "a\n");
  spawnSync("git", ["init", "-q", repo]);
  spawnSync("git", ["-C", repo, "add", "."]);
  spawnSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"]);
  return repo;
}

function absBin(name: string): string | null {
  const r = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
  const out = (r.stdout ?? "").trim().split("\n")[0]?.trim();
  return out || null;
}

/** Supervisor with an explicit rootId sharing a pooled root (mkSup pins root-1). */
function mkPooledSup(opts: {
  rootId: string;
  dir: string;
  pool: string | null;
  workspace: WorkspaceManager;
  repo: string;
  readRoots?: string[];
  governor?: () => GovernorContext;
  policy?: (p: SupervisorPolicy) => void;
  store?: RunStore;
  hostAgentDir?: string;
}): { sup: Supervisor; workers: CtlWorker[]; byAgent: (agentId: string) => CtlWorker[]; executors: { sandbox: DummyToolExecutor; host: DummyToolExecutor } } {
  const policy = defaultSupervisorPolicy();
  policy.allowedModels = [{ provider: "p", id: "m" }];
  policy.worktreeRoot = opts.pool;
  policy.repos = [{ repoId: "r1", checkoutPath: opts.repo, readRoots: opts.readRoots ?? [opts.repo], allowWriters: true }];
  opts.policy?.(policy);
  if (opts.workspace instanceof DummyWorkspaceManager) {
    opts.workspace.checkout = { workTree: opts.repo, gitDir: join(opts.repo, ".git"), head: "c0" };
  }
  const workers: CtlWorker[] = [];
  const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
  const sup = new Supervisor({
    rootId: opts.rootId,
    rootDir: opts.dir,
    store: opts.store ?? new InMemoryRunStore(opts.rootId),
    policy,
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
    executors,
    workspace: opts.workspace,
    governor: opts.governor ?? (() => ({ ...testGovernor(), cwd: opts.repo })),
    ...(opts.hostAgentDir ? { hostAgentDir: opts.hostAgentDir } : {}),
    workerFactory: (o) => {
      const w = new CtlWorker(o.agentId);
      workers.push(w);
      return w;
    },
  });
  return { sup, workers, byAgent: (agentId) => workers.filter((w) => w.agentId === agentId), executors };
}

test("default preserves the exact existing home layout", async () => {
  assert.equal(defaultSupervisorPolicy().worktreeRoot, null);
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-default-"));
  try {
    const repo = gitCheckout(dir);
    const { sup } = mkSup({
      dir: join(dir, "root"),
      workspace: new GitWorkspaceManager(),
      governor: () => ({ ...testGovernor(), cwd: repo }),
    });
    const w = await sup.spawn("governor", { taskName: "w", message: "m", profile: "writer" }, "rw");
    assert.ok(w.workdir.startsWith(join(dir, "root", "worktrees")), w.workdir);
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("custom pooled root is honored with per-session separation (both writer modes)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-custom-"));
  try {
    const repo = gitCheckout(dir);
    const pool = join(dir, "pool");
    mkdirSync(pool, { recursive: true });
    const workspace = new DummyWorkspaceManager();
    workspace.checkout = { workTree: repo, gitDir: join(repo, ".git"), head: "c0" };
    // Genuine retained identity for the proof boundary: allocations back
    // real worktrees so reopen retention proves (H8 correction support).
    workspace.gitRepoDir = repo;
    const { sup } = mkSup({
      dir: join(dir, "root"),
      workspace,
      governor: () => ({ ...testGovernor(), cwd: repo }),
      policy: (p) => {
        p.worktreeRoot = pool;
        p.repos = [{ repoId: "r1", checkoutPath: repo, readRoots: [repo], allowWriters: true }];
      },
    });
    const hostWriter = await sup.spawn("governor", { taskName: "hw", message: "m", profile: "writer", isolation: "worktree" }, "rw1");
    assert.ok(
      hostWriter.workdir.startsWith(join(pool, "root-1", "worktrees")),
      `host worktree not under pooled root: ${hostWriter.workdir}`,
    );
    const sandboxWriter = await sup.spawn(
      "governor",
      { taskName: "sw", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" },
      "rw2",
    );
    assert.ok(
      sandboxWriter.workdir.startsWith(join(pool, "root-1", "worktrees")),
      `sandbox worktree not under pooled root: ${sandboxWriter.workdir}`,
    );
    // Both allocations went through the shared pooled destination.
    assert.equal(workspace.allocations.length, 2);
    for (const a of workspace.allocations) {
      assert.ok(a.worktreePath.startsWith(join(pool, "root-1", "worktrees")), a.worktreePath);
    }
    // Session/log/tmp dirs stay home: the store root is untouched.
    assert.ok(existsSync(join(dir, "root", "MANIFEST.json")) || existsSync(join(dir, "root")));
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed worktreeRoot fails visibly; null/absent stays default", () => {
  assert.equal(validateWorktreeRoot(undefined), null);
  assert.equal(validateWorktreeRoot(null), null);
  assert.equal(validateWorktreeRoot("/srv/nvme/wt"), "/srv/nvme/wt");
  assert.throws(() => validateWorktreeRoot(123), /INVALID/);
  assert.throws(() => validateWorktreeRoot(""), /INVALID/);
  assert.throws(() => validateWorktreeRoot("relative/path"), /INVALID/);
  assert.throws(() => validateWorktreeRoot("C:\\win"), /INVALID/);
  assert.throws(() => validateWorktreeRoot("/has\0nul"), /INVALID/);
});

test("present JSON worktreeRoot is validated strictly (null/default valid)", async () => {
  const { loadPolicy } = await import("../index.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-policy-"));
  const orig = process.env["PI_CODING_AGENT_DIR"];
  try {
    process.env["PI_CODING_AGENT_DIR"] = dir;
    assert.equal(loadPolicy().worktreeRoot, null);
    writeFileSync(join(dir, "subagents-policy.json"), JSON.stringify({ worktreeRoot: null }));
    assert.equal(loadPolicy().worktreeRoot, null);
    writeFileSync(join(dir, "subagents-policy.json"), JSON.stringify({ worktreeRoot: "/srv/nvme/wt" }));
    assert.equal(loadPolicy().worktreeRoot, "/srv/nvme/wt");
    for (const bad of ["relative/path", "", 123, true]) {
      writeFileSync(join(dir, "subagents-policy.json"), JSON.stringify({ worktreeRoot: bad }));
      assert.throws(() => loadPolicy(), /INVALID/, String(bad));
    }
    writeFileSync(join(dir, "subagents-policy.json"), '{"worktreeRoot": "/has\u0000nul"}');
    // A raw NUL byte cannot survive JSON parsing: either the JSON layer or
    // the worktreeRoot validator must fail visibly (never a silent default).
    assert.throws(() => loadPolicy(), /INVALID|POLICY_DENIED/);
  } finally {
    if (orig === undefined) delete process.env["PI_CODING_AGENT_DIR"];
    else process.env["PI_CODING_AGENT_DIR"] = orig;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[git] custom-root allocation keeps diff, retention, and gitdir pinning", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-git-"));
  try {
    const repo = gitCheckout(dir);
    const pool = join(dir, "pool");
    mkdirSync(pool, { recursive: true });
    const mgr = new GitWorkspaceManager();
    const alloc = mgr.allocateWriter("r1", repo, "HEAD", join(pool, "sess-A", "worktrees"));
    assert.ok(alloc.worktreePath.startsWith(join(pool, "sess-A", "worktrees")), alloc.worktreePath);
    assert.ok(existsSync(alloc.worktreePath));
    // Diff is live from the pooled worktree.
    writeFileSync(join(alloc.worktreePath, "new.txt"), "new\n");
    const fp = fingerprintWorktree(alloc, alloc.baseCommit, []);
    assert.equal(fp.files.length, 1);
    assert.equal(fp.files[0]!.path, "new.txt");
    // Retention: release without prune keeps the worktree.
    mgr.releaseAllocation(alloc);
    assert.ok(existsSync(alloc.worktreePath));
    // Gitdir pinning: a rewritten .git file must not steer host git.
    const evil = join(alloc.worktreePath, "evil");
    spawnSync("git", ["init", "-q", evil]);
    const marker = join(dir, "GITREDIR_MARKER");
    spawnSync("git", ["-C", evil, "config", "core.fsmonitor", `touch ${marker}; false`]);
    writeFileSync(join(alloc.worktreePath, ".git"), `gitdir: ${join(evil, ".git")}\n`);
    try {
      fingerprintWorktree(alloc, alloc.baseCommit, []);
    } catch {
      // Refusing the hostile worktree is acceptable; executing its config is not.
    }
    assert.equal(existsSync(marker), false);
    // Prune refuses dirty worktrees without an explicit user action.
    assert.throws(() => mgr.releaseAllocation(alloc, { prune: true }), /CONFLICT|WORKSPACE_UNAVAILABLE|NOT_FOUND/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unwritable pooled destination fails visibly instead of falling back home", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-unwritable-"));
  try {
    const repo = gitCheckout(dir);
    const poolFile = join(dir, "not-a-dir");
    writeFileSync(poolFile, "x\n");
    const { sup } = mkSup({
      dir: join(dir, "root"),
      workspace: new GitWorkspaceManager(),
      governor: () => ({ ...testGovernor(), cwd: repo }),
      policy: (p) => {
        p.worktreeRoot = join(poolFile, "sub");
      },
    });
    await assert.rejects(
      () => sup.spawn("governor", { taskName: "w", message: "m", profile: "writer" }, "rw"),
      /(WORKSPACE_UNAVAILABLE|CONFLICT|ENOTDIR|EACCES|EPERM)/,
    );
    // No home fallback worktree was silently created.
    const homeWts = join(dir, "root", "worktrees");
    assert.equal(!existsSync(homeWts) || readdirSync(homeWts).length === 0, true);
    await sup.shutdown().catch(() => {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pooled root separates two distinct sessions for both writer modes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-sep-"));
  try {
    const repo = gitCheckout(dir);
    const pool = join(dir, "pool");
    mkdirSync(pool, { recursive: true });
    const wsA = new DummyWorkspaceManager();
    const wsB = new DummyWorkspaceManager();
    // Genuine retained identity for the proof boundary (H8 support).
    wsA.gitRepoDir = repo;
    wsB.gitRepoDir = repo;
    const a = mkPooledSup({ rootId: "sess-A", dir: join(dir, "root-A"), pool, workspace: wsA, repo });
    const b = mkPooledSup({ rootId: "sess-B", dir: join(dir, "root-B"), pool, workspace: wsB, repo });
    try {
      const aHost = await a.sup.spawn("governor", { taskName: "a-host", message: "m", profile: "writer", isolation: "worktree" }, "ra-host");
      const bHost = await b.sup.spawn("governor", { taskName: "b-host", message: "m", profile: "writer", isolation: "worktree" }, "rb-host");
      assert.ok(aHost.workdir.startsWith(join(pool, "sess-A", "worktrees")), aHost.workdir);
      assert.ok(bHost.workdir.startsWith(join(pool, "sess-B", "worktrees")), bHost.workdir);
      assert.notEqual(aHost.workdir, bHost.workdir);
      assert.ok(!aHost.workdir.startsWith(join(pool, "sess-B")), aHost.workdir);
      assert.ok(!bHost.workdir.startsWith(join(pool, "sess-A")), bHost.workdir);
      const aSand = await a.sup.spawn("governor", { taskName: "a-sand", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "ra-sand");
      const bSand = await b.sup.spawn("governor", { taskName: "b-sand", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rb-sand");
      assert.ok(aSand.workdir.startsWith(join(pool, "sess-A", "worktrees")), aSand.workdir);
      assert.ok(bSand.workdir.startsWith(join(pool, "sess-B", "worktrees")), bSand.workdir);
      assert.notEqual(aSand.workdir, bSand.workdir);
      for (const alloc of wsA.allocations) assert.ok(alloc.worktreePath.startsWith(join(pool, "sess-A", "worktrees")), alloc.worktreePath);
      for (const alloc of wsB.allocations) assert.ok(alloc.worktreePath.startsWith(join(pool, "sess-B", "worktrees")), alloc.worktreePath);
    } finally {
      await a.sup.shutdown().catch(() => {});
      await b.sup.shutdown().catch(() => {});
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[git] configured-root Supervisor allocation keeps diff and retention", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-git-sup-"));
  try {
    const repo = gitCheckout(dir);
    const pool = join(dir, "pool");
    mkdirSync(pool, { recursive: true });
    const policy = defaultSupervisorPolicy();
    policy.allowedModels = [{ provider: "p", id: "m" }];
    policy.worktreeRoot = pool;
    const workers: CtlWorker[] = [];
    const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
    const { Supervisor: Sup } = await import("../src/supervisor.ts");
    const { InMemoryRunStore: Store } = await import("../src/store.ts");
    const sup = new Sup({
      rootId: "sess-git",
      rootDir: join(dir, "root"),
      store: new Store("sess-git"),
      policy,
      schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
      executors,
      workspace: new GitWorkspaceManager(),
      governor: () => ({ ...testGovernor(), cwd: repo }),
      workerFactory: (o) => {
        const w = new CtlWorker(o.agentId);
        workers.push(w);
        return w;
      },
    });
    try {
      const w = await sup.spawn("governor", { taskName: "gw", message: "m", profile: "writer", isolation: "worktree" }, "rgw");
      assert.ok(w.workdir.startsWith(join(pool, "sess-git", "worktrees")), w.workdir);
      assert.ok(existsSync(w.workdir));
      writeFileSync(join(w.workdir, "via-supervisor.txt"), "through the policy path\n");
      const status = spawnSync("git", ["status", "--porcelain"], { cwd: w.workdir, encoding: "utf8" });
      assert.ok(status.stdout.includes("via-supervisor.txt"), status.stdout);
      // Untracked files never appear in `git diff`: exercise a tracked file
      // so the assertion below demonstrates actual diff content.
      writeFileSync(join(w.workdir, "pkg", "a.txt"), "a\nvia supervisor\n");
      const diff = spawnSync("git", ["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", "."], { cwd: w.workdir, encoding: "utf8" });
      assert.equal(diff.status, 0, diff.stderr);
      assert.ok(diff.stdout.includes("via supervisor"), diff.stdout);
      // Retention: the pooled worktree survives shutdown (no implicit deletion).
      await sup.shutdown();
      assert.ok(existsSync(w.workdir), `pooled worktree pruned on shutdown: ${w.workdir}`);
      assert.ok(existsSync(join(w.workdir, "via-supervisor.txt")));
    } finally {
      await sup.shutdown().catch(() => {});
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pooled root stays hidden from sandbox views except the child's own workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-hide-"));
  try {
    const repo = gitCheckout(dir);
    const outer = join(dir, "srv");
    const pool = join(outer, "pool");
    mkdirSync(pool, { recursive: true });
    const workspace = new DummyWorkspaceManager();
    // Genuine retained identity for the proof boundary (H8 support).
    workspace.gitRepoDir = repo;
    const { sup, byAgent, executors } = mkPooledSup({
      rootId: "sess-hide",
      dir: join(dir, "root"),
      pool,
      workspace,
      repo,
      readRoots: [outer],
    });
    void repo;
    try {
      const s = await sup.spawn("governor", { taskName: "s", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs");
      assert.ok(s.workdir.startsWith(join(pool, "sess-hide", "worktrees")), s.workdir);
      await byAgent(s.agentId)[0]!.call("read", { path: "x" });
      const spec = executors.sandbox.specs.at(-1);
      assert.ok(spec?.view, "sandbox tool job carries no view");
      assert.ok(spec!.view!.readRoots.includes(outer), JSON.stringify(spec!.view!.readRoots));
      assert.ok(spec!.view!.hidePaths.includes(join(dir, "root")), JSON.stringify(spec!.view!.hidePaths));
      assert.ok(spec!.view!.storageRoots?.includes(pool), JSON.stringify(spec!.view!.storageRoots));
      assert.ok(spec!.view!.writableRoot?.startsWith(join(pool, "sess-hide", "worktrees")), String(spec!.view!.writableRoot));
    } finally {
      await sup.shutdown().catch(() => {});
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("[bwrap] pooled sibling content stays hidden while the child's own workspace is usable", async (t) => {
  const exec = new BwrapToolExecutor();
  if (!exec.probe().ok) {
    t.skip("bwrap unavailable; pooled-sibling mask check not executed");
    return;
  }
  console.log("bwrap leg EXECUTED: ancestor readRoot over hard storage namespace");
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-bwrap-"));
  try {
    const outer = join(dir, "srv");
    const pool = join(outer, "pool");
    const own = join(pool, "sess-A", "worktrees", "wt-own");
    const sib = join(pool, "sess-B", "worktrees", "wt-sib");
    const tmp = join(dir, "tmp");
    for (const d of [outer, pool, own, sib, tmp]) mkdirSync(d, { recursive: true });
    writeFileSync(join(own, "own.txt"), "own-workspace\n");
    writeFileSync(join(sib, "secret.txt"), "SECRET-MARKER\n");
    const bash = absBin("bash") ?? "/bin/bash";
    const cat = absBin("cat") ?? "/bin/cat";
    const base = {
      operationId: "op-pool",
      cwd: own,
      env: { PATH: "/usr/bin:/bin" },
      stdin: null,
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
      view: { readRoots: [outer], writableRoot: own, tmpDir: tmp, hidePaths: [], storageRoots: [pool], runtimeRoots: ["/nix/store"], network: false },
    };
    const ownRead = await exec.exec({ ...base, operationId: "op-own", argv: [bash, "-c", `${cat} own.txt`] });
    assert.equal(ownRead.exitCode, 0, ownRead.stderr);
    assert.ok(ownRead.stdout.includes("own-workspace"), ownRead.stdout);
    const sibRead = await exec.exec({ ...base, operationId: "op-sib", argv: [bash, "-c", `${cat} ${join(sib, "secret.txt")}`] });
    assert.notEqual(sibRead.exitCode, 0);
    assert.ok(!sibRead.stdout.includes("SECRET-MARKER"), sibRead.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reconfigured pool keeps exclusions for retained allocations (pool-A to pool-B/null)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-reopen-"));
  try {
    const repo = gitCheckout(dir);
    const outer = join(dir, "srv");
    const poolA = join(outer, "pool-A");
    const poolB = join(outer, "pool-B");
    mkdirSync(poolA, { recursive: true });
    mkdirSync(poolB, { recursive: true });
    // Sibling pooled content predating the reconfigure: retained on disk,
    // never migrated or deleted, and masked from sandbox views afterwards.
    const sibDir = join(poolA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");

    // Phase A: allocate under pool-A, settle, shut down (journal persists).
    const wsA = new DummyWorkspaceManager();
    wsA.gitRepoDir = repo; // Genuine retained identity for the proof boundary (H8 support).
    const a = mkPooledSup({
      rootId: "sess-re", dir: rootDir, pool: poolA, workspace: wsA, repo,
      readRoots: [outer], store: new FileRunStore(rootDir, "sess-re"),
    });
    const s1 = await a.sup.spawn("governor", { taskName: "s1", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs1");
    assert.ok(s1.workdir.startsWith(join(poolA, "sess-re", "worktrees")), s1.workdir);
    writeFileSync(join(s1.workdir, "kept.txt"), "retained\n");
    a.byAgent(s1.agentId)[0]!.settle();
    await tick(50);
    await a.sup.shutdown();

    // Phase B: reopen the same journal with pool-B.
    const wsB = new DummyWorkspaceManager();
    wsB.gitRepoDir = repo; // Genuine retained identity for the proof boundary (H8 support).
    const b = mkPooledSup({
      rootId: "sess-re", dir: rootDir, pool: poolB, workspace: wsB, repo,
      readRoots: [outer], store: new FileRunStore(rootDir, "sess-re"),
    });
    try {
      // The retained record keeps its pool-A path; nothing was migrated.
      const retained = b.sup.list("governor").find((v) => v.id === s1.agentId);
      assert.ok(retained, "retained agent missing after reopen");
      assert.equal(retained!.workdir, s1.workdir);
      assert.ok(existsSync(join(s1.workdir, "kept.txt")), "retained workspace content lost");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "reopen must not delete pooled files");
      // The retained agent resumes in its original pooled workspace.
      await b.sup.sendMessage("governor", s1.agentId, "task", "again", {}, "re2");
      await tick(50);
      const resumed = b.byAgent(s1.agentId)[0];
      assert.ok(resumed?.init, "retained agent did not resume");
      assert.equal(String(resumed!.init!["workdir"]), s1.workdir);
      // Its sandbox view still masks pool-A (retained) alongside pool-B
      // (current) while re-exposing its own pool-A workspace.
      await resumed!.call("read", { path: "x" });
      const specB = b.executors.sandbox.specs.at(-1);
      assert.ok(specB?.view?.storageRoots?.includes(poolA), JSON.stringify(specB?.view?.storageRoots));
      assert.ok(specB?.view?.storageRoots?.includes(poolB), JSON.stringify(specB?.view?.storageRoots));
      assert.ok(specB?.view?.writableRoot?.startsWith(join(poolA, "sess-re", "worktrees")), String(specB?.view?.writableRoot));
      // A fresh agent allocates under pool-B under the same masking.
      const s2 = await b.sup.spawn("governor", { taskName: "s2", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs2");
      assert.ok(s2.workdir.startsWith(join(poolB, "sess-re", "worktrees")), s2.workdir);
      await b.byAgent(s2.agentId)[0]!.call("read", { path: "x" });
      const specB2 = b.executors.sandbox.specs.at(-1);
      assert.ok(specB2?.view?.storageRoots?.includes(poolA), JSON.stringify(specB2?.view?.storageRoots));
      assert.ok(specB2?.view?.storageRoots?.includes(poolB), JSON.stringify(specB2?.view?.storageRoots));
    } finally {
      await b.sup.shutdown().catch(() => {});
    }

    // Phase C: reopen with null (home layout) — retained pools stay masked.
    const wsC = new DummyWorkspaceManager();
    wsC.gitRepoDir = repo; // Genuine retained identity for the proof boundary (H8 support).
    const c = mkPooledSup({
      rootId: "sess-re", dir: rootDir, pool: null, workspace: wsC, repo,
      readRoots: [outer], store: new FileRunStore(rootDir, "sess-re"),
    });
    try {
      const s3 = await c.sup.spawn("governor", { taskName: "s3", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs3");
      await c.byAgent(s3.agentId)[0]!.call("read", { path: "x" });
      const specC = c.executors.sandbox.specs.at(-1);
      assert.ok(specC?.view?.storageRoots?.includes(poolA), JSON.stringify(specC?.view?.storageRoots));
      assert.ok(specC?.view?.storageRoots?.includes(poolB), JSON.stringify(specC?.view?.storageRoots));
      assert.ok(existsSync(join(s1.workdir, "kept.txt")), "retained pool-A workspace lost after null reconfigure");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling pooled content lost after null reconfigure");
    } finally {
      await c.sup.shutdown().catch(() => {});
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aliased retained pool under a protected dir stays masked after reconfigure", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-alias-"));
  try {
    const repo = gitCheckout(dir);
    const hostAgentDir = join(dir, "host-agent");
    mkdirSync(hostAgentDir, { recursive: true });
    // The pool is an alias inside the protected credential dir pointing
    // outside it; the approved read root covers the canonical target.
    const actual = join(dir, "srv", "poolA");
    mkdirSync(actual, { recursive: true });
    const alias = join(hostAgentDir, "pool-link");
    symlinkSync(actual, alias);
    const poolB = join(dir, "srv", "poolB");
    mkdirSync(poolB, { recursive: true });
    const outer = join(dir, "srv");
    const rootDir = join(dir, "root");

    // Phase A: allocate a sandbox writer through the alias.
    const wsA = new DummyWorkspaceManager();
    wsA.gitRepoDir = repo; // Genuine retained identity for the proof boundary (H8 support).
    const a = mkPooledSup({
      rootId: "sess-al", dir: rootDir, pool: alias, workspace: wsA, repo,
      readRoots: [outer], store: new FileRunStore(rootDir, "sess-al"), hostAgentDir,
    });
    const s1 = await a.sup.spawn("governor", { taskName: "s1", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs1");
    // Physical truth is pinned at allocation: the workdir names the
    // canonical target, never the mutable alias.
    assert.ok(s1.workdir.startsWith(join(actual, "sess-al", "worktrees")), s1.workdir);
    writeFileSync(join(s1.workdir, "kept.txt"), "retained\n");
    // Sibling content at the canonical target, outside the protected dir.
    const sibDir = join(actual, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    a.byAgent(s1.agentId)[0]!.settle();
    await tick(50);
    await a.sup.shutdown();

    // Phase B: reopen the same journal with pool-B.
    const wsB = new DummyWorkspaceManager();
    wsB.gitRepoDir = repo; // Genuine retained identity for the proof boundary (H8 support).
    const b = mkPooledSup({
      rootId: "sess-al", dir: rootDir, pool: poolB, workspace: wsB, repo,
      readRoots: [outer], store: new FileRunStore(rootDir, "sess-al"), hostAgentDir,
    });
    try {
      // Saved paths unchanged; nothing migrated or deleted.
      const retained = b.sup.list("governor").find((v) => v.id === s1.agentId);
      assert.ok(retained, "retained agent missing after reopen");
      assert.equal(retained!.workdir, s1.workdir);
      assert.ok(existsSync(join(s1.workdir, "kept.txt")), "retained workspace content lost");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "reopen must not delete pooled files");
      // The original workspace is still usable.
      await b.sup.sendMessage("governor", s1.agentId, "task", "again", {}, "re-al2");
      await tick(50);
      const resumed = b.byAgent(s1.agentId)[0];
      assert.ok(resumed?.init, "retained agent did not resume");
      assert.equal(String(resumed!.init!["workdir"]), s1.workdir);
      // The view masks the alias AND its canonical target (not just the
      // lexical alias inside the already-hidden credential dir).
      await resumed!.call("read", { path: "x" });
      const specB = b.executors.sandbox.specs.at(-1);
      assert.ok(specB?.view?.storageRoots?.includes(actual), JSON.stringify(specB?.view?.storageRoots));
      assert.ok(specB?.view?.storageRoots?.includes(poolB), JSON.stringify(specB?.view?.storageRoots));
      const s2 = await b.sup.spawn("governor", { taskName: "s2", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs2");
      assert.ok(s2.workdir.startsWith(join(poolB, "sess-al", "worktrees")), s2.workdir);
    } finally {
      await b.sup.shutdown().catch(() => {});
    }

    // Phase C: reopen with null — the aliased pool stays masked.
    const wsC = new DummyWorkspaceManager();
    wsC.gitRepoDir = repo; // Genuine retained identity for the proof boundary (H8 support).
    const c = mkPooledSup({
      rootId: "sess-al", dir: rootDir, pool: null, workspace: wsC, repo,
      readRoots: [outer], store: new FileRunStore(rootDir, "sess-al"), hostAgentDir,
    });
    let recordedStorage: string[] = [];
    try {
      const s3 = await c.sup.spawn("governor", { taskName: "s3", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs3");
      await c.byAgent(s3.agentId)[0]!.call("read", { path: "x" });
      const specC = c.executors.sandbox.specs.at(-1);
      assert.ok(specC?.view?.storageRoots?.includes(actual), JSON.stringify(specC?.view?.storageRoots));
      recordedStorage = [...specC!.view!.storageRoots ?? []];
      assert.ok(existsSync(join(s1.workdir, "kept.txt")), "retained workspace lost after null reconfigure");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling content lost after null reconfigure");
    } finally {
      await c.sup.shutdown().catch(() => {});
    }

    // Strict bwrap leg on the recorded null-phase storage set: the sibling
    // at the canonical target is DENIED exactly, the own workspace stays
    // usable, and an unmasked control still reads the sibling (mask
    // load-bearing). Reported as a skipped subtest where bwrap is
    // unavailable, never a silent pass.
    await t.test("bwrap: aliased storage namespace masks the sibling", async (st) => {
      const exec = new BwrapToolExecutor();
      if (!exec.probe().ok) {
        st.skip("bwrap unavailable; alias-mask namespace check not executed");
        return;
      }
      console.log("bwrap leg EXECUTED: alias/canonical storage namespace");
      const tmp = join(dir, "tmp");
      mkdirSync(tmp, { recursive: true });
      const bash = absBin("bash") ?? "/bin/bash";
      const cat = absBin("cat") ?? "/bin/cat";
      const view = { readRoots: [outer], writableRoot: s1.workdir, tmpDir: tmp, hidePaths: [] as string[], storageRoots: recordedStorage, runtimeRoots: ["/nix/store"], network: false };
      const ownRead = await exec.exec({ operationId: "op-alias-own", argv: [bash, "-c", `${cat} kept.txt`], cwd: s1.workdir, env: { PATH: "/usr/bin:/bin" }, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view });
      assert.equal(ownRead.exitCode, 0, ownRead.stderr);
      assert.ok(ownRead.stdout.includes("retained"), ownRead.stdout);
      const sibRead = await exec.exec({ operationId: "op-alias-sib", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: s1.workdir, env: { PATH: "/usr/bin:/bin" }, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view });
      assert.notEqual(sibRead.exitCode, 0, `sibling pooled content readable: ${sibRead.stdout}`);
      assert.ok(!sibRead.stdout.includes("SECRET-MARKER"), sibRead.stdout);
      const control = await exec.exec({ operationId: "op-alias-ctl", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: s1.workdir, env: { PATH: "/usr/bin:/bin" }, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...view, storageRoots: [] } });
      assert.equal(control.exitCode, 0, `control could not read sibling even unmasked: ${control.stderr}`);
      assert.ok(control.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Joined teardown: a primary and a cleanup failure produce one joined
 * error; either alone propagates as-is. Neither is ever swallowed. */
async function teardownJoin(cleanup: () => Promise<unknown>, primary: unknown, label: string): Promise<void> {
  let secondary: unknown = null;
  try {
    await cleanup();
  } catch (e) {
    secondary = e;
  }
  if (primary !== null && secondary !== null) {
    throw new Error(`${label}: primary failure: ${String(primary)}; teardown failure: ${String(secondary)}`);
  }
  if (secondary !== null) throw secondary;
  if (primary !== null) throw primary;
}

/** Awaited public checkpoint: poll the public journal until the task terminal fact lands. */
async function awaitTerminal(store: FileRunStore, taskRunId: string): Promise<void> {
  const deadline = Date.now() + 10000;
  for (;;) {
    const { records } = store.readSince(0, 100000);
    if (records.some((r) => r.kind === "task.terminal" && r.body.taskRunId === taskRunId)) return;
    if (Date.now() > deadline) throw new Error(`no terminal fact for ${taskRunId}`);
    await tick(50);
  }
}

test("unprovable missing leaf fails closed after reconfigure", async (t) => {
  // Human-approved fail-closed contract (P5): a retained workspace whose
  // leaf is missing cannot complete its provenance proof, so every
  // sandbox tool view fails visibly with zero handler entry — even when
  // the persisted backlink still names the recorded path (naming
  // consistency is not physical provenance). This knowingly changes the
  // old missing-leaf masking availability: no silent fallback masks a
  // namespace the proof could not establish.
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-missingleaf-"));
  try {
    const repo = gitCheckout(dir);
    const hostAgentDir = join(dir, "host-agent");
    mkdirSync(hostAgentDir, { recursive: true });
    // Alias pool inside the protected dir pointing outside it; the approved
    // read root covers the canonical target.
    const actual = join(dir, "srv", "poolA");
    mkdirSync(actual, { recursive: true });
    const alias = join(hostAgentDir, "pool-link");
    symlinkSync(actual, alias);
    const poolB = join(dir, "srv", "poolB");
    mkdirSync(poolB, { recursive: true });
    const outer = join(dir, "srv");
    const rootDir = join(dir, "root");

    // Phase A: allocate through the alias, settle, shut down.
    const wsA = new DummyWorkspaceManager();
    wsA.gitRepoDir = repo; // Genuine retained identity for the proof boundary (H8 support).
    const a = mkPooledSup({
      rootId: "sess-miss", dir: rootDir, pool: alias, workspace: wsA, repo,
      readRoots: [outer], store: new FileRunStore(rootDir, "sess-miss"), hostAgentDir,
    });
    const s1 = await a.sup.spawn("governor", { taskName: "s1", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs1");
    // Physical truth is pinned at allocation: the workdir names the
    // canonical target, never the mutable alias.
    assert.ok(s1.workdir.startsWith(join(actual, "sess-miss", "worktrees")), s1.workdir);
    writeFileSync(join(s1.workdir, "kept.txt"), "retained\n");
    const sibDir = join(actual, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    a.byAgent(s1.agentId)[0]!.settle();
    await tick(50);
    await a.sup.shutdown();
    // Rename the owned leaf aside: the pool base, alias, canonical target,
    // and sibling content all remain — only the recorded leaf is gone.
    renameSync(s1.workdir, `${s1.workdir}.aside`);
    assert.equal(existsSync(s1.workdir), false);
    assert.ok(existsSync(alias) && existsSync(actual));
    assert.ok(existsSync(join(sibDir, "secret.txt")));

    // Phase B: reopen with pool-B. Pointers preserved; a fresh sandbox
    // reader's tool call fails visibly with zero handler entry because
    // the missing leaf leaves the retained namespace unprovable — the
    // recorded pool is NOT masked on fallback anymore.
    const wsB = new DummyWorkspaceManager();
    wsB.gitRepoDir = repo; // Genuine retained identity for the proof boundary (H8 support).
    const b = mkPooledSup({
      rootId: "sess-miss", dir: rootDir, pool: poolB, workspace: wsB, repo,
      readRoots: [outer], store: new FileRunStore(rootDir, "sess-miss"), hostAgentDir,
    });
    let primaryB: unknown = null;
    try {
      const retained = b.sup.list("governor").find((v) => v.id === s1.agentId);
      assert.ok(retained, "retained agent missing after reopen");
      assert.equal(retained!.workdir, s1.workdir);
      assert.ok(existsSync(`${s1.workdir}.aside`), "renamed-aside workspace files lost");
      const rB = await b.sup.spawn("governor", { taskName: "rB", message: "m", profile: "reader", isolation: "sandbox", repoId: "r1" }, "rrB");
      const before = b.executors.sandbox.specs.length;
      const resB: any = await b.byAgent(rB.agentId)[0]!.call("read", { path: "x" });
      assert.equal(resB.isError, true, "unprovable retained namespace admitted a tool call");
      assert.match(resB.content, /WORKSPACE_UNAVAILABLE: retained workspace identity unprovable/, `wrong denial: ${String(resB.content).slice(0, 160)}`);
      assert.equal(b.executors.sandbox.specs.length - before, 0, "handler entered for an unprovable namespace");
    } catch (e) {
      primaryB = e;
    }
    await teardownJoin(() => b.sup.shutdown(), primaryB, "B");

    // Phase C: reopen with null — same visible failure, files and
    // pointers intact.
    const wsC = new DummyWorkspaceManager();
    wsC.gitRepoDir = repo; // Genuine retained identity for the proof boundary (H8 support).
    const c = mkPooledSup({
      rootId: "sess-miss", dir: rootDir, pool: null, workspace: wsC, repo,
      readRoots: [outer], store: new FileRunStore(rootDir, "sess-miss"), hostAgentDir,
    });
    let primaryC: unknown = null;
    try {
      const retained = c.sup.list("governor").find((v) => v.id === s1.agentId);
      assert.ok(retained, "retained agent missing after null reopen");
      assert.equal(retained!.workdir, s1.workdir);
      const rC = await c.sup.spawn("governor", { taskName: "rC", message: "m", profile: "reader", isolation: "sandbox", repoId: "r1" }, "rrC");
      const before = c.executors.sandbox.specs.length;
      const resC: any = await c.byAgent(rC.agentId)[0]!.call("read", { path: "x" });
      assert.equal(resC.isError, true, "unprovable retained namespace admitted a tool call");
      assert.match(resC.content, /WORKSPACE_UNAVAILABLE: retained workspace identity unprovable/, `wrong denial: ${String(resC.content).slice(0, 160)}`);
      assert.equal(c.executors.sandbox.specs.length - before, 0, "handler entered for an unprovable namespace");
      assert.ok(existsSync(`${s1.workdir}.aside`), "workspace files lost after null reconfigure");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling content lost after null reconfigure");
    } catch (e) {
      primaryC = e;
    }
    await teardownJoin(() => c.sup.shutdown(), primaryC, "C");

    // Strict bwrap leg on a manually built exact-actual mask (no view is
    // assembled anymore for the unprovable namespace): the sibling at the
    // canonical target is DENIED exactly by the mask mechanism itself;
    // an unmasked control still reads it. Reported as a skipped subtest
    // where bwrap is unavailable, never a silent pass.
    await t.test("bwrap: exact canonical mask still denies the sibling", async (st) => {
      const exec = new BwrapToolExecutor();
      if (!exec.probe().ok) {
        st.skip("bwrap unavailable; exact-mask namespace check not executed");
        return;
      }
      console.log("bwrap leg EXECUTED: exact canonical mask");
      const tmp = join(dir, "tmp");
      mkdirSync(tmp, { recursive: true });
      const bash = absBin("bash") ?? "/bin/bash";
      const cat = absBin("cat") ?? "/bin/cat";
      const view = { readRoots: [outer], writableRoot: null as string | null, tmpDir: tmp, hidePaths: [] as string[], storageRoots: [actual], runtimeRoots: ["/nix/store"], network: false };
      const sibRead = await exec.exec({ operationId: "op-miss-sib", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: tmp, env: { PATH: "/usr/bin:/bin" }, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view });
      assert.notEqual(sibRead.exitCode, 0, `sibling pooled content readable: ${sibRead.stdout}`);
      assert.ok(!sibRead.stdout.includes("SECRET-MARKER"), sibRead.stdout);
      const control = await exec.exec({ operationId: "op-miss-ctl", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: tmp, env: { PATH: "/usr/bin:/bin" }, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...view, storageRoots: [] } });
      assert.equal(control.exitCode, 0, `control could not read sibling even unmasked: ${control.stderr}`);
      assert.ok(control.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("storage namespace masks equality and descendant read roots (Sup-driven)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-nseq-"));
  try {
    const repo = gitCheckout(dir);
    const pool = join(dir, "pool");
    mkdirSync(pool, { recursive: true });
    // Other-session sibling content inside the same pool.
    const sibDir = join(pool, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const workspace = new DummyWorkspaceManager();
    workspace.gitRepoDir = repo; // Genuine retained identity for the proof boundary (H8 support).
    const { sup, byAgent, executors } = mkPooledSup({
      rootId: "sess-ns",
      dir: join(dir, "root"),
      pool,
      workspace,
      repo,
      readRoots: [pool],
      policy: (p) => {
        // Overlapping approval nested under the pool: the sibling dir
        // itself as an approved read root. Storage overlap fails closed.
        p.repos.push({ repoId: "r-nested", checkoutPath: repo, readRoots: [sibDir], allowWriters: true });
      },
    });
    try {
      // Equality: the approved read root IS the pool.
      const sEq = await sup.spawn("governor", { taskName: "eq", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1", skills: ["deploy"] }, "r-eq");
      assert.ok(sEq.workdir.startsWith(join(pool, "sess-ns", "worktrees")), sEq.workdir);
      writeFileSync(join(sEq.workdir, "own.txt"), "own-eq\n");
      await byAgent(sEq.agentId)[0]!.call("read", { path: "x" });
      const specEq = executors.sandbox.specs.at(-1);
      assert.ok(specEq?.view?.readRoots.includes(pool), JSON.stringify(specEq?.view?.readRoots));
      // Shared skill/context resources still flow through the existing route.
      assert.ok(specEq?.view?.readRoots.includes("/skills/deploy"), JSON.stringify(specEq?.view?.readRoots));
      assert.ok(specEq?.view?.storageRoots?.includes(pool), JSON.stringify(specEq?.view?.storageRoots));
      // Descendant: the approved read root nests under the pool.
      const sNest = await sup.spawn("governor", { taskName: "nest", message: "m", profile: "writer", isolation: "sandbox", repoId: "r-nested" }, "r-nest");
      assert.ok(sNest.workdir.startsWith(join(pool, "sess-ns", "worktrees")), sNest.workdir);
      writeFileSync(join(sNest.workdir, "own.txt"), "own-nest\n");
      await byAgent(sNest.agentId)[0]!.call("read", { path: "x" });
      const specNest = executors.sandbox.specs.at(-1);
      assert.ok(specNest?.view?.readRoots.includes(sibDir), JSON.stringify(specNest?.view?.readRoots));
      assert.ok(specNest?.view?.storageRoots?.includes(pool), JSON.stringify(specNest?.view?.storageRoots));

      const eqView = { readRoots: [...specEq!.view!.readRoots], writableRoot: sEq.workdir, tmpDir: specEq!.view!.tmpDir, hidePaths: [...specEq!.view!.hidePaths], storageRoots: [...specEq!.view!.storageRoots ?? []], runtimeRoots: ["/nix/store"], network: false };
      const nestView = { readRoots: [...specNest!.view!.readRoots], writableRoot: sNest.workdir, tmpDir: specNest!.view!.tmpDir, hidePaths: [...specNest!.view!.hidePaths], storageRoots: [...specNest!.view!.storageRoots ?? []], runtimeRoots: ["/nix/store"], network: false };

      await t.test("bwrap: equality readRoot keeps own usable, sibling denied", async (st) => {
        const exec = new BwrapToolExecutor();
        if (!exec.probe().ok) {
          st.skip("bwrap unavailable; equality-namespace check not executed");
          return;
        }
        console.log("bwrap leg EXECUTED: equality readRoot storage namespace");
        const bash = absBin("bash") ?? "/bin/bash";
        const cat = absBin("cat") ?? "/bin/cat";
        const env = { PATH: "/usr/bin:/bin" };
        const ownRead = await exec.exec({ operationId: "op-ns-eq-own", argv: [bash, "-c", `${cat} own.txt`], cwd: sEq.workdir, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: eqView });
        assert.equal(ownRead.exitCode, 0, ownRead.stderr);
        assert.ok(ownRead.stdout.includes("own-eq"), ownRead.stdout);
        const sibRead = await exec.exec({ operationId: "op-ns-eq-sib", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: sEq.workdir, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: eqView });
        assert.notEqual(sibRead.exitCode, 0, `sibling readable under equality readRoot: ${sibRead.stdout}`);
        assert.ok(!sibRead.stdout.includes("SECRET-MARKER"), sibRead.stdout);
        const control = await exec.exec({ operationId: "op-ns-eq-ctl", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: sEq.workdir, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...eqView, storageRoots: [] } });
        assert.equal(control.exitCode, 0, `control unreadable even unmasked: ${control.stderr}`);
        assert.ok(control.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
      });

      await t.test("bwrap: descendant readRoot keeps own usable, sibling denied", async (st) => {
        const exec = new BwrapToolExecutor();
        if (!exec.probe().ok) {
          st.skip("bwrap unavailable; descendant-namespace check not executed");
          return;
        }
        console.log("bwrap leg EXECUTED: descendant readRoot storage namespace");
        const bash = absBin("bash") ?? "/bin/bash";
        const cat = absBin("cat") ?? "/bin/cat";
        const env = { PATH: "/usr/bin:/bin" };
        const ownRead = await exec.exec({ operationId: "op-ns-nest-own", argv: [bash, "-c", `${cat} own.txt`], cwd: sNest.workdir, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: nestView });
        assert.equal(ownRead.exitCode, 0, ownRead.stderr);
        assert.ok(ownRead.stdout.includes("own-nest"), ownRead.stdout);
        const sibRead = await exec.exec({ operationId: "op-ns-nest-sib", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: sNest.workdir, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: nestView });
        assert.notEqual(sibRead.exitCode, 0, `sibling readable under descendant readRoot: ${sibRead.stdout}`);
        assert.ok(!sibRead.stdout.includes("SECRET-MARKER"), sibRead.stdout);
        const control = await exec.exec({ operationId: "op-ns-nest-ctl", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: sNest.workdir, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...nestView, storageRoots: [] } });
        assert.equal(control.exitCode, 0, `control unreadable even unmasked: ${control.stderr}`);
        assert.ok(control.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
      });
    } finally {
      await sup.shutdown().catch(() => {});
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Bwrap executor, required: closure validation must execute natively here. */
function requireBwrap(): BwrapToolExecutor {
  const exec = new BwrapToolExecutor();
  assert.ok(exec.probe().ok, "bwrap required on this host for closure validation");
  return exec;
}

/** Call through a just-dispatched reviewer, waiting out pre-dispatch unready states (bounded). */
async function reviewerCall(w: CtlWorker, tool: string, args: Record<string, unknown>): Promise<{ content: string; isError: boolean }> {
  let last: { content: string; isError: boolean } = { content: "<no attempt>", isError: true };
  for (let i = 0; i < 100; i++) {
    try {
      last = await w.call(tool, args);
    } catch (e) {
      last = { content: `THREW: ${(e as Error).message}`, isError: true };
    }
    if (!/STALE_GENERATION|no admitted execution|not running|no active run/i.test(last.content)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

test("managed reviewer and checks get an exact read-only candidate exception (view)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-gateview-"));
  try {
    const repo = gitCheckout(dir);
    const pool = join(dir, "pool");
    mkdirSync(pool, { recursive: true });
    const shared = join(dir, "shared");
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(shared, "shared.txt"), "shared-route\n");
    const workers: CtlWorker[] = [];
    const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
    const policy = defaultSupervisorPolicy();
    policy.allowedModels = [{ provider: "p", id: "m" }];
    policy.worktreeRoot = pool;
    policy.repos = [{ repoId: "r1", checkoutPath: repo, readRoots: [repo, shared], allowWriters: true }];
    const sup = new Supervisor({
      rootId: "sess-gv",
      rootDir: join(dir, "root"),
      store: new InMemoryRunStore("sess-gv"),
      policy,
      schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
      executors,
      // Real git backend: the gate fingerprints the candidate worktree.
      workspace: new GitWorkspaceManager(),
      governor: () => ({ ...testGovernor(), cwd: repo }),
      workerFactory: (o) => {
        const w = new CtlWorker(o.agentId);
        workers.push(w);
        return w;
      },
    });
    try {
      const main = await sup.spawn("governor", { taskName: "g", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1", gate: gateSpec() }, "rgv");
      const marker = join(main.workdir, "candidate.txt");
      writeFileSync(marker, "CANDIDATE-MARKER\n");
      workers[0]!.settle("succeeded", "done");
      await until(() => workers.length >= 2 && workers[1]!.init !== null, 15000, "reviewer dispatch");
      const reviewer = workers[1]!;
      const read = await reviewerCall(reviewer, "read", { path: marker });
      assert.equal(read.isError, false, read.content);
      const spec = executors.sandbox.specs.at(-1);
      assert.deepEqual(spec?.view?.readOnlyRoots, [main.workdir]);
      assert.ok(spec?.view?.storageRoots?.includes(pool), JSON.stringify(spec?.view?.storageRoots));
      const ck = await sup.runCheck(main.agentId, main.taskRunId, { id: "c1", command: "true", timeoutMs: 5000 });
      assert.equal(ck.exitCode, 0, ck.output);
      const ckSpec = executors.sandbox.specs.at(-1);
      assert.deepEqual(ckSpec?.view?.readOnlyRoots, [main.workdir]);
      const denied = await reviewerCall(reviewer, "write", { path: "x", content: "y" });
      assert.equal(denied.isError, true);
    } finally {
      await sup.shutdown().catch(() => {});
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pooled managed reviewer and controller check read the candidate (bwrap)", async (t) => {
  if (!new BwrapToolExecutor().probe().ok) {
    t.skip("bwrap unavailable; gated-candidate namespace check not executed");
    return;
  }
  console.log("bwrap leg EXECUTED: gated candidate read-only exception");

  async function gatedFlow(usePool: boolean): Promise<{
    candidateRead: { content: string; isError: boolean };
    check: { exitCode: number | null; output: string };
    siblingRead: { content: string; isError: boolean };
    writeDenied: boolean;
    sharedRead: { content: string; isError: boolean };
    gitStatus: number | null;
  }> {
    const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-gatebw-"));
    try {
      const repo = gitCheckout(dir);
      const pool = join(dir, "pool");
      mkdirSync(pool, { recursive: true });
      const shared = join(dir, "shared");
      mkdirSync(shared, { recursive: true });
      writeFileSync(join(shared, "shared.txt"), "shared-route\n");
      const sibDir = pool ? join(usePool ? pool : join(dir, "sib-outside"), "sess-other", "worktrees", "wt-sib") : join(dir, "sib-outside");
      mkdirSync(sibDir, { recursive: true });
      writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
      const workers: CtlWorker[] = [];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.worktreeRoot = usePool ? pool : null;
      policy.repos = [{ repoId: "r1", checkoutPath: repo, readRoots: [repo, shared], allowWriters: true }];
      const sup = new Supervisor({
        rootId: "sess-gb",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("sess-gb"),
        policy,
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
        executors: { sandbox: new BwrapToolExecutor(), host: new HostToolExecutor() },
        workspace: new GitWorkspaceManager(),
        governor: () => ({ ...testGovernor(), cwd: repo }),
        workerFactory: (o) => {
          const w = new CtlWorker(o.agentId);
          workers.push(w);
          return w;
        },
      });
      try {
        const main = await sup.spawn("governor", { taskName: "g", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1", gate: gateSpec() }, `rgb-${usePool}`);
        const marker = join(main.workdir, "candidate.txt");
        writeFileSync(marker, "CANDIDATE-MARKER\n");
        workers[0]!.settle("succeeded", "done");
        await until(() => workers.length >= 2 && workers[1]!.init !== null, 15000, "reviewer dispatch");
        const reviewer = workers[1]!;
        const candidateRead = await reviewerCall(reviewer, "read", { path: marker });
        const check = await sup.runCheck(main.agentId, main.taskRunId, { id: "c1", command: `cat ${marker}`, timeoutMs: 30000 });
        const siblingRead = await reviewerCall(reviewer, "read", { path: join(sibDir, "secret.txt") });
        const writeDenied = (await reviewerCall(reviewer, "write", { path: "x", content: "y" })).isError;
        const sharedRead = await reviewerCall(reviewer, "read", { path: join(shared, "shared.txt") });
        const gitStatus = spawnSync("git", ["status", "--porcelain"], { cwd: main.workdir, encoding: "utf8" }).status;
        return { candidateRead, check, siblingRead, writeDenied, sharedRead, gitStatus };
      } finally {
        await sup.shutdown().catch(() => {});
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const pooled = await gatedFlow(true);
  assert.equal(pooled.candidateRead.isError, false, pooled.candidateRead.content);
  assert.ok(pooled.candidateRead.content.includes("CANDIDATE-MARKER"), pooled.candidateRead.content);
  assert.equal(pooled.check.exitCode, 0, pooled.check.output);
  assert.ok(pooled.check.output.includes("CANDIDATE-MARKER"), pooled.check.output);
  assert.equal(pooled.siblingRead.isError, true);
  assert.ok(!pooled.siblingRead.content.includes("SECRET-MARKER"), pooled.siblingRead.content.slice(0, 200));
  assert.equal(pooled.writeDenied, true);
  assert.equal(pooled.sharedRead.isError, false, pooled.sharedRead.content);
  assert.equal(pooled.gitStatus, 0);

  const home = await gatedFlow(false);
  assert.equal(home.candidateRead.isError, false, home.candidateRead.content);
  assert.equal(home.check.exitCode, 0, home.check.output);
  assert.equal(home.siblingRead.isError, true);
});

test("retained pool under a protected dir stays hard-masked after reconfigure", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-underprot-"));
  try {
    const repo = gitCheckout(dir);
    const hostAgentDir = join(dir, "host-agent");
    mkdirSync(hostAgentDir, { recursive: true });
    // Configured pool physically UNDER the protected credential dir.
    const poolA = join(hostAgentDir, "poolA");
    mkdirSync(poolA, { recursive: true });
    const poolB = join(dir, "srv", "poolB");
    mkdirSync(poolB, { recursive: true });
    const sibDir = join(poolA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");
    const open = (pool: string | null, ws: DummyWorkspaceManager) => {
      // Genuine retained identity for the proof boundary (H8 support).
      ws.gitRepoDir = repo;
      return mkPooledSup({ rootId: "sess-up", dir: rootDir, pool, workspace: ws, repo, readRoots: [poolA], store: new FileRunStore(rootDir, "sess-up"), hostAgentDir });
    };

    // Phase A: allocate under poolA, settle, shut down (journal persists).
    const a = open(poolA, new DummyWorkspaceManager());
    const s1 = await a.sup.spawn("governor", { taskName: "s1", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs1");
    assert.ok(s1.workdir.startsWith(join(poolA, "sess-up", "worktrees")), s1.workdir);
    writeFileSync(join(s1.workdir, "kept.txt"), "retained\n");
    a.byAgent(s1.agentId)[0]!.settle();
    await tick(50);
    await a.sup.shutdown();

    async function freshReaderView(pool: string | null, reqId: string): Promise<{ storage: string[]; readRoots: string[] }> {
      const h = open(pool, new DummyWorkspaceManager());
      try {
        const r = await h.sup.spawn("governor", { taskName: `r-${reqId}`, message: "m", profile: "reader", isolation: "sandbox", repoId: "r1" }, `rr-${reqId}`);
        await h.byAgent(r.agentId)[0]!.call("read", { path: "x" });
        const spec: any = h.executors.sandbox.specs.at(-1);
        return { storage: [...(spec?.view?.storageRoots ?? [])], readRoots: [...(spec?.view?.readRoots ?? [])] };
      } finally {
        await h.sup.shutdown().catch(() => {});
      }
    }

    const viewB = await freshReaderView(poolB, "B");
    assert.ok(viewB.readRoots.includes(poolA), JSON.stringify(viewB));
    assert.ok(viewB.storage.includes(poolA), JSON.stringify(viewB));
    assert.ok(viewB.storage.includes(poolB), JSON.stringify(viewB));
    const viewC = await freshReaderView(null, "C");
    assert.ok(viewC.storage.includes(poolA), JSON.stringify(viewC));
    const retained = await (async () => {
      const h = open(null, new DummyWorkspaceManager());
      try {
        return h.sup.list("governor").find((v) => v.id === s1.agentId) ?? null;
      } finally {
        await h.sup.shutdown().catch(() => {});
      }
    })();
    assert.ok(retained, "retained agent missing after reopen");
    assert.equal(retained!.workdir, s1.workdir);
    assert.ok(existsSync(join(s1.workdir, "kept.txt")), "retained workspace content lost");
    assert.ok(existsSync(join(sibDir, "secret.txt")), "reopen must not delete pooled files");

    // Exact namespace legs on the recorded null-phase view: the old-pool
    // sibling is DENIED while an unmasked control reads it.
    await t.test("bwrap: under-protected retained pool masks the sibling", async (st) => {
      const exec = new BwrapToolExecutor();
      if (!exec.probe().ok) {
        st.skip("bwrap unavailable; under-protected namespace check not executed");
        return;
      }
      console.log("bwrap leg EXECUTED: under-protected retained pool namespace");
      const tmp = join(dir, "tmp");
      mkdirSync(tmp, { recursive: true });
      const bash = absBin("bash") ?? "/bin/bash";
      const cat = absBin("cat") ?? "/bin/cat";
      const env = { PATH: "/usr/bin:/bin" };
      const view = { readRoots: [poolA], writableRoot: null as string | null, tmpDir: tmp, hidePaths: [] as string[], storageRoots: viewC.storage, runtimeRoots: ["/nix/store"], network: false };
      const sibRead = await exec.exec({ operationId: "op-up-sib", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: tmp, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view });
      assert.notEqual(sibRead.exitCode, 0, `old-pool sibling readable: ${sibRead.stdout}`);
      assert.ok(!sibRead.stdout.includes("SECRET-MARKER"), sibRead.stdout);
      const control = await exec.exec({ operationId: "op-up-ctl", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: tmp, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...view, storageRoots: [] } });
      assert.equal(control.exitCode, 0, `control unreadable even unmasked: ${control.stderr}`);
      assert.ok(control.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repeated-marker pool derives the exact namespace after reconfigure", async (t) => {
  const sid = "sess-rp";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-repmark-"));
  try {
    // Approved repository lives under /tmp/base but OUTSIDE the pool.
    const base = join(dir, "base");
    const repo = join(base, "repo");
    mkdirSync(join(repo, "pkg"), { recursive: true });
    writeFileSync(join(repo, "pkg", "a.txt"), "a\n");
    writeFileSync(join(repo, "shared-note.txt"), "SHARED-MARKER\n");
    spawnSync("git", ["init", "-q", repo]);
    spawnSync("git", ["-C", repo, "add", "."]);
    spawnSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"]);
    // Repeated-marker pool: embeds /<sid>/worktrees/ itself.
    const poolA = join(base, sid, "worktrees", "pool");
    mkdirSync(poolA, { recursive: true });
    const poolB = join(dir, "srv", "poolB");
    mkdirSync(poolB, { recursive: true });
    const sibDir = join(poolA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");
    const open = (pool: string | null) =>
      mkPooledSup({ rootId: sid, dir: rootDir, pool, workspace: new GitWorkspaceManager(), repo, readRoots: [repo], store: new FileRunStore(rootDir, sid) });

    // Phase A: allocate under poolA.
    const a = open(poolA);
    const s1 = await a.sup.spawn("governor", { taskName: "wA", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rsA");
    assert.ok(s1.workdir.startsWith(join(poolA, sid, "worktrees")), s1.workdir);
    writeFileSync(join(s1.workdir, "own.txt"), "OWN-MARKER\n");
    await a.byAgent(s1.agentId)[0]!.call("read", { path: "x" });
    const specA: any = a.executors.sandbox.specs.at(-1);
    assert.ok(specA?.view?.storageRoots?.includes(poolA), JSON.stringify(specA?.view?.storageRoots));
    assert.ok(!specA?.view?.storageRoots?.includes(base), JSON.stringify(specA?.view?.storageRoots));
    await a.sup.shutdown().catch(() => {});

    // Phase B: reopen with poolB — retained poolA stays exact, no parent mask.
    const b = open(poolB);
    try {
      const retained = b.sup.list("governor").find((v) => v.id === s1.agentId);
      assert.ok(retained, "retained agent missing after reopen");
      assert.equal(retained!.workdir, s1.workdir);
      const s2 = await b.sup.spawn("governor", { taskName: "wB", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rsB");
      assert.ok(s2.workdir.startsWith(join(poolB, sid, "worktrees")), s2.workdir);
      writeFileSync(join(s2.workdir, "own.txt"), "OWN-MARKER\n");
      assert.ok(existsSync(join(s2.workdir, "own.txt")));
      await b.byAgent(s2.agentId)[0]!.call("read", { path: "x" });
      const specB: any = b.executors.sandbox.specs.at(-1);
      assert.ok(specB?.view?.storageRoots?.includes(poolA), JSON.stringify(specB?.view?.storageRoots));
      assert.ok(specB?.view?.storageRoots?.includes(poolB), JSON.stringify(specB?.view?.storageRoots));
      assert.ok(!specB?.view?.storageRoots?.includes(base), JSON.stringify(specB?.view?.storageRoots));
    } finally {
      await b.sup.shutdown().catch(() => {});
    }

    // Phase C: reopen with null — same exactness, pointers and files intact.
    const c = open(null);
    let s3workdir = "";
    let recordedStorage: string[] = [];
    let recordedHides: string[] = [];
    try {
      const retained = c.sup.list("governor").find((v) => v.id === s1.agentId);
      assert.ok(retained, "retained agent missing after null reopen");
      assert.equal(retained!.workdir, s1.workdir);
      assert.ok(existsSync(join(s1.workdir, "own.txt")), "retained workspace content lost");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling content lost");
      const s3 = await c.sup.spawn("governor", { taskName: "wC", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rsC");
      s3workdir = s3.workdir;
      writeFileSync(join(s3workdir, "own.txt"), "OWN-MARKER\n");
      await c.byAgent(s3.agentId)[0]!.call("read", { path: "x" });
      const specC: any = c.executors.sandbox.specs.at(-1);
      assert.ok(specC?.view?.storageRoots?.includes(poolA), JSON.stringify(specC?.view?.storageRoots));
      assert.ok(!specC?.view?.storageRoots?.includes(base), JSON.stringify(specC?.view?.storageRoots));
      recordedStorage = [...specC!.view!.storageRoots ?? []];
      recordedHides = [...specC!.view!.hidePaths ?? []];
    } finally {
      await c.sup.shutdown().catch(() => {});
    }

    // Exact namespace legs on the recorded null-phase view: own, approved
    // repo, and retained-workspace reads succeed; the pooled sibling is
    // DENIED; an unmasked control still reads both (mask load-bearing).
    await t.test("bwrap: repeated-marker namespace masks exactly poolA", async (st) => {
      const exec = new BwrapToolExecutor();
      if (!exec.probe().ok) {
        st.skip("bwrap unavailable; repeated-marker namespace check not executed");
        return;
      }
      console.log("bwrap leg EXECUTED: repeated-marker exact namespace");
      const tmp = join(dir, "tmp");
      mkdirSync(tmp, { recursive: true });
      const bash = absBin("bash") ?? "/bin/bash";
      const cat = absBin("cat") ?? "/bin/cat";
      const env = { PATH: "/usr/bin:/bin" };
      const view = { readRoots: [repo], writableRoot: s3workdir, tmpDir: tmp, hidePaths: recordedHides, storageRoots: recordedStorage, runtimeRoots: ["/nix/store"], network: false };
      const run = (id: string, argv: string[], cwd: string, v: typeof view) =>
        exec.exec({ operationId: id, argv: [bash, "-c", argv.join(" ")], cwd, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: v });
      const ownRead = await run("op-rp-own", [`${cat} own.txt`], s3workdir, view);
      assert.equal(ownRead.exitCode, 0, ownRead.stderr);
      assert.ok(ownRead.stdout.includes("OWN-MARKER"), ownRead.stdout);
      const repoRead = await run("op-rp-repo", [`${cat} ${join(repo, "shared-note.txt")}`], s3workdir, view);
      assert.equal(repoRead.exitCode, 0, repoRead.stderr);
      assert.ok(repoRead.stdout.includes("SHARED-MARKER"), repoRead.stdout);
      const retainedRead = await run("op-rp-ret", [`${cat} ${join(s1.workdir, "own.txt")}`], s3workdir, view);
      // Another agent's pooled workspace is sibling content from here.
      assert.notEqual(retainedRead.exitCode, 0, `other-session workspace readable: ${retainedRead.stdout}`);
      assert.ok(!retainedRead.stdout.includes("OWN-MARKER"), retainedRead.stdout);
      const sibRead = await run("op-rp-sib", [`${cat} ${join(sibDir, "secret.txt")}`], s3workdir, view);
      assert.notEqual(sibRead.exitCode, 0, `pooled sibling readable: ${sibRead.stdout}`);
      assert.ok(!sibRead.stdout.includes("SECRET-MARKER"), sibRead.stdout);
      const control = await exec.exec({ operationId: "op-rp-ctl", argv: [bash, "-c", `${cat} ${join(repo, "shared-note.txt")} ${join(sibDir, "secret.txt")}`], cwd: s3workdir, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...view, hidePaths: [], storageRoots: [], readRoots: [repo, sibDir] } });
      assert.equal(control.exitCode, 0, `control unreadable even unmasked: ${control.stderr}`);
      assert.ok(control.stdout.includes("SHARED-MARKER") && control.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("future allocations use single safe leaf components in the exact destination", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-safeleaf-"));
  try {
    const repo = gitCheckout(dir);
    const dest = join(dir, "pool", "sess-safe", "worktrees");
    mkdirSync(dest, { recursive: true });
    const { encodeWorktreeLeaf } = await import("../src/workspace.ts");
    // Deterministic encoding for the same inputs.
    assert.equal(encodeWorktreeLeaf("team/r", "abc", 1), encodeWorktreeLeaf("team/r", "abc", 1));
    // Normal IDs keep their historical verbatim physical names.
    assert.ok(encodeWorktreeLeaf("myrepo", "abcdef123456", 7).startsWith("wt-myrepo-abcdef123456-7"));
    for (const mgr of [new GitWorkspaceManager(), new DummyWorkspaceManager()] as const) {
      for (const id of ["team/sess-safe/worktrees/project", "x/../../../outside"]) {
        const at = (mgr as GitWorkspaceManager).allocateWriter(id, repo, "HEAD", dest);
        const leaf = at.worktreePath.slice(dest.length + 1);
        assert.ok(!leaf.includes("/") && !leaf.includes("\\") && leaf.length > 0, `${(mgr as object).constructor.name} ${id}: ${at.worktreePath}`);
        assert.ok(existsSync(at.worktreePath), `${id} leaf missing`);
        assert.ok(at.worktreePath === realpathSync(at.worktreePath) || realpathSync(at.worktreePath).startsWith(dest), `${id} escapes`);
      }
    }
    // End to end through the shared allocator: a dot-ID writer lands
    // canonically inside its session shard, not outside the pool.
    const pool = join(dir, "pool");
    const { sup } = mkPooledSup({
      rootId: "sess-safe", dir: join(dir, "root"), pool, workspace: new GitWorkspaceManager(), repo,
      policy: (p) => {
        p.repos = [{ repoId: "x/../../../outside", checkoutPath: repo, readRoots: [repo], allowWriters: true }];
      },
    });
    try {
      const w = await sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", isolation: "sandbox", repoId: "x/../../../outside" }, "rw-safe");
      assert.ok(realpathSync(w.workdir).startsWith(join(pool, "sess-safe", "worktrees") + "/") || realpathSync(w.workdir) === join(pool, "sess-safe", "worktrees"), w.workdir);
    } finally {
      await sup.shutdown().catch(() => {});
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Append an OLD-shape retained agent (no poolRoot key, verbatim `wt-`
 * leaf) to a file journal, as written before pool namespaces were
 * recorded. Grants/allocation mirror a real sandbox-writer spawn.
 */
function appendOldAgent(opts: {
  store: FileRunStore;
  agentId: string;
  repoId: string | null;
  workdir: string;
  readRoots: string[];
  tmpDir: string;
  git?: { workTree: string; gitDir: string; baseCommit: string } | null;
  isolation?: "none" | "worktree" | "sandbox";
  poolRoot?: string;
}): void {
  mkdirSync(opts.tmpDir, { recursive: true });
  opts.store.append("agent.spawned", {
    agentId: opts.agentId,
    path: `/${opts.agentId}`,
    parentId: null,
    profile: "writer",
    requestId: `req-${opts.agentId}`,
    grants: {
      tools: ["read", "grep", "find", "ls", "write", "edit", "bash"],
      externalTools: [],
      repos: opts.repoId === null ? [] : [{ repoId: opts.repoId, read: true, write: true }],
      shell: true,
      network: false,
      nesting: false,
      maxDepth: 1,
      isolation: opts.isolation ?? "sandbox",
    },
    allocation: {
      kind: "writer",
      workdir: opts.workdir,
      readRoots: opts.readRoots,
      writableRoot: opts.workdir,
      git: opts.git === undefined ? null : opts.git,
      repoId: opts.repoId,
      tmpDir: opts.tmpDir,
      ...(opts.poolRoot !== undefined ? { poolRoot: opts.poolRoot } : {}),
    },
    instructions: { contextFiles: [], skills: [] },
    model: null,
    taskRunId: null,
  });
}

test("old slash allocations stay masked without migration after reconfigure", async (t) => {
  const sid = "sess-old";
  const slashId = `team/${sid}/worktrees/project`;
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-oldslash-"));
  try {
    const repo = gitCheckout(dir);
    const poolA = join(dir, "poolA");
    mkdirSync(poolA, { recursive: true });
    const poolB = join(dir, "srv", "poolB");
    mkdirSync(poolB, { recursive: true });
    // Old-form verbatim leaf, as recorded before leaf encoding existed.
    const oldLeaf = join(poolA, sid, "worktrees", `wt-team/${sid}/worktrees/project-abcdef123456-99`);
    mkdirSync(oldLeaf, { recursive: true });
    writeFileSync(join(oldLeaf, "kept.txt"), "retained\n");
    const sibDir = join(poolA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");
    const seed = new FileRunStore(rootDir, sid);
    appendOldAgent({ store: seed, agentId: "old-slash", repoId: slashId, workdir: oldLeaf, readRoots: [repo], tmpDir: join(dir, "tmp-seed") });

    for (const [tag, pool] of [["B", poolB], ["C", null]] as Array<[string, string | null]>) {
      const h = mkPooledSup({
        rootId: sid, dir: rootDir, pool, workspace: new GitWorkspaceManager(), repo,
        readRoots: [repo, poolA], store: new FileRunStore(rootDir, sid),
      });
      try {
        const retained = h.sup.list("governor").find((v) => v.id === "old-slash");
        assert.ok(retained, `${tag}: retained agent missing after reopen`);
        assert.equal(retained!.workdir, oldLeaf);
        assert.ok(existsSync(join(oldLeaf, "kept.txt")), `${tag}: retained content lost`);
        assert.ok(existsSync(join(sibDir, "secret.txt")), `${tag}: sibling content lost`);
        const sN = await h.sup.spawn("governor", { taskName: `n-${tag}`, message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, `rn-${tag}`);
        await h.byAgent(sN.agentId)[0]!.call("read", { path: "x" });
        const spec: any = h.executors.sandbox.specs.at(-1);
        assert.ok(spec?.view?.storageRoots?.includes(poolA), `${tag}: ${JSON.stringify(spec?.view?.storageRoots)}`);
        if (tag === "B") {
          // The old workspace itself is preserved at its recorded path.
          // (Resumed execution needs a restorable native session, which a
          // bare retained record never had; L3 covers resume for agents
          // with run history. The masking contract below is what matters.)
          assert.ok(existsSync(join(oldLeaf, "kept.txt")));
        }
      } finally {
        await h.sup.shutdown().catch(() => {});
      }
    }

    // Exact namespace leg: the old-pool sibling is DENIED while the fresh
    // pool-B workspace and the approved repo stay usable.
    await t.test("bwrap: old slash pool stays masked after reconfigure", async (st) => {
      const exec = new BwrapToolExecutor();
      if (!exec.probe().ok) {
        st.skip("bwrap unavailable; old-slash namespace check not executed");
        return;
      }
      console.log("bwrap leg EXECUTED: old slash retained namespace");
      const h = mkPooledSup({
        rootId: sid, dir: rootDir, pool: null, workspace: new GitWorkspaceManager(), repo,
        readRoots: [repo, poolA], store: new FileRunStore(rootDir, sid),
      });
      try {
        const sN = await h.sup.spawn("governor", { taskName: "n-bw", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rn-bw");
        writeFileSync(join(sN.workdir, "own.txt"), "OWN-MARKER\n");
        await h.byAgent(sN.agentId)[0]!.call("read", { path: "x" });
        const spec: any = h.executors.sandbox.specs.at(-1);
        assert.ok(spec?.view?.storageRoots?.includes(poolA), JSON.stringify(spec?.view?.storageRoots));
        const tmp = join(dir, "tmp");
        mkdirSync(tmp, { recursive: true });
        const bash = absBin("bash") ?? "/bin/bash";
        const cat = absBin("cat") ?? "/bin/cat";
        const env = { PATH: "/usr/bin:/bin" };
        const view = { readRoots: [repo, poolA], writableRoot: sN.workdir, tmpDir: tmp, hidePaths: [...spec!.view!.hidePaths], storageRoots: [...spec!.view!.storageRoots ?? []], runtimeRoots: ["/nix/store"], network: false };
        const run = (id: string, argv: string[], cwd: string, v: typeof view) =>
          exec.exec({ operationId: id, argv: [bash, "-c", argv.join(" ")], cwd, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: v });
        const ownRead = await run("op-os-own", [`${cat} own.txt`], sN.workdir, view);
        assert.equal(ownRead.exitCode, 0, ownRead.stderr);
        const repoRead = await run("op-os-repo", [`${cat} ${join(repo, "pkg", "a.txt")}`], sN.workdir, view);
        assert.equal(repoRead.exitCode, 0, repoRead.stderr);
        const sibRead = await run("op-os-sib", [`${cat} ${join(sibDir, "secret.txt")}`], sN.workdir, view);
        assert.notEqual(sibRead.exitCode, 0, `old-pool sibling readable: ${sibRead.stdout}`);
        assert.ok(!sibRead.stdout.includes("SECRET-MARKER"), sibRead.stdout);
        const control = await exec.exec({ operationId: "op-os-ctl", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: sN.workdir, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...view, hidePaths: [], storageRoots: [], readRoots: [sibDir] } });
        assert.equal(control.exitCode, 0, `control unreadable even unmasked: ${control.stderr}`);
        assert.ok(control.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
      } finally {
        await h.sup.shutdown().catch(() => {});
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("old dot allocations fail visibly with files preserved", async () => {
  const sid = "sess-olddot";
  const dotId = "x/../../../outside";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-olddot-"));
  try {
    const repo = gitCheckout(dir);
    const poolA = join(dir, "poolA");
    mkdirSync(poolA, { recursive: true });
    const poolB = join(dir, "srv", "poolB");
    mkdirSync(poolB, { recursive: true });
    // Old-form dot-escaped leaf, recorded verbatim before leaf encoding.
    const oldLeaf = join(poolA, "outside-abcdef123456-7");
    mkdirSync(oldLeaf, { recursive: true });
    writeFileSync(join(oldLeaf, "kept.txt"), "retained\n");
    const sibDir = join(poolA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");
    const seed = new FileRunStore(rootDir, sid);
    appendOldAgent({ store: seed, agentId: "old-dot", repoId: dotId, workdir: oldLeaf, readRoots: [repo], tmpDir: join(dir, "tmp-seed") });

    const h = mkPooledSup({
      rootId: sid, dir: rootDir, pool: poolB, workspace: new GitWorkspaceManager(), repo,
      readRoots: [repo, poolA], store: new FileRunStore(rootDir, sid),
    });
    try {
      // Pointer retained; files untouched.
      const retained = h.sup.list("governor").find((v) => v.id === "old-dot");
      assert.ok(retained, "retained agent missing after reopen");
      assert.equal(retained!.workdir, oldLeaf);
      // Any sandbox tool view fails visibly instead of silently unhiding.
      const r = await h.sup.spawn("governor", { taskName: "r", message: "m", profile: "reader", isolation: "sandbox", repoId: "r1" }, "rr-dot");
      const res = await h.byAgent(r.agentId)[0]!.call("read", { path: "x" });
      assert.equal(res.isError, true);
      assert.match(res.content, /WORKSPACE_UNAVAILABLE: retained workspace has an unrecognized shape/);
      assert.ok(existsSync(join(oldLeaf, "kept.txt")), "retained workspace content lost");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling content lost");
    } finally {
      await h.sup.shutdown().catch(() => {});
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("old host worktree records stay masked without migration after reconfigure", async (t) => {
  const sid = "sess-hw2";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-oldhost-"));
  try {
    const repo = gitCheckout(dir);
    const poolA = join(dir, "poolA");
    mkdirSync(poolA, { recursive: true });
    const poolB = join(dir, "srv", "poolB");
    mkdirSync(poolB, { recursive: true });
    // Old-schema host allocation: repoId null, NO poolRoot key, pooled
    // worktree path from a genuine admission layout. The git identity is
    // genuine (real worktree backlink + birth) so retention proves; only
    // the legacy SHAPE (null repo, absent namespace) is under test here.
    // Placeholder identity would fail closed like any forgery and prove
    // nothing about legacy masking.
    const hostWt = gitWorktreeThrough(dir, repo, join(poolA, sid, "worktrees"));
    writeFileSync(join(hostWt.workdir, "kept.txt"), "retained\n");
    const sibDir = join(poolA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");
    const seed = new FileRunStore(rootDir, sid);
    appendOldAgent({
      store: seed, agentId: "old-host", repoId: null, workdir: hostWt.workdir, readRoots: [], tmpDir: join(dir, "tmp-seed"),
      git: { workTree: hostWt.workdir, gitDir: hostWt.gitDir, baseCommit: hostWt.head }, isolation: "worktree",
    });
    // Genuine in-place control: isolation NONE with a namespace-LOOKING
    // path and valid git. It is an owner working directory, never pooled
    // storage, and must contribute no mask even though its parent mimics
    // the session-namespace layout.
    const nsProj = join(dir, "normal-projects", sid, "worktrees", "project");
    mkdirSync(nsProj, { recursive: true });
    writeFileSync(join(nsProj, "note.txt"), "IN-PLACE\n");
    appendOldAgent({
      store: seed, agentId: "in-place-ns", repoId: null, workdir: nsProj, readRoots: [], tmpDir: join(dir, "tmp-seed-ns"),
      git: { workTree: nsProj, gitDir: join(nsProj, ".git"), baseCommit: "HEAD" }, isolation: "none",
    });

    for (const [tag, pool] of [["B", poolB], ["C", null]] as Array<[string, string | null]>) {
      const h = mkPooledSup({
        rootId: sid, dir: rootDir, pool, workspace: new GitWorkspaceManager(), repo,
        readRoots: [repo, poolA], store: new FileRunStore(rootDir, sid),
      });
      try {
        const retained = h.sup.list("governor").find((v) => v.id === "old-host");
        assert.ok(retained, `${tag}: retained host agent missing after reopen`);
        assert.equal(retained!.workdir, hostWt.workdir);
        assert.ok(existsSync(join(hostWt.workdir, "kept.txt")), `${tag}: retained content lost`);
        assert.ok(existsSync(join(sibDir, "secret.txt")), `${tag}: sibling content lost`);
        const sN = await h.sup.spawn("governor", { taskName: `n-${tag}`, message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, `rn-${tag}`);
        await h.byAgent(sN.agentId)[0]!.call("read", { path: "x" });
        const spec: any = h.executors.sandbox.specs.at(-1);
        assert.ok(spec?.view?.storageRoots?.includes(poolA), `${tag}: ${JSON.stringify(spec?.view?.storageRoots)}`);
        assert.ok(!spec?.view?.storageRoots?.includes(repo), `${tag}: in-place repo falsely masked: ${JSON.stringify(spec?.view?.storageRoots)}`);
        assert.ok(!(spec?.view?.storageRoots ?? []).some((h: string) => nsProj === h || nsProj.startsWith(h + "/")), `${tag}: namespace-looking in-place path falsely masked: ${JSON.stringify(spec?.view?.storageRoots)}`);
      } finally {
        await h.sup.shutdown().catch(() => {});
      }
    }

    // Exact namespace legs on a null-phase view: fresh own/repo usable,
    // old-pool sibling DENIED, control readable.
    await t.test("bwrap: old host pool stays masked after reconfigure", async () => {
      // Required executor: closure validation must execute natively here.
      const exec = requireBwrap();
      console.log("bwrap leg EXECUTED: old host retained namespace");
      const h = mkPooledSup({
        rootId: sid, dir: rootDir, pool: null, workspace: new GitWorkspaceManager(), repo,
        readRoots: [repo, poolA], store: new FileRunStore(rootDir, sid),
      });
      try {
        const sN = await h.sup.spawn("governor", { taskName: "n-bw", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rn-bw");
        writeFileSync(join(sN.workdir, "own.txt"), "OWN-MARKER\n");
        await h.byAgent(sN.agentId)[0]!.call("read", { path: "x" });
        const spec: any = h.executors.sandbox.specs.at(-1);
        assert.ok(spec?.view?.storageRoots?.includes(poolA), JSON.stringify(spec?.view?.storageRoots));
        const tmp = join(dir, "tmp");
        mkdirSync(tmp, { recursive: true });
        const bash = absBin("bash") ?? "/bin/bash";
        const cat = absBin("cat") ?? "/bin/cat";
        const env = { PATH: "/usr/bin:/bin" };
        const view = { readRoots: [repo, poolA], writableRoot: sN.workdir, tmpDir: tmp, hidePaths: [...spec!.view!.hidePaths], storageRoots: [...spec!.view!.storageRoots ?? []], runtimeRoots: ["/nix/store"], network: false };
        const run = (id: string, argv: string[], cwd: string, v: typeof view) =>
          exec.exec({ operationId: id, argv: [bash, "-c", argv.join(" ")], cwd, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: v });
        const ownRead = await run("op-oh-own", [`${cat} own.txt`], sN.workdir, view);
        assert.equal(ownRead.exitCode, 0, ownRead.stderr);
        const repoRead = await run("op-oh-repo", [`${cat} ${join(repo, "pkg", "a.txt")}`], sN.workdir, view);
        assert.equal(repoRead.exitCode, 0, repoRead.stderr);
        const sibRead = await run("op-oh-sib", [`${cat} ${join(sibDir, "secret.txt")}`], sN.workdir, view);
        assert.notEqual(sibRead.exitCode, 0, `old-pool sibling readable: ${sibRead.stdout}`);
        assert.ok(!sibRead.stdout.includes("SECRET-MARKER"), sibRead.stdout);
        const control = await exec.exec({ operationId: "op-oh-ctl", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: sN.workdir, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...view, storageRoots: [] } });
        assert.equal(control.exitCode, 0, `control unreadable even unmasked: ${control.stderr}`);
        assert.ok(control.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
      } finally {
        await h.sup.shutdown().catch(() => {});
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("alias retarget keeps the pinned physical namespace usable and masked", async (t) => {
  const sid = "sess-rt";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-retarget-"));
  try {
    const repo = gitCheckout(dir);
    const actualA = join(dir, "actualA");
    const actualB = join(dir, "actualB");
    mkdirSync(actualA, { recursive: true });
    mkdirSync(actualB, { recursive: true });
    const alias = join(dir, "alias");
    symlinkSync(actualA, alias);
    const poolB = join(dir, "srv", "poolB");
    mkdirSync(poolB, { recursive: true });
    const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");
    const open = (pool: string | null, ws: WorkspaceManager) =>
      mkPooledSup({ rootId: sid, dir: rootDir, pool, workspace: ws, repo, readRoots: [repo, actualA], store: new FileRunStore(rootDir, sid) });

    // Phase A: allocate through the alias; physical truth is pinned.
    const a = open(alias, new GitWorkspaceManager());
    let s1workdir = "";
    let s1agentId = "";
    try {
      const s1 = await a.sup.spawn("governor", { taskName: "s1", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs1");
      s1workdir = s1.workdir;
      s1agentId = s1.agentId;
      assert.ok(s1workdir.startsWith(join(actualA, sid, "worktrees")), s1workdir);
      assert.ok(!s1workdir.startsWith(join(alias, sid)), s1workdir);
      writeFileSync(join(s1workdir, "kept.txt"), "retained\n");
      a.byAgent(s1agentId)[0]!.settle();
      await tick(50);
    } finally {
      await a.sup.shutdown();
    }
    const s1 = { workdir: s1workdir, agentId: s1agentId };

    // Retarget the alias AFTER the durable accepted allocation.
    rmSync(alias);
    symlinkSync(actualB, alias);
    assert.ok(existsSync(join(s1.workdir, "kept.txt")), "retarget must not move retained data");
    assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling content lost");

    // Phase B: reopen with poolB — the retained agent keeps working in its
    // pinned physical workspace; the old namespace stays masked.
    const b = open(poolB, new GitWorkspaceManager());
    try {
      const retained = b.sup.list("governor").find((v) => v.id === s1.agentId);
      assert.ok(retained, "retained agent missing after reopen");
      assert.equal(retained!.workdir, s1.workdir);
      await b.sup.sendMessage("governor", s1.agentId, "task", "again", {}, "re-rt");
      let resumed: CtlWorker | null = null;
      for (let i = 0; i < 100 && !(resumed as any)?.init; i++) {
        await tick(50);
        resumed = b.byAgent(s1.agentId)[0] ?? null;
      }
      assert.ok((resumed as any)?.init, "retained agent did not resume in its pinned workspace");
      assert.equal(String((resumed as any).init!["workdir"]), s1.workdir);
      const s2 = await b.sup.spawn("governor", { taskName: "s2", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs2");
      assert.ok(s2.workdir.startsWith(join(poolB, sid, "worktrees")), s2.workdir);
      writeFileSync(join(s2.workdir, "own.txt"), "OWN-MARKER\n");
      await b.byAgent(s2.agentId)[0]!.call("read", { path: "x" });
      const specB: any = b.executors.sandbox.specs.at(-1);
      assert.ok(specB?.view?.storageRoots?.includes(actualA), JSON.stringify(specB?.view?.storageRoots));
      assert.ok(specB?.view?.storageRoots?.includes(poolB), JSON.stringify(specB?.view?.storageRoots));
      // Native closure leg on the phase-B view (required executor).
      {
        const exec = requireBwrap();
        console.log("bwrap leg EXECUTED: retarget phase-B storage namespace");
        const bash = absBin("bash") ?? "/bin/bash";
        const cat = absBin("cat") ?? "/bin/cat";
        const env = { PATH: "/usr/bin:/bin" };
        const viewB = { readRoots: [...specB!.view!.readRoots], writableRoot: s2.workdir, tmpDir: String(specB!.view!.tmpDir), hidePaths: [...specB!.view!.hidePaths], storageRoots: [...specB!.view!.storageRoots ?? []], runtimeRoots: ["/nix/store"], network: false };
        const runB = (id: string, argv: string[], cwd: string, v: typeof viewB) =>
          exec.exec({ operationId: id, argv: [bash, "-c", argv.join(" ")], cwd, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: v });
        const ownB = await runB("op-rt-b-own", [`${cat} own.txt`], s2.workdir, viewB);
        assert.equal(ownB.exitCode, 0, ownB.stderr);
        const sibB = await runB("op-rt-b-sib", [`${cat} ${join(sibDir, "secret.txt")}`], s2.workdir, viewB);
        assert.notEqual(sibB.exitCode, 0, `old-A sibling readable: ${sibB.stdout}`);
        assert.ok(!sibB.stdout.includes("SECRET-MARKER"), sibB.stdout);
        const ctlB = await runB("op-rt-b-ctl", [`${cat} ${join(sibDir, "secret.txt")}`], s2.workdir, { ...viewB, storageRoots: [] });
        assert.equal(ctlB.exitCode, 0, `control unreadable even unmasked: ${ctlB.stderr}`);
        assert.ok(ctlB.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
      }
    } finally {
      await b.sup.shutdown();
    }

    // Phase C: reopen with null — same masking, pointers and files intact.
    const c = open(null, new GitWorkspaceManager());
    let recordedStorage: string[] = [];
    let recordedHides: string[] = [];
    let recordedRoots: string[] = [];
    let recordedTmp = "";
    let s3workdir = "";
    try {
      const retained = c.sup.list("governor").find((v) => v.id === s1.agentId);
      assert.ok(retained, "retained agent missing after null reopen");
      assert.equal(retained!.workdir, s1.workdir);
      const s3 = await c.sup.spawn("governor", { taskName: "s3", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs3");
      s3workdir = s3.workdir;
      writeFileSync(join(s3workdir, "own.txt"), "OWN-MARKER\n");
      await c.byAgent(s3.agentId)[0]!.call("read", { path: "x" });
      const specC: any = c.executors.sandbox.specs.at(-1);
      assert.ok(specC?.view?.storageRoots?.includes(actualA), JSON.stringify(specC?.view?.storageRoots));
      recordedStorage = [...specC!.view!.storageRoots ?? []];
      recordedHides = [...specC!.view!.hidePaths ?? []];
      recordedRoots = [...specC!.view!.readRoots ?? []];
      recordedTmp = String(specC!.view!.tmpDir);
      assert.ok(existsSync(join(s1.workdir, "kept.txt")), "retained workspace lost after null reconfigure");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling content lost after null reconfigure");
    } finally {
      await c.sup.shutdown();
    }

    await t.test("bwrap: retargeted alias keeps old-A masked, own usable", async () => {
      // Required executor: closure validation must execute natively here.
      const exec = requireBwrap();
      console.log("bwrap leg EXECUTED: alias-retarget storage namespace");
      const bash = absBin("bash") ?? "/bin/bash";
      const cat = absBin("cat") ?? "/bin/cat";
      const env = { PATH: "/usr/bin:/bin" };
      const view = { readRoots: recordedRoots, writableRoot: s3workdir, tmpDir: recordedTmp, hidePaths: recordedHides, storageRoots: recordedStorage, runtimeRoots: ["/nix/store"], network: false };
      const run = (id: string, argv: string[], cwd: string, v: typeof view) =>
        exec.exec({ operationId: id, argv: [bash, "-c", argv.join(" ")], cwd, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: v });
      const ownRead = await run("op-rt-own", [`${cat} own.txt`], s3workdir, view);
      assert.equal(ownRead.exitCode, 0, ownRead.stderr);
      const sibRead = await run("op-rt-sib", [`${cat} ${join(sibDir, "secret.txt")}`], s3workdir, view);
      assert.notEqual(sibRead.exitCode, 0, `old-A sibling readable: ${sibRead.stdout}`);
      assert.ok(!sibRead.stdout.includes("SECRET-MARKER"), sibRead.stdout);
      const control = await exec.exec({ operationId: "op-rt-ctl", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: s3workdir, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...view, storageRoots: [] } });
      assert.equal(control.exitCode, 0, `control unreadable even unmasked: ${control.stderr}`);
      assert.ok(control.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("alias removal keeps the pinned namespace usable and masked", async () => {
  const sid = "sess-rm";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-rmalias-"));
  try {
    const repo = gitCheckout(dir);
    const actualA = join(dir, "actualA");
    mkdirSync(actualA, { recursive: true });
    const alias = join(dir, "alias");
    symlinkSync(actualA, alias);
    const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");
    const open = (pool: string | null, ws: WorkspaceManager) =>
      mkPooledSup({ rootId: sid, dir: rootDir, pool, workspace: ws, repo, readRoots: [repo, actualA], store: new FileRunStore(rootDir, sid) });

    const a = open(alias, new GitWorkspaceManager());
    let s1: any;
    try {
      s1 = await a.sup.spawn("governor", { taskName: "s1", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs1");
      assert.ok(s1.workdir.startsWith(join(actualA, sid, "worktrees")), s1.workdir);
      writeFileSync(join(s1.workdir, "kept.txt"), "retained\n");
      a.byAgent(s1.agentId)[0]!.settle();
      await tick(50);
    } finally {
      await a.sup.shutdown();
    }

    // Remove the alias entirely: the pinned physical workspace survives.
    rmSync(alias);
    assert.ok(existsSync(join(s1.workdir, "kept.txt")), "pinned workspace lost with its alias");

    // Reopen under the same (now missing) alias: the retained namespace is
    // still masked and the retained agent resumes in physical A.
    const b = open(alias, new GitWorkspaceManager());
    try {
      const retained = b.sup.list("governor").find((v) => v.id === s1.agentId);
      assert.ok(retained, "retained agent missing after reopen");
      assert.equal(retained!.workdir, s1.workdir);
      await b.sup.sendMessage("governor", s1.agentId, "task", "again", {}, "re-rm");
      let resumed: CtlWorker | null = null;
      for (let i = 0; i < 100 && !(resumed as any)?.init; i++) {
        await tick(50);
        resumed = b.byAgent(s1.agentId)[0] ?? null;
      }
      assert.ok((resumed as any)?.init, "retained agent did not resume after alias removal");
      assert.equal(String((resumed as any).init!["workdir"]), s1.workdir);
      await (resumed as any).call("read", { path: "x" });
      const spec: any = b.executors.sandbox.specs.at(-1);
      assert.ok(spec?.view?.storageRoots?.includes(actualA), JSON.stringify(spec?.view?.storageRoots));
      // New allocations recreate the alias as an ordinary empty dir.
      const s2 = await b.sup.spawn("governor", { taskName: "s2", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs2");
      assert.ok(s2.workdir.startsWith(join(alias, sid, "worktrees")), s2.workdir);
      // Native closure leg on the reopened view (required executor).
      {
        const exec = requireBwrap();
        console.log("bwrap leg EXECUTED: removal retained namespace");
        const bash = absBin("bash") ?? "/bin/bash";
        const cat = absBin("cat") ?? "/bin/cat";
        const env = { PATH: "/usr/bin:/bin" };
        const view = { readRoots: [repo, actualA], writableRoot: s2.workdir, tmpDir: join(dir, "tmp"), hidePaths: [...spec!.view!.hidePaths], storageRoots: [...spec!.view!.storageRoots ?? []], runtimeRoots: ["/nix/store"], network: false };
        mkdirSync(join(dir, "tmp"), { recursive: true });
        const run = (id: string, argv: string[], cwd: string, v: typeof view) =>
          exec.exec({ operationId: id, argv: [bash, "-c", argv.join(" ")], cwd, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: v });
        const sibRead = await run("op-rm-sib", [`${cat} ${join(sibDir, "secret.txt")}`], s2.workdir, view);
        assert.notEqual(sibRead.exitCode, 0, `old-A sibling readable: ${sibRead.stdout}`);
        assert.ok(!sibRead.stdout.includes("SECRET-MARKER"), sibRead.stdout);
        const ctl = await run("op-rm-ctl", [`${cat} ${join(sibDir, "secret.txt")}`], s2.workdir, { ...view, storageRoots: [] });
        assert.equal(ctl.exitCode, 0, `control unreadable even unmasked: ${ctl.stderr}`);
        assert.ok(ctl.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
      }
    } finally {
      await b.sup.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * H3 historical RAW-alias closure (local fixed source): a genuine git
 * worktree created THROUGH the alias (real admin backlink files), recorded
 * with the old schema (RAW poolRoot + raw workdir, repoId set, no other
 * metadata). After alias retarget/removal, reopening must mask the PROVEN
 * physical namespace and route the retained owner there — never the live
 * alias target — with the journal byte-identical.
 */
function gitWorktreeThrough(dir: string, repo: string, at: string): { workdir: string; gitDir: string; head: string } {
  const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const leaf = `wt-r1-${head.slice(0, 12)}-${Date.now()}`;
  const workdir = join(at, leaf);
  const add = spawnSync("git", ["-C", repo, "worktree", "add", "--detach", workdir, head], { encoding: "utf8" });
  assert.ok(add.status === 0, add.stderr);
  const dotGit = readFileSync(join(workdir, ".git"), "utf8");
  const pointer = /^gitdir: (.+)$/m.exec(dotGit);
  assert.ok(pointer, "no gitdir pointer");
  return { workdir, gitDir: pointer[1].trim(), head };
}

test("historical raw-alias record proves physical A across retarget", async (t) => {
  const sid = "sess-h3";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-h3ret-"));
  try {
    const repo = gitCheckout(dir);
    const actualA = join(dir, "actualA");
    const actualB = join(dir, "actualB");
    mkdirSync(actualA, { recursive: true });
    mkdirSync(actualB, { recursive: true });
    const alias = join(dir, "alias");
    symlinkSync(actualA, alias);
    const poolB = join(dir, "srv", "poolB");
    mkdirSync(poolB, { recursive: true });
    // Genuine git worktree through the alias: real admin backlink files.
    const wt = gitWorktreeThrough(dir, repo, join(alias, sid, "worktrees"));
    writeFileSync(join(wt.workdir, "kept.txt"), "retained\n");
    // Premise: the admin backlink names the physical target, not the alias.
    const backlink = readFileSync(join(wt.gitDir, "gitdir"), "utf8").trim();
    assert.ok(backlink.startsWith(join(actualA, sid)) || backlink.startsWith(actualA), `backlink does not prove physical A: ${backlink}`);
    const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");
    const seed = new FileRunStore(rootDir, sid);
    appendOldAgent({
      store: seed, agentId: "old-h3", repoId: "r1", workdir: wt.workdir, readRoots: [repo, actualA],
      tmpDir: join(dir, "tmp-seed"),
      git: { workTree: wt.workdir, gitDir: wt.gitDir, baseCommit: wt.head },
      poolRoot: alias,
    });

    // Retarget AFTER the durable accepted record; physical A keeps its data.
    rmSync(alias);
    symlinkSync(actualB, alias);
    assert.ok(existsSync(join(actualA, "sess-other", "worktrees", "wt-sib", "secret.txt")));

    for (const [tag, pool] of [["B", poolB], ["C", null]] as Array<[string, string | null]>) {
      const h = mkPooledSup({
        rootId: sid, dir: rootDir, pool, workspace: new GitWorkspaceManager(), repo,
        readRoots: [repo, actualA], store: new FileRunStore(rootDir, sid),
      });
      try {
        // Display keeps the recorded alias path; runtime goes physical.
        const listed = h.sup.list("governor").find((v) => v.id === "old-h3");
        assert.ok(listed, `${tag}: retained agent missing`);
        assert.equal(listed!.workdir, wt.workdir);
        const reH3 = await h.sup.sendMessage("governor", "old-h3", "task", "again", {}, `re-h3-${tag}`);
        let resumed: CtlWorker | null = null;
        for (let i = 0; i < 100 && !(resumed as any)?.init; i++) {
          await tick(50);
          resumed = h.byAgent("old-h3")[0] ?? null;
        }
        assert.ok((resumed as any)?.init, `${tag}: retained owner did not resume`);
        assert.ok(String((resumed as any).init!["workdir"]).startsWith(join(actualA, sid, "worktrees")), `${tag}: initializer not in physical A`);
        assert.ok(!String((resumed as any).init!["workdir"]).startsWith(join(alias, sid)), `${tag}: initializer follows live alias`);
        // Effective routing writes through to physical A.
        const ck = await h.sup.runCheck("old-h3", reH3.taskRunId!, { id: `ck-${tag}`, command: "true", timeoutMs: 30000 });
        assert.equal(ck.exitCode, 0, ck.output);
        const sN = await h.sup.spawn("governor", { taskName: `n-${tag}`, message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, `rn-h3-${tag}`);
        await h.byAgent(sN.agentId)[0]!.call("read", { path: "x" });
        const spec: any = h.executors.sandbox.specs.at(-1);
        assert.ok(spec?.view?.storageRoots?.includes(actualA), `${tag}: ${JSON.stringify(spec?.view?.storageRoots)}`);
        // Settle the resumed run so the next reopen starts clean.
        (resumed as any).settle("succeeded", "done");
        await tick(50);
        if (tag === "B") {
          // Settle the resumed run so the next reopen starts clean (an
          // active run at shutdown would quarantine the agent instead).
          (resumed as any).settle("succeeded", "done");
          await tick(50);
        }
      } finally {
        await h.sup.shutdown();
      }
    }


    await t.test("bwrap: proven physical A masks the sibling after retarget", async () => {
      const exec = requireBwrap();
      console.log("bwrap leg EXECUTED: proven physical namespace after retarget");
      const h = mkPooledSup({
        rootId: sid, dir: rootDir, pool: null, workspace: new GitWorkspaceManager(), repo,
        readRoots: [repo, actualA], store: new FileRunStore(rootDir, sid),
      });
      try {
        const sN = await h.sup.spawn("governor", { taskName: "n-bw", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rn-h3-bw");
        writeFileSync(join(sN.workdir, "own.txt"), "OWN-MARKER\n");
        await h.byAgent(sN.agentId)[0]!.call("read", { path: "x" });
        const spec: any = h.executors.sandbox.specs.at(-1);
        assert.ok(spec?.view?.storageRoots?.includes(actualA), JSON.stringify(spec?.view?.storageRoots));
        const tmp = join(dir, "tmp");
        mkdirSync(tmp, { recursive: true });
        const bash = absBin("bash") ?? "/bin/bash";
        const cat = absBin("cat") ?? "/bin/cat";
        const env = { PATH: "/usr/bin:/bin" };
        const view = { readRoots: [repo, actualA], writableRoot: sN.workdir, tmpDir: tmp, hidePaths: [...spec!.view!.hidePaths], storageRoots: [...spec!.view!.storageRoots ?? []], runtimeRoots: ["/nix/store"], network: false };
        const run = (id: string, argv: string[], cwd: string, v: typeof view) =>
          exec.exec({ operationId: id, argv: [bash, "-c", argv.join(" ")], cwd, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: v });
        const ownRead = await run("op-h3-own", [`${cat} own.txt`], sN.workdir, view);
        assert.equal(ownRead.exitCode, 0, ownRead.stderr);
        const sibRead = await run("op-h3-sib", [`${cat} ${join(sibDir, "secret.txt")}`], sN.workdir, view);
        assert.notEqual(sibRead.exitCode, 0, `old-A sibling readable: ${sibRead.stdout}`);
        assert.ok(!sibRead.stdout.includes("SECRET-MARKER"), sibRead.stdout);
        const control = await exec.exec({ operationId: "op-h3-ctl", argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: sN.workdir, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...view, storageRoots: [] } });
        assert.equal(control.exitCode, 0, `control unreadable even unmasked: ${control.stderr}`);
        assert.ok(control.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
      } finally {
        await h.sup.shutdown();
      }
    });

    // Phase D: the retained owner itself routes through the proven physical
    // namespace end to end (real executor): resume initializes in physical
    // A, a controller check writes there, and the sibling stays denied.
    {
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.worktreeRoot = null;
      policy.repos = [{ repoId: "r1", checkoutPath: repo, readRoots: [repo, actualA], allowWriters: true }];
      const workers: CtlWorker[] = [];
      const sup = new Supervisor({
        rootId: sid, rootDir, store: new FileRunStore(rootDir, sid), policy,
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
        executors: { sandbox: new BwrapToolExecutor(), host: new HostToolExecutor() },
        workspace: new GitWorkspaceManager(),
        governor: () => ({ ...testGovernor(), cwd: repo }),
        workerFactory: (o) => {
          const w = new CtlWorker(o.agentId);
          workers.push(w);
          return w;
        },
      });
      try {
        const reH3d = await sup.sendMessage("governor", "old-h3", "task", "again", {}, "re-h3-d");
        let resumed: CtlWorker | null = null;
        for (let i = 0; i < 100 && !(resumed as any)?.init; i++) {
          await tick(50);
          resumed = workers.find((x) => x.agentId === "old-h3") ?? null;
        }
        assert.ok((resumed as any)?.init, "retained owner did not resume in phase D");
        assert.ok(String((resumed as any).init!["workdir"]).startsWith(join(actualA, sid, "worktrees")), "phase-D initializer not in physical A");
        const wck = await sup.runCheck("old-h3", reH3d.taskRunId!, { id: "ck-d", command: "cat kept.txt", timeoutMs: 30000 });
        assert.equal(wck.exitCode, 0, wck.output);
        // The read ran in the proven physical workspace: kept.txt exists
        // only under physical A (the live alias points at empty B).
        const keptPath = join(String((resumed as any).init!["workdir"]), "kept.txt");
        assert.ok(wck.output.includes("retained"), wck.output.slice(0, 200));
        assert.ok(readFileSync(keptPath, "utf8").includes("retained"), keptPath);
        const dck = await sup.runCheck("old-h3", reH3d.taskRunId!, { id: "ck-deny", command: `cat ${join(sibDir, "secret.txt")}`, timeoutMs: 30000 });
        assert.notEqual(dck.exitCode, 0);
        assert.ok(!dck.output.includes("SECRET-MARKER"), dck.output.slice(0, 200));
        (resumed as any).settle("succeeded", "done");
        await tick(50);
      } finally {
        await sup.shutdown();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("historical raw-alias record proves physical A across removal", async () => {
  const sid = "sess-h3r";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-h3rm-"));
  try {
    const repo = gitCheckout(dir);
    const actualA = join(dir, "actualA");
    mkdirSync(actualA, { recursive: true });
    const alias = join(dir, "alias");
    symlinkSync(actualA, alias);
    const wt = gitWorktreeThrough(dir, repo, join(alias, sid, "worktrees"));
    writeFileSync(join(wt.workdir, "kept.txt"), "retained\n");
    const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");
    const seed = new FileRunStore(rootDir, sid);
    appendOldAgent({
      store: seed, agentId: "old-h3r", repoId: "r1", workdir: wt.workdir, readRoots: [repo, actualA],
      tmpDir: join(dir, "tmp-seed"),
      git: { workTree: wt.workdir, gitDir: wt.gitDir, baseCommit: wt.head },
      poolRoot: alias,
    });

    // Remove the alias: the physical namespace and its data survive.
    rmSync(alias);
    assert.ok(existsSync(join(actualA, sid, "worktrees", wt.workdir.split(join(sid, "worktrees") + "/")[1]!, "kept.txt")), "physical data lost with its alias");

    const h = mkPooledSup({
      rootId: sid, dir: rootDir, pool: null, workspace: new GitWorkspaceManager(), repo,
      readRoots: [repo, actualA], store: new FileRunStore(rootDir, sid),
    });
    try {
      const listed = h.sup.list("governor").find((v) => v.id === "old-h3r");
      assert.ok(listed, "retained agent missing");
      assert.equal(listed!.workdir, wt.workdir);
      await h.sup.sendMessage("governor", "old-h3r", "task", "again", {}, "re-h3r");
      let resumed: CtlWorker | null = null;
      for (let i = 0; i < 100 && !(resumed as any)?.init; i++) {
        await tick(50);
        resumed = h.byAgent("old-h3r")[0] ?? null;
      }
      assert.ok((resumed as any)?.init, "retained owner did not resume");
      assert.ok(String((resumed as any).init!["workdir"]).startsWith(join(actualA, sid, "worktrees")), "initializer not in physical A");
      const sN = await h.sup.spawn("governor", { taskName: "n", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rn-h3r");
      await h.byAgent(sN.agentId)[0]!.call("read", { path: "x" });
      const spec: any = h.executors.sandbox.specs.at(-1);
      assert.ok(spec?.view?.storageRoots?.includes(actualA), JSON.stringify(spec?.view?.storageRoots));
    } finally {
      await h.sup.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unavailable backlink fails visibly with files preserved", async () => {
  const sid = "sess-h3u";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-h3un-"));
  try {
    const repo = gitCheckout(dir);
    const actualA = join(dir, "actualA");
    mkdirSync(actualA, { recursive: true });
    const alias = join(dir, "alias");
    symlinkSync(actualA, alias);
    const wt = gitWorktreeThrough(dir, repo, join(alias, sid, "worktrees"));
    writeFileSync(join(wt.workdir, "kept.txt"), "retained\n");
    const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    // Destroy the administration identity: nothing can prove the namespace.
    rmSync(join(repo, ".git"), { recursive: true, force: true });
    const rootDir = join(dir, "root");
    const seed = new FileRunStore(rootDir, sid);
    appendOldAgent({
      store: seed, agentId: "old-h3u", repoId: "r1", workdir: wt.workdir, readRoots: [repo, actualA],
      tmpDir: join(dir, "tmp-seed"),
      git: { workTree: wt.workdir, gitDir: wt.gitDir, baseCommit: wt.head },
      poolRoot: alias,
    });

    const h = mkPooledSup({
      rootId: sid, dir: rootDir, pool: null, workspace: new GitWorkspaceManager(), repo,
      readRoots: [repo, actualA], store: new FileRunStore(rootDir, sid),
    });
    try {
      const r = await h.sup.spawn("governor", { taskName: "r", message: "m", profile: "reader", isolation: "sandbox", repoId: "r1" }, "rr-h3u");
      const res = await h.byAgent(r.agentId)[0]!.call("read", { path: "x" });
      assert.equal(res.isError, true);
      assert.match(res.content, /WORKSPACE_UNAVAILABLE: retained workspace identity unprovable/);
      assert.ok(existsSync(join(actualA, sid, "worktrees", wt.workdir.split(join(sid, "worktrees") + "/")[1]!, "kept.txt")), "files lost on visible failure");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling content lost on visible failure");
    } finally {
      await h.sup.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered backlink fails visibly with files preserved", async () => {
  const sid = "sess-h3t";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-h3tam-"));
  try {
    const repo = gitCheckout(dir);
    const actualA = join(dir, "actualA");
    mkdirSync(actualA, { recursive: true });
    const alias = join(dir, "alias");
    symlinkSync(actualA, alias);
    const wt = gitWorktreeThrough(dir, repo, join(alias, sid, "worktrees"));
    writeFileSync(join(wt.workdir, "kept.txt"), "retained\n");
    const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    // Tamper: point the admin backlink at a different existing leaf whose
    // own pointer still resolves, so only the leaf identity mismatches.
    const decoy = join(actualA, sid, "worktrees", "wt-decoy");
    mkdirSync(decoy, { recursive: true });
    const adminGitDir = wt.gitDir;
    writeFileSync(join(decoy, ".git"), `gitdir: ${adminGitDir}\n`);
    writeFileSync(join(adminGitDir, "gitdir"), `${join(decoy, ".git")}\n`);
    const rootDir = join(dir, "root");
    const seed = new FileRunStore(rootDir, sid);
    appendOldAgent({
      store: seed, agentId: "old-h3t", repoId: "r1", workdir: wt.workdir, readRoots: [repo, actualA],
      tmpDir: join(dir, "tmp-seed"),
      git: { workTree: wt.workdir, gitDir: wt.gitDir, baseCommit: wt.head },
      poolRoot: alias,
    });

    const h = mkPooledSup({
      rootId: sid, dir: rootDir, pool: null, workspace: new GitWorkspaceManager(), repo,
      readRoots: [repo, actualA], store: new FileRunStore(rootDir, sid),
    });
    try {
      const r = await h.sup.spawn("governor", { taskName: "r", message: "m", profile: "reader", isolation: "sandbox", repoId: "r1" }, "rr-h3t");
      const res = await h.byAgent(r.agentId)[0]!.call("read", { path: "x" });
      assert.equal(res.isError, true);
      assert.match(res.content, /WORKSPACE_UNAVAILABLE: retained workspace identity unprovable.*leaf mismatch/);
      assert.ok(existsSync(join(actualA, sid, "worktrees", wt.workdir.split(join(sid, "worktrees") + "/")[1]!, "kept.txt")), "files lost on visible failure");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling content lost on visible failure");
    } finally {
      await h.sup.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replaced alias proves physical A via backlink (regression)", async (t) => {
  // Strict: this closure validation must execute natively on this host.
  requireBwrap();
  console.log("bwrap legs EXECUTED: replaced-alias backlink proof");
  const sid = "sess-h6t";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-h6t-"));
  try {
    const repo = gitCheckout(dir);
    const actualA = join(dir, "actualA");
    mkdirSync(actualA, { recursive: true });
    const alias = join(dir, "alias");
    symlinkSync(actualA, alias);
    const poolB = join(dir, "srv", "poolB");
    mkdirSync(poolB, { recursive: true });
    // Genuine git worktree through the alias: real admin backlink files.
    const wt = gitWorktreeThrough(dir, repo, join(alias, sid, "worktrees"));
    writeFileSync(join(wt.workdir, "kept.txt"), "retained\n");
    // Premise: the admin backlink names the physical target, not the alias.
    // If git ever records alias-form backlinks, this fails loudly as a
    // setup premise rather than silently testing nothing.
    const backlink = readFileSync(join(wt.gitDir, "gitdir"), "utf8").trim();
    assert.ok(backlink.startsWith(actualA), `backlink does not prove physical A: ${backlink}`);
    const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");
    const seed = new FileRunStore(rootDir, sid);
    appendOldAgent({
      store: seed, agentId: "old-h6t", repoId: "r1", workdir: wt.workdir, readRoots: [repo, actualA],
      tmpDir: join(dir, "tmp-seed"),
      git: { workTree: wt.workdir, gitDir: wt.gitDir, baseCommit: wt.head },
      poolRoot: alias,
    });

    // Replace the alias with an ordinary dir; physical A keeps its data.
    rmSync(alias);
    mkdirSync(alias, { recursive: true });
    writeFileSync(join(alias, "unrelated.txt"), "not-a-pool\n");
    assert.ok(existsSync(join(actualA, sid, "worktrees", wt.workdir.split(join(sid, "worktrees") + "/")[1]!, "kept.txt")), "physical data lost");

    class RecBwrap extends BwrapToolExecutor {
      specs: any[] = [];
      async exec(spec: any): Promise<any> {
        this.specs.push(spec);
        return super.exec(spec);
      }
    }
    const openReal = (pool: string | null) => {
      const workers: CtlWorker[] = [];
      const rec = new RecBwrap();
      const policy: any = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.worktreeRoot = pool;
      policy.repos = [{ repoId: "r1", checkoutPath: repo, readRoots: [repo, actualA], allowWriters: true }];
      const sup = new Supervisor({
        rootId: sid, rootDir, store: new FileRunStore(rootDir, sid), policy,
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
        executors: { sandbox: rec, host: new HostToolExecutor() },
        workspace: new GitWorkspaceManager(),
        governor: () => ({ ...testGovernor(), cwd: repo }),
        workerFactory: (o: any) => {
          const w = new CtlWorker(o.agentId);
          workers.push(w);
          return w;
        },
      });
      return { sup, workers, rec };
    };

    for (const [tag, pool] of [["B", poolB], ["C", null]] as Array<[string, string | null]>) {
      const { sup, workers, rec } = openReal(pool);
      try {
        // Display keeps the recorded alias path; runtime goes physical.
        const listed = sup.list("governor").find((v) => v.id === "old-h6t");
        assert.ok(listed, `${tag}: retained agent missing`);
        assert.equal(listed!.workdir, wt.workdir);
        const reH6t = await sup.sendMessage("governor", "old-h6t", "task", "again", {}, `re-h6t-${tag}`);
        let resumed: CtlWorker | null = null;
        for (let i = 0; i < 100 && !(resumed as any)?.init; i++) {
          await tick(50);
          resumed = workers.find((x) => x.agentId === "old-h6t") ?? null;
        }
        assert.ok((resumed as any)?.init, `${tag}: retained owner did not resume`);
        assert.ok(String((resumed as any).init!["workdir"]).startsWith(join(actualA, sid, "worktrees")), `${tag}: initializer not in physical A`);
        // Effective routing, natively: the retained owner's own bytes read
        // through its proven physical cwd (relative and absolute).
        const ownRel: any = await (resumed as any).call("read", { path: "kept.txt" });
        assert.equal(ownRel.isError, false, ownRel.content);
        assert.ok(ownRel.content.includes("retained"), ownRel.content);
        const ck = await sup.runCheck("old-h6t", reH6t.taskRunId!, { id: `ck-${tag}`, command: "cat kept.txt", timeoutMs: 30000 });
        assert.equal(ck.exitCode, 0, ck.output);
        assert.ok(ck.output.includes("retained"), ck.output.slice(0, 200));
        // Fresh flows on the same views.
        const sN = await sup.spawn("governor", { taskName: `n-${tag}`, message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, `rn-h6t-${tag}`);
        writeFileSync(join(sN.workdir, "own.txt"), "OWN-MARKER\n");
        const w = workers[workers.length - 1];
        const ownRead: any = await w.call("read", { path: join(sN.workdir, "own.txt") });
        assert.equal(ownRead.isError, false, ownRead.content);
        const repoRead: any = await w.call("read", { path: join(repo, "pkg", "a.txt") });
        assert.equal(repoRead.isError, false, repoRead.content);
        const sibRead: any = await w.call("read", { path: join(sibDir, "secret.txt") });
        assert.equal(sibRead.isError, true);
        assert.ok(!String(sibRead.content).includes("SECRET-MARKER"), sibRead.content.slice(0, 200));
        const spec: any = rec.specs.at(-1);
        assert.ok((spec?.view?.storageRoots ?? []).includes(actualA), `${tag}: ${JSON.stringify(spec?.view?.storageRoots)}`);
        // Exact-mask + unmasked controls on the captured view.
        const bash = absBin("bash") ?? "/bin/bash";
        const cat = absBin("cat") ?? "/bin/cat";
        const tmp = join(dir, "tmp");
        mkdirSync(tmp, { recursive: true });
        const env = { PATH: "/usr/bin:/bin" };
        const base = { readRoots: [repo, actualA], writableRoot: sN.workdir, tmpDir: tmp, hidePaths: [...(spec?.view?.hidePaths ?? [])], runtimeRoots: ["/nix/store"], network: false };
        const exec = new BwrapToolExecutor();
        const exactCtl = await exec.exec({ operationId: `op-${tag}-exact`, argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: repo, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...base, storageRoots: [actualA] } });
        assert.notEqual(exactCtl.exitCode, 0, `old-A sibling readable under exact mask: ${exactCtl.stdout}`);
        const ctl = await exec.exec({ operationId: `op-${tag}-ctl`, argv: [bash, "-c", `${cat} ${join(repo, "pkg", "a.txt")} ${join(sibDir, "secret.txt")}`], cwd: repo, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...base, storageRoots: [] } });
        assert.equal(ctl.exitCode, 0, `control unreadable even unmasked: ${ctl.stderr}`);
        // Settle runs so the next reopen starts clean.
        (resumed as any).settle("succeeded", "done");
        w.settle("succeeded", "done");
        await tick(100);
      } finally {
        await sup.shutdown();
      }
    }

    // Raw journal rows unchanged (no migration), read via the public API.
    const reader = new FileRunStore(rootDir, sid);
    const { records } = reader.readSince(0, 100000);
    const spawned: any = records.find((r: any) => r.kind === "agent.spawned" && r.body?.agentId === "old-h6t");
    assert.ok(spawned && spawned.body.allocation.poolRoot === alias && spawned.body.allocation.workdir === wt.workdir, "journal row migrated");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Regression-origin additions (discovered defects H7/H4/H5; taxonomy: BA/BG
 * Behavioral-Active, each with a Good-Communication leg where native
 * closure is load-bearing):
 * - H7: exact fd-era slash leaf proves the TRUE pool across retarget and
 *   removal (BG over genuine git + fd-shaped hand rows, bwrap closure).
 * - H4: retained git identity (workspace/commit) is validated before tool
 *   authority is granted (BG over genuine git + hand rows; Dummy-handler
 *   scope — spec counts prove whether the handler was entered).
 * - H5: startup rollback joins a cleanup failure with the primary
 *   canonical error (BG over the real public GitWorkspaceManager with an
 *   injected public rollback fault).
 */
test("exact fd-era slash leaf proves the true pool across retarget/removal", async (t) => {
  // Strict: sibling closure must execute natively on this host.
  requireBwrap();
  console.log("bwrap legs EXECUTED: fd-era slash-leaf true-pool proof");
  for (const mode of ["retarget", "remove"] as const) {
    const sid = "sess-h7x";
    const dir = mkdtempSync(join(tmpdir(), `subagents-wtloc-h7x-${mode}-`));
    try {
      const repo = gitCheckout(dir);
      writeFileSync(join(repo, "shared-note.txt"), "SHARED-MARKER\n");
      spawnSync("git", ["-C", repo, "add", "."]);
      spawnSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"]);
      const actualA = join(dir, "actualA");
      const actualB = join(dir, "actualB");
      mkdirSync(actualA, { recursive: true });
      mkdirSync(actualB, { recursive: true });
      const alias = join(dir, "alias");
      symlinkSync(actualA, alias);
      const poolB = join(dir, "srv", "poolB");
      mkdirSync(poolB, { recursive: true });
      // Historical verbatim leaf, laid down with genuine git exactly as the
      // fd-era producer did (join(destDir, `wt-${repoId}-<commit>-<unique>`),
      // slashes included): the layout marker sits inside the leaf's own name.
      const slashId = `team/${sid}/worktrees/project`;
      const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
      const leafRel = `wt-team/${sid}/worktrees/project-${head.slice(0, 12)}-${Date.now()}`;
      const workdir = join(alias, sid, "worktrees", leafRel);
      const add = spawnSync("git", ["-C", repo, "worktree", "add", "--detach", workdir, head], { encoding: "utf8" });
      assert.ok(add.status === 0, add.stderr);
      const pointer = /^gitdir: (.+)$/m.exec(readFileSync(join(workdir, ".git"), "utf8"));
      assert.ok(pointer, "no gitdir pointer");
      const gitDir = pointer[1].trim();
      // Premise: the admin backlink names the physical target, not the alias.
      assert.ok(readFileSync(join(gitDir, "gitdir"), "utf8").trim().startsWith(actualA), "backlink does not prove physical A");
      writeFileSync(join(workdir, "own.txt"), "OWN-MARKER\n");
      const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
      mkdirSync(sibDir, { recursive: true });
      writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
      const rootDir = join(dir, "root");
      const seed = new FileRunStore(rootDir, sid);
      // fd-shaped row: verbatim slash repo ID, NO poolRoot key.
      appendOldAgent({
        store: seed, agentId: `old-h7x-${mode}`, repoId: slashId, workdir, readRoots: [repo, actualA],
        tmpDir: join(dir, "tmp-seed"),
        git: { workTree: workdir, gitDir, baseCommit: head },
      });

      if (mode === "retarget") {
        rmSync(alias);
        symlinkSync(actualB, alias);
      } else {
        rmSync(alias);
      }
      const physical = join(actualA, sid, "worktrees", leafRel);
      assert.ok(existsSync(join(physical, "own.txt")) && existsSync(join(sibDir, "secret.txt")), "physical data lost");

      for (const [tag, pool] of [["B", poolB], ["C", null]] as Array<[string, string | null]>) {
        const workers: CtlWorker[] = [];
        const rec = new (class extends BwrapToolExecutor {
          specs: any[] = [];
          override async exec(spec: any): Promise<any> {
            this.specs.push(spec);
            return super.exec(spec);
          }
        })();
        const policy: any = defaultSupervisorPolicy();
        policy.allowedModels = [{ provider: "p", id: "m" }];
        policy.worktreeRoot = pool;
        policy.repos = [{ repoId: slashId, checkoutPath: repo, readRoots: [repo, actualA], allowWriters: true }];
        const sup = new Supervisor({
          rootId: sid, rootDir, store: new FileRunStore(rootDir, sid), policy,
          schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
          executors: { sandbox: rec, host: new HostToolExecutor() },
          workspace: new GitWorkspaceManager(),
          governor: () => ({ ...testGovernor(), cwd: repo }),
          workerFactory: (o: any) => {
            const w = new CtlWorker(o.agentId);
            workers.push(w);
            return w;
          },
        });
        try {
          const sN = await sup.spawn("governor", { taskName: `n-${tag}`, message: "m", profile: "writer", isolation: "sandbox", repoId: slashId }, `rn-${tag}-${mode}`);
          writeFileSync(join(sN.workdir, "own.txt"), "OWN-MARKER\n");
          const w = workers[workers.length - 1]!;
          const ownRead: any = await w.call("read", { path: join(sN.workdir, "own.txt") });
          assert.equal(ownRead.isError, false, `${tag}[${mode}]: fresh own unreadable`);
          assert.ok(ownRead.content.includes("OWN-MARKER"), `${tag}[${mode}]: fresh own bytes wrong`);
          const repoRead: any = await w.call("read", { path: join(repo, "shared-note.txt") });
          assert.equal(repoRead.isError, false, `${tag}[${mode}]: approved repo unreadable`);
          const sibRead: any = await w.call("read", { path: join(sibDir, "secret.txt") });
          assert.equal(sibRead.isError, true, `${tag}[${mode}]: old-A sibling readable: ${sibRead.content?.slice?.(0, 200)}`);
          assert.ok(!String(sibRead.content).includes("SECRET-MARKER"), `${tag}[${mode}]: sibling bytes leaked`);
          const spec: any = rec.specs.at(-1);
          assert.ok((spec?.view?.storageRoots ?? []).includes(actualA), `${tag}[${mode}]: true pool A unmasked: ${JSON.stringify(spec?.view?.storageRoots)}`);
          assert.ok(!(spec?.view?.storageRoots ?? []).includes(join(actualA, sid, "worktrees", "wt-team")), `${tag}[${mode}]: narrow mid-leaf mask instead of true A: ${JSON.stringify(spec?.view?.storageRoots)}`);
          w.settle("succeeded", "done");
          await tick(100);
        } finally {
          await sup.shutdown();
        }
      }

      await t.test(`bwrap: fd-era slash leaf masks true A after ${mode}`, async () => {
        const exec = new BwrapToolExecutor();
        // Native closure on supervisor views is covered by the worker-level
        // denial above; here the exact-mask and unmasked controls prove
        // the mask load-bearing on this host.
        const tmp = join(dir, "tmp");
        mkdirSync(tmp, { recursive: true });
        const bash = absBin("bash") ?? "/bin/bash";
        const cat = absBin("cat") ?? "/bin/cat";
        const env = { PATH: "/usr/bin:/bin" };
        const exactCtl = await exec.exec({ operationId: `op-h7x-exact-${mode}`, argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: repo, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { readRoots: [repo, actualA], writableRoot: null, tmpDir: tmp, hidePaths: [], storageRoots: [actualA], runtimeRoots: ["/nix/store"], network: false } });
        assert.notEqual(exactCtl.exitCode, 0, `old-A sibling readable under exact mask: ${exactCtl.stdout}`);
        const ctl = await exec.exec({ operationId: `op-h7x-ctl-${mode}`, argv: [bash, "-c", `${cat} ${join(repo, "shared-note.txt")} ${join(sibDir, "secret.txt")}`], cwd: repo, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { readRoots: [repo, sibDir], writableRoot: null, tmpDir: tmp, hidePaths: [], storageRoots: [], runtimeRoots: ["/nix/store"], network: false } });
        assert.equal(ctl.exitCode, 0, `control unreadable even unmasked: ${ctl.stderr}`);
        assert.ok(ctl.stdout.includes("SHARED-MARKER") && ctl.stdout.includes("SECRET-MARKER"), "control did not prove the mask load-bearing");
        // Raw journal rows unchanged (no migration), read via the public API.
        const reader = new FileRunStore(rootDir, sid);
        const { records } = reader.readSince(0, 100000);
        const spawned: any = records.find((r: any) => r.kind === "agent.spawned" && r.body?.allocation?.repoId === slashId);
        assert.ok(spawned && !("poolRoot" in spawned.body.allocation), "journal row migrated");
        assert.ok(existsSync(join(physical, "own.txt")) && existsSync(join(sibDir, "secret.txt")), "files lost");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("retained git identity is validated before granting tool authority", async () => {
  // Genuine git + derived hand public rows + Dummy native handler scope:
  // spec counts prove whether the handler was entered. Healthy fields and
  // a legitimately advanced HEAD (unchanged birth baseCommit) stay
  // admissible; a worktree or commit identity that no longer validates is
  // denied visibly before any effect, with files preserved.
  const BAD_COMMIT = "deadbeef".repeat(5);
  for (const kind of ["healthy", "advanced", "worktree", "commit", "ghost"] as const) {
    const sid = "sess-h4x";
    const dir = mkdtempSync(join(tmpdir(), `subagents-wtloc-h4x-${kind}-`));
    try {
      const repo = gitCheckout(dir);
      const actual = join(dir, "actualA");
      mkdirSync(actual, { recursive: true });
      const alias = join(dir, "alias");
      symlinkSync(actual, alias);
      const wt = gitWorktreeThrough(dir, repo, join(alias, sid, "worktrees"));
      const sibling = join(actual, "other-session", "worktrees", "wt-other");
      mkdirSync(sibling, { recursive: true });
      writeFileSync(join(sibling, "sibling.txt"), "SIBLING\n");
      // P2 field: a sibling path naming nothing at all (unresolvable AND
      // different from the original allocation path).
      const ghost = join(actual, sid, "worktrees", `wt-does-not-exist-${Date.now()}`);
      assert.ok(!existsSync(ghost), `${kind}: ghost premise unmet: ${ghost}`);
      if (kind === "advanced") {
        writeFileSync(join(wt.workdir, "new.txt"), "ADVANCED\n");
        spawnSync("git", ["-C", wt.workdir, "add", "."]);
        spawnSync("git", ["-C", wt.workdir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "advance"]);
        const now = spawnSync("git", ["-C", wt.workdir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
        assert.notEqual(now, wt.head, "HEAD did not advance");
      }
      if (kind === "commit") {
        const bad = spawnSync("git", ["-C", repo, "cat-file", "-e", BAD_COMMIT], { encoding: "utf8" });
        assert.notEqual(bad.status, 0, "tampered base unexpectedly resolves");
      }
      const rootDir = join(dir, "root");
      const seed = new FileRunStore(rootDir, sid);
      appendOldAgent({
        store: seed, agentId: `old-h4x-${kind}`, repoId: "r1", workdir: wt.workdir, readRoots: [repo, actual],
        tmpDir: join(dir, "tmp-seed"),
        git: { workTree: kind === "worktree" ? sibling : kind === "ghost" ? ghost : wt.workdir, gitDir: wt.gitDir, baseCommit: kind === "commit" ? BAD_COMMIT : wt.head },
        poolRoot: alias,
      });
      const h = mkPooledSup({
        rootId: sid, dir: rootDir, pool: null, workspace: new GitWorkspaceManager(), repo,
        readRoots: [repo, actual], store: new FileRunStore(rootDir, sid),
      });
      try {
        const admitted = await h.sup.spawn("governor", { taskName: `probe-${kind}`, message: "m", profile: "reader", isolation: "sandbox", repoId: "r1" }, `request-${kind}`);
        const worker = h.byAgent(admitted.agentId)[0];
        assert.ok(worker, "admitted reader has no worker");
        const before = h.executors.sandbox.specs.length;
        const result: any = await worker!.call("read", { path: "pkg/a.txt" });
        const entered = h.executors.sandbox.specs.length - before;
        if (kind === "healthy" || kind === "advanced") {
          assert.equal(result.isError, false, `${kind}: admissible record denied: ${result.content?.slice?.(0, 200)}`);
          assert.equal(entered, 1, `${kind}: handler not entered`);
        } else {
          assert.equal(entered, 0, `${kind}: tampered identity reached the handler`);
          assert.equal(result.isError, true, `${kind}: tampered identity admitted`);
          assert.match(result.content, /WORKSPACE_UNAVAILABLE/, `${kind}: wrong denial: ${result.content?.slice?.(0, 200)}`);
        }
        assert.ok(existsSync(join(wt.workdir, "pkg", "a.txt")) && existsSync(join(sibling, "sibling.txt")), `${kind}: files lost on ${entered === 0 ? "visible failure" : "admission"}`);
      } finally {
        await h.sup.shutdown();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("startup rollback keeps cleanup failure observable next to the primary error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-h5x-"));
  try {
    const repo = gitCheckout(dir);
    const pool = join(dir, "pool");
    mkdirSync(pool, { recursive: true });
    const rootDir = join(dir, "root");
    const calls: Array<{ path: string; prune: boolean }> = [];
    let failRelease = true;
    let movedPath = "";
    // Public-API fault injection only: a real allocation moved aside so
    // canonicalization fails, then a distinct public cleanup fault.
    class MovedAsideManager extends GitWorkspaceManager {
      override allocateWriter(repoId: string, checkoutPath: string, baseCommit: string, destDir: string): any {
        const alloc: any = super.allocateWriter(repoId, checkoutPath, baseCommit, destDir);
        movedPath = `${alloc.worktreePath}.moved`;
        renameSync(alloc.worktreePath, movedPath);
        return alloc;
      }
      override releaseAllocation(allocation: any, opts?: { prune?: boolean }): void {
        calls.push({ path: allocation.worktreePath, prune: opts?.prune === true });
        if (failRelease) throw new Error("CLEANUP-INJECTED: release failed as injected");
        renameSync(movedPath, allocation.worktreePath);
        super.releaseAllocation(allocation, opts);
      }
    }
    const policy: any = defaultSupervisorPolicy();
    policy.allowedModels = [{ provider: "p", id: "m" }];
    policy.worktreeRoot = pool;
    policy.repos = [{ repoId: "r1", checkoutPath: repo, readRoots: [repo], allowWriters: true }];
    const open = (id: string, root: string) => {
      const workers: CtlWorker[] = [];
      const sup = new Supervisor({
        rootId: id, rootDir: root, store: new InMemoryRunStore(id), policy,
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
        executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() },
        workspace: new MovedAsideManager(),
        governor: () => ({ ...testGovernor(), cwd: repo }),
        workerFactory: (o: any) => {
          const w = new CtlWorker(o.agentId);
          workers.push(w);
          return w;
        },
      });
      return sup;
    };
    const sup = open("sess-h5x", rootDir);
    try {
      let error: string | null = null;
      try {
        await sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "req-h5x");
      } catch (e) {
        error = `${(e as any).code ?? "NOCODE"}: ${(e as Error).message}`;
      }
      assert.ok(error !== null && /WORKSPACE_UNAVAILABLE: allocated worktree cannot be resolved/.test(error), `primary canonical error lost: ${error}`);
      assert.ok(error!.includes("CLEANUP-INJECTED"), `cleanup failure swallowed: ${error}`);
      assert.equal(calls.length, 1, `cleanup not attempted exactly once: ${JSON.stringify(calls)}`);
      assert.equal(calls[0]!.prune, true, `rollback skipped pruning: ${JSON.stringify(calls)}`);
      assert.ok(existsSync(join(movedPath, "pkg", "a.txt")), "moved worktree data lost");
    } finally {
      await sup.shutdown();
    }
    // Healthy cleanup restores the path, prunes correctly, and keeps the
    // primary canonical error intact.
    failRelease = false;
    const healthy = open("sess-h5x-healthy", join(dir, "root-healthy"));
    try {
      let healthyError = "";
      try {
        await healthy.spawn("governor", { taskName: "w", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "req-h5x-healthy");
      } catch (e) {
        healthyError = `${(e as any).code}: ${(e as Error).message}`;
      }
      assert.match(healthyError, /WORKSPACE_UNAVAILABLE: allocated worktree cannot be resolved/, `healthy primary lost: ${healthyError}`);
      assert.equal(calls.length, 2, `healthy cleanup count wrong: ${JSON.stringify(calls)}`);
      assert.equal(calls[1]!.prune, true, `healthy rollback skipped pruning: ${JSON.stringify(calls)}`);
      assert.ok(!existsSync(calls[1]!.path) && !existsSync(movedPath), "healthy release did not complete removal");
    } finally {
      await healthy.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Regression-origin P1 (unprovable ordinary-dir replacement): with the
 * admin backlink gone, the retained namespace must fail visibly
 * (PUBLIC WORKSPACE_UNAVAILABLE naming the backlink) with ZERO native
 * handler/view entry before effect — never fail open on the recorded
 * alias. The intact-backlink control keeps full actual views with
 * exact-mask/unmasked controls. Taxonomy: regression-origin BG with a
 * Good-Communication native-closure leg.
 */
test("unprovable ordinary-dir replacement fails visibly with zero handler entry", async () => {
  requireBwrap();
  console.log("bwrap legs EXECUTED: unprovable replacement visible denial");
  for (const mode of ["main", "control"] as const) {
    const sid = "sess-p1x";
    const dir = mkdtempSync(join(tmpdir(), `subagents-wtloc-p1x-${mode}-`));
    try {
      const repo = gitCheckout(dir);
      const actualA = join(dir, "actualA");
      mkdirSync(actualA, { recursive: true });
      const alias = join(dir, "alias");
      symlinkSync(actualA, alias);
      const poolB = join(dir, "srv", "poolB");
      mkdirSync(poolB, { recursive: true });
      // Genuine git worktree through the alias: real admin backlink files.
      const wt = gitWorktreeThrough(dir, repo, join(alias, sid, "worktrees"));
      writeFileSync(join(wt.workdir, "kept.txt"), "retained\n");
      const backlink = readFileSync(join(wt.gitDir, "gitdir"), "utf8").trim();
      assert.ok(backlink.startsWith(actualA), `backlink does not prove physical A: ${backlink}`);
      const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
      mkdirSync(sibDir, { recursive: true });
      writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
      const rootDir = join(dir, "root");
      const seed = new FileRunStore(rootDir, sid);
      appendOldAgent({
        store: seed, agentId: `old-p1x-${mode}`, repoId: "r1", workdir: wt.workdir, readRoots: [repo, actualA],
        tmpDir: join(dir, "tmp-seed"),
        git: { workTree: wt.workdir, gitDir: wt.gitDir, baseCommit: wt.head },
        poolRoot: alias,
      });

      // Replace the alias with an ordinary dir in both legs; the main leg
      // additionally loses ONLY the admin backlink file (physical A intact).
      rmSync(alias);
      mkdirSync(alias, { recursive: true });
      writeFileSync(join(alias, "unrelated.txt"), "not-a-pool\n");
      if (mode === "main") rmSync(join(wt.gitDir, "gitdir"));
      assert.ok(existsSync(join(actualA, sid, "worktrees", wt.workdir.split(join(sid, "worktrees") + "/")[1]!, "kept.txt")), "physical data lost");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling content lost");

      for (const [tag, pool] of [["B", poolB], ["C", null]] as Array<[string, string | null]>) {
        const workers: CtlWorker[] = [];
        const rec = new (class extends BwrapToolExecutor {
          specs: any[] = [];
          override async exec(spec: any): Promise<any> {
            this.specs.push(spec);
            return super.exec(spec);
          }
        })();
        const policy: any = defaultSupervisorPolicy();
        policy.allowedModels = [{ provider: "p", id: "m" }];
        policy.worktreeRoot = pool;
        policy.repos = [{ repoId: "r1", checkoutPath: repo, readRoots: [repo, actualA], allowWriters: true }];
        const sup = new Supervisor({
          rootId: sid, rootDir, store: new FileRunStore(rootDir, sid), policy,
          schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
          executors: { sandbox: rec, host: new HostToolExecutor() },
          workspace: new GitWorkspaceManager(),
          governor: () => ({ ...testGovernor(), cwd: repo }),
          workerFactory: (o: any) => {
            const w = new CtlWorker(o.agentId);
            workers.push(w);
            return w;
          },
        });
        try {
          const sN = await sup.spawn("governor", { taskName: `n-${tag}`, message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, `rn-p1x-${tag}-${mode}`);
          writeFileSync(join(sN.workdir, "own.txt"), "OWN-MARKER\n");
          const w = workers[workers.length - 1]!;
          const ownRead: any = await w.call("read", { path: join(sN.workdir, "own.txt") });
          const repoRead: any = await w.call("read", { path: join(repo, "pkg", "a.txt") });
          const sibRead: any = await w.call("read", { path: join(sibDir, "secret.txt") });
          if (mode === "main") {
            // Fixed behavior: public denial before any native view exists;
            // fresh own/repo are NOT usable while the namespace is
            // unprovable, and no handler entry may occur.
            for (const [label, res] of [["own", ownRead], ["repo", repoRead], ["sibling", sibRead]] as const) {
              assert.equal(res.isError, true, `${tag}[${mode}]: ${label} admitted without provenance`);
              assert.match(res.content, /WORKSPACE_UNAVAILABLE.*administration backlink unreadable/, `${tag}[${mode}]: ${label} denial is not the public provenance error: ${String(res.content).slice(0, 160)}`);
            }
            assert.ok(!String(sibRead.content).includes("SECRET-MARKER"), `${tag}[${mode}]: sibling bytes leaked`);
            assert.equal(rec.specs.length, 0, `${tag}[${mode}]: native handler entered for an unprovable namespace`);
          } else {
            assert.equal(ownRead.isError, false, `${tag}[${mode}]: fresh own unreadable`);
            assert.equal(repoRead.isError, false, `${tag}[${mode}]: approved repo unreadable`);
            assert.equal(sibRead.isError, true, `${tag}[${mode}]: old-A sibling readable`);
            assert.ok(!String(sibRead.content).includes("SECRET-MARKER"), `${tag}[${mode}]: sibling bytes leaked`);
            const spec: any = rec.specs.at(-1);
            assert.ok((spec?.view?.storageRoots ?? []).includes(actualA), `${tag}[${mode}]: true pool A unmasked: ${JSON.stringify(spec?.view?.storageRoots)}`);
            const bash = absBin("bash") ?? "/bin/bash";
            const cat = absBin("cat") ?? "/bin/cat";
            const tmp = join(dir, "tmp");
            mkdirSync(tmp, { recursive: true });
            const env = { PATH: "/usr/bin:/bin" };
            const base = spec.view;
            const exactCtl = await new BwrapToolExecutor().exec({ operationId: `op-p1x-${tag}-exact`, argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: repo, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...base, storageRoots: [...base.storageRoots, actualA] } });
            assert.notEqual(exactCtl.exitCode, 0, `old-A sibling readable under exact mask: ${exactCtl.stdout}`);
            const ctl = await new BwrapToolExecutor().exec({ operationId: `op-p1x-${tag}-ctl`, argv: [bash, "-c", `${cat} ${join(repo, "pkg", "a.txt")} ${join(sibDir, "secret.txt")}`], cwd: repo, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...base, storageRoots: [] } });
            assert.equal(ctl.exitCode, 0, `control unreadable even unmasked: ${ctl.stderr}`);
          }
          w.settle("succeeded", "done");
          await tick(100);
        } finally {
          await sup.shutdown();
        }
      }

      // Raw journal rows unchanged (no migration), read via the public API.
      const reader = new FileRunStore(rootDir, sid);
      const { records } = reader.readSince(0, 100000);
      const spawned: any = records.find((r: any) => r.kind === "agent.spawned" && r.body?.agentId === `old-p1x-${mode}`);
      assert.ok(spawned && spawned.body.allocation.poolRoot === alias && spawned.body.allocation.workdir === wt.workdir, "journal row migrated");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/**
 * Regression-origin P3 (a04-hashed unsafe-ID preservation): a genuine
 * current-encoder `wt-h-<sha>-…` single-component allocation for an
 * unsafe repo ID proves the true physical pool across alias retarget,
 * true removal, and ordinary-dir replacement — the retained owner
 * initializes in physical A with native own bytes and a passing
 * runCheck, fresh own/repo stay usable, the old-A sibling stays denied,
 * and the journal stays unmigrated. Taxonomy: regression-origin BG with
 * a Good-Communication native-closure leg. The fd-era verbatim slash
 * birth stays covered by the exact-slash test above.
 */
test("a04-hashed unsafe-ID record proves the true pool after namespace transition", async () => {
  requireBwrap();
  console.log("bwrap legs EXECUTED: hashed-leaf true-pool proof");
  for (const mode of ["retarget", "remove", "replace-dir"] as const) {
    const sid = "sess-p3x";
    const dir = mkdtempSync(join(tmpdir(), `subagents-wtloc-p3x-${mode}-`));
    try {
      const repo = gitCheckout(dir);
      const actualA = join(dir, "actualA");
      const actualB = join(dir, "actualB");
      mkdirSync(actualA, { recursive: true });
      mkdirSync(actualB, { recursive: true });
      const alias = join(dir, "alias");
      symlinkSync(actualA, alias);
      const poolB = join(dir, "srv", "poolB");
      mkdirSync(poolB, { recursive: true });
      // Current supported encoder output for the unsafe ID, laid down
      // with genuine git through the alias (single component, no slash).
      const repoId = "team/project";
      const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
      const leaf = encodeWorktreeLeaf(repoId, head.slice(0, 12), Date.now());
      assert.ok(!leaf.includes("/"), `hashed leaf must be single-component: ${leaf}`);
      const workdir = join(alias, sid, "worktrees", leaf);
      const add = spawnSync("git", ["-C", repo, "worktree", "add", "--detach", workdir, head], { encoding: "utf8" });
      assert.ok(add.status === 0, add.stderr);
      const pointer = /^gitdir: (.+)$/m.exec(readFileSync(join(workdir, ".git"), "utf8"));
      assert.ok(pointer, "no gitdir pointer");
      const gitDir = pointer[1].trim();
      const backlink = readFileSync(join(gitDir, "gitdir"), "utf8").trim();
      assert.ok(backlink === join(realpathSync(workdir), ".git"), `backlink does not prove physical A: ${backlink}`);
      writeFileSync(join(workdir, "own.txt"), "OWN-MARKER\n");
      const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
      mkdirSync(sibDir, { recursive: true });
      writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
      const rootDir = join(dir, "root");
      const seed = new FileRunStore(rootDir, sid);
      appendOldAgent({
        store: seed, agentId: `old-p3x-${mode}`, repoId, workdir, readRoots: [repo, actualA],
        tmpDir: join(dir, "tmp-seed"),
        git: { workTree: workdir, gitDir, baseCommit: head },
        poolRoot: alias,
      });

      if (mode === "retarget") {
        rmSync(alias);
        symlinkSync(actualB, alias);
      } else if (mode === "replace-dir") {
        rmSync(alias);
        mkdirSync(alias, { recursive: true });
        writeFileSync(join(alias, "unrelated.txt"), "not-a-pool\n");
      } else {
        rmSync(alias);
      }
      const physical = join(actualA, sid, "worktrees", leaf);
      assert.ok(existsSync(join(physical, "own.txt")) && existsSync(join(sibDir, "secret.txt")), "physical data lost");

      for (const [tag, pool] of [["B", poolB], ["C", null]] as Array<[string, string | null]>) {
        const workers: CtlWorker[] = [];
        const rec = new (class extends BwrapToolExecutor {
          specs: any[] = [];
          override async exec(spec: any): Promise<any> {
            this.specs.push(spec);
            return super.exec(spec);
          }
        })();
        const policy: any = defaultSupervisorPolicy();
        policy.allowedModels = [{ provider: "p", id: "m" }];
        policy.worktreeRoot = pool;
        policy.repos = [{ repoId, checkoutPath: repo, readRoots: [repo, actualA], allowWriters: true }];
        const sup = new Supervisor({
          rootId: sid, rootDir, store: new FileRunStore(rootDir, sid), policy,
          schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
          executors: { sandbox: rec, host: new HostToolExecutor() },
          workspace: new GitWorkspaceManager(),
          governor: () => ({ ...testGovernor(), cwd: repo }),
          workerFactory: (o: any) => {
            const w = new CtlWorker(o.agentId);
            workers.push(w);
            return w;
          },
        });
        try {
          // Retained owner resumes in physical A with native own bytes.
          const reP3x = await sup.sendMessage("governor", `old-p3x-${mode}`, "task", "again", {}, `re-p3x-${tag}-${mode}`);
          let resumed: CtlWorker | null = null;
          for (let i = 0; i < 100 && !(resumed as any)?.init; i++) {
            await tick(50);
            resumed = workers.find((x) => x.agentId === `old-p3x-${mode}`) ?? null;
          }
          assert.ok((resumed as any)?.init, `${tag}[${mode}]: retained owner did not resume`);
          assert.ok(String((resumed as any).init!["workdir"]).startsWith(join(actualA, sid, "worktrees")), `${tag}[${mode}]: initializer not in physical A`);
          const ownRel: any = await (resumed as any).call("read", { path: "own.txt" });
          assert.equal(ownRel.isError, false, `${tag}[${mode}]: retained native own bytes unreadable`);
          assert.ok(String(ownRel.content).includes("OWN-MARKER"), `${tag}[${mode}]: retained native own bytes wrong`);
          const ck = await sup.runCheck(`old-p3x-${mode}`, reP3x.taskRunId!, { id: `ck-p3x-${tag}-${mode}`, command: "cat own.txt", timeoutMs: 30000 });
          assert.equal(ck.exitCode, 0, `${tag}[${mode}]: runCheck failed: ${ck.output.slice(0, 200)}`);
          assert.ok(ck.output.includes("OWN-MARKER"), `${tag}[${mode}]: runCheck bytes wrong`);
          // Fresh flows on the same views: own/repo usable, sibling denied.
          const sN = await sup.spawn("governor", { taskName: `n-${tag}`, message: "m", profile: "writer", isolation: "sandbox", repoId }, `rn-p3x-${tag}-${mode}`);
          writeFileSync(join(sN.workdir, "own.txt"), "OWN-MARKER\n");
          const w = workers[workers.length - 1]!;
          const ownRead: any = await w.call("read", { path: join(sN.workdir, "own.txt") });
          assert.equal(ownRead.isError, false, `${tag}[${mode}]: fresh own unreadable`);
          const repoRead: any = await w.call("read", { path: join(repo, "pkg", "a.txt") });
          assert.equal(repoRead.isError, false, `${tag}[${mode}]: approved repo unreadable`);
          const sibRead: any = await w.call("read", { path: join(sibDir, "secret.txt") });
          assert.equal(sibRead.isError, true, `${tag}[${mode}]: old-A sibling readable`);
          assert.ok(!String(sibRead.content).includes("SECRET-MARKER"), `${tag}[${mode}]: sibling bytes leaked`);
          const spec: any = rec.specs.at(-1);
          assert.ok((spec?.view?.storageRoots ?? []).includes(actualA), `${tag}[${mode}]: true pool A unmasked: ${JSON.stringify(spec?.view?.storageRoots)}`);
          (resumed as any).settle("succeeded", "done");
          w.settle("succeeded", "done");
          await tick(100);
        } finally {
          await sup.shutdown();
        }
      }

      const reader = new FileRunStore(rootDir, sid);
      const { records } = reader.readSince(0, 100000);
      const spawned: any = records.find((r: any) => r.kind === "agent.spawned" && r.body?.agentId === `old-p3x-${mode}`);
      assert.ok(spawned && spawned.body.allocation.poolRoot === alias && spawned.body.allocation.workdir === workdir, "journal row migrated");
      assert.ok(existsSync(join(physical, "own.txt")) && existsSync(join(sibDir, "secret.txt")), "files lost");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/**
 * Regression-origin P4 (emptied backlink carries no identity): with the
 * admin backlink file present but contentless (empty or whitespace-only)
 * after an ordinary-dir replacement, the retained namespace must fail
 * visibly (PUBLIC WORKSPACE_UNAVAILABLE naming the empty backlink) with
 * ZERO native handler/view entry before effect — readability alone is
 * not provenance. The intact-backlink control keeps full actual views.
 * Taxonomy: regression-origin BG with a Good-Communication leg.
 */
test("emptied backlink fails visibly with zero handler entry", async () => {
  requireBwrap();
  console.log("bwrap legs EXECUTED: emptied-backlink visible denial");
  for (const mode of ["main-empty", "main-blank", "control"] as const) {
    const sid = "sess-p4x";
    const dir = mkdtempSync(join(tmpdir(), `subagents-wtloc-p4x-${mode}-`));
    try {
      const repo = gitCheckout(dir);
      const actualA = join(dir, "actualA");
      mkdirSync(actualA, { recursive: true });
      const alias = join(dir, "alias");
      symlinkSync(actualA, alias);
      const poolB = join(dir, "srv", "poolB");
      mkdirSync(poolB, { recursive: true });
      const wt = gitWorktreeThrough(dir, repo, join(alias, sid, "worktrees"));
      writeFileSync(join(wt.workdir, "kept.txt"), "retained\n");
      const backlink = readFileSync(join(wt.gitDir, "gitdir"), "utf8").trim();
      assert.ok(backlink.startsWith(actualA), `backlink does not prove physical A: ${backlink}`);
      const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
      mkdirSync(sibDir, { recursive: true });
      writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
      const rootDir = join(dir, "root");
      const seed = new FileRunStore(rootDir, sid);
      appendOldAgent({
        store: seed, agentId: `old-p4x-${mode}`, repoId: "r1", workdir: wt.workdir, readRoots: [repo, actualA],
        tmpDir: join(dir, "tmp-seed"),
        git: { workTree: wt.workdir, gitDir: wt.gitDir, baseCommit: wt.head },
        poolRoot: alias,
      });

      rmSync(alias);
      mkdirSync(alias, { recursive: true });
      writeFileSync(join(alias, "unrelated.txt"), "not-a-pool\n");
      if (mode !== "control") {
        // P4 SINGLE fault: content destroyed, file stays readable.
        writeFileSync(join(wt.gitDir, "gitdir"), mode === "main-empty" ? "" : "  \n");
        assert.equal(readFileSync(join(wt.gitDir, "gitdir"), "utf8").trim(), "", "fault did not fire");
      }
      assert.ok(existsSync(join(actualA, sid, "worktrees", wt.workdir.split(join(sid, "worktrees") + "/")[1]!, "kept.txt")), "physical data lost");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling content lost");

      for (const [tag, pool] of [["B", poolB], ["C", null]] as Array<[string, string | null]>) {
        const workers: CtlWorker[] = [];
        const rec = new (class extends BwrapToolExecutor {
          specs: any[] = [];
          override async exec(spec: any): Promise<any> {
            this.specs.push(spec);
            return super.exec(spec);
          }
        })();
        const policy: any = defaultSupervisorPolicy();
        policy.allowedModels = [{ provider: "p", id: "m" }];
        policy.worktreeRoot = pool;
        policy.repos = [{ repoId: "r1", checkoutPath: repo, readRoots: [repo, actualA], allowWriters: true }];
        const sup = new Supervisor({
          rootId: sid, rootDir, store: new FileRunStore(rootDir, sid), policy,
          schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
          executors: { sandbox: rec, host: new HostToolExecutor() },
          workspace: new GitWorkspaceManager(),
          governor: () => ({ ...testGovernor(), cwd: repo }),
          workerFactory: (o: any) => {
            const w = new CtlWorker(o.agentId);
            workers.push(w);
            return w;
          },
        });
        try {
          const sN = await sup.spawn("governor", { taskName: `n-${tag}`, message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, `rn-p4x-${tag}-${mode}`);
          writeFileSync(join(sN.workdir, "own.txt"), "OWN-MARKER\n");
          const w = workers[workers.length - 1]!;
          const ownRead: any = await w.call("read", { path: join(sN.workdir, "own.txt") });
          const repoRead: any = await w.call("read", { path: join(repo, "pkg", "a.txt") });
          const sibRead: any = await w.call("read", { path: join(sibDir, "secret.txt") });
          if (mode === "control") {
            assert.equal(ownRead.isError, false, `${tag}[${mode}]: fresh own unreadable`);
            assert.equal(repoRead.isError, false, `${tag}[${mode}]: approved repo unreadable`);
            assert.equal(sibRead.isError, true, `${tag}[${mode}]: old-A sibling readable`);
            assert.ok(!String(sibRead.content).includes("SECRET-MARKER"), `${tag}[${mode}]: sibling bytes leaked`);
            const spec: any = rec.specs.at(-1);
            assert.ok((spec?.view?.storageRoots ?? []).includes(actualA), `${tag}[${mode}]: true pool A unmasked: ${JSON.stringify(spec?.view?.storageRoots)}`);
            const bash = absBin("bash") ?? "/bin/bash";
            const cat = absBin("cat") ?? "/bin/cat";
            const tmp = join(dir, "tmp");
            mkdirSync(tmp, { recursive: true });
            const env = { PATH: "/usr/bin:/bin" };
            const base = spec.view;
            const exactCtl = await new BwrapToolExecutor().exec({ operationId: `op-p4x-${tag}-exact`, argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: repo, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...base, storageRoots: [...base.storageRoots, actualA] } });
            assert.notEqual(exactCtl.exitCode, 0, `old-A sibling readable under exact mask: ${exactCtl.stdout}`);
            const ctl = await new BwrapToolExecutor().exec({ operationId: `op-p4x-${tag}-ctl`, argv: [bash, "-c", `${cat} ${join(repo, "pkg", "a.txt")} ${join(sibDir, "secret.txt")}`], cwd: repo, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...base, storageRoots: [] } });
            assert.equal(ctl.exitCode, 0, `control unreadable even unmasked: ${ctl.stderr}`);
          } else {
            for (const [label, res] of [["own", ownRead], ["repo", repoRead], ["sibling", sibRead]] as const) {
              assert.equal(res.isError, true, `${tag}[${mode}]: ${label} admitted without backlink identity`);
              assert.match(res.content, /WORKSPACE_UNAVAILABLE.*administration backlink empty/, `${tag}[${mode}]: ${label} denial is not the public identity error: ${String(res.content).slice(0, 160)}`);
            }
            assert.ok(!String(sibRead.content).includes("SECRET-MARKER"), `${tag}[${mode}]: sibling bytes leaked`);
            assert.equal(rec.specs.length, 0, `${tag}[${mode}]: native handler entered for an identity-less backlink`);
          }
          w.settle("succeeded", "done");
          await tick(100);
        } finally {
          await sup.shutdown();
        }
      }

      const reader = new FileRunStore(rootDir, sid);
      const { records } = reader.readSince(0, 100000);
      const spawned: any = records.find((r: any) => r.kind === "agent.spawned" && r.body?.agentId === `old-p4x-${mode}`);
      assert.ok(spawned && spawned.body.allocation.poolRoot === alias && spawned.body.allocation.workdir === wt.workdir, "journal row migrated");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/**
 * Production-Git counterpart of the unprovable-missing-leaf contract
 * above (the Dummy must not certify general filesystem behavior alone):
 * a genuine git worktree whose leaf was renamed aside denies visibly
 * with zero handler entry on poolB/null reopens, while pointers and
 * files stay intact. Taxonomy: regression-origin BG (supervisor group
 * over the real git backend) with Dummy-handler entry counting.
 */
test("unprovable missing git leaf fails closed after reconfigure", async () => {
  const sid = "sess-missgit";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-missgit-"));
  try {
    const repo = gitCheckout(dir);
    const actual = join(dir, "srv", "poolA");
    mkdirSync(actual, { recursive: true });
    const alias = join(dir, "alias");
    symlinkSync(actual, alias);
    const poolB = join(dir, "srv", "poolB");
    mkdirSync(poolB, { recursive: true });
    const outer = join(dir, "srv");
    const wt = gitWorktreeThrough(dir, repo, join(alias, sid, "worktrees"));
    writeFileSync(join(wt.workdir, "kept.txt"), "retained\n");
    const sibDir = join(actual, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");
    const seed = new FileRunStore(rootDir, sid);
    appendOldAgent({
      store: seed, agentId: "old-missgit", repoId: "r1", workdir: wt.workdir, readRoots: [outer],
      tmpDir: join(dir, "tmp-seed"),
      git: { workTree: wt.workdir, gitDir: wt.gitDir, baseCommit: wt.head },
      poolRoot: alias,
    });
    // Rename the owned leaf aside: pool base, alias, canonical target,
    // admin identity, and sibling content all remain.
    renameSync(wt.workdir, `${wt.workdir}.aside`);
    assert.equal(existsSync(wt.workdir), false);
    assert.ok(existsSync(join(wt.gitDir, "gitdir")), "admin backlink lost by the rename");

    for (const [tag, pool] of [["B", poolB], ["C", null]] as Array<[string, string | null]>) {
      const h = mkPooledSup({
        rootId: sid, dir: rootDir, pool, workspace: new GitWorkspaceManager(), repo,
        readRoots: [outer], store: new FileRunStore(rootDir, sid),
      });
      let primary: unknown = null;
      try {
        const retained = h.sup.list("governor").find((v) => v.id === "old-missgit");
        assert.ok(retained, `${tag}: retained agent missing after reopen`);
        assert.equal(retained!.workdir, wt.workdir);
        const r = await h.sup.spawn("governor", { taskName: `r-${tag}`, message: "m", profile: "reader", isolation: "sandbox", repoId: "r1" }, `rr-missgit-${tag}`);
        const before = h.executors.sandbox.specs.length;
        const res: any = await h.byAgent(r.agentId)[0]!.call("read", { path: "x" });
        assert.equal(res.isError, true, `${tag}: unprovable retained namespace admitted a tool call`);
        assert.match(res.content, /WORKSPACE_UNAVAILABLE: retained workspace identity unprovable/, `${tag}: wrong denial: ${String(res.content).slice(0, 160)}`);
        assert.equal(h.executors.sandbox.specs.length - before, 0, `${tag}: handler entered for an unprovable namespace`);
        assert.ok(existsSync(`${wt.workdir}.aside`), `${tag}: renamed-aside workspace files lost`);
        assert.ok(existsSync(join(sibDir, "secret.txt")), `${tag}: sibling content lost`);
      } catch (e) {
        primary = e;
      }
      await teardownJoin(() => h.sup.shutdown(), primary, `missgit-${tag}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Regression-origin P5 (rewritten backlink agrees by string only): with
 * the admin backlink rewritten to the recorded raw-alias path (whose
 * leaf is absent) after an ordinary-dir replacement, the retained
 * namespace must fail visibly (PUBLIC WORKSPACE_UNAVAILABLE) with ZERO
 * native handler/view entry before effect — naming consistency is not
 * physical provenance. The intact-backlink control keeps full actual
 * views. Taxonomy: regression-origin BG with a Good-Communication leg.
 */
test("rewritten backlink to the recorded path fails visibly with zero entry", async () => {
  requireBwrap();
  console.log("bwrap legs EXECUTED: rewritten-backlink visible denial");
  for (const mode of ["main", "control"] as const) {
    const sid = "sess-p5x";
    const dir = mkdtempSync(join(tmpdir(), `subagents-wtloc-p5x-${mode}-`));
    try {
      const repo = gitCheckout(dir);
      const actualA = join(dir, "actualA");
      mkdirSync(actualA, { recursive: true });
      const alias = join(dir, "alias");
      symlinkSync(actualA, alias);
      const poolB = join(dir, "srv", "poolB");
      mkdirSync(poolB, { recursive: true });
      const wt = gitWorktreeThrough(dir, repo, join(alias, sid, "worktrees"));
      writeFileSync(join(wt.workdir, "kept.txt"), "retained\n");
      const backlink = readFileSync(join(wt.gitDir, "gitdir"), "utf8").trim();
      assert.ok(backlink.startsWith(actualA), `backlink does not prove physical A: ${backlink}`);
      const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
      mkdirSync(sibDir, { recursive: true });
      writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
      const rootDir = join(dir, "root");
      const seed = new FileRunStore(rootDir, sid);
      appendOldAgent({
        store: seed, agentId: `old-p5x-${mode}`, repoId: "r1", workdir: wt.workdir, readRoots: [repo, actualA],
        tmpDir: join(dir, "tmp-seed"),
        git: { workTree: wt.workdir, gitDir: wt.gitDir, baseCommit: wt.head },
        poolRoot: alias,
      });

      rmSync(alias);
      mkdirSync(alias, { recursive: true });
      writeFileSync(join(alias, "unrelated.txt"), "not-a-pool\n");
      if (mode === "main") {
        // P5 SINGLE fault: content rewritten to the recorded raw path.
        writeFileSync(join(wt.gitDir, "gitdir"), `${wt.workdir}/.git\n`);
        assert.equal(readFileSync(join(wt.gitDir, "gitdir"), "utf8").trim(), `${wt.workdir}/.git`, "fault did not fire");
      }
      assert.ok(existsSync(join(actualA, sid, "worktrees", wt.workdir.split(join(sid, "worktrees") + "/")[1]!, "kept.txt")), "physical data lost");
      assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling content lost");

      for (const [tag, pool] of [["B", poolB], ["C", null]] as Array<[string, string | null]>) {
        const workers: CtlWorker[] = [];
        const rec = new (class extends BwrapToolExecutor {
          specs: any[] = [];
          override async exec(spec: any): Promise<any> {
            this.specs.push(spec);
            return super.exec(spec);
          }
        })();
        const policy: any = defaultSupervisorPolicy();
        policy.allowedModels = [{ provider: "p", id: "m" }];
        policy.worktreeRoot = pool;
        policy.repos = [{ repoId: "r1", checkoutPath: repo, readRoots: [repo, actualA], allowWriters: true }];
        const sup = new Supervisor({
          rootId: sid, rootDir, store: new FileRunStore(rootDir, sid), policy,
          schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
          executors: { sandbox: rec, host: new HostToolExecutor() },
          workspace: new GitWorkspaceManager(),
          governor: () => ({ ...testGovernor(), cwd: repo }),
          workerFactory: (o: any) => {
            const w = new CtlWorker(o.agentId);
            workers.push(w);
            return w;
          },
        });
        try {
          const sN = await sup.spawn("governor", { taskName: `n-${tag}`, message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, `rn-p5x-${tag}-${mode}`);
          writeFileSync(join(sN.workdir, "own.txt"), "OWN-MARKER\n");
          const w = workers[workers.length - 1]!;
          const ownRead: any = await w.call("read", { path: join(sN.workdir, "own.txt") });
          const repoRead: any = await w.call("read", { path: join(repo, "pkg", "a.txt") });
          const sibRead: any = await w.call("read", { path: join(sibDir, "secret.txt") });
          if (mode === "main") {
            for (const [label, res] of [["own", ownRead], ["repo", repoRead], ["sibling", sibRead]] as const) {
              assert.equal(res.isError, true, `${tag}[${mode}]: ${label} admitted on string agreement alone`);
              assert.match(res.content, /WORKSPACE_UNAVAILABLE: retained workspace identity unprovable/, `${tag}[${mode}]: ${label} denial is not public: ${String(res.content).slice(0, 160)}`);
            }
            assert.ok(!String(sibRead.content).includes("SECRET-MARKER"), `${tag}[${mode}]: sibling bytes leaked`);
            assert.equal(rec.specs.length, 0, `${tag}[${mode}]: native handler entered on string agreement alone`);
          } else {
            assert.equal(ownRead.isError, false, `${tag}[${mode}]: fresh own unreadable`);
            assert.equal(repoRead.isError, false, `${tag}[${mode}]: approved repo unreadable`);
            assert.equal(sibRead.isError, true, `${tag}[${mode}]: old-A sibling readable`);
            assert.ok(!String(sibRead.content).includes("SECRET-MARKER"), `${tag}[${mode}]: sibling bytes leaked`);
            const spec: any = rec.specs.at(-1);
            assert.ok((spec?.view?.storageRoots ?? []).includes(actualA), `${tag}[${mode}]: true pool A unmasked: ${JSON.stringify(spec?.view?.storageRoots)}`);
            const bash = absBin("bash") ?? "/bin/bash";
            const cat = absBin("cat") ?? "/bin/cat";
            const tmp = join(dir, "tmp");
            mkdirSync(tmp, { recursive: true });
            const env = { PATH: "/usr/bin:/bin" };
            const base = spec.view;
            const exactCtl = await new BwrapToolExecutor().exec({ operationId: `op-p5x-${tag}-exact`, argv: [bash, "-c", `${cat} ${join(sibDir, "secret.txt")}`], cwd: repo, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...base, storageRoots: [...base.storageRoots, actualA] } });
            assert.notEqual(exactCtl.exitCode, 0, `old-A sibling readable under exact mask: ${exactCtl.stdout}`);
            const ctl = await new BwrapToolExecutor().exec({ operationId: `op-p5x-${tag}-ctl`, argv: [bash, "-c", `${cat} ${join(repo, "pkg", "a.txt")} ${join(sibDir, "secret.txt")}`], cwd: repo, env, stdin: null, timeoutMs: 30_000, maxOutputBytes: 64 * 1024, view: { ...base, storageRoots: [] } });
            assert.equal(ctl.exitCode, 0, `control unreadable even unmasked: ${ctl.stderr}`);
          }
          w.settle("succeeded", "done");
          await tick(100);
        } finally {
          await sup.shutdown();
        }
      }

      const reader = new FileRunStore(rootDir, sid);
      const { records } = reader.readSince(0, 100000);
      const spawned: any = records.find((r: any) => r.kind === "agent.spawned" && r.body?.agentId === `old-p5x-${mode}`);
      assert.ok(spawned && spawned.body.allocation.poolRoot === alias && spawned.body.allocation.workdir === wt.workdir, "journal row migrated");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/**
 * Observational guard for the documented close contract: closing an
 * unprovable retained agent does NOT restore availability — the closed
 * record is kept and still examined, so fresh calls stay visibly denied
 * with zero new handler entries. Uses the Dummy backend for entry
 * counting (not physical reading); genuine Git closure behavior is
 * covered by the probes. Taxonomy: regression-origin BG.
 */
test("closing an unprovable retained agent does not restore availability", async () => {
  const sid = "sess-closehold";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-closehold-"));
  try {
    const repo = gitCheckout(dir);
    const actual = join(dir, "srv", "poolA");
    mkdirSync(actual, { recursive: true });
    const alias = join(dir, "alias");
    symlinkSync(actual, alias);
    const rootDir = join(dir, "root");
    const wsA = new DummyWorkspaceManager();
    wsA.gitRepoDir = repo; // Genuine retained identity for the proof boundary (H8 support).
    const storeA = new FileRunStore(rootDir, sid);
    const a = mkPooledSup({
      rootId: sid, dir: rootDir, pool: alias, workspace: wsA, repo,
      readRoots: [repo], store: storeA,
    });
    const s1 = await a.sup.spawn("governor", { taskName: "s1", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rs1");
    const retainedId = s1.agentId;
    writeFileSync(join(s1.workdir, "kept.txt"), "retained\n");
    a.byAgent(s1.agentId)[0]!.settle();
    await awaitTerminal(storeA, s1.taskRunId);
    await a.sup.shutdown();
    renameSync(s1.workdir, `${s1.workdir}.aside`);
    assert.equal(existsSync(s1.workdir), false);

    const wsB = new DummyWorkspaceManager();
    wsB.gitRepoDir = repo; // Genuine retained identity for the proof boundary (H8 support).
    const b = mkPooledSup({
      rootId: sid, dir: rootDir, pool: null, workspace: wsB, repo,
      readRoots: [repo], store: new FileRunStore(rootDir, sid),
    });
    try {
      const r = await b.sup.spawn("governor", { taskName: "r", message: "m", profile: "reader", isolation: "sandbox", repoId: "r1" }, "rr-closehold");
      const worker = b.byAgent(r.agentId)[0]!;
      const before = b.executors.sandbox.specs.length;
      const first = await worker.call("read", { path: "x" });
      assert.equal(first.isError, true, "unprovable namespace admitted a call pre-close");
      assert.match(first.content, /WORKSPACE_UNAVAILABLE: retained workspace identity unprovable/, "wrong pre-close denial");
      // Public close of the stale retained agent: ACK + kept record +
      // agent.closed journal fact, via public APIs only.
      await b.sup.close("governor", retainedId, "req-closehold");
      const listed = b.sup.list("governor").find((v) => v.id === retainedId);
      assert.ok(listed, "closed record deleted instead of kept");
      const { records } = new FileRunStore(rootDir, sid).readSince(0, 100000);
      assert.ok(records.some((rc) => rc.kind === "agent.closed" && rc.body.agentId === retainedId), "agent.closed journal fact missing");
      const retry = await worker.call("read", { path: "x" });
      assert.equal(retry.isError, true, "closure restored availability");
      assert.match(retry.content, /WORKSPACE_UNAVAILABLE: retained workspace identity unprovable/, "wrong post-close denial");
      assert.equal(b.executors.sandbox.specs.length - before, 0, "handler entered across close");
      assert.ok(existsSync(`${s1.workdir}.aside`), "renamed-aside files lost");
    } finally {
      await b.sup.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Persistent guard for the documented close contract on retargeted
 * namespaces: closing a proven retained owner keeps fresh flows usable
 * and the physical pool masked (post-close reads, captured spec, passing
 * runCheck), while a rewritten-backlink record still denies after close
 * with zero new handler entries and a typed runCheck code. Scope:
 * real-Git-workspace, hand-derived retained fixture rows, and actual
 * bwrap for mask behavior; genuine distinct OLD admissions stay covered
 * by the unchanged Parent4112/H/P probes. w-exists passthrough remains
 * unproven and unmodified: no universal provenance certification.
 * Taxonomy: regression-origin BG with Good-Communication legs.
 */
test("closed retargeted retained namespaces preserve proven masks and deny rewritten-backlink cases", async () => {
  requireBwrap();
  for (const mode of ["healthy", "broken"] as const) {
    const sid = "sess-closeav";
    const dir = mkdtempSync(join(tmpdir(), `subagents-wtloc-closeav-${mode}-`));
    try {
      const repo = gitCheckout(dir);
      const actualA = join(dir, "actualA");
      const actualB = join(dir, "actualB");
      mkdirSync(actualA, { recursive: true });
      mkdirSync(actualB, { recursive: true });
      const alias = join(dir, "alias");
      symlinkSync(actualA, alias);
      const poolB = join(dir, "srv", "poolB");
      mkdirSync(poolB, { recursive: true });
      const wt = gitWorktreeThrough(dir, repo, join(alias, sid, "worktrees"));
      writeFileSync(join(wt.workdir, "own.txt"), "OWN-MARKER\n");
      const backlink = readFileSync(join(wt.gitDir, "gitdir"), "utf8").trim();
      assert.ok(backlink.startsWith(actualA), `backlink does not prove physical A: ${backlink}`);
      const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
      mkdirSync(sibDir, { recursive: true });
      writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
      const rootDir = join(dir, "root");
      const seed = new FileRunStore(rootDir, sid);
      appendOldAgent({
        store: seed, agentId: `old-closeav-${mode}`, repoId: "r1", workdir: wt.workdir, readRoots: [repo, actualA],
        tmpDir: join(dir, "tmp-seed"),
        git: { workTree: wt.workdir, gitDir: wt.gitDir, baseCommit: wt.head },
        poolRoot: alias,
      });
      const { records: seedRecords } = seed.readSince(0, 100000);
      const oldFrames = seedRecords.map((r) => JSON.stringify(r));

      // Retarget after admission; the broken leg additionally rewrites the
      // backlink to the recorded raw path (string agreement, no provenance).
      rmSync(alias);
      symlinkSync(actualB, alias);
      if (mode === "broken") writeFileSync(join(wt.gitDir, "gitdir"), `${wt.workdir}/.git\n`);
      const physical = join(actualA, sid, "worktrees", wt.workdir.split(join(sid, "worktrees") + "/")[1]!);
      assert.ok(existsSync(join(physical, "own.txt")) && existsSync(join(sibDir, "secret.txt")), "physical data lost");

      for (const [tag, pool] of [["B", poolB], ["C", null]] as Array<[string, string | null]>) {
        const workers: CtlWorker[] = [];
        const rec = new (class extends BwrapToolExecutor {
          specs: ToolJobSpec[] = [];
          override async exec(spec: ToolJobSpec): Promise<ToolJobResult> {
            this.specs.push(spec);
            return super.exec(spec);
          }
        })();
        const policy = defaultSupervisorPolicy();
        policy.allowedModels = [{ provider: "p", id: "m" }];
        policy.worktreeRoot = pool;
        policy.repos = [{ repoId: "r1", checkoutPath: repo, readRoots: [repo, actualA], allowWriters: true }];
        const store = new FileRunStore(rootDir, sid);
        const sup = new Supervisor({
          rootId: sid, rootDir, store, policy,
          schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
          executors: { sandbox: rec, host: new HostToolExecutor() },
          workspace: new GitWorkspaceManager(),
          governor: () => ({ ...testGovernor(), cwd: repo }),
          workerFactory: (o) => {
            const w = new CtlWorker(o.agentId);
            workers.push(w);
            return w;
          },
        });
        try {
          const sN = await sup.spawn("governor", { taskName: `n-${tag}`, message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, `rn-closeav-${tag}-${mode}`);
          writeFileSync(join(sN.workdir, "own.txt"), "OWN-MARKER\n");
          // Public close of the retained agent first; availability after
          // close is what this test pins.
          await sup.close("governor", `old-closeav-${mode}`, `close-${tag}-${mode}`);
          const listed = sup.list("governor").find((v) => v.id === `old-closeav-${mode}`);
          assert.ok(listed, `${tag}[${mode}]: closed record deleted instead of kept`);
          const { records: jr } = new FileRunStore(rootDir, sid).readSince(0, 100000);
          assert.ok(jr.some((r) => r.kind === "agent.closed" && r.body.agentId === `old-closeav-${mode}`), `${tag}[${mode}]: agent.closed journal fact missing`);
          const w = workers[workers.length - 1]!;
          const before = rec.specs.length;
          const ownRead = await w.call("read", { path: join(sN.workdir, "own.txt") });
          const repoRead = await w.call("read", { path: join(repo, "pkg", "a.txt") });
          const sibRead = await w.call("read", { path: join(sibDir, "secret.txt") });
          if (mode === "healthy") {
            assert.equal(ownRead.isError, false, `${tag}[${mode}]: post-close own unreadable`);
            assert.ok(ownRead.content.includes("OWN-MARKER"), `${tag}[${mode}]: post-close own bytes wrong`);
            assert.equal(repoRead.isError, false, `${tag}[${mode}]: post-close repo unreadable`);
            assert.equal(sibRead.isError, true, `${tag}[${mode}]: post-close sibling readable`);
            assert.ok(!sibRead.content.includes("SECRET-MARKER"), `${tag}[${mode}]: sibling bytes leaked`);
            const spec = rec.specs.at(-1);
            assert.ok(spec, `${tag}[${mode}]: no native view captured post-close`);
            assert.ok(spec.view !== null, `${tag}[${mode}]: captured view is null`);
            const storageRoots = spec.view.storageRoots;
            assert.ok(storageRoots !== undefined && storageRoots.includes(actualA), `${tag}[${mode}]: physical pool unmasked post-close: ${JSON.stringify(storageRoots)}`);
            const ck = await sup.runCheck(sN.agentId, sN.taskRunId, { id: `ck-closeav-${tag}-${mode}`, command: "cat own.txt", timeoutMs: 30000 });
            assert.equal(ck.exitCode, 0, `${tag}[${mode}]: post-close runCheck failed: ${ck.output.slice(0, 200)}`);
          } else {
            for (const [label, res] of [["own", ownRead], ["repo", repoRead], ["sibling", sibRead]] as const) {
              assert.equal(res.isError, true, `${tag}[${mode}]: ${label} admitted post-close without provenance`);
              assert.match(res.content, /WORKSPACE_UNAVAILABLE: retained workspace identity unprovable/, `${tag}[${mode}]: ${label} denial not public`);
            }
            assert.ok(!sibRead.content.includes("SECRET-MARKER"), `${tag}[${mode}]: sibling bytes leaked`);
            assert.equal(rec.specs.length - before, 0, `${tag}[${mode}]: handler entered post-close without provenance`);
            let runCheckCode: unknown = null;
            try {
              await sup.runCheck(sN.agentId, sN.taskRunId, { id: `ck-closeav-${tag}-${mode}`, command: "cat own.txt", timeoutMs: 30000 });
            } catch (e) {
              runCheckCode = (e as { code?: unknown }).code;
            }
            assert.equal(runCheckCode, "WORKSPACE_UNAVAILABLE", `${tag}[${mode}]: runCheck code wrong: ${String(runCheckCode)}`);
          }
          w.settle("succeeded", "done");
          await awaitTerminal(store, sN.taskRunId);
        } finally {
          await sup.shutdown();
        }
        const { records } = new FileRunStore(rootDir, sid).readSince(0, 100000);
        assert.deepEqual(records.slice(0, oldFrames.length).map((r) => JSON.stringify(r)), oldFrames, `${tag}[${mode}]: journal prefix migrated`);
      }
    console.log("bwrap legs EXECUTED: close keeps proven masks, broken stays denied");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  }
});

test("H8 recreated recorded leaf never certifies provenance by existence (reproduction)", async (t) => {
  // H8/WF4 reproduction (user-authorized owned fixtures only): a historical
  // raw-alias retained allocation whose alias is replaced by an ordinary
  // directory, with the RECORDED writableRoot leaf recreated. Directory
  // existence must not certify physical provenance: the effective
  // allocation must either mask the proven physical namespace or fail
  // visibly (WORKSPACE_UNAVAILABLE, zero native entries) — never silently
  // trust the recreated leaf and unhide physical A. Variant (a) with the
  // leaf absent is the control (takes the backlink-proof branch either way);
  // variants (b)/(c) differ ONLY in leaf existence, isolating the
  // existsSync(w) early return as the single variable. Original journal
  // rows are never rewritten; the repo admin anchor is never touched.
  requireBwrap();
  console.log("bwrap legs EXECUTED: H8 recreated-leaf existence-vs-proof");
  const sid = "sess-h8r";
  const dir = mkdtempSync(join(tmpdir(), "subagents-wtloc-h8r-"));
  try {
    const repo = gitCheckout(dir);
    const actualA = join(dir, "actualA");
    mkdirSync(actualA, { recursive: true });
    const alias = join(dir, "alias");
    symlinkSync(actualA, alias);
    const poolB = join(dir, "srv", "poolB");
    mkdirSync(poolB, { recursive: true });
    const wt = gitWorktreeThrough(dir, repo, join(alias, sid, "worktrees"));
    writeFileSync(join(wt.workdir, "kept.txt"), "retained\n");
    const backlink = readFileSync(join(wt.gitDir, "gitdir"), "utf8").trim();
    assert.ok(backlink.startsWith(actualA), `setup premise: admin backlink must prove physical A: ${backlink}`);
    const sibDir = join(actualA, "sess-other", "worktrees", "wt-sib");
    mkdirSync(sibDir, { recursive: true });
    writeFileSync(join(sibDir, "secret.txt"), "SECRET-MARKER\n");
    const rootDir = join(dir, "root");
    const seed = new FileRunStore(rootDir, sid);
    appendOldAgent({
      store: seed, agentId: "old-h8r", repoId: "r1", workdir: wt.workdir, readRoots: [repo, actualA],
      tmpDir: join(dir, "tmp-seed"),
      git: { workTree: wt.workdir, gitDir: wt.gitDir, baseCommit: wt.head },
      poolRoot: alias,
    });

    // Replace the alias with an ordinary dir; physical A keeps its data.
    rmSync(alias);
    mkdirSync(alias, { recursive: true });
    writeFileSync(join(alias, "unrelated.txt"), "not-a-pool\n");
    const leafTail = wt.workdir.split(join(sid, "worktrees") + "/")[1]!;
    const recreatedLeaf = join(alias, sid, "worktrees", leafTail);
    assert.equal(recreatedLeaf, wt.workdir, "recreated leaf must name the recorded path");
    assert.ok(existsSync(join(actualA, sid, "worktrees", leafTail, "kept.txt")), "physical data lost in setup");

    class RecBwrap extends BwrapToolExecutor {
      specs: any[] = [];
      async exec(spec: any): Promise<any> {
        this.specs.push(spec);
        return super.exec(spec);
      }
    }
    const openReal = (pool: string | null) => {
      const workers: CtlWorker[] = [];
      const rec = new RecBwrap();
      const policy: any = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.worktreeRoot = pool;
      policy.repos = [{ repoId: "r1", checkoutPath: repo, readRoots: [repo, actualA], allowWriters: true }];
      const sup = new Supervisor({
        rootId: sid, rootDir, store: new FileRunStore(rootDir, sid), policy,
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
        executors: { sandbox: rec, host: new HostToolExecutor() },
        workspace: new GitWorkspaceManager(),
        governor: () => ({ ...testGovernor(), cwd: repo }),
        workerFactory: (o: any) => {
          const w = new CtlWorker(o.agentId);
          workers.push(w);
          return w;
        },
      });
      return { sup, workers, rec };
    };

    // Variant setups, sequenced monotonically (additive only; repo admin
    // anchor untouched throughout).
    const variants: Array<{ tag: string; setup: () => void }> = [
      { tag: "absent", setup: () => {} },
      {
        tag: "empty-pointer", setup: () => {
          mkdirSync(recreatedLeaf, { recursive: true });
          writeFileSync(join(recreatedLeaf, ".git"), "");
        },
      },
      {
        tag: "intact-pointer", setup: () => {
          mkdirSync(recreatedLeaf, { recursive: true });
          writeFileSync(join(recreatedLeaf, ".git"), `gitdir: ${wt.gitDir}\n`);
        },
      },
    ];
    for (const v of variants) {
      v.setup();
      assert.equal(existsSync(recreatedLeaf), v.tag !== "absent", `${v.tag}: leaf existence premise wrong`);
      for (const [tag, pool] of [["B", poolB], ["C", null]] as Array<[string, string | null]>) {
        const { sup, workers, rec } = openReal(pool);
        try {
          const listed = sup.list("governor").find((vv) => vv.id === "old-h8r");
          assert.ok(listed, `${v.tag}/${tag}: retained agent missing`);
          assert.equal(listed!.workdir, wt.workdir, `${v.tag}/${tag}: display must keep the recorded path`);
          // Fresh sandbox caller with an approved read root covering
          // physical A attempts the sibling secret.
          const r = await sup.spawn("governor", { taskName: `r-${v.tag}-${tag}`, message: "m", profile: "reader", isolation: "sandbox", repoId: "r1" }, `rr-h8r-${v.tag}-${tag}`);
          const specsBefore = rec.specs.length;
          const res: any = await (workers[workers.length - 1]!.call("read", { path: join(sibDir, "secret.txt") }) as Promise<unknown>);
          if (v.tag === "absent") {
            // Control: leaf absent takes the backlink-proof branch either
            // way — physical A proves and stays masked.
            assert.equal(res.isError, true, `${v.tag}/${tag}: sibling readable despite proven mask`);
            assert.ok(!String(res.content ?? "").includes("SECRET-MARKER"), `${v.tag}/${tag}: sibling bytes leaked`);
            const spec: any = rec.specs.at(-1);
            assert.ok((spec?.view?.storageRoots ?? []).includes(actualA), `${v.tag}/${tag}: proven physical A not masked: ${JSON.stringify(spec?.view?.storageRoots)}`);
          } else {
            // Existence must never certify: either physical A stays masked
            // (sibling denied) or the retained row fails visibly with zero
            // native entries — never a readable sibling.
            assert.equal(res.isError, true, `${v.tag}/${tag}: H8 BYPASS — recreated leaf unhid physical A: ${String(res.content ?? "").slice(0, 120)}`);
            assert.ok(!String(res.content ?? "").includes("SECRET-MARKER"), `${v.tag}/${tag}: H8 BYPASS — sibling bytes leaked`);
            assert.match(String(res.content ?? ""), /WORKSPACE_UNAVAILABLE|denied|not permitted|permission/i, `${v.tag}/${tag}: denial not visible: ${String(res.content ?? "").slice(0, 200)}`);
            assert.equal(rec.specs.length, specsBefore, `${v.tag}/${tag}: denied read reached a backend`);
          }
        } finally {
          await sup.shutdown();
        }
      }
    }

    // Raw journal rows unchanged (no migration), read via the public API.
    // The recreated leaf and repo admin anchor are fixture dirt, not rows.
    const reader = new FileRunStore(rootDir, sid);
    const { records } = reader.readSince(0, 100000);
    const spawned: any = records.find((r: any) => r.kind === "agent.spawned" && r.body?.agentId === "old-h8r");
    assert.ok(spawned && spawned.body.allocation.poolRoot === alias && spawned.body.allocation.workdir === wt.workdir, "journal row migrated");
    assert.ok(existsSync(join(sibDir, "secret.txt")), "sibling content lost");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
