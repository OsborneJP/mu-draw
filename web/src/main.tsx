// First of all: ketcher-react (which App brings in) reads its saved settings as soon as its
// code loads, so the ACS style must already be in storage (editor/acsStart.ts).
import './editor/acsStart';
// Listening for the browser's offer to install the app before anything is drawn.
import './pwa/install';
import { createRoot } from 'react-dom/client';
import App from './App';
import { blockDebugHotkeys } from './editor/debugHotkeys';
import { addFormulaButton } from './editor/formulaText';
import './index.css';
import { registerServiceWorker } from './pwa/register';
import { startUsage } from './usage/start';

// Before the editor exists, so this listener runs ahead of Ketcher's.
blockDebugHotkeys();
// Formula text in each Text Editor Ketcher opens.
addFormulaButton();

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');
createRoot(root).render(<App />);
registerServiceWorker();
// Anonymous weekly usage counts (docs/plans/v2-usage-counts.md).
startUsage();
