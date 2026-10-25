/** BA/BG: public provider metadata and request-auth boundaries. */
import assert from "node:assert/strict";
import test from "node:test";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { normalizeContext, type Api, type Model } from "@earendil-works/pi-ai";
import { GoverningModels, parentModelProvider, parseParentModel, parseProviderRequestAuth } from "../src/parent-models.ts";

const SECRET = "private-parent-value";
type Registration = NonNullable<ReturnType<ModelRegistry["getRegisteredProviderConfig"]>>;

function fixture() {
  const model: Model<Api> = {
    id: "model", provider: "parent", name: "Parent model", api: "openai-completions", baseUrl: "https://example.invalid/v1",
    input: ["text"], reasoning: false, contextWindow: 8192, maxTokens: 256,
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    headers: { Authorization: SECRET }, compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
  };
  const selected = { provider: model.provider, id: model.id, thinkingLevel: "off" };
  const state: {
    registration: Registration | undefined;
    resolve: ModelRegistry["getApiKeyAndHeaders"];
  } = {
    registration: { api: model.api, baseUrl: model.baseUrl, apiKey: SECRET, models: [model] },
    resolve: async () => ({ ok: true, apiKey: SECRET, headers: { Authorization: SECRET } }),
  };
  const registry = {
    find: (provider: string, id: string) => provider === model.provider && id === model.id ? model : undefined,
    getRegisteredProviderConfig: () => state.registration,
    getRegisteredNativeProvider: () => undefined,
    getApiKeyAndHeaders: (...args: Parameters<ModelRegistry["getApiKeyAndHeaders"]>) => state.resolve(...args),
  };
  return { model, selected, state, registry, source: new GoverningModels(() => registry) };
}

test("selected public metadata is cloned without model headers or registration credentials", () => {
  const f = fixture();
  const descriptor = f.source.describe(f.selected);
  assert.ok(descriptor);
  assert.equal(descriptor.headers, undefined);
  assert.equal(JSON.stringify(descriptor).includes(SECRET), false);
  assert.deepEqual(descriptor.compat, f.model.compat);
  f.model.cost.input = 99;
  assert.equal(descriptor.cost.input, 1);
  f.state.registration = undefined;
  assert.equal(f.source.describe(f.selected), null, "builtin/file-only providers retain their existing path");
});

test("custom extension streams and absent selected models fail without falling back", () => {
  const f = fixture();
  assert.throws(() => f.source.describe({ ...f.selected, id: "absent" }), { code: "MODEL_UNAVAILABLE" });
  f.state.registration = { streamSimple: () => { throw new Error("must never execute"); } };
  assert.throws(() => f.source.describe(f.selected), { code: "MODEL_UNAVAILABLE" });
});

test("native providers are rejected instead of silently losing their implementation", () => {
  const f = fixture();
  const native = parentModelProvider(f.model, { stream() { throw new Error("unused"); }, streamSimple() { throw new Error("unused"); } }, async () => ({ apiKey: SECRET }));
  const source = new GoverningModels(() => ({ ...f.registry, getRegisteredNativeProvider: () => native }));
  assert.throws(() => source.describe(f.selected), { code: "MODEL_UNAVAILABLE" });
});

test("provider checks are side-effect-free and endpoints are authorized only by current request auth", async () => {
  const f = fixture();
  let resolutions = 0;
  let endpoint = "https://tenant.invalid/v1";
  const provider = parentModelProvider(f.model, { stream() { throw new Error("stock transport"); }, streamSimple() { throw new Error("stock transport"); } }, async () => { resolutions++; return { apiKey: SECRET, baseUrl: endpoint }; });
  const auth = provider.auth.apiKey;
  assert.ok(auth);
  assert.ok(auth.check);
  const input = { ctx: { env: async () => undefined, fileExists: async () => false }, signal: new AbortController().signal };
  await auth.check(input);
  assert.equal(resolutions, 0);
  assert.equal(provider.matchesRequest({ ...f.model, baseUrl: endpoint }), false);
  await auth.resolve(input);
  assert.equal(provider.matchesRequest({ ...f.model, baseUrl: endpoint }), true);
  assert.equal(provider.matchesRequest({ ...f.model, id: "other", baseUrl: endpoint }), false);
  const summaryModel = { ...f.model, baseUrl: endpoint };
  const prepared = provider.prepareRequest(summaryModel, { apiKey: SECRET, headers: { Authorization: SECRET }, env: { ACCOUNT: "old-scope" }, temperature: 0.2 });
  assert.equal(prepared.model.baseUrl, f.model.baseUrl);
  assert.deepEqual(prepared.options, { temperature: 0.2 });
  const retired = endpoint;
  endpoint = "https://next.invalid/v1";
  await auth.resolve(input);
  assert.equal(provider.matchesRequest({ ...f.model, baseUrl: retired }), false);
  assert.equal(provider.matchesRequest(summaryModel), true, "the same SDK summary can prepare its second half");
  assert.equal(provider.prepareRequest(summaryModel, prepared.options).model.baseUrl, f.model.baseUrl);
  summaryModel.baseUrl = "https://unapproved.invalid";
  assert.equal(provider.matchesRequest(summaryModel), false);
  const context = normalizeContext({ messages: [] });
  assert.throws(() => provider.streamSimple({ ...f.model, baseUrl: retired }, context), { code: "POLICY_DENIED" });
  assert.throws(() => provider.streamSimple({ ...f.model, baseUrl: endpoint }, context), /stock transport/);
});

