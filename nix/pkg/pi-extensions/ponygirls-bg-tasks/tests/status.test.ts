import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";
import { PLAIN_THEME, borderBadge, borderBadgeCompact, type UiTheme } from "@ponygirls/pi-ui";
import { BG_STATUS_KEY, bgBadge, countRunning } from "../src/status.ts";
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
  assert.equal(bgBadge([]), null);
  assert.equal(countRunning([]), 0);
  const finalized = [task("completed"), task("failed"), task("dead")];
  assert.equal(countRunning(finalized), 0);
  assert.equal(bgBadge(finalized), null);
});

test("any running phase counts as active", () => {
  const phases: Array<TaskRecord["phase"]> = ["starting", "running", "closing", "stopping", null];
  for (const phase of phases) {
    assert.equal(countRunning([task("running", phase)]), 1);
  }
});

/** Styling as visible tags; a background would show as `[token]`. */
const TAGGED: UiTheme = { fg: (color, text) => `<${color}>${text}</${color}>`, bg: (color, text) => `[${color}]${text}[/${color}]`, bold: (text) => text };

test("the badge is the glyph and the number of running tasks in the running colour, without a chip", () => {
  const one = bgBadge([task("running")]);
  assert.deepEqual(one, { glyph: "🛠️", state: "running", label: "1", compact: "1" });
  assert.equal(borderBadge(TAGGED, one!, 80), " 🛠️ <accent>1</accent> ");
  assert.equal(borderBadgeCompact(TAGGED, one!, 80), "🛠️<accent>1</accent>");
  const two = bgBadge([task("running"), task("completed"), task("running")]);
  assert.equal(borderBadge(TAGGED, two!, 80), " 🛠️ <accent>2</accent> ");
  assert.equal(borderBadgeCompact(TAGGED, two!, 80), "🛠️<accent>2</accent>");
  for (const width of [3, 60, 80, 100, 120, 170]) {
    assert.ok(visibleWidth(borderBadge(PLAIN_THEME, two!, width)) <= width, `full form at ${width}`);
    assert.ok(visibleWidth(borderBadgeCompact(PLAIN_THEME, two!, width)) <= width, `compact form at ${width}`);
  }
  assert.equal(borderBadge(PLAIN_THEME, two!, 80), " 🛠️ 2 ");
  assert.equal(borderBadgeCompact(PLAIN_THEME, two!, 80), "🛠️2");
});
