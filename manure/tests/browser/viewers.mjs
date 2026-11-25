// Specified viewer feature contracts. Real renderers, real HTTP, no CDN access.
// Credentials are supplied over stdin and redacted from every failure report.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
const assetURL = (key, name) => root(key) + "/__manure/viewer/" + name;
const castAssets = ["asciinema-player.js", "asciinema-player.css"];
const castPoster = "Press play to watch the terminal recording.";
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
  const consoleGuard = (message) => {
    // PDF/font diagnostics can be harmless. Only browser CSP errors belong in
    // this guard, particularly stylesheet blocks that semantic checks miss.
    if (message.type() === "error" && /content[- ]security[- ]policy|\bcsp\b/i.test(message.text())) {
      if (/Executing inline event handler violates/i.test(message.text())) {
        // Retain blocked hostile-handler diagnostics; their originating stage
        // is not isolated. Execution and surviving attributes are checked below.
        blockedInlineHandlers.push(clean(message.text()));
      } else if (cspErrors.length < 20) cspErrors.push(clean(message.text()));
    }
  };
  page.on("console", consoleGuard);
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
  // Tabs the dashboard opens show content too: the same guards apply to them.
  context.on("page", (tab) => {
    if (tab === page) return;
    tab.on("dialog", (dialog) => { dialogs++; dialog.dismiss().catch(() => {}); });
    tab.on("console", consoleGuard);
    tab.on("pageerror", (error) => pageErrors.push(error.message));
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
  return response;
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
/** Oversized media extend the document: the element's left edge has a reachable (non-negative) document coordinate
 * and, scrolled to the end, its right and bottom edges are inside the viewport. */
const bothEdgesReachable = async (page, selector) => {
  const box = await page.locator(selector).first().evaluate((el) => {
    scrollTo(0, 0);
    const start = el.getBoundingClientRect();
    scrollTo(document.scrollingElement.scrollWidth, document.scrollingElement.scrollHeight);
    const end = el.getBoundingClientRect();
    const result = { left: start.left, width: start.width, viewport: innerWidth,
      rightVisible: end.right <= innerWidth + 1, bottomVisible: end.bottom <= innerHeight + 1 };
    scrollTo(0, 0);
    return result;
  });
  assert.ok(box.width > box.viewport, `the fixture must be wider than the viewport: ${JSON.stringify(box)}`);
  assert.ok(box.left >= 0 && box.rightVisible && box.bottomVisible, `both edges must be reachable: ${JSON.stringify(box)}`);
};
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
const castPlayer = (page) => page.getByRole("region", { name: "Terminal recording", exact: true });
const castDownloadEqual = async (page, key, name, link) => {
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  assert.equal(download.url(), downloadURL(key, name));
  assert.ok((await readFile(await download.path())).equals(expected(key, name)), `${name}: download preserves original bytes`);
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
  // Regression (review R5): an authored icon-like span stays inert text; page icon hydration builds nothing from it.
  const authored = page.locator("article.markdown span").filter({ hasText: "Authored icon placeholder" });
  assert.equal(await authored.count(), 1);
  assert.equal(await authored.getAttribute("data-icon"), null, "uploaded data-icon attributes are removed");
  assert.equal(await page.locator('main img[src*="hydrate"]').count(), 0);
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
  // Even a placeholder that reached the DOM some other way becomes only the named icon: its classes never become markup.
  await page.evaluate(() => {
    const slot = document.createElement("span");
    slot.dataset.icon = "box";
    slot.className = 'icon-sm x"><img src="https://viewer-attacker.invalid/direct.png">';
    slot.id = "hostile-placeholder";
    document.querySelector("main").append(slot);
  });
  await page.waitForFunction(() => !document.getElementById("hostile-placeholder"));
  assert.deepEqual(await page.locator("main > svg").last().evaluate((svg) => [...svg.classList]), ["icon", "icon-sm"]);
  assert.equal(await page.locator('main img[src*="direct"]').count(), 0);
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
  // The 1600 px PNG at actual size is wider than the page: both of its edges must be reachable by document scrolling.
  await page.getByRole("button", { name: "Actual size", exact: true }).click();
  await bothEdgesReachable(page, "main img");
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

await check("standalone asciicast v2 starts paused, then plays, pauses, seeks and toggles fullscreen", async (page) => {
  const key = "cast";
  const name = filename(key);
  const responses = await Promise.all([
    ...castAssets.map((asset) => page.waitForResponse(assetURL(key, asset))),
    page.goto(viewer(key), { waitUntil: "domcontentloaded" }),
  ]);
  for (const response of responses) assert.equal(response.status(), 200, response.url());
  await shell(page, key);
  assert.equal(await page.locator("meta#manure-viewer").getAttribute("data-kind"), "asciinema");
  await page.getByText(/ · Terminal recording\b/).waitFor();
  await page.getByRole("navigation", { name: "Path", exact: true }).getByText(name, { exact: true }).waitFor();
  const download = page.getByRole("banner").getByRole("link", { name: "Download original", exact: true });
  await download.waitFor();

  const player = castPlayer(page);
  const terminal = player.locator(".ap-term-text");
  const play = player.getByRole("button", { name: "Play", exact: true });
  const pause = player.getByRole("button", { name: "Pause", exact: true });
  await terminal.filter({ hasText: castPoster }).waitFor();
  await play.waitFor();
  assert.equal(await pause.isVisible(), false);
  assert.doesNotMatch(await terminal.textContent(), /literal|Playback advanced/);
  await play.click();
  await terminal.filter({ hasText: "Playback advanced" }).waitFor();
  assert.match(await terminal.textContent(), /<b>literal<\/b>/, "first Play preserves the output at time zero");
  assert.equal(await terminal.locator("b").count(), 0, "terminal markup stays literal text");
  await pause.click();
  await play.waitFor();
  assert.equal(await terminal.filter({ hasText: "After seek" }).isVisible(), false);
  await player.locator(".ap-progressbar").click();
  await terminal.filter({ hasText: "After seek" }).waitFor();
  await play.waitFor();

  const fullscreen = player.getByRole("button", { name: "Toggle fullscreen mode", exact: true });
  await fullscreen.click();
  await page.waitForFunction(() => document.fullscreenElement !== null);
  await fullscreen.click();
  await page.waitForFunction(() => document.fullscreenElement === null);

  const raw = await fetchBytes(page, rawURL(key));
  assert.equal(raw.status, 200);
  assert.equal(raw.type, "application/x-asciicast");
  assert.deepEqual(Buffer.from(raw.bytes), expected(key));
  await castDownloadEqual(page, key, name, download);
}, false);

await check("failed asciicast previews explain why and keep exact downloads", async (page) => {
  async function fallback(key, name, reason, nested = true) {
    await open(page, key, nested ? name : undefined);
    const notice = page.getByRole("alert").filter({ hasText: "Preview unavailable" });
    await notice.waitFor();
    assert.match(await notice.textContent(), reason);
    assert.equal(await castPlayer(page).count(), 0);
    await castDownloadEqual(page, key, name, notice.getByRole("link", { name: "Download original", exact: true }));
  }
  await fallback("formats", "broken.cast", /invalid|malformed/i);
  await fallback("formats", "large.cast", /too large/i);
  await page.addInitScript(() => { globalThis.WebAssembly = undefined; });
  await fallback("cast", filename("cast"), /does not support terminal playback/i, false);
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
  // A type that is not listed opens in the viewer too; content that is not text gets a card with the download.
  const original = page.getByRole("link", { name: "original.bin", exact: true });
  assert.equal(await original.getAttribute("href"), new URL(root("browse")).pathname.replace(/\/$/, "") + "/__manure/view/original.bin");
  await original.click();
  await page.getByRole("heading", { name: "No preview for this file type", exact: true }).waitFor();
  await shell(page, "browse", "original.bin");
  await downloadEqual(page, "browse", "original.bin");
}, true);

await check("invalid and oversized Graphviz sources fail visibly; a stalled renderer fails at its 10 s deadline", async (page, context) => {
  for (const key of ["malformed", "graph-limit", "oversized"]) {
    await open(page, key);
    await page.getByRole("alert").filter({ hasText: /error|fail|invalid|large|limit|unable|unavailable/i }).waitFor();
    assert.equal(await page.locator("main img").evaluateAll((images) => images.some((image) => image.naturalWidth > 0)), false);
    await downloadEqual(page, key);
  }
  // The renderer worker never loads (its script request is held), so only the viewer's deadline can end the
  // render; the page clock drives that deadline instead of elapsed time.
  let workerRequested;
  const requested = new Promise((resolve) => { workerRequested = resolve; });
  await context.route("**/__manure/viewer/graphviz-worker.js", () => workerRequested());
  await page.clock.install();
  await open(page, "dot");
  await requested;
  assert.equal(await page.getByRole("alert").count(), 0, "no failure before the deadline");
  await page.clock.runFor(10000);
  await page.getByRole("alert").filter({ hasText: "Diagram rendering exceeded the 10 second deadline." }).waitFor();
  await downloadEqual(page, "dot");
}, false);

await check("external raw and assets deny locked/revoked grants; unlock permits real nested rendering", async (page) => {
  const key = "external";
  const name = "docs/guide ü.md";
  const castName = "docs/protected.cast";
  for (const file of [name, castName]) {
    const lockedView = await page.goto(viewer(key, file), { waitUntil: "domcontentloaded" });
    assert.ok(lockedView.status() >= 400, 'locked deep links must not become successful HTML shells');
  }
  await page.goto(root(key) + '/', { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Protected artifact", exact: true }).waitFor();
  await favicon(page, key);
  const protectedURLs = [rawURL(key, name), rawURL(key, "assets/picture.png"), downloadURL(key, name),
    rawURL(key, castName), downloadURL(key, castName),
    ...["viewer.js", "styles.css", "graphviz-worker.js", "pdf.worker.min.mjs", "pdf.renderer.min.mjs", ...castAssets]
      .map((asset) => assetURL(key, asset))];
  for (const url of protectedURLs) {
    const denied = await fetchBytes(page, url);
    assert.ok(denied.status >= 400, "locked raw/assets/download must not bypass authorization");
  }
  // The content shell styles the locked page itself; it is public and carries no artifact data.
  for (const asset of ["ui/tokens.css", "content.css", "chrome.js"]) assert.equal((await fetchBytes(page, root(key) + "/__manure/shell/" + asset)).status, 200, asset);
  await page.locator("#password-input").fill(record(key).external_password);
  await page.locator("#unlock-form button[type=submit]").click();
  // Unlock may return the original directory root; navigate explicitly after
  // the form disappears rather than assuming it preserves a deep target.
  await page.waitForFunction(() => document.querySelector("#unlock-form") === null);
  const markdown = await open(page, key, name);
  await markdownRendered(page);
  await imagesRendered(page, 1, 'img[alt="local asset"]');
  await rawEqual(page, key, name);
  await rawEqual(page, key, "assets/picture.png");

  // The root has an original index, but its docs/ subdirectory is a real listing.
  await page.getByRole("navigation", { name: "Path", exact: true }).getByRole("link", { name: "docs", exact: true }).click();
  const listing = page.getByRole("table", { name: "Directory contents", exact: true });
  const castLink = listing.getByRole("link", { name: "protected.cast", exact: true });
  await listing.getByRole("row").filter({ hasText: "protected.cast" }).getByRole("cell", { name: "Terminal recording", exact: true }).waitFor();
  const [cast] = await Promise.all([page.waitForResponse(viewer(key, castName)), castLink.click()]);
  assert.equal(cast.status(), 200);
  await shell(page, key, castName);
  const policy = markdown.headers()["content-security-policy"];
  assert.ok(policy);
  assert.equal(cast.headers()["content-security-policy"], policy);
  const player = castPlayer(page);
  const terminal = player.locator(".ap-term-text");
  const play = player.getByRole("button", { name: "Play", exact: true });
  await terminal.filter({ hasText: castPoster }).waitFor();
  await play.waitFor();
  assert.doesNotMatch(await terminal.textContent(), /literal|After seek/);
  const seek = player.locator(".ap-progressbar");
  const usable = await seek.evaluate((el) => {
    const { top, bottom, width } = el.getBoundingClientRect();
    return top >= 0 && bottom <= innerHeight && width > 24;
  });
  assert.ok(usable, "the portrait recording keeps the seek control in the viewport");
  // Halfway through the v3 recording includes this frame only when times are accumulated.
  await seek.click();
  await terminal.filter({ hasText: "After seek" }).waitFor();
  assert.match(await terminal.textContent(), /<b>literal<\/b>/, "first Seek preserves the output at time zero");
  await play.waitFor();
  await rawEqual(page, key, castName);

  const rotated = await management(page, { RotateExternalPassword: { artifactId: record(key).artifact_id } });
  const rotatedPassword = rotated.result?.ArtifactPatched?.externalPassword;
  if (rotatedPassword) secrets.add(rotatedPassword);
  const denied = await fetchBytes(page, rawURL(key, name));
  assert.ok(denied.status >= 400, "revoked cookie must deny a new raw request (not cached display)");
  for (const url of [rawURL(key, "assets/picture.png"), rawURL(key, castName), ...castAssets.map((asset) => assetURL(key, asset))]) {
    assert.ok((await fetchBytes(page, url)).status >= 400, "revoked cookie must deny fresh raw and viewer asset requests");
  }
}, true);

await check("source files preview as exact numbered text; archives get a download card instead of a preview", async (page) => {
  const playerRequests = [];
  page.on("request", (request) => {
    if (castAssets.some((asset) => new URL(request.url()).pathname.endsWith("/" + asset))) playerRequests.push(request.url());
  });
  await page.goto(root("code") + "/", { waitUntil: "domcontentloaded" });
  await shell(page, "code");
  const text = page.getByLabel("File text", { exact: true });
  await text.waitFor();
  assert.equal(await text.textContent(), expected("code").toString("utf8"), "text preview must be the exact file text");
  assert.equal(await text.locator(":scope > span").count(), 2, "one numbered row per source line");
  await page.getByText("2 lines", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Copy raw", exact: true }).isEnabled(), true);
  await page.goto(root("archive") + "/", { waitUntil: "domcontentloaded" });
  await shell(page, "archive");
  await page.getByRole("heading", { name: "No preview for archives", exact: true }).waitFor();
  const download = page.getByRole("main").getByRole("link", { name: "Download original", exact: true });
  assert.equal(new URL(await download.getAttribute("href"), page.url()).href, downloadURL("archive"));
  await downloadEqual(page, "archive");
  assert.deepEqual(playerRequests, [], "non-terminal previews do not load the player assets");
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
// Specified: format-aware text views through the real raw route (byte ranges included) and under the real viewer policy.
await check("text formats: highlighted source with line links, diff, JSON, table, log colours, a cut-off log, a named file", async (page) => {
  const fileText = page.getByLabel("File text", { exact: true });
  const text = (name) => expected("formats", name).toString("utf8");
  const meta = () => page.locator("#meta-extra").textContent();
  const mode = (name) => page.getByRole("button", { name, exact: true });
  await open(page, "formats", "src/summarise.py");
  await fileText.waitFor();
  assert.equal(await fileText.textContent(), text("src/summarise.py"), "highlighting keeps the exact file text");
  assert.deepEqual(await fileText.locator(".hljs-keyword").allTextContents(), ["import", "def", "return"]);
  assert.equal(await fileText.locator("b").count(), 0, "markup in a source file stays text");
  assert.equal(await meta(), "7 lines");
  await fileText.locator(":scope > span").nth(3).locator("a.ln").click();
  await page.waitForFunction(() => location.hash === "#L4");
  await fileText.locator(":scope > span").nth(5).locator("a.ln").click({ modifiers: ["Shift"] });
  await page.waitForFunction(() => location.hash === "#L4-L6");
  assert.deepEqual(await fileText.locator(":scope > .is-target").evaluateAll((lines) => lines.map((line) => line.textContent.trim().slice(0, 8))), ["def load", '"""Doc', 'string."']);
  await page.reload({ waitUntil: "domcontentloaded" });
  await fileText.locator(":scope > .is-target").first().waitFor();
  assert.equal(await fileText.locator(":scope > .is-target").count(), 3, "a line link survives a reload");

  await open(page, "formats", "fix.diff");
  await fileText.waitFor();
  assert.equal(await fileText.textContent(), text("fix.diff"));
  assert.deepEqual(await fileText.locator(":scope > span").evaluateAll((lines) => lines.map((line) => line.className)),
    ["diff-file", "diff-file", "diff-file", "diff-hunk", "", "diff-del", "diff-add"]);
  assert.equal(await meta(), "1 file · +1 −1 · 7 lines");

  await open(page, "formats", "metrics.json");
  const formatted = page.getByLabel("Formatted JSON", { exact: true });
  await formatted.waitFor();
  assert.equal(await formatted.textContent(), '{\n  "run": "m4",\n  "big": 12345678901234567890,\n  "rows": [\n    1.50,\n    null\n  ]\n}\n', "numbers are shown as stored");
  assert.equal(await mode("Formatted").getAttribute("aria-pressed"), "true");
  await mode("Raw").click();
  assert.equal(await fileText.textContent(), text("metrics.json"));
  assert.equal(await formatted.isVisible(), false);

  await open(page, "formats", "results.csv");
  const table = page.getByRole("table", { name: "CSV table", exact: true });
  await table.waitFor();
  assert.deepEqual(await table.locator("tbody tr").evaluateAll((rows) => rows.map((row) => [...row.cells].map((cell) => cell.textContent))),
    [["1", "alpha", "1.50", 'said "hi", twice'], ["2", "beta", "-2", ""]]);
  assert.equal(await meta(), "2 rows · 3 columns · 3 lines");
  assert.deepEqual(await scrollers(page), [], "the table is in the document, not in a scroll box");
  await mode("Raw").click();
  assert.equal(await fileText.textContent(), text("results.csv"));

  await open(page, "formats", "build.log");
  const rendered = page.getByLabel("Rendered log", { exact: true });
  await rendered.waitFor();
  assert.equal(await rendered.textContent(), "06:02 ok\nerror at <x>\n", "escape sequences are interpreted, not shown");
  assert.equal(await rendered.locator(".ansi-bold.ansi-fg-1").textContent(), "error");
  await mode("Raw").click();
  assert.equal(await fileText.textContent(), text("build.log"), "the raw view keeps every escape");

  // 2.6 MB: the viewer asks the raw route for the first 2 MiB and shows whole lines of them.
  const ranges = [];
  page.on("request", (request) => { if (request.url() === rawURL("formats", "crawl.log")) ranges.push(request.headers().range || "whole"); });
  await open(page, "formats", "crawl.log");
  await page.getByText("Showing the first 2.0 MiB of 2.5 MiB", { exact: true }).waitFor();
  const shown = await fileText.textContent();
  assert.equal(shown.length % 100, 0, "no cut line and no cut character");
  assert.equal(text("crawl.log").startsWith(shown) && shown.length === Math.floor(2 * 1024 * 1024 / 101) * 100, true, "the leading whole lines of the file");
  assert.deepEqual(ranges, ["whole", "bytes=0-2097151"]);
  assert.equal(await meta(), "first 20,763 lines");
  await downloadEqual(page, "formats", "crawl.log");

  // An over-limit table is tabulated as a part: its leading rows, counted as "first".
  const big = text("big.csv");
  const bigRows = big.slice(0, big.lastIndexOf("\n", 2 * 1024 * 1024 - 1) + 1).split("\n").length - 2;
  await open(page, "formats", "big.csv");
  await page.getByText(/^Showing the first 2\.0 MiB of 2\.\d MiB$/).waitFor();
  assert.equal(await table.locator("tbody tr").count(), 2000, "the table shows the leading rows");
  assert.deepEqual(await table.locator("tbody tr").nth(1999).evaluate((row) => [row.cells[0].textContent, row.cells[1].textContent]), ["2000", "2000"]);
  assert.equal(await page.locator(".data-foot").textContent(), "First 2,000 rows are shown as a table.");
  assert.equal(await meta(), `first ${bigRows.toLocaleString("en-US")} rows · 2 columns · first ${(bigRows + 1).toLocaleString("en-US")} lines`);
  assert.equal(await page.getByRole("alert").count(), 0);

  await open(page, "formats", "Makefile");
  await fileText.waitFor();
  assert.equal(await page.locator("meta#manure-viewer").getAttribute("data-kind"), "text", "a well-known name is a text type");
  assert.equal(await fileText.textContent(), text("Makefile"));

  await open(page, "formats", "notes.md");
  await page.locator("article.markdown pre .hljs-keyword").first().waitFor();
  const copy = page.getByRole("button", { name: "Copy code", exact: true });
  await copy.focus();
  assert.equal(await copy.evaluate((el) => getComputedStyle(el.parentElement).opacity), "1", "Copy appears on keyboard focus");
}, false);

await check("unknown and media types: a card instead of a browser download, a native player, and stored bytes for other clients", async (page) => {
  // A browser navigation to a standalone file of an unlisted type gets the viewer page ...
  const response = await page.goto(root("unknown") + "/", { waitUntil: "domcontentloaded" });
  assert.equal(response.status(), 200);
  assert.match(response.headers()["content-type"], /^text\/html/);
  await shell(page, "unknown");
  assert.equal(await page.locator("meta#manure-viewer").getAttribute("data-kind"), "unknown");
  await page.getByRole("heading", { name: "No preview for this file type", exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0, "not an error");
  assert.equal(await page.getByRole("button", { name: "Copy raw", exact: true }).isVisible(), false);
  const download = page.getByRole("main").getByRole("link", { name: "Download original", exact: true });
  assert.equal(new URL(await download.getAttribute("href"), page.url()).href, downloadURL("unknown"));
  await downloadEqual(page, "unknown");
  // ... and a client that does not ask for HTML gets the stored bytes at the same URL.
  const bytes = await fetchBytes(page, root("unknown") + "/");
  assert.equal(bytes.status, 200);
  assert.equal(bytes.type, "application/octet-stream");
  assert.deepEqual(Buffer.from(bytes.bytes), expected("unknown"));

  await open(page, "formats", "model.bin");
  await page.getByRole("heading", { name: "No preview for this file type", exact: true }).waitFor();

  await open(page, "formats", "tone.wav");
  assert.equal(await page.locator("meta#manure-viewer").getAttribute("data-kind"), "audio");
  const player = page.locator("main audio");
  await player.waitFor();
  assert.equal(await player.evaluate((el) => el.controls && new URL(el.src).href), rawURL("formats", "tone.wav"));
  await page.locator("#file-facts").filter({ hasText: "0:02" }).waitFor();
  assert.equal(await player.evaluate((el) => Math.round(el.duration)), 2, "the player loaded the file under the viewer policy");
  const part = await page.evaluate(async (url) => {
    const ranged = await fetch(url, { headers: { Range: "bytes=0-3" } });
    return { status: ranged.status, type: ranged.headers.get("content-type"), text: await ranged.text() };
  }, rawURL("formats", "tone.wav"));
  assert.deepEqual(part, { status: 206, type: "audio/wav", text: "RIFF" }, "players seek with byte ranges");

  await open(page, "formats", "broken.mp4");
  assert.equal(await page.locator("meta#manure-viewer").getAttribute("data-kind"), "video");
  await page.getByRole("alert").filter({ hasText: "The browser cannot play this video file." }).waitFor();
  await downloadEqual(page, "formats", "broken.mp4");

  // Direct URLs inside a directory artifact: text types are text for a browser, the listing links every file to its viewer.
  const direct = await fetchBytes(page, root("formats") + "/fix.diff");
  assert.equal(direct.type, "text/plain; charset=utf-8");
  assert.deepEqual(Buffer.from(direct.bytes), expected("formats", "fix.diff"));
  await page.goto(root("formats") + "/", { waitUntil: "domcontentloaded" });
  const base = new URL(root("formats")).pathname.replace(/\/$/, "");
  for (const name of ["Makefile", "model.bin", "tone.wav", "fix.diff"]) {
    assert.equal(await page.getByRole("link", { name, exact: true }).getAttribute("href"), `${base}/__manure/view/${name}`, name);
  }
}, false);

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
  // Embedded diagrams keep Zoom, Actual size and Fit; zooming widens the document, never an inner box.
  const diagram = page.getByRole("figure", { name: "Diagram 1", exact: true });
  const picture = diagram.getByRole("img", { name: "Rendered diagram", exact: true });
  const fitted = (await picture.boundingBox()).width;
  await diagram.getByRole("button", { name: "Zoom in", exact: true }).focus();
  assert.equal(await diagram.getByRole("toolbar", { name: "Diagram zoom", exact: true }).evaluate((el) => getComputedStyle(el).opacity), "1", "diagram tools appear on keyboard focus");
  await page.keyboard.press("Enter");
  await page.waitForFunction(({ fitted }) => document.querySelector("figure.diagram img").getBoundingClientRect().width > fitted, { fitted });
  await diagram.getByRole("button", { name: "Actual size", exact: true }).click();
  assert.equal(await picture.evaluate((img) => Math.round(img.getBoundingClientRect().width) === img.naturalWidth), true, "actual size shows natural pixels");
  assert.deepEqual(await scrollers(page), [], "a zoomed diagram adds no inner scroller");
  await diagram.getByRole("button", { name: "Fit", exact: true }).click();
  assert.ok((await picture.boundingBox()).width <= (await diagram.boundingBox()).width, "Fit returns the diagram to the column");
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
  // At 150 % the page is wider than a narrow window: both edges must stay reachable by document scrolling.
  await page.setViewportSize({ width: 500, height: 500 });
  await page.getByRole("combobox", { name: "Zoom", exact: true }).selectOption("1.5");
  await bothEdgesReachable(page, "main canvas");
  await page.setViewportSize({ width: 1000, height: 800 });
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
  const [tab] = await Promise.all([page.context().waitForEvent("page"), page.locator("#open-button").click()]);
  tab.setDefaultTimeout(15000);
  await tab.getByRole("heading", { name: "Internal viewer handoff", exact: true }).waitFor();
  await shell(tab, "internal");
  await rawEqual(tab, "internal");
  await downloadEqual(tab, "internal");
}, false);

await browser.close();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.some((result) => !result.ok) ? 1 : 0;
