// Specified viewer feature contracts. Real renderers, real HTTP, no CDN access.
// Credentials are supplied over stdin and redacted from every failure report.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { randomUUID } from "node:crypto";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const require = createRequire(path.join(input.core, "package.json"));
const { chromium } = require("playwright-core");
const browser = await chromium.launch({ executablePath: input.browser, args: [
  "--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server",
  `--host-resolver-rules=${input.resolver}`,
] });
const results = [];
const secrets = new Set([input.token, ...Object.values(input.records).map((item) => item.external_password).filter(Boolean)]);
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

const check = async (name, run, hostileFixture) => {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const offOrigin = [];
  const userNavigations = [];
  let navigationDestination = null;
  const pageErrors = [];
  const cspErrors = [];
  const blockedInlineHandlers = [];
  page.on("console", (message) => {
    // PDF/font diagnostics can be harmless. Only browser CSP errors belong in
    // this guard, particularly stylesheet blocks that semantic checks miss.
    if (message.type() === "error" && /content[- ]security[- ]policy|\bcsp\b/i.test(message.text())) {
      if (/Executing inline event handler violates/i.test(message.text())) {
        // Retain blocked hostile-handler diagnostics; their originating stage
        // is not isolated. Execution and surviving attributes are checked below.
        blockedInlineHandlers.push(clean(message.text()));
      } else if (cspErrors.length < 20) cspErrors.push(clean(message.text()));
    }
  });
  let dialogs = 0;
  // Observe AND abort accidental internet access: failures are deterministic and
  // this controlled-system test never depends on a third-party server.
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && !allowedOrigins.has(url.origin)) {
      if (request.isNavigationRequest() && url.href === navigationDestination) {
        navigationDestination = null;
        userNavigations.push({ url: url.href, referer: request.headers().referer });
        return route.fulfill({ contentType: "text/html", body: "<!doctype html><h1>Controlled hyperlink destination</h1>" });
      }
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
    await run(page, context, async (link, destination) => {
      assert.deepEqual(offOrigin, [], "no remote resource or navigation request before the explicit click");
      const count = userNavigations.length;
      navigationDestination = destination;
      await Promise.all([page.waitForURL((url) => url.href === destination, { waitUntil: "domcontentloaded" }), link.click()]);
      await page.getByRole("heading", { name: "Controlled hyperlink destination", exact: true }).waitFor();
      assert.equal(navigationDestination, null, "the clicked href must issue its navigation request");
      assert.equal(userNavigations.length, count + 1);
      assert.deepEqual(userNavigations.at(-1), { url: destination, referer: undefined }, "navigation must not disclose the artifact URL");
    });
    assert.equal(await page.evaluate(() => window.__viewerExecuted), false, "uploaded code must stay inert");
    assert.equal(dialogs, 0, "uploaded code must not open dialogs");
    assert.deepEqual(offOrigin, [], "viewer must never automatically request third-party resources");
    assert.deepEqual(pageErrors, [], "viewer must not leave uncaught browser errors");
    assert.deepEqual(cspErrors, [], "viewer resources/styles must not be blocked by CSP");
    if (!hostileFixture) assert.deepEqual(blockedInlineHandlers, [], "benign content must not attempt inline handlers");
    for (const secret of secrets) if (secret) assert.equal(requestURLs.some((url) => url.includes(secret)), false, "credential in URL");
    results.push({ name, ok: true, blockedInlineHandlers });
  } catch (error) {
    results.push({ name, ok: false, error: clean(error), cspErrors, blockedInlineHandlers });
  } finally {
    await context.close();
  }
};

