import { prerequisites } from "./prerequisites.mjs";
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
import { chromium } from "playwright-core";
import { Failure } from "../../generated/typescript/haystack/api/Failure.ts";
import { BaboonCodecContext } from "../../generated/typescript/BaboonSharedRuntime.ts";
import { readProxyConfig, validateProxyConfig } from "./proxy-config.mjs";
import { freePort, ownedDatabase, configFor, atomicConfig, startServer, assertPortAvailable } from "./native.mjs";

const conn = process.env.HAYSTACK_TEST_PG;
const chromiumPath = process.env.HAYSTACK_CHROMIUM;
const nginxPath = process.env.HAYSTACK_NGINX;
await prerequisites("restart");
const execFile = promisify(execFileCallback);
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const dir = await mkdtemp(path.join(process.env.HAYSTACK_UI_ARTIFACTS ?? os.tmpdir(), "haystack-restart-"));
const token = randomBytes(32).toString("base64url");
const hashFile = path.join(dir, "token.sha");
await writeFile(hashFile, createHash("sha256").update(token, "ascii").digest("hex"), { mode: 0o600 });

let host;
if (process.env.HAYSTACK_PROXY_CONFIG_FILE !== undefined) host = await readProxyConfig(process.env.HAYSTACK_PROXY_CONFIG_FILE);
// Outside a filtered Nix build only, evaluate the actual Git module below.
const backendPort = host?.backendPort ?? await freePort();
const base = host?.publicUrl ?? `https://127.0.0.1:${await freePort()}`;
const publicUrl = new URL(base);
const proxyPort = Number(publicUrl.port || "443");
await assertPortAvailable(backendPort);
await assertPortAvailable(proxyPort, publicUrl.hostname.replace(/^\[|\]$/gu, ""));
const serverConfig = path.join(dir, "config.json");
const auth = {
  activityProjectId: "agent-activity", cookieSecure: true,
  users: [{ id: "op", type: "human", displayName: "Operator", tokens: [{ id: "browser", hashFile }] }],
  allowedHosts: [publicUrl.hostname.replace(/^\[|\]$/gu, "")], allowedOrigins: [base], insecureHttpOrigins: [], rateLimit: { windowMs: 60000, max: 600 },
};

// No file-mode Nix/Git invocation and no fallback for malformed input.
if (host === undefined) {
const expr = `let
  f = builtins.getFlake ${JSON.stringify(`git+file://${repoRoot}`)};
  cfg = (f.inputs.nixpkgs.lib.nixosSystem {
    system = "x86_64-linux";
    modules = [ f.nixosModules.haystack {
      system.stateVersion = "26.11";
      smind.services.haystack = {
        enable = true; port = ${backendPort}; publicUrl = ${JSON.stringify(base)};
        database = {
          jdbcUrl = "jdbc:postgresql://127.0.0.1:15433/haystack_browser";
          user = "haystack_browser"; passwordFile = "/run/haystack-browser/database-password";
          readinessUnit = null;
        };
        users.op = { type = "human"; tokens.browser.tokenHashFile = "/run/test-token.sha"; };
      };
    } ];
  }).config.services.nginx.virtualHosts."127.0.0.1";
in {
  backendPort = ${backendPort}; publicUrl = ${JSON.stringify(base)};
  inherit (cfg) root;
  locations = builtins.mapAttrs (_: l: {
    inherit (l) proxyPass proxyWebsockets tryFiles extraConfig;
  }) cfg.locations;
}`;
const evaluated = await execFile("nix", ["eval", "--json", "--impure", "--expr", expr], { cwd: repoRoot, timeout: 60000 });
host = await validateProxyConfig(JSON.parse(evaluated.stdout));
}
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
    listen ${publicUrl.hostname}:${proxyPort} ssl;
    ssl_certificate ${dir}/cert.pem;
    ssl_certificate_key ${dir}/key.pem;
    ${host.root === null ? "" : `root ${JSON.stringify(host.root)};`}
    ${locations}
  }
}`);

const database = await ownedDatabase({ connectionString: conn, dir });
await atomicConfig(serverConfig, await configFor({ database: database.runtime,
  port: backendPort, webRoot: path.join(webRoot, "dist"), auth }));
let backend;
let proxy;
let browser;
let context;
const diagnostic = { phase: "startup", responses: [], pageErrors: [], failedRequests: [], allowedHosts: auth.allowedHosts, allowedOrigins: auth.allowedOrigins };
async function startBackend() {
  backend = await startServer(serverConfig, backendPort, path.join(dir, "server.log"));
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
  context = ctx;
  const page = await ctx.newPage();
  page.on("response", async (response) => {
    if (diagnostic.responses.length < 200) {
      const entry = { path: new URL(response.url()).pathname, status: response.status(), contentType: response.headers()["content-type"] };
      diagnostic.responses.push(entry);
      if (entry.path === "/api/v1/login" && entry.status >= 400) try { entry.code = Failure.jsonCodec().decode(BaboonCodecContext.Default, await response.json()).code; } catch { entry.code = "not-current-json-failure"; }
    }
  });
  page.on("pageerror", (error) => { if (diagnostic.pageErrors.length < 20) diagnostic.pageErrors.push(error.message); });
  page.on("requestfailed", (request) => {
    if (diagnostic.failedRequests.length < 20) diagnostic.failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText });
  });
  page.on("request", async (request) => {
    if (new URL(request.url()).pathname === "/api/v1/login") {
      const headers = await request.allHeaders();
      diagnostic.loginTransport = { origin: headers.origin ?? null, fetchSite: headers["sec-fetch-site"] ?? null };
    }
  });
  diagnostic.phase = "login";
  assert.equal((await page.goto(base)).status(), 200, "UI shell must be served by nginx");
  await page.getByLabel("Token").fill(token);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Browse", exact: true }).waitFor();
  await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
  const session = (await ctx.cookies()).find((cookie) => cookie.name === "__Host-haystack");
  assert.ok(session && session.secure && session.httpOnly);
  diagnostic.phase = "backend-stop";
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
    assert.equal(Failure.jsonCodec().decode(BaboonCodecContext.Default, await response.json()).code, "unavailable");
  }
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "Server unreachable" }).waitFor();
  assert.equal(await page.getByLabel("Token").count(), 0);
  assert.ok((await ctx.cookies()).find((cookie) => cookie.name === session.name).value === session.value, "outage must preserve the session token");
  diagnostic.phase = "backend-restart";
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
} catch (error) {
  // Never capture requests, response bodies, credentials or cookie values.
  const evidence = { ...diagnostic, cookies: context ? (await context.cookies()).map(({ name, secure, httpOnly, sameSite }) => ({ name, secure, httpOnly, sameSite })) : [] };
  console.error("HTTPS restart diagnostic:", JSON.stringify(evidence));
  if (process.env.HAYSTACK_UI_ARTIFACTS) await writeFile(path.join(process.env.HAYSTACK_UI_ARTIFACTS, "https-restart-diagnostic.json"), JSON.stringify(evidence, null, 2) + "\n");
  throw error;
} finally {
  if (browser !== undefined) await browser.close();
  await stop(backend);
  await stop(proxy);
  await database.close();
  await rm(dir, { recursive: true, force: true });
}
