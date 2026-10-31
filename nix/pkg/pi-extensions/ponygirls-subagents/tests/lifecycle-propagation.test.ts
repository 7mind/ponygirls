import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRunStore, InMemoryRunStore, type JournalKind, type JournalRecord } from "../src/store.ts";
import { approve, blocked, gateSpec, mkSup, revise, terminals, tick } from "./ctl-worker.ts";

class OneShotFailingStore extends InMemoryRunStore {
  failKind: JournalKind | null = null;

  override append(kind: JournalKind, body: Record<string, unknown>): JournalRecord {
    if (kind === this.failKind) {
      this.failKind = null;
      throw new Error(`one-shot ${kind} append failure`);
    }
    return super.append(kind, body);
  }
}

class PrefixStore extends InMemoryRunStore {
  captureKind: JournalKind | null = null;
  prefix: JournalRecord[] = [];

  override append(kind: JournalKind, body: Record<string, unknown>): JournalRecord {
    const record = super.append(kind, body);
    if (kind === this.captureKind) {
      this.captureKind = null;
      this.prefix = structuredClone(this.readSince(0, Number.MAX_SAFE_INTEGER).records);
    }
    return record;
  }
}

const nesting = {
  policy: (policy: { maxDepth: number; nesting: boolean }) => { policy.maxDepth = 2; policy.nesting = true; },
};

for (const kind of ["generation.settled", "task.terminal"] as const) {
  test(`a failed ${kind} append leaves a recoverable run, not a fabricated terminal`, async (t) => {
    const store = new OneShotFailingStore("root-1");
    const { sup, byAgent, dir } = mkSup({ store });
    t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
    const child = await sup.spawn("governor", { taskName: "child", message: "work", profile: "reader" }, "spawn-child");
    store.failKind = kind;
    byAgent(child.agentId)[0]!.settle();
    await tick();
    assert.deepEqual(terminals(sup, child.taskRunId), []);
    const targets = [{ agentId: child.agentId, taskRunId: child.taskRunId }];
    assert.equal((await sup.wait("governor", 0, 50, targets, "all_settled")).reason, "timeout", "failed persistence cannot satisfy a durable join");
    await sup.recover();
    const result = await sup.wait("governor", 0, 80, targets, "all_settled");
    assert.equal(result.reason, "settled");
    assert.equal(terminals(sup, child.taskRunId).length, 1);
    assert.equal(sup.noticesSince(0, 100).lines.filter((line) => line.includes(child.taskRunId)).length, 1);
  });
}

test("recovery can retry a failed generation commit from a previously live run", async (t) => {
  const store = new OneShotFailingStore("root-1");
  const { sup, dir } = mkSup({ store });
  t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  const child = await sup.spawn("governor", { taskName: "child", message: "work", profile: "reader" }, "spawn-child");
  store.failKind = "generation.settled";
  await assert.rejects(() => sup.recover(), /one-shot generation.settled/);
  await sup.recover();
  const joined = await sup.wait("governor", 0, 80, [{ agentId: child.agentId, taskRunId: child.taskRunId }], "all_settled");
  assert.equal(joined.reason, "settled");
  assert.deepEqual(terminals(sup, child.taskRunId), ["interrupted"]);
});

test("a forced close retains its terminal obligation if generation persistence fails", { timeout: 35_000 }, async (t) => {
  const store = new OneShotFailingStore("root-1");
  const { sup, byAgent, dir } = mkSup({ store });
  t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  const child = await sup.spawn("governor", { taskName: "child", message: "work", profile: "reader" }, "spawn-child");
  byAgent(child.agentId)[0]!.settleOnInterrupt = false;
  store.failKind = "generation.settled";
  await assert.rejects(() => sup.close("governor", child.agentId, "close-child"), /one-shot generation.settled/);
  await sup.recover();
  const joined = await sup.wait("governor", 0, 80, [{ agentId: child.agentId, taskRunId: child.taskRunId }], "all_settled");
  assert.equal(joined.reason, "settled");
  assert.deepEqual(terminals(sup, child.taskRunId), ["interrupted"]);
});

