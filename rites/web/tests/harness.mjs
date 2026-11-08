// Test harness for the Rites web UI browser tests.
//
// Every scene drives the real compiled UI (rites/target/browser) in pinned
// Chromium through a synthetic local fixture (server.mjs). The fixture
// mirrors the documented REST contract but is NOT the real Rites backend.

import assert from 'node:assert/strict';

export function newCounts() {
  return { passed: 0, failed: 0, failures: [] };
}

export async function check(counts, name, fn) {
  try {
    await fn();
    counts.passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    counts.failed += 1;
    counts.failures.push(name);
    console.log(`  FAIL - ${name}\n      ${error?.stack ?? error}`);
  }
}

export const PASSWORDS = {
  alice: 'pw-alice',
  bob: 'pw-bob',
  carol: 'pw-carol',
};

export async function login(page, login, password) {
  await page.getByLabel('Login', { exact: true }).fill(login);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText(`Signed in as ${login}`, { exact: true }).waitFor();
}

export async function scene(browser, origin, options) {
  const opts = options ?? {};
  const viewport = opts.viewport ?? { width: 1440, height: 1000 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(`${origin}/`);
  if (opts.user !== undefined) {
    await login(page, opts.user, PASSWORDS[opts.user]);
  }
  return { page, context, async close() { await context.close(); } };
}

// The production poll interval is a fixed 10 s; tests exercise the real
// visibilitychange refresh path (which runs the same tick) instead of waiting
// on the wall-clock interval or shortening any deadline.
export async function triggerPoll(page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

export async function settlePoll(page) {
  await page.waitForTimeout(250);
}

export async function openRitesFor(page, repoId) {
  await page.getByRole('table', { name: 'Repositories', exact: true })
    .getByRole('row', { name: new RegExp(repoId.replace('/', '/')) })
    .getByRole('button', { name: 'Rites', exact: true })
    .click();
  await page.getByRole('table', { name: 'Rites', exact: true }).waitFor();
}

export async function noticeText(page) {
  const notice = page.locator('#notice');
  await notice.waitFor();
  return notice.innerText();
}

export async function waitForNotice(page, fragment) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const text = await page.locator('#notice').innerText().catch(() => '');
    if (text.includes(fragment)) return text;
    if (Date.now() > deadline) {
      throw new Error(`notice containing "${fragment}" never appeared; last: ${JSON.stringify(text)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function assertIsUuid(value, what) {
  assert.match(value ?? '', UUID_RE, `${what} must be a UUID, got ${value}`);
}