const favicon = async (page, key) => {
  const link = page.locator('link[rel="icon"]');
  assert.equal(await link.count(), 1);
  assert.equal(await link.getAttribute('type'), 'image/svg+xml');
  const url = new URL(await link.getAttribute('href'), page.url()).href;
  assert.equal(url, root(key) + '/__manure/viewer/favicon.svg');
  // Directory CSP permits images, not fetch; probe via Chromium navigation so
  // resolver rules apply without changing the original document or its policy.
  const probe = await page.context().newPage();
  try {
    const response = await probe.goto(url, { waitUntil: 'load', timeout: 20000 });
    assert.ok(response);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['content-type'], 'image/svg+xml');
  } finally {
    await probe.close();
  }
  const decoded = await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image.naturalWidth > 0 && image.naturalHeight > 0;
  }, url);
  assert.equal(decoded, true, 'favicon must decode under the actual shell CSP');
};

const shell = async (page, key, name = filename(key)) => {
  await favicon(page, key);
  const meta = page.locator("meta#manure-viewer");
  await meta.waitFor({ state: "attached" });
  assert.equal(await meta.getAttribute("data-path"), name);
  assert.ok(await meta.getAttribute("data-kind"), "shell specifies renderer kind");
  assert.equal(new URL(await meta.getAttribute("data-raw-url"), page.url()).href, rawURL(key, name));
  assert.equal(new URL(await meta.getAttribute("data-download-url"), page.url()).href, downloadURL(key, name));
  await uploadedTime(page, key);
};
// The meta line shows the server-recorded creation time in local time; the tooltip keeps the exact ISO value.
const uploadedTime = async (page, key) => {
  const uploaded = page.locator("time.uploaded-at");
  await uploaded.waitFor({ state: "visible" });
  assert.equal(await uploaded.getAttribute("datetime"), record(key).created_at);
  assert.equal(await uploaded.getAttribute("title"), record(key).created_at);
  await uploaded.filter({ hasText: /^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} · / }).waitFor();
  assert.match(await uploaded.locator("..").textContent(), /· uploaded /);
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
  assert.equal(await page.getByRole("heading", { name: "Uploaded at", exact: true }).getAttribute("id"), "uploaded-at", "preview metadata must not reserve document heading anchors");
  await page.getByRole("cell", { name: "GFM table", exact: true }).waitFor();
  await page.locator('article.markdown li').filter({ has: page.getByRole('img', { name: 'Completed task', exact: true }) }).filter({ hasText: 'completed task' }).waitFor();
  await page.locator("article.markdown del").filter({ hasText: "removed text" }).waitFor();
  await imagesRendered(page, 2, 'img[alt="Rendered diagram"]');
  const mermaidLabels = await page.locator('img[alt="Rendered diagram"]').first().evaluate(async (image) => {
    const svg = await (await fetch(image.src)).text();
    return [...new DOMParser().parseFromString(svg, 'image/svg+xml').querySelectorAll('text')].map((node) => node.textContent).join(' ');
  });
  assert.match(mermaidLabels, /Start/, 'Mermaid must retain its start label after sanitization');
  assert.match(mermaidLabels, /Finish/, 'Mermaid must retain its finish label after sanitization');
  assert.equal(await page.locator('main a[href^="javascript:" i]').count(), 0);
  assert.equal(await page.locator("main script").count(), 0);
  assert.equal(await page.locator('main *').evaluateAll((nodes) => nodes.some((node) => [...node.attributes].some((attribute) => /^on/i.test(attribute.name)))), false);
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
  await page.setViewportSize({ width: 375, height: 800 });
  const uploaded = await page.locator("time.uploaded-at").boundingBox();
  assert.ok(uploaded && uploaded.x >= 0 && uploaded.x + uploaded.width <= 375, "timestamp fits a narrow preview viewport");
}, true);

