import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FileRunStore } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import type { PinnedGoverningHandle } from "../src/governing-runtime.ts";
import type { ProviderAdmissionResponse } from "../src/protocol.ts";
import { PROTOCOL_VERSION } from "../src/types.ts";
import type { ProviderAdmissionHandler } from "../src/worker-launch.ts";
import { CtlWorker, mkSup, tick } from "./ctl-worker.ts";
import { TEST_MODEL, testGovernor } from "./fake-worker.ts";

// Regression: exercise the real file-store latch, not a transient append stub.
function withFullDisk(t: TestContext, action: () => void): void {
  t.mock.method(fs, "writeSync", () => { throw Object.assign(new Error("ENOSPC: injected full disk"), { code: "ENOSPC" }); });
  syncBuiltinESMExports();
  try { action(); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
}

function fileStore(t: TestContext): { dir: string; store: FileRunStore } {
  const dir = fs.mkdtempSync(join(tmpdir(), "subagents-storage-fault-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: new FileRunStore(dir, "root-1") };
}

test("journal ENOSPC denies subsequent provider requests even after disk writes work again", async (t) => {
  const { dir, store } = fileStore(t);
  let requestAdmission: (() => Promise<ProviderAdmissionResponse>) | null = null;
  const { sup } = mkSup({ dir, store, factory: ({ agentId }) => {
    const worker = new CtlWorker(agentId);
    return Object.assign(worker, {
      setProviderAdmissionRequestHandler(handler: ProviderAdmissionHandler): void {
        requestAdmission = () => {
          const payload = { reason: "stream" as const, provider: TEST_MODEL.provider, modelId: TEST_MODEL.id, thinkingLevel: TEST_MODEL.thinkingLevel };
          return handler(payload, { protocolVersion: PROTOCOL_VERSION, rootEpoch: sup.currentEpoch, agentId, workerInstanceId: worker.instanceId, requestId: "admission", seq: 1, type: "request", operation: "provider.admission", taskRunId: worker.taskRunId, executionGeneration: worker.generation, payload });
        };
      },
    });
  } });
  t.after(() => sup.shutdown());
  await sup.spawn("governor", { taskName: "probe", profile: "reader", message: "wait" }, "spawn");
  assert.ok(requestAdmission);
  const admit = requestAdmission as () => Promise<ProviderAdmissionResponse>;
  assert.deepEqual(await admit(), { ok: true });
  withFullDisk(t, () => assert.throws(() => store.append("task.phase", {}), /STORE_FAILED.*ENOSPC/));
  const denied = await admit();
  assert.equal(denied.ok, false, "poisoned journal must block inference, not only tool writes");
  if (!denied.ok) assert.equal(denied.code, "STORE_FAILED");
  assert.equal(sup.listWithCapacity("governor").storageFailure?.causeCode, "ENOSPC");
  await assert.rejects(() => sup.spawn("governor", { taskName: "blocked", profile: "reader", message: "no" }, "blocked"), /STORE_FAILED/);
});

test("failed settlement wakes observers and returns an explicit storage-failure wait, not a timeout", async (t) => {
  const { dir, store } = fileStore(t);
  let changes = 0;
  const { sup, byAgent } = mkSup({ dir, store, onChange: () => { changes++; } });
  t.after(() => sup.shutdown());
  const a = await sup.spawn("governor", { taskName: "probe", profile: "reader", message: "wait" }, "spawn");
  await tick();
  const waiting = sup.wait("governor", store.durableSeq(), 500, [{ agentId: a.agentId, taskRunId: a.taskRunId }], "all_settled");
  const before = changes;
  withFullDisk(t, () => assert.throws(() => store.append("task.phase", {}), /STORE_FAILED.*ENOSPC/));
  byAgent(a.agentId)[0]!.settle();
  await tick();
  assert.ok(changes > before, "failure must notify without a successful journal append");
  assert.equal(sup.needsRecovery, true);
  const result = await waiting;
  assert.equal(result.completed, false);
  assert.equal(result.reason, "storage_failed");
  assert.equal(result.storageFailure?.causeCode, "ENOSPC");
  assert.match(sup.read("governor", a.agentId, "status", 0, 1, null).status.pendingIntent, /last known/);
  assert.match(store.writeFailure()!.message, /\/reload retains this failed store/);
  assert.equal(sup.list("governor")[0]!.taskOutcome, null, "no fabricated terminal result");
});

test("first ENOSPC during question expiry leaves inspection available and does not fabricate expiry", async (t) => {
  const { dir, store } = fileStore(t);
  const { sup, byAgent } = mkSup({ dir, store });
  t.after(() => sup.shutdown());
  const a = await sup.spawn("governor", { taskName: "question", profile: "reader", message: "ask" }, "spawn");
  await tick();
  assert.equal((await byAgent(a.agentId)[0]!.question()).isError, false);
  const question = sup.pendingQuestions("governor")[0]!;
  t.mock.method(Date, "now", () => Date.parse(question.deadlineAt) + 1);
  withFullDisk(t, () => {
    const report = sup.listWithCapacity("governor");
    assert.equal(report.storageFailure?.causeCode, "ENOSPC");
  });
  assert.deepEqual(sup.pendingQuestions("governor"), [question], "expiry was not committed");
  assert.equal(store.readSince(0, 1000).records.some((r) => r.kind === "mailbox.question_expired"), false);
  assert.equal((await sup.wait("governor", 0, 500, null, "activity")).reason, "storage_failed");
});

test("storage failure during delegated preparation prevents execution", { timeout: 5000 }, async (t) => {
  const { dir, store } = fileStore(t);
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const seen: unknown[] = [];
  const name = "mcp__fixture__probe";
  const handle: PinnedGoverningHandle = {
    name, description: "probe", parameters: { type: "object" },
    execute: async (_id, args) => {
      seen.push(args);
      return { content: [{ type: "text", text: "executed" }], details: {} };
    },
  };
  const policy = defaultSupervisorPolicy();
  policy.allowedTools = [name];
  policy.allowedModels = [{ provider: TEST_MODEL.provider, id: TEST_MODEL.id }];
  const workers: CtlWorker[] = [];
  const sup = new Supervisor({
    rootId: "root-1", rootDir: dir, store, policy, governor: testGovernor,
    executors: { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() },
    workspace: new DummyWorkspaceManager(),
    workerFactory: ({ agentId }) => { const worker = new CtlWorker(agentId); workers.push(worker); return worker; },
    governingRegistry: () => ({
      isActive: () => true, listHandles: () => [handle],
      getHandle: (n) => n === name ? handle : undefined, baseCtx: () => ({}),
    }),
    prepareDelegatedCall: async (call) => { entered.resolve(); await release.promise; return call.args; },
  });
  t.after(async () => { release.resolve(); await sup.shutdown(); });
  await sup.spawn("governor", { taskName: "probe", profile: "reader", isolation: "none", message: "wait" }, "spawn");
  const pending = workers[0]!.call(name, { query: "probe" });
  await entered.promise;
  withFullDisk(t, () => assert.throws(() => store.append("task.phase", {}), /STORE_FAILED.*ENOSPC/));
  release.resolve();
  const result = await pending;
  assert.equal(result.isError, true);
  assert.match(result.content, /STORE_FAILED/);
  assert.deepEqual(seen, [], "must recheck storage before execute");
});

test("a poisoned store rejects side-file writes and cannot acknowledge a failed command", (t) => {
  const { dir, store } = fileStore(t);
  const record = store.append("task.phase", {});
  withFullDisk(t, () => assert.throws(() => store.recordCommand("failed-command", record), /STORE_FAILED.*ENOSPC/));
  assert.equal(store.loadCommand("failed-command"), null, "failed command publication must not populate the dedup cache");
  assert.throws(() => store.saveResult("a", "t", 1, "uncommitted"), /STORE_FAILED/);
  assert.deepEqual(fs.readdirSync(join(dir, "results")), []);
});

for (const point of ["partial-write", "short-write", "journal-sync", "manifest-write", "manifest-sync", "manifest-rename", "directory-sync"] as const) {
  test(`file durability failure at ${point} stays latched; reopen validates the manifest boundary`, (t) => {
    const { dir, store } = fileStore(t);
    store.append("task.phase", { marker: "committed" });
    let notifications = 0;
    store.onWriteFailure(() => { notifications++; });
    const diskFull = (): never => { throw Object.assign(new Error(`ENOSPC at ${point}`), { code: "ENOSPC" }); };
    if (point === "partial-write" || point === "short-write") {
      const write = fs.writeSync;
      t.mock.method(fs, "writeSync", (fd: number, bytes: Buffer) => {
        write(fd, bytes.subarray(0, 7));
        return point === "short-write" ? 7 : diskFull();
      });
    } else if (point === "manifest-write") {
      t.mock.method(fs, "writeFileSync", diskFull);
    } else if (point === "manifest-rename") {
      t.mock.method(fs, "renameSync", diskFull);
    } else {
      const sync = fs.fsyncSync;
      const failAt = point === "journal-sync" ? 1 : point === "manifest-sync" ? 2 : 3;
      let calls = 0;
      t.mock.method(fs, "fsyncSync", (fd: number) => { if (++calls === failAt) diskFull(); sync(fd); });
    }
    syncBuiltinESMExports();
    try { assert.throws(() => store.append("task.phase", { marker: "uncertain" }), /STORE_FAILED/); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(notifications, 1);
    assert.equal(store.durableSeq(), 1, "failed append was not acknowledged in this process");
    const failedBytes = fs.readFileSync(join(dir, "journal.log"));
    assert.throws(() => store.append("task.phase", { marker: "must-not-run" }), /STORE_FAILED/);
    assert.throws(() => store.saveResult("a", "t", 1, "not saved"), /STORE_FAILED/);
    const checkpoint = { agentId: "a", taskRunId: "t", generation: 1, leafEntryId: null, sha256: "unused", bytes: 0, createdAt: "", superseded: false };
    assert.throws(() => store.saveCheckpoint(checkpoint, new Uint8Array()), /STORE_FAILED/);
    assert.throws(() => store.supersedeCheckpoint("a"), /STORE_FAILED/);
    assert.deepEqual(fs.readFileSync(join(dir, "journal.log")), failedBytes);
    assert.equal(notifications, 1);
    store.close();
    const reopened = new FileRunStore(dir, "root-1");
    t.after(() => reopened.close());
    const markers = reopened.readSince(0, 100).records.filter((r) => r.kind === "task.phase").map((r) => r.body["marker"]);
    assert.deepEqual(markers, point === "directory-sync" ? ["committed", "uncertain"] : ["committed"]);
    assert.equal(reopened.writeFailure(), null);
    reopened.append("task.phase", { marker: "after-reopen" });
    assert.throws(() => store.saveResult("a", "t", 1, "stale-owner"), /STORE_FAILED/);
  });
}

test("kernel ENOSPC from /dev/full latches without exhausting the filesystem", { skip: process.platform !== "linux" }, (t) => {
  const { dir, store } = fileStore(t);
  store.append("task.phase", { marker: "preserved" });
  const journal = join(dir, "journal.log");
  const backup = join(dir, "journal.backup");
  fs.renameSync(journal, backup);
  fs.symlinkSync("/dev/full", journal);
  assert.throws(() => store.append("task.phase", {}), /STORE_FAILED.*ENOSPC/);
  fs.unlinkSync(journal);
  fs.renameSync(backup, journal);
  assert.equal(store.writeFailure()!.causeCode, "ENOSPC");
  assert.throws(() => store.append("task.phase", {}), /STORE_FAILED/);
  store.close();
  const reopened = new FileRunStore(dir, "root-1");
  assert.equal(reopened.readSince(0, 100).records[0]!.body["marker"], "preserved");
  reopened.close();
});
