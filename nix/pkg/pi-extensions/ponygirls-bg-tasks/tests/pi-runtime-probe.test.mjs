// Step 1 probes: settle the pinned Pi 1.0.0 delivery semantics that the
// completion sender depends on, through the actual pi.sendMessage() path.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contextLabels, createRuntime, customEntries, deferred, scriptedModel, tempDir, text, toolCall, waitFor } from "./harness.mjs";

const PROBE_TYPE = "bg-probe";

function probeExtension(hold) {
  const probe = { pi: null, ctx: null, events: [], fileHadEntryAtMessageEnd: [] };
  const factory = (pi) => {
    probe.pi = pi;
    pi.registerTool({
      name: "hold",
      label: "hold",
      description: "Waits for the test",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        await hold.current.promise;
        return { content: [{ type: "text", text: "held" }], details: undefined };
      },
    });
    pi.on("session_start", (_e, ctx) => { probe.ctx = ctx; });
    pi.on("agent_start", () => probe.events.push("agent_start"));
    pi.on("turn_end", (e) => probe.events.push(`turn_end:${e.outcome}`));
    pi.on("agent_end", (e) => {
      const last = [...e.messages].reverse().find((m) => m.role === "assistant");
      probe.events.push(`agent_end:${last?.stopReason ?? "none"}`);
    });
    pi.on("agent_before_settle", (e) => probe.events.push(`before_settle:${e.outcome}`));
    pi.on("agent_settled", () => probe.events.push("settled"));
    pi.on("input", (e) => probe.events.push(`input:${e.source}`));
    pi.on("message_end", (e, ctx) => {
      if (e.message.role === "custom" && e.message.customType === PROBE_TYPE) {
        const file = ctx.sessionManager.getSessionFile();
        let raw = "";
        try { raw = readFileSync(file, "utf8"); } catch { raw = ""; }
        probe.fileHadEntryAtMessageEnd.push(raw.includes(e.message.details.id));
      }
    });
  };
  return { probe, factory };
}

function send(probe, id, options = { deliverAs: "followUp", triggerTurn: true }) {
  probe.pi.sendMessage({ customType: PROBE_TYPE, content: [{ type: "text", text: `probe ${id}` }], display: true, details: { id } }, options);
}

async function setup(t, script) {
  const dir = tempDir(t, "bg-probe-");
  const hold = { current: deferred() };
  const { probe, factory } = probeExtension(hold);
  const model = scriptedModel(script);
  const rt = await createRuntime(t, { dir, model, extensionFactories: [factory] });
  rt.session.setActiveToolsByName(["hold"]);
  return { dir, hold, probe, model, rt };
}

test("probe: idle followUp+triggerTurn displays a custom message and starts exactly one follow-up response", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? text("first") : text("reacted")));
  await f.rt.session.prompt("hello");
  f.probe.events.length = 0;
  send(f.probe, "idle-1");
  await waitFor(() => f.probe.events.includes("settled"), { message: "settle" });
  assert.equal(f.model.requests.length, 2);
  assert.deepEqual(contextLabels(f.model.requests[1]).slice(-1), ["user:probe idle-1"]);
  const entries = customEntries(f.rt.session, PROBE_TYPE);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].display, true);
  // Extension message_end runs before the session persists the entry.
  assert.deepEqual(f.probe.fileHadEntryAtMessageEnd, [false]);
  // By agent_settled the entry is in the session file.
  assert.ok(readFileSync(f.rt.session.sessionManager.getSessionFile(), "utf8").includes("idle-1"));
  assert.deepEqual(f.probe.events, ["agent_start", "turn_end:completed", "agent_end:stop", "before_settle:completed", "settled"]);
});

test("probe: during an active tool, followUp waits for the foreground work and keeps call/result order", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? toolCall("c1", "hold", {}) : r.index === 2 ? text("tool done") : text("saw completion")));
  const run = f.rt.session.prompt("go");
  await waitFor(() => f.model.requests.length === 1, { message: "tool call" });
  await new Promise((r) => setTimeout(r, 50));
  send(f.probe, "active-1");
  assert.equal(f.probe.ctx.hasPendingMessages(), false, "hasPendingMessages() does not count custom follow-ups");
  f.hold.current.resolve();
  await run;
  assert.equal(f.model.requests.length, 3);
  assert.deepEqual(contextLabels(f.model.requests[1]), ["user:go", "assistant:call(c1)", "result(c1)"]);
  assert.deepEqual(contextLabels(f.model.requests[2]), ["user:go", "assistant:call(c1)", "result(c1)", "assistant:tool done", "user:probe active-1"]);
  assert.equal(f.probe.events.filter((e) => e === "settled").length, 1);
});

