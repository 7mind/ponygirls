import assert from "node:assert/strict";
import test from "node:test";
import { latestModelGenerations, newerModelIn, type ModelIdentity } from "./model-generations.ts";

const ids = (provider: string, ...models: string[]) => models.map((id) => ({ provider, id }));

test("only strictly older comparable generations are removed; order and model metadata survive", () => {
  const fallback = { provider: "openai", id: "gpt-6.1-sol" };
  const sol = { provider: "openai-codex", id: "gpt-6.10-sol", name: "Sol 6.10" };
  const catalog = Object.freeze([
    ...ids("openai-codex", "gpt-6.2-sol", "gpt-6.2-astra"),
    fallback,
    sol,
    ...ids("openai-codex", "gpt-6.1-sol", "gpt-6.2-sol-fast", "gpt-sol-latest", "gpt-6.10-sol-2026-11-05"),
  ]);
  const keep = latestModelGenerations(catalog);
  assert.deepEqual(keep.map((m) => `${m.provider}/${m.id}`), [
    "openai-codex/gpt-6.2-astra", "openai/gpt-6.1-sol", "openai-codex/gpt-6.10-sol",
    "openai-codex/gpt-6.2-sol-fast", "openai-codex/gpt-sol-latest", "openai-codex/gpt-6.10-sol-2026-11-05",
  ]);
  assert.equal(keep[2], sol);
  assert.equal(newerModelIn(catalog)({ provider: "openai-codex", id: "gpt-5.6-sol" }), sol,
    "a retained model no longer listed in the catalogue can still be superseded");
  assert.deepEqual(latestModelGenerations([]), []);
});

test("known series support catalog variants without comparing unrelated deployments", () => {
  const cases: ReadonlyArray<readonly [provider: string, all: string[], expected: string[]]> = [
    ["anthropic", ["claude-3-5-sonnet-20241022", "claude-sonnet-4-5-20250929", "claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5-5-20261008"],
      ["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5-5-20261008"]],
    ["openrouter", ["anthropic/claude-sonnet-4.6", "anthropic/claude-sonnet-5.5", "anthropic/claude-sonnet-4.6:batch", "other/claude-sonnet-4.6"],
      ["anthropic/claude-sonnet-5.5", "anthropic/claude-sonnet-4.6:batch", "other/claude-sonnet-4.6"]],
    ["amazon-bedrock", ["eu.anthropic.claude-sonnet-4-5-20250929-v1:0", "eu.anthropic.claude-sonnet-5-5", "us.anthropic.claude-sonnet-4-5-20250929-v1:0"],
      ["eu.anthropic.claude-sonnet-5-5", "us.anthropic.claude-sonnet-4-5-20250929-v1:0"]],
    ["google", ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-2.5-flash-lite", "gemini-3.1-pro-preview"],
      ["gemini-3.8-flash", "gemini-2.5-flash-lite", "gemini-3.1-pro-preview"]],
    ["zai", ["glm-4.7", "glm-5.2", "glm-5.3", "glm-5.3-flash"], ["glm-5.3", "glm-5.3-flash"]],
    ["minimax", ["MiniMax-M2.7", "MiniMax-M3", "MiniMax-M3.1-Flash"], ["MiniMax-M3", "MiniMax-M3.1-Flash"]],
    ["kimi-coding", ["k2.6", "k3", "k3.1-pro", "kimi-for-coding"], ["k3", "k3.1-pro", "kimi-for-coding"]],
    ["openrouter", ["deepseek/deepseek-v4-flash-0731", "deepseek/deepseek-v4.1-flash-1017", "x-ai/grok-4.20", "x-ai/grok-4.6", "x-ai/grok-4.7"],
      ["deepseek/deepseek-v4.1-flash-1017", "x-ai/grok-4.20", "x-ai/grok-4.7"]],
    ["local", ["custom-7b", "custom-70b", "custom-1", "custom-2"], ["custom-7b", "custom-70b", "custom-1", "custom-2"]],
  ];
  for (const [provider, all, expected] of cases) {
    const catalog: ModelIdentity[] = ids(provider, ...all);
    assert.deepEqual(latestModelGenerations(catalog).map((m) => m.id), expected, provider);
  }
});
