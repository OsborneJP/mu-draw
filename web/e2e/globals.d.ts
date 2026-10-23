// The app exposes Ketcher on window (src/editor/KetcherEditor.tsx); tests call its API.
import type { Ketcher } from 'ketcher-core';

declare global {
  interface Window {
    ketcher?: Ketcher;
  }
}

export {};
