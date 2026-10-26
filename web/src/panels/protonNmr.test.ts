// The ¹H NMR preview's orderings, forced: the test decides what the drawing is, when the
// worker answers, and what happens in between (as nmr.test.ts does for ¹³C).
import { describe, expect, it } from 'vitest';
import type { ProtonReply, ProtonRequest, Signal } from '../chem/protonNmr';
import type { Drawing } from '../chem/tracker';
import { axisRange, carrier, createProton, MERGE_WITHIN, PLOT, sticks, xOf, type ProtonState, type ShownSignal } from './protonNmr';

const structure = (molfile: string, atomIds: number[]): Drawing => ({ kind: 'structure', molfile, atomIds, badValence: 0 });

// Made-up signals: two equivalent CH, a CH₃ matched close in, a diastereotopic CH₂'s pair,
// an OH, and an atom with no match.
const base = { exchangeable: false, diastereotopic: null, element: 6, bridged: false };
const SIGNALS: Signal[] = [
  { ...base, shift: 7.25, sphere: 4, atoms: [0, 2], hydrogens: 2, perAtom: 1 },
  { ...base, shift: 3.5, sphere: 3, atoms: [4], hydrogens: 1, perAtom: 1, element: 8, exchangeable: true },
  { ...base, shift: 1.9, sphere: 4, atoms: [3], hydrogens: 1, perAtom: 2, diastereotopic: 'higher' },
  { ...base, shift: 1.6, sphere: 4, atoms: [3], hydrogens: 1, perAtom: 2, diastereotopic: 'lower', bridged: true },
  { ...base, shift: 1.2, sphere: 2, atoms: [1], hydrogens: 3, perAtom: 3 },
  { ...base, shift: null, sphere: 0, atoms: [5], hydrogens: 2, perAtom: 2, element: 7, exchangeable: true },
];

function setup() {
  let drawing: Drawing = { kind: 'empty' };
  const sent: ProtonRequest[] = [];
  const shown: ProtonState[] = [];
  const proton = createProton(
    () => drawing,
    (request) => sent.push(request),
    (state) => shown.push(state),
  );
  return {
    proton,
    sent,
    shown,
    draw(next: Drawing) {
      drawing = next;
    },
    last: () => shown[shown.length - 1],
    answer: (id: number, signals: Signal[] | null = SIGNALS): ProtonReply => ({ kind: 'proton', id, signals }),
  };
}

