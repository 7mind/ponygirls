import assert from "node:assert/strict";
import test from "node:test";

import {
	favouriteModels,
	filterChar,
	filterModels,
	hitAt,
	modelKey,
	outlineContentPoint,
	parseFavourites,
	toggleFavourite,
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

test("favouriteModels keeps stored order and drops missing keys", () => {
	const picked = favouriteModels(models, ["openai/gpt-5", "missing/model", "anthropic/claude-sonnet"]);
	assert.deepEqual(picked.map(modelKey), ["openai/gpt-5", "anthropic/claude-sonnet"]);
});

test("parseFavourites ignores a malformed list", () => {
	assert.deepEqual(parseFavourites('{"favourites":["a/b", 1, "noseparator"]}'), ["a/b"]);
	assert.deepEqual(parseFavourites("{}"), []);
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
