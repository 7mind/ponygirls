import assert from "node:assert/strict";
import { ACTIVITY_PROJECT } from "./seed.mjs";

const DESKTOP = { width: 1440, height: 900 };
const SMALL = { width: 1024, height: 700 };
const MOBILE = { width: 390, height: 844 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const enc = (key) => encodeURIComponent(key);

let storage;
async function loggedInState(env) {
  if (storage) return storage;
  const ctx = await env.browser.newContext({ viewport: DESKTOP });
  const page = await ctx.newPage();
  await page.goto(`${env.base}/#/browse`);
  await page.getByLabel("Username", { exact: true }).fill("op");
  await page.getByLabel("Password", { exact: true }).fill(env.passwords.op);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).waitFor();
  storage = await ctx.storageState();
  await ctx.close();
  return storage;
}

/** New page; logged in as `op` unless auth === false. */
export async function open(env, { viewport = DESKTOP, dark = false, auth = true } = {}) {
  const ctx = await env.browser.newContext({ viewport, colorScheme: dark ? "dark" : "light", storageState: auth ? await loggedInState(env) : undefined, acceptDownloads: false });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("# pageerror", e.message));
  page.requests = [];
  page.on("request", (r) => { if (r.url().includes("/api/")) page.requests.push({ url: new URL(r.url()).pathname, body: r.postData() }); });
  return { ctx, page };
}

export async function gotoBrowse(page, env, hash = "#/browse") {
  await page.goto(`${env.base}/${hash}`);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).waitFor();
  await settle(page);
}
export async function settle(page) {
  await page.waitForFunction(() => [...document.querySelectorAll(".browse-view, section.browse")].filter((v) => v.getClientRects().length > 0).every((v) => v.getAttribute("aria-busy") === "false"));
  await page.waitForTimeout(250);
}
export async function nonBlank(page, what) {
  const text = (await page.locator("body").innerText()).trim();
  assert.ok(text.length > 20, `blank capture: ${what}`);
}

