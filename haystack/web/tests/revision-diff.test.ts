// Behavioral-Active-Blackbox-Atomic; revision comparison of the record page (snapshot/compare, restore dialog).
import { test } from "node:test";
import assert from "node:assert/strict";
import { changedParts, compareRevisions, diffText, DIFF_CELL_LIMIT } from "../src/revision-diff.ts";
import type { Item } from "../src/api.ts";

const revision = (revision: number, document: Partial<Item["document"]>): Item => ({
  key: "p:i", revision,
  document: { title: "t", description: "d", fieldsJson: "{}", type: "todo", status: "actual", importance: "low", humanAttention: "cleared", links: [], tags: [], ...document },
  metadata: { createdAt: "2026-11-17T21:00:00Z", createdBy: "op", modifiedAt: "2026-11-17T21:00:00Z", modifiedBy: "op" },
});

test("a line diff pairs a changed line with its replacement, marks the changed words and folds long unchanged runs", () => {
  const context = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  const before = ["renews it every five minutes", ...context].join("\n");
  const after = ["renews it on every request", ...context, "added at the end"].join("\n");
  const diff = diffText(before, after, "lines");
  assert.equal(diff.kind, "lines");
  if (diff.kind !== "lines") throw new Error("expected lines");
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 1);
  assert.deepEqual(diff.lines.slice(0, 2), [
    { kind: "del", text: "renews it every five minutes", mark: { start: 10, end: 28 } },
    { kind: "add", text: "renews it on every request", mark: { start: 10, end: 26 } },
  ]);
  assert.deepEqual(diff.lines.slice(2).map((line) => line.kind === "skip" ? `skip ${line.count}` : `${line.kind} ${line.text}`), [
    "same line 0", "same line 1", "same line 2", "skip 4", "same line 7", "same line 8", "same line 9", "add added at the end",
  ]);
});

test("comparing revisions reports metadata, description paragraphs, links and field changes exactly and names the unchanged parts", () => {
  const older = revision(3, { description: "same\nparagraph\n\nold wording", importance: "normal", fieldsJson: '{"due":"2026-11-24","count":9007199254740993,"gone":true,"owner":"op"}' });
  const newer = revision(4, { description: "same\nparagraph\n\nnew wording", importance: "high", humanAttention: "required", links: [["relates-to", "p:other"]],
    fieldsJson: '{"due":"2026-12-01","count":9007199254740995,"owner":"op","notes":{"type":"md","content":"# New"}}' });
  const comparison = compareRevisions(older, newer);
  assert.deepEqual(comparison.metadata, [
    { name: "importance", before: "normal", after: "high" },
    { name: "human-attention", before: "cleared", after: "required" },
  ]);
  assert.deepEqual(comparison.description?.kind === "lines" && comparison.description.lines.map((line) => line.kind), ["same", "del", "add"]);
  assert.deepEqual(comparison.links?.kind === "lines" && comparison.links.lines, [{ kind: "add", text: "relates-to p:other", mark: null }]);
  assert.deepEqual(comparison.fields.map((field) => [field.name, field.label, field.state]), [
    ["due", "string", "changed"], ["count", "number", "changed"], ["notes", "Markdown", "added"], ["gone", "boolean", "removed"],
  ]);
  const due = comparison.fields[0]!.diff;
  assert.deepEqual(due.kind === "lines" && due.lines, [
    { kind: "del", text: "2026-11-24", mark: { start: 6, end: 10 } }, { kind: "add", text: "2026-12-01", mark: { start: 6, end: 10 } },
  ], "single words are marked by characters");
  const count = comparison.fields[1]!.diff;
  assert.deepEqual(count.kind === "lines" && count.lines.map((line) => line.kind === "skip" ? "" : line.text), ["9007199254740993", "9007199254740995"]);
  assert.deepEqual(comparison.unchanged, ["title", "type", "status", "tags", "owner"]);
  assert.deepEqual(changedParts(comparison), ["description", "importance", "human-attention", "links", "due", "count", "notes", "gone"]);
});

test("a diff whose changed region exceeds the cell limit is reported as too large instead of being computed", () => {
  const side = Math.ceil(Math.sqrt(DIFF_CELL_LIMIT)) + 1;
  const before = Array.from({ length: side }, (_, i) => `a${i}`).join("\n");
  const after = Array.from({ length: side }, (_, i) => `b${i}`).join("\n");
  assert.deepEqual(diffText(before, after, "lines"), { kind: "too-large", beforeLines: side, afterLines: side });
});
