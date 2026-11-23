/** Effectual/Good-Communication regressions: parent registration, request auth, lifecycle, and SDK transport. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, renameSync, linkSync, symlinkSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Supervisor } from "../src/supervisor.ts";
import { InMemoryRunStore } from "../src/store.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { BwrapToolExecutor, HostToolExecutor, DummyToolExecutor } from "../src/sandbox.ts";
import { GitWorkspaceManager, DummyWorkspaceManager } from "../src/workspace.ts";
import { DISCOVERY_OFF, type Discovery } from "../../context-rules/rules.ts";
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

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.email=t@t", "-c", "user.name=test", ...args], { cwd, encoding: "utf8" });
}

async function fixture(t: TestContext, mode: "text" | "tool" | "compact" | "discovery", authMode: "api-key" | "oauth", flow?: "delegated" | "compaction") {
  const sdkRoot = process.env["PI_SUBAGENTS_SDK_ROOT"];
  assert.ok(sdkRoot);
  const root = mkdtempSync(join(tmpdir(), "subagents-parent-model-"));
  const workdir = join(root, "empty-workspace");
  const hostAgentDir = join(root, "host-agent");
  mkdirSync(workdir); mkdirSync(hostAgentDir);
  const discovery = { ...DISCOVERY_OFF };
  const probe = { path: mode === "discovery" ? "nested/probe.txt" : "probe.txt" };
  const owner = { contextFiles: [{ path: join(workdir, "AGENTS.md"), content: "PARENT_SNAPSHOT_ONLY" }, { path: join(hostAgentDir, "CLAUDE.md"), content: "OWNER_GLOBAL_ONLY" }], skills: [] };
  const messages: { role: string; content: unknown }[][] = [];
  const requests: Array<{ key: string | undefined; header: string | string[] | undefined; path: string | undefined }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages: Array<{ role: string; content: unknown }> };
    messages.push(body.messages);
    requests.push({ key: request.headers.authorization, header: request.headers["x-parent-only"], path: request.url });
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const toolTurns = body.messages.filter(message => message.role === "tool").length;
    const tool = flow === "delegated" && toolTurns === 0 ? "parse_number" : "read";
    const callTool = (mode === "tool" || mode === "discovery") && (flow === "compaction" ? requests.length === 1 : toolTurns < (flow === "delegated" ? 2 : 1));
    const highUsage = (mode === "compact" && requests.length === 2) || (flow === "compaction" && requests.length === 3);
    const delta = callTool
      ? { role: "assistant", tool_calls: [{ index: 0, id: `probe-${toolTurns}`, type: "function", function: { name: tool, arguments: JSON.stringify(tool === "read" ? probe : {}) } }] }
      : { role: "assistant", content: ANSWER };
    response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: callTool ? "tool_calls" : "stop" }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: highUsage ? 8100 : 12, completion_tokens: 4, total_tokens: highUsage ? 8104 : 16 } })}\n\n`);
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
  const parser = { name: "parse_number", description: "Read a fixture number", parameters: { type: "object", properties: {} }, execute: async (_id: string, _args: unknown, _signal: unknown, _update: unknown, ctx: unknown) => {
    const inner = await (ctx as { executeTool(name: string, args: unknown): Promise<{ result: { content: { text: string }[] } }> }).executeTool("read", { path: "nested/probe.txt" });
    return { content: [{ type: "text", text: String((JSON.parse(inner.result.content[0].text) as { number: number }).number) }], details: {} };
  } };
  if (flow === "delegated") policy.allowedTools = [parser.name];
  const reopen = (store: InMemoryRunStore) => new Supervisor({
    ...(flow === "delegated" ? { governingRegistry: () => ({ isActive: () => true, listHandles: () => [parser], getHandle: () => parser, baseCtx: () => ({}) }) } : {}),
    rootId: "parent-model", rootDir: join(root, "root"), store, policy,
    governor: () => ({ model: { provider: PROVIDER, id: MODEL, thinkingLevel: "off" }, cwd: workdir, instructions: mode === "discovery" ? owner : EMPTY_INSTRUCTIONS }),
    ...(mode === "discovery" ? { discovery: () => ({ grants: discovery, mainFiles: [] }) } : {}),
    parentModels: source,
    sdkRoot, hostAgentDir,
    workerFactory: (options) => {
      const agentDir = join(root, "root", "worker-agent-dirs", options.agentId);
      mkdirSync(agentDir, { recursive: true });
      if (mode === "compact" || flow === "compaction") writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 1, reserveTokens: 1024 } }));
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
    ...(mode === "discovery" ? { executors: { host: new HostToolExecutor(), sandbox: new BwrapToolExecutor() }, workspace: new GitWorkspaceManager() } : { executors: { host: new DummyToolExecutor(), sandbox: new DummyToolExecutor() }, workspace: new DummyWorkspaceManager() }),
  });
  const sup = reopen(store);
  lifecycle.supervisor = sup;
  return { reopen, root, workdir, hostAgentDir, discovery, probe, messages, sup, store, runtime, registry, model, requests, source, policy, admissions, sessionsDir, get authCalls() { return authCalls; } };
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
  const child = await f.sup.spawn("governor", { taskName: "tool", message: "Read probe.txt.", profile: "reader", model: { provider: PROVIDER, id: MODEL, thinkingLevel: "high" } }, "tool");
  for (const view of [child, f.sup.list("governor")[0]!, f.sup.read("governor", child.agentId, "status", 0, 10, null).status]) {
    assert.equal(view.model, `${PROVIDER}/${MODEL}`);
    assert.equal(view.requestedThinkingLevel, "high");
    assert.equal(view.thinkingLevel, "off");
  }
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


function assertRule(messages: { role: string; content: unknown }[], role: "system" | "tool", path: string, body: string): void {
  const expected = `<project_instructions path="${path}">\n${body}\n</project_instructions>`;
  assert.ok(messages.some(m => m.role === role && typeof m.content === "string" && m.content.includes(expected)), `${role}: ${expected}`);
}

test("child provider requests contain only admitted AGENTS.md sources and load nested rules on access", async t => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("needs pinned SDK"); return; }
  const f = await fixture(t, "discovery", "api-key");
  const { workdir, hostAgentDir } = f;
  const childDir = join(f.root, "separate");
  const nested = join(childDir, "nested");
  const named = join(childDir, "elsewhere");
  mkdirSync(nested, { recursive: true }); mkdirSync(named);
  gitIn(childDir, "init", "-q");
  writeFileSync(join(hostAgentDir, "AGENTS.MD"), "GLOBAL_ONLY");
  writeFileSync(join(hostAgentDir, "CLAUDE.md"), "GLOBAL_LOSER");
  writeFileSync(join(workdir, "AGENTS.md"), "OWNER_DISK_ONLY");
  writeFileSync(join(childDir, "AGENTS.md"), "CHECKOUT_LOSER");
  writeFileSync(join(childDir, "AGENTS.override.md"), "\ufeffCHECKOUT_ONLY");
  writeFileSync(join(nested, "CLAUDE.MD"), "NESTED_ONLY");
  f.probe.path = "nested/deeper/probe.txt";
  mkdirSync(join(nested, "deeper"));
  writeFileSync(join(childDir, f.probe.path), "FILE_READ_OK");
  writeFileSync(join(named, "AGENTS.md"), "EXPLICIT_ONLY");
  writeFileSync(join(named, "CLAUDE.md"), "EXPLICIT_ONLY");
  writeFileSync(join(f.root, "AGENTS.md"), "POOL_ANCESTOR_ONLY");
  writeFileSync(join(childDir, "SYSTEM.md"), "AMBIENT_SYSTEM_ONLY");
  mkdirSync(join(childDir, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(childDir, ".pi", "extensions", "bad.ts"), "throw Error('AMBIENT_EXTENSION_ONLY')");
  gitIn(childDir, "add", ".");
  gitIn(childDir, "commit", "-qm", "fixture");
  for (const enabled of [null, "parent", "global", "worktree", "nested", "all"] as const) {
    for (const key of Object.keys(f.discovery) as (keyof Discovery)[]) f.discovery[key] = enabled === key || enabled === "all";
    const start = f.messages.length;
    const child = await f.sup.spawn("governor", { taskName: `source-${enabled}`, message: "Read the probe.", profile: "reader", workspacePath: childDir,
      ...(enabled === "all" ? { contextFiles: ["elsewhere/AGENTS.md", "elsewhere/CLAUDE.md"] } : {}) }, `source-${enabled}`);
    assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
    const requests = f.messages.slice(start);
    assert.equal(requests.length, 2);
    const [first, second] = requests.map(request => JSON.stringify(request));
    assert.ok(!first.includes("NESTED_ONLY")); assert.ok(second.includes("FILE_READ_OK"));
    assert.equal(second.includes("NESTED_ONLY"), enabled === "nested" || enabled === "all");
    for (const [key, marker] of [["global", "GLOBAL_ONLY"], ["worktree", "CHECKOUT_ONLY"], ["parent", "PARENT_SNAPSHOT_ONLY"]]) {
      assert.equal(first.includes(marker), enabled === key || enabled === "all", `${enabled}: ${marker}`);
    }
    assert.equal(first.includes("EXPLICIT_ONLY"), enabled === "all");
    if (enabled === "all") {
      assertRule(requests[0], "system", join(hostAgentDir, "AGENTS.MD"), "GLOBAL_ONLY");
      assertRule(requests[0], "system", join(childDir, "AGENTS.override.md"), "CHECKOUT_ONLY");
      assertRule(requests[0], "system", join(workdir, "AGENTS.md"), "PARENT_SNAPSHOT_ONLY");
      assertRule(requests[0], "system", join(named, "AGENTS.md"), "EXPLICIT_ONLY");
      assertRule(requests[0], "system", join(named, "CLAUDE.md"), "EXPLICIT_ONLY");
      assertRule(requests[1], "tool", join(nested, "CLAUDE.MD"), "NESTED_ONLY");
    }
    for (const marker of ["OWNER_DISK_ONLY", "OWNER_GLOBAL_ONLY", "GLOBAL_LOSER", "CHECKOUT_LOSER", "POOL_ANCESTOR_ONLY", "AMBIENT_SYSTEM_ONLY", "AMBIENT_EXTENSION_ONLY"]) assert.ok(!second.includes(marker), marker);
    await f.sup.close("governor", child.agentId, `close-${enabled}`);
  }
  const args = { taskName: "rollback", message: "Read the probe.", profile: "reader" as const, workspacePath: childDir };
  symlinkSync(hostAgentDir, join(childDir, "escape"));
  for (const name of [join(hostAgentDir, "AGENTS.MD"), "../AGENTS.md", "escape/AGENTS.MD", "nested/probe.txt", "missing/AGENTS.md"]) {
    const count = f.messages.length;
    await assert.rejects(f.sup.spawn("governor", { ...args, contextFiles: [name] }, "rollback"), /Instruction lookup failed/);
    assert.equal(f.messages.length, count);
  }
  const child = await f.sup.spawn("governor", { ...args, contextFiles: "all" }, "rollback");
  assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
  assert.ok(JSON.stringify(f.messages.at(-2)).includes("OWNER_GLOBAL_ONLY"));
  assert.ok(!JSON.stringify(f.messages.at(-1)).includes("EXPLICIT_ONLY"));
});

test("sandbox AGENTS.md uses the mounted view for startup, access and explicit selection", async t => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("needs pinned SDK"); return; }
  const probe = new BwrapToolExecutor().probe();
  if (!probe.ok) { t.skip(probe.error.message); return; }
  const f = await fixture(t, "discovery", "api-key");
  f.policy.repos.push({ repoId: "view", checkoutPath: f.root, readRoots: [`${f.root}/`], allowWriters: false });
  f.discovery.worktree = true; f.discovery.nested = true;
  writeFileSync(join(f.hostAgentDir, "AGENTS.md"), "HIDDEN_AGENT_HOME");
  writeFileSync(join(f.root, "AGENTS.md"), "SANDBOX_START");
  mkdirSync(join(f.root, "nested"));
  writeFileSync(join(f.root, "nested", "probe.txt"), "SANDBOX_DATA");
  writeFileSync(join(f.root, "nested", "CLAUDE.md"), "SANDBOX_NESTED");
  const args = { taskName: "mounted", profile: "reader" as const, isolation: "sandbox" as const, repoId: "view", message: "Read the probe." };
  await assert.rejects(f.sup.spawn("governor", { ...args, contextFiles: ["host-agent/AGENTS.md"] }, "masked"), /Instruction lookup failed/);
  const child = await f.sup.spawn("governor", args, "mounted");
  assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
  assert.ok(JSON.stringify(f.messages[0]).includes("SANDBOX_START"));
  assert.ok(!JSON.stringify(f.messages[0]).includes("SANDBOX_NESTED"));
  const last = JSON.stringify(f.messages.at(-1));
  assert.ok(last.includes("SANDBOX_NESTED") && last.includes("SANDBOX_DATA"));
  assert.ok(!last.includes("HIDDEN_AGENT_HOME"));
});

test("sandbox worktree discovery stops at the effective cwd's checkout, not the registered superproject", async t => {
  const f = await fixture(t, "discovery", "api-key");
  gitIn(f.root, "init", "-q"); writeFileSync(join(f.root, "AGENTS.md"), "SUPERPROJECT_RULE");
  gitIn(f.root, "add", "AGENTS.md"); gitIn(f.root, "commit", "-qm", "super");
  gitIn(f.workdir, "init", "-q"); writeFileSync(join(f.workdir, "AGENTS.md"), "NESTED_CHECKOUT_RULE");
  gitIn(f.workdir, "add", "AGENTS.md"); gitIn(f.workdir, "commit", "-qm", "nested");
  f.probe.path = "probe"; writeFileSync(join(f.workdir, "probe"), "DATA");
  const mounts = mkdtempSync(join(tmpdir(), "reader-mount-")); t.after(() => rmSync(mounts, { recursive: true, force: true }));
  const alias = join(mounts, "current"); symlinkSync(f.workdir, alias);
  f.discovery.worktree = true;
  for (const [name, first] of [["physical", f.workdir], ["aliased", alias]]) {
    f.policy.repos.push({ repoId: name, checkoutPath: f.root, readRoots: [first, f.root], allowWriters: false });
    const start = f.messages.length;
    const child = await f.sup.spawn("governor", { taskName: name, profile: "reader", isolation: "sandbox", repoId: name, message: "Read the probe." }, name);
    assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
    assert.match(JSON.stringify(f.messages[start]), /NESTED_CHECKOUT_RULE/);
    assert.doesNotMatch(JSON.stringify(f.messages[start]), /SUPERPROJECT_RULE/);
  }
  const pkg = join(f.workdir, "pkg"); mkdirSync(pkg);
  writeFileSync(join(pkg, "probe"), "PACKAGE_DATA");
  writeFileSync(join(pkg, "CLAUDE.md"), "PACKAGE_FALLBACK");
  writeFileSync(join(pkg, "rules.md"), "PACKAGE_RULE");
  mkdirSync(join(f.workdir, "policy")); writeFileSync(join(f.workdir, "policy/pkg.md"), "PACKAGE_RULE");
  const current = join(mounts, "package"); symlinkSync(pkg, current);
  for (const [name, first, target] of [["split", current, join(pkg, "rules.md")], ["overlap", pkg, "../policy/pkg.md"]]) {
    await t.test(name, async () => {
      rmSync(join(pkg, "AGENTS.md"), { force: true }); symlinkSync(target, join(pkg, "AGENTS.md"));
      f.policy.repos.push({ repoId: name, checkoutPath: f.workdir, readRoots: [first, f.workdir], allowWriters: false });
      const start = f.messages.length;
      const child = await f.sup.spawn("governor", { taskName: name, profile: "reader", isolation: "sandbox", repoId: name, message: "Read the probe." }, name);
      assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
      const prompt = JSON.stringify(f.messages[start]);
      assertRule(f.messages[start], "system", join(pkg, "AGENTS.md"), "PACKAGE_RULE");
      assert.match(prompt, /NESTED_CHECKOUT_RULE[\s\S]*PACKAGE_RULE/);
      assert.equal(prompt.split("PACKAGE_RULE").length, 2);
      assert.doesNotMatch(prompt, /PACKAGE_FALLBACK|SUPERPROJECT_RULE/);
    });
  }
});

test("allocated worktree uses committed rules from checkout root through effective cwd and rolls back failed admissions", async t => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("needs pinned SDK"); return; }
  const f = await fixture(t, "discovery", "api-key");
  const git = (...args: string[]) => gitIn(f.root, ...args);
  git("init", "-q");
  writeFileSync(join(f.root, "CLAUDE.md"), "COMMITTED_ROOT");
  writeFileSync(join(f.workdir, "AGENTS.md"), "COMMITTED_SUBDIR");
  mkdirSync(join(f.workdir, "nested"));
  writeFileSync(join(f.workdir, "nested", "probe.txt"), "BASE_DATA");
  git("add", "CLAUDE.md", "empty-workspace"); git("commit", "-qm", "base");
  writeFileSync(join(f.workdir, "AGENTS.md"), "UNCOMMITTED_OWNER");
  f.discovery.worktree = true;
  const args = { taskName: "allocated", profile: "writer" as const, baseCommit: "HEAD", message: "Read the probe." };
  const before = git("worktree", "list", "--porcelain");
  await assert.rejects(f.sup.spawn("governor", { ...args, contextFiles: ["../CLAUDE.md"] }, "allocated"), /Instruction lookup failed/);
  assert.equal(git("worktree", "list", "--porcelain"), before);
  const child = await f.sup.spawn("governor", args, "allocated");
  assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
  const prompt = JSON.stringify(f.messages[0]);
  assertRule(f.messages[0], "system", join(dirname(child.workdir), "CLAUDE.md"), "COMMITTED_ROOT");
  assertRule(f.messages[0], "system", join(child.workdir, "AGENTS.md"), "COMMITTED_SUBDIR");
  assert.ok(prompt.indexOf("COMMITTED_ROOT") !== -1 && prompt.indexOf("COMMITTED_SUBDIR") > prompt.indexOf("COMMITTED_ROOT"));
  assert.ok(!prompt.includes("UNCOMMITTED_OWNER"));
});

test("nested edges use direct parent snapshots, never refresh global from disk or widen prior grants", async t => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("needs pinned SDK"); return; }
  const f = await fixture(t, "discovery", "api-key");
  f.policy.nesting = true; f.policy.maxDepth = 2;
  const sub = join(f.workdir, "nested"); mkdirSync(sub);
  writeFileSync(join(sub, "probe.txt"), "DATA"); writeFileSync(join(sub, "AGENTS.md"), "HELD_RULE");
  writeFileSync(join(f.hostAgentDir, "AGENTS.md"), "HELD_GLOBAL");
  f.discovery.parent = true; f.discovery.nested = true; f.discovery.global = true;
  const parent = await f.sup.spawn("governor", { taskName: "owner", profile: "reader", message: "Read the probe." }, "owner");
  assert.equal((await terminal(f.sup, parent.agentId, parent.taskRunId, 1)).outcome, "succeeded");
  writeFileSync(join(f.workdir, "AGENTS.md"), "NEW_ROOT_RULE");
  writeFileSync(join(f.hostAgentDir, "AGENTS.md"), "CHANGED_GLOBAL"); writeFileSync(join(sub, "AGENTS.md"), "CHANGED_RULE");
  f.discovery.worktree = true;
  const start = f.messages.length;
  const child = await f.sup.spawn(parent.agentId, { taskName: "nested", profile: "reader", message: "Read the probe." }, "nested");
  assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
  const first = JSON.stringify(f.messages[start]);
  for (const marker of ["HELD_RULE", "HELD_GLOBAL", "PARENT_SNAPSHOT_ONLY"]) assert.ok(first.includes(marker), marker);
  for (const marker of ["CHANGED_GLOBAL", "CHANGED_RULE", "NEW_ROOT_RULE"]) assert.ok(!JSON.stringify(f.messages.at(-1)).includes(marker), marker);
  assert.equal(JSON.stringify(f.messages.at(-1)).split("HELD_RULE").length, 2);
  await assert.rejects(f.sup.spawn(parent.agentId, { taskName: "denied", profile: "reader", message: "Read.", contextFiles: ["AGENTS.md"] }, "denied"), /unknown context file/);
});

for (const checkpoint of [true, false]) test(`resumed child keeps one retained copy of its on-access rule (checkpoint: ${checkpoint})`, async t => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) { t.skip("needs pinned SDK"); return; }
  const f = await fixture(t, "discovery", "api-key");
  f.discovery.worktree = true; f.discovery.nested = true;
  const path = join(f.workdir, "nested"); mkdirSync(path); writeFileSync(join(path, "probe.txt"), "DATA");
  writeFileSync(join(path, "AGENTS.md"), "NESTED_AT_FIRST_READ");
  writeFileSync(join(f.workdir, "AGENTS.md"), "ROOT_AT_SPAWN");
  const child = await f.sup.spawn("governor", { taskName: "evicted", profile: "reader", message: "Read the probe." }, "evicted");
  assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
  const firstSystem = f.messages[0].filter(message => ["developer", "system"].includes(message.role));
  assert.ok(JSON.stringify(firstSystem).includes("ROOT_AT_SPAWN"));
  await until(() => f.store.loadCheckpoint(child.agentId)?.ref.generation === 1, 10_000);
  await f.sup.evictWorker("governor", child.agentId);
  if (!checkpoint) f.store.loadCheckpoint = () => null;
  writeFileSync(join(path, "AGENTS.md"), "NEW_RULE_ON_DISK");
  writeFileSync(join(f.workdir, "AGENTS.md"), "NEW_ROOT_ON_DISK");
  const next = await f.sup.sendMessage("governor", child.agentId, "task", "Report what you already saw.", {}, "resume");
  assert.ok(next.taskRunId);
  assert.equal((await terminal(f.sup, child.agentId, next.taskRunId, 2)).outcome, "succeeded");
  const last = f.messages.at(-1)!;
  if (checkpoint) assert.deepEqual(last.filter(message => ["developer", "system"].includes(message.role)), firstSystem);
  assertRule(last, checkpoint ? "tool" : "system", join(path, "AGENTS.md"), "NESTED_AT_FIRST_READ");
  assert.equal(JSON.stringify(last).split("NESTED_AT_FIRST_READ").length, 2);
  assert.ok(!JSON.stringify(last).includes("ON_DISK"));
});


test("a delegated parser gets clean data; the next direct access delivers nested AGENTS.md to the child", async t => {
  if (!process.env.PI_SUBAGENTS_SDK_ROOT) { t.skip("needs packaged Pi"); return; }
  const f = await fixture(t, "discovery", "api-key", "delegated"); f.discovery.nested = true;
  mkdirSync(join(f.workdir, "nested")); writeFileSync(join(f.workdir, "nested/probe.txt"), '{"number":73}');
  writeFileSync(join(f.workdir, "nested/AGENTS.md"), "PARSER_NESTED_MARKER");
  const child = await f.sup.spawn("governor", { taskName: "parser", profile: "reader", message: "Read the number." }, "parser");
  assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
  assert.equal(f.messages[1].find(m => m.role === "tool")?.content, "73");
  assert.ok(!JSON.stringify(f.messages[1]).includes("PARSER_NESTED_MARKER"));
  assert.equal(JSON.stringify(f.messages.at(-1)).split("PARSER_NESTED_MARKER").length, 2);
});

test("a compacted resident child receives the original on-access AGENTS.md rule once after its tool result is gone", async t => {
  if (!process.env.PI_SUBAGENTS_SDK_ROOT) { t.skip("needs packaged Pi"); return; }
  const f = await fixture(t, "discovery", "api-key", "compaction"); f.discovery.nested = true;
  mkdirSync(join(f.workdir, "nested")); writeFileSync(join(f.workdir, "nested/probe.txt"), "DISCOVERING_TOOL_RESULT");
  const rule = join(f.workdir, "nested/AGENTS.md"); writeFileSync(rule, "RESIDENT_RULE_AT_READ");
  const child = await f.sup.spawn("governor", { taskName: "resident", profile: "reader", message: "Read the probe." }, "resident");
  assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
  assert.equal(JSON.stringify(f.messages.at(-1)).split("RESIDENT_RULE_AT_READ").length, 2);
  writeFileSync(rule, "CHANGED_RESIDENT_RULE");
  for (const gen of [2, 3]) {
    const sent = await f.sup.sendMessage("governor", child.agentId, "task", `New turn ${gen}.`, {}, `again-${gen}`);
    assert.ok(sent.taskRunId); assert.equal((await terminal(f.sup, child.agentId, sent.taskRunId, gen)).outcome, "succeeded");
  }
  assert.ok(f.requests.length > 4, "compaction summary reached the provider");
  const last = JSON.stringify(f.messages.at(-1));
  assert.ok(!last.includes("DISCOVERING_TOOL_RESULT") && !last.includes("CHANGED_RESIDENT_RULE"));
  assertRule(f.messages.at(-1)!, "system", rule, "RESIDENT_RULE_AT_READ");
  assert.equal(last.split("RESIDENT_RULE_AT_READ").length, 2);
});


test("nested discovery follows the actual accessed path for in-tree '..' spellings, but not targets outside the tree", async t => {
  if (!process.env.PI_SUBAGENTS_SDK_ROOT) { t.skip("needs packaged Pi"); return; }
  const f = await fixture(t, "discovery", "api-key"); f.discovery.nested = true;
  const shared = join(f.workdir, "shared"), src = join(f.workdir, "src"), outside = join(f.root, "outside");
  mkdirSync(shared); mkdirSync(src); mkdirSync(join(outside, "inner"), { recursive: true });
  writeFileSync(join(shared, "data"), "SHARED_DATA"); writeFileSync(join(shared, "AGENTS.md"), "SHARED_RULE");
  writeFileSync(join(src, "AGENTS.md"), "LEXICAL_SRC_RULE"); symlinkSync(join(outside, "inner"), join(src, "alias"));
  writeFileSync(join(outside, "AGENTS.md"), "OUTSIDE_RULE"); writeFileSync(join(outside, "data"), "OUTSIDE_DATA");
  for (const [i, path] of ["shared/data", "src/../shared/data", "src/alias/../data"].entries()) {
    f.probe.path = path;
    const child = await f.sup.spawn("governor", { taskName: `access-${i}`, profile: "reader", message: "Read the file." }, `access-${i}`);
    assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
    const reply = JSON.stringify(f.messages.at(-1));
    assert.ok(reply.includes(i === 2 ? "OUTSIDE_DATA" : "SHARED_DATA"), path);
    assert.equal(reply.includes("SHARED_RULE"), i !== 2, path);
    assert.ok(!reply.includes("LEXICAL_SRC_RULE") && !reply.includes("OUTSIDE_RULE"), path);
  }
});

for (const change of ["retarget", "replace", "removed", "too large"]) test(`changing a native read target before lookup (${change}) cannot install replacement rules`, async t => {
  const f = await fixture(t, "discovery", "api-key"); f.discovery.nested = true;
  for (const name of ["A", "B"]) {
    mkdirSync(join(f.workdir, name)); writeFileSync(join(f.workdir, name, "AGENTS.md"), `RULE_${name}`);
    writeFileSync(join(f.workdir, name, "probe"), `DATA_${name}`);
  }
  const alias = join(f.workdir, "current"); symlinkSync("A", alias);
  f.probe.path = "current/probe";
  const lookup = f.sup.toolBroker.instructionFiles.bind(f.sup.toolBroker);
  t.mock.method(f.sup.toolBroker, "instructionFiles", (...args: Parameters<typeof lookup>) => {
    if (change === "too large") writeFileSync(join(f.workdir, "A/AGENTS.md"), Buffer.alloc(129 * 1024));
    else if (change === "removed") renameSync(join(f.workdir, "A"), join(f.workdir, "moved"));
    else if (change === "retarget") { rmSync(alias); symlinkSync("B", alias); }
    else {
      renameSync(join(f.workdir, "A"), join(f.workdir, "original"));
      renameSync(join(f.workdir, "B"), join(f.workdir, "A"));
      rmSync(join(f.workdir, "A/probe")); linkSync(join(f.workdir, "original/probe"), join(f.workdir, "A/probe"));
    }
    return lookup(...args);
  });
  const child = await f.sup.spawn("governor", { taskName: "rotated", profile: "reader", message: "Read the probe." }, "rotated");
  assert.equal((await terminal(f.sup, child.agentId, child.taskRunId, 1)).outcome, "succeeded");
  const reply = JSON.stringify(f.messages.at(-1));
  assert.match(reply, /DATA_A/); assert.doesNotMatch(reply, /RULE_B/);
  const content = f.messages.at(-1)?.find(m => m.role === "tool")?.content;
  if (change === "removed") assert.equal(content, "DATA_A");
  if (change === "too large") assert.equal(content, "[Instruction discovery failed after read succeeded]\nDATA_A");
  assert.equal(reply.includes("RULE_A"), change === "retarget");
  assert.deepEqual(f.sup.instructionInventory()[0].paths, change === "retarget" ? [join(f.workdir, "A/AGENTS.md")] : []);
});

test("worker inventory survives closure; replay distinguishes accepted snapshots from offers and legacy sources", async t => {
  const f = await fixture(t, "discovery", "api-key");
  const base = join(f.workdir, "AGENTS.md"), nested = join(f.workdir, "nested", "CLAUDE.md");
  mkdirSync(join(f.workdir, "nested")); writeFileSync(nested, "ONLY_THE_RECIPIENT_KNOWS");
  writeFileSync(join(f.workdir, "nested/probe.txt"), "probe");
  const child = await f.sup.spawn("governor", { profile: "reader", taskName: "explicit", message: "Read the probe.", contextFiles: [base] }, "explicit");
  await terminal(f.sup, child.agentId, child.taskRunId, 1);
  const row = { agentId: child.agentId, parentId: null, label: "explicit", state: "settled", paths: [base], complete: true };
  assert.deepEqual(f.sup.instructionInventory(), [row]);
  assert.ok(JSON.stringify(f.messages[0]).includes("PARENT_SNAPSHOT_ONLY"));
  f.discovery.nested = true;
  const receiver = await f.sup.spawn("governor", { profile: "reader", taskName: "receiver", message: "Read the probe.", contextFiles: [base] }, "receiver");
  await terminal(f.sup, receiver.agentId, receiver.taskRunId, 1);
  await f.sup.close("governor", receiver.agentId, "close-receiver");
  const received = { ...row, agentId: receiver.agentId, label: "receiver", state: "closed", paths: [base, nested] };
  assert.deepEqual(f.sup.instructionInventory(), [row, received]);
  for (const view of [f.sup.list("governor"), f.sup.read("governor", receiver.agentId, "events", 0, 100, null)]) {
    assert.ok(!JSON.stringify(view).includes(nested)); assert.ok(!JSON.stringify(view).includes("ONLY_THE_RECIPIENT_KNOWS"));
  }
  await f.sup.shutdown();
  for (const missing of ["none", "startup", "nested", "both"]) {
    const store = new InMemoryRunStore("parent-model");
    for (const r of f.store.readSince(0, Infinity).records) {
      const body = { ...r.body };
      if (body.agentId === receiver.agentId && r.kind === "history.source" && ["startup", "both"].includes(missing)) delete body.installedInstructionHash;
      if (r.kind === "agent.instructions_accepted" && ["nested", "both"].includes(missing)) continue;
      store.append(r.kind, body);
    }
    const replay = new Supervisor({ rootId: "parent-model", rootDir: join(f.root, "root"), store, policy: f.policy, governor: () => { throw Error("replay must not rescan"); } });
    try {
      assert.deepEqual(replay.instructionInventory(), [row, { ...received, paths: [...(["none", "nested"].includes(missing) ? [base] : []), ...(["none", "startup"].includes(missing) ? [nested] : [])], complete: missing === "none" }]);
    } finally { await replay.shutdown(); }
  }
  const lost = new InMemoryRunStore("parent-model");
  for (const r of f.store.readSince(0, Infinity).records) {
    if (r.body.agentId === receiver.agentId && ["agent.instructions_accepted", "agent.closed"].includes(r.kind)) continue;
    lost.append(r.kind, r.body);
  }
  const fresh = f.reopen(lost);
  try {
    assert.equal(lost.loadCheckpoint(receiver.agentId), null);
    const start = f.messages.length;
    const task = await fresh.sendMessage("governor", receiver.agentId, "task", "Read the probe again.", {}, "fresh");
    assert.ok(task.taskRunId); assert.equal((await terminal(fresh, receiver.agentId, task.taskRunId, 2)).outcome, "succeeded");
    assert.doesNotMatch(JSON.stringify(f.messages[start]), /ONLY_THE_RECIPIENT_KNOWS/);
    assert.equal(JSON.stringify(f.messages.at(-1)).split("ONLY_THE_RECIPIENT_KNOWS").length - 1, 1);
    assert.deepEqual(fresh.instructionInventory()[1], { ...received, state: "settled", complete: false });
  } finally { await fresh.shutdown(); }
});

for (const mode of ["gate", "review"] as const) test(`${mode}: the ordinary candidate alone receives discovered rules and appears in the inventory`, async t => {
  const f = await fixture(t, "discovery", "api-key");
  f.discovery.parent = true; f.discovery.nested = true;
  mkdirSync(join(f.workdir, "nested")); writeFileSync(join(f.workdir, "nested/probe.txt"), "PROBE_OK"); writeFileSync(join(f.workdir, "nested/AGENTS.md"), "CANDIDATE_ONLY");
  const spec = { model: { provider: PROVIDER, id: MODEL }, thinkingLevel: "off", prompt: "Review the candidate." };
  const candidate = await f.sup.spawn("governor", { taskName: mode, message: "Read the probe.", profile: "reader", [mode]: spec }, mode);
  await until(() => f.messages.length === 4, 10_000);
  const [first, second, third, fourth] = f.messages.map(m => JSON.stringify(m));
  assert.ok(first.includes("PARENT_SNAPSHOT_ONLY") && second.includes("CANDIDATE_ONLY"));
  for (const request of [third, fourth]) { assert.ok(!request.includes("PARENT_SNAPSHOT_ONLY")); assert.ok(!request.includes("CANDIDATE_ONLY")); }
  assert.deepEqual(f.sup.instructionInventory().map(r => [r.agentId, r.paths, r.complete]), [[candidate.agentId, [join(f.workdir, "AGENTS.md"), join(f.workdir, "nested/AGENTS.md")], true]]);
});
