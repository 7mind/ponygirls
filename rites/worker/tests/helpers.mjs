// Shared helpers for the worker tests. Fixture names only: no real provider
// identity, endpoint or credential appears anywhere in these tests.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Prepare the RITES_* run environment for tests that invoke the worker or
 * runAgent directly (the supervisor wrapper sets the same variables). Mirrors
 * scripts/run-worker.sh dev defaults; skips when already prepared.
 */
export function ensureRunEnvironment() {
  const requiredNames = ["RITES_NODE", "RITES_BWRAP", "RITES_WORKER_RUNTIME", "RITES_NIX_STORE", "RITES_TOOLCHAIN_PATH"];
  const missing = name => process.env[name] === undefined || process.env[name].length === 0;
  if (requiredNames.every(name => !missing(name))) return;
  const resolve = tool => {
    const result = spawnSync("bash", ["-c", `readlink -f "$(command -v ${tool})"`], { encoding: "utf8" });
    const path = result.stdout.trim();
    if (result.status !== 0 || path.length === 0) {
      throw new Error(`run-worker test environment: required command not found: ${tool}`);
    }
    return path;
  };
  const toolchain = ["node", "bash", "git", "rg", "fd", "ls", "grep", "find"]
    .map(resolve)
    .map(path => spawnSync("bash", ["-c", `dirname "${path}"`], { encoding: "utf8" }).stdout.trim());
  if (missing("RITES_NODE")) process.env.RITES_NODE = resolve("node");
  if (missing("RITES_BWRAP")) process.env.RITES_BWRAP = resolve("bwrap");
  if (missing("RITES_WORKER_RUNTIME")) process.env.RITES_WORKER_RUNTIME = spawnSync("bash", ["-c", `readlink -f "${join(RITES_DIR, "target", "worker")}"`], { encoding: "utf8" }).stdout.trim();
  if (missing("RITES_NIX_STORE")) process.env.RITES_NIX_STORE = "/nix/store";
  if (missing("RITES_TOOLCHAIN_PATH")) process.env.RITES_TOOLCHAIN_PATH = [...new Set(toolchain)].join(":");
  const optional = (name, path) => {
    if (!missing(name)) return;
    const result = spawnSync("bash", ["-c", `readlink -f "${path}"`], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim().length > 0) {
      process.env[name] = result.stdout.trim();
    }
  };
  optional("RITES_RESOLV_CONF", "/etc/resolv.conf");
  optional("RITES_HOSTS", "/etc/hosts");
  optional("RITES_NSSWITCH_CONF", "/etc/nsswitch.conf");
  optional("RITES_CA_BUNDLE", "/etc/ssl/certs/ca-certificates.crt");
}

export const RITES_DIR = join(fileURLToPath(import.meta.url), "..", "..", "..");
export const WORKER_CLI = join(RITES_DIR, "target", "worker", "worker", "main.js");
export const RUN_WORKER = join(RITES_DIR, "scripts", "run-worker.sh");
export const RUN_ID = "12345678-1234-4123-8123-123456789abc";

/**
 * A valid RunRequest frame with fixture selections.
 *
 * @param {Partial<{prompt: string, provider: string, model: string, runId: string, thinkingLevel: string}>} overrides
 */
export function requestFrame(overrides) {
  const prompt = overrides.prompt === undefined ? "# Task\nWrite the synthetic fixture.\n" : overrides.prompt;
  const provider = overrides.provider === undefined ? "fixture-provider" : overrides.provider;
  const model = overrides.model === undefined ? "fixture-model" : overrides.model;
  const runId = overrides.runId === undefined ? RUN_ID : overrides.runId;
  const thinkingLevel = overrides.thinkingLevel === undefined ? "off" : overrides.thinkingLevel;
  return Buffer.from(
    JSON.stringify({
      protocolVersion: "0.1.0",
      runId,
      prompt,
      model: { provider, model, thinkingLevel },
    }) + "\n",
  );
}

/**
 * A MODEL_CONFIG file for a local scripted provider.
 *
 * @param {string} url
 * @param {string} key
 * @param {Partial<{provider: string, model: string}>} overrides
 */
