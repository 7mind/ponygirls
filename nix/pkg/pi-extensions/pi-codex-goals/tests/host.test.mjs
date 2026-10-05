import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.PI_GOALS_SDK_ROOT;
assert.ok(root, "Set PI_GOALS_SDK_ROOT to the installed pi-monorepo directory; real-host checks must not silently skip.");
const sdk = await import(pathToFileURL(join(root, "dist/index.js")));
const { createAssistantMessageEventStream } = await import(pathToFileURL(join(root, "node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js")));
const { CustomMessageComponent } = await import(pathToFileURL(join(root, "dist/modes/interactive/components/custom-message.js")));
const { CustomEntryComponent } = await import(pathToFileURL(join(root, "dist/modes/interactive/components/custom-entry.js")));
const { initTheme } = await import(pathToFileURL(join(root, "dist/modes/interactive/theme/theme.js")));
const extensionPath = resolve(import.meta.dirname, "../index.ts");
const usage = { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

async function fixture(t, replies, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "goals-host-"));
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager,
    additionalExtensionPaths: [extensionPath], noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  let calls = 0;
  runtime.registerProvider("goals-fixture", { baseUrl: "http://fixture.invalid", apiKey: "fixture-only", api: "openai-completions",
    models: [{ id: "scripted", name: "Scripted", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 }],
    streamSimple(model, context, streamOptions) {
      const stream = createAssistantMessageEventStream();
      const reply = replies[calls++];
      assert.ok(reply, `Unexpected model request #${calls}`);
      const finish = () => {
        const content = typeof reply === "string" ? [{ type: "text", text: reply }] : Array.isArray(reply) ? reply : reply.content;
        const stopReason = reply.stopReason ?? (content.some((p) => p.type === "toolCall") ? "toolUse" : "stop");
        const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id,
          usage: { ...usage }, stopReason, timestamp: Date.now() };
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: message.stopReason, message });
        stream.end();
      };
      if (reply.waitForAbort === true) {
        assert.ok(streamOptions.signal);
        streamOptions.signal.addEventListener("abort", finish, { once: true });
      } else queueMicrotask(finish);
      return stream;
    } });
  const manager = options.parent === undefined ? sdk.SessionManager.create(dir, dir) : sdk.SessionManager.forkFrom(options.parent, dir, dir);
  const { session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime,
    model: runtime.getModel("goals-fixture", "scripted"), thinkingLevel: "off", settingsManager, resourceLoader: loader,
    sessionManager: manager, tools: ["create_goal", "get_goal", "update_goal"],
    sessionStartEvent: options.parent === undefined ? undefined : { type: "session_start", reason: "fork", previousSessionFile: options.parent } });
  const errors = [];
  await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error) });
  session.setActiveToolsByName(["create_goal", "get_goal", "update_goal"]);
  assert.ok(session.getActiveToolNames().includes("update_goal"), JSON.stringify({ active: session.getActiveToolNames(), extensions: loader.getExtensions().extensions.map((e) => ({ path: e.path, tools: [...e.tools.keys()] })) }));
  t.after(async () => { await session.abort(); session.dispose(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, session, manager, errors, loader, calls: () => calls,
    envelope: () => JSON.parse(readFileSync(`${manager.getSessionFile()}.codex-goals.json`, "utf8")) };
}

const complete = [{ type: "toolCall", id: "complete", name: "update_goal", arguments: { status: "complete" } }];

test("host: slash kickoff and three executions keep full instructions and answers in JSONL/HTML/TUI", async (t) => {
  const f = await fixture(t, ["first progress", "second progress", complete, "final report"]);
  await f.session.prompt("/goal generic host objective");
  await f.session.waitForIdle();
  // Headless command creation persists; explicitly entering the next run is supported.
  if (f.calls() === 0) await f.session.prompt("Start the recorded goal");
  await f.session.waitForIdle();
  assert.equal(f.calls(), 4, JSON.stringify({ state: f.envelope(), errors: f.errors, results: f.manager.getEntries().filter((e) => e.type === "message" && e.message.role === "toolResult") }, null, 2));
  assert.equal(f.envelope().goal.status, "complete");
  assert.equal(f.envelope().goal.tokensUsed, 12);
  const entries = f.manager.getEntries();
  const instructions = entries.filter((e) => e.type === "custom_message" && e.customType === "codex-goal-context");
  assert.equal(instructions.length, 3);
  initTheme("dark");
  for (const e of instructions) {
    assert.equal(e.display, true);
    assert.match(e.content, /generic host objective/);
    const rendered = new CustomMessageComponent({ role: "custom", ...e }).render(160).join("\n");
    assert.match(rendered, /generic host objective/);
    assert.match(rendered, /complete|completion/);
  }
  const raw = readFileSync(f.manager.getSessionFile(), "utf8");
  for (const e of instructions) assert.ok(raw.includes(JSON.stringify(e.content)));
  assert.match(raw, /final report/);
  const html = await f.session.exportToHtml(join(f.dir, "session.html"));
  const exported = readFileSync(html, "utf8");
  const encoded = exported.match(/<script id="session-data" type="application\/json">([A-Za-z0-9+/=]+)<\/script>/);
  assert.ok(encoded, "HTML export must contain embedded session data");
  const exportedData = Buffer.from(encoded[1], "base64").toString("utf8");
  for (const e of instructions) assert.ok(exportedData.includes(JSON.stringify(e.content)));
  assert.deepEqual(f.errors, []);
});

test("host: lifecycle notices render their actual text", async (t) => {
  const f = await fixture(t, []);
  await f.session.prompt("/goal generic objective");
  await f.session.prompt("/goal pause");
  const notice = f.manager.getEntries().find((e) => e.type === "custom" && e.customType === "codex-goal-notice" && e.data.text.includes("paused"));
  assert.ok(notice);
  initTheme("dark");
  const renderer = f.loader.getExtensions().extensions[0].entryRenderers.get("codex-goal-notice");
  const rendered = new CustomEntryComponent(notice, renderer).render(100).join("\n");
  assert.match(rendered, /paused/);
});

test("host: an unresolved active dispatch can recover with /goal resume", async (t) => {
  const f = await fixture(t, []);
  await f.session.prompt("/goal generic objective");
  const path = `${f.manager.getSessionFile()}.codex-goals.json`;
  const env = f.envelope();
  env.dispatch = { dispatchId: "interrupted", sessionId: env.sessionId, goalId: env.goal.id,
    revision: env.revision, phase: "admitted", admittedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(env));
  await f.session.reload();
  await f.session.prompt("/goal resume");
  assert.equal(f.envelope().dispatch, null);
  assert.equal(f.envelope().goal.status, "active");
});

test("host: interrupted-dispatch recovery reconciles persisted usage before resetting the baseline", async (t) => {
  const f = await fixture(t, []);
  await f.session.prompt("/goal --tokens 3 -- generic objective");
  const env = f.envelope();
  const dispatch = { dispatchId: "interrupted", sessionId: env.sessionId, goalId: env.goal.id, revision: env.revision, purpose: "continuation", phase: "running", admittedAt: new Date().toISOString() };
  writeFileSync(`${f.manager.getSessionFile()}.codex-goals.json`, JSON.stringify({ ...env, dispatch }));
  f.manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "persisted work before interruption" }],
    api: "openai-completions", provider: "goals-fixture", model: "scripted", usage: { ...usage }, stopReason: "stop", timestamp: Date.now() });
  await f.session.reload();
  await f.session.prompt("/goal resume --tokens 6");
  assert.equal(f.envelope().goal.tokensUsed, 3);
  assert.equal(f.envelope().goal.status, "active");
  assert.equal(f.envelope().goal.tokenBudget, 6);
  assert.equal(f.envelope().dispatch, null);
  assert.equal(f.calls(), 0);
});

