import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
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
const DEFAULT_CACHE_DIR = '.cache/vite';
// Pre-bundled at server start: lazy discovery in a cold cache reloads the page in the middle of a browser test.
const PREBUNDLED_DEPENDENCIES = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'];
export default defineConfig({ cacheDir: process.env.CHRONICLE_VITE_CACHE_DIR === undefined ? DEFAULT_CACHE_DIR : process.env.CHRONICLE_VITE_CACHE_DIR, optimizeDeps: { include: PREBUNDLED_DEPENDENCIES }, plugins: [react(), sharedAssets()], server: { fs: { allow: ['..'] } } });
