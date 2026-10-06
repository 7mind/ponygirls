/**
 * The extension against a stand-in for pi's ExtensionAPI: the tool's JSON
 * answer and the headless /tokemon table. The providers used here need no
 * network (no quota endpoint; a Meta API key).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_PROVIDER_KEYS } from "../src/discovery.ts";

type Execute = (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
type Handler = (args: string, ctx: unknown) => Promise<void>;

test("the tool lists configured providers and, on request, their models; /tokemon prints the table headless", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "tokemon-ext-"));
  // Provider keys in the ambient environment would add real, networked targets.
  const saved = new Map(ENV_PROVIDER_KEYS.map(([name]) => [name, process.env[name]]));
  for (const [name] of ENV_PROVIDER_KEYS) delete process.env[name];
  try {
    writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ xiaomi: { type: "api_key", key: "x" }, meta: { type: "api_key", key: "m" } }));
    process.env["PI_CODING_AGENT_DIR"] = agentDir;
    const tools = new Map<string, Execute>();
    const commands = new Map<string, Handler>();
    const pi = {
      registerTool: (t: { name: string; execute: Execute }) => tools.set(t.name, t.execute),
      registerCommand: (name: string, c: { handler: Handler }) => commands.set(name, c.handler),
    };
    const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
    mod.default(pi);
    const notices: string[] = [];
    const ctx = {
      mode: "print",
      hasUI: false,
      ui: { notify: (text: string) => notices.push(text) },
      modelRegistry: {
        getProviderAuth: async (provider: string) => ({ auth: { apiKey: provider === "meta" ? "m" : "x" } }),
        getAvailable: () => [{ provider: "meta", id: "muse-spark" }, { provider: "xiaomi", id: "mimo-1" }, { provider: "xiaomi", id: "mimo-2" }],
      },
    };
    const plain = JSON.parse((await tools.get("tokemon")!("t1", {}, undefined, undefined, ctx)).content[0]!.text) as { providers: Array<{ provider: string; note: string | null }>; models?: unknown };
    assert.deepEqual(plain.providers.map((p) => [p.provider, p.note]), [["meta", "API key: no plan quota endpoint"], ["xiaomi", "no quota endpoint"]]);
    assert.equal(plain.models, undefined);
    const withModels = JSON.parse((await tools.get("tokemon")!("t2", { include_models: true }, undefined, undefined, ctx)).content[0]!.text) as { models: Record<string, string[]> };
    assert.deepEqual(withModels.models, { meta: ["muse-spark"], xiaomi: ["mimo-1", "mimo-2"] });
    await commands.get("tokemon")!("", ctx);
    assert.match(notices[0]!, /Provider\s+Src\s+Login/);
    assert.match(notices[0]!, /2 rows hidden: 2 without quota data/);
  } finally {
    for (const [name, value] of saved) if (value !== undefined) process.env[name] = value;
    delete process.env["PI_CODING_AGENT_DIR"];
    rmSync(agentDir, { recursive: true, force: true });
  }
});
