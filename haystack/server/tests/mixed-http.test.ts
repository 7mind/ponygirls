// Real HTTP + websocket regression: one process, secure and explicitly opted-in
// insecure authorities. Transport is the backend leg behind the reverse proxy.
import { it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { loadAuth, type HaystackConfig } from "../src/auth/config.js";
import { createApp } from "../src/http/server.js";
import { LiveUpdates } from "../src/http/live.js";
import { InMemoryItemRepository } from "../src/storage/memory.js";
import { ManualClock } from "../src/application/clock.js";

const plain = "http://nb.test:8085";
const secure = "https://ts.test:8445";
const plainHost = new URL(plain).host;
const secureHost = new URL(secure).host;

async function start(insecureHttpOrigins: readonly string[] | null = [plain]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-mixed-"));
  const token = randomBytes(32).toString("base64url");
  const hashFile = path.join(dir, "token.sha");
  await writeFile(hashFile, createHash("sha256").update(token).digest("hex"));
  const config: HaystackConfig & { insecureHttpOrigins?: readonly string[] } = {
    activityProjectId: "activity", cookieSecure: true,
    allowedHosts: ["nb.test", "ts.test"], allowedOrigins: [plain, secure],
    users: [{ id: "alice", type: "human", displayName: "Alice", tokens: [{ id: "browser", hashFile }] }],
    ...(insecureHttpOrigins === null ? {} : { insecureHttpOrigins }),
  };
  const auth = await loadAuth(config);
  const updates = new LiveUpdates(() => auth);
  const server = http.createServer(createApp({ getAuth: () => auth, updates,
    repo: new InMemoryItemRepository(), clock: new ManualClock(), logger: () => {} }));
  updates.attach(server);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const sockets: WebSocket[] = [];
  const request = (route: string, headers: Record<string, string>, body?: unknown) => new Promise<{
    status: number; cookie: string; body: string;
  }>((resolve, reject) => {
    const req = http.request(base + route, { method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers } }, (res) => {
      let data = ""; res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, cookie: res.headers["set-cookie"]?.[0] ?? "", body: data }));
    });
    req.on("error", reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const connect = async (headers: Record<string, string>) => {
    const ws = new WebSocket(base.replace("http:", "ws:") + "/api/v1/live", { headers });
    sockets.push(ws); await once(ws, "open"); return ws;
  };
  return { config, token, request, connect, close: async () => {
    sockets.forEach((ws) => ws.terminate()); updates.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  } };
}

it("mixed origins: login, whoami/renewal and logout choose only the authority's cookie", async () => {
  const ctx = await start();
  try {
    for (const [Host, Origin, name, isSecure] of [
      [plainHost, plain, "haystack-dev", false], [secureHost, secure, "__Host-haystack", true],
    ] as const) {
      const login = await ctx.request("/api/v1/login", { Host, Origin, "X-Forwarded-Proto": isSecure ? "http" : "https" }, { token: ctx.token });
      assert.equal(login.status, 200);
      assert.ok(login.cookie.startsWith(`${name}=`), login.cookie);
      assert.equal(login.cookie.includes("; Secure"), isSecure);
      assert.ok(login.cookie.includes("HttpOnly; SameSite=Strict"));
      const Cookie = login.cookie.split(";")[0]!;
      const me = await ctx.request("/api/v1/whoami", { Host, Cookie });
      assert.equal(me.status, 200); assert.equal(me.cookie, login.cookie);
      const wrong = `${isSecure ? "haystack-dev" : "__Host-haystack"}=${ctx.token}`;
      assert.equal((await ctx.request("/api/v1/whoami", { Host, Cookie: wrong })).status, 401);
      assert.equal((await ctx.request("/api/v1/logout", { Host, Cookie }, {})).status, 403);
      const logout = await ctx.request("/api/v1/logout", { Host, Origin, Cookie }, {});
      assert.equal(logout.status, 200); assert.ok(logout.cookie.startsWith(`${name}=`));
      assert.ok(logout.cookie.includes("Max-Age=0")); assert.equal(logout.cookie.includes("; Secure"), isSecure);
    }
  } finally { await ctx.close(); }
});

it("does not downgrade other ports, absent/empty opt-in, or trust forwarded headers", async () => {
  for (const origins of [null, [], [plain]]) {
    const ctx = await start(origins);
    try {
      const Host = origins?.length ? "nb.test:8086" : plainHost;
      const login = await ctx.request("/api/v1/login", { Host, Origin: plain,
        "X-Forwarded-Proto": "http", "X-Forwarded-Host": plainHost }, { token: ctx.token });
      // Mismatched Origin must not downgrade (it may be rejected outright).
      assert.ok(login.status === 403 || login.cookie.startsWith("__Host-haystack="));
      assert.equal((await ctx.request("/api/v1/whoami", { Host, Cookie: `haystack-dev=${ctx.token}` })).status, 401);
    } finally { await ctx.close(); }
  }
});

