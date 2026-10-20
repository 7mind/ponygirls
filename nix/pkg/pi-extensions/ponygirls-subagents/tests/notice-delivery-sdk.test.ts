import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  type AgentSession, type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { NoticeDelivery } from "../src/notice-delivery.ts";

// Explicit triggerTurn:false compatibility tests, not the extension's actionable-notice policy.
const CUSTOM_NOTICE = "pi-subagents-notice";
const NOTICE_DELIVERY_TIMEOUT_MS = 5_000;
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function observeNotice(t: TestContext, session: AgentSession): Promise<void> {
  const delivered = Promise.withResolvers<void>();
  const timer = setTimeout(() => delivered.reject(new Error("SDK context notice was not delivered")), NOTICE_DELIVERY_TIMEOUT_MS);
  t.after(() => clearTimeout(timer));
  t.after(session.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "custom" && event.message.customType === CUSTOM_NOTICE) delivered.resolve();
  }));
  return delivered.promise;
}

/** Real Pi message sink, with a controlled journal and credential-free provider. */
async function fixture(t: TestContext, persistent: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "subagents-notice-sdk-"));
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  let requests = 0;
  let callHold = false;
  let providerError: string | null = null;
  modelRuntime.registerProvider("notice-fixture", {
    api: "openai-completions", baseUrl: "http://fixture.invalid", apiKey: "fixture-only",
    models: [{ id: "scripted", name: "Scripted", reasoning: false, input: ["text"], contextWindow: 100_000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model) {
      requests++;
      const content = callHold ? [{ type: "toolCall" as const, id: "hold-call", name: "hold", arguments: {} }] : [{ type: "text" as const, text: "root response" }];
      callHold = false;
      const stream = createAssistantMessageEventStream();
      if (providerError !== null) {
        const errorMessage = providerError;
        providerError = null;
        stream.push({ type: "error", reason: "error", error: {
          role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: "error", errorMessage, timestamp: Date.now(),
        } });
        return stream;
      }
      stream.push({ type: "done", reason: content[0]!.type === "toolCall" ? "toolUse" : "stop", message: {
        role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: content[0]!.type === "toolCall" ? "toolUse" : "stop", timestamp: Date.now(),
      } });
      return stream;
    },
  });
  let api!: ExtensionAPI;
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const holdEntered = new Promise<void>((resolve) => { entered = resolve; });
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir, agentDir: dir, settingsManager,
    noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [(pi) => {
      api = pi;
      pi.registerTool({
        name: "hold", label: "hold", description: "Controlled tool boundary", parameters: Type.Object({}),
        async execute(_id, _params, signal) {
          entered();
          signal?.addEventListener("abort", release, { once: true });
          await held;
          return { content: [{ type: "text", text: "tool result" }], details: undefined };
        },
      });
    }],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const model = modelRuntime.getModel("notice-fixture", "scripted");
  assert.ok(model);
  const { session } = await createAgentSession({
    cwd: dir, agentDir: dir, settingsManager, modelRuntime, resourceLoader, model, thinkingLevel: "off", tools: ["hold"],
    sessionManager: persistent ? SessionManager.create(dir, join(dir, "sessions")) : SessionManager.inMemory(dir),
  });
  const errors: unknown[] = [];
  await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error) });
  const lines: string[] = [];
  const delivery = new NoticeDelivery({ noticesSince: (cursor, limit) => ({ lines: lines.slice(cursor, cursor + limit), cursor: Math.min(lines.length, cursor + limit) }) }, {
    submit: (message) => api.sendMessage(message, { triggerTurn: false }),
    error: (error) => errors.push(error),
  }, 0);
  t.after(async () => {
    delivery.dispose();
    release();
    try { await session.abort(); } finally {
      session.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  await session.prompt("prime the session");
  return {
    api, session, errors, holdEntered, settingsManager,
    requests: () => requests,
    fail: (error: string) => { providerError = error; },
    hold: () => { callHold = true; },
    release,
    publish(text: string) { lines.push(text); delivery.changed(); },
    notices: () => session.sessionManager.getEntries().filter((e) => e.type === "custom_message" && e.customType === CUSTOM_NOTICE),
  };
}

for (const persistent of [true, false]) {
  test(`Pi ${persistent ? "file" : "memory"} sink displays all idle pages without input or inference`, async (t) => {
    const f = await fixture(t, persistent);
    for (let i = 0; i < 47; i++) f.publish(`idle notice ${i}`);
    await tick();
    assert.equal(f.notices().length, 3);
    assert.equal(f.requests(), 1);
    assert.ok(f.session.isIdle);
    if (persistent) {
      const file = f.session.sessionManager.getSessionFile();
      assert.ok(file);
      assert.match(readFileSync(file, "utf8"), /idle notice 46/);
    }
    await f.session.prompt("next explicit request");
    assert.equal(f.notices().length, 3, "later input must not replay notices");
    assert.equal(f.requests(), 2);
    assert.deepEqual(f.errors, []);
  });
}

const boundaries: Array<{ name: string; register(api: ExtensionAPI, handler: () => void): void }> = [
  { name: "before_agent_start", register: (api, handler) => { api.on("before_agent_start", handler); } },
  { name: "message_end", register: (api, handler) => { api.on("message_end", (event) => { if (event.message.role === "assistant") handler(); }); } },
  { name: "turn_end", register: (api, handler) => { api.on("turn_end", handler); } },
  { name: "agent_end", register: (api, handler) => { api.on("agent_end", handler); } },
  { name: "agent_before_settle", register: (api, handler) => { api.on("agent_before_settle", handler); } },
  { name: "agent_settled", register: (api, handler) => { api.on("agent_settled", handler); } },
];

for (const boundary of boundaries) {
  test(`Pi sink delivers a notice published at ${boundary.name} without another root run`, async (t) => {
    const f = await fixture(t, true);
    const delivered = observeNotice(t, f.session);
    boundary.register(f.api, () => { f.publish(`notice at ${boundary.name}`); });
    await f.session.prompt("exercise boundary");
    await delivered;
    assert.equal(f.notices().length, 1);
    assert.equal(f.requests(), 2);
    assert.ok(f.session.isIdle);
    assert.deepEqual(f.errors, []);
  });
}

test("Pi sink preserves assistant-tool/result ordering and does not request a continuation", async (t) => {
  const f = await fixture(t, true);
  f.hold();
  const run = f.session.prompt("hold a tool");
  await f.holdEntered;
  f.publish("arrived during tool execution");
  await tick();
  assert.equal(f.notices().length, 0, "notice must wait for the complete tool boundary");
  f.release();
  await run;
  await tick();
  assert.equal(f.notices().length, 1);
  const resultIndex = f.session.messages.findIndex((m) => m.role === "toolResult");
  const noticeIndex = f.session.messages.findIndex((m) => m.role === "custom" && m.customType === CUSTOM_NOTICE);
  assert.ok(resultIndex >= 0 && noticeIndex > resultIndex);
  assert.equal(f.requests(), 3, "only the ordinary tool follow-up should run");
  assert.deepEqual(f.errors, []);
});

test("Pi sink persists a context notice through clearQueue and abort without later input", async (t) => {
  const f = await fixture(t, true);
  f.hold();
  const run = f.session.prompt("hold then abort");
  await f.holdEntered;
  f.publish("arrived before abort");
  await tick();
  f.session.clearQueue();
  await f.session.abort();
  await run;
  await tick();
  assert.equal(f.notices().length, 1);
  assert.equal(f.requests(), 2);
  assert.deepEqual(f.errors, []);
});

test("Pi sink drains a notice arriving during retry backoff without another input", async (t) => {
  const f = await fixture(t, true);
  f.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } });
  let retries = 0;
  f.session.subscribe((event) => {
    if (event.type === "auto_retry_start") {
      retries++;
      f.publish("terminal during retry");
    }
  });
  f.fail("503 Service Unavailable");
  await f.session.prompt("retry once");
  await tick();
  assert.equal(retries, 1);
  assert.equal(f.notices().length, 1);
  assert.equal(f.requests(), 3, "prime, failed attempt and its retry only");
  assert.ok(f.session.isIdle);
  assert.deepEqual(f.errors, []);
});

