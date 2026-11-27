import assert from "node:assert/strict";
import test from "node:test";
import {
  MEASURED_BASES, PI_BASIS, PI_CHARS_PER_TOKEN, basisFor, declarationText, declarationTokens, estimateTokens, promptLineText, promptLineTokens,
  type TokenBasis,
} from "../src/tokens.ts";

const DECLARATION = { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } };
const LINES = { snippet: "Read file contents", guidelines: ["Use read instead of cat.", "Never read binaries."] };

test("an estimate is the character count over the ratio, rounded up", () => {
  assert.equal(estimateTokens("", 4), 0);
  assert.equal(estimateTokens("a", 4), 1);
  assert.equal(estimateTokens("abcd", 4), 1);
  assert.equal(estimateTokens("abcde", 4), 2);
  assert.equal(estimateTokens("a".repeat(27), 2.7), 10);
  assert.equal(estimateTokens("a".repeat(28), 2.7), 11);
});

test("pi's rule is four characters per token for declarations and prompt lines alike", () => {
  assert.equal(PI_CHARS_PER_TOKEN, 4);
  assert.deepEqual(PI_BASIS, { declaration: 4, promptLine: 4, source: "pi" });
});

test("measured API families use their ratios; every other one, and no model, falls back to pi's rule", () => {
  assert.deepEqual(basisFor("anthropic-messages"), { declaration: 2.7, promptLine: 3.1, source: "measured" });
  assert.deepEqual(basisFor("openai-codex-responses"), { declaration: 5.4, promptLine: 5, source: "measured" });
  assert.deepEqual(Object.keys(MEASURED_BASES).sort(), ["anthropic-messages", "openai-codex-responses"]);
  for (const api of ["openai-completions", "openai-responses", "google-generative-ai", "", "toString", "constructor"]) {
    assert.equal(basisFor(api), PI_BASIS, api);
  }
  assert.equal(basisFor(null), PI_BASIS);
});

test("a declaration is measured as the JSON pi puts in a system message", () => {
  const json = '[{"name":"read","description":"Read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}}}}]';
  assert.equal(declarationText(DECLARATION), json);
  assert.equal(declarationTokens(DECLARATION, PI_BASIS), Math.ceil(json.length / 4));
});

test("fields that are not part of the declaration do not count", () => {
  const extended = { ...DECLARATION, exposure: "deferred", provenance: { path: "/somewhere/long" } };
  assert.equal(declarationText(extended), declarationText(DECLARATION));
});

test("prompt lines are the tool-list entry and one bullet per rule", () => {
  assert.equal(promptLineText("read", LINES), "- read: Read file contents\n- Use read instead of cat.\n- Never read binaries.\n");
  assert.equal(promptLineTokens("read", LINES, PI_BASIS), Math.ceil(promptLineText("read", LINES).length / 4));
});

test("a tool without prompt lines adds nothing to the prompt", () => {
  assert.equal(promptLineText("read", { snippet: null, guidelines: [] }), "");
  assert.equal(promptLineTokens("read", { snippet: null, guidelines: [] }, PI_BASIS), 0);
});

test("declarations and prompt lines each use their own ratio of the basis", () => {
  const basis: TokenBasis = { declaration: 2, promptLine: 10, source: "measured" };
  assert.equal(declarationTokens(DECLARATION, basis), Math.ceil(declarationText(DECLARATION).length / 2));
  assert.equal(promptLineTokens("read", LINES, basis), Math.ceil(promptLineText("read", LINES).length / 10));
});

test("a denser tokenizer makes the same declaration cost more tokens", () => {
  const anthropic = declarationTokens(DECLARATION, basisFor("anthropic-messages"));
  const pi = declarationTokens(DECLARATION, PI_BASIS);
  const codex = declarationTokens(DECLARATION, basisFor("openai-codex-responses"));
  assert.ok(anthropic > pi && pi > codex, `${anthropic} > ${pi} > ${codex}`);
});
