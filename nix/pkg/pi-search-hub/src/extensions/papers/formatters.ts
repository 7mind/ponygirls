import type { PaperResearchOutput } from "./service.js";
import type { PaperRecord, RankedPaper } from "./types.js";

const clean = (value: string, limit = 1400): string => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, limit);
function describe(paper: PaperRecord, index: number): string {
  const lines = [`${index}. ${clean(paper.title, 400)}`, clean(paper.url, 2000)];
  if (paper.ids.length) lines.push(`IDs: ${paper.ids.slice(0, 20).map(id => `${clean(id.namespace, 30)}:${clean(id.value, 300)}`).join("; ")}`);
  if (paper.authors.length) lines.push(`Authors: ${paper.authors.slice(0, 20).map(author => clean(author, 100)).join(", ")}`);
  if (paper.date) lines.push(`${paper.dateKind === "created" ? "Created" : paper.dateKind === "published" ? "Published" : "Date"}: ${clean(paper.date, 100)}`);
  if (paper.abstract) lines.push(`Abstract: ${clean(paper.abstract)}`);
  else if (paper.snippet) lines.push(`Snippet: ${clean(paper.snippet, 600)}`);
  if ("sources" in paper) {
    const ranked = paper as RankedPaper;
    lines.push(`Sources: ${ranked.sources.map(source => clean(source, 30)).join(", ")}`);
    lines.push(`Score: ${ranked.score.toFixed(4)}; exact ID: ${ranked.exactId ? "yes" : "no"}; exact title: ${ranked.exactTitle ? "yes" : "no"}`);
  }
  return lines.join("\n");
}

/** Human-readable panel output. Never renders raw upstream errors or warnings. */
export function formatPaperSearch(output: PaperResearchOutput): string {
  const sections = ["Scholarly source evidence is not independent confirmation or proof of peer review."];
  sections.push(output.providers.map(source => `${clean(source.provider, 30)} (${clean(source.tier, 30)}): ${clean(source.status, 30)}; ${source.count} results`).join("\n"));
  if (output.paper) sections.push(describe(output.paper, 1));
  sections.push(...output.results.map((paper, index) => describe(paper, index + 1)));
  if (!output.paper && output.results.length === 0) sections.push("No papers returned.");
  sections.push(...output.passages.map((passage, index) => `Passage ${index + 1}: ${clean(passage.text, 6000)}`));
  if (output.timedOut) sections.push("Deadline reached; completed results only.");
  if (output.cancelled) sections.push("Request cancelled; completed results only.");
  if (output.truncated) sections.push("Output truncated to display limits.");
  if (output.notices.length) sections.push(`Source/policy notices: ${output.notices.length}. Inspect structured tool output for details.`);
  return sections.filter(Boolean).join("\n\n");
}
