// Shared scene helpers of the Activity scenario scripts (activity.mjs, activity-maintenance.mjs; redesign spec §3.1, unit UX-C5).
// Every scene pauses the page clock before loading (reliability report §7): snapshot polling, usage polling, completion hints,
// request deadlines and reconnects fire only when a case advances the clock, so "nothing was sent" holds after advancing it.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { Goal50Fixture, api } from './goal50-fixture.mjs';
import { pauseClock } from './fixture.mjs';

export const DESKTOP = { width: 1440, height: 900 }, LAPTOP = { width: 1024, height: 700 }, PHONE = { width: 390, height: 844 };
// Application constants the cases depend on (activity/*.tsx) and the shared token heights (tokens.css).
export const PAGE_SIZE = 50, MASTHEAD_H = 48, SUBNAV_H = 40, VIEWBAR_H = 56, SCROLL_TOLERANCE = 2;
const PAGE = 'tests-browser/goal50.html', MAX_APPENDS = 20, QUIESCE_TASKS = 20;

/** Vite server and Chromium of one scenario script; `run` honours CHRONICLE_BROWSER_CASE. */
export async function startRig(label) {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH; tests never download browsers.');
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer.address();
  if (address === null || typeof address === 'string') throw new Error('No fixture HTTP address');
  const browser = await chromium.launch({ headless: true }), errors = [];
  let cases = 0;
  return {
    origin: `http://127.0.0.1:${address.port}`, browser, errors,
    async run(name, body) { if (process.env.CHRONICLE_BROWSER_CASE !== undefined && !name.includes(process.env.CHRONICLE_BROWSER_CASE)) return; await body(); cases++; console.log(`PASS browser ${label}: ${name}`); },
    finish() { assert.ok(cases > 0, 'No cases selected'); assert.deepEqual(errors, [], 'no uncaught browser application errors'); console.log(`PASS ${cases} ${label} cases`); },
    async close() { await browser.close(); await server.close(); },
  };
}
/**
 * Opens the dashboard at `#<route>` with a paused clock and a scripted server. `configure(fixture, page)` runs before the page
 * loads. Native dialogs throw (spec §8 item 7); completion hints stay unanswered unless a case asks for them.
 */
export async function scene(rig, { route, viewport = DESKTOP, scheme = 'light', fixture = new Goal50Fixture(), configure = () => {}, clock = true }) {
  const context = await rig.browser.newContext({ viewport, colorScheme: scheme }), page = await context.newPage();
  page.on('pageerror', error => rig.errors.push(error.message));
  await page.addInitScript(() => { for (const name of ['alert', 'confirm', 'prompt']) window[name] = () => { throw new Error(`native ${name}() called`); }; });
  fixture.holdHints = true;
  await configure(fixture, page);
  if (clock) await pauseClock(page);
  await fixture.install(page); await page.goto(`${rig.origin}/${PAGE}#${route}`);
  if (fixture.signedIn) await main(page).waitFor();
  return { context, page, fixture };
}

