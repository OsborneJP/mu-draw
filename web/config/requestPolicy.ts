// Invariant 1: the browser requests nothing but the app's own files and its API, all
// under the app's origin and base path. The smoke tests apply this to every request.

/** Why a request breaks the policy, or null if it is allowed. */
export function requestProblem(url: string, appUrl: string): string | null {
  const target = new URL(url);
  const app = new URL(appUrl);
  if (target.protocol === 'blob:') return target.origin === app.origin ? null : 'foreign blob';
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return `scheme ${target.protocol}`;
  if (target.origin !== app.origin) return 'other origin';
  if (!target.pathname.startsWith(app.pathname)) return `outside ${app.pathname}`;
  return null;
}
