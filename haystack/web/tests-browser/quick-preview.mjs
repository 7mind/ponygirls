import { prerequisites } from "./prerequisites.mjs";
// Behavioral-Active-Blackbox-GoodCommunication: preview credentials survive launcher restarts.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { removeStoppedPreviewState, reservePreviewState } from "./preview-state.mjs";

const chromiumPath = process.env.HAYSTACK_CHROMIUM;
await prerequisites("preview");
const haystackRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let port;
let stateDir;
let stateOwnership;
for (;;) {
  const socket = http.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const candidate = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const candidateState = path.resolve(haystackRoot, "..", "debug", "haystack-ui", String(candidate));
  if (candidate >= 65436) continue;
  try {
    stateOwnership = await reservePreviewState(candidateState, path.resolve(haystackRoot, ".."));
    port = candidate; stateDir = candidateState; break;
  } catch (error) { if (error.code !== "EEXIST") throw error; }
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
      const login = /Username:\s+(\S+)/.exec(output);
      const password = /Password:\s+([A-Za-z0-9_-]{43})/.exec(output);
      if (login !== null && password !== null) { clearTimeout(deadline); resolve({ login: login[1], password: password[1] }); }
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
  const deadline = setTimeout(() => child.kill("SIGKILL"), 35000);
  child.kill("SIGTERM");
  await exited;
  clearTimeout(deadline);
}
try {
  const first = await startPreview();
  for (const file of ["token.txt", "password.txt", "password.hash", "state.json", "pg"]) assert.equal((await stat(path.join(stateDir, file))).mode & 0o077, 0, "saved preview state must be private");
  const seedToken = (await readFile(path.join(stateDir, "token.txt"), "utf8")).trimEnd();
  browser = await chromium.launch({ executablePath: chromiumPath, args: ["--no-sandbox"] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(base);
  await page.getByLabel("Username", { exact: true }).fill(first.login);
  await page.getByLabel("Password", { exact: true }).fill(first.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).waitFor();
  const cookie = (await ctx.cookies(base)).find((value) => value.name === "haystack-dev");
  assert.ok(cookie);
  assert.ok(cookie.value !== seedToken && cookie.value !== first.password, "preview cookie must be an independent browser session");
  await page.getByRole("button", { name: "demo:hello", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Retained preview edit");
  await page.getByRole("button", { name: "Save as new revision", exact: true }).click();
  await page.getByText(/Saved as revision 2/).waitFor();
  await stopPreview();
  await assert.rejects(fetch(`${base}/api/v1/health`, { signal: AbortSignal.timeout(1000) }), TypeError);
  let cachedShell = false;
  try { await page.reload(); cachedShell = true; } catch (error) {
    assert.match(error.message, /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/);
  }
  if (cachedShell) await page.getByRole("alert").filter({ hasText: "Server unreachable" }).waitFor();
  assert.ok((await ctx.cookies(base)).find((value) => value.name === cookie.name).value === cookie.value, "failed refresh must retain the cookie");
  const second = await startPreview();
  const who = await ctx.request.get(`${base}/api/v1/whoami`);
  assert.equal(who.status(), 200, "restarting quick-ui.sh must accept the existing cookie");
  assert.ok(first.login === second.login && first.password === second.password, "preview credentials must remain stable across launches");
  await page.goto(base);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).waitFor();
  assert.equal(await page.getByLabel("Password", { exact: true }).count(), 0);
  await page.getByText("Retained preview edit", { exact: true }).waitFor();
  assert.equal((await ctx.request.get(`${base}/api/v1/whoami`, { headers: { Cookie: `haystack-dev=${seedToken}` } })).status(), 401, "API seed must not authenticate as a browser cookie");
  console.log("ok - quick-ui.sh restart retains its private database, password and independent browser session");
} finally {
  if (browser !== undefined) await browser.close();
  await stopPreview();
  await removeStoppedPreviewState(stateDir, stateOwnership);
}
