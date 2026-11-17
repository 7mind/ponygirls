import assert from "node:assert/strict";
import test from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { BackendRegistry, BackendSlot, registerBackendHost } from "../src/backends.ts";
import { BACKEND_OFFER_CHANNEL, parseBackendWorker, type BackendOffer, type BackendOfferResult, type BackendRegistration, type BackendSessionContext, type BackendUsage } from "../src/backend-contract.ts";
import type { IpcEnvelope } from "../src/protocol.ts";
import { backendRegistryContract } from "./backend-contract-fixture.ts";

const selected = { provider: "backend-fixture", id: "model", thinkingLevel: "off" };
const unselected = { ...selected, provider: "stock-fixture" };
const envelope: IpcEnvelope = { protocolVersion: 1, rootEpoch: "root", agentId: "agent", workerInstanceId: "worker", taskRunId: "task", executionGeneration: 3, operation: "provider.backend", type: "request", requestId: "request", seq: null, payload: null };
const usage: BackendUsage = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0, unknown: false };

function dummyRegistration(): BackendRegistration {
  return {
    version: 1, id: "dummy", usageOwnership: "parent",
    claims: (model) => model.provider === selected.provider,
    worker: () => ({ version: 1, backendId: "dummy", moduleUrl: new URL("./fake-worker.ts", import.meta.url).href, initialization: { fixture: true } }),
    createSession: () => ({ handle: async (payload) => payload, cancel: () => {}, refreshAuthority: async () => {}, dispose: async () => {} }),
  };
}

backendRegistryContract("in-memory backend", async () => ({ registration: dummyRegistration(), selected, unselected, dispose: async () => {} }));

test("BA backend worker initialization rejects executable values, non-local modules and oversize JSON", () => {
  const descriptor = dummyRegistration().worker(selected);
  for (const moduleUrl of ["https://example.invalid/worker.ts", "file://remote/worker.ts", "file:///worker.ts?selected=true"]) assert.throws(() => parseBackendWorker({ ...descriptor, moduleUrl }), /local trusted file/);
  for (const initialization of [{ callback: () => {} }, undefined, { number: Infinity }]) assert.throws(() => parseBackendWorker({ ...descriptor, initialization }), /must be JSON/);
  assert.throws(() => parseBackendWorker({ ...descriptor, initialization: "x".repeat(64 * 1024) }), /exceeds its bound/);
});

test("BG bus handshake returns explicit acknowledgements despite caught event-handler exceptions", () => {
  const bus = createEventBus();
  const registry = new BackendRegistry();
  const stop = registerBackendHost(bus, registry);
  const replies: BackendOfferResult[] = [];
  const offer: BackendOffer = { version: 1, registration: dummyRegistration(), respond: (result) => { replies.push(result); } };
  bus.emit(BACKEND_OFFER_CHANNEL, offer);
  bus.emit(BACKEND_OFFER_CHANNEL, offer);
  assert.equal(replies.length, 2);
  assert.equal(replies[0]!.ok, true);
  assert.equal(replies[1]!.ok, false);
  if (!replies[1]!.ok) assert.match(replies[1]!.error, /duplicate backend identity/);
  stop();
  assert.equal(registry.select(selected), null);
});

test("BG claimed binding failure is visible and does not fall back to a stock worker", () => {
  const registry = new BackendRegistry();
  const registration = { ...dummyRegistration(), worker: () => { throw new Error("controlled claimed binding failure"); } };
  registry.register(registration);
  assert.throws(() => new BackendSlot(registry.select(selected)!, () => registry, { model: selected, cwd: process.cwd(), assertOwner: () => {}, receipt: () => true, reportFailure: () => {} }), /claimed binding failure/);
});

