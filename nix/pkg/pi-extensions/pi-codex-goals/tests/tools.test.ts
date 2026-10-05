import assert from "node:assert/strict";
import test from "node:test";

import { handleCreateGoal, handleGetGoal, handleUpdateGoal } from "../src/tools.ts";
import { InMemoryGoalStore } from "../src/store.ts";
import type { SessionId } from "../src/goal.ts";

const clocks = { nowIso: () => "2026-10-05T00:00:00.000Z" };

function freshStore(id = "s1") {
  return new InMemoryGoalStore(id as SessionId);
}

test("ordinary get with no goal creates nothing", () => {
  const store = freshStore();
  const env = store.load();
  assert.equal(env.ok, true);
  const out = handleGetGoal((env as { ok: true; value: never }).value as never);
  assert.match(out.content, /No current goal/);
  assert.equal(out.isError, false);
  // Store untouched.
  const after = store.load();
  assert.equal((after as { ok: true; value: { goal: null } }).value.goal, null);
});

test("model cannot resume or edit through update_goal", () => {
  const store = freshStore("s2");
  let env = (store.load() as { ok: true; value: never }).value as never;
  const created = handleCreateGoal(store, env, { objective: "do x" }, clocks);
  assert.equal(created.isError, false);
  env = (store.load() as { ok: true; value: never }).value as never;
  const bad = handleUpdateGoal(store, env, { status: "active" }, clocks);
  assert.equal(bad.isError, true);
  const resume = handleUpdateGoal(store, env, { status: "resume" }, clocks);
  assert.equal(resume.isError, true);
});

test("create refuses unfinished including budget_limited; completion reports consumption", () => {
  const store = freshStore("s3");
  let env = (store.load() as { ok: true; value: never }).value as never;
  assert.equal(handleCreateGoal(store, env, { objective: "first", token_budget: 100 }, clocks).isError, false);
  env = (store.load() as { ok: true; value: never }).value as never;
  assert.equal(handleCreateGoal(store, env, { objective: "second" }, clocks).isError, true);
  // Complete the budgeted goal: final consumption report.
  const done = handleUpdateGoal(store, env, { status: "complete" }, clocks);
  assert.equal(done.isError, false);
  assert.match(done.content, /Final consumption/);
  assert.match(done.content, /visible follow-up/);
  // After complete, creation is allowed (replacement).
  env = (store.load() as { ok: true; value: never }).value as never;
  assert.equal(handleCreateGoal(store, env, { objective: "next" }, clocks).isError, false);
});

test("invalid objective and budget are domain errors, state unchanged", () => {
  const store = freshStore("s4");
  let env = (store.load() as { ok: true; value: never }).value as never;
  assert.equal(handleCreateGoal(store, env, { objective: "   " }, clocks).isError, true);
  assert.equal(handleCreateGoal(store, env, { objective: "x", token_budget: -1 }, clocks).isError, true);
  const after = store.load() as { ok: true; value: { goal: null; revision: number } };
  assert.equal(after.value.goal, null);
  assert.equal(after.value.revision, 0);
});
