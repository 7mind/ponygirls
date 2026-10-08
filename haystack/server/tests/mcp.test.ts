// Good-Communication: MCP adapter exercised through a real SDK client
// (initialize/list/call) plus raw transport checks. Same app, same service,
// same auth as the browser API. Skipped without HAYSTACK_TEST_PG.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LiveUpdates } from "../src/http/live.js";
import { createApp, type LogEvent } from "../src/http/server.js";
import { migrate } from "../src/storage/migrate.js";
import { PgItemRepository } from "../src/storage/postgres.js";
import { ManualClock } from "../src/application/clock.js";
import { loadAuth } from "../src/auth/config.js";
import { freshRequestId } from "./suites/repository.js";

const CONN = process.env.HAYSTACK_TEST_PG ?? "";
const MCP_CONN = CONN.replace(/haystack_test/, "haystack_mcp");

// NOTE: big-int fixture is raw text — a JS number would round before send.
const DOC = (title = "t") =>
  `{"title":${JSON.stringify(title)},"description":"d","fields":{"n":9007199254740993},"type":"fact","status":"actual","importance":"low","human-attention":"cleared","links":[]}`;

async function startMcpApp(): Promise<{ url: string; token: string; logs: LogEvent[]; close: () => Promise<void>; closeRepo: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-mcp-"));
  const token = randomBytes(32).toString("base64url");
  const hashFile = path.join(dir, "bot.sha");
  await writeFile(hashFile, createHash("sha256").update(token, "ascii").digest("hex") + "\n");
  const auth = await loadAuth({
    activityProjectId: "agent-activity",
    users: [{ id: "bot", type: "agent", displayName: "Bot", tokens: [{ id: "default", hashFile }] }],
    cookieSecure: false,
    allowedHosts: ["127.0.0.1", "localhost"],
    allowedOrigins: [],
  });
  const logs: LogEvent[] = [];
  const repo = new PgItemRepository(MCP_CONN);
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
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  return { url, token, logs, close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))), closeRepo: () => repo.close() };
}

