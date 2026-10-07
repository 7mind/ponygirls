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
import { quotaWindow } from "../src/quota.ts";
import { toolReport } from "../src/report.ts";
import type { QueryResult } from "../src/service.ts";
import { fixture } from "./scripted-http.ts";

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
      on: (_event: string, _handler: unknown) => {},
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
        getAvailable: () => [{ provider: "meta", id: "muse-spark" }, { provider: "xiaomi", id: "mimo-1", reasoning: true }, { provider: "xiaomi", id: "mimo-2" }],
      },
      getContextUsage: () => ({ tokens: 12345, contextWindow: 200000, percent: 6.17 }),
    };
    const plain = JSON.parse((await tools.get("tokemon")!("t1", {}, undefined, undefined, ctx)).content[0]!.text) as { providers: Array<{ provider: string; note: string | null; windows: unknown[] }>; models?: unknown; context?: unknown };
    assert.deepEqual(plain.providers.map((p) => [p.provider, p.note]), [["meta", "API key: no plan quota endpoint"], ["xiaomi", "no quota endpoint"]]);
    assert.equal(plain.models, undefined);
    assert.deepEqual(plain.context, { tokens: 12345, contextWindow: 200000, percent: 6.17 }, "context rides along by default");
    const withModels = JSON.parse((await tools.get("tokemon")!("t2", { include_models: true }, undefined, undefined, ctx)).content[0]!.text) as { models: Record<string, Array<{ id: string; efforts: string[] }>> };
    assert.deepEqual(withModels.models, {
      meta: [{ id: "muse-spark", efforts: ["off"] }],
      xiaomi: [{ id: "mimo-1", efforts: ["off", "minimal", "low", "medium", "high"] }, { id: "mimo-2", efforts: ["off"] }],
    });
    const noContext = JSON.parse((await tools.get("tokemon")!("t3", { include_context: false }, undefined, undefined, ctx)).content[0]!.text) as { context?: unknown };
    assert.equal(noContext.context, undefined);
    await commands.get("tokemon")!("", ctx);
    assert.match(notices[0]!, /Provider\s+Src\s+Login/);
    assert.match(notices[0]!, /2 rows hidden: 2 without quota data/);
  } finally {
    for (const [name, value] of saved) if (value !== undefined) process.env[name] = value;
    delete process.env["PI_CODING_AGENT_DIR"];
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("/tokemon opens in place as a bottom panel, not a popup overlay", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "tokemon-ext-"));
  const saved = new Map(ENV_PROVIDER_KEYS.map(([name]) => [name, process.env[name]]));
  for (const [name] of ENV_PROVIDER_KEYS) delete process.env[name];
  try {
    writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ xiaomi: { type: "api_key", key: "x" } }));
    process.env["PI_CODING_AGENT_DIR"] = agentDir;
    const tools = new Map<string, Execute>();
    const commands = new Map<string, Handler>();
    let customOptions: unknown = "not called";
    const noopTheme = { bold: (s: string) => s, fg: (_c: string, s: string) => s };
    const fakeTui = { terminal: { rows: 30 }, requestRender: () => {} };
    const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
    const pi = {
      registerTool: (t: { name: string; execute: Execute }) => tools.set(t.name, t.execute),
      registerCommand: (name: string, c: { handler: Handler }) => commands.set(name, c.handler),
      on: (_event: string, _handler: unknown) => {},
    };
    mod.default(pi);
    const tuiCtx = {
      mode: "tui",
      hasUI: true,
      ui: {
        notify: () => {},
        custom: async (factory: (...args: Array<any>) => { render: (width: number) => string[]; handleInput?: (data: string) => void; dispose?: () => void }, options?: unknown) => {
          customOptions = options;
          const component = factory(fakeTui, noopTheme, {}, () => {});
          await new Promise((r) => setTimeout(r, 0));
          component.handleInput?.("i");
          assert.ok(component.render(80).some((l) => l.includes("xiaomi")));
          component.dispose?.();
        },
      },
      modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "x" } }), getAvailable: () => [] },
    };
    await commands.get("tokemon")!("", tuiCtx);
    assert.equal(customOptions, undefined, "in place like /usage and /perf: no overlay option");
  } finally {
    for (const [name, value] of saved) if (value !== undefined) process.env[name] = value;
    delete process.env["PI_CODING_AGENT_DIR"];
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("turn_end publishes the quota line as a border widget", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "tokemon-ext-"));
  const saved = new Map(ENV_PROVIDER_KEYS.map(([name]) => [name, process.env[name]]));
  for (const [name] of ENV_PROVIDER_KEYS) delete process.env[name];
  try {
    writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ xiaomi: { type: "api_key", key: "x" } }));
    process.env["PI_CODING_AGENT_DIR"] = agentDir;
    const handlers = new Map<string, (event: unknown, ctx: any) => unknown>();
    const widgets: Array<unknown[]> = [];
    const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
    mod.default({
      registerTool: () => {},
      registerCommand: () => {},
      on: (event: string, handler: (event: unknown, ctx: any) => unknown) => { handlers.set(event, handler); },
    });
    assert.ok(handlers.has("turn_end") && handlers.has("model_select"));
    const tuiCtx = {
      mode: "tui",
      model: { provider: "xiaomi" },
      modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "x" } }), getAvailable: () => [] },
      ui: { setWidget: (...args: unknown[]) => { widgets.push(args); } },
    };
    await handlers.get("turn_end")!({}, tuiCtx);
    await new Promise((r) => setTimeout(r, 20));
    // xiaomi has no quota endpoint, so the widget clears instead of going stale.
    assert.deepEqual(widgets, [["tokemon", undefined]]);
  } finally {
    for (const [name, value] of saved) if (value !== undefined) process.env[name] = value;
    delete process.env["PI_CODING_AGENT_DIR"];
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("a quota line reaches the top-right border widget with its placement", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "tokemon-ext-"));
  const saved = new Map(ENV_PROVIDER_KEYS.map(([name]) => [name, process.env[name]]));
  for (const [name] of ENV_PROVIDER_KEYS) delete process.env[name];
  const savedFetch = globalThis.fetch;
  try {
    // A zai env key yields one zai target, whose quota endpoint answers from
    // the recorded fixture via the stubbed fetch.
    process.env["ZAI_API_KEY"] = "z";
    writeFileSync(join(agentDir, "auth.json"), JSON.stringify({}));
    process.env["PI_CODING_AGENT_DIR"] = agentDir;
    globalThis.fetch = (async () => ({
      status: 200,
      text: async () => JSON.stringify(fixture("zai_limits.json")),
      headers: { get: () => null },
    })) as unknown as typeof fetch;
    const handlers = new Map<string, (event: unknown, ctx: any) => unknown>();
    const widgets: Array<unknown[]> = [];
    const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
    mod.default({
      registerTool: () => {},
      registerCommand: () => {},
      on: (event: string, handler: (event: unknown, ctx: any) => unknown) => { handlers.set(event, handler); },
    });
    const tuiCtx = {
      mode: "tui",
      model: { provider: "zai" },
      modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: "k" } }), getAvailable: () => [] },
      ui: { setWidget: (...args: unknown[]) => { widgets.push(args); } },
    };
    await handlers.get("turn_end")!({}, tuiCtx);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(widgets.length, 1);
    const [key, content, options] = widgets[0]!;
    assert.equal(key, "tokemon");
    assert.ok(Array.isArray(content) && content.length === 1);
    assert.match(String((content as string[])[0]), /^zai \{/);
    assert.deepEqual(options, { placement: "borderTopRight" });
  } finally {
    globalThis.fetch = savedFetch;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    delete process.env["PI_CODING_AGENT_DIR"];
    rmSync(agentDir, { recursive: true, force: true });
  }
});

test("toolReport omits quota windows only when asked; plan and login stay", () => {
  const result: QueryResult = {
    target: { provider: "zai", origin: "auth.json", label: "~/.pi/agent/auth.json", credential: null, note: null },
    snapshot: { plan: "lite", identity: "user@example.test", windows: [quotaWindow("tokens (5h)", 94, 2000, "credits", null)], note: null },
    error: null,
    fetchedAt: new Date("2026-10-06T12:00:00Z"),
    rateLimited: false,
    retryAt: null,
  };
  const report = { results: [result], refreshedAt: new Date("2026-10-06T12:00:00Z") };
  const withQuotas = toolReport(report, new Date("2026-10-06T12:00:00Z"), { models: null, quotas: true, context: null });
  assert.equal(withQuotas.providers[0]!.windows.length, 1);
  const without = toolReport(report, new Date("2026-10-06T12:00:00Z"), { models: null, quotas: false, context: null });
  assert.deepEqual([without.providers[0]!.windows, without.providers[0]!.plan, without.providers[0]!.login], [[], "lite", "user@example.test"]);
});
