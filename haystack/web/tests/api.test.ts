// Behavioral-Active-Blackbox-Atomic; regression: UUIDv7 must carry Unix time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDocumentJson, parseTagsInput, uuidv7 } from "../src/api.ts";

test("UUIDv7 carries its creation timestamp, version, and variant", () => {
  const before = Date.now();
  const id = uuidv7();
  const after = Date.now();
  const timestamp = Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
  assert.ok(timestamp >= before && timestamp <= after, `timestamp ${timestamp} is outside ${before}..${after}`);
  assert.equal(id[14], "7");
  assert.match(id[19]!, /[89ab]/);
});

test("parseTagsInput splits on commas and trims", () => {
  assert.deepEqual(parseTagsInput(""), []);
  assert.deepEqual(parseTagsInput("mcp, urgent "), ["mcp", "urgent"]);
  assert.deepEqual(parseTagsInput("a,, b , ,c"), ["a", "b", "c"]);
  assert.deepEqual(parseTagsInput("Machine Learning, mcp"), ["Machine Learning", "mcp"]);
});

test("buildDocumentJson carries tags verbatim", () => {
  const json = buildDocumentJson({
    title: "t",
    description: "d",
    fieldsRaw: '{"n":9007199254740993}',
    type: "fact",
    status: "actual",
    importance: "low",
    attention: "cleared",
    links: [],
    tags: ["mcp", "Machine Learning"],
  });
  assert.ok(json.includes('"tags":["mcp","Machine Learning"]'));
  assert.ok(json.includes("9007199254740993"));
  const omitted = buildDocumentJson({
    title: "t",
    description: "d",
    fieldsRaw: "{}",
    type: "fact",
    status: "actual",
    importance: "low",
    attention: "cleared",
    links: [],
  });
  assert.ok(omitted.includes('"tags":[]'));
});
