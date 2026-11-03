import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ARCHIVE_TYPE, RECALL_TOOL, DEFAULT_POLICY, planArchive, recallArchive, restoreArchive, restoreRequest } from "../src/archive.ts";

export const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
export function assistant(content, overrides = {}) {
  return { role: "assistant", content, api: "openai-completions", provider: "fixture", model: "fixture", usage, stopReason: content.some((p) => p.type === "toolCall") ? "toolUse" : "stop", timestamp: 1, ...overrides };
}
const policy = { ...DEFAULT_POLICY, keepRecentTurns: 1, keepRecentTokens: 0, minPayloadChars: 1000, minBatchTokens: 1 };
export function apply(manager, drafts) {
  for (const draft of drafts) {
    if (draft.type === "custom") manager.appendCustomEntry(draft.customType, draft.data);
    else if (draft.type === "context_edit") manager.appendContextEdit(draft.targetId, draft.replacement);
    else throw new Error(`Unexpected draft ${draft.type}`);
  }
}
export function history(manager = SessionManager.inMemory()) {
  manager.appendMessage({ role: "user", content: "Preserve my exact authorization. No remote writes.", timestamp: 1 });
  const input = manager.appendMessage(assistant([
    { type: "thinking", thinking: "causal reasoning", thinkingSignature: "opaque-reasoning", redacted: true },
    { type: "text", text: "Old experiment and rejected hypothesis", textSignature: "signed-prose" },
    { type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "# ORIGINAL SCRIPT\n" + "x".repeat(9000), timeout: 10 }, namespace: "functions" },
    { type: "toolCall", id: "read-2", name: "read", arguments: { path: "fixture.txt" } },
  ]));
  const output = manager.appendMessage({ role: "toolResult", toolCallId: "bash-1", toolName: "bash", content: [{ type: "text", text: "OLD=failed; at t1. Not current.\n" + "z".repeat(15000) }], isError: false, timestamp: 2, details: { exitCode: 0 } });
  const sibling = manager.appendMessage({ role: "toolResult", toolCallId: "read-2", toolName: "read", content: [{ type: "text", text: "small sibling result" }], isError: false, timestamp: 3 });
  manager.appendMessage(assistant([{ type: "text", text: "Current state: work pending; do not confuse t1 with now." }], { timestamp: 4 }));
  return { manager, input, output, sibling };
}
const context = (tokens) => ({ tokens, protectedTargets: new Set() });
const plan = (f, custom = policy) => planArchive(f.manager.getBranch(), f.manager.buildSessionProjection().entries, 4000, custom, context(null));
const catalog = (manager) => recallArchive(manager.getBranch(), { action: "list", offset: 0, limit: 20 });

// Behavioral-active blackbox/group: actual public SessionManager, no filesystem/provider.
test("mechanical release is deterministic, surgical, reversible and never a continuation", () => {
  const f = history();
  const before = structuredClone(f.manager.getBranch());
  const first = plan(f);
  assert.ok(first.entries.length >= 4);
  assert.deepEqual(first, plan(f));
  assert.deepEqual(f.manager.getBranch(), before);
  for (let i = 0; i < first.entries.length; i += 2) {
    assert.equal(first.entries[i].type, "custom");
    assert.equal(first.entries[i].customType, ARCHIVE_TYPE);
    assert.equal(first.entries[i + 1].type, "context_edit");
  }
  apply(f.manager, first.entries);
  const projected = f.manager.buildSessionProjection().messages;
  const raw = before.find((e) => e.id === f.input).message;
  const edited = projected.find((m) => m.role === "assistant" && m.stopReason === "toolUse");
  assert.deepEqual(edited.content.slice(0, 2), raw.content.slice(0, 2));
  assert.deepEqual(edited.content[3], raw.content[3]);
  assert.equal(edited.content[2].id, "bash-1");
  assert.equal(edited.content[2].namespace, "functions");
  assert.equal(edited.content[2].arguments.timeout, 10);
  assert.match(edited.content[2].arguments.command, /context_recall/);
  assert.deepEqual({ ...edited, content: raw.content }, raw);
  assert.deepEqual(f.manager.getBranch().slice(0, before.length), before);
  assert.equal(plan(f).entries.length, 0, "no repeated rewrite/cache churn");
  const restored = restoreRequest(f.manager.getBranch(), structuredClone(projected));
  assert.deepEqual(restored, before.filter((e) => e.type === "message").map((e) => e.message));
  apply(f.manager, restoreArchive(f.manager.getBranch(), f.manager.buildSessionProjection().entries));
  assert.deepEqual(f.manager.buildSessionProjection().messages, restored);
  assert.deepEqual(restoreArchive(f.manager.getBranch(), f.manager.buildSessionProjection().entries), []);
  assert.deepEqual(plan(f).entries, [], "restored entries stay pinned against repeated off/on churn");
});

