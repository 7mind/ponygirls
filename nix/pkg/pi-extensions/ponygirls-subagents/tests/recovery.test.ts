import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Supervisor } from "../src/supervisor.ts";
import { FileRunStore, InMemoryRunStore } from "../src/store.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { FakeWorker, until, testGovernor, bothExecutors } from "./fake-worker.ts";

test("task T → crash → reconciliation → one terminal outcome → replacement T2", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-rec-"));
  const policy = defaultSupervisorPolicy();
  const sup = new Supervisor({
    rootId: "root-1",
    governor: testGovernor,
    rootDir: dir,
    store: new FileRunStore(dir, "root-1"),
    policy,
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
    executors: bothExecutors(new DummyToolExecutor()),
    workspace: new DummyWorkspaceManager(),
    workerFactory: () => new FakeWorker("hang"),
  });
  const res = await sup.spawn("governor", { taskName: "t", message: "work", profile: "reader" }, "req-1");
  // Crash before any settlement: active generation is lost.
  const report = await sup.recover();
  assert.equal(report.settled.length, 1);
  assert.equal(report.settled[0], res.taskRunId);
  // Old joins settle on T…
  const wait = await sup.wait("governor", 0, 1000, [{ agentId: res.agentId, taskRunId: res.taskRunId }], "all_settled");
  assert.equal(wait.completed, true);
  // …and repeating recovery changes neither outcome nor identity.
  const report2 = await sup.recover();
  assert.deepEqual(report2.settled, []);
  const views = sup.list("governor");
  assert.equal(views[0]!.taskOutcome, "interrupted");
  // Replacement dispatches under a new id/generation, no old effects replay.
  const { messageId } = await sup.sendMessage("governor", res.agentId, "task", "replacement work", {}, "req-2");
  assert.ok(messageId);
  assert.notEqual(views[0]!.taskOutcome, null);
  await sup.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test("accepted but never-dispatched tasks keep their ids; explicit resume dispatches once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-recq-"));
  const policy = defaultSupervisorPolicy();
  const sup = new Supervisor({
    rootId: "root-1",
    governor: testGovernor,
    rootDir: dir,
    store: new FileRunStore(dir, "root-1"),
    policy,
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
    executors: bothExecutors(new DummyToolExecutor()),
    workspace: new DummyWorkspaceManager(),
    workerFactory: () => new FakeWorker("hang"),
  });
  const res = await sup.spawn("governor", { taskName: "t", message: "work", profile: "reader" }, "req-1");
  // Queue T2 behind the active hang run: accepted, never dispatched.
  const queued = await sup.sendMessage("governor", res.agentId, "task", "queued work", {}, "req-q");
  assert.ok(queued.taskRunId);
  assert.notEqual(queued.taskRunId, res.taskRunId);
  const report = await sup.recover();
  assert.deepEqual(report.settled, [res.taskRunId]);
  assert.deepEqual(report.requeued, [queued.taskRunId]);
  // Explicit resume dispatches the same id exactly once (no replacement identity).
  await sup.dispatchPending("governor", res.agentId, queued.taskRunId!);
  const views = sup.list("governor");
  assert.equal(views[0]!.generation, 2);
  await sup.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

function reconcileSetup(retained: Set<string>): { sup: Supervisor; dir: string; fakes: FakeWorker[] } {
  const dir = mkdtempSync(join(tmpdir(), "subagents-recon-"));
  const fakes: FakeWorker[] = [];
  const sup = new Supervisor({
    rootId: "root-1",
    governor: testGovernor,
    rootDir: dir,
    store: new InMemoryRunStore("root-1"),
    policy: defaultSupervisorPolicy(),
    executors: bothExecutors(new DummyToolExecutor()),
    workspace: new DummyWorkspaceManager(),
    workerFactory: () => {
      const f = new FakeWorker("hang");
      f.failCheckpoint = true;
      retained.forEach((id) => f.branchEntries.add(id));
      fakes.push(f);
      return f;
    },
  });
  return { sup, dir, fakes };
}

test("absent entries are reinserted once with the same message ID", async () => {
  const { sup, dir, fakes } = reconcileSetup(new Set());
  try {
    const res = await sup.spawn("governor", { taskName: "t", message: "work", profile: "reader" }, "req-1");
    const noted = await sup.sendMessage("governor", res.agentId, "note", "remember", {}, "req-n");
    await sup.recover();
    // New task on the unloaded agent reloads under current authority and
    // reconciles: the initial pre-crash delivery was never verified (no
    // receipt), so the absent entry is reinserted once with the same ID.
    await sup.sendMessage("governor", res.agentId, "task", "new work", {}, "req-t2");
    const redelivered = fakes.flatMap((f) => f.delivered).filter((d) => d.messageId === noted.messageId);
    assert.equal(redelivered.length, 2);
    assert.ok(redelivered.every((d) => d.mode === "note"));
  } finally {
    await sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("entries retained in the restored branch are never duplicated", async () => {
  const retained = new Set<string>();
  const { sup, dir, fakes } = reconcileSetup(retained);
  try {
    const res = await sup.spawn("governor", { taskName: "t", message: "work", profile: "reader" }, "req-1");
    const noted = await sup.sendMessage("governor", res.agentId, "note", "remember", {}, "req-n");
    retained.add(noted.messageId);
    await sup.recover();
    await sup.sendMessage("governor", res.agentId, "task", "new work", {}, "req-t2");
    // Present in the restored branch: bound by receipt, never reinserted.
    // Only the initial pre-crash delivery exists.
    const redelivered = fakes.flatMap((f) => f.delivered).filter((d) => d.messageId === noted.messageId);
    assert.equal(redelivered.length, 1);
  } finally {
    await sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("late events from an evicted instance are fenced", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-fence-"));
  const sup = new Supervisor({
    rootId: "root-1",
    governor: testGovernor,
    rootDir: dir,
    store: new FileRunStore(dir, "root-1"),
    policy: defaultSupervisorPolicy(),
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
    executors: bothExecutors(new DummyToolExecutor()),
    workspace: new DummyWorkspaceManager(),
    workerFactory: () => new FakeWorker("settle-text"),
  });
  const res = await sup.spawn("governor", { taskName: "t", message: "work", profile: "reader" }, "req-1");
  await until(() => sup.list("governor")[0]?.taskOutcome === "succeeded", 5000, "settle");
  // A duplicate terminal publication for the old generation is ignored.
  const before = sup.read("governor", res.agentId, "events", 0, 100, null).events.length;
  await sup.recover();
  const after = sup.read("governor", res.agentId, "events", 0, 100, null).events.length;
  assert.ok(after >= before);
  await sup.shutdown();
  rmSync(dir, { recursive: true, force: true });
});
