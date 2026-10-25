// Vitest's on-disk module cache is off: with it, a test's import.meta.glob of fixture files
// kept the list from the run that cached it, and new fixtures were silently left out.
import { expect, it } from 'vitest';
import config from '../vitest.config';

it('transforms every test file afresh, so a glob sees every fixture file', () => {
  expect(config.test?.fsModuleCache).toBe(false);
});
