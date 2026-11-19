// Layout quiescence: after a view has loaded, its scroll geometry (the document's and every scroll container's client and
// scroll sizes, and whether a scrollbar takes space) must stop changing within SETTLE_FRAMES animation frames and then stay
// unchanged for STABLE_FRAMES. A layout input that depends on whether a scrollbar is shown, while the scrollbar depends on
// that layout, flips forever instead (UX-JIT). Playwright starts headless Chromium with --hide-scrollbars, where scrollbars
// take no space and no such loop can occur, so this browser shows them; it also renders at an OS-level device scale (no
// viewport emulation), because emulated sizes stay whole CSS pixels while 125 % display scaling makes them fractional.
// chronicle/web/tests-browser/layout-quiescence.mjs is the same helper for the Chronicle browser scenarios, whose sources
// do not include this file. Used by the Haystack, Manure and account-view browser tests.

/** 100 % and 125 % display scaling. */
export const LAYOUT_SCALES = [1, 1.25];
const SETTLE_FRAMES = 30, STABLE_FRAMES = 60, THRESHOLD_STEP = 3, FRACTION_PHASES = 4, MEASURE_HEIGHT = 320, TRACE_FRAMES = 8, RESIZE_ATTEMPTS = 3;
const PROBE = '__layoutQuiescence';

/** Headless Chromium (`chromium`, a Playwright browser type) whose classic scrollbars take space, at device scale `scale`. */
export function launchWithScrollbars(chromium, scale, { executablePath, args }) {
  return chromium.launch({ headless: true, executablePath, ignoreDefaultArgs: ['--hide-scrollbars'], args: [...args, `--force-device-scale-factor=${scale}`] });
}
// Runs before every document: keeps the native requestAnimationFrame (a page clock installed later replaces it) and counts
// ResizeObserver callbacks and layout shifts for failure reports.
function probe(key) {
  const raf = window.requestAnimationFrame;
  if (!/\[native code\]/.test(Function.prototype.toString.call(raf))) throw new Error('The layout probe must be installed before the page clock.');
  const state = { raf: raf.bind(window), resizeCallbacks: 0, layoutShifts: 0 };
  Object.defineProperty(window, key, { value: state });
  const Native = window.ResizeObserver;
  window.ResizeObserver = class extends Native { constructor(callback) { super((entries, observer) => { state.resizeCallbacks++; callback(entries, observer); }); } };
  new PerformanceObserver(list => { state.layoutShifts += list.getEntries().length; }).observe({ type: 'layout-shift', buffered: true });
}
/** A browser context sized by its window (see `resizeWindow`), with the layout probe installed before any page clock. */
export async function layoutContext(browser, options) {
  const context = await browser.newContext({ ...options, viewport: null });
  await context.addInitScript(probe, PROBE);
  return context;
}
/**
 * Resizes the page's window until its viewport is `width` × `height` device-independent pixels, within a pixel. A full
 * Chromium's window is taller than its viewport, and at 125 % its window size snaps, so each attempt corrects the last one.
 */
