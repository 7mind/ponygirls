import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, readFileSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  type ExtensionAPI, type ExtensionError,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { NoticeDelivery } from "../src/notice-delivery.ts";

const CUSTOM_NOTICE = "pi-subagents-notice";
const DEADLINE_MS = 5_000;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

async function until(check: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + DEADLINE_MS;
  while (!check()) {
    assert.ok(Date.now() < deadline, description);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(t: TestContext, persistent: boolean, binding: "empty" | "mode" | "errors", triggerTurn: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "sdk-notice-retention-"));
  const errors: ExtensionError[] = [];
  const lifecycle: string[] = [];
  const contexts: string[] = [];
  const api: { current: ExtensionAPI | null } = { current: null };
  const entered = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  let requestHold = false;
  let generation = 0;
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerProvider("retention-fixture", {
    api: "openai-completions", baseUrl: "http://fixture.invalid", apiKey: "fixture-only",
    models: [{ id: "scripted", name: "Scripted", reasoning: false, input: ["text"], contextWindow: 100_000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple(model, context) {
      contexts.push(JSON.stringify(context.messages));
      const content = requestHold ? [{ type: "toolCall" as const, id: "hold", name: "hold", arguments: {} }] : [{ type: "text" as const, text: "finished" }];
      requestHold = false;
      const reason = content[0]!.type === "toolCall" ? "toolUse" as const : "stop" as const;
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason, message: {
        role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: reason, timestamp: Date.now(),
      } });
      return stream;
    },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir, agentDir: dir, settingsManager,
    noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    extensionFactories: [(pi) => {
      api.current = pi;
      const currentGeneration = ++generation;
      pi.on("session_start", () => { lifecycle.push(`start:${currentGeneration}`); });
      pi.on("session_shutdown", () => { lifecycle.push(`shutdown:${currentGeneration}`); });
      pi.registerTool({
        name: "hold", label: "hold", description: "Controlled boundary", parameters: Type.Object({}),
        async execute(_id, _args, signal) {
          assert.ok(signal);
          signal.addEventListener("abort", () => held.resolve(), { once: true });
          entered.resolve();
          await held.promise;
          return { content: [{ type: "text", text: "result" }], details: undefined };
        },
      });
    }],
  });
  await resourceLoader.reload();
  assert.deepEqual(resourceLoader.getExtensions().errors, []);
  const model = modelRuntime.getModel("retention-fixture", "scripted");
  assert.ok(model);
  const { session } = await createAgentSession({ cwd: dir, agentDir: dir, settingsManager, modelRuntime, resourceLoader,
    model, thinkingLevel: "off", tools: ["hold"], sessionManager: persistent ? SessionManager.create(dir, join(dir, "sessions")) : SessionManager.inMemory(dir) });
  await session.bindExtensions(binding === "empty" ? {} : binding === "mode" ? { mode: "rpc" } : { mode: "rpc", onError: (error) => errors.push(error) });
  const lines: string[] = [];
  const sinkErrors: unknown[] = [];
  const currentApi = (): ExtensionAPI => { assert.ok(api.current); return api.current; };
  const delivery = new NoticeDelivery({ noticesSince: (cursor, limit) => ({ lines: lines.slice(cursor, cursor + limit), cursor: Math.min(lines.length, cursor + limit) }) }, {
    submit: (message) => currentApi().enqueueMessage(message, { triggerTurn, deliverAs: "steer" }), error: (error) => sinkErrors.push(error),
  }, 0);
  t.after(() => { delivery.dispose(); held.resolve(); session.dispose(); rmSync(dir, { recursive: true, force: true }); });
  await session.prompt("prime");
  return {
    session, currentApi, lifecycle, errors, sinkErrors, entered, held, contexts,
    hold() { requestHold = true; },
    publish(text: string) { lines.push(text); delivery.changed(); },
    notices() { return session.sessionManager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === CUSTOM_NOTICE); },
    failAppend(count: number) {
      const original = session.sessionManager.appendCustomMessageEntry.bind(session.sessionManager);
      let remaining = count;
      session.sessionManager.appendCustomMessageEntry = (...args) => {
        if (remaining > 0 && args[0] === CUSTOM_NOTICE) { remaining--; throw new Error("one-shot custom append rejection"); }
        return original(...args);
      };
      return () => { session.sessionManager.appendCustomMessageEntry = original; };
    },
  };
}

