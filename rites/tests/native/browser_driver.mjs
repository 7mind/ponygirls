// Separate actual-native browser conformance leg. Uses only the compiled
// packaged UI and the real native API + owned Python loopback fixtures.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

if (process.argv.length !== 3) throw new Error('usage: browser_driver.mjs PRIVATE_PLAN.json');
const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const require = createRequire(path.join(plan.nodeModuleRoot, 'package.json'));
const { chromium } = require('playwright-core');
const checks = [];
let browser;
let runId = null;
let failure = null;

function reposTable(page) {
  return page.getByRole('table', { name: 'Repositories', exact: true });
}
function repoRow(page, id) {
  return reposTable(page).getByRole('row', { name: id });
}
function ritesTable(page) {
  return page.getByRole('table', { name: 'Rites', exact: true });
}
function riteRow(page, id) {
  return ritesTable(page).getByRole('row', { name: id });
}
async function notice(page, fragment) {
  await page.locator('#notice').filter({ hasText: fragment }).waitFor();
}
async function login(page, user) {
  const account = plan.users[user];
  await page.getByLabel('Login', { exact: true }).fill(account.login);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText(`Signed in as ${account.login}`, { exact: true }).waitFor();
}
async function openRites(page, repository) {
  await repoRow(page, repository).getByRole('button', { name: 'Rites', exact: true }).click();
  await page.getByRole('heading', { name: 'Rites', exact: true }).waitFor();
}
async function modelWrite(content) {
  const response = await fetch(`${plan.fixtureOrigin}/__fixture/model`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'write', content, hold: false }),
  });
  assert.equal(response.status, 200, 'fixture model control accepted');
}
async function createCredential(page) {
  await page.getByRole('button', { name: 'Credentials', exact: true }).click();
  await page.getByRole('button', { name: 'New credential', exact: true }).waitFor();
  await page.getByText('No credentials yet.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'New credential', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New credential', exact: true });
  await dialog.getByLabel('Name').fill('fixture-browser');
  await dialog.getByLabel('Forge').selectOption('Github');
  await dialog.getByLabel('Host', { exact: true }).fill(plan.host);
  await dialog.locator('input[name="secret"]').fill(plan.forgeKey);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await notice(page, 'Credential saved');
  assert.equal(await page.locator('input[name="secret"]').count(), 0, 'write-only secret control removed');
}
async function createRepository(page) {
  await page.getByRole('button', { name: 'Repositories', exact: true }).click();
  await page.getByRole('button', { name: 'New repository', exact: true }).waitFor();
  await page.getByText('No repositories yet.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'New repository', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New repository', exact: true });
  await dialog.getByLabel('Repository ID').fill(plan.repositoryId);
  await dialog.getByLabel('Forge').selectOption('Github');
  await dialog.getByLabel('Host', { exact: true }).fill(plan.host);
  await dialog.getByLabel('Project', { exact: true }).fill(plan.project);
  await dialog.getByLabel('Base branch', { exact: true }).fill('main');
  const credentialOption = dialog.getByLabel('Credential (your own only)')
    .locator('option', { hasText: 'fixture-browser' }).first();
  const credentialId = await credentialOption.getAttribute('value');
  assert.ok(credentialId, 'own credential is available');
  await dialog.getByLabel('Credential (your own only)').selectOption(credentialId);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await notice(page, 'Repository saved');
  await repoRow(page, plan.repositoryId).waitFor();
}
async function createRite(page) {
  await openRites(page, plan.repositoryId);
  await page.getByRole('button', { name: 'New rite', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `New rite for ${plan.repositoryId}`, exact: true });
  await dialog.getByLabel('Rite ID').fill(plan.riteId);
  await dialog.getByLabel('Schedule (UTC cron)').fill('0 0 1 1 *');
  await dialog.getByLabel('Prompt path').fill('prompt.md');
  await dialog.getByLabel('Model').selectOption('fixture');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await notice(page, 'Rite saved');
  await riteRow(page, plan.riteId).waitFor();
}
async function manualRun(page) {
  await modelWrite('browser-first\n');
  await riteRow(page, plan.riteId).getByRole('button', { name: 'Run now', exact: true }).click();
  await notice(page, 'is Queued');
  await riteRow(page, plan.riteId).getByRole('button', { name: 'History', exact: true }).click();
  const history = page.getByRole('table', { name: 'Run history', exact: true });
  await history.waitFor();
  const deadline = Date.now() + 100_000;
  for (;;) {
    const state = await page.evaluate(async ({ repositoryId, riteId }) => {
      const response = await fetch(`/api/repositories/${repositoryId}/rites/${riteId}/runs`, {
        headers: { 'Accept': 'application/json', 'X-Rites-Version': '0.2.0', 'X-Rites-User': 'owner' },
      });
      if (!response.ok) return { error: response.status };
      const body = await response.json();
      return body.items[0] ?? { pending: true };
    }, { repositoryId: plan.repositoryId, riteId: plan.riteId });
    if (state.id) runId = state.id;
    if (state.state === 'Published') break;
    if (state.state === 'Failed' || state.state === 'Cancelled' || state.state === 'PublicationUncertain') {
      throw new Error(`native browser run failed: ${state.state}/${state.failureCode ?? 'none'}`);
    }
    assert.equal(state.error, undefined, 'run history API remains available');
    if (Date.now() > deadline) throw new Error('native browser run deadline exceeded');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(250);
  }
  await history.getByText('Published', { exact: true }).first().waitFor();
  await page.keyboard.press('Escape');
}
async function addViewerAndSwitchPrincipal(page) {
  await page.getByRole('button', { name: 'Repositories', exact: true }).click();
  await repoRow(page, plan.repositoryId).getByRole('button', { name: 'Grants', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Grants for ${plan.repositoryId}`, exact: true });
  await dialog.getByLabel('User to grant').selectOption({ label: 'viewer' });
  await dialog.getByLabel('Role for new grant').selectOption('Viewer');
  await dialog.getByRole('button', { name: 'Add grant', exact: true }).click();
  await dialog.getByRole('table', { name: 'Repository grants', exact: true })
    .getByRole('row', { name: 'viewer' }).locator('.badge', { hasText: 'Viewer' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('heading', { name: 'Sign in to Rites', exact: true }).waitFor();
  assert.equal(await repoRow(page, plan.repositoryId).count(), 0, 'private repository UI cleared at logout');
  await login(page, 'viewer');
  await repoRow(page, plan.repositoryId).waitFor();
  await repoRow(page, plan.repositoryId).getByText('Viewer', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'New repository', exact: true }).count(), 0);
  await openRites(page, plan.repositoryId);
  await page.getByText('Read-only access: viewer role.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'New rite', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Run now', exact: true }).count(), 0);
  await page.getByText('History', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Credentials', exact: true }).click();
  await page.getByText('No credentials yet.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('table', { name: 'Credentials', exact: true }).getByRole('row', { name: 'fixture-browser' }).count(), 0, 'owner credential is not visible to viewer');
  assert.equal(await page.locator('input[name="secret"], input[name="refreshToken"]').count(), 0);
  assert.equal((await page.locator('#identity').innerText()).includes('owner'), false);
}

try {
  browser = await chromium.launch({
    executablePath: plan.chromium,
    headless: true,
    args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(`${plan.origin}/`);
    await login(page, 'owner');
    checks.push('native-login');
    await createCredential(page);
    checks.push('ui-write-only-credential');
    await createRepository(page);
    checks.push('ui-repository');
    await createRite(page);
    checks.push('ui-rite');
    await manualRun(page);
    checks.push('ui-manual-run-published');
    await addViewerAndSwitchPrincipal(page);
    checks.push('owner-to-viewer-private-state');
    assert.ok(runId, 'published native run identifier observed');
  } finally {
    await context.close();
  }
} catch (error) {
  failure = error instanceof Error ? `${error.name}: ${error.message}` : 'browser driver failure';
  throw error;
} finally {
  if (browser) await browser.close();
  writeFileSync(plan.resultPath, JSON.stringify({ ok: failure === null, checks, runId, failure }, null, 2), { mode: 0o600 });
}
