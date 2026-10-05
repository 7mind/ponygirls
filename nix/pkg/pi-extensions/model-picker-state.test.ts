import assert from "node:assert/strict";
import test from "node:test";

import {
	cycleFavouriteEntry,
	cycleModelEntry,
	favouriteId,
	transferSelection,
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

test("modelKey joins provider and id", () => {
	assert.equal(modelKey(models[0]!), "anthropic/claude-sonnet");
});

test("favouriteId is the bare key, or key@effort when pinned", () => {
	assert.equal(favouriteId({ key: "a/b" }), "a/b");
	assert.equal(favouriteId({ key: "a/b", effort: "high" }), "a/b@high");
});

test("toggleBareFavourite adds then removes the bare entry", () => {
	const added = toggleBareFavourite([], "anthropic/claude-sonnet");
	assert.deepEqual(added, [{ key: "anthropic/claude-sonnet" }]);
	assert.deepEqual(toggleBareFavourite(added, "anthropic/claude-sonnet"), []);
});

test("toggleBareFavourite leaves effort-pinned entries alone", () => {
	const state: Favourite[] = [{ key: "a/b", effort: "high" }];
	assert.deepEqual(toggleBareFavourite(state, "a/b"), [{ key: "a/b", effort: "high" }, { key: "a/b" }]);
	const both: Favourite[] = [{ key: "a/b", effort: "high" }, { key: "a/b" }];
	assert.deepEqual(toggleBareFavourite(both, "a/b"), [{ key: "a/b", effort: "high" }]);
});

test("removeFavouriteEntry removes the first equal entry only", () => {
	const state: Favourite[] = [
		{ key: "a/b", effort: "high" },
		{ key: "a/b" },
		{ key: "a/b", effort: "high" },
	];
	assert.deepEqual(removeFavouriteEntry(state, { key: "a/b", effort: "high" }), [{ key: "a/b" }, { key: "a/b", effort: "high" }]);
	assert.deepEqual(removeFavouriteEntry(state, { key: "a/b", effort: "low" }), state);
	assert.deepEqual(removeFavouriteEntry([], { key: "a/b" }), []);
});

test("cycleFavouriteEntry advances through [none, ...levels] and wraps", () => {
	const levels = ["off", "low", "high"];
	const start: PickerState = { favourites: [{ key: "a/b" }], selections: [] };
	const once = cycleFavouriteEntry(start, { key: "a/b" }, levels);
	assert.deepEqual(once.favourites, [{ key: "a/b", effort: "off" }]);
	const twice = cycleFavouriteEntry(once, { key: "a/b", effort: "off" }, levels);
	assert.deepEqual(twice.favourites, [{ key: "a/b", effort: "low" }]);
	const thrice = cycleFavouriteEntry(twice, { key: "a/b", effort: "low" }, levels);
	assert.deepEqual(thrice.favourites, [{ key: "a/b", effort: "high" }]);
	assert.deepEqual(cycleFavouriteEntry(thrice, { key: "a/b", effort: "high" }, levels).favourites, [{ key: "a/b" }]);
});

test("cycleFavouriteEntry resets a stale effort to none and ignores unknown entries", () => {
	const start: PickerState = { favourites: [{ key: "a/b", effort: "max" }], selections: [] };
	assert.deepEqual(cycleFavouriteEntry(start, { key: "a/b", effort: "max" }, ["off", "low"]).favourites, [{ key: "a/b" }]);
	assert.deepEqual(cycleFavouriteEntry(start, { key: "c/d" }, ["off"]), start);
	assert.deepEqual(cycleFavouriteEntry({ favourites: [], selections: [] }, { key: "a/b" }, ["off"]).favourites, []);
});

test("cycleModelEntry appends the first level for unfavourited models", () => {
	const empty: PickerState = { favourites: [], selections: [] };
	assert.deepEqual(cycleModelEntry(empty, "a/b", ["off", "high"]).favourites, [{ key: "a/b", effort: "off" }]);
	assert.deepEqual(cycleModelEntry(empty, "a/b", []), empty);
});

test("cycleModelEntry advances the most recently stored entry", () => {
	const start: PickerState = {
		favourites: [{ key: "a/b" }, { key: "a/b", effort: "low" }],
		selections: [],
	};
	assert.deepEqual(cycleModelEntry(start, "a/b", ["off", "low", "high"]).favourites, [
		{ key: "a/b" },
		{ key: "a/b", effort: "high" },
	]);
});

test("cycleModelEntry replaces the latest occurrence, not the first equal one", () => {
	const start: PickerState = {
		favourites: [{ key: "a/b", effort: "off" }, { key: "a/b", effort: "low" }, { key: "a/b", effort: "off" }],
		selections: [],
	};
	assert.deepEqual(cycleModelEntry(start, "a/b", ["off", "low"]).favourites, [
		{ key: "a/b", effort: "off" },
		{ key: "a/b", effort: "low" },
		{ key: "a/b", effort: "low" },
	]);
});

test("transferSelection moves the timestamp to the new id", () => {
	const log = [
		{ key: "a/b", at: 100 },
		{ key: "c/d", at: 50 },
	];
	assert.deepEqual(transferSelection(log, "a/b", "a/b@off"), [
		{ key: "c/d", at: 50 },
		{ key: "a/b@off", at: 100 },
	]);
});

test("transferSelection merges collisions with max and drops absent sources", () => {
	const log = [
		{ key: "a/b", at: 50 },
		{ key: "a/b@off", at: 300 },
	];
	assert.deepEqual(transferSelection(log, "a/b", "a/b@off"), [{ key: "a/b@off", at: 300 }]);
	assert.deepEqual(transferSelection([], "a/b", "a/b@off"), []);
	assert.deepEqual(transferSelection(log, "a/b", "a/b"), log);
});

test("latestEntryForKey returns the most recently stored entry", () => {
	const state: Favourite[] = [{ key: "a/b", effort: "off" }, { key: "c/d" }, { key: "a/b", effort: "low" }];
	assert.deepEqual(latestEntryForKey(state, "a/b"), { key: "a/b", effort: "low" });
	assert.deepEqual(latestEntryForKey(state, "c/d"), { key: "c/d" });
	assert.equal(latestEntryForKey(state, "e/f"), undefined);
	assert.equal(latestEntryForKey([], "a/b"), undefined);
});

test("cycling a selected-first entry keeps it first", () => {
	const state: PickerState = {
		favourites: [{ key: "openai/gpt-5" }, { key: "anthropic/claude-sonnet" }],
		selections: [
			{ key: "openai/gpt-5", at: 100 },
			{ key: "anthropic/claude-sonnet", at: 50 },
		],
	};
	assert.deepEqual(favouriteModels(models, state).map(modelKey), ["openai/gpt-5", "anthropic/claude-sonnet"]);
	const cycled = cycleFavouriteEntry(state, { key: "openai/gpt-5" }, ["off", "low"]);
	assert.deepEqual(
		favouriteModels(models, cycled).map((model) => `${modelKey(model)}${model.effort ? `@${model.effort}` : ""}`),
		["openai/gpt-5@off", "anthropic/claude-sonnet"],
	);
	assert.deepEqual(cycled.selections, [
		{ key: "anthropic/claude-sonnet", at: 50 },
		{ key: "openai/gpt-5@off", at: 100 },
	]);
});

test("cycling keeps the entry at its stored position", () => {
	const state: PickerState = {
		favourites: [{ key: "openai/gpt-5" }, { key: "anthropic/claude-sonnet" }],
		selections: [{ key: "anthropic/claude-sonnet", at: 2_000 }],
	};
	const before = favouriteModels(models, state).map(modelKey);
	const cycled = cycleFavouriteEntry(state, { key: "openai/gpt-5" }, ["off", "low"]);
	assert.deepEqual(favouriteModels(models, cycled).map(modelKey), before);
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
		favourites: [{ key: "openai/gpt-5" }, { key: "missing/model" }, { key: "anthropic/claude-sonnet" }],
		selections: [],
	};
	assert.deepEqual(favouriteModels(models, state).map(modelKey), ["openai/gpt-5", "anthropic/claude-sonnet"]);
});

