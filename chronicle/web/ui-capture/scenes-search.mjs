import { VARIANTS, withScene, gotoTab, settle, inspect, scrollTo } from './lib.mjs';
import { seededFixture } from './seed.mjs';

const input = page => page.getByRole('combobox', { name: 'Search conversations' });
async function submit(page, expression) {
  await input(page).fill(expression); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('.search-card .search-excerpt').first().waitFor(); await settle(page, 600);
}

export function registerSearch(scenario) {
  for (const [key, variant] of Object.entries(VARIANTS)) {
    scenario(`search-${key}`, async ctx => {
      await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, shot }) => {
        await gotoTab(page, 'search'); await page.getByRole('main', { name: 'Search' }).waitFor(); await settle(page);
        await shot('search', 'first-render', 'Search tab before any query: expression editor with filter shortcut chips, no results area', 'click nav "search" (the default tab after sign-in)');
        await submit(page, 'migration retry');
        await shot('search', 'results-page-1', 'Search results page 1: ten numbered-page cards with source excerpts', 'type "migration retry" + Search');
        await shot('search', 'results-page-1', 'Search results page 1, whole document (full-page capture)', 'same, full-page', { full: true });
        await inspect(page, ctx.recorder, `search-${key}`);
        await ctx.recorder.dump(`search-card-geometry-${key}`, await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], documentHeight: document.documentElement.scrollHeight, firstCardTop: Math.round(document.querySelector('.search-card').getBoundingClientRect().top + scrollY), cardHeights: [...document.querySelectorAll('.search-card')].map(el => Math.round(el.getBoundingClientRect().height)), cardsFullyInFirstViewport: [...document.querySelectorAll('.search-card')].filter(el => el.getBoundingClientRect().bottom <= innerHeight).length })));
        if (!variant.deep) return;
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await settle(page);
        await shot('search', 'results-pager', 'Bottom of the results page: numbered "Result page 1 2 3 …" pager', 'scroll page to bottom');
        await page.getByRole('button', { name: 'Result page 2', exact: true }).click(); await page.locator('.search-card .search-excerpt').first().waitFor(); await settle(page, 600);
        await shot('search', 'results-page-2', 'Result page 2 after clicking the numbered pager; focus moved to the summary line', 'click "Result page 2"');
        await page.getByRole('button', { name: 'Result page 1', exact: true }).click(); await page.locator('.search-card .search-excerpt').first().waitFor();
        const card = page.locator('.search-card').first(), spans = card.getByRole('navigation', { name: 'Source spans' });
        if (await spans.count() > 0) { await spans.getByRole('button', { name: 'Source span 2' }).click(); await settle(page, 700); await card.scrollIntoViewIfNeeded(); await shot('search', 'card-second-source-span', 'First result card with its second source span selected (numbered inner pager)', 'click "Source span 2" in the first card'); }
        await page.getByRole('button', { name: 'Search syntax' }).click(); await page.waitForTimeout(300);
        await shot('search', 'syntax-popover', 'Search syntax popover', 'click "Search syntax"'); await page.keyboard.press('Escape');
        await input(page).fill('pro'); await page.waitForTimeout(900);
        await shot('search', 'completion-hints', 'Completion dropdown under the input (results already cleared by typing)', 'type "pro" in the input');
        const resultsCleared = await page.locator('.search-card').count() === 0;
        await ctx.recorder.dump(`search-typing-clears-results-${key}`, { resultsClearedWhileTyping: resultsCleared });
        await shot('search', 'results-cleared-while-typing', 'Typing in the box discards the displayed results at once (no stale results kept until Search is pressed)', 'edit the draft after a search');
        await submit(page, 'migration retry');
        await card.locator('.search-title').click(); await page.getByRole('dialog', { name: 'Source conversation' }).waitFor(); await page.locator('.original-message').first().waitFor(); await settle(page, 1200);
        await shot('search', 'result-opened', 'Source dialog opened from a search card: landed on the matched message ("Search result: found matching message …")', 'click a result title');
        await page.getByRole('button', { name: 'Close conversation' }).click(); await settle(page);
        // empty
        await input(page).fill('zzzz-nothing-matches'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await page.locator('.search-count').waitFor(); await settle(page, 500);
        await shot('search', 'empty-result', 'Search with zero matches: summary line only', 'type unmatched expression + Search');
        ctx.errors.length;
      });
    });
  }
  scenario('search-states', async ctx => {
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.holdSearch = true; }) }, async ({ page, fixture, shot }) => {
      await gotoTab(page, 'search'); await input(page).fill('migration'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await page.getByText('Searching conversations…').waitFor(); await settle(page, 300);
      await shot('search', 'loading', 'Search in flight: "Searching conversations…"', 'server holds ArchiveSearch');
      fixture.releaseSearch(); await page.locator('.search-card').first().waitFor();
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.archiveSearchFailure = 'Semantic search is unavailable: embedding provider returned 503.'; }) }, async ({ page, shot }) => {
      await gotoTab(page, 'search'); await input(page).fill('migration'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await page.locator('.notice.error').waitFor(); await settle(page, 300);
      await shot('search', 'error', 'Search error state', 'server returns Failure for ArchiveSearch');
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture() }, async ({ page, shot }) => {
      await gotoTab(page, 'search'); await submit(page, 'migration retry');
      const state = { before: await page.locator('.search-card').count(), draft: await input(page).inputValue() };
      await gotoTab(page, 'archive'); await page.locator('.archive-table').waitFor(); await gotoTab(page, 'search'); await settle(page, 600);
      state.afterTabRoundtrip = { cards: await page.locator('.search-card').count(), draft: await input(page).inputValue() };
      await shot('flow', 'search-after-tab-roundtrip', 'Search tab after visiting Archive and returning: draft and results are gone', 'search > archive > search');
      await submit(page, 'migration retry'); await page.reload(); await page.getByRole('navigation', { name: 'Main navigation' }).waitFor(); await settle(page, 800);
      state.afterReload = { activeTab: await page.locator('nav[aria-label="Main navigation"] .nav-active').textContent(), cards: await page.locator('.search-card').count(), url: page.url() };
      await ctx.recorder.dump('search-state-survival', state);
    });
  });
}
