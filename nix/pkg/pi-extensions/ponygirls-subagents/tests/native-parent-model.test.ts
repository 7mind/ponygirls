import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, ModelRegistry, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  contentText,
  createAssistantMessageEventStream,
  getCurrentTools,
  InMemoryCredentialStore,
  type Api,
  type AssistantMessage,
  type Model,
  type Provider,
  type TextContent,
  type ToolCall,
} from "@earendil-works/pi-ai";
import { SIM_MODEL, SIM_PROVIDER } from "../src/deterministic.ts";
import { EMPTY_INSTRUCTIONS } from "../src/instructions.ts";
import { GoverningModels } from "../src/parent-models.ts";
import { NATIVE_DELEGATION, NATIVE_CAPABILITY, type NativeDelegationV1, type NativeRequestContext } from "../src/native-contract.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { bindChannel } from "../src/protocol.ts";
import { DummyToolExecutor, HostToolExecutor } from "../src/sandbox.ts";
import { InMemoryRunStore } from "../src/store.ts";
import { Supervisor, type SpawnResult } from "../src/supervisor.ts";
import { WorkerHandle } from "../src/worker-launch.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { portableControl } from "./native-portable-fixture.ts";
import { until } from "./fake-worker.ts";

const PROVIDER = "parent-native-fixture";
const API = "parent-native-fixture-stream";
const BASE_URL = "process://parent-native-fixture";
const MAIN_MODEL = "native-main";
const REVIEWER_MODEL = "native-reviewer";
const ANSWER = "Opus fixture candidate";
const PROBE_TEXT = "native provider brokered read evidence";
const WAIT_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 30_000;
const REQUEST_USAGE = {
  input: 7, output: 3, cacheRead: 2, cacheWrite: 1, totalTokens: 13,
  cost: { input: 0.07, output: 0.03, cacheRead: 0.02, cacheWrite: 0.01, total: 0.13 },
} as const;

interface NativeRequest {
  provider: string;
  model: string;
  api: string;
  tools: string[];
  readResult: string | null;
}

function response(model: Model<Api>, content: Array<TextContent | ToolCall>, usage: AssistantMessage["usage"], failure: string | null) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant", api: model.api, provider: model.provider, model: model.id,
    content: [], stopReason: "pending", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
  stream.push({ type: "start", partial: message });
  for (const source of content) {
    const contentIndex = message.content.length;
    if (source.type === "text") {
      const block: TextContent = { type: "text", text: "" };
      message.content.push(block);
      stream.push({ type: "text_start", contentIndex, partial: message });
      block.text = source.text;
      stream.push({ type: "text_delta", contentIndex, delta: source.text, partial: message });
      stream.push({ type: "text_end", contentIndex, content: source.text, partial: message });
    } else {
      const block: ToolCall = { type: "toolCall", id: source.id, name: source.name, arguments: {} };
      message.content.push(block);
      stream.push({ type: "toolcall_start", contentIndex, partial: message });
      block.arguments = source.arguments;
      stream.push({ type: "toolcall_delta", contentIndex, delta: JSON.stringify(source.arguments), partial: message });
      stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: message });
    }
  }
  message.usage = { ...usage, cost: { ...usage.cost } };
  if (failure !== null) {
    message.stopReason = "error";
    message.errorMessage = failure;
    stream.push({ type: "error", reason: "error", error: message });
    stream.end();
    return stream;
  }
  message.stopReason = content.some((block) => block.type === "toolCall") ? "toolUse" : "stop";
  stream.push({ type: "done", reason: message.stopReason, message });
  stream.end();
  return stream;
}

