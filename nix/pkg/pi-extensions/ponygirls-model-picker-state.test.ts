import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { PLAIN_THEME, type UiBg, type UiFg, type UiTheme } from "@ponygirls/pi-ui";

import {
	DEFAULT_THINKING_BUDGETS,
	MIN_ANSWER_TOKENS,
	THINKING_LEVELS,
	adaptiveEffort,
	effortRows,
	googleBudget,
	googleLevel,
	sharedCeilingBudget,
	thinkingApi,
	usesGoogleThinkingLevel,
	type BudgetLevel,
	type EffortModel,
	type ThinkingBudgets,
	type ThinkingLevelName,
} from "./ponygirls-model-picker-effort.ts";
import {
	actionHints,
	compactControls,
	effortFooter,
	effortRow,
	effortTitle,
	formatTokenCount,
	groupDigits,
	modelRow,
} from "./ponygirls-model-picker-view.ts";

import {
	allModels,
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
} from "./ponygirls-model-picker-state.ts";

const models = [
	{ provider: "anthropic", id: "claude-sonnet", name: "Sonnet" },
	{ provider: "openai", id: "gpt-5", name: "GPT" },
];

/** Display rows as `provider/id[@effort]`, in picker order. */
const rowLabels = (state: PickerState) =>
	favouriteModels(models, state).map((model) => `${modelKey(model)}${model.effort ? `@${model.effort}` : ""}`);

test("allModels sorts by displayed model id, case-insensitively, then provider without mutating the catalog", () => {
	const catalog = [
		{ provider: "a", id: "zebra", name: "Alpha" },
		{ provider: "z", id: "Alpha", name: "Zebra" },
		{ provider: "b", id: "beta" },
		{ provider: "a", id: "alpha" },
	];
	const original = [...catalog];
	assert.deepEqual(allModels(catalog).map(modelKey), ["a/alpha", "z/Alpha", "b/beta", "a/zebra"]);
	assert.deepEqual(catalog, original);
	assert.deepEqual(filterModels(allModels(catalog), "alpha").map(modelKey), ["a/alpha", "z/Alpha", "a/zebra"]);
	assert.deepEqual(allModels([]), []);
});

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
	assert.equal(outlineContentPoint(19, 1, 20, 4), undefined);
	assert.equal(outlineContentPoint(3, 0, 20, 4), undefined);
	assert.equal(outlineContentPoint(3, 5, 20, 4), undefined);
	assert.deepEqual(outlineContentPoint(1, 1, 20, 4), { x: 0, y: 0 });
	assert.deepEqual(outlineContentPoint(18, 3, 20, 4), { x: 17, y: 2 });
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

// --- effort picker: what pi-ai sends per level -------------------------------

const BASE_MODEL: EffortModel = {
	provider: "p",
	id: "m",
	api: "openai-responses",
	reasoning: true,
	contextWindow: 500_000,
	maxTokens: 128_000,
};

function model(overrides: Partial<EffortModel>): EffortModel {
	return { ...BASE_MODEL, ...overrides };
}

