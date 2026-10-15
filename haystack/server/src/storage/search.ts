// Haystack storage: search contract. Summaries only — full documents come
// from get. Pages are live views; cursors bind to (query, scope, limit, sort).
import type { HumanAttention } from "../domain/document.js";
import type { AstNode } from "../query/ast.js";
import type { ItemRepository } from "./repository.js";

export interface SearchSummary {
  readonly project: string;
  readonly item: string;
  readonly revision: number;
  readonly title: string;
  readonly type: string;
  readonly status: string;
  readonly importance: string;
  readonly humanAttention: HumanAttention;
  readonly tags: readonly string[];
  readonly modifiedAt: string;
  readonly modifiedBy: string;
}

export const SEARCH_SORT_FIELDS = [
  "key", "title", "project", "type", "status", "importance",
  "human-attention", "modified-at", "revision",
] as const;

export type SearchSortField = (typeof SEARCH_SORT_FIELDS)[number];

export interface SearchSort {
  readonly field: SearchSortField;
  readonly direction: "asc" | "desc";
}

export const SEARCH_SORT_DEFAULT: SearchSort = { field: "key", direction: "asc" };

export interface SearchPosition {
  readonly project: string;
  readonly item: string;
  readonly value: string | number;
}

export function searchPosition(item: SearchSummary, sort: SearchSort): SearchPosition {
  let value: string | number;
  switch (sort.field) {
    case "key":
    case "project": value = item.project; break;
    case "human-attention": value = item.humanAttention; break;
    case "modified-at": value = item.modifiedAt; break;
    default: value = item[sort.field];
  }
  return { project: item.project, item: item.item, value };
}

/** Literal UTF-8 ordering, matching PostgreSQL COLLATE "C". */
export function compareSearchText(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function compareSearchPositions(a: SearchPosition, b: SearchPosition, sort: SearchSort): number {
  let primary: number;
  if (typeof a.value === "number" && typeof b.value === "number") primary = a.value - b.value;
  else if (typeof a.value === "string" && typeof b.value === "string") {
    primary = sort.field === "modified-at" ? Date.parse(a.value) - Date.parse(b.value) : compareSearchText(a.value, b.value);
  } else throw new Error("search positions must have the same value type");
  const direction = sort.direction === "asc" ? 1 : -1;
  if (primary !== 0) return primary * direction;
  const key = compareSearchText(a.project, b.project) || compareSearchText(a.item, b.item);
  return sort.field === "key" ? key * direction : key;
}

export interface SearchRequest {
  /** Null ast browses (empty query). */
  readonly ast: AstNode | null;
  /** Explicit project scope (intersects predicates). */
  readonly scope?: string;
  readonly limit: number;
  readonly sort: SearchSort;
  /** Saved value and key: no lookup of the (possibly moved/deleted) row. */
  readonly after?: SearchPosition;
}

export interface SearchPage {
  readonly items: SearchSummary[];
  /** Present when more rows may follow. */
  readonly next?: SearchPosition;
}

export type ObservableField = "type" | "status" | "importance" | "tags";

export interface SearchableRepository extends ItemRepository {
  search(request: SearchRequest): Promise<SearchPage>;
  /** Bounded observed values for completion (current items only). */
  observedValues(field: ObservableField): Promise<string[]>;
  /** Bounded qualified-id suggestions for a raw fragment. */
  suggestIds(fragment: string, limit: number): Promise<string[]>;
}

export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 100;
