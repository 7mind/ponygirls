// Upload page and CLI view of the dashboard redesign over the real API (spec §3.3, §8.1, §8.7, §8.9).
// Runnable alone: `node upload.mjs < payload.json` (payload from test_browser_quick_upload.py).
// Waits are for rendered state (row states, dialogs, hashes), never for a request or a fixed time. Fault injection
// is test-only; credentials arrive over stdin and never appear in the output.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const { chromium } = createRequire(path.join(input.core, "package.json"))("playwright-core");
const browser = await chromium.launch({ executablePath: input.browser, args: ["--no-sandbox", "--no-proxy-server", `--host-resolver-rules=${input.resolver}`] });
const results = [];
const PASSWORD_RE = /^[A-Za-z0-9_-]{43}$/;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");

// Test-only fault injection around fetch: counts reservations, records settings, loses or holds chosen calls.
const instrument = () => {
  const original = window.fetch.bind(window);
  const state = window.__upload = { inits: 0, initCommands: [], urls: [], lostChunk: false, lostFinish: false, holdInit: false, releaseInit: null,
    consumedInit: false, holdChunk: false, releaseChunk: null, chunkLengths: [], violations: [] };
  document.addEventListener("securitypolicyviolation", (event) => state.violations.push(event.violatedDirective));
  window.fetch = async (url, options) => {
    state.urls.push(String(url));
    let command = null;
    if (typeof options?.body === "string") { try { command = JSON.parse(options.body).command ?? null; } catch (_) { command = null; } }
    if (command?.InitUpload) { state.inits++; state.initCommands.push(command.InitUpload); }
    if (options?.method === "PUT") {
      state.chunkLengths.push(options.body.size);
      if (state.holdChunk) { state.holdChunk = false; await new Promise((resolve) => { state.releaseChunk = resolve; }); }
    }
    const response = await original(url, options);
    if (options?.method === "PUT" && !state.lostChunk && state.loseChunk) { state.lostChunk = true; throw new Error("controlled-offline"); }
    if (command?.FinishUpload && state.loseFinish && !state.lostFinish) { state.lostFinish = true; throw new Error("controlled-offline"); }
    if (command?.InitUpload && state.holdInit) {
      state.holdInit = false;
      const copy = new Response(await response.text(), { status: response.status, headers: response.headers });
      const text = copy.text.bind(copy);
      // The macrotask after the body is read runs after every microtask continuation of the dashboard's request chain.
      copy.text = async () => { const value = await text(); setTimeout(() => { state.consumedInit = true; }, 0); return value; };
      return new Promise((resolve) => { state.releaseInit = () => resolve(copy); });
    }
    return response;
  };
  // Secure contexts only: a deterministic clipboard so copy success is observable on http fixtures too.
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.__clipboard = text; } } });
};

const login = async (page) => {
  await page.locator("[data-account-login] input[name=login]").fill(input.login);
  await page.locator("[data-account-login] input[name=password]").fill(input.loginPassword);
  await page.locator("[data-account-login] button[type=submit]").click();
  await page.getByRole("button", { name: input.userId }).waitFor();
  await page.waitForFunction(() => / loaded|No matches/.test(document.querySelector("#list-status").textContent));
};

const check = async (name, run, { clipboard = true, viewport = { width: 1440, height: 900 }, signedIn = true } = {}) => {
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    const problems = [];
    page.on("pageerror", (error) => problems.push("pageerror: " + error.message));
    page.on("console", (message) => { if (/Content Security Policy/i.test(message.text())) problems.push("console: " + message.text()); });
    page.on("dialog", (dialog) => { problems.push("native dialog: " + dialog.type()); dialog.dismiss().catch(() => {}); });
    const urls = [];
    page.on("request", (request) => urls.push(request.url()));
    page.__urls = urls;
    await page.addInitScript(instrument);
    if (!clipboard) { await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }); }); }
    await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
    if (signedIn) { await login(page); } else { await page.locator("[data-account-login]").waitFor(); }
    const data = await run(page);
    assert.deepEqual(await page.evaluate(() => window.__upload.violations), [], "no CSP violation");
    assert.deepEqual(problems, []);
    for (const secret of [input.token, input.loginPassword]) { if (secret) { assert.equal(urls.some((url) => url.includes(secret)), false, "no credential in a URL"); } }
    results.push({ name, ok: true, data: data ?? null });
  } catch (error) {
    results.push({ name, ok: false, error: error.message.split("\n").slice(0, 8).join(" ") });
  } finally { await context.close(); }
};

