import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, appendFileSync, writeFileSync, copyFileSync, statSync, truncateSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRunStore, InMemoryRunStore, RootLock, type RunStore } from "../src/store.ts";
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

  test(`[${name}] the latest checkpoint wins across generation 9 → 10 → 11`, () => {
    const { store } = factory();
    for (let gen = 8; gen <= 11; gen++) {
      const b = new TextEncoder().encode(`checkpoint-${gen}`);
      store.saveCheckpoint({ agentId: "a", taskRunId: "t", generation: gen, leafEntryId: null, sha256: checkpointSha256(b), bytes: b.length, createdAt: "", superseded: false }, b);
      assert.equal(store.loadCheckpoint("a")?.ref.generation, gen);
    }
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
  assert.deepEqual(records.map((r) => r.kind), ["agent.spawned", "recovery.event"]);
  assert.equal((records[1]!.body as { phase: string }).phase, "uncommitted_tail_discarded");
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

function committedNames(rootDir: string): string[] {
  return new FileRunStore(rootDir, "root-j").readSince(0, 1000).records
    .filter((r) => r.kind === "task.phase")
    .map((r) => String((r.body as { n?: string }).n));
}

test("[file] a synced but unacknowledged record is never adopted as committed", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-unacked-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const s1 = new FileRunStore(dir, "root-j");
  s1.append("task.phase", { n: "a1" });
  s1.append("task.phase", { n: "a2" });
  copyFileSync(join(dir, "MANIFEST.json"), join(dir, "manifest.bak"));
  s1.append("task.phase", { n: "unacked" });
  // Crash after the journal fsync, before the manifest replacement.
  copyFileSync(join(dir, "manifest.bak"), join(dir, "MANIFEST.json"));
  const s2 = new FileRunStore(dir, "root-j");
  // Two committed records plus the explicit tail-discard recovery event.
  assert.equal(s2.durableSeq(), 3);
  const next = s2.append("task.phase", { n: "next" });
  assert.equal(next.seq, 4);
  assert.deepEqual(committedNames(dir), ["a1", "a2", "next"]);
});

test("[file] a torn tail without newline never swallows the next acknowledged record", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-tornnl-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const s1 = new FileRunStore(dir, "root-j");
  s1.append("task.phase", { n: "b1" });
  appendFileSync(join(dir, "journal.log"), '57 0123456789abcdef {"seq":2,"kind":"task.ph');
  const s2 = new FileRunStore(dir, "root-j");
  s2.append("task.phase", { n: "acked" });
  assert.deepEqual(committedNames(dir), ["b1", "acked"]);
});

test("[file] a damaged frame inside the committed boundary fails recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-dmg-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const s1 = new FileRunStore(dir, "root-j");
  s1.append("task.phase", { n: "c1" });
  s1.append("task.phase", { n: "c2-committed" });
  s1.append("task.phase", { n: "c3" });
  const raw = readFileSync(join(dir, "journal.log"), "utf8");
  const i = raw.indexOf("c2-committed");
  // Drop one byte but keep the file size: the frame length no longer matches.
  writeFileSync(join(dir, "journal.log"), raw.slice(0, i) + raw.slice(i + 1) + " ");
  assert.throws(() => new FileRunStore(dir, "root-j"), /RECOVERY_CORRUPT/);
});

test("[file] a journal shorter than the committed boundary fails recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-short-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const s1 = new FileRunStore(dir, "root-j");
  s1.append("task.phase", { n: "d1" });
  s1.append("task.phase", { n: "d2" });
  truncateSync(join(dir, "journal.log"), statSync(join(dir, "journal.log")).size - 10);
  assert.throws(() => new FileRunStore(dir, "root-j"), /RECOVERY_CORRUPT/);
});

test("[file] a missing journal with committed records fails recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-nojournal-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const s1 = new FileRunStore(dir, "root-j");
  s1.append("task.phase", { n: "e1" });
  rmSync(join(dir, "journal.log"));
  assert.throws(() => new FileRunStore(dir, "root-j"), /RECOVERY_CORRUPT/);
});

test("[file] an unreadable manifest beside a non-empty journal fails recovery", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-badmanifest-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const s1 = new FileRunStore(dir, "root-j");
  s1.append("task.phase", { n: "f1" });
  writeFileSync(join(dir, "MANIFEST.json"), "{garbage");
  assert.throws(() => new FileRunStore(dir, "root-j"), /RECOVERY_CORRUPT/);
});

test("[file] a published checkpoint whose files are gone or damaged fails loading", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-ckmissing-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new FileRunStore(dir, "root-j");
  const save = (gen: number): void => {
    const b = new TextEncoder().encode(`checkpoint-${gen}`);
    store.saveCheckpoint({ agentId: "a", taskRunId: "t", generation: gen, leafEntryId: null, sha256: checkpointSha256(b), bytes: b.length, createdAt: "", superseded: false }, b);
  };
  save(1);
  save(2);
  const [live] = readdirSync(join(dir, "checkpoints", "a"));
  assert.ok(live?.startsWith("gen-2-"), `only the live copy is retained, saw ${live}`);
  writeFileSync(join(dir, "checkpoints", "a", live!), "damaged");
  assert.throws(() => new FileRunStore(dir, "root-j").loadCheckpoint("a"), /RECOVERY_CORRUPT/);
  rmSync(join(dir, "checkpoints", "a"), { recursive: true, force: true });
  assert.throws(() => new FileRunStore(dir, "root-j").loadCheckpoint("a"), /RECOVERY_CORRUPT/);
});

test("root lock: a crashed owner's lock is reacquired; a live owner's is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-lock-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const storeModule = new URL("../src/store.ts", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `const { RootLock } = await import(${JSON.stringify(storeModule)}); const r = new RootLock(${JSON.stringify(dir)}).acquire(); console.log(r.ok ? "locked" : "refused"); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "inherit"] });
  const first = await new Promise<string>((resolve) => child.stdout.once("data", (d: Buffer) => resolve(d.toString().trim())));
  assert.equal(first, "locked");
  assert.equal(new RootLock(dir).acquire().ok, false, "live owner must keep the lock");
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  const lock = new RootLock(dir);
  const res = lock.acquire();
  assert.equal(res.ok, true, res.ok ? "" : res.error.message);
  lock.release();
});

test("root lock: a contender that observed a dead owner never removes a live successor's lock", () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-lockrace-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  // A dead owner's lock, as left by a crash.
  const lockDir = join(dir, "root.lock");
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(join(lockDir, "owner.json"), JSON.stringify({ pid: 2 ** 22 - 7, bootId: "gone", starttime: "1", acquiredAt: "dead", nonce: "dead" }));
  const a = new RootLock(dir);
  const b = new RootLock(dir) as unknown as { retireIfOwner: (seen: unknown) => boolean; readOwner: () => unknown; acquire: () => { ok: boolean } };
  const seenByB = b.readOwner(); // B observed the dead owner...
  assert.equal(a.acquire().ok, true); // ...A retired it and published its own lock...
  assert.equal(b.retireIfOwner(seenByB), false, "B must not retire A's live lock");
  assert.equal(b.acquire().ok, false);
  a.release();
  assert.equal(b.acquire().ok, true);
});
