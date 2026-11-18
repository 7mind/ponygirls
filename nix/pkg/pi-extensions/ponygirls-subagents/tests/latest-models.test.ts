import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { BackendRegistry } from "../src/backends.ts";
import { defaultSupervisorPolicy, type SupervisorPolicy } from "../src/policy.ts";
import type { IpcEnvelope } from "../src/protocol.ts";
import { InMemoryRunStore } from "../src/store.ts";
import { Supervisor, type SpawnParams } from "../src/supervisor.ts";
import { PROTOCOL_VERSION } from "../src/types.ts";
import type { ProviderAdmissionHandler } from "../src/worker-launch.ts";
import { FakeWorker, testGovernor } from "./fake-worker.ts";

const older = { provider: "openai-codex", id: "gpt-6.1-sol", thinkingLevel: "off" };
const latest = { ...older, id: "gpt-6.2-sol" };
const denied = /POLICY_DENIED.*gpt-6\.1-sol.*older generation.*gpt-6\.2-sol/;
const params = { taskName: "child", message: "test", profile: "reader", isolation: "none" } as const satisfies SpawnParams;

class AdmissionWorker extends FakeWorker {
  private onAdmission!: ProviderAdmissionHandler;
  private onBackend!: (payload: unknown, envelope: IpcEnvelope) => Promise<unknown>;
  setProviderAdmissionRequestHandler(handler: ProviderAdmissionHandler): void { this.onAdmission = handler; }
  setBackendRequestHandler(handler: (payload: unknown, envelope: IpcEnvelope) => Promise<unknown>): void { this.onBackend = handler; }
  admit(model: typeof older, agentId: string, taskRunId: string) {
    const payload = { reason: "stream", provider: model.provider, modelId: model.id, thinkingLevel: model.thinkingLevel };
    return this.onAdmission(payload, this.envelope(agentId, taskRunId, "provider.admission", payload));
  }
  backend(agentId: string, taskRunId: string, operation: "start" | "result") {
    return this.onBackend(operation, this.envelope(agentId, taskRunId, "provider.backend", operation));
  }
  private envelope(agentId: string, taskRunId: string, operation: string, payload: unknown): IpcEnvelope {
    return { protocolVersion: PROTOCOL_VERSION, rootEpoch: "test", agentId, workerInstanceId: this.instanceId, requestId: "query", seq: null, type: "request", operation, taskRunId, executionGeneration: 1, payload };
  }
}

function setup(t: TestContext, configure: (policy: SupervisorPolicy) => void) {
  const dir = mkdtempSync(join(tmpdir(), "subagents-latest-models-"));
  const catalogue = [older, latest];
  const policy = defaultSupervisorPolicy();
  configure(policy);
  const workers: AdmissionWorker[] = [];
  const backends = new BackendRegistry();
  const sup = new Supervisor({
    rootId: "latest-models", rootDir: dir, store: new InMemoryRunStore("latest-models"), policy,
    governor: () => ({ ...testGovernor(), cwd: dir, model: older }),
    availableModels: () => catalogue,
    backends: () => backends,
    workerFactory: () => {
      const worker = new AdmissionWorker("hang");
      workers.push(worker);
      return worker;
    },
  });
  t.after(async () => {
    await sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });
  return { sup, catalogue, workers, backends };
}

// Blackbox group: commands and provider-admission calls through the worker port, without inference.
test("default rejects older inherited, explicit and panel models before admitting an identity", async (t) => {
  const { sup, workers } = setup(t, (p) => { p.allowedModels = null; });
  await assert.rejects(sup.spawn("governor", params, "inherited"), denied);
  await assert.rejects(sup.spawn("governor", { ...params, model: older }, "explicit"), denied);
  await assert.rejects(sup.spawn("governor", {
    ...params,
    model: latest,
    gate: { reviewers: [{ model: latest }, { model: older }], thinkingLevel: "off", prompt: "review" },
  }, "gate"), denied);
  assert.deepEqual(sup.list("governor"), []);
  assert.equal(workers.length, 0);
  const child = await sup.spawn("governor", { ...params, model: latest }, "latest");
  assert.equal(sup.list("governor")[0]?.model, "openai-codex/gpt-6.2-sol");
  assert.deepEqual(await workers[0]!.admit(latest, child.agentId, child.taskRunId), { ok: true });
});

test("opt-out permits an older generation, but does not widen the explicit allowlist", async (t) => {
  const { sup, workers } = setup(t, (p) => { p.latestModelsOnly = false; p.allowedModels = [older]; });
  await assert.rejects(sup.spawn("governor", { ...params, model: latest }, "not-approved"), /not in root allowlist/);
  const child = await sup.spawn("governor", { ...params, model: older }, "older");
  assert.equal(sup.list("governor")[0]?.model, "openai-codex/gpt-6.1-sol");
  assert.deepEqual(await workers[0]!.admit(older, child.agentId, child.taskRunId), { ok: true });
});

test("a new catalogue generation prevents future requests, nested inheritance and same-model task reuse", async (t) => {
  const { sup, catalogue, workers } = setup(t, (p) => { p.nesting = true; p.maxDepth = 2; });
  catalogue.pop();
  const child = await sup.spawn("governor", params, "before-release");
  const worker = workers[0]!;
  assert.deepEqual(await worker.admit(older, child.agentId, child.taskRunId), { ok: true });
  catalogue.push(latest);
  const result = await worker.admit(older, child.agentId, child.taskRunId);
  assert.equal(result.ok, false);
  assert.match(result.error!, denied);
  await assert.rejects(sup.spawn(child.agentId, { ...params, taskName: "nested" }, "nested"), denied);
  await assert.rejects(sup.sendMessage("governor", child.agentId, "task", "next", {}, "reuse"), denied);
  assert.equal(sup.list("governor").length, 1);
  assert.equal(sup.list("governor")[0]?.currentTaskRunId, child.taskRunId);
});

// Regression: a model catalogue update affects new requests, not already-admitted backend results.
test("an admitted native backend request can finish after its model is superseded", async (t) => {
  const { sup, catalogue, workers, backends } = setup(t, () => {});
  catalogue.pop();
  backends.register({
    version: 1,
    id: "fixture",
    usageOwnership: "parent",
    claims: (selected) => selected.provider === older.provider,
    worker: () => ({ version: 1, backendId: "fixture", moduleUrl: new URL("./fake-worker.ts", import.meta.url).href, initialization: null }),
    createSession: ({ assertOwner }) => {
      let started = false;
      return {
        async handle(operation, envelope) {
          assertOwner(envelope);
          if (operation === "start") {
            started = true;
            return "started";
          }
          assert.ok(started);
          return "finished";
        },
        cancel() {},
        async refreshAuthority() {},
        async dispose() {},
      };
    },
  });
  const { agentId, taskRunId } = await sup.spawn("governor", params, "backend-before-release");
  const worker = workers[0]!;
  assert.deepEqual(await worker.admit(older, agentId, taskRunId), { ok: true });
  assert.equal(await worker.backend(agentId, taskRunId, "start"), "started");
  catalogue.push(latest);
  assert.equal(await worker.backend(agentId, taskRunId, "result"), "finished");
  const next = await worker.admit(older, agentId, taskRunId);
  assert.equal(next.ok, false);
  assert.match(next.error!, denied);
});
