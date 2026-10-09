import assert from "node:assert/strict";
import test from "node:test";
import { bindChannel, validateEnvelope, validateInitializePayload } from "../src/protocol.ts";
import { PROTOCOL_VERSION } from "../src/types.ts";

const BINDING = bindChannel("epoch-1", "agent-1", "instance-1");

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: 1,
    rootEpoch: "epoch-1",
    agentId: "agent-1",
    workerInstanceId: "instance-1",
    requestId: null,
    seq: 0,
    type: "request",
    operation: "deliver",
    taskRunId: null,
    executionGeneration: null,
    payload: {},
    ...overrides,
  };
}

test("accepts a well-formed supervisor->worker deliver envelope", () => {
  const res = validateEnvelope(envelope(), BINDING, "to-worker");
  assert.equal(res.ok, true);
});

test("rejects protocol version mismatch", () => {
  const res = validateEnvelope(envelope({ protocolVersion: 999 }), BINDING, "to-worker");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "PROTOCOL_VERSION_MISMATCH");
});

test("rejects stale epoch (fencing)", () => {
  const res = validateEnvelope(envelope({ rootEpoch: "epoch-old" }), BINDING, "to-worker");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "STALE_EPOCH");
});

test("rejects forged agent identity", () => {
  const res = validateEnvelope(envelope({ agentId: "agent-9" }), BINDING, "to-worker");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "FORGED_AUTHOR");
});

test("rejects stale worker instance", () => {
  const res = validateEnvelope(envelope({ workerInstanceId: "instance-old" }), BINDING, "to-worker");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "STALE_INSTANCE");
});

test("rejects unknown operations before performing work", () => {
  const res = validateEnvelope(envelope({ operation: "rm -rf" }), BINDING, "to-worker");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "UNKNOWN_OPERATION");
});

test("rejects worker->supervisor ops on the wrong direction", () => {
  const res = validateEnvelope(envelope({ operation: "tool.execute", type: "request" }), BINDING, "to-worker");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "UNKNOWN_OPERATION");
});

test("accepts tool.execute from the worker direction", () => {
  const res = validateEnvelope(envelope({ operation: "tool.execute", type: "request" }), BINDING, "from-worker");
  assert.equal(res.ok, true);
});

test("rejects oversized payloads", () => {
  const big = "x".repeat(300 * 1024);
  const res = validateEnvelope(envelope({ payload: { blob: big } }), BINDING, "to-worker");
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, "PAYLOAD_TOO_LARGE");
});

test("rejects non-object envelopes", () => {
  assert.equal(validateEnvelope(null, BINDING, "to-worker").ok, false);
  assert.equal(validateEnvelope("hello", BINDING, "to-worker").ok, false);
});

test("tool.execute responses answer worker requests (correlation, no new authority)", () => {
  const res = validateEnvelope(envelope({ operation: "tool.execute", type: "response", requestId: "r-1" }), BINDING, "to-worker");
  assert.equal(res.ok, true);
  const req = validateEnvelope(envelope({ operation: "tool.execute", type: "request" }), BINDING, "to-worker");
  assert.equal(req.ok, false);
});

test("initialize payload requires task text, profile, model, run ids, instructions", () => {
  assert.equal(validateInitializePayload(null).ok, false);
  assert.equal(validateInitializePayload({}).ok, false);
  const good = {
    taskText: "do it",
    profile: "reader",
    instructionHash: "",
    instructions: { contextFiles: [{ path: "/p/AGENTS.md", content: "x" }], skills: [] },
    model: { provider: "p", id: "m", thinkingLevel: "low" },
    taskRunId: "t-1",
    executionGeneration: 1,
    workdir: "/tmp",
    readRoots: [],
    writable: false,
    tools: ["read"],
  };
  const res = validateInitializePayload(good);
  assert.equal(res.ok, true);
  // Loading without inference is explicit (null task text); the exact
  // tool allowlist is required.
  assert.equal(validateInitializePayload({ ...good, taskText: null }).ok, true);
  assert.equal(validateInitializePayload({ ...good, tools: undefined }).ok, false);
  assert.equal(validateInitializePayload({ ...good, instructions: undefined }).ok, false);
  assert.equal(validateInitializePayload({ ...good, instructions: { contextFiles: [{ path: "/p/AGENTS.md" }], skills: [] } }).ok, false);
  // An omitted result limit is the default bound; a given one must lie within the allowed range.
  assert.equal(validateInitializePayload({ ...good, resultLimit: 100_000 }).ok, true);
  assert.equal(validateInitializePayload({ ...good, resultLimit: 10_000_000 }).ok, false);
  assert.equal(validateInitializePayload({ ...good, resultLimit: 100 }).ok, false);
  assert.equal(validateInitializePayload({ ...good, resultLimit: "many" }).ok, false);
  assert.equal(PROTOCOL_VERSION, 1);
});
