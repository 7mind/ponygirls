/** Goal tool rows: one line collapsed, the full text for errors and when expanded. */
import assert from "node:assert/strict";
import test from "node:test";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { GOAL_STATUSES, type GoalRecord, type SessionId } from "../src/goal.ts";
import type { SidecarEnvelope } from "../src/store.ts";
import { handleGetGoal } from "../src/tools.ts";
import {
  collapsedCall,
  collapsedOutcome,
  expandedCall,
  type GoalToolName,
  readGoalState,
  renderGoalCall,
  renderGoalResult,
  type RowLine,
  type ToolRowContext,
  type ToolRowTheme,
} from "../src/tool-lines.ts";

const TAGS: ToolRowTheme = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: (text) => `*${text}*` };
const PLAIN: ToolRowTheme = { fg: (_color, text) => text, bold: (text) => text };
const WIDTHS = [60, 80, 100, 120, 170];

const goal: GoalRecord = {
  id: "3f2a9c1e-5b7d-4e80-a1c4-9d6e2f0b8a37" as GoalRecord["id"],
  objective: "Say the word ok, then immediately mark this goal complete with update_goal.",
  status: "active",
  tokenBudget: null,
  tokensUsed: 0,
  timeUsedSeconds: 0,
  createdAt: "2026-10-30T20:46:48.973Z",
  updatedAt: "2026-10-30T20:46:48.973Z",
};

function envelope(record: GoalRecord | null): SidecarEnvelope {
  return { version: 1, sessionId: "s" as SessionId, revision: 4, goal: record, dispatch: null, cleared: false, clearedAt: null, chargedEntryIds: [], baselineEntryCount: null, remainderMs: 0 };
}

/** The text get_goal returns to the model for this goal. */
function stateText(record: GoalRecord | null): string {
  return handleGetGoal(envelope(record)).content;
}

/** A row line as text, with its quotation uncut. */
function whole(line: RowLine | null): string {
  assert.ok(line !== null);
  return line.tail === null ? line.head : `${line.head}${line.tail.joint}“${line.tail.quoted}”`;
}

test("get_goal's model-facing text reads back as status, usage and time for every status, cap and objective", () => {
  const objectives = ["ship it", "two\nlines", "ends like the usage. Used 9 of 10 tokens in 9.9s.", "Goal x: status paused. Objective: nested"];
  for (const status of GOAL_STATUSES) {
    for (const tokenBudget of [null, 500_000]) {
      for (const objective of objectives) {
        const record = { ...goal, status, tokenBudget, objective, tokensUsed: 1234, timeUsedSeconds: 61.25 };
        assert.deepEqual(readGoalState(stateText(record)), { status, tokensUsed: 1234, tokenBudget, timeUsedSeconds: 61.3 }, `${status} ${tokenBudget} ${objective}`);
      }
    }
  }
  assert.equal(readGoalState(stateText(null)), "none");
  assert.equal(readGoalState("No current goal (no saved session)."), "none");
  assert.equal(readGoalState("Goal x: status sleeping. Objective: y. Used 1 tokens in 1.0s."), null);
  assert.equal(readGoalState("some other text"), null);
});

test("a successful call and its outcome read as one line", () => {
  assert.equal(whole(collapsedOutcome("get_goal", {}, stateText(goal), PLAIN)), "get_goal → active · 0 tokens · 0s");
  const capped = { ...goal, status: "budget_limited" as const, tokenBudget: 500_000, tokensUsed: 510_000, timeUsedSeconds: 3725 };
  assert.equal(whole(collapsedOutcome("get_goal", {}, stateText(capped), PLAIN)), "get_goal → budget_limited · 510k/500k tokens · 1h02m");
  assert.equal(whole(collapsedOutcome("get_goal", {}, stateText(null), PLAIN)), "get_goal → no goal");
  assert.equal(collapsedOutcome("get_goal", {}, "text from another version", PLAIN), null);

  assert.equal(whole(collapsedOutcome("create_goal", { objective: "Fix ```fences``` and\n  wrap" }, "Goal created (g).", PLAIN)), "create_goal → set · “Fix ```fences``` and wrap”");
  assert.equal(whole(collapsedOutcome("create_goal", { objective: "ship it", token_budget: 40_000 }, "Goal created (g).", PLAIN)), "create_goal → set · cap 40k · “ship it”");

  assert.equal(whole(collapsedOutcome("update_goal", { status: "complete" }, "Goal g is now complete.", PLAIN)), "update_goal complete");
  assert.equal(whole(collapsedOutcome("update_goal", { status: "blocked" }, "Goal g is now blocked.", PLAIN)), "update_goal blocked");
});

