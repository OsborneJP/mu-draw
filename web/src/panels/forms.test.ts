// The tautomer and resonance panels' state machine (forms.ts), every ordering forced: the
// worker's replies and the placements are held until the test releases them (bar B.4-B.5).
import { describe, expect, it } from 'vitest';
import type { FormsKind, FormsReply, FormsRequest, ResonanceResult, TautomerResult } from '../chem/formPictures';
import type { Drawing } from '../chem/tracker';
import type { Placement } from '../editor/placeInHand';
import { createForms, molfileOf, type FormsResult, type FormsState } from './forms';

const STRUCTURE: Drawing = { kind: 'structure', molfile: 'the drawing', atomIds: [], badValence: 0 };

/** Listed results with two structures each (their contents don't matter here). */
const card = (number: number) => ({
  number,
  drawing: number === 1,
  changedAtoms: [],
  changedBonds: [],
  molfile: `molfile ${number}`,
  svg: '',
});
const TAUTOMERS: TautomerResult = {
  outcome: 'listed',
  stereoDropped: false,
  tautomers: [1, 2].map((n) => ({ ...card(n), smiles: `smiles ${n}`, hydrogens: [], kekule: [] })),
};
const RESONANCE: ResonanceResult = {
  outcome: 'listed',
  structures: [1, 2].map((n) => ({ ...card(n), bonds: [], charges: [], rank: '' })),
};
const LISTED: Record<FormsKind, FormsResult> = { tautomers: TAUTOMERS, resonance: RESONANCE };

/** A placement the test settles: `placed()` is a click, `putAway()` Esc or another tool;
 * `drop` runs the click's drawing change inside the panel's own-change marker. */
function heldPlacement(dropping: (drop: () => void) => void, change: () => void) {
  let settle: (placed: boolean) => void = () => {};
  let cancelled = 0;
  const placement: Placement = {
    done: new Promise((resolve) => (settle = resolve)),
    cancel: () => {
      cancelled += 1;
      settle(false);
    },
  };
  return {
    placement,
    placed: () => {
      dropping(change);
      settle(true);
    },
    putAway: () => settle(false),
    cancelled: () => cancelled,
  };
}

function harness(kind: FormsKind = 'tautomers', drawing: Drawing = STRUCTURE) {
  const sent: FormsRequest[] = [];
  const states: FormsState[] = [];
  const placements: { molfile: string; held: ReturnType<typeof heldPlacement> }[] = [];
  const waiting: ((state: FormsState) => void)[] = [];
  let ready: (() => void) | null = null;
  const forms = createForms(
    kind,
    () => drawing,
    (request) => sent.push(request),
    (state) => {
      states.push(state);
      waiting.splice(0).forEach((resolve) => resolve(state));
    },
    (molfile, dropping) => {
      const held = heldPlacement(dropping, () => forms.changed());
      placements.push({ molfile, held });
      // The structure is ready to be in hand when the test says so (readyPlacement).
      return new Promise((resolve) => (ready = () => resolve(held.placement)));
    },
  );
  const last = () => states.at(-1)!;
  const nextState = () => new Promise<FormsState>((resolve) => waiting.push(resolve));
  const answer = (result: FormsResult | null, id = sent.at(-1)!.id): FormsReply =>
    ({ kind, id, result }) as FormsReply;
  return { forms, sent, states, placements, last, answer, nextState, readyPlacement: () => ready!() };
}

describe.each(['tautomers', 'resonance'] as const)('%s: asking', (kind) => {
  it('sends the drawing, shows "working", then the answer', () => {
    const h = harness(kind);
    h.forms.show();
    expect(h.sent).toEqual([{ kind, id: 1, molfile: 'the drawing' }]);
    expect(h.last()).toEqual({ kind: 'working' });
    h.forms.reply(h.answer(LISTED[kind]));
    expect(h.last()).toEqual({ kind: 'ready', result: LISTED[kind], inHand: null, failedAdd: null });
  });

  it.each([['empty'], ['reaction'], ['not-elements'], ['unreadable']] as const)('%s: says so, sends nothing', (drawn) => {
    const h = harness(kind, { kind: drawn });
    h.forms.show();
    expect(h.sent).toEqual([]);
    expect(h.last()).toEqual({ kind: 'message', message: drawn });
  });

  it('an answer for an earlier drawing is never shown', () => {
    const h = harness(kind);
    h.forms.show();
    const first = h.sent[0].id;
    h.forms.changed(); // closes, and drops the answer on its way
    expect(h.last()).toEqual({ kind: 'idle' });
    h.forms.reply(h.answer(LISTED[kind], first));
    expect(h.last()).toEqual({ kind: 'idle' });
    h.forms.show();
    h.forms.reply(h.answer(LISTED[kind], first)); // still the old one
    expect(h.last()).toEqual({ kind: 'working' });
    h.forms.reply(h.answer(LISTED[kind]));
    expect(h.last()).toMatchObject({ kind: 'ready' });
  });

  it('the other panel’s answer, with the same id, is not this one’s', () => {
    const h = harness(kind);
    h.forms.show();
    const other: FormsKind = kind === 'tautomers' ? 'resonance' : 'tautomers';
    h.forms.reply({ kind: other, id: h.sent[0].id, result: null } as FormsReply);
    expect(h.last()).toEqual({ kind: 'working' });
  });

  it('RDKit failing to start, or failing on this drawing, is reported', () => {
    const h = harness(kind);
    h.forms.show();
    h.forms.reply({ failed: 'no wasm' });
    expect(h.last()).toEqual({ kind: 'message', message: 'unavailable', detail: 'RDKit could not start (no wasm)' });
    h.forms.show();
    expect(h.last()).toMatchObject({ kind: 'message', message: 'unavailable' });
    const g = harness(kind);
    g.forms.show();
    g.forms.reply({ kind, id: 1, error: 'a structure could not be drawn' });
    expect(g.last()).toEqual({ kind: 'message', message: 'unavailable', detail: 'a structure could not be drawn' });
    g.forms.show();
    g.forms.reply(g.answer(null));
    expect(g.last()).toEqual({ kind: 'message', message: 'unreadable' });
  });
});

