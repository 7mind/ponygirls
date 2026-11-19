// Connection indicator of the dashboard masthead (UX-M6) over the real API: the pill tells whether the dashboard can
// reach the server, from the outcome of every request it makes and from a light heartbeat while it is idle.
// Runnable alone: `node connection.mjs < payload.json` (payload from test_browser_connection.py).
// Time is the browser's fake clock (page.clock) with the production intervals; nothing waits in real time.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { CONNECTION } from "../../web/dashboard/common.js";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const { chromium } = createRequire(path.join(input.core, "package.json"))("playwright-core");
const browser = await chromium.launch({ executablePath: input.browser, args: ["--no-sandbox", "--no-proxy-server", `--host-resolver-rules=${input.resolver}`] });
const results = [];
const HEARTBEAT_COMMAND = "Version";
const SENTINEL_PATH = "/favicon.svg";
const WIDE = { width: 1440, height: 900 }, NARROW = { width: 390, height: 844 };

const pill = (page, name) => page.getByRole("button", { name: "Connection: " + name, exact: true });
const refresh = (page) => page.getByRole("button", { name: "Refresh", exact: true });
const announcements = (page) => page.evaluate(() => window.__announced);
const commandOf = (body) => { try { return Object.keys(JSON.parse(body).command)[0]; } catch (_) { return null; } };

async function signIn(page) {
  await page.locator("[data-account-login] input[name=login]").fill(input.login);
  await page.locator("[data-account-login] input[name=password]").fill(input.loginPassword);
  await page.locator("[data-account-login] button[type=submit]").click();
  await page.getByRole("button", { name: input.userId }).waitFor();
}
// Reloads the catalogue (a real API request through the dashboard) and waits until it settled.
async function reload(page) {
  await refresh(page).click();
  await page.waitForFunction(() => /loaded|No matches|Not loaded/.test(document.querySelector("#list-status").textContent) && !/Loading/.test(document.querySelector("#list-status").textContent));
}
// Freezes the fake clock; timers fire only in runFor(). A reload then makes the next heartbeat due exactly one idle interval later.
async function freeze(page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1000);
  await reload(page);
}
// A request of our own after everything the page sent so far: once it is logged, earlier requests are in the log too.
const flush = (page) => Promise.all([page.waitForRequest((request) => new URL(request.url()).pathname === SENTINEL_PATH),
  page.evaluate((target) => fetch(target, { cache: "no-store" }), SENTINEL_PATH)]);
const isHeartbeat = (request) => request.method() === "POST" && commandOf(request.postData()) === HEARTBEAT_COMMAND;
// Resolves with the next heartbeat the page sends; start it before the action that causes it.
const nextHeartbeat = (page) => page.waitForRequest(isHeartbeat);
const heartbeats = (log, from) => log.slice(from).filter((entry) => entry.command === HEARTBEAT_COMMAND);

const check = async (name, run, viewport = WIDE) => {
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const problems = [], log = [], headers = [];
    page.on("pageerror", (error) => problems.push("pageerror: " + error.message));
    page.on("dialog", (dialog) => { problems.push("native dialog: " + dialog.type()); dialog.dismiss().catch(() => {}); });
    page.on("request", (request) => {
      const entry = { path: new URL(request.url()).pathname, method: request.method(), command: request.method() === "POST" ? commandOf(request.postData()) : null };
      log.push(entry);
      if (entry.command === HEARTBEAT_COMMAND) headers.push(request.allHeaders().then((all) => ({ ...entry, cookie: all.cookie })));
    });
    await page.clock.install();
    await run(page, log);
    assert.deepEqual(problems, []);
    // Every heartbeat is the unauthenticated Version command on the one API path: no credentials, no login/unlock/mutation route.
    for (const heartbeat of await Promise.all(headers)) {
      assert.equal(heartbeat.cookie === undefined, true, "a heartbeat carries no credentials");
      assert.equal(heartbeat.path + " " + heartbeat.method, "/api/current POST");
    }
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message.split("\n").slice(0, 8).join(" ").split(input.loginPassword).join("[REDACTED]") });
  } finally { await context.close(); }
};

