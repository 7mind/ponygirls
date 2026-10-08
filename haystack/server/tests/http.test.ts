// Good-Communication: authenticated HTTP application against real PG.
// Cookie jar is manual (no browser); restart persistence = new app instance
// + same jar. Skipped without HAYSTACK_TEST_PG (explicit marker).
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { LiveUpdates } from "../src/http/live.js";
import { createApp, type LogEvent } from "../src/http/server.js";
import { migrate } from "../src/storage/migrate.js";
import { PgItemRepository } from "../src/storage/postgres.js";
import { ManualClock } from "../src/application/clock.js";
import type { HaystackConfig } from "../src/auth/config.js";
import { loadAuth, type ResolvedAuth } from "../src/auth/config.js";
import { freshRequestId } from "./suites/repository.js";

const CONN = process.env.HAYSTACK_TEST_PG ?? "";
// Own database: node --test runs files in parallel, so legs must not share
// one (TRUNCATE races). Derived by swapping the dbname of HAYSTACK_TEST_PG.
const HTTP_CONN = CONN.replace(/haystack_test/, "haystack_http");

const DOC = JSON.stringify({
  title: "t",
  description: "d",
  fields: {},
  type: "fact",
  status: "actual",
  importance: "low",
  "human-attention": "cleared",
  links: [],
});

interface Ctx {
  url: string;
  logs: LogEvent[];
  tokens: { alice: string; bot: string };
  secrets: Secrets;
  reload: (users: "both" | "alice-only") => Promise<void>;
  close: () => Promise<void>;
  closeRepo: () => Promise<void>;
}

async function writeSecrets(dir: string, tokens: { alice: string; bot: string }): Promise<{ aliceHash: string; botHash: string }> {
  const digest = (t: string) => createHash("sha256").update(t, "ascii").digest("hex");
  const aliceHash = path.join(dir, "alice.sha");
  const botHash = path.join(dir, "bot.sha");
  await writeFile(aliceHash, digest(tokens.alice) + "\n");
  await writeFile(botHash, digest(tokens.bot) + "\n");
  return { aliceHash, botHash };
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

interface Secrets {
  dir: string;
  tokens: { alice: string; bot: string };
  aliceHash: string;
  botHash: string;
}

async function prepareSecrets(): Promise<Secrets> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-http-"));
  const tokens = { alice: token(), bot: token() };
  const { aliceHash, botHash } = await writeSecrets(dir, tokens);
  return { dir, tokens, aliceHash, botHash };
}

async function startApp(overrides?: Partial<HaystackConfig>, reuse?: Secrets): Promise<Ctx> {
  const secrets = reuse ?? (await prepareSecrets());
  const { tokens, aliceHash, botHash } = secrets;
  const logs: LogEvent[] = [];
  let auth = await loadAuth({
    activityProjectId: "agent-activity",
    users: [
      { id: "alice", type: "human", displayName: "Alice", tokens: [{ id: "browser", hashFile: aliceHash }] },
      { id: "bot", type: "agent", displayName: "Bot", tokens: [{ id: "default", hashFile: botHash }] },
    ],
    cookieSecure: false,
    allowedHosts: ["127.0.0.1", "localhost"],
    allowedOrigins: ["http://allowed.test"],
    ...overrides,
  });
  const repo = new PgItemRepository(HTTP_CONN);
  const updates = new LiveUpdates(() => auth);
  const app = createApp({
    updates,
    getAuth: () => auth,
    repo,
    clock: new ManualClock(),
    logger: (e) => logs.push(e),
  });
  const server = http.createServer(app);
  updates.attach(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    logs,
    tokens,
    secrets,
    reload: async (which: "both" | "alice-only") => {
      const users: HaystackConfig["users"] =
        which === "both"
          ? [
              { id: "alice", type: "human", displayName: "Alice", tokens: [{ id: "browser", hashFile: aliceHash }] },
              { id: "bot", type: "agent", displayName: "Bot", tokens: [{ id: "default", hashFile: botHash }] },
            ]
          : [{ id: "alice", type: "human", displayName: "Alice", tokens: [{ id: "browser", hashFile: aliceHash }] }];
      auth = await loadAuth({ ...(auth.config as HaystackConfig), users });
    },
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
    closeRepo: () => repo.close(),
  };
}

