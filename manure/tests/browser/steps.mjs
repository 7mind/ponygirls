/* manure browser step executor (test-only driver, no runtime role).
 *
 * Reads a scenario object from stdin (never argv: tokens/passwords must
 * not appear in process listings):
 *   { chromiumBin, hostResolverRules, headed, ignoreHTTPSErrors,
 *     steps: [ {op, ...}, ... ] }
 * Writes a JSON array of per-step results to stdout. Step failures do
 * not abort the scenario: the failing step records {ok:false, error}
 * and execution continues, so one browser launch yields all evidence.
 *
 * Ops:
 *   goto {url}                              -> {url, status}
 *   fill {selector, value}                  -> {ok}
 *   click {selector, waitForUrl?}           -> {ok, url}
 *   text {selector}                         -> {text}
 *   count {selector}                        -> {count}
 *   attr {selector, name}                   -> {value}
 *   eval {fn, arg}  (fn: "(arg) => ..." )   -> {value}
 *   cookies {urls:[...]}                    -> {cookies:[{name,value,domain,
 *                                              path,httpOnly,secure,sameSite}]}
 *   setCookies {cookies:[{url,name,value,sameSite?,secure?,httpOnly?}]} -> {} (plant exact-host
 *                                              cookies: replays a previously
 *                                              observed cookie value; TESTONLY
 *                                              SameSite planting (e.g. None/Secure
 *                                              under real TLS) forces cross-site
 *                                              dispatch without changing runtime
 *                                              defaults; pass only url OR
 *                                              domain+path, never both)
 *   localStorageKeys {}                     -> {keys}
 *   newPage {url?} / usePage {index}        -> {pages}
 *   waitForUrl {url, timeoutMs?}            -> {url}
 *   waitForText {selector, contains, timeoutMs?} -> {text}
 *   waitForEval {fn, arg, timeoutMs?}     -> {value}
 *   clickAndReload {selector}             -> {url} (native form posts)
 *   download {selector}                     -> {filename, size, path}
 *   assignDownload {url, timeoutMs?}        -> {filename, size, path}
 *                                              (navigational downloads: arms the
 *                                              waiter BEFORE location.assign in one
 *                                              operation, as with click-driven
 *                                              downloads; avoids the fast-download
 *                                              race of a separate waiter step)
 *   waitForDownload {timeoutMs?}            -> {filename, size, path}
 *                                              (legacy navigational waiter: kept for
 *                                              compatibility, prefer assignDownload)
 *   reload {}                               -> {url}
 *
 * Network capture runs automatically via CDP (sees real Cookie/Origin
 * headers and statuses, even for CORS-rejected responses via
 * responseReceivedExtraInfo; secret values redacted). Blocked cookies
 * (SameSite, etc.) are never reported as dispatched: only associated
 * cookies with empty blockedReasons count. The trailing "requests"/"responses"
 * entries hold them;
 * lists every HTTP request (url, method, Origin/Referer/Content-Type,
 * cookie NAMES only) so tests can assert credential routing and prove
 * no secret ever appears in a URL. The trailing "responses" entry lists
 * response statuses with Set-Cookie NAMES only (never values).
 */
"use strict";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const coreDir = process.env.MANURE_PLAYWRIGHT_CORE_PATH || "";
let chromium;
try {
  const coreRequire = createRequire(coreDir + "/package.json");
  ({ chromium } = coreRequire("playwright-core"));
} catch (e) {
  process.stderr.write(
    `steps.mjs: cannot load playwright-core from MANURE_PLAYWRIGHT_CORE_PATH=${coreDir}: ${e.message}\n`);
  process.exit(2);
}

