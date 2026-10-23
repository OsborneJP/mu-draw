// The app's own frame around the editor: header, offline badge.
import { resolveBase } from '../config/app.ts';
import { appTitle } from '../config/pwa.ts';
import { expect, openEditor, test } from './fixtures.ts';

test('the header names the app, and its offline badge follows the connection', async ({ app }) => {
  const { context, page } = app;
  await openEditor(app);
  // The header has rendered (so the badge's absence below means something).
  await expect(page.getByRole('banner')).toHaveText(appTitle(resolveBase()));
  const badge = page.getByTestId('offline-badge');
  await expect(badge).toHaveCount(0);

  await context.setOffline(true);
  await expect(badge).toHaveText('Offline');
  await context.setOffline(false);
  await expect(badge).toHaveCount(0);
});
