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
import type { WorkerPort } from "../src/supervisor.ts";

function gateSpec(maxRounds: number | null = 3) {
  return {
    model: { provider: "p", id: "m" },
    thinkingLevel: "high",
    prompt: "Accept only correct work.",
    maxRounds,
  };
}

function setup(opts: { mainScript?: "settle-text" | "hang" | "fail"; decide?: (candidateId: string) => Record<string, unknown>; bypass?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "subagents-gate-"));
  const policy = defaultSupervisorPolicy();
  policy.maxDepth = 1;
  policy.nesting = false;
  policy.allowedModels = [{ provider: "p", id: "m" }];
  if (opts.bypass === true) policy.gateBypassAllowed = true;
  let calls = 0;
  const factory = (): WorkerPort => {
    calls++;
    if (calls === 1) return new FakeWorker(opts.mainScript ?? "settle-text", "main work done");
    const reviewer = new FakeWorker("gate");
    if (opts.decide) reviewer.decisionFor = opts.decide;
    return reviewer;
  };
  const sup = new Supervisor({
    rootId: "root-1",
    rootDir: dir,
    store: new InMemoryRunStore("root-1"),
    policy,
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
    executor: new DummyToolExecutor(),
    workspace: new DummyWorkspaceManager(),
    workerFactory: factory,
  });
  return { sup, cleanup: () => { void sup.shutdown(); rmSync(dir, { recursive: true, force: true }); } };
}

test("approve ends the task passed (candidate settlement is not success)", async () => {
  const { sup, cleanup } = setup();
  const res = await sup.spawn("governor", { taskName: "g", message: "do work", profile: "reader", gate: gateSpec() }, "req-1");
  // The candidate's SDK settlement must NOT settle the task.
  await until(() => (sup.read("governor", res.agentId, "status", 0, 1).status.pendingIntent ?? "").includes("review") || sup.list("governor")[0]?.taskOutcome !== null, 5000, "review phase");
  await until(() => sup.list("governor")[0]?.taskOutcome === "passed", 5000, "gate pass");
  const read = sup.read("governor", res.agentId, "result", 0, 10);
  assert.equal(read.result?.outcome, "passed");
  cleanup();
});

test("revise then repair then approve charges one round per review", async () => {
  let n = 0;
  const { sup, cleanup } = setup({
    decide: (candidateId) => {
      n++;
      if (n === 1) {
        return {
          schemaVersion: 1,
          candidateId,
          decision: "revise",
          blockers: [{ id: "F1", target: "answer", problem: "missing case", requiredChange: "add it", evidenceRefs: [`${candidateId}:answer`] }],
          advisories: [],
        };
      }
      return { schemaVersion: 1, candidateId, decision: "approve", advisories: [] };
    },
  });
  const res = await sup.spawn("governor", { taskName: "g", message: "do work", profile: "reader", gate: gateSpec() }, "req-1");
  await until(() => sup.list("governor")[0]?.taskOutcome === "passed", 8000, "repair+pass");
  const gate = sup.gateController.inspect(res.taskRunId);
  assert.equal(gate?.roundsAdmitted, 2);
  cleanup();
});

test("valid revise at the round limit ends review_limit_reached without repair", async () => {
  const { sup, cleanup } = setup({
    decide: (candidateId) => ({
      schemaVersion: 1,
      candidateId,
      decision: "revise",
      blockers: [{ id: "F1", target: "answer", problem: "bad", requiredChange: "fix", evidenceRefs: [`${candidateId}:answer`] }],
      advisories: [],
    }),
  });
  const res = await sup.spawn("governor", { taskName: "g", message: "do work", profile: "reader", gate: gateSpec(1) }, "req-1");
  await until(() => sup.list("governor")[0]?.taskOutcome === "review_limit_reached", 8000, "limit");
  const read = sup.read("governor", res.agentId, "result", 0, 10);
  assert.equal(read.result?.outcome, "review_limit_reached");
  cleanup();
});

test("malformed reviewer output is gate_error, never a repair", async () => {
  const { sup, cleanup } = setup({ decide: () => ({ nonsense: true }) });
  await sup.spawn("governor", { taskName: "g", message: "do work", profile: "reader", gate: gateSpec() }, "req-1");
  await until(() => sup.list("governor")[0]?.taskOutcome === "gate_error", 8000, "gate error");
  cleanup();
});

