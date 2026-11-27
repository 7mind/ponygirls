import assert from "node:assert/strict";
import test from "node:test";
import { displayJson, displayLine, displayText } from "../src/display.ts";
import { HIDDEN } from "./fixtures.ts";

test("ordinary text, line feeds and non-ASCII letters pass unchanged", () => {
  const text = "Create an issue.\nЗаголовок — 標題 → ✓ café naïve";
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
  assert.equal(displayText("\u2066isolated\u2069\u061c\u200e\u200f"), "\\u2066isolated\\u2069\\u061c\\u200e\\u200f");
});

test("text a terminal draws as nothing is shown: Unicode tags, zero-width characters, selectors, fillers", () => {
  // Tag characters spell text a model reads and a person does not see.
  const smuggled = [..."ignore"].map((letter) => String.fromCodePoint(0xe0000 + letter.codePointAt(0)!)).join("");
  assert.equal(displayText(`Lists files.${smuggled}`), "Lists files.\\u{e0069}\\u{e0067}\\u{e006e}\\u{e006f}\\u{e0072}\\u{e0065}");
  assert.equal(displayText("zero\u200bwidth\u200cnon\u2060joiner"), "zero\\u200bwidth\\u200cnon\\u2060joiner");
  assert.equal(displayText("soft\u00adhyphen"), "soft\\u00adhyphen");
  assert.equal(displayText("selector\ufe00 and\u{e0100}"), "selector\\ufe00 and\\u{e0100}");
  assert.equal(displayText("filler\u3164\u115f"), "filler\\u3164\\u115f");
  assert.equal(displayText("annotated\ufff9"), "annotated\\ufff9");
  assert.equal(displayText("lone\ud800surrogate"), "lone\\ud800surrogate");
});

test("emoji keep the joiners and selectors they are built with", () => {
  for (const emoji of ["⚠️", "✔️", "👨‍👩‍👧", "🏳️‍🌈", "👍🏽", "1️⃣", "❤︎", "🧑🏿‍🚀"]) {
    assert.equal(displayText(`ok ${emoji} done`), `ok ${emoji} done`, emoji);
  }
});

test("a joiner or selector that builds no emoji is shown like any other invisible character", () => {
  assert.equal(displayText("a\u200db"), "a\\u200db");
  assert.equal(displayText("a\ufe0f"), "a\\ufe0f");
  assert.equal(displayText("\ufe0fstart"), "\\ufe0fstart");
  assert.equal(displayText("👍\u200d"), "👍\\u200d", "a joiner needs a pictograph on both sides");
  assert.equal(displayText("⚠\ufe0f\ufe0f"), "⚠\ufe0f\\ufe0f", "one selector per character");
});

test("carriage returns end lines and tabs become spaces", () => {
  assert.equal(displayText("one\r\ntwo\rthree"), "one\ntwo\nthree");
  assert.equal(displayText("a\tb"), "a    b");
});

test("nothing hidden or terminal-active survives, whatever the input", () => {
  let hostile = "";
  for (let code = 0; code < 0x100; code++) hostile += String.fromCharCode(code);
  hostile += "\u061c\u200b\u200c\u200d\u200e\u200f\u2028\u2029\u202a\u202b\u202c\u202d\u202e\u2060\u2061\u2066\u2067\u2068\u2069\ufe00\ufe0f\ufeff\ufff9\ufffa\ufffb";
  hostile += "\u{e0001}\u{e0020}\u{e007f}\u{e0100}\u{e01ef}\u{1d173}\ud800\udfff";
  assert.doesNotMatch(displayText(hostile), HIDDEN);
  assert.doesNotMatch(displayLine(hostile), HIDDEN);
  assert.doesNotMatch(displayJson(JSON.stringify(hostile)), HIDDEN);
});

test("a display line holds a whole text on one line", () => {
  assert.equal(displayLine("  Create an issue.\n\n  Needs `title`.\t "), "Create an issue. Needs `title`.");
  assert.doesNotMatch(displayLine("a\nb\rc"), /\n/);
});

test("JSON stays valid JSON for the same value: every escape is one JSON accepts", () => {
  const value = { name: "evil\u001b[2J", description: "tags\u{e0041}\u{e0042} bidi\u202e zero\u200b lone\ud800", "key\u200b": ["\ufeff"] };
  const shown = displayJson(JSON.stringify(value, null, 2));
  assert.doesNotMatch(shown, HIDDEN);
  assert.deepEqual(JSON.parse(shown), value);
  assert.ok(shown.includes('"description": "tags\\udb40\\udc41\\udb40\\udc42 bidi\\u202e zero\\u200b lone\\ud800"'), shown);
  assert.ok(shown.includes('"key\\u200b": ['), shown);
});

test("JSON keeps its line structure and its emoji", () => {
  const json = JSON.stringify({ a: "ok ⚠️ 👨‍👩‍👧", b: 1 }, null, 2);
  assert.equal(displayJson(json), json);
});
