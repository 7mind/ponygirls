import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDecisions } from "../index.ts";
import { SqliteDecisionStore } from "../src/store.ts";

function fixture(t) {
  const preferences = { path: "memory:decisions", value: { enabled: true }, failure: null,
    read() { if (this.failure !== null) throw new Error(this.failure); return { ...this.value }; },
    write(value) { this.value = { ...value }; } };
  const entries = [];
  const dir = mkdtempSync(join(tmpdir(), "decisions-extension-"));
  const path = join(dir, "decisions", "questions.sqlite");
  const handlers = new Map();
  const commands = new Map();
  const shortcuts = new Map();
  const widgets = [];
  const messages = [];
  const notifications = [];
  let tool;
  let active = ["bash"];
  let tick;
  let watching = false;
  let unavailable = false;
  let projectFailure = false;
  const pi = {
    on: (name, fn) => handlers.set(name, fn),
    registerTool: (value) => { tool = value; if (value.exposure === undefined || value.exposure === "direct") active = [...new Set([...active, value.name])]; },
    getActiveTools: () => active,
    setActiveTools: (value) => { active = value; },
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
    registerMessageRenderer() {},
    registerShortcut: (key, value) => shortcuts.set(key, value),
    registerCommand: (name, value) => commands.set(name, value),
    enqueueMessage: (message, options) => { messages.push({ message, options }); },
  };
  const ctx = {
    cwd: dir, mode: "rpc", hasUI: true, isIdle: () => true,
    sessionManager: { getSessionId: () => "origin", getBranch: () => entries, getEntries: () => entries },
    ui: {
      notify: (message, level) => notifications.push({ message, level }),
      setWidget: (...args) => widgets.push(args),
    },
  };
  registerDecisions(pi, { preferences, databasePath: path, openStore: (file) => {
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
  }, projectFor: () => { if (projectFailure) throw new Error("test project resolution failed"); return "project-a"; },
    watch: (refresh) => { tick = refresh; watching = true; return () => { watching = false; }; } });
  t.after(() => { handlers.get("session_shutdown")({}, ctx); rmSync(dir, { recursive: true, force: true }); });
  const start = () => handlers.get("session_start")({}, ctx);
  return { path, pi, ctx, entries, messages, widgets, notifications, preferences, shortcuts, start, tick: () => tick(), watching: () => watching,
    setActive: (value) => { active = value; },
    active: () => active, tool: () => tool, completions: (prefix) => commands.get("decisions").getArgumentCompletions(prefix),
    setUnavailable: (value) => { unavailable = value; }, failProject: () => { projectFailure = true; },
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
  assert.equal(factory({ requestRender() {} }, theme).render(80)[0], " 📥 1+0 · ⌃⌥D ");
  assert.equal(f.shortcuts.get("ctrl+alt+d").description, "Open decisions inbox");
  assert.equal(f.shortcuts.has("ctrl+shift+d"), false, "Pi reserves Ctrl+Shift+D for its global debug handler");
  const tagged = { bg: (color, s) => `[${color}]${s}[/${color}]`, fg: (color, s) => `<${color}>${s}</${color}>` };
  assert.equal(factory({ requestRender() {} }, tagged).renderCompact(10), "[toolPendingBg] <warning>📥</warning><text>1+0</text> [/toolPendingBg]");
  assert.equal((await f.call({ action: "list" }, "list")).details.total, 1);
  assert.equal((await f.call({ action: "get", id: "q1" }, "get")).details.context, "Concurrent sessions");
  assert.equal(f.messages.length, 0);
  assert.equal((await f.call({ action: "ask", question: "Which storage?", options: ["SQLite", "JSONL"], context: "Concurrent sessions", recommendation: "SQLite" }, "call-1")).details.id, "Q1");
});

