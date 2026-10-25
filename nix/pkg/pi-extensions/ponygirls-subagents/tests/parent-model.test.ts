/** Effectual/Good-Communication regressions: parent registration, request auth, lifecycle, and SDK transport. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Supervisor } from "../src/supervisor.ts";
import { InMemoryRunStore } from "../src/store.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { EMPTY_INSTRUCTIONS } from "../src/instructions.ts";
import { GoverningModels, type ParentModels } from "../src/parent-models.ts";
import { until } from "./fake-worker.ts";
import { WorkerHandle } from "../src/worker-launch.ts";
import { bindChannel, type ProviderAdmissionResponse } from "../src/protocol.ts";

const PROVIDER = "parent-only-provider";
const MODEL = "parent-only-model";
const FIRST_KEY = "private-parent-key-first";
const SECOND_KEY = "private-parent-key-second";
const HEADER_SECRET = "private-parent-header";
const ANSWER = "PARENT_PROVIDER_OK";

async function fixture(t: TestContext, mode: "text" | "tool" | "compact", authMode: "api-key" | "oauth") {
  const sdkRoot = process.env["PI_SUBAGENTS_SDK_ROOT"];
  assert.ok(sdkRoot);
  const root = mkdtempSync(join(tmpdir(), "subagents-parent-model-"));
  const workdir = join(root, "empty-workspace");
  const hostAgentDir = join(root, "host-agent");
  mkdirSync(workdir); mkdirSync(hostAgentDir);
  const requests: Array<{ key: string | undefined; header: string | string[] | undefined; path: string | undefined }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages: Array<{ role: string }> };
    requests.push({ key: request.headers.authorization, header: request.headers["x-parent-only"], path: request.url });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const callTool = mode === "tool" && !body.messages.some((message) => message.role === "tool");
    const delta = callTool
      ? { role: "assistant", tool_calls: [{ index: 0, id: "read-probe", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "probe.txt" }) } }] }
      : { role: "assistant", content: ANSWER };
    response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: callTool ? "tool_calls" : "stop" }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: mode === "compact" && requests.length === 2 ? 8100 : 12, completion_tokens: 4, total_tokens: mode === "compact" && requests.length === 2 ? 8104 : 16 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const lifecycle: { supervisor: Supervisor | null } = { supervisor: null };
  t.after(async () => {
    try { if (lifecycle.supervisor !== null) await lifecycle.supervisor.shutdown(); }
    finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
  });
  if (authMode === "oauth") writeFileSync(join(hostAgentDir, "auth.json"), JSON.stringify({ [PROVIDER]: { type: "oauth", access: FIRST_KEY, refresh: "parent-only-refresh", expires: Date.now() + 60 * 60 * 1000 } }));
  const runtime = await ModelRuntime.create({ authPath: join(hostAgentDir, "auth.json"), modelsPath: null, allowModelNetwork: false });
  const registry = new ModelRegistry(runtime);
  registry.registerProvider(PROVIDER, {
    api: "openai-completions", baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: FIRST_KEY,
    headers: { "X-Parent-Only": HEADER_SECRET },
    ...(authMode === "oauth" ? { oauth: {
      name: "Parent OAuth", login: async () => { throw new Error("unexpected login"); },
      refreshToken: async (credential: { access: string; refresh: string; expires: number }) => credential,
      getApiKey: (credential: { access: string }) => credential.access,
    } } : {}),
    models: [{ id: MODEL, name: MODEL, input: ["text"], reasoning: false, contextWindow: 8192, maxTokens: 256, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" } }],
  });
  const model = registry.find(PROVIDER, MODEL);
  assert.ok(model);
  let authCalls = 0;
  const store = new InMemoryRunStore("parent-model");
  const policy = defaultSupervisorPolicy();
  policy.allowedModels = null;
  const governing = new GoverningModels(() => registry);
  const source: ParentModels = {
    describe: (selected) => governing.describe(selected),
    resolveAuth: async (selected) => { authCalls++; return governing.resolveAuth(selected); },
  };
  const admissions: Array<ProviderAdmissionResponse & { reason: string }> = [];
  const sessionsDir = join(root, "root", "sessions");
  const sup = new Supervisor({
    rootId: "parent-model", rootDir: join(root, "root"), store, policy,
    governor: () => ({ model: { provider: PROVIDER, id: MODEL, thinkingLevel: "off" }, cwd: workdir, instructions: EMPTY_INSTRUCTIONS }),
    parentModels: source,
    sdkRoot, hostAgentDir,
    workerFactory: (options) => {
      const agentDir = join(root, "root", "worker-agent-dirs", options.agentId);
      mkdirSync(agentDir, { recursive: true });
      if (mode === "compact") writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 1, reserveTokens: 1024 } }));
      const handle = new WorkerHandle({
        workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
        rootEpoch: options.rootEpoch, agentId: options.agentId, sdkRoot, deterministic: false,
        agentDir, sessionsDir, hostAgentDir,
      }, bindChannel(options.rootEpoch, options.agentId, options.instanceId));
      const set = handle.setProviderAdmissionRequestHandler.bind(handle);
      handle.setProviderAdmissionRequestHandler = (handler) => set(async (payload, envelope) => {
        const result = await handler(payload, envelope);
        admissions.push({ ...result, reason: payload.reason });
        return result;
      });
      return handle;
    },
    executors: { host: new DummyToolExecutor(), sandbox: new DummyToolExecutor() }, workspace: new DummyWorkspaceManager(),
  });
  lifecycle.supervisor = sup;
  return { sup, store, runtime, registry, model, requests, source, policy, admissions, sessionsDir, get authCalls() { return authCalls; } };
}

async function terminal(sup: Supervisor, agentId: string, taskRunId: string, generation: number) {
  try {
    await until(() => sup.list("governor").some((agent) => agent.id === agentId && agent.generation === generation && agent.taskOutcome !== null), 10_000);
  } catch (cause) {
    throw new Error(JSON.stringify({ agents: sup.list("governor"), result: sup.read("governor", agentId, "result", 0, 100, taskRunId).result }), { cause });
  }
  const result = sup.read("governor", agentId, "result", 0, 100, taskRunId).result;
  assert.ok(result);
  return result;
}

test("portable auth supports tool continuations with known cumulative usage", async (t) => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  const f = await fixture(t, "tool", "api-key");
  const child = await f.sup.spawn("governor", { taskName: "tool", message: "Read probe.txt.", profile: "reader" }, "tool");
  const result = await terminal(f.sup, child.agentId, child.taskRunId, 1);
  assert.equal(result.outcome, "succeeded", result.detail);
  assert.equal(f.requests.length, 2);
  assert.equal(f.sup.list("governor")[0]!.usage.inputTokens, 24);
  assert.equal(f.sup.list("governor")[0]!.usage.outputTokens, 8);
  assert.equal(f.sup.list("governor")[0]!.usage.unknown, false);
});

test("missing parent auth fails before transport without leaking provider errors", async (t) => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  const f = await fixture(t, "text", "api-key");
  f.source.resolveAuth = async () => ({ ok: false, error: FIRST_KEY });
  const child = await f.sup.spawn("governor", { taskName: "missing-auth", message: "Reply briefly.", profile: "reader" }, "missing-auth");
  const result = await terminal(f.sup, child.agentId, child.taskRunId, 1);
  assert.equal(result.outcome, "failed");
  assert.match(result.detail!, /authentication is unavailable/);
  assert.equal(JSON.stringify(result).includes(FIRST_KEY), false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.sup.list("governor")[0]!.usage.inputTokens, 0);
  assert.equal(f.sup.list("governor")[0]!.usage.unknown, false);
});

test("closing a worker during auth resolution fences the late private credentials", async (t) => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  const f = await fixture(t, "text", "api-key");
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let entered = false;
  const resolve = f.source.resolveAuth;
  f.source.resolveAuth = async (selected) => { entered = true; await blocked; return resolve(selected); };
  const child = await f.sup.spawn("governor", { taskName: "closing", message: "Reply briefly.", profile: "reader" }, "closing");
  await until(() => entered, 10_000);
  await f.sup.close("governor", child.agentId, "close");
  release();
  await until(() => f.admissions.some((response) => response.reason === "auth"), 10_000);
  const response = f.admissions.find((response) => response.reason === "auth")!;
  assert.equal(response.ok, false);
  assert.equal(response.auth, undefined);
  assert.equal(f.requests.length, 0);
});

test("parent registrations cannot bypass the explicit model allowlist or custom-stream boundary", async (t) => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  const f = await fixture(t, "text", "api-key");
  f.policy.allowedModels = [];
  await assert.rejects(f.sup.spawn("governor", { taskName: "denied", message: "Reply.", profile: "reader", model: { provider: PROVIDER, id: MODEL } }, "denied"), { code: "POLICY_DENIED" });
  f.registry.registerProvider(PROVIDER, { ...f.registry.getRegisteredProviderConfig(PROVIDER)!, streamSimple: () => { throw new Error("must not execute"); } });
  await assert.rejects(f.sup.spawn("governor", { taskName: "custom", message: "Reply.", profile: "reader" }, "custom"), { code: "MODEL_UNAVAILABLE" });
  assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 0);
  assert.equal(f.requests.length, 0);
});

for (const overrideEndpoint of [false, true, "rotating"] as const) test(`parent auth survives automatic compaction (endpoint override: ${overrideEndpoint})`, async (t) => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  const f = await fixture(t, "compact", "api-key");
  let resolutions = 0;
  const resolve = f.source.resolveAuth;
  f.source.resolveAuth = async (selected) => {
    const auth = await resolve(selected);
    if (auth.ok && overrideEndpoint === "rotating") {
      resolutions++;
      return { ...auth, apiKey: `parent-key-${resolutions}`, headers: { "X-Parent-Only": `parent-header-${resolutions}` }, baseUrl: `${f.model.baseUrl}/tenant-${resolutions}` };
    }
    return auth.ok && overrideEndpoint ? { ...auth, baseUrl: `${f.model.baseUrl}/tenant` } : auth;
  };
  const child = await f.sup.spawn("governor", { taskName: "compact", message: "Reply briefly.", profile: "reader" }, "compact");
  assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
  const next = await f.sup.sendMessage("governor", child.agentId, "task", "Reply again.", {}, "compact-again");
  assert.ok(next.taskRunId);
  assert.equal((await terminal(f.sup, child.agentId, next.taskRunId, 2)).outcome, "succeeded");
  if (overrideEndpoint === "rotating") {
    assert.ok(f.requests.every((request) => {
      const scope = request.path!.match(/\/tenant-(\d+)\//)![1];
      return request.key === `Bearer parent-key-${scope}` && request.header === `parent-header-${scope}`;
    }), "each resolved endpoint must receive only its own credential/header pair");
  } else assert.ok(f.requests.every((request) => request.path === (overrideEndpoint ? "/v1/tenant/chat/completions" : "/v1/chat/completions")));
  const entries = readdirSync(join(f.sessionsDir, child.agentId)).filter((name) => name.endsWith(".jsonl")).flatMap((name) => readFileSync(join(f.sessionsDir, child.agentId, name), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { type: string }));
  assert.ok(entries.some((entry) => entry.type === "compaction"), `SDK must persist a real compaction summary; HTTP calls=${f.requests.length}, admissions=${JSON.stringify(f.admissions.map(({ reason, ok, error }) => ({ reason, ok, error })))}`);
  assert.ok(f.requests.length >= 3, "summary must reach stock transport");
});

test("the worker accepts only the endpoint approved by resolved parent auth", async (t) => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  const f = await fixture(t, "text", "api-key");
  const resolve = f.source.resolveAuth;
  f.source.resolveAuth = async (selected) => {
    const auth = await resolve(selected);
    return auth.ok ? { ...auth, baseUrl: `${f.model.baseUrl}/tenant` } : auth;
  };
  const child = await f.sup.spawn("governor", { taskName: "parent-endpoint", message: "Reply briefly.", profile: "reader" }, "endpoint");
  const result = await terminal(f.sup, child.agentId, child.taskRunId, 1);
  assert.equal(result.outcome, "succeeded", result.detail);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]!.path, "/v1/tenant/chat/completions");
});

test("stored OAuth is resolved by the parent rather than shadowing the worker adapter", { timeout: 30_000 }, async (t) => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  const f = await fixture(t, "text", "oauth");
  const parent = await f.registry.complete(f.model, { messages: [{ role: "user", content: "positive control", timestamp: Date.now() }] }, { maxTokens: 32 });
  assert.equal(parent.content.some((part) => part.type === "text" && part.text === ANSWER), true, parent.errorMessage);
  const child = await f.sup.spawn("governor", { taskName: "parent-oauth", message: "Reply briefly.", profile: "reader", isolation: "none" }, "oauth");
  const result = await terminal(f.sup, child.agentId, child.taskRunId, 1);
  assert.equal(result.outcome, "succeeded", result.detail);
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every((request) => request.key === `Bearer ${FIRST_KEY}`));
  assert.ok(f.authCalls > 0);
});

test("a provider usable in the parent also initializes in a worker and resolves fresh parent credentials per request", async (t) => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  const f = await fixture(t, "text", "api-key");
  const parent = await f.registry.complete(f.model, { messages: [{ role: "user", content: "parent positive control", timestamp: Date.now() }] });
  assert.equal(parent.content.filter((block) => block.type === "text").map((block) => block.text).join(""), ANSWER);
  const child = await f.sup.spawn("governor", { taskName: "child", message: "reply", profile: "reader" }, "spawn");
  const first = await terminal(f.sup, child.agentId, child.taskRunId, 1);
  assert.equal(first.outcome, "succeeded", first.detail);
  const firstAuthCalls = f.authCalls;
  assert.ok(firstAuthCalls > 0);
  await f.runtime.setRuntimeApiKey(PROVIDER, SECOND_KEY);
  const next = await f.sup.sendMessage("governor", child.agentId, "task", "reply again", {}, "again");
  assert.ok(next.taskRunId);
  const second = await terminal(f.sup, child.agentId, next.taskRunId, 2);
  assert.equal(second.outcome, "succeeded", second.detail);
  await until(() => f.store.loadCheckpoint(child.agentId)?.ref.generation === 2, 30_000);
  assert.equal(f.sup.read("governor", child.agentId, "result", 0, 100, next.taskRunId).result?.text, ANSWER);
  assert.deepEqual(f.requests.map((request) => request.key), [`Bearer ${FIRST_KEY}`, `Bearer ${FIRST_KEY}`, `Bearer ${SECOND_KEY}`]);
  assert.ok(f.requests.every((request) => request.header === HEADER_SECRET));
  assert.ok(f.authCalls > firstAuthCalls, "retained workers must resolve fresh parent credentials");
  assert.equal(f.sup.admissionScheduler.agentsCreatedCount, 1);
  assert.equal(f.sup.list("governor")[0]?.usage.unknown, false);
  const retained = JSON.stringify(f.store.readSince(0, Number.MAX_SAFE_INTEGER).records) + JSON.stringify(f.sup.list("governor")) + Buffer.from(f.store.loadCheckpoint(child.agentId)!.bytes).toString("utf8");
  for (const secret of [FIRST_KEY, SECOND_KEY, HEADER_SECRET]) assert.equal(retained.includes(secret), false, "credentials must not enter journal, public state, or native history");
});
