import assert from "node:assert/strict";
import { test } from "node:test";
import { appendField, appendFilter, completionEdit, completionRange } from "../src/query-edit.ts";

test("shortcuts conjoin the entire OR body and encode exact literals", () => {
  assert.equal(appendFilter("type:todo OR type:fact", "tag", 'a b:"\\🐎'), '(type:todo OR type:fact) tag:"a b:\\\"\\\\🐎"');
  assert.equal(appendField("type:todo OR type:fact", "project"), "(type:todo OR type:fact) project:");
  assert.equal(appendFilter("", "human-attention", "required"), 'human-attention:"required"');
  assert.equal(appendFilter('tag:"unfinished', "type", "todo"), null);
  assert.equal(appendField("type:todo OR", "tag"), null);
  assert.equal(appendField('tag:"incomplete', "type"), null);
  assert.equal(appendField("type:todo (", "tag"), null);
  assert.equal(appendField("type:todo AND NOT", "tag"), null);
  assert.equal(appendField("type:todo OR ()", "tag"), null);
  assert.equal(appendField("type:todo OR (type:fact AND)", "tag"), null);
  assert.equal(appendField("type:todo OR (tag:)", "status"), null);
  assert.equal(appendFilter("type:todo OR (modified-at >=)", "archived", "all"), null);
  assert.equal(appendField('tag:"paren (quoted)"', "project"), '(tag:"paren (quoted)") project:');
  assert.equal(appendFilter("", "tag", "value\nwith control"), 'tag:"value\\nwith control"');
});

test("completion replaces whole unquoted token but never touches quoted/selected text", () => {
  assert.deepEqual(completionRange("typEXTRA status:actual", 2, 2), { start: 0, end: 8, fragment: "ty" });
  assert.equal(completionRange('tag:"foo bar"', 7, 7), null);
  assert.equal(completionRange("type:todo", 2, 5), null);
  assert.deepEqual(completionRange("type:todo", 2, 2), { start: 0, end: 9, fragment: "ty" });
  assert.equal(completionRange('tag:"closed"', 12, 12), null);
  assert.equal(completionRange('field["/x"]', 8, 8), null);
});

test("completion inserts a separator after operators but never exceeds the query limit", () => {
  assert.deepEqual(completionEdit("type:todo AN", { start: 10, end: 12, fragment: "AN" }, "AND"), { query: "type:todo AND ", caret: 14 });
  assert.deepEqual(completionEdit("ty", { start: 0, end: 2, fragment: "ty" }, "type:"), { query: "type:", caret: 5 });
  assert.deepEqual(completionEdit("type:f", { start: 0, end: 6 }, "type:fact"), { query: "type:fact ", caret: 10 });
  assert.deepEqual(completionEdit("type:f status:actual", { start: 0, end: 6 }, "type:fact"), { query: "type:fact status:actual", caret: 9 });
  assert.deepEqual(completionEdit("(type:f)", { start: 1, end: 7 }, "type:fact"), { query: "(type:fact)", caret: 10 });
  assert.deepEqual(completionEdit("ty fact", { start: 0, end: 2, fragment: "ty" }, "type:"), { query: "type: fact", caret: 5 });
  assert.equal(completionEdit("a".repeat(4091) + " ty", { start: 4092, end: 4094, fragment: "ty" }, "type:"), null);
});
