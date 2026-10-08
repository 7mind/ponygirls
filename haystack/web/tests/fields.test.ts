// Behavioral-Active-Blackbox-Atomic; specified field presentation contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectFields, parseFields, updateTypedField } from "../src/fields.ts";

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

test("field validation reports syntax errors, duplicate keys, and recovers for every JSON root type", () => {
  for (const raw of ['', '{"n":', '{"n":1,}', '{"n":1,"n":2}']) {
    const result = inspectFields(raw);
    assert.equal(result.fields, null);
    assert.match(result.error!, /^Invalid JSON: /);
  }
  for (const raw of ['{}', '[]', 'null', 'true', '42', '"text"', '{"skill":{"type":"md","content":"# Skill"}}']) {
    assert.equal(inspectFields(raw).error, null);
  }
});

test("typed edits preserve unrelated fields, exact numbers, unknown nodes, and arbitrary field names", () => {
  for (const name of ["skill", "", "__proto__", "a/b~c"]) {
    const raw = `{"n":9007199254740993,"d":0.1234567890123456789012345,"nested":{"n":1e1000},` +
      `"unknown":{"type":"md","content":"x","metadata":true},${JSON.stringify(name)}:{"type":"md","content":"old"}}`;
    const edited = updateTypedField(raw, name, { kind: "md", content: '# Updated\n```nix\n{ x = "🐎"; }\n```' });
    assert.match(edited, /9007199254740993/);
    assert.match(edited, /0\.1234567890123456789012345/);
    assert.match(edited, /1e1000/);
    const value = new Map(parseFields(edited).map((field) => [field.name, field.value]));
    assert.deepEqual(value.get(name), { kind: "md", content: '# Updated\n```nix\n{ x = "🐎"; }\n```' });
    assert.equal(value.get("unknown")!.kind, "json");
    assert.equal(Object.hasOwn(JSON.parse(edited), name), true);
  }
});

test("root typed content and code languages can be edited without changing their shape", () => {
  const code = updateTypedField('{"type":"code","language":"nix","content":"old"}', null,
    { kind: "code", language: "typescript", content: "const n: number = 7;" });
  assert.deepEqual(JSON.parse(code), { type: "code", language: "typescript", content: "const n: number = 7;" });
  const text = updateTypedField('{"literal":{"type":"text","content":"old"}}', "literal", { kind: "text", content: "**literal**\n🐎" });
  assert.deepEqual(parseFields(text)[0]!.value, { kind: "text", content: "**literal**\n🐎" });
  assert.throws(() => updateTypedField('{}', "missing", { kind: "md", content: "x" }), /existing typed field/);
  assert.throws(() => updateTypedField('{"type":"md","content":"x","name":"metadata"}', null, { kind: "md", content: "x" }), /existing typed field/);
  assert.throws(() => updateTypedField(code, null, { kind: "code", language: " ", content: "x" }), /language must not be empty/);
});
