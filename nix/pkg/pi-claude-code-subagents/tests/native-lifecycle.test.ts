import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { captureProcess, killProcessTree, processGroupAlive } from "../executor/claude-cli.ts";
import { processState } from "./process-state.ts";

test("completed acquisition commands do not leave owned descendants running", async () => {
  let pid = 0;
  try {
    const result = await captureProcess(process.execPath, ["-e", `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});c.once('spawn',()=>{console.log(String(c.pid));c.unref()})`], {}, undefined, 2000);
    pid = Number(result.stdout.trim());
    assert.ok(pid > 0, result.stderr);
    assert.notEqual(processState(pid), "live");
  } finally { if (pid > 1) { try { process.kill(pid, "SIGKILL"); } catch {} } }
});

test("detached CLI descendants are stopped after the leader has exited", async () => {
  const leader = spawn(process.execPath, ["-e", `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});c.once('spawn',()=>{console.log(String(c.pid));c.unref()});c.once('error',e=>{console.error(e);process.exitCode=1})`], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let stderr = "";
  leader.stderr!.on("data", (data: Buffer) => { stderr += data.toString(); });
  leader.stdout!.on("data", (data: Buffer) => { output += data.toString(); });
  await once(leader, "close");
  const pid = Number(output.trim());
  assert.equal(leader.exitCode, 0, stderr);
  assert.ok(pid > 0, JSON.stringify({ output, stderr, executable: process.execPath }));
  try {
    assert.equal(processState(leader.pid!), "dead");
    assert.equal(processState(pid), "live");
    assert.equal(await processGroupAlive(leader.pid!), true);
    killProcessTree(leader);
    const deadline = Date.now() + 2000;
    while (processState(pid) === "live" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.notEqual(processState(pid), "live");
    assert.equal(await processGroupAlive(leader.pid!), false);
    assert.equal(processState(process.pid), "live");
  } finally { try { process.kill(-leader.pid!, "SIGKILL"); } catch {} }
});

test("termination is confirmed for a zombie-only group before its unrelated parent reaps it", async () => {
  const holder = spawn("python3", ["-c", `
import os, signal, sys
r, w = os.pipe()
pid = os.fork()
if pid == 0:
    os.close(r)
    os.setpgid(0, 0)
    os.write(w, b"1")
    os.close(w)
    signal.pause()
    os._exit(1)
os.close(w)
try:
    if os.read(r, 1) != b"1": raise RuntimeError("child failed to create its group")
    print(pid, flush=True)
    sys.stdin.read()
finally:
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    os.waitpid(pid, 0)
`], { stdio: ["pipe", "pipe", "inherit"] });
  const closed = once(holder, "close");
  try {
    const [text] = await Promise.race([once(holder.stdout, "data"), closed.then(() => { throw new Error("fixture exited before publishing its group"); })]);
    const pid = Number(text.toString().trim());
    assert.equal(processState(pid), "live");
    process.kill(-pid, "SIGKILL");
    const deadline = Date.now() + 2000;
    while (processState(pid) === "live" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(processState(pid), "zombie");
    assert.equal(await processGroupAlive(pid), false);
    assert.equal(processState(pid), "zombie");
    assert.equal(processState(holder.pid!), "live");
  } finally {
    holder.stdin.end();
    assert.equal((await closed)[0], 0);
  }
});
