// Supervisor and bubblewrap sandbox tests through scripts/run-worker.sh.
// These tests exercise the real pinned Node, the real Pi SDK worker, real
// bubblewrap isolation and the hard deadline. They hard-require bubblewrap
// and unprivileged user namespaces; a missing prerequisite fails loudly and
// is never silently skipped. Fixture names and synthetic secrets only.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

function requireBubblewrap() {
  const result = spawnSync("bwrap", ["--version"], { encoding: "utf8" });
  if (result.error !== undefined || result.status !== 0) {
    assert.fail(
      `bubblewrap is required for sandbox tests and is unavailable (status=${String(result.status)} error=${String(result.error)}); ` +
        "run inside nix develop .#backend from the repository root",
    );
  }
}
import { startScriptedProvider } from "./fixtures/scripted-provider.mjs";
import {
  hostProcessExists,
  modelConfigFile,
  parseResultLine,
  requestFrame,
  runSupervisor,
  spawnCollected,
  stubWorkerRuntime,
  tempWorkspace,
  RUN_WORKER,
  RUN_ID,
} from "./helpers.mjs";

const MARKER_SECONDS = 200 + 57; // assembled so this file never matches itself

const hostHomeDir = () => {
  const home = process.env.HOME;
  return typeof home === "string" && home.length > 0 && home !== "/" ? home : "/nonexistent-home";
};

test("sandbox prerequisites are present", () => {
  requireBubblewrap();
});

test("model credential and host secrets never reach the sandbox or the model", async () => {
  const hostSecrets = tempWorkspace("rites-secret-");
  const sentinel = join(hostSecrets, "credential-sentinel");
  writeFileSync(sentinel, "synthetic-host-secret\n");
  const workspace = tempWorkspace("rites-secret-run-");
  const cfgHost = tempWorkspace("rites-secret-cfg-");
  const realCfgPath = join(cfgHost, "probe-model.json");
  writeFileSync(
    realCfgPath,
    JSON.stringify({
      provider: "fixture-provider",
      modelsJson: { providers: {} },
      credential: { type: "api_key", key: "synthetic-secret" },
    }),
  );

  const probe = [
    `cat ${realCfgPath} > /workspace/s.modelconfig 2>&1; echo rc=$? >> /workspace/s.modelconfig`,
    `cat ${sentinel} > /workspace/s.sentinel 2>&1; echo rc=$? >> /workspace/s.sentinel`,
    `cat /proc/self/environ > /workspace/s.environ 2>&1`,
    `test -e /proc/1/root/run/rites/model.json && echo present > /workspace/s.procroot-model || echo absent > /workspace/s.procroot-model`,
    `test -d /proc/1/root${hostHomeDir()} && echo present > /workspace/s.procroot-home || echo absent > /workspace/s.procroot-home`,
    `ls /proc/1/root > /workspace/s.procroot 2>&1`,
  ].join("; ");

  const provider = await startScriptedProvider([
    { type: "tool", name: "rites_read", args: { path: realCfgPath } },
    { type: "tool", name: "rites_read", args: { path: sentinel } },
    { type: "tool", name: "rites_bash", args: { command: probe } },
    { type: "text", text: "probes complete" },
  ]);
  try {
    const { path: cfgPath } = modelConfigFile(provider.url, "synthetic-secret");
    const result = await runSupervisor({
      stdin: requestFrame({ prompt: "# Task\nAttempt to read the model configuration and host secrets.\n" }),
      modelConfigPath: cfgPath,
      workspace,
      timeoutSeconds: 90,
      env: { RITES_FAKE_FORGE_TOKEN: "synthetic-forge-token" },
    });
    assert.equal(result.code, 0, `stderr: ${result.stderr.toString("utf8")}`);
    const frame = parseResultLine(result.stdout);
    assert.equal(frame.outcome, "Completed", JSON.stringify(frame));

    // The provider observed every message, including all tool results: the
    // model credential and host sentinel must never appear in any request.
    const bodies = provider.requests.map(request => JSON.stringify(request.body));
    assert.ok(bodies.length >= 4, "expected read, read, bash and final requests");
    for (const body of bodies) {
      assert.equal(body.includes("synthetic-secret"), false, "model credential leaked to the model");
      assert.equal(body.includes("synthetic-host-secret"), false, "host sentinel leaked to the model");
      assert.equal(body.includes("synthetic-forge-token"), false, "forge env leaked to the model");
    }
    // The read and bash attempts really executed: the transcript names the
    // brokered tools, and their failures are visible as tool results.
    const toolEcho = bodies.some(body => body.includes("rites_read") || body.includes("rites_bash"));
    assert.equal(toolEcho, true, "expected brokered tool calls in the transcript");

    const read = name => readFileSync(join(workspace, name), "utf8");
    assert.match(read("s.modelconfig"), /rc=[1-9]/, "model config must not exist in the sandbox");
    assert.match(read("s.sentinel"), /rc=[1-9]/, "host sentinel must not exist in the sandbox");
    const environ = read("s.environ");
    assert.equal(environ.includes("synthetic-forge-token"), false, "forge env must be absent from the sandbox environ");
    assert.equal(environ.includes("RITES_"), false, "supervisor environment must be absent from the sandbox environ");
    assert.equal(read("s.procroot-model"), "absent\n", "model config must not exist at any sandbox-visible path");
    assert.equal(read("s.procroot-home"), "absent\n", "host home must not exist under /proc/1/root");
    const procRoot = read("s.procroot");
    assert.equal(/\b(usr|var|boot)\b/.test(procRoot), false, `sandbox root exposes host directories: ${procRoot}`);
    assert.equal(procRoot.includes("workspace"), true, `sandbox root misses the workspace bind: ${procRoot}`);
  } finally {
    await provider.close();
  }
});

