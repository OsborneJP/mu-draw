import { describe, expect, it } from 'vitest';
import { autosaveKey, startAutosave, type AutosaveEditor, type SaveStatus } from './autosave';

// Any base path will do here; e2e/autosave.spec.ts checks the real one.
const KEY = autosaveKey('/one/');

/** A Map behind the Storage methods autosave uses; setItem can be made to fail. */
class FakeStorage {
  items = new Map<string, string>();
  refuse = false;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.refuse) throw new DOMException('quota', 'QuotaExceededError');
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  asStorage(): () => Storage {
    return () => this as unknown as Storage;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Ketcher stand-in: `canvas` is what getKet() serializes; every load or edit is a change. */
class FakeEditor implements AutosaveEditor {
  canvas = '';
  calls: string[] = [];
  handlers: (() => void)[] = [];
  loading: ReturnType<typeof deferred<void>> | null = null;
  pendingKets: ReturnType<typeof deferred<string>>[] | null = null;

  getKet(): Promise<string> {
    if (this.pendingKets) {
      const next = deferred<string>();
      this.pendingKets.push(next);
      return next.promise;
    }
    return Promise.resolve(this.canvas);
  }
  async setMolecule(ket: string): Promise<void> {
    this.calls.push(`setMolecule ${ket}`);
    if (this.loading) await this.loading.promise;
    this.canvas = ket;
    this.change();
  }
  clearHistory(): void {
    this.calls.push('clearHistory');
  }
  onChange(handler: () => void): void {
    this.calls.push('onChange');
    this.handlers.push(handler);
  }
  /** A student's edit, or Ketcher's own change event. */
  change(): void {
    this.handlers.forEach((handler) => handler());
  }
  async edit(canvas: string): Promise<void> {
    this.canvas = canvas;
    this.change();
    await Promise.resolve(); // getKet's promise settles
  }
}

describe('autosave', () => {
  it('restores the saved drawing, clears its undo step, then saves every change', async () => {
    const storage = new FakeStorage();
    storage.items.set(KEY, 'saved drawing');
    const editor = new FakeEditor();
    const statuses: SaveStatus[] = [];

    expect(await startAutosave(editor, storage.asStorage(), new FakeStorage().asStorage(), KEY, (s) => statuses.push(s))).toEqual({
      restored: true,
      from: 'shared',
    });
    expect(editor.calls).toEqual(['setMolecule saved drawing', 'clearHistory', 'onChange']);
    expect(editor.canvas).toBe('saved drawing');

    await editor.edit('edited drawing');
    expect(storage.items.get(KEY)).toBe('edited drawing');
    expect(statuses).toEqual(['saved']);
  });

  it('never saves a change made while the saved drawing is still loading', async () => {
    const storage = new FakeStorage();
    storage.items.set(KEY, 'saved drawing');
    const editor = new FakeEditor();
    editor.loading = deferred<void>();
    const started = startAutosave(editor, storage.asStorage(), new FakeStorage().asStorage(), KEY, () => {});

    // Ketcher reports a change while the canvas is still empty.
    await editor.edit('');
    expect(storage.items.get(KEY)).toBe('saved drawing');

    editor.loading.resolve();
    await started;
    expect(storage.items.get(KEY)).toBe('saved drawing');
    expect(editor.canvas).toBe('saved drawing');
  });

  it('with nothing saved, starts empty and saves the first change', async () => {
    const storage = new FakeStorage();
    const editor = new FakeEditor();
    expect(await startAutosave(editor, storage.asStorage(), new FakeStorage().asStorage(), KEY, () => {})).toEqual({ restored: false, from: 'shared' });
    expect(editor.calls).toEqual(['onChange']);
    await editor.edit('first drawing');
    expect(storage.items.get(KEY)).toBe('first drawing');
  });

  it('keeps the newest change, whichever serialization finishes first', async () => {
    for (const order of [
      [1, 0],
      [0, 1],
    ]) {
      const storage = new FakeStorage();
      const editor = new FakeEditor();
      await startAutosave(editor, storage.asStorage(), new FakeStorage().asStorage(), KEY, () => {});
      editor.pendingKets = [];
      editor.change();
      editor.change();
      const values = ['older', 'newer'];
      for (const i of order) {
        editor.pendingKets[i].resolve(values[i]);
        await Promise.resolve();
      }
      expect(storage.items.get(KEY), `resolved in order ${order.join(',')}`).toBe('newer');
    }
  });

  it('keeps drawings for different base paths apart (staging and production share an origin)', async () => {
    const otherKey = autosaveKey('/two/');
    expect(otherKey).not.toBe(KEY);

    const storage = new FakeStorage();
    storage.items.set(KEY, 'drawing at /one/');
    const other = new FakeEditor();
    expect(await startAutosave(other, storage.asStorage(), new FakeStorage().asStorage(), otherKey, () => {})).toEqual({ restored: false, from: 'shared' });
    await other.edit('drawing at /two/');
    expect(storage.items.get(KEY)).toBe('drawing at /one/');
  });

  it('when the browser refuses to store a change, keeps the last copy and says so', async () => {
    const storage = new FakeStorage();
    const editor = new FakeEditor();
    const statuses: SaveStatus[] = [];
    await startAutosave(editor, storage.asStorage(), new FakeStorage().asStorage(), KEY, (s) => statuses.push(s));
    await editor.edit('small drawing');
    storage.refuse = true;
    await editor.edit('huge drawing');
    expect(storage.items.get(KEY)).toBe('small drawing');
    expect(statuses).toEqual(['saved', 'failed']);

    storage.refuse = false;
    await editor.edit('smaller again');
    expect(storage.items.get(KEY)).toBe('smaller again');
    expect(statuses).toEqual(['saved', 'failed', 'saved']);
  });

  it('starts empty, and keeps saving, if the saved drawing cannot be loaded', async () => {
    const storage = new FakeStorage();
    storage.items.set(KEY, 'unreadable');
    const editor = new FakeEditor();
    editor.setMolecule = async (ket) => {
      editor.calls.push(`setMolecule ${ket}`);
      throw new Error('cannot parse');
    };
    expect(await startAutosave(editor, storage.asStorage(), new FakeStorage().asStorage(), KEY, () => {})).toEqual({ restored: false, from: 'shared' });
    expect(editor.calls).toEqual(['setMolecule unreadable', 'onChange']);
    await editor.edit('new drawing');
    expect(storage.items.get(KEY)).toBe('new drawing');
  });

  it("a reload brings back this window's own drawing, a new window the last one saved", async () => {
    // Every window shares one copy, where the last save wins; each also keeps its own.
    const shared = new FakeStorage();
    shared.items.set(KEY, 'drawing X');
    const [firstOwn, secondOwn] = [new FakeStorage(), new FakeStorage()];
    const open = async (own: FakeStorage) => {
      const editor = new FakeEditor();
      const started = await startAutosave(editor, shared.asStorage(), own.asStorage(), KEY, () => {});
      return { editor, started };
    };
    expect((await open(firstOwn)).started).toEqual({ restored: true, from: 'shared' });
    const second = await open(secondOwn);
    await second.editor.edit('drawing Y');
    expect(shared.getItem(KEY)).toBe('drawing Y');
    // The first, idle, reloads (the update banner's Reload, say): its own drawing.
    const first = await open(firstOwn);
    expect(first.started).toEqual({ restored: true, from: 'own' });
    expect(first.editor.canvas).toBe('drawing X');
    // The second its own; a new window, or the next launch, the last one saved.
    expect((await open(secondOwn)).editor.canvas).toBe('drawing Y');
    expect((await open(new FakeStorage())).editor.canvas).toBe('drawing Y');
  });

  it('a window that started empty reloads empty, whatever another window saved since', async () => {
    const [shared, own] = [new FakeStorage(), new FakeStorage()];
    await startAutosave(new FakeEditor(), shared.asStorage(), own.asStorage(), KEY, () => {});
    shared.items.set(KEY, "another window's drawing");
    const reloaded = new FakeEditor();
    expect(await startAutosave(reloaded, shared.asStorage(), own.asStorage(), KEY, () => {})).toEqual({ restored: false, from: 'own' });
    expect(reloaded.calls).toEqual(['onChange']);
  });

  it("drops the window's own copy when the browser refuses to update it, so a reload takes the shared one", async () => {
    const [shared, own] = [new FakeStorage(), new FakeStorage()];
    const editor = new FakeEditor();
    const statuses: SaveStatus[] = [];
    await startAutosave(editor, shared.asStorage(), own.asStorage(), KEY, (s) => statuses.push(s));
    await editor.edit('small drawing');
    expect(own.getItem(KEY)).toBe('small drawing');
    own.refuse = true;
    await editor.edit('larger drawing');
    expect(own.getItem(KEY)).toBeNull();
    // Saved: the shared copy, which the next launch takes, has it.
    expect(statuses).toEqual(['saved', 'saved']);
    own.refuse = false;
    const reloaded = new FakeEditor();
    expect(await startAutosave(reloaded, shared.asStorage(), own.asStorage(), KEY, () => {})).toEqual({ restored: true, from: 'shared' });
    expect(reloaded.canvas).toBe('larger drawing');
  });

  it('works from the shared copy alone when the window can have none of its own', async () => {
    const shared = new FakeStorage();
    shared.items.set(KEY, 'saved drawing');
    const editor = new FakeEditor();
    const statuses: SaveStatus[] = [];
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    expect(await startAutosave(editor, shared.asStorage(), blocked, KEY, (s) => statuses.push(s))).toEqual({ restored: true, from: 'shared' });
    await editor.edit('edited drawing');
    expect(shared.getItem(KEY)).toBe('edited drawing');
    expect(statuses).toEqual(['saved']);
  });

  it('starts empty, and reports failed saves, when the browser blocks storage', async () => {
    const editor = new FakeEditor();
    const statuses: SaveStatus[] = [];
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    expect(await startAutosave(editor, blocked, blocked, KEY, (s) => statuses.push(s))).toEqual({ restored: false, from: 'shared' });
    await editor.edit('drawing');
    expect(statuses).toEqual(['failed']);
  });
});
