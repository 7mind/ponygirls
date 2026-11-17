import assert from "node:assert/strict";
import test from "node:test";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type Api, type AssistantMessage, type AssistantMessageEventStream, type Model, type Provider, type TranscriptContext } from "@earendil-works/pi-ai";
import { NATIVE_CAPABILITY, NATIVE_DELEGATION, NATIVE_PROFILE, type NativeRequestContext, type NativeDelegationV1 } from "../src/native-contract.ts";
import { NativeRpcClient } from "../src/native-framing.ts";
import { GoverningModels } from "../src/parent-models.ts";
import { NativeInferenceService, nativeOptions, type NativeUsage } from "../src/native-service.ts";
import type { IpcEnvelope } from "../src/protocol.ts";

const model: Model<Api> = { id: "native", provider: "native-service-test", api: "native-service-test", name: "Native", baseUrl: "process://fixture", input: ["text", "image"], reasoning: false, contextWindow: 1000, maxTokens: 100, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } };
function message(): AssistantMessage {
  return { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{ type: "thinking", thinking: "reason", thinkingSignature: "signed" }, { type: "text", text: "done" }], timestamp: 1, stopReason: "stop", usage: { input: 7, output: 3, cacheRead: 2, cacheWrite: 1, totalTokens: 13, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10, totalFromProvider: false } } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }

async function fixture(mode: "normal" | "malformed" | "late" | "overflow" | "pending", auth: Promise<void>) {
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  let registry = new ModelRegistry(runtime);
  const original = deferred<AssistantMessage>();
  const entered = deferred<void>();
  const receipts: Array<{ usage: NativeUsage; id: string; owner: IpcEnvelope }> = [];
  const disposals: string[] = [];
  const contexts: TranscriptContext[] = [];
  const cacheIds: Array<string | undefined> = [];
  let entries = 0;
  let allowed = true;
  let commitAllowed = true;
  const cap: NativeDelegationV1 = { version: 1, apis: [model.api], requestProfile: NATIVE_PROFILE, disposeSession: async (id: string) => { disposals.push(id); } };
  const provider: Provider = {
    id: model.provider, name: model.provider, baseUrl: model.baseUrl, getModels: () => [model],
    auth: { apiKey: { name: "fixture", check: async () => ({ type: "api_key", source: "fixture" }), resolve: async () => { entered.resolve(); await auth; return { auth: { apiKey: "private-placeholder" }, source: "fixture" }; } } },
    stream: () => { throw new Error("unused stream"); },
    streamSimple: (_model, _context, options) => {
      const metadata = options!.metadata![NATIVE_DELEGATION] as NativeRequestContext;
      metadata.beforeEntry(cap);
      entries++;
      contexts.push(structuredClone(_context));
      cacheIds.push(options!.sessionId);
      const raw = mode === "normal" || mode === "overflow" ? createAssistantMessageEventStream() : {
        result: () => original.promise,
        [Symbol.asyncIterator]: () => ({ next: async () => { if (mode === "pending") { await original.promise; return { done: true as const, value: undefined }; } throw new Error("malformed native iterator"); } }),
      } as unknown as AssistantMessageEventStream;
      const captured = metadata.captureOriginal(raw);
      if (mode === "overflow") for (let i = 0; i < 2048; i++) raw.push({ type: "text_delta", contentIndex: 0, delta: "text", partial: message() });
      if (mode === "normal" || mode === "overflow") { raw.push({ type: "done", reason: "stop", message: message() }); raw.end(); }
      else if (mode === "malformed") original.resolve(message());
      return captured;
    },
  };
  Object.defineProperty(provider, NATIVE_CAPABILITY, { value: cap });
  registry.registerProvider(provider);
  const source = new GoverningModels(() => registry);
  const admitted = source.describe({ provider: model.provider, id: model.id, thinkingLevel: "off" })!;
  const envelope: IpcEnvelope = { protocolVersion: 1, rootEpoch: "epoch", agentId: "agent", workerInstanceId: "worker", taskRunId: "original-task", executionGeneration: 7, operation: "provider.native", type: "request", requestId: "request", seq: 1, payload: null };
  const service = new NativeInferenceService({ binding: () => source.nativeBinding(admitted), cwd: process.cwd(), assertOwner: () => { if (!allowed) throw new Error("POLICY_DENIED: hold"); }, receipt: (owner, id, usage) => { receipts.push({ owner, id, usage }); return commitAllowed; } });
  const client = new NativeRpcClient();
  const call = (value: unknown) => client.call((frame) => service.handle(frame, envelope), value);
  const start = () => call({ kind: "start", context: { messages: [{ role: "user", content: "private prompt", timestamp: 0 }] }, options: {} }) as Promise<{ id: string }>;
  return { service, call, start, original, entered, receipts, disposals, contexts, cacheIds, entries: () => entries, hold: () => { allowed = false; }, failCommit: () => { commitAllowed = false; }, replace: () => { registry = new ModelRegistry(runtime); } };
}

for (const mode of ["normal", "malformed", "late"] as const) {
  test(`BG native ${mode} stream preserves invocation-owned original usage`, async () => {
    const f = await fixture(mode, Promise.resolve());
    try {
      const { id } = await f.start();
      const final = f.call({ kind: "result", id });
      const first = await f.call({ kind: "next", id }) as { done: boolean; event: { type: string } };
      assert.equal(first.done, false);
      if (mode === "late") {
        assert.equal(f.receipts.length, 1);
        assert.equal(f.receipts[0]!.usage.unknown, true);
        f.replace();
        f.original.resolve(message());
      }
      await final;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(f.entries(), 1);
      assert.equal(f.receipts.length, mode === "late" ? 2 : 1);
      const known = f.receipts.at(-1)!;
      assert.equal(known.owner.taskRunId, "original-task");
      assert.equal(known.owner.executionGeneration, 7);
      assert.deepEqual(known.usage, { input: 10, output: 3, cacheRead: 2, cacheWrite: 1, cost: 10, unknown: false, sourceModel: { provider: model.provider, id: model.id, api: model.api } });
    } finally { await f.service.dispose(); }
    assert.equal(f.disposals.length, 1);
  });
}

