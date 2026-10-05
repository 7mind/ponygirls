import assert from "node:assert/strict";
import test from "node:test";

import {
	cycleFavouriteEntry,
	cycleModelEntry,
	entryIdBase,
	mintEntryId,
	favouriteModels,
	filterChar,
	filterModels,
	hitAt,
	latestEntryForKey,
	modelKey,
	moveSelection,
	outlineContentPoint,
	parsePickerState,
	pickerVisibleRows,
	recordSelection,
	removeFavouriteEntry,
	serializePickerState,
	toggleBareFavourite,
	windowStart,
	type Favourite,
	type PickerState,
} from "./model-picker-state.ts";

const models = [
	{ provider: "anthropic", id: "claude-sonnet", name: "Sonnet" },
	{ provider: "openai", id: "gpt-5", name: "GPT" },
];

/** Display rows as `provider/id[@effort]`, in picker order. */
const rowLabels = (state: PickerState) =>
	favouriteModels(models, state).map((model) => `${modelKey(model)}${model.effort ? `@${model.effort}` : ""}`);

test("modelKey joins provider and id", () => {
	assert.equal(modelKey(models[0]!), "anthropic/claude-sonnet");
});

test("entryIdBase is the bare key, or key@effort when pinned", () => {
	assert.equal(entryIdBase({ key: "a/b" }), "a/b");
	assert.equal(entryIdBase({ key: "a/b", effort: "high" }), "a/b@high");
});

test("mintEntryId uses the base and suffixes equal duplicates", () => {
	const duplicates: Favourite[] = [
		{ id: "a/b@high", key: "a/b", effort: "high" },
		{ id: "a/b@high#2", key: "a/b", effort: "high" },
	];
	assert.equal(mintEntryId([], { key: "a/b" }), "a/b");
	assert.equal(mintEntryId(duplicates, { key: "a/b", effort: "low" }), "a/b@low");
	assert.equal(mintEntryId(duplicates, { key: "a/b", effort: "high" }), "a/b@high#3");
	assert.equal(mintEntryId([{ id: "a/b", key: "a/b", effort: "high" }], { key: "a/b" }), "a/b#2");
});

test("toggleBareFavourite adds then removes the bare entry", () => {
	const added = toggleBareFavourite([], "anthropic/claude-sonnet");
	assert.deepEqual(added, [{ id: "anthropic/claude-sonnet", key: "anthropic/claude-sonnet" }]);
	assert.deepEqual(toggleBareFavourite(added, "anthropic/claude-sonnet"), []);
});

test("toggleBareFavourite leaves effort-pinned entries alone", () => {
	const pinned: Favourite[] = [{ id: "a/b@high", key: "a/b", effort: "high" }];
	assert.deepEqual(toggleBareFavourite(pinned, "a/b"), [
		{ id: "a/b@high", key: "a/b", effort: "high" },
		{ id: "a/b", key: "a/b" },
	]);
	const both: Favourite[] = [
		{ id: "a/b@high", key: "a/b", effort: "high" },
		{ id: "a/b", key: "a/b" },
	];
	assert.deepEqual(toggleBareFavourite(both, "a/b"), [{ id: "a/b@high", key: "a/b", effort: "high" }]);
});

test("removeFavouriteEntry removes exactly the entry with the given id", () => {
	const state: Favourite[] = [
		{ id: "a/b@high", key: "a/b", effort: "high" },
		{ id: "a/b", key: "a/b" },
		{ id: "a/b@high#2", key: "a/b", effort: "high" },
	];
	assert.deepEqual(removeFavouriteEntry(state, "a/b@high#2"), [state[0]!, state[1]!]);
	assert.deepEqual(removeFavouriteEntry(state, "a/b@high"), [state[1]!, state[2]!]);
	assert.deepEqual(removeFavouriteEntry(state, "unknown"), state);
	assert.deepEqual(removeFavouriteEntry([], "a/b"), []);
});

test("cycleFavouriteEntry advances through [none, ...levels] and wraps", () => {
	const levels = ["off", "low", "high"];
	const start: PickerState = { favourites: [{ id: "x", key: "a/b" }], selections: [] };
	const once = cycleFavouriteEntry(start, "x", levels);
	assert.deepEqual(once.favourites, [{ id: "x", key: "a/b", effort: "off" }]);
	const twice = cycleFavouriteEntry(once, "x", levels);
	assert.deepEqual(twice.favourites, [{ id: "x", key: "a/b", effort: "low" }]);
	const thrice = cycleFavouriteEntry(twice, "x", levels);
	assert.deepEqual(thrice.favourites, [{ id: "x", key: "a/b", effort: "high" }]);
	assert.deepEqual(cycleFavouriteEntry(thrice, "x", levels).favourites, [{ id: "x", key: "a/b" }]);
});

