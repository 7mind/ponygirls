import assert from "node:assert/strict";
import { test } from "node:test";
import { browseHash, DEFAULT_SORT, readBrowseState, sameBrowseState, type BrowseState } from "../src/browse-state.ts";

// Behavioral-Active-Blackbox-Atomic: URL state is independent of browser/network state.
test("browse defaults to newest modified, inbox keeps its attention preset", () => {
  assert.deepEqual(readBrowseState("#/browse", false), { query: "", project: "", archive: "hide", tag: "", sort: DEFAULT_SORT });
  assert.equal(readBrowseState("#/inbox", true).query, "human-attention:required");
  assert.equal(browseHash(readBrowseState("#/inbox", true), true), "#/inbox");
});

test("filters and sort round-trip through shareable fragments, including inbox", () => {
  const state: BrowseState = { query: 'title:"two words" OR 🐎', project: "p:unicode", archive: "only", tag: "Machine Learning", sort: { field: "title", direction: "asc" } };
  for (const inbox of [false, true]) assert.deepEqual(readBrowseState(browseHash(state, inbox), inbox), state);
  assert.deepEqual(readBrowseState(browseHash({ ...state, sort: { field: "revision", direction: "desc" } }, false), false).sort, { field: "revision", direction: "desc" });
});

test("invalid URL sorting normalizes to known fields and directions", () => {
  assert.deepEqual(readBrowseState("#/browse?sort=SQL&direction=sideways", false).sort, DEFAULT_SORT);
  assert.deepEqual(readBrowseState("#/browse?sort=title", false).sort, { field: "title", direction: "asc" });
  assert.deepEqual(readBrowseState("#/browse?sort=revision", false).sort, { field: "revision", direction: "desc" });
  assert.equal(readBrowseState("#/browse?archive=unknown", false).archive, "hide");
});

test("state equality includes tag and both sorting dimensions", () => {
  const state = readBrowseState("#/browse", false);
  assert.equal(sameBrowseState(state, { ...state, sort: { ...state.sort } }), true);
  assert.equal(sameBrowseState(state, { ...state, tag: "new" }), false);
  assert.equal(sameBrowseState(state, { ...state, sort: { ...state.sort, direction: "asc" } }), false);
  assert.equal(sameBrowseState(state, { ...state, sort: { field: "title", direction: "desc" } }), false);
});