test("end-to-end scripted run completes inside the sandbox and writes the workspace", async () => {
  const provider = await startScriptedProvider([
    { type: "tool", name: "rites_write", args: { path: "out.txt", content: "sandboxed fixture content\n" } },
    { type: "text", text: "wrote the fixture file" },
  ]);
  try {
    const workspace = tempWorkspace("rites-e2e-");
    const { path } = modelConfigFile(provider.url, "synthetic-secret");
    const result = await runSupervisor({ stdin: requestFrame({}), modelConfigPath: path, workspace, timeoutSeconds: 60 });
    assert.equal(result.code, 0, `stderr: ${result.stderr.toString("utf8")}`);
    const frame = parseResultLine(result.stdout);
    assert.deepEqual(frame, { protocolVersion: "0.1.0", runId: RUN_ID, outcome: "Completed", failureCode: null });
    assert.equal(readFileSync(join(workspace, "out.txt"), "utf8"), "sandboxed fixture content\n");
  } finally {
    await provider.close();
  }
});

test("sandbox negative controls: host state is invisible, forge env absent, .pi not executed", async () => {
  const hostSecrets = tempWorkspace("rites-host-");
  writeFileSync(join(hostSecrets, "sentinel"), "synthetic-host-secret\n");
  const otherRepo = tempWorkspace("rites-other-repo-");
  writeFileSync(join(otherRepo, "repo-file.txt"), "other repo content\n");
  const hostSentinelProcess = spawn("sleep", ["300"]);
  const homeDir = process.env.HOME;

  const workspace = tempWorkspace("rites-neg-");
  // A repository-owned .pi extension that must never execute.
  mkdirSync(join(workspace, ".pi", "agent", "extensions"), { recursive: true });
  writeFileSync(
    join(workspace, ".pi", "agent", "extensions", "marker.ts"),
    'import { writeFileSync } from "node:fs";\nwriteFileSync("/workspace/.pi-marker", "executed");\n',
  );
  writeFileSync(
    join(workspace, ".pi", "settings.json"),
    JSON.stringify({ extensions: [".pi/agent/extensions/marker.ts"] }),
  );

  const probe = [
    `cat ${join(hostSecrets, "sentinel")} > /workspace/p.sentinel 2>/workspace/p.sentinel.err; echo rc=$? >> /workspace/p.sentinel.err`,
    `ls ${otherRepo} > /workspace/p.otherrepo 2>&1; echo rc=$? >> /workspace/p.otherrepo`,
    `printenv RITES_FAKE_FORGE_TOKEN > /workspace/p.env 2>&1; echo rc=$? >> /workspace/p.env`,
    `test -d /proc/${hostSentinelProcess.pid} && echo present > /workspace/p.pid || echo absent > /workspace/p.pid`,
    `test -d ${homeDir} && echo present > /workspace/p.home || echo absent > /workspace/p.home`,
  ].join("; ");
  const provider = await startScriptedProvider([
    { type: "tool", name: "rites_bash", args: { command: probe } },
    { type: "text", text: "probes written" },
  ]);
  try {
    const { path } = modelConfigFile(provider.url, "synthetic-secret");
    const result = await runSupervisor({
      stdin: requestFrame({ prompt: "# Task\nRun the probes.\n" }),
      modelConfigPath: path,
      workspace,
      timeoutSeconds: 60,
      env: { RITES_FAKE_FORGE_TOKEN: "synthetic-forge-token" },
    });
    assert.equal(result.code, 0, `stderr: ${result.stderr.toString("utf8")}`);
    const frame = parseResultLine(result.stdout);
    assert.equal(frame.outcome, "Completed", JSON.stringify(frame));

    const read = name => readFileSync(join(workspace, name), "utf8");
    assert.equal(read("p.sentinel"), "", "host sentinel must be unreadable");
    assert.match(read("p.sentinel.err"), /rc=[1-9]/, "host sentinel read must fail");
    assert.match(read("p.otherrepo"), /rc=[1-9]/, "other repository must be inaccessible");
    assert.match(read("p.env"), /rc=[1-9]/, "inherited forge env must be absent");
    assert.equal(read("p.pid"), "absent\n", "host PID must not be visible in /proc");
    assert.equal(read("p.home"), "absent\n", "host HOME must not be accessible");
    assert.equal(existsSync(join(workspace, ".pi-marker")), false, ".pi extension must not execute");
    assert.equal(existsSync(join(workspace, ".pi", "agent", "extensions", "marker.ts")), true, "workspace files survive");
  } finally {
    hostSentinelProcess.kill("SIGKILL");
    await provider.close();
  }
});

