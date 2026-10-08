// Behavioral-Active-Blackbox-GoodCommunication: real nginx, Chromium, and backend restart.
import assert from "node:assert/strict";
import { spawn, execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { chromium } from "playwright-core";

const conn = process.env.HAYSTACK_TEST_PG;
const chromiumPath = process.env.HAYSTACK_CHROMIUM;
const nginxPath = process.env.HAYSTACK_NGINX;
if (!conn || !chromiumPath || !nginxPath) {
  console.log("# SKIP backend restart: set HAYSTACK_TEST_PG, HAYSTACK_CHROMIUM, HAYSTACK_NGINX");
  process.exit(0);
}
const execFile = promisify(execFileCallback);
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const dir = await mkdtemp(path.join(process.env.HAYSTACK_UI_ARTIFACTS ?? os.tmpdir(), "haystack-restart-"));
const token = randomBytes(32).toString("base64url");
const hashFile = path.join(dir, "token.sha");
await writeFile(hashFile, createHash("sha256").update(token, "ascii").digest("hex"), { mode: 0o600 });

async function freePort() {
  const socket = http.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
const backendPort = await freePort();
const proxyPort = await freePort();
const base = `https://127.0.0.1:${proxyPort}`;
const authFile = path.join(dir, "auth.json");
await writeFile(authFile, JSON.stringify({
  activityProjectId: "agent-activity", cookieSecure: true,
  users: [{ id: "op", type: "human", displayName: "Operator", tokens: [{ id: "browser", hashFile }] }],
  allowedHosts: ["127.0.0.1"], allowedOrigins: [base],
}), { mode: 0o600 });

// Use the module's location policy, with the freshly built UI as its static root.
const expr = `let
  f = builtins.getFlake ${JSON.stringify(`git+file://${repoRoot}`)};
  cfg = (f.inputs.nixpkgs.lib.nixosSystem {
    system = "x86_64-linux";
    modules = [ f.nixosModules.haystack {
      system.stateVersion = "26.11";
      smind.services.haystack = {
        enable = true; port = ${backendPort}; publicUrl = ${JSON.stringify(base)};
        users.op = { type = "human"; tokens.browser.tokenHashFile = "/run/test-token.sha"; };
      };
    } ];
  }).config.services.nginx.virtualHosts."127.0.0.1";
in {
  inherit (cfg) root;
  locations = builtins.mapAttrs (_: l: {
    inherit (l) proxyPass proxyWebsockets tryFiles extraConfig;
  }) cfg.locations;
}`;
const evaluated = await execFile("nix", ["eval", "--json", "--impure", "--expr", expr], { cwd: repoRoot, timeout: 60000 });
const host = JSON.parse(evaluated.stdout);
const locations = Object.entries(host.locations).map(([name, location]) => `location ${name} {
  ${location.proxyPass === null ? "" : `proxy_pass ${location.proxyPass}; proxy_set_header Host $http_host;`}
  ${location.proxyWebsockets ? "proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection $connection_upgrade;" : ""}
  ${location.tryFiles === null ? "" : `try_files ${location.tryFiles};`}
  ${location.extraConfig}
}`).join("\n");
await execFile("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
  "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")]);
const configFile = path.join(dir, "nginx.conf");
await writeFile(configFile, `daemon off;
master_process off;
pid ${dir}/nginx.pid;
error_log ${dir}/nginx-error.log;
events {}
http {
  access_log off;
  include ${path.resolve(nginxPath, "..", "..", "conf", "mime.types")};
  map $http_upgrade $connection_upgrade { default upgrade; '' close; }
  server {
    listen 127.0.0.1:${proxyPort} ssl;
    ssl_certificate ${dir}/cert.pem;
    ssl_certificate_key ${dir}/key.pem;
    ${host.root === null ? "" : `root ${path.join(webRoot, "dist")};`}
    ${locations}
  }
}`);

const admin = new pg.Client(conn);
await admin.connect();
await admin.query("DROP DATABASE IF EXISTS haystack_restart");
await admin.query("CREATE DATABASE haystack_restart");
await admin.end();
const backendConn = conn.replace(/haystack_test/, "haystack_restart");
let backend;
let proxy;
let browser;
async function startBackend() {
  const child = spawn(process.execPath, [path.join(webRoot, "..", "server", "dist", "index.js")], {
    env: { ...process.env, HAYSTACK_AUTH_JSON: authFile, HAYSTACK_DATABASE_URL: backendConn,
      HAYSTACK_LISTEN: "127.0.0.1", HAYSTACK_PORT: String(backendPort), HAYSTACK_STATIC_DIR: path.join(webRoot, "dist") },
    stdio: ["ignore", "ignore", "inherit"],
  });
  backend = child;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Backend exited during startup: ${child.exitCode}`);
    try {
      if ((await fetch(`http://127.0.0.1:${backendPort}/api/v1/health`, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Backend startup timed out");
}
async function stop(child) {
  if (child === undefined || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
  child.kill("SIGTERM");
  await exited;
  clearTimeout(deadline);
}
try {
  await startBackend();
  await execFile(nginxPath, ["-t", "-e", path.join(dir, "nginx-error.log"), "-p", `${dir}/`, "-c", configFile]);
  proxy = spawn(nginxPath, ["-e", path.join(dir, "nginx-error.log"), "-p", `${dir}/`, "-c", configFile], { stdio: ["ignore", "ignore", "inherit"] });
  browser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  assert.equal((await page.goto(base)).status(), 200, "UI shell must be served by nginx");
  await page.getByLabel("Token").fill(token);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Browse", exact: true }).waitFor();
  await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
  const session = (await ctx.cookies()).find((cookie) => cookie.name === "__Host-haystack");
  assert.ok(session && session.secure && session.httpOnly);
  await stop(backend);
  assert.equal(backend.exitCode, 0, "backend shutdown must be clean");
  const shell = await ctx.request.get(base);
  const who = await ctx.request.get(`${base}/api/v1/whoami`);
  console.log(`Backend stopped: shell ${shell.status()}, API ${who.status()}`);
  assert.equal(shell.status(), 200, "UI shell must survive a stopped backend");
  for (const [method, endpoint] of [["get", "/api/v1/whoami"], ["post", "/api/v1/search"], ["post", "/mcp"], ["post", "/mcp/"]]) {
    const response = await ctx.request[method](`${base}${endpoint}`, { data: {} });
    assert.equal(response.status(), 503, `${endpoint} must report service unavailable`);
    assert.equal(response.headers()["cache-control"], "no-store");
    assert.equal(response.headers()["set-cookie"], undefined);
    assert.equal((await response.json()).error.code, "unavailable");
  }
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "Server unreachable" }).waitFor();
  assert.equal(await page.getByLabel("Token").count(), 0);
  assert.ok((await ctx.cookies()).find((cookie) => cookie.name === session.name).value === session.value, "outage must preserve the session token");
  await startBackend();
  await page.reload();
  await page.getByRole("button", { name: "Browse", exact: true }).waitFor();
  await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
  assert.ok((await ctx.cookies()).find((cookie) => cookie.name === session.name).value === session.value, "restart must preserve the session token");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  console.log("ok - HTTPS session survives backend stop, refresh, restart, refresh; logout still expires it");
} finally {
  if (browser !== undefined) await browser.close();
  await stop(backend);
  await stop(proxy);
  await rm(dir, { recursive: true, force: true });
}
