import assert from "node:assert/strict";
import test from "node:test";
import { ToolBroker } from "../src/broker.ts";
import { DummyToolExecutor } from "../src/sandbox.ts";
import { InMemoryRunStore } from "../src/store.ts";
import type { BrokerCaller } from "../src/broker.ts";

function caller(overrides: Partial<BrokerCaller> = {}): BrokerCaller {
  return {
    agentId: "agent-1",
    taskRunId: "task-1",
    generation: 1,
    grants: { tools: ["read", "grep", "find", "ls", "write", "edit", "bash"], repos: [], shell: true, network: false, nesting: false, maxDepth: 1 },
    worktreePath: null,
    readRoots: ["/tmp"],
    tmpDir: "/tmp",
    sandboxProbed: true,
    hidePaths: [],
    ...overrides,
  };
}

test("denied tool never reaches the executor", async () => {
  const exec = new DummyToolExecutor();
  const broker = new ToolBroker(exec, new InMemoryRunStore("r"));
  const reader = caller({ grants: { tools: ["read"], repos: [], shell: false, network: false, nesting: false, maxDepth: 1 } });
  await assert.rejects(() => broker.execute(reader, { tool: "bash", args: { command: "id" } }), /POLICY_DENIED/);
  assert.equal(exec.specs.length, 0);
});

test("stale generation cannot start new side effects", async () => {
  const broker = new ToolBroker(new DummyToolExecutor(), new InMemoryRunStore("r"));
  await assert.rejects(() => broker.execute(caller({ generation: null }), { tool: "read", args: { path: "." } }), /STALE_GENERATION/);
});

test("duplicate tool operation ids are rejected, not retried blindly", async () => {
  const broker = new ToolBroker(new DummyToolExecutor(), new InMemoryRunStore("r"));
  await broker.execute(caller(), { operationId: "op-1", tool: "read", args: { path: "." } });
  await assert.rejects(() => broker.execute(caller(), { operationId: "op-1", tool: "read", args: { path: "." } }), /DUPLICATE_REQUEST/);
});

test("nested tool invocation is authorized identically (parentOperationId)", async () => {
  const exec = new DummyToolExecutor();
  const broker = new ToolBroker(exec, new InMemoryRunStore("r"));
  const res = await broker.execute(caller(), { tool: "read", args: { path: "." }, parentOperationId: "op-parent" });
  assert.equal(res.exitCode, 0);
  assert.equal(exec.specs.length, 1);
});

test("assertQuiescent blocks parking with active jobs", async () => {
  const exec = new DummyToolExecutor();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  exec.handler = () => gate.then(() => ({ exitCode: 0, signal: null, stdout: "", stderr: "", truncated: false, timedOut: false }));
  const broker = new ToolBroker(exec, new InMemoryRunStore("r"));
  const pending = broker.execute(caller(), { operationId: "op-hang", tool: "read", args: { path: "." } });
  await new Promise((r) => setTimeout(r, 50));
  assert.throws(() => broker.assertQuiescent("agent-1"), /cannot park/);
  release();
  await pending;
  broker.assertQuiescent("agent-1");
});

test("approvals are generation-bound and revocable", () => {
  const broker = new ToolBroker(new DummyToolExecutor(), new InMemoryRunStore("r"));
  const a = broker.createApproval("agent-1", 3, "bash", { command: "id" }, 1, 60_000);
  assert.equal(a.generation, 3);
  broker.revokeApprovals("agent-1");
});

test("approval tokens validate agent/tool/args/generation and consume once", async () => {
  const broker = new ToolBroker(new DummyToolExecutor(), new InMemoryRunStore("r"));
  const args = { path: "." };
  const a = broker.createApproval("agent-1", 1, "read", args, 1, 60_000);
  const ok = await broker.execute(caller(), { tool: "read", args, approvalId: a.id });
  assert.equal(ok.exitCode, 0);
  await assert.rejects(() => broker.execute(caller(), { tool: "read", args, approvalId: a.id }), /DUPLICATE_REQUEST/);
  const b = broker.createApproval("agent-1", 1, "read", args, 1, 60_000);
  await assert.rejects(() => broker.execute(caller(), { tool: "read", args: { path: "other" }, approvalId: b.id }), /CONFLICT/);
  await assert.rejects(() => broker.execute(caller({ generation: 2 }), { tool: "read", args, approvalId: b.id }), /STALE_GENERATION/);
  await assert.rejects(() => broker.execute(caller({ agentId: "agent-2" }), { tool: "read", args, approvalId: b.id }), /FORGED_AUTHOR|POLICY_DENIED/);
});
