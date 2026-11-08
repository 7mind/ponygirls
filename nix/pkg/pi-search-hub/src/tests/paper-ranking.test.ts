import { describe, it, expect } from "vitest";
import { normalizePaper } from "../extensions/papers/identity.js";
import { fusePapers } from "../extensions/papers/ranking.js";
import type { PaperIdentifier, PaperRecord } from "../extensions/papers/types.js";
const paper = (name: string, ids: PaperIdentifier[] = [], more: Partial<PaperRecord> = {}): PaperRecord => ({ title: name, url: `https://example.test/${name}`, ids, authors: [], categories: [], ...more });
const doi = (value: string): PaperIdentifier => ({ namespace: "doi", value });
const arxiv = (value: string): PaperIdentifier => ({ namespace: "arxiv", value });

// Specified BA/BG: public pure identity/ranking contracts, no network or internals.
describe("paper identity", () => {
  it.each([
    ["https://doi.org/10.1234/ABc", "doi", "10.1234/abc"],
    ["https://arxiv.org/pdf/2401.01234v9.pdf", "arxiv", "2401.01234"],
    ["https://export.arxiv.org/abs/hep-th/9901001v2", "arxiv", "hep-th/9901001"],
    ["https://pubmed.ncbi.nlm.nih.gov/12345/", "pmid", "12345"],
    ["https://pmc.ncbi.nlm.nih.gov/articles/PMC12345/", "pmcid", "PMC12345"],
    ["https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12345/", "pmcid", "PMC12345"],
  ])("infers exact trusted host IDs from %s", (url, namespace, value) => {
    expect(normalizePaper(paper("x", [], { url })).ids).toEqual([{ namespace, value }]);
  });
  it("normalizes prefixes and versions but keeps firecrawl IDs namespaced", () => {
    const normalized = normalizePaper(paper("x", [doi("DOI:10.1234/ABC"), doi("https://doi.org/10.1234/abc"), arxiv("arXiv:hep-th/9901001v3"), { namespace: "firecrawl", value: "10.1234/ABC" }]));
    expect(normalized.ids).toEqual([arxiv("hep-th/9901001"), doi("10.1234/abc"), { namespace: "firecrawl", value: "10.1234/ABC" }]);
  });
  it.each(["https://doi.org.evil.test/10.1234/abc", "https://evil.test/abs/2401.01234", "https://evil.test/?url=https://doi.org/10.1234/abc"])("does not infer an ID from %s", url => {
    expect(normalizePaper(paper("x", [], { url })).ids).toEqual([]);
  });
});

