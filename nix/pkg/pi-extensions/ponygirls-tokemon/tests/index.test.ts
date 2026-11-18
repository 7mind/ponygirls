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
import { toolReport, type ProviderReport, type ToolReport } from "../src/report.ts";
import type { QueryResult } from "../src/service.ts";
import { fixture, renderBorderWidget, untag } from "./scripted-http.ts";

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
    const descriptions = new Map<string, string>();
    const pi = {
      registerTool: (t: { name: string; execute: Execute }) => tools.set(t.name, t.execute),
      registerCommand: (name: string, c: { description: string; handler: Handler }) => { commands.set(name, c.handler); descriptions.set(name, c.description); },
      on: (_event: string, _handler: unknown) => {},
    };
    const mod = (await import("../index.ts")) as { default: (api: unknown) => void };
    mod.default(pi);
    assert.equal(descriptions.get("tokemon"), "Provider quotas and limits");
    const notices: string[] = [];
    const ctx = {
      mode: "print",
      hasUI: false,
      ui: { notify: (text: string) => notices.push(text) },
      modelRegistry: {
        getProviderAuth: async (provider: string) => ({ auth: { apiKey: provider === "meta" ? "m" : "x" } }),
        getAvailable: () => [
          { provider: "meta", id: "muse-spark-1.2", reasoning: true },
          { provider: "meta", id: "muse-spark-1.3" },
          { provider: "meta", id: "muse-ember-1.0" },
          { provider: "xiaomi", id: "mimo-v2.6-pro" },
        ],
      },
      getContextUsage: () => ({ tokens: 12345, contextWindow: 200000, percent: 6.17 }),
    };
    const call = async (params: object): Promise<ToolReport> => {
      const result = await tools.get("tokemon")!("report", params, undefined, undefined, ctx);
      assert.equal(result.isError, undefined, result.content[0]!.text);
      return JSON.parse(result.content[0]!.text) as ToolReport;
    };
    const plain = await call({});
    assert.deepEqual(plain.providers.map((p) => [p.provider, p.note]), [["meta", "API key: no plan quota endpoint"], ["xiaomi", "no quota endpoint"]]);
    assert.equal(plain.models, undefined);
    assert.deepEqual(plain.context, { tokens: 12345, contextWindow: 200000, percent: 6.17 }, "context rides along by default");
    const withModels = await call({ include_models: true });
    const ember = { id: "muse-ember-1.0", efforts: ["off"] };
    const spark = { id: "muse-spark-1.3", efforts: ["off"] };
    assert.deepEqual(withModels.models, {
      meta: [ember, spark],
      xiaomi: [{ id: "mimo-v2.6-pro", efforts: ["off"] }],
    });
    const full = await call({ include_models: true, include_older_models: true });
    assert.deepEqual(full.models, {
      ...withModels.models,
      meta: [ember, { id: "muse-spark-1.2", efforts: ["off", "minimal", "low", "medium", "high"] }, spark],
    });
    const withoutAge = ({ ageSeconds: _age, ...provider }: ProviderReport) => provider;
    assert.deepEqual(full.providers.map(withoutAge), withModels.providers.map(withoutAge));
    assert.deepEqual(full.context, plain.context);
    assert.equal((await call({ include_older_models: true })).models, undefined, "the toggle alone does not enable model reporting");
    assert.equal((await call({ include_context: false })).context, undefined);
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
    const noopTheme = { appearance: "light", bold: (s: string) => s, fg: (_c: string, s: string) => s, bg: (_c: string, s: string) => s };
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
    assert.deepEqual(customOptions, { retainEditorBorders: true }, "in-place panel retains clickable border badges without an overlay");
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
    const line = renderBorderWidget(content);
    assert.match(untag(line), /^zai \{/);
    assert.match(line, /<(success|warning|error)>█+<\/\1>/, "bars take their window state's colour");
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