for (const automatic of [false, true]) {
  test(`Pi sink drains a notice arriving during ${automatic ? "automatic" : "manual"} compaction`, async (t) => {
    const f = await fixture(t, true);
    let compactions = 0;
    const delivered = observeNotice(t, f.session);
    f.api.on("session_before_compact", async (event) => {
      compactions++;
      f.settingsManager.setCompactionEnabled(false);
      f.publish("terminal during compaction");
      await tick();
      assert.equal(f.notices().length, automatic ? 0 : 1, "preserve legacy context-only compaction timing");
      return { compaction: { summary: "Controlled summary", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore } };
    });
    if (automatic) {
      f.hold();
      const run = f.session.prompt("compact between tool turns");
      await f.holdEntered;
      f.settingsManager.applyOverrides({ compaction: { enabled: true, reserveTokens: 99_999, keepRecentTokens: 1 } });
      f.release();
      await run;
    } else {
      f.settingsManager.applyOverrides({ compaction: { enabled: false, keepRecentTokens: 1 } });
      await f.session.compact();
    }
    await tick();
    await delivered;
    assert.equal(compactions, 1);
    assert.equal(f.notices().length, 1);
    assert.equal(f.requests(), automatic ? 3 : 1, "compaction notices must not start another root request");
    assert.ok(f.session.isIdle);
    assert.deepEqual(f.errors, []);
  });
}
