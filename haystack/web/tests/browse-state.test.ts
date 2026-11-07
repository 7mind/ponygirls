import assert from "node:assert/strict";
import { test } from "node:test";
import { browseHash, DEFAULT_SORT, readBrowseState, sameBrowseState, type BrowseState } from "../src/browse-state.ts";

// Behavioral-Active-Blackbox-Atomic: URL state is independent of browser/network state.
test("browse defaults to newest modified, inbox keeps its visible attention preset", () => {
  assert.deepEqual(readBrowseState("#/browse", false), { query: "", sort: DEFAULT_SORT, migrationError: null });
  assert.equal(readBrowseState("#/inbox", true).query, "human-attention:required");
  assert.equal(browseHash(readBrowseState("#/inbox", true), true), "#/inbox");
});

test("one visible expression and sort round-trip without secondary filter state", () => {
  const state: BrowseState = { query: '(type:todo OR 🐎) project:"p:unicode" tag:"Machine Learning" archived:true', sort: { field: "title", direction: "asc" }, migrationError: null };
  for (const inbox of [false, true]) {
    const hash = browseHash(state, inbox);
    assert.deepEqual(readBrowseState(hash, inbox), state);
    const params = new URLSearchParams(hash.slice(hash.indexOf("?") + 1));
    assert.equal(params.get("q"), state.query);
    for (const field of ["project", "tag", "archive"]) assert.equal(params.has(field), false);
  }
  assert.deepEqual(readBrowseState(browseHash({ ...state, sort: { field: "revision", direction: "desc" } }, false), false).sort, { field: "revision", direction: "desc" });
});

test("legacy URL scopes migrate into the whole Boolean body with exact quoted literals", () => {
  const params = new URLSearchParams({ q: "type:todo OR type:fact", project: ' p:"\\🐎 ', tag: " Machine Learning ", archive: "only" });
  const state = readBrowseState(`#/browse?${params}`, false);
  assert.equal(state.query, '(((type:todo OR type:fact) project:"p:\\"\\\\🐎") tag:"Machine Learning") archived:"true"');
  assert.equal(state.migrationError, null);
  assert.deepEqual(readBrowseState(browseHash(state, false), false), state, "canonical URL migrates only once");
  assert.equal(readBrowseState("#/browse?archive=show", false).query, 'archived:"all"');
  assert.equal(readBrowseState("#/browse?archive=only", false).query, 'archived:"true"');
  assert.equal(readBrowseState("#/inbox?project=example", true).query, '(human-attention:required) project:"example"');
});

test("unsafe legacy composition fails closed and preserves the original draft", () => {
  for (const query of ['tag:"unfinished', "type:todo OR", "(type:todo", "type:todo)", "type:todo OR (tag:)", "field[\"/n\"] >=", 'link:["depends-on","p:i"', 'link:["depends-on",]', 'link:["depends-on"]', 'field["/n"]', '(field["/n"])', 'field["/n"] OR type:fact', 'exists["/n"', "a".repeat(4090)]) {
    const hash = `#/browse?${new URLSearchParams({ q: query, project: "restricted", archive: "show" })}`;
    const state = readBrowseState(hash, false);
    assert.equal(state.query, query);
    assert.match(state.migrationError ?? "", /legacy URL filters/i);
    assert.throws(() => browseHash(state, false), /migration/i, "failed migrations cannot be serialized as an unscoped query");
  }
  const incomplete = readBrowseState(`#/browse?${new URLSearchParams({ q: 'tag:"unfinished' })}`, false);
  assert.equal(incomplete.query, 'tag:"unfinished', "ordinary drafts remain server-authoritative");
  assert.equal(incomplete.migrationError, null);
});

test("invalid URL sorting normalizes to known fields and directions", () => {
  assert.deepEqual(readBrowseState("#/browse?sort=SQL&direction=sideways", false).sort, DEFAULT_SORT);
  assert.deepEqual(readBrowseState("#/browse?sort=title", false).sort, { field: "title", direction: "asc" });
  assert.deepEqual(readBrowseState("#/browse?sort=revision", false).sort, { field: "revision", direction: "desc" });
  assert.equal(readBrowseState("#/browse?archive=unknown", false).query, "");
});

test("state equality includes the visible expression, migration error and both sorting dimensions", () => {
  const state = readBrowseState("#/browse", false);
  assert.equal(sameBrowseState(state, { ...state, sort: { ...state.sort } }), true);
  assert.equal(sameBrowseState(state, { ...state, query: "tag:new" }), false);
  assert.equal(sameBrowseState(state, { ...state, migrationError: "failed migration" }), false);
  assert.equal(sameBrowseState(state, { ...state, sort: { ...state.sort, direction: "asc" } }), false);
  assert.equal(sameBrowseState(state, { ...state, sort: { field: "title", direction: "desc" } }), false);
});
