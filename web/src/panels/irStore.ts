import { useSyncExternalStore } from 'react';
import { IR_BANDS_FILE, readIrBands, type IrFile } from '../chem/irBands';

// The IR hints' state (IrHints.tsx): whether they are wanted, kept here so it stays ticked
// while the properties panel shows a message (an empty canvas) instead of the section; and
// the table, which the page fetches once, the first time the hints are shown, through the
// precache.

let shown = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setShown(next: boolean): void {
  shown = next;
  listeners.forEach((listener) => listener());
}

/** Whether the hints are wanted, and the setter for the checkbox. */
export function useIrShown(): [boolean, (next: boolean) => void] {
  return [useSyncExternalStore(subscribe, () => shown), setShown];
}

let table: Promise<IrFile> | null = null;

/** The table, fetched once, or why it can't be had. Never rejects. */
export function loadIrTable(): Promise<IrFile> {
  table ??= fetch(`${import.meta.env.BASE_URL}${IR_BANDS_FILE}`)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<unknown>;
    })
    .then(
      (file): IrFile => {
        const read = readIrBands(file);
        return read.kind === 'table' ? read : { kind: 'unavailable', reason: `${IR_BANDS_FILE} can't be used: ${read.reason}` };
      },
      (error: unknown): IrFile => ({ kind: 'unavailable', reason: `${IR_BANDS_FILE} could not be loaded (${String(error)})` }),
    );
  return table;
}
