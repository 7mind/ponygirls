// Runs every browser scenario script as its own child process, with bounded concurrency.
// Contract: docs/drafts/20261117-2140-test-overhaul-plan.md §4.4.
//   CHRONICLE_BROWSER_POOL                 pool size, positive integer (default: min(7, floor(cores / 2)), at least 1)
//   CHRONICLE_BROWSER_SCRIPT_TIMEOUT_MS    hard per-script limit, positive integer (default 480000)
//   NIX_BUILD_CORES                        core count when set and positive, otherwise os.availableParallelism()
//   CHRONICLE_BROWSER_JUNIT_DIR            when set, writes chronicle-browser.xml there: one JUnit case per script
// Each child gets its own Vite cache directory (CHRONICLE_VITE_CACHE_DIR, read by vite.config.ts) under $TMPDIR;
// scenario scripts bind port 0, so ports are per process as well.
// Exit status: 0 all scripts passed; 1 a script failed or timed out; 2 invalid configuration or no script ran.
import { spawn } from 'node:child_process';
import { availableParallelism, tmpdir } from 'node:os';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const NODE_ARGS = ['--experimental-transform-types', '--import', './tests/resolve-generated.mjs'];
const DEFAULT_POOL_CEILING = 7, CORES_PER_SCRIPT = 2, DEFAULT_SCRIPT_TIMEOUT_MS = 480000;
const EXIT_FAILED = 1, EXIT_CONFIGURATION = 2;
// Registration: add the entry file name here. Longest scripts first, so the pool's tail is short.
const SCRIPTS = [
  'rebuild.mjs', 'run.mjs', 'goal50.mjs', 'ux.mjs', 'activity-tables.mjs', 'refresh-regression.mjs', 'theme-retry.mjs',
  'filter-table-ux.mjs', 'live-archive.mjs', 'popup-regression.mjs', 'tool-catalog.mjs', 'history-find.mjs', 'rebuild-occlusion.mjs',
  'persistent-login.mjs', 'search-serp.mjs', 'transcript.mjs', 'usage-presentation.mjs', 'source-filters.mjs', 'prior-error-regression.mjs',
  'ui-controls.mjs', 'tab-layout.mjs',
];

function positiveInteger(name, value) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${name} must be a positive integer, got '${value}'`);
  return Number(value);
}
function envInteger(name, fallback) { const value = process.env[name]; return value === undefined || value === '' ? fallback : positiveInteger(name, value); }
function poolSize() {
  const cores = envInteger('NIX_BUILD_CORES', availableParallelism());
  return envInteger('CHRONICLE_BROWSER_POOL', Math.max(1, Math.min(DEFAULT_POOL_CEILING, Math.floor(cores / CORES_PER_SCRIPT))));
}

function xmlEscape(text) { return text.replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]); }
async function writeJunit(directory, results, failures) {
  const cases = results.map(result => `  <testcase classname="chronicle.browser" name="${xmlEscape(result.script)}" time="${result.seconds.toFixed(3)}">`
    + `${result.status === 'ok' ? '' : `<failure message="${xmlEscape(result.detail)}"/>`}</testcase>`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'chronicle-browser.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="chronicle-browser" tests="${results.length}" failures="${failures}" errors="0" skipped="0">\n${cases.join('\n')}\n</testsuite>\n`);
}

const children = new Set();
function killGroup(child) { if (child.pid === undefined) return; try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }

function runScript(script, cacheRoot, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now(), chunks = [];
    let child, timer, finished = false;
    const finish = (status, detail) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      if (child !== undefined) { children.delete(child); killGroup(child); }
      resolve({ script, status, detail, seconds: (Date.now() - started) / 1000, output: Buffer.concat(chunks).toString('utf8') });
    };
    try {
      child = spawn(process.execPath, [...NODE_ARGS, `tests-browser/${script}`], {
        cwd: WEB_ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CHRONICLE_VITE_CACHE_DIR: join(cacheRoot, script) },
      });
    } catch (error) { finish('FAIL', `spawn error: ${error.message}`); return; }
    children.add(child);
    let timedOut = false;
    timer = setTimeout(() => { timedOut = true; killGroup(child); }, timeoutMs);
    // Streams are absent when spawn fails with EMFILE/ENFILE; the 'error' event reports that failure.
    for (const stream of [child.stdout, child.stderr]) if (stream !== null && stream !== undefined) stream.on('data', chunk => chunks.push(chunk));
    child.on('error', error => finish('FAIL', `spawn error: ${error.message}`));
    child.on('close', (code, signal) => timedOut ? finish('FAIL', `timed out after ${timeoutMs} ms`) : code === 0 ? finish('ok', '') : finish('FAIL', signal === null ? `exit ${code}` : `signal ${signal}`));
  });
}

async function main() {
  const pool = poolSize(), timeoutMs = envInteger('CHRONICLE_BROWSER_SCRIPT_TIMEOUT_MS', DEFAULT_SCRIPT_TIMEOUT_MS);
  if (SCRIPTS.length === 0) throw new Error('No browser scripts registered');
  const cacheRoot = await mkdtemp(join(tmpdir(), 'chronicle-browser-')), results = [], queue = [...SCRIPTS], started = Date.now();
  console.log(`browser pool: ${SCRIPTS.length} scripts, ${pool} at a time`);
  async function worker() {
    for (let script = queue.shift(); script !== undefined; script = queue.shift()) {
      const result = await runScript(script, cacheRoot, timeoutMs);
      results.push(result);
      console.log(`=== ${result.script}: ${result.status === 'ok' ? 'ok' : `FAIL (${result.detail})`} in ${result.seconds.toFixed(1)} s`);
      process.stdout.write(result.output.endsWith('\n') || result.output === '' ? result.output : `${result.output}\n`);
    }
  }
  try { await Promise.all(Array.from({ length: Math.min(pool, SCRIPTS.length) }, worker)); }
  finally { await rm(cacheRoot, { recursive: true, force: true }); }
  const failed = results.filter(result => result.status !== 'ok');
  if (process.env.CHRONICLE_BROWSER_JUNIT_DIR !== undefined) await writeJunit(process.env.CHRONICLE_BROWSER_JUNIT_DIR, results, failed.length);
  console.log(`browser summary (${((Date.now() - started) / 1000).toFixed(1)} s wall, pool ${pool}):`);
  for (const result of [...results].sort((a, b) => b.seconds - a.seconds)) console.log(`  ${result.status === 'ok' ? 'ok  ' : 'FAIL'} ${result.seconds.toFixed(1).padStart(6)} s  ${result.script}${result.detail === '' ? '' : `  (${result.detail})`}`);
  if (results.length === 0) { console.error('no browser script ran'); return EXIT_CONFIGURATION; }
  console.log(`${results.length - failed.length}/${results.length} scripts passed`);
  return failed.length === 0 ? 0 : EXIT_FAILED;
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const child of children) killGroup(child); process.exit(128 + (signal === 'SIGINT' ? 2 : 15)); });
main().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = EXIT_CONFIGURATION; });
