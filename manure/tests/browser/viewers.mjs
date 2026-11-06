// Specified viewer feature contracts. Real renderers, real HTTP, no CDN access.
// Credentials are supplied over stdin and redacted from every failure report.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
if (input.artifacts) await fs.mkdir(input.artifacts, { recursive: true });
const require = createRequire(path.join(input.core, "package.json"));
const { chromium } = require("playwright-core");
const browser = await chromium.launch({ executablePath: input.browser, args: [
  "--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server",
  `--host-resolver-rules=${input.resolver}`,
] });
const results = [];
const secrets = new Set([input.token, input.records.external.external_password]);
const clean = (error) => {
  let text = String(error.stack || error).split("\n").slice(0, 14).join("\n");
  for (const secret of secrets) if (secret) text = text.split(secret).join("[REDACTED]");
  return text;
};
const record = (key) => input.records[key];
const root = (key) => record(key).content_url.replace(/\/$/, "");
const filename = (key) => Object.keys(record(key).files)[0];
const encoded = (name) => name.split("/").map(encodeURIComponent).join("/");
const viewer = (key, name) => name === undefined ? root(key) + "/" : root(key) + "/__manure/view/" + encoded(name);
const rawURL = (key, name = filename(key)) => root(key) + "/__manure/raw/" + encoded(name);
const downloadURL = (key, name = filename(key)) => root(key) + "/__manure/files/" + encoded(name) + "/content";
const expected = (key, name = filename(key)) => Buffer.from(record(key).files[name], "base64");
const allowedOrigins = new Set([new URL(input.base).origin,
  ...Object.keys(input.records).map((key) => new URL(root(key)).origin)]);

