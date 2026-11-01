/**
 * Effectual/Good-Communication regression: a real worker, local provider, and
 * real Pi extension reload. No public network or real credentials.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type TextContent, type ToolCall } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, initTheme, ModelRuntime, SessionManager, SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import subagents from "../index.ts";

const CHILD_PROVIDER = "reload-child";
const CHILD_MODEL = "scripted";
const OLD_KEY = "fixture-old-account";
const NEW_KEY = "fixture-new-account";
const STEP_TIMEOUT_MS = 5_000;

async function within<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), STEP_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function assistant(model: { api: string; provider: string; id: string }, content: Array<TextContent | ToolCall>, stopReason: "toolUse" | "stop") {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: stopReason, message: {
    role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason, timestamp: Date.now(),
  } });
  return stream;
}

function sse(response: import("node:http").ServerResponse, callTool: boolean): void {
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const delta = callTool
    ? { role: "assistant", tool_calls: [{ index: 0, id: "read-probe", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "probe.txt" }) } }] }
    : { role: "assistant", content: "continued after reload" };
  response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: callTool ? "tool_calls" : "stop" }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } })}\n\n`);
  response.end("data: [DONE]\n\n");
}

// Regression: /reload used to shut the supervisor down, killing active workers.
test("a subagent session survives reload and continues with a rotated provider account", { timeout: 30_000 }, async (t) => {
  if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) {
    t.skip("PI_SUBAGENTS_SDK_ROOT is required for the real worker");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-reload-survival-"));
  const originalAgentDir = process.env["PI_CODING_AGENT_DIR"];
  process.env["PI_CODING_AGENT_DIR"] = dir;
  initTheme("dark", false);
  writeFileSync(join(dir, "probe.txt"), "probe survives reload\n");
  const firstRequestEntered = Promise.withResolvers<void>();
  const releaseFirstRequest = Promise.withResolvers<void>();
  const secondRequestEntered = Promise.withResolvers<void>();
  const childFinished = Promise.withResolvers<void>();
  const governorResumed = Promise.withResolvers<void>();
  const childRequests: Array<{ authorization: string | undefined; hasToolResult: boolean }> = [];
  const errors: unknown[] = [];
  let session: AgentSession | null = null;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { messages: Array<{ role: string }> };
    childRequests.push({
      authorization: request.headers.authorization,
      hasToolResult: body.messages.some((message) => message.role === "tool"),
    });
    const callTool = !body.messages.some((message) => message.role === "tool");
    if (callTool) {
      firstRequestEntered.resolve();
      await releaseFirstRequest.promise;
    } else {
      secondRequestEntered.resolve();
    }
    sse(response, callTool);
  });
  t.after(async () => {
    releaseFirstRequest.resolve();
    try {
      if (session !== null) {
        try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
        finally { session.dispose(); }
      }
    } finally {
      server.closeAllConnections();
      server.close();
      if (originalAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
      else process.env["PI_CODING_AGENT_DIR"] = originalAgentDir;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const childProvider = {
    api: "openai-completions" as const,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    models: [{ id: CHILD_MODEL, name: "Reload child", reasoning: false, input: ["text" as const], contextWindow: 100_000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  };
  writeFileSync(join(dir, "auth.json"), "{}");
  writeFileSync(join(dir, "subagents-policy.json"), JSON.stringify({ allowedModels: [{ provider: CHILD_PROVIDER, id: CHILD_MODEL }] }));

  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerProvider(CHILD_PROVIDER, { ...childProvider, apiKey: OLD_KEY });
  let governorRequests = 0;
  modelRuntime.registerProvider("reload-governor", {
    api: "openai-completions", baseUrl: "http://governor.invalid/v1", apiKey: "fixture-governor",
    models: [{ id: "scripted", name: "Governor", reasoning: false, input: ["text" as const], contextWindow: 100_000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model) {
      governorRequests++;
      if (governorRequests === 1) return assistant(model, [{
        type: "toolCall", id: "spawn-child", name: "spawn_agent", arguments: {
          task_name: "reload-child", message: "Read probe.txt, then report completion.", profile: "reader", isolation: "none",
          model: { provider: CHILD_PROVIDER, id: CHILD_MODEL },
        },
      }], "toolUse");
      if (governorRequests === 3) governorResumed.resolve();
      return assistant(model, [{ type: "text", text: "governor idle" }], "stop");
    },
  });
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir, agentDir: dir, settingsManager,
    noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [subagents],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const model = modelRuntime.getModel("reload-governor", "scripted");
  assert.ok(model);
  ({ session } = await createAgentSession({
    cwd: dir, agentDir: dir, modelRuntime, model, settingsManager, resourceLoader, thinkingLevel: "off", tools: ["spawn_agent"],
    sessionManager: SessionManager.create(dir, join(dir, "sessions")),
  }));
  await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error) });
  session.subscribe((event) => {
    if (event.type === "message_start" && event.message.role === "custom" && event.message.customType === "pi-subagents-notice") {
      if (JSON.stringify(event.message.content).includes("ended succeeded")) childFinished.resolve();
    }
  });

  await session.prompt("start the child");
  await within(firstRequestEntered.promise, "the child did not start its first provider request");
  assert.equal(governorRequests, 2);
  assert.deepEqual(childRequests, [{ authorization: `Bearer ${OLD_KEY}`, hasToolResult: false }]);

  await within(session.reload({ beforeSessionStart: async () => {
    await modelRuntime.setRuntimeApiKey(CHILD_PROVIDER, NEW_KEY);
    releaseFirstRequest.resolve();
    await within(secondRequestEntered.promise, "the parent-registered provider was unavailable during reload handoff");
  } }), "reload did not complete while the child provider request was active");

  await within(childFinished.promise, "the child did not finish after reload");
  await within(governorResumed.promise, "the child completion did not resume the reloaded governor");
  await within(session.waitForIdle(), "the reloaded governor did not become idle");
  assert.deepEqual(childRequests, [
    { authorization: `Bearer ${OLD_KEY}`, hasToolResult: false },
    { authorization: `Bearer ${NEW_KEY}`, hasToolResult: true },
  ]);
  assert.equal(governorRequests, 3, "the surviving child completion must resume the reloaded governor once");
  const journal = readFileSync(join(dir, "subagents", session.sessionManager.getSessionId(), "journal.log"), "utf8");
  const spawned = journal.split("\n").filter(Boolean).map((line) => JSON.parse(line.slice(line.indexOf(" ", line.indexOf(" ") + 1) + 1)) as { kind: string; body: unknown }).filter((record) => record.kind === "agent.spawned");
  assert.equal(spawned.length, 1, `reload must not replace the child identity: ${JSON.stringify(spawned)}`);
  assert.match(journal, /\"kind\":\"task.terminal\".*\"outcome\":\"succeeded\"/);
  assert.deepEqual(errors, []);
});