test("probe: SDK abort skips agent_before_settle; a queued custom follow-up stays in the agent queue", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? toolCall("c1", "hold", {}) : r.index === 2 ? { waitForAbort: true } : text("later")));
  const run = f.rt.session.prompt("go");
  await waitFor(() => f.model.requests.length === 1, { message: "tool call" });
  send(f.probe, "abort-1");
  f.hold.current.resolve();
  await waitFor(() => f.model.requests.length === 2, { message: "second request" });
  await f.rt.session.abort();
  await run;
  assert.ok(!f.probe.events.some((e) => e.startsWith("before_settle")), f.probe.events.join(","));
  assert.ok(f.probe.events.includes("agent_end:aborted"), f.probe.events.join(","));
  assert.ok(f.probe.events.includes("turn_end:aborted"), f.probe.events.join(","));
  assert.equal(customEntries(f.rt.session, PROBE_TYPE).length, 0, "not consumed before abort");
  // The next explicit prompt drains the stale follow-up after its own response.
  await f.rt.session.prompt("next");
  await f.rt.session.waitForIdle();
  const entries = customEntries(f.rt.session, PROBE_TYPE);
  assert.equal(entries.length, 1, `custom entries after next prompt: ${entries.length}`);
});

test("probe: clearQueue() (the interactive abort path) drops a queued custom follow-up", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? toolCall("c1", "hold", {}) : r.index === 2 ? { waitForAbort: true } : text("later")));
  const run = f.rt.session.prompt("go");
  await waitFor(() => f.model.requests.length === 1, { message: "tool call" });
  send(f.probe, "drop-1");
  f.hold.current.resolve();
  await waitFor(() => f.model.requests.length === 2, { message: "second request" });
  f.rt.session.clearQueue();
  await f.rt.session.abort();
  await run;
  await f.rt.session.prompt("next");
  await f.rt.session.waitForIdle();
  assert.equal(customEntries(f.rt.session, PROBE_TYPE).length, 0);
});

test("probe: provider failure during an idle notification persists the message and settles with outcome error", async (t) => {
  const f = await setup(t, (r) => (r.index === 1 ? text("first") : { content: [], stopReason: "error", errorMessage: "provider down" }));
  await f.rt.session.prompt("hello");
  f.probe.events.length = 0;
  send(f.probe, "err-1");
  await waitFor(() => f.probe.events.includes("settled"), { message: "settle" });
  assert.equal(customEntries(f.rt.session, PROBE_TYPE).length, 1);
  assert.ok(f.probe.events.includes("before_settle:error"), f.probe.events.join(","));
});

test("probe: a custom message sent while agent_settled handlers run is deferred until after settlement", async (t) => {
  const f = await setup(t, (r) => text(`reply ${r.index}`));
  let sent = false;
  f.probe.pi.on("agent_settled", () => {
    if (!sent) {
      sent = true;
      send(f.probe, "settled-1");
    }
  });
  await f.rt.session.prompt("hello");
  await waitFor(() => customEntries(f.rt.session, PROBE_TYPE).length === 1 && f.rt.session.isIdle, { message: "deferred delivery" });
  await f.rt.session.waitForIdle();
  assert.equal(f.model.requests.length, 2);
});

test("probe: an automatic retry of the notification response stays inside one settled run", async (t) => {
  const dir = tempDir(t, "bg-probe-");
  const hold = { current: deferred() };
  const { probe, factory } = probeExtension(hold);
  const model = scriptedModel((r) => (r.index === 1 ? text("first") : r.index === 2 ? { content: [], stopReason: "error", errorMessage: "503 service unavailable: overloaded" } : text("retried")));
  const rt = await createRuntime(t, { dir, model, extensionFactories: [factory], settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 5 } } });
  await rt.session.prompt("hello");
  probe.events.length = 0;
  send(probe, "retry-1");
  await waitFor(() => probe.events.includes("settled"), { message: "settle" });
  await rt.session.waitForIdle();
  assert.equal(model.requests.length, 3);
  assert.equal(probe.events.filter((e) => e === "settled").length, 1, probe.events.join(","));
  assert.equal(probe.events.filter((e) => e.startsWith("before_settle")).at(-1), "before_settle:completed", probe.events.join(","));
  assert.equal(customEntries(rt.session, PROBE_TYPE).length, 1);
});

test("probe: manual compaction is bracketed by session_before_compact and session_compact", async (t) => {
  const dir = tempDir(t, "bg-probe-");
  const hold = { current: deferred() };
  const { probe, factory } = probeExtension(hold);
  const model = scriptedModel((r) => text(r.index <= 3 ? `reply ${r.index} ${"x".repeat(4000)}` : "summary of the conversation"));
  const rt = await createRuntime(t, { dir, model, settings: { compaction: { enabled: false, keepRecentTokens: 10 } }, extensionFactories: [factory, (pi) => {
    pi.on("session_before_compact", () => probe.events.push("before_compact"));
    pi.on("session_compact", () => probe.events.push("compact"));
    pi.on("session_compact_failed", () => probe.events.push("compact_failed"));
  }] });
  await rt.session.prompt("one");
  await rt.session.prompt("two");
  await rt.session.prompt("three");
  probe.events.length = 0;
  await rt.session.compact();
  assert.deepEqual(probe.events.filter((e) => e.includes("compact")), ["before_compact", "compact"]);
  assert.ok(!probe.events.includes("agent_start"));
});
