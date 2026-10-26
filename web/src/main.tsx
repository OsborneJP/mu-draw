// First of all: ketcher-react (which App brings in) reads its saved settings as soon as its
// code loads, so the ACS style must already be in storage (editor/acsStart.ts).
import './editor/acsStart';
import { createRoot } from 'react-dom/client';
import App from './App';
import { blockDebugHotkeys } from './editor/debugHotkeys';
import { addFormulaButton } from './editor/formulaText';
import './index.css';
import { registerServiceWorker } from './pwa/register';

// Before the editor exists, so this listener runs ahead of Ketcher's.
blockDebugHotkeys();
// Formula text in each Text Editor Ketcher opens.
addFormulaButton();

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');
createRoot(root).render(<App />);
registerServiceWorker();
