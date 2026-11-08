// Mobile layout (narrow viewport) and basic keyboard ergonomics.
import assert from 'node:assert/strict';
import { check, scene } from './harness.mjs';

export async function run(env, counts) {
  const { browser, origin } = env;

  await check(counts, 'mobile viewport: no horizontal overflow, nav and tables usable', async () => {
    const { page, close } = await scene(browser, origin, {
      user: 'alice',
      viewport: { width: 375, height: 667 },
    });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement,
        scrollW: document.documentElement.scrollWidth,
        clientW: window.innerWidth,
      }));
      assert.ok(overflow.scrollW <= overflow.clientW, `document must not scroll horizontally (${overflow.scrollW} > ${overflow.clientW})`);
      for (const name of ['Repositories', 'Credentials', 'Users']) {
        assert.ok(await page.getByRole('button', { name, exact: true }).isVisible(), `nav button ${name} visible on mobile`);
      }
      // Navigating between views by tap works on the narrow layout.
      await page.getByRole('button', { name: 'Credentials', exact: true }).click();
      await page.getByRole('table', { name: 'Credentials', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Repositories', exact: true }).click();
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
    } finally {
      await close();
    }
  });

  await check(counts, 'mobile viewport: repository dialog fits the screen and closes by Escape', async () => {
    const { page, close } = await scene(browser, origin, {
      user: 'alice',
      viewport: { width: 375, height: 667 },
    });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await page.getByRole('button', { name: 'New repository', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New repository', exact: true });
      await dialog.waitFor();
      const box = await dialog.boundingBox();
      assert.ok(box !== null);
      const viewport = page.viewportSize();
      assert.ok(box.x >= 0 && box.x + box.width <= (viewport?.width ?? 0) + 1, 'dialog fits horizontally');
      assert.ok(box.width <= (viewport?.width ?? 0) + 1, 'dialog is not wider than the viewport');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
    } finally {
      await close();
    }
  });

  await check(counts, 'mobile viewport: rites view opens from a row tap', async () => {
    const { page, close } = await scene(browser, origin, {
      user: 'carol',
      viewport: { width: 375, height: 667 },
    });
    try {
      await page.getByRole('table', { name: 'Repositories', exact: true }).waitFor();
      await page.getByRole('table', { name: 'Repositories', exact: true })
        .getByRole('row', { name: 'pony/core' })
        .getByRole('button', { name: 'Rites', exact: true }).click();
      await page.getByRole('table', { name: 'Rites', exact: true }).waitFor();
      await page.getByText('Read-only access: viewer role.', { exact: true }).waitFor();
    } finally {
      await close();
    }
  });
}
