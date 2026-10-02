/** Pure model-picker state. No Pi imports, so the tests can run under node. */

export interface ModelRef {
	provider: string;
	id: string;
	name?: string;
}

export interface Hit {
	line: number;
	start: number;
	end: number;
	action: string;
}

export function modelKey(model: ModelRef): string {
	return `${model.provider}/${model.id}`;
}

export function toggleFavourite(favourites: readonly string[], key: string): string[] {
	return favourites.includes(key) ? favourites.filter((item) => item !== key) : [...favourites, key];
}

export function filterModels(models: readonly ModelRef[], query: string): ModelRef[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...models];
	return models.filter((model) => `${model.provider} ${model.id} ${model.name ?? ""}`.toLowerCase().includes(needle));
}

/** Favourites in stored order, skipping keys that are not in the current catalog. */
export function favouriteModels(models: readonly ModelRef[], favourites: readonly string[]): ModelRef[] {
	const byKey = new Map(models.map((model) => [modelKey(model), model]));
	return favourites.flatMap((key) => {
		const model = byKey.get(key);
		return model ? [model] : [];
	});
}

export function parseFavourites(raw: string): string[] {
	const parsed: unknown = JSON.parse(raw);
	if (!parsed || typeof parsed !== "object" || !("favourites" in parsed)) return [];
	const favourites = (parsed as { favourites?: unknown }).favourites;
	if (!Array.isArray(favourites)) return [];
	return favourites.filter((item): item is string => typeof item === "string" && item.includes("/"));
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
