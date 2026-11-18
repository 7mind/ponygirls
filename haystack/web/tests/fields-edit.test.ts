// Typed field rows of the record editor: exact numbers, arbitrary names, per-row problems (spec §3.2 Edit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { changedFields, editingOf, retype, serializeRows, type FieldRow, type RowValue } from "../src/fields-edit.ts";

let ids = 0;
const nextId = () => ++ids;
const rowsOf = (raw: string): FieldRow[] => {
  const editing = editingOf(raw, nextId);
  assert.ok(editing !== null && editing.shape === "rows");
  return editing.rows;
};
const row = (name: string, value: RowValue): FieldRow => ({ id: nextId(), name, value });

test("rows serialize with exact numbers and arbitrary names; every kind round-trips", () => {
  const raw = '{"count":9007199254740993,"precision":0.12345678901234567890123456789,"__proto__":{"type":"text","content":"p"},' +
    '"a/b~c":"s","on":true,"none":null,"list":["x",1e1000],"doc":{"type":"md","content":"# T"},"unit":{"type":"code","language":"nix","content":"{ }"}}';
  const rows = rowsOf(raw);
  assert.deepEqual(rows.map((entry) => [entry.name, entry.value.kind]), [["count", "number"], ["precision", "number"], ["__proto__", "text"],
    ["a/b~c", "string"], ["on", "boolean"], ["none", "null"], ["list", "json"], ["doc", "md"], ["unit", "code"]]);
  const edited = rows.map((entry) => entry.name === "doc" ? { ...entry, value: { kind: "md", content: "# Edited\n\n`x`" } as RowValue } : entry);
  const result = serializeRows([...edited, row("added", { kind: "json", text: '{"n": 9007199254740993}' })]);
  assert.ok(result.ok);
  assert.match(result.raw, /"count": 9007199254740993/);
  assert.match(result.raw, /"precision": 0\.12345678901234567890123456789/);
  assert.match(result.raw, /1e1000/);
  assert.match(result.raw, /"n": 9007199254740993/);
  const again = rowsOf(result.raw);
  assert.deepEqual(again.map((entry) => [entry.name, entry.value.kind]), [...rows.map((entry) => [entry.name, entry.value.kind]), ["added", "json"]]);
  assert.deepEqual(again.find((entry) => entry.name === "doc")!.value, { kind: "md", content: "# Edited\n\n`x`" });
  assert.deepEqual(again.find((entry) => entry.name === "added")!.value, { kind: "json", text: '{"n":9007199254740993}' });
  assert.equal(Object.hasOwn(JSON.parse(result.raw), "__proto__"), true);
  assert.equal(editingOf("[1,2]", nextId)?.shape, "raw-only");
  assert.equal(editingOf('{"type":"md","content":"root"}', nextId)?.shape, "root");
  assert.equal(editingOf('{"n":', nextId), null);
});

test("problems are reported per row and nothing is serialized: duplicate names, non-numbers, invalid JSON, a code field without language", () => {
  const rows = [row("n", { kind: "number", text: "1.5e3" }), row("n", { kind: "number", text: "twelve" }), row("list", { kind: "json", text: '["a" "b"]' }),
    row("unit", { kind: "code", language: " ", content: "x" }), row("ok", { kind: "string", text: "" })];
  const result = serializeRows(rows);
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.deepEqual(result.problems.map((problem) => [rows.findIndex((entry) => entry.id === problem.rowId), problem.message.replace(/:.*$/, "")]),
    [[0, "Another field has this name"], [1, "Another field has this name"], [1, "Not a JSON number"], [2, "Not valid JSON"], [3, "Choose a language"]]);
});

test("retyping keeps content where it can; changed fields are named by their names", () => {
  assert.deepEqual(retype({ kind: "md", content: "# T" }, "code"), { kind: "code", content: "# T", language: "bash" });
  assert.deepEqual(retype({ kind: "code", content: "x", language: "nix" }, "text"), { kind: "text", content: "x" });
  assert.deepEqual(retype({ kind: "string", text: "7" }, "number"), { kind: "number", text: "7" });
  assert.deepEqual(retype({ kind: "boolean", value: true }, "json"), { kind: "json", text: "true" });
  assert.deepEqual(retype({ kind: "string", text: "a\"b" }, "json"), { kind: "json", text: '"a\\"b"' });
  assert.deepEqual(retype({ kind: "md", content: "x" }, "json"), { kind: "json", text: '{\n  "type": "md",\n  "content": "x"\n}' });
  assert.deepEqual(retype({ kind: "json", text: "[1]" }, "string"), { kind: "string", text: "[1]" });
  const before = '{"a":1,"b":"x","c":{"type":"md","content":"c"},"gone":true}';
  assert.deepEqual(changedFields(before, before), []);
  assert.deepEqual(changedFields(before, '{"a":2,"b":"x","c":{"type":"md","content":"c"},"new":null}'), ["a", "gone", "new"]);
  assert.deepEqual(changedFields(before, '{"a":1,'), ["fields"]);
  assert.deepEqual(changedFields("[1]", "[2]"), ["fields"]);
});
