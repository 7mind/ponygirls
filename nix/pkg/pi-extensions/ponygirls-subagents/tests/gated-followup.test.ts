import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileRunStore, checkpointSha256 } from "../src/store.ts";
import { GitWorkspaceManager } from "../src/workspace.ts";
import { CtlWorker, approve, gateSpec, mkSup, revise, terminals } from "./ctl-worker.ts";
import { testGovernor, until } from "./fake-worker.ts";

function repository(): string {
  const dir = mkdtempSync(join(tmpdir(), "subagents-followup-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "initial", "--allow-empty"]);
  return dir;
}

const panel = {
  thinkingLevel: "high",
  prompt: "Inspect the follow-up",
  reviewers: [{ model: gateSpec().model }, { model: gateSpec().model }],
  checks: [{ id: "check", command: "test -f out.txt" }],
  promisedOutputs: ["out.txt"],
};

test("a retained writer gets a separate gated run, checks, and repair, then accepts an ordinary task", async (t) => {
  const repo = repository();
  const h = mkSup({ limits: { maxOpenAgents: 3 }, workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
  const { sup } = h;
  t.after(async () => {
    await sup.shutdown();
    rmSync(h.dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  let checkCount = 0;
  h.executors.host.handler = async () => {
    checkCount++;
    return { exitCode: 0, signal: null, stdout: "required check success", stderr: "", truncated: false, timedOut: false };
  };
  const original = await sup.spawn("governor", { taskName: "writer", profile: "writer", isolation: "none", message: "initial task" }, "spawn");
  const writer = h.byAgent(original.agentId)[0]!;
  writer.settle("succeeded", "original result");
  await until(() => sup.quiescent(original.agentId));
  const input = { gate: panel };
  const followup = await sup.sendMessage("governor", original.agentId, "task", "improve work", input, "followup");
  const run = followup.taskRunId!;
  assert.notEqual(run, original.taskRunId);
  assert.deepEqual(await sup.sendMessage("governor", original.agentId, "task", "improve work", input, "followup"), followup);
  await assert.rejects(sup.sendMessage("governor", original.agentId, "task", "improve work", {}, "followup"), /DUPLICATE_REQUEST/);
  assert.deepEqual(h.byAgent(original.agentId), [writer]);
  assert.equal(writer.taskRunId, run);
  assert.equal(writer.generation, original.generation + 1);
  assert.equal(writer.init?.["workdir"], original.workdir);
  assert.deepEqual(writer.delivered, [{ mode: "task", text: "improve work", messageId: followup.messageId }]);
  assert.equal(sup.read("governor", original.agentId, "result", 0, 1, original.taskRunId).result?.text, "original result");
  assert.equal(sup.readReviews("governor", original.agentId, original.taskRunId, { offset: 0, length: null }, 0).result, null);
  const reviewers = sup.list("governor").filter((r) => r.managedGateFor === run);
  assert.equal(reviewers.length, 2);
  writeFileSync(join(original.workdir, "out.txt"), "first\n");
  writer.settle("succeeded", "first candidate");
  await until(() => reviewers.every((r) => h.byAgent(r.id)[0]?.initText != null));
  assert.equal(checkCount, 1);
  assert.match(h.byAgent(reviewers[0]!.id)[0]!.initText!, /required check success/);
  await h.byAgent(reviewers[0]!.id)[0]!.decide(revise("candidate-1"));
  assert.deepEqual(terminals(sup, run), []);
  await h.byAgent(reviewers[1]!.id)[0]!.decide(approve("candidate-1"));
  await until(() => writer.delivered.some((m) => m.mode === "repair"));
  writeFileSync(join(original.workdir, "out.txt"), "repaired\n");
  writer.settle("succeeded", "repaired candidate");
  await until(() => reviewers.every((r) => h.byAgent(r.id)[1]?.initText != null));
  await h.byAgent(reviewers[0]!.id)[1]!.decide(approve("candidate-2"));
  assert.deepEqual(terminals(sup, run), []);
  await h.byAgent(reviewers[1]!.id)[1]!.decide(approve("candidate-2"));
  await until(() => terminals(sup, run).length > 0);
  assert.deepEqual(terminals(sup, run), ["passed"]);
  assert.equal(checkCount, 3);
  assert.equal(sup.readReviews("governor", original.agentId, run, { offset: 0, length: null }, 0).result?.reviewCount, 4);
  const plain = await sup.sendMessage("governor", original.agentId, "task", "ordinary", {}, "plain");
  writer.settle("succeeded", "ordinary result");
  await until(() => terminals(sup, plain.taskRunId!).length > 0);
  assert.deepEqual(terminals(sup, plain.taskRunId!), ["succeeded"]);
  assert.equal(sup.readReviews("governor", original.agentId, plain.taskRunId!, { offset: 0, length: null }, 0).result, null);
  assert.equal(sup.list("governor").find((v) => v.id === original.agentId)?.gateTaskRunId, null);
  assert.deepEqual(terminals(sup, original.taskRunId), ["succeeded"]);
});

const writerParams = { taskName: "writer", profile: "writer", isolation: "none", message: "initial task" } as const;
const gated = { gate: gateSpec() };

class RestorableWorker extends CtlWorker {
  override async request(...args: Parameters<CtlWorker["request"]>): Promise<unknown> {
    const result = await super.request(...args);
    if (args[0] !== "initialize") return result;
    const restore = this.init?.["restore"] as { sessionFile: string } | null;
    if (restore === null) return result;
    const header = JSON.parse(readFileSync(restore.sessionFile, "utf8").split("\n", 1)[0]!);
    return { ...(result as object), sessionId: header.id, sessionFile: restore.sessionFile };
  }
}

function fileHarness(repo: string, dir: string, limits: Parameters<typeof mkSup>[0]["limits"]) {
  const store = new FileRunStore(dir, "root-1");
  const workers: RestorableWorker[] = [];
  const h = mkSup({ dir, store, limits, workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }), factory: ({ agentId }) => {
    const worker = new RestorableWorker(agentId);
    workers.push(worker);
    return worker;
  } });
  return { ...h, store, workers, byAgent: (agentId: string) => workers.filter((w) => w.agentId === agentId) };
}

function checkpoint(store: FileRunStore, agentId: string, taskRunId: string, generation: number, cwd: string): Buffer {
  const timestamp = new Date().toISOString();
  const bytes = Buffer.from(JSON.stringify({ type: "session", version: 3, id: "retained-history", timestamp, cwd }) + "\n" +
    JSON.stringify({ type: "message", id: "initial-entry", parentId: null, timestamp, message: { role: "user", content: "initial task", timestamp: Date.now() } }) + "\n");
  store.saveCheckpoint({ agentId, taskRunId, generation, leafEntryId: "initial-entry", sha256: checkpointSha256(bytes), bytes: bytes.length, createdAt: timestamp, superseded: false }, bytes);
  return bytes;
}

test("gated admission rejects unauthorized, ineligible and excess-panel requests without accepting work", async (t) => {
  const repo = repository();
  const h = mkSup({ limits: { maxOpenAgents: 3 }, workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
  const { sup } = h;
  t.after(async () => {
    await sup.shutdown();
    rmSync(h.dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  const main = await sup.spawn("governor", writerParams, "main");
  const reader = await sup.spawn("governor", { ...writerParams, taskName: "reader", profile: "reader" }, "reader");
  const other = h.byAgent(reader.agentId)[0]!;
  const rejectsNested = await other.call("send_message", { target: main.agentId, mode: "task", message: "must refuse", ...gated });
  assert.equal(rejectsNested.isError, true);
  assert.match(rejectsNested.content, /FORBIDDEN: gated follow-ups require the governing session/);
  await assert.rejects(sup.sendMessage(reader.agentId, main.agentId, "task", "nested", gated, "nested"), /FORBIDDEN/);
  await assert.rejects(sup.sendMessage("governor", main.agentId, "task", "busy", gated, "busy"), /CONFLICT/);
  other.settle();
  const writer = h.byAgent(main.agentId)[0]!;
  writer.settle();
  await until(() => sup.quiescent(main.agentId) && sup.quiescent(reader.agentId));
  const before = sup.runStore.durableSeq();
  for (const mode of ["note", "steer"] as const) {
    await assert.rejects(sup.sendMessage("governor", main.agentId, mode, "invalid", gated, mode), /INVALID/);
  }
  await assert.rejects(sup.sendMessage("governor", main.agentId, "task", "invalid", { ...gated, replyTo: "q" }, "reply"), /INVALID/);
  await assert.rejects(sup.sendMessage("governor", main.agentId, "task", "invalid", { ...gated, model: gateSpec().model }, "model"), /INVALID/);
  await assert.rejects(sup.sendMessage("governor", reader.agentId, "task", "reader", gated, "reader-gate"), /INVALID.*writable Git workspace/);
  await assert.rejects(sup.sendMessage("governor", main.agentId, "task", "invalid", { gate: { ...gateSpec(), model: { provider: "not", id: "allowed" } } }, "model-policy"), /POLICY_DENIED/);
  await assert.rejects(sup.sendMessage("governor", main.agentId, "task", "panel", { gate: panel }, "panel"), /CAPACITY_EXCEEDED/);
  assert.equal(sup.runStore.durableSeq(), before);
  assert.deepEqual(writer.delivered, []);
  assert.equal(sup.admissionScheduler.agentsCreatedCount, 2);
  const accepted = await sup.sendMessage("user", main.agentId, "task", "allowed", gated, "allowed");
  const reviewer = sup.list("governor").find((v) => v.managedGateFor === accepted.taskRunId)!;
  await assert.rejects(sup.sendMessage("governor", reviewer.id, "task", "reviewer", gated, "reviewer-gate"), /FORBIDDEN/);
});

test("a committed parked gate survives reopen with original run, panel and request id", async (t) => {
  const repo = repository();
  const dir = mkdtempSync(join(tmpdir(), "subagents-followup-replay-"));
  let h = fileHarness(repo, dir, { maxRunnable: 1 });
  t.after(async () => {
    await h.sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  const writer = await h.sup.spawn("governor", writerParams, "writer");
  h.byAgent(writer.agentId)[0]!.settle("succeeded", "before reopen");
  await until(() => h.sup.quiescent(writer.agentId));
  const bytes = checkpoint(h.store, writer.agentId, writer.taskRunId, writer.generation, repo);
  await h.sup.spawn("governor", { ...writerParams, taskName: "holder", profile: "reader" }, "holder");
  const request = () => h.sup.sendMessage("governor", writer.agentId, "task", "resume under gate", gated, "followup");
  const accepted = await request();
  const run = accepted.taskRunId!;
  const reviewer = h.sup.list("governor").find((v) => v.managedGateFor === run)!;
  assert.equal(h.byAgent(writer.agentId)[0]!.delivered.length, 0);
  assert.equal(h.sup.list("governor").find((v) => v.id === writer.agentId)?.currentTaskRunId, writer.taskRunId);
  await assert.rejects(h.sup.sendMessage("governor", writer.agentId, "task", "reject second queued gate", gated, "second"), /CONFLICT/);
  await h.sup.shutdown();
  h = fileHarness(repo, dir, { maxRunnable: 1 });
  assert.equal(h.sup.list("governor").find((v) => v.id === reviewer.id)?.managedGateFor, run);
  assert.deepEqual(await request(), accepted);
  await assert.rejects(h.sup.sendMessage("governor", writer.agentId, "task", "resume under gate", { gate: gateSpec(2) }, "followup"), /DUPLICATE_REQUEST/);
  assert.deepEqual((await h.sup.recover()).requeued, [run]);
  assert.equal(h.workers.length, 0);
  await h.sup.dispatchPending("governor", writer.agentId, run);
  const resumed = h.byAgent(writer.agentId)[0]!;
  assert.equal(resumed.taskRunId, run);
  assert.equal(resumed.init?.["workdir"], writer.workdir);
  const restore = resumed.init?.["restore"] as { sessionFile: string; leafEntryId: string };
  assert.equal(restore.leafEntryId, "initial-entry");
  assert.deepEqual(readFileSync(restore.sessionFile), bytes);
  assert.deepEqual(resumed.delivered, [{ mode: "task", messageId: accepted.messageId, text: "resume under gate" }]);
  resumed.settle("succeeded", "candidate after reopen");
  await until(() => h.byAgent(reviewer.id)[0]?.initText != null);
  await h.byAgent(reviewer.id)[0]!.decide(approve("candidate-1"));
  await until(() => terminals(h.sup, run).length > 0);
  assert.deepEqual(terminals(h.sup, run), ["passed"]);
  assert.equal(h.sup.read("governor", writer.agentId, "result", 0, 1, writer.taskRunId).result?.text, "before reopen");

});

test("a real manifest commit fault exposes none of the gated admission and permits retry after recovery", async (t) => {
  const repo = repository();
  const dir = mkdtempSync(join(tmpdir(), "subagents-followup-fault-"));
  let h = fileHarness(repo, dir, { maxOpenAgents: 2 });
  t.after(async () => {
    await h.sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  const writer = await h.sup.spawn("governor", writerParams, "writer");
  h.byAgent(writer.agentId)[0]!.settle("succeeded", "retained");
  await until(() => h.sup.quiescent(writer.agentId));
  checkpoint(h.store, writer.agentId, writer.taskRunId, writer.generation, repo);
  const before = h.store.durableSeq();
  const request = () => h.sup.sendMessage("governor", writer.agentId, "task", "gated", gated, "followup");
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (...[from, to]: Parameters<typeof rename>) => {
    if (to === join(dir, "MANIFEST.json")) throw Object.assign(new Error("injected manifest fault"), { code: "ENOSPC" });
    return rename(from, to);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(request(), /STORE_FAILED.*manifest fault/);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal(h.store.durableSeq(), before);
  assert.equal(h.store.loadCommand("followup"), null);
  assert.deepEqual(h.sup.list("governor").map((v) => v.id), [writer.agentId]);
  assert.equal(h.sup.admissionScheduler.agentsCreatedCount, 1);
  assert.deepEqual(h.byAgent(writer.agentId)[0]!.delivered, []);
  await h.sup.shutdown();
  h = fileHarness(repo, dir, { maxOpenAgents: 2 });
  assert.equal(h.store.loadCommand("followup"), null);
  const reopened = h.store.readSince(before, 100).records;
  assert.deepEqual(reopened.map((r) => r.kind), ["recovery.event", "root.init"]);
  assert.equal(reopened[0]!.body["phase"], "uncommitted_tail_discarded");
  assert.deepEqual((await h.sup.recover()).requeued, []);
  const accepted = await request();
  assert.equal(h.sup.list("governor").filter((v) => v.managedGateFor === accepted.taskRunId).length, 1);
  assert.equal(h.sup.list("governor").find((v) => v.id === writer.agentId)?.gateTaskRunId, accepted.taskRunId);
});

test("recovery never treats a settled gated generation with no candidate as ordinary success", async (t) => {
  const repo = repository();
  const dir = mkdtempSync(join(tmpdir(), "subagents-followup-prefix-"));
  const main = fileHarness(repo, join(dir, "main"), {});
  t.after(async () => {
    await main.sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  const writer = await main.sup.spawn("governor", writerParams, "writer");
  const worker = main.byAgent(writer.agentId)[0]!;
  worker.settle();
  await until(() => main.sup.quiescent(writer.agentId));
  const followup = await main.sup.sendMessage("governor", writer.agentId, "task", "require review", gated, "followup");
  const taskRunId = followup.taskRunId!;
  worker.settle("succeeded", "unreviewed candidate");
  await until(() => main.store.readSince(0, 1000).records.some((r) => r.kind === "gate.candidate" && r.body["taskRunId"] === taskRunId));
  const records = main.store.readSince(0, 1000).records;
  const settled = records.find((r) => r.kind === "generation.settled" && r.body["taskRunId"] === taskRunId)!;
  const prefix = records.slice(0, settled.seq);
  const recoveredDir = join(dir, "recovered");
  const replayStore = new FileRunStore(recoveredDir, "root-1");
  replayStore.appendBatch(prefix);
  replayStore.close();
  const recovered = fileHarness(repo, recoveredDir, {});
  try {
    assert.equal(recovered.sup.list("governor").find((v) => v.id === writer.agentId)?.gateTaskRunId, taskRunId);
    assert.deepEqual((await recovered.sup.recover()).settled, [taskRunId]);
    assert.deepEqual(terminals(recovered.sup, taskRunId), ["interrupted"]);
    assert.deepEqual(terminals(recovered.sup, writer.taskRunId), ["succeeded"]);
    assert.equal(recovered.workers.length, 0);
  } finally {
    await recovered.sup.shutdown();
  }
  const brokenDir = join(dir, "missing-panel");
  const brokenStore = new FileRunStore(brokenDir, "root-1");
  brokenStore.appendBatch(prefix.filter((r) => r.kind !== "agent.spawned" || r.body["managedGate"] !== true));
  brokenStore.close();
  assert.throws(() => fileHarness(repo, brokenDir, {}), /RECOVERY_CORRUPT.*lacks its protected gate panel/);
});

test("a parked gated task protects its reviewers until the writer task is interrupted", async (t) => {
  const repo = repository();
  const h = mkSup({ limits: { maxRunnable: 1 }, workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
  t.after(async () => {
    await h.sup.shutdown();
    rmSync(h.dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  const main = await h.sup.spawn("governor", writerParams, "main");
  const writer = h.byAgent(main.agentId)[0]!;
  writer.settle();
  await until(() => h.sup.quiescent(main.agentId));
  const holder = await h.sup.spawn("governor", { ...writerParams, taskName: "holder", profile: "reader" }, "holder");
  const { taskRunId } = await h.sup.sendMessage("governor", main.agentId, "task", "parked", gated, "parked");
  const reviewer = h.sup.list("governor").find((v) => v.managedGateFor === taskRunId)!;
  await assert.rejects(h.sup.close("governor", reviewer.id, "early-close"), /CONFLICT.*queued gated task/);
  await h.sup.interrupt("governor", main.agentId, "interrupt");
  assert.deepEqual(terminals(h.sup, taskRunId!), ["interrupted"]);
  await h.sup.close("governor", reviewer.id, "close");
  h.byAgent(holder.agentId)[0]!.settle();
  await until(() => terminals(h.sup, holder.taskRunId).length > 0);
  assert.deepEqual(terminals(h.sup, holder.taskRunId), ["succeeded"]);
  assert.deepEqual(writer.delivered, []);
});

test("a missing writer checkpoint blocks only the parked gate, not later ordinary work", async (t) => {
  const repo = repository();
  const dir = mkdtempSync(join(tmpdir(), "subagents-followup-unproved-"));
  let h = fileHarness(repo, dir, { maxRunnable: 1 });
  t.after(async () => {
    await h.sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  const writer = await h.sup.spawn("governor", writerParams, "writer");
  h.byAgent(writer.agentId)[0]!.settle();
  await until(() => h.sup.quiescent(writer.agentId));
  await h.sup.spawn("governor", { ...writerParams, taskName: "holder", profile: "reader" }, "holder");
  const { taskRunId } = await h.sup.sendMessage("governor", writer.agentId, "task", "requires conversation", gated, "followup");
  const plain = await h.sup.sendMessage("governor", writer.agentId, "task", "ordinary work", {}, "plain");
  await h.sup.shutdown();
  h = fileHarness(repo, dir, { maxRunnable: 1 });
  await h.sup.recover();
  await h.sup.dispatchPending("governor", writer.agentId, taskRunId!);
  assert.deepEqual(terminals(h.sup, taskRunId!), ["failed"]);
  assert.match(h.sup.read("governor", writer.agentId, "result", 0, 1, taskRunId).result!.detail, /requires a validated checkpoint/);
  assert.equal(h.store.readSince(0, 1000).records.some((r) => r.kind === "generation.started" && r.body["taskRunId"] === taskRunId), false);
  await until(() => h.byAgent(writer.agentId)[0]?.delivered.length === 1 || terminals(h.sup, plain.taskRunId!).length > 0);
  const worker = h.byAgent(writer.agentId)[0];
  assert.ok(worker, "the ordinary task must still reload");
  assert.equal(worker.init?.["restore"], null);
  assert.deepEqual(worker.delivered, [{ mode: "task", messageId: plain.messageId, text: "ordinary work" }]);
  worker.settle();
  await until(() => terminals(h.sup, plain.taskRunId!).length > 0);
  assert.deepEqual(terminals(h.sup, plain.taskRunId!), ["succeeded"]);
});

test("an ordinary task after a gated follow-up restores model-switch eligibility without changing review history", async (t) => {
  const repo = repository();
  const dir = mkdtempSync(join(tmpdir(), "subagents-followup-switch-"));
  const h = fileHarness(repo, dir, {});
  t.after(async () => {
    await h.sup.shutdown();
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  const writer = await h.sup.spawn("governor", writerParams, "writer");
  const worker = h.byAgent(writer.agentId)[0]!;
  worker.settle();
  await until(() => h.sup.quiescent(writer.agentId));
  const { taskRunId } = await h.sup.sendMessage("governor", writer.agentId, "task", "review this", gated, "followup");
  const reviewer = h.sup.list("governor").find((v) => v.managedGateFor === taskRunId)!;
  worker.settle();
  await until(() => h.byAgent(reviewer.id)[0]?.initText != null);
  await h.byAgent(reviewer.id)[0]!.decide(approve("candidate-1"));
  await until(() => h.sup.quiescent(writer.agentId));
  const plain = await h.sup.sendMessage("governor", writer.agentId, "task", "ordinary work", {}, "plain");
  worker.settle();
  await until(() => h.sup.quiescent(writer.agentId));
  checkpoint(h.store, writer.agentId, plain.taskRunId!, worker.generation, repo);
  const switched = await h.sup.sendMessage("governor", writer.agentId, "task", "switch model", { model: gateSpec().model }, "switch");
  const current = h.byAgent(writer.agentId).at(-1)!;
  assert.notEqual(current, worker);
  assert.equal(current.taskRunId, switched.taskRunId);
  assert.equal(h.sup.list("governor").find((v) => v.id === writer.agentId)?.model, "p/m");
  assert.deepEqual(terminals(h.sup, taskRunId!), ["passed"]);
  assert.equal(h.sup.readReviews("governor", writer.agentId, taskRunId, { offset: 0, length: null }, 0).result?.reviewCount, 1);
});

test("repair of a gated follow-up cannot reload into a fresh conversation", async (t) => {
  const repo = repository();
  const h = mkSup({ limits: { maxResidentWorkers: 1 }, workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
  t.after(async () => {
    await h.sup.shutdown();
    rmSync(h.dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
  const writer = await h.sup.spawn("governor", writerParams, "writer");
  const worker = h.byAgent(writer.agentId)[0]!;
  worker.settle();
  await until(() => h.sup.quiescent(writer.agentId));
  const { taskRunId } = await h.sup.sendMessage("governor", writer.agentId, "task", "review this", gated, "followup");
  const reviewer = h.sup.list("governor").find((v) => v.managedGateFor === taskRunId)!;
  worker.settle();
  await until(() => h.byAgent(reviewer.id)[0]?.initText != null);
  assert.equal(worker.killed, true);
  await h.byAgent(reviewer.id)[0]!.decide(revise("candidate-1"));
  await until(() => terminals(h.sup, taskRunId!).length > 0 || h.byAgent(writer.agentId)[1]?.delivered.length === 1);
  assert.deepEqual(terminals(h.sup, taskRunId!), ["failed"]);
  assert.match(h.sup.read("governor", writer.agentId, "result", 0, 1, taskRunId).result!.detail, /repair reload failed.*requires a validated checkpoint/);
  assert.equal(h.byAgent(writer.agentId).length, 1);
});
