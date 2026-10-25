/** BG, specified: deterministic workers exercise the public supervisor contract. */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { FileRunStore, InMemoryRunStore } from "../src/store.ts";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeGateSpec } from "../src/gate.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { approve, blocked, gateSpec, mkSup, revise, terminals, tick } from "./ctl-worker.ts";
import { until } from "./fake-worker.ts";

const panel = () => ({
  prompt: "shared rubric",
  thinkingLevel: "high",
  reviewers: [{ model: { provider: "p", id: "m" } }, { model: { provider: "p", id: "other" }, prompt: "independent rubric" }],
});
const setup = (limits: Record<string, number> = {}) => mkSup({ limits, policy: (p) => { p.allowedModels = null; } });
const reviewers = (h: ReturnType<typeof mkSup>) => h.sup.list("governor").filter((v) => v.managedGateFor !== null);
async function reviewing(h: ReturnType<typeof mkSup>, taskRunId: string): Promise<void> {
  await until(() => h.sup.list("governor").some((v) => v.gateTaskRunId === taskRunId && v.pendingIntent === "reviewing"));
}
async function cleanup(h: ReturnType<typeof mkSup>): Promise<void> {
  await h.sup.shutdown();
  rmSync(h.dir, { recursive: true, force: true });
}

test("panel normalization resolves shared and independent prompts; every model needs authority", () => {
  const p = defaultSupervisorPolicy();
  p.allowedModels = null;
  const normalized = normalizeGateSpec(panel(), p);
  assert.ok(normalized.ok);
  assert.deepEqual(normalized.spec.reviewers.map((r) => r.prompt), ["shared rubric", "independent rubric"]);
  const independent = normalizeGateSpec({ reviewers: [
    { model: { provider: "p", id: "m" }, thinkingLevel: "high", prompt: "first rubric" },
    { model: { provider: "p", id: "m" }, thinkingLevel: "low", prompt: "second rubric" },
  ] }, p);
  assert.ok(independent.ok);
  assert.deepEqual(independent.spec.reviewers.map((r) => r.prompt), ["first rubric", "second rubric"]);
  assert.equal(normalizeGateSpec({ ...gateSpec(), maxRounds: 1 }, p, "review").ok, false);
  assert.equal(normalizeGateSpec({ ...gateSpec(), checks: [] }, p, "review").ok, false);
  assert.equal(normalizeGateSpec({ ...gateSpec(), promisedOutputs: [] }, p, "review").ok, false);
  p.allowedModels = [{ provider: "p", id: "m" }];
  assert.equal(normalizeGateSpec(panel(), p).ok, false);
  for (const invalid of [
    { reviewers: [] },
    { reviewers: [{ model: { provider: "p", id: "m" }, thinkingLevel: "high" }] },
    { ...panel(), model: { provider: "p", id: "m" } },
  ]) assert.equal(normalizeGateSpec(invalid, p).ok, false);
});

