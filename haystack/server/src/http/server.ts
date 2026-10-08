// Haystack HTTP application (Step 5): the single implementation behind the
// browser API; MCP (Step 6) reuses the same service and auth.
// Per-layer logging allowlist (docs/auth.md §4): route label, request id,
// timing, status, principal/token labels, revision counters, fixed result
// categories. Bodies, keys, query text, and secrets never enter logs.
import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { ItemService } from "../application/service.js";
import { SearchService } from "../application/search.js";
import { InvalidQuery } from "../query/ast.js";
import { InvalidCursor } from "../application/search.js";
import { InvalidId } from "../domain/qid.js";
import { BadEnvelope } from "../domain/json.js";
import { InvalidDocument, type Principal } from "../domain/document.js";
import { ConflictFault, NotFoundFault, ReplayConflictFault } from "../storage/repository.js";
import type { SearchableRepository } from "../storage/search.js";
import type { Clock } from "../application/clock.js";
import type { ResolvedAuth } from "../auth/config.js";
import { TokenFault, TOKEN_RE } from "../auth/tokens.js";
import { mountMcp } from "../mcp/adapter.js";
import { cookieName, parseSessionCookie, serializeSessionCookie } from "./cookies.js";
import { LiveUpdates } from "./live.js";
import { PublishingRepository } from "../storage/publishing.js";

export interface LogEvent {
  readonly requestId: string;
  readonly route: string;
  readonly status: number;
  readonly result: string;
  readonly userId?: string;
  readonly tokenId?: string;
  readonly revision?: number;
  readonly durationMs?: number;
}

export type Logger = (event: LogEvent) => void;

export interface AppDeps {
  /** Getter (not value) so credential reloads take effect without restart. */
  getAuth: () => ResolvedAuth;
  /** Single shared repository (and pool) for the app lifetime. A factory
   *  here would leak a pool per request and exhaust PostgreSQL. */
  repo: SearchableRepository;
  clock: Clock;
  updates: LiveUpdates;
  logger?: Logger;
}

interface Authed {
  principal: Principal;
  method: "bearer" | "cookie";
  /** Presented token (request-scoped memory only, for cookie renewal). */
  token: string;
}

