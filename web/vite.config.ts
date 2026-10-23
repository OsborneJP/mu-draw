import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { ports, resolveBase } from './config/app';

const base = resolveBase();

export default defineConfig({
  base,
  plugins: [react()],
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
  },
});
