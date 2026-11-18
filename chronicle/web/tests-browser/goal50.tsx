import { createRoot } from 'react-dom/client';
import { App } from '../src/App.tsx';
import { browserTheme } from '../src/theme.ts';
import { createBrowserManager } from '../src/transport/browser.ts';
import { fixtureConnectionConfig } from './connection-timing.ts';
const root = document.getElementById('root');
if (root === null) throw new Error('Synthetic goal50 root missing');
const connection = createBrowserManager(window, document, fixtureConnectionConfig(window.location.search));
createRoot(root).render(<App connection={connection} theme={browserTheme(window, document)}/>);
