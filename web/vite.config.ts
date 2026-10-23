import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { ports, resolveBase } from './config/app.ts';
import { pwaOptions } from './config/pwa.ts';

const base = resolveBase();

export default defineConfig({
  base,
  plugins: [react(), VitePWA(pwaOptions(base))],
  define: {
    // ketcher-react's dist uses Node's bare `global` (its Redux root reducer writes
    // global.currentState on every dispatch) and its deps read process.env at load time.
    global: 'globalThis',
    'process.env': '{}',
  },
  server: {
    // The local API (uvicorn main:app on ports.dev) is served at <base>api/ like in production.
    proxy: {
      [`${base}api/`]: {
        target: `http://127.0.0.1:${ports.dev}`,
        rewrite: (path) => path.replace(base, '/'),
      },
    },
  },
  build: {
    sourcemap: false,
    // Ketcher's editor chunk is ~8 MB by design. Offline safety comes from the precache
    // guard, not from this warning.
    chunkSizeWarningLimit: 10_000,
  },
});
