// Step 6: completion delivery through the actual Pi extension path — the real
// extension and supervisor in a scripted, provider-free Pi runtime.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { contextLabels, createRuntime, customEntries, deferred, recordingUi, scriptedModel, sdk, tempDir, text, waitFor } from "./harness.mjs";

const EXTENSION = resolve(import.meta.dirname, "../index.ts");
const TYPE = "bg-task-completion";
const SETTLE_QUIET_MS = 1200;

const spawnCall = (id, command, notify = true, label = id) => ({ type: "toolCall", id, name: "bg_task", arguments: { action: "spawn", label, command, cwd: "/", notify } });
const holdCall = (id) => ({ type: "toolCall", id, name: "hold", arguments: {} });
const reply = (...content) => ({ content });
const isNotice = (request) => contextLabels(request).at(-1)?.startsWith("user:[bg-task]");

function holdExtension(state) {
  return (pi) => {
    pi.on("agent_settled", () => { state.settles++; });
    pi.registerTool({
      name: "hold", label: "hold", description: "Waits for the test", parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute(_id, _params, signal) {
        await new Promise((res) => {
          state.release = res;
          signal?.addEventListener("abort", res, { once: true });
        });
        return { content: [{ type: "text", text: "held" }], details: undefined };
      },
    });
  };
}

async function setup(t, script, { dir = tempDir(t, "bg-delivery-"), sessionManager, ui, settings } = {}) {
  const hold = { release: null, settles: 0 };
  const model = scriptedModel(script);
  const rt = await createRuntime(t, { dir, model, extensionPaths: [EXTENSION], extensionFactories: [holdExtension(hold)], sessionManager, uiContext: ui?.ui, settings });
  rt.session.setActiveToolsByName(["bg_task", "hold"]);
  return { dir, hold, model, rt };
}

function sidecarOf(session) {
  return `${session.sessionManager.getSessionFile()}.bg-tasks`;
}

function registry(session) {
  return Object.fromEntries(JSON.parse(readFileSync(join(sidecarOf(session), "tasks.json"), "utf8")).tasks.map((t) => [t.id, t]));
}

function taskIdsFromResults(session) {
  return session.sessionManager.getEntries()
    .filter((e) => e.type === "message" && e.message.role === "toolResult" && e.message.toolName === "bg_task" && e.message.details?.action === "spawn")
    .map((e) => e.message.details.task.id);
}

/** Task IDs in creation order, read from the sidecar (tool results of a parallel batch persist only after the batch). */
function registeredIds(session) {
  try {
    return Object.values(registry(session)).sort((a, b) => a.seq - b.seq).map((t) => t.id);
  } catch {
    return [];
  }
}

function deliveredEvents(session) {
  return customEntries(session, TYPE).flatMap((e) => e.details.events.map((ev) => ev.eventId));
}

async function taskFinished(session, id) {
  return waitFor(() => registry(session)[id]?.state !== "running" && registry(session)[id], { message: `${id} to finish` });
}

async function receipt(session, id) {
  return waitFor(() => registry(session)[id]?.event?.status === "received", { message: `receipt for ${id}` });
}

const quiet = (ms = SETTLE_QUIET_MS) => new Promise((r) => setTimeout(r, ms));

test("idle completion posts a displayed custom message and starts exactly one follow-up turn", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? reply(spawnCall("s1", "sleep 0.3; echo finished")) : r.index === 2 ? text("waiting") : isNotice(r) ? text("ack") : null));
  await f.rt.session.prompt("start");
  assert.equal(f.model.requests.length, 2);
  const [id] = taskIdsFromResults(f.rt.session);
  await waitFor(() => customEntries(f.rt.session, TYPE).length === 1 && f.model.requests.length === 3, { message: "idle notice" });
  await f.rt.session.waitForIdle();
  const [entry] = customEntries(f.rt.session, TYPE);
  assert.equal(entry.display, true);
  assert.equal(entry.details.schemaVersion, 1);
  assert.equal(entry.details.sessionId, f.rt.session.sessionManager.getSessionId());
  assert.deepEqual(entry.details.events.map((e) => [e.taskId, e.state, e.reason]), [[id, "completed", "exit"]]);
  assert.ok(entry.details.events[0].logPath.startsWith("/"));
  const textContent = entry.content.map((p) => p.text).join("");
  assert.match(textContent, /completed/);
  assert.doesNotMatch(textContent, /finished\r?\n/, "no raw output tail");
  await receipt(f.rt.session, id);
  await quiet();
  assert.equal(f.model.requests.length, 3);
  assert.deepEqual(f.rt.errors, []);
});