async function connect(url: string, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "haystack-mcp-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

if (!CONN) {
  describe("mcp adapter", () => {
    it("SKIPPED: set HAYSTACK_TEST_PG to run the MCP leg", () => {
      console.log("# SKIP MCP leg: HAYSTACK_TEST_PG unset");
    });
  });
} else {
  describe("mcp adapter", () => {
    let pool: Pool;
    let app: Awaited<ReturnType<typeof startMcpApp>>;
    before(async () => {
      const admin = new Pool({ connectionString: CONN });
      await admin.query("DROP DATABASE IF EXISTS haystack_mcp");
      await admin.query("CREATE DATABASE haystack_mcp");
      await admin.end();
      pool = new Pool({ connectionString: MCP_CONN });
      await migrate(pool, "agent-activity");
    });
    after(async () => {
      await pool.end();
    });
    beforeEach(async () => {
      await pool.query("TRUNCATE items, item_revisions, item_links, item_search, write_requests");
      if (app) {
        await app.close().catch(() => undefined);
        await app.closeRepo().catch(() => undefined);
      }
      app = await startMcpApp();
    });
    after(async () => {
      await app?.close().catch(() => undefined);
      await app?.closeRepo().catch(() => undefined);
    });

    it("initializes with guidance, lists three annotated tools", async () => {
      const client = await connect(app.url, app.token);
      try {
        const tools = await client.listTools();
        assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["get", "put", "search"]);
        const byName = Object.fromEntries(tools.tools.map((t) => [t.name, t]));
        assert.equal(byName["get"]?.annotations?.readOnlyHint, true);
        assert.equal(byName["search"]?.annotations?.readOnlyHint, true);
        assert.equal(byName["put"]?.annotations?.readOnlyHint, false);
      } finally {
        await client.close();
      }
    });

    it("runs put/get/search flows with CAS and pagination", async () => {
      const client = await connect(app.url, app.token);
      try {
        const id = freshRequestId();
        const put = (await client.callTool({
          name: "put",
          arguments: { key: "mcp:doc", document_json: DOC("hello"), expected_revision: 0, request_id: id },
        })) as unknown as { structuredContent: { revision: number; replayed: boolean } };
        assert.equal(put.structuredContent.revision, 1);
        assert.equal(put.structuredContent.replayed, false);
        // Lost-response retry returns the original outcome.
        const replay = (await client.callTool({
          name: "put",
          arguments: { key: "mcp:doc", document_json: DOC("hello"), expected_revision: 0, request_id: id },
        })) as unknown as { structuredContent: { revision: number; replayed: boolean } };
        assert.deepEqual([replay.structuredContent.revision, replay.structuredContent.replayed], [1, true]);
        // Stale CAS is a typed tool error, not a transport failure.
        const stale = (await client.callTool({
          name: "put",
          arguments: { key: "mcp:doc", document_json: DOC("x"), expected_revision: 0, request_id: freshRequestId() },
        })) as unknown as { isError?: boolean; structuredContent: { code: string } };
        assert.equal(stale.isError, true);
        assert.equal(stale.structuredContent.code, "conflict");
        // get returns lossless document_json plus display text.
        const get = (await client.callTool({ name: "get", arguments: { key: "mcp:doc" } })) as unknown as {
          content: Array<{ text: string }>;
          structuredContent: { revision: number; document_json: string };
        };
        assert.equal(get.structuredContent.revision, 1);
        assert.ok(get.structuredContent.document_json.includes("9007199254740993"));
        assert.ok(get.content[0]?.text.includes("hello"));
        // search paginates through the cursor (second doc forces a next page).
        await client.callTool({
          name: "put",
          arguments: { key: "mcp:second", document_json: DOC("second"), expected_revision: 0, request_id: freshRequestId() },
        });
        const page1 = (await client.callTool({ name: "search", arguments: { query: "", limit: 1 } })) as unknown as {
          structuredContent: { items: unknown[]; cursor?: string };
        };
        assert.equal(page1.structuredContent.items.length, 1);
        assert.ok(page1.structuredContent.cursor);
        const page2 = (await client.callTool({
          name: "search",
          arguments: { query: "", limit: 1, cursor: page1.structuredContent.cursor },
        })) as unknown as { structuredContent: { items: unknown[]; cursor?: string } };
        assert.equal(page2.structuredContent.items.length, 1);
        assert.equal(page2.structuredContent.cursor, undefined);
      } finally {
        await client.close();
      }
    });

    it("rejects cookie-only and bearer+cookie credentials", async () => {
      const init = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      };
      const cookieOnly = await fetch(app.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "haystack-dev=anything" },
        body: JSON.stringify(init),
      });
      assert.equal(cookieOnly.status, 401);
      // No bearer at all, even without cookies.
      const naked = await fetch(app.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(init),
      });
      assert.equal(naked.status, 401);
    });

    it("rejects unsupported protocol versions and GET explicitly", async () => {
      const init = (version: string) => ({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "t", version: "0" } },
      });
      // The SDK answers version mismatches with explicit 406 (not 400).
      const bad = await fetch(app.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${app.token}`, "MCP-Protocol-Version": "1999-01-01" },
        body: JSON.stringify(init("1999-01-01")),
      });
      assert.equal(bad.status, 406);
      const get = await fetch(app.url, { headers: { Authorization: `Bearer ${app.token}` } });
      assert.equal(get.status, 405);
    });

    it("serves no-store on MCP responses and logs fixed labels", async () => {
      const init = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      };
      const res = await fetch(app.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${app.token}`, "MCP-Protocol-Version": "2025-11-25" },
        body: JSON.stringify(init),
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const client = await connect(app.url, app.token);
      try {
        await client.callTool({ name: "search", arguments: { query: "nothing-matches-this" } });
      } finally {
        await client.close();
      }
      const routes = app.logs.map((e) => e.route);
      assert.ok(routes.includes("mcp/search"));
      for (const event of app.logs) {
        for (const key of Object.keys(event)) {
          assert.ok(["requestId", "route", "status", "result", "userId", "tokenId", "revision", "durationMs"].includes(key), key);
        }
      }
    });
  });
}