test("badge partitions only pending project questions by originating session and refreshes on changes", async (t) => {
  const f = fixture(t); f.start();
  assert.equal(f.widgets.at(-1)[1], undefined);
  const theme = { bg: (_color, s) => s, fg: (_color, s) => s };
  const badge = (here, other) => {
    const widget = f.widgets.at(-1)[1]({ requestRender() {} }, theme);
    assert.equal(widget.render(100)[0], ` 📥 ${here}+${other} · ⌃⌥D `);
    assert.equal(widget.renderCompact(20), ` 📥${here}+${other} `);
  };
  const external = new SqliteDecisionStore(f.path);
  t.after(() => external.close());
  const input = { question: "Other question", context: "", options: [], recommendation: "", sessionId: "other", toolCallId: "other" };
  external.ask("project-a", input);
  external.ask("project-a", { ...input, sessionId: "third", toolCallId: "third" });
  external.ask("project-b", input);
  f.tick(); badge(0, 2);
  await f.call({ action: "ask", question: "Here" }, "here");
  badge(1, 2);
  await f.command("dismiss Q1"); badge(1, 1);
  await f.command("answer Q2 Done"); badge(1, 0);
  await f.command("reopen Q1"); badge(1, 1);
  f.ctx.sessionManager.getSessionId = () => "third";
  f.start(); badge(0, 2);
  f.ctx.sessionManager.getSessionId = () => "origin";
  f.start(); badge(1, 1);
  await f.command("dismiss Q3"); badge(0, 1);
  await f.command("dismiss Q1");
  assert.equal(f.widgets.at(-1)[1], undefined);
});

test("agents can review answered and dismissed history with full answers through get", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Answered question", context: "Original context", options: ["Selected option"] }, "first");
  await f.call({ action: "ask", question: "Dismissed question" }, "second");
  await f.command("answer Q1 Selected option with explanation");
  await f.command("dismiss Q2");
  assert.equal((await f.call({ action: "list" }, "pending")).details.total, 0);
  const all = (await f.call({ action: "list", status: "all" }, "history")).details.questions;
  assert.deepEqual(all.map((q) => [q.id, q.status]), [["Q1", "answered"], ["Q2", "dismissed"]]);
  assert.deepEqual((await f.call({ action: "list", status: "answered" }, "answered")).details.questions.map((q) => q.id), ["Q1"]);
  assert.deepEqual((await f.call({ action: "list", status: "dismissed" }, "dismissed")).details.questions.map((q) => q.id), ["Q2"]);
  const answer = (await f.call({ action: "get", id: "Q1" }, "answer")).details;
  assert.equal(answer.answer, "Selected option with explanation");
  assert.equal(answer.context, "Original context");
  assert.deepEqual(answer.options, ["Selected option"]);
  assert.equal((await f.call({ action: "get", id: "Q2" }, "dismissal")).details.answer, null);
});

// Specified behavioral/blackbox-good-communication: public tool backed by local SQLite.
test("agents can record chat answers and dismissals at the observed revision", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Which storage?" }, "first");
  await f.call({ action: "ask", question: "Superseded question" }, "second");
  const answer = "Use SQLite.\nKeep the concurrent-session requirement.";
  const saved = await f.call({ action: "answer", id: "q1", revision: 1, answer }, "answer");
  assert.equal(saved.details.status, "answered");
  assert.equal(saved.details.revision, 2);
  assert.equal(saved.details.answer, answer);
  assert.equal(JSON.parse(saved.content[0].text).answer, answer);
  const dismissed = await f.call({ action: "dismiss", id: "Q2", revision: 1 }, "dismiss");
  assert.equal(dismissed.details.status, "dismissed");
  assert.equal(dismissed.details.answer, null);
  assert.equal(dismissed.details.revision, 2);
  assert.equal((await f.call({ action: "list" }, "pending")).details.total, 0);
  assert.equal(f.widgets.at(-1)[1], undefined);
  assert.equal(f.messages.length, 2);
  assert.match(f.messages[1].message.content, /not approval/i);
  f.tick(); assert.equal(f.messages.length, 2);
  f.start();
  assert.equal((await f.call({ action: "get", id: "Q1" }, "saved")).details.answer, answer);
});

