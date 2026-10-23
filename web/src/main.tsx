import { createRoot } from 'react-dom/client';
import App from './App';
import { blockDebugHotkeys } from './editor/debugHotkeys';
import './index.css';
import { registerServiceWorker } from './pwa/register';

// Before the editor exists, so this listener runs ahead of Ketcher's.
blockDebugHotkeys();

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');
createRoot(root).render(<App />);
registerServiceWorker();
