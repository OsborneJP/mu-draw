// Connects the ¹H NMR preview's state (protonNmr.ts) to Ketcher, the panels' RDKit worker
// and the canvas, as nmrStore.ts does for ¹³C. ProtonNmrPanel starts it once Ketcher is
// ready; the properties panel's button asks for a prediction. The worker answers both
// previews, so only its ¹H replies (and {failed}) come here. The selected signal's atoms are
// coloured through the same highlight code as the other highlights (not an edit), and the
// colour goes the moment the drawing changes, since a state change always removes it first.
import type { Action, Ketcher } from 'ketcher-core';
import { readDrawing } from '../editor/drawing';
import { addColoured, removeHighlight } from '../editor/stereoHighlight';
import { PEAK_COLOR } from './nmr';
import { listenToPanelWorker, postToPanelWorker } from './panelWorker';
import { createProton, type Proton, type ProtonState } from './protonNmr';

/** ketcher-react's editor has a selectionChange event; ketcher-core's Editor type doesn't
 * say so. */
interface SelectionEvents {
  event: { selectionChange: { add(handler: () => void): void; remove(handler: () => void): void } };
}

let state: ProtonState = { kind: 'idle' };
let current: Proton | null = null;
const listeners = new Set<() => void>();

export function getProtonState(): ProtonState {
  return state;
}

export function subscribeProtonState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Run the preview on this Ketcher; returns what stops it. */
export function startProton(ketcher: Ketcher): () => void {
  let colour: Action | null = null;
  const show = (next: ProtonState) => {
    if (colour) removeHighlight(ketcher, colour);
    colour =
      next.kind === 'ready' && next.selected !== null
        ? addColoured(ketcher, [{ atoms: next.signals[next.selected].atoms, bonds: [], color: PEAK_COLOR }])
        : null;
    state = next;
    listeners.forEach((listener) => listener());
  };
  const proton = createProton(() => readDrawing(ketcher), postToPanelWorker, show);
  const stopListening = listenToPanelWorker((reply) => {
    if ('failed' in reply || reply.kind === 'proton') proton.reply(reply);
  });
  const onChange = () => proton.changed();
  const onSelection = () => proton.selectAtoms(ketcher.editor.selection()?.atoms ?? []);
  const selection = (ketcher.editor as unknown as SelectionEvents).event.selectionChange;
  ketcher.changeEvent.add(onChange);
  selection.add(onSelection);
  current = proton;
  return () => {
    ketcher.changeEvent.remove(onChange);
    selection.remove(onSelection);
    stopListening();
    proton.close();
    current = null;
  };
}

export function predictProtonNmr(): void {
  current?.predict();
}

export function closeProton(): void {
  current?.close();
}

export function selectSignal(index: number): void {
  current?.select(index);
}
