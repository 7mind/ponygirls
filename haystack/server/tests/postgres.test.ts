// PG leg (Good-Communication): same abstract suites against real PostgreSQL
// plus PG-only exact-semantics tests (races, rollback, restart-stable
// digests, migration locking/failure). Skipped with an explicit marker when
// HAYSTACK_TEST_PG is unset — never silently green.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { ItemService, ConflictFault } from "../src/application/service.js";
import { SearchService } from "../src/application/search.js";
import { ManualClock } from "../src/application/clock.js";
import { defineSearchSuite } from "./suites/search.js";
import { PgItemRepository } from "../src/storage/postgres.js";
import { migrate, ActivityMismatchFault } from "../src/storage/migrate.js";
import { ReplayConflictFault } from "../src/storage/repository.js";
import { operationDigest } from "../src/domain/digest.js";
import { canonicalizeRaw } from "../src/domain/json.js";
import {
  defineRepositoryContractSuite,
  DOC,
  freshRequestId,
  ALICE,
  validatedPut,
} from "./suites/repository.js";
import { defineServiceSuite } from "./suites/service.js";

const CONN = process.env.HAYSTACK_TEST_PG ?? "";
const ACTIVITY = "agent-activity";

let pool: Pool | null = null;

async function wipe(): Promise<void> {
  await pool!.query("TRUNCATE items, item_revisions, item_links, item_search, write_requests");
}

