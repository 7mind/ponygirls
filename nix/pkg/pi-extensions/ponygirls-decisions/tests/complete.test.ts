import assert from "node:assert/strict";
import { test } from "node:test";
import { completeDecisionArguments } from "../src/complete.ts";
import type { Decision } from "../src/store.ts";

const question = (number: number, status: Decision["status"], text: string): Decision => ({
  id: `Q${number}`, project: "p", number, question: text, context: "", options: [], recommendation: "", status,
  answer: status === "answered" ? "yes" : null, revision: 1, createdAt: "", updatedAt: "", sessionId: "s", toolCallId: "t",
});
const QUESTIONS = [question(1, "pending", "Use a\nshared kit?"), question(2, "answered", "Collapse prompts?"), question(3, "dismissed", "Old\x1b[31m one")];
const plain = (text: string): string => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
const values = (prefix: string): string[] | null => completeDecisionArguments(prefix, QUESTIONS, plain)?.map((item) => item.value) ?? null;

test("first position: the three verbs, then every question id", () => {
  assert.deepEqual(values(""), ["answer ", "dismiss ", "reopen ", "Q1", "Q2", "Q3"]);
  assert.deepEqual(values("q"), ["Q1", "Q2", "Q3"]);
  assert.deepEqual(values("re"), ["reopen "]);
});

test("after a verb only the questions it applies to are offered", () => {
  assert.deepEqual(values("answer "), ["answer Q1 "]);
  assert.deepEqual(values("dismiss "), ["dismiss Q1", "dismiss Q2"]);
  assert.deepEqual(values("REOPEN q"), ["REOPEN Q2", "REOPEN Q3"]);
});

test("answer text and anything after a complete form is free text", () => {
  assert.equal(values("answer Q1 "), null);
  assert.equal(values("answer Q1 because"), null);
  assert.equal(values("dismiss Q1 "), null);
  assert.equal(values("Q1 "), null);
});

test("descriptions are single-line and free of control sequences", () => {
  const items = completeDecisionArguments("", QUESTIONS, plain)!;
  assert.equal(items.find((item) => item.label === "Q1")!.description, "[pending] Use a shared kit?");
  assert.equal(items.find((item) => item.label === "Q3")!.description, "[dismissed] Old[31m one");
});
