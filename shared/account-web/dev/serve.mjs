// Static server for the account-view harness (dev/index.html). No dependencies.
//   node shared/account-web/dev/serve.mjs [port]      (port 0 or omitted: ephemeral)
// /ui/* resolves from ONE location: shared/ui-web/ when it exists, otherwise the reference copies in
// docs/drafts/20261117-2130-dashboard-redesign/ (override with ACCOUNT_DEV_UI_DIR).
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const REPOSITORY_DIR = resolve(PACKAGE_DIR, '../..');
const DEV_DIR = join(PACKAGE_DIR, 'dev');
const SHARED_UI_DIR = join(REPOSITORY_DIR, 'shared/ui-web');
const REFERENCE_UI_DIR = join(REPOSITORY_DIR, 'docs/drafts/20261117-2130-dashboard-redesign');
const PACKAGE_FILES = ['account.js', 'account.css', 'account-client.js'];
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const LOOPBACK = '127.0.0.1';

export function uiDirectory() {
  if (process.env.ACCOUNT_DEV_UI_DIR !== undefined) return resolve(process.env.ACCOUNT_DEV_UI_DIR);
  return existsSync(SHARED_UI_DIR) ? SHARED_UI_DIR : REFERENCE_UI_DIR;
}

// Resolves a request path to a file inside `base`, or null for anything that escapes it.
function inside(base, relative) {
  const file = normalize(join(base, relative));
  return file.startsWith(base + sep) ? file : null;
}
function resolveFile(pathname, ui) {
  if (pathname === '/' || pathname === '/index.html') return join(DEV_DIR, 'index.html');
  const name = pathname.slice(1);
  if (PACKAGE_FILES.includes(name)) return join(PACKAGE_DIR, name);
  if (pathname.startsWith('/dev/')) return inside(DEV_DIR, pathname.slice('/dev/'.length));
  if (pathname.startsWith('/ui/')) return inside(ui, pathname.slice('/ui/'.length));
  return null;
}

export async function startDevServer({ port }) {
  const ui = uiDirectory();
  const server = createServer(async (request, response) => {
    const file = resolveFile(new URL(request.url, 'http://harness').pathname, ui);
    if (file === null) { response.statusCode = 404; response.end(); return; }
    try {
      const body = await readFile(file);
      response.setHeader('Content-Type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      response.end(body);
    } catch (cause) {
      if (cause.code !== 'ENOENT') throw cause;
      response.statusCode = 404; response.end();
    }
  });
  await new Promise(resolveListen => server.listen(port, LOOPBACK, resolveListen));
  return { origin: `http://${LOOPBACK}:${server.address().port}`, ui, close: () => new Promise(resolveClose => server.close(resolveClose)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { origin, ui } = await startDevServer({ port: Number(process.argv[2] ?? 0) });
  console.log(`account harness: ${origin}/?scenario=settings-tokens  (ui: ${ui})`);
}
