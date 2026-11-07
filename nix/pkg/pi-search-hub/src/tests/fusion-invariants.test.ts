import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, type RankedBackendList } from "../extensions/dispatch.js";
import type { SearchResultWithBackend } from "../extensions/types.js";

const hit = (name: string): SearchResultWithBackend => ({ title: name, url: `https://example.test/${name}` });
const list = (backend: string, results: SearchResultWithBackend[]): RankedBackendList => ({
	backend, results: results.map(result => ({ ...result, backend })),
});

// Behavioral-Active-Blackbox-Atomic. Regression origin: URL false merges,
// repeated backend votes, and the lone-list dedup bypass.
describe("fusion document identity", () => {
	it.each([
		["path case", "https://example.test/Page", "https://example.test/page"],
		["query key case", "https://example.test/?Token=a", "https://example.test/?token=a"],
		["query value case", "https://example.test/?token=A", "https://example.test/?token=a"],
		["trailing slash", "https://example.test/page", "https://example.test/page/"],
		["repeated trailing slash", "https://example.test/page/", "https://example.test/page//"],
		["unparseable URL case", "not-a-url/Page", "not-a-url/page"],
		["scheme", "http://example.test/page", "https://example.test/page"],
		["non-default port", "https://example.test/page", "https://example.test:8443/page"],
	])("preserves distinct resources differing in %s", (_difference, first, second) => {
		const fused = reciprocalRankFusion([
			list("a", [{ title: "First", url: first }]),
			list("b", [{ title: "Second", url: second }]),
		], 10);

		expect(fused.map(result => result.url)).toEqual([first, second]);
		expect(fused.map(result => result.sources)).toEqual([["a"], ["b"]]);
	});

	it.each([
		["HTTPS://Example.TEST:443/Page?Token=Ab#one", "https://example.test/Page?Token=Ab#two"],
		["HTTP://Example.TEST:80/Page?Token=Ab#one", "http://example.test/Page?Token=Ab#two"],
	])("deduplicates only canonical authority and page fragments: %s", (first, second) => {
		const fused = reciprocalRankFusion([
			list("a", [{ title: "Short", url: first, snippet: "short" }]),
			list("b", [{ title: "Rich", url: second, content: "the richest page content" }]),
		], 10);

		expect(fused).toEqual([{
			title: "Rich", url: second, content: "the richest page content", backend: "b", sources: ["b", "a"],
		}]);
	});
});

describe("fusion backend votes", () => {
	it("does not let repeated hits outrank independent agreement", () => {
		const fused = reciprocalRankFusion([
			list("a", [hit("agreed"), hit("repeated"), hit("repeated"), hit("repeated")]),
			list("b", [hit("agreed")]),
		], 2);

		expect(fused.map(result => result.title)).toEqual(["agreed", "repeated"]);
		expect(fused.map(result => result.sources)).toEqual([["a", "b"], ["a"]]);
	});

	it("does not let repeats depress the ranks of later distinct documents", () => {
		const other = list("b", [hit("b-first"), hit("b-second")]);
		const clean = reciprocalRankFusion([list("a", [hit("a-first"), hit("a-second")]), other], 10);
		const repeated = reciprocalRankFusion([
			list("a", [hit("a-first"), hit("a-first"), hit("a-second")]), other,
		], 10);

		expect(clean.map(result => result.title)).toEqual(["a-first", "b-first", "a-second", "b-second"]);
		expect(repeated).toEqual(clean);
	});

	it.each([1, 2, 5])("is invariant to %i repetitions of each backend hit", repetitions => {
		const lists = [
			list("a", [hit("first"), hit("shared"), hit("last")]),
			list("b", [hit("shared"), hit("other")]),
		];
		for (let backendIndex = 0; backendIndex < lists.length; backendIndex++) {
			for (let hitIndex = 0; hitIndex < lists[backendIndex].results.length; hitIndex++) {
				const repeated = lists.map((entry, index) => index !== backendIndex ? entry : ({
					...entry,
					results: entry.results.flatMap((result, rank) => rank === hitIndex ? Array(repetitions + 1).fill(result) : [result]),
				}));
				for (const maxResults of [1, 3, 10]) {
					expect(reciprocalRankFusion(repeated, maxResults)).toEqual(reciprocalRankFusion(lists, maxResults));
				}
			}
		}
	});

	it("keeps richer duplicate metadata and every independent contributor", () => {
		const fused = reciprocalRankFusion([
			list("a", [hit("page"), { ...hit("page"), content: "the richest page content" }]),
			list("b", [hit("page"), hit("page")]),
		], 1);

		expect(fused).toEqual([{
			...hit("page"), content: "the richest page content", backend: "a", sources: ["a", "b"],
		}]);
	});

	it("uses the named backend for a richer untagged result", () => {
		const fused = reciprocalRankFusion([
			{ backend: "a", results: [hit("page")] },
			{ backend: "b", results: [{ ...hit("page"), content: "rich content" }] },
		], 1);

		expect(fused[0].backend).toBe("b");
		expect(fused[0].sources).toEqual(["b", "a"]);
	});

	it("rejects duplicate backend list IDs instead of treating them as independent votes", () => {
		expect(() => reciprocalRankFusion([
			list("a", [hit("first")]), list("a", [hit("second")]),
		], 10)).toThrow('Duplicate ranked backend list: "a"');
	});
});

describe("fusion list-count invariants", () => {
	const duplicateList = list("a", [
		{ ...hit("first"), snippet: "short" },
		{ ...hit("first"), content: "richer duplicate content" },
		hit("second"),
	]);

	it("deduplicates before the lone-list cutoff and keeps its richest copy", () => {
		expect(reciprocalRankFusion([duplicateList], 2)).toEqual([
			{ ...hit("first"), content: "richer duplicate content", backend: "a", sources: ["a"] },
			{ ...hit("second"), backend: "a", sources: ["a"] },
		]);
	});

	it.each([1, 2, 10])("has identical one-list and multilist semantics at cutoff %i", maxResults => {
		const lone = reciprocalRankFusion([duplicateList], maxResults);
		expect(lone).toEqual(reciprocalRankFusion([duplicateList, list("empty", [])], maxResults));
		expect(lone).toEqual(reciprocalRankFusion([list("empty", []), duplicateList], maxResults));
	});
});