export function modelConfigFile(url, key, overrides = {}) {
  const provider = overrides.provider === undefined ? "fixture-provider" : overrides.provider;
  const model = overrides.model === undefined ? "fixture-model" : overrides.model;
  const config = {
    provider,
    modelsJson: {
      providers: {
        [provider]: {
          name: "fixture provider",
          baseUrl: url,
          api: "openai-completions",
          models: [
            {
              id: model,
              name: "fixture model",
              reasoning: false,
              contextWindow: 8192,
              maxTokens: 4096,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    },
    credential: { type: "api_key", key },
  };
  const dir = mkdtempSync(join(tmpdir(), "rites-cfg-"));
  const path = join(dir, "model.json");
  writeFileSync(path, JSON.stringify(config));
  return { path, config };
}

export function tempWorkspace(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return dir;
}

/**
 * Write a MODEL_CONFIG-shaped file from a raw JSON value.
 *
 * @param {unknown} value
 */
export function rawModelConfigFile(value) {
  const dir = mkdtempSync(join(tmpdir(), "rites-cfg-"));
  const path = join(dir, "model.json");
  writeFileSync(path, JSON.stringify(value));
  return path;
}

/**
 * Spawn a process with piped stdio and bounded output collection. The
 * `done` promise resolves on close; `child` stays usable for signals.
 *
 * @param {string} file
 * @param {string[]} args
 * @param {{env?: Record<string, string>, cwd?: string}} options
 */
export function spawnCollected(file, args, options) {
  const child = spawn(file, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    cwd: options.cwd,
  });
  const stdout = [];
  let stdoutBytes = 0;
  const stderr = [];
  let stderrBytes = 0;
  const done = new Promise((resolve, reject) => {
    const guard = { settled: false };
    child.stdout.on("data", chunk => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= 2 * 1024 * 1024) {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", chunk => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= 256 * 1024) {
        stderr.push(chunk);
      }
    });
    child.on("error", error => {
      if (!guard.settled) {
        guard.settled = true;
        reject(error);
      }
    });
    child.on("close", (code, signal) => {
      if (!guard.settled) {
        guard.settled = true;
        resolve({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
      }
    });
    child.stdin.on("error", () => {
      // Consumed by a process that exited before reading stdin.
    });
  });
  return { child, done };
}

/**
 * Write the stdin frame, wait for exit, and fail hard past a timeout.
 *
 * @param {ReturnType<typeof spawnCollected>} handle
 * @param {Buffer} stdin
 * @param {number} timeoutMs
 */
export async function finishProcess(handle, stdin, timeoutMs) {
  handle.child.stdin.write(stdin);
  handle.child.stdin.end();
  const timer = setTimeout(() => {
    handle.child.kill("SIGKILL");
  }, timeoutMs);
  try {
    return await handle.done;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience: spawn, feed stdin, await exit with a hard timeout.
 *
 * @param {string} file
 * @param {string[]} args
 * @param {{stdin: Buffer, env?: Record<string, string>, timeoutMs: number, cwd?: string}} options
 */
export async function runProcess(file, args, options) {
  const handle = spawnCollected(file, args, { env: options.env, cwd: options.cwd });
  return await finishProcess(handle, options.stdin, options.timeoutMs);
}

/**
 * Run the worker CLI directly (no sandbox).
 *
 * @param {{stdin: Buffer, modelConfigPath: string, workspace: string, timeoutSeconds: number, timeoutMs?: number}} options
 */
export function runWorkerCli(options) {
  return runProcess(
    process.execPath,
    [WORKER_CLI, options.workspace, options.modelConfigPath, String(options.timeoutSeconds)],
    { stdin: options.stdin, timeoutMs: options.timeoutMs === undefined ? 120_000 : options.timeoutMs },
  );
}

/**
 * Run the supervisor through the development wrapper (bubblewrap sandbox).
 *
 * @param {{stdin: Buffer, modelConfigPath: string, workspace: string, timeoutSeconds: number, timeoutMs?: number, env?: Record<string, string>}} options
 */
export function runSupervisor(options) {
  return runProcess(
    "bash",
    [RUN_WORKER, options.workspace, options.modelConfigPath, String(options.timeoutSeconds)],
    { stdin: options.stdin, timeoutMs: options.timeoutMs === undefined ? 180_000 : options.timeoutMs, env: options.env },
  );
}

/**
 * Decode exactly one newline-terminated protocol line, failing loudly.
 *
 * @param {Buffer} stdout
 */
export function parseResultLine(stdout) {
  const text = stdout.toString("utf8");
  const lines = text.split("\n");
  if (lines.length !== 2 || lines[1] !== "") {
    throw new Error(`expected exactly one output line, got ${JSON.stringify(text)}`);
  }
  return JSON.parse(lines[0]);
}

/**
 * A stub worker runtime for supervisor-logic tests. The main.js receives
 * WORKSPACE MODEL_CONFIG TIMEOUT_SECONDS and can emit arbitrary frames.
 *
 * @param {string} behavior
 */
export function stubWorkerRuntime(behavior) {
  const dir = mkdtempSync(join(tmpdir(), "rites-stub-"));
  mkdirSync(join(dir, "worker"), { recursive: true });
  const main = join(dir, "worker", "main.js");
  const lines = [
    "import { readSync } from 'node:fs';",
    "import { writeSync } from 'node:fs';",
    "import process from 'node:process';",
    "import { spawn } from 'node:child_process';",
    "const chunks = [];",
    "for (;;) { const b = Buffer.alloc(4096); let n; try { n = readSync(0, b, 0, 4096); } catch { n = 0; } if (n === 0) break; chunks.push(b.subarray(0, n)); }",
    "const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
    "const out = value => writeSync(1, Buffer.from(JSON.stringify(value) + '\\n'));",
  ];
  if (behavior === "wrong-runid") {
    lines.push(
      "out({ protocolVersion: '0.1.0', runId: '00000000-0000-4000-8000-000000000000', outcome: 'Completed', failureCode: null });",
      "process.exit(0);",
    );
  } else if (behavior === "crash") {
    lines.push("process.exit(1);");
  } else if (behavior === "two-frames") {
    lines.push(
      "out({ protocolVersion: '0.1.0', runId: request.runId, outcome: 'Completed', failureCode: null });",
      "out({ protocolVersion: '0.1.0', runId: request.runId, outcome: 'Completed', failureCode: null });",
      "process.exit(0);",
    );
  } else if (behavior === "linger-children") {
    lines.push(
      "out({ protocolVersion: '0.1.0', runId: request.runId, outcome: 'Cancelled', failureCode: 'aborted' });",
      "spawn('bash', ['-c', 'sleep 257 >/dev/null 2>&1 & disown'], { stdio: 'ignore' });",
      "setInterval(() => {}, 1000);",
    );
  } else if (behavior === "linger-completed") {
    lines.push(
      "out({ protocolVersion: '0.1.0', runId: request.runId, outcome: 'Completed', failureCode: null });",
      "spawn('bash', ['-c', 'sleep 257 >/dev/null 2>&1 & disown'], { stdio: 'ignore' });",
      "setInterval(() => {}, 1000);",
    );
  } else if (behavior === "silent-hang") {
    lines.push("setInterval(() => {}, 1000);");
  } else {
    throw new Error(`unknown stub behavior ${behavior}`);
  }
  writeFileSync(main, lines.join("\n"));
  return dir;
}

/**
 * Check whether a process with the exact argv suffix exists on the host.
 * The marker is assembled at runtime so this file's own command line never
 * matches the probe.
 *
 * @param {string[]} argvWords
 */
export function hostProcessExists(argvWords) {
  const result = spawnSync("pgrep", ["-x", argvWords[0], "-a"], { encoding: "utf8" });
  const out = result.status === 0 ? result.stdout.trim() : "";
  const suffix = argvWords.join(" ");
  return out.split("\n").some(line => line.trim().endsWith(suffix));
}
