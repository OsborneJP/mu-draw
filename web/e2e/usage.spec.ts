// Anonymous weekly usage counts in the browser (src/usage/; docs/plans/v2-usage-counts.md, bar
// A). The fixture answers api/count in every test and checks each body is exactly a weekly
// summary; these tests set the device's date with Playwright's clock and wait on the app's
// own announcement of each decision (data-usage="<n> <outcome>"), never on time.
import type { Page } from '@playwright/test';
import { resolveBase } from '../config/app.ts';
import { expect, goOffline, openEditor, test, waitForEditor, type App } from './fixtures.ts';

// Wednesdays at noon, by the device's calendar, of 2026-W43, W44 and W45.
const W43 = new Date(2026, 9, 21, 12);
const W44 = new Date(2026, 9, 28, 12);
const KEY = `usage:${resolveBase()}`;

/** The app's decision for the n-th time it counted on this page. */
function decided(page: Page, n: number, outcome: string) {
  return expect(page.locator('html')).toHaveAttribute('data-usage', `${n} ${outcome}`);
}

function kept(page: Page): Promise<unknown> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), KEY);
}

/** Opens the app on `date`, a new page load at that date. */
async function openOn(app: App, date: Date): Promise<void> {
  await app.page.clock.setSystemTime(date);
  await app.page.reload();
  await waitForEditor(app);
}

async function startOn(app: App, date: Date): Promise<void> {
  await app.page.clock.install({ time: date });
  await openEditor(app);
}

const lastWeek = { week: '2026-W43', days: 1, installed: false, first: true, tools: [] };

test("a new browser's first week sends nothing; the next week's first opening sends last week's summary once", async ({
  app,
}) => {
  const { page } = app;
  await startOn(app, W43);
  await decided(page, 1, 'nothing');
  expect(await kept(page)).toEqual({ week: '2026-W43', days: 1, lastDay: '2026-10-21', installed: false, first: true, tools: [], pending: [] });
  // A cookie another app on this host set for the whole site: it must not ride along.
  await app.context.addCookies([{ name: 'other-app', value: 'x', url: app.server.url.replace(/\/[^/]*\/?$/, '/') }]);

  await openOn(app, W44);
  await decided(page, 1, 'sent');
  expect(app.counts).toEqual([{ weeks: [lastWeek] }]);
  await openOn(app, new Date(2026, 9, 29, 9));
  await decided(page, 1, 'nothing');
  expect(app.counts).toHaveLength(1);
});

