// MODEL_CONFIG validation unit tests. Behavioral-Active Blackbox-Atomic: each
// case exercises parseModelConfig with crafted bytes and asserts the class of
// rejection without echoing values.

import assert from "node:assert/strict";
import test from "node:test";
import { parseModelConfig } from "../../target/worker/worker/model-config.js";
import { InvalidModelConfigError } from "../../target/worker/worker/model-config.js";

const valid = () => ({
  provider: "fixture-provider",
  modelsJson: { providers: { "fixture-provider": { baseUrl: "http://127.0.0.1:1/v1", api: "openai-completions", models: [{ id: "fixture-model" }] } } },
  credential: { type: "api_key", key: "synthetic-secret" },
});

const encode = value => Buffer.from(JSON.stringify(value));
const rejects = value => {
  assert.throws(() => parseModelConfig(encode(value)), error => error instanceof InvalidModelConfigError);
};

test("accepts a valid selected-provider model config", () => {
  const parsed = parseModelConfig(encode(valid()));
  assert.equal(parsed.provider, "fixture-provider");
  assert.equal(parsed.credential.type, "api_key");
  assert.equal(parsed.credential.key, "synthetic-secret");
  assert.deepEqual(Object.keys(parsed.modelsJson.providers), ["fixture-provider"]);
});

test("rejects malformed bytes without echoing them", () => {
  assert.throws(() => parseModelConfig(Buffer.from("{")), error => error instanceof InvalidModelConfigError);
  assert.throws(() => parseModelConfig(Buffer.from([0xff])), error => error instanceof InvalidModelConfigError);
  assert.throws(() => parseModelConfig(Buffer.from("null")), error => error instanceof InvalidModelConfigError);
});

for (const [label, change] of [
  ["missing provider", value => { delete value.provider; }],
  ["extra top-level key", value => { value.token = "synthetic-secret"; }],
  ["provider mismatch", value => { value.modelsJson.providers = { "other-provider": {} }; }],
  ["second provider rides along", value => { value.modelsJson.providers["other-provider"] = {}; }],
  ["empty provider", value => { value.provider = ""; }],
  ["padded provider", value => { value.provider = " fixture-provider"; }],
  ["providers not object", value => { value.modelsJson.providers = []; }],
  ["provider fragment not object", value => { value.modelsJson.providers["fixture-provider"] = 5; }],
  ["oauth credential", value => { value.credential = { type: "oauth", access: "x", refresh: "y", expires: 1 }; }],
  ["credential extra field", value => { value.credential.env = {}; }],
  ["credential missing key", value => { delete value.credential.key; }],
  ["empty key", value => { value.credential.key = ""; }],
  ["non-string key", value => { value.credential.key = 7; }],
]) {
  test(`rejects ${label}`, () => {
    const value = valid();
    change(value);
    rejects(value);
  });
}

test("rejects a model config larger than the byte bound", () => {
  const value = valid();
  value.modelsJson.providers["fixture-provider"].models[0].name = "x".repeat(1024 * 1024);
  rejects(value);
});
