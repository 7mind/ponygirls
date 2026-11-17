import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test from "node:test";

const sdkRoot = process.env.PI_SUBAGENTS_SDK_ROOT;
const providerPackage = process.env.PI_SUBAGENTS_CLAUDE_PACKAGE;
const addonPackage = process.env.PI_CLAUDE_SUBAGENTS_PACKAGE;
const corePackage = process.env.PI_SUBAGENTS_EXTENSION;
const fakeCli = process.env.PI_SUBAGENTS_CLAUDE_FIXTURE;
for (const value of [sdkRoot, providerPackage, addonPackage, corePackage, fakeCli]) assert.ok(value, "actual production-package paths are mandatory");
const { createAgentSession, DefaultResourceLoader, initTheme, ModelRegistry, ModelRuntime, SessionManager, SettingsManager } = await import(pathToFileURL(join(sdkRoot, "dist/index.js")));
const { createAssistantMessageEventStream, InMemoryCredentialStore } = await import(pathToFileURL(join(sdkRoot, "node_modules/@earendil-works/pi-ai/dist/index.js")));
const originalPaths = [join(providerPackage, "src/index.ts"), join(corePackage, "index.ts"), join(addonPackage, "index.ts")];
const CLAUDE = { provider: "claude-code", id: "claude-opus-5-5", thinkingLevel: "off" };
const SONNET = { provider: "claude-code", id: "claude-sonnet-5-5", thinkingLevel: "off" };
const PORTABLE = { provider: "composition-portable", id: "portable-control", thinkingLevel: "off" };

async function lines(path) {
  try { return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

async function fixture(t, paths, portableOptions) {
  const root = await mkdtemp(join(tmpdir(), "claude-addon-composition-"));
  const agentDir = join(root, "agent");
  const config = join(root, "cli-config");
  await mkdir(agentDir);
  await mkdir(config);
  await writeFile(join(root, "probe.txt"), "production three-extension read evidence");
  await writeFile(join(config, "fixture.json"), JSON.stringify({ answer: "Opus composition candidate" }));
  await writeFile(join(agentDir, "subagents-policy.json"), JSON.stringify({ allowedModels: null }));
  const executable = join(root, "claude");
  await writeFile(executable, `#!${process.execPath}\n${await readFile(fakeCli, "utf8")}`);
  await chmod(executable, 0o755);
  const saved = new Map(["PI_CODING_AGENT_DIR", "PI_CLAUDE_CODE_COMMAND", "PI_CLAUDE_CODE_CONFIG_DIR"].map((name) => [name, process.env[name]]));
  Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir, PI_CLAUDE_CODE_COMMAND: executable, PI_CLAUDE_CODE_CONFIG_DIR: config });
  let session = null;
  let server = null;
  const errors = [];
  const notices = [];
  t.after(async () => {
    try {
      if (session !== null) {
        await session.abort();
        try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
        finally { session.dispose(); }
      }
      if (server !== null) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
      for (const launch of [...await lines(join(config, "launch.jsonl")), ...await lines(join(config, "auth.jsonl"))]) {
        try { assert.match((await readFile(`/proc/${launch.pid}/stat`, "utf8")).split(") ").pop(), /^[ZX] /, `owned process ${launch.pid} remains live`); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
    } finally {
      for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
      await rm(root, { recursive: true, force: true });
    }
  });
  if (portableOptions !== null && portableOptions.compaction) {
    await mkdir(join(root, ".pi"));
    await writeFile(join(root, ".pi/settings.json"), JSON.stringify({ compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 1024 }, retry: { enabled: true, baseDelayMs: 10 } }));
  }
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  const requests = [];
  let failed = false;
  if (portableOptions !== null) {
    server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push({ url: request.url, authorization: request.headers.authorization, configuredHeader: request.headers["x-composition"], body });
      if (portableOptions.retry && !failed) { failed = true; response.writeHead(503); response.end("controlled transient failure"); return; }
      const hasResult = body.messages.some((message) => message.role === "tool");
      const callRead = Array.isArray(body.tools) && body.tools.some((tool) => tool.function.name === "read") && !hasResult;
      const delta = callRead ? { role: "assistant", tool_calls: [{ index: 0, id: "composition-read", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "probe.txt" }) } }] } : { role: "assistant", content: "portable composition answer" };
      response.writeHead(200, { "content-type": "text/event-stream" });
      const header = { id: "composition", object: "chat.completion.chunk", created: 1, model: body.model };
      response.write(`data: ${JSON.stringify({ ...header, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ ...header, choices: [{ index: 0, delta: {}, finish_reason: callRead ? "tool_calls" : "stop" }], usage: { prompt_tokens: portableOptions.compaction && hasResult ? 8100 : 11, completion_tokens: 5, total_tokens: portableOptions.compaction && hasResult ? 8105 : 16 } })}\n\n`);
      response.end("data: [DONE]\n\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    runtime.registerProvider(PORTABLE.provider, {
      api: "openai-completions", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "fixture-parent-auth", headers: { "x-composition": "configured" },
      models: [{ id: PORTABLE.id, name: "Portable", input: ["text"], reasoning: false, contextWindow: 8192, maxTokens: 256, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, samplingParams: { temperature: 0.23, top_p: 0.71 } }],
    });
  }
  let nextCall = null;
  let sequence = 0;
  const governor = { provider: "composition-governor", id: "driver" };
  runtime.registerProvider(governor.provider, {
    api: "openai-completions", baseUrl: "http://governor.invalid/v1", apiKey: "fixture-governor", models: [{ id: governor.id, name: "Driver", input: ["text"], reasoning: false, contextWindow: 100_000, maxTokens: 256, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: (model) => {
      const call = nextCall;
      nextCall = null;
      const stream = createAssistantMessageEventStream();
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content: call === null ? [{ type: "text", text: "driver idle" }] : [call], stopReason: call === null ? "stop" : "toolUse", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: "done", reason: message.stopReason, message });
      stream.end();
      return stream;
    },
  });
  const settings = SettingsManager.inMemory({ extensions: paths, compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: { mode: "off" } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.deepEqual(loader.getExtensions().warnings, []);
  initTheme("dark", false);
  ({ session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: runtime.getModel(governor.provider, governor.id), thinkingLevel: "off", settingsManager: settings, resourceLoader: loader, tools: ["spawn_agent", "send_message", "wait_agent", "read_agent", "list_agents", "close_agent"], sessionManager: SessionManager.create(root, join(agentDir, "sessions")) }));
  await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error), uiContext: { ...session.extensionRunner.getUIContext(), notify: (text) => notices.push(text) } });
  const registry = new ModelRegistry(runtime);
  const call = async (name, args) => {
    await session.waitForIdle();
    const id = `control-${++sequence}`;
    nextCall = { type: "toolCall", id, name, arguments: args };
    await session.prompt("controlled delegation command");
    await session.waitForIdle();
    const result = session.messages.find((message) => message.role === "toolResult" && message.toolCallId === id);
    assert.ok(result, `missing production tool result ${name}`);
    const text = result.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    try { return JSON.parse(text); } catch { return { error: text, isError: result.isError }; }
  };
  const spawn = (model, gate) => call("spawn_agent", { task_name: "composition-child", message: "Read probe.txt and answer.", profile: "reader", isolation: "none", model, ...(gate === null ? {} : { gate }) });
  const terminal = async (child) => {
    assert.ok(child.agentId, JSON.stringify(child));
    const waited = await call("wait_agent", { timeout_ms: 15_000, targets: [{ agentId: child.agentId, taskRunId: child.taskRunId }], condition: "all_settled" });
    assert.equal(waited.completed, true, JSON.stringify(waited));
    const result = await call("read_agent", { target: child.agentId, view: "result", task_run_id: child.taskRunId });
    assert.ok(result.result, JSON.stringify(result));
    return result.result;
  };
  return { root, agentDir, config, registry, session, loader, settings, errors, notices, requests, call, spawn, terminal };
}

