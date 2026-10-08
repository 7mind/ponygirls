import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ItemService } from "../../src/application/service.js";
import { ManualClock } from "../../src/application/clock.js";
import { InMemoryItemRepository } from "../../src/storage/memory.js";
import type { Principal } from "../../src/domain/document.js";
import { DOC, freshRequestId, ALICE, BOT } from "./repository.js";

const docWith = (fields: string, overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "t",
    description: "d",
    fields: JSON.parse(fields) as unknown,
    type: "fact",
    status: "actual",
    importance: "low",
    "human-attention": "cleared",
    links: [],
    ...overrides,
  });

export const put = (key: string, documentJson: string, expectedRevision: number, requestId = freshRequestId()) => ({
  key,
  documentJson,
  expectedRevision,
  requestId,
});

function setup() {
  const clock = new ManualClock();
  const service = new ItemService(new InMemoryItemRepository(), clock);
  return { service, clock };
}

export function defineServiceSuite(
  makeService: (clock: ManualClock) => ItemService,
  label: string,
  hooks?: { beforeEach?: () => Promise<void> },
): void {
  describe(`service scenarios [${label}]`, () => {
    if (hooks?.beforeEach) beforeEach(hooks.beforeEach);
    it("round-trips documents with big-int fields exactly", async () => {
      const service = makeService(new ManualClock());
      const raw = `{"title":"t","description":"d","fields":{"n":9007199254740993,"d":0.1},"type":"fact","status":"actual","importance":"high","human-attention":"required","links":[["motivated-by","shared-knowledge:fact-mcp-auth"]]}`;
      const out = await service.put(put("p:big", raw, 0), ALICE);
      assert.equal(out.revision, 1);
      const got = await service.get("p:big");
      assert.ok(got.documentCanonical.includes("9007199254740993"));
    });

    it("stamps authorship from the principal across writers", async () => {
      const clock = new ManualClock();
      const service = makeService(clock);
      clock.set("2026-10-07T18:00:00.000Z");
      await service.put(put("p:a", DOC(), 0), ALICE);
      clock.set("2026-10-07T19:00:00.000Z");
      await service.put(put("p:a", DOC("v2"), 1), BOT);
      const got = await service.get("p:a");
      assert.equal(got.metadata.createdBy, "alice");
      assert.equal(got.metadata.modifiedBy, "bot");
      const hist = await service.history("p:a");
      assert.deepEqual(hist.map((h) => h.modifiedBy), ["bot", "alice"]);
    });

    it("replays identical successful puts without new revisions", async () => {
      const service = makeService(new ManualClock());
      const id = freshRequestId();
      const first = await service.put(put("p:a", DOC(), 0, id), ALICE);
      const second = await service.put(put("p:a", DOC(), 0, id), ALICE);
      assert.equal(second.revision, first.revision);
      assert.equal(second.replayed, true);
    });

    it("round-trips tags and rejects malformed tag sets", async () => {
      const service = makeService(new ManualClock());
      const raw = JSON.stringify({
        title: "t",
        description: "d",
        fields: {},
        type: "fact",
        status: "actual",
        importance: "low",
        "human-attention": "cleared",
        links: [],
        tags: ["mcp", "Machine Learning"],
      });
      await service.put(put("p:tagged", raw, 0), ALICE);
      const got = await service.get("p:tagged");
      assert.deepEqual([...got.document.tags], ["mcp", "Machine Learning"]);
      // Missing tags default to [].
      await service.put(put("p:untagged", DOC(), 0), ALICE);
      assert.deepEqual([...(await service.get("p:untagged")).document.tags], []);
      // Malformed: empty, whitespace-padded, too long, non-array.
      for (const tags of [[""], [[" x"]], [["x "]], ["x".repeat(129)], "mcp", [42]]) {
        const bad = JSON.stringify({
          title: "t",
          description: "d",
          fields: {},
          type: "fact",
          status: "actual",
          importance: "low",
          "human-attention": "cleared",
          links: [],
          tags,
        });
        await assert.rejects(service.put(put(`p:bad-${Math.random()}`, bad, 0), ALICE));
      }
    });
  });
}