for (const triggerTurn of [false, true]) {
  test(`SDK idle append rejection recovers without producer activity, triggerTurn=${triggerTurn}`, { timeout: 10_000 }, async (t) => {
    const f = await fixture(t, false, "errors", triggerTurn);
    f.failAppend(1);
    f.publish("idle terminal");
    await until(() => f.notices().length === 1 && f.session.isIdle && f.contexts.length === (triggerTurn ? 2 : 1), "idle notice never recovered autonomously");
    assert.equal(f.sinkErrors.length + f.errors.length, 1);
    assert.equal(f.notices().length, 1);
    if (triggerTurn) assert.match(f.contexts[1]!, /idle terminal/);
  });
}

test("SDK retains every page when the first turn-end custom append fails", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", false);
  f.hold();
  const run = f.session.prompt("hold");
  await f.entered.promise;
  for (let i = 0; i < 47; i++) f.publish(`terminal ${i}`);
  await tick();
  f.failAppend(1);
  f.held.resolve();
  await run;
  await until(() => f.notices().length === 3, "queued custom pages were discarded");
  const content = JSON.stringify(f.notices());
  for (let i = 0; i < 47; i++) assert.ok(content.includes(`terminal ${i}`), `missing terminal ${i}`);
  assert.ok(f.session.isIdle);
});

test("SDK final flush rejection cannot strand busy state or later notices", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", false);
  let published = false;
  f.currentApi().on("agent_end", () => { if (!published) { published = true; f.publish("final terminal"); } });
  f.failAppend(1);
  await f.session.prompt("final flush").catch((error: unknown) => { assert.match(String(error), /custom append rejection/); });
  assert.equal(f.session.isStreaming, false, "flush failure must still settle the session");
  f.publish("later terminal");
  await until(() => f.notices().length === 2, "final flush or later notice remains stranded");
  assert.ok(f.session.isIdle);
  assert.equal(f.contexts.length, 2, "context-only compatibility must not request inference");
});

for (const binding of ["empty", "mode", "errors"] as const) {
  test(`SDK reload emits session_start after ${binding} binding`, async (t) => {
    const f = await fixture(t, false, binding, false);
    const staleApi = f.currentApi();
    await f.session.reload();
    assert.deepEqual(f.lifecycle, ["start:1", "shutdown:1", "start:2"]);
    assert.throws(() => staleApi.sendMessage({ customType: CUSTOM_NOTICE, content: "stale", display: true }), /stale/);
    assert.throws(() => staleApi.enqueueMessage({ customType: CUSTOM_NOTICE, content: "stale retained", display: true }, { triggerTurn: true, deliverAs: "steer" }), /stale/);
  });
}

test("busy actionable ingress joins the natural continuation without an extra request", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", true);
  f.hold();
  const run = f.session.prompt("hold");
  await f.entered.promise;
  f.publish("question while busy");
  await tick();
  assert.equal(f.notices().length, 0, "do not split a tool call from its result");
  f.held.resolve();
  await run;
  await until(() => f.notices().length === 1 && f.session.isIdle, "busy notice never reached context");
  await tick();
  assert.equal(f.contexts.length, 3);
  assert.match(f.contexts[2]!, /question while busy/);
});

test("clearQueue plus abort preserves accepted custom context without restarting inference", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", true);
  f.hold();
  const run = f.session.prompt("hold");
  await f.entered.promise;
  f.publish("terminal before abort");
  await tick();
  f.session.clearQueue();
  await f.session.abort();
  await run;
  await until(() => f.notices().length === 1, "clearQueue discarded accepted lifecycle context");
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  assert.equal(f.contexts.length, 2, "do not fight explicit cancellation");
  await f.session.prompt("explicit continuation");
  assert.equal(f.contexts.length, 3);
  assert.match(f.contexts[2]!, /terminal before abort/);
});