for (const paths of [originalPaths, [...originalPaths].reverse()]) {
  test(`Effectual-GoodCommunication three original entrypoints compose in ${paths[0] === originalPaths[0] ? "provider-first" : "addon-first"} order and retain Claude workers through actual reload/removal`, { timeout: 60_000 }, async (t) => {
    const f = await fixture(t, paths, null);
    assert.equal(f.loader.getExtensions().extensions.length, 3);
    assert.equal(f.registry.getRegisteredNativeProvider("claude-code").id, "claude-code");
    assert.deepEqual(await lines(join(f.config, "launch.jsonl")), []);
    assert.deepEqual(await lines(join(f.config, "auth.jsonl")), []);
    assert.deepEqual([...((await f.registry.refresh({ providers: ["claude-code"], allowNetwork: true, force: true })).errors)], []);
    const ordinary = await f.registry.streamSimple(f.registry.find(SONNET.provider, SONNET.id), { messages: [{ role: "user", content: "ordinary governor without execution context", timestamp: 0 }] }, { cacheRetention: "none" }).result();
    assert.equal(ordinary.stopReason, "stop", ordinary.errorMessage);
    assert.equal(ordinary.usage.input, 7);
    assert.equal(ordinary.usage.output, 3);
    assert.equal((await lines(join(f.config, "launch.jsonl")))[0].cwd, process.cwd());
    const child = await f.spawn(CLAUDE, { model: SONNET, prompt: "Require Opus", thinkingLevel: "off", maxRounds: 1 });
    assert.equal((await f.terminal(child)).outcome, "passed");
    await f.session.reload();
    const continued = await f.call("send_message", { target: child.agentId, mode: "task", message: "Continue retained conversation." });
    assert.equal((await f.terminal({ ...child, taskRunId: continued.taskRunId })).outcome, "succeeded");
    const beforeUnregister = (await lines(join(f.config, "launch.jsonl"))).length;
    f.registry.unregisterProvider("claude-code");
    const unregistered = await f.call("send_message", { target: child.agentId, mode: "task", message: "Must fail after provider unregistration." });
    assert.equal((await f.terminal({ ...child, taskRunId: unregistered.taskRunId })).outcome, "failed");
    assert.equal((await lines(join(f.config, "launch.jsonl"))).length, beforeUnregister);
    f.settings.setExtensionPaths(paths.filter((path) => path !== originalPaths[2]));
    await f.session.reload();
    const removed = await f.call("send_message", { target: child.agentId, mode: "task", message: "Must fail without addon." });
    assert.equal((await f.terminal({ ...child, taskRunId: removed.taskRunId })).outcome, "failed");
    assert.equal(f.loader.getExtensions().extensions.length, 2);
    assert.deepEqual(f.errors, []);
    const records = await lines(join(f.config, "launch.jsonl"));
    assert.ok(records.some((record) => record.model === "fixture-opus-route"));
    assert.ok(records.some((record) => record.model === "fixture-sonnet-route"));
    assert.ok(records.slice(1).every((record) => record.cwd === f.root && record.config === f.config));
  });
}

