import type { Ketcher } from 'ketcher-core';
import { requestSafety } from '../api';
import type { SafetyOutcome } from './safetyAnswer';

// The Safety panel's state (docs/plans/v2-safety-snapshot.md), shared by the header's Safety
// button and the panel docked below the canvas. As with Get name, an answer is about the
// drawing as it was when it was asked for, so any change to the drawing closes the panel and
// drops an answer still on its way (its request aborted).
export type SafetyState = { kind: 'idle' } | { kind: 'asking' } | { kind: 'reaction' } | SafetyOutcome;

let state: SafetyState = { kind: 'idle' };
let inFlight: AbortController | null = null;
const listeners = new Set<() => void>();

function show(next: SafetyState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function getSafetyState(): SafetyState {
  return state;
}

export function subscribeSafetyState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while a lookup is on its way. */
export function isAsking(): boolean {
  return inFlight !== null;
}

/** Close the panel and drop any answer still coming (the student closed it, the drawing
 * changed, or another panel took the place below the canvas). */
export function closeSafety(): void {
  inFlight?.abort();
  inFlight = null;
  if (state.kind !== 'idle') show({ kind: 'idle' });
}

/** Ketcher's change event: whatever the panel says is about an older drawing. */
export function drawingChanged(): void {
  closeSafety();
}

async function lookUp(ketcher: Ketcher, signal: AbortSignal): Promise<SafetyState | null> {
  if (ketcher.containsReaction()) return { kind: 'reaction' };
  let smiles: string;
  try {
    smiles = await ketcher.getSmiles();
  } catch {
    return { kind: 'invalid' };
  }
  if (signal.aborted) return null;
  return smiles ? requestSafety(smiles, signal) : { kind: 'invalid' };
}

/** Look up the drawing's hazards; the panel shows the outcome unless the drawing changes or
 * the panel is closed first. */
export async function lookUpSafety(ketcher: Ketcher): Promise<void> {
  closeSafety();
  const request = new AbortController();
  inFlight = request;
  show({ kind: 'asking' });
  const next = await lookUp(ketcher, request.signal);
  if (inFlight !== request || next === null) return;
  inFlight = null;
  show(next);
}
