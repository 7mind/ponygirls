import assert from "node:assert/strict";
import test from "node:test";
import childProcess, { spawn } from "node:child_process";
import fs, { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Supervisor } from "../src/supervisor.ts";
import { killAndConfirm, readProcessIdentity, verifyOwnership } from "../src/process-identity.ts";
import { FileRunStore, RootLock } from "../src/store.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { FakeWorker, until, testGovernor, bothExecutors } from "./fake-worker.ts";

function sleepChild(): Promise<{ pid: number; kill: () => void }> {
  return new Promise((resolve, reject) => {
    const child = spawn("sleep", ["300"], { stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => resolve({ pid: child.pid!, kill: () => { try { child.kill("SIGKILL"); } catch { /* gone */ } } }));
  });
}

test("ownership: live-match is signalled and confirmed; mismatch never is", async (t) => {
  const proc = await sleepChild();
  try {
    const identity = readProcessIdentity(proc.pid);
    assert.ok(identity);
    assert.equal(verifyOwnership(proc.pid, identity), "live-match");
    const other = { ...identity, starttime: `9${identity.starttime}` };
    assert.equal(await killAndConfirm(proc.pid, other), "live-mismatch");
    assert.equal(await killAndConfirm(proc.pid, null), "unknown");
    assert.equal(verifyOwnership(proc.pid, identity), "live-match");
    if (process.platform === "darwin") {
      assert.equal(await killAndConfirm(proc.pid, identity), "live-match");
      assert.equal(verifyOwnership(proc.pid, identity), "live-match");
      return;
    }
    const signal = process.kill;
    const denied = t.mock.method(process, "kill", (pid: number, sig: NodeJS.Signals | number) => {
      if (pid === proc.pid && sig === "SIGKILL") throw Object.assign(new Error("denied"), { code: "EPERM" });
      return signal(pid, sig);
    });
    assert.equal(await killAndConfirm(proc.pid, identity), "unknown");
    assert.equal(verifyOwnership(proc.pid, identity), "live-match");
    denied.mock.restore();
    assert.equal(await killAndConfirm(proc.pid, identity), "dead");
    assert.equal(verifyOwnership(proc.pid, identity), "dead");
  } finally {
    proc.kill();
  }
});

test("unreadable process metadata cannot retire a live lock or confirm worker termination", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-lock-observation-"));
  const lock = new RootLock(dir);
  const identity = readProcessIdentity(process.pid);
  assert.ok(identity);
  assert.equal(lock.acquire().ok, true);
  let failure = "";
  const fault = () => {
    if (failure === "truncated") return "truncated";
    throw Object.assign(new Error("process probe unavailable"), { code: failure });
  };
  const actual = fs.readFileSync;
  const stub = process.platform === "darwin" ? t.mock.method(childProcess, "execFileSync", fault)
    : t.mock.method(fs, "readFileSync", (...args: Parameters<typeof actual>) => args[0] === `/proc/${process.pid}/stat` ? fault() : actual(...args));
  syncBuiltinESMExports();
  try {
    for (failure of ["ENOENT", "EACCES", "EPERM", "truncated"]) {
      assert.equal(verifyOwnership(process.pid, identity), "unknown");
      assert.equal(new RootLock(dir).acquire().ok, false);
    }
  } finally {
    stub.mock.restore();
    syncBuiltinESMExports();
    lock.release();
    rmSync(dir, { recursive: true, force: true });
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
        governor: testGovernor,
        rootDir: dir,
        store: new FileRunStore(dir, "root-1"),
        policy,
        executors: bothExecutors(exec),
        workspace: new DummyWorkspaceManager(),
        workerFactory: () => new FakeWorker("tool-then-settle"),
      });
    const sup1 = mkSup();
    const res = await sup1.spawn("governor", { taskName: "w", message: "write", profile: "writer", isolation: "sandbox", repoId: "r1", baseCommit: "c0" }, "req-1");
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
      // The quarantine itself is governor-visible: agent path plus reason.
      const { lines } = sup2.noticesSince(0, 50);
      const quar = lines.find((l) => l.includes("quarantined"));
      assert.ok(quar, `expected a quarantine notice, got: ${JSON.stringify(lines)}`);
      assert.ok(quar.includes("/root/w"), `expected the agent path in the notice, got: ${quar}`);
      assert.ok(/unconfirmed|RECOVERY_OWNER_UNCONFIRMED/.test(quar), `expected the quarantine reason, got: ${quar}`);
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
        governor: testGovernor,
        rootDir: dir,
        store: new FileRunStore(dir, "root-1"),
        policy,
        executors: bothExecutors(new DummyToolExecutor()),
        workspace: new DummyWorkspaceManager(),
        workerFactory: () => {
          calls++;
          if (calls === 1) return new FakeWorker("settle-text", "main done");
          const reviewer = new FakeWorker("gate");
          return reviewer;
        },
      });
    const sup1 = mkSup();
    const gatedSpawn = {
      taskName: "g",
      message: "gated work",
      profile: "reader" as const,
      gate: { model: { provider: "p", id: "m" }, thinkingLevel: "high", prompt: "rubric", maxRounds: 3 },
    };
    const a = await sup1.spawn("governor", gatedSpawn, "req-g");
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
      const read = sup2.read("governor", a.agentId, "result", 0, 10, null);
      assert.equal(read.result?.outcome, "passed");
      const gate = sup2.gateController.inspect(a.taskRunId);
      assert.equal(gate?.terminal, "passed");
      assert.equal(gate?.roundsAdmitted, 1);
      // Durable dedup survives restart: identical retries return the
      // original identity; conflicting reuse of the request id fails.
      const again = await sup2.spawn("governor", gatedSpawn, "req-g");
      assert.equal(again.agentId, a.agentId);
      assert.equal(again.taskRunId, a.taskRunId);
      await assert.rejects(() => sup2.spawn("governor", { taskName: "other", message: "x", profile: "reader" }, "req-g"), /DUPLICATE_REQUEST/);
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

test("ownership: process identity uses the start time, which survives memory growth", async () => {
  const before = readProcessIdentity(process.pid);
  assert.ok(before);
  if (process.platform === "linux") {
    const stat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    assert.equal(before.starttime, fields[19]);
  } else assert.match(before.starttime, /^[1-9]\d*\.\d{6}$/);
  const ballast = Buffer.alloc(64 * 1024 * 1024, 1);
  assert.equal(verifyOwnership(process.pid, before), "live-match");
  void ballast;
});
