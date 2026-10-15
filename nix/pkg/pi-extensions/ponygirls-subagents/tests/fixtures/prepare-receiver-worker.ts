/**
 * Test-only true-receiver entrypoint for prepare-timeout / interrupt races.
 *
 * Imports the UNCHANGED production worker first (so its Node PUBLIC
 * `process.on('message')` receiver is registered first), then registers a
 * second Node PUBLIC `process.on('message')` listener that records every
 * `tool.prepare` response envelope observed AT THE RECEIVER into the task
 * tmpfile named by PI_SUBAGENTS_RECEIPT_FILE (one JSON line per response)
 * plus a bounded stderr marker. No private SDK hooks, no evaluated
 * functions, no transcript rewrites, no new IPC methods, no source
 * instrumentation: only the public IPC channel is observed.
 */
import "../../src/worker.ts";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const RECEIPT_FILE: string = process.env["PI_SUBAGENTS_RECEIPT_FILE"] ?? "";
const MAX_STDERR_MARKERS = 20;
let markers = 0;

function receiptLine(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (e["type"] !== "response" || e["operation"] !== "tool.prepare") return null;
  const payload = (e["payload"] ?? {}) as Record<string, unknown>;
  const line = {
    at: Date.now(),
    requestId: e["requestId"] ?? null,
    rootEpoch: e["rootEpoch"] ?? null,
    agentId: e["agentId"] ?? null,
    workerInstanceId: e["workerInstanceId"] ?? null,
    taskRunId: e["taskRunId"] ?? null,
    executionGeneration: e["executionGeneration"] ?? null,
    ok: payload["ok"] ?? null,
    ticket: payload["ticket"] ?? null,
    preparedArgs: payload["preparedArgs"] ?? null,
    error: payload["error"] ?? null,
  };
  return `${JSON.stringify(line)}\n`;
}

// Registered AFTER the production receiver (import above ran first).
process.on("message", (raw: unknown) => {
  const line = receiptLine(raw);
  if (line === null) return;
  try {
    if (RECEIPT_FILE) {
      try {
        mkdirSync(dirname(RECEIPT_FILE), { recursive: true });
      } catch {
        // best effort
      }
      appendFileSync(RECEIPT_FILE, line, "utf8");
    }
  } catch (err) {
    if (markers < MAX_STDERR_MARKERS) {
      markers++;
      try {
        process.stderr.write(`[prepare-receipt] append failed: ${(err as Error).message}\n`);
      } catch {
        // ignore
      }
    }
  }
  if (markers < MAX_STDERR_MARKERS) {
    markers++;
    try {
      const parsed = JSON.parse(line) as { requestId?: unknown; ok?: unknown };
      process.stderr.write(`[prepare-receipt] prepare-rx requestId=${String(parsed.requestId)} ok=${String(parsed.ok)}\n`);
    } catch {
      // ignore
    }
  }
});