test("session storage failure does not publish an unpersisted entry or duplicate it on retry", async (t) => {
  const f = await fixture(t, true, "errors", false);
  const manager = f.session.sessionManager;
  const file = manager.getSessionFile();
  assert.ok(file);
  const before = manager.getEntries().length;
  const leaf = manager.getLeafId();
  const moved = `${file}.saved`;
  renameSync(file, moved);
  // EISDIR is a real filesystem failure, not a mocked append entry method.
  const { mkdirSync, rmdirSync } = await import("node:fs");
  mkdirSync(file);
  try {
    assert.throws(() => manager.appendCustomMessageEntry(CUSTOM_NOTICE, "storage terminal", true), /EISDIR/);
    assert.equal(manager.getEntries().length, before, "failed persistence must not publish native context");
    assert.equal(manager.getLeafId(), leaf, "failed persistence must not advance parent linkage");
  } finally {
    rmdirSync(file);
    renameSync(moved, file);
  }
  manager.appendCustomMessageEntry(CUSTOM_NOTICE, "storage terminal", true);
  assert.equal(f.notices().length, 1);
  const disk = readFileSync(file, "utf8");
  assert.equal(disk.split("storage terminal").length - 1, 1);
  assert.equal(manager.getEntries().length, before + 1);
});

test("a follow-up cannot block later steering at a natural tool continuation", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", true);
  f.hold();
  const run = f.session.prompt("hold");
  await f.entered.promise;
  f.currentApi().enqueueMessage({ customType: CUSTOM_NOTICE, content: "follow-up A", display: true }, { triggerTurn: true, deliverAs: "followUp" });
  f.currentApi().enqueueMessage({ customType: CUSTOM_NOTICE, content: "steering B", display: true }, { triggerTurn: true, deliverAs: "steer" });
  f.held.resolve();
  await run;
  await until(() => f.session.isIdle && f.contexts.length >= 4, "follow-up did not resume");
  assert.match(f.contexts[2]!, /steering B/);
  assert.doesNotMatch(f.contexts[2]!, /follow-up A/);
  assert.match(f.contexts[3]!, /follow-up A/);
  assert.equal(f.notices().length, 2);
});

test("observer and error-reporter exceptions after commit cannot replay an accepted page", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", true);
  let rejectObserver = true;
  f.session.subscribe((event) => {
    if (rejectObserver && event.type === "message_start" && event.message.role === "custom" && event.message.customType === CUSTOM_NOTICE) {
      rejectObserver = false;
      throw new Error("one-shot committed observer rejection");
    }
  });
  f.session.extensionRunner.onError(() => { throw new Error("error reporter rejected"); });
  f.publish("committed terminal");
  await until(() => f.contexts.length >= 2 && f.session.isIdle, "committed notice never resumed");
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  assert.equal(f.notices().length, 1, "an observer error is not a delivery rejection");
  assert.equal(f.contexts.length, 2);
  assert.equal(f.sinkErrors.length, 0);
});

test("later question ingress is not blocked by before_agent_start work", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", true);
  const preparing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  t.after(() => release.resolve());
  f.currentApi().on("before_agent_start", async (event) => {
    if (event.messageType === "custom") { preparing.resolve(); await release.promise; }
  });
  f.publish("first completion");
  await preparing.promise;
  f.publish("question during preparation");
  await tick();
  release.resolve();
  await until(() => f.contexts.length >= 2 && f.session.isIdle, "prepared governor never resumed");
  assert.match(f.contexts[1]!, /first completion/);
  assert.match(f.contexts[1]!, /question during preparation/);
  assert.equal(f.contexts.length, 2, "both accepted notices belong to the first request");
  assert.equal(f.notices().length, 2);
});

test("an actionable notice at agent_settled starts exactly one non-overlapping run", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", true);
  let published = false;
  f.currentApi().on("agent_settled", () => {
    if (!published) {
      published = true;
      f.currentApi().enqueueMessage({ customType: CUSTOM_NOTICE, content: "settlement terminal", display: true }, { triggerTurn: true, deliverAs: "steer" });
    }
  });
  await f.session.prompt("settle");
  await until(() => f.contexts.length === 3 && f.session.isIdle, "settlement notice did not start a new run");
  assert.match(f.contexts[2]!, /settlement terminal/);
  assert.equal(f.notices().length, 1);
  assert.deepEqual(f.errors, []);
});

test("disposal during a committed flush fences the remaining accepted pages", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", false);
  f.hold();
  const run = f.session.prompt("hold");
  await f.entered.promise;
  for (let i = 0; i < 47; i++) f.publish(`terminal ${i}`);
  await tick();
  f.session.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "custom" && event.message.customType === CUSTOM_NOTICE) f.session.dispose();
  });
  f.held.resolve();
  await run;
  assert.equal(f.notices().length, 1, "a disposed session must not continue the old flush");
});

