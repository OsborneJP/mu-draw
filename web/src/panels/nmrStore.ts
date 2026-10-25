// Connects the NMR preview's state (nmr.ts) to Ketcher, the panels' RDKit worker and the
// canvas. NmrPanel starts it once Ketcher is ready; the properties panel's button asks for a
// prediction. The worker (panelWorker.ts, a second copy of the RDKit worker, shared with the
// stereoisomer panel) starts on the first request. The selected peak's carbons are coloured on the canvas through the same
// highlight code as the stereo and functional-group highlights (not an edit), and the
// colour goes the moment the drawing changes, since a state change always removes it first.
import type { Action, Ketcher } from 'ketcher-core';
import { readDrawing } from '../editor/drawing';
import { addColoured, removeHighlight } from '../editor/stereoHighlight';
import { createNmr, PEAK_COLOR, type Nmr, type NmrState } from './nmr';
import { listenToPanelWorker, postToPanelWorker } from './panelWorker';

/** ketcher-react's editor has a selectionChange event; ketcher-core's Editor type doesn't
 * say so. */
interface SelectionEvents {
  event: { selectionChange: { add(handler: () => void): void; remove(handler: () => void): void } };
}

let state: NmrState = { kind: 'idle' };
let current: Nmr | null = null;
const listeners = new Set<() => void>();

export function getNmrState(): NmrState {
  return state;
}

export function subscribeNmrState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Run the preview on this Ketcher; returns what stops it. */
export function startNmr(ketcher: Ketcher): () => void {
  let colour: Action | null = null;
  const show = (next: NmrState) => {
    if (colour) removeHighlight(ketcher, colour);
    colour =
      next.kind === 'ready' && next.selected !== null
        ? addColoured(ketcher, [{ atoms: next.peaks[next.selected].atoms, bonds: [], color: PEAK_COLOR }])
        : null;
    state = next;
    listeners.forEach((listener) => listener());
  };
  const nmr = createNmr(() => readDrawing(ketcher), postToPanelWorker, show);
  const stopListening = listenToPanelWorker((reply) => {
    if ('failed' in reply || reply.kind === 'nmr') nmr.reply(reply);
  });
  const onChange = () => nmr.changed();
  const onSelection = () => nmr.selectAtoms(ketcher.editor.selection()?.atoms ?? []);
  const selection = (ketcher.editor as unknown as SelectionEvents).event.selectionChange;
  ketcher.changeEvent.add(onChange);
  selection.add(onSelection);
  current = nmr;
  return () => {
    ketcher.changeEvent.remove(onChange);
    selection.remove(onSelection);
    stopListening();
    nmr.close();
    current = null;
  };
}

export function predictNmr(): void {
  current?.predict();
}

export function closeNmr(): void {
  current?.close();
}

export function selectPeak(index: number): void {
  current?.select(index);
}