test("DNS and TLS are usable inside the sandbox with pinned resolver and CA", async () => {
  const probe = [
    "node --input-type=module -e",
    '"',
    "import { lookup } from 'node:dns/promises';",
    "import { get } from 'node:https';",
    "const status = {};",
    "try { const a = await lookup('example.com'); status.dns = a.address === undefined ? 'none' : 'ok'; } catch { status.dns = 'failed'; }",
    "await new Promise(resolve => {",
    "  const req = get('https://example.com/', res => { status.tls = res.statusCode > 0 ? 'ok' : 'none'; res.resume(); res.on('end', resolve); });",
    "  req.on('error', () => { status.tls = 'failed'; resolve(undefined); });",
    "  setTimeout(() => { status.tls = 'failed'; req.destroy(); resolve(undefined); }, 20000);",
    "});",
    "console.log(JSON.stringify(status));",
    '"',
    "> /workspace/dns-tls.txt 2>&1; echo rc=$? >> /workspace/dns-tls.txt",
  ].join(" ");
  const provider = await startScriptedProvider([
    { type: "tool", name: "rites_bash", args: { command: probe } },
    { type: "text", text: "probe done" },
  ]);
  try {
    const workspace = tempWorkspace("rites-dns-");
    const { path } = modelConfigFile(provider.url, "synthetic-secret");
    const result = await runSupervisor({
      stdin: requestFrame({ prompt: "# Task\nCheck DNS and TLS.\n" }),
      modelConfigPath: path,
      workspace,
      timeoutSeconds: 90,
    });
    assert.equal(result.code, 0, `stderr: ${result.stderr.toString("utf8")}`);
    const frame = parseResultLine(result.stdout);
    assert.equal(frame.outcome, "Completed", JSON.stringify(frame));
    const report = readFileSync(join(workspace, "dns-tls.txt"), "utf8");
    const status = JSON.parse(report.slice(0, report.lastIndexOf("}") + 1));
    assert.equal(status.dns, "ok", `dns failed inside sandbox: ${report}`);
    assert.equal(status.tls, "ok", `tls failed inside sandbox: ${report}`);
  } finally {
    await provider.close();
  }
});

