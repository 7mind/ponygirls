// Dual-tests abstract search suite (BG, blackbox). Same scenarios against
// the dummy and PG legs: precedence, Unicode, missing/null, link scoping,
// phrase boundaries, malformed input, archive default/explicit, keyset paging,
// cursor binding, injection safety, completion.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ItemService } from "../../src/application/service.js";
import { SearchService, InvalidCursor, type SearchInput } from "../../src/application/search.js";
import { ManualClock } from "../../src/application/clock.js";
import { BadEnvelope } from "../../src/domain/json.js";
import { encodeKey } from "../../src/domain/qid.js";
import { InvalidQuery } from "../../src/query/ast.js";
import type { SearchSort, SearchSortField } from "../../src/storage/search.js";
import { freshRequestId, ALICE } from "./repository.js";

export interface SearchContext {
  readonly items: ItemService;
  readonly search: SearchService;
  readonly clock: ManualClock;
}

const doc = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "t",
    description: "d",
    fields: {},
    type: "fact",
    status: "actual",
    importance: "low",
    "human-attention": "cleared",
    links: [],
    ...overrides,
  });

async function fixture(ctx: SearchContext): Promise<void> {
  const put = (key: string, body: string, rev = 0) =>
    ctx.items.put({ key, documentJson: body, expectedRevision: rev, requestId: freshRequestId() }, ALICE);
  await put(
    "projA:note1",
    doc({
      title: "MCP auth pattern",
      type: "fact",
      importance: "high",
      "human-attention": "required",
      fields: { count: 5, tags: ["repeated", "pattern"], gh: { state: "open" } },
      links: [["motivated-by", "projB:fact1"]],
      tags: ["mcp", "urgent"],
    }),
  );
  await put("projA:note2", doc({ title: "Unrelated todo", type: "todo", fields: { count: 2 } }));
  await put("projA:old1", doc({ title: "Archived memory", status: "archived", tags: ["mcp"] }));
  await put(
    "projB:fact1",
    doc({
      title: "fact mcp auth",
      fields: { observations: { count: 3 } },
      links: [["see-also", "projA:note1"]],
      tags: ["mcp"],
    }),
  );
  // NOTE: big-int fixture is raw JSON text — a JS number literal would round
  // before serialization and test the wrong value on both legs.
  await put(
    "projB:uni",
    '{"title":"caf\u00e9 notes","description":"d","fields":{"n":9007199254740993},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[],"tags":["Machine Learning"]}',
  );
  await put("projA:self", doc({ title: "self reference", links: [["rel", "projA:self"]] }));
  await put("projA:dangle", doc({ title: "dangling pointer", links: [["rel", "ghost:nowhere"]] }));
  await put("projA:same", doc({ title: "same in A" }));
  await put("projB:same", doc({ title: "same in B", type: "todo" }));
  ctx.clock.advance(60_000);
  await put("projA:fresh", doc({ title: "fresh item" }));
}

const keys = (items: Array<{ project: string; item: string }>) =>
  items.map((i) => `${i.project}:${i.item}`).sort();

