import assert from "node:assert/strict";
import test from "node:test";
import {
  PI_BASIS, PI_CHARS_PER_TOKEN, basisFor, declarationText, declarationTokens, estimateTokens, promptLineText, promptLineTokens,
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
  assert.deepEqual(PI_BASIS, { declaration: 4, promptLine: 4, measuredFor: null });
});

test("Claude and GPT models use the ratios measured for their family, under any provider's naming", () => {
  const claude = { declaration: 2.7, promptLine: 3.1, measuredFor: "Claude" };
  for (const id of ["claude-haiku-5-5", "claude-fable-5-2", "claude-3-5-sonnet-latest", "anthropic/claude-sonnet-5", "us.anthropic.claude-sonnet-4-5-20250929-v1:0", "Claude-Opus-5"]) {
    assert.deepEqual(basisFor(id), claude, id);
  }
  const gpt = { declaration: 5.4, promptLine: 5, measuredFor: "GPT" };
  for (const id of ["gpt-6.2", "gpt-6.2-sol", "gpt-4o", "openai/gpt-5.5", "azure.gpt-5-mini"]) {
    assert.deepEqual(basisFor(id), gpt, id);
  }
});

test("every other model, and no model, falls back to pi's rule", () => {
  // Other vendors' models are served over the same APIs and under similar names; none of them was measured.
  for (const id of ["kimi-k2.6", "MiniMax-M2.5", "glm-5", "gemini-3-pro", "o4-mini", "gpt-oss-120b", "chatgpt-4o-latest", "not-claude-1", "claude", "gpt", ""]) {
    assert.equal(basisFor(id), PI_BASIS, id);
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
  const basis: TokenBasis = { declaration: 2, promptLine: 10, measuredFor: "a test" };
  assert.equal(declarationTokens(DECLARATION, basis), Math.ceil(declarationText(DECLARATION).length / 2));
  assert.equal(promptLineTokens("read", LINES, basis), Math.ceil(promptLineText("read", LINES).length / 10));
});

test("a denser tokenizer makes the same declaration cost more tokens", () => {
  const claude = declarationTokens(DECLARATION, basisFor("claude-haiku-5-5"));
  const pi = declarationTokens(DECLARATION, PI_BASIS);
  const gpt = declarationTokens(DECLARATION, basisFor("gpt-6.2"));
  assert.ok(claude > pi && pi > gpt, `${claude} > ${pi} > ${gpt}`);
});
