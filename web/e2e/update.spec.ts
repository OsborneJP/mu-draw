// The update banner (src/pwa/register.ts, src/shell/UpdateBanner.tsx): a new build waits
// until the student clicks Reload. The fixture's guards fail any test in which the page
// reloads itself, or a waiting build is told to take over, without that click.
import type { Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILD_MARKER,
  expect,
  fixture,
  goOffline,
  inchiKey,
  nextAutosave,
  openEditor,
  publishSecondBuild,
  referenceCompound,
  test,
  waitForEditor,
  waitForServiceWorker,
  type App,
} from './fixtures.ts';

/** The state of the build waiting to take over, or null if none is. */
async function waitingBuild(page: Page): Promise<string | null> {
  return page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null);
}

/** The browser checks for a new sw.js by itself whenever the app is launched; tests ask
 * for that check explicitly, so it happens at a known point. */
async function checkForUpdate(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
}

/** The student comes back to the open app, from another tab or window, a minimised window or
 * a closed lid, and the app checks for a new build. The test dispatches the event; the page's
 * visibility stays 'visible', which is what the app reads. Resolves once the check, and any
 * install it started, has settled. */
async function returnToApp(app: App): Promise<void> {
  const checked = app.page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        addEventListener('sw-update-checked', () => resolve(), { once: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }),
  );
  await Promise.race([checked, app.failed]);
}

/** Open the app as on any launch after the first: the service worker is installed and
 * serves the page. */
async function launchInstalled(app: App): Promise<void> {
  await openEditor(app);
  await waitForServiceWorker(app);
  await app.page.reload();
  await waitForEditor(app);
  expect(await app.page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

/** Click the banner's Reload and wait until the page has reloaded and the editor is back. */
async function clickReload(app: App, page: Page): Promise<void> {
  const loaded = page.waitForEvent('load');
  await page.getByTestId('update-reload-button').click();
  await loaded;
  await waitForEditor(app, page);
}

test.describe('update banner', () => {
  test.skip(
    Boolean(process.env.SMOKE_URL),
    "needs a server the test owns: Playwright can't intercept the browser's update check " +
      'for sw.js, so only a local copy of the build can become a second build',
  );
  test.use({ buildCopy: true });

  for (const [found, check] of [
    ['at launch', (app: App) => checkForUpdate(app.page)],
    ['when the student comes back to the open app', returnToApp],
  ] as const) {
    test(`a new build found ${found} shows the banner, and nothing changes until the student clicks Reload`, async ({
      app,
    }) => {
      const { page } = app;
      const butanol = referenceCompound('(R)-2-butanol');
      const secondBuild = page.locator(`meta[name="${BUILD_MARKER}"]`);
      await launchInstalled(app);
      // A drawing in progress.
      const saved = await nextAutosave(page);
      await page.evaluate((mol) => window.ketcher!.setMolecule(mol), fixture(butanol.files.find((f) => f.endsWith('.mol'))!));
      await saved();
      await expect(page.getByTestId('update-banner')).toHaveCount(0);

      publishSecondBuild(app.server);
      await check(app);
      await expect(page.getByTestId('update-message')).toHaveText('An update is ready. Reload to use it.');
      // Nothing has changed: the new build waits, this is still the old build's page, and
      // the drawing is as it was.
      expect(await waitingBuild(page)).toBe('installed');
      await expect(secondBuild).toHaveCount(0);
      expect(await inchiKey(page)).toBe(butanol.inchikey);

      // The click: the new build takes over, the page reloads into it, the drawing comes back.
      await clickReload(app, page);
      await expect(secondBuild).toHaveCount(1);
      expect(await waitingBuild(page)).toBe(null);
      await expect(page.getByTestId('update-banner')).toHaveCount(0);
      expect(await inchiKey(page)).toBe(butanol.inchikey);
    });
  }

  test('after two new builds fail to install, the next good one still shows the banner', async ({ app }) => {
    // workbox-window, which tells the plugin about new builds, stops listening after the
    // second one it sees (or the first, more than a minute after the page opened). The app's
    // own check must still find the good build. A build that fails to install is one whose
    // download was cut off; here its sw.js rejects its own install, so the server answers
    // every request (no HTTP error for the guards) and it precaches nothing new.
    const { page } = app;
    await launchInstalled(app);
    const sw = join(app.server.copy!, 'sw.js');
    const original = readFileSync(sw, 'utf8');
    for (const attempt of [1, 2]) {
      writeFileSync(
        sw,
        `self.addEventListener('install',(e)=>e.waitUntil(Promise.reject(new Error('test build ${attempt}: install fails'))));\n${original}`,
      );
      await returnToApp(app);
      expect(await waitingBuild(page)).toBe(null);
      await expect(page.getByTestId('update-banner')).toHaveCount(0);
    }

    writeFileSync(sw, original);
    publishSecondBuild(app.server);
    await returnToApp(app);
    await expect(page.getByTestId('update-message')).toHaveText('An update is ready. Reload to use it.');
    expect(await waitingBuild(page)).toBe('installed');
  });

  test('offline, coming back to the app shows nothing and breaks nothing', async ({ app }) => {
    // The check can't reach the server; the guards fail the test on an uncaught rejection.
    await goOffline(app);
    await returnToApp(app);
    await expect(app.page.getByTestId('update-banner')).toHaveCount(0);
  });

  test("with two tabs open, Reload in one never reloads the other", async ({ app }) => {
    const { page: first } = app;
    const secondBuild = (page: Page) => page.locator(`meta[name="${BUILD_MARKER}"]`);
    await launchInstalled(app);
    const second = await app.newPage();
    await second.goto(app.server.url);
    await waitForEditor(app, second);

    publishSecondBuild(app.server);
    await checkForUpdate(first);
    await expect(first.getByTestId('update-banner')).toBeVisible();
    await expect(second.getByTestId('update-banner')).toBeVisible();

    // The first tab's click makes the new build active for both tabs.
    await second.evaluate(() => {
      Object.assign(window, {
        __takenOver: new Promise<true>((resolve) =>
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true }),
        ),
      });
    });
    await clickReload(app, first);
    await expect(secondBuild(first)).toHaveCount(1);
    await second.evaluate(() => (window as unknown as { __takenOver: Promise<true> }).__takenOver);
    // The second tab has not reloaded, and still offers to.
    await expect(secondBuild(second)).toHaveCount(0);
    await expect(second.getByTestId('update-banner')).toBeVisible();

    // Its own click reloads it into the new build, though nothing is waiting any more.
    expect(await waitingBuild(second)).toBe(null);
    await clickReload(app, second);
    await expect(secondBuild(second)).toHaveCount(1);
    await expect(second.getByTestId('update-banner')).toHaveCount(0);
  });
});
