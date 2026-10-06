/** Deterministic guard-transition checks for the completion dispatcher (fake timers, sink, receipts). */
import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { NoticeDispatcher, SessionFileReceipts, type CompletionMessage, type Timers } from "../src/delivery.ts";
import { RECEIPT_CHECK_INTERVAL_MS, START_TIMEOUT_MS, type SessionId, type TaskRecord } from "../src/protocol.ts";
import { defer, eventually, tempDir } from "./fixtures.ts";
import { MemoryTaskBackend } from "./memory-backend.ts";

const SID = "unit-session" as SessionId;

class FakeTimers implements Timers {
  t = 0;
  queue: Array<{ at: number; fn: () => void; id: number }> = [];
  private next = 1;
  now(): number { return this.t; }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.queue.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown): void { this.queue = this.queue.filter((q) => q.id !== handle); }
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at);
      const due = this.queue[0];
      if (!due || due.at > end) break;
      this.queue.shift();
      this.t = due.at;
      due.fn();
      await flush();
    }
    this.t = end;
    await flush();
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

function setup(t: import("node:test").TestContext) {
  const dir = tempDir(t, "bg-unit-");
  const sessionFile = join(dir, "session.jsonl");
  writeFileSync(sessionFile, "");
  const backend = new MemoryTaskBackend(SID);
  const timers = new FakeTimers();
  const sent: CompletionMessage[] = [];
  const unconfirmed: string[][] = [];
  const errors: unknown[] = [];
  const state = { idle: true, current: true };
  const dispatcher = new NoticeDispatcher({
    sessionId: SID,
    receipts: new SessionFileReceipts(sessionFile, SID),
    sink: { submit: (m) => { sent.push(m); } },
    reporter: { unconfirmed: (ids) => { unconfirmed.push(ids); }, error: (e) => { errors.push(e); } },
    host: { isCurrent: () => state.current, isIdle: () => state.idle },
    timers,
  });
  const persist = (message: CompletionMessage) => appendFileSync(sessionFile, `${JSON.stringify({ type: "custom_message", id: `e${Math.random()}`, customType: message.customType, content: message.content, display: true, details: message.details })}\n`);
  defer(t, () => dispatcher.dispose());
  return { backend, timers, sent, unconfirmed, errors, state, dispatcher, persist, sessionFile };
}

async function completed(backend: MemoryTaskBackend, label: string, notify = true): Promise<TaskRecord> {
  const task = await backend.spawn({ label, command: "sleep 30", cwd: "/", notify });
  backend.finish(task.id, 0);
  return backend.get(task.id);
}

/** Simulate a Pi run: start, optional consumption, settle with an outcome. */
async function run(f: ReturnType<typeof setup>, outcome: "completed" | "aborted" | "error", consume: boolean): Promise<void> {
  f.dispatcher.agentStart();
  await flush();
  if (consume) for (const m of f.sent.splice(0)) f.persist(m);
  if (outcome === "aborted") f.dispatcher.aborted();
  else f.dispatcher.beforeSettle(outcome);
  f.dispatcher.settled();
  await flush();
}

test("one in-flight batch at a time; a burst becomes one bounded message", async (t) => {
  const f = setup(t);
  await f.dispatcher.attach(f.backend);
  const a = await completed(f.backend, "a");
  const b = await completed(f.backend, "b");
  f.dispatcher.terminal();
  await flush();
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0]!.details.events.map((e) => e.taskId), [a.id, b.id]);
  const c = await completed(f.backend, "c");
  f.dispatcher.terminal();
  await flush();
  assert.equal(f.sent.length, 1, "the next event waits for the slot");
  await run(f, "completed", true);
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0]!.details.events.map((e) => e.taskId), [c.id]);
  assert.equal((await f.backend.get(a.id)).event!.status, "received");
});

test("missing after a successful settle allows exactly one retry, then unconfirmed until input", async (t) => {
  const f = setup(t);
  await f.dispatcher.attach(f.backend);
  const a = await completed(f.backend, "a");
  f.dispatcher.terminal();
  await flush();
  await run(f, "completed", false);
  assert.equal(f.sent.length, 2, "one bounded retry");
  f.sent.shift();
  await run(f, "completed", false);
  assert.equal(f.sent.length, 1, "no third automatic attempt");
  assert.deepEqual(f.unconfirmed, [[a.id]]);
  assert.equal(f.dispatcher.localState(a), "unconfirmed");
  await f.timers.advance(RECEIPT_CHECK_INTERVAL_MS * 10);
  assert.equal(f.sent.length, 1);
  f.sent.length = 0;
  f.dispatcher.input(false);
  await run(f, "completed", false);
  assert.equal(f.sent.length, 1, "explicit input releases the guard after its run settles");
});

test("an aborted run defers its events; independent later completions still go out", async (t) => {
  const f = setup(t);
  await f.dispatcher.attach(f.backend);
  const a = await completed(f.backend, "a");
  f.dispatcher.terminal();
  await flush();
  f.sent.length = 0;
  await run(f, "aborted", false);
  assert.equal(f.dispatcher.localState(a), "deferred after abort");
  assert.equal(f.sent.length, 0, "no automatic re-wake");
  const b = await completed(f.backend, "b");
  f.dispatcher.terminal();
  await flush();
  assert.deepEqual(f.sent.map((m) => m.details.events.map((e) => e.taskId)), [[b.id]]);
});

test("a late receipt for a deferred event reconciles it without resubmission", async (t) => {
  const f = setup(t);
  await f.dispatcher.attach(f.backend);
  const a = await completed(f.backend, "a");
  f.dispatcher.terminal();
  await flush();
  const original = f.sent.shift()!;
  await run(f, "aborted", false);
  f.persist(original);
  await f.timers.advance(RECEIPT_CHECK_INTERVAL_MS * 2);
  assert.equal((await f.backend.get(a.id)).event!.status, "received");
  assert.equal(f.dispatcher.localState(a), null);
  assert.equal(f.sent.length, 0);
});

