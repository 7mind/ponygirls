/**
 * pi-subagents — frozen error codes shared by protocol, store, policy,
 * broker, supervisor, and gate. Never invent ad-hoc code strings at call
 * sites; add a code here so tools, UI, and tests project one vocabulary.
 */

export const ERROR_CODES = [
  "NOT_RUNNING",
  "CAPACITY_EXCEEDED",
  "POLICY_DENIED",
  "STALE_GENERATION",
  "STALE_INSTANCE",
  "STALE_EPOCH",
  "SANDBOX_UNAVAILABLE",
  "UNCERTAIN_OPERATION",
  "NOT_FOUND",
  "CONFLICT",
  "CLOSED",
  "INVALID",
  "FORBIDDEN",
  "UNKNOWN_OPERATION",
  "PAYLOAD_TOO_LARGE",
  "FORGED_AUTHOR",
  "DUPLICATE_REQUEST",
  "ALREADY_SETTLED",
  "PROTOCOL_VERSION_MISMATCH",
  "RECOVERY_OWNER_UNCONFIRMED",
  "RECOVERY_CORRUPT",
  "RESERVED_ROUND_CONFLICT",
  "GATE_PROTOCOL_ERROR",
  "GATE_REFUSAL",
  "GATE_OUTPUT_LIMIT",
  "GATE_INVALID_APPROVAL",
  "MODEL_UNAVAILABLE",
  "WORKSPACE_UNAVAILABLE",
  "STORE_FAILED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class SubagentsError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(`${code}: ${message}`);
    this.name = "SubagentsError";
    this.code = code;
    this.details = details;
  }
}

export function err(code: ErrorCode, message: string, details?: unknown): SubagentsError {
  return new SubagentsError(code, message, details);
}