test("a failed terminal commit keeps follow-up work queued through reattachment", async (t) => {
  const store = new OneShotFailingStore("root-1");
  const before = mkSup({ store });
  t.after(async () => { await before.sup.shutdown(); rmSync(before.dir, { recursive: true, force: true }); });
  const child = await before.sup.spawn("governor", { taskName: "child", message: "work", profile: "reader" }, "spawn-child");
  store.failKind = "task.terminal";
  before.byAgent(child.agentId)[0]!.settle();
  await tick();
  const queued = await before.sup.sendMessage("governor", child.agentId, "task", "follow-up", {}, "queue-follow-up");
  await tick();
  assert.equal(before.sup.list("governor")[0]!.currentTaskRunId, child.taskRunId);
  assert.equal(before.byAgent(child.agentId)[0]!.delivered.some((message) => message.text === "follow-up"), false);
  await before.sup.shutdown();
  const after = mkSup({ dir: before.dir, store });
  try {
    assert.equal(after.sup.needsRecovery, true);
    await after.sup.recover();
    assert.deepEqual(terminals(after.sup, child.taskRunId), ["succeeded"]);
    assert.deepEqual(terminals(after.sup, queued.taskRunId!), []);
    assert.equal(after.workers.length, 0);
  } finally {
    await after.sup.shutdown();
  }
});

for (const target of ["unknown", "wrong-agent", "empty"] as const) {
  test(`${target === "wrong-agent" ? "a" : "an"} ${target} explicit task-run target is rejected instead of hanging`, async (t) => {
    const { sup, dir } = mkSup({});
    t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
    const first = await sup.spawn("governor", { taskName: "first", message: "work", profile: "reader" }, "spawn-first");
    const second = await sup.spawn("governor", { taskName: "second", message: "work", profile: "reader" }, "spawn-second");
    await assert.rejects(() => sup.wait("governor", 0, 80, [{ agentId: first.agentId, taskRunId: target === "unknown" ? "mistyped-task-run-id" : target === "empty" ? "" : second.taskRunId }], "all_settled"), /NOT_FOUND.*task run/);
  });
}

test("a change observer failure cannot strand a durably settled generation", async (t) => {
  const store = new InMemoryRunStore("root-1");
  let rejectChange = true;
  const { sup, byAgent, dir } = mkSup({ store, onChange: () => {
    const last = store.readSince(store.durableSeq() - 1, 1).records[0]!;
    if (last.kind === "generation.settled" && rejectChange) {
      rejectChange = false;
      throw new Error("one-shot lifecycle observer failure");
    }
  } });
  t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  const child = await sup.spawn("governor", { taskName: "child", message: "work", profile: "reader" }, "spawn-child");
  byAgent(child.agentId)[0]!.settle();
  await tick();
  assert.deepEqual(terminals(sup, child.taskRunId), ["succeeded"]);
  assert.ok(sup.noticesSince(0, 100).lines.some((line) => line.includes("one-shot lifecycle observer failure")), "the observer failure must remain visible");
});

// Behavioral-Blackbox-Group; regression: question arrival must not race wait registration.
for (const condition of ["any_settled", "all_settled"] as const) {
  for (const useCurrentCursor of [false, true]) {
    test(`${condition} reports an already-open governor question with ${useCurrentCursor ? "current" : "old"} cursor`, async (t) => {
      const { sup, byAgent, dir } = mkSup({});
      t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
      const child = await sup.spawn("governor", { taskName: "child", message: "work", profile: "reader" }, "spawn-child");
      await byAgent(child.agentId)[0]!.question("which branch?");
      const cursor = useCurrentCursor ? sup.runStore.durableSeq() : 0;
      const result = await sup.wait("governor", cursor, 80, [{ agentId: child.agentId, taskRunId: child.taskRunId }], condition);
      assert.equal(result.reason, "needs_response");
      assert.equal(result.completed, false);
      assert.deepEqual(result.joinTaskRunIds, [child.taskRunId]);
      assert.equal(sup.pendingQuestions("governor")[0]?.text, "which branch?");
    });
  }
}

for (const requestReply of [false, true]) {
  test(`an exact-run activity wait receives its child's ${requestReply ? "question" : "note"}`, async (t) => {
    const { sup, byAgent, dir } = mkSup({});
    t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
    const child = await sup.spawn("governor", { taskName: "child", message: "work", profile: "reader" }, "spawn-child");
    await tick();
    const pending = sup.wait("governor", sup.runStore.durableSeq(), 80, [{ agentId: child.agentId, taskRunId: child.taskRunId }], "activity");
    await byAgent(child.agentId)[0]!.call("send_message", { target: "parent", mode: "note", message: "child message", request_reply: requestReply });
    const result = await pending;
    assert.equal(result.reason, "events");
    assert.equal(result.messages[0]?.text, "child message");
  });
}

