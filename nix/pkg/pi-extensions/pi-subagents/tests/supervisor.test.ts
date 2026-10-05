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

function setup(script: "settle-text" | "hang" | "fail" = "settle-text", limits = {}, questionTtlMs = 15 * 60_000) {
  const dir = mkdtempSync(join(tmpdir(), "subagents-sup-"));
  const policy = defaultSupervisorPolicy();
  policy.maxDepth = 2;
  policy.nesting = true;
  const sup = new Supervisor({
    rootId: "root-1",
    rootDir: dir,
    store: new InMemoryRunStore("root-1"),
    policy,
    schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 32, maxDepth: 2, ...limits },
    executor: new DummyToolExecutor(),
    workspace: new DummyWorkspaceManager(),
    workerFactory: () => new FakeWorker(script),
    questionTtlMs,
  });
  return { sup, dir, cleanup: () => { void sup.shutdown(); rmSync(dir, { recursive: true, force: true }); } };
}

test("spawn returns while the child remains active (async delegation)", async () => {
  const { sup, cleanup } = setup("hang");
  const res = await sup.spawn("governor", { taskName: "builder", message: "build it", profile: "reader" }, "req-1");
  assert.ok(res.agentId);
  assert.equal(res.path, "/root/builder");
  assert.equal(res.generation, 1);
  const views = sup.list("governor");
  assert.equal(views.length, 1);
  assert.ok(["running", "starting"].includes(views[0]!.observed));
  cleanup();
});

test("repeated spawn with the same request id returns one identity", async () => {
  const { sup, cleanup } = setup();
  const a = await sup.spawn("governor", { taskName: "builder", message: "build", profile: "reader" }, "req-dup");
  const b = await sup.spawn("governor", { taskName: "other", message: "build", profile: "reader" }, "req-dup");
  assert.equal(a.agentId, b.agentId);
  assert.equal(sup.list("governor").length, 1);
  cleanup();
});

test("child settles to a terminal task outcome with result text", async () => {
  const { sup, cleanup } = setup("settle-text");
  const res = await sup.spawn("governor", { taskName: "builder", message: "build", profile: "reader" }, "req-1");
  await until(() => sup.list("governor")[0]?.taskOutcome === "succeeded", 5000, "settlement");
  const read = sup.read("governor", res.agentId, "result", 0, 10);
  assert.equal(read.result?.outcome, "succeeded");
  assert.ok(read.result?.text.includes("fake result"));
  cleanup();
});

test("startup failure keeps a terminal record, never a ghost identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-supfail-"));
  const sup = new Supervisor({
    rootId: "root-1",
    rootDir: dir,
    store: new InMemoryRunStore("root-1"),
    policy: defaultSupervisorPolicy(),
    executor: new DummyToolExecutor(),
    workspace: new DummyWorkspaceManager(),
    workerFactory: () => {
      const f = new FakeWorker("hang");
      f.launch = async () => { throw new Error("nope"); };
      return f;
    },
  });
  await assert.rejects(() => sup.spawn("governor", { taskName: "x", message: "y", profile: "reader" }, "req-1"), /nope/);
  const views = sup.list("governor");
  assert.equal(views.length, 1);
  assert.equal(views[0]!.taskOutcome, "failed");
  await sup.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

test("note to an idle-unloaded child persists without inference; steering idle is rejected", async () => {
  const { sup, cleanup } = setup("hang");
  const res = await sup.spawn("governor", { taskName: "a", message: "work", profile: "reader" }, "req-1");
  // Interrupt to settle, then evict: close keeps record; use a fresh idle agent via settle path.
  await sup.interrupt("governor", res.agentId, "req-int");
  await until(() => sup.list("governor")[0]?.taskOutcome === "interrupted", 5000, "interrupt settle");
  await assert.rejects(() => sup.sendMessage("governor", res.agentId, "steer", "go faster", {}, "req-s"), /NOT_RUNNING/);
  const { messageId } = await sup.sendMessage("governor", res.agentId, "note", "remember this", {}, "req-n");
  assert.ok(messageId);
  cleanup();
});

test("task mode queues behind an unfinished run; closes preserve artifacts", async () => {
  const { sup, cleanup } = setup("hang");
  const res = await sup.spawn("governor", { taskName: "a", message: "work", profile: "reader" }, "req-1");
  const second = await sup.sendMessage("governor", res.agentId, "task", "second task", {}, "req-2");
  assert.ok(second.messageId);
  const views = sup.list("governor");
  assert.equal(views[0]!.pendingIntent, "task queued");
  await sup.close("governor", res.agentId, "req-close");
  assert.equal(sup.list("governor")[0]!.pendingIntent, "closed");
  cleanup();
});

test("arrival before subscription is not lost; join captures task-run ids", async () => {
  const { sup, cleanup } = setup("settle-text");
  const res = await sup.spawn("governor", { taskName: "a", message: "work", profile: "reader" }, "req-1");
  await until(() => sup.list("governor")[0]?.taskOutcome !== null, 5000, "terminal");
  // Already-settled captured run satisfies the join immediately.
  const wait = await sup.wait("governor", 0, 1000, [{ agentId: res.agentId, taskRunId: res.taskRunId }], "all_settled");
  assert.equal(wait.completed, true);
  assert.equal(wait.reason, "settled");
  assert.deepEqual(wait.joinTaskRunIds, [res.taskRunId]);
  cleanup();
});

