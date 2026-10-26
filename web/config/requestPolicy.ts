// Invariant 1: the browser requests nothing but the app's own files and its API, all
// under the app's origin and base path. The smoke tests apply this to every request.
// The only way out is a link the student clicks, and the only such link is Get name's
// PubChem compound page; the smoke tests apply linkProblem() to every link in every page.

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

// Exactly what Ketcher writes for a placed image (glassware, or a student's own picture).
const IMAGE_DATA = /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/]*={0,2}$/;

/** Why an SVG <image>'s source breaks the policy, or null if it is allowed. It is drawn, not
 * followed, so it is judged as an image (the CSP's img-src), not as a link: a base64 PNG or
 * SVG, which loads nothing, or one of the app's own files (docs/plans/v2-glassware.md,
 * decision 7). */
export function imageSourceProblem(url: string, appUrl: string): string | null {
  return IMAGE_DATA.test(url) ? null : requestProblem(url, appUrl);
}
