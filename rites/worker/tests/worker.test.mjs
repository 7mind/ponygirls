// Worker behavior tests against a local scripted provider: the real Pi SDK
// session, tool execution, terminal stopReason mapping, credential plumbing
// and the worker CLI contract. Deterministic scripted workflow only; these
// tests make no claim about agentic or semantic model quality.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAgent, scriptedModelConfig } from "../../target/worker/worker/agent.js";
import { RunRequest } from "../../target/worker/generated/typescript/rites/worker/RunRequest.js";
import { ModelSelection } from "../../target/worker/generated/typescript/rites/worker/ModelSelection.js";
import { startScriptedProvider } from "./fixtures/scripted-provider.mjs";
import {
  ensureRunEnvironment,
  modelConfigFile,
  parseResultLine,
  requestFrame,
  runWorkerCli,
  spawnCollected,
  tempWorkspace,
  WORKER_CLI,
} from "./helpers.mjs";

ensureRunEnvironment();

const RUN_ID = "12345678-1234-4123-8123-123456789abc";

function fixtureRequest(prompt) {
  return new RunRequest(
    "0.1.0",
    RUN_ID,
    prompt,
    new ModelSelection("fixture-provider", "fixture-model", "off"),
  );
}

async function withScriptedProvider(turns, run) {
  const provider = await startScriptedProvider(turns);
  try {
    return await run(provider);
  } finally {
    await provider.close();
  }
}

test("scripted text turn completes and the credential reaches the provider", async () => {
  await withScriptedProvider([{ type: "text", text: "synthetic completion" }], async provider => {
    const workspace = tempWorkspace("rites-agent-");
    const { config } = modelConfigFile(provider.url, "synthetic-secret");
    const outcome = await runAgent({
      request: fixtureRequest("# Task\nAnswer with the fixture text.\n"),
      workspace,
      modelConfig: config,
      timeoutMs: 60_000,
      cancel: new AbortController().signal,
    });
    assert.equal(outcome.outcome, "Completed");
    assert.equal(outcome.failureCode, null);
    assert.equal(provider.requests.length, 1);
    assert.equal(provider.requests[0].url, "/v1/chat/completions");
    assert.equal(provider.requests[0].authorization, "Bearer synthetic-secret");
  });
});

test("scripted tool turn executes the write tool in the workspace", async () => {
  await withScriptedProvider(
    [
      { type: "tool", name: "rites_write", args: { path: "out.txt", content: "synthetic fixture content\n" } },
      { type: "text", text: "wrote the fixture file" },
    ],
    async provider => {
      const workspace = tempWorkspace("rites-agent-");
      const { config } = modelConfigFile(provider.url, "synthetic-secret");
      const outcome = await runAgent({
        request: fixtureRequest("# Task\nWrite out.txt with the fixture content.\n"),
        workspace,
        modelConfig: config,
        timeoutMs: 60_000,
        cancel: new AbortController().signal,
      });
      assert.equal(outcome.outcome, "Completed");
      assert.equal(readFileSync(join(workspace, "out.txt"), "utf8"), "synthetic fixture content\n");
      assert.ok(provider.requests.length >= 2);
    },
  );
});

test("provider HTTP failure maps to model-error without leaking provider text", async () => {
  await withScriptedProvider([{ type: "http-error", status: 500 }], async provider => {
    const workspace = tempWorkspace("rites-agent-");
    const { config } = modelConfigFile(provider.url, "synthetic-secret");
    const outcome = await runAgent({
      request: fixtureRequest("# Task\nRun.\n"),
      workspace,
      modelConfig: config,
      timeoutMs: 60_000,
      cancel: new AbortController().signal,
    });
    assert.equal(outcome.outcome, "Failed");
    assert.equal(outcome.failureCode, "model-error");
  });
});

test("finish reason length maps to model-length", async () => {
  await withScriptedProvider([{ type: "text", text: "partial", finish: "length" }], async provider => {
    const workspace = tempWorkspace("rites-agent-");
    const { config } = modelConfigFile(provider.url, "synthetic-secret");
    const outcome = await runAgent({
      request: fixtureRequest("# Task\nRun.\n"),
      workspace,
      modelConfig: config,
      timeoutMs: 60_000,
      cancel: new AbortController().signal,
    });
    assert.equal(outcome.outcome, "Failed");
    assert.equal(outcome.failureCode, "model-length");
  });
});

test("requesting an unconfigured model id fails as model-unavailable", async () => {
  await withScriptedProvider([{ type: "text", text: "unused" }], async provider => {
    const workspace = tempWorkspace("rites-agent-");
    const { config } = modelConfigFile(provider.url, "synthetic-secret");
    const outcome = await runAgent({
      request: new RunRequest(
        "0.1.0",
        RUN_ID,
        "# Task\nRun.\n",
        new ModelSelection("fixture-provider", "not-in-config", "off"),
      ),
      workspace,
      modelConfig: config,
      timeoutMs: 60_000,
      cancel: new AbortController().signal,
    });
    assert.equal(outcome.outcome, "Failed");
    assert.equal(outcome.failureCode, "model-unavailable");
    assert.equal(provider.requests.length, 0);
  });
});

