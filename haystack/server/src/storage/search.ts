// Haystack storage: search contract. Summaries only — full documents come
// from get. Pages are live views; cursors bind to (query, scope, limit).
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

export interface SearchRequest {
  /** Null ast browses (empty query). */
  readonly ast: AstNode | null;
  /** Explicit project scope (intersects predicates). */
  readonly scope?: string;
  readonly limit: number;
  /** Keyset position: items strictly after this key. */
  readonly after?: { readonly project: string; readonly item: string };
}

export interface SearchPage {
  readonly items: SearchSummary[];
  /** Present when more rows may follow. */
  readonly next?: { readonly project: string; readonly item: string };
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