test("cycleFavouriteEntry resets a stale effort to none and ignores unknown ids", () => {
	const start: PickerState = { favourites: [{ id: "x", key: "a/b", effort: "max" }], selections: [] };
	assert.deepEqual(cycleFavouriteEntry(start, "x", ["off", "low"]).favourites, [{ id: "x", key: "a/b" }]);
	assert.deepEqual(cycleFavouriteEntry(start, "unknown", ["off"]), start);
	assert.deepEqual(cycleFavouriteEntry({ favourites: [], selections: [] }, "x", ["off"]).favourites, []);
});

test("cycleFavouriteEntry targets the given id among equal duplicates", () => {
	const levels = ["low", "medium", "high"];
	const start: PickerState = {
		favourites: [
			{ id: "first", key: "a/b", effort: "medium" },
			{ id: "second", key: "a/b", effort: "medium" },
		],
		selections: [],
	};
	assert.deepEqual(cycleFavouriteEntry(start, "second", levels).favourites, [
		{ id: "first", key: "a/b", effort: "medium" },
		{ id: "second", key: "a/b", effort: "high" },
	]);
	assert.deepEqual(cycleFavouriteEntry(start, "first", levels).favourites, [
		{ id: "first", key: "a/b", effort: "high" },
		{ id: "second", key: "a/b", effort: "medium" },
	]);
});

test("cycleModelEntry appends the first level for unfavourited models", () => {
	const empty: PickerState = { favourites: [], selections: [] };
	assert.deepEqual(cycleModelEntry(empty, "a/b", ["off", "high"]).favourites, [{ id: "a/b@off", key: "a/b", effort: "off" }]);
	assert.deepEqual(cycleModelEntry(empty, "a/b", []), empty);
});

test("cycleModelEntry advances the most recently stored entry", () => {
	const start: PickerState = {
		favourites: [
			{ id: "a/b", key: "a/b" },
			{ id: "a/b@low", key: "a/b", effort: "low" },
		],
		selections: [],
	};
	assert.deepEqual(cycleModelEntry(start, "a/b", ["off", "low", "high"]).favourites, [
		{ id: "a/b", key: "a/b" },
		{ id: "a/b@low", key: "a/b", effort: "high" },
	]);
});

test("cycleModelEntry replaces the latest occurrence, not the first equal one", () => {
	const start: PickerState = {
		favourites: [
			{ id: "one", key: "a/b", effort: "off" },
			{ id: "two", key: "a/b", effort: "low" },
			{ id: "three", key: "a/b", effort: "off" },
		],
		selections: [],
	};
	assert.deepEqual(cycleModelEntry(start, "a/b", ["off", "low"]).favourites, [
		{ id: "one", key: "a/b", effort: "off" },
		{ id: "two", key: "a/b", effort: "low" },
		{ id: "three", key: "a/b", effort: "low" },
	]);
});

test("latestEntryForKey returns the most recently stored entry", () => {
	const state: Favourite[] = [
		{ id: "one", key: "a/b", effort: "off" },
		{ id: "two", key: "c/d" },
		{ id: "three", key: "a/b", effort: "low" },
	];
	assert.deepEqual(latestEntryForKey(state, "a/b"), { id: "three", key: "a/b", effort: "low" });
	assert.deepEqual(latestEntryForKey(state, "c/d"), { id: "two", key: "c/d" });
	assert.equal(latestEntryForKey(state, "e/f"), undefined);
	assert.equal(latestEntryForKey([], "a/b"), undefined);
});

test("cycling a selected-first entry keeps it first and the log untouched", () => {
	const state: PickerState = {
		favourites: [
			{ id: "gpt", key: "openai/gpt-5" },
			{ id: "sonnet", key: "anthropic/claude-sonnet" },
		],
		selections: [
			{ key: "gpt", at: 100 },
			{ key: "sonnet", at: 50 },
		],
	};
	assert.deepEqual(rowLabels(state), ["openai/gpt-5", "anthropic/claude-sonnet"]);
	const cycled = cycleFavouriteEntry(state, "gpt", ["off", "low"]);
	assert.deepEqual(rowLabels(cycled), ["openai/gpt-5@off", "anthropic/claude-sonnet"]);
	assert.deepEqual(cycled.selections, state.selections);
});

