import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDecisions } from "../index.ts";
import { SqliteDecisionStore } from "../src/store.ts";

function fixture(t) {
  const entries = [];
  const dir = mkdtempSync(join(tmpdir(), "decisions-extension-"));
  const path = join(dir, "decisions", "questions.sqlite");
  const handlers = new Map();
  const commands = new Map();
  const widgets = [];
  const messages = [];
  const notifications = [];
  let tool;
  let tick;
  let watching = false;
  let unavailable = false;
  const pi = {
    on: (name, fn) => handlers.set(name, fn),
    registerTool: (value) => { tool = value; },
    registerMessageRenderer() {},
    registerShortcut() {},
    registerCommand: (name, value) => commands.set(name, value),
    enqueueMessage: (message, options) => { messages.push({ message, options }); },
  };
  const ctx = {
    cwd: dir, mode: "rpc", hasUI: true, isIdle: () => true,
    sessionManager: { getSessionId: () => "origin", getBranch: () => entries },
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      setWidget: (...args) => widgets.push(args),
    },
  };
  registerDecisions(pi, { databasePath: path, openStore: (file) => {
    const store = new SqliteDecisionStore(file);
    const list = store.list.bind(store);
    const get = store.get.bind(store);
    store.get = (project, id) => {
      if (unavailable) throw new Error("test storage unavailable");
      return get(project, id);
    };
    store.list = (project) => {
      if (unavailable) throw new Error("test storage unavailable");
      return list(project);
    };
    return store;
  }, projectFor: () => "project-a",
    watch: (refresh) => { tick = refresh; watching = true; return () => { watching = false; }; } });
  t.after(() => { handlers.get("session_shutdown")({}, ctx); rmSync(dir, { recursive: true, force: true }); });
  const start = () => handlers.get("session_start")({}, ctx);
  return { path, ctx, entries, messages, widgets, notifications, start, tick: () => tick(), watching: () => watching,
    setUnavailable: (value) => { unavailable = value; },
    call: (params, id) => tool.execute(id, params, undefined, () => {}, ctx),
    command: (text) => commands.get("decisions").handler(text, ctx), handlers };
}

test("nonblocking ask creates project questions and a bottom-left badge, list/get do not answer", async (t) => {
  const f = fixture(t);
  f.start();
  const result = await f.call({ action: "ask", question: "Which storage?", context: "Concurrent sessions", options: ["SQLite", "JSONL"], recommendation: "SQLite" }, "call-1");
  assert.equal(result.details.id, "Q1");
  assert.equal(result.details.status, "pending");
  assert.match(result.content[0].text, /not an answer/);
  const [key, factory, options] = f.widgets.at(-1);
  assert.equal(key, "decisions");
  assert.equal(options.placement, "borderBottomLeft");
  const theme = { bg: (_color, s) => s, fg: (_color, s) => s };
  assert.match(factory(null, theme).render(80)[0], /1 unanswered/);
  assert.equal((await f.call({ action: "list" }, "list")).details.total, 1);
  assert.equal((await f.call({ action: "get", id: "q1" }, "get")).details.context, "Concurrent sessions");
  assert.equal(f.messages.length, 0);
  assert.equal((await f.call({ action: "ask", question: "Which storage?", options: ["SQLite", "JSONL"], context: "Concurrent sessions", recommendation: "SQLite" }, "call-1")).details.id, "Q1");
});

test("answer/revision notices wake the origin once, clear badge, and retain full answer", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Pick" }, "call");
  await f.command("answer Q1 SQLite with transactions");
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].message.display, true);
  assert.match(f.messages[0].message.content, /SQLite with transactions/);
  assert.deepEqual(f.messages[0].options, { triggerTurn: true, deliverAs: "followUp" });
  assert.equal(f.widgets.at(-1)[1], undefined);
  f.tick();
  assert.equal(f.messages.length, 1);
  await f.command("reopen Q1");
  assert.match(f.messages.at(-1).message.content, /withdrawn/);
  assert.equal((await f.call({ action: "get", id: "Q1" }, "get")).details.answer, null);
});

