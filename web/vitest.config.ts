import { defineConfig } from 'vitest/config';

// Unit tests only: pure logic, no network, never reading dist/. Browser tests live in e2e/.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'config/**/*.test.ts', 'scripts/**/*.test.{ts,mjs}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist*/**'],
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
});
