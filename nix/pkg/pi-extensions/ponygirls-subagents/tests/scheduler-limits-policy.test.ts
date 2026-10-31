/**
 * Scheduler capacity limits come from subagents-policy.json: loadPolicy
 * validates maxRunnable/maxResidentWorkers/maxOpenAgents and the supervisor
 * admits work against exactly those limits. Depth is policy-only.
 */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPolicy } from "../index.ts";
import { AdmissionScheduler, type SchedulerLimits } from "../src/scheduler.ts";
import { SubagentsError } from "../src/errors.ts";
import { mkSup, tick } from "./ctl-worker.ts";

const DEFAULTS = { maxRunnable: 4, maxResidentWorkers: 8, maxOpenAgents: 32 };

/** Run `body` with PI_CODING_AGENT_DIR pointing at a directory holding `policy` (absent when null). */
function withPolicyFile<T>(t: TestContext, policy: unknown, body: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), "subagents-limits-policy-"));
  const previous = process.env["PI_CODING_AGENT_DIR"];
  process.env["PI_CODING_AGENT_DIR"] = dir;
  t.after(() => {
    if (previous === undefined) delete process.env["PI_CODING_AGENT_DIR"];
    else process.env["PI_CODING_AGENT_DIR"] = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  if (policy !== null) writeFileSync(join(dir, "subagents-policy.json"), JSON.stringify(policy));
  return body();
}

function limitsFrom(t: TestContext, policy: unknown): SchedulerLimits {
  return withPolicyFile(t, policy, () => loadPolicy().schedulerLimits);
}

// -- policy parsing ---------------------------------------------------------------

test("absent policy file and absent keys keep the default limits", (t) => {
  assert.deepEqual(limitsFrom(t, null), DEFAULTS);
  assert.deepEqual(limitsFrom(t, { maxDepth: 2, nesting: true }), DEFAULTS);
});

test("valid limits are read from the policy file; missing ones keep their defaults", (t) => {
  assert.deepEqual(limitsFrom(t, { maxRunnable: 8, maxResidentWorkers: 12, maxOpenAgents: 40 }), { maxRunnable: 8, maxResidentWorkers: 12, maxOpenAgents: 40 });
  assert.deepEqual(limitsFrom(t, { maxOpenAgents: 64 }), { ...DEFAULTS, maxOpenAgents: 64 });
  assert.deepEqual(limitsFrom(t, { maxRunnable: 2 }), { ...DEFAULTS, maxRunnable: 2 });
  assert.deepEqual(limitsFrom(t, { maxRunnable: 64, maxResidentWorkers: 128, maxOpenAgents: 1024 }), { maxRunnable: 64, maxResidentWorkers: 128, maxOpenAgents: 1024 });
});

test("invalid limit values fail with a policy error naming the key", (t) => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ maxRunnable: 0 }, /maxRunnable must be an integer from 1 to 64/],
    [{ maxRunnable: -1 }, /maxRunnable must be an integer from 1 to 64/],
    [{ maxRunnable: 1.5 }, /maxRunnable must be an integer from 1 to 64/],
    [{ maxRunnable: "4" }, /maxRunnable must be an integer from 1 to 64/],
    [{ maxRunnable: null }, /maxRunnable must be an integer from 1 to 64/],
    [{ maxRunnable: true }, /maxRunnable must be an integer from 1 to 64/],
    [{ maxRunnable: 65, maxResidentWorkers: 128, maxOpenAgents: 1024 }, /maxRunnable must be an integer from 1 to 64/],
    [{ maxResidentWorkers: 0 }, /maxResidentWorkers must be an integer from 1 to 128/],
    [{ maxResidentWorkers: 129, maxOpenAgents: 1024 }, /maxResidentWorkers must be an integer from 1 to 128/],
    [{ maxOpenAgents: 1025 }, /maxOpenAgents must be an integer from 1 to 1024/],
    [{ maxOpenAgents: [32] }, /maxOpenAgents must be an integer from 1 to 1024/],
  ];
  for (const [policy, expected] of cases) {
    assert.throws(() => limitsFrom(t, policy), (e: unknown) => {
      assert.ok(e instanceof SubagentsError, `not a policy error: ${String(e)}`);
      assert.equal(e.code, "INVALID");
      assert.match(e.message, expected);
      return true;
    }, JSON.stringify(policy));
  }
});

