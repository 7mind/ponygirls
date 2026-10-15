/**
 * L2: fault injected BEFORE the late usage.reported commit.
 *
 * Interrupt + late valid effect ({40,20}) => early cancelled return; the
 * late settlement journals a single uncertain outcome and reports usage via
 * hook; the hook's usage.reported commit faults (STORE_FAILED). After
 * restart, totals must still include the durable late receipt ({41,21} with
 * assistant {1,1}) via recovery catch-up over recovery.event receipts —
 * and the commit failure must surface observably, never as an unhandled
 * rejection (which kills the process under set -e).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkSup, tick } from "./ctl-worker.ts";
import { FileRunStore } from "../src/store.ts";
import type { RunStore } from "../src/store.ts";

const CG = "mcp__codegraph__codegraph_explore";

function fullUsage(input: number, output: number): Record<string, unknown> {
  return {
    input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

test("L2 late-hook commit fault still totals after restart via durable receipt", async () => {
  let faultArmed = false;
  class FlakyStore extends FileRunStore {
    override append(kind: import("../src/store.ts").JournalKind, body: Record<string, unknown>): import("../src/store.ts").JournalRecord {
      if (faultArmed && kind === "usage.reported" && (body as Record<string, unknown>)["external"] === true) {
        faultArmed = false;
        throw Object.assign(new Error("injected fault before late usage.reported commit"), { code: "STORE_FAILED" });
      }
      return super.append(kind, body);
    }
  }
  let release!: (v: { content: Array<{ type: string; text: string }>; usage: Record<string, unknown> }) => void;
  const slow = {
    name: CG, description: "d", parameters: { type: "object" },
    execute: (() => new Promise((resolve: (v: unknown) => void) => { release = resolve as never; })),
  };
  const reg = () => ({ isActive: () => true, listHandles: () => [slow], getHandle: () => slow, baseCtx: () => ({}) });
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "subagents-late-fault-"));
  const store1: RunStore = new FlakyStore(dir, "root-late-fault");
  const first = mkSup({ dir, store: store1, policy: (p) => { p.allowedTools = [CG]; } });
  (first.sup as unknown as { opts: { governingRegistry?: unknown } }).opts.governingRegistry = reg;
  const g = await first.sup.spawn("governor", { taskName: "l", message: "m", profile: "reader" }, "late-fault-1");
  await tick();
  const gen1 = g.taskRunId;
  const pending = first.byAgent(g.agentId)[0].call(CG, { q: "x" });
  await new Promise((r) => setTimeout(r, 20));
  await first.sup.interrupt("governor", g.agentId, "int-late-fault-1");
  await pending;
  // New task starts under a new generation; the late billing must keep the
  // ORIGIN identity, never the new task's.
  await first.sup.sendMessage("governor", g.agentId, "task", "follow-up", {}, "late-fault-task-2");
  await tick(50);
  // Arm the fault for the late commit window only, then release the effect.
  faultArmed = true;
  release({ content: [{ type: "text", text: "late-effect" }], usage: fullUsage(40, 20) });
  await tick(100);
  faultArmed = false;
  // Durable late receipt must exist with the full valid usage even though its
  // usage.reported commit faulted (observable recovery event, no crash).
  const lateOutcomes = store1.readSince(0, 100000).records.filter(
    (r) => r.kind === "tool.outcome" && (r.body as Record<string, unknown>)["status"] === "uncertain",
  );
  assert.ok(lateOutcomes.length >= 1, "late uncertain outcome missing");
  const lateReceipts = store1.readSince(0, 100000).records.filter(
    (r) => r.kind === "recovery.event" && (r.body as Record<string, unknown>)["phase"] === "external-late-settlement",
  );
  assert.ok(lateReceipts.length >= 1, "durable late receipt missing after commit fault");
  assert.deepEqual((lateReceipts[0].body as Record<string, unknown>)["usage"], { input: 40, output: 20, cost: 0 });
  await first.sup.shutdown();
  // Restart: catch-up must account the orphaned late receipt (recovery.event
  // counts as evidence, deduped by committed usage.reported).
  const store2: RunStore = new FlakyStore(dir, "root-late-fault");
  const second = mkSup({ dir, store: store2, policy: (p) => { p.allowedTools = [CG]; } });
  (second.sup as unknown as { opts: { governingRegistry?: unknown } }).opts.governingRegistry = reg;
  await second.sup.recover();
  const reported = store2.readSince(0, 100000).records.filter(
    (r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["external"] === true,
  );
  assert.equal(reported.length, 1, `expected exactly one external report after catch-up, got ${reported.length}`);
  assert.equal((reported[0].body as Record<string, unknown>)["taskRunId"], gen1, "late usage misattributed to new task");
  assert.equal((reported[0].body as Record<string, unknown>)["input"], 40);
  assert.equal((reported[0].body as Record<string, unknown>)["output"], 20);
  // Totals: assistant {1,1} (settle) + late {40,20} = {41,21}.
  let input = 0;
  let output = 0;
  for (const r of store2.readSince(0, 100000).records) {
    if (r.kind !== "usage.reported") continue;
    const b = r.body as Record<string, unknown>;
    if (typeof b["input"] === "number") input += b["input"] as number;
    if (typeof b["output"] === "number") output += b["output"] as number;
  }
  assert.deepEqual({ input, output }, { input: 41, output: 21 });
  await second.sup.shutdown();
});
