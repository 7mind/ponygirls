// The record editor's draft: what changed (named in the leave dialog), what blocks saving (named next to the field and in
// the summary) and the document that is sent (spec §3.2 Edit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDocumentJson, type Item } from "../src/api.ts";
import { addTag, changedParts, documentJsonOf, draftOf, fieldAnchor, isRemoteChange, linkAnchor, problemsOf, type Draft } from "../src/edit-draft.ts";

// Compact, unindented and with a big integer: untouched fields are sent byte for byte.
const FIELDS = '{"count":9007199254740993,"notes":{"type":"md","content":"# N"},"due":"2026-12-01"}';
const item: Item = {
  key: "ui:todo", revision: 4, metadata: { createdAt: "", createdBy: "", modifiedAt: "", modifiedBy: "" },
  document: { title: "Rework", description: "d", fieldsJson: FIELDS, type: "todo", status: "actual", importance: "high", humanAttention: "required",
    links: [["supersedes", "ui:old"], ["relates-to", "ui:other"]], tags: ["docs", "store"] },
};
let ids = 0;
const nextId = () => ++ids;
const fresh = (): Draft => draftOf(item, nextId);

test("an untouched draft has no changes and no problems and sends the original fields and links byte for byte", () => {
  const draft = fresh();
  assert.deepEqual(changedParts(fresh(), draft), []);
  assert.deepEqual(problemsOf(draft), []);
  assert.equal(documentJsonOf(draft), buildDocumentJson({ title: "Rework", description: "d", fieldsRaw: FIELDS, type: "todo", status: "actual", importance: "high",
    attention: "required", links: item.document.links, tags: ["docs", "store"] }));
});

test("edits are named; blocking problems carry the anchor of their field and no document is built for them", () => {
  const base = fresh();
  const draft = fresh();
  draft.title = "Rework the store";
  draft.needsReview = false;
  draft.tags = addTag(draft.tags, " store, new ,docs");
  draft.links = [...draft.links.slice(1), { id: nextId(), relation: "relates-to", target: "ui:third" }];
  assert.deepEqual(draft.tags, ["docs", "store", "new"]);
  assert.deepEqual(changedParts(base, draft), ["title", "needs review", "tags", "links"]);
  const typed = draft.fields.editing;
  assert.ok(typed !== null && typed.shape === "rows");
  typed.rows[2]!.value = { kind: "string", text: "2027-01-01" };
  typed.rows[0]!.value = { kind: "number", text: "nine" };
  draft.links.push({ id: nextId(), relation: "motivated-by", target: " " });
  const problems = problemsOf(draft);
  assert.deepEqual(problems.map((problem) => [problem.anchor, problem.where, problem.message.replace(/:.*$/, "")]), [
    [fieldAnchor(typed.rows[0]!.id), "Field count", "Not a JSON number"],
    [linkAnchor(draft.links[2]!.id), "Links, row 3", "Enter the key of the target record, for example ponygirls"]]);
  assert.deepEqual(changedParts(base, draft), ["title", "needs review", "tags", "links", "fields"]);
  assert.throws(() => documentJsonOf(draft), /problems/);
});

test("a live announcement is a remote change unless it is the write this draft left unconfirmed arriving", () => {
  const record = { key: "ui:todo", revision: 4 };
  const unconfirmed = { key: "ui:todo", expectedRevision: 4 };
  assert.equal(isRemoteChange({ key: null, revision: null }, record, undefined), true, "after a resynchronization anything may have changed");
  assert.equal(isRemoteChange({ key: "ui:other", revision: 9 }, record, undefined), false);
  assert.equal(isRemoteChange({ key: "ui:todo", revision: 4 }, record, undefined), false, "not newer than the edited revision");
  assert.equal(isRemoteChange({ key: "ui:todo", revision: 5 }, record, undefined), true);
  assert.equal(isRemoteChange({ key: "ui:todo", revision: 5 }, record, unconfirmed), false, "revision 5 is what the unconfirmed write creates");
  assert.equal(isRemoteChange({ key: "ui:todo", revision: 6 }, record, unconfirmed), true);
});
