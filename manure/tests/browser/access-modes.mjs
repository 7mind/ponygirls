// Core transitions use the real API. Faults and delayed delivery are test-only.
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const require = createRequire(path.join(input.core, "package.json"));
const { chromium } = require("playwright-core");
const browser = await chromium.launch({ executablePath: input.browser,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server", `--host-resolver-rules=${input.resolver}`] });
const results = [];
const secrets = new Set([input.token]);
const cleanError = (error) => {
  let text = String(error.stack || error.message).split("\n").slice(0, 20).join("\n");
  for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
  return text;
};
const endpoint = (name) => input.base + "/api/v1/artifacts/" + input.artifacts[name].artifact_id;
const content = (name) => input.artifacts[name].content_url.replace(/\/$/, "");

// Preserve the content Host while connecting to loopback; Node has no Chromium
// resolver rules, and these requests must exercise the real content dispatcher.
const wire = (url, { method = "GET", body, headers = {} } = {}) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const request = http.request({ hostname: "127.0.0.1", port: target.port, path: target.pathname + target.search,
    method, headers: { Host: target.host, ...headers, ...(bytes ? { "Content-Type": "application/json", "Content-Length": bytes.length } : {}) } }, (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => {
      const text = Buffer.concat(chunks).toString();
      resolve({ status: response.statusCode, text, cookie: (response.headers["set-cookie"] || [""])[0].split(";")[0] });
    });
    response.on("error", reject);
  });
  request.on("error", reject);
  request.end(bytes);
});
const info = async (page, name) => {
  const response = await page.request.get(endpoint(name));
  assert.equal(response.status(), 200);
  return response.json();
};
const metadataMode = (page) => page.locator("#detail-list dt").evaluateAll((nodes) =>
  nodes.find((node) => node.textContent === "Access")?.nextElementSibling.textContent);
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const hiddenPassword = async (page) => {
  assert.equal((await page.locator("#rotate-password").textContent()).length, 0, "one-time password must be cleared");
  assert.equal(await page.locator("#rotate-output").isVisible(), false);
};
const password = async (page) => {
  await page.waitForFunction(() => document.querySelector("#rotate-password").textContent.length === 43);
  const value = await page.locator("#rotate-password").textContent();
  secrets.add(value);
  assert.equal(/^[A-Za-z0-9_-]{43}$/.test(value), true, "password must be canonical");
  assert.equal(await page.locator("#rotate-output").isVisible(), true);
  assert.equal(await page.locator("#rotate-copy-button").isEnabled(), true);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length), 0);
  return value;
};
const openDetail = async (page, name, query = "") => {
  const id = name === "incomplete" ? input.incomplete : input.artifacts[name].artifact_id;
  await page.evaluate(({ id, query }) => { location.hash = "#/artifact/" + id + query; }, { id, query });
  await page.waitForFunction((id) => document.querySelector("#detail-subtitle").textContent === id &&
    !document.querySelector("#detail-section").hidden && document.querySelector("#detail-list").textContent.includes(id), id);
  await page.locator("#access-form").waitFor({ state: "visible" });
};
const selectMode = async (page, mode) => {
  await page.locator("#access-mode").selectOption(mode);
  await page.waitForFunction(() => !document.querySelector("#access-save-button").disabled);
};
const savedMode = async (page, mode) => {
  await page.waitForFunction((mode) => {
    const term = [...document.querySelectorAll("#detail-list dt")].find((node) => node.textContent === "Access");
    return !document.querySelector("#detail-section").hidden && term?.nextElementSibling.textContent === mode &&
      document.querySelector("#access-mode").value === mode && document.querySelector("#access-save-button").disabled;
  }, mode);
  assert.equal(await metadataMode(page), mode);
};
const errorVisible = async (page) => {
  await page.waitForFunction(() => /fail|error|could not|unable|unavailable|network|reload|refresh|confirm/i.test(document.querySelector("#access-status").textContent));
  assert.equal(await page.locator("#access-status").isVisible(), true);
};
const release = async (page) => {
  await page.evaluate(() => window.__accessProbe.release());
  await page.waitForFunction(() => window.__accessProbe.completed > 0);
  await settle(page);
};

