import { expect, it } from "vitest";
import { formatPaperSearch } from "../extensions/papers/formatters.js";
import type { PaperResearchOutput } from "../extensions/papers/service.js";

// Behavioral-Active-Blackbox-Atomic: qualified metadata survives human-readable presentation.
it("does not relabel an unqualified metadata date as publication", () => {
  const output: PaperResearchOutput = { action: "read", results: [], passages: [], providers: [], notices: [], truncated: false, cancelled: false, timedOut: false,
    paper: { title: "A paper", url: "https://example.org/paper", ids: [], authors: [], categories: [], date: "2020-01-02" } };
  expect(formatPaperSearch(output)).toContain("Date: 2020-01-02");
  expect(formatPaperSearch(output)).not.toContain("Published:");
  output.paper!.dateKind = "created";
  expect(formatPaperSearch(output)).toContain("Created: 2020-01-02");
  output.paper!.dateKind = "published";
  expect(formatPaperSearch(output)).toContain("Published: 2020-01-02");
});
