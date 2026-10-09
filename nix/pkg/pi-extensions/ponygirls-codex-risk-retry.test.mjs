import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.PI_RETRY_SDK_ROOT;
assert.ok(root, "Set PI_RETRY_SDK_ROOT to the installed pi-monorepo directory.");
const sdk = await import(pathToFileURL(join(root, "dist/index.js")));
const { createAssistantMessageEventStream } = await import(pathToFileURL(join(root, "node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js")));
const extensionPath = resolve(import.meta.dirname, "ponygirls-codex-risk-retry.ts");
const extension = (await import(pathToFileURL(extensionPath))).default;
const RETRY_TYPE = "ponygirls:codex-risk-retry";
const EXHAUSTED_TYPE = "ponygirls:codex-risk-retry-exhausted";
const DENIAL = "Codex error: This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. If you’re doing authorized security work that requires more cyber permissive safeguards, apply for Daybreak access via https://platform.openai.com/settings/organization/status-and-access before retrying.";
const denied = { stopReason: "error", errorMessage: DENIAL };
const usage = { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

// Specified Behavioral-Active / Blackbox-Group: real Pi lifecycle, scripted provider, no network.
async function fixture(t, replies, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "codex-risk-retry-"));
  const settingsManager = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager,
    additionalExtensionPaths: [
      ...(options.beforeFactories === undefined ? [extensionPath] : []),
      ...(options.withGoals === true ? [process.env.PI_RETRY_GOALS_EXTENSION ?? resolve(import.meta.dirname, "ponygirls-codex-goals")] : []),
    ],
    extensionFactories: options.beforeFactories === undefined ? options.factories ?? []
      : [...options.beforeFactories, extension, ...(options.factories ?? [])],
    noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const started = Promise.withResolvers();
  const requests = [];
  runtime.registerProvider("retry-fixture", { baseUrl: "http://fixture.invalid", apiKey: "fixture-only",
    api: options.api ?? "openai-codex-responses",
    models: [{ id: "scripted", name: "Scripted", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1000 }],
    streamSimple(model, context, streamOptions) {
      requests.push(structuredClone(context));
      started.resolve();
      const reply = replies[requests.length - 1];
      assert.ok(reply, `Unexpected model request #${requests.length}`);
      const stream = createAssistantMessageEventStream();
      const finish = () => {
        const content = typeof reply === "string" ? [{ type: "text", text: reply }] : reply.content ?? [];
        const message = { role: "assistant", content,
          api: model.api, provider: model.provider, model: model.id, usage: structuredClone(usage),
          stopReason: reply.stopReason ?? (content.some((part) => part.type === "toolCall") ? "toolUse" : "stop"), timestamp: Date.now(),
          ...(reply.errorMessage === undefined ? {} : { errorMessage: reply.errorMessage }) };
        stream.push({ type: "start", partial: message });
        stream.push(message.stopReason === "error" || message.stopReason === "aborted"
          ? { type: "error", reason: message.stopReason, error: message }
          : { type: "done", reason: message.stopReason, message });
        stream.end();
      };
      if (reply.waitForAbort === true) {
        assert.ok(streamOptions.signal);
        streamOptions.signal.addEventListener("abort", finish, { once: true });
      } else queueMicrotask(finish);
      return stream;
    } });
  const manager = sdk.SessionManager.create(dir, dir);
  const { session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime,
    model: runtime.getModel("retry-fixture", "scripted"), thinkingLevel: "off", settingsManager,
    resourceLoader: loader, sessionManager: manager,
    tools: options.withGoals === true ? ["create_goal", "get_goal", "update_goal"] : [] });
  const errors = [];
  const events = [];
  session.subscribe((event) => events.push(event.type));
  await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error) });
  if (options.withGoals === true) session.setActiveToolsByName(["create_goal", "get_goal", "update_goal"]);
  t.after(async () => { await session.abort(); session.dispose(); rmSync(dir, { recursive: true, force: true }); });
  return { session, manager, errors, events, requests, started: started.promise,
    retries: () => manager.getBranch().filter((e) => e.type === "custom_message" && e.customType === RETRY_TYPE),
    exhausted: () => manager.getBranch().filter((e) => e.type === "custom_message" && e.customType === EXHAUSTED_TYPE) };
}

