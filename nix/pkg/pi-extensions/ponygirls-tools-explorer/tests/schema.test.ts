import assert from "node:assert/strict";
import test from "node:test";
import type { JsonSchema } from "../src/registry.ts";
import { MAX_OUTLINE_ROWS, MAX_OUTLINE_SHAPES, describeType, outlineParameters } from "../src/schema.ts";

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
    total: 3,
    required: 1,
  });
});

test("an object without properties has no parameters", () => {
  assert.deepEqual(outlineParameters({ type: "object", properties: {} }), { kind: "none" });
  assert.deepEqual(outlineParameters({ type: "object" }), { kind: "none" });
  assert.deepEqual(outlineParameters({ type: "object", properties: {}, additionalProperties: false }), { kind: "none" });
  assert.deepEqual(outlineParameters({ type: "object", additionalProperties: true }), { kind: "none" });
  assert.deepEqual(outlineParameters({ type: "object", additionalProperties: {} }), { kind: "none" }, "an empty schema allows what the default allows");
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
      { label: 'action "list"', total: 2, required: 1, rows: [
        { name: "action", required: true, type: '"list"', description: null },
        { name: "limit", required: false, type: "integer", description: null },
      ] },
      { label: 'action "read"', total: 3, required: 2, rows: [
        { name: "action", required: true, type: '"read"', description: null },
        { name: "id", required: true, type: "string", description: null },
        { name: "limit", required: false, type: "integer", description: null },
      ] },
      { label: "shape 3", total: 1, required: 0, rows: [{ name: "query", required: false, type: "string", description: null }] },
    ],
    total: 3,
    parameters: 4,
  });
  assert.equal(outline.kind === "union" && outline.parameters, 4, "action, limit, id and query, each counted once");
});

test("a schema the outline cannot express is reported as opaque, not as empty", () => {
  assert.deepEqual(outlineParameters({ type: "string" }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ anyOf: [{ type: "object", properties: {} }, { type: "string" }] }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ allOf: [{ type: "object", properties: { a: { type: "string" } } }], type: "object" }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ $ref: "#/$defs/Missing" }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ $ref: "https://example.com/schema.json" }), { kind: "opaque" });
});

test("parameters of its own beside a union are more than the outline can show: opaque, not half of them", () => {
  const shapes = [
    { type: "object", properties: { issue: { type: "number" } }, required: ["issue"] },
    { type: "object", properties: { pr: { type: "number" } }, required: ["pr"] },
  ];
  assert.deepEqual(outlineParameters({ type: "object", properties: { repo: { type: "string" } }, required: ["repo"], oneOf: shapes }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ type: "object", required: ["repo"], anyOf: shapes }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ allOf: [{ type: "object", properties: { repo: { type: "string" } } }], anyOf: shapes }), { kind: "opaque" });
  assert.equal(outlineParameters({ type: "object", properties: {}, required: [], oneOf: shapes }).kind, "union", "empty keywords add nothing");
});

test("two unions at once, or a reference with constraints beside it, are opaque", () => {
  const a = { type: "object", properties: { a: { type: "string" } } };
  const b = { type: "object", properties: { b: { type: "string" } } };
  assert.deepEqual(outlineParameters({ anyOf: [a], oneOf: [b] }), { kind: "opaque" });
  const defs = { $defs: { A: a } };
  assert.equal(outlineParameters({ $ref: "#/$defs/A", ...defs }).kind, "object");
  assert.equal(outlineParameters({ $ref: "#/$defs/A", title: "Args", description: "The arguments", $schema: "https://json-schema.org/draft/2020-12/schema", ...defs }).kind, "object", "annotations constrain nothing");
  assert.deepEqual(outlineParameters({ $ref: "#/$defs/A", required: ["a"], ...defs }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ $ref: "#/$defs/A", properties: { c: { type: "string" } }, ...defs }), { kind: "opaque" });
  assert.equal(outlineParameters({ anyOf: [{ $ref: "#/$defs/A" }, b], ...defs }).kind, "union");
  assert.deepEqual(outlineParameters({ anyOf: [{ $ref: "#/$defs/A", required: ["a"] }, b], ...defs }), { kind: "opaque" });
});

test("a shape that is itself a combination is opaque", () => {
  const plain = { type: "object", properties: { a: { type: "string" } } };
  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    const combined = { type: "object", properties: { b: { type: "string" } }, [keyword]: [{ type: "object", properties: { c: { type: "string" } } }] };
    assert.deepEqual(outlineParameters({ anyOf: [plain, combined] }), { kind: "opaque" }, keyword);
  }
});

