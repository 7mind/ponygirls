import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SqliteDecisionStore } from "../src/store.ts";

const root = process.env.PI_DECISIONS_SDK_ROOT;
assert.ok(root, "PI_DECISIONS_SDK_ROOT must point to pinned pi-monorepo; host tests may not silently skip");
const sdk = await import(pathToFileURL(join(root, "dist/index.js")));
const { createAssistantMessageEventStream } = await import(pathToFileURL(join(root, "node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js")));
const { Type } = await import(pathToFileURL(join(root, "node_modules/typebox/build/index.mjs")));
const extensionPath = resolve(import.meta.dirname, "../index.ts");
const ask = { type: "toolCall", id: "ask-1", name: "decisions", arguments: { action: "ask", question: "Which storage?", context: "Concurrent Pi sessions", options: ["SQLite", "JSONL"], recommendation: "SQLite, for atomic IDs" } };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

const hold = { type: "toolCall", id: "hold-1", name: "hold", arguments: {} };

// `hold` blocks until released; `inputDelayMs` models an asynchronous input handler of another extension.
async function fixture(t, replies, { dir = mkdtempSync(join(tmpdir(), "decisions-host-")), sessionFile, inputDelayMs = 0 } = {}) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const holds = [];
  const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager, additionalExtensionPaths: [extensionPath],
    noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true,
    extensionFactories: [(pi) => {
      if (inputDelayMs > 0) pi.on("input", async () => { await new Promise((r) => setTimeout(r, inputDelayMs)); });
      pi.registerTool({ name: "hold", label: "Hold", description: "Blocks until the test releases it", parameters: Type.Object({}),
        async execute() {
          const held = Promise.withResolvers();
          holds.push(held);
          await held.promise;
          return { content: [{ type: "text", text: "held work finished" }], details: undefined };
        } });
    }] });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  let calls = 0;
  let release = null;
  const contexts = [];
  runtime.registerProvider("decisions-fixture", { baseUrl: "http://fixture.invalid", apiKey: "fixture-only", api: "openai-completions",
    models: [{ id: "scripted", name: "Scripted", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      contexts.push(JSON.stringify(context));
      const reply = replies[calls++];
      assert.ok(reply, `Unexpected model request #${calls}`);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        const content = typeof reply === "string" ? [{ type: "text", text: reply }] : reply.waitForAbort || reply.waitForRelease ? reply.content : reply;
        const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
          usage: { ...usage }, stopReason: options.signal.aborted ? "aborted" : content.some((p) => p.type === "toolCall") ? "toolUse" : "stop", timestamp: Date.now() };
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: message.stopReason, message }); stream.end();
      };
      if (reply.waitForAbort || reply.waitForRelease) {
        options.signal.addEventListener("abort", finish, { once: true });
        if (reply.waitForRelease) release = finish;
      } else queueMicrotask(finish);
      return stream;
    } });
  const manager = sessionFile === undefined ? sdk.SessionManager.create(dir, dir) : sdk.SessionManager.open(sessionFile, dir);
  const { session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime,
    model: runtime.getModel("decisions-fixture", "scripted"), thinkingLevel: "off", settingsManager, resourceLoader: loader,
    sessionManager: manager, tools: ["decisions", "hold"] });
  const errors = [];
  await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error) });
  session.setActiveToolsByName(["decisions", "hold"]);
  t.after(async () => {
    for (const held of holds) held.resolve();
    await session.abort(); session.dispose();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, session, manager, errors, calls: () => calls, contexts, holds, release: () => { assert.ok(release); release(); } };
}

function answerExternally(dir, answer) {
  const store = new SqliteDecisionStore(join(dir, "decisions", "questions.sqlite"));
  try {
    const q = store.get(dir, "Q1");
    store.resolve(dir, q.id, q.revision, "answered", answer);
  } finally {
    store.close();
  }
}

const providerRoles = (context) => JSON.parse(context).messages.map((m) => m.role);

async function eventually(check, message) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(message);
}

