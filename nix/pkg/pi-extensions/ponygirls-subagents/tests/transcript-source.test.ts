/**
 * What the transcript view reads from the supervisor: the session file, the
 * text still being generated, and the senders of delivered messages.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CtlWorker, gateSpec, mkSup, tick } from "./ctl-worker.ts";

test("a restored agent's transcript is its newest session file; a running one uses its worker's", async () => {
  const { sup, dir } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  const sessions = join(dir, "sessions", a.agentId);
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "old.jsonl"), "{}\n");
  writeFileSync(join(sessions, "restored-new.jsonl"), "{}\n");
  utimesSync(join(sessions, "old.jsonl"), new Date(1_000_000), new Date(1_000_000));
  assert.equal(sup.transcript("governor", a.agentId).sessionFile, join(sessions, "restored-new.jsonl"));

  const workers: CtlWorker[] = [];
  const b = mkSup({ factory: (o) => { const w = new CtlWorker(o.agentId); w.sessionFile = "/sessions/live.jsonl"; workers.push(w); return w; } });
  const live = await b.sup.spawn("governor", { taskName: "b", message: "m", profile: "reader" }, "rb");
  assert.equal(b.sup.transcript("governor", live.agentId).sessionFile, "/sessions/live.jsonl");
  assert.throws(() => b.sup.transcript(live.agentId, live.agentId), /FORBIDDEN/);
});

test("in-flight text is visible until its message completes or the run settles", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  const w = byAgent(a.agentId)[0]!;
  w.fire("preview", { text: "half a sen", partial: true });
  await tick();
  assert.equal(sup.transcript("governor", a.agentId).streaming, "half a sen");
  w.fire("preview", { text: "half a sentence.", partial: false });
  await tick();
  assert.equal(sup.transcript("governor", a.agentId).streaming, null);
  w.fire("preview", { text: "again", partial: true });
  await tick();
  assert.equal(sup.transcript("governor", a.agentId).streaming, "again");
  w.settle();
  await tick();
  assert.equal(sup.transcript("governor", a.agentId).streaming, null);
});

test("delivered messages carry their sender and whether they answer a question", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  const note = await sup.sendMessage("governor", a.agentId, "note", "fyi", {}, "n1");
  await byAgent(a.agentId)[0]!.question("which file?");
  const q = sup.pendingQuestions("governor").find((x) => x.from === a.agentId)!;
  const reply = await sup.sendMessage("user", a.agentId, "note", "this one", { replyTo: q.messageId }, "n2");
  const messages = sup.transcript("governor", a.agentId).messages;
  assert.deepEqual([messages.get(note.messageId), messages.get(reply.messageId)], [{ from: "governor", reply: false }, { from: "governor", reply: true }]);
});

test("each review's conversation is kept and shown with its gated agent and its reviewer", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { FileRunStore } = await import("../src/store.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-review-sessions-"));
  const factory = (o: { agentId: string }): CtlWorker => {
    const w = new CtlWorker(o.agentId);
    w.sessionFile = `/sessions/${o.agentId}/${Math.random().toString(36).slice(2)}.jsonl`;
    return w;
  };
  try {
    const workers: CtlWorker[] = [];
    const a = mkSup({ dir, store: new FileRunStore(dir, "root-1"), factory: (o) => { const w = factory(o); workers.push(w); return w; } });
    const g = await a.sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec() }, "rg");
    assert.equal(a.sup.list("governor").find((v) => v.id === g.agentId)!.gateTaskRunId, g.taskRunId);
    workers.find((w) => w.agentId === g.agentId)!.settle("succeeded", "answer");
    await tick();
    const reviewerId = a.sup.gateController.inspect(g.taskRunId)!.reviewerId!;
    const reviewer = workers.find((w) => w.agentId === reviewerId)!;
    await tick();
    const during = a.sup.list("governor");
    assert.deepEqual([during.find((v) => v.id === g.agentId)!.managedGateFor, during.find((v) => v.id === reviewerId)!.managedGateFor], [null, g.taskRunId], "only the reviewer is a gate reviewer");
    const expected = [{ reviewId: "review-1", taskRunId: g.taskRunId, candidateId: "candidate-1", model: "p/m", sessionFile: reviewer.sessionFile }];
    const pick = (src: { reviews: Array<{ reviewId: string; taskRunId: string; candidateId: string; model: string; sessionFile: string | null }> }) =>
      src.reviews.map(({ reviewId, taskRunId, candidateId, model, sessionFile }) => ({ reviewId, taskRunId, candidateId, model, sessionFile }));
    assert.deepEqual(pick(a.sup.transcript("governor", g.agentId)), expected);
    assert.deepEqual(pick(a.sup.transcript("governor", reviewerId)), expected);
    assert.equal(a.sup.transcript("governor", reviewerId).sessionFile, null, "a reviewer has no conversation of its own");
    reviewer.fire("preview", { text: "looks right", partial: true });
    await tick();
    assert.equal(a.sup.transcript("governor", g.agentId).reviews[0]!.streaming, "looks right");
    await a.sup.shutdown();
    const b = mkSup({ dir, store: new FileRunStore(dir, "root-1"), factory });
    if (b.sup.needsRecovery) await b.sup.recover();
    assert.deepEqual(pick(b.sup.transcript("governor", g.agentId)), expected, "reviews survive a restart");
    await b.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("after a restart an idle gate reviewer is shown settled, not queued", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { FileRunStore } = await import("../src/store.ts");
  const { approve } = await import("./ctl-worker.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-reviewer-restart-"));
  try {
    const a = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    const g = await a.sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec() }, "rg");
    a.byAgent(g.agentId)[0]!.settle("succeeded", "answer");
    await tick();
    const reviewerId = a.sup.gateController.inspect(g.taskRunId)!.reviewerId!;
    await a.byAgent(reviewerId)[0]!.decide(approve("candidate-1"));
    await tick(50);
    const before = a.sup.list("governor").find((v) => v.id === reviewerId)!.observed;
    await a.sup.shutdown();
    const b = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    if (b.sup.needsRecovery) await b.sup.recover();
    const after = b.sup.list("governor").find((v) => v.id === reviewerId)!.observed;
    assert.deepEqual({ before, after }, { before: "settled", after: "settled" });
    await b.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
