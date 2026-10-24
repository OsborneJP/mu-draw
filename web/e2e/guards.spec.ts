// The fixture's guards must be live: each test here breaks one rule on purpose and checks
// that the guard reports it.
import { expect, nameResponse, openEditor, test, waitForServiceWorker, type App } from './fixtures.ts';

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

/** Add an element with one attribute to the page's body. */
async function plant(app: App, tag: string, attribute: string, value: string): Promise<void> {
  await app.page.evaluate(
    ([t, a, v]) => {
      const element = document.createElement(t);
      element.setAttribute(a, v);
      document.body.append(element);
    },
    [tag, attribute, value],
  );
}

test('the link guard is live: a link out of the app is reported', async ({ app }) => {
  await openEditor(app);
  await plant(app, 'a', 'href', 'https://example.com/elsewhere');
  await expect.poll(() => app.problems).toEqual(['link (other origin) A[href]: https://example.com/elsewhere']);
  app.problems.length = 0;
});

test('the link guard sees changed links and form actions', async ({ app }) => {
  await openEditor(app);
  await plant(app, 'form', 'action', '/elsewhere');
  await plant(app, 'a', 'href', '#inside');
  // A separate step, so the observer has already seen the link as it was added.
  await app.page.evaluate(() => document.body.lastElementChild!.setAttribute('href', 'https://example.com/changed'));
  const origin = new URL(app.server.url).origin;
  const base = new URL(app.server.url).pathname;
  await expect
    .poll(() => app.problems)
    .toEqual([
      `link (outside ${base}) FORM[action]: ${origin}/elsewhere`,
      'link (other origin) A[href]: https://example.com/changed',
    ]);
  app.problems.length = 0;
});

test('the link guard lets exactly a PubChem compound page through', async ({ app }) => {
  await openEditor(app);
  const page = nameResponse('aspirin').url!;
  // Reports reach the test in the order the page makes them, so if the allowed link were
  // reported, its problem would come before the control's.
  await plant(app, 'a', 'href', page);
  await plant(app, 'a', 'href', `${page}/`);
  await expect.poll(() => app.problems).toEqual([`link (other origin) A[href]: ${page}/`]);
  app.problems.length = 0;
});
