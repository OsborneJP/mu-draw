// Calls to the app's own API under <base>api/, the only server the app talks to. Get name
// sends just the drawing's SMILES, in a POST body, so it never appears in a URL or a log line.

/** With no answer after this long, the naming service counts as not responding (spec). */
export const NAMING_DEADLINE_MS = 8000;

/** The one page outside the app that the app links to (AGENTS.md, invariant 1). */
export function pubchemCompoundPage(cid: number): string {
  return `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;
}

export type NameOutcome =
  | {
      kind: 'found';
      iupac: string | null;
      title: string | null;
      cid: number;
      url: string;
      /** Stereocentres and stereogenic double bonds the drawing leaves undefined. */
      undefinedStereo: number;
    }
  | { kind: 'not-found' }
  | { kind: 'busy' }
  | { kind: 'invalid' }
  | { kind: 'not-responding' };

const NOT_RESPONDING: NameOutcome = { kind: 'not-responding' };

function isNameOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** What the student is told, from the server's status and answer. Anything unexpected
 * counts as not responding; a link is shown only if it is exactly the CID's PubChem page. */
export function nameOutcome(status: number, body: unknown): NameOutcome {
  const answer = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (status === 503 && answer.error === 'busy') return { kind: 'busy' };
  if (status === 400 && answer.error === 'invalid_structure') return { kind: 'invalid' };
  if (status !== 200) return NOT_RESPONDING;
  if (answer.found === false) return { kind: 'not-found' };
  const { iupac, title, cid, url, undefined_stereo: undefinedStereo } = answer;
  if (answer.found !== true || !isCount(cid) || cid === 0 || url !== pubchemCompoundPage(cid)) return NOT_RESPONDING;
  if (!isNameOrNull(iupac) || !isNameOrNull(title) || !isCount(undefinedStereo)) return NOT_RESPONDING;
  return { kind: 'found', iupac, title, cid, url, undefinedStereo };
}

/** Ask the server to name a structure. Gives up after NAMING_DEADLINE_MS, or when `signal`
 * aborts (the caller then ignores the outcome). Never throws. */
export async function requestName(smiles: string, signal: AbortSignal): Promise<NameOutcome> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), NAMING_DEADLINE_MS);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ smiles }),
      signal: AbortSignal.any([signal, deadline.signal]),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch (error) {
      if (deadline.signal.aborted || signal.aborted) throw error;
    }
    return nameOutcome(response.status, body);
  } catch {
    return NOT_RESPONDING;
  } finally {
    clearTimeout(timer);
  }
}