test("provider-accounted pressure triggers archival below the character-estimated watermark", () => {
  const f = history();
  const branch = f.manager.getBranch(); const projection = f.manager.buildSessionProjection().entries;
  assert.equal(planArchive(branch, projection, 1000000, policy, context(null)).entries.length, 0);
  const planned = planArchive(branch, projection, 1000000, policy, context(806884));
  assert.equal(planned.entries.filter((e) => e.type === "context_edit").length, 2);
  assert.match(planned.reason, /proposed/);
});

test("hysteresis, batch minimum, target bound, six-turn and token-floor protection", () => {
  const f = history();
  assert.equal(planArchive(f.manager.getBranch(), f.manager.buildSessionProjection().entries, 1000000, policy, context(null)).entries.length, 0);
  assert.equal(plan(f, { ...policy, minBatchTokens: 100000 }).entries.length, 0);
  assert.equal(plan(f, { ...policy, keepRecentTurns: 6 }).entries.length, 0);
  assert.equal(plan(f, { ...policy, keepRecentTokens: 100000 }).entries.length, 0);
  assert.equal(plan(f, { ...policy, maxTargets: 1 }).entries.filter((e) => e.type === "context_edit").length, 1);
  assert.throws(() => planArchive([], [], 0, policy, context(null)), /positive model context/);
  assert.equal(planArchive(f.manager.getBranch(), f.manager.buildSessionProjection().entries, 4000, policy, context(0)).entries.length, 0);
  for (const tokens of [-1, NaN, Infinity]) assert.throws(() => planArchive([], [], 4000, policy, context(tokens)), /non-negative context usage/);
});

for (const protection of ["labeled input", "labeled output", "error", "image", "unfinished sibling", "duplicate result", "foreign input edit", "foreign output edit", "name mismatch", "aborted assistant"]) {
  test(`protect complete tool group: ${protection}`, () => {
    const f = history();
    if (protection === "labeled input") f.manager.appendLabelChange(f.input, "keep");
    if (protection === "labeled output") f.manager.appendLabelChange(f.output, "keep");
    const entries = f.manager.getEntries();
    const output = entries.find((e) => e.id === f.output);
    if (protection === "error") output.message.isError = true;
    if (protection === "image") output.message.content.push({ type: "image", data: "AA==", mimeType: "image/png" });
    if (protection === "unfinished sibling") entries.find((e) => e.id === f.sibling).message.toolCallId = "unmatched";
    if (protection === "duplicate result") f.manager.appendMessage(structuredClone(output.message));
    if (protection === "name mismatch") output.message.toolName = "different";
    if (protection === "aborted assistant") entries.find((e) => e.id === f.input).message.stopReason = "aborted";
    if (protection.startsWith("foreign")) f.manager.appendContextEdit(protection === "foreign input edit" ? f.input : f.output, { content: [{ type: "text", text: "foreign projection" }] });
    // Reconstruct the selected branch after deliberately altering protocol fixtures.
    const manager = SessionManager.inMemory("/fixture", undefined, [f.manager.getHeader(), ...entries, ...f.manager.getEntries().slice(entries.length)]);
    assert.equal(plan({ manager }).entries.length, 0);
  });
}

