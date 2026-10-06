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

test("a gate reviewer's conversation is disposable; its gated agent names the gated run", async () => {
  const { sup } = mkSup({});
  const g = await sup.spawn("governor", { taskName: "g", message: "m", profile: "reader", gate: gateSpec() }, "rg");
  const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
  assert.deepEqual({ ephemeral: sup.transcript("governor", reviewerId).ephemeral, file: sup.transcript("governor", reviewerId).sessionFile }, { ephemeral: true, file: null });
  assert.equal(sup.list("governor").find((v) => v.id === g.agentId)!.gateTaskRunId, g.taskRunId);
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
