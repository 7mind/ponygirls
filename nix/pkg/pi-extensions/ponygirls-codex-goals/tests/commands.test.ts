import assert from "node:assert/strict";
import test from "node:test";

import { parseGoalCommand } from "../src/commands.ts";

test("empty args show state", () => {
  assert.deepEqual(parseGoalCommand(""), { ok: true, value: { kind: "show" } });
  assert.deepEqual(parseGoalCommand("   "), { ok: true, value: { kind: "show" } });
});

test("bare create and -- delimiter for reserved words", () => {
  assert.deepEqual(parseGoalCommand("ship the thing"), {
    ok: true,
    value: { kind: "create", objective: "ship the thing", tokenBudget: null },
  });
  assert.deepEqual(parseGoalCommand("-- pause the world"), {
    ok: true,
    value: { kind: "create", objective: "pause the world", tokenBudget: null },
  });
  const reserved = parseGoalCommand("pause");
  // bare "pause" is the subcommand, not an objective
  assert.deepEqual(reserved, { ok: true, value: { kind: "pause" } });
  const asObjective = parseGoalCommand("-- pause");
  assert.deepEqual(asObjective, { ok: true, value: { kind: "create", objective: "pause", tokenBudget: null } });
});

test("token budget create syntax", () => {
  assert.deepEqual(parseGoalCommand("--tokens 40000 -- ship it"), {
    ok: true,
    value: { kind: "create", objective: "ship it", tokenBudget: 40000 },
  });
  assert.equal(parseGoalCommand("--tokens 0 -- x").ok, false);
  assert.equal(parseGoalCommand("--tokens 10 x").ok, false);
});

test("edit forms", () => {
  assert.deepEqual(parseGoalCommand("edit"), { ok: true, value: { kind: "edit", objective: null } });
  assert.deepEqual(parseGoalCommand("edit new objective"), {
    ok: true,
    value: { kind: "edit", objective: "new objective" },
  });
  assert.deepEqual(parseGoalCommand("edit -- pause"), {
    ok: true,
    value: { kind: "edit", objective: "pause" },
  });
});

test("pause/resume/clear", () => {
  assert.deepEqual(parseGoalCommand("pause"), { ok: true, value: { kind: "pause" } });
  assert.deepEqual(parseGoalCommand("resume"), { ok: true, value: { kind: "resume", tokenBudget: undefined } });
  assert.deepEqual(parseGoalCommand("resume --tokens 80000"), {
    ok: true,
    value: { kind: "resume", tokenBudget: 80000 },
  });
  assert.deepEqual(parseGoalCommand("clear"), { ok: true, value: { kind: "clear" } });
  assert.equal(parseGoalCommand("resume --tokens x").ok, false);
  assert.equal(parseGoalCommand("pause now").ok, false);
});
