import { createRoot } from 'react-dom/client';
import { App } from '../src/App.tsx';
import { browserTheme } from '../src/theme.ts';
import { createBrowserManager, connectionConfig } from '../src/transport/browser.ts';
const root = document.getElementById('root');
if (root === null) throw new Error('Synthetic goal50 root missing');
const connection = createBrowserManager(window, document, { ...connectionConfig, connectTimeout: 500, pongTimeout: 1000, heartbeatInterval: 2000, staleGrace: 1000, requestTimeout: 20_000, retryBase: 50, retryCap: 200, maxAttempts: 3 });
createRoot(root).render(<App connection={connection} theme={browserTheme(window, document)}/>);