/** Minimal fetch wrapper with a manual cookie jar. */
function client(url: string) {
  let jar = "";
  const headers = (extra?: Record<string, string>): Record<string, string> => ({
    "Content-Type": "application/json",
    ...(jar ? { Cookie: jar } : {}),
    ...extra,
  });
  const store = (res: Response) => {
    const set = res.headers.get("set-cookie");
    if (set) {
      const pair = set.split(";")[0]!;
      jar = /^(?:__Host-haystack|haystack-dev)=$/.test(pair) ? "" : pair;
    }
    return res;
  };
  return {
    clearJar: () => {
      jar = "";
    },
    post: async (route: string, body: unknown, extra?: Record<string, string>) => {
      const res = await fetch(`${url}${route}`, { method: "POST", headers: headers(extra), body: JSON.stringify(body) });
      store(res);
      return res;
    },
    get: async (route: string, extra?: Record<string, string>) => {
      const res = await fetch(`${url}${route}`, { headers: headers(extra) });
      store(res);
      return res;
    },
    rawSetCookie: async (route: string, body: unknown, extra?: Record<string, string>) => {
      const res = await fetch(`${url}${route}`, { method: "POST", headers: headers(extra), body: JSON.stringify(body) });
      return res.headers.get("set-cookie");
    },
  };
}

const bearer = (t: string): Record<string, string> => ({ Authorization: `Bearer ${t}` });
const ORIGIN = { Origin: "http://allowed.test" };

