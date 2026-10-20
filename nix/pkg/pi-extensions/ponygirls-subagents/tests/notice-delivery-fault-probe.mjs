// Historical probe for the original unpatched Pi 1.2.0. Assertions confirm
// defective observations, not delivery correctness; do not run against patched Pi.
// Active positive regressions live in sdk-message-retention.test.ts.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const sdkRoot = process.env.PI_SUBAGENTS_SDK_ROOT;
assert.ok(sdkRoot, "PI_SUBAGENTS_SDK_ROOT is required");
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
const { createAssistantMessageEventStream } = await import(pathToFileURL(join(sdkRoot, "node_modules/@earendil-works/pi-ai/dist/index.js")).href);
const { Type } = await import(pathToFileURL(join(sdkRoot, "node_modules/typebox/build/index.mjs")).href);
const { NoticeDelivery } = await import("../src/notice-delivery.ts");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const customType = "pi-subagents-notice";

async function fixture(reportErrors) {
  const dir = mkdtempSync(join(tmpdir(), "notice-fault-audit-"));
  const errors = [];
  const lifecycle = [];
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  let requests = 0;
  let callHold = false;
  const entered = Promise.withResolvers();
  const held = Promise.withResolvers();
  modelRuntime.registerProvider("audit-fixture", {
    api: "openai-completions", baseUrl: "http://fixture.invalid", apiKey: "fixture-only",
    models: [{ id: "scripted", name: "Scripted", reasoning: false, input: ["text"], contextWindow: 100_000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model) {
      requests++;
      const content = callHold ? [{ type: "toolCall", id: "hold", name: "hold", arguments: {} }] : [{ type: "text", text: "finished" }];
      callHold = false;
      const reason = content[0].type === "toolCall" ? "toolUse" : "stop";
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason, message: {
        role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: reason, timestamp: Date.now(),
      } });
      return stream;
    },
  });
  const api = { current: null };
  let generation = 0;
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir, agentDir: dir, settingsManager,
    noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [(pi) => {
      const currentGeneration = ++generation;
      api.current = pi;
      pi.on("session_start", () => { lifecycle.push(`start:${currentGeneration}`); });
      pi.on("session_shutdown", () => { lifecycle.push(`shutdown:${currentGeneration}`); });
      pi.registerTool({
        name: "hold", label: "hold", description: "Controlled boundary", parameters: Type.Object({}),
        async execute() { entered.resolve(); await held.promise; return { content: [{ type: "text", text: "result" }], details: undefined }; },
      });
    }],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, settingsManager, modelRuntime, resourceLoader,
    model: modelRuntime.getModel("audit-fixture", "scripted"), thinkingLevel: "off", tools: ["hold"], sessionManager: SessionManager.inMemory(dir) });
  await session.bindExtensions(reportErrors ? { mode: "rpc", onError: (error) => errors.push(error) } : { mode: "rpc" });
  const lines = [];
  const sinkErrors = [];
  const delivery = new NoticeDelivery({ noticesSince: (cursor, limit) => ({ lines: lines.slice(cursor, cursor + limit), cursor: Math.min(lines.length, cursor + limit) }) }, {
    submit: (message) => api.current.sendMessage(message, { triggerTurn: false }), error: (error) => sinkErrors.push(error),
  }, 0);
  await session.prompt("prime");
  return {
    session, api, lifecycle, errors, sinkErrors, entered,
    requests: () => requests,
    publish(text) { lines.push(text); delivery.changed(); },
    changed() { delivery.changed(); },
    hold() { callHold = true; }, release() { held.resolve(); },
    notices() { return session.sessionManager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === customType); },
    failNextAppend() {
      const original = session.sessionManager.appendCustomMessageEntry.bind(session.sessionManager);
      let fail = true;
      session.sessionManager.appendCustomMessageEntry = (...args) => {
        if (fail && args[0] === customType) { fail = false; throw new Error("audit one-shot custom append rejection"); }
        return original(...args);
      };
    },
    cleanup() { delivery.dispose(); held.resolve(); session.dispose(); rmSync(dir, { recursive: true, force: true }); },
  };
}

const idle = await fixture(true);
try {
  idle.failNextAppend();
  idle.publish("terminal notice rejected before append");
  await tick();
  idle.changed();
  await tick();
  const result = { probe: "idle-append-failure", notices: idle.notices().length, sinkErrors: idle.sinkErrors.length, sdkErrors: idle.errors.map((error) => error.event), requests: idle.requests(), isIdle: idle.session.isIdle };
  console.log(JSON.stringify(result));
  assert.equal(result.notices, 0);
  assert.equal(result.sinkErrors, 0);
  assert.deepEqual(result.sdkErrors, ["send_message"]);
} finally { idle.cleanup(); }

const pending = await fixture(true);
try {
  pending.hold();
  const run = pending.session.prompt("hold").then(() => null, (error) => String(error));
  await pending.entered.promise;
  for (let i = 0; i < 47; i++) pending.publish(`terminal ${i}`);
  await tick();
  pending.failNextAppend();
  pending.release();
  const runError = await run;
  await tick();
  pending.changed();
  await tick();
  console.log(JSON.stringify({ probe: "turn-end-flush-failure", notices: pending.notices().length, sinkErrors: pending.sinkErrors.length, sdkErrors: pending.errors.map((error) => error.event), runError, isIdle: pending.session.isIdle }));
  assert.equal(pending.notices().length, 0);
} finally { pending.cleanup(); }

const finalFlush = await fixture(true);
try {
  let published = false;
  finalFlush.api.current.on("agent_end", () => { if (!published) { published = true; finalFlush.publish("terminal queued at agent_end"); } });
  finalFlush.failNextAppend();
  const runError = await finalFlush.session.prompt("final flush").then(() => null, (error) => String(error));
  await tick();
  finalFlush.publish("later terminal");
  await tick();
  const result = { probe: "final-flush-failure", notices: finalFlush.notices().length, runError, isIdle: finalFlush.session.isIdle, sessionStreaming: finalFlush.session.isStreaming, agentStreaming: finalFlush.session.agent.state.isStreaming };
  console.log(JSON.stringify(result));
  assert.equal(result.sessionStreaming, true);
  assert.equal(result.agentStreaming, false);
  assert.equal(result.notices, 0);
} finally { finalFlush.cleanup(); }

for (const reportErrors of [false, true]) {
  const reload = await fixture(reportErrors);
  try {
    await reload.session.reload();
    console.log(JSON.stringify({ probe: "reload-session-start", onErrorBound: reportErrors, lifecycle: reload.lifecycle }));
    assert.deepEqual(reload.lifecycle, reportErrors ? ["start:1", "shutdown:1", "start:2"] : ["start:1", "shutdown:1"]);
  } finally { reload.cleanup(); }
}
