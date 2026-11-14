import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from '../chronicle/web/node_modules/playwright-core/index.mjs';

// Specified: controlled browser checks of built dashboard markup, CSP and SVG decoding.
const dashboards = [
  { name: 'manure', root: 'manure/web/dashboard/', csp: "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" },
  { name: 'chronicle', root: 'chronicle/web/dist/', csp: "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" },
  { name: 'haystack', root: 'haystack/web/dist/', csp: null },
];
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Use the pinned Chronicle development shell');
const browser = await chromium.launch({ headless: true });
try {
  const icons = new Set();
  for (const dashboard of dashboards) {
    const root = new URL(`../${dashboard.root}`, import.meta.url);
    const html = await readFile(new URL('index.html', root), 'utf8');
    const svg = await readFile(new URL('favicon.svg', root), 'utf8');
    icons.add(svg);
    const server = createServer((request, response) => {
      const headers = dashboard.csp === null ? {} : { 'Content-Security-Policy': dashboard.csp };
      if (request.url === '/') response.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end(html);
      else if (request.url === '/favicon.svg') response.writeHead(200, { ...headers, 'Content-Type': 'image/svg+xml' }).end(svg);
      else response.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const page = await browser.newPage();
    try {
      // App startup is outside this asset contract; retain the actual document and its CSP.
      await page.route('**/*', route => ['script', 'stylesheet'].includes(route.request().resourceType()) ? route.abort() : route.continue());
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      assert.equal(await page.locator('link[rel="icon"]').count(), 1);
      const result = await page.evaluate(async () => {
        const link = document.querySelector('link[rel="icon"]');
        const url = new URL(link.href);
        const response = await fetch(url);
        const image = new Image();
        image.src = url.href;
        await image.decode();
        return { type: link.type, sameOrigin: url.origin === location.origin, status: response.status, mime: response.headers.get('content-type'), width: image.naturalWidth, height: image.naturalHeight };
      });
      assert.equal(result.type, 'image/svg+xml');
      assert.equal(result.sameOrigin, true);
      assert.equal(result.status, 200);
      assert.equal(result.mime, 'image/svg+xml');
      assert.ok(result.width > 0 && result.height > 0);
      assert.doesNotMatch(svg, /<(script|foreignObject|image|text)\b|\bon\w+=|href=/i);
      console.log(`PASS ${dashboard.name}: bundled favicon resolves and decodes under dashboard CSP`);
    } finally {
      await page.close();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
  assert.equal(icons.size, dashboards.length, 'Services need distinct icons');
} finally {
  await browser.close();
}
