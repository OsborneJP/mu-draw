import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { registerServiceWorker } from './pwa/register';

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');
createRoot(root).render(<App />);
registerServiceWorker();