test("hard supervisor deadline synthesizes Cancelled/deadline over a captured Completed frame", async () => {
  const stub = stubWorkerRuntime("linger-completed");
  const workspace = tempWorkspace("rites-dl-");
  const { path } = modelConfigFile("http://127.0.0.1:1/v1", "synthetic-secret");
  const started = Date.now();
  const result = await runSupervisor({
    stdin: requestFrame({}),
    modelConfigPath: path,
    workspace,
    timeoutSeconds: 2,
    env: { RITES_WORKER_RUNTIME: stub },
  });
  const elapsed = Date.now() - started;
  assert.equal(result.code, 0);
  const frame = parseResultLine(result.stdout);
  assert.equal(frame.outcome, "Cancelled");
  assert.equal(frame.failureCode, "deadline");
  assert.equal(frame.runId, RUN_ID);
  assert.ok(elapsed < 20_000, `deadline teardown took ${elapsed}ms`);
  assert.equal(hostProcessExists(["sleep", String(MARKER_SECONDS)]), false, "no sandbox child may survive");
});

test("lingering sandbox children force Failed/sandbox-children over a captured frame", async () => {
  const stub = stubWorkerRuntime("linger-children");
  const workspace = tempWorkspace("rites-ling-");
  const { path } = modelConfigFile("http://127.0.0.1:1/v1", "synthetic-secret");
  const result = await runSupervisor({
    stdin: requestFrame({}),
    modelConfigPath: path,
    workspace,
    timeoutSeconds: 60,
    env: { RITES_WORKER_RUNTIME: stub },
  });
  assert.equal(result.code, 0);
  const frame = parseResultLine(result.stdout);
  assert.equal(frame.outcome, "Failed");
  assert.equal(frame.failureCode, "sandbox-children");
  assert.equal(frame.runId, RUN_ID);
  assert.equal(hostProcessExists(["sleep", String(MARKER_SECONDS)]), false, "no sandbox child may survive");
});

test("a wrong-runId worker frame is rejected as worker-protocol", async () => {
  const stub = stubWorkerRuntime("wrong-runid");
  const workspace = tempWorkspace("rites-runid-");
  const { path } = modelConfigFile("http://127.0.0.1:1/v1", "synthetic-secret");
  const result = await runSupervisor({
    stdin: requestFrame({}),
    modelConfigPath: path,
    workspace,
    timeoutSeconds: 30,
    env: { RITES_WORKER_RUNTIME: stub },
  });
  assert.equal(result.code, 0);
  const frame = parseResultLine(result.stdout);
  assert.equal(frame.outcome, "Failed");
  assert.equal(frame.failureCode, "worker-protocol");
  assert.equal(frame.runId, RUN_ID);
});

test("a crashing worker is reported as worker-protocol", async () => {
  const stub = stubWorkerRuntime("crash");
  const workspace = tempWorkspace("rites-crash-");
  const { path } = modelConfigFile("http://127.0.0.1:1/v1", "synthetic-secret");
  const result = await runSupervisor({
    stdin: requestFrame({}),
    modelConfigPath: path,
    workspace,
    timeoutSeconds: 30,
    env: { RITES_WORKER_RUNTIME: stub },
  });
  assert.equal(result.code, 0);
  const frame = parseResultLine(result.stdout);
  assert.equal(frame.outcome, "Failed");
  assert.equal(frame.failureCode, "worker-protocol");
});

test("multiple worker frames are rejected as worker-protocol", async () => {
  const stub = stubWorkerRuntime("two-frames");
  const workspace = tempWorkspace("rites-two-");
  const { path } = modelConfigFile("http://127.0.0.1:1/v1", "synthetic-secret");
  const result = await runSupervisor({
    stdin: requestFrame({}),
    modelConfigPath: path,
    workspace,
    timeoutSeconds: 30,
    env: { RITES_WORKER_RUNTIME: stub },
  });
  assert.equal(result.code, 0);
  const frame = parseResultLine(result.stdout);
  assert.equal(frame.outcome, "Failed");
  assert.equal(frame.failureCode, "worker-protocol");
});

