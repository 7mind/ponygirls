// The Rites worker CLI. One bounded RunRequest frame on stdin, exactly one
// RunResult frame on stdout, then exit. Diagnostics never reach stdout: the
// console is redirected to stderr at startup so SDK-internal writes cannot
// contaminate the protocol channel.
//
// Usage: main.js WORKSPACE MODEL_CONFIG TIMEOUT_SECONDS
//   WORKSPACE        absolute path to the run workspace (inside the sandbox)
//   MODEL_CONFIG     absolute path to the operator-owned selected-provider
//                    model config (inside the sandbox)
//   TIMEOUT_SECONDS  positive integer run budget

import { format } from "node:util";
import { statSync, writeSync, type Stats } from "node:fs";
import process from "node:process";
import { runAgent } from "./agent.js";
import { ArgumentError, parseTimeoutSeconds } from "./bounds.js";
import { InvalidModelConfigError, loadModelConfig } from "./model-config.js";
import { readAllBounded } from "./stdio.js";
import { RunOutcome } from "../generated/typescript/rites/worker/RunOutcome.js";
import { RunRequest } from "../generated/typescript/rites/worker/RunRequest.js";
import { RunResult } from "../generated/typescript/rites/worker/RunResult.js";
import {
  decodeRunRequest,
  encodeRunResult,
  MAX_FRAME_BYTES,
  ProtocolError,
} from "../protocol/protocol.js";

const EXIT_OK = 0;
const EXIT_INVALID_REQUEST = 2;
const EXIT_CRASH = 70;

function redirectConsole(): void {
  const write = (parts: unknown[]): void => {
    process.stderr.write(`${parts.map(part => format(part)).join(" ")}\n`);
  };
  const consoleShim = {
    log: (...parts: unknown[]) => write(parts),
    info: (...parts: unknown[]) => write(parts),
    debug: (...parts: unknown[]) => write(parts),
    warn: (...parts: unknown[]) => write(parts),
    error: (...parts: unknown[]) => write(parts),
  };
  Object.assign(globalThis, { console: consoleShim });
}

function fail(message: string): never {
  process.stderr.write(`rites-worker: ${message}\n`);
  process.exit(EXIT_CRASH);
}

function statExisting(path: string, label: string, wantDirectory: boolean): string {
  if (!path.startsWith("/")) {
    fail(`${label} must be an absolute path`);
  }
  let stats: Stats | undefined;
  try {
    stats = statSync(path);
  } catch {
    stats = undefined;
  }
  if (stats === undefined) {
    fail(`${label} is not accessible`);
  }
  if (wantDirectory) {
    if (!stats.isDirectory()) {
      fail(`${label} is not a directory`);
    }
  } else if (!stats.isFile()) {
    fail(`${label} is not a regular file`);
  }
  return path;
}

function emitResult(runId: string, outcome: RunOutcome, failureCode: string | null): void {
  const code = failureCode === null ? undefined : failureCode;
  const frame = encodeRunResult(new RunResult(RunRequest.BaboonDomainVersion, runId, outcome, code));
  writeSync(1, Buffer.concat([Buffer.from(frame), Buffer.from("\n")]));
}

function main(): void {
  redirectConsole();
  const argv = process.argv.slice(2);
  if (argv.length !== 3) {
    fail("usage: rites-worker WORKSPACE MODEL_CONFIG TIMEOUT_SECONDS");
  }
  const workspace = statExisting(argv[0], "WORKSPACE", true);
  const modelConfigPath = statExisting(argv[1], "MODEL_CONFIG", false);
  let timeoutSeconds: number;
  try {
    timeoutSeconds = parseTimeoutSeconds(argv[2]);
  } catch (error) {
    if (error instanceof ArgumentError) {
      fail(error.message);
    }
    throw error;
  }

  let frame: Uint8Array;
  try {
    frame = readAllBounded(0, MAX_FRAME_BYTES);
  } catch {
    process.exit(EXIT_INVALID_REQUEST);
  }
  let request: RunRequest;
  try {
    request = decodeRunRequest(frame);
  } catch (error) {
    if (error instanceof ProtocolError) {
      process.exit(EXIT_INVALID_REQUEST);
    }
    throw error;
  }

  const cancel = new AbortController();
  const onSignal = (signal: NodeJS.Signals): void => {
    process.stderr.write(`rites-worker: received ${signal}\n`);
    cancel.abort();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("uncaughtException", error => {
    process.stderr.write(`rites-worker: uncaught ${error.name}\n`);
    process.exit(EXIT_CRASH);
  });
  process.on("unhandledRejection", reason => {
    const name = reason instanceof Error ? reason.name : typeof reason;
    process.stderr.write(`rites-worker: unhandled rejection ${name}\n`);
    process.exit(EXIT_CRASH);
  });

  try {
    const modelConfig = loadModelConfig(modelConfigPath);
    if (cancel.signal.aborted) {
      emitResult(request.runId, RunOutcome.Cancelled, "aborted");
      process.exit(EXIT_OK);
    }
    void runAgent({
      request,
      workspace,
      modelConfig,
      timeoutMs: timeoutSeconds * 1000,
      cancel: cancel.signal,
    })
      .then(outcome => {
        emitResult(request.runId, outcome.outcome, outcome.failureCode);
        process.exit(EXIT_OK);
      })
      .catch(() => {
        // runAgent maps every failure itself; this is unreachable protection.
        emitResult(request.runId, RunOutcome.Failed, "worker-internal");
        process.exit(EXIT_OK);
      });
  } catch (error) {
    if (error instanceof InvalidModelConfigError) {
      emitResult(request.runId, RunOutcome.Failed, "invalid-config");
      process.exit(EXIT_OK);
    }
    throw error;
  }
}

main();
