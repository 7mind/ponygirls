import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createBrowserManager, connectionConfig } from './transport/browser.ts';
import './styles.css';
const root = document.getElementById('root');
if (root === null) throw new Error('Missing application root');
const connection = createBrowserManager(window, document, connectionConfig);
createRoot(root).render(<App connection={connection}/>);
