// Serves the content shell (manure/web/unlock: chrome.js, content.css and the shared design system under
// ui/) to the standalone viewer browser tests, as the server does under <mount>/__manure/shell/.
import { readFile } from 'node:fs/promises';

const SHELL_ROOT = new URL('../../unlock/', import.meta.url);
const TYPES = { css: 'text/css', js: 'text/javascript', woff2: 'font/woff2' };

export const SHELL_BASE = '/shell';

/** Answers `/shell/<file>` from the content shell; returns false for other URLs. */
export async function serveShell(req, res) {
  const match = req.url.match(/^\/shell\/((?:ui\/(?:fonts\/)?)?[\w.-]+\.(css|js|woff2))$/);
  if (!match) return false;
  res.setHeader('content-type', TYPES[match[2]]);
  res.end(await readFile(new URL(match[1], SHELL_ROOT)));
  return true;
}

// Page probes wait for rendered state, re-checking after each event-loop turn (headless --dump-dom runs
// on virtual time, where animation frames are not reliably delivered); the bound is a turn count, not a time.
const MAX_TURNS = 2500;
export const UNTIL = `const until = async (predicate, message) => {
  for (let turn = 0; turn < ${MAX_TURNS}; turn++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve));
  }
  throw new Error(message);
};`;
