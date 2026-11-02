import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as sdk from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { ARCHIVE_TYPE, RECALL_TOOL, recallArchive } from "../src/archive.ts";
import { productionHistory, usage } from "./fixtures.mjs";

const extensionPath = resolve(import.meta.dirname, "../index.ts");
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "context-archive-host-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager: settings,
    additionalExtensionPaths: [extensionPath], noSkills: true, noThemes: true, noContextFiles: true, noPromptTemplates: true });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  const runtime = await sdk.ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  const contexts = []; const replies = [];
  runtime.registerProvider("archive-fixture", { api: "openai-completions", apiKey: "fixture-only", baseUrl: "http://fixture.invalid",
    models: [{ id: "scripted", name: "Scripted", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 80000, maxTokens: 1000 }],
    streamSimple(model, context, options) {
      contexts.push(structuredClone(context));
      const reply = replies.shift(); assert.notEqual(reply, undefined, "no unexpected inference/continuation");
      const stream = createAssistantMessageEventStream();
      const finish = () => {
        const content = typeof reply === "string" ? [{ type: "text", text: reply }] : reply === null ? [] : reply;
        const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage,
          stopReason: options.signal.aborted ? "aborted" : content.some((p) => p.type === "toolCall") ? "toolUse" : "stop", timestamp: Date.now() };
        stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: message.stopReason, message }); stream.end();
      };
      if (reply === null) options.signal.addEventListener("abort", finish, { once: true }); else queueMicrotask(finish);
      return stream;
    } });
  const manager = sdk.SessionManager.create(dir, dir); const ids = productionHistory(manager);
  const { session } = await sdk.createAgentSession({ cwd: dir, agentDir: dir, modelRuntime: runtime,
    model: runtime.getModel("archive-fixture", "scripted"), thinkingLevel: "off", settingsManager: settings,
    resourceLoader: loader, sessionManager: manager, tools: ["bash", RECALL_TOOL] });
  const errors = []; await session.bindExtensions({ mode: "rpc", onError: (e) => errors.push(e) });
  t.after(async () => {
    await session.abort(); session.dispose();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, session, manager, contexts, replies, errors, ids };
}
async function eventually(check) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error("fixture state deadline"); await new Promise((r) => setTimeout(r, 10)); }
}

// Behavioral-active good-communication: real Pi loader, runtime, JSONL, boundaries, tool loop.
test("real Pi: default off -> archive -> bounded exact tool recovery -> immediate disable -> reload", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  f.replies.push("No reduction by default"); await f.session.prompt("Continue with full history");
  assert.equal(f.manager.getEntries().some((e) => e.type === "context_edit"), false);
  assert.ok(!f.contexts[0].messages.filter((m) => m.role === "system").flatMap((m) => m.toolsAdded ?? []).some((tool) => tool.name === RECALL_TOOL));
  const original = readFileSync(f.manager.getSessionFile(), "utf8");
  await f.session.prompt("/context-archive on");
  assert.equal(f.contexts.length, 1, "command never makes inference");
  f.replies.push("Boundary ready"); await f.session.prompt("Continue work, then manage old context");
  assert.equal(f.contexts.length, 2);
  assert.ok(readFileSync(f.manager.getSessionFile(), "utf8").startsWith(original));
  const catalog = recallArchive(f.manager.getBranch(), { action: "list", offset: 0, limit: 20 });
  assert.equal(catalog.total, 2);
  const item = catalog.items.find((item) => item.entryId === f.ids.output);
  f.replies.push([{ type: "toolCall", id: "recall-old", name: RECALL_TOOL, arguments: { action: "read", entryId: item.entryId, sha256: item.sha256, offset: 0, limit: 300 } }], "Recovered historical observation, not a current measurement");
  await f.session.prompt("Retrieve the prior observation before using its historical value");
  assert.equal(f.contexts.length, 4);
  assert.match(JSON.stringify(f.contexts[2]), /Context archived/);
  assert.ok(f.contexts[2].messages.filter((m) => m.role === "system").flatMap((m) => m.toolsAdded ?? []).some((tool) => tool.name === RECALL_TOOL), "recovery schema must already be declared on the first stub-bearing request");
  assert.doesNotMatch(JSON.stringify(f.contexts[2]), /Historical invocation/);
  const toolResult = f.manager.getBranch().find((e) => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === RECALL_TOOL);
  const page = JSON.parse(toolResult.message.content[0].text);
  assert.equal(page.payload.length, 300); assert.match(page.payload, /OLD_OBSERVATION=17/);
  assert.match(JSON.stringify(f.contexts[3]), /OLD_OBSERVATION=17/);
  await f.session.prompt("/context-archive off");
  f.replies.push("Full retained originals restored"); await f.session.prompt("Continue with archival disabled");
  assert.match(JSON.stringify(f.contexts[4]), /Historical invocation/);
  assert.match(JSON.stringify(f.contexts[4]), /OLD_OBSERVATION=17/);
  assert.ok(!f.manager.buildSessionProjection().messages.some((m) => JSON.stringify(m).includes("Context archived")));
  await f.session.reload();
  f.replies.push("Reload retained off"); await f.session.prompt("Check after reload");
  assert.match(JSON.stringify(f.contexts[5]), /Historical invocation/);
  assert.equal(JSON.parse(readFileSync(join(f.dir, "context-archive.json"), "utf8")).enabled, false);
  assert.deepEqual(f.errors, []);
});

