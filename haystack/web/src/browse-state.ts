import type { SearchSort, SearchSortField } from "./api";
import { appendFilter } from "./query-edit.ts";

export interface BrowseState {
  query: string;
  sort: SearchSort;
  migrationError: string | null;
}

export const DEFAULT_SORT: SearchSort = { field: "modified-at", direction: "desc" };
const SORT_FIELDS: readonly SearchSortField[] = ["key", "title", "project", "type", "status", "importance", "human-attention", "modified-at", "revision"];
const MIGRATION_ERROR = "Cannot safely migrate legacy URL filters into this query. No search was run. Open Browse to reset, or complete the query in the original URL.";

export function readBrowseState(hash: string, inbox: boolean): BrowseState {
  const start = hash.indexOf("?");
  const params = new URLSearchParams(start === -1 ? "" : hash.slice(start + 1));
  const original = params.get("q") ?? (inbox ? "human-attention:required" : "");
  const project = (params.get("project") ?? "").trim();
  const tag = (params.get("tag") ?? "").trim();
  const archive = params.get("archive");
  const filters = [
    { field: "project", value: project },
    { field: "tag", value: tag },
    { field: "archived", value: archive === "show" ? "all" : archive === "only" ? "true" : "" },
  ].filter(({ value }) => value !== "");
  let query = original;
  let migrationError: string | null = null;
  for (const { field, value } of filters) {
    const next = appendFilter(query, field, value);
    if (next === null) { query = original; migrationError = MIGRATION_ERROR; break; }
    query = next;
  }
  const candidate = params.get("sort");
  const field = SORT_FIELDS.find((field) => field === candidate) ?? DEFAULT_SORT.field;
  const direction = params.get("direction");
  return {
    query, migrationError,
    sort: { field, direction: direction === "asc" || direction === "desc" ? direction : field === "modified-at" || field === "revision" ? "desc" : "asc" },
  };
}

export function browseHash(state: BrowseState, inbox: boolean): string {
  if (state.migrationError !== null) throw new Error("Cannot serialize a failed legacy URL migration.");
  const params = new URLSearchParams();
  if (state.query !== (inbox ? "human-attention:required" : "")) params.set("q", state.query);
  if (state.sort.field !== DEFAULT_SORT.field || state.sort.direction !== DEFAULT_SORT.direction) {
    params.set("sort", state.sort.field);
    params.set("direction", state.sort.direction);
  }
  return `${inbox ? "#/inbox" : "#/browse"}${params.size > 0 ? `?${params.toString()}` : ""}`;
}

export function sameBrowseState(left: BrowseState, right: BrowseState): boolean {
  return left.query === right.query && left.migrationError === right.migrationError && left.sort.field === right.sort.field && left.sort.direction === right.sort.direction;
}
