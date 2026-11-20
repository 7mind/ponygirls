import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureProcess, ClaudeExecutor, getClaudeStatus } from "../executor/claude-cli.ts";
import { NativeSessions } from "../src/execution-lifecycle.ts";
import { processState } from "./process-state.ts";

const OBSERVATION_MS = 3000;
const WARM_LIFETIME_MS = 5 * 60 * 1000;
const BACKPRESSURED_FRAME_BYTES = 1024 * 1024;

async function records(path: string): Promise<{ pid: number }[]> {
  try { return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map((line: string) => JSON.parse(line) as { pid: number }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function stopped(pid: number): Promise<boolean> {
  return processState(pid) !== "live";
}

async function observe(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + OBSERVATION_MS;
  while (!await check()) {
    assert.ok(Date.now() < deadline, "owned process observation exceeded 3000ms");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function bounded<T>(pending: Promise<T>): Promise<T> {
  let timer!: NodeJS.Timeout;
  try { return await Promise.race([pending, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("logical cleanup exceeded 3000ms")), OBSERVATION_MS); })]); }
  finally { clearTimeout(timer); }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "native-cleanup-fault-"));
  const command = join(root, "claude");
  const source = process.env.PI_SUBAGENTS_CLAUDE_FIXTURE;
  assert.ok(source, "controlled CLI fixture is required");
  await writeFile(command, `#!${process.execPath}\n${await readFile(source, "utf8")}`);
  await chmod(command, 0o755);
  await writeFile(join(root, "fixture.json"), JSON.stringify({ answer: "controlled" }));
  const sessions = new NativeSessions();
  const execution = sessions.enter({ capability: { version: 1, apis: ["fixture"], requestProfile: "canonical-simple-no-provider-hooks-v1" }, cwd: root, lifecycleSessionId: "owner", beforeEntry: () => {}, captureOriginal: (stream) => stream }, {});
  return { root, command, sessions, execution, env: { PI_CLAUDE_CODE_COMMAND: command, PI_CLAUDE_CODE_CONFIG_DIR: root }, cleanup: async (failed: boolean) => {
    for (const launch of [...await records(join(root, "launch.jsonl")), ...await records(join(root, "auth.jsonl"))]) {
      try { process.kill(-launch.pid, "SIGKILL"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      await observe(() => stopped(launch.pid));
    }
    if (failed) await assert.rejects(sessions.dispose("owner"), (error: unknown) => error instanceof AggregateError);
    else await sessions.dispose("owner");
    await rm(root, { recursive: true, force: true });
  } };
}

test("active cached and uncached cancellation retains EPERM without unhandled callbacks or indefinite joins", async () => {
  const f = await fixture();
  const executor = new ClaudeExecutor();
  const pending = [undefined, "cached"].map((sessionId) => f.execution.track(executor.runClaudeRequest({
    model: "fixture", cwd: f.root, frames: [{ type: "user", message: { role: "user", content: [{ type: "text", text: "WAIT_FIXTURE" }] } }],
    systemPrompt: "", manifest: [], extraBody: {}, sessionId, env: f.env, signal: f.execution.signal, delegation: f.execution,
  })).then(() => null, (error: unknown) => error));
  const originalKill = process.kill;
  try {
    await observe(async () => (await records(join(f.root, "launch.jsonl"))).length === 2);
    const owned = await records(join(f.root, "launch.jsonl"));
    const attempted: number[] = [];
    process.kill = ((pid: number, signal: NodeJS.Signals | number) => {
      if (signal === "SIGKILL" && pid < 0) {
        attempted.push(pid);
        if (pid === -owned[0]!.pid) throw Object.assign(new Error("controlled active EPERM"), { code: "EPERM" });
      }
      return originalKill(pid, signal);
    }) as typeof process.kill;
    await assert.rejects(bounded(f.sessions.dispose("owner")), (error: unknown) => error instanceof AggregateError);
    for (const launch of owned) assert.ok(attempted.includes(-launch.pid));
    assert.equal(await stopped(owned[0]!.pid), false);
    assert.equal(await stopped(owned[1]!.pid), true);
    for (const outcome of await bounded(Promise.all(pending))) assert.ok(outcome instanceof Error);
    assert.throws(() => f.execution.beforeEntry(), /retired/);
    await assert.rejects(bounded(f.sessions.dispose("owner")), /cleanup failed/);
  } finally {
    process.kill = originalKill;
    await f.cleanup(true);
    await Promise.all(pending);
    await executor.closeClaudeProcesses();
  }
});

test("active cancellation settles after failed termination while a history frame is backpressured", async () => {
  const f = await fixture();
  const executor = new ClaudeExecutor();
  const originalKill = process.kill;
  await writeFile(f.command, `#!${process.execPath}\nconst fs=require("node:fs");const path=require("node:path");const root=process.env.CLAUDE_CONFIG_DIR;if(process.argv.includes("auth")){fs.appendFileSync(path.join(root,"auth.jsonl"),JSON.stringify({pid:process.pid})+"\\n");console.log(JSON.stringify({loggedIn:true,subscriptionType:"test"}));process.exit(0)}fs.appendFileSync(path.join(root,"launch.jsonl"),JSON.stringify({pid:process.pid})+"\\n");setInterval(()=>{},1000);`);
  const pending = f.execution.track(executor.runClaudeRequest({ model: "fixture", cwd: f.root, frames: [{ type: "user", shouldQuery: false, message: { role: "user", content: [{ type: "text", text: "x".repeat(BACKPRESSURED_FRAME_BYTES) }] } }], systemPrompt: "", manifest: [], extraBody: {}, env: f.env, signal: f.execution.signal, delegation: f.execution })).then(() => null, (error: unknown) => error);
  try {
    await observe(async () => (await records(join(f.root, "launch.jsonl"))).length === 1);
    const [owned] = await records(join(f.root, "launch.jsonl"));
    process.kill = ((pid: number, signal: NodeJS.Signals | number) => {
      if (pid === -owned!.pid && signal === "SIGKILL") throw Object.assign(new Error("controlled backpressure EPERM"), { code: "EPERM" });
      return originalKill(pid, signal);
    }) as typeof process.kill;
    await assert.rejects(bounded(f.sessions.dispose("owner")), (error: unknown) => error instanceof AggregateError);
    assert.ok(await bounded(pending) instanceof Error);
    assert.equal(await stopped(owned!.pid), false);
  } finally {
    process.kill = originalKill;
    await f.cleanup(true);
    await pending;
    await executor.closeClaudeProcesses();
  }
});

for (const stage of ["abort", "timeout"] as const) {
  test(`acquisition ${stage} retains failed termination and settles logical ownership`, async () => {
    const f = await fixture();
    await writeFile(join(f.root, "hold-auth"), "");
    const originalKill = process.kill;
    const pending = f.execution.track(captureProcess(f.command, ["auth", "status"], { ...f.env, CLAUDE_CONFIG_DIR: f.root }, f.execution.signal, stage === "timeout" ? 500 : 20_000, f.execution)).then(() => null, (error: unknown) => error);
    try {
      await observe(async () => (await records(join(f.root, "auth.jsonl"))).length === 1);
      const [owned] = await records(join(f.root, "auth.jsonl"));
      process.kill = ((pid: number, signal: NodeJS.Signals | number) => {
        if (pid === -owned!.pid && signal === "SIGKILL") throw Object.assign(new Error(`controlled acquisition ${stage} EPERM`), { code: "EPERM" });
        return originalKill(pid, signal);
      }) as typeof process.kill;
      if (stage === "abort") {
        await assert.rejects(bounded(f.sessions.dispose("owner")), (error: unknown) => error instanceof AggregateError);
      }
      assert.ok(await bounded(pending) instanceof Error);
      assert.equal(await stopped(owned!.pid), false);
      await assert.rejects(bounded(f.sessions.dispose("owner")), /cleanup failed/);
      assert.throws(() => f.execution.beforeEntry(), /retired/);
    } finally {
      process.kill = originalKill;
      await f.cleanup(true);
      await pending;
    }
  });
}

test("warm expiry contains termination failure and retains the owner fault", async (t) => {
  const f = await fixture();
  const executor = new ClaudeExecutor();
  const originalKill = process.kill;
  try {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
    await executor.runClaudeRequest({ model: "fixture", cwd: f.root, frames: [{ type: "user", message: { role: "user", content: [{ type: "text", text: "warm" }] } }], systemPrompt: "", manifest: [], extraBody: {}, sessionId: "warm", env: f.env, signal: f.execution.signal, delegation: f.execution });
    const [owned] = await records(join(f.root, "launch.jsonl"));
    process.kill = ((pid: number, signal: NodeJS.Signals | number) => {
      if (pid === -owned!.pid && signal === "SIGKILL") throw Object.assign(new Error("controlled expiry EPERM"), { code: "EPERM" });
      return originalKill(pid, signal);
    }) as typeof process.kill;
    t.mock.timers.tick(WARM_LIFETIME_MS);
    for (let turn = 0; turn < 20 && !f.execution.signal.aborted; turn++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.execution.signal.aborted, true);
    t.mock.timers.reset();
    assert.equal(await stopped(owned!.pid), false);
    await assert.rejects(bounded(f.sessions.dispose("owner")), /cleanup failed/);
    await assert.rejects(bounded(executor.closeClaudeProcesses()), /cleanup failed/);
  } finally {
    t.mock.timers.reset();
    process.kill = originalKill;
    await f.cleanup(true);
    await assert.rejects(executor.closeClaudeProcesses(), /cleanup failed/);
  }
});

test("acquisition revalidates authority after asynchronous executable resolution", async () => {
  const f = await fixture();
  let allowed = true;
  let checks = 0;
  const delegation = { ...f.execution, beforeEntry: () => { checks++; if (!allowed) throw new Error("MODEL_UNAVAILABLE: controlled authority revoked"); } };
  try {
    const pending = getClaudeStatus(f.env, f.execution.signal, delegation);
    allowed = false;
    await assert.rejects(pending, /MODEL_UNAVAILABLE/);
    assert.equal(checks, 1);
    assert.deepEqual(await records(join(f.root, "auth.jsonl")), []);
  } finally { await f.cleanup(false); }
});