for (const [key, name] of [["markdown", filename("markdown")], ["directory", "docs/guide ü.md"], ["browse", "README.md"]]) {
  await check(`${key} Markdown hyperlinks preserve safe navigation without automatic external requests`, async (page, context, followLink) => {
    const siblingRequests = [];
    context.on("request", (request) => {
      const url = new URL(request.url());
      const sibling = new URL(root("sibling"));
      const mount = sibling.pathname.replace(/\/$/, "");
      if (url.origin === sibling.origin && (url.pathname === mount || url.pathname.startsWith(mount + "/"))) {
        siblingRequests.push({ url: request.url(), navigation: request.isNavigationRequest(), referer: request.headers().referer });
      }
    });
    const preview = async () => {
      const siblingCount = siblingRequests.length;
      if (key === "browse") {
        await page.goto(root(key) + "/", { waitUntil: "domcontentloaded" });
        await shell(page, key, name);
      } else await open(page, key, name);
      await markdownRendered(page);
      assert.equal(siblingRequests.length, siblingCount, "rendering must not automatically request a sibling artifact");
      assert.equal(await page.locator('article.markdown img[alt="Sibling image"]').getAttribute("src"), null);
    };
    await preview();
    const article = page.locator("article.markdown");
    const base = root(key) + "/" + encoded(name);
    for (const [label, href] of [["!182749", "https://example.com/review/182749"],
      ["HTTP review", "http://example.com/review/182749"],
      ["Protocol-relative review", "http://example.com/review/182749"],
      ["Local review", new URL("./related.md?view=1#topic", base).href],
      ["Encoded resource", new URL("./CPU%2090%25.md", base).href],
      ["Jump to title", "#viewer-specification"],
      ["Raw review", "https://example.com/raw?left=1&right=2"],
      [root("sibling"), new URL(root("sibling")).href],
      ["Sibling entry", new URL(root("sibling")).href],
      ["Sibling slash", root("sibling") + "/"],
      ["Sibling section", root("sibling") + "/#7-limits"],
      ["Sibling subpath", root("sibling") + "/docs/guide.html#topic"],
      ["Raw sibling", new URL(root("sibling")).href],
      ...(input.mode === "path" ? [["Rooted sibling", root("sibling")]] : [])]) {
      const link = article.getByText(label, { exact: true });
      assert.equal(await link.count(), 1, label);
      assert.equal(await link.getAttribute("href"), href, `${key}: ${label} must retain a navigable href`);
      assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
      assert.equal(await link.getAttribute("ping"), null, "links must not introduce tracking requests");
    }
    for (const label of ["Entity script scheme", "Tab script scheme", "Line script scheme", "Data scheme",
      "Legacy script scheme", "Local file scheme", "Blob scheme", "Mail scheme", "Credential URL", "Control URL",
      "Malformed URL", "Reserved route", "Management route", "Encoded reserved route", "Encoded management route",
      "Encoded slash path", "Encoded backslash path", "Encoded null path"]) {
      const link = article.getByText(label, { exact: true });
      assert.equal(await link.count(), 1, label);
      assert.equal(await link.getAttribute("href"), null, `${key}: ${label} must remain inert`);
    }
    for (const [label, path] of [["Absolute management route", "/api/users"],
      ["Absolute reserved route", "/__manure/logout"], ["Absolute sibling mount", "/view/other/README.md"]]) {
      const sameOrigin = new URL(input.base).origin === new URL(base).origin;
      assert.equal(await article.getByText(label, { exact: true }).getAttribute("href"), sameOrigin ? null : input.base + path,
        `${key}: absolute URLs retain same-origin confinement, not a service-host allowlist`);
    }
    for (const [label, destination] of [["!182749", "https://example.com/review/182749"], ["Raw review", "https://example.com/raw?left=1&right=2"]]) {
      await followLink(article.getByRole("link", { name: label, exact: true }), destination);
      await preview();
    }
    for (const [label, suffix] of [["Sibling entry", "/"], ["Sibling slash", "/"],
      ["Sibling section", "/#7-limits"], ["Sibling subpath", "/docs/guide.html#topic"]]) {
      const count = siblingRequests.length;
      await Promise.all([page.waitForURL(root("sibling") + suffix, { waitUntil: "domcontentloaded" }),
        article.getByRole("link", { name: label, exact: true }).click()]);
      await page.getByRole("heading", { name: suffix.includes("/docs/") ? "Sibling subpath destination" : "Sibling artifact destination", exact: true }).waitFor();
      const navigations = siblingRequests.slice(count).filter(request => request.navigation);
      assert.ok(navigations.length > 0, "explicit sibling clicks must reach the owned artifact");
      assert.equal(navigations[0].referer, undefined, "sibling navigation must not disclose the source artifact URL");
      assert.equal(new URL(navigations.at(-1).url).href, new URL(root("sibling") + suffix).href.split("#")[0]);
      await preview();
    }
  }, true);
}

