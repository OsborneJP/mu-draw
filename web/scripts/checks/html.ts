// Static checks on the built index.html. Every URL it references must stay under the app's
// base and exist in the build, and it must declare an icon: without <link rel="icon">,
// Chrome asks the site root for /favicon.ico (outside the base), and Playwright never
// reports favicon requests, so the smoke tests can't see that.
import { requestProblem } from '../../config/requestPolicy.ts';

const APP_ORIGIN = 'https://app.invalid';

// Double-quoted, single-quoted or unquoted, as HTML allows.
function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

export function checkHtmlLinks(html: string, base: string, files: string[]): string[] {
  const errors: string[] = [];
  const appUrl = `${APP_ORIGIN}${base}`;
  const present = new Set(files);
  const tags = html.match(/<(link|script|img)\b[^>]*>/gi) ?? [];
  let icons = 0;
  for (const tag of tags) {
    const rel = attribute(tag, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    if (rel.includes('icon')) icons += 1;
    for (const name of ['href', 'src']) {
      const value = attribute(tag, name);
      if (value === undefined) continue;
      const url = new URL(value, appUrl);
      const problem = requestProblem(url.href, appUrl);
      if (problem) {
        errors.push(`${name}="${value}" (${problem})`);
        continue;
      }
      const path = decodeURIComponent(url.pathname.slice(base.length));
      if (!present.has(path)) errors.push(`${name}="${value}" names a file that isn't in the build`);
    }
  }
  if (icons === 0) errors.push('no <link rel="icon">, so browsers request /favicon.ico at the site root');
  return errors;
}

/** The built page's <title> is the target's app name (the installed window shows it). */
export function checkTitle(html: string, title: string): string[] {
  const titles = [...html.matchAll(/<title>([^<]*)<\/title>/gi)].map((m) => m[1].replaceAll('&amp;', '&'));
  if (titles.length !== 1) return [`expected one <title>, found ${titles.length}`];
  return titles[0] === title ? [] : [`<title> is "${titles[0]}", not "${title}"`];
}
