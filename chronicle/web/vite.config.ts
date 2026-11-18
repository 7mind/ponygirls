import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extname, join, resolve, sep } from 'node:path';
interface SharedAsset { readonly name: string; readonly contentType: string; read(): Promise<string | Uint8Array> }
interface IconModule { iconSprite(): string }
function sharedRoot(variable: string, fallback: string): string { const value = process.env[variable]; return value === undefined ? fileURLToPath(new URL(fallback, import.meta.url)) : value; }
function sharedAssets(): Plugin {
  const account = sharedRoot('ACCOUNT_WEB_ROOT', '../../shared/account-web/'), ui = sharedRoot('UI_WEB_ROOT', '../../shared/ui-web/');
  const file = (root: string, path: string, name: string, contentType: string): SharedAsset => ({ name, contentType, read: async () => readFileSync(join(root, path)) });
  const assets: readonly SharedAsset[] = [
    file(account, 'account.js', 'account.js', 'text/javascript'), file(account, 'account-client.js', 'account-client.js', 'text/javascript'), file(account, 'account.css', 'account.css', 'text/css'),
    file(ui, 'tokens.css', 'ui/tokens.css', 'text/css'), file(ui, 'components.css', 'ui/components.css', 'text/css'), file(ui, 'theme-init.js', 'ui/theme-init.js', 'text/javascript'),
    file(ui, 'fonts/InterVariable.woff2', 'ui/fonts/InterVariable.woff2', 'font/woff2'), file(ui, 'fonts/LICENSE.txt', 'ui/fonts/LICENSE.txt', 'text/plain'),
    { name: 'ui/icons.svg', contentType: 'image/svg+xml', read: async () => (await import(pathToFileURL(join(ui, 'icons.js')).href) as IconModule).iconSprite() },
  ];
  return {
    name: 'shared-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = new URL(request.url!, 'http://localhost').pathname.slice(1), asset = assets.find(candidate => candidate.name === name);
        if (asset === undefined) { next(); return; }
        asset.read().then(source => { response.setHeader('Content-Type', asset.contentType); response.end(source); }, next);
      });
    },
    async generateBundle() {
      for (const asset of assets) this.emitFile({ type: 'asset', fileName: asset.name, source: await asset.read() });
    },
  };
}
const BUNDLE_CONTENT_TYPES: Readonly<Record<string, string>> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
// Browser-suite switch (tests-browser/run-all.mjs): files of a prebuilt bundle directory take precedence over dev transforms,
// so pages load as in production instead of compiling hundreds of modules per page in every scenario process.
function prebuiltBundle(directory: string): Plugin {
  const root = resolve(directory);
  return {
    name: 'browser-suite-bundle',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname), file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (!file.startsWith(`${root}${sep}`) || !statSync(file, { throwIfNoEntry: false })?.isFile()) { next(); return; }
        response.setHeader('Content-Type', BUNDLE_CONTENT_TYPES[extname(file)] ?? 'application/octet-stream'); response.end(readFileSync(file));
      });
    },
  };
}
const DEFAULT_CACHE_DIR = '.cache/vite';
// Pre-bundled at server start: lazy discovery in a cold cache reloads the page in the middle of a browser test.
const PREBUNDLED_DEPENDENCIES = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'];
const bundle = process.env.CHRONICLE_BROWSER_BUNDLE;
export default defineConfig({
  cacheDir: process.env.CHRONICLE_VITE_CACHE_DIR === undefined ? DEFAULT_CACHE_DIR : process.env.CHRONICLE_VITE_CACHE_DIR,
  optimizeDeps: bundle === undefined ? { include: PREBUNDLED_DEPENDENCIES } : { noDiscovery: true, include: [] },
  plugins: bundle === undefined ? [react(), sharedAssets()] : [prebuiltBundle(bundle), react(), sharedAssets()],
  server: { fs: { allow: ['..'] } },
});