await check("standalone Mermaid and Graphviz produce decoded diagram images and exact original downloads", async (page) => {
  for (const key of ["mermaid", "dot"]) {
    await open(page, key);
    await imagesRendered(page, 1, 'img[alt="Rendered diagram"]');
    await rawEqual(page, key);
    await downloadEqual(page, key);
  }
}, false);

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
}, true);

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
await check("two-page PDF paints nonempty distinct canvases, navigates forward and backward, and releases its workers on pagehide", async (page) => {
  await open(page, "pdf");
  const first = await canvasSnapshot(page);
  const pages = page.getByRole("toolbar", { name: "PDF pages", exact: true });
  await pages.getByText("Page 1 of 2", { exact: true }).waitFor();
  await pages.getByRole("button", { name: "Next page", exact: true }).click();
  await page.waitForFunction((first) => document.querySelector("main canvas")?.toDataURL() !== first, first);
  const second = await canvasSnapshot(page);
  assert.notEqual(second, first, "page two must actually repaint the PDF canvas");
  await pages.getByText("Page 2 of 2", { exact: true }).waitFor();
  await pages.getByRole("button", { name: "Previous page", exact: true }).click();
  await page.waitForFunction((first) => document.querySelector("main canvas")?.toDataURL() === first, first);
  await rawEqual(page, "pdf");
  await downloadEqual(page, "pdf");
  // Regression (D24): leaving the page called a destroy() the pdf.js 6 document does not have.
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
}, false);

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
}, true);

