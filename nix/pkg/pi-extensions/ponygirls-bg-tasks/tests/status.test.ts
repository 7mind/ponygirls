import assert from "node:assert/strict";
import test from "node:test";

import { BG_STATUS_KEY, bgStatusLine, countRunning } from "../src/status.ts";
import type { TaskRecord } from "../src/protocol.ts";

function task(state: TaskRecord["state"], phase: TaskRecord["phase"] = null): TaskRecord {
  return {
    id: "t",
    seq: 1,
    sessionId: "s",
    label: "l",
    command: "true",
    cwd: "/",
    createdAt: "2026-10-06T00:00:00.000Z",
    startedAt: null,
    endedAt: null,
    activation: "a",
    state,
    phase,
    revision: 1,
    exit: null,
    reason: null,
    reasonDetail: null,
    logPath: "tasks/t/terminal.log",
    logBytes: 0,
    notify: true,
    event: null,
    pid: null,
    pgid: null,
    interruptedActivation: null,
    clearing: false,
    cleanupUnconfirmed: false,
  } as TaskRecord;
}

test("status key sorts alongside the other footer indicators", () => {
  assert.equal(BG_STATUS_KEY, "bg");
});

test("no tasks or only finalized tasks clear the status", () => {
  assert.equal(bgStatusLine([]), null);
  assert.equal(countRunning([]), 0);
  const finalized = [task("completed"), task("failed"), task("dead")];
  assert.equal(countRunning(finalized), 0);
  assert.equal(bgStatusLine(finalized), null);
});

test("any running phase counts as active", () => {
  const phases: Array<TaskRecord["phase"]> = ["starting", "running", "closing", "stopping", null];
  for (const phase of phases) {
    assert.equal(countRunning([task("running", phase)]), 1);
  }
});

test("running count renders singular and plural", () => {
  assert.equal(bgStatusLine([task("running")]), "bg 1 running");
  assert.equal(bgStatusLine([task("running"), task("completed"), task("running")]), "bg 2 running");
});
