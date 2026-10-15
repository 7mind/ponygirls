import assert from "node:assert/strict";

export async function checkBrowse({ browser, base, login, humanToken, check, seed, agent, docOf, rid, artifacts, interceptSearch }) {
  const total = 45;
  for (let index = 0; index < total; index++) {
    await seed.put({ key: `scroll:${String(index).padStart(2, "0")}`, documentJson: docOf({ title: `Record ${String(total - index - 1).padStart(2, "0")}`, tags: [index % 2 ? "odd" : "even"] }), expectedRevision: 0, requestId: rid() }, agent);
  }
  const open = async (page) => {
    await login(page, humanToken);
    await page.goto(`${base}/#/browse?project=scroll`);
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
        if (request.url().endsWith("/api/v1/search") && request.postDataJSON().project === "scroll" && request.postDataJSON().cursor) cursors.push(request.postDataJSON().cursor);
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
      await page.goto(`${base}/#/browse?project=scroll&tag=odd`);
      await page.waitForFunction(() => document.querySelector(".record-open")?.getAttribute("aria-label") === "scroll:01");
      assert.equal(await page.getByLabel("Tag filter").inputValue(), "odd");
      assert.ok((await page.locator(".record-open").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label")))).every((key) => Number(key.split(":")[1]) % 2 === 1));
    } finally { await ctx.close(); }
  });
}