test("an object that takes parameters by pattern or of any name does not read as taking none", () => {
  assert.deepEqual(outlineParameters({ type: "object", additionalProperties: { type: "string" } }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ type: "object", patternProperties: { "^x-": { type: "string" } } }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ type: "object", properties: { a: { type: "string" } }, additionalProperties: { type: "number" } }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ anyOf: [{ type: "object", properties: { a: { type: "string" } }, patternProperties: { "^x-": {} } }] }), { kind: "opaque" });
  assert.equal(outlineParameters({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false }).kind, "object");
});

test("conditions between parameters are more than a list of rows can say", () => {
  const base = { type: "object", properties: { a: { type: "string" }, b: { type: "string" } } };
  const conditional: Record<string, unknown>[] = [
    { not: { required: ["a", "b"] } },
    { if: { required: ["a"] }, then: { required: ["b"] } },
    { then: { required: ["b"] } },
    { else: { required: ["b"] } },
    { dependentRequired: { a: ["b"] } },
    { dependentSchemas: { a: { properties: { c: { type: "string" } } } } },
    { dependencies: { a: ["b"] } },
    { propertyNames: { pattern: "^[a-z]+$" } },
    { unevaluatedProperties: { type: "string" } },
    { $dynamicRef: "#meta" },
    { $recursiveRef: "#" },
  ];
  for (const keywords of conditional) {
    assert.deepEqual(outlineParameters({ ...base, ...keywords }), { kind: "opaque" }, JSON.stringify(keywords));
    assert.deepEqual(outlineParameters({ anyOf: [{ ...base, ...keywords }] }), { kind: "opaque" }, `as a shape: ${JSON.stringify(keywords)}`);
  }
  // What only narrows values, closes the object or annotates it leaves the list of parameters as it is.
  const harmless = [
    { unevaluatedProperties: false }, { additionalProperties: false }, { minProperties: 1 }, { title: "Args" },
    { $schema: "https://json-schema.org/draft/2020-12/schema" }, { "x-vendor": true }, { if: { required: ["a"] } },
  ];
  for (const keywords of harmless) {
    assert.equal(outlineParameters({ ...base, ...keywords }).kind, "object", JSON.stringify(keywords));
  }
});

test("a malformed union is opaque", () => {
  for (const anyOf of [[], "x", [1, 2], [{ type: "object" }, null], {}]) assert.deepEqual(outlineParameters({ anyOf }), { kind: "opaque" }, JSON.stringify(anyOf));
  assert.deepEqual(outlineParameters({ $ref: 7 }), { kind: "opaque" });
  const b = { type: "object", properties: { b: {} } };
  assert.deepEqual(outlineParameters({ $ref: "#/$defs/A", $defs: { A: { $ref: "#/$defs/B" }, B: b } }), { kind: "opaque" }, "a reference to a reference is not followed");
  assert.deepEqual(outlineParameters({ $ref: "#/$defs/A", $defs: { A: { $ref: "#/$defs/B", type: "object" }, B: b } }), { kind: "opaque" },
    "nor read as an object without parameters");
  assert.deepEqual(outlineParameters({ anyOf: [{ $ref: "#/$defs/A" }], $defs: { A: { $ref: "#/$defs/B", type: "object" }, B: b } }), { kind: "opaque" });
});

test("a reference with a union beside it, at the root or behind a reference, is opaque", () => {
  const a = { type: "object", properties: { a: { type: "string" } } };
  const b = { type: "object", properties: { b: { type: "string" } } };
  assert.deepEqual(outlineParameters({ $ref: "#/$defs/A", anyOf: [b], $defs: { A: a } }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ $ref: "#/$defs/A", allOf: [b], $defs: { A: a } }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ $ref: "#/$defs/A", additionalProperties: { type: "string" }, $defs: { A: a } }), { kind: "opaque" });
  assert.deepEqual(outlineParameters({ $ref: "#/$defs/U", $defs: { U: { $ref: "#/$defs/A", anyOf: [b] }, A: a } }), { kind: "opaque" });
  assert.equal(outlineParameters({ $ref: "#/$defs/U", $defs: { U: { anyOf: [a, b] } } }).kind, "union", "a reference to a union is the union");
});