const BEARER_RE = /^Bearer (\S+)$/;

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  const log: Logger = deps.logger ?? ((e) => console.log(JSON.stringify(e)));
  const limiter = new RateLimiter();

  // Liveness without data: no auth, no-store, always available.
  app.get("/api/v1/health", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ ok: true, service: "haystack" });
  });

  // Cache + referrer controls on every dynamic response.
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });

  // Host allowlist (port ignored).
  app.use("/api", (req, res, next) => {
    const host = (req.headers.host ?? "").split(":")[0]?.toLowerCase() ?? "";
    const allowed = deps.getAuth().config.allowedHosts.map((h) => h.toLowerCase());
    if (!host || !allowed.includes(host)) {
      return finish(res, req, "host", 403, { error: { code: "forbidden", message: "disallowed host" } }, log, undefined);
    }
    next();
  });

  const withAuth = (route: string, mutate: boolean, handler: (req: Request, res: Response, authed: Authed) => Promise<void>) => {
    return (req: Request, res: Response) => {
      const started = Date.now();
      const requestId = randomUUID();
      let authed: Authed;
      try {
        authed = resolveAuth(req, deps.getAuth());
      } catch (err) {
        return fault(res, req, route, requestId, started, err, log, undefined);
      }
      if (mutate && authed.method === "cookie" && !csrfOk(req, deps.getAuth())) {
        return fault(res, req, route, requestId, started, csrfFault(), log, authed);
      }
      const limit = limiter.check(authed.principal, deps.getAuth().config.rateLimit);
      if (!limit.ok) {
        return fault(res, req, route, requestId, started, rateFault(), log, authed);
      }
      // Rolling session: renew the cookie lifetime on authenticated activity.
      if (authed.method === "cookie") {
        res.setHeader("Set-Cookie", serializeSessionCookie(authed.token, deps.getAuth().config.cookieSecure));
      }
      handler(req, res, authed)
        .then(() => {
          log({ requestId, route, status: res.statusCode, result: "ok", userId: authed.principal.userId, tokenId: authed.principal.tokenId, durationMs: Date.now() - started });
        })
        .catch((err) => fault(res, req, route, requestId, started, err, log, authed));
    };
  };

  const repo = new PublishingRepository(deps.repo, deps.updates);
  const items = new ItemService(repo, deps.clock);
  const search = new SearchService(repo);

  // Login uses the submitted token, never an existing cookie.
  app.post("/api/v1/login", (req: Request, res: Response) => {
    const started = Date.now();
    const requestId = randomUUID();
    if (!csrfOk(req, deps.getAuth())) {
      return fault(res, req, "login", requestId, started, csrfFault(), log, undefined);
    }
    const token = (req.body as { token?: unknown } | undefined)?.token;
    if (typeof token !== "string" || !TOKEN_RE.test(token)) {
      return fault(res, req, "login", requestId, started, new TokenFault(), log, undefined);
    }
    const principal = deps.getAuth().authenticate(token);
    if (!principal) {
      return fault(res, req, "login", requestId, started, new TokenFault(), log, undefined);
    }
    deps.updates.endSession(req.headers.cookie);
    res.set("Set-Cookie", serializeSessionCookie(token, deps.getAuth().config.cookieSecure));
    log({ requestId, route: "login", status: 200, result: "ok", userId: principal.userId, tokenId: principal.tokenId, durationMs: Date.now() - started });
    res.json({ user: { id: principal.userId, type: principal.type } });
  });

  app.post("/api/v1/logout", withAuth("logout", true, async (req, res) => {
    deps.updates.endSession(req.headers.cookie);
    res.set("Set-Cookie", serializeSessionCookie(null, deps.getAuth().config.cookieSecure));
    res.json({ ok: true });
  }));

  app.get("/api/v1/whoami", withAuth("whoami", false, async (_req, res, authed) => {
    res.json({
      userId: authed.principal.userId,
      type: authed.principal.type,
      tokenId: authed.principal.tokenId,
      activityProjectId: deps.getAuth().activityProjectId,
    });
  }));

  app.post("/api/v1/get", withAuth("get", false, async (req, res, authed) => {
    void authed;
    const body = req.body as { key?: unknown; revision?: unknown };
    if (typeof body?.key !== "string") throw new BadEnvelope("key must be a string");
    if (body.revision !== undefined && (!Number.isInteger(body.revision) || (body.revision as number) < 1)) {
      throw new BadEnvelope("revision must be a positive integer");
    }
    const item = await items.get(body.key, body.revision as number | undefined);
    // Raw canonical document: res.json would round big integers via JSON.parse.
    sendRawJson(res, 200, [
      `{"key":${JSON.stringify(body.key)},"revision":${item.revision},"document":`,
      item.documentCanonical,
      `,"metadata":${JSON.stringify(item.metadata)}}`,
    ]);
  }));

  app.post("/api/v1/put", withAuth("put", true, async (req, res, authed) => {
    const body = req.body as { key?: unknown; document_json?: unknown; expected_revision?: unknown; request_id?: unknown };
    if (typeof body?.key !== "string") throw new BadEnvelope("key must be a string");
    if (typeof body?.document_json !== "string") throw new BadEnvelope("document_json must be a string");
    if (!Number.isInteger(body?.expected_revision) || (body?.expected_revision as number) < 0) {
      throw new BadEnvelope("expected_revision must be a nonnegative integer");
    }
    if (typeof body?.request_id !== "string") throw new BadEnvelope("request_id must be a string");
    const out = await items.put(
      {
        key: body.key,
        documentJson: body.document_json,
        expectedRevision: body.expected_revision as number,
        requestId: body.request_id,
      },
      authed.principal,
    );
    res.json({ key: out.key, revision: out.revision, metadata: out.metadata, replayed: out.replayed });
  }));

  app.post("/api/v1/search", withAuth("search", false, async (req, res, authed) => {
    void authed;
    const body = req.body as { query?: unknown; project?: unknown; limit?: unknown; cursor?: unknown };
    if (typeof body?.query !== "string") throw new BadEnvelope("query must be a string");
    if (body.project !== undefined && typeof body.project !== "string") throw new BadEnvelope("project must be a string");
    const page = await search.search({
      query: body.query,
      project: body.project as string | undefined,
      limit: body.limit as number | undefined,
      cursor: body.cursor as string | undefined,
    });
    res.json(page);
  }));

  app.post("/api/v1/history", withAuth("history", false, async (req, res, authed) => {
    void authed;
    const body = req.body as { key?: unknown };
    if (typeof body?.key !== "string") throw new BadEnvelope("key must be a string");
    res.json({ revisions: await items.history(body.key) });
  }));

  app.post("/api/v1/history/get", withAuth("history-get", false, async (req, res, authed) => {
    void authed;
    const body = req.body as { key?: unknown; revision?: unknown };
    if (typeof body?.key !== "string") throw new BadEnvelope("key must be a string");
    if (!Number.isInteger(body?.revision) || (body?.revision as number) < 1) {
      throw new BadEnvelope("revision must be a positive integer");
    }
    const item = await items.get(body.key, body.revision as number);
    sendRawJson(res, 200, [
      `{"key":${JSON.stringify(body.key)},"revision":${item.revision},"document":`,
      item.documentCanonical,
      `,"metadata":${JSON.stringify(item.metadata)}}`,
    ]);
  }));

  app.post("/api/v1/query/analyze", withAuth("analyze", false, async (req, res, authed) => {
    void authed;
    const body = req.body as { query?: unknown };
    if (typeof body?.query !== "string") throw new BadEnvelope("query must be a string");
    res.json(search.analyze(body.query));
  }));

  app.post("/api/v1/complete", withAuth("complete", false, async (req, res, authed) => {
    void authed;
    const body = req.body as { query?: unknown; caret?: unknown };
    if (typeof body?.query !== "string") throw new BadEnvelope("query must be a string");
    const upto = typeof body.caret === "number" ? body.query.slice(0, Math.max(0, body.caret)) : body.query;
    const fragment = upto.split(/\s+/).pop() ?? "";
    res.json({ suggestions: await search.complete(fragment) });
  }));

  app.get("/api/v1/values/:field", withAuth("values", false, async (req, res, authed) => {
    void authed;
    const field = req.params.field;
    if (field !== "type" && field !== "status" && field !== "importance" && field !== "tags") {
      res.status(404).json({ error: { code: "not-found", message: "unknown value set" } });
      return;
    }
    res.json({ values: await deps.repo.observedValues(field as "type" | "status" | "importance" | "tags") });
  }));

  // Body-parser and unexpected errors → typed faults, never stack traces.
  app.use("/api", (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    void _next;
    const withStatus = err as { status?: number; type?: string };
    if (withStatus?.type === "entity.too.large") {
      fault(res, req, "body", randomUUID(), Date.now(), tooLarge(), log, undefined);
      return;
    }
    if (err instanceof SyntaxError) {
      fault(res, req, "body", randomUUID(), Date.now(), new BadEnvelope("malformed JSON body"), log, undefined);
      return;
    }
    fault(res, req, "unknown", randomUUID(), Date.now(), unavailable(), log, undefined);
  });

  mountMcp(app, { getAuth: deps.getAuth, repo, clock: deps.clock, logger: log });

  return app;
}

