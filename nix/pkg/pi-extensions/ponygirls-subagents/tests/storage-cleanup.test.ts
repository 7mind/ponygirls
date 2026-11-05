import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolBroker, type BrokerCaller } from "../src/broker.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { FileRunStore, InMemoryRunStore, RootLock, type RunStore } from "../src/store.ts";
import { CtlWorker, mkSup, tick } from "./ctl-worker.ts";

const ok = { exitCode: 0, signal: null, stdout: "late success", stderr: "", truncated: false, timedOut: false };
const externalTool = "mcp__cleanup__held";
function caller(agentId = "agent-1", taskRunId = "task-1", generation = 1): BrokerCaller {
  return {
    agentId, taskRunId, generation, workdir: "/tmp", writableRoot: null, sandbox: null,
    grants: { tools: ["read"], externalTools: [externalTool], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "none" },
  };
}

// Shared fault contract over the dummy and actual journal. Inject only the
// storage boundary error, never replace the cancellation/cleanup behavior.
function faulty(store: RunStore) {
  const failure = Object.assign(new Error("ENOSPC: injected cleanup journal failure"), { code: "ENOSPC" });
  const state = { appendsFail: false, closeFails: false, closes: 0, failure };
  const append = store.append.bind(store);
  const close = store.close.bind(store);
  store.append = (kind, body) => {
    if (state.appendsFail) throw failure;
    return append(kind, body);
  };
  store.close = () => {
    state.closes++;
    if (state.closeFails) throw failure;
    close();
  };
  return state;
}

for (const backend of ["memory", "file"] as const) {
  // Behavioral-Active Blackbox-Group (memory), Effectual-GoodCommunication
  // (file). Regression: one failed cancel receipt used to strand later jobs.
  test(`bulk cancellation survives ENOSPC and fences late success (${backend})`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "cleanup-broker-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const store = backend === "memory" ? new InMemoryRunStore("root-1") : new FileRunStore(dir, "root-1");
    t.after(() => store.close());
    const fault = faulty(store);
    const sandbox = new DummyToolExecutor();
    const host = new DummyToolExecutor();
    const { promise, resolve } = Promise.withResolvers<typeof ok>();
    t.after(() => resolve(ok));
    host.handler = () => promise;
    const broker = new ToolBroker({ sandbox, host }, store, [], {}, {});
    const pending = ["first", "second"].map((operationId) => broker.execute(caller(), { operationId, tool: "read", args: { path: "." } }));
    // Also observe late failures when an earlier assertion exposes the bug.
    const settled = Promise.allSettled(pending);
    t.after(async () => { resolve(ok); await settled; });
    fault.appendsFail = true;
    await assert.rejects(broker.cancelJobs("agent-1"), (e) => e === fault.failure);
    assert.deepEqual(host.cancelled, ["first", "second"], "every job must be cancelled despite journal failure");
    assert.deepEqual(sandbox.cancelled, ["first", "second"]);
    assert.deepEqual(broker.activeJobs("agent-1"), []);
    assert.equal(broker.hasPendingReceipts(), true);
    resolve(ok);
    for (const result of await Promise.all(pending)) assert.notEqual(result.exitCode, 0);
    assert.equal(store.readSince(0, 1000).records.some((r) => r.kind === "tool.outcome"), false);
    fault.appendsFail = false;
    await broker.cancelJobs("agent-1");
    assert.equal(broker.hasPendingReceipts(), false);
    assert.deepEqual(host.cancelled, ["first", "second"], "retry must not rerun cancellation/effects");
    assert.deepEqual(store.readSince(0, 1000).records.filter((r) => r.kind === "recovery.event").map((r) => r.body["operationId"]).sort(), ["first", "second"]);
    await assert.rejects(broker.execute(caller(), { operationId: "second", tool: "read", args: { path: "." } }), /DUPLICATE_REQUEST/);
  });

  for (const action of ["shutdown", "recover"] as const) {
    // Regression: first agent's journal fault must not strand workers,
    // external scopes, or native jobs belonging to later agents.
    test(`${action} cleans every agent before reporting ENOSPC (${backend})`, async (t) => {
      const dir = mkdtempSync(join(tmpdir(), "cleanup-supervisor-"));
      const store = backend === "memory" ? new InMemoryRunStore("root-1") : new FileRunStore(dir, "root-1");
      const fault = faulty(store);
      const { promise, resolve } = Promise.withResolvers<typeof ok>();
      const external = Promise.withResolvers<unknown>();
      let effects = 0;
      const handle = {
        name: externalTool, description: "held external effect", parameters: { type: "object" },
        execute: async () => { effects++; return external.promise; },
      };
      const { sup, workers, executors } = mkSup({
        dir, store, policy: (p) => { p.allowedTools = [externalTool]; },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [handle as never], getHandle: () => handle as never, baseCtx: () => ({}) }),
      });
      t.after(async () => {
        fault.appendsFail = false;
        resolve(ok);
        external.resolve({ content: [{ type: "text", text: "late" }], details: {} });
        await sup.shutdown();
        rmSync(dir, { recursive: true, force: true });
      });
      const agents = [];
      for (let i = 0; i < 2; i++) agents.push(await sup.spawn("governor", { taskName: `worker-${i}`, message: "hold", profile: "reader" }, `spawn-${i}`));
      await tick();
      assert.equal(workers.length, 2);
      executors.host.handler = () => promise;
      const native = agents.map((a, i) => sup.toolBroker.execute(caller(a.agentId, a.taskRunId, a.generation!), { operationId: `native-${i}`, tool: "read", args: { path: "." } }));
      const ext = agents.map((a, i) => sup.governingDispatcher.execute(caller(a.agentId, a.taskRunId, a.generation!), { operationId: `external-${i}`, tool: externalTool, args: {} }));
      await tick();
      assert.equal(effects, 2);
      fault.appendsFail = true;
      await assert.rejects(sup[action](), (e) => e === fault.failure);
      assert.deepEqual(workers.map((w) => w.killed), [true, true], "every worker must stop even when the first cancel receipt fails");
      assert.deepEqual(executors.host.cancelled, ["native-0", "native-1"]);
      for (const a of agents) {
        assert.deepEqual(sup.toolBroker.activeJobs(a.agentId), []);
        assert.deepEqual(sup.governingDispatcher.activeJobs(a.agentId), []);
      }
      assert.equal(sup.capacity().runnable, 0);
      assert.equal(sup.capacity().resident, 0);
      assert.equal(store.readSince(0, 10000).records.some((r) => r.kind === "task.terminal"), false, "no unjournaled terminal success");
      if (action === "shutdown") {
        assert.equal(fault.closes, 1);
        const nextOwner = new RootLock(dir);
        assert.equal(nextOwner.acquire().ok, true, "close success must release the lock despite earlier failure");
        await sup.shutdown();
        assert.equal(fault.closes, 1, "shutdown is idempotent after disposal");
        assert.equal(new RootLock(dir).acquire().ok, false, "old cleanup cannot release a new owner's lock");
        nextOwner.release();
      } else {
        assert.equal(fault.closes, 0);
        assert.equal(new RootLock(dir).acquire().ok, false, "recover retains ownership");
        fault.appendsFail = false;
        await sup.recover();
      }
      resolve(ok);
      external.resolve({ content: [{ type: "text", text: "late" }], details: {} });
      for (const result of await Promise.all(native)) assert.notEqual(result.exitCode, 0);
      for (const result of await Promise.all(ext)) assert.equal(result.isError, true);
      assert.equal(effects, 2, "uncertain effects must not replay");
      assert.equal(executors.host.specs.length, 2);
    });
  }
}

