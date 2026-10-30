/** Collapsed transcript forms and reading instruction tags back from the rendered text. */
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { GoalRecord } from "../src/goal.ts";
import {
  parseExecutionIndex,
  parseInstructionHeader,
  parseObjective,
  renderBudgetWrapup,
  renderContinuation,
  renderKickoff,
  renderObjectiveUpdate,
  renderResync,
} from "../src/prompts.ts";
import {
  BannerLine,
  commitSummary,
  instructionSummary,
  isCommitMeta,
  isPauseNotice,
  messageText,
  pauseNoticeSummary,
  type TranscriptTheme,
} from "../src/transcript.ts";

const TAGS: TranscriptTheme = {
  fg: (color, text) => `<${color}>${text}</${color}>`,
  bg: (color, text) => `[${color}]${text}[/${color}]`,
};
const PLAIN: TranscriptTheme = { fg: (_color, text) => text, bg: (_color, text) => text };

const goal: GoalRecord = {
  id: "e498e4d2-ba50-4388-9c53-5d38d6badf24" as GoalRecord["id"],
  objective: "Fix ```fences``` and\nwrap",
  status: "active",
  tokenBudget: 500_000,
  tokensUsed: 1200,
  timeUsedSeconds: 6,
  createdAt: "2026-10-30T20:46:48.973Z",
  updatedAt: "2026-10-30T20:46:48.973Z",
};

test("instruction tags, execution index, and objective read back from every rendered instruction", () => {
  const rendered = [
    renderKickoff(goal, 1),
    renderContinuation(goal, 2, 7),
    renderObjectiveUpdate(goal, 3),
    renderResync(goal, 4),
    renderBudgetWrapup({ ...goal, status: "budget_limited" }, 5),
  ];
  assert.deepEqual(
    rendered.map((content) => parseInstructionHeader(content)),
    [
      { purpose: "kickoff", goalId: goal.id, revision: 1, status: "active" },
      { purpose: "continuation", goalId: goal.id, revision: 2, status: "active" },
      { purpose: "objective_update", goalId: goal.id, revision: 3, status: "active" },
      { purpose: "resync", goalId: goal.id, revision: 4, status: "active" },
      { purpose: "budget_wrapup", goalId: goal.id, revision: 5, status: "budget_limited" },
    ],
  );
  for (const content of rendered) assert.equal(parseObjective(content), goal.objective);
  assert.equal(parseExecutionIndex(rendered[1]!), 7);
  assert.equal(parseExecutionIndex(rendered[0]!), null);
  assert.equal(parseInstructionHeader("[codex-goal:unknown goal=x rev=1 status=active] X"), null);
  assert.equal(parseInstructionHeader("plain text"), null);
});

test("a collapsed instruction names kind, status, objective, and size", () => {
  const kickoff = renderKickoff(goal, 1);
  const lines = kickoff.split("\n").length;
  assert.equal(
    instructionSummary(TAGS, kickoff, "ctrl+o"),
    `<customMessageLabel>◎ goal</customMessageLabel><customMessageText> · kickoff · </customMessageText><success>active</success>` +
      `<customMessageText> · “Fix \`\`\`fences\`\`\` and wrap” · ${lines} lines ▸ ctrl+o</customMessageText>`,
  );
  const continuation = renderContinuation(goal, 2, 3);
  assert.equal(instructionSummary(PLAIN, continuation, "ctrl+o"), `◎ goal · continuation 3 · active · ${continuation.split("\n").length} lines ▸ ctrl+o`);
  assert.match(instructionSummary(PLAIN, renderObjectiveUpdate(goal, 3), "ctrl+o")!, /^◎ goal · objective update · active · “Fix/);
  assert.match(instructionSummary(PLAIN, renderResync(goal, 4), "ctrl+o")!, /^◎ goal · resync · active · /);
  assert.match(instructionSummary(TAGS, renderBudgetWrapup({ ...goal, status: "budget_limited" }, 5), "ctrl+o")!, /✖ goal.* · budget wrap-up · .*<error>budget_limited<\/error>/);
  assert.match(instructionSummary(PLAIN, kickoff, "")!, / lines$/);
  assert.equal(instructionSummary(PLAIN, "Some other text", "ctrl+o"), null);
});

test("messageText joins text parts as pi's default renderer does", () => {
  assert.equal(messageText("plain"), "plain");
  assert.equal(messageText([{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }]), "a\nb");
});

test("pause notices and commit entries have one-line forms; other data does not qualify", () => {
  const pause = { text: "Goal paused (g).", at: "t", event: "paused" as const, goalId: "g", revision: 474, timeUsedSeconds: 6 };
  assert.ok(isPauseNotice(pause));
  assert.ok(!isPauseNotice({ text: "Goal paused (g).", at: "t" }));
  assert.equal(
    pauseNoticeSummary(TAGS, pause),
    "<warning>◉ goal paused</warning><customMessageText> · rev 474 · 6s · /goal resume</customMessageText>",
  );
  assert.ok(isCommitMeta({ sessionId: "s", goalId: "g", revision: 2 }));
  assert.ok(!isCommitMeta({ sessionId: "s" }));
  assert.ok(!isCommitMeta(null));
  assert.equal(commitSummary(TAGS, { sessionId: "s", goalId: "g", revision: 2 }), "<dim>  · goal rev 2 committed</dim>");
  assert.equal(commitSummary(PLAIN, { sessionId: "s", goalId: null, revision: 3, tombstone: true }), "  · goal rev 3 committed · cleared");
});

test("a banner line fills exactly the width on the custom-message background", () => {
  const banner = new BannerLine(PLAIN, "◎ goal · kickoff · active · “a long objective that will not fit”", 1);
  for (const width of [120, 40, 1]) {
    const [line] = banner.render(width);
    assert.equal(visibleWidth(line!), width);
  }
  assert.match(new BannerLine(TAGS, "x", 1).render(4)[0]!, /^\[customMessageBg\] x {2}\[\/customMessageBg\]$/);
});