test("worker CLI emits one bound frame and exits zero on completion", async () => {
  await withScriptedProvider([{ type: "text", text: "synthetic completion" }], async provider => {
    const workspace = tempWorkspace("rites-cli-");
    const { path } = modelConfigFile(provider.url, "synthetic-secret");
    const result = await runWorkerCli({
      stdin: requestFrame({}),
      modelConfigPath: path,
      workspace,
      timeoutSeconds: 60,
    });
    assert.equal(result.code, 0);
    const frame = parseResultLine(result.stdout);
    assert.deepEqual(frame, { protocolVersion: "0.1.0", runId: RUN_ID, outcome: "Completed", failureCode: null });
  });
});

test("worker CLI rejects invalid request frames with exit 2 and no output", async () => {
  const workspace = tempWorkspace("rites-cli-");
  const { path } = modelConfigFile("http://127.0.0.1:1/v1", "synthetic-secret");
  for (const [label, stdin] of [
    ["garbage", Buffer.from("{\n")],
    ["wrong version", Buffer.from(JSON.stringify({ ...JSON.parse(requestFrame({}).toString()), protocolVersion: "9.9.9" }) + "\n")],
    ["multiple frames", Buffer.concat([requestFrame({}), requestFrame({})])],
  ]) {
    const result = await runWorkerCli({ stdin, modelConfigPath: path, workspace, timeoutSeconds: 60 });
    assert.equal(result.code, 2, label);
    assert.equal(result.stdout.byteLength, 0, label);
  }
});

test("worker CLI exits 2 on an oversized request frame", async () => {
  const workspace = tempWorkspace("rites-cli-");
  const { path } = modelConfigFile("http://127.0.0.1:1/v1", "synthetic-secret");
  const oversized = Buffer.concat([requestFrame({}), Buffer.alloc(1024 * 1024 + 1, 0x20)]);
  const result = await runWorkerCli({ stdin: oversized, modelConfigPath: path, workspace, timeoutSeconds: 60 });
  assert.equal(result.code, 2);
  assert.equal(result.stdout.byteLength, 0);
});

test("worker CLI maps an invalid model config to Failed/invalid-config", async () => {
  const workspace = tempWorkspace("rites-cli-");
  const configPath = join(workspace, "model.json");
  writeFileSync(configPath, JSON.stringify({ provider: "fixture-provider", modelsJson: {}, credential: { type: "api_key", key: "k" } }));
  const result = await runWorkerCli({
    stdin: requestFrame({}),
    modelConfigPath: configPath,
    workspace,
    timeoutSeconds: 60,
  });
  assert.equal(result.code, 0);
  const frame = parseResultLine(result.stdout);
  assert.equal(frame.outcome, "Failed");
  assert.equal(frame.failureCode, "invalid-config");
});

test("worker CLI SIGTERM maps to Cancelled/aborted", async () => {
  await withScriptedProvider([{ type: "hang" }], async provider => {
    const workspace = tempWorkspace("rites-cli-");
    const { path } = modelConfigFile(provider.url, "synthetic-secret");
    const handle = spawnCollected(process.execPath, [WORKER_CLI, workspace, path, "60"], {});
    handle.child.stdin.write(requestFrame({}));
    handle.child.stdin.end();
    const deadline = Date.now() + 60_000;
    while (provider.requests.length < 1 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(provider.requests.length >= 1, "provider never received the request");
    handle.child.kill("SIGTERM");
    const result = await Promise.race([
      handle.done,
      new Promise((_, reject) => setTimeout(() => reject(new Error("worker ignored SIGTERM")), 30_000)),
    ]);
    assert.equal(result.code, 0);
    const frame = parseResultLine(result.stdout);
    assert.equal(frame.outcome, "Cancelled");
    assert.equal(frame.failureCode, "aborted");
    assert.equal(frame.runId, RUN_ID);
  });
});

test("worker internal deadline maps to Cancelled/deadline before the hard timeout", async () => {
  await withScriptedProvider([{ type: "hang" }], async provider => {
    const workspace = tempWorkspace("rites-cli-");
    const { path } = modelConfigFile(provider.url, "synthetic-secret");
    const started = Date.now();
    const result = await runWorkerCli({
      stdin: requestFrame({}),
      modelConfigPath: path,
      workspace,
      timeoutSeconds: 2,
      timeoutMs: 30_000,
    });
    const elapsed = Date.now() - started;
    assert.equal(result.code, 0);
    const frame = parseResultLine(result.stdout);
    assert.equal(frame.outcome, "Cancelled");
    assert.equal(frame.failureCode, "deadline");
    assert.ok(elapsed < 10_000, `deadline run took ${elapsed}ms`);
  });
});

test("worker CLI keeps stdout free of diagnostics", async () => {
  await withScriptedProvider([{ type: "text", text: "synthetic completion" }], async provider => {
    const workspace = tempWorkspace("rites-cli-");
    const { path } = modelConfigFile(provider.url, "synthetic-secret");
    const result = await runWorkerCli({
      stdin: requestFrame({}),
      modelConfigPath: path,
      workspace,
      timeoutSeconds: 60,
    });
    assert.equal(result.code, 0);
    parseResultLine(result.stdout);
  });
});

test("scriptedModelConfig produces a loadable selected-provider config", async () => {
  const config = scriptedModelConfig("fixture-provider", "fixture-model", "http://127.0.0.1:1/v1", "synthetic-secret");
  assert.equal(config.provider, "fixture-provider");
  assert.deepEqual(Object.keys(config.modelsJson.providers), ["fixture-provider"]);
  assert.equal(config.credential.type, "api_key");
});