test("a completion during an active tool waits for the foreground work and keeps call/result order", async (t) => {
  const f = await setup(t, (r) => {
    if (r.index === 1) return reply(spawnCall("s1", "echo quick"), holdCall("h1"));
    if (isNotice(r)) return text("ack");
    return text("fg done");
  });
  const run = f.rt.session.prompt("go");
  await waitFor(() => registeredIds(f.rt.session).length === 1 && f.hold.release, { message: "spawn + hold" });
  const [id] = registeredIds(f.rt.session);
  await taskFinished(f.rt.session, id);
  await quiet(400);
  assert.equal(f.model.requests.length, 1, "no inference while the tool is active");
  f.hold.release();
  await run;
  await f.rt.session.waitForIdle();
  assert.deepEqual(contextLabels(f.model.requests[1]), ["user:go", "assistant:call(s1),call(h1)", "result(s1)", "result(h1)"]);
  const last = contextLabels(f.model.requests[2]);
  assert.deepEqual(last.slice(0, 5), ["user:go", "assistant:call(s1),call(h1)", "result(s1)", "result(h1)", "assistant:fg done"]);
  assert.ok(last[5].startsWith("user:[bg-task]"));
  assert.equal(f.model.requests.length, 3);
  await receipt(f.rt.session, id);
  assert.deepEqual(f.rt.errors, []);
});

test("several tasks finishing together are each represented once without competing prompts", async (t) => {
  const f = await setup(t, (r) => {
    if (r.index === 1) return reply(spawnCall("a", "echo a"), spawnCall("b", "echo b"), spawnCall("c", "exit 4"), holdCall("h"));
    return isNotice(r) ? text("ack") : text("fg done");
  });
  const run = f.rt.session.prompt("go");
  await waitFor(() => registeredIds(f.rt.session).length === 3 && f.hold.release, { message: "spawns" });
  const ids = registeredIds(f.rt.session);
  for (const id of ids) await taskFinished(f.rt.session, id);
  f.hold.release();
  await run;
  for (const id of ids) await receipt(f.rt.session, id);
  await f.rt.session.waitForIdle();
  const events = deliveredEvents(f.rt.session);
  assert.equal(events.length, 3);
  assert.equal(new Set(events).size, 3);
  assert.deepEqual(new Set(events.map((e) => e.split(":")[0])), new Set(ids));
  assert.deepEqual(f.rt.errors, []);
});

test("notify:false produces no notice and no inference, but the task stays inspectable", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? reply(spawnCall("s", "echo muted", false)) : r.index === 2 ? text("ok") : null));
  await f.rt.session.prompt("go");
  const [id] = taskIdsFromResults(f.rt.session);
  const done = await taskFinished(f.rt.session, id);
  assert.equal(done.state, "completed");
  await quiet();
  assert.equal(customEntries(f.rt.session, TYPE).length, 0);
  assert.equal(f.model.requests.length, 2);
  assert.equal(registry(f.rt.session)[id].event.status, "pending");
});

test("an interactive abort drops the queued notice; it is deferred without re-wake and delivered after the next input", async (t) => {
  const ui = recordingUi();
  const f = await setup(t, (r) => {
    if (r.index === 1) return reply(spawnCall("s", "echo quick"), holdCall("h"));
    if (isNotice(r)) return text("ack");
    return text(`reply ${r.index}`);
  }, { ui });
  const run = f.rt.session.prompt("go");
  await waitFor(() => registeredIds(f.rt.session).length === 1 && f.hold.release, { message: "spawn" });
  const [id] = registeredIds(f.rt.session);
  await taskFinished(f.rt.session, id);
  await quiet(400);
  f.rt.session.clearQueue();
  await f.rt.session.abort();
  await run;
  await quiet();
  assert.equal(customEntries(f.rt.session, TYPE).length, 0);
  const before = f.model.requests.length;
  assert.equal(before, 1, "no automatic re-wake after an abort");
  assert.deepEqual(ui.notifications.filter((n) => /DELIVERY_UNCONFIRMED/.test(n.message)), [], "an abort is a quiet per-event deferral, not an unconfirmed delivery");
  await f.rt.session.prompt("next");
  await waitFor(() => customEntries(f.rt.session, TYPE).length === 1, { message: "deferred notice after input" });
  await receipt(f.rt.session, id);
  await f.rt.session.waitForIdle();
  assert.equal(deliveredEvents(f.rt.session).length, 1);
});