test("a gate waits for the entire panel, concatenates objections, then repairs once", async () => {
  const h = setup();
  try {
    const g = await h.sup.spawn("governor", { taskName: "panel", message: "work", profile: "reader", gate: panel() }, "spawn");
    h.byAgent(g.agentId)[0]!.settle("succeeded", "answer");
    await reviewing(h, g.taskRunId);
    const rs = reviewers(h);
    assert.equal(rs.length, 2);
    await until(() => rs.every((r) => h.byAgent(r.id)[0]?.initText != null));
    assert.match(h.byAgent(rs[0]!.id)[0]!.initText!, /shared rubric/);
    assert.doesNotMatch(h.byAgent(rs[0]!.id)[0]!.initText!, /independent rubric/);
    assert.match(h.byAgent(rs[1]!.id)[0]!.initText!, /independent rubric/);
    await h.byAgent(rs[1]!.id)[0]!.decide({ ...revise("candidate-1"), blockers: [{ id: "F1", target: "answer", problem: "second objection", requiredChange: "fix second", evidenceRefs: ["candidate-1:answer"] }] });
    await tick();
    assert.equal(h.byAgent(g.agentId)[0]!.delivered.length, 0);
    assert.deepEqual(terminals(h.sup, g.taskRunId), []);
    await h.byAgent(rs[0]!.id)[0]!.decide({ ...revise("candidate-1"), blockers: [{ id: "F1", target: "answer", problem: "first objection", requiredChange: "fix first", evidenceRefs: ["candidate-1:answer"] }] });
    await until(() => h.byAgent(g.agentId)[0]!.delivered.length === 1);
    const criticism = h.byAgent(g.agentId)[0]!.delivered[0]!.text;
    assert.match(criticism, /first objection/);
    assert.match(criticism, /second objection/);
    assert.ok(criticism.indexOf("first objection") < criticism.indexOf("second objection"));
    h.byAgent(g.agentId)[0]!.settle("succeeded", "repaired");
    await until(() => rs.every((r) => h.byAgent(r.id).length === 2));
    await h.byAgent(rs[0]!.id)[1]!.decide(approve("candidate-2"));
    assert.deepEqual(terminals(h.sup, g.taskRunId), []);
    await h.byAgent(rs[1]!.id)[1]!.decide(approve("candidate-2"));
    await until(() => terminals(h.sup, g.taskRunId).length === 1);
    assert.deepEqual(terminals(h.sup, g.taskRunId), ["passed"]);
    assert.equal(h.sup.gateController.inspect(g.taskRunId)!.roundsAdmitted, 2);
  } finally { await cleanup(h); }
});

test("review-only returns all feedback, including blocked and failed reviews, without a repair", async () => {
  const h = setup();
  try {
    const g = await h.sup.spawn("governor", { taskName: "advisory", message: "work", profile: "reader", review: panel() }, "spawn");
    h.byAgent(g.agentId)[0]!.settle("succeeded", "answer");
    await reviewing(h, g.taskRunId);
    const rs = reviewers(h);
    await until(() => rs.every((r) => h.byAgent(r.id)[0]?.initText != null));
    await h.byAgent(rs[0]!.id)[0]!.decide({ ...blocked("candidate-1"), reason: "needs dataset", missingPrerequisites: ["dataset"] });
    h.byAgent(rs[1]!.id)[0]!.crash();
    await until(() => terminals(h.sup, g.taskRunId).length === 1);
    assert.deepEqual(terminals(h.sup, g.taskRunId), ["succeeded"]);
    assert.equal(h.byAgent(g.agentId)[0]!.delivered.length, 0);
    assert.equal(h.sup.read("governor", g.agentId, "result", 0, 1, null).result!.text, "answer");
    const report = h.sup.readReviews("governor", g.agentId, null, { offset: 0, length: null }, 0).result!;
    assert.match(report.text, /needs dataset/);
    assert.match(report.text, /dataset/);
    assert.match(report.text, /failed/);
    assert.match(report.text, /p\/other/);
  } finally { await cleanup(h); }
});

test("a panel can drain with one runnable and one resident slot", async () => {
  const h = setup({ maxRunnable: 1, maxResidentWorkers: 1 });
  try {
    const g = await h.sup.spawn("governor", { taskName: "serial", message: "work", profile: "reader", gate: panel() }, "spawn");
    h.byAgent(g.agentId)[0]!.settle();
    const completed = new Set<string>();
    while (completed.size < reviewers(h).length) {
      await until(() => reviewers(h).some((r) => !completed.has(r.id) && h.byAgent(r.id)[0]?.initText != null));
      const r = reviewers(h).find((r) => !completed.has(r.id) && h.byAgent(r.id)[0]?.initText != null)!;
      completed.add(r.id);
      await h.byAgent(r.id)[0]!.decide(approve("candidate-1"));
    }
    await until(() => terminals(h.sup, g.taskRunId).length === 1);
    assert.deepEqual(terminals(h.sup, g.taskRunId), ["passed"]);
  } finally { await cleanup(h); }
});

