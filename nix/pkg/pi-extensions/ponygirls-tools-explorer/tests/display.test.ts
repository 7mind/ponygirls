import assert from "node:assert/strict";
import test from "node:test";
import { displayLine, displayText } from "../src/display.ts";

/** Anything that could act on the terminal or reorder the text it prints. */
const TERMINAL_ACTIVE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069\ufeff]/;

test("ordinary text, line feeds and non-ASCII letters pass unchanged", () => {
  const text = "Create an issue.\nЗаголовок — 標題 → ✓";
  assert.equal(displayText(text), text);
});

test("escape sequences become visible text instead of reaching the terminal", () => {
  assert.equal(displayText("a\u001b[31mred\u001b[0m"), "a\\u001b[31mred\\u001b[0m");
  assert.equal(displayText("\u001b]0;title\u0007"), "\\u001b]0;title\\u0007");
  assert.equal(displayText("\u009b31m"), "\\u009b31m");
});

test("bidi controls and invisible separators are shown, not obeyed", () => {
  assert.equal(displayText("safe\u202egnp.exe"), "safe\\u202egnp.exe");
  assert.equal(displayText("a\u2028b\u2029c\ufeff"), "a\\u2028b\\u2029c\\ufeff");
});

test("carriage returns end lines and tabs become spaces", () => {
  assert.equal(displayText("one\r\ntwo\rthree"), "one\ntwo\nthree");
  assert.equal(displayText("a\tb"), "a    b");
});

test("no terminal-active character survives, whatever the input", () => {
  let hostile = "";
  for (let code = 0; code < 0x100; code++) hostile += String.fromCharCode(code);
  hostile += "\u061c\u200e\u200f\u2028\u2029\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\ufeff";
  assert.doesNotMatch(displayText(hostile), TERMINAL_ACTIVE);
  assert.doesNotMatch(displayLine(hostile), TERMINAL_ACTIVE);
});

test("a display line holds a whole text on one line", () => {
  assert.equal(displayLine("  Create an issue.\n\n  Needs `title`.\t "), "Create an issue. Needs `title`.");
  assert.doesNotMatch(displayLine("a\nb\rc"), /\n/);
});
