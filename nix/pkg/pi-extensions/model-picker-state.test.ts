import assert from "node:assert/strict";
import test from "node:test";

import {
	favouriteModels,
	filterChar,
	filterModels,
	hitAt,
	modelKey,
	moveSelection,
	outlineContentPoint,
	parsePickerState,
	recordSelection,
	serializePickerState,
	toggleFavourite,
	windowStart,
	type PickerState,
} from "./model-picker-state.ts";

const models = [
	{ provider: "anthropic", id: "claude-sonnet", name: "Sonnet" },
	{ provider: "openai", id: "gpt-5", name: "GPT" },
];

test("modelKey joins provider and id", () => {
	assert.equal(modelKey(models[0]!), "anthropic/claude-sonnet");
});

test("toggleFavourite adds then removes", () => {
	const added = toggleFavourite([], "anthropic/claude-sonnet");
	assert.deepEqual(added, ["anthropic/claude-sonnet"]);
	assert.deepEqual(toggleFavourite(added, "anthropic/claude-sonnet"), []);
});

test("filterModels matches provider, id, or name", () => {
	assert.deepEqual(filterModels(models, "gpt").map(modelKey), ["openai/gpt-5"]);
	assert.deepEqual(filterModels(models, "  ").map(modelKey), models.map(modelKey));
});

test("favouriteModels keeps stored order and drops missing keys when never selected", () => {
	const state: PickerState = {
		favourites: ["openai/gpt-5", "missing/model", "anthropic/claude-sonnet"],
		selections: [],
	};
	assert.deepEqual(favouriteModels(models, state).map(modelKey), ["openai/gpt-5", "anthropic/claude-sonnet"]);
});

test("favouriteModels sorts by most recent selection, then stored order", () => {
	const state: PickerState = {
		favourites: ["openai/gpt-5", "anthropic/claude-sonnet", "missing/model"],
		selections: [
			{ key: "anthropic/claude-sonnet", at: 1_000 },
			{ key: "missing/model", at: 2_000 },
		],
	};
	assert.deepEqual(favouriteModels(models, state).map(modelKey), ["anthropic/claude-sonnet", "openai/gpt-5"]);
	const later = recordSelection(state, "openai/gpt-5", 3_000);
	assert.deepEqual(favouriteModels(models, later).map(modelKey), ["openai/gpt-5", "anthropic/claude-sonnet"]);
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

test("parsePickerState reads a favourites-only file as an empty selection log", () => {
	assert.deepEqual(parsePickerState('{"favourites":["a/b"]}'), {
		favourites: ["a/b"],
		selections: [],
	});
});

test("parsePickerState ignores malformed entries", () => {
	assert.deepEqual(
		parsePickerState('{"favourites":["a/b", 1, "noseparator"], "selections":[{"key":"a/b","at":5}, {"key":"bad"}, {"at":7}, {"key":"c/d","at":"x"}]}'),
		{ favourites: ["a/b"], selections: [{ key: "a/b", at: 5 }] },
	);
	assert.deepEqual(parsePickerState("{}"), { favourites: [], selections: [] });
	assert.deepEqual(parsePickerState('"nope"'), { favourites: [], selections: [] });
});

test("serializePickerState round-trips through parsePickerState", () => {
	const state: PickerState = {
		favourites: ["anthropic/claude-sonnet"],
		selections: [{ key: "openai/gpt-5", at: 5 }],
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
