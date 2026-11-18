// Artifact page checks of the dashboard redesign (spec §3.3, §8 items 1, 2, 4, 7, 9) over the real API.
// Runnable alone: `node artifact.mjs < payload.json` (payload from test_browser_artifact.py).
// Fault injection is test-only; credentials and passwords arrive over stdin and never appear in the output.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const { chromium } = createRequire(path.join(input.core, "package.json"))("playwright-core");
const browser = await chromium.launch({ executablePath: input.browser, args: ["--no-sandbox", "--no-proxy-server", `--host-resolver-rules=${input.resolver}`] });
const secrets = [input.token, input.loginPassword, input.protectedPassword, input.rotatingPassword];
const results = [];

const check = async (name, run) => {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: input.base });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const problems = [];
    const urls = [];
    page.on("pageerror", (error) => problems.push("pageerror: " + error.message));
    page.on("console", (message) => { if (/Content Security Policy/i.test(message.text())) problems.push("console: " + message.text()); });
    page.on("dialog", (dialog) => { problems.push("native dialog: " + dialog.type()); dialog.dismiss().catch(() => {}); });
    page.on("request", (request) => urls.push(request.url()));
    await page.addInitScript(() => {
      // commands: names of the API commands sent; failPatch: answer the next PatchArtifact with 503; holdInfo: hold a GetArtifact reply.
      window.__artifact = { commands: [], patches: [], failPatch: false, holdInfo: null, releaseInfo: null };
      const original = window.fetch.bind(window);
      window.fetch = (url, options) => {
        const state = window.__artifact;
        let envelope = null;
        try { envelope = JSON.parse(options?.body || "null"); } catch (_) { envelope = null; }
        const command = new URL(String(url), location.href).pathname === "/api/current" ? envelope?.command ?? null : null;
        if (command !== null) state.commands.push(Object.keys(command)[0]);
        if (command?.PatchArtifact) {
          state.patches.push(command.PatchArtifact);
          if (state.failPatch) {
            state.failPatch = false;
            return Promise.resolve(new Response(JSON.stringify({ requestId: envelope.requestId, result: { Error: { failure: { code: "Unavailable", message: "controlled fixture", retryAfterSeconds: 1 } } } }), { status: 503, headers: { "Content-Type": "application/json" } }));
          }
        }
        const response = original(url, options);
        if (command?.GetArtifact && command.GetArtifact.artifactId === state.holdInfo) {
          state.holdInfo = null;
          return response.then((res) => new Promise((resolve) => { state.releaseInfo = () => resolve(res); }));
        }
        return response;
      };
    });
    await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
    await signIn(page);
    await run(page, context);
    assert.deepEqual(problems, []);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => !key.startsWith("ui.")).length + Object.keys(sessionStorage).length), 0, "nothing but UI preferences in web storage");
    for (const secret of secrets) assert.equal(urls.some((url) => url.includes(secret)), false, "a secret travelled in a request URL");
    results.push({ name, ok: true });
  } catch (error) {
    let text = error.message.split("\n").slice(0, 8).join(" ");
    for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
    results.push({ name, ok: false, error: text });
  } finally { await context.close(); }
};

