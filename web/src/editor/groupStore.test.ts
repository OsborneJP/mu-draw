// The groups' Ketcher glue (groupStore.ts) on a fake Ketcher: its selection, its events and
// its struct, so each ordering is forced (a change event while the selection is widened, a
// drawing loaded afresh, a relaunch) and storage can fail.
import type { Ketcher } from 'ketcher-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from './groups';

type Store = typeof import('./groupStore');
let store: Store;

beforeEach(async () => {
  vi.resetModules(); // the store keeps one Ketcher's groups
  store = await import('./groupStore');
});

const KEY = 'groups:/test/';

/** Two molecules (atoms 0-1 and 2-3, each bonded) and one text, at fixed points. */
function drawing(order: 'as drawn' | 'second molecule first' = 'as drawn') {
  const first = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  const second = [{ x: 0, y: 5 }, { x: 1, y: 5 }];
  const atoms = order === 'as drawn' ? [...first, ...second] : [...second, ...first];
  return {
    atoms: new Map(atoms.map((pp, id) => [id, { pp }])),
    bonds: new Map([
      [0, { begin: 0, end: 1 }],
      [1, { begin: 2, end: 3 }],
    ]),
    texts: new Map([[0, { position: { x: 4, y: 4 } }]]),
    rxnArrows: new Map(),
    rxnPluses: new Map(),
    simpleObjects: new Map(),
    images: new Map(),
    multitailArrows: new Map(),
  };
}

type Drawing = ReturnType<typeof drawing>;

/** A fake Ketcher: setting the selection fires selectionChange (Ketcher's pipeline event), as
 * Ketcher's does. `beforeSelectionEvent` runs as each selection is set, before the event. */
function fakeKetcher(start: Drawing) {
  const onSelection: ((value: unknown) => unknown)[] = [];
  const onFloatingTools: ((payload: { visible?: boolean }) => void)[] = [];
  const onChange: (() => void)[] = [];
  let current: Selection | null = null;
  const fake = {
    drawing: start,
    handedOn: [] as unknown[],
    beforeSelectionEvent: (() => {}) as (selection: Selection | null) => void,
    change: () => onChange.forEach((handler) => handler()),
    floatingTools: (payload: { visible?: boolean }) => onFloatingTools.forEach((handler) => handler(payload)),
    selection: (next?: Selection | null) => {
      if (next === undefined) return current;
      current = next;
      fake.beforeSelectionEvent(next);
      fake.handedOn.push(onSelection.reduce<unknown>((value, handler) => handler(value), next));
      return current;
    },
  };
  const ketcher = {
    editor: {
      struct: () => fake.drawing,
      selection: fake.selection,
      event: {
        selectionChange: { add: (handler: (value: unknown) => unknown) => onSelection.push(handler) },
        updateFloatingTools: { add: (handler: (payload: { visible?: boolean }) => void) => onFloatingTools.push(handler) },
      },
    },
    changeEvent: { add: (handler: () => void) => onChange.push(handler) },
  } as unknown as Ketcher;
  return { fake, ketcher };
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
    key: (i) => [...items.keys()][i] ?? null,
    get length() {
      return items.size;
    },
  };
}

const WHOLE = { atoms: [0, 1, 2, 3], bonds: [0, 1], texts: [0] };

/** A selection without its empty lists (the store writes some, Ketcher reads none). */
function tidy(selection: unknown) {
  return Object.fromEntries(Object.entries((selection ?? {}) as Selection).filter(([, ids]) => ids.length > 0));
}

/** Start the store on a fake Ketcher and group both molecules and the text. */
function grouped(storage: Storage = memoryStorage()) {
  const { fake, ketcher } = fakeKetcher(drawing());
  store.startGroups(ketcher, () => storage, KEY);
  fake.selection({ atoms: [0, 2], texts: [0] });
  expect(store.getGroupState().offer).toBe('group');
  store.groupSelection();
  expect(tidy(fake.selection())).toEqual(WHOLE);
  expect(store.getGroupState().offer).toBe('ungroup');
  return { fake, storage };
}

