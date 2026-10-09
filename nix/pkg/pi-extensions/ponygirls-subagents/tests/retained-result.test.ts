/**
 * Result retention and paging: the default bound stays, a per-spawn
 * result_limit raises it up to the hard maximum, read pages cover the whole
 * retained text within one tool reply each, every cut is stated, and the
 * retained text survives a restart.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRunStore } from "../src/store.ts";
import { TOOL_RESULT_MAX, type ReadResult, type Supervisor } from "../src/supervisor.ts";
import { RESULT_TEXT_HARD_MAX, RESULT_TEXT_MAX } from "../src/tools.ts";
import { mkSup, tick } from "./ctl-worker.ts";

/** Report-like text: line breaks and quotes, so its JSON form is longer than the text. */
function report(length: number): string {
  let out = "";
  for (let i = 0; out.length < length; i++) out += `{"finding": ${i}, "note": "line ${i}"}\n`;
  return out.slice(0, length);
}

/** Read every page of a result, checking that each reply fits one tool result. */
function readAll(sup: Supervisor, agentId: string, taskRunId: string | null): { text: string; pages: number; last: NonNullable<ReadResult["result"]> } {
  let text = "";
  let pages = 0;
  let offset: number | null = 0;
  let last: NonNullable<ReadResult["result"]> | null = null;
  while (offset !== null) {
    const reply = sup.readResult("governor", agentId, taskRunId, { offset, length: null }, 0);
    assert.ok(JSON.stringify(reply).length <= TOOL_RESULT_MAX, "a page reply exceeds one tool result");
    last = reply.result!;
    assert.equal(last.offset, offset);
    text += last.text;
    pages++;
    offset = last.nextOffset;
  }
  return { text, pages, last: last! };
}

test("by default a result is cut at the default bound and the reply says so", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  await tick();
  const full = report(RESULT_TEXT_MAX + 1000);
  byAgent(a.agentId)[0]!.settle("succeeded", full);
  await tick();
  const result = sup.read("governor", a.agentId, "result", 0, 1, null).result!;
  assert.equal(result.text, full.slice(0, RESULT_TEXT_MAX));
  assert.deepEqual(
    { totalLength: result.totalLength, offset: result.offset, nextOffset: result.nextOffset, truncated: result.truncated, resultLimit: result.resultLimit },
    { totalLength: RESULT_TEXT_MAX, offset: 0, nextOffset: null, truncated: true, resultLimit: RESULT_TEXT_MAX },
  );
  await sup.shutdown();
});

test("a result within the default bound is whole and not flagged", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  await tick();
  byAgent(a.agentId)[0]!.settle("succeeded", "short answer");
  await tick();
  const result = sup.read("governor", a.agentId, "result", 0, 1, null).result!;
  assert.deepEqual(
    { text: result.text, totalLength: result.totalLength, nextOffset: result.nextOffset, truncated: result.truncated },
    { text: "short answer", totalLength: 12, nextOffset: null, truncated: false },
  );
  await sup.shutdown();
});

test("a result_limit outside the default bound and the hard maximum is refused before anything is created", async () => {
  const { sup } = mkSup({});
  for (const resultLimit of [RESULT_TEXT_HARD_MAX + 1, RESULT_TEXT_MAX - 1, 0, 9000.5]) {
    await assert.rejects(() => sup.spawn("governor", { taskName: "a", message: "m", profile: "reader", resultLimit }, `r-${resultLimit}`), /INVALID: result_limit/);
  }
  assert.equal(sup.list("governor").length, 0);
  assert.equal(sup.admissionScheduler.snapshot().created, 0);
  await sup.shutdown();
});

test("a raised result_limit keeps the whole text; pages cover it exactly and it survives a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-result-"));
  try {
    const full = report(150_000);
    const a = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    const spawned = await a.sup.spawn("governor", { taskName: "a", message: "m", profile: "reader", resultLimit: 200_000 }, "ra");
    await tick();
    a.byAgent(spawned.agentId)[0]!.settle("succeeded", full);
    await tick();
    const live = readAll(a.sup, spawned.agentId, null);
    assert.equal(live.text, full);
    assert.ok(live.pages > 1, "a text larger than one tool reply needs several pages");
    assert.deepEqual({ totalLength: live.last.totalLength, truncated: live.last.truncated, resultLimit: live.last.resultLimit }, { totalLength: 150_000, truncated: false, resultLimit: 200_000 });
    // The journal keeps the inline prefix and a checksummed reference, never the large text.
    const settled = a.sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.find((r) => r.kind === "generation.settled")!;
    assert.equal((settled.body["text"] as string).length, RESULT_TEXT_MAX);
    assert.ok(JSON.stringify(settled).length < 2 * RESULT_TEXT_MAX + 2000, "the journal record carries the large text");
    const ref = settled.body["result"] as { file: string; bytes: number; sha256: string };
    assert.equal(ref.bytes, Buffer.byteLength(full, "utf8"));
    // A later task run does not displace the earlier run's retained text.
    await a.sup.sendMessage("governor", spawned.agentId, "task", "again", {}, "rb");
    await tick();
    a.byAgent(spawned.agentId)[0]!.settle("succeeded", "second");
    await tick();
    assert.equal(readAll(a.sup, spawned.agentId, spawned.taskRunId).text, full);
    await a.sup.shutdown();

    const b = mkSup({ dir, store: new FileRunStore(dir, "root-1") });
    assert.equal(readAll(b.sup, spawned.agentId, spawned.taskRunId).text, full);
    assert.equal(b.sup.read("governor", spawned.agentId, "result", 0, 1, null).result!.text, "second");
    // A damaged side file is reported, never replaced by the inline prefix.
    const resultDir = join(dir, "results", spawned.agentId);
    writeFileSync(join(resultDir, readdirSync(resultDir)[0]!), "damaged");
    assert.throws(() => b.sup.readResult("governor", spawned.agentId, spawned.taskRunId, { offset: 0, length: null }, 0), /RECOVERY_CORRUPT/);
    await b.sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("text beyond the agent's result_limit is cut there and flagged", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader", resultLimit: 10_000 }, "ra");
  await tick();
  const full = report(12_000);
  byAgent(a.agentId)[0]!.settle("succeeded", full);
  await tick();
  const all = readAll(sup, a.agentId, null);
  assert.equal(all.text, full.slice(0, 10_000));
  assert.deepEqual({ totalLength: all.last.totalLength, truncated: all.last.truncated }, { totalLength: 10_000, truncated: true });
  await sup.shutdown();
});

