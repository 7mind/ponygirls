import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, initTheme, ModelRuntime, SessionManager, SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import subagents from "../index.ts";

const CUSTOM_NOTICE = "pi-subagents-notice";
const NOTICE_DELIVERY_TIMEOUT_MS = 5_000;

interface NoticeEvent {
  display: boolean;
  text: string;
}

// Regression #25: release a successful real child only after the parent settles;
// neither a startup failure nor polling list_agents establishes idle delivery.
for (const persistent of [true, false]) {
  test(`real ${persistent ? "parent-registered" : "file-configured"} child completion autonomously resumes an idle ${persistent ? "file" : "memory"} governor without input or polling`, { timeout: 20_000 }, async (t) => {
    if (!process.env["PI_SUBAGENTS_SDK_ROOT"]) {
      t.skip("PI_SUBAGENTS_SDK_ROOT is required for the real worker");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "subagents-notice-extension-"));
    const originalAgentDir = process.env["PI_CODING_AGENT_DIR"];
    process.env["PI_CODING_AGENT_DIR"] = dir;
    initTheme("dark", false);
    const childEntered = Promise.withResolvers<void>();
    const releaseChild = Promise.withResolvers<void>();
    const noticeDelivered = Promise.withResolvers<void>();
    const governorResumed = Promise.withResolvers<void>();
    const wakeContexts: string[] = [];
    const errors: unknown[] = [];
    let session: AgentSession | null = null;
    const server = createServer(async (req, res) => {
      for await (const _chunk of req) { /* consume the request before responding */ }
      childEntered.resolve();
      await releaseChild.promise;
      const chunks = [
        { choices: [{ index: 0, delta: { role: "assistant", content: "child finished" }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      ];
      const body = chunks.map((chunk) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "scripted", ...chunk })}\n\n`).join("") + "data: [DONE]\n\n";
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(body);
    });
    t.after(async () => {
      releaseChild.resolve();
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
    const provider = {
      api: "openai-completions" as const, baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "fixture-only",
      models: [{ id: "scripted", name: "Scripted", reasoning: false, input: ["text" as const], contextWindow: 100_000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    };
    if (!persistent) writeFileSync(join(dir, "models.json"), JSON.stringify({ providers: { "notice-fixture": provider } }));
    writeFileSync(join(dir, "subagents-policy.json"), JSON.stringify({ allowedModels: [{ provider: "notice-fixture", id: "scripted" }] }));
    const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: join(dir, "models.json"), refreshOnCreate: false });
    if (persistent) modelRuntime.registerProvider("notice-fixture", provider);
    let requests = 0;
    modelRuntime.registerProvider("notice-governor", {
      ...provider,
      streamSimple(model, context) {
        requests++;
        if (requests === 3) {
          wakeContexts.push(JSON.stringify(context.messages));
          governorResumed.resolve();
        }
        const content = requests === 1
          ? [{ type: "toolCall" as const, id: "spawn-child", name: "spawn_agent", arguments: { task_name: "idle-child", message: "finish when released", profile: "reader", isolation: "none", model: { provider: "notice-fixture", id: "scripted" } } }]
          : [{ type: "text" as const, text: "parent finished" }];
        const reason = requests === 1 ? "toolUse" : "stop";
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason, message: {
          role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: reason, timestamp: Date.now(),
        } });
        return stream;
      },
    });
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
    const inputs: string[] = [];
    const resourceLoader = new DefaultResourceLoader({
      cwd: dir, agentDir: dir, settingsManager,
      noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
      extensionFactories: [subagents, (pi) => { pi.on("input", (event) => { inputs.push(event.text); }); }],
    });
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    const model = modelRuntime.getModel("notice-governor", "scripted");
    assert.ok(model);
    ({ session } = await createAgentSession({
      cwd: dir, agentDir: dir, modelRuntime, model, settingsManager, resourceLoader, thinkingLevel: "off", tools: ["spawn_agent"],
      sessionManager: persistent ? SessionManager.create(dir, join(dir, "sessions")) : SessionManager.inMemory(dir),
    }));
    await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error) });
    const displayed: NoticeEvent[] = [];
    session.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "custom" && event.message.customType === CUSTOM_NOTICE) {
        displayed.push({ display: event.message.display, text: JSON.stringify(event.message.content) });
        noticeDelivered.resolve();
      }
    });
    await session.prompt("start child");
    await childEntered.promise;
    assert.ok(session.isIdle);
    assert.equal(requests, 2);
    assert.equal(displayed.length, 0);
    releaseChild.resolve();
    const timer = setTimeout(() => noticeDelivered.reject(new Error("successful child completion was not delivered while the parent was idle")), NOTICE_DELIVERY_TIMEOUT_MS);
    try {
      await noticeDelivered.promise;
    } catch (error) {
      const journal = readFileSync(join(dir, "subagents", session.sessionManager.getSessionId(), "journal.log"), "utf8");
      assert.match(journal, /"kind":"task.terminal".*"outcome":"succeeded"/, "the child must actually complete before asserting notice failure");
      throw error;
    } finally {
      clearTimeout(timer);
    }
    assert.equal(displayed.length, 1);
    assert.equal(displayed[0]!.display, true);
    assert.match(displayed[0]!.text, /\/root\/idle-child task .* ended succeeded/);
    const wakeTimer = setTimeout(() => governorResumed.reject(new Error("completion reached context but did not resume the governor")), NOTICE_DELIVERY_TIMEOUT_MS);
    try { await governorResumed.promise; }
    finally { clearTimeout(wakeTimer); }
    await session.waitForIdle();
    assert.equal(requests, 3, "one automatic turn must process the child's completion");
    assert.match(wakeContexts[0]!, /ended succeeded/);
    assert.ok(session.isIdle);
    assert.deepEqual(inputs, ["start child"], "no status prompt or polling may drive delivery");
    const notices = session.sessionManager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === CUSTOM_NOTICE);
    assert.equal(notices.length, 1);
    if (persistent) {
      const file = session.sessionManager.getSessionFile();
      assert.ok(file);
      assert.match(readFileSync(file, "utf8"), /ended succeeded/);
    }
    assert.deepEqual(errors, []);
  });
}
