import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Supervisor } from "../src/supervisor.ts";
import { InMemoryRunStore, checkpointSha256 } from "../src/store.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { FakeWorker, until, testGovernor, bothExecutors } from "./fake-worker.ts";

const replacement = { provider: "codex", id: "replacement", thinkingLevel: "off" };

function setup(script: "settle-text" | "hang" = "settle-text", limits = {}) {
  const dir = mkdtempSync(join(tmpdir(), "subagents-model-reuse-"));
  const store = new InMemoryRunStore("reuse");
  const policy = defaultSupervisorPolicy();
  policy.allowedModels = [replacement];
  let unknownUsage = false;
  const workers: FakeWorker[] = [];
  const initialized: Array<Record<string, unknown>> = [];
  const options = {
    rootId: "reuse", rootDir: dir, store, policy, governor: testGovernor,
    schedulerLimits: { maxAgentsCreated: 1, ...limits },
    executors: bothExecutors(new DummyToolExecutor()), workspace: new DummyWorkspaceManager(),
    workerFactory: () => {
      const worker = new FakeWorker(script);
      const setEventHandler = worker.setEventHandler.bind(worker);
      worker.setEventHandler = (handler) => setEventHandler((event) => handler(event.kind === "settled"
        ? { ...event, detail: { ...event.detail, usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: null, cost: 0, unknown: unknownUsage } } }
        : event));
      const request = worker.request.bind(worker);
      worker.request = async (operation, payload, opts) => {
        if (operation === "initialize") initialized.push(payload as Record<string, unknown>);
        return request(operation, payload, opts);
      };
      workers.push(worker);
      return worker;
    },
  };
  const sup = new Supervisor(options);
  const spawn = () => sup.spawn("governor", { taskName: "worker", message: "first", profile: "reader" }, "spawn");
  const checkpoint = (agentId: string, taskRunId: string) => {
    const bytes = Buffer.from("retained-native-history\n");
    store.saveCheckpoint({ agentId, taskRunId, generation: 1, leafEntryId: "leaf", sha256: checkpointSha256(bytes), bytes: bytes.length, createdAt: new Date().toISOString(), superseded: false }, bytes);
  };
  return { sup, store, workers, initialized, options, spawn, checkpoint, markUsageUnknown: () => { unknownUsage = true; },
    cleanup: async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); } };
}

// Regression #29: Behavioral-Active, Blackbox-Group (fake workers, real controller/store).
test("lifetime exhaustion explains safe reuse and that closing cannot refund identities", async () => {
  const f = setup();
  try {
    const a = await f.spawn();
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    await assert.rejects(() => f.sup.spawn("governor", { taskName: "another", message: "work", profile: "reader" }, "another"), /lifetime.*send_message.*close.*not.*refund/i);
    await f.sup.close("governor", a.agentId, "close");
    await assert.rejects(() => f.sup.spawn("governor", { taskName: "last", message: "work", profile: "reader" }, "last"), /delegation unavailable/i);
  } finally { await f.cleanup(); }
});

test("explicit settled model reuse at lifetime cap reloads history and survives journal replay", async () => {
  const f = setup();
  try {
    const a = await f.spawn();
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    f.checkpoint(a.agentId, a.taskRunId);
    f.options.governor = () => ({ ...testGovernor(), model: replacement });
    assert.equal(f.sup.list("governor")[0]?.model, "test/model", "root selection changes do not switch retained children");
    const opts = { model: replacement };
    const next = await f.sup.sendMessage("governor", a.agentId, "task", "next", opts, "reuse-model");
    assert.equal(f.sup.list("governor")[0]?.model, "codex/replacement");
    assert.equal(f.workers[0]!.killed, true);
    assert.equal(f.workers.length, 2);
    assert.deepEqual(f.initialized[1]!["model"], replacement);
    assert.equal((f.initialized[1]!["restore"] as { leafEntryId: string }).leafEntryId, "leaf");
    assert.notEqual(next.taskRunId, a.taskRunId);
    assert.equal(f.sup.read("governor", a.agentId, "result", 0, 100, a.taskRunId).result?.outcome, "succeeded");
    assert.deepEqual(await f.sup.sendMessage("governor", a.agentId, "task", "next", opts, "reuse-model"), next);
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    await f.sup.shutdown();
    const restored = new Supervisor(f.options);
    try {
      assert.equal(restored.list("governor")[0]?.model, "codex/replacement");
      await assert.rejects(() => restored.spawn("governor", { taskName: "excess", message: "no", profile: "reader" }, "excess"), /CAPACITY_EXCEEDED/);
    } finally { await restored.shutdown(); }
  } finally { await f.cleanup(); }
});