function resolveAuth(req: Request, auth: ResolvedAuth): Authed {
  const header = req.headers.authorization;
  const cookie = parseSessionCookie(req.headers.cookie, cookieName(auth.config.cookieSecure));
  const hasBearer = typeof header === "string" && header.length > 0;
  if (hasBearer && cookie !== null) {
    throw Object.assign(new Error("ambiguous credentials"), { code: "ambiguous-credentials", status: 401 });
  }
  if (hasBearer) {
    const match = (header as string).match(BEARER_RE);
    const token = match?.[1] ?? "";
    const principal = token ? auth.authenticate(token) : null;
    if (!principal) throw new TokenFault();
    return { principal, method: "bearer", token };
  }
  if (cookie !== null) {
    const principal = auth.authenticate(cookie);
    if (!principal) throw new TokenFault();
    return { principal, method: "cookie", token: cookie };
  }
  throw new TokenFault();
}

function csrfOk(req: Request, auth: ResolvedAuth): boolean {
  const origin = req.headers.origin;
  if (origin !== undefined) return auth.config.allowedOrigins.includes(origin);
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string") return site === "same-origin";
  return false;
}

function csrfFault(): Error {
  return Object.assign(new Error("missing or invalid origin"), { code: "forbidden", status: 403 });
}

function rateFault(): Error {
  return Object.assign(new Error("rate limit exceeded"), { code: "rate-limited", status: 429 });
}

