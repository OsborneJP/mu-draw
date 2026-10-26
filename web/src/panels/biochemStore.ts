// Connects the biochem section (BiochemSection.tsx) to its worker (chem/biochemWorker.ts). The
// worker starts when the student first opens the section, so Indigo is loading while they
// type, and is sent Ketcher's monomer library first: the library is already in the main
// bundle (ketcher-core's macromolecules editor imports it), so the worker needn't carry a copy.
import library from 'ketcher-core/dist/application/editor/data/monomers.modern.js';
import type { BiochemMessage, BiochemReply, BiochemRequest } from '../chem/indigoBiochem';
import { createBiochem, DEFAULT_INPUTS, type BiochemState, type Inputs } from './biochem';

let worker: Worker | null = null;
let state: BiochemState = { kind: 'empty', inputs: DEFAULT_INPUTS };
const listeners = new Set<() => void>();

const biochem = createBiochem(
  (request: BiochemRequest) => post({ kind: 'compute', ...request }),
  (next) => {
    state = next;
    listeners.forEach((listener) => listener());
  },
);

function post(message: BiochemMessage): void {
  startBiochem();
  worker!.postMessage(message);
}

/** Start the worker (once). */
export function startBiochem(): void {
  if (worker) return;
  worker = new Worker(new URL('../chem/biochemWorker.ts', import.meta.url), { type: 'module', name: 'biochem' });
  worker.onmessage = (event: MessageEvent<BiochemReply>) => biochem.reply(event.data);
  // The worker script didn't load, or threw while starting.
  worker.onerror = (event) => {
    event.preventDefault();
    biochem.reply({ failed: event.message || 'the biochem worker did not start' });
  };
  worker.postMessage({ kind: 'library', library } satisfies BiochemMessage);
}

export function setBiochemInputs(inputs: Inputs): void {
  biochem.set(inputs);
}

export function getBiochemState(): BiochemState {
  return state;
}

export function subscribeBiochemState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
