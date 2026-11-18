// Search view (UX-C4), named like the mockup shots (`chronicle-search-<state>[-dark]-<width>.png`, spec §8 item 10).
import { VARIANTS, withScene, gotoTab, settle, inspect } from './lib.mjs';
import { seededFixture } from './seed.mjs';

const QUERY = 'migration';
const input = page => page.getByRole('combobox', { name: 'Search conversations', exact: true });
const named = (base, variant) => `${base}${variant.suffix}-${variant.viewport.tag}.png`;
async function openSearch(page) { await gotoTab(page, 'search'); await page.getByRole('main', { name: 'Search', exact: true }).waitFor(); }
// The editor's completion list opens while typing and stays open after Enter; captures show the view, not the list.
async function quiet(page) { await settle(page, 700); await input(page).blur(); await settle(page, 300); }
async function submit(page, expression) {
  await input(page).fill(expression); await input(page).press('Enter');
  await page.locator('[data-list="results"] article.result .hit').first().waitFor();
  await quiet(page);
}

export function registerSearch(scenario) {
  for (const [key, variant] of Object.entries(VARIANTS)) {
    scenario(`search-${key}`, async ctx => {
      await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, shot }) => {
        const capture = (state, shows, reached, options = {}) => shot('chronicle-search', state, shows, reached, { file: named(`chronicle-search-${state}`, variant), ...options });
        await openSearch(page); await page.locator('[data-state="intro"]').waitFor(); await settle(page, 300);
        await capture('default', 'Search before a query: what Search does and four example queries', 'nav link Search');
        await submit(page, QUERY); await settle(page, 600);
        await capture('results', 'Results: compact blocks with highlighted hits, counter and info button in the view bar', `type "${QUERY}" + Search`);
        await inspect(page, ctx.recorder, `search-results-${key}`);
        if (!variant.deep) return;
        await page.locator('article.result').first().getByRole('button', { name: 'Context', exact: true }).click(); await settle(page, 600);
        await capture('expanded', 'First result expanded in place: all hits with context and Earlier/Later buttons', 'click "Context" on the first result');
        await page.locator('article.result').first().getByRole('button', { name: 'Collapse', exact: true }).click();
        await page.evaluate(() => window.scrollTo(0, 1500)); await settle(page, 600);
        await capture('results-scrolled', 'Results scrolled by 1500 px: the view bar sticks under the masthead; more results were appended', 'scroll the document');
        await page.evaluate(() => window.scrollTo(0, 0)); await settle(page, 300);
        await input(page).fill(`${QUERY} project:chron`); await quiet(page);
        await capture('stale', 'Query edited, not yet submitted: previous results dimmed, "Query edited · Enter to update" in the counter slot', 'edit the draft after a search');
        await page.getByRole('button', { name: 'Search syntax', exact: true }).click({ force: true }); await settle(page, 300);
        await capture('syntax', 'Search syntax popover of the shared editor', 'click "Search syntax"'); await page.keyboard.press('Escape');
        await input(page).fill('zzzz-nothing-matches'); await input(page).press('Enter'); await page.locator('[data-state="empty"]').waitFor(); await quiet(page);
        await capture('empty', 'Search with zero matches', 'type an unmatched expression + Search');
      });
    });
  }
  scenario('search-states', async ctx => {
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.holdSearch = true; }) }, async ({ page, fixture, shot }) => {
      await openSearch(page); await input(page).fill(QUERY); await input(page).press('Enter'); await page.locator('[data-state="loading"]').waitFor(); await quiet(page);
      await shot('chronicle-search', 'loading', 'Search in flight: skeleton results, "Searching…"', 'server holds ArchiveSearch', { file: 'chronicle-search-loading-1440.png' });
      fixture.releaseSearch(); await page.locator('article.result').first().waitFor();
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.archiveSearchFailure = 'Semantic search is unavailable: embedding provider returned 503.'; }) }, async ({ page, shot }) => {
      await openSearch(page); await input(page).fill(QUERY); await input(page).press('Enter'); await page.getByRole('alert').waitFor(); await quiet(page);
      await shot('chronicle-search', 'error', 'Search failed notice with Retry; the query is kept', 'server returns Failure for ArchiveSearch', { file: 'chronicle-search-error-1440.png' });
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.archiveRows = f.archiveRows.slice(0, 24); }) }, async ({ page, shot }) => {
      await openSearch(page); await submit(page, QUERY);
      for (let batch = 0; await page.locator('[data-list-foot="end"]').count() === 0; batch++) {
        if (batch > 5) throw new Error('The short archive did not end within six batches');
        const loaded = await page.locator('[data-row-id]').count();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForFunction(count => document.querySelectorAll('[data-row-id]').length > count || document.querySelector('[data-list-foot="end"]') !== null, loaded);
      }
      await page.locator('[data-list-foot="end"]').scrollIntoViewIfNeeded(); await settle(page, 300);
      await shot('chronicle-search', 'results-end', 'Bottom of the list: the end marker after the last batch', 'scroll to the bottom', { file: 'chronicle-search-results-end-1440.png' });
      const state = { cards: await page.locator('article.result').count(), draft: await input(page).inputValue(), scrollY: await page.evaluate(() => scrollY) };
      await gotoTab(page, 'archive'); await page.getByRole('main', { name: 'Archive', exact: true }).waitFor(); await gotoTab(page, 'search'); await page.getByRole('main', { name: 'Search', exact: true }).waitFor(); await settle(page, 600);
      state.afterTabRoundtrip = { cards: await page.locator('article.result').count(), draft: await input(page).inputValue(), scrollY: await page.evaluate(() => scrollY) };
      await ctx.recorder.dump('search-state-survival', state);
    });
  });
}
