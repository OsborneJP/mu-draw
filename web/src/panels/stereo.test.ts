// The stereoisomer panel's state machine (stereo.ts), every ordering forced: the worker's
// replies and the placements are held until the test releases them.
import { describe, expect, it } from 'vitest';
import type { StereoReply, StereoRequest, StereoResult } from '../chem/stereoPictures';
import type { Drawing } from '../chem/tracker';
import type { Placement } from '../editor/placeInHand';
import { createStereo, type StereoState } from './stereo';

const STRUCTURE: Drawing = { kind: 'structure', molfile: 'the drawing', atomIds: [], badValence: 0 };

/** A listed result with two stereoisomers (their contents don't matter here). */
const LISTED: StereoResult = {
  outcome: 'listed',
  elements: 1,
  notes: [],
  stereoisomers: [1, 2].map((number) => ({
    number,
    inchikey: `key ${number}`,
    labels: { atoms: {}, bonds: {} },
    relation: { kind: 'enantiomer', of: 3 - number },
    matches: number === 1,
    molfile: `molfile ${number}`,
    picture: { svg: '', atomLabels: {}, labels: [] },
  })),
};

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

function harness(drawing: Drawing = STRUCTURE) {
  const sent: StereoRequest[] = [];
  const states: StereoState[] = [];
  const placements: { molfile: string; held: ReturnType<typeof heldPlacement> }[] = [];
  const waiting: ((state: StereoState) => void)[] = [];
  let ready: (() => void) | null = null;
  const stereo = createStereo(
    () => drawing,
    (request) => sent.push(request),
    (state) => {
      states.push(state);
      waiting.splice(0).forEach((resolve) => resolve(state));
    },
    (molfile, dropping) => {
      const held = heldPlacement(dropping, () => stereo.changed());
      placements.push({ molfile, held });
      // The structure is ready to be in hand when the test says so (readyPlacement).
      return new Promise((resolve) => (ready = () => resolve(held.placement)));
    },
  );
  const last = () => states.at(-1)!;
  /** The next state the panel shows. */
  const nextState = () => new Promise<StereoState>((resolve) => waiting.push(resolve));
  const answer = (result: StereoResult | null, id = sent.at(-1)!.id): StereoReply => ({ kind: 'stereoisomers', id, result });
  return { stereo, sent, states, placements, last, answer, nextState, readyPlacement: () => ready!() };
}

describe('asking', () => {
  it('sends the drawing, shows "working", then the answer', () => {
    const h = harness();
    h.stereo.show();
    expect(h.sent).toEqual([{ kind: 'stereoisomers', id: 1, molfile: 'the drawing' }]);
    expect(h.last()).toEqual({ kind: 'working' });
    h.stereo.reply(h.answer(LISTED));
    expect(h.last()).toEqual({ kind: 'ready', result: LISTED, inHand: null, failedAdd: null });
  });

  it.each([['empty'], ['reaction'], ['not-elements'], ['unreadable']] as const)('%s: says so, sends nothing', (kind) => {
    const h = harness({ kind });
    h.stereo.show();
    expect(h.sent).toEqual([]);
    expect(h.last()).toEqual({ kind: 'message', message: kind });
  });

  it('an answer for an earlier drawing is never shown', () => {
    const h = harness();
    h.stereo.show();
    const first = h.sent[0].id;
    h.stereo.changed(); // closes, and drops the answer on its way
    expect(h.last()).toEqual({ kind: 'idle' });
    h.stereo.reply(h.answer(LISTED, first));
    expect(h.last()).toEqual({ kind: 'idle' });
    h.stereo.show();
    h.stereo.reply(h.answer(LISTED, first)); // still the old one
    expect(h.last()).toEqual({ kind: 'working' });
    h.stereo.reply(h.answer(LISTED));
    expect(h.last()).toMatchObject({ kind: 'ready' });
  });

  it('RDKit failing to start, or failing on this drawing, is reported', () => {
    const h = harness();
    h.stereo.show();
    h.stereo.reply({ failed: 'no wasm' });
    expect(h.last()).toEqual({ kind: 'message', message: 'unavailable', detail: 'RDKit could not start (no wasm)' });
    h.stereo.show();
    expect(h.last()).toMatchObject({ kind: 'message', message: 'unavailable' });
    const g = harness();
    g.stereo.show();
    g.stereo.reply({ kind: 'stereoisomers', id: 1, error: 'a stereoisomer could not be drawn as itself' });
    expect(g.last()).toEqual({ kind: 'message', message: 'unavailable', detail: 'a stereoisomer could not be drawn as itself' });
    g.stereo.show();
    g.stereo.reply(g.answer(null));
    expect(g.last()).toEqual({ kind: 'message', message: 'unreadable' });
  });
});