test("agent resolutions preserve concurrent edits and allow explicit corrections after rereading", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Which storage?" }, "first");
  const observed = (await f.call({ action: "get", id: "Q1" }, "read")).details;
  const external = new SqliteDecisionStore(f.path);
  t.after(() => external.close());
  external.resolve("project-a", "Q1", 1, "answered", "Newer user answer");
  for (const action of ["answer", "dismiss"]) {
    await assert.rejects(f.call({ action, id: "Q1", revision: observed.revision,
      ...(action === "answer" ? { answer: "Stale answer" } : {}) }, action), /changed.*reload before saving/);
  }
  const current = (await f.call({ action: "get", id: "Q1" }, "reread")).details;
  assert.equal(current.answer, "Newer user answer");
  assert.equal(current.revision, 2);
  const corrected = await f.call({ action: "answer", id: "Q1", revision: current.revision, answer: "User's explicit correction in chat" }, "correct");
  assert.equal(corrected.details.revision, 3);
  assert.equal(corrected.details.answer, "User's explicit correction in chat");
});

test("agent resolutions validate required fields and never silently discard an answer", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Pending?" }, "first");
  for (const [params, error] of [
    [{ action: "answer", revision: 1, answer: "yes" }, /id is required/],
    [{ action: "dismiss", revision: 1 }, /id is required/],
    [{ action: "answer", id: "Q1", answer: "yes" }, /revision is required/],
    [{ action: "dismiss", id: "Q1" }, /revision is required/],
    [{ action: "answer", id: "Q1", revision: 1 }, /answer is required/],
    [{ action: "answer", id: "Q1", revision: 1, answer: "  " }, /nonempty/],
    [{ action: "answer", id: "Q1", revision: 1, answer: "x".repeat(16001) }, /at most 16000/],
    [{ action: "dismiss", id: "Q1", revision: 1, answer: "Do not discard" }, /answer.*only.*answer/],
    [{ action: "answer", id: "Q0", revision: 1, answer: "yes" }, /question ID/],
    [{ action: "dismiss", id: "Q2", revision: 1 }, /not found/],
    [{ action: "dismiss", id: "Q1", revision: 0 }, /revision must be/],
  ]) await assert.rejects(f.call(params, "invalid"), error);
  assert.equal((await f.call({ action: "get", id: "Q1" }, "unchanged")).details.revision, 1);
  await f.command("off");
  for (const action of ["answer", "dismiss"]) {
    await assert.rejects(f.call({ action, id: "Q1", revision: 1, ...(action === "answer" ? { answer: "yes" } : {}) }, "disabled"), /disabled/i);
  }
});

test("agent guidance requires explicit chat evidence and revision-checked recording", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Pending?" }, "first");
  const tool = f.tool();
  assert.equal(tool.annotations.destructiveHint, true, "answer/dismiss can replace an existing response");
  assert.match(tool.description, /answer.*dismiss/);
  assert.doesNotMatch(tool.description, /Only the user can answer/);
  const guidance = tool.promptGuidelines.join("\n");
  assert.match(guidance, /chat/);
  assert.match(guidance, /answer.*dismiss/);
  assert.match(guidance, /revision/);
  assert.match(guidance, /ambiguous/);
  assert.match(f.handlers.get("before_agent_start")({}, f.ctx).message.content, /chat.*answer.*dismiss/);
});

test("origin session is persisted and current-session markers follow session switches and resume", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Origin question" }, "own");
  await f.command("answer Q1 Keep the origin");
  f.entries.push({ type: "custom_message", ...f.messages[0].message });
  const assertSession = async (sessionId, expected) => {
    f.ctx.sessionManager.getSessionId = () => sessionId;
    f.start();
    const listed = (await f.call({ action: "list", status: "all" }, "list")).details.questions;
    assert.equal(listed[0].sessionId, "origin");
    assert.equal(listed[0].isCurrentSession, expected);
    const result = await f.call({ action: "get", id: "Q1" }, "get");
    assert.equal(result.details.sessionId, "origin");
    assert.equal(result.details.isCurrentSession, expected);
    assert.equal(JSON.parse(result.content[0].text).isCurrentSession, expected);
    const content = f.handlers.get("before_agent_start")({}, f.ctx).message.content;
    assert.match(content, expected ? /Q1 \[answered\] \[this session\] Origin question/ : /Q1 \[answered\] Origin question/);
    if (!expected) assert.doesNotMatch(content, /\[this session\]/);
    await f.command("");
    assert.match(f.notifications.at(-1).message, expected ? /Q1 \[answered\] \[this session\]/ : /Q1 \[answered\] Origin question/);
  };
  await assertSession("origin", true);
  await assertSession("other", false);
  assert.equal(f.messages.length, 1, "another session must not be woken for the origin's question");
  await assertSession("origin", true);
});

