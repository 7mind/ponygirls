import { describe, expect, it } from "vitest";
import { rankDocuments } from "../extensions/engine/ranking.js";
import { WEB_DOCUMENT_ADAPTER } from "../extensions/engine/documents.js";
import { PAPER_DOCUMENT_ADAPTER, rankPapers } from "../extensions/papers/ranking.js";
import type { RankedList, RankingPolicy } from "../extensions/engine/types.js";
import type { SearchResult } from "../extensions/types.js";
import type { PaperRecord } from "../extensions/papers/types.js";

const policy: RankingPolicy = { rankConstant: 60, rerank: "rrf", titleWeight: .2, bodyWeight: .1, exactTitle: true };
const web = (title: string, id = title, snippet = ""): SearchResult => ({ title, url: `https://example.test/${id}`, snippet });
const paper = (record: SearchResult): PaperRecord => ({ ...record, ids: [], authors: [], categories: [] });
const list = (source: string, results: SearchResult[], weight = 1, redundantWith: string[] = []): RankedList<SearchResult> => ({ source, results, weight, redundantWith });

// Specified BG: public pure shared-engine + domain-adapter behavior, no network.
describe("shared document ranking", () => {
  it.each(["rrf", "lexical"] as const)("gives web/paper identical weighted %s scores and ordering", rerank => {
    const lists = [list("exa", [web("unrelated"), web("neural signal", "target", "neural signal")], 2), list("arxiv", [web("unrelated")], .1)];
    const selected = { ...policy, rerank, titleWeight: 2, bodyWeight: 1, rankConstant: 9, exactTitle: false };
    const actual = rankDocuments(lists, "neural signal", 10, selected, WEB_DOCUMENT_ADAPTER);
    const papers = rankDocuments(lists.map(l => ({ ...l, results: l.results.map(paper) })), "neural signal", 10, selected, PAPER_DOCUMENT_ADAPTER);
    expect(papers.map(p => p.ranking)).toEqual(actual.map(p => p.ranking));
    expect(papers.map(p => p.document.url)).toEqual(actual.map(p => p.document.url));
    expect(actual[0].document.title).toBe(rerank === "lexical" ? "neural signal" : "unrelated");
    expect(actual.find(p => p.document.title === "neural signal")!.ranking).toMatchObject({ rrfScore: 2 / 11, textBoost: rerank === "lexical" ? 4 : 1 });
  });
  it("retains first encounter ties rather than sorting sources or URLs", () => {
    const result = rankDocuments([list("z", [web("z")]), list("a", [web("a")])], "query", 10, policy, WEB_DOCUMENT_ADAPTER);
    expect(result.map(r => r.document.title)).toEqual(["z", "a"]);
  });
  it("breaks equal scores by actual voting sources, not suppressed provenance", () => {
    const result = rankDocuments([
      list("single", [web("single")], 2),
      list("one", [web("consensus")]), list("two", [web("consensus")]),
      list("extra", [web("single")], 100, ["*"]),
    ], "q", 10, policy, WEB_DOCUMENT_ADAPTER);
    expect(result[0].ranking.score).toBe(result[1].ranking.score);
    expect(result.map(r => r.document.title)).toEqual(["consensus", "single"]);
    expect(result[1].ranking.sources).toHaveLength(2);
  });
  it("duplicate rows enrich metadata without extra votes or depressing subsequent ranks", () => {
    const result = rankDocuments([list("exa", [web("first", "same"), web("richer", "same", "longer body"), web("last")])], "query", 10, policy, WEB_DOCUMENT_ADAPTER);
    expect(result.map(r => r.document.title)).toEqual(["richer", "last"]);
    expect(result.map(r => r.ranking.contributions[0].rank)).toEqual([1, 2]);
  });
  it("rejects duplicate source lists including empty ones", () => {
    expect(() => rankDocuments([list("exa", []), list("exa", [web("a")])], "q", 1, policy, WEB_DOCUMENT_ADAPTER)).toThrow(/Duplicate/);
  });
  it.each([Infinity, -Infinity, NaN])("rejects nonfinite numeric inputs %s", value => {
    expect(() => rankDocuments([list("exa", [web("a")], value)], "q", 1, policy, WEB_DOCUMENT_ADAPTER)).toThrow();
    expect(() => rankDocuments([], "q", value, policy, WEB_DOCUMENT_ADAPTER)).toThrow();
    for (const field of ["rankConstant", "titleWeight", "bodyWeight"] as const) {
      expect(() => rankDocuments([], "q", 1, { ...policy, [field]: value }, WEB_DOCUMENT_ADAPTER)).toThrow();
    }
  });
  it.each([[["exa"]], [["*"]]])("suppresses only configured overlapping votes %j", redundantWith => {
    const result = rankDocuments([list("exa", [web("same")]), list("extra", [web("same"), web("unique")], 4, redundantWith)], "q", 10, policy, WEB_DOCUMENT_ADAPTER);
    expect(result.find(r => r.document.title === "same")!.ranking).toMatchObject({ sources: ["exa", "extra"], rrfScore: 1 / 61, contributions: [{ source: "exa", term: 1 / 61 }, { source: "extra", term: 0 }] });
    expect(result.find(r => r.document.title === "unique")!.ranking.rrfScore).toBe(4 / 62);
  });
  it("keeps unconfigured source votes and nonmatching suppression intact", () => {
    const result = rankDocuments([list("exa", [web("same")]), list("extra", [web("same")], 3, ["absent"])], "q", 10, policy, WEB_DOCUMENT_ADAPTER);
    expect(result[0].ranking.rrfScore).toBe(4 / 61);
  });
  it("unions paper aliases transitively before assigning distinct ranks", () => {
    const a = { ...paper(web("a")), ids: [{ namespace: "doi" as const, value: "10.1234/a" }] };
    const b = { ...paper(web("b")), ids: [{ namespace: "arxiv" as const, value: "2401.01234" }] };
    const bridge = { ...paper(web("bridge")), ids: [...a.ids, ...b.ids] };
    const result = rankPapers([{ source: "exa", results: [a, b, paper(web("third"))], weight: 1, redundantWith: [] }, { source: "arxiv", results: [bridge], weight: 1, redundantWith: [] }], "q", 10, policy);
    expect(result).toHaveLength(2);
    expect(result[0].rrfScore).toBe(2 / 61);
    expect(result[1].contributions[0].rank).toBe(2);
  });
  it("uses anchored web URLs, strips fragments, and preserves path/query/trailing slash distinctions", () => {
    const records = [web("first", "Path?x=A"), web("duplicate", "Path?x=A#fragment"), web("lower", "path?x=A"), web("query", "Path?x=a"), web("slash", "Path/?x=A")];
    const run = (query: string) => rankDocuments([list("exa", records)], query, 10, policy, WEB_DOCUMENT_ADAPTER);
    expect(run("q")).toHaveLength(4);
    expect(run("https://example.test/Path?x=a")[0]).toMatchObject({ document: { title: "query" }, ranking: { exactId: true } });
    expect(run("about https://example.test/Path?x=a").every(r => !r.ranking.exactId)).toBe(true);
    expect(run("doi:10.1234/a").every(r => !r.ranking.exactId)).toBe(true);
  });
  it("shares full-title priority, normalization and no false title identity merges", () => {
    const records = [web("ÉTUDE: Нейрон — ＭＯＤＥＬＳ!", "a"), web("ÉTUDE: Нейрон — ＭＯＤＥＬＳ!", "b")];
    const result = rankDocuments([list("exa", records)], "étude нейрон models", 10, policy, WEB_DOCUMENT_ADAPTER);
    expect(result).toHaveLength(2);
    expect(result.every(r => r.ranking.exactTitle)).toBe(true);
    expect(rankDocuments([list("exa", records)], "models нейрон étude", 10, policy, WEB_DOCUMENT_ADAPTER).every(r => !r.ranking.exactTitle)).toBe(true);
    expect(rankDocuments([list("exa", records)], "étude нейрон models", 10, { ...policy, exactTitle: false }, WEB_DOCUMENT_ADAPTER).every(r => !r.ranking.exactTitle)).toBe(true);
  });
  it.each([["Short Title", false], ['"Short Title"', true]])("requires quotes for short title lookup: %s", (query, expected) => {
    const result = rankDocuments([list("exa", [web("Short Title")])], query as string, 1, policy, WEB_DOCUMENT_ADAPTER);
    expect(result[0].ranking.exactTitle).toBe(expected);
  });
  it("checks all merged member titles while exact URL priority outranks title", () => {
    const records = [web("Some Longer Display Title", "target", "rich body"), web("A Requested Full Title", "target"), web("https://example.test/target", "other")];
    const lists = [list("exa", records)];
    expect(rankDocuments(lists, "A Requested Full Title", 10, policy, WEB_DOCUMENT_ADAPTER)[0].ranking.exactTitle).toBe(true);
    expect(rankDocuments(lists, "https://example.test/target", 10, policy, WEB_DOCUMENT_ADAPTER)[0]).toMatchObject({ document: { url: "https://example.test/target" }, ranking: { exactId: true } });
  });
});