test("after an SDK abort the original queue item is consumed later and reconciled; an independent completion still notifies", async (t) => {
  const f = await setup(t, (r) => {
    if (r.index === 1) return reply(spawnCall("s", "echo quick"), spawnCall("later", "sleep 1.5; echo later"), holdCall("h"));
    if (isNotice(r)) return text("ack");
    return text(`reply ${r.index}`);
  });
  const run = f.rt.session.prompt("go");
  await waitFor(() => registeredIds(f.rt.session).length === 2 && f.hold.release, { message: "spawns" });
  const [first, later] = registeredIds(f.rt.session);
  await taskFinished(f.rt.session, first);
  await quiet(400);
  await f.rt.session.abort();
  await run;
  // The independent later completion wakes the agent normally.
  await taskFinished(f.rt.session, later);
  await receipt(f.rt.session, later);
  await receipt(f.rt.session, first);
  await f.rt.session.waitForIdle();
  await quiet();
  const events = deliveredEvents(f.rt.session);
  assert.equal(events.filter((e) => e.startsWith(first)).length, 1, `exactly one delivery of the deferred notice: ${events}`);
  assert.equal(events.filter((e) => e.startsWith(later)).length, 1);
  assert.deepEqual(f.rt.errors, []);
});

test("a custom follow-up dropped before successful settlement gets one reconciled retry", async (t) => {
  const f = await setup(t, (r) => {
    if (r.index === 1) return reply(spawnCall("s", "echo quick"), holdCall("h"));
    return isNotice(r) ? text("ack") : text("fg done");
  });
  const run = f.rt.session.prompt("go");
  await waitFor(() => registeredIds(f.rt.session).length === 1 && f.hold.release, { message: "spawn" });
  const [id] = registeredIds(f.rt.session);
  await taskFinished(f.rt.session, id);
  await quiet(400);
  f.rt.session.clearQueue();
  f.hold.release();
  await run;
  assert.equal(customEntries(f.rt.session, TYPE).length, 0, "the queued item was dropped");
  await receipt(f.rt.session, id);
  await f.rt.session.waitForIdle();
  assert.equal(deliveredEvents(f.rt.session).length, 1);
  assert.equal(f.hold.settles, 2, "delivered by one bounded retry run at quiescence");
  assert.deepEqual(f.rt.errors, []);
});

test("a notification that never starts a run surfaces DELIVERY_UNCONFIRMED; independent completions proceed; input retries it", async (t) => {
  const ui = recordingUi();
  const f = await setup(t, (r) => {
    if (r.index === 1) return reply(spawnCall("s", "sleep 0.3; echo one"), spawnCall("t", "sleep 5; echo two"));
    return isNotice(r) ? text("ack") : text(`reply ${r.index}`);
  }, { ui });
  const session = f.rt.session;
  const original = session._runAgentPrompt.bind(session);
  let failures = 0;
  session._runAgentPrompt = async (messages) => {
    if (failures === 0 && !Array.isArray(messages) && messages.customType === TYPE) {
      failures++;
      throw new Error("injected asynchronous no-start failure");
    }
    return original(messages);
  };
  await session.prompt("go");
  const [first, second] = taskIdsFromResults(session);
  await taskFinished(session, first);
  await waitFor(() => ui.notifications.some((n) => /DELIVERY_UNCONFIRMED/.test(n.message)), { message: "unconfirmed surfaced", timeoutMs: 8000 });
  assert.equal(customEntries(session, TYPE).length, 0);
  assert.equal(registry(session)[first].event.status, "pending", "retained, not claimed received");
  await quiet();
  assert.equal(customEntries(session, TYPE).length, 0, "no retry loop on timeout");
  await taskFinished(session, second);
  await receipt(session, second);
  assert.deepEqual(deliveredEvents(session).map((e) => e.split(":")[0]), [second]);
  await session.waitForIdle();
  await session.prompt("hello again");
  await receipt(session, first);
  await session.waitForIdle();
  assert.equal(deliveredEvents(session).filter((e) => e.startsWith(first)).length, 1);
});