test("parent authentication is resolved each time and provider errors do not echo secrets", async () => {
  const f = fixture();
  const descriptor = f.source.describe(f.selected)!;
  assert.deepEqual(await f.source.resolveAuth(descriptor), { ok: true, apiKey: SECRET, headers: { Authorization: SECRET } });
  f.state.resolve = async () => ({ ok: true, apiKey: "rotated" });
  assert.deepEqual(await f.source.resolveAuth(descriptor), { ok: true, apiKey: "rotated" });
  f.state.resolve = async () => { throw new Error(SECRET); };
  const failure = await f.source.resolveAuth(descriptor);
  assert.equal(failure.ok, false);
  assert.equal(JSON.stringify(failure).includes(SECRET), false);
});

for (const change of ["registry", "registration"] as const) {
  test(`auth resolved before a ${change} replacement is not returned to the worker`, async () => {
    const f = fixture();
    let current = f.registry;
    const source = new GoverningModels(() => current);
    const descriptor = source.describe(f.selected)!;
    let release!: (value: Awaited<ReturnType<ModelRegistry["getApiKeyAndHeaders"]>>) => void;
    f.state.resolve = () => new Promise((resolve) => { release = resolve; });
    const pending = source.resolveAuth(descriptor);
    if (change === "registry") current = { ...f.registry };
    else f.state.registration = { ...f.state.registration! };
    release({ ok: true, apiKey: SECRET });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  });
}

test("endpoint/API drift refuses authentication and requires a worker reload", async () => {
  const f = fixture();
  const descriptor = f.source.describe(f.selected)!;
  f.model.baseUrl = "https://other.invalid/v1";
  assert.equal((await f.source.resolveAuth(descriptor)).ok, false);
  f.model.baseUrl = descriptor.baseUrl;
  f.model.api = "anthropic-messages";
  assert.equal((await f.source.resolveAuth(descriptor)).ok, false);
});

test("descriptor boundary rejects identity changes, credentials, executables and oversized metadata", () => {
  const f = fixture();
  const descriptor = f.source.describe(f.selected)!;
  assert.throws(() => parseParentModel({ ...descriptor, id: "other" }, f.selected), { code: "POLICY_DENIED" });
  for (const extra of [{ headers: { Authorization: SECRET } }, { apiKey: SECRET }, { samplingParams: { callback() {} } }, { maxTokens: 0 }]) {
    assert.throws(() => parseParentModel({ ...descriptor, ...extra }, f.selected));
  }
  assert.throws(() => parseParentModel({ ...descriptor, name: "x".repeat(64 * 1024) }, f.selected), { code: "PAYLOAD_TOO_LARGE" });
});

test("private auth is bounded and does not accept arbitrary config or ambient environment", () => {
  assert.deepEqual(parseProviderRequestAuth({ apiKey: SECRET, headers: { Authorization: SECRET, Drop: null }, env: { ACCOUNT: "provider-scope" } }).env, { ACCOUNT: "provider-scope" });
  for (const invalid of [{ apiKey: 5 }, { env: { KEY: 1 } }, { headers: { Authorization: false } }, { baseUrl: "file:///private" }, { command: SECRET }, { apiKey: "x".repeat(32 * 1024) }]) {
    assert.throws(() => parseProviderRequestAuth(invalid), (error: unknown) => {
      assert.equal(error instanceof Error && error.message.includes(SECRET), false);
      return true;
    });
  }
});
