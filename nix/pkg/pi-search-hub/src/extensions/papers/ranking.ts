import { rankDocuments } from "../engine/ranking.js";
import { DEFAULT_RANKING } from "../engine/policy.js";
import type { DocumentAdapter, RankedList, RankingPolicy } from "../engine/types.js";
import { normalizePaper, paperAliases, parsePaperId } from "./identity.js";
import { PAPER_PROVIDERS, type PaperProviderName, type PaperRecord, type RankedPaper } from "./types.js";

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const richest = (values: (string | undefined)[]) => values.filter((v): v is string => !!v).sort((a, b) => b.length - a.length || compare(a, b))[0];

/** Papers supply identity and metadata semantics only; ranking lives in the shared engine. */
export const PAPER_DOCUMENT_ADAPTER: DocumentAdapter<PaperRecord> = {
  normalize: normalizePaper,
  aliases: paperAliases,
  merge: members => {
    const ids = [...new Map(members.flatMap(record => record.ids).map(id => [`${id.namespace}:${id.value}`, id])).values()]
      .sort((a, b) => compare(`${a.namespace}:${a.value}`, `${b.namespace}:${b.value}`));
    const abstract = richest(members.map(record => record.abstract));
    const snippet = richest(members.map(record => record.snippet));
    const dateRecord = members.find(record => record.date);
    const urls = members.map(record => record.url).filter(url => {
      try { return ["https:", "http:"].includes(new URL(url).protocol); }
      catch { return false; }
    }).sort(compare);
    const notices = [...new Set(members.flatMap(record => record.notices ?? []))].sort(compare);
    return {
      title: richest(members.map(record => record.title)) ?? "", url: urls[0] ?? "", ids,
      authors: [...members.map(record => record.authors)].sort((a, b) => b.length - a.length || compare(a.join("\0"), b.join("\0")))[0],
      categories: [...new Set(members.flatMap(record => record.categories))].sort(compare),
      ...(abstract ? { abstract } : {}), ...(snippet ? { snippet } : {}),
      ...(dateRecord ? { date: dateRecord.date, dateKind: dateRecord.dateKind } : {}),
      ...(notices.length ? { notices } : {}),
    };
  },
  title: document => document.title,
  body: document => `${document.abstract ?? ""} ${document.snippet ?? ""}`,
  exactIdentifier: (document, query) => {
    const id = parsePaperId(query);
    return !!id && document.ids.some(candidate => candidate.namespace === id.namespace && candidate.value === id.value);
  },
};

function providerName(source: string): PaperProviderName {
  if (!(PAPER_PROVIDERS as readonly string[]).includes(source)) throw new Error(`Unsupported paper source: ${source}`);
  return source as PaperProviderName;
}

export function rankPapers(lists: RankedList<PaperRecord>[], query: string, count: number, policy: RankingPolicy): RankedPaper[] {
  lists.forEach(list => providerName(list.source));
  return rankDocuments(lists, query, count, policy, PAPER_DOCUMENT_ADAPTER).map(({ document, ranking }) => ({
    ...document, ...ranking,
    sources: ranking.sources.map(providerName).sort(compare),
    contributions: ranking.contributions.map(({ source, ...contribution }) => ({ provider: providerName(source), ...contribution }))
      .sort((a, b) => compare(a.provider, b.provider)),
  }));
}

/** Compatibility boundary for older paper callers. */
export function fusePapers(
  lists: { provider: PaperProviderName; weight: number; results: PaperRecord[]; redundantWith?: string[] }[],
  query: string, count: number, rerank: "rrf" | "lexical",
): RankedPaper[] {
  return rankPapers([...lists].sort((a, b) => compare(a.provider, b.provider)).map(list => ({
    source: list.provider, weight: list.weight, results: list.results,
    redundantWith: list.redundantWith ?? (list.provider === "searxng" ? ["*"] : []),
  })), query, count, { ...DEFAULT_RANKING, rerank });
}
