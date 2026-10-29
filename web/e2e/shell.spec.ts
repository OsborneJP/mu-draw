// The app's own frame around the editor: header, offline badge, About box.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { recordedSource } from '../config/indigoSource.ts';
import { resolveBase } from '../config/app.ts';
import { appTitle } from '../config/pwa.ts';
import pkg from '../package.json' with { type: 'json' };
import { FREETYPE_CREDIT, INCHI_CREDIT, SOURCE_CREDIT } from '../src/shell/credits.ts';
import { INDIGO_SOURCE_FILE, NOTICES_FILE } from '../src/shell/thirdParty.ts';
import { expect, goOffline, openEditor, test } from './fixtures.ts';

test('the header names the app, and its offline badge follows the connection', async ({ app }) => {
  const { context, page } = app;
  await openEditor(app);
  // The header has rendered (so the badge's absence below means something).
  await expect(page.getByRole('banner').getByTestId('app-title')).toHaveText(appTitle(resolveBase()));
  const badge = page.getByTestId('offline-badge');
  await expect(badge).toHaveCount(0);

  await context.setOffline(true);
  await expect(badge).toHaveText('Offline');
  await context.setOffline(false);
  await expect(badge).toHaveCount(0);
});

test('About shows the version from package.json and who made it, and links nowhere', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const about = page.getByRole('dialog', { name: appTitle(resolveBase()) });
  await expect(about).toBeHidden();

  await page.getByTestId('app-about-button').click();
  // Focus starts on the title, at the top: not on Save (which would start a download), and
  // not on Close, which would scroll a dialog taller than the window to its end.
  await expect(about.getByRole('heading')).toBeFocused();
  expect(await about.evaluate((dialog) => dialog.scrollTop)).toBe(0);
  await expect(about.getByTestId('app-version')).toHaveText(`Version ${pkg.version}`);
  await expect(about.getByTestId('app-authors')).toHaveText('Made by Jeff Osborne with Claude Code.');
  // The credits the InChI and FreeType licences ask for, and where the source is
  // (docs/plans/licence-notices.md, bar C.1).
  await expect(about.getByTestId('about-inchi-credit')).toHaveText(INCHI_CREDIT);
  await expect(about.getByTestId('about-freetype-credit')).toHaveText(FREETYPE_CREDIT);
  await expect(about.getByTestId('about-source')).toContainText(SOURCE_CREDIT);
  await expect(about.getByRole('button', { name: 'Save InChI and cairo source' })).toBeVisible();
  await expect(about.getByRole('button', { name: 'Third-party licences' })).toBeVisible();
  // No links: nothing in it can take the student, or a request, anywhere.
  await expect(about.locator('a, [href], [src], form, iframe')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();

  await page.getByTestId('app-about-button').click();
  await expect(about).toBeVisible();
  await about.getByRole('button', { name: 'Close' }).click();
  await expect(about).toBeHidden();
});

test('offline, About shows the third-party licences and saves the InChI and cairo source, both from the precache', async ({
  app,
}) => {
  const { page } = app;
  await goOffline(app);
  await page.getByTestId('app-about-button').click();
  // A failure shows as an alert, or trips the fixture's guards: either fails the test at once.
  const alerted = page
    .getByRole('alert')
    .waitFor()
    .then(async () => Promise.reject(new Error(`About says: ${await page.getByRole('alert').textContent()}`)));
  const guarded = <T>(step: Promise<T>) => Promise.race([step, app.failed, alerted]);

  // bar C.2: the notices, as the service worker serves them.
  const notices = page.waitForResponse((r) => r.url().endsWith(NOTICES_FILE));
  await page.getByTestId('about-licences-button').click();
  expect((await guarded(notices)).fromServiceWorker()).toBe(true);
  const panel = page.getByRole('region', { name: 'Third-party licences' });
  for (const line of [
    'Copyright (C) IUPAC and InChI Trust',
    '("IUPAC/InChI-Trust InChI Licence No. 1.0")',
    'Portions of this software are copyright © 2022 The FreeType Project',
    'Portions of this software are copyright © 2024 The FreeType Project',
    'This product includes software developed at EPAM Systems, Inc.',
    'cairo is distributed here under the Mozilla Public License 1.1 only.',
  ]) {
    await guarded(expect(panel).toContainText(line));
  }
  await page.getByTestId('about-licences-button').click();
  await expect(panel).toHaveCount(0);

  // bar C.3: the source archive, saved from the precache, is the one the record reviewed.
  const fetched = page.waitForResponse((r) => r.url().endsWith(INDIGO_SOURCE_FILE));
  const [download] = await guarded(
    Promise.all([page.waitForEvent('download'), page.getByTestId('about-save-source').click()]),
  );
  expect((await guarded(fetched)).fromServiceWorker()).toBe(true);
  expect(download.suggestedFilename()).toBe(INDIGO_SOURCE_FILE.split('/').pop());
  const saved = readFileSync(await guarded(download.path()));
  expect(createHash('sha256').update(saved).digest('hex')).toBe(recordedSource().sha256);
});