async function signIn(page) {
  await page.locator("[data-account-login] input[name=login]").fill(input.login);
  await page.locator("[data-account-login] input[name=password]").fill(input.loginPassword);
  await page.locator("[data-account-login] button[type=submit]").click();
  await page.getByRole("button", { name: input.userId }).waitFor();
  await counterLoaded(page);
}
const signOut = async (page) => {
  await page.getByRole("button", { name: input.userId }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.locator("[data-account-login]").waitFor();
};
const counterLoaded = (page) => page.waitForFunction(() => / loaded| hits · |No matches/.test(document.querySelector("#list-status").textContent));
const artifactPage = (page) => page.locator('[data-view="artifact"]');
const pageState = (page, state) => page.waitForFunction((value) => document.querySelector('[data-view="artifact"]')?.dataset.state === value, state);
// Opens an artifact from the signed-in catalogue (a pushed history entry) and waits for its metadata.
const open = async (page, id, name) => {
  await page.evaluate((target) => { location.hash = "#/artifact/" + target; }, id);
  await pageState(page, "loaded");
  await page.getByRole("heading", { level: 1, name, exact: true }).waitFor();
};
const manifest = (page) => page.getByRole("table", { name: "Content manifest" }).locator("tbody > tr");
const rowCount = (page, n) => page.waitForFunction((count) => document.querySelectorAll('[data-list="manifest"] > tr').length === count, n);
const layout = (page, label) => page.getByRole("group", { name: "Manifest layout" }).getByRole("button", { name: label, exact: true });
const mode = (page, label) => page.getByRole("group", { name: "Access mode" }).getByRole("button", { name: label, exact: true });
const password = (page) => page.locator('[data-secret="external-password"]');
const commands = (page, name) => page.evaluate((command) => window.__artifact.commands.filter((sent) => sent === command).length, name);
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const api = async (page, command) => {
  const response = await page.request.post(input.base + "/api/current", { headers: { Origin: input.base },
    data: { requestId: crypto.randomUUID(), apiVersion: "1.0.0", command } });
  return { status: response.status(), body: await response.json() };
};
const info = async (page, id) => {
  const { status, body } = await api(page, { GetArtifact: { artifactId: id } });
  assert.equal(status, 200);
  return body.result.ArtifactInfo.artifact;
};
// Spec §8.1: the document is the only vertical scroller of a model-A page.
const innerScrollers = (page) => page.evaluate(() => [...document.querySelectorAll("body *")].filter((node) => {
  const style = getComputedStyle(node);
  return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1 && node.getBoundingClientRect().height > 0;
}).length);

await check("the manifest is a tree with drill-down and a filtered flat list; downloads are attachments", async (page) => {
  await open(page, input.bundle, "artifact-bundle");
  await rowCount(page, 4);
  assert.deepEqual(await manifest(page).evaluateAll((rows) => rows.map((row) => row.dataset.path)), ["empty", "nested", "index.html", "note.txt"]);
  await page.getByText(/^This folder: 2 folders · 2 files · \d+ B$/).waitFor();
  await page.getByRole("link", { name: "nested/", exact: true }).click();
  await rowCount(page, 2);
  assert.match(page.url(), /[?&]path=nested(&|$)/, "the open folder is in the address");
  assert.equal(await page.getByRole("navigation", { name: "Folder" }).locator('[aria-current="location"]').textContent(), "nested");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download nested/über file.txt", exact: true }).click()]);
  assert.equal(download.suggestedFilename(), "über file.txt");
  assert.equal((await fs.readFile(await download.path())).equals(Buffer.from("unicode download")), true);
  await page.getByRole("searchbox", { name: "Filter paths" }).fill("ÜBER");
  assert.equal(await layout(page, "Flat list").getAttribute("aria-pressed"), "true", "filtering shows the flat list");
  await rowCount(page, 1);
  await page.getByText("1 of 4 paths match", { exact: true }).waitFor();
  await layout(page, "Tree").click();
  assert.equal(await page.getByRole("searchbox", { name: "Filter paths" }).inputValue(), "", "the tree is never filtered");
  await rowCount(page, 2);
  await layout(page, "Flat list").click();
  await rowCount(page, 4);
  await page.getByText("End of manifest · 4 paths", { exact: true }).waitFor();
});

await check("a 161-file manifest scrolls the document only; header, table header and rail stick; the folder survives reload", async (page) => {
  await open(page, input.big, "checkpoint-shards");
  await layout(page, "Flat list").click();
  await rowCount(page, input.files);
  await page.getByText(`End of manifest · ${input.files} paths`, { exact: true }).waitFor();
  assert.equal(await innerScrollers(page), 0, "no inner scroller");
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight), "the document scrolls");
  await page.evaluate(() => window.scrollTo(0, 1500));
  await settle(page);
  const geometry = await page.evaluate(() => {
    const top = (node) => node.getBoundingClientRect().top;
    const bar = document.querySelector("#detail-viewbar");
    const rail = document.querySelector('[data-view="artifact"] aside');
    return { masthead: document.querySelector("body > header").getBoundingClientRect().bottom, bar: top(bar), barBottom: bar.getBoundingClientRect().bottom,
      header: top(document.querySelector('[data-view="artifact"] table thead th')), rail: top(rail), railSticky: parseFloat(getComputedStyle(rail).top) };
  });
  assert.ok(Math.abs(geometry.bar - geometry.masthead) <= 1, `artifact header sticks under the masthead (${geometry.bar} vs ${geometry.masthead})`);
  assert.ok(Math.abs(geometry.header - geometry.barBottom) <= 1, `table header sticks under the artifact header (${geometry.header} vs ${geometry.barBottom})`);
  assert.ok(Math.abs(geometry.rail - geometry.railSticky) <= 1, `the rail sticks (${geometry.rail} vs ${geometry.railSticky})`);
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), true, `no horizontal overflow at ${width}`);
    assert.equal(await innerScrollers(page), 0, `no inner scroller at ${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await layout(page, "Tree").click();
  await rowCount(page, 17);
  await page.getByRole("link", { name: "shard-03/", exact: true }).click();
  await rowCount(page, 11);
  await page.reload({ waitUntil: "domcontentloaded" });
  await pageState(page, "loaded");
  await rowCount(page, 11);
  assert.equal(await page.getByRole("navigation", { name: "Folder" }).locator('[aria-current="location"]').textContent(), "shard-03");
  await page.getByRole("link", { name: "..", exact: true }).click();
  await rowCount(page, 17);
  await page.goBack();
  await page.locator('[data-view="catalogue"]').waitFor({ state: "visible" });
  await counterLoaded(page);
});

await check("a new artifact target cannot retain old metadata, manifest or destructive actions", async (page) => {
  await open(page, input.bundle, "artifact-bundle");
  await rowCount(page, 4);
  await page.evaluate((id) => { window.__artifact.holdInfo = id; location.hash = "#/artifact/" + id; }, input.protected);
  await page.waitForFunction(() => window.__artifact.releaseInfo !== null);
  await pageState(page, "loading");
  // While the next artifact loads, no action of the previous one is offered (hidden and disabled).
  for (const action of ["Delete artifact…", "Open artifact", "Copy link", "Rename", "Save access mode"]) {
    assert.equal(await page.getByRole("button", { name: action }).count(), 0, action + " waits for the active artifact");
  }
  assert.equal(await manifest(page).count(), 0);
  assert.equal(await page.getByRole("heading", { level: 1, name: "artifact-bundle" }).count(), 0);
  await page.evaluate(() => window.__artifact.releaseInfo());
  await page.getByRole("heading", { level: 1, name: "artifact-protected", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Delete artifact…" }).isEnabled(), true);
});

await check("an unfinished upload shows its received bytes; access, edits and downloads wait for it", async (page) => {
  await open(page, input.uploading, "artifact-uploading");
  const progress = page.getByRole("progressbar", { name: "Upload progress" });
  await progress.waitFor();
  assert.equal(await progress.getAttribute("aria-valuenow"), "50");
  await page.getByText("4 B of 8 B received.", { exact: true }).waitFor();
  await page.getByText("Access can be changed once the upload is ready.", { exact: true }).waitFor();
  assert.equal(await mode(page, "Internal").isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Open artifact", exact: true }).isDisabled(), true);
  for (const action of ["Save access mode", "Rename", "Change expiry"]) {
    assert.equal(await page.getByRole("button", { name: action, exact: true }).count(), 0, action + " waits for the finished upload");
  }
  await rowCount(page, 2);
  assert.equal(await page.getByRole("link", { name: /^Download / }).count(), 0, "declared paths have no download yet");
});

await check("a missing artifact is a page state; a denied retrieval hit leaves no evidence behind", async (page) => {
  await page.goto(input.base + "/#/artifact/" + "0".repeat(32), { waitUntil: "domcontentloaded" });
  await pageState(page, "not-found");
  await page.getByRole("heading", { name: "Artifact not found", exact: true }).waitFor();
  assert.equal(await page.locator('[data-view="catalogue"]').isVisible(), false);
  await page.locator("#detail-missing").getByRole("link", { name: "Back to artifacts", exact: true }).click();
  await page.locator('[data-view="catalogue"]').waitFor({ state: "visible" });
  await counterLoaded(page);
  await page.getByRole("combobox", { name: "Search artifacts" }).fill("mode:lexical artifact-denied");
  await page.getByRole("combobox", { name: "Search artifacts" }).press("Enter");
  await page.waitForFunction(() => document.querySelector("#retrieval-results").textContent.includes("artifact-denied"));
  assert.equal((await api(page, { DeleteArtifact: { artifactId: input.denied } })).status, 200);
  await page.locator(`#retrieval-results a[data-action=details][data-artifact-id="${input.denied}"]`).click();
  await pageState(page, "not-found");
  await page.locator("#detail-missing").getByRole("link", { name: "Back to artifacts", exact: true }).click();
  await page.locator('[data-view="catalogue"]').waitFor({ state: "visible" });
  await settle(page);
  assert.equal(await page.locator("#retrieval-results").textContent(), "", "the denied artifact and its evidence are not shown again");
});