test("answer/revision notices wake the origin once, clear badge, and retain full answer", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Pick" }, "call");
  await f.command("answer Q1 SQLite with transactions");
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].message.display, true);
  assert.match(f.messages[0].message.content, /SQLite with transactions/);
  assert.deepEqual(f.messages[0].options, { triggerTurn: true, deliverAs: "steer" });
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

test("a failed session start never lets historical answers reach the provider", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Proceed?" }, "question");
  await f.command("answer Q1 Historical approval");
  const original = { role: "custom", ...f.messages[0].message };
  f.failProject();
  assert.throws(() => f.start(), /project resolution failed/);
  // Pi reports a throwing context handler and sends the messages unchanged, so failure must be expressed in the result.
  const transformed = f.handlers.get("context")({ messages: [original] }, f.ctx);
  assert.match(transformed.messages[0].content, /verification is unavailable/);
  assert.doesNotMatch(transformed.messages[0].content, /Historical approval/);
});

// Specified behavioral/blackbox-group: user commands and model-facing effects.
test("session OFF hides the tool and suppresses badges, reminders and answer wake-ups without losing questions", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Keep this question" }, "own");
  assert.ok(f.active().includes("decisions"));
  await f.command("off");
  assert.deepEqual(f.preferences.read(), { enabled: true });
  assert.equal(f.tool().exposure, "hidden");
  assert.ok(!f.active().includes("decisions"));
  assert.equal(f.widgets.at(-1)[1], undefined);
  assert.equal(f.handlers.get("before_agent_start")({}, f.ctx), undefined);
  await assert.rejects(f.call({ action: "ask", question: "Must not be created" }, "disabled"), /disabled/i);
  await f.command("answer Q1 Kept while disabled");
  f.tick();
  assert.equal(f.messages.length, 0);
  await f.command("");
  assert.match(f.notifications.at(-1).message, /Q1 \[answered\]/);
  await f.command("on");
  assert.equal(f.tool().exposure, "direct");
  assert.ok(f.active().includes("decisions"));
  assert.equal(f.messages.length, 1, "missed answers are delivered on re-enable");
  assert.match(f.messages[0].message.content, /Kept while disabled/);
  f.tick(); assert.equal(f.messages.length, 1);
});

test("disabled context omits automatic decisions messages without mutating transcript history", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Pending" }, "own");
  const reminder = { role: "custom", ...f.handlers.get("before_agent_start")({}, f.ctx).message };
  await f.command("answer Q1 Old answer");
  const answer = { role: "custom", ...f.messages[0].message };
  const user = { role: "user", content: "Continue independent work" };
  await f.command("off");
  const messages = [user, reminder, answer];
  assert.deepEqual(f.handlers.get("context")({ messages }, f.ctx).messages, [user]);
  assert.match(answer.content, /Old answer/);
  assert.equal(messages.length, 3);
});

test("global defaults are observed on requests and polls; explicit session settings take precedence", async (t) => {
  const f = fixture(t); f.start();
  await f.command("status"); assert.match(f.notifications.at(-1).message, /ON.*inherited global default/);
  await f.command("default off");
  assert.deepEqual(f.preferences.read(), { enabled: false });
  assert.ok(!f.active().includes("decisions"));
  await f.command("on");
  assert.deepEqual(f.preferences.read(), { enabled: false });
  await f.command("status"); assert.match(f.notifications.at(-1).message, /ON.*session override; global default OFF/);
  await f.command("inherit");
  assert.ok(!f.active().includes("decisions"));
  f.preferences.write({ enabled: true }); f.tick();
  assert.ok(f.active().includes("decisions"));
  await f.command("off");
  f.preferences.write({ enabled: false }); f.tick();
  f.preferences.write({ enabled: true });
  assert.equal(f.handlers.get("before_agent_start")({}, f.ctx), undefined);
  assert.ok(!f.active().includes("decisions"));
  await f.command("inherit"); assert.ok(f.active().includes("decisions"));
  f.preferences.write({ enabled: false });
  f.handlers.get("context")({ messages: [] }, f.ctx);
  assert.ok(!f.active().includes("decisions"));
});