function tooLarge(): Error {
  return Object.assign(new Error("body too large"), { code: "too-large", status: 413 });
}

function unavailable(): Error {
  return Object.assign(new Error("service unavailable"), { code: "unavailable", status: 503 });
}

/** Send a JSON response assembled from trusted fragments plus one raw
 *  canonical document — never re-parsed, never rounded. */
function sendRawJson(res: Response, status: number, chunks: string[]): void {
  res.status(status).set("Content-Type", "application/json").send(chunks.join(""));
}

function fault(
  res: Response,
  _req: Request,
  route: string,
  requestId: string,
  started: number,
  err: unknown,
  log: Logger,
  authed: Authed | undefined,
): void {
  const withCode = err as { code?: string; status?: number; diagnostics?: Array<{ message: string; span: { start: number; end: number } }> };
  const code = withCode?.code ?? "unavailable";
  const status = withCode?.status ?? faultStatus(code);
  // Fixed result category only — never messages, bodies, or inputs.
  log({
    requestId,
    route,
    status,
    result: status === 401 ? "auth-failed" : `fault:${code}`,
    userId: authed?.principal.userId,
    tokenId: authed?.principal.tokenId,
    durationMs: Date.now() - started,
  });
  if (res.headersSent) return;
  const body: { error: { code: string; message: string; spans?: unknown } } = {
    error: { code, message: publicMessage(code) },
  };
  if (code === "invalid-query" && Array.isArray(withCode?.diagnostics)) {
    body.error.spans = withCode.diagnostics.map((d) => ({ message: d.message, start: d.span.start, end: d.span.end }));
  }
  res.status(status).json(body);
}

function finish(
  res: Response,
  _req: Request,
  route: string,
  status: number,
  body: unknown,
  log: Logger,
  authed: Authed | undefined,
): void {
  log({ requestId: randomUUID(), route, status, result: `fault:forbidden`, userId: authed?.principal.userId, tokenId: authed?.principal.tokenId });
  res.status(status).json(body);
}

function faultStatus(code: string): number {
  switch (code) {
    case "invalid-id":
    case "invalid-document":
    case "invalid-query":
    case "invalid-cursor":
    case "bad-envelope":
      return 400;
    case "ambiguous-credentials":
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not-found":
      return 404;
    case "conflict":
    case "replay-conflict":
      return 409;
    case "too-large":
      return 413;
    case "rate-limited":
      return 429;
    default:
      return 503;
  }
}

function publicMessage(code: string): string {
  switch (code) {
    case "invalid-id":
      return "malformed item id";
    case "invalid-document":
      return "invalid document";
    case "invalid-query":
      return "invalid query";
    case "invalid-cursor":
      return "invalid cursor";
    case "bad-envelope":
      return "malformed request";
    case "ambiguous-credentials":
      return "ambiguous credentials";
    case "unauthorized":
      return "invalid credentials";
    case "forbidden":
      return "forbidden";
    case "not-found":
      return "not found";
    case "conflict":
      return "revision conflict";
    case "replay-conflict":
      return "request id reused with a different operation";
    case "too-large":
      return "body too large";
    case "rate-limited":
      return "rate limit exceeded";
    default:
      return "service unavailable";
  }
}

class RateLimiter {
  private readonly buckets = new Map<string, { count: number; reset: number }>();
  check(principal: Principal, config: { windowMs: number; max: number } | undefined): { ok: boolean } {
    if (!config) return { ok: true };
    const key = `${principal.userId}${principal.tokenId}`;
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.reset <= now) {
      this.buckets.set(key, { count: 1, reset: now + config.windowMs });
      return { ok: true };
    }
    bucket.count += 1;
    return { ok: bucket.count <= config.max };
  }
}

export { InvalidId, BadEnvelope, InvalidDocument, InvalidQuery, InvalidCursor, ConflictFault, NotFoundFault, ReplayConflictFault };
