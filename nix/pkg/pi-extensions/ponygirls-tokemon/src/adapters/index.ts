/**
 * Adapter registry: pi provider id -> quota adapter. Claude (anthropic) is
 * tokemon-only and not part of this extension.
 */

import { NoQuotaEndpoint, type QuotaAdapter } from "../quota.ts";
import { CodexQuota } from "./codex.ts";
import { CopilotQuota } from "./copilot.ts";
import { KimiQuota } from "./kimi.ts";
import { MetaQuota } from "./meta.ts";
import { MinimaxQuota } from "./minimax.ts";
import { OpenRouterQuota } from "./openrouter.ts";
import { VercelGatewayQuota } from "./vercel.ts";
import { XaiManagementQuota, XaiQuota } from "./xai.ts";
import { ZaiQuota } from "./zai.ts";

const NO_QUOTA = new NoQuotaEndpoint();

const ADAPTERS = new Map<string, QuotaAdapter>([
  ["github-copilot", new CopilotQuota()],
  ["kimi-coding", new KimiQuota()],
  ["meta", new MetaQuota()],
  ["minimax", new MinimaxQuota()],
  ["openai-codex", new CodexQuota()],
  ["openrouter", new OpenRouterQuota()],
  ["vercel-ai-gateway", new VercelGatewayQuota()],
  ["xai", new XaiQuota()],
  ["xai-management", new XaiManagementQuota()],
  ["zai", new ZaiQuota()],
]);

export function adapterFor(provider: string): QuotaAdapter {
  return ADAPTERS.get(provider) ?? NO_QUOTA;
}

/** True when this provider id has a quota surface to query. */
export function hasQuotaAdapter(provider: string): boolean {
  return ADAPTERS.has(provider);
}
