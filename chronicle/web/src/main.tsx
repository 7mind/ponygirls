import { browserTheme } from './theme.ts';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createBrowserManager, connectionConfig } from './transport/browser.ts';
const root = document.getElementById('root');
if (root === null) throw new Error('Missing application root');
const connection = createBrowserManager(window, document, connectionConfig);
createRoot(root).render(<App connection={connection} theme={browserTheme(window, document)}/>);
