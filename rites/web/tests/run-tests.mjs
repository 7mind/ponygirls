// Browser test suite runner for the Rites web UI.
//
// 1. Compiles the app with the pinned TypeScript from rites/node_modules
//    (tsc -p web/tsconfig.json -> rites/target/browser).
// 2. Serves the packaged layout (root index.html, web/, generated/) plus a
//    synthetic in-memory API fixture on one local origin.
// 3. Drives the compiled UI in pinned Chromium (playwright-core 1.64.1,
//    PLAYWRIGHT_BROWSERS_PATH) through every tests/*.test.mjs module.
//
// The fixture is synthetic; it is not the real Rites backend. Assertions about
// request/response shapes are therefore about the UI's behavior, not proof of
// backend conformance.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer, fixture } from './server.mjs';
import { newCounts } from './harness.mjs';

const testsDir = fileURLToPath(new URL('.', import.meta.url));
const ritesRoot = path.resolve(testsDir, '../..');

function buildApp() {
  const tsc = path.join(ritesRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  const result = spawnSync(tsc, ['-p', 'web/tsconfig.json'], { cwd: ritesRoot, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`tsc -p web/tsconfig.json failed with status ${result.status}`);
  }
}

async function main() {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    throw new Error('Set PLAYWRIGHT_BROWSERS_PATH to the provisioned Playwright 1.64.1 browsers; tests never download browsers.');
  }
  buildApp();

  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });

  const env = { browser, origin, fixture };
  const totals = newCounts();
  const modules = readdirSync(testsDir)
    .filter(name => name.endsWith('.test.mjs'))
    .sort();
  for (const name of modules) {
    console.log(`# ${name}`);
    fixture.reset();
    const counts = newCounts();
    try {
      const mod = await import(`./${name}`);
      await mod.run(env, counts);
    } catch (error) {
      counts.failed += 1;
      counts.failures.push(`module crashed: ${error?.stack ?? error}`);
      console.log(`  CRASH - ${error?.stack ?? error}`);
    }
    totals.passed += counts.passed;
    totals.failed += counts.failed;
    totals.failures.push(...counts.failures);
    console.log(`  ${name}: ${counts.passed} passed, ${counts.failed} failed`);
  }

  await browser.close();
  server.close();

  console.log(`\nTOTAL: ${totals.passed} passed, ${totals.failed} failed`);
  if (totals.failed > 0) {
    console.log('Failures:');
    for (const name of totals.failures) console.log(`  - ${name}`);
    process.exitCode = 1;
  }
}

await main();
