import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { piCatalogFixture } from "./test-fixtures.mjs";

const root = process.env.PI_PACKAGE_ROOT;
assert.ok(root, "PI_PACKAGE_ROOT is required");
const { createJiti } = await import(pathToFileURL(join(root, "node_modules/jiti/lib/jiti.mjs")));
const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false, alias: {
  "@earendil-works/pi-ai/providers/all": join(root, "node_modules/@earendil-works/pi-ai/dist/providers/all.js"),
} });
const sdk = await import(pathToFileURL(join(root, "dist/index.js")));
const { builtinProviders } = await import(pathToFileURL(join(root, "node_modules/@earendil-works/pi-ai/dist/providers/all.js")));
const { maximumContextProvider } = await jiti.import("./provider.ts");
const { registerCodexLimits } = await jiti.import("./index.ts");
const { GoverningModels, parseParentModel, parentModelProvider } = await jiti.import("../ponygirls-subagents/src/parent-models.ts");

// BG regression: compose actual registration, registry and worker metadata boundary without live credentials or inference.
test("Codex limits remain transferable to subagents with discovered metadata", async (t) => {
  const fixture = await piCatalogFixture(t);
  const credential = { type: "oauth", access: "synthetic", refresh: "synthetic", expires: Date.now() + 3600000, accountId: "synthetic" };
  const runtime = await sdk.ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false, catalogBaseUrl: fixture.catalogBaseUrl,
    credentials: { read: async (id) => id === "openai-codex" ? credential : undefined,
      list: async () => [{ providerId: "openai-codex", type: "oauth" }],
      modify: async (_id, fn) => await fn(credential) ?? credential, delete: async () => {} },
    modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} },
  });
  const registry = new sdk.ModelRegistry(runtime);
  const source = new GoverningModels(() => registry);
  const builtin = builtinProviders().find((provider) => provider.id === "openai-codex");
  const model = builtin.getModels()[0];
  const selected = { provider: model.provider, id: model.id, thinkingLevel: "high" };
  assert.equal(source.describe(selected), null, "undecorated built-in uses ordinary worker resolution");
  const decorated = maximumContextProvider(builtin, { load: async () => [{ slug: model.id, contextWindow: 1234567 }] });
  registerCodexLimits({ registerProvider: (...args) => registry.registerProvider(...args), on() {}, registerCommand() {} }, decorated);
  const refreshed = await registry.refresh({ providers: [model.provider], allowNetwork: true });
  assert.deepEqual([...refreshed.errors], []);
  assert.equal(fixture.requests.length, 1);
  assert.match(fixture.requests[0], /^\/api\/models\/providers\/openai-codex\?/);
  const descriptor = source.describe(selected);
  assert.ok(descriptor, "metadata must cross the worker boundary rather than fall back to catalog defaults");
  assert.equal(descriptor.contextWindow, 1234567);
  assert.equal(descriptor.maxTokens, model.maxTokens);
  assert.equal(registry.getRegisteredNativeProvider(model.provider), undefined);
  const transferred = parseParentModel(JSON.parse(JSON.stringify(descriptor)), selected);
  assert.deepEqual(transferred, descriptor);
  const worker = parentModelProvider(transferred, { stream() { throw new Error("no inference"); }, streamSimple() { throw new Error("no inference"); } }, async () => {
    const auth = await source.resolveAuth(transferred);
    assert.equal(auth.ok, true);
    const { ok, ...request } = auth;
    return request;
  });
  assert.equal(worker.getModels()[0].contextWindow, 1234567);
  const auth = await worker.auth.apiKey.resolve({ signal: new AbortController().signal });
  assert.equal(auth.auth.apiKey, "synthetic");
  assert.equal(JSON.stringify(descriptor).includes("synthetic"), false);
  registry.unregisterProvider(model.provider);
  assert.equal(source.describe(selected), null);
  assert.equal(registry.find(model.provider, model.id).contextWindow, model.contextWindow);
  registry.registerProvider(model.provider, { api: model.api, streamSimple() { throw new Error("custom transport"); } });
  registerCodexLimits({ registerProvider: (...args) => registry.registerProvider(...args), on() {}, registerCommand() {} }, decorated);
  assert.throws(() => source.describe(selected), { code: "MODEL_UNAVAILABLE" }, "metadata cannot make a custom stream portable");
  registry.registerProvider({ ...builtin });
  assert.throws(() => source.describe(selected), { code: "MODEL_UNAVAILABLE" }, "native implementations must remain rejected");
});