const check = async (name, run) => {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const offOrigin = [];
  const pageErrors = [];
  const cspErrors = [];
  page.on("console", (message) => {
    // PDF/font diagnostics can be harmless. Only browser CSP errors belong in
    // this guard, particularly stylesheet blocks that semantic checks miss.
    if (message.type() === "error" && /content[- ]security[- ]policy|\bcsp\b/i.test(message.text())) {
      if (cspErrors.length < 20) cspErrors.push(clean(message.text()));
    }
  });
  let dialogs = 0;
  // Observe AND abort accidental internet access: failures are deterministic and
  // this controlled-system test never depends on a third-party server.
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (["http:", "https:"].includes(url.protocol) && !allowedOrigins.has(url.origin)) {
      offOrigin.push(url.origin + url.pathname);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  context.on("page", (tab) => {
    if (tab !== page) tab.on("dialog", (dialog) => { dialogs++; dialog.dismiss().catch(() => {}); });
  });
  page.on("dialog", (dialog) => { dialogs++; dialog.dismiss().catch(() => {}); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const requestURLs = [];
  context.on("request", (request) => requestURLs.push(request.url()));
  await context.addInitScript(() => { window.__viewerExecuted = false; });
  try {
    await run(page, context);
    assert.equal(await page.evaluate(() => window.__viewerExecuted), false, "uploaded code must stay inert");
    assert.equal(dialogs, 0, "uploaded code must not open dialogs");
    assert.deepEqual(offOrigin, [], "viewer must never automatically request third-party resources");
    assert.deepEqual(pageErrors, [], "viewer must not leave uncaught browser errors");
    assert.deepEqual(cspErrors, [], "viewer resources/styles must not be blocked by CSP");
    for (const secret of secrets) if (secret) assert.equal(requestURLs.some((url) => url.includes(secret)), false, "credential in URL");
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: clean(error), cspErrors });
  } finally {
    await context.close();
  }
};

// Only public synthetic Markdown/PDF fixtures are captured: never an unlock
// form, dashboard session, or one-time password. Mode prefixes avoid overwrites.
const capture = async (page, name) => {
  if (input.artifacts) await page.screenshot({
    path: path.join(input.artifacts, `${input.mode}-${name}.png`), fullPage: true,
  });
};

const shell = async (page, key, name = filename(key)) => {
  const meta = page.locator("meta#manure-viewer");
  await meta.waitFor({ state: "attached" });
  assert.equal(await meta.getAttribute("data-path"), name);
  assert.ok(await meta.getAttribute("data-kind"), "shell specifies renderer kind");
  assert.equal(new URL(await meta.getAttribute("data-raw-url"), page.url()).href, rawURL(key, name));
  assert.equal(new URL(await meta.getAttribute("data-download-url"), page.url()).href, downloadURL(key, name));
};
const open = async (page, key, name) => {
  const response = await page.goto(viewer(key, name), { waitUntil: "domcontentloaded" });
  assert.equal(response.status(), 200);
  await shell(page, key, name);
};
const imagesRendered = async (page, minimum = 1, selector = "main img") => {
  await page.waitForFunction(({ minimum, selector }) => [...document.querySelectorAll(selector)]
    .filter((img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0).length >= minimum, { minimum, selector });
};
const fetchBytes = async (page, url) => page.evaluate(async (url) => {
  const response = await fetch(url, { cache: "no-store" });
  return { status: response.status, type: response.headers.get("content-type"),
    disposition: response.headers.get("content-disposition"), bytes: [...new Uint8Array(await response.arrayBuffer())] };
}, url);
const rawEqual = async (page, key, name = filename(key)) => {
  const response = await fetchBytes(page, rawURL(key, name));
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(response.bytes), expected(key, name), "raw endpoint must preserve original bytes");
};
const downloadEqual = async (page, key, name = filename(key)) => {
  const response = await fetchBytes(page, downloadURL(key, name));
  assert.equal(response.status, 200);
  assert.match(response.disposition || "", /attachment/i);
  assert.deepEqual(Buffer.from(response.bytes), expected(key, name), "download must preserve original bytes");
};
const markdownRendered = async (page) => {
  await page.getByRole("heading", { name: "Viewer specification", exact: true }).waitFor();
  await page.getByRole("cell", { name: "GFM table", exact: true }).waitFor();
  await page.getByText("completed task", { exact: true }).waitFor();
  await page.locator("article.markdown del").filter({ hasText: "removed text" }).waitFor();
  await imagesRendered(page, 2, 'img[alt="Rendered diagram"]');
  assert.equal(await page.locator('main a[href^="javascript:" i]').count(), 0);
  assert.equal(await page.locator("main script, main [onerror], main [onload]").count(), 0);
};
const management = async (page, command) => {
  const response = await page.request.post(input.base + "/api/current", {
    headers: { Authorization: "Bearer " + input.token, Origin: input.base },
    data: { requestId: randomUUID(), apiVersion: "1.0.0", command },
  });
  assert.equal(response.status(), 200);
  return response.json();
};

await check("markdown renders headings, GFM and both fenced diagrams without executing uploaded content", async (page) => {
  await open(page, "markdown");
  await markdownRendered(page);
  await rawEqual(page, "markdown");
  await downloadEqual(page, "markdown");
  await capture(page, "markdown-diagrams");
});

await check("standalone Mermaid and Graphviz produce decoded diagram images and exact original downloads", async (page) => {
  for (const key of ["mermaid", "dot"]) {
    await open(page, key);
    await imagesRendered(page, 1, 'img[alt="Rendered diagram"]');
    await rawEqual(page, key);
    await downloadEqual(page, key);
  }
});

await check("SVG and PNG decode safely and support visible Fit and Zoom changes", async (page) => {
  for (const key of ["svg", "png"]) {
    await open(page, key);
    await imagesRendered(page);
    await rawEqual(page, key);
    await downloadEqual(page, key);
  }
  const image = page.locator("main img").first();
  await page.getByRole("button", { name: /^fit/i }).click();
  const fit = await image.boundingBox();
  assert.ok(fit.width <= 1000 && fit.height <= 800, "fit image stays inside viewport");
  await page.getByRole("button", { name: /zoom in/i }).click();
  await page.waitForFunction((width) => document.querySelector("main img").getBoundingClientRect().width > width, fit.width);
});

const canvasSnapshot = async (page) => {
  await page.waitForFunction(() => {
    const canvas = document.querySelector("main canvas");
    if (!canvas || !canvas.width || !canvas.height) return false;
    const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      if (bytes[i + 3] > 0 && Math.min(bytes[i], bytes[i + 1], bytes[i + 2]) < 200) ink++;
    }
    return ink > 100;
  });
  return page.locator("main canvas").first().evaluate((canvas) => canvas.toDataURL());
};
await check("two-page PDF paints nonempty distinct canvases and navigates forward and backward", async (page) => {
  await open(page, "pdf");
  const first = await canvasSnapshot(page);
  await capture(page, "pdf-page-1");
  await page.getByRole("button", { name: /next/i }).click();
  await page.waitForFunction((first) => document.querySelector("main canvas")?.toDataURL() !== first, first);
  const second = await canvasSnapshot(page);
  assert.notEqual(second, first, "page two must actually repaint the PDF canvas");
  await capture(page, "pdf-page-2");
  await page.getByRole("button", { name: /prev/i }).click();
  await page.waitForFunction((first) => document.querySelector("main canvas")?.toDataURL() === first, first);
  await rawEqual(page, "pdf");
  await downloadEqual(page, "pdf");
});