await check("the pill is Live once the server has answered, also on the sign-in page where the answer is a 401; its details open by keyboard and Check now probes", async (page, log) => {
  await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
  await page.locator("[data-account-login]").waitFor();
  await pill(page, "Live").waitFor();
  assert.equal(await pill(page, "Live").getAttribute("data-state"), "live");
  assert.equal(await pill(page, "Live").innerText(), "Live");
  assert.equal(await page.locator("#connection-announcement").textContent(), "", "the first answer is not announced");
  await signIn(page);
  await pill(page, "Live").waitFor();
  await pill(page, "Live").focus();
  await page.keyboard.press("Enter");
  const details = page.getByRole("region", { name: "Connection details" });
  await details.waitFor();
  assert.equal(await pill(page, "Live").getAttribute("aria-expanded"), "true");
  const before = log.length;
  const [answer] = await Promise.all([page.waitForResponse((response) => isHeartbeat(response.request())), details.getByRole("button", { name: "Check now", exact: true }).click()]);
  assert.equal(heartbeats(log, before).length, 1, "Check now sends one heartbeat");
  assert.equal(answer.status(), 200);
  assert.equal(typeof (await answer.json()).result.Version.versions.current, "string", "the server answers a heartbeat with its version");
  await page.keyboard.press("Escape");
  await details.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Connection: Live", "Escape returns focus to the pill");
});

await check("a failing request turns the pill Offline at once; a gateway page counts, an application error does not; the next answer restores it; each change is announced once", async (page) => {
  await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
  await page.locator("[data-account-login]").waitFor();
  await signIn(page);
  await pill(page, "Live").waitFor();
  await page.evaluate(() => {
    window.__announced = [];
    new MutationObserver(() => window.__announced.push(document.querySelector("#connection-announcement").textContent))
      .observe(document.querySelector("#connection-announcement"), { childList: true, characterData: true, subtree: true });
  });
  const failWith = (respond) => page.route("**/api/current", respond);
  const echo = (route) => JSON.parse(route.request().postData()).requestId;
  // The application answered 503 in its own envelope: the server is reachable.
  await failWith((route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ requestId: echo(route), result: { Error: { failure: { code: "Unavailable", message: "controlled", retryAfterSeconds: 1 } } } }) }));
  await refresh(page).click();
  await page.getByText("The request failed (unavailable)").waitFor();
  assert.equal(await pill(page, "Live").count(), 1, "an application error is an answer");
  await page.unroute("**/api/current");
  // A gateway error page is not.
  await failWith((route) => route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad Gateway</h1>" }));
  await refresh(page).click();
  await pill(page, "Offline").waitFor();
  assert.equal(await pill(page, "Offline").getAttribute("data-state"), "offline");
  await page.unroute("**/api/current");
  // Neither is a refused connection; staying offline is not announced again.
  await failWith((route) => route.abort("connectionrefused"));
  await refresh(page).click();
  await page.getByText("The request failed (network-error)").waitFor();
  assert.equal(await pill(page, "Offline").count(), 1);
  await page.unroute("**/api/current");
  await reload(page);
  await pill(page, "Live").waitFor();
  const announced = await announcements(page);
  assert.equal(announced.length, 2, JSON.stringify(announced));
  assert.match(announced[0], /lost/i);
  assert.match(announced[1], /restored/i);
});

await check("an idle tab notices an unanswered server within the idle interval plus the probe timeout, keeps probing, and recovers on the next answer", async (page, log) => {
  await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
  await page.locator("[data-account-login]").waitFor();
  await signIn(page);
  await pill(page, "Live").waitFor();
  await freeze(page);
  await page.route("**/api/current", () => { /* the server never answers */ });
  const mark = log.length;
  await page.clock.runFor(CONNECTION.IDLE_CHECK_MS - 1);
  await flush(page);
  assert.equal(heartbeats(log, mark).length, 0, "no heartbeat before the idle interval is over");
  assert.equal(await pill(page, "Live").count(), 1);
  await Promise.all([nextHeartbeat(page), page.clock.runFor(1)]);
  await page.clock.runFor(CONNECTION.PROBE_TIMEOUT_MS - 1);
  await flush(page);
  assert.equal(await pill(page, "Live").count(), 1, "no verdict before the probe timeout");
  await page.clock.runFor(1);
  await pill(page, "Offline").waitFor();
  // Retries start soon and back off, but never stop.
  await Promise.all([nextHeartbeat(page), page.clock.runFor(CONNECTION.RETRY_FIRST_MS)]);
  await page.clock.runFor(CONNECTION.PROBE_TIMEOUT_MS);
  await flush(page);
  assert.equal(heartbeats(log, mark).length, 2);
  assert.equal(await pill(page, "Offline").count(), 1);
  await page.clock.runFor(2 * CONNECTION.RETRY_FIRST_MS - 1);
  await flush(page);
  assert.equal(heartbeats(log, mark).length, 2, "the second retry waits twice as long");
  await page.unroute("**/api/current");
  await Promise.all([nextHeartbeat(page), page.clock.runFor(1)]);
  await pill(page, "Live").waitFor();
});