test("muting an in-flight notice cannot retract it and does not block later notices", async (t) => {
  const f = await setup(t, (r) => {
    if (r.index === 1) return reply(spawnCall("a", "echo a"), spawnCall("b", "sleep 1.5; echo b"), holdCall("h"));
    if (r.index === 2) {
      const ids = r.context.messages.filter((m) => m.role === "toolResult" && m.toolName === "bg_task").map((m) => m.details.task.id);
      return reply({ type: "toolCall", id: "mute", name: "bg_task", arguments: { action: "notify", id: ids[0], enabled: false } });
    }
    return isNotice(r) ? text("ack") : text("done");
  });
  const run = f.rt.session.prompt("go");
  await waitFor(() => registeredIds(f.rt.session).length === 2 && f.hold.release, { message: "spawns" });
  const [a, b] = registeredIds(f.rt.session);
  await taskFinished(f.rt.session, a);
  await quiet(400);
  f.hold.release();
  await run;
  await taskFinished(f.rt.session, b);
  await receipt(f.rt.session, b);
  await f.rt.session.waitForIdle();
  const events = deliveredEvents(f.rt.session);
  assert.equal(events.filter((e) => e.startsWith(b)).length, 1);
  assert.ok(events.filter((e) => e.startsWith(a)).length <= 1);
  assert.equal(registry(f.rt.session)[a].notify, false);
});

async function resumeRuntime(t, dir, sessionFile, script) {
  const sessionManager = sdk.SessionManager.open(sessionFile, join(dir, "sessions"));
  return setup(t, script, { dir, sessionManager });
}

test("crash windows: a pending event committed but never submitted is delivered on resume", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? reply(spawnCall("s", "sleep 30")) : text("started")));
  await f.rt.session.prompt("go");
  const [id] = taskIdsFromResults(f.rt.session);
  const file = f.rt.session.sessionManager.getSessionFile();
  await f.rt.dispose();
  const done = JSON.parse(readFileSync(`${file}.bg-tasks/tasks.json`, "utf8")).tasks.find((x) => x.id === id);
  assert.deepEqual([done.state, done.reason, done.reasonDetail, done.event.status], ["failed", "session_shutdown", "quit", "pending"]);
  const g = await resumeRuntime(t, f.dir, file, (r) => (isNotice(r) ? text("ack") : null));
  await receipt(g.rt.session, id);
  await g.rt.session.waitForIdle();
  assert.deepEqual(deliveredEvents(g.rt.session), [done.event.id]);
});

test("crash windows: a submitted notice lost before session persistence is delivered on resume", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? reply(spawnCall("s", "echo quick"), holdCall("h")) : text("x")));
  const run = f.rt.session.prompt("go");
  await waitFor(() => registeredIds(f.rt.session).length === 1 && f.hold.release, { message: "spawn" });
  const [id] = registeredIds(f.rt.session);
  await taskFinished(f.rt.session, id);
  await quiet(400);
  const file = f.rt.session.sessionManager.getSessionFile();
  await f.rt.dispose();
  await run.catch(() => undefined);
  assert.equal(customEntries(f.rt.session, TYPE).length, 0);
  const g = await resumeRuntime(t, f.dir, file, (r) => (isNotice(r) ? text("ack") : null));
  await receipt(g.rt.session, id);
  assert.equal(deliveredEvents(g.rt.session).length, 1);
});

