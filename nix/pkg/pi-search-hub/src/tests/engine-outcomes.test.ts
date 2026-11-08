import { expect, it } from "vitest";
import { SharedRuntime } from "../extensions/engine/runtime.js";
import type { EngineSource, SourceStats } from "../extensions/engine/types.js";

const source = (id: string, run: EngineSource<number>["run"], onOutcome: EngineSource<number>["onOutcome"]): EngineSource<number> => ({ id, provider: id, tier: "main", timeoutMs: 1000, maxResults: 20, weight: 1, redundantWith: [], settlementGraceMs: 0, run, onOutcome });
const request = { query: "q", numResults: 10, mode: "all" as const, targetUsableSources: 3, overallTimeoutMs: 1000, signal: undefined };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// Behavioral-Active-Blackbox-Atomic: shared runtime logical outcome observation contract.
it("reports authoritative detached outcomes exactly once while peers run; observer mutation/throws cannot alter results", async () => {
  const runtime = new SharedRuntime({ maxConcurrent: 4, perProvider: 1 });
  const seen: SourceStats[] = [];
  let release!: (items: number[]) => void;
  const pending = runtime.search([
    source("fast", async () => [1], stat => { seen.push({ ...stat }); stat.status = "failed"; throw new Error("observer"); }),
    source("slow", () => new Promise(resolve => { release = resolve; }), stat => { seen.push(stat); }),
    source("empty", async () => [], stat => { seen.push(stat); }),
    source("failed", async () => { throw new Error("private"); }, stat => { seen.push(stat); }),
  ], request);
  await tick();
  expect(seen.map(stat => [stat.source, stat.status])).toEqual([["fast", "success"], ["empty", "empty"], ["failed", "failed"]]);
  release([2]); const result = await pending;
  expect(result.stats.find(stat => stat.source === "fast")?.status).toBe("success");
  expect(result.lists.map(list => list.results)).toEqual([[1], [2]]);
  expect(seen.map(stat => stat.source)).toEqual(["fast", "empty", "failed", "slow"]);
  expect(JSON.stringify(seen)).not.toMatch(/private|observer|query/);
});

it("notifies target-skipped and pool-queued deadlines as not-started without dispatch", async () => {
  const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 });
  const seen: SourceStats[] = [];
  let calls = 0;
  await runtime.search([source("first", async () => [1], stat => { seen.push(stat); }), source("skipped", async () => { calls++; return [2]; }, stat => { seen.push(stat); })], { ...request, mode: "first" });
  expect(seen).toEqual([expect.objectContaining({ source: "first", status: "success" }), expect.objectContaining({ source: "skipped", status: "not-started", reason: "target-satisfied" })]);
  let release!: () => void;
  const occupying = runtime.operation("other", 1000, undefined, 0, () => new Promise<void>(resolve => { release = resolve; }));
  await tick();
  const queued: SourceStats[] = [];
  await runtime.search([source("queued", async () => { calls++; return []; }, stat => { queued.push(stat); })], { ...request, overallTimeoutMs: 10 });
  expect(queued).toEqual([expect.objectContaining({ status: "not-started", reason: "overall-deadline" })]);
  expect(calls).toBe(0); release(); await occupying;
});

it("notifies timeout and cancellation once despite ignored abort and late physical success", async () => {
  for (const cancel of [false, true]) {
    const runtime = new SharedRuntime({ maxConcurrent: 1, perProvider: 1 });
    const seen: SourceStats[] = [];
    let release!: (items: number[]) => void;
    const abort = new AbortController();
    const slow = source("slow", () => new Promise(resolve => { release = resolve; }), stat => { seen.push(stat); });
    slow.timeoutMs = 10;
    const pending = runtime.search([slow], { ...request, signal: abort.signal });
    await tick(); if (cancel) abort.abort();
    const output = await pending;
    expect(seen).toEqual([expect.objectContaining({ status: cancel ? "cancelled" : "timeout", reason: cancel ? "caller-cancelled" : "source-deadline" })]);
    expect(output.stats).toEqual(seen);
    release([1]); await tick(); expect(seen).toHaveLength(1);
  }
});
