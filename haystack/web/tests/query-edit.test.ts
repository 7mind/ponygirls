import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFilter, completionEdit, completionRange } from "../src/query-edit.ts";

test("legacy scope edits conjoin the entire OR body and encode exact literals", () => {
  assert.equal(appendFilter("type:todo OR type:fact", "tag", 'a b:"\\🐎'), '(type:todo OR type:fact) tag:"a b:\\\"\\\\🐎"');
  assert.equal(appendFilter("", "human-attention", "required"), 'human-attention:"required"');
  assert.equal(appendFilter('tag:"unfinished', "type", "todo"), null);
  assert.equal(appendFilter("type:todo OR", "tag", "example"), null);
  assert.equal(appendFilter('tag:"incomplete', "type", "fact"), null);
  assert.equal(appendFilter("type:todo (", "tag", "example"), null);
  assert.equal(appendFilter("type:todo AND NOT", "tag", "example"), null);
  assert.equal(appendFilter("type:todo OR ()", "tag", "example"), null);
  assert.equal(appendFilter("type:todo OR (type:fact AND)", "tag", "example"), null);
  assert.equal(appendFilter("type:todo OR (tag:)", "status", "actual"), null);
  assert.equal(appendFilter("type:todo OR (modified-at >=)", "archived", "all"), null);
  assert.equal(appendFilter('tag:"paren (quoted)"', "project", "example"), '(tag:"paren (quoted)") project:"example"');
  assert.equal(appendFilter("", "tag", "value\nwith control"), 'tag:"value\\nwith control"');
  assert.equal(appendFilter('field["/n"] >= 3 OR exists["/x"]', "project", "example"), '(field["/n"] >= 3 OR exists["/x"]) project:"example"');
  assert.equal(appendFilter('link:["depends-on","p:i"]', "project", "example"), '(link:["depends-on","p:i"]) project:"example"');
  assert.equal(appendFilter('field["/a]("] = "square [ bracket]"', "project", "example"), '(field["/a]("] = "square [ bracket]") project:"example"');
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
