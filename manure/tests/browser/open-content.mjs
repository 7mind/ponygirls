// Controls that open artifact content: the catalogue row's Open and the artifact page's Open artifact are links that
// open the content in a new tab without an opener, by click, Enter, middle-click and by their link address; the
// dashboard tab keeps its URL and state and never scripts a window.
// Runnable alone: `node open-content.mjs < payload.json` (payload from test_browser_open_content.py).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const { chromium } = createRequire(path.join(input.core, "package.json"))("playwright-core");
const browser = await chromium.launch({ executablePath: input.browser, args: ["--no-sandbox", "--no-proxy-server", `--host-resolver-rules=${input.resolver}`] });
const secrets = [input.token, input.loginPassword];
const results = [];
const VISIBILITIES = ["internal", "external", "public"];
// "address": following the link's address in a tab of its own, as "Open link in new tab" or a copied link does.
const ACTIVATIONS = ["click", "Enter", "middle-click", "address"];
const SORTED = "#/artifacts?query=" + encodeURIComponent("sort:name direction:asc");

const signIn = async (page) => {
  await page.locator("[data-account-login] input[name=login]").fill(input.login);
  await page.locator("[data-account-login] input[name=password]").fill(input.loginPassword);
  await page.locator("[data-account-login] button[type=submit]").click();
};
const newContext = async (problems) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(15000);
  // Counts the windows a page opens by script: the dashboard must hold no handle on the tabs it opens.
  await context.addInitScript(() => {
    const open = window.open;
    window.__windowOpens = 0;
    window.open = function (...args) { window.__windowOpens++; return open.apply(this, args); };
  });
  context.on("page", (tab) => {
    tab.on("pageerror", (error) => problems.push("pageerror: " + error.message));
    tab.on("dialog", (dialog) => { problems.push("native dialog: " + dialog.type()); dialog.dismiss().catch(() => {}); });
  });
  return context;
};
const check = async (name, run) => {
  const problems = [];
  const context = await newContext(problems);
  try {
    const page = await context.newPage();
    await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
    await signIn(page);
    await page.getByRole("button", { name: input.userId }).waitFor();
    await run(page, context, problems);
    assert.equal(await page.evaluate(() => window.__windowOpens), 0, "the dashboard opened no window by script");
    assert.deepEqual(problems, []);
    results.push({ name, ok: true });
  } catch (error) {
    let text = error.message.split("\n").slice(0, 8).join(" ");
    for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
    results.push({ name, ok: false, error: text });
  } finally { await context.close(); }
};

const listLoaded = (page) => page.waitForFunction(() => / loaded/.test(document.querySelector("#list-status").textContent));
const showCatalogue = async (page) => {
  await page.evaluate((hash) => { location.hash = hash; }, SORTED);
  await listLoaded(page);
};
const rowOpen = (page, visibility) => page.locator(`#artifact-list > tr[data-artifact-id="${input.artifacts[visibility].id}"] [data-action="open"]`);
const showArtifact = async (page, visibility) => {
  await page.evaluate((id) => { location.hash = "#/artifact/" + id; }, input.artifacts[visibility].id);
  await page.waitForFunction(() => document.querySelector('[data-view="artifact"]')?.dataset.state === "loaded");
  await page.getByRole("heading", { level: 1, name: "open-" + visibility, exact: true }).waitFor();
};
// What the user sees of the dashboard: route, scroll, query, rendered rows, the artifact shown and the focused control.
const dashboardState = (page) => page.evaluate(() => ({
  url: location.href, scrollY: Math.round(scrollY), view: document.getElementById("main").dataset.currentView,
  query: document.getElementById("filter-text").value, status: document.getElementById("list-status").textContent,
  rows: [...document.querySelectorAll("#artifact-list > tr")].map((row) => row.dataset.artifactId),
  artifact: document.getElementById("detail-name").textContent,
  focus: document.activeElement.dataset.action || document.activeElement.id || document.activeElement.tagName,
}));
const shows = {
  internal: (tab) => tab.getByRole("heading", { name: "Internal content", exact: true }).waitFor(),
  external: (tab) => tab.getByRole("heading", { name: "Protected artifact", exact: true }).waitFor(),
  public: (tab) => tab.getByRole("heading", { name: "Public content", exact: true }).waitFor(),
};
const grantPosts = (requests) => requests.filter((request) => request.method() === "POST" && request.url().endsWith("/__manure/grant"))
  .map((request) => new URLSearchParams(request.postData() || "").get("grant"));