test("real Pi: async ask returns, answer wakes idle agent, receipt survives reload", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, [[ask], "Continuing independent work", "Answer received"]);
  await f.session.prompt("Ask which storage, then continue independent work");
  assert.equal(f.calls(), 2);
  const toolResult = f.manager.getEntries().find((e) => e.type === "message" && e.message.role === "toolResult");
  assert.equal(toolResult.message.details.id, "Q1");
  assert.equal(toolResult.message.details.status, "pending");
  await f.session.prompt("/decisions answer Q1 SQLite with transactions");
  await eventually(() => f.calls() === 3, "answer must wake idle origin");
  await f.session.waitForIdle();
  const receipts = () => f.manager.getEntries().filter((e) => e.type === "custom_message" && e.customType === "decisions-answer");
  assert.equal(receipts().length, 1);
  assert.match(f.contexts[2], /SQLite with transactions/);
  assert.match(readFileSync(f.manager.getSessionFile(), "utf8"), /SQLite with transactions/);
  await f.session.reload();
  await new Promise((r) => setTimeout(r, 1200));
  await f.session.waitForIdle();
  assert.equal(f.calls(), 3, "reload must not re-wake for a persisted answer receipt");
  assert.equal(receipts().length, 1);
  assert.deepEqual(f.errors, []);
});

test("real Pi: cancelling busy work retains the admitted answer without restarting cancelled work", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, [[ask], "Independent work", { waitForAbort: true, content: [] }, "Continue with answer"]);
  await f.session.prompt("Ask the storage question");
  const running = f.session.prompt("Start unrelated slow work");
  await eventually(() => f.calls() === 3, "slow request must start");
  await f.session.prompt("/decisions answer Q1 Keep the accepted answer across cancellation");
  f.session.clearQueue();
  await f.session.abort();
  await running;
  const receipts = f.manager.getEntries().filter((e) => e.type === "custom_message" && e.customType === "decisions-answer");
  assert.equal(receipts.length, 1, "an accepted answer must remain in context after clearQueue/abort");
  assert.equal(f.calls(), 3, "cancellation must clear wake intent, not start another model request");
  await f.session.prompt("Continue now");
  assert.match(f.contexts[3], /Keep the accepted answer across cancellation/);
  assert.deepEqual(f.errors, []);
});

// An answer during the run's final request continues the run. Interactive "dequeue to edit"
// calls clearQueue() without abort, also when nothing is queued; that must not cancel the wake.
for (const dequeue of ["none", "queued input", "nothing queued"]) {
  test(`real Pi: an answer during the final model request continues the run (dequeue: ${dequeue})`, { timeout: 15000 }, async (t) => {
    const f = await fixture(t, [[ask], "Independent work",
      { waitForRelease: true, content: [{ type: "text", text: "Finishing independent work" }] }, "Continuing with the answer"]);
    await f.session.prompt("Ask the storage question");
    const running = f.session.prompt("Start final independent work");
    await eventually(() => f.calls() === 3, "final request must start");
    if (dequeue === "queued input") await f.session.prompt("Queued user text", { streamingBehavior: "followUp" });
    await f.session.prompt("/decisions answer Q1 Answer during the final request");
    if (dequeue !== "none") {
      assert.deepEqual(f.session.clearQueue(), { steering: [], followUp: dequeue === "queued input" ? ["Queued user text"] : [] });
    }
    f.release();
    await running;
    await eventually(() => f.calls() === 4, "the answer must continue the run");
    await f.session.waitForIdle();
    assert.deepEqual(providerRoles(f.contexts[3]).slice(-2), ["assistant", "user"], "the answer follows the final reply");
    assert.match(f.contexts[3], /Answer during the final request/);
    assert.doesNotMatch(f.contexts[3], /Queued user text/, "dequeued input returns to the editor, not to the model");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(f.calls(), 4);
    assert.deepEqual(f.errors, []);
  });
}

test("real Pi: queued answer is revalidated when another session withdraws it before delivery", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, [[ask], "Independent work", { waitForRelease: true, content: [] }, "Decision remains pending", "Withdrawal received"]);
  await f.session.prompt("Ask the storage question");
  const running = f.session.prompt("Start slow independent work");
  await eventually(() => f.calls() === 3, "slow request must start");
  await f.session.prompt("/decisions answer Q1 OLD APPROVAL");
  const store = new SqliteDecisionStore(join(f.dir, "decisions", "questions.sqlite"));
  const q = store.get(f.dir, "Q1");
  store.resolve(f.dir, q.id, q.revision, "pending", null);
  store.close();
  f.release();
  await running;
  await f.session.waitForIdle();
  assert.ok(f.contexts[3]);
  assert.doesNotMatch(f.contexts[3], /User answer: OLD APPROVAL/, "withdrawn queued snapshot must not reach the provider as a current answer");
  assert.match(f.contexts[3], /previous answer has been withdrawn/);
  assert.deepEqual(f.errors, []);
});

