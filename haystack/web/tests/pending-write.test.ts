// BG, regression: lost replies must replay one frozen operation, never a fresh
// write or an edited payload. No real transport or wall-clock dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WriteCoordinator, PendingWriteBlocked, type WriteOperation } from "../src/pending-write.ts";
const original: WriteOperation = { key: "p:i", documentJson: '{"n":9007199254740993}', expectedRevision: 1, requestId: "original-id" };

test("lost success response retries exact request id/payload and creates one history revision", async () => {
  const calls: WriteOperation[] = [];
  const replay = new Map<string, number>(); let history = 1;
  const coordinator = new WriteCoordinator(async (operation) => {
    calls.push({ ...operation });
    if (!replay.has(operation.requestId)) replay.set(operation.requestId, ++history);
    if (calls.length === 1) throw new Error("response lost after commit");
    return { revision: replay.get(operation.requestId)! };
  }, () => false);
  await assert.rejects(coordinator.execute(original));
  assert.equal(coordinator.snapshot()?.requestId, "original-id");
  const result = await coordinator.execute({ ...original, requestId: "fresh-id-must-not-be-used" });
  assert.equal(result.revision, 2); assert.equal(history, 2); assert.deepEqual(calls, [original, original]);
  assert.equal(coordinator.snapshot(), undefined);
});

test("edited payload, key or CAS cannot replace an uncertain operation before explicit reconciliation", async () => {
  const calls: WriteOperation[] = []; let attempts = 0;
  const coordinator = new WriteCoordinator(async (operation) => { calls.push({ ...operation }); if (++attempts === 1) throw new Error("offline"); return 2; }, () => false);
  await assert.rejects(coordinator.execute(original));
  for (const changed of [{ ...original, key: "p:other" }, { ...original, expectedRevision: 2 }, { ...original, documentJson: "edited draft" }])
    await assert.rejects(coordinator.execute(changed), PendingWriteBlocked);
  assert.deepEqual(calls, [original]);
  await coordinator.retry(); assert.deepEqual(calls, [original, original]);
  await coordinator.execute({ ...original, expectedRevision: 2, documentJson: "edited draft", requestId: "new-id" });
  assert.equal(calls[2]?.requestId, "new-id");
});

test("concurrent same-operation submits share one flight; different writes are blocked", async () => {
  let release: (value: number) => void = () => {}; let sends = 0;
  const coordinator = new WriteCoordinator(() => { sends++; return new Promise<number>((r) => { release = r; }); }, () => false);
  const one = coordinator.execute(original); const two = coordinator.execute({ ...original, requestId: "unused" });
  assert.equal(one, two);
  await assert.rejects(coordinator.execute({ ...original, documentJson: "other" }), PendingWriteBlocked);
  assert.equal(sends, 1); release(2); await one; assert.equal(coordinator.snapshot(), undefined);
});

test("terminal fault clears pending; session reset cannot let an older flight clear a new operation", async () => {
  const terminal = new Error("conflict");
  const failed = new WriteCoordinator(async () => { throw terminal; }, (error) => error === terminal);
  await assert.rejects(failed.execute(original)); assert.equal(failed.snapshot(), undefined);
  let release: (n: number) => void = () => {};
  let calls = 0;
  const coordinator = new WriteCoordinator(() => ++calls === 1 ? new Promise<number>((r) => { release = r; }) : Promise.reject(new Error("offline")), () => false);
  const old = coordinator.execute(original); await Promise.resolve(); coordinator.clear();
  await assert.rejects(coordinator.execute({ ...original, requestId: "new-session" }));
  release(2); await old; assert.equal(coordinator.snapshot()?.requestId, "new-session");
});
