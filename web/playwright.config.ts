import { defineConfig } from '@playwright/test';

// The smoke tests start their own server and browser profile (see e2e/fixtures.ts).
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // Deadlines, not waits: every step waits on an event or an exact value, and a step that
  // needs longer than this is broken.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  forbidOnly: true,
  reporter: [['list']],
});
