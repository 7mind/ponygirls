import { browserTheme } from '../src/theme.ts';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App.tsx';
import { createBrowserManager, connectionConfig } from '../src/transport/browser.ts';
import '../src/styles.css';
const root = document.getElementById('root');
if (root === null) throw new Error('Fixture root missing');
const connection = createBrowserManager(window, document, connectionConfig);
createRoot(root).render(<App connection={connection} theme={browserTheme(window, document)}/>);
