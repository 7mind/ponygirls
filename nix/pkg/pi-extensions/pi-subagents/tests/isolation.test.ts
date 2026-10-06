/**
 * Isolation modes (none / worktree / sandbox) and the skills/context-file
 * snapshot children receive.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRunStore } from "../src/store.ts";
import { DummyWorkspaceManager, GitWorkspaceManager } from "../src/workspace.ts";
import { gateSpec, mkSup, tick } from "./ctl-worker.ts";
import { TEST_GOVERNOR_CWD, TEST_INSTRUCTIONS, TEST_MODEL, testGovernor } from "./fake-worker.ts";

const nest = {
  limits: { maxDepth: 2 },
  policy: (p: { maxDepth: number; nesting: boolean; repos: Array<{ repoId: string; checkoutPath: string; readRoots: string[]; allowWriters: boolean }> }) => {
    p.maxDepth = 2;
    p.nesting = true;
    p.repos = [{ repoId: "r1", checkoutPath: "/repo", readRoots: ["/repo"], allowWriters: true }];
  },
};

/** A committed checkout with a `pkg/` subdirectory; returns its path. */
function gitCheckout(dir: string): string {
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "pkg"), { recursive: true });
  writeFileSync(join(repo, "pkg", "a.txt"), "a\n");
  spawnSync("git", ["init", "-q", repo]);
  spawnSync("git", ["-C", repo, "add", "."]);
  spawnSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"]);
  return repo;
}

