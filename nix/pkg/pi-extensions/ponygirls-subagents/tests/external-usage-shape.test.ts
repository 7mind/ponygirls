/**
 * Wire fidelity: AgentToolResult.usage preserves valid public SDK Usage
 * shape (totalTokens, cost breakdown) instead of a collapsed aggregate.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryRunStore } from "../src/store.ts";
import { GoverningToolDispatcher } from "../src/external-dispatcher.ts";
import type { PinnedGoverningHandle } from "../src/governing-runtime.ts";
import type { BrokerCaller } from "../src/broker.ts";

const VALID_USAGE = {
  input: 11,
  output: 7,
  cacheRead: 1,
  cacheWrite: 2,
  totalTokens: 21,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 },
};

test("wire result.usage preserves valid public SDK Usage verbatim (no collapse)", async () => {
  const store = new InMemoryRunStore("r");
  const probe: PinnedGoverningHandle = {
    name: "probe",
    description: "d",
    parameters: { type: "object" },
    execute: (async () => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
      usage: { ...VALID_USAGE, cost: { ...VALID_USAGE.cost } },
    })),
  };
  const disp = new GoverningToolDispatcher(
    store,
    () => ({ isActive: () => true, listHandles: () => [probe], getHandle: () => probe, baseCtx: () => ({}) }),
    async () => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, truncated: false }),
  );
  const caller: BrokerCaller = {
    agentId: "a", taskRunId: "t", generation: 1,
    grants: { tools: [], externalTools: ["probe"], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "worktree" },
    workdir: "/tmp", writableRoot: null, sandbox: null,
  };
  const res = await disp.execute(caller, { tool: "probe", args: { q: "x" } });
  assert.equal(res.isError, false);
  assert.deepEqual(res.usage, VALID_USAGE);
});
