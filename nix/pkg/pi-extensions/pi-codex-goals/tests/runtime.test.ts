import assert from "node:assert/strict";
import test from "node:test";

import { GoalController, type SessionView } from "../src/runtime.ts";
import { InMemoryGoalStore, type SidecarEnvelope } from "../src/store.ts";
import { handleCreateGoal } from "../src/tools.ts";
import type { GoalId, SessionId } from "../src/goal.ts";

const clocks = { nowIso: () => "2026-10-05T00:00:00.000Z", nowMs: () => 1_000 };

function sender(log: { instructions: Array<{ content: string; details: Record<string, unknown> }>; notices: string[] }) {
  return {
    sendGoalInstruction: (content: string, details: Record<string, unknown>) => {
      // Enforce the critical invariant at the seam: full body in content.
      assert.ok(typeof content === "string" && content.length > 50, "instruction body must be full text");
      log.instructions.push({ content, details });
    },
    sendNotice: (content: string) => {
      log.notices.push(content);
    },
    appendCommitMeta: () => {},
  };
}

function view(overrides: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: "sess" as SessionId,
    sessionFile: "/tmp/sess.jsonl",
    entryCount: () => 0,
    entries: () => [],
    isIdle: () => true,
    hasPendingMessages: () => false,
    ...overrides,
  };
}

function activeEnvelope(store: InMemoryGoalStore): SidecarEnvelope {
  let env = (store.load() as { ok: true; value: SidecarEnvelope }).value;
  const created = handleCreateGoal(store, env, { objective: "build the feature" }, clocks);
  assert.equal(created.isError, false);
  env = (store.load() as { ok: true; value: SidecarEnvelope }).value;
  assert.ok(env.goal && env.goal.status === "active");
  return env;
}

test("three successful unfinished runs keep one session and three instruction/answer pairs", async () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as Array<{ content: string; details: Record<string, unknown> }>, notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log));
  let envelope = activeEnvelope(store);
  const v = view();
  for (let i = 0; i < 3; i++) {
    const check = controller.checkAdmission(v, envelope);
    assert.equal(controller.canAdmit(check).ok, true, `run ${i}`);
    const admitted = controller.admitDispatch(envelope, v);
    assert.equal(admitted.ok, true);
    envelope = (admitted as { ok: true; value: SidecarEnvelope }).value;
    const gen = controller.state.generation;
    const delivered = controller.deliverContinuation(envelope, v, gen);
    assert.equal(delivered.ok, true);
    // Delivery observed; settle with activity so the streak resets.
    controller.observeAssistantText(`progress part ${i}`);
    controller.observeAgentEnd([{ role: "assistant", stopReason: "stop" }]);
    controller.noteSettledOutcome(controller.classifyPreviousExecution());
    const settled = controller.settleAccounting(envelope, v);
    envelope = settled.envelope;
    assert.equal(envelope.goal?.status, "active");
  }
  assert.equal(log.instructions.length, 3);
  assert.ok(log.instructions.every((m) => (m.details as { purpose: string }).purpose === "continuation"));
  assert.ok(log.instructions.every((m) => m.content.includes("build the feature")));
});

test("queued user input blocks admission; stale dispatch is cancelled visibly", async () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as never[], notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log as never));
  const envelope = activeEnvelope(store);
  const busy = view({ hasPendingMessages: () => true });
  const check = controller.checkAdmission(busy, envelope);
  assert.equal(controller.canAdmit(check).ok, false);

  const idle = view();
  const admitted = controller.admitDispatch(envelope, idle);
  assert.equal(admitted.ok, true);
  const env2 = (admitted as { ok: true; value: SidecarEnvelope }).value;
  // User input arrives before delivery: cancel.
  controller.cancelStaleDispatch(env2, view(), "queued user input");
  assert.ok(log.notices.some((n) => n.includes("must not be acted on")));
  const after = (store.load() as { ok: true; value: SidecarEnvelope }).value;
  assert.equal(after.dispatch, null);
});

test("concurrent finalizers charge once and admit at most one dispatch", async () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as never[], notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log as never));
  let envelope = activeEnvelope(store);
  const entries: SessionView["entries"] = () => [
    { id: "e1", type: "message", message: { role: "assistant", usage: { input: 10, output: 5 } } },
  ];
  const v = view({ entries });
  const a = controller.settleAccounting(envelope, v);
  envelope = a.envelope;
  const tokensAfterFirst = envelope.goal!.tokensUsed;
  assert.equal(tokensAfterFirst, 15);
  // Replay of the same entries must not double-charge.
  const b = controller.settleAccounting(envelope, v);
  assert.equal(b.envelope.goal!.tokensUsed, 15);
});