test("session controls survive restart and branch navigation while new session IDs inherit", async (t) => {
  const f = fixture(t); f.start();
  await f.command("off"); f.start();
  assert.ok(!f.active().includes("decisions"));
  f.handlers.get("session_tree")({}, f.ctx);
  assert.ok(!f.active().includes("decisions"));
  f.ctx.sessionManager.getSessionId = () => "fork"; f.start();
  assert.ok(f.active().includes("decisions"));
  f.ctx.sessionManager.getSessionId = () => "origin"; f.start();
  assert.ok(!f.active().includes("decisions"));
  await f.command("inherit"); assert.ok(f.active().includes("decisions"));
});

test("corrupt defaults disable automation visibly even with a session ON, and recover", async (t) => {
  const f = fixture(t); f.start(); await f.command("on");
  f.preferences.failure = "invalid defaults";
  f.tick(); f.tick();
  assert.equal(f.tool().exposure, "hidden");
  assert.equal(f.notifications.filter((n) => n.level === "error").length, 1);
  assert.match(f.notifications.at(-1).message, /invalid defaults/);
  await f.command("status"); assert.match(f.notifications.at(-1).message, /ERROR/);
  assert.equal(f.handlers.get("before_agent_start")({}, f.ctx), undefined);
  f.preferences.failure = null; f.tick();
  assert.ok(f.active().includes("decisions"));
});

test("invalid controls do not mutate defaults or session records; write failures never report success", async (t) => {
  const f = fixture(t); f.start();
  for (const text of ["on extra", "off extra", "inherit extra", "default", "default yes", "default on extra", "status extra"]) {
    await f.command(text);
    assert.equal(f.entries.length, 0, text);
    assert.deepEqual(f.preferences.read(), { enabled: true }, text);
    assert.equal(f.notifications.at(-1).level, "error", text);
  }
  f.preferences.write = () => { throw new Error("write denied"); };
  await f.command("default off");
  assert.match(f.notifications.at(-1).message, /write denied/);
  assert.equal(f.notifications.at(-1).level, "error");
});

test("toggle completions remain available without questions and include default values", async (t) => {
  const f = fixture(t); f.start();
  assert.ok(f.completions("").some((item) => item.value === "off"));
  assert.deepEqual(f.completions("default ").map((item) => item.value), ["default on", "default off"]);
  await f.command("off");
  assert.ok(f.completions("sta").some((item) => item.value === "status"));
});

test("OFF clears a pending badge during a storage outage; settings work after project binding failure", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Pending" }, "own");
  f.setUnavailable(true);
  await f.command("off");
  assert.equal(f.widgets.at(-1)[1], undefined);
  assert.equal(f.tool().exposure, "hidden");
  assert.equal(f.notifications.at(-1).level, "info");
  f.failProject(); assert.throws(() => f.start(), /project resolution/);
  await f.command("default off");
  assert.deepEqual(f.preferences.read(), { enabled: false });
  await f.command("status"); assert.match(f.notifications.at(-1).message, /OFF/);
});

test("a failed project binding cannot retain enabled automation from the previous session", async (t) => {
  const f = fixture(t); f.start();
  await f.call({ action: "ask", question: "Pending" }, "own");
  f.preferences.write({ enabled: false });
  f.ctx.sessionManager.getSessionId = () => "replacement";
  f.failProject(); assert.throws(() => f.start(), /project resolution/);
  assert.equal(f.tool().exposure, "hidden");
  assert.equal(f.widgets.at(-1)[1], undefined);
});

