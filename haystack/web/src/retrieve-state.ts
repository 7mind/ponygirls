// Ranked search (`POST /api/v1/retrieve`) next to Browse: its route state and the client default rule of
// haystack/docs/api.md ("Client default rule"). Pure: no network, no React.

/** The generated `RetrievalMode` values. */
export type RetrievalModeName = "Lexical" | "Semantic" | "Hybrid";
export const MODES: readonly RetrievalModeName[] = ["Lexical", "Semantic", "Hybrid"];

export const SEARCH_PATH = "search";
export const SEARCH_LABEL = "Search";
const SEARCH_HASH = `#/${SEARCH_PATH}`;
const MODE_PARAMS: Readonly<Record<RetrievalModeName, string>> = { Lexical: "lexical", Semantic: "semantic", Hybrid: "hybrid" };
const ARCHIVED_PARAM_VALUE = "true";

/** `mode` null: no explicit mode, the default rule chooses (C2). `project` "": every project. */
export interface RetrieveState {
  readonly query: string;
  readonly mode: RetrievalModeName | null;
  readonly project: string;
  readonly includeArchived: boolean;
}

export function isSearchHash(hash: string): boolean {
  return hash === SEARCH_HASH || hash.startsWith(`${SEARCH_HASH}?`);
}

/** `#/search?q=&mode=&project=&archived=`; an unknown mode value is no explicit mode. */
export function readRetrieveState(hash: string): RetrieveState {
  const start = hash.indexOf("?");
  const params = new URLSearchParams(start === -1 ? "" : hash.slice(start + 1));
  const mode = MODES.find((candidate) => MODE_PARAMS[candidate] === params.get("mode")) ?? null;
  return { query: params.get("q") ?? "", mode, project: params.get("project") ?? "", includeArchived: params.get("archived") === ARCHIVED_PARAM_VALUE };
}

export function retrieveHash(state: RetrieveState): string {
  const params = new URLSearchParams();
  if (state.query !== "") params.set("q", state.query);
  if (state.mode !== null) params.set("mode", MODE_PARAMS[state.mode]);
  if (state.project !== "") params.set("project", state.project);
  if (state.includeArchived) params.set("archived", ARCHIVED_PARAM_VALUE);
  return params.size > 0 ? `${SEARCH_HASH}?${params.toString()}` : SEARCH_HASH;
}

export function sameRetrieveState(left: RetrieveState, right: RetrieveState): boolean {
  return left.query === right.query && left.mode === right.mode && left.project === right.project && left.includeArchived === right.includeArchived;
}

/** The closed set of fixed 503 `unavailable` messages of semantic/hybrid retrieval (haystack/docs/api.md). */
export const NOT_CONFIGURED = "semantic retrieval is not configured; lexical-only capability";
export const EMBEDDING_FAILED = "query embedding failed";
export const UNAVAILABLE_REASONS: readonly string[] = [NOT_CONFIGURED, EMBEDDING_FAILED];

export const lexicalNotice = (reason: string) => `Hybrid search is not available on this server: ${reason}; showing lexical results`;
export const pendingNotice = (pending: number) =>
  `${pending} ${pending === 1 ? "item is" : "items are"} not yet indexed for semantic search; results may be incomplete`;

/** The mode a search requests: `defaulted` when no explicit mode was given (only a defaulted hybrid may fall back). */
export interface Plan { readonly mode: RetrievalModeName; readonly defaulted: boolean; readonly notice: string | null }

/** An explicit mode is never substituted; without one, hybrid when offered, else lexical with the notice. */
export function planSearch(explicit: RetrievalModeName | null, offered: readonly RetrievalModeName[]): Plan {
  if (explicit !== null) return { mode: explicit, defaulted: false, notice: null };
  if (offered.includes("Hybrid")) return { mode: "Hybrid", defaulted: true, notice: null };
  return { mode: "Lexical", defaulted: true, notice: lexicalNotice(NOT_CONFIGURED) };
}

/** What a typed `unavailable` answer leads to: one lexical re-run for a defaulted hybrid, otherwise the refusal. */
export type Fallback = { readonly kind: "lexical"; readonly notice: string } | { readonly kind: "unavailable"; readonly reason: string };

export function afterUnavailable(plan: Plan, reason: string): Fallback {
  if (!UNAVAILABLE_REASONS.includes(reason)) throw new Error(`not a retrieval unavailability reason: ${reason}`);
  return plan.defaulted && plan.mode === "Hybrid" ? { kind: "lexical", notice: lexicalNotice(reason) } : { kind: "unavailable", reason };
}

/** Offset of the next page, or null at the end: the exact matches, or the ranking window of semantic/hybrid. */
export function nextOffset(offset: number, limit: number, total: number, rankingLimit: number | undefined): number | null {
  const next = offset + limit;
  return next >= total || (rankingLimit !== undefined && next >= rankingLimit) ? null : next;
}
