/**
 * ponygirls-tokemon — the agent tool's answer: every configured provider's
 * plan, login, and quota windows (with their state), notes and errors, and,
 * when asked, each provider's available models.
 */

import type { TargetOrigin } from "./discovery.ts";
import { formatResets, rateLimitedStatus, sortResults, windowState, type WindowState } from "./format.ts";
import type { QuotaReport } from "./service.ts";

export interface WindowReport {
  name: string;
  used: number | null;
  limit: number | null;
  unit: string;
  unlimited: boolean;
  state: WindowState;
  resetsAt: string | null;
  /** Countdown to the reset ("2h 05m", "3d 4h"), or null. */
  resetsIn: string | null;
}

export interface ProviderReport {
  provider: string;
  source: TargetOrigin;
  /** Where the credential was found: a file path or an environment variable. */
  location: string;
  login: string | null;
  plan: string | null;
  windows: WindowReport[];
  note: string | null;
  error: string | null;
  rateLimited: boolean;
  retryAt: string | null;
}

export interface ModelReport {
  id: string;
  /** Effort levels pi can run this model at (getSupportedThinkingLevels). */
  efforts: string[];
}

export interface ContextReport {
  /** Estimated context tokens, or null if unknown. */
  tokens: number | null;
  contextWindow: number;
  /** Usage as a percentage of the window, or null if tokens is unknown. */
  percent: number | null;
}

export interface ToolReport {
  fetchedAt: string;
  providers: ProviderReport[];
  /** Available models by provider, with effort levels; present only when requested. */
  models?: Record<string, ModelReport[]>;
  /** The calling session's context size and usage; present only when requested and known. */
  context?: ContextReport;
}

export interface ReportOptions {
  models: Map<string, ModelReport[]> | null;
  /** False drops the quota windows (plan, login, notes, and errors stay). */
  quotas: boolean;
  context: ContextReport | null;
}

export function toolReport(report: QuotaReport, now: Date, options: ReportOptions): ToolReport {
  const providers = sortResults(report.results).map((r): ProviderReport => ({
    provider: r.target.provider,
    source: r.target.origin,
    location: r.target.label,
    login: r.snapshot?.identity ?? null,
    plan: r.snapshot?.plan ?? null,
    windows: options.quotas ? (r.snapshot?.windows ?? []).map((w) => ({
      name: w.name,
      used: w.used,
      limit: w.limit,
      unit: w.unit,
      unlimited: w.unlimited,
      state: windowState(w),
      resetsAt: w.resetsAt?.toISOString() ?? null,
      resetsIn: w.resetsAt ? formatResets(w, now) : null,
    })) : [],
    note: r.snapshot?.note ?? null,
    error: r.rateLimited ? rateLimitedStatus(r.retryAt, now) : r.error,
    rateLimited: r.rateLimited,
    retryAt: r.retryAt?.toISOString() ?? null,
  }));
  const out: ToolReport = { fetchedAt: report.refreshedAt.toISOString(), providers };
  if (options.models !== null) {
    out.models = Object.fromEntries([...options.models.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([provider, models]) => [provider, [...models].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))]));
  }
  if (options.context !== null) out.context = options.context;
  return out;
}