async function nativeRegistry() {
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const registry = new ModelRegistry(runtime);
  const requests: NativeRequest[] = [];
  let usageForRequest: ((index: number) => AssistantMessage["usage"]) | null = null;
  let failureAt: number | null = null;
  const models: Model<Api>[] = [MAIN_MODEL, REVIEWER_MODEL].map((id) => ({
    type: "chat", id, name: id, provider: PROVIDER, api: API, baseUrl: BASE_URL,
    input: ["text"], reasoning: false, contextWindow: 8192, maxTokens: 256,
    cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
  }));
  const stream: Provider["streamSimple"] = (model, context) => {
    const tools = getCurrentTools(context.messages).map((tool) => tool.name);
    const read = context.messages.find((message) => message.role === "toolResult" && message.toolName === "read");
    const readResult = read !== undefined && read.role === "toolResult" ? contentText(read.content) : null;
    requests.push({ provider: model.provider, model: model.id, api: model.api, tools, readResult });
    const usage = usageForRequest === null ? REQUEST_USAGE : usageForRequest(requests.length);
    if (requests.length === failureAt) return response(model, [], usage, "503 service unavailable: controlled transient failure");
    if (model.id === REVIEWER_MODEL) {
      assert.ok(tools.includes("submit_gate_decision"));
      const prompt = context.messages.filter((message) => message.role === "user").map((message) => contentText(message.content)).join("\n");
      const candidate = /Candidate (candidate-\d+)/.exec(prompt);
      assert.ok(candidate, "the native reviewer must receive its candidate identity");
      assert.ok(prompt.includes(ANSWER));
      return response(model, [{ type: "toolCall", id: "native-verdict", name: "submit_gate_decision", arguments: {
        schemaVersion: 1, candidateId: candidate[1]!, decision: "approve", advisories: [],
      } }], usage, null);
    }
    assert.equal(model.id, MAIN_MODEL);
    if (tools.includes("read") && readResult === null) {
      return response(model, [{ type: "toolCall", id: "native-read", name: "read", arguments: { path: "probe.txt" } }], usage, null);
    }
    if (readResult !== null) assert.ok(readResult.includes(PROBE_TEXT));
    return response(model, [{ type: "text", text: ANSWER }], usage, null);
  };
  const provider: Provider = {
    id: PROVIDER, name: "Native parent fixture", baseUrl: BASE_URL,
    auth: { apiKey: {
      name: "In-memory native fixture",
      check: async () => ({ type: "api_key", source: "in-memory native fixture" }),
      resolve: async () => ({ auth: { apiKey: "in-memory-native-placeholder" }, source: "in-memory native fixture" }),
    } },
    getModels: () => models,
    stream: (model, context) => provider.streamSimple(model, context),
    streamSimple: (model, context, options) => {
      const delegation = options?.metadata?.[NATIVE_DELEGATION] as NativeRequestContext | undefined;
      if (delegation !== undefined) delegation.beforeEntry(Reflect.get(provider, NATIVE_CAPABILITY) as NativeDelegationV1);
      const raw = stream(model, context, options);
      return delegation === undefined ? raw : delegation.captureOriginal(raw);
    },
  };
  Object.defineProperty(provider, Symbol.for("ponygirls.nativeDelegation.v1"), { value: {
    version: 1, apis: [API], requestProfile: "canonical-simple-no-provider-hooks-v1",
    disposeSession: async (_sessionId: string) => {},
  } });
  registry.registerProvider(provider);
  assert.equal(registry.getRegisteredNativeProvider(PROVIDER), provider);
  assert.equal(registry.getRegisteredProviderConfig(PROVIDER), undefined);
  for (const id of [MAIN_MODEL, REVIEWER_MODEL]) {
    const model = registry.find(PROVIDER, id);
    assert.ok(model, `the registered native model ${id} must exist before subagent selection`);
    assert.equal(model.api, API);
    assert.equal(model.baseUrl, BASE_URL);
  }
  return { registry, requests, source: new GoverningModels(() => registry),
    setUsage: (resolve: (index: number) => AssistantMessage["usage"]) => { usageForRequest = resolve; },
    failRequest: (index: number) => { failureAt = index; },
  };
}

