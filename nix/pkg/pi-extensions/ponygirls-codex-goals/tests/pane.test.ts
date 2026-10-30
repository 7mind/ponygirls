/** The /goal pane: frame, values, status-dependent keys, and widths. */
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { PLAIN_THEME, type UiTheme } from "@ponygirls/pi-ui";
import type { GoalRecord } from "../src/goal.ts";
import { GoalPane, type GoalPaneAction, type GoalPanePorts, type GoalSnapshotResult, localStamp, relativeAge } from "../src/pane.ts";

/** Marks every styled span so tests can check which token styles what. */
const TAGS: UiTheme = {
  fg: (color, text) => `<${color}>${text}</${color}>`,
  bg: (color, text) => `[${color}]${text}[/${color}]`,
  bold: (text) => text,
};

const NOW = new Date(2026, 9, 30, 22, 46).getTime();

const goal: GoalRecord = {
  id: "goal-1" as GoalRecord["id"],
  objective: "ship it",
  status: "active",
  tokenBudget: 500_000,
  tokensUsed: 125_000,
  timeUsedSeconds: 3725,
  createdAt: new Date(2026, 9, 30, 20, 46).toISOString(),
  updatedAt: new Date(2026, 9, 30, 22, 42).toISOString(),
};

interface Harness {
  pane: GoalPane;
  ran: GoalPaneAction[];
  renders: () => number;
  closed: () => number;
  finish: () => void;
}

function harness(theme: UiTheme, load: () => GoalSnapshotResult): Harness {
  const ran: GoalPaneAction[] = [];
  let renders = 0;
  let closed = 0;
  let finish: () => void = () => {};
  const ports: GoalPanePorts = {
    load,
    run: (action) => {
      ran.push(action);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    requestRender: () => {
      renders += 1;
    },
    close: () => {
      closed += 1;
    },
    nowMs: () => NOW,
  };
  return { pane: new GoalPane(theme, ports), ran, renders: () => renders, closed: () => closed, finish: () => finish() };
}

function at(record: GoalRecord, revision: number): () => GoalSnapshotResult {
  return () => ({ ok: true, value: { goal: record, revision } });
}

test("the pane frames status and revision, then shows objective, budget, and timing", () => {
  const lines = harness(PLAIN_THEME, at(goal, 7)).pane.render(80);
  assert.match(lines[0]!, /^── Goal ─+ {2}◎ active {2}rev 7 ──$/);
  assert.equal(lines[1], "  ship it");
  assert.equal(lines[2], "");
  assert.match(lines[3]!, /^ {2}tokens {3}125\.0k \/ 500\.0k {2}███░░░░░░░ 25%$/);
  assert.equal(lines[4], "  time     1h02m");
  assert.equal(lines[5], "  created  today 20:46  (2h ago)");
  assert.equal(lines[6], "  updated  today 22:42  (4 min ago)");
  assert.equal(lines[7], "─".repeat(80));
  assert.equal(lines[8], "p pause  e edit objective  c clear  esc close");
  assert.equal(lines.length, 9);
});

test("an uncapped goal shows usage with no cap; resumable statuses offer resume instead of pause", () => {
  for (const status of ["paused", "blocked", "usage_limited"] as const) {
    const text = harness(PLAIN_THEME, at({ ...goal, status, tokenBudget: null }, 3)).pane.render(80).join("\n");
    assert.match(text, /tokens {3}125\.0k · no cap/);
    assert.match(text, /\nr resume {2}e edit objective {2}c clear {2}esc close$/);
    assert.doesNotMatch(text, /p pause/);
  }
  for (const status of ["budget_limited", "complete"] as const) {
    const text = harness(PLAIN_THEME, at({ ...goal, status }, 3)).pane.render(80).join("\n");
    assert.match(text, /\ne edit objective {2}c clear {2}esc close$/);
  }
});

test("labels are muted, values text, and the status chip and bar carry the state colour", () => {
  const chip = (status: GoalRecord["status"]): string => harness(TAGS, at({ ...goal, status }, 1)).pane.render(200)[0]!;
  assert.match(chip("active"), /\[toolPendingBg\] <success>◎ active<\/success> \[\/toolPendingBg\]/);
  assert.match(chip("paused"), /<warning>◉ paused<\/warning>/);
  assert.match(chip("blocked"), /<error>✖ blocked<\/error>/);
  assert.match(chip("usage_limited"), /<error>✖ usage_limited<\/error>/);
  assert.match(chip("budget_limited"), /<error>✖ budget_limited<\/error>/);
  assert.match(chip("complete"), /<muted>◈ complete<\/muted>/);
  const lines = harness(TAGS, at(goal, 1)).pane.render(200);
  assert.match(lines[3]!, /<muted>tokens +<\/muted><text>125\.0k \/ 500\.0k<\/text> {2}<success>███<\/success><dim>░{7}<\/dim> <muted>25%<\/muted>/);
  assert.match(lines[4]!, /<muted>time +<\/muted><text>1h02m<\/text>/);
  assert.match(lines[5]!, /<text>today 20:46<\/text> {2}<muted>\(2h ago\)<\/muted>/);
  const near = harness(TAGS, at({ ...goal, tokensUsed: 460_000 }, 1)).pane.render(200)[3]!;
  assert.match(near, /<warning>█{9}<\/warning>/);
  const over = harness(TAGS, at({ ...goal, status: "budget_limited", tokensUsed: 510_000 }, 1)).pane.render(200)[3]!;
  assert.match(over, /<error>█{10}<\/error>.*102%/);
});

test("keys run the subcommand for the current status and refresh the pane afterwards", async () => {
  const active = harness(PLAIN_THEME, at(goal, 1));
  active.pane.handleInput("r");
  assert.deepEqual(active.ran, []);
  active.pane.handleInput("p");
  active.pane.handleInput("e");
  assert.deepEqual(active.ran, ["pause"], "a second key waits for the running subcommand");
  active.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active.renders(), 1);
  active.pane.handleInput("e");
  active.finish();
  await new Promise((resolve) => setImmediate(resolve));
  active.pane.handleInput("c");
  assert.deepEqual(active.ran, ["pause", "edit", "clear"]);

  const paused = harness(PLAIN_THEME, at({ ...goal, status: "paused" }, 1));
  paused.pane.handleInput("p");
  paused.pane.handleInput("r");
  assert.deepEqual(paused.ran, ["resume"]);

  const limited = harness(PLAIN_THEME, at({ ...goal, status: "budget_limited" }, 1));
  limited.pane.handleInput("r");
  limited.pane.handleInput("p");
  assert.deepEqual(limited.ran, []);
});

