import type { DocumentAdapter, RankedDocument, RankedList, RankingPolicy } from "./types.js";

const tokens = (text: string) => text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const normalizedTitle = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\p{P}\s]+/gu, " ").trim();

/** Domain-independent identity union, distinct-document weighted RRF, and lookup/reranking. */
export function rankDocuments<T>(lists: RankedList<T>[], query: string, count: number, policy: RankingPolicy, adapter: DocumentAdapter<T>): RankedDocument<T>[] {
  if (!Number.isFinite(count) || count < 0) throw new Error("Invalid ranking count");
  for (const key of ["rankConstant", "titleWeight", "bodyWeight"] as const) {
    if (!Number.isFinite(policy[key]) || policy[key] < 0) throw new Error(`Invalid ranking ${key}`);
  }
  if (policy.rerank !== "rrf" && policy.rerank !== "lexical") throw new Error("Invalid reranking mode");
  const sources = new Set<string>();
  for (const list of lists) {
    if (sources.has(list.source)) throw new Error(`Duplicate ranked source list: "${list.source}"`);
    sources.add(list.source);
    if (!Number.isFinite(list.weight) || list.weight < 0) throw new Error(`Invalid ranking weight: ${list.source}`);
  }
  const records = lists.flatMap(list => list.results.map(record => adapter.normalize(record)));
  const parents = records.map((_, i) => i);
  const root = (index: number): number => {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  };
  const aliases = new Map<string, number>();
  records.forEach((record, index) => {
    for (const alias of adapter.aliases(record)) {
      const previous = aliases.get(alias);
      if (previous !== undefined) parents[root(index)] = root(previous);
      aliases.set(alias, index);
    }
  });
  const groups = new Map<number, T[]>();
  records.forEach((record, index) => {
    const key = root(index);
    const members = groups.get(key) ?? [];
    members.push(record);
    groups.set(key, members);
  });
  const votes = new Map<number, { source: string; rank: number; weight: number; redundantWith: string[] }[]>();
  let offset = 0;
  for (const list of lists) {
    const distinct = new Set<number>();
    list.results.forEach((_, index) => {
      const key = root(offset + index);
      if (distinct.has(key)) return;
      distinct.add(key);
      const contributions = votes.get(key) ?? [];
      contributions.push({ source: list.source, rank: distinct.size, weight: list.weight, redundantWith: list.redundantWith });
      votes.set(key, contributions);
    });
    offset += list.results.length;
  }
  const queryTokens = new Set(tokens(query));
  const titleQuery = normalizedTitle(query);
  const quoted = /^\s*(?:"[^"]+"|'[^']+'|“[^”]+”|‘[^’]+’)\s*$/u.test(query);
  const titleLookup = policy.exactTitle && !!titleQuery && (quoted || tokens(query).length >= 3);
  const coverage = (text: string) => {
    const words = new Set(tokens(text));
    return queryTokens.size ? [...queryTokens].filter(token => words.has(token)).length / queryTokens.size : 0;
  };
  const ranked = [...groups].map(([key, members]): RankedDocument<T> => {
    const document = adapter.merge(members);
    const originalVotes = votes.get(key)!;
    const contributions = originalVotes.map(({ source, rank, weight, redundantWith }) => {
      const suppressed = originalVotes.some(other => other.source !== source && (redundantWith.includes("*") || redundantWith.includes(other.source)));
      return { source, rank, weight, term: suppressed ? 0 : weight / (policy.rankConstant + rank) };
    });
    const rrfScore = contributions.reduce((sum, item) => sum + item.term, 0);
    const textBoost = policy.rerank === "lexical" ? 1 + policy.titleWeight * coverage(adapter.title(document)) + policy.bodyWeight * coverage(adapter.body(document)) : 1;
    const score = rrfScore * textBoost;
    if (![rrfScore, textBoost, score].every(Number.isFinite)) throw new Error("Non-finite ranking score");
    return { document, ranking: {
      sources: contributions.map(item => item.source), contributions, rrfScore, textBoost, score,
      exactId: members.some(member => adapter.exactIdentifier(member, query)),
      exactTitle: titleLookup && members.some(member => normalizedTitle(adapter.title(member)) === titleQuery),
    } };
  });
  // Only real votes break score ties; suppressed provenance cannot buy priority.
  const voteCount = (item: RankedDocument<T>) => item.ranking.contributions.filter(vote => vote.term > 0).length;
  // Stable sort deliberately preserves original encounter order for final ties.
  return ranked.sort((a, b) => Number(b.ranking.exactId) - Number(a.ranking.exactId)
    || Number(b.ranking.exactTitle) - Number(a.ranking.exactTitle) || b.ranking.score - a.ranking.score
    || voteCount(b) - voteCount(a))
    .slice(0, Math.floor(count));
}
