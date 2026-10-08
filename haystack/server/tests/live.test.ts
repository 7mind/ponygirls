// Behavioral-Active-Blackbox-GoodCommunication: one channel contract over
// both repositories, using real HTTP/WebSocket transports.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/http/server.js";
import { LiveUpdates } from "../src/http/live.js";
import { InMemoryItemRepository } from "../src/storage/memory.js";
import { PgItemRepository } from "../src/storage/postgres.js";
import { migrate } from "../src/storage/migrate.js";
import { ManualClock } from "../src/application/clock.js";
import type { SearchableRepository } from "../src/storage/search.js";
import type { HaystackConfig, ResolvedAuth } from "../src/auth/config.js";
import { DOC, ALICE, freshRequestId } from "./suites/repository.js";

const CONN = process.env.HAYSTACK_TEST_PG;
const PG_CONN = CONN === undefined ? "" : CONN.replace(/haystack_test/, "haystack_live");

async function start(repo: SearchableRepository) {
  const token = randomBytes(32).toString("base64url");
  let enabled = true;
  let origin = "";
  const config: HaystackConfig = { activityProjectId: "agent-activity", users: [], cookieSecure: false,
    allowedHosts: ["127.0.0.1"], allowedOrigins: [] };
  const getAuth = (): ResolvedAuth => ({ config: { ...config, allowedOrigins: [origin] },
    activityProjectId: config.activityProjectId, authenticate: (presented) => enabled && presented === token ? ALICE : null });
  const updates = new LiveUpdates(getAuth);
  const app = createApp({ repo, getAuth, updates, clock: new ManualClock(), logger: () => {} });
  const server = http.createServer(app);
  updates.attach(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const sockets: WebSocket[] = [];
  const connect = async (headers: Record<string, string>) => {
    const ws = new WebSocket(origin.replace("http:", "ws:") + "/api/v1/live", { headers });
    sockets.push(ws);
    await once(ws, "open");
    return ws;
  };
  const post = (route: string, body: unknown, headers: Record<string, string>) => fetch(origin + route, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  return { origin, token, post, connect, cookie: { Cookie: `haystack-dev=${token}`, Origin: origin },
    revoke: () => { enabled = false; },
    close: async () => { for (const ws of sockets) ws.terminate(); updates.close(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
}

function defineLiveSuite(name: string, makeRepo: () => Promise<{ repo: SearchableRepository; close: () => Promise<void> }>) {
  describe(`live channel contract [${name}]`, () => {
    it("echoes heartbeat nonces and publishes HTTP/MCP commits, excluding replays and conflicts", async () => {
      const storage = await makeRepo();
      const ctx = await start(storage.repo);
      let client: Client | null = null;
      try {
        const ws = await ctx.connect(ctx.cookie);
        const ping = async (nonce: string) => {
          const next = once(ws, "message");
          ws.send(JSON.stringify({ type: "ping", nonce, clientTs: 123 }));
          return JSON.parse(String((await next)[0])) as { type: string; nonce: string; clientTs: number; serverTs: number };
        };
        const pong = await ping("heartbeat-1");
        assert.equal(pong.type, "pong"); assert.equal(pong.nonce, "heartbeat-1");
        assert.equal(pong.clientTs, 123); assert.ok(Number.isFinite(pong.serverTs));
        const body = { key: "p:live", document_json: DOC(), expected_revision: 0, request_id: freshRequestId() };
        const next = once(ws, "message");
        assert.equal((await ctx.post("/api/v1/put", body, { Authorization: `Bearer ${ctx.token}` })).status, 200);
        assert.deepEqual(JSON.parse(String((await next)[0])), { type: "changed", key: "p:live", revision: 1 });
        assert.equal((await ctx.post("/api/v1/put", body, { Authorization: `Bearer ${ctx.token}` })).status, 200);
        assert.equal((await ping("after-replay")).type, "pong");
        assert.equal((await ctx.post("/api/v1/put", { ...body, request_id: freshRequestId() }, { Authorization: `Bearer ${ctx.token}` })).status, 409);
        assert.equal((await ping("after-conflict")).type, "pong");
        client = new Client({ name: "live-contract", version: "1.0.0" });
        await client.connect(new StreamableHTTPClientTransport(new URL(ctx.origin + "/mcp"), {
          requestInit: { headers: { Authorization: `Bearer ${ctx.token}` } },
        }));
        const mcpEvent = once(ws, "message");
        const result = await client.callTool({ name: "put", arguments: { ...body, expected_revision: 1, request_id: freshRequestId() } });
        assert.equal(result.isError, undefined);
        assert.deepEqual(JSON.parse(String((await mcpEvent)[0])), { type: "changed", key: "p:live", revision: 2 });
      } finally { if (client !== null) await client.close(); await ctx.close(); await storage.close(); }
    });

    it("rejects foreign origins and missing cookies; revalidates sessions and closes them on logout", async () => {
      const storage = await makeRepo();
      const ctx = await start(storage.repo);
      try {
        const foreign = new WebSocket(ctx.origin.replace("http:", "ws:") + "/api/v1/live", { headers: { ...ctx.cookie, Origin: "https://foreign.example" } });
        const rejected = await once(foreign, "unexpected-response");
        assert.equal(rejected[1].statusCode, 403); foreign.terminate(); foreign.on("error", () => {});
        const anonymous = await ctx.connect({ Origin: ctx.origin });
        assert.equal((await once(anonymous, "close"))[0], 4401);
        const ws = await ctx.connect(ctx.cookie);
        const logoutClose = once(ws, "close");
        assert.equal((await ctx.post("/api/v1/logout", {}, ctx.cookie)).status, 200);
        assert.equal((await logoutClose)[0], 4401);
        const revoked = await ctx.connect(ctx.cookie);
        const revokedClose = once(revoked, "close");
        ctx.revoke(); revoked.send(JSON.stringify({ type: "ping", nonce: "revoked", clientTs: 1 }));
        assert.equal((await revokedClose)[0], 4401);
      } finally { await ctx.close(); await storage.close(); }
    });

    it("stops invalid frames with a permanent close code", async () => {
      const storage = await makeRepo();
      const ctx = await start(storage.repo);
      try {
        const ws = await ctx.connect(ctx.cookie);
        const closed = once(ws, "close");
        ws.send("invalid json");
        assert.equal((await closed)[0], 1007);
      } finally { await ctx.close(); await storage.close(); }
    });
  });
}

defineLiveSuite("dummy", async () => ({ repo: new InMemoryItemRepository(), close: async () => {} }));
if (CONN === undefined) {
  it("live channel PostgreSQL leg", { skip: "set HAYSTACK_TEST_PG" }, () => {});
} else {
  before(async () => {
    const admin = new Pool({ connectionString: CONN });
    try { await admin.query("DROP DATABASE IF EXISTS haystack_live"); await admin.query("CREATE DATABASE haystack_live"); }
    finally { await admin.end(); }
    const pool = new Pool({ connectionString: PG_CONN });
    try { await migrate(pool, "agent-activity"); } finally { await pool.end(); }
  });
  defineLiveSuite("postgres", async () => {
    const repo = new PgItemRepository(PG_CONN);
    const pool = new Pool({ connectionString: PG_CONN });
    try { await pool.query("TRUNCATE items, item_revisions, item_links, item_search, write_requests"); }
    finally { await pool.end(); }
    return { repo, close: () => repo.close() };
  });
}
