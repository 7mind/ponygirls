import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const root = process.env.PI_PACKAGE_ROOT;
assert.ok(root, "PI_PACKAGE_ROOT is required");
const aiRoot = join(root, "node_modules/@earendil-works/pi-ai");
const { createJiti } = await import(pathToFileURL(join(root, "node_modules/jiti/lib/jiti.mjs")));
const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false, alias: {
  "@earendil-works/pi-ai/providers/all": join(aiRoot, "dist/providers/all.js"),
} });
const { parseCatalog, HttpCodexCatalog, CATALOG_URL } = await jiti.import("./catalog.ts");
const { maximumContextProvider } = await jiti.import("./provider.ts");
const { registerCodexLimits } = await jiti.import("./index.ts");
const { builtinProviders } = await import(pathToFileURL(join(aiRoot, "dist/providers/all.js")));
const sdk = await import(pathToFileURL(join(root, "dist/index.js")));
const credential = { type: "oauth", access: "test-access", refresh: "test-refresh", expires: Date.now() + 3600000, accountId: "test-account" };
const row = { slug: "test-model", context_window: 272000, max_context_window: 1000000 };
const base = () => {
  const provider = builtinProviders().find((p) => p.id === "openai-codex");
  const model = { ...provider.getModels()[0], id: row.slug, contextWindow: 272000, maxTokens: 128000 };
  return { ...provider, getModels: () => [model], getAllModels: () => [model] };
};
const refreshContext = (extra) => ({ credential, signal: new AbortController().signal, allowNetwork: true,
  publish: async ({ update }) => { if (update) update(); return true; }, ...extra });

class MemoryCatalog {
  constructor() { this.rows = parseCatalog({ models: [row] }); this.failure = false; this.calls = 0; }
  async load() { this.calls++; if (this.failure) throw new Error("Codex discovery HTTP 503"); return this.rows; }
}

