// Post-build checks on the web app manifest and the generated service worker.

interface Icon {
  src?: string;
  sizes?: string;
  type?: string;
}

/** The built manifest's scope, start_url and id all equal the base; it is installable. */
export function checkManifest(manifest: Record<string, unknown>, base: string, title: string): string[] {
  const errors: string[] = [];
  for (const key of ['scope', 'start_url', 'id']) {
    if (manifest[key] !== base) errors.push(`${key} is ${JSON.stringify(manifest[key])}, not "${base}"`);
  }
  if (manifest.display !== 'standalone') errors.push(`display is ${JSON.stringify(manifest.display)}`);
  for (const key of ['name', 'short_name']) {
    if (manifest[key] !== title) errors.push(`${key} is ${JSON.stringify(manifest[key])}, not "${title}"`);
  }
  const icons = Array.isArray(manifest.icons) ? (manifest.icons as Icon[]) : [];
  for (const size of ['192x192', '512x512']) {
    if (!icons.some((icon) => icon.sizes === size && icon.type === 'image/png')) {
      errors.push(`no ${size} PNG icon`);
    }
  }
  return errors;
}

/** Prompt mode: the worker activates only when the page posts SKIP_WAITING (after the
 * student clicks the update banner), and never claims open pages by itself. */
export function checkPromptMode(swSource: string): string[] {
  const errors: string[] = [];
  if (swSource.includes('clientsClaim')) errors.push('calls clientsClaim (would take over open pages)');
  const skips = swSource.split('skipWaiting(').length - 1;
  if (skips !== 1) errors.push(`expected skipWaiting( exactly once (in the message handler), found ${skips}`);
  if (!swSource.includes('SKIP_WAITING')) errors.push('has no SKIP_WAITING message handler');
  return errors;
}
