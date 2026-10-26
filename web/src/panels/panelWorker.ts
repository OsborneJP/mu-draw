// The RDKit worker copy the panels below the canvas share ('rdkit-nmr'): the ¹³C NMR preview,
// the stereoisomers, the tautomers and the resonance structures, one open at a time. It starts on the first request,
// so the properties panel's own copy never waits for either. Every reply goes to every
// listener; each takes its own kind, and all of them a {failed} (RDKit couldn't start).
import type { FormsReply, FormsRequest } from '../chem/formPictures';
import type { NmrReply, NmrRequest } from '../chem/nmr';
import { startRdkitWorker } from '../chem/rdkitWorkers';
import type { StereoReply, StereoRequest } from '../chem/stereoPictures';

export type PanelReply = NmrReply | StereoReply | FormsReply | { failed: string };

const listeners = new Set<(reply: PanelReply) => void>();
let worker: Worker | null = null;

export function postToPanelWorker(request: NmrRequest | StereoRequest | FormsRequest): void {
  if (!worker) {
    worker = startRdkitWorker('rdkit-nmr');
    worker.onmessage = (event: MessageEvent<PanelReply>) => listeners.forEach((listener) => listener(event.data));
    // The worker script didn't load or threw while starting.
    worker.onerror = (event) => {
      event.preventDefault();
      const failed = { failed: event.message || 'the RDKit worker did not start' };
      listeners.forEach((listener) => listener(failed));
    };
  }
  worker.postMessage(request);
}

export function listenToPanelWorker(listener: (reply: PanelReply) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