test("crash windows: a persisted notice whose receipt commit was lost is reconciled without duplication", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? reply(spawnCall("s", "echo quick")) : isNotice(r) ? text("ack") : text("waiting")));
  await f.rt.session.prompt("go");
  const [id] = taskIdsFromResults(f.rt.session);
  await receipt(f.rt.session, id);
  await f.rt.session.waitForIdle();
  const file = f.rt.session.sessionManager.getSessionFile();
  await f.rt.dispose();
  const regPath = `${file}.bg-tasks/tasks.json`;
  const reg = JSON.parse(readFileSync(regPath, "utf8"));
  reg.tasks.find((x) => x.id === id).event.status = "pending";
  writeFileSync(regPath, JSON.stringify(reg));
  const g = await resumeRuntime(t, f.dir, file, () => null);
  await receipt(g.rt.session, id);
  await quiet();
  assert.equal(deliveredEvents(g.rt.session).length, 1);
  assert.equal(g.model.requests.length, 0);
});

test("crash windows: a receipt whose session entry was lost from the file restores the notice", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? reply(spawnCall("s", "echo quick")) : isNotice(r) ? text("ack") : text("waiting")));
  await f.rt.session.prompt("go");
  const [id] = taskIdsFromResults(f.rt.session);
  await receipt(f.rt.session, id);
  await f.rt.session.waitForIdle();
  const file = f.rt.session.sessionManager.getSessionFile();
  await f.rt.dispose();
  const kept = readFileSync(file, "utf8").split("\n").filter((line) => !line.includes(`"customType":"${TYPE}"`));
  writeFileSync(file, kept.join("\n"));
  const g = await resumeRuntime(t, f.dir, file, (r) => (isNotice(r) ? text("ack again") : null));
  await waitFor(() => deliveredEvents(g.rt.session).length === 1, { message: "restored notice" });
  await receipt(g.rt.session, id);
  await g.rt.session.waitForIdle();
  assert.equal(readFileSync(file, "utf8").split("\n").filter((l) => l.includes(`"customType":"${TYPE}"`)).length, 1);
});

test("switching or forking sessions never transfers task authority or notices", async (t) => {
  const f = await setup(t, (r) => {
    if (r.index === 1) return reply(spawnCall("s", "sleep 30"));
    if (isNotice(r)) return text("ack");
    return text("ok");
  });
  await f.rt.session.prompt("go");
  const [id] = taskIdsFromResults(f.rt.session);
  const fileA = f.rt.session.sessionManager.getSessionFile();
  const firstUser = f.rt.session.sessionManager.getEntries().find((e) => e.type === "message" && e.message.role === "user");
  await f.rt.runtime.newSession();
  const b = f.rt.session;
  assert.notEqual(b.sessionManager.getSessionFile(), fileA);
  const outcome = JSON.parse(readFileSync(`${fileA}.bg-tasks/tasks.json`, "utf8")).tasks[0];
  assert.deepEqual([outcome.state, outcome.reason, outcome.reasonDetail], ["failed", "session_shutdown", "new"]);
  await quiet();
  assert.equal(customEntries(b, TYPE).length, 0, "no notice routed into the new session");
  assert.equal(f.model.requests.length, 2);
  // Back in A, its retained notice is delivered there.
  await f.rt.runtime.switchSession(fileA);
  const a = f.rt.session;
  await receipt(a, id);
  assert.equal(customEntries(a, TYPE).length, 1);
  // A fork gets a new session file and sidecar: no inherited tasks.
  await f.rt.runtime.fork(firstUser.id);
  const forked = f.rt.session;
  assert.notEqual(forked.sessionManager.getSessionFile(), fileA);
  await quiet();
  const forkedNotices = customEntries(forked, TYPE).filter((e) => !customEntries(a, TYPE).some((x) => x.id === e.id));
  assert.equal(forkedNotices.length, 0);
});

test("/reload stops active tasks, retains logs, re-registers one tool, and delivers the retained notice", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? reply(spawnCall("s", "echo before; sleep 30")) : isNotice(r) ? text("ack") : text("ok")));
  await f.rt.session.prompt("go");
  const [id] = taskIdsFromResults(f.rt.session);
  await waitFor(() => registry(f.rt.session)[id].logBytes > 0 || readFileSync(join(sidecarOf(f.rt.session), "tasks", id, "terminal.log"), "utf8").includes("before"), { message: "output" });
  await f.rt.session.reload();
  f.rt.session.setActiveToolsByName(["bg_task", "hold"]);
  const done = registry(f.rt.session)[id];
  assert.deepEqual([done.state, done.reason, done.reasonDetail], ["failed", "session_shutdown", "reload"]);
  assert.match(readFileSync(join(sidecarOf(f.rt.session), "tasks", id, "terminal.log"), "utf8"), /before/);
  assert.equal(f.rt.session.getAllTools().filter((tool) => tool.name === "bg_task").length, 1);
  await receipt(f.rt.session, id);
  assert.equal(deliveredEvents(f.rt.session).length, 1);
});

