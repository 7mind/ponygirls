// Shared numeric/byte bounds for the worker CLI and the supervisor.
// Protocol framing bounds live in protocol/protocol.ts and are reused here.

export const MIN_TIMEOUT_SECONDS = 1;
export const MAX_TIMEOUT_SECONDS = 2_592_000; // 30 days, inclusive.
export const MAX_MODEL_CONFIG_BYTES = 1024 * 1024;

// Grace given to a SIGTERM-terminated process tree before SIGKILL escalation.
export const KILL_GRACE_MS = 5_000;
// Time a closed worker output channel may keep the sandbox alive after the
// worker's own exit before the supervisor force-reaps lingering children.
export const DRAIN_GRACE_MS = 5_000;
// Hard cap on captured worker stderr; diagnostics only, never forwarded.
export const MAX_CAPTURED_STDERR_BYTES = 64 * 1024;

const TIMEOUT_PATTERN = /^[0-9]{1,7}$/;

export class ArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgumentError";
  }
}

/**
 * Parse and bound-check the TIMEOUT_SECONDS argument shared by the worker
 * CLI and the supervisor CLI.
 */
export function parseTimeoutSeconds(raw: string): number {
  if (!TIMEOUT_PATTERN.test(raw)) {
    throw new ArgumentError(`timeout must be ${MIN_TIMEOUT_SECONDS}..${MAX_TIMEOUT_SECONDS} seconds`);
  }
  const value = Number.parseInt(raw, 10);
  if (value < MIN_TIMEOUT_SECONDS || value > MAX_TIMEOUT_SECONDS) {
    throw new ArgumentError(`timeout must be ${MIN_TIMEOUT_SECONDS}..${MAX_TIMEOUT_SECONDS} seconds`);
  }
  return value;
}