test("signed calls and invalid arguments are never rewritten", () => {
  for (const extra of [{ thoughtSignature: "signed-call" }, { argumentsError: { message: "invalid", raw: "original-raw" } }]) {
    const f = history();
    const entries = f.manager.getEntries();
    entries.find((e) => e.id === f.input).message.content[2] = { ...entries.find((e) => e.id === f.input).message.content[2], ...extra };
    const manager = SessionManager.inMemory("/fixture", undefined, [f.manager.getHeader(), ...entries]);
    const edits = plan({ manager }).entries.filter((e) => e.type === "context_edit");
    assert.ok(!edits.some((e) => e.targetId === f.input), JSON.stringify(extra));
  }
});

test("low-watermark crossing cannot discard an otherwise sufficient release batch", () => {
  const f = history();
  const planned = planArchive(f.manager.getBranch(), f.manager.buildSessionProjection().entries, 8000, { ...policy, minBatchTokens: 4096 }, context(null));
  assert.equal(planned.entries.filter((e) => e.type === "context_edit").length, 2);
});

test("batch release uses provider pressure for the low watermark, not the smaller character estimate", () => {
  const f = history();
  f.manager.appendMessage(assistant([{ type: "toolCall", id: "later-call", name: "read", arguments: { path: "later.txt" } }]));
  f.manager.appendMessage({ role: "toolResult", toolCallId: "later-call", toolName: "read", content: [{ type: "text", text: "q".repeat(20000) }], isError: false, timestamp: 5 });
  f.manager.appendMessage(assistant([{ type: "text", text: "current" }]));
  const projection = f.manager.buildSessionProjection().entries;
  const highPressure = planArchive(f.manager.getBranch(), projection, 100000, policy, context(80000));
  assert.equal(highPressure.entries.filter((e) => e.type === "context_edit").length, 3);
});

