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
import { until } from "./fake-worker.ts";
import { testGovernor } from "./fake-worker.ts";
import type { Supervisor } from "../src/supervisor.ts";

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

// regression: issue6 — workspaceMatches includes promised + mode/hash, not hash-only dropping promised.
// BA @regression(issue=6): real Git + real Supervisor fingerprint.
test("workspaceMatches detects committed, promised, and mode drift via real worktree", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-match-"));
  try {
    const repo = gitCheckout(dir);
    const { sup, byAgent } = mkSup({ dir: join(dir, "root"), workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
    const g = await sup.spawn("governor", {
      taskName: "g", message: "m", profile: "writer", isolation: "worktree",
      gate: { ...gateSpec(), promisedOutputs: ["out.txt"] },
    }, "rg");
    byAgent(g.agentId)[0]!.settle("succeeded", "done");
    await tick(100);
    const cand = sup.gateController.inspect(g.taskRunId)!.candidate!;
    assert.ok(sup.workspaceMatches(g.agentId, cand), "clean workspace should match");
    const workdir = String(byAgent(g.agentId)[0]!.init!["workdir"]);
    // Promised content drift.
    writeFileSync(join(workdir, "out.txt"), "v1\n");
    // Re-capture not needed: workspaceMatches re-fingerprints with candidate promised set.
    // First establish a matching baseline by capturing again? Instead assert drift from empty promised:
    // Candidate currently has missing-promised (no out.txt at capture). Creating it must mismatch.
    assert.equal(sup.workspaceMatches(g.agentId, cand), false, "promised creation must invalidate match");
    rmSync(join(workdir, "out.txt"));
    assert.ok(sup.workspaceMatches(g.agentId, cand), "removing promised restores match");
    writeFileSync(join(workdir, "committed.txt"), "c\n");
    spawnSync("git", ["-C", workdir, "add", "committed.txt"]);
    spawnSync("git", ["-C", workdir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "agent commit"]);
    assert.equal(sup.workspaceMatches(g.agentId, cand), false, "post-capture commit must invalidate match");
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workspaceMatches detects committed delta and promised mode drift", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-match2-"));
  try {
    const repo = gitCheckout(dir);
    const { sup, byAgent } = mkSup({ dir: join(dir, "root"), workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
    const g = await sup.spawn("governor", {
      taskName: "g", message: "m", profile: "writer", isolation: "worktree",
      gate: { ...gateSpec(), promisedOutputs: ["out.txt"] },
    }, "rg");
    const workdir = String(byAgent(g.agentId)[0]!.init!["workdir"]);
    // Create promised before settle so candidate includes it.
    writeFileSync(join(workdir, "out.txt"), "v1\n");
    byAgent(g.agentId)[0]!.settle("succeeded", "done");
    await tick(100);
    const cand = sup.gateController.inspect(g.taskRunId)!.candidate!;
    assert.ok(sup.workspaceMatches(g.agentId, cand), "promised present should match");
    // Content drift.
    writeFileSync(join(workdir, "out.txt"), "v2\n");
    assert.equal(sup.workspaceMatches(g.agentId, cand), false, "promised content drift must mismatch");
    // Restore content, change mode.
    writeFileSync(join(workdir, "out.txt"), "v1\n");
    assert.ok(sup.workspaceMatches(g.agentId, cand), "restored content should match again");
    spawnSync("chmod", ["+x", join(workdir, "out.txt")]);
    assert.equal(sup.workspaceMatches(g.agentId, cand), false, "promised mode drift must mismatch");
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


// Minimal read-only glassbox (justified, same style as controller.test.ts): repair-phase
// direct writes publish no task.phase event, so journal absence cannot prove actual
// phase invariance. Narrow structural read, no `any`, no new public API.
function actualState(sup: Supervisor, agentId: string): { taskPhase: string; currentTaskRunId: string | null } {
  const agents = (sup as unknown as { agents: Map<string, { record: { taskPhase: string; currentTaskRunId: string | null } }> }).agents;
  const rt = agents.get(agentId);
  if (!rt) throw new Error(`agent missing: ${agentId}`);
  return { taskPhase: rt.record.taskPhase, currentTaskRunId: rt.record.currentTaskRunId };
}

// C3: check-loop cancellation — already-dispatched check1 keeps OLD binding; NEW obsolete checks prohibited.
// BA @regression(c3-checkloop): real Supervisor + PUBLIC interrupt + Deferred executor, until() positives.
test("interrupted admission checks keep OLD intent and admit no obsolete check2 on N", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-ckcancel-"));
  try {
    const repo = gitCheckout(dir);
    const { sup, byAgent, executors } = mkSup({ dir: join(dir, "root"), workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
    // Observe the ACTUAL old check continuation through the PUBLIC runCheck
    // seam (production API unchanged): settlement proves the released backend
    // result was consumed by the gate path, independently of any second
    // journal outcome (exactly-ONE-per-op forbids one).
    const origRunCheck = sup.runCheck.bind(sup);
    let checkSettled = false;
    let checkExit: number | null = null;
    sup.runCheck = (async (...args: Parameters<typeof sup.runCheck>) => {
      try {
        const res = await origRunCheck(...args);
        checkExit = res.exitCode;
        return res;
      } finally {
        checkSettled = true;
      }
    }) as typeof sup.runCheck;
    let releaseCheck1!: () => void;
    const held = new Promise<void>((res) => { releaseCheck1 = res; });
    let admissions = 0;
    executors.host.handler = async (spec) => {
      admissions++;
      if (admissions === 1) {
        await held;
        return { exitCode: 0, signal: null, stdout: "c1", stderr: "", truncated: false, timedOut: false };
      }
      return { exitCode: 0, signal: null, stdout: "cX", stderr: "", truncated: false, timedOut: false };
    };
    const g = await sup.spawn("governor", { taskName: "g", message: "old", profile: "writer", isolation: "worktree",
      gate: { ...gateSpec(), checks: [{ id: "check1", command: "echo check1" }, { id: "check2", command: "echo check2" }] } }, "rg-ck");
    byAgent(g.agentId)[0]!.settle("succeeded", "old done");
    await until(() => executors.host.specs.length >= 1, 8000, "check1 admitted");
    const newer = await sup.sendMessage("governor", g.agentId, "task", "newer work", {}, "req-n-ck");
    await sup.interrupt("governor", g.agentId, "req-i-ck");
    await until(() => sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.some((x) => x.kind === "generation.started" && (x.body as Record<string, unknown>)["taskRunId"] === newer.taskRunId), 8000, "N started");
    // C6: snapshot NEW's ACTUAL record state before releasing the old held check.
    const actualBeforeAdm = actualState(sup, g.agentId);
    assert.equal(actualBeforeAdm.currentTaskRunId, newer.taskRunId, "current must be N once started");
    // Held-before-release false predicate: the OLD continuation is still
    // pending while the backend stays held (no completion observed yet).
    assert.equal(checkSettled, false, "old check continuation must still be pending while held");
    const op1 = String((sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((x) => x.kind === "tool.intent" && (x.body as Record<string, unknown>)["tool"] === "gate-check")?.body as Record<string, unknown>)["operationId"]);
    releaseCheck1();
    // Join the ACTUAL OLD continuation AFTER release via the public runCheck
    // seam: settles only when the released backend result was consumed.
    // Never a second ordinary journal outcome (exactly-ONE-per-op).
    await until(() => checkSettled, 8000, "old check continuation settled after release");
    assert.equal(checkExit, -1, "released-then-cancelled check returns cancel-marked, never clean success");
    // Drain: OLD gate terminal (interrupted) observed; the joined completion above proves the
    // assertions below run AFTER release processing, not in the pre-release race window.
    await until(() => (sup.gateController.inspect(g.taskRunId)?.terminal ?? null) !== null, 8000, "OLD gate terminal");
    const recs = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records;
    const intents = recs.filter((r) => r.kind === "tool.intent" && (r.body as Record<string, unknown>)["tool"] === "gate-check");
    assert.equal(intents.length, 1, `no obsolete check2 intent, got ${intents.length}`);
    // Exactly-ONE-per-op: the held op journals exactly one outcome, the
    // interrupt-time cancelled one — never a second ordinary outcome.
    const op1Outcomes = recs.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === op1);
    assert.equal(op1Outcomes.length, 1, `exactly one outcome for the held check, got ${JSON.stringify(op1Outcomes.map((r) => r.body))}`);
    assert.equal(String((op1Outcomes[0]!.body as Record<string, unknown>)["status"]), "cancelled", "the single outcome is cancelled, never ordinary");
    assert.equal(String((intents[0]!.body as Record<string, unknown>)["taskRunId"]), g.taskRunId, "check1 intent stays OLD");
    assert.equal(executors.host.specs.length, 1, "no obsolete check2 execution");
    // C6: 4-field actual-state invariance (journal absence alone cannot prove it:
    // direct phase writes publish no event).
    assert.deepEqual(actualState(sup, g.agentId), actualBeforeAdm, "actual phase/currentTask unchanged across obsolete-check suppression");
    assert.equal(sup.gateController.inspect(g.taskRunId)?.terminal, "interrupted");
    // Phase/current-task invariant: no repair_queued stamped on N.
    assert.equal(recs.some((r) => r.kind === "task.phase" && (r.body as Record<string, unknown>)["taskRunId"] === newer.taskRunId && (r.body as Record<string, unknown>)["phase"] === "repair_queued"), false);
    // Other-agent capacity control: an unrelated agent still runs to terminal.
    const other = await sup.spawn("governor", { taskName: "other", message: "m", profile: "reader" }, "rg-other");
    byAgent(other.agentId)[0]!.settle("succeeded", "other done");
    await until(() => sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.some((x) => x.kind === "task.terminal" && (x.body as Record<string, unknown>)["taskRunId"] === other.taskRunId), 8000, "other terminal");
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// C3: approval-recheck cancellation — approve BEFORE interrupt; held recheck keeps OLD binding, gate ends interrupted.
// BA @regression(c3-checkloop): TWO declared checks; initial checks finish; approve starts held recheck1;
// queue N; interrupt OLD; observe N.started; release AND join recheck completion; no obsolete recheck2
// intent/execution or N phase/current mutations. (Interrupt-before-approve cannot establish unreachability:
// the decision would simply never dispatch a recheck.)
test("interrupted approval recheck keeps OLD binding and does not pass", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-ckappr-"));
  try {
    const repo = gitCheckout(dir);
    const { sup, byAgent, executors } = mkSup({ dir: join(dir, "root"), workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
    // Same PUBLIC runCheck seam as the admission test: count settlements to
    // observe the held recheck's ACTUAL continuation (production unchanged).
    const origRunCheck = sup.runCheck.bind(sup);
    let runCheckSettled = 0;
    const runCheckExits: Array<number | null> = [];
    sup.runCheck = (async (...args: Parameters<typeof sup.runCheck>) => {
      try {
        const res = await origRunCheck(...args);
        runCheckExits.push(res.exitCode);
        return res;
      } finally {
        runCheckSettled++;
      }
    }) as typeof sup.runCheck;
    executors.host.handler = async () => ({ exitCode: 0, signal: null, stdout: "ok", stderr: "", truncated: false, timedOut: false });
    const g = await sup.spawn("governor", { taskName: "g", message: "old", profile: "writer", isolation: "worktree",
      gate: { ...gateSpec(), checks: [{ id: "check1", command: "echo check1" }, { id: "check2", command: "echo check2" }] } }, "rg-cka");
    byAgent(g.agentId)[0]!.settle("succeeded", "old done");
    await until(() => (sup.gateController.inspect(g.taskRunId)?.review?.status ?? "") === "running", 8000, "review running");
    // Arm Deferred for the NEXT executions (approval rechecks), then approve BEFORE interrupt.
    let releaseRecheck!: () => void;
    const held = new Promise<void>((res) => { releaseRecheck = res; });
    let rechecks = 0;
    executors.host.handler = async () => {
      rechecks++;
      if (rechecks === 1) {
        await held;
        return { exitCode: 0, signal: null, stdout: "recheck1", stderr: "", truncated: false, timedOut: false };
      }
      return { exitCode: 0, signal: null, stdout: "ok", stderr: "", truncated: false, timedOut: false };
    };
    const baseSpecs = executors.host.specs.length;
    assert.equal(baseSpecs, 2, `initial checks admitted, got ${baseSpecs}`);
    const reviewerId = sup.gateController.inspect(g.taskRunId)!.reviewerId!;
    const decideP = byAgent(reviewerId)[0]!.decide({ schemaVersion: 1, candidateId: "candidate-1", decision: "approve", advisories: [] });
    await until(() => executors.host.specs.length >= 3, 8000, "recheck1 admitted");
    const recheckOp = String((sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((x) => x.kind === "tool.intent" && (x.body as Record<string, unknown>)["tool"] === "gate-check").at(-1)?.body as Record<string, unknown>)["operationId"]);
    const newer = await sup.sendMessage("governor", g.agentId, "task", "newer work", {}, "req-n-cka");
    await sup.interrupt("governor", g.agentId, "req-i-cka");
    await until(() => sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.some((x) => x.kind === "generation.started" && (x.body as Record<string, unknown>)["taskRunId"] === newer.taskRunId), 8000, "N started");
    // C6: snapshot NEW's ACTUAL record state before releasing the held recheck.
    const actualBeforeAppr = actualState(sup, g.agentId);
    assert.equal(actualBeforeAppr.currentTaskRunId, newer.taskRunId, "current must be N once started");
    // Held-before-release false predicate: both initial checks settled, the
    // held recheck (3rd runCheck) still pending. (The decide tool call is
    // already accepted:true here — that only acknowledges the verdict, it
    // does NOT join the held recheck — so the wrapper count, not decideP,
    // is the genuine predicate.)
    assert.equal(runCheckSettled, 2, "initial checks settled, held recheck still pending before release");
    releaseRecheck();
    // Genuine after-release completion join via the public runCheck seam:
    // the 3rd settlement proves the released recheck was consumed. Never a
    // second ordinary journal outcome (exactly-ONE-per-op).
    await until(() => runCheckSettled === 3, 8000, "held recheck continuation settled after release");
    assert.equal(runCheckExits[2], -1, "released-then-cancelled recheck returns cancel-marked, never clean success");
    await decideP;    await until(() => (sup.gateController.inspect(g.taskRunId)?.terminal ?? null) !== null, 8000, "OLD gate terminal");
    const recs = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records;
    const intents = recs.filter((r) => r.kind === "tool.intent" && (r.body as Record<string, unknown>)["tool"] === "gate-check");
    assert.equal(intents.length, 3, `initial 2 + recheck1 only, got ${intents.length}`);
    // Exactly-ONE-per-op for the held recheck: one cancelled outcome, never
    // a second ordinary one.
    const recheckOutcomes = recs.filter((r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["operationId"] === recheckOp);
    assert.equal(recheckOutcomes.length, 1, `exactly one outcome for the held recheck, got ${JSON.stringify(recheckOutcomes.map((r) => r.body))}`);
    assert.equal(String((recheckOutcomes[0]!.body as Record<string, unknown>)["status"]), "cancelled", "the single recheck outcome is cancelled, never ordinary");
    assert.ok(intents.every((r) => String((r.body as Record<string, unknown>)["taskRunId"]) === g.taskRunId), "all intents stay OLD");
    assert.equal(executors.host.specs.length, 3, "no obsolete recheck2 execution");
    // C6: 4-field actual-state invariance.
    assert.deepEqual(actualState(sup, g.agentId), actualBeforeAppr, "actual phase/currentTask unchanged across obsolete-recheck suppression");
    assert.notEqual(sup.gateController.inspect(g.taskRunId)?.terminal, "passed", "interrupted gate must not pass");
    assert.equal(recs.some((r) => r.kind === "task.phase" && (r.body as Record<string, unknown>)["taskRunId"] === newer.taskRunId && (r.body as Record<string, unknown>)["phase"] === "repair_queued"), false);
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
