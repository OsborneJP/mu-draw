// The update banner (src/pwa/register.ts, src/shell/UpdateBanner.tsx): a new build waits
// until the student clicks Reload. The fixture's guards fail any test in which the page
// reloads itself, or a waiting build is told to take over, without that click.
import type { Page } from '@playwright/test';
import {
  BUILD_MARKER,
  expect,
  fixture,
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

  test('a new build shows the banner, and nothing changes until the student clicks Reload', async ({ app }) => {
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
    await checkForUpdate(page);
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