test("panel creation is atomically capacity-checked and gate/review are mutually exclusive", async () => {
  const h = setup({ maxOpenAgents: 2 });
  try {
    await assert.rejects(h.sup.spawn("governor", { taskName: "large", message: "work", profile: "reader", gate: panel() }, "a"), /CAPACITY_EXCEEDED/);
    assert.deepEqual(h.sup.list("governor"), []);
    await assert.rejects(h.sup.spawn("governor", { taskName: "both", message: "work", profile: "reader", gate: gateSpec(), review: gateSpec() }, "b"), /INVALID/);
    const g = await h.sup.spawn("governor", { taskName: "single", message: "work", profile: "reader", review: gateSpec() }, "c");
    assert.ok(g.agentId);
  } finally { await cleanup(h); }
});

test("fresh attach preserves completed panel feedback and resumes only missing reviewers", async () => {
  const a = setup();
  const dir = a.dir;
  await a.sup.shutdown();
  const storePath = join(dir, "durable");
  const first = mkSup({ dir, store: new FileRunStore(storePath, "root-1"), policy: (p) => { p.allowedModels = null; } });
  const g = await first.sup.spawn("governor", { taskName: "recover", message: "work", profile: "reader", gate: panel() }, "spawn");
  first.byAgent(g.agentId)[0]!.settle();
  await reviewing(first, g.taskRunId);
  const rs = reviewers(first);
  await until(() => rs.every((r) => first.byAgent(r.id).length > 0));
  await first.byAgent(rs[0]!.id)[0]!.decide(approve("candidate-1"));
  await tick();
  await first.sup.shutdown();
  const second = mkSup({ dir, store: new FileRunStore(storePath, "root-1"), policy: (p) => { p.allowedModels = null; } });
  try {
    await second.sup.recover();
    assert.equal(second.workers.length, 0);
    const state = second.sup.gateController.inspect(g.taskRunId)!;
    await second.sup.manageGate("governor", { kind: "resume_review", taskRunId: g.taskRunId, reviewId: state.review!.reviewId }, "resume");
    await until(() => second.byAgent(rs[1]!.id).length > 0);
    assert.equal(second.byAgent(rs[0]!.id).length, 0);
    await second.byAgent(rs[1]!.id)[0]!.decide(approve("candidate-1"));
    await until(() => terminals(second.sup, g.taskRunId).length === 1);
    assert.deepEqual(terminals(second.sup, g.taskRunId), ["passed"]);
    const report = second.sup.readReviews("governor", g.agentId, g.taskRunId, { offset: 0, length: null }, 0).result!;
    assert.match(report.text, /p\/m/);
    assert.match(report.text, /p\/other/);
  } finally { await cleanup(second); }
});