test("an omitted isolation is worktree: a writer edits its own worktree and reports where", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-iso-default-"));
  try {
    const repo = gitCheckout(dir);
    const { sup, byAgent } = mkSup({ dir: join(dir, "root"), workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
    const w = await sup.spawn("governor", { taskName: "w", message: "m", profile: "writer" }, "rw");
    const view = sup.list("governor")[0]!;
    assert.ok(w.workdir.startsWith(join(dir, "root", "worktrees")), w.workdir);
    assert.deepEqual({ isolation: view.isolation, workdir: view.workdir, init: byAgent(w.agentId)[0]!.init!["workdir"] }, { isolation: "worktree", workdir: w.workdir, init: w.workdir });
    writeFileSync(join(repo, "dirty.txt"), "x\n");
    await assert.rejects(() => sup.spawn("governor", { taskName: "w2", message: "m", profile: "writer" }, "rw2"), /CONFLICT: checkout has uncommitted changes; supply an explicit base_commit, commit first, or use isolation none/);
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an omitted isolation inherits a stricter owner's", async () => {
  const { sup, byAgent } = mkSup(nest);
  const s = await sup.spawn("governor", { taskName: "s", message: "m", profile: "reader", isolation: "sandbox", repoId: "r1" }, "rs");
  const res = await byAgent(s.agentId)[0]!.call("spawn_agent", { task_name: "k", message: "m", profile: "reader", repo_id: "r1" });
  assert.equal(res.isError, false, res.content);
  const kidId = (JSON.parse(res.content) as { agentId: string }).agentId;
  assert.equal(sup.list("governor").find((v) => v.id === kidId)!.isolation, "sandbox");
});

test("with isolation none a writer needs no policy: its tools run on the host in the governor's directory", async () => {
  const { sup, byAgent, executors } = mkSup({ policy: (p) => { p.repos = []; } });
  const w = await sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", isolation: "none" }, "rw");
  const worker = byAgent(w.agentId)[0]!;
  await worker.call("bash", { command: "true" });
  assert.deepEqual({
    workdir: worker.init!["workdir"],
    tools: ["write", "edit", "bash"].every((t) => worker.initTools.includes(t)),
    isolation: sup.list("governor")[0]!.isolation,
    host: executors.host.specs.map((s) => ({ cwd: s.cwd, view: s.view })),
    sandboxed: executors.sandbox.specs.length,
  }, { workdir: TEST_GOVERNOR_CWD, tools: true, isolation: "none", host: [{ cwd: TEST_GOVERNOR_CWD, view: null }], sandboxed: 0 });
});

test("repo_id and base_commit are rejected where they cannot apply", async () => {
  const { sup } = mkSup({ policy: (p) => { p.repos = [{ repoId: "r1", checkoutPath: "/repo", readRoots: ["/repo"], allowWriters: true }]; } });
  await assert.rejects(() => sup.spawn("governor", { taskName: "a", message: "m", profile: "writer", repoId: "r1" }, "ra"), /INVALID: repo_id applies to sandbox isolation only/);
  await assert.rejects(() => sup.spawn("governor", { taskName: "b", message: "m", profile: "writer", isolation: "none", baseCommit: "HEAD" }, "rb"), /INVALID: base_commit applies/);
  assert.equal(sup.admissionScheduler.agentsCreatedCount, 0);
});

test("a worktree writer edits its own worktree at the governor's project-relative directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-iso-wt-"));
  try {
    const repo = gitCheckout(dir);
    const cwd = join(repo, "pkg");
    const { sup, byAgent, executors } = mkSup({ dir: join(dir, "root"), workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd }) });
    const w = await sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", isolation: "worktree" }, "rw");
    const worker = byAgent(w.agentId)[0]!;
    await worker.call("write", { path: "b.txt", content: "b\n" });
    const workdir = String(worker.init!["workdir"]);
    assert.ok(workdir.startsWith(join(dir, "root", "worktrees")) && workdir.endsWith("/pkg"), workdir);
    assert.deepEqual(executors.host.specs.map((s) => ({ cwd: s.cwd, view: s.view })), [{ cwd: workdir, view: null }]);
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("worktree isolation outside a git checkout is refused before anything is charged", async () => {
  const { sup } = mkSup({ workspace: new DummyWorkspaceManager() });
  await assert.rejects(() => sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", isolation: "worktree" }, "rw"), /WORKSPACE_UNAVAILABLE/);
  assert.equal(sup.admissionScheduler.agentsCreatedCount, 0);
});

test("a child can be more isolated than its owner, never less", async () => {
  const { sup, byAgent, executors } = mkSup(nest);
  const p = await sup.spawn("governor", { taskName: "p", message: "m", profile: "reader", isolation: "none" }, "rp");
  const owner = byAgent(p.agentId)[0]!;
  const ok = await owner.call("spawn_agent", { task_name: "k", message: "m", profile: "reader", isolation: "sandbox", repo_id: "r1" });
  assert.equal(ok.isError, false, ok.content);
  const kidId = (JSON.parse(ok.content) as { agentId: string }).agentId;
  await byAgent(kidId)[0]!.call("read", { path: "x" });
  assert.deepEqual(executors.sandbox.specs.map((s) => s.view?.readRoots), [["/repo"]]);

  const s = await sup.spawn("governor", { taskName: "s", message: "m", profile: "reader", isolation: "sandbox", repoId: "r1" }, "rs");
  const denied = await byAgent(s.agentId)[0]!.call("spawn_agent", { task_name: "k", message: "m", profile: "reader", isolation: "none" });
  assert.equal(denied.isError, true);
  assert.match(denied.content, /POLICY_DENIED: owner runs with isolation sandbox; a child cannot be less isolated \(none\)/);
});

test("a gated writer with isolation none needs a git checkout; its candidate is the live checkout", async () => {
  const outside = mkSup({});
  await assert.rejects(() => outside.sup.spawn("governor", { taskName: "g", message: "m", profile: "writer", isolation: "none", gate: gateSpec() }, "rg"), /INVALID: a gated writer needs a git checkout/);
  const dir = mkdtempSync(join(tmpdir(), "subagents-iso-gate-"));
  try {
    const repo = gitCheckout(dir);
    const { sup, byAgent } = mkSup({ dir: join(dir, "root"), workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
    const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "writer", isolation: "none", gate: gateSpec() }, "rg");
    writeFileSync(join(repo, "pkg", "a.txt"), "changed in place\n");
    byAgent(g.agentId)[0]!.settle("succeeded", "edited a.txt");
    await tick(50);
    const candidates = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((r) => r.kind === "gate.candidate");
    assert.equal(candidates.length, 1);
    assert.ok(JSON.stringify(candidates[0]!.body).includes("pkg/a.txt"), JSON.stringify(candidates[0]!.body));
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a child receives exactly the selected skills and context files", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader", skills: ["review"], contextFiles: "all" }, "ra");
  const b = await sup.spawn("governor", { taskName: "b", message: "m", profile: "reader" }, "rb");
  assert.deepEqual(byAgent(a.agentId)[0]!.init!["instructions"], { contextFiles: TEST_INSTRUCTIONS.contextFiles, skills: [TEST_INSTRUCTIONS.skills[1]] });
  assert.deepEqual(byAgent(b.agentId)[0]!.init!["instructions"], { contextFiles: [], skills: [] });
  await assert.rejects(
    () => sup.spawn("governor", { taskName: "c", message: "m", profile: "reader", skills: ["deploy", "nope"] }, "rc"),
    /INVALID: unknown skill\(s\): "nope"; available: "deploy", "review"/,
  );
  await assert.rejects(() => sup.spawn("governor", { taskName: "d", message: "m", profile: "reader", contextFiles: ["/elsewhere/AGENTS.md"] }, "rd"), /unknown context file/);
});

