/** Dual TaskBackend contract: the memory dummy and the real supervisor adapter. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { TaskBackend } from "../src/backend.ts";
import { BgTaskError, type SessionId, type TaskId, type TaskRecord } from "../src/protocol.ts";
import { eventually, startRealBackend } from "./fixtures.ts";
import { MemoryTaskBackend } from "./memory-backend.ts";

type Factory = (t: TestContext) => Promise<TaskBackend>;
const factories: Record<string, Factory> = {
  memory: async () => new MemoryTaskBackend("mem-session" as SessionId),
  real: async (t) => (await startRealBackend(t, "real-session")).backend,
};

async function final(b: TaskBackend, id: TaskId): Promise<TaskRecord> {
  return eventually(async () => {
    const t = await b.get(id);
    return t.state !== "running" ? t : null;
  }, `${id} to finish`);
}

async function rejectsWith(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => e instanceof BgTaskError && e.code === code);
}

for (const [name, make] of Object.entries(factories)) {
  test(`${name}: completion, output, and retention through repeated reads`, async (t) => {
    const b = await make(t);
    let terminal = 0;
    b.onChanged((isTerminal) => { if (isTerminal) terminal++; });
    const spawned = await b.spawn({ label: "hello", command: "echo hello; exit 0", cwd: "/", notify: true });
    assert.equal(spawned.state, "running");
    const done = await final(b, spawned.id);
    assert.deepEqual([done.state, done.reason, done.exit], ["completed", "exit", { kind: "code", code: 0 }]);
    for (let i = 0; i < 3; i++) {
      const w = await b.read(done.id, 0, 1000);
      assert.match(new TextDecoder().decode(w.bytes), /hello/);
    }
    assert.equal((await b.list(null, null, 10)).items[0]!.id, done.id);
    await eventually(async () => terminal > 0, "terminal hint");
  });

  test(`${name}: nonzero exit, termination, and clear`, async (t) => {
    const b = await make(t);
    const failed = await final(b, (await b.spawn({ label: "x", command: "exit 3", cwd: "/", notify: true })).id);
    assert.deepEqual([failed.state, failed.reason, failed.exit], ["failed", "exit_nonzero", { kind: "code", code: 3 }]);
    const running = await b.spawn({ label: "long", command: "sleep 30", cwd: "/", notify: false });
    await rejectsWith(b.clear(running.id), "TASK_UNFINISHED");
    const stopped = await b.terminate(running.id);
    assert.deepEqual([stopped.state, stopped.reason], ["failed", "terminated"]);
    assert.equal((await b.terminate(running.id)).revision, stopped.revision, "terminating a finalized task returns its outcome");
    await rejectsWith(b.signal(running.id, "SIGINT"), "TASK_FINALIZED");
    await b.clear(running.id);
    await rejectsWith(b.get(running.id), "NOT_FOUND");
    await rejectsWith(b.clear(running.id), "NOT_FOUND");
    assert.equal((await b.get(failed.id)).state, "failed");
  });

  test(`${name}: notices, mute, and receipts`, async (t) => {
    const b = await make(t);
    const a = await final(b, (await b.spawn({ label: "a", command: "exit 0", cwd: "/", notify: true })).id);
    const muted = await final(b, (await b.spawn({ label: "m", command: "exit 0", cwd: "/", notify: false })).id);
    assert.deepEqual((await b.notices("eligible", null, 10)).items.map((x) => x.id), [a.id]);
    assert.deepEqual(await b.setReceipts([a.event!.id], true), [a.event!.id]);
    assert.deepEqual((await b.notices("received", null, 10)).items.map((x) => x.id), [a.id]);
    assert.deepEqual((await b.notices("eligible", null, 10)).items, []);
    const enabled = await b.setNotify(muted.id, true);
    assert.equal(enabled.event!.id, muted.event!.id, "muting changes no terminal event ID");
    assert.deepEqual((await b.notices("eligible", null, 10)).items.map((x) => x.id), [muted.id]);
    assert.deepEqual(await b.setReceipts([a.event!.id], false), [a.event!.id]);
  });

  test(`${name}: paging covers retained history newest-first`, async (t) => {
    const b = await make(t);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await final(b, (await b.spawn({ label: `t${i}`, command: "exit 0", cwd: "/", notify: false })).id)).id);
    const first = await b.list(null, null, 2);
    assert.deepEqual(first.items.map((x) => x.label), ["t4", "t3"]);
    const second = await b.list(first.upper, first.next, 2);
    const third = await b.list(first.upper, second.next, 2);
    assert.deepEqual([...first.items, ...second.items, ...third.items].map((x) => x.label), ["t4", "t3", "t2", "t1", "t0"]);
    assert.equal(third.next, null);
  });

  test(`${name}: invalid input is rejected`, async (t) => {
    const b = await make(t);
    await rejectsWith(b.spawn({ label: "x", command: "true", cwd: "relative", notify: true }), "INVALID_REQUEST");
    await rejectsWith(b.get("bgt-unknown" as TaskId), "NOT_FOUND");
  });

  test(`${name}: running snapshots carry liveness evidence; finalized ones omit it`, async (t) => {
    const b = await make(t);
    const running = await b.spawn({ label: "quiet", command: "sleep 30", cwd: "/", notify: false });
    try {
      assert.equal(running.leaderAlive, true);
      assert.ok(running.observedAt?.endsWith("Z"));
      const w = await b.read(running.id, "tail", 100);
      assert.equal(w.task.leaderAlive, true);
      assert.ok(w.task.observedAt);
      assert.ok((await b.list(null, null, 10)).items.find((x) => x.id === running.id)?.leaderAlive);
    } finally {
      await b.terminate(running.id);
    }
    const done = await b.get(running.id);
    assert.equal(done.observedAt ?? null, null, "finalized records carry the outcome, not liveness");
    assert.equal(done.leaderAlive ?? null, null);
  });
}

test("real: another session's task IDs are not visible", async (t) => {
  const a = await startRealBackend(t, "session-a");
  const b = await startRealBackend(t, "session-b");
  const task = await a.backend.spawn({ label: "a", command: "exit 0", cwd: "/", notify: true });
  await rejectsWith(b.backend.get(task.id), "NOT_FOUND");
  await rejectsWith(b.backend.read(task.id, 0, 10), "NOT_FOUND");
  await rejectsWith(b.backend.clear(task.id), "NOT_FOUND");
});

test("real: parallel spawn and terminate calls lose no registry mutations", async (t) => {
  const { backend } = await startRealBackend(t, "parallel");
  const spawned = await Promise.all(Array.from({ length: 8 }, (_, i) => backend.spawn({ label: `p${i}`, command: "sleep 30", cwd: "/", notify: false })));
  const stopped = await Promise.all(spawned.map((s) => backend.terminate(s.id)));
  assert.ok(stopped.every((s) => s.reason === "terminated"));
  const page = await backend.list(null, null, 50);
  assert.equal(page.items.length, 8);
  assert.deepEqual(new Set(page.items.map((x) => x.seq)).size, 8);
});

test("real: a supervisor-reported launch failure carries the retained task", async (t) => {
  const { backend } = await startRealBackend(t, "launch");
  let caught: unknown = null;
  try {
    await backend.spawn({ label: "bad", command: "true", cwd: "/definitely/missing/dir", notify: true });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof BgTaskError);
  assert.equal(caught.code, "LAUNCH_FAILED");
  assert.equal(caught.task?.state, "failed");
  assert.equal(caught.task?.reason, "launch_failed");
  // Runner-level evidence is retained in the task log itself, so a later list/read
  // distinguishes the spawn failure from a fast command death without guessing.
  const w = await backend.read(caught.task!.id, 0, 4096);
  assert.match(new TextDecoder().decode(w.bytes), /launch failed.*never started/);
  assert.equal(caught.task!.logBytes, w.size);
  assert.ok(w.size > 0);
});

test("real: a second activation of a busy session is refused with SESSION_BUSY", async (t) => {
  const first = await startRealBackend(t, "busy");
  const { SupervisorBackend } = await import("../src/backend.ts");
  const { PYTHON, SHELL, SUPERVISOR_SCRIPT } = await import("./fixtures.ts");
  await assert.rejects(SupervisorBackend.start({ python: PYTHON, script: SUPERVISOR_SCRIPT, shell: SHELL, sidecar: first.sidecar, sessionId: "busy", handoffWaitMs: 0 }),
    (e: unknown) => e instanceof BgTaskError && e.code === "SESSION_BUSY");
});

test("real: replies larger than one pipe chunk with multibyte text decode intact", async (t) => {
  const { backend } = await startRealBackend(t, "multibyte");
  const label = "€".repeat(199);
  const command = `exit 0 # ${"é".repeat(30000)}`;
  for (let i = 0; i < 30; i++) await backend.spawn({ label, command, cwd: "/", notify: false });
  const page = await Promise.race([
    backend.list(null, null, 30),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("list reply was lost")), 10000)),
  ]);
  assert.equal(page.items.length, 30);
  assert.ok(page.items.every((x) => x.label === label && x.command === command));
});

test("activation: missing packaged executables and --no-session fail explicitly", async () => {
  const { Activation, readRuntimeConfig } = await import("../src/activation.ts");
  const missing = readRuntimeConfig({});
  assert.equal(missing.ok, false);
  assert.equal(readRuntimeConfig({ PI_BG_TASKS_PYTHON: "python3", PI_BG_TASKS_SHELL: "/bin/bash" }).ok, false, "relative paths are not guessed");
  const noConfig = new Activation({ sessionId: "s" as SessionId, sessionFile: "/tmp/x.jsonl", config: missing });
  await rejectsWith(noConfig.backend(), "CONFIG_MISSING");
  const ephemeral = new Activation({ sessionId: "s" as SessionId, sessionFile: undefined, config: readRuntimeConfig({ PI_BG_TASKS_PYTHON: "/p", PI_BG_TASKS_SHELL: "/s" }) });
  await rejectsWith(ephemeral.backend(), "NO_PERSISTENT_SESSION");
  await ephemeral.shutdown("quit");
  await rejectsWith(ephemeral.backend(), "ACTIVATION_DISPOSED");
});