export const scenarios = [
  {
    name: "auth", title: "Login, boot states and sign-out",
    async run(env) {
      const { rec } = env;
      let { ctx, page } = await open(env, { auth: false });
      await page.goto(`${env.base}/#/browse`);
      await page.getByLabel("Username", { exact: true }).waitFor();
      await rec.shot(page, "login-initial", { desc: "Sign-in card, nothing entered", how: "open /#/browse without a session cookie", expect: ["form[data-account-login]"] });
      await rec.dump(page, "login");
      await page.getByLabel("Username", { exact: true }).fill("op");
      await page.getByLabel("Password", { exact: true }).fill("definitely-wrong-password");
      await page.route("**/api/account/v1/login", async (route) => { await sleep(1500); await route.continue(); });
      const click = page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForTimeout(400);
      await rec.shot(page, "login-busy", { desc: "Sign-in submitted, controls disabled, 'Signing in…' status (server delayed 1.5 s)", how: "fill wrong password, click Sign in, capture 400 ms later", expect: ["[data-account-login-status]"] });
      await click;
      await page.locator("[data-account-login-error]").waitFor({ state: "visible" });
      await page.waitForTimeout(1600);
      await rec.shot(page, "login-error", { desc: "Invalid login/password error shown under the form", how: "submit a wrong password", expect: ["[data-account-login-error]"] });
      await page.unroute("**/api/account/v1/login");
      await ctx.close();

      ({ ctx, page } = await open(env, { auth: false, dark: true }));
      await page.goto(`${env.base}/#/browse`);
      await page.getByLabel("Username", { exact: true }).waitFor();
      await rec.shot(page, "login-initial", { desc: "Sign-in card in the dark theme (prefers-color-scheme: dark)", how: "open /#/browse with colorScheme=dark, no session" });
      await ctx.close();

      ({ ctx, page } = await open(env, { auth: false, viewport: MOBILE }));
      await page.goto(`${env.base}/#/browse`);
      await page.getByLabel("Username", { exact: true }).waitFor();
      await rec.shot(page, "login-initial", { desc: "Sign-in card at phone width (extra, not in the required set)", how: "390x844 viewport, no session" });
      await ctx.close();

      ({ ctx, page } = await open(env));
      await page.route("**/api/v1/whoami", async (route) => { await sleep(3000); await route.continue(); });
      const nav = page.goto(`${env.base}/#/browse`);
      await page.waitForTimeout(500);
      await rec.shot(page, "boot-loading", { desc: "Bare 'Loading…' boot screen while whoami is pending (delayed 3 s)", how: "open /#/browse with a valid session; delay /api/v1/whoami", expect: ["[role=status]"] });
      await nav; await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).waitFor();
      await page.unroute("**/api/v1/whoami");
      await page.route("**/api/v1/whoami", (route) => route.abort("connectionrefused"));
      await page.reload();
      await page.getByRole("alert").waitFor();
      await rec.shot(page, "boot-unreachable", { desc: "'Server unreachable' boot error with Retry", how: "valid session, abort /api/v1/whoami at network level, reload", expect: ["[role=alert]"] });
      await ctx.close();
    },
  },

  {
    name: "browse", title: "Browse list: first render, scroll regions, infinite loading, sorting",
    async run(env) {
      const { rec } = env;
      const { ctx, page } = await open(env);
      await gotoBrowse(page, env);
      await rec.shot(page, "browse-first", { desc: "Records list as first rendered (20 rows loaded, count badge '20+'). Page and results panel are independent scroll regions", how: "open /#/browse after sign-in", expect: [".records-panel tbody tr"] });
      await rec.dump(page, "browse-first");
      await page.waitForTimeout(1500);
      const initialSearches = page.requests.filter((r) => r.url === "/api/v1/search").length;
      rec.note(`Measured (page.on('request') count): one fresh navigation to /#/browse issued ${initialSearches} search requests within 1.5 s and no user scrolling; the Live provider's initial resync invalidation restarts the list from the top, so the rows are cleared and reloaded.`);
      await rec.shot(page, "browse-first", { desc: "Full-page capture of the first render: the 70vh results panel sits inside a taller page", how: "same state, fullPage screenshot", full: true });
      const panel = page.locator(".records-panel");
      await panel.evaluate((el) => { el.scrollTop = 700; });
      await page.waitForTimeout(300);
      await rec.shot(page, "browse-inner-scrolled", { desc: "Inner results panel scrolled (scrollTop=700) while the page stays at the top; sticky column header inside the panel", how: "set .records-panel.scrollTop=700 (this also triggers prefetch of the next batch)" });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
      await rec.shot(page, "browse-both-scrolled", { desc: "Both regions scrolled: page scrolled to its bottom and the panel scrolled 700 px (two scrollbars, header/search out of view)", how: "after the previous state, window.scrollTo(bottom)" });
      await rec.dump(page, "browse-both-scrolled");
      await panel.evaluate((el) => { el.scrollTop = 0; });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
      await rec.shot(page, "browse-page-scrolled", { desc: "Page scrolled to the bottom with the panel at its top (footer 'Load more records' button visible below the table)", how: "panel.scrollTop=0, window.scrollTo(bottom)" });

      // Drive infinite loading to the end, counting requests.
      page.requests.length = 0;
      const t0 = Date.now();
      let guard = 0;
      for (;;) {
        const status = await page.locator(".results-footer [role=status]").innerText();
        if (status.startsWith("All ")) break;
        if (++guard > 80) throw new Error("infinite loading did not terminate");
        await panel.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await page.waitForTimeout(120);
      }
      const loads = page.requests.filter((r) => r.url === "/api/v1/search").length;
      const stats = await page.evaluate(() => ({ rows: document.querySelectorAll(".records-panel tbody tr").length, nodes: document.getElementsByTagName("*").length, panelScrollHeight: document.querySelector(".records-panel").scrollHeight }));
      rec.note(`Measured infinite loading to exhaustion: ${loads} search requests (page size 20), ${Date.now() - t0} ms wall (includes 120 ms poll sleeps; load ${os_load()}), ${stats.rows} rows in the DOM, ${stats.nodes} DOM nodes, panel scrollHeight ${stats.panelScrollHeight} px. Rows are never virtualised or released.`);
      await rec.shot(page, "browse-all-loaded", { desc: "End of the list: footer 'All N records loaded', panel scrolled to the bottom", how: "scroll the panel to its end repeatedly until the footer says 'All …'", expect: [".results-footer"] });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);
      await rec.shot(page, "browse-all-loaded-page-bottom", { desc: "Same state with the page scrolled to the bottom", how: "window.scrollTo(bottom) after exhaustion" });
      await rec.dump(page, "browse-all-loaded");
      // Scroll chaining at the panel boundary: wheel over the panel at its bottom edge.
      await page.evaluate(() => window.scrollTo(0, 0));
      await panel.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(500);
      const before = await page.evaluate(() => ({ page: scrollY, panel: document.querySelector(".records-panel").scrollTop }));
      const box = await panel.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => ({ page: scrollY, panel: document.querySelector(".records-panel").scrollTop }));
      rec.note(`Measured (wheel 3000 px over the panel at its scroll end): before ${JSON.stringify(before)}, after ${JSON.stringify(after)}. Page scrollY changing while the pointer is over the panel = scroll chaining between nested regions.`);


      await panel.evaluate((el) => { el.scrollTop = 0; });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole("button", { name: "Sort by Project" }).click();
      await settle(page);
      await rec.shot(page, "browse-sorted-project-asc", { desc: "Sorted by Project ascending (arrow in header, 'Sorted by Project ↑' caption); list restarted at 20 rows", how: "click the Project column header", expect: ["th[aria-sort=ascending]"] });
      await page.getByRole("button", { name: "Sort by Project" }).click();
      await settle(page);
      await rec.shot(page, "browse-sorted-project-desc", { desc: "Sorted by Project descending", how: "click the Project header again", expect: ["th[aria-sort=descending]"] });
      await ctx.close();
    },
  },
  {
    name: "query", title: "Query input, completions, help, diagnostics, empty results",
    async run(env) {
      const { rec } = env;
      const { ctx, page } = await open(env);
      await gotoBrowse(page, env);
      const input = page.getByRole("combobox");
      await input.click();
      await rec.shot(page, "query-focused", { desc: "Query input focused, no text, no suggestions", how: "click the query combobox", expect: ["[role=combobox]"] });
      await input.fill("type:");
      await page.locator("[role=listbox] [role=option]").first().waitFor({ timeout: 8000 });
      await rec.shot(page, "query-completions", { desc: "Completion popup for 'type:' (values from the server) overlaying the results header", how: "type 'type:' in the query input", expect: ["[role=listbox]"] });
      await page.keyboard.press("Escape");
      await input.fill("type:todo AND tag:");
      await page.locator("[role=listbox] [role=option]").first().waitFor({ timeout: 8000 });
      await rec.shot(page, "query-completions-tag", { desc: "Completion popup for 'tag:' inside a compound expression, with the 'Draft changed · press Search' status", how: "type 'type:todo AND tag:'", expect: [".draft-status"] });
      await page.keyboard.press("Escape");
      await page.locator(".query-help summary").click();
      await rec.shot(page, "query-help-open", { desc: "'Search syntax' disclosure expanded under the input", how: "click the 'Search syntax' summary", expect: [".query-help[open]"] });
      await page.locator(".query-help summary").click();
      await input.fill("type:todo AND (");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("alert").first().waitFor({ timeout: 8000 });
      await settle(page);
      await rec.shot(page, "query-invalid", { desc: "Invalid-query error: alert plus diagnostics list with character spans", how: "submit 'type:todo AND ('", expect: ["[role=alert]"] });
      await input.fill("zzzz-no-such-record-anywhere");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await settle(page);
      await rec.shot(page, "query-empty-results", { desc: "Empty-state card 'No records found' (table header still rendered beneath)", how: "search for a string that matches nothing", expect: [".empty-state"] });
      await rec.dump(page, "query-empty");
      await input.fill("type:skill-draft tag:mcp");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await settle(page);
      await rec.shot(page, "query-filtered", { desc: "Filtered result (type:skill-draft tag:mcp): few rows, panel shorter than 70vh", how: "submit 'type:skill-draft tag:mcp'", expect: [".records-panel tbody tr"] });
      await ctx.close();
    },
  },
  {
    name: "nav", title: "Workspace tabs: Attention inbox, Upstream activity, Skill candidates, Archive",
    async run(env) {
      const { rec } = env;
      const { ctx, page } = await open(env);
      for (const [hash, slug, desc, full] of [
        ["#/inbox", "inbox", "Attention inbox: records with human-attention=required, own heading 'Waiting for review'", true],
        ["#/browse?q=type%3Agithub-issue%20OR%20type%3Agithub-pr", "upstream", "Upstream activity: github-issue/github-pr records (same table, preset query)", false],
        ["#/browse?q=type%3Askill-draft", "skills", "Skill candidates: skill-draft records (same table, preset query)", false],
        ["#/browse?q=archived%3Atrue", "archive", "Archive: archived:true records (same table, preset query)", true],
      ]) {
        await page.goto(`${env.base}/${hash}`);
        await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).waitFor();
        await settle(page);
        await rec.shot(page, `nav-${slug}`, { desc, how: `open /${hash}`, expect: [".records-panel tbody tr", "button[aria-current=page]"] });
        if (full) await rec.shot(page, `nav-${slug}`, { desc: desc + " (full page)", how: "same, fullPage", full: true });
      }
      await ctx.close();
    },
  },
  {
    name: "errors", title: "Search error and retry states",
    async run(env) {
      const { rec } = env;
      const fault = (code, message) => ({ status: 500, contentType: "application/json", body: JSON.stringify({ code, message, spans: [], currentRevision: null }) });
      let { ctx, page } = await open(env);
      await page.route("**/api/v1/search", (route) => route.fulfill(fault("internal", "synthetic backend failure")));
      await page.goto(`${env.base}/#/browse`);
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).waitFor();
      await page.getByRole("alert").first().waitFor();
      await page.waitForTimeout(300);
      await rec.shot(page, "error-search-failed", { desc: "First search fails (HTTP 500): alert 'Search failed: …' with Retry button above an empty table header (the empty-state card is suppressed while an error is shown)", how: "fulfill POST /api/v1/search with a 500 fault", expect: ["[role=alert]"] });
      await ctx.close();

      ({ ctx, page } = await open(env));
      await page.route("**/api/v1/search", (route) => route.abort("connectionrefused"));
      await page.goto(`${env.base}/#/browse`);
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).waitFor();
      await page.getByRole("alert").first().waitFor();
      await page.waitForTimeout(300);
      await rec.shot(page, "error-search-unreachable", { desc: "Search request aborted at the network level: 'Server unreachable' alert inside the otherwise normal shell", how: "abort POST /api/v1/search", expect: ["[role=alert]"] });
      await ctx.close();

      ({ ctx, page } = await open(env));
      await page.route("**/api/v1/search", (route) => /"cursor":"/.test(route.request().postData() ?? "") ? route.fulfill(fault("internal", "synthetic page-2 failure")) : route.continue());
      await page.goto(`${env.base}/#/browse`);
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).waitFor();
      await page.locator(".records-panel tbody tr").first().waitFor();
      await page.waitForTimeout(1500);
      await page.locator(".records-panel").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.getByRole("button", { name: "Retry loading records" }).waitFor();
      await rec.shot(page, "error-append-failed", { desc: "Second page fails: loaded rows kept, alert with 'Retry loading records' above the table, automatic loading stopped", how: "let page 1 through, fulfill page 2 with a 500 fault, scroll the panel to its end", expect: ["[role=alert]"] });
      await ctx.close();

      ({ ctx, page } = await open(env));
      await page.route("**/api/v1/search", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], cursor: null }) }));
      await page.goto(`${env.base}/#/inbox`);
      await page.locator(".empty-state").waitFor();
      await rec.shot(page, "empty-inbox", { desc: "Attention inbox with no records (server response replaced by an empty page): dashed empty-state card above an empty table header", how: "fulfill POST /api/v1/search with an empty result and open /#/inbox", expect: [".empty-state"] });
      await ctx.close();

      ({ ctx, page } = await open(env));
      let slow = 0;
      await page.route("**/api/v1/search", async (route) => { const cursor = /"cursor":"/.test(route.request().postData() ?? ""); if (cursor) { slow++; await sleep(4000); } await route.continue(); });
      await page.goto(`${env.base}/#/browse`);
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).waitFor();
      await page.locator(".records-panel tbody tr").first().waitFor();
      await page.waitForTimeout(1500);
      await page.locator(".records-panel").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.locator(".results-footer [role=status]", { hasText: "Loading more" }).waitFor({ timeout: 5000 });
      await rec.shot(page, "loading-more", { desc: "Next batch in flight (delayed 4 s): footer shows 'Loading more records…', Load more button disabled", how: "delay the cursor request, scroll the panel to its end", expect: [".results-footer button[disabled]"] });
      await ctx.close();

      ({ ctx, page } = await open(env));
      await page.route("**/api/v1/search", async (route) => { await sleep(4000); await route.continue(); });
      await page.goto(`${env.base}/#/browse`);
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Browse", exact: true }).waitFor();
      await page.waitForTimeout(600);
      await rec.shot(page, "loading-first", { desc: "First search in flight (delayed 4 s): 'Searching…' footer, no skeleton, empty table header only", how: "delay POST /api/v1/search, capture 600 ms after the shell renders", expect: [".results-footer"] });
      await ctx.close();
    },
  },

  {
    name: "edit", title: "UX-H4 record edit page: edit bar, typed field editors, raw JSON, validation, remote change, conflict, unconfirmed write, leave dialog",
    async run(env) {
      const { rec } = env;
      const h = heroes(env);
      const hero = await recordHero(env, "ponygirls:todo-capture-edit");
      const file = (state, width, dark) => `haystack-edit${state === "" ? "" : `-${state}`}${dark ? "-dark" : ""}-${width}.png`;
      const edit = async (page, key) => {
        await page.goto(`${env.base}/#/item/${enc(key)}`);
        await page.locator('[data-record="ready"]').waitFor();
        await page.getByRole("button", { name: "Edit", exact: true }).click();
        await page.locator('[data-record="editing"]').waitFor();
        await page.getByLabel("Title", { exact: true }).waitFor();
        await page.waitForTimeout(500);
      };
      // Opened from the Inbox list, as in the mockup: the masthead keeps Inbox current and Back reads "Inbox".
      const fromInbox = async (page) => {
        await page.goto(`${env.base}/#/inbox?${new URLSearchParams({ q: `id:"${hero.key}"` })}`); await settle(page);
        await page.locator(`[data-row-id="${hero.key}"]`).getByText(hero.title, { exact: true }).click();
        await page.locator('[data-record="ready"]').waitFor();
        await page.getByRole("button", { name: "Edit", exact: true }).click();
        await page.locator('[data-record="editing"]').waitFor();
        await page.getByLabel("Title", { exact: true }).waitFor();
        await page.waitForTimeout(500);
      };
      const touch = (page) => page.getByLabel("Title", { exact: true }).fill(`${hero.title} (draft)`);
      // The 1440 light pass changes the record under the editor and so runs last.
      for (const [viewport, width, dark] of [[SMALL, 1024, false], [MOBILE, 390, false], [DESKTOP, 1440, true], [DESKTOP, 1440, false]]) {
        const { ctx, page } = await open(env, { viewport, dark });
        await fromInbox(page);
        if (width === 1440 && !dark) await rec.shot(page, "edit-pristine", { file: file("pristine", width, false), desc: "Editor just opened: nothing changed, Save disabled", how: "open the record, click Edit", expect: [".edit-bar", ".rail"] });
        await touch(page);
        await rec.shot(page, "edit", { file: file("", width, dark), desc: "Edit page with a changed title: edit bar with the unsaved-changes chip, typed field editors, links, metadata rail", how: "open the record, click Edit, change the title", expect: [".edit-bar", ".rail"] });
        if (width === 1440 && !dark) {
          await rec.shot(page, "edit-full", { file: file("full", width, false), desc: "Full page", how: "fullPage screenshot", full: true });
          await rec.dump(page, "edit");
          await page.evaluate(() => window.scrollTo(0, 900)); await page.waitForTimeout(200);
          await rec.shot(page, "edit-scrolled", { file: file("scrolled", width, false), desc: "Scrolled 900 px: the edit bar sticks, the rail sticks", how: "scrollTo(0, 900)" });
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.getByRole("button", { name: "Raw JSON", exact: true }).click(); await page.getByLabel("Fields JSON").waitFor(); await page.waitForTimeout(200);
          await rec.shot(page, "edit-raw", { file: file("raw", width, false), desc: "Fields as raw JSON", how: "Raw JSON", expect: ["#edit-fields-json"] });
          await page.getByRole("button", { name: "Typed content", exact: true }).click();
          await page.getByLabel("Value: checklist", { exact: true }).fill('["reproduce", "fix" "verify"]');
          await page.getByRole("button", { name: "Add link", exact: true }).click();
          await page.locator('[role="alert"]', { hasText: "prevent" }).waitFor(); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
          await rec.shot(page, "edit-invalid", { file: file("invalid", width, false), desc: "Two problems: invalid JSON in a field and a link without a target; summary, inline messages, Save disabled", how: "break checklist, Add link", expect: [".error-list"] });
          await rec.shot(page, "edit-invalid-full", { file: file("invalid-full", width, false), desc: "Invalid, full page", how: "fullPage screenshot", full: true });
          await page.getByLabel("Value: checklist", { exact: true }).fill('["reproduce", "fix", "verify"]');
          await page.getByRole("button", { name: "Remove link 4", exact: true }).click();
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.getByRole("button", { name: "Cancel", exact: true }).click();
          await page.getByRole("dialog").waitFor(); await page.waitForTimeout(200);
          await rec.shot(page, "edit-leave", { file: file("leave", width, false), desc: "Cancel with unsaved changes asks in an in-app dialog (Cancel focused)", how: "Cancel", expect: ["dialog[open]"] });
          await page.keyboard.press("Escape");
          // Someone else saves while this draft is open; saving then reports the conflict.
          await bumpKey(env, hero.key, { title: `${hero.title} (rescoped)` });
          await page.getByText(/saved elsewhere/).waitFor(); await page.waitForTimeout(300);
          await page.evaluate(() => window.scrollTo(0, 0));
          await rec.shot(page, "edit-remote", { file: file("remote", width, false), desc: "Remote change while editing: info notice, draft kept", how: "put a newer revision through the API while the editor is open", expect: [".notice"] });
          await page.getByRole("button", { name: "Save as new revision", exact: true }).click();
          await page.getByText(/while you were editing/).waitFor(); await page.waitForTimeout(300);
          await page.evaluate(() => window.scrollTo(0, 0));
          await rec.shot(page, "edit-conflict", { file: file("conflict", width, false), desc: "Stale save: conflict notice with Review their changes / Overwrite / Discard mine; draft kept", how: "click Save after the concurrent put", expect: [".edit-page .notice-warn"] });
        }
        await ctx.close();
      }
      {
        // A draft survives leaving the editor by history; the record offers it, the editor restores it.
        const { ctx, page } = await open(env);
        await page.goto(`${env.base}/#/browse`);
        await page.goto(`${env.base}/#/item/${enc(h.fact.key)}`);
        await page.locator('[data-record="ready"]').waitFor();
        await page.getByRole("button", { name: "Edit", exact: true }).click();
        await page.locator('[data-record="editing"]').waitFor();
        await page.getByLabel("Title", { exact: true }).fill(`${h.fact.document.title} (draft kept)`);
        await page.evaluate(() => history.go(-2));
        await page.getByRole("note").filter({ hasText: "unsaved draft" }).waitFor(); await page.waitForTimeout(300);
        await rec.shot(page, "edit-draft-record", { file: "haystack-detail-draft-1440.png", desc: "The record page after leaving the editor by history with unsaved changes: 'You have an unsaved draft of this record' with Continue editing / Discard", how: "Edit, change the title, history.go(-2)", expect: ["[role=note]"] });
        await page.getByRole("button", { name: "Continue editing", exact: true }).click();
        await page.getByRole("status").filter({ hasText: "Unsaved draft restored" }).waitFor(); await page.waitForTimeout(300);
        await rec.shot(page, "edit-restored", { file: "haystack-edit-restored-1440.png", desc: "The editor restored from the kept draft: 'Unsaved draft restored — started from revision N' with Discard draft", how: "Continue editing", expect: [".edit-page [role=status]"] });
        await ctx.close();
      }
      {
        // Unconfirmed write: the server commits, the response is lost.
        const { ctx, page } = await open(env);
        await edit(page, h.fact2.key);
        await page.getByLabel("Title", { exact: true }).fill(`${h.fact2.document.title} (uncertain write)`);
        await page.route("**/api/v1/put", async (route) => { await route.fetch(); await route.abort("connectionreset"); });
        await page.getByRole("button", { name: "Save as new revision", exact: true }).click();
        await page.getByRole("button", { name: "Retry original write", exact: true }).waitFor(); await page.waitForTimeout(300);
        await rec.shot(page, "edit-pending", { file: file("pending", 1440, false), desc: "The outcome of the save is unknown: notice with Retry original write, Save disabled, bar chip 'Save not confirmed'", how: "intercept POST /api/v1/put: let the server commit, then reset the connection", expect: [".edit-page .notice-warn"] });
        await page.unroute("**/api/v1/put");
        await page.getByRole("button", { name: "Retry original write", exact: true }).click();
        await page.getByText(/Original write confirmed/).waitFor(); await page.waitForTimeout(300);
        await rec.shot(page, "edit-pending-resolved", { file: file("pending-resolved", 1440, false), desc: "After Retry original write: the confirmation, draft kept", how: "click Retry original write", expect: [".notice-ok"] });
        await ctx.close();
      }
    },
  },
  {
    name: "account", title: "Account / token-settings dialog (shared/account-web) in every reachable state",
    async run(env) {
      const { rec } = env;
      const dialog = "dialog[data-account-dialog]";
      const openDialog = async (page) => { await page.getByRole("button", { name: "Settings", exact: true }).click(); await page.locator(dialog).waitFor(); };
      const ready = async (page) => { await page.locator(`${dialog} .account-token-form`).waitFor(); await page.waitForTimeout(250); };
      const fresh = async (opts) => { const o = await open(env, opts); await gotoBrowse(o.page, env); return o; };
      const geometry = (page) => page.evaluate(() => { const d = document.querySelector("dialog[data-account-dialog]"); const r = d.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), scrollHeight: d.scrollHeight, clientHeight: d.clientHeight, overflowY: getComputedStyle(d).overflowY, pageScrollLocked: getComputedStyle(document.documentElement).overflow }; });

      let { ctx, page } = await fresh();
      await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.base });
      await openDialog(page);
      await ready(page);
      await rec.shot(page, "account-token-list", { desc: "Settings dialog, token list: three configured (read-only) tokens, none issued; create form on top, list below", how: "click Settings and wait for the account read", expect: [`${dialog} .account-token`] });
      await rec.dump(page, "account-dialog");
      rec.note(`Measured dialog geometry (1440x900): ${JSON.stringify(await geometry(page))}`);
      await page.getByRole("button", { name: "Create access token" }).click();
      await rec.shot(page, "account-validation-empty-name", { desc: "Create with an empty name: only the browser's native required-field bubble (not capturable headless); the page shows no inline message", how: "click 'Create access token' without a name", expect: [dialog] });
      await page.getByLabel("Token name").fill("ci-deploy-bot");
      await rec.shot(page, "account-form-filled", { desc: "Token name filled in, ready to create (single implicit scope 'api')", how: "type a token name", expect: [dialog] });
      await page.getByRole("button", { name: "Create access token" }).click();
      await page.locator(".account-secret").waitFor();
      await page.waitForTimeout(300);
      await rec.shot(page, "account-secret-shown", { desc: "One-time secret panel: warning text, readonly input with the 43-char secret, Copy / Dismiss buttons, status line", how: "create a token named ci-deploy-bot", expect: [".account-secret input"] });
      await page.getByRole("button", { name: "Copy secret" }).click();
      await page.getByText(/Secret copied|Clipboard unavailable/).waitFor();
      await rec.shot(page, "account-secret-copied", { desc: "After 'Copy secret': status line inside the secret panel", how: "click Copy secret", expect: [".account-secret [role=status]"] });
      // A window focus event (alt-tab back) re-opens the dialog and discards the secret.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForTimeout(800);
      const afterFocus = { secretPanel: await page.locator(".account-secret").count(), warning: await page.locator(".account-uncertain").innerText().catch(() => "") };
      rec.note(`Measured: dispatching a window 'focus' event while the one-time secret is displayed leaves ${afterFocus.secretPanel} secret panels; .account-uncertain text: "${afterFocus.warning.slice(0, 120)}…"`);
      await rec.shot(page, "account-secret-lost-on-focus", { desc: "State after the window regains focus while a secret was displayed: dialog re-opened by the shared script, secret gone, 'Creation succeeded, but its one-time secret was cleared' warning, further creation locked", how: "with the secret shown, dispatch a window 'focus' event (what alt-tab back does)", expect: [dialog] });
      await page.getByRole("button", { name: "Refresh token list" }).click();
      await page.getByText(/Token list refreshed/).waitFor();
      await rec.shot(page, "account-reconcile-ready", { desc: "After 'Refresh token list' the acknowledge button 'I checked the list; allow another token' is enabled", how: "click Refresh token list", expect: [".account-uncertain button:not([disabled])"] });
      await page.getByRole("button", { name: /I checked the list/ }).click();
      await page.waitForTimeout(200);
      await rec.shot(page, "account-issued-in-list", { desc: "Token list with the issued token (revoke button) beside the configured ones", how: "acknowledge the reconciliation", expect: [".account-token button"] });
      let confirmText = "";
      page.once("dialog", async (d) => { confirmText = `${d.type()}: ${d.message()}`; await d.accept(); });
      await page.getByRole("button", { name: /^Revoke ci-deploy-bot/ }).click();
      await page.getByText("Access token revoked.").waitFor();
      rec.note(`Revocation confirmation is a native window.confirm (not capturable in a screenshot): ${confirmText}`);
      await rec.shot(page, "account-revoked", { desc: "After the native confirm was accepted: token row shows 'Revoked' badge, status 'Access token revoked.'", how: "click Revoke on the issued token, accept window.confirm", expect: [".account-badge"] });
      // Escape with secret displayed.
      await page.getByLabel("Token name").fill("escape-test");
      await page.getByRole("button", { name: "Create access token" }).click();
      await page.locator(".account-secret").waitFor();
      await page.keyboard.press("Escape");
      await page.locator(dialog).waitFor({ state: "detached" });
      rec.note("Measured: pressing Escape while the one-time secret is shown closes the dialog immediately, without confirmation (secret is cleared).");
      await openDialog(page); await ready(page);
      await rec.shot(page, "account-reopen-after-escape", { desc: "Dialog re-opened after Escape discarded a displayed secret: recovery warning demands reconciliation", how: "Escape with the secret shown, click Settings again", expect: [".account-uncertain [role=alert]"] });
      await page.keyboard.press("Escape");

      // Long list of tokens.
      await page.evaluate(async () => {
        const account = await (await fetch("/api/account/v1", { credentials: "same-origin" })).json();
        for (let i = 1; i <= 14; i++) {
          const name = i % 4 === 0 ? `integration-token-with-a-very-long-descriptive-name-for-pipeline-${i}-` + "segment-".repeat(6) : `agent-token-${String(i).padStart(2, "0")}`;
          const r = await fetch("/api/account/v1/tokens", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json", "X-Account-Actor": account.user.actor }, body: JSON.stringify({ name, scopes: ["api"] }) });
          if (!r.ok) throw new Error("token seeding failed " + r.status);
        }
      });
      await openDialog(page); await ready(page);
      await rec.shot(page, "account-long-list", { desc: "Dialog with 15+ tokens: the dialog itself becomes the scroll container (overflow:auto, max-height 100dvh-1.5rem); create form scrolls away with the list", how: "seed 14 more tokens through the account API, open Settings", expect: [".account-token"] });
      rec.note(`Measured dialog geometry with ${await page.locator(".account-token").count()} tokens listed: ${JSON.stringify(await geometry(page))}`);
      await page.locator(dialog).evaluate((d) => { d.scrollTop = d.scrollHeight; });
      await page.waitForTimeout(200);
      await rec.shot(page, "account-long-list-scrolled", { desc: "Same dialog scrolled to its end", how: "scroll the dialog to the bottom", expect: [dialog] });
      await page.keyboard.press("Escape");
      await ctx.close();

      // Error states with intercepted account routes.
      const err = (status) => ({ status, contentType: "application/json", body: JSON.stringify({ error: { code: "synthetic", message: "synthetic" } }) });
      ({ ctx, page } = await fresh());
      await page.route("**/api/account/v1", async (route) => { await sleep(3000); await route.continue(); });
      await openDialog(page); await page.waitForTimeout(500);
      await rec.shot(page, "account-loading", { desc: "Dialog while the account read is pending (3 s): heading + 'Loading account settings…' only", how: "delay GET /api/account/v1, click Settings, capture at 500 ms", expect: [`${dialog} [role=status]`] });
      await ctx.close();

      ({ ctx, page } = await fresh());
      await page.route("**/api/account/v1", (route) => route.fulfill(err(500)));
      await openDialog(page);
      await page.getByRole("button", { name: "Retry loading settings" }).waitFor();
      await rec.shot(page, "account-error-load", { desc: "Account read fails (HTTP 500): generic 'service unavailable' error and a Retry button", how: "fulfill GET /api/account/v1 with 500", expect: [".account-error"] });
      await ctx.close();

      ({ ctx, page } = await fresh());
      await page.route("**/api/account/v1", (route) => route.fulfill(err(401)));
      await openDialog(page);
      await page.locator(".account-error:not([hidden])").waitFor();
      await rec.shot(page, "account-error-401", { desc: "Session no longer authorized (401) while the dialog is open: error text only; the page behind is unaware", how: "fulfill GET /api/account/v1 with 401", expect: [".account-error"] });
      await ctx.close();

      ({ ctx, page } = await fresh());
      await page.route("**/api/account/v1/tokens", (route) => route.fulfill(err(403)));
      await openDialog(page); await ready(page);
      await page.getByLabel("Token name").fill("will-be-forbidden");
      await page.getByRole("button", { name: "Create access token" }).click();
      await page.locator(".account-error:not([hidden])").waitFor();
      await rec.shot(page, "account-error-create-403", { desc: "Create rejected (403): error plus the 'Creation outcome is unknown' recovery warning (a 4xx still counts as uncertain)", how: "fulfill POST /api/account/v1/tokens with 403", expect: [".account-uncertain [role=alert]"] });
      await ctx.close();

      ({ ctx, page } = await fresh());
      await page.route("**/api/account/v1/tokens", (route) => route.abort("connectionreset"));
      await openDialog(page); await ready(page);
      await page.getByLabel("Token name").fill("lost-response");
      await page.getByRole("button", { name: "Create access token" }).click();
      await page.locator(".account-uncertain [role=alert]").waitFor();
      await rec.shot(page, "account-error-create-network", { desc: "Create request lost at the network level: unavailable error + unknown-outcome warning; acknowledge button disabled until the list is refreshed", how: "abort POST /api/account/v1/tokens", expect: [".account-uncertain button[disabled]"] });
      await ctx.close();

      ({ ctx, page } = await fresh());
      await openDialog(page); await ready(page);
      await page.route("**/api/account/v1/tokens/*/revoke", (route) => route.fulfill(err(403)));
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: /^Revoke / }).first().click();
      await page.locator(".account-error:not([hidden])").waitFor();
      await rec.shot(page, "account-error-revoke-403", { desc: "Revoke rejected (403): error + 'Revocation could not be confirmed' status", how: "fulfill POST …/revoke with 403, accept the confirm", expect: [".account-error"] });
      await ctx.close();

      // Variants: dark, 1024x700, phone.
      for (const [label, opts] of [["dark", { dark: true }], ["1024", { viewport: SMALL }], ["390", { viewport: MOBILE }]]) {
        ({ ctx, page } = await fresh(opts));
        await openDialog(page); await ready(page);
        await rec.shot(page, `account-token-list-${label}`, { desc: `Token list, ${label === "dark" ? "dark theme (the dialog follows prefers-color-scheme via its own variables)" : label === "1024" ? "1024x700 viewport" : "390x844 phone viewport (extra)"}`, how: "click Settings", expect: [".account-token"] });
        if (label !== "390") {
          await page.getByLabel("Token name").fill(`variant-${label}`);
          await page.getByRole("button", { name: "Create access token" }).click();
          await page.locator(".account-secret").waitFor();
          await rec.shot(page, `account-secret-shown-${label}`, { desc: `One-time secret panel, ${label === "dark" ? "dark theme" : "1024x700 viewport"}`, how: "create a token", expect: [".account-secret"] });
        }
        await ctx.close();
      }
    },
  },
  {
    name: "live", title: "Connection indicator (live updates) and live-refresh behaviour",
    async run(env) {
      const { rec } = env;
      let { ctx, page } = await open(env);
      await gotoBrowse(page, env);
      await page.waitForTimeout(2500);
      await rec.shot(page, "live-indicator-collapsed", { desc: "Header strip with the connection widget collapsed ('Live', ring + dot)", how: "open /#/browse and wait for the websocket", clip: { x: 0, y: 0, width: 1440, height: 64 }, expect: [".connection-widget[data-state=ALIVE]"] });
      await page.getByRole("button", { name: /^Connection:/ }).click();
      await page.waitForTimeout(400);
      await rec.shot(page, "live-panel-expanded", { desc: "Connection health popover: description, attempt counter, per-connection pool stats (uptime, pending, % missed, RTT windows), Event log disclosure, Try again", how: "click the connection button", expect: [".connection-panel"] });
      await page.locator(".connection-panel summary", { hasText: "Event log" }).click();
      await rec.shot(page, "live-panel-event-log", { desc: "Popover with the Event log opened (internal scroll list, max-height 180px, inside a popover that itself scrolls at calc(100dvh-100px))", how: "expand 'Event log'", expect: [".connection-log"] });
      await rec.dump(page, "live-panel");
      await ctx.close();

      ({ ctx, page } = await open(env));
      await page.routeWebSocket(/\/api\/v1\/live/, (ws) => { ws.close({ code: 1011, reason: "synthetic close" }); });
      await gotoBrowse(page, env);
      const states = [];
      for (let i = 0; i < 12; i++) { states.push(await page.locator(".connection-widget").getAttribute("data-state")); await page.waitForTimeout(1500); }
      rec.note(`Measured data-state of the connection widget every 1.5 s while every websocket is closed by the server: ${states.join(" → ")}`);
      await page.getByRole("button", { name: /^Connection:/ }).click();
      await page.waitForTimeout(300);
      await rec.shot(page, "live-panel-disconnected", { desc: `Connection popover while the websocket keeps closing (widget stays in state ${states.at(-1)}, label \'Connecting\'; popover text \'Displayed records may be out of date.\')`, how: "route /api/v1/live to an immediate close and wait 18 s", expect: [".connection-panel"] });
      await page.keyboard.press("Escape");
      await ctx.close();

      // Live refresh while the user is scrolled deep into the list.
      ({ ctx, page } = await open(env));
      await gotoBrowse(page, env);
      await page.waitForTimeout(1800);
      const panel = page.locator(".records-panel");
      for (let i = 0; i < 4; i++) { await panel.evaluate((el) => { el.scrollTop = el.scrollHeight; }); await page.waitForTimeout(500); }
      const rowsBefore = await page.locator(".records-panel tbody tr").count();
      await panel.evaluate((el) => { el.scrollTop = 1200; });
      const topBefore = await panel.evaluate((el) => el.scrollTop);
      await rec.shot(page, "live-before-remote-change", { desc: `List scrolled to 1200 px with ${rowsBefore} rows loaded, before another writer changes any record`, how: "load 4 extra batches, scroll the panel to 1200", expect: [".records-panel tbody tr"] });
      const target = env.corpus.find((d) => d.document.status === "actual" && d.document.type === "note") ?? env.corpus.find((d) => d.document.status === "actual");
      await bump(env, target, { description: target.document.description + " (live change)" });
      let seenEmpty = false;
      for (let i = 0; i < 40; i++) { if ((await page.locator(".records-panel tbody tr").count()) === 0) seenEmpty = true; await page.waitForTimeout(50); }
      const rowsAfter = await page.locator(".records-panel tbody tr").count();
      const topAfter = await panel.evaluate((el) => el.scrollTop);
      rec.note(`Measured live refresh: another user's put of an unrelated record changed the panel from ${rowsBefore} rows / scrollTop ${topBefore} to ${rowsAfter} rows / scrollTop ${topAfter}; table was empty at some instant: ${seenEmpty}. The list restarts from the first page on every invalidation.`);
      await rec.shot(page, "live-after-remote-change", { desc: "Same list after the remote change: back to the first batch and scrolled to the top (position and loaded pages lost)", how: "put an unrelated record through the API", expect: [".records-panel tbody tr"] });
      await ctx.close();
    },
  },
  {
    name: "focus", title: "Keyboard focus, shortcuts",
    async run(env) {
      const { rec } = env;
      const { ctx, page } = await open(env);
      await gotoBrowse(page, env);
      await page.keyboard.press("Tab");
      await rec.shot(page, "focus-skip-link", { desc: "First Tab: 'Skip to main content' link becomes visible at top-left", how: "press Tab once after load", expect: [".skip:focus"] });
      let tabs = 1;
      for (; tabs < 80; tabs++) { await page.keyboard.press("Tab"); if (await page.evaluate(() => document.activeElement?.classList.contains("record-open"))) break; }
      rec.note(`Measured: ${tabs + 1} Tab presses from page load to the first record's open button (skip link, brand, Settings, Sign out, connection, 5 nav tabs, query, clear, Search, help, results region, 9 sort headers…).`);
      await rec.shot(page, "focus-record-row", { desc: "Keyboard focus ring on the first record's open button after tabbing through header, nav, search and sort headers", how: "Tab until a .record-open button is active", expect: [".record-open:focus-visible"] });
      await page.keyboard.press("Control+k");
      await rec.shot(page, "focus-ctrl-k", { desc: "Ctrl+K focuses and selects the query input", how: "press Ctrl+K", expect: ["[role=combobox]:focus"] });
      await page.locator(".records-panel").focus();
      await rec.shot(page, "focus-results-region", { desc: "The scrollable results region is itself a tab stop (tabindex=0) and shows a focus ring around the whole table", how: "focus .records-panel", expect: [".records-panel:focus-visible"] });
      await ctx.close();
    },
  },
  {
    name: "responsive", title: "1024x700 secondary viewport (key pages) and phone extras",
    async run(env) {
      const { rec } = env;
      const h = heroes(env);
      let { ctx, page } = await open(env, { viewport: SMALL });
      await gotoBrowse(page, env);
      await rec.shot(page, "browse-first", { desc: "Browse at 1024x700: below the 1100px breakpoint the table is turned into stacked label/value cards (display:block table), 3-column grid per row", how: "open /#/browse at 1024x700", expect: [".records-panel tbody tr"] });
      await rec.shot(page, "browse-first", { desc: "Full page at 1024x700", how: "fullPage", full: true });
      await rec.dump(page, "browse-1024");
      await page.locator(".records-panel").evaluate((el) => { el.scrollTop = 600; });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
      await rec.shot(page, "browse-both-scrolled", { desc: "Both regions scrolled at 1024x700", how: "panel.scrollTop=600 and window scrolled to bottom", expect: [".records-panel"] });
      await page.goto(`${env.base}/#/inbox`); await settle(page);
      await rec.shot(page, "nav-inbox", { desc: "Attention inbox at 1024x700", how: "open /#/inbox", expect: [".records-panel tbody tr"] });
      await page.goto(`${env.base}/#/item/${enc(h.skill.key)}`); await page.locator(".detail-view > .page-heading h1").waitFor(); await page.waitForTimeout(600);
      await rec.shot(page, "detail-skill", { desc: "Skill detail at 1024x700", how: "open the skill record", expect: [".fields-view"] });
      await page.goto(`${env.base}/#/browse`); await settle(page);
      await page.getByRole("combobox").fill("type:"); await page.locator("[role=listbox] [role=option]").first().waitFor({ timeout: 8000 });
      await rec.shot(page, "query-completions", { desc: "Query completions at 1024x700", how: "type 'type:'", expect: ["[role=listbox]"] });
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Connection:/ }).click(); await page.waitForTimeout(300);
      await rec.shot(page, "live-panel-expanded", { desc: "Connection popover at 1024x700", how: "click the connection button", expect: [".connection-panel"] });
      await ctx.close();

      ({ ctx, page } = await open(env, { viewport: MOBILE }));
      await gotoBrowse(page, env);
      await rec.shot(page, "browse-first", { desc: "Browse at phone width (extra)", how: "390x844 viewport", expect: [".records-panel tbody tr"] });
      await rec.shot(page, "browse-first", { desc: "Full page at phone width (extra)", how: "fullPage", full: true });
      await page.goto(`${env.base}/#/item/${enc(h.todo.key)}`); await page.locator(".detail-view > .page-heading h1").waitFor(); await page.waitForTimeout(600);
      await rec.shot(page, "detail-todo", { desc: "Todo detail at phone width (extra)", how: "open the todo record", expect: [".detail-view"] });
      await ctx.close();
    },
  },
  {
    name: "dark", title: "Dark theme (prefers-color-scheme: dark) key pages",
    async run(env) {
      const { rec } = env;
      const h = heroes(env);
      const { ctx, page } = await open(env, { dark: true });
      await gotoBrowse(page, env);
      await rec.shot(page, "browse-first", { desc: "Browse, dark theme", how: "open /#/browse with colorScheme=dark", expect: [".records-panel tbody tr"] });
      await rec.shot(page, "browse-first", { desc: "Browse, dark theme, full page", how: "fullPage", full: true });
      await page.getByRole("combobox").fill("type:"); await page.locator("[role=listbox] [role=option]").first().waitFor({ timeout: 8000 });
      await rec.shot(page, "query-completions", { desc: "Query completions, dark theme", how: "type 'type:'", expect: ["[role=listbox]"] });
      await page.keyboard.press("Escape");
      await page.goto(`${env.base}/#/inbox`); await settle(page);
      await rec.shot(page, "nav-inbox", { desc: "Attention inbox, dark theme", how: "open /#/inbox", expect: [".records-panel tbody tr"] });
      await page.goto(`${env.base}/#/item/${enc(h.skill.key)}`); await page.locator(".detail-view > .page-heading h1").waitFor(); await page.waitForTimeout(600);
      await rec.shot(page, "detail-skill", { desc: "Skill detail, dark theme (highlight colours on dark surfaces)", how: "open the skill record", expect: [".fields-view"] });
      await page.getByRole("button", { name: /^Connection:/ }).click(); await page.waitForTimeout(300);
      await rec.shot(page, "live-panel-expanded", { desc: "Connection popover, dark theme", how: "click the connection button", expect: [".connection-panel"] });
      await ctx.close();
    },
  },
  {
    // UX-H1 (shell): outputs are named like the mockup shots for comparison through `look` (spec §8 item 10).
    name: "shell", title: "UX-H1 shell: masthead, presets, record, connection popover, account outlet, sign-in",
    async run(env) {
      const { rec } = env;
      const h = heroes(env);
      const nav = (page) => page.getByRole("navigation", { name: "Main navigation" });
      // Opened from the Inbox list, as in the mockup: the record keeps Inbox highlighted.
      const record = async (page, key) => {
        await page.goto(`${env.base}/#/inbox?${new URLSearchParams({ q: `id:"${key}"` })}`); await settle(page);
        await page.getByRole("button", { name: key, exact: true }).click();
        await page.getByRole("button", { name: "Edit", exact: true }).waitFor(); await page.waitForTimeout(400);
      };
      for (const [viewport, width] of [[DESKTOP, 1440], [SMALL, 1024], [MOBILE, 390]]) for (const dark of [false, true]) {
        const suffix = `${dark ? "-dark" : ""}-${width}`;
        const { ctx, page } = await open(env, { viewport, dark });
        await gotoBrowse(page, env);
        await rec.shot(page, "shell-browse", { file: `haystack-browse${suffix}.png`, desc: "Browse under the new masthead (view inside not restyled yet: UX-H2)", how: "open /#/browse", expect: ["header nav a[aria-current=page]"] });
        await nav(page).getByRole("link", { name: "Inbox", exact: true }).click(); await settle(page);
        await rec.shot(page, "shell-inbox", { file: `haystack-browse-inbox${suffix}.png`, desc: "Inbox preset route: nav highlight and count", how: "click Inbox in the masthead", expect: ["header nav a[aria-current=page]"] });
        await record(page, h.todo.key);
        await rec.shot(page, "shell-record", { file: `haystack-detail${suffix}.png`, desc: "Record route under the new masthead (inside not restyled yet: UX-H3)", how: `open the record from the Inbox list (#/inbox?q=id:"…")`, expect: ["header nav"] });
        await page.getByRole("button", { name: /^Connection:/ }).click();
        await page.getByText("Event log", { exact: true }).click();
        await rec.shot(page, "shell-connection", { file: `haystack-connection-live${suffix}.png`, desc: "Connection popover, Live, event log open", how: "click the masthead indicator, open Event log", expect: ["#connection-details"] });
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "op", exact: true }).click();
        await rec.shot(page, "shell-user-menu", { file: `haystack-user-menu${suffix}.png`, desc: "User menu (no Users entry: this server has no GET /profile)", how: "click the user button", expect: ["[role=menu]"] });
        await page.getByRole("menuitem", { name: "Access tokens", exact: true }).click();
        await page.getByRole("heading", { name: "Access tokens", exact: true }).waitFor(); await page.waitForTimeout(400);
        await rec.shot(page, "shell-tokens", { file: `account-settings-tokens-haystack${suffix}.png`, desc: "Access tokens in the account outlet (degraded server: login + tokens only)", how: "user menu → Access tokens", expect: ["[data-account-outlet] table"] });
        await ctx.close();
      }
      // Connection popover states over a routed live socket: reconnecting (each attempt closed 1011), offline (permanent close).
      for (const [state, code] of [["reconnecting", 1011], ["offline", 1007]]) for (const dark of [false, true]) {
        const { ctx, page } = await open(env, { dark });
        const reason = state === "offline" ? "Injected invalid payload" : "server restart";
        let first = null;
        await page.routeWebSocket(/\/api\/v1\/live$/, (socket) => {
          if (first !== null) { void socket.close({ code, reason }); return; }
          first = socket; socket.connectToServer();
        });
        await gotoBrowse(page, env);
        await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
        await first.close({ code, reason });
        const label = state === "offline" ? "Connection: Offline" : /^Connection: Reconnecting, attempt [2-9]/;
        await page.getByRole("button", { name: label }).waitFor({ timeout: 15000 });
        await page.getByRole("button", { name: label }).click();
        await page.getByText("Event log", { exact: true }).click();
        await rec.shot(page, `shell-connection-${state}`, { file: `haystack-connection-${state}${dark ? "-dark" : ""}-1440.png`, desc: `Connection popover, ${state}`, how: `route /api/v1/live: close the live socket and every later one with ${code}`, expect: ["#connection-details"] });
        await ctx.close();
      }
      for (const [viewport, width] of [[DESKTOP, 1440], [SMALL, 1024], [MOBILE, 390]]) for (const dark of [false, true]) {
        const { ctx, page } = await open(env, { auth: false, viewport, dark });
        await page.goto(`${env.base}/#/browse`);
        await page.getByLabel("Username", { exact: true }).waitFor();
        await rec.shot(page, "shell-login", { file: `account-login-default-haystack${dark ? "-dark" : ""}-${width}.png`, desc: "Sign-in card rendered by the shared module into the auth mount", how: "open /#/browse without a session", expect: ["form[data-account-login]"] });
        await ctx.close();
      }
    },
  },
  {
    name: "record", title: "UX-H3 record page: header bar, notices, typed fields, links, metadata and history rail, snapshot, restore",
    async run(env) {
      const { rec } = env;
      const h = heroes(env);
      const hero = await recordHero(env, "ponygirls:todo-capture");
      const ready = async (page) => {
        await page.locator('[data-record="ready"], [data-record="snapshot"]').waitFor();
        await page.locator(".hist-row").first().waitFor(); await page.waitForTimeout(300);
      };
      // Opened from the Inbox list, as in the mockup: Back reads "Inbox" and the masthead keeps Inbox current.
      const fromInbox = async (page) => {
        await page.goto(`${env.base}/#/inbox?${new URLSearchParams({ q: `id:"${hero.key}"` })}`); await settle(page);
        await page.locator(`[data-row-id="${hero.key}"]`).getByText(hero.title, { exact: true }).click();
        await ready(page);
      };
      const file = (state, width, dark) => `haystack-detail${state === "" ? "" : `-${state}`}${dark ? "-dark" : ""}-${width}.png`;
      for (const [viewport, width] of [[DESKTOP, 1440], [SMALL, 1024], [MOBILE, 390]]) for (const dark of [false, true]) {
        if (width !== 1440 && dark) continue;
        const { ctx, page } = await open(env, { viewport, dark });
        await fromInbox(page);
        await rec.shot(page, "record", { file: file("", width, dark), desc: "Record opened from Inbox: header bar, review notice, description, fields, rail", how: "Inbox filtered to the hero, click its row", expect: [".record-bar", ".rail"] });
        if (width === 1440 && !dark) {
          await rec.shot(page, "record-full", { file: file("full", width, false), desc: "Full page", how: "fullPage screenshot", full: true });
          await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(200);
          await rec.shot(page, "record-scrolled", { file: file("scrolled", width, false), desc: "Scrolled 700 px: header bar sticks, rail sticks", how: "scrollTo(0, 700)" });
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.getByRole("group", { name: "View of notes", exact: true }).getByRole("button", { name: "Source", exact: true }).click(); await page.waitForTimeout(200);
          await rec.shot(page, "record-source", { file: file("source", width, false), desc: "Markdown field switched to Source", how: "Rendered | Source → Source" });
          await page.getByRole("group", { name: "View of notes", exact: true }).getByRole("button", { name: "Rendered", exact: true }).click();
          await page.getByRole("button", { name: "More actions", exact: true }).click();
          await page.getByRole("menuitem", { name: "View raw JSON", exact: true }).click(); await page.waitForTimeout(200);
          await rec.shot(page, "record-raw", { file: file("raw", width, false), desc: "Fields as raw JSON", how: "⋯ → View raw JSON", expect: ['[aria-label="Fields JSON"]'] });
          await page.getByRole("button", { name: "Typed view", exact: true }).click();
          await page.getByRole("button", { name: "View revision 3", exact: true }).click();
          await page.getByRole("heading", { name: "Changes from revision 3 to revision 4", exact: true }).waitFor(); await page.waitForTimeout(300);
          await rec.shot(page, "record-snapshot", { file: file("snapshot", width, false), desc: "Snapshot of revision 3 compared with the latest", how: "History → View revision 3", expect: ['[aria-label="Snapshot"]'] });
          await rec.shot(page, "record-snapshot-full", { file: file("snapshot-full", width, false), desc: "Snapshot, full page", how: "fullPage screenshot", full: true });
          await page.getByRole("region", { name: "Snapshot", exact: true }).getByRole("button", { name: "Restore as new revision", exact: true }).click();
          await page.getByRole("dialog").waitFor(); await page.waitForTimeout(200);
          await rec.shot(page, "record-restore-confirm", { file: file("restore-confirm", width, false), desc: "Restore confirmation (in-app dialog, Cancel focused)", how: "banner → Restore as new revision", expect: ["dialog[open]"] });
          await page.keyboard.press("Escape");
        }
        await ctx.close();
      }
      {
        const { ctx, page } = await open(env);
        await page.route("**/api/v1/get", () => {}); // never answered: the loading state stays
        await page.goto(`${env.base}/#/item/${enc(hero.key)}`);
        await page.locator('[data-record="loading"]').waitFor(); await page.waitForTimeout(300);
        await rec.shot(page, "record-loading", { file: file("loading", 1440, false), desc: "Loading state (get request held)", how: "route /api/v1/get without answering" });
        await ctx.close();
      }
      {
        const { ctx, page } = await open(env);
        await page.goto(`${env.base}/#/item/${enc("ponygirls:does-not-exist")}`);
        await page.locator('[data-record="missing"]').waitFor(); await page.waitForTimeout(300);
        await rec.shot(page, "record-not-found", { file: file("not-found", 1440, false), desc: "Unknown key", how: "open /#/item/ponygirls:does-not-exist" });
        await page.goto(`${env.base}/#/skills?${new URLSearchParams({ q: `id:"${h.skill.key}"` })}`); await settle(page);
        await page.locator(`[data-row-id="${h.skill.key}"]`).getByText(h.skill.document.title, { exact: true }).click();
        await ready(page);
        await rec.shot(page, "record-skill", { file: file("skill", 1440, false), desc: "Skill draft opened from Skill drafts: info notice, long Markdown field", how: "Skill drafts filtered to the hero, click its row" });
        await page.evaluate(() => window.scrollTo(0, 1400)); await page.waitForTimeout(200);
        await rec.shot(page, "record-skill-scrolled", { file: file("skill-scrolled", 1440, false), desc: "Skill draft scrolled 1400 px", how: "scrollTo(0, 1400)" });
        await page.goto(`${env.base}/#/item/${enc(h.archived.key)}`); await ready(page);
        await rec.shot(page, "record-archived", { file: file("archived", 1440, false), desc: "Archived record: neutral notice and chip", how: `open /#/item/${h.archived.key}` });
        await fromInbox(page);
        await page.getByRole("note").getByRole("button", { name: "Clear attention", exact: true }).click();
        await page.getByText(/^Attention cleared/).waitFor(); await ready(page);
        await rec.shot(page, "record-cleared", { file: file("cleared", 1440, false), desc: "After Clear attention: toast, notice gone", how: "notice → Clear attention", expect: [".toast"] });
        await page.getByRole("button", { name: "Edit", exact: true }).click();
        await page.getByLabel("Title", { exact: true }).fill(`${hero.title} (edited)`);
        await page.getByRole("button", { name: "Save as new revision", exact: true }).click();
        await page.getByText(/^Saved as revision/).waitFor(); await ready(page);
        await rec.shot(page, "record-saved", { file: "haystack-edit-saved-1440.png", desc: "After saving in the editor: toast with View changes", how: "Edit → change the title → Save as new revision", expect: [".toast"] });
        await ctx.close();
      }
    },
  },
  {
    // UX-H2 (Browse and presets): every state of haystack-browse.html, named like the mockup shots (spec §8 item 10).
    name: "browse-h2", title: "UX-H2 Browse: presets, query states, list states, widths and theme",
    async run(env) {
      const { rec } = env;
      const shot = (page, state, how, expect) => rec.shot(page, `h2-${state}`, { file: `haystack-browse-${state}.png`, desc: `Browse: ${state}`, how, expect });
      const rows = "section.browse:not([hidden] *) tbody tr[data-row-id]";
      const shown = (page) => page.locator("section.browse").filter({ visible: true });
      const atEnd = (page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const loaded = (page, n) => page.waitForFunction((count) => [...document.querySelectorAll("section.browse")].some((v) => v.getClientRects().length > 0 && v.querySelectorAll("tbody tr[data-row-id]").length >= count), n);
      for (const [viewport, width] of [[DESKTOP, 1440], [SMALL, 1024], [MOBILE, 390]]) for (const dark of [false, true]) {
        if (dark && width !== 1440) continue;
        const { ctx, page } = await open(env, { viewport, dark });
        await gotoBrowse(page, env);
        await shot(page, `${dark ? "dark-" : ""}${width}`, "open /#/browse", [rows]);
        await ctx.close();
      }
      let { ctx, page } = await open(env);
      await gotoBrowse(page, env);
      for (let batch = 2; batch <= 5; batch++) { await atEnd(page); await loaded(page, 20 * batch); await settle(page); }
      await page.evaluate(() => window.scrollTo(0, 2600));
      await shot(page, "scrolled-1440", "load five batches by scrolling the document, window.scrollTo(0, 2600)", [rows]);
      await rec.dump(page, "h2-scrolled");
      const target = env.corpus.find((d) => d.document.status === "actual" && d.document.type === "note") ?? env.corpus.find((d) => d.document.status === "actual");
      await page.evaluate(() => window.scrollTo(0, 900));
      await bump(env, target, { description: target.document.description + " (live change)" });
      await page.getByRole("button", { name: "Records changed · Show", exact: true }).waitFor();
      await shot(page, "updates-1440", "five batches loaded, scrolled to 900, another user saves a record", [".update-pill button"]);
      await ctx.close();
      ({ ctx, page } = await open(env));
      for (const [state, label] of [["inbox", "Inbox"], ["upstream", "Upstream"], ["skills", "Skill drafts"], ["archive", "Archive"]]) {
        await gotoBrowse(page, env, `#/${state}`);
        await shot(page, `${state}-1440`, `open the ${label} preset (#/${state})`, [rows]);
      }
      await gotoBrowse(page, env);
      const input = shown(page).getByRole("combobox", { name: "Query", exact: true });
      await input.fill("type:");
      await shown(page).getByRole("option").first().waitFor();
      await shot(page, "completions-1440", "type 'type:' in the query bar (draft, completions from the server)", ["[role=listbox]"]);
      await page.keyboard.press("Escape");
      await input.fill("type:todo AND (");
      await shown(page).getByRole("button", { name: "Search", exact: true }).click();
      await shown(page).getByRole("list", { name: "Search errors" }).waitFor(); await settle(page);
      await shot(page, "invalid-1440", "submit 'type:todo AND ('", ["[role=alert]"]);
      await input.fill('project:atlantis tag:"machine learning"');
      await shown(page).getByRole("button", { name: "Search", exact: true }).click();
      await shown(page).getByRole("heading", { name: "No matching records", exact: true }).waitFor();
      await shot(page, "empty-1440", "submit a query that matches nothing", [".empty"]);
      await input.fill("type:decision");
      await shown(page).getByRole("button", { name: "Search", exact: true }).click();
      await settle(page);
      for (let guard = 0; await shown(page).locator("[data-list-end]").count() === 0; guard++) {
        if (guard > 20) throw new Error("the filtered list did not end");
        const before = await page.locator(rows).count();
        await atEnd(page);
        await page.waitForFunction((count) => [...document.querySelectorAll("section.browse")].some((v) => v.getClientRects().length > 0 &&
          (v.querySelector("[data-list-end]") !== null || v.querySelectorAll("tbody tr[data-row-id]").length > count)), before);
        await settle(page);
      }
      await atEnd(page);
      await shot(page, "end-1440", "submit 'type:decision', scroll the document to the end of the list", ["[data-list-end]"]);
      await shown(page).getByRole("button", { name: "Query syntax", exact: true }).click();
      await page.getByRole("dialog", { name: "Query syntax" }).waitFor();
      await shot(page, "syntax-1440", "click 'Query syntax' in the filter row", ["dialog[open]"]);
      await ctx.close();

      const fault = { status: 500, contentType: "application/json", body: JSON.stringify({ code: "internal", message: "search-unavailable", spans: [], currentRevision: null }) };
      ({ ctx, page } = await open(env));
      await page.route("**/api/v1/search", (route) => route.request().postDataJSON().limit === 20 ? route.fulfill(fault) : route.continue());
      await gotoBrowse(page, env);
      await shown(page).getByRole("alert").waitFor();
      await shot(page, "error-1440", "fulfill the list's search with HTTP 500", ["[role=alert]"]);
      await ctx.close();
      ({ ctx, page } = await open(env));
      await page.route("**/api/v1/search", (route) => route.request().postDataJSON().cursor ? route.fulfill(fault) : route.continue());
      await gotoBrowse(page, env);
      await atEnd(page);
      await shown(page).getByRole("button", { name: "Retry loading records", exact: true }).waitFor();
      await atEnd(page);
      await shot(page, "append-error-1440", "first batch loads, the next batch fails (HTTP 500); scroll to the end", ["[role=alert]"]);
      await ctx.close();
      ({ ctx, page } = await open(env));
      await page.route("**/api/v1/search", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], cursor: null }) }));
      await gotoBrowse(page, env, "#/inbox");
      await shown(page).getByRole("heading", { name: "Inbox zero", exact: true }).waitFor();
      await shot(page, "inbox-empty-1440", "open #/inbox with every search answered by an empty page", [".empty"]);
      await ctx.close();
      ({ ctx, page } = await open(env));
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await page.route("**/api/v1/search", async (route) => { if (route.request().postDataJSON().limit === 20) await held; await route.continue(); });
      await page.goto(`${env.base}/#/browse`);
      await page.locator("section.browse [data-skeleton]").first().waitFor();
      await shot(page, "loading-1440", "hold the list's first search", ["[data-skeleton]"]);
      release();
      await ctx.close();
    },
  },
  {
    name: "browse-fin", title: "Browse after FIN-H: filter toggles applied (Needs review, Modified by me) and the offline inline warning",
    async run(env) {
      const { rec } = env;
      const rows = "section.browse:not([hidden] *) tbody tr[data-row-id]";
      const shown = (page) => page.locator("section.browse").filter({ visible: true });
      let { ctx, page } = await open(env);
      await gotoBrowse(page, env);
      await shown(page).getByRole("button", { name: "Needs review", exact: true }).click();
      await shown(page).getByRole("button", { name: "Modified by me", exact: true }).click();
      await shown(page).getByRole("button", { name: "Search", exact: true }).click();
      await settle(page);
      await shown(page).getByRole("button", { name: "Needs review", exact: true }).and(page.locator("[aria-pressed=true]")).waitFor();
      await rec.shot(page, "h2-filtered", { file: "haystack-browse-filtered-1440.png", desc: "Browse with the Needs review and Modified by me toggles pressed and applied", how: "click both toggles in the filter row, Search", expect: ["section.browse .query-draft, section.browse [aria-pressed=true]"] });
      await ctx.close();
      ({ ctx, page } = await open(env));
      let first = null;
      const reason = "Injected invalid payload";
      await page.routeWebSocket(/\/api\/v1\/live$/, (socket) => {
        if (first !== null) { void socket.close({ code: 1007, reason }); return; }
        first = socket; socket.connectToServer();
      });
      await gotoBrowse(page, env);
      await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
      await first.close({ code: 1007, reason });
      await page.getByRole("button", { name: "Connection: Offline", exact: true }).waitFor({ timeout: 15000 });
      await shown(page).getByRole("status").filter({ hasText: "Offline — showing the last loaded data." }).waitFor();
      await rec.shot(page, "h2-offline", { file: "haystack-browse-offline-1440.png", desc: "Browse while the live connection is offline: rows stay under one inline warning with Reconnect now", how: "route /api/v1/live, close the socket and every later one with 1007", expect: [rows] });
      await ctx.close();
    },
  },
  {
    name: "retrieve", title: "search-parity W4: Search (ranked retrieval) next to Browse — modes, notices, list states",
    async run(env) {
      const { rec, stub } = env;
      const view = "section.retrieve";
      const hit = `${view} li[data-hit-key]`;
      const query = "token rotation";
      const search = (params) => `#/search?${new URLSearchParams(params)}`;
      const settled = (page) => page.waitForFunction(() => document.querySelector("section.retrieve")?.getAttribute("aria-busy") === "false");
      const show = async (page, hash) => {
        await page.goto(`${env.base}/${hash}`);
        await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Search", exact: true }).waitFor();
        await settled(page); await page.waitForTimeout(250);
      };
      await waitIndexed(env, undefined);
      for (const [viewport, width] of [[DESKTOP, 1440], [SMALL, 1024], [MOBILE, 390]]) for (const dark of [false, true]) {
        if (dark && width === 1024) continue;
        const { ctx, page } = await open(env, { viewport, dark });
        await show(page, search({ q: query }));
        await rec.shot(page, "retrieve-results", { file: `haystack-search-results${dark ? "-dark" : ""}-${width}.png`, desc: "Default hybrid search: effective mode, candidate-window count, one block per record with key, revision, field, pointer, snippet and score",
          how: `open #/search?q=${query} (server with the controlled stub embedding; no explicit mode)`, expect: [`${view} [data-effective-mode="Hybrid"]`, hit] });
        await ctx.close();
      }
      {
        const { ctx, page } = await open(env);
        await show(page, "#/search");
        await rec.shot(page, "retrieve-idle", { file: "haystack-search-default-1440.png", desc: "Empty query: no request, the hint (websearch syntax, Browse for exact filters)", how: "open #/search", expect: [`${view} [data-empty="idle"]`] });
        await show(page, search({ q: "zzqx nothing matches", mode: "lexical" }));
        await rec.shot(page, "retrieve-empty", { file: "haystack-search-empty-1440.png", desc: "No matches (explicit lexical)", how: "open #/search?q=zzqx nothing matches&mode=lexical", expect: [`${view} [data-empty="no-matches"]`] });
        await show(page, search({ q: query }));
        // Every visible record is a hybrid candidate (stub vectors): scroll until the end of the candidate window.
        for (let page_ = 0; page_ < 60 && await page.locator(`${view} [data-list-end]`).count() === 0; page_++) {
          const before = await page.locator(hit).count();
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.waitForFunction(([selector, count]) => document.querySelectorAll(selector).length > count || document.querySelector("section.retrieve [data-list-end]") !== null, [hit, before]);
        }
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(250);
        await rec.shot(page, "retrieve-end", { file: "haystack-search-end-1440.png", desc: "End of the candidate window marker after infinite loading", how: "scroll the document to the end repeatedly until the end marker shows", expect: [`${view} [data-list-end]`] });
        await ctx.close();
      }
      {
        // The lexical-only server's capability answer (the browser leg checks a real lexical-only server).
        const { ctx, page } = await open(env);
        await page.route("**/api/v1/capabilities", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ modes: ["Lexical"] }) }));
        await show(page, search({ q: query }));
        await rec.shot(page, "retrieve-lexical-only", { file: "haystack-search-lexical-only-1440.png", desc: "Lexical-only server: lexical by default with the notice; Semantic and Hybrid disabled with the reason",
          how: "route GET /api/v1/capabilities to {modes:[Lexical]} (as a server without embedding answers), open #/search?q=…", expect: [`${view} [data-notice="lexical"]`, hit] });
        await ctx.close();
      }
      await stub.stop();
      try {
        const { ctx, page } = await open(env);
        await show(page, search({ q: query }));
        await rec.shot(page, "retrieve-fallback", { file: "haystack-search-fallback-1440.png", desc: "Defaulted hybrid answered 503 'query embedding failed': one lexical re-run with the server's reason",
          how: "stop the stub embedding endpoint's listener, open #/search?q=…", expect: [`${view} [data-notice="lexical"]`, hit] });
        await show(page, search({ q: query, mode: "semantic" }));
        await rec.shot(page, "retrieve-unavailable", { file: "haystack-search-unavailable-1440.png", desc: "Explicit semantic refused with the server's reason and the one-click lexical way out",
          how: "stub stopped, open #/search?q=…&mode=semantic", expect: [`${view} [data-notice="unavailable"]`] });
        await page.route("**/api/v1/retrieve", (route) => route.request().postDataJSON().mode === "Lexical" ? route.abort() : route.continue());
        await show(page, search({ q: `${query} plan` }));
        await rec.shot(page, "retrieve-fallback-failed", { file: "haystack-search-fallback-failed-1440.png", desc: "Defaulted hybrid refused, then the lexical re-run failed: the error under the kept mode line and downgrade notice",
          how: "stub stopped, route POST /api/v1/retrieve to abort Lexical requests, open #/search?q=…", expect: [`${view} [data-notice="lexical"]`, `${view} [role=alert]`] });
        await ctx.close();
      } finally { await stub.start(); }
      {
        const { ctx, page } = await open(env);
        await show(page, search({ q: query, mode: "hybrid" }));
        await stub.stop();
        try {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.locator(`${view} [data-notice="unavailable"]`).waitFor();
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(250);
          await rec.shot(page, "retrieve-append-refused", { file: "haystack-search-append-refused-1440.png", desc: "Explicit hybrid: the next batch refused (embedding failed) — hits kept, the refusal with Search lexically instead and Retry",
            how: "open #/search?q=…&mode=hybrid, stop the stub, scroll to the end", expect: [`${view} [data-notice="unavailable"]`] });
        } finally { await stub.start(); }
        await ctx.close();
      }
      {
        const hold = stub.hold((input) => input.includes("capture-pending-marker"));
        try {
          await env.clients.alice.put({ key: "search-quality:fresh-note", documentJson: JSON.stringify({ title: "Token rotation drill capture-pending-marker", description: "Written just now", fields: {}, type: "note", status: "actual", importance: "low", "human-attention": "cleared", links: [], tags: [] }), expectedRevision: 0, requestId: env.uuidv7() });
          const { ctx, page } = await open(env);
          await show(page, search({ q: query }));
          await rec.shot(page, "retrieve-pending", { file: "haystack-search-pending-1440.png", desc: "A just-written record is not yet indexed: the pending notice above the hits",
            how: "hold the stub's answer for the new record's document embedding, put it, open #/search?q=…", expect: [`${view} [data-notice="pending"]`] });
          await ctx.close();
        } finally { hold.release(); }
      }
      {
        const { ctx, page } = await open(env);
        await page.route("**/api/v1/retrieve", () => {});
        await page.goto(`${env.base}/${search({ q: query })}`);
        await page.locator(`${view} [data-skeleton]`).waitFor(); await page.waitForTimeout(250);
        await rec.shot(page, "retrieve-loading", { file: "haystack-search-loading-1440.png", desc: "First page in flight: skeleton blocks, 'Searching…'", how: "route POST /api/v1/retrieve without answering, open #/search?q=…", expect: [`${view} [data-skeleton]`] });
        await page.unroute("**/api/v1/retrieve");
        await page.route("**/api/v1/retrieve", (route) => route.abort());
        await show(page, search({ q: `${query} again` }));
        await rec.shot(page, "retrieve-error", { file: "haystack-search-error-1440.png", desc: "Search failed (server unreachable): the error notice with Retry, query kept", how: "route POST /api/v1/retrieve to abort, open #/search?q=…", expect: [`${view} [role=alert]`] });
        await ctx.close();
      }
    },
  },
];