for (const cancel of ["clearQueue", "abort"] as const) {
  test(`reentrant ${cancel} during idle commit cannot be overwritten by a wake intent`, { timeout: 10_000 }, async (t) => {
    const f = await fixture(t, false, "errors", true);
    f.session.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "custom" && event.message.customType === CUSTOM_NOTICE) {
        if (cancel === "clearQueue") f.session.clearQueue();
        else void f.session.abort();
      }
    });
    f.publish("canceled during observer");
    await until(() => f.notices().length === 1, "notice never committed");
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    assert.equal(f.contexts.length, 1, "cancellation must win over the in-progress ingress callback");
    assert.ok(f.session.isIdle);
  });
}

test("close failure rolls back persisted and native state before retry", async (t) => {
  const f = await fixture(t, true, "errors", false);
  const manager = f.session.sessionManager;
  const file = manager.getSessionFile();
  assert.ok(file);
  const before = readFileSync(file, "utf8");
  const count = manager.getEntries().length;
  const original = fs.closeSync;
  let fail = true;
  t.mock.method(fs, "closeSync", (fd: number) => {
    original(fd);
    if (fail) { fail = false; throw new Error("one-shot close rejection after real close"); }
  });
  syncBuiltinESMExports();
  try { assert.throws(() => manager.appendCustomMessageEntry(CUSTOM_NOTICE, "close terminal", true), /close rejection/); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(manager.getEntries().length, count);
  assert.equal(readFileSync(file, "utf8"), before, "failed close must not leave a disk-only entry");
  manager.appendCustomMessageEntry(CUSTOM_NOTICE, "close terminal", true);
  assert.equal(f.notices().length, 1);
  assert.equal(readFileSync(file, "utf8").split("close terminal").length - 1, 1);
});

test("a postcommit projection failure still reaches the waking model request exactly once", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", true);
  const manager = f.session.sessionManager;
  const original = manager.buildSessionProjection.bind(manager);
  let fail = true;
  manager.buildSessionProjection = (...args) => {
    if (fail) { fail = false; throw new Error("one-shot projection rejection"); }
    return original(...args);
  };
  f.publish("projection terminal");
  await until(() => f.contexts.length >= 2 && f.session.isIdle, "projection failure stranded wake intent");
  assert.match(f.contexts[1]!, /projection terminal/);
  assert.equal(f.notices().length, 1);
  assert.equal(f.sinkErrors.length, 0);
  assert.equal(f.errors.length, 1);
});

test("initial session close failure removes only the failed creation and permits retry", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sdk-initial-close-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const manager = SessionManager.create(dir, join(dir, "sessions"));
  const file = manager.getSessionFile();
  assert.ok(file);
  const original = fs.closeSync;
  let fail = true;
  t.mock.method(fs, "closeSync", (fd: number) => {
    original(fd);
    if (fail) { fail = false; throw new Error("initial close rejection after real close"); }
  });
  syncBuiltinESMExports();
  try { assert.throws(() => manager.appendMessage({ role: "user", content: "initial terminal", timestamp: Date.now() }), /close rejection/); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(manager.getEntries().length, 0);
  assert.equal(fs.existsSync(file), false, "failed initial close must not leave an unretryable wx destination");
  manager.appendMessage({ role: "user", content: "initial terminal", timestamp: Date.now() });
  assert.equal(manager.getEntries().length, 1);
  assert.equal(readFileSync(file, "utf8").split("initial terminal").length - 1, 1);
});

test("permanent SDK flush failure reports a bounded retry budget and retains ownership", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", true);
  f.hold();
  const run = f.session.prompt("hold").catch((error: unknown) => { assert.match(String(error), /custom append rejection/); });
  await f.entered.promise;
  const restore = f.failAppend(1_000);
  f.publish("unpersisted terminal");
  await tick();
  f.held.resolve();
  await run;
  await until(() => f.errors.length === 3, "SDK retry exhaustion was not reported");
  await new Promise<void>((resolve) => setTimeout(resolve, 350));
  assert.equal(f.errors.length, 3, "permanent failure must not spin");
  assert.equal(f.notices().length, 0);
  assert.equal(f.sinkErrors.length, 0, "accepted ownership must not be returned to the producer after a later fault");
  assert.ok(f.session.isIdle, "pending storage repair must not strand the active-run flag");
  const previousRequests = f.contexts.length;
  restore();
  f.publish("new question after storage recovery");
  await until(() => f.notices().length === 2 && f.session.isIdle && f.contexts.length > previousRequests, "retained SDK ownership was lost");
  assert.equal(f.contexts.length, previousRequests + 1);
  assert.match(f.contexts.at(-1)!, /unpersisted terminal/);
  assert.match(f.contexts.at(-1)!, /new question after storage recovery/);
});

