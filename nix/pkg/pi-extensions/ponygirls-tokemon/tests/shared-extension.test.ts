import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../index.ts";

type Result = { content: Array<{ text: string }> };
type Execute = (id: string, params: unknown, signal: unknown, update: unknown, ctx: unknown) => Promise<Result>;
import { ENV_PROVIDER_KEYS } from "../src/discovery.ts";

test("independent pi extensions share Anthropic requests, including forced pane refreshes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tokemon-shared-"));
  const names = [...ENV_PROVIDER_KEYS.map(([name]) => name), "PI_CODING_AGENT_DIR", "XDG_CACHE_HOME"];
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  const savedFetch = globalThis.fetch;
  try {
    for (const name of names) delete process.env[name];
    process.env.PI_CODING_AGENT_DIR = dir;
    process.env.XDG_CACHE_HOME = dir;
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ anthropic: { type: "oauth", access: "test-token", refresh: "test-refresh", expires: Date.now() + 3600000 } }));
    let requests = 0;
    globalThis.fetch = async (input) => {
      requests++;
      const url = input instanceof Request ? input.url : String(input);
      return Response.json(url.endsWith("/usage") ? { five_hour: { utilization: 42, resets_at: null } } : { account: { email: "test@example.test" }, organization: { organization_type: "max" } });
    };
    const ctx = { mode: "print", hasUI: false, modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "test-token" } }) }, getContextUsage: () => null, ui: { notify: () => {} } };
    const instance = () => {
      let execute: Execute;
      let command: (args: string, ctx: unknown) => Promise<void>;
      extension({ registerTool: (tool: { execute: Execute }) => { execute = tool.execute; }, registerCommand: (_name: string, definition: { handler: typeof command }) => { command = definition.handler; }, on: () => {} } as unknown as ExtensionAPI);
      return { report: () => execute("test", {}, undefined, undefined, ctx), pane: () => command("", ctx) };
    };
    const a = instance();
    const b = instance();
    const first = await a.report();
    assert.equal(JSON.parse(first.content[0].text).providers[0].windows[0].used, 42);
    await b.report();
    await b.pane();
    assert.equal(requests, 2, "one usage and one profile request across both instances");
  } finally {
    globalThis.fetch = savedFetch;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
