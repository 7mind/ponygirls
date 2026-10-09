/**
 * Controller regressions: gates, scheduling, waits, nesting, and structured
 * ownership, driven by manually controlled workers. Each case reproduces a
 * defect found by adversarial review of the initial implementation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRunStore } from "../src/store.ts";
import type { Supervisor } from "../src/supervisor.ts";
import { GitWorkspaceManager } from "../src/workspace.ts";
import { approve, blocked, gateSpec, mkSup, revise, terminals, tick } from "./ctl-worker.ts";
import { until } from "./fake-worker.ts";

function running(sup: ReturnType<typeof mkSup>["sup"]): string[] {
  return sup.list("governor").filter((v) => v.observed === "running" || v.observed === "starting").map((v) => v.path);
}

async function noUnhandled<T>(fn: () => Promise<T>): Promise<T> {
  const rejections: string[] = [];
  const h = (e: unknown): void => {
    rejections.push(String((e as Error)?.message ?? e));
  };
  process.on("unhandledRejection", h);
  try {
    const out = await fn();
    await tick(30);
    assert.deepEqual(rejections, [], "controller failures must not escape as unhandled rejections");
    return out;
  } finally {
    process.off("unhandledRejection", h);
  }
}

// -- gates ---------------------------------------------------------------------

// regression: newer task must not start before old gated candidate capture; obsolete repair must not retarget newer phase.
// BA @regression(lifecycle): deterministic CtlWorker, real Supervisor ordering.
// Minimal read-only glassbox (justified): repair-phase direct writes publish no
// task.phase event, so the journal cannot prove actual phase invariance. Narrow
// structural read, no `any`, no new public API.
function actualState(sup: Supervisor, agentId: string): { taskPhase: string; currentTaskRunId: string | null } {
  const agents = (sup as unknown as { agents: Map<string, { record: { taskPhase: string; currentTaskRunId: string | null } }> }).agents;
  const rt = agents.get(agentId);
  if (!rt) throw new Error(`agent missing: ${agentId}`);
  return { taskPhase: rt.record.taskPhase, currentTaskRunId: rt.record.currentTaskRunId };
}

test("queued newer/third wait across gated capture/review; legit repair+approve passes then N/third dispatch (no stranding claim)", async () => {
  const { sup, byAgent } = mkSup({});
  const g = await sup.spawn("governor", { taskName: "g", message: "old", profile: "reader", gate: gateSpec(3) }, "rg");
  const main = byAgent(g.agentId)[0]!;
  const newer = await sup.sendMessage("governor", g.agentId, "task", "newer work", {}, "req-newer");
  const third = await sup.sendMessage("governor", g.agentId, "task", "third work", {}, "req-third");
  assert.ok(newer.taskRunId && third.taskRunId);
  main.settle("succeeded", "old done");
  // Positive: old candidate captured.
  await until(() => sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.some((x) => x.kind === "gate.candidate" && (x.body as Record<string, unknown>)["taskRunId"] === g.taskRunId), 8000, "old candidate");
  const recs1 = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records;
  const candSeq = recs1.find((x) => x.kind === "gate.candidate" && (x.body as Record<string, unknown>)["taskRunId"] === g.taskRunId)?.seq;
  // N absent across capture/review: no generation.started for N, current still OLD.
  assert.equal(recs1.some((x) => x.kind === "generation.started" && (x.body as Record<string, unknown>)["taskRunId"] === newer.taskRunId), false, "N must be absent at capture");
  assert.equal(sup.list("governor").find((v) => v.id === g.agentId)?.currentTaskRunId, g.taskRunId, "current must still be OLD at capture");
  // Review running: N still absent, current still OLD.
  await until(() => (sup.gateController.inspect(g.taskRunId)?.review?.status ?? "") === "running", 8000, "review running");
  const recs2 = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records;
  assert.equal(recs2.some((x) => x.kind === "generation.started" && (x.body as Record<string, unknown>)["taskRunId"] === newer.taskRunId), false, "N must be absent during review");
  assert.equal(sup.list("governor").find((v) => v.id === g.agentId)?.currentTaskRunId, g.taskRunId, "current must still be OLD during review");
  const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
  // Real revise path → legit repair.
  await byAgent(reviewerId)[0]!.decide(revise("candidate-1"));
  await until(() => (sup.gateController.inspect(g.taskRunId)?.repairReserved ?? false) === true, 8000, "repair reserved");
  // Repair generation dispatched for OLD (same task run, newer generation).
  await until(() => sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.some((x) => x.kind === "generation.started" && (x.body as Record<string, unknown>)["taskRunId"] === g.taskRunId && Number((x.body as Record<string, unknown>)["generation"]) > 1), 8000, "repair gen started");
  main.settle("succeeded", "repaired work");
  await until(() => sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.some((x) => x.kind === "gate.candidate" && (x.body as Record<string, unknown>)["taskRunId"] === g.taskRunId && (x.body as { candidate?: { candidateId?: string } }).candidate?.candidateId === "candidate-2"), 8000, "round-2 candidate");
  // Round-2 review runs on the same reviewer identity (new execution): approve → passed.
  await until(() => byAgent(reviewerId).length > 1, 8000, "reviewer round-2");
  await byAgent(reviewerId)[1]!.decide(approve("candidate-2"));
  await until(() => terminals(sup, g.taskRunId).length > 0, 8000, "old terminal");
  assert.deepEqual(terminals(sup, g.taskRunId), ["passed"]);
  // Retry SAME frozen-candidate semantics unchanged: candidate-2 still names the old run's content.
  assert.equal(sup.gateController.inspect(g.taskRunId)?.candidate?.candidateId, "candidate-2");
  // N then THIRD dispatch/settle in order (positive waits, no time guesses).
  await until(() => sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.some((x) => x.kind === "generation.started" && (x.body as Record<string, unknown>)["taskRunId"] === newer.taskRunId), 8000, "N started post-pass");
  const candSeq2 = candSeq ?? 0;
  const nSeq = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((x) => x.kind === "generation.started" && (x.body as Record<string, unknown>)["taskRunId"] === newer.taskRunId)?.seq ?? 0;
  assert.ok(nSeq > candSeq2, "N must start after candidate capture");
  const oldTerminalSeq = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((x) => x.kind === "task.terminal" && (x.body as Record<string, unknown>)["taskRunId"] === g.taskRunId)?.seq ?? 0;
  assert.ok(oldTerminalSeq > 0, "OLD task.terminal must exist");
  assert.ok(nSeq > oldTerminalSeq, "N must start after OLD task.terminal (not just candidate)");
  main.settle("succeeded", "newer done");
  await until(() => terminals(sup, newer.taskRunId!).length > 0, 8000, "N terminal");
  await until(() => sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.some((x) => x.kind === "generation.started" && (x.body as Record<string, unknown>)["taskRunId"] === third.taskRunId), 8000, "third started");
  main.settle("succeeded", "third done");
  await until(() => terminals(sup, third.taskRunId!).length > 0, 8000, "third terminal");
  assert.deepEqual(terminals(sup, third.taskRunId), ["succeeded"]);
  // Supplemental only (not the lifecycle proof): direct stale GateHost call preserves ACTUAL phase/currentTask.
  // (The real Gate.applyDecision stale path is evidenced by baseline debug runs; post-H1 it is unreachable
  // without terminal, so the tracked proof is the full legit drain above plus this invariance.)
  const actualBefore = actualState(sup, g.agentId);
  await assert.rejects(async () => sup.startRepairExecution(g.agentId, g.taskRunId, "stale criticism"), /STALE_GENERATION/);
  const actualAfter = actualState(sup, g.agentId);
  assert.deepEqual(actualAfter, actualBefore, "stale repair must not mutate actual phase/currentTask");
  const phasesBefore = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((x) => x.kind === "task.phase").map((x) => `${x.seq}:${String((x.body as Record<string, unknown>)["taskRunId"]).slice(0, 8)}:${(x.body as Record<string, unknown>)["phase"]}`);
  const phasesAfter = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((x) => x.kind === "task.phase").map((x) => `${x.seq}:${String((x.body as Record<string, unknown>)["taskRunId"]).slice(0, 8)}:${(x.body as Record<string, unknown>)["phase"]}`);
  assert.deepEqual(phasesAfter, phasesBefore, "stale repair must append no task.phase");
  await sup.shutdown();
});

test("retry_review and bypass runs publish their own outcomes; results keep the deliverable", async () => {
  const { sup, byAgent } = mkSup({ policy: (p) => { p.gateBypassAllowed = true; } });
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
  byAgent(g.agentId)[0]!.settle("succeeded", "THE ANSWER");
  await tick();
  const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
  await byAgent(reviewerId)[0]!.decide(blocked("candidate-1"));
  await tick();
  assert.deepEqual(terminals(sup, g.taskRunId), ["gate_blocked"]);
  assert.equal(sup.read("governor", g.agentId, "result", 0, 1, null).result?.text, "THE ANSWER");
  const retry = await sup.manageGate("governor", { kind: "retry_review", taskRunId: g.taskRunId, candidateId: "candidate-1", gate: gateSpec(3) }, "cmd-retry");
  await tick();
  await byAgent(reviewerId)[1]!.decide(approve("candidate-1"));
  await tick();
  assert.deepEqual(terminals(sup, retry.taskRunId), ["passed"]);
  assert.deepEqual(terminals(sup, g.taskRunId), ["gate_blocked"], "the original outcome stays immutable");
  const joined = await sup.wait("governor", 0, 500, [{ agentId: g.agentId, taskRunId: retry.taskRunId }], "all_settled");
  assert.equal(joined.completed, true);
  const bypass = await sup.manageGate("governor", { kind: "bypass", taskRunId: retry.taskRunId, candidateId: "candidate-1", reason: "ship it" }, "cmd-bypass");
  assert.deepEqual(terminals(sup, bypass.taskRunId), ["gate_bypassed"]);
  const result = sup.read("governor", g.agentId, "result", 0, 1, null).result!;
  assert.equal(result.text, "THE ANSWER");
  assert.ok(result.detail.includes("ship it"));
  // An earlier run stays readable by its id.
  const first = sup.read("governor", g.agentId, "result", 0, 1, g.taskRunId).result!;
  assert.deepEqual({ outcome: first.outcome, text: first.text }, { outcome: "gate_blocked", text: "THE ANSWER" });
});

test("a gated spawn charges both identities up front; an exhausted budget rejects it cleanly", async () => {
  await noUnhandled(async () => {
    const { sup } = mkSup({ limits: { maxAgentsCreated: 1 } });
    await assert.rejects(() => sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg"), /CAPACITY_EXCEEDED/);
    assert.equal(sup.list("governor").length, 0);
    assert.equal(sup.admissionScheduler.residentCount, 0);
    assert.equal(sup.admissionScheduler.agentsCreatedCount, 0);
  });
});

test("at the resident limit the paused main is evicted so its reviewer can run", async () => {
  await noUnhandled(async () => {
    const { sup, byAgent } = mkSup({ limits: { maxResidentWorkers: 1 } });
    const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
    byAgent(g.agentId)[0]!.settle("succeeded", "answer");
    await tick();
    const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
    assert.equal(byAgent(reviewerId).length, 1, "the reviewer launched after evicting the paused main");
    await byAgent(reviewerId)[0]!.decide(approve("candidate-1"));
    await tick();
    assert.deepEqual(terminals(sup, g.taskRunId), ["passed"]);
  });
});

test("interrupting a gated main settles only after it stops, as interrupted", async () => {
  const { sup, byAgent } = mkSup({});
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
  const main = byAgent(g.agentId)[0]!;
  main.settleOnInterrupt = false; // acceptance does not imply termination
  await sup.interrupt("governor", g.agentId, "int");
  assert.deepEqual(terminals(sup, g.taskRunId), []);
  assert.equal(sup.list("governor").find((v) => v.id === g.agentId)?.pendingIntent, "interrupt pending");
  main.settle("succeeded", "late");
  await tick();
  assert.deepEqual(terminals(sup, g.taskRunId), ["interrupted"]);
});

test("a parked reviewer never launches after its gated task is interrupted", async () => {
  const { sup, workers, byAgent } = mkSup({ limits: { maxRunnable: 1 } });
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
  const b = await sup.spawn("governor", { taskName: "b", message: "m", profile: "reader" }, "rb"); // parked behind g
  byAgent(g.agentId)[0]!.settle(); // b takes the freed lease first; the review parks
  await tick();
  await sup.interrupt("governor", g.agentId, "int");
  assert.deepEqual(terminals(sup, g.taskRunId), ["interrupted"]);
  byAgent(b.agentId)[0]!.settle();
  await tick(50);
  const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
  assert.equal(byAgent(reviewerId).length, 0, "no reviewer worker for a cancelled review");
  assert.equal(workers.length, 2);
  assert.equal(sup.admissionScheduler.runnableCount, 0);
});

test("a reviewer that settles without a decision is a gate error and frees its worker", async () => {
  const { sup, byAgent } = mkSup({});
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
  byAgent(g.agentId)[0]!.settle();
  await tick();
  const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
  const reviewer = byAgent(reviewerId)[0]!;
  reviewer.settle("succeeded", "prose instead of a decision");
  await tick();
  assert.deepEqual(terminals(sup, g.taskRunId), ["gate_error"]);
  assert.equal(reviewer.killed, true);
});

test("a reviewer stopped after its decision keeps the usage it reported", async () => {
  const { sup, byAgent } = mkSup({});
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
  byAgent(g.agentId)[0]!.settle();
  await tick();
  const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
  await byAgent(reviewerId)[0]!.decide(approve("candidate-1"));
  await tick();
  const usage = sup.list("governor").find((v) => v.id === reviewerId)!.usage;
  assert.deepEqual(usage, { inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null, cost: 0.01, unknown: false });
});

test("an invalid decision ends the review: the reviewer stops and the detail names the defect once", async () => {
  const { sup, byAgent } = mkSup({});
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
  byAgent(g.agentId)[0]!.settle("succeeded", "6");
  await tick();
  const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
  const reviewer = byAgent(reviewerId)[0]!;
  // The prompt names evidence references with the real candidate id.
  assert.ok(reviewer.initText?.includes("candidate-1:answer"), "review prompt must show the exact evidence reference form");
  const bad = { ...revise("candidate-1"), blockers: [{ id: "F1", target: "x", problem: "p", requiredChange: "r", evidenceRefs: ["candidate:answer"] }] };
  const res = await reviewer.decide(bad);
  assert.equal(res.isError, true);
  await tick();
  assert.deepEqual(terminals(sup, g.taskRunId), ["gate_error"]);
  assert.equal(reviewer.killed, true, "no further reviewer inference after the gate ended");
  const detail = sup.read("governor", g.agentId, "result", 0, 1, null).result!.detail;
  assert.equal(detail.match(/GATE_PROTOCOL_ERROR/g)?.length, 1, detail);
});

test("a cap decrease that would orphan a running repair is rejected", async () => {
  const { sup, byAgent } = mkSup({});
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
  const main = byAgent(g.agentId)[0]!;
  main.settle();
  await tick();
  const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
  await byAgent(reviewerId)[0]!.decide(revise("candidate-1"));
  await tick();
  assert.equal(main.delivered.at(-1)?.mode, "repair", "repair generation running");
  await assert.rejects(() => sup.manageGate("governor", { kind: "set_limits", taskRunId: g.taskRunId, maxRounds: 1 }, "cmd-lim"), /RESERVED_ROUND_CONFLICT/);
  main.settle("succeeded", "fixed");
  await tick();
  const st = sup.gateController.inspect(g.taskRunId)!;
  assert.equal(st.roundsAdmitted, 2);
  assert.equal(st.review?.status, "running");
});

test("gated spawns without maxRounds use the named default; rejected ones allocate nothing", async () => {
  const { sup } = mkSup({ limits: { maxResidentWorkers: 2, maxAgentsCreated: 4 } });
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec() }, "rg");
  assert.equal(sup.gateController.inspect(g.taskRunId)?.spec.maxRounds, 3);
  for (const n of ["x1", "x2", "x3"]) {
    await assert.rejects(() => sup.spawn("governor", { taskName: n, message: "m", profile: "reader", gate: { ...gateSpec(3), model: { provider: "nope", id: "nope" } } }, `r-${n}`), /POLICY_DENIED/);
  }
  assert.equal(sup.admissionScheduler.agentsCreatedCount, 2);
  assert.equal(sup.admissionScheduler.residentCount, 1);
  await sup.spawn("governor", { taskName: "plain", message: "m", profile: "reader" }, "r-plain");
});

test("after a restart, limits persist, the reviewer is linked, and the review resumes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-gate-restart-"));
  try {
    const a = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    const g = await a.sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
    a.byAgent(g.agentId)[0]!.settle("succeeded", "answer");
    await tick();
    const reviewerId = a.sup.gateController.inspect(g.taskRunId)!.reviewerId!;
    await a.sup.manageGate("governor", { kind: "set_limits", taskRunId: g.taskRunId, maxRounds: 2 }, "cmd-lim");
    await a.sup.shutdown();
    const b = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    const st = b.sup.gateController.inspect(g.taskRunId)!;
    assert.equal(st.spec.maxRounds, 2);
    assert.equal(st.reviewerId, reviewerId);
    assert.equal(b.sup.gateController.isReviewer(reviewerId), true);
    await assert.rejects(() => b.sup.sendMessage("governor", reviewerId, "task", "other work", {}, "x1"), /FORBIDDEN/);
    assert.equal(st.review?.status, "interrupted");
    await b.sup.manageGate("governor", { kind: "resume_review", taskRunId: g.taskRunId, reviewId: st.review!.reviewId }, "cmd-res");
    await tick();
    await b.byAgent(reviewerId)[0]!.decide(approve("candidate-1"));
    await tick();
    assert.deepEqual(terminals(b.sup, g.taskRunId), ["passed"]);
    await b.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("closing a gated main closes its protected reviewer", async () => {
  const { sup, byAgent } = mkSup({});
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
  byAgent(g.agentId)[0]!.settle();
  await tick();
  await sup.close("governor", g.agentId, "cg");
  const reviewer = sup.list("governor").find((v) => v.path.endsWith("__gate"))!;
  assert.equal(reviewer.pendingIntent, "closed");
  assert.equal(sup.admissionScheduler.residentCount, 0);
  assert.equal(sup.admissionScheduler.runnableCount, 0);
});

test("closing an agent whose worker ignores the interrupt still settles its run", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  byAgent(a.agentId)[0]!.settleOnInterrupt = false;
  const closing = sup.close("governor", a.agentId, "ca");
  await closing;
  assert.deepEqual(terminals(sup, a.taskRunId), ["interrupted"]);
  assert.equal(sup.admissionScheduler.runnableCount, 0);
  assert.equal(sup.admissionScheduler.residentCount, 0);
});

// -- scheduling ------------------------------------------------------------------

test("a task sent to a parked agent queues behind its initial task (no second resident lease)", async () => {
  const { sup, byAgent } = mkSup({ limits: { maxRunnable: 1 } });
  const x = await sup.spawn("governor", { taskName: "x", message: "tx", profile: "reader" }, "rx");
  const a = await sup.spawn("governor", { taskName: "a", message: "INITIAL", profile: "reader" }, "ra"); // parked
  assert.equal(sup.admissionScheduler.residentCount, 2);
  await sup.sendMessage("governor", a.agentId, "task", "SECOND", {}, "ra2");
  assert.equal(sup.admissionScheduler.residentCount, 2);
  byAgent(x.agentId)[0]!.settle();
  await tick(50);
  assert.equal(byAgent(a.agentId)[0]?.initText, "INITIAL");
  byAgent(a.agentId)[0]!.settle();
  await tick(50);
  assert.equal(byAgent(a.agentId)[0]?.delivered.at(-1)?.text, "SECOND");
  await sup.close("governor", x.agentId, "cx");
  await sup.close("governor", a.agentId, "ca");
  assert.equal(sup.admissionScheduler.residentCount, 0, "resident lease leaked");
});

test("interrupting a parked agent ends its task without ever launching it", async () => {
  const { sup, byAgent } = mkSup({ limits: { maxRunnable: 1 } });
  const x = await sup.spawn("governor", { taskName: "x", message: "tx", profile: "reader" }, "rx");
  const a = await sup.spawn("governor", { taskName: "a", message: "ta", profile: "reader" }, "ra");
  await sup.interrupt("governor", a.agentId, "ia");
  assert.deepEqual(terminals(sup, a.taskRunId), ["interrupted"]);
  byAgent(x.agentId)[0]!.settle();
  await tick(50);
  assert.equal(byAgent(a.agentId).length, 0);
  assert.deepEqual(running(sup), []);
});

test("spawn evicts an idle settled worker at the resident limit", async () => {
  const { sup, byAgent } = mkSup({ limits: { maxResidentWorkers: 2 } });
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  const b = await sup.spawn("governor", { taskName: "b", message: "m", profile: "reader" }, "rb");
  byAgent(a.agentId)[0]!.settle();
  byAgent(b.agentId)[0]!.settle();
  await tick();
  await sup.spawn("governor", { taskName: "c", message: "m", profile: "reader" }, "rc");
  assert.equal(byAgent(a.agentId)[0]!.killed || byAgent(b.agentId)[0]!.killed, true);
});

test("an abrupt worker exit with an active tool job settles uncertain", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  const exec = sup.toolBroker as unknown as { executors: { host: { handler: (() => Promise<never>) | null } } };
  exec.executors.host.handler = () => new Promise<never>(() => {});
  const worker = byAgent(a.agentId)[0]!;
  void worker.call("read", { path: "x" });
  await tick();
  worker.crash();
  await tick();
  assert.deepEqual(terminals(sup, a.taskRunId), ["uncertain"]);
  assert.equal(sup.list("governor")[0]!.usage.unknown, true);
});

// -- waits ----------------------------------------------------------------------

test("a question preempts every settlement wait of its addressee, not just the first", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  const b = await sup.spawn("governor", { taskName: "b", message: "m", profile: "reader" }, "rb");
  const w1 = sup.wait("governor", 0, 2000, [{ agentId: a.agentId, taskRunId: a.taskRunId }], "all_settled");
  const w2 = sup.wait("governor", 0, 2000, [{ agentId: b.agentId, taskRunId: b.taskRunId }], "all_settled");
  await tick();
  await byAgent(a.agentId)[0]!.question("need input");
  const [r1, r2] = await Promise.all([w1, w2]);
  assert.equal(r1.reason, "needs_response");
  assert.equal(r2.reason, "needs_response");
  // The question text reaches the governor with the result.
  assert.ok(r1.messages.some((m) => m.requestReply && m.text === "need input"));
  const open = sup.list("governor").find((v) => v.id === a.agentId)?.openQuestion;
  assert.equal(open?.text, "need input");
});

test("a child's question wakes an activity wait targeted at that child", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  await tick();
  const cursor = sup.runStore.durableSeq();
  const pending = sup.wait("governor", cursor, 800, [{ agentId: a.agentId, taskRunId: null }], "activity");
  await byAgent(a.agentId)[0]!.question("blocking question");
  const r = await pending;
  assert.equal(r.completed, true);
  assert.equal(r.messages[0]?.text, "blocking question");
});

test("all_settled without targets waits for every unfinished run", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  const b = await sup.spawn("governor", { taskName: "b", message: "m", profile: "reader" }, "rb");
  await tick();
  const pending = sup.wait("governor", sup.runStore.durableSeq(), 2000, null, "all_settled");
  byAgent(a.agentId)[0]!.settle();
  await tick();
  byAgent(b.agentId)[0]!.settle();
  const r = await pending;
  assert.equal(r.completed, true);
  assert.deepEqual(sup.list("governor").map((v) => v.taskOutcome), ["succeeded", "succeeded"]);
});

// -- nesting through the real tool path --------------------------------------------

test("maxRunnable=1: a child spawns and waits through its tools; the wait yields the lease", async () => {
  const { sup, byAgent } = mkSup({ limits: { maxRunnable: 1, maxDepth: 2 }, policy: (p) => { p.maxDepth = 2; p.nesting = true; } });
  const parent = await sup.spawn("governor", { taskName: "p", message: "delegate", profile: "reader" }, "rp");
  const pw = byAgent(parent.agentId)[0]!;
  assert.ok(pw.initTools.includes("spawn_agent") && pw.initTools.includes("wait_agent"));
  const spawned = JSON.parse((await pw.call("spawn_agent", { task_name: "kid", message: "help", profile: "reader" })).content) as { agentId: string; taskRunId: string };
  assert.equal(byAgent(spawned.agentId).length, 0, "the child is parked behind its parent's lease");
  const waiting = pw.call("wait_agent", { targets: [{ agentId: spawned.agentId, taskRunId: spawned.taskRunId }], condition: "all_settled", timeout_ms: 5000 });
  await tick();
  const kid = byAgent(spawned.agentId)[0];
  assert.ok(kid, "the parked child launched on the lease its waiting parent released");
  kid.settle("succeeded", "kid result");
  const res = JSON.parse((await waiting).content) as { completed: boolean };
  assert.equal(res.completed, true);
  assert.equal(sup.admissionScheduler.runnableCount, 1, "the parent reacquired the lease before returning");
  assert.equal(sup.read(parent.agentId, spawned.agentId, "result", 0, 1, null).result?.text, "kid result");
});

test("a child owner joins its active descendants before publishing its own outcome", async () => {
  const { sup, byAgent } = mkSup({ limits: { maxDepth: 2 }, policy: (p) => { p.maxDepth = 2; p.nesting = true; } });
  const parent = await sup.spawn("governor", { taskName: "p", message: "m", profile: "reader" }, "rp");
  const kid = await sup.spawn(parent.agentId, { taskName: "c", message: "m", profile: "reader" }, "rc");
  const kidWorker = byAgent(kid.agentId)[0]!;
  kidWorker.settleOnInterrupt = false;
  byAgent(parent.agentId)[0]!.settle("succeeded", "parent done");
  await tick();
  assert.deepEqual(terminals(sup, parent.taskRunId), [], "the owner waits for its descendant");
  kidWorker.settle("interrupted");
  await tick();
  assert.deepEqual(terminals(sup, kid.taskRunId), ["interrupted"]);
  assert.deepEqual(terminals(sup, parent.taskRunId), ["succeeded"]);
});

// -- recovery and replay ----------------------------------------------------------

test("a run lost after an earlier success still gets its terminal outcome on recovery", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-replay-"));
  try {
    const a = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    const t1 = await a.sup.spawn("governor", { taskName: "t", message: "one", profile: "reader" }, "r1");
    a.byAgent(t1.agentId)[0]!.settle("succeeded", "first");
    await tick();
    const t2 = await a.sup.sendMessage("governor", t1.agentId, "task", "two", {}, "r2");
    await tick();
    await a.sup.shutdown(); // T2 in flight
    const b = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    assert.equal(b.sup.needsRecovery, true);
    const report = await b.sup.recover();
    assert.deepEqual(report.settled, [t2.taskRunId!]);
    assert.deepEqual(terminals(b.sup, t2.taskRunId!), ["interrupted"]);
    const joined = await b.sup.wait("governor", 0, 500, [{ agentId: t1.agentId, taskRunId: t2.taskRunId! }], "all_settled");
    assert.equal(joined.completed, true);
    assert.equal(b.sup.list("governor")[0]!.usage.unknown, true, "usage of a lost generation is unknown, never zero");
    // A replacement after recovery publishes its own outcome too.
    const t3 = await b.sup.sendMessage("governor", t1.agentId, "task", "three", {}, "r3");
    await tick();
    b.byAgent(t1.agentId)[0]!.settle("succeeded", "third");
    await tick();
    assert.deepEqual(terminals(b.sup, t3.taskRunId!), ["succeeded"]);
    await b.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("questions survive replay with their text and addressee", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-qreplay-"));
  try {
    const a = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    const t = await a.sup.spawn("governor", { taskName: "t", message: "m", profile: "reader" }, "r1");
    await a.byAgent(t.agentId)[0]!.question("which branch?");
    await a.sup.shutdown();
    const b = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    const open = b.sup.pendingQuestions("governor");
    assert.equal(open.length, 1);
    assert.equal(open[0]!.text, "which branch?");
    assert.equal(open[0]!.to, "governor");
    await b.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -- workspaces ---------------------------------------------------------------------

test("a writer spawn refused for a dirty checkout leaves no worktree behind", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-dirty-"));
  try {
    const checkout = join(dir, "checkout");
    mkdirSync(checkout, { recursive: true });
    spawnSync("git", ["init", "-q", checkout]);
    spawnSync("git", ["-C", checkout, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base"]);
    writeFileSync(join(checkout, "dirty.txt"), "uncommitted\n");
    const { sup } = mkSup({
      dir: join(dir, "root"),
      workspace: new GitWorkspaceManager(),
      policy: (p) => { p.repos = [{ repoId: "r1", checkoutPath: checkout, readRoots: [checkout], allowWriters: true }]; },
    });
    await assert.rejects(() => sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", isolation: "sandbox", repoId: "r1" }, "rw"), /CONFLICT/);
    const worktrees = join(dir, "root", "worktrees");
    assert.deepEqual(readdirSync(worktrees), []);
    assert.equal(sup.admissionScheduler.residentCount, 0);
    assert.equal(sup.admissionScheduler.agentsCreatedCount, 0);
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