test("favouriteModels keeps duplicate models with different efforts", () => {
	const state: PickerState = {
		favourites: [{ key: "openai/gpt-5" }, { key: "openai/gpt-5", effort: "high" }],
		selections: [],
	};
	assert.deepEqual(
		favouriteModels(models, state).map((model) => `${modelKey(model)}${model.effort ? `@${model.effort}` : ""}`),
		["openai/gpt-5", "openai/gpt-5@high"],
	);
});

test("favouriteModels sorts by most recent per-entry selection, then stored order", () => {
	const state: PickerState = {
		favourites: [{ key: "openai/gpt-5" }, { key: "anthropic/claude-sonnet" }, { key: "missing/model" }],
		selections: [
			{ key: "anthropic/claude-sonnet", at: 1_000 },
			{ key: "missing/model", at: 2_000 },
		],
	};
	assert.deepEqual(favouriteModels(models, state).map(modelKey), ["anthropic/claude-sonnet", "openai/gpt-5"]);
	const later = recordSelection(state, "openai/gpt-5", 3_000);
	assert.deepEqual(favouriteModels(models, later).map(modelKey), ["openai/gpt-5", "anthropic/claude-sonnet"]);
});

test("favouriteModels tracks recency per effort entry", () => {
	const state: PickerState = {
		favourites: [{ key: "openai/gpt-5" }, { key: "openai/gpt-5", effort: "high" }],
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
		favourites: [{ key: "a/b" }],
		selections: [],
	});
});

test("parsePickerState reads effort entries and drops malformed ones", () => {
	assert.deepEqual(
		parsePickerState(
			'{"favourites":["a/b", {"key":"c/d","effort":"high"}, {"key":"e/f"}, {"key":"g/h","effort":"bogus"}, {"key":"noseparator","effort":"low"}, {"effort":"low"}, 1], "selections":[{"key":"a/b","at":5}, {"key":"c/d@high","at":6}, {"key":"bad"}, {"at":7}, {"key":"c/d","at":"x"}]}',
		),
		{
			favourites: [{ key: "a/b" }, { key: "c/d", effort: "high" }, { key: "e/f" }],
			selections: [
				{ key: "a/b", at: 5 },
				{ key: "c/d@high", at: 6 },
			],
		},
	);
	assert.deepEqual(parsePickerState("{}"), { favourites: [], selections: [] });
	assert.deepEqual(parsePickerState('"nope"'), { favourites: [], selections: [] });
});

test("serializePickerState round-trips through parsePickerState", () => {
	const state: PickerState = {
		favourites: [{ key: "anthropic/claude-sonnet" }, { key: "openai/gpt-5", effort: "high" }],
		selections: [{ key: "openai/gpt-5@high", at: 5 }],
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
