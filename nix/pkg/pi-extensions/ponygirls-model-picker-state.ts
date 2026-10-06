/** Pure ponygirls-model-picker state. No Pi imports, so the tests can run under node. */

/** Model identity in `provider/id` form. */
export type ModelKey = `${string}/${string}`;

/**
 * Stable identity of a favourite entry, persisted with it. Derived from the
 * entry's key and effort (see `entryIdBase`), with a "#n" suffix when several
 * entries share a key/effort pair — so legacy selection records (keyed by the
 * base) keep matching the first entry with that pair.
 */
export type EntryId = string;

export interface ModelRef {
	provider: string;
	id: string;
	name?: string;
}

/** A favourite entry's recorded dialog-selection time, in epoch milliseconds. */
export interface Selection {
	/** The favourite entry's stable id (`Favourite.id`). */
	key: EntryId;
	at: number;
}

/**
 * A favourited model with an optional pinned effort level (a pi-ai
 * ModelThinkingLevel name). Absent effort means "use the default".
 * The same model key may appear several times with different efforts (or even
 * the same effort), so the stable `id` — not the key/effort pair — identifies
 * an entry: cycling an entry's effort keeps its id, and with it its sort
 * position and its recorded selection time.
 */
export interface Favourite {
	id: EntryId;
	key: ModelKey;
	effort?: string;
}

/** A catalog model resolved from a favourite entry, carrying the entry's id and pinned effort (if any). */
export interface FavouriteModel extends ModelRef {
	/** The favourite entry this row is; absent on All-tab rows, which aggregate a model's entries. */
	entryId?: EntryId;
	effort?: string;
}

export interface PickerState {
	favourites: Favourite[];
	selections: Selection[];
}

export interface Hit {
	line: number;
	start: number;
	end: number;
	action: string;
}

export function modelKey(model: ModelRef): ModelKey {
	return `${model.provider}/${model.id}`;
}

/**
 * The conventional entry id for a key/effort pair: the bare key, or key@effort.
 * Effort names never contain "@", so the form is unambiguous.
 */
export function entryIdBase(favourite: Pick<Favourite, "key" | "effort">): string {
	return favourite.effort === undefined ? favourite.key : `${favourite.key}@${favourite.effort}`;
}

/**
 * A free stable id for a new or legacy entry: its base (see `entryIdBase`), or
 * base#2, base#3… when the base is taken by an equal entry.
 */