test("model override rejects busy, queued, closed, invalid and non-task inputs without changing selection", async () => {
  const f = setup("hang");
  try {
    const a = await f.spawn();
    await assert.rejects(() => f.sup.sendMessage("governor", a.agentId, "task", "next", { model: replacement }, "busy"), /CONFLICT/);
    await f.sup.sendMessage("governor", a.agentId, "task", "queued", {}, "queued");
    await assert.rejects(() => f.sup.sendMessage("governor", a.agentId, "task", "next", { model: replacement }, "busy-queued"), /CONFLICT/);
    await assert.rejects(() => f.sup.sendMessage("governor", a.agentId, "note", "next", { model: replacement }, "note"), /INVALID/);
    await f.sup.close("governor", a.agentId, "close");
    await assert.rejects(() => f.sup.sendMessage("governor", a.agentId, "task", "next", { model: replacement }, "closed"), /CLOSED/);
    assert.equal(f.sup.list("governor")[0]?.model, "test/model");
  } finally { await f.cleanup(); }
});

test("settled model switch rejects unapproved models and missing current checkpoint", async () => {
  const f = setup();
  try {
    const a = await f.spawn();
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    await assert.rejects(() => f.sup.sendMessage("governor", a.agentId, "task", "next", { model: { provider: "no", id: "no" } }, "denied"), /POLICY_DENIED/);
    await assert.rejects(() => f.sup.sendMessage("governor", a.agentId, "task", "next", { model: { provider: "", id: "no" } }, "invalid"), /INVALID/);
    await assert.rejects(() => f.sup.sendMessage("governor", a.agentId, "task", "next", { model: replacement }, "no-checkpoint"), /RECOVERY_OWNER_UNCONFIRMED.*checkpoint/i);
    assert.equal(f.workers[0]!.killed, false);
    assert.equal(f.sup.list("governor")[0]?.model, "test/model");
  } finally { await f.cleanup(); }
});


test("resident and runnable saturation are distinct from lifetime exhaustion", async () => {
  const f = setup("hang", { maxAgentsCreated: 3, maxResidentWorkers: 1 });
  try {
    await f.spawn();
    await assert.rejects(() => f.sup.spawn("governor", { taskName: "second", message: "next", profile: "reader" }, "second"), /resident.*not lifetime.*wait.*evicted automatically/i);
    assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 1);
  } finally { await f.cleanup(); }
  const q = setup("hang", { maxAgentsCreated: 2, maxResidentWorkers: 2, maxRunnable: 1 });
  try {
    await q.spawn();
    const parked = await q.sup.spawn("governor", { taskName: "parked", message: "next", profile: "reader" }, "parked");
    assert.equal(parked.status, "queued");
    assert.equal(q.sup.admissionScheduler.runnableCount, 1);
    assert.match(q.sup.list("governor").find((agent) => agent.id === parked.agentId)!.pendingIntent, /runnable/i);
    await assert.rejects(() => q.sup.sendMessage("governor", parked.agentId, "task", "next", { model: replacement }, "switch-parked"), /CONFLICT/);
  } finally { await q.cleanup(); }
});

test("failed acceptance does not change the selected model; retry restores history", async () => {
  const f = setup();
  try {
    const a = await f.spawn();
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    f.checkpoint(a.agentId, a.taskRunId);
    const append = f.store.append.bind(f.store);
    f.store.append = (kind, body) => {
      if (kind === "mailbox.accepted") throw new Error("STORE_FAILED: injection");
      return append(kind, body);
    };
    await assert.rejects(() => f.sup.sendMessage("governor", a.agentId, "task", "next", { model: replacement }, "retry"), /STORE_FAILED/);
    assert.equal(f.sup.list("governor")[0]?.model, "test/model");
    assert.equal(f.workers[0]!.killed, false, "failed durable acceptance must retain the worker");
    f.store.append = append;
    await f.sup.sendMessage("governor", a.agentId, "task", "next", { model: replacement }, "retry");
    assert.equal(f.sup.list("governor")[0]?.model, "codex/replacement");
  } finally { await f.cleanup(); }
});

test("unknown provider usage is not retired by model-switch recovery", async () => {
  const f = setup();
  f.markUsageUnknown();
  try {
    const a = await f.spawn();
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    f.checkpoint(a.agentId, a.taskRunId);
    await assert.rejects(() => f.sup.sendMessage("governor", a.agentId, "task", "next", { model: replacement }, "unknown"), /CONFLICT.*unknown usage/);
    assert.equal(f.workers[0]!.killed, false);
  } finally { await f.cleanup(); }
});


