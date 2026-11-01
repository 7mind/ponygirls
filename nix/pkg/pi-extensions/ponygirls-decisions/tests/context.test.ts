import assert from "node:assert/strict";
import { test } from "node:test";
import { contextLine, summarizeContext } from "../src/context.ts";

const CONTENT = "Project decisions: 2 unanswered. Pending questions are not permission to proceed.\n" +
  "Q1 [pending] Should border badges encode state?\nQ2 [pending] Collapse goal kickoff prompts?\nQ3 [answered] Use a shared kit?";

test("the context message collapses to its unanswered ids and resolved count", () => {
  const summary = summarizeContext(CONTENT);
  assert.deepEqual(summary, { pending: ["Q1", "Q2"], resolved: 1 });
  const line = contextLine(summary);
  assert.equal(line.lead, "? decisions · 2 unanswered");
  assert.equal(line.detail, " · Q1 Q2 · 1 recently resolved · context for the model ▸ ctrl+o");
});

test("current-session markers preserve pending IDs and resolved counts", () => {
  assert.deepEqual(summarizeContext("Q1 [pending] [this session] Current question\nQ2 [answered] [this session] Resolved question\nQ3 [dismissed] Other session"),
    { pending: ["Q1"], resolved: 2 });
});

test("question text that merely looks like a status line inside a question is not counted twice", () => {
  const summary = summarizeContext("Project decisions: 1 unanswered.\nQ4 [pending] Is Q5 [answered] related?");
  assert.deepEqual(summary, { pending: ["Q4"], resolved: 0 });
});