test("status and ordinary refreshes respect manual tool deactivation; ON and tree reconcile it", async (t) => {
  const f = fixture(t); f.start();
  f.setActive(["bash"]);
  await f.command("status"); f.tick();
  f.handlers.get("context")({ messages: [] }, f.ctx);
  assert.deepEqual(f.active(), ["bash"]);
  await f.command("on"); assert.ok(f.active().includes("decisions"));
  f.setActive(["bash"]);
  f.handlers.get("session_tree")({}, f.ctx);
  assert.ok(f.active().includes("decisions"));
});

test("corrupt session override stops automation and a later explicit setting repairs it", async (t) => {
  const f = fixture(t); f.start();
  f.entries.push({ type: "custom", customType: "ponygirls.decisions.setting", data: { version: 1, sessionId: "origin", enabled: "false" } });
  f.tick();
  assert.equal(f.tool().exposure, "hidden");
  assert.match(f.notifications.at(-1).message, /session setting/);
  await f.command("inherit");
  assert.ok(f.active().includes("decisions"));
  f.pi.appendEntry = () => { throw new Error("append denied"); };
  await f.command("off");
  assert.equal(f.notifications.at(-1).level, "error");
  assert.match(f.notifications.at(-1).message, /append denied/);
  assert.ok(f.active().includes("decisions"));
});

// Behavioral-Active × Blackbox × Group; regression: a badge could open but not close its pane.
test("badge toggles the inbox, while command/Esc and shutdown share its lifecycle", async (t) => {
  const f = fixture(t);
  f.ctx.mode = "tui";
  const theme = { bg: (_color, text) => text, fg: (_color, text) => text, bold: (text) => text };
  let opens = 0;
  let closes = 0;
  let pane;
  f.ctx.ui.custom = (factory) => new Promise((resolve) => {
    opens += 1;
    pane = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, {}, () => { closes += 1; resolve(); });
  });
  f.start();
  await f.call({ action: "ask", question: "Proceed?" }, "toggle-question");
  const badge = f.widgets.at(-1)[1]({ requestRender() {} }, theme);
  const click = () => badge.handleMouse({ type: "click", button: "left" });
  assert.equal(badge.handleMouse({ type: "click", button: "right" }), undefined);
  assert.equal(opens, 0);
  click();
  assert.equal(opens, 1);
  click();
  assert.equal(closes, 1, "second badge click must invoke the custom completion callback");
  await new Promise((resolve) => setImmediate(resolve));
  const command = f.command("");
  assert.equal(opens, 2);
  click();
  assert.equal(closes, 2, "badge closes a command-opened pane too");
  await command;
  click();
  pane.handleInput("\x1b");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closes, 3);
  click();
  f.handlers.get("session_shutdown")({}, f.ctx);
  assert.equal(closes, 4);
  click();
  assert.equal(opens, 4, "a retained old badge cannot reopen a disposed session");
});

function mountedBadges(f) {
  const theme = { bg: (_color, text) => text, fg: (_color, text) => text, bold: (text) => text };
  const publish = f.ctx.ui.setWidget;
  let component;
  let renders = 0;
  f.ctx.ui.setWidget = (key, factory, options) => {
    component?.dispose?.();
    publish(key, factory, options);
    component = factory === undefined ? undefined : factory({ requestRender() { renders++; } }, theme);
  };
  return { theme, current: () => component, renders: () => renders };
}

// Regression: periodic publication replaced the pressed registration even when its owner was unchanged.
test("same-owner polling preserves registration while counts, external revisions and pane ages advance", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-06T15:00:00Z") });
  const f = fixture(t), mounted = mountedBadges(f);
  f.ctx.mode = "tui";
  let pane;
  f.ctx.ui.custom = (factory) => new Promise((resolve) => {
    pane = factory({ terminal: { rows: 24 }, requestRender() {} }, mounted.theme, {}, resolve);
  });
  f.start();
  await f.call({ action: "ask", question: "Original" }, "own");
  const badge = mounted.current(), count = f.widgets.length;
  f.tick();
  assert.equal(f.widgets.length, count, "unchanged polling must not replace the registered component");
  assert.equal(mounted.current(), badge);
  const external = new SqliteDecisionStore(f.path);
  t.after(() => external.close());
  external.ask("project-a", { question: "Other", context: "", options: [], recommendation: "", sessionId: "other", toolCallId: "other" });
  f.tick();
  assert.equal(mounted.current(), badge);
  assert.match(badge.render(100)[0], /1\+1/);
  assert.match(badge.renderCompact(20), /1\+1/);
  assert.ok(mounted.renders() > 0);
  badge.handleMouse({ type: "click", button: "left" });
  t.mock.timers.tick(60_000);
  f.tick();
  assert.match(pane.render(120).join("\n"), /created 1m ago/);
  external.resolve("project-a", "Q1", 1, "answered", "External answer");
  f.tick();
  assert.equal(mounted.current(), badge);
  assert.match(badge.render(100)[0], /0\+1/);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].message.content, /External answer/);
});