const ALL_ON: readonly ThinkingLevelName[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

test("thinkingApi classifies the APIs by how they carry the level", () => {
	assert.deepEqual(thinkingApi(model({ api: "openai-codex-responses" })), { kind: "effort-only" });
	assert.deepEqual(thinkingApi(model({ api: "azure-openai-responses" })), { kind: "effort-only" });
	assert.deepEqual(thinkingApi(model({ api: "openai-completions" })), { kind: "effort-only" });
	assert.deepEqual(thinkingApi(model({ api: "openai-completions", compat: { supportsThinkingTokenBudget: true } })), {
		kind: "budget",
		field: "thinking_token_budget",
	});
	assert.deepEqual(thinkingApi(model({ api: "openai-completions", compat: { thinkingTokenBudgetField: "thinking_budget" } })), {
		kind: "budget",
		field: "thinking_budget",
	});
	assert.deepEqual(thinkingApi(model({ api: "anthropic-messages" })), { kind: "budget", field: "budget_tokens" });
	assert.deepEqual(thinkingApi(model({ api: "anthropic-messages", compat: { forceAdaptiveThinking: true } })), { kind: "adaptive" });
	assert.deepEqual(thinkingApi(model({ api: "google-generative-ai", id: "gemini-2.5-pro" })), { kind: "google-budget", api: "google-generative-ai" });
	assert.deepEqual(thinkingApi(model({ api: "google-vertex", id: "gemini-3-pro-preview" })), { kind: "google-level" });
	assert.deepEqual(thinkingApi(model({ api: "bedrock-converse-stream" })), { kind: "unmodelled", api: "bedrock-converse-stream" });
	assert.deepEqual(thinkingApi(model({ reasoning: false })), { kind: "no-reasoning" });
});

test("effort-only rows send the mapped wire value and mark aliases of another level", () => {
	const codex = model({ api: "openai-codex-responses", thinkingLevelMap: { minimal: "low", xhigh: "xhigh" } });
	const rows = effortRows(codex, ["minimal", "low", "medium", "high", "xhigh"], {});
	assert.deepEqual(rows[0], { level: "minimal", meter: 1, wire: { kind: "effort", value: "low" }, sameAs: "low" });
	assert.deepEqual(rows[1], { level: "low", meter: 2, wire: { kind: "effort", value: "low" } });
	assert.deepEqual(rows[4], { level: "xhigh", meter: 5, wire: { kind: "effort", value: "xhigh" } });
	assert.deepEqual(effortRows(codex, ["off"], {})[0], { level: "off", meter: 0, wire: { kind: "off" } });
});

test("a wire value naming an unsupported level is no alias", () => {
	const rows = effortRows(model({ thinkingLevelMap: { minimal: "low" } }), ["minimal", "medium"], {});
	assert.equal(rows[0]!.sameAs, undefined);
});

test("anthropic budget rows use pi-ai's budgets, xhigh/max share the high budget", () => {
	const haiku = model({ api: "anthropic-messages", maxTokens: 64_000, thinkingLevelMap: { xhigh: "xhigh" } });
	const rows = effortRows(haiku, ["off", "minimal", "low", "medium", "high", "xhigh"], {});
	assert.deepEqual(
		rows.map((row) => (row.wire.kind === "budget" ? row.wire.tokens : row.wire.kind)),
		["off", 1024, 2048, 8192, 16384, 16384],
	);
	assert.equal(rows[5]!.sameAs, "high");
	assert.equal(rows[4]!.sameAs, undefined);
});

test("budgets keep MIN_ANSWER_TOKENS under the output limit", () => {
	assert.equal(sharedCeilingBudget("high", 4096, {}), 4096 - MIN_ANSWER_TOKENS);
	assert.equal(sharedCeilingBudget("minimal", 4096, {}), 1024);
	assert.equal(sharedCeilingBudget("low", 512, {}), 0);
});

test("settings thinkingBudgets override the defaults and are marked custom", () => {
	const custom: ThinkingBudgets = { medium: 12_000 };
	const rows = effortRows(model({ api: "anthropic-messages" }), ["low", "medium"], custom);
	assert.deepEqual(rows[1]!.wire, { kind: "budget", tokens: 12_000, custom: true });
	assert.deepEqual(rows[0]!.wire, { kind: "budget", tokens: 2048, custom: false });
});

test("adaptive rows send pi-ai's effort mapping", () => {
	const fable = model({ api: "anthropic-messages", compat: { forceAdaptiveThinking: true }, thinkingLevelMap: { xhigh: "xhigh", max: "max" } });
	const rows = effortRows(fable, ALL_ON, {});
	assert.deepEqual(
		rows.map((row) => (row.wire.kind === "adaptive" ? row.wire.effort : row.wire.kind)),
		["low", "low", "medium", "high", "xhigh", "max"],
	);
	assert.equal(rows[0]!.sameAs, "low");
	assert.equal(adaptiveEffort({}, "max"), "high");
});

test("Gemini 2.5 uses the budget table, Gemini 3 a level, others are dynamic", () => {
	const pro = effortRows(model({ api: "google-generative-ai", id: "gemini-2.5-pro" }), ["minimal", "high"], {});
	assert.deepEqual(pro.map((row) => row.wire), [
		{ kind: "budget", tokens: 128, custom: false },
		{ kind: "budget", tokens: 32768, custom: false },
	]);
	const three = effortRows(model({ api: "google-vertex", id: "gemini-3-flash-preview" }), ["low"], {});
	assert.deepEqual(three[0]!.wire, { kind: "google-level", level: "low" });
	const other = effortRows(model({ api: "google-generative-ai", id: "gemini-2.0-flash-thinking" }), ["low"], {});
	assert.deepEqual(other[0]!.wire, { kind: "dynamic" });
	assert.equal(googleBudget("google-generative-ai", "gemini-2.0-flash", "low", { low: 999 }), 999);
	assert.equal(googleBudget("google-generative-ai", "gemini-2.5-flash-lite", "minimal", {}), 512);
	assert.equal(googleBudget("google-vertex", "gemini-2.5-flash-lite", "minimal", {}), 128);
});

// --- drift: the mirrored rules against the pinned pi-ai dist -----------------

/** The pinned SDK root (flake check env); the drift tests are meaningless without it. */
function sdkRoot(): string {
	const root = process.env.PI_SDK_ROOT;
	if (!root) throw new Error("PI_SDK_ROOT must point at the pinned pi-monorepo (see the ponygirls-model-picker flake check)");
	return root;
}

function piAiDist(file: string): string {
	return join(sdkRoot(), "node_modules", "@earendil-works", "pi-ai", "dist", file);
}

/** A top-level function declared in a pi-ai dist file, evaluated on its own (it must not use module bindings). */
function distFunction<F>(file: string, name: string): F {
	const source = readFileSync(piAiDist(file), "utf-8");
	const start = source.indexOf(`function ${name}(`);
	assert.ok(start >= 0, `${name} not found in ${file}`);
	let depth = 0;
	let end = source.indexOf("{", source.indexOf(")", start));
	for (let index = end; index < source.length; index++) {
		if (source[index] === "{") depth++;
		else if (source[index] === "}" && --depth === 0) {
			end = index + 1;
			break;
		}
	}
	return new Function(`return (${source.slice(start, end)});`)() as F;
}

interface SimpleOptions {
	DEFAULT_THINKING_BUDGETS: Record<BudgetLevel, number>;
	MIN_ANSWER_TOKENS: number;
	adjustMaxTokensForThinking(base: number | undefined, modelMax: number, level: string, custom?: ThinkingBudgets): { maxTokens: number; thinkingBudget: number };
	clampThinkingBudgetToAnswerRoom(budget: number, ceiling: number): number;
	thinkingBudgetForLevel(level: string, custom?: ThinkingBudgets): number;
}

const DRIFT_BUDGETS: readonly ThinkingBudgets[] = [{}, { minimal: 100, high: 50_000 }, { medium: 3000 }];
const DRIFT_MAX_TOKENS: readonly number[] = [512, 2048, 4096, 16_384, 17_000, 64_000, 128_000];
const DRIFT_LEVELS = ALL_ON;

test("drift: simple-options budgets and the shared-ceiling clamp match pi-ai", async () => {
	const real = (await import(piAiDist("api/simple-options.js"))) as SimpleOptions;
	assert.deepEqual({ ...real.DEFAULT_THINKING_BUDGETS }, { ...DEFAULT_THINKING_BUDGETS });
	assert.equal(real.MIN_ANSWER_TOKENS, MIN_ANSWER_TOKENS);
	for (const custom of DRIFT_BUDGETS) {
		for (const maxTokens of DRIFT_MAX_TOKENS) {
			for (const level of DRIFT_LEVELS) {
				if (level === "off") continue;
				const mine = sharedCeilingBudget(level, maxTokens, custom);
				// anthropic-messages streamSimple: base maxTokens is the model cap.
				const adjusted = real.adjustMaxTokensForThinking(maxTokens, maxTokens, level, custom);
				assert.equal(mine, Math.min(adjusted.thinkingBudget, Math.max(0, adjusted.maxTokens - MIN_ANSWER_TOKENS)), `anthropic ${level} ${maxTokens}`);
				// openai-completions resolveClampedThinkingBudget with the model cap as ceiling.
				assert.equal(mine, real.clampThinkingBudgetToAnswerRoom(real.thinkingBudgetForLevel(level, custom), maxTokens), `completions ${level} ${maxTokens}`);
			}
		}
	}
});

test("drift: the anthropic and completions call sites still use those rules", () => {
	const anthropic = readFileSync(piAiDist("api/anthropic-messages.js"), "utf-8");
	assert.ok(anthropic.includes("model.compat?.forceAdaptiveThinking === true"));
	assert.ok(anthropic.includes("adjustMaxTokensForThinking(base.maxTokens, model.maxTokens, options.reasoning, options.thinkingBudgets)"));
	assert.ok(anthropic.includes("thinkingBudgetTokens: Math.min(adjusted.thinkingBudget, Math.max(0, maxTokens - 1024))"));
	const completions = readFileSync(piAiDist("api/openai-completions.js"), "utf-8");
	assert.ok(completions.includes("clampThinkingBudgetToAnswerRoom(thinkingBudgetForLevel(options.reasoningEffort, options.thinkingBudgets), ceiling)"));
	const field = distFunction<(compat: object) => string | undefined>("api/openai-completions.js", "resolveThinkingTokenBudgetField");
	for (const compat of [{}, { supportsThinkingTokenBudget: true }, { thinkingTokenBudgetField: "thinking_budget", supportsThinkingTokenBudget: true }]) {
		const api = thinkingApi(model({ api: "openai-completions", compat }));
		assert.equal(api.kind === "budget" ? api.field : undefined, field(compat));
	}
});

test("drift: the adaptive effort mapping matches pi-ai", () => {
	const real = distFunction<(model: object, level: string) => string>("api/anthropic-messages.js", "mapThinkingLevelToEffort");
	for (const thinkingLevelMap of [undefined, { xhigh: "xhigh", max: "max" }, { minimal: "medium" }]) {
		for (const level of THINKING_LEVELS) {
			const subject = thinkingLevelMap === undefined ? {} : { thinkingLevelMap };
			assert.equal(adaptiveEffort(subject, level), real(subject, level), `${JSON.stringify(thinkingLevelMap)} ${level}`);
		}
	}
});

const GOOGLE_IDS: readonly string[] = [
	"gemini-2.5-pro",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
	"gemini-2.5-flash-lite-preview-06-17",
	"gemini-2.0-flash-thinking",
	"gemini-3-pro-preview",
	"gemini-3.1-flash",
	"gemini-4-argon",
	"gemini-flash-latest",
	"gemini-flash-lite-latest",
	"gemma-4-27b",
	"gemma4-9b",
];

test("drift: the Gemini budget tables match pi-ai's getGoogleBudget (both Google APIs)", () => {
	for (const api of ["google-generative-ai", "google-vertex"] as const) {
		const file = `api/${api}.js`;
		const real = distFunction<(model: { id: string }, level: string, custom?: ThinkingBudgets) => number>(file, "getGoogleBudget");
		for (const id of GOOGLE_IDS) {
			for (const level of ["minimal", "low", "medium", "high"] as const) {
				for (const custom of DRIFT_BUDGETS) assert.equal(googleBudget(api, id, level, custom), real({ id }, level, custom), `${file} ${id} ${level}`);
			}
		}
	}
});

test("drift: the Gemini level/budget split matches pi-ai's usesGoogleThinkingLevel", async () => {
	const real = (await import(piAiDist("api/google-shared.js"))) as {
		usesGoogleThinkingLevel(model: { id: string }): boolean;
		resolveGoogleThinkingLevel(model: EffortModel, level: string): string;
	};
	for (const id of [...GOOGLE_IDS, "Gemini-3-Pro", "gemini-10-x", "gemini-2.5-pro-exp"]) {
		assert.equal(usesGoogleThinkingLevel({ id }), real.usesGoogleThinkingLevel({ id }), id);
	}
	for (const thinkingLevelMap of [undefined, { xhigh: "HIGH", minimal: "low" }, { high: "ultra" }]) {
		const subject = model({ api: "google-vertex", ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }) });
		for (const level of ALL_ON) {
			let expected: string | undefined;
			try {
				expected = real.resolveGoogleThinkingLevel(subject, level);
			} catch {
				expected = undefined;
			}
			assert.equal(googleLevel(subject, level), expected, `${JSON.stringify(thinkingLevelMap)} ${level}`);
		}
	}
});

