// Behavioral-Active-Blackbox-Atomic; specified field presentation contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFields } from "../src/fields.ts";

test("literal scalar fields retain JSON types and exact numeric text", () => {
  const fields = parseFields('{"text":"**literal**\\n🐎","number":9007199254740993,"decimal":0.12345678901234567890123456789,"exponent":1e1000,"enabled":true,"empty":null}');
  const values = new Map(fields.map((field) => [field.name, field.value]));
  assert.deepEqual(values.get("text"), { kind: "string", text: "**literal**\n🐎" });
  assert.deepEqual(values.get("number"), { kind: "number", text: "9007199254740993" });
  assert.deepEqual(values.get("decimal"), { kind: "number", text: "0.12345678901234567890123456789" });
  assert.deepEqual(values.get("exponent"), { kind: "number", text: "1e1000" });
  assert.deepEqual(values.get("enabled"), { kind: "boolean", value: true });
  assert.deepEqual(values.get("empty"), { kind: "null" });
});

test("objects and arrays are pretty-printed without rounding nested numbers", () => {
  const fields = parseFields('{"object":{"n":9007199254740993,"d":0.1234567890123456789},"array":[1e1000,"🐎",null]}');
  const object = fields[0]!.value;
  assert.equal(object.kind, "json");
  if (object.kind !== "json") throw new Error("Expected JSON field");
  assert.equal(object.jsonType, "object");
  assert.equal(object.text, '{\n  "n": 9007199254740993,\n  "d": 0.1234567890123456789\n}');
  const array = fields[1]!.value;
  assert.equal(array.kind, "json");
  if (array.kind !== "json") throw new Error("Expected JSON field");
  assert.equal(array.jsonType, "array");
  assert.equal(array.text, '[\n  1e1000,\n  "🐎",\n  null\n]');
});

test("typed Markdown, code, and literal text carry complete content", () => {
  const fields = parseFields('{"skill":{"type":"md","content":"# Skill\\n```bash\\necho ok\\n```"},"snippet":{"type":"code","language":"nix","content":"{ enabled = true; }"},"literal":{"type":"text","content":"**plain**"}}');
  assert.deepEqual(fields.map((field) => field.value), [
    { kind: "md", content: "# Skill\n```bash\necho ok\n```" },
    { kind: "code", language: "nix", content: "{ enabled = true; }" },
    { kind: "text", content: "**plain**" },
  ]);
});

test("unsupported, malformed, or extended typed nodes preserve all data as JSON", () => {
  for (const raw of ['{"type":"html","content":"<b>x</b>"}', '{"type":"md","content":42}',
    '{"type":"md","content":"# skill","name":"preserved metadata"}', '{"type":"code","content":"x","language":""}']) {
    const field = parseFields(`{"node":${raw}}`)[0]!.value;
    assert.equal(field.kind, "json");
    if (field.kind !== "json") throw new Error("Expected complete JSON field");
    assert.notEqual(field.notice, null);
    assert.deepEqual(JSON.parse(field.text), JSON.parse(raw));
  }
});

test("root arrays, scalars, typed nodes, empty objects, and empty property names remain supported", () => {
  assert.equal(parseFields("[1,null]")[0]!.value.kind, "json");
  assert.deepEqual(parseFields('"root string"'), [{ name: null, value: { kind: "string", text: "root string" } }]);
  assert.deepEqual(parseFields("42"), [{ name: null, value: { kind: "number", text: "42" } }]);
  assert.deepEqual(parseFields("null"), [{ name: null, value: { kind: "null" } }]);
  assert.deepEqual(parseFields('{"type":"md","content":"# root"}'), [{ name: null, value: { kind: "md", content: "# root" } }]);
  assert.deepEqual(parseFields("{}"), []);
  assert.equal(parseFields('{"":"empty name"}')[0]!.name, "");
});