await check("no-index directory browsing renders README and safely navigates nested and empty children", async (page) => {
  await page.goto(root("browse") + "/", { waitUntil: "domcontentloaded" });
  await shell(page, "browse", "README.md");
  await markdownRendered(page);
  const listing = page.getByRole("table", { name: "Directory contents", exact: true });
  assert.equal(await listing.getByRole("row").count(), 1 + 4, "header plus only the immediate children");
  assert.equal(await listing.getByRole("link", { name: "Parent directory", exact: true }).count(), 0);
  await listing.getByRole("link", { name: "nested/", exact: true }).click();
  await page.getByRole("heading", { name: "Nested directory preview", exact: true }).waitFor();
  await shell(page, "browse", "nested/readme.md");
  await page.getByRole("link", { name: "a & <b> + ü.md", exact: true }).click();
  await page.getByRole("heading", { name: "Encoded child preview", exact: true }).waitFor();
  await shell(page, "browse", "nested/a & <b> + ü.md");
  await rawEqual(page, "browse", "nested/a & <b> + ü.md");
  await page.goto(root("browse") + "/nested/", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Parent directory", exact: true }).click();
  await page.getByRole("link", { name: "empty/", exact: true }).click();
  await page.getByText("Empty directory", { exact: true }).waitFor();
  await favicon(page, "browse");
  assert.equal(await page.locator("meta#manure-viewer").count(), 0);
  await page.getByRole("link", { name: "Parent directory", exact: true }).click();
  await page.getByRole("heading", { name: "Viewer specification", exact: true }).waitFor();
  const original = page.getByRole("link", { name: "original.bin", exact: true });
  assert.equal(await original.getAttribute("href"), new URL(root("browse")).pathname.replace(/\/$/, "") + "/original.bin");
  await downloadEqual(page, "browse", "original.bin");
}, true);

await check("invalid and oversized Graphviz sources fail visibly within a bounded time", async (page) => {
  for (const key of ["malformed", "graph-limit", "oversized"]) {
    const started = Date.now();
    await open(page, key);
    await page.getByRole("alert").filter({ hasText: /error|fail|invalid|large|limit|unable|unavailable/i }).waitFor();
    assert.ok(Date.now() - started < 20000, "render failure must be bounded");
    assert.equal(await page.locator("main img").evaluateAll((images) => images.some((image) => image.naturalWidth > 0)), false);
    await downloadEqual(page, key);
  }
}, false);

await check("external raw and assets deny locked/revoked grants; unlock permits real nested rendering", async (page) => {
  const key = "external";
  const name = "docs/guide ü.md";
  const lockedView = await page.goto(viewer(key, name), { waitUntil: "domcontentloaded" });
  assert.ok(lockedView.status() >= 400, 'locked deep links must not become successful HTML shells');
  await page.goto(root(key) + '/', { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Protected artifact", exact: true }).waitFor();
  await favicon(page, key);
  const protectedURLs = [rawURL(key, name), rawURL(key, "assets/picture.png"), downloadURL(key, name),
    ...["viewer.js", "chrome.js", "styles.css", "graphviz-worker.js", "pdf.worker.min.mjs", "pdf.renderer.min.mjs"]
      .map((asset) => root(key) + "/__manure/viewer/" + asset)];
  for (const url of protectedURLs) {
    const denied = await fetchBytes(page, url);
    assert.ok(denied.status >= 400, "locked raw/assets/download must not bypass authorization");
  }
  // The shared design system styles the locked page itself; it is public and carries no artifact data.
  assert.equal((await fetchBytes(page, root(key) + "/__manure/ui/tokens.css")).status, 200);
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
}, true);

await check("source files preview as exact numbered text; archives get a download card instead of a preview", async (page) => {
  await page.goto(root("code") + "/", { waitUntil: "domcontentloaded" });
  await shell(page, "code");
  const text = page.getByLabel("File text", { exact: true });
  await text.waitFor();
  assert.equal(await text.textContent(), expected("code").toString("utf8"), "text preview must be the exact file text");
  assert.equal(await text.locator("span").count(), 2, "one numbered row per source line");
  await page.getByText("2 lines", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Copy raw", exact: true }).isEnabled(), true);
  await page.goto(root("archive") + "/", { waitUntil: "domcontentloaded" });
  await shell(page, "archive");
  await page.getByRole("heading", { name: "No preview for archives", exact: true }).waitFor();
  const download = page.getByRole("main").getByRole("link", { name: "Download original", exact: true });
  assert.equal(new URL(await download.getAttribute("href"), page.url()).href, downloadURL("archive"));
  await downloadEqual(page, "archive");
}, false);

const scrollers = (page) => page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => {
  const style = getComputedStyle(el);
  return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.getBoundingClientRect().height > 0;
}).map((el) => el.tagName));
const scrolledChrome = async (page, selector) => {
  await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight));
  await page.waitForFunction(() => scrollY > 0);
  return page.locator(selector).evaluate((el) => el.getBoundingClientRect().top);
};
await check("viewer pages scroll only the document under sticky chrome; section tools, theme and CLI disclosure work by keyboard", async (page) => {
  await open(page, "markdown");
  await markdownRendered(page);
  assert.deepEqual(await scrollers(page), [], "the document is the only vertical scroller");
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight), "the fixture overflows the viewport");
  assert.equal(await scrolledChrome(page, "header"), 0, "the viewer bar stays at the top");
  const anchor = page.getByRole("link", { name: "Link to section: Viewer specification", exact: true });
  await anchor.focus();
  assert.equal(await anchor.evaluate((el) => getComputedStyle(el.closest(".heading-tools")).opacity), "1", "section tools appear on keyboard focus");
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  assert.equal(await page.getByLabel("Raw Markdown", { exact: true }).textContent(), expected("markdown").toString("utf8"));
  await page.getByRole("button", { name: "Rendered", exact: true }).click();
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.themeChoice), "dark", "the theme choice persists");
  await page.setViewportSize({ width: 1000, height: 500 });
  await open(page, "pdf");
  await canvasSnapshot(page);
  assert.deepEqual(await scrollers(page), []);
  assert.equal(await scrolledChrome(page, '[role="toolbar"]'), 48, "the PDF toolbar sticks under the bar");
  await page.goto(root("browse") + "/", { waitUntil: "domcontentloaded" });
  const cli = page.getByRole("group").filter({ has: page.getByText("Download all (CLI)…") });
  await page.getByText("Download all (CLI)…", { exact: true }).click();
  await page.getByText(`manure fetch ${record("browse").content_url} ./viewer-browse`, { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await cli.evaluate((el) => el.open), false, "Escape closes the disclosure");
}, true);

