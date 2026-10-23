import type { Ketcher } from 'ketcher-core';

// The editor's Ketcher, set once the last drawing is back on the canvas and autosave runs
// (KetcherEditor.tsx). Copy image and Export stay disabled until then.
let current: Ketcher | null = null;
const listeners = new Set<() => void>();

export function setKetcher(ketcher: Ketcher): void {
  current = ketcher;
  listeners.forEach((listener) => listener());
}

export function getKetcher(): Ketcher | null {
  return current;
}

export function subscribeKetcher(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
