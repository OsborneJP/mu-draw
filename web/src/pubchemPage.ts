// No imports and no browser or Vite APIs, so the server-answer readers and the browser tests
// can share it.

/** The one kind of page outside the app that the app links to (AGENTS.md, invariant 1). */
export function pubchemCompoundPage(cid: number): string {
  return `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;
}