test("limits that could never bind are rejected instead of silently ignored", (t) => {
  // A running agent holds a resident worker; each resident worker is an open identity.
  assert.throws(() => limitsFrom(t, { maxRunnable: 10 }), /INVALID: .*maxRunnable \(10\) must not exceed maxResidentWorkers \(8\)/);
  assert.throws(() => limitsFrom(t, { maxResidentWorkers: 40 }), /INVALID: .*maxResidentWorkers \(40\) must not exceed maxOpenAgents \(32\)/);
});

// -- depth: the policy is the single source of truth ------------------------------

test("scheduler limits carry no depth; policy maxDepth alone bounds nesting", async (t) => {
  assert.deepEqual(new AdmissionScheduler().getLimits(), DEFAULTS);
  const { sup, byAgent } = mkSup({ policy: (p) => { p.maxDepth = 2; p.nesting = true; } });
  t.after(() => sup.shutdown());
  assert.deepEqual(sup.capacity().limits, DEFAULTS);
  const parent = await sup.spawn("governor", { taskName: "p", message: "m", profile: "reader" }, "rp");
  const kid = await sup.spawn(parent.agentId, { taskName: "k", message: "m", profile: "reader" }, "rk");
  await tick();
  assert.ok(byAgent(kid.agentId)[0], "a depth-2 child runs under policy maxDepth 2");
  await assert.rejects(() => sup.spawn(kid.agentId, { taskName: "g", message: "m", profile: "reader" }, "rg"), /POLICY_DENIED/);
});

// -- admission against the configured limits ---------------------------------------

test("configured maxRunnable admits N concurrent runs and queues run N+1", async (t) => {
  const limits = limitsFrom(t, { maxRunnable: 6, maxResidentWorkers: 12 });
  const { sup, byAgent } = mkSup({ limits });
  t.after(() => sup.shutdown());
  const spawned = [];
  for (let i = 0; i < 7; i++) spawned.push(await sup.spawn("governor", { taskName: `a${i}`, message: "m", profile: "reader" }, `r${i}`));
  await tick();
  const launched = spawned.filter((s) => byAgent(s.agentId).length > 0);
  assert.equal(launched.length, 6, "exactly maxRunnable runs start");
  const last = spawned[6]!;
  assert.equal(byAgent(last.agentId).length, 0, "run N+1 is queued, not started");
  assert.match(sup.list("governor").find((v) => v.id === last.agentId)!.pendingIntent, /waiting for runnable capacity/);
  assert.equal(sup.capacity().runnable, 6);
  byAgent(spawned[0]!.agentId)[0]!.settle();
  await tick();
  assert.ok(byAgent(last.agentId)[0], "the queued run starts once a slot frees");
  assert.equal(sup.capacity().runnable, 6);
});

test("configured maxRunnable below the default restricts admission", async (t) => {
  const limits = limitsFrom(t, { maxRunnable: 2 });
  const { sup, byAgent } = mkSup({ limits });
  t.after(() => sup.shutdown());
  const spawned = [];
  for (let i = 0; i < 3; i++) spawned.push(await sup.spawn("governor", { taskName: `b${i}`, message: "m", profile: "reader" }, `s${i}`));
  await tick();
  assert.deepEqual(spawned.map((s) => byAgent(s.agentId).length > 0), [true, true, false]);
});