await check("the external password is masked; Reveal and Copy read it without rotating; Rotate asks first; it clears on leaving", async (page) => {
  await open(page, input.rotating, "artifact-rotating");
  assert.equal(await password(page).textContent(), "", "masked until revealed");
  await page.getByRole("button", { name: "Reveal password", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Hide password"]') !== null);
  assert.equal(await password(page).textContent(), input.rotatingPassword);
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  assert.equal(await password(page).textContent(), "");
  await page.getByRole("button", { name: "Copy password", exact: true }).click();
  await page.getByText("External password copied", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), input.rotatingPassword);
  assert.equal(await password(page).textContent(), "", "copying does not reveal");
  const confirm = page.getByRole("dialog", { name: "Rotate the external password?" });
  await page.getByRole("button", { name: "Rotate password…", exact: true }).click();
  await confirm.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Cancel");
  await page.keyboard.press("Escape");
  await confirm.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Rotate password…", exact: true }).click();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await confirm.waitFor({ state: "detached" });
  await settle(page);
  assert.equal(await commands(page, "RotateExternalPassword"), 0, "Escape and Cancel rotate nothing");
  await page.getByRole("button", { name: "Rotate password…", exact: true }).click();
  await confirm.getByRole("button", { name: "Rotate password", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Hide password"]') !== null);
  const rotated = await password(page).textContent();
  secrets.push(rotated);
  assert.match(rotated, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(rotated, input.rotatingPassword);
  assert.equal(await commands(page, "RotateExternalPassword"), 1, "only the confirmation rotates");
  assert.equal(await commands(page, "GetExternalPassword"), 2, "Reveal and Copy each read once");
  await page.locator("#detail-viewbar").getByRole("link", { name: "Back to artifacts", exact: true }).click();
  await page.locator('[data-view="catalogue"]').waitFor({ state: "visible" });
  assert.equal(await password(page).textContent(), "", "leaving clears the password");
  await open(page, input.rotating, "artifact-rotating");
  assert.equal(await password(page).textContent(), "");
  await page.getByRole("button", { name: "Reveal password", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Hide password"]') !== null);
  assert.equal(await password(page).textContent(), rotated);
  await signOut(page);
  assert.equal(await password(page).textContent(), "", "signing out clears the password");
});

await check("access changes wait for the confirmation; a failed change shows the server state", async (page) => {
  await open(page, input.access, "artifact-access");
  const save = page.getByRole("button", { name: "Save access mode", exact: true });
  assert.equal(await save.isEnabled(), false);
  await mode(page, "Public").click();
  await page.getByText("Unsaved change", { exact: true }).waitFor();
  assert.equal(await save.isEnabled(), true);
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  assert.equal(await mode(page, "Internal").getAttribute("aria-pressed"), "true");
  assert.equal(await save.isEnabled(), false);
  await mode(page, "External").click();
  const external = page.getByRole("dialog", { name: "Change access to External?" });
  await save.click();
  await external.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Cancel");
  await page.keyboard.press("Escape");
  await external.waitFor({ state: "detached" });
  await save.click();
  await external.getByRole("button", { name: "Cancel", exact: true }).click();
  await external.waitFor({ state: "detached" });
  await settle(page);
  assert.equal(await commands(page, "PatchArtifact"), 0, "nothing is sent without the confirmation");
  await mode(page, "Public").click();
  await save.click();
  await page.getByRole("dialog", { name: "Make this artifact public?" }).getByRole("button", { name: "Make public", exact: true }).click();
  await page.getByText("Access mode saved · Public", { exact: true }).waitFor();
  assert.equal((await info(page, input.access)).visibility, "Public");
  assert.equal(await page.locator('#detail-access [data-access]').getAttribute("data-access"), "public");
  assert.equal(await mode(page, "Public").getAttribute("aria-pressed"), "true");
  await page.evaluate(() => { window.__artifact.failPatch = true; });
  await mode(page, "Internal").click();
  await save.click();
  await page.getByRole("dialog", { name: "Change access to Internal?" }).getByRole("button", { name: "Make internal", exact: true }).click();
  // The danger notice appears once the artifact has been read again after the failure.
  await page.getByRole("alert").filter({ hasText: "Access change could not be confirmed (unavailable)" }).waitFor();
  assert.equal((await info(page, input.access)).visibility, "Public");
  assert.equal(await page.locator('#detail-access [data-access]').getAttribute("data-access"), "public", "the header shows the server state");
  assert.equal(await mode(page, "Public").getAttribute("aria-pressed"), "true", "the control shows the server state");
  assert.equal(await commands(page, "PatchArtifact"), 2);
});

await check("rename and expiry are PatchArtifact edits; Escape and an invalid date send nothing", async (page) => {
  await open(page, input.editable, "artifact-editable");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Artifact name", exact: true });
  assert.equal(await field.inputValue(), "artifact-editable");
  await field.fill("discarded name");
  await field.press("Escape");
  await page.getByRole("heading", { level: 1, name: "artifact-editable", exact: true }).waitFor();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await field.fill("artifact-renamed");
  await field.press("Enter");
  await page.getByRole("heading", { level: 1, name: "artifact-renamed", exact: true }).waitFor();
  assert.equal((await info(page, input.editable)).name, "artifact-renamed");
  await page.getByRole("button", { name: "Change expiry", exact: true }).click();
  await page.getByRole("combobox", { name: "Expires", exact: true }).selectOption("custom");
  await page.getByLabel("Expiry date and time", { exact: true }).fill("2001-01-01T00:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  assert.equal(await page.getByLabel("Expiry date and time", { exact: true }).getAttribute("aria-invalid"), "true");
  await page.getByRole("combobox", { name: "Expires", exact: true }).selectOption("604800");
  const before = Date.now();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Expiry saved", { exact: true }).waitFor();
  const week = Date.parse((await info(page, input.editable)).expiresAt) - before;
  assert.ok(Math.abs(week - 7 * 24 * 3600 * 1000) < 10 * 60 * 1000, "expires in seven days");
  await page.getByRole("button", { name: "Change expiry", exact: true }).click();
  await page.getByRole("combobox", { name: "Expires", exact: true }).selectOption("never");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(() => window.__artifact.patches.length === 3);
  await page.locator("#meta-expires").getByText("Never", { exact: true }).waitFor();
  assert.equal((await info(page, input.editable)).expiresAt, null);
  assert.deepEqual(await page.evaluate(() => window.__artifact.patches.map((patch) => patch.patch)), [
    { name: "artifact-renamed", visibility: null, expiry: { Keep: {} } },
    { name: null, visibility: null, expiry: { Set: { seconds: 604800 } } },
    { name: null, visibility: null, expiry: { Clear: {} } }]);
});

await check("delete confirms in an in-app dialog naming the artifact; a hostile name stays inert text", async (page) => {
  await page.addInitScript(() => { window.confirm = () => { throw new Error("window.confirm used"); }; window.alert = () => { throw new Error("window.alert used"); }; });
  const name = '<img src=x onerror=alert("xss")> artifact-hostile';
  await open(page, input.hostile, name);
  assert.equal(await artifactPage(page).locator("img, script").count(), 0);
  const remove = page.getByRole("button", { name: "Delete artifact…", exact: true });
  await remove.click();
  const confirm = page.getByRole("dialog", { name: "Delete artifact?" });
  await confirm.getByText(name, { exact: true }).waitFor();
  assert.equal(await confirm.locator("img").count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Cancel");
  await page.keyboard.press("Escape");
  await confirm.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.textContent === "Delete artifact…", null);
  assert.equal(await commands(page, "DeleteArtifact"), 0);
  await remove.click();
  await confirm.getByRole("button", { name: "Delete artifact", exact: true }).click();
  await page.locator('[data-view="catalogue"]').waitFor({ state: "visible" });
  await page.getByText("Artifact deleted", { exact: true }).waitFor();
  assert.equal((await api(page, { GetArtifact: { artifactId: input.hostile } })).status, 404);
});

await check("Open artifact hands an internal artifact to its isolated origin without dashboard credentials", async (page) => {
  await open(page, input.bundle, "artifact-bundle");
  const cookies = [];
  page.on("request", async (request) => {
    if (new URL(request.url()).hostname.startsWith(input.bundle + ".")) {
      const headers = await request.allHeaders();
      cookies.push({ dashboard: (headers.cookie || "").includes("manure-dev="), authorization: Boolean(headers.authorization) });
    }
  });
  await page.getByRole("button", { name: "Open artifact", exact: true }).click();
  await page.getByRole("heading", { name: "Isolated internal preview", exact: true }).waitFor();
  assert.notEqual(new URL(page.url()).origin, input.base);
  assert.equal(cookies.length > 0, true);
  assert.equal(cookies.some((headers) => headers.dashboard || headers.authorization), false);
});

await check("Open artifact navigates to public content and to the unlock page of an external artifact", async (page) => {
  await open(page, input.public, "artifact-public");
  await page.getByRole("button", { name: "Open artifact", exact: true }).click();
  await page.getByRole("heading", { name: "Public preview", exact: true }).waitFor();
  await page.goto(input.base + "/#/artifacts", { waitUntil: "domcontentloaded" });
  await counterLoaded(page);
  await open(page, input.protected, "artifact-protected");
  await page.getByRole("button", { name: "Open artifact", exact: true }).click();
  await page.getByRole("heading", { name: "Protected artifact", exact: true }).waitFor();
  await page.locator("#password-input").fill("incorrect");
  await page.locator("#unlock-form button[type=submit]").click();
  await page.locator("#unlock-error").waitFor({ state: "visible" });
  await page.locator("#password-input").fill(input.protectedPassword);
  await page.locator("#unlock-form button[type=submit]").click();
  await page.waitForFunction(() => document.body.textContent.includes("protected") && document.querySelector("#unlock-form") === null);
  assert.equal(page.url().includes(input.protectedPassword), false);
});

await browser.close();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.some((result) => !result.ok) ? 1 : 0;