for (const storage of ["memory", "file"] as const) {
  test(`[${storage}] all escaped review text pages exactly and survives a later task`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "subagents-report-"));
    const h = mkSup({ dir, store: storage === "file" ? new FileRunStore(join(dir, "store"), "root-1") : new InMemoryRunStore("root-1"), policy: (p) => { p.allowedModels = null; } });
    try {
      const g = await h.sup.spawn("governor", { taskName: "report", message: "work", profile: "reader", review: panel() }, "spawn");
      h.byAgent(g.agentId)[0]!.settle("succeeded", "deliverable");
      await reviewing(h, g.taskRunId);
      const rs = reviewers(h);
      await until(() => rs.every((r) => h.byAgent(r.id)[0]?.initText != null));
      const problem = '\\"\nlarge feedback '.repeat(2500);
      const decisions = rs.map((_, i) => ({ ...revise("candidate-1"), blockers: [{ id: "F1", target: "answer", problem: `${i}:${problem}`, requiredChange: "fix", evidenceRefs: ["candidate-1:answer"] }] }));
      for (const i of [1, 0]) await h.byAgent(rs[i]!.id)[0]!.decide(decisions[i]!);
      await until(() => terminals(h.sup, g.taskRunId).length === 1);
      const expected = rs.map((r, i) => `## Round 1 · reviewer ${i + 1} · ${r.model} · ${r.id}\nCandidate candidate-1\n${JSON.stringify(decisions[i], null, 2)}`).join("\n\n");
      const readAll = (): string => {
        let offset = 0;
        let text = "";
        for (;;) {
          const reply = h.sup.readReviews("governor", g.agentId, g.taskRunId, { offset, length: null }, 0);
          assert.ok(JSON.stringify(reply).length <= 24_000);
          assert.equal(reply.result!.truncated, false);
          assert.equal(reply.result!.reviewCount, 2);
          text += reply.result!.text;
          if (reply.result!.nextOffset === null) return text;
          assert.ok(reply.result!.nextOffset > offset);
          offset = reply.result!.nextOffset;
        }
      };
      assert.ok(expected.length > 24_000);
      assert.equal(readAll(), expected);
      assert.equal(h.sup.read("governor", g.agentId, "result", 0, 1, g.taskRunId).result!.reviewCount, 2);
      const next = await h.sup.sendMessage("governor", g.agentId, "task", "new work", {}, "next");
      await until(() => h.byAgent(g.agentId)[0]!.delivered.length > 0);
      h.byAgent(g.agentId)[0]!.settle("succeeded", "new answer");
      await until(() => terminals(h.sup, next.taskRunId!).length === 1);
      assert.equal(readAll(), expected);
      assert.equal(h.sup.readReviews("governor", g.agentId, null, { offset: 0, length: null }, 0).result, null);
    } finally { await cleanup(h); }
  });
}

test("gate errors and blocked verdicts wait for peers; full diagnostics remain readable", async () => {
  for (const failure of ["invalid", "blocked"] as const) {
    const h = setup();
    try {
      const g = await h.sup.spawn("governor", { taskName: failure, message: "work", profile: "reader", gate: panel() }, "spawn");
      h.byAgent(g.agentId)[0]!.settle();
      await reviewing(h, g.taskRunId);
      const rs = reviewers(h);
      await until(() => rs.every((r) => h.byAgent(r.id)[0]?.initText != null));
      const first = h.byAgent(rs[0]!.id)[0]!;
      await first.decide(failure === "invalid" ? { nonsense: true } : blocked("candidate-1"));
      await tick();
      assert.deepEqual(terminals(h.sup, g.taskRunId), []);
      assert.throws(() => h.sup.readReviews("governor", g.agentId, null, { offset: 0, length: null }, 0), /CONFLICT/);
      await h.byAgent(rs[1]!.id)[0]!.decide(approve("candidate-1"));
      await until(() => terminals(h.sup, g.taskRunId).length === 1);
      assert.deepEqual(terminals(h.sup, g.taskRunId), [failure === "invalid" ? "gate_error" : "gate_blocked"]);
      const report = h.sup.readReviews("governor", g.agentId, null, { offset: 0, length: null }, 0).result!;
      assert.equal(report.reviewCount, 2);
      assert.match(report.text, failure === "invalid" ? /GATE_PROTOCOL_ERROR/ : /missingPrerequisites/);
      const again = await first.decide(approve("candidate-1"));
      assert.equal(again.isError, true);
      assert.equal(h.sup.readReviews("governor", g.agentId, null, { offset: 0, length: null }, 0).result!.text, report.text);
    } finally { await cleanup(h); }
  }
});