const check = async (name, run) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const dialogs = { accept: true, count: 0 };
  const urls = [];
  const pageErrors = [];
  page.on("request", (request) => urls.push(request.url()));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", (dialog) => { dialogs.count++; (dialogs.accept ? dialog.accept() : dialog.dismiss()).catch(() => {}); });
  try {
    await page.addInitScript(() => {
      const realFetch = window.fetch.bind(window);
      const state = window.__accessProbe = { patches: [], completed: 0, metadataPending: 0, fault: null, hold: null, release: null, failLogout: false, failMetadata: false, lost: false };
      window.fetch = (url, options = {}) => {
        const target = new URL(String(url), location.href);
        if (state.failLogout && target.pathname === "/api/v1/logout") return Promise.reject(new Error("test-offline"));
        if ((options.method || "GET").toUpperCase() !== "PATCH") {
          if ((options.method || "GET").toUpperCase() === "GET" && /^\/api\/v1\/artifacts\/[0-9a-f]{32}$/.test(target.pathname)) {
            if (state.failMetadata) { state.failMetadata = false; return Promise.reject(new Error("test-metadata-offline")); }
            state.metadataPending++;
            return realFetch(url, options).then(async (response) => {
              await response.clone().text();
              return response;
            }).finally(() => { state.metadataPending--; });
          }
          return realFetch(url, options);
        }
        state.patches.push({ path: target.pathname, body: JSON.parse(options.body) });
        state.completed = 0;
        const fault = state.fault;
        state.fault = null;
        if (fault === "network") return Promise.reject(new Error("test-offline"));
        if (fault === "server") return Promise.resolve(new Response('{"error":{"code":"unavailable"}}', { status: 503, headers: { "Content-Type": "application/json" } }));
        const hold = state.hold;
        state.hold = null;
        const send = () => realFetch(url, options).then(async (response) => {
          await response.clone().text();
          if (fault === "lost") { await response.text(); state.lost = true; throw new Error("test-response-lost"); }
          if (hold === "response") return new Promise((resolve) => { state.release = () => { state.completed++; resolve(response); }; });
          state.completed++;
          return response;
        });
        return hold === "request" ? new Promise((resolve, reject) => { state.release = () => send().then(resolve, reject); }) : send();
      };
    });
    await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
    await page.locator("#token-input").fill(input.token);
    await page.locator("#login-form button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("#list-status").textContent.includes("shown"));
    await run(page, context, dialogs);
    assert.deepEqual(pageErrors, []);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length), 0);
    for (const secret of secrets) assert.equal(urls.some((url) => url.includes(secret)), false, "secret in a request URL");
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: cleanError(error) });
  } finally {
    await context.close();
  }
};