test("host: a model-created goal excludes history and the response that requested its creation", async (t) => {
  const create = [{ type: "toolCall", id: "create", name: "create_goal", arguments: { objective: "generic objective" } }];
  const f = await fixture(t, ["unrelated history", create, complete, "final report"]);
  await f.session.prompt("Unrelated question");
  await f.session.prompt("Explicitly create a goal now");
  assert.equal(f.envelope().goal.status, "complete");
  assert.equal(f.envelope().goal.tokensUsed, 6);
});

test("host: a paused goal does not charge an unrelated user run", async (t) => {
  const f = await fixture(t, ["unrelated reply"]);
  await f.session.prompt("/goal generic objective");
  await f.session.prompt("/goal pause");
  await f.session.prompt("Unrelated question while paused");
  assert.equal(f.envelope().goal.tokensUsed, 0);
});

test("host: stale delivered dispatch is logged and aborted before a model request", async (t) => {
  const f = await fixture(t, ["must not run"]);
  await f.session.prompt("/goal generic objective");
  const old = f.envelope();
  await f.session.prompt("/goal clear");
  await f.session.sendCustomMessage({ customType: "codex-goal-context", content: "stale attempted instruction", display: true,
    details: { schemaVersion: 1, sessionId: old.sessionId, goalId: old.goal.id, revision: old.revision, purpose: "continuation", dispatchId: "stale" } }, { triggerTurn: true });
  await f.session.waitForIdle();
  assert.equal(f.calls(), 0);
  assert.equal(f.envelope().goal, null);
  assert.ok(f.manager.getEntries().some((e) => e.type === "custom_message" && e.content === "stale attempted instruction"));
  assert.ok(f.manager.getEntries().some((e) => e.type === "custom" && e.customType === "codex-goal-notice" && e.data.text.includes("must not be acted on")));
});

