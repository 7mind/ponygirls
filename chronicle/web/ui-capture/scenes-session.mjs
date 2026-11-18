// Session page (spec §3.1 Session, UX-C3): the routed transcript with its side pane, named like the mockup shots
// (`chronicle-session-<state>[-dark]-<width>.png`, spec §8 item 10) so that each pairs with its mockup for `look`.
import { PRIMARY, SECONDARY, PHONE, withScene, settle, inspect, openSession } from './lib.mjs';
import { seededFixture } from './seed.mjs';
import { templateFor } from './transcripts.mjs';

const LIGHT = { viewport: PRIMARY, scheme: 'light', suffix: '', deep: true };
const DARK = { viewport: PRIMARY, scheme: 'dark', suffix: '-dark', deep: false };
const LAPTOP = { viewport: SECONDARY, scheme: 'light', suffix: '', deep: false };
const PHONE_LIGHT = { viewport: PHONE, scheme: 'light', suffix: '', deep: false };
const named = (state, variant) => `chronicle-session-${state}${variant.suffix}-${variant.viewport.tag}.png`;
// The long published template (260 messages, 52 passages) among the first archive rows of alice.
function longSession(fixture) {
  const row = fixture.archiveRows.slice(0, 50).find(item => item.head.ownerId === 'alice' && templateFor(item.head.revision).name === 'long' && item.publishedView !== undefined);
  if (row === undefined) throw new Error('No published long session in the first archive page');
  return row;
}
function address(row, extra) {
  const view = row.publishedView ?? row.head.view;
  return `#/session/${row.head.id}?rev=${view.revision}${view.generationId === undefined ? '' : `&gen=${view.generationId}`}${extra}`;
}
async function open(page, row, extra) {
  await page.evaluate(target => { location.hash = target; }, address(row, extra));
  await page.getByRole('main', { name: 'Session', exact: true }).waitFor();
}
async function transcriptReady(page) { await page.locator('[data-pane="transcript"] [data-message-id]').first().waitFor(); await settle(page, 400); }

