/**
 * Preparation payload boundary (CtlWorker, no real worker needed):
 * prepared JSON ARGUMENTS fit within MAX_PAYLOAD_BYTES but the ACTUAL full
 * SUCCESS payload {ok:true,ticket:uuid,preparedArgs} exceeds the protocol
 * payload byte cap. Must deny with no ticket, no retained map entry, no
 * intent, and no terminal yet. Includes an ordinary successful control whose
 * full payload fits.
 *
 * Contract (inspected first): supervisor.ts checks prepared JSON against
 * MAX_PAYLOAD_BYTES - 8KiB (PREPARE_RESPONSE_HEADROOM_BYTES). This 8KiB
 * reserve is an explicit policy limit, not an accident: any prepared value
 * exceeding MAX-8KiB is correctly denied even when it would still fit within
 * MAX, because the full response envelope (ok/ticket/preparedArgs) must also
 * fit. No assumption that all near-max values must be accepted.
 * Source is NOT fixed here; if a VALID full-fit control ever failed, the
 * expected-vs-observed would be captured and reported for independent
 * parent reproduction before authorizing any source change.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { MAX_PAYLOAD_BYTES } from "../src/protocol.ts";
import { mkSup, tick } from "./ctl-worker.ts";

const CG = "mcp__codegraph__codegraph_explore";
const HEADROOM = 8 * 1024;

type AnyHandle = {
  name: string;
  description: string;
  parameters: unknown;
  prepareArguments?: (args: unknown) => unknown;
  execute: (...args: never[]) => Promise<unknown>;
};

function setRegistry(sup: unknown, reg: () => unknown): void {
  (sup as unknown as { opts: { governingRegistry?: unknown } }).opts.governingRegistry = reg;
}

test("prepare boundary fits-args but oversize full payload denies pre-terminal (no ticket/map/intent/terminal)", async () => {
  assert.equal(MAX_PAYLOAD_BYTES, 262144, "pinned protocol cap must be 256KiB");
  // Find N such that prepared JSON fits (<MAX) but full SUCCESS payload exceeds (>MAX).
  // preparedArgs = {q:"x", data:"x".repeat(N)}; full = {ok:true,ticket:uuid,preparedArgs}.
  const uuid = randomUUID();
  let chosenN = -1;
  let preparedLen = -1;
  let fullLen = -1;
  for (let n = MAX_PAYLOAD_BYTES - 600; n < MAX_PAYLOAD_BYTES; n++) {
    const preparedArgs = { q: "x", data: "x".repeat(n) };
    const pLen = Buffer.byteLength(JSON.stringify(preparedArgs), "utf8");
    const fLen = Buffer.byteLength(JSON.stringify({ ok: true, ticket: uuid, preparedArgs }), "utf8");
    if (pLen < MAX_PAYLOAD_BYTES && fLen > MAX_PAYLOAD_BYTES) {
      chosenN = n;
      preparedLen = pLen;
      fullLen = fLen;
      break;
    }
  }
  assert.ok(chosenN >= 0, `no boundary N found (prepared<MAX but full>MAX); last tried prepared=${preparedLen} full=${fullLen}`);
  // The chosen prepared value exceeds the explicit reserve limit (MAX-8KiB),
  // so the supervisor's documented policy correctly denies it pre-mint.
  const reserveLimit = MAX_PAYLOAD_BYTES - HEADROOM;
  assert.ok(preparedLen > reserveLimit, `boundary prepared (${preparedLen}) must exceed reserve limit (${reserveLimit}) to exercise the policy; full=${fullLen}`);
  console.log(`boundary sizes: prepared=${preparedLen} (fits <${MAX_PAYLOAD_BYTES}), full=${fullLen} (exceeds >${MAX_PAYLOAD_BYTES}), reserveLimit=${reserveLimit}`);

  const tool: AnyHandle = {
    name: CG,
    description: "same",
    parameters: { type: "object" },
    prepareArguments: (a) => a,
    execute: (async () => ({ content: [{ type: "text", text: "must-not-run" }], details: {} })) as never,
  };
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }));
  try {
    const g = await built.sup.spawn("governor", { taskName: "bp", message: "m", profile: "reader" }, "bp-1");
    await tick();
    const rt = (built.sup as unknown as { agents: Map<string, unknown> }).agents.get(g.agentId);
    const worker = built.byAgent(g.agentId)[0];
    const env = { taskRunId: g.taskRunId, executionGeneration: g.generation };
    const supAny = built.sup as unknown as {
      onPrepareRequest: (rt: unknown, worker: unknown, payload: unknown, env: unknown) => Promise<{ ok: boolean; ticket?: string; error?: string }>;
      preparedTickets: Map<string, { agentId: string }>;
    };
    const intentsBefore = built.sup.runStore.readSince(0, 100000).records.filter((r) => r.kind === "tool.intent").length;
    const terminalsBefore = built.sup.runStore.readSince(0, 100000).records.filter(
      (r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId,
    ).length;
    const bigArgs = { q: "x", data: "x".repeat(chosenN) };
    const prep = await supAny.onPrepareRequest(rt, worker, { tool: CG, args: bigArgs, toolCallId: "tc-bound" }, env);
    assert.equal(prep.ok, false, `boundary oversize full payload must deny (prepared=${preparedLen} full=${fullLen}): ${JSON.stringify(prep).slice(0, 300)}`);
    assert.match(prep.error ?? "", /PAYLOAD_TOO_LARGE/, `denial must name PAYLOAD_TOO_LARGE, got ${prep.error}`);
    assert.equal(prep.ticket, undefined, "denied prepare mints no ticket");
    assert.equal(supAny.preparedTickets.size, 0, `no ticket retained pre-terminal (map=${supAny.preparedTickets.size})`);
    const intentsAfter = built.sup.runStore.readSince(0, 100000).records.filter((r) => r.kind === "tool.intent").length;
    assert.equal(intentsAfter, intentsBefore, `denied prepare journals no intent (before=${intentsBefore} after=${intentsAfter})`);
    const terminalsAfter = built.sup.runStore.readSince(0, 100000).records.filter(
      (r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId,
    ).length;
    assert.equal(terminalsBefore, 0, `pre-terminal pre-mint must start with 0 terminals (no inherited miscount, got ${terminalsBefore})`);
    assert.equal(terminalsAfter, terminalsBefore, `denied prepare causes no terminal yet (before=${terminalsBefore} after=${terminalsAfter})`);
  } finally {
    await built.sup.shutdown();
  }
});

test("prepare ordinary successful control fits full payload (small args mint + intent)", async () => {
  assert.equal(MAX_PAYLOAD_BYTES, 262144);
  const tool: AnyHandle = {
    name: CG,
    description: "same",
    parameters: { type: "object" },
    prepareArguments: (a) => a,
    execute: (async () => ({ content: [{ type: "text", text: "ok" }], details: {} })) as never,
  };
  const built = mkSup({ policy: (p) => { p.allowedTools = [CG]; } });
  setRegistry(built.sup, () => ({ isActive: () => true, listHandles: () => [tool as never], getHandle: () => tool as never, baseCtx: () => ({}) }));
  try {
    const g = await built.sup.spawn("governor", { taskName: "ctl", message: "m", profile: "reader" }, "ctl-1");
    await tick();
    const rt = (built.sup as unknown as { agents: Map<string, unknown> }).agents.get(g.agentId);
    const worker = built.byAgent(g.agentId)[0];
    const env = { taskRunId: g.taskRunId, executionGeneration: g.generation };
    const supAny = built.sup as unknown as {
      onPrepareRequest: (rt: unknown, worker: unknown, payload: unknown, env: unknown) => Promise<{ ok: boolean; ticket?: string; preparedArgs?: unknown; error?: string }>;
      preparedTickets: Map<string, { agentId: string }>;
    };
    const smallArgs = { q: "hello" };
    const preparedLen = Buffer.byteLength(JSON.stringify(smallArgs), "utf8");
    const fullLen = Buffer.byteLength(JSON.stringify({ ok: true, ticket: randomUUID(), preparedArgs: smallArgs }), "utf8");
    console.log(`control sizes: prepared=${preparedLen} full=${fullLen} cap=${MAX_PAYLOAD_BYTES} reserveLimit=${MAX_PAYLOAD_BYTES - HEADROOM}`);
    assert.ok(preparedLen < MAX_PAYLOAD_BYTES - HEADROOM, "control prepared must be well within reserve");
    assert.ok(fullLen < MAX_PAYLOAD_BYTES, "control full payload must fit");
    const intentsBefore = built.sup.runStore.readSince(0, 100000).records.filter((r) => r.kind === "tool.intent").length;
    const prep = await supAny.onPrepareRequest(rt, worker, { tool: CG, args: smallArgs, toolCallId: "tc-ctl" }, env);
    if (prep.ok !== true) {
      // VALID full-fit control failed: do NOT fix source here. Capture
      // expected vs observed for independent parent reproduction.
      const observed = JSON.stringify(prep).slice(0, 500);
      throw new Error(`CONTROL FAILED: expected ok:true for fits-full payload (prepared=${preparedLen} full=${fullLen} cap=${MAX_PAYLOAD_BYTES}), observed ${observed}. Parent must independently reproduce before authorizing any source change.`);
    }
    assert.ok(typeof prep.ticket === "string" && prep.ticket.length > 0, "control must mint ticket");
    assert.deepEqual(prep.preparedArgs, smallArgs);
    assert.equal(supAny.preparedTickets.size, 1, "control ticket retained pre-terminal");
    const intentsAfter = built.sup.runStore.readSince(0, 100000).records.filter((r) => r.kind === "tool.intent").length;
    assert.equal(intentsAfter, intentsBefore + 1, "control must journal exactly one prepareOnly intent");
  } finally {
    await built.sup.shutdown();
  }
});
