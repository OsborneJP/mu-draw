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

/** Add an SVG <image> drawn from `source` (as href, or as xlink:href) to the page's body. */
async function plantImage(app: App, source: string, xlink = false): Promise<void> {
  await app.page.evaluate(
    ([src, useXlink]) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      if (useXlink) image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', src as string);
      else image.setAttribute('href', src as string);
      svg.append(image);
      document.body.append(svg);
    },
    [source, xlink] as const,
  );
}

const PNG_DATA = 'data:image/png;base64,iVBORw0KGgo=';
const SVG_DATA = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';

test('the image guard lets a base64 PNG or SVG through, and reports any other image source', async ({ app }) => {
  await openEditor(app);
  // Allowed ones first: reports arrive in the page's order, so a wrongly reported one would
  // come before the controls'.
  await plantImage(app, PNG_DATA);
  await plantImage(app, SVG_DATA, true);
  // Controls that load nothing (an image from another host would also trip the request and
  // CSP guards): a data: URL of another type, and an SVG that isn't base64.
  await plantImage(app, 'data:text/html;base64,PGgxPmhpPC9oMT4=');
  await plantImage(app, 'data:image/svg+xml,%3Csvg%2F%3E', true);
  await expect
    .poll(() => app.problems)
    .toEqual([
      'image source (scheme data:) image[href]: data:text/html;base64,PGgxPmhpPC9oMT4=',
      'image source (scheme data:) image[xlink:href]: data:image/svg+xml,%3Csvg%2F%3E',
    ]);
  app.problems.length = 0;
});

test('a link to an image data URL is still a link, and is reported', async ({ app }) => {
  await openEditor(app);
  await plant(app, 'a', 'href', PNG_DATA);
  await expect.poll(() => app.problems).toEqual([`link (scheme data:) A[href]: ${PNG_DATA}`]);
  app.problems.length = 0;
});
