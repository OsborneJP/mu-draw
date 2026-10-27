// The offer to install the app (src/pwa/installOffer.ts; docs/plans/v2-install-prompt.md). The
// browser's offer is Chrome's beforeinstallprompt event. These tests send their own, whose
// prompt() they watch; the fixture keeps Chrome's real offers away from every other test
// (browserInstallOffers), and the last tests here let the real one through, or prove it is
// kept away.
import type { Page } from '@playwright/test';
import { expect, openEditor, test, waitForEditor, type App } from './fixtures.ts';

/** Sends the page an offer like Chrome's. Its prompt() calls are recorded with whether the
 * page then had the click's user activation, which Chrome requires. Returns whether the app
 * took the offer (preventDefault). */
function offer(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const w = window as unknown as { __prompts: boolean[] };
    w.__prompts ??= [];
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        w.__prompts.push(navigator.userActivation.isActive);
        return Promise.resolve();
      },
    });
    dispatchEvent(event);
    return event.defaultPrevented;
  });
}

/** Each prompt() call so far: whether the click's user activation was there. */
function prompts(page: Page): Promise<boolean[]> {
  return page.evaluate(() => (window as unknown as { __prompts?: boolean[] }).__prompts ?? []);
}

const strip = (page: Page) => page.getByTestId('install-strip');
const aboutInstall = (page: Page) => page.getByTestId('about-install-button');

async function openAbout(page: Page): Promise<void> {
  await page.getByTestId('app-about-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test("an offer shows the strip with the app's name; Install opens the browser's dialog once, in the click, and the strip goes", async ({
  app,
}) => {
  const { page } = app;
  await openEditor(app);
  await expect(strip(page)).toHaveCount(0);
  expect(await offer(page)).toBe(true);
  const title = await page.title();
  await expect(strip(page)).toContainText(`Install ${title} as an app: it opens in its own window, like your other apps`);
  await page.getByTestId('install-button').click();
  await expect(strip(page)).toHaveCount(0);
  expect(await prompts(page)).toEqual([true]);
  // Used up: About has no Install to press a second time.
  await openAbout(page);
  await expect(aboutInstall(page)).toHaveCount(0);
});

test("a cancelled dialog: Chrome's next offer goes to About, and the strip stays away until the next visit", async ({
  app,
}) => {
  const { page } = app;
  await openEditor(app);
  await offer(page);
  await page.getByTestId('install-button').click();
  await expect(strip(page)).toHaveCount(0);
  expect(await offer(page)).toBe(true); // Chrome offers again as soon as the dialog is cancelled
  await openAbout(page);
  await expect(aboutInstall(page)).toBeVisible();
  await expect(strip(page)).toHaveCount(0);

  await page.reload();
  await waitForEditor(app);
  await offer(page);
  await expect(strip(page)).toBeVisible();
});

test('Not now hides the strip for good in this browser, in every tab; About still offers Install', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const other = await app.newPage();
  await other.goto(app.server.url);
  await waitForEditor(app, other);
  await offer(page);
  await offer(other);
  await expect(strip(other)).toBeVisible();
  await page.getByTestId('install-not-now-button').click();
  await expect(strip(page)).toHaveCount(0);
  await expect(strip(other)).toHaveCount(0);

  await page.reload();
  await waitForEditor(app);
  expect(await offer(page)).toBe(true);
  await openAbout(page);
  await expect(aboutInstall(page)).toBeVisible();
  await expect(strip(page)).toHaveCount(0);
  await aboutInstall(page).click();
  expect(await prompts(page)).toEqual([true]);
  await expect(aboutInstall(page)).toHaveCount(0);
  // The keyboard stays in the dialog.
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Close' })).toBeFocused();
});

test('an offer that comes before the app is drawn is kept', async ({ app }) => {
  const { page } = app;
  // Sent the moment the app starts listening (main.tsx's imports), before anything is drawn.
  await page.addInitScript(() => {
    const w = window as unknown as { __drawnAtOffer: number };
    const add = window.addEventListener.bind(window) as (...args: unknown[]) => void;
    window.addEventListener = ((...args: unknown[]) => {
      add(...args);
      if (args[0] !== 'beforeinstallprompt' || w.__drawnAtOffer !== undefined) return;
      w.__drawnAtOffer = document.getElementById('root')?.childElementCount ?? -1;
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, { prompt: () => Promise.resolve() });
      dispatchEvent(event);
    }) as typeof window.addEventListener;
  });
  await openEditor(app);
  expect(await page.evaluate(() => (window as unknown as { __drawnAtOffer: number }).__drawnAtOffer)).toBe(0);
  await expect(strip(page)).toBeVisible();
});

test('once the app is installed, the strip goes', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await offer(page);
  await expect(strip(page)).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event('appinstalled')));
  await expect(strip(page)).toHaveCount(0);
});

test('running as the installed app, an offer is not taken and nothing shows', async ({ app }) => {
  const { page } = app;
  // A browser tab matches display-mode browser; the installed app's window doesn't.
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query === '(display-mode: browser)' ? ({ ...matchMedia(query), matches: false } as MediaQueryList) : matchMedia(query);
  });
  await openEditor(app);
  expect(await offer(page)).toBe(false);
  await openAbout(page);
  await expect(aboutInstall(page)).toHaveCount(0);
  await expect(strip(page)).toHaveCount(0);
});

/** Waits for the fixture to stop Chrome's first offer, failing at once if a guard trips. */
function browserOfferStopped(app: App): Promise<true> {
  return Promise.race([
    app.page.evaluate(() => (window as unknown as { __browserOfferStopped: Promise<true> }).__browserOfferStopped),
    app.failed,
  ]);
}

test.describe("Chrome's own offer, kept away as in every other test", () => {
  // Chrome may wait for some use of the site before it offers; its own switch turns that off.
  test.use({ browserArgs: ['--bypass-app-banner-engagement-checks'] });

  test('arrives, and shows no strip (the fixture stops it)', async ({ app }) => {
    const { page } = app;
    await openEditor(app);
    expect(await browserOfferStopped(app)).toBe(true);
    await expect(strip(page)).toHaveCount(0);
    await openAbout(page);
    await expect(aboutInstall(page)).toHaveCount(0);
  });
});

test.describe("Chrome's own offer", () => {
  test.use({ browserArgs: ['--bypass-app-banner-engagement-checks'], browserInstallOffers: true });

  test("reaches the app in the test browser, and Install calls Chrome's own prompt() once, in the click", async ({
    app,
  }) => {
    const { page } = app;
    // Watch Chrome's own prompt(): called how often, and with the click's user activation.
    await page.addInitScript(() => {
      const w = window as unknown as { __prompts: boolean[] };
      w.__prompts = [];
      const proto = (window as unknown as { BeforeInstallPromptEvent: { prototype: { prompt(): Promise<unknown> } } })
        .BeforeInstallPromptEvent.prototype;
      const prompt = proto.prompt;
      proto.prompt = function (this: unknown) {
        w.__prompts.push(navigator.userActivation.isActive);
        return prompt.call(this);
      };
    });
    await openEditor(app);
    await expect(strip(page)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('install-button').click();
    await expect(strip(page)).toHaveCount(0);
    expect(await prompts(page)).toEqual([true]);
  });
});