it("rejects misleading allowed Origin/Host pairs on opted-in HTTP, including cookie reads", async () => {
  const ctx = await start();
  try {
    for (const [Host, Origin] of [[plainHost, secure], [secureHost, plain]]) {
      assert.equal((await ctx.request("/api/v1/login", { Host: Host!, Origin: Origin! }, { token: ctx.token })).status, 403);
      assert.equal((await ctx.request("/api/v1/whoami", { Host: Host!, Origin: Origin!, Cookie: `haystack-dev=${ctx.token}; __Host-haystack=${ctx.token}` })).status, 403);
    }
  } finally { await ctx.close(); }
});

it("validates opt-in HTTP origins fail closed", async () => {
  const ctx = await start();
  try {
    for (const origin of ["https://nb.test:8085", plain + "/", plain + "/path", plain + "?q=1", "http://u:p@nb.test:8085", "null", "http://other.test:8085"]) {
      await assert.rejects(loadAuth({ ...ctx.config, insecureHttpOrigins: [origin] } as typeof ctx.config), /insecureHttpOrigins/);
    }
    await assert.rejects(loadAuth({ ...ctx.config, insecureHttpOrigins: "not-an-array" } as unknown as HaystackConfig), /insecureHttpOrigins/);
    await assert.rejects(loadAuth({ ...ctx.config, allowedHosts: ["ts.test"] }), /insecureHttpOrigins/);
    await assert.rejects(loadAuth({ ...ctx.config, allowedOrigins: [secure] }), /insecureHttpOrigins/);
    await assert.rejects(loadAuth({ ...ctx.config, allowedOrigins: [plain, secure, "https://nb.test:8085"] }), /insecureHttpOrigins/);
    await assert.rejects(loadAuth({ ...ctx.config, allowedOrigins: ["http://nb.test:443", "https://nb.test"],
      insecureHttpOrigins: ["http://nb.test:443"] }), /insecureHttpOrigins/);
    await loadAuth({ ...ctx.config, allowedOrigins: [plain, "https://nb.test:8445"], insecureHttpOrigins: [plain] });
  } finally { await ctx.close(); }
});

it("HTTP live cookies authenticate and logout/login endSession selects the request cookie", async () => {
  const ctx = await start();
  try {
    const headers = { Host: plainHost, Origin: plain, Cookie: `haystack-dev=${ctx.token}; __Host-haystack=not-the-session` };
    const ws = await ctx.connect(headers);
    const message = once(ws, "message");
    ws.send(JSON.stringify({ type: "ping", nonce: "http-live", clientTs: 123 }));
    assert.equal(JSON.parse(String((await message)[0])).nonce, "http-live");
    const closed = once(ws, "close");
    assert.equal((await ctx.request("/api/v1/logout", headers, {})).status, 200);
    assert.equal((await closed)[0], 4401);
    const next = await ctx.connect(headers);
    const replaced = once(next, "close");
    assert.equal((await ctx.request("/api/v1/login", headers, { token: ctx.token })).status, 200);
    assert.equal((await replaced)[0], 4401);
    const tls = await ctx.connect({ Host: secureHost, Origin: secure, Cookie: `__Host-haystack=${ctx.token}` });
    const pong = once(tls, "message"); tls.send(JSON.stringify({ type: "ping", nonce: "tls-live", clientTs: 123 }));
    assert.equal(JSON.parse(String((await pong)[0])).nonce, "tls-live");
    const tlsClosed = once(tls, "close");
    assert.equal((await ctx.request("/api/v1/logout", { Host: secureHost, Origin: secure,
      Cookie: `__Host-haystack=${ctx.token}; haystack-dev=not-the-session` }, {})).status, 200);
    assert.equal((await tlsClosed)[0], 4401);
  } finally { await ctx.close(); }
});

it("live rejects cross-authority Origins and wrong cookie names", { timeout: 5000 }, async () => {
  const ctx = await start();
  try {
    await assert.rejects(ctx.connect({ Host: plainHost, Origin: secure, Cookie: `haystack-dev=${ctx.token}` }), /403/);
    for (const headers of [
      { Host: plainHost, Origin: plain, Cookie: `__Host-haystack=${ctx.token}` },
      { Host: secureHost, Origin: secure, Cookie: `haystack-dev=${ctx.token}` },
    ]) {
      const ws = await ctx.connect(headers);
      assert.equal((await once(ws, "close"))[0], 4401);
    }
  } finally { await ctx.close(); }
});

it("MCP rejects either cookie name even alongside bearer", async () => {
  const ctx = await start();
  try {
    for (const Host of [plainHost, secureHost]) {
      for (const name of ["haystack-dev", "__Host-haystack"]) {
        assert.equal((await ctx.request("/mcp", { Host, Cookie: `${name}=${ctx.token}`,
          Authorization: `Bearer ${ctx.token}` }, {})).status, 401);
      }
    }
  } finally { await ctx.close(); }
});