test("hiding a registration revokes its callback without closing its pane; reappearance and owner replacement are fresh", async (t) => {
  const f = fixture(t), mounted = mountedBadges(f);
  f.ctx.mode = "tui";
  let opens = 0, closes = 0;
  f.ctx.ui.custom = (factory) => new Promise((resolve) => {
    opens++;
    factory({ terminal: { rows: 24 }, requestRender() {} }, mounted.theme, {}, () => { closes++; resolve(); });
  });
  f.start(); await f.call({ action: "ask", question: "Question" }, "own");
  const old = mounted.current();
  old.handleMouse({ type: "click", button: "left" });
  await f.command("dismiss Q1");
  assert.equal(mounted.current(), undefined);
  assert.equal(closes, 0, "zero pending questions must not close an existing inbox");
  old.handleMouse({ type: "click", button: "left" });
  assert.equal(closes, 0, "hidden registration must not toggle the still-live controller");
  await f.command("reopen Q1");
  const next = mounted.current();
  assert.notEqual(next, old);
  next.handleMouse({ type: "click", button: "left" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closes, 1);
  const beforeOwner = mounted.current();
  f.start();
  assert.notEqual(mounted.current(), beforeOwner);
  beforeOwner.handleMouse({ type: "click", button: "left" });
  assert.equal(opens, 1);
  mounted.current().handleMouse({ type: "click", button: "left" });
  assert.equal(opens, 2);
});

test("stale context polling without shutdown disposes the registration and stops its watcher", async (t) => {
  const f = fixture(t), mounted = mountedBadges(f);
  f.start(); await f.call({ action: "ask", question: "Question" }, "own");
  const old = mounted.current();
  const ui = f.ctx.ui;
  Object.defineProperty(f.ctx, "hasUI", { get() { throw new Error("This extension ctx is stale after reload"); } });
  f.tick();
  assert.equal(f.watching(), false);
  let opens = 0;
  ui.custom = async () => { opens++; };
  old.handleMouse({ type: "click", button: "left" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(opens, 0);
});

test("a stale badge click stops its old owner without notifying through its UI", async (t) => {
  const f = fixture(t), mounted = mountedBadges(f);
  f.ctx.mode = "tui";
  f.start(); await f.call({ action: "ask", question: "Question" }, "own");
  Object.defineProperty(f.ctx, "mode", { get() { throw new Error("This extension ctx is stale after reload"); } });
  mounted.current().handleMouse({ type: "click", button: "left" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.watching(), false);
  assert.deepEqual(f.notifications, [], "expired context cleanup must not call its UI");
});

// BG regression: toggle grammar must use the same full-prefix replacement as IDs.
test('toggle completion preserves whitespace, nested defaults, and survives storage failure', (t) => {
  const f = fixture(t); f.start();
  const values = prefix => f.completions(prefix)?.map(item => item.value) ?? null;
  assert.deepEqual(values('def'), ['default ']);
  assert.deepEqual(values('  DEFAULT\to'), ['  DEFAULT\ton', '  DEFAULT\toff']);
  f.setUnavailable(true);
  assert.deepEqual(values('default  o'), ['default  on', 'default  off']);
  assert.deepEqual(values('ans'), ['answer ']);
  assert.equal(values('answer '), null, 'unavailable IDs must not be invented');
  assert.equal(values('default on '), null);
  assert.equal(values('answer Q1 free text '), null);
});
