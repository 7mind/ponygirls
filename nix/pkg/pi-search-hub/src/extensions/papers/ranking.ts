import { normalizePaper, paperAliases, parsePaperId } from "./identity.js";
import type { PaperProviderName, PaperRecord, RankedPaper } from "./types.js";

interface List { provider: PaperProviderName; weight: number; results: PaperRecord[] }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const tokens = (s: string) => new Set(s.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const richest = (values: (string | undefined)[]) => values.filter((v): v is string => !!v).sort((a, b) => b.length - a.length || compare(a, b))[0];

/** Single cross-tier weighted RRF. textBoost is the multiplier (1 through 1.3). */
export function fusePapers(lists: List[], query: string, count: number, rerank: "rrf" | "lexical"): RankedPaper[] {
  const ordered = [...lists].sort((a, b) => compare(a.provider, b.provider));
  const records = ordered.flatMap(list => list.results.map(normalizePaper));
  const parents = records.map((_, i) => i);
  const root = (i: number): number => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  const seen = new Map<string, number>();
  records.forEach((record, i) => {
    for (const alias of paperAliases(record)) {
      const previous = seen.get(alias);
      if (previous !== undefined) parents[root(i)] = root(previous);
      seen.set(alias, i);
    }
  });
  const groups = new Map<number, PaperRecord[]>();
  records.forEach((record, i) => { const key = root(i); groups.set(key, [...(groups.get(key) ?? []), record]); });
  const votes = new Map<number, Map<PaperProviderName, { rank: number; weight: number }>>();
  let offset = 0;
  for (const list of ordered) {
    const distinct = new Set<number>();
    for (let i = 0; i < list.results.length; i++) {
      const key = root(offset + i);
      if (distinct.has(key)) continue;
      distinct.add(key);
      const providers = votes.get(key) ?? new Map();
      const vote = { rank: distinct.size, weight: list.weight };
      const prior = providers.get(list.provider);
      if (!prior || prior.rank > vote.rank) providers.set(list.provider, vote);
      votes.set(key, providers);
    }
    offset += list.results.length;
  }
  const queryId = parsePaperId(query);
  const queryTokens = tokens(query);
  const coverage = (text: string) => {
    const words = tokens(text);
    return queryTokens.size ? [...queryTokens].filter(token => words.has(token)).length / queryTokens.size : 0;
  };
  const ranked = [...groups].map(([key, members]) => {
    const ids = [...new Map(members.flatMap(record => record.ids).map(id => [`${id.namespace}:${id.value}`, id])).values()]
      .sort((a, b) => compare(`${a.namespace}:${a.value}`, `${b.namespace}:${b.value}`));
    const providers = votes.get(key)!;
    const sources = [...providers.keys()].sort(compare);
    const contributions = sources.map(provider => {
      const { rank, weight } = providers.get(provider)!;
      return { provider, rank, weight, term: provider === "searxng" && sources.some(source => source !== "searxng") ? 0 : weight / (60 + rank) };
    });
    const title = richest(members.map(record => record.title)) ?? "";
    const abstract = richest(members.map(record => record.abstract));
    const snippet = richest(members.map(record => record.snippet));
    const textBoost = rerank === "lexical" ? 1 + 0.2 * coverage(title) + 0.1 * coverage(`${abstract ?? ""} ${snippet ?? ""}`) : 1;
    const rrfScore = contributions.reduce((sum, item) => sum + item.term, 0);
    const dateRecord = members.find(record => record.date);
    const urls = members.map(record => record.url).filter(url => {
      try { const parsed = new URL(url); return parsed.protocol === "https:" || parsed.protocol === "http:"; }
      catch { return false; }
    }).sort(compare);
    const paper: RankedPaper = {
      title, url: urls[0] ?? "", ids,
      authors: [...members.map(record => record.authors)].sort((a, b) => b.length - a.length || compare(a.join("\0"), b.join("\0")))[0],
      categories: [...new Set(members.flatMap(record => record.categories))].sort(compare),
      ...(abstract ? { abstract } : {}), ...(snippet ? { snippet } : {}),
      ...(dateRecord ? { date: dateRecord.date, dateKind: dateRecord.dateKind } : {}),
      sources, contributions, rrfScore, textBoost, score: rrfScore * textBoost,
      exactId: !!queryId && ids.some(id => id.namespace === queryId.namespace && id.value === queryId.value),
    };
    const notices = [...new Set(members.flatMap(record => record.notices ?? []))].sort(compare);
    if (notices.length) paper.notices = notices;
    return { paper, tie: paperAliases(paper).sort(compare)[0] ?? `${title}\0${paper.url}` };
  });
  return ranked.sort((a, b) => Number(b.paper.exactId) - Number(a.paper.exactId) || b.paper.score - a.paper.score || compare(a.tie, b.tie))
    .slice(0, count).map(item => item.paper);
}
