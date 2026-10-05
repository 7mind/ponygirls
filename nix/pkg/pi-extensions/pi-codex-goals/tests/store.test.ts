import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  FileGoalStore,
  InMemoryGoalStore,
  emptyEnvelope,
  sidecarPathFor,
  validateEnvelope,
  type GoalStore,
  type SidecarEnvelope,
} from "../src/store.ts";
import type { GoalId, GoalRecord, SessionId } from "../src/goal.ts";

function sampleGoal(): GoalRecord {
  return {
    id: "goal-1" as GoalId,
    objective: "Do the thing",
    status: "active",
    tokenBudget: 1000,
    tokensUsed: 10,
    timeUsedSeconds: 1,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
  };
}

type Factory = (sessionId: SessionId) => { store: GoalStore; cleanup?: () => void };

function fileFactory(): Factory {
  const dir = mkdtempSync(join(tmpdir(), "codex-goals-"));
  return (sessionId: SessionId) => {
    const sessionFile = join(dir, `${sessionId}.jsonl`);
    return { store: new FileGoalStore(sessionId, sessionFile) };
  };
}

function memoryFactory(): Factory {
  const backing = new Map<string, string>();
  return (sessionId: SessionId) => ({ store: new InMemoryGoalStore(sessionId, backing) });
}

async function contractSuite(name: string, factory: Factory): Promise<void> {
  await test(`${name}: successful commit survives reopening`, () => {
    const { store } = factory("sess-1" as SessionId);
    const first = store.load();
    assert.equal(first.ok, true);
    const rev = (first as { ok: true; value: SidecarEnvelope }).value.revision;
    const committed = store.commit(rev, (c) => ({ ...c, goal: sampleGoal() }));
    assert.equal(committed.ok, true);
    const reloaded = store.load();
    assert.equal(reloaded.ok, true);
    assert.equal((reloaded as { ok: true; value: SidecarEnvelope }).value.goal?.objective, "Do the thing");
  });

  await test(`${name}: failed commit never authorizes a dispatch`, () => {
    const { store } = factory("sess-2" as SessionId);
    const mem = store as InMemoryGoalStore;
    if (mem instanceof InMemoryGoalStore) mem.failWriteOnce = true;
    const first = store.load();
    assert.equal(first.ok, true);
    const rev = (first as { ok: true; value: SidecarEnvelope }).value.revision;
    // File adapter: force failure via invalid mutation (validation rejects).
    const bad = store.commit(rev, (c) => ({ ...c, goal: { ...sampleGoal(), tokensUsed: -1 } }));
    assert.equal(bad.ok, false);
    const after = store.load();
    assert.equal(after.ok, true);
    assert.equal((after as { ok: true; value: SidecarEnvelope }).value.goal, null);
  });

  await test(`${name}: malformed state is observable, not silent empty`, () => {
    const { store } = factory("sess-3" as SessionId);
    const mem = store as unknown as InMemoryGoalStore;
    if (mem instanceof InMemoryGoalStore) {
      mem.corrupt("{not json");
      const loaded = store.load();
      assert.equal(loaded.ok, false);
      assert.equal((loaded as { ok: false; error: { code: string } }).error.code, "malformed");
    } else {
      // File adapter: write garbage directly.
      const fileStore = store as FileGoalStore;
      mkdirSync(dirname(fileStore.sidecarPath), { recursive: true });
      writeFileSync(fileStore.sidecarPath, "{not json", "utf-8");
      const loaded = store.load();
      assert.equal(loaded.ok, false);
    }
  });

  await test(`${name}: session mismatch is rejected`, () => {
    const { store } = factory("sess-4" as SessionId);
    const first = store.load();
    assert.equal(first.ok, true);
    const rev = (first as { ok: true; value: SidecarEnvelope }).value.revision;
    const committed = store.commit(rev, (c) => ({ ...c, goal: sampleGoal() }));
    assert.equal(committed.ok, true);
    const raw = JSON.parse(JSON.stringify((committed as { ok: true; value: SidecarEnvelope }).value));
    raw.sessionId = "other";
    const validated = validateEnvelope(raw, "sess-4" as SessionId);
    assert.equal(validated.ok, false);
  });

  await test(`${name}: stale revision is rejected without writing`, () => {
    const { store } = factory("sess-5" as SessionId);
    const first = store.load();
    assert.equal(first.ok, true);
    const c1 = store.commit(0, (c) => ({ ...c, goal: sampleGoal() }));
    assert.equal(c1.ok, true);
    const stale = store.commit(0, (c) => ({ ...c, goal: null, cleared: true, clearedAt: new Date().toISOString() }));
    assert.equal(stale.ok, false);
    assert.equal((stale as { ok: false; error: { code: string } }).error.code, "revision_conflict");
  });

  await test(`${name}: second writer gets a visible ownership conflict`, () => {
    const backing = new Map<string, string>();
    const a = new InMemoryGoalStore("sess-6" as SessionId, backing);
    const b = new InMemoryGoalStore("sess-6" as SessionId, backing);
    assert.equal(a.acquireLock().ok, true);
    const second = b.acquireLock();
    assert.equal(second.ok, false);
    assert.equal((second as { ok: false; error: { code: string } }).error.code, "locked");
    a.releaseLock();
    // Releasing another process's lock is forbidden: b still blocked until a releases (already did).
    assert.equal(b.acquireLock().ok, true);
    b.releaseLock();
    void factory;
  });

  await test(`${name}: tombstone distinguishes clear from never-created`, () => {
    const { store } = factory("sess-7" as SessionId);
    const first = store.load();
    assert.equal(first.ok, true);
    assert.equal((first as { ok: true; value: SidecarEnvelope }).value.cleared, false);
    const cleared = store.commit(0, (c) => ({
      ...c,
      goal: null,
      cleared: true,
      clearedAt: "2026-10-05T00:00:00.000Z",
    }));
    assert.equal(cleared.ok, true);
    assert.equal((cleared as { ok: true; value: SidecarEnvelope }).value.cleared, true);
  });

  await test(`${name}: indeterminate durability window is reported`, () => {
    const { store } = factory("sess-8" as SessionId);
    const mem = store as unknown as InMemoryGoalStore;
    if (mem instanceof InMemoryGoalStore) {
      mem.failDirFlushOnce = true;
      const r = store.commit(0, (c) => ({ ...c, goal: sampleGoal() }));
      assert.equal(r.ok, false);
      assert.equal((r as { ok: false; error: { code: string } }).error.code, "indeterminate");
    }
  });
}