// Behavioral-Blackbox-Group: preemption belongs only to the addressed recipient and open questions.
test("an already-open nested question preempts only its owner's settlement wait", async (t) => {
  const { sup, byAgent, dir } = mkSup(nesting);
  t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  const parent = await sup.spawn("governor", { taskName: "parent", message: "work", profile: "reader" }, "spawn-parent");
  const child = await sup.spawn(parent.agentId, { taskName: "child", message: "work", profile: "reader" }, "spawn-child");
  await byAgent(child.agentId)[0]!.question("nested question");
  const cursor = sup.runStore.durableSeq();
  const targets = [{ agentId: child.agentId, taskRunId: child.taskRunId }];
  assert.equal((await sup.wait(parent.agentId, cursor, 80, targets, "all_settled")).reason, "needs_response");
  assert.equal((await sup.wait("governor", cursor, 80, targets, "all_settled")).reason, "timeout");
  const question = sup.pendingQuestions(parent.agentId)[0]!;
  await sup.sendMessage(parent.agentId, child.agentId, "note", "answer", { replyTo: question.messageId }, "answer");
  const answeredCursor = sup.runStore.durableSeq();
  assert.equal((await sup.wait(parent.agentId, answeredCursor, 80, targets, "all_settled")).reason, "timeout");
  byAgent(child.agentId)[0]!.settle();
  assert.equal((await sup.wait(parent.agentId, answeredCursor, 1000, targets, "all_settled")).reason, "settled");
});

// Behavioral-Blackbox-Group; regression: capacity release must not dispatch before the old join is installed.
test("a task queued before owner settlement stays queued while descendants are joining", async (t) => {
  const { sup, byAgent, dir } = mkSup(nesting);
  t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  const parent = await sup.spawn("governor", { taskName: "parent", message: "work", profile: "reader" }, "spawn-parent");
  const child = await sup.spawn(parent.agentId, { taskName: "child", message: "work", profile: "reader" }, "spawn-child");
  const childWorker = byAgent(child.agentId)[0]!;
  childWorker.settleOnInterrupt = false;
  const parentWorker = byAgent(parent.agentId)[0]!;
  const next = await sup.sendMessage("governor", parent.agentId, "task", "next task", {}, "queue-next");
  parentWorker.settle("succeeded", "first result");
  await tick();
  assert.deepEqual(terminals(sup, parent.taskRunId), []);
  assert.equal(sup.list("governor").find((view) => view.id === parent.agentId)?.currentTaskRunId, parent.taskRunId);
  assert.equal(parentWorker.delivered.some((message) => message.text === "next task"), false);
  childWorker.settle("interrupted");
  await tick();
  assert.deepEqual(terminals(sup, parent.taskRunId), ["succeeded"]);
  assert.equal(sup.list("governor").find((view) => view.id === parent.agentId)?.currentTaskRunId, next.taskRunId);
  parentWorker.settle("succeeded", "second result");
  await tick();
  assert.deepEqual(terminals(sup, next.taskRunId!), ["succeeded"]);
  const notices = sup.noticesSince(0, 100).lines;
  assert.equal(notices.filter((line) => line.includes(parent.taskRunId)).length, 1);
  assert.equal(notices.filter((line) => line.includes(next.taskRunId!)).length, 1);
});

// Behavioral-Blackbox-Group: reviewer interruption deliberately does not settle its main task.
test("an interrupted reviewer exposes activity and remains explicitly resumable", async (t) => {
  const { sup, byAgent, dir } = mkSup({});
  t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  const main = await sup.spawn("governor", { taskName: "main", message: "work", profile: "reader", gate: gateSpec(3) }, "spawn-main");
  byAgent(main.agentId)[0]!.settle();
  await tick();
  const reviewerId = sup.gateController.inspect(main.taskRunId)!.reviewerId!;
  const cursor = sup.runStore.durableSeq();
  const activity = sup.wait("governor", cursor, 1000, null, "activity");
  await sup.interrupt("governor", reviewerId, "interrupt-reviewer");
  assert.equal((await activity).reason, "events");
  assert.deepEqual(terminals(sup, main.taskRunId), []);
  const state = sup.gateController.inspect(main.taskRunId)!;
  assert.equal(state.review?.status, "interrupted");
  assert.deepEqual(sup.noticesSince(cursor, 100).lines, [], "review interruption is not currently a context notice");
  await sup.manageGate("governor", { kind: "resume_review", taskRunId: main.taskRunId, reviewId: state.review!.reviewId }, "resume-reviewer");
  await tick();
  await byAgent(reviewerId).at(-1)!.decide(approve("candidate-1"));
  await tick();
  assert.deepEqual(terminals(sup, main.taskRunId), ["passed"]);
  assert.equal(sup.noticesSince(cursor, 100).lines.length, 1);
});

