import type { Ketcher } from 'ketcher-core';
import { requestName, type NameOutcome } from '../api';

// Get name's state, shared by the header button and the panel over the canvas. An answer is
// about the drawing as it was at the click, so any change to the drawing closes the panel,
// and an answer still on its way is dropped (its request aborted).
export type NameState = { kind: 'idle' } | { kind: 'naming' } | { kind: 'reaction' } | NameOutcome;

/** What the panel says when there is no name to show (spec: "Offline and error behavior"). */
export const NAME_MESSAGES = {
  naming: 'Asking PubChem…',
  'not-found': 'PubChem has no record of this exact structure, so no name is available.',
  busy: 'Busy, try again shortly.',
  'not-responding': "The naming service isn't responding. Your drawing is safe; try again in a minute.",
  invalid: "This structure can't be looked up. Check it for errors such as a wrong valence.",
  reaction: 'Get name works on structures, not reactions.',
} as const;

export function stereoNote(undefinedStereo: number): string {
  const places = undefinedStereo === 1 ? '1 place' : `${undefinedStereo} places`;
  return `Stereochemistry is undefined at ${places} in this drawing, so the name may differ for a specific stereoisomer.`;
}

let state: NameState = { kind: 'idle' };
let inFlight: AbortController | null = null;
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

/** Close the panel and drop any answer still coming (the drawing changed, or the student
 * closed it). */
export function closeName(): void {
  inFlight?.abort();
  inFlight = null;
  if (state.kind !== 'idle') show({ kind: 'idle' });
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
  closeName();
  const request = new AbortController();
  inFlight = request;
  show({ kind: 'naming' });
  const next = await lookUp(ketcher, request.signal);
  if (inFlight !== request || next === null) return;
  inFlight = null;
  show(next);
}
