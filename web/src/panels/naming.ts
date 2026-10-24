import type { Ketcher } from 'ketcher-core';
import { requestName, requestStructure, type NameOutcome, type StructureOutcome } from '../api';

// The naming panel's state, shared by the header's Get name button, its Name to structure box
// and the panel over the canvas. An answer is about the drawing as it was when it was asked
// for, so any change to the drawing closes the panel and drops an answer still on its way
// (its request aborted). The one exception: the change Name to structure makes itself.
type Drawn = Extract<StructureOutcome, { kind: 'drawn' }>;

/** A drawn name and its round trip: Get name on what was drawn. */
export interface DrawnState {
  kind: 'drawn';
  typed: string;
  structure: Drawn;
  roundTrip: NameOutcome | { kind: 'naming' };
}

export type NameState =
  | { kind: 'idle' }
  | { kind: 'naming' }
  | { kind: 'reaction' }
  | NameOutcome
  | { kind: 'drawing'; typed: string }
  | DrawnState
  | { kind: 'no-compound'; typed: string; opsinMessage: string | null }
  | { kind: 'bad-name' }
  | { kind: 'draw-failed' };

/** What the panel says when there is no name to show (spec: "Offline and error behavior"). */
export const NAME_MESSAGES = {
  naming: 'Asking PubChem…',
  'not-found': 'PubChem has no record of this exact structure, so no name is available.',
  busy: 'Busy, try again shortly.',
  'not-responding': "The naming service isn't responding. Your drawing is safe; try again in a minute.",
  invalid: "This structure can't be looked up. Check it for errors such as a wrong valence.",
  reaction: 'Get name works on structures, not reactions.',
  'no-compound': 'PubChem has no compound by this name, so nothing was drawn.',
  'bad-name': 'Type one chemical name, on one line, of at most 300 characters.',
  'draw-failed': "The editor couldn't draw this structure.",
} as const;

export function stereoNote(undefinedStereo: number): string {
  const places = undefinedStereo === 1 ? '1 place' : `${undefinedStereo} places`;
  return `Stereochemistry is undefined at ${places} in this drawing, so the name may differ for a specific stereoisomer.`;
}

/** A round trip matches when the names are the same but for case and spacing. */
export function sameName(typed: string, iupac: string): boolean {
  const plain = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
  return plain(typed) === plain(iupac);
}

let state: NameState = { kind: 'idle' };
let inFlight: AbortController | null = null;
let drawingItself = false; // Name to structure is putting its structure on the canvas
const listeners = new Set<() => void>();

function show(next: NameState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function getNameState(): NameState {
  return state;
}

export function subscribeNameState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while a request (Get name, or Name to structure and its round trip) is on its way. */
export function isBusy(): boolean {
  return inFlight !== null;
}

/** Close the panel and drop any answer still coming (the student closed it). */
export function closeName(): void {
  inFlight?.abort();
  inFlight = null;
  if (state.kind !== 'idle') show({ kind: 'idle' });
}

/** Ketcher's change event: the drawing changed, so whatever the panel says is stale. Ketcher
 * fires it once for addFragment() and setMolecule(), before they resolve (measured), and
 * that one is Name to structure's own. */
export function drawingChanged(): void {
  if (!drawingItself) closeName();
}

function start(next: NameState): AbortController {
  closeName();
  const request = new AbortController();
  inFlight = request;
  show(next);
  return request;
}

async function lookUp(ketcher: Ketcher, signal: AbortSignal): Promise<NameState | null> {
  if (ketcher.containsReaction()) return { kind: 'reaction' };
  let smiles: string;
  try {
    smiles = await ketcher.getSmiles();
  } catch {
    return { kind: 'invalid' };
  }
  if (signal.aborted) return null;
  return smiles ? requestName(smiles, signal) : { kind: 'invalid' };
}

/** Name the drawing; the panel shows the outcome unless the drawing changes first. */
export async function nameDrawing(ketcher: Ketcher): Promise<void> {
  const request = start({ kind: 'naming' });
  const next = await lookUp(ketcher, request.signal);
  if (inFlight !== request || next === null) return;
  inFlight = null;
  show(next);
}

/** Name to structure: draw `typed` (Add puts it beside the drawing, Replace replaces the
 * drawing; either is one Undo), then run Get name on what was drawn. */
export async function drawName(ketcher: Ketcher, typed: string, mode: 'add' | 'replace'): Promise<void> {
  const request = start({ kind: 'drawing', typed });
  const outcome = await requestStructure(typed, request.signal);
  if (inFlight !== request) return;
  if (outcome.kind !== 'drawn') {
    inFlight = null;
    show(outcome.kind === 'no-compound' ? { ...outcome, typed } : outcome);
    return;
  }
  drawingItself = true;
  try {
    await (mode === 'add' ? ketcher.addFragment(outcome.molfile) : ketcher.setMolecule(outcome.molfile));
  } catch {
    inFlight = null;
    show({ kind: 'draw-failed' });
    return;
  } finally {
    drawingItself = false;
  }
  if (inFlight !== request) return;
  const drawn: DrawnState = { kind: 'drawn', typed, structure: outcome, roundTrip: { kind: 'naming' } };
  show(drawn);
  const roundTrip = await requestName(outcome.smiles, request.signal);
  if (inFlight !== request) return;
  inFlight = null;
  show({ ...drawn, roundTrip });
}