async function httpFixture(t) {
  const fixture = { body: JSON.stringify({ models: [row] }), status: 200, headers: {}, requests: [] };
  const server = createServer((req, res) => {
    fixture.requests.push({ url: req.url, headers: req.headers });
    res.writeHead(fixture.status, { "content-type": "application/json", ...fixture.headers });
    res.end(fixture.body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  fixture.url = `http://127.0.0.1:${server.address().port}/codex/models?client_version=0.165.0`;
  fixture.catalog = new HttpCodexCatalog(fixture.url, fetch);
  return fixture;
}

// Specified-origin Behavioral-Active Blackbox tests: pure parser and shared provider contract.
test("maximum override wins, default is fallback, absent metadata remains unknown; output is not inferred", () => {
  assert.deepEqual(parseCatalog({ models: [row, { slug: "default", context_window: 400000 }, { slug: "max", max_context_window: 800000 }, { slug: "unknown", max_output_tokens: 999999 }] }), [
    { slug: row.slug, contextWindow: 1000000 }, { slug: "default", contextWindow: 400000 },
    { slug: "max", contextWindow: 800000 }, { slug: "unknown", contextWindow: undefined },
  ]);
});

test("reject invalid identifiers, limits, contradictory defaults, and malformed catalogs", () => {
  for (const value of [null, [], {}, { models: [] }, { models: [row, row] }, { models: [{}] }, { models: [{ slug: "" }] }]) assert.throws(() => parseCatalog(value), /Codex discovery/);
  for (const value of [0, -1, "1000000", 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    for (const key of ["context_window", "max_context_window"]) assert.throws(() => parseCatalog({ models: [{ slug: "bad", [key]: value }] }), /invalid context limit/);
  }
  assert.throws(() => parseCatalog({ models: [{ ...row, max_context_window: 100 }] }), /maximum below/);
});

for (const adapter of ["memory", "http"]) {
  test(`${adapter}: provider applies live maximum, keeps output/auth/transport, retains last-known on failure`, async (t) => {
    const fixture = adapter === "memory" ? new MemoryCatalog() : await httpFixture(t);
    const catalog = adapter === "memory" ? fixture : fixture.catalog;
    const builtin = base();
    const decorated = maximumContextProvider(builtin, catalog);
    assert.equal(decorated.provider.auth, builtin.auth);
    assert.equal(decorated.provider.stream, builtin.stream);
    assert.equal(decorated.provider.streamSimple, builtin.streamSimple);
    assert.equal(decorated.provider.baseUrl, builtin.baseUrl);
    assert.equal(decorated.provider.getModels()[0].contextWindow, 272000);
    await decorated.provider.refreshModels(refreshContext({ allowNetwork: false }));
    assert.equal(decorated.provider.getModels()[0].contextWindow, 272000);
    await decorated.provider.refreshModels(refreshContext({}));
    for (const model of [decorated.provider.getModels()[0], decorated.provider.getAllModels()[0]]) {
      assert.deepEqual(model, { ...builtin.getModels()[0], contextWindow: 1000000 });
    }
    assert.equal(builtin.getModels()[0].contextWindow, 272000);
    assert.equal(decorated.hasLimit(row.slug), true);
    assert.match(decorated.status(), /Output limits retained/);
    if (adapter === "memory") fixture.failure = true;
    else fixture.status = 503;
    await assert.rejects(decorated.provider.refreshModels(refreshContext({})), /HTTP 503/);
    assert.equal(decorated.provider.getModels()[0].contextWindow, 1000000);
    assert.match(decorated.status(), /Discovery failed/);
  });

  test(`${adapter}: missing models/limits do not manufacture capacities`, async (t) => {
    const fixture = adapter === "memory" ? new MemoryCatalog() : await httpFixture(t);
    const rows = [{ slug: "unlisted", max_context_window: 2000000 }, { slug: row.slug }];
    if (adapter === "memory") fixture.rows = parseCatalog({ models: rows });
    else fixture.body = JSON.stringify({ models: rows });
    const decorated = maximumContextProvider(base(), adapter === "memory" ? fixture : fixture.catalog);
    await decorated.provider.refreshModels(refreshContext({}));
    assert.equal(decorated.provider.getModels().length, 1);
    assert.equal(decorated.provider.getModels()[0].contextWindow, 272000);
    assert.equal(decorated.hasLimit(row.slug), false);
  });
}

test("HTTP adapter uses scoped auth, bounded schema response, cancellation, and sanitized errors", async (t) => {
  const fixture = await httpFixture(t);
  await fixture.catalog.load(credential, new AbortController().signal);
  assert.equal(fixture.requests[0].url, "/codex/models?client_version=0.165.0");
  assert.equal(fixture.requests[0].headers.authorization, "Bearer test-access");
  assert.equal(fixture.requests[0].headers["chatgpt-account-id"], "test-account");
  assert.equal(fixture.requests[0].headers.originator, "pi");
  assert.ok(CATALOG_URL.startsWith("https://chatgpt.com/backend-api/codex/models?"));
  for (const [body, pattern] of [["test-access", /invalid JSON/], ["x".repeat(2 * 1024 * 1024 + 1), /exceeds 2 MiB/], [JSON.stringify({ models: [{ slug: "bad", context_window: -1 }] }), /invalid context limit/]]) {
    fixture.body = body;
    await assert.rejects(fixture.catalog.load(credential, new AbortController().signal), pattern);
  }
  await assert.rejects(fixture.catalog.load(credential, AbortSignal.abort()), /request failed or timed out/);
  await assert.rejects(fixture.catalog.load({ type: "api_key", key: "test-access" }, new AbortController().signal), /requires subscription/);
  const unsafe = new HttpCodexCatalog(fixture.url, async () => { throw new Error("test-access"); });
  await assert.rejects(unsafe.load(credential, new AbortController().signal), (error) => !error.message.includes("test-access"));
});

test("HTTP adapter enforces the real ten-second deadline on a stalled response body", { timeout: 15000 }, async (t) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"models":[');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const catalog = new HttpCodexCatalog(`http://127.0.0.1:${server.address().port}/models`, fetch);
  const started = performance.now();
  await assert.rejects(catalog.load(credential, new AbortController().signal), /request failed or timed out/);
  assert.ok(performance.now() - started >= 9000, "exercise the production deadline, not an immediate failure");
});

test("HTTP adapter refuses redirects rather than forwarding credentials", async (t) => {
  const fixture = await httpFixture(t);
  fixture.status = 302;
  fixture.headers.location = "/stolen";
  await assert.rejects(fixture.catalog.load(credential, new AbortController().signal), /request failed/);
  assert.equal(fixture.requests.length, 1);
});

test("publication rejection cannot change models or status", async () => {
  const decorated = maximumContextProvider(base(), new MemoryCatalog());
  const before = decorated.status();
  await decorated.provider.refreshModels(refreshContext({ publish: async () => false }));
  assert.equal(decorated.provider.getModels()[0].contextWindow, 272000);
  assert.equal(decorated.status(), before);
});

test("failed stale refresh cannot replace a newer diagnostic", async () => {
  const source = new MemoryCatalog();
  const decorated = maximumContextProvider(base(), source);
  await decorated.provider.refreshModels(refreshContext({}));
  const before = decorated.status();
  source.failure = true;
  await assert.rejects(decorated.provider.refreshModels(refreshContext({ publish: async () => false })));
  assert.equal(decorated.status(), before);
});

test("changing account invalidates old account's metadata even when discovery fails", async () => {
  const source = new MemoryCatalog();
  const decorated = maximumContextProvider(base(), source);
  await decorated.provider.refreshModels(refreshContext({}));
  source.failure = true;
  await assert.rejects(decorated.provider.refreshModels(refreshContext({ credential: { ...credential, accountId: "other-account" } })));
  assert.equal(decorated.provider.getModels()[0].contextWindow, 272000);
});

test("switching to a nonstandard endpoint invalidates official limits, including offline", async () => {
  for (const allowNetwork of [true, false]) {
    const decorated = maximumContextProvider(base(), new MemoryCatalog());
    await decorated.provider.refreshModels(refreshContext({}));
    const refresh = decorated.provider.refreshModels(refreshContext({ allowNetwork, baseUrl: "https://proxy.invalid" }));
    if (allowNetwork) await assert.rejects(refresh, /nonstandard/);
    else await refresh;
    assert.equal(decorated.provider.getModels()[0].contextWindow, 272000);
  }
});

test("offline account changes invalidate old limits and request discovery", async () => {
  const decorated = maximumContextProvider(base(), new MemoryCatalog());
  await decorated.provider.refreshModels(refreshContext({}));
  await decorated.provider.refreshModels(refreshContext({ allowNetwork: false, credential: { ...credential, accountId: "other" } }));
  assert.equal(decorated.provider.getModels()[0].contextWindow, 272000);
  assert.equal(decorated.needsRefresh(), true);
});

test("nonstandard endpoints are not queried and cancellation of scope publication prevents fetch", async () => {
  const source = new MemoryCatalog();
  const decorated = maximumContextProvider(base(), source);
  await assert.rejects(decorated.provider.refreshModels(refreshContext({ baseUrl: "https://proxy.invalid" })), /nonstandard/);
  assert.equal(source.calls, 0);
  await decorated.provider.refreshModels(refreshContext({}));
  source.calls = 0;
  await decorated.provider.refreshModels(refreshContext({ credential: { ...credential, accountId: "other" }, publish: async () => false }));
  assert.equal(source.calls, 0);
});

test("lifecycle updates the active model before use, warns on failure, and exposes limit sources", async () => {
  const source = new MemoryCatalog();
  const decorated = maximumContextProvider(base(), source);
  const handlers = new Map(), commands = new Map(), notifications = [];
  let model = base().getModels()[0];
  const ctx = { get model() { return model; }, modelRegistry: {
    refresh: async () => {
      try { await decorated.provider.refreshModels(refreshContext({})); return { errors: new Map() }; }
      catch (error) { return { errors: new Map([["openai-codex", error]]) }; }
    },
    find: (_provider, id) => decorated.provider.getModels().find((m) => m.id === id),
  }, ui: { notify: (message, type) => notifications.push({ message, type }) } };
  const pi = { registerProvider: () => {}, on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command), setModel: async (next) => { model = next; return true; } };
  registerCodexLimits(pi, decorated);
  await handlers.get("session_start")({}, ctx);
  assert.equal(model.contextWindow, 1000000);
  assert.equal(model.maxTokens, 128000);
  assert.equal(notifications.length, 0);
  await commands.get("codex-limits").handler("", ctx);
  assert.match(notifications.at(-1).message, /context 1000000; output 128000/);
  model = { ...model, contextWindow: 272000 };
  await handlers.get("input")({}, ctx);
  assert.equal(model.contextWindow, 1000000, "background catalog refresh must synchronize before the next prompt");
  source.failure = true;
  await commands.get("codex-limits").handler("refresh", ctx);
  assert.ok(notifications.some((n) => n.type === "warning" && /discovery failed/.test(n.message)));
  await commands.get("codex-limits").handler("bad", ctx);
  assert.match(notifications.at(-1).message, /Usage:/);
  model = { ...model, id: "unknown", contextWindow: 100 };
  await handlers.get("model_select")({}, ctx);
  assert.match(notifications.at(-1).message, /no discovered context limit/);
  model = { ...model, provider: "anthropic" };
  const before = notifications.length;
  await handlers.get("model_select")({}, ctx);
  assert.equal(notifications.length, before);
});

test("host: real Pi loader registers native provider and command; runtime applies discovery before requests", async () => {
  const loader = new sdk.DefaultResourceLoader({
    cwd: import.meta.dirname, agentDir: import.meta.dirname, settingsManager: sdk.SettingsManager.inMemory(),
    additionalExtensionPaths: [resolve(import.meta.dirname, "index.ts")], noExtensions: true,
    noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const loaded = loader.getExtensions().extensions[0];
  assert.ok(loaded.commands.has("codex-limits"));
  const runtime = await sdk.ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
    credentials: {
      read: async (id) => id === "openai-codex" ? credential : undefined,
      list: async () => [{ providerId: "openai-codex", type: "oauth" }],
      modify: async (_id, fn) => await fn(credential) ?? credential,
      delete: async () => {},
    }, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} },
  });
  const decorated = maximumContextProvider(base(), new MemoryCatalog());
  runtime.registerNativeProvider(decorated.provider);
  const result = await runtime.refresh({ providers: ["openai-codex"], allowNetwork: true });
  assert.equal(result.errors.size, 0);
  assert.equal(runtime.getModel("openai-codex", row.slug).contextWindow, 1000000);
  assert.equal(runtime.getModel("openai-codex", row.slug).maxTokens, 128000);
  assert.equal((await runtime.getAuth("openai-codex")).auth.apiKey, "test-access");
  assert.equal(runtime.getModel("anthropic", "claude-sonnet-4-6").contextWindow > 0, true);
});
