// The stereoisomer panel's state (docs/plans/v2-stereoisomers.md), with no timers and no
// DOM, like the NMR preview's (nmr.ts): the student asks, the panels' RDKit worker answers,
// and any change to the drawing closes the panel and drops an answer still on its way,
// except the panel's own placements: Add puts a stereoisomer in hand (placeInHand.ts), and
// the click that places it is the panel's own change, so a student can place several. Every
// ordering is forced in stereo.test.ts by holding replies and placements; stereoStore.ts
// connects it to Ketcher, the worker and the canvas.
import type { StereoReply, StereoRequest, StereoResult } from '../chem/stereoPictures';
import type { Drawing } from '../chem/tracker';
import type { Placement } from '../editor/placeInHand';

export type StereoMessage = 'empty' | 'reaction' | 'not-elements' | 'unreadable' | 'unavailable';

export type StereoState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'message'; message: StereoMessage; detail?: string }
  /** inHand: the number of the stereoisomer following the mouse, if any. */
  | { kind: 'ready'; result: StereoResult; inHand: number | null };

/** Puts a Molfile in hand; `dropping` runs the click that places it (placeInHand.ts). */
export type Place = (molfile: string, dropping: (drop: () => void) => void) => Promise<Placement>;

export interface Stereo {
  /** List the stereoisomers of the drawing as it is now. */
  show(): void;
  /** A message from the panels' RDKit worker. */
  reply(message: StereoReply | { failed: string }): void;
  /** Ketcher's change event. */
  changed(): void;
  close(): void;
  /** Put stereoisomer `number` in hand; settles once it is in hand (or already put away). */
  add(number: number): Promise<void>;
}

export function createStereo(read: () => Drawing, send: (request: StereoRequest) => void, show: (state: StereoState) => void, place: Place): Stereo {
  let state: StereoState = { kind: 'idle' };
  let pending: number | null = null;
  let nextId = 1;
  let failed: string | null = null;
  let held: Placement | null = null;
  let adding = 0; // which Add is the latest (an older one's placement is put away)
  let placing = false; // the panel's own placement is changing the drawing

  const set = (next: StereoState) => {
    state = next;
    show(next);
  };
  const putAway = () => {
    adding += 1;
    const placement = held;
    held = null;
    placement?.cancel();
  };
  const ownChange = (drop: () => void) => {
    placing = true;
    try {
      drop();
    } finally {
      placing = false;
    }
  };

  const stereo: Stereo = {
    show() {
      putAway();
      pending = null;
      if (failed !== null) return set({ kind: 'message', message: 'unavailable', detail: failed });
      const drawing = read();
      if (drawing.kind !== 'structure') return set({ kind: 'message', message: drawing.kind });
      pending = nextId++;
      send({ kind: 'stereoisomers', id: pending, molfile: drawing.molfile });
      set({ kind: 'working' });
    },
    reply(message) {
      if ('failed' in message) {
        failed = `RDKit could not start (${message.failed})`;
        if (pending !== null) {
          pending = null;
          set({ kind: 'message', message: 'unavailable', detail: failed });
        }
        return;
      }
      if (message.id !== pending) return; // asked about an earlier drawing, or closed since
      pending = null;
      if ('error' in message) return set({ kind: 'message', message: 'unavailable', detail: message.error });
      if (message.result === null) return set({ kind: 'message', message: 'unreadable' });
      set({ kind: 'ready', result: message.result, inHand: null });
    },
    changed() {
      if (placing || state.kind === 'idle') return;
      stereo.close();
    },
    close() {
      putAway();
      pending = null;
      if (state.kind !== 'idle') set({ kind: 'idle' });
    },
    add(number) {
      if (state.kind !== 'ready' || state.result.outcome !== 'listed') return Promise.resolve();
      const isomer = state.result.stereoisomers.find((s) => s.number === number);
      if (!isomer) return Promise.resolve();
      putAway();
      const mine = adding;
      set({ ...state, inHand: number });
      return place(isomer.molfile, ownChange).then((placement) => {
        if (mine !== adding) {
          placement.cancel();
          return;
        }
        held = placement;
        void placement.done.then(() => {
          if (held !== placement) return;
          held = null;
          if (state.kind === 'ready') set({ ...state, inHand: null });
        });
      });
    },
  };
  return stereo;
}