test("a nested child can receive only what its owner holds", async () => {
  const { sup, byAgent } = mkSup(nest);
  const p = await sup.spawn("governor", { taskName: "p", message: "m", profile: "reader", skills: ["deploy"] }, "rp");
  const owner = byAgent(p.agentId)[0]!;
  const denied = await owner.call("spawn_agent", { task_name: "k1", message: "m", profile: "reader", skills: ["review"] });
  assert.equal(denied.isError, true);
  assert.match(denied.content, /unknown skill\(s\): "review"; available: "deploy"/);
  const ok = await owner.call("spawn_agent", { task_name: "k2", message: "m", profile: "reader", all_skills: true, all_context_files: true });
  const kidId = (JSON.parse(ok.content) as { agentId: string }).agentId;
  assert.deepEqual(byAgent(kidId)[0]!.init!["instructions"], { contextFiles: [], skills: [TEST_INSTRUCTIONS.skills[0]] });
});

test("a sandboxed child can read the directories of the skills it was given", async () => {
  const { sup, byAgent, executors } = mkSup(nest);
  const s = await sup.spawn("governor", { taskName: "s", message: "m", profile: "reader", isolation: "sandbox", repoId: "r1", skills: ["deploy"] }, "rs");
  await byAgent(s.agentId)[0]!.call("read", { path: "/skills/deploy/SKILL.md" });
  assert.deepEqual(executors.sandbox.specs.map((j) => j.view?.readRoots), [["/repo", "/skills/deploy"]]);
});

test("a reloaded child keeps the snapshot it was spawned with", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-iso-reload-"));
  try {
    const a = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    const r = await a.sup.spawn("governor", { taskName: "r", message: "m", profile: "reader", skills: "all", contextFiles: "all" }, "rr");
    a.byAgent(r.agentId)[0]!.settle();
    await tick();
    await a.sup.shutdown();
    // The governing session has since lost its skills and context files.
    const b = mkSup({ dir, store: new FileRunStore(dir, "root-1"), governor: () => ({ model: TEST_MODEL, cwd: TEST_GOVERNOR_CWD, instructions: { contextFiles: [], skills: [] } }) });
    await b.sup.sendMessage("governor", r.agentId, "task", "again", {}, "rr2");
    await tick();
    assert.deepEqual(b.byAgent(r.agentId)[0]!.init!["instructions"], TEST_INSTRUCTIONS);
    await b.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("selections fail clearly when the governor's set is unknown or too large", async () => {
  const unknown = mkSup({ governor: () => ({ ...testGovernor(), instructions: null }) });
  await assert.rejects(() => unknown.sup.spawn("governor", { taskName: "a", message: "m", profile: "reader", skills: "all" }, "ra"), /INVALID: the governing session's skills and context files are unavailable/);
  await unknown.sup.spawn("governor", { taskName: "b", message: "m", profile: "reader" }, "rb");
  const huge = { path: "/proj/HUGE.md", content: "x".repeat(200 * 1024) };
  const big = mkSup({ governor: () => ({ ...testGovernor(), instructions: { contextFiles: [...TEST_INSTRUCTIONS.contextFiles, huge], skills: [] } }) });
  await assert.rejects(() => big.sup.spawn("governor", { taskName: "c", message: "m", profile: "reader", contextFiles: "all" }, "rc"), /PAYLOAD_TOO_LARGE/);
  await big.sup.spawn("governor", { taskName: "d", message: "m", profile: "reader", contextFiles: ["/proj/AGENTS.md"] }, "rd");
});