async function runStep(ctx, step) {
  const page = ctx.pages[ctx.current];
  switch (step.op) {
    case "goto": {
      const res = await page.goto(step.url, { waitUntil: "load", timeout: 15000 });
      return { url: page.url(), status: res ? res.status() : null };
    }
    case "fill": {
      await page.locator(step.selector).fill(step.value, { timeout: 10000 });
      return {};
    }
    case "click": {
      if (step.waitForUrl) {
        await Promise.all([
          page.waitForURL(step.waitForUrl, { timeout: 15000 }),
          page.locator(step.selector).click({ timeout: 10000 }),
        ]);
      } else {
        await page.locator(step.selector).click({ timeout: 10000 });
      }
      return { url: page.url() };
    }
    case "text": {
      const text = await page.locator(step.selector).first().textContent({ timeout: 10000 });
      return { text };
    }
    case "count": {
      const count = await page.locator(step.selector).count();
      return { count };
    }
    case "attr": {
      const value = await page.locator(step.selector).first().getAttribute(step.name);
      return { value };
    }
    case "eval": {
      // eslint-disable-next-line no-eval
      const fn = eval(`(${step.fn})`);
      const value = await page.evaluate(fn, step.arg);
      return { value };
    }
    case "cookies": {
      const out = [];
      for (const url of step.urls || []) {
        const list = await ctx.context.cookies(url);
        for (const c of list) {
          out.push({
            url,
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite,
          });
        }
      }
      return { cookies: out };
    }
    case "setCookies": {
      await ctx.context.addCookies(step.cookies || []);
      return {};
    }
    case "localStorageKeys": {
      const keys = await page.evaluate(() => Object.keys(window.localStorage));
      const sessionKeys = await page.evaluate(() => Object.keys(window.sessionStorage));
      return { keys, sessionKeys };
    }
    case "newPage": {
      const p = step.url
        ? await ctx.context.newPage()
        : await ctx.context.newPage();
      if (step.url) await p.goto(step.url, { waitUntil: "load", timeout: 15000 });
      ctx.pages.push(p);
      ctx.current = ctx.pages.length - 1;
      return { pages: ctx.pages.length };
    }
    case "usePage": {
      ctx.current = step.index;
      return { url: ctx.pages[ctx.current].url() };
    }
    case "waitForUrl": {
      await page.waitForURL(step.url, { timeout: step.timeoutMs || 15000 });
      return { url: page.url() };
    }
    case "waitForText": {
      await page.locator(step.selector).first()
        .filter({ hasText: step.contains }).waitFor({ timeout: step.timeoutMs || 15000 });
      const text = await page.locator(step.selector).first().textContent();
      return { text };
    }
    case "waitForEval": {
      // eslint-disable-next-line no-eval
      const fn = eval(`(${step.fn})`);
      await page.waitForFunction(fn, step.arg, { timeout: step.timeoutMs || 15000 });
      const value = await page.evaluate(fn, step.arg);
      return { value };
    }
    case "clickAndReload": {
      await Promise.all([
        page.waitForLoadState("load", { timeout: 15000 }).catch(() => {}),
        page.locator(step.selector).click({ timeout: 10000 }),
        page.waitForLoadState("load", { timeout: 15000 }).catch(() => {}),
      ]);
      return { url: page.url() };
    }
    case "assignDownload": {
      const dlDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manure-dl-"));
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: step.timeoutMs || 20000 }),
        page.evaluate((u) => { window.location.assign(u); }, step.url),
      ]);
      const dest = path.join(dlDir, download.suggestedFilename());
      await download.saveAs(dest);
      const stat = await fs.promises.stat(dest);
      return { filename: download.suggestedFilename(), size: stat.size, path: dest };
    }
    case "waitForDownload": {
      const dlDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manure-dl-"));
      const download = await page.waitForEvent("download", { timeout: step.timeoutMs || 20000 });
      const dest = path.join(dlDir, download.suggestedFilename());
      await download.saveAs(dest);
      const stat = await fs.promises.stat(dest);
      return { filename: download.suggestedFilename(), size: stat.size, path: dest };
    }
    case "download": {
      const dlDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "manure-dl-"));
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        page.locator(step.selector).click({ timeout: 10000 }),
      ]);
      const dest = path.join(dlDir, download.suggestedFilename());
      await download.saveAs(dest);
      const stat = await fs.promises.stat(dest);
      return { filename: download.suggestedFilename(), size: stat.size, path: dest };
    }
    case "reload": {
      await page.reload({ waitUntil: "load", timeout: 15000 });
      return { url: page.url() };
    }
    default:
      throw new Error(`unknown op: ${step.op}`);
  }
}