const goUpload = async (page) => {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Upload" }).click();
  await page.getByRole("button", { name: "Choose files…" }).waitFor();
};
const files = (page, specs) => page.locator("#upload-files").setInputFiles(specs.map(([name, buffer]) => ({ name, mimeType: "application/octet-stream", buffer })));
const rowStates = (page, state, count) => page.waitForFunction(([wanted, n]) => document.querySelectorAll(`tbody[data-upload-row][data-state="${wanted}"]`).length === n, [state, count]);
const row = (page, name) => page.locator("tbody[data-upload-row]").filter({ hasText: name });
const rowCount = (page, n) => page.waitForFunction((count) => document.querySelectorAll("tbody[data-upload-row]").length === count, n);
const settings = (page) => page.getByRole("region", { name: "Settings for this upload" });
const uploadButton = (page) => page.getByRole("button", { name: /^(Upload \d+ files?|Retry \d+ failed)$/ });
const access = (page, label) => page.getByRole("group", { name: "Access" }).getByRole("button", { name: label, exact: true }).click();
const signOut = async (page, userId) => {
  await page.getByRole("button", { name: userId }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
};
const scrollers = (page) => page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => {
  const style = getComputedStyle(el);
  return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1 && el.getBoundingClientRect().height > 0;
}).map((el) => el.id || el.className || el.tagName));
// Elements of the routed view (not the masthead, which the shell owns) that extend past the right edge of the viewport.
const beyondViewport = (page) => page.evaluate(() => [...document.querySelectorAll("#main *")].filter((el) => {
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.right > innerWidth + 0.5;
}).map((el) => el.id || el.className || el.tagName));
const content = (page, id, file) => page.evaluate(async ([artifact, name]) => {
  const encode = (bytes) => { let text = ""; for (const byte of bytes) { text += String.fromCharCode(byte); } return btoa(text); };
  const response = await fetch(`/api/current/artifacts/${artifact}/files/${name}/content`);
  return { status: response.status, base64: encode(new Uint8Array(await response.arrayBuffer())) };
}, [id, file]);

