import assert from "node:assert/strict";

export async function checkBrowse({ browser, base, login, humanToken, check, seed, agent, docOf, rid, artifacts, interceptSearch }) {
  const total = 45;
  // Reverse insertion order makes real modified-at desc match the original
  // constant-clock/key-order fixture, without injecting private server state.
  for (let index = total - 1; index >= 0; index--) {
    await seed.put({ key: `scroll:${String(index).padStart(2, "0")}`, documentJson: docOf({ title: `Record ${String(total - index - 1).padStart(2, "0")}`, tags: [index % 2 ? "odd" : "even"] }), expectedRevision: 0, requestId: rid() }, agent);
  }
  const open = async (page) => {
    await login(page, humanToken);
    await page.getByRole("button", { name: "Connection: Live", exact: true }).waitFor();
    await page.goto(`${base}/#/browse?${new URLSearchParams({ q: "project:scroll" })}`);
    await page.waitForFunction(() => document.querySelectorAll(".records-panel tbody .record-open").length === 20);
  };
  const count = (page, expected) => page.waitForFunction((n) => document.querySelectorAll(".records-panel tbody .record-open").length === n, expected);
  const bottom = (page) => page.locator(".records-panel").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const titles = (page) => page.locator(".record-open strong").allTextContents();
  const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  await check("browse uses sortable table columns instead of pagination", async () => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await open(page);
      assert.equal(await page.getByRole("button", { name: "Next", exact: true }).count(), 0);
      await page.getByRole("columnheader", { name: "Project" }).waitFor();
      assert.equal(await page.getByRole("columnheader", { name: "Sort by Modified" }).getAttribute("aria-sort"), "descending");
      await page.getByRole("button", { name: "Sort by Record", exact: true }).focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector(".record-open strong")?.textContent === "Record 00");
      assert.equal(await page.getByRole("columnheader", { name: "Sort by Record" }).getAttribute("aria-sort"), "ascending");
      assert.ok((await page.evaluate(() => location.hash)).includes("sort=title"));
      await page.reload();
      await page.waitForFunction(() => document.querySelector(".record-open strong")?.textContent === "Record 00");
      if (artifacts) await page.screenshot({ path: `${artifacts}/browse-table-light.png`, fullPage: true });
      await page.emulateMedia({ colorScheme: "dark" });
      if (artifacts) await page.screenshot({ path: `${artifacts}/browse-table-dark.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.getByRole("columnheader", { name: "Sort by Project" }).isVisible(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "table must scroll within its container on mobile");
      if (artifacts) await page.screenshot({ path: `${artifacts}/browse-table-mobile.png`, fullPage: true });
    } finally { await ctx.close(); }
  });

  await check("browse appends every page once and stops at the end", async () => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      const cursors = [];
      page.on("request", (request) => {
        if (request.url().endsWith("/api/v1/search") && request.postDataJSON().query === "project:scroll" && request.postDataJSON().cursor) cursors.push(request.postDataJSON().cursor);
      });
      await open(page);
      await bottom(page);
      await count(page, 40);
      await bottom(page);
      await count(page, total);
      await page.getByText("All 45 records loaded.", { exact: true }).waitFor();
      assert.equal(new Set(await page.locator(".record-open").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")))).size, total);
      assert.equal(await page.getByRole("button", { name: "Load more records", exact: true }).count(), 0);
      assert.equal(cursors.length, 2);
      assert.equal(new Set(cursors).size, 2);
    } finally { await ctx.close(); }
  });

  await check("browse sort applies to the complete result set and resets loaded rows", async () => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await open(page);
      await page.getByRole("button", { name: "Sort by Record", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".record-open strong")?.textContent === "Record 00");
      assert.deepEqual(await titles(page), Array.from({ length: 20 }, (_, i) => `Record ${String(i).padStart(2, "0")}`));
      await bottom(page);
      await count(page, 40);
      assert.deepEqual(await titles(page), Array.from({ length: 40 }, (_, i) => `Record ${String(i).padStart(2, "0")}`));
      await page.getByRole("button", { name: "Sort by Record", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".record-open strong")?.textContent === "Record 44");
      assert.deepEqual(await titles(page), Array.from({ length: 20 }, (_, i) => `Record ${String(44 - i).padStart(2, "0")}`));
    } finally { await ctx.close(); }
  });

  await check("browse ignores an old in-flight page after sorting", async () => {
    const ctx = await browser.newContext();
    let release;
    try {
      const page = await ctx.newPage();
      await open(page);
      let pending;
      const started = new Promise((resolve) => { pending = resolve; });
      const held = new Promise((resolve) => { release = resolve; });
      interceptSearch(async (body, _res, next) => {
        if (body.cursor) { pending(); await held; }
        next();
      });
      await bottom(page);
      await started;
      await page.getByRole("button", { name: "Sort by Record", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".record-open strong")?.textContent === "Record 00");
      const response = page.waitForResponse((res) => res.url().endsWith("/api/v1/search") && Boolean(res.request().postDataJSON().cursor));
      release();
      await response;
      await settle(page);
      assert.deepEqual(await titles(page), Array.from({ length: 20 }, (_, i) => `Record ${String(i).padStart(2, "0")}`));
    } finally { if (release) release(); interceptSearch(null); await ctx.close(); }
  });

  await check("browse preserves rows on append failure and retries the same cursor", async () => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await open(page);
      const attempts = [];
      interceptSearch((body, res, next) => {
        if (body.cursor) {
          attempts.push(body.cursor);
          if (attempts.length === 1) { res.status(503).json({ error: { code: "unavailable", message: "injected failure" } }); return; }
        }
        next();
      });
      await bottom(page);
      await page.getByRole("alert").filter({ hasText: "Server unreachable" }).waitFor();
      assert.equal((await titles(page)).length, 20);
      await settle(page);
      assert.equal(attempts.length, 1, "failed pages must not retry in an observer loop");
      await page.getByRole("button", { name: "Retry loading records", exact: true }).click();
      await count(page, 40);
      assert.deepEqual(attempts, [attempts[0], attempts[0]]);
    } finally { interceptSearch(null); await ctx.close(); }
  });

  await check("browse route tag changes reset the infinite list", async () => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await open(page);
      await page.goto(`${base}/#/browse?${new URLSearchParams({ q: "project:scroll tag:odd" })}`);
      await page.waitForFunction(() => document.querySelector(".record-open")?.getAttribute("aria-label") === "scroll:01");
      assert.equal(await page.getByRole("combobox", { name: "Query", exact: true }).inputValue(), "project:scroll tag:odd");
      assert.ok((await page.locator(".record-open").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")))).every((key) => Number(key.split(":")[1]) % 2 === 1));
    } finally { await ctx.close(); }
  });

  await check("legacy URL filters become the exact visible applied expression", async () => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await open(page);
      const query = page.getByRole("combobox", { name: "Query", exact: true });
      const expression = '(((id:"ui:note" OR project:scroll) project:"scroll") tag:"odd") archived:"all"';
      const result = page.waitForResponse((response) => response.url().endsWith("/api/v1/search") && response.request().postDataJSON().query === expression);
      await page.goto(`${base}/#/browse?${new URLSearchParams({ q: 'id:"ui:note" OR project:scroll', project: "scroll", tag: "odd", archive: "show" })}`);
      assert.equal((await result).request().postDataJSON().project, null, "there is no hidden project scope");
      await count(page, 20);
      assert.equal(await query.inputValue(), expression);
      const params = new URLSearchParams(new URL(page.url()).hash.split("?")[1]);
      assert.equal(params.get("q"), expression);
      for (const field of ["project", "tag", "archive"]) assert.equal(params.has(field), false);
      assert.ok((await page.locator(".record-open").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")))).every((key) => key.startsWith("scroll:") && Number(key.split(":")[1]) % 2 === 1), "scope constrains the entire OR body");
      await page.reload();
      await count(page, 20);
      assert.equal(await query.inputValue(), expression, "canonical URL does not compose the scopes twice");
      const archive = page.waitForResponse((response) => response.url().endsWith("/api/v1/search") && response.request().postDataJSON().query === "archived:true");
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      assert.equal((await archive).request().postDataJSON().project, null);
      assert.equal(await query.inputValue(), "archived:true", "sidebar presets also use the expression");
      await page.getByRole("button", { name: "ui:old", exact: true }).waitFor();
    } finally { await ctx.close(); }
  });

  await check("unsafe legacy URL filters show a migration error without searching", async () => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await open(page);
      const searches = [];
      page.on("request", (request) => { if (request.url().endsWith("/api/v1/search")) searches.push(request.postDataJSON()); });
      for (const draft of ['tag:"unfinished', "type:fact OR", "(type:fact", 'link:["depends-on","p:i"', 'link:["depends-on",]', 'link:["depends-on"]', 'field["/n"]', 'field["/n"] >=']) {
        const hash = `#/browse?${new URLSearchParams({ q: draft, project: "scroll", archive: "show" })}`;
        await page.goto(`${base}/${hash}`);
        await page.waitForFunction((value) => {
          const input = document.querySelector('input[role="combobox"]');
          return input !== null && input.value === value;
        }, draft);
        await page.getByRole("alert").filter({ hasText: "Cannot safely migrate legacy URL filters" }).waitFor();
        assert.equal(await page.getByRole("combobox", { name: "Query", exact: true }).inputValue(), draft);
        assert.equal(await page.getByRole("button", { name: "Search", exact: true }).isDisabled(), true);
        assert.equal(await page.locator(".record-open").count(), 0, "previous rows cannot masquerade as unscoped results");
        assert.equal(new URL(page.url()).hash, hash, "failed migration retains the recoverable original URL");
        await settle(page);
        assert.equal(searches.length, 0);
      }
      const reset = page.waitForResponse((response) => response.url().endsWith("/api/v1/search") && response.request().postDataJSON().query === "");
      await page.getByRole("button", { name: "Browse", exact: true }).click();
      await reset;
      assert.equal(await page.getByRole("combobox", { name: "Query", exact: true }).inputValue(), "");
      assert.equal(await page.getByRole("button", { name: "Search", exact: true }).isEnabled(), true);
    } finally { await ctx.close(); }
  });

}