test("escape and ctrl+c close the pane", () => {
  const h = harness(PLAIN_THEME, at(goal, 1));
  h.pane.handleInput("\x1b");
  h.pane.handleInput("\x03");
  h.pane.handleInput("x");
  assert.equal(h.closed(), 2);
  assert.deepEqual(h.ran, []);
});

test("no goal and an unreadable store are stated, with only the close key", () => {
  const empty = harness(PLAIN_THEME, () => ({ ok: true, value: { goal: null, revision: 4 } }));
  const lines = empty.pane.render(60);
  assert.match(lines[0]!, /^── Goal ─+ rev 4 ──$/);
  assert.equal(lines[1], "  no goal — /goal <objective> sets one");
  assert.equal(lines.at(-1), "esc close");
  empty.pane.handleInput("c");
  assert.deepEqual(empty.ran, []);
  const broken = harness(PLAIN_THEME, () => ({ ok: false, error: "malformed sidecar" }));
  assert.match(broken.pane.render(60).join("\n"), /goal state unreadable: malformed sidecar/);
});

test("every line fits the pane width and a long objective wraps", () => {
  for (const width of [80, 40, 20]) {
    const lines = harness(PLAIN_THEME, at({ ...goal, objective: `${"word ".repeat(40)}\nsecond paragraph` }, 474)).pane.render(width);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `line too wide at ${width}: ${line}`);
  }
  const lines = harness(PLAIN_THEME, at({ ...goal, objective: `${"word ".repeat(40)}\nsecond paragraph` }, 1)).pane.render(80);
  assert.ok(lines.includes("  second paragraph"));
  assert.ok(lines.filter((line) => line.startsWith("  word")).length >= 3);
});

test("timestamps read as local day and time plus a relative age", () => {
  const now = new Date(2026, 9, 30, 22, 46);
  assert.equal(localStamp(new Date(2026, 9, 30, 9, 5), now), "today 09:05");
  assert.equal(localStamp(new Date(2026, 9, 29, 23, 59), now), "yesterday 23:59");
  assert.equal(localStamp(new Date(2026, 9, 2, 7, 0), now), "2026-10-02 07:00");
  assert.equal(relativeAge(30_000), "just now");
  assert.equal(relativeAge(4 * 60_000 + 59_000), "4 min ago");
  assert.equal(relativeAge(2 * 3_600_000 + 5), "2h ago");
  assert.equal(relativeAge(3 * 86_400_000), "3d ago");
  assert.equal(relativeAge(-5_000), "just now");
});