async function main() {
  const scenario = JSON.parse(fs.readFileSync(0, "utf-8"));
  const browser = await chromium.launch({
    executablePath: scenario.chromiumBin,
    headless: !scenario.headed,
    args: [
      `--host-resolver-rules=${scenario.hostResolverRules}`,
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  const results = [];
  let context;
  try {
    context = await browser.newContext({ acceptDownloads: true,
      ignoreHTTPSErrors: !!scenario.ignoreHTTPSErrors });
    const ctx = { context, pages: [], current: 0, dialogs: [],
                  errors: [], requests: [], console: [], responses: [] };
    const redact = (headers) => {
      const safe = {};
      for (const [k, v] of Object.entries(headers || {})) {
        const lk = k.toLowerCase();
        if (lk === "cookie") {
          safe[k] = String(v).split(/;\s*/).filter(Boolean)
            .map((pair) => pair.split("=", 1)[0]).sort().join(";");
        } else if (lk === "set-cookie") {
          const names = [];
          const re = /(?:^|,)\s*([^=;,\s]+)=/g;
          let m;
          while ((m = re.exec(String(v))) !== null) names.push(m[1]);
          safe[k] = names.join(";");
        } else {
          safe[k] = v;
        }
      }
      return safe;
    };
    const cookieNamesOf = (headers) => {
      const out = [];
      for (const [k, v] of Object.entries(headers || {})) {
        if (k.toLowerCase() === "cookie") {
          for (const pair of String(v).split(/;\s*/).filter(Boolean)) {
            out.push(pair.split("=", 1)[0]);
          }
        }
      }
      return out.sort();
    };
    const hookPage = async (p) => {
      if (p.__manureHooked) return;
      p.__manureHooked = true;
      // Network-layer capture via CDP: unlike page.on('request'/'response'),
      // this sees real Cookie/Origin headers and statuses even for
      // CORS-rejected responses. Secret VALUES are never recorded.
      try {
        const cdp = await ctx.context.newCDPSession(p);
        await cdp.send("Network.enable");
        ctx.netById = ctx.netById || {};
        ctx.respById = ctx.respById || {};
        const lowKey = (headers, name) => {
          for (const [k, v] of Object.entries(headers || {})) {
            if (k.toLowerCase() === name) return v;
          }
          return undefined;
        };
        cdp.on("Network.requestWillBeSent", (ev) => {
          try {
            const req = ev.request || {};
            const entry = {
              url: req.url || "", method: req.method || "",
              origin: lowKey(req.headers, "origin") || null,
              cookieNames: cookieNamesOf(req.headers),
              headers: redact(req.headers),
            };
            ctx.requests.push(entry);
            if (ev.requestId) ctx.netById[ev.requestId] = entry;
          } catch (e) { /* diagnostics only */ }
        });
        // Associated cookies and the finally-sent headers (Cookie,
        // Origin, Referer) arrive here, not in requestWillBeSent.
        // Only unblocked cookies (empty blockedReasons) were actually
        // dispatched: blocked ones (SameSite, etc.) must never be reported
        // as sent, otherwise a withheld-cookie 401 would masquerade as an
        // authenticated 403 proof.
        cdp.on("Network.requestWillBeSentExtraInfo", (ev) => {
          try {
            const entry = ev.requestId ? ctx.netById[ev.requestId] : null;
            if (!entry) return;
            const cookies = ev.associatedCookies || [];
            const sent = cookies.filter((c) => !c.blockedReasons || c.blockedReasons.length === 0);
            if (cookies.length) {
              entry.cookieNames = sent.map((c) => c.cookie ? c.cookie.name : "?").sort();
              entry.blockedCookieNames = cookies.filter((c) => c.blockedReasons && c.blockedReasons.length)
                .map((c) => c.cookie ? c.cookie.name : "?").sort();
            }
            const headers = ev.headers || {};
            const origin = lowKey(headers, "origin");
            if (origin !== undefined) entry.origin = origin;
            entry.headers = redact(Object.assign({}, entry.headers, headers));
          } catch (e) { /* diagnostics only */ }
        });
        cdp.on("Network.responseReceived", (ev) => {
          try {
            const res = ev.response || {};
            const names = [];
            const raw = res.headers ? (res.headers["set-cookie"] || res.headers["Set-Cookie"] || "") : "";
            if (raw) {
              const re = /(?:^|,)\s*([^=;,\s]+)=/g;
              let m;
              while ((m = re.exec(String(raw))) !== null) names.push(m[1]);
            }
            const entry = { url: res.url || "", status: res.status || 0,
                                 setCookieNames: names };
            ctx.responses.push(entry);
            if (ev.requestId) ctx.respById[ev.requestId] = entry;
          } catch (e) { /* diagnostics only */ }
        });
        // CORS-blocked responses never trigger responseReceived: the
        // status arrives here instead (per CDP docs). Without this, simple
        // wrong-Origin POSTs (login/logout/grants) show a dispatched request
        // but no server 403, and the proof is incomplete.
        cdp.on("Network.responseReceivedExtraInfo", (ev) => {
          try {
            const status = ev.statusCode || 0;
            if (!status) return;
            const headers = ev.headers || {};
            const names = [];
            for (const [k, v] of Object.entries(headers)) {
              if (k.toLowerCase() === "set-cookie") {
                const re = /(?:^|,)\s*([^=;,\s]+)=/g;
                let m;
                while ((m = re.exec(String(v))) !== null) names.push(m[1]);
              }
            }
            const existing = ev.requestId ? ctx.respById[ev.requestId] : null;
            if (existing) {
              if (!existing.status) existing.status = status;
              if (names.length && !existing.setCookieNames.length) {
                existing.setCookieNames = names;
              }
              return;
            }
            const reqEntry = ev.requestId ? ctx.netById[ev.requestId] : null;
            const url = reqEntry ? reqEntry.url : "";
            if (!url && !status) return;
            const entry = { url, status, setCookieNames: names, viaExtraInfo: true };
            ctx.responses.push(entry);
            if (ev.requestId) ctx.respById[ev.requestId] = entry;
          } catch (e) { /* diagnostics only */ }
        });
        cdp.on("Network.loadingFailed", (ev) => {
          try {
            // Diagnostics only: a CORS/preflight block with no server status
            // must never masquerade as a 403 proof. Record the failure so
            // tests can distinguish never-dispatched from dispatched-403.
            const reqEntry = ev.requestId ? ctx.netById[ev.requestId] : null;
            if (!reqEntry) return;
            reqEntry.loadFailed = {
              errorText: ev.errorText || "",
              blockedReason: ev.blockedReason || "",
            };
          } catch (e) { /* diagnostics only */ }
        });
      } catch (e) {
        ctx.console.push(`warning: cdp-attach-failed ${String(e).slice(0, 120)}`);
      }
      // Auto-accept confirms (dashboard delete flow); every dialog is
      // recorded so tests can assert it appeared.
      p.on("dialog", (d) => {
        ctx.dialogs.push({ type: d.type(), message: d.message(), url: p.url() });
        d.accept().catch(() => {});
      });
      p.on("pageerror", (e) => ctx.errors.push(`pageerror: ${String(e).slice(0, 300)}`));
      p.on("console", (msg) => {
        if (msg.type() === "error" || msg.type() === "warning") {
          ctx.console.push(`${msg.type()}: ${msg.text().slice(0, 300)}`);
        }
      });
    };
    ctx.pages.push(await context.newPage());
    for (const p of ctx.pages) await hookPage(p);
    for (const step of scenario.steps || []) {
      try {
        const value = await runStep(ctx, step);
        results.push({ op: step.op, ok: true, ...value });
      } catch (e) {
        results.push({ op: step.op, ok: false, error: String(e && e.message || e).slice(0, 1000) });
      }
      // Attach collectors (incl. CDP network) to any newly opened pages.
      for (const p of ctx.pages) await hookPage(p);
    }
    results.push({ op: "pageerrors", ok: true, errors: ctx.errors });
    results.push({ op: "dialogs", ok: true, dialogs: ctx.dialogs });
    results.push({ op: "requests", ok: true, requests: ctx.requests });
    results.push({ op: "responses", ok: true, responses: ctx.responses });
    results.push({ op: "console", ok: true, messages: ctx.console });
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  process.stdout.write(JSON.stringify(results));
}

main().catch((e) => {
  process.stderr.write(`steps.mjs fatal: ${e && e.stack || e}\n`);
  process.exit(1);
});