describe("paper fusion", () => {
  it("bridges transitive aliases and preserves all provenance and richest source metadata", () => {
    const a = paper("Short", [doi("10.1234/a")], { abstract: "source abstract", notices: ["notice a"] });
    const b = paper("A longer title", [arxiv("2401.01234")], { authors: ["Alice", "Bob"], snippet: "snippet only", notices: ["notice b"] });
    const bridge = paper("Bridge", [doi("10.1234/a"), arxiv("2401.01234v2")]);
    const result = fusePapers([{ provider: "firecrawl", weight: 1, results: [a] }, { provider: "exa", weight: 2, results: [b] }, { provider: "arxiv", weight: 1, results: [bridge] }], "q", 10, "rrf");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: "A longer title", abstract: "source abstract", authors: ["Alice", "Bob"], sources: ["arxiv", "exa", "firecrawl"], notices: ["notice a", "notice b"] });
    expect(result[0].rrfScore).toBeCloseTo(4 / 61);
  });
  it("prefers a valid nonempty URL when explicit crosswalk joins canonical-only metadata", () => {
    const result = fusePapers([{ provider: "firecrawl", weight: 1, results: [paper("canonical", [doi("10.1234/a")], { url: "" })] }, { provider: "exa", weight: 1, results: [paper("external", [doi("10.1234/a")])] }], "q", 1, "rrf");
    expect(result[0].url).toBe("https://example.test/external");
  });
  it("deduplicates before assigning original distinct document ranks", () => {
    const a = paper("a", [doi("10.1234/a")]);
    const b = paper("b", [doi("10.1234/b")]);
    const results = fusePapers([{ provider: "exa", weight: 2, results: [a, a, a, b] }], "q", 10, "rrf");
    expect(results.map(r => r.contributions)).toEqual([[{ provider: "exa", rank: 1, weight: 2, term: 2 / 61 }], [{ provider: "exa", rank: 2, weight: 2, term: 2 / 62 }]]);
  });
  it("does not merge unrelated same-title works or promote snippets to abstracts", () => {
    const results = fusePapers([{ provider: "exa", weight: 1, results: [paper("Same", [], { url: "https://example.test/a", snippet: "not an abstract" }), paper("Same", [], { url: "https://example.test/b" })] }], "q", 10, "lexical");
    expect(results).toHaveLength(2);
    expect(results[0].abstract).toBeUndefined();
  });
  it("merges exact URLs but preserves the query string as identity evidence", () => {
    const result = fusePapers([{ provider: "exa", weight: 1, results: [paper("a"), paper("b", [], { url: "https://example.test/a" }), paper("c", [], { url: "https://example.test/a?id=other" })] }], "q", 10, "rrf");
    expect(result).toHaveLength(2);
  });
  it("zeroes correlated SearXNG votes without dropping their provenance", () => {
    const a = paper("a");
    const result = fusePapers([{ provider: "exa", weight: 1, results: [a] }, { provider: "searxng", weight: 4, results: [a, paper("b")] }], "q", 10, "rrf");
    expect(result.find(r => r.title === "a")).toMatchObject({ sources: ["exa", "searxng"], rrfScore: 1 / 61, contributions: [{ provider: "exa", term: 1 / 61 }, { provider: "searxng", term: 0 }] });
    expect(result.find(r => r.title === "b")?.rrfScore).toBe(4 / 62);
  });
  it.each(["doi:10.1234/b", "https://doi.org/10.1234/B", "arXiv:2401.01234v8", "pmid:123", "PMC987"])("sorts anchored exact identifier query %s first", query => {
    const b = paper("b", [doi("10.1234/b"), arxiv("2401.01234"), { namespace: "pmid", value: "123" }, { namespace: "pmcid", value: "PMC987" }]);
    const results = fusePapers([{ provider: "exa", weight: 1, results: [paper("a"), b] }], query, 10, "rrf");
    expect(results[0]).toMatchObject({ title: "b", exactId: true });
  });
  it("does not extract arbitrary trailing query identifiers", () => {
    const results = fusePapers([{ provider: "exa", weight: 1, results: [paper("a"), paper("b", [doi("10.1234/b")])] }], "papers about doi:10.1234/b", 10, "rrf");
    expect(results[0].title).toBe("a");
    expect(results.every(r => !r.exactId)).toBe(true);
  });
  it("uses bounded Unicode token coverage and deterministic completion-independent ordering", () => {
    const lists = [{ provider: "exa" as const, weight: 1, results: [paper("ÉTUDE нейрон", [], { snippet: "étude нейрон" })] }, { provider: "arxiv" as const, weight: 1, results: [paper("Other")] }];
    const result = fusePapers(lists, "étude нейрон", 10, "lexical");
    expect(result[0].textBoost).toBeCloseTo(1.3);
    expect(result).toEqual(fusePapers([...lists].reverse(), "étude нейрон", 10, "lexical"));
    expect(fusePapers(lists, "étude нейрон", 10, "rrf").every(r => r.textBoost === 1)).toBe(true);
  });
});

