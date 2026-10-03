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

export interface PickerState {
	favourites: ModelKey[];
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

export function toggleFavourite(favourites: readonly ModelKey[], key: ModelKey): ModelKey[] {
	return favourites.includes(key) ? favourites.filter((item) => item !== key) : [...favourites, key];
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

export function filterModels(models: readonly ModelRef[], query: string): ModelRef[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...models];
	return models.filter((model) => `${model.provider} ${model.id} ${model.name ?? ""}`.toLowerCase().includes(needle));
}

/**
 * Favourites that are in the current catalog, most recently selected first.
 * Favourites never selected in the dialog keep their stored order at the end.
 */
export function favouriteModels(models: readonly ModelRef[], state: PickerState): ModelRef[] {
	const byKey = new Map(models.map((model) => [modelKey(model), model]));
	return state.favourites
		.flatMap((key) => {
			const model = byKey.get(key);
			return model ? [model] : [];
		})
		.sort((left, right) => selectionAt(state, modelKey(right)) - selectionAt(state, modelKey(left)));
}

/** The state with `key`'s last dialog selection recorded at `at` (epoch milliseconds). */
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
export function parsePickerState(raw: string): PickerState {
	const parsed: unknown = JSON.parse(raw);
	if (!parsed || typeof parsed !== "object") return { favourites: [], selections: [] };
	const { favourites, selections } = parsed as { favourites?: unknown; selections?: unknown };
	return {
		favourites: Array.isArray(favourites) ? favourites.filter(isModelKey) : [],
		selections: Array.isArray(selections) ? selections.filter(isSelection) : [],
	};
}

export function serializePickerState(state: PickerState): string {
	return JSON.stringify({ favourites: state.favourites, selections: state.selections }, null, 2) + "\n";
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
