// The GHS pictograms (web/public/ghs/) are third-party SVGs shipped as the app's own files. An
// SVG can carry scripts and references to other sites. The panel shows them with <img>, where
// neither runs, but a student can open the file itself, and invariant 1 allows no reference
// out of the app. This check fails the build on any of them.

/** Problems with an SVG file, or [] if it is only shapes, styles and references inside it. */
export function checkSvg(source: string): string[] {
  const errors: string[] = [];
  const body = source.replace(/<!--[\s\S]*?-->/g, '');
  if (!/^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/.test(body)) errors.push('not an SVG document');
  if (/<script/i.test(body)) errors.push('has a script');
  if (/\son[a-z]+\s*=/i.test(body)) errors.push('has an event handler');
  if (/<!(DOCTYPE|ENTITY)/i.test(body)) errors.push('has a DOCTYPE or an entity');
  if (/<(foreignObject|iframe|embed|object|image|a)[\s>/]/i.test(body)) errors.push('embeds or links to other content');
  if (/@import/i.test(body)) errors.push('imports a stylesheet');
  for (const [, value] of body.matchAll(/(?:^|[\s:])href\s*=\s*["']([^"']*)["']/gi)) {
    if (!value.startsWith('#')) errors.push(`refers outside itself: ${value}`);
  }
  for (const [, value] of body.matchAll(/url\(\s*["']?([^"')]*)/gi)) {
    if (!value.startsWith('#')) errors.push(`refers outside itself: ${value}`);
  }
  return errors;
}
