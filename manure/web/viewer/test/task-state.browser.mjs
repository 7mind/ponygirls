import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Behavioral / Active / Blackbox / Good Communication; regression: GFM task
// state must survive sanitization without allowing uploaded interactive inputs.
test('checked and unchecked Markdown tasks retain static accessible states', async () => {
  assert.ok(process.env.CHROMIUM_BIN, 'set CHROMIUM_BIN to an installed Chromium executable');
  const template = await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
  const probe = `const timer = setInterval(() => {
    const article = document.querySelector('article.markdown');
    if (!article) return;
    clearInterval(timer);
    const tasks = [...article.querySelectorAll('li')];
    document.body.dataset.tasks = JSON.stringify(tasks.map(li => ({text:li.textContent, state:li.querySelector('[role="img"]')?.getAttribute('aria-label')})));
    document.body.dataset.inputs = article.querySelectorAll('input').length;
  },50);`;
  const html = template.replaceAll('__MANURE_ASSET_BASE__','/assets').replaceAll('__MANURE_PATH__','readme.md').replaceAll('__MANURE_RAW_URL__','/__manure/raw/readme.md').replaceAll('__MANURE_DOWNLOAD_URL__','/download').replaceAll('__MANURE_KIND__','markdown').replace('</body>','<script type="module" src="/probe.js"></script></body>');
  const server = createServer(async (req,res) => {
    try {
      if (req.url === '/') {res.setHeader('content-type','text/html'); res.end(html);}
      else if (req.url === '/probe.js') {res.setHeader('content-type','text/javascript'); res.end(probe);}
      else if (req.url === '/__manure/raw/readme.md') res.end('- [x] completed task\n- [ ] pending task\n\n<input type="checkbox" checked><input type="text" value="untrusted">');
      else if (/^\/assets\/[\w.-]+$/.test(req.url)) {
        res.setHeader('content-type',req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(await readFile(new URL(`../dist/${req.url.split('/').pop()}`,import.meta.url)));
      } else {res.statusCode=404; res.end();}
    } catch {res.statusCode=500; res.end();}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const profile = await mkdtemp(join(tmpdir(),'manure-tasks-'));
  try {
    const {stdout} = await promisify(execFile)(process.env.CHROMIUM_BIN,[
      '--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--user-data-dir=${profile}`,
      '--dump-dom','--virtual-time-budget=10000',`http://127.0.0.1:${server.address().port}/`,
    ],{timeout:30000,maxBuffer:4 * 1024 * 1024});
    const value = stdout.match(/data-tasks="([^"]*)"/)?.[1];
    assert.ok(value,'task probe did not run');
    const tasks = JSON.parse(value.replaceAll('&quot;','"'));
    assert.equal(tasks[0].state,'Completed task','checked task must retain accessible completed state');
    assert.equal(tasks[1].state,'Incomplete task','unchecked task must retain accessible incomplete state');
    assert.match(tasks[0].text,/☑.*completed task/);
    assert.match(tasks[1].text,/☐.*pending task/);
    assert.match(stdout,/data-inputs="0"/,'uploaded input elements must remain forbidden');
  } finally {await new Promise(resolve => server.close(resolve)); await rm(profile,{recursive:true,force:true});}
});
