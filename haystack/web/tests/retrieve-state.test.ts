import assert from "node:assert/strict";
import { test } from "node:test";
import { afterUnavailable, EMBEDDING_FAILED, NOT_CONFIGURED, planSearch, readRetrieveState, retrieveHash, type RetrieveState } from "../src/retrieve-state.ts";

// Behavioral-Active-Blackbox-Atomic: the search route and the client default rule are independent of browser/network state.
test("search route state round-trips query, explicit mode, exact project and archived; defaults are omitted", () => {
  assert.deepEqual(readRetrieveState("#/search"), { query: "", mode: null, project: "", includeArchived: false });
  assert.equal(retrieveHash({ query: "", mode: null, project: "", includeArchived: false }), "#/search");
  const state: RetrieveState = { query: '"harbour notes" -draft or 🐎 & type:todo', mode: "Semantic", project: " p:\"x\" ", includeArchived: true };
  const hash = retrieveHash(state);
  assert.deepEqual(readRetrieveState(hash), state);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(hash.slice(hash.indexOf("?") + 1))),
    { q: state.query, mode: "semantic", project: state.project, archived: "true" });
  assert.equal(readRetrieveState("#/search?q=a&mode=Hybrid").mode, null, "mode values are the lowercase names only");
  assert.equal(readRetrieveState("#/search?q=a&mode=bogus&archived=yes").mode, null);
  assert.equal(readRetrieveState("#/search?q=a&archived=yes").includeArchived, false);
});

test("without an explicit mode the search is hybrid when offered, else lexical with the notice; an explicit mode is kept", () => {
  assert.deepEqual(planSearch(null, ["Lexical", "Semantic", "Hybrid"]), { mode: "Hybrid", defaulted: true, notice: null });
  assert.deepEqual(planSearch(null, ["Lexical"]), { mode: "Lexical", defaulted: true,
    notice: "Hybrid search is not available on this server: semantic retrieval is not configured; lexical-only capability; showing lexical results" });
  assert.deepEqual(planSearch("Semantic", ["Lexical"]), { mode: "Semantic", defaulted: false, notice: null }, "an unoffered explicit mode is still requested");
  assert.deepEqual(planSearch("Lexical", ["Lexical", "Semantic", "Hybrid"]), { mode: "Lexical", defaulted: false, notice: null });
});

test("a typed unavailable answer re-runs only a defaulted hybrid lexically; an explicit mode is refused with the reason", () => {
  const offered = ["Lexical", "Semantic", "Hybrid"] as const;
  assert.deepEqual(afterUnavailable(planSearch(null, offered), EMBEDDING_FAILED),
    { kind: "lexical", notice: "Hybrid search is not available on this server: query embedding failed; showing lexical results" });
  for (const mode of ["Hybrid", "Semantic"] as const) {
    assert.deepEqual(afterUnavailable(planSearch(mode, offered), EMBEDDING_FAILED), { kind: "unavailable", reason: EMBEDDING_FAILED });
    assert.deepEqual(afterUnavailable(planSearch(mode, ["Lexical"]), NOT_CONFIGURED), { kind: "unavailable", reason: NOT_CONFIGURED });
  }
  assert.throws(() => afterUnavailable(planSearch(null, offered), "unavailable"), /not a retrieval unavailability reason/, "other 503 messages are not reasons");
});
