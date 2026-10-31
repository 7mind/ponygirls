import assert from "node:assert/strict";
import test from "node:test";
import { AdmissionScheduler, PathRegistry } from "../src/scheduler.ts";

test("runnable leases are atomic and bounded", () => {
  const s = new AdmissionScheduler({ maxRunnable: 1, maxResidentWorkers: 1, maxOpenAgents: 10 });
  const a = s.tryAcquireRunnable("a");
  assert.ok(a);
  assert.equal(s.tryAcquireRunnable("b"), null);
  s.release(a!);
  assert.ok(s.tryAcquireRunnable("b"));
});

test("park releases capacity; queued acquirers are served fairly", async () => {
  const s = new AdmissionScheduler({ maxRunnable: 1, maxResidentWorkers: 2, maxOpenAgents: 10 });
  const a = s.tryAcquireRunnable("a");
  assert.ok(a);
  const { ticket, cancel } = s.acquireRunnableQueued("b");
  void cancel;
  assert.equal(s.queuedCount, 1);
  s.release(a!); // wait releases the lease while waiting
  const b = await ticket;
  assert.ok(b);
  assert.equal(b!.owner, "b");
});

test("resident limit returns capacity error, never self-deadlock", () => {
  const s = new AdmissionScheduler({ maxRunnable: 4, maxResidentWorkers: 1, maxOpenAgents: 10 });
  assert.ok(s.tryAcquireResident("a"));
  assert.equal(s.tryAcquireResident("b"), null);
});

test("open-agent admission is atomic and close frees capacity without resetting created history", () => {
  const s = new AdmissionScheduler({ maxOpenAgents: 2 });
  const panel = s.reserveAgentCreation(2);
  assert.ok(panel.ok);
  assert.equal(s.reserveAgentCreation(1).ok, false);
  assert.equal(s.agentsCreatedCount, 0);
  s.commitAgentCreation(panel.reservation, "a");
  s.commitAgentCreation(panel.reservation, "b");
  s.cancelAgentCreation(panel.reservation);
  const runnable = s.tryAcquireRunnable("a");
  assert.ok(runnable);
  s.release(runnable);
  assert.equal(s.reserveAgentCreation(1).ok, false, "worker capacity release is not identity closure");
  s.releaseAgent("a");
  s.releaseAgent("a");
  assert.equal(s.reserveAgentCreation(2).ok, false, "repeated close cannot mint slots");
  const next = s.reserveAgentCreation(1);
  assert.ok(next.ok);
  s.commitAgentCreation(next.reservation, "c");
  assert.equal(s.agentsCreatedCount, 3);
  assert.equal(s.snapshot().open, 2);
});

test("failed creation cancels only unused reservations, never committed identities", () => {
  const s = new AdmissionScheduler({ maxOpenAgents: 3 });
  const panel = s.reserveAgentCreation(3);
  assert.ok(panel.ok);
  s.commitAgentCreation(panel.reservation, "a");
  s.cancelAgentCreation(panel.reservation);
  s.cancelAgentCreation(panel.reservation);
  assert.equal(s.agentsCreatedCount, 1);
  assert.equal(s.snapshot().reserved, 0);
  assert.ok(s.reserveAgentCreation(2).ok);
  assert.equal(s.reserveAgentCreation(1).ok, false);
  assert.throws(() => s.commitAgentCreation(panel.reservation, "b"), /CONFLICT/);
  assert.throws(() => s.reserveAgentCreation(0), /INVALID/);
});

test("replay restores final open membership separately from historical creations", () => {
  const s = new AdmissionScheduler({ maxOpenAgents: 1 });
  s.restoreSnapshot({ created: 32, openAgentIds: ["last-open"] });
  assert.equal(s.reserveAgentCreation(1).ok, false);
  s.releaseAgent("old-closed");
  assert.equal(s.reserveAgentCreation(1).ok, false);
  s.releaseAgent("last-open");
  const next = s.reserveAgentCreation(1);
  assert.ok(next.ok);
  s.commitAgentCreation(next.reservation, "fresh");
  assert.equal(s.agentsCreatedCount, 33);
});

test("task paths are reserved, never reused after close", () => {
  const p = new PathRegistry();
  assert.ok(p.reserve("/root/builder").ok);
  assert.equal(p.reserve("/root/builder").ok, false);
  p.retire("/root/builder");
  const again = p.reserve("/root/builder");
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.code, "CONFLICT");
});

test("child path derivation is deterministic and bounded", () => {
  assert.equal(PathRegistry.childPath("/root", "Fix the PARSER!!"), "/root/fix-the-parser");
  assert.equal(PathRegistry.childPath("/root", "!!!"), "/root/agent");
});