await check("all six access transitions preserve metadata and enforce real access/revocation", async (page, context, dialogs) => {
  const name = "transition";
  const original = await info(page, name);
  let source = "internal";
  let currentPassword;
  const oldGrants = [];
  const oldHandoffs = [];
  const oldPasswords = [];
  await openDetail(page, name, "?access=internal&sort=visibility&direction=asc");
  for (const target of ["external", "public", "internal", "public", "external", "internal"]) {
    if (source === "internal") {
      const mint = async () => {
        const response = await page.request.post(endpoint(name) + "/grants", { data: {}, headers: { Origin: input.base } });
        assert.equal(response.status(), 200);
        return (await response.json()).grant;
      };
      const redeemed = await wire(content(name) + "/__manure/grant", { method: "POST", body: { grant: await mint() }, headers: { Origin: input.base } });
      assert.equal(redeemed.status, 200);
      oldGrants.push(redeemed.cookie);
      oldHandoffs.push(await mint());
    } else if (source === "external") {
      const unlocked = await wire(content(name) + "/__manure/unlock", { method: "POST", body: { password: currentPassword }, headers: { Origin: new URL(content(name)).origin } });
      assert.equal(unlocked.status, 200);
      oldGrants.push(unlocked.cookie);
      oldPasswords.push(currentPassword);
    }
    const before = await page.evaluate(() => window.__accessProbe.patches.length);
    const confirmations = dialogs.count;
    await selectMode(page, target);
    assert.ok((await page.locator("#access-description").textContent()).trim().length > 0);
    await page.locator("#access-save-button").click();
    await savedMode(page, target);
    assert.equal(dialogs.count - confirmations, target === "public" ? 1 : 0);
    const patches = await page.evaluate(() => window.__accessProbe.patches);
    assert.equal(patches.length, before + 1);
    assert.deepEqual(patches.at(-1), { path: new URL(endpoint(name)).pathname, body: { visibility: target } });
    const updated = await info(page, name);
    assert.equal(updated.visibility, target);
    assert.equal(updated.name, original.name);
    assert.equal(updated.expires_at, original.expires_at);
    assert.equal(updated.file_count, original.file_count);
    assert.equal(updated.total_bytes, original.total_bytes);
    assert.equal(Object.hasOwn(updated, "external_password"), false);
    assert.equal((await wire(content(name) + "/__manure/manifest")).status, target === "public" ? 200 : 401);
    assert.equal((await wire(endpoint(name) + "/files/index.html/content")).status, target === "public" ? 200 : 401);
    const authenticated = await page.request.get(endpoint(name) + "/files/index.html/content");
    assert.equal(authenticated.status(), 200);
    assert.equal(await authenticated.text(), "<h1>access payload</h1>");
    for (const grant of oldHandoffs) {
      const rejected = await wire(content(name) + "/__manure/grant", { method: "POST", body: { grant }, headers: { Origin: input.base } });
      assert.equal(rejected.status, target === "internal" ? 403 : 400);
    }
    if (target !== "public") {
      for (const cookie of oldGrants) assert.equal((await wire(content(name) + "/__manure/manifest", { headers: { Cookie: cookie } })).status, 401);
    }
    for (const value of oldPasswords) assert.notEqual((await wire(content(name) + "/__manure/unlock", { method: "POST", body: { password: value }, headers: { Origin: new URL(content(name)).origin } })).status, 200);
    if (target === "external") {
      currentPassword = await password(page);
      assert.equal(oldPasswords.includes(currentPassword), false, "re-entering external must generate a fresh password");
      const unlocked = await wire(content(name) + "/__manure/unlock", { method: "POST", body: { password: currentPassword }, headers: { Origin: new URL(content(name)).origin } });
      assert.equal(unlocked.status, 200);
      assert.equal((await wire(content(name) + "/__manure/manifest", { headers: { Cookie: unlocked.cookie } })).status, 200);
      assert.equal(await page.locator("#rotate-button").isVisible(), true);
      await page.locator("#rotate-dismiss-button").click();
    } else assert.equal(await page.locator("#rotate-button").isVisible(), false);
    await hiddenPassword(page);
    await page.locator("#detail-back-button").click();
    await page.waitForFunction(() => document.querySelector("#list-status").textContent.includes("shown"));
    assert.equal(await page.locator("#filter-visibility").inputValue(), source);
    assert.equal(await page.locator('[data-sort="visibility"]').evaluate((node) => node.closest("th").getAttribute("aria-sort")), "ascending");
    assert.equal(await page.locator(`#artifact-list tr[data-artifact-id="${original.artifact_id}"]`).count(), 0, "old filtered catalogue must not retain changed access");
    await page.locator("#filter-visibility").selectOption(target);
    await page.waitForFunction(({ id, target }) => {
      const row = document.querySelector(`#artifact-list tr[data-artifact-id="${id}"]`);
      return document.querySelector("#list-status").textContent.includes("shown") && row?.children[2].textContent === target;
    }, { id: original.artifact_id, target });
    await page.locator(`button[data-action=details][data-artifact-id="${original.artifact_id}"]`).click();
    await savedMode(page, target);
    await hiddenPassword(page);
    source = target;
  }
});

