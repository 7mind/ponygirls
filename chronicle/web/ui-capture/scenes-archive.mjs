import { VARIANTS, withScene, gotoTab, archiveReady, settle, inspect, scrollTo, scrollEnd, rowCount } from './lib.mjs';
import { seededFixture } from './seed.mjs';

const SCROLLER = '.archive-table-scroll';
async function archive(page) { await gotoTab(page, 'archive'); await archiveReady(page); await settle(page); }

export function registerArchive(scenario) {
  for (const [key, variant] of Object.entries(VARIANTS)) {
    scenario(`archive-${key}`, async ctx => {
      await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, fixture, shot }) => {
        await archive(page);
        await shot('archive', 'first-render', 'Archive tab as first rendered: expression editor, status line and the 50-row first page inside a bordered scroll region', 'sign in as alice, click nav button "archive"');
        await shot('archive', 'first-render', 'Archive, whole document (full-page capture)', 'same as above, full-page', { full: true });
        await inspect(page, ctx.recorder, `archive-${key}`);
        if (!variant.deep) return;
        // ---- nested scrolling evidence
        await scrollTo(page, SCROLLER, 2400);
        await shot('archive', 'inner-table-scrolled', 'Inner table scrolled 2400 px; header row sticks, page itself has not moved', 'wheel/scrollTop on .archive-table-scroll');
        for (let i = 0; i < 6 && await rowCount(page, '.archive-row') < 150; i++) await scrollEnd(page, SCROLLER);
        await shot('archive', 'after-infinite-load', `Inner table scrolled to the end repeatedly; ${await rowCount(page, '.archive-row')} rows loaded by the infinite trigger`, 'scrollTop = scrollHeight x N on .archive-table-scroll');
        const chaining = await page.evaluate(async () => {
          const scroller = document.querySelector('.archive-table-scroll'), doc = document.documentElement;
          const before = { pageY: scrollY, tableTop: scroller.scrollTop, docHeight: doc.scrollHeight, viewport: innerHeight, tableHeight: scroller.clientHeight, tableTopOffset: scroller.getBoundingClientRect().top };
          return before;
        });
        // wheel over the table end: does the page scroll (overscroll-behavior: contain)?
        const box = await page.locator(SCROLLER).boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const pageBefore = await page.evaluate(() => scrollY);
        await scrollEnd(page, SCROLLER);
        await page.mouse.wheel(0, 1500); await page.waitForTimeout(500);
        const afterWheelOverTable = await page.evaluate(() => ({ pageY: scrollY, tableTop: document.querySelector('.archive-table-scroll').scrollTop }));
        await page.mouse.move(box.x + box.width / 2, 40);
        await page.mouse.wheel(0, 1500); await page.waitForTimeout(500);
        const afterWheelOverHeader = await page.evaluate(() => scrollY);
        await ctx.recorder.dump('archive-scroll-chaining', { measured: 'Playwright mouse.wheel at 1440x900', before: chaining, pageYBeforeWheel: pageBefore, afterWheelOverTableAtItsEnd: afterWheelOverTable, afterWheelOverMastheadPageY: afterWheelOverHeader });
        await shot('archive', 'page-scrolled-bottom', 'Page scrolled to its bottom (wheel over the masthead): footer visible, table partly scrolled out of view', 'mouse wheel over masthead after table end');
        await page.evaluate(() => scrollTo(0, 0));
        await scrollTo(page, SCROLLER, 900);
        await page.evaluate(() => scrollTo(0, 60));
        await settle(page);
        await shot('archive', 'both-scrolled', 'Both regions scrolled: page by 60 px and table by 900 px', 'window.scrollTo(0,60) + table scrollTop=900');
        await page.evaluate(() => scrollTo(0, 0)); await scrollTo(page, SCROLLER, 0);
        // ---- sorting
        await page.getByRole('button', { name: 'Sort by Messages', exact: true }).click(); await archiveReady(page); await settle(page);
        await shot('archive', 'sorted-messages-asc', 'Sorted by Messages ascending: header highlight, order status text, relevance toggle', 'click header "Messages"');
        await page.getByRole('button', { name: 'Sort by Messages', exact: true }).click(); await archiveReady(page); await settle(page);
        // ---- search
        const box2 = page.getByRole('combobox', { name: 'Search conversations' });
        await box2.fill('migration'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await archiveReady(page); await settle(page, 500);
        await shot('archive', 'text-search-relevance', 'Archive after the text search "migration": count line, ordered by relevance', 'type "migration" + Search');
        await box2.fill('status:failed producer:pi'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await archiveReady(page); await settle(page, 500);
        await shot('archive', 'field-filter', 'Archive with a field filter (status:failed producer:pi)', 'type expression + Search');
        await box2.fill('zzzz-nothing-matches'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await page.getByText('No matching conversations').waitFor(); await settle(page);
        await shot('archive', 'empty-result', 'Empty state: "No matching conversations"', 'type unmatched expression + Search');
        await box2.fill('');  await page.getByRole('button', { name: 'Search', exact: true }).click(); await archiveReady(page);
        // ---- error state
        fixture.archiveFailure = 'Expression error at offset 7: unbalanced parenthesis.';
        await page.getByRole('button', { name: 'Refresh archive' }).click(); await page.locator('.notice.error').waitFor(); await settle(page);
        await shot('archive', 'error', 'Archive error state: error notice above an empty table frame', 'fixture returns Failure for Archive RPC; click Refresh');
        fixture.archiveFailure = null; await page.getByRole('button', { name: 'Refresh archive' }).click(); await archiveReady(page);
        // ---- popovers / controls
        await page.getByRole('button', { name: 'Search syntax' }).click(); await page.waitForTimeout(300);
        await shot('archive', 'syntax-popover', 'Search syntax popover', 'click "Search syntax"');
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Conversations table options' }).click(); await page.waitForTimeout(300);
        await shot('archive', 'table-options-popover', 'Table options popover (fit / columns)', 'click the three-dot control in the Conversation header');
        await page.getByText('Columns', { exact: true }).click(); await page.waitForTimeout(300);
        await shot('archive', 'column-chooser', 'Column chooser expanded inside the options popover', 'table options > Columns');
        await page.getByRole('button', { name: 'Show all columns' }).click(); await page.waitForTimeout(500);
        await page.keyboard.press('Escape');
        await shot('archive', 'all-columns', 'All 11 columns shown: the table is fitted to the 1379 px region, so every column is squeezed (Conversation drops to its 180 px minimum) instead of scrolling horizontally', 'table options > Columns > Show all columns');
        await inspect(page, ctx.recorder, 'archive-all-columns');
        await scrollTo(page, SCROLLER, 1200); await page.locator(SCROLLER).evaluate(element => { element.scrollLeft = element.scrollWidth; });
        await shot('archive', 'all-columns-scrolled-xy', 'Table with all columns scrolled vertically (1200 px); horizontal scroll is not possible because the columns were fitted to the width', 'scrollTop=1200, scrollLeft=max (no effect)');
        // ---- hints
        await page.locator(SCROLLER).evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0; });
        await box2.fill('proj'); await page.waitForTimeout(900);
        await shot('archive', 'completion-hints', 'Typing a partial field name: completion dropdown (scripted hint)', 'type "proj" in the expression input');
        await box2.fill('');
      });
    });
  }
  scenario('archive-loading', async ctx => {
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.holdArchive = true; }) }, async ({ page, fixture, shot }) => {
      await gotoTab(page, 'archive'); await page.locator('.loading-line').first().waitFor(); await settle(page);
      await shot('archive', 'loading', 'Archive while the first page is in flight: status "Loading conversations…" and loading line', 'server holds the Archive reply');
      fixture.holdArchive = false;
    });
  });
  scenario('archive-resize', async ctx => {
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture() }, async ({ page, shot }) => {
      await archive(page);
      const handle = page.getByRole('separator', { name: 'Resize Conversation column' });
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + 5, box.y + 10); await page.mouse.down(); await page.mouse.move(box.x + 260, box.y + 10, { steps: 6 }); await page.mouse.up(); await settle(page);
      await shot('archive', 'column-resized', 'Conversation column dragged 250 px wider; other columns shrink to their minimum', 'drag the column separator');
    });
  });
}
