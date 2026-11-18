import assert from "node:assert/strict";
import test from "node:test";
import { NativeSessions } from "../src/execution-lifecycle.ts";

function delegation(sessions: NativeSessions, id: string) {
  return sessions.enter({ capability: { version: 1, apis: ["fixture"], requestProfile: "canonical-simple-no-provider-hooks-v1" }, cwd: process.cwd(), lifecycleSessionId: id, beforeEntry: () => {}, captureOriginal: (stream) => stream }, {});
}

test("native lifecycle retires synchronously, closes every owned process and joins pending acquisition", async () => {
  const sessions = new NativeSessions();
  const worker = delegation(sessions, "worker");
  const reviewer = delegation(sessions, "reviewer");
  let release!: () => void;
  const pending = worker.track(new Promise<void>((resolve) => { release = resolve; }));
  const closed: number[] = [];
  for (const id of [1, 2, 3]) {
    const process = { close: async () => { closed.push(id); worker.release(process); } };
    worker.own(process);
  }
  let disposed = false;
  const disposal = sessions.dispose("worker").then(() => { disposed = true; });
  assert.equal(worker.signal.aborted, true);
  assert.throws(() => worker.beforeEntry(), /retired/);
  assert.equal(reviewer.signal.aborted, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(closed.sort(), [1, 2, 3]);
  assert.equal(disposed, false);
  release();
  await pending;
  await disposal;
  assert.equal(disposed, true);
  await sessions.dispose("reviewer");
});

test("synchronous owned close failure does not skip other closes or pending acquisition joins", async () => {
  const sessions = new NativeSessions();
  const owner = delegation(sessions, "synchronous-failure");
  const closed: string[] = [];
  const failure = new Error("controlled synchronous EPERM");
  owner.own({ close: () => { closed.push("first"); throw failure; } });
  const second = { close: async () => { closed.push("second"); owner.release(second); } };
  owner.own(second);
  let release!: () => void;
  const acquired = { close: async () => { closed.push("acquired"); owner.release(acquired); } };
  const pending = owner.track(new Promise<void>((resolve) => { release = () => { owner.own(acquired); resolve(); }; }));
  let settled = false;
  const disposal = sessions.dispose("synchronous-failure").then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(closed, ["first", "second"]);
    assert.equal(settled, false);
    release();
    await pending;
    const outcome = await disposal;
    assert.ok(outcome instanceof AggregateError);
    assert.ok(outcome.errors.includes(failure));
    assert.deepEqual(closed, ["first", "second", "acquired"]);
  } finally { release(); await pending; await disposal; }
});

test("pending acquisition rejection is included in native cleanup failure", async () => {
  const sessions = new NativeSessions();
  const owner = delegation(sessions, "pending-failure");
  let reject!: (error: Error) => void;
  const failure = new Error("controlled pending cleanup failure");
  const pending = owner.track(new Promise<void>((_resolve, fail) => { reject = fail; }));
  void pending.catch(() => {});
  const disposal = sessions.dispose("pending-failure");
  void disposal.catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  reject(failure);
  await assert.rejects(disposal, (error: unknown) => error instanceof AggregateError && error.errors.includes(failure));
});

test("native lifecycle cleanup failures propagate rather than establishing stopped state", async () => {
  const sessions = new NativeSessions();
  const request = delegation(sessions, "failed");
  request.own({ close: async () => { throw new Error("termination not observed"); } });
  await assert.rejects(sessions.dispose("failed"), /Native delegation cleanup failed/);
  assert.throws(() => request.beforeEntry(), /retired/);
});

test("native lifecycle retains the failure barrier after physical cleanup later succeeds", async () => {
  const sessions = new NativeSessions();
  const request = delegation(sessions, "recovered");
  const failure = new Error("controlled termination failure");
  let recovered = false;
  let released = false;
  const worker = { close: async () => {
    if (!recovered) throw failure;
    released = true;
    request.release(worker);
  } };
  request.own(worker);
  await assert.rejects(sessions.dispose("recovered"), (error: unknown) => error instanceof AggregateError && error.errors.includes(failure));
  recovered = true;
  await assert.rejects(sessions.dispose("recovered"), /Native delegation cleanup failed/);
  assert.equal(released, true);
  assert.throws(() => delegation(sessions, "recovered"), /retired/);
});

test("native lifecycle retains acquisition cleanup faults after request completion", async () => {
  const sessions = new NativeSessions();
  const request = delegation(sessions, "acquisition");
  request.cleanupFailed(new Error("acquisition descendant still running"));
  assert.equal(request.signal.aborted, true);
  assert.throws(() => request.beforeEntry(), /retired/);
  await assert.rejects(sessions.dispose("acquisition"), /Native delegation cleanup failed/);
});