async function runtimeFixture(t: TestContext, native: Pick<Awaited<ReturnType<typeof nativeRegistry>>, "registry" | "requests" | "source">, governorModel: { provider: string; id: string }, settings: { compaction: { keepRecentTokens: number; reserveTokens: number } } | null) {
  const sdkRoot = process.env["PI_SUBAGENTS_SDK_ROOT"];
  assert.ok(sdkRoot, "PI_SUBAGENTS_SDK_ROOT is required for the real worker");
  const root = mkdtempSync(join(tmpdir(), "subagents-native-parent-"));
  const workdir = join(root, "workspace");
  const hostAgentDir = join(root, "empty-host-agent");
  mkdirSync(workdir);
  mkdirSync(hostAgentDir);
  writeFileSync(join(workdir, "probe.txt"), PROBE_TEXT);
  const policy = defaultSupervisorPolicy();
  policy.allowedModels = null;
  const rootDir = join(root, "supervisor");
  const workers = new Map<string, WorkerHandle>();
  const supervisor: Supervisor = new Supervisor({
    rootId: "native-parent-fixture", rootDir, policy,
    store: new InMemoryRunStore("native-parent-fixture"),
    parentModels: native.source,
    governor: () => ({ model: { ...governorModel, thinkingLevel: "off" }, cwd: workdir, instructions: EMPTY_INSTRUCTIONS }),
    executors: { host: new HostToolExecutor(), sandbox: new DummyToolExecutor() },
    workspace: new DummyWorkspaceManager(),
    workerFactory: (options) => {
      const agent = supervisor.list("governor").find((entry) => entry.id === options.agentId);
      assert.ok(agent, "the worker must have a publicly admitted agent identity");
      const agentDir = join(rootDir, "worker-agent-dirs", options.agentId);
      mkdirSync(agentDir, { recursive: true });
      if (settings !== null) writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings));
      const worker = new WorkerHandle({
        workerPath: fileURLToPath(new URL("../src/worker.ts", import.meta.url)),
        rootEpoch: options.rootEpoch, agentId: options.agentId, sdkRoot,
        deterministic: agent.model === `${SIM_PROVIDER}/${SIM_MODEL}`,
        agentDir,
        sessionsDir: join(rootDir, "sessions"), hostAgentDir,
        script: [{ text: ANSWER }],
      }, bindChannel(options.rootEpoch, options.agentId, options.instanceId));
      workers.set(options.agentId, worker);
      return worker;
    },
  });
  t.after(async () => {
    try { await supervisor.shutdown(); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
  return { ...native, supervisor, workers };
}

async function terminal(supervisor: Supervisor, child: SpawnResult) {
  const settled = await supervisor.wait("governor", 0, WAIT_TIMEOUT_MS, [{ agentId: child.agentId, taskRunId: child.taskRunId }], "all_settled");
  assert.equal(settled.completed, true, JSON.stringify(settled));
  const result = supervisor.read("governor", child.agentId, "result", 0, 100, child.taskRunId).result;
  assert.ok(result);
  return result;
}

const gate = {
  model: { provider: PROVIDER, id: REVIEWER_MODEL },
  thinkingLevel: "off", prompt: "Approve only an answer containing Opus.", maxRounds: 1,
} as const;

async function nativeChild(t: TestContext, gated: boolean) {
  const f = await runtimeFixture(t, await nativeRegistry(), { provider: PROVIDER, id: MAIN_MODEL }, null);
  const child = await f.supervisor.spawn("governor", {
    taskName: gated ? "native-gated" : "native-child", message: "Read probe.txt and return the candidate.",
    profile: "reader", isolation: "none", model: { provider: PROVIDER, id: MAIN_MODEL, thinkingLevel: "off" },
    ...(gated ? { gate } : {}),
  }, gated ? "native-gated" : "native-child");
  const result = await terminal(f.supervisor, child);
  assert.equal(result.outcome, gated ? "passed" : "succeeded", result.detail);
  assert.equal(result.text, ANSWER);
  const main = f.requests.filter((request) => request.model === MAIN_MODEL);
  assert.equal(main.length, 2);
  assert.equal(main[0]!.readResult, null);
  assert.ok(main[1]!.readResult!.includes(PROBE_TEXT));
  for (const request of f.requests) {
    assert.equal(request.provider, PROVIDER);
    assert.equal(request.api, API);
  }
  const status = f.supervisor.list("governor").find((agent) => agent.id === child.agentId);
  assert.ok(status);
  assert.equal(status.model, `${PROVIDER}/${MAIN_MODEL}`);
  assert.equal(status.usage.inputTokens, 2 * (REQUEST_USAGE.input + REQUEST_USAGE.cacheRead + REQUEST_USAGE.cacheWrite));
  assert.equal(status.usage.outputTokens, 2 * REQUEST_USAGE.output);
  assert.equal(status.usage.unknown, false);
  if (gated) assert.ok(f.requests.some((request) => request.model === REVIEWER_MODEL));
}

test("BG fixture control: the registered custom native API streams through the public SDK", async () => {
  const f = await nativeRegistry();
  const model = f.registry.find(PROVIDER, MAIN_MODEL);
  assert.ok(model);
  const result = await f.registry.streamSimple(model, { messages: [{ role: "user", content: "Return the fixture candidate.", timestamp: 0 }] }).result();
  assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.equal(contentText(result.content), ANSWER);
  assert.equal(result.provider, PROVIDER);
  assert.equal(result.model, MAIN_MODEL);
  assert.equal(result.api, API);
  assert.equal(f.requests.length, 1);
});

test("BG regression: an existing native parent model is selectable for a child", async () => {
  const f = await nativeRegistry();
  assert.doesNotThrow(() => f.source.describe({ provider: PROVIDER, id: MAIN_MODEL, thinkingLevel: "off" }));
});

test("GoodCommunication regression: a native parent model completes a real worker tool continuation", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  await nativeChild(t, false);
});

test("GoodCommunication regression: a native child and native gate complete through real workers", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  await nativeChild(t, true);
});