test("cycling keeps the entry at its stored position", () => {
	const state: PickerState = {
		favourites: [
			{ id: "gpt", key: "openai/gpt-5" },
			{ id: "sonnet", key: "anthropic/claude-sonnet" },
		],
		selections: [{ key: "sonnet", at: 2_000 }],
	};
	const before = favouriteModels(models, state).map(modelKey);
	const cycled = cycleFavouriteEntry(state, "gpt", ["off", "low"]);
	assert.deepEqual(favouriteModels(models, cycled).map(modelKey), before);
});

test("cycling into a sibling's effort keeps the display order", () => {
	const state: PickerState = {
		favourites: [
			{ id: "openai/gpt-5@medium", key: "openai/gpt-5", effort: "medium" },
			{ id: "openai/gpt-5@high", key: "openai/gpt-5", effort: "high" },
			{ id: "anthropic/claude-sonnet", key: "anthropic/claude-sonnet" },
		],
		selections: [
			{ key: "openai/gpt-5@high", at: 100 },
			{ key: "anthropic/claude-sonnet", at: 75 },
			{ key: "openai/gpt-5@medium", at: 50 },
		],
	};
	assert.deepEqual(rowLabels(state), ["openai/gpt-5@high", "anthropic/claude-sonnet", "openai/gpt-5@medium"]);
	// The row-2 entry cycles "medium" to "high", landing on the row-1 entry's
	// effort. It must stay at row 2: no jump into the place of the first.
	const cycled = cycleFavouriteEntry(state, "openai/gpt-5@medium", ["low", "medium", "high"]);
	assert.deepEqual(rowLabels(cycled), ["openai/gpt-5@high", "anthropic/claude-sonnet", "openai/gpt-5@high"]);
});

const equalDuplicates: PickerState = {
	favourites: [
		{ id: "openai/gpt-5@high", key: "openai/gpt-5", effort: "high" },
		{ id: "openai/gpt-5@high#2", key: "openai/gpt-5", effort: "high" },
		{ id: "anthropic/claude-sonnet", key: "anthropic/claude-sonnet" },
	],
	selections: [
		{ key: "openai/gpt-5@high", at: 100 },
		{ key: "openai/gpt-5@high#2", at: 100 },
		{ key: "anthropic/claude-sonnet", at: 75 },
	],
};

test("cycling one of two equal entries leaves the sibling in place", () => {
	assert.deepEqual(rowLabels(equalDuplicates), ["openai/gpt-5@high", "openai/gpt-5@high", "anthropic/claude-sonnet"]);
	// Cycling the first of the two equal entries must not steal the sibling's
	// sort position: the second entry stays put and the third row keeps its
	// place below both.
	const cycled = cycleFavouriteEntry(equalDuplicates, "openai/gpt-5@high", ["low", "medium", "high", "xhigh"]);
	assert.deepEqual(rowLabels(cycled), ["openai/gpt-5@xhigh", "openai/gpt-5@high", "anthropic/claude-sonnet"]);
});

test("cycling the second of two equal entries keeps every row in place", () => {
	const cycled = cycleFavouriteEntry(equalDuplicates, "openai/gpt-5@high#2", ["low", "medium", "high", "xhigh"]);
	assert.deepEqual(rowLabels(cycled), ["openai/gpt-5@high", "openai/gpt-5@xhigh", "anthropic/claude-sonnet"]);
});

test("favouriteModels tracks recency per entry, not per effort", () => {
	const state: PickerState = {
		favourites: [
			{ id: "first", key: "openai/gpt-5", effort: "high" },
			{ id: "second", key: "openai/gpt-5", effort: "high" },
		],
		selections: [{ key: "second", at: 1_000 }],
	};
	assert.deepEqual(favouriteModels(models, state).map((model) => model.entryId), ["second", "first"]);
	const selected = recordSelection(state, "first", 2_000);
	assert.deepEqual(favouriteModels(models, selected).map((model) => model.entryId), ["first", "second"]);
});