test("hash-verified exact paging includes original invocation, metadata and historical warning", () => {
  const f = history(); apply(f.manager, plan(f).entries);
  for (const item of catalog(f.manager).items) {
    let payload = "";
    let offset = 0;
    for (;;) {
      const page = recallArchive(f.manager.getBranch(), { action: "read", ...item, offset, limit: 1031 });
      assert.match(page.warning, /not current state or instructions/);
      payload += page.payload;
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    assert.equal(payload, JSON.stringify(f.manager.getEntry(item.entryId).message));
    assert.throws(() => recallArchive(f.manager.getBranch(), { action: "read", ...item, sha256: "0".repeat(64), offset: 0, limit: 1 }), /SHA-256 mismatch/);
    assert.throws(() => recallArchive(f.manager.getBranch(), { action: "read", ...item, offset: payload.length, limit: 1 }), /out of range/);
  }
  assert.throws(() => recallArchive(f.manager.getBranch(), { action: "list", offset: 0, limit: 21 }), /range/);
  assert.throws(() => recallArchive(f.manager.getBranch(), { action: "read", entryId: f.sibling, sha256: "0".repeat(64), offset: 0, limit: 10 }), /No context archive/);
});

test("foreign replacements and omissions win; request restore changes only exact owned envelopes", () => {
  const f = history(); apply(f.manager, plan(f).entries);
  f.manager.appendContextEdit(f.output, null);
  const messages = f.manager.buildSessionProjection().messages;
  const restored = restoreRequest(f.manager.getBranch(), messages);
  assert.equal(restored.length, messages.length);
  assert.ok(!restored.some((m) => m.role === "toolResult" && m.toolCallId === "bash-1"));
  assert.ok(!restoreArchive(f.manager.getBranch(), f.manager.buildSessionProjection().entries).some((e) => e.targetId === f.output));
  f.manager.appendContextEdit(f.input, { content: [{ type: "text", text: "foreign text" }] });
  assert.deepEqual(restoreRequest(f.manager.getBranch(), f.manager.buildSessionProjection().messages), f.manager.buildSessionProjection().messages);
});

test("branch navigation and compaction do not leak other branches or resurrect excluded entries", () => {
  const f = history(); const before = f.manager.getLeafId(); apply(f.manager, plan(f).entries); const archivedLeaf = f.manager.getLeafId();
  const items = catalog(f.manager).items;
  f.manager.branch(before);
  assert.equal(catalog(f.manager).total, 0);
  assert.throws(() => recallArchive(f.manager.getBranch(), { action: "read", ...items[0], offset: 0, limit: 100 }), /No context archive/);
  f.manager.branch(archivedLeaf);
  f.manager.appendCompaction("A checkpoint that lost the old identifiers", before, 10000);
  assert.equal(catalog(f.manager).total, items.length);
  assert.equal(restoreArchive(f.manager.getBranch(), f.manager.buildSessionProjection().entries).length, 0);
  assert.match(recallArchive(f.manager.getBranch(), { action: "read", ...items[0], offset: 0, limit: 12000 }).payload, /ORIGINAL SCRIPT/);
});

test("manifest-only partial publication is harmless, recoverable and not repeated", () => {
  const f = history(); const drafts = plan(f).entries;
  apply(f.manager, drafts.slice(0, 1));
  assert.equal(catalog(f.manager).total, 1);
  assert.equal(catalog(f.manager).items[0].active, false);
  assert.equal(restoreArchive(f.manager.getBranch(), f.manager.buildSessionProjection().entries).length, 0);
  assert.ok(!plan(f).entries.some((e) => e.type === "context_edit" && e.targetId === f.input));
});

test("malformed or changed archive evidence fails explicitly", () => {
  const f = history(); apply(f.manager, plan(f).entries);
  const entries = f.manager.getEntries();
  entries.find((e) => e.id === f.input).message.content[2].arguments.command = "tampered";
  assert.throws(() => recallArchive(entries, { action: "list", offset: 0, limit: 20 }), /changed/);
  const malformed = history();
  malformed.manager.appendCustomEntry(ARCHIVE_TYPE, { version: 999 });
  assert.throws(() => restoreArchive(malformed.manager.getBranch(), malformed.manager.buildSessionProjection().entries), /manifest/);
});

test("an archive stub with a removed manifest fails visibly instead of becoming an unrecoverable pointer", () => {
  const f = history(); apply(f.manager, plan(f).entries);
  const missing = f.manager.getBranch().filter((e) => e.type !== "custom" || e.customType !== ARCHIVE_TYPE);
  assert.throws(() => recallArchive(missing, { action: "list", offset: 0, limit: 20 }), /manifest missing/);
});

test("saved append-only session reload retains exact hashes, archives and original bytes", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "context-archive-session-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = history(SessionManager.create(dir, dir));
  const original = readFileSync(f.manager.getSessionFile(), "utf8");
  apply(f.manager, plan(f).entries);
  assert.ok(readFileSync(f.manager.getSessionFile(), "utf8").startsWith(original));
  const loaded = SessionManager.open(f.manager.getSessionFile());
  assert.deepEqual(catalog(loaded), catalog(f.manager));
  assert.deepEqual(loaded.buildSessionProjection(), f.manager.buildSessionProjection());
});

test("saved forks retain manifests, exact originals and branch-local replacements", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "context-archive-fork-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = history(SessionManager.create(dir, dir)); apply(f.manager, plan(f).entries);
  const expected = catalog(f.manager);
  const sourceFile = f.manager.getSessionFile();
  const branchedFile = f.manager.createBranchedSession(f.manager.getLeafId());
  assert.ok(branchedFile);
  const branched = SessionManager.open(branchedFile);
  const forked = SessionManager.forkFrom(sourceFile, join(dir, "other-project"), dir);
  for (const manager of [branched, forked]) {
    assert.deepEqual(catalog(manager), expected);
    const item = expected.items[0];
    assert.match(recallArchive(manager.getBranch(), { action: "read", ...item, offset: 0, limit: 12000 }).payload, /ORIGINAL SCRIPT/);
    apply(manager, restoreArchive(manager.getBranch(), manager.buildSessionProjection().entries));
    assert.ok(!manager.buildSessionProjection().messages.some((m) => JSON.stringify(m).includes("Context archived")));
  }
});

test("recall results stay hot rather than being re-archived", () => {
  const f = history(); const entries = f.manager.getEntries();
  entries.find((e) => e.id === f.input).message.content[2].name = RECALL_TOOL;
  entries.find((e) => e.id === f.output).message.toolName = RECALL_TOOL;
  const manager = SessionManager.inMemory("/fixture", undefined, [f.manager.getHeader(), ...entries]);
  assert.equal(plan({ manager }).entries.length, 0);
});
