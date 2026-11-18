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
  await page.waitForFunction(() => { const v = document.querySelector(".browse-view"); return v === null || v.getAttribute("aria-busy") === "false"; });
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
    name: "detail", title: "Record detail: fields, links, history, snapshots, not-found",
    async run(env) {
      const { rec } = env;
      const h = heroes(env);
      const { ctx, page } = await open(env);
      const goItem = async (key) => { await page.goto(`${env.base}/#/item/${enc(key)}`); await page.locator(".detail-view > .page-heading h1").waitFor(); await page.waitForTimeout(700); };
      await goItem(h.skill.key);
      await rec.shot(page, "detail-skill", { desc: `Skill-draft record ${h.skill.key}: heading, provenance, description, metadata grid, long Markdown field rendered inline`, how: `open /#/item/${h.skill.key}`, expect: [".detail-view .fields-view"] });
      await rec.shot(page, "detail-skill", { desc: "Full-page capture of the same record (single long page; no inner scroll region except <pre> blocks)", how: "fullPage screenshot", full: true });
      await page.evaluate(() => window.scrollTo(0, 1400));
      await page.waitForTimeout(200);
      await rec.shot(page, "detail-skill-scrolled", { desc: "Mid-page scroll position: heading and Back button scrolled away, no sticky context", how: "window.scrollTo(0,1400)" });
      await rec.dump(page, "detail-skill");
      await page.locator(".field-source summary", { hasText: "Markdown source" }).click();
      await page.evaluate(() => document.querySelector(".field-source[open]").scrollIntoView());
      await page.waitForTimeout(300);
      await rec.shot(page, "detail-skill-source-open", { desc: "'Markdown source' disclosure opened below the rendered Markdown (the same content twice)", how: "click the 'Markdown source' summary", expect: [".field-source[open] pre"] });

      await goItem(h.todo.key);
      await rec.shot(page, "detail-todo", { desc: `Todo ${h.todo.key} with human-attention=required, outgoing/incoming links and revision history`, how: `open /#/item/${h.todo.key}`, expect: [".relationship-columns", ".history-panel"] });
      await rec.shot(page, "detail-todo", { desc: "Full-page capture: relationship columns, actions, history list with per-row View / Restore buttons", how: "fullPage screenshot", full: true });
      await rec.dump(page, "detail-todo");
      await page.locator(".history-panel li button", { hasText: "View" }).first().click();
      await page.getByRole("heading", { name: /^Snapshot r/ }).waitFor();
      await page.getByLabel("Compare with revision").selectOption({ index: 1 });
      await page.getByRole("button", { name: "Compare", exact: true }).click();
      await page.locator('section[aria-label="Snapshot B"]').waitFor();
      await page.getByRole("heading", { name: /^Snapshot r/ }).scrollIntoViewIfNeeded();
      await rec.shot(page, "detail-snapshot-compare", { desc: "Snapshot of an older revision plus 'Compare with revision' result: two FieldsView blocks stacked, no diff highlighting", how: "click View on the first history row, choose another revision, click Compare", expect: ['section[aria-label="Snapshot A"]'] });
      await rec.shot(page, "detail-snapshot-compare", { desc: "Full page with snapshot and comparison appended below the history list", how: "fullPage screenshot", full: true });

      await goItem(h.issue.key);
      await rec.shot(page, "detail-github-issue", { desc: `GitHub issue record ${h.issue.key} (type-specific icon, fields incl. Markdown body)`, how: `open /#/item/${h.issue.key}`, expect: [".detail-view"] });
      await goItem(h.fact.key);
      await rec.shot(page, "detail-fact-code-json", { desc: `Fact ${h.fact.key} with code field (highlighted), JSON field with a >2^53 integer, Markdown evidence`, how: `open /#/item/${h.fact.key}`, expect: [".field-entry"] });
      await rec.shot(page, "detail-fact-code-json", { desc: "Full page of the same record", how: "fullPage screenshot", full: true });
      await goItem(h.archived.key);
      await rec.shot(page, "detail-archived", { desc: `Archived record ${h.archived.key}: only the provenance line says '· archived'; no banner or visual de-emphasis`, how: `open /#/item/${h.archived.key}`, expect: [".record-provenance"] });
      await page.goto(`${env.base}/#/item/${enc("ponygirls:does-not-exist")}`);
      await page.getByText("Item not found or unreadable.").waitFor();
      // Back button: does it return to the list state we came from?
      await page.goto(`${env.base}/#/browse?q=archived%3Atrue`); await settle(page);
      await page.locator(".records-panel").evaluate((el) => { el.scrollTop = 500; });
      await page.locator(".record-open").nth(3).click();
      await page.locator(".detail-view > .page-heading h1").waitFor();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await settle(page);
      const backState = await page.evaluate(() => ({ hash: location.hash, panelScrollTop: document.querySelector(".records-panel")?.scrollTop, heading: document.querySelector("h1")?.textContent }));
      rec.note(`Measured: from the Archive list (scrolled 500 px) open the 4th record and press the in-page Back button -> ${JSON.stringify(backState)}. The button always navigates to #/browse (App.tsx goBrowse), so the archive query, sort and scroll position are lost.`);
      await rec.shot(page, "detail-back-lands-on-default-list", { desc: "Result of the in-page Back button after opening a record from the Archive tab: the default 'Records' list, not the Archive", how: "open /#/browse?q=archived:true, open a record, click Back", expect: [".records-panel tbody tr"] });
      await page.goto(`${env.base}/#/item/${enc("ponygirls:does-not-exist")}`);
      await page.getByText("Item not found or unreadable.").waitFor();
      await rec.shot(page, "detail-not-found", { desc: "Missing record: bare status line and Back button, shell without heading", how: "open /#/item/ponygirls:does-not-exist", expect: ["[role=status]"] });
      await ctx.close();
    },
  },
  {
    name: "edit", title: "Record editing: typed fields editor, raw JSON, validation, conflict, pending write",
    async run(env) {
      const { rec } = env;
      const h = heroes(env);
      const { ctx, page } = await open(env);
      const goItem = async (key) => { await page.goto(`${env.base}/#/item/${enc(key)}`); await page.locator(".detail-view > .page-heading h1").waitFor(); await page.waitForTimeout(700); };
      const edit = () => page.getByRole("button", { name: "Edit", exact: true }).click();

      await goItem(h.skill.key); await edit();
      await page.locator(".typed-field-editor").first().waitFor();
      await rec.shot(page, "edit-typed", { desc: "Edit form for the skill-draft: metadata inputs, Fields editor in 'Typed content' mode with side-by-side Markdown preview", how: "open the record, click Edit", expect: [".fields-editor", ".typed-editor-preview"] });
      await rec.shot(page, "edit-typed", { desc: "Full page of the edit form (textarea 10 rows beside a preview that scrolls internally, max-height 500px)", how: "fullPage screenshot", full: true });
      await rec.dump(page, "edit-typed");
      await page.getByLabel("Preview", { exact: true }).uncheck();
      await rec.shot(page, "edit-typed-no-preview", { desc: "Typed content mode with Preview unchecked", how: "uncheck the Preview toggle", expect: [".typed-field-editor"] });
      await page.getByRole("button", { name: "Raw JSON", exact: true }).click();
      await page.getByLabel("Fields JSON").waitFor();
      await rec.shot(page, "edit-raw-json", { desc: "Fields editor in Raw JSON mode (12-row monospace textarea holding the whole fields object)", how: "click 'Raw JSON'", expect: ["textarea[aria-label='Fields JSON']"] });
      await page.getByLabel("Fields JSON").fill('{"broken": ');
      await page.locator(".fields-json-error").waitFor();
      await rec.shot(page, "edit-invalid-json", { desc: "Invalid fields JSON: red textarea border, inline error text, 'Save as new revision' disabled", how: "replace the Fields JSON text with an unterminated object", expect: [".fields-json-error"] });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();

      await goItem(h.todo.key); await edit();
      await page.getByLabel("Fields JSON").waitFor();
      await rec.shot(page, "edit-todo", { desc: "Edit form for a record without typed fields (defaults to Raw JSON); type/status/importance are free-text inputs with datalists", how: "open the todo, click Edit", expect: [".editor-panel"] });
      await page.getByLabel("Title").fill(h.todo.document.title + " (edited in the dashboard)");
      await page.getByLabel("Links").fill("related-to ponygirls:no-such-item\nbroken-line-without-target");
      await page.getByRole("button", { name: "Save as new revision" }).click();
      await page.getByText(/link line needs/).waitFor();
      const statusTop = await page.evaluate(() => { const r = document.querySelector(".detail-view [role=status]").getBoundingClientRect(); return { bottom: Math.round(r.bottom), viewportHeight: innerHeight, scrollY: Math.round(scrollY), saveButtonTop: Math.round(document.querySelector(".editor-panel button.primary").getBoundingClientRect().top) }; });
      rec.note(`Measured: after clicking Save with a malformed link line, the status message's bottom edge is at y=${statusTop.bottom} (viewport ${statusTop.viewportHeight}, scrollY ${statusTop.scrollY}, Save button top at y=${statusTop.saveButtonTop}); negative or near 0 means the message is outside the visible area.`);
      await rec.shot(page, "edit-link-error", { desc: "Malformed link line: error appears as a plain status line near the top of the page, far from the Links textarea (scrolled out of view)", how: "enter a link line without a target and save", expect: ["[role=status]"] });
      await page.getByLabel("Links").fill(h.todo.document.links.map(([t, k]) => `${t} ${k}`).join("\n"));
      await page.getByRole("button", { name: "Save as new revision" }).click();
      await page.getByText(/Saved as revision/).waitFor();
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, 0));
      await rec.shot(page, "edit-saved", { desc: "After a successful save: status line 'Saved as revision N.' above the record, editor closed", how: "fix the link line, click 'Save as new revision'", expect: ["[role=status]"] });

      // Stale-save conflict.
      await goItem(h.fact.key); await edit();
      await page.getByLabel("Title").fill(h.fact.document.title + " (my draft)");
      await bump(env, h.fact, { title: h.fact.document.title + " (someone else)" });
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.scrollTo(0, 0));
      await rec.shot(page, "edit-remote-update-notice", { desc: "While editing, another writer saved: 'This record may have changed elsewhere' notice (live update)", how: "open Edit, then put a newer revision through the API", expect: [".notice"] });
      await page.getByRole("button", { name: "Save as new revision" }).click();
      await page.locator("[role=alert]", { hasText: "Conflict" }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await rec.shot(page, "edit-conflict", { desc: "Stale save: Conflict alert with 'Save my draft on top of revision N' / 'Discard draft and reload'; draft preserved in the form below", how: "click Save after the concurrent put", expect: ["[role=alert]"] });
      await page.getByRole("button", { name: "Discard draft and reload" }).click();

      // Uncertain write: server commits, response is lost.
      await goItem(h.fact2.key); await edit();
      await page.getByLabel("Title").fill(h.fact2.document.title + " (uncertain write)");
      await page.route("**/api/v1/put", async (route) => { await route.fetch(); await route.abort("connectionreset"); });
      await page.getByRole("button", { name: "Save as new revision" }).click();
      await page.getByText(/Save failed|pending or uncertain/).first().waitFor({ timeout: 10000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
      await rec.shot(page, "edit-pending-write", { desc: "Lost response after a committed save: 'A write … is pending or uncertain' banner with 'Retry original write' and the Save failed status", how: "intercept POST /api/v1/put: let the server commit, then reset the connection", expect: [".notice"] });
      await page.unroute("**/api/v1/put");
      await page.getByRole("button", { name: "Retry original write" }).click();
      await page.waitForTimeout(800);
      await rec.shot(page, "edit-pending-write-resolved", { desc: "After 'Retry original write': banner shows the outcome sentence", how: "click Retry original write", expect: [".notice"] });

      // Attention clear.
      await goItem(h.attention.key);
      await page.getByRole("button", { name: "Clear attention" }).click();
      await page.getByText(/Attention cleared/).waitFor();
      await rec.shot(page, "detail-attention-cleared", { desc: "After 'Clear attention': status line, no undo, no confirmation step was offered", how: "open a needs-review record, click 'Clear attention'", expect: ["[role=status]"] });
      await ctx.close();
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
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator(".typed-field-editor").first().waitFor();
      await rec.shot(page, "edit-typed", { desc: "Typed fields editor at 1024x700 (textarea and preview side by side)", how: "click Edit", expect: [".typed-editor-preview"] });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
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
      await page.getByRole("button", { name: "Edit", exact: true }).click(); await page.locator(".typed-field-editor").first().waitFor();
      await rec.shot(page, "edit-typed", { desc: "Typed fields editor, dark theme", how: "click Edit", expect: [".typed-editor-preview"] });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
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
];

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
async function bump(env, doc, patch) {
  const client = env.clients.alice;
  const current = await client.get(doc.key);
  await client.put({ key: doc.key, documentJson: JSON.stringify({ ...doc.document, ...patch }), expectedRevision: current.revision, requestId: env.uuidv7() });
}