test("drift: effort-only APIs still send thinkingLevelMap[level] ?? level", () => {
	for (const file of ["api/openai-responses.js", "api/openai-codex-responses.js", "api/azure-openai-responses.js", "api/openai-completions.js"]) {
		const source = readFileSync(piAiDist(file), "utf-8");
		assert.ok(source.includes("model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort"), file);
	}
});

// --- picker rendering ----------------------------------------------------------

const FG_TOKENS: readonly UiFg[] = [
	"text",
	"muted",
	"dim",
	"accent",
	"border",
	"borderMuted",
	"success",
	"warning",
	"error",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"thinkingMax",
];
const BG_TOKENS: readonly UiBg[] = ["selectedBg", "toolPendingBg"];

/** Zero-width, distinguishable SGR codes per token, so widths stay real. */
const TAGGED: UiTheme = {
	fg: (color, text) => `\x1b[38;5;${FG_TOKENS.indexOf(color) + 1}m${text}\x1b[39m`,
	bg: (color, text) => `\x1b[48;5;${BG_TOKENS.indexOf(color) + 1}m${text}\x1b[49m`,
	bold: (text) => `\x1b[1m${text}\x1b[22m`,
};
const fgCode = (color: UiFg): string => `\x1b[38;5;${FG_TOKENS.indexOf(color) + 1}m`;

