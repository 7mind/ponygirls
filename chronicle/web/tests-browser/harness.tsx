import { createRoot } from 'react-dom/client';
import { App } from '../src/App.tsx';
import { createBrowserManager, connectionConfig } from '../src/transport/browser.ts';
import '../src/styles.css';
const root = document.getElementById('root');
if (root === null) throw new Error('Fixture root missing');
const connection = createBrowserManager(window, document, {
  ...connectionConfig, connectTimeout: 500, pongTimeout: 300, heartbeatInterval: 600,
  staleGrace: 900, requestTimeout: 700, retryBase: 50, retryCap: 200, maxAttempts: 3,
  tickInterval: 100, pauseThreshold: 300,
});
createRoot(root).render(<App connection={connection}/>);