test("no run starting after an idle submission becomes unconfirmed without a retry loop", async (t) => {
  const f = setup(t);
  await f.dispatcher.attach(f.backend);
  const a = await completed(f.backend, "a");
  f.dispatcher.terminal();
  await flush();
  assert.equal(f.sent.length, 1);
  await f.timers.advance(START_TIMEOUT_MS + RECEIPT_CHECK_INTERVAL_MS);
  assert.deepEqual(f.unconfirmed, [[a.id]]);
  await f.timers.advance(START_TIMEOUT_MS * 5);
  assert.equal(f.sent.length, 1);
  const b = await completed(f.backend, "b");
  f.dispatcher.terminal();
  await flush();
  assert.deepEqual(f.sent.at(-1)!.details.events.map((e) => e.taskId), [b.id], "the slot was released for independent events");
});

test("muting or clearing an in-flight event releases the slot", async (t) => {
  const f = setup(t);
  await f.dispatcher.attach(f.backend);
  const a = await completed(f.backend, "a");
  f.dispatcher.terminal();
  await flush();
  f.state.idle = false;
  f.dispatcher.agentStart();
  const muted = await f.backend.setNotify(a.id, false);
  f.dispatcher.forget(muted);
  const b = await completed(f.backend, "b");
  f.dispatcher.terminal();
  await flush();
  assert.deepEqual(f.sent.at(-1)!.details.events.map((e) => e.taskId), [b.id]);
});

test("submissions wait during compaction, after explicit idle input until its run starts, and when not current", async (t) => {
  const f = setup(t);
  await f.dispatcher.attach(f.backend);
  f.dispatcher.compactionStarted();
  await completed(f.backend, "a");
  f.dispatcher.terminal();
  await flush();
  assert.equal(f.sent.length, 0);
  f.dispatcher.input(false);
  f.dispatcher.compactionEnded();
  await flush();
  assert.equal(f.sent.length, 0, "an accepted idle input owns the next run start");
  f.dispatcher.agentStart();
  await flush();
  assert.equal(f.sent.length, 1, "queued behind the input's run");
  f.sent.length = 0;
  f.dispatcher.beforeSettle("completed");
  f.state.current = false;
  f.dispatcher.settled();
  await f.timers.advance(RECEIPT_CHECK_INTERVAL_MS * 4);
  assert.equal(f.sent.length, 0, "a stale activation never submits");
});

test("resume restores a received mark whose session entry is missing", async (t) => {
  const f = setup(t);
  const a = await completed(f.backend, "a");
  await f.backend.setReceipts([a.event!.id], true);
  await f.dispatcher.attach(f.backend);
  await flush();
  assert.equal((await f.backend.get(a.id)).event!.status, "pending");
  assert.equal(f.sent.length, 1);
});

test("receipts ignore incomplete lines and entries for other sessions", (t) => {
  const dir = tempDir(t, "bg-receipts-");
  const file = join(dir, "s.jsonl");
  const entry = (sid: string, eventId: string) => JSON.stringify({ type: "custom_message", customType: "bg-task-completion", details: { schemaVersion: 1, sessionId: sid, events: [{ taskId: "t", eventId, state: "completed", reason: "exit", logPath: "/x" }] } });
  writeFileSync(file, `${entry("other", "e1")}\n${entry(SID, "e2")}`);
  const receipts = new SessionFileReceipts(file, SID);
  assert.deepEqual([...receipts.present(["e1", "e2"])], []);
  appendFileSync(file, "\n");
  assert.deepEqual([...receipts.present(["e1", "e2"])], ["e2"]);
});

test("a completion that arrives while the session is busy but not running is sent once it becomes idle", async (t) => {
  const f = setup(t);
  await f.dispatcher.attach(f.backend);
  f.state.idle = false;
  await completed(f.backend, "a");
  f.dispatcher.terminal();
  await flush();
  assert.equal(f.sent.length, 0);
  f.state.idle = true;
  await f.timers.advance(RECEIPT_CHECK_INTERVAL_MS * 2);
  assert.equal(f.sent.length, 1, "retried without another lifecycle event");
});

test("independent completions are found beyond a first page of guarded events", async (t) => {
  const f = setup(t);
  await f.dispatcher.attach(f.backend);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 10; j++) await completed(f.backend, `old-${i}-${j}`);
    f.dispatcher.terminal();
    await flush();
    assert.equal(f.sent.length, 1);
    f.sent.length = 0;
    await run(f, "aborted", false);
  }
  const fresh = await completed(f.backend, "fresh");
  f.dispatcher.terminal();
  await flush();
  assert.deepEqual(f.sent.map((m) => m.details.events.map((e) => e.taskId)), [[fresh.id]]);
});

test("re-enabling a muted finished task while idle starts delivery through the supervisor hint", async (t) => {
  const { startRealBackend } = await import("./fixtures.ts");
  const { connectBackend } = await import("../src/delivery.ts");
  const f = setup(t);
  const { backend } = await startRealBackend(t, "unmute-idle");
  connectBackend(f.dispatcher, backend);
  const task = await backend.spawn({ label: "m", command: "exit 0", cwd: "/", notify: false });
  await eventually(async () => (await backend.get(task.id)).state !== "running", "finish");
  await flushReal();
  assert.equal(f.sent.length, 0);
  await backend.setNotify(task.id, true);
  await eventually(async () => { await flushReal(); return f.sent.length === 1; }, "notice after unmute");
});

async function flushReal(): Promise<void> {
  await new Promise((r) => setTimeout(r, 50));
  await flush();
}