test("supervisor rejects an invalid request frame without spawning", async () => {
  const workspace = tempWorkspace("rites-bad-");
  const { path } = modelConfigFile("http://127.0.0.1:1/v1", "synthetic-secret");
  const result = await runSupervisor({
    stdin: Buffer.from("{\n"),
    modelConfigPath: path,
    workspace,
    timeoutSeconds: 30,
  });
  assert.equal(result.code, 1);
  assert.equal(result.stdout.byteLength, 0);
});

test("supervisor rejects an oversized request frame without spawning", async () => {
  const workspace = tempWorkspace("rites-big-");
  const { path } = modelConfigFile("http://127.0.0.1:1/v1", "synthetic-secret");
  const result = await runSupervisor({
    stdin: Buffer.concat([requestFrame({}), Buffer.alloc(1024 * 1024 + 1, 0x20)]),
    modelConfigPath: path,
    workspace,
    timeoutSeconds: 30,
  });
  assert.equal(result.code, 1);
  assert.equal(result.stdout.byteLength, 0);
});

test("a hanging provider is cancelled by the worker watchdog before the hard deadline", async () => {
  const provider = await startScriptedProvider([{ type: "hang" }]);
  try {
    const workspace = tempWorkspace("rites-hang-");
    const { path } = modelConfigFile(provider.url, "synthetic-secret");
    const started = Date.now();
    const result = await runSupervisor({
      stdin: requestFrame({}),
      modelConfigPath: path,
      workspace,
      timeoutSeconds: 3,
    });
    const elapsed = Date.now() - started;
    assert.equal(result.code, 0);
    const frame = parseResultLine(result.stdout);
    assert.equal(frame.outcome, "Cancelled");
    assert.equal(frame.failureCode, "deadline");
    assert.ok(elapsed < 15_000, `run took ${elapsed}ms`);
  } finally {
    await provider.close();
  }
});

test("SIGTERM to the supervisor cancels the sandbox and reports aborted", async () => {
  const provider = await startScriptedProvider([{ type: "hang" }]);
  try {
    const workspace = tempWorkspace("rites-sig-");
    const { path } = modelConfigFile(provider.url, "synthetic-secret");
    const handle = spawnCollected("bash", [RUN_WORKER, workspace, path, "60"], {});
    handle.child.stdin.write(requestFrame({}));
    handle.child.stdin.end();
    const deadline = Date.now() + 60_000;
    while (provider.requests.length < 1 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(provider.requests.length >= 1, "provider never received the request");
    handle.child.kill("SIGTERM");
    const result = await Promise.race([
      handle.done,
      new Promise((_, reject) => setTimeout(() => reject(new Error("supervisor ignored SIGTERM")), 30_000)),
    ]);
    assert.equal(result.code, 0);
    const frame = parseResultLine(result.stdout);
    assert.equal(frame.outcome, "Cancelled");
    assert.equal(frame.failureCode, "aborted");
    assert.equal(frame.runId, RUN_ID);
  } finally {
    await provider.close();
  }
});

test("detached grandchildren cannot survive a completed run", async () => {
  const provider = await startScriptedProvider([
    {
      type: "tool",
      name: "bash",
      args: { command: `sleep ${MARKER_SECONDS} >/dev/null 2>&1 & disown; echo detached` },
    },
    { type: "text", text: "detached child spawned" },
  ]);
  try {
    const workspace = tempWorkspace("rites-grand-");
    const { path } = modelConfigFile(provider.url, "synthetic-secret");
    const result = await runSupervisor({
      stdin: requestFrame({ prompt: "# Task\nSpawn a detached child, then finish.\n" }),
      modelConfigPath: path,
      workspace,
      timeoutSeconds: 60,
    });
    assert.equal(result.code, 0, `stderr: ${result.stderr.toString("utf8")}`);
    const frame = parseResultLine(result.stdout);
    assert.equal(frame.outcome, "Completed", JSON.stringify(frame));
    assert.equal(hostProcessExists(["sleep", String(MARKER_SECONDS)]), false, "no sandbox child may survive a completed run");
  } finally {
    await provider.close();
  }
});
