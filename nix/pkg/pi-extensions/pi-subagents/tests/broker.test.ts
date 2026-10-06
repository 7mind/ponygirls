import assert from "node:assert/strict";
import test from "node:test";
import { ToolBroker } from "../src/broker.ts";
import { DummyToolExecutor, type ToolExecutor } from "../src/sandbox.ts";
import { InMemoryRunStore, type RunStore } from "../src/store.ts";
import type { BrokerCaller } from "../src/broker.ts";
import { bothExecutors } from "./fake-worker.ts";

function caller(overrides: Partial<BrokerCaller> = {}): BrokerCaller {
  return {
    agentId: "agent-1",
    taskRunId: "task-1",
    generation: 1,
    grants: { tools: ["read", "grep", "find", "ls", "write", "edit", "bash"], repos: [], shell: true, network: false, nesting: false, maxDepth: 1, isolation: "none" },
    workdir: "/tmp",
    writableRoot: null,
    sandbox: null,
    ...overrides,
  };
}

function mkBroker(exec: ToolExecutor, store: RunStore = new InMemoryRunStore("r")): ToolBroker {
  return new ToolBroker(bothExecutors(exec), store, [], {}, { PATH: process.env["PATH"] ?? "/usr/bin:/bin" });
}

test("denied tool never reaches the executor", async () => {
  const exec = new DummyToolExecutor();
  const broker = mkBroker(exec);
  const reader = caller({ grants: { tools: ["read"], repos: [], shell: false, network: false, nesting: false, maxDepth: 1, isolation: "none" } });
  await assert.rejects(() => broker.execute(reader, { tool: "bash", args: { command: "id" } }), /POLICY_DENIED/);
  assert.equal(exec.specs.length, 0);
});

test("stale generation cannot start new side effects", async () => {
  const broker = mkBroker(new DummyToolExecutor());
  await assert.rejects(() => broker.execute(caller({ generation: null }), { tool: "read", args: { path: "." } }), /STALE_GENERATION/);
});

test("duplicate tool operation ids are rejected, not retried blindly", async () => {
  const broker = mkBroker(new DummyToolExecutor());
  await broker.execute(caller(), { operationId: "op-1", tool: "read", args: { path: "." } });
  await assert.rejects(() => broker.execute(caller(), { operationId: "op-1", tool: "read", args: { path: "." } }), /DUPLICATE_REQUEST/);
});

test("nested tool invocation is authorized identically (parentOperationId)", async () => {
  const exec = new DummyToolExecutor();
  const broker = mkBroker(exec);
  const res = await broker.execute(caller(), { tool: "read", args: { path: "." }, parentOperationId: "op-parent" });
  assert.equal(res.exitCode, 0);
  assert.equal(exec.specs.length, 1);
});

test("assertQuiescent blocks parking with active jobs", async () => {
  const exec = new DummyToolExecutor();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  exec.handler = () => gate.then(() => ({ exitCode: 0, signal: null, stdout: "", stderr: "", truncated: false, timedOut: false }));
  const broker = mkBroker(exec);
  const pending = broker.execute(caller(), { operationId: "op-hang", tool: "read", args: { path: "." } });
  await new Promise((r) => setTimeout(r, 50));
  assert.throws(() => broker.assertQuiescent("agent-1"), /cannot park/);
  release();
  await pending;
  broker.assertQuiescent("agent-1");
});

test("sandboxed callers run in a view on the sandbox executor; host callers run on the host", async () => {
  const sandboxed = new DummyToolExecutor();
  const host = new DummyToolExecutor();
  const broker = new ToolBroker({ sandbox: sandboxed, host }, new InMemoryRunStore("r"), ["/runtime"], { PATH: "/usr/bin" }, { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: "/home/someone" });
  await broker.execute(caller({ workdir: "/proj", writableRoot: "/proj" }), { tool: "bash", args: { command: "true" } });
  await broker.execute(caller({ workdir: "/wt", writableRoot: "/wt", sandbox: { readRoots: ["/repo"], tmpDir: "/scratch", hidePaths: ["/store"] } }), { tool: "bash", args: { command: "true" } });
  assert.deepEqual(host.specs.map((j) => ({ cwd: j.cwd, view: j.view, home: j.env["HOME"] })), [{ cwd: "/proj", view: null, home: "/home/someone" }]);
  assert.deepEqual(sandboxed.specs.map((j) => ({ cwd: j.cwd, view: j.view, home: j.env["HOME"] })), [{
    cwd: "/wt",
    view: { readRoots: ["/repo"], writableRoot: "/wt", tmpDir: "/scratch", hidePaths: ["/store"], runtimeRoots: ["/runtime"], network: false },
    home: "/scratch",
  }]);
});

