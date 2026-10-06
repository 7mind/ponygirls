import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalController, type SessionView } from "../src/runtime.ts";
import { FileGoalStore, InMemoryGoalStore, type GoalStore, type SidecarEnvelope } from "../src/store.ts";
import { handleCreateGoal, handleUpdateGoal } from "../src/tools.ts";
import type { SessionId } from "../src/goal.ts";

const sessionId = "review" as SessionId;
const clock = { nowIso: () => "2026-10-05T00:00:00.000Z", nowMs: () => 1_000 };
const sender = { sendGoalInstruction() {}, sendNotice() {}, appendCommitMeta() {} };
function load(store: GoalStore): SidecarEnvelope {
  const result = store.load();
  assert.ok(result.ok, JSON.stringify(result));
  return result.value;
}
function view(entries: ReturnType<SessionView["entries"]>): SessionView {
  return { sessionId, sessionFile: "review.jsonl", entries: () => entries, entryCount: () => entries.length,
    isIdle: () => true, hasPendingMessages: () => false };
}
function assistant(id: string, tokens: number) {
  return { id, type: "message", message: { role: "assistant", usage: { input: tokens, output: 0 } } };
}

for (const adapter of ["memory", "file"] as const) {
  function setup(t: test.TestContext) {
    const dir = mkdtempSync(join(tmpdir(), "goals-review-"));
    const store = adapter === "file" ? new FileGoalStore(sessionId, join(dir, "review.jsonl")) : new InMemoryGoalStore(sessionId);
    t.after(() => { store.releaseLock(); rmSync(dir, { recursive: true, force: true }); });
    assert.equal(handleCreateGoal(store, load(store), { objective: "generic objective" }, clock, 0).isError, false);
    return { store, controller: new GoalController(store, clock, sender) };
  }

  test(`${adapter}: accounting excludes entries before the creation baseline`, (t) => {
    const { store, controller } = setup(t);
    const committed = store.commit(load(store).revision, (e) => ({ ...e, baselineEntryCount: 1 }));
    assert.ok(committed.ok);
    const result = controller.settleAccounting(committed.value, view([assistant("old", 100), assistant("new", 7)]));
    assert.equal(result.envelope.goal!.tokensUsed, 7);
  });

  test(`${adapter}: checkpoints retain active time and fractional remainders until final settlement`, (t) => {
    const { store } = setup(t);
    let now = 0;
    const controller = new GoalController(store, { nowIso: clock.nowIso, nowMs: () => now }, sender);
    controller.beginRun(load(store).goal!.id);
    now = 900;
    controller.checkpointAccounting(load(store), view([]));
    assert.notEqual(controller.running, null);
    now = 1800;
    controller.checkpointAccounting(load(store), view([]));
    controller.invalidate("user mutation");
    now = 2500;
    const settled = controller.settleAccounting(load(store), view([]));
    assert.equal(settled.envelope.goal!.timeUsedSeconds, 2);
    assert.equal(settled.envelope.remainderMs, 500);
    assert.equal(controller.running, null);
    now = 6000;
    assert.equal(controller.settleAccounting(load(store), view([])).envelope.goal!.timeUsedSeconds, 2);
  });

  test(`${adapter}: missing assistant usage is unknown, not a known zero`, (t) => {
    const { store, controller } = setup(t);
    const result = controller.settleAccounting(load(store), view([{ id: "unknown", type: "message", message: { role: "assistant" } }]));
    assert.equal(result.unknownUsage, true);
  });

  test(`${adapter}: a checkpoint cannot erase an unconfirmed admission`, (t) => {
    const { store, controller } = setup(t);
    const admitted = controller.admitDispatch(load(store), view([]));
    assert.ok(admitted.ok);
    const settled = controller.settleAccounting(admitted.value, view([]));
    assert.equal(settled.envelope.dispatch!.dispatchId, admitted.value.dispatch!.dispatchId);
  });

  test(`${adapter}: verified completion is allowed after budget exhaustion`, (t) => {
    const { store } = setup(t);
    const limited = store.commit(load(store).revision, (e) => ({ ...e, goal: { ...e.goal!, tokenBudget: 10, tokensUsed: 13, status: "budget_limited" } }));
    assert.ok(limited.ok);
    const result = handleUpdateGoal(store, limited.value, { status: "complete" }, clock);
    assert.equal(result.isError, false, result.content);
    assert.equal(result.state!.status, "complete");
    assert.match(result.content, /13 of 10/);
  });

  test(`${adapter}: commit-evidence failure disables autonomous admission`, (t) => {
    const { store } = setup(t);
    const controller = new GoalController(store, clock, { ...sender, appendCommitMeta() { throw new Error("transcript unavailable"); } });
    assert.throws(() => controller.settleAccounting(load(store), view([assistant("new", 7)])), /transcript|evidence/i);
    assert.equal(controller.state.admissionDisabled, true);
    assert.equal(load(store).goal!.tokensUsed, 7);
  });
}

test("file: a second store in the same process cannot overwrite a lock owner's state", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "goals-review-lock-"));
  const path = join(dir, "review.jsonl");
  const a = new FileGoalStore(sessionId, path);
  const b = new FileGoalStore(sessionId, path);
  t.after(() => { a.releaseLock(); b.releaseLock(); rmSync(dir, { recursive: true, force: true }); });
  assert.ok(a.acquireLock().ok);
  assert.equal(b.acquireLock().ok, false);
  assert.equal(b.commit(0, (e) => e).ok, false);
  b.releaseLock();
  assert.equal(b.acquireLock().ok, false);
});

test("file: disappearance after a successful commit is a storage error", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "goals-review-missing-"));
  const store = new FileGoalStore(sessionId, join(dir, "review.jsonl"));
  t.after(() => { store.releaseLock(); rmSync(dir, { recursive: true, force: true }); });
  assert.ok(store.commit(0, (e) => e).ok);
  unlinkSync(store.sidecarPath);
  const result = store.load();
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "storage_failure");
});