if (input.includeRaces) {
  await check("no-op, public cancellation, incomplete artifacts, busy guards and visible failures", async (page, context, dialogs) => {
    await openDetail(page, "incomplete");
    assert.equal(await page.locator("#access-mode").isDisabled(), true);
    assert.equal(await page.locator("#access-save-button").isDisabled(), true);
    await openDetail(page, "controls");
    const descriptions = [];
    for (const mode of ["internal", "external", "public"]) {
      await page.locator("#access-mode").selectOption(mode);
      descriptions.push((await page.locator("#access-description").textContent()).trim());
    }
    assert.equal(descriptions.every((text) => text.length > 0), true);
    assert.equal(new Set(descriptions).size, 3, "explanations must follow the selected access mode");
    await page.locator("#access-mode").selectOption("internal");
    assert.equal(await page.locator("#access-save-button").isDisabled(), true);
    await page.locator("#access-form").evaluate((form) => form.requestSubmit());
    await settle(page);
    assert.equal(await page.evaluate(() => window.__accessProbe.patches.length), 0);
    dialogs.accept = false;
    await selectMode(page, "public");
    await page.locator("#access-save-button").click();
    await settle(page);
    assert.equal(dialogs.count, 1);
    assert.equal(await page.evaluate(() => window.__accessProbe.patches.length), 0);
    assert.equal((await info(page, "controls")).visibility, "internal");
    dialogs.accept = true;
    await page.evaluate(() => { window.__accessProbe.hold = "response"; });
    await selectMode(page, "external");
    await page.locator("#access-save-button").click();
    await page.waitForFunction(() => window.__accessProbe.release !== null);
    assert.equal(await page.locator("#access-save-button").isDisabled(), true);
    assert.equal(await page.locator("#access-mode").isDisabled(), true);
    await page.locator("#access-form").evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
    await settle(page);
    assert.equal(await page.evaluate(() => window.__accessProbe.patches.length), 1);
    await release(page);
    await savedMode(page, "external");
    await password(page);
    for (const fault of ["server", "network"]) {
      await page.evaluate((fault) => { window.__accessProbe.fault = fault; }, fault);
      await selectMode(page, "internal");
      await page.locator("#access-save-button").click();
      await errorVisible(page);
      await page.waitForFunction(() => !document.querySelector("#access-mode").disabled);
      assert.equal((await info(page, "controls")).visibility, "external");
      assert.equal(await metadataMode(page), "external");
      const draft = await page.locator("#access-mode").inputValue();
      assert.equal(await page.locator("#access-save-button").isDisabled(), draft === "external");
    }
  });

  await check("new access password clears on navigation and confirmed logout", async (page) => {
    await openDetail(page, "navigation");
    await selectMode(page, "external");
    await page.locator("#access-save-button").click();
    await savedMode(page, "external");
    await password(page);
    await openDetail(page, "other");
    await hiddenPassword(page);
    await openDetail(page, "navigation");
    await savedMode(page, "external");
    await hiddenPassword(page);
    await selectMode(page, "internal");
    await page.locator("#access-save-button").click();
    await savedMode(page, "internal");
    await selectMode(page, "external");
    await page.locator("#access-save-button").click();
    await savedMode(page, "external");
    await password(page);
    await page.locator("#logout-button").click();
    await page.locator("#login-section").waitFor({ state: "visible" });
    await hiddenPassword(page);
  });

  for (const action of ["navigation", "logout", "failed-logout"]) {
    await check("late access response is inert after " + action, async (page) => {
      const name = action === "navigation" ? "controls" : action;
      // Each scenario starts from a fresh internal mode without bypassing the UI.
      await openDetail(page, name);
      if ((await info(page, name)).visibility !== "internal") {
        await selectMode(page, "internal");
        await page.locator("#access-save-button").click();
        await savedMode(page, "internal");
      }
      await page.evaluate(() => { window.__accessProbe.hold = "response"; });
      await selectMode(page, "external");
      await page.locator("#access-save-button").click();
      await page.waitForFunction(() => window.__accessProbe.release !== null);
      assert.equal((await info(page, name)).visibility, "external");
      if (action === "navigation") await openDetail(page, "other");
      else {
        if (action === "failed-logout") await page.evaluate(() => { window.__accessProbe.failLogout = true; });
        await page.locator("#logout-button").click();
        if (action === "logout") await page.locator("#login-section").waitFor({ state: "visible" });
        else await page.waitForFunction(() => /Sign out could not be confirmed/.test(document.querySelector("#detail-status").textContent));
      }
      await release(page);
      await hiddenPassword(page);
      if (action === "navigation") {
        assert.equal(await metadataMode(page), "internal");
        assert.equal(await page.locator("#access-mode").inputValue(), "internal");
        assert.equal((await info(page, "other")).visibility, "internal");
      } else if (action === "logout") assert.equal(await page.locator("#workspace-shell").isVisible(), false);
    });
  }

  await check("lost successful PATCH response recovers authoritative mode and password rotation", async (page) => {
    await openDetail(page, "lost");
    await page.evaluate(() => { window.__accessProbe.fault = "lost"; window.__accessProbe.failMetadata = true; });
    await selectMode(page, "external");
    await page.locator("#access-save-button").click();
    await page.waitForFunction(() => window.__accessProbe.lost);
    await errorVisible(page);
    await page.waitForFunction(() => window.__accessProbe.metadataPending === 0);
    await settle(page);
    assert.equal((await info(page, "lost")).visibility, "external");
    await hiddenPassword(page);
    const refresh = page.locator("#access-refresh-button");
    assert.equal(await refresh.isVisible(), true, "a failed metadata refresh needs an explicit recovery control");
    assert.equal(await page.locator("#access-mode").isDisabled(), true);
    await refresh.click();
    await savedMode(page, "external");
    await hiddenPassword(page);
    assert.equal(await page.locator("#rotate-button").isEnabled(), true);
    await page.locator("#rotate-button").click();
    const value = await password(page);
    const unlocked = await wire(content("lost") + "/__manure/unlock", { method: "POST", body: { password: value }, headers: { Origin: new URL(content("lost")).origin } });
    assert.equal(unlocked.status, 200);
  });

  await check("mutation settling after catalogue navigation invalidates pre-commit filtered rows", async (page) => {
    await openDetail(page, "pending-list", "?access=internal&sort=visibility&direction=asc");
    await page.evaluate(() => { window.__accessProbe.hold = "request"; });
    await selectMode(page, "external");
    await page.locator("#access-save-button").click();
    await page.waitForFunction(() => window.__accessProbe.release !== null);
    await page.locator("#detail-back-button").click();
    const id = input.artifacts["pending-list"].artifact_id;
    await page.waitForFunction((id) => document.querySelector("#list-status").textContent.includes("shown") &&
      document.querySelector(`#artifact-list tr[data-artifact-id="${id}"]`) !== null, id);
    assert.equal((await info(page, "pending-list")).visibility, "internal");
    await release(page);
    assert.equal((await info(page, "pending-list")).visibility, "external");
    await hiddenPassword(page);
    await openDetail(page, "other", "?access=internal&sort=visibility&direction=asc");
    await page.locator("#detail-back-button").click();
    await page.waitForFunction((id) => document.querySelector("#list-status").textContent.includes("shown") &&
      document.querySelector(`#artifact-list tr[data-artifact-id="${id}"]`) === null, id);
  });

  await check("a delayed response cannot replace newer metadata after detail re-entry", async (page) => {
    const name = "pending-list";
    await openDetail(page, name);
    if ((await info(page, name)).visibility !== "internal") {
      await selectMode(page, "internal");
      await page.locator("#access-save-button").click();
      await savedMode(page, "internal");
    }
    await page.evaluate(() => { window.__accessProbe.hold = "response"; });
    await selectMode(page, "external");
    await page.locator("#access-save-button").click();
    await page.waitForFunction(() => window.__accessProbe.release !== null);
    await openDetail(page, "other");
    const newer = await page.request.patch(endpoint(name), {
      data: { visibility: "public" }, headers: { Origin: input.base },
    });
    assert.equal(newer.status(), 200);
    await openDetail(page, name);
    await savedMode(page, "public");
    await page.evaluate(() => {
      window.__accessProbe.observedModes = [];
      const metadata = document.querySelector("#detail-list");
      const observer = new MutationObserver(() => {
        const term = [...metadata.querySelectorAll("dt")].find((node) => node.textContent === "Access");
        if (term) window.__accessProbe.observedModes.push(term.nextElementSibling.textContent);
      });
      observer.observe(metadata, { childList: true, subtree: true });
    });
    await release(page);
    await page.waitForFunction(() => !document.querySelector("#access-mode").disabled && window.__accessProbe.metadataPending === 0);
    assert.equal((await info(page, name)).visibility, "public");
    assert.equal(await metadataMode(page), "public");
    assert.equal((await page.evaluate(() => window.__accessProbe.observedModes)).includes("external"), false,
      "a stale PATCH response must not replace the newer public-mode observation");
    await hiddenPassword(page);
  });
}

await browser.close();
process.stdout.write(JSON.stringify(results));
