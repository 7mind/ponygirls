import type { SearchSort, SearchSortField } from "./api";

export type ArchiveMode = "hide" | "show" | "only";
export interface BrowseState {
  query: string;
  project: string;
  archive: ArchiveMode;
  tag: string;
  sort: SearchSort;
}

export const DEFAULT_SORT: SearchSort = { field: "modified-at", direction: "desc" };
const SORT_FIELDS: readonly SearchSortField[] = ["key", "title", "project", "type", "status", "importance", "human-attention", "modified-at", "revision"];

export function readBrowseState(hash: string, inbox: boolean): BrowseState {
  const start = hash.indexOf("?");
  const params = new URLSearchParams(start === -1 ? "" : hash.slice(start + 1));
  const archive = params.get("archive");
  const candidate = params.get("sort");
  const field = SORT_FIELDS.find((field) => field === candidate) ?? DEFAULT_SORT.field;
  const direction = params.get("direction");
  return {
    query: params.get("q") ?? (inbox ? "human-attention:required" : ""),
    project: params.get("project") ?? "",
    archive: archive === "show" || archive === "only" ? archive : "hide",
    tag: params.get("tag") ?? "",
    sort: { field, direction: direction === "asc" || direction === "desc" ? direction : field === "modified-at" || field === "revision" ? "desc" : "asc" },
  };
}

export function browseHash(state: BrowseState, inbox: boolean): string {
  const params = new URLSearchParams();
  if (state.query !== (inbox ? "human-attention:required" : "")) params.set("q", state.query);
  if (state.project !== "") params.set("project", state.project);
  if (state.archive !== "hide") params.set("archive", state.archive);
  if (state.tag.trim() !== "") params.set("tag", state.tag.trim());
  if (state.sort.field !== DEFAULT_SORT.field || state.sort.direction !== DEFAULT_SORT.direction) {
    params.set("sort", state.sort.field);
    params.set("direction", state.sort.direction);
  }
  return `${inbox ? "#/inbox" : "#/browse"}${params.size > 0 ? `?${params.toString()}` : ""}`;
}

export function sameBrowseState(left: BrowseState, right: BrowseState): boolean {
  return left.query === right.query && left.project === right.project && left.archive === right.archive && left.tag === right.tag && left.sort.field === right.sort.field && left.sort.direction === right.sort.direction;
}