test("failed disk rollback disables further writes until storage is repaired and reopened", async (t) => {
  const f = await fixture(t, true, "errors", false);
  const manager = f.session.sessionManager;
  const file = manager.getSessionFile();
  assert.ok(file);
  const before = readFileSync(file, "utf8");
  const count = manager.getEntries().length;
  const original = fs.writeFileSync;
  let fail = true;
  t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
    if (fail && typeof args[0] === "number") {
      fail = false;
      original(args[0], "partial JSON suffix");
      throw new Error("one-shot write rejection after partial write");
    }
    return original(...args);
  });
  t.mock.method(fs, "truncateSync", () => { throw new Error("rollback denied"); });
  syncBuiltinESMExports();
  try { assert.throws(() => manager.appendCustomMessageEntry(CUSTOM_NOTICE, "uncertain terminal", true), AggregateError); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  const damaged = readFileSync(file, "utf8");
  assert.match(damaged, /partial JSON suffix$/);
  assert.equal(manager.getEntries().length, count);
  assert.throws(() => manager.appendCustomMessageEntry(CUSTOM_NOTICE, "must not append", true), /writes disabled.*reopen/i);
  assert.equal(readFileSync(file, "utf8"), damaged, "do not append behind an uncertain suffix");
  fs.writeFileSync(file, before);
  const reopened = SessionManager.open(file);
  reopened.appendCustomMessageEntry(CUSTOM_NOTICE, "repaired terminal", true);
  assert.equal(readFileSync(file, "utf8").split("repaired terminal").length - 1, 1);
});

test("steering at assistant stop is consumed before an older follow-up", async (t) => {
  const f = await fixture(t, false, "errors", true);
  let queued = false;
  f.currentApi().on("message_end", (event) => {
    if (queued || event.message.role !== "assistant") return;
    queued = true;
    f.currentApi().enqueueMessage({ customType: CUSTOM_NOTICE, content: "older follow-up", display: true }, { triggerTurn: true, deliverAs: "followUp" });
    f.currentApi().enqueueMessage({ customType: CUSTOM_NOTICE, content: "stop steering", display: true }, { triggerTurn: true, deliverAs: "steer" });
  });
  await f.session.prompt("stop boundary");
  assert.equal(f.contexts.length, 4, "finish steering before admitting follow-up work");
  assert.match(f.contexts[2]!, /stop steering/);
  assert.doesNotMatch(f.contexts[2]!, /older follow-up/);
  assert.match(f.contexts[3]!, /older follow-up/);
});

test("triggerTurn:false ignores follow-up scheduling and joins the safe tool continuation", async (t) => {
  const f = await fixture(t, false, "errors", false);
  f.hold();
  const run = f.session.prompt("hold");
  await f.entered.promise;
  f.currentApi().enqueueMessage({ customType: CUSTOM_NOTICE, content: "context-only follow-up option", display: true }, { triggerTurn: false, deliverAs: "followUp" });
  f.held.resolve();
  await run;
  assert.equal(f.contexts.length, 3);
  assert.match(f.contexts[2]!, /context-only follow-up option/);
});

test("idle recovery cannot spin behind a retained low-level queue after startup failure", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", true);
  let queued = false;
  f.currentApi().on("before_agent_start", () => {
    if (queued) return;
    queued = true;
    f.currentApi().enqueueMessage({ customType: CUSTOM_NOTICE, content: "retained follow-up after startup failure", display: true }, { triggerTurn: true, deliverAs: "followUp" });
    f.session.agent.followUp({ role: "user", content: [{ type: "text", text: "retained raw follow-up" }], timestamp: Date.now() });
  });
  const original = f.session.agent.prompt;
  f.session.agent.prompt = async () => { throw new Error("one-shot low-level startup rejection"); };
  try { await assert.rejects(f.session.prompt("startup failure"), /startup rejection/); }
  finally { f.session.agent.prompt = original; }
  await until(() => f.notices().length === 1 && f.session.isIdle && f.contexts.length >= 2, "idle drain is blocked behind the low-level queue");
  assert.match(f.contexts[1]!, /retained follow-up after startup failure/);
  assert.match(f.contexts.at(-1)!, /retained raw follow-up/);
});

