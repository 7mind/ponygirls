import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Behavioral / Active / Blackbox / Good Communication; regression: Fit must
// constrain both axes, while Actual size and zoom remain unrestricted.
test('portrait and landscape images fit both axes at desktop and narrow viewport sizes', async () => {
  assert.ok(process.env.CHROMIUM_BIN, 'set CHROMIUM_BIN to an installed Chromium executable');
  const template = await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  const probe = `
    const timer = setInterval(() => {
      const img = document.querySelector('.viewport img');
      if (!img?.complete || !img.naturalWidth) return;
      clearInterval(timer);
      const buttons = [...document.querySelectorAll('button')];
      buttons.find(b => b.textContent === 'Actual size').click();
      const actual = img.getBoundingClientRect();
      buttons.find(b => b.textContent === '+ Zoom in').click();
      const zoomed = img.getBoundingClientRect();
      buttons.find(b => b.textContent === 'Fit / reset').click();
      const image = img.getBoundingClientRect();
      const viewport = document.querySelector('.viewport');
      const css = getComputedStyle(viewport);
      document.body.dataset.fit = JSON.stringify({
        width:image.width, height:image.height,
        availableWidth:viewport.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
        availableHeight:viewport.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom),
        actualWidth:actual.width, actualHeight:actual.height,
        zoomedWidth:zoomed.width, zoomedHeight:zoomed.height,
        naturalWidth:img.naturalWidth, naturalHeight:img.naturalHeight
      });
    }, 50);`;
  const server = createServer(async (req,res) => {
    try {
      if (['/portrait','/landscape'].includes(req.url)) {
        const html = template.replaceAll('__MANURE_ASSET_BASE__','/assets').replaceAll('__MANURE_PATH__','image.svg').replaceAll('__MANURE_RAW_URL__',`/__manure/raw/${req.url.slice(1)}.svg`).replaceAll('__MANURE_DOWNLOAD_URL__','/download').replaceAll('__MANURE_KIND__','image').replace('</body>','<script type="module" src="/probe.js"></script></body>');
        res.setHeader('content-type','text/html'); res.end(html);
      } else if (req.url === '/probe.js') {res.setHeader('content-type','text/javascript'); res.end(probe);}
      else if (req.url.startsWith('/__manure/raw/')) {
        const portrait = req.url.includes('portrait');
        res.setHeader('content-type','image/svg+xml');
        res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${portrait ? 400 : 4000}" height="${portrait ? 4000 : 400}"><rect width="100%" height="100%" fill="blue"/></svg>`);
      } else if (/^\/assets\/[\w.-]+$/.test(req.url)) {
        res.setHeader('content-type',req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(await readFile(new URL(`../dist/${req.url.split('/').pop()}`,import.meta.url)));
      } else {res.statusCode=404; res.end();}
    } catch {res.statusCode=500; res.end();}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const profile = await mkdtemp(join(tmpdir(),'manure-image-fit-'));
  try {
    for (const size of ['1000,800','600,500']) for (const shape of ['portrait','landscape']) {
      const {stdout} = await promisify(execFile)(process.env.CHROMIUM_BIN,[
        '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--user-data-dir=${profile}`,
        `--window-size=${size}`,'--dump-dom','--virtual-time-budget=10000',`http://127.0.0.1:${server.address().port}/${shape}`,
      ],{timeout:30000,maxBuffer:4 * 1024 * 1024});
      const value = stdout.match(/data-fit="([^"]*)"/)?.[1];
      assert.ok(value,`${shape} @ ${size}: image probe did not run`);
      const fit = JSON.parse(value.replaceAll('&quot;','"'));
      assert.ok(fit.width <= fit.availableWidth + 1 && fit.height <= fit.availableHeight + 1,`${shape} @ ${size}: fitted ${fit.width}x${fit.height} exceeds viewport ${fit.availableWidth}x${fit.availableHeight}`);
      assert.equal(fit.actualWidth,fit.naturalWidth);
      assert.equal(fit.actualHeight,fit.naturalHeight);
      assert.equal(fit.zoomedWidth,fit.naturalWidth * 1.25);
      assert.equal(fit.zoomedHeight,fit.naturalHeight * 1.25);
      assert.ok(Math.abs(fit.width / fit.height - fit.naturalWidth / fit.naturalHeight) < .01,'Fit preserves aspect ratio');
    }
  } finally {await new Promise(resolve => server.close(resolve)); await rm(profile,{recursive:true,force:true});}
});