export function mintEntryId(favourites: readonly Favourite[], favourite: Pick<Favourite, "key" | "effort">): EntryId {
	const taken = new Set(favourites.map((item) => item.id));
	const base = entryIdBase(favourite);
	if (!taken.has(base)) return base;
	for (let suffix = 2; ; suffix++) {
		const candidate = `${base}#${suffix}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/**
 * Toggle the bare (no-effort) entry for `key`, leaving effort-pinned entries
 * alone: favouriting twice pins nothing twice, and effort variants survive.
 */
export function toggleBareFavourite(favourites: readonly Favourite[], key: ModelKey): Favourite[] {
	const bare = favourites.find((item) => item.key === key && item.effort === undefined);
	return bare === undefined
		? [...favourites, { id: mintEntryId(favourites, { key }), key }]
		: removeFavouriteEntry(favourites, bare.id);
}

/** Remove the entry with `id`; an unknown id leaves the list unchanged. */
export function removeFavouriteEntry(favourites: readonly Favourite[], id: EntryId): Favourite[] {
	const index = favourites.findIndex((item) => item.id === id);
	return index < 0 ? [...favourites] : [...favourites.slice(0, index), ...favourites.slice(index + 1)];
}

/** The effort following `current` in [none, ...levels], wrapping to none; a current effort missing from `levels` (stale catalog) resets to none. */
function nextEffort(current: string | undefined, levels: readonly string[]): string | undefined {
	const order: readonly (string | undefined)[] = [undefined, ...levels];
	return order[(order.indexOf(current) + 1) % order.length];
}

/** Replace the entry at `index` with its next effort, keeping its identity. */
function cycleAt(favourites: readonly Favourite[], index: number, levels: readonly string[]): Favourite[] {
	const current = favourites[index]!;
	const next = nextEffort(current.effort, levels);
	const updated: Favourite = next === undefined ? { id: current.id, key: current.key } : { id: current.id, key: current.key, effort: next };
	return [...favourites.slice(0, index), updated, ...favourites.slice(index + 1)];
}

/** The most recently stored entry for `key`, or undefined when not favourited. */
export function latestEntryForKey(favourites: readonly Favourite[], key: ModelKey): Favourite | undefined {
	for (let index = favourites.length - 1; index >= 0; index--) {
		if (favourites[index]!.key === key) return favourites[index];
	}
	return undefined;
}

/**
 * Advance the entry with `id` to its next effort. The entry keeps its id, so
 * its sort position and selection time are untouched — even when the new
 * effort equals a sibling entry's. An unknown id leaves the state unchanged.
 */
export function cycleFavouriteEntry(state: PickerState, id: EntryId, levels: readonly string[]): PickerState {
	const index = state.favourites.findIndex((item) => item.id === id);
	return index < 0 ? state : { ...state, favourites: cycleAt(state.favourites, index, levels) };
}

/**
 * Advance the most recently stored entry for `key` (All-tab cycling), or append
 * a new entry pinned to the first of `levels` when the model is not favourited.
 * The cycled entry keeps its sort position; an appended one sorts as new.
 */
export function cycleModelEntry(state: PickerState, key: ModelKey, levels: readonly string[]): PickerState {
	if (levels.length === 0) return state;
	for (let index = state.favourites.length - 1; index >= 0; index--) {
		if (state.favourites[index]!.key === key) return { ...state, favourites: cycleAt(state.favourites, index, levels) };
	}
	const effort = levels[0]!;
	return { ...state, favourites: [...state.favourites, { id: mintEntryId(state.favourites, { key, effort }), key, effort }] };
}

/** Selection index after moving `delta` rows across `count` rows, clamped to the list. */
export function moveSelection(selected: number, delta: number, count: number): number {
	const last = Math.max(0, count - 1);
	return Math.min(last, Math.max(0, selected + delta));
}

/** First visible row of a `size`-row window centered on `selected` across `count` rows. */
export function windowStart(selected: number, count: number, size: number): number {
	return Math.max(0, Math.min(selected - Math.floor(size / 2), Math.max(0, count - size)));
}

/** Fallback list rows when the terminal size is unknown (a stub TUI, no tty). */
export const PICKER_FALLBACK_ROWS = 10;
export const PICKER_MIN_ROWS = 5;
export const PICKER_MAX_ROWS = 30;
/** Dialog chrome around the list: overlay margin (2) + border (2) + tabs (1) + filter (1) + hints (2). */
const PICKER_CHROME_ROWS = 8;

/** Model-picker list rows for a terminal height: two thirds for the dialog, less chrome. */
export function pickerVisibleRows(termRows: number | undefined): number {
	if (typeof termRows !== "number" || !Number.isFinite(termRows)) return PICKER_FALLBACK_ROWS;
	return Math.max(PICKER_MIN_ROWS, Math.min(PICKER_MAX_ROWS, Math.floor((termRows * 2) / 3) - PICKER_CHROME_ROWS));
}

export function filterModels<T extends ModelRef>(models: readonly T[], query: string): T[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...models];
	return models.filter((model) => `${model.provider} ${model.id} ${model.name ?? ""}`.toLowerCase().includes(needle));
}

/**
 * Favourite entries that are in the current catalog, most recently selected
 * first. The same model may appear several times with different efforts; each
 * entry keeps its own identity and recency. Entries never selected keep their
 * stored order at the end. A missing catalog entry is omitted but kept in the
 * file.
 */
export function favouriteModels(models: readonly ModelRef[], state: PickerState): FavouriteModel[] {
	const byKey = new Map(models.map((model) => [modelKey(model), model]));
	return state.favourites
		.flatMap((favourite) => {
			const model = byKey.get(favourite.key);
			if (!model) return [];
			const resolved: FavouriteModel = { ...model, entryId: favourite.id };
			if (favourite.effort !== undefined) resolved.effort = favourite.effort;
			return [resolved];
		})
		.sort((left, right) => selectionAt(state, right.entryId!) - selectionAt(state, left.entryId!));
}

/**
 * The state with the entry `id`'s last dialog selection recorded at `at` (epoch
 * milliseconds). Unknown ids are recorded anyway (a bare model key may still
 * be re-favourited later).
 */
export function recordSelection(state: PickerState, id: EntryId, at: number): PickerState {
	return {
		...state,
		selections: [...state.selections.filter((item) => item.key !== id), { key: id, at }],
	};
}

function selectionAt(state: PickerState, id: EntryId): number {
	const found = state.selections.find((item) => item.key === id);
	return found ? found.at : 0;
}

/**
 * Parse persisted state, dropping malformed entries; a missing field yields an
 * empty part. Legacy string favourites ("provider/id") read as bare entries;
 * entries without a persisted id mint one (see `mintEntryId`), so legacy
 * selection records (keyed by key@effort) keep matching the first entry with
 * that pair.
 */
export function parsePickerState(raw: string): PickerState {
	const parsed: unknown = JSON.parse(raw);
	if (!parsed || typeof parsed !== "object") return { favourites: [], selections: [] };
	const { favourites, selections } = parsed as { favourites?: unknown; selections?: unknown };
	return {
		favourites: Array.isArray(favourites) ? parseFavourites(favourites) : [],
		selections: Array.isArray(selections) ? selections.filter(isSelection) : [],
	};
}

export function serializePickerState(state: PickerState): string {
	return JSON.stringify({ favourites: state.favourites.map(normalizeFavourite), selections: state.selections }, null, 2) + "\n";
}

/** Entries with stable ids: persisted ids kept (when free), legacy ones minted from key@effort. */
function parseFavourites(items: readonly unknown[]): Favourite[] {
	const parsed: Favourite[] = [];
	for (const item of items) {
		if (!isFavourite(item)) continue;
		const stored = normalizeFavourite(item);
		const persisted = stored.id;
		const id = persisted !== undefined && !parsed.some((favourite) => favourite.id === persisted) ? persisted : mintEntryId(parsed, stored);
		const normalized: Favourite = { id, key: stored.key };
		if (stored.effort !== undefined) normalized.effort = stored.effort;
		parsed.push(normalized);
	}
	return parsed;
}

/** Effort levels pi-ai defines (ModelThinkingLevel); unknown persisted values are dropped on parse. */
const KNOWN_EFFORTS: ReadonlySet<string> = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** A persisted favourite entry: with its id once minted, or without one (legacy). */
type StoredFavourite = Omit<Favourite, "id"> & { id?: EntryId };

function isFavourite(item: unknown): item is StoredFavourite | ModelKey {
	if (typeof item === "string") return isModelKey(item);
	if (!item || typeof item !== "object") return false;
	const { id, key, effort } = item as { id?: unknown; key?: unknown; effort?: unknown };
	if (!isModelKey(key)) return false;
	if (id !== undefined && (typeof id !== "string" || id.length === 0)) return false;
	return effort === undefined || (typeof effort === "string" && KNOWN_EFFORTS.has(effort));
}

function normalizeFavourite(item: StoredFavourite | ModelKey): StoredFavourite {
	if (typeof item === "string") return { key: item };
	const normalized: StoredFavourite = item.id === undefined ? { key: item.key } : { id: item.id, key: item.key };
	if (item.effort !== undefined) normalized.effort = item.effort;
	return normalized;
}

function isModelKey(item: unknown): item is ModelKey {
	return typeof item === "string" && item.includes("/");
}

function isSelection(item: unknown): item is Selection {
	if (!item || typeof item !== "object") return false;
	const { key, at } = item as { key?: unknown; at?: unknown };
	return isModelKey(key) && typeof at === "number" && Number.isFinite(at);
}

export function hitAt(hits: readonly Hit[], x: number, y: number): Hit | undefined {
	return hits.find((hit) => hit.line === y && x >= hit.start && x < hit.end);
}

/** Cells consumed by "│ " on the left and " │" on the right. */
export const OUTLINE_INSET_X = 2;
export const OUTLINE_INSET_Y = 1;

/** Map a click on an outlined component to the inner content, or undefined if it landed on the frame. */
export function outlineContentPoint(
	x: number,
	y: number,
	width: number,
	bodyHeight: number,
): { x: number; y: number } | undefined {
	if (width < OUTLINE_INSET_X * 2 || bodyHeight < 0) return undefined;
	if (y < OUTLINE_INSET_Y || y >= OUTLINE_INSET_Y + bodyHeight) return undefined;
	if (x < OUTLINE_INSET_X || x >= width - OUTLINE_INSET_X) return undefined;
	return { x: x - OUTLINE_INSET_X, y: y - OUTLINE_INSET_Y };
}

const FILTER_CHARS: Readonly<Record<string, string>> = {
	hyphen: "-",
	slash: "/",
	period: ".",
	underscore: "_",
	colon: ":",
};

/** A search character from a pi-tui key id, or undefined for chords and commands. */
export function filterChar(key: string | undefined): string | undefined {
	if (!key || key.includes("+")) return undefined;
	if (/^[a-z0-9]$/.test(key)) return key;
	return FILTER_CHARS[key];
}