// Regression BG: frozen minimal shape of parent-observed live title-lookup failure.
// This fixture establishes ordering behavior, not semantic relevance quality.
describe("exact full-title lookup priority", () => {
  // Specified BA/BG: held-out synthetic titles and negative controls.
  it.each(["rrf", "lexical"] as const)("prioritizes held-out full title in %s mode without inflating textBoost", rerank => {
    const exact = paper("Language Models Are Few Shot Learners");
    const topical = paper("Why Language Models Are Few Shot Learners Is a Popular Phrase");
    const result = fusePapers([
      { provider: "firecrawl", weight: 1, results: [topical, exact] },
      { provider: "arxiv", weight: 1, results: [topical] },
    ], exact.title, 3, rerank);
    expect(result[0]).toMatchObject({ title: exact.title, exactTitle: true });
    expect(result[0].score).toBeLessThan(result[1].score);
    expect(result[1].exactTitle).toBe(false);
    expect(result.every(p => p.textBoost >= 1 && p.textBoost <= 1.3)).toBe(true);
  });
  it("normalizes full Unicode/case/whitespace/punctuation title sequences", () => {
    const result = fusePapers([{ provider: "exa", weight: 1, results: [paper("ÉTUDE: Нейрон — ＭＯＤＥＬＳ!")] }], "  étude  нейрон models ", 1, "lexical");
    expect(result[0].exactTitle).toBe(true);
  });
  it.each([
    ["Graph Networks", false], ["Networks", false], ['"Graph Networks"', true], ["‘Graph Networks’", true], ['"Networks"', true],
  ])("requires quotes for short full-title lookup %s", (query, expected) => {
    const title = query.includes("Graph") ? "Graph Networks" : "Networks";
    const result = fusePapers([{ provider: "exa", weight: 1, results: [paper(title)] }], query, 1, "rrf");
    expect(result[0].exactTitle).toBe(expected);
  });
  it.each(["Models Language Are Few Shot Learners", "Language Models Are Few Shot Learners and Readers", "Language Models Are Few Shot", '"Language Models" explained'])
    ("does not flag topical substrings, reordered words, or partial quotes: %s", query => {
      const result = fusePapers([{ provider: "exa", weight: 1, results: [paper("Language Models Are Few Shot Learners")] }], query, 1, "lexical");
      expect(result[0].exactTitle).toBe(false);
    });
  it("checks every crosswalk member title, not just the richest display title", () => {
    const title = "Language Models Are Few Shot Learners";
    const result = fusePapers([
      { provider: "exa", weight: 1, results: [paper(title, [doi("10.1234/a")])] },
      { provider: "firecrawl", weight: 1, results: [paper(`${title}: Extended Source Metadata`, [doi("10.1234/a")])] },
    ], title, 2, "rrf");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: `${title}: Extended Source Metadata`, exactTitle: true });
  });
  it("does not merge unrelated same-title works even when both are exact lookups", () => {
    const title = "Language Models Are Few Shot Learners";
    const result = fusePapers([{ provider: "exa", weight: 1, results: [paper(title, [], { url: "https://example.test/one" }), paper(title, [], { url: "https://example.test/two" })] }], title, 2, "lexical");
    expect(result).toHaveLength(2);
    expect(result.every(p => p.exactTitle)).toBe(true);
    expect(result[0].ids).toEqual([]);
  });
  it("keeps exact identifier priority above exact title priority", () => {
    const query = "doi:10.1234/target";
    const result = fusePapers([
      { provider: "exa", weight: 1, results: [paper(query), paper("Different Source Title", [doi("10.1234/target")])] },
      { provider: "arxiv", weight: 1, results: [paper(query)] },
    ], query, 2, "lexical");
    expect(result[0]).toMatchObject({ title: "Different Source Title", exactId: true, exactTitle: false });
    expect(result[1]).toMatchObject({ title: query, exactId: false, exactTitle: true });
  });
  it("ranks the exact requested title above spurious cross-provider consensus", () => {
    const target = paper("Attention Is All You Need");
    const meme = paper('"All You Need" is Not All You Need for a Paper Title: On the Origins of a Scientific Meme');
    const results = fusePapers([
      { provider: "firecrawl", weight: 1, results: [target, paper("Distinct filler one"), paper("Distinct filler two"), paper("Distinct filler three"), meme] },
      { provider: "arxiv", weight: 1, results: [meme, paper("Another filler one"), paper("Another filler two")] },
    ], "Attention Is All You Need", 3, "lexical");
    expect(results[0].title).toBe(target.title);
  });
});
