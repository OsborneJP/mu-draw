// The ¹³C NMR preview's state (spec "NMR prediction proof of concept"), with no timers and
// no DOM: a prediction is asked for when the student presses the button, answered by the
// NMR worker, and stale as soon as the drawing changes (an answer still on its way is then
// dropped). Every ordering is forced in nmr.test.ts by holding and releasing replies;
// nmrStore.ts connects it to Ketcher, the worker and the canvas highlight.
// (With .ts: the browser tests import this file in Node.)
import { LOW_CONFIDENCE_SPHERES, type NmrReply, type NmrRequest } from '../chem/nmr.ts';
import type { Drawing } from '../chem/tracker';

/** The spec's banner, shown with every prediction. */
export const BANNER =
  'Predicted shifts from a database of measured spectra. Real spectra can differ; use this to check reasoning, not as an answer key.';

/** The selected peak's carbons on the canvas. */
export const PEAK_COLOR = '#ffa666';

/** One peak, in Ketcher's atom ids. */
export interface ShownPeak {
  /** ppm; null when the table has no environment like this carbon's. */
  shift: number | null;
  /** The match was 2 bonds out or fewer (src/chem/nmr.ts). */
  low: boolean;
  atoms: number[];
  hydrogens: number;
}

export type NmrMessage = 'empty' | 'reaction' | 'not-elements' | 'unreadable' | 'no-carbons' | 'unavailable';

export type NmrState =
  | { kind: 'idle' }
  | { kind: 'predicting' }
  | { kind: 'message'; message: NmrMessage; detail?: string }
  | { kind: 'ready'; peaks: ShownPeak[]; selected: number | null }
  | { kind: 'stale' };

export interface Nmr {
  /** Predict the drawing as it is now. */
  predict(): void;
  /** A message from the NMR worker. */
  reply(message: NmrReply | { failed: string }): void;
  /** Ketcher's change event. */
  changed(): void;
  close(): void;
  /** Select a peak (again: deselect it). */
  select(index: number): void;
  /** Ketcher's selection: one carbon selected selects its peak. */
  selectAtoms(atoms: number[]): void;
}

/** "C", "CH", "CH₂", "CH₃" (and "CH₄" for methane). */
export function carbonType(hydrogens: number): string {
  const sub = '₀₁₂₃₄₅₆₇₈₉';
  return hydrogens === 0 ? 'C' : hydrogens === 1 ? 'CH' : `CH${[...String(hydrogens)].map((d) => sub[Number(d)]).join('')}`;
}

export function createNmr(read: () => Drawing, send: (request: NmrRequest) => void, show: (state: NmrState) => void): Nmr {
  let state: NmrState = { kind: 'idle' };
  let pending: { id: number; atomIds: number[] } | null = null;
  let nextId = 1;
  let failed: string | null = null;

  const set = (next: NmrState) => {
    state = next;
    show(next);
  };

  return {
    predict() {
      pending = null;
      if (failed !== null) return set({ kind: 'message', message: 'unavailable', detail: failed });
      const drawing = read();
      if (drawing.kind !== 'structure') return set({ kind: 'message', message: drawing.kind });
      pending = { id: nextId++, atomIds: drawing.atomIds };
      send({ kind: 'nmr', id: pending.id, molfile: drawing.molfile });
      set({ kind: 'predicting' });
    },
    reply(message) {
      if ('failed' in message) {
        failed = `RDKit could not start (${message.failed})`;
        if (pending) {
          pending = null;
          set({ kind: 'message', message: 'unavailable', detail: failed });
        }
        return;
      }
      if (!pending || message.id !== pending.id) return; // asked about an earlier drawing
      const { atomIds } = pending;
      pending = null;
      if ('unavailable' in message) return set({ kind: 'message', message: 'unavailable', detail: message.unavailable });
      if (message.peaks === null) return set({ kind: 'message', message: 'unreadable' });
      if (message.peaks.length === 0) return set({ kind: 'message', message: 'no-carbons' });
      set({
        kind: 'ready',
        selected: null,
        peaks: message.peaks.map((p) => ({
          shift: p.shift,
          low: p.shift !== null && p.sphere <= LOW_CONFIDENCE_SPHERES,
          atoms: p.atoms.map((i) => atomIds[i]),
          hydrogens: p.hydrogens,
        })),
      });
    },
    changed() {
      if (state.kind === 'idle' || state.kind === 'stale') return;
      pending = null;
      set({ kind: 'stale' });
    },
    close() {
      pending = null;
      if (state.kind !== 'idle') set({ kind: 'idle' });
    },
    select(index) {
      if (state.kind !== 'ready') return;
      set({ ...state, selected: state.selected === index ? null : index });
    },
    selectAtoms(atoms) {
      if (state.kind !== 'ready' || atoms.length !== 1) return;
      const index = state.peaks.findIndex((p) => p.atoms.includes(atoms[0]));
      if (index >= 0 && index !== state.selected) set({ ...state, selected: index });
    },
  };
}
