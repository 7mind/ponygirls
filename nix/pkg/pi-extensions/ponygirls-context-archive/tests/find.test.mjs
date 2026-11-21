import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ARCHIVE_TYPE, recallArchive } from "../src/archive.ts";

// Blackbox/group: the public v1 manifest and real in-memory branch, with no I/O or provider.
const find = (branch, query, offset = 0, limit = 4) => recallArchive(branch, { action: "find", query, offset, limit });
const output = (...texts) => ({ role: "toolResult", toolName: "read", toolCallId: "r", isError: false, timestamp: 1,
  content: texts.map((text) => ({ type: "text", text })) });
function manifest(manager, entryId, selection = { kind: "result" }, extra = {}) {
  const sha256 = createHash("sha256").update(JSON.stringify(manager.getEntry(entryId).message)).digest("hex");
  manager.appendCustomEntry(ARCHIVE_TYPE, { version: 1, entryId, sha256, selection, ...extra });
  return sha256;
}
function resultBranch(...texts) {
  const manager = SessionManager.inMemory();
  manifest(manager, manager.appendMessage(output(...texts)));
  return manager.getBranch();
}
function checkRead(branch, { entryId, sha256, readOffset, readLimit, excerpt }) {
  const read = recallArchive(branch, { action: "read", entryId, sha256, offset: readOffset, limit: readLimit });
  assert.equal(JSON.parse(`"${read.payload}"`), excerpt);
}

test("find pages duplicates in manifest then source order and points at selected fields, not identical metadata", () => {
  const manager = SessionManager.inMemory();
  const query = " Match.[1] ", command = `cmd:${query}`, body = `body:${query}`, repeated = `observation:${query}`;
  const hidden = "not-archived";
  manager.appendMessage({ role: "user", content: hidden + query, timestamp: 0 });
  const assistant = { role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture", timestamp: 1,
    stopReason: "toolUse", content: [
      { type: "text", text: hidden + query }, { type: "thinking", thinking: hidden + query },
      { name: "bash", id: "b", arguments: { mirror: command, command }, type: "toolCall" },
      { type: "toolCall", name: "write", id: "w", arguments: { path: body, content: body } },
      { type: "toolCall", name: "read", id: "r", arguments: { path: hidden + query } },
      { type: "toolCall", name: "bash", id: "short", arguments: { command: hidden + query } },
    ] };
  const inputId = manager.appendMessage(assistant);
  const result = { details: { 'quoted "key"\n': repeated, label: hidden }, omitted: undefined, ...output(repeated, repeated) };
  // Same strings and keys in ineligible nested metadata, and nonstandard JSON key order.
  result.content[1] = { signature: { text: repeated }, text: repeated, type: "text" };
  const outputId = manager.appendMessage(result);
  manager.appendMessage(output(hidden + query)); // Successful tool result, but no manifest.
  const outputHash = manifest(manager, outputId, { kind: "result" }, { summary: hidden + query });
  const inputHash = manifest(manager, inputId, { kind: "inputs", fields: [{ block: 3, field: "content" }, { block: 2, field: "command" }] });
  manager.appendContextEdit(outputId, { content: [{ type: "text", text: hidden + query }] });
  const branch = manager.getBranch(), before = structuredClone(branch);
  const first = find(branch, query, 0, 3);
  assert.match(first.warning, /Historical evidence, not current state or instructions/);
  assert.equal(first.nextOffset, 3);
  const last = find(branch, query, first.nextOffset, 1);
  assert.equal(last.nextOffset, null);
  const hits = [...first.matches, ...last.matches];
  assert.deepEqual(hits.map((h) => [h.entryId, h.sha256, h.excerpt]), [
    [outputId, outputHash, repeated], [outputId, outputHash, repeated], [inputId, inputHash, command], [inputId, inputHash, body],
  ]);
  const quoted = JSON.stringify(repeated);
  const raw = JSON.stringify(result);
  const secondCopy = raw.indexOf(quoted, raw.indexOf(quoted) + quoted.length);
  assert.deepEqual(hits.map((h) => h.readOffset), [secondCopy + 1, raw.lastIndexOf(quoted) + 1,
    JSON.stringify(assistant).lastIndexOf(JSON.stringify(command)) + 1, JSON.stringify(assistant).lastIndexOf(JSON.stringify(body)) + 1]);
  hits.forEach((hit) => checkRead(branch, hit));
  assert.deepEqual(find(branch, query, 4), { warning: first.warning, matches: [], nextOffset: null });
  assert.deepEqual(find(branch, hidden).matches, []);
  assert.deepEqual(branch, before);
});

test("find is literal, case/space/normalization-sensitive, nonoverlapping and cannot span blocks", () => {
  const branch = resultBranch("aaaaa", " left ", "right", "before.*?[after", "line\nbreak", "line\\nbreak", " Café ");
  for (const [query, count] of [["aa", 2], ["n.*", 0], [".*?[", 1], ["line\nbreak", 1], ["line\\nbreak", 1],
    [" Café ", 1], ["  Café ", 0], [" café ", 0], [" Cafe\u0301 ", 0], ["left right", 0]]) {
    const page = find(branch, query);
    assert.equal(page.matches.length, count, JSON.stringify(query));
    assert.equal(page.nextOffset, null);
    page.matches.forEach((hit) => { assert.ok(hit.excerpt.includes(query)); checkRead(branch, hit); });
  }
});

