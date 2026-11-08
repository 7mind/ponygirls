// The Rites run supervisor. Validates the request frame itself, validates the
// RITES_* environment, launches the trusted host worker (the Pi SDK session
// with the model credential in memory; the worker brokers tool calls into
// isolated bubblewrap tool-runners itself), captures the worker's single
// protocol frame on a separate channel, enforces the hard wall-clock deadline
// over the entire worker process tree, and emits exactly one RunResult frame
// bound to the request runId.
//
// Result selection (a bound frame is necessary, never sufficient):
//   1. hard deadline expired before the whole tree was reaped
//        -> Cancelled/"deadline", even over a captured Completed frame
//   2. tree had to be force-reaped to clean up lingering children
//        -> Failed/"sandbox-children", even over a captured Completed frame
//   3. supervisor cancelled by signal without a captured bound frame
//        -> Cancelled/"aborted"
//   4. bound frame + worker exit 0 + tree self-reaped -> pass-through
//   5. anything else                            -> Failed/"worker-protocol"
//
// Usage: supervisor.js WORKSPACE MODEL_CONFIG TIMEOUT_SECONDS
// Environment: see run-env.ts (RITES_* variables).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { realpathSync, statSync, writeSync, type Stats } from "node:fs";
import process from "node:process";
import {
  ArgumentError,
  DRAIN_GRACE_MS,
  MAX_CAPTURED_STDERR_BYTES,
  MAX_MODEL_CONFIG_BYTES,
  parseTimeoutSeconds,
} from "./bounds.js";
import { TreeKiller } from "./kill.js";
import { loadRunEnvironment, type RunEnvironment } from "./run-env.js";
import { readAllBounded } from "./stdio.js";
import { decodeRunRequest, decodeRunResult, encodeRunResult, MAX_FRAME_BYTES } from "../protocol/protocol.js";
import { RunOutcome } from "../generated/typescript/rites/worker/RunOutcome.js";
import { RunRequest } from "../generated/typescript/rites/worker/RunRequest.js";
import { RunResult } from "../generated/typescript/rites/worker/RunResult.js";

const EXIT_FRAME_EMITTED = 0;
const EXIT_INVALID_INPUT = 1;
const EXIT_UNREAPABLE = 2;

type KillReason = "deadline" | "signal" | "children";

function exitInvalid(message: string): never {
  process.stderr.write(`rites-supervisor: ${message}\n`);
  process.exit(EXIT_INVALID_INPUT);
}

function statExisting(path: string, label: string, wantDirectory: boolean): string {
  if (!path.startsWith("/")) {
    exitInvalid(`${label} must be an absolute path`);
  }
  let stats: Stats | undefined;
  try {
    stats = statSync(path);
  } catch {
    stats = undefined;
  }
  if (stats === undefined) {
    exitInvalid(`${label} is not accessible: ${path}`);
  }
  if (wantDirectory) {
    if (!stats.isDirectory()) {
      exitInvalid(`${label} is not a directory: ${path}`);
    }
  } else if (!stats.isFile()) {
    exitInvalid(`${label} is not a regular file: ${path}`);
  }
  return path;
}

class OutputCapture {
  private readonly chunks: Buffer[] = [];
  private total = 0;
  private newlineIndex = -1;
  overflow = false;
  extraOutput = false;

  push(chunk: Buffer): void {
    if (this.newlineIndex >= 0) {
      this.extraOutput = true;
      return;
    }
    this.total += chunk.byteLength;
    if (this.total > MAX_FRAME_BYTES) {
      this.overflow = true;
      return;
    }
    const newline = chunk.indexOf(0x0a);
    if (newline >= 0) {
      this.chunks.push(chunk.subarray(0, newline));
      this.newlineIndex = this.total - chunk.byteLength + newline;
      if (chunk.byteLength > newline + 1) {
        this.extraOutput = true;
      }
      return;
    }
    this.chunks.push(chunk);
  }

  frameComplete(): boolean {
    return this.newlineIndex >= 0 && !this.overflow && !this.extraOutput;
  }

