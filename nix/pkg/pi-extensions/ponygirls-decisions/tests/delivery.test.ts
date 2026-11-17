import assert from "node:assert/strict";
import test from "node:test";
import { deliveryHistory, fullToolVersion, indexMessage, receipt, versionKey, type IndexMessage, type JournalEntry } from "../src/delivery.ts";
import type { Decision } from "../src/store.ts";

function decision(number: number, patch: Partial<Decision>): Decision {
  return { project: "p", number, id: `Q${number}`, revision: 1, status: "pending", question: `SECRET TITLE ${number}`,
    context: "scope", answer: null, options: [], recommendation: "", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
    sessionId: "other", toolCallId: `call-${number}`, ...patch };
}
function persisted(update: IndexMessage): JournalEntry {
  return { type: "custom_message", customType: "decisions-context", content: update.content, details: receipt("p", "s", update.kind, update.records) };
}
const empty = () => deliveryHistory([], "p", "s");

test("initial index separates four groups, limits each, and never contains titles or answers", () => {
  const rows = [decision(1, { sessionId: "s" }), ...Array.from({ length: 7 }, (_, i) => decision(i + 2, {})),
    decision(9, { status: "answered", revision: 2, answer: "SECRET ANSWER" }), decision(10, { status: "dismissed", revision: 2 })];
  const update = indexMessage(rows, "s", empty()); assert.ok(update);
  assert.match(update.content, /Unanswered in current session: Q1/);
  assert.match(update.content, /Unanswered in other sessions: Q2, Q3, Q4, Q5, Q6 \(\+2 more\)/);
  assert.match(update.content, /Answered in other sessions: Q9/);
  assert.match(update.content, /Dismissed in other sessions: Q10/);
  assert.doesNotMatch(update.content, /SECRET|\[this session\]/);
  assert.deepEqual(update.records.map(q => q.id), ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q9", "Q10"]);
  const history = deliveryHistory([persisted(update)], "p", "s");
  assert.equal(history.full.size, 0, "a summary is not an answer receipt");
  const remaining = indexMessage(rows, "s", history); assert.ok(remaining);
  assert.deepEqual(remaining.records.map(q => q.id), ["Q7", "Q8"]);
  assert.equal(indexMessage(rows, "s", deliveryHistory([persisted(update), persisted(remaining)], "p", "s")), null);
});

test("pending ordering uses creation time and resolutions use latest modification, not highest ID", () => {
  const rows = [decision(10, { createdAt: "2026-02-01" }), decision(1, { createdAt: "2026-03-01" }),
    decision(2, { status: "answered", revision: 2, answer: "x", updatedAt: "2026-04-01" }),
    decision(20, { status: "answered", revision: 2, answer: "x", updatedAt: "2026-03-01" })];
  const update = indexMessage(rows, "s", empty()); assert.ok(update);
  assert.match(update.content, /Unanswered in other sessions: Q10, Q1/);
  assert.match(update.content, /Answered in other sessions: Q2, Q20/);
});

test("changes are revision-sensitive, bounded, and explicitly withdraw reopened answers", () => {
  const first = Array.from({ length: 9 }, (_, i) => decision(i + 1, { status: "answered", revision: 2, answer: "old" }));
  const one = indexMessage(first, "s", empty()); assert.ok(one);
  const two = indexMessage(first, "s", deliveryHistory([persisted(one)], "p", "s")); assert.ok(two);
  const entries = [persisted(one), persisted(two)];
  const rows: Decision[] = first.map(q => ({ ...q, revision: 3, answer: "new" }));
  rows[0] = { ...rows[0]!, status: "pending", answer: null };
  rows[1] = { ...rows[1]!, status: "dismissed", answer: null };
  const update = indexMessage(rows, "s", deliveryHistory(entries, "p", "s")); assert.ok(update);
  assert.equal(update.records.length, 5);
  assert.match(update.content, /Q1: reopened; previous answer withdrawn/);
  assert.match(update.content, /Q2: dismissed without an answer; not approval/);
  assert.match(update.content, /answer revised/);
  assert.match(update.content, /\+4 more changes/);
  const next = indexMessage(rows, "s", deliveryHistory([...entries, persisted(update)], "p", "s")); assert.ok(next);
  assert.equal(next.records.length, 4);
  assert.ok(next.records.every(q => !update.records.some(old => old.id === q.id)));
});

test("newly discovered resolutions do not invent an unobserved previous status", () => {
  const initial = indexMessage([decision(1, {})], "s", empty()); assert.ok(initial);
  const history = deliveryHistory([persisted(initial)], "p", "s");
  const unknown = indexMessage([decision(2, { revision: 5, status: "answered", answer: "yes" })], "s", history); assert.ok(unknown);
  assert.match(unknown.content, /Q2: answered \(revision 5/);
  assert.doesNotMatch(unknown.content, /unanswered → answered/);
  const dismissed = decision(1, { revision: 2, status: "dismissed" });
  history.versions.set("Q1", dismissed);
  const changed = indexMessage([decision(1, { revision: 3, status: "answered", answer: "yes" })], "s", history); assert.ok(changed);
  assert.match(changed.content, /dismissed → answered/);
});

test("session/project receipts are isolated; persisted history does not require the active branch", () => {
  const rows = [decision(1, {})];
  const update = indexMessage(rows, "s", empty()); assert.ok(update);
  const journal = [persisted(update)];
  assert.equal(indexMessage(rows, "s", deliveryHistory(journal, "p", "s")), null);
  assert.ok(indexMessage(rows, "fork", deliveryHistory(journal, "p", "fork")));
  assert.equal(deliveryHistory(journal, "other-project", "s").initialized, false);
});

test("only complete successful model-facing tool JSON consumes full-delivery receipts", () => {
  const q = decision(1, { status: "answered", answer: "yes", revision: 2 });
  const message = { role: "toolResult", toolName: "decisions", details: q, content: [{ type: "text", text: JSON.stringify(q) }] };
  assert.deepEqual(fullToolVersion(message, "p"), { id: "Q1", revision: 2, status: "answered" });
  const history = deliveryHistory([{ type: "message", message }], "p", "s");
  assert.ok(history.full.has(versionKey(q)));
  assert.equal(indexMessage([q], "s", history), null);
  assert.equal(fullToolVersion({ ...message, isError: true }, "p"), null);
  assert.equal(fullToolVersion({ ...message, content: [{ type: "text", text: "Q1 created" }] }, "p"), null, "idempotent ask details may contain an answer never shown to the model");
  assert.equal(fullToolVersion({ ...message, content: [{ type: "text", text: JSON.stringify({ questions: [q] }) }] }, "p"), null);
  assert.equal(fullToolVersion(message, "another-project"), null);
});

test("own answer notices and tool receipts are distinct from discovery and survive journal replay", () => {
  const q = decision(1, { status: "answered", answer: "yes", revision: 2, sessionId: "s" });
  const entry: JournalEntry = { type: "custom_message", customType: "decisions-answer", details: { ...receipt("p", "s", "full", [q]), id: q.id, revision: q.revision } };
  const history = deliveryHistory([entry], "p", "s");
  assert.ok(history.full.has("Q1:2"));
  assert.equal(history.initialized, false);
  assert.equal(indexMessage([q], "s", history), null);
  assert.equal(deliveryHistory([entry], "p", "fork").full.size, 0);
  assert.throws(() => deliveryHistory([{ ...entry, details: { ...receipt("p", "s", "full", [q]), records: [{}] } }], "p", "s"), /Invalid decisions delivery record/);
});
