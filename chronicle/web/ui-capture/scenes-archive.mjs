// Archive (UX-C2, spec §3.1): the states of the mockup `chronicle-archive.html`, named like its shots
// (`chronicle-archive[-state][-dark]-<width>.png`, spec §8 item 10) so that each pairs with its mockup for `look`.
import { PRIMARY, SECONDARY, PHONE, withScene, gotoTab, settle, inspect } from './lib.mjs';
import { seededFixture } from './seed.mjs';

const VIEWPORTS = [[PRIMARY, 'light'], [SECONDARY, 'light'], [PHONE, 'light'], [PRIMARY, 'dark'], [SECONDARY, 'dark']];
const variantOf = (viewport, scheme) => ({ viewport, scheme, suffix: '', deep: false });
const named = (state, variant) => `chronicle-archive${state === '' ? '' : `-${state}`}${variant.scheme === 'dark' ? '-dark' : ''}-${variant.viewport.tag}.png`;
const main = page => page.getByRole('main', { name: 'Archive', exact: true });
const rows = page => main(page).getByRole('table', { name: 'Conversations', exact: true }).locator('tbody tr[data-row-id]');
const listState = (page, state) => main(page).locator(`[data-list-state="${state}"]`);
async function archive(page) { await gotoTab(page, 'archive'); await main(page).waitFor(); await rows(page).first().waitFor(); await main(page).locator('table[data-list="archive"][aria-busy="false"]').waitFor(); }
async function submit(page, expression) {
  await main(page).getByRole('combobox', { name: 'Search conversations', exact: true }).fill(expression);
  await main(page).getByRole('button', { name: 'Search', exact: true }).click();
}
async function scrollToEnd(page) {
  for (let step = 0; step < 20 && await listState(page, 'end').count() === 0; step++) {
    const before = await rows(page).count();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForFunction(count => document.querySelectorAll('table[data-list="archive"] tbody tr[data-row-id]').length > count || document.querySelector('[data-list-state="end"]') !== null, before);
  }
  await listState(page, 'end').waitFor();
}

export function registerArchive(scenario) {
  for (const [viewport, scheme] of VIEWPORTS) {
    const variant = variantOf(viewport, scheme);
    scenario(`archive-${scheme}-${viewport.tag}`, async ctx => {
      await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, shot }) => {
        await archive(page); await settle(page, 400);
        await shot('archive', '', 'Archive: view bar (query bar, counter, refresh, table options), shortcut row, document table with the first 50 rows', 'nav link Archive', { file: named('', variant) });
        await inspect(page, ctx.recorder, `archive-${scheme}-${viewport.tag}`);
      });
    });
  }
  scenario('archive-states', async ctx => {
    const variant = variantOf(PRIMARY, 'light');
    await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, fixture, shot }) => {
      await archive(page);
      const [newest] = fixture.archiveRows, arrival = fixture.archiveAt(fixture.archiveRows.length + 1);
      fixture.archiveRows = [arrival.with({ lastTimestamp: new Date(Date.parse(newest.lastTimestamp) + 60_000).toISOString(), head: arrival.head.with({ metadata: newest.head.metadata.with({ title: 'Arrival announced by the pill' }) }) }), ...fixture.archiveRows];
      await main(page).getByRole('button', { name: 'Refresh archive', exact: true }).click(); await page.mouse.move(700, 24); await page.evaluate(() => { document.activeElement.blur(); });
      await main(page).getByRole('button', { name: 'Updates available · show latest', exact: true }).waitFor(); await settle(page, 400);
      await shot('archive', '', 'A refresh found a new arrival: the floating pill announces it; the rows stay until it is applied', 'add a newer fixture row, click Refresh', { file: named('updates', variant) });
      await main(page).getByRole('button', { name: 'Updates available · show latest', exact: true }).click();
      await page.mouse.move(700, 24); await page.evaluate(() => window.scrollTo(0, 1500)); await settle(page, 400);
      await shot('archive', '', 'Document scrolled 1500 px: masthead, view bar and table header stick; the shortcut row scrolled away', 'window.scrollTo(0, 1500)', { file: named('scrolled', variant) });
      await scrollToEnd(page); await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await settle(page, 400);
      await shot('archive', '', 'Every batch loaded: the end marker closes the list, the counter reads "all loaded"', 'scroll the document to its end until the end marker', { file: named('end', variant) });
      await inspect(page, ctx.recorder, 'archive-end');
      await page.evaluate(() => window.scrollTo(0, 0));
      await submit(page, 'status:failed producer:pi'); await page.waitForFunction(() => new URLSearchParams(location.hash.split('?')[1]).get('q') === 'status:failed producer:pi'); await main(page).locator('table[data-list="archive"][aria-busy="false"]').waitFor(); await settle(page, 400);
      await shot('archive', '', 'Field filter applied: counter with the filtered total', 'type "status:failed producer:pi" + Search', { file: named('filtered', variant) });
      await submit(page, 'migration'); await page.waitForFunction(() => new URLSearchParams(location.hash.split('?')[1]).get('q') === 'migration'); await main(page).locator('table[data-list="archive"][aria-busy="false"]').waitFor(); await settle(page, 400);
      await shot('archive', '', 'Text query: the Relevance | Last activity order toggle appears in the shortcut row, the headers claim no order', 'type "migration" + Search', { file: named('text', variant) });
      await submit(page, 'project:"atlantis" status:failed'); await listState(page, 'empty').waitFor(); await page.evaluate(() => { document.activeElement.blur(); }); await settle(page, 400);
      await shot('archive', '', 'Empty result: icon, heading, the query, Clear filter', 'type an unmatched expression + Search', { file: named('empty', variant) });
      await main(page).getByRole('button', { name: 'Clear filter', exact: true }).click(); await rows(page).first().waitFor();
      fixture.archiveFailure = 'The server answered with an error (archive-unavailable). Nothing was changed.';
      await main(page).getByRole('button', { name: 'Refresh archive', exact: true }).click(); await page.mouse.move(700, 24); await main(page).getByRole('alert').waitFor(); await settle(page, 400);
      await shot('archive', '', 'Load failure: inline danger notice with Retry instead of an empty table frame', 'fixture fails the Archive read; click Refresh', { file: named('error', variant) });
      fixture.archiveFailure = null; await main(page).getByRole('button', { name: 'Retry', exact: true }).click(); await rows(page).first().waitFor(); await settle(page);
      await main(page).getByRole('button', { name: 'Conversations table options', exact: true }).click(); await page.getByRole('menu', { name: 'Conversations table options', exact: true }).waitFor(); await settle(page);
      await shot('archive', '', 'Table options menu: column checkboxes and fit modes', 'view-bar columns button', { file: named('table-options', variant) });
      await page.keyboard.press('Escape');
    });
    await withScene(ctx, variant, { fixture: seededFixture(fixture => { fixture.holdArchive = true; }) }, async ({ page, fixture, shot }) => {
      await gotoTab(page, 'archive'); await main(page).locator('table.archive-skeleton').waitFor(); await settle(page, 400);
      await shot('archive', '', 'First page in flight: skeleton rows under the table header, counter "Loading conversations…"', 'server holds the Archive reply', { file: named('loading', variant) });
      fixture.holdArchive = false; fixture.releaseArchive();
    });
  });
}
