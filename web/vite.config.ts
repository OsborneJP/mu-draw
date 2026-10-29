import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { ports, resolveBase } from './config/app.ts';
import { cspPlugin } from './config/csp.ts';
import { indigoSource } from './config/indigoSource.ts';
import { ketcherSaveFormats, MIEW_STAND_IN } from './config/ketcherTrim.ts';
import { noticesLog } from './config/noticesLog.ts';
import { appTitle, htmlTitle, pwaOptions } from './config/pwa.ts';
import { rdkitWasm, workerFileName } from './config/rdkitWasm.ts';
import pkg from './package.json' with { type: 'json' };

const base = resolveBase();
// What the build bundles, for the licence notices' inventory (scripts/notices/inventory.ts).
const log = noticesLog();

export default defineConfig({
  base,
  plugins: [
    react(),
    htmlTitle(appTitle(base)),
    cspPlugin(),
    rdkitWasm(),
    ketcherSaveFormats(),
    indigoSource(),
    log.main,
    VitePWA(pwaOptions(base)),
  ],
  // Ketcher's Miew viewer stays out of the build, for its licence (config/ketcherTrim.ts).
  resolve: { alias: [MIEW_STAND_IN] },
  define: {
    // ketcher-react's dist uses Node's bare `global` (its Redux root reducer writes
    // global.currentState on every dispatch) and its deps read process.env at load time.
    global: 'globalThis',
    'process.env': '{}',
    // Shown in the About box, so students can say which build they have.
    __APP_VERSION__: JSON.stringify(pkg.version),
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
  worker: {
    // The RDKit worker at a fixed path, which the server gives its own CSP (config/csp.ts).
    rolldownOptions: { output: { entryFileNames: workerFileName } },
    plugins: () => [log.worker()],
  },
  build: {
    sourcemap: false,
    // Ketcher's editor chunk is ~8 MB by design. Offline safety comes from the precache
    // guard, not from this warning.
    chunkSizeWarningLimit: 10_000,
  },
});