test("host: storage failure aborts a delivered goal instruction before model work", async (t) => {
  const f = await fixture(t, ["must not run"]);
  await f.session.prompt("/goal generic objective");
  const old = f.envelope();
  unlinkSync(`${f.manager.getSessionFile()}.codex-goals.json`);
  await f.session.sendCustomMessage({ customType: "codex-goal-context", content: "instruction with unavailable state", display: true,
    details: { sessionId: old.sessionId, goalId: old.goal.id, revision: old.revision, purpose: "continuation", dispatchId: "missing-state" } }, { triggerTurn: true });
  await f.session.waitForIdle();
  assert.equal(f.calls(), 0);
  assert.ok(f.errors.some((e) => /sidecar|storage/i.test(e.error)));
});

test("host: an actual user abort pauses and retains reported usage", { timeout: 5_000 }, async (t) => {
  const f = await fixture(t, [{ content: [], stopReason: "aborted", waitForAbort: true }]);
  await f.session.prompt("/goal generic objective");
  const run = f.session.prompt("Start the goal");
  while (f.calls() === 0) await new Promise((resolve) => setImmediate(resolve));
  await f.session.abort();
  await run;
  assert.equal(f.envelope().goal.status, "paused");
  assert.equal(f.envelope().goal.tokensUsed, 3);
  assert.equal(f.calls(), 1);
});

test("host: only three empty automatic executions block, not the preceding user execution", async (t) => {
  const f = await fixture(t, [[], [], [], []]);
  await f.session.prompt("/goal generic objective");
  await f.session.prompt("Start the goal");
  assert.equal(f.calls(), 4);
  assert.equal(f.envelope().goal.status, "blocked");
});

test("host: a provider's aborted stop reason alone is not a user pause", async (t) => {
  const f = await fixture(t, [{ content: [], stopReason: "aborted" }]);
  await f.session.prompt("/goal generic objective");
  await f.session.prompt("Start the goal");
  assert.equal(f.envelope().goal.status, "blocked");
});

test("host: a fresh extension runtime inherits the fork parent's settled sidecar", async (t) => {
  const pause = [{ type: "toolCall", id: "pause", name: "update_goal", arguments: { status: "paused" } }];
  const parent = await fixture(t, [pause, "paused report"]);
  await parent.session.prompt("/goal generic objective");
  await parent.session.prompt("Start the goal, then pause it as explicitly requested");
  const original = parent.envelope();
  const child = await fixture(t, [], { parent: parent.manager.getSessionFile() });
  assert.notEqual(child.manager.getSessionId(), parent.manager.getSessionId());
  assert.deepEqual({ ...child.envelope().goal, updatedAt: original.goal.updatedAt }, original.goal);
  assert.equal(child.envelope().dispatch, null);
  await child.session.prompt("/goal clear");
  assert.deepEqual(parent.envelope().goal, original.goal);
});

test("host: final-report usage preserves verified completion after an exhausted budget", async (t) => {
  const f = await fixture(t, [complete, "final report"]);
  await f.session.prompt("/goal --tokens 3 -- generic objective");
  await f.session.prompt("Start the goal");
  assert.equal(f.envelope().goal.status, "complete");
  assert.equal(f.envelope().goal.tokensUsed, 6);
  assert.equal(f.calls(), 2);
});

test("host: reload reconciles an interrupted user run before admitting budgeted work", async (t) => {
  const f = await fixture(t, ["must not run"]);
  await f.session.prompt("/goal --tokens 3 -- generic objective");
  f.manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "persisted user-run work" }],
    api: "openai-completions", provider: "goals-fixture", model: "scripted", usage: { ...usage }, stopReason: "stop", timestamp: Date.now() });
  await f.session.reload();
  await f.session.waitForIdle();
  assert.equal(f.calls(), 0);
  assert.equal(f.envelope().goal.tokensUsed, 3);
  assert.equal(f.envelope().goal.status, "budget_limited");
});

test("host: reloading settled active state admits work without another user prompt", async (t) => {
  const f = await fixture(t, [complete, "final report"]);
  await f.session.prompt("/goal generic objective");
  await f.session.reload();
  await f.session.waitForIdle();
  assert.equal(f.calls(), 2);
  assert.equal(f.envelope().goal.status, "complete");
});