await check("a hidden tab sends no heartbeat; showing it again, or the browser coming online, probes at once", async (page, log) => {
  await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
  await page.locator("[data-account-login]").waitFor();
  await signIn(page);
  await pill(page, "Live").waitFor();
  await freeze(page);
  const visibility = (state) => page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
  await visibility("hidden");
  const mark = log.length;
  await page.clock.runFor(10 * CONNECTION.IDLE_CHECK_MS);
  await flush(page);
  assert.equal(heartbeats(log, mark).length, 0, "a hidden tab is silent");
  await Promise.all([nextHeartbeat(page), visibility("visible")]);
  await Promise.all([nextHeartbeat(page), page.evaluate(() => window.dispatchEvent(new Event("online")))]);
  assert.equal(heartbeats(log, mark).length, 2);
  await pill(page, "Live").waitFor();
});

// The pill keeps its width (and so does everything beside it) whichever state it shows; the masthead fits the window.
// Only the masthead is measured: the page below it has its own widths (the empty state's button row is 1 px too wide at 390 px with some fonts).
const stable = (viewport) => async (page) => {
  const held = [];
  let holding = true;
  await page.route("**/api/current", (route) => { if (holding) held.push(route); else route.continue(); });
  await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
  await pill(page, "Connecting").waitFor();
  assert.equal(await pill(page, "Connecting").getAttribute("data-state"), "connecting", "nothing is Live before the first answer");
  const measure = () => page.evaluate(() => {
    const box = (node) => { const { x, width } = node.getBoundingClientRect(); return { x, width }; };
    const masthead = document.querySelector(".masthead");
    return { pill: box(document.querySelector("#connection-button")), theme: box(document.querySelector("#theme-button")), height: masthead.getBoundingClientRect().height,
      mastheadOverflow: masthead.scrollWidth - masthead.clientWidth,
      right: Math.max(...[...masthead.querySelectorAll(".masthead-end > *")].filter((node) => node.getBoundingClientRect().width > 0).map((node) => node.getBoundingClientRect().right)) };
  });
  const connecting = await measure();
  holding = false;
  await Promise.all(held.map((route) => route.continue()));
  await page.locator("[data-account-login]").waitFor();
  await signIn(page);
  await pill(page, "Live").waitFor();
  const live = await measure();
  await page.route("**/api/current", (route) => route.abort("connectionrefused"));
  await reload(page);
  await pill(page, "Offline").waitFor();
  const offline = await measure();
  for (const state of [connecting, live, offline]) {
    assert.ok(Math.abs(state.pill.width - connecting.pill.width) < 0.01, `pill width ${state.pill.width} vs ${connecting.pill.width}`);
    assert.equal(state.height, connecting.height, "the masthead keeps its height");
    assert.ok(state.mastheadOverflow <= 0, "the masthead does not overflow: " + JSON.stringify(state));
    assert.ok(state.right <= viewport.width, "the masthead fits the window: " + JSON.stringify(state));
  }
  assert.ok(Math.abs(offline.theme.x - live.theme.x) < 0.01, "the theme button does not move");
  assert.ok(Math.abs(offline.pill.x - live.pill.x) < 0.01, "the pill does not move");
};
await check("the pill keeps its width across Connecting, Live and Offline at 1440 px", stable(WIDE));
await check("the pill keeps its width across Connecting, Live and Offline at 390 px and the masthead fits", stable(NARROW), NARROW);

await browser.close();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