test("lifetime advice distinguishes same-model reuse from checkpoint-ready switches and required panels", async () => {
  const f = setup();
  try {
    const a = await f.spawn();
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    await assert.rejects(() => f.sup.spawn("governor", { taskName: "another", message: "work", profile: "reader" }, "advice"), /same retained model.*no checkpoint-ready model switch/i);
    f.checkpoint(a.agentId, a.taskRunId);
    await assert.rejects(() => f.sup.spawn("governor", { taskName: "reviewed", message: "work", profile: "reader", review: { model: replacement, thinkingLevel: "off", prompt: "Review" } }, "panel"), /requires fresh managed reviewer identities.*delegation unavailable/i);
  } finally { await f.cleanup(); }
});

test("message routing to a parent or sibling does not authorize changing its model", async () => {
  const f = setup("settle-text", { maxAgentsCreated: 3, maxDepth: 2 });
  f.options.policy.nesting = true;
  f.options.policy.maxDepth = 2;
  try {
    const parent = await f.spawn();
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    f.checkpoint(parent.agentId, parent.taskRunId);
    const child = await f.sup.spawn(parent.agentId, { taskName: "child", message: "child", profile: "reader" }, "child");
    await until(() => f.sup.list("governor").find((agent) => agent.id === child.agentId)?.taskOutcome === "succeeded");
    await assert.rejects(() => f.sup.sendMessage(child.agentId, "parent", "task", "new", { model: replacement }, "switch-parent"), /FORBIDDEN/);
    const sibling = await f.sup.spawn("governor", { taskName: "sibling", message: "sibling", profile: "reader" }, "sibling");
    await until(() => f.sup.list("governor").find((agent) => agent.id === sibling.agentId)?.taskOutcome === "succeeded");
    await assert.rejects(() => f.sup.sendMessage(sibling.agentId, parent.agentId, "task", "new", { model: replacement }, "switch-sibling"), /FORBIDDEN/);
  } finally { await f.cleanup(); }
});

test("replay preserves atomically accepted model/task intent if the later queue projection append fails", async () => {
  const f = setup();
  let restored: Supervisor | null = null;
  try {
    const a = await f.spawn();
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    f.checkpoint(a.agentId, a.taskRunId);
    const append = f.store.append.bind(f.store);
    f.store.append = (kind, body) => {
      if (kind === "task.queued") throw new Error("STORE_FAILED: queue injection");
      return append(kind, body);
    };
    await assert.rejects(() => f.sup.sendMessage("governor", a.agentId, "task", "next", { model: replacement }, "atomic"), /STORE_FAILED/);
    f.store.append = append;
    const accepted = f.store.loadCommand("atomic")!;
    await f.sup.shutdown();
    restored = new Supervisor(f.options);
    assert.equal(restored.list("governor")[0]?.model, "codex/replacement");
    await restored.dispatchPending("governor", a.agentId, accepted.body["taskRunId"] as string);
    await until(() => restored!.list("governor")[0]?.generation === 2 && restored!.list("governor")[0]?.taskOutcome === "succeeded");
    assert.equal(restored.admissionScheduler.agentsCreatedCount, 1);
  } finally { if (restored) await restored.shutdown(); await f.cleanup(); }
});

test("recordCommand failure after acceptance preserves live model/task projection on same-id retry", async () => {
  const f = setup();
  try {
    const a = await f.spawn();
    await until(() => f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    f.checkpoint(a.agentId, a.taskRunId);
    const recordCommand = f.store.recordCommand.bind(f.store);
    f.store.recordCommand = (id, record) => {
      recordCommand(id, record);
      if (id === "command-fault") throw new Error("STORE_FAILED: command index injection");
    };
    await assert.rejects(() => f.sup.sendMessage("governor", a.agentId, "task", "next", { model: replacement }, "command-fault"), /STORE_FAILED/);
    f.store.recordCommand = recordCommand;
    const retry = await f.sup.sendMessage("governor", a.agentId, "task", "next", { model: replacement }, "command-fault");
    assert.equal(f.sup.list("governor")[0]?.model, "codex/replacement");
    assert.equal(f.workers[0]!.killed, true);
    await f.sup.dispatchPending("governor", a.agentId, retry.taskRunId!);
    await until(() => f.sup.list("governor")[0]?.generation === 2 && f.sup.list("governor")[0]?.taskOutcome === "succeeded");
    assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 1);
  } finally { await f.cleanup(); }
});
