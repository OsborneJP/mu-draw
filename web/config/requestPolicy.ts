// Invariant 1: the browser requests nothing but the app's own files and its API, all
// under the app's origin and base path. The smoke tests apply this to every request.
// The only way out is a link the student clicks, and the only such links are a compound's
// PubChem page (Get name, Safety); the smoke tests apply linkProblem() to every link in every
// page.

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

// Exactly https://pubchem.ncbi.nlm.nih.gov/compound/<CID>: no port, user, query or fragment.
const PUBCHEM_COMPOUND = /^https:\/\/pubchem\.ncbi\.nlm\.nih\.gov\/compound\/[1-9][0-9]*$/;

/** Why a link (href, form action) breaks the policy, or null if it is allowed: it stays in
 * the app, or it leads to a PubChem compound page. Judged by where it leads, as resolved by
 * the browser (so a host's case or a default port changes nothing). */
export function linkProblem(url: string, appUrl: string): string | null {
  const problem = requestProblem(url, appUrl);
  return problem === null || PUBCHEM_COMPOUND.test(new URL(url).href) ? null : problem;
}
