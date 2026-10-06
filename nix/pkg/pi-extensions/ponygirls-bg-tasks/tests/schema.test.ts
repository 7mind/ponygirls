/** The bg_task parameter schema as providers receive it. */
import assert from "node:assert/strict";
import test from "node:test";
import { BgTaskParamsSchema } from "../src/protocol.ts";

test("every bg_task parameter is a top-level primitive; no nested object for a model to serialize as a string", () => {
  const schema = JSON.parse(JSON.stringify(BgTaskParamsSchema)) as { type: string; properties: Record<string, Record<string, unknown>>; required: string[] };
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["action"]);
  const primitive = (s: Record<string, unknown>): boolean =>
    s.type === "string" || s.type === "integer" || s.type === "boolean" || s.type === "null" || Array.isArray(s.enum)
    || (Array.isArray(s.anyOf) && (s.anyOf as Record<string, unknown>[]).every(primitive));
  for (const [name, property] of Object.entries(schema.properties)) assert.ok(primitive(property), `${name} is not a primitive: ${JSON.stringify(property)}`);
});
