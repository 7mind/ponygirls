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
const extensionPath = resolve(import.meta.dirname, "../index.ts");
const ask = { type: "toolCall", id: "ask-1", name: "decisions", arguments: { action: "ask", question: "Which storage?", context: "Concurrent Pi sessions", options: ["SQLite", "JSONL"], recommendation: "SQLite, for atomic IDs" } };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

async function fixture(t, replies) {
  const dir = mkdtempSync(join(tmpdir(), "decisions-host-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager, additionalExtensionPaths: [extensionPath],
    noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true });
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
  const manager = sdk.SessionManager.create(dir, dir);
  const { session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime,
    model: runtime.getModel("decisions-fixture", "scripted"), thinkingLevel: "off", settingsManager, resourceLoader: loader,
    sessionManager: manager, tools: ["decisions"] });
  const errors = [];
  await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error) });
  session.setActiveToolsByName(["decisions"]);
  t.after(async () => {
    await session.abort(); session.dispose();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, session, manager, errors, calls: () => calls, contexts, release: () => { assert.ok(release); release(); } };
}

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
