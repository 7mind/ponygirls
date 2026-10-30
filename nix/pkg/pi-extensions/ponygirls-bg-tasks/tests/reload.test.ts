import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { SupervisorBackend, type SupervisorLaunch } from "../src/backend.ts";
import { defer, eventually, PYTHON, SHELL, SUPERVISOR_SCRIPT, tempDir } from "./fixtures.ts";

function launchConfig(dir: string): SupervisorLaunch {
  return { python: PYTHON, script: SUPERVISOR_SCRIPT, shell: SHELL, sidecar: join(dir, "session.jsonl.bg-tasks"), sessionId: "reload-test", handoffWaitMs: 0 };
}

test("replacement clients keep task identity, output, signals, and notice policy", async (t) => {
  const dir = tempDir(t, "bg-reload-client-");
  const launch = launchConfig(dir);
  let backend = await SupervisorBackend.attachOrStart(launch);
  defer(t, async () => {
    if (backend.isLost) backend = await SupervisorBackend.attachOrStart(launch);
    await backend.shutdown("quit");
  });
  const task = await backend.spawn({ label: "retained", command: "echo before; sleep 300", cwd: dir, notify: true });
  const activationId = backend.activationId;
  await backend.detach();
  backend = await SupervisorBackend.attachOrStart(launch);
  assert.equal(backend.activationId, activationId, "same supervisor execution owns the task");
  assert.deepEqual(backend.recovered, [], "reconnection must not recover live tasks as dead");
  const retained = await backend.get(task.id);
  assert.equal(retained.state, "running");
  assert.equal(retained.pgid, task.pgid);
  assert.equal((await backend.list(null, null, 50)).items[0]!.id, task.id);
  await eventually(async () => Buffer.from((await backend.read(task.id, 0, 32768)).bytes).toString().includes("before"), "retained output");
  assert.equal((await backend.signal(task.id, "SIGSTOP")).delivered, true);
  assert.equal((await backend.signal(task.id, "SIGCONT")).delivered, true);
  assert.equal((await backend.setNotify(task.id, false)).notify, false);
  assert.equal((await backend.setNotify(task.id, true)).notify, true);
  assert.equal((await backend.terminate(task.id)).state, "failed");
  assert.equal((await backend.notices("eligible", null, 50)).items.length, 1);
  assert.equal((await backend.clear(task.id)).id, task.id);
  assert.equal((await backend.list(null, null, 50)).items.length, 0);
});

test("a disconnected supervisor keeps final output and pending notices", async (t) => {
  const dir = tempDir(t, "bg-reload-completion-");
  const launch = launchConfig(dir);
  let backend = await SupervisorBackend.attachOrStart(launch);
  defer(t, async () => {
    if (backend.isLost) backend = await SupervisorBackend.attachOrStart(launch);
    await backend.shutdown("quit");
  });
  const task = await backend.spawn({ label: "finishing", command: "sleep 0.2; echo finished", cwd: dir, notify: true });
  await backend.detach();
  await new Promise((resolve) => setTimeout(resolve, 400));
  backend = await SupervisorBackend.attachOrStart(launch);
  await eventually(async () => (await backend.get(task.id)).state === "completed", "completion");
  assert.match(Buffer.from((await backend.read(task.id, 0, 32768)).bytes).toString(), /finished/);
  const page = await backend.notices("eligible", null, 50);
  assert.equal(page.items[0]!.id, task.id);
});

test("an invalid reconnect greeting closes the rejected connection", async (t) => {
  const dir = tempDir(t, "bg-reload-greeting-");
  const launch = launchConfig(dir);
  const address = `\0pi-bg-${createHash("sha256").update(`${process.pid}\0${launch.sidecar}`).digest("hex")}`;
  const peers = new Set<Socket>();
  let disconnected = false;
  const server = createServer((peer) => {
    peers.add(peer);
    peer.on("end", () => { disconnected = true; });
    peer.write('{"v":999,"type":"ready","activation":"wrong-version","pid":1,"recovered":[]}\n');
  });
  defer(t, () => {
    for (const peer of peers) peer.destroy();
    server.close();
  });
  await new Promise<void>((resolve) => server.listen(address, resolve));
  await assert.rejects(SupervisorBackend.attachOrStart(launch), /PROTOCOL_ERROR/);
  await eventually(async () => disconnected, "rejected connection to close");
});

test("detached supervisor handles do not prevent natural owner exit", async (t) => {
  const dir = tempDir(t, "bg-reload-owner-exit-");
  const launch = launchConfig(dir);
  const module = new URL("../src/backend.ts", import.meta.url).href;
  const script = `import { SupervisorBackend } from ${JSON.stringify(module)};
    const backend = await SupervisorBackend.attachOrStart(${JSON.stringify(launch)});
    await backend.spawn({label: 'owner-exit', command: 'sleep 300', cwd: ${JSON.stringify(dir)}, notify: false});
    await backend.detach();
    console.log('detached');`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 5000 });
  assert.match(result.stdout, /detached/, result.stderr);
  await eventually(async () => JSON.parse(readFileSync(join(launch.sidecar, "tasks.json"), "utf8")).tasks[0].state !== "running", "owner-loss cleanup");
  assert.equal(result.status, 0, `owner must exit without waiting for its supervisor's reconnect lease: ${result.error}`);
});

test("a refused detach closes the old client instead of stranding ownership", async (t) => {
  const dir = tempDir(t, "bg-reload-refused-");
  const backend = await SupervisorBackend.attachOrStart(launchConfig(dir));
  defer(t, async () => { if (!backend.isLost) await backend.shutdown("quit"); });
  const task = await backend.spawn({ label: "stopping", command: "trap '' TERM; echo ready; while :; do sleep 1; done", cwd: dir, notify: false });
  await eventually(async () => Buffer.from((await backend.read(task.id, 0, 32768)).bytes).toString().includes("ready"), "signal handler installed");
  const stopping = backend.terminate(task.id).catch(() => undefined);
  await eventually(async () => (await backend.get(task.id)).phase === "stopping", "termination pending");
  await assert.rejects(backend.detach(), /SESSION_BUSY/);
  assert.equal(backend.isLost, true, "a refused handoff must release the old client");
  await stopping;
});
