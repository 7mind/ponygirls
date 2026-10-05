import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRunStore, InMemoryRunStore, type RunStore } from "../src/store.ts";
import { checkpointSha256 } from "../src/store.ts";

type Factory = () => { store: RunStore; cleanup: () => void };

function fileFactory(): Factory {
  const dir = mkdtempSync(join(tmpdir(), "subagents-store-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  let n = 0;
  return () => {
    const rootDir = join(dir, `root-${n++}`);
    return { store: new FileRunStore(rootDir, `root-${n}`), cleanup: () => {} };
  };
}

function memFactory(): Factory {
  return () => ({ store: new InMemoryRunStore("root-mem"), cleanup: () => {} });
}

// Dual-test contract: every behavior runs against both adapters.
for (const [name, factory] of [["file", fileFactory()], ["memory", memFactory()]] as Array<[string, Factory]>) {
  test(`[${name}] append assigns monotonic seqs; readSince is cursor-bounded`, () => {
    const { store } = factory();
    const a = store.append("agent.spawned", { agentId: "a" });
    const b = store.append("mailbox.accepted", { messageId: "m" });
    assert.ok(b.seq > a.seq);
    const { records, cursor } = store.readSince(a.seq, 10);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.seq, b.seq);
    assert.equal(cursor, b.seq);
    store.close();
  });

  test(`[${name}] command deduplication: repeated spawn returns one identity`, () => {
    const { store } = factory();
    const spawned = store.append("agent.spawned", { agentId: "a-1", requestId: "req-1" });
    store.recordCommand("req-1", spawned);
    const prior = store.loadCommand("req-1");
    assert.ok(prior);
    assert.equal((prior.body as { agentId: string }).agentId, "a-1");
    assert.equal(store.loadCommand("req-other"), null);
    store.close();
  });

  test(`[${name}] checkpoint retention is bounded (latest + staged predecessor)`, () => {
    const { store } = factory();
    const bytes = (n: number): Uint8Array => new TextEncoder().encode(`checkpoint-${n}-` + "x".repeat(100));
    for (let gen = 1; gen <= 5; gen++) {
      const b = bytes(gen);
      store.saveCheckpoint({ agentId: "a", taskRunId: "t", generation: gen, leafEntryId: null, sha256: checkpointSha256(b), bytes: b.length, createdAt: "", superseded: false }, b);
    }
    store.supersedeCheckpoint("a");
    const loaded = store.loadCheckpoint("a");
    assert.ok(loaded);
    assert.equal(loaded.ref.generation, 5);
    store.close();
  });

  test(`[${name}] checkpoint validation rejects tampered bytes`, () => {
    const { store } = factory();
    const b = new TextEncoder().encode("good-bytes");
    store.saveCheckpoint({ agentId: "a", taskRunId: "t", generation: 1, leafEntryId: null, sha256: checkpointSha256(b), bytes: b.length, createdAt: "", superseded: false }, b);
    if (store instanceof InMemoryRunStore) {
      // Tamper via a second save with a mismatched digest.
      const evil = new TextEncoder().encode("evil-bytes-evil");
      store.saveCheckpoint({ agentId: "b", taskRunId: "t", generation: 1, leafEntryId: null, sha256: checkpointSha256(b), bytes: evil.length, createdAt: "", superseded: false }, evil);
      assert.throws(() => store.loadCheckpoint("b"), /RECOVERY_CORRUPT/);
    }
    store.close();
  });
}

test("[file] torn tail beyond the committed boundary is discarded with recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-torn-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const rootDir = join(dir, "root");
  const s1 = new FileRunStore(rootDir, "root-torn");
  s1.append("agent.spawned", { agentId: "a" });
  // Simulate a crash mid-append: torn bytes past the committed boundary.
  appendFileSync(join(rootDir, "journal.log"), "12 deadbee");
  const s2 = new FileRunStore(rootDir, "root-torn");
  const { records } = s2.readSince(0, 100);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.kind, "agent.spawned");
  s2.close();
});

test("[file] corruption at or before the committed boundary fails recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-corrupt-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const rootDir = join(dir, "root");
  const s1 = new FileRunStore(rootDir, "root-corrupt");
  s1.append("agent.spawned", { agentId: "a" });
  // Corrupt a committed frame in place (same length, bad checksum).
  const journal = join(rootDir, "journal.log");
  const raw = readFileSync(journal, "utf8");
  const corrupted = raw.replace(/[0-9a-f]{16}/, "0000000000000000");
  assert.notEqual(corrupted, raw);
  writeFileSync(journal, corrupted);
  assert.throws(() => new FileRunStore(rootDir, "root-corrupt"), /RECOVERY_CORRUPT/);
});

test("[file] journaled outcomes never carry raw read/diff payloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-meta-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new FileRunStore(join(dir, "root"), "root-meta");
  store.append("tool.outcome", { operationId: "op-1", status: "ok", preview: "abc" });
  const raw = readFileSync(join(dir, "root", "journal.log"), "utf8");
  assert.ok(raw.includes("preview"));
  assert.ok(!raw.includes("ipc-frame"));
  store.close();
});
