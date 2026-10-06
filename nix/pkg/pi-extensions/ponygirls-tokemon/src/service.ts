/**
 * ponygirls-tokemon — one quota refresh over every target, shared by the
 * agent tool and the /tokemon pane.
 *
 * Each target is queried in isolation (one failing provider never hides the
 * rest). Access tokens come from pi itself, which refreshes an expired OAuth
 * login under its own auth.json lock, so this extension never rotates a
 * token behind pi's back. A target still inside the Retry-After window of
 * its last HTTP 429 keeps that result instead of being queried again, and a
 * refresh within `maxAgeMs` of the last one returns it unchanged.
 */

import { adapterFor, hasQuotaAdapter } from "./adapters/index.ts";
import type { Target } from "./discovery.ts";
import { parseRetryAfter, type Http } from "./http.ts";
import { RateLimitedError, type Credential, type QuotaSnapshot } from "./quota.ts";

const MAX_CONCURRENT_QUERIES = 8;

/** pi's credential resolution for a provider (refreshing an expired OAuth login). */
export interface ProviderAuth {
  apiKey(provider: string): Promise<string | null>;
}

export interface QueryResult {
  target: Target;
  snapshot: QuotaSnapshot | null;
  error: string | null;
  fetchedAt: Date;
  rateLimited: boolean;
  /** When a rate-limited endpoint said to retry; null when it named no time. */
  retryAt: Date | null;
}

export interface QuotaReport {
  results: QueryResult[];
  refreshedAt: Date;
}

export interface QuotaServiceDeps {
  discover(): Target[];
  http: Http;
  now(): Date;
}

function targetKey(target: Target): string {
  return `${target.origin}\u0000${target.provider}\u0000${target.label}`;
}

/**
 * Merge results reporting the same provider account (one login reached
 * through two credentials): the first keeps its origin, and its label lists
 * both locations.
 */
export function coalesceByIdentity(results: QueryResult[]): QueryResult[] {
  const out: QueryResult[] = [];
  const positions = new Map<string, number>();
  for (const result of results) {
    const identity = result.snapshot?.identity ?? null;
    if (identity === null) {
      out.push(result);
      continue;
    }
    const key = `${result.target.provider}\u0000${identity}`;
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, out.length);
      out.push(result);
      continue;
    }
    const prior = out[position]!;
    out[position] = { ...prior, target: { ...prior.target, label: `${prior.target.label}, ${result.target.label}` }, error: null, rateLimited: false, retryAt: null };
  }
  return out;
}

async function inPool<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

export class QuotaService {
  private readonly deps: QuotaServiceDeps;
  private last: QuotaReport | null = null;
  private inflight: Promise<QuotaReport> | null = null;
  /** The previous refresh's per-target results, before identity merging. */
  private previous = new Map<string, QueryResult>();

  constructor(deps: QuotaServiceDeps) {
    this.deps = deps;
  }

  /** The latest report if younger than `maxAgeMs`, else a fresh one (concurrent callers share it). */
  report(auth: ProviderAuth, maxAgeMs: number): Promise<QuotaReport> {
    if (this.last && this.deps.now().getTime() - this.last.refreshedAt.getTime() < maxAgeMs) return Promise.resolve(this.last);
    if (!this.inflight) this.inflight = this.refresh(auth).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async refresh(auth: ProviderAuth): Promise<QuotaReport> {
    const now = this.deps.now();
    const due: Target[] = [];
    const held: QueryResult[] = [];
    for (const target of this.deps.discover()) {
      const previous = this.previous.get(targetKey(target));
      if (previous?.rateLimited && previous.retryAt && previous.retryAt > now) held.push(previous);
      else due.push(target);
    }
    const results = [...(await inPool(due, MAX_CONCURRENT_QUERIES, (target) => this.query(target, auth))), ...held];
    this.previous = new Map(results.map((r) => [targetKey(r.target), r]));
    this.last = { results: coalesceByIdentity(results), refreshedAt: now };
    return this.last;
  }

  private async query(target: Target, auth: ProviderAuth): Promise<QueryResult> {
    const fetchedAt = this.deps.now();
    const done = (snapshot: QuotaSnapshot | null, error: string | null): QueryResult => ({ target, snapshot, error, fetchedAt, rateLimited: false, retryAt: null });
    try {
      const adapter = adapterFor(target.provider);
      let credential: Credential;
      if (target.origin === "models.json") {
        if (!hasQuotaAdapter(target.provider)) return done({ plan: null, identity: null, windows: [], note: "no quota endpoint" }, null);
        const key = await auth.apiKey(target.provider);
        if (!key) return done(null, "models.json provider without a resolvable credential");
        credential = { kind: "api_key", secret: key, refreshToken: null };
      } else if (!target.credential) {
        return done(null, target.note ?? "no credential");
      } else if (target.origin === "auth.json" && adapter.usesAccessToken) {
        const key = await auth.apiKey(target.provider);
        if (!key) return done(null, "pi has no usable credential for this provider (log in again?)");
        credential = { ...target.credential, secret: key };
      } else {
        credential = { ...target.credential };
      }
      return done(await adapter.fetch(credential, this.deps.http), null);
    } catch (e) {
      if (e instanceof RateLimitedError) return { target, snapshot: null, error: e.message, fetchedAt, rateLimited: true, retryAt: parseRetryAfter(e.retryAfter, fetchedAt) };
      return done(null, `${(e as Error).name}: ${(e as Error).message}`);
    }
  }
}
