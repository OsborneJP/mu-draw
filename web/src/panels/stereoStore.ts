// Connects the stereoisomer panel's state (stereo.ts) to Ketcher, the panels' RDKit worker
// (panelWorker.ts) and Add's placement (src/editor/placeInHand.ts). StereoPanel starts it
// once Ketcher is ready; the properties panel's button asks for the stereoisomers.
import type { Ketcher } from 'ketcher-core';
import { readDrawing } from '../editor/drawing';
import { placeInHand } from '../editor/placeInHand';
import { listenToPanelWorker, postToPanelWorker } from './panelWorker';
import { createStereo, type Stereo, type StereoState } from './stereo';

let state: StereoState = { kind: 'idle' };
let current: Stereo | null = null;
const listeners = new Set<() => void>();

export function getStereoState(): StereoState {
  return state;
}

export function subscribeStereoState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Run the panel on this Ketcher; returns what stops it. */
export function startStereo(ketcher: Ketcher): () => void {
  const show = (next: StereoState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const stereo = createStereo(
    () => readDrawing(ketcher),
    postToPanelWorker,
    show,
    (molfile, dropping) => placeInHand(ketcher, molfile, dropping),
  );
  const stopListening = listenToPanelWorker((reply) => {
    if ('failed' in reply || reply.kind === 'stereoisomers') stereo.reply(reply);
  });
  const onChange = () => stereo.changed();
  ketcher.changeEvent.add(onChange);
  current = stereo;
  return () => {
    ketcher.changeEvent.remove(onChange);
    stopListening();
    stereo.close();
    current = null;
  };
}

export function showStereoisomers(): void {
  current?.show();
}

export function closeStereoisomers(): void {
  current?.close();
}

export function addStereoisomer(number: number): void {
  void current?.add(number);
}
