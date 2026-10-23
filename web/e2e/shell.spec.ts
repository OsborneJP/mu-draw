// The app's own frame around the editor: header, offline badge, About box.
import { resolveBase } from '../config/app.ts';
import { appTitle } from '../config/pwa.ts';
import pkg from '../package.json' with { type: 'json' };
import { expect, openEditor, test } from './fixtures.ts';

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

test('About shows the version from package.json and links nowhere', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const about = page.getByRole('dialog', { name: appTitle(resolveBase()) });
  await expect(about).toBeHidden();

  await page.getByTestId('app-about-button').click();
  await expect(about.getByTestId('app-version')).toHaveText(`Version ${pkg.version}`);
  // Plain text only: nothing in it can take the student, or a request, anywhere.
  await expect(about.locator('a, [href], [src], form, iframe')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();

  await page.getByTestId('app-about-button').click();
  await expect(about).toBeVisible();
  await about.getByRole('button', { name: 'Close' }).click();
  await expect(about).toBeHidden();
});