test("real Pi: explicit ON repairs an independently deactivated recovery tool", { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  await f.session.prompt("/context-archive on");
  f.session.setActiveToolsByName(["bash"]);
  assert.ok(!f.session.getActiveToolNames().includes(RECALL_TOOL));
  await f.session.prompt("/context-archive on");
  assert.ok(f.session.getActiveToolNames().includes(RECALL_TOOL), "explicit ON must repair deactivation");
  assert.deepEqual(f.errors, []);
});

test("real Pi: abort cannot archive an otherwise eligible history or restart the run", { timeout: 15000 }, async (t) => {
  const f = await fixture(t); await f.session.prompt("/context-archive on");
  f.replies.push(null);
  const pending = f.session.prompt("Wait for cancellation"); await eventually(() => f.contexts.length === 1);
  await f.session.abort(); await pending;
  assert.equal(f.manager.getBranch().filter((e) => e.type === "custom" && e.customType === ARCHIVE_TYPE).length, 0);
  assert.equal(f.contexts.length, 1); assert.deepEqual(f.errors, []);
});

test("real Pi: corrupt archive prevents a provider request rather than sending unverifiable stubs", { timeout: 15000 }, async (t) => {
  const f = await fixture(t); await f.session.prompt("/context-archive on");
  f.manager.appendCustomEntry(ARCHIVE_TYPE, { version: 999 });
  f.replies.push("Must never be requested");
  await f.session.prompt("Do not send unverifiable evidence");
  assert.equal(f.contexts.length, 0);
  assert.ok(f.errors.some((e) => e.error.includes("manifest")));
});

test("real Pi: native compaction excludes stubs but original archive remains available on reload", { timeout: 15000 }, async (t) => {
  const f = await fixture(t); await f.session.prompt("/context-archive on");
  f.replies.push("Archive first"); await f.session.prompt("Continue");
  const item = recallArchive(f.manager.getBranch(), { action: "list", offset: 0, limit: 20 }).items.find((i) => i.entryId === f.ids.output);
  const tail = f.manager.getBranch().findLast((e) => e.type === "message" && e.message.role === "assistant").id;
  f.manager.appendCompaction("Structured task state retained by a native checkpoint", tail, 80000);
  await f.session.reload();
  assert.match(recallArchive(f.manager.getBranch(), { action: "read", ...item, offset: 0, limit: 300 }).payload, /OLD_OBSERVATION=17/);
  await f.session.prompt("/context-archive off"); f.replies.push("Checkpoint stays authoritative"); await f.session.prompt("Continue after native compaction");
  assert.doesNotMatch(JSON.stringify(f.contexts.at(-1)), /OLD_OBSERVATION=17/);
  assert.match(JSON.stringify(f.contexts.at(-1)), /Structured task state retained/);
  assert.deepEqual(f.errors, []);
});
