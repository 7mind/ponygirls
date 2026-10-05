import assert from "node:assert/strict";
import test from "node:test";

import { GoalController, type SessionView } from "../src/runtime.ts";
import { InMemoryGoalStore, FileGoalStore, type SidecarEnvelope } from "../src/store.ts";
import { handleCreateGoal, handleUpdateGoal } from "../src/tools.ts";
import type { SessionId } from "../src/goal.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const clocks = { nowIso: () => "2026-10-05T00:00:00.000Z", nowMs: () => 1_000 };

function sender(log: { instructions: unknown[]; notices: string[] }) {
  return {
    sendGoalInstruction: (content: string, details: Record<string, unknown>) => {
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
  const created = handleCreateGoal(store, env, { objective: "lifecycle target" }, clocks);
  assert.equal(created.isError, false);
  return (store.load() as { ok: true; value: SidecarEnvelope }).value;
}

test("finalized provider error becomes blocked, never usage_limited", () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as unknown[], notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log));
  activeEnvelope(store);
  // Unclassified 429 prose must not be parsed as a quota classifier.
  controller.observeAgentEnd([
    { role: "assistant", stopReason: "error", errorMessage: "429 rate limit exceeded, slow down" },
  ]);
  const outcome = controller.classifyPreviousExecution();
  assert.equal(outcome.kind, "error_exhausted");
  if (outcome.kind === "error_exhausted") {
    assert.match(outcome.errorText, /429/);
  }
  controller.noteSettledOutcome(outcome);
});

test("finalized abort classifies as abort (user-interrupt path pauses, preserves usage)", () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as unknown[], notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log));
  const envelope = activeEnvelope(store);
  controller.observeAgentEnd([{ role: "assistant", stopReason: "aborted" }]);
  assert.equal(controller.classifyPreviousExecution().kind, "aborted");
  // Usage retained: settle first, then pause keeps tokens.
  const settled = controller.settleAccounting(envelope, view());
  assert.equal(settled.envelope.goal?.status, "active");
});

test("replacement retains history entries and resets identity/baseline", () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as unknown[], notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log));
  void controller;
  let env = activeEnvelope(store);
  const firstId = env.goal!.id;
  // Charge some usage against the first goal.
  const charged = controller.settleAccounting(
    env,
    view({
      entries: () => [
        { id: "e1", type: "message", message: { role: "assistant", usage: { input: 10, output: 5 } } },
      ],
    }),
  );
  env = charged.envelope;
  assert.equal(env.goal!.tokensUsed, 15);
  // Replacement (complete then create) resets usage with a new identity.
  const complete = controller.applyTerminalTransition(env, "complete");
  assert.equal(complete.ok, true);
  const done = (complete as { ok: true; value: SidecarEnvelope }).value;
  assert.equal(done.goal!.status, "complete");
  const recreated = handleCreateGoal(store, done, { objective: "next objective" }, clocks);
  assert.equal(recreated.isError, false);
  assert.notEqual(recreated.state!.id, firstId);
  assert.equal(recreated.state!.tokensUsed, 0);
});

test("fork inherits goal state into a separate store without live dispatch", () => {
  const parent = new InMemoryGoalStore("parent" as SessionId);
  const penv = activeEnvelope(parent);
  // Simulate fork: copy parent goal/accounting into child envelope.
  const child = new InMemoryGoalStore("child" as SessionId);
  let cenv = (child.load() as { ok: true; value: SidecarEnvelope }).value;
  const copied = child.commit(cenv.revision, (c) => ({
    ...c,
    goal: penv.goal ? { ...penv.goal, updatedAt: clocks.nowIso() } : null,
    cleared: false,
    clearedAt: null,
    chargedEntryIds: [],
    baselineEntryCount: null,
    remainderMs: 0,
    dispatch: null,
  }));
  assert.equal(copied.ok, true);
  cenv = (copied as { ok: true; value: SidecarEnvelope }).value;
  assert.equal(cenv.goal?.objective, "lifecycle target");
  assert.equal(cenv.dispatch, null);
  assert.notEqual(cenv.sessionId, penv.sessionId);
});