// Behavioral-Effectual-GoodCommunication; regression: crash between generation settlement and candidate capture.
test("recovery terminalizes a gated owner lost while joining descendants before candidate capture", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-deferred-candidate-"));
  const before = mkSup({ ...nesting, dir, store: new FileRunStore(dir, "root-1") });
  t.after(async () => { await before.sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  const main = await before.sup.spawn("governor", { taskName: "main", message: "work", profile: "reader", gate: gateSpec(3) }, "spawn-main");
  const child = await before.sup.spawn(main.agentId, { taskName: "child", message: "work", profile: "reader" }, "spawn-child");
  before.byAgent(child.agentId)[0]!.settleOnInterrupt = false;
  before.byAgent(main.agentId)[0]!.settle();
  await tick();
  assert.equal(before.sup.gateController.inspect(main.taskRunId)!.candidate, null);
  assert.deepEqual(terminals(before.sup, main.taskRunId), []);
  await before.sup.shutdown();
  const after = mkSup({ ...nesting, dir, store: new FileRunStore(dir, "root-1") });
  try {
    await after.sup.recover();
    const result = await after.sup.wait("governor", 0, 80, [{ agentId: main.agentId, taskRunId: main.taskRunId }], "all_settled");
    assert.equal(result.reason, "settled");
    assert.deepEqual(terminals(after.sup, main.taskRunId), ["interrupted"]);
    assert.equal(after.sup.gateController.inspect(main.taskRunId)!.terminal, "interrupted");
    assert.equal(after.sup.noticesSince(0, 100).lines.filter((line) => line.includes(main.taskRunId)).length, 1);
    assert.equal(after.workers.length, 0, "recovery must not infer a candidate or launch a reviewer");
  } finally {
    await after.sup.shutdown();
  }
});

// Behavioral-Blackbox-Group: replay actual committed prefixes at gate crash boundaries.
for (const cut of ["first-candidate", "repair-candidate", "linked-registration", "linked-round"] as const) {
  test(`recovery does not strand a run at ${cut} publication`, async (t) => {
    const store = new PrefixStore("root-1");
    const before = mkSup({ store });
    t.after(async () => { await before.sup.shutdown(); rmSync(before.dir, { recursive: true, force: true }); });
    const main = await before.sup.spawn("governor", { taskName: "main", message: "work", profile: "reader", gate: gateSpec(3) }, "spawn-main");
    let taskRunId = main.taskRunId;
    if (cut === "first-candidate") store.captureKind = "gate.candidate";
    before.byAgent(main.agentId)[0]!.settle();
    await tick();
    if (cut !== "first-candidate") {
      const reviewerId = before.sup.gateController.inspect(main.taskRunId)!.reviewerId!;
      await before.byAgent(reviewerId)[0]!.decide(cut === "repair-candidate" ? revise("candidate-1") : blocked("candidate-1"));
      await tick();
      if (cut === "repair-candidate") {
        store.captureKind = "gate.candidate";
        before.byAgent(main.agentId)[0]!.settle("succeeded", "repair result");
      } else {
        store.captureKind = cut === "linked-registration" ? "gate.registered" : "gate.round_admitted";
        taskRunId = (await before.sup.manageGate("governor", { kind: "retry_review", taskRunId: main.taskRunId, candidateId: "candidate-1", gate: null }, "retry-main")).taskRunId;
      }
      await tick();
    }
    assert.ok(store.prefix.length > 0);
    await before.sup.shutdown();
    const restored = new InMemoryRunStore("root-1");
    for (const record of store.prefix) restored.append(record.kind, record.body);
    const after = mkSup({ dir: before.dir, store: restored });
    try {
      await after.sup.recover();
      const joined = await after.sup.wait("governor", 0, 80, [{ agentId: main.agentId, taskRunId }], "all_settled");
      assert.equal(joined.reason, "settled");
      assert.deepEqual(terminals(after.sup, taskRunId), ["interrupted"]);
      assert.equal(after.sup.gateController.inspect(taskRunId)!.terminal, "interrupted");
      assert.equal(after.workers.length, 0);
    } finally {
      await after.sup.shutdown();
    }
  });
}

// Behavioral-Effectual-GoodCommunication: a terminal outcome must not erase a durable quarantine on reattach.
test("a recovered writer's quarantine survives another attachment", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-quarantine-reattach-"));
  const before = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
  t.after(async () => { await before.sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  const writer = await before.sup.spawn("governor", { taskName: "writer", message: "work", profile: "writer", isolation: "none" }, "spawn-writer");
  before.executors.host.handler = () => new Promise(() => {});
  void before.byAgent(writer.agentId)[0]!.call("bash", { command: "effect" });
  await tick();
  const recovery = await before.sup.recover();
  assert.ok(recovery.quarantined.includes(writer.agentId));
  assert.equal(before.sup.list("governor").find((view) => view.id === writer.agentId)?.pendingIntent, "quarantined");
  await before.sup.shutdown();
  const after = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
  try {
    assert.equal(after.sup.list("governor").find((view) => view.id === writer.agentId)?.pendingIntent, "quarantined");
    await assert.rejects(() => after.sup.sendMessage("governor", writer.agentId, "task", "must not dispatch", {}, "task-after-reattach"), /RECOVERY_OWNER_UNCONFIRMED/);
    assert.equal(after.workers.length, 0);
  } finally {
    await after.sup.shutdown();
  }
});

for (const occupied of [false, true]) {
  test(`resuming a permanently closed reviewer fails explicitly with ${occupied ? "occupied" : "available"} capacity`, async (t) => {
    const { sup, byAgent, dir } = mkSup({ limits: { maxRunnable: 1 } });
    t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
    const main = await sup.spawn("governor", { taskName: "main", message: "work", profile: "reader", gate: gateSpec(3) }, "spawn-main");
    byAgent(main.agentId)[0]!.settle();
    await tick();
    const reviewerId = sup.gateController.inspect(main.taskRunId)!.reviewerId!;
    const firstReviewer = byAgent(reviewerId)[0]!;
    if (occupied) await sup.spawn("governor", { taskName: "blocker", message: "work", profile: "reader" }, "spawn-blocker");
    await sup.close("governor", reviewerId, "close-reviewer");
    const review = sup.gateController.inspect(main.taskRunId)!.review!;
    assert.equal(review.status, "interrupted");
    await sup.manageGate("governor", { kind: "resume_review", taskRunId: main.taskRunId, reviewId: review.reviewId }, "resume-closed-reviewer");
    await tick();
    assert.deepEqual(terminals(sup, main.taskRunId), ["gate_error"]);
    assert.deepEqual(byAgent(reviewerId), [firstReviewer], "closed reviewer must not be relaunched");
    assert.match(sup.readReviews("governor", main.agentId, main.taskRunId, { offset: 0, length: 2000 }, 0).result!.text, /CLOSED/);
  });
}

for (const action of ["retry_review", "bypass"] as const) {
  test(`${action} on an older terminal run cannot orphan an interrupted linked review`, async (t) => {
    const { sup, byAgent, dir } = mkSup({ policy: (policy) => { policy.gateBypassAllowed = true; } });
    t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
    const main = await sup.spawn("governor", { taskName: "main", message: "work", profile: "reader", gate: gateSpec(3) }, "spawn-main");
    byAgent(main.agentId)[0]!.settle();
    await tick();
    const reviewerId = sup.gateController.inspect(main.taskRunId)!.reviewerId!;
    await byAgent(reviewerId)[0]!.decide(blocked("candidate-1"));
    await tick();
    const retry = await sup.manageGate("governor", { kind: "retry_review", taskRunId: main.taskRunId, candidateId: "candidate-1", gate: null }, "retry-first");
    await tick();
    await sup.interrupt("governor", reviewerId, "interrupt-reviewer");
    const state = sup.gateController.inspect(retry.taskRunId)!;
    assert.equal(state.review?.status, "interrupted");
    const historical = await sup.wait("governor", 0, 80, [{ agentId: reviewerId, taskRunId: main.taskRunId }], "all_settled");
    assert.equal(historical.reason, "settled", "a reused reviewer still belongs to its earlier gate run");
    await assert.rejects(() => sup.manageGate("governor", action === "retry_review"
      ? { kind: "retry_review", taskRunId: main.taskRunId, candidateId: "candidate-1", gate: null }
      : { kind: "bypass", taskRunId: main.taskRunId, candidateId: "candidate-1", reason: "explicit acceptance" }, "replace-older"), /CONFLICT/);
    assert.equal(sup.list("governor").find((view) => view.id === main.agentId)?.currentTaskRunId, retry.taskRunId);
    await sup.manageGate("governor", { kind: "resume_review", taskRunId: retry.taskRunId, reviewId: state.review!.reviewId }, "resume-reviewer");
    await tick();
    await byAgent(reviewerId).at(-1)!.decide(approve("candidate-1"));
    await tick();
    assert.deepEqual(terminals(sup, retry.taskRunId), ["passed"]);
  });
}
