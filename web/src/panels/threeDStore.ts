// Connects the 3D view's state (threeD.ts) to Ketcher and the server (src/api.ts). ThreeDPanel
// starts it once Ketcher is ready; the properties panel's button opens it.
import type { Ketcher } from 'ketcher-core';
import { requestConformer } from '../api';
import { readDrawing } from '../editor/drawing';
import { createThreeD, type ThreeD, type ThreeDState } from './threeD';

let state: ThreeDState = { kind: 'idle' };
let current: ThreeD | null = null;
const listeners = new Set<() => void>();

export function getThreeDState(): ThreeDState {
  return state;
}

export function subscribeThreeDState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Run the 3D view on this Ketcher; returns what stops it. */
export function startThreeD(ketcher: Ketcher): () => void {
  const threeD = createThreeD({
    read: () => readDrawing(ketcher),
    smiles: () => ketcher.getSmiles(),
    online: () => navigator.onLine,
    request: requestConformer,
    show: (next) => {
      state = next;
      listeners.forEach((listener) => listener());
    },
  });
  const onChange = () => threeD.changed();
  ketcher.changeEvent.add(onChange);
  current = threeD;
  return () => {
    ketcher.changeEvent.remove(onChange);
    threeD.close();
    current = null;
  };
}

export function openThreeD(): void {
  void current?.open();
}

export function closeThreeD(): void {
  current?.close();
}