await check("files pasted or dropped while signed out are ignored", async (page) => {
  await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File(["x"], "before.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    document.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  assert.equal(await page.evaluate(() => location.hash), "", "nothing navigates while signed out");
  await login(page);
  await goUpload(page);
  assert.equal(await page.locator("tbody[data-upload-row]").count(), 0);
}, { signedIn: false });

await check("paste, picker, keyboard and drop-anywhere stage files; publish exact bytes; passwords cannot be lost", async (page) => {
  assert.equal(await page.evaluate(() => !isSecureContext && !crypto.subtle), true, "runs where only the dashboard's own SHA-256 is available");
  // Hand-off from the catalogue: a pasted file continues on the Upload page; ordinary text paste is left alone.
  const pasted = await page.evaluate((base64) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], "shot.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    const text = new DataTransfer(); text.setData("text/plain", "ordinary paste");
    const event = new ClipboardEvent("paste", { clipboardData: text, bubbles: true, cancelable: true });
    document.querySelector("#filter-text").dispatchEvent(event);
    return { textPrevented: event.defaultPrevented };
  }, PNG.toString("base64"));
  assert.equal(pasted.textPrevented, false);
  await page.getByRole("button", { name: "Choose files…" }).waitFor();
  assert.equal(await page.evaluate(() => location.hash), "#/upload");
  await rowCount(page, 1);
  // Picker through the keyboard.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files…" }).focus();
  await page.keyboard.press("Enter");
  await (await chooser).setFiles([{ name: "report.pdf", mimeType: "application/pdf", buffer: PDF }]);
  await rowCount(page, 2);
  await access(page, "External");
  // Drop anywhere on the page.
  await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File([], "empty.txt"));
    document.querySelector("#upload-section").dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await rowCount(page, 3);
  assert.equal(await page.evaluate(() => window.__upload.inits), 0, "nothing is published before Upload is pressed");
  assert.equal(await page.locator("tbody[data-upload-row][data-state=staged]").count(), 3);
  await uploadButton(page).click();
  await rowStates(page, "ready", 3);
  // Exact bytes and the content link of each artifact.
  const expected = [["shot.png", PNG], ["report.pdf", PDF], ["empty.txt", Buffer.alloc(0)]];
  for (const [name, bytes] of expected) {
    const id = await row(page, name).getAttribute("data-artifact-id");
    const stored = await content(page, id, name);
    assert.equal(stored.status, 200); assert.equal(stored.base64, bytes.toString("base64"), name);
    const link = new URL(await page.getByRole("textbox", { name: `Content link for ${name}` }).inputValue());
    assert.equal(link.pathname, "/view/" + id); assert.equal(link.search + link.hash, "");
    assert.equal(await row(page, name).getAttribute("data-access"), "external");
  }
  assert.equal(await page.evaluate(() => window.__upload.inits), 3);
  // The passwords are masked until revealed, are not in storage, and survive a route round trip and Escape.
  const panels = page.locator("[data-upload-secret]");
  assert.equal(await panels.count(), 3);
  const first = row(page, "shot.png").getByRole("group", { name: "External password for shot.png" });
  const saved = first.getByRole("button", { name: "I have saved it" });
  assert.equal(await saved.isDisabled(), true, "cannot be dismissed before it was copied or revealed");
  assert.equal(PASSWORD_RE.test(await first.getByRole("textbox").inputValue()), false, "masked");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Artifacts" }).click();
  await page.locator('[data-view="catalogue"]').waitFor({ state: "visible" });
  await goUpload(page);
  assert.equal(await panels.count(), 3, "a route round trip keeps the shown passwords");
  await page.keyboard.press("Escape");
  assert.equal(await panels.count(), 3, "Escape does not hide a password");
  await first.getByRole("button", { name: "Reveal" }).click();
  const password = await first.getByRole("textbox").inputValue();
  assert.match(password, PASSWORD_RE);
  assert.equal(await saved.isEnabled(), true);
  await row(page, "report.pdf").getByRole("button", { name: "Copy password for report.pdf" }).click();
  await page.waitForFunction(() => window.__clipboard !== undefined);
  assert.match(await page.evaluate(() => window.__clipboard), PASSWORD_RE);
  assert.equal(await row(page, "report.pdf").getByRole("button", { name: "I have saved it" }).isEnabled(), true);
  // Dismissal asks; Cancel (initial focus) and Escape keep it.
  await saved.click();
  const dialog = page.getByRole("dialog", { name: "Hide the password for good?" });
  await dialog.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Cancel");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await panels.count(), 3);
  await saved.click();
  await dialog.getByRole("button", { name: "Yes, I have saved it" }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-upload-secret]").length === 2);
  await row(page, "shot.png").getByText("Password hidden.").waitFor();
  assert.equal(await page.evaluate((secret) => document.body.textContent.includes(secret) ||
    [...document.querySelectorAll("input")].some((field) => field.value.includes(secret)) || localStorage.length + sessionStorage.length > 0, password),
    false, "a dismissed password is neither in the page nor in storage");
  // Sign-out with passwords still shown asks first; keeping them leaves the session untouched.
  await signOut(page, input.userId);
  await page.getByRole("dialog", { name: "Hide the password for good?" }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await panels.count(), 2);
  assert.equal(await page.locator("#login-section").isHidden(), true);
  await signOut(page, input.userId);
  await page.getByRole("dialog", { name: "Hide the password for good?" }).getByRole("button", { name: "Yes, I have saved it" }).click();
  await page.locator("#login-section").waitFor({ state: "visible" });
  assert.deepEqual(await page.evaluate(() => ({ rows: document.querySelectorAll("tbody[data-upload-row]").length, secrets: document.querySelectorAll("[data-upload-secret]").length, storage: localStorage.length + sessionStorage.length })),
    { rows: 0, secrets: 0, storage: 0 });
}, { clipboard: true });