async function continueLoop(f) {
  await f.session.sendCustomMessage({ customType: "test:loop", content: "Continue the existing task.", display: true }, { triggerTurn: true });
  await f.session.waitForIdle();
}

test("one classifier block recovers before final settlement with visible, persisted clarification", async (t) => {
  const f = await fixture(t, [denied, "completed"]);
  await f.session.prompt("Implement application access controls and their tests.");
  assert.equal(f.requests.length, 2);
  assert.equal(f.events.filter((e) => e === "agent_settled").length, 1);
  assert.equal(f.session.getLastAssistantText(), "completed");
  const [retry] = f.retries();
  assert.equal(retry.display, true);
  assert.match(retry.content, /external classifier blocked/);
  assert.match(retry.content, /may be a false positive/);
  assert.match(retry.content, /Continue if permitted/);
  assert.match(retry.content, /without changing or concealing/);
  assert.equal(retry.details.attempt, 1);
  assert.equal(retry.details.userEntryId, f.manager.getBranch().find((e) => e.type === "message" && e.message.role === "user").id);
  assert.equal(retry.details.failedEntryId, f.manager.getBranch().find((e) => e.type === "message" && e.message.stopReason === "error").id);
  const raw = readFileSync(f.manager.getSessionFile(), "utf8");
  assert.ok(raw.includes(JSON.stringify(retry.content)));
  assert.ok(f.requests[1].messages.some((m) => m.role === "user" && JSON.stringify(m.content).includes("external classifier")));
  assert.deepEqual(f.errors, []);
});

test("three consecutive blocks exhaust exactly two continuations and retain original diagnostics", async (t) => {
  const f = await fixture(t, [denied, denied, denied]);
  await f.session.prompt("Implement application access controls.");
  assert.equal(f.requests.length, 3);
  assert.deepEqual(f.retries().map((e) => e.details.attempt), [1, 2]);
  assert.equal(f.exhausted().length, 1);
  assert.equal(f.exhausted()[0].display, true);
  assert.match(f.exhausted()[0].content, /stopped after 2/);
  assert.equal(f.manager.getBranch().filter((e) => e.type === "message" && e.message.errorMessage === DENIAL).length, 3);
  assert.deepEqual(f.errors, []);
});

test("an autonomous goal continues after recovery instead of settling as blocked", async (t) => {
  const complete = { content: [{ type: "toolCall", id: "complete", name: "update_goal", arguments: { status: "complete" } }] };
  const f = await fixture(t, [denied, "progress", complete, "completed"], { withGoals: true });
  await f.session.prompt("/goal Implement application access controls and their tests.");
  await f.session.waitForIdle();
  if (f.requests.length === 0) await f.session.prompt("Start the recorded goal.");
  await f.session.waitForIdle();
  assert.equal(f.requests.length, 4, JSON.stringify({ errors: f.errors,
    tools: f.manager.getBranch().filter((e) => e.type === "message" && e.message.role === "toolResult") }));
  const envelope = JSON.parse(readFileSync(`${f.manager.getSessionFile()}.codex-goals.json`, "utf8"));
  assert.equal(envelope.goal.status, "complete");
  assert.equal(f.retries().length, 1);
  assert.deepEqual(f.errors, []);
});

test("exhausted recovery leaves an autonomous goal blocked instead of looping indefinitely", async (t) => {
  const f = await fixture(t, [denied, denied, denied], { withGoals: true });
  await f.session.prompt("/goal Implement application access controls and their tests.");
  await f.session.waitForIdle();
  if (f.requests.length === 0) await f.session.prompt("Start the recorded goal.");
  await f.session.waitForIdle();
  assert.equal(f.requests.length, 3);
  const envelope = JSON.parse(readFileSync(`${f.manager.getSessionFile()}.codex-goals.json`, "utf8"));
  assert.equal(envelope.goal.status, "blocked");
  assert.equal(f.retries().length, 2);
  assert.equal(f.exhausted().length, 1);
  assert.deepEqual(f.errors, []);
});

test("reload and extension-generated input do not replenish an exhausted budget", async (t) => {
  const f = await fixture(t, [denied, denied, denied, denied]);
  await f.session.prompt("Implement application access controls.");
  await f.session.reload();
  await continueLoop(f);
  assert.equal(f.requests.length, 4);
  assert.equal(f.retries().length, 2);
  assert.deepEqual(f.errors, []);
});