test("GoodCommunication regression: a native reviewer can validate a real scripted worker from a native governor", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("PI_SUBAGENTS_SDK_ROOT unset"); return; }
  const f = await runtimeFixture(t, await nativeRegistry(), { provider: PROVIDER, id: MAIN_MODEL }, null);
  const child = await f.supervisor.spawn("governor", {
    taskName: "native-reviewer", message: "Return the candidate.", profile: "reader", isolation: "none",
    model: { provider: SIM_PROVIDER, id: SIM_MODEL, thinkingLevel: "off" }, gate,
  }, "native-reviewer");
  const result = await terminal(f.supervisor, child);
  assert.equal(result.outcome, "passed", result.detail);
  assert.equal(result.text, ANSWER);
  assert.ok(f.requests.some((request) => request.model === REVIEWER_MODEL));
});

test("GoodCommunication native raw receipt failure holds admission and reconciles exactly once", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const f = await runtimeFixture(t, await nativeRegistry(), { provider: PROVIDER, id: MAIN_MODEL }, null);
  const store = f.supervisor.runStore;
  const append = store.append.bind(store);
  let fail = true;
  store.append = (kind, body) => {
    if (fail && kind === "usage.reported" && body["sourceModel"] !== undefined) { fail = false; throw new Error("STORE_FAILED: controlled receipt persistence failure"); }
    return append(kind, body);
  };
  const child = await f.supervisor.spawn("governor", { taskName: "receipt-failure", message: "Read probe.txt and answer.", profile: "reader", isolation: "none" }, "receipt-failure");
  assert.equal((await terminal(f.supervisor, child)).outcome, "failed");
  assert.equal(f.supervisor.needsRecovery, true);
  assert.equal(f.supervisor.list("governor").find((agent) => agent.id === child.agentId)!.usage.inputTokens, 0);
  await assert.rejects(f.supervisor.spawn("governor", { taskName: "held", message: "must not infer", profile: "reader" }, "held"), { code: "RECOVERY_OWNER_UNCONFIRMED" });
  await f.supervisor.recover();
  const status = f.supervisor.list("governor").find((agent) => agent.id === child.agentId)!;
  assert.equal(status.usage.inputTokens, 10);
  assert.equal(status.usage.outputTokens, 3);
  const receipts = store.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((record) => record.kind === "usage.reported" && record.body["sourceModel"] !== undefined);
  assert.equal(receipts.length, 1);
  await f.supervisor.recover();
  assert.equal(f.supervisor.list("governor").find((agent) => agent.id === child.agentId)!.usage.inputTokens, 10);
});

