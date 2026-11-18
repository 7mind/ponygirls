// Unsaved drafts live outside the editor and end only by save, discard or the end of the identity (spec §5 rule 7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { clearOnIdentityEnd, DraftStore, type StoredDraft } from "../src/edit-drafts.ts";
import type { Draft } from "../src/edit-draft.ts";

const draft = { title: "t" } as Draft;
const stored = (baseRevision: number): StoredDraft => ({ base: draft, draft, baseRevision, lastId: 7 });

test("a draft survives until it is dropped, and the end of the identity clears every draft", () => {
  const store = new DraftStore();
  const target = new EventTarget();
  clearOnIdentityEnd(store, target);
  let published = 0;
  store.subscribe(() => { published++; });
  store.put("p:a", stored(3));
  store.put("p:b", stored(1));
  assert.equal(store.get("p:a")!.baseRevision, 3);
  store.drop("p:b");
  store.drop("p:b");
  assert.equal(store.get("p:b"), undefined);
  assert.equal(published, 3, "dropping what is not there publishes nothing");
  target.dispatchEvent(new Event("account:changed"));
  assert.equal(store.get("p:a"), undefined);
  store.put("p:a", stored(4));
  target.dispatchEvent(new Event("account:invalidate"));
  assert.equal(store.get("p:a"), undefined);
});