test("successful turns do not replenish the budget for the same user request", async (t) => {
  const f = await fixture(t, [denied, "progress", denied, "more progress", denied]);
  await f.session.prompt("Implement application access controls.");
  await continueLoop(f);
  await continueLoop(f);
  assert.equal(f.requests.length, 5);
  assert.deepEqual(f.retries().map((e) => e.details.attempt), [1, 2]);
  assert.equal(f.exhausted().length, 1);
  assert.deepEqual(f.errors, []);
});

test("a new user message starts its own two-continuation budget", async (t) => {
  const f = await fixture(t, [denied, denied, denied, denied, "completed"]);
  await f.session.prompt("Implement application access controls.");
  await f.session.prompt("Implement additional access-control tests.");
  assert.equal(f.requests.length, 5);
  assert.deepEqual(f.retries().map((e) => e.details.attempt), [1, 2, 1]);
  assert.notEqual(f.retries()[0].details.userEntryId, f.retries()[2].details.userEntryId);
  assert.deepEqual(f.errors, []);
});

test("compaction does not erase consumed budget", async (t) => {
  const f = await fixture(t, [denied, denied, denied, denied]);
  await f.session.prompt("Implement application access controls.");
  f.manager.appendCompaction("Task summary", f.manager.getLeafId(), 20);
  await f.session.reload();
  await continueLoop(f);
  assert.equal(f.requests.length, 4);
  assert.equal(f.retries().length, 2);
  assert.deepEqual(f.errors, []);
});

test("abandoned branches do not consume the active branch's budget", async (t) => {
  const f = await fixture(t, [denied, denied, denied, denied, "completed"]);
  await f.session.prompt("Implement application access controls.");
  const firstFailure = f.manager.getBranch().find((e) => e.type === "message" && e.message.stopReason === "error");
  f.manager.branch(firstFailure.id);
  await f.session.reload();
  await continueLoop(f);
  assert.equal(f.requests.length, 5);
  assert.equal(f.retries().length, 1);
  assert.equal(f.retries()[0].details.attempt, 1);
  assert.equal(f.manager.getEntries().filter((e) => e.type === "custom_message" && e.customType === RETRY_TYPE).length, 3);
  assert.deepEqual(f.errors, []);
});

test("custom-message-only autonomous runs have a bounded budget without a user entry", async (t) => {
  const f = await fixture(t, [denied, denied, denied]);
  await continueLoop(f);
  assert.equal(f.requests.length, 3);
  assert.equal(f.retries().length, 2);
  assert.equal(f.retries()[0].details.userEntryId, null);
  assert.deepEqual(f.errors, []);
});

test("cancellation does not revive a run even if its final provider message is an error", { timeout: 10000 }, async (t) => {
  const f = await fixture(t, [{ ...denied, waitForAbort: true }]);
  const run = f.session.prompt("Implement application access controls.");
  await f.started;
  await f.session.abort();
  await run;
  assert.equal(f.requests.length, 1);
  assert.equal(f.retries().length, 0);
  assert.deepEqual(f.errors, []);
});

test("earlier boundary drafts are preserved", async (t) => {
  const f = await fixture(t, [denied, "completed"], { beforeFactories: [(pi) => {
    pi.on("agent_before_settle", (event) => {
      if (event.outcome === "error") return { entries: [...event.entries,
        { type: "custom", customType: "test:evidence", data: { retained: true } }] };
    });
  }] });
  await f.session.prompt("Implement application access controls.");
  assert.equal(f.requests.length, 2);
  assert.ok(f.manager.getBranch().some((e) => e.type === "custom" && e.customType === "test:evidence"));
  assert.deepEqual(f.errors, []);
});

test("an existing boundary continuation is not duplicated or cancelled", async (t) => {
  const f = await fixture(t, [denied, "completed"], { beforeFactories: [(pi) => {
    pi.on("agent_before_settle", (event) => {
      if (event.outcome === "error") return { entries: [...event.entries,
        { type: "custom_message", customType: "test:continuation", content: "Review the established task scope.", display: true }], continue: true };
    });
  }] });
  await f.session.prompt("Implement application access controls.");
  assert.equal(f.requests.length, 2);
  assert.equal(f.retries().length, 0);
  assert.deepEqual(f.errors, []);
});