test('a tool used many times is one tool in its week, and using tools sends nothing', async ({ app }) => {
  const { page } = app;
  await startOn(app, W43);
  await page.getByTestId('app-export-button').click();
  const dialog = page.getByRole('dialog', { name: 'Export image' });
  for (let i = 0; i < 3; i++) await dialog.getByRole('button', { name: 'Download SVG' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect.poll(async () => ((await kept(page)) as { tools: string[] }).tools).toEqual(['export']);
  expect(app.counts).toEqual([]);

  await openOn(app, W44);
  await decided(page, 1, 'sent');
  expect(app.counts).toEqual([{ weeks: [{ ...lastWeek, tools: ['export'] }] }]);
});

test('offline at the new week the summary is kept, and it goes when the device is back online', async ({ app }) => {
  const { page } = app;
  await app.page.clock.install({ time: W43 });
  await goOffline(app);
  await openOn(app, W44);
  await decided(page, 1, 'kept');
  expect(app.counts).toEqual([]);
  await app.context.setOffline(false);
  await decided(page, 2, 'sent');
  expect(app.counts).toEqual([{ weeks: [lastWeek] }]);
});

test('a summary the server fails on is kept and sent next time; one it refuses is dropped', async ({ app }) => {
  const { page } = app;
  await startOn(app, W43);
  app.countAnswers.push(500);
  await openOn(app, W44);
  await decided(page, 1, 'kept');
  await openOn(app, new Date(2026, 9, 29, 9));
  await decided(page, 1, 'sent');
  expect(app.counts).toEqual([{ weeks: [lastWeek] }, { weeks: [{ ...lastWeek }] }]);

  app.countAnswers.push(400);
  await openOn(app, new Date(2026, 10, 4, 12)); // W45: W44's summary is refused
  await decided(page, 1, 'dropped');
  await openOn(app, new Date(2026, 10, 5, 12));
  await decided(page, 1, 'nothing');
  expect(app.counts).toHaveLength(3);
});

test('two tabs: while one tab sends the week, the other waits its turn and sends nothing; the week goes once', async ({
  app,
}) => {
  const { page } = app;
  await startOn(app, W43);
  const other = await app.newPage();
  await other.clock.install({ time: W43 });
  await other.goto(app.server.url);
  await waitForEditor(app, other);
  await decided(other, 1, 'nothing');
  // Monday comes while both are open. Time stands still from here, so no deadline can fire.
  for (const tab of [page, other]) await tab.clock.pauseAt(W44);
  let release: (status: number) => void = () => {};
  app.countAnswers.push(new Promise<number>((resolve) => (release = resolve)));
  await page.evaluate(() => dispatchEvent(new Event('online'))); // tab 1 sends; its answer is held
  await expect.poll(() => app.counts.length).toBe(1);
  await other.evaluate(() => dispatchEvent(new Event('online'))); // tab 2 waits its turn
  release(204);
  await decided(page, 2, 'sent');
  await decided(other, 2, 'nothing');
  expect(app.counts).toEqual([{ weeks: [lastWeek] }]);
});

test("a server that never answers can't hold the week: after the deadline it is kept for next time", async ({ app }) => {
  const { page } = app;
  await startOn(app, W43);
  let release: (answer: 'abort') => void = () => {};
  app.countAnswers.push(new Promise<'abort'>((resolve) => (release = resolve)));
  await page.clock.setSystemTime(W44);
  await page.reload();
  await expect.poll(() => app.counts.length).toBe(1);
  await page.clock.runFor(8_000); // the naming deadline (src/api.ts)
  await decided(page, 1, 'kept');
  release('abort');
});

test('Global Privacy Control: nothing is recorded or sent, and About says why counting is off', async ({ app }) => {
  const { page } = app;
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
  await startOn(app, W43);
  await decided(page, 1, 'off');
  expect(await kept(page)).toBeNull();
  await openOn(app, W44);
  await decided(page, 1, 'off');
  expect(app.counts).toEqual([]);
  await page.getByTestId('app-about-button').click();
  await expect(page.getByTestId('about-usage-switch')).not.toBeChecked();
  await expect(page.getByTestId('about-usage-switch')).toBeDisabled();
  await expect(page.getByTestId('about-usage-gpc')).toBeVisible();
});

test("About says what is counted; its switch off forgets the week and stops counting", async ({ app }) => {
  const { page } = app;
  await startOn(app, W43);
  await page.getByTestId('app-about-button').click();
  await expect(page.getByTestId('about-usage-note')).toContainText(
    'This app counts, each week, how many browsers open it and which tools are used. The counts are kept without names, IDs or IP addresses.',
  );
  const toggle = page.getByTestId('about-usage-switch');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect.poll(() => kept(page)).toEqual({ off: true });

  await openOn(app, W44);
  await decided(page, 1, 'off');
  expect(app.counts).toEqual([]);
  await page.getByTestId('app-about-button').click();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect.poll(() => kept(page)).toBeNull();
  // Turned off in another tab: About shows it the next time it opens.
  await page.keyboard.press('Escape');
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ off: true })), KEY);
  await page.getByTestId('app-about-button').click();
  await expect(toggle).not.toBeChecked();
});

test('the count guard is live: a body that is not a weekly summary, a referrer or a cookie is reported', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const summary = JSON.stringify({ weeks: [lastWeek] });
  type Init = { credentials?: RequestCredentials; referrerPolicy?: ReferrerPolicy };
  const send = (body: string, init: Init) =>
    page.evaluate(({ url, body, init }) => fetch(`${url}api/count`, { method: 'POST', body, ...init }), { url: app.server.url, body, init });
  const quiet: Init = { credentials: 'omit', referrerPolicy: 'no-referrer' };
  await send(summary, quiet);
  expect(app.problems).toEqual([]);
  await send('{"weeks":[],"id":"x"}', quiet);
  await send(JSON.stringify({ weeks: [{ ...lastWeek, tools: ['practice'] }] }), quiet);
  await send(summary, { credentials: 'omit' });
  await app.context.addCookies([{ name: 'other-app', value: 'x', url: app.server.url }]);
  await send(summary, { credentials: 'include', referrerPolicy: 'no-referrer' });
  expect(app.problems).toEqual([
    'count: keys other than weeks',
    'count: tools not counted: practice',
    'count: a referrer',
    'count: a cookie',
  ]);
  app.problems.length = 0;
});
