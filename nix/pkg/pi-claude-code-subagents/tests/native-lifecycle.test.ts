import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { captureProcess, killProcessTree } from "../executor/claude-cli.ts";

async function running(pid: number): Promise<boolean> {
  try { return (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1]!.charAt(0) !== "Z"; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}

test("completed acquisition commands do not leave owned descendants running", { skip: process.platform !== "linux" }, async () => {
  let pid = 0;
  try {
    const result = await captureProcess(process.execPath, ["-e", `const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});c.once('spawn',()=>{console.log(String(c.pid));c.unref()})`], {}, undefined, 2000);
    pid = Number(result.stdout.trim());
    assert.ok(pid > 0, result.stderr);
    assert.equal(await running(pid), false);
  } finally { if (pid > 0) { try { process.kill(pid, "SIGKILL"); } catch {} } }
});

test("detached CLI descendants are stopped after the leader has exited", { skip: process.platform !== "linux" }, async () => {
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
    assert.equal(await running(pid), true);
    killProcessTree(leader);
    const deadline = Date.now() + 2000;
    while (await running(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(await running(pid), false);
  } finally { try { process.kill(-leader.pid!, "SIGKILL"); } catch {} }
});