test("nested children count against the same runnable pool", async (t) => {
  const limits = limitsFrom(t, { maxRunnable: 2 });
  const { sup, byAgent } = mkSup({ limits, policy: (p) => { p.maxDepth = 2; p.nesting = true; } });
  t.after(() => sup.shutdown());
  const parent = await sup.spawn("governor", { taskName: "p", message: "delegate", profile: "reader" }, "rp");
  const sibling = await sup.spawn("governor", { taskName: "q", message: "m", profile: "reader" }, "rq");
  await tick();
  const pw = byAgent(parent.agentId)[0]!;
  const kid = JSON.parse((await pw.call("spawn_agent", { task_name: "kid", message: "help", profile: "reader" })).content) as { agentId: string };
  await tick();
  assert.equal(byAgent(kid.agentId).length, 0, "the nested child waits for a slot in the shared pool");
  const seen = JSON.parse((await pw.call("list_agents", {})).content) as { capacity: { runnable: number; limits: SchedulerLimits } };
  assert.deepEqual(seen.capacity.limits, { ...DEFAULTS, maxRunnable: 2 }, "children see the configured limits too");
  assert.equal(seen.capacity.runnable, 2);
  byAgent(sibling.agentId)[0]!.settle();
  await tick();
  assert.ok(byAgent(kid.agentId)[0], "the nested child starts on the slot a top-level run released");
});

test("an agent waiting in wait_agent releases its runnable slot", async (t) => {
  const limits = limitsFrom(t, { maxRunnable: 2 });
  const { sup, byAgent } = mkSup({ limits, policy: (p) => { p.maxDepth = 2; p.nesting = true; } });
  t.after(() => sup.shutdown());
  const parent = await sup.spawn("governor", { taskName: "p", message: "delegate", profile: "reader" }, "rp");
  const sibling = await sup.spawn("governor", { taskName: "q", message: "m", profile: "reader" }, "rq");
  await tick();
  const pw = byAgent(parent.agentId)[0]!;
  const kid = JSON.parse((await pw.call("spawn_agent", { task_name: "kid", message: "help", profile: "reader" })).content) as { agentId: string; taskRunId: string };
  await tick();
  assert.equal(byAgent(kid.agentId).length, 0, "both slots are held before the wait");
  const waiting = pw.call("wait_agent", { targets: [{ agentId: kid.agentId, taskRunId: kid.taskRunId }], condition: "all_settled", timeout_ms: 5000 });
  await tick();
  assert.ok(byAgent(kid.agentId)[0], "the waiting parent's slot went to its child while the sibling still runs");
  assert.equal(sup.capacity().runnable, 2);
  byAgent(kid.agentId)[0]!.settle("succeeded", "kid result");
  const res = JSON.parse((await waiting).content) as { completed: boolean };
  assert.equal(res.completed, true);
  assert.equal(sup.capacity().runnable, 2, "the parent reacquired a slot beside the still-running sibling");
  void sibling;
});

// -- capacity report ---------------------------------------------------------------

test("resident CAPACITY_EXCEEDED reports the configured limits", async (t) => {
  const limits = limitsFrom(t, { maxRunnable: 1, maxResidentWorkers: 1 });
  const { sup } = mkSup({ limits });
  t.after(() => sup.shutdown());
  await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  await tick();
  await assert.rejects(() => sup.spawn("governor", { taskName: "b", message: "m", profile: "reader" }, "rb"), (e: unknown) => {
    assert.ok(e instanceof SubagentsError);
    assert.equal(e.code, "CAPACITY_EXCEEDED");
    assert.match(e.message, /maxResidentWorkers 1/);
    const details = e.details as { capacity: string; resident: number; limits: SchedulerLimits };
    assert.equal(details.capacity, "resident_workers");
    assert.equal(details.resident, 1);
    assert.deepEqual(details.limits, { maxRunnable: 1, maxResidentWorkers: 1, maxOpenAgents: 32 });
    return true;
  });
});

test("open-agent CAPACITY_EXCEEDED reports the configured limits", async (t) => {
  const limits = limitsFrom(t, { maxRunnable: 1, maxResidentWorkers: 1, maxOpenAgents: 1 });
  const { sup } = mkSup({ limits });
  t.after(() => sup.shutdown());
  await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  await assert.rejects(() => sup.spawn("governor", { taskName: "b", message: "m", profile: "reader" }, "rb"), (e: unknown) => {
    assert.ok(e instanceof SubagentsError);
    assert.match(e.message, /maxOpenAgents \(1\)/);
    assert.deepEqual((e.details as { limits: SchedulerLimits }).limits, { maxRunnable: 1, maxResidentWorkers: 1, maxOpenAgents: 1 });
    return true;
  });
});
