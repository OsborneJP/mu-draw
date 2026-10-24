// The NMR preview's orderings, forced: the test decides what the drawing is, when the
// worker answers, and what happens in between.
import { describe, expect, it } from 'vitest';
import type { NmrReply, NmrRequest, Peak } from '../chem/nmr';
import type { Drawing } from '../chem/tracker';
import { carbonType, createNmr, type NmrState } from './nmr';

const structure = (molfile: string, atomIds: number[]): Drawing => ({ kind: 'structure', molfile, atomIds, badValence: 0 });

// Made-up peaks: two carbons equivalent, one matched far out, one close in, one not at all.
const PEAKS: Peak[] = [
  { shift: 130.5, sphere: 4, atoms: [0, 2], hydrogens: 1 },
  { shift: 20.1, sphere: 2, atoms: [1], hydrogens: 3 },
  { shift: null, sphere: 0, atoms: [3], hydrogens: 0 },
];

function setup() {
  let drawing: Drawing = { kind: 'empty' };
  const sent: NmrRequest[] = [];
  const shown: NmrState[] = [];
  const nmr = createNmr(
    () => drawing,
    (request) => sent.push(request),
    (state) => shown.push(state),
  );
  return {
    nmr,
    sent,
    shown,
    draw(next: Drawing) {
      drawing = next;
    },
    last: () => shown[shown.length - 1],
    answer: (id: number, peaks: Peak[] | null = PEAKS): NmrReply => ({ kind: 'nmr', id, peaks }),
  };
}

describe('the NMR preview', () => {
  it('asks the worker about the drawing as it is, and shows its peaks in Ketcher ids', () => {
    const t = setup();
    // Ketcher's ids out of Molfile order (an atom deleted and restored by Undo goes last).
    t.draw(structure('A', [10, 11, 13, 12]));
    t.nmr.predict();
    expect(t.sent).toEqual([{ kind: 'nmr', id: 1, molfile: 'A' }]);
    expect(t.last()).toEqual({ kind: 'predicting' });
    t.nmr.reply(t.answer(1));
    expect(t.last()).toEqual({
      kind: 'ready',
      selected: null,
      peaks: [
        { shift: 130.5, low: false, atoms: [10, 13], hydrogens: 1 },
        { shift: 20.1, low: true, atoms: [11], hydrogens: 3 },
        { shift: null, low: false, atoms: [12], hydrogens: 0 },
      ],
    });
  });

  it('drops an answer for a drawing that changed, and says to predict again', () => {
    const t = setup();
    t.draw(structure('A', [0, 1, 2, 3]));
    t.nmr.predict();
    t.nmr.changed();
    expect(t.last()).toEqual({ kind: 'stale' });
    t.nmr.reply(t.answer(1));
    expect(t.last()).toEqual({ kind: 'stale' });
    // Predicting again asks anew; the old answer, if it comes now, is still dropped.
    t.draw(structure('B', [0, 1, 2, 3]));
    t.nmr.predict();
    t.nmr.reply(t.answer(1));
    expect(t.last()).toEqual({ kind: 'predicting' });
    t.nmr.reply(t.answer(2));
    expect(t.last().kind).toBe('ready');
    // A shown prediction is stale too once the drawing changes; changes before any
    // prediction, or after closing, change nothing.
    t.nmr.changed();
    expect(t.last()).toEqual({ kind: 'stale' });
    t.nmr.close();
    const count = t.shown.length;
    t.nmr.changed();
    expect(t.shown.length).toBe(count);
  });

  it('a close drops the answer still coming', () => {
    const t = setup();
    t.draw(structure('A', [0, 1, 2, 3]));
    t.nmr.predict();
    t.nmr.close();
    t.nmr.reply(t.answer(1));
    expect(t.last()).toEqual({ kind: 'idle' });
  });

  it('says why there is nothing to predict', () => {
    const t = setup();
    for (const kind of ['empty', 'reaction', 'not-elements', 'unreadable'] as const) {
      t.draw({ kind });
      t.nmr.predict();
      expect(t.last()).toEqual({ kind: 'message', message: kind });
    }
    expect(t.sent).toEqual([]);
    t.draw(structure('A', [0]));
    t.nmr.predict();
    t.nmr.reply(t.answer(1, []));
    expect(t.last()).toEqual({ kind: 'message', message: 'no-carbons' });
    t.nmr.predict();
    t.nmr.reply(t.answer(2, null));
    expect(t.last()).toEqual({ kind: 'message', message: 'unreadable' });
    t.nmr.predict();
    t.nmr.reply({ kind: 'nmr', id: 3, unavailable: 'nmr/carbon-shifts.bin could not be loaded (Error: HTTP 404)' });
    expect(t.last()).toEqual({
      kind: 'message',
      message: 'unavailable',
      detail: 'nmr/carbon-shifts.bin could not be loaded (Error: HTTP 404)',
    });
  });

  it('once RDKit cannot start, says so for every prediction', () => {
    const t = setup();
    t.draw(structure('A', [0]));
    t.nmr.predict();
    t.nmr.reply({ failed: 'EvalError' });
    const unavailable = { kind: 'message', message: 'unavailable', detail: 'RDKit could not start (EvalError)' };
    expect(t.last()).toEqual(unavailable);
    t.nmr.predict();
    expect(t.last()).toEqual(unavailable);
    expect(t.sent.length).toBe(1);
  });

  it('selects a peak from its row or stick, or from one of its carbons on the canvas', () => {
    const t = setup();
    t.draw(structure('A', [10, 11, 13, 12]));
    t.nmr.predict();
    t.nmr.reply(t.answer(1));
    const selected = () => {
      const s = t.last();
      return s.kind === 'ready' ? s.selected : 'not ready';
    };
    t.nmr.select(1);
    expect(selected()).toBe(1);
    t.nmr.select(1); // again: deselect
    expect(selected()).toBe(null);
    t.nmr.selectAtoms([13]); // the second of the equivalent carbons
    expect(selected()).toBe(0);
    t.nmr.selectAtoms([10, 11]); // more than one atom: leave it
    t.nmr.selectAtoms([99]); // not a carbon of a peak: leave it
    t.nmr.selectAtoms([]);
    expect(selected()).toBe(0);
    t.nmr.changed();
    t.nmr.select(0);
    t.nmr.selectAtoms([10]);
    expect(t.last()).toEqual({ kind: 'stale' });
  });

  it('names carbons by their hydrogens', () => {
    expect([0, 1, 2, 3, 4].map(carbonType)).toEqual(['C', 'CH', 'CH₂', 'CH₃', 'CH₄']);
  });
});