test("the tool name is the title, the status carries its state colour, the rest is tool output", () => {
  assert.equal(
    whole(collapsedOutcome("get_goal", {}, stateText({ ...goal, status: "paused" }), TAGS)),
    "<toolTitle>*get_goal*</toolTitle><toolOutput> → </toolOutput><warning>paused</warning><toolOutput> · 0 tokens · 0s</toolOutput>",
  );
  assert.equal(whole(collapsedOutcome("update_goal", { status: "blocked" }, "", TAGS)), "<toolTitle>*update_goal*</toolTitle> <error>blocked</error>");
  assert.equal(whole(collapsedOutcome("update_goal", { status: "complete" }, "", TAGS)), "<toolTitle>*update_goal*</toolTitle> <muted>complete</muted>");
  assert.equal(
    whole(collapsedOutcome("create_goal", { objective: "ship it" }, "", TAGS)),
    "<toolTitle>*create_goal*</toolTitle><toolOutput> → </toolOutput><text>set</text><toolOutput> · </toolOutput>“ship it”",
  );
});

test("a call alone names its arguments, also while they are still streaming", () => {
  assert.equal(whole(collapsedCall("get_goal", {}, PLAIN)), "get_goal");
  assert.equal(whole(collapsedCall("update_goal", { status: "complete" }, PLAIN)), "update_goal complete");
  assert.equal(whole(collapsedCall("update_goal", {}, PLAIN)), "update_goal");
  assert.equal(whole(collapsedCall("update_goal", null, PLAIN)), "update_goal");
  assert.equal(whole(collapsedCall("create_goal", { objective: "ship" }, PLAIN)), "create_goal “ship”");
  assert.equal(whole(collapsedCall("create_goal", { objective: "ship it", token_budget: 1_500_000 }, PLAIN)), "create_goal cap 1.5M · “ship it”");
  assert.equal(whole(collapsedCall("create_goal", { token_budget: "many" }, PLAIN)), "create_goal");
  assert.equal(whole(collapsedCall("create_goal", { objective: "a\x1b[31mb\x07" }, PLAIN)), "create_goal “a\\x1b[31mb\\x07”", "control characters never reach the terminal");
});

function context(args: unknown, state: { expanded: boolean; isPartial: boolean; isError: boolean }): ToolRowContext {
  return { args, ...state };
}

/** The row as pi composes it: the call's component, then the result's. */
function row(tool: GoalToolName, args: unknown, result: { text: string; isError: boolean } | null, expanded: boolean, theme: ToolRowTheme): Component[] {
  const state = context(args, { expanded, isPartial: result === null, isError: result?.isError ?? false });
  const call = renderGoalCall(tool, args, theme, state);
  if (result === null) return [call];
  return [call, renderGoalResult(tool, { content: [{ type: "text", text: result.text }] }, { expanded }, theme, state)];
}

function rows(components: Component[], width: number): string[] {
  return components.flatMap((component) => component.render(width));
}