test("an idle completion during manual compaction waits until compaction ends", async (t) => {
  const summary = deferred();
  let compacting = false;
  const f = await setup(t, async (r) => {
    if (r.index === 1) return reply(spawnCall("s", "sleep 0.5; echo x"));
    if (compacting) {
      await summary.promise;
      return text("summary");
    }
    if (isNotice(r)) return text("ack");
    return text(`long reply ${r.index} ${"y".repeat(4000)}`);
  }, { settings: { compaction: { enabled: false, keepRecentTokens: 10 } } });
  await f.rt.session.prompt("go");
  await f.rt.session.prompt("more");
  await f.rt.session.prompt("more again");
  const [id] = taskIdsFromResults(f.rt.session);
  compacting = true;
  const compaction = f.rt.session.compact();
  await taskFinished(f.rt.session, id);
  await quiet(600);
  const requestsDuring = f.model.requests.filter((r) => isNotice(r)).length;
  compacting = false;
  summary.resolve();
  await compaction;
  assert.equal(requestsDuring, 0, "no notification run during compaction");
  await receipt(f.rt.session, id);
  assert.deepEqual(f.rt.errors, []);
});

test("an automatic provider retry of the notification response delivers once", async (t) => {
  let failedOnce = false;
  const f = await setup(t, (r) => {
    if (r.index === 1) return reply(spawnCall("s", "echo quick"));
    if (r.index === 2) return text("waiting");
    if (isNotice(r) && !failedOnce) {
      failedOnce = true;
      return { content: [], stopReason: "error", errorMessage: "503 service unavailable: overloaded" };
    }
    return text("ack");
  }, { settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 5 } } });
  await f.rt.session.prompt("go");
  const [id] = taskIdsFromResults(f.rt.session);
  await receipt(f.rt.session, id);
  await f.rt.session.waitForIdle();
  await quiet();
  assert.equal(deliveredEvents(f.rt.session).length, 1);
  assert.ok(failedOnce);
  assert.equal(f.model.requests.length, 4);
});

test("a session switch never wakes the closing runtime with a notice released by the teardown abort", async (t) => {
  const f = await setup(t, (r) => {
    if (r.index === 1) return reply(spawnCall("a", "echo a"), spawnCall("b", "sleep 0.8; echo b"), holdCall("h"));
    return isNotice(r) ? text("ack") : text("ok");
  });
  const run = f.rt.session.prompt("go");
  await waitFor(() => registeredIds(f.rt.session).length === 2 && f.hold.release, { message: "spawns" });
  const [a, b] = registeredIds(f.rt.session);
  await taskFinished(f.rt.session, a);
  await taskFinished(f.rt.session, b);
  await quiet(400);
  const fileA = f.rt.session.sessionManager.getSessionFile();
  const before = f.model.requests.length;
  await f.rt.runtime.newSession();
  await run.catch(() => undefined);
  await quiet();
  assert.equal(f.model.requests.length, before, "no model turn was started in the closing or the new session");
  assert.equal(customEntries(f.rt.session, TYPE).length, 0);
  await f.rt.runtime.switchSession(fileA);
  await receipt(f.rt.session, a);
  await receipt(f.rt.session, b);
});

test("an action missing its required fields fails the tool call with the fields it needs", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? reply({ type: "toolCall", id: "bad", name: "bg_task", arguments: { action: "spawn", label: "x", command: "true" } }) : text("done")));
  await f.rt.session.prompt("go");
  const result = f.rt.session.sessionManager.getEntries().find((e) => e.type === "message" && e.message.role === "toolResult");
  assert.equal(result.message.isError, true);
  assert.match(result.message.content.map((p) => p.text).join(""), /INVALID_REQUEST.*spawn.*(cwd|notify)/s);
});
