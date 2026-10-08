// Dual-tests abstract repository contract suite (BA, blackbox).
// Thin legs (tests/repository.test.ts, tests/postgres.test.ts) invoke
// defineRepositoryContractSuite with their own repository factories.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeRaw } from "../../src/domain/json.js";
import { operationDigest } from "../../src/domain/digest.js";
import type { Principal } from "../../src/domain/document.js";
import {
  ConflictFault,
  NotFoundFault,
  ReplayConflictFault,
  type ItemRepository,
  type ValidatedPut,
} from "../../src/storage/repository.js";

export const ALICE: Principal = { userId: "alice", type: "human", tokenId: "t1" };
export const BOT: Principal = { userId: "bot", type: "agent", tokenId: "t2" };

let reqCounter = 0;
export function freshRequestId(): string {
  reqCounter += 1;
  // Full 12-hex-digit suffix so ids stay valid UUIDv7 at any count.
  return `0193e8d5-6f5c-7a1b-8c2d-${String(reqCounter).padStart(12, "0")}`;
}

export function validatedPut(
  project: string,
  item: string,
  expectedRevision: number,
  documentJson: string,
  principal: Principal = ALICE,
  requestId: string = freshRequestId(),
  now = "2026-10-07T18:00:00.000Z",
): ValidatedPut {
  const qualifiedKey = `${project}:${item}`;
  const documentCanonical = canonicalizeRaw(documentJson);
  return {
    key: { project, item },
    qualifiedKey,
    expectedRevision,
    document: JSON.parse(documentCanonical) as never,
    documentCanonical,
    digest: operationDigest(qualifiedKey, expectedRevision, documentCanonical),
    principal,
    requestId,
    now,
  };
}

export const DOC = (title = "t") =>
  JSON.stringify({
    title,
    description: "d",
    fields: {},
    type: "fact",
    status: "actual",
    importance: "low",
    "human-attention": "cleared",
    links: [],
  });


export function defineRepositoryContractSuite(
  makeRepo: () => ItemRepository,
  label: string,
  hooks?: { beforeEach?: () => Promise<void> },
): void {
  describe(`repository contract [${label}]`, () => {
    if (hooks?.beforeEach) beforeEach(hooks.beforeEach);
    it("creates and reads back revision 1 with stamped metadata", async () => {
      const repo = makeRepo();
      const put = validatedPut("p", "a", 0, DOC());
      const out = await repo.commit(put);
      assert.equal(out.revision, 1);
      assert.equal(out.replayed, false);
      assert.equal(out.metadata.createdBy, "alice");
      assert.equal(out.metadata.modifiedBy, "alice");
      const got = await repo.getCurrent("p", "a");
      assert.equal(got?.revision, 1);
      assert.equal(got?.document.title, "t");
    });

    it("returns null/empty for absent items", async () => {
      const repo = makeRepo();
      assert.equal(await repo.getCurrent("p", "nope"), null);
      assert.equal(await repo.getRevision("p", "nope", 1), null);
      assert.deepEqual(await repo.listRevisions("p", "nope"), []);
    });

    it("CAS-updates, keeps creation metadata, snapshots history", async () => {
      const repo = makeRepo();
      await repo.commit(validatedPut("p", "a", 0, DOC("v1"), ALICE, freshRequestId(), "2026-10-07T18:00:00.000Z"));
      const out = await repo.commit(validatedPut("p", "a", 1, DOC("v2"), BOT, freshRequestId(), "2026-10-07T19:00:00.000Z"));
      assert.equal(out.revision, 2);
      assert.equal(out.metadata.createdBy, "alice");
      assert.equal(out.metadata.modifiedBy, "bot");
      assert.equal(out.metadata.createdAt, "2026-10-07T18:00:00.000Z");
      const hist = await repo.listRevisions("p", "a");
      assert.deepEqual(hist.map((h) => h.revision), [2, 1]);
      assert.equal(hist[1]?.modifiedBy, "alice");
      assert.equal(hist[0]?.tokenId, "t2");
      const snap = await repo.getRevision("p", "a", 1);
      assert.equal(snap?.document.title, "v1");
    });

    it("rejects duplicate create; identical replay returns the conflict", async () => {
      const repo = makeRepo();
      await repo.commit(validatedPut("p", "a", 0, DOC()));
      // Fresh ids: genuine duplicate creates, not retries of the first.
      const dup = validatedPut("p", "a", 0, DOC());
      await assert.rejects(repo.commit(dup), ConflictFault);
      await assert.rejects(repo.commit({ ...dup }), ConflictFault); // terminal replay
    });

    it("rejects wrong-revision update and missing-item update", async () => {
      const repo = makeRepo();
      await repo.commit(validatedPut("p", "a", 0, DOC()));
      const stale = validatedPut("p", "a", 5, DOC("x"));
      await assert.rejects(repo.commit(stale), (e: unknown) => {
        assert.ok(e instanceof ConflictFault && e.currentRevision === 1);
        return true;
      });
      await assert.rejects(repo.commit(validatedPut("p", "ghost", 1, DOC())), NotFoundFault);
    });

    it("identical successful retry returns the same revision without writing", async () => {
      const repo = makeRepo();
      const put = validatedPut("p", "a", 0, DOC());
      const first = await repo.commit(put);
      const second = await repo.commit({ ...put });
      assert.deepEqual(second, { ...first, replayed: true });
      assert.deepEqual((await repo.listRevisions("p", "a")).map((h) => h.revision), [1]);
    });

    it("same request id with a different operation fails", async () => {
      const repo = makeRepo();
      const put = validatedPut("p", "a", 0, DOC("v1"));
      await repo.commit(put);
      const other = validatedPut("p", "a", 0, DOC("v2"), ALICE, put.requestId);
      await assert.rejects(repo.commit(other), ReplayConflictFault);
    });

    it("records terminal invalid-document outcomes replay-safely", async () => {
      const repo = makeRepo();
      const rec = {
        principal: ALICE,
        requestId: freshRequestId(),
        digest: "d".repeat(64),
        kind: "invalid-document" as const,
        detail: "bad title",
        now: "2026-10-07T18:00:00.000Z",
      };
      await repo.recordTerminal(rec);
      await repo.recordTerminal({ ...rec }); // identical: fine
      await assert.rejects(repo.recordTerminal({ ...rec, digest: "e".repeat(64) }), ReplayConflictFault);
    });

    it("isolates colliding bare item ids across projects", async () => {
      const repo = makeRepo();
      await repo.commit(validatedPut("p1", "same", 0, DOC("one")));
      await repo.commit(validatedPut("p2", "same", 0, DOC("two")));
      assert.equal((await repo.getCurrent("p1", "same"))?.document.title, "one");
      assert.equal((await repo.getCurrent("p2", "same"))?.document.title, "two");
    });
  });
}
