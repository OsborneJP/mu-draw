// Calls to the app's own API under <base>api/, the only server the app talks to. Get name,
// Safety and the 3D view send just the drawing's SMILES and Name to structure just the typed
// name, each in a POST body, so none appears in a URL or a log line.
import { safetyOutcome, type SafetyOutcome } from './panels/safetyAnswer';
import { pubchemCompoundPage } from './pubchemPage';

export { pubchemCompoundPage };

/** With no answer after this long, the naming service counts as not responding (spec). */
export const NAMING_DEADLINE_MS = 8000;

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

const NOT_RESPONDING = { kind: 'not-responding' } as const;

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

/** POST `body` to `<base>api/<path>` and read the JSON answer. Gives up after
 * NAMING_DEADLINE_MS, or when `signal` aborts. Null means no usable answer arrived. */
async function post(path: string, body: object, signal: AbortSignal): Promise<{ status: number; body: unknown } | null> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), NAMING_DEADLINE_MS);
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, deadline.signal]),
    });
    let answer: unknown = null;
    try {
      answer = await response.json();
    } catch (error) {
      if (deadline.signal.aborted || signal.aborted) throw error;
    }
    return { status: response.status, body: answer };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Ask the server to name a structure. Gives up after NAMING_DEADLINE_MS, or when `signal`
 * aborts (the caller then ignores the outcome). Never throws. */
export async function requestName(smiles: string, signal: AbortSignal): Promise<NameOutcome> {
  const answer = await post('name', { smiles }, signal);
  return answer ? nameOutcome(answer.status, answer.body) : NOT_RESPONDING;
}

export type StructureOutcome =
  | {
      kind: 'drawn';
      smiles: string;
      molfile: string;
      source: 'OPSIN' | 'PubChem';
      /** OPSIN's own words when it couldn't read the name, or warned. */
      opsinMessage: string | null;
      title: string | null;
      cid: number | null;
      /** How many records PubChem has for the name (it draws the first). */
      matches: number;
      /** OPSIN left stereo undefined, and PubChem's record for the name specifies it. */
      stereoFromPubchem: boolean;
    }
  | { kind: 'no-compound'; opsinMessage: string | null }
  | { kind: 'bad-name' }
  | { kind: 'busy' }
  | { kind: 'not-responding' };

/** What Name to structure draws or says, from the server's status and answer. */
export function structureOutcome(status: number, body: unknown): StructureOutcome {
  const answer = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (status === 503 && answer.error === 'busy') return { kind: 'busy' };
  if (status === 422) return { kind: 'bad-name' };
  if (status !== 200) return NOT_RESPONDING;
  const { smiles, molfile, source, message, title, cid, matches, stereo_from_pubchem: stereo } = answer;
  if (!isNameOrNull(message) || !isCount(matches) || typeof stereo !== 'boolean') return NOT_RESPONDING;
  if (answer.found === false) return { kind: 'no-compound', opsinMessage: message };
  if (answer.found !== true || typeof smiles !== 'string' || !smiles || typeof molfile !== 'string') {
    return NOT_RESPONDING;
  }
  if (source !== 'OPSIN' && source !== 'PubChem') return NOT_RESPONDING;
  if (!isNameOrNull(title) || !(cid === null || (isCount(cid) && cid > 0))) return NOT_RESPONDING;
  return {
    kind: 'drawn',
    smiles,
    molfile,
    source,
    opsinMessage: message,
    title,
    cid,
    matches,
    stereoFromPubchem: stereo,
  };
}

/** Ask the server to draw a name (OPSIN, then PubChem). Same deadline as requestName. */
export async function requestStructure(name: string, signal: AbortSignal): Promise<StructureOutcome> {
  const answer = await post('structure', { name }, signal);
  return answer ? structureOutcome(answer.status, answer.body) : NOT_RESPONDING;
}

/** Ask the server for the drawing's GHS classification. Same deadline as requestName. */
export async function requestSafety(smiles: string, signal: AbortSignal): Promise<SafetyOutcome> {
  const answer = await post('safety', { smiles }, signal);
  return answer ? safetyOutcome(answer.status, answer.body) : NOT_RESPONDING;
}

/** What PubChem said about the structure (server/threed.py's Model.pubchem). */
export type PubChemSaid = 'found' | 'none' | 'unusable' | 'no_answer';

export type ConformerOutcome =
  | {
      kind: 'model';
      /** A 3D Molfile with every H. */
      molblock: string;
      source: 'pubchem' | 'rdkit';
      /** PubChem's compound, when the model is PubChem's. */
      cid: number | null;
      pubchem: PubChemSaid;
      /** Stereo elements the drawing leaves undefined (the model shows one arrangement). */
      undefinedStereo: number;
    }
  | { kind: 'no-model'; reason: 'too_big' | 'no_model' }
  | { kind: 'one-structure' }
  | { kind: 'invalid' }
  | { kind: 'busy' }
  | { kind: 'not-responding' };

const SAID: readonly unknown[] = ['found', 'none', 'unusable', 'no_answer'];

/** What the 3D view shows, from the server's status and answer. Anything unexpected counts
 * as not responding: PubChem's model always has its CID, RDKit's never has one. */
export function conformerOutcome(status: number, body: unknown): ConformerOutcome {
  const answer = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (status === 503 && answer.error === 'busy') return { kind: 'busy' };
  if (status === 400 && answer.error === 'one_structure') return { kind: 'one-structure' };
  if (status === 400 && answer.error === 'invalid_structure') return { kind: 'invalid' };
  if (status !== 200) return NOT_RESPONDING;
  const { found, source, cid, molblock, pubchem, reason, undefined_stereo: undefinedStereo } = answer;
  if (!SAID.includes(pubchem) || !isCount(undefinedStereo)) return NOT_RESPONDING;
  const said = pubchem as PubChemSaid;
  if (found === false) {
    const empty = source === null && cid === null && molblock === null;
    return empty && (reason === 'too_big' || reason === 'no_model') ? { kind: 'no-model', reason } : NOT_RESPONDING;
  }
  if (found !== true || reason !== null || typeof molblock !== 'string' || !molblock) return NOT_RESPONDING;
  const fromPubchem = source === 'pubchem' && said === 'found' && isCount(cid) && cid > 0;
  const fromRdkit = source === 'rdkit' && said !== 'found' && cid === null;
  if (!fromPubchem && !fromRdkit) return NOT_RESPONDING;
  return { kind: 'model', molblock, source, cid: fromPubchem ? (cid as number) : null, pubchem: said, undefinedStereo };
}

/** Ask the server for a 3D model of a structure. Same deadline as requestName. */
export async function requestConformer(smiles: string, signal: AbortSignal): Promise<ConformerOutcome> {
  const answer = await post('conformer', { smiles }, signal);
  return answer ? conformerOutcome(answer.status, answer.body) : NOT_RESPONDING;
}
