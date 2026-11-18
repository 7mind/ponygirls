// Serves the shared design system (shared/ui-web) to the standalone viewer browser tests, as the
// server does under <mount>/__manure/ui/; the viewer's layout and icons depend on it.
import { readFile } from 'node:fs/promises';

const UI_ROOT = new URL('../../../../shared/ui-web/', import.meta.url);
const TYPES = { css: 'text/css', js: 'text/javascript', woff2: 'font/woff2' };

export const UI_BASE = '/ui';

/** Answers `/ui/<file>` from shared/ui-web; returns false for other URLs. */
export async function serveUi(req, res) {
  const match = req.url.match(/^\/ui\/((?:fonts\/)?[\w.-]+\.(css|js|woff2))$/);
  if (!match) return false;
  res.setHeader('content-type', TYPES[match[2]]);
  res.end(await readFile(new URL(match[1], UI_ROOT)));
  return true;
}