test("BG backend slots revoke synchronously, join old disposal and rebind current registration without replaying old sessions", async () => {
  let registry = new BackendRegistry();
  const events: string[] = [];
  const disposal = Promise.withResolvers<void>();
  const first = { ...dummyRegistration(), createSession: () => ({ handle: async () => "first", cancel: () => { events.push("cancel-first"); }, refreshAuthority: async () => {}, dispose: async () => { events.push("disposing-first"); await disposal.promise; events.push("disposed-first"); } }) };
  const unregister = registry.register(first);
  const slot = new BackendSlot(first, () => registry, { model: selected, cwd: process.cwd(), assertOwner: () => {}, receipt: () => true, reportFailure: () => {} });
  assert.equal(await slot.handle({}, envelope), "first");
  unregister();
  assert.deepEqual(events, ["cancel-first", "disposing-first"]);
  registry = new BackendRegistry();
  registry.register({ ...dummyRegistration(), createSession: () => ({ handle: async () => { events.push("entered-second"); return "second"; }, cancel: () => {}, refreshAuthority: async () => {}, dispose: async () => {} }) });
  const next = slot.handle({}, envelope);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.includes("entered-second"), false);
  disposal.resolve();
  assert.equal(await next, "second");
  assert.deepEqual(events, ["cancel-first", "disposing-first", "disposed-first", "entered-second"]);
  await slot.dispose();
  await assert.rejects(slot.handle({}, envelope), /retired/);
});

test("BG parent receipt sinks retain immutable admitted identities after generation revocation", async () => {
  const registry = new BackendRegistry();
  let captured: { context: BackendSessionContext; envelope: IpcEnvelope } | null = null;
  const registration = { ...dummyRegistration(), createSession: (context: BackendSessionContext) => ({ handle: async (_payload: unknown, owned: IpcEnvelope) => { captured = { context, envelope: owned }; return null; }, cancel: () => {}, refreshAuthority: async () => {}, dispose: async () => {} }) };
  const unregister = registry.register(registration);
  const receipts: Array<{ owner: IpcEnvelope; id: string }> = [];
  let active = true;
  const slot = new BackendSlot(registration, () => registry, { model: selected, cwd: process.cwd(), assertOwner: () => { if (!active) throw new Error("generation revoked"); }, receipt: (owner, id) => { receipts.push({ owner, id }); return true; }, reportFailure: () => {} });
  const source = { ...envelope };
  await slot.handle({}, source);
  assert.ok(captured);
  const invocation = captured as { context: BackendSessionContext; envelope: IpcEnvelope };
  source.taskRunId = "forged";
  active = false;
  unregister();
  assert.equal(invocation.context.receipt(invocation.envelope, "raw-original", usage), true);
  assert.equal(receipts[0]!.owner.taskRunId, "task");
  assert.equal(receipts[0]!.owner.executionGeneration, 3);
  for (const malformed of [{ ...usage, reasoning: NaN }, { ...usage, reasoning: -1 }, { ...usage, unknown: "known" }, { ...usage, sourceModel: { provider: "fixture", id: "model" } }]) {
    assert.throws(() => invocation.context.receipt(invocation.envelope, "malformed", malformed as unknown as BackendUsage), /invalid backend usage/);
  }
  assert.throws(() => invocation.context.receipt(source, "forged", usage), /identity mismatch/);
  assert.throws(() => invocation.context.assertOwner(invocation.envelope), /revoked/);
  await slot.dispose();
});

test("BG backend cleanup failure is reported to the owning supervisor and remains a re-entry barrier", async () => {
  const registry = new BackendRegistry();
  const failure = new Error("controlled backend cleanup failure");
  const registration = { ...dummyRegistration(), createSession: () => ({ handle: async () => null, cancel: () => {}, refreshAuthority: async () => {}, dispose: async () => { throw failure; } }) };
  const unregister = registry.register(registration);
  const failures: unknown[] = [];
  const context = { model: selected, cwd: process.cwd(), assertOwner: () => {}, receipt: () => true, reportFailure: (error: unknown) => { failures.push(error); } };
  const slot = new BackendSlot(registration, () => registry, context);
  await slot.handle({}, envelope);
  unregister();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failures, [failure]);
  await assert.rejects(slot.dispose(), failure);
});