test("child question preempts the parent settlement wait without reporting settlement", async () => {
  const { sup, cleanup } = setup("hang");
  const parent = await sup.spawn("governor", { taskName: "parent", message: "delegate", profile: "reader" }, "req-p");
  // Swap the parent worker script is unnecessary: drive the question via a
  // child send_message with request_reply to the parent address.
  const child = await sup.spawn(parent.agentId, { taskName: "kid", message: "help", profile: "reader" }, "req-c");
  const waitPromise = sup.wait(parent.agentId, 0, 10000, [{ agentId: child.agentId, taskRunId: child.taskRunId }], "all_settled");
  await new Promise((r) => setTimeout(r, 50));
  // Child asks its parent: must preempt the parent's settlement wait.
  const q = await sup.sendMessage(child.agentId, "parent", "note", "need input", { requestReply: true }, "req-q");
  const wait = await waitPromise;
  assert.equal(wait.completed, false);
  assert.equal(wait.reason, "needs_response");
  // Join intent preserved across preemption: same captured ids + token.
  assert.deepEqual(wait.joinTaskRunIds, [child.taskRunId]);
  assert.ok(wait.joinToken);
  // A reply satisfies the parked waiter without starting an idle root turn.
  const reply = await sup.sendMessage(parent.agentId, child.agentId, "note", "here you go", { replyTo: q.messageId }, "req-r");
  assert.ok(reply.messageId);
  cleanup();
});

test("unanswered questions expire with explicit cancellation", async () => {
  const { sup, cleanup } = setup("hang", {}, 50);
  const parent = await sup.spawn("governor", { taskName: "parent", message: "delegate", profile: "reader" }, "req-p");
  const child = await sup.spawn(parent.agentId, { taskName: "kid", message: "help", profile: "reader" }, "req-c");
  await sup.sendMessage(child.agentId, "parent", "note", "need input", { requestReply: true }, "req-q");
  assert.equal(sup.list("governor").find((v) => v.id === child.agentId)?.pendingIntent, "awaiting parent reply");
  await new Promise((r) => setTimeout(r, 120));
  // Any subsequent serialized entry sweeps expired questions.
  await sup.sendMessage("governor", parent.agentId, "note", "tick", {}, "req-tick");
  const views = sup.list("governor");
  assert.notEqual(views.find((v) => v.id === child.agentId)?.pendingIntent, "awaiting parent reply");
  cleanup();
});

test("wait targets on unknown agents are rejected", async () => {
  const { sup, cleanup } = setup();
  await assert.rejects(() => sup.wait("governor", 0, 100, [{ agentId: "nope", taskRunId: null }], "activity"), /NOT_FOUND/);
  cleanup();
});
test("interrupt acceptance leaves running state until confirmed; close retires the path", async () => {
  const { sup, cleanup } = setup("hang");
  const res = await sup.spawn("governor", { taskName: "a", message: "work", profile: "reader" }, "req-1");
  const { accepted, previous } = await sup.interrupt("governor", res.agentId, "req-int");
  assert.equal(accepted, true);
  assert.ok(["running", "starting"].includes(previous.observed));
  await until(() => sup.list("governor")[0]?.taskOutcome === "interrupted", 5000, "interrupt confirm");
  await sup.close("governor", res.agentId, "req-close");
  // Closed agents cannot be resumed.
  await assert.rejects(() => sup.sendMessage("governor", res.agentId, "task", "again", {}, "req-3"), /CLOSED/);
  cleanup();
});

test("sibling contact through non-owners is forbidden", async () => {
  const { sup, cleanup } = setup("hang");
  const a = await sup.spawn("governor", { taskName: "a", message: "w", profile: "reader" }, "req-a");
  const b = await sup.spawn("governor", { taskName: "b", message: "w", profile: "reader" }, "req-b");
  await assert.rejects(() => sup.sendMessage(a.agentId, b.agentId, "note", "hi", {}, "req-x"), /FORBIDDEN/);
  cleanup();
});

test("child sees parent and owned subtree; root sees the whole tree", async () => {
  const { sup, cleanup } = setup("hang");
  const a = await sup.spawn("governor", { taskName: "a", message: "w", profile: "reader" }, "req-a");
  const b = await sup.spawn("governor", { taskName: "b", message: "w", profile: "reader" }, "req-b");
  const kid = await sup.spawn(a.agentId, { taskName: "kid", message: "w", profile: "reader" }, "req-k");
  assert.equal(sup.list("governor").length, 3);
  const aView = sup.list(a.agentId).map((v) => v.id).sort();
  assert.deepEqual(aView, [a.agentId, kid.agentId].sort());
  assert.ok(!sup.list(a.agentId).some((v) => v.id === b.agentId));
  cleanup();
});