await check("failed chunk and uncertain finish retry the same artifact; a reservation answered after sign-out restores nothing", async (page) => {
  await page.evaluate(() => { window.__upload.loseChunk = true; window.__upload.loseFinish = true; });
  await goUpload(page);
  await files(page, [["retry.txt", Buffer.from("retry")]]);
  await uploadButton(page).click();
  await rowStates(page, "failed", 1);
  assert.match(await row(page, "retry.txt").getByRole("alert").textContent(), /Retry continues the same artifact at the same offset/);
  await row(page, "retry.txt").getByRole("button", { name: "Retry retry.txt" }).click();
  await rowStates(page, "failed", 1);
  await page.waitForFunction(() => /Publication is uncertain/.test(document.querySelector("tbody[data-upload-row]").textContent));
  await uploadButton(page).click();
  await rowStates(page, "ready", 1);
  const state = await page.evaluate(() => ({ inits: window.__upload.inits, chunk: window.__upload.lostChunk, finish: window.__upload.lostFinish }));
  assert.deepEqual(state, { inits: 1, chunk: true, finish: true });
  // Late reservation after sign-out.
  await page.getByRole("button", { name: "Clear list" }).click();
  await rowCount(page, 0);
  await page.evaluate(() => { window.__upload.holdInit = true; });
  await access(page, "External");
  await files(page, [["late.txt", Buffer.from("late")]]);
  await uploadButton(page).click();
  await page.waitForFunction(() => typeof window.__upload.releaseInit === "function");
  await signOut(page, input.userId);
  await page.locator("#login-section").waitFor({ state: "visible" });
  await page.evaluate(() => window.__upload.releaseInit());
  await page.waitForFunction(() => window.__upload.consumedInit);
  assert.deepEqual(await page.evaluate(() => ({ rows: document.querySelectorAll("tbody[data-upload-row]").length, secrets: document.querySelectorAll("[data-upload-secret]").length })), { rows: 0, secrets: 0 });
});

await check("public multi-chunk binary: chunk sizes, copy link, link readable without credentials", async (page) => {
  const chunk = await page.evaluate(async () => {
    const response = await fetch("/api/current", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000001", apiVersion: "1.0.0", command: { GetCapabilities: {} } }) });
    return (await response.json()).result.CapabilityInfo.capabilities.chunkBytes;
  });
  const size = chunk * 2 + 17;
  const bytes = Buffer.alloc(size); for (let i = 0; i < size; i++) { bytes[i] = (i * 31 + 17) % 256; }
  await goUpload(page);
  assert.equal(await page.getByRole("group", { name: "Access" }).getByRole("button", { name: "Internal" }).getAttribute("aria-pressed"), "true", "staging defaults to Internal");
  await files(page, [["binary.bin", bytes]]);
  await access(page, "Public");
  await uploadButton(page).click();
  await rowStates(page, "ready", 1);
  assert.equal(await row(page, "binary.bin").getAttribute("data-access"), "public");
  await row(page, "binary.bin").getByRole("button", { name: "Copy link for binary.bin" }).click();
  await page.waitForFunction(() => window.__clipboard !== undefined);
  const link = await page.getByRole("textbox", { name: "Content link for binary.bin" }).inputValue();
  assert.equal(await page.evaluate(() => window.__clipboard), link);
  const anonymous = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: "omit", headers: { Accept: "application/octet-stream" } });
    let text = ""; for (const byte of new Uint8Array(await response.arrayBuffer())) { text += String.fromCharCode(byte); }
    return { status: response.status, base64: btoa(text) };
  }, link);
  assert.equal(anonymous.status, 200); assert.equal(anonymous.base64, bytes.toString("base64"));
  assert.deepEqual(await page.evaluate(() => window.__upload.chunkLengths), [chunk, chunk, 17]);
  return { link, chunk, size };
});

await check("keyboard focus inside a password panel survives the progress of the next upload", async (page) => {
  await goUpload(page);
  await access(page, "External");
  await files(page, [["first.txt", Buffer.from("first")]]);
  await uploadButton(page).click();
  await rowStates(page, "ready", 1);
  const reveal = row(page, "first.txt").getByRole("button", { name: "Reveal" });
  await files(page, [["second.txt", Buffer.from("second")]]);
  await page.evaluate(() => { window.__upload.holdChunk = true; });
  await uploadButton(page).click();
  await page.waitForFunction(() => typeof window.__upload.releaseChunk === "function");
  await reveal.focus();
  await page.evaluate(() => window.__upload.releaseChunk());
  await rowStates(page, "ready", 2);
  assert.equal(await reveal.evaluate((node) => node === document.activeElement), true, "focus stays on the control");
});