export const main = page => page.getByRole('main', { name: 'Activity', exact: true });
export const region = (page, name) => main(page).getByRole('region', { name, exact: true });
export const sections = page => main(page).getByRole('navigation', { name: 'Activity sections', exact: true });
/** A sub-navigation tab; its name continues with a problem badge ("Jobs 3 failed") when there is one. */
export const tab = (page, name) => sections(page).getByRole('link', { name: new RegExp(`^${name}( |$)`) });
export const navLink = (page, name) => page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name, exact: true });
export const LISTS = { collectors: { region: 'Collectors', table: 'Collectors', list: 'activity-collectors', editor: 'Collector' }, jobs: { region: 'Jobs', table: 'Indexing jobs', list: 'activity-jobs', editor: 'Indexing job' } };
export const table = (page, kind) => region(page, LISTS[kind].region).getByRole('table', { name: LISTS[kind].table, exact: true });
export const rows = (page, kind) => table(page, kind).locator('tbody tr[data-row-id]');
export const row = (page, kind, id) => table(page, kind).locator(`tbody tr[data-row-id="${id}"]`);
export const detail = (page, kind, id) => table(page, kind).locator(`tbody tr[data-detail-for="${id}"]`);
export const cell = (page, kind, id, column) => row(page, kind, id).locator(`td[data-column-id="${column}"]`);
export const rowIds = (page, kind) => rows(page, kind).evaluateAll(items => items.map(item => item.dataset.rowId));
// Attached, not visible: an empty or failed list keeps its (hidden) table so that the column layout can measure it.
export const idle = (page, kind) => main(page).locator(`table[data-list="${LISTS[kind].list}"][aria-busy="false"]`).waitFor({ state: 'attached' });
export const listState = (page, kind, state) => region(page, LISTS[kind].region).locator(`[data-list-state="${state}"]`);
export const status = (page, kind) => region(page, LISTS[kind].region).getByRole('status', { name: `${LISTS[kind].region} status`, exact: true });
export const combobox = (page, kind) => region(page, LISTS[kind].region).getByRole('combobox', { name: `Search ${LISTS[kind].editor.toLowerCase()} metadata`, exact: true });
export const button = (scope, name) => scope.getByRole('button', { name, exact: true });
export const hashParam = (page, name) => page.evaluate(key => new URLSearchParams(location.hash.split('?')[1] ?? '').get(key), name);
export const activityQueries = (fixture, Type) => fixture.calls.filter(call => call.operation instanceof Type).map(call => call.operation.query);
/** Lets the page run its queued tasks (renders, effects, socket sends) without advancing the paused clock. */
export async function quiesce(page) { await page.evaluate(rounds => new Promise(resolve => { const channel = new MessageChannel(); let left = rounds; channel.port1.onmessage = () => { if (--left === 0) resolve(); else channel.port2.postMessage(0); }; channel.port2.postMessage(0); }), QUIESCE_TASKS); }
/** Opens a section by its sub-navigation tab and waits for its region (and first rows for a list). */
export async function open(page, name) {
  await tab(page, name).click(); await region(page, name).waitFor();
  const kind = Object.keys(LISTS).find(key => LISTS[key].region === name);
  if (kind !== undefined) await idle(page, kind);
}
/** Types an expression into a list's query bar and submits it. */
export async function filter(page, kind, expression) { await combobox(page, kind).fill(expression); await button(region(page, LISTS[kind].region), 'Filter').click(); }
/** Scrolls the document to its end until `total` rows are loaded (every append waits for its rendered row). */
export async function appendUntil(page, kind, total) {
  for (let step = 0; step < MAX_APPENDS && await rows(page, kind).count() < total; step++) {
    const before = await rows(page, kind).count();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await rows(page, kind).nth(before).waitFor();
  }
  await idle(page, kind);
  assert.equal(await rows(page, kind).count(), total);
}
/** Vertical scroll containers with overflowing content (spec §8 item 1). */
export const scrollers = page => page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => { const style = getComputedStyle(element); return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && element.getBoundingClientRect().height > 0; }).map(element => element.tagName + (element.className ? `.${String(element.className).replace(/\s+/g, '.')}` : '')));
export const horizontalOverflow = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
export async function showAllColumns(page, kind) {
  await button(region(page, LISTS[kind].region), `${LISTS[kind].table} table options`).click();
  const menu = page.getByRole('menu', { name: `${LISTS[kind].table} table options`, exact: true }); await menu.waitFor();
  await menu.getByRole('menuitem', { name: 'Show all columns', exact: true }).click(); await menu.waitFor({ state: 'hidden' });
}
export async function signIn(page, login) {
  await page.getByLabel('Username', { exact: true }).fill(login); await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('button', { name: login, exact: true }).waitFor();
}

