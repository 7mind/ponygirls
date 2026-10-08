// Behavioral-Active-Blackbox-GoodCommunication: preview credentials survive launcher restarts.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { access, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumPath = process.env.HAYSTACK_CHROMIUM;
if (!chromiumPath) {
  console.log("# SKIP preview restart: set HAYSTACK_CHROMIUM");
  process.exit(0);
}
const haystackRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let port;
let stateDir;
for (;;) {
  const socket = http.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const candidate = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const candidateState = path.join(haystackRoot, "..", "debug", "haystack-ui", String(candidate));
  try { await access(candidateState); } catch {
    if (candidate < 65436) { port = candidate; stateDir = candidateState; break; }
  }
}
const base = `http://127.0.0.1:${port}`;
let preview;
let browser;
function startPreview() {
  const child = spawn("bash", [path.join(haystackRoot, "quick-ui.sh"), String(port), "127.0.0.1"], {
    cwd: haystackRoot, stdio: ["ignore", "pipe", "pipe"],
  });
  preview = child;
  return new Promise((resolve, reject) => {
    let output = "";
    const deadline = setTimeout(() => reject(new Error("Preview startup timed out")), 60000);
    child.stdout.on("data", (data) => {
      output += data.toString();
      const token = /Token:\s+([A-Za-z0-9_-]{43})/.exec(output);
      if (token !== null) { clearTimeout(deadline); resolve(token[1]); }
    });
    child.stderr.on("data", (data) => process.stderr.write(data));
    child.once("exit", (code, signal) => {
      clearTimeout(deadline);
      reject(new Error(`Preview exited: ${code ?? signal}`));
    });
  });
}
async function stopPreview() {
  if (preview === undefined || preview.exitCode !== null || preview.signalCode !== null) return;
  const child = preview;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const deadline = setTimeout(() => child.kill("SIGKILL"), 15000);
  child.kill("SIGTERM");
  await exited;
  clearTimeout(deadline);
}
try {
  const firstToken = await startPreview();
  assert.equal((await stat(path.join(stateDir, "token.txt"))).mode & 0o077, 0, "saved preview token must be private");
  browser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox"] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base);
  await page.getByLabel("Token").fill(firstToken);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Browse", exact: true }).waitFor();
  const cookie = (await ctx.cookies(base)).find((value) => value.name === "haystack-dev");
  assert.ok(cookie);
  await stopPreview();
  await assert.rejects(fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(1000) }), TypeError);
  let cachedShell = false;
  try { await page.reload(); cachedShell = true; } catch (error) {
    assert.match(error.message, /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/);
  }
  if (cachedShell) await page.getByRole("alert").filter({ hasText: "Server unreachable" }).waitFor();
  assert.ok((await ctx.cookies(base)).find((value) => value.name === cookie.name).value === cookie.value, "failed refresh must retain the cookie");
  const secondToken = await startPreview();
  const who = await ctx.request.get(`${base}/api/v1/whoami`);
  assert.equal(who.status(), 200, "restarting quick-ui.sh must accept the existing cookie");
  assert.ok(firstToken === secondToken, "preview token must remain stable across launches");
  await page.goto(base);
  await page.getByRole("button", { name: "Browse", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Token").count(), 0);
  console.log("ok - quick-ui.sh restart retains its token and the existing browser session");
} finally {
  if (browser !== undefined) await browser.close();
  await stopPreview();
  await rm(stateDir, { recursive: true, force: true });
}
