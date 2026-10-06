/**
 * Deterministic gate checks: declared to the governing model, validated at
 * spawn, and run with their own timeout in the candidate's workspace.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorkspaceManager } from "../src/workspace.ts";
import { blocked, gateSpec, mkSup, tick } from "./ctl-worker.ts";
import { testGovernor } from "./fake-worker.ts";

function gitCheckout(dir: string): string {
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "a.txt"), "a\n");
  spawnSync("git", ["init", "-q", repo]);
  spawnSync("git", ["-C", repo, "add", "."]);
  spawnSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"]);
  return repo;
}

test("a check runs in the candidate's workspace with its own timeout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-checks-"));
  try {
    const repo = gitCheckout(dir);
    const { sup, byAgent, executors } = mkSup({ dir: join(dir, "root"), workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
    const g = await sup.spawn("governor", {
      taskName: "g", message: "m", profile: "writer", isolation: "worktree",
      gate: { ...gateSpec(), checks: [{ id: "tests", command: "node test.js", timeoutMs: 5000 }, { id: "lint", command: "true" }] },
    }, "rg");
    const worker = byAgent(g.agentId)[0]!;
    worker.settle("succeeded", "done");
    await tick(100);
    const workdir = String(worker.init!["workdir"]);
    assert.deepEqual(executors.host.specs.map((s) => ({ command: s.argv.slice(1), cwd: s.cwd, timeoutMs: s.timeoutMs })), [
      { command: ["-c", "node test.js"], cwd: workdir, timeoutMs: 5000 },
      { command: ["-c", "true"], cwd: workdir, timeoutMs: 120_000 },
    ]);
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checks and promised outputs need a writer; malformed checks are rejected at spawn", async () => {
  const { sup } = mkSup({});
  const spawn = (profile: "reader" | "writer", gate: Record<string, unknown>) =>
    sup.spawn("governor", { taskName: `t-${Math.random().toString(36).slice(2)}`, message: "m", profile, isolation: "none", gate: { ...gateSpec(), ...gate } }, `r-${Math.random()}`);
  await assert.rejects(() => spawn("reader", { checks: [{ id: "t", command: "true" }] }), /INVALID: gate checks and promised outputs need a writer/);
  await assert.rejects(() => spawn("reader", { promisedOutputs: ["out.txt"] }), /INVALID: gate checks and promised outputs need a writer/);
  await assert.rejects(() => spawn("writer", { checks: [{ id: "t", command: "true", timeoutMs: 0 }] }), /INVALID: gate check t timeoutMs/);
  await assert.rejects(() => spawn("writer", { checks: [{ id: "t", command: "x".repeat(40 * 1024) }] }), /PAYLOAD_TOO_LARGE/);
  assert.equal(sup.admissionScheduler.agentsCreatedCount, 0);
});

test("a retry review without a new spec reviews under the original one, checks included", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-checks-retry-"));
  try {
    const repo = gitCheckout(dir);
    const { sup, byAgent, executors } = mkSup({ dir: join(dir, "root"), workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
    const g = await sup.spawn("governor", {
      taskName: "g", message: "m", profile: "writer",
      gate: { ...gateSpec(), checks: [{ id: "tests", command: "node test.js", timeoutMs: 7000 }], promisedOutputs: ["a.txt"] },
    }, "rg");
    byAgent(g.agentId)[0]!.settle("succeeded", "done");
    await tick(100);
    const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
    await byAgent(reviewerId)[0]!.decide(blocked("candidate-1"));
    await tick(50);
    const retry = await sup.manageGate("user", { kind: "retry_review", taskRunId: g.taskRunId, candidateId: "candidate-1", gate: null }, "cmd-retry");
    await tick(100);
    const spec = sup.gateController.inspect(retry.taskRunId)!.spec;
    assert.deepEqual({ checks: spec.checks, promisedOutputs: spec.promisedOutputs }, { checks: [{ id: "tests", command: "node test.js", timeoutMs: 7000 }], promisedOutputs: ["a.txt"] });
    assert.deepEqual(executors.host.specs.map((s) => s.timeoutMs), [7000, 7000], "the check ran again for the retried review");
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