test("[bwrap] brokered file tools follow pi's argument shapes inside the sandbox", async (t) => {
  const { BwrapToolExecutor } = await import("../src/sandbox.ts");
  const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const exec = new BwrapToolExecutor();
  if (!exec.probe().ok) {
    t.diagnostic("NOT-EXECUTED: bwrap unavailable; tool semantics skipped, not passed");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "subagents-tools-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const wt = join(dir, "wt");
  mkdirSync(join(wt, "src", "deep"), { recursive: true });
  mkdirSync(join(dir, "tmp"), { recursive: true });
  writeFileSync(join(wt, "src", "a.ts"), "export const a = 1;\nexport const b = 2;\n");
  writeFileSync(join(wt, "src", "deep", "c.ts"), "const needle = true;\n");
  writeFileSync(join(wt, "notes.md"), "needle in markdown\n");
  writeFileSync(join(wt, "src", "x_ts"), "not a ts file\n");
  const broker = new ToolBroker({ sandbox: exec, host: new DummyToolExecutor() }, new InMemoryRunStore("r"), [], { PATH: process.env["PATH"] ?? "/usr/bin:/bin" }, { PATH: process.env["PATH"] ?? "/usr/bin:/bin" });
  const writer = caller({ workdir: wt, writableRoot: wt, sandbox: { readRoots: [wt], tmpDir: join(dir, "tmp"), hidePaths: [] } });
  const run = (tool: string, args: Record<string, unknown>) => broker.execute(writer, { tool, args });

  const edit = await run("edit", { path: "src/a.ts", edits: [{ oldText: "const b = 2", newText: "const b = 3" }] });
  assert.equal(edit.exitCode, 0, edit.stderr);
  assert.equal(readFileSync(join(wt, "src", "a.ts"), "utf8"), "export const a = 1;\nexport const b = 3;\n");
  const ambiguous = await run("edit", { path: "src/a.ts", edits: [{ oldText: "export const", newText: "let" }] });
  assert.notEqual(ambiguous.exitCode, 0, "non-unique oldText must fail");
  await assert.rejects(() => run("edit", { path: "src/a.ts", old: "a", new: "b" }), /INVALID/);

  const found = await run("find", { pattern: "*.ts" });
  assert.deepEqual(found.stdout.split("\n").sort(), ["src/a.ts", "src/deep/c.ts"]);
  const grep = await run("grep", { pattern: "needle", glob: "*.ts" });
  assert.equal(grep.stdout.trim(), "src/deep/c.ts:1:const needle = true;");
  const read = await run("read", { path: "src/a.ts", offset: 2, limit: 1 });
  assert.ok(read.stdout.startsWith("export const b = 3;"), read.stdout);
  writeFileSync(join(wt, "src", "prex.ts"), "x\n");
  writeFileSync(join(wt, "src", "deep", "x.ts"), "x\n");
  writeFileSync(join(wt, "src", "y.tsx"), "x\n");
  writeFileSync(join(wt, "src", "z.c"), "x\n");
  const nested = await run("find", { pattern: "src/**/x.ts" });
  assert.deepEqual(nested.stdout.split("\n").sort(), ["src/deep/x.ts"], "** must not match inside a name");
  const braces = await run("find", { pattern: "*.{tsx,c}" });
  assert.deepEqual(braces.stdout.split("\n").sort(), ["src/y.tsx", "src/z.c"]);
  const brackets = await run("find", { pattern: "*.[ch]" });
  assert.deepEqual(brackets.stdout.split("\n"), ["src/z.c"]);
  const oneFile = await run("grep", { pattern: "needle", path: "src/deep/c.ts", glob: "*.ts" });
  assert.equal(oneFile.stdout.trim(), "src/deep/c.ts:1:const needle = true;");
  writeFileSync(join(wt, "big.txt"), `${"z".repeat(200)}\n`.repeat(2000));
  const big = await run("read", { path: "big.txt" });
  assert.ok(Buffer.byteLength(big.stdout) <= 60 * 1024, `read returned ${Buffer.byteLength(big.stdout)} bytes`);
  assert.match(big.stdout, /Use offset=\d+ to continue/);
  const empty = await run("write", { path: "empty.txt", content: "" });
  assert.equal(empty.exitCode, 0, empty.stderr);
  assert.equal(readFileSync(join(wt, "empty.txt"), "utf8"), "");
});

test("a cancelled job keeps its cancellation as the only recorded outcome", async () => {
  const store = new InMemoryRunStore("r");
  const exec = new DummyToolExecutor();
  let finish!: () => void;
  exec.handler = () => new Promise((resolve) => {
    finish = () => resolve({ exitCode: null, signal: "SIGKILL", stdout: "", stderr: "", truncated: false, timedOut: false });
  });
  const broker = mkBroker(exec, store);
  const pending = broker.execute(caller(), { operationId: "op-c", tool: "bash", args: { command: "sleep 100" } });
  await new Promise((r) => setTimeout(r, 10));
  await broker.cancelJobs("agent-1");
  finish();
  await pending;
  const outcomes = store.readSince(0, 100).records.filter((r) => r.kind === "tool.outcome" && r.body["operationId"] === "op-c");
  assert.deepEqual(outcomes.map((r) => r.body["status"]), ["cancelled"]);
});
