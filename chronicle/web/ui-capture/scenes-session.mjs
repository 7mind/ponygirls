import { VARIANTS, withScene, gotoTab, archiveReady, settle, inspect, scrollTo, scrollEnd, openSession } from './lib.mjs';
import { seededFixture, api } from './seed.mjs';
import { templateFor } from './transcripts.mjs';

const SOURCE = '.conversation-source', PASSAGES = '.conversation-passages';
// Rows among the first archive page (indexes < 50) with the wanted template, owner alice.
function pick(fixture, template, { published }) {
  const row = fixture.archiveRows.slice(0, 50).find(row => row.head.ownerId === 'alice' && templateFor(row.head.revision).name === template && (row.publishedView !== undefined) === published);
  if (row === undefined) throw new Error(`No ${published ? 'published' : 'unindexed'} ${template} row in the first page`);
  return row;
}
async function openRow(page, row) {
  await page.locator(`.archive-row[data-session-id="${row.head.id}"] .table-title`).click();
  await openSession(page); await settle(page, 600);
}

// A row that is currently inside the table viewport (so Playwright's click does not scroll the table), preferring long published sessions.
async function visibleRow(page, fixture) {
  const ids = await page.evaluate(() => { const box = document.querySelector('.archive-table-scroll').getBoundingClientRect(); return [...document.querySelectorAll('.archive-row')].filter(row => { const r = row.getBoundingClientRect(); return r.top >= box.top + 40 && r.bottom <= box.bottom; }).map(row => row.dataset.sessionId); });
  const rows = new Map(fixture.archiveRows.map(row => [row.head.id, row]));
  const preferred = ids.find(id => { const row = rows.get(id); return templateFor(row.head.revision).name === 'long' && row.publishedView !== undefined; }) ?? ids[2];
  return page.locator(`.archive-row[data-session-id="${preferred}"]`);
}
// Geometry of the dialog regions and what the find overlay covers (runs in the page).
async function layoutMetrics(page) {
  return page.evaluate(() => {
    const box = selector => { const el = document.querySelector(selector); if (el === null) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const source = document.querySelector('.conversation-source').getBoundingClientRect(), overlay = document.querySelector('.source-find-overlay').getBoundingClientRect();
    const messages = [...document.querySelectorAll('.original-message')].map(el => el.getBoundingClientRect());
    const fully = messages.filter(r => r.top >= source.top && r.bottom <= source.bottom).length, partly = messages.filter(r => r.bottom > source.top && r.top < source.bottom).length;
    const covered = messages.filter(r => r.bottom > overlay.top && r.top < overlay.bottom && r.right > overlay.left && r.left < overlay.right).length;
    const passages = [...document.querySelectorAll('.passage')].map(el => el.getBoundingClientRect()), pane = document.querySelector('.conversation-passages').getBoundingClientRect();
    const message = document.querySelector('.original-message pre, .original-message .message-content');
    return { viewport: [innerWidth, innerHeight], dialog: box('dialog.conversation-dialog'), headingBar: box('.dialog-heading'), intro: box('.conversation-intro'), panes: box('.conversation-panes'), passagePane: box('.conversation-passages'), sourcePane: box('.conversation-source'), findOverlay: box('.source-find-overlay'), findOverlayCoversMessages: covered, messagesFullyVisible: fully, messagesPartlyVisible: partly, passageItemsPartlyVisible: passages.filter(r => r.bottom > pane.top && r.top < pane.bottom).length, passageItemHeightPx: passages.length ? Math.round(passages[0].height) : null, messageTextFont: message ? getComputedStyle(message).font : null, transcriptLineLengthChars: message ? Math.round(message.getBoundingClientRect().width / (parseFloat(getComputedStyle(message).fontSize) * .6)) : null, sourceVisibleShareOfViewportHeight: +(source.height / innerHeight).toFixed(2) };
  });
}
async function closeDialog(page) { await page.getByRole('button', { name: 'Close conversation', exact: true }).click(); await page.getByRole('dialog', { name: 'Source conversation' }).waitFor({ state: 'detached' }); await settle(page); }

export function registerSession(scenario) {
  for (const [key, variant] of Object.entries(VARIANTS)) {
    scenario(`session-${key}`, async ctx => {
      await withScene(ctx, variant, { fixture: seededFixture() }, async ({ page, fixture, shot }) => {
        const long = pick(fixture, 'long', { published: true });
        await gotoTab(page, 'archive'); await archiveReady(page);
        await openRow(page, long);
        await shot('session', 'open-default', `Session dialog for a 260-message published conversation, as opened from the Archive row: header bar, title, provenance, passage list (left), transcript (right), find overlay`, 'Archive > click the conversation title');
        await inspect(page, ctx.recorder, `session-${key}`);
        await ctx.recorder.dump(`session-layout-${key}`, await layoutMetrics(page));
        if (!variant.deep) return;
        // ---- scrolling the transcript
        await scrollTo(page, SOURCE, 1800);
        await shot('session', 'source-scrolled', 'Transcript pane scrolled 1800 px; passage list and header unchanged; message count overlay bottom-right', 'scrollTop=1800 on .conversation-source');
        for (let i = 0; i < 5; i++) await scrollEnd(page, SOURCE);
        await shot('session', 'source-scrolled-to-end', `Transcript scrolled to the end repeatedly; ${await page.locator('.original-message').count()} messages loaded by infinite trigger`, 'scrollTop=scrollHeight x5 on .conversation-source');
        await scrollTo(page, SOURCE, 0);
        // ---- passage navigation
        await page.locator('.passage').nth(8).scrollIntoViewIfNeeded();
        await shot('session', 'passages-pane-scrolled', 'Passage list scrolled inside its own pane (second independent scroll region)', 'scroll .conversation-passages');
        await page.locator('.passage').nth(8).click(); await settle(page, 900);
        await shot('session', 'passage-selected', 'Passage #9 selected: transcript jumped to its message and the span is highlighted; span list appears under the passages', 'click passage 9');
        await scrollEnd(page, PASSAGES); await settle(page, 600);
        await shot('session', 'passages-loaded-more', 'Passage pane scrolled to its end: second page of passages loaded (40 per page)', 'scrollTop=scrollHeight on .conversation-passages');
        // ---- find
        const find = page.locator('.session-find input');
        await find.fill('timeout'); await find.press('Enter'); await page.locator('.find-hits li').first().waitFor(); await settle(page);
        await ctx.recorder.dump('session-layout-find-open-deep', await layoutMetrics(page));
        await shot('session', 'find-hits', 'Find in session: hit list overlay at the top right of the transcript, over message text', 'type "timeout" + Enter in the Find box');
        await page.locator('.find-hits button').nth(2).click(); await settle(page, 900);
        await shot('session', 'find-landed', 'After clicking hit 3: transcript scrolled to the message, "Back to Find results" button appears bottom-left', 'click a Find hit');
        // ---- provenance popover, related
        await page.getByRole('button', { name: 'Provenance & metadata' }).click(); await page.waitForTimeout(400);
        await shot('session', 'provenance-popover', 'Provenance & metadata popover opened from "Info" in the header bar', 'click Info');
        await page.keyboard.press('Escape');
        await page.locator('.related > summary').click(); await scrollTo(page, SOURCE, 0); await settle(page, 600);
        await shot('session', 'related-open', 'Related sessions disclosure expanded at the top of the transcript', 'click "Related sessions"');
        await page.locator('.related > summary').click();
        // ---- huge messages
        await find.fill('BACKFILL'); await find.press('Enter'); await page.locator('.find-hits li').first().waitFor(); await page.locator('.find-hits button').first().click(); await settle(page, 1000);
        await shot('session', 'long-message-folded', 'Message over 20,000 characters: collapsed behind "Read full message"', 'Find "BACKFILL" > hit 1');
        const summary = page.locator('summary', { hasText: 'Read full message' }).first();
        if (await summary.count() > 0) { await summary.click(); await settle(page, 800); }
        await shot('session', 'long-message-expanded', 'Same message expanded: tall single message in the transcript pane', 'expand "Read full message"');
        // ---- keyboard focus
        await scrollTo(page, SOURCE, 0); await page.locator('.dialog-close').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
        await shot('session', 'keyboard-focus', 'Keyboard focus ring after three Tab presses from the close button', 'focus ×, press Tab x3');
        await closeDialog(page);
      });
    });
  }
  // Other transcript kinds
  const KINDS = [['markdown', true, 'Markdown-heavy 45-message session (lists, code blocks, tables)'], ['short', true, 'Short 14-message session with 3 passages'], ['tiny', true, '4-message session with no classified passages'], ['unicode-wide', true, 'Session with CJK text, emoji and very long unbroken URLs/tokens'], ['medium', false, 'Unindexed session (no published generation): passage pane says Unindexed']];
  scenario('session-kinds', async ctx => {
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture() }, async ({ page, fixture, shot }) => {
      await gotoTab(page, 'archive'); await archiveReady(page);
      for (const [template, published, shows] of KINDS) {
        const row = pick(fixture, template, { published });
        await openRow(page, row);
        await shot('session', `kind-${template}${published ? '' : '-unindexed'}`, shows, 'Archive > open row');
        if (template === 'markdown') { await scrollTo(page, SOURCE, 900); await shot('session', 'markdown-scrolled', 'Markdown session scrolled: formatted tables, quotes, code blocks with per-block copy buttons', 'scroll transcript'); }
        await closeDialog(page);
      }
    });
  });
  scenario('session-errors', async ctx => {
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture() }, async ({ page, fixture, shot }) => {
      await gotoTab(page, 'archive'); await archiveReady(page);
      const row = pick(fixture, 'short', { published: true });
      fixture.conversationFailure = 'forbidden';
      await page.locator(`.archive-row[data-session-id="${row.head.id}"] .table-title`).click();
      await page.getByRole('dialog', { name: 'Source conversation' }).waitFor(); await page.locator('.notice.error').first().waitFor(); await settle(page, 500);
      await shot('session', 'error-access-removed', 'Session dialog when the pinned source read fails (forbidden): error notice and an otherwise empty dialog', 'fixture rejects GetSession');
      fixture.conversationFailure = null;
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture(f => { f.holdSessions = true; }) }, async ({ page, fixture, shot }) => {
      await gotoTab(page, 'archive'); await archiveReady(page);
      await page.locator('.archive-row .table-title').first().click(); await page.getByRole('dialog', { name: 'Source conversation' }).waitFor(); await page.getByText('Rechecking source access…').waitFor(); await settle(page, 400);
      await shot('session', 'loading', 'Session dialog while GetSession is in flight: only "Rechecking source access…"', 'server holds GetSession');
      fixture.holdSessions = false; fixture.releaseSessions();
    });
  });
  // Back-navigation / state survival measurements (also screenshots the end state).
  scenario('session-return-state', async ctx => {
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture() }, async ({ page, fixture, shot }) => {
      const long = pick(fixture, 'long', { published: true });
      await gotoTab(page, 'archive'); await archiveReady(page);
      for (let i = 0; i < 3; i++) await scrollEnd(page, '.archive-table-scroll');
      await scrollTo(page, '.archive-table-scroll', 2600); await settle(page, 500);
      const row = await visibleRow(page, fixture);
      const rowId = await row.getAttribute('data-session-id');
      const metrics = { urlBefore: page.url(), historyLengthBefore: await page.evaluate(() => history.length), tableScrollBefore: await page.evaluate(() => document.querySelector('.archive-table-scroll').scrollTop), rowsBefore: await page.locator('.archive-row').count(), pageScrollBefore: await page.evaluate(() => scrollY) };
      await shot('flow', 'archive-before-open', 'Archive scrolled 2600 px after three infinite loads, before opening a session', 'scroll table');
      await row.locator('.table-title').click(); await openSession(page); await settle(page, 500);
      metrics.urlWithDialog = page.url(); metrics.historyLengthWithDialog = await page.evaluate(() => history.length);
      metrics.bodyWhileOpen = await page.evaluate(() => ({ position: document.body.style.position, top: document.body.style.top }));
      await scrollTo(page, SOURCE, 1500);
      await page.goBack().catch(() => null); await settle(page, 600);
      metrics.afterBrowserBack = { url: page.url(), dialogStillOpen: await page.getByRole('dialog', { name: 'Source conversation' }).count() === 1 };
      if (!metrics.afterBrowserBack.dialogStillOpen) { await page.waitForTimeout(1000); metrics.afterBrowserBack.note = 'browser Back left the app; the dialog and its state are gone'; }
      await ctx.recorder.dump('session-return-state', metrics);
    });
    await withScene(ctx, VARIANTS.deep, { fixture: seededFixture() }, async ({ page, fixture, shot }) => {
      await gotoTab(page, 'archive'); await archiveReady(page);
      for (let i = 0; i < 3; i++) await scrollEnd(page, '.archive-table-scroll');
      await scrollTo(page, '.archive-table-scroll', 2600); await settle(page, 500);
      const before = await page.evaluate(() => ({ tableScroll: document.querySelector('.archive-table-scroll').scrollTop, rows: document.querySelectorAll('.archive-row').length, pageScroll: scrollY }));
      const row = await visibleRow(page, fixture), rowId = await row.getAttribute('data-session-id');
      await row.locator('.table-title').click(); await openSession(page);
      await scrollTo(page, SOURCE, 1500); await page.locator('.passage').nth(1).click().catch(() => null); await settle(page, 500);
      const sourceScrollBeforeClose = await page.evaluate(() => document.querySelector('.conversation-source').scrollTop);
      await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: 'Source conversation' }).waitFor({ state: 'detached' }); await settle(page, 500);
      const after = await page.evaluate(id => ({ tableScroll: document.querySelector('.archive-table-scroll').scrollTop, rows: document.querySelectorAll('.archive-row').length, pageScroll: scrollY, focusedIs: document.activeElement === null ? null : `${document.activeElement.tagName}.${document.activeElement.className}`, rowInView: (() => { const element = document.querySelector(`.archive-row[data-session-id="${id}"]`); if (element === null) return null; const rect = element.getBoundingClientRect(), table = document.querySelector('.archive-table-scroll').getBoundingClientRect(); return rect.top >= table.top && rect.bottom <= table.bottom; })() }), rowId);
      await shot('flow', 'archive-after-close', 'Archive after closing the session with Escape: scroll position and loaded rows (compare with archive-before-open)', 'Escape in dialog');
      // reopen the same row: transcript state?
      await page.locator(`.archive-row[data-session-id="${rowId}"] .table-title`).click(); await openSession(page); await settle(page, 600);
      const reopened = await page.evaluate(() => ({ sourceScroll: document.querySelector('.conversation-source').scrollTop, selectedPassages: document.querySelectorAll('.selected-passage').length }));
      await ctx.recorder.dump('session-escape-return-state', { before, sourceScrollBeforeClose, afterEscape: after, reopened });
      await closeDialog(page);
      // tab switch round trip
      await gotoTab(page, 'activity'); await page.locator('.activity-overview').waitFor(); await gotoTab(page, 'archive'); await archiveReady(page); await settle(page, 600);
      const afterTabs = await page.evaluate(() => ({ tableScroll: document.querySelector('.archive-table-scroll').scrollTop, rows: document.querySelectorAll('.archive-row').length }));
      await shot('flow', 'archive-after-tab-roundtrip', 'Archive after visiting Activity and coming back: table remounted, loaded pages and scroll position reset to the first 50 rows', 'nav archive > activity > archive');
      await ctx.recorder.dump('archive-tab-roundtrip', { before, afterTabs, note: 'search expression/sort live in App state; loaded pages and scroll live in the unmounted component' });
    });
  });
}