test("queued user input takes precedence over recovery", async (t) => {
  const f = await fixture(t, [denied, "completed"], { beforeFactories: [(pi) => {
    pi.on("agent_before_settle", (event) => {
      if (event.outcome === "error") pi.sendUserMessage("New explicit task.", { deliverAs: "followUp" });
    });
  }] });
  await f.session.prompt("Implement application access controls.");
  assert.equal(f.requests.length, 2);
  assert.equal(f.retries().length, 0);
  assert.ok(f.requests[1].messages.some((m) => m.role === "user" && JSON.stringify(m.content).includes("New explicit task")));
  assert.deepEqual(f.errors, []);
});

test("an omitted current failure is not revived from raw history", async (t) => {
  const f = await fixture(t, [denied], { beforeFactories: [(pi) => {
    pi.on("agent_before_settle", (event) => {
      if (event.outcome === "error") return { entries: [...event.entries,
        { type: "context_edit", targetId: event.context.contextEntries.findLast((e) => e.messages.some((m) => m.role === "assistant")).sourceEntry.id,
          replacement: null }] };
    });
  }] });
  await f.session.prompt("Implement application access controls.");
  assert.equal(f.requests.length, 1);
  assert.equal(f.retries().length, 0);
  assert.deepEqual(f.errors, []);
});

test("omitting a newer unrelated error does not revive a historical classifier block", async (t) => {
  const f = await fixture(t, [{ stopReason: "error", errorMessage: "503 Service unavailable" }], { beforeFactories: [(pi) => {
    pi.on("agent_before_settle", (event) => {
      if (event.outcome === "error") return { entries: [...event.entries,
        { type: "context_edit", targetId: event.context.contextEntries.findLast((e) => e.messages.some((m) => m.role === "assistant")).sourceEntry.id,
          replacement: null }] };
    });
  }] });
  f.manager.appendMessage({ role: "assistant", content: [], api: "openai-codex-responses", provider: "retry-fixture",
    model: "scripted", usage: structuredClone(usage), stopReason: "error", errorMessage: DENIAL, timestamp: Date.now() });
  await f.session.reload();
  await continueLoop(f);
  assert.equal(f.requests.length, 1);
  assert.equal(f.retries().length, 0);
  assert.deepEqual(f.errors, []);
});

test("cancellation at the settle boundary prevents the next request", async (t) => {
  const f = await fixture(t, [denied], { factories: [(pi) => {
    pi.on("agent_before_settle", (_event, ctx) => ctx.abort());
  }] });
  await f.session.prompt("Implement application access controls.");
  assert.equal(f.requests.length, 1);
  // Pi commits boundary notes before checking cancellation; that reservation stays spent.
  assert.equal(f.retries().length, 1);
  assert.deepEqual(f.errors, []);
});

test("malformed persisted retry evidence fails closed", async (t) => {
  const f = await fixture(t, [denied]);
  f.manager.appendCustomMessageEntry(RETRY_TYPE, "Invalid retry record", true, { attempt: 1 });
  await f.session.reload();
  await continueLoop(f);
  assert.equal(f.requests.length, 1);
  assert.equal(f.retries().length, 1);
  assert.equal(f.errors.length, 1);
  assert.match(f.errors[0].error, /invalid persisted retry details/);
});

test("unrelated failures, model refusals, and other APIs are untouched", async (t) => {
  for (const [name, reply, api] of [
    ["network failure", { stopReason: "error", errorMessage: "503 Service unavailable" }, "openai-codex-responses"],
    ["generic content filter", { stopReason: "error", errorMessage: "Content policy violation" }, "openai-codex-responses"],
    ["model refusal", "I cannot assist with this task.", "openai-codex-responses"],
    ["quoted diagnostic in successful output", DENIAL, "openai-codex-responses"],
    ["provider aborted", { ...denied, stopReason: "aborted" }, "openai-codex-responses"],
    ["different API", denied, "openai-completions"],
  ]) await t.test(name, async (t) => {
    const f = await fixture(t, [reply], { api });
    await f.session.prompt("Implement application access controls.");
    assert.equal(f.requests.length, 1);
    assert.equal(f.retries().length, 0);
    assert.equal(f.exhausted().length, 0);
    assert.deepEqual(f.errors, []);
  });
});
