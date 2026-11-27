import assert from "node:assert/strict";
import test from "node:test";
import type { JsonSchema } from "../src/registry.ts";
import { describeType, outlineParameters, parameterCount } from "../src/schema.ts";

function typeOf(schema: unknown): string {
  return describeType(schema, {}, 0);
}

test("an object schema is outlined as one row per property, in declaration order", () => {
  const schema: JsonSchema = {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string", description: "File to read" },
      offset: { type: "number" },
      limit: { anyOf: [{ type: "number" }, { type: "null" }], description: "Line limit" },
    },
  };
  assert.deepEqual(outlineParameters(schema), {
    kind: "object",
    rows: [
      { name: "path", required: true, type: "string", description: "File to read" },
      { name: "offset", required: false, type: "number", description: null },
      { name: "limit", required: false, type: "number | null", description: "Line limit" },
    ],
  });
  assert.equal(parameterCount(outlineParameters(schema)), 3);
});

test("an object without properties has no parameters", () => {
  assert.deepEqual(outlineParameters({ type: "object", properties: {} }), { kind: "none" });
  assert.deepEqual(outlineParameters({ type: "object" }), { kind: "none" });
  assert.equal(parameterCount({ kind: "none" }), 0);
});

test("a union of object shapes is outlined shape by shape, labelled by what selects it", () => {
  const schema: JsonSchema = {
    anyOf: [
      { type: "object", required: ["action"], properties: { action: { type: "string", const: "list" }, limit: { type: "integer" } } },
      { type: "object", required: ["action", "id"], properties: { action: { type: "string", const: "read" }, id: { type: "string" }, limit: { type: "integer" } } },
      { type: "object", properties: { query: { type: "string" } } },
    ],
  };
  const outline = outlineParameters(schema);
  assert.deepEqual(outline, {
    kind: "union",
    shapes: [
      { label: 'action "list"', rows: [
        { name: "action", required: true, type: '"list"', description: null },
        { name: "limit", required: false, type: "integer", description: null },
      ] },
      { label: 'action "read"', rows: [
        { name: "action", required: true, type: '"read"', description: null },
        { name: "id", required: true, type: "string", description: null },
        { name: "limit", required: false, type: "integer", description: null },
      ] },
      { label: "shape 3", rows: [{ name: "query", required: false, type: "string", description: null }] },
    ],
  });
  assert.equal(parameterCount(outline), 4, "action, limit, id and query, each counted once");
});

test("a schema the outline cannot express is reported as opaque, not as empty", () => {
  assert.deepEqual(outlineParameters({ type: "string" }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ anyOf: [{ type: "object", properties: {} }, { type: "string" }] }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ allOf: [{ type: "object", properties: { a: { type: "string" } } }], type: "object" }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ $ref: "#/$defs/Missing" }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ $ref: "https://example.com/schema.json" }), { kind: "opaque" });
});

test("a root reference into the schema's own definitions is followed", () => {
  const schema: JsonSchema = { $ref: "#/$defs/Args", $defs: { Args: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } };
  assert.deepEqual(outlineParameters(schema), { kind: "object", rows: [{ name: "q", required: true, type: "string", description: null }] });
});

test("types read as short expressions", () => {
  assert.equal(typeOf({ type: "string" }), "string");
  assert.equal(typeOf({ type: "string", format: "date" }), "string (date)");
  assert.equal(typeOf({ type: ["string", "null"] }), "string | null");
  assert.equal(typeOf({ type: "array", items: { type: "string" } }), "string[]");
  assert.equal(typeOf({ type: "array" }), "any[]");
  assert.equal(typeOf({ type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } }), "(string | number)[]");
  assert.equal(typeOf({ type: "object" }), "object");
  assert.equal(typeOf({ type: "object", properties: { url: {}, title: {} } }), "{url, title}");
  assert.equal(typeOf({ type: "array", items: { type: "object", properties: { url: {}, title: {} } } }), "{url, title}[]");
  assert.equal(typeOf({ properties: { a: {}, b: {}, c: {}, d: {}, e: {}, f: {} } }), "{a, b, c, d, … +2}");
  assert.equal(typeOf({ const: "read" }), '"read"');
  assert.equal(typeOf({ type: "number", enum: [0, 1, 2] }), "0 | 1 | 2");
  assert.equal(typeOf({ enum: ["a", "b", "c", "d", "e", "f", "g", "h"] }), '"a" | "b" | "c" | "d" | "e" | "f" | … +2');
  assert.equal(typeOf({ anyOf: [{ const: "a", type: "string" }, { const: "b", type: "string" }] }), '"a" | "b"');
  assert.equal(typeOf({ oneOf: [{ type: "string" }, { type: "string" }, { type: "null" }] }), "string | null");
  assert.equal(typeOf({ allOf: [{ $ref: "#/$defs/A" }, { $ref: "#/$defs/B" }] }), "A & B");
  assert.equal(typeOf({ $ref: "#/$defs/FilterType" }), "FilterType");
  assert.equal(typeOf({}), "any");
  assert.equal(typeOf(true), "any");
  assert.equal(typeOf({ description: "anything goes" }), "any");
});

test("deeply nested types are cut instead of followed forever", () => {
  const nested = { type: "array", items: { type: "array", items: { type: "array", items: { type: "array", items: { type: "array", items: { type: "string" } } } } } };
  assert.equal(typeOf(nested), "…[][][][]");
});

test("property descriptions that are not text are left out", () => {
  const outline = outlineParameters({ type: "object", properties: { a: { type: "string", description: 7 }, b: true } });
  assert.deepEqual(outline, { kind: "object", rows: [
    { name: "a", required: false, type: "string", description: null },
    { name: "b", required: false, type: "any", description: null },
  ] });
});
