import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Supervisor, killAndConfirm, readProcessIdentity, verifyOwnership } from "../src/supervisor.ts";
import { FileRunStore } from "../src/store.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { FakeWorker, until } from "./fake-worker.ts";

function sleepChild(): Promise<{ pid: number; kill: () => void }> {
  return new Promise((resolve, reject) => {
    const child = spawn("sleep", ["300"], { stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => resolve({ pid: child.pid!, kill: () => { try { child.kill("SIGKILL"); } catch { /* gone */ } } }));
  });
}

test("ownership: live-match is signalled and confirmed; mismatch never is", async () => {
  const proc = await sleepChild();
  try {
    const identity = readProcessIdentity(proc.pid);
    assert.ok(identity);
    assert.equal(verifyOwnership(proc.pid, identity), "live-match");
    assert.equal(verifyOwnership(proc.pid, { bootId: "bogus", starttime: "0" }), "live-mismatch");
    assert.equal(verifyOwnership(proc.pid, null), "unknown");
    assert.equal(await killAndConfirm(proc.pid), true);
    assert.equal(verifyOwnership(proc.pid, identity), "dead");
  } finally {
    proc.kill();
  }
});

test("ownership: dead pids confirm without signalling", () => {
  assert.equal(verifyOwnership(1 << 22, null), "dead");
});

test("crash with unconfirmed writer effects quarantines the workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-quar-"));
  try {
    const policy = defaultSupervisorPolicy();
    policy.maxDepth = 1;
    policy.repos = [{ repoId: "r1", checkoutPath: "/repo", readRoots: ["/repo"], allowWriters: true }];
    const exec = new DummyToolExecutor();
    // Hang the tool mid-execution: intent journaled, outcome never lands.
    exec.handler = () => new Promise(() => {});
    const mkSup = (): Supervisor =>
      new Supervisor({
        rootId: "root-1",
        rootDir: dir,
        store: new FileRunStore(dir, "root-1"),
        policy,
        executor: exec,
        workspace: new DummyWorkspaceManager(),
        workerFactory: () => new FakeWorker("tool-then-settle"),
      });
    const sup1 = mkSup();
    const res = await sup1.spawn("governor", { taskName: "w", message: "write", profile: "writer", repoId: "r1", baseCommit: "c0" }, "req-1");
    // Wait until the tool intent is durable, then simulate a crash: the
    // outcome can never arrive, effects are uncertain.
    const store1 = sup1.runStore;
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      const { records } = store1.readSince(0, 1_000_000);
      if (records.some((r) => r.kind === "tool.intent")) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await sup1.shutdown();
    const sup2 = mkSup();
    try {
      const report = await sup2.recover();
      assert.deepEqual(report.settled, [res.taskRunId]);
      assert.deepEqual(report.quarantined, [res.agentId]);
      const views = sup2.list("governor");
      assert.equal(views[0]!.taskOutcome, "uncertain");
      assert.equal(views[0]!.pendingIntent, "quarantined");
      // Replacement execution is prohibited on the quarantined workspace.
      await assert.rejects(() => sup2.dispatchPending("governor", res.agentId, res.taskRunId), /NOT_FOUND|RECOVERY_OWNER_UNCONFIRMED/);
      await assert.rejects(() => sup2.sendMessage("governor", res.agentId, "task", "again", {}, "req-9"), /RECOVERY_OWNER_UNCONFIRMED/);
    } finally {
      await sup2.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cross-process restart restores tree, mailbox, queues, outcomes, gates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-restart-"));
  try {
    const policy = defaultSupervisorPolicy();
    policy.maxDepth = 2;
    policy.nesting = true;
    policy.allowedModels = [{ provider: "p", id: "m" }];
    let calls = 0;
    const mkSup = (): Supervisor =>
      new Supervisor({
        rootId: "root-1",
        rootDir: dir,
        store: new FileRunStore(dir, "root-1"),
        policy,
        executor: new DummyToolExecutor(),
        workspace: new DummyWorkspaceManager(),
        workerFactory: () => {
          calls++;
          if (calls === 1) return new FakeWorker("settle-text", "main done");
          const reviewer = new FakeWorker("gate");
          return reviewer;
        },
      });
    const sup1 = mkSup();
    const a = await sup1.spawn("governor", {
      taskName: "g",
      message: "gated work",
      profile: "reader",
      gate: { model: { provider: "p", id: "m" }, thinkingLevel: "high", prompt: "rubric", maxRounds: 3 },
    }, "req-g");
    await until(() => sup1.list("governor")[0]?.taskOutcome === "passed", 8000, "gate pass");
    const noted = await sup1.sendMessage("governor", a.agentId, "note", "remember this", {}, "req-note");
    const kid = await sup1.spawn(a.agentId, { taskName: "kid", message: "help", profile: "reader" }, "req-k");
    void kid;
    await sup1.shutdown();
    // A new supervisor process restores everything from the journal.
    const sup2 = mkSup();
    try {
      const views = sup2.list("governor");
      assert.equal(views.length, 3); // main + reviewer + child
      assert.equal(views.find((v) => v.id === a.agentId)?.taskOutcome, "passed");
      const read = sup2.read("governor", a.agentId, "result", 0, 10);
      assert.equal(read.result?.outcome, "passed");
      const gate = sup2.gateController.inspect(a.taskRunId);
      assert.equal(gate?.terminal, "passed");
      assert.equal(gate?.roundsAdmitted, 1);
      // Durable dedup survives restart: identical retries return identities.
      const again = await sup2.spawn("governor", { taskName: "other", message: "x", profile: "reader" }, "req-g");
      assert.equal(again.agentId, a.agentId);
      const renote = await sup2.sendMessage("governor", a.agentId, "note", "remember this", {}, "req-note");
      assert.equal(renote.messageId, noted.messageId);
      const report = await sup2.recover();
      assert.deepEqual(report.settled, []);
      assert.deepEqual(report.quarantined, []);
    } finally {
      await sup2.shutdown();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