test("legacy sendMessage preserves custom-message transformation hooks", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t, false, "errors", true);
  f.currentApi().on("message_end", (event) => {
    if (event.message.role === "custom" && event.message.customType === CUSTOM_NOTICE) {
      return { message: { ...event.message, content: "filtered terminal" } };
    }
    return undefined;
  });
  f.currentApi().sendMessage({ customType: CUSTOM_NOTICE, content: "unfiltered terminal", display: true }, { triggerTurn: true });
  await until(() => f.contexts.length >= 2 && f.session.isIdle, "custom-message turn never started");
  assert.match(f.contexts[1]!, /filtered terminal/);
  assert.doesNotMatch(f.contexts[1]!, /unfiltered terminal/);
});

test("a preparation rejection releases busy state without a premature successful settlement event", async (t) => {
  const f = await fixture(t, false, "errors", true);
  const settings = f.session.settingsManager;
  const original = settings.getCompactionSettings.bind(settings);
  let nativeStarts = 0;
  let settlements = 0;
  f.session.subscribe((event) => { if (event.type === "agent_start") nativeStarts++; });
  f.currentApi().on("agent_settled", () => { settlements++; });
  settings.getCompactionSettings = (...args) => {
    if (f.session.isStreaming) {
      settings.getCompactionSettings = original;
      throw new Error("one-shot preparation rejection");
    }
    return original(...args);
  };
  await assert.rejects(f.session.prompt("reject preparation"), /preparation rejection/);
  assert.equal(nativeStarts, 0, "the failure must precede the low-level run");
  assert.equal(settlements, 0, "worker completion consumers must receive the prompt rejection, not early success");
  assert.ok(f.session.isIdle);
});

test("retained ingress rejects unsupported deferred-next-turn delivery before accepting ownership", async (t) => {
  const f = await fixture(t, false, "errors", true);
  const unsupported = { triggerTurn: true, deliverAs: "nextTurn" } as unknown as Parameters<ExtensionAPI["enqueueMessage"]>[1];
  assert.throws(() => f.currentApi().enqueueMessage({ customType: CUSTOM_NOTICE, content: "must not accept", display: true }, unsupported), /Invalid retained message options/);
  assert.equal(f.notices().length, 0);
  assert.equal(f.contexts.length, 1);
});

for (const automatic of [false, true]) {
  test(`retained actionable ingress joins the next request after ${automatic ? "automatic" : "manual"} compaction`, { timeout: 10_000 }, async (t) => {
    const f = await fixture(t, false, "errors", true);
    let beforeCompaction = -1;
    f.currentApi().on("session_before_compact", async (event) => {
      beforeCompaction = f.contexts.length;
      f.session.settingsManager.setCompactionEnabled(false);
      f.publish("retained terminal during compaction");
      await tick();
      assert.equal(f.notices().length, 0, "retain context outside an in-flight compaction snapshot");
      return { compaction: { summary: "Controlled summary", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore } };
    });
    if (automatic) {
      f.hold();
      const run = f.session.prompt("hold before compaction");
      await f.entered.promise;
      f.session.settingsManager.applyOverrides({ compaction: { enabled: true, reserveTokens: 99_999, keepRecentTokens: 1 } });
      f.held.resolve();
      await run;
    } else {
      f.session.settingsManager.applyOverrides({ compaction: { enabled: false, keepRecentTokens: 1 } });
      await f.session.compact();
    }
    assert.ok(beforeCompaction >= 0, "the compaction path must actually execute");
    await until(() => f.notices().length === 1 && f.contexts.length > beforeCompaction && f.session.isIdle, "compaction notice did not autonomously resume");
    assert.match(f.contexts[beforeCompaction]!, /retained terminal during compaction/);
    assert.deepEqual(f.errors, []);
  });
}