test("a very large object is outlined by its first rows, with its real totals", () => {
  const names = Array.from({ length: 5000 }, (_unused, index) => `p${index}`);
  const outline = outlineParameters({ type: "object", properties: Object.fromEntries(names.map((name) => [name, { type: "string" }])), required: names.slice(0, 4000) });
  assert.equal(outline.kind, "object");
  assert.ok(outline.kind === "object");
  assert.equal(MAX_OUTLINE_ROWS, 120);
  assert.deepEqual([outline.rows.length, outline.total, outline.required], [120, 5000, 4000]);
  assert.deepEqual(outline.rows.slice(0, 2).map((row) => row.name), ["p0", "p1"], "the first properties, in declaration order");
  assert.equal(outline.rows.every((row) => row.required), true);
});

test("a union that repeats one large shape thousands of times stays small", () => {
  // 140 kB of schema that an uncapped outline expands to nine million rows.
  const properties = Object.fromEntries(Array.from({ length: 3000 }, (_unused, index) => [`p${index}`, { type: "string" }]));
  const hostile = { anyOf: Array.from({ length: 3000 }, () => ({ $ref: "#/$defs/A" })), $defs: { A: { type: "object", properties, required: ["p0"] } } };
  const outline = outlineParameters(hostile);
  assert.ok(outline.kind === "union");
  assert.deepEqual([outline.shapes.length, outline.total], [1, 3000], "the first shape uses up the rows of the outline");
  assert.equal(outline.parameters, 3000, "the distinct names of the shape shown, cut rows included");
  assert.deepEqual([outline.shapes[0]!.label, outline.shapes[0]!.rows.length, outline.shapes[0]!.total, outline.shapes[0]!.required], ["shape 1", 120, 3000, 1]);
});

test("the shapes of a union share the rows of one outline; the shape that uses them up is cut", () => {
  const shape = (prefix: string, count: number) => ({ type: "object", properties: Object.fromEntries(Array.from({ length: count }, (_unused, index) => [`${prefix}${index}`, { type: "string" }])) });
  const outline = outlineParameters({ anyOf: [shape("a", 50), shape("b", 50), shape("c", 50), shape("d", 50), shape("e", 50)] });
  assert.ok(outline.kind === "union");
  assert.deepEqual(outline.shapes.map((shown) => [shown.label, shown.rows.length, shown.total]), [["shape 1", 50, 50], ["shape 2", 50, 50], ["shape 3", 20, 50]]);
  assert.equal(outline.total, 5);
  assert.equal(outline.shapes[2]!.rows[19]!.name, "c19");
});

test("a union of many small shapes shows the first two dozen", () => {
  const outline = outlineParameters({ oneOf: Array.from({ length: 40 }, (_unused, index) => ({ type: "object", properties: { kind: { const: `k${index}` }, value: { type: "string" } } })) });
  assert.ok(outline.kind === "union");
  assert.equal(MAX_OUTLINE_SHAPES, 24);
  assert.deepEqual([outline.shapes.length, outline.total, outline.parameters], [24, 40, 2]);
  assert.deepEqual([outline.shapes[0]!.label, outline.shapes[23]!.label], ['kind "k0"', 'kind "k23"']);
});

test("a shape that is not an object anywhere in a long union makes it opaque, shown or not", () => {
  const variants: unknown[] = Array.from({ length: 100 }, () => ({ type: "object", properties: { a: { type: "string" } } }));
  variants[99] = { type: "string" };
  assert.deepEqual(outlineParameters({ anyOf: variants }), { kind: "opaque" });
});

test("a root reference into the schema's own definitions is followed", () => {
  const schema: JsonSchema = { $ref: "#/$defs/Args", $defs: { Args: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } } };
  assert.deepEqual(outlineParameters(schema), { kind: "object", rows: [{ name: "q", required: true, type: "string", description: null }], total: 1, required: 1 });
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
  assert.equal(typeOf({ anyOf: Array.from({ length: 20 }, (_unused, index) => ({ const: `k${index}` })) }), '"k0" | "k1" | "k2" | "k3" | "k4" | "k5" | … +14');
  assert.equal(typeOf({ oneOf: Array.from({ length: 7 }, () => ({ type: "string" })) }), "string | … +1", "the alternatives beyond the sixth are counted, not read");
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
  assert.deepEqual(outline, { kind: "object", total: 2, required: 0, rows: [
    { name: "a", required: false, type: "string", description: null },
    { name: "b", required: false, type: "any", description: null },
  ] });
});

test("required names that are no property are not counted", () => {
  const outline = outlineParameters({ type: "object", properties: { a: { type: "string" } }, required: ["a", "ghost", 7] });
  assert.ok(outline.kind === "object");
  assert.deepEqual([outline.total, outline.required], [1, 1]);
});