// Regression: a failure in one backend must not skip the other backend or
// claim a confirmed cancellation. Claim the entire batch before awaiting.
test("bulk cancellation attempts both backends and owns all outcomes before awaiting", async () => {
  const store = new InMemoryRunStore("root-1");
  const host = new DummyToolExecutor();
  const sandbox = new DummyToolExecutor();
  const failure = new Error("sandbox cancel failed");
  const held = Promise.withResolvers<typeof ok>();
  host.handler = () => held.promise;
  sandbox.cancel = async (operationId) => { sandbox.cancelled.push(operationId); held.resolve(ok); throw failure; };
  const broker = new ToolBroker({ sandbox, host }, store, [], {}, {});
  const pending = ["first", "second"].map((operationId) => broker.execute(caller(), { operationId, tool: "read", args: { path: "." } }));
  await assert.rejects(broker.cancelJobs("agent-1"), (e) => e === failure);
  assert.deepEqual(host.cancelled, ["first", "second"]);
  for (const result of await Promise.all(pending)) assert.notEqual(result.exitCode, 0);
  assert.deepEqual(store.readSince(0, 1000).records.filter((r) => r.kind === "tool.outcome").map((r) => r.body["status"]), ["uncertain", "uncertain"]);
});

test("shutdown retains the lock if store.close fails and allows a cleanup retry", async (t) => {
  const store = new InMemoryRunStore("root-1");
  const fault = faulty(store);
  const { sup, dir, workers } = mkSup({ store });
  t.after(async () => { fault.closeFails = false; await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  await sup.spawn("governor", { taskName: "held", message: "hold", profile: "reader" }, "held");
  await tick();
  fault.closeFails = true;
  await assert.rejects(sup.shutdown(), (e) => e === fault.failure);
  assert.equal(workers[0]!.killed, true);
  assert.equal(new RootLock(dir).acquire().ok, false);
  fault.closeFails = false;
  await sup.shutdown();
  const nextOwner = new RootLock(dir);
  assert.equal(nextOwner.acquire().ok, true);
  nextOwner.release();
});

for (const action of ["shutdown", "recover"] as const) {
  test(`${action} attempts later worker stops and permits retry of a failed stop`, async (t) => {
    const store = new InMemoryRunStore("root-1");
    const fault = faulty(store);
    const workers: CtlWorker[] = [];
    const failure = new Error("worker stop failed");
    let failStop = true;
    const { sup, dir } = mkSup({ store, factory: (o) => {
      const w = new CtlWorker(o.agentId);
      if (workers.length === 0) w.kill = () => {
        if (failStop) { failStop = false; throw failure; }
        w.killed = true;
      };
      workers.push(w);
      return w;
    } });
    t.after(async () => { await sup.shutdown(); rmSync(dir, { recursive: true, force: true }); });
    for (let i = 0; i < 2; i++) await sup.spawn("governor", { taskName: `held-${i}`, message: "hold", profile: "reader" }, `held-${i}`);
    await tick();
    await assert.rejects(sup[action](), (e) => e === failure);
    assert.deepEqual(workers.map((w) => w.killed), [false, true]);
    await sup[action]();
    assert.deepEqual(workers.map((w) => w.killed), [true, true], "retry must stop the retained failed handle");
    assert.equal(fault.closes, action === "shutdown" ? 1 : 0);
  });
}