test("filterModels matches provider, id, or name", () => {
	assert.deepEqual(filterModels(models, "gpt").map(modelKey), ["openai/gpt-5"]);
	assert.deepEqual(filterModels(models, "  ").map(modelKey), models.map(modelKey));
});

test("filterModels preserves the entry subtype", () => {
	const entries = [
		{ ...models[0]!, effort: "high" },
		{ ...models[1]! },
	];
	assert.deepEqual(filterModels(entries, "sonnet"), [{ ...models[0]!, effort: "high" }]);
});

test("favouriteModels keeps stored order and drops missing keys when never selected", () => {
	const state: PickerState = {
		favourites: [
			{ id: "openai/gpt-5", key: "openai/gpt-5" },
			{ id: "missing/model", key: "missing/model" },
			{ id: "anthropic/claude-sonnet", key: "anthropic/claude-sonnet" },
		],
		selections: [],
	};
	assert.deepEqual(rowLabels(state), ["openai/gpt-5", "anthropic/claude-sonnet"]);
});

test("favouriteModels keeps duplicate models with different efforts", () => {
	const state: PickerState = {
		favourites: [
			{ id: "openai/gpt-5", key: "openai/gpt-5" },
			{ id: "openai/gpt-5@high", key: "openai/gpt-5", effort: "high" },
		],
		selections: [],
	};
	assert.deepEqual(rowLabels(state), ["openai/gpt-5", "openai/gpt-5@high"]);
});

test("favouriteModels sorts by most recent per-entry selection, then stored order", () => {
	const state: PickerState = {
		favourites: [
			{ id: "openai/gpt-5", key: "openai/gpt-5" },
			{ id: "anthropic/claude-sonnet", key: "anthropic/claude-sonnet" },
			{ id: "missing/model", key: "missing/model" },
		],
		selections: [
			{ key: "anthropic/claude-sonnet", at: 1_000 },
			{ key: "missing/model", at: 2_000 },
		],
	};
	assert.deepEqual(rowLabels(state), ["anthropic/claude-sonnet", "openai/gpt-5"]);
	const later = recordSelection(state, "openai/gpt-5", 3_000);
	assert.deepEqual(rowLabels(later), ["openai/gpt-5", "anthropic/claude-sonnet"]);
});

test("favouriteModels tracks recency per effort entry", () => {
	const state: PickerState = {
		favourites: [
			{ id: "openai/gpt-5", key: "openai/gpt-5" },
			{ id: "openai/gpt-5@high", key: "openai/gpt-5", effort: "high" },
		],
		selections: [],
	};
	const selected = recordSelection(state, "openai/gpt-5@high", 4_000);
	assert.deepEqual(
		favouriteModels(models, selected).map((model) => model.effort ?? "none"),
		["high", "none"],
	);
});

test("recordSelection replaces the previous selection time and leaves other keys alone", () => {
	const first = recordSelection({ favourites: [], selections: [] }, "anthropic/claude-sonnet", 1_000);
	const second = recordSelection(first, "anthropic/claude-sonnet", 2_000);
	assert.deepEqual(second.selections, [{ key: "anthropic/claude-sonnet", at: 2_000 }]);
	const third = recordSelection(second, "openai/gpt-5", 3_000);
	assert.deepEqual(third.selections, [
		{ key: "anthropic/claude-sonnet", at: 2_000 },
		{ key: "openai/gpt-5", at: 3_000 },
	]);
	assert.deepEqual(second.selections, [{ key: "anthropic/claude-sonnet", at: 2_000 }]);
});

test("parsePickerState reads a legacy string-only file as bare entries", () => {
	assert.deepEqual(parsePickerState('{"favourites":["a/b"]}'), {
		favourites: [{ id: "a/b", key: "a/b" }],
		selections: [],
	});
});

test("parsePickerState reads effort entries and drops malformed ones", () => {
	assert.deepEqual(
		parsePickerState(
			'{"favourites":["a/b", {"key":"c/d","effort":"high"}, {"key":"e/f"}, {"key":"g/h","effort":"bogus"}, {"key":"noseparator","effort":"low"}, {"effort":"low"}, 1], "selections":[{"key":"a/b","at":5}, {"key":"c/d@high","at":6}, {"key":"bad"}, {"at":7}, {"key":"c/d","at":"x"}]}',
		),
		{
			favourites: [
				{ id: "a/b", key: "a/b" },
				{ id: "c/d@high", key: "c/d", effort: "high" },
				{ id: "e/f", key: "e/f" },
			],
			selections: [
				{ key: "a/b", at: 5 },
				{ key: "c/d@high", at: 6 },
			],
		},
	);
	assert.deepEqual(parsePickerState("{}"), { favourites: [], selections: [] });
	assert.deepEqual(parsePickerState('"nope"'), { favourites: [], selections: [] });
});

