import { PRESET_ORDER, PRESETS, readBrowseState, type BrowseState, type Preset } from "./browse-state.ts";
import { isSearchHash, readRetrieveState, SEARCH_LABEL, SEARCH_PATH, type RetrieveState } from "./retrieve-state.ts";

// Fragment routes (spec §5): #/<preset>?q=&sort=&direction=, #/search?q=&mode=&project=&archived=, #/item/<key>,
// #/item/<key>/edit. Fragments starting with #account belong to the shared account module and are never routes here.
export type Route =
  | { readonly name: "list"; readonly preset: Preset; readonly hash: string; readonly state: BrowseState }
  | { readonly name: "search"; readonly hash: string; readonly state: RetrieveState }
  | { readonly name: "item"; readonly key: string; readonly edit: boolean; readonly origin: string; readonly known: boolean };

/** The view a record is opened from: a Browse preset or Search. */
export type Origin = Preset | typeof SEARCH_PATH;

const ITEM_PREFIX = "#/item/";
const EDIT_SUFFIX = "/edit";
const ACCOUNT_PREFIX = "#account";
export const DEFAULT_LIST_HASH = "#/browse";

/**
 * In-app history entries of records carry where they were opened from, so that Back returns to that list
 * (with `history.go`, keeping the list entry and its state) and the navigation keeps the preset highlighted.
 * `back` counts the entries above the originating list (0: the list is not in this tab's history);
 * `recordBelow` marks an edit entry pushed from its record page.
 */
interface EntryState { readonly origin: string; readonly back: number; readonly recordBelow: boolean }
const STATE_KEY = "haystack";

function entryState(value: unknown): EntryState | null {
  if (typeof value !== "object" || value === null || !(STATE_KEY in value)) return null;
  const entry: unknown = (value as Record<typeof STATE_KEY, unknown>)[STATE_KEY];
  if (typeof entry !== "object" || entry === null) return null;
  const { origin, back, recordBelow } = entry as Record<string, unknown>;
  if (typeof origin !== "string" || !Number.isSafeInteger(back) || typeof back !== "number" || back < 0 || typeof recordBelow !== "boolean") return null;
  return { origin, back, recordBelow };
}
const entry = (state: EntryState) => ({ [STATE_KEY]: state });

export function isAccountHash(hash: string): boolean { return hash.startsWith(ACCOUNT_PREFIX); }

export function itemHash(key: string, edit: boolean): string {
  return `${ITEM_PREFIX}${encodeURIComponent(key)}${edit ? EDIT_SUFFIX : ""}`;
}

export function presetOf(hash: string): Preset {
  const path = hash.startsWith("#/") ? hash.slice(2).split("?")[0]! : "";
  return PRESET_ORDER.find((preset) => preset === path) ?? "browse";
}

export function originOf(hash: string): Origin { return isSearchHash(hash) ? SEARCH_PATH : presetOf(hash); }
export function originLabel(origin: Origin): string { return origin === SEARCH_PATH ? SEARCH_LABEL : PRESETS[origin].label; }

/** Parses a non-account fragment; `historyState` supplies the originating list of a record entry. */
export function parseRoute(hash: string, historyState: unknown): Route {
  if (isAccountHash(hash)) throw new Error("Account fragments are owned by the account module, not the Haystack router.");
  if (hash.startsWith(ITEM_PREFIX)) {
    const rest = hash.slice(ITEM_PREFIX.length);
    const edit = rest.endsWith(EDIT_SUFFIX);
    const key = decodeURIComponent(edit ? rest.slice(0, -EDIT_SUFFIX.length) : rest);
    const state = entryState(historyState);
    return { name: "item", key, edit, origin: state === null ? DEFAULT_LIST_HASH : state.origin, known: state !== null };
  }
  if (isSearchHash(hash)) return { name: "search", hash, state: readRetrieveState(hash) };
  const preset = presetOf(hash);
  return { name: "list", preset, hash: hash === "" ? DEFAULT_LIST_HASH : hash, state: readBrowseState(hash, preset) };
}

// Navigation that pushes or replaces entries does not fire hashchange: callers re-read the route afterwards.
export function pushItem(key: string, fromList: string): void {
  history.pushState(entry({ origin: fromList, back: 1, recordBelow: false }), "", itemHash(key, false));
}

/**
 * A record reached without an in-app entry (a link in a record, a typed address) keeps the list it was reached
 * from for the highlight and Back; Back then opens that list instead of traversing history.
 */
export function adoptItem(origin: string): void {
  history.replaceState(entry({ origin, back: 0, recordBelow: false }), "", location.hash);
}

export function pushEdit(key: string): void {
  const current = entryState(history.state);
  history.pushState(entry({ origin: current === null ? DEFAULT_LIST_HASH : current.origin, back: current === null || current.back === 0 ? 0 : current.back + 1, recordBelow: true }), "", itemHash(key, true));
}

/** Leaves the edit route for the record: Back when the record entry is right below, else replaces the entry. */
export function closeEdit(key: string): "traversed" | "replaced" {
  const current = entryState(history.state);
  if (current !== null && current.recordBelow) { history.back(); return "traversed"; }
  history.replaceState(entry({ origin: current === null ? DEFAULT_LIST_HASH : current.origin, back: 0, recordBelow: false }), "", itemHash(key, false));
  return "replaced";
}

/** Back from a record: traverses to the originating list entry when it is in this tab's history, else opens it. */
export function leaveItem(): void {
  const current = entryState(history.state);
  if (current !== null && current.back > 0) history.go(-current.back);
  else location.hash = current === null ? DEFAULT_LIST_HASH : current.origin;
}
