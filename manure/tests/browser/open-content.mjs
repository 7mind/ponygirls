// Controls that open artifact content: the catalogue row's Open and the artifact page's Open artifact open the
// content in a new tab without an opener, by click and by keyboard; the dashboard tab keeps its URL and state.
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
const SORTED = "#/artifacts?query=" + encodeURIComponent("sort:name direction:asc");

const check = async (name, run) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  context.setDefaultTimeout(15000);
  const problems = [];
  context.on("page", (tab) => {
    tab.on("pageerror", (error) => problems.push("pageerror: " + error.message));
    tab.on("dialog", (dialog) => { problems.push("native dialog: " + dialog.type()); dialog.dismiss().catch(() => {}); });
  });
  try {
    const page = await context.newPage();
    await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
    await page.locator("[data-account-login] input[name=login]").fill(input.login);
    await page.locator("[data-account-login] input[name=password]").fill(input.loginPassword);
    await page.locator("[data-account-login] button[type=submit]").click();
    await page.getByRole("button", { name: input.userId }).waitFor();
    await run(page, context);
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

// Activates the control (click or Enter) and checks the one new tab it opens; the tab is closed afterwards.
async function opensInNewTab(page, context, control, visibility, activation) {
  await control.focus();
  const before = await dashboardState(page);
  const content = input.artifacts[visibility].url.replace(/\/$/, "");
  const navigations = [];
  const record = (request) => { if (request.isNavigationRequest() && request.url().startsWith(content)) navigations.push(request); };
  context.on("request", record);
  const [tab] = await Promise.all([context.waitForEvent("page"),
    activation === "click" ? control.click() : page.keyboard.press("Enter")]);
  await shows[visibility](tab);
  context.off("request", record);
  const what = `${visibility} by ${activation}`;
  assert.equal(tab.url().startsWith(content), true, what + ": the tab shows that artifact's content, not " + tab.url());
  assert.equal(await tab.evaluate(() => window.opener === null), true, what + ": the content tab has no opener");
  assert.equal(context.pages().length, 2, what + ": exactly one new tab");
  assert.deepEqual(await dashboardState(page), before, what + ": the dashboard tab stays where it was");
  if (visibility !== "internal") {
    assert.notEqual(navigations.length, 0, what + ": the content navigation was observed");
    assert.equal(await navigations[0].headerValue("referer"), null, what + ": the content request carries no Referer");
  }
  await tab.close();
}

await check("catalogue Open opens each artifact's content in a new tab; the list stays", async (page, context) => {
  await showCatalogue(page);
  for (const visibility of VISIBILITIES) {
    const control = rowOpen(page, visibility);
    for (const activation of ["click", "keyboard"]) await opensInNewTab(page, context, control, visibility, activation);
    assert.equal(await page.locator(`#artifact-list > tr[data-artifact-id="${input.artifacts[visibility].id}"]`)
      .getByRole("link", { name: "Open (opens in a new tab)", exact: true }).count(), 1, "the row control is a link that says it opens a new tab");
  }
});

await check("artifact page Open artifact opens the content in a new tab; the page stays", async (page, context) => {
  for (const visibility of VISIBILITIES) {
    await showArtifact(page, visibility);
    const control = page.locator("#open-button");
    for (const activation of ["click", "keyboard"]) await opensInNewTab(page, context, control, visibility, activation);
    assert.equal(await page.getByRole("link", { name: "Open artifact (opens in a new tab)", exact: true }).count(), 1,
      "the page control is a link that says it opens a new tab");
  }
});

await check("the internal grant hand-off opens its tab before the grant arrives and closes it when the grant fails", async (page, context) => {
  await showCatalogue(page);
  const control = rowOpen(page, "internal");
  let held = null, failNext = false;
  const grantHeld = new Promise((resolve) => { held = resolve; });
  let release = null;
  const released = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/current", async (route) => {
    const body = route.request().postData() || "";
    if (!body.includes('"CreateGrant"')) return route.continue();
    if (failNext) {
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ requestId: JSON.parse(body).requestId,
        result: { Error: { failure: { code: "Unavailable", message: "controlled fixture", retryAfterSeconds: 1 } } } }) });
    }
    held();
    await released;
    return route.continue();
  });
  const [tab] = await Promise.all([context.waitForEvent("page"), control.click()]);
  await grantHeld;
  assert.equal(context.pages().length, 2, "the tab is open while the grant request is still unanswered");
  release();
  await shows.internal(tab);
  await tab.close();
  failNext = true;
  const before = await dashboardState(page);
  const [failed] = await Promise.all([context.waitForEvent("page"), control.click()]);
  if (!failed.isClosed()) await failed.waitForEvent("close");
  await page.getByRole("alert").filter({ hasText: "Open failed (" }).waitFor();
  assert.equal(context.pages().length, 1, "the failed hand-off leaves no blank tab behind");
  assert.equal((await dashboardState(page)).url, before.url);
});

await browser.close();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.some((result) => !result.ok) ? 1 : 0;