test("parsePickerState mints ids for legacy duplicates and keeps persisted ones", () => {
	assert.deepEqual(
		parsePickerState(
			'{"favourites":[{"key":"a/b","effort":"high"}, {"key":"a/b","effort":"high"}, {"id":"kept","key":"a/b","effort":"high"}, {"key":"a/b","effort":"high"}, {"id":"","key":"c/d"}], "selections":[{"key":"a/b@high","at":5}, {"key":"a/b@high#2","at":9}]}',
		),
		{
			// The empty persisted id is malformed and drops its entry, like an unknown effort.
			favourites: [
				{ id: "a/b@high", key: "a/b", effort: "high" },
				{ id: "a/b@high#2", key: "a/b", effort: "high" },
				{ id: "kept", key: "a/b", effort: "high" },
				{ id: "a/b@high#3", key: "a/b", effort: "high" },
			],
			selections: [
				{ key: "a/b@high", at: 5 },
				{ key: "a/b@high#2", at: 9 },
			],
		},
	);
});

test("serializePickerState round-trips through parsePickerState", () => {
	const state: PickerState = {
		favourites: [
			{ id: "anthropic/claude-sonnet", key: "anthropic/claude-sonnet" },
			{ id: "openai/gpt-5@high#2", key: "openai/gpt-5", effort: "high" },
		],
		selections: [{ key: "openai/gpt-5@high#2", at: 5 }],
	};
	assert.deepEqual(parsePickerState(serializePickerState(state)), state);
});

test("moveSelection moves by one row and clamps at both ends", () => {
	assert.equal(moveSelection(3, -1, 5), 2);
	assert.equal(moveSelection(3, 1, 5), 4);
	assert.equal(moveSelection(0, -1, 5), 0);
	assert.equal(moveSelection(4, 1, 5), 4);
	assert.equal(moveSelection(0, -1, 0), 0);
});

test("moveSelection pages a whole window and never overshoots", () => {
	assert.equal(moveSelection(0, 10, 25), 10);
	assert.equal(moveSelection(20, 10, 25), 24);
	assert.equal(moveSelection(5, -10, 25), 0);
});

test("windowStart centers the selection and clamps at both ends", () => {
	assert.equal(windowStart(10, 25, 10), 5);
	assert.equal(windowStart(0, 25, 10), 0);
	assert.equal(windowStart(24, 25, 10), 15);
	assert.equal(windowStart(3, 5, 10), 0);
});

test("filterChar accepts model-id characters and rejects chords", () => {
	assert.equal(filterChar("a"), "a");
	assert.equal(filterChar("hyphen"), "-");
	assert.equal(filterChar("ctrl+a"), undefined);
	assert.equal(filterChar("space"), undefined);
});

test("outlineContentPoint skips the frame and shifts into the content", () => {
	assert.equal(outlineContentPoint(0, 1, 20, 4), undefined);
	assert.equal(outlineContentPoint(3, 0, 20, 4), undefined);
	assert.equal(outlineContentPoint(3, 5, 20, 4), undefined);
	assert.deepEqual(outlineContentPoint(2, 1, 20, 4), { x: 0, y: 0 });
	assert.deepEqual(outlineContentPoint(17, 3, 20, 4), { x: 15, y: 2 });
});

test("hitAt matches the half-open column range on the right line", () => {
	const hits = [{ line: 1, start: 4, end: 8, action: "model" }];
	assert.equal(hitAt(hits, 4, 1)?.action, "model");
	assert.equal(hitAt(hits, 8, 1), undefined);
	assert.equal(hitAt(hits, 5, 0), undefined);
});

test("pickerVisibleRows takes two thirds of the terminal, less the dialog chrome", () => {
	assert.equal(pickerVisibleRows(undefined), 10);
	assert.equal(pickerVisibleRows(Number.NaN), 10);
	assert.equal(pickerVisibleRows(30), 12);
	assert.equal(pickerVisibleRows(24), 8);
	assert.equal(pickerVisibleRows(90), 30);
	assert.equal(pickerVisibleRows(9), 5);
});