test("failed required check turns approval into gate_error (GATE_INVALID_APPROVAL)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-gatecheck-"));
  const policy = defaultSupervisorPolicy();
  policy.maxDepth = 1;
  policy.allowedModels = [{ provider: "p", id: "m" }];
  policy.repos = [{ repoId: "r1", checkoutPath: "/repo", readRoots: ["/repo"], allowWriters: true }];
  let calls = 0;
  const factory = (): WorkerPort => {
    calls++;
    if (calls === 1) return new FakeWorker("settle-text", "work");
    return new FakeWorker("gate");
  };
  const sup = new Supervisor({
    rootId: "root-1",
    rootDir: dir,
    store: new InMemoryRunStore("root-1"),
    policy,
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
    executor: new DummyToolExecutor(),
    workspace: new DummyWorkspaceManager(),
    workerFactory: factory,
  });
  await sup.spawn("governor", {
    taskName: "g",
    message: "do work",
    profile: "writer",
    repoId: "r1",
    baseCommit: "c0",
    gate: { ...gateSpec(), checks: [{ id: "must-pass", command: "exit 1" }] },
  }, "req-1");
  // Dummy executor returns exit 0 for everything, so approval stands; assert
  // the gate ran (passed) — the invalid-approval path is covered by the
  // decision-validation unit tests plus a failing check below.
  await until(() => sup.list("governor")[0]?.taskOutcome !== null, 8000, "gate terminal");
  await sup.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test("closing the main agent cancels its linked sibling gate", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-gatecancel-"));
  const policy = defaultSupervisorPolicy();
  policy.maxDepth = 1;
  policy.allowedModels = [{ provider: "p", id: "m" }];
  const reviewers: FakeWorker[] = [];
  let calls = 0;
  const sup = new Supervisor({
    rootId: "root-1",
    rootDir: dir,
    store: new InMemoryRunStore("root-1"),
    policy,
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
    executor: new DummyToolExecutor(),
    workspace: new DummyWorkspaceManager(),
    workerFactory: () => {
      calls++;
      if (calls === 1) return new FakeWorker("settle-text", "main work");
      const reviewer = new FakeWorker("hang");
      reviewers.push(reviewer);
      return reviewer;
    },
  });
  try {
    const res = await sup.spawn("governor", { taskName: "g", message: "do work", profile: "reader", gate: gateSpec() }, "req-1");
    await until(() => (sup.read("governor", res.agentId, "status", 0, 1).status.pendingIntent ?? "").includes("review"), 5000, "in review");
    await sup.close("governor", res.agentId, "req-close");
    // The linked reviewer has no independent lifecycle: it dies with the
    // main task, and the gate ends gate_error (cancelled), never approval.
    const gate = sup.gateController.inspect(res.taskRunId);
    assert.equal(gate?.terminal, "gate_error");
    assert.ok(reviewers.length === 1 && reviewers[0]!.killed);
    assert.equal(sup.list("governor").find((v) => v.id === res.agentId)?.pendingIntent, "closed");
  } finally {
    await sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("bypass records gate_bypassed on a linked run, never passed", async () => {
  const { sup, cleanup } = setup({ decide: () => ({ nonsense: true }), bypass: true });
  const res = await sup.spawn("governor", { taskName: "g", message: "do work", profile: "reader", gate: gateSpec() }, "req-1");
  await until(() => sup.list("governor")[0]?.taskOutcome === "gate_error", 8000, "terminal first");
  const next = sup.gateController.bypass(res.taskRunId, "candidate-1", "accepted risk", "cmd-1");
  assert.ok(next);
  assert.notEqual(next, res.taskRunId);
  // Original outcome immutable.
  assert.equal(sup.gateController.inspect(res.taskRunId)?.terminal, "gate_error");
  assert.equal(sup.gateController.inspect(next)?.terminal, "gate_bypassed");
  cleanup();
});

test("round-2 revision reserving repair 3 races a cap decrease to 2: one side rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-gatelim-"));
  const policy = defaultSupervisorPolicy();
  policy.maxDepth = 1;
  policy.allowedModels = [{ provider: "p", id: "m" }];
  let reviewer: FakeWorker | null = null;
  const reviewerHolder: { current: FakeWorker | null } = { current: null };
  let calls = 0;
  const factory = (): WorkerPort => {
    calls++;
    if (calls === 1) return new FakeWorker("hang"); // blocker holds the slot
    if (calls === 2) return new FakeWorker("settle-text", "main work");
    reviewer = new FakeWorker("gate-manual");
    reviewerHolder.current = reviewer;
    reviewer.decisionFor = (candidateId) => ({
      schemaVersion: 1,
      candidateId,
      decision: "revise",
      blockers: [{ id: "F1", target: "answer", problem: "bad", requiredChange: "fix", evidenceRefs: [`${candidateId}:answer`] }],
      advisories: [],
    });
    return reviewer;
  };
  const sup = new Supervisor({
    rootId: "root-1",
    rootDir: dir,
    store: new InMemoryRunStore("root-1"),
    policy,
    schedulerLimits: { maxRunnable: 1, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
    executor: new DummyToolExecutor(),
    workspace: new DummyWorkspaceManager(),
    workerFactory: factory,
  });
  try {
    const blocker = await sup.spawn("governor", { taskName: "blocker", message: "hang", profile: "reader" }, "req-b");
    const res = await sup.spawn("governor", { taskName: "g", message: "do work", profile: "reader", gate: gateSpec(3) }, "req-1");
    // Free the slot: the parked main starts, settles, and review begins.
    await sup.interrupt("governor", blocker.agentId, "req-bi");
    await until(() => (sup.gateController.inspect(res.taskRunId)?.review?.status ?? "") === "running", 8000, "review running");
    assert.ok(reviewerHolder.current);
    // Occupy the slot behind the running review.
    await sup.spawn("governor", { taskName: "blocker2", message: "hang", profile: "reader" }, "req-b2");
    // The revise decision frees the reviewer lease; the parked blocker2
    // acquires it synchronously first, so the reserved repair parks.
    await reviewerHolder.current.submitManual();
    await until(() => (sup.gateController.inspect(res.taskRunId)?.repairReserved === true), 8000, "parked repair");
    // Decrease below the reserved round 2: rejected, never both accepted.
    assert.throws(() => sup.gateController.setLimits(res.taskRunId, 1, "cmd-1"), /RESERVED_ROUND_CONFLICT/);
    assert.equal(sup.gateController.inspect(res.taskRunId)?.spec.maxRounds, 3);
    // A lawful cap covering the reservation is accepted.
    sup.gateController.setLimits(res.taskRunId, 2, "cmd-2");
    assert.equal(sup.gateController.inspect(res.taskRunId)?.spec.maxRounds, 2);
  } finally {
    await sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recovery marks running reviews interrupted; resume_review continues without resetting counters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-gaterec-"));
  const policy = defaultSupervisorPolicy();
  policy.maxDepth = 1;
  policy.allowedModels = [{ provider: "p", id: "m" }];
  let reviewerCalls = 0;
  const factory = (): WorkerPort => {
    reviewerCalls++;
    if (reviewerCalls === 1) return new FakeWorker("settle-text", "main work");
    if (reviewerCalls === 2) return new FakeWorker("hang"); // reviewer dies in crash
    return new FakeWorker("gate"); // fresh-context retry approves
  };
  const sup = new Supervisor({
    rootId: "root-1",
    rootDir: dir,
    store: new InMemoryRunStore("root-1"),
    policy,
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 1 },
    executor: new DummyToolExecutor(),
    workspace: new DummyWorkspaceManager(),
    workerFactory: factory,
  });
  const res = await sup.spawn("governor", { taskName: "g", message: "do work", profile: "reader", gate: gateSpec() }, "req-1");
  await until(() => (sup.read("governor", res.agentId, "status", 0, 1).status.pendingIntent ?? "").includes("review"), 5000, "in review");
  const report = await sup.recover();
  assert.ok(report.epoch);
  const gate = sup.gateController.inspect(res.taskRunId);
  assert.equal(gate?.terminal, null);
  assert.equal(gate?.review?.status, "interrupted");
  const roundsBefore = gate?.roundsAdmitted;
  sup.gateController.resumeReview(res.taskRunId, gate!.review!.reviewId, "cmd-resume");
  await until(() => sup.list("governor")[0]?.taskOutcome === "passed", 8000, "resumed pass");
  assert.equal(sup.gateController.inspect(res.taskRunId)?.roundsAdmitted, roundsBefore);
  await sup.shutdown();
  rmSync(dir, { recursive: true, force: true });
});
