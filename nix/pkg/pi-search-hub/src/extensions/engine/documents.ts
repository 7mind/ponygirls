import type { SearchResult } from "../types.js";
import type { DocumentAdapter } from "./types.js";

/** URL identity preserves path/query case and trailing slashes, removing only fragments. */
export function normalizeDocumentUrl(url: string): string {
  try { const parsed = new URL(url); parsed.hash = ""; return parsed.toString(); }
  catch { return url; }
}

export const WEB_DOCUMENT_ADAPTER: DocumentAdapter<SearchResult> = {
  normalize: document => ({ ...document }),
  aliases: document => [normalizeDocumentUrl(document.url)],
  merge: documents => documents.reduce((best, next) =>
    (next.content ?? next.snippet ?? "").length > (best.content ?? best.snippet ?? "").length ? next : best),
  title: document => document.title,
  body: document => `${document.content ?? ""} ${document.snippet ?? ""}`,
  exactIdentifier: (document, query) => {
    try {
      const parsed = new URL(query.trim());
      return ["http:", "https:"].includes(parsed.protocol) && normalizeDocumentUrl(document.url) === normalizeDocumentUrl(query.trim());
    } catch { return false; }
  },
};
