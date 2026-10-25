import type { Ketcher } from 'ketcher-core';
import { requestName, requestStructure, type NameOutcome, type StructureOutcome } from '../api';
import type { Placement } from '../editor/placeInHand';

// The naming panel's state, shared by the header's Get name button, its Name to structure box
// and the panel over the canvas. An answer is about the drawing as it was when it was asked
// for, so any change to the drawing closes the panel and drops an answer still on its way
// (its request aborted). The one exception: the change Name to structure makes itself.
// Add puts the compound in the student's hand until a click places it; while it is in hand
// the request is still on its way (Get name stays greyed), and a change puts it away.
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
  | { kind: 'placing'; typed: string }
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
  placing: 'Click on the canvas to place it. Esc cancels.',
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
let inHand: Placement | null = null; // Add's compound, following the mouse
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

/** Close the panel, drop any answer still coming and put away a compound in hand (the
 * student closed it, or the drawing changed). */
export function closeName(): void {
  inFlight?.abort();
  inFlight = null;
  const held = inHand;
  inHand = null;
  held?.cancel();
  if (state.kind !== 'idle') show({ kind: 'idle' });
}

/** Ketcher's change event: the drawing changed, so whatever the panel says is stale. Ketcher
 * fires it once for setMolecule(), before it resolves, and once inside the click that places
 * Add's compound (measured); those are Name to structure's own. */
export function drawingChanged(): void {
  if (!drawingItself) closeName();
}

function ownChange(draw: () => void): void {
  drawingItself = true;
  try {
    draw();
  } finally {
    drawingItself = false;
  }
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

/** Puts a Molfile in the student's hand (src/editor/placeInHand.ts; a stand-in in tests). */
export type Placer = (
  ketcher: Ketcher,
  molfile: string,
  dropping: (drop: () => void) => void,
) => Promise<Placement>;

/** Add: the compound follows the mouse until a click places it. True once placed; false if
 * it was put away (Esc, another tool, a change, the panel closed), and then the panel is
 * closed. */
async function addByClick(
  ketcher: Ketcher,
  typed: string,
  molfile: string,
  place: Placer,
  request: AbortController,
): Promise<boolean> {
  const held = await place(ketcher, molfile, ownChange);
  if (inFlight !== request) {
    held.cancel();
    return false;
  }
  inHand = held;
  show({ kind: 'placing', typed });
  const placed = await held.done;
  if (inHand === held) inHand = null;
  if (inFlight !== request) return false;
  if (!placed) closeName();
  return placed;
}

async function replace(ketcher: Ketcher, molfile: string, request: AbortController): Promise<boolean> {
  drawingItself = true;
  try {
    await ketcher.setMolecule(molfile);
  } finally {
    drawingItself = false;
  }
  return inFlight === request;
}

/** Name to structure: draw `typed` (Add places it where the student clicks, Replace replaces
 * the drawing; either is one Undo), then run Get name on what was drawn. */
export async function drawName(
  ketcher: Ketcher,
  typed: string,
  mode: 'add' | 'replace',
  place: Placer,
): Promise<void> {
  const request = start({ kind: 'drawing', typed });
  const outcome = await requestStructure(typed, request.signal);
  if (inFlight !== request) return;
  if (outcome.kind !== 'drawn') {
    inFlight = null;
    show(outcome.kind === 'no-compound' ? { ...outcome, typed } : outcome);
    return;
  }
  let drew: boolean;
  try {
    drew =
      mode === 'add'
        ? await addByClick(ketcher, typed, outcome.molfile, place, request)
        : await replace(ketcher, outcome.molfile, request);
  } catch {
    if (inFlight !== request) return;
    inFlight = null;
    show({ kind: 'draw-failed' });
    return;
  }
  if (!drew) return;
  const drawn: DrawnState = { kind: 'drawn', typed, structure: outcome, roundTrip: { kind: 'naming' } };
  show(drawn);
  const roundTrip = await requestName(outcome.smiles, request.signal);
  if (inFlight !== request) return;
  inFlight = null;
  show({ ...drawn, roundTrip });
}