for (const revocation of ["hold", "registry", "dispose"] as const) {
  test(`BG ${revocation} revocation after asynchronous auth prevents native entry`, async () => {
    const auth = deferred<void>();
    const f = await fixture("normal", auth.promise);
    const { id } = await f.start();
    const result = f.call({ kind: "result", id });
    void result.catch(() => {});
    await f.entered.promise;
    if (revocation === "hold") f.hold();
    if (revocation === "registry") f.replace();
    const closing = revocation === "dispose" ? f.service.dispose() : Promise.resolve();
    auth.resolve();
    await result.catch(() => {});
    await closing;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.entries(), 0);
    await f.service.dispose();
  });
}

test("BA the native profile preserves the SDK's supported maximum reasoning effort", () => {
  assert.deepEqual(nativeOptions({ reasoning: "max" }), { reasoning: "max" });
});

test("BA native option literals are validated without coercing arrays", () => {
  assert.throws(() => nativeOptions({ reasoning: ["high"] }), /INVALID/);
  assert.throws(() => nativeOptions({ cacheRetention: ["none"] }), /INVALID/);
});

test("BG absent cache hints remain absent while explicit hints are privately namespaced", async () => {
  const f = await fixture("normal", Promise.resolve());
  try {
    const first = await f.start();
    await Promise.all([f.call({ kind: "result", id: first.id }), f.call({ kind: "next", id: first.id })]);
    assert.equal(f.cacheIds[0], undefined);
    const { id } = await f.call({ kind: "start", context: { messages: [{ role: "user", content: "summary", timestamp: 0 }] }, options: { sessionId: "summary" } }) as { id: string };
    await Promise.all([f.call({ kind: "result", id }), f.call({ kind: "next", id })]);
    assert.equal(f.cacheIds[1], `${f.service.lifecycleSessionId}:summary`);
  } finally { await f.service.dispose(); }
});

test("BG supported canonical image and multibyte text cross multiple bounded frames intact", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=", "base64");
  const type = Buffer.from("tEXt");
  const data = Buffer.from("fixture\0" + "a".repeat(1024 * 1024));
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  const image = Buffer.concat([png.subarray(0, -12), size, type, data, checksum, png.subarray(-12)]).toString("base64");
  const message = { role: "user" as const, timestamp: 0, content: [{ type: "text" as const, text: "🦄漢字".repeat(40_000) }, { type: "image" as const, data: image, mimeType: "image/png" }] };
  const f = await fixture("normal", Promise.resolve());
  try {
    const { id } = await f.call({ kind: "start", context: { messages: [message] }, options: {} }) as { id: string };
    await Promise.all([f.call({ kind: "result", id }), f.call({ kind: "next", id })]);
    assert.deepEqual(f.contexts[0]!.messages.find((entry) => entry.role === "user"), message);
    assert.equal(f.receipts.length, 1);
  } finally { await f.service.dispose(); }
});

test("BG channel revocation records unknown immediately and preserves late original billing", async () => {
  const f = await fixture("pending", Promise.resolve());
  try {
    await f.start();
    await new Promise((resolve) => setImmediate(resolve));
    f.service.cancel();
    assert.equal(f.receipts.length, 1);
    assert.equal(f.receipts[0]!.usage.unknown, true);
    f.original.resolve(message());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.receipts.length, 2);
    assert.equal(f.receipts[1]!.usage.input, 10);
  } finally { await f.service.dispose(); }
});

test("BG an unsettled raw original is accounted as unknown, never synthesized zero", async () => {
  const f = await fixture("late", Promise.resolve());
  try {
    const { id } = await f.start();
    await f.call({ kind: "result", id });
    assert.equal(f.receipts.length, 1);
    assert.equal(f.receipts[0]!.usage.unknown, true);
    f.original.resolve(message());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.receipts.length, 2);
    assert.equal(f.receipts[1]!.usage.input, 10);
    assert.notEqual(f.receipts[0]!.id, f.receipts[1]!.id);
  } finally { await f.service.dispose(); }
});

test("BG failed raw receipt persistence cannot acknowledge successful native completion", async () => {
  const f = await fixture("normal", Promise.resolve());
  f.failCommit();
  try {
    const { id } = await f.start();
    await assert.rejects(f.call({ kind: "result", id }), /STORE_FAILED/);
    assert.equal(f.receipts.length, 1);
    assert.equal(f.receipts[0]!.usage.input, 10);
  } finally { await f.service.dispose(); }
});

test("BG unconsumed push-source overflow cancels visibly without erasing original usage", async () => {
  const f = await fixture("overflow", Promise.resolve());
  try {
    const { id } = await f.start();
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(f.call({ kind: "next", id }), /overflow/);
    assert.equal(f.receipts.length, 1);
    assert.equal(f.receipts[0]!.usage.input, 10);
  } finally { await f.service.dispose(); }
});

test("BG completed native invocations release capacity for repeated continuations", async () => {
  const f = await fixture("normal", Promise.resolve());
  try {
    for (let i = 0; i < 20; i++) {
      const { id } = await f.start();
      await Promise.all([f.call({ kind: "result", id }), f.call({ kind: "next", id })]);
    }
    assert.equal(f.receipts.length, 20);
    assert.equal(new Set(f.receipts.map((r) => r.id)).size, 20);
  } finally { await f.service.dispose(); }
});
