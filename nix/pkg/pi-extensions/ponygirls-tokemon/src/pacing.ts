/** Shared with the Python dashboard: epoch seconds, BLOB bodies, no stored credentials. */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseRetryAfter, type Http, type HttpMethod, type HttpResponse } from "./http.ts";

export const CLAUDE_MIN_QUERY_MS = 300_000;
const RATE_LIMIT_BACKOFF_MS = 1_800_000;
const OAUTH_PREFIX = "https://api.anthropic.com/api/oauth/";
const BUSY_TIMEOUT_MS = 5_000;

export function stateDbPath(home: string, platform: string, environ: Record<string, string | undefined>): string {
  const cache = environ.XDG_CACHE_HOME || (platform === "darwin" ? join(home, "Library", "Caches") : join(home, ".cache"));
  return join(cache, "tokemon", "state.sqlite");
}

interface Row {
  next_allowed_at: number;
  body: Uint8Array | null;
  fetched_at: number | null;
}
interface Claim {
  proceed: boolean;
  body: string | null;
  fetchedAt: Date | null;
  nextAllowedAt: Date;
}

export class QueryLedger {
  private readonly path: string;
  constructor(path: string) { this.path = path; }

  private transaction<T>(run: (db: DatabaseSync) => T): T {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.path), 0o700);
    const db = new DatabaseSync(this.path);
    try {
      chmodSync(this.path, 0o600);
      db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}; BEGIN IMMEDIATE`);
      db.exec(`CREATE TABLE IF NOT EXISTS endpoint_queries (
        endpoint TEXT NOT NULL, credential_key TEXT NOT NULL, queried_at REAL NOT NULL,
        next_allowed_at REAL NOT NULL, status INTEGER, body BLOB, fetched_at REAL,
        PRIMARY KEY (endpoint, credential_key))`);
      const columns = db.prepare("PRAGMA table_info(endpoint_queries)").all();
      if (!columns.some((column) => column.name === "fetched_at")) db.exec("ALTER TABLE endpoint_queries ADD COLUMN fetched_at REAL");
      const result = run(db);
      db.exec("COMMIT");
      return result;
    } finally {
      db.close();
    }
  }

  claim(endpoint: string, key: string, now: Date): Claim {
    return this.transaction((db) => {
      const row = db.prepare("SELECT next_allowed_at, body, fetched_at FROM endpoint_queries WHERE endpoint = ? AND credential_key = ?").get(endpoint, key) as unknown as Row | undefined;
      const body = row && row.body !== null ? Buffer.from(row.body).toString("utf8") : null;
      const fetchedAt = row && row.fetched_at !== null ? new Date(row.fetched_at * 1000) : null;
      if (row && row.next_allowed_at * 1000 > now.getTime()) return { proceed: false, body, fetchedAt, nextAllowedAt: new Date(row.next_allowed_at * 1000) };
      const nextAllowedAt = new Date(now.getTime() + CLAUDE_MIN_QUERY_MS);
      db.prepare(`INSERT INTO endpoint_queries (endpoint, credential_key, queried_at, next_allowed_at, status, body)
        VALUES (?, ?, ?, ?, NULL, ?) ON CONFLICT (endpoint, credential_key) DO UPDATE SET
        queried_at = excluded.queried_at, next_allowed_at = excluded.next_allowed_at`).run(endpoint, key, now.getTime() / 1000, nextAllowedAt.getTime() / 1000, body === null ? null : Buffer.from(body));
      return { proceed: true, body, fetchedAt, nextAllowedAt };
    });
  }

  record(endpoint: string, key: string, now: Date, response: HttpResponse, nextAllowedAt: Date): void {
    this.transaction((db) => {
      db.prepare(`UPDATE endpoint_queries SET next_allowed_at = ?, status = ?,
        body = CASE WHEN ? = 200 THEN ? ELSE body END,
        fetched_at = CASE WHEN ? = 200 THEN ? ELSE fetched_at END
        WHERE endpoint = ? AND credential_key = ? AND queried_at = ?`).run(
        nextAllowedAt.getTime() / 1000, response.status, response.status, Buffer.from(response.body),
        response.status, now.getTime() / 1000, endpoint, key, now.getTime() / 1000,
      );
    });
  }
}

export class PacedHttp implements Http {
  private readonly ledger: QueryLedger;
  private readonly inner: Http;
  private readonly now: () => Date;
  constructor(inner: Http, path: string, now: () => Date) {
    this.inner = inner;
    this.now = now;
    this.ledger = new QueryLedger(path);
  }

  async request(method: HttpMethod, url: string, headers: Record<string, string>, body: string | null): Promise<HttpResponse> {
    const authorization = headers.Authorization;
    if (method !== "GET" || !authorization || !url.startsWith(OAUTH_PREFIX)) return this.inner.request(method, url, headers, body);
    const key = createHash("sha256").update(authorization).digest("hex");
    const now = this.now();
    const claim = this.ledger.claim(url, key, now);
    const cached = (): HttpResponse => ({ status: 200, body: claim.body!, retryAfter: null, quotaCache: { fetchedAt: claim.fetchedAt, retryAt: claim.nextAllowedAt } });
    const held = (retryAt: Date): HttpResponse => ({ status: 429, body: '{"error":"rate_limited"}', retryAfter: String(Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000))) });
    if (!claim.proceed) return claim.body !== null ? cached() : held(claim.nextAllowedAt);
    let response: HttpResponse;
    try {
      response = await this.inner.request(method, url, headers, body);
    } catch (error) {
      if (claim.body !== null) return cached();
      throw error;
    }
    const retryAt = response.status === 429
      ? new Date(Math.max(now.getTime() + RATE_LIMIT_BACKOFF_MS, parseRetryAfter(response.retryAfter, now)?.getTime() ?? 0))
      : claim.nextAllowedAt;
    this.ledger.record(url, key, now, response, retryAt);
    if (response.status === 200) return { ...response, quotaCache: { fetchedAt: now, retryAt } };
    if (claim.body !== null) return { ...cached(), quotaCache: { fetchedAt: claim.fetchedAt, retryAt } };
    return response.status === 429 ? held(retryAt) : response;
  }
}