test("offset and length select a page; an offset beyond the text is refused", async () => {
  const { sup, byAgent } = mkSup({});
  const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader" }, "ra");
  await tick();
  byAgent(a.agentId)[0]!.settle("succeeded", "0123456789");
  await tick();
  const page = sup.readResult("governor", a.agentId, null, { offset: 2, length: 3 }, 7);
  assert.deepEqual({ text: page.result!.text, offset: page.result!.offset, nextOffset: page.result!.nextOffset, cursor: page.cursor }, { text: "234", offset: 2, nextOffset: 5, cursor: 7 });
  const end = sup.readResult("governor", a.agentId, null, { offset: 10, length: null }, 0).result!;
  assert.deepEqual({ text: end.text, nextOffset: end.nextOffset }, { text: "", nextOffset: null });
  assert.throws(() => sup.readResult("governor", a.agentId, null, { offset: 11, length: null }, 0), /INVALID: offset/);
  assert.throws(() => sup.readResult("governor", a.agentId, null, { offset: 0, length: 0 }, 0), /INVALID: length/);
  await sup.shutdown();
});

test("a child pages a descendant's large result through its own read_agent tool", async () => {
  const { sup, byAgent } = mkSup({ limits: { maxDepth: 2 }, policy: (p) => { p.maxDepth = 2; p.nesting = true; } });
  const parent = await sup.spawn("governor", { taskName: "p", message: "delegate", profile: "reader" }, "rp");
  await tick();
  const pw = byAgent(parent.agentId)[0]!;
  const kid = JSON.parse((await pw.call("spawn_agent", { task_name: "kid", message: "report", profile: "reader", result_limit: 100_000 })).content) as { agentId: string };
  await tick();
  const full = report(60_000);
  byAgent(kid.agentId)[0]!.settle("succeeded", full);
  await tick();
  let text = "";
  let offset: number | null = 0;
  while (offset !== null) {
    const reply = await pw.call("read_agent", { target: kid.agentId, view: "result", offset });
    assert.equal(reply.isError, false);
    assert.ok(!reply.content.includes("[output truncated"), "a page was cut by the tool-result bound");
    const result = (JSON.parse(reply.content) as ReadResult).result!;
    text += result.text;
    offset = result.nextOffset;
  }
  assert.equal(text, full);
  const refused = await pw.call("spawn_agent", { task_name: "big", message: "report", profile: "reader", result_limit: RESULT_TEXT_HARD_MAX + 1 });
  assert.equal(refused.isError, true);
  assert.match(refused.content, /INVALID: result_limit/);
  await sup.shutdown();
});

test("a worker's result file must lie in the root store and match its digest; otherwise the cut is stated", async () => {
  const dir = mkdtempSync(join(tmpdir(), "subagents-result-handoff-"));
  const outside = mkdtempSync(join(tmpdir(), "subagents-result-outside-"));
  try {
    const { sup, byAgent } = mkSup({ dir });
    const a = await sup.spawn("governor", { taskName: "a", message: "m", profile: "reader", resultLimit: 100_000 }, "ra");
    await tick();
    const full = report(20_000);
    const stray = join(outside, "result.txt");
    writeFileSync(stray, full);
    byAgent(a.agentId)[0]!.fire("settled", {
      status: "succeeded",
      lastAssistantText: full.slice(0, RESULT_TEXT_MAX),
      textLength: full.length,
      resultFile: { path: stray, byteCount: Buffer.byteLength(full), sha256: "0".repeat(64) },
    });
    await tick();
    const result = sup.read("governor", a.agentId, "result", 0, 1, null).result!;
    assert.deepEqual({ totalLength: result.totalLength, truncated: result.truncated }, { totalLength: RESULT_TEXT_MAX, truncated: true });
    const events = sup.runStore.readSince(0, Number.MAX_SAFE_INTEGER).records.filter((r) => r.kind === "recovery.event" && r.body["phase"] === "result_handoff_failed");
    assert.equal(events.length, 1);
    assert.match(String(events[0]!.body["reason"]), /outside the root store/);
    await sup.shutdown();
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
