// Step 8: the installed pi binary (as wrapped by packaging) loading the packaged
// extension in isolated RPC, print, and TUI sessions against a local fake provider.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { defer, tempDir, waitFor } from "./harness.mjs";

const PI = process.env.PI_BG_TASKS_PI;
const EXTENSION = process.env.PI_BG_TASKS_EXTENSION;
const PYTHON = process.env.PI_BG_TASKS_PYTHON;
assert.ok(PI && EXTENSION && PYTHON, "Set PI_BG_TASKS_PI (wrapped pi), PI_BG_TASKS_EXTENSION (packaged extension), and PI_BG_TASKS_PYTHON; packaged checks must not silently skip.");
const HERE = import.meta.dirname;

async function fakeProvider(t, dir) {
  const log = join(dir, "provider.jsonl");
  const proc = spawn(PYTHON, [join(HERE, "fake_openai.py"), "0", log], { stdio: ["ignore", "pipe", "inherit"] });
  defer(t, () => proc.kill());
  const port = await new Promise((res) => proc.stdout.once("data", (d) => res(Number(String(d).trim()))));
  return { port, requests: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []) };
}

function environment(dir, port) {
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { fake: { baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", apiKey: "fixture-only", models: [{ id: "scripted", contextWindow: 100000, maxTokens: 1000 }] } } }));
  const env = { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_TELEMETRY: "0", TERM: "xterm-256color" };
  // The wrapper must supply the runtime executables.
  delete env.PI_BG_TASKS_PYTHON;
  delete env.PI_BG_TASKS_SHELL;
  return env;
}

const baseArgs = (sessions) => ["--provider", "fake", "--model", "scripted", "--no-extensions", "-e", EXTENSION, "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes", "--offline", "--session-dir", sessions];
const spawnPrompt = (request) => `SPAWN ${JSON.stringify({ action: "spawn", cwd: "/", ...request })}`;

class Rpc {
  constructor(t, args, env) {
    this.proc = spawn(PI, ["--mode", "rpc", ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    this.records = [];
    this.stderr = "";
    let buffer = "";
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (text) => {
      buffer += text;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim()) this.records.push(JSON.parse(line));
      }
    });
    this.proc.stderr.on("data", (d) => { this.stderr += d; });
    this.exited = new Promise((res) => this.proc.once("exit", (code, signal) => res({ code, signal })));
    this.next = 1;
    defer(t, () => { if (this.proc.exitCode === null && this.proc.signalCode === null) this.proc.kill("SIGKILL"); });
  }

  async command(type, fields = {}) {
    const id = `r${this.next++}`;
    this.proc.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`);
    const reply = await waitFor(() => this.records.find((r) => r.type === "response" && r.id === id), { message: `${type} response`, timeoutMs: 20000 });
    assert.ok(reply.success, `${type} failed: ${reply.error} ${this.stderr}`);
    return reply.data;
  }

  settledCount() {
    return this.records.filter((r) => r.type === "agent_settled").length;
  }
}

function sidecarRegistry(sessionFile) {
  return Object.fromEntries(JSON.parse(readFileSync(`${sessionFile}.bg-tasks/tasks.json`, "utf8")).tasks.map((t) => [t.id, t]));
}

function lockReleased(sessionFile, python) {
  const r = spawnSync(python, ["-c", "import fcntl,sys; f=open(sys.argv[1],'a'); fcntl.flock(f, fcntl.LOCK_EX|fcntl.LOCK_NB)", `${sessionFile}.bg-tasks/owner.lock`]);
  return r.status === 0;
}

function supervisorsFor(sessionFile) {
  const r = spawnSync("ps", ["-eo", "args"], { encoding: "utf8" });
  return r.stdout.split("\n").filter((l) => l.includes("supervisor.py") && l.includes(`${sessionFile}.bg-tasks`));
}

test("rpc: the packaged extension registers bg_task and /bg, notifies an idle session, and records the receipt", async (t) => {
  const dir = tempDir(t, "bg-pkg-rpc-");
  const provider = await fakeProvider(t, dir);
  const rpc = new Rpc(t, baseArgs(join(dir, "sessions")), environment(dir, provider.port));
  const commands = await rpc.command("get_commands");
  assert.ok(commands.commands.some((c) => c.name === "bg"), JSON.stringify(commands));
  await rpc.command("prompt", { message: spawnPrompt({ label: "rpc-task", command: "sleep 0.5; echo rpc-done", notify: true }) });
  await waitFor(() => provider.requests().some((r) => r.last.includes("[bg-task]")), { message: "notice reached the model", timeoutMs: 20000 });
  assert.ok(provider.requests()[0].tools.includes("bg_task"), "the model was offered bg_task");
  await waitFor(() => rpc.settledCount() >= 2, { message: "notice run settled" });
  const state = await rpc.command("get_state");
  const [task] = Object.values(await waitFor(() => {
    const reg = sidecarRegistry(state.sessionFile);
    return Object.values(reg).every((x) => x.event?.status === "received") && Object.keys(reg).length ? reg : null;
  }, { message: "receipt" }));
  assert.deepEqual([task.state, task.reason], ["completed", "exit"]);
  assert.match(readFileSync(join(`${state.sessionFile}.bg-tasks`, task.logPath), "utf8"), /rpc-done/);
  const raw = readFileSync(state.sessionFile, "utf8");
  assert.equal(raw.split("\n").filter((l) => l.includes('"customType":"bg-task-completion"')).length, 1);
  rpc.proc.stdin.end();
  await rpc.exited;
  assert.equal(supervisorsFor(state.sessionFile).length, 0);
});

test("rpc: killing pi lets the supervisor record dead and release ownership; resume replays the notice", async (t) => {
  const dir = tempDir(t, "bg-pkg-kill-");
  const provider = await fakeProvider(t, dir);
  const env = environment(dir, provider.port);
  const rpc = new Rpc(t, baseArgs(join(dir, "sessions")), env);
  await rpc.command("prompt", { message: spawnPrompt({ label: "victim", command: "echo up; sleep 300", notify: true }) });
  await waitFor(() => rpc.settledCount() >= 1, { message: "spawn run" });
  const { sessionFile } = await rpc.command("get_state");
  const [taskId] = Object.keys(sidecarRegistry(sessionFile));
  const pgid = sidecarRegistry(sessionFile)[taskId].pgid;
  rpc.proc.kill("SIGKILL");
  await rpc.exited;
  await waitFor(() => lockReleased(sessionFile, PYTHON), { message: "lock release", timeoutMs: 20000 });
  const dead = sidecarRegistry(sessionFile)[taskId];
  assert.deepEqual([dead.state, dead.reason], ["dead", "owner_lost"]);
  assert.equal(spawnSync("sh", ["-c", `ps -eo pgid= | grep -qw ${pgid}`]).status, 1, "the owned group was cleaned up");
  const resumed = new Rpc(t, [...baseArgs(join(dir, "sessions")), "--session", sessionFile], env);
  await waitFor(() => sidecarRegistry(sessionFile)[taskId].event.status === "received", { message: "replayed notice receipt", timeoutMs: 20000 });
  // The receipt is recorded when Pi persists the notice, before it sends the provider request.
  await waitFor(() => provider.requests().some((r) => r.last.includes("[bg-task]") && r.last.includes("dead")), { message: "replayed notice reached the model" });
  resumed.proc.stdin.end();
  await resumed.exited;
});

test("print mode: a one-shot process stops its owned tasks when it exits", async (t) => {
  const dir = tempDir(t, "bg-pkg-print-");
  const provider = await fakeProvider(t, dir);
  const sessions = join(dir, "sessions");
  const r = spawnSync(PI, [...baseArgs(sessions), "-p", spawnPrompt({ label: "oneshot", command: "sleep 300", notify: false })], { env: environment(dir, provider.port), encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const files = readdirSync(sessions, { recursive: true }).filter((f) => String(f).endsWith(".jsonl"));
  assert.equal(files.length, 1);
  const sessionFile = join(sessions, String(files[0]));
  const [task] = Object.values(sidecarRegistry(sessionFile));
  assert.deepEqual([task.state, task.reason, task.reasonDetail], ["failed", "session_shutdown", "quit"]);
  assert.ok(lockReleased(sessionFile, PYTHON));
  assert.equal(supervisorsFor(sessionFile).length, 0);
});

test("tui: /bg shows live task output without replaying control sequences, and quitting stops owned tasks", async (t) => {
  const dir = tempDir(t, "bg-pkg-tui-");
  const provider = await fakeProvider(t, dir);
  const sessions = join(dir, "sessions");
  const command = "printf '\\033]0;evil-title\\007\\033]52;c;ZXZpbA==\\007'; for i in $(seq 1 600); do echo tick-$i; sleep 0.1; done";
  const steps = [
    { wait: "scripted", timeout: 30 },
    { sleep: 1 },
    { send: spawnPrompt({ label: "tui-progress", command, notify: false }) },
    { send: "\r" },
    { wait: "spawned", timeout: 30 },
    { sleep: 1.5 },
    { send: "/bg" },
    { sleep: 0.5 },
    { send: "\r" },
    { wait: "Background tasks", timeout: 15 },
    // A loaded list row (the label alone also appears in the echoed prompt).
    { wait: "bgt-[0-9a-f]{16}  tui-progress", timeout: 15 },
    { send: "\r" },
    { wait: "following live output", timeout: 15 },
    { wait: "tick-\\d+", timeout: 15 },
    { sleep: 1 },
    { send: "\x1b" },
    { sleep: 0.5 },
    { send: "q" },
    { sleep: 1 },
    { send: "/quit" },
    { sleep: 0.5 },
    { send: "\r" },
    { exit: 30 },
  ];
  const script = join(dir, "steps.json");
  const transcript = join(dir, "transcript.bin");
  writeFileSync(script, JSON.stringify(steps));
  const r = spawnSync(PYTHON, [join(HERE, "pty_drive.py"), script, transcript, "--", PI, ...baseArgs(sessions)], { env: environment(dir, provider.port), encoding: "utf8", timeout: 120000 });
  const screen = existsSync(transcript) ? readFileSync(transcript, "latin1") : "";
  assert.equal(r.status, 0, `${r.stderr}\n--- transcript tail ---\n${screen.slice(-3000)}`);
  assert.ok(!screen.includes("\x1b]0;evil-title"), "the task's title escape never reached Pi's terminal");
  assert.ok(!screen.includes("\x1b]52;c;ZXZpbA=="), "the task's clipboard escape never reached Pi's terminal");
  assert.match(screen, /tick-\d+/, "live output was rendered");
  const files = readdirSync(sessions, { recursive: true }).filter((f) => String(f).endsWith(".jsonl"));
  const sessionFile = join(sessions, String(files[0]));
  const [task] = Object.values(sidecarRegistry(sessionFile));
  assert.deepEqual([task.state, task.reason, task.reasonDetail], ["failed", "session_shutdown", "quit"]);
  assert.match(readFileSync(join(`${sessionFile}.bg-tasks`, task.logPath), "latin1"), /evil-title/, "raw bytes stay in the disk log");
  assert.ok(lockReleased(sessionFile, PYTHON));
});