test("collapsed rows are one line at every width; a long objective is cut inside its quotes", () => {
  const long = "word ".repeat(60).trim();
  const samples: Array<[GoalToolName, unknown, string]> = [
    ["get_goal", {}, stateText({ ...goal, tokenBudget: 500_000, tokensUsed: 123_456, timeUsedSeconds: 3725 })],
    ["get_goal", {}, stateText(null)],
    ["create_goal", { objective: long, token_budget: 40_000 }, "Goal created (g)."],
    ["update_goal", { status: "complete" }, "Goal g is now complete."],
  ];
  for (const width of [...WIDTHS, 30, 12, 1]) {
    for (const [tool, args, text] of samples) {
      for (const result of [null, { text, isError: false }]) {
        const lines = rows(row(tool, args, result, false, PLAIN), width);
        assert.equal(lines.length, 1, `${tool} at ${width}`);
        assert.ok(visibleWidth(lines[0]!) <= width, `${tool} too wide at ${width}: ${lines[0]}`);
      }
    }
  }
  const [created] = rows(row("create_goal", { objective: long }, { text: "Goal created (g).", isError: false }, false, PLAIN), 60);
  assert.equal(created, `create_goal → set · “${"word ".repeat(7)}wo…”`);
  assert.equal(visibleWidth(created!), 60);
  const [styled] = rows(row("create_goal", { objective: long }, { text: "Goal created (g).", isError: false }, false, TAGS), 120);
  assert.doesNotMatch(styled!, /\x1b/, "a cut adds no style reset, which would end the tool box's background");
  assert.match(styled!, /<toolOutput>“(word )+w?o?r?d?…”<\/toolOutput>$/);
  const [wide] = rows(row("create_goal", { objective: "目標".repeat(40) }, { text: "Goal created (g).", isError: false }, false, PLAIN), 60);
  assert.match(wide!, /^create_goal → set · “(目標)+目?…”$/);
  assert.ok(visibleWidth(wide!) <= 60 && visibleWidth(wide!) >= 59, "double-width characters are cut on a cell boundary");
  assert.deepEqual(rows(row("create_goal", { objective: long }, { text: "", isError: false }, false, PLAIN), 22), ["create_goal → set"], "no room for a quotation: the row ends before it");
});

test("an error keeps the call line and its full text; text without a short form keeps the tool's name", () => {
  const rejected = "update_goal rejected: status must be one of complete, blocked. Pausing is user-only via /goal pause or Escape. Resume, clear, objective edits, and budget transitions are outside the model tool schema.";
  const lines = rows(row("update_goal", { status: "paused" }, { text: rejected, isError: true }, false, PLAIN), 400);
  assert.deepEqual(lines.map((line) => line.trimEnd()), ["update_goal paused", rejected]);
  for (const width of WIDTHS) {
    const wrapped = rows(row("update_goal", { status: "paused" }, { text: rejected, isError: true }, false, PLAIN), width);
    for (const line of wrapped) assert.ok(visibleWidth(line) <= width);
    assert.equal(wrapped.slice(1).map((line) => line.trim()).join(" "), rejected, "wrapped, not cut");
  }
  const unknown = rows(row("get_goal", {}, { text: "text from another version", isError: false }, false, PLAIN), 80);
  assert.deepEqual(unknown.map((line) => line.trimEnd()), ["get_goal", "text from another version"]);
});

test("expanded rows are the generic call header and the whole result text", () => {
  const text = stateText({ ...goal, objective: "two\nlines" });
  const lines = rows(row("get_goal", {}, { text, isError: false }, true, PLAIN), 400).map((line) => line.trimEnd());
  assert.deepEqual(lines, ["get_goal", ...text.split("\n")]);
  assert.equal(expandedCall("create_goal", { objective: "a\n\tb", token_budget: 5 }, TAGS), "<toolTitle>*create_goal*</toolTitle>\n<muted>  objective: a\n       b\n  token_budget: 5</muted>");
  assert.equal(expandedCall("get_goal", {}, PLAIN), "get_goal");
  const pending = rows(row("update_goal", { status: "complete" }, null, true, PLAIN), 80).map((line) => line.trimEnd());
  assert.deepEqual(pending, ["update_goal", "  status: complete"]);
});
