/**
 * Lifecycle regressions from the second adversarial review: stranded
 * queues, deferred owners, launch races, gate interrupts, and restart gaps.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRunStore } from "../src/store.ts";
import { blocked, gateSpec, mkSup, terminals, tick } from "./ctl-worker.ts";

const nest = { limits: { maxDepth: 2 }, policy: (p: { maxDepth: number; nesting: boolean }) => { p.maxDepth = 2; p.nesting = true; } };

test("R1a interrupting a gated main while its review runs ends the task interrupted", async () => {
  const { sup, byAgent } = mkSup({});
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
  byAgent(g.agentId)[0]!.settle("succeeded", "answer");
  await tick();
  const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
  assert.equal(byAgent(reviewerId).length, 1, "reviewer running");
  await sup.interrupt("governor", g.agentId, "int");
  await tick();
  assert.deepEqual(terminals(sup, g.taskRunId), ["interrupted"]);
});

test("R1b interrupting the running reviewer leaves an interrupted, resumable review", async () => {
  const { sup, byAgent } = mkSup({});
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
  byAgent(g.agentId)[0]!.settle("succeeded", "answer");
  await tick();
  const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
  await sup.interrupt("governor", reviewerId, "int-r");
  await tick();
  const st = sup.gateController.inspect(g.taskRunId)!;
  assert.deepEqual({ terminal: st.terminal, review: st.review?.status ?? null, terminals: terminals(sup, g.taskRunId) }, { terminal: null, review: "interrupted", terminals: [] });
});

test("R2a a task queued on an agent that is then closed gets a terminal outcome", async () => {
  const { sup } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  const t2 = await sup.sendMessage("governor", a.agentId, "task", "second", {}, "ra2");
  await sup.close("governor", a.agentId, "ca");
  assert.deepEqual(terminals(sup, a.taskRunId), ["interrupted"]);
  const j = await sup.wait("governor", 0, 300, [{ agentId: a.agentId, taskRunId: t2.taskRunId! }], "all_settled");
  assert.deepEqual({ t2: terminals(sup, t2.taskRunId!), completed: j.completed }, { t2: ["interrupted"], completed: true });
});

test("R2b close of a worker that ignores interrupt still yields one terminal outcome", { timeout: 30_000 }, async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  byAgent(a.agentId)[0]!.settleOnInterrupt = false;
  await sup.close("governor", a.agentId, "ca"); // waits CLOSE_JOIN_TIMEOUT_MS (15 s)
  await tick(50);
  assert.equal(terminals(sup, a.taskRunId).length, 1, "closed run has no task.terminal");
});

test("R3 a task queued behind a run whose worker crashed is eventually dispatched", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  const t2 = await sup.sendMessage("governor", a.agentId, "task", "second", {}, "ra2");
  byAgent(a.agentId)[0]!.crash();
  await tick(50);
  assert.deepEqual(terminals(sup, a.taskRunId), ["failed"]);
  const j = await sup.wait("governor", 0, 500, [{ agentId: a.agentId, taskRunId: t2.taskRunId! }], "all_settled");
  assert.deepEqual({ workers: byAgent(a.agentId).length, current: sup.list("governor")[0]!.currentTaskRunId, joinCompleted: j.completed, pendingIntent: sup.list("governor")[0]!.pendingIntent },
    { workers: 2, current: t2.taskRunId, joinCompleted: false, pendingIntent: "running" });
});

test("R4 a parked (never launched) startup survives a restart as a dispatchable task", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rr-parked-"));
  try {
    const a = mkSup({ dir, store: new FileRunStore(dir, "root-1"), limits: { maxRunnable: 1 } });
    await a.sup.spawn("governor", { taskName: "x", message: "mx", profile: "reader" }, "rx");
    const p = await a.sup.spawn("governor", { taskName: "p", message: "PARKED TASK", profile: "reader" }, "rp");
    assert.equal(a.byAgent(p.agentId).length, 0, "parked");
    await a.sup.shutdown();
    const b = mkSup({ dir, store: new FileRunStore(dir, "root-1"), limits: { maxRunnable: 1 } });
    const report = await b.sup.recover();
    let dispatchErr: string | null = null;
    try {
      await b.sup.dispatchPending("governor", p.agentId, p.taskRunId);
    } catch (e) {
      dispatchErr = (e as Error).message;
    }
    assert.deepEqual({ requeued: report.requeued.includes(p.taskRunId), terminals: terminals(b.sup, p.taskRunId), dispatchErr },
      { requeued: true, terminals: [], dispatchErr: null });
    await b.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R5 an owner joining descendants at crash gets a terminal outcome after recovery", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rr-join-"));
  try {
    const a = mkSup({ dir, store: new FileRunStore(dir, "root-1"), ...nest });
    const parent = await a.sup.spawn("governor", { taskName: "p", message: "m", profile: "reader" }, "rp");
    const kid = await a.sup.spawn(parent.agentId, { taskName: "c", message: "m", profile: "reader" }, "rc");
    a.byAgent(kid.agentId)[0]!.settleOnInterrupt = false;
    a.byAgent(parent.agentId)[0]!.settle("succeeded", "parent done");
    await tick();
    assert.deepEqual(terminals(a.sup, parent.taskRunId), [], "owner deferred behind its descendant");
    await a.sup.shutdown();
    const b = mkSup({ dir, store: new FileRunStore(dir, "root-1"), ...nest });
    await b.sup.recover();
    assert.deepEqual(terminals(b.sup, kid.taskRunId), ["interrupted"]);
    const j = await b.sup.wait("governor", 0, 300, [{ agentId: parent.agentId, taskRunId: parent.taskRunId }], "all_settled");
    assert.deepEqual({ parent: terminals(b.sup, parent.taskRunId).length, completed: j.completed }, { parent: 1, completed: true });
    await b.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R6a interrupt racing a pumped parked startup is not lost", async () => {
  const { sup, byAgent } = mkSup({ limits: { maxRunnable: 1 } });
  const x = await sup.spawn("governor", { taskName: "x", message: "mx", profile: "reader" }, "rx");
  const a = await sup.spawn("governor", { taskName: "a", message: "ma", profile: "reader" }, "ra");
  byAgent(x.agentId)[0]!.settle(); // event queued on the controller chain
  await sup.interrupt("governor", a.agentId, "ia"); // queued right behind it
  await tick(50);
  const v = sup.list("governor").find((r) => r.id === a.agentId)!;
  assert.deepEqual({ terminals: terminals(sup, a.taskRunId), observed: v.observed }, { terminals: ["interrupted"], observed: "settled" });
});

test("R6b close racing a pumped parked startup still publishes the task's terminal", async () => {
  const { sup, byAgent } = mkSup({ limits: { maxRunnable: 1 } });
  const x = await sup.spawn("governor", { taskName: "x", message: "mx", profile: "reader" }, "rx");
  const a = await sup.spawn("governor", { taskName: "a", message: "ma", profile: "reader" }, "ra");
  byAgent(x.agentId)[0]!.settle();
  await sup.close("governor", a.agentId, "ca");
  await tick(50);
  assert.deepEqual(terminals(sup, a.taskRunId), ["interrupted"]);
});

test("R7 a task accepted while reload fails for capacity is not stranded", async () => {
  const { sup, byAgent } = mkSup({ limits: { maxResidentWorkers: 1 } });
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  byAgent(a.agentId)[0]!.settle();
  await tick();
  await sup.evictWorker("governor", a.agentId);
  const b = await sup.spawn("governor", { taskName: "b", message: "m", profile: "reader" }, "rb");
  // No resident capacity while b runs: the task is accepted and waits.
  const sent = await sup.sendMessage("governor", a.agentId, "task", "follow-up", {}, "ra2");
  assert.equal(sup.list("governor").find((v) => v.id === a.agentId)!.pendingIntent, "task queued");
  byAgent(b.agentId)[0]!.settle();
  await tick(50);
  assert.equal(byAgent(a.agentId).length, 2, "a reloaded once capacity freed");
  assert.equal(sup.list("governor").find((v) => v.id === a.agentId)!.currentTaskRunId, sent.taskRunId);
});

test("R8 a wait never advances its cursor past messages it did not return", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  const w = byAgent(a.agentId)[0]!;
  for (let i = 0; i < 25; i++) await w.call("send_message", { target: "parent", message: `note ${i}`, mode: "note" });
  const seen: string[] = [];
  let cursor = 0;
  for (let i = 0; i < 3; i++) {
    const r = await sup.wait("governor", cursor, 100, null, "activity");
    seen.push(...r.messages.map((m) => m.text));
    cursor = r.cursor;
  }
  assert.equal(seen.length, 25, `received ${seen.length} of 25 notes`);
});

test("R9 a linked retry run interrupted mid-review by a restart can resume its review", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rr-retry-"));
  try {
    const a = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    const g = await a.sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
    a.byAgent(g.agentId)[0]!.settle("succeeded", "ANSWER");
    await tick();
    const reviewerId = a.sup.gateController.inspect(g.taskRunId)!.reviewerId!;
    await a.byAgent(reviewerId)[0]!.decide(blocked("candidate-1"));
    await tick();
    const retry = await a.sup.manageGate("governor", { kind: "retry_review", taskRunId: g.taskRunId, candidateId: "candidate-1", gate: gateSpec(3) }, "cmd-retry");
    await tick();
    assert.equal(a.byAgent(reviewerId).length, 2, "retry review running");
    await a.sup.shutdown();
    const b = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    const st = b.sup.gateController.inspect(retry.taskRunId)!;
    const view = b.sup.list("governor").find((v) => v.id === g.agentId)!;
    let resumeErr: string | null = null;
    try {
      await b.sup.manageGate("governor", { kind: "resume_review", taskRunId: retry.taskRunId, reviewId: st.review?.reviewId ?? "review-1" }, "cmd-res");
    } catch (e) {
      resumeErr = (e as Error).message;
    }
    assert.deepEqual({ reviewerId: st.reviewerId, current: view.currentTaskRunId, resumeErr }, { reviewerId, current: retry.taskRunId, resumeErr: null });
    await b.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R10 a task sent to an owner still joining descendants queues; the deferred run keeps its terminal", async () => {
  const { sup, byAgent } = mkSup(nest);
  const parent = await sup.spawn("governor", { taskName: "p", message: "m", profile: "reader" }, "rp");
  const kid = await sup.spawn(parent.agentId, { taskName: "c", message: "m", profile: "reader" }, "rc");
  const kw = byAgent(kid.agentId)[0]!;
  kw.settleOnInterrupt = false;
  const pw = byAgent(parent.agentId)[0]!;
  pw.settle("succeeded", "T1 done");
  await tick();
  assert.deepEqual(terminals(sup, parent.taskRunId), [], "T1 deferred behind its descendant");
  const t2 = await sup.sendMessage("governor", parent.agentId, "task", "T2", {}, "rp2");
  await tick();
  const dispatchedWhileT1Open = pw.delivered.some((d) => d.text === "T2");
  if (dispatchedWhileT1Open) {
    pw.settle("succeeded", "T2 done"); // overwrites the deferred T1 continuation
    await tick();
  }
  kw.settle("interrupted");
  await tick();
  assert.deepEqual({ dispatchedWhileT1Open, t1: terminals(sup, parent.taskRunId) }, { dispatchedWhileT1Open: false, t1: ["succeeded"] });
  void t2;
});

test("R11 a repair reserved but undispatched at a restart is dispatched by recovery", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rr-repair-"));
  try {
    const a = mkSup({ dir, store: new FileRunStore(dir, "root-1"), limits: { maxRunnable: 1 } });
    const g = await a.sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
    a.byAgent(g.agentId)[0]!.settle("succeeded", "answer");
    await tick();
    const reviewerId = a.sup.gateController.inspect(g.taskRunId)!.reviewerId!;
    await a.sup.spawn("governor", { taskName: "b", message: "m", profile: "reader" }, "rb"); // parked behind the reviewer
    const { revise } = await import("./ctl-worker.ts");
    await a.byAgent(reviewerId)[0]!.decide(revise("candidate-1"));
    await tick();
    assert.equal(a.sup.gateController.inspect(g.taskRunId)!.repairReserved, true);
    assert.equal(a.byAgent(g.agentId)[0]!.delivered.filter((d) => d.mode === "repair").length, 0, "repair parked (b took the lease)");
    await a.sup.shutdown();
    const b = mkSup({ dir, store: new FileRunStore(dir, "root-1"), limits: { maxRunnable: 1 } });
    await b.sup.recover();
    await tick(100);
    const view = b.sup.list("governor").find((v) => v.id === g.agentId)!;
    const repairs = b.byAgent(g.agentId).flatMap((w) => w.delivered.filter((d) => d.mode === "repair"));
    assert.deepEqual({ repairs: repairs.length, intent: view.pendingIntent, runnable: b.sup.admissionScheduler.runnableCount }, { repairs: 1, intent: "running", runnable: 1 });
    await b.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R2c closing a descendant that ignores interrupt does not strand its owner's deferred terminal", { timeout: 30_000 }, async () => {
  const { sup, byAgent } = mkSup(nest);
  const parent = await sup.spawn("governor", { taskName: "p", message: "m", profile: "reader" }, "rp");
  const kid = await sup.spawn(parent.agentId, { taskName: "c", message: "m", profile: "reader" }, "rc");
  byAgent(kid.agentId)[0]!.settleOnInterrupt = false;
  byAgent(parent.agentId)[0]!.settle("succeeded", "parent done");
  await tick();
  await sup.close("governor", kid.agentId, "ck");
  await tick(50);
  assert.deepEqual({ kid: terminals(sup, kid.taskRunId).length, parent: terminals(sup, parent.taskRunId).length, parentIntent: sup.list("governor").find((v) => v.id === parent.agentId)!.pendingIntent }, { kid: 1, parent: 1, parentIntent: "settled" });
});

test("R3b a follow-up task sent to a gated main evicted for its reviewer runs after the gate passes", async () => {
  const { approve } = await import("./ctl-worker.ts");
  const { sup, byAgent } = mkSup({ limits: { maxResidentWorkers: 1 } });
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec(3) }, "rg");
  byAgent(g.agentId)[0]!.settle("succeeded", "answer");
  await tick();
  assert.equal(byAgent(g.agentId)[0]!.killed, true, "main evicted for the reviewer");
  const t2 = await sup.sendMessage("governor", g.agentId, "task", "follow-up", {}, "rg2");
  const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
  await byAgent(reviewerId)[0]!.decide(approve("candidate-1"));
  await tick(100);
  assert.deepEqual(terminals(sup, g.taskRunId), ["passed"]);
  const v = sup.list("governor").find((x) => x.id === g.agentId)!;
  assert.deepEqual({ current: v.currentTaskRunId, intent: v.pendingIntent, workers: byAgent(g.agentId).length }, { current: t2.taskRunId, intent: "running", workers: 2 });
});