test("interrupting one reviewer leaves its peers intact; resume reruns only that reviewer", async () => {
  const h = setup();
  try {
    const g = await h.sup.spawn("governor", { taskName: "interrupt", message: "work", profile: "reader", gate: panel() }, "spawn");
    h.byAgent(g.agentId)[0]!.settle();
    await reviewing(h, g.taskRunId);
    const rs = reviewers(h);
    await until(() => rs.every((r) => h.byAgent(r.id)[0]?.initText != null));
    await h.sup.interrupt("governor", rs[0]!.id, "interrupt");
    await h.byAgent(rs[1]!.id)[0]!.decide(approve("candidate-1"));
    await tick();
    assert.deepEqual(terminals(h.sup, g.taskRunId), []);
    await h.sup.manageGate("governor", { kind: "resume_review", taskRunId: g.taskRunId, reviewId: "review-1" }, "resume");
    await until(() => h.byAgent(rs[0]!.id).length === 2);
    assert.equal(h.byAgent(rs[1]!.id).length, 1);
    await h.byAgent(rs[0]!.id)[1]!.decide(approve("candidate-1"));
    await until(() => terminals(h.sup, g.taskRunId).length === 1);
    assert.deepEqual(terminals(h.sup, g.taskRunId), ["passed"]);
  } finally { await cleanup(h); }
});

test("closing a panel with running and queued reviewers stops every member", async () => {
  const h = setup({ maxRunnable: 1 });
  try {
    const g = await h.sup.spawn("governor", { taskName: "close", message: "work", profile: "reader", review: panel() }, "spawn");
    h.byAgent(g.agentId)[0]!.settle();
    await reviewing(h, g.taskRunId);
    await until(() => reviewers(h).some((r) => h.byAgent(r.id)[0]?.initText != null));
    await h.sup.close("governor", g.agentId, "close");
    const count = h.workers.length;
    await tick();
    assert.equal(h.workers.length, count);
    assert.ok(h.workers.every((w) => w.killed));
    assert.ok(reviewers(h).every((r) => r.pendingIntent === "closed"));
    assert.deepEqual(terminals(h.sup, g.taskRunId), ["interrupted"]);
  } finally { await cleanup(h); }
});

test("retry with a replacement panel uses the requested models and prompts", async () => {
  const h = setup();
  try {
    const g = await h.sup.spawn("governor", { taskName: "retry", message: "work", profile: "reader", gate: gateSpec() }, "spawn");
    h.byAgent(g.agentId)[0]!.settle();
    await reviewing(h, g.taskRunId);
    const old = reviewers(h)[0]!;
    await until(() => h.byAgent(old.id)[0]?.initText != null);
    await h.byAgent(old.id)[0]!.decide(blocked("candidate-1"));
    await until(() => terminals(h.sup, g.taskRunId).length === 1);
    const next = await h.sup.manageGate("governor", { kind: "retry_review", taskRunId: g.taskRunId, candidateId: "candidate-1", gate: panel() }, "retry");
    const rs = reviewers(h).filter((r) => r.managedGateFor === next.taskRunId).sort((a, b) => a.model.localeCompare(b.model));
    assert.deepEqual(rs.map((r) => r.model), ["p/m", "p/other"]);
    await until(() => rs.every((r) => h.byAgent(r.id)[0]?.initText != null));
    assert.match(h.byAgent(rs[1]!.id)[0]!.initText!, /independent rubric/);
    for (const r of rs) await h.byAgent(r.id)[0]!.decide(approve("candidate-1"));
    await until(() => terminals(h.sup, next.taskRunId).length === 1);
    assert.deepEqual(terminals(h.sup, next.taskRunId), ["passed"]);
    assert.deepEqual(terminals(h.sup, g.taskRunId), ["gate_blocked"]);
  } finally { await cleanup(h); }
});

