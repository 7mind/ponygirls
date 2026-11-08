import { BaboonCodecContext } from "../generated/typescript/BaboonSharedRuntime.js";
import { RunRequest } from "../generated/typescript/rites/worker/RunRequest.js";
import { RunResult } from "../generated/typescript/rites/worker/RunResult.js";
import { RunOutcome } from "../generated/typescript/rites/worker/RunOutcome.js";
import { VersionInfo } from "../generated/typescript/rites/worker/VersionInfo.js";

export const MAX_FRAME_BYTES = 1024 * 1024;
export const MAX_PROMPT_BYTES = 256 * 1024;
const MAX_IDENTIFIER_BYTES = 512;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FAILURE_CODE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export class ProtocolError extends Error {
  constructor(readonly code: "invalid-frame" | "unsupported-version") {
    super(code);
    this.name = "ProtocolError";
  }
}

export function versionInfo(): VersionInfo {
  const current = RunRequest.BaboonDomainVersion;
  return new VersionInfo(current, current, [current]);
}

function invalid(): never {
  throw new ProtocolError("invalid-frame");
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) invalid();
  return result;
}

function text(value: unknown, maxBytes: number): string {
  if (typeof value !== "string" || !value.isWellFormed() || value.trim().length === 0) invalid();
  if (new TextEncoder().encode(value).byteLength > maxBytes) invalid();
  return value;
}

function envelope(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = object(value, keys);
  if (typeof result.protocolVersion !== "string") invalid();
  if (result.protocolVersion !== RunRequest.BaboonDomainVersion) throw new ProtocolError("unsupported-version");
  if (!UUID_PATTERN.test(text(result.runId, MAX_IDENTIFIER_BYTES))) invalid();
  return result;
}

function request(value: unknown): RunRequest {
  const result = envelope(value, ["protocolVersion", "runId", "prompt", "model"]);
  text(result.prompt, MAX_PROMPT_BYTES);
  const model = object(result.model, ["provider", "model", "thinkingLevel"]);
  for (const key of ["provider", "model"]) {
    const identifier = text(model[key], MAX_IDENTIFIER_BYTES);
    if (identifier.trim() !== identifier || /[\u0000-\u001f\u007f]/.test(identifier)) invalid();
  }
  if (!THINKING_LEVELS.some(level => level === model.thinkingLevel)) invalid();
  return RunRequest.jsonCodec().decode(BaboonCodecContext.Default, result);
}

function result(value: unknown): RunResult {
  const terminal = envelope(value, ["protocolVersion", "runId", "outcome", "failureCode"]);
  if (terminal.outcome === RunOutcome.Completed) {
    if (terminal.failureCode !== null) invalid();
  } else if (terminal.outcome === RunOutcome.Failed || terminal.outcome === RunOutcome.Cancelled) {
    if (typeof terminal.failureCode !== "string" || !FAILURE_CODE_PATTERN.test(terminal.failureCode)) invalid();
  } else invalid();
  return RunResult.jsonCodec().decode(BaboonCodecContext.Default, terminal);
}

function parse(frame: Uint8Array): unknown {
  if (frame.byteLength === 0 || frame.byteLength > MAX_FRAME_BYTES) invalid();
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame)) as unknown;
  } catch {
    return invalid();
  }
}

function serialize(value: unknown): Uint8Array {
  const frame = new TextEncoder().encode(JSON.stringify(value));
  if (frame.byteLength > MAX_FRAME_BYTES) invalid();
  return frame;
}

export function decodeRunRequest(frame: Uint8Array): RunRequest {
  return request(parse(frame));
}

export function encodeRunRequest(value: RunRequest): Uint8Array {
  const json = RunRequest.jsonCodec().encode(BaboonCodecContext.Default, value);
  request(json);
  return serialize(json);
}

export function decodeRunResult(frame: Uint8Array): RunResult {
  return result(parse(frame));
}

export function encodeRunResult(value: RunResult): Uint8Array {
  const json = RunResult.jsonCodec().encode(BaboonCodecContext.Default, value);
  result(json);
  return serialize(json);
}