test("real Pi: another connection answers while origin remains open; polling delivers full answer", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, [[ask], "Independent work", "External answer received"]);
  await f.session.prompt("Ask the storage question");
  const store = new SqliteDecisionStore(join(f.dir, "decisions", "questions.sqlite"));
  const q = store.list(f.dir)[0];
  assert.ok(q);
  store.resolve(f.dir, q.id, q.revision, "answered", "Use SQLite; retain all answers");
  store.close();
  await eventually(() => f.calls() === 3, "polling must observe answers from other sessions");
  await f.session.waitForIdle();
  assert.match(f.contexts[2], /Use SQLite; retain all answers/);
  assert.deepEqual(f.errors, []);
});

test("real Pi: an answer during tool execution reaches the next request right after the tool result", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, [[ask], "Independent work", [hold], "Saw the answer after the tool result"]);
  await f.session.prompt("Ask the storage question");
  const running = f.session.prompt("Start held independent work");
  await eventually(() => f.holds.length === 1, "held tool must start");
  await f.session.prompt("/decisions answer Q1 Answer during a tool call");
  f.holds[0].resolve();
  await running;
  await f.session.waitForIdle();
  await new Promise((r) => setTimeout(r, 200));
  await f.session.waitForIdle();
  assert.equal(f.calls(), 4, "the answer joins the tool continuation; no separate wake request");
  const branch = f.manager.getBranch();
  for (const [index, entry] of branch.entries()) {
    if (entry.type !== "message" || entry.message.role !== "assistant" || entry.message.stopReason !== "toolUse") continue;
    assert.equal(branch[index + 1]?.message?.role, "toolResult", "nothing may be persisted between a tool call and its result");
  }
  assert.deepEqual(providerRoles(f.contexts[3]).slice(-3), ["assistant", "toolResult", "user"]);
  assert.match(JSON.stringify(JSON.parse(f.contexts[3]).messages.at(-1)), /Answer during a tool call/);
  assert.deepEqual(f.errors, []);
});

test("real Pi: an answer admitted while a prompt is being prepared joins that prompt instead of rejecting it", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, [[ask], "Independent work", { waitForRelease: true, content: [{ type: "text", text: "Prompt answered with the decision" }] }], { inputDelayMs: 300 });
  await f.session.prompt("Ask the storage question");
  const prompt = f.session.prompt("New user request").then(() => "accepted", (error) => `rejected: ${error.message}`);
  await new Promise((r) => setTimeout(r, 50));
  await f.session.prompt("/decisions answer Q1 Answer during preparation");
  // Hold the next request past the prompt's preparation, as a real provider would.
  await eventually(() => f.calls() === 3, "a model request must start");
  await new Promise((r) => setTimeout(r, 400));
  f.release();
  assert.equal(await prompt, "accepted");
  await f.session.waitForIdle();
  await new Promise((r) => setTimeout(r, 200));
  await f.session.waitForIdle();
  assert.equal(f.calls(), 3, "the committed answer joins the user's run; no separate wake request");
  assert.match(f.contexts[2], /Answer during preparation/);
  assert.match(f.contexts[2], /New user request/);
  assert.deepEqual(f.errors, []);
});

test("real Pi: resuming with an undelivered answer folds it into an immediate first prompt", { timeout: 15000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "decisions-host-"));
  const first = await fixture(t, [[ask], "Independent work"], { dir });
  await first.session.prompt("Ask the storage question");
  const sessionFile = first.manager.getSessionFile();
  first.session.dispose();
  answerExternally(dir, "Answered while the session was closed");
  const resumed = await fixture(t, [{ waitForRelease: true, content: [{ type: "text", text: "Resumed with the answer" }] }], { dir, sessionFile, inputDelayMs: 20 });
  const prompt = resumed.session.prompt("Initial request").then(() => "accepted", (error) => `rejected: ${error.message}`);
  await eventually(() => resumed.calls() === 1, "a model request must start");
  await new Promise((r) => setTimeout(r, 100));
  resumed.release();
  assert.equal(await prompt, "accepted");
  await resumed.session.waitForIdle();
  await new Promise((r) => setTimeout(r, 200));
  await resumed.session.waitForIdle();
  assert.equal(resumed.calls(), 1);
  assert.match(resumed.contexts[0], /Answered while the session was closed/);
  assert.match(resumed.contexts[0], /Initial request/);
  assert.deepEqual(resumed.errors, []);
});
