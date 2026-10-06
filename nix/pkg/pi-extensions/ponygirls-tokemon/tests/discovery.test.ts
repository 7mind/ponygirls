import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiscoveryError, discoverTargets } from "../src/discovery.ts";

function agentDir(files: { auth?: unknown; models?: unknown }): { home: string; dir: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "tokemon-home-"));
  const dir = join(home, ".pi", "agent");
  mkdirSync(dir, { recursive: true });
  if (files.auth !== undefined) writeFileSync(join(dir, "auth.json"), typeof files.auth === "string" ? files.auth : JSON.stringify(files.auth));
  if (files.models !== undefined) writeFileSync(join(dir, "models.json"), JSON.stringify(files.models));
  return { home, dir, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test("auth.json logins and keys become targets; unusable entries carry the reason", () => {
  const { home, dir, cleanup } = agentDir({
    auth: {
      zai: { type: "api_key", key: "zai-key" },
      "kimi-coding": { type: "oauth", access: "kimi-access", refresh: "kimi-refresh", expires: 1 },
      broken: { type: "oauth" },
      odd: { type: "magic" },
    },
  });
  try {
    const targets = discoverTargets(dir, home, {});
    assert.deepEqual(targets.map((t) => [t.provider, t.origin, t.label, t.credential, t.note]), [
      ["broken", "auth.json", "~/.pi/agent/auth.json", null, "pi credential broken: oauth entry has no access token"],
      ["kimi-coding", "auth.json", "~/.pi/agent/auth.json", { kind: "oauth", secret: "kimi-access", refreshToken: "kimi-refresh", accountId: null }, null],
      ["odd", "auth.json", "~/.pi/agent/auth.json", null, 'pi credential odd: unknown type "magic"'],
      ["zai", "auth.json", "~/.pi/agent/auth.json", { kind: "api_key", secret: "zai-key", refreshToken: null, accountId: null }, null],
    ]);
  } finally {
    cleanup();
  }
});

test("environment keys add providers unless the same key is already stored", () => {
  const { home, dir, cleanup } = agentDir({ auth: { zai: { type: "api_key", key: "same" } } });
  try {
    const targets = discoverTargets(dir, home, { ZAI_API_KEY: "same", OPENROUTER_API_KEY: "or-key", XAI_MANAGEMENT_API_KEY: "mgmt", UNRELATED: "x" });
    assert.deepEqual(targets.map((t) => [t.provider, t.origin, t.label]), [
      ["zai", "auth.json", "~/.pi/agent/auth.json"],
      ["openrouter", "env", "OPENROUTER_API_KEY"],
      ["xai-management", "env", "XAI_MANAGEMENT_API_KEY"],
    ]);
  } finally {
    cleanup();
  }
});

test("models.json providers without a credential are queried through pi; plain openai-completions endpoints are omitted", () => {
  const { home, dir, cleanup } = agentDir({
    auth: { zai: { type: "api_key", key: "k" } },
    models: { providers: { zai: { api: "openai-completions" }, "llama-swap": { api: "openai-completions" }, minimax: { api: "openai-completions" }, custom: { api: "anthropic-messages" } } },
  });
  try {
    const targets = discoverTargets(dir, home, {});
    assert.deepEqual(targets.map((t) => [t.provider, t.origin, t.credential]), [
      ["zai", "auth.json", { kind: "api_key", secret: "k", refreshToken: null, accountId: null }],
      ["custom", "models.json", null],
      ["minimax", "models.json", null],
    ]);
  } finally {
    cleanup();
  }
});

test("an unreadable auth.json is an error, not an empty configuration", () => {
  const { home, dir, cleanup } = agentDir({ auth: "{not json" });
  try {
    assert.throws(() => discoverTargets(dir, home, {}), DiscoveryError);
    assert.deepEqual(discoverTargets(join(home, "missing"), home, {}), []);
  } finally {
    cleanup();
  }
});
