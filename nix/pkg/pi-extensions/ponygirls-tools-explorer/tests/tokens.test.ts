import assert from "node:assert/strict";
import test from "node:test";
import { CHARS_PER_TOKEN, declarationTokens, estimateTokens, promptLineText, promptLineTokens } from "../src/tokens.ts";

test("an estimate is the character count over four, rounded up", () => {
  assert.equal(CHARS_PER_TOKEN, 4);
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("a"), 1);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});

test("a declaration is measured as the JSON pi puts in a system message", () => {
  const declaration = { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } };
  const json = '[{"name":"read","description":"Read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}}}}]';
  assert.equal(declarationTokens(declaration), Math.ceil(json.length / 4));
});

test("fields that are not part of the declaration do not count", () => {
  const declaration = { name: "read", description: "Read a file", parameters: { type: "object" } };
  assert.equal(declarationTokens({ ...declaration, exposure: "deferred", provenance: { path: "/somewhere/long" } } as typeof declaration), declarationTokens(declaration));
});

test("prompt lines are the tool-list entry and one bullet per rule", () => {
  const lines = { snippet: "Read file contents", guidelines: ["Use read instead of cat.", "Never read binaries."] };
  assert.equal(promptLineText("read", lines), "- read: Read file contents\n- Use read instead of cat.\n- Never read binaries.\n");
  assert.equal(promptLineTokens("read", lines), Math.ceil(promptLineText("read", lines).length / 4));
});

test("a tool without prompt lines adds nothing to the prompt", () => {
  assert.equal(promptLineText("read", { snippet: null, guidelines: [] }), "");
  assert.equal(promptLineTokens("read", { snippet: null, guidelines: [] }), 0);
});