for (const missing of ["core", "provider"]) {
  test(`BG actual loader reports missing ${missing} without unsolicited CLI work`, async (t) => {
    const paths = originalPaths.filter((_path, index) => index !== (missing === "core" ? 1 : 0));
    const f = await fixture(t, paths, null);
    assert.deepEqual(await lines(join(f.config, "launch.jsonl")), []);
    assert.deepEqual(await lines(join(f.config, "auth.jsonl")), []);
    assert.ok(f.notices.some((text) => text.includes("pi-claude-code-subagents unavailable")), JSON.stringify(f.notices));
    if (missing === "provider") {
      const result = await f.spawn(CLAUDE, null);
      assert.match(result.error, /MODEL_UNAVAILABLE/);
    }
    assert.deepEqual(f.errors, []);
  });
}

test("BG actual loader rejects a second addon identity rather than replacing its backend", async (t) => {
  const duplicate = await mkdtemp(join(tmpdir(), "claude-addon-duplicate-"));
  t.after(() => rm(duplicate, { recursive: true, force: true }));
  await cp(addonPackage, duplicate, { recursive: true });
  for (const directory of [duplicate, join(duplicate, "executor"), join(duplicate, "src")]) await chmod(directory, 0o755);
  const f = await fixture(t, [...originalPaths, join(duplicate, "index.ts")], null);
  assert.ok(f.notices.some((text) => text.includes("duplicate backend identity")), JSON.stringify(f.notices));
  assert.deepEqual(await lines(join(f.config, "launch.jsonl")), []);
});

test("Effectual-GoodCommunication no addon and loaded-but-unselected addon preserve stock request/auth/sampling/tools/retry/compaction/usage contracts", { timeout: 60_000 }, async (t) => {
  const observations = [];
  for (const addon of [false, true]) {
    const scoped = { after: (cleanup) => t.after(cleanup) };
    const f = await fixture(scoped, addon ? originalPaths : originalPaths.slice(0, 2), { retry: true, compaction: true });
    const child = await f.spawn(PORTABLE, null);
    const first = await f.terminal(child);
    assert.equal(first.outcome, "succeeded", JSON.stringify(first));
    const next = await f.call("send_message", { target: child.agentId, mode: "task", message: "Continue after compaction." });
    assert.equal((await f.terminal({ ...child, taskRunId: next.taskRunId })).outcome, "succeeded");
    const status = (await f.call("list_agents", {})).agents.find((agent) => agent.id === child.agentId);
    const sessionsDirectory = join(f.agentDir, "subagents", f.session.sessionManager.getSessionId(), "sessions", child.agentId);
    const sessionFiles = (await readdir(sessionsDirectory)).filter((name) => name.endsWith(".jsonl"));
    assert.equal(sessionFiles.length, 1);
    const entries = await lines(join(sessionsDirectory, sessionFiles[0]));
    assert.ok(entries.some((entry) => entry.type === "compaction"), "real worker must persist SDK compaction");
    assert.deepEqual(await lines(join(f.config, "launch.jsonl")), []);
    const authCalls = await lines(join(f.config, "auth.jsonl"));
    assert.ok(f.requests.length >= 5, JSON.stringify(f.requests));
    for (const request of f.requests) {
      assert.equal(request.authorization, "Bearer fixture-parent-auth");
      assert.equal(request.configuredHeader, "configured");
      assert.equal(request.url, "/v1/chat/completions");
      assert.equal(request.body.temperature, 0.23);
      assert.equal(request.body.top_p, 0.71);
    }
    const normalize = (value) => JSON.parse(JSON.stringify(value).replaceAll(f.root, "<workspace>").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<execution-id>"));
    observations.push({ requests: normalize(f.requests), usage: status.usage, authCalls: authCalls.length });
  }
  assert.deepEqual(observations[1], observations[0]);
  const destination = process.env.PI_COMPOSITION_OBSERVATION_PATH;
  if (destination !== undefined) await writeFile(destination, JSON.stringify({ inputs: { sdkRoot, providerPackage, addonPackage, corePackage, fakeCli }, observations }, null, 2));
});
