import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSupervisorPolicy, type SupervisorPolicy } from "../src/policy.ts";
import { Supervisor, type SpawnParams } from "../src/supervisor.ts";
import { FileRunStore } from "../src/store.ts";
import { HostToolExecutor } from "../src/sandbox.ts";
import { GitWorkspaceManager } from "../src/workspace.ts";
import { approve, gateSpec, mkSup, terminals } from "./ctl-worker.ts";
import { TEST_INSTRUCTIONS, testGovernor, until } from "./fake-worker.ts";

interface Fixture {
  dir: string;
  parent: string;
  repo: string;
  head: string;
  open: (cwd: string, configure: (policy: SupervisorPolicy) => void) => ReturnType<typeof mkSup>;
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.email=fixture@example.invalid", "-c", "user.name=Fixture", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function repository(path: string): string {
  mkdirSync(join(path, "pkg"), { recursive: true });
  writeFileSync(join(path, "pkg", "a.txt"), "base\n");
  git(path, "init", "-q");
  git(path, "add", ".");
  git(path, "commit", "-qm", "base");
  return git(path, "rev-parse", "HEAD");
}

function fixture(t: TestContext): Fixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "subagents-repo-path-")));
  const parent = join(dir, "projects");
  const repo = join(parent, "child");
  const head = repository(repo);
  const supervisors: ReturnType<typeof mkSup>[] = [];
  t.after(async () => {
    try {
      for (const rig of supervisors) await rig.sup.shutdown();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  return {
    dir, parent, repo, head,
    open: (cwd, configure) => {
      const rig = mkSup({
        dir: join(dir, `root-${supervisors.length}`),
        workspace: new GitWorkspaceManager(),
        governor: () => ({ ...testGovernor(), cwd }),
        policy: configure,
      });
      supervisors.push(rig);
      return rig;
    },
  };
}

function unchangedPolicy(_policy: SupervisorPolicy): void {}

test("repo_path starts a managed gated writer from a non-Git governor without workspace grants", async (t) => {
  const f = fixture(t);
  const rig = f.open(f.parent, unchangedPolicy);
  const host = new HostToolExecutor();
  rig.executors.host.handler = (spec) => host.exec(spec);
  const command = "pwd; cat pkg/a.txt";
  const params = {
    taskName: "review", message: "Review the child repository", profile: "writer" as const,
    repoPath: f.repo, skills: ["deploy"], contextFiles: "all" as const,
    gate: { ...gateSpec(), checks: [{ id: "candidate", command }], promisedOutputs: ["pkg/a.txt"] },
  };
  const spawned = await rig.sup.spawn("governor", params, "selected-repository");
  assert.ok(spawned.workdir.startsWith(`${rig.dir}/worktrees/`), spawned.workdir);
  assert.notEqual(spawned.workdir, f.repo);
  assert.equal(git(spawned.workdir, "rev-parse", "--show-toplevel"), spawned.workdir);
  const writer = rig.byAgent(spawned.agentId)[0]!;
  assert.equal(writer.init!["workdir"], spawned.workdir);
  assert.deepEqual(writer.init!["instructions"], { skills: [TEST_INSTRUCTIONS.skills[0]], contextFiles: TEST_INSTRUCTIONS.contextFiles });
  const written = await writer.call("write", { path: "pkg/a.txt", content: "candidate\n" });
  assert.equal(written.isError, false, written.content);
  writer.settle("succeeded", "candidate answer");
  await until(() => rig.sup.gateController.inspect(spawned.taskRunId)!.review !== null, 8000, "candidate review");
  const state = rig.sup.gateController.inspect(spawned.taskRunId)!;
  assert.equal(state.candidate!.fingerprint.textOnly, false);
  assert.equal(state.candidate!.baseCommit, f.head);
  assert.deepEqual(state.candidate!.fingerprint.files.map((file) => file.path), ["pkg/a.txt"]);
  assert.equal(state.evidence[0]!.exitCode, 0);
  assert.equal(state.evidence[0]!.output.trim(), `${spawned.workdir}\ncandidate`);
  const reviewerId = state.reviewerIds[0]!;
  await until(() => rig.byAgent(reviewerId).some((worker) => worker.init !== null), 8000, "reviewer initialized");
  const reviewer = rig.byAgent(reviewerId)[0]!;
  assert.equal(reviewer.init!["workdir"], spawned.workdir);
  assert.equal(reviewer.initTools.includes("write"), false);
  const verdict = await reviewer.decide(approve(state.candidate!.candidateId));
  assert.equal(verdict.isError, false, verdict.content);
  await until(() => terminals(rig.sup, spawned.taskRunId).length > 0, 8000, "gate passed");
  assert.deepEqual(terminals(rig.sup, spawned.taskRunId), ["passed"]);
  const checks = rig.executors.host.specs.filter((spec) => spec.argv.at(-1) === command);
  assert.equal(checks.length, 2);
  assert.ok(checks.every((check) => check.cwd === spawned.workdir));
  assert.equal(readFileSync(join(f.repo, "pkg", "a.txt"), "utf8"), "base\n");
  assert.equal(git(f.repo, "rev-parse", "HEAD"), f.head);
  assert.equal(git(f.repo, "status", "--porcelain"), "");
  assert.deepEqual(rig.sup.activePolicy.repos, []);
});

test("repo_path rejects unsupported profiles, isolation and conflicting selectors before admission", async (t) => {
  const f = fixture(t);
  const { sup, dir } = f.open(f.parent, unchangedPolicy);
  const cases: Array<{ name: string; params: Partial<SpawnParams>; error: RegExp }> = [
    { name: "reader", params: { profile: "reader" }, error: /INVALID: repo_path requires a managed worktree writer/ },
    { name: "none", params: { isolation: "none" }, error: /INVALID: repo_path requires a managed worktree writer/ },
    { name: "sandbox", params: { isolation: "sandbox" }, error: /INVALID: repo_path requires a managed worktree writer/ },
    { name: "registered", params: { repoId: "registered" }, error: /INVALID: repo_path cannot be combined with repo_id or workspace_path/ },
    { name: "prepared", params: { workspacePath: f.repo }, error: /INVALID: repo_path cannot be combined with repo_id or workspace_path/ },
  ];
  for (const c of cases) {
    await assert.rejects(() => sup.spawn("governor", { taskName: c.name, message: "m", profile: "writer", repoPath: f.repo, ...c.params }, c.name), c.error);
  }
  assert.equal(sup.admissionScheduler.agentsCreatedCount, 0);
  assert.deepEqual(sup.list("governor"), []);
  assert.equal(existsSync(join(dir, "worktrees")), false);
});

test("repo_path validates canonical containment and committed Git top-level identity before admission", async (t) => {
  const f = fixture(t);
  const { sup, dir } = f.open(f.parent, unchangedPolicy);
  const plain = join(f.parent, "plain");
  const unborn = join(f.parent, "unborn");
  const bare = join(f.parent, "bare");
  mkdirSync(plain);
  mkdirSync(unborn);
  git(unborn, "init", "-q");
  mkdirSync(bare);
  git(bare, "init", "-q", "--bare");
  const outside = join(f.dir, "projects-other");
  repository(outside);
  const escape = join(f.parent, "escape");
  symlinkSync(outside, escape);
  const cases: Array<{ path: string; error: RegExp }> = [
    { path: "child", error: /INVALID: repo_path must be an absolute path/ },
    { path: "", error: /INVALID: repo_path must be an absolute path/ },
    { path: `${f.repo}\0suffix`, error: /INVALID: repo_path must be an absolute path/ },
    { path: f.dir, error: /POLICY_DENIED: repo_path .* is outside the governing directory/ },
    { path: outside, error: /POLICY_DENIED: repo_path .* is outside the governing directory/ },
    { path: escape, error: /POLICY_DENIED: repo_path .* is outside the governing directory/ },
    { path: join(f.parent, "..", "projects-other"), error: /POLICY_DENIED: repo_path .* is outside the governing directory/ },
    { path: join(f.parent, "missing"), error: /WORKSPACE_UNAVAILABLE: repo_path .* is not an existing directory/ },
    { path: join(f.repo, "pkg", "a.txt"), error: /WORKSPACE_UNAVAILABLE: repo_path .* is not an existing directory/ },
    { path: plain, error: /WORKSPACE_UNAVAILABLE: repo_path .* is not a git work tree with a commit/ },
    { path: unborn, error: /WORKSPACE_UNAVAILABLE: repo_path .* is not a git work tree with a commit/ },
    { path: bare, error: /WORKSPACE_UNAVAILABLE: repo_path .* is not a git work tree with a commit/ },
    { path: join(f.repo, "pkg"), error: /WORKSPACE_UNAVAILABLE: repo_path .* is not the top-level directory/ },
  ];
  const registrations = git(f.repo, "worktree", "list", "--porcelain");
  for (const [index, c] of cases.entries()) {
    await assert.rejects(() => sup.spawn("governor", { taskName: `invalid-${index}`, message: "m", profile: "writer", repoPath: c.path }, `invalid-${index}`), c.error);
  }
  assert.equal(sup.admissionScheduler.agentsCreatedCount, 0);
  assert.equal(existsSync(join(dir, "worktrees")), false);
  assert.equal(git(f.repo, "worktree", "list", "--porcelain"), registrations);
});

test("repo_path canonicalizes governor and source aliases and accepts equal and linked checkouts", async (t) => {
  const f = fixture(t);
  const ownerAlias = join(f.dir, "owner-alias");
  const sourceAlias = join(f.dir, "source-alias");
  symlinkSync(f.parent, ownerAlias);
  symlinkSync(f.repo, sourceAlias);
  const linked = join(f.parent, "linked");
  git(f.repo, "worktree", "add", "-q", "--detach", linked, f.head);
  for (const [index, [cwd, repoPath]] of [[ownerAlias, sourceAlias], [f.repo, f.repo], [f.parent, linked]].entries()) {
    const rig = f.open(cwd!, unchangedPolicy);
    const writer = await rig.sup.spawn("governor", { taskName: "writer", message: "m", profile: "writer", repoPath: repoPath! }, `writer-${index}`);
    assert.ok(writer.workdir.startsWith(`${rig.dir}/worktrees/`), writer.workdir);
    assert.equal(git(writer.workdir, "rev-parse", "HEAD"), f.head);
    assert.equal(readFileSync(join(writer.workdir, "pkg", "a.txt"), "utf8"), "base\n");
    assert.equal(rig.byAgent(writer.agentId)[0]!.init!["workdir"], writer.workdir);
  }
});

test("repo_path is refused to nested callers through both Supervisor and child tool dispatch", async (t) => {
  const f = fixture(t);
  const rig = f.open(f.repo, (policy) => { policy.maxDepth = 2; policy.nesting = true; });
  const parent = await rig.sup.spawn("governor", { taskName: "parent", message: "m", profile: "writer", isolation: "none" }, "parent");
  await assert.rejects(() => rig.sup.spawn(parent.agentId, { taskName: "direct", message: "m", profile: "writer", repoPath: f.repo }, "direct"), /FORBIDDEN: only the governing session selects a source repository with repo_path/);
  const viaTool = await rig.byAgent(parent.agentId)[0]!.call("spawn_agent", { task_name: "tool", message: "m", profile: "writer", repo_path: f.repo });
  assert.equal(viaTool.isError, true);
  assert.match(viaTool.content, /FORBIDDEN: only the governing session selects a source repository with repo_path/);
  assert.equal(rig.sup.admissionScheduler.agentsCreatedCount, 1);
  assert.equal(rig.sup.list("governor").length, 1);
});

test("repo_path rejects supervisor storage and both current and retained worktree pools", async (t) => {
  const f = fixture(t);
  const pool = join(f.parent, "pool");
  mkdirSync(pool);
  const rig = f.open(f.dir, (policy) => { policy.worktreeRoot = pool; });
  const stored = join(rig.dir, "nested");
  repository(stored);
  const pooled = join(pool, "nested");
  repository(pooled);
  for (const [index, repoPath] of [stored, pooled].entries()) {
    await assert.rejects(() => rig.sup.spawn("governor", { taskName: `storage-${index}`, message: "m", profile: "writer", repoPath }, `storage-${index}`), /POLICY_DENIED: repo_path .* overlaps the supervisor's storage/);
  }
  assert.equal(rig.sup.admissionScheduler.agentsCreatedCount, 0);
  const first = await rig.sup.spawn("governor", { taskName: "first", message: "m", profile: "writer", repoPath: f.repo }, "first");
  rig.byAgent(first.agentId)[0]!.settle();
  await until(() => terminals(rig.sup, first.taskRunId).length > 0, 8000, "first terminal");
  await rig.sup.close("governor", first.agentId, "close-first");
  rig.sup.activePolicy.worktreeRoot = null;
  const registrations = git(f.repo, "worktree", "list", "--porcelain");
  await assert.rejects(() => rig.sup.spawn("governor", { taskName: "retained", message: "m", profile: "writer", repoPath: first.workdir }, "retained"), /POLICY_DENIED: repo_path .* overlaps the supervisor's storage/);
  assert.equal(rig.sup.admissionScheduler.agentsCreatedCount, 1);
  assert.equal(git(f.repo, "worktree", "list", "--porcelain"), registrations);
  git(f.dir, "init", "-q");
  writeFileSync(join(f.dir, "owner.txt"), "owner\n");
  git(f.dir, "add", "owner.txt");
  git(f.dir, "commit", "-qm", "owner");
  await assert.rejects(() => rig.sup.spawn("governor", { taskName: "containing-storage", message: "m", profile: "writer", repoPath: f.dir }, "containing-storage"), /POLICY_DENIED: repo_path .* overlaps the supervisor's storage/);
  assert.equal(rig.sup.admissionScheduler.agentsCreatedCount, 1);
});

test("repo_path never selects the host agent directory as a source", async (t) => {
  const f = fixture(t);
  const hostAgentDir = join(f.parent, "host-agent");
  const stored = join(hostAgentDir, "nested");
  repository(stored);
  const sup = new Supervisor({
    rootId: "host-storage", rootDir: join(f.dir, "host-root"), hostAgentDir,
    policy: defaultSupervisorPolicy(),
    governor: () => ({ ...testGovernor(), cwd: f.parent }),
    workerFactory: () => { throw new Error("storage selection must not launch a worker"); },
  });
  try {
    await assert.rejects(() => sup.spawn("governor", { taskName: "host-storage", message: "m", profile: "writer", repoPath: stored }, "host-storage"), /POLICY_DENIED: repo_path .* overlaps the supervisor's storage/);
    assert.equal(sup.admissionScheduler.agentsCreatedCount, 0);
  } finally {
    await sup.shutdown();
  }
});

test("repo_path keeps default selection and resolves dirty sources and base_commit in the selected repository", async (t) => {
  const f = fixture(t);
  git(f.parent, "init", "-q");
  writeFileSync(join(f.parent, ".gitignore"), "child/\n");
  writeFileSync(join(f.parent, "owner.txt"), "owner\n");
  git(f.parent, "add", ".gitignore", "owner.txt");
  git(f.parent, "commit", "-qm", "owner");
  const ownerHead = git(f.parent, "rev-parse", "HEAD");
  git(f.parent, "tag", "source-base");
  git(f.repo, "tag", "source-base");
  writeFileSync(join(f.repo, "later.txt"), "later\n");
  git(f.repo, "add", "later.txt");
  git(f.repo, "commit", "-qm", "later");
  writeFileSync(join(f.repo, "pkg", "a.txt"), "dirty source\n");
  const rig = f.open(f.parent, unchangedPolicy);
  const ordinary = await rig.sup.spawn("governor", { taskName: "ordinary", message: "m", profile: "writer" }, "ordinary");
  assert.equal(git(ordinary.workdir, "rev-parse", "HEAD"), ownerHead);
  assert.equal(readFileSync(join(ordinary.workdir, "owner.txt"), "utf8"), "owner\n");
  const registrations = git(f.repo, "worktree", "list", "--porcelain");
  await assert.rejects(() => rig.sup.spawn("governor", { taskName: "dirty", message: "m", profile: "writer", repoPath: f.repo }, "dirty"), /CONFLICT: checkout has uncommitted changes; supply an explicit base_commit/);
  assert.equal(git(f.repo, "worktree", "list", "--porcelain"), registrations);
  assert.equal(rig.sup.admissionScheduler.agentsCreatedCount, 1);
  const explicit = await rig.sup.spawn("governor", { taskName: "explicit", message: "m", profile: "writer", repoPath: f.repo, baseCommit: "source-base" }, "explicit");
  assert.equal(git(explicit.workdir, "rev-parse", "HEAD"), f.head);
  assert.equal(existsSync(join(explicit.workdir, "later.txt")), false);
  assert.equal(readFileSync(join(explicit.workdir, "pkg", "a.txt"), "utf8"), "base\n");
  assert.equal(readFileSync(join(f.repo, "pkg", "a.txt"), "utf8"), "dirty source\n");
  await assert.rejects(() => rig.sup.spawn("governor", { taskName: "bad-base", message: "m", profile: "writer", repoPath: f.repo, baseCommit: "missing-ref" }, "bad-base"), /WORKSPACE_UNAVAILABLE: unresolvable base commit/);
  assert.equal(rig.sup.admissionScheduler.agentsCreatedCount, 2);
});

test("without repo_path a non-Git governor still rejects managed writers and readers keep the owner directory", async (t) => {
  const f = fixture(t);
  const rig = f.open(f.parent, unchangedPolicy);
  await assert.rejects(() => rig.sup.spawn("governor", { taskName: "writer", message: "m", profile: "writer" }, "writer"), /WORKSPACE_UNAVAILABLE: worktree isolation needs a git checkout with a commit/);
  assert.equal(rig.sup.admissionScheduler.agentsCreatedCount, 0);
  const reader = await rig.sup.spawn("governor", { taskName: "reader", message: "m", profile: "reader" }, "reader");
  assert.equal(reader.workdir, f.parent);
  assert.equal(rig.byAgent(reader.agentId)[0]!.init!["workdir"], f.parent);
});

test("repo_path candidates retain their allocated Git identity and reject drift during review", async (t) => {
  const f = fixture(t);
  const rig = f.open(f.parent, unchangedPolicy);
  const main = await rig.sup.spawn("governor", { taskName: "candidate", message: "m", profile: "writer", repoPath: f.repo, gate: gateSpec() }, "candidate");
  const decoy = join(f.parent, "decoy");
  repository(decoy);
  writeFileSync(join(main.workdir, "pkg", "a.txt"), "candidate\n");
  writeFileSync(join(main.workdir, ".git"), `gitdir: ${join(decoy, ".git")}\n`);
  rig.byAgent(main.agentId)[0]!.settle("succeeded", "candidate answer");
  await until(() => rig.sup.gateController.inspect(main.taskRunId)!.review !== null, 8000, "candidate review");
  const state = rig.sup.gateController.inspect(main.taskRunId)!;
  assert.equal(state.candidate!.baseCommit, f.head);
  assert.deepEqual(state.candidate!.fingerprint.files.map((file) => file.path), ["pkg/a.txt"]);
  assert.equal(rig.sup.workspaceMatches(main.agentId, state.candidate!), true);
  writeFileSync(join(main.workdir, "pkg", "a.txt"), "post-capture drift\n");
  const reviewerId = state.reviewerIds[0]!;
  await until(() => rig.byAgent(reviewerId).some((worker) => worker.init !== null), 8000, "reviewer initialized");
  const verdict = await rig.byAgent(reviewerId)[0]!.decide(approve(state.candidate!.candidateId));
  assert.equal(verdict.isError, false, verdict.content);
  await until(() => terminals(rig.sup, main.taskRunId).length > 0, 8000, "superseded candidate");
  assert.deepEqual(terminals(rig.sup, main.taskRunId), ["candidate_superseded"]);
  assert.equal(readFileSync(join(f.repo, "pkg", "a.txt"), "utf8"), "base\n");
});

test("repo_path allocation survives reload without following a retargeted source alias", async (t) => {
  const f = fixture(t);
  const sourceAlias = join(f.parent, "selected");
  symlinkSync(f.repo, sourceAlias);
  const root = join(f.dir, "durable");
  const first = mkSup({ dir: root, store: new FileRunStore(root, "root-1"), workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: f.parent }) });
  let agentId: string;
  let workdir: string;
  try {
    const main = await first.sup.spawn("governor", { taskName: "main", message: "m", profile: "writer", repoPath: sourceAlias }, "main");
    agentId = main.agentId;
    workdir = main.workdir;
    first.byAgent(main.agentId)[0]!.settle();
    await until(() => terminals(first.sup, main.taskRunId).length > 0, 8000, "first task terminal");
  } finally {
    await first.sup.shutdown();
  }
  const decoy = join(f.parent, "decoy");
  repository(decoy);
  writeFileSync(join(decoy, "pkg", "a.txt"), "decoy\n");
  rmSync(sourceAlias);
  symlinkSync(decoy, sourceAlias);
  const reloaded = mkSup({ dir: root, store: new FileRunStore(root, "root-1"), workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: f.dir }) });
  try {
    assert.equal(reloaded.sup.list("governor")[0]!.workdir, workdir);
    await reloaded.sup.sendMessage("governor", agentId, "task", "continue", {}, "continue");
    await until(() => reloaded.byAgent(agentId).some((worker) => worker.init !== null), 8000, "reloaded worker initialized");
    assert.equal(reloaded.byAgent(agentId)[0]!.init!["workdir"], workdir);
    assert.equal(readFileSync(join(workdir, "pkg", "a.txt"), "utf8"), "base\n");
    assert.equal(git(workdir, "rev-parse", "HEAD"), f.head);
  } finally {
    await reloaded.sup.shutdown();
  }
});
