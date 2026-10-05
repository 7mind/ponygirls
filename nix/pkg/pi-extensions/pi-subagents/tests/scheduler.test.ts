import assert from "node:assert/strict";
import test from "node:test";
import { AdmissionScheduler, PathRegistry } from "../src/scheduler.ts";

test("runnable leases are atomic and bounded", () => {
  const s = new AdmissionScheduler({ maxRunnable: 1, maxResidentWorkers: 1, maxAgentsCreated: 10, maxDepth: 1 });
  const a = s.tryAcquireRunnable("a");
  assert.ok(a);
  assert.equal(s.tryAcquireRunnable("b"), null);
  s.release(a!);
  assert.ok(s.tryAcquireRunnable("b"));
});

test("park releases capacity; queued acquirers are served fairly", async () => {
  const s = new AdmissionScheduler({ maxRunnable: 1, maxResidentWorkers: 2, maxAgentsCreated: 10, maxDepth: 1 });
  const a = s.tryAcquireRunnable("a");
  assert.ok(a);
  const { ticket, cancel } = s.acquireRunnableQueued("b");
  void cancel;
  assert.equal(s.queuedCount, 1);
  s.park(a!); // wait releases the lease while waiting
  const b = await ticket;
  assert.ok(b);
  assert.equal(b!.owner, "b");
});

test("resident limit returns capacity error, never self-deadlock", () => {
  const s = new AdmissionScheduler({ maxRunnable: 4, maxResidentWorkers: 1, maxAgentsCreated: 10, maxDepth: 1 });
  assert.ok(s.tryAcquireResident("a"));
  assert.equal(s.tryAcquireResident("b"), null);
});

test("cumulative spawn budget survives release (never reset)", () => {
  const s = new AdmissionScheduler({ maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 2, maxDepth: 1 });
  assert.ok(s.chargeAgentCreation().ok);
  assert.ok(s.chargeAgentCreation().ok);
  const third = s.chargeAgentCreation();
  assert.equal(third.ok, false);
  if (!third.ok) assert.equal(third.code, "CAPACITY_EXCEEDED");
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
