// Core transitions use the real API. Faults and delayed delivery are test-only.
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import * as api from "../../web/dashboard/current/manure/api/index.js";
import {BaboonCodecContext} from "../../web/dashboard/current/BaboonSharedRuntime.js";
import {randomUUID} from "node:crypto";
const codecContext=BaboonCodecContext.Default;

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
const endpoint = (name) => input.base + "/api/current/artifacts/" + input.artifacts[name].artifact_id;
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
const management = async (page,command) => {
  const request=new api.ClientEnvelope(randomUUID(),"1.0.0",command);
  const response=await page.request.post(input.base+"/api/current",{data:api.ClientEnvelope_JsonCodec.instance.encode(codecContext,request),headers:{Origin:input.base}});
  const result=api.ServerEnvelope_JsonCodec.instance.decode(codecContext,await response.json());
  assert.equal(result.requestId,request.requestId);
  return {response,result:result.result};
};
const contentWire = (base,command,headers={}) => {
  const envelope=new api.ContentEnvelope(randomUUID(),"1.0.0",command);
  return wire(base+"/__manure/current",{method:"POST",body:api.ContentEnvelope_JsonCodec.instance.encode(codecContext,envelope),headers:{Origin:new URL(base).origin,...headers}});
};
const info = async (page,name) => {
  const {response,result}=await management(page,new api.Command_GetArtifact(input.artifacts[name].artifact_id));
  assert.equal(response.status(),200);assert.ok(result instanceof api.Result_ArtifactInfo);
  const a=result.artifact;
  return {artifact_id:a.artifactId,name:a.name,kind:a.kind==="Directory"?"dir":"file",visibility:a.visibility.toLowerCase(),state:a.state.toLowerCase(),
    expires_at:a.expiresAt,file_count:a.fileCount,total_bytes:a.totalBytes};
};
// The access mode the artifact header shows (the last observed server state).
const metadataMode = (page) => page.locator("#detail-access [data-access]").getAttribute("data-access");
const modeButton = (page, mode) => page.getByRole("group", { name: "Access mode" }).getByRole("button", { name: mode[0].toUpperCase() + mode.slice(1), exact: true });
// The mode selected in the access control (the draft until it is saved).
const draftMode = (page) => page.evaluate(() => document.querySelector('#access-mode [aria-pressed="true"]')?.dataset.mode ?? null);
const modeLocked = (page) => page.evaluate(() => [...document.querySelectorAll("#access-mode [data-mode]")].every((button) => button.disabled));
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const hiddenPassword = async (page) => {
  assert.equal((await page.locator('[data-secret="external-password"]').textContent()).length, 0, "one-time password must be cleared");
  assert.equal(await page.getByRole("button", { name: "Hide password", exact: true }).count(), 0);
};
const password = async (page) => {
  await page.waitForFunction(() => document.querySelector('[data-secret="external-password"]').textContent.length === 43);
  const value = await page.locator('[data-secret="external-password"]').textContent();
  secrets.add(value);
  assert.equal(/^[A-Za-z0-9_-]{43}$/.test(value), true, "password must be canonical");
  assert.equal(await page.locator('[data-secret="external-password"]').isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Copy password", exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length), 0);
  return value;
};
const openDetail = async (page, name, query = "") => {
  const id = name === "incomplete" ? input.incomplete : input.artifacts[name].artifact_id;
  await page.evaluate(({ id, query }) => { location.hash = "#/artifact/" + id + query; }, { id, query });
  await page.waitForFunction((id) => document.querySelector('[data-view="artifact"]').dataset.state === "loaded" &&
    !document.querySelector("#detail-section").hidden && document.querySelector("#detail-list").textContent.includes(id), id);
  await page.locator("#access-form").waitFor({ state: "visible" });
};
const selectMode = async (page, mode) => {
  await modeButton(page, mode).click();
  await page.waitForFunction(() => !document.querySelector("#access-save-button").disabled);
};
const savedMode = async (page, mode) => {
  await page.waitForFunction((mode) => !document.querySelector("#detail-section").hidden &&
    document.querySelector("#detail-access [data-access]")?.dataset.access === mode &&
    document.querySelector('#access-mode [aria-pressed="true"]')?.dataset.mode === mode && document.querySelector("#access-save-button").disabled, mode);
  assert.equal(await metadataMode(page), mode);
};
const errorVisible = async (page) => {
  await page.waitForFunction(() => /fail|error|could not|unable|unavailable|network|reload|refresh|confirm/i.test(document.querySelector("#access-status").textContent));
  assert.equal(await page.locator("#access-status").isVisible(), true);
};
// Saving the access mode; every change asks first in the in-app dialog (counted, accepted or cancelled per `dialogs`).
const save = async (page, target, dialogs) => {
  await page.locator("#access-save-button").click();
  const confirm = page.getByRole("dialog", { name: target === "public" ? "Make this artifact public?" : `Change access to ${target[0].toUpperCase() + target.slice(1)}?` });
  await confirm.waitFor();
  dialogs.count++;
  await confirm.getByRole("button", { name: dialogs.accept ? "Make " + target : "Cancel", exact: true }).click();
  await confirm.waitFor({ state: "detached" });
};
// Saves the selected mode and accepts its confirmation (scenarios that do not count dialogs).
const confirmSave = async (page) => {
  await page.locator("#access-save-button").click();
  await page.getByRole("dialog").getByRole("button", { name: /^Make / }).click();
};
const signOut = async (page) => {
  await page.locator("#user-menu-button").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
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
  page.on("dialog", (dialog) => { pageErrors.push("native dialog: " + dialog.type()); dialog.dismiss().catch(() => {}); });
  try {
    await page.addInitScript(() => {
      const realFetch = window.fetch.bind(window);
      const state = window.__accessProbe = { patches: [], completed: 0, metadataPending: 0, fault: null, hold: null, release: null, failMetadata: false, lost: false };
      window.fetch = (url, options = {}) => {
        const target = new URL(String(url), location.href);
        let envelope;
        try { envelope=JSON.parse(options.body || "null"); } catch (_) { envelope=null; }
        const command=target.pathname==="/api/current" ? envelope?.command : null;
        if (!command?.PatchArtifact) {
          if (command?.GetArtifact) {
            if (state.failMetadata) { state.failMetadata = false; return Promise.reject(new Error("test-metadata-offline")); }
            state.metadataPending++;
            return realFetch(url, options).then(async (response) => {
              await response.clone().text();
              return response;
            }).finally(() => { state.metadataPending--; });
          }
          return realFetch(url, options);
        }
        state.patches.push({ path: target.pathname, body: command.PatchArtifact });
        state.completed = 0;
        const fault = state.fault;
        state.fault = null;
        if (fault === "network") return Promise.reject(new Error("test-offline"));
        if (fault === "server") return Promise.resolve(new Response(JSON.stringify({requestId:envelope.requestId,result:{Error:{failure:{code:"Unavailable",message:"controlled fixture",retryAfterSeconds:1}}}}), { status: 503, headers: { "Content-Type": "application/json" } }));
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
    await page.locator("[data-account-login] input[name=login]").fill(input.login);
    await page.locator("[data-account-login] input[name=password]").fill(input.loginPassword);
    await page.locator("[data-account-login] button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("#list-status")?.textContent.includes("loaded"));
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
        const {response,result}=await management(page,new api.Command_CreateGrant(input.artifacts[name].artifact_id));
        assert.equal(response.status(),200);assert.ok(result instanceof api.Result_GrantCreated);
        return result.grant;
      };
      const redeemed = await contentWire(content(name),new api.ContentCommand_RedeemGrant(await mint()),{Origin:input.base});
      assert.equal(redeemed.status, 200);
      oldGrants.push(redeemed.cookie);
      oldHandoffs.push(await mint());
    } else if (source === "external") {
      const unlocked = await contentWire(content(name),new api.ContentCommand_Unlock(currentPassword));
      assert.equal(unlocked.status, 200);
      oldGrants.push(unlocked.cookie);
      oldPasswords.push(currentPassword);
    }
    const before = await page.evaluate(() => window.__accessProbe.patches.length);
    const confirmations = dialogs.count;
    await selectMode(page, target);
    assert.ok((await page.locator("#access-description").textContent()).trim().length > 0);
    await save(page, target, dialogs);
    await savedMode(page, target);
    assert.equal(dialogs.count - confirmations, 1, "every access change is confirmed");
    const patches = await page.evaluate(() => window.__accessProbe.patches);
    assert.equal(patches.length, before + 1);
    assert.deepEqual(patches.at(-1), {path:"/api/current",body:{artifactId:input.artifacts[name].artifact_id,patch:{name:null,visibility:target[0].toUpperCase()+target.slice(1),expiry:{Keep:{}}}}});
    const updated = await info(page, name);
    assert.equal(updated.visibility, target);
    assert.equal(updated.name, original.name);
    assert.equal(updated.expires_at, original.expires_at);
    assert.equal(updated.file_count, original.file_count);
    assert.equal(updated.total_bytes, original.total_bytes);
    assert.equal(Object.hasOwn(updated, "external_password"), false);
    assert.equal((await contentWire(content(name),new api.ContentCommand_GetManifest())).status, target === "public" ? 200 : 401);
    assert.equal((await wire(endpoint(name) + "/files/index.html/content")).status, target === "public" ? 200 : 401);
    const authenticated = await page.request.get(endpoint(name) + "/files/index.html/content");
    assert.equal(authenticated.status(), 200);
    assert.equal(await authenticated.text(), "<h1>access payload</h1>");
    for (const grant of oldHandoffs) {
      const rejected = await contentWire(content(name),new api.ContentCommand_RedeemGrant(grant),{Origin:input.base});
      assert.equal(rejected.status, target === "internal" ? 403 : 400);
    }
    if (target !== "public") {
      for (const cookie of oldGrants) assert.equal((await contentWire(content(name),new api.ContentCommand_GetManifest(),{Cookie:cookie})).status, 401);
    }
    for (const value of oldPasswords) assert.notEqual((await contentWire(content(name),new api.ContentCommand_Unlock(value))).status, 200);
    if (target === "external") {
      currentPassword = await password(page);
      assert.equal(oldPasswords.includes(currentPassword), false, "re-entering external must generate a fresh password");
      const unlocked = await contentWire(content(name),new api.ContentCommand_Unlock(currentPassword));
      assert.equal(unlocked.status, 200);
      assert.equal((await contentWire(content(name),new api.ContentCommand_GetManifest(),{Cookie:unlocked.cookie})).status, 200);
      assert.equal(await page.locator("#rotate-button").isVisible(), true);
      await page.getByRole("button", { name: "Hide password", exact: true }).click();
      await hiddenPassword(page);
      await page.getByRole("button", { name: "Reveal password", exact: true }).click();
      assert.equal(await password(page), currentPassword, "retrieval returns the existing password without rotation");
      assert.equal((await contentWire(content(name),new api.ContentCommand_GetManifest(),{Cookie:unlocked.cookie})).status, 200, "retrieval must not revoke an existing grant");
      await page.getByRole("button", { name: "Hide password", exact: true }).click();
    } else assert.equal(await page.locator("#rotate-button").isVisible(), false);
    await hiddenPassword(page);
    await page.locator("#detail-back-button").click();
    await page.waitForFunction(() => / loaded|No matches/.test(document.querySelector("#list-status").textContent));
    assert.equal(await page.locator("#filter-text").inputValue(), "access:"+source+" sort:visibility direction:asc");
    assert.equal(await page.locator('[data-sort="visibility"]').evaluate((node) => node.closest("th").getAttribute("aria-sort")), "ascending");
    assert.equal(await page.locator(`#artifact-list tr[data-artifact-id="${original.artifact_id}"]`).count(), 0, "old filtered catalogue must not retain changed access");
    await page.locator("#filter-text").fill("access:"+target+" sort:visibility direction:asc");
    await page.locator("#search-submit").click();
    await page.waitForFunction(({ id, target }) => {
      const row = document.querySelector(`#artifact-list tr[data-artifact-id="${id}"]`);
      return document.querySelector("#list-status").textContent.includes("loaded") && row?.dataset.visibility === target;
    }, { id: original.artifact_id, target });
    await page.locator(`#catalogue-table a[data-action=details][data-artifact-id="${original.artifact_id}"]`).click();
    await savedMode(page, target);
    await hiddenPassword(page);
    source = target;
  }
});

if (input.includeRaces) {
  await check("no-op, public cancellation, incomplete artifacts, busy guards and visible failures", async (page, context, dialogs) => {
    await openDetail(page, "incomplete");
    assert.equal(await modeLocked(page), true);
    assert.equal(await page.locator("#access-save-button").isDisabled(), true);
    await openDetail(page, "controls");
    const descriptions = [];
    for (const mode of ["internal", "external", "public"]) {
      await modeButton(page, mode).click();
      descriptions.push((await page.locator("#access-description").textContent()).trim());
    }
    assert.equal(descriptions.every((text) => text.length > 0), true);
    assert.equal(new Set(descriptions).size, 3, "explanations must follow the selected access mode");
    await modeButton(page, "internal").click();
    assert.equal(await page.locator("#access-save-button").isDisabled(), true);
    await page.locator("#access-form").evaluate((form) => form.requestSubmit());
    await settle(page);
    assert.equal(await page.evaluate(() => window.__accessProbe.patches.length), 0);
    dialogs.accept = false;
    await selectMode(page, "public");
    await save(page, "public", dialogs);
    await settle(page);
    assert.equal(dialogs.count, 1);
    assert.equal(await page.evaluate(() => window.__accessProbe.patches.length), 0);
    assert.equal((await info(page, "controls")).visibility, "internal");
    dialogs.accept = true;
    await page.evaluate(() => { window.__accessProbe.hold = "response"; });
    await selectMode(page, "external");
    await confirmSave(page);
    await page.waitForFunction(() => window.__accessProbe.release !== null);
    assert.equal(await page.locator("#access-save-button").isDisabled(), true);
    assert.equal(await modeLocked(page), true);
    await page.locator("#access-form").evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
    await settle(page);
    assert.equal(await page.evaluate(() => window.__accessProbe.patches.length), 1);
    await release(page);
    await savedMode(page, "external");
    await password(page);
    for (const fault of ["server", "network"]) {
      await page.evaluate((fault) => { window.__accessProbe.fault = fault; }, fault);
      await selectMode(page, "internal");
      await confirmSave(page);
      await errorVisible(page);
      await page.waitForFunction(() => !document.querySelector("#access-mode [data-mode]").disabled);
      assert.equal((await info(page, "controls")).visibility, "external");
      assert.equal(await metadataMode(page), "external");
      const draft = await draftMode(page);
      assert.equal(await page.locator("#access-save-button").isDisabled(), draft === "external");
    }
  });

  await check("new access password clears on navigation and confirmed logout", async (page) => {
    await openDetail(page, "navigation");
    await selectMode(page, "external");
    await confirmSave(page);
    await savedMode(page, "external");
    await password(page);
    await openDetail(page, "other");
    await hiddenPassword(page);
    await openDetail(page, "navigation");
    await savedMode(page, "external");
    await hiddenPassword(page);
    await selectMode(page, "internal");
    await confirmSave(page);
    await savedMode(page, "internal");
    await selectMode(page, "external");
    await confirmSave(page);
    await savedMode(page, "external");
    await password(page);
    await signOut(page);
    await page.locator("#login-section").waitFor({ state: "visible" });
    await hiddenPassword(page);
  });

  for (const action of ["navigation", "logout"]) {
    await check("late access response is inert after " + action, async (page) => {
      const name = action === "navigation" ? "controls" : action;
      // Each scenario starts from a fresh internal mode without bypassing the UI.
      await openDetail(page, name);
      if ((await info(page, name)).visibility !== "internal") {
        await selectMode(page, "internal");
        await confirmSave(page);
        await savedMode(page, "internal");
      }
      await page.evaluate(() => { window.__accessProbe.hold = "response"; });
      await selectMode(page, "external");
      await confirmSave(page);
      await page.waitForFunction(() => window.__accessProbe.release !== null);
      assert.equal((await info(page, name)).visibility, "external");
      if (action === "navigation") await openDetail(page, "other");
      else {
        await signOut(page);
        await page.locator("#login-section").waitFor({ state: "visible" });
      }
      await release(page);
      await hiddenPassword(page);
      if (action === "navigation") {
        assert.equal(await metadataMode(page), "internal");
        assert.equal(await draftMode(page), "internal");
        assert.equal((await info(page, "other")).visibility, "internal");
      } else assert.equal(await page.locator("#main").isVisible(), false);
    });
  }

  await check("lost successful PATCH response recovers authoritative mode and password rotation", async (page) => {
    await openDetail(page, "lost");
    await page.evaluate(() => { window.__accessProbe.fault = "lost"; window.__accessProbe.failMetadata = true; });
    await selectMode(page, "external");
    await confirmSave(page);
    await page.waitForFunction(() => window.__accessProbe.lost);
    await errorVisible(page);
    await page.waitForFunction(() => window.__accessProbe.metadataPending === 0);
    await settle(page);
    assert.equal((await info(page, "lost")).visibility, "external");
    await hiddenPassword(page);
    const refresh = page.locator("#access-refresh-button");
    assert.equal(await refresh.isVisible(), true, "a failed metadata refresh needs an explicit recovery control");
    assert.equal(await modeLocked(page), true);
    await refresh.click();
    await savedMode(page, "external");
    await hiddenPassword(page);
    assert.equal(await page.locator("#rotate-button").isEnabled(), true);
    await page.locator("#rotate-button").click();
    await page.getByRole("dialog", { name: "Rotate the external password?" }).getByRole("button", { name: "Rotate password" }).click();
    const value = await password(page);
    const unlocked = await contentWire(content("lost"),new api.ContentCommand_Unlock(value));
    assert.equal(unlocked.status, 200);
  });

  await check("mutation settling after catalogue navigation invalidates pre-commit filtered rows", async (page) => {
    await openDetail(page, "pending-list", "?access=internal&sort=visibility&direction=asc");
    await page.evaluate(() => { window.__accessProbe.hold = "request"; });
    await selectMode(page, "external");
    await confirmSave(page);
    await page.waitForFunction(() => window.__accessProbe.release !== null);
    await page.locator("#detail-back-button").click();
    const id = input.artifacts["pending-list"].artifact_id;
    await page.waitForFunction((id) => document.querySelector("#list-status").textContent.includes("loaded") &&
      document.querySelector(`#artifact-list tr[data-artifact-id="${id}"]`) !== null, id);
    assert.equal((await info(page, "pending-list")).visibility, "internal");
    await release(page);
    assert.equal((await info(page, "pending-list")).visibility, "external");
    await hiddenPassword(page);
    await openDetail(page, "other", "?access=internal&sort=visibility&direction=asc");
    await page.locator("#detail-back-button").click();
    await page.waitForFunction((id) => document.querySelector("#list-status").textContent.includes("loaded") &&
      document.querySelector(`#artifact-list tr[data-artifact-id="${id}"]`) === null, id);
  });

  await check("a delayed response cannot replace newer metadata after detail re-entry", async (page) => {
    const name = "pending-list";
    await openDetail(page, name);
    if ((await info(page, name)).visibility !== "internal") {
      await selectMode(page, "internal");
      await confirmSave(page);
      await savedMode(page, "internal");
    }
    await page.evaluate(() => { window.__accessProbe.hold = "response"; });
    await selectMode(page, "external");
    await confirmSave(page);
    await page.waitForFunction(() => window.__accessProbe.release !== null);
    await openDetail(page, "other");
    const {response:newer}=await management(page,new api.Command_PatchArtifact(input.artifacts[name].artifact_id,
      new api.ArtifactPatch(null,api.Visibility.Public,new api.ExpiryChange_Keep())));
    assert.equal(newer.status(), 200);
    await openDetail(page, name);
    await savedMode(page, "public");
    await page.evaluate(() => {
      window.__accessProbe.observedModes = [];
      const metadata = document.querySelector("#detail-access");
      const observer = new MutationObserver(() => {
        const chip = metadata.querySelector("[data-access]");
        if (chip) window.__accessProbe.observedModes.push(chip.dataset.access);
      });
      observer.observe(metadata, { childList: true, subtree: true });
    });
    await release(page);
    await page.waitForFunction(() => !document.querySelector("#access-mode [data-mode]").disabled && window.__accessProbe.metadataPending === 0);
    assert.equal((await info(page, name)).visibility, "public");
    assert.equal(await metadataMode(page), "public");
    assert.equal((await page.evaluate(() => window.__accessProbe.observedModes)).includes("external"), false,
      "a stale PATCH response must not replace the newer public-mode observation");
    await hiddenPassword(page);
  });
}

await browser.close();
process.stdout.write(JSON.stringify(results));
