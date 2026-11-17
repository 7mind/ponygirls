import assert from "node:assert/strict";
import test from "node:test";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, InMemoryCredentialStore, normalizeContext, type Api, type AssistantMessage, type AssistantMessageEventStream, type Model, type Provider } from "@earendil-works/pi-ai";
import { NATIVE_CAPABILITY, NATIVE_DELEGATION, NATIVE_PROFILE, type NativeDelegationV1, type NativeRequestContext } from "../src/native-contract.ts";
import { nativeModelProxy } from "../src/native-proxy.ts";
import { NativeInferenceService, type NativeUsage } from "../src/native-service.ts";
import { GoverningModels } from "../src/parent-models.ts";
import type { IpcEnvelope } from "../src/protocol.ts";
import { adaptStream } from "../src/stream-facade.ts";

const COMPLETION_BOUND_MS = 250;

async function fixture(endWithResult: boolean) {
  const model: Model<Api> = { id: "bare-end", provider: "native-bare-end", api: "native-bare-end", name: "Native", baseUrl: "process://fixture", input: ["text"], reasoning: false, contextWindow: 8192, maxTokens: 256, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } };
  const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{ type: "text", text: "genuine result" }], timestamp: 1, stopReason: "stop", usage: { input: 7, output: 3, cacheRead: 2, cacheWrite: 1, totalTokens: 13, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } } };
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const registry = new ModelRegistry(runtime);
  const raw = createAssistantMessageEventStream();
  const receipts: Array<{ id: string; usage: NativeUsage }> = [];
  let iterators = 0;
  const exposed = { result: () => raw.result(), [Symbol.asyncIterator]: () => { iterators++; return raw[Symbol.asyncIterator](); } } as unknown as AssistantMessageEventStream;
  const cap: NativeDelegationV1 = { version: 1, apis: [model.api], requestProfile: NATIVE_PROFILE, disposeSession: async () => {} };
  const provider: Provider = {
    id: model.provider, name: model.provider, baseUrl: model.baseUrl, getModels: () => [model],
    auth: { apiKey: { name: "fixture", resolve: async () => ({ auth: { apiKey: "fixture" }, source: "fixture" }) } },
    stream: () => { throw new Error("unused stream"); },
    streamSimple: (_model, _context, options) => {
      const metadata = options!.metadata![NATIVE_DELEGATION] as NativeRequestContext;
      metadata.beforeEntry(cap);
      const captured = metadata.captureOriginal(exposed);
      if (endWithResult) raw.end(message); else raw.end();
      return captured;
    },
  };
  Object.defineProperty(provider, NATIVE_CAPABILITY, { value: cap });
  registry.registerProvider(provider);
  const source = new GoverningModels(() => registry);
  const admitted = source.describe({ provider: model.provider, id: model.id, thinkingLevel: "off" })!;
  const envelope: IpcEnvelope = { protocolVersion: 1, rootEpoch: "epoch", agentId: "agent", workerInstanceId: "worker", taskRunId: "original-task", executionGeneration: 7, operation: "provider.native", type: "request", requestId: "request", seq: 1, payload: null };
  const service = new NativeInferenceService({ binding: () => source.nativeBinding(admitted), cwd: process.cwd(), assertOwner: () => {}, receipt: (_owner, id, usage) => { receipts.push({ id, usage }); return true; } });
  const proxy = nativeModelProxy(admitted, () => (frame) => service.handle(frame, envelope));
  const stream = adaptStream(proxy.streamSimple(admitted, normalizeContext({ messages: [{ role: "user", content: "fixture", timestamp: 0 }] })), {}, { taskRunId: "original-task", generation: 7 });
  return { stream, raw, message, receipts, service, iterators: () => iterators };
}

async function withinBound<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("native original completion remained pending")), COMPLETION_BOUND_MS); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

test("BG native bare original EOF rejects promptly through SDK composition with one raw iterator", async () => {
  const f = await fixture(false);
  try {
    await assert.rejects(withinBound(f.stream.result()), /STREAM_ENDED_WITHOUT_MESSAGE/);
    assert.equal(f.iterators(), 1);
    assert.equal(f.receipts.length, 1);
    assert.equal(f.receipts[0]!.usage.unknown, true);
  } finally { await f.service.dispose(); }
});

test("BG native bare EOF keeps uncertainty and independently accounts a late genuine result once", async () => {
  const f = await fixture(false);
  try {
    await assert.rejects(withinBound(f.stream.result()), /STREAM_ENDED_WITHOUT_MESSAGE/);
    assert.equal(f.receipts.length, 1);
    f.raw.end(f.message);
    await new Promise((resolve) => setImmediate(resolve));
    f.raw.end(f.message);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.iterators(), 1);
    assert.equal(f.receipts.length, 2);
    assert.equal(f.receipts[0]!.usage.unknown, true);
    assert.equal(f.receipts[1]!.usage.unknown, false);
    assert.equal(f.receipts[1]!.usage.input, 10);
    assert.notEqual(f.receipts[0]!.id, f.receipts[1]!.id);
    assert.equal(f.receipts.reduce((sum, receipt) => sum + receipt.usage.input, 0), 10);
  } finally { await f.service.dispose(); }
});

test("BG native original end(message) without terminal events preserves successful result and usage", async () => {
  const f = await fixture(true);
  try {
    assert.deepEqual(await withinBound(f.stream.result()), f.message);
    assert.equal(f.iterators(), 1);
    assert.equal(f.receipts.length, 1);
    assert.equal(f.receipts[0]!.usage.unknown, false);
    assert.equal(f.receipts[0]!.usage.input, 10);
  } finally { await f.service.dispose(); }
});
