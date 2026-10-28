import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { api } from './goal50-fixture.mjs';
const TEXT_CONTRAST = 4.5, CONTROL_CONTRAST = 3, GEOMETRY_TOLERANCE = 1, USAGE_TABLE_MIN_WIDTH = 720, ACTIVITY_MAX_WIDTH = 1500;
async function measure(page, phase) {
  return page.evaluate(label => {
    const geometry = element => { if (element === null) return null; const bounds = element.getBoundingClientRect(), style = getComputedStyle(element); return { left: bounds.left, right: bounds.right, width: bounds.width, client: element.clientWidth, scroll: element.scrollWidth, overflow: style.overflowX }; };
    return { phase: label, viewport: innerWidth, document: document.documentElement.scrollWidth, zoom: getComputedStyle(document.documentElement).zoom, documentOverflow: getComputedStyle(document.documentElement).overflowX, bodyOverflow: getComputedStyle(document.body).overflowX, main: geometry(document.querySelector('main')), usage: geometry(document.querySelector('.model-usage')), scroller: geometry(document.querySelector('.goal50-table-scroll')), table: geometry(document.querySelector('.usage-table')), owner: geometry(document.querySelector('.owner-reindex')), preview: geometry(document.querySelector('[aria-label="Archive rebuild preview"]')) };
  }, phase);
}
async function contrast(page) {
  return page.evaluate(() => {
    const rgba = value => { const parts = value.match(/[\d.]+/g).map(Number); return [parts[0], parts[1], parts[2], parts[3] === undefined ? 1 : parts[3]]; };
    const luminance = values => values.map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const background = element => { const chain = []; for (let node = element; node !== null; node = node.parentElement) chain.push(node); let color = [255, 255, 255]; for (const node of chain.reverse()) { const value = rgba(getComputedStyle(node).backgroundColor); color = color.map((channel, index) => value[index] * value[3] + channel * (1 - value[3])); } return color; };
    const ratio = (foreground, back) => { const front = back.map((channel, index) => foreground[index] * foreground[3] + channel * (1 - foreground[3])), a = luminance(front), b = luminance(back); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
    const selectors = '.model-usage summary,.model-usage p,.model-usage h3,.model-usage th,.model-usage td strong,.model-usage td small,.model-usage td:not(:has(*)),.goal50-settings dt,.goal50-settings dd,.owner-reindex p,.owner-reindex h3,.owner-reindex label,.owner-reindex button:enabled';
    const text = [...document.querySelectorAll(selectors)].filter(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0).map(element => ({ element: element.tagName, text: element.textContent.slice(0, 80), ratio: ratio(rgba(getComputedStyle(element).color), background(element)) }));
    const button = document.querySelector('.owner-reindex>button'), style = getComputedStyle(button), back = background(button);
    return { text, border: ratio(rgba(style.borderTopColor), back), focus: ratio(rgba(style.outlineColor), back), focusWidth: parseFloat(style.outlineWidth) };
  });
}
export async function runActivityLayoutCases(scene, activity) {
  const output = fileURLToPath(new URL(`../test-results/goal50-activity-layout/run-${new Date().toISOString().replaceAll(':', '-')}/`, import.meta.url)), records = [];
  await mkdir(output, { recursive: true });
  try {
    for (const [width, scale] of [[390, 1], [320, 1], [390, 2], [320, 2], [720, 1], [1600, 1]]) for (const colorScheme of ['light', 'dark']) {
      const { context, page, fixture } = await scene(undefined, { width, height: 1000 }, scale);
      const phases = [], name = `${colorScheme}-css${width}-dpr${scale}`;
      try {
        await page.emulateMedia({ colorScheme }); await activity(page);
        const summary = page.getByText('Model usage and indexing settings', { exact: true }), trigger = page.getByRole('button', { name: 'Rebuild archive index', exact: true });
        phases.push(await measure(page, 'both-collapsed')); await page.screenshot({ path: `${output}/${name}-collapsed.png`, fullPage: true });
        await summary.click(); const table = page.getByRole('table', { name: 'Completed model call usage', exact: true }); await table.waitFor(); phases.push(await measure(page, 'usage-expanded'));
        const contents = await table.textContent(); await trigger.click(); const preview = page.getByRole('region', { name: 'Archive rebuild preview', exact: true }); await preview.getByRole('checkbox').waitFor();
        assert.equal(await preview.getByRole('checkbox').isChecked(), false); assert.equal(await preview.getByRole('button', { name: 'Confirm archive index rebuild', exact: true }).isDisabled(), true);
        await page.keyboard.press('Tab'); await trigger.focus();
        const colors = await contrast(page); phases.push(await measure(page, 'usage-and-preview-expanded')); await page.screenshot({ path: `${output}/${name}-expanded.png`, fullPage: true });
        await summary.click(); phases.push(await measure(page, 'usage-collapsed-preview-expanded')); await summary.click(); await table.waitFor();
        assert.equal(await table.textContent(), contents); assert.equal(await table.locator('thead th').count(), 6); assert.equal(await table.locator('tbody tr').count(), 4); assert.equal(await table.locator('tbody td').count(), 20);
        const scroll = page.locator('.goal50-table-scroll'); await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
        const horizontal = await scroll.evaluate(element => { const header = element.querySelector('thead th:last-child').getBoundingClientRect(), bounds = element.getBoundingClientRect(); return { left: element.scrollLeft, client: element.clientWidth, scroll: element.scrollWidth, headerLeft: header.left, headerRight: header.right, leftEdge: bounds.left, rightEdge: bounds.right, pageX: window.scrollX }; });
        await preview.getByRole('button', { name: 'Cancel archive rebuild preview', exact: true }).click(); phases.push(await measure(page, 'usage-expanded-preview-cancelled')); await summary.click(); phases.push(await measure(page, 'both-collapsed-again'));
        const png = await readFile(`${output}/${name}-expanded.png`); assert.equal(png.readUInt32BE(16), width * scale);
        records.push({ name, colorScheme, deviceScaleFactor: scale, physicalScreenshotWidth: png.readUInt32BE(16), zoomInterpretation: scale === 1 ? 'native CSS viewport' : 'effective CSS viewport at 2x device scale; not actual browser zoom', phases, horizontal, colors });
        await writeFile(`${output}/metrics.json`, JSON.stringify({ syntheticOnly: true, providerCalls: 0, records }, null, 2));
        for (const phase of phases) {
          assert.ok(phase.document <= phase.viewport, `${name}: document overflow ${JSON.stringify(phase)}`);
          assert.equal(phase.main.overflow, 'visible'); assert.ok(!['hidden', 'clip'].includes(phase.documentOverflow)); assert.ok(!['hidden', 'clip'].includes(phase.bodyOverflow));
          if (phase.table !== null) assert.ok(phase.table.width >= USAGE_TABLE_MIN_WIDTH);
          if (width > ACTIVITY_MAX_WIDTH) { assert.equal(phase.main.width, ACTIVITY_MAX_WIDTH); assert.equal(phase.main.left, (width - ACTIVITY_MAX_WIDTH) / 2); }
          assert.ok(phase.main.left >= -GEOMETRY_TOLERANCE && phase.main.right <= phase.viewport + GEOMETRY_TOLERANCE, `${name}: main escaped viewport ${JSON.stringify(phase)}`);
        }
        if (width <= USAGE_TABLE_MIN_WIDTH) { assert.ok(horizontal.scroll > horizontal.client); assert.ok(horizontal.left > 0); }
        assert.ok(horizontal.headerLeft >= horizontal.leftEdge - GEOMETRY_TOLERANCE && horizontal.headerRight <= horizontal.rightEdge + GEOMETRY_TOLERANCE, `last usage column is not reachable: ${JSON.stringify(horizontal)}`); assert.equal(horizontal.pageX, 0);
        for (const item of colors.text) assert.ok(item.ratio >= TEXT_CONTRAST, `${name}: text contrast ${JSON.stringify(item)}`);
        assert.ok(colors.border >= CONTROL_CONTRAST, `${name}: control border contrast ${colors.border}`); assert.ok(colors.focusWidth >= 3 && colors.focus >= CONTROL_CONTRAST, `${name}: focus contrast ${JSON.stringify(colors)}`);
        assert.equal(fixture.calls.some(call => call.operation instanceof api.Operation_ApplyOwnerReindex || call.operation instanceof api.Operation_StartMcpTest), false);
      } finally { await context.close(); }
    }
  } finally { await writeFile(`${output}/metrics.json`, JSON.stringify({ syntheticOnly: true, providerCalls: 0, records }, null, 2)); console.log(`Activity layout evidence: ${output}`); }
}