await check("unlock card reports a wrong password, pauses while throttled and explains a deleted artifact", async (page) => {
  await page.clock.install();
  const key = "unlock-states";
  const unlock = root(key) + "/__manure/unlock";
  await page.goto(root(key) + "/", { waitUntil: "domcontentloaded" });
  const password = page.getByLabel("External password", { exact: true });
  const submit = page.getByRole("button", { name: "Unlock", exact: true });
  await password.fill("not-the-password");
  await submit.click();
  await page.getByText("That password is not correct. Check it and try again.", { exact: true }).waitFor();
  assert.equal(await password.getAttribute("aria-invalid"), "true");
  assert.equal(await password.inputValue(), "", "the password field is cleared after an attempt");
  const statuses = await page.evaluate(async (unlock) => {
    const out = [];
    for (let i = 0; i < 12 && !out.includes(429); i++) out.push((await fetch(unlock, { method: "POST", body: new URLSearchParams({ password: "wrong" }) })).status);
    return out;
  }, unlock);
  assert.ok(statuses.includes(429), `the server throttles repeated attempts: ${statuses}`);
  await password.fill("still-wrong");
  await submit.click();
  await page.getByRole("heading", { name: "Protected artifact", exact: true }).waitFor();
  await page.getByText("Too many attempts", { exact: true }).waitFor();
  assert.equal(await password.isDisabled(), true, "the form pauses while throttled");
  await page.clock.runFor(60000);
  assert.equal(await password.isDisabled(), false, "the form resumes after the server's rate window");
  assert.equal(await page.getByText("Too many attempts", { exact: true }).isVisible(), false);
  await page.goto(root("unlock-gone") + "/", { waitUntil: "domcontentloaded" });
  await management(page, { DeleteArtifact: { artifactId: record("unlock-gone").artifact_id } });
  await password.fill("any-password");
  await submit.click();
  await page.getByRole("heading", { name: "This artifact is no longer available", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Protected artifact", exact: true }).isVisible(), false);
}, false);

await check("internal dashboard Open hands off a grant and renders the standalone private viewer", async (page) => {
  await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
  await page.locator("[data-account-login] input[name=login]").fill(input.login);
  await page.locator("[data-account-login] input[name=password]").fill(input.loginPassword);
  await page.locator("[data-account-login] button[type=submit]").click();
  await page.locator("#whoami-text").waitFor({ state: "visible" });
  await page.goto(input.base + "/#/artifact/" + record("internal").artifact_id, { waitUntil: "domcontentloaded" });
  await page.locator("#detail-section").waitFor({ state: "visible" });
  await page.locator("#open-button").click();
  await page.getByRole("heading", { name: "Internal viewer handoff", exact: true }).waitFor();
  await shell(page, "internal");
  await rawEqual(page, "internal");
  await downloadEqual(page, "internal");
}, false);

await browser.close();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.some((result) => !result.ok) ? 1 : 0;
