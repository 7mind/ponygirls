import type { PaperIdentifier, PaperRecord } from "./types.js";

/** Identifier parsing is anchored: prose ending in an identifier is not an ID query. */
export function parsePaperId(input: string, namespace?: PaperIdentifier["namespace"]): PaperIdentifier | undefined {
  let value = input.trim();
  if (namespace === "firecrawl") return value ? { namespace, value } : undefined;
  if (/^https?:\/\//i.test(value)) try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    const host = url.hostname.toLowerCase();
    const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
    if (host === "doi.org" || host === "dx.doi.org") return parsePaperId(path.slice(1), "doi");
    if (host === "arxiv.org" || host === "www.arxiv.org" || host === "export.arxiv.org") {
      const match = path.match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/i);
      return match ? parsePaperId(match[1], "arxiv") : undefined;
    }
    if (host === "pubmed.ncbi.nlm.nih.gov") return parsePaperId(path.slice(1), "pmid");
    if (host === "pmc.ncbi.nlm.nih.gov" || host === "www.ncbi.nlm.nih.gov") {
      const match = path.match(/^\/(?:pmc\/)?articles\/(PMC\d+)$/i);
      return match ? parsePaperId(match[1], "pmcid") : undefined;
    }
    return undefined;
  } catch { /* Not a URL; try the strict textual forms below. */ }
  if (namespace === "doi" || /^doi\s*:/i.test(value) || /^10\.\d{4,9}\//.test(value)) {
    value = value.replace(/^doi\s*:\s*/i, "").toLowerCase();
    return /^10\.\d{4,9}\/\S+$/.test(value) ? { namespace: "doi", value } : undefined;
  }
  if (namespace === "arxiv" || /^arxiv\s*:/i.test(value) || /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v\d+)?$/i.test(value)) {
    value = value.replace(/^arxiv\s*:\s*/i, "").replace(/v\d+$/i, "").toLowerCase();
    return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})$/.test(value) ? { namespace: "arxiv", value } : undefined;
  }
  if (namespace === "pmcid" || /^(?:pmcid\s*:\s*)?PMC\d+$/i.test(value)) {
    value = value.replace(/^pmcid\s*:\s*/i, "").replace(/^PMC/i, "");
    return /^\d+$/.test(value) ? { namespace: "pmcid", value: `PMC${value}` } : undefined;
  }
  if (namespace === "pmid" || /^pmid\s*:/i.test(value)) {
    value = value.replace(/^pmid\s*:\s*/i, "");
    return /^\d+$/.test(value) ? { namespace: "pmid", value } : undefined;
  }
  return undefined;
}

export function normalizePaper(record: PaperRecord): PaperRecord {
  const ids = new Map<string, PaperIdentifier>();
  for (const raw of record.ids) {
    const id = parsePaperId(raw.value, raw.namespace);
    if (id) ids.set(`${id.namespace}:${id.value}`, id);
  }
  const inferred = parsePaperId(record.url);
  if (inferred) ids.set(`${inferred.namespace}:${inferred.value}`, inferred);
  return { ...record, ids: [...ids.values()].sort((a, b) => `${a.namespace}:${a.value}`.localeCompare(`${b.namespace}:${b.value}`)), authors: [...record.authors], categories: [...record.categories] };
}

export function paperAliases(record: PaperRecord): string[] {
  const aliases = record.ids.map(id => `${id.namespace}:${id.value}`);
  // URL equality is useful evidence, unlike title equality. Never collapse hosts,
  // paths or query strings using heuristic article-title matching.
  if (record.url.trim()) {
    try { aliases.push(`url:${new URL(record.url).href}`); }
    catch { /* Invalid URLs are not identity evidence. */ }
  }
  return aliases;
}
