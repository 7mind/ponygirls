/** Pure model-picker state. No Pi imports, so the tests can run under node. */

/** Model identity in `provider/id` form. */
export type ModelKey = `${string}/${string}`;

export interface ModelRef {
	provider: string;
	id: string;
	name?: string;
}

/** A model's recorded dialog-selection time, in epoch milliseconds. */
export interface Selection {
	key: ModelKey;
	at: number;
}

/**
 * A favourited model with an optional pinned effort level (a pi-ai
 * ModelThinkingLevel name). Absent effort means "use the default".
 * The same model key may appear several times with different efforts.
 */
export interface Favourite {
	key: ModelKey;
	effort?: string;
}

/** A catalog model resolved from a favourite entry, carrying the pinned effort (if any). */
export interface FavouriteModel extends ModelRef {
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
 * Stable identity of a favourite entry: the bare key, or key@effort.
 * Effort names never contain "@", so the form is unambiguous; the result
 * still satisfies ModelKey, so it doubles as a selection key (legacy
 * model-only selections keep matching bare entries).
 */
export function favouriteId(favourite: Favourite): ModelKey {
	return (favourite.effort ? `${favourite.key}@${favourite.effort}` : favourite.key) as ModelKey;
}

/**
 * Toggle the bare (no-effort) entry for `key`, leaving effort-pinned entries
 * alone: favouriting twice pins nothing twice, and effort variants survive.
 */
export function toggleBareFavourite(favourites: readonly Favourite[], key: ModelKey): Favourite[] {
	return favourites.some((item) => item.key === key && item.effort === undefined)
		? favourites.filter((item) => item.key !== key || item.effort !== undefined)
		: [...favourites, { key }];
}

/** Remove the first entry equal to `entry` (same key and effort). */
export function removeFavouriteEntry(favourites: readonly Favourite[], entry: Favourite): Favourite[] {
	const index = favourites.findIndex((item) => item.key === entry.key && item.effort === entry.effort);
	return index < 0 ? [...favourites] : [...favourites.slice(0, index), ...favourites.slice(index + 1)];
}

/** The effort following `current` in [none, ...levels], wrapping to none; a current effort missing from `levels` (stale catalog) resets to none. */
function nextEffort(current: string | undefined, levels: readonly string[]): string | undefined {
	const order: readonly (string | undefined)[] = [undefined, ...levels];
	return order[(order.indexOf(current) + 1) % order.length];
}

/** Replace the entry at `index` with its next effort. */
function cycleAt(favourites: readonly Favourite[], index: number, levels: readonly string[]): Favourite[] {
	const current = favourites[index]!;
	const next = nextEffort(current.effort, levels);
	const updated: Favourite = next === undefined ? { key: current.key } : { key: current.key, effort: next };
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
 * Move the selection timestamp from one favourite id to another, so a cycled
 * entry keeps its sort position instead of dropping as "never selected".
 * Collisions merge with max; an absent source leaves the log unchanged.
 */
export function transferSelection(selections: readonly Selection[], from: ModelKey, to: ModelKey): Selection[] {
	if (from === to) return [...selections];
	const at = Math.max(
		selections.find((item) => item.key === from)?.at ?? 0,
		selections.find((item) => item.key === to)?.at ?? 0,
	);
	const rest = selections.filter((item) => item.key !== from && item.key !== to);
	return at > 0 ? [...rest, { key: to, at }] : rest;
}

/** Cycle the entry at `index`, carrying its selection timestamp to the new id. */
function cycleIndex(state: PickerState, index: number, levels: readonly string[]): PickerState {
	const entry = state.favourites[index]!;
	const favourites = cycleAt(state.favourites, index, levels);
	const updated = favourites[index]!;
	return {
		favourites,
		selections: transferSelection(state.selections, favouriteId(entry), favouriteId(updated)),
	};
}

/**
 * Advance the first entry equal to `entry` to its next effort, keeping its
 * sort position. An unknown entry leaves the state unchanged. (Equal
 * duplicates are interchangeable.)
 */
export function cycleFavouriteEntry(state: PickerState, entry: Favourite, levels: readonly string[]): PickerState {
	const index = state.favourites.findIndex((item) => item.key === entry.key && item.effort === entry.effort);
	return index < 0 ? state : cycleIndex(state, index, levels);
}

/**
 * Advance the most recently stored entry for `key` (All-tab cycling), or append
 * a new entry pinned to the first of `levels` when the model is not favourited.
 * The cycled entry keeps its sort position; an appended one sorts as new.
 */
export function cycleModelEntry(state: PickerState, key: ModelKey, levels: readonly string[]): PickerState {
	if (levels.length === 0) return state;
	for (let index = state.favourites.length - 1; index >= 0; index--) {
		if (state.favourites[index]!.key === key) return cycleIndex(state, index, levels);
	}
	return { ...state, favourites: [...state.favourites, { key, effort: levels[0]! }] };
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

export function filterModels<T extends ModelRef>(models: readonly T[], query: string): T[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...models];
	return models.filter((model) => `${model.provider} ${model.id} ${model.name ?? ""}`.toLowerCase().includes(needle));
}

/**
 * Favourite entries that are in the current catalog, most recently selected
 * first. The same model may appear several times with different efforts;
 * recency is tracked per entry id. Entries never selected keep their stored
 * order at the end. A missing catalog entry is omitted but kept in the file.
 */
export function favouriteModels(models: readonly ModelRef[], state: PickerState): FavouriteModel[] {
	const byKey = new Map(models.map((model) => [modelKey(model), model]));
	return state.favourites
		.flatMap((favourite) => {
			const model = byKey.get(favourite.key);
			if (!model) return [];
			const resolved: FavouriteModel = { ...model };
			if (favourite.effort !== undefined) resolved.effort = favourite.effort;
			return [resolved];
		})
		.sort((left, right) => selectionAt(state, resolvedId(right)) - selectionAt(state, resolvedId(left)));
}

function resolvedId(model: FavouriteModel): ModelKey {
	return favouriteId({ key: modelKey(model), effort: model.effort });
}

/**
 * The state with `key`'s last dialog selection recorded at `at` (epoch milliseconds).
 * `key` is a favourite id: a bare model key, or key@effort for a pinned entry.
 */
export function recordSelection(state: PickerState, key: ModelKey, at: number): PickerState {
	return {
		...state,
		selections: [...state.selections.filter((item) => item.key !== key), { key, at }],
	};
}

function selectionAt(state: PickerState, key: ModelKey): number {
	const found = state.selections.find((item) => item.key === key);
	return found ? found.at : 0;
}

/** Parse persisted state, dropping malformed entries; a missing field yields an empty part. */
/**
 * Parse persisted state, dropping malformed entries; a missing field yields an
 * empty part. Legacy string favourites ("provider/id") read as bare entries.
 */
export function parsePickerState(raw: string): PickerState {
	const parsed: unknown = JSON.parse(raw);
	if (!parsed || typeof parsed !== "object") return { favourites: [], selections: [] };
	const { favourites, selections } = parsed as { favourites?: unknown; selections?: unknown };
	return {
		favourites: Array.isArray(favourites) ? favourites.filter(isFavourite).map(normalizeFavourite) : [],
		selections: Array.isArray(selections) ? selections.filter(isSelection) : [],
	};
}

export function serializePickerState(state: PickerState): string {
	return JSON.stringify({ favourites: state.favourites.map(normalizeFavourite), selections: state.selections }, null, 2) + "\n";
}

/** Effort levels pi-ai defines (ModelThinkingLevel); unknown persisted values are dropped on parse. */
const KNOWN_EFFORTS: ReadonlySet<string> = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function isFavourite(item: unknown): item is Favourite | ModelKey {
	if (typeof item === "string") return isModelKey(item);
	if (!item || typeof item !== "object") return false;
	const { key, effort } = item as { key?: unknown; effort?: unknown };
	if (!isModelKey(key)) return false;
	return effort === undefined || (typeof effort === "string" && KNOWN_EFFORTS.has(effort));
}

function normalizeFavourite(item: Favourite | ModelKey): Favourite {
	if (typeof item === "string") return { key: item };
	return item.effort === undefined ? { key: item.key } : { key: item.key, effort: item.effort };
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