describe('the Molfile Add places', () => {
  it('is the numbered structure’s, and there is none for a result that lists nothing', () => {
    expect(molfileOf(TAUTOMERS, 2)).toBe('molfile 2');
    expect(molfileOf(RESONANCE, 1)).toBe('molfile 1');
    expect(molfileOf(RESONANCE, 3)).toBeUndefined();
    expect(molfileOf({ outcome: 'counted', count: 40, capped: false }, 1)).toBeUndefined();
  });
});

describe.each(['tautomers', 'resonance'] as const)('%s: Add', (kind) => {
  async function inHand() {
    const h = harness(kind);
    h.forms.show();
    h.forms.reply(h.answer(LISTED[kind]));
    const added = h.forms.add(2);
    expect(h.last()).toMatchObject({ kind: 'ready', inHand: 2 });
    h.readyPlacement();
    await added;
    expect(h.placements.map((p) => p.molfile)).toEqual(['molfile 2']);
    return h;
  }

  it('one Ketcher can’t take is put down and reported, and Add works again', async () => {
    const sent: FormsRequest[] = [];
    const states: FormsState[] = [];
    let fail = true;
    const forms = createForms(
      kind,
      () => STRUCTURE,
      (request) => sent.push(request),
      (state) => states.push(state),
      () => (fail ? Promise.reject(new Error('Ketcher did not arm its paste tool')) : new Promise<Placement>(() => {})),
    );
    forms.show();
    forms.reply({ kind, id: sent[0].id, result: LISTED[kind] } as FormsReply);
    await forms.add(2);
    expect(states.at(-1)).toEqual({ kind: 'ready', result: LISTED[kind], inHand: null, failedAdd: 2 });
    fail = false;
    void forms.add(2);
    expect(states.at(-1)).toEqual({ kind: 'ready', result: LISTED[kind], inHand: 2, failedAdd: null });
  });

  it('placing it is the panel’s own change: the panel stays open, and another can follow', async () => {
    const h = await inHand();
    let next = h.nextState();
    h.placements[0].held.placed();
    expect(await next).toEqual({ kind: 'ready', result: LISTED[kind], inHand: null, failedAdd: null });
    const added = h.forms.add(1);
    h.readyPlacement();
    await added;
    next = h.nextState();
    h.placements[1].held.placed();
    expect(await next).toEqual({ kind: 'ready', result: LISTED[kind], inHand: null, failedAdd: null });
    expect(h.states.some((s) => s.kind === 'idle')).toBe(false);
  });

  it('put away (Esc, another tool): nothing changes, the panel stays open', async () => {
    const h = await inHand();
    const next = h.nextState();
    h.placements[0].held.putAway();
    expect(await next).toEqual({ kind: 'ready', result: LISTED[kind], inHand: null, failedAdd: null });
  });

  it('any other change while it is in hand puts it away and closes the panel', async () => {
    const h = await inHand();
    h.forms.changed(); // the student's own edit, e.g. Undo
    expect(h.placements[0].held.cancelled()).toBe(1);
    expect(h.last()).toEqual({ kind: 'idle' });
  });

  it('closing the panel while it is in hand puts it away', async () => {
    const h = await inHand();
    h.forms.close();
    expect(h.placements[0].held.cancelled()).toBe(1);
    expect(h.last()).toEqual({ kind: 'idle' });
  });

  it('a second Add puts the first away, and the second stays in hand', async () => {
    const h = await inHand();
    const added = h.forms.add(1);
    expect(h.placements[0].held.cancelled()).toBe(1);
    expect(h.last()).toMatchObject({ inHand: 1 });
    h.readyPlacement();
    await added;
    expect(h.last()).toMatchObject({ kind: 'ready', inHand: 1 });
    const next = h.nextState();
    h.placements[1].held.placed();
    expect(await next).toEqual({ kind: 'ready', result: LISTED[kind], inHand: null, failedAdd: null });
  });

  it('closed before the structure is in hand: it is put away as soon as it is ready', async () => {
    const h = harness(kind);
    h.forms.show();
    h.forms.reply(h.answer(LISTED[kind]));
    const added = h.forms.add(1);
    h.forms.close();
    h.readyPlacement();
    await added;
    expect(h.placements[0].held.cancelled()).toBe(1);
    expect(h.last()).toEqual({ kind: 'idle' });
  });
});