describe('Add', () => {
  async function inHand() {
    const h = harness();
    h.stereo.show();
    h.stereo.reply(h.answer(LISTED));
    const added = h.stereo.add(2);
    expect(h.last()).toMatchObject({ kind: 'ready', inHand: 2 });
    h.readyPlacement();
    await added;
    expect(h.placements.map((p) => p.molfile)).toEqual(['molfile 2']);
    return h;
  }

  it('one that can’t be drawn flat is never put in hand', async () => {
    const h = harness();
    h.stereo.show();
    const [first, second] = (LISTED as Extract<StereoResult, { outcome: 'listed' }>).stereoisomers;
    const result: StereoResult = { ...LISTED, stereoisomers: [first, { ...second, molfile: null, picture: null }] } as StereoResult;
    h.stereo.reply(h.answer(result));
    await h.stereo.add(2);
    expect(h.placements).toEqual([]);
    expect(h.last()).toEqual({ kind: 'ready', result, inHand: null, failedAdd: null });
  });

  it('one Ketcher can’t take is put down and reported, and Add works again', async () => {
    const sent: StereoRequest[] = [];
    const states: StereoState[] = [];
    let fail = true;
    const stereo = createStereo(
      () => STRUCTURE,
      (request) => sent.push(request),
      (state) => states.push(state),
      () => (fail ? Promise.reject(new Error('Ketcher did not arm its paste tool')) : new Promise<Placement>(() => {})),
    );
    stereo.show();
    stereo.reply({ kind: 'stereoisomers', id: sent[0].id, result: LISTED });
    await stereo.add(2);
    expect(states.at(-1)).toEqual({ kind: 'ready', result: LISTED, inHand: null, failedAdd: 2 });
    fail = false;
    void stereo.add(2);
    expect(states.at(-1)).toEqual({ kind: 'ready', result: LISTED, inHand: 2, failedAdd: null });
  });

  it('placing it is the panel’s own change: the panel stays open, and another can follow', async () => {
    const h = await inHand();
    let next = h.nextState();
    h.placements[0].held.placed();
    expect(await next).toEqual({ kind: 'ready', result: LISTED, inHand: null, failedAdd: null });
    const added = h.stereo.add(1);
    h.readyPlacement();
    await added;
    next = h.nextState();
    h.placements[1].held.placed();
    expect(await next).toEqual({ kind: 'ready', result: LISTED, inHand: null, failedAdd: null });
    expect(h.states.some((s) => s.kind === 'idle')).toBe(false);
  });

  it('put away (Esc, another tool): nothing changes, the panel stays open', async () => {
    const h = await inHand();
    const next = h.nextState();
    h.placements[0].held.putAway();
    expect(await next).toEqual({ kind: 'ready', result: LISTED, inHand: null, failedAdd: null });
  });

  it('any other change while it is in hand puts it away and closes the panel', async () => {
    const h = await inHand();
    h.stereo.changed(); // the student's own edit, e.g. Undo
    expect(h.placements[0].held.cancelled()).toBe(1);
    expect(h.last()).toEqual({ kind: 'idle' });
  });

  it('closing the panel while it is in hand puts it away', async () => {
    const h = await inHand();
    h.stereo.close();
    expect(h.placements[0].held.cancelled()).toBe(1);
    expect(h.last()).toEqual({ kind: 'idle' });
  });

  it('a second Add puts the first away, and the second stays in hand', async () => {
    const h = await inHand();
    const added = h.stereo.add(1);
    expect(h.placements[0].held.cancelled()).toBe(1);
    expect(h.last()).toMatchObject({ inHand: 1 });
    h.readyPlacement();
    await added;
    // The first one, put away, must not mark the second as put away too.
    expect(h.last()).toMatchObject({ kind: 'ready', inHand: 1 });
    const next = h.nextState();
    h.placements[1].held.placed();
    expect(await next).toEqual({ kind: 'ready', result: LISTED, inHand: null, failedAdd: null });
  });

  it('closed before the structure is in hand: it is put away as soon as it is ready', async () => {
    const h = harness();
    h.stereo.show();
    h.stereo.reply(h.answer(LISTED));
    const added = h.stereo.add(1);
    h.stereo.close();
    h.readyPlacement();
    await added;
    expect(h.placements[0].held.cancelled()).toBe(1);
    expect(h.last()).toEqual({ kind: 'idle' });
  });
});