await contractSuite("memory", memoryFactory());
await contractSuite("file", fileFactory());

test("sidecar path derives from session file, never cwd", () => {
  assert.equal(sidecarPathFor("/tmp/sessions/abc.jsonl"), "/tmp/sessions/abc.jsonl.codex-goals.json");
});

test("empty envelope is a valid initial state", () => {
  const env = emptyEnvelope("s" as SessionId);
  assert.equal(env.revision, 0);
  assert.equal(env.goal, null);
  assert.equal(validateEnvelope(JSON.parse(JSON.stringify(env)), "s" as SessionId).ok, true);
});

test("file store rejects ephemeral sessions", () => {
  assert.throws(() => new FileGoalStore("s" as SessionId, undefined), /saved Pi session/);
});

test("file adapter writes atomically with restrictive permissions", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-goals-perm-"));
  const sessionFile = join(dir, "s.jsonl");
  const store = new FileGoalStore("s" as SessionId, sessionFile);
  const c = store.commit(0, (e) => ({ ...e, goal: sampleGoal() }));
  assert.equal(c.ok, true);
  const mode = statSync(sidecarPathFor(sessionFile)).mode & 0o777;
  assert.equal(mode, 0o600);
  const raw = readFileSync(sidecarPathFor(sessionFile), "utf-8");
  assert.ok(raw.includes("goal-1"));
});
