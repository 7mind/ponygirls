// Strict validation of the operator-owned MODEL_CONFIG file. The file must
// describe exactly one selected provider: its pi models.json provider
// fragment and its API-key credential. Nothing from a personal model registry
// is accepted, and no other provider may ride along.

import { closeSync, openSync } from "node:fs";
import { MAX_MODEL_CONFIG_BYTES } from "./bounds.js";
import { readAllBounded, ReadIoError } from "./stdio.js";

export interface ApiKeyModelCredential {
  readonly type: "api_key";
  readonly key: string;
}

export interface ModelConfig {
  readonly provider: string;
  readonly modelsJson: Record<string, unknown>;
  readonly credential: ApiKeyModelCredential;
}

export class InvalidModelConfigError extends Error {
  constructor() {
    super("invalid-config");
    this.name = "InvalidModelConfigError";
  }
}

const MAX_PROVIDER_BYTES = 512;
const MAX_KEY_BYTES = 4096;

function fail(): never {
  throw new InvalidModelConfigError();
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail();
  }
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) {
    fail();
  }
  return result;
}

function boundedText(value: unknown, maxBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || !value.isWellFormed()) {
    fail();
  }
  if (value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    fail();
  }
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    fail();
  }
  return value;
}

/**
 * Parse and strictly validate MODEL_CONFIG bytes. Throws
 * InvalidModelConfigError for any deviation; never includes field values in
 * the error.
 */
export function parseModelConfig(bytes: Uint8Array): ModelConfig {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MODEL_CONFIG_BYTES) {
    fail();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail();
  }
  const root = object(parsed, ["provider", "modelsJson", "credential"]);
  const provider = boundedText(root.provider, MAX_PROVIDER_BYTES);
  const modelsJson = object(root.modelsJson, ["providers"]);
  const providers = object(modelsJson.providers, [provider]);
  const providerFragment = providers[provider];
  if (providerFragment === null || typeof providerFragment !== "object" || Array.isArray(providerFragment)) {
    fail();
  }
  const credential = object(root.credential, ["type", "key"]);
  if (credential.type !== "api_key") {
    fail();
  }
  const key = boundedText(credential.key, MAX_KEY_BYTES);
  return {
    provider,
    modelsJson: modelsJson as Record<string, unknown>,
    credential: { type: "api_key", key },
  };
}

/**
 * Read and validate the MODEL_CONFIG file from disk with a bounded read.
 * ReadIoError is reported by the caller as invalid-config as well: an
 * unreadable model config is not a usable model config.
 */
export function loadModelConfig(path: string): ModelConfig {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    throw new InvalidModelConfigError();
  }
  try {
    return parseModelConfig(readAllBounded(fd, MAX_MODEL_CONFIG_BYTES));
  } catch (error) {
    if (error instanceof ReadIoError) {
      throw new InvalidModelConfigError();
    }
    throw error;
  } finally {
    closeSync(fd);
  }
}