function plain(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function width(text: string): number {
	return [...plain(text)].length;
}

test("model rows: ★ in warning, ◆ in the level's thinking colour, full-width selection without a > cursor", () => {
	const selected = modelRow(TAGGED, 50, { favourite: true, label: "openai-codex/gpt-6.1", effort: "medium" }, true);
	assert.equal(width(selected), 50);
	assert.ok(plain(selected).startsWith("▌ ★ openai-codex/gpt-6.1  ◆ medium"));
	assert.ok(selected.includes(`${fgCode("warning")}★`));
	assert.ok(selected.includes(`${fgCode("thinkingMedium")}◆`));
	assert.ok(selected.includes(`${fgCode("muted")}medium`));
	assert.ok(!plain(selected).includes(">"));
	const other = modelRow(TAGGED, 50, { favourite: false, label: "openrouter/gpt-6.1" }, false);
	assert.equal(plain(other), "    openrouter/gpt-6.1");
});

test("effort rows: meter, level, sent value, right-aligned budget, exact width", () => {
	const rows = effortRows(model({ api: "anthropic-messages", maxTokens: 64_000 }), ["off", "minimal", "high"], {});
	const lines = rows.map((row, index) => effortRow(TAGGED, 60, row, index === 2));
	// The selected band and right-aligned budgets span the row; the box pads the rest.
	assert.deepEqual(lines.map(width), [31, 59, 60]);
	assert.equal(plain(lines[0]!).trimEnd(), "  ▯▯▯▯▯▯  off      thinking off");
	assert.ok(plain(lines[1]!).startsWith("  ▮▯▯▯▯▯  minimal  budget"));
	assert.ok(plain(lines[1]!).endsWith("1 024 tok"));
	assert.ok(plain(lines[2]!).startsWith("▌ ▮▮▮▮▯▯  high"));
	assert.ok(plain(lines[2]!).endsWith("16 384 tok "));
	assert.ok(lines[2]!.includes(`${fgCode("thinkingHigh")}▮▮▮▮`));
	// Inside the selection band the empty steps use muted, not dim.
	assert.ok(lines[2]!.includes(`${fgCode("muted")}▯▯`));
	assert.ok(lines[1]!.includes(`${fgCode("dim")}▯▯▯▯▯`));
});

test("effort rows show the alias note and adaptive effort", () => {
	const rows = effortRows(model({ api: "anthropic-messages", compat: { forceAdaptiveThinking: true } }), ["minimal", "low"], {});
	assert.equal(plain(effortRow(PLAIN_THEME, 60, rows[0]!, false)).trimEnd(), "  ▮▯▯▯▯▯  minimal  adaptive · low · same as low");
});

test("effort title carries the model and its limits in the box border", () => {
	const title = effortTitle(PLAIN_THEME, 70, model({ provider: "openai-codex", id: "gpt-6.1-sol" }));
	assert.equal(width(title.line), 70);
	assert.ok(title.line.startsWith("┌─ Effort · openai-codex/gpt-6.1-sol · ctx 500k · out 128k ─"));
	assert.ok(title.line.endsWith("┐"));
	assert.ok(effortTitle(PLAIN_THEME, 30, undefined).line.startsWith("┌─ Effort ─"));
});

test("effort footer names the API class and its limit", () => {
	const codex = model({ api: "openai-codex-responses" });
	assert.equal(effortFooter(thinkingApi(codex), codex, []), "effort-only API: no thinking-token cap; shares the 128k output");
	const haiku = model({ api: "anthropic-messages", maxTokens: 64_000 });
	assert.equal(
		effortFooter(thinkingApi(haiku), haiku, effortRows(haiku, ["low"], {})),
		"budget API (budget_tokens): answer keeps ≥ 1 024 of the 64k output",
	);
	assert.ok(effortFooter(thinkingApi(haiku), haiku, effortRows(haiku, ["low"], { low: 1 })).endsWith("· custom budgets from settings"));
});

test("formatTokenCount and groupDigits", () => {
	assert.equal(formatTokenCount(500_000), "500k");
	assert.equal(formatTokenCount(1_048_576), "1M");
	assert.equal(formatTokenCount(1_500_000), "1.5M");
	assert.equal(formatTokenCount(800), "800");
	assert.equal(groupDigits(16384), "16 384");
	assert.equal(groupDigits(1024), "1 024");
	assert.equal(groupDigits(128), "128");
});

test("action hints keep the key-hint style and stay clickable after the indent", () => {
	const hints = actionHints(
		TAGGED,
		60,
		[[{ key: "⏎", action: "select", command: "choose" }, { key: "⎋", action: "close", command: "close" }]],
		2,
	);
	assert.equal(plain(hints.lines[0]!), "  ⏎ select  ⎋ close");
	assert.ok(hints.lines[0]!.includes(`${fgCode("muted")}select`));
	assert.deepEqual(hints.hits, [
		{ line: 0, start: 2, end: 10, action: "choose" },
		{ line: 0, start: 12, end: 19, action: "close" },
	]);
});

test("compact controls: model id, coloured ◆ and the level, abbreviated only when needed", () => {
	const full = compactControls(TAGGED, 40, { modelId: "gpt-6.1", level: "medium" });
	assert.equal(plain(full.line), "gpt-6.1 · ◆ medium");
	assert.ok(full.line.includes(`${fgCode("thinkingMedium")}◆`));
	assert.ok(full.line.includes(`${fgCode("accent")}medium`));
	assert.deepEqual(full.hits, [
		{ line: 0, start: 0, end: 7, action: "model" },
		{ line: 0, start: 10, end: 18, action: "thinking" },
	]);
	const short = compactControls(TAGGED, 16, { modelId: "gpt-6.1", level: "medium" });
	assert.equal(plain(short.line), "gpt-6.1 · ◆ med");
	assert.deepEqual(short.hits[1], { line: 0, start: 10, end: 15, action: "thinking" });
	const queued = compactControls(PLAIN_THEME, 80, { modelId: "gpt-6.1", level: "medium", queuedModelId: "kimi-k3", queuedLevel: "high" });
	assert.equal(queued.line, "gpt-6.1 → kimi-k3 · ◆ medium → high");
});
