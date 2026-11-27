/**
 * What the list shows: a tab, a text filter and a sort key applied to the
 * catalog, plus the per-source and overall totals.
 */
import { canLoad, isActive, isCharged, totalTokens, type ToolCatalog, type ToolEntry } from "./catalog.ts";
import { compareOrigins, compareText, originLabel, sameOrigin, type ToolOrigin } from "./origin.ts";

export type Tab = "all" | "active" | "inactive";
export const TABS: readonly Tab[] = ["all", "active", "inactive"];

/** `source` groups the list under a heading per source; the others are flat. */
export type SortKey = "source" | "tokens" | "name";
export const SORT_KEYS: readonly SortKey[] = ["source", "tokens", "name"];

export interface Query {
  tab: Tab;
  sort: SortKey;
  /** Words that must all occur in a tool's name, source or description. */
  filter: string;
}

export interface SourceSummary {
  origin: ToolOrigin;
  tools: number;
  active: number;
  /** Estimated tokens its declared tools cost now. */
  chargedTokens: number;
  /** Estimated tokens of its tools as if every one that can be declared were. */
  allTokens: number;
}

export interface CatalogSummary {
  all: number;
  active: number;
  inactive: number;
  chargedTokens: number;
  /** What loading every tool outside the active set that can be loaded would add. */
  inactiveTokens: number;
  /** Share of the model's context window the charged tokens take, `null` without a model. */
  windowShare: number | null;
  sources: readonly SourceSummary[];
}

export type ListItem = { kind: "source"; summary: SourceSummary } | { kind: "tool"; entry: ToolEntry };

export function nextOf<T>(values: readonly T[], current: T): T {
  return values[(values.indexOf(current) + 1) % values.length]!;
}

function emptySource(origin: ToolOrigin): SourceSummary {
  return { origin, tools: 0, active: 0, chargedTokens: 0, allTokens: 0 };
}

export function summarize(catalog: ToolCatalog): CatalogSummary {
  const sources: SourceSummary[] = [];
  let active = 0;
  let chargedTokens = 0;
  let inactiveTokens = 0;
  for (const entry of catalog.entries) {
    let source = sources.find((candidate) => sameOrigin(candidate.origin, entry.origin));
    if (source === undefined) {
      source = emptySource(entry.origin);
      sources.push(source);
    }
    const tokens = totalTokens(entry.cost);
    source.tools += 1;
    if (isActive(entry)) {
      active += 1;
      source.active += 1;
      source.allTokens += tokens;
    } else if (canLoad(entry)) {
      inactiveTokens += tokens;
      source.allTokens += tokens;
    }
    if (isCharged(entry)) {
      chargedTokens += tokens;
      source.chargedTokens += tokens;
    }
  }
  sources.sort((a, b) => compareOrigins(a.origin, b.origin));
  return {
    all: catalog.entries.length,
    active,
    inactive: catalog.entries.length - active,
    chargedTokens,
    inactiveTokens,
    windowShare: catalog.model === null || catalog.model.contextWindow <= 0 ? null : chargedTokens / catalog.model.contextWindow,
    sources,
  };
}

function inTab(entry: ToolEntry, tab: Tab): boolean {
  return tab === "all" || isActive(entry) === (tab === "active");
}

export function filterTerms(filter: string): string[] {
  return filter.toLowerCase().split(/\s+/).filter((term) => term !== "");
}

function matches(entry: ToolEntry, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const text = `${entry.name}\n${originLabel(entry.origin)}\n${entry.definition.description}`.toLowerCase();
  return terms.every((term) => text.includes(term));
}

const ORDER: Readonly<Record<SortKey, (a: ToolEntry, b: ToolEntry) => number>> = {
  source: (a, b) => compareOrigins(a.origin, b.origin) || compareText(a.name, b.name),
  tokens: (a, b) => totalTokens(b.cost) - totalTokens(a.cost) || compareText(a.name, b.name),
  name: (a, b) => compareText(a.name, b.name),
};

/** The tools a query selects, in its order. */
export function selectTools(catalog: ToolCatalog, query: Query): ToolEntry[] {
  const terms = filterTerms(query.filter);
  return catalog.entries.filter((entry) => inTab(entry, query.tab) && matches(entry, terms)).sort(ORDER[query.sort]);
}

/** The selected tools as list lines: sorted by source, each source's tools follow its heading. */
export function listItems(tools: readonly ToolEntry[], summary: CatalogSummary, sort: SortKey): ListItem[] {
  if (sort !== "source") return tools.map((entry) => ({ kind: "tool", entry }));
  const items: ListItem[] = [];
  let heading: ToolOrigin | null = null;
  for (const entry of tools) {
    if (heading === null || !sameOrigin(heading, entry.origin)) {
      heading = entry.origin;
      const source = summary.sources.find((candidate) => sameOrigin(candidate.origin, entry.origin));
      if (source === undefined) throw new Error(`No summary for the source of ${entry.name}`);
      items.push({ kind: "source", summary: source });
    }
    items.push({ kind: "tool", entry });
  }
  return items;
}