test("GoodCommunication native SDK compaction accounts every main and summary invocation once", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const native = await nativeRegistry();
  native.setUsage((index) => index === 2 ? { ...REQUEST_USAGE, input: 8100, totalTokens: 8106, cost: { ...REQUEST_USAGE.cost } } : { ...REQUEST_USAGE, cost: { ...REQUEST_USAGE.cost } });
  const f = await runtimeFixture(t, native, { provider: PROVIDER, id: MAIN_MODEL }, { compaction: { keepRecentTokens: 1, reserveTokens: 1024 } });
  const child = await f.supervisor.spawn("governor", { taskName: "native-compaction", message: "Read probe.txt and answer.", profile: "reader", isolation: "none" }, "native-compaction");
  assert.equal((await terminal(f.supervisor, child)).outcome, "succeeded");
  const next = await f.supervisor.sendMessage("governor", child.agentId, "task", "Continue after compaction.", {}, "native-compaction-next");
  assert.ok(next.taskRunId);
  assert.equal((await terminal(f.supervisor, { ...child, taskRunId: next.taskRunId })).outcome, "succeeded");
  const sessionFile = f.supervisor.transcript("governor", child.agentId).sessionFile;
  assert.ok(sessionFile);
  const entries = readFileSync(sessionFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.ok(entries.some((entry) => entry.type === "compaction"));
  assert.ok(f.requests.length >= 3);
  const status = f.supervisor.list("governor").find((agent) => agent.id === child.agentId)!;
  assert.equal(status.usage.inputTokens, 8103 + (f.requests.length - 1) * 10);
  assert.equal(status.usage.outputTokens, f.requests.length * 3);
  assert.equal(status.usage.unknown, false);
});

test("GoodCommunication native SDK retry preserves distinct billed invocation ownership", { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const native = await nativeRegistry();
  native.failRequest(1);
  const f = await runtimeFixture(t, native, { provider: PROVIDER, id: MAIN_MODEL }, null);
  const child = await f.supervisor.spawn("governor", { taskName: "native-retry", message: "Read probe.txt and answer.", profile: "reader", isolation: "none" }, "native-retry");
  assert.equal((await terminal(f.supervisor, child)).outcome, "succeeded");
  assert.equal(f.requests.length, 3);
  const status = f.supervisor.list("governor").find((agent) => agent.id === child.agentId)!;
  assert.equal(status.usage.inputTokens, 30);
  assert.equal(status.usage.outputTokens, 9);
  assert.equal(status.usage.unknown, false);
  const receipts = f.supervisor.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((record) => record.kind === "usage.reported" && record.body["sourceModel"] !== undefined);
  assert.equal(receipts.length, 3);
  assert.equal(new Set(receipts.map((record) => record.body["receiptId"])).size, 3);
});

