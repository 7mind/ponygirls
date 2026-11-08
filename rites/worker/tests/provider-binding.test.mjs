// Provider-binding regression (fail-first): a RunRequest naming a provider
// other than MODEL_CONFIG.provider, or a same-provider model id that the
// configured provider fragment does not explicitly list, must fail as
// model-unavailable BEFORE any ModelRuntime is created. The Pi builtin
// catalog can otherwise resolve the request against a builtin provider and
// fall through to ambient host credentials.
//
// The recording offline guard replaces the SDK's ModelRuntime in this test
// process only (node:module registerHooks); it counts create() calls and
// throws, so "creation was reached" is observable. The real module is loaded
// under a query-suffixed URL so the guard can re-export it. No network, no
// ambient credentials, no real provider is ever contacted.

import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureRunEnvironment } from "./helpers.mjs";

ensureRunEnvironment();

const RITES_DIR = join(fileURLToPath(import.meta.url), "..", "..", "..");
const sdkIndex = pathToFileURL(
  realpathSync(join(RITES_DIR, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js")),
).href;
const realSdk = `${sdkIndex}?rites-real`;

registerHooks({
  load(url, context, nextLoad) {
    if (url === sdkIndex) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          import * as real from ${JSON.stringify(realSdk)};
          export * from ${JSON.stringify(realSdk)};
          const state = { createCalls: 0 };
          export const __ritesCreateCalls = () => state.createCalls;
          export class ModelRuntime {
            static async create() {
              state.createCalls += 1;
              throw new Error("offline guard: ModelRuntime.create reached");
            }
          }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

const agentModule = await import("../../target/worker/worker/agent.js");
const sdkModule = await import("@earendil-works/pi-coding-agent");
const realSdkModule = await import(realSdk);
const createCalls = sdkModule.__ritesCreateCalls;
const runAgent = agentModule.runAgent;

const config = {
  provider: "fixture-provider",
  modelsJson: {
    providers: {
      "fixture-provider": {
        name: "fixture provider",
        baseUrl: "http://127.0.0.1:1/v1",
        api: "openai-completions",
        models: [
          {
            id: "fixture-model",
            reasoning: false,
            contextWindow: 8192,
            maxTokens: 4096,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          },
        ],
      },
    },
  },
  credential: { type: "api_key", key: "synthetic-secret" },
};

const request = (provider, model) => ({
  protocolVersion: "0.1.0",
  runId: "12345678-1234-4123-8123-123456789abc",
  prompt: "# Task\nRun.\n",
  model: { provider, model, thinkingLevel: "off" },
});

const workspace = mkdtempSync(join(tmpdir(), "rites-bind-"));

test("a request naming another provider never reaches ModelRuntime.create", async () => {
  const outcome = await runAgent({
    request: request("anthropic", "claude-sonnet-4-5"),
    workspace,
    modelConfig: config,
    timeoutMs: 10_000,
    cancel: new AbortController().signal,
  });
  assert.deepEqual(outcome, { outcome: "Failed", failureCode: "model-unavailable" });
  assert.equal(createCalls(), 0, "ModelRuntime.create must not be reached for a foreign provider");
});

test("a same-provider model absent from the configured list never reaches ModelRuntime.create", async () => {
  const outcome = await runAgent({
    request: request("fixture-provider", "fixture-other-model"),
    workspace,
    modelConfig: config,
    timeoutMs: 10_000,
    cancel: new AbortController().signal,
  });
  assert.deepEqual(outcome, { outcome: "Failed", failureCode: "model-unavailable" });
  assert.equal(createCalls(), 0, "ModelRuntime.create must not be reached for an unlisted model");
});

test("the configured provider and listed model reach ModelRuntime.create (guard observes it)", async () => {
  const outcome = await runAgent({
    request: request("fixture-provider", "fixture-model"),
    workspace,
    modelConfig: config,
    timeoutMs: 10_000,
    cancel: new AbortController().signal,
  });
  // The offline guard makes creation fail; the bound request got that far.
  assert.deepEqual(outcome, { outcome: "Failed", failureCode: "invalid-config" });
  assert.equal(createCalls(), 1, "the bound selection must reach ModelRuntime.create");
});

test("the builtin catalog itself can resolve a builtin provider without any credential", async () => {
  // Grounds the risk: a pure catalog lookup with no auth configured, no
  // network refresh (allowModelNetwork false, refreshOnCreate false) and no
  // prompt. The binding checks must never let such a lookup serve a request.
  const ModelRuntime = realSdkModule.ModelRuntime;
  const realRuntime = await ModelRuntime.create({
    authPath: join(workspace, "absent-auth.json"),
    modelsPath: join(workspace, "absent-models.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const builtin = realRuntime.getModel("anthropic", "claude-sonnet-4-5");
  assert.notEqual(builtin, undefined, "expected the vendored builtin catalog to contain the lookup");
  assert.equal(builtin.provider, "anthropic");
});
