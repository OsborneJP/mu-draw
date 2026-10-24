import { defineConfig } from '@playwright/test';

// The smoke tests start their own server and browser profile (see e2e/fixtures.ts).
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // Each test keeps a whole browser profile there (about 50 MB, so about 4 GB a run); with
  // the disk nearly full, Chrome's storage quota shrank and service workers failed to
  // install. Only failures keep theirs.
  preserveOutput: 'failures-only',
  // Deadlines, not waits: every step waits on an event or an exact value, and a step that
  // needs longer than this is broken.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: 0,
  workers: 1,
  forbidOnly: true,
  reporter: [['list']],
});