/** 330 jobs (165 current in all states, 165 historical failures of three classifications) over 155 collectors. */
export function largeFixture(fixture) {
  const total = 330, currentTotal = 165, collectorTotal = 155, states = [api.JobState.Complete, api.JobState.Failed, api.JobState.Queued, api.JobState.Running];
  fixture.activityJobs = Array.from({ length: total }, (_, index) => {
    const current = index < currentTotal, historical = index % 3, revision = current || historical === 1 ? fixture.headRevision : fixture.headRevision - 1;
    const profile = current || historical === 0 ? fixture.targetProfile : 'obsolete-profile', state = current ? states[index % states.length] : api.JobState.Failed;
    const base = fixture.jobAt(index), collectorId = `collector-${String(index % collectorTotal).padStart(3, '0')}`;
    const job = base.job.with({ revision, state, error: state === api.JobState.Failed ? current ? 'current-synthetic-failure' : 'historical-synthetic-failure' : state === api.JobState.Running ? 'prior-attempt-synthetic' : undefined, completedWindows: index % 9, totalWindows: index % 5 === 0 ? undefined : index % 9 + 10 });
    const metadata = fixture.metadata.with({ title: `${revision === fixture.headRevision ? 'Current' : 'Historical'} metadata ${String(index).padStart(3, '0')}`, project: `project-${index % 7}`, gitBranch: `branch-${index % 4}`, tags: [`tag-${index % 5}`] });
    const session = fixture.jobSession(job).with({ metadata, source: base.session.source.with({ collectorNamespace: `${collectorId}/native` }) });
    const classification = current ? api.ActivityJobClass.Current : historical === 0 ? api.ActivityJobClass.SupersededRevision : historical === 1 ? api.ActivityJobClass.ObsoleteProfile : api.ActivityJobClass.SupersededRevisionAndProfile;
    const active = state === api.JobState.Running && index % 3 === 0, expires = state !== api.JobState.Running || index % 3 === 2 ? undefined : active ? '2030-01-01T00:00:00Z' : '2020-01-01T00:00:00Z';
    return new api.ActivityJob(job, profile, classification, expires, active, current && state === api.JobState.Failed, collectorId, session, index % 17 === 0 ? undefined : new Date(Date.parse('2026-10-23T09:31:00Z') - Math.floor(index / 2) * 60000).toISOString());
  });
  fixture.jobs = fixture.activityJobs.map(item => item.job);
  fixture.archiveRows = fixture.activityJobs.map((job, index) => { const archived = fixture.archiveAt(index), head = archived.head.with({ source: job.session.source, metadata: job.job.revision === fixture.headRevision ? job.session.metadata : fixture.metadata.with({ title: `HEAD metadata ${index}` }) }); return archived.with({ head, headJob: job.classification === api.ActivityJobClass.Current ? job.job : undefined }); });
  fixture.activityCollectors = Array.from({ length: collectorTotal }, (_, index) => {
    const id = `collector-${String(index).padStart(3, '0')}`, jobs = fixture.activityJobs.filter(item => item.collectorId === id), heads = fixture.archiveRows.filter(archived => archived.head.source.collectorNamespace === `${id}/native`);
    const phase = [api.CollectorPhase.Idle, api.CollectorPhase.Discovering, api.CollectorPhase.Uploading, api.CollectorPhase.Failed][index % 4], stale = index % 5 === 0;
    const report = new api.CollectorProgressUpdate(id, BigInt(index + 1), `00000000-0000-4000-8000-${String(70000 + index).padStart(12, '0')}`, phase, '2026-10-26T11:50:00Z', new api.CollectorCounters(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0n), 0n, 0n, undefined, phase === api.CollectorPhase.Failed ? 'collector-synthetic-failure' : undefined);
    const collectorStatus = index % 3 === 0 ? undefined : new api.CollectorStatus(report, stale ? '2026-10-26T11:55:00Z' : `2026-10-26T11:59:${String(index % 10).padStart(2, '0')}Z`, stale);
    return new api.ActivityCollector(id, collectorStatus, BigInt(heads.length), BigInt(heads.filter(archived => archived.headJob === undefined).length), fixture.counts(jobs.filter(item => item.classification === api.ActivityJobClass.Current)), fixture.counts(jobs.filter(item => item.classification !== api.ActivityJobClass.Current)));
  });
}
/** Scripts `expression` on the job list as the jobs `predicate` selects (the fixture answers only scripted expressions). */
export function scriptJobs(fixture, expression, predicate) { fixture.jobExpressions.set(expression, fixture.jobRows.filter(predicate).map(item => item.job.id)); }
export { api };
