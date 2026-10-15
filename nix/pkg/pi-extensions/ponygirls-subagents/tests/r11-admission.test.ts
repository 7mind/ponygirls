/**
 * R11 admission-boundary repairs: NEW provider commands and NEW native
 * controller/check effects are denied/parked while the admission hold is
 * active — including AFTER awaits (worker launch, checkpoint) at the actual
 * send boundary — and managed-reviewer routes are not exempt for NEW
 * inference. Settle/control/cancel/receipt paths stay available.
 *
 * - A: runControllerCheck catch respects single outcome ownership
 *   (cancel-owned or disposed): exactly one outcome, error propagates.
 * - B-startup: continueStartup re-checks the hold after the launch await,
 *   before initialize; cleanup touches only owned worker/lease state and
 *   the failure stays observable (failed terminal, spawn throws).
 * - B-deliver: deliverRun re-checks the hold after the checkpoint await,
 *   before the deliver prompt; held delivery fails visibly, no prompt.
 * - C: launchReview/startReviewerExecution park NEW reviewer launches
 *   while held (no worker, no model cost); wake paths re-check.
 * - D-direct: public runCheck denies while held, even with a valid
 *   binding; the gate loop records the denial as visible evidence.
 * - D-loop: genuine two-declared-check gate run with a second agent's held
 *   native cancel keeping the recover window open: check1 completes, the
 *   NEXT check is denied mid-pause with visible evidence and zero backend
 *   entry.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { WorkerHandle } from "../src/worker-launch.ts";
import { bindChannel } from "../src/protocol.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { Supervisor } from "../src/supervisor.ts";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mkSup, tick, gateSpec } from "./ctl-worker.ts";
import { testGovernor } from "./fake-worker.ts";
import { InMemoryRunStore } from "../src/store.ts";
import { GitWorkspaceManager } from "../src/workspace.ts";

const SDK_ROOT = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? null;

function gitCheckout(dir: string): string {
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "a.txt"), "a\n");
  spawnSync("git", ["init", "-q", repo]);
  spawnSync("git", ["-C", repo, "add", "."]);
  spawnSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"]);
  return repo;
}

function outcomesFor(sup: any, op: string): string[] {
  return sup.runStore
    .readSince(0, Number.MAX_SAFE_INTEGER)
    .records.filter((r: any) => r.kind === "tool.outcome" && r.body?.operationId === op)
    .map((r: any) => r.body.status);
}

function intentsFor(sup: any, taskRunId: string): number {
  return sup.runStore
    .readSince(0, Number.MAX_SAFE_INTEGER)
    .records.filter((r: any) => r.kind === "tool.intent" && r.body?.taskRunId === taskRunId).length;
}

// Hung backend; release mode per trial. Cancel never releases by itself.
function installHung(built: any, gates: Map<string, () => void>, mode: { current: string }) {
  for (const ex of [built.executors.host, built.executors.sandbox]) {
    ex.handler = (spec: any) =>
      new Promise((resolve, reject) => {
        gates.set(spec.operationId, () => {
          if (mode.current === "reject") reject(new Error("injected backend cancel failure"));
          else resolve({ stdout: "check-done", stderr: "", exitCode: 0, signal: null, timedOut: false, truncated: false });
        });
      });
  }
}

async function enteredOp(gates: Map<string, () => void>, timeoutMs = 5000): Promise<string> {
  const t0 = Date.now();
  let op: string | null = null;
  while (!op && Date.now() - t0 < timeoutMs) {
    await tick(10);
    op = [...gates.keys()][0] ?? null;
  }
  assert.ok(op, "gate check never entered backend");
  return op;
}

// ---------------------------------------------------------- A ---
test("R11-A gate-check catch keeps single outcome after cancel-then-reject", async () => {
  const built = mkSup({ store: new InMemoryRunStore("root-r11a"), policy: () => {} });
  const gates = new Map<string, () => void>();
  installHung(built, gates, { current: "reject" });
  const g = await built.sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", isolation: "none" }, "r11a-1");
  await tick(50);
  const pending = built.sup.runCheck(g.agentId, g.taskRunId, { id: "c1", command: "sleep 30", timeoutMs: 60000 });
  pending.catch(() => {});
  const op = await enteredOp(gates);
  await built.sup.toolBroker.cancelJobs(g.agentId);
  const t1 = Date.now();
  while (Date.now() - t1 < 5000) {
    if (outcomesFor(built.sup, op).includes("cancelled")) break;
    await tick(10);
  }
  assert.ok(outcomesFor(built.sup, op).includes("cancelled"), "bulk cancel must journal first");
  gates.get(op)!();
  gates.delete(op);
  await assert.rejects(() => pending, /injected backend cancel failure/);
  await tick(100);
  assert.deepEqual(outcomesFor(built.sup, op), ["cancelled"]);
  await built.sup.shutdown().catch(() => {});
});

test("R11-A gate-check held reject without cancel journals one uncertain", async () => {
  const built = mkSup({ store: new InMemoryRunStore("root-r11a2"), policy: () => {} });
  const gates = new Map<string, () => void>();
  installHung(built, gates, { current: "reject" });
  const g = await built.sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", isolation: "none" }, "r11a-2");
  await tick(50);
  const pending = built.sup.runCheck(g.agentId, g.taskRunId, { id: "c1", command: "false", timeoutMs: 60000 });
  pending.catch(() => {});
  const op = await enteredOp(gates);
  gates.get(op)!();
  gates.delete(op);
  await assert.rejects(() => pending, /injected backend cancel failure/);
  await tick(100);
  assert.deepEqual(outcomesFor(built.sup, op), ["uncertain"]);
  await built.sup.shutdown().catch(() => {});
});

test("R11-A gate-check reject after disposal retains instead of journaling", async () => {
  const built = mkSup({ store: new InMemoryRunStore("root-r11a3"), policy: () => {} });
  const gates = new Map<string, () => void>();
  installHung(built, gates, { current: "reject" });
  const g = await built.sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", isolation: "none" }, "r11a-3");
  await tick(50);
  const pending = built.sup.runCheck(g.agentId, g.taskRunId, { id: "c1", command: "false", timeoutMs: 60000 });
  pending.catch(() => {});
  const op = await enteredOp(gates);
  built.sup.toolBroker.dispose();
  gates.get(op)!();
  gates.delete(op);
  await assert.rejects(() => pending, /injected backend cancel failure/);
  await tick(100);
  assert.deepEqual(outcomesFor(built.sup, op), []);
  assert.equal(built.sup.toolBroker.hasPendingReceipts(), true);
  await built.sup.shutdown().catch(() => {});
});

// ---------------------------------------------------------- B-startup ---
test("R11-B shutdown mid-launch denies initialize with owned cleanup only", async () => {
  let releaseLaunch!: () => void;
  const launchGate = new Promise<void>((r) => { releaseLaunch = r; });
  const kills: string[] = [];
  let calls = 0;
  const { CtlWorker } = await import("./ctl-worker.ts");
  const built = mkSup({
    store: new InMemoryRunStore("root-r11bs"),
    policy: () => {},
    factory: (o: any) => {
      calls++;
      const inner = new CtlWorker(o.agentId);
      return new Proxy(inner, {
        get(t: any, prop: string | symbol) {
          if (prop === "launch") return () => launchGate.then(() => t.launch());
          if (prop === "kill") return () => { kills.push(o.agentId); return t.kill(); };
          const v: any = Reflect.get(t, prop, t);
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
    },
  });
  const spawnP = built.sup.spawn("governor", { taskName: "v", message: "go", profile: "reader" }, "r11bs-1");
  spawnP.catch(() => {});
  await tick(100);
  const shutP = built.sup.shutdown();
  shutP.catch(() => {});
  assert.equal((built.sup as any).suspended, true);
  releaseLaunch();
  await assert.rejects(() => spawnP, /suspend|NOT_RUNNING/i);
  await shutP;
  assert.equal(calls, 1);
  assert.deepEqual(kills, [built.sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((r: any) => r.kind === "agent.spawned")?.body?.agentId].filter(Boolean));
  const terms = built.sup.runStore
    .readSince(0, Number.MAX_SAFE_INTEGER)
    .records.filter((r: any) => r.kind === "task.terminal");
  assert.equal(terms.length, 1);
  assert.equal(terms[0].body.outcome, "failed");
  assert.match(String(terms[0].body.detail ?? ""), /suspend|NOT_RUNNING/i);
  const intents = built.sup.runStore
    .readSince(0, Number.MAX_SAFE_INTEGER)
    .records.filter((r: any) => r.kind === "tool.intent");
  assert.equal(intents.length, 0);
});

// ---------------------------------------------------------- B-deliver ---
test("R11-B fault during checkpoint await denies the deliver prompt", async () => {
  const base = new InMemoryRunStore("root-r11bd");
  let armed = true;
  const store = new Proxy(base, {
    get(t: any, prop: string | symbol) {
      if (prop === "append") {
        return (kind: string, body: any) => {
          if (armed && kind === "tool.outcome" && body?.status === "cancelled") {
            armed = false;
            throw new Error("STORE_FAILED: injected crash on cancelled commit");
          }
          return t.append(kind, body);
        };
      }
      const v: any = Reflect.get(t, prop, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  let releaseCheckpoint!: () => void;
  const checkpointGate = new Promise<void>((r) => { releaseCheckpoint = r; });
  const delivered: string[] = [];
  const { CtlWorker } = await import("./ctl-worker.ts");
  const mine: any[] = [];
  const built = mkSup({
    store: store as any,
    policy: () => {},
    factory: (o: any) => {
      const inner = new CtlWorker(o.agentId);
      mine.push(inner);
      return new Proxy(inner, {
        get(t: any, prop: string | symbol) {
          if (prop === "request") {
            return (op: string, payload: any, opts: any) => {
              if (op === "checkpoint") return checkpointGate.then(() => t.request(op, payload, opts));
              if (op === "deliver") delivered.push(String(payload?.text ?? ""));
              return t.request(op, payload, opts);
            };
          }
          const v: any = Reflect.get(t, prop, t);
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
    },
  });
  built.executors.host.handler = () => new Promise(() => {});
  const sup: any = built.sup;
  const g = await sup.spawn("governor", { taskName: "first", message: "one", profile: "reader" }, "r11bd-1");
  await tick(100);
  mine.find((w: any) => w.agentId === g.agentId).settle("succeeded", "t1-done");
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const term = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((r: any) => r.kind === "task.terminal" && r.body?.taskRunId === g.taskRunId);
    if (term) break;
    await tick(50);
  }
  const m2 = await sup.sendMessage("governor", g.agentId, "task", "two", {}, "r11bd-m2");
  assert.ok(m2.taskRunId);
  const t1 = Date.now();
  while (Date.now() - t1 < 10000) {
    if (sup.agents.get(g.agentId)?.activeRun?.taskRunId === m2.taskRunId) break;
    await tick(20);
  }
  assert.equal(sup.agents.get(g.agentId)?.activeRun?.taskRunId, m2.taskRunId);
  await tick(200);
  assert.equal(sup.toolBroker.hasPendingReceipts(), false);
  const rt = sup.agents.get(g.agentId);
  const caller = { agentId: g.agentId, taskRunId: rt.record.currentTaskRunId, generation: rt.record.executionGeneration, grants: rt.record.grants, workdir: rt.record.allocation.workdir, writableRoot: rt.record.allocation.writableRoot, sandbox: null };
  const ac = new AbortController();
  const faultOp = sup.toolBroker.execute(caller, { tool: "read", args: { path: "x" }, signal: ac.signal });
  faultOp.catch(() => {});
  const t2 = Date.now();
  while (Date.now() - t2 < 8000) {
    if (sup.toolBroker.activeJobs(g.agentId).length > 0) break;
    await tick(10);
  }
  assert.ok(sup.toolBroker.activeJobs(g.agentId).length > 0);
  ac.abort();
  await tick(300);
  assert.equal(sup.toolBroker.hasPendingReceipts(), true);
  const intentsBefore = intentsFor(sup, m2.taskRunId);
  releaseCheckpoint();
  const t3 = Date.now();
  let term2: any = null;
  while (!term2 && Date.now() - t3 < 10000) {
    term2 = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((r: any) => r.kind === "task.terminal" && r.body?.taskRunId === m2.taskRunId);
    if (!term2) await tick(50);
  }
  assert.ok(term2, "task2 must settle");
  assert.notEqual(term2.body.outcome, "succeeded");
  assert.equal(intentsFor(sup, m2.taskRunId), intentsBefore, "no new provider tool calls after release");
  assert.ok(!delivered.some((d) => d === "two"), "worker never prompted with task2");
  await sup.shutdown().catch(() => {});
});

// ---------------------------------------------------------- C ---
test("R11-C resume under hold parks the reviewer without new inference", async () => {
  const base = new InMemoryRunStore("root-r11c");
  const st = { armed: false };
  const store = new Proxy(base, {
    get(t: any, prop: string | symbol) {
      if (prop === "append") {
        return (kind: string, body: any) => {
          if (st.armed && kind === "recovery.event") {
            st.armed = false;
            throw new Error("STORE_FAILED: injected crash on recovery.event");
          }
          return t.append(kind, body);
        };
      }
      const v: any = Reflect.get(t, prop, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  let factoryCalls = 0;
  const { CtlWorker } = await import("./ctl-worker.ts");
  const mine: any[] = [];
  const built = mkSup({
    store: store as any,
    policy: () => {},
    factory: (o: any) => { factoryCalls++; const w = new CtlWorker(o.agentId); mine.push(w); return w; },
  });
  const sup: any = built.sup;
  const g = await sup.spawn("governor", { taskName: "gated", message: "go", profile: "reader", gate: { ...gateSpec(3) } }, "r11c-1");
  await tick(100);
  mine.find((w: any) => w.agentId === g.agentId).settle("succeeded", "candidate work");
  const t0 = Date.now();
  let reviewerId: string | null = null;
  while (Date.now() - t0 < 10000) {
    reviewerId = sup.gateController.inspect(g.taskRunId)?.reviewerId ?? null;
    if (reviewerId) break;
    await tick(50);
  }
  assert.ok(reviewerId, "reviewer linked");
  const t1 = Date.now();
  while (Date.now() - t1 < 10000) {
    if (sup.gateController.inspect(g.taskRunId)?.review?.status === "running") break;
    await tick(50);
  }
  assert.equal(sup.gateController.inspect(g.taskRunId)?.review?.status, "running");
  const callsBeforeRecover = factoryCalls;
  assert.ok(callsBeforeRecover >= 2, "reviewer worker launched");
  st.armed = true;
  await assert.rejects(() => sup.recover(), /STORE_FAILED/);
  assert.equal(sup.suspended, true);
  assert.equal(sup.gateController.inspect(g.taskRunId)?.review?.status, "interrupted");
  const callsBeforeResume = factoryCalls;
  const reviewId = sup.gateController.inspect(g.taskRunId)?.review?.reviewId;
  const res = await sup.manageGate("governor", { kind: "resume_review", taskRunId: g.taskRunId, reviewId }, "r11c-resume-1");
  assert.ok(res.taskRunId);
  await tick(500);
  assert.equal(factoryCalls, callsBeforeResume, "no new reviewer worker while held");
  assert.equal(sup.gateController.inspect(g.taskRunId)?.review?.status, "running");
  const rt = [...sup.agents.values()].find((r: any) => r.record.id === reviewerId);
  assert.ok(rt?.pendingReview, "review parked for the hold");
  await sup.shutdown().catch(() => {});
});

// ---------------------------------------------------------- D-direct ---
test("R11-D public runCheck denies while held, admits after heal", async () => {
  const base = new InMemoryRunStore("root-r11d");
  const st = { armed: false };
  const store = new Proxy(base, {
    get(t: any, prop: string | symbol) {
      if (prop === "append") {
        return (kind: string, body: any) => {
          if (st.armed && kind === "recovery.event") {
            st.armed = false;
            throw new Error("STORE_FAILED: injected crash on recovery.event");
          }
          return t.append(kind, body);
        };
      }
      const v: any = Reflect.get(t, prop, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const built = mkSup({ store: store as any, policy: () => {} });
  const sup: any = built.sup;
  const seen: string[] = [];
  built.executors.host.handler = (spec: any) => {
    seen.push(spec.operationId);
    return { stdout: "ok", stderr: "", exitCode: 0, signal: null, timedOut: false, truncated: false };
  };
  const g = await sup.spawn("governor", { taskName: "w", message: "m", profile: "writer", isolation: "none" }, "r11d-1");
  await tick(50);
  st.armed = true;
  await assert.rejects(() => sup.recover(), /STORE_FAILED/);
  assert.equal(sup.suspended, true);
  await assert.rejects(() => sup.runCheck(g.agentId, g.taskRunId, { id: "c2", command: "echo next", timeoutMs: 60000 }), /NOT_RUNNING|STORE_FAILED|SUSPEND/i);
  assert.equal(seen.length, 0);
  await sup.recover();
  assert.equal(sup.suspended, false);
  const g2 = await sup.spawn("governor", { taskName: "w2", message: "m", profile: "writer", isolation: "none" }, "r11d-2");
  await tick(50);
  const res = await sup.runCheck(g2.agentId, g2.taskRunId, { id: "c3", command: "true", timeoutMs: 60000 });
  assert.equal(res.exitCode, 0);
  await sup.shutdown().catch(() => {});
});

// ---------------------------------------------------------- D-loop ---
test("R11-D gate loop denies the NEXT check mid-pause with visible evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-r11dl-"));
  const repo = gitCheckout(dir);
  const built = mkSup({ dir: join(dir, "root"), store: new InMemoryRunStore("root-r11dl"), policy: () => {}, workspace: new GitWorkspaceManager(), governor: () => ({ ...testGovernor(), cwd: repo }) });
  const sup: any = built.sup;
  const gates = new Map<string, () => void>();
  built.executors.host.handler = (spec: any) =>
    new Promise((resolve) => {
      gates.set(spec.operationId, () => resolve({ stdout: "c-done", stderr: "", exitCode: 0, signal: null, timedOut: false, truncated: false }));
    });
  const cancelSeen: string[] = [];
  let releaseCancel!: () => void;
  const cancelGate = new Promise<void>((r) => { releaseCancel = r; });
  const origCancel = built.executors.host.cancel.bind(built.executors.host);
  built.executors.host.cancel = async (op: string) => { cancelSeen.push(op); await cancelGate; return origCancel(op); };
  // Holder first: recover stalls at its hanging cancel, window stays open.
  const h = await sup.spawn("governor", { taskName: "holder", message: "hold", profile: "reader" }, "r11dl-h");
  await tick(100);
  const hCall = built.byAgent(h.agentId)[0].call("read", { path: "x" });
  hCall.catch(() => {});
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    if (sup.toolBroker.activeJobs(h.agentId).length > 0) break;
    await tick(10);
  }
  assert.ok(sup.toolBroker.activeJobs(h.agentId).length > 0, "holder job active");
  const g = await sup.spawn(
    "governor",
    {
      taskName: "gated", message: "go", profile: "writer", isolation: "worktree",
      gate: { ...gateSpec(3), checks: [{ id: "c1", command: "sleep 30", timeoutMs: 60000 }, { id: "c2", command: "echo next", timeoutMs: 60000 }] },
    },
    "r11dl-1",
  );
  await tick(100);
  built.byAgent(g.agentId)[0].settle("succeeded", "candidate work");
  const t1 = Date.now();
  while (gates.size === 0 && Date.now() - t1 < 15000) await tick(20);
  assert.equal(gates.size, 1, "check1 entered backend");
  const recP = sup.recover();
  recP.catch(() => {});
  const t2 = Date.now();
  while (cancelSeen.length === 0 && Date.now() - t2 < 10000) await tick(10);
  assert.ok(cancelSeen.length > 0, "recover stalled at holder cancel");
  assert.equal(sup.suspended, true);
  for (const [, rel] of [...gates]) rel();
  gates.clear();
  // The loop must attempt check2 while the recover window is still open;
  // the fixed boundary denies it with visible evidence and zero entry.
  const t3 = Date.now();
  let evidence: any[] = [];
  while (Date.now() - t3 < 15000) {
    const rec = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((r: any) => r.kind === "gate.evidence" && r.body?.taskRunId === g.taskRunId);
    if (rec) { evidence = rec.body.evidence; break; }
    await tick(50);
  }
  const c2 = evidence.find((e: any) => e.id === "c2");
  assert.ok(c2, "loop reached check2 while paused");
  assert.equal(c2.exitCode, null);
  assert.match(String(c2.output ?? ""), /NOT_RUNNING|suspend|hold|recovery/i);
  assert.equal(gates.size, 0, "check2 never entered the backend");
  releaseCancel();
  await recP;
  await sup.shutdown().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});


// ---------------------------------------------------------- C-midlaunch ---
test("R11-C mid-launch shutdown parks the ready reviewer without inference (real workers)", async (t) => {
  if (!SDK_ROOT) { t.skip("needs pinned SDK worker"); return; }
  const { CtlWorker } = await import("./ctl-worker.ts");
  const { DummyToolExecutor } = await import("../src/sandbox.ts");
  const dir = mkdtempSync(join(tmpdir(), "subagents-r11cm-"));
  try {
    writeFileSync(join(dir, "hello.txt"), "hello-model-bytes\n");
    const MAIN_SCRIPT = [{ tool: "read", args: { path: "hello.txt" } }, { text: "candidate work" }];
    const REVIEWER_SCRIPT = [{ tool: "read", args: { path: "hello.txt" } }, { text: "review note" }];
    const harness = { factoryCalls: 0, holder: [] as any[], innerReady: false, releaseReady: () => {} };
    const readyGate = new Promise<void>((r) => { harness.releaseReady = r; });
    let releaseCancel!: () => void;
    const cancelGate = new Promise<void>((r) => { releaseCancel = r; });
    const cancelSeen: string[] = [];
    const policy = defaultSupervisorPolicy();
    policy.allowedModels = [{ provider: "p", id: "m" }];
    const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
    const sup: any = new Supervisor({
      rootId: "root-r11cm", rootDir: join(dir, "root"), store: new InMemoryRunStore("root-r11cm"), policy,
      governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
      schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
      executors,
      workspace: new DummyWorkspaceManager(),
      workerFactory: (o: any) => {
        harness.factoryCalls++;
        if (harness.factoryCalls === 1) {
          const w = new CtlWorker(o.agentId);
          harness.holder.push(w);
          return w;
        }
        const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
        const hostAgentDir = join(dir, "host-agent");
        mkdirSync(hostAgentDir, { recursive: true });
        const inner = new WorkerHandle({
          workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
          rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot: SDK_ROOT, deterministic: true,
          agentDir: join(dir, "worker-home", o.agentId), sessionsDir: join(dir, "sessions"), hostAgentDir,
          script: harness.factoryCalls === 2 ? MAIN_SCRIPT : REVIEWER_SCRIPT,
        }, binding);
        if (harness.factoryCalls === 2) return inner;
        return new Proxy(inner, {
          get(t: any, prop: string | symbol) {
            if (prop === "launch") {
              return async () => {
                await t.launch();
                harness.innerReady = true;
                await readyGate;
              };
            }
            const v: any = Reflect.get(t, prop, t);
            return typeof v === "function" ? v.bind(t) : v;
          },
        });
      },
    });
    const origHostCancel = executors.host.cancel.bind(executors.host);
    executors.host.cancel = async (op: string) => { cancelSeen.push(op); await cancelGate; return origHostCancel(op); };
    executors.host.handler = () => new Promise(() => {});
    const h = await sup.spawn("governor", { taskName: "holder", message: "hold", profile: "reader" }, "r11cm-h");
    await tick(100);
    const hCall = harness.holder.find((w: any) => w.agentId === h.agentId).call("read", { path: "hello.txt" });
    hCall.catch(() => {});
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      if (sup.toolBroker.activeJobs(h.agentId).length > 0) break;
      await tick(10);
    }
    assert.ok(sup.toolBroker.activeJobs(h.agentId).length > 0, "holder job active");
    executors.host.handler = null as any;
    const g = await sup.spawn("governor", { taskName: "gated", message: "go", profile: "reader", gate: { ...gateSpec(3) } }, "r11cm-1");
    const t1 = Date.now();
    let reviewerId: string | null = null;
    while (Date.now() - t1 < 90000) {
      reviewerId = sup.gateController.inspect(g.taskRunId)?.reviewerId ?? null;
      if (reviewerId) break;
      await tick(200);
    }
    assert.ok(reviewerId, "candidate admitted with managed reviewer");
    const t2 = Date.now();
    while (!harness.innerReady && Date.now() - t2 < 60000) await tick(50);
    assert.ok(harness.innerReady, "reviewer worker READY pre-initialize");
    assert.equal(harness.factoryCalls, 3);
    const shutP = sup.shutdown();
    shutP.catch(() => {});
    assert.equal(sup.suspended, true);
    const t3 = Date.now();
    while (cancelSeen.length === 0 && Date.now() - t3 < 10000) await tick(10);
    assert.ok(cancelSeen.length > 0, "shutdown held open at holder cancel");
    harness.releaseReady();
    // Absence window: the unfixed code infers within seconds; the fixed
    // code parks with zero provider entry.
    const reviewerDir = join(dir, "sessions", reviewerId!);
    const t4 = Date.now();
    while (Date.now() - t4 < 20000) await tick(200);
    const { readdirSync, readFileSync, existsSync } = await import("node:fs");
    let bytes = 0;
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.endsWith(".jsonl")) {
          for (const line of readFileSync(p, "utf8").split("\n")) {
            if (!line.trim()) continue;
            // Strict complete-JSON receipt only: a partially written tail
            // line must never count as provider entry.
            let isAssistant = false;
            try {
              isAssistant = (JSON.parse(line) as any)?.message?.role === "assistant";
            } catch {
              isAssistant = false;
            }
            if (isAssistant) bytes += line.length;
          }
        }
      }
    };
    if (existsSync(reviewerDir)) walk(reviewerDir);
    assert.equal(bytes, 0, "no reviewer inference after mid-launch shutdown");
    assert.equal(sup.suspended, true);
    assert.equal(sup.gateController.inspect(g.taskRunId)?.review?.status, "running");
    const rrt = [...sup.agents.values()].find((r: any) => r.record.id === reviewerId);
    assert.ok(rrt?.pendingReview, "ready reviewer parked for the hold");
    assert.equal(harness.factoryCalls, 3, "no relaunches while held");
    releaseCancel();
    await shutP;
    // Owned cleanup happened exactly once and nothing resurrects behind
    // the closed journal: worker retired, leases freed, park intact,
    // journal stable, still zero provider entry after a grace window.
    assert.equal(rrt?.worker ?? null, null, "reviewer worker retired");
    assert.equal(rrt?.runnableLease ?? null, null, "runnable lease freed");
    assert.equal(rrt?.residentLease ?? null, null, "resident lease freed");
    const journalBefore = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.length;
    const t5 = Date.now();
    while (Date.now() - t5 < 5000) await tick(200);
    assert.equal(sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.length, journalBefore, "journal stable after close");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------- billing-debt ---
test("R11 billing-debt: failed external usage commit holds health and denies new admissions", async () => {
  const CG = "mcp__codegraph__codegraph_explore";
  const cg = {
    name: CG, description: "d", parameters: { type: "object" },
    execute: async () => ({
      content: [{ type: "text", text: "x" }], details: {},
      usage: { input: 5, output: 7, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }),
  };
  const base = new InMemoryRunStore("root-r11bill");
  let armed = true;
  const fired: string[] = [];
  const store = new Proxy(base, {
    get(t: any, prop: string | symbol) {
      if (prop === "append") {
        return (kind: string, body: any) => {
          if (armed && kind === "usage.reported" && body?.external === true) {
            armed = false;
            fired.push(String(body?.operationId ?? "?"));
            throw Object.assign(new Error("STORE_FAILED: injected crash on external billing commit"), { code: "STORE_FAILED" });
          }
          return t.append(kind, body);
        };
      }
      const v: any = Reflect.get(t, prop, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const built = mkSup({
    store: store as any,
    rootId: "root-r11bill",
    policy: (p) => { p.allowedTools = [CG]; },
    governingRegistry: () => ({
      isActive: () => true, listHandles: () => [cg], getHandle: () => cg, baseCtx: () => ({}),
    }),
  });
  const sup: any = built.sup;
  const backendSpecs = () => built.executors.host.specs.length + built.executors.sandbox.specs.length;
  try {
    // Genuine admission: public spawn, real CtlWorker call path for the
    // external effect (caller grants observed, never invented).
    const g = await sup.spawn("governor", { taskName: "billed", message: "go", profile: "writer", isolation: "none" }, "r11bill-1");
    await tick(100);
    const worker = built.byAgent(g.agentId)[0];
    const res = await worker.call(CG, { q: "x" });
    assert.equal(res.isError, false);
    const t0 = Date.now();
    while (fired.length === 0 && Date.now() - t0 < 8000) await tick(20);
    assert.equal(fired.length, 1, "billing fault fired on the genuine op");
    const op = fired[0];
    const recs = () => sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records;
    const extReports = () => recs().filter(
      (r: any) => r.kind === "usage.reported" && r.body?.external === true && r.body?.operationId === op,
    );
    // Canonical OWN 5/7 record exists BEFORE manual recover, attributed to
    // the fired op — the debt is real, not inferred from the later ledger.
    const canon = recs().find(
      (r: any) => r.kind === "tool.outcome" && r.body?.operationId === op && r.body?.external === true,
    )?.body?.usage;
    assert.deepEqual({ input: canon?.input, output: canon?.output }, { input: 5, output: 7 }, "canonical own 5/7 durably committed pre-recover");
    assert.equal(extReports().length, 0, "report0: nothing billed");
    // Immediate public hold with a healthy store: no recover ran.
    assert.equal(sup.needsRecovery, true, "health true immediately after billing fault");
    // Query-only idle: the hold persists (no timer clears it) and idle
    // queries journal nothing.
    const n0 = recs().length;
    const tIdle = Date.now();
    let heldThroughout = true;
    while (Date.now() - tIdle < 800) {
      await tick(100);
      recs();
      void sup.needsRecovery;
      sup.noticesSince(0, 50);
      if (sup.needsRecovery !== true) heldThroughout = false;
    }
    assert.ok(heldThroughout, "hold persists across healthy query-only idle");
    assert.equal(recs().length, n0, "idle queries journal nothing");
    // New admissions denied: task, check on the valid binding, native.
    await assert.rejects(
      () => sup.spawn("governor", { taskName: "second", message: "m", profile: "writer", isolation: "none" }, "r11bill-2"),
      /RECOVERY_OWNER_UNCONFIRMED/,
      "new task denied while billing debt held",
    );
    await assert.rejects(
      () => sup.runCheck(g.agentId, g.taskRunId, { id: "held-check", command: "echo next", timeoutMs: 60000 }),
      /RECOVERY_OWNER_UNCONFIRMED/,
      "new check denied on a valid binding while held",
    );
    const specsBefore = backendSpecs();
    const native = await worker.call("read", { path: "x" });
    assert.equal(native.isError, true, "new native effect denied while held");
    assert.match(String(native.content ?? ""), /RECOVERY_OWNER_UNCONFIRMED/);
    assert.equal(backendSpecs(), specsBefore, "denied native effect never reaches a backend");
    // Explicit reconciliation bills the durable canonical receipt exactly
    // once, clears health, and re-admits new work.
    await sup.recover();
    assert.equal(extReports().length, 1, "recover bills exactly once");
    const sum = extReports().reduce((a: any, r: any) => ({ input: a.input + Number(r.body?.input ?? 0), output: a.output + Number(r.body?.output ?? 0) }), { input: 0, output: 0 });
    assert.deepEqual(sum, { input: 5, output: 7 });
    assert.equal(sup.needsRecovery, false, "health clears after billed reconciliation");
    const g2 = await sup.spawn("governor", { taskName: "second", message: "m", profile: "writer", isolation: "none" }, "r11bill-3");
    await tick(50);
    // Fresh live run for the healthy native control (recover retires old workers).
    const nativeOk = await built.byAgent(g2.agentId)[0].call("read", { path: "x" });
    assert.equal(nativeOk.isError, false, "healthy native read succeeds after heal");
    assert.equal(backendSpecs() > specsBefore, true, "healthy native effect reaches a backend after heal");
    built.executors.host.handler = () => ({ stdout: "ok", stderr: "", exitCode: 0, signal: null, timedOut: false, truncated: false });
    const ok = await sup.runCheck(g2.agentId, g2.taskRunId, { id: "after", command: "true", timeoutMs: 60000 });
    assert.equal(ok.exitCode, 0, "new check admitted after heal");
    await sup.recover();
    assert.equal(extReports().length, 1, "second recover keeps exactly one billing");
  } finally {
    await sup.shutdown(); // bare: owned cleanup errors fail, never silent
  }
});