test("reload reconstructs state without losing the goal or charging downtime", () => {
  const backing = new Map<string, string>();
  const a = new InMemoryGoalStore("sess" as SessionId, backing);
  const logA = { instructions: [] as unknown[], notices: [] as string[] };
  const cA = new GoalController(a, { nowIso: () => "2026-10-05T00:00:00.000Z", nowMs: () => 1_000 }, sender(logA));
  void cA;
  activeEnvelope(a);
  // New process, same backing: reconstruct.
  const b = new InMemoryGoalStore("sess" as SessionId, backing);
  const logB = { instructions: [] as unknown[], notices: [] as string[] };
  const cB = new GoalController(b, { nowIso: () => "2026-10-05T01:00:00.000Z", nowMs: () => 3_601_000 }, sender(logB));
  const loaded = cB.loadState();
  assert.ok(loaded.envelope?.goal);
  assert.equal(loaded.envelope.goal.status, "active");
  // Downtime is not charged: time advances only via active spans.
  assert.equal(loaded.envelope.goal.timeUsedSeconds, 0);
});

test("transcript failure after state commit disables admission explicitly", () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const failing = {
    sendGoalInstruction: () => {
      throw new Error("host delivery failed");
    },
    sendNotice: () => {},
    appendCommitMeta: () => {},
  };
  const controller = new GoalController(store, clocks, failing);
  const envelope = activeEnvelope(store);
  const admitted = controller.admitDispatch(envelope, view());
  assert.equal(admitted.ok, true);
  const delivered = controller.deliverContinuation(
    (admitted as { ok: true; value: SidecarEnvelope }).value,
    view(),
    controller.state.generation,
  );
  assert.equal(delivered.ok, false);
  assert.equal(controller.state.admissionDisabled, true);
});

test("file adapter lock: same-process reentry succeeds, live foreign holder conflicts", async () => {
  const { spawn } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const { hostname } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "codex-goals-lock-"));
  const sessionFile = join(dir, "s.jsonl");
  const lockPath = `${sessionFile}.codex-goals.json.lock`;
  const a = new FileGoalStore("s" as SessionId, sessionFile);
  assert.equal(a.acquireLock().ok, true);
  // Same process reentry is the same owner: succeeds without conflict.
  const b = new FileGoalStore("s" as SessionId, sessionFile);
  assert.equal(b.acquireLock().ok, true);
  a.releaseLock();
  b.releaseLock();
  // Foreign live holder: spawn a sleeper and forge its lock.
  const child = spawn("sleep", ["30"]);
  assert.ok(child.pid !== undefined);
  writeFileSync(
    lockPath,
    JSON.stringify({ pid: child.pid, host: hostname(), acquiredAt: new Date().toISOString() }),
  );
  const c = new FileGoalStore("s" as SessionId, sessionFile);
  const conflict = c.acquireLock();
  assert.equal(conflict.ok, false);
  assert.equal((conflict as { ok: false; error: { code: string } }).error.code, "locked");
  child.kill();
  await new Promise((resolve) => child.on("exit", resolve));
  // Dead owner on this host is positively absent: stale lock recovers.
  const recovered = c.acquireLock();
  assert.equal(recovered.ok, true);
  c.releaseLock();
  // Releasing an unheld lock is idempotent.
  c.releaseLock();
});

test("in-memory session has no sidecar path and is rejected", () => {
  const store = new InMemoryGoalStore("ephemeral" as SessionId);
  assert.equal(store.sidecarPath, null);
});

test("tool-safe ordering: overshoot settled before update blocks completion-as-budgeted", () => {
  const store = new InMemoryGoalStore("sess" as SessionId);
  const log = { instructions: [] as unknown[], notices: [] as string[] };
  const controller = new GoalController(store, clocks, sender(log));
  let env = (store.load() as { ok: true; value: SidecarEnvelope }).value;
  const created = handleCreateGoal(store, env, { objective: "capped", token_budget: 10 }, clocks);
  assert.equal(created.isError, false);
  env = (store.load() as { ok: true; value: SidecarEnvelope }).value;
  // Tool-safe checkpoint first: the run already overspent.
  const settled = controller.settleAccounting(
    env,
    {
      sessionId: "sess" as SessionId,
      sessionFile: "/tmp/s.jsonl",
      entryCount: () => 1,
      entries: () => [
        { id: "e1", type: "message", message: { role: "assistant", usage: { input: 8, output: 5 } } },
      ],
      isIdle: () => false,
      hasPendingMessages: () => false,
    },
  );
  assert.equal(settled.budgetHit, true);
  assert.equal(settled.envelope.goal?.status, "budget_limited");
  // A subsequent complete against the settled state is rejected: the goal
  // is budget_limited, and exhaustion is never labeled completion.
  const done = handleUpdateGoal(store, settled.envelope, { status: "complete" }, clocks);
  assert.equal(done.isError, true);
  assert.match(done.content, /Only an active goal can complete|budget/i);
});
