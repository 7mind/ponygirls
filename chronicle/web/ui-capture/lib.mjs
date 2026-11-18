// Capture rig: Vite dev server on an ephemeral port + pinned Chromium + screenshot recorder.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

export const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PRIMARY = { width: 1440, height: 900, tag: '1440' };
export const SECONDARY = { width: 1024, height: 700, tag: '1024' };
export const PHONE = { width: 390, height: 844, tag: '390' };

export async function startRig() {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Set PLAYWRIGHT_BROWSERS_PATH to the pinned Playwright 1.64.1 browsers (the chronicle dev shell does this); nothing is downloaded.');
  const server = await createServer({ root: WEB_ROOT, server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer.address();
  if (address === null || typeof address === 'string') throw new Error('Vite has no TCP address');
  const browser = await chromium.launch({ headless: true });
  return { origin: `http://127.0.0.1:${address.port}`, browser, async close() { await browser.close(); await server.close(); } };
}

/** Writes numbered PNGs and index.md; one Recorder per run. */
export class Recorder {
  constructor(outDir) { this.outDir = outDir; this.counter = 0; this.entries = []; this.dumps = []; }
  async init(browser) { await mkdir(join(this.outDir, 'inventory'), { recursive: true }); this.browser = browser; this.checker = null; this.blank = []; }
  /** Decodes the PNG in a scratch page and reports the share of the dominant colour; near 100% means a blank capture. */
  async imageStats(buffer) {
    if (this.checker === null) this.checker = await this.browser.newPage();
    return this.checker.evaluate(async base64 => {
      const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data, counts = new Map();
      for (let i = 0; i < data.length; i += 4 * 7) { const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]; counts.set(key, (counts.get(key) ?? 0) + 1); }
      const total = Math.ceil(data.length / 28), top = Math.max(...counts.values());
      return { width: image.width, height: image.height, dominantShare: +(top / total).toFixed(3), colours: counts.size };
    }, buffer.toString('base64'));
  }
  // `file` names the capture like its mockup shot (`<app>-<view>-<state>-<width>.png`); otherwise it is numbered.
  async shot(page, { name, state, viewport, full = false, clip, file: named }, shows, reached) {
    const file = named ?? `${String(++this.counter).padStart(3, '0')}-${name}-${state}${full ? '-full' : ''}-${viewport.tag}.png`;
    const buffer = await page.screenshot({ path: join(this.outDir, file), fullPage: full, ...(clip === undefined ? {} : { clip }) });
    const stats = await this.imageStats(buffer);
    if (stats.dominantShare > 0.985 || stats.colours < 4) this.blank.push(`${file} dominantShare=${stats.dominantShare} colours=${stats.colours}`);
    this.entries.push({ file, shows, reached, stats });
    console.log(`  shot ${file} ${stats.width}x${stats.height} dominant=${stats.dominantShare}`);
    return file;
  }
  async dump(name, data) { const file = `inventory/${name}.json`; await writeFile(join(this.outDir, file), JSON.stringify(data, null, 1)); this.dumps.push(file); }
  async writeIndex(meta) {
    const rows = this.entries.map(entry => `| \`${entry.file}\` | ${entry.shows} | ${entry.reached} |`).join('\n');
    const blank = this.blank.length === 0 ? 'No capture was flagged blank (dominant colour share > 98.5%).' : `Flagged as possibly blank:\n${this.blank.map(line => `- ${line}`).join('\n')}`;
    const dumps = this.dumps.map(file => `- \`${file}\``).join('\n');
    await writeFile(join(this.outDir, 'index.md'), `# Chronicle dashboard capture\n\n${meta}\n\n${this.entries.length} screenshots. ${blank}\n\n| File | Shows | How it was reached |\n|---|---|---|\n${rows}\n\n## DOM inspection dumps\n\n${dumps}\n`);
  }
}

/** New browser context + page with a scripted server; navigates to the production entry. */
export async function openScene(rig, { viewport = PRIMARY, scheme = 'light', fixture, install, errors, waitSignedIn = true }) {
  const context = await rig.browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: scheme, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => errors.push(`${error.message}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  await fixture.install(page);
  if (install !== undefined) await install(page);
  await page.goto(`${rig.origin}/`);
  if (waitSignedIn) await page.getByRole('navigation', { name: 'Main navigation', exact: true }).waitFor();
  return { context, page };
}

const NAV_LABELS = { archive: 'Archive', search: 'Search', activity: 'Activity', access: 'Access', mcp: 'MCP' };
export const nav = (page, tab) => page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: NAV_LABELS[tab], exact: true });
export async function gotoTab(page, tab) { await nav(page, tab).click(); }

export async function archiveReady(page) {
  await page.getByRole('table', { name: 'Conversations', exact: true }).waitFor();
  await page.locator('.archive-table[aria-busy="false"]').waitFor();
  await page.locator('.archive-row .table-title').first().waitFor();
}
export async function activityReady(page) {
  await page.locator('.activity-overview').waitFor();
  await page.locator('.activity-collector-row').first().waitFor();
  await page.locator('.activity-job-row').first().waitFor();
  await page.locator('.activity-table[aria-busy="false"]').first().waitFor();
}
export async function openSession(page) {
  await page.getByRole('dialog', { name: 'Source conversation', exact: true }).waitFor();
  await page.locator('.conversation-intro h2').waitFor();
  await page.locator('.original-message').first().waitFor();
}
export const settle = (page, ms = 250) => page.waitForTimeout(ms);

/** Runs in the page: scroll containers, sticky/fixed elements, tables. */
export function inspectDom() {
  const describe = element => {
    const label = element.getAttribute('aria-label');
    const classes = [...element.classList].slice(0, 3).map(c => '.' + c).join('');
    return `${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}${classes}${label ? `[aria-label="${label}"]` : ''}`;
  };
  const path = element => { const parts = []; for (let el = element; el && el !== document.body && parts.length < 5; el = el.parentElement) parts.unshift(describe(el)); return parts.join(' > '); };
  const scrollers = [], sticky = [], tables = [];
  for (const element of document.querySelectorAll('body *')) {
    const style = getComputedStyle(element);
    if (element.getClientRects().length === 0) continue;
    const overflowY = style.overflowY, overflowX = style.overflowX;
    if (/(auto|scroll)/.test(overflowY + overflowX)) {
      const rect = element.getBoundingClientRect();
      scrollers.push({ selector: path(element), overflowX, overflowY, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, scrollableY: element.scrollHeight > element.clientHeight + 1, scrollableX: element.scrollWidth > element.clientWidth + 1, scrollTop: Math.round(element.scrollTop), height: style.height, maxHeight: style.maxHeight, overscrollBehaviorY: style.overscrollBehaviorY, top: Math.round(rect.top), tabindex: element.getAttribute('tabindex'), role: element.getAttribute('role') });
    }
    if (style.position === 'sticky' || style.position === 'fixed') { const rect = element.getBoundingClientRect(); sticky.push({ selector: path(element), position: style.position, top: style.top, left: style.left, right: style.right, bottom: style.bottom, zIndex: style.zIndex, rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)] }); }
  }
  for (const table of document.querySelectorAll('table')) {
    if (table.getClientRects().length === 0) continue;
    tables.push({ selector: path(table), layout: getComputedStyle(table).tableLayout, width: Math.round(table.getBoundingClientRect().width), columns: [...table.querySelectorAll('thead th')].map(th => ({ id: th.dataset.columnId ?? null, label: th.textContent.trim().slice(0, 40), width: Math.round(th.getBoundingClientRect().width), sticky: getComputedStyle(th).position })), rows: table.querySelectorAll('tbody tr').length });
  }
  const doc = document.documentElement;
  const scrollingDocument = { scrollHeight: doc.scrollHeight, innerHeight: innerHeight, scrollWidth: doc.scrollWidth, innerWidth: innerWidth, bodyPosition: getComputedStyle(document.body).position, bodyOverflow: getComputedStyle(document.body).overflow, pageScrollable: doc.scrollHeight > innerHeight + 1 };
  const nested = scrollers.filter(item => item.scrollableY).length + (scrollingDocument.pageScrollable ? 1 : 0);
  return { scrollingDocument, independentlyScrollableRegionsY: nested, scrollers, sticky, tables };
}
/** Runs in the page: contrast, type sizes, spacing values and target sizes of everything visible (or the open modal's subtree). */
export function auditDom() {
  const parse = value => { const match = /rgba?\(([^)]+)\)/.exec(value); if (match === null) return null; const parts = match[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }; };
  const over = (top, bottom) => { const a = top.a + bottom.a * (1 - top.a); return a === 0 ? { r: 255, g: 255, b: 255, a: 0 } : { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a }; };
  const luminance = ({ r, g, b }) => { const f = c => { const v = c / 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const background = element => { let colour = { r: 255, g: 255, b: 255, a: 1 }; const chain = []; for (let el = element; el !== null; el = el.parentElement) chain.push(el); for (const el of chain.reverse()) { const bg = parse(getComputedStyle(el).backgroundColor); if (bg !== null && bg.a > 0) colour = over(bg, colour); } return colour; };
  const modal = document.querySelector('dialog:modal'), root = modal ?? document.body;
  const sizes = new Map(), failures = new Map(), targets = new Map(), spacing = { padding: new Map(), gap: new Map(), radius: new Map() };
  let texts = 0, below = 0;
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  const label = element => element.tagName.toLowerCase() + [...element.classList].slice(0, 2).map(c => '.' + c).join('');
  for (const element of root.querySelectorAll('*')) {
    const style = getComputedStyle(element), rects = element.getClientRects();
    if (rects.length === 0 || style.visibility === 'hidden') continue;
    const direct = [...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim().length > 0);
    if (direct && !element.classList.contains('sr-only')) {
      const rect = rects[0]; if (rect.width < 2 || rect.height < 2) continue;
      texts++; const size = parseFloat(style.fontSize); bump(sizes, size);
      const fg = parse(style.color), bg = background(element); if (fg === null) continue;
      const colour = over(fg, bg), lf = luminance(colour), lb = luminance(bg), ratio = (Math.max(lf, lb) + .05) / (Math.min(lf, lb) + .05);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700), need = large ? 3 : 4.5;
      if (ratio < need) { below++; bump(failures, `${label(element)} | ${style.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}) | ${size}px | ratio ${ratio.toFixed(2)} (need ${need}) | "${element.textContent.trim().slice(0, 30)}"`); }
    }
    if (element.matches('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=separator]')) { const rect = rects[0]; if (rect.width < 24 || rect.height < 24) bump(targets, `${label(element)} ${Math.round(rect.width)}x${Math.round(rect.height)}${element.getAttribute('aria-label') ? ' [' + element.getAttribute('aria-label') + ']' : ''}`); }
    bump(spacing.padding, style.padding); bump(spacing.gap, style.gap); bump(spacing.radius, style.borderRadius);
  }
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return { scope: modal === null ? 'document' : 'open modal dialog', textElements: texts, belowWcagAA: below, fontSizesPx: [...sizes.entries()].sort((a, b) => a[0] - b[0]), distinctFontSizes: sizes.size, textBelow11px: [...sizes.entries()].filter(([size]) => size < 11).reduce((sum, [, n]) => sum + n, 0), contrastFailures: top(failures, 25), smallTargetsUnder24px: top(targets, 25), computedPaddingValues: { distinct: spacing.padding.size, top: top(spacing.padding, 12) }, computedGapValues: { distinct: spacing.gap.size, top: top(spacing.gap, 8) }, computedRadiusValues: { distinct: spacing.radius.size, top: top(spacing.radius, 8) } };
}


/** Variants: the deep pass is the primary light 1440x900 run; the others re-shoot key pages. */
export const VARIANTS = {
  deep: { viewport: PRIMARY, scheme: 'light', suffix: '', deep: true },
  tablet: { viewport: SECONDARY, scheme: 'light', suffix: '', deep: false },
  dark: { viewport: PRIMARY, scheme: 'dark', suffix: '-dark', deep: false },
  mobile: { viewport: PHONE, scheme: 'light', suffix: '', deep: false },
};

/** Opens a scene, runs body({page, fixture, shot}), always closes the context. */
export async function withScene({ rig, recorder, errors }, variant, { fixture, install, waitSignedIn }, body) {
  const { context, page } = await openScene(rig, { viewport: variant.viewport, scheme: variant.scheme, fixture, install, errors, waitSignedIn });
  const shot = (name, state, shows, reached, options = {}) => recorder.shot(page, { name, state: state + variant.suffix, viewport: variant.viewport, ...options }, shows + (variant.suffix === '-dark' ? ' (dark theme)' : ''), reached);
  try { return await body({ page, fixture, shot, variant, context }); } finally { await context.close(); }
}
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function scrollTo(page, selector, top) { await page.locator(selector).evaluate((element, value) => { element.scrollTop = value; }, top); await page.waitForTimeout(300); }
export async function scrollEnd(page, selector) { await page.locator(selector).evaluate(element => { element.scrollTop = element.scrollHeight; }); await page.waitForTimeout(400); }
export async function rowCount(page, selector) { return page.locator(selector).count(); }

export async function inspect(page, recorder, name) { const data = { ...await page.evaluate(inspectDom), audit: await page.evaluate(auditDom) }; await recorder.dump(name, data); return data; }
