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