await check("without a clipboard the link is offered for manual copy in an in-app dialog", async (page) => {
  await goUpload(page);
  await files(page, [["manual.txt", Buffer.from("manual")]]);
  await access(page, "Public");
  await uploadButton(page).click();
  await rowStates(page, "ready", 1);
  await row(page, "manual.txt").getByRole("button", { name: "Copy link for manual.txt" }).click();
  const dialog = page.getByRole("dialog", { name: "Copy the link manually" });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("textbox").inputValue(), await page.getByRole("textbox", { name: "Content link for manual.txt" }).inputValue());
}, { clipboard: false });

await check("expiry and tags are sent and validated; settings lock while uploading; Cancel and Retry keep one artifact", async (page) => {
  await goUpload(page);
  for (const [label, text] of [["External", /^External — readers need the link and a generated password/], ["Public", /^Public — anyone with the link/], ["Internal", /^Internal — only signed-in users/]]) {
    await access(page, label);
    await page.getByText(text).waitFor();
  }
  await settings(page).getByLabel("Expires", { exact: true }).selectOption("custom");
  const days = settings(page).getByLabel(/^Days from upload/);
  await days.fill("0");
  await page.getByText("Enter a whole number of days from 1 to 365.").waitFor();
  await files(page, [["settings.txt", Buffer.from("settings")]]);
  assert.equal(await uploadButton(page).isDisabled(), true, "an invalid expiry blocks Upload");
  await settings(page).getByLabel("Expires", { exact: true }).selectOption("7");
  await settings(page).getByLabel(/^Tags/).fill("a, a");
  await page.getByText("Tags must be distinct.").waitFor();
  assert.equal(await uploadButton(page).isDisabled(), true, "duplicate tags block Upload");
  await settings(page).getByLabel(/^Tags/).fill(" release , Report 1 ,");
  assert.equal(await uploadButton(page).isEnabled(), true);
  // Hold the first chunk: the row is Uploading, settings and the picker are locked, dropped files are refused.
  await page.evaluate(() => { window.__upload.holdChunk = true; });
  await uploadButton(page).click();
  await page.waitForFunction(() => typeof window.__upload.releaseChunk === "function");
  await rowStates(page, "uploading", 1);
  assert.equal(await page.getByRole("progressbar", { name: "Upload progress of settings.txt" }).count(), 1);
  assert.equal(await page.getByRole("group", { name: "Access" }).getByRole("button", { name: "Public" }).isDisabled(), true);
  assert.equal(await settings(page).getByLabel(/^Tags/).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Choose files…" }).isDisabled(), true);
  await page.getByText("Locked while uploading").waitFor();
  await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File(["x"], "refused.txt"));
    document.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await page.getByText("Files can be added once the current upload has finished.").waitFor();
  assert.equal(await page.locator("tbody[data-upload-row]").count(), 1);
  await page.getByRole("button", { name: "Cancel upload", exact: true }).click();
  await page.evaluate(() => window.__upload.releaseChunk());
  await rowStates(page, "stopped", 1);
  await page.getByText("Locked until the failed upload is retried or removed").waitFor();
  assert.match(await row(page, "settings.txt").getByRole("alert").textContent(), /Cancelled\. Retry continues the same artifact/);
  await row(page, "settings.txt").getByRole("button", { name: "Retry settings.txt" }).click();
  await rowStates(page, "ready", 1);
  await page.getByText("For the next files you add").waitFor();
  const init = await page.evaluate(() => window.__upload.initCommands);
  assert.equal(init.length, 1, "Cancel and Retry reserve one artifact");
  assert.equal(init[0].expiresInSeconds, 7 * 86400);
  assert.deepEqual(init[0].tags, ["release", "Report 1"]);
  const id = await row(page, "settings.txt").getAttribute("data-artifact-id");
  const stored = await page.evaluate(async (artifact) => {
    const response = await fetch("/api/current", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000002", apiVersion: "1.0.0", command: { GetArtifact: { artifactId: artifact } } }) });
    const value = (await response.json()).result.ArtifactInfo.artifact;
    return { tags: value.tags, expires: value.expiresAt !== null };
  }, id);
  assert.deepEqual(stored, { tags: ["release", "Report 1"], expires: true });
});

await check("one document scroller, no horizontal overflow at 1440, 1024 and 390; CLI commands copy", async (page) => {
  await goUpload(page);
  await files(page, Array.from({ length: 24 }, (_, index) => [`layout-${String(index).padStart(2, "0")}-with-a-rather-long-file-name-to-truncate-0123456789.txt`, Buffer.from("x")]));
  await rowCount(page, 24);
  for (const [width, height] of [[1440, 900], [1024, 700], [390, 844]]) {
    await page.setViewportSize({ width, height });
    assert.deepEqual(await scrollers(page), [], `no inner scroller at ${width}px`);
    assert.ok(await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight), "the document scrolls");
    assert.deepEqual(await beyondViewport(page), [], `nothing of the page extends past the viewport at ${width}px`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#upload-table")).display), "table", "the files stay a table");
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "CLI" }).click();
  await page.getByRole("heading", { name: "Command-line client", level: 1 }).waitFor();
  for (const [width, height] of [[1024, 700], [390, 844]]) {
    await page.setViewportSize({ width, height });
    assert.deepEqual(await beyondViewport(page), [], `nothing of the CLI view extends past the viewport at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "CLI" }).getAttribute("aria-current"), "page");
  await page.getByRole("button", { name: "Copy environment commands" }).click();
  await page.waitForFunction(() => window.__clipboard !== undefined);
  assert.equal(await page.evaluate(() => window.__clipboard), `export MANURE_URL=${input.base}\nexport MANURE_TOKEN_FILE=~/.config/manure/token`);
  await page.getByRole("button", { name: "Copy upload commands" }).click();
  await page.waitForFunction(() => window.__clipboard.startsWith("manure upload"));
  // Back to Upload keeps the staged files.
  await page.goBack();
  await page.locator("#upload-section").waitFor({ state: "visible" });
  await rowCount(page, 24);
});

await check("Upload keeps its scroll position and focused control across a CLI round trip and Details/Back", async (page) => {
  const names = Array.from({ length: 12 }, (_, index) => `place-${String(index).padStart(2, "0")}.txt`);
  await goUpload(page);
  await access(page, "Public");
  await files(page, names.map((name) => [name, Buffer.from(name)]));
  await uploadButton(page).click();
  await rowStates(page, "ready", names.length);
  const nav = (label) => page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: label });
  const placed = (y, label) => page.waitForFunction((wanted) => Math.abs(scrollY - wanted) <= 2, y).catch(async (error) => { throw new Error(`${label}: scrollY is ${await page.evaluate(() => scrollY)}, wanted ${y}: ${error.message.split("\n")[0]}`); });
  const scrollTo = async (y) => { await page.evaluate((top) => window.scrollTo(0, top), y); return page.evaluate(() => scrollY); };
  // CLI round trip: scroll position and the last focused control come back.
  await scrollTo(450);
  const focusName = `Remove ${names[3]} from the list`;
  await row(page, names[3]).getByRole("button", { name: focusName, exact: true }).focus();
  const first = await page.evaluate(() => scrollY);
  assert.ok(first > 300, "the page scrolled");
  await nav("CLI").click();
  await page.getByRole("heading", { name: "Command-line client", level: 1 }).waitFor();
  await nav("Upload").click();
  await page.locator("#upload-section").waitFor({ state: "visible" });
  await placed(first, "after the CLI round trip");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), focusName, "focus returns to the control");
  // Details and Back: focus returns to the Details link that was used.
  const details = row(page, names[8]).getByRole("link", { name: `Details of ${names[8]}` });
  await scrollTo(first + 250);
  await details.scrollIntoViewIfNeeded();
  const second = await page.evaluate(() => scrollY);
  await details.click();
  await page.locator("#detail-section").waitFor({ state: "visible" });
  await page.goBack();
  await page.locator("#upload-section").waitFor({ state: "visible" });
  await placed(second, "after Details and Back");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), `Details of ${names[8]}`, "focus returns to the originating link");
  assert.equal(await page.locator("tbody[data-upload-row]").count(), names.length);
});

await browser.close();
process.stdout.write(JSON.stringify(results));
process.exitCode = results.some((result) => !result.ok) ? 1 : 0;
