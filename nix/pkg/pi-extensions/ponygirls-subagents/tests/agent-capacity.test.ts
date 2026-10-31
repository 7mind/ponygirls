/** BG, regression: admission capacity follows open identities, not retained history. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Supervisor } from "../src/supervisor.ts";
import { FileRunStore, InMemoryRunStore, type RunStore } from "../src/store.ts";
import { SubagentsError } from "../src/errors.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import type { SchedulerLimits } from "../src/scheduler.ts";
import { FakeWorker, type FakeScript, until, testGovernor, bothExecutors } from "./fake-worker.ts";

type Storage = "memory" | "file";
interface CapacityDetails {
  capacity: string;
  open: number;
  reusableAgentIds: string[];
}

function fixture(t: TestContext, storage: Storage, limits: Partial<SchedulerLimits>, script: (index: number) => FakeScript) {
  const rootDir = mkdtempSync(join(tmpdir(), "subagents-capacity-"));
  const rootId = "capacity";
  const policy = defaultSupervisorPolicy();
  policy.nesting = true;
  policy.maxDepth = 2;
  policy.allowedModels = null;
  const memory = new InMemoryRunStore(rootId);
  const openStore = (): RunStore => storage === "memory" ? memory : new FileRunStore(join(rootDir, "store"), rootId);
  let store = openStore();
  const workers: FakeWorker[] = [];
  const options = {
    rootId, rootDir, policy, governor: testGovernor,
    schedulerLimits: { ...limits },
    executors: bothExecutors(new DummyToolExecutor()), workspace: new DummyWorkspaceManager(),
    workerFactory: () => {
      const worker = new FakeWorker(script(workers.length));
      const setEventHandler = worker.setEventHandler.bind(worker);
      worker.setEventHandler = (handler) => setEventHandler((event) => handler(event.kind === "settled"
        ? { ...event, detail: { ...event.detail, usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: null, cost: 0, unknown: false } } }
        : event));
      workers.push(worker);
      return worker;
    },
  };
  let sup = new Supervisor({ ...options, store });
  t.after(async () => { await sup.shutdown(); rmSync(rootDir, { recursive: true, force: true }); });
  return {
    get sup() { return sup; },
    get store() { return store; },
    workers,
    restart: async () => { await sup.shutdown(); store = openStore(); sup = new Supervisor({ ...options, store }); },
  };
}

async function exhausted(action: () => Promise<unknown>): Promise<CapacityDetails> {
  let details: CapacityDetails | null = null;
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof SubagentsError);
    assert.equal(error.code, "CAPACITY_EXCEEDED");
    details = error.details as CapacityDetails;
    return true;
  });
  assert.ok(details !== null);
  return details;
}

for (const storage of ["memory", "file"] as const) {
  test(`[${storage}] close reclaims admission without erasing history, usage, or tombstones`, async (t) => {
    const f = fixture(t, storage, { maxOpenAgents: 1 }, () => "settle-text");
    const first = await f.sup.spawn("governor", { taskName: "first", message: "first", profile: "reader" }, "first");
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    await exhausted(() => f.sup.spawn("governor", { taskName: "excess", message: "work", profile: "reader" }, "excess"));
    const usage = f.sup.rootUsage();
    await f.sup.close("governor", first.agentId, "close");
    assert.deepEqual(f.sup.rootUsage(), usage);
    assert.equal(f.sup.read("governor", first.agentId, "result", 0, 100, first.taskRunId).result?.text, "fake result");
    await assert.rejects(() => f.sup.sendMessage("governor", first.agentId, "task", "resume", {}, "resume"), /CLOSED/);
    await assert.rejects(() => f.sup.spawn("governor", { taskName: "first", message: "reuse path", profile: "reader" }, "reuse-path"), /CONFLICT/);
    const replacement = await f.sup.spawn("governor", { taskName: "replacement", message: "new", profile: "reader" }, "replacement");
    assert.notEqual(replacement.agentId, first.agentId);
    assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 2);
    assert.equal(f.sup.admissionScheduler.snapshot().open, 1);
  });

  test(`[${storage}] capacity advice includes all authorized descendants but not another owner's agents`, async (t) => {
    const f = fixture(t, storage, { maxOpenAgents: 3 }, (index) => index === 0 ? "hang" : "settle-text");
    const parent = await f.sup.spawn("governor", { taskName: "parent", message: "wait", profile: "reader" }, "parent");
    const child = await f.sup.spawn(parent.agentId, { taskName: "child", message: "work", profile: "reader" }, "child");
    const sibling = await f.sup.spawn("governor", { taskName: "sibling", message: "work", profile: "reader" }, "sibling");
    await until(() => f.sup.list("governor").filter((a) => a.taskOutcome === "succeeded").length === 2);
    const spawn = () => f.sup.spawn("governor", { taskName: "excess", message: "work", profile: "reader" }, "excess");
    const rootAdvice = await exhausted(spawn);
    assert.deepEqual(new Set(rootAdvice.reusableAgentIds), new Set([child.agentId, sibling.agentId]));
    const ownerAdvice = await exhausted(() => f.sup.spawn(parent.agentId, { taskName: "excess", message: "work", profile: "reader" }, "owner-excess"));
    assert.deepEqual(ownerAdvice.reusableAgentIds, [child.agentId]);
    await assert.rejects(() => f.sup.sendMessage(sibling.agentId, child.agentId, "task", "forbidden", {}, "sibling-task"), /FORBIDDEN/);
    await f.sup.sendMessage("governor", child.agentId, "task", "reuse nested", {}, "reuse-child");
    await until(() => f.sup.list("governor").some((a) => a.id === child.agentId && a.generation === 2 && a.taskOutcome === "succeeded"));
    assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 3);
    await f.sup.close("governor", child.agentId, "close-nested");
    await f.sup.spawn("governor", { taskName: "replacement", message: "new", profile: "reader" }, "replacement");
    assert.equal(f.sup.list("governor").find((a) => a.id === parent.agentId)?.observed, "running");
    assert.equal(f.sup.list("governor").find((a) => a.id === sibling.agentId)?.taskOutcome, "succeeded");
  });

  test(`[${storage}] overlapping subtree closes release each identity exactly once`, async (t) => {
    const f = fixture(t, storage, { maxOpenAgents: 3 }, (index) => index < 2 ? "hang" : "settle-text");
    const parent = await f.sup.spawn("governor", { taskName: "parent", message: "wait", profile: "reader" }, "parent");
    const child = await f.sup.spawn(parent.agentId, { taskName: "child", message: "wait", profile: "reader" }, "child");
    const sibling = await f.sup.spawn("governor", { taskName: "sibling", message: "work", profile: "reader" }, "sibling");
    await until(() => f.sup.list("governor").some((a) => a.id === sibling.agentId && a.taskOutcome === "succeeded"));
    await Promise.all([
      f.sup.close("governor", parent.agentId, "close-parent"),
      f.sup.close("governor", child.agentId, "close-child"),
    ]);
    await f.sup.close("governor", parent.agentId, "close-again");
    assert.ok(f.workers[0]!.killed && f.workers[1]!.killed);
    assert.equal(f.workers[2]!.killed, false);
    for (const name of ["new-one", "new-two"]) await f.sup.spawn("governor", { taskName: name, message: "new", profile: "reader" }, name);
    await exhausted(() => f.sup.spawn("governor", { taskName: "overflow", message: "no", profile: "reader" }, "overflow"));
    assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 5);
    assert.equal(f.sup.admissionScheduler.snapshot().open, 3);
    const closed = f.store.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((r) => r.kind === "agent.closed");
    assert.equal(closed.length, 2);
  });

  test(`[${storage}] replay restores open capacity and cumulative accounting independently`, async (t) => {
    const f = fixture(t, storage, { maxOpenAgents: 1 }, () => "settle-text");
    const first = await f.sup.spawn("governor", { taskName: "first", message: "first", profile: "reader" }, "first");
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    await f.sup.close("governor", first.agentId, "close");
    // Older journals can contain repeated close facts for the same identity.
    f.store.append("agent.closed", { agentId: first.agentId, path: first.path });
    const usage = f.sup.rootUsage();
    await f.restart();
    assert.deepEqual(f.sup.rootUsage(), usage);
    await f.sup.close("governor", first.agentId, "already-closed");
    await f.sup.spawn("governor", { taskName: "replacement", message: "new", profile: "reader" }, "replacement");
    assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 2);
    assert.equal(f.sup.admissionScheduler.snapshot().open, 1);
    await exhausted(() => f.sup.spawn("governor", { taskName: "overflow", message: "no", profile: "reader" }, "overflow"));
  });

  test(`[${storage}] close releases the complete reserved reviewer panel before it starts`, async (t) => {
    const f = fixture(t, storage, { maxOpenAgents: 3 }, () => "hang");
    const gate = { prompt: "review", thinkingLevel: "off", reviewers: [
      { model: { provider: "test", id: "one" } }, { model: { provider: "test", id: "two" } },
    ] };
    const first = await f.sup.spawn("governor", { taskName: "first", message: "wait", profile: "reader", gate }, "first");
    assert.equal(f.sup.list("governor").length, 3);
    await f.sup.close("governor", first.agentId, "close");
    await f.restart();
    await f.sup.spawn("governor", { taskName: "replacement", message: "wait", profile: "reader", gate }, "replacement");
    assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 6);
    assert.equal(f.sup.admissionScheduler.snapshot().open, 3);
  });

  test(`[${storage}] closing a gated main cannot be undone by retrying with a new panel`, async (t) => {
    const f = fixture(t, storage, { maxOpenAgents: 8 }, (index) => index === 0 ? "settle-text" : "gate");
    const gate = { model: { provider: "test", id: "one" }, prompt: "review", thinkingLevel: "off" };
    const first = await f.sup.spawn("governor", { taskName: "first", message: "work", profile: "reader", gate }, "first");
    await until(() => f.sup.list("governor").some((a) => a.id === first.agentId && a.taskOutcome === "passed"));
    await f.sup.close("governor", first.agentId, "close");
    await assert.rejects(() => f.sup.manageGate("governor", {
      kind: "retry_review", taskRunId: first.taskRunId, candidateId: "candidate-1",
      gate: { ...gate, model: { provider: "test", id: "two" } },
    }, "retry-closed"), /CLOSED/);
    assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 2);
  });

  test(`[${storage}] partial panel admission releases only reservations that were never created`, async (t) => {
    const f = fixture(t, storage, { maxOpenAgents: 3 }, () => "settle-text");
    const append = f.store.append.bind(f.store);
    f.store.append = (kind, body) => {
      if (kind === "agent.spawned" && body["managedGate"] === true) throw new Error("STORE_FAILED: reviewer injection");
      return append(kind, body);
    };
    const gate = { prompt: "review", thinkingLevel: "off", reviewers: [
      { model: { provider: "test", id: "one" } }, { model: { provider: "test", id: "two" } },
    ] };
    await assert.rejects(() => f.sup.spawn("governor", { taskName: "partial", message: "work", profile: "reader", gate }, "partial"), /reviewer injection/);
    f.store.append = append;
    assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 1);
    assert.equal(f.sup.list("governor").length, 1);
    for (const name of ["new-one", "new-two"]) await f.sup.spawn("governor", { taskName: name, message: "new", profile: "reader" }, name);
    await exhausted(() => f.sup.spawn("governor", { taskName: "overflow", message: "no", profile: "reader" }, "overflow"));
    assert.equal(f.sup.admissionScheduler.snapshot().open, 3);
  });

  for (const replay of [false, true]) {
    test(`[${storage}, replay=${replay}] close includes reviewers from a partially created panel`, async (t) => {
      const f = fixture(t, storage, { maxOpenAgents: 3 }, () => "hang");
      const append = f.store.append.bind(f.store);
      let reviewers = 0;
      f.store.append = (kind, body) => {
        if (kind === "agent.spawned" && body["managedGate"] === true && ++reviewers === 2) throw new Error("STORE_FAILED: second reviewer");
        return append(kind, body);
      };
      const gate = { prompt: "review", thinkingLevel: "off", reviewers: [
        { model: { provider: "test", id: "one" } }, { model: { provider: "test", id: "two" } },
      ] };
      await assert.rejects(() => f.sup.spawn("governor", { taskName: "partial", message: "wait", profile: "reader", gate }, "partial"), /second reviewer/);
      f.store.append = append;
      const main = f.sup.list("governor").find((a) => a.path === "/root/partial")!;
      assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 2);
      if (replay) await f.restart();
      await f.sup.close("governor", main.id, "close-partial");
      assert.equal(f.sup.admissionScheduler.snapshot().open, 0);
      assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 2);
    });
  }

  test(`[${storage}] replay can finish a subtree close whose parent was already durably closed`, async (t) => {
    const f = fixture(t, storage, { maxOpenAgents: 2 }, () => "hang");
    const parent = await f.sup.spawn("governor", { taskName: "parent", message: "wait", profile: "reader" }, "parent");
    const child = await f.sup.spawn(parent.agentId, { taskName: "child", message: "wait", profile: "reader" }, "child");
    const append = f.store.append.bind(f.store);
    f.store.append = (kind, body) => {
      if (kind === "agent.closed" && body["agentId"] === child.agentId) throw new Error("STORE_FAILED: child close");
      return append(kind, body);
    };
    await assert.rejects(() => f.sup.close("governor", parent.agentId, "partial-close"), /child close/);
    f.store.append = append;
    await f.restart();
    assert.equal(f.sup.admissionScheduler.snapshot().open, 1);
    await f.sup.close("governor", parent.agentId, "finish-close");
    assert.equal(f.sup.admissionScheduler.snapshot().open, 0);
    for (const name of ["new-one", "new-two"]) await f.sup.spawn("governor", { taskName: name, message: "wait", profile: "reader" }, name);
  });

  test(`[${storage}] a failed close append does not release admission before its durable close fact`, async (t) => {
    const f = fixture(t, storage, { maxOpenAgents: 1 }, () => "settle-text");
    const first = await f.sup.spawn("governor", { taskName: "first", message: "work", profile: "reader" }, "first");
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    const append = f.store.append.bind(f.store);
    f.store.append = (kind, body) => {
      if (kind === "agent.closed") throw new Error("STORE_FAILED: close injection");
      return append(kind, body);
    };
    await assert.rejects(() => f.sup.close("governor", first.agentId, "failed-close"), /close injection/);
    await exhausted(() => f.sup.spawn("governor", { taskName: "too-early", message: "no", profile: "reader" }, "too-early"));
    f.store.append = append;
    await f.sup.close("governor", first.agentId, "retry-close");
    await f.sup.spawn("governor", { taskName: "replacement", message: "new", profile: "reader" }, "replacement");
    assert.equal(f.sup.admissionScheduler.snapshot().open, 1);
  });
}
