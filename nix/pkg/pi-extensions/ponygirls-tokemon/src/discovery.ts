/**
 * ponygirls-tokemon — the providers this pi is configured for, as query
 * targets (tokemon's discovery without yolo profiles or Claude):
 *
 * - every entry of the agent dir's `auth.json` (OAuth logins and API keys);
 * - the API-key environment variables pi resolves for providers with a plan
 *   surface, unless the same key is already stored in `auth.json`;
 * - `models.json` providers with neither, resolved through pi at query time.
 *   An `openai-completions` endpoint without a quota adapter (llama-swap,
 *   Ollama) has nothing to query and is omitted.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { hasQuotaAdapter } from "./adapters/index.ts";
import type { CredentialKind } from "./quota.ts";
import { isObject, optionalString, type JsonObject } from "./values.ts";

/** Environment variables pi resolves API keys from, mapped to pi provider ids (pi docs/providers.md). */
export const ENV_PROVIDER_KEYS: ReadonlyArray<[string, string]> = [
  ["AI_GATEWAY_API_KEY", "vercel-ai-gateway"],
  ["COPILOT_GITHUB_TOKEN", "github-copilot"],
  ["KIMI_API_KEY", "kimi-coding"],
  ["META_API_KEY", "meta"],
  ["MINIMAX_API_KEY", "minimax"],
  ["MINIMAX_CN_API_KEY", "minimax-cn"],
  ["OPENROUTER_API_KEY", "openrouter"],
  ["QWEN_TOKEN_PLAN_API_KEY", "qwen-token-plan"],
  ["QWEN_TOKEN_PLAN_CN_API_KEY", "qwen-token-plan-cn"],
  ["XAI_API_KEY", "xai"],
  // Not a pi variable: xAI inference keys cannot read billing, management keys can.
  ["XAI_MANAGEMENT_API_KEY", "xai-management"],
  ["XIAOMI_API_KEY", "xiaomi"],
  ["XIAOMI_TOKEN_PLAN_AMS_API_KEY", "xiaomi-token-plan-ams"],
  ["XIAOMI_TOKEN_PLAN_CN_API_KEY", "xiaomi-token-plan-cn"],
  ["XIAOMI_TOKEN_PLAN_SGP_API_KEY", "xiaomi-token-plan-sgp"],
  ["ZAI_API_KEY", "zai"],
  ["ZAI_CODING_CN_API_KEY", "zai-coding-cn"],
];

const OPENAI_COMPLETIONS_API = "openai-completions";

export type TargetOrigin = "auth.json" | "env" | "models.json";

/** A credential as stored: the access token or key, plus an OAuth login's refresh token. */
export interface StoredCredential {
  kind: CredentialKind;
  secret: string;
  refreshToken: string | null;
  /** Optional ChatGPT account id (openai-codex OAuth entries may carry `account_id`). */
  accountId: string | null;
}

export interface Target {
  provider: string;
  origin: TargetOrigin;
  /** Where it was found: the shortened file path, or the environment variable. */
  label: string;
  /** Null for a models.json provider (pi resolves its key) or an unreadable entry (see note). */
  credential: StoredCredential | null;
  note: string | null;
}

/** A config file exists but cannot be read as expected. */
export class DiscoveryError extends Error {
  override name = "DiscoveryError";
}

function readJsonObject(path: string): JsonObject | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new DiscoveryError(`${path}: unreadable JSON: ${(e as Error).message}`);
  }
  if (!isObject(parsed)) throw new DiscoveryError(`${path}: expected a JSON object`);
  return parsed;
}

function shorten(path: string, home: string): string {
  const rel = relative(home, path);
  return rel.startsWith("..") ? path : `~/${rel}`;
}

/** One `auth.json` provider entry, or the reason it cannot be used. */
function storedCredential(provider: string, entry: unknown): StoredCredential | string {
  if (!isObject(entry)) return `pi credential ${provider}: entry is not an object`;
  if (entry["type"] === "oauth") {
    const access = optionalString(entry["access"]);
    const accountId = optionalString(entry["account_id"]) ?? optionalString(entry["accountId"]);
    return access ? { kind: "oauth", secret: access, refreshToken: optionalString(entry["refresh"]), accountId } : `pi credential ${provider}: oauth entry has no access token`;
  }
  if (entry["type"] === "api_key") {
    const key = optionalString(entry["key"]);
    return key ? { kind: "api_key", secret: key, refreshToken: null, accountId: null } : `pi credential ${provider}: api_key entry has no key`;
  }
  return `pi credential ${provider}: unknown type ${JSON.stringify(entry["type"] ?? null)}`;
}

export function discoverTargets(agentDir: string, home: string, env: Readonly<Record<string, string | undefined>>): Target[] {
  const targets: Target[] = [];
  const authPath = join(agentDir, "auth.json");
  const auth = readJsonObject(authPath);
  for (const provider of Object.keys(auth ?? {}).sort()) {
    const credential = storedCredential(provider, auth![provider]);
    targets.push(typeof credential === "string"
      ? { provider, origin: "auth.json", label: shorten(authPath, home), credential: null, note: credential }
      : { provider, origin: "auth.json", label: shorten(authPath, home), credential, note: null });
  }
  const stored = new Set(targets.flatMap((t) => (t.credential ? [t.credential.secret] : [])));
  for (const [name, provider] of ENV_PROVIDER_KEYS) {
    const key = env[name];
    if (!key || stored.has(key)) continue;
    targets.push({ provider, origin: "env", label: name, credential: { kind: "api_key", secret: key, refreshToken: null, accountId: null }, note: null });
  }
  const modelsPath = join(agentDir, "models.json");
  const providers = readJsonObject(modelsPath)?.["providers"];
  if (isObject(providers)) {
    const covered = new Set(targets.map((t) => t.provider));
    for (const provider of Object.keys(providers).sort()) {
      if (covered.has(provider)) continue;
      const config = providers[provider];
      if (isObject(config) && config["api"] === OPENAI_COMPLETIONS_API && !hasQuotaAdapter(provider)) continue;
      targets.push({ provider, origin: "models.json", label: shorten(modelsPath, home), credential: null, note: null });
    }
  }
  return targets;
}