await check("directory index remains original while explicit nested viewer and raw assets work", async (page) => {
  await page.goto(root("directory") + "/", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Original directory index", exact: true }).waitFor();
  assert.equal(await page.locator("meta#manure-viewer").count(), 0);
  await open(page, "directory", "docs/guide ü.md");
  await markdownRendered(page);
  await imagesRendered(page, 1, 'img[alt="local asset"]');
  for (const name of Object.keys(record("directory").files)) {
    await rawEqual(page, "directory", name);
    await downloadEqual(page, "directory", name);
  }
});

await check("invalid and oversized Graphviz sources fail visibly within a bounded time", async (page) => {
  for (const key of ["malformed", "graph-limit", "oversized"]) {
    const started = Date.now();
    await open(page, key);
    await page.getByRole("alert").filter({ hasText: /error|fail|invalid|large|limit|unable|unavailable/i }).waitFor();
    assert.ok(Date.now() - started < 20000, "render failure must be bounded");
    assert.equal(await page.locator("main img").evaluateAll((images) => images.some((image) => image.naturalWidth > 0)), false);
    await downloadEqual(page, key);
  }
});

await check("external raw and assets deny locked/revoked grants; unlock permits real nested rendering", async (page) => {
  const key = "external";
  const name = "docs/guide ü.md";
  await page.goto(viewer(key, name), { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Protected artifact", exact: true }).waitFor();
  const protectedURLs = [rawURL(key, name), rawURL(key, "assets/picture.png"), downloadURL(key, name),
    ...["viewer.js", "styles.css", "graphviz-worker.js", "pdf.worker.min.mjs", "pdf.renderer.min.mjs"]
      .map((asset) => root(key) + "/__manure/viewer/" + asset)];
  for (const url of protectedURLs) {
    const denied = await fetchBytes(page, url);
    assert.ok(denied.status >= 400, "locked raw/assets/download must not bypass authorization");
  }
  await page.locator("#password-input").fill(record(key).external_password);
  await page.locator("#unlock-form button[type=submit]").click();
  // Unlock may return the original directory root; navigate explicitly after
  // the form disappears rather than assuming it preserves a deep target.
  await page.waitForFunction(() => document.querySelector("#unlock-form") === null);
  await open(page, key, name);
  await markdownRendered(page);
  await imagesRendered(page, 1, 'img[alt="local asset"]');
  await rawEqual(page, key, name);
  await rawEqual(page, key, "assets/picture.png");
  const rotated = await management(page, { RotateExternalPassword: { artifactId: record(key).artifact_id } });
  const rotatedPassword = rotated.result?.ArtifactPatched?.externalPassword;
  if (rotatedPassword) secrets.add(rotatedPassword);
  const denied = await fetchBytes(page, rawURL(key, name));
  assert.ok(denied.status >= 400, "revoked cookie must deny a new raw request (not cached display)");
  const deniedAsset = await fetchBytes(page, rawURL(key, "assets/picture.png"));
  assert.ok(deniedAsset.status >= 400, "revoked cookie must deny fresh assets too");
});

await check("internal dashboard Open hands off a grant and renders the standalone private viewer", async (page) => {
  await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
  await page.locator("#token-input").fill(input.token);
  await page.locator("#login-form button[type=submit]").click();
  await page.locator("#whoami-text").waitFor({ state: "visible" });
  await page.goto(input.base + "/#/artifact/" + record("internal").artifact_id, { waitUntil: "domcontentloaded" });
  await page.locator("#detail-section").waitFor({ state: "visible" });
  await page.locator("#open-button").click();
  await page.getByRole("heading", { name: "Internal viewer handoff", exact: true }).waitFor();
  await shell(page, "internal");
  await rawEqual(page, "internal");
  await downloadEqual(page, "internal");
});

await browser.close();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.some((result) => !result.ok) ? 1 : 0;
