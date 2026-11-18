// Unsaved drafts live outside the editor and end only by their confirmed save, discard or the end of the identity (spec §5 rule 7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DraftStore, type Confirmation, type StoredDraft } from "../src/edit-drafts.ts";
import type { Draft } from "../src/edit-draft.ts";

const draft = (title: string) => ({ title }) as Draft;
const original = draft("original");
const stored = (edit: Draft, baseRevision: number, base: Draft = original): StoredDraft => ({ base, draft: edit, baseRevision, lastId: 7 });

test("a draft is its owner's: confirming the same user keeps it, another user or none ends every draft, and none keeps nothing", () => {
  const store = new DraftStore();
  store.put("p:a", store.lineage(), stored(draft("a"), 1));
  assert.equal(store.get("p:a"), undefined, "nothing is kept while no user is known");
  store.observeOwner("op");
  store.put("p:a", store.lineage(), stored(draft("a"), 3));
  let published = 0;
  store.subscribe(() => { published++; });
  store.observeOwner("op");
  assert.equal(store.get("p:a")!.baseRevision, 3);
  assert.equal(published, 0, "the same user again changes nothing");
  store.observeOwner("alice");
  assert.equal(store.get("p:a"), undefined);
  store.observeOwner("op");
  assert.equal(store.get("p:a"), undefined, "ended, not hidden");
  store.put("p:b", store.lineage(), stored(draft("b"), 1));
  store.observeOwner(null);
  assert.equal(store.get("p:b"), undefined);
});

test("a confirmed write ends exactly the generation it sent; later edits of its lineage stay, based on what was saved", () => {
  const store = new DraftStore();
  store.observeOwner("op");
  const confirmations: Confirmation[] = [];
  store.subscribeConfirmed((confirmation) => { confirmations.push(confirmation); });
  const line = store.lineage();
  const first = draft("first");
  store.submit("p:a", line, "r1", stored(first, 1));
  store.put("p:a", line, stored(first, 1));
  store.confirmed("not-the-editors", 9);
  assert.equal(store.get("p:a")!.draft, first, "another write reconciles nothing");
  store.confirmed("r1", 2);
  assert.equal(store.get("p:a"), undefined, "rewriting the same edit is the same generation, which the save ended");
  // Edited after submitting (in the same or a later editor of the lineage).
  const second = draft("second"), third = draft("third");
  store.submit("p:a", line, "r2", stored(second, 2, first));
  store.put("p:a", line, stored(third, 2, first));
  store.confirmed("r2", 3);
  const kept = store.get("p:a")!;
  assert.deepEqual([kept.draft, kept.base, kept.baseRevision], [third, second, 3], "the later edit saves on top of the reader's own save");
  store.confirmed("r2", 3);
  assert.equal(store.get("p:a")!.base, second, "a confirmation counts once");
  // A lineage started after the submitted one was discarded is not the saved one's.
  store.submit("p:a", line, "r3", stored(draft("fourth"), 3, second));
  store.drop("p:a");
  const fresh = draft("fresh");
  store.put("p:a", store.lineage(), stored(fresh, 3));
  store.confirmed("r3", 4);
  assert.deepEqual([store.get("p:a")!.base, store.get("p:a")!.baseRevision], [original, 3]);
  assert.deepEqual(confirmations.map(({ key, lineage, draft, revision, kept }) => [key, lineage, draft.title, revision, kept]),
    [["p:a", line, "first", 2, false], ["p:a", line, "second", 3, true], ["p:a", line, "fourth", 4, false]], "a mounted editor of the lineage adopts every confirmation");
});