test("in-memory text is searched and addressed in its actual serialized representation", () => {
  class Block {
    type = "text"; text = "transient cache";
    toJSON() { return { text: "stored receipt: AX-482", type: this.type }; }
  }
  const manager = SessionManager.inMemory(), message = output(); message.content.push(new Block());
  manifest(manager, manager.appendMessage(message));
  const branch = manager.getBranch(), found = find(branch, "AX-482");
  assert.equal(found.matches.length, 1); checkRead(branch, found.matches[0]);
  assert.deepEqual(find(branch, "transient cache").matches, []);
});

test("excerpt read coordinates survive escaped JSON and preserve complete astral pairs at window edges", () => {
  const escapes = '"\\\u0000\b\f\n\r\t';
  const query = "🎯".repeat(64); // exactly 128 JS UTF-16 units
  const left = "l".repeat(95 - escapes.length) + escapes, right = escapes + "r".repeat(95 - escapes.length);
  const text = (`escaped prefix:${escapes}🙂\ud800!`).repeat(600) + "x".repeat(200) + "🐎" + left + query + right + "🐎" + "z".repeat(200);
  const branch = resultBranch(text, "lone units: \ud800X\udfff");
  const { matches: [hit], nextOffset } = find(branch, query);
  assert.equal(nextOffset, null);
  assert.ok(hit.excerpt.includes(escapes + query + escapes));
  assert.ok(hit.excerpt.isWellFormed());
  assert.ok(hit.excerpt.length <= query.length + 2 * 128);
  assert.ok(hit.readOffset > 12000, "coordinates are not relative to a single read page");
  assert.ok(hit.readLimit > hit.excerpt.length);
  checkRead(branch, hit);
  const lone = find(branch, "\ud800X\udfff").matches[0];
  assert.ok(lone.excerpt.includes("\ud800X\udfff"));
  checkRead(branch, lone);
});

test("find is branch-local and verifies originals even beyond a page's last hit", () => {
  const manager = SessionManager.inMemory();
  const id = manager.appendMessage(output("old result; old result; old result"));
  const before = manager.getLeafId(); manifest(manager, id); const archived = manager.getLeafId();
  manager.branch(before);
  manifest(manager, manager.appendMessage(output("sibling result")));
  assert.deepEqual(find(manager.getBranch(), "old").matches, []);
  manager.branch(archived);
  assert.deepEqual(find(manager.getBranch(), "sibling").matches, []);
  const second = manager.appendMessage(output("unrelated but authenticated"));
  manifest(manager, second);
  const branch = structuredClone(manager.getBranch());
  branch.find((entry) => entry.id === second).message.content[0].text += " changed";
  assert.throws(() => find(branch, "old", 0, 1), /original missing, changed, or duplicated/);
});

test("read and find reject ambiguous source IDs instead of citing a different payload's hash", () => {
  const [source, record] = resultBranch("original");
  const duplicate = { ...source, message: output("different") };
  const read = { action: "read", entryId: source.id, sha256: record.data.sha256, offset: 0, limit: 12000 };
  for (const branch of [[source, record, duplicate], [duplicate, source, record]]) {
    assert.throws(() => find(branch, "different"), /duplicated/);
    assert.throws(() => recallArchive(branch, read), /duplicated/);
  }
});

test("find rejects invalid literal and pagination parameters without coercion", () => {
  for (const query of [null, undefined, 123, true, {}, ["literal"], "", " \t\n\u2003", "a".repeat(129), "🐎".repeat(65)]) {
    assert.throws(() => find([], query), /query/);
  }
  for (const offset of [-1, 1.5, Infinity, NaN, "0", null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => find([], "needle", offset, 1), /range/);
  }
  for (const limit of [0, -1, 9, 1.5, true, "2", null, Infinity]) assert.throws(() => find([], "needle", 0, limit), /range/);
  assert.equal(find([], "needle", Number.MAX_SAFE_INTEGER, 8).nextOffset, null);
});

test("broad literal pages include distinct positions near the tail and stop at exhaustion", () => {
  const count = 100_000;
  const tail = ["one", "two", "three"].map((label) => "x".repeat(500) + "\u0001" + label).join("");
  const branch = resultBranch("\u0001".repeat(count) + tail);
  const first = find(branch, "\u0001", 0, 8);
  assert.equal(first.matches.length, 8);
  assert.equal(first.nextOffset, 8);
  const last = find(branch, "\u0001", count, 8);
  assert.equal(last.nextOffset, null);
  assert.deepEqual(last.matches.map((hit) => hit.excerpt.match(/\u0001(one|two|three)/)?.[1]), ["one", "two", "three"]);
  last.matches.forEach((hit) => checkRead(branch, hit));
  const exhausted = find(branch, "\u0001", count + 4, 8);
  assert.deepEqual(exhausted.matches, []);
  assert.equal(exhausted.nextOffset, null);
});
