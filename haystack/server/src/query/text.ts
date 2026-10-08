// Haystack query: text normalization shared by the dummy evaluator and the
// PG projection writer. One implementation → both legs agree by construction.
// Normalize: NFKC, locale-independent lowercase, Unicode L/N/M word runs.
import { isLosslessNumber } from "../domain/json.js";
export function normalizeWordRun(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

const WORD_RE = /[\p{L}\p{N}\p{M}]+/gu;

/** Normalized words of a text fragment (empty when the fragment has none). */
export function extractWords(text: string): string[] {
  const words: string[] = [];
  for (const match of normalizeWordRun(text).matchAll(WORD_RE)) {
    words.push(match[0]);
  }
  return words;
}

/** Corpus segments of a document: title, description, then every string leaf
 *  of fields (depth-first). Segment boundaries stop phrase matching. */
export function corpusSegments(title: string, description: string, fields: unknown): string[][] {
  const segments: string[][] = [];
  const push = (text: string) => {
    const words = extractWords(text);
    if (words.length > 0) segments.push(words);
  };
  push(title);
  push(description);
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value !== null && typeof value === "object") {
      // Numbers are not text; only string leaves qualify.
      if (isLosslessNumber(value)) return;
      Object.values(value).forEach(walk);
    }
  };
  walk(fields);
  return segments;
}

/** Flattened normalized word multiset (GIN candidate array). */
export function corpusWords(title: string, description: string, fields: unknown): string[] {
  return corpusSegments(title, description, fields).flat();
}

/** Segments as joined strings (phrase checks + PG text[] storage — a nested
 *  array would be a multidimensional PG array with ragged dimensions). */
export function corpusSegmentStrings(title: string, description: string, fields: unknown): string[] {
  return corpusSegments(title, description, fields).map((words) => words.join(" "));
}
