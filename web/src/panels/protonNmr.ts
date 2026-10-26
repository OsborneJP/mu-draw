// The ¹H NMR preview's state (docs/plans/v2-proton-nmr.md), as the ¹³C one (nmr.ts): no
// timers and no DOM; a prediction is asked for when the student presses the button,
// answered by the panels' worker, and stale as soon as the drawing changes (an answer still
// on its way is then dropped). Every ordering is forced in protonNmr.test.ts by holding and
// releasing replies; protonStore.ts connects it to Ketcher, the worker and the canvas.
// (With .ts: the browser tests import this file in Node.)
import { Elements } from 'ketcher-core';
import { LOW_CONFIDENCE_SPHERES, type ProtonReply, type ProtonRequest } from '../chem/protonNmr.ts';
import type { Drawing } from '../chem/tracker';
import { carbonType } from './nmr.ts';

/** One signal, in Ketcher's atom ids. */
export interface ShownSignal {
  /** ppm; null when the table has no environment like these atoms'. */
  shift: number | null;
  /** The match was 2 bonds out or fewer (src/chem/protonNmr.ts). */
  low: boolean;
  atoms: number[];
  hydrogens: number;
  /** What the H sit on: CH₃, OH, NH₂. */
  on: string;
  exchangeable: boolean;
  diastereotopic: 'higher' | 'lower' | null;
  /** A diastereotopic CH₂ in a bridged ring system (src/chem/protonNmr.ts). */
  bridged: boolean;
}

export type ProtonMessage = 'empty' | 'reaction' | 'not-elements' | 'unreadable' | 'no-hydrogens' | 'unavailable';

export type ProtonState =
  | { kind: 'idle' }
  | { kind: 'predicting' }
  | { kind: 'message'; message: ProtonMessage; detail?: string }
  | { kind: 'ready'; signals: ShownSignal[]; selected: number | null }
  | { kind: 'stale' };

export interface Proton {
  /** Predict the drawing as it is now. */
  predict(): void;
  /** A message from the panels' worker. */
  reply(message: ProtonReply | { failed: string }): void;
  /** Ketcher's change event. */
  changed(): void;
  close(): void;
  /** Select a signal (again: deselect it). */
  select(index: number): void;
  /** Ketcher's selection: one atom selected selects its (first) signal. */
  selectAtoms(atoms: number[]): void;
}

/** "CH₃", "CH₂", "OH", "NH₂", "ClH", "AlH₄" (element symbols from Ketcher's table). */
export function carrier(element: number, perAtom: number): string {
  if (element === 6) return carbonType(perAtom);
  const sub = '₀₁₂₃₄₅₆₇₈₉';
  const count = perAtom === 1 ? '' : [...String(perAtom)].map((d) => sub[Number(d)]).join('');
  return `${Elements.get(element)?.label ?? `element ${element} `}H${count}`;
}

/** The spectrum's axis: 12 ppm on the left to 0 on the right, widened in whole ppm to take a
 * signal beyond either end (carboxylic acids above 12, some metal hydrides below 0). */
export function axisRange(signals: ShownSignal[]): { min: number; max: number } {
  const shifts = signals.flatMap((s) => (s.shift === null ? [] : [s.shift]));
  return { min: Math.min(0, ...shifts.map(Math.floor)), max: Math.max(12, ...shifts.map(Math.ceil)) };
}

/** The spectrum's drawing area, in SVG viewBox units. */
export const PLOT = { width: 560, left: 16, right: 16 };

/** Where a shift sits on the reversed axis. */
export function xOf(ppm: number, { min, max }: { min: number; max: number }): number {
  return PLOT.left + ((max - ppm) / (max - min)) * (PLOT.width - PLOT.left - PLOT.right);
}

/** Sticks closer than this (a line's width, in viewBox units) are drawn as one. */
export const MERGE_WITHIN = 2;
/** How far a stick's click target reaches either side of it, short of its neighbours. */
const TARGET = 4;

/** One stick of the spectrum: the signals drawn there (by index, in table order), as tall as
 * their H together, and the stretch of the axis a click on it covers (from–to), which stops
 * halfway to each neighbour so a stick never covers another. */
export interface Stick {
  x: number;
  signals: number[];
  hydrogens: number;
  low: boolean;
  exchangeable: boolean;
  from: number;
  to: number;
}

export function sticks(signals: ShownSignal[], range: { min: number; max: number }): Stick[] {
  const placed = signals
    .map((s, i) => ({ s, i, x: s.shift === null ? null : xOf(s.shift, range) }))
    .filter((p): p is { s: ShownSignal; i: number; x: number } => p.x !== null)
    .sort((a, b) => a.x - b.x || a.i - b.i);
  const groups: (typeof placed)[] = [];
  for (const p of placed) {
    const last = groups[groups.length - 1];
    if (last && p.x - last[last.length - 1].x < MERGE_WITHIN) last.push(p);
    else groups.push([p]);
  }
  const drawn = groups.map((g) => ({
    x: g.reduce((sum, p) => sum + p.x, 0) / g.length,
    signals: g.map((p) => p.i).sort((a, b) => a - b),
    hydrogens: g.reduce((sum, p) => sum + p.s.hydrogens, 0),
    low: g.some((p) => p.s.low),
    exchangeable: g.every((p) => p.s.exchangeable),
  }));
  return drawn.map((d, k) => ({
    ...d,
    from: k > 0 ? Math.max(d.x - TARGET, (drawn[k - 1].x + d.x) / 2) : d.x - TARGET,
    to: k < drawn.length - 1 ? Math.min(d.x + TARGET, (d.x + drawn[k + 1].x) / 2) : d.x + TARGET,
  }));
}

export function createProton(read: () => Drawing, send: (request: ProtonRequest) => void, show: (state: ProtonState) => void): Proton {
  let state: ProtonState = { kind: 'idle' };
  let pending: { id: number; atomIds: number[] } | null = null;
  let nextId = 1;
  let failed: string | null = null;

  const set = (next: ProtonState) => {
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
      send({ kind: 'proton', id: pending.id, molfile: drawing.molfile });
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
      if (message.signals === null) return set({ kind: 'message', message: 'unreadable' });
      if (message.signals.length === 0) return set({ kind: 'message', message: 'no-hydrogens' });
      set({
        kind: 'ready',
        selected: null,
        signals: message.signals.map((s) => ({
          shift: s.shift,
          low: s.shift !== null && s.sphere <= LOW_CONFIDENCE_SPHERES,
          atoms: s.atoms.map((i) => atomIds[i]),
          hydrogens: s.hydrogens,
          on: carrier(s.element, s.perAtom),
          exchangeable: s.exchangeable,
          diastereotopic: s.diastereotopic,
          bridged: s.bridged,
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
      const index = state.signals.findIndex((s) => s.atoms.includes(atoms[0]));
      if (index >= 0 && index !== state.selected) set({ ...state, selected: index });
    },
  };
}
