// The fixture's guards must be live: each test here breaks one rule on purpose and checks
// that the guard reports it.
import { expect, openEditor, test, waitForServiceWorker } from './fixtures.ts';

test('the navigation guard is live: a reload nobody clicked for is reported', async ({ app }) => {
  await openEditor(app);
  await app.page.evaluate(() => location.reload());
  const problem = `navigation: reload to ${app.server.url} without a click on Reload`;
  await expect(app.failed).rejects.toThrow(problem);
  expect(app.problems).toEqual([problem]);
  app.problems.length = 0;
});

test('the takeover guard is live: SKIP_WAITING nobody clicked for is reported', async ({ app }) => {
  await openEditor(app);
  await waitForServiceWorker(app);
  // The first visit isn't controlled yet (prompt mode never claims pages), so message the
  // registration's active worker directly.
  await app.page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    registration!.active!.postMessage({ type: 'SKIP_WAITING' });
  });
  const problem = 'takeover: a waiting service worker was told to take over without a click on Reload';
  await expect(app.failed).rejects.toThrow(problem);
  expect(app.problems).toEqual([problem]);
  app.problems.length = 0;
});