if (!CONN) {
  describe("postgres leg", () => {
    it("SKIPPED: set HAYSTACK_TEST_PG to run the production leg", () => {
      console.log("# SKIP production PG leg: HAYSTACK_TEST_PG unset");
    });
  });
} else {
  const made: PgItemRepository[] = [];
  const makeRepo = () => {
    const repo = new PgItemRepository(CONN);
    made.push(repo);
    return repo;
  };
  const wipeHook = { beforeEach: wipe };
  defineSearchSuite(() => {
    const clock = new ManualClock();
    const repo = makeRepo();
    return { items: new ItemService(repo, clock), search: new SearchService(repo), clock };
  }, "postgres", wipeHook);

  before(async () => {
    pool = new Pool({ connectionString: CONN });
    await migrate(pool, ACTIVITY);
  });
  after(async () => {
    await Promise.all(made.map((repo) => repo.close()));
    await pool!.end();
    pool = null;
  });

  defineRepositoryContractSuite(makeRepo, "postgres", wipeHook);
  defineServiceSuite((clock) => new ItemService(makeRepo(), clock), "postgres", wipeHook);

  describe("postgres exact semantics", () => {
    let repo: PgItemRepository;
    before(async () => {
      repo = new PgItemRepository(CONN);
    });
    after(async () => {
      await repo.close();
    });
    beforeEach(wipe);

    it("racing creates elect exactly one winner with complete projections", async () => {
      const attempts = await Promise.allSettled(
        Array.from({ length: 10 }, () => repo.commit(validatedPut("p", "race", 0, DOC()))),
      );
      const won = attempts.filter((a) => a.status === "fulfilled");
      const lost = attempts.filter((a) => a.status === "rejected");
      assert.equal(won.length, 1);
      assert.ok(lost.every((a) => (a as PromiseRejectedResult).reason?.code === "conflict"));
      const count = await pool!.query(
        "SELECT (SELECT count(*) FROM items WHERE project_id='p' AND item_id='race') AS items, " +
          "(SELECT count(*) FROM item_revisions WHERE project_id='p' AND item_id='race') AS revs, " +
          "(SELECT count(*) FROM write_requests) AS replays",
      );
      assert.deepEqual(
        [count.rows[0]!.items, count.rows[0]!.revs, count.rows[0]!.replays].map(String),
        ["1", "1", "10"],
      );
    });

    it("simultaneous identical request ids converge on one outcome", async () => {
      const id = freshRequestId();
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => repo.commit({ ...validatedPut("p", "same", 0, DOC()), requestId: id })),
      );
      const ok = results.filter((a) => a.status === "fulfilled") as PromiseFulfilledResult<{ revision: number; replayed: boolean }>[];
      assert.equal(ok.length, 8);
      assert.ok(ok.every((a) => a.value.revision === 1));
      assert.equal(ok.filter((a) => !a.value.replayed).length, 1);
      const revs = await pool!.query("SELECT count(*) FROM item_revisions WHERE project_id='p' AND item_id='same'");
      assert.equal(String(revs.rows[0]!.count), "1");
    });

    it("same id with conflicting payloads yields one winner plus replay-conflicts", async () => {
      const id = freshRequestId();
      const variants = ["v1", "v2", "v3", "v4"].map((t) => ({ ...validatedPut("p", "c", 0, DOC(t)), requestId: id }));
      const results = await Promise.allSettled(variants.map((v) => repo.commit(v)));
      const ok = results.filter((a) => a.status === "fulfilled");
      const bad = results.filter((a) => a.status === "rejected");
      assert.equal(ok.length, 1);
      assert.equal(bad.length, 3);
      assert.ok(bad.every((a) => (a as PromiseRejectedResult).reason instanceof ReplayConflictFault));
    });

    it("racing updates keep history gap-free", async () => {
      await repo.commit(validatedPut("p", "u", 0, DOC("v0")));
      const updates = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) => repo.commit(validatedPut("p", "u", 1, DOC(`v${i + 1}`)))),
      );
      assert.equal(updates.filter((a) => a.status === "fulfilled").length, 1);
      const revs = await pool!.query(
        "SELECT revision FROM item_revisions WHERE project_id='p' AND item_id='u' ORDER BY revision",
      );
      assert.deepEqual(
        revs.rows.map((r: { revision: number }) => r.revision),
        [1, 2],
      );
    });

    it("digest vectors are stable across restarts (upgrade-stable replay)", async () => {
      const canon = canonicalizeRaw(DOC("v1"));
      const d1 = operationDigest("p:u", 0, canon);
      await repo.close();
      const repo2 = new PgItemRepository(CONN);
      try {
        const d2 = operationDigest("p:u", 0, canon);
        assert.equal(d1, d2);
        const id = freshRequestId();
        const first = await repo2.commit({ ...validatedPut("p", "persist", 0, DOC("v1")), requestId: id });
        const replay = await repo2.commit({ ...validatedPut("p", "persist", 0, DOC("v1")), requestId: id });
        assert.equal(replay.revision, first.revision);
        assert.equal(replay.replayed, true);
      } finally {
        await repo2.close();
      }
    });

    it("rejects a mismatched activity namespace at startup", async () => {
      const other = new Pool({ connectionString: CONN });
      try {
        await assert.rejects(migrate(other, "other-namespace"), ActivityMismatchFault);
      } finally {
        await other.end();
      }
    });
  });

  describe("postgres migrations", () => {
    it("concurrent migrate() calls converge; bad migration fails cleanly", async () => {
      const a = new Pool({ connectionString: CONN });
      const b = new Pool({ connectionString: CONN });
      try {
        await Promise.all([migrate(a, ACTIVITY), migrate(b, ACTIVITY)]);
        const count = await a.query("SELECT count(*) FROM schema_migrations WHERE version = '0001-initial'");
        assert.equal(String(count.rows[0]!.count), "1");
      } finally {
        await a.end();
        await b.end();
      }
      const c = new Pool({ connectionString: CONN });
      const fs = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "haystack-badmig-"));
      await fs.writeFile(path.join(dir, "0002-bad.sql"), "CREATE TABLE nope (oops identifier);");
      try {
        await assert.rejects(migrate(c, ACTIVITY, dir), /migration-failed|0002-bad/);
        const missing = await c.query("SELECT count(*) FROM schema_migrations WHERE version = '0002-bad'");
        assert.equal(String(missing.rows[0]!.count), "0");
      } finally {
        await c.end();
      }
    });
  });

  void ConflictFault;
}