/** Polls the server until every record in scope is published for semantic search (the worker indexes after seeding). */
async function waitIndexed(env, project) {
  const deadline = Date.now() + 300000;
  for (;;) {
    const response = await fetch(`${env.base}/api/v1/retrieve`, { method: "POST", headers: { "Content-Type": "application/json", "X-Haystack-Version": "1.0.0", Authorization: `Bearer ${env.secrets["claude-agent"]}` },
      body: JSON.stringify({ query: "x", mode: "Hybrid", project: project ?? null, includeArchived: true, offset: 0, limit: 1 }) });
    const body = await response.json();
    if (!response.ok) throw new Error(`retrieve failed: ${JSON.stringify(body).slice(0, 200)}`);
    if (body.pending === "0") return;
    if (Date.now() > deadline) throw new Error(`indexing did not finish: ${JSON.stringify(body).slice(0, 200)}`);
    await sleep(500);
  }
}



import os from "node:os";
function os_load() { return os.loadavg()[0].toFixed(0); }
function heroes(env) {
  const linked = new Set(env.corpus.flatMap((d) => d.document.links.map(([, k]) => k)));
  const by = (pred) => { const d = env.corpus.find(pred); if (!d) throw new Error("no hero for " + pred); return d; };
  const used = new Set();
  const take = (pred) => { const d = by((x) => !used.has(x.key) && pred(x)); used.add(d.key); return d; };
  return {
    skill: take((d) => d.document.type === "skill-draft" && d.key.startsWith(ACTIVITY_PROJECT + ":") && JSON.stringify(d.document.fields).length > 6000),
    todo: take((d) => d.document.type === "todo" && d.document["human-attention"] === "required" && d.revisions >= 3 && d.document.links.length > 0 && linked.has(d.key)),
    issue: take((d) => d.document.type === "github-issue" && d.document.status === "actual"),
    fact: take((d) => d.document.type === "fact" && JSON.stringify(d.document.fields).includes("snippet") && d.document.status === "actual" && d.revisions === 1),
    fact2: take((d) => d.document.type === "fact" && d.document.status === "actual" && d.revisions === 1 && Object.keys(d.document.fields).length === 0),
    archived: take((d) => d.document.status === "archived" && d.document.links.length > 0),
    attention: take((d) => d.document["human-attention"] === "required" && d.document.type !== "skill-draft" && d.revisions === 1),
  };
}
/** The mockup's record (four revisions by three authors, Markdown and code fields, links both ways), written for the record scenario. */
async function recordHero(env, key) {
  env.recordHeroes ??= new Map();
  if (!env.recordHeroes.has(key)) env.recordHeroes.set(key, await writeRecordHero(env, key));
  return env.recordHeroes.get(key);
}
async function writeRecordHero(env, key) {
  const title = "Rework session store before the next release";
  const pony = env.corpus.filter((d) => d.key.startsWith("ponygirls:"));
  const archived = pony.find((d) => d.document.status === "archived");
  const live = pony.filter((d) => d.document.status === "actual");
  const lorem = "The service validates every request at the boundary, records the attributed identity, and returns a typed fault for anything it cannot prove. Operators can inspect the effective configuration, replay a frozen payload, and compare revisions without leaving the dashboard.";
  const notes = (renew) => `# Scope\n\nThe session store keeps one row per login and renews it ${renew}.\n\n## Acceptance\n\n- no renewal after \`expires_at\`\n- expiry is decided by the database clock\n- record the outcome in the [runbook](https://example.invalid/runbook)\n\n\`\`\`sql\nUPDATE sessions SET expires_at = now() + interval '30 min'\n WHERE id = $1 AND expires_at > now();\n\`\`\``;
  const unit = "# systemd unit override used while testing\nsystemd.services.haystack.serviceConfig = {\n  Restart = \"on-failure\";\n  RestartSec = \"2s\";\n  Environment = [ \"SESSION_TTL=30min\" ];\n};";
  const document = (revision) => ({
    title, type: "todo", status: "actual", tags: ["docs", "session-store"],
    description: revision === 4 ? `${lorem}\n\n(revision 4: clarified wording)` : lorem,
    importance: revision === 4 ? "high" : "normal", "human-attention": revision === 4 ? "required" : "cleared",
    links: [["supersedes", archived.key], ["motivated-by", live[0].key], ["relates-to", live[1].key]],
    fields: { notes: { type: "md", content: notes(revision >= 4 ? "on every request. Renewal and expiry race under load; see `SessionStore.renew` and the **lease** column" : "every five minutes") },
      checklist: ["reproduce", "fix", "verify"], due: revision >= 4 ? "2026-12-01" : "2026-11-24", owner: "codex-agent", unit: { type: "code", language: "nix", content: unit } },
  });
  for (const [revision, author] of [[1, "op"], [2, "alice"], [3, "claude-agent"], [4, "claude-agent"]])
    await env.clients[author].put({ key, documentJson: JSON.stringify(document(revision)), expectedRevision: revision - 1, requestId: env.uuidv7() });
  for (const [index, source] of live.slice(2, 7).entries()) {
    const current = await env.clients.alice.get(source.key);
    const body = JSON.parse(current.document.json);
    await env.clients.alice.put({ key: source.key, documentJson: JSON.stringify({ ...body, links: [...body.links, [index % 2 ? "relates-to" : "blocked-by", key]] }), expectedRevision: current.revision, requestId: env.uuidv7() });
  }
  return { key, title };
}
async function bump(env, doc, patch) {
  const client = env.clients.alice;
  const current = await client.get(doc.key);
  await client.put({ key: doc.key, documentJson: JSON.stringify({ ...doc.document, ...patch }), expectedRevision: current.revision, requestId: env.uuidv7() });
}
async function bumpKey(env, key, patch) {
  const client = env.clients.alice;
  const current = await client.get(key);
  await client.put({ key, documentJson: JSON.stringify({ ...JSON.parse(current.document.json), ...patch }), expectedRevision: current.revision, requestId: env.uuidv7() });
}