export async function resizeWindow(page, width, height) {
  const session = await page.context().newCDPSession(page), viewport = () => page.evaluate(() => [innerWidth, innerHeight]);
  try {
    for (let attempt = 0; attempt < RESIZE_ATTEMPTS; attempt++) {
      const { windowId, bounds } = await session.send('Browser.getWindowForTarget'), [w, h] = await viewport();
      if (Math.abs(w - width) <= 1 && Math.abs(h - height) <= 1) return;
      await session.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: width + bounds.width - w, height: height + bounds.height - h } });
      await page.waitForFunction(([w, h]) => innerWidth !== w || innerHeight !== h, [w, h]);
    }
    throw new Error(`The viewport did not become ${width}x${height} in ${RESIZE_ATTEMPTS} attempts: ${(await viewport()).join('x')}`);
  } finally { await session.detach(); }
}
// Runs in the page: samples the scroll geometry once per animation frame until it has been unchanged for `stable` frames.
function sample({ key, settle, stable }) {
  const state = window[key];
  if (state === undefined) throw new Error('Layout probe missing: create the context with layoutContext().');
  const name = element => element === document.scrollingElement ? 'document' : element.tagName.toLowerCase() + [...element.classList].map(item => `.${item}`).join('');
  const containers = [document.scrollingElement, ...[...document.querySelectorAll('body *')].filter(element => element.getClientRects().length > 0 && /(auto|scroll)/.test(getComputedStyle(element).overflowX + getComputedStyle(element).overflowY))];
  const geometry = () => containers.map(element => {
    const root = element === document.scrollingElement, style = getComputedStyle(element);
    const vertical = root ? innerWidth - element.clientWidth : element.offsetWidth - element.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
    const horizontal = root ? innerHeight - element.clientHeight : element.offsetHeight - element.clientHeight - parseFloat(style.borderTopWidth) - parseFloat(style.borderBottomWidth);
    return `${name(element)} ${element.clientWidth}x${element.clientHeight}/${element.scrollWidth}x${element.scrollHeight}${vertical > 0 ? ' v' : ''}${horizontal > 0 ? ' h' : ''}`;
  }).join(' | ');
  return new Promise(resolve => {
    const trace = [], counters = () => ({ resizeCallbacks: state.resizeCallbacks, layoutShifts: state.layoutShifts });
    let settledAt = null;
    const frame = () => {
      const now = geometry(), previous = trace.at(-1);
      trace.push(now);
      if (settledAt === null && now === previous) settledAt = trace.length - 2;
      if (settledAt === null && trace.length > settle) { resolve({ quiet: false, phase: `still changing after ${settle} frames`, trace, ...counters() }); return; }
      if (settledAt !== null && now !== trace[settledAt]) { resolve({ quiet: false, phase: `changed again ${trace.length - 1 - settledAt} frames after settling`, trace, ...counters() }); return; }
      if (settledAt !== null && trace.length - 1 - settledAt >= stable) { resolve({ quiet: true, trace, ...counters() }); return; }
      state.raf(frame);
    };
    state.raf(frame);
  });
}
/** Fails unless the page's scroll geometry settles within SETTLE_FRAMES frames and then stays unchanged for STABLE_FRAMES. */
export async function assertLayoutQuiescent(page, label) {
  const result = await page.evaluate(sample, { key: PROBE, settle: SETTLE_FRAMES, stable: STABLE_FRAMES });
  if (result.quiet) return;
  const first = Math.max(0, result.trace.length - TRACE_FRAMES), frames = result.trace.slice(first).map((line, index) => `  frame ${first + index}: ${line}`).join('\n');
  throw new Error(`${label}: layout ${result.phase} (${new Set(result.trace).size} distinct states, ${result.resizeCallbacks} ResizeObserver callbacks, ${result.layoutShifts} layout shifts so far); last frames:\n${frames}`);
}
/**
 * The window height at which `scroller` (a selector; the document when null) starts to scroll vertically at window width
 * `width`, measured at a window height where it overflows.
 */
export async function scrollThreshold(page, width, scroller) {
  await resizeWindow(page, width, MEASURE_HEIGHT);
  await assertLayoutQuiescent(page, `threshold measurement at ${width}x${MEASURE_HEIGHT}`);
  const overflow = await page.evaluate(selector => { const element = selector === null ? document.scrollingElement : document.querySelector(selector); if (element === null) throw new Error(`No element matches ${selector}`); return element.scrollHeight - element.clientHeight; }, scroller);
  if (overflow <= 0) throw new Error(`${scroller ?? 'The document'} does not scroll at ${width}x${MEASURE_HEIGHT}; the threshold cannot be measured.`);
  return MEASURE_HEIGHT + overflow;
}
/**
 * Asserts quiescence at the sizes around the scroll threshold of `scroller` at window width `width`: just below, at and just
 * above it, and with the content shorter than the window at every fractional phase of the CSS width (125 % scaling repeats
 * after four device-independent pixels). Returns the sizes checked.
 */
export async function assertQuiescentAroundThreshold(page, label, { width, scroller }) {
  const threshold = await scrollThreshold(page, width, scroller);
  const sizes = [[width, threshold - THRESHOLD_STEP], [width, threshold], ...Array.from({ length: FRACTION_PHASES }, (_, phase) => [width + phase, threshold + THRESHOLD_STEP])];
  for (const [w, h] of sizes) { await resizeWindow(page, w, h); await assertLayoutQuiescent(page, `${label} at ${w}x${h} (threshold ${threshold})`); }
  return sizes;
}