  frameBytes(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

class StderrCapture {
  private total = 0;

  push(chunk: Buffer): void {
    if (this.total < MAX_CAPTURED_STDERR_BYTES) {
      this.total += chunk.byteLength;
    }
  }
}

function emit(frame: RunResult): void {
  const bytes = encodeRunResult(frame);
  writeSync(1, Buffer.concat([Buffer.from(bytes), Buffer.from("\n")]));
}

async function supervise(argv: string[], environment: RunEnvironment): Promise<number> {
  if (argv.length !== 3) {
    exitInvalid("usage: supervisor.js WORKSPACE MODEL_CONFIG TIMEOUT_SECONDS");
  }
  const workspace = realpathSync(statExisting(argv[0], "WORKSPACE", true));
  const modelConfig = realpathSync(statExisting(argv[1], "MODEL_CONFIG", false));
  if (statSync(modelConfig).size > MAX_MODEL_CONFIG_BYTES) {
    exitInvalid("MODEL_CONFIG exceeds the size bound");
  }
  let timeoutSeconds: number;
  try {
    timeoutSeconds = parseTimeoutSeconds(argv[2]);
  } catch (error) {
    if (error instanceof ArgumentError) {
      exitInvalid(error.message);
    }
    throw error;
  }
  if (process.stdin.isTTY === true) {
    exitInvalid("request frame must be piped on stdin");
  }
  let frame: Uint8Array;
  try {
    frame = readAllBounded(0, MAX_FRAME_BYTES);
  } catch {
    exitInvalid("request frame exceeds MAX_FRAME_BYTES");
  }
  let request: RunRequest;
  try {
    request = decodeRunRequest(frame);
  } catch {
    exitInvalid("request frame is not a valid RunRequest");
  }

  const child = spawn(
    environment.node,
    [`${environment.workerRuntimeDir}/worker/main.js`, workspace, modelConfig, String(timeoutSeconds)],
    { stdio: ["pipe", "pipe", "pipe"], detached: true },
  ) as ChildProcessWithoutNullStreams;
  // The worker leads its own process group so orphaned descendants stay
  // reachable for teardown after they are reparented to init.

  const stdoutCapture = new OutputCapture();
  const stderrCapture = new StderrCapture();
  const killReason: { reason: KillReason | undefined } = { reason: undefined };
  let deadlineFired = false;
  let closed = false;
  let spawnFailed = false;
  const killer = new TreeKiller(child);

  let resolveClosed: () => void = (): void => {
    // Replaced when the promise below is constructed.
  };
  const closedPromise = new Promise<void>(resolve => {
    resolveClosed = resolve;
  });
  child.on("close", () => {
    closed = true;
    resolveClosed();
  });
  child.on("error", () => {
    // A failed spawn may not emit 'close'; treat it as terminal either way.
    spawnFailed = true;
    resolveClosed();
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutCapture.push(chunk);
    if (stdoutCapture.frameComplete()) {
      armDrain();
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrCapture.push(chunk);
  });
  child.stdin.on("error", () => {
    // The worker died before consuming the frame; the close event decides.
  });
  child.stdin.write(Buffer.from(frame));
  child.stdin.end();

  const deadline = setTimeout(() => {
    deadlineFired = true;
    killer.fire();
  }, timeoutSeconds * 1000);
  let drain: NodeJS.Timeout | undefined;
  const armDrain = (): void => {
    if (drain === undefined && !closed) {
      drain = setTimeout(() => {
        if (!closed) {
          killReason.reason = killReason.reason === undefined ? "children" : killReason.reason;
          killer.fire();
        }
      }, DRAIN_GRACE_MS);
    }
  };

  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (killReason.reason === undefined) {
      killReason.reason = "signal";
    }
    killer.fire();
  };
  process.on("SIGTERM", forwardSignal);
  process.on("SIGINT", forwardSignal);

  let exitCode: number | null = null;
  let closeObserved = false;
  try {
    await closedPromise;
    closeObserved = closed;
    exitCode = child.exitCode;
  } finally {
    clearTimeout(deadline);
    if (drain !== undefined) {
      clearTimeout(drain);
    }
    killer.dispose();
    process.off("SIGTERM", forwardSignal);
    process.off("SIGINT", forwardSignal);
  }

  if (!closeObserved) {
    // The tree could not be reaped even after SIGKILL escalation. Never
    // report a terminal outcome for a possibly-still-running worker.
    process.stderr.write("rites-supervisor: worker process tree could not be reaped\n");
    return EXIT_UNREAPABLE;
  }

  let captured: RunResult | null = null;
  if (stdoutCapture.frameComplete()) {
    try {
      const decoded = decodeRunResult(stdoutCapture.frameBytes());
      if (decoded.runId === request.runId) {
        captured = decoded;
      }
    } catch {
      captured = null;
    }
  }

  if (spawnFailed) {
    emit(new RunResult(RunRequest.BaboonDomainVersion, request.runId, RunOutcome.Failed, "worker-protocol"));
    return EXIT_FRAME_EMITTED;
  }
  if (deadlineFired) {
    emit(new RunResult(RunRequest.BaboonDomainVersion, request.runId, RunOutcome.Cancelled, "deadline"));
    return EXIT_FRAME_EMITTED;
  }
  if (killReason.reason === "children") {
    emit(new RunResult(RunRequest.BaboonDomainVersion, request.runId, RunOutcome.Failed, "sandbox-children"));
    return EXIT_FRAME_EMITTED;
  }
  if (killReason.reason === "signal" && captured === null) {
    emit(new RunResult(RunRequest.BaboonDomainVersion, request.runId, RunOutcome.Cancelled, "aborted"));
    return EXIT_FRAME_EMITTED;
  }
  if (captured !== null && exitCode === 0 && (killReason.reason === undefined || killReason.reason === "signal")) {
    // A self-reaped tree, or a signal-cancelled run whose worker still
    // emitted its own bound terminal frame: trust the bound frame.
    emit(captured);
    return EXIT_FRAME_EMITTED;
  }
  emit(new RunResult(RunRequest.BaboonDomainVersion, request.runId, RunOutcome.Failed, "worker-protocol"));
  return EXIT_FRAME_EMITTED;
}

async function main(): Promise<void> {
  const environment = loadRunEnvironmentWithExit();
  const code = await supervise(process.argv.slice(2), environment);
  process.exit(code);
}

function loadRunEnvironmentWithExit(): RunEnvironment {
  try {
    return loadRunEnvironment(process.env);
  } catch (error) {
    if (error instanceof Error) {
      exitInvalid(error.message);
    }
    exitInvalid("run environment is invalid");
  }
}

void main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : typeof error;
  process.stderr.write(`rites-supervisor: unexpected ${name}\n`);
  process.exit(EXIT_UNREAPABLE);
});