// Activates the control and checks the one new tab it leads to; the tab is closed afterwards.
async function opensInNewTab(page, context, control, visibility, activation) {
  await control.focus();
  const before = await dashboardState(page);
  const href = await control.evaluate((link) => link.href);
  const content = input.artifacts[visibility].url.replace(/\/$/, "");
  const requests = [];
  const record = (request) => requests.push(request);
  context.on("request", record);
  let tab;
  if (activation === "address") {
    tab = await context.newPage();
    await tab.goto(href, { waitUntil: "commit" });
  } else {
    [tab] = await Promise.all([context.waitForEvent("page"), activation === "click" ? control.click()
      : activation === "middle-click" ? control.click({ button: "middle" }) : page.keyboard.press("Enter")]);
  }
  await shows[visibility](tab);
  context.off("request", record);
  const what = `${visibility} by ${activation}`;
  assert.equal(tab.url().startsWith(content), true, what + ": the tab shows that artifact's content, not " + tab.url());
  assert.equal(await tab.evaluate(() => window.opener === null), true, what + ": the content tab has no opener");
  assert.equal(context.pages().length, 2, what + ": exactly one new tab");
  assert.deepEqual(await dashboardState(page), before, what + ": the dashboard tab stays where it was");
  const grants = grantPosts(requests);
  assert.equal(grants.length, visibility === "internal" ? 1 : 0, what + ": one single-use grant for internal content, none otherwise");
  assert.equal(requests.some((request) => grants.some((grant) => request.url().includes(grant))), false, what + ": the grant travels in a POST body only");
  // A middle-clicked tab starts loading before the driver attaches to it, so its first request is not observable.
  if (activation === "click" || activation === "Enter") {
    const first = requests.find((request) => request.isNavigationRequest());
    assert.equal(first.url(), href.split("#")[0], what + ": the tab follows the link");
    assert.equal(await first.headerValue("referer"), null, what + ": the link sends no Referer");
  }
  await tab.close();
}

await check("catalogue Open opens each artifact's content in a new tab; the list stays", async (page, context) => {
  await showCatalogue(page);
  for (const visibility of VISIBILITIES) {
    const control = rowOpen(page, visibility);
    for (const activation of ACTIVATIONS) await opensInNewTab(page, context, control, visibility, activation);
    assert.equal(await page.locator(`#artifact-list > tr[data-artifact-id="${input.artifacts[visibility].id}"]`)
      .getByRole("link", { name: "Open (opens in a new tab)", exact: true }).count(), 1, "the row control is a link that says it opens a new tab");
  }
});

await check("artifact page Open artifact opens the content in a new tab; the page stays", async (page, context) => {
  for (const visibility of VISIBILITIES) {
    await showArtifact(page, visibility);
    const control = page.locator("#open-button");
    for (const activation of ACTIVATIONS) await opensInNewTab(page, context, control, visibility, activation);
    assert.equal(await page.getByRole("link", { name: "Open artifact (opens in a new tab)", exact: true }).count(), 1,
      "the page control is a link that says it opens a new tab");
  }
});

await check("an internal Open reports a refused grant in its tab; a signed-out tab signs in before the hand-off", async (page, context, problems) => {
  await showCatalogue(page);
  const control = rowOpen(page, "internal");
  const href = await control.evaluate((link) => link.href);
  await context.route("**/api/current", (route) => {
    const body = route.request().postData() || "";
    if (!body.includes('"CreateGrant"')) return route.continue();
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ requestId: JSON.parse(body).requestId,
      result: { Error: { failure: { code: "Unavailable", message: "controlled fixture", retryAfterSeconds: 1 } } } }) });
  });
  await control.focus();
  const before = await dashboardState(page);
  const [tab] = await Promise.all([context.waitForEvent("page"), control.click()]);
  await tab.getByRole("alert").filter({ hasText: "Open failed (" }).waitFor();
  assert.equal(new URL(tab.url()).hash, "#/artifact/" + input.artifacts.internal.id, "the tab stays on the artifact page; Reload does not retry");
  assert.equal(context.pages().length, 2);
  assert.deepEqual(await dashboardState(page), before);
  await context.unroute("**/api/current");
  const signedOut = await newContext(problems);
  try {
    const fresh = await signedOut.newPage();
    await fresh.goto(href, { waitUntil: "domcontentloaded" });
    await signIn(fresh);
    await shows.internal(fresh);
    assert.equal(fresh.url().startsWith(input.artifacts.internal.url.replace(/\/$/, "")), true);
  } finally { await signedOut.close(); }
});

await browser.close();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.some((result) => !result.ok) ? 1 : 0;
