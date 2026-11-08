import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeRunRequest, encodeRunRequest, decodeRunResult, encodeRunResult,
  ProtocolError, MAX_FRAME_BYTES, MAX_PROMPT_BYTES, versionInfo,
} from "../../target/protocol/protocol/protocol.js";
import { ModelSelection } from "../../target/protocol/generated/typescript/rites/worker/ModelSelection.js";
import { RunRequest } from "../../target/protocol/generated/typescript/rites/worker/RunRequest.js";
import { RunResult } from "../../target/protocol/generated/typescript/rites/worker/RunResult.js";
import { RunOutcome } from "../../target/protocol/generated/typescript/rites/worker/RunOutcome.js";

const runId = "12345678-1234-4123-8123-123456789abc";
const frame = value => new TextEncoder().encode(JSON.stringify(value));
const valid = () => ({
  protocolVersion: "0.1.0", runId, prompt: "Update the synthetic fixture.\n",
  model: { provider: "fixture", model: "fixture-model", thinkingLevel: "high" },
});
const error = code => value => value instanceof ProtocolError && value.code === code;

// Behavioral-Active Blackbox-Atomic; specified worker-boundary contract.
test("generated request codec round-trip preserves multiline Unicode prompt and model selection", () => {
  const model = new ModelSelection("fixture", "fixture-model", "high");
  const request = new RunRequest("0.1.0", runId, "# Task\nChange Δ and 🐎.\n", model);
  const decoded = decodeRunRequest(encodeRunRequest(request));
  assert.equal(decoded.runId, runId);
  assert.equal(decoded.prompt, request.prompt);
  assert.deepEqual(decoded.model.toJSON(), model.toJSON());
});

test("version information advertises only the current worker contract", () => {
  assert.deepEqual(versionInfo().toJSON(), { current: "0.1.0", minimum: "0.1.0", supported: ["0.1.0"] });
});

for (const version of ["0.0.0", "0.2.0", "1.0.0", "latest", ""]) {
  test(`rejects unsupported worker version ${JSON.stringify(version)}`, () => {
    assert.throws(() => decodeRunRequest(frame({ ...valid(), protocolVersion: version })), error("unsupported-version"));
  });
}

for (const [label, change] of [
  ["missing prompt", value => { delete value.prompt; }],
  ["unknown field", value => { value.token = "synthetic-secret"; }],
  ["wrong UUID type", value => { value.runId = 12; }],
  ["malformed UUID", value => { value.runId = "not-a-uuid"; }],
  ["empty prompt", value => { value.prompt = "  \n"; }],
  ["prompt object", value => { value.prompt = {}; }],
  ["unpaired surrogate", value => { value.prompt = "\ud800"; }],
  ["missing model", value => { delete value.model; }],
  ["model array", value => { value.model = []; }],
  ["unknown model field", value => { value.model.apiKey = "synthetic-secret"; }],
  ["empty provider", value => { value.model.provider = ""; }],
  ["model identifier whitespace", value => { value.model.model = " fixture-model"; }],
  ["model identifier control", value => { value.model.model = "fixture\nmodel"; }],
  ["oversized model identifier", value => { value.model.model = "a".repeat(513); }],
  ["unknown thinking level", value => { value.model.thinkingLevel = "turbo"; }],
]) {
  test(`rejects ${label} without echoing input`, () => {
    const value = valid();
    change(value);
    assert.throws(() => decodeRunRequest(frame(value)), error("invalid-frame"));
  });
}

test("prompt limit is UTF-8 bytes, including multibyte text", () => {
  const value = valid();
  value.prompt = "🐎".repeat(MAX_PROMPT_BYTES / 4);
  assert.equal(decodeRunRequest(frame(value)).prompt, value.prompt);
  value.prompt += "a";
  assert.throws(() => decodeRunRequest(frame(value)), error("invalid-frame"));
});

for (const [label, input] of [
  ["empty frame", new Uint8Array()],
  ["oversized frame", new Uint8Array(MAX_FRAME_BYTES + 1)],
  ["invalid UTF-8", new Uint8Array([0xff])],
  ["invalid JSON", new TextEncoder().encode("{")],
  ["multiple messages", new TextEncoder().encode(`${JSON.stringify(valid())}\n${JSON.stringify(valid())}`)],
  ["null root", frame(null)],
  ["array root", frame([])],
]) {
  test(`rejects ${label}`, () => assert.throws(() => decodeRunRequest(input), error("invalid-frame")));
}

for (const [outcome, code] of [
  [RunOutcome.Completed, undefined], [RunOutcome.Failed, "model-error"], [RunOutcome.Cancelled, "deadline"],
]) {
  test(`round-trips terminal outcome ${outcome}`, () => {
    const result = new RunResult("0.1.0", runId, outcome, code);
    const decoded = decodeRunResult(encodeRunResult(result));
    assert.equal(decoded.runId, runId);
    assert.equal(decoded.outcome, outcome);
    assert.equal(decoded.failureCode, code);
  });
}

for (const [outcome, failureCode] of [
  ["Completed", "model-error"], ["Failed", null], ["Cancelled", null], ["Unknown", null],
  ["Failed", "message with synthetic-secret"], ["Failed", "x".repeat(65)],
]) {
  test(`rejects inconsistent or non-machine terminal code ${outcome}/${failureCode}`, () => {
    assert.throws(() => decodeRunResult(frame({ protocolVersion: "0.1.0", runId, outcome, failureCode })), error("invalid-frame"));
  });
}

test("terminal frames reject future protocol versions", () => {
  assert.throws(() => decodeRunResult(frame({ protocolVersion: "1.0.0", runId, outcome: "Completed", failureCode: null })), error("unsupported-version"));
});

test("encoding also enforces protocol invariants", () => {
  assert.throws(() => encodeRunRequest(new RunRequest("0.1.0", runId, "", new ModelSelection("fixture", "fixture-model", "off"))), error("invalid-frame"));
  assert.throws(() => encodeRunResult(new RunResult("0.1.0", runId, RunOutcome.Failed, undefined)), error("invalid-frame"));
});