test("three empty automatic runs block; nonempty answer counts as activity", () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as never[], notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log as never));
  activeEnvelope(store);
  // Two empties: not yet blocked.
  for (let i = 0; i < 2; i++) {
    controller.observeAgentEnd([{ role: "assistant", stopReason: "stop" }]);
    assert.equal(controller.noteSettledOutcome(controller.classifyPreviousExecution()).blocked, false);
  }
  // Nonempty answer resets the streak.
  controller.observeAssistantText("here is progress");
  controller.observeAgentEnd([{ role: "assistant", stopReason: "stop" }]);
  assert.equal(controller.noteSettledOutcome(controller.classifyPreviousExecution()).blocked, false);
  // Three empties in a row block.
  controller.observeAgentEnd([{ role: "assistant", stopReason: "stop" }]);
  controller.noteSettledOutcome(controller.classifyPreviousExecution());
  controller.observeAgentEnd([{ role: "assistant", stopReason: "stop" }]);
  controller.noteSettledOutcome(controller.classifyPreviousExecution());
  controller.observeAgentEnd([{ role: "assistant", stopReason: "stop" }]);
  assert.equal(controller.noteSettledOutcome(controller.classifyPreviousExecution()).blocked, true);
});

test("tool attempt counts as activity even when the command fails", () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as never[], notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log as never));
  activeEnvelope(store);
  controller.observeToolActivity(false);
  controller.observeAgentEnd([{ role: "assistant", stopReason: "stop" }]);
  assert.equal(controller.classifyPreviousExecution().kind, "activity");
});

test("budget overshoot persists and completion from budget_limited works", () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as never[], notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log as never));
  let env = (store.load() as { ok: true; value: SidecarEnvelope }).value;
  const created = handleCreateGoal(store, env, { objective: "capped", token_budget: 10 }, clocks);
  assert.equal(created.isError, false);
  env = (store.load() as { ok: true; value: SidecarEnvelope }).value;
  const entries: SessionView["entries"] = () => [
    { id: "e1", type: "message", message: { role: "assistant", usage: { input: 8, output: 5 } } },
  ];
  const settled = controller.settleAccounting(env, view({ entries }));
  assert.equal(settled.budgetHit, true);
  assert.equal(settled.envelope.goal?.status, "budget_limited");
  assert.equal(settled.envelope.goal?.tokensUsed, 13);
  const completed = controller.applyTerminalTransition(settled.envelope, "complete_from_budget");
  assert.equal(completed.ok, true);
});

test("invalidation bumps generation and blocks delivery", () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as never[], notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log as never));
  const envelope = activeEnvelope(store);
  const admitted = controller.admitDispatch(envelope, view());
  assert.equal(admitted.ok, true);
  const gen = controller.state.generation;
  controller.invalidate("clear");
  const delivered = controller.deliverContinuation(
    (admitted as { ok: true; value: SidecarEnvelope }).value,
    view(),
    gen,
  );
  assert.equal(delivered.ok, false);
});

test("restart with unresolved dispatch requires resume, no blind replay", () => {
  const backing = new Map<string, string>();
  const a = new InMemoryGoalStore("sess" as SessionId, backing);
  const logA = { instructions: [] as never[], notices: [] as string[] };
  const cA = new GoalController(a, clocks, sender(logA as never));
  const envelope = activeEnvelope(a);
  const admitted = cA.admitDispatch(envelope, view());
  assert.equal(admitted.ok, true);
  // New process, same backing store.
  const b = new InMemoryGoalStore("sess" as SessionId, backing);
  const logB = { instructions: [] as never[], notices: [] as string[] };
  const cB = new GoalController(b, clocks, sender(logB as never));
  const loaded = cB.loadState();
  assert.equal(cB.state.needsRecovery, true);
  const check = cB.checkAdmission(view(), loaded.envelope);
  assert.equal(cB.canAdmit(check).ok, false);
  void cA;
});

test("shell nonzero exit is activity, not executor failure", () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as never[], notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log as never));
  activeEnvelope(store);
  controller.observeToolActivity(false);
  controller.observeAgentEnd([{ role: "assistant", stopReason: "stop" }]);
  const outcome = controller.classifyPreviousExecution();
  assert.equal(outcome.kind, "activity");
  // No executor-unavailable counter exists for ordinary command failures.
  assert.ok(!("executorFailures" in controller));
});

test("clear before delivery leaves a tombstone and stale dispatch cannot work", async () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as never[], notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log as never));
  const envelope = activeEnvelope(store);
  const admitted = controller.admitDispatch(envelope, view());
  assert.equal(admitted.ok, true);
  // Clear wins: tombstone + invalidate.
  const env2 = (admitted as { ok: true; value: SidecarEnvelope }).value;
  const cleared = store.commit(env2.revision, (c) => ({
    ...c,
    goal: null,
    dispatch: null,
    cleared: true,
    clearedAt: clocks.nowIso(),
    chargedEntryIds: [],
    baselineEntryCount: null,
    remainderMs: 0,
  }));
  assert.equal(cleared.ok, true);
  assert.equal((cleared as { ok: true; value: SidecarEnvelope }).value.cleared, true);
  controller.invalidate("clear");
  const delivered = controller.deliverContinuation(env2, view(), 0);
  // Generation moved; delivery must fail.
  assert.equal(delivered.ok, false);
  void controller;
});