test("recovery after all verdicts but before terminal outcome requires explicit aggregation, not inference", async () => {
  const first = setup();
  const snapshot = new InMemoryRunStore("root-1");
  const g = await first.sup.spawn("governor", { taskName: "barrier", message: "work", profile: "reader", gate: panel() }, "spawn");
  try {
    first.byAgent(g.agentId)[0]!.settle();
    await reviewing(first, g.taskRunId);
    const rs = reviewers(first);
    await until(() => rs.every((r) => first.byAgent(r.id)[0]?.initText != null));
    for (const r of rs) await first.byAgent(r.id)[0]!.decide(approve("candidate-1"));
    await until(() => terminals(first.sup, g.taskRunId).length === 1);
    const records = first.sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records;
    const terminal = records.find((r) => r.kind === "task.terminal" && r.body["taskRunId"] === g.taskRunId)!;
    for (const r of records.filter((r) => r.seq < terminal.seq)) snapshot.append(r.kind, r.body);
  } finally { await cleanup(first); }
  const second = mkSup({ store: snapshot, policy: (p) => { p.allowedModels = null; } });
  try {
    await second.sup.recover();
    assert.deepEqual(terminals(second.sup, g.taskRunId), []);
    assert.equal(second.workers.length, 0);
    await second.sup.manageGate("governor", { kind: "resume_review", taskRunId: g.taskRunId, reviewId: "review-1" }, "resume");
    await until(() => terminals(second.sup, g.taskRunId).length === 1);
    assert.deepEqual(terminals(second.sup, g.taskRunId), ["passed"]);
    assert.equal(second.workers.length, 0);
    assert.equal(second.sup.gateController.inspect(g.taskRunId)!.roundsAdmitted, 1);
  } finally { await cleanup(second); }
});

test("recovery does not expose a committed panel repair as a resumable review", async () => {
  const h = setup({ maxRunnable: 1 });
  try {
    const g = await h.sup.spawn("governor", { taskName: "repair-recovery", message: "work", profile: "reader", gate: panel() }, "spawn");
    h.byAgent(g.agentId)[0]!.settle();
    await reviewing(h, g.taskRunId);
    await until(() => reviewers(h).some((r) => h.byAgent(r.id)[0]?.initText != null));
    await h.sup.spawn("governor", { taskName: "blocker", message: "hold capacity", profile: "reader" }, "blocker");
    const completed = new Set<string>();
    while (completed.size < 2) {
      await until(() => reviewers(h).some((r) => !completed.has(r.id) && h.byAgent(r.id)[0]?.initText != null));
      const r = reviewers(h).find((r) => !completed.has(r.id) && h.byAgent(r.id)[0]?.initText != null)!;
      completed.add(r.id);
      await h.byAgent(r.id)[0]!.decide(revise("candidate-1"));
    }
    await until(() => h.sup.list("governor").find((v) => v.id === g.agentId)!.pendingIntent === "repair queued");
    await h.sup.recover();
    assert.notEqual(h.sup.gateController.inspect(g.taskRunId)!.review!.status, "interrupted");
    await assert.rejects(h.sup.manageGate("governor", { kind: "resume_review", taskRunId: g.taskRunId, reviewId: "review-1" }, "resume"), /NOT_FOUND/);
    assert.equal(h.sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((r) => r.kind === "gate.repair_command").length, 1);
  } finally { await cleanup(h); }
});

test("a failed member wakes activity waits while its peers are still reviewing", async () => {
  const h = setup();
  try {
    const g = await h.sup.spawn("governor", { taskName: "activity", message: "work", profile: "reader", review: panel() }, "spawn");
    h.byAgent(g.agentId)[0]!.settle();
    await reviewing(h, g.taskRunId);
    const rs = reviewers(h);
    await until(() => rs.every((r) => h.byAgent(r.id)[0]?.initText != null));
    const cursor = h.sup.runStore.durableSeq();
    const wait = h.sup.wait("governor", cursor, 200, [{ agentId: g.agentId, taskRunId: g.taskRunId }], "activity");
    h.byAgent(rs[0]!.id)[0]!.crash();
    const observed = await wait;
    assert.notEqual(observed.reason, "timeout");
    assert.ok(observed.events.some((e) => e.kind === "gate.review_failed"));
    assert.deepEqual(terminals(h.sup, g.taskRunId), []);
  } finally { await cleanup(h); }
});