test("another session's answer is discovered; other projects/sessions do not wake this agent", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Origin question" }, "own");
  const external = new SqliteDecisionStore(f.path);
  t.after(() => external.close());
  external.resolve("project-a", "Q1", 1, "answered", "external answer");
  const input = { question: "Other", context: "", options: [], recommendation: "", sessionId: "other", toolCallId: "other" };
  const other = external.ask("project-a", input);
  external.resolve("project-a", other.id, 1, "answered", "not for origin");
  const foreign = external.ask("project-b", { ...input, sessionId: "origin" });
  external.resolve("project-b", foreign.id, 1, "answered", "foreign answer");
  f.tick();
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].message.content, /external answer/);
});

test("persisted custom_message receipt suppresses redelivery after reload/resume", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Resume?" }, "resume");
  await f.command("answer Q1 yes");
  f.entries.push({ type: "custom_message", ...f.messages[0].message });
  f.start(); f.tick();
  assert.equal(f.messages.length, 1);
  assert.equal(f.watching(), true);
});

test("validation is visible and never resolves on malformed or empty answers", async (t) => {
  const f = fixture(t); f.start();
  await assert.rejects(f.call({ action: "ask" }, "bad"), /required/);
  await f.call({ action: "ask", question: "Pending?" }, "pending");
  await f.command("answer Q1");
  assert.equal(f.notifications.at(-1).level, "error");
  await f.command("dismiss Q1 surprise");
  assert.equal(f.notifications.at(-1).level, "error");
  assert.equal((await f.call({ action: "get", id: "Q1" }, "get")).details.status, "pending");
  await f.command("dismiss Q1");
  assert.match(f.messages.at(-1).message.content, /not approval/);
});

test("storage outages retain the last badge, fail tool reads, and report recovery once", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Keep me" }, "question");
  const count = f.widgets.length;
  f.setUnavailable(true);
  f.tick(); f.tick();
  assert.equal(f.widgets.length, count, "an outage must not clear the pending badge");
  assert.equal(f.notifications.length, 1, "one notification per outage");
  assert.match(f.notifications[0].message, /not been cleared/);
  await assert.rejects(f.call({ action: "list" }, "list"), /storage unavailable/);
  f.setUnavailable(false);
  f.tick(); f.tick();
  assert.equal(f.notifications.length, 2);
  assert.match(f.notifications[1].message, /available again/);
  assert.equal((await f.call({ action: "list" }, "list")).details.total, 1);
});

test("notification verification failure removes historical answer from provider context", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Proceed?" }, "question");
  await f.command("answer Q1 Historical approval");
  f.setUnavailable(true);
  const original = { role: "custom", ...f.messages[0].message };
  const transformed = f.handlers.get("context")({ messages: [original] }, f.ctx);
  assert.match(transformed.messages[0].content, /verification is unavailable/);
  assert.doesNotMatch(transformed.messages[0].content, /Historical approval/);
  assert.match(original.content, /Historical approval/, "historical transcript event remains unchanged");
});

test("list paginates summaries, filter defaults pending, shutdown stops the watch", async (t) => {
  const f = fixture(t); f.start();
  for (let i = 0; i < 12; i++) await f.call({ action: "ask", question: `Question ${i}` }, `call-${i}`);
  const first = (await f.call({ action: "list" }, "list")).details;
  assert.equal(first.questions.length, 10);
  assert.equal(first.nextOffset, 10);
  assert.equal("context" in first.questions[0], false);
  const second = (await f.call({ action: "list", offset: 10 }, "list")).details;
  assert.equal(second.questions.length, 2);
  assert.equal(second.nextOffset, null);
  await f.command("answer Q1 yes");
  assert.equal((await f.call({ action: "list" }, "list")).details.total, 11);
  assert.equal((await f.call({ action: "list", status: "all" }, "list")).details.total, 12);
  f.handlers.get("session_shutdown")({}, f.ctx);
  assert.equal(f.watching(), false);
  assert.doesNotThrow(() => f.tick(), "stopped callback must not access disposed storage");
});
