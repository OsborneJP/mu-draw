// Connects the tautomer and resonance panels' state (forms.ts) to Ketcher, the panels' RDKit
// worker (panelWorker.ts) and Add's placement (src/editor/placeInHand.ts). Each FormsPanel
// starts its own once Ketcher is ready; the properties panel's buttons ask for them.
import type { Ketcher } from 'ketcher-core';
import type { FormsKind } from '../chem/formPictures';
import { readDrawing } from '../editor/drawing';
import { placeInHand } from '../editor/placeInHand';
import { createForms, type Forms, type FormsState } from './forms';
import { listenToPanelWorker, postToPanelWorker } from './panelWorker';

interface Store {
  state: FormsState;
  current: Forms | null;
  listeners: Set<() => void>;
}

const stores: Record<FormsKind, Store> = {
  tautomers: { state: { kind: 'idle' }, current: null, listeners: new Set() },
  resonance: { state: { kind: 'idle' }, current: null, listeners: new Set() },
};

export function getFormsState(kind: FormsKind): FormsState {
  return stores[kind].state;
}

export function subscribeFormsState(kind: FormsKind, listener: () => void): () => void {
  stores[kind].listeners.add(listener);
  return () => stores[kind].listeners.delete(listener);
}

/** Run one panel on this Ketcher; returns what stops it. */
export function startForms(kind: FormsKind, ketcher: Ketcher): () => void {
  const store = stores[kind];
  const show = (next: FormsState) => {
    store.state = next;
    store.listeners.forEach((listener) => listener());
  };
  const forms = createForms(
    kind,
    () => readDrawing(ketcher),
    postToPanelWorker,
    show,
    (molfile, dropping) => placeInHand(ketcher, molfile, dropping),
  );
  const stopListening = listenToPanelWorker((reply) => {
    if ('failed' in reply || reply.kind === kind) forms.reply(reply);
  });
  const onChange = () => forms.changed();
  ketcher.changeEvent.add(onChange);
  store.current = forms;
  return () => {
    ketcher.changeEvent.remove(onChange);
    stopListening();
    forms.close();
    store.current = null;
  };
}

export function showForms(kind: FormsKind): void {
  stores[kind].current?.show();
}

export function closeForms(kind: FormsKind): void {
  stores[kind].current?.close();
}

export function addForm(kind: FormsKind, number: number): void {
  void stores[kind].current?.add(number);
}