test("GoodCommunication pinned Claude package: actual SDK loader, native 5.5 workers, gates and retained reload", { timeout: 60_000 }, async (t) => {
  const packagePath = process.env["PI_SUBAGENTS_CLAUDE_PACKAGE"];
  const fakeCli = process.env["PI_SUBAGENTS_CLAUDE_FIXTURE"];
  if (packagePath === undefined || fakeCli === undefined) { t.skip("immutable Claude package/controlled CLI paths unset"); return; }
  const root = mkdtempSync(join(tmpdir(), "subagents-actual-claude-"));
  const config = join(root, "config");
  const agentDir = join(root, "loader-agent");
  mkdirSync(config);
  mkdirSync(agentDir);
  const executable = join(root, "controlled-claude");
  writeFileSync(executable, `#!${process.execPath}\n${readFileSync(fakeCli, "utf8")}`);
  chmodSync(executable, 0o755);
  writeFileSync(join(config, "fixture.json"), JSON.stringify({ answer: ANSWER }));
  const savedCommand = process.env["PI_CLAUDE_CODE_COMMAND"];
  const savedConfig = process.env["PI_CLAUDE_CODE_CONFIG_DIR"];
  process.env["PI_CLAUDE_CODE_COMMAND"] = executable;
  process.env["PI_CLAUDE_CODE_CONFIG_DIR"] = config;
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: SettingsManager.inMemory({ packages: [packagePath] }), noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await loader.reload();
  t.diagnostic("controlled package loaded through SDK loader");
  assert.deepEqual(loader.getExtensions().errors, []);
  const provider = loader.getExtensions().runtime.pendingNativeProviderRegistrations[0]!.provider;
  assert.equal(provider.id, "claude-code");
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const registry = new ModelRegistry(runtime);
  registry.registerProvider(provider);
  const refreshed = await registry.refresh({ providers: [provider.id], allowNetwork: true, force: true });
  assert.deepEqual([...refreshed.errors], []);
  t.diagnostic("controlled 5.5 catalog refreshed");
  const opus = { provider: "claude-code", id: "claude-opus-5-5", thinkingLevel: "off" };
  const sonnet = { provider: "claude-code", id: "claude-sonnet-5-5", thinkingLevel: "off" };
  assert.equal(registry.find(opus.provider, opus.id)!.api, "claude-code-stream-json");
  assert.ok(registry.find(sonnet.provider, sonnet.id));
  const portable = await portableControl(registry, ANSWER);
  const f = await runtimeFixture(t, { registry, requests: [], source: new GoverningModels(() => registry) }, sonnet, null);
  t.after(() => portable.close());
  t.after(() => {
    if (savedCommand === undefined) delete process.env["PI_CLAUDE_CODE_COMMAND"]; else process.env["PI_CLAUDE_CODE_COMMAND"] = savedCommand;
    if (savedConfig === undefined) delete process.env["PI_CLAUDE_CODE_CONFIG_DIR"]; else process.env["PI_CLAUDE_CODE_CONFIG_DIR"] = savedConfig;
    rmSync(root, { recursive: true, force: true });
  });
  const nativeGate = { model: sonnet, thinkingLevel: "off", prompt: "Approve only when the candidate contains the literal substring Opus.", maxRounds: 1 };
  const explicit = await f.supervisor.spawn("governor", { taskName: "actual-opus", message: "Read probe.txt, then answer.", profile: "reader", isolation: "none", model: opus, gate: nativeGate }, "actual-opus");
  assert.equal((await terminal(f.supervisor, explicit)).outcome, "passed");
  const inherited = await f.supervisor.spawn("governor", { taskName: "actual-inherited", message: "Read probe.txt, then answer.", profile: "reader", isolation: "none" }, "actual-inherited");
  assert.equal((await terminal(f.supervisor, inherited)).outcome, "succeeded");
  assert.equal(f.supervisor.list("governor").find((agent) => agent.id === inherited.agentId)!.model, "claude-code/claude-sonnet-5-5");
  f.supervisor.refreshNativeAuthority();
  const next = await f.supervisor.sendMessage("governor", inherited.agentId, "task", "Continue with the retained conversation.", {}, "actual-continue");
  assert.ok(next.taskRunId);
  assert.equal((await terminal(f.supervisor, { ...inherited, taskRunId: next.taskRunId })).outcome, "succeeded");
  writeFileSync(join(config, "fixture.json"), JSON.stringify({ answer: "candidate without required marker" }));
  const negative = await f.supervisor.spawn("governor", { taskName: "actual-negative", message: "Read probe.txt, then answer.", profile: "reader", isolation: "none", model: opus, gate: nativeGate }, "actual-negative");
  assert.equal((await terminal(f.supervisor, negative)).outcome, "gate_blocked");
  const launches = readFileSync(join(config, "launch.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { model: string; cwd: string; config: string; strictMcp: boolean });
  assert.ok(launches.some((launch) => launch.model === "fixture-opus-route"));
  assert.ok(launches.some((launch) => launch.model === "fixture-sonnet-route"));
  assert.ok(launches.every((launch) => launch.cwd !== process.cwd() && launch.config === config && launch.strictMcp));
  const receipts = f.supervisor.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((record) => record.kind === "usage.reported" && record.body["sourceModel"] !== undefined);
  assert.equal(receipts.length, 9);
  assert.equal(receipts.filter((record) => record.body["agentId"] === explicit.agentId).length, 2);
  const status = f.supervisor.list("governor").find((agent) => agent.id === explicit.agentId)!;
  assert.equal(status.usage.inputTokens, 20, JSON.stringify({ usage: status.usage, receipts: receipts.map((record) => record.body) }));
  assert.equal(status.usage.outputTokens, 6);
  assert.equal(status.usage.unknown, false);
  writeFileSync(join(config, "fixture.json"), JSON.stringify({ answer: ANSWER }));
  for (const reviewers of [[{ model: sonnet }, { model: opus }], [{ model: sonnet }, { model: portable.model }]]) {
    const panel = await f.supervisor.spawn("governor", { taskName: `panel-${reviewers[1]!.model.provider}`, message: "Read probe.txt, then answer.", profile: "reader", isolation: "none", model: opus, gate: { reviewers, thinkingLevel: "off", prompt: "Validate the candidate.", maxRounds: 1 } }, `panel-${reviewers[1]!.model.provider}`);
    assert.equal((await terminal(f.supervisor, panel)).outcome, "passed");
  }
  await until(() => f.supervisor.runStore.loadCheckpoint(inherited.agentId)?.ref.generation === 2);
  await new Promise((resolve) => setImmediate(resolve));
  const switched = await f.supervisor.sendMessage("governor", inherited.agentId, "task", "Continue over the portable stock transport.", { model: portable.model }, "native-to-http");
  assert.ok(switched.taskRunId);
  assert.equal((await terminal(f.supervisor, { ...inherited, taskRunId: switched.taskRunId })).outcome, "succeeded");
  await until(() => f.supervisor.runStore.loadCheckpoint(inherited.agentId)?.ref.generation === 3);
  await new Promise((resolve) => setImmediate(resolve));
  const returned = await f.supervisor.sendMessage("governor", inherited.agentId, "task", "Continue over the parent native transport.", { model: opus }, "http-to-native");
  assert.ok(returned.taskRunId);
  assert.equal((await terminal(f.supervisor, { ...inherited, taskRunId: returned.taskRunId })).outcome, "succeeded");
  assert.ok(portable.requests() >= 2);
  const switchedStatus = f.supervisor.list("governor").find((agent) => agent.id === inherited.agentId)!;
  assert.equal(switchedStatus.model, "claude-code/claude-opus-5-5");
  assert.equal(switchedStatus.usage.inputTokens, 51);
  assert.equal(switchedStatus.usage.outputTokens, 17);
  for (const ending of ["worker-death", "forced-close"]) {
    const before = readFileSync(join(config, "launch.jsonl"), "utf8").trim().split("\n").length;
    const pending = await f.supervisor.spawn("governor", { taskName: ending, message: "WAIT_FIXTURE", profile: "reader", isolation: "none", model: opus }, ending);
    await until(() => readFileSync(join(config, "launch.jsonl"), "utf8").trim().split("\n").length > before);
    if (ending === "worker-death") {
      const pid = f.workers.get(pending.agentId)!.pid;
      assert.ok(pid);
      process.kill(pid, "SIGKILL");
    } else await f.supervisor.close("governor", pending.agentId, "force-close");
    const outcome = await terminal(f.supervisor, pending);
    assert.equal(outcome.outcome, ending === "worker-death" ? "failed" : "interrupted", outcome.detail);
    const pendingStatus = f.supervisor.list("governor").find((agent) => agent.id === pending.agentId)!;
    assert.equal(pendingStatus.usage.inputTokens, 0);
    assert.equal(pendingStatus.usage.unknown, true);
    await until(() => f.supervisor.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.some((record) => record.kind === "usage.reported" && record.body["agentId"] === pending.agentId && record.body["sourceModel"] !== undefined && !String(record.body["receiptId"]).endsWith(":unknown")));
    const originalReceipts = f.supervisor.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((record) => record.kind === "usage.reported" && record.body["agentId"] === pending.agentId && record.body["sourceModel"] !== undefined && !String(record.body["receiptId"]).endsWith(":unknown"));
    assert.equal(originalReceipts.length, 1);
  }
});
