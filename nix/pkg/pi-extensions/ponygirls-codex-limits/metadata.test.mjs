import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.env.PI_PACKAGE_ROOT;
assert.ok(root, "PI_PACKAGE_ROOT is required");
const { composeModelProvider } = await import(pathToFileURL(join(root, "dist/core/provider-composer.js")));
const { builtinProviders } = await import(pathToFileURL(join(root, "node_modules/@earendil-works/pi-ai/dist/providers/all.js")));
const builtin = builtinProviders().find((provider) => provider.id === "openai-codex");
const model = builtin.getModels()[0];
const configured = (config) => ({ getProvider: () => config });
const metadata = (entries) => ({ getOverrides: () => new Map(entries) });

// BG: the public composition boundary preserves catalogs and transport while applying only portable limits.
test("metadata overlay retains configured models, every unrelated field, and user override precedence", () => {
  const custom = { ...model, id: "configured", contextWindow: 567890, maxTokens: 9876 };
  const config = { models: [custom], modelOverrides: { [model.id]: { contextWindow: 765432, maxTokens: 4321 } } };
  const extension = { modelMetadata: metadata([[model.id, { contextWindow: 1234567 }], ["unknown", { contextWindow: 1234567 }]]) };
  const before = composeModelProvider(builtin.id, builtin, configured(config), undefined).getAllModels();
  const after = composeModelProvider(builtin.id, builtin, configured(config), extension).getAllModels();
  assert.deepEqual(after, before, "explicit user limits take priority and unknown IDs create nothing");
  const overlaid = composeModelProvider(builtin.id, builtin, configured({ models: [custom] }), extension).getModels();
  assert.deepEqual(overlaid.find((entry) => entry.id === model.id), { ...model, contextWindow: 1234567 });
  assert.deepEqual(overlaid.find((entry) => entry.id === custom.id), before.find((entry) => entry.id === custom.id));
});

test("metadata applies only to chat even when other operations share an ID", () => {
  const classifier = { ...model, type: "classifier" };
  const image = { ...model, type: "image", output: ["image"] };
  const base = { ...builtin, getAllModels: () => [model, classifier, image] };
  const provider = composeModelProvider(base.id, base, configured(undefined), {
    modelMetadata: metadata([[model.id, { contextWindow: 1234567, maxTokens: 7654 }]]),
  });
  assert.deepEqual(provider.getAllModels(), [{ ...model, contextWindow: 1234567, maxTokens: 7654 }, classifier, image]);
});

test("metadata cannot modify identity, transport or authentication, and rejects invalid limits", () => {
  for (const limits of [{ api: "other" }, { baseUrl: "https://other.invalid" }, { headers: {} }, { provider: "other" },
    { contextWindow: 0 }, { contextWindow: -1 }, { contextWindow: 1.5 }, { contextWindow: Infinity },
    { contextWindow: Number.MAX_SAFE_INTEGER + 1 }, { maxTokens: "123" }, null]) {
    assert.throws(() => composeModelProvider(builtin.id, builtin, configured(undefined), {
      modelMetadata: metadata([[model.id, limits]]),
    }), /metadata/);
  }
});

test("invalid metadata registration cannot replace an existing registration", async () => {
  const { ModelRuntime } = await import(pathToFileURL(join(root, "dist/index.js")));
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
    credentials: { read: async () => undefined, list: async () => [], modify: async () => { throw new Error("unexpected write"); }, delete: async () => {} },
    modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} },
  });
  runtime.registerProvider(builtin.id, { modelMetadata: metadata([[model.id, { contextWindow: 1234567 }]]) });
  const registered = runtime.getRegisteredProviderConfig(builtin.id);
  assert.throws(() => runtime.registerProvider(builtin.id, { modelMetadata: metadata([[model.id, { contextWindow: -1 }]]) }), /metadata/);
  assert.equal(runtime.getRegisteredProviderConfig(builtin.id), registered);
  assert.equal(runtime.getModel(builtin.id, model.id).contextWindow, 1234567);
});

test("base catalog failure cannot suppress metadata publication or hide either failure", async () => {
  const baseError = new Error("base catalog unavailable");
  const metadataError = new Error("metadata unavailable");
  const base = { ...builtin, refreshModels: async () => { throw baseError; } };
  let overrides = new Map();
  let failMetadata = false;
  const provider = composeModelProvider(base.id, base, configured(undefined), { modelMetadata: {
    getOverrides: () => overrides,
    refresh: async (context) => {
      await context.publish({ update: () => { overrides = new Map([[model.id, { contextWindow: 1234567 }]]); } });
      if (failMetadata) throw metadataError;
    },
  } });
  const context = { signal: new AbortController().signal, allowNetwork: false,
    publish: async ({ update }) => { update(); return true; } };
  await assert.rejects(provider.refreshModels(context), (error) => error === baseError);
  assert.equal(provider.getModels()[0].contextWindow, 1234567, "base failure must not suppress metadata publication");
  failMetadata = true;
  await assert.rejects(provider.refreshModels(context), (error) => error instanceof AggregateError && error.errors.includes(baseError) && error.errors.includes(metadataError));
});

test("metadata refresh publishes live state but preserves inherited auth and both streaming paths", async () => {
  const calls = [];
  const base = { ...builtin,
    stream: (...args) => { calls.push(["stream", ...args]); throw new Error("fixture transport"); },
    streamSimple: (...args) => { calls.push(["simple", ...args]); throw new Error("fixture transport"); },
  };
  let overrides = new Map();
  const overlay = { getOverrides: () => overrides, refresh: async (context) => {
    await context.publish({ update: () => { overrides = new Map([[model.id, { contextWindow: 1234567 }]]); } });
  } };
  const provider = composeModelProvider(base.id, base, configured(undefined), { modelMetadata: overlay });
  const context = { credential: undefined, allowNetwork: false, signal: new AbortController().signal,
    publish: async ({ update }) => { update(); return true; } };
  await provider.refreshModels({ ...context, publish: async () => false });
  assert.equal(provider.getModels()[0].contextWindow, model.contextWindow);
  await provider.refreshModels({ ...context, signal: AbortSignal.abort() });
  assert.equal(provider.getModels()[0].contextWindow, model.contextWindow);
  await provider.refreshModels(context);
  const selected = provider.getModels()[0];
  assert.equal(selected.contextWindow, 1234567);
  assert.equal(provider.auth.oauth.login, builtin.auth.oauth.login);
  assert.equal(provider.auth.oauth.refresh, builtin.auth.oauth.refresh);
  const credential = { type: "oauth", access: "synthetic", refresh: "synthetic", expires: Date.now() + 3600000 };
  const undecorated = composeModelProvider(base.id, base, configured(undefined), undefined);
  assert.deepEqual(await provider.auth.oauth.toAuth(credential), await undecorated.auth.oauth.toAuth(credential));
  const transcript = { messages: [] };
  const options = { apiKey: "synthetic" };
  await provider.stream(selected, transcript, options).result();
  await provider.streamSimple(selected, transcript, options).result();
  assert.deepEqual(calls, [["stream", selected, transcript, options], ["simple", selected, transcript, options]]);
});
