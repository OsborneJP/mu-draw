// Autosave: the drawing is kept in this browser's localStorage, never uploaded, and put
// back when the app starts, so a refresh or relaunch (online or offline) loses nothing.
//
// - Format: KET, Ketcher's own JSON, which keeps everything on the canvas (text, arrows,
//   shapes, images, enhanced stereo). A Molfile would drop most of that.
// - localStorage, not IndexedDB: setItem has finished when it returns. Ketcher's getKet()
//   serializes in the page (no Indigo round trip), so the save made for a change is done
//   before a reload or close can start. An IndexedDB write could still be pending.
// - One key per base path: staging and production share an origin (and so a storage).
// - Two copies under that key (docs/plans/v1-release.md, review rounds 1 and 2): one in
//   localStorage, which every window of the app shares and where the last save wins, and the
//   window's own in sessionStorage, which the browser keeps across the window's reloads and
//   drops when it closes. A window starts from its own copy when it has one (a reload, the
//   update banner's Reload), else from the shared one (a launch, a new window), which then
//   becomes its own. So a reload brings back the window's own drawing, a launch the last one
//   changed in any window, and nothing is written as a window closes.

/** The parts of Ketcher that autosave uses (a fake in the unit tests). */
export interface AutosaveEditor {
  getKet(): Promise<string>;
  setMolecule(ket: string): Promise<unknown>;
  clearHistory(): void;
  onChange(handler: () => void): void;
}

export type SaveStatus = 'saved' | 'failed';

/** The copy a window started from: its own (a reload), or the one every window shares. */
export type Copy = 'own' | 'shared';

export function autosaveKey(base: string): string {
  return `autosave:${base}`;
}

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null; // storage switched off: start empty; saves will report the failure
  }
}

/** Make `value` this window's own copy, or remove it (null). If it can't be written, the own
 * copy goes, so a reload takes the shared one rather than an older own one. */
export function keepOwn(own: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) own().removeItem(key);
    else own().setItem(key, value);
  } catch {
    try {
      own().removeItem(key);
    } catch {
      // Storage switched off: there is no own copy to go back to.
    }
  }
}

/** Put this window's drawing back, then save on every change. Resolves once changes are being
 * saved, with whether a drawing was restored and from which copy. Never rejects. `shared` and
 * `own` are getters (localStorage and sessionStorage) because reading window.localStorage
 * itself throws when the browser blocks storage. */
export async function startAutosave(
  editor: AutosaveEditor,
  shared: () => Storage,
  own: () => Storage,
  key: string,
  onStatus: (status: SaveStatus) => void,
): Promise<{ restored: boolean; from: Copy }> {
  // Restore before listening: loading the drawing is itself a change, and a change seen
  // before the restore would overwrite the saved drawing with an empty canvas.
  let restored = false;
  const mine = read(own, key);
  const from: Copy = mine === null ? 'shared' : 'own';
  // An empty canvas's own copy is '' (getKet never gives that).
  const saved = mine ?? read(shared, key);
  if (saved) {
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
  if (from === 'shared') keepOwn(own, key, saved ?? '');
  let latest = 0;
  editor.onChange(() => {
    const ticket = ++latest;
    editor.getKet().then(
      (ket) => {
        // Only the newest change is written, whichever serialization finishes first.
        if (ticket !== latest) return;
        let stored = true;
        try {
          shared().setItem(key, ket);
        } catch {
          // Usually the storage quota. The last good copy stays in storage.
          stored = false;
        }
        keepOwn(own, key, ket);
        onStatus(stored ? 'saved' : 'failed');
      },
      () => onStatus('failed'),
    );
  });
  return { restored, from };
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
