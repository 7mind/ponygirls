import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { until } from "./fake-worker.ts";
import { CtlWorker, gateSpec, mkSup, tick } from "./ctl-worker.ts";
import { checkpointSha256, FileRunStore, InMemoryRunStore } from "../src/store.ts";
import { MAX_HISTORY_PAGE_BYTES, readRegisteredHistoryPage, type RegisteredHistorySource } from "../src/history.ts";

const header = JSON.stringify({ type: "session", version: 3, id: "s", timestamp: "2026-11-06T13:00:00Z", cwd: "/synthetic" }) + "\n";
const entry = (id: string, value: string) => ({ type: "message", id, parentId: null, timestamp: "2026-11-06T13:00:00Z", message: { role: "user", content: value, timestamp: 1 } });
function directory(t: test.TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "subagents-history-"));
  t.after(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
function fixtureSource(dir: string): RegisteredHistorySource {
  const sessionFile = join(dir, "sessions", "agent", "native.jsonl"); mkdirSync(join(dir, "sessions", "agent"), { recursive: true });
  return { sourceId: "source", rootSessionId: "root", agentId: "agent", agentPath: "/root/a", sessionId: "s", parentAgentId: null, taskRunId: null, kind: "agent", copiedFrom: null, reconstructedPrefixBytes: 0, sessionFile, gaps: [] };
}
function factory(dir: string, workers: CtlWorker[]) {
  return (o: { agentId: string }): CtlWorker => {
    const worker = new CtlWorker(o.agentId); workers.push(worker);
    const location = join(dir, "sessions", o.agentId); mkdirSync(location, { recursive: true });
    worker.sessionFile = join(location, `${worker.instanceId}.jsonl`);
    writeFileSync(worker.sessionFile, header + JSON.stringify(entry(worker.instanceId, "native evidence")) + "\n"); return worker;
  };
}

test("native page offsets count UTF-8 bytes, exclude the header, and retain incomplete tails", async t => {
  const dir = directory(t); const source = fixtureSource(dir); const one = entry("one", "é🦄"); const two = entry("two", "next");
  const prefix = header + JSON.stringify(one) + "\n"; const tail = JSON.stringify(two);
  writeFileSync(source.sessionFile, prefix + tail.slice(0, 40));
  const first = await readRegisteredHistoryPage(dir, source, 0, 1);
  assert.deepEqual(first.entries, [one]); assert.equal(first.nextOffset, Buffer.byteLength(prefix)); assert.equal(first.eof, true); assert.equal(first.ready, false);
  assert.match(first.gaps.join(" "), /Incomplete/);
  const pending = await readRegisteredHistoryPage(dir, source, first.nextOffset, 10);
  assert.deepEqual(pending.entries, []); assert.equal(pending.nextOffset, first.nextOffset);
  appendFileSync(source.sessionFile, tail.slice(40) + "\n");
  const second = await readRegisteredHistoryPage(dir, source, first.nextOffset, 10);
  assert.deepEqual(second.entries, [two]); assert.equal(second.eof, true); assert.equal(second.ready, true);
  await assert.rejects(readRegisteredHistoryPage(dir, source, 2, 10), /cursor/);
  await assert.rejects(readRegisteredHistoryPage(dir, source, second.nextOffset + 1, 10), /shrank/);
});

test("an unmaterialized or partial native header remains pending, then becomes readable", async t => {
  const dir = directory(t); const source = fixtureSource(dir);
  const unavailable = await readRegisteredHistoryPage(dir, source, 0, 10);
  assert.match(unavailable.gaps.join(" "), /unavailable/); assert.equal(unavailable.ready, false);
  for (const incomplete of ["", header.slice(0, 20)]) {
    writeFileSync(source.sessionFile, incomplete);
    const page = await readRegisteredHistoryPage(dir, source, 0, 10);
    assert.equal(page.nextOffset, 0); assert.equal(page.eof, true); assert.equal(page.ready, false); assert.deepEqual(page.entries, []);
    assert.match(page.gaps.join(" "), /not finalized|Incomplete/);
  }
  writeFileSync(source.sessionFile, header + JSON.stringify(entry("final", "ready")) + "\n");
  assert.equal((await readRegisteredHistoryPage(dir, source, 0, 10)).entries.length, 1);
});

test("a page boundary inside a finalized record is not an incomplete-tail gap", async t => {
  const dir = directory(t); const source = fixtureSource(dir);
  const large = JSON.stringify(entry("large", "x".repeat(MAX_HISTORY_PAGE_BYTES - 180))) + "\n";
  assert.ok(Buffer.byteLength(large) < MAX_HISTORY_PAGE_BYTES);
  assert.ok(Buffer.byteLength(header + large) > MAX_HISTORY_PAGE_BYTES);
  writeFileSync(source.sessionFile, header + large);
  const first = await readRegisteredHistoryPage(dir, source, 0, 10);
  assert.equal(first.eof, false); assert.doesNotMatch(first.gaps.join(" "), /Incomplete trailing/);
  const second = await readRegisteredHistoryPage(dir, source, first.nextOffset, 10);
  assert.equal(second.entries.length, 1); assert.equal(second.eof, true);
});

test("malformed records, oversized lines, header replacement and escaping symlinks fail visibly", async t => {
  const dir = directory(t); const source = fixtureSource(dir);
  writeFileSync(source.sessionFile, header + "not-json\n");
  await assert.rejects(readRegisteredHistoryPage(dir, source, 0, 10), /malformed/);
  writeFileSync(source.sessionFile, header + '"' + "x".repeat(MAX_HISTORY_PAGE_BYTES) + '"\n');
  await assert.rejects(readRegisteredHistoryPage(dir, source, Buffer.byteLength(header), 10), /exceeds/);
  writeFileSync(source.sessionFile, header.replace('"id":"s"', '"id":"other"'));
  await assert.rejects(readRegisteredHistoryPage(dir, source, 0, 10), /identity changed/);
  const outside = join(dir, "outside.jsonl"); writeFileSync(outside, header); rmSync(source.sessionFile); symlinkSync(outside, source.sessionFile);
  await assert.rejects(readRegisteredHistoryPage(dir, source, 0, 10), /escapes/);
  await assert.rejects(readRegisteredHistoryPage(dir, { ...source, sessionFile: outside }, 0, 10), /outside/);
});

test("registered sources persist across reopen, span tasks, include reviews and revoke", async t => {
  const dir = directory(t); const workers: CtlWorker[] = []; const make = factory(dir, workers);
  const a = mkSup({ dir, store: new FileRunStore(dir, "root-1"), factory: make });
  const cancellation = new AbortController(); const feed = a.sup.historyFeed("governor", cancellation.signal);
  assert.throws(() => a.sup.historyFeed("unrelated-child", cancellation.signal), /FORBIDDEN/);
  let hints = 0; feed.subscribe(() => hints++); feed.subscribe(() => { throw new Error("observer failure"); });
  const spawned = await a.sup.spawn("governor", { taskName: "one", message: "m", profile: "reader", gate: gateSpec() }, "one");
  const first = feed.sources()[0]!; assert.equal(first.taskRunId, null); assert.equal(first.agentId, spawned.agentId);
  assert.ok(!("sessionFile" in first)); assert.ok(hints > 0);
  assert.equal((await feed.read(first.sourceId, 0, 10)).entries.length, 1);
  workers.find(w => w.agentId === spawned.agentId)!.settle("succeeded", "answer"); await tick(); await tick();
  const review = feed.sources().find(s => s.kind === "review")!;
  assert.ok(review); assert.equal(review.taskRunId, spawned.taskRunId); assert.equal(review.parentAgentId, first.parentAgentId);
  const sources = feed.sources(); await assert.rejects(feed.read("foreign-source", 0, 10), /unknown/);
  const reading = feed.read(first.sourceId, 0, 10); cancellation.abort();
  await assert.rejects(reading, /revoked/); assert.throws(() => feed.sources(), /revoked/); assert.throws(() => feed.subscribe(() => {}), /revoked/);
  const before = hints; await a.sup.shutdown(); assert.equal(hints, before);
  const b = mkSup({ dir, store: new FileRunStore(dir, "root-1"), factory: make });
  if (b.sup.needsRecovery) await b.sup.recover();
  assert.deepEqual(b.sup.historyFeed("governor", new AbortController().signal).sources(), sources);
  await b.sup.shutdown();
});

test("checkpoint ingestion cannot turn an escaping symlink into an authorized restored source", async t => {
  const dir = directory(t); const store = new InMemoryRunStore("root-1");
  const bytes = Buffer.from(header + JSON.stringify(entry("outside", "PRIVATE_EXTERNAL_TRANSCRIPT")) + "\n");
  const outside = join(dir, "outside.jsonl"); writeFileSync(outside, bytes);
  const workers: CtlWorker[] = [];
  const { sup } = mkSup({ dir, store, factory: o => {
    const worker = new CtlWorker(o.agentId); workers.push(worker);
    const location = join(dir, "sessions", o.agentId); mkdirSync(location, { recursive: true });
    worker.sessionFile = join(location, "escape.jsonl"); symlinkSync(outside, worker.sessionFile);
    const request = worker.request.bind(worker);
    worker.request = (op, payload, opts) => op === "checkpoint" ? Promise.resolve({ ok: true, materialized: true, sessionFile: worker.sessionFile,
      byteCount: bytes.length, sha256: checkpointSha256(bytes), leafEntryId: "outside" }) : request(op, payload, opts);
    return worker;
  } });
  t.after(() => sup.shutdown());
  const spawned = await sup.spawn("governor", { taskName: "escape", message: "m", profile: "reader" }, "escape");
  const feed = sup.historyFeed("governor", new AbortController().signal);
  await assert.rejects(feed.read(feed.sources()[0]!.sourceId, 0, 10), /escapes/);
  workers[0]!.settle(); await tick(); await tick();
  assert.equal(store.loadCheckpoint(spawned.agentId), null, "out-of-scope bytes must not enter a restorable checkpoint");
  assert.ok(store.readSince(0, 1000).records.some(r => r.kind === "recovery.event" && r.body["phase"] === "checkpoint_skipped"));
});

for (const variant of ["migration", "missing-path", "changed-header", "partial-tail", "late-mailbox"]) test(`restored history admission: ${variant}`, async t => {
  const dir = directory(t); const store = new InMemoryRunStore("root-1"); const workers: CtlWorker[] = [];
  const make = factory(dir, workers);
  const { sup } = mkSup({ dir, store, factory: options => {
    const worker = make(options); const request = worker.request.bind(worker);
    let restoring = false; let delayedNote: (() => void) | null = null;
    if (variant === "migration") {
      const legacy = { ...entry("legacy", "PRIVATE_LEGACY_PREFIX"), message: { role: "hookMessage", customType: "legacy", content: "PRIVATE_LEGACY_PREFIX", display: false, timestamp: 1 } };
      writeFileSync(worker.sessionFile!, header.replace('"version":3', '"version":2') + JSON.stringify(legacy) + "\n");
    }
    worker.request = async (operation, payload, opts) => {
      const p = payload as { restore: { sessionFile: string } | null };
      if (operation === "initialize" && p.restore !== null) {
        const file = p.restore.sessionFile; worker.sessionFile = file; restoring = true;
        const session = SessionManager.open(file, join(dir, "sessions", worker.agentId));
        await request(operation, payload, opts);
        if (variant === "changed-header") writeFileSync(file, header.replace('"id":"s"', '"id":"foreign"'));
        if (variant === "partial-tail") appendFileSync(file, '{"unfinished":');
        return { ok: true, sessionId: session.getSessionId(), sessionFile: variant === "missing-path" ? null : file };
      }
      if (variant === "late-mailbox" && operation === "deliver") {
        const delivery = payload as { mode: string; text: string };
        if (delivery.mode === "note") {
          const append = () => appendFileSync(worker.sessionFile!, JSON.stringify(entry(restoring ? "replayed-note" : "original-note", delivery.text)) + "\n");
          if (restoring) { delayedNote = append; throw new Error("fixture replay timeout: delivery outcome unknown"); }
          append();
        } else if (delayedNote !== null) { delayedNote(); delayedNote = null; }
      }
      if (operation === "checkpoint") {
        const bytes = readFileSync(worker.sessionFile!);
        return { ok: true, materialized: true, sessionFile: worker.sessionFile, byteCount: bytes.length, sha256: checkpointSha256(bytes), leafEntryId: variant === "migration" ? "legacy" : worker.instanceId };
      }
      return request(operation, payload, opts);
    };
    return worker;
  } });
  t.after(() => sup.shutdown());
  const spawned = await sup.spawn("governor", { taskName: "restore", message: "first", profile: "reader" }, "first");
  workers[0]!.settle(); await until(() => store.loadCheckpoint(spawned.agentId) !== null, 15000, "native checkpoint");
  const checkpoint = store.loadCheckpoint(spawned.agentId)!;
  const feed = sup.historyFeed("governor", new AbortController().signal); const original = feed.sources()[0]!;
  if (variant === "late-mailbox") await sup.sendMessage("governor", spawned.agentId, "note", "PRIVATE_LATE_REPLAY", {}, "old-note");
  await sup.evictWorker("governor", spawned.agentId);
  const resume = () => sup.sendMessage("governor", spawned.agentId, "task", "second", {}, "second");
  if (variant !== "migration") {
    const accepted = await resume();
    const terminal = () => store.readSince(0, 1000).records.find(record => record.kind === "task.terminal" && record.body["taskRunId"] === accepted.taskRunId);
    await until(() => workers[1]!.delivered.length > 0 || terminal() !== undefined, 15000, "restore dispatch or terminal rejection");
    const leaked = feed.sources().find(source => source.copiedFrom === original.sourceId);
    if (variant === "late-mailbox" && leaked !== undefined) assert.doesNotMatch(JSON.stringify((await feed.read(leaked.sourceId, leaked.reconstructedPrefixBytes, 10)).entries), /PRIVATE_LATE_REPLAY/);
    assert.equal(workers[1]!.delivered.length, 0, "corrupt or uncertain restored state must fail before task delivery");
    assert.equal(terminal()!.body["outcome"], "failed");
    assert.match(String(terminal()!.body["detail"]), variant === "late-mailbox" ? /RECOVERY_OWNER_UNCONFIRMED/ : /RECOVERY_CORRUPT/);
    assert.equal(workers[1]!.killed, true);
    assert.equal(sup.list("governor")[0]!.currentTaskRunId, spawned.taskRunId);
    assert.equal(feed.sources().length, 1);
  } else {
    await resume(); const restored = feed.sources().find(source => source.copiedFrom === original.sourceId)!;
    const migrated = readFileSync(workers[1]!.sessionFile!);
    assert.match(migrated.toString("utf8"), /"version":3/); assert.doesNotMatch(migrated.toString("utf8"), /hookMessage/);
    assert.ok(migrated.length < checkpoint.ref.bytes, "real SDK migration changes the byte coordinate");
    assert.equal(restored.reconstructedPrefixBytes, migrated.length);
    assert.deepEqual((await feed.read(restored.sourceId, restored.reconstructedPrefixBytes, 10)).entries, []);
    appendFileSync(workers[1]!.sessionFile!, JSON.stringify(entry("suffix", "NEW_NATIVE_SUFFIX")) + "\n");
    assert.match(JSON.stringify((await feed.read(restored.sourceId, restored.reconstructedPrefixBytes, 10)).entries), /NEW_NATIVE_SUFFIX/);
  }
});

for (const materialized of [true, false]) test(`reload without checkpoint excludes mailbox reconstruction (materialized: ${materialized})`, async t => {
  const dir = directory(t); const store = new InMemoryRunStore("root-1"); const workers: CtlWorker[] = [];
  const make = factory(dir, workers);
  const { sup } = mkSup({ dir, store, factory: options => {
    const worker = make(options); const replacement = workers.length > 1; const request = worker.request.bind(worker);
    const memorySession = replacement && !materialized ? SessionManager.create("/synthetic", join(dir, "sessions", worker.agentId)) : null;
    const sessionId = memorySession !== null ? memorySession.getSessionId() : replacement ? "fresh-native" : "s";
    const nativeHeader = header.replace('"id":"s"', `"id":"${sessionId}"`);
    if (memorySession !== null) worker.sessionFile = memorySession.getSessionFile()!;
    else writeFileSync(worker.sessionFile!, nativeHeader);
    worker.request = async (operation, payload, opts) => {
      if (operation === "checkpoint") throw new Error("synthetic unavailable checkpoint");
      if (operation === "initialize") { await request(operation, payload, opts); return { ok: true, sessionId, sessionFile: worker.sessionFile }; }
      if (operation === "deliver") {
        const delivery = payload as { mode: string; text: string };
        if (delivery.mode === "note") {
          const line = JSON.stringify(entry(replacement ? "replayed" : "original", delivery.text)) + "\n";
          if (memorySession !== null) memorySession.appendCustomMessageEntry("subagent-message", delivery.text, false);
          else appendFileSync(worker.sessionFile!, line);
        } else if (replacement) {
          if (memorySession !== null) memorySession.appendMessage({ role: "user", content: "NEW_AFTER_RELOAD", timestamp: Date.now() });
          else appendFileSync(worker.sessionFile!, JSON.stringify(entry("new-task", "NEW_AFTER_RELOAD")) + "\n");
        }
      }
      return request(operation, payload, opts);
    };
    return worker;
  } });
  t.after(() => sup.shutdown());
  const spawned = await sup.spawn("governor", { taskName: "no-checkpoint", message: "first", profile: "reader" }, "first");
  workers[0]!.settle();
  await until(() => store.readSince(0, store.durableSeq()).records.some(record => record.kind === "recovery.event" && record.body["phase"] === "checkpoint_skipped"), 15000, "checkpoint skipped");
  assert.equal(store.loadCheckpoint(spawned.agentId), null);
  await sup.sendMessage("governor", spawned.agentId, "note", "PRIVATE_NO_CHECKPOINT_REPLAY", {}, "old-note");
  const feed = sup.historyFeed("governor", new AbortController().signal); const original = feed.sources()[0]!;
  const baseline = await feed.read(original.sourceId, 0, 10);
  assert.match(JSON.stringify(baseline.entries), /PRIVATE_NO_CHECKPOINT_REPLAY/);
  await sup.evictWorker("governor", spawned.agentId);
  const accepted = await sup.sendMessage("governor", spawned.agentId, "task", "second", {}, "second");
  const terminal = () => store.readSince(0, store.durableSeq()).records.find(record => record.kind === "task.terminal" && record.body["taskRunId"] === accepted.taskRunId);
  await until(() => workers[1]!.delivered.some(delivery => delivery.mode === "task") || terminal() !== undefined, 15000, "reload dispatch or rejection");
  const restored = feed.sources().find(source => source.sourceId !== original.sourceId);
  if (restored !== undefined) {
    const suffix = await feed.read(restored.sourceId, restored.reconstructedPrefixBytes, 10);
    assert.doesNotMatch(JSON.stringify(suffix.entries), /PRIVATE_NO_CHECKPOINT_REPLAY/);
    assert.match(JSON.stringify(suffix.entries), /NEW_AFTER_RELOAD/);
    assert.match(suffix.gaps.join(" "), /reconstruction|reconstructed/);
  }
  if (materialized) {
    assert.ok(restored); assert.equal(restored.sessionId, "fresh-native"); assert.ok(restored.reconstructedPrefixBytes > 0);
    assert.deepEqual(workers[1]!.delivered.map(delivery => delivery.mode), ["note", "task"]);
  } else {
    assert.equal(restored, undefined); assert.deepEqual(workers[1]!.delivered.map(delivery => delivery.mode), ["note"]); assert.equal(workers[1]!.killed, true);
    assert.match(String(terminal()!.body["detail"]), /RECOVERY_OWNER_UNCONFIRMED/);
  }
  assert.deepEqual((await feed.read(original.sourceId, baseline.nextOffset, 10)).entries, []);
});

test("failed durable source registration is not exposed", async t => {
  const dir = directory(t); const store = new InMemoryRunStore("root-1"); const append = store.append.bind(store);
  store.append = (kind, body) => { if (kind === "history.source") throw new Error("synthetic registration failure"); return append(kind, body); };
  const { sup } = mkSup({ dir, store, factory: factory(dir, []) });
  const feed = sup.historyFeed("governor", new AbortController().signal);
  await assert.rejects(sup.spawn("governor", { taskName: "failure", message: "m", profile: "reader" }, "fail"), /registration failure/);
  assert.deepEqual(feed.sources(), []); await sup.shutdown();
});
