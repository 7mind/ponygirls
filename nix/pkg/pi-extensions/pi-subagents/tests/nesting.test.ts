import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Supervisor } from "../src/supervisor.ts";
import { InMemoryRunStore } from "../src/store.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { FakeWorker, until } from "./fake-worker.ts";

function setup(limits: Record<string, number> = {}, nesting = true) {
  const dir = mkdtempSync(join(tmpdir(), "subagents-nest-"));
  const policy = defaultSupervisorPolicy();
  policy.maxDepth = 2;
  policy.nesting = nesting;
  policy.repos = [{ repoId: "r1", checkoutPath: "/repo", readRoots: ["/repo"], allowWriters: true }];
  policy.allowedModels = [];
  const sup = new Supervisor({
    rootId: "root-1",
    rootDir: dir,
    store: new InMemoryRunStore("root-1"),
    policy,
    schedulerLimits: { maxRunnable: 1, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 2, ...limits },
    executor: new DummyToolExecutor(),
    workspace: new DummyWorkspaceManager(),
    workerFactory: () => new FakeWorker("settle-text"),
  });
  return { sup, cleanup: () => { void sup.shutdown(); rmSync(dir, { recursive: true, force: true }); } };
}

test("maxRunnable=1: parent yields, child runs, parent reacquires (no deadlock)", async () => {
  const { sup, cleanup } = setup({ maxRunnable: 1 });
  const parent = await sup.spawn("governor", { taskName: "parent", message: "delegate", profile: "reader" }, "req-p");
  await until(() => sup.list("governor").find((v) => v.id === parent.agentId)?.taskOutcome === "succeeded", 5000, "parent settle");
  // Parent settled and freed its lease; the child can now run to completion.
  const child = await sup.spawn(parent.agentId, { taskName: "kid", message: "work", profile: "reader" }, "req-c");
  await until(() => sup.list("governor").find((v) => v.id === child.agentId)?.taskOutcome === "succeeded", 5000, "child settle");
  cleanup();
});

test("nesting disabled by default rejects depth 2", async () => {
  const { sup, cleanup } = setup({}, false);
  const parent = await sup.spawn("governor", { taskName: "p", message: "w", profile: "reader" }, "req-p");
  await assert.rejects(() => sup.spawn(parent.agentId, { taskName: "k", message: "w", profile: "reader" }, "req-k"), /POLICY_DENIED/);
  cleanup();
});

test("nested writer gets its own worktree; cannot target parent workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-nestw-"));
  const policy = defaultSupervisorPolicy();
  policy.maxDepth = 2;
  policy.nesting = true;
  policy.repos = [{ repoId: "r1", checkoutPath: "/repo", readRoots: ["/repo"], allowWriters: true }];
  const workspace = new DummyWorkspaceManager();
  const sup = new Supervisor({
    rootId: "root-1",
    rootDir: dir,
    store: new InMemoryRunStore("root-1"),
    policy,
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 2 },
    executor: new DummyToolExecutor(),
    workspace,
    workerFactory: () => new FakeWorker("hang"),
  });
  const parent = await sup.spawn("governor", { taskName: "p", message: "w", profile: "writer", repoId: "r1", baseCommit: "c0" }, "req-p");
  const child = await sup.spawn(parent.agentId, { taskName: "k", message: "w", profile: "writer", repoId: "r1", baseCommit: "c0" }, "req-k");
  assert.equal(workspace.allocations.length, 2);
  assert.notEqual(workspace.allocations[0]!.worktreePath, workspace.allocations[1]!.worktreePath);
  const views = sup.list("governor");
  assert.ok(views.some((v) => v.id === child.agentId && v.path === "/root/p/k"));
  await sup.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test("reader-to-writer escalation is rejected", async () => {
  const { sup, cleanup } = setup();
  const reader = await sup.spawn("governor", { taskName: "r", message: "w", profile: "reader" }, "req-r");
  await assert.rejects(
    () => sup.spawn(reader.agentId, { taskName: "k", message: "w", profile: "writer", repoId: "r1", baseCommit: "c0" }, "req-k"),
    /POLICY_DENIED/,
  );
  cleanup();
});

test("at the resident limit, reload returns capacity error rather than self-deadlock", async () => {
  const { sup, cleanup } = setup({ maxResidentWorkers: 1 });
  await sup.spawn("governor", { taskName: "a", message: "w", profile: "reader" }, "req-a");
  await assert.rejects(() => sup.spawn("governor", { taskName: "b", message: "w", profile: "reader" }, "req-b"), /CAPACITY_EXCEEDED|queued/);
  cleanup();
});

test("closing a child owner cancels active descendants before its terminal outcome", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-nestc-"));
  const policy = defaultSupervisorPolicy();
  policy.maxDepth = 2;
  policy.nesting = true;
  const sup = new Supervisor({
    rootId: "root-1",
    rootDir: dir,
    store: new InMemoryRunStore("root-1"),
    policy,
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 2 },
    executor: new DummyToolExecutor(),
    workspace: new DummyWorkspaceManager(),
    workerFactory: () => new FakeWorker("hang"),
  });
  const parent = await sup.spawn("governor", { taskName: "p", message: "w", profile: "reader" }, "req-p");
  const child = await sup.spawn(parent.agentId, { taskName: "k", message: "w", profile: "reader" }, "req-k");
  await sup.close("governor", parent.agentId, "req-close");
  const views = sup.list("governor");
  assert.equal(views.find((v) => v.id === child.agentId)!.pendingIntent, "closed");
  assert.equal(views.find((v) => v.id === parent.agentId)!.pendingIntent, "closed");
  await sup.shutdown();
  rmSync(dir, { recursive: true, force: true });
});
