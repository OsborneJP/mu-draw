// Autosave: the drawing is kept in this browser's localStorage, never uploaded, and put
// back when the app starts, so a refresh or relaunch (online or offline) loses nothing.
//
// - Format: KET, Ketcher's own JSON, which keeps everything on the canvas (text, arrows,
//   shapes, images, enhanced stereo). A Molfile would drop most of that.
// - localStorage, not IndexedDB: setItem has finished when it returns. Ketcher's getKet()
//   serializes in the page (no Indigo round trip), so the save made for a change is done
//   before a reload or close can start. An IndexedDB write could still be pending.
// - One key per base path: staging and production share an origin (and so a storage).

/** The parts of Ketcher that autosave uses (a fake in the unit tests). */
export interface AutosaveEditor {
  getKet(): Promise<string>;
  setMolecule(ket: string): Promise<unknown>;
  clearHistory(): void;
  onChange(handler: () => void): void;
}

export type SaveStatus = 'saved' | 'failed';

export function autosaveKey(base: string): string {
  return `autosave:${base}`;
}

function readSaved(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null; // storage switched off: start empty; saves will report the failure
  }
}

/** Put the saved drawing back, then save on every change. Resolves once changes are being
 * saved, with whether a drawing was restored. Never rejects. `storage` is a getter because
 * reading window.localStorage itself throws when the browser blocks storage. */
export async function startAutosave(
  editor: AutosaveEditor,
  storage: () => Storage,
  key: string,
  onStatus: (status: SaveStatus) => void,
): Promise<{ restored: boolean }> {
  // Restore before listening: loading the drawing is itself a change, and a change seen
  // before the restore would overwrite the saved drawing with an empty canvas.
  let restored = false;
  const saved = readSaved(storage, key);
  if (saved !== null) {
    try {
      await editor.setMolecule(saved);
      // Loading went into the undo history; Undo must not take the restored drawing away.
      editor.clearHistory();
      restored = true;
    } catch {
      // Unreadable (it would take a Ketcher upgrade): start empty. The next change
      // replaces it. (Ketcher 3.18's setMolecule reports load errors to its error handler
      // and resolves anyway; that ends the same way.)
    }
  }
  let latest = 0;
  editor.onChange(() => {
    const ticket = ++latest;
    editor.getKet().then(
      (ket) => {
        // Only the newest change is written, whichever serialization finishes first.
        if (ticket !== latest) return;
        try {
          storage().setItem(key, ket);
          onStatus('saved');
        } catch {
          // Usually the storage quota. The last good copy stays in storage.
          onStatus('failed');
        }
      },
      () => onStatus('failed'),
    );
  });
  return { restored };
}

// What the header shows: whether the last save worked.
let status: SaveStatus = 'saved';
const listeners = new Set<() => void>();

export function setSaveStatus(next: SaveStatus): void {
  if (next === status) return;
  status = next;
  listeners.forEach((listener) => listener());
}

export function getSaveStatus(): SaveStatus {
  return status;
}

export function subscribeSaveStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