describe('the store on a Ketcher', () => {
  it('widens a click on one member to the group, and hands the selection event on unchanged', () => {
    const { fake } = grouped();
    fake.selection(null);
    expect(store.getGroupState().offer).toBeNull();
    fake.handedOn.length = 0;
    fake.selection({ atoms: [3] });
    expect(tidy(fake.selection())).toEqual(WHOLE);
    expect(store.getGroupState().offer).toBe('ungroup');
    // Ketcher's event is a pipeline: each handler passes on what it was given.
    expect(fake.handedOn.map(tidy)).toEqual([WHOLE, { atoms: [3] }]);
  });

  it('keeps the group whole when a change event arrives while the selection is being widened', () => {
    const { fake } = grouped();
    fake.selection(null);
    let changes = 0;
    fake.beforeSelectionEvent = (selection) => {
      if ((selection?.atoms ?? []).length > 1) {
        changes++;
        fake.change();
      }
    };
    fake.selection({ atoms: [1] });
    expect(changes).toBe(1);
    expect(tidy(fake.selection())).toEqual(WHOLE);
    expect(store.getGroupState().offer).toBe('ungroup');
  });

  it('ungroups: a click then picks up only what it is on', () => {
    const { fake } = grouped();
    store.ungroupSelection();
    expect(store.getGroupState().offer).toBe('group');
    fake.selection({ atoms: [3] });
    expect(tidy(fake.selection())).toEqual({ atoms: [3] });
    expect(store.getGroupState().offer).toBeNull();
  });

  it('keeps a group through changes to the drawing, and through a delete and its Undo', () => {
    const { fake } = grouped();
    fake.drawing.texts.delete(0);
    fake.change();
    fake.selection({ atoms: [0] });
    expect(tidy(fake.selection())).toEqual({ atoms: WHOLE.atoms, bonds: WHOLE.bonds });
    // One molecule left: the group does nothing.
    const gone = { atoms: [2, 3].map((id) => [id, fake.drawing.atoms.get(id)!] as const), bond: fake.drawing.bonds.get(1)! };
    for (const id of [2, 3]) fake.drawing.atoms.delete(id);
    fake.drawing.bonds.delete(1);
    fake.change();
    fake.selection({ atoms: [0] });
    expect(tidy(fake.selection())).toEqual({ atoms: [0] });
    expect(store.getGroupState().offer).toBeNull();
    // Undo brings them back under the same ids, and the group with them.
    for (const [id, atom] of gone.atoms) fake.drawing.atoms.set(id, atom);
    fake.drawing.bonds.set(1, gone.bond);
    fake.drawing.texts.set(0, { position: { x: 4, y: 4 } });
    fake.change();
    fake.selection({ atoms: [0] });
    expect(tidy(fake.selection())).toEqual(WHOLE);
  });

  it('ends the groups when a drawing is loaded afresh, even with the same ids', () => {
    const { fake, storage } = grouped();
    fake.drawing = drawing();
    fake.change();
    fake.selection({ atoms: [0] });
    expect(tidy(fake.selection())).toEqual({ atoms: [0] });
    expect(storage.getItem(KEY)).toBeNull();
    // Groups made on the new drawing last through its changes.
    fake.selection({ atoms: [0, 2] });
    store.groupSelection();
    fake.change();
    fake.selection({ atoms: [0] });
    expect(tidy(fake.selection())).toEqual({ atoms: WHOLE.atoms, bonds: WHOLE.bonds });
  });

  it('saves the groups beside the drawing and finds them again after a relaunch, under new ids', async () => {
    const { storage } = grouped();
    vi.resetModules();
    store = await import('./groupStore');
    // Relaunched: the same drawing, numbered in another order.
    const { fake, ketcher } = fakeKetcher(drawing('second molecule first'));
    // Ketcher has put back the selection saved with the drawing: part of the group.
    fake.selection({ atoms: [0, 1] });
    store.startGroups(ketcher, () => storage, KEY);
    expect(tidy(fake.selection())).toEqual(WHOLE);
    expect(store.getGroupState().offer).toBe('ungroup');
    fake.selection(null);
    fake.selection({ atoms: [0] });
    expect(tidy(fake.selection())).toEqual(WHOLE);
  });

  it('keeps nothing in storage while there are no groups', () => {
    const storage = memoryStorage();
    const { fake, ketcher } = fakeKetcher(drawing());
    store.startGroups(ketcher, () => storage, KEY);
    fake.change();
    expect(storage.length).toBe(0);
    fake.selection({ atoms: [0, 2] });
    store.groupSelection();
    expect(JSON.parse(storage.getItem(KEY)!).groups).toHaveLength(1);
    store.ungroupSelection();
    expect(storage.length).toBe(0);
  });

  it('works for the session when storage fails', () => {
    const broken = memoryStorage();
    broken.getItem = () => {
      throw new Error('storage off');
    };
    broken.setItem = () => {
      throw new Error('storage full');
    };
    const { fake } = grouped(broken);
    fake.selection(null);
    fake.selection({ texts: [0] });
    expect(tidy(fake.selection())).toEqual(WHOLE);
  });

  it('tells the button whether Ketcher’s floating tools show, and its listeners of each change', () => {
    const { fake, ketcher } = fakeKetcher(drawing());
    store.startGroups(ketcher, () => memoryStorage(), KEY);
    const heard = vi.fn();
    store.subscribeGroups(heard);
    fake.floatingTools({ visible: true });
    expect(store.getGroupState().anchored).toBe(true);
    fake.floatingTools({}); // a move of the rotate handle only
    expect(store.getGroupState().anchored).toBe(true);
    fake.floatingTools({ visible: false });
    expect(store.getGroupState().anchored).toBe(false);
    fake.selection({ atoms: [0, 2] });
    expect(store.getGroupState().offer).toBe('group');
    expect(heard).toHaveBeenCalledTimes(3);
  });
});
