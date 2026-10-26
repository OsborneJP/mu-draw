// The tautomer and resonance panels' state (docs/plans/v2-tautomers-resonance.md), one machine
// for each, built as the stereoisomer panel's (stereo.ts), with no timers and no DOM: the
// student asks, the panels' RDKit worker answers, and any change to the drawing closes the
// panel and drops an answer still on its way, except the panel's own placements: Add puts a
// structure in hand (placeInHand.ts), and the click that places it is the panel's own change,
// so a student can place several. Every ordering is forced in forms.test.ts by holding replies
// and placements; formsStore.ts connects it to Ketcher, the worker and the canvas.
import type { FormsKind, FormsReply, FormsRequest, ResonanceResult, TautomerResult } from '../chem/formPictures';
import type { Drawing } from '../chem/tracker';
import type { Placement } from '../editor/placeInHand';

export type FormsResult = TautomerResult | ResonanceResult;

export type FormsMessage = 'empty' | 'reaction' | 'not-elements' | 'unreadable' | 'unavailable';

export type FormsState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'message'; message: FormsMessage; detail?: string }
  /** inHand: the number of the structure following the mouse, if any; failedAdd: one that
   * Ketcher could not take (the last Add failed). */
  | { kind: 'ready'; result: FormsResult; inHand: number | null; failedAdd: number | null };

/** Puts a Molfile in hand; `dropping` runs the click that places it (placeInHand.ts). */
export type Place = (molfile: string, dropping: (drop: () => void) => void) => Promise<Placement>;

export interface Forms {
  /** List the drawing's tautomers or resonance structures as it is now. */
  show(): void;
  /** A message from the panels' RDKit worker. */
  reply(message: FormsReply | { failed: string }): void;
  /** Ketcher's change event. */
  changed(): void;
  close(): void;
  /** Put structure `number` in hand; settles once it is in hand (or already put away). */
  add(number: number): Promise<void>;
}

/** The Molfile Add places for structure `number` of a listed result. */
export function molfileOf(result: FormsResult, number: number): string | undefined {
  if (result.outcome !== 'listed') return undefined;
  const listed = 'tautomers' in result ? result.tautomers : result.structures;
  return listed.find((s) => s.number === number)?.molfile;
}

export function createForms(
  kind: FormsKind,
  read: () => Drawing,
  send: (request: FormsRequest) => void,
  show: (state: FormsState) => void,
  place: Place,
): Forms {
  let state: FormsState = { kind: 'idle' };
  let pending: number | null = null;
  let nextId = 1;
  let failed: string | null = null;
  let held: Placement | null = null;
  let adding = 0; // which Add is the latest (an older one's placement is put away)
  let placing = false; // the panel's own placement is changing the drawing

  const set = (next: FormsState) => {
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

  const forms: Forms = {
    show() {
      putAway();
      pending = null;
      if (failed !== null) return set({ kind: 'message', message: 'unavailable', detail: failed });
      const drawing = read();
      if (drawing.kind !== 'structure') return set({ kind: 'message', message: drawing.kind });
      pending = nextId++;
      send({ kind, id: pending, molfile: drawing.molfile });
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
      if (message.kind !== kind || message.id !== pending) return; // another panel's, or an earlier drawing's
      pending = null;
      if ('error' in message) return set({ kind: 'message', message: 'unavailable', detail: message.error });
      if (message.result === null) return set({ kind: 'message', message: 'unreadable' });
      set({ kind: 'ready', result: message.result, inHand: null, failedAdd: null });
    },
    changed() {
      if (placing || state.kind === 'idle') return;
      forms.close();
    },
    close() {
      putAway();
      pending = null;
      if (state.kind !== 'idle') set({ kind: 'idle' });
    },
    add(number) {
      if (state.kind !== 'ready') return Promise.resolve();
      const molfile = molfileOf(state.result, number);
      if (!molfile) return Promise.resolve();
      putAway();
      const mine = adding;
      set({ ...state, inHand: number, failedAdd: null });
      return place(molfile, ownChange).then(
        (placement) => {
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
        },
        // Ketcher couldn't take it (its paste tool, or Indigo reading the Molfile): say so,
        // rather than leave the card saying it is in hand.
        () => {
          if (mine === adding && state.kind === 'ready') set({ ...state, inHand: null, failedAdd: number });
        },
      );
    },
  };
  return forms;
}
