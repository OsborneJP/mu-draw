// The 3D view's state (docs/plans/v2-3d-view.md), with no timers and no DOM, like the NMR
// preview's (nmr.ts): the student asks, the server answers with a model (src/api.ts,
// server/threed.py), and any change to the drawing makes the model stale and drops an answer
// still on its way. Every ordering is forced in threeD.test.ts by holding Ketcher's SMILES and
// the server's answer; threeDStore.ts connects it to Ketcher.
import type { ConformerOutcome, PubChemSaid } from '../api';
import type { Drawing } from '../chem/tracker';

export type ThreeDMessage =
  | 'empty'
  | 'reaction'
  | 'not-elements'
  | 'unreadable'
  | 'one-structure'
  | 'offline'
  | 'busy'
  | 'not-responding'
  | 'too-big'
  | 'no-model';

/** A model to show, as the server sent it. */
export interface ShownModel {
  molblock: string;
  source: 'pubchem' | 'rdkit';
  cid: number | null;
  pubchem: PubChemSaid;
  /** Stereo elements the drawing leaves undefined: the model shows one arrangement. */
  undefinedStereo: number;
}

export type ThreeDState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'message'; message: ThreeDMessage }
  | { kind: 'ready'; model: ShownModel }
  | { kind: 'stale' };

export const OFFLINE = 'Needs an internet connection';
export const ONE_SHAPE = 'One shape the molecule can take. Real molecules flex and rotate about single bonds.';

/** Where the model came from, in plain text (no link: the only link out is Get name's). */
export function sourceLine(model: ShownModel): string {
  if (model.source === 'pubchem') return `3D model from PubChem (CID ${model.cid}).`;
  switch (model.pubchem) {
    case 'unusable':
      return "3D model computed by RDKit: PubChem's model didn't match the drawing.";
    case 'no_answer':
      return '3D model computed by RDKit: PubChem did not answer.';
    default:
      return '3D model computed by RDKit: PubChem has none for this structure.';
  }
}

/** The note for a drawing that leaves stereo undefined (decision 7), or null. */
export function stereoNote(undefinedStereo: number): string | null {
  if (undefinedStereo === 0) return null;
  const places = undefinedStereo === 1 ? '1 place' : `${undefinedStereo} places`;
  return `Your drawing leaves the stereochemistry undefined at ${places}. This model shows one arrangement.`;
}

export interface ThreeDDeps {
  read: () => Drawing;
  /** The drawing's SMILES, as Get name sends it (Ketcher's getSmiles). */
  smiles: () => Promise<string>;
  online: () => boolean;
  request: (smiles: string, signal: AbortSignal) => Promise<ConformerOutcome>;
  show: (state: ThreeDState) => void;
}

export interface ThreeD {
  /** Ask for a model of the drawing as it is now (the button, and Show again); settles once
   * the answer is shown or dropped. */
  open(): Promise<void>;
  /** Ketcher's change event. */
  changed(): void;
  close(): void;
}

function shown(outcome: ConformerOutcome): ThreeDState {
  switch (outcome.kind) {
    case 'model': {
      const { molblock, source, cid, pubchem, undefinedStereo } = outcome;
      return { kind: 'ready', model: { molblock, source, cid, pubchem, undefinedStereo } };
    }
    case 'no-model':
      return { kind: 'message', message: outcome.reason === 'too_big' ? 'too-big' : 'no-model' };
    case 'invalid':
      return { kind: 'message', message: 'unreadable' };
    default:
      return { kind: 'message', message: outcome.kind };
  }
}

export function createThreeD({ read, smiles, online, request, show }: ThreeDDeps): ThreeD {
  let state: ThreeDState = { kind: 'idle' };
  // The request on its way; any other one's answer is dropped.
  let inFlight: AbortController | null = null;

  const set = (next: ThreeDState) => {
    state = next;
    show(next);
  };
  const drop = () => {
    inFlight?.abort();
    inFlight = null;
  };
  const ask = async (mine: AbortController) => {
    let text = '';
    try {
      text = await smiles();
    } catch {
      // Indigo couldn't write it: unreadable, below.
    }
    if (inFlight !== mine) return;
    // Two structures (a salt drawn as ions, a mixture): the server would refuse it too.
    const outcome: ConformerOutcome = !text
      ? { kind: 'invalid' }
      : text.includes('.')
        ? { kind: 'one-structure' }
        : await request(text, mine.signal);
    if (inFlight !== mine) return;
    inFlight = null;
    set(shown(outcome));
  };

  return {
    open() {
      drop();
      const drawing = read();
      if (drawing.kind !== 'structure') set({ kind: 'message', message: drawing.kind });
      else if (!online()) set({ kind: 'message', message: 'offline' });
      else {
        const mine = new AbortController();
        inFlight = mine;
        set({ kind: 'loading' });
        return ask(mine);
      }
      return Promise.resolve();
    },
    changed() {
      if (state.kind === 'idle' || state.kind === 'stale') return;
      drop();
      set({ kind: 'stale' });
    },
    close() {
      drop();
      if (state.kind !== 'idle') set({ kind: 'idle' });
    },
  };
}