export function registerSession(scenario) {
  for (const variant of [LIGHT, DARK, LAPTOP, PHONE_LIGHT]) {
    scenario(`session-${variant.scheme}-${variant.viewport.tag}`, async ctx => {
      await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, fixture, shot }) => {
        const capture = (state, shows, reached) => shot('session', state, shows, reached, { file: named(state, variant) });
        const row = longSession(fixture);
        // The mockups show the side pane open; below 1280 px it is closed by default (spec §9 decision 6) and opened here.
        await open(page, row, variant.viewport === PRIMARY ? '' : '&pane=outline'); await transcriptReady(page);
        await capture('default', 'Session page: header, transcript with folded tool rows, side pane Outline, position bar', 'deep link to a 260-message published session');
        if (variant.deep) await inspect(page, ctx.recorder, 'session-default');
        if (variant.viewport === PHONE) {
          await page.getByRole('button', { name: 'Side pane', exact: true }).click(); await settle(page, 300);
          await capture('closed', 'Phone: side pane closed, transcript only', 'Side pane toggle');
          return;
        }
        if (!variant.deep) return;
        await page.getByRole('button', { name: 'Side pane', exact: true }).click(); await settle(page, 300);
        await capture('outline-closed', 'Side pane closed: the transcript is the only scroller', 'Side pane toggle');
        await page.getByRole('button', { name: 'Side pane', exact: true }).click(); await settle(page, 300);
        await page.getByRole('list', { name: 'Passages', exact: true }).getByRole('button').nth(2).click(); await page.locator('[data-pane="transcript"] mark').first().waitFor(); await settle(page, 400);
        await capture('passage', 'Passage 3 selected: outline row current, its span details, highlighted span in the transcript', 'click outline row 3');
        const tool = page.locator('.tool-toggle').first(); await tool.scrollIntoViewIfNeeded(); await tool.click(); await settle(page, 300);
        await capture('tool', 'A tool row expanded to its output', 'click the first tool row');
        const more = page.getByRole('button', { name: 'Show full message', exact: true }).first(); await more.scrollIntoViewIfNeeded(); await settle(page, 300);
        await capture('folded', 'A long message folded with "Show full message"', 'scroll to the first folded message');
        await more.click(); await settle(page, 300);
        await capture('expanded', 'The long message expanded with "Fold message"', 'Show full message');
        await page.getByRole('tab', { name: /^Related/ }).click(); await page.getByRole('list', { name: 'Related conversations', exact: true }).waitFor(); await settle(page, 300);
        await capture('related', 'Side pane Related: sessions as links (normal navigation, Back returns)', 'Related tab');
        await page.getByRole('tab', { name: /^Info/ }).click(); await settle(page, 300);
        await capture('info', 'Side pane Info: source, recorded provenance, index, identifiers', 'Info tab');
        await page.getByRole('tab', { name: /^Find/ }).click(); await page.getByRole('textbox', { name: 'Literal message text', exact: true }).fill('timeout'); await page.getByRole('textbox', { name: 'Literal message text', exact: true }).press('Enter');
        const hits = page.getByRole('list', { name: 'Matching messages', exact: true }).getByRole('button'); await hits.first().waitFor(); await hits.nth(2).click(); await settle(page, 600);
        await capture('find', 'Find: docked bar with the match position, hit list in the side pane, landed message current', 'Find tab, "timeout", Enter, hit 3');
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        await page.getByRole('tab', { name: /^Outline/ }).click();
        await page.locator('[data-pane="transcript"]').evaluate(pane => pane.scrollTo({ top: pane.scrollHeight / 2, behavior: 'instant' })); await settle(page, 600);
        await capture('scrolled', 'Transcript scrolled to the middle: position bar shows the visible range', 'scroll the transcript pane');
      });
    });
  }
  // The page opened from the lists (one way to open a session) and cleared in place by a Search denial of its source.
  scenario('session-opened', async ctx => {
    await withScene(ctx, LIGHT, { fixture: seededFixture() }, async ({ page, shot }) => {
      await page.evaluate(() => { location.hash = '#/archive'; });
      const archive = page.getByRole('main', { name: 'Archive', exact: true }); await archive.locator('tbody tr[data-row-id] a.cell-title').first().waitFor();
      await archive.locator('tbody tr[data-row-id] a.cell-title').first().click(); await openSession(page); await settle(page, 400);
      await shot('session', 'from-archive', 'Session page opened from the first Archive row; Archive stays the current list (crumb, Back)', 'Archive title link', { file: named('from-archive', LIGHT) });
      await page.getByRole('button', { name: 'Back', exact: true }).click(); await archive.waitFor();
      await page.evaluate(() => { location.hash = '#/search'; });
      const search = page.getByRole('main', { name: 'Search', exact: true }); await search.waitFor();
      await search.getByRole('combobox', { name: 'Search conversations', exact: true }).fill('timeout'); await search.getByRole('button', { name: 'Search', exact: true }).click();
      const open = search.locator('[data-row-id]').getByRole('link', { name: 'Open at first match', exact: true }).first(); await open.waitFor();
      await open.click(); await openSession(page); await settle(page, 600);
      await shot('session', 'from-search', 'Session page opened from Search "Open at first match": its message at the top, the Find bar with the operand, Search the current list', 'Search "timeout", Open at first match', { file: named('from-search', LIGHT) });
      // The real notice path (source-authority.ts): a Search denial of the open session's source clears the page in place.
      await page.evaluate(() => {
        const [path, query] = location.hash.slice(2).split('?'), params = new URLSearchParams(query);
        document.dispatchEvent(new CustomEvent('chronicle:source-unavailable', { detail: { origin: 'search', sessionId: path.split('/')[1], view: { revision: Number(params.get('rev')), generationId: params.get('gen') }, code: 'forbidden', message: 'Source access was removed' } }));
      });
      await page.getByRole('alert').filter({ hasText: 'This session can no longer be read' }).waitFor(); await settle(page, 300);
      await shot('session', 'revoked', 'Source unavailable after a Search denial: header kept, transcript cleared, Back to Search and Retry', 'source-authority notice of origin search (forbidden)', { file: named('revoked', LIGHT) });
    });
  });
  scenario('session-states', async ctx => {
    await withScene(ctx, LIGHT, { fixture: seededFixture(fixture => { fixture.holdSessions = true; }) }, async ({ page, fixture, shot }) => {
      await open(page, longSession(fixture), ''); await page.getByRole('status').filter({ hasText: 'Rechecking source access…' }).waitFor({ state: 'attached' }); await settle(page, 300);
      await shot('session', 'loading', 'Loading: skeleton transcript under the session header', 'server holds GetSession', { file: named('loading', LIGHT) });
      fixture.releaseSessions();
    });
    await withScene(ctx, LIGHT, { fixture: seededFixture(fixture => { fixture.conversationFailure = 'forbidden'; }) }, async ({ page, fixture, shot }) => {
      await open(page, longSession(fixture), ''); await page.getByRole('alert').filter({ hasText: 'This session can no longer be read' }).waitFor(); await settle(page, 300);
      await shot('session', 'error', 'Access error: notice with Back to Archive and Retry inside the page', 'server rejects GetSession (forbidden)', { file: named('error', LIGHT) });
    });
  });
}
