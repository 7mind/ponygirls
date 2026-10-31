import assert from "node:assert/strict";
import { test } from "node:test";
import { completeArgument, type ArgumentChoice } from "../src/index.ts";

const choice = (token: string, continues: boolean): ArgumentChoice => ({ token, label: token, description: `${token} help`, continues });
const grammar = (previous: readonly string[]): readonly ArgumentChoice[] | null => {
  if (previous.length === 0) return [choice("pause", false), choice("resume", true), choice("edit", true)];
  if (previous.length === 1 && previous[0] === "resume") return [choice("--tokens", true)];
  return null;
};

test("an empty argument lists every first-position choice; values keep pi's whole-argument replacement", () => {
  assert.deepEqual(completeArgument("", grammar)!.map((item) => item.value), ["pause", "resume ", "edit "]);
});

test("the partial last token filters case-insensitively by prefix", () => {
  assert.deepEqual(completeArgument("RE", grammar), [{ value: "resume ", label: "resume", description: "resume help" }]);
  assert.equal(completeArgument("zzz", grammar), null);
});

test("later positions repeat the typed head, including its spacing", () => {
  assert.deepEqual(completeArgument("resume ", grammar)!.map((item) => item.value), ["resume --tokens "]);
  assert.deepEqual(completeArgument("  resume  --t", grammar)!.map((item) => item.value), ["  resume  --tokens "]);
});

test("free-text positions return null", () => {
  assert.equal(completeArgument("edit some objec", grammar), null);
  assert.equal(completeArgument("pause ", grammar), null);
});
