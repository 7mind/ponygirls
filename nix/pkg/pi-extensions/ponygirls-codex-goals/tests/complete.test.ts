import assert from "node:assert/strict";
import { test } from "node:test";
import { completeGoalArguments } from "../src/complete.ts";
import { parseGoalCommand } from "../src/commands.ts";

const values = (prefix: string): string[] | null => completeGoalArguments(prefix)?.map((item) => item.value) ?? null;

test("/goal lists its subcommands and option forms", () => {
  assert.deepEqual(values(""), ["edit ", "pause", "resume ", "clear", "--tokens ", "-- "]);
  assert.deepEqual(values("re"), ["resume "]);
  assert.deepEqual(values("P"), ["pause"]);
});

test("/goal resume offers --tokens; /goal --tokens N offers -- and resume", () => {
  assert.deepEqual(values("resume "), ["resume --tokens "]);
  assert.equal(values("--tokens "), null);
  assert.deepEqual(values("--tokens 40000 "), ["--tokens 40000 -- ", "--tokens 40000 resume"]);
  assert.equal(values("--tokens nope "), null);
});

test("budget continuations use the parser's positive safe-integer domain", () => {
  for (const budget of ["040000", "9007199254740991", "4e4", "0x10"]) {
    assert.equal(parseGoalCommand(`--tokens ${budget} resume`).ok, true);
    assert.deepEqual(values(`--tokens ${budget} `), [`--tokens ${budget} -- `, `--tokens ${budget} resume`]);
  }
  for (const budget of ["9007199254740992", "1e100", "0", "-1", "1.5", "nope"]) {
    assert.equal(parseGoalCommand(`--tokens ${budget} resume`).ok, false);
    assert.equal(values(`--tokens ${budget} `), null);
  }
});

test("objectives, edits and completed forms get no suggestions", () => {
  for (const prefix of ["Polish the ", "edit ", "edit new obj", "pause ", "clear ", "-- obj", "resume --tokens ", "--tokens 40000 -- x"]) {
    assert.equal(values(prefix), null, prefix);
  }
});

test("every completion the menu inserts parses (or awaits only free text)", () => {
  const complete = ["pause", "clear", "--tokens 40000 resume", "resume "];
  for (const text of complete) assert.equal(parseGoalCommand(text).ok, true, text);
});