export function defineSearchSuite(
  make: () => SearchContext,
  label: string,
  hooks?: { beforeEach?: () => Promise<void> },
): void {
  describe(`search contract [${label}]`, () => {
    let ctx: SearchContext;
    if (hooks?.beforeEach) beforeEach(hooks.beforeEach);
    beforeEach(async () => {
      ctx = make();
      await fixture(ctx);
    });

    it("empty query browses non-archived items in key order", async () => {
      const page = await ctx.search.search({ query: "   ", limit: 100 });
      assert.deepEqual(keys(page.items), [
        "projA:dangle",
        "projA:fresh",
        "projA:note1",
        "projA:note2",
        "projA:same",
        "projA:self",
        "projB:fact1",
        "projB:same",
        "projB:uni",
      ]);
      assert.equal(page.cursor, undefined);
    });

    it("applies Boolean precedence over text", async () => {
      assert.deepEqual(keys((await ctx.search.search({ query: "mcp auth", limit: 100 })).items), [
        "projA:note1",
        "projB:fact1",
      ]);
      assert.deepEqual(
        keys((await ctx.search.search({ query: "mcp todo", limit: 100 })).items),
        [],
      );
      // NOTE: bare `todo` is text search, not the type predicate.
      assert.deepEqual(
        keys((await ctx.search.search({ query: "mcp OR todo", limit: 100 })).items).sort(),
        ["projA:note1", "projA:note2", "projB:fact1"].sort(),
      );
      assert.deepEqual(keys((await ctx.search.search({ query: "mcp NOT auth", limit: 100 })).items), []);
    });

    it("respects phrase segment boundaries", async () => {
      // Title segment matches; tags live in separate array-element segments.
      assert.deepEqual(keys((await ctx.search.search({ query: '"auth pattern"', limit: 100 })).items), [
        "projA:note1",
      ]);
      assert.deepEqual(keys((await ctx.search.search({ query: '"repeated pattern"', limit: 100 })).items), []);
      assert.deepEqual(keys((await ctx.search.search({ query: "repeated pattern", limit: 100 })).items), [
        "projA:note1",
      ]);
    });

    it("matches Unicode; punctuation-only is a diagnostic", async () => {
      assert.deepEqual(keys((await ctx.search.search({ query: "café", limit: 100 })).items), ["projB:uni"]);
      await assert.rejects(ctx.search.search({ query: '"🐎"', limit: 100 }), InvalidQuery);
      await assert.rejects(ctx.search.search({ query: "!!!", limit: 100 }), InvalidQuery);
    });

    it("distinguishes missing from null in JSON predicates", async () => {
      assert.deepEqual(keys((await ctx.search.search({ query: 'field["/gh/state"] = "open"', limit: 100 })).items), [
        "projA:note1",
      ]);
      assert.deepEqual(keys((await ctx.search.search({ query: 'field["/nope"] = "x"', limit: 100 })).items), []);
      assert.deepEqual(keys((await ctx.search.search({ query: 'field["/nope"] != "x"', limit: 100 })).items), []);
      const all = keys((await ctx.search.search({ query: 'NOT exists["/nope"]', limit: 100 })).items);
      assert.ok(all.includes("projA:note1"));
      assert.deepEqual(keys((await ctx.search.search({ query: 'field["/tags/0"] = "repeated"', limit: 100 })).items), [
        "projA:note1",
      ]);
      // Negative and padded array indexes never select (RFC6901 differences).
      assert.deepEqual(keys((await ctx.search.search({ query: 'field["/tags/-1"] = "pattern"', limit: 100 })).items), []);
      assert.deepEqual(keys((await ctx.search.search({ query: 'field["/tags/00"] = "repeated"', limit: 100 })).items), []);
    });

    it("compares numbers losslessly without type coercion", async () => {
      assert.deepEqual(keys((await ctx.search.search({ query: 'field["/count"] >= 3', limit: 100 })).items), [
        "projA:note1",
      ]);
      assert.deepEqual(keys((await ctx.search.search({ query: 'field["/count"] = 5', limit: 100 })).items), [
        "projA:note1",
      ]);
      assert.deepEqual(
        keys((await ctx.search.search({ query: 'field["/n"] = 9007199254740993', limit: 100 })).items),
        ["projB:uni"],
      );
      assert.deepEqual(keys((await ctx.search.search({ query: 'field["/count"] = "5"', limit: 100 })).items), []);
      assert.deepEqual(
        keys((await ctx.search.search({ query: 'field["/observations/count"] >= 3', limit: 100 })).items),
        ["projB:fact1"],
      );
    });

    it("matches exact link tuples without cross-link correlation", async () => {
      assert.deepEqual(
        keys((await ctx.search.search({ query: 'link:["motivated-by","projB:fact1"]', limit: 100 })).items),
        ["projA:note1"],
      );
      assert.deepEqual(keys((await ctx.search.search({ query: 'linked-to:"projA:note1"', limit: 100 })).items), [
        "projB:fact1",
      ]);
      assert.deepEqual(keys((await ctx.search.search({ query: 'linked-from:"projB:fact1"', limit: 100 })).items), [
        "projA:note1",
      ]);
      // A type predicate and a target predicate on different links must not
      // jointly match: no todo links to projB:fact1.
      assert.deepEqual(
        keys((await ctx.search.search({ query: 'type:todo linked-to:"projB:fact1"', limit: 100 })).items),
        [],
      );
      // Self-links and dangling targets resolve literally.
      assert.deepEqual(keys((await ctx.search.search({ query: 'link:["rel","projA:self"]', limit: 100 })).items), [
        "projA:self",
      ]);
      assert.deepEqual(keys((await ctx.search.search({ query: 'linked-to:"ghost:nowhere"', limit: 100 })).items), [
        "projA:dangle",
      ]);
    });

    it("matches exact tags case-sensitively with tag:/tags: aliases", async () => {
      assert.deepEqual(keys((await ctx.search.search({ query: "tag:mcp", limit: 100 })).items), [
        "projA:note1",
        "projB:fact1",
      ]);
      assert.deepEqual(keys((await ctx.search.search({ query: "tags:mcp", limit: 100 })).items), [
        "projA:note1",
        "projB:fact1",
      ]);
      // Predicate name is case-insensitive; value is exact case-sensitive.
      assert.deepEqual(keys((await ctx.search.search({ query: "TAG:mcp", limit: 100 })).items), [
        "projA:note1",
        "projB:fact1",
      ]);
      assert.deepEqual(keys((await ctx.search.search({ query: "TAG:MCP", limit: 100 })).items), []);
      assert.deepEqual(keys((await ctx.search.search({ query: 'tag:"Machine Learning"', limit: 100 })).items), [
        "projB:uni",
      ]);
      assert.deepEqual(
        keys((await ctx.search.search({ query: "tag:mcp tag:urgent", limit: 100 })).items),
        ["projA:note1"],
      );
      // Archived items stay hidden unless explicitly selected.
      assert.deepEqual(keys((await ctx.search.search({ query: "tag:mcp", limit: 100 })).items).includes("projA:old1"), false);
      assert.deepEqual(
        keys((await ctx.search.search({ query: "archived:all tag:mcp", limit: 100 })).items).sort(),
        ["projA:note1", "projA:old1", "projB:fact1"].sort(),
      );
      // NOT includes untagged items (missing tags are FALSE, not NULL).
      const notMcp = keys((await ctx.search.search({ query: "NOT tag:mcp", limit: 100 })).items);
      assert.ok(notMcp.includes("projA:note2"));
      assert.ok(!notMcp.includes("projA:note1"));
      assert.ok(!notMcp.includes("projB:fact1"));
      // Tags are text-indexed as their own segments.
      assert.deepEqual(keys((await ctx.search.search({ query: "urgent", limit: 100 })).items), ["projA:note1"]);
      assert.deepEqual(keys((await ctx.search.search({ query: "machine", limit: 100 })).items), ["projB:uni"]);
      // Malformed tag values are diagnostics, never text fallback.
      await assert.rejects(ctx.search.search({ query: "tag:", limit: 100 }), InvalidQuery);
      await assert.rejects(ctx.search.search({ query: 'tag:""', limit: 100 }), InvalidQuery);
    });

    it("intersects explicit scope with predicates; targets ignore scope", async () => {
      assert.deepEqual(
        keys((await ctx.search.search({ query: "project:projB", limit: 100 })).items).sort(),
        ["projB:fact1", "projB:same", "projB:uni"].sort(),
      );
      // Scope restricts candidates, not permitted link targets.
      assert.deepEqual(
        keys(
          (await ctx.search.search({ query: 'link:["motivated-by","projB:fact1"]', project: "projA", limit: 100 }))
            .items,
        ),
        ["projA:note1"],
      );
      assert.deepEqual(
        keys((await ctx.search.search({ query: 'link:["motivated-by","projB:fact1"]', project: "projB", limit: 100 })).items),
        [],
      );
    });

    it("hides archived by default; explicit selectors compose", async () => {
      assert.deepEqual(keys((await ctx.search.search({ query: "memory", limit: 100 })).items), []);
      assert.deepEqual(keys((await ctx.search.search({ query: "status:archived", limit: 100 })).items), [
        "projA:old1",
      ]);
      assert.deepEqual(keys((await ctx.search.search({ query: "archived:all memory", limit: 100 })).items), [
        "projA:old1",
      ]);
      assert.deepEqual(keys((await ctx.search.search({ query: "archived:false memory", limit: 100 })).items), []);
      // Explicit selector under OR disables the implicit filter (CQ treatment).
      assert.deepEqual(
        keys((await ctx.search.search({ query: "type:todo OR status:archived", limit: 100 })).items).sort(),
        ["projA:note2", "projA:old1", "projB:same"].sort(),
      );
    });

    it("compares timestamps", async () => {
      // fresh was written 60s after the rest.
      assert.deepEqual(keys((await ctx.search.search({ query: 'modified-at >= "2026-10-07T18:01:00Z"', limit: 100 })).items), [
        "projA:fresh",
      ]);
      // All non-archived items except fresh (8): old1 is archive-filtered.
      assert.deepEqual(
        keys((await ctx.search.search({ query: 'modified-at < "2026-10-07T18:01:00Z"', limit: 100 })).items).length,
        8,
      );
    });

    it("resolves exact ids; bare ids are diagnostics", async () => {
      assert.deepEqual(keys((await ctx.search.search({ query: 'id:"projA:same"', limit: 100 })).items), ["projA:same"]);
      await assert.rejects(ctx.search.search({ query: "projA:same", limit: 100 }), InvalidQuery);
    });

    it("pages live keysets without duplication or loss", async () => {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = await ctx.search.search({ query: "", limit: 2, cursor });
        seen.push(...keys(page.items));
        cursor = page.cursor;
        if (cursor === undefined) break;
      }
      assert.equal(cursor, undefined);
      assert.deepEqual([...seen].sort(), [
        "projA:dangle",
        "projA:fresh",
        "projA:note1",
        "projA:note2",
        "projA:same",
        "projA:self",
        "projB:fact1",
        "projB:same",
        "projB:uni",
      ]);
      assert.equal(new Set(seen).size, seen.length);
    });

    // Specified: order the complete eligible set, not each loaded page.
    describe("full-result sorting", () => {
      type SortField = SearchSortField;
      type Sort = SearchSort;
      const ordered = (items: Array<{ project: string; item: string }>) => items.map((item) => `${item.project}:${item.item}`);
      const a = "sortA:a", b = "sortA:b", c = "sortA:\uE000", d = "sortA:😀", e = "sortB:a", f = "sortB:b";
      const groups: Record<SortField, string[][]> = {
        key: [[a], [b], [c], [d], [e], [f]],
        title: [[b], [a, c, f], [d], [e]],
        project: [[a, b, c, d], [e, f]],
        type: [[b, c, f], [d, e], [a]],
        status: [[a, c, e], [f], [b, d]],
        importance: [[e], [c], [b, f], [d], [a]],
        "human-attention": [[b, d, f], [a, c, e]],
        "modified-at": [[a, d, f], [c], [b, e]],
        revision: [[a, f], [b, e], [d], [c]],
      };
      const search = (input: SearchInput) => ctx.search.search(input);
      const put = (key: string, overrides: Record<string, unknown>, revision: number) => {
        const colon = key.indexOf(":");
        return ctx.items.put({
          key: encodeKey({ project: key.slice(0, colon), item: key.slice(colon + 1) }),
          documentJson: doc({ tags: ["sorting"], ...overrides }),
          expectedRevision: revision,
          requestId: freshRequestId(),
        }, ALICE);
      };
      beforeEach(async () => {
        const rows = [
          { key: a, title: "same", type: "zeta", status: "actual", importance: "urgent", attention: "required", revision: 1, seconds: 1 },
          { key: b, title: "Z", type: "alpha", status: "waiting", importance: "low", attention: "cleared", revision: 2, seconds: 3 },
          { key: c, title: "same", type: "alpha", status: "actual", importance: "high", attention: "required", revision: 10, seconds: 2 },
          { key: d, title: "\uE000", type: "beta", status: "waiting", importance: "medium", attention: "cleared", revision: 3, seconds: 1 },
          { key: e, title: "😀", type: "beta", status: "actual", importance: "critical", attention: "required", revision: 2, seconds: 3 },
          { key: f, title: "same", type: "alpha", status: "archived", importance: "low", attention: "cleared", revision: 1, seconds: 1 },
        ];
        for (const row of rows) {
          ctx.clock.set(`2026-10-07T19:00:0${row.seconds}.000Z`);
          for (let revision = 0; revision < row.revision; revision++) {
            await put(row.key, { title: row.title, type: row.type, status: row.status, importance: row.importance, "human-attention": row.attention }, revision);
          }
        }
      });
      for (const field of Object.keys(groups) as SortField[]) {
        for (const direction of ["asc", "desc"] as const) {
          it(`globally sorts ${field} ${direction}, including ties across pages`, async () => {
            const expectedGroups = direction === "asc" ? groups[field] : [...groups[field]].reverse();
            const expected = expectedGroups.flat();
            const seen: string[] = [];
            let cursor: string | undefined;
            for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
              const page = await search({ query: "archived:all tag:sorting", limit: 2, cursor, sort: { field, direction } });
              seen.push(...ordered(page.items));
              cursor = page.cursor;
              if (cursor === undefined) break;
            }
            assert.equal(cursor, undefined);
            assert.deepEqual(seen, expected);
            assert.equal(new Set(seen).size, seen.length);
          });
        }
      }
      it("intersects project, archive, and text filters before sorting", async () => {
        for (const direction of ["asc", "desc"] as const) {
          const page = await search({ query: "tag:sorting same", project: "sortA", limit: 1, sort: { field: "title", direction } });
          assert.deepEqual(ordered(page.items), [a]);
          assert.ok(page.cursor);
          const next = await search({ query: "tag:sorting same", project: "sortA", limit: 1, cursor: page.cursor, sort: { field: "title", direction } });
          assert.deepEqual(ordered(next.items), [c]);
          assert.equal(next.cursor, undefined);
        }
        assert.deepEqual(ordered((await search({ query: "tag:sorting same", sort: { field: "key", direction: "desc" } })).items), [c, a]);
        assert.deepEqual(ordered((await search({ query: "archived:all tag:sorting same", sort: { field: "key", direction: "desc" } })).items), [f, c, a]);
      });
      it("binds cursors to query, scope, limit, sort field, and direction", async () => {
        const input = { query: "archived:all tag:sorting", limit: 1, sort: { field: "title", direction: "asc" } as Sort };
        const { cursor } = await search(input);
        assert.ok(cursor);
        for (const changed of [
          { ...input, query: "tag:sorting" }, { ...input, project: "sortA" }, { ...input, limit: 2 },
          { ...input, sort: { field: "importance", direction: "asc" } as Sort },
          { ...input, sort: { field: "title", direction: "desc" } as Sort },
          { query: input.query, limit: 1 },
        ]) await assert.rejects(search({ ...changed, cursor }), InvalidCursor);
        const defaultPage = await search({ query: input.query, limit: 1 });
        assert.ok(defaultPage.cursor);
        assert.deepEqual(ordered((await search({ query: input.query, limit: 1, cursor: defaultPage.cursor, sort: { field: "key", direction: "asc" } })).items), [b]);
      });
      it("keeps the saved boundary when a row moves or leaves the live result", async () => {
        const input = { query: "tag:sorting same", limit: 1, sort: { field: "title", direction: "asc" } as Sort };
        const first = await search(input);
        assert.deepEqual(ordered(first.items), [a]);
        assert.ok(first.cursor);
        await put(a, { title: "same z" }, 1);
        const second = await search({ ...input, cursor: first.cursor });
        assert.deepEqual(ordered(second.items), [c]);
        assert.ok(second.cursor);
        const third = await search({ ...input, cursor: second.cursor });
        assert.deepEqual(ordered(third.items), [a]); // live views can repeat a moved row
        assert.equal(third.cursor, undefined);
        await put(a, { title: "same z", status: "archived" }, 2);
        assert.deepEqual(ordered((await search({ ...input, cursor: first.cursor })).items), [c]);
      });
      it("rejects invalid untrusted sort inputs rather than defaulting", async () => {
        for (const sort of [null, "title", [], {}, { field: "title" }, { direction: "asc" },
          { field: "title", direction: "ASC" }, { field: "title; DROP TABLE items; --", direction: "asc" },
          { field: "constructor", direction: "asc" }, { field: "title", direction: "asc", extra: true }]) {
          await assert.rejects(ctx.search.search(Object.assign({ query: "" }, { sort }) as unknown as SearchInput), BadEnvelope);
        }
      });
      it("rejects malformed cursor encodings, positions, and sort values", async () => {
        for (const field of ["key", "title", "revision", "modified-at"] as const) {
          const input = { query: "archived:all tag:sorting", limit: 1, sort: { field, direction: "asc" } as Sort };
          const page = await search(input);
          assert.ok(page.cursor);
          for (const cursor of [null, 42, {}, page.cursor + "=", page.cursor + "\n", "a".repeat(20_000)]) {
            await assert.rejects(ctx.search.search(Object.assign({}, input, { cursor }) as unknown as SearchInput), InvalidCursor);
          }
          const parsed = JSON.parse(Buffer.from(page.cursor, "base64url").toString()) as { last: Record<string, unknown> };
          if (field === "modified-at") {
            for (const value of ["0000-01-01T00:00:00.000Z", "-000001-01-01T00:00:00.000Z", "+010000-01-01T00:00:00.000Z"]) {
              const cursor = Buffer.from(JSON.stringify({ ...parsed, last: { ...parsed.last, value } })).toString("base64url");
              await assert.rejects(search({ ...input, cursor }), InvalidCursor);
            }
          }
          for (const last of [null, [], { ...parsed.last, project: "" }, { ...parsed.last, item: "\0" },
            { ...parsed.last, project: "a".repeat(257) }, { ...parsed.last, item: "\uD800" },
            { ...parsed.last, value: null }, { ...parsed.last, value: {} },
            { ...parsed.last, value: field === "revision" ? "1" : 1 },
            { ...parsed.last, value: field === "modified-at" ? "2026-02-30T00:00:00.000Z" : -1 },
          ]) {
            const cursor = Buffer.from(JSON.stringify({ ...parsed, last })).toString("base64url");
            await assert.rejects(search({ ...input, cursor }), InvalidCursor);
          }
        }
      });
    });

    it("rejects malformed and foreign cursors", async () => {
      await assert.rejects(ctx.search.search({ query: "", limit: 2, cursor: "nope" }), InvalidCursor);
      const foreign = await ctx.search.search({ query: "mcp", limit: 2 });
      if (foreign.cursor !== undefined) {
        await assert.rejects(ctx.search.search({ query: "todo", limit: 2, cursor: foreign.cursor }), InvalidCursor);
      }
    });

    it("treats injection inputs as data, never structure", async () => {
      for (const q of [
        "type:todo OR 1=1",
        "\" OR TRUE --",
        "type:fact; DROP TABLE items; --",
        "archived:all OR archived:all",
      ]) {
        let items: string[];
        try {
          items = keys((await ctx.search.search({ query: q, limit: 100 })).items);
        } catch (err) {
          assert.ok(err instanceof InvalidQuery);
          continue;
        }
        // Never the full corpus via smuggling; archived stays hidden unless
        // the query explicitly selects it through the real grammar.
        if (q === "archived:all OR archived:all") {
          assert.ok(items.includes("projA:old1"));
        } else {
          assert.ok(!items.includes("projA:old1"));
        }
      }
      // And the tables still exist afterwards.
      assert.ok((await ctx.search.search({ query: "", limit: 100 })).items.length > 0);
    });

    it("emits canonical encoded ids for special-char projects", async () => {
      await ctx.items.put(
        {
          key: "plain:key",
          documentJson: '{"title":"t","description":"d","fields":{},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[]}',
          expectedRevision: 0,
          requestId: freshRequestId(),
        },
        ALICE,
      );
      // Project `a:b` encodes to `a%3Ab`; raw interpolation would mint
      // `a:b:key`, which decodes to the wrong key.
      await ctx.items.put(
        {
          key: "a%3Ab:key",
          documentJson: '{"title":"t","description":"d","fields":{},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[]}',
          expectedRevision: 0,
          requestId: freshRequestId(),
        },
        ALICE,
      );
      const ids = await ctx.search.complete("key");
      assert.ok(ids.includes('id:"a%3Ab:key"'), JSON.stringify(ids));
      assert.ok(!ids.some((s) => s.includes("a:b:key") && !s.includes("%3A")), JSON.stringify(ids));
    });
    it("completes built-ins, observed values, and ids", async () => {
      const builtins = await ctx.search.complete("typ");
      assert.ok(builtins.includes("type:"));
      const values = await ctx.search.complete("type:");
      assert.ok(values.some((v) => v.startsWith("type:")));
      const ids = await ctx.search.complete("projA:no");
      assert.ok(ids.includes('id:"projA:note1"'));
      const analysis = ctx.search.analyze("bogus:1");
      assert.ok(analysis.diagnostics.length > 0);
      assert.deepEqual(ctx.search.analyze("type:todo").diagnostics, []);
    });

    it("completes tag built-ins and observed tag values", async () => {
      const builtins = await ctx.search.complete("ta");
      assert.ok(builtins.includes("tag:"));
      assert.ok(builtins.includes("tags:"));
      const tags = await ctx.search.complete("tag:m");
      assert.ok(tags.includes("tag:mcp"), JSON.stringify(tags));
      const quoted = await ctx.search.complete("tag:");
      assert.ok(quoted.some((s) => s.includes("Machine Learning")), JSON.stringify(quoted));
      assert.deepEqual(ctx.search.analyze("tag:mcp").diagnostics, []);
      assert.ok(ctx.search.analyze("tag:").diagnostics.length > 0);
    });
  });
}