describe('the ¹H NMR preview', () => {
  it('asks the worker about the drawing as it is, and shows its signals in Ketcher ids', () => {
    const t = setup();
    // Ketcher's ids out of Molfile order (an atom deleted and restored by Undo goes last).
    t.draw(structure('A', [10, 11, 12, 13, 15, 14]));
    t.proton.predict();
    expect(t.sent).toEqual([{ kind: 'proton', id: 1, molfile: 'A' }]);
    expect(t.last()).toEqual({ kind: 'predicting' });
    t.proton.reply(t.answer(1));
    const shown = (s: Partial<ShownSignal>) => ({ low: false, exchangeable: false, diastereotopic: null, bridged: false, ...s });
    expect(t.last()).toEqual({
      kind: 'ready',
      selected: null,
      signals: [
        shown({ shift: 7.25, atoms: [10, 12], hydrogens: 2, on: 'CH' }),
        shown({ shift: 3.5, atoms: [15], hydrogens: 1, on: 'OH', exchangeable: true }),
        shown({ shift: 1.9, atoms: [13], hydrogens: 1, on: 'CH₂', diastereotopic: 'higher' }),
        shown({ shift: 1.6, atoms: [13], hydrogens: 1, on: 'CH₂', diastereotopic: 'lower', bridged: true }),
        shown({ shift: 1.2, low: true, atoms: [11], hydrogens: 3, on: 'CH₃' }),
        shown({ shift: null, atoms: [14], hydrogens: 2, on: 'NH₂', exchangeable: true }),
      ],
    });
  });

  it('drops an answer for a drawing that changed, and says to predict again', () => {
    const t = setup();
    t.draw(structure('A', [0, 1, 2, 3, 4, 5]));
    t.proton.predict();
    t.proton.changed();
    expect(t.last()).toEqual({ kind: 'stale' });
    t.proton.reply(t.answer(1));
    expect(t.last()).toEqual({ kind: 'stale' });
    t.draw(structure('B', [0, 1, 2, 3, 4, 5]));
    t.proton.predict();
    t.proton.reply(t.answer(1));
    expect(t.last()).toEqual({ kind: 'predicting' });
    t.proton.reply(t.answer(2));
    expect(t.last().kind).toBe('ready');
    t.proton.changed();
    expect(t.last()).toEqual({ kind: 'stale' });
    t.proton.close();
    const count = t.shown.length;
    t.proton.changed();
    expect(t.shown.length).toBe(count);
  });

  it('a close drops the answer still coming', () => {
    const t = setup();
    t.draw(structure('A', [0, 1, 2, 3, 4, 5]));
    t.proton.predict();
    t.proton.close();
    t.proton.reply(t.answer(1));
    expect(t.last()).toEqual({ kind: 'idle' });
  });

  it('says why there is nothing to predict', () => {
    const t = setup();
    for (const kind of ['empty', 'reaction', 'not-elements', 'unreadable'] as const) {
      t.draw({ kind });
      t.proton.predict();
      expect(t.last()).toEqual({ kind: 'message', message: kind });
    }
    expect(t.sent).toEqual([]);
    t.draw(structure('A', [0]));
    t.proton.predict();
    t.proton.reply(t.answer(1, []));
    expect(t.last()).toEqual({ kind: 'message', message: 'no-hydrogens' });
    t.proton.predict();
    t.proton.reply(t.answer(2, null));
    expect(t.last()).toEqual({ kind: 'message', message: 'unreadable' });
    t.proton.predict();
    t.proton.reply({ kind: 'proton', id: 3, unavailable: 'nmr/proton-shifts.bin could not be loaded (Error: HTTP 404)' });
    expect(t.last()).toEqual({
      kind: 'message',
      message: 'unavailable',
      detail: 'nmr/proton-shifts.bin could not be loaded (Error: HTTP 404)',
    });
  });

  it('once RDKit cannot start, says so for every prediction', () => {
    const t = setup();
    t.draw(structure('A', [0]));
    t.proton.predict();
    t.proton.reply({ failed: 'EvalError' });
    const unavailable = { kind: 'message', message: 'unavailable', detail: 'RDKit could not start (EvalError)' };
    expect(t.last()).toEqual(unavailable);
    t.proton.predict();
    expect(t.last()).toEqual(unavailable);
    expect(t.sent.length).toBe(1);
  });

  it('selects a signal from its row or stick, or from an atom carrying its H on the canvas', () => {
    const t = setup();
    t.draw(structure('A', [10, 11, 12, 13, 15, 14]));
    t.proton.predict();
    t.proton.reply(t.answer(1));
    const selected = () => {
      const s = t.last();
      return s.kind === 'ready' ? s.selected : 'not ready';
    };
    t.proton.select(4);
    expect(selected()).toBe(4);
    t.proton.select(4); // again: deselect
    expect(selected()).toBe(null);
    t.proton.selectAtoms([12]); // the second of the equivalent CH
    expect(selected()).toBe(0);
    t.proton.selectAtoms([13]); // a diastereotopic CH₂: its first signal
    expect(selected()).toBe(2);
    t.proton.selectAtoms([10, 11]); // more than one atom: leave it
    t.proton.selectAtoms([99]); // no H of a signal: leave it
    t.proton.selectAtoms([]);
    expect(selected()).toBe(2);
    t.proton.changed();
    t.proton.select(0);
    t.proton.selectAtoms([10]);
    expect(t.last()).toEqual({ kind: 'stale' });
  });

  it("names what the H sit on, with any element's symbol", () => {
    expect([1, 2, 3].map((n) => carrier(6, n))).toEqual(['CH', 'CH₂', 'CH₃']);
    expect([carrier(8, 1), carrier(7, 1), carrier(7, 2), carrier(16, 1), carrier(14, 3)]).toEqual(['OH', 'NH', 'NH₂', 'SH', 'SiH₃']);
    expect([carrier(17, 1), carrier(35, 1), carrier(13, 4)]).toEqual(['ClH', 'BrH', 'AlH₄']);
    expect(carrier(200, 1)).toBe('element 200 H');
  });

  const at = (...shifts: (number | null)[]) => shifts.map((shift) => ({ shift, hydrogens: 1, low: false, exchangeable: false }) as ShownSignal);

  it('draws 12 to 0 ppm, wider in whole ppm when a signal lies beyond either end', () => {
    expect(axisRange(at(7.2, 1.1, null))).toEqual({ min: 0, max: 12 });
    expect(axisRange(at(12, 0))).toEqual({ min: 0, max: 12 });
    expect(axisRange(at(12.01, 2))).toEqual({ min: 0, max: 13 });
    expect(axisRange(at(15.3, -0.4))).toEqual({ min: -1, max: 16 });
  });

  it('puts the highest shift on the left', () => {
    const range = { min: 0, max: 12 };
    expect(xOf(12, range)).toBe(PLOT.left);
    expect(xOf(0, range)).toBe(PLOT.width - PLOT.right);
    expect(xOf(6, range)).toBe((PLOT.left + PLOT.width - PLOT.right) / 2);
    expect(xOf(-1, { min: -1, max: 12 })).toBe(PLOT.width - PLOT.right);
  });

  it('draws signals closer than a line as one stick, as tall as their H, and no stick covers another', () => {
    const range = { min: 0, max: 12 };
    const unit = (12 / (PLOT.width - PLOT.left - PLOT.right)) * (MERGE_WITHIN / 2); // half the merging distance, in ppm
    const signals = [...at(7.3, 7.3 - unit, 7.3 - 6 * unit, 2.1, null)];
    signals[1].hydrogens = 2;
    const drawn = sticks(signals, range);
    // Left to right, the highest shift first.
    expect(drawn.map((d) => [d.signals, d.hydrogens])).toEqual([
      [[0, 1], 3],
      [[2], 1],
      [[3], 1],
    ]);
    for (const [k, d] of drawn.entries()) {
      expect(d.from).toBeLessThan(d.x);
      expect(d.to).toBeGreaterThan(d.x);
      if (k > 0) expect(d.from).toBeGreaterThanOrEqual(drawn[k - 1].to);
    }
    // Two close sticks' targets meet halfway.
    expect(drawn[1].from).toBeCloseTo((drawn[0].x + drawn[1].x) / 2, 9);
    expect(drawn[0].to).toBeCloseTo(drawn[1].from, 9);
  });
});