if (!CONN) {
  describe("http application", () => {
    it("SKIPPED: set HAYSTACK_TEST_PG to run the HTTP leg", () => {
      console.log("# SKIP HTTP leg: HAYSTACK_TEST_PG unset");
    });
  });
} else {
  describe("http application", () => {
    let pool: Pool;
    let ctx: Ctx;
    let api: ReturnType<typeof client>;
    before(async () => {
      const admin = new Pool({ connectionString: CONN });
      await admin.query("DROP DATABASE IF EXISTS haystack_http");
      await admin.query("CREATE DATABASE haystack_http");
      await admin.end();
      pool = new Pool({ connectionString: HTTP_CONN });
      await migrate(pool, "agent-activity");
    });
    after(async () => {
      await pool.end();
    });
    beforeEach(async () => {
      await pool.query("TRUNCATE items, item_revisions, item_links, item_search, write_requests");
      if (ctx) {
        await ctx.close().catch(() => undefined);
        await ctx.closeRepo().catch(() => undefined);
      }
      ctx = await startApp();
      api = client(ctx.url);
    });
    after(async () => {
      await ctx?.close().catch(() => undefined);
      await ctx?.closeRepo().catch(() => undefined);
    });

    it("rejects unauthenticated, malformed, and wrong credentials", async () => {
      const headers: Record<string, string>[] = [{}, { Authorization: "Bearer nope" }, { Authorization: "Bearer " + token() }];
      for (const h of headers) {
        const res = await api.post("/api/v1/get", { key: "p:i" }, h);
        assert.equal(res.status, 401);
        assert.equal(res.headers.get("cache-control"), "no-store");
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "unauthorized");
      }
      const res = await api.post("/api/v1/put", { key: "p:i" });
      assert.equal(res.status, 401);
    });

    it("rejects ambiguous simultaneous credentials", async () => {
      const login = await api.post("/api/v1/login", { token: ctx.tokens.alice }, ORIGIN);
      assert.equal(login.status, 200);
      const res = await api.get("/api/v1/whoami", bearer(ctx.tokens.alice));
      assert.equal(res.status, 401);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, "ambiguous-credentials");
    });

    it("logs in with cookie flags, persists across restarts, logs out", async () => {
      const setCookie = await api.rawSetCookie("/api/v1/login", { token: ctx.tokens.alice }, ORIGIN);
      assert.ok(setCookie?.includes("haystack-dev="));
      assert.ok(setCookie?.includes("HttpOnly"));
      assert.ok(setCookie?.includes("Path=/"));
      assert.ok(setCookie?.includes("SameSite=Strict"));
      assert.ok(!setCookie?.includes("Expires="));
      // Restart: the exact cookie VALUE from instance 1 authenticates
      // against instance 2 (stateless cookie, config-bound persistence).
      const pair = setCookie!.split(";")[0]!;
      const secrets = ctx.secrets;
      await ctx.close();
      ctx = await startApp(undefined, secrets);
      const res = await fetch(`${ctx.url}/api/v1/whoami`, { headers: { Cookie: pair, ...ORIGIN } });
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as { userId: string }).userId, "alice");
      // Logout on the new instance clears it.
      const persisted = client(ctx.url);
      assert.equal((await persisted.post("/api/v1/login", { token: ctx.tokens.alice }, ORIGIN)).status, 200);
      assert.equal((await persisted.post("/api/v1/logout", {}, ORIGIN)).status, 200);
      assert.equal((await persisted.get("/api/v1/whoami")).status, 401);
      api = client(ctx.url);
    });

    it("marks Secure cookies only when configured", async () => {
      await ctx.close();
      ctx = await startApp({ cookieSecure: true });
      api = client(ctx.url);
      const setCookie = await api.rawSetCookie("/api/v1/login", { token: ctx.tokens.alice }, ORIGIN);
      assert.ok(setCookie?.includes("__Host-haystack="));
      assert.ok(setCookie?.includes("Secure"));
    });

    it("revokes tokens and users on reload", async () => {
      assert.equal((await api.get("/api/v1/whoami", bearer(ctx.tokens.bot))).status, 200);
      await ctx.reload("alice-only");
      assert.equal((await api.get("/api/v1/whoami", bearer(ctx.tokens.bot))).status, 401);
      assert.equal((await api.get("/api/v1/whoami", bearer(ctx.tokens.alice))).status, 200);
    });

    it("lets every user read and write everything, stamped by token", async () => {
      const botApi = client(ctx.url);
      assert.equal(
        (await botApi.post("/api/v1/put", { key: "shared:doc", document_json: DOC, expected_revision: 0, request_id: freshRequestId() }, bearer(ctx.tokens.bot))).status,
        200,
      );
      const got = (await api.get("/api/v1/whoami", bearer(ctx.tokens.alice))) as Response;
      assert.equal(got.status, 200);
      const read = await api.post("/api/v1/get", { key: "shared:doc" }, bearer(ctx.tokens.alice));
      assert.equal(read.status, 200);
      const body = (await read.json()) as { metadata: { createdBy: string; modifiedBy: string } };
      assert.equal(body.metadata.createdBy, "bot");
      // Agent writes as agent; human edits after.
      const edit = await api.post(
        "/api/v1/put",
        { key: "shared:doc", document_json: DOC, expected_revision: 1, request_id: freshRequestId() },
        bearer(ctx.tokens.alice),
      );
      assert.equal(edit.status, 200);
      const read2 = (await botApi.post("/api/v1/get", { key: "shared:doc" }, bearer(ctx.tokens.bot)).then((r) => r.json())) as {
        metadata: { createdBy: string; modifiedBy: string };
      };
      assert.deepEqual([read2.metadata.createdBy, read2.metadata.modifiedBy], ["bot", "alice"]);
    });

    it("enforces same-origin CSRF on cookie mutations, not bearer calls", async () => {
      await api.post("/api/v1/login", { token: ctx.tokens.alice }, ORIGIN);
      const noOrigin = await api.post("/api/v1/put", { key: "p:a", document_json: DOC, expected_revision: 0, request_id: freshRequestId() });
      assert.equal(noOrigin.status, 403);
      const withOrigin = await api.post(
        "/api/v1/put",
        { key: "p:a", document_json: DOC, expected_revision: 0, request_id: freshRequestId() },
        ORIGIN,
      );
      assert.equal(withOrigin.status, 200);
      // Bearer-only call: clear the jar first, or the server correctly
      // rejects the simultaneous credentials as ambiguous.
      api.clearJar();
      const bearerNoOrigin = await api.post(
        "/api/v1/put",
        { key: "p:b", document_json: DOC, expected_revision: 0, request_id: freshRequestId() },
        bearer(ctx.tokens.alice),
      );
      assert.equal(bearerNoOrigin.status, 200);
      // Login itself requires origin.
      const relogin = await api.post("/api/v1/login", { token: ctx.tokens.alice });
      assert.equal(relogin.status, 403);
    });

    it("rejects disallowed hosts", async () => {
      const status = await new Promise<number>((resolve) => {
        const req = http.request(
          ctx.url + "/api/v1/whoami",
          { method: "GET", headers: { Host: "evil.test", Authorization: `Bearer ${ctx.tokens.alice}` } },
          (res) => resolve(res.statusCode ?? 0),
        );
        req.end();
      });
      assert.equal(status, 403);
    });

    it("reports identity and namespace from whoami", async () => {
      const who = (await (await api.get("/api/v1/whoami", bearer(ctx.tokens.bot))).json()) as Record<string, string>;
      assert.deepEqual(who, { userId: "bot", type: "agent", tokenId: "default", activityProjectId: "agent-activity" });
    });

    it("serves no-store and no-referrer on dynamic responses", async () => {
      const res = await api.post("/api/v1/search", { query: "x" }, bearer(ctx.tokens.alice));
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    });

    it("maps faults to typed HTTP errors", async () => {
      const h = bearer(ctx.tokens.alice);
      assert.equal((await api.post("/api/v1/get", { key: "nope:x" }, h)).status, 404);
      assert.equal((await api.post("/api/v1/put", { key: "bad", document_json: DOC, expected_revision: 0, request_id: freshRequestId() }, h)).status, 400);
      const badQuery = await api.post("/api/v1/search", { query: "bogus:1" }, h);
      assert.equal(badQuery.status, 400);
      const spans = (await badQuery.json()) as { error: { code: string; spans: unknown[] } };
      assert.equal(spans.error.code, "invalid-query");
      assert.ok(spans.error.spans.length > 0);
      assert.equal((await api.post("/api/v1/search", { query: "x", cursor: "nope" }, h)).status, 400);
      await api.post("/api/v1/put", { key: "p:c", document_json: DOC, expected_revision: 0, request_id: freshRequestId() }, h);
      assert.equal(
        (await api.post("/api/v1/put", { key: "p:c", document_json: DOC, expected_revision: 0, request_id: freshRequestId() }, h)).status,
        409,
      );
    });

    it("round-trips history, analyze, complete, and values", async () => {
      const h = bearer(ctx.tokens.alice);
      await api.post("/api/v1/put", { key: "p:h", document_json: DOC, expected_revision: 0, request_id: freshRequestId() }, h);
      const hist = (await (await api.post("/api/v1/history", { key: "p:h" }, h)).json()) as { revisions: Array<{ revision: number }> };
      assert.deepEqual(hist.revisions.map((r) => r.revision), [1]);
      const snap = (await (await api.post("/api/v1/history/get", { key: "p:h", revision: 1 }, h)).json()) as { revision: number };
      assert.equal(snap.revision, 1);
      const analysis = (await (await api.post("/api/v1/query/analyze", { query: "bogus:1" }, h)).json()) as {
        diagnostics: unknown[];
      };
      assert.ok(analysis.diagnostics.length > 0);
      const done = (await (await api.post("/api/v1/complete", { query: "typ" }, h)).json()) as { suggestions: string[] };
      assert.ok(done.suggestions.includes("type:"));
      const values = (await (await api.get("/api/v1/values/type", h)).json()) as { values: string[] };
      assert.ok(values.values.includes("fact"));
      assert.equal(await (await api.get("/api/v1/values/bogus", h)).status, 404);
    });

    it("keeps canaries out of logs and respects the field allowlist", async () => {
      const canaryTitle = `canary-title-${randomBytes(6).toString("hex")}`;
      const canaryQuery = `canary-query-${randomBytes(6).toString("hex")}`;
      const h = bearer(ctx.tokens.alice);
      const docWithCanary = JSON.stringify({ ...JSON.parse(DOC), title: canaryTitle });
      await api.post("/api/v1/login", { token: ctx.tokens.alice }, ORIGIN);
      api.clearJar(); // subsequent calls are bearer-only (mixed creds would 401)
      await api.post("/api/v1/put", { key: "p:canary", document_json: docWithCanary, expected_revision: 0, request_id: freshRequestId() }, h);
      await api.post("/api/v1/search", { query: canaryQuery }, h);
      await api.post("/api/v1/get", { key: "p:canary" }, h);
      await api.post("/api/v1/search", { query: "bogus:1" }, h); // fault path with query text
      const serialized = ctx.logs.map((e) => JSON.stringify(e)).join("\n");
      assert.ok(!serialized.includes(canaryTitle), "title canary leaked");
      assert.ok(!serialized.includes(canaryQuery), "query canary leaked");
      assert.ok(!serialized.includes(ctx.tokens.alice), "token canary leaked");
      assert.ok(!serialized.includes("p:canary"), "key canary leaked");
      const allowed = new Set(["requestId", "route", "status", "result", "userId", "tokenId", "revision", "durationMs"]);
      for (const event of ctx.logs) {
        for (const key of Object.keys(event)) assert.ok(allowed.has(key), `unapproved log field: ${key}`);
      }
      assert.ok(ctx.logs.some((e) => e.route === "put" && e.result === "ok" && e.userId === "alice"));
    });

    it("rate-limits heavy principals", async () => {
      await ctx.close();
      ctx = await startApp({ rateLimit: { windowMs: 60_000, max: 2 } });
      api = client(ctx.url);
      const h = bearer(ctx.tokens.alice);
      assert.equal((await api.get("/api/v1/whoami", h)).status, 200);
      assert.equal((await api.get("/api/v1/whoami", h)).status, 200);
      const third = await api.get("/api/v1/whoami", h);
      assert.equal(third.status, 429);
      assert.equal(((await third.json()) as { error: { code: string } }).error.code, "rate-limited");
    });

    it("renews the cookie on authenticated activity", async () => {
      await api.post("/api/v1/login", { token: ctx.tokens.alice }, ORIGIN);
      const res = await api.get("/api/v1/whoami", ORIGIN);
      assert.equal(res.status, 200);
      assert.ok(res.headers.get("set-cookie")?.includes("haystack-dev="));
    });

    it("proxies without caching or credential leakage", async () => {
      // Test-only forward proxy: forwards, records an allowlisted access line.
      const proxyLog: string[] = [];
      const target = new URL(ctx.url);
      const proxy = http.createServer((creq, cres) => {
        const chunks: Buffer[] = [];
        creq.on("data", (c) => chunks.push(c));
        creq.on("end", () => {
          const started = Date.now();
          const out = http.request(
            {
              host: "127.0.0.1",
              port: Number(target.port),
              path: creq.url,
              method: creq.method,
              headers: { ...creq.headers, host: `127.0.0.1:${target.port}` },
            },
            (pres) => {
              // Allowlist only: route label, status, timing. No URIs, no
              // headers, no bodies — mirroring the required proxy policy.
              const label = (creq.url ?? "").startsWith("/api/") ? "api" : "other";
              proxyLog.push(`${label} ${pres.statusCode} ${Date.now() - started}ms`);
              cres.writeHead(pres.statusCode ?? 502, pres.headers);
              pres.pipe(cres);
            },
          );
          out.end(Buffer.concat(chunks));
        });
      });
      await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
      const proxyPort = (proxy.address() as AddressInfo).port;
      try {
        const canary = `proxy-canary-${randomBytes(6).toString("hex")}`;
        const via = client(`http://127.0.0.1:${proxyPort}`);
        const r1 = await via.get("/api/v1/whoami", bearer(ctx.tokens.alice));
        assert.equal(r1.status, 200);
        assert.equal(r1.headers.get("cache-control"), "no-store");
        // Distinct identities through the same proxy: no cached auth.
        const r2 = await via.get("/api/v1/whoami", bearer(ctx.tokens.bot));
        assert.deepEqual(((await r2.json()) as { userId: string }).userId, "bot");
        await via.post("/api/v1/search", { query: canary }, bearer(ctx.tokens.alice));
        const logged = proxyLog.join("\n");
        assert.ok(!logged.includes(canary));
        assert.ok(!logged.includes(ctx.tokens.alice));
        assert.ok(!logged.includes("Bearer"));
      } finally {
        await new Promise((resolve) => proxy.close(resolve));
      }
    });
  });
}
